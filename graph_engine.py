"""Bounded, incremental graph construction; model work never blocks ingestion."""
import asyncio
import inspect
import re
import time
from collections import deque

_WORDS = {w: i for i, w in enumerate(('one two three four five six seven eight nine ten eleven twelve').split(), 1)}
_NUM = r'(?:1[0-2]|[1-9]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)'
_COUNT = re.compile(r'\b(' + _NUM + r')\s+(?:topics?|points?|ideas?|things?|items?|steps?|subjects?)\b', re.I)


class GraphSession:
    def __init__(self, send, *, classify=None, refine=None, heartbeat=0.3, semantic_delay=0.45):
        self.send = send
        self.classify = classify
        self.refine = refine
        self.heartbeat = heartbeat
        self.semantic_delay = semantic_delay
        self.nodes = {}
        self.edges = {}
        self.revision = 0
        self.text = ''
        self._epoch = 0
        self._last_semantic = None
        self._queue = deque()
        self._desired = {}
        self._slots = []
        self._tasks = []
        self._wake = asyncio.Event()
        self._closed = False
        self.meaning_status = 'idle'
        self.meaning_message = None
        self.question = None
        self.refinement_focus = None
        self.node_revisions = {}
        self.decorations = {}
        self._decoration_seen = set()
        self._decoration_events = deque(maxlen=12)
        self._decoration_sequence = 0
        self._last_decoration_reaction = float('-inf')

    async def _emit(self, event):
        if event.get('type') == 'graph_status':
            self.meaning_status = event['status']
            self.meaning_message = event.get('message')
        result = self.send(event)
        if inspect.isawaitable(result):
            await result

    def snapshot(self):
        return {'type': 'graph_snapshot', 'nodes': [dict(n) for n in self.nodes.values()],
                'edges': [dict(e) for e in self.edges.values()], 'revision': self.revision,
                'node_revisions': dict(self.node_revisions)}

    @staticmethod
    def _semantic_node(node):
        return {key: node.get(key) for key in ('label', 'body', 'kind', 'status', 'parent_id')}

    def decoration_applied(self, message):
        """Accept a completed visual receipt, never client-authored narration."""
        ident, level = message.get('node_id'), message.get('level')
        revision, rendered = message.get('node_revision'), message.get('rendered_revision')
        if not isinstance(ident, str) or type(level) is not int or level not in (1, 2):
            return None
        node = self.nodes.get(ident)
        if (not node or node.get('status') in ('placeholder', 'pending') or not node.get('label')
                or type(revision) is not int or revision != self.node_revisions.get(ident)
                or type(rendered) is not int or not revision <= rendered <= self.revision
                or self._semantic_node(node) != self._semantic_node(self._desired.get(ident, {}))):
            return None
        if any(ident in (op.get('edge', {}).get('source'), op.get('edge', {}).get('target'))
               for op, _ in self._queue):
            return None
        key = (self._epoch, ident, revision, level)
        previous = self.decorations.get(ident, {}).get('level', 0)
        if key in self._decoration_seen or len(self._decoration_seen) >= 48 or level != previous + 1:
            return None
        if ident not in self.decorations and len(self.decorations) >= 6:
            return None
        self._decoration_seen.add(key)
        self._decoration_sequence += 1
        event = {'sequence': self._decoration_sequence, 'node_id': ident, 'label': node['label'],
                 'level': level, 'node_revision': revision, 'rendered_revision': rendered,
                 'kind': 'washi_tape', 'status': 'visibly_completed'}
        self.decorations[ident] = event
        self._decoration_events.append(event)
        return event

    def claim_decoration_reaction(self, now=None):
        now = time.monotonic() if now is None else now
        if (self._closed or self.meaning_status in ('pending', 'working') or self._queue
                or now - self._last_decoration_reaction < 45):
            return None
        eligible = [event for event in self._decoration_events
                    if self.decorations.get(event['node_id']) == event]
        if not eligible:
            return None
        self._decoration_events.clear()
        self._last_decoration_reaction = now
        return dict(eligible[-1])

    def voice_context(self, rendered_revision=None):
        """Server-owned meaning and drawing state, without image payloads."""
        def node(value):
            return {key: value[key] for key in ('id', 'label', 'kind', 'status', 'parent_id') if key in value}
        def edge(value):
            return {key: value[key] for key in ('id', 'source', 'target', 'label') if key in value}
        return {
            'transcript': self.text[-4000:],
            'canvas': {'revision': self.revision, 'nodes': [node(n) for n in self.nodes.values()],
                       'edges': [edge(e) for e in list(self.edges.values())[-160:]],
                       'omitted_edges': max(0, len(self.edges) - 160)},
            'rendered_revision': rendered_revision,
            'pending_nodes': [node(n) for key, n in self._desired.items() if n != self.nodes.get(key)],
            'queue_depth': len(self._queue),
            'interpretation_status': self.meaning_status,
            'interpretation_message': self.meaning_message,
            'clarifying_question': self.question,
            'completed_decorations': [dict(event) for event in self.decorations.values()],
        }

    async def start(self):
        if self._tasks:
            return
        self._closed = False
        await self._emit(self.snapshot())
        self._tasks = [asyncio.create_task(self._pump()), asyncio.create_task(self._semantic())]

    async def ingest(self, text, mode='append'):
        if mode not in ('append', 'replace'):
            raise ValueError('mode must be append or replace')
        if self._closed:
            return
        if mode == 'replace':
            self._epoch += 1
        self.text = (self.text + ' ' + str(text)).strip() if mode == 'append' else str(text)
        self.text = self.text[-32000:]
        self.meaning_status = 'pending'
        self.meaning_message = None
        self.question = None
        match = _COUNT.search(self.text)
        if match:
            token = match.group(1).lower()
            count = int(token) if token.isdigit() else _WORDS[token]
            self._ensure_slots(count)
        # Counts may reserve space immediately. Only semantic interpretation may
        # name a concept; copying ordinal/list fragments produces a transcript.
        self._wake.set()

    async def request_refinement(self, concept=None):
        if self._closed:
            return
        self._last_semantic = None
        self.refinement_focus = str(concept)[:2000] if concept else None
        self._wake.set()

    def _ensure_slots(self, count):
        while len(self._slots) < min(count, 80):
            index = len(self._slots) + 1
            node = {'id': f'topic-{index}', 'label': f'Topic {index}', 'kind': 'topic', 'status': 'placeholder'}
            self._slots.append(node['id'])
            self._enqueue({'type': 'add_node', 'node': node}, 'structure')

    def _enqueue(self, op, layer):
        kind = op.get('type')
        if kind in ('add_node', 'update_node'):
            node = op.get('node', {})
            if not isinstance(node, dict) or not isinstance(node.get('id'), str):
                return
            ident = node['id']
            if kind == 'add_node' and ident not in self._desired and len(self._desired) >= 80:
                return
            if kind == 'update_node' and ident not in self._desired:
                return
            merged = dict(self._desired.get(ident, {}), **node)
            merged.setdefault('label', ident)
            merged.setdefault('kind', 'topic')
            merged.setdefault('status', 'named')
            if merged == self._desired.get(ident):
                return
            for queued, _ in reversed(self._queue):
                if queued.get('node', {}).get('id') == ident:
                    queued['node'] = merged
                    self._desired[ident] = merged
                    return
            if kind == 'add_node' and ident in self.nodes:
                kind = 'update_node'
            op = {'type': kind, 'node': merged}
        elif kind == 'add_edge':
            edge = op.get('edge', {})
            if not isinstance(edge, dict) or not all(isinstance(edge.get(k), str) for k in ('id', 'source', 'target')):
                return
            if edge['source'] not in self._desired or edge['target'] not in self._desired:
                return
            if edge['id'] in self.edges or any(q.get('edge', {}).get('id') == edge['id'] for q, _ in self._queue):
                return
        else:
            return
        if len(self._queue) >= 160:
            return
        if kind in ('add_node', 'update_node'):
            self._desired[ident] = merged
        self._queue.append((op, layer))

    async def _pump(self):
        while True:
            await asyncio.sleep(self.heartbeat)
            if not self._queue:
                continue
            op, layer = self._queue.popleft()
            affected = set()
            if op['type'] == 'add_edge':
                affected.update((op['edge']['source'], op['edge']['target']))
                self.edges[op['edge']['id']] = dict(op['edge'])
            else:
                old = self.nodes.get(op['node']['id'], {})
                if self._semantic_node(old) != self._semantic_node(op['node']):
                    affected.add(op['node']['id'])
                    affected.update(parent for parent in (old.get('parent_id'), op['node'].get('parent_id')) if parent)
                self.nodes[op['node']['id']] = dict(op['node'])
            self.revision += 1
            for ident in affected:
                self.node_revisions[ident] = self.revision
                self.decorations.pop(ident, None)
            await self._emit({'type': 'graph_patch', 'op': op, 'revision': self.revision,
                              'layer': layer, 'queue_depth': len(self._queue),
                              'node_revisions': {ident: self.revision for ident in affected}})

    def _enqueue_meaning(self, op, basis):
        # Prefix results can add meaning during continued speech, but cannot
        # rewrite nodes changed since their interpretation began.
        if op.get('type') in ('add_node', 'update_node'):
            node = op.get('node')
            if not isinstance(node, dict):
                return
            ident = node.get('id')
            current = self._desired.get(ident)
            if current != basis.get(ident):
                return
            parent = node.get('parent_id')
            if parent is not None:
                if not isinstance(parent, str) or parent == ident or parent not in self._desired:
                    return
                if parent in basis and self._desired[parent] != basis[parent]:
                    return
                # Leave space for both operations so an accepted child is connected.
                if len(self._queue) > 158:
                    return
            node = dict(node, status='provisional')
            self._enqueue(dict(op, node=node), 'meaning')
            accepted = self._desired.get(ident)
            if parent and accepted and all(accepted.get(key) == value for key, value in node.items()):
                self._enqueue({'type': 'add_edge', 'edge': {
                    'id': f'contains:{parent}:{ident}', 'source': parent,
                    'target': ident, 'label': 'contains'}}, 'meaning')
        elif op.get('type') == 'add_edge':
            edge = op.get('edge', {})
            if not isinstance(edge, dict):
                return
            for key in ('source', 'target'):
                ident = edge.get(key)
                if ident in basis and self._desired.get(ident) != basis[ident]:
                    return
            self._enqueue(op, 'meaning')

    async def _semantic(self):
        while True:
            await self._wake.wait()
            self._wake.clear()
            await asyncio.sleep(self.semantic_delay)
            self._wake.clear()
            epoch, text = self._epoch, self.text
            prefix = (epoch, text)
            if prefix == self._last_semantic:
                continue
            self._last_semantic = prefix
            basis = {key: dict(node) for key, node in self._desired.items()}
            graph = self.snapshot()
            graph['nodes'] = [dict(node) for node in basis.values()]
            graph['focus'] = self.refinement_focus
            classify, refine = self.classify, self.refine
            if refine is None:
                try:
                    import providers
                    refine = refine or providers.refine
                except (ImportError, AttributeError):
                    await self._emit({'type': 'graph_status', 'layer': 'meaning', 'status': 'unavailable',
                                      'message': 'Semantic provider unavailable; explicit structure remains active.'})
                    continue
            try:
                await self._emit({'type': 'graph_status', 'layer': 'meaning', 'status': 'working', 'queue_depth': len(self._queue)})
                # Optional injected triage, never a required external dependency.
                # In production the interpreter itself decides whether speech
                # contributes meaning; greetings/repetitions return no operations.
                if classify is not None:
                    decision = await classify(text, graph)
                    if epoch != self._epoch:
                        continue
                    if not decision.get('needs_refinement', False):
                        await self._emit({'type': 'graph_status', 'layer': 'meaning', 'status': 'idle'})
                        continue
                result = await refine(text, graph)
                if epoch != self._epoch:
                    continue
                for op in result.get('operations', [])[:160]:
                    if isinstance(op, dict):
                        self._enqueue_meaning(op, basis)
                self.question = result.get('question')
                if self.question:
                    await self._emit({'type': 'refinement', 'question': str(self.question)})
                await self._emit({'type': 'graph_status', 'layer': 'meaning', 'status': 'idle', 'queue_depth': len(self._queue)})
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                message = 'Semantic provider unavailable; explicit structure remains active.'
                # Only this provider-owned exception promises a sanitized message.
                try:
                    from providers import ProviderUnavailable
                    if isinstance(exc, ProviderUnavailable):
                        message = str(exc)
                except ImportError:
                    pass
                await self._emit({'type': 'graph_status', 'layer': 'meaning', 'status': 'unavailable',
                                  'message': message})

    async def reset(self):
        self._epoch += 1
        self.text = ''
        self.meaning_status = 'idle'
        self.meaning_message = None
        self.question = None
        self.refinement_focus = None
        self.node_revisions.clear()
        self.decorations.clear()
        self._decoration_seen.clear()
        self._decoration_events.clear()
        self._queue.clear()
        self._desired.clear()
        self._slots.clear()
        self.nodes.clear()
        self.edges.clear()
        self._wake.clear()
        self.revision += 1
        await self._emit(self.snapshot())

    async def close(self):
        self._closed = True
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
