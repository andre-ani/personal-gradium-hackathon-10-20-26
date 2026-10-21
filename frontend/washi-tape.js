import { Path } from '@antv/g';
import { PALETTE, PALETTE_KEYS } from './palette.js';

/**
 * Draw the two small pieces of tape that are attached to a sketch node.
 *
 * The caller owns the animation clock: update `tape1Progress` and
 * `tape2Progress` on the node attributes from 0 to 1, then call this
 * function from `SketchNode.drawKeyShape`. A missing progress value is 0.
 * Every shape is node-local, pointer-transparent, and removed through the
 * same upsert keys when its progress reaches 0.
 *
 * Optional attributes: `tapeDesign` (one of TAPE_DESIGNS; the scheduler
 * picks one that differs from neighbouring cards), `decorationPalette` (the
 * card's palette key, so the tape colours coordinate with it) and
 * `tapeOpacity`. Without them the design and colours are seeded by node id.
 */

/** Printed designs, in a stable order the scheduler can choose from. */
export const TAPE_DESIGNS = Object.freeze([
  'stripes-thin', 'stripes-wide', 'dots', 'gingham', 'stars', 'hearts',
  'scallop', 'squiggle', 'fibre', 'two-tone',
]);

const CREAM = '#efe2c2';
/**
 * Pale base wash + one ink accent per tape, all from the shared palette.
 * `cream` is a warm paper-tape base outside the card palette.
 */
export const TAPE_COMBOS = Object.freeze([
  ['rose', 'ochre'], ['teal', 'green'], ['plum', 'rose'], ['blue', 'ochre'],
  ['cream', 'terracotta'], ['green', 'teal'], ['ochre', 'blue'], ['slate', 'terracotta'],
  ['cream', 'blue'], ['terracotta', 'teal'], ['rose', 'plum'], ['green', 'ochre'],
  ['teal', 'terracotta'], ['blue', 'rose'], ['plum', 'ochre'], ['cream', 'green'],
]);

const TAPE_COUNT = 2;
const TAPE_OPACITY = 0.58;
const TAPE_Z_INDEX = 1.35;
const TAPE_SHADOW = '#173b6b36';
const BLEND = 'multiply';
const CACHE_LIMIT = 400;
const geometryCache = new Map();

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));

function dataValue(attributes, key, fallback) {
  return attributes?.[key] ?? attributes?.data?.[key] ?? attributes?.style?.[key] ?? fallback;
}

