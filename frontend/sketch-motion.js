import { animate } from 'motion';

/**
 * Small, renderer-agnostic entrance animation for sketch elements.
 *
 * Custom G6 elements read `style.drawProgress` and use it to reveal their
 * Rough.js geometry. Keeping the animation here means the graph data remains
 * untouched: only the transient style value is updated frame by frame.
 */

const DEFAULT_DURATION = 240;
const renderState = new WeakMap();

// A graph may be redrawn after every streamed patch. Remember which element
// ids have completed their entrance so a later patch does not replay them.
const entranceState = new WeakMap();

function stateFor(graph) {
  let state = entranceState.get(graph);
  if (!state) {
    state = {
      cancellations: new Set(),
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

function setProgress(graph, kind, id, progress) {
  const patch = [{ id, style: { drawProgress: progress } }];
  if (kind === 'node') graph.updateNodeData(patch);
  else graph.updateEdgeData(patch);
  requestDraw(graph);
}

async function animateElement(graph, kind, id, duration, signal, state, animateDriver) {
  const valid = () => !signal?.aborted && entranceState.get(graph) === state;
  if (!valid()) return false;
  setProgress(graph, kind, id, 0);
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
      ease: 'easeOut',
      onUpdate: (progress) => {
        if (valid()) setProgress(graph, kind, id, progress);
      },
      onComplete: () => { finished = true; settle(); },
    });
    await completion;
    if (finished && valid()) setProgress(graph, kind, id, 1);
    await flushDraw(graph);
    return finished && valid();
  } finally {
    signal?.removeEventListener('abort', cancel);
    state.cancellations.delete(cancel);
  }
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

async function runElement(graph, kind, id, state, reducedMotion, duration, signal, animateDriver) {
  const elementState = state[kind === 'node' ? 'nodes' : 'edges'];
  if (elementState.complete.has(id) || elementState.active.has(id)) return true;
  elementState.active.add(id);
  try {
    const finished = reducedMotion
      ? (setProgress(graph, kind, id, 1), await flushDraw(graph), true)
      : await animateElement(graph, kind, id, Math.max(1, duration), signal, state, animateDriver);
    if (finished) elementState.complete.add(id);
    return finished;
  } finally {
    elementState.active.delete(id);
  }
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
    duration = DEFAULT_DURATION,
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

  const elementDuration = Math.min(duration, 280 / Math.max(1, plan.length));
  for (const { kind, id } of plan) {
    if (signal?.aborted || entranceState.get(graph) !== state) return;
    const finished = await runElement(graph, kind, id, state, reducedMotion, elementDuration, signal, animateDriver);
    if (!finished || signal?.aborted) return;
  }
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
