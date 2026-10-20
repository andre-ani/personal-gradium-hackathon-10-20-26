---
type: architecture
title: Live voice and deferred graph layers
description: How the browser voice client connects to FastAPI and delegates audio orchestration to Gradbot, including session defaults and current failure boundaries.
tags: [voice, gradbot, websocket, architecture]
verified:
  - by: openwiki/0.5.2
    at: 2026-10-20T21:42:30.964Z
sources:
  - id: openwiki-source-28b4d8cdf9e1063378426959
    resource: repo://frontend/app.js
  - id: openwiki-source-dea534124ae9e203369dd36c
    resource: repo://graph_engine.py
  - id: openwiki-source-833e692518af9eeaf8564cc6
    resource: repo://main.py
  - id: openwiki-source-a1398a6d4d565483f0f307bf
    resource: repo://providers.py
generated: { by: "codex", at: "2026-10-20T21:42:30.964Z" }
---

# Live voice and deferred graph layers

The application keeps listening and drawing independent. `main.py` owns FastAPI sockets and session routing; Gradbot owns streaming speech and the voice conversation; `graph_engine.py` owns graph state and scheduling; `providers.py` owns Jev decisions and validated LLM proposals. `frontend/app.js` renders the G6 workspace and forwards transcribed user fragments to the graph socket.

## Live flow

1. `/ws/graph` creates an in-memory graph session, emits its ID and snapshot, and accepts incremental text or reset messages. Typed text uses the same path as speech.
2. The browser initializes the Gradbot audio player before opening `/ws/chat`. It sends voice settings plus the graph session ID, and forwards captured encoded audio while listening.
3. Gradbot transcription callbacks append user text to `/ws/graph`; assistant transcript text is displayed but is not ingested as user evidence.
4. Explicit counts such as “three topics” reserve stable `topic-N` nodes without waiting for a provider. Explicit ordinal or list labels update these nodes in place. A 300 ms heartbeat emits one queued operation at a time.
5. The semantic worker coalesces text, asks Jev bounded questions, and calls the refinement model only when the decision requires it. Provider work never blocks ingestion or the drawing heartbeat.
6. Validated additions and updates join the same queue. An explicit parent relation queues its child node before its connecting edge. Semantic nodes remain provisional.

The graph is capped at 80 desired nodes and 160 pending operations. Reset and replacement invalidate in-flight semantic work. Continued appends may accept safe results about an earlier prefix, but newer deterministic node labels are protected from stale model overwrites. Graph state is session memory, not durable storage: closing the graph socket removes that session.

## Voice policy and tools

The server prompt asks the voice partner to listen and speak only to clarify a meandering, contradictory, or ambiguous concept. It forces `assistant_speaks_first=False` and `silence_timeout_s=0.0`, with an English voice fallback. `inspect_graph` reads the linked graph snapshot; `refine_graph` requests deferred reconsideration of the existing user transcript. It does not append an assistant paraphrase as new user evidence. Mid-session `on_config` is not implemented.

Explicit Stop, socket failures, and page exit call the shared voice cleanup path, stopping the player and closing the voice socket. A connected “Listening” indicator alone is not proof of provider response or audible output.

## Provider and security boundaries

The Gradbot configuration loads at process import and is shared with its WebSocket bridge and routes, including voice selection. Jev and refinement configuration comes from server environment variables. Restart after configuration changes. Jev returns bounded classification probabilities, not free-text graph content. The refinement model returns a small validated operation list; unknown updates, unsupported operations, and invalid references are rejected. HTTP responses are read fully with a size cap, including chunked bodies.

The server rejects browser WebSocket requests with a different Origin host. Credentials never belong in browser messages or graph state. Provider failures leave explicit structure active and surface a sanitized status; the application does not silently replace Jev with simulated classifications.

See [run and verification instructions](../quickstart.md). Focused Python tests cover queue order, stable IDs, safe concurrent refinement, reset/replacement invalidation, hierarchy edges, bounded responses, and fragmented provider JSON. Physical microphone capture, playback, and barge-in still require a browser/user acceptance check.
