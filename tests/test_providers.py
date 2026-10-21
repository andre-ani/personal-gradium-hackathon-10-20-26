"""Local HTTP contract checks; no external provider requests."""
import asyncio
import json
import unittest

from aiohttp import web

from providers import ProviderUnavailable, _post


class ProviderResponseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.app = web.Application()
        self.runners = []

    async def asyncTearDown(self):
        for runner in self.runners:
            await runner.cleanup()

    async def serve(self, handler):
        self.app.router.add_post('/response', handler)
        runner = web.AppRunner(self.app)
        self.runners.append(runner)
        await runner.setup()
        site = web.TCPSite(runner, '127.0.0.1', 0)
        await site.start()
        port = runner.addresses[0][1]
        return f'http://127.0.0.1:{port}/response'

    async def test_waits_for_all_json_chunks(self):
        async def handler(request):
            response = web.StreamResponse(headers={'Content-Type': 'application/json'})
            await response.prepare(request)
            for chunk in (b'{"choices":', b'[{"message":', b'{"content":"complete"}}]}'):
                await response.write(chunk)
                await asyncio.sleep(.02)
            await response.write_eof()
            return response

        url = await self.serve(handler)
        result = await _post(url, 'local-test-key', {}, 2)
        self.assertEqual(result['choices'][0]['message']['content'], 'complete')

    async def test_rejects_response_over_limit(self):
        async def handler(request):
            return web.Response(body=b'{"value":"' + b'x' * 131072 + b'"}')

        url = await self.serve(handler)
        with self.assertRaisesRegex(ProviderUnavailable, 'size limit'):
            await _post(url, 'local-test-key', {}, 2)

    async def test_rejects_incomplete_json_without_response_body(self):
        async def handler(request):
            return web.Response(body=b'{"secret":"not-to-be-printed')

        url = await self.serve(handler)
        with self.assertRaisesRegex(ProviderUnavailable, '^Provider returned an invalid response.$'):
            await _post(url, 'local-test-key', {}, 2)


