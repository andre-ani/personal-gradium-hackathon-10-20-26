---
type: architecture
title: Browser voice session
description: How the browser voice client connects to FastAPI and delegates audio orchestration to Gradbot, including session defaults and current failure boundaries.
tags: [voice, gradbot, websocket, architecture]
verified:
  - by: openwiki/0.5.2
    at: 2026-10-20T21:33:15.500Z
sources:
  - id: openwiki-source-833e692518af9eeaf8564cc6
    resource: repo://main.py
  - id: openwiki-source-fd46daa25ea84f5218478698
    resource: repo://static/index.html
generated: { by: "codex", at: "2026-10-20T21:33:15.500Z" }
---

# Browser voice session

The repository owns a small FastAPI entrypoint (`main.py`) and the upstream simple-chat interface (`static/index.html`). Gradbot 0.2.0 owns the session bridge and bundled browser audio implementation. There is no separate frontend build or application database in this starter.

## Connection and conversation flow

1. The page fetches `api/voices`, builds a voice dropdown, and selects the first returned voice. It also fetches `api/audio-config` and loads Gradbot's bundled audio scripts.
2. Clicking the microphone initializes `SyncedAudioPlayer`, using the echo cancellation checkbox, then requests audio capture through `player.start()`.
3. The browser opens `/ws/chat` on the current host and sends a JSON `start` message containing the selected voice and language. Encoded audio is forwarded as binary WebSocket frames while recording.
4. FastAPI delegates the socket to `gradbot.websocket.handle_session`, with the process configuration and `make_config` callback. The application does not implement its own speech-to-text, LLM, or text-to-speech clients.
5. Incoming messages pass to the player. Its text callback appends incremental user and assistant text into transcript bubbles; assistant bubbles are keyed by turn index.
6. The explicit Stop action sends `stop`, closes an open socket, stops the player, and restores the controls.

## Session policy and configuration

`gradbot.config.from_env()` runs when `main.py` imports. Both the WebSocket bridge and route registration receive that configuration. Restart the server after changing environment values.

`make_config` takes a requested voice and language, falling back to voice ID `cLONiZ4hQ8VpQ4Sz` and English. It supplies a fixed, brief conversational assistant prompt. The final dictionary merge forces `assistant_speaks_first=True` and `silence_timeout_s=0.0` even when Gradbot configuration supplies different values. These are deliberate application defaults in the current source.

`gradbot.routes.setup(..., with_voices=True)` wires the static interface, bundled audio assets, and voice selection support. API credentials are supplied to the server; the browser's start message contains voice settings rather than provider keys. See [local setup](../quickstart.md) for the environment contract.

## Failure and extension boundaries

The browser reports microphone initialization failures as “Microphone access denied” and WebSocket errors as “Connection error.” It marks the call “Listening” when the socket opens; that state alone does not establish provider authentication or a successful voice reply.

The explicit Stop handler calls `player.stop()`. The current `ws.onclose` handler only resets controls and status, so unexpected disconnects do not perform the same player cleanup. Treat microphone release after abnormal disconnect as unverified.

The server supplies `on_start` only: no tool callback, application persistence, or mid-session `on_config` callback is implemented. Add domain actions or live configuration in `main.py` through Gradbot's supported callbacks, then update the browser protocol as needed. The retained upstream page still mentions a traveller persona, while the server prompt is a general assistant; the server defines actual conversational behavior.

## Verification

Local import, page delivery, and audio asset checks establish startup only. A real voice acceptance check must establish transcription, a valid streaming LLM response, audible synthesized output, interruption, and microphone release on Stop. The repository currently contains no automated test suite.
