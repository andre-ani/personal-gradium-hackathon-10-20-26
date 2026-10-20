import { Path } from '@antv/g';

/**
 * Draw the two small pieces of tape that are attached to a sketch node.
 *
 * The caller owns the animation clock: update `tape1Progress` and
 * `tape2Progress` on the node attributes from 0 to 1, then call this
 * function from `SketchNode.drawKeyShape`. A missing progress value is 0.
 * Every shape is node-local, pointer-transparent, and removed through the
 * same upsert keys when its progress reaches 0.
 *
 * @param {import('@antv/g6').BaseNode} node
 * @param {Record<string, any>} attributes
 * @param {import('@antv/g').Group} container
 * @returns {void}
 */

const TAPE_COUNT = 2;
const TAPE_OPACITY = 0.58;
const TAPE_Z_INDEX = 1.35;
const TAPE_COLORS = ['#7f98a5', '#718b9a'];
const TAPE_HIGHLIGHTS = ['#d7e3e6', '#d0dfe3'];
const TAPE_PATTERN = '#174a9c';
const TAPE_SHADOW = '#173b6b36';

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
    rotation: -(17 + Math.abs(jitter(seed, 97 + index * 13, 30))),
    pattern: (seed + index * 7) % 4,
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

function tapeBodyPath(spec, progress, seed, index) {
  const visibleWidth = spec.width * clamp(progress);
  if (visibleWidth <= 0) return '';

  const left = -spec.width / 2;
  const right = left + visibleWidth;
  const lift = 3.1 * (1 - smoothstep(progress));
  const steps = Math.max(3, Math.ceil(visibleWidth / 11));
  const path = [`M${left} ${edgeY(spec, left, true, seed, 41 + index * 31, lift)}`];
  for (let step = 1; step <= steps; step += 1) {
    const x = left + (visibleWidth * step) / steps;
    path.push(`L${x} ${edgeY(spec, x, true, seed, 41 + index * 31 + step, lift)}`);
  }
  path.push(`L${right} ${edgeY(spec, right, false, seed, 73 + index * 31, lift)}`);
  for (let step = steps - 1; step >= 0; step -= 1) {
    const x = left + (visibleWidth * step) / steps;
    path.push(`L${x} ${edgeY(spec, x, false, seed, 73 + index * 31 + step, lift)}`);
  }
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

function tapePatternPath(spec, progress, seed, index) {
  const left = -spec.width / 2 + 3;
  const right = -spec.width / 2 + spec.width * clamp(progress) - 3;
  const spacing = 12 + (seed % 4);
  const offset = (seed + index * 3) % 4;
  const segments = [];
  for (let x = left + 4.3 + offset, item = 0; x + 4.4 < right; x += spacing, item++) {
    const y = (item % 2 ? 1 : -1) * Math.min(0.55, spec.height * 0.04);
    if (spec.pattern === 0) {
      segments.push(starPath(x, y, 4.3));
    } else if (spec.pattern === 1) {
      segments.push(circlePath(x, y, 2.9), circlePath(x + 5, -y, 1.25));
    } else if (spec.pattern === 2) {
      segments.push(`M${x - 2.8} ${y - 3}l5.6 5.2M${x + 4} ${-y - 2.5}l-2.4 4.5`);
    } else {
      segments.push(`M${x} ${y + 3.8}C${x - 7} ${y - 0.8} ${x - 3.7} ${y - 6.2} ${x} ${y - 2.6}C${x + 3.7} ${y - 6.2} ${x + 7} ${y - 0.8} ${x} ${y + 3.8}Z`);
    }
  }
  return { d: segments.join(' '), filled: spec.pattern !== 2 };
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

function clearTape(node, container, index) {
  node.upsert(`washi-tape-${index}-body`, Path, false, container);
  node.upsert(`washi-tape-${index}-pattern`, Path, false, container);
  node.upsert(`washi-tape-${index}-end`, Path, false, container);
}

function drawTape(node, container, spec, progress, opacity, seed, index) {
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
  };
  const body = tapeBodyPath(spec, progress, seed, index);
  node.upsert(`washi-tape-${index}-body`, Path, body ? {
    ...base,
    d: body,
    fill: TAPE_COLORS[index],
    fillOpacity: 0.82,
    stroke: 'none',
    opacity,
    shadowColor: TAPE_SHADOW,
    shadowBlur: 5.5 + 3.5 * peel,
    shadowOffsetX: 0.4 + 0.8 * peel,
    shadowOffsetY: 1.2 + 2.2 * peel,
  } : false, container);

  const pattern = tapePatternPath(spec, progress, seed, index);
  node.upsert(`washi-tape-${index}-pattern`, Path, pattern.d ? {
    ...base,
    d: pattern.d,
    fill: pattern.filled ? TAPE_PATTERN : 'none',
    stroke: pattern.filled ? 'none' : TAPE_PATTERN,
    lineWidth: 1.7,
    lineCap: 'round',
    opacity: Math.min(1, opacity * 1.6),
  } : false, container);

  const end = freeEndPath(spec, progress, seed, index);
  node.upsert(`washi-tape-${index}-end`, Path, end ? {
    ...base,
    d: end,
    fill: TAPE_HIGHLIGHTS[index],
    fillOpacity: 0.26 + 0.12 * (1 - peel),
    stroke: 'none',
    opacity: opacity * 0.72,
    shadowColor: TAPE_SHADOW,
    shadowBlur: 2 + 2 * peel,
    shadowOffsetY: 1 + 1.4 * peel,
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
  for (let index = 0; index < TAPE_COUNT; index += 1) {
    const progress = clamp(dataValue(attributes, `tape${index + 1}Progress`, 0));
    if (!width || !height) {
      clearTape(node, container, index);
      continue;
    }
    drawTape(node, container, tapeSpec(index, width, height, seed), progress, opacity, seed, index);
  }
}
