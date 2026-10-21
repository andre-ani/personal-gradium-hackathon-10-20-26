/**
 * Calm, hand-drawn connector routes.
 *
 * Every connector is a smooth chain of cubics: it leaves its card along the
 * side normal, sweeps through a few waypoints placed beside any card in the
 * way, and lands along the target side normal. Joins share a tangent, so a
 * route never has corners; candidates whose bends are tighter than
 * MIN_TURN_RADIUS lose to gentler ones. A seeded minority of long edges add
 * one generous pen loop. Seeded choices stay stable between frames.
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

function normalizeObstacle(obstacle, clearance = OBSTACLE_CLEARANCE) {
  if (!obstacle || typeof obstacle !== 'object') return null;
  const x = finite(obstacle.x, NaN);
  const y = finite(obstacle.y, NaN);
  const width = finite(obstacle.width, NaN);
  const height = finite(obstacle.height, NaN);
  if (![x, y, width, height].every(Number.isFinite) || Math.abs(width) < EPSILON || Math.abs(height) < EPSILON) {
    return null;
  }
  const left = Math.min(x, x + width) - clearance;
  const right = Math.max(x, x + width) + clearance;
  const top = Math.min(y, y + height) - clearance;
  const bottom = Math.max(y, y + height) + clearance;
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

const routeBounds = new WeakMap();
function boundsOf(segments) {
  let box = routeBounds.get(segments);
  if (!box) {
    box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [a, b] of segments) {
      box[0] = Math.min(box[0], a[0], b[0]); box[1] = Math.min(box[1], a[1], b[1]);
      box[2] = Math.max(box[2], a[0], b[0]); box[3] = Math.max(box[3], a[1], b[1]);
    }
    routeBounds.set(segments, box);
  }
  return box;
}
const PAD = 10;
function pathCrossesOccupied(path, occupied) {
  if (!occupied.length) return false;
  const segments = pathSegments(path, 12), own = boundsOf(segments);
  // Bounding boxes reject far-away routes before any segment test.
  const near = occupied.filter((route) => {
    const box = boundsOf(route);
    return box[0] - PAD < own[2] && box[2] + PAD > own[0] && box[1] - PAD < own[3] && box[3] + PAD > own[1];
  });
  return near.length > 0 && segments.some(([start, end]) => {
    const left = Math.min(start[0], end[0]) - PAD, right = Math.max(start[0], end[0]) + PAD;
    const top = Math.min(start[1], end[1]) - PAD, bottom = Math.max(start[1], end[1]) + PAD;
    return near.some((route) => route.some(([a, b]) => Math.max(a[0], b[0]) > left && Math.min(a[0], b[0]) < right
      && Math.max(a[1], b[1]) > top && Math.min(a[1], b[1]) < bottom
      && distance(start, a) >= 2 && distance(start, b) >= 2 && distance(end, a) >= 2 && distance(end, b) >= 2
      && segmentsConflict(start, end, a, b)));
  });
}
function approximateLength(path) {
  return Math.max(1, pathSegments(path, 28).reduce((total, [start, end]) => total + distance(start, end), 0));
}

function result(path, extra = {}) {
  return {
    path,
    d: path.map((segment) => segment[0] + segment.slice(1).join(' ')).join(' '),
    length: approximateLength(path),
    ...extra,
  };
}

function unit(vector, fallback = [1, 0]) {
  const length = Math.hypot(vector[0], vector[1]);
  return length > EPSILON ? [vector[0] / length, vector[1] / length] : fallback;
}

function cross(a, b) { return a[0] * b[1] - a[1] * b[0]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }

// Small integer hash -> [0, 1). Salts keep each seeded choice independent.
function seededUnit(seed, salt) {
  let hash = Math.imul((seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x100000000;
}

/** Smallest bend radius any connector should draw, in graph units. */
export const MIN_TURN_RADIUS = 60;
/** Straight final approach, so an arrowhead always sits on the landing normal. */
export const RUN_IN = 44;

