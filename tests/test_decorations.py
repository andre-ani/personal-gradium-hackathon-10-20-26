import asyncio
import unittest

from graph_engine import GraphSession


class DecorationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.events = []
        self.graph = GraphSession(self.events.append, classify=lambda *_: None,
                                  heartbeat=.001)
        self.graph._enqueue({'type': 'add_node', 'node': {
            'id': 'tea', 'label': 'Tea station', 'kind': 'idea', 'status': 'named'}}, 'meaning')
        self.pump = asyncio.create_task(self.graph._pump())
        await asyncio.sleep(.01)

    async def asyncTearDown(self):
        self.pump.cancel()
        await asyncio.gather(self.pump, return_exceptions=True)

    def receipt(self, **changes):
        return dict(type='decoration_applied', node_id='tea', level=1,
                    node_revision=self.graph.node_revisions['tea'],
                    rendered_revision=self.graph.revision, **changes)

    async def test_completed_receipts_are_server_named_deduped_and_cooldown_bounded(self):
        receipt = self.receipt()
        receipt['label'] = 'client lie'
        event = self.graph.decoration_applied(receipt)
        self.assertEqual(event['label'], 'Tea station')
        self.assertIsNone(self.graph.decoration_applied(receipt))
        self.assertEqual(self.graph.voice_context()['completed_decorations'], [event])
        self.assertEqual(self.graph.claim_decoration_reaction(100), event)
        receipt['level'] = 2
        second = self.graph.decoration_applied(receipt)
        self.assertIsNotNone(second)
        self.assertIsNone(self.graph.claim_decoration_reaction(144))
        self.assertEqual(self.graph.claim_decoration_reaction(145), second)
        self.assertIsNone(self.graph.claim_decoration_reaction(190))
        await self.graph.reset()
        self.assertEqual(self.graph.voice_context()['completed_decorations'], [])
        self.assertIsNone(self.graph.decoration_applied(receipt))

    async def test_semantic_changes_and_relationships_invalidate_but_geometry_does_not(self):
        original = self.receipt()
        self.graph.decoration_applied(original)
        self.graph._enqueue({'type':'update_node', 'node':{'id':'tea', 'x':200, 'illustration':{'url':'test'}}}, 'illustration')
        await asyncio.sleep(.01)
        self.assertEqual(self.graph.node_revisions['tea'], original['node_revision'])
        self.assertIn('tea', self.graph.decorations)
        self.graph._enqueue({'type':'update_node','node':{'id':'tea','label':'Breakfast station'}}, 'meaning')
        self.assertIsNone(self.graph.decoration_applied(dict(original, level=2)))
        await asyncio.sleep(.01)
        self.assertNotIn('tea', self.graph.decorations)
        self.assertIsNone(self.graph.decoration_applied(original))
        self.graph._enqueue({'type':'add_node','node':{'id':'walking','label':'Fewer trips','status':'named'}}, 'meaning')
        await asyncio.sleep(.01)
        current = self.receipt()
        self.graph.decoration_applied(current)
        self.graph._enqueue({'type':'add_edge','edge':{'id':'link','source':'tea','target':'walking','label':'reduces'}}, 'meaning')
        self.assertIsNone(self.graph.decoration_applied(dict(current, level=2)))
        await asyncio.sleep(.01)
        self.assertNotIn('tea', self.graph.decorations)
        self.assertEqual(set(self.events[-1]['node_revisions']), {'tea', 'walking'})

    async def test_rejects_unknown_levels_stale_revisions_and_caps_nodes(self):
        original = self.receipt()
        for change in ({'node_id':'missing'}, {'level':True}, {'level':2}, {'level':3},
                       {'node_revision':0}, {'rendered_revision':999}):
            self.assertIsNone(self.graph.decoration_applied(dict(original, **change)))
        self.assertIsNotNone(self.graph.decoration_applied(original))
        for i in range(6):
            ident = f'node{i}'
            node = {'id':ident, 'label':ident, 'status':'named'}
            self.graph.nodes[ident] = self.graph._desired[ident] = node
            self.graph.node_revisions[ident] = self.graph.revision
            accepted = self.graph.decoration_applied(dict(original, node_id=ident))
            self.assertEqual(accepted is not None, i < 5)
        self.assertEqual(len(self.graph.decorations), 6)
