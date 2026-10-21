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

function headingBox(node, attributes, box) {
  const measured = node?.shapeMap?.heading?.getLocalBounds?.();
  const min = measured?.min;
  const max = measured?.max;
  const text = String(dataValue(attributes, 'headingText', '') || '').trim();
  const fontSize = Number(dataValue(attributes, 'headingFontSize', 24)) || 24;
  if (min && max && [min[0], min[1], max[0], max[1]].every(Number.isFinite) && max[0] > min[0]) {
    return { text, fontSize, minX: min[0], minY: min[1], maxX: max[0], maxY: max[1] };
  }
  if (!text) return null;
  // First frame fallback: G may measure text only after the first render.
  const padding = Number(dataValue(attributes, 'textPadding', 20)) || 20;
  const minX = box.x + padding;
  const minY = box.y + padding;
  const width = Math.min(box.width - padding * 2, text.length * fontSize * 0.42);
  return { text, fontSize, minX, minY, maxX: minX + width, maxY: minY + fontSize * 1.05 };
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
    if (!heading) return doodleStrokes('stars', box, seed, { variant });
    const fontSize = heading.fontSize;
    if (type === 'underline') {
      const left = heading.minX - 3 + spread(rand, 2);
      const right = Math.min(heading.maxX, box.x + box.width - 14) + 4 + spread(rand, 3);
      const y = heading.maxY + 3 + rand() * 2;
      const sag = 1.5 + rand() * 2.5;
      const rise = -1 - rand() * 3;
      const main = stroke(wobblyCurve((t) => [
        left + (right - left) * t,
        y + Math.sin(Math.PI * t) * sag + rise * t * t,
      ], 30, rand, 0.35));
      if (rand() < 0.45) {
        // A shorter second pass under the first, as a quick double swoosh.
        const start = left + (right - left) * (0.12 + rand() * 0.1);
        const end = left + (right - left) * (0.72 + rand() * 0.2);
        const second = stroke(wobblyCurve((t) => [
          start + (end - start) * t,
          y + 4.5 + Math.sin(Math.PI * t) * sag * 0.6 + rise * 0.5 * t,
        ], 22, rand, 0.3));
        return [main, second];
      }
      // Otherwise the swoosh finishes with a small upward flick.
      const tail = stroke(wobblyPolyline([
        [right, y + rise],
        [right + 5 + rand() * 3, y + rise - 5 - rand() * 3],
      ], rand, { bow: 0.8 }));
      return [main, tail];
    }
    const word = heading.text.split(/\s+/)[0] || heading.text;
    const width = Math.max(fontSize, Math.min(heading.maxX - heading.minX, word.length * fontSize * 0.36));
    const cx = heading.minX + width / 2;
    const cy = heading.minY + fontSize * 0.56;
    const rx = width / 2 + 8 + rand() * 3;
    const ry = fontSize * 0.6 + 3 + rand() * 2;
    const tilt = spread(rand, 0.08);
    const start = -Math.PI * (0.6 + rand() * 0.3);
    return [stroke(wobblyCurve((t) => {
      const angle = start + t * Math.PI * 2 * 1.14;
      const grow = 1 + 0.07 * t;
      return rotate([cx + Math.cos(angle) * rx * grow, cy + Math.sin(angle) * ry * grow], tilt, [cx, cy]);
    }, 56, rand, 0.7))];
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