function cubicDerivatives(start, segment, t) {
  const p0 = start, p1 = segment.slice(1, 3), p2 = segment.slice(3, 5), p3 = segment.slice(5, 7);
  const u = 1 - t;
  const first = [0, 1].map((axis) => 3 * u * u * (p1[axis] - p0[axis]) + 6 * u * t * (p2[axis] - p1[axis]) + 3 * t * t * (p3[axis] - p2[axis]));
  const second = [0, 1].map((axis) => 6 * u * (p2[axis] - 2 * p1[axis] + p0[axis]) + 6 * t * (p3[axis] - 2 * p2[axis] + p1[axis]));
  return [first, second];
}

function endTangent(start, segment, atEnd) {
  const [velocity] = cubicDerivatives(start, segment, atEnd ? 1 - 1e-4 : 1e-4);
  return unit(velocity, null);
}

/**
 * Tightest bend radius along a cubic path. A tangent break counts as 0.
 * `skip` is an optional [from, to) range of path indexes (a deliberate loop).
 */
export function minTurnRadius(path, { skip = null, samples = 48 } = {}) {
  let minimum = Infinity;
  let start = null;
  let previousTangent = null;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    if (segment[0] === 'M') { start = segment.slice(1, 3); previousTangent = null; continue; }
    if (segment[0] !== 'C' || !start) continue;
    const skipped = skip && index >= skip[0] && index < skip[1];
    const chord = distance(start, segment.slice(5, 7)) + distance(start, segment.slice(1, 3));
    if (chord > EPSILON) {
      const tangentIn = endTangent(start, segment, false);
      if (!skipped && previousTangent && tangentIn && dot(previousTangent, tangentIn) < 0.9995) return 0;
      if (!skipped) {
        for (let step = 0; step <= samples; step += 1) {
          const [velocity, acceleration] = cubicDerivatives(start, segment, step / samples);
          const speed = Math.hypot(velocity[0], velocity[1]);
          if (speed < 1e-3) continue;
          const curvature = Math.abs(cross(velocity, acceleration)) / speed ** 3;
          if (curvature > EPSILON) minimum = Math.min(minimum, 1 / curvature);
        }
      }
      previousTangent = endTangent(start, segment, true) || previousTangent;
    }
    start = segment.slice(5, 7);
  }
  return minimum;
}

// ---------------------------------------------------------------- pen loop


// ---------------------------------------------------------------- smooth routes

function add(a, b, scale = 1) { return [a[0] + b[0] * scale, a[1] + b[1] * scale]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }

const FAN = Math.PI * 0.3;

// Siblings leave a shared origin splayed toward their first waypoint, like a hand-drawn fan.
function fanDirection(normal, toward, strength) {
  const along = dot(toward, normal), across = cross(normal, toward);
  const angle = clamp(Math.atan2(across, Math.max(1, along + 60)) * strength, -FAN, FAN);
  return [normal[0] * Math.cos(angle) - normal[1] * Math.sin(angle), normal[0] * Math.sin(angle) + normal[1] * Math.cos(angle)];
}

/** Cubic chain through `points`; interior tangents are Catmull-Rom, so every join is G1. */
function splinePath(points, startDirection, endDirection, [reach, landingReach], fan = 0) {
  const last = points.length - 1;
  const tangents = points.map((point, index) => {
    if (index === 0) return fan ? fanDirection(startDirection, sub(points[1], point), fan) : startDirection;
    if (index === last) return endDirection;
    return unit(sub(points[index + 1], points[index - 1]), startDirection);
  });
  const path = [['M', ...points[0]]];
  for (let index = 0; index < last; index += 1) {
    const a = points[index], b = points[index + 1];
    const span = distance(a, b);
    // Card ends get a longer pull so the curve leaves and lands squarely, but
    // never past the room the chord offers along that normal (that pull waves).
    const pull = (tangent, share) => clamp(span * share * 1.15, Math.min(span * 0.9, MIN_TURN_RADIUS * 1.1),
      Math.max(MIN_TURN_RADIUS * 1.1, Math.min(320, Math.abs(dot(sub(b, a), tangent)))));
    // Waypoint handles stay short of the chord, or the curve loops back on itself.
    const outward = index === 0 ? pull(tangents[0], reach) : span * Math.min(reach, 0.36);
    const inward = index === last - 1 ? pull(tangents[last], landingReach) : span * Math.min(landingReach, 0.36);
    path.push(['C', ...add(a, tangents[index], outward), ...add(b, tangents[index + 1], -inward), ...b]);
  }
  return path;
}

