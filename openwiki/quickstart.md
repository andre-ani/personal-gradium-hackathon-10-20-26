---
type: workflow
title: Quickstart and local operation
description: Install and run the Gradium live voice starter, configure server-side provider credentials, and distinguish startup readiness from a verified live conversation.
tags: [quickstart, development, configuration, voice]
sources:
  - id: openwiki-source-5f5b95b3d6a215fa02ceb945
    resource: repo://.env.example
  - id: openwiki-source-ea70eb6c045047448e446296
    resource: repo://.gitignore
  - id: openwiki-source-28b4d8cdf9e1063378426959
    resource: repo://frontend/app.js
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-a1398a6d4d565483f0f307bf
    resource: repo://providers.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
generated: { by: "codex", at: "2026-10-20T21:42:30.964Z" }
verified:
  - by: openwiki/0.5.2
    at: 2026-10-20T21:42:30.964Z
---

# Run and verify the voice graph workspace

The workspace uses Python 3.12 or newer, Gradbot 0.2.0, and a locally bundled G6 browser client. Install Python dependencies with uv and frontend dependencies with pnpm.

```sh
uv sync --python 3.12
pnpm install --frozen-lockfile
pnpm build
[ -e .env ] || cp .env.example .env
pnpm dev
```

The development command runs `uvicorn main:app` with `.env`, loopback binding at `127.0.0.1:8000`, the wsproto transport, and reload enabled. Open `http://127.0.0.1:8000`. Rebuild the frontend after editing its source. Restart the server after changing credentials. Preserve any existing `.env`; it and the virtual environment are ignored by Git, while `.env.example` is tracked without secrets.

## Try structure without providers

Use the text field or “Try an example.” Say or type “We are going to talk about three topics,” then “First design,” “Second engineering,” and “Third launch.” Three placeholders arrive through the queue, then labels replace those same nodes. Explicit structure works without credentials; interpreting arbitrary ideas and relationships requires providers.

## Configure live semantics and voice

| Variable | Purpose |
| --- | --- |
| `GRADIUM_API_KEY` | Speech input and output |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` | Compatible conversational model |
| `AI_GATEWAY_API_KEY` or `TYPESAFE_API_KEY` | Jev decisions through Gateway or TypeSafe |
| `GRAPH_MODEL` | Optional separate refinement model; otherwise uses `LLM_MODEL` |

The provider adapter also supports Jev through an OpenRouter credential. Provider readiness means configuration is present, not proof the account can serve a request. Credentials stay on the server. The voice button requests microphone access only after an explicit click. End the call to stop capture.

## Check the outcome

```sh
uv run python -m unittest discover -s tests -v
pnpm build
```

Python tests protect ordering, stable node identities, correction safety, bounds, hierarchy edges, and fragmented provider responses. Build success establishes bundle generation. Inspect actual rendering for visual changes.

For a live conversation, establish transcription, graph edits, a relevant spoken response, interruption, and microphone release. A visible “Listening” indicator is set when the socket opens and does not prove provider output. Test audio through the server establishes the speech pipeline but does not replace testing the actual browser microphone and speakers.

## Find the owner

- [Live voice and deferred graph layers](architecture/voice-session.md): flow, tools, queue policy, failure behavior, and in-memory lifetime.
- `main.py`: FastAPI routing, voice prompt, graph tools, readiness, and session binding.
- `graph_engine.py`: explicit structure, deferred scheduling, stable nodes, and sequential graph operations.
- `providers.py`: real Jev classification and bounded refinement requests.
- `frontend/app.js`: G6 rendering and the browser audio bridge; `pnpm build` emits the static bundle.
- `README.md`: setup, ShieldCN assets, and upstream attribution. `LICENSE-MIT` includes the upstream license.
