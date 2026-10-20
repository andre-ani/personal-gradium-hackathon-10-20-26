/**
 * Stable, gestural connector routes.
 *
 * The route is deliberately small: a clear edge gets one restrained cubic,
 * while an edge touching a card gets a sparse Manhattan detour. Seeded
 * choices stay stable between frames.
 */

const OBSTACLE_CLEARANCE = 12;
const EPSILON = 1e-6;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function point2d(value) {
  return [finite(value?.[0]), finite(value?.[1])];
}

function seedNumber(seed) {
  const numeric = Number(seed);
  if (Number.isFinite(numeric)) return Math.abs(Math.trunc(numeric)) >>> 0;
  let hash = 2166136261;
  for (const character of String(seed ?? '1')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function distance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function sameId(a, b) {
  return a === b || (a != null && b != null && String(a) === String(b));
}

function normalizeObstacle(obstacle) {
  if (!obstacle || typeof obstacle !== 'object') return null;
  const x = finite(obstacle.x, NaN);
  const y = finite(obstacle.y, NaN);
  const width = finite(obstacle.width, NaN);
  const height = finite(obstacle.height, NaN);
  if (![x, y, width, height].every(Number.isFinite) || Math.abs(width) < EPSILON || Math.abs(height) < EPSILON) {
    return null;
  }
  const left = Math.min(x, x + width) - OBSTACLE_CLEARANCE;
  const right = Math.max(x, x + width) + OBSTACLE_CLEARANCE;
  const top = Math.min(y, y + height) - OBSTACLE_CLEARANCE;
  const bottom = Math.max(y, y + height) + OBSTACLE_CLEARANCE;
  return { id: obstacle.id, left, right, top, bottom };
}

function insideObstacle(point, obstacle) {
  return point[0] > obstacle.left + EPSILON
    && point[0] < obstacle.right - EPSILON
    && point[1] > obstacle.top + EPSILON
    && point[1] < obstacle.bottom - EPSILON;
}

// Open interior intersection lets a route run on the expanded boundary.
function segmentIntersectsObstacle(start, end, obstacle) {
  let enter = 0;
  let leave = 1;
  const delta = [end[0] - start[0], end[1] - start[1]];
  for (let axis = 0; axis < 2; axis += 1) {
    const value = start[axis];
    const change = delta[axis];
    const minimum = axis === 0 ? obstacle.left : obstacle.top;
    const maximum = axis === 0 ? obstacle.right : obstacle.bottom;
    if (Math.abs(change) < EPSILON) {
      if (value <= minimum + EPSILON || value >= maximum - EPSILON) return false;
      continue;
    }
    let first = (minimum - value) / change;
    let last = (maximum - value) / change;
    if (first > last) [first, last] = [last, first];
    enter = Math.max(enter, first);
    leave = Math.min(leave, last);
    if (leave - enter <= EPSILON) return false;
  }
  return leave > EPSILON && enter < 1 - EPSILON && leave - enter > EPSILON;
}

function cubicPoint(start, segment, t) {
  const [, ax, ay, bx, by, ex, ey] = segment;
  const inverse = 1 - t;
  return [
    inverse ** 3 * start[0] + 3 * inverse ** 2 * t * ax + 3 * inverse * t ** 2 * bx + t ** 3 * ex,
    inverse ** 3 * start[1] + 3 * inverse ** 2 * t * ay + 3 * inverse * t ** 2 * by + t ** 3 * ey,
  ];
}

function pathSegments(path, steps = 18) {
  const segments = [];
  let start = null;
  for (const command of Array.isArray(path) ? path : []) {
    if (!Array.isArray(command) || command.length < 3) continue;
    if (command[0] === 'M') {
      start = [finite(command[1]), finite(command[2])];
      continue;
    }
    if (command[0] !== 'C' || command.length < 7 || !start) continue;
    let previous = start;
    for (let step = 1; step <= steps; step += 1) {
      const next = cubicPoint(start, command, step / steps);
      segments.push([previous, next]);
      previous = next;
    }
    start = [finite(command[5]), finite(command[6])];
  }
  return segments;
}

function pathHitsObstacles(path, obstacles) {
  return pathSegments(path).some(([start, end]) => obstacles.some((obstacle) => segmentIntersectsObstacle(start, end, obstacle)));
}

function lineCommand(start, end) {
  const oneThird = [start[0] + (end[0] - start[0]) / 3, start[1] + (end[1] - start[1]) / 3];
  const twoThirds = [start[0] + (end[0] - start[0]) * 2 / 3, start[1] + (end[1] - start[1]) * 2 / 3];
  return ['C', oneThird[0], oneThird[1], twoThirds[0], twoThirds[1], end[0], end[1]];
}

function smoothPolyline(points, radius = 3) {
  const clean = [];
  for (const point of points) {
    const normalized = point2d(point);
    if (!clean.length || distance(clean.at(-1), normalized) > EPSILON) clean.push(normalized);
  }
  if (clean.length < 2) {
    const point = clean[0] || [0, 0];
    return [['M', point[0], point[1]], ['C', point[0], point[1], point[0], point[1], point[0], point[1]]];
  }
  if (radius <= EPSILON) {
    return [['M', clean[0][0], clean[0][1]], ...clean.slice(1).map((point, index) => lineCommand(clean[index], point))];
  }

  // Grid coordinates often split a straight leg into many tiny pieces.
  // Remove those splits before choosing a visible, rounded turn radius.
  for (let index = clean.length - 2; index > 0; index--) {
    const a = clean[index - 1], b = clean[index], c = clean[index + 1];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const forward = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    if (Math.abs(cross) < EPSILON && forward >= 0) clean.splice(index, 1);
  }
  const path = [['M', clean[0][0], clean[0][1]]];
  let current = clean[0];
  for (let index = 1; index < clean.length - 1; index += 1) {
    const previous = clean[index - 1];
    const corner = clean[index];
    const next = clean[index + 1];
    const incomingLength = distance(previous, corner);
    const outgoingLength = distance(corner, next);
    if (incomingLength < EPSILON || outgoingLength < EPSILON) continue;
    const turnRadius = Math.min(radius, incomingLength * 0.45, outgoingLength * 0.45);
    if (turnRadius < EPSILON) continue;
    const incoming = [(corner[0] - previous[0]) / incomingLength, (corner[1] - previous[1]) / incomingLength];
    const outgoing = [(next[0] - corner[0]) / outgoingLength, (next[1] - corner[1]) / outgoingLength];
    const entry = [corner[0] - incoming[0] * turnRadius, corner[1] - incoming[1] * turnRadius];
    const exit = [corner[0] + outgoing[0] * turnRadius, corner[1] + outgoing[1] * turnRadius];
    if (distance(current, entry) > EPSILON) path.push(lineCommand(current, entry));
    const controlLength = turnRadius * 0.55;
    path.push([
      'C',
      entry[0] + incoming[0] * controlLength,
      entry[1] + incoming[1] * controlLength,
      exit[0] - outgoing[0] * controlLength,
      exit[1] - outgoing[1] * controlLength,
      exit[0],
      exit[1],
    ]);
    current = exit;
  }
  if (distance(current, clean.at(-1)) > EPSILON) path.push(lineCommand(current, clean.at(-1)));
  return path;
}

function gesturePath(source, target, seed) {
  const dx = target[0] - source[0];
  const dy = target[1] - source[1];
  const length = Math.hypot(dx, dy);
  const safeLength = Math.max(length, 1);
  const ux = dx / safeLength;
  const uy = dy / safeLength;
  const normal = [-uy, ux];
  const sign = seed & 1 ? 1 : -1;
  const variant = seed % 3;
  const amplitude = Math.min(14, (8 + seed % 7) * Math.min(1, length / 100));
  const firstAcross = sign * amplitude;
  const secondAcross = sign * amplitude * (variant === 0 ? 0.72 : variant === 1 ? 0.92 : 0.62);
  const control = (along, across) => [
    source[0] + ux * along + normal[0] * across,
    source[1] + uy * along + normal[1] * across,
  ];
  const first = control(length * 0.28, firstAcross);
  const second = control(length * 0.74, secondAcross);
  return [['M', source[0], source[1]], ['C', first[0], first[1], second[0], second[1], target[0], target[1]]];
}

function loopPath(source, target, seed) {
  const dx = target[0] - source[0];
  const dy = target[1] - source[1];
  const length = Math.hypot(dx, dy);
  if (length < 220) return null;
  const ux = dx / length;
  const uy = dy / length;
  const normal = [-uy, ux];
  const sign = seed & 1 ? 1 : -1;
  const half = 6 + seed % 3; // 12-16px loop footprint, before smoothing.
  const center = length * (0.46 + (seed % 3) * 0.02);
  const along = (value, across = 0) => [
    source[0] + ux * value + normal[0] * across,
    source[1] + uy * value + normal[1] * across,
  ];
  const points = [
    source,
    along(center - half, 0),
    along(center - half * 0.72, sign * half),
    along(center + half * 0.72, sign * half),
    along(center + half * 0.72, -sign * half),
    along(center - half * 0.72, -sign * half),
    along(center + half, 0),
    target,
  ];
  return smoothPolyline(points, 2.2);
}

function routePointKey(point) {
  return `${point[0]}:${point[1]}`;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Number.isFinite))].sort((a, b) => a - b);
}