function firstHit(path, obstacles) {
  const segments = pathSegments(path), box = boundsOf(segments);
  const near = obstacles.filter((obstacle) => obstacle.right > box[0] && obstacle.left < box[2] && obstacle.bottom > box[1] && obstacle.top < box[3]);
  if (!near.length) return null;
  for (const [start, end] of segments) {
    const hit = near.find((obstacle) => segmentIntersectsObstacle(start, end, obstacle));
    if (hit) return hit;
  }
  return null;
}

/** Points that carry a route past one card (and any card stacked against it) on the requested side. */
function passPoints(box, side, clearance, horizontal, range, obstacles) {
  const [low, high, near, far] = horizontal ? ['left', 'right', 'top', 'bottom'] : ['top', 'bottom', 'left', 'right'];
  const from = clamp(box[low], range[0], range[1]), to = clamp(box[high], range[0], range[1]);
  let level = side > 0 ? box[far] + clearance : box[near] - clearance;
  // Step past a neighbour the pass would land in, so a column is passed as one.
  for (let guard = 0; guard < obstacles.length; guard += 1) {
    const blocker = obstacles.find((other) => other[high] > from - 24 && other[low] < to + 24
      && level > other[near] - clearance / 2 && level < other[far] + clearance / 2);
    if (!blocker) break;
    level = side > 0 ? blocker[far] + clearance : blocker[near] - clearance;
  }
  const along = to - from > 90 ? [from, to] : [(from + to) / 2];
  return along.map((value) => horizontal ? [value, level] : [level, value]);
}

/** Add waypoints beside each card the curve meets, all on one side, until it runs clear. */
function detourSpline(start, end, startDirection, endDirection, obstacles, side, reach, middle, fan, inset = 0, extra = 0) {
  const chord = unit(sub(end, start), startDirection);
  const horizontal = Math.abs(chord[0]) >= Math.abs(chord[1]);
  const axis = horizontal ? 0 : 1;
  const range = [Math.min(start[axis], end[axis]) + 24, Math.max(start[axis], end[axis]) - 24];
  if (range[0] > range[1]) range[0] = range[1] = (start[axis] + end[axis]) / 2;
  const passes = new Map();
  const base = middle ? [[(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]] : [];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    // Every pass rides one shared level, so a detour is a single calm sweep.
    const around = [...passes.values()].flatMap((pass) => pass.points)
      .sort((a, b) => dot(sub(a, start), chord) - dot(sub(b, start), chord));
    const level = around.length ? (side > 0 ? Math.max : Math.min)(...around.map((point) => point[1 - axis])) : 0;
    // `inset` starts and ends the level run further in, leaving room for wide bends.
    const sweep = (around.length > 1 ? [around[0], around.at(-1)] : around)
      .map((point, index, ends) => {
        const along = ends.length > 1 ? point[axis] + (index ? -inset : inset) : point[axis];
        return axis ? [level, along] : [along, level];
      });
    const waypoints = [...base, ...sweep]
      .sort((a, b) => dot(sub(a, start), chord) - dot(sub(b, start), chord))
      .filter((point, index, all) => !index || distance(point, all[index - 1]) > 30);
    const path = splinePath([start, ...waypoints, end], startDirection, endDirection, reach, fan);
    const hit = firstHit(path, obstacles);
    if (!hit) return { path, waypoints, detoured: attempt > 0 };
    if (middle && insideObstacle(base[0], hit)) return null;
    const clearance = (passes.get(hit)?.clearance ?? extra - 8) + 26;
    passes.set(hit, { clearance, points: passPoints(hit, side, clearance, horizontal, range, obstacles) });
  }
  return null;
}

