import { animate } from 'motion';

export const RESIZE_SETTLE_MS = 180;
/**
 * Camera follow while cards arrive: additions within `batchMs` share one
 * calm move that brings the newest cards comfortably into view, nudged
 * toward the visual centre. `returnMs` after the last addition (and at least
 * `restMs` after that move lands) the camera eases back to the whole map.
 */
export const FOLLOW = { batchMs: 160, returnMs: 1800, restMs: 700, duration: 1.05, overviewDuration: 1.15, pull: 0.15, comfort: 0.9, ease: [0.45, 0, 0.2, 1] };
const FIT_EASE = [.22, 1, .36, 1];
// Height of the app header that the map canvas extends beneath (see paper-theme.css).
const HEADER_BAND = 80;

function canvasSize(graph) {
  const size = graph.getSize?.() || [0, 0];
  const canvas = graph.getCanvas?.();
  const rect = canvas?.getContainer?.()?.getBoundingClientRect?.();
  const width = Number(rect?.width) > 0 ? Number(rect.width) : Number(size[0]);
  const height = Number(rect?.height) > 0 ? Number(rect.height) : Number(size[1]);
  return [Math.max(1, width || 1), Math.max(1, height || 1)];
}

function nodeBounds(graph, node) {
  const style = node.style || {};
  const extra = Number(style.illustrationSpace) || 0;
  try {
    const bounds = graph.getElementRenderBounds?.(node.id);
    if (bounds?.min && bounds?.max && bounds.min.length >= 2 && bounds.max.length >= 2
      && [bounds.min[0], bounds.min[1], bounds.max[0], bounds.max[1]].every(Number.isFinite)) {
      return [bounds.min[0] - extra - 16, bounds.min[1] - extra - 16,
        bounds.max[0] + extra + 16, bounds.max[1] + extra + 16];
    }
  } catch {
    // Elements can be removed between a streamed patch and its draw.
  }
  const size = Array.isArray(style.size) ? style.size : [style.size || 250, style.size || 148];
  const x = Number(style.x) || 0, y = Number(style.y) || 0;
  return [x - size[0] / 2 - extra - 16, y - size[1] / 2 - extra - 16,
    x + size[0] / 2 + extra + 16, y + size[1] / 2 + extra + 16];
}

/** The usable canvas inside the (drawer-aware) padding. */
function safeArea(graph) {
  const [width, height] = canvasSize(graph);
  const padding = graph.getOptions().padding || [80, 64, 132, 64];
  let [top, right, bottom, left] = typeof padding === 'number' ? Array(4).fill(padding) : padding;
  // A tall trace drawer leaves a short canvas. Insets must not consume it.
  const verticalScale = Math.min(1, height * .6 / Math.max(1, top + bottom));
  const horizontalScale = Math.min(1, width * .35 / Math.max(1, left + right));
  const configuredTop = top;
  top *= verticalScale; bottom *= verticalScale; left *= horizontalScale; right *= horizontalScale;
  // When the canvas runs up under the header (its top padding covers it),
  // shrinking insets for a short canvas must never reclaim that band.
  if (configuredTop >= HEADER_BAND) top = Math.max(top, HEADER_BAND);
  const available = [Math.max(1, width - left - right), Math.max(1, height - top - bottom)];
  return { width, height, top, right, bottom, left, available };
}

function unionBounds(graph, nodes) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const node of nodes) {
    const box = nodeBounds(graph, node);
    bounds[0] = Math.min(bounds[0], box[0]);
    bounds[1] = Math.min(bounds[1], box[1]);
    bounds[2] = Math.max(bounds[2], box[2]);
    bounds[3] = Math.max(bounds[3], box[3]);
  }
  return bounds;
}

/**
 * A follow move for newly added cards: zoom out only if they would not sit
 * comfortably in view, then pan so they move most of the way toward the
 * visual centre while staying wholly inside the usable canvas.
 */
