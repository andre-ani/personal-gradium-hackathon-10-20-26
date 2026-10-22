import { animate } from 'motion';

/**
 * Small, renderer-agnostic entrance animation for sketch elements.
 *
 * Custom G6 elements read `style.drawProgress` and use it to reveal their
 * Rough.js geometry. Keeping the animation here means the graph data remains
 * untouched: only the transient style value is updated frame by frame.
 */

/**
 * Entrance timings. Arrows are inked like a pen stroke: a gentle ease in and
 * out over a duration scaled by the connector's length, with the arrowhead
 * appearing only at the end (SketchEdge shows it from progress 0.98). Cards
 * are placed like sticky notes: they arrive lifted, drop onto the paper with a
 * small press, and only then write their words. New elements are drawn one
 * after another with a short pause between them; durations never shrink for a
 * big batch.
 */
export const EDGE_DRAW = { min: 600, max: 1300, base: 520, perPixel: 1.1, fallbackLength: 300, ease: [0.55, 0.06, 0.32, 1] };
export const CARD_LANDING = { duration: 900, appear: 0.3, drop: 0.78, press: 0.08 };
/** Pause (ms) between one element finishing and the next starting. */
export const ENTRANCE_STAGGER = 260;

/** Pen duration (ms) for a connector of `length` canvas pixels. */
export function edgeDrawDuration(length) {
  const ink = Number.isFinite(length) && length > 0 ? length : EDGE_DRAW.fallbackLength;
  return Math.round(Math.min(EDGE_DRAW.max, Math.max(EDGE_DRAW.min, EDGE_DRAW.base + ink * EDGE_DRAW.perPixel)));
}

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

/**
 * One frame of a card being placed, for linear time `t` in [0, 1]:
 * the paper fades in while held up (lift 1), drops flat by `drop`, then a
 * tiny press below the paper (negative lift) settles back to rest. Its words
 * stay held until the landing is complete.
 */
export function cardLandingFrame(t) {
  const p = Math.min(1, Math.max(0, Number(t) || 0));
  if (p >= 1) return { drawProgress: 1, liftProgress: 0, textHold: false };
  const { appear, drop, press } = CARD_LANDING;
  const drawProgress = easeOutCubic(Math.min(1, p / appear));
  const lift = p < drop
    ? 1 - easeInOutSine(p / drop)
    : -press * Math.sin(Math.PI * (p - drop) / (1 - drop));
  return { drawProgress, liftProgress: Math.round(lift * 10000) / 10000, textHold: true };
}

const edgeFrame = (value) => ({ drawProgress: value });
const renderState = new WeakMap();

// A graph may be redrawn after every streamed patch. Remember which element
// ids have completed their entrance so a later patch does not replay them.
const entranceState = new WeakMap();

function stateFor(graph) {
  let state = entranceState.get(graph);
  if (!state) {
    state = {
      cancellations: new Set(),
      inflight: new Map(),
      nodes: { active: new Set(), complete: new Set() },
      edges: { active: new Set(), complete: new Set() },
    };
    entranceState.set(graph, state);
  }
  return state;
}

function idOf(item) {
  if (item === null || item === undefined) return undefined;
  if (typeof item === 'string' || typeof item === 'number') return item;
  return item.id ?? item.data?.id;
}

// One in-flight draw and one dirty bit per graph: Motion updates remain
// synchronous even when the canvas renderer returns a slow promise.
function requestDraw(graph) {
  let render = renderState.get(graph);
  if (!render) {
    render = { pending: null, dirty: false, error: null };
    renderState.set(graph, render);
  }
  render.dirty = true;
  if (!render.pending) {
    render.pending = Promise.resolve().then(async () => {
      try {
        while (render.dirty) {
          render.dirty = false;
          await graph.draw?.();
        }
      } catch (error) {
        render.error = error;
        render.dirty = false;
      } finally {
        render.pending = null;
      }
    });
  }
  return render.pending;
}

async function flushDraw(graph) {
  const render = renderState.get(graph);
  if (render?.pending) await render.pending;
  if (render?.error) {
    const error = render.error;
    render.error = null;
    throw error;
  }
}

function setStyle(graph, kind, id, style) {
  const patch = [{ id, style }];
  if (kind === 'node') graph.updateNodeData(patch);
  else graph.updateEdgeData(patch);
  requestDraw(graph);
}

