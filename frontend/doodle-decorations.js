import { Path } from '@antv/g';

/**
 * Small hand-drawn ink doodles that finished cards occasionally earn:
 * stars, sparkles, a heart, a burst, a heading underline or a circled word.
 *
 * The stable decoration scheduler owns the clock and picks the type; this
 * module only turns `decorationType`, `decorationProgress` (0..1) and
 * `decorationInk` into node-local, pointer-transparent paths. Geometry is
 * seeded by the node id, so a card's doodle never jumps between redraws.
 */

export const DOODLE_TYPES = Object.freeze(['stars', 'sparkle', 'heart', 'burst', 'underline', 'circle']);

const MAX_STROKES = 8;
const LINE_WIDTH = 1.7;
const INK_OPACITY = 0.8;
const FILL_OPACITY = 0.13;
const Z_INDEX = 2.5;
const DEFAULT_INK = '#123f85';

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));

function dataValue(attributes, key, fallback) {
  return attributes?.[key] ?? attributes?.data?.[key] ?? attributes?.style?.[key] ?? fallback;
}

function hashSeed(value) {
  const text = String(value ?? 'doodle');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

function random(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const spread = (rand, amount) => (rand() * 2 - 1) * amount;

function rotate([x, y], angle, [cx, cy] = [0, 0]) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
}

/**
 * Densify a polyline with a seeded bow per segment and a little hand jitter,
 * like Rough.js, but as one continuous subpath so a dash can trace it.
 */
function wobblyPolyline(vertices, rand, { closed = false, bow = 0.9, shake = 0.28, step = 2.6, overshoot = 0 } = {}) {
  const corners = closed ? [...vertices, vertices[0]] : vertices;
  const points = [corners[0].slice()];
  for (let index = 1; index < corners.length; index += 1) {
    const [ax, ay] = corners[index - 1];
    const [bx, by] = corners[index];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const normal = [-(by - ay) / length, (bx - ax) / length];
    const bend = spread(rand, bow) * Math.min(1, length / 18);
    const steps = Math.max(2, Math.ceil(length / step));
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps;
      const arc = Math.sin(Math.PI * t) * bend;
      const wiggle = k === steps ? 0 : spread(rand, shake);
      points.push([
        ax + (bx - ax) * t + normal[0] * (arc + wiggle),
        ay + (by - ay) * t + normal[1] * (arc + wiggle),
      ]);
    }
  }
  if (closed && overshoot > 0 && corners.length > 1) {
    // Hand-closed shapes run slightly past their start.
    const [ax, ay] = corners[0];
    const [bx, by] = corners[1];
    points.push([ax + (bx - ax) * overshoot + spread(rand, 0.6), ay + (by - ay) * overshoot + spread(rand, 0.6)]);
  }
  return points;
}

/** Sample a parametric curve and add slow, seeded drift (no straight perfection). */
function wobblyCurve(at, samples, rand, drift = 0.8) {
  const phaseX = rand() * Math.PI * 2;
  const phaseY = rand() * Math.PI * 2;
  const wave = 1.5 + rand() * 1.5;
  return Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples;
    const [x, y] = at(t);
    return [
      x + Math.sin(t * Math.PI * 2 * wave + phaseX) * drift + spread(rand, 0.18),
      y + Math.cos(t * Math.PI * 2 * wave + phaseY) * drift + spread(rand, 0.18),
    ];
  });
}

function stroke(points, { fill = false } = {}) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
  }
  const d = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  return { d, length: Math.max(1, length), fill };
}

function starStroke(center, radius, rand) {
  const turn = spread(rand, 0.22);
  const vertices = Array.from({ length: 10 }, (_, point) => {
    const angle = -Math.PI / 2 + turn + point * Math.PI / 5 + spread(rand, 0.06);
    const r = point % 2 ? radius * (0.42 + spread(rand, 0.05)) : radius * (1 + spread(rand, 0.11));
    return [center[0] + Math.cos(angle) * r, center[1] + Math.sin(angle) * r];
  });
  return stroke(wobblyPolyline(vertices, rand, { closed: true, bow: 0.5, overshoot: 0.35 }), { fill: true });
}

function sparkleStroke(center, radius, rand) {
  const tall = radius * (1.12 + spread(rand, 0.08));
  const wide = radius * (0.78 + spread(rand, 0.08));
  const tilt = spread(rand, 0.18);
  const tips = [[0, -tall], [wide, 0], [0, tall], [-wide, 0]];
  const points = [];
  // Each pinched side is a quadratic curve pulled toward the centre.
  for (let side = 0; side < 4; side += 1) {
    const from = tips[side];
    const to = tips[(side + 1) % 4];
    const pull = 0.12 + spread(rand, 0.04);
    const control = [(from[0] + to[0]) * pull, (from[1] + to[1]) * pull];
    for (let k = side ? 1 : 0; k <= 7; k += 1) {
      const t = k / 7;
      const u = 1 - t;
      points.push([
        u * u * from[0] + 2 * u * t * control[0] + t * t * to[0],
        u * u * from[1] + 2 * u * t * control[1] + t * t * to[1],
      ]);
    }
  }
  points.push([spread(rand, 0.5), -tall * 0.82]);
  const placed = points.map((point) => {
    const [x, y] = rotate(point, tilt);
    return [center[0] + x + spread(rand, 0.2), center[1] + y + spread(rand, 0.2)];
  });
  return stroke(placed, { fill: true });
}

