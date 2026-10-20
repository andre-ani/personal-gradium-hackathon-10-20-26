import asyncio
import unittest

from illustrated_graph import IllustratedGraphSession
from illustrations import GraphIllustrations, IllustrationService, sanitize_svg

SVG = '<svg viewBox="0 0 80 80"><path d="M10 10 L60 60"/><circle cx="40" cy="40" r="20"/></svg>'


class SanitizerTests(unittest.TestCase):
    def test_safe_geometry_is_rebuilt_and_comments_removed(self):
        clean = sanitize_svg(SVG.replace('<path', '<!-- harmless --> <path'))
        self.assertIn('stroke="#45433f"', clean)
        self.assertNotIn('<!--', clean)
        self.assertIn('viewBox="0 0 80 80"', clean)

    def test_active_remote_and_unbounded_inputs_rejected(self):
        bad = ['<script/>', '<image href="https://example.com/x"/>', '<foreignObject/>',
               '<path onload="alert(1)"/>', '<path d="M1 1" style="fill:url(x)"/>',
               '<path d="M1e999 2"/>', '<use href="#x"/>', '<animate/>']
        for payload in bad:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                sanitize_svg(SVG.replace('<circle cx="40" cy="40" r="20"/>', payload))
        with self.assertRaises(ValueError):
            sanitize_svg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + SVG)


class JobTests(unittest.IsolatedAsyncioTestCase):
    async def test_concurrency_coalescing_and_cache(self):
        active = peak = calls = 0
        async def generate(concept):
            nonlocal active, peak, calls
            active += 1; calls += 1; peak = max(active, peak)
            await asyncio.sleep(.01)
            active -= 1
            return {'svg': sanitize_svg(SVG), 'concept': concept}
        service = IllustrationService(generate)
        await asyncio.gather(*(service.get(c) for c in ['apples', 'apples', 'bicycle', 'kitchen']))
        self.assertEqual(calls, 3)
        self.assertEqual(peak, 2)
        self.assertTrue((await service.get('APPLES'))['cached'])
        self.assertEqual(calls, 3)

    async def test_slow_drawing_cannot_block_graph_and_reset_discards_result(self):
        release, started = asyncio.Event(), asyncio.Event()
        async def generate(concept):
            started.set(); await release.wait()
            return {'svg': sanitize_svg(SVG), 'concept': concept}
        events = []
        service = IllustrationService(generate)
        session = IllustratedGraphSession(events.append, illustration_service=service, heartbeat=.005, semantic_delay=.005,
            classify=lambda *_: None, refine=lambda *_: None)
        # Disable semantic requests so this test only checks graph/drawing order.
        session._semantic = lambda: asyncio.sleep(3600)
        await session.start()
        try:
            await session.ingest('two topics')
            await asyncio.sleep(.015)
            self.assertEqual(len(session.nodes), 2)
            self.assertEqual(service.inflight, {})
            session._enqueue({'type': 'update_node', 'node': {'id': 'topic-1', 'label': 'apples', 'status': 'named'}}, 'meaning')
            await started.wait()
            await session.ingest('continued listening')
            session._enqueue({'type': 'update_node', 'node': {'id': 'topic-2', 'label': 'bicycle', 'status': 'named'}}, 'meaning')
            await asyncio.sleep(.015)
            self.assertEqual(session.nodes['topic-2']['label'], 'bicycle')
            self.assertIsNone(session.nodes['topic-2'].get('illustration'))
            await session.reset()
            release.set(); await asyncio.sleep(.02)
            self.assertEqual(session.nodes, {})
            self.assertFalse(any(e.get('layer') == 'illustration' for e in events))
        finally:
            await session.close()

    async def test_label_change_ignores_old_result_and_illustration_uses_queue(self):
        releases = {c: asyncio.Event() for c in ['apples', 'bicycle']}
        async def generate(concept):
            await releases[concept].wait()
            return {'svg': sanitize_svg(SVG), 'concept': concept}
        events = []
        session = IllustratedGraphSession(events.append, illustration_service=IllustrationService(generate), heartbeat=.005)
        session._semantic = lambda: asyncio.sleep(3600)
        await session.start()
        try:
            await session.ingest('one topic')
            await asyncio.sleep(.01)
            session._enqueue({'type': 'update_node', 'node': {'id': 'topic-1', 'label': 'apples', 'status': 'named'}}, 'meaning')
            await asyncio.sleep(.01)
            session._enqueue({'type': 'update_node', 'node': {'id': 'topic-1', 'label': 'bicycle', 'status': 'named'}}, 'meaning')
            await asyncio.sleep(.01)
            releases['apples'].set(); releases['bicycle'].set()
            await asyncio.sleep(.025)
            patches = [e for e in events if e['type'] == 'graph_patch']
            self.assertEqual([e['revision'] for e in patches], sorted(e['revision'] for e in patches))
            drawings = [e for e in patches if e['layer'] == 'illustration']
            self.assertEqual(len(drawings), 1)
            self.assertEqual(drawings[0]['op']['node']['illustration']['concept'], 'bicycle')
            self.assertEqual(patches[0]['op']['node']['status'], 'placeholder')
            self.assertEqual(patches[1]['op']['node']['label'], 'apples')
        finally:
            await session.close()

class RasterTests(unittest.TestCase):
    def test_jpeg_and_png_are_accepted_and_non_images_rejected(self):
        import base64
        import struct
        import time
        from illustrations import parse_raster
        from providers import ProviderUnavailable
        assets = [('image/png', b'\x89PNG\r\n\x1a\n' + b'\0' * 8 + struct.pack('>II', 1024, 1024)),
                  ('image/jpeg', b'\xff\xd8\xff\xc0\x00\x11\x08\x04\x00\x04\x00' + b'\0' * 8)]
        for mime, asset in assets:
            result = parse_raster({'data': [{'media_type': mime, 'b64_json': base64.b64encode(asset).decode()}]}, 'bicycle', 'nano', time.perf_counter())
            self.assertEqual((result['width'], result['height']), (1024, 1024))
            self.assertEqual(result['_media_type'], mime)
            self.assertTrue(result['image_url'].startswith('/api/illustrations/'))
        for mime, encoded in [('image/svg+xml', base64.b64encode(b'<svg/>').decode()), ('image/jpeg', 'not-base64'), ('image/png', base64.b64encode(b'not an image').decode())]:
            with self.assertRaises(ProviderUnavailable):
                parse_raster({'data': [{'media_type': mime, 'b64_json': encoded}]}, 'bicycle', 'nano', time.perf_counter())

    def test_asset_bytes_never_enter_graph_payload(self):
        service = IllustrationService()
        result = {'concept': 'bicycle', 'image_url': '/api/illustrations/' + 'a' * 64, '_image_bytes': b'jpeg', '_media_type': 'image/jpeg'}
        service.cache['bicycle'] = result
        self.assertEqual(service.asset('a' * 64), (b'jpeg', 'image/jpeg'))
        self.assertEqual(service.asset('../bad'), None)
        self.assertEqual(service.public(result), {'concept': 'bicycle', 'image_url': result['image_url']})