export function followTarget(graph, ids) {
  const wanted = new Set(ids);
  const nodes = (graph.getData().nodes || []).filter(node => wanted.has(node.id));
  if (!nodes.length) return null;
  const { width, height, top, right, bottom, left, available } = safeArea(graph);
  const bounds = unionBounds(graph, nodes);
  const size = [Math.max(1, bounds[2] - bounds[0]), Math.max(1, bounds[3] - bounds[1])];
  const zoom = graph.getZoom();
  const origin = graph.getViewportByCanvas([0, 0]);
  const range = graph.getOptions().zoomRange || [.05, 10];
  const comfortable = Math.min(available[0] * FOLLOW.comfort / size[0], available[1] * FOLLOW.comfort / size[1]);
  const targetZoom = Math.max(range[0], Math.min(range[1], zoom, comfortable));
  // Cards already in view stay where they are: the camera moves only to
  // bring a newcomer on screen, and then just far enough.
  const seen = [bounds[0] * zoom + origin[0], bounds[1] * zoom + origin[1], bounds[2] * zoom + origin[0], bounds[3] * zoom + origin[1]];
  if (targetZoom >= zoom - 1e-6 && seen[0] >= left && seen[1] >= top && seen[2] <= width - right && seen[3] <= height - bottom) return null;
  const middle = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  const centre = [left + available[0] / 2, top + available[1] / 2];
  const safe = [left, top, width - right, height - bottom];
  const screen = middle.map((value, i) => {
    const now = value * zoom + origin[i];
    const nudged = now + (centre[i] - now) * FOLLOW.pull;
    const half = size[i] * targetZoom / 2;
    const low = safe[i] + half, high = safe[i + 2] - half;
    return low > high ? centre[i] : Math.min(high, Math.max(low, nudged));
  });
  const targetOrigin = screen.map((value, i) => value - middle[i] * targetZoom);
  if (Math.abs(targetZoom - zoom) < 1e-6 && Math.hypot(targetOrigin[0] - origin[0], targetOrigin[1] - origin[1]) < 18) return null;
  return { zoom: targetZoom, origin: targetOrigin, signature: ['follow', ...bounds, width, height].join(':') };
}

/** Compute a fit without ever moving the live camera to measure it. */
export function viewportTarget(graph, { when = 'always', preserve = false } = {}) {
  const nodes = graph.getData().nodes || [];
  if (!nodes.length) return null;
  const { width, height, top, right, bottom, left, available } = safeArea(graph);
  const bounds = unionBounds(graph, nodes);
  const origin = graph.getViewportByCanvas([0, 0]);
  const zoom = graph.getZoom();
  const safe = [left, top, width - right, height - bottom];
  const inView = [bounds[0] * zoom + origin[0], bounds[1] * zoom + origin[1], bounds[2] * zoom + origin[0], bounds[3] * zoom + origin[1]];
  // A little slack avoids camera activity from text/rounding changes at an edge.
  const centred = when === 'overflow' && inView[0] >= safe[0] - 12 && inView[1] >= safe[1] - 12 && inView[2] <= safe[2] + 12 && inView[3] <= safe[3] + 12;
  const range = graph.getOptions().zoomRange || [.05, 10];
  const fitZoom = Math.min(available[0] / Math.max(1, bounds[2] - bounds[0]), available[1] / Math.max(1, bounds[3] - bounds[1]));
  const targetZoom = Math.max(range[0], Math.min(range[1], when === 'overflow' ? zoom : 1.2, fitZoom));
  const center = [left + available[0] / 2, top + available[1] / 2];
  let targetOrigin;
  if (when !== 'overflow') {
    targetOrigin = [center[0] - (bounds[0] + bounds[2]) / 2 * targetZoom, center[1] - (bounds[1] + bounds[3]) / 2 * targetZoom];
  } else {
    if (preserve && centred) return null;
    // The map prefers the middle: centre it at the current zoom (zooming out
    // only when it no longer fits). Tiny drifts are ignored to keep it calm.
    targetOrigin = !preserve || targetZoom < zoom - 1e-6
      ? [center[0] - (bounds[0] + bounds[2]) / 2 * targetZoom, center[1] - (bounds[1] + bounds[3]) / 2 * targetZoom]
      : [origin[0], origin[1]];
    if (preserve && targetZoom === zoom) {
      if (inView[0] < safe[0]) targetOrigin[0] += safe[0] - inView[0];
      if (inView[2] > safe[2]) targetOrigin[0] -= inView[2] - safe[2];
      if (inView[1] < safe[1]) targetOrigin[1] += safe[1] - inView[1];
      if (inView[3] > safe[3]) targetOrigin[1] -= inView[3] - safe[3];
    }
    if (centred && targetZoom === zoom && Math.hypot(targetOrigin[0] - origin[0], targetOrigin[1] - origin[1]) < 18) return null;
  }
  return { zoom: targetZoom, origin: targetOrigin, signature: [...bounds, width, height].join(':') };
}

