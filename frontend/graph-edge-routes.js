// One organic router owns every connector. Layouts (Dagre, radial, packing)
// only place cards; arrows are drawn from card positions and sizes alone, so
// the router never inherits orthogonal waypoints or grid detours.
//
// Each connector is one or two cubic curves:
// - endpoints sit where the line between the two cards meets each card's edge,
//   nudged by a stable seeded offset (never evenly spaced ports, never a
//   forced side midpoint), and are separated only when two actually collide;
// - departure follows the direction of travel with only a slight outward lean;
// - a seeded bow gives the hand-drawn feel; when a card is in the way the bow
//   grows, and only if no bowed curve is clear does it pass one waypoint
//   beside the obstacle. Candidates also avoid crossing earlier connectors.
export const EDGE_CORNER_RADIUS = 48; // kept for callers that pass a radius
const MARGIN = 14; // clearance kept around other cards
const CORNER = 16; // endpoints stay this far from a card's corners
const SEPARATION = 18; // minimum gap between two endpoints on one side
const SAMPLES = 24;
const states = new WeakMap();

function stateFor(graph) {
  let state = states.get(graph);
  if (!state) {
    state = { revision: 0, frozen: false, key: '', routes: new Map(), rendered: new Map() };
    states.set(graph, state);
  }
  return state;
}