function hashSeed(value) {
  const text = String(value ?? 'washi');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

function jitter(seed, index, amount) {
  const value = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * amount * 2 - amount;
}

function smoothstep(value) {
  const amount = clamp(value);
  return amount * amount * (3 - 2 * amount);
}

function mix(hex, toward, amount) {
  const from = hex.match(/[0-9a-f]{2}/gi).map((part) => parseInt(part, 16));
  const to = toward.match(/[0-9a-f]{2}/gi).map((part) => parseInt(part, 16));
  return `#${from.map((value, index) => Math.round(value + (to[index] - value) * amount)
    .toString(16).padStart(2, '0')).join('')}`;
}

const inkOf = (key) => (key === 'cream' ? CREAM : PALETTE[key].ink);

/**
 * Seeded tape colours that share a hue with the card's palette when known.
 * Returns pale body tints for both strips plus the printed accent ink.
 */
export function tapeColours(seed, paletteKey) {
  const matching = PALETTE_KEYS.includes(paletteKey)
    ? TAPE_COMBOS.filter(([base, accent]) => base === paletteKey || accent === paletteKey)
    : TAPE_COMBOS;
  const [base, accent] = matching[hashSeed(`${seed}:combo`) % matching.length];
  const body = base === 'cream' ? CREAM : mix(inkOf(base), '#ffffff', 0.5);
  return {
    combo: `${base}+${accent}`,
    bodies: [body, base === 'cream' ? mix(CREAM, '#d9c79c', 0.25) : mix(inkOf(base), '#ffffff', 0.56)],
    highlight: mix(body, '#ffffff', 0.7),
    accent: inkOf(accent),
    tone: mix(inkOf(accent), '#ffffff', 0.55),
  };
}

export function tapeDesignFor(seed, requested) {
  return TAPE_DESIGNS.includes(requested) ? requested : TAPE_DESIGNS[hashSeed(`${seed}:design`) % TAPE_DESIGNS.length];
}

function nodeSeed(node, attributes) {
  // Include both values so a stable node id remains stable while an explicit
  // seed can intentionally select another deterministic tape treatment.
  return hashSeed(`${node?.id ?? 'node'}:${dataValue(attributes, 'seed', '')}`);
}

function sizeOf(node, attributes) {
  const size = node?.getSize?.(attributes);
  const width = Number(size?.[0]);
  const height = Number(size?.[1]);
  return [
    Number.isFinite(width) ? Math.max(0, width) : 0,
    Number.isFinite(height) ? Math.max(0, height) : 0,
  ];
}

function tapeSpec(index, width, height, seed) {
  const tapeWidth = Math.min(62, Math.max(38, width * 0.21)) * (1 + jitter(seed, 91 + index * 13, 0.16));
  const tapeHeight = Math.min(18, Math.max(12, height * 0.11)) * (1 + jitter(seed, 92 + index * 13, 0.1));
  const inset = tapeWidth * (0.32 + jitter(seed, 95 + index * 13, 0.1));
  return {
    width: tapeWidth,
    height: tapeHeight,
    centerX: index === 0 ? -width / 2 + inset : width / 2 - inset,
    centerY: (index === 0 ? -height / 2 : height / 2) + jitter(seed, 96 + index * 13, 4.5),
    // Opposite corners share the same rising diagonal: both tabs cross the
    // corner instead of the bottom one running along its lower edge.
    rotation: -(11 + Math.abs(jitter(seed, 97 + index * 13, 34))),
  };
}

function edgeY(spec, x, topEdge, seed, index, lift) {
  const left = -spec.width / 2;
  const t = spec.width > 0 ? clamp((x - left) / spec.width) : 0;
  const base = topEdge ? -spec.height / 2 : spec.height / 2;
  const roughness = jitter(seed, index, 0.58);
  // The free end lifts a few pixels during the peel and settles as the
  // visible length reaches the right edge.
  return base - lift * t * t + roughness;
}

/** Torn, zig-zag tape end between two edge points, as path commands. */
function tornEnd(x, top, bottom, seed, salt, outward) {
  const teeth = 3 + (seed + salt) % 2;
  const points = [];
  for (let step = 1; step < teeth * 2; step += 1) {
    const t = step / (teeth * 2);
    const depth = (step % 2 ? 1.9 : 0.2) + jitter(seed, salt + step, 0.6);
    points.push(`L${x - outward * depth} ${top + (bottom - top) * t + jitter(seed, salt + step + 20, 0.5)}`);
  }
  return points;
}

function tapeBodyPath(spec, progress, seed, index) {
  const visibleWidth = spec.width * clamp(progress);
  if (visibleWidth <= 0) return '';

  const left = -spec.width / 2;
  const right = left + visibleWidth;
  const lift = 3.1 * (1 - smoothstep(progress));
  const steps = Math.max(3, Math.ceil(visibleWidth / 11));
  const leftTop = edgeY(spec, left, true, seed, 41 + index * 31, lift);
  const leftBottom = edgeY(spec, left, false, seed, 73 + index * 31, lift);
  const path = [`M${left} ${leftTop}`];
  for (let step = 1; step <= steps; step += 1) {
    const x = left + (visibleWidth * step) / steps;
    path.push(`L${x} ${edgeY(spec, x, true, seed, 41 + index * 31 + step, lift)}`);
  }
  const rightTop = edgeY(spec, right, true, seed, 41 + index * 31 + steps, lift);
  const rightBottom = edgeY(spec, right, false, seed, 73 + index * 31, lift);
  // The far end is only torn once the strip is fully laid down.
  if (progress >= 0.999) path.push(...tornEnd(right, rightTop, rightBottom, seed, 140 + index * 17, 1));
  path.push(`L${right} ${rightBottom}`);
  for (let step = steps - 1; step >= 0; step -= 1) {
    const x = left + (visibleWidth * step) / steps;
    path.push(`L${x} ${edgeY(spec, x, false, seed, 73 + index * 31 + step, lift)}`);
  }
  path.push(...tornEnd(left, leftBottom, leftTop, seed, 170 + index * 17, -1));
  return `${path.join(' ')} Z`;
}

function circlePath(x, y, radius) {
  return `M${x - radius} ${y}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0Z`;
}

function starPath(x, y, radius) {
  return Array.from({ length: 10 }, (_, point) => {
    const angle = -Math.PI / 2 + point * Math.PI / 5;
    const r = point % 2 ? radius * 0.43 : radius;
    return `${point ? 'L' : 'M'}${x + Math.cos(angle) * r} ${y + Math.sin(angle) * r}`;
  }).join(' ') + 'Z';
}

function heartPath(x, y, size) {
  const s = size / 4;
  return `M${x} ${y + 3.8 * s}C${x - 7 * s} ${y - 0.8 * s} ${x - 3.7 * s} ${y - 6.2 * s} ${x} ${y - 2.6 * s}C${x + 3.7 * s} ${y - 6.2 * s} ${x + 7 * s} ${y - 0.8 * s} ${x} ${y + 3.8 * s}Z`;
}

const rect = (x0, y0, x1, y1) => (x1 > x0 && y1 > y0 ? `M${x0} ${y0}H${x1}V${y1}H${x0}Z` : '');

/** Clip a straight segment to a vertical band, so diagonal print stays on the tape. */
function clippedLine(ax, ay, bx, by, minX, maxX) {
  const dx = bx - ax;
  let from = 0;
  let to = 1;
  if (Math.abs(dx) < 1e-6) {
    if (ax < minX || ax > maxX) return '';
  } else {
    const t0 = (minX - ax) / dx;
    const t1 = (maxX - ax) / dx;
    from = Math.max(from, Math.min(t0, t1));
    to = Math.min(to, Math.max(t0, t1));
  }
  if (to <= from) return '';
  return `M${ax + dx * from} ${ay + (by - ay) * from}L${ax + dx * to} ${ay + (by - ay) * to}`;
}

/**
 * Printed layers for one strip: `print` in the accent ink and an optional
 * softer `tone` fill. Coordinates are tape-local and stop at the visible end.
 */
export function tapePrint(design, spec, progress, seed, index) {
  const left = -spec.width / 2 + 1.5;
  const right = -spec.width / 2 + spec.width * clamp(progress) - 1.5;
  const top = -spec.height / 2 + 1;
  const bottom = spec.height / 2 - 1;
  const h = bottom - top;
  const offset = (seed + index * 3) % 5;
  const print = [];
  const tone = [];
  let filled = true;
  let lineWidth = 1.1;
  if (right - left < 4) return { print: '', tone: '', filled, lineWidth };

  if (design === 'stripes-thin') {
    filled = false;
    lineWidth = 0.9;
    const spacing = 4.2 + (seed % 3) * 0.6;
    for (let x = left - h + offset; x < right + h; x += spacing) {
      print.push(clippedLine(x, bottom, x + h * 0.6, top, left, right));
    }
  } else if (design === 'stripes-wide') {
    const band = h / 5;
    for (let row = 0; row < 2; row += 1) {
      const y = top + band * (row * 2 + 1) + jitter(seed, 300 + row, 0.3);
      print.push(rect(left, y, right, y + band * 0.9));
    }
  } else if (design === 'dots') {
    const spacing = 5.6 + (seed % 3) * 0.5;
    for (let row = 0; row < 3; row += 1) {
      const y = top + h * (row + 0.5) / 3;
      for (let x = left + 2 + offset * 0.6 + (row % 2) * spacing / 2; x < right - 1.5; x += spacing) {
        print.push(circlePath(x, y, 1.1 + (seed % 2) * 0.25));
      }
    }
  } else if (design === 'gingham') {
    const spacing = 5.2;
    for (let x = left + offset * 0.5; x < right; x += spacing) print.push(rect(x, top, Math.min(right, x + 2.3), bottom));
    for (let y = top + 1; y < bottom; y += spacing) tone.push(rect(left, y, right, Math.min(bottom, y + 2.3)));
  } else if (design === 'stars' || design === 'hearts') {
    const spacing = 11 + (seed % 4);
    for (let x = left + 4.3 + offset, item = 0; x + 4.4 < right; x += spacing, item += 1) {
      const y = (item % 2 ? 1 : -1) * Math.min(1.6, h * 0.1);
      print.push(design === 'stars' ? starPath(x, y, 3.9) : heartPath(x, y, 3.6));
    }
  } else if (design === 'scallop') {
    // A lace-like scalloped border along both long edges.
    const radius = Math.max(1.6, h * 0.15);
    for (let x = left + radius; x + radius <= right; x += radius * 2) {
      print.push(`M${x - radius} ${top}A${radius} ${radius} 0 0 0 ${x + radius} ${top}Z`);
      print.push(`M${x - radius} ${bottom}A${radius} ${radius} 0 0 1 ${x + radius} ${bottom}Z`);
    }
    for (let x = left + radius * 2; x < right - 1; x += radius * 4) print.push(circlePath(x, 0, 0.9));
  } else if (design === 'squiggle') {
    filled = false;
    lineWidth = 1.25;
    const amplitude = h * 0.2;
    const period = 8 + (seed % 3);
    const points = [];
    for (let x = left; x <= right; x += 1.2) {
      points.push(`${points.length ? 'L' : 'M'}${x} ${Math.sin((x + offset) / period * Math.PI * 2) * amplitude + jitter(seed, 400 + points.length, 0.25)}`);
    }
    print.push(points.join(''));
  } else if (design === 'fibre') {
    // Solid tape with a faint printed fibre texture.
    filled = false;
    lineWidth = 0.5;
    const count = Math.ceil((right - left) / 2.2);
    for (let item = 0; item < count; item += 1) {
      const x = left + ((item * 2.2 + jitter(seed, 500 + item, 1.1)) % (right - left));
      const y = top + 1 + Math.abs(jitter(seed, 600 + item, 0.5)) * 2 * (h - 2);
      const length = 2.5 + Math.abs(jitter(seed, 700 + item, 2.5));
      const angle = jitter(seed, 800 + item, 0.45);
      print.push(clippedLine(x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length, left, right));
    }
  } else if (design === 'two-tone') {
    filled = false;
    lineWidth = 0.8;
    const split = jitter(seed, 900 + index, h * 0.08);
    tone.push(rect(left, split, right, bottom));
    print.push(`M${left} ${split}L${right} ${split}`);
  }
  return { print: print.filter(Boolean).join(' '), tone: tone.filter(Boolean).join(' '), filled, lineWidth };
}

function freeEndPath(spec, progress, seed, index) {
  const visibleWidth = spec.width * clamp(progress);
  if (visibleWidth < 5) return '';
  const left = -spec.width / 2;
  const right = left + visibleWidth;
  const foldWidth = Math.min(5.5, visibleWidth * 0.18);
  const lift = 3.1 * (1 - smoothstep(progress));
  const topRight = edgeY(spec, right, true, seed, 41 + index * 31 + 7, lift);
  const bottomRight = edgeY(spec, right, false, seed, 73 + index * 31 + 7, lift);
  const topLeft = edgeY(spec, right - foldWidth, true, seed, 41 + index * 31 + 6, lift);
  const bottomLeft = edgeY(spec, right - foldWidth, false, seed, 73 + index * 31 + 6, lift);
  return [
    `M${right - foldWidth} ${topLeft}`,
    `L${right} ${topRight}`,
    `L${right} ${bottomRight}`,
    `L${right - foldWidth} ${bottomLeft}`,
    'Z',
  ].join(' ');
}

function transformFor(spec, progress) {
  const peel = 1 - smoothstep(progress);
  return [
    ['translate', spec.centerX + 0.8 * peel, spec.centerY + 1.2 * peel],
    ['rotate', spec.rotation + 0.9 * peel],
  ];
}

function geometry(spec, progress, seed, index, design) {
  // Settled cards redraw often (camera, layout); reuse their path strings.
  const key = [seed, index, design, spec.width.toFixed(2), spec.height.toFixed(2), progress.toFixed(3)].join('|');
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const value = {
    body: tapeBodyPath(spec, progress, seed, index),
    pattern: tapePrint(design, spec, progress, seed, index),
    end: freeEndPath(spec, progress, seed, index),
  };
  geometryCache.set(key, value);
  if (geometryCache.size > CACHE_LIMIT) geometryCache.delete(geometryCache.keys().next().value);
  return value;
}

function clearTape(node, container, index) {
  node.upsert(`washi-tape-${index}-body`, Path, false, container);
  node.upsert(`washi-tape-${index}-tone`, Path, false, container);
  node.upsert(`washi-tape-${index}-pattern`, Path, false, container);
  node.upsert(`washi-tape-${index}-end`, Path, false, container);
}

function drawTape(node, container, spec, progress, opacity, seed, index, design, colours) {
  if (progress <= 0 || opacity <= 0 || !spec.width || !spec.height) {
    clearTape(node, container, index);
    return;
  }

  const transform = transformFor(spec, progress);
  const peel = 1 - smoothstep(progress);
  const base = {
    transform,
    pointerEvents: 'none',
    zIndex: TAPE_Z_INDEX,
    blend: BLEND,
  };
  const { body, pattern, end } = geometry(spec, progress, seed, index, design);
  node.upsert(`washi-tape-${index}-body`, Path, body ? {
    ...base,
    d: body,
    fill: colours.bodies[index],
    fillOpacity: 0.82,
    stroke: 'none',
    opacity,
    shadowColor: TAPE_SHADOW,
    shadowBlur: 5.5 + 3.5 * peel,
    shadowOffsetX: 0.4 + 0.8 * peel,
    shadowOffsetY: 1.2 + 2.2 * peel,
  } : false, container);

  node.upsert(`washi-tape-${index}-tone`, Path, pattern.tone ? {
    ...base,
    d: pattern.tone,
    fill: colours.tone,
    fillOpacity: 0.55,
    stroke: 'none',
    opacity,
  } : false, container);

  node.upsert(`washi-tape-${index}-pattern`, Path, pattern.print ? {
    ...base,
    d: pattern.print,
    fill: pattern.filled ? colours.accent : 'none',
    stroke: pattern.filled ? 'none' : colours.accent,
    lineWidth: pattern.lineWidth,
    lineCap: 'round',
    opacity: Math.min(1, opacity * (design === 'fibre' ? 0.9 : 1.4)),
  } : false, container);

  node.upsert(`washi-tape-${index}-end`, Path, end ? {
    ...base,
    d: end,
    fill: colours.highlight,
    fillOpacity: 0.26 + 0.12 * (1 - peel),
    stroke: 'none',
    opacity: opacity * 0.72,
    shadowColor: TAPE_SHADOW,
    shadowBlur: 2 + 2 * peel,
    shadowOffsetY: 1 + 1.4 * peel,
    blend: 'source-over',
  } : false, container);
}

/**
 * Render at most two corner tapes in node-local coordinates.
 *
 * `tape1Progress` reveals the top-left strip and `tape2Progress` reveals the
 * opposite bottom-right strip. Progress is clamped to [0, 1], and the
 * optional `tapeOpacity` is clamped to [0, 1] with a default of 0.58.
 */
export function drawWashiTape(node, attributes, container) {
  if (!node?.upsert || !container) return;

  const [width, height] = sizeOf(node, attributes);
  const seed = nodeSeed(node, attributes);
  const opacity = clamp(dataValue(attributes, 'tapeOpacity', TAPE_OPACITY));
  const design = tapeDesignFor(seed, dataValue(attributes, 'tapeDesign', ''));
  const colours = tapeColours(seed, dataValue(attributes, 'decorationPalette', ''));
  for (let index = 0; index < TAPE_COUNT; index += 1) {
    const progress = clamp(dataValue(attributes, `tape${index + 1}Progress`, 0));
    if (!width || !height) {
      clearTape(node, container, index);
      continue;
    }
    drawTape(node, container, tapeSpec(index, width, height, seed), progress, opacity, seed, index, design, colours);
  }
}
