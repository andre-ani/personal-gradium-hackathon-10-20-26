import asyncio
import unittest

from graph_engine import GraphSession


class GraphEditingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.events = []
        self.session = GraphSession(self.events.append, heartbeat=.005, semantic_delay=.005,
                                    classify=lambda *_: {'needs_refinement': False},
                                    refine=lambda *_: {'operations': []})
        await self.session.start()

    async def asyncTearDown(self):
        await self.session.close()

    async def _nodes(self, *nodes):
        for node in nodes:
            self.session._enqueue({'type': 'add_node', 'node': node}, 'meaning')
        await asyncio.sleep(.025)

    async def test_rename_reparent_and_edge_edits_are_immediate(self):
        await self._nodes({'id': 'root', 'label': 'Root'},
                          {'id': 'child', 'label': 'Child', 'parent_id': 'root'},
                          {'id': 'other', 'label': 'Other'})
        self.session._enqueue({'type': 'add_edge', 'edge': {
            'id': 'old-link', 'source': 'root', 'target': 'child', 'label': 'contains'}}, 'meaning')
        await asyncio.sleep(.01)

        result = await self.session.edit([
            {'type': 'update_node', 'node': {
                'id': 'child', 'label': 'Renamed child', 'body': 'More detail', 'parent_id': 'other'}},
            {'type': 'add_edge', 'edge': {'id': 'new-link', 'source': 'child', 'target': 'root', 'label': 'relates'}},
            {'type': 'remove_edge', 'edge': {'id': 'old-link'}},
        ])

        self.assertEqual(result['applied'], 3)
        self.assertEqual(self.session.nodes['child']['label'], 'Renamed child')
        self.assertEqual(self.session.nodes['child']['parent_id'], 'other')
        self.assertNotIn('old-link', self.session.edges)
        self.assertIn('new-link', self.session.edges)
        self.assertNotIn('contains:root:child', self.session.edges)
        self.assertIn('contains:other:child', self.session.edges)
        patches = [event['op']['type'] for event in self.events if event['type'] == 'graph_patch']
        self.assertIn('update_node', patches)
        self.assertIn('remove_edge', patches)
        self.assertIn('add_edge', patches)

    async def test_remove_node_cleans_edges_and_orphan_references(self):
        await self._nodes({'id': 'root', 'label': 'Root'},
                          {'id': 'child', 'label': 'Child', 'parent_id': 'root'},
                          {'id': 'nearby', 'label': 'Nearby', 'near': 'root'})
        self.session._enqueue({'type': 'add_edge', 'edge': {
            'id': 'link', 'source': 'root', 'target': 'nearby'}}, 'meaning')
        await asyncio.sleep(.01)

        await self.session.edit([{'type': 'remove_node', 'node': {'id': 'root'}}])

        self.assertNotIn('root', self.session.nodes)
        self.assertNotIn('root', self.session._desired)
        self.assertIsNone(self.session.nodes['child'].get('parent_id'))
        self.assertIsNone(self.session.nodes['child'].get('near'))
        self.assertIsNone(self.session.nodes['nearby'].get('near'))
        self.assertFalse(any(root in (edge.get('source'), edge.get('target'))
                             for edge in self.session.edges.values() for root in ('root',)))
        patch_types = [event['op']['type'] for event in self.events if event['type'] == 'graph_patch']
        self.assertIn('remove_node', patch_types)
        self.assertIn('remove_edge', patch_types)

    async def test_invalid_batch_is_atomic(self):
        await self._nodes({'id': 'a', 'label': 'A'}, {'id': 'b', 'label': 'B'})
        before_nodes = {ident: dict(node) for ident, node in self.session.nodes.items()}
        before_edges = {ident: dict(edge) for ident, edge in self.session.edges.items()}
        before_revision = self.session.revision
        before_events = len(self.events)

        with self.assertRaises(ValueError):
            await self.session.edit([
                {'type': 'update_node', 'node': {'id': 'a', 'label': 'Changed'}},
                {'type': 'add_edge', 'edge': {'id': 'loop', 'source': 'b', 'target': 'b'}},
            ])

        self.assertEqual(self.session.nodes, before_nodes)
        self.assertEqual(self.session.edges, before_edges)
        self.assertEqual(self.session.revision, before_revision)
        self.assertEqual(len(self.events), before_events)

    async def test_cycle_rejection_is_atomic(self):
        await self._nodes({'id': 'a', 'label': 'A'}, {'id': 'b', 'label': 'B'})
        with self.assertRaises(ValueError):
            await self.session.edit([
                {'type': 'update_node', 'node': {'id': 'a', 'parent_id': 'b'}},
                {'type': 'update_node', 'node': {'id': 'b', 'parent_id': 'a'}},
            ])
        self.assertIsNone(self.session.nodes['a'].get('parent_id'))
        self.assertIsNone(self.session.nodes['b'].get('parent_id'))

    async def test_stale_semantic_result_cannot_resurrect_deleted_node(self):
        entered, release = asyncio.Event(), asyncio.Event()

        async def refine(text, graph):
            entered.set()
            await release.wait()
            return {'operations': [{'type': 'add_node', 'node': {'id': 'gone', 'label': 'Old result'}}]}

        self.session.classify = None
        self.session.refine = refine
        await self._nodes({'id': 'gone', 'label': 'Current'})
        await self.session.ingest('start a slow interpretation')
        await entered.wait()
        await self.session.edit([{'type': 'remove_node', 'node': {'id': 'gone'}}])
        release.set()
        await asyncio.sleep(.03)

        self.assertNotIn('gone', self.session.nodes)
        self.assertNotIn('gone', self.session._desired)


if __name__ == '__main__':
    unittest.main()
