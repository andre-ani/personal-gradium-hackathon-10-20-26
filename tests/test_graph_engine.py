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

    async def test_slots_arrive_sequentially_but_speech_is_not_copied(self):
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
        self.assertEqual([n['label'] for n in nodes], ['Topic 1', 'Topic 2', 'Topic 3'])
        patches = [e for e in self.events if e['type'] == 'graph_patch']
        self.assertEqual([e['revision'] for e in patches], list(range(1, 4)))

    async def test_list_fragments_wait_for_interpretation_instead_of_becoming_labels(self):
        for _ in range(10):
            await self.session.ingest('topics: apples, oranges, and pears', mode='replace')
        await asyncio.sleep(.04)
        self.assertEqual(self.session.snapshot()['nodes'], [])

    async def test_interpreter_names_and_revises_existing_concepts_without_jev(self):
        calls = []
        async def interpret(text, graph):
            calls.append(text)
            label = 'Tea station' if len(calls) == 1 else 'Breakfast station'
            return {'operations': [{'type': 'update_node', 'node': {
                'id': 'topic-1', 'label': label, 'kind': 'idea', 'status': 'named'}}]}
        self.session.classify, self.session.refine = None, interpret
        await self.session.ingest('One idea: I keep walking back and forth to get all the things for tea.')
        await asyncio.sleep(.05)
        self.assertEqual(self.session.nodes['topic-1']['label'], 'Tea station')
        await self.session.ingest('Actually it would help with making breakfast too.')
        await asyncio.sleep(.05)
        self.assertEqual(self.session.nodes['topic-1']['label'], 'Breakfast station')
        self.assertEqual(len(self.session.nodes), 1)

    async def test_voice_context_separates_visible_pending_and_failed_interpretation(self):
        await self.session.ingest('one topic')
        context = self.session.voice_context(0)
        self.assertEqual(context['canvas']['nodes'], [])
        self.assertEqual(context['pending_nodes'][0]['id'], 'topic-1')
        self.assertEqual(context['interpretation_status'], 'pending')
        await asyncio.sleep(.03)
        self.session.nodes['topic-1']['illustration'] = {'data': 'large image payload'}
        await self.session._emit({'type': 'graph_status', 'status': 'unavailable', 'message': 'Cannot interpret yet.'})
        context = self.session.voice_context(0)
        self.assertEqual(context['rendered_revision'], 0)
        self.assertEqual(context['canvas']['revision'], 1)
        self.assertNotIn('illustration', context['canvas']['nodes'][0])
        self.assertEqual(context['interpretation_message'], 'Cannot interpret yet.')
        await self.session.reset()
        self.assertEqual(self.session.voice_context()['transcript'], '')
        self.assertEqual(self.session.voice_context()['interpretation_status'], 'idle')

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
            first_call = len(calls) == 1
            entered.set()
            await release.wait()
            operations = [{'type': 'add_node', 'node': {'id': 'detail', 'label': 'Prefix meaning'}}]
            if first_call:
                operations.insert(0, {'type': 'update_node', 'node': {'id': 'topic-1', 'label': 'old guess'}})
            return {'operations': operations}
        self.session.classify, self.session.refine = yes, slow
        await self.session.ingest('three topics')
        await entered.wait()
        await self.session.ingest('first apples.')
        # A newer interpretation owns this label; the old result must not undo it.
        self.session._enqueue({'type': 'update_node', 'node': {
            'id': 'topic-1', 'label': 'apples', 'status': 'named'}}, 'meaning')
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