// How far a curve bows back behind its origin side or around past its landing side.
function doubling(path, start, end, startDirection, endDirection) {
  let worst = 0;
  for (const [point] of pathSegments(path, 12)) {
    worst = Math.max(worst, -dot(sub(point, start), startDirection) - 2, dot(sub(point, end), endDirection) - 2);
  }
  return worst;
}

// Turning beyond the net change of heading: zero for a single sweep, high for a wave.
function waviness(path) {
  let total = 0, net = 0, previous = null;
  for (const [a, b] of pathSegments(path, 12)) {
    if (distance(a, b) < EPSILON) continue;
    const heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (previous !== null) {
      const turn = Math.atan2(Math.sin(heading - previous), Math.cos(heading - previous));
      total += Math.abs(turn); net += turn;
    }
    previous = heading;
  }
  return total - Math.abs(net);
}

/** A sweeping, card-avoiding connector between two oriented endpoints. */
function smoothRoute(start, end, startDirection, endDirection, obstacles, occupied, seed, fan) {
  const relevant = obstacles.filter((box) => {
    const pad = distance(start, end) * 0.6 + 120;
    return box.right > Math.min(start[0], end[0]) - pad && box.left < Math.max(start[0], end[0]) + pad
      && box.bottom > Math.min(start[1], end[1]) - pad && box.top < Math.max(start[1], end[1]) + pad;
  });
  const wobble = 0.94 + 0.12 * seededUnit(seed, 21);
  let best = null;
  // Handle pairs (leave, land) and fan strengths; asymmetric pulls fit tight S-bends.
  const reaches = [[0.42, 0.42], [0.55, 0.55], [0.32, 0.32], [0.24, 0.24], [0.17, 0.17], [0.24, 0.42], [0.42, 0.24]];
  const consider = (path, detoured) => {
    const radius = minTurnRadius(path, { samples: 24 });
    const wave = waviness(path), back = doubling(path, start, end, startDirection, endDirection);
    const shape = approximateLength(path) + (path.length - 2) * 18
      + Math.max(0, MIN_TURN_RADIUS - radius) * 40 + back * 10 + wave * 150;
    if (best && shape >= best.score) return false;
    // Crossing checks are the costly part, so only a candidate that can still win pays for one.
    const crossing = occupied.length && pathCrossesOccupied(path, occupied) ? 1 : 0;
    const score = shape + crossing * 160;
    if (!best || score < best.score) best = { path, score, radius };
    // A clear, single, wide sweep is as good as this search gets.
    return !detoured && !crossing && radius >= MIN_TURN_RADIUS && wave < 0.05 && back < 1;
  };
  // Waypoints are found once per detour shape, then every handle pair is tried through them.
  for (const strength of fan ? [0.7, 1.4] : [0]) {
    for (const middle of [false, true]) {
      for (const [side, inset, extra] of [[1, 0, 0], [-1, 0, 0], [1, 70, 0], [-1, 70, 0], [1, 70, 64], [-1, 70, 64]]) {
        const found = detourSpline(start, end, startDirection, endDirection, relevant, side,
          [0.42 * wobble, 0.42 * wobble], middle, strength, inset, extra);
        if (!found) continue;
        for (const [reach, landingReach] of reaches) {
          const path = splinePath([start, ...found.waypoints, end], startDirection, endDirection,
            [reach * wobble, landingReach * wobble], strength);
          if (firstHit(path, relevant)) continue;
          if (consider(path, found.detoured)) return best;
        }
        if (!found.detoured) break;
      }
    }
  }
  if (best) return best;
  // Overlapping cards can leave no clear channel: keep the gentlest finite curve.
  const path = splinePath([start, end], startDirection, endDirection, [0.42, 0.42], fan ? 0.7 : 0);
  return { path, score: approximateLength(path) + 5000, radius: minTurnRadius(path) };
}

