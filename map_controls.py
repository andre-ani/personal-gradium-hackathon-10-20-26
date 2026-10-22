"""Session-scoped spatial commands; layout never rewrites semantic graph state."""
import math
from uuid import uuid4

LAYOUTS = {'radial', 'flow', 'horizontal', 'vertical', 'compact'}
PLACEMENTS = {'left', 'right', 'above', 'below'}


class MapControls:
    def __init__(self, graph):
        self.graph = graph
        self.layout = 'radial'
        self.source = 'automatic'
        self.positions = {}
        self.pending = {}
        self.applied_revision = 0
        self.last_result = None

    def context(self):
        known = self.graph.nodes
        return {'orientation': self.layout, 'source': self.source, 'revision': self.applied_revision,
                'positions': {key: value for key, value in self.positions.items() if key in known},
                'pending_commands': list(self.pending.values())[-8:], 'last_result': self.last_result}

    async def request(self, action, **args):
        if len(self.pending) >= 8:
            raise ValueError('Wait for the current layout changes to finish.')
        if action == 'arrange':
            if args.get('orientation') not in LAYOUTS:
                raise ValueError('Choose radial, flow, horizontal, vertical, or compact.')
        elif action == 'move':
            known = self.graph.nodes
            if args.get('node_id') not in known or args.get('reference_id') not in known:
                raise ValueError('Inspect the map and use two existing card IDs.')
            if args['node_id'] == args['reference_id'] or args.get('placement') not in PLACEMENTS:
                raise ValueError('Move a card beside a different card: left, right, above, or below.')
        else:
            raise ValueError('Unknown map action.')
        command = {'id': uuid4().hex, 'action': action, **args}
        self.pending[command['id']] = command
        await self.graph._emit({'type': 'layout_command', **command})
        return {'accepted': True, 'command_id': command['id'], 'status': 'queued',
                'message': 'Layout requested. It is visible only after the browser acknowledges it.'}

    def acknowledge(self, message):
        ident = message.get('command_id')
        if ident is not None and ident not in self.pending:
            raise ValueError('Unknown or already acknowledged layout command.')
        orientation = message.get('orientation')
        raw = message.get('positions')
        if orientation not in LAYOUTS or not isinstance(raw, dict) or len(raw) > 160:
            raise ValueError('Invalid layout acknowledgement.')
        clean = {}
        for key, point in raw.items():
            if key not in self.graph.nodes:
                continue
            if (not isinstance(point, dict) or any(type(point.get(axis)) not in (float, int)
                or not math.isfinite(point[axis]) or abs(point[axis]) > 100000 for axis in ('x', 'y'))):
                raise ValueError('Invalid card position.')
            clean[key] = {'x': point['x'], 'y': point['y']}
        self.positions = clean
        self.layout = orientation
        if message.get('source') in ('automatic', 'manual'):
            self.source = message['source']
        applied = message.get('applied') is not False
        if applied:
            self.applied_revision += 1
        self.last_result = {'command_id': ident, 'applied': applied, 'status': 'visible' if applied else 'interrupted'}
        if ident is not None:
            self.pending.pop(ident)
        return {'applied': applied, 'revision': self.applied_revision}


def workspace(graph, rendered_revision=None):
    value = graph.voice_context(rendered_revision)
    if hasattr(graph, 'controls'):
        value['layout'] = graph.controls.context()
    return value
