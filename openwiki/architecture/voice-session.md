---
type: architecture
title: Cara voice and grounded workspace context
description: How the browser voice client connects to FastAPI and delegates audio orchestration to Gradbot, including session defaults and current failure boundaries.
tags: [voice, gradbot, websocket, architecture]
sources:
  - id: openwiki-source-28b4d8cdf9e1063378426959
    resource: repo://frontend/app.js
  - id: openwiki-source-dea534124ae9e203369dd36c
    resource: repo://graph_engine.py
  - id: openwiki-source-833e692518af9eeaf8564cc6
    resource: repo://main.py
  - id: openwiki-source-a1398a6d4d565483f0f307bf
    resource: repo://providers.py
  - id: openwiki-source-ec4ce877367bf89fc6aca8bf
    resource: repo://voice_session.py
generated: { by: "codex", at: "2026-10-20T22:38:50.689Z" }
verified:
  - by: openwiki/0.5.2
    at: 2026-10-20T22:38:50.689Z
---

# Cara voice and grounded workspace context

`main.py` exposes `/ws/chat` and binds each call to an existing graph session ID. Gradbot owns streaming STT, the conversational LLM and TTS. The repository's `voice_session.py` owns the surrounding concurrent input/output, config refresh, tool handling and bounded decoration-reaction loop. It cancels sibling tasks and closes the input handle/socket when a call ends.

## Fixed voice and conversation behavior

The server fixes English and Cara — Irish Whiteboard, approved Take 2 (`3N8LkZVbM9P4V4Sn`). Browser-provided voice selections do not override this. Configuration disables speaking first and the silence self-reprompt timeout. Gradbot configuration loads at process import; restart after changing environment values. The static route setup disables voice-catalog selection.

Cara is an engaged Irish teaching assistant/diagram artist: interpret ideas rather than dictate labels, let the user finish, ask concrete questions and occasionally explain a grounded drawing choice. Responses should remain brief. Raw transcript, interpreted concepts, queued drawing work and actually rendered content are different states; the prompt expressly forbids treating queued work as already visible.

## Browser and protocol

The browser starts `SyncedAudioPlayer` before opening the voice socket, then sends a `start` message with the graph session ID. Captured encoded audio goes to the voice socket. Incoming player text callbacks append transcript content; user text is also forwarded to `/ws/graph`, while assistant text is not new graph evidence. The 240px word ribbon consumes the same transcript events beside the talking control.

The browser periodically sends a `config` acknowledgement containing its completed rendered revision. The server validates this against graph revision and rebuilds instructions using server-owned workspace data. Client messages do not supply arbitrary diagram labels or system instructions. Same-origin checks reject unrelated browser origins; missing server credentials and disconnected graph sessions fail explicitly.

`inspect_graph` returns current bounded workspace context. `refine_graph` asks the existing interpreter to reconsider a concept against the original transcript; it does not insert an assistant paraphrase as user speech or promise immediate drawing. Config/tool callbacks reject a stale linked graph instance after disconnect.

## Decorations and reactions

The graph server validates completed decoration receipts before exposing them in context. `voice_session.py` waits for a suitable idle window and claims a one-time opportunity from the graph. It refreshes the Gradbot config with that event; stale opportunities are invalidated and armed events expire. Ordinary voice commentary remains separate from a promised decoration reaction. Do not add a generic repeating praise timer.

## Cleanup and visual state

Stop, socket failure/close, graph disconnect and page exit stop the player and close voice transport. Async microphone startup checks that its original graph session is still current before opening a call. Output mute changes gain after the SDK analyser: the microphone remains active and Cara can still visually speak. Avatar state follows voice events, analyser output and accepted decoration receipts, not invented activity.

## Graph interpretation dependency

Explicit counts can reserve blank slots immediately; one graph operation is emitted per heartbeat. Reset/replacement epochs invalidate stale semantic work, and changed basis nodes are protected while safe prefix results can finish during continued speech. Optional Jev classification and structured LLM refinement are separate adapters, but Jev is not a mandatory live prerequisite. Provider JSON is fully accumulated through EOF under a response size cap. See [graph pipeline](graph-pipeline.md) and [canvas/motion](canvas-and-motion.md).

Useful focused checks are `test_voice_session.py`, `test_voice_context.py`, `test_decorations.py`, `cara-avatar.test.js` and `voice-output-mute.test.js`. A configuration-ready flag or “Listening” label proves neither successful provider output nor audible hardware playback; validate a real browser call for that outcome.