/**
 * Route a connector from finite 3D-ish graph points. Only x/y are drawn; z
 * remains available to callers as graph metadata. `options.obstacles` accepts
 * axis-aligned cards. Without normals, sourceId/targetId cards are ignored
 * and the route leaves and lands along its chord. With `sourceNormal` /
 * `targetNormal` (unit vectors out of each card side) the endpoints sit on
 * the card edges, endpoint cards stay solid, and the route leaves/enters each
 * card squarely; with `options.fan` the start splays toward the route like a
 * branch of a shared fan. `options.loop` (true, false or a 0-1 chance) may add one
 * seeded pen loop. The result's `score` compares alternative attachments.
 */
export function sketchEdgeRoute(source, target, seed = 1, options = {}) {
  const start = point2d(source);
  const end = point2d(target);
  const stableSeed = seedNumber(seed);
  const chord = unit(sub(end, start));
  const normals = Array.isArray(options?.sourceNormal) && Array.isArray(options?.targetNormal);
  const startDirection = normals ? unit(point2d(options.sourceNormal)) : chord;
  const endDirection = normals ? unit(point2d(options.targetNormal)).map((value) => -value) : chord;
  const raw = Array.isArray(options?.obstacles) ? options.obstacles : [];
  const isEndpoint = (obstacle) => sameId(obstacle?.id, options?.sourceId) || sameId(obstacle?.id, options?.targetId);
  const others = raw.filter((obstacle) => !isEndpoint(obstacle)).map((obstacle) => normalizeObstacle(obstacle)).filter(Boolean);
  // Endpoint cards stay solid, but the route may start and end on their edge.
  const endpointSolid = normals ? raw.filter(isEndpoint).map((obstacle) => normalizeObstacle(obstacle, -1)).filter(Boolean) : [];
  const occupied = (Array.isArray(options?.occupiedRoutes) ? options.occupiedRoutes : [])
    .map(routeSegments)
    .filter((segments) => segments.length);
  // With a landing normal the curve settles onto it before a straight run-in;
  // a cramped landing may shorten the run-in to 36 to keep its bend wide.
  const span = distance(start, end);
  let routed = null;
  for (const length of normals ? [RUN_IN, 36] : [0]) {
    const runIn = Math.min(length, span * 0.3);
    const approach = [end[0] - endDirection[0] * runIn, end[1] - endDirection[1] * runIn];
    const candidate = span < EPSILON
      ? { path: [['M', ...start], ['C', ...start, ...end, ...end]], score: 0, radius: Infinity }
      : smoothRoute(start, approach, startDirection, endDirection, [...others, ...endpointSolid], occupied, stableSeed, normals && Boolean(options?.fan));
    if (runIn > EPSILON) candidate.path = [...candidate.path, ['C', ...lerpPoint(approach, end, 1 / 3), ...lerpPoint(approach, end, 2 / 3), ...end]];
    if (!routed || candidate.score < routed.score - 1) routed = candidate;
    if (candidate.radius >= MIN_TURN_RADIUS) break;
  }
  const route = result(routed.path, { score: routed.score, radius: routed.radius });
  return addSketchLoop(route, stableSeed, { obstacles: raw, occupiedRoutes: options?.occupiedRoutes, chance: options?.loop });
}

/** Deterministic per-edge size: stroke and arrowhead scale together, 0.8x-1.5x. */
export function sketchEdgeScale(seed) {
  const value = seededUnit(seedNumber(seed), 31);
  // Squared bias keeps most arrows near their role weight; a few read heavy.
  return 0.8 + 0.7 * value * value;
}

// ---------------------------------------------------------------- pen loop

function cubicAt(start, segment, t) {
  const point = cubicPoint(start, segment, t);
  const [velocity] = cubicDerivatives(start, segment, t);
  return { point, tangent: unit(velocity, null) };
}

function arcLengthTable(path, steps = 64) {
  const table = [];
  let start = null;
  let total = 0;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    if (segment[0] === 'M') { start = segment.slice(1, 3); continue; }
    let previous = start;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const point = cubicPoint(start, segment, t);
      total += distance(previous, point);
      table.push({ index, t, s: total, start });
      previous = point;
    }
    start = segment.slice(5, 7);
  }
  return { table, total };
}