function addEdge(edges, from, to, cost) {
  edges[from].push({ to, cost });
  edges[to].push({ to: from, cost });
}

function segmentsCross(first, second, third, fourth) {
  const orientation = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const a = orientation(first, second, third);
  const b = orientation(first, second, fourth);
  const c = orientation(third, fourth, first);
  const d = orientation(third, fourth, second);
  const general = ((a > EPSILON && b < -EPSILON) || (a < -EPSILON && b > EPSILON))
    && ((c > EPSILON && d < -EPSILON) || (c < -EPSILON && d > EPSILON));
  if (general) return true;
  const between = (value, minimum, maximum) => value >= Math.min(minimum, maximum) - EPSILON && value <= Math.max(minimum, maximum) + EPSILON;
  return Math.abs(a) <= EPSILON && between(third[0], first[0], second[0]) && between(third[1], first[1], second[1])
    || Math.abs(b) <= EPSILON && between(fourth[0], first[0], second[0]) && between(fourth[1], first[1], second[1])
    || Math.abs(c) <= EPSILON && between(first[0], third[0], fourth[0]) && between(first[1], third[1], fourth[1])
    || Math.abs(d) <= EPSILON && between(second[0], third[0], fourth[0]) && between(second[1], third[1], fourth[1]);
}

function routeSegments(route) {
  const path = Array.isArray(route) ? route : route?.path;
  if (!Array.isArray(path) || !path.length) return [];
  if (Array.isArray(path[0]) && typeof path[0][0] !== 'string') {
    const points = path.map(point2d);
    return points.slice(1).map((point, index) => [points[index], point]);
  }
  return pathSegments(path, 10);
}

