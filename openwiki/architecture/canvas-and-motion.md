---
type: architecture
title: Stable paper canvas, motion and arrow routing
description: G6 and Motion ownership, incremental drawing, stable camera framing, live captions, sketch routing, decorations, and Cara's visual state.
tags: [canvas, g6, motion, frontend, routing]
verified:
  - by: openwiki/0.5.2
    at: 2026-10-20T22:38:50.689Z
sources:
  - id: openwiki-source-28b4d8cdf9e1063378426959
    resource: repo://frontend/app.js
  - id: openwiki-source-bdd6d583f725b678a673a28a
    resource: repo://frontend/edge-geometry.js
  - id: openwiki-source-9242615f5f53e7b112f8979e
    resource: repo://frontend/graph-edge-routes.js
  - id: openwiki-source-47d5ca3516c452a7f3853643
    resource: repo://frontend/speech-ribbon.js
  - id: openwiki-source-e25792b93f9de79a2effd38c
    resource: repo://frontend/viewport-motion.js
  - id: openwiki-source-eb8adc16b7f8b91bf467d12f
    resource: repo://frontend/voice-output-mute.js
generated: { by: "codex", at: "2026-10-20T22:38:50.689Z" }
---

# Stable paper canvas, motion and arrow routing

`frontend/app.js` is the live browser entrypoint. `frontend/build.js` bundles it into `static/app.js`; editing source requires `pnpm build`. FastAPI serves that bundle and the audio SDK assets. The application is vanilla JavaScript, not React or a separate frontend server.

## Drawing and visual ownership

G6 owns the graph, coordinates, selection/dragging and camera. `sketch-elements.js` implements seeded Rough.js node/edge shapes; `sketch-style.js` defines anchor, section, note, annotation and action roles. `graph-hierarchy.js` derives main/supporting roles from relationships. `note-paper.js`, `paper-background.js`, `sketch-icons.js` and `morphing-controls.js` supply paper and ink presentation. Preserve the paper/blue-ink design and per-datum style callbacks when changing G6 defaults.

The app serializes graph events through `renderChain`. First initialization uses `graph.render()`; later updates use incremental `graph.draw()`. Existing cards are not faded and re-inked for every label or illustration update. `sketch-motion.js` animates new drawProgress values in dependency order, coalesces canvas draws, respects abort/reset, and remembers completed IDs. Reframing runs independently of drawing so incoming patches do not wait for a camera animation.

## Camera and routing invariants

`viewport-motion.js` calculates target bounds without moving the camera to measure them. It works with G6's three-component points but emits finite two-dimensional pan deltas. In-view changes do not reframe; automatic fits do not zoom in. New bounds retarget smoothly, while repeated bounds do not restart the same animation. Dragging/wheel input gives the user control; an explicit Fit map resumes framing. Resize preserves the visible origin before fitting the new space. Reset and dispose cancel stale camera work.

`graph-edge-routes.js` plans short links before long skip links, reserves stable attachment lanes, avoids card/artwork footprints and considers occupied routes. Long links skipping a row prefer an exterior sweeping curve. `edge-geometry.js` supplies seeded gestures, collision routing and tangent-continuous smoothing; do not restore a square-corner fallback or decorative knot loops on semantic links. `refreshEdgeRoutes` invalidates geometry after dragging/rearranging. `sketch-layout.js` owns animated horizontal, vertical and reverse arrangements.

## Speech and controls

`speech-ribbon.js` draws a bounded 240px caption lane above the talking control. Words arrive individually, spring up from below, move left as the line fills, and leave at the left edge. Full text remains in the transcript. `ui-motion.js` owns control feedback, panel/status/transcript transitions and an audio meter driven by actual SDK analyser levels; reduced motion settles decoration rather than hiding content.

`cara-avatar.js` presents Cara's listening/thinking/speaking state from real voice events and levels. `voice-output-mute.js` changes output gain while leaving the SDK analyser upstream, so muting sound does not falsify the visual speaking state. It does not mute the user's microphone.

`stable-decorations.js` and `washi-tape.js` decorate settled ideas. Applied decoration receipts carry node/render revisions to the server; only accepted completed decorations should inform Cara's reaction. Revisions, pending interpretation, rendered state and drawing completion remain distinct.

Illustrations are passive body-level overlays, clipped and offset to the graph viewport, with pointer events disabled. This placement lets multiply blend with the real paper rather than an isolated nested stacking context. See [illustrations](../integrations/illustrations.md).

## Useful checks and previews

Run focused Node tests for viewport motion, edge geometry, graph routing, sketch motion/layout, decorations, avatar and output mute when those contracts change. The local kitchen renderer is `/static/sketch-preview.html?scene=complete`; it replays supplied fixture data without a model call. Source tests establish invariants; inspect actual rendering for smoothness, routing, stacking and legibility.