export function createViewportMotion(graph, reducedMotion, animateDriver = animate) {
  let stop = () => {}, generation = 0, userFramed = false, lastSignature = null;
  const element = document.getElementById('graph');
  const cancel = () => { generation++; stop(); };
  const invalidateFrame = () => { lastSignature = null; };
  // Follow mode lasts from a card addition until the overview return.
  let following = false, followIds = new Set(), followTimer = 0, returnTimer = 0, returnAt = 0;
  const stopFollow = () => {
    clearTimeout(followTimer); clearTimeout(returnTimer);
    followTimer = returnTimer = 0; followIds.clear(); following = false;
  };
  const armReturn = delay => {
    clearTimeout(returnTimer);
    returnAt = Date.now() + delay;
    returnTimer = setTimeout(returnToOverview, delay);
  };
  let pointer = null;
  const pointerDown = event => { pointer = [event.clientX, event.clientY]; stopFollow(); invalidateFrame(); cancel(); };
  const pointerMove = event => {
    if (pointer && Math.hypot(event.clientX - pointer[0], event.clientY - pointer[1]) > 6) {
      userFramed = true;
      invalidateFrame();
    }
  };
  const pointerUp = () => { pointer = null; };
  const wheel = () => { userFramed = true; stopFollow(); invalidateFrame(); cancel(); };
  element.addEventListener('pointerdown', pointerDown);
  element.addEventListener('pointermove', pointerMove);
  element.addEventListener('pointerup', pointerUp);
  element.addEventListener('pointercancel', pointerUp);
  element.addEventListener('wheel', wheel, { passive: true });
  let resizeOrigin = null;
  const beforeResize = () => {
    invalidateFrame();
    cancel();
    try { resizeOrigin = graph.getViewportByCanvas([0, 0]).slice(0, 2); } catch { resizeOrigin = null; }
  };
  // A drawer drag resizes every frame: keep the camera still while it moves
  // and refit once, smoothly, after the size has settled.
  let settleTimer = 0;
  const afterResize = async () => {
    if (resizeOrigin) {
      const current = graph.getViewportByCanvas([0, 0]);
      await graph.translateBy(resizeOrigin.map((v, i) => v - current[i]), false);
      resizeOrigin = null;
    }
    invalidateFrame();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      void controller.fit({ when: 'overflow', preserveUser: true }).catch(console.error);
    }, RESIZE_SETTLE_MS);
  };
  const resized = () => { void afterResize().catch(console.error); };
  graph.on?.('beforesizechange', beforeResize);
  graph.on?.('aftersizechange', resized);
  // The trace drawer and side panel change the container without a window
  // resize, so follow the container itself. G6 ignores same-size resizes.
  let resizeFrame = 0;
  const observer = globalThis.ResizeObserver && element ? new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { try { graph.resize?.(); } catch (error) { console.error(error); } });
  }) : null;
  observer?.observe(element);
  const move = async (target, { immediate = false, duration = .6, ease = FIT_EASE } = {}) => {
    cancel();
    const current = generation;
    const from = { zoom: graph.getZoom(), origin: graph.getViewportByCanvas([0, 0]).slice(0, 2) };
    let latest = 0, applied = -1, pending = null, failure = null;
    const apply = () => {
      if (pending || failure) return;
      pending = (async () => {
        while (current === generation && applied !== latest) {
          const progress = latest; applied = progress;
          const zoom = from.zoom + (target.zoom - from.zoom) * progress;
          await graph.zoomTo(zoom, false, [0, 0]);
          if (current !== generation) return;
          const origin = graph.getViewportByCanvas([0, 0]);
          await graph.translateBy(from.origin.map((v, i) => v + (target.origin[i] - v) * progress - origin[i]), false);
        }
      })().catch(error => { failure = error; stop(); }).finally(() => { pending = null; });
    };
    if (immediate || reducedMotion()) { latest = 1; apply(); }
    else await new Promise(resolve => {
      const controls = animateDriver(0, 1, {
        duration, ease,
        onUpdate: value => { latest = value; apply(); },
        onComplete: () => { latest = 1; apply(); resolve(); },
      });
      stop = () => { controls.stop(); resolve(); };
    });
    if (pending) await pending;
    if (failure) throw failure;
    return current === generation;
  };
  const runFollow = async () => {
    followTimer = 0;
    const ids = [...followIds];
    followIds.clear();
    if (!following || userFramed || pointer) return;
    const target = followTarget(graph, ids);
    if (!target) return;
    invalidateFrame();
    const landed = await move(target, { duration: FOLLOW.duration, ease: FOLLOW.ease });
    // Give the viewer a moment on the new cards before the overview.
    if (landed && following && returnAt - Date.now() < FOLLOW.restMs) armReturn(FOLLOW.restMs);
  };
  function returnToOverview() {
    returnTimer = 0;
    if (!following) return;
    following = false;
    if (userFramed || pointer) return;
    invalidateFrame();
    void controller.fit({ when: 'overflow', duration: FOLLOW.overviewDuration }).catch(console.error);
  }
  const controller = {
    async fit(options = {}) {
      const automatic = options.when === 'overflow';
      if (automatic && pointer) return;
      // While following new cards, routine reframes wait for the overview
      // return; a drawer resize (preserveUser) still keeps content in view.
      if (automatic && following && !options.preserveUser) return;
      if (!automatic) stopFollow();
      // Incoming cards and a resized canvas may invalidate a user frame only
      // when the rendered bounds actually leave the usable canvas.
      const preserve = Boolean(options.preserveUser || (automatic && userFramed));
      const canvas = graph.getCanvas?.();
      const container = canvas?.getContainer?.();
      const rect = container?.getBoundingClientRect?.();
      const size = graph.getSize?.() || [0, 0];
      if (rect && rect.width > 0 && rect.height > 0
        && (Math.abs(rect.width - size[0]) > 1 || Math.abs(rect.height - size[1]) > 1)) graph.resize?.();
      const target = viewportTarget(graph, { ...options, preserve });
      if (!target || (automatic && !preserve && target.signature === lastSignature)) return;
      if (!automatic && !options.preserveUser) userFramed = false;
      cancel();
      lastSignature = target.signature;
      await move(target, { immediate: options.immediate, duration: options.duration });
    },
    /** Follow newly added cards; skipped once the user has framed the map. */
    follow(ids = []) {
      if (!ids.length) return;
      if (userFramed || pointer || reducedMotion()) { stopFollow(); return; }
      following = true;
      for (const id of ids) followIds.add(id);
      clearTimeout(followTimer);
      followTimer = setTimeout(() => { void runFollow().catch(console.error); }, FOLLOW.batchMs);
      armReturn(FOLLOW.returnMs);
    },
    cancel,
    reset() { userFramed = false; lastSignature = null; stopFollow(); cancel(); },
    dispose() {
      cancel();
      stopFollow();
      clearTimeout(settleTimer);
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      observer?.disconnect();
      element.removeEventListener('pointerdown', pointerDown);
      element.removeEventListener('pointermove', pointerMove);
      element.removeEventListener('pointerup', pointerUp);
      element.removeEventListener('pointercancel', pointerUp);
      element.removeEventListener('wheel', wheel);
      graph.off?.('beforesizechange', beforeResize);
      graph.off?.('aftersizechange', resized);
    },
  };
  return controller;
}
