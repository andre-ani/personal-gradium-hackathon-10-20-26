---
type: workflow
title: Quickstart and local operation
description: Install and run the Gradium live voice starter, configure server-side provider credentials, and distinguish startup readiness from a verified live conversation.
tags: [quickstart, development, configuration, voice]
verified:
  - by: openwiki/0.5.2
    at: 2026-10-20T21:33:15.500Z
sources:
  - id: openwiki-source-5f5b95b3d6a215fa02ceb945
    resource: repo://.env.example
  - id: openwiki-source-ea70eb6c045047448e446296
    resource: repo://.gitignore
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-fd46daa25ea84f5218478698
    resource: repo://static/index.html
generated: { by: "codex", at: "2026-10-20T21:33:15.500Z" }
---

# Quickstart and local operation

This is a local voice hackathon starter using FastAPI and Gradbot. Python 3.12 or newer is required; the project pins `gradbot==0.2.0` and includes `uv.lock` for dependency resolution.

## Install and run

```sh
uv sync --python 3.12
# Only on first setup, when .env does not already exist:
cp .env.example .env
```

Fill `.env` locally with these values:

| Variable | Purpose |
| --- | --- |
| `GRADIUM_API_KEY` | Gradium speech authentication |
| `LLM_API_KEY` | Authentication for the selected compatible LLM endpoint |
| `LLM_BASE_URL` | The selected LLM provider's compatible API base URL |
| `LLM_MODEL` | The model identifier accepted by that provider |

Never overwrite an existing `.env` just to refresh the example. `.gitignore` excludes `.env`, other `.env.*` files except `.env.example`, the virtual environment, and Python caches. Actual credentials belong in the local environment, not documentation or commits.

```sh
uv run --env-file .env uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Open `http://127.0.0.1:8000`, choose a voice, and click the microphone button. Allow microphone access for this local page when prompted. Both valid speech and LLM credentials are necessary for a working voice response. The launch command binds to loopback; it does not publish the app.

Configuration is read when the server imports `main.py`, so restart after changing environment values.

## Verify the outcome

Check that `/` serves the voice interface and `/api/audio-config` plus `/static/js/synced-audio-player.js` load. These establish local serving only. The voice selector uses the server's Gradbot voice integration, so an empty selector or provider error needs investigation rather than a claim that voice is ready.

For live acceptance, speak a short question and verify its transcript, a relevant spoken response, interruption while the assistant speaks, and microphone release when ending the call. A visible “Listening” label alone is insufficient: the browser sets it on WebSocket connection before proving a provider response.

## Where to change things

- [Browser voice session](architecture/voice-session.md): connection flow, dependency ownership, session defaults, callbacks, and current failure boundaries.
- `main.py`: assistant prompt, voice defaults, FastAPI WebSocket integration, and Gradbot configuration.
- `static/index.html`: retained upstream interface, audio player lifecycle, voice picker, and transcript rendering.
- `pyproject.toml` and `uv.lock`: runtime requirement and dependencies.

The frontend is the upstream Gradbot simple-chat demo, with attribution and license details in `README.md` and `LICENSE-MIT`. Product-specific behavior and design remain future work.
