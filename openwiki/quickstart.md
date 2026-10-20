---
type: workflow
title: Run Thread and find the right context
description: Install and run the Gradium live voice starter, configure server-side provider credentials, and distinguish startup readiness from a verified live conversation.
tags: [quickstart, development, configuration, voice]
sources:
  - id: openwiki-source-5f5b95b3d6a215fa02ceb945
    resource: repo://.env.example
  - id: openwiki-source-ea70eb6c045047448e446296
    resource: repo://.gitignore
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-a2371d6362e5db4bc834ad03
    resource: repo://CLAUDE.md
  - id: openwiki-source-28b4d8cdf9e1063378426959
    resource: repo://frontend/app.js
  - id: openwiki-source-3fa2b87011c9e99b271c59ec
    resource: repo://illustrations.py
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-a1398a6d4d565483f0f307bf
    resource: repo://providers.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "codex", at: "2026-10-20T22:38:50.689Z" }
verified:
  - by: openwiki/0.5.2
    at: 2026-10-20T22:38:50.689Z
---

# Run Thread and find the right context

For continuation in Claude, read [the handoff](workflows/claude-handoff.md) and inspect the actual working tree before editing. This wiki summarizes the current local project; it is not proof that all local changes have been pushed to GitHub.

## Install and run

Requirements: Python 3.12 or newer, uv, Node.js and pnpm. Python dependencies pin Gradbot 0.2.0 and include aiohttp/wsproto; frontend dependencies include G6, Rough.js and Motion. Preserve the lockfiles and existing `.env`.

```sh
uv sync --python 3.12
pnpm install --frozen-lockfile
pnpm build
[ -e .env ] || cp .env.example .env
pnpm dev
```

Open `http://127.0.0.1:8000`. The development script runs `uvicorn main:app` on loopback with wsproto, `.env` and reload. Frontend edits require another build/browser refresh; environment changes require a server restart. Python reload resets memory-only sessions/cache, so preserve an active user's work before restarting.

## Configuration

| Variable | Purpose |
| --- | --- |
| `GRADIUM_API_KEY` | Gradium speech input/output |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` | Conversational model connection |
| `GRAPH_MODEL` | Optional separate semantic model; otherwise uses `LLM_MODEL` |
| `ILLUSTRATION_MODEL` | Live image model, default Nano Banana Lite raster |
| `AI_GATEWAY_API_KEY` / `TYPESAFE_API_KEY` | Optional Jev adapter; not a required live graph gate |

The current Nano generator uses the existing OpenRouter connection; a different voice-compatible endpoint alone does not establish image support. `.env.example` contains names/defaults, never credentials. `.env`, other `.env.*` files except the example, virtual environments and caches are ignored by Git. Credentials remain server-side.

The voice is fixed to approved Cara in English; the browser does not choose arbitrary voices. Click the talking control to request microphone access. Cara's output mute changes her sound, not microphone capture.

## Try and verify

The text form and “Try an example” exercise graph input without a microphone. Explicit topic counts can reserve placeholders without providers. Concept abstraction, conversation and illustration generation require valid configured providers. Readiness is configuration presence, not authentication or end-to-end proof. “Listening” is set on socket connection and does not itself establish a spoken reply.

Use the focused tests for the changed contract and `pnpm build`. For example:

```sh
node --test tests/viewport-motion.test.js tests/edge-geometry.test.js tests/graph-routing.test.js
uv run python -m unittest discover -s tests -p test_graph_engine.py -v
```

Live acceptance separately checks transcription, useful concept labels, sequential graph changes, a relevant spoken response, current pictures, interruption/correction, output mute and microphone release. Saved proof can establish appearance and historical samples without making paid model calls; it is not a fresh integrated live check.

## Context map

- [Cara voice](architecture/voice-session.md): transport, tools, rendered context, reactions, cleanup and mute.
- [Graph pipeline](architecture/graph-pipeline.md): count scaffolds, abstraction, bounded queue and revision safety.
- [Canvas and Motion](architecture/canvas-and-motion.md): G6/paper ownership, camera stability, captions, arrows, avatar and tape.
- [Illustrations](integrations/illustrations.md): Nano generation, cache, blending, brush reveal and benchmark boundaries.
- [Claude handoff](workflows/claude-handoff.md): accepted decisions, local/GitHub boundaries and next verification work.

Useful local previews: `/static/sketch-preview.html?scene=complete` for the kitchen fixture; `/static/raster-reveal.html` for reveal stages; `/static/illustration-proof.html` for saved provider comparisons. Preview fixtures do not replace the real `/` conversation route.

README contains run instructions, ShieldCN assets and upstream Gradbot attribution. `CLAUDE.md` imports the repository's `AGENTS.md` OpenWiki guidance. Generated indexes/claims/provenance belong to the OpenWiki lifecycle, not hand-maintained metadata. Scheduled CI refresh has not been published merely because its local generated workflow exists.