class RefinementContractTests(unittest.TestCase):
    def setUp(self):
        self.graph = {'nodes': [{'id': 'topic-1', 'label': 'Topic 1', 'kind': 'topic', 'status': 'placeholder'}]}

    def parse(self, operation):
        from providers import _parse_refinement
        return _parse_refinement({'operations': [operation], 'question': None}, self.graph)['operations'][0]

    def test_repeated_add_becomes_update(self):
        result = self.parse({'type': 'add_node', 'node': {'id': 'topic-1', 'label': 'Launch plan', 'kind': 'topic', 'status': 'named'}})
        self.assertEqual(result['type'], 'update_node')

    def test_sparse_update_preserves_known_fields(self):
        result = self.parse({'type': 'update_node', 'node': {'id': 'topic-1', 'label': 'Launch plan'}})
        self.assertEqual(result['node'], {'id': 'topic-1', 'label': 'Launch plan', 'kind': 'topic', 'status': 'placeholder'})

    def test_rejects_transcript_sized_labels_and_matches_wire_limit(self):
        from providers import REFINEMENT_SCHEMA
        with self.assertRaises(ProviderUnavailable):
            self.parse({'type': 'update_node', 'node': {'id': 'topic-1', 'label': 'x' * 81}})
        node_schema = REFINEMENT_SCHEMA['properties']['operations']['items']['anyOf'][0]['properties']['node']
        self.assertEqual(node_schema['properties']['label']['maxLength'], 80)

    def test_rejects_invalid_ids_references_and_delete(self):
        for operation in [
            {'type': 'update_node', 'node': {'id': '../bad', 'label': 'x'}},
            {'type': 'update_node', 'node': {'id': 'missing', 'label': 'x'}},
            {'type': 'add_edge', 'edge': {'id': 'edge', 'source': 'topic-1', 'target': 'missing'}},
            {'type': 'update_node', 'node': {'id': 'topic-1', 'parent_id': 'missing'}},
            {'type': 'delete_node', 'node': {'id': 'topic-1'}},
        ]:
            with self.subTest(operation=operation), self.assertRaises(ProviderUnavailable):
                self.parse(operation)

    def test_model_group_is_ignored_and_palette_hint_validated(self):
        result = self.parse({'type': 'add_node', 'node': {'id': 'child', 'label': 'Child', 'kind': 'idea',
                             'status': 'named', 'parent_id': 'topic-1', 'group': 'topic-1', 'palette': None}})
        self.assertNotIn('group', result['node'])
        self.assertNotIn('palette', result['node'])
        result = self.parse({'type': 'update_node', 'node': {'id': 'topic-1', 'palette': 'teal'}})
        self.assertEqual(result['node']['palette'], 'teal')
        # An invalid hint is dropped rather than failing the whole refinement.
        result = self.parse({'type': 'update_node', 'node': {'id': 'topic-1', 'palette': 'neon'}})
        self.assertNotIn('palette', result['node'])

    def test_engine_aliases_resolve_to_the_kept_card(self):
        from providers import _parse_refinement
        graph = dict(self.graph, aliases={'dupe': 'topic-1'})
        ops = _parse_refinement({'operations': [
            {'type': 'add_node', 'node': {'id': 'kid', 'label': 'Kid', 'kind': 'idea', 'status': 'named', 'parent_id': 'dupe'}},
            {'type': 'add_edge', 'edge': {'id': 'e', 'source': 'dupe', 'target': 'kid', 'label': None}},
        ], 'question': None}, graph)['operations']
        self.assertEqual(ops[0]['node']['parent_id'], 'topic-1')
        self.assertEqual(ops[1]['edge']['source'], 'topic-1')

    def test_schema_stays_simple_enough_for_gemini(self):
        # Gemini rejects schemas with too many states; classification hints stay loose strings.
        from providers import _NODE_SCHEMA
        for field in ('near', 'palette'):
            self.assertEqual(_NODE_SCHEMA['properties'][field], {'type': ['string', 'null'], 'maxLength': _NODE_SCHEMA['properties'][field]['maxLength']})
        self.assertEqual(_NODE_SCHEMA['properties']['near']['maxLength'], 80)
        self.assertNotIn('group', _NODE_SCHEMA['properties'])
        self.assertEqual(len(_NODE_SCHEMA['properties']), 7)

    def test_near_hint_is_validated_and_dropped_when_invalid(self):
        result = self.parse({'type': 'add_node', 'node': {'id': 'lemonade', 'label': 'Lemonade', 'kind': 'idea',
                             'status': 'named', 'parent_id': None, 'near': 'topic-1', 'group': None, 'palette': None}})
        self.assertEqual(result['node']['near'], 'topic-1')
        self.assertNotIn('parent_id', result['node'])
        for near in ('missing', '../x', 'lemonade', 7, None, ''):
            with self.subTest(near=near):
                result = self.parse({'type': 'add_node', 'node': {'id': 'lemonade', 'label': 'Lemonade', 'kind': 'idea',
                                     'status': 'named', 'parent_id': None, 'near': near}})
                self.assertNotIn('near', result['node'])
        # A real parent wins; near is only for loose cards.
        result = self.parse({'type': 'add_node', 'node': {'id': 'cake', 'label': 'Cake', 'kind': 'idea',
                             'status': 'named', 'parent_id': 'topic-1', 'near': 'topic-1'}})
        self.assertNotIn('near', result['node'])
        # near may reference a node added earlier in the same response.
        from providers import _parse_refinement
        ops = _parse_refinement({'operations': [
            {'type': 'add_node', 'node': {'id': 'party', 'label': 'Garden party', 'kind': 'topic', 'status': 'named'}},
            {'type': 'add_node', 'node': {'id': 'lemonade', 'label': 'Lemonade', 'kind': 'idea', 'status': 'named', 'near': 'party'}},
        ], 'question': None}, self.graph)['operations']
        self.assertEqual(ops[1]['node']['near'], 'party')

    def test_strict_schema_has_three_closed_operation_variants(self):
        from providers import REFINEMENT_SCHEMA
        schema = REFINEMENT_SCHEMA
        self.assertFalse(schema['additionalProperties'])
        variants = schema['properties']['operations']['items']['anyOf']
        self.assertEqual(len(variants), 3)
        for variant in variants:
            self.assertFalse(variant['additionalProperties'])
            field = 'edge' if 'edge' in variant['properties'] else 'node'
            data = variant['properties'][field]
            self.assertEqual(set(data['required']), set(data['properties']))
            self.assertFalse(data['additionalProperties'])


class RefinePromptTests(unittest.IsolatedAsyncioTestCase):
    async def test_prompt_maps_cara_explanations_but_not_her_chatter(self):
        import providers
        from unittest.mock import patch
        sent = {}
        async def fake_post(url, key, payload, timeout):
            sent.update(payload)
            return {'choices': [{'message': {'content': '{"operations":[],"question":null}'}}]}
        transcript = 'You: map out photosynthesis for me\nCara: Ooh, okay! Photosynthesis.'
        with patch.object(providers, '_llm_config', return_value=('u', 'k', 'm')), \
                patch.object(providers, '_post', fake_post):
            result = await providers.refine(transcript, {'nodes': []})
        self.assertEqual(result, {'operations': [], 'question': None})
        prompt = sent['messages'][0]['content']
        for rule in ('"You:" (the user) or "Cara:"', 'only when she is explaining or mapping a topic',
                     'map out photosynthesis for me', 'produce NO operations', 'never add a duplicate', 'always reuse its existing ID',
                     'Never add a rephrasing, near-synonym',
                     'Never ask a question about Cara', 'Return no operations for filler'):
            self.assertIn(rule, prompt)
        self.assertEqual(json.loads(sent['messages'][1]['content'])['transcript'], transcript)


if __name__ == '__main__':
    unittest.main()
