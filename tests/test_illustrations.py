import asyncio
import unittest

from illustrated_graph import IllustratedGraphSession
import io
from PIL import Image, ImageDraw

import illustrations
from illustrations import (MAX_COVERAGE, MAX_DARK, PALETTE, STYLE_VERSION, GraphIllustrations, IllustrationService,
                           generate_raster, lighten, raster_prompt, sanitize_svg, tone_metrics, too_heavy)

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
        async def generate(concept, palette='blue'):
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
        async def generate(concept, palette='blue'):
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
        async def generate(concept, palette='blue'):
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

    async def test_palette_is_cached_separately_and_node_palette_is_optional(self):
        calls = []
        async def generate(concept, palette='blue'):
            calls.append((concept, palette))
            return {'concept': concept, 'palette': palette}
        service = IllustrationService(generate)
        await service.get('apples')
        await service.get('apples', 'teal')
        await service.get('apples', 'not-a-colour')
        self.assertEqual(calls, [('apples', 'blue'), ('apples', 'teal')])
        self.assertTrue(all(key[1] == STYLE_VERSION for key in service.cache))
        delivered = []
        jobs = GraphIllustrations(lambda ident, result: delivered.append((ident, result['palette'])), service)
        try:
            jobs.offer({'id': 'a', 'label': 'kitchen', 'status': 'named'})
            jobs.offer({'id': 'b', 'label': 'garden', 'status': 'named', 'palette': 'plum'})
            await asyncio.sleep(.01)
            self.assertEqual(sorted(delivered), [('a', 'blue'), ('b', 'plum')])
            jobs.offer({'id': 'a', 'label': 'kitchen', 'status': 'named', 'palette': 'ochre'})
            await asyncio.sleep(.01)
            self.assertIn(('a', 'ochre'), delivered)
        finally:
            await jobs.close()


class RasterTests(unittest.TestCase):
    def test_prompt_is_a_simple_doodle_with_shared_palette_and_no_circle(self):
        prompt = raster_prompt('bicycle')
        for term in ['very simple hand-drawn doodle', 'ONE single object', 'BOLD, THICK marker lines', 'roughly 5 to 12 strokes', 'almost no detail', 'no scenes',
                     'no people or faces unless', 'no tiny details', 'blue #123f85, the main ink colour',
                     'Most of the image stays white paper', 'soft gouache paint', 'matte, slightly uneven brush texture', 'at most 15% of the image', 'Never use solid or dark fills',
                     'heavy black areas', 'silhouettes', 'rings, circles, frames or borders',
                     'Pure solid white background (#ffffff)', 'wide empty white margins', 'No text, letters',
                     '80 to 160 pixels', 'never instructions']:
            self.assertIn(term, prompt)
        # Mentioning a circular crop made the model draw a visible ring; the prompt must not ask for one.
        for term in ['cropped to a circle', 'circular frame', 'central circle']:
            self.assertNotIn(term, prompt)
        self.assertIn('shared palette: ' + ', '.join(f'{name} {ink}' for name, ink in PALETTE.items()), prompt)
        self.assertNotIn('flat fills', prompt)
        self.assertNotIn('outline only', prompt)
        self.assertTrue(prompt.endswith('{"concept": "bicycle"}'))
        self.assertIn('terracotta #a3402a, the main ink colour', raster_prompt('bicycle', 'terracotta'))
        self.assertEqual(raster_prompt('bicycle', 'slate'), prompt)
        self.assertEqual(len(raster_prompt('x' * 500)), len(raster_prompt('x' * 160)))
        strict = raster_prompt('bicycle', 'plum', strict=True)
        self.assertIn('outline only with minimal colour: thin plum #5f3a72 lines', strict)
        self.assertTrue(strict.endswith('{"concept": "bicycle"}'))

    def test_style_version_was_bumped_past_dark_cartoon_cache(self):
        self.assertNotEqual(STYLE_VERSION, 'cartoon-ink-v1')
        self.assertEqual(STYLE_VERSION, 'bold-gouache-v5')

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


