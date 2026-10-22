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
            self.session._queue.append(({'type': 'add_edge', 'edge': {
                'id': f'edge-{i}', 'source': 'topic-1', 'target': 'detail'}}, 'meaning'))
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
        await self.session.ingest('Can you map out photosynthesis?')
        for chunk in ('Ooh, okay!', 'Photosynthesis.', 'Plants make food from light.'):
            await self.session.ingest(chunk, speaker='assistant')
        await asyncio.sleep(.05)
        self.assertEqual(calls[-1], 'You: Can you map out photosynthesis?\n'
                         'Cara: Ooh, okay! Photosynthesis. Plants make food from light.')

    async def test_cara_lines_only_feed_refinement_when_asked(self):
        calls = []
        async def interpret(text, graph):
            calls.append(text)
            return {'operations': []}
        self.session.classify, self.session.refine = None, interpret
        await self.session.ingest('I like tea')
        await self.session.ingest('Love that! What kind?', speaker='assistant')
        await asyncio.sleep(.05)
        self.assertEqual(calls, ['You: I like tea'])
        self.assertIn('Cara: Love that!', self.session.text)
        self.assertEqual(self.session.meaning_status, 'idle')
        await self.session.ingest('Please walk me through brewing')
        await self.session.ingest('First, heat water.', speaker='assistant')
        await asyncio.sleep(.05)
        self.assertEqual(calls[-1], 'You: I like tea Please walk me through brewing\nCara: First, heat water.')
        # The gate resets on the next user line.
        await self.session.ingest('nice')
        await self.session.ingest('Glad you liked it!', speaker='assistant')
        await asyncio.sleep(.05)
        self.assertNotIn('Glad', calls[-1])
        self.assertTrue(calls[-1].endswith('You: nice'))

    async def test_bounded_backlog_and_node_cap(self):
        for i in range(500):
            self.session._enqueue({'type': 'add_node', 'node': {'id': str(i), 'label': str(i)}}, 'meaning')
        self.assertEqual(len(self.session._desired), 80)
        import itertools
        for i, (a, b) in enumerate(itertools.islice(itertools.combinations(range(80), 2), 500)):
            self.session._enqueue({'type': 'add_edge', 'edge': {'id': str(i), 'source': str(a), 'target': str(b)}}, 'meaning')
        self.assertEqual(len(self.session._queue), 160)

    async def test_duplicate_edges_between_the_same_pair_are_dropped(self):
        for ident in 'ab':
            self.session._enqueue({'type': 'add_node', 'node': {'id': ident, 'label': ident.upper()}}, 'meaning')
        for edge in ({'id': 'e1', 'source': 'a', 'target': 'b'}, {'id': 'e2', 'source': 'a', 'target': 'b'},
                     {'id': 'e3', 'source': 'b', 'target': 'a'}, {'id': 'e4', 'source': 'a', 'target': 'a'}):
            self.session._enqueue({'type': 'add_edge', 'edge': edge}, 'meaning')
        await asyncio.sleep(.08)
        self.assertEqual(list(self.session.edges), ['e1'])
        self.session._enqueue({'type': 'add_edge', 'edge': {'id': 'e5', 'source': 'b', 'target': 'a'}}, 'meaning')
        self.assertFalse(any(op['type'] == 'add_edge' for op, _ in self.session._queue))

    async def test_near_duplicate_labels_merge_into_existing_card_and_remap(self):
        enqueue = self.session._enqueue_meaning
        enqueue({'type': 'add_node', 'node': {'id': 'model', 'label': 'Separate model for concepts and connections',
                                              'kind': 'idea', 'status': 'named'}}, {})
        enqueue({'type': 'add_node', 'node': {'id': 'model2', 'label': 'Separate models for concepts & connections!',
                                              'kind': 'idea', 'status': 'named', 'body': 'detail'}}, {})
        enqueue({'type': 'add_node', 'node': {'id': 'kid', 'label': 'Edges', 'kind': 'idea', 'status': 'named',
                                              'parent_id': 'model2'}}, {})
        desired = self.session._desired
        self.assertNotIn('model2', desired)
        self.assertEqual(desired['model']['body'], 'detail')
        self.assertEqual(desired['kid']['parent_id'], 'model')
        # A later response referencing the dropped id is remapped too.
        enqueue({'type': 'add_node', 'node': {'id': 'other', 'label': 'Other', 'kind': 'idea', 'status': 'named'}},
                {k: dict(v) for k, v in desired.items()})
        enqueue({'type': 'add_edge', 'edge': {'id': 'x', 'source': 'other', 'target': 'model2'}},
                {k: dict(v) for k, v in desired.items()})
        await asyncio.sleep(.15)
        self.assertEqual(len([n for n in self.session.nodes.values() if 'concept' in n['label'].lower()]), 1)
        self.assertIn('contains:model:kid', self.session.edges)
        self.assertEqual(self.session.edges['x']['target'], 'model')
        self.assertEqual(self.session._aliases,
                         {'model2': 'model'})

    async def test_reparent_moves_containment_edge_and_rejects_cycles(self):
        enqueue = self.session._enqueue_meaning
        node = lambda ident, label, parent=None: {'type': 'add_node', 'node': {
            'id': ident, 'label': label, 'kind': 'task', 'status': 'named', 'parent_id': parent}}
        enqueue(node('root', 'Baking cupcakes'), {})
        enqueue(node('mix', 'Mix dry', 'root'), {k: dict(v) for k, v in self.session._desired.items()})
        await asyncio.sleep(.08)
        self.assertIn('contains:root:mix', self.session.edges)
        basis = {k: dict(v) for k, v in self.session._desired.items()}
        enqueue(node('prep', 'Prep', 'root'), basis)
        basis = {k: dict(v) for k, v in self.session._desired.items()}
        enqueue({'type': 'update_node', 'node': {'id': 'mix', 'parent_id': 'prep'}}, basis)
        await asyncio.sleep(.12)
        self.assertEqual(self.session.nodes['mix']['parent_id'], 'prep')
        self.assertIn('contains:prep:mix', self.session.edges)
        self.assertNotIn('contains:root:mix', self.session.edges)
        removed = [e for e in self.events if e['type'] == 'graph_patch' and e['op']['type'] == 'remove_edge']
        self.assertEqual([e['op']['edge']['id'] for e in removed], ['contains:root:mix'])
        # Moving a section under its own child would create a cycle.
        basis = {k: dict(v) for k, v in self.session._desired.items()}
        enqueue({'type': 'update_node', 'node': {'id': 'prep', 'parent_id': 'mix'}}, basis)
        self.assertEqual(self.session._desired['prep']['parent_id'], 'root')

    async def test_label_dedupe_never_merges_into_lineage(self):
        enqueue = self.session._enqueue_meaning
        enqueue({'type': 'add_node', 'node': {'id': 'speech', 'label': 'Speech', 'kind': 'topic', 'status': 'named'}}, {})
        enqueue({'type': 'add_node', 'node': {'id': 'speech2', 'label': 'speeches', 'kind': 'idea', 'status': 'named',
                                              'parent_id': 'speech'}}, {})
        self.assertIn('speech2', self.session._desired)
        # Distinct ideas with low overlap stay separate cards.
        enqueue({'type': 'add_node', 'node': {'id': 'voice', 'label': 'Voice processing', 'kind': 'idea', 'status': 'named',
                                              'parent_id': 'speech'}}, {})
        enqueue({'type': 'add_node', 'node': {'id': 'both', 'label': 'Speech recognition and voice processing',
                                              'kind': 'idea', 'status': 'named'}}, {})
        self.assertIn('voice', self.session._desired)
        self.assertIn('both', self.session._desired)

    async def test_fast_classification_groups_and_colours_instantly(self):
        await self.session.ingest('We will talk about three topics')
        # Classified at enqueue time, before any provider call or patch.
        desired = self.session._desired
        self.assertEqual([desired[f'topic-{i}']['group'] for i in (1, 2, 3)], ['topic-1', 'topic-2', 'topic-3'])
        self.assertEqual([desired[f'topic-{i}']['palette'] for i in (1, 2, 3)], ['blue', 'green', 'teal'])
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
        self.assertEqual([desired[k]['palette'] for k in 'abc'], ['blue', 'green', 'teal'])
        # Sparse updates, model groups and hints for an existing group keep colours.
        self.session._enqueue({'type': 'update_node', 'node': {'id': 'c', 'label': 'C2', 'group': None}}, 'meaning')
        self.session._enqueue({'type': 'update_node', 'node': {'id': 'b', 'label': 'B2', 'palette': 'rose'}}, 'meaning')
        self.session._enqueue({'type': 'update_node', 'node': {'id': 'c', 'group': 'b'}}, 'meaning')
        self.assertEqual((desired['c']['group'], desired['c']['palette']), ('c', 'teal'))
        self.assertEqual(desired['b']['palette'], 'green')
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

    async def test_tree_colours_differ_across_branches_and_ignore_model_groups(self):
        enqueue = self.session._enqueue
        enqueue({'type': 'add_node', 'node': {'id': 'root', 'label': 'Voice app'}}, 'meaning')
        for branch in ('speech', 'ui', 'storage'):
            enqueue({'type': 'add_node', 'node': {'id': branch, 'label': branch, 'parent_id': 'root', 'group': 'same'}}, 'meaning')
            enqueue({'type': 'add_node', 'node': {'id': f'{branch}-a', 'label': f'{branch} a', 'parent_id': branch, 'group': 'same'}}, 'meaning')
            enqueue({'type': 'add_node', 'node': {'id': f'{branch}-b', 'label': f'{branch} b', 'parent_id': f'{branch}-a'}}, 'meaning')
        desired = self.session._desired
        self.assertEqual(desired['root']['palette'], 'blue')
        colours = [desired[b]['palette'] for b in ('speech', 'ui', 'storage')]
        self.assertEqual(len(set(colours)), 3)
        self.assertNotIn('blue', colours)
        for branch in ('speech', 'ui', 'storage'):
            self.assertEqual({desired[k]['group'] for k in (branch, f'{branch}-a', f'{branch}-b')}, {branch})
            self.assertEqual({desired[k]['palette'] for k in (branch, f'{branch}-a', f'{branch}-b')}, {desired[branch]['palette']})
        # A colour, once assigned, stays with its group.
        before = desired['ui']['palette']
        enqueue({'type': 'update_node', 'node': {'id': 'ui', 'label': 'Interface', 'palette': 'rose'}}, 'meaning')
        self.assertEqual(desired['ui']['palette'], before)

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
