# Live pencil raster illustrations

The selected live model is Nano Banana 2 Lite (`google/gemini-3.1-flash-lite-image`), using the existing server-side OpenRouter connection. It generates a 1024×1024 JPEG or PNG on white. Rendering at 160px or shrinking afterward does not reduce provider generation time or price. A live graph request completed in 2,739ms during integration; the earlier two-prompt benchmark averaged 3,301ms. Credentials never enter the browser bundle.

Named nodes schedule independent raster jobs; only completion joins the existing graph queue. Two provider requests run at once. Duplicate labels share requests/cache. The memory cache is bounded to 128 entries and 24MB of image bytes. Graph patches contain only same-origin image URLs and metadata, never base64. `/api/illustrations/{sha256}` serves the cached bytes with private caching. Session reset/rename/disconnect invalidates stale updates; shared jobs may finish into the cache without updating an old node.

The browser normalizes nearby paper white points to remove faint generated paper gradients, then uses multiply. The passive overlay is a body sibling clipped to the graph viewport, so it blends with the actual paper layer rather than an isolated app stacking context. Rendering stays at 160px, with a 320px canvas for detail. The 4.8-second seeded reveal uses short S-shaped strokes (roughly 4–7px long), with four 50% return passes and a small local touch-up. It completes a small ink patch before moving on instead of fading the whole image pass by pass. Each gesture has cubic ease-out motion (quick attack, slower finish) and a short pen lift. Separate masks prevent overlapping dabs within a pass from prematurely making that pass opaque. There is no final whole-image opacity fade. Slight displacement persists. Reduced motion shows the finished image immediately; dispose/reset stops the reveal.

Review `/static/raster-reveal.html`: replay, scrub, reduced-motion control, and fixed first-pass/second-pass/final comparisons. Those previews reuse actual benchmark rasters; they do not incur new generation charges. The full model benchmark remains at `/static/illustration-proof.html`.

Focused checks: `uv run python -m unittest discover -s tests -p test_illustrations.py -v` and `node --test tests/raster-reveal.test.js`. Build with `pnpm build`.

The SVG generator/sanitizer remains only for the comparative benchmark and existing saved SVG previews. It is not the live default.

## Local proof

Open `/static/illustration-proof.html`. Saved samples are actual provider output, not hand-authored placeholders. `scripts/illustration_proof.py` reruns a bounded live comparison using configured credentials; it incurs provider usage. Run from the repository with `uv run --env-file .env python scripts/illustration_proof.py`.

Measured October 20, 2026: 3.1 Flash-Lite bicycle comparison 1,377 ms; 3.5 comparison 2,055 ms. The final child-pencil prompt on 3.1 produced kitchen 1,812 ms, bicycle 1,673 ms, garden 1,637 ms (request through server-side validation; excludes graph queue and drawing reveal). 2.5 responses failed safety validation twice during exploration. Opus 5.5 produced the same three subjects in 11,094 / 7,798 / 9,938 ms, with more recognizable subject details. These are tiny local samples, not a latency guarantee. A live three-node websocket check measured placeholders at 301 / 602 / 901 ms, labels at 3,010 / 3,311 / 3,612 ms, and Flash-Lite illustration patches 2,707 / 2,706 / 3,924 ms after their labels (bounded provider concurrency plus graph queue included; excludes client reveal).

The proof also rasterizes the same drawing on white at 80×80 and displays it at 160×160. On paper RGB(239,238,232), the darkest sampled stroke becomes RGB(245,244,240) under screen, RGB(85,83,78) under multiply, and RGB(81,80,78) after white removal. Actual rendered output confirms screen washes out the pencil and keeps a white rectangle. That earlier SVG experiment selected transparent SVG with multiply. The live layer now uses the selected Nano Banana Lite raster pipeline described above.

Official model/API references: [Gemini models](https://ai.google.dev/gemini-api/docs/models), [Gateway Chat Completions](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions). Model availability was also read from the configured provider's live model catalog.

Focused checks: `uv run python -m unittest discover -s tests -p test_illustrations.py -v` covers sanitizer safety, shared concurrency/cache, nonblocking ingestion, stable IDs, stale-label rejection and reset cancellation. The local proof exposes reduced-motion behavior for rendered review.

## Full SVG/raster benchmark

The current comparison at `/static/illustration-proof.html` uses two matched subjects (kitchen, bicycle) for Gemini 3.1 Flash-Lite SVG, Claude Opus 5.5 SVG and Nano Banana 2 Lite native raster. Exact requests, provider token/cost readback, all charged attempts and assets are saved in `static/illustration-proof/benchmark-20261020/results.json`; `browser-results.json` additionally saves local fetch/decode/80px conversion/first-paint measurements. All previews use multiply and slight persistent displacement. Native SVGs appear beside their 80px rasterizations; native 1024px rasters appear beside their 80px downscales.

Successful-run means: Flash-Lite 2.016s / $0.000532625, Opus 7.849s / $0.013216, Nano Banana Lite 3.301s / $0.033633375. Local first paint including fetch/decode/conversion was 21-33ms in the reviewed browser; this is separate from provider generation, not a fresh live end-to-end request. Total benchmark spend was $0.23048 across ten calls, including two invalid Nano SVG requests and two JPEG responses discarded by an initially PNG-only runner. The corrected runner accepts JPEG/PNG and preserves provider responses before validation. Only two prompts per successful path: no p95 or reliability claims.

Reproduce with `uv run --env-file .env python scripts/benchmark_illustrations.py` (eight serial billed requests, no automatic retries). The optional `--repair-native` flag explicitly appends two more billed raster calls to an existing report. Build the isolated viewer with esbuild from `frontend/illustration-proof.js` to `static/illustration-benchmark.js`; the live application model default is unchanged by the benchmark.