const finalStyle = (kind) => (kind === 'node' ? cardLandingFrame(1) : edgeFrame(1));

async function animateElement(graph, kind, id, { duration, ease, frame }, signal, state, animateDriver) {
  const valid = () => !signal?.aborted && entranceState.get(graph) === state;
  if (!valid()) return false;
  setStyle(graph, kind, id, frame(0));
  let controls;
  let finished = false;
  let settle;
  const completion = new Promise((resolve) => { settle = resolve; });
  const cancel = () => {
    controls?.stop();
    settle();
  };
  state.cancellations.add(cancel);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    controls = animateDriver(0, 1, {
      duration: duration / 1000,
      ease,
      onUpdate: (value) => {
        if (valid()) setStyle(graph, kind, id, frame(value));
      },
      onComplete: () => { finished = true; settle(); },
    });
    await completion;
    if (finished && valid()) setStyle(graph, kind, id, frame(1));
    await flushDraw(graph);
    return finished && valid();
  } finally {
    signal?.removeEventListener('abort', cancel);
    state.cancellations.delete(cancel);
  }
}

/** Resolve after `ms`, or early (false) on abort or reset. */
function pause(ms, signal, state) {
  if (!(ms > 0)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer;
    const cancel = () => { clearTimeout(timer); done(false); };
    const done = (value) => {
      state.cancellations.delete(cancel);
      signal?.removeEventListener('abort', cancel);
      resolve(value);
    };
    timer = setTimeout(() => done(true), ms);
    state.cancellations.add(cancel);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

function nodePoint(graph, id) {
  try {
    const point = graph.getElementPosition?.(id);
    if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])) return point;
  } catch {
    // Not rendered yet; fall back to its data.
  }
  try {
    const data = graph.getNodeData?.(id);
    const style = (Array.isArray(data) ? data[0] : data)?.style;
    if (Number.isFinite(style?.x) && Number.isFinite(style?.y)) return [style.x, style.y];
  } catch {
    // Removed between patches.
  }
  return null;
}

/** Centre-to-centre length of a connector, when its cards are placed. */
function edgeLength(graph, endpoints) {
  if (!endpoints) return undefined;
  const a = nodePoint(graph, endpoints.source);
  const b = nodePoint(graph, endpoints.target);
  return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : undefined;
}

function motionFor(graph, kind, item, id) {
  if (kind === 'node') return { duration: CARD_LANDING.duration, ease: 'linear', frame: cardLandingFrame };
  return { duration: edgeDrawDuration(edgeLength(graph, edgeEndpoints(graph, item, id))), ease: EDGE_DRAW.ease, frame: edgeFrame };
}

