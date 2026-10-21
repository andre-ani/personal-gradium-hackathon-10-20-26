"""Bounded, incremental graph construction; model work never blocks ingestion."""
import asyncio
import inspect
import re
import time
from collections import deque

_WORDS = {w: i for i, w in enumerate(('one two three four five six seven eight nine ten eleven twelve').split(), 1)}
_NUM = r'(?:1[0-2]|[1-9]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)'
_COUNT = re.compile(r'\b(' + _NUM + r')\s+(?:topics?|points?|ideas?|things?|items?|steps?|subjects?)\b', re.I)
# Mirrors frontend/palette.js. Blue is primary and always marks the first group.
PALETTE_KEYS = ('blue', 'teal', 'green', 'ochre', 'terracotta', 'rose', 'plum', 'slate')
# Cara's lines feed interpretation only when the user's latest line asked her
# to explain or map something; otherwise her chatter would become cards.
_ASKS_CARA = re.compile(r'\b(?:map|explain|brainstorm|teach|write|tell me about|walk me through|break\b.{0,24}\bdown)', re.I)
_LABEL_DROP = re.compile(r'[^a-z0-9 ]+')
# Mirrors DECORATION_TYPES in frontend/stable-decorations.js. Only washi tape
# has a second stage; every doodle completes at level 1.
DECORATION_KINDS = ('washi_tape', 'stars', 'sparkle', 'heart', 'burst', 'underline', 'circle')
# Transcript lines name who spoke so interpretation can tell user ideas from
# Cara's explanations and chatter.
SPEAKERS = {'user': 'You', 'assistant': 'Cara'}


def _label_tokens(label):
    """Normalized label words: case, punctuation, plurals and 'and'/'&' ignored."""
    words = _LABEL_DROP.sub(' ', str(label).lower().replace('&', ' and ')).split()
    tokens = []
    for word in words:
        if word == 'and':
            continue
        if len(word) > 4 and word.endswith('ies'):
            word = word[:-3] + 'y'
        elif len(word) > 3 and word.endswith('s') and not word.endswith('ss'):
            word = word[:-1]
        tokens.append(word)
    return tokens


def _same_label(a, b):
    ta, tb = _label_tokens(a), _label_tokens(b)
    if not ta or not tb:
        return False
    if ta == tb:
        return True
    sa, sb = set(ta), set(tb)
    return len(sa & sb) / len(sa | sb) >= .8


