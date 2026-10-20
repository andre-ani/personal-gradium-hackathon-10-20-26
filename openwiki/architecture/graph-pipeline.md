---
type: architecture
title: Incremental interpretation and drawing queue
description: Immediate count placeholders, semantic interpretation, bounded sequential graph operations, revision authority, stale-result handling, and session lifetime.
tags: [graph, interpretation, queue, revisions]
verified:
  - by: openwiki/0.5.2
    at: 2026-10-20T22:38:50.689Z
sources:
  - id: openwiki-source-dea534124ae9e203369dd36c
    resource: repo://graph_engine.py
  - id: openwiki-source-a1398a6d4d565483f0f307bf
    resource: repo://providers.py
generated: { by: "codex", at: "2026-10-20T22:38:50.689Z" }
---

# Incremental interpretation and drawing queue

The live graph is an `IllustratedGraphSession`, derived from `GraphSession`. FastAPI creates one per `/ws/graph` connection, assigns a random session ID and sends a snapshot. The browser sends incremental `{type:"text",text,mode:"append"}` messages for recognized speech and typed input. Replacement and reset are separate operations. State is in memory and removed on disconnect; it is not a saved project/database.

## Two layers

`ingest` appends into a bounded 32,000-character transcript and wakes deferred work without awaiting a provider. Explicit counts from one to twelve, such as “three topics,” can immediately reserve blank `topic-N` slots. Concept names come from semantic interpretation, not copied ordinal/list fragments. The count matcher is deliberately simple; it is not a general parser for arbitrary nested or corrected lists.

The semantic worker coalesces incoming text (default delay 0.45 seconds), snapshots desired state and asks `providers.refine` for concise concepts and relationships. Jev support still exists in `providers.py`, but is **not a required live gate**: classification runs only when a classifier is explicitly injected. The interpreter itself returns no operations for filler or repetition. It can also return one useful clarifying question.

`providers.py` uses `GRAPH_MODEL` or `LLM_MODEL`, an OpenAI-compatible endpoint, strict structured output, bounded input/response size and sanitized errors. Allowed proposals are add_node, update_node and add_edge. Existing-node adds normalize to updates; sparse updates preserve existing fields. Invalid IDs/references and unsupported deletes are rejected. Transcript and diagram are untrusted content, not execution authority.

## Queue and correction safety

One heartbeat (default 300ms) emits one operation as `graph_patch`, with monotonically increasing revision, layer, queue depth and affected node revisions. Desired state and emitted state are distinct. There are caps of 80 desired nodes and 160 pending operations; repeated updates can coalesce. A child with an explicit valid parent queues its node before its connection.

Reset/replacement advances an epoch. In-flight semantic results from an invalid epoch are discarded. Continued speech can accept safe prefix results, but cannot overwrite nodes that changed after the provider's basis snapshot. Illustration completion is handled by the subclass so adding a picture does not invalidate a semantic proposal about the same concept.

On provider failure the explicit structure path continues and a sanitized unavailable status is emitted. No simulated semantic or Jev success is substituted. See [illustration jobs](../integrations/illustrations.md) for their independent concurrency/cache.

## Render authority and decorations

`voice_context` separates the bounded raw transcript, emitted canvas revision/nodes/edges, last reported rendered revision, pending desired nodes, queue depth, interpretation status/question and completed decorations. Cara receives this server-owned context instead of client-authored narration.

A `decoration_applied` receipt must reference a named emitted node, its exact current node revision, a valid rendered revision and a sequential decoration level. Pending changes, duplicates, stale revisions and exhausted caps are rejected. Semantic changes invalidate related decoration state. One-time reaction opportunities are claimed only while interpretation and the drawing queue are idle, with a 45-second cooldown; a receipt alone is not unrestricted permission to speak.

## Ownership and checks

- `graph_engine.py`: state, queue, revision and correction invariants.
- `providers.py`: optional bounded Jev classification and actual semantic proposals.
- `main.py`: socket validation, session binding and receipt transport.
- `illustrated_graph.py`: illustration work joining the same queue.
- `tests/test_graph_engine.py`, `test_decorations.py`, `test_providers.py`: focused protections.

[Voice](voice-session.md) and [canvas rendering](canvas-and-motion.md) consume these contracts. The client-reported rendered revision is a constrained acknowledgement, not independent pixel verification.