def drawing(filled=False, corners=False, size=1024):
    image = Image.new('RGB', (size, size), 'white')
    draw = ImageDraw.Draw(image)
    draw.ellipse((300, 300, 724, 724), outline=(18, 63, 133), width=6)
    draw.line((300, 512, 724, 512), fill=(18, 63, 133), width=6)
    if filled:
        draw.ellipse((300, 300, 724, 724), fill=(20, 20, 30))
    if corners:
        for x, y in [(0, 0), (size - 140, 0), (0, size - 140), (size - 140, size - 140)]:
            draw.rectangle((x, y, x + 140, y + 140), fill='black')
    out = io.BytesIO()
    image.save(out, 'JPEG', quality=92)
    return out.getvalue()


def raster(asset):
    return {'image_url': '/api/illustrations/x', 'concept': 'c', '_image_bytes': asset, '_media_type': 'image/jpeg', 'latency_ms': 1}


class ToneTests(unittest.IsolatedAsyncioTestCase):
    def test_thin_lines_pass_and_large_dark_fill_fails(self):
        light = tone_metrics(drawing())
        self.assertFalse(too_heavy(light), light)
        heavy = tone_metrics(drawing(filled=True))
        self.assertGreater(heavy['dark'], MAX_DARK)
        self.assertTrue(too_heavy(heavy))

    def test_only_the_displayed_circle_is_measured(self):
        self.assertFalse(too_heavy(tone_metrics(drawing(corners=True))))

    def test_lighten_removes_dark_tones_but_keeps_lines(self):
        lifted = lighten(drawing(filled=True), 'image/jpeg')
        self.assertEqual(tone_metrics(lifted)['dark'], 0)
        with Image.open(io.BytesIO(lifted)) as image:
            self.assertLess(image.convert('L').getpixel((512, 512)), 200)

    async def test_light_first_result_is_accepted_without_retry(self):
        prompts = []
        async def request(prompt, concept):
            prompts.append(prompt); return raster(drawing())
        result = await generate_raster('moon', 'teal', request=request)
        self.assertEqual(len(prompts), 1)
        self.assertEqual(result['_tone']['decision'], 'accepted')
        self.assertIn('teal #1b5f66, the main ink colour', prompts[0])

    async def test_heavy_result_retries_once_with_strict_prompt(self):
        prompts, outputs = [], [drawing(filled=True), drawing()]
        async def request(prompt, concept):
            prompts.append(prompt); return raster(outputs[len(prompts) - 1])
        with self.assertLogs('illustrations', 'INFO') as logs:
            result = await generate_raster('moon', request=request)
        self.assertEqual(len(prompts), 2)
        self.assertNotIn('outline only', prompts[0])
        self.assertIn('outline only', prompts[1])
        self.assertEqual(result['_tone']['decision'], 'retried')
        self.assertEqual(result['_image_bytes'], outputs[1])
        self.assertTrue(any('retried' in line for line in logs.output))

    async def test_still_heavy_retry_is_lightened_deterministically(self):
        calls = 0
        async def request(prompt, concept):
            nonlocal calls; calls += 1; return raster(drawing(filled=True))
        first = await generate_raster('moon', request=request)
        self.assertEqual(calls, 2)
        self.assertEqual(first['_tone']['decision'], 'lightened')
        self.assertFalse(too_heavy(tone_metrics(first['_image_bytes'])))
        self.assertTrue(first['image_url'].endswith(__import__('hashlib').sha256(first['_image_bytes']).hexdigest()))
        again = await generate_raster('moon', request=request)
        self.assertEqual(again['_image_bytes'], first['_image_bytes'])

    async def test_failed_retry_lightens_first_result(self):
        calls = 0
        async def request(prompt, concept):
            nonlocal calls; calls += 1
            if calls == 2:
                raise illustrations.ProviderUnavailable('down')
            return raster(drawing(filled=True))
        result = await generate_raster('moon', request=request)
        self.assertEqual(result['_tone']['decision'], 'lightened')