function heartStroke(center, size, rand) {
  const tilt = spread(rand, 0.3);
  const scale = size / 16;
  const start = -0.06 + spread(rand, 0.04);
  const points = wobblyCurve((t) => {
    const a = (start + t * 1.08) * Math.PI * 2;
    const x = 16 * Math.sin(a) ** 3;
    const y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
    const [rx, ry] = rotate([x * scale, y * scale], tilt);
    return [center[0] + rx, center[1] + ry];
  }, 46, rand, 0.45);
  return stroke(points, { fill: true });
}

function burstStrokes(center, direction, rand) {
  if (rand() < 0.5) {
    // A quick hand asterisk: three crossing strokes.
    const length = 8 + rand() * 3;
    const turn = rand() * Math.PI;
    return Array.from({ length: 3 }, (_, index) => {
      const angle = turn + index * Math.PI / 3 + spread(rand, 0.12);
      const reach = length * (1 + spread(rand, 0.12));
      const from = [center[0] - Math.cos(angle) * reach, center[1] - Math.sin(angle) * reach];
      const to = [center[0] + Math.cos(angle) * reach, center[1] + Math.sin(angle) * reach];
      return stroke(wobblyPolyline([from, to], rand, { bow: 0.9 }));
    });
  }
  // Emphasis rays fanning out from the corner, like a little "!".
  const count = 3 + Math.floor(rand() * 3);
  const base = Math.atan2(direction[1], direction[0]);
  return Array.from({ length: count }, (_, index) => {
    const angle = base + (index - (count - 1) / 2) * (0.5 + spread(rand, 0.06));
    const inner = 3 + rand() * 2.5;
    const outer = inner + 7 + rand() * 5;
    const from = [center[0] + Math.cos(angle) * inner, center[1] + Math.sin(angle) * inner];
    const to = [center[0] + Math.cos(angle) * outer, center[1] + Math.sin(angle) * outer];
    return stroke(wobblyPolyline([from, to], rand, { bow: 1.1 }));
  });
}

function headingBox(node) {
  // Card headings are rendered as animated words, not a single heading shape.
  return node?._cardWords?.headingGeometry?.() || null;
}

// The ring is a superellipse |x/rx|^n + |y/ry|^n = 1 with n = 2 / RING_POWER.
const RING_POWER = .8;
const RING_N = 2 / RING_POWER;

/**
 * Radii for a ring that clears every corner of the heading's ink box: a
 * fixed side margin, then the height that keeps the corners inside.
 */
export function headingRing(heading, { padY = 4 } = {}) {
  const cx = (heading.minX + heading.maxX) / 2, cy = (heading.minY + heading.maxY) / 2;
  const halfW = Math.max(1, (heading.maxX - heading.minX) / 2), halfH = Math.max(1, (heading.maxY - heading.minY) / 2);
  // Wider headings get a wider margin so the ring never grows tall and round.
  const rx = halfW + Math.max(11, halfW * .08);
  const ry = (halfH + padY) / (1 - (halfW / rx) ** RING_N) ** (1 / RING_N);
  return { cx, cy, rx, ry };
}

function cornerAnchor(box, variant, rand) {
  const roll = rand();
  // Top-right first, then bottom-left; the curled bottom-right of a note stays clear.
  let corner = roll < 0.45 ? 0 : roll < 0.72 ? 1 : roll < 0.86 ? 2 : 3;
  if (corner === 3 && variant === 'note') corner = 0;
  const [sx, sy] = [[1, -1], [-1, 1], [-1, -1], [1, 1]][corner];
  const reach = 2 + rand() * 7;
  return {
    point: [box.x + (sx > 0 ? box.width : 0) + sx * reach, box.y + (sy > 0 ? box.height : 0) + sy * reach],
    direction: [sx, sy],
  };
}

/**
 * Build the strokes for one doodle in node-local coordinates. Exported for
 * tests; the result depends only on its inputs.
 */