function uniqueWork(items, elementState) {
  const seen = new Set();
  return items
    .map((item) => ({ item, id: idOf(item) }))
    .filter(({ id }) => {
      if (id === undefined || seen.has(id) || elementState.complete.has(id) || elementState.active.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function edgeEndpoints(graph, item, id) {
  const direct = item && typeof item === 'object' ? item.data || item : null;
  let source = direct?.source;
  let target = direct?.target;

  if ((source === undefined || target === undefined) && typeof graph.getEdgeData === 'function') {
    try {
      const edge = graph.getEdgeData(id);
      const data = Array.isArray(edge) ? edge[0] : edge;
      source ??= data?.source;
      target ??= data?.target;
    } catch {
      // An edge can be removed between a streamed patch and this lookup.
    }
  }

  if (source === undefined || target === undefined) return null;
  return { source, target };
}

function dependencyPlan(graph, nodeWork, edgeWork, state) {
  // Older/mocked graph objects have no endpoint metadata. Preserve the simple
  // edges-first behavior for them instead of guessing at dependencies.
  if (typeof graph.getEdgeData !== 'function' || !edgeWork.length) return null;

  const edges = edgeWork.map(({ item, id }) => ({ item, id, endpoints: edgeEndpoints(graph, item, id) }));
  if (edges.every(({ endpoints }) => endpoints === null)) return null;

  const pendingNodes = new Set(nodeWork.map(({ id }) => id));
  const pendingEdges = new Map(edges.map((edge) => [edge.id, edge]));
  const visibleNodes = new Set(state.nodes.complete);
  const ordered = [];

  const nodeVisible = (id) => {
    if (state.nodes.active.has(id)) return false;
    return visibleNodes.has(id) || !pendingNodes.has(id);
  };
  const edgeReady = ({ endpoints }) => !endpoints || nodeVisible(endpoints.source);
  const nodeReady = (id) => {
    if (state.nodes.active.has(id)) return false;
    // A target node appears after every newly animated incoming edge. This
    // keeps its first frame from being hidden behind an unfinished connector.
    return edges.every(({ endpoints, id: edgeId }) => {
      if (!endpoints || endpoints.target !== id || !pendingEdges.has(edgeId)) return true;
      return state.edges.complete.has(edgeId);
    });
  };

  while (pendingNodes.size || pendingEdges.size) {
    let progress = false;

    // Keep caller order deterministic. A root (no incoming new edge) therefore
    // appears before its outgoing connector, then the connector's target.
    for (const entry of nodeWork) {
      if (!pendingNodes.has(entry.id) || !nodeReady(entry.id)) continue;
      pendingNodes.delete(entry.id);
      visibleNodes.add(entry.id);
      ordered.push({ kind: 'node', ...entry });
      progress = true;
      break;
    }
    if (progress) continue;

    for (const entry of edges) {
      if (!pendingEdges.has(entry.id) || !edgeReady(entry)) continue;
      pendingEdges.delete(entry.id);
      ordered.push({ kind: 'edge', item: entry.item, id: entry.id });
      progress = true;
      break;
    }
    if (progress) continue;

    // A cycle has no source node that can be revealed first. Break it by
    // revealing one remaining node, then the dependency loop can continue.
    const fallbackNode = nodeWork.find(({ id }) => pendingNodes.has(id));
    if (fallbackNode) {
      pendingNodes.delete(fallbackNode.id);
      visibleNodes.add(fallbackNode.id);
      ordered.push({ kind: 'node', ...fallbackNode });
      continue;
    }

    // Unknown endpoints or a dangling graph should never make the animation
    // hang. Finish the remaining connectors in input order.
    const fallbackEdge = edges.find(({ id }) => pendingEdges.has(id));
    if (fallbackEdge) {
      pendingEdges.delete(fallbackEdge.id);
      ordered.push({ kind: 'edge', item: fallbackEdge.item, id: fallbackEdge.id });
      continue;
    }
  }

  return ordered;
}

async function runReduced(graph, kind, id, state) {
  const elementState = state[kind === 'node' ? 'nodes' : 'edges'];
  if (elementState.complete.has(id) || elementState.active.has(id)) return true;
  setStyle(graph, kind, id, finalStyle(kind));
  await flushDraw(graph);
  elementState.complete.add(id);
  return true;
}

/**
 * Reveal new graph elements in dependency order. When endpoint metadata is
 * unavailable, this falls back to edges first, then nodes.
 *
 * `nodes` and `edges` may contain ids or G6 data objects. Pass an
 * AbortSignal when a graph reset or a newer render should stop the sequence.
 * Cancellation resolves quietly, which keeps streamed updates from creating
 * unhandled promise rejections. Call resetSketchEntrance(graph) when a reset
 * should allow the same ids to animate again.
 */
export async function drawSketchEntrance(
  graph,
  {
    nodes = [],
    edges = [],
    reducedMotion = false,
    stagger = ENTRANCE_STAGGER,
    sequential = true,
    signal,
    animateDriver = animate,
  } = {},
) {
  if (!graph) return;
  const state = stateFor(graph);

  const nodeWork = uniqueWork(nodes, state.nodes);
  const edgeWork = uniqueWork(edges, state.edges);
  const plan = dependencyPlan(graph, nodeWork, edgeWork, state) || [
    ...edgeWork.map((entry) => ({ kind: 'edge', ...entry })),
    ...nodeWork.map((entry) => ({ kind: 'node', ...entry })),
  ];

  if (reducedMotion) {
    for (const { kind, id } of plan) {
      if (signal?.aborted || entranceState.get(graph) !== state) return;
      await runReduced(graph, kind, id, state);
    }
    return;
  }

  // Each element starts a short pause after the previous one has finished
  // (or, when not sequential, after it started), and never
  // before what it depends on (a connector's source card, a card's incoming
  // connectors) has finished, including ones still running from an earlier
  // call. Plan order is therefore also start order.
  const key = (kind, id) => `${kind}:${id}`;
  const runs = [];
  let previousStart = null;
  for (const entry of plan) {
    const { kind, item, id } = entry;
    const elementState = state[kind === 'node' ? 'nodes' : 'edges'];
    const endpoints = kind === 'edge' ? edgeEndpoints(graph, item, id) : null;
    // Plan order puts a card's incoming connectors (and a connector's source
    // card) earlier, so they are already registered as in flight.
    const deps = kind === 'edge'
      ? [state.inflight.get(key('node', endpoints?.source))?.run]
      : [...state.inflight.values()].filter((other) => other.kind === 'edge' && other.target === id).map((other) => other.run);
    const after = previousStart;
    let started;
    const startedPromise = new Promise((resolve) => { started = resolve; });
    elementState.active.add(id);
    const run = (async () => {
      try {
        // With nothing to wait for (the first element) it starts synchronously.
        const waits = deps.filter(Boolean);
        if (after && !(await after && await pause(stagger, signal, state))) return false;
        if (waits.length && (await Promise.all(waits)).includes(false)) return false;
        if (signal?.aborted || entranceState.get(graph) !== state) return false;
        started(true);
        const finished = await animateElement(graph, kind, id, motionFor(graph, kind, item, id), signal, state, animateDriver);
        if (finished) elementState.complete.add(id);
        return finished;
      } finally {
        started(false);
        elementState.active.delete(id);
        if (state.inflight.get(key(kind, id))?.run === run) state.inflight.delete(key(kind, id));
      }
    })();
    previousStart = sequential ? run : startedPromise;
    state.inflight.set(key(kind, id), { kind, target: endpoints?.target, run });
    runs.push(run);
  }
  await Promise.all(runs);
}

/** Clear the per-graph completed-id cache, allowing a fresh entrance pass. */
export function resetSketchEntrance(graph) {
  if (!graph) return;
  const state = entranceState.get(graph);
  entranceState.delete(graph);
  for (const cancel of state?.cancellations || []) cancel();
}


/** Briefly re-ink changed existing nodes without replaying their connectors. */
export async function animateSketchUpdates(
  graph,
  { nodes = [], reducedMotion = false, signal, duration = 160, animateDriver = animate } = {},
) {
  if (!graph || signal?.aborted) return;
  const ids = [...new Set(nodes.map(idOf).filter((id) => id !== undefined))];
  if (!ids.length) return;
  const state = stateFor(graph);
  const valid = () => !signal?.aborted && entranceState.get(graph) === state;
  const update = (progress) => {
    if (!valid()) return;
    graph.updateNodeData(ids.map((id) => ({ id, style: { drawProgress: progress } })));
    requestDraw(graph);
  };
  if (reducedMotion) {
    update(1);
    await flushDraw(graph);
    return;
  }
  let controls;
  let settle;
  let finished = false;
  const completion = new Promise((resolve) => { settle = resolve; });
  const cancel = () => { controls?.stop(); settle(); };
  state.cancellations.add(cancel);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    update(0.78);
    controls = animateDriver(0.78, 1, {
      duration: Math.min(160, Math.max(1, duration)) / 1000,
      ease: 'easeOut',
      onUpdate: update,
      onComplete: () => { finished = true; settle(); },
    });
    await completion;
    if (finished) update(1);
    await flushDraw(graph);
  } finally {
    signal?.removeEventListener('abort', cancel);
    state.cancellations.delete(cancel);
  }
}


/** Re-ink existing connectors after their new routes are settled. */
export async function redrawSketchEdges(graph, { edges = [], reducedMotion = false, signal } = {}) {
  if (signal?.aborted) return;
  const state = stateFor(graph);
  const ids = edges.map(idOf).filter(id => id !== undefined);
  for (const id of ids) state.edges.complete.delete(id);
  graph.updateEdgeData(ids.map(id => ({ id, style: { drawProgress: reducedMotion ? 1 : 0 } })));
  await graph.draw();
  await graph.showElement(ids, false);
  // Re-inking many settled routes uses a quicker stagger than new arrivals.
  await drawSketchEntrance(graph, { edges: ids, reducedMotion, signal, stagger: 60, sequential: false });
}
