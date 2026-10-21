import { addSketchLoop, sketchEdgeRoute } from './edge-geometry.js';

const cache = new WeakMap();
const NORMALS = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
const GAP = 22;
function seedOf(id) {
  let seed = 2166136261;
  for (const character of String(id)) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return seed >>> 0;
}
// Mirrors illustration-layer: only a drawn illustration occupies the sidecar.
function hasArt(node) {
  const drawing = node.data?.illustration;
  return Boolean((drawing?.image_url || drawing?.svg) && !['placeholder', 'pending'].includes(node.data?.status));
}
function card(node) {
  const style = node.style || {};
  const size = Array.isArray(style.size) ? style.size : [220, 120];
  const scale = 1 + .075 * Math.max(0, Math.min(1, style.liftProgress || 0));
  const gutter = Math.max(0, Number(style.illustrationSpace) || 0);
  return { id: node.id, cx: Number(style.x) || 0, cy: Number(style.y) || 0,
    width: Number(size[0]) * scale, height: Number(size[1]) * scale, art: gutter && hasArt(node) ? gutter : 0 };
}
function sideToward(box, vector) {
  const horizontal = Math.abs(vector[0]) / (box.width / 2 + 1) >= Math.abs(vector[1]) / (box.height / 2 + 1);
  return horizontal ? vector[0] >= 0 ? 'right' : 'left' : vector[1] >= 0 ? 'bottom' : 'top';
}
function jitter(id, salt) { return ((seedOf(`${id}:${salt}`) % 1000) / 1000 - .5); }
function limitOf(box, side) { return Math.max(0, (side === 'left' || side === 'right' ? box.height : box.width) / 2 - 22); }
/**
 * Places ordered attachments along one side: each starts at its preferred
 * offset, then neighbours are pushed at least GAP apart inside the side.
 */
function spread(ideals, limit) {
  const count = ideals.length;
  if (count * GAP > limit * 2 + GAP) return ideals.map((_, index) => count < 2 ? 0 : -limit + index * limit * 2 / (count - 1));
  const positions = ideals.map(value => Math.max(-limit, Math.min(limit, value)));
  for (let index = 1; index < count; index++) positions[index] = Math.max(positions[index], positions[index - 1] + GAP);
  for (let index = count - 1; index >= 0; index--) {
    positions[index] = Math.min(positions[index], limit - (count - 1 - index) * GAP);
    if (index < count - 1) positions[index] = Math.min(positions[index], positions[index + 1] - GAP);
  }
  return positions;
}
// A drawn sidecar sits right of the card, so a right-side point moves past it.
function attachment(box, side, offset = 0) {
  const horizontal = side === 'left' || side === 'right';
  const limit = limitOf(box, side);
  const along = Math.max(-limit, Math.min(limit, offset));
  const normal = NORMALS[side];
  const reach = side === 'right' ? box.width / 2 + box.art : horizontal ? box.width / 2 : box.height / 2;
  const point = horizontal ? [box.cx + normal[0] * reach, box.cy + along] : [box.cx + along, box.cy + normal[1] * reach];
  return { point, normal };
}

/**
 * Each arrow gets its own attachment on the side of its card that faces its
 * target (dominant axis). Siblings on one side sit in the order of their
 * targets, at least GAP apart, near where each target lies (with a seeded
 * nudge), so fans never stack. Each arrow lands on the target side facing
 * the side it left from, spread the same way.
 */
