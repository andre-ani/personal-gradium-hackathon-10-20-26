---
type: integration
title: Nano Banana illustrations and pencil reveal
description: Selected live raster generation, asynchronous graph integration, memory cache and stale-result rules, paper blending and brush reveal, and saved benchmark evidence.
tags: [illustrations, raster, generation, cache, compositing]
verified:
  - by: openwiki/0.5.2
    at: 2026-10-20T22:38:50.689Z
sources:
  - id: openwiki-source-5f5b95b3d6a215fa02ceb945
    resource: repo://.env.example
  - id: openwiki-source-bd5f4729437f05506a8dcac7
    resource: repo://docs/illustrations.md
  - id: openwiki-source-cdb06a1def21ae22f7537870
    resource: repo://frontend/illustration-layer.js
  - id: openwiki-source-3c7b30204ece87547f1a5727
    resource: repo://frontend/raster-reveal.js
  - id: openwiki-source-de34e04c6d08d586a9503602
    resource: repo://illustrated_graph.py
  - id: openwiki-source-3fa2b87011c9e99b271c59ec
    resource: repo://illustrations.py
  - id: openwiki-source-833e692518af9eeaf8564cc6
    resource: repo://main.py
generated: { by: "codex", at: "2026-10-20T22:38:50.689Z" }
---

# Nano Banana illustrations and pencil reveal

The user selected Nano Banana 2 Lite (`google/gemini-3.1-flash-lite-image`) for live drawings. The live path generates white-background raster artwork through the existing server-side OpenRouter image endpoint. SVG generation/sanitization remains for saved comparisons; it is not the live default. Do not switch back based solely on the earlier faster SVG experiments.

The visual brief is a simple, imperfect child-pencil drawing on white, rendered beside the matching concept on paper. The provider has a 1K minimum: requesting/displaying 80px or 160px does not reduce generation cost or latency. `ILLUSTRATION_MODEL` selects the live model. No provider credentials or base64 payloads belong in browser graph data.

## Nonblocking work and cache

`IllustratedGraphSession` offers emitted named nodes to `GraphIllustrations`. Generation is separate from voice, semantic interpretation and graph animation. A completed result joins the existing queue as an illustration-layer node update only when its concept still matches. Rename, reset and close invalidate stale delivery; a shared provider request may still finish usefully into cache. Picture-only differences do not invalidate an in-flight semantic basis.

`IllustrationService` runs two provider requests concurrently, coalesces duplicate concept/model jobs and bounds in-flight requests. Its process-memory cache holds at most 128 results and 24MB of image bytes. Results expose a same-origin `/api/illustrations/{sha256}` URL and metadata; private byte fields stay in the service. The asset route returns JPEG/PNG bytes or 404 after eviction/restart. This is not durable storage.

Raster validation limits decoded size and dimensions, accepts JPEG/PNG, bounds the HTTP response and uses a finite timeout. Failure is explicit, without automatic provider/model substitution. Restart after environment changes.

## Drawing into paper

`illustration-layer.js` maintains a passive fixed body sibling, clipped and positioned to the graph viewport, with pointer events disabled. G6 transforms, resize and scroll update its placement. A nested app stacking context isolated multiply and left a white tile, so retain the body-level compositing boundary.

`raster-reveal.js` normalizes local white points, uses multiply, preserves a small displacement and draws at 160px with a higher-resolution working canvas. Its current 4.8-second reveal uses short seeded S-shaped gestures and four local 50% return passes, filling one patch before proceeding. It is not a global image fade. Reduced motion reveals the finished image immediately; cleanup stops ongoing work.

## Evidence and review

`docs/illustrations.md` is the detailed integration/benchmark ledger. The saved two-subject comparison recorded means of about 2.016s for Flash-Lite SVG, 7.849s for Opus SVG and 3.301s for Nano raster; these are tiny historical samples, not guarantees. The comparison also records failed/charged attempts. Provider latency, graph queue latency and the client reveal duration are distinct measurements.

- `/static/illustration-proof.html`: saved real provider comparison, with raw assets and usage under `static/illustration-proof/benchmark-20261020/`.
- `/static/raster-reveal.html`: brush stages, scrub/replay and reduced-motion review using saved images without new generation charges.
- `tests/test_illustrations.py`: cache/concurrency, bounds and stale-session correctness.
- `tests/raster-reveal.test.js`: local brush/reveal invariants.

Running `scripts/benchmark_illustrations.py` or `scripts/illustration_proof.py` makes billed provider calls. Reading saved proof does not establish that today's full microphone-to-image session has been reverified.
