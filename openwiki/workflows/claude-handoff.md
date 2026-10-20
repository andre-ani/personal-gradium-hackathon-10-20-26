---
type: workflow
title: Claude continuation handoff
description: Product decisions, runtime ownership, local-versus-published boundaries, validation evidence and safe next steps for continuing this hackathon project in Claude.
tags: [handoff, claude, development, verification]
verified:
  - by: openwiki/0.5.2
    at: 2026-10-20T22:38:50.689Z
sources:
  - id: openwiki-source-5f5b95b3d6a215fa02ceb945
    resource: repo://.env.example
  - id: openwiki-source-bd5f4729437f05506a8dcac7
    resource: repo://docs/illustrations.md
  - id: openwiki-source-dea534124ae9e203369dd36c
    resource: repo://graph_engine.py
  - id: openwiki-source-3fa2b87011c9e99b271c59ec
    resource: repo://illustrations.py
  - id: openwiki-source-833e692518af9eeaf8564cc6
    resource: repo://main.py
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "codex", at: "2026-10-20T22:38:50.689Z" }
---

# Claude continuation handoff

Start with [quickstart](../quickstart.md), inspect `git status --short --branch`, then read the page for the surface you are changing. Current source/runtime and the user's latest instructions outrank generated documentation. Work directly on the requested implementation; this project does not need an unsolicited cross-chat orchestrator.

## Product decisions to preserve

Thread is a Gradium/Gradbot live thinking workspace. While the person speaks, explicit structure appears first, then semantic concepts, relationships and independent illustrations refine the diagram. Listening must not wait for drawing or image generation. The diagram abstracts meaning rather than copying a transcript into boxes.

Cara is the approved fixed English/Irish Whiteboard voice, an engaged teaching assistant and artist. She may explain useful drawing choices and ask brief clarifying questions, but must distinguish proposed, queued and visibly completed work. Jev is no longer a required live interpretation gate.

Keep the paper/blue-ink hand-drawn design, varied note roles and Motion interactions. The canvas must stay stable: no fit-to-measure teleport, repeated card re-inking, unsolicited zoom-in, or camera fighting a manual pan. The speech ribbon is about 240px: words spring up, move left and fall away while the full transcript stays available.

Arrows should be visibly drawn but readable. Long skip links go around intervening cards and other links; use separate stable attachments. No tiny decorative knot loops and no hard-corner/staircase detours. The long kitchen-row link is now a single sweeping curve. Preserve those constraints when modifying layout or the renderer.

The selected live illustration path is Nano Banana Lite raster on white, rendered small with white-point normalization, multiply and a local multi-pass pencil reveal. The provider's 1K minimum means a smaller displayed image does not make generation cheaper/faster. Saved SVG experiments are comparisons, not the live default.

## Where the implementation lives

| Work | Owning source/context |
| --- | --- |
| Voice, config refresh, tool and reaction transport | `main.py`, `voice_session.py`; [voice architecture](../architecture/voice-session.md) |
| Count scaffolds, interpretation, revisions and serial queue | `graph_engine.py`, `providers.py`; [graph pipeline](../architecture/graph-pipeline.md) |
| G6 rendering, camera, captions, arrows, avatar, mute and decoration UI | `frontend/app.js` and its focused modules; [canvas/motion](../architecture/canvas-and-motion.md) |
| Async raster jobs, cache/asset route and brush compositing | `illustrated_graph.py`, `illustrations.py`, `frontend/illustration-layer.js`, `raster-reveal.js`; [illustrations](../integrations/illustrations.md) |

## Local checkout versus GitHub

At this refresh, `main` was four commits ahead of `origin/main`. The latest focused commit was `74000a5` (smooth arrow routing), preceded by `c778f4f`, `2dbb744` and `f6635b7`. **Recheck Git before using these as current state.** Significant voice, illustration, hierarchy, avatar, decoration and preview changes were still modified or untracked. A fresh GitHub clone alone does not contain that working tree. Preserve all dirty work; do not reset, stash, discard or broadly stage unrelated changes.

The generated `.github/workflows/openwiki-update.yml` was local/untracked and had not been published. OpenWiki is a host-invoked resumable documentation lifecycle, not an always-running project daemon. Its saved state may become stale when source changes during a run. Do not imply automatic CI refresh is active or provision a provider/schedule merely to make it so.

Credentials live only in ignored `.env`. Use `.env.example` for variable names, never copy actual values into prompts, documentation, logs, frontend or commits. Local edits/checks are authorized; committing, pushing, publishing and deployment follow the user's explicit scope. No public deployment is established by this handoff.

## Evidence and what remains

Earlier direct checks established microphone transcription and spoken replies, sequential graph edits, live structured refinement, actual paper rendering, and smooth-routing/camera invariants. Saved illustration evidence includes real provider outputs, bounded latency/cost samples and brush-render comparisons. These are different proofs; they do not establish that every current feature has passed a fresh combined live session.

Before calling the latest integration finished, exercise one coherent browser session: speech → concise concept/revision → sequential drawing → current illustration → completed decoration context/reaction, including interruption, correction, output mute, stop/restart and resize/reframing. Use focused existing checks for the changed contract. Review dense routing and the exact four-card kitchen regression if arrows change.

Known boundaries: graph sessions and images are memory-only; disconnect/restart removes them. Python development reload therefore resets current sessions/cache. Frontend source needs `pnpm build` and a browser refresh to load the new bundle. Do not destroy an active user conversation merely to test a UI change; use a task-owned preview. The count matcher handles a small explicit vocabulary and the first matching count; arbitrary nested/corrected lists require semantic interpretation and further acceptance checks.

Useful commands:

```sh
git status --short --branch
pnpm build
node --test tests/viewport-motion.test.js tests/edge-geometry.test.js tests/graph-routing.test.js
uv run python -m unittest discover -s tests -p test_graph_engine.py -v
```

For wider coupled voice/image changes, choose the corresponding existing tests listed in the architecture pages. Saved previews are available without new provider charges. Benchmark scripts and real live calls consume provider usage. Deployment and hackathon submission remain explicit release work, separate from local implementation and a successful listening port.