export function graphEdgeRoute(graph, id, source, target, seed) {
  if (!graph?.getNodeData || !graph?.getEdgeData) return sketchEdgeRoute(source, target, seed, { loop: false });
  const cards = graph.getNodeData().map(card), edges = graph.getEdgeData();
  const key = JSON.stringify([cards, edges.map(edge => [edge.id, edge.source, edge.target, edge.style?.edgeRole, edge.style?.seed])]);
  let state = cache.get(graph);
  if (state?.key !== key) {
    const previous = state?.offsets || new Map();
    const byId = new Map(cards.map(box => [box.id, box]));
    // Sidecar art shares its card's id, so it is solid only around its own card's endpoints.
    const obstacles = cards.flatMap(box => [
      { id: box.id, x: box.cx - box.width / 2, y: box.cy - box.height / 2, width: box.width, height: box.height },
      ...(box.art ? [{ id: box.id, x: box.cx + box.width / 2 + 8, y: box.cy - 80, width: box.art - 8, height: 160 }] : []),
    ]);
    const valid = edges.filter(edge => byId.has(edge.source) && byId.has(edge.target) && edge.source !== edge.target);
    const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
    const exitSide = edge => {
      const a = byId.get(edge.source), b = byId.get(edge.target), dx = b.cx - a.cx, dy = b.cy - a.cy;
      return Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top';
    };
    const along = (side, point, box) => side === 'left' || side === 'right' ? point[1] - box.cy : point[0] - box.cx;
    // Offsets along a side, keyed `${edge}:out` / `${edge}:in`; an existing offset is kept while it still fits.
    const offsets = new Map();
    function place(groups, end) {
      for (const [bucket, group] of groups) {
        const [boxId, side] = bucket.split('\u0000'), box = byId.get(boxId), limit = limitOf(box, side);
        const other = edge => byId.get(end === 'out' ? edge.target : edge.source);
        group.sort((a, b) => along(side, [other(a).cx, other(a).cy], box) - along(side, [other(b).cx, other(b).cy], box) || String(a.id).localeCompare(String(b.id)));
        const ideals = group.map(edge => {
          const ideal = along(side, [other(edge).cx, other(edge).cy], box) * .35 + jitter(edge.id, end) * 18;
          const kept = previous.get(`${edge.id}:${end}`);
          return kept !== undefined && Math.abs(kept - ideal) < 28 ? kept : ideal;
        });
        spread(ideals, limit).forEach((value, index) => offsets.set(`${group[index].id}:${end}`, value));
      }
    }
    const bucketed = (pick) => {
      const groups = new Map();
      for (const edge of valid) { const bucket = pick(edge); groups.set(bucket, [...(groups.get(bucket) || []), edge]); }
      return groups;
    };
    place(bucketed(edge => `${edge.source}\u0000${exitSide(edge)}`), 'out');
    const originOf = edge => attachment(byId.get(edge.source), exitSide(edge), offsets.get(`${edge.id}:out`));
    // Land on the side facing the way the arrow left, so it never dives into a top or bottom edge late.
    const facing = edge => OPPOSITE[exitSide(edge)];
    place(bucketed(edge => `${edge.target}\u0000${facing(edge)}`), 'in');
    const length = edge => { const a = byId.get(edge.source), b = byId.get(edge.target); return Math.hypot(b.cx - a.cx, b.cy - a.cy); };
    const ordered = [...valid].sort((a, b) => length(a) - length(b)
      || Number(b.style?.edgeRole === 'primary') - Number(a.style?.edgeRole === 'primary') || String(a.id).localeCompare(String(b.id)));
    const routes = new Map();
    function route(edge) {
      const start = originOf(edge), side = facing(edge), b = byId.get(edge.target);
      const seed = edge.style?.seed || seedOf(edge.id);
      const occupiedRoutes = [...routes.entries()].filter(([other]) => other !== String(edge.id)).map(([, value]) => value);
      const options = { obstacles, occupiedRoutes, sourceId: edge.source, targetId: edge.target, sourceNormal: start.normal, fan: true, loop: false };
      // A tight or blocked arrival may slide its landing toward the origin, or
      // land on a neighbouring side, rather than hook into the card.
      const toward = landing => landing === 'left' || landing === 'right' ? start.point[1] - b.cy : start.point[0] - b.cx;
      const landings = [[side, offsets.get(`${edge.id}:in`), 0], [side, toward(side), 60], [side, -1e4, 80], [side, 1e4, 80],
        ...(side === 'left' || side === 'right' ? ['top', 'bottom'] : ['left', 'right']).flatMap(other => [[other, 0, 220], [other, toward(other), 240]])];
      let best = null;
      for (const [index, [landing, offset, penalty]] of landings.entries()) {
        const end = attachment(b, landing, offset);
        const candidate = sketchEdgeRoute(start.point, end.point, seed, { ...options, targetNormal: end.normal });
        const score = candidate.score + penalty;
        if (!best || score < best.score) best = { route: candidate, score };
        if (!index && candidate.score < candidate.length * 1.6 + 120) break;
      }
      // A curl inside a fan reads as a tangle, so only lone branches may loop.
      const lone = valid.filter(other => other.source === edge.source && exitSide(other) === exitSide(edge)).length === 1;
      routes.set(String(edge.id), lone ? addSketchLoop(best.route, seed, { obstacles, occupiedRoutes }) : best.route);
    }
    ordered.forEach(route);
    state = { key, routes, offsets }; cache.set(graph, state);
  }
  return state.routes.get(String(id)) || sketchEdgeRoute(source, target, seed, { loop: false });
}
export async function refreshEdgeRoutes(graph) {
  graph.updateEdgeData(graph.getEdgeData().map(edge => ({ id: edge.id, style: { routeRevision: (edge.style?.routeRevision || 0) + 1 } })));
  await graph.draw();
}
