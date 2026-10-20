"""Local HTTP contract checks; no external provider requests."""
import asyncio
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


if __name__ == '__main__':
    unittest.main()
