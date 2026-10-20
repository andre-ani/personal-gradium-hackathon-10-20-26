import { animate } from 'motion';

/** Compute a fit without ever moving the live camera to measure it. */
export function viewportTarget(graph, { when = 'always' } = {}) {
  const nodes = graph.getData().nodes || [];
  if (!nodes.length) return null;
  const [width, height] = graph.getSize();
  const padding = graph.getOptions().padding || [80, 64, 132, 64];
  const [top, right, bottom, left] = typeof padding === 'number' ? Array(4).fill(padding) : padding;
  const available = [Math.max(1, width - left - right), Math.max(1, height - top - bottom)];
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const node of nodes) {
    const style = node.style || {};
    const size = Array.isArray(style.size) ? style.size : [style.size || 250, style.size || 148];
    const x = Number(style.x) || 0, y = Number(style.y) || 0;
    const extra = Number(style.illustrationSpace) || 0;
    const halfHeight = Math.max(size[1] / 2, extra ? 80 : 0);
    bounds[0] = Math.min(bounds[0], x - size[0] / 2 - 16);
    bounds[1] = Math.min(bounds[1], y - halfHeight - 16);
    bounds[2] = Math.max(bounds[2], x + size[0] / 2 + extra + 16);
    bounds[3] = Math.max(bounds[3], y + halfHeight + 16);
  }
  const origin = graph.getViewportByCanvas([0, 0]);
  const zoom = graph.getZoom();
  const safe = [left, top, width - right, height - bottom];
  const inView = [bounds[0] * zoom + origin[0], bounds[1] * zoom + origin[1], bounds[2] * zoom + origin[0], bounds[3] * zoom + origin[1]];
  // A little slack avoids camera activity from text/rounding changes at an edge.
  if (when === 'overflow' && inView[0] >= safe[0] - 12 && inView[1] >= safe[1] - 12 && inView[2] <= safe[2] + 12 && inView[3] <= safe[3] + 12) return null;
  const range = graph.getOptions().zoomRange || [.05, 10];
  const fitZoom = Math.min(available[0] / Math.max(1, bounds[2] - bounds[0]), available[1] / Math.max(1, bounds[3] - bounds[1]));
  const targetZoom = Math.max(range[0], Math.min(range[1], when === 'overflow' ? zoom : 1.2, fitZoom));
  const center = [left + available[0] / 2, top + available[1] / 2];
  let targetOrigin;
  if (when !== 'overflow') {
    targetOrigin = [center[0] - (bounds[0] + bounds[2]) / 2 * targetZoom, center[1] - (bounds[1] + bounds[3]) / 2 * targetZoom];
  } else {
    // Keep the current focal point, then pan only as far as the new extent needs.
    const anchor = graph.getCanvasByViewport(center);
    targetOrigin = center.map((v, i) => v - anchor[i] * targetZoom);
    for (let axis = 0; axis < 2; axis++) {
      const min = bounds[axis] * targetZoom + targetOrigin[axis];
      const max = bounds[axis + 2] * targetZoom + targetOrigin[axis];
      targetOrigin[axis] += min < safe[axis] ? safe[axis] - min : max > safe[axis + 2] ? safe[axis + 2] - max : 0;
    }
  }
  return { zoom: targetZoom, origin: targetOrigin, signature: [...bounds, width, height].join(':') };
}

export function createViewportMotion(graph, reducedMotion, animateDriver = animate) {
  let stop = () => {}, generation = 0, userFramed = false, lastSignature = null;
  const element = document.getElementById('graph');
  const cancel = () => { generation++; stop(); };
  let pointer = null;
  const pointerDown = event => { pointer = [event.clientX, event.clientY]; cancel(); };
  const pointerMove = event => {
    if (pointer && Math.hypot(event.clientX - pointer[0], event.clientY - pointer[1]) > 6) userFramed = true;
  };
  const pointerUp = () => { pointer = null; };
  const wheel = () => { userFramed = true; cancel(); };
  element.addEventListener('pointerdown', pointerDown);
  element.addEventListener('pointermove', pointerMove);
  element.addEventListener('pointerup', pointerUp);
  element.addEventListener('pointercancel', pointerUp);
  element.addEventListener('wheel', wheel, { passive: true });
  let resizeOrigin = null;
  const beforeResize = () => {
    cancel();
    try { resizeOrigin = graph.getViewportByCanvas([0, 0]).slice(0, 2); } catch { resizeOrigin = null; }
  };
  const afterResize = async () => {
    if (resizeOrigin) {
      const current = graph.getViewportByCanvas([0, 0]);
      await graph.translateBy(resizeOrigin.map((v, i) => v - current[i]), false);
      resizeOrigin = null;
    }
    await controller.fit({ when: 'overflow' });
  };
  const resized = () => { void afterResize().catch(console.error); };
  graph.on?.('beforesizechange', beforeResize);
  graph.on?.('aftersizechange', resized);
  const controller = {
    async fit(options = {}) {
      const automatic = options.when === 'overflow';
      if (automatic && userFramed) return;
      const target = viewportTarget(graph, options);
      if (!target || (automatic && target.signature === lastSignature)) return;
      if (!automatic) userFramed = false;
      cancel();
      lastSignature = target.signature;
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
      if (reducedMotion()) { latest = 1; apply(); }
      else await new Promise(resolve => {
        const controls = animateDriver(0, 1, {
          duration: .6, ease: [.22, 1, .36, 1],
          onUpdate: value => { latest = value; apply(); },
          onComplete: () => { latest = 1; apply(); resolve(); },
        });
        stop = () => { controls.stop(); resolve(); };
      });
      if (pending) await pending;
      if (failure) throw failure;
    },
    cancel,
    reset() { userFramed = false; lastSignature = null; cancel(); },
    dispose() {
      cancel();
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