function nearSegment(point, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  const t = length ? clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length, 0, 1) : 0;
  return Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dy * t);
}
function segmentsConflict(a, b, c, d) {
  return segmentsCross(a, b, c, d) || Math.min(nearSegment(a, c, d), nearSegment(b, c, d), nearSegment(c, a, b), nearSegment(d, a, b)) < 9;
}

function occupiedCrossingCost(start, end, occupied) {
  let crossings = 0;
  for (const route of occupied) {
    for (const [otherStart, otherEnd] of route) {
      if (distance(start, otherStart) < 2 || distance(start, otherEnd) < 2 || distance(end, otherStart) < 2 || distance(end, otherEnd) < 2) continue;
      if (segmentsConflict(start, end, otherStart, otherEnd)) {
        crossings += 1;
        break;
      }
    }
  }
  return crossings * 240;
}

function pathCrossesOccupied(path, occupied) {
  if (!occupied.length) return false;
  return pathSegments(path, 12).some(([start, end]) => occupiedCrossingCost(start, end, occupied) > 0);
}

function crossingCoordinates(start, end, occupied) {
  const extrasX = [];
  const extrasY = [];
  for (const route of occupied) {
    const routePoints = route.flat();
    const routeMinX = Math.min(...routePoints.map((point) => point[0])) - 16;
    const routeMaxX = Math.max(...routePoints.map((point) => point[0])) + 16;
    const routeMinY = Math.min(...routePoints.map((point) => point[1])) - 16;
    const routeMaxY = Math.max(...routePoints.map((point) => point[1])) + 16;
    if (route.some(([a, b]) => segmentsConflict(start, end, a, b))) {
      extrasX.push(routeMinX, routeMaxX);
      extrasY.push(routeMinY, routeMaxY);
    }
    for (const [otherStart, otherEnd] of route) {
      if (!segmentsCross(start, end, otherStart, otherEnd)) continue;
      const denominator = (end[0] - start[0]) * (otherEnd[1] - otherStart[1])
        - (end[1] - start[1]) * (otherEnd[0] - otherStart[0]);
      if (Math.abs(denominator) < EPSILON) continue;
      const along = ((otherStart[0] - start[0]) * (otherEnd[1] - otherStart[1])
        - (otherStart[1] - start[1]) * (otherEnd[0] - otherStart[0])) / denominator;
      const crossing = [start[0] + (end[0] - start[0]) * along, start[1] + (end[1] - start[1]) * along];
      extrasX.push(crossing[0] - 16, crossing[0] + 16, routeMinX, routeMaxX);
      extrasY.push(crossing[1] - 16, crossing[1] + 16, routeMinY, routeMaxY);
    }
  }
  return { extrasX, extrasY };
}

