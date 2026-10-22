# Live map controls (post-hackathon)

Semantic edits and spatial arrangement are separate session-owned capabilities.

- `edit_map` applies an atomic batch through `GraphSession.edit`. It can add/update/remove cards and add/remove connectors. IDs come from `inspect_graph`; invalid batches change nothing. Removing a hierarchy connector clears its parent relationship.
- `arrange_map` requests radial, flow, compact, horizontal or vertical placement. Interpretation can recommend radial concepts or ordered process flows; automatic flow placement uses G6 AntV Dagre to plan positions and connector waypoints together, without a fixed-column wrap; a map whose sections have items is laid out as section blocks instead (title on top, sections as columns in order, items stacked beneath). Radial maps use the same blocks: ordered sections become columns, concept sections sit around the title with their items clustered on the outward side, and the live canvas glides into that arrangement when a block drifts or cards overlap. Manual layout or card placement takes precedence until the workspace is cleared.
- `move_card` places one existing card left/right/above/below another.
- Layout commands are queued, not proof of a visible result. The browser replies with `layout_applied`, known card positions and whether the command completed. The server's layout context reports the last result and pending commands.
- Explicit semantic edits invalidate older interpretation results so deleted cards cannot return from an in-flight result.

The graph WebSocket also accepts `map_edit` with the same `operations` batch, and emits `edit_receipt`. This uses the same domain validation as Cara's tools.

## Voice lifecycle

Recognized user text and synthesized assistant text enter the graph on the server through the optional `voice_session.handle_session(on_transcript=...)` callback. Browser playback captions no longer duplicate ingestion. Assistant chatter remains filtered by the existing graph gate.

Stopping voice closes only the voice session, not the graph. Reopening voice reuses graph context and the selected voice/language; the greeting happens only once per workspace. Browser attempts have distinct ownership tokens so old errors or closes cannot stop a newer session. Initial encoded microphone chunks are buffered until the voice socket opens.

## Development timeline

The bottom drawer records bounded session events: recognized/typed text, interpretation start/result and duration, graph patches, render completion, microphone lifecycle and layout/tool actions. Provider keys and complete prompts are never included. The drawer includes typed map input for local use without microphone access.

Its open height reduces the workspace; viewport resizing keeps the usable canvas above it. Entry animations no longer block later semantic patches, and live patches can interrupt rearrangement. Layout intent is retained when new cards arrive.

These changes are local pending Andre's behavior testing. No browser or integration acceptance is implied by compiling or bundling them.

## Native diagram geometry

Process diagrams use `planNativeLayout` and G6 AntV Dagre, with measured card sizes and stable node order. The server sends a complete `graph_plan` before incremental cards, so new cards can appear in planned positions immediately. A structural signature prevents label, palette and image updates from triggering full layout again.

`SketchEdge` extends G6 `Polyline`. Settled Dagre control points take precedence; manually moved cards fall back to G6's obstacle-aware shortest-path router. Connectors use rounded strokes and native arrowheads; drawProgress controls their ink reveal. Illustrations are clipped pattern fills inside the paper cards, below text and decorations, and require no external layout gutter. The old independent spline search and decorative arrow loops no longer render live connectors.