def _join_line(text, previous, speaker, chunk):
    # Streamed chunks from one speaker share a line; a new speaker starts one.
    if speaker != previous:
        chunk = f'{SPEAKERS[speaker]}: {chunk}'
        return ((text + '\n' + chunk) if text else chunk)[-32000:]
    return (text + ' ' + chunk).strip()[-32000:]


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
        self._speaker = None
        self._user_text = ''
        # Refinement input: user lines, plus Cara's lines only while gated open.
        self._refine_text = ''
        self._refine_speaker = None
        self._last_user_line = ''
        self._cara_gate = False
        self._aliases = {}
        self._epoch = 0
        self._last_semantic = None
        self._queue = deque()
        self._desired = {}
        self._slots = []
        self._group_palette = {}
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
        return {key: node.get(key) for key in ('label', 'body', 'kind', 'status', 'parent_id', 'near')}

    def decoration_applied(self, message):
        """Accept a completed visual receipt, never client-authored narration."""
        ident, level = message.get('node_id'), message.get('level')
        revision, rendered = message.get('node_revision'), message.get('rendered_revision')
        kind = message.get('decoration', 'washi_tape')
        if not isinstance(ident, str) or type(level) is not int or level not in (1, 2):
            return None
        if not isinstance(kind, str) or kind not in DECORATION_KINDS or (level == 2 and kind != 'washi_tape'):
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
        applied = self.decorations.get(ident, {})
        previous = applied.get('level', 0)
        if key in self._decoration_seen or len(self._decoration_seen) >= 48 or level != previous + 1:
            return None
        if previous and applied.get('kind') != kind:
            return None
        if ident not in self.decorations and len(self.decorations) >= 6:
            return None
        self._decoration_seen.add(key)
        self._decoration_sequence += 1
        event = {'sequence': self._decoration_sequence, 'node_id': ident, 'label': node['label'],
                 'level': level, 'node_revision': revision, 'rendered_revision': rendered,
                 'kind': kind, 'status': 'visibly_completed'}
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
            return {key: value[key] for key in ('id', 'label', 'kind', 'status', 'parent_id', 'near') if key in value}
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

    async def ingest(self, text, mode='append', speaker='user'):
        if mode not in ('append', 'replace'):
            raise ValueError('mode must be append or replace')
        if speaker not in SPEAKERS:
            raise ValueError('speaker must be user or assistant')
        if self._closed:
            return
        text = str(text).strip()
        if not text and mode == 'append':
            return
        if mode == 'replace':
            self._epoch += 1
            self.text, self._speaker, self._user_text = '', None, ''
            self._refine_text, self._refine_speaker, self._last_user_line, self._cara_gate = '', None, '', False
        new_line = speaker != self._speaker
        self.text = _join_line(self.text, self._speaker, speaker, text)
        self._speaker = speaker
        if speaker == 'user':
            # A new user line closes the gate until Cara answers it.
            self._last_user_line = text if new_line else (self._last_user_line + ' ' + text)[-4000:]
            self._cara_gate = False
        elif new_line:
            self._cara_gate = bool(_ASKS_CARA.search(self._last_user_line))
        if speaker == 'user' or self._cara_gate:
            self._refine_text = _join_line(self._refine_text, self._refine_speaker, speaker, text)
            self._refine_speaker = speaker
            self.meaning_status = 'pending'
            self.meaning_message = None
            self.question = None
            self._wake.set()
        # Only the user's own counts reserve slots; Cara's chatter ("those two
        # ideas") must not create blank boxes.
        if speaker == 'user':
            self._user_text = (self._user_text + ' ' + text).strip()[-32000:]
        match = _COUNT.search(self._user_text)
        if match:
            token = match.group(1).lower()
            count = int(token) if token.isdigit() else _WORDS[token]
            self._ensure_slots(count)
        # Counts may reserve space immediately. Only semantic interpretation may
        # name a concept; copying ordinal/list fragments produces a transcript.

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

    def _palette_for(self, group, hint=None, avoid=None):
        # A group's colour is fixed at first sight; later hints never repaint it.
        # `avoid` (a loose node's neighbour colour) is skipped when possible.
        if group in self._group_palette:
            return self._group_palette[group]
        used = set(self._group_palette.values())
        if not self._group_palette:
            key = PALETTE_KEYS[0]
        elif hint in PALETTE_KEYS[1:] and hint not in used and hint != avoid:
            key = hint
        else:
            key = next((k for k in PALETTE_KEYS[1:] if k not in used and k != avoid), None)
            if key is None:
                cycle = PALETTE_KEYS[1:]
                key = cycle[(len(self._group_palette) - 1) % len(cycle)]
                if key == avoid:
                    key = cycle[(cycle.index(key) + 1) % len(cycle)]
        self._group_palette[group] = key
        return key

    def _classify(self, ident, incoming, merged, old):
        """Instant, network-free colour from the tree only; model groups are ignored."""
        parent = merged.get('parent_id')
        # `near` is a placement-only hint for a parentless (loose) node.
        near = merged.get('near')
        if parent or not isinstance(near, str) or near == ident or near not in self._desired:
            merged.pop('near', None)
            near = None
        parent_node = self._desired.get(parent, {}) if parent != ident else {}
        if not parent_node or not parent_node.get('parent_id'):
            # Roots, loose nodes and each direct child of a root (a branch) are
            # their own group.
            group = ident
        else:
            # Deeper cards inherit their first-level branch's group.
            group = parent_node.get('group') or parent
        merged['group'] = group
        hint = incoming.get('palette')
        # A loose node avoids its neighbour's colour when it can.
        avoid = self._desired[near].get('palette') if near else None
        merged['palette'] = self._palette_for(group, hint if isinstance(hint, str) else None, avoid=avoid)

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
            self._classify(ident, node, merged, self._desired.get(ident, {}))
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
            pair = {edge['source'], edge['target']}
            if len(pair) < 2:
                return
            queued = [q['edge'] for q, _ in self._queue if q.get('type') == 'add_edge']
            # One card pair gets one connector, whatever its id or direction.
            if any(e['id'] == edge['id'] or {e['source'], e['target']} == pair
                   for e in (*self.edges.values(), *queued)):
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

    def _alias(self, ident):
        return self._aliases.get(ident, ident)

    def _ancestors(self, ident):
        seen = set()
        while isinstance(ident, str) and ident in self._desired and ident not in seen:
            seen.add(ident)
            ident = self._desired[ident].get('parent_id')
        return seen

    def _duplicate_of(self, node):
        """An existing card with the same idea, never one in the node's own lineage."""
        label = node.get('label')
        if not isinstance(label, str):
            return None
        lineage = self._ancestors(node.get('parent_id'))
        for ident, existing in self._desired.items():
            if ident not in lineage and _same_label(label, existing.get('label', '')):
                return ident
        return None

    def _enqueue_meaning(self, op, basis):
        # Prefix results can add meaning during continued speech, but cannot
        # rewrite nodes changed since their interpretation began.
        if op.get('type') in ('add_node', 'update_node'):
            node = op.get('node')
            if not isinstance(node, dict):
                return
            node = dict(node)
            for key in ('id', 'parent_id', 'near'):
                if isinstance(node.get(key), str):
                    node[key] = self._alias(node[key])
            ident = node.get('id')
            duplicate = None
            if op.get('type') == 'add_node' and isinstance(ident, str) and ident not in self._desired:
                duplicate = self._duplicate_of(node)
            if duplicate:
                # Same idea as an existing card: merge only fields it lacks.
                self._aliases[ident] = duplicate
                existing = self._desired[duplicate]
                node = {key: value for key, value in node.items()
                        if key not in ('id', 'label', 'status') and value is not None
                        and existing.get(key) in (None, '')}
                if not node:
                    return
                ident = node['id'] = duplicate
                op = {'type': 'update_node', 'node': node}
            elif self._desired.get(ident) != basis.get(ident):
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
            if not duplicate:
                node = dict(node, status='provisional')
            self._enqueue(dict(op, node=node), 'meaning')
            accepted = self._desired.get(ident)
            # `palette` is only a hint for a new group, so it may be overridden.
            if parent and accepted and all(accepted.get(key) == value for key, value in node.items() if key != 'palette'):
                self._enqueue({'type': 'add_edge', 'edge': {
                    'id': f'contains:{parent}:{ident}', 'source': parent,
                    'target': ident, 'label': 'contains'}}, 'meaning')
        elif op.get('type') == 'add_edge':
            edge = op.get('edge', {})
            if not isinstance(edge, dict):
                return
            edge = dict(edge, **{key: self._alias(edge[key]) for key in ('source', 'target') if isinstance(edge.get(key), str)})
            op = dict(op, edge=edge)
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
            epoch, text = self._epoch, self._refine_text
            prefix = (epoch, text)
            if prefix == self._last_semantic:
                continue
            self._last_semantic = prefix
            basis = {key: dict(node) for key, node in self._desired.items()}
            graph = self.snapshot()
            graph['nodes'] = [dict(node) for node in basis.values()]
            graph['focus'] = self.refinement_focus
            graph['aliases'] = dict(self._aliases)
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
        self._speaker = None
        self._user_text = ''
        self._refine_text, self._refine_speaker, self._last_user_line, self._cara_gate = '', None, '', False
        self._aliases.clear()
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
        self._group_palette.clear()
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