function locate({ table }, s) {
  let low = 0, high = table.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (table[middle].s < s) low = middle; else high = middle;
  }
  const a = table[low], b = table[high];
  if (a.index !== b.index) return { index: b.index, t: b.t, start: b.start };
  const ratio = b.s - a.s > EPSILON ? (s - a.s) / (b.s - a.s) : 0;
  return { index: a.index, t: a.t + (b.t - a.t) * ratio, start: a.start };
}

function lerpPoint(a, b, t) { return a.map((value, axis) => value + (b[axis] - value) * t); }
function splitCurve(curve, t) {
  const a = lerpPoint(curve[0], curve[1], t), b = lerpPoint(curve[1], curve[2], t), c = lerpPoint(curve[2], curve[3], t);
  const d = lerpPoint(a, b, t), e = lerpPoint(b, c, t), f = lerpPoint(d, e, t);
  return [[curve[0], a, d, f], [f, e, c, curve[3]]];
}
function asCurve(start, segment) { return [start, segment.slice(1, 3), segment.slice(3, 5), segment.slice(5, 7)]; }
function asCommand(curve) { return ['C', ...curve[1], ...curve[2], ...curve[3]]; }

/**
 * One generous pen curl (a prolate trochoid riding the route): the pen moves
 * forward, swings round a loop of radius ~`size` and continues on the same
 * tangent. Exact positions follow the base route; the ends are C1-continuous.
 */
function loopCommands(sample, s0, advance, size, side) {
  const a = advance / (2 * Math.PI);
  const samples = 16;
  const nodes = [];
  for (let step = 0; step <= samples; step += 1) {
    const tau = (2 * Math.PI * step) / samples;
    const base = sample(s0 + a * tau);
    const normal = [-base.tangent[1] * side, base.tangent[0] * side];
    const along = size * Math.sin(tau), lift = size * (1 - Math.cos(tau));
    const forward = a + size * Math.cos(tau), up = size * Math.sin(tau);
    nodes.push({
      point: [base.point[0] + base.tangent[0] * along + normal[0] * lift, base.point[1] + base.tangent[1] * along + normal[1] * lift],
      velocity: [base.tangent[0] * forward + normal[0] * up, base.tangent[1] * forward + normal[1] * up],
    });
  }
  const delta = (2 * Math.PI) / samples / 3;
  return nodes.slice(1).map((node, index) => {
    const previous = nodes[index];
    return ['C',
      previous.point[0] + previous.velocity[0] * delta, previous.point[1] + previous.velocity[1] * delta,
      node.point[0] - node.velocity[0] * delta, node.point[1] - node.velocity[1] * delta,
      node.point[0], node.point[1]];
  });
}

/** Seeded loop choice for an edge: whether it loops, where (0.3-0.7) and how big. */
export function sketchLoopPlan(seed, chance = 0.2) {
  const stableSeed = seedNumber(seed);
  const probability = chance === true ? 1 : chance === false ? 0 : Number.isFinite(Number(chance)) && chance !== null ? clamp(Number(chance), 0, 1) : 0.2;
  return {
    enabled: seededUnit(stableSeed, 1) < probability,
    at: 0.3 + 0.4 * seededUnit(stableSeed, 2),
    radius: 14 + 8 * seededUnit(stableSeed, 3),
    side: seededUnit(stableSeed, 4) < 0.5 ? 1 : -1,
  };
}

// Fan branches stay clean; only long runs have room for a curl.
const LOOP_MIN_LENGTH = 420;

/**
 * Maybe add one seeded loop partway along a routed connector. Returns the
 * route unchanged when the seed says no, the route is short, the curl would
 * sit on a tight bend, or it would touch a card. `route.loop.segments` is the
 * [from, to) path range of the curl.
 */