export function doodleStrokes(type, box, seed, { heading = null, variant = 'note' } = {}) {
  const rand = random(hashSeed(`${seed}:${type}`));
  if (!box.width || !box.height) return [];
  if (type === 'underline' || type === 'circle') {
    if (!heading) return [];
    const lines = heading.lines || [heading];
    if (type === 'underline') {
      // One stroke per rendered line, just under its baseline (descenders may cross).
      return lines.map(line => {
        const left = line.minX - 2, right = line.maxX + 3;
        const y = (line.baseline ?? line.maxY) + Math.max(2.5, (line.fontSize || 24) * .14);
        const sag = 1 + rand() * 1.5;
        return stroke(wobblyCurve(t => [left + (right - left) * t, y + Math.sin(Math.PI * t) * sag + spread(rand, .15)], 28, rand, .3));
      });
    }
    // A loose ring around the whole heading, including wrapped lines.
    const { cx, cy, rx, ry } = headingRing(heading);
    const start = -Math.PI * .78, tilt = spread(rand, .018);
    return [stroke(wobblyCurve(t => {
      const angle = start + t * Math.PI * 2 * 1.06;
      const cosine = Math.cos(angle), sine = Math.sin(angle);
      const x = Math.sign(cosine) * Math.abs(cosine) ** RING_POWER;
      const y = Math.sign(sine) * Math.abs(sine) ** RING_POWER;
      return rotate([cx + x * rx, cy + y * ry], tilt, [cx, cy]);
    }, 64, rand, .4))];
  }

  const { point, direction } = cornerAnchor(box, variant, rand);
  if (type === 'stars') {
    const roll = rand();
    const count = roll < 0.4 ? 1 : roll < 0.75 ? 2 : 3;
    const radius = 9 + rand() * 3;
    const strokes = [starStroke(point, radius, rand)];
    const along = [-direction[1], direction[0]];
    for (let index = 1; index < count; index += 1) {
      const size = radius * (index === 1 ? 0.62 : 0.42) * (1 + spread(rand, 0.08));
      const side = index === 1 ? 1 : -1;
      const center = [
        point[0] + direction[0] * (radius * 0.9 + size) * 0.7 + along[0] * side * (radius + size) * 0.85,
        point[1] + direction[1] * (radius * 0.9 + size) * 0.7 + along[1] * side * (radius + size) * 0.85,
      ];
      strokes.push(starStroke(center, size, rand));
    }
    return strokes;
  }
  if (type === 'sparkle') {
    const radius = 8 + rand() * 3;
    const strokes = [sparkleStroke(point, radius, rand)];
    if (rand() < 0.55) {
      const small = radius * (0.45 + rand() * 0.1);
      strokes.push(sparkleStroke([
        point[0] + direction[0] * (radius + 4) - direction[1] * 8,
        point[1] + direction[1] * (radius + 4) + direction[0] * 8,
      ], small, rand));
    }
    return strokes;
  }
  if (type === 'heart') return [heartStroke(point, 10 + rand() * 3, rand)];
  if (type === 'burst') return burstStrokes(point, direction, rand);
  return [];
}

function clearStrokes(node, container, from = 0) {
  for (let index = from; index < MAX_STROKES; index += 1) {
    node.upsert(`doodle-${index}`, Path, false, container);
  }
}

/**
 * Draw (or clear) a card's doodle. Strokes are revealed one after another
 * by length, so a cluster of stars draws on like a single quick gesture.
 */
export function drawDoodleDecoration(node, attributes, container) {
  if (!node?.upsert || !container) return;
  const type = dataValue(attributes, 'decorationType', '');
  const progress = clamp(dataValue(attributes, 'decorationProgress', 0));
  const size = node.getSize?.(attributes) || [0, 0];
  const width = Math.max(0, Number(size[0]) || 0);
  const height = Math.max(0, Number(size[1]) || 0);
  if (!DOODLE_TYPES.includes(type) || progress <= 0 || !width || !height) {
    clearStrokes(node, container);
    return;
  }
  const box = { x: -width / 2, y: -height / 2, width, height };
  const seed = `${node.id ?? 'node'}:${dataValue(attributes, 'seed', '')}`;
  const variant = dataValue(attributes, 'nodeVariant', 'note');
  const heading = type === 'underline' || type === 'circle' ? headingBox(node, attributes, box) : null;
  const strokes = doodleStrokes(type, box, seed, { heading, variant }).slice(0, MAX_STROKES);
  const ink = dataValue(attributes, 'decorationInk', '') || dataValue(attributes, 'headingFill', DEFAULT_INK);
  const cardProgress = dataValue(attributes, 'drawProgress', null) == null ? 1 : clamp(dataValue(attributes, 'drawProgress', 1));
  const total = strokes.reduce((sum, item) => sum + item.length, 0);
  let drawn = progress * total;
  const settle = clamp((progress - 0.85) / 0.15);
  strokes.forEach((item, index) => {
    const local = clamp(drawn / item.length);
    drawn -= item.length;
    node.upsert(`doodle-${index}`, Path, local > 0 ? {
      d: item.d,
      stroke: ink,
      lineWidth: LINE_WIDTH,
      lineCap: 'round',
      lineJoin: 'round',
      lineDash: local < 1 ? [local * item.length, item.length + 2] : [],
      lineDashOffset: 0,
      fill: item.fill ? ink : 'none',
      fillOpacity: item.fill ? FILL_OPACITY * settle : 0,
      opacity: INK_OPACITY * cardProgress,
      pointerEvents: 'none',
      zIndex: Z_INDEX,
    } : false, container);
  });
  clearStrokes(node, container, strokes.length);
}