function gridRoute(source, target, obstacles, occupied, extras = {}) {
  const xs = uniqueSorted([
    source[0], target[0],
    ...obstacles.flatMap((obstacle) => [obstacle.left, obstacle.right]),
    ...(extras.extrasX || []),
  ]);
  const ys = uniqueSorted([
    source[1], target[1],
    ...obstacles.flatMap((obstacle) => [obstacle.top, obstacle.bottom]),
    ...(extras.extrasY || []),
  ]);
  const nodes = [];
  const nodeIndex = new Map();
  const addNode = (point, force = false) => {
    const normalized = point2d(point);
    const key = routePointKey(normalized);
    if (nodeIndex.has(key)) return nodeIndex.get(key);
    if (!force && obstacles.some((obstacle) => insideObstacle(normalized, obstacle))) return -1;
    const index = nodes.length;
    nodeIndex.set(key, index);
    nodes.push(normalized);
    return index;
  };

  for (const x of xs) for (const y of ys) addNode([x, y]);
  const sourceIndex = addNode(source, true);
  const targetIndex = addNode(target, true);
  const edges = nodes.map(() => []);
  const visible = (first, second) => !obstacles.some((obstacle) => segmentIntersectsObstacle(first, second, obstacle));
  const connect = (first, second) => {
    if (first < 0 || second < 0 || first === second || !visible(nodes[first], nodes[second])) return;
    const cost = distance(nodes[first], nodes[second]) + occupiedCrossingCost(nodes[first], nodes[second], occupied);
    addEdge(edges, first, second, cost);
  };

  const rows = new Map();
  const columns = new Map();
  nodes.forEach((point, index) => {
    const row = rows.get(point[1]) || [];
    row.push(index);
    rows.set(point[1], row);
    const column = columns.get(point[0]) || [];
    column.push(index);
    columns.set(point[0], column);
  });
  for (const row of rows.values()) {
    row.sort((a, b) => nodes[a][0] - nodes[b][0]);
    for (let index = 1; index < row.length; index += 1) connect(row[index - 1], row[index]);
  }
  for (const column of columns.values()) {
    column.sort((a, b) => nodes[a][1] - nodes[b][1]);
    for (let index = 1; index < column.length; index += 1) connect(column[index - 1], column[index]);
  }
  if (visible(source, target)) connect(sourceIndex, targetIndex);

  const distances = Array(nodes.length).fill(Infinity);
  const previous = Array(nodes.length).fill(-1);
  const queue = [{ index: sourceIndex, cost: 0 }];
  distances[sourceIndex] = 0;
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost || a.index - b.index);
    const current = queue.shift();
    if (!current || current.cost > distances[current.index] + EPSILON) continue;
    if (current.index === targetIndex) break;
    for (const edge of edges[current.index]) {
      const nextCost = current.cost + edge.cost;
      if (nextCost + EPSILON >= distances[edge.to]) continue;
      distances[edge.to] = nextCost;
      previous[edge.to] = current.index;
      queue.push({ index: edge.to, cost: nextCost });
    }
  }
  if (!Number.isFinite(distances[targetIndex])) return null;
  const points = [];
  for (let index = targetIndex; index >= 0; index = previous[index]) {
    points.push(nodes[index]);
    if (index === sourceIndex) break;
  }
  if (points.at(-1) !== nodes[sourceIndex]) return null;
  points.reverse();
  return points;
}

