import { sketchEdgeRoute, smoothSketchRoute, outsideSketchRoute } from './edge-geometry.js';

const cache = new WeakMap();
const STUB = 28;
function seedOf(id) {
  let seed = 2166136261;
  for (const character of String(id)) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return seed >>> 0;
}
function card(node) {
  const style = node.style || {};
  const size = Array.isArray(style.size) ? style.size : [220, 120];
  const scale = 1 + .075 * Math.max(0, Math.min(1, style.liftProgress || 0));
  return { id: node.id, cx: Number(style.x) || 0, cy: Number(style.y) || 0,
    width: Number(size[0]) * scale, height: Number(size[1]) * scale,
    gutter: Math.max(0, Number(style.illustrationSpace) || 0) };
}
function intersects(a, b, box) {
  let low = 0, high = 1;
  for (let axis = 0; axis < 2; axis++) {
    const delta = b[axis] - a[axis];
    const center = axis ? box.cy : box.cx;
    const half = (axis ? box.height : box.width) / 2 + 12;
    if (Math.abs(delta) < .001) { if (a[axis] < center - half || a[axis] > center + half) return false; }
    else {
      const first = (center - half - a[axis]) / delta, last = (center + half - a[axis]) / delta;
      low = Math.max(low, Math.min(first, last)); high = Math.min(high, Math.max(first, last));
      if (low > high) return false;
    }
  }
  return true;
}
function faces(a, b, cards) {
  const horizontal = Math.abs(b.cx - a.cx) >= Math.abs(b.cy - a.cy);
  const blocked = cards.some(box => box.id !== a.id && box.id !== b.id && intersects([a.cx, a.cy], [b.cx, b.cy], box));
  // Skip links go outside the row/column instead of through its short links.
  if (blocked) return horizontal ? ['bottom', 'bottom'] : ['left', 'left'];
  const source = horizontal ? b.cx >= a.cx ? 'right' : 'left' : b.cy >= a.cy ? 'bottom' : 'top';
  const target = { right: 'left', left: 'right', bottom: 'top', top: 'bottom' }[source];
  return [source === 'right' && a.gutter ? 'bottom' : source, target === 'right' && b.gutter ? 'bottom' : target];
}
function attachment(box, side, lane) {
  const horizontal = side === 'left' || side === 'right';
  const limit = Math.max(0, (horizontal ? box.height : box.width) / 2 - 22);
  const offset = Math.max(-limit, Math.min(limit, lane * 12));
  const normal = side === 'left' ? [-1, 0] : side === 'right' ? [1, 0] : side === 'top' ? [0, -1] : [0, 1];
  const point = [box.cx + (horizontal ? normal[0] * box.width / 2 : offset), box.cy + (horizontal ? offset : normal[1] * box.height / 2)];
  return { point, stub: point.map((v, i) => v + normal[i] * STUB) };
}
function line(a, b) { return ['C', a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3, a[0] + (b[0] - a[0]) * 2 / 3, a[1] + (b[1] - a[1]) * 2 / 3, ...b]; }
function attach(route, a, b) {
  const path = [['M', ...a.point], line(a.point, a.stub), ...route.path.slice(1), line(b.stub, b.point)];
  return smoothSketchRoute({ path });
}

/** Short connections claim channels; long skip links travel outside the cards. */
export function graphEdgeRoute(graph, id, source, target, seed) {
  if (!graph?.getNodeData || !graph?.getEdgeData) return sketchEdgeRoute(source, target, seed, { loop: false });
  const cards = graph.getNodeData().map(card), edges = graph.getEdgeData();
  const key = JSON.stringify([cards, edges.map(edge => [edge.id, edge.source, edge.target, edge.style?.edgeRole, edge.style?.seed])]);
  let state = cache.get(graph);
  if (state?.key !== key) {
    const byId = new Map(cards.map(box => [box.id, box]));
    const obstacles = cards.flatMap(box => [
      { id: box.id, x: box.cx - box.width / 2, y: box.cy - box.height / 2, width: box.width, height: box.height },
      ...(box.gutter ? [{ id: `${box.id}:art`, x: box.cx + box.width / 2 + 8, y: box.cy - 80, width: box.gutter - 8, height: 160 }] : []),
    ]);
    const length = edge => { const a = byId.get(edge.source), b = byId.get(edge.target); return a && b ? Math.hypot(b.cx - a.cx, b.cy - a.cy) : Infinity; };
    const ordered = [...edges].sort((a, b) => length(a) - length(b)
      || Number(b.style?.edgeRole === 'primary') - Number(a.style?.edgeRole === 'primary') || String(a.id).localeCompare(String(b.id)));
    const routes = new Map(), ports = new Map(), used = new Map();
    function lane(edge, node, side, end) {
      const portKey = `${node.id}:${side}:${edge.id}:${end}`;
      const bucket = `${node.id}:${side}`;
      const taken = used.get(bucket) || new Set();
      let value = state?.ports?.get(portKey);
      if (value === undefined) value = [0, -1, 1, -2, 2, -3, 3, -4, 4].find(v => !taken.has(v)) ?? taken.size;
      taken.add(value); used.set(bucket, taken); ports.set(portKey, value); return value;
    }
    // Reserve established attachment lanes before a new edge can claim one.
    for (const edge of ordered) {
      const a = byId.get(edge.source), b = byId.get(edge.target);
      if (!a || !b) continue;
      const sides = faces(a, b, cards);
      for (const [node, side, end] of [[a, sides[0], 'source'], [b, sides[1], 'target']]) {
        const value = state?.ports?.get(`${node.id}:${side}:${edge.id}:${end}`);
        if (value !== undefined) {
          const bucket = `${node.id}:${side}`, taken = used.get(bucket) || new Set();
          taken.add(value); used.set(bucket, taken);
        }
      }
    }
    for (const edge of ordered) {
      const a = byId.get(edge.source), b = byId.get(edge.target);
      if (!a || !b) continue;
      const [sideA, sideB] = faces(a, b, cards);
      const start = attachment(a, sideA, lane(edge, a, sideA, 'source'));
      const end = attachment(b, sideB, lane(edge, b, sideB, 'target'));
      const outside = sideA === sideB ? outsideSketchRoute(start.point, end.point, sideA, {
        sourceId: edge.source, targetId: edge.target, obstacles, occupiedRoutes: [...routes.values()],
      }) : null;
      if (outside) { routes.set(String(edge.id), outside); continue; }
      const route = sketchEdgeRoute(start.stub, end.stub, edge.style?.seed || seedOf(edge.id), {
        obstacles, occupiedRoutes: [...routes.values()], loop: false,
      });
      routes.set(String(edge.id), attach(route, start, end));
    }
    state = { key, routes, ports }; cache.set(graph, state);
  }
  return state.routes.get(String(id)) || sketchEdgeRoute(source, target, seed, { loop: false });
}
export async function refreshEdgeRoutes(graph) {
  graph.updateEdgeData(graph.getEdgeData().map(edge => ({ id: edge.id, style: { routeRevision: (edge.style?.routeRevision || 0) + 1 } })));
  await graph.draw();
}
