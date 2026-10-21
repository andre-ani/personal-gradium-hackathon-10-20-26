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
        self.assertEqual(calls, ['You: same transcript'])
        entered.clear()
        release.clear()
        await self.session.request_refinement()
        await entered.wait()
        for _ in range(10):
            await self.session.request_refinement()
        self.assertEqual(calls, ['You: same transcript'] * 2)
        release.set()
        await asyncio.sleep(.04)
        self.assertEqual(calls, ['You: same transcript'] * 3)
        self.assertEqual(peak, 1)
        self.assertEqual(self.session.text, 'You: same transcript')

    async def test_transcript_tags_speakers_and_joins_streamed_chunks(self):
        await self.session.ingest('map out')
        await self.session.ingest('photosynthesis for me')
        await self.session.ingest('Ooh, okay!', speaker='assistant')
        await self.session.ingest('Photosynthesis.', speaker='assistant')
        await self.session.ingest('   ', speaker='user')
        await self.session.ingest('wait', speaker='user')
        self.assertEqual(self.session.text, 'You: map out photosynthesis for me\n'
                         'Cara: Ooh, okay! Photosynthesis.\nYou: wait')
        self.assertEqual(self.session.voice_context()['transcript'], self.session.text)
        with self.assertRaises(ValueError):
            await self.session.ingest('x', speaker='system')
        await self.session.reset()
        await self.session.ingest('fresh', speaker='assistant')
        self.assertEqual(self.session.text, 'Cara: fresh')

    async def test_assistant_counts_do_not_reserve_blank_slots(self):
        await self.session.ingest('Love those two ideas!', speaker='assistant')
        await asyncio.sleep(.05)
        self.assertEqual(self.session.nodes, {})
        await self.session.ingest('We will talk about two topics')
        await asyncio.sleep(.05)
        self.assertEqual(len(self.session.nodes), 2)

    async def test_assistant_text_uses_same_debounced_refinement(self):
        calls = []
        async def interpret(text, graph):
            calls.append(text)
            return {'operations': []}
        self.session.classify, self.session.refine = None, interpret
        for chunk in ('Ooh, okay!', 'Photosynthesis.', 'Plants make food from light.'):
            await self.session.ingest(chunk, speaker='assistant')
        await asyncio.sleep(.05)
        self.assertEqual(calls, ['Cara: Ooh, okay! Photosynthesis. Plants make food from light.'])

    async def test_bounded_backlog_and_node_cap(self):
        for i in range(500):
            self.session._enqueue({'type': 'add_node', 'node': {'id': str(i), 'label': str(i)}}, 'meaning')
        self.assertEqual(len(self.session._desired), 80)
        for i in range(500):
            self.session._enqueue({'type': 'add_edge', 'edge': {'id': str(i), 'source': '0', 'target': '1'}}, 'meaning')
        self.assertEqual(len(self.session._queue), 160)

    async def test_fast_classification_groups_and_colours_instantly(self):
        await self.session.ingest('We will talk about three topics')
        # Classified at enqueue time, before any provider call or patch.
        desired = self.session._desired
        self.assertEqual([desired[f'topic-{i}']['group'] for i in (1, 2, 3)], ['topic-1', 'topic-2', 'topic-3'])
        self.assertEqual([desired[f'topic-{i}']['palette'] for i in (1, 2, 3)], ['blue', 'teal', 'green'])
        basis = {key: dict(node) for key, node in desired.items()}
        self.session._enqueue_meaning({'type': 'add_node', 'node': {
            'id': 'contrast', 'label': 'Contrast', 'parent_id': 'topic-2'}}, basis)
        # A root's direct child is its own branch, so it gets the next colour.
        self.assertEqual((desired['contrast']['group'], desired['contrast']['palette']), ('contrast', 'ochre'))
        await asyncio.sleep(.08)
        patched = {e['op']['node']['id']: e['op']['node'] for e in self.events
                   if e['type'] == 'graph_patch' and 'node' in e['op']}
        self.assertEqual(patched['contrast']['palette'], 'ochre')
        self.assertEqual(self.session.snapshot()['nodes'][0]['palette'], 'blue')
        # The parent-child edge still follows the classified child.
        self.assertIn('contains:topic-2:contrast', self.session.edges)

    async def test_group_colours_never_flicker_and_refinement_can_regroup(self):
        self.session._enqueue({'type': 'add_node', 'node': {'id': 'a', 'label': 'A'}}, 'meaning')
        self.session._enqueue({'type': 'add_node', 'node': {'id': 'b', 'label': 'B'}}, 'meaning')
        self.session._enqueue({'type': 'add_node', 'node': {'id': 'c', 'label': 'C', 'parent_id': 'a'}}, 'meaning')
        desired = self.session._desired
        self.assertEqual([desired[k]['palette'] for k in 'abc'], ['blue', 'teal', 'green'])
        # Sparse updates, null groups and hints for an existing group keep colours.
        self.session._enqueue({'type': 'update_node', 'node': {'id': 'c', 'label': 'C2', 'group': None}}, 'meaning')
        self.session._enqueue({'type': 'update_node', 'node': {'id': 'b', 'label': 'B2', 'palette': 'rose'}}, 'meaning')
        self.assertEqual((desired['c']['group'], desired['c']['palette']), ('c', 'green'))
        self.assertEqual(desired['b']['palette'], 'teal')
        # An explicit regroup moves the card into the other group's colour.
        self.session._enqueue({'type': 'update_node', 'node': {'id': 'c', 'group': 'b'}}, 'meaning')
        self.assertEqual((desired['c']['group'], desired['c']['palette']), ('b', 'teal'))
        # A new group honours an unused hint; blue stays reserved for the first group.
        self.session._enqueue({'type': 'add_node', 'node': {'id': 'd', 'label': 'D', 'palette': 'plum'}}, 'meaning')
        self.session._enqueue({'type': 'add_node', 'node': {'id': 'e', 'label': 'E', 'palette': 'blue'}}, 'meaning')
        self.assertEqual(desired['d']['palette'], 'plum')
        self.assertNotEqual(desired['e']['palette'], 'blue')
        for i in range(12):
            self.session._enqueue({'type': 'add_node', 'node': {'id': f'r{i}', 'label': str(i)}}, 'meaning')
        self.assertEqual([n['palette'] for n in desired.values()].count('blue'), 1)
        await self.session.reset()
        self.session._enqueue({'type': 'add_node', 'node': {'id': 'z', 'label': 'Z'}}, 'meaning')
        self.assertEqual(self.session._desired['z']['palette'], 'blue')

    async def test_branches_get_their_own_colour_and_deeper_cards_inherit_it(self):
        self.session._enqueue({'type': 'add_node', 'node': {'id': 'root', 'label': 'Root'}}, 'meaning')
        self.session._enqueue({'type': 'add_node', 'node': {'id': 'loose', 'label': 'Loose'}}, 'meaning')
        self.session._enqueue({'type': 'update_node', 'node': {'id': 'loose', 'parent_id': 'root'}}, 'meaning')
        desired = self.session._desired
        self.assertEqual(desired['loose']['group'], 'loose')
        self.assertNotEqual(desired['loose']['palette'], 'blue')
        self.session._enqueue({'type': 'add_node', 'node': {'id': 'leaf', 'label': 'Leaf', 'parent_id': 'loose'}}, 'meaning')
        self.assertEqual((desired['leaf']['group'], desired['leaf']['palette']), ('loose', desired['loose']['palette']))
        # A refinement can't fold a branch back into its root's colour.
        self.session._enqueue({'type': 'update_node', 'node': {'id': 'loose', 'group': 'root'}}, 'meaning')
        self.assertEqual(desired['loose']['group'], 'loose')

    async def test_loose_near_node_has_own_group_distinct_colour_and_no_edge(self):
        enqueue = self.session._enqueue_meaning
        enqueue({'type': 'add_node', 'node': {'id': 'party', 'label': 'Garden party', 'kind': 'topic', 'status': 'named'}}, {})
        enqueue({'type': 'add_node', 'node': {'id': 'food', 'label': 'Food', 'kind': 'idea', 'status': 'named', 'parent_id': 'party'}}, {})
        basis = {key: dict(node) for key, node in self.session._desired.items()}
        enqueue({'type': 'add_node', 'node': {'id': 'lemonade', 'label': 'Lemonade', 'kind': 'idea', 'status': 'named',
                                              'near': 'food', 'group': 'food'}}, basis)
        desired = self.session._desired
        self.assertEqual(desired['lemonade']['near'], 'food')
        self.assertEqual(desired['lemonade']['group'], 'lemonade')
        self.assertNotEqual(desired['lemonade']['palette'], desired['food']['palette'])
        self.assertNotIn('parent_id', desired['lemonade'])
        for _ in range(100):
            if not self.session._queue:
                break
            await asyncio.sleep(.01)
        await asyncio.sleep(.02)
        self.assertEqual(self.session.nodes['lemonade']['near'], 'food')
        self.assertFalse(any(e['target'] == 'lemonade' for e in self.session.edges.values()))
        self.assertIn('contains:party:food', self.session.edges)
        # Unknown neighbours and near beside a parent are dropped.
        self.session._enqueue({'type': 'add_node', 'node': {'id': 'x', 'label': 'X', 'near': 'missing'}}, 'meaning')
        self.session._enqueue({'type': 'add_node', 'node': {'id': 'y', 'label': 'Y', 'parent_id': 'party', 'near': 'food'}}, 'meaning')
        self.assertNotIn('near', desired['x'])
        self.assertNotIn('near', desired['y'])

    async def test_loose_near_colour_avoids_neighbour_when_palette_is_exhausted(self):
        for i in range(9):
            self.session._enqueue({'type': 'add_node', 'node': {'id': f'n{i}', 'label': f'N{i}'}}, 'meaning')
        neighbour = self.session._desired['n8']['palette']
        self.session._enqueue({'type': 'add_node', 'node': {'id': 'loose', 'label': 'Loose', 'kind': 'idea', 'near': 'n8', 'palette': neighbour}}, 'meaning')
        self.assertNotEqual(self.session._desired['loose']['palette'], neighbour)

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
