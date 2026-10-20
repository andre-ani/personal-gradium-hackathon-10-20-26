import asyncio
import unittest
from graph_engine import GraphSession


async def classify(text, graph):
    return {'needs_refinement': False}


async def refine(text, graph):
    return {'operations': []}


class GraphTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.events = []
        self.session = GraphSession(self.events.append, classify=classify, refine=refine,
                                    heartbeat=.01, semantic_delay=.01)
        await self.session.start()

    async def asyncTearDown(self):
        await self.session.close()

    async def test_slots_arrive_sequentially_and_labels_keep_ids(self):
        await self.session.ingest('We will talk about three topics')
        self.assertEqual(self.session.snapshot()['nodes'], [])
        await asyncio.sleep(.016)
        self.assertEqual(len(self.session.snapshot()['nodes']), 1)
        await asyncio.sleep(.03)
        ids = [n['id'] for n in self.session.snapshot()['nodes']]
        self.assertEqual(len(ids), 3)
        await self.session.ingest('first apples second oranges third pears')
        await asyncio.sleep(.04)
        nodes = self.session.snapshot()['nodes']
        self.assertEqual([n['id'] for n in nodes], ids)
        self.assertEqual([n['label'] for n in nodes], ['apples', 'oranges', 'pears'])
        patches = [e for e in self.events if e['type'] == 'graph_patch']
        self.assertEqual([e['revision'] for e in patches], list(range(1, 7)))

    async def test_explicit_list_and_repeated_replace_do_not_duplicate(self):
        for _ in range(10):
            await self.session.ingest('topics: apples, oranges, and pears', mode='replace')
        await asyncio.sleep(.04)
        self.assertEqual([n['label'] for n in self.session.snapshot()['nodes']], ['apples', 'oranges', 'pears'])

    async def test_stale_refinement_is_discarded(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def yes(text, graph):
            return {'needs_refinement': True}
        async def slow(text, graph):
            entered.set()
            await release.wait()
            return {'operations': [{'type': 'add_node', 'node': {'id': 'stale', 'label': 'old'}}]}
        self.session.classify, self.session.refine = yes, slow
        await self.session.ingest('old')
        await entered.wait()
        await self.session.reset()
        release.set()
        await asyncio.sleep(.04)
        self.assertEqual(self.session.snapshot()['nodes'], [])

    async def test_prefix_meaning_lands_during_continued_append_without_overwriting_labels(self):
        entered, release = asyncio.Event(), asyncio.Event()
        calls = []
        async def yes(text, graph):
            calls.append(text)
            return {'needs_refinement': True}
        async def slow(text, graph):
            entered.set()
            await release.wait()
            return {'operations': [
                {'type': 'update_node', 'node': {'id': 'topic-1', 'label': 'old guess'}},
                {'type': 'add_node', 'node': {'id': 'detail', 'label': 'Prefix meaning'}}]}
        self.session.classify, self.session.refine = yes, slow
        await self.session.ingest('three topics')
        await entered.wait()
        await self.session.ingest('first apples.')
        release.set()
        for _ in range(5):
            await self.session.ingest('continued speech')
            await asyncio.sleep(.015)
        nodes = {n['id']: n for n in self.session.snapshot()['nodes']}
        self.assertEqual(nodes['topic-1']['label'], 'apples')
        self.assertEqual(nodes['topic-1']['status'], 'named')
        self.assertEqual(nodes['detail']['status'], 'provisional')
        self.assertEqual(len(calls), len(set(calls)))

    async def test_replace_invalidates_inflight_prefix(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def yes(text, graph):
            return {'needs_refinement': True}
        async def slow(text, graph):
            entered.set()
            await release.wait()
            return {'operations': [{'type': 'add_node', 'node': {'id': 'stale', 'label': 'old'}}]}
        self.session.classify, self.session.refine = yes, slow
        await self.session.ingest('old')
        await entered.wait()
        # Disable later refinements so this assertion isolates the old call.
        self.session.classify = classify
        await self.session.ingest('new correction', mode='replace')
        release.set()
        await asyncio.sleep(.04)
        self.assertEqual(self.session.snapshot()['nodes'], [])

    async def test_explicit_parent_emits_child_then_edge_sequentially(self):
        await self.session.ingest('one topic')
        await asyncio.sleep(.02)
        basis = {key: dict(node) for key, node in self.session._desired.items()}
        op = {'type': 'add_node', 'node': {
            'id': 'detail', 'label': 'Detail', 'parent_id': 'topic-1'}}
        self.session._enqueue_meaning(op, basis)
        self.assertEqual(len(self.session._queue), 2)
        await asyncio.sleep(.035)
        patches = [e for e in self.events if e['type'] == 'graph_patch' and e['layer'] == 'meaning']
        self.assertEqual([e['op']['type'] for e in patches], ['add_node', 'add_edge'])
        self.assertEqual(patches[1]['revision'], patches[0]['revision'] + 1)
        self.assertIn('detail', self.session.nodes)
        edge = next(iter(self.session.edges.values()))
        self.assertEqual((edge['source'], edge['target']), ('topic-1', 'detail'))
        basis = {key: dict(node) for key, node in self.session._desired.items()}
        self.session._enqueue_meaning(op, basis)
        self.assertEqual(len(self.session._queue), 0)
        # A full backlog rejects the pair rather than leaving a detached child.
        for i in range(159):
            self.session._enqueue({'type': 'add_edge', 'edge': {
                'id': f'edge-{i}', 'source': 'topic-1', 'target': 'detail'}}, 'meaning')
        self.session._enqueue_meaning({'type': 'add_node', 'node': {
            'id': 'overflow', 'label': 'Overflow', 'parent_id': 'topic-1'}}, basis)
        self.assertNotIn('overflow', self.session._desired)
        self.assertLessEqual(len(self.session._queue), 160)

    async def test_explicit_recheck_same_text_is_coalesced_and_serial(self):
        calls = []
        active = 0
        peak = 0
        entered, release = asyncio.Event(), asyncio.Event()
        async def blocked(text, graph):
            nonlocal active, peak
            calls.append(text)
            active += 1
            peak = max(peak, active)
            entered.set()
            await release.wait()
            active -= 1
            return {'needs_refinement': False}
        self.session.classify = blocked
        await self.session.ingest('same transcript')
        await entered.wait()
        release.set()
        await asyncio.sleep(.02)
        self.assertEqual(calls, ['same transcript'])
        entered.clear()
        release.clear()
        await self.session.request_refinement()
        await entered.wait()
        for _ in range(10):
            await self.session.request_refinement()
        self.assertEqual(calls, ['same transcript', 'same transcript'])
        release.set()
        await asyncio.sleep(.04)
        self.assertEqual(calls, ['same transcript'] * 3)
        self.assertEqual(peak, 1)
        self.assertEqual(self.session.text, 'same transcript')

    async def test_bounded_backlog_and_node_cap(self):
        for i in range(500):
            self.session._enqueue({'type': 'add_node', 'node': {'id': str(i), 'label': str(i)}}, 'meaning')
        self.assertEqual(len(self.session._desired), 80)
        for i in range(500):
            self.session._enqueue({'type': 'add_edge', 'edge': {'id': str(i), 'source': '0', 'target': '1'}}, 'meaning')
        self.assertEqual(len(self.session._queue), 160)

    async def test_ingestion_continues_during_provider_call(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def blocked(text, graph):
            entered.set()
            await release.wait()
            return {'needs_refinement': False}
        self.session.classify = blocked
        await self.session.ingest('hello')
        await entered.wait()
        await asyncio.wait_for(self.session.ingest('three topics'), .05)
        await asyncio.sleep(.04)
        self.assertEqual(len(self.session.snapshot()['nodes']), 3)
        release.set()


if __name__ == '__main__':
    unittest.main()
