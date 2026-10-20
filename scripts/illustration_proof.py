"""Bounded live SVG latency/style sample. Run from repo with uv --env-file .env."""
import asyncio
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from illustrations import generate_svg

async def main():
    out = Path('static/illustration-proof')
    samples = [(model, concept)
               for model in ['google/gemini-3.1-flash-lite', 'anthropic/claude-opus-5.5']
               for concept in ['a kitchen with a stove and a pot', 'a bicycle with a basket of apples',
                               'a vegetable garden with a watering can']]
    results = []
    for index, (model, concept) in enumerate(samples):
        try:
            result = await generate_svg(concept, model=model)
            (out / f'sample-{index}.svg').write_text(result.pop('svg'))
            result['file'] = f'sample-{index}.svg'
            result['prompt_version'] = 'pencil-v2'
            results.append(result)
            print(json.dumps(result), flush=True)
        except Exception as exc:
            results.append({'model': model, 'error': str(exc)})
            print(json.dumps(results[-1]), flush=True)
    (out / 'results.json').write_text(json.dumps(results, indent=2))
asyncio.run(main())
