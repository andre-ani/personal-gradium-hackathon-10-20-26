"""Bounded, incremental graph construction; model work never blocks ingestion."""
import asyncio
import inspect
import re
from collections import deque

_WORDS = {w: i for i, w in enumerate(('one two three four five six seven eight nine ten eleven twelve').split(), 1)}
_NUM = r'(?:1[0-2]|[1-9]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)'
_COUNT = re.compile(r'\b(' + _NUM + r')\s+(?:topics?|points?|ideas?|things?|items?|steps?|subjects?)\b', re.I)
_ORDINAL = re.compile(r'\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\b\s*[:,.)-]?\s*', re.I)
_ORDERS = 'first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth'.split()


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

    async def _emit(self, event):
        result = self.send(event)
        if inspect.isawaitable(result):
            await result

    def snapshot(self):
        return {'type': 'graph_snapshot', 'nodes': [dict(n) for n in self.nodes.values()],
                'edges': [dict(e) for e in self.edges.values()], 'revision': self.revision}

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
        match = _COUNT.search(self.text)
        if match:
            token = match.group(1).lower()
            count = int(token) if token.isdigit() else _WORDS[token]
            self._ensure_slots(count)
        labels = []
        marks = list(_ORDINAL.finditer(self.text))
        for i, mark in enumerate(marks):
            end = marks[i + 1].start() if i + 1 < len(marks) else len(self.text)
            label = self.text[mark.end():end].strip(' ,.;:-')
            label = re.split(r'[.!?;](?:\s|$)|,', label, maxsplit=1)[0].strip()
            label = re.sub(r'\s+and$', '', label, flags=re.I).strip()
            if label:
                labels.append((_ORDERS.index(mark.group(1).lower()), label))
        listing = re.search(r'\b(?:topics|points|ideas|items|steps|subjects)\s*:\s*(.+)', self.text, re.I)
        if listing:
            parts = [p.strip(' ,.;') for p in re.split(r',\s*(?:and\s+)?|\s+and\s+', listing.group(1))]
            labels.extend(enumerate(p for p in parts if p))
        for index, label in labels[:80]:
            self._ensure_slots(index + 1)
            node = dict(self._desired[self._slots[index]], label=label[:160], status='named')
            self._enqueue({'type': 'update_node', 'node': node}, 'structure')
        self._wake.set()

    async def request_refinement(self):
        if self._closed:
            return
        self._last_semantic = None
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
            if op['type'] == 'add_edge':
                self.edges[op['edge']['id']] = dict(op['edge'])
            else:
                self.nodes[op['node']['id']] = dict(op['node'])
            self.revision += 1
            await self._emit({'type': 'graph_patch', 'op': op, 'revision': self.revision,
                              'layer': layer, 'queue_depth': len(self._queue)})

    def _enqueue_meaning(self, op, basis):
        # Prefix results can add meaning during continued speech, but cannot
        # rewrite nodes changed by newer deterministic evidence.
        if op.get('type') in ('add_node', 'update_node'):
            node = op.get('node')
            if not isinstance(node, dict):
                return
            ident = node.get('id')
            current = self._desired.get(ident)
            if current != basis.get(ident):
                return
            if current and current.get('status') == 'named' and node.get('label', current['label']) != current['label']:
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
            classify, refine = self.classify, self.refine
            if classify is None or refine is None:
                try:
                    import providers
                    classify = classify or providers.classify
                    refine = refine or providers.refine
                except (ImportError, AttributeError):
                    await self._emit({'type': 'graph_status', 'layer': 'meaning', 'status': 'unavailable',
                                      'message': 'Semantic provider unavailable; explicit structure remains active.'})
                    continue
            try:
                await self._emit({'type': 'graph_status', 'layer': 'meaning', 'status': 'working', 'queue_depth': len(self._queue)})
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
                if result.get('question'):
                    await self._emit({'type': 'refinement', 'question': str(result['question'])})
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
