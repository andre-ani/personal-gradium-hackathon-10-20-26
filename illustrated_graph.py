"""Illustrations join the existing graph queue only after a named node is sent."""
from graph_engine import GraphSession
from illustrations import GraphIllustrations, IllustrationService, concept_key

_service = None


def default_service():
    global _service
    if _service is None:
        _service = IllustrationService()
    return _service


class IllustratedGraphSession(GraphSession):
    def __init__(self, send, *, illustration_service=None, illustration_settle=4.0, **kwargs):
        super().__init__(send, **kwargs)
        self.illustrations = GraphIllustrations(self._illustrated, illustration_service or default_service(), illustration_settle)

    def _illustrated(self, ident, result):
        node = self._desired.get(ident)
        if self._closed or not node or concept_key(node) != result['concept']:
            return
        self._enqueue({'type': 'update_node', 'node': {'id': ident, 'illustration': result}}, 'illustration')

    def _enqueue(self, op, layer):
        if op.get('node') and op.get('type') in ('add_node', 'update_node'):
            ident = op['node'].get('id')
            old = self._desired.get(ident, {})
            updated = dict(old, **op['node'])
            if concept_key(old) != concept_key(updated):
                op = dict(op, node=dict(op['node'], illustration=None))
                # Invalidate immediately, even while an earlier patch is queued.
                self.illustrations.latest[ident] = ''
        super()._enqueue(op, layer)

    def _enqueue_meaning(self, op, basis):
        # Finishing a picture must not invalidate an in-flight interpretation.
        basis = dict(basis)
        for ident, node in basis.items():
            current = self._desired.get(ident, {})
            if {k: v for k, v in node.items() if k != 'illustration'} == {k: v for k, v in current.items() if k != 'illustration'}:
                basis[ident] = current
        super()._enqueue_meaning(op, basis)

    async def _emit(self, event):
        await super()._emit(event)
        if event.get('type') == 'graph_patch' and event.get('layer') != 'illustration':
            node = event['op'].get('node')
            if node:
                self.illustrations.offer(node)

    async def reset(self):
        self.illustrations.reset()
        await super().reset()

    async def close(self):
        await self.illustrations.close()
        await super().close()