export function addSketchLoop(route, seed, options = {}) {
  const plan = sketchLoopPlan(seed, options.chance);
  if (!plan.enabled || !route?.path || route.loop) return route;
  const table = arcLengthTable(route.path);
  if (table.total < LOOP_MIN_LENGTH) return route;
  const obstacles = (options.obstacles || []).map((obstacle) => normalizeObstacle(obstacle)).filter(Boolean);
  const occupied = (options.occupiedRoutes || []).map(routeSegments).filter((segments) => segments.length);
  const size = plan.radius;
  const advance = size * 0.12 * 2 * Math.PI;
  const sample = (s) => {
    const spot = locate(table, clamp(s, 0, table.total));
    return cubicAt(spot.start, route.path[spot.index], spot.t);
  };
  const positions = [plan.at, clamp(plan.at + 0.12, 0.3, 0.7), clamp(plan.at - 0.12, 0.3, 0.7)];
  for (const at of [...new Set(positions)]) {
    const s0 = table.total * at, s1 = s0 + advance;
    if (s0 < size * 3 || s1 > table.total - size * 3) continue;
    // Keep the curl on a calm stretch so it reads as a loop, not a scribble.
    const first = locate(table, s0), last = locate(table, s1);
    if (sample(s0).tangent === null || sample(s1).tangent === null) continue;
    const window = [];
    for (let step = 0; step <= 8; step += 1) window.push(sample(s0 - size + ((advance + 2 * size) * step) / 8).tangent);
    if (window.some((tangent, index) => !tangent || (index && dot(tangent, window[index - 1]) < Math.cos((advance + 2 * size) / 8 / (size * 3))))) continue;
    for (const side of [plan.side, -plan.side]) {
      const curl = loopCommands(sample, s0, advance, size, side);
      const curlPath = [['M', ...sample(s0).point], ...curl];
      if (pathHitsObstacles(curlPath, obstacles) || pathCrossesOccupied(curlPath, occupied)) continue;
      const head = route.path.slice(0, first.index);
      const tail = route.path.slice(last.index + 1);
      const firstCurve = asCurve(first.start, route.path[first.index]);
      let before, after;
      if (first.index === last.index) {
        const [left, rest] = splitCurve(firstCurve, first.t);
        before = left;
        after = splitCurve(rest, first.t < 1 ? (last.t - first.t) / (1 - first.t) : 1)[1];
      } else {
        before = splitCurve(firstCurve, first.t)[0];
        after = splitCurve(asCurve(last.start, route.path[last.index]), last.t)[1];
      }
      const startIndex = head.length + 1;
      const path = [...head, asCommand(before), ...curl, asCommand(after), ...tail];
      return result(path, { loop: { segments: [startIndex, startIndex + curl.length], at, radius: size, side } });
    }
  }
  return route;
}


// ---------------------------------------------------------------- ink stroke

// Smooth seeded noise in roughly [-1, 1]: two detuned sines per salt.
function inkNoise(seed, salt, s) {
  const a = seededUnit(seed, salt), b = seededUnit(seed, salt + 1), c = seededUnit(seed, salt + 2);
  return 0.62 * Math.sin(s / (70 + 90 * a) + 6.283 * b) + 0.38 * Math.sin(s / (23 + 26 * c) + 6.283 * a);
}

function ribbon(points, widths) {
  const left = [], right = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)], next = points[Math.min(points.length - 1, index + 1)];
    const tangent = unit(sub(next, previous));
    const normal = [-tangent[1], tangent[0]], half = widths[index] / 2;
    left.push(add(points[index], normal, half));
    right.push(add(points[index], normal, -half));
  }
  const cap = (center, from, steps = 4) => {
    const out = [];
    const radius = distance(center, from), angle = Math.atan2(from[1] - center[1], from[0] - center[0]);
    for (let step = 1; step < steps; step += 1) {
      const theta = angle - Math.PI * step / steps; // sweep round the outside of the end
      out.push([center[0] + Math.cos(theta) * radius, center[1] + Math.sin(theta) * radius]);
    }
    return out;
  };
  return [...left, ...cap(points.at(-1), left.at(-1)), ...right.reverse(), ...cap(points[0], right.at(-1))];
}

function polygonData(polygon) {
  // Every piece winds the same way, so nonzero filling unions them without holes.
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) area += cross(polygon[index], polygon[(index + 1) % polygon.length]);
  const ordered = area < 0 ? [...polygon].reverse() : polygon;
  return `M${ordered.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')}Z`;
}