function approximateLength(path) {
  return Math.max(1, pathSegments(path, 28).reduce((total, [start, end]) => total + distance(start, end), 0));
}

function result(path) {
  return {
    path,
    d: path.map((segment) => segment[0] + segment.slice(1).join(' ')).join(' '),
    length: approximateLength(path),
  };
}

/**
 * Route a connector from finite 3D-ish graph points. Only x/y are drawn; z
 * remains available to callers as graph metadata. `options.obstacles` accepts
 * axis-aligned cards, while sourceId/targetId omit the two endpoint cards.
 */
export function sketchEdgeRoute(source, target, seed = 1, options = {}) {
  const start = point2d(source);
  const end = point2d(target);
  const stableSeed = seedNumber(seed);
  const direct = gesturePath(start, end, stableSeed);
  const obstacles = (Array.isArray(options?.obstacles) ? options.obstacles : [])
    .filter((obstacle) => !sameId(obstacle?.id, options?.sourceId) && !sameId(obstacle?.id, options?.targetId))
    .map(normalizeObstacle)
    .filter(Boolean);
  const directObstacles = obstacles.filter((obstacle) => pathHitsObstacles(direct, [obstacle]));
  const occupied = (Array.isArray(options?.occupiedRoutes) ? options.occupiedRoutes : [])
    .map(routeSegments)
    .filter((segments) => segments.length);
  const directCrossesOccupied = pathCrossesOccupied(direct, occupied);

  const loopSetting = options?.loop;
  const loopPriority = loopSetting === true ? 1 : typeof loopSetting === 'number'
    ? clamp(loopSetting, 0, 1)
    : loopSetting === false ? 0 : 0.16;
  const loopRoll = (Math.imul(stableSeed, 1103515245) + 12345 >>> 0) / 0x100000000;
  const wantsLoop = loopPriority > 0 && loopRoll < loopPriority && !directObstacles.length;
  if (!directObstacles.length && !directCrossesOccupied) {
    if (wantsLoop) {
      const compactLoop = loopPath(start, end, stableSeed);
      if (compactLoop && !pathHitsObstacles(compactLoop, obstacles) && !pathCrossesOccupied(compactLoop, occupied)) return result(compactLoop);
    }
    return result(direct);
  }

  const crossing = directCrossesOccupied ? crossingCoordinates(start, end, occupied) : {};
  const spacious = obstacles.map(box => {
    const expanded = { ...box, left: box.left - 36, right: box.right + 36, top: box.top - 36, bottom: box.bottom + 36 };
    return insideObstacle(start, expanded) || insideObstacle(end, expanded) ? box : expanded;
  });
  const waypoints = gridRoute(start, end, spacious, occupied, crossing) || gridRoute(start, end, obstacles, occupied, crossing);
  if (waypoints) {
    for (const radius of [42, 28, 18, 8, 3]) {
      const routed = smoothPolyline(waypoints, radius);
      if (!pathHitsObstacles(routed, obstacles)) return result(routed);
    }
  }
  // If overlapping cards leave no finite channel, preserve the bounded
  // gesture instead of returning malformed path data.
  return result(direct);
}

