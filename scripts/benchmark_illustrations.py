"""Eight serial live calls: two subjects, three SVG models, one raster model."""
import asyncio
import base64
from datetime import datetime, timezone
import json
from pathlib import Path
import struct
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import aiohttp
from illustrations import PROMPT, sanitize_svg
from providers import _llm_config

OUT = Path('static/illustration-proof/benchmark-20261020')
SUBJECTS = [('kitchen', 'a kitchen with a stove and a pot'), ('bicycle', 'a bicycle with a basket of apples')]
MODELS = ['google/gemini-3.1-flash-lite', 'anthropic/claude-opus-5.5', 'google/gemini-3.1-flash-lite-image']
RASTER_PROMPT = '''Draw the supplied concept as a recognizable little graphite pencil doodle by a 12-year-old, not a polished icon. Pure white background. Use 8-16 simple visibly wobbly pencil strokes with imperfect proportions and 2-3 loose crosshatching lines. Slightly bent edges and imperfect circles. Keep the subject centered with a generous white margin, recognizable at 80 by 80 pixels. Monochrome dark gray graphite, no color, no text, letters, symbols, logos, borders, shadows, or background objects. Depict the actual concept, not generic decoration. Return one square image. Subject: '''

async def post(session, url, key, payload):
    start = time.perf_counter()
    async with session.post(url, headers={'Authorization': 'Bearer ' + key}, json=payload, allow_redirects=False) as response:
        headers_ms = (time.perf_counter() - start) * 1000
        body = bytearray()
        first_ms = None
        async for chunk in response.content.iter_chunked(65536):
            if first_ms is None: first_ms = (time.perf_counter() - start) * 1000
            body.extend(chunk)
            if len(body) > 20_000_000: raise ValueError('Response exceeded 20 MB limit.')
        response_ms = (time.perf_counter() - start) * 1000
        data = json.loads(body)
        if response.status != 200 or data.get('error'):
            raise ValueError(f'Provider request failed (HTTP {response.status}, code {data.get("error", {}).get("code", "unknown")}).')
        return data, {'headers_ms': round(headers_ms), 'first_body_ms': round(first_ms or response_ms), 'response_ms': round(response_ms), 'response_bytes': len(body)}

def dimensions(asset, mime):
    if mime == 'image/png' and asset[:8] == b'\x89PNG\r\n\x1a\n':
        return list(struct.unpack('>II', asset[16:24]))
    if mime == 'image/jpeg' and asset[:2] == b'\xff\xd8':
        pos = 2
        while pos < len(asset):
            if asset[pos] != 255:
                pos += 1; continue
            while pos < len(asset) and asset[pos] == 255: pos += 1
            marker = asset[pos]; pos += 1
            if marker in (0xd8, 0xd9): continue
            length = int.from_bytes(asset[pos:pos+2], 'big')
            if marker in (0xc0, 0xc1, 0xc2):
                return [int.from_bytes(asset[pos+5:pos+7], 'big'), int.from_bytes(asset[pos+3:pos+5], 'big')]
            pos += length
    raise ValueError('Unsupported or invalid image bytes.')

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    config = _llm_config()
    if not config: raise RuntimeError('Existing LLM configuration is required.')
    url, key, _ = config
    if 'openrouter.ai' not in url: raise RuntimeError('This benchmark requires the configured OpenRouter connection.')
    base = url.rsplit('/chat/completions', 1)[0]
    report = {'started_at': datetime.now(timezone.utc).isoformat(), 'currency': 'USD', 'cache': 'Application cache bypassed; provider cache usage recorded if returned.', 'runs': [], 'capabilities': {'native_raster': {m: m.endswith('-image') for m in MODELS}}, 'notes': ['Two different subjects per model/output path; one call per subject, no hidden retries. This is a small sample, not a percentile benchmark.', 'Response latency is non-streaming full response, not time to first token. Headers and first body byte are separately recorded.', 'Native raster minimum is 1K; 80px resizing occurs locally and does not reduce generation cost.']}
    repair = '--repair-native' in sys.argv
    if repair:
        report = json.loads((OUT / 'results.json').read_text())
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as session:
        for kind in ['raster'] if repair else ['svg', 'raster']:
            for model in MODELS if kind == 'svg' else [MODELS[-1]]:
                for subject, concept in SUBJECTS:
                    ident = f'{model.rsplit("/", 1)[1]}-{kind}-{subject}'
                    if repair: ident += '-jpeg'
                    run = {'id': ident, 'model': model, 'kind': kind, 'subject': subject, 'concept': concept, 'native': True}
                    started = time.perf_counter()
                    if kind == 'svg':
                        payload = {'model': model, 'messages': [{'role': 'system', 'content': PROMPT}, {'role': 'user', 'content': json.dumps({'concept': concept})}], 'max_tokens': 850, 'temperature': .6}
                        if model.endswith('-image'): payload['modalities'] = ['text']
                        endpoint = url
                    else:
                        payload = {'model': model, 'prompt': RASTER_PROMPT + concept, 'resolution': '1K', 'aspect_ratio': '1:1', 'n': 1}
                        endpoint = base + '/images'
                    # Prompts contain only these public test subjects, never credentials.
                    run['request'] = payload
                    try:
                        data, timings = await post(session, endpoint, key, payload)
                        (OUT / f'{ident}.response.json').write_text(json.dumps(data))
                        run.update(timings)
                        run['usage'] = data.get('usage', {})
                        run['cost_usd'] = run['usage'].get('cost')
                        run['generation_id'] = data.get('id')
                        run['provider'] = data.get('provider')
                        if kind == 'svg':
                            choice = data['choices'][0]
                            run['finish_reason'] = choice.get('finish_reason')
                            raw = choice['message'].get('content') or ''
                            (OUT / f'{ident}.raw.txt').write_text(raw)
                            asset = sanitize_svg(raw).encode()
                            run['file'] = f'{ident}.svg'
                            run['dimensions'] = [80, 80]
                        else:
                            item = data['data'][0]
                            mime = item.get('media_type', 'image/png')
                            if mime not in ('image/png', 'image/jpeg'): raise ValueError('Unsupported image format: ' + mime)
                            asset = base64.b64decode(item['b64_json'], validate=True)
                            run['media_type'] = mime
                            run['dimensions'] = dimensions(asset, mime)
                            run['file'] = f'{ident}.' + ('jpg' if mime == 'image/jpeg' else 'png')
                        (OUT / run['file']).write_bytes(asset)
                        run['asset_bytes'] = len(asset)
                        run['ready_ms'] = round((time.perf_counter() - started) * 1000)
                        run['status'] = 'ok'
                    except (ValueError, KeyError, IndexError, TypeError, aiohttp.ClientError, asyncio.TimeoutError) as exc:
                        run['status'] = 'failed'
                        run['error'] = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
                        run['ready_ms'] = round((time.perf_counter() - started) * 1000)
                    report['runs'].append(run)
                    (OUT / 'results.json').write_text(json.dumps(report, indent=2))
                    print(json.dumps({k: v for k, v in run.items() if k not in ['request', 'usage']}), flush=True)
    report['finished_at'] = datetime.now(timezone.utc).isoformat()
    report['total_reported_cost_usd'] = sum(r.get('cost_usd') or 0 for r in report['runs'])
    (OUT / 'results.json').write_text(json.dumps(report, indent=2))
    print('total_reported_cost_usd', report['total_reported_cost_usd'], flush=True)
asyncio.run(main())
