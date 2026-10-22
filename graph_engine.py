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
# Blue leads and green is the secondary colour, so maps pair them first.
PALETTE_KEYS = ('blue', 'green', 'teal', 'ochre', 'terracotta', 'rose', 'plum', 'slate')
# Cara's lines feed interpretation only when the user's latest line asked her
# to explain or map something; otherwise her chatter would become cards.
_ASKS_CARA = re.compile(r'\b(?:map|draw|diagram|explain|brainstorm|teach|write|show me how|show the process|tell me about|walk me through|break\b.{0,24}\bdown)', re.I)
_LABEL_DROP = re.compile(r'[^a-z0-9 ]+')
_GRAPH_ID = re.compile(r'^[A-Za-z0-9_-]{1,80}$')
_EDIT_MAX_OPERATIONS = 32
_EDIT_NODE_FIELDS = {'label', 'body', 'parent_id', 'near', 'kind', 'status', 'group'}
_EDIT_STATUS = {'active', 'done', 'open', 'named', 'placeholder', 'provisional', 'pending'}
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
        # Content edits are serialized with the display pump. Layout state is
        # intentionally separate; the websocket owner may attach positions.
        self._state_lock = asyncio.Lock()
        self.layout_state = {}

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
        elif kind == 'remove_edge':
            # Only a superseded containment connector, after a re-parent.
            ident = op.get('edge', {}).get('id')
            queued = [item for item in self._queue if item[0].get('type') == 'add_edge' and item[0]['edge'].get('id') == ident]
            for item in queued:
                self._queue.remove(item)
            if ident not in self.edges or any(q.get('type') == 'remove_edge' and q['edge']['id'] == ident for q, _ in self._queue):
                return
            op = {'type': 'remove_edge', 'edge': dict(self.edges[ident])}
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
            async with self._state_lock:
                if not self._queue:
                    continue
                op, layer = self._queue.popleft()
                affected = set()
                if op['type'] == 'remove_edge':
                    affected.update((op['edge']['source'], op['edge']['target']))
                    self.edges.pop(op['edge']['id'], None)
                elif op['type'] == 'add_edge':
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

    def _alias(self, ident, aliases=None):
        aliases = self._aliases if aliases is None else aliases
        seen = set()
        while isinstance(ident, str) and ident in aliases and ident not in seen:
            seen.add(ident)
            ident = aliases[ident]
        return ident

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
                # Re-parenting under a section must never create a cycle.
                if ident in self._ancestors(parent):
                    return
                if parent in basis and self._desired[parent] != basis[parent]:
                    return
                # Leave space for both operations so an accepted child is connected.
                if len(self._queue) > 157:
                    return
            old_parent = self._desired.get(ident, {}).get('parent_id')
            if not duplicate:
                node = dict(node, status='provisional')
            self._enqueue(dict(op, node=node), 'meaning')
            accepted = self._desired.get(ident)
            if old_parent and accepted and accepted.get('parent_id') != old_parent:
                self._enqueue({'type': 'remove_edge', 'edge': {'id': f'contains:{old_parent}:{ident}'}}, 'meaning')
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

    @staticmethod
    def _edit_error(message):
        raise ValueError(f'Invalid graph edit: {message}')

    @staticmethod
    def _edit_identifier(value, field='id'):
        if not isinstance(value, str) or not _GRAPH_ID.fullmatch(value):
            GraphSession._edit_error(f'{field} must be 1-80 letters, numbers, underscores, or hyphens')
        return value

    @staticmethod
    def _edge_pair(source, target):
        return frozenset((source, target))

    @staticmethod
    def _edit_node_depth(nodes, ident):
        depth, seen = 0, set()
        while ident in nodes and nodes[ident].get('parent_id') is not None:
            if ident in seen:
                return 10_000
            seen.add(ident)
            ident = nodes[ident].get('parent_id')
            depth += 1
        return depth

    def _classify_edit_node(self, ident, node, incoming, nodes, palettes, preserve_group=False):
        """Apply the same cheap tree classification as _enqueue, on a copy."""
        parent = node.get('parent_id')
        near = node.get('near')
        if parent is not None or not isinstance(near, str) or near == ident or near not in nodes:
            node.pop('near', None)
            near = None
        if preserve_group and node.get('group') is not None:
            group = node['group']
        else:
            parent_node = nodes.get(parent, {}) if parent != ident else {}
            if not parent_node or not parent_node.get('parent_id'):
                group = ident
            else:
                group = parent_node.get('group') or parent
        node['group'] = group
        if group in palettes:
            node['palette'] = palettes[group]
            return
        hint = incoming.get('palette') if isinstance(incoming, dict) else None
        used = set(palettes.values())
        if not palettes:
            palette = PALETTE_KEYS[0]
        elif hint in PALETTE_KEYS[1:] and hint not in used:
            palette = hint
        else:
            palette = next((key for key in PALETTE_KEYS[1:] if key not in used), None)
            if palette is None:
                cycle = PALETTE_KEYS[1:]
                palette = cycle[(len(palettes) - 1) % len(cycle)]
        palettes[group] = palette
        node['palette'] = palette

    def _edit_node_fields(self, raw, *, kind, nodes, aliases):
        if not isinstance(raw, dict):
            self._edit_error('node must be an object')
        if set(raw) - ({'id'} | _EDIT_NODE_FIELDS):
            self._edit_error('node contains an unsupported field')
        raw_id = self._edit_identifier(raw.get('id'))
        ident = self._alias(raw_id, aliases)
        if kind == 'update_node' and ident not in nodes:
            self._edit_error(f'unknown node {raw_id}')
        if kind == 'add_node' and ident in nodes:
            self._edit_error(f'node {raw_id} already exists')
        clean = {'id': ident}
        for field in _EDIT_NODE_FIELDS:
            if field not in raw:
                continue
            value = raw[field]
            if field in ('parent_id', 'near'):
                if value is not None:
                    value = self._alias(self._edit_identifier(value, field), aliases)
                    if value not in nodes:
                        self._edit_error(f'{field} references unknown node {value}')
                    if value == ident:
                        self._edit_error(f'{field} cannot reference itself')
            elif field == 'label':
                if not isinstance(value, str) or not value.strip() or len(value) > 160:
                    self._edit_error('label must be a non-empty string under 160 characters')
            elif field == 'body':
                if value is not None and (not isinstance(value, str) or len(value) > 4000):
                    self._edit_error('body must be a string under 4000 characters or null')
            elif field == 'kind':
                if not isinstance(value, str) or not value.strip() or len(value) > 32:
                    self._edit_error('kind must be a non-empty string under 32 characters')
            elif field == 'status':
                if value not in _EDIT_STATUS:
                    self._edit_error('status is not supported')
            elif field == 'group':
                if value is not None and (not isinstance(value, str) or not value.strip() or len(value) > 80):
                    self._edit_error('group must be a non-empty string under 80 characters or null')
            clean[field] = value
        return ident, clean

    def _edit_edge(self, raw, *, nodes, edges, kind, aliases, ignore_ids=()):
        if not isinstance(raw, dict):
            self._edit_error('edge must be an object')
        if kind == 'remove_edge':
            if set(raw) - {'id'}:
                self._edit_error('remove_edge only accepts edge.id')
            edge_id = raw.get('id')
            if not isinstance(edge_id, str) or not 1 <= len(edge_id) <= 256:
                self._edit_error('edge id must be a bounded string')
            if edge_id not in edges:
                self._edit_error(f'unknown edge {edge_id}')
            return {'id': edge_id}
        if set(raw) - {'id', 'source', 'target', 'label'}:
            self._edit_error('edge contains an unsupported field')
        edge_id = self._edit_identifier(raw.get('id'), 'edge id')
        source = self._alias(self._edit_identifier(raw.get('source'), 'source'), aliases)
        target = self._alias(self._edit_identifier(raw.get('target'), 'target'), aliases)
        if source not in nodes or target not in nodes:
            self._edit_error('edge endpoints must name existing nodes')
        if source == target:
            self._edit_error('self loops are not supported')
        ignored = set(ignore_ids)
        if edge_id in edges and edge_id not in ignored:
            self._edit_error(f'edge {edge_id} already exists')
        pair = self._edge_pair(source, target)
        if any(edge_id not in ignored and self._edge_pair(edge.get('source'), edge.get('target')) == pair
               for edge_id, edge in edges.items()):
            self._edit_error('only one edge is allowed between a node pair')
        label = raw.get('label')
        if label is not None and (not isinstance(label, str) or len(label) > 100):
            self._edit_error('edge label must be a string under 100 characters or null')
        edge = {'id': edge_id, 'source': source, 'target': target}
        if 'label' in raw:
            edge['label'] = label
        return edge

    def _edit_cleanup_queue(self, node_ids, edge_ids, removed_ids):
        retained = deque()
        for op, layer in self._queue:
            if op.get('type') in ('add_node', 'update_node'):
                node = op.get('node', {})
                if node.get('id') in node_ids or node.get('id') in removed_ids:
                    continue
                if node.get('parent_id') in removed_ids or node.get('near') in removed_ids:
                    continue
            elif op.get('type') == 'add_edge':
                edge = op.get('edge', {})
                if (edge.get('id') in edge_ids or edge.get('source') in removed_ids
                        or edge.get('target') in removed_ids):
                    continue
            retained.append((op, layer))
        return retained

    async def edit(self, operations):
        """Atomically apply explicit semantic graph edits.

        The batch is validated against a working copy first. Successful edits
        reconcile the pending interpretation queue, update the displayed graph,
        and emit one existing ``graph_patch`` event per visible operation.
        """
        if not isinstance(operations, list):
            self._edit_error('operations must be a list')
        if len(operations) > _EDIT_MAX_OPERATIONS:
            self._edit_error(f'at most {_EDIT_MAX_OPERATIONS} operations are allowed')
        if not operations:
            return {'applied': 0, 'revision': self.revision}

        async with self._state_lock:
            if self._closed:
                self._edit_error('graph session is closed')

            base_nodes = {ident: dict(node) for ident, node in self._desired.items()}
            base_edges = {ident: dict(edge) for ident, edge in self.edges.items()}
            for queued, _ in self._queue:
                if queued.get('type') == 'add_edge':
                    edge = queued.get('edge', {})
                    if isinstance(edge, dict) and isinstance(edge.get('id'), str):
                        base_edges.setdefault(edge['id'], dict(edge))
            working_nodes = {ident: dict(node) for ident, node in base_nodes.items()}
            working_edges = {ident: dict(edge) for ident, edge in base_edges.items()}
            working_aliases = dict(self._aliases)
            working_palettes = dict(self._group_palette)
            display_nodes = {ident: dict(node) for ident, node in self.nodes.items()}
            display_edges = {ident: dict(edge) for ident, edge in self.edges.items()}
            normalized = []
            node_touched, removed_ids = set(), set()
            edge_touched, replaced_edges, removed_in_batch = set(), set(), set()
            explicit_groups = set()
            planned_edge_removals = {
                operation.get('edge', {}).get('id') for operation in operations
                if isinstance(operation, dict) and operation.get('type', operation.get('op')) == 'remove_edge'
                and isinstance(operation.get('edge'), dict)
            }

            for operation in operations:
                if not isinstance(operation, dict):
                    self._edit_error('each operation must be an object')
                op_kind = operation.get('type', operation.get('op'))
                if op_kind in ('add_node', 'update_node'):
                    ident, clean = self._edit_node_fields(
                        operation.get('node'), kind=op_kind, nodes=working_nodes, aliases=working_aliases)
                    if op_kind == 'add_node':
                        clean = {'id': ident, 'label': ident, 'kind': 'topic', 'status': 'named', **clean}
                    else:
                        clean = {**working_nodes[ident], **clean}
                    parent = clean.get('parent_id')
                    if parent is not None:
                        clean['near'] = None
                    if op_kind == 'add_node' or self._semantic_node(working_nodes.get(ident, {})) != self._semantic_node(clean):
                        if self._semantic_node(working_nodes.get(ident, {})) != self._semantic_node(clean):
                            clean['illustration'] = None
                    working_nodes[ident] = clean
                    node_touched.add(ident)
                    if 'group' in operation.get('node', {}):
                        explicit_groups.add(ident)
                    normalized.append({'type': op_kind, 'node': dict(clean)})
                elif op_kind == 'remove_node':
                    raw = operation.get('node')
                    if not isinstance(raw, dict) or set(raw) - {'id'}:
                        self._edit_error('remove_node requires only node.id')
                    raw_id = self._edit_identifier(raw.get('id'))
                    ident = self._alias(raw_id, working_aliases)
                    if ident not in working_nodes:
                        self._edit_error(f'unknown node {raw_id}')
                    node_touched.add(ident)
                    removed_ids.add(ident)
                    for child_id, child in list(working_nodes.items()):
                        if child_id == ident:
                            continue
                        if child.get('parent_id') == ident or child.get('near') == ident:
                            child = dict(child, parent_id=None, near=None, illustration=None)
                            working_nodes[child_id] = child
                            node_touched.add(child_id)
                    for edge_id, edge in list(working_edges.items()):
                        if ident in (edge.get('source'), edge.get('target')):
                            working_edges.pop(edge_id)
                            edge_touched.add(edge_id)
                    working_nodes.pop(ident)
                    for alias, target in list(working_aliases.items()):
                        if alias == ident or target == ident:
                            working_aliases.pop(alias, None)
                    normalized.append({'type': 'remove_node', 'node': {'id': ident}})
                elif op_kind in ('add_edge', 'remove_edge'):
                    edge = self._edit_edge(operation.get('edge'), nodes=working_nodes,
                                           edges=working_edges, kind=op_kind,
                                           aliases=working_aliases,
                                           ignore_ids=planned_edge_removals if op_kind == 'add_edge' else ())
                    if op_kind == 'add_edge':
                        if edge['id'] in removed_in_batch:
                            replaced_edges.add(edge['id'])
                        working_edges[edge['id']] = edge
                    else:
                        edge_id = edge['id']
                        removed_edge = working_edges[edge_id]
                        working_edges.pop(edge_id)
                        removed_in_batch.add(edge_id)
                        child_id = removed_edge.get('target')
                        parent_id = removed_edge.get('source')
                        if (edge_id == f'contains:{parent_id}:{child_id}'
                                and child_id in working_nodes
                                and working_nodes[child_id].get('parent_id') == parent_id):
                            child = dict(working_nodes[child_id], parent_id=None, illustration=None)
                            working_nodes[child_id] = child
                            node_touched.add(child_id)
                        if any(item.get('type') == 'add_edge' and item.get('edge', {}).get('id') == edge_id
                               for item in normalized):
                            replaced_edges.add(edge_id)
                    edge_touched.add(edge['id'])
                    if op_kind == 'add_edge':
                        node_touched.update((edge['source'], edge['target']))
                    normalized.append({'type': op_kind, 'edge': edge})
                else:
                    self._edit_error(f'unsupported operation {op_kind!r}')

            # Removal can orphan a node that was added or updated earlier in
            # this batch. Normalize every remaining parent/near reference.
            for ident, node in list(working_nodes.items()):
                updated = dict(node)
                parent = updated.get('parent_id')
                if parent is not None and parent not in working_nodes:
                    self._edit_error(f'parent references unknown node {parent}')
                if parent == ident:
                    self._edit_error('parent_id cannot reference itself')
                near = updated.get('near')
                if parent is not None:
                    updated['near'] = None
                elif near is not None and (near == ident or near not in working_nodes):
                    updated['near'] = None
                if updated != node:
                    updated['illustration'] = None
                    working_nodes[ident] = updated
                    node_touched.add(ident)

            # Parent changes imply the same stable contains connector used by
            # semantic interpretation. Remove the old connector and add the
            # new one unless another explicit edge already links the pair.
            for ident in set(base_nodes) | set(working_nodes):
                old_parent = base_nodes.get(ident, {}).get('parent_id')
                new_parent = working_nodes.get(ident, {}).get('parent_id')
                if old_parent == new_parent:
                    continue
                if old_parent:
                    edge_id = f'contains:{old_parent}:{ident}'
                    if edge_id in working_edges:
                        working_edges.pop(edge_id)
                        edge_touched.add(edge_id)
                if new_parent and ident in working_nodes:
                    edge_id = f'contains:{new_parent}:{ident}'
                    pair = self._edge_pair(new_parent, ident)
                    if edge_id not in working_edges and not any(
                            self._edge_pair(edge.get('source'), edge.get('target')) == pair
                            for edge in working_edges.values()):
                        working_edges[edge_id] = {
                            'id': edge_id, 'source': new_parent, 'target': ident, 'label': 'contains'}
                        edge_touched.add(edge_id)

            # Reject any final cycle, including one formed by several valid
            # individual updates in the same batch.
            for ident in working_nodes:
                seen = set()
                cursor = ident
                while cursor is not None:
                    if cursor in seen:
                        self._edit_error('parent links cannot contain a cycle')
                    seen.add(cursor)
                    parent = working_nodes[cursor].get('parent_id')
                    if parent is not None and parent not in working_nodes:
                        self._edit_error(f'parent references unknown node {parent}')
                    cursor = parent

            if len(working_nodes) > 80:
                self._edit_error('the graph can contain at most 80 nodes')

            # Recompute cheap branch metadata for nodes affected by content or
            # hierarchy edits without mutating the live palette map on failure.
            for ident in sorted(node_touched & set(working_nodes),
                                key=lambda item: (self._edit_node_depth(working_nodes, item), item)):
                if ident not in explicit_groups:
                    self._classify_edit_node(ident, working_nodes[ident], {}, working_nodes, working_palettes)
                elif working_nodes[ident].get('group') is None:
                    self._classify_edit_node(ident, working_nodes[ident], {}, working_nodes, working_palettes)
                else:
                    self._classify_edit_node(ident, working_nodes[ident], {}, working_nodes, working_palettes,
                                              preserve_group=True)

            # Every edge must remain usable after node deletion/reparenting.
            for edge in working_edges.values():
                if (edge.get('source') not in working_nodes or edge.get('target') not in working_nodes
                        or edge.get('source') == edge.get('target')):
                    self._edit_error('edges must reference two distinct existing nodes')

            node_cleanup = node_touched | removed_ids
            edge_cleanup = edge_touched | {
                edge_id for edge_id, edge in base_edges.items()
                if edge.get('source') in removed_ids or edge.get('target') in removed_ids}

            # All validation is complete. From this point on, no user-visible
            # state can fail validation midway through the batch.
            self._epoch += 1
            self._last_semantic = None
            self._aliases = working_aliases
            self._desired = working_nodes
            self._group_palette = working_palettes
            self._queue = self._edit_cleanup_queue(node_cleanup, edge_cleanup, removed_ids)
            self._slots = [ident for ident in self._slots if ident in working_nodes]

            # Materialize touched semantic nodes and apply touched edge changes
            # immediately. Pending unrelated interpretation work stays queued.
            for ident in node_cleanup:
                if ident in working_nodes:
                    self.nodes[ident] = dict(working_nodes[ident])
                else:
                    self.nodes.pop(ident, None)
                    self.node_revisions.pop(ident, None)
                self.decorations.pop(ident, None)
            for edge_id in edge_cleanup:
                if edge_id in working_edges and edge_id in edge_touched:
                    self.edges[edge_id] = dict(working_edges[edge_id])
                elif edge_id not in working_edges:
                    self.edges.pop(edge_id, None)
            for edge_id in list(self.edges):
                if edge_id in edge_cleanup and edge_id not in working_edges:
                    self.edges.pop(edge_id, None)

            node_ops = []
            for ident in node_cleanup:
                before, after = display_nodes.get(ident), working_nodes.get(ident)
                if after is None:
                    if before is not None:
                        node_ops.append(('remove_node', {'id': ident}, {ident}))
                elif before is None:
                    node_ops.append(('add_node', dict(after), {ident}))
                elif before != after:
                    affected = {ident}
                    affected.update(parent for parent in (before.get('parent_id'), after.get('parent_id')) if parent)
                    node_ops.append(('update_node', dict(after), affected))

            edge_ops = []
            for edge_id in edge_cleanup:
                before, after = display_edges.get(edge_id), working_edges.get(edge_id)
                if before is not None and (after is None or edge_id in replaced_edges):
                    affected = {value for value in (before.get('source'), before.get('target')) if value}
                    edge_ops.append(('remove_edge', {'id': edge_id}, affected))
                if after is not None and (before is None or edge_id in replaced_edges):
                    affected = {value for value in (after.get('source'), after.get('target')) if value}
                    edge_ops.append(('add_edge', dict(after), affected))

            patch_ops = [item for item in edge_ops if item[0] == 'remove_edge']
            patch_ops.extend(node_ops)
            patch_ops.extend(item for item in edge_ops if item[0] == 'add_edge')
            for op_kind, payload, affected in patch_ops:
                self.revision += 1
                for ident in affected:
                    self.node_revisions[ident] = self.revision
                    if op_kind == 'remove_node' and ident not in self.nodes:
                        self.node_revisions.pop(ident, None)
                if op_kind in ('remove_node', 'add_node', 'update_node'):
                    op = {'type': op_kind, 'node': payload}
                else:
                    op = {'type': op_kind, 'edge': payload}
                await self._emit({'type': 'graph_patch', 'op': op, 'revision': self.revision,
                                  'layer': 'edit', 'queue_depth': len(self._queue),
                                  'node_revisions': {ident: self.node_revisions[ident]
                                                     for ident in affected if ident in self.node_revisions}})
            return {'applied': len(operations), 'revision': self.revision}

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
                suggested = result.get('layout')
                if suggested in ('radial', 'flow') and suggested != self.layout_state.get('suggested'):
                    self.layout_state['suggested'] = suggested
                    await self._emit({'type': 'layout_hint', 'orientation': suggested})
                for op in result.get('operations', [])[:160]:
                    if isinstance(op, dict):
                        self._enqueue_meaning(op, basis)
                if result.get('operations'):
                    planned_edges = {ident: dict(edge) for ident, edge in self.edges.items()}
                    for queued, _layer in self._queue:
                        if queued.get('type') == 'add_edge':
                            planned_edges[queued['edge']['id']] = dict(queued['edge'])
                    await self._emit({'type': 'graph_plan',
                                      'nodes': [dict(node) for node in self._desired.values()],
                                      'edges': list(planned_edges.values())})
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
        async with self._state_lock:
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
            self.layout_state.clear()
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