/**
 * A hand-inked arrow as one filled outline: seeded wobble along the route,
 * pressure-varied width, a start that sometimes overshoots or leaves a hair
 * gap, and a two-barb head with its own angles. One fill means a translucent
 * arrow never darkens where its strokes overlap. `overlap` extends the tip
 * that far past the route end, inside the target card. `progress` (0-1) draws the
 * shaft first, then the head; the route's final run-in stays straight.
 */
export function inkArrowPath(route, seed, { width = 2.7, head = 12, progress = 1, overlap = 0 } = {}) {
  const stableSeed = seedNumber(seed);
  const table = arcLengthTable(route.path, 24);
  const routed = table.total;
  // `overlap` carries the straight run-in on past the card edge, so the head sits on the card.
  const total = routed + (routed > EPSILON ? overlap : 0);
  if (!(total > EPSILON) || progress <= 0) return { d: '', length: total };
  const headLength = head * (0.9 + 0.2 * seededUnit(stableSeed, 51));
  const drawn = progress * (total + headLength);
  const style = seededUnit(stableSeed, 52);
  const startAt = style < 0.22 ? 3.5 : 0; // a hair gap where the pen landed
  const overshoot = style > 0.78 ? 3 : 0; // or a small run past the start
  const shaftEnd = Math.min(total, drawn);
  if (shaftEnd <= startAt + 1) return { d: '', length: total };
  const sample = (s) => {
    const spot = locate(table, clamp(s, 0, routed));
    const base = cubicAt(spot.start, route.path[spot.index], spot.t);
    return s > routed && base.tangent ? { point: add(base.point, base.tangent, s - routed), tangent: base.tangent } : base;
  };
  const count = Math.max(8, Math.min(220, Math.ceil((shaftEnd - startAt) / 4)));
  const points = [], widths = [];
  const first = sample(startAt);
  if (overshoot && first.tangent) {
    points.push(add(first.point, first.tangent, -overshoot));
    widths.push(width * 0.45);
  }
  for (let step = 0; step <= count; step += 1) {
    const s = startAt + (shaftEnd - startAt) * step / count;
    const { point, tangent } = sample(s);
    const direction = tangent || [1, 0];
    // Wobble fades out before the run-in, so the head stays on the landing normal.
    const calm = clamp(s / 14, 0, 1) * clamp((total - 52 - s) / 40, 0, 1);
    const sway = 1.1 * inkNoise(stableSeed, 61, s) * calm;
    points.push(add(point, [-direction[1], direction[0]], sway));
    const pressure = 0.8 + 0.3 * (inkNoise(stableSeed, 71, s) * 0.5 + 0.5);
    const taper = (0.55 + 0.45 * clamp((s - startAt) / 26, 0, 1)) * (1 - 0.15 * clamp((s - total + 30) / 30, 0, 1));
    widths.push(width * pressure * taper);
  }
  const pieces = [ribbon(points, widths)];
  if (drawn > total) {
    const grow = clamp((drawn - total) / headLength, 0, 1);
    const tip = sample(total);
    const back = (tip.tangent || [1, 0]).map((value) => -value);
    for (const [side, salt] of [[1, 81], [-1, 82]]) {
      const angle = side * (0.4 + 0.18 * seededUnit(stableSeed, salt));
      const length = headLength * (0.82 + 0.3 * seededUnit(stableSeed, salt + 10)) * grow;
      const direction = [back[0] * Math.cos(angle) - back[1] * Math.sin(angle), back[0] * Math.sin(angle) + back[1] * Math.cos(angle)];
      // Each barb bows slightly, like a quick flick of the pen.
      const bend = side * (0.6 + 0.9 * seededUnit(stableSeed, salt + 20));
      const barb = [0, 0.5, 1].map((t) => add(add(tip.point, direction, length * t), [-direction[1], direction[0]], bend * Math.sin(Math.PI * t)));
      pieces.push(ribbon(barb, [width * 0.95, width * 0.8, width * 0.5]));
    }
  }
  return { d: pieces.map(polygonData).join(' '), length: total };
}