function seeded(text) {
  let hash = 2166136261;
  for (const char of String(text)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967295;
}

function cardsOf(graph) {
  const cards = new Map();
  for (const node of graph.getNodeData?.() || []) {
    const style = node.style || {};
    const size = Array.isArray(style.size) ? style.size : [220, 120];
    cards.set(String(node.id), { id: String(node.id), x: Number(style.x) || 0, y: Number(style.y) || 0,
      w: Math.max(1, Number(size[0]) || 220), h: Math.max(1, Number(size[1]) || 120) });
  }
  return cards;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (a, k) => [a[0] * k, a[1] * k];
const len = a => Math.hypot(a[0], a[1]);
const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

/** Which side of `card` faces `toward`, and the point there (kept off corners). */
function sideAnchor(card, toward, jitter) {
  const d = sub(toward, [card.x, card.y]);
  const sx = Math.abs(d[0]) / (card.w / 2), sy = Math.abs(d[1]) / (card.h / 2);
  const horizontal = sx >= sy;
  const side = horizontal ? (d[0] >= 0 ? 'right' : 'left') : (d[1] >= 0 ? 'bottom' : 'top');
  const t = horizontal ? (card.w / 2) / (Math.abs(d[0]) || 1) : (card.h / 2) / (Math.abs(d[1]) || 1);
  const half = horizontal ? card.h / 2 : card.w / 2;
  const centre = horizontal ? card.y : card.x;
  // Where the centre line crosses this side, plus a stable pen offset.
  let along = (horizontal ? card.y + d[1] * t : card.x + d[0] * t) + jitter * Math.min(half * .5, 22);
  along = Math.max(centre - half + CORNER, Math.min(centre + half - CORNER, along));
  return { side, along, limits: [centre - half + CORNER, centre + half - CORNER] };
}

function anchorPoint(card, side, along) {
  if (side === 'left') return [card.x - card.w / 2, along];
  if (side === 'right') return [card.x + card.w / 2, along];
  if (side === 'top') return [along, card.y - card.h / 2];
  return [along, card.y + card.h / 2];
}
const NORMALS = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

function cubicAt(p0, c1, c2, p1, t) {
  const u = 1 - t;
  return [0, 1].map(i => u * u * u * p0[i] + 3 * u * u * t * c1[i] + 3 * u * t * t * c2[i] + t * t * t * p1[i]);
}
function sampleSegments(start, segments) {
  const points = [start];
  let from = start;
  for (const [c1, c2, to] of segments) {
    for (let i = 1; i <= SAMPLES; i++) points.push(cubicAt(from, c1, c2, to, i / SAMPLES));
    from = to;
  }
  return points;
}

function segmentHitsBox(p, q, box) {
  let enter = 0, leave = 1;
  for (const axis of [0, 1]) {
    const delta = q[axis] - p[axis];
    if (Math.abs(delta) < 1e-9) {
      if (p[axis] < box[0][axis] || p[axis] > box[1][axis]) return false;
    } else {
      const t1 = (box[0][axis] - p[axis]) / delta, t2 = (box[1][axis] - p[axis]) / delta;
      enter = Math.max(enter, Math.min(t1, t2));
      leave = Math.min(leave, Math.max(t1, t2));
      if (enter > leave) return false;
    }
  }
  return true;
}
function segmentsCross(a, b, c, d) {
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function score(samples, obstacles, earlier) {
  let hits = 0, crossings = 0, length = 0;
  for (let i = 1; i < samples.length; i++) {
    const p = samples[i - 1], q = samples[i];
    length += Math.hypot(q[0] - p[0], q[1] - p[1]);
    for (const box of obstacles) if (segmentHitsBox(p, q, box)) hits++;
  }
  // Crossings are counted on a coarse polyline: cheap and good enough.
  const coarse = samples.filter((_, i) => i % 4 === 0 || i === samples.length - 1);
  for (const other of earlier) {
    const theirs = other.filter((_, i) => i % 4 === 0 || i === other.length - 1);
    for (let i = 1; i < coarse.length; i++) for (let j = 1; j < theirs.length; j++) {
      if (segmentsCross(coarse[i - 1], coarse[i], theirs[j - 1], theirs[j])) crossings++;
    }
  }
  return { hits, crossings, cost: length + hits * 900 + crossings * 260 };
}

/** One bowed cubic between two anchored ends. */
function bowed(start, end, outStart, outEnd, bow) {
  const chord = sub(end, start), span = Math.max(1, len(chord));
  const along = unit(chord), perp = [-along[1], along[0]];
  const reach = Math.max(24, Math.min(170, span * .36));
  // Mostly toward the other end, a little away from the card: graceful, not square-on.
  const leave = unit(add(scale(along, .7), scale(outStart, .3)));
  const arrive = unit(add(scale(along, -.7), scale(outEnd, .3)));
  const c1 = add(add(start, scale(leave, reach)), scale(perp, bow));
  const c2 = add(add(end, scale(arrive, reach)), scale(perp, bow));
  return [[c1, c2, end]];
}

/** Two cubics through a waypoint beside an obstacle, tangent-continuous. */
function viaWaypoint(start, end, outStart, outEnd, waypoint) {
  const tangent = unit(sub(end, start));
  const first = Math.max(24, len(sub(waypoint, start)) * .4), second = Math.max(24, len(sub(end, waypoint)) * .4);
  const leave = unit(add(scale(unit(sub(waypoint, start)), .7), scale(outStart, .3)));
  const arrive = unit(add(scale(unit(sub(waypoint, end)), .7), scale(outEnd, .3)));
  return [
    [add(start, scale(leave, first)), sub(waypoint, scale(tangent, first)), waypoint],
    [add(waypoint, scale(tangent, second)), add(end, scale(arrive, second)), end],
  ];
}

function obstacleBox(card) {
  return [[card.x - card.w / 2 - MARGIN, card.y - card.h / 2 - MARGIN], [card.x + card.w / 2 + MARGIN, card.y + card.h / 2 + MARGIN]];
}

function planEndpoints(edges, cards) {
  // Preferred anchors first, then separate the ones that collide on a side.
  const ends = new Map(), bySide = new Map();
  for (const edge of edges) {
    const a = cards.get(edge.source), b = cards.get(edge.target);
    const source = sideAnchor(a, [b.x, b.y], seeded(`${edge.id}:s`) * 2 - 1);
    const target = sideAnchor(b, [a.x, a.y], seeded(`${edge.id}:t`) * 2 - 1);
    ends.set(edge.id, { source, target });
    for (const [cardId, end] of [[edge.source, source], [edge.target, target]]) {
      const key = `${cardId}:${end.side}`;
      if (!bySide.has(key)) bySide.set(key, []);
      bySide.get(key).push(end);
    }
  }
  for (const group of bySide.values()) {
    if (group.length < 2) continue;
    group.sort((p, q) => p.along - q.along);
    const [low, high] = group[0].limits;
    const gap = Math.min(SEPARATION, (high - low) / Math.max(1, group.length - 1));
    for (let i = 1; i < group.length; i++) group[i].along = Math.max(group[i].along, group[i - 1].along + gap);
    if (group.at(-1).along > high) {
      group.at(-1).along = high;
      for (let i = group.length - 2; i >= 0; i--) group[i].along = Math.min(group[i].along, group[i + 1].along - gap);
    }
  }
  return ends;
}

function routeEdge(edge, cards, ends, earlier, quick = false) {
  const a = cards.get(edge.source), b = cards.get(edge.target);
  const { source, target } = ends.get(edge.id);
  const start = anchorPoint(a, source.side, source.along), end = anchorPoint(b, target.side, target.along);
  const outStart = NORMALS[source.side], outEnd = NORMALS[target.side];
  const span = Math.max(1, len(sub(end, start)));
  const obstacles = quick ? [] : [...cards.values()].filter(card => card.id !== edge.source && card.id !== edge.target).map(obstacleBox);
  const random = seeded(`${edge.id}:bow`);
  const sign = random < .5 ? -1 : 1;
  const base = span * (.04 + random * .06);
  const bows = [sign * base, -sign * base, sign * span * .16, -sign * span * .16, sign * span * .28, -sign * span * .28, sign * span * .42, -sign * span * .42];
  let best = null;
  const consider = segments => {
    const samples = sampleSegments(start, segments);
    const result = score(samples, obstacles, earlier);
    if (!best || result.cost < best.cost) best = { ...result, segments, samples };
  };
  for (const bow of quick ? bows.slice(0, 1) : bows) {
    consider(bowed(start, end, outStart, outEnd, bow));
    if (best && !best.hits && !best.crossings) break;
  }
  if (best.hits && !quick) {
    // Pass one waypoint just outside the nearest blocking card's corner.
    const blocking = obstacles.filter(box => best.samples.some((p, i) => i && segmentHitsBox(best.samples[i - 1], p, box)));
    for (const box of blocking) {
      for (const corner of [[box[0][0], box[0][1]], [box[1][0], box[0][1]], [box[1][0], box[1][1]], [box[0][0], box[1][1]]]) {
        const centre = [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2];
        const waypoint = add(corner, scale(unit(sub(corner, centre)), MARGIN));
        consider(viaWaypoint(start, end, outStart, outEnd, waypoint));
      }
    }
  }
  return { start, segments: best.segments, samples: best.samples };
}

function signature(cards, edges) {
  return [...cards.values()].map(c => `${c.id}:${c.x.toFixed(1)},${c.y.toFixed(1)},${c.w.toFixed(0)},${c.h.toFixed(0)}`).join('|')
    + '#' + edges.map(e => `${e.id}:${e.source}>${e.target}`).join('|');
}

function routeAll(graph) {
  const state = stateFor(graph);
  const cards = cardsOf(graph);
  const edges = (graph.getEdgeData?.() || [])
    .map(edge => ({ id: String(edge.id), source: String(edge.source), target: String(edge.target) }))
    .filter(edge => edge.source !== edge.target && cards.has(edge.source) && cards.has(edge.target));
  // While cards animate, connectors follow them with plain bowed curves
  // (cheap, no obstacle search); full routing resumes when they settle.
  const quick = state.frozen;
  const key = `${state.revision}:${quick}#${signature(cards, edges)}`;
  if (key === state.key) return state.routes;
  const ends = planEndpoints(edges, cards);
  // Short connectors first: they have the least room to bend.
  const order = [...edges].sort((p, q) => {
    const span = e => { const a = cards.get(e.source), b = cards.get(e.target); return Math.hypot(a.x - b.x, a.y - b.y); };
    return span(p) - span(q) || p.id.localeCompare(q.id);
  });
  const routes = new Map(), earlier = [];
  for (const edge of order) {
    const route = routeEdge(edge, cards, ends, quick ? [] : earlier, quick);
    routes.set(edge.id, route);
    earlier.push(route.samples);
  }
  state.key = key;
  state.routes = routes;
  return routes;
}

function toRoute(raw) {
  const path = [['M', ...raw.start], ...raw.segments.map(([c1, c2, to]) => ['C', ...c1, ...c2, ...to])];
  const points = raw.samples;
  const length = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);
  return { points, path, length, d: path.map(part => part.join(' ')).join(' ') };
}

/** The organic route for one connector, from current card geometry. */
export function organicRoute(graph, id) {
  const state = stateFor(graph);
  const raw = routeAll(graph).get(String(id));
  if (!raw) return null;
  if (!raw.route) raw.route = toRoute(raw);
  state.rendered.set(String(id), raw.route.points);
  return raw.route;
}

// Layouts place cards; connectors are routed from card geometry, so planned
// waypoints are only a signal to recompute.
export function installPlannedRoutes(graph) { stateFor(graph).revision++; }
export function clearPlannedRoutes(graph) { stateFor(graph).revision++; }
export function nativeEdgeRoutingStyle() { return { controlPoints: [], router: false }; }
export function edgeRoutingRevision(graph) { return stateFor(graph).revision; }
export function edgeRoutesFrozen(graph) { return stateFor(graph).frozen; }
export function beginEdgeRouteFreeze(graph) { if (graph) stateFor(graph).frozen = true; }
export function endEdgeRouteFreeze(graph) {
  if (!graph) return;
  const state = stateFor(graph);
  if (state.frozen) { state.frozen = false; state.revision++; }
}
export function captureEdgeRoute(graph, id, points) {
  stateFor(graph).rendered.set(String(id), points.map(point => [point[0], point[1]]));
}
export function renderedEdgePoints(graph, id) { return stateFor(graph).rendered.get(String(id)); }

/** Compatibility for geometry consumers and tests: the organic route. */
export function graphEdgeRoute(graph, id, source, target) {
  return organicRoute(graph, id) || toRoute({ start: source, segments: [[source, target, target]], samples: [source, target] });
}

export async function refreshEdgeRoutes(graph) {
  const state = stateFor(graph); state.revision++;
  const ids = new Set(graph.getEdgeData().map(edge => String(edge.id)));
  for (const id of state.rendered.keys()) if (!ids.has(id)) state.rendered.delete(id);
  graph.updateEdgeData(graph.getEdgeData().map(edge => ({ id: edge.id, style: { routeRevision: state.revision } })));
  await graph.draw();
}