function lerpPoint(a, b, t) { return a.map((value, axis) => value + (b[axis] - value) * t); }
function splitCurve(curve, t) {
  const a = lerpPoint(curve[0], curve[1], t), b = lerpPoint(curve[1], curve[2], t), c = lerpPoint(curve[2], curve[3], t);
  const d = lerpPoint(a, b, t), e = lerpPoint(b, c, t), f = lerpPoint(d, e, t);
  return [[curve[0], a, d, f], [f, e, c, curve[3]]];
}
function tangent(a, b) {
  const length = distance(a, b) || 1;
  return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
}

/** Fillet every discontinuous join, including attachment stubs. Never a square fallback. */
export function smoothSketchRoute(route, radius = 38) {
  let start = route.path[0].slice(1, 3);
  const curves = route.path.slice(1).map(segment => {
    const curve = [start, segment.slice(1, 3), segment.slice(3, 5), segment.slice(5, 7)];
    start = curve[3]; return curve;
  });
  const output = [];
  for (let index = 0; index < curves.length - 1; index++) {
    let left = curves[index], right = curves[index + 1];
    const incoming = tangent(left[2], left[3]), outgoing = tangent(right[0], right[1]);
    if (incoming[0] * outgoing[0] + incoming[1] * outgoing[1] > .999) { output.push(left); continue; }
    const leftLength = distance(left[0], left[1]) + distance(left[1], left[2]) + distance(left[2], left[3]);
    const rightLength = distance(right[0], right[1]) + distance(right[1], right[2]) + distance(right[2], right[3]);
    left = splitCurve(left, 1 - Math.min(.42, radius / Math.max(1, leftLength)))[0];
    right = splitCurve(right, Math.min(.42, radius / Math.max(1, rightLength)))[1];
    const enter = tangent(left[2], left[3]), leave = tangent(right[0], right[1]);
    const handle = distance(left[3], right[0]) * .4;
    output.push(left, [left[3], left[3].map((v, i) => v + enter[i] * handle), right[0].map((v, i) => v - leave[i] * handle), right[0]]);
    curves[index + 1] = right;
  }
  if (curves.length) output.push(curves.at(-1));
  return result([route.path[0], ...output.map(curve => ['C', ...curve[1], ...curve[2], ...curve[3]])]);
}

/** A wide U-shaped bypass for a long link that skips over a row of cards. */
export function outsideSketchRoute(source, target, side, options = {}) {
  const obstacles = (options.obstacles || []).filter(box => !sameId(box.id, options.sourceId) && !sameId(box.id, options.targetId)).map(normalizeObstacle).filter(Boolean);
  const occupied = (options.occupiedRoutes || []).map(routeSegments).filter(route => route.length);
  const vertical = side === 'left' || side === 'right', axis = vertical ? 0 : 1;
  const sign = side === 'left' || side === 'top' ? -1 : 1;
  const outside = sign > 0 ? Math.max(source[axis], target[axis], ...obstacles.map(box => vertical ? box.right : box.bottom))
    : Math.min(source[axis], target[axis], ...obstacles.map(box => vertical ? box.left : box.top));
  for (const margin of [92, 132, 196, 280]) {
    const first = [...source], second = [...target];
    first[axis] = second[axis] = outside + sign * margin;
    const path = [['M', ...source], ['C', ...first, ...second, ...target]];
    if (!pathHitsObstacles(path, obstacles) && !pathCrossesOccupied(path, occupied)) return result(path);
  }
  return null;
}
