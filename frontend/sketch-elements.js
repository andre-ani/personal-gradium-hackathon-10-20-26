import { drawWashiTape } from './washi-tape.js';
import { drawDoodleDecoration } from './doodle-decorations.js';
/**
 * The graph's hand-drawn layer.
 *
 * G6 still owns layout, hit testing and interaction. These elements only
 * replace the key shape with a deterministic Rough.js path, which keeps the
 * sketch stable while the camera or a node moves.
 */
import { Circle as GCircle, Path, Text as GText } from '@antv/g';
import { Polyline, BaseNode, ExtensionCategory, register } from '@antv/g6';
import { RoughGenerator } from 'roughjs/bin/generator.js';
import { EDGE_CORNER_RADIUS, edgeRoutesFrozen, organicRoute } from './graph-edge-routes.js';
import { paperTexturePattern } from './note-paper.js';
import {
  CARD_GROW, CardWords, chooseCardLayout, easeGrow, iconFrame, layoutCard, measureText, startTicking, stopTicking,
} from './card-text.js';

const reducedMotionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
const prefersReducedMotion = () => Boolean(reducedMotionQuery?.matches);

export const SKETCH_NODE_TYPE = 'sketch-rect';
export const SKETCH_EDGE_TYPE = 'sketch-cubic-horizontal';

const generator = new RoughGenerator();
const pathCache = new Map();
const CACHE_LIMIT = 1200;

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));

function hashSeed(value) {
  const text = String(value ?? 'sketch');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

function seedFor(attributes, fallback) {
  const style = attributes || {};
  return Number(style.seed) || hashSeed(style.id || style.data?.id || style.key || fallback);
}

function cachedPaths(key, create) {
  const cached = pathCache.get(key);
  if (cached) return cached;
  const paths = create();
  pathCache.set(key, paths);
  if (pathCache.size > CACHE_LIMIT) pathCache.delete(pathCache.keys().next().value);
  return paths;
}

function pathData(paths) {
  return paths.map(({ d }) => d).filter(Boolean).join(' ');
}

function cubicLength(source, controlA, controlB, target, steps = 24) {
  let length = 0;
  let previous = source;
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const u = 1 - t;
    const point = [
      (u ** 3) * source[0] + 3 * (u ** 2) * t * controlA[0] + 3 * u * (t ** 2) * controlB[0] + (t ** 3) * target[0],
      (u ** 3) * source[1] + 3 * (u ** 2) * t * controlA[1] + 3 * u * (t ** 2) * controlB[1] + (t ** 3) * target[1],
    ];
    length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    previous = point;
  }
  return Math.max(length, 1);
}

function roundedRectPath(x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  if (!r) return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
  return [
    `M${x + r} ${y}`,
    `H${x + width - r}`,
    `Q${x + width} ${y} ${x + width} ${y + r}`,
    `V${y + height - r}`,
    `Q${x + width} ${y + height} ${x + width - r} ${y + height}`,
    `H${x + r}`,
    `Q${x} ${y + height} ${x} ${y + height - r}`,
    `V${y + r}`,
    `Q${x} ${y} ${x + r} ${y}Z`,
  ].join(' ');
}

function dataValue(attributes, key, fallback) {
  return attributes?.[key] ?? attributes?.data?.[key] ?? attributes?.style?.[key] ?? fallback;
}

function nodeVariant(attributes) {
  return dataValue(attributes, 'nodeVariant', 'anchor');
}

function hasNodeText(attributes) {
  return Boolean(String(dataValue(attributes, 'headingText', '') || '').trim()
    || String(dataValue(attributes, 'bodyText', '') || '').trim());
}

function sketchIcons(attributes) {
  const icons = dataValue(attributes, 'sketchIconPaths', []);
  return Array.isArray(icons) ? icons.filter((icon) => icon && typeof icon.d === 'string' && icon.d) : [];
}

function jitter(seed, index, amount) {
  const value = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * amount * 2 - amount;
}

// One hand-cut edge from a to b: a gentle seeded bow plus a smaller wave,
// drawn as two quadratic segments so the paper never looks ruled.
function wavyEdge(a, b, seed, index) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const scale = Math.min(1, length / 160);
  const bow = jitter(seed, index, 2.6) * scale;
  const waveA = jitter(seed, index + 1, 1.8) * scale;
  const waveB = jitter(seed, index + 2, 1.8) * scale;
  const t = 0.5 + jitter(seed, index + 3, 0.08);
  const at = (f, offset) => `${(a[0] + dx * f + nx * offset).toFixed(2)} ${(a[1] + dy * f + ny * offset).toFixed(2)}`;
  return `Q${at(t / 2, bow + waveA)} ${at(t, bow)} Q${at((1 + t) / 2, bow + waveB)} ${b[0].toFixed(2)} ${b[1].toFixed(2)}`;
}

/**
 * Size of a curled corner. Resting curls (at most 0.6) keep their historic
 * size; a card being placed curls further, up to a clearly lifted corner.
 */
const TEXT_HOLD_GRACE = 300;

function curlSizeFor(width, height, curl) {
  const extra = Math.max(0, curl - 0.6) / 0.4;
  return Math.min(24 + 18 * extra, Math.max(10, Math.min(width, height) * (0.08 + curl * 0.08 + 0.1 * extra)));
}

/** Cards keep flat corners; a curled corner read as a rendering glitch. */
function shownCurl() { return 0; }

/** Lift above the paper: 1 is held up, 0 resting, slightly below 0 pressed flat. */
const liftValue = (attributes, style) => clamp(dataValue(attributes, 'liftProgress', style.liftProgress ?? 0), -0.2, 1);

/** Size of a decision card's cut top-right corner. */
const cutSize = (width, height) => Math.min(22, Math.max(10, Math.min(width, height) * 0.16));

function irregularPaperPath(x, y, width, height, radius, seed, paperCurl = 0, cut = false) {
  const r = Math.max(2, Math.min(radius || 10, Math.min(width, height) / 2));
  // Corners differ per card; one of them is cut noticeably rounder.
  const soft = seed % 4;
  const corner = (index) => Math.max(1.5, r * (0.55 + Math.abs(jitter(seed, 40 + index, 0.9)))
    + (index === soft ? 6 + Math.abs(jitter(seed, 44, 4)) : 0));
  const [topLeft, topRight, bottomRight, bottomLeft] = [0, 1, 2, 3].map(corner);
  const curl = clamp(paperCurl);
  const curlSize = curl ? curlSizeFor(width, height, curl) : 0;
  const point = (px, py, index, amount = 1.4) => [px + jitter(seed, index, amount), py + jitter(seed, index + 50, amount)];
  const tl = point(x, y, 1);
  const tr = point(x + width, y, 2);
  // A curled note shares its corner with the curl face drawn on top.
  const br = curlSize
    ? [x + width + jitter(seed, 35, 1.8) * curl, y + height + jitter(seed, 36, 1.4) * curl]
    : point(x + width, y + height, 3);
  const bl = point(x, y + height, 4);
  const pt = (p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
  const topStart = [tl[0] + topLeft, tl[1]];
  const chamfer = cut ? cutSize(width, height) : 0;
  const topEnd = [tr[0] - (chamfer || topRight), tr[1]];
  const rightStart = [tr[0], tr[1] + (chamfer || topRight)];
  const rightEnd = [br[0], br[1] - (curlSize || bottomRight)];
  const bottomStart = [br[0] - (curlSize || bottomRight), br[1]];
  const bottomEnd = [bl[0] + bottomLeft, bl[1]];
  const leftStart = [bl[0], bl[1] - bottomLeft];
  const leftEnd = [tl[0], tl[1] + topLeft];
  const rightCorner = curlSize
    ? `Q${pt([br[0] + jitter(seed, 11, 1.8), br[1] - curlSize * 0.16])} ${pt([br[0] - curlSize * 0.45, br[1] + jitter(seed, 12, 1.6)])} Q${pt([br[0] - curlSize * 0.7, br[1] + jitter(seed, 13, 1.2)])} ${pt(bottomStart)}`
    : `Q${pt(br)} ${pt(bottomStart)}`;
  return [
    `M${pt(topStart)}`,
    wavyEdge(topStart, topEnd, seed, 60),
    chamfer ? wavyEdge(topEnd, rightStart, seed, 80) : `Q${pt(tr)} ${pt(rightStart)}`,
    wavyEdge(rightStart, rightEnd, seed, 64),
    rightCorner,
    wavyEdge(bottomStart, bottomEnd, seed, 68),
    `Q${pt(bl)} ${pt(leftStart)}`,
    wavyEdge(leftStart, leftEnd, seed, 72),
    `Q${pt(tl)} ${pt(topStart)}Z`,
  ].join(' ');
}

function nodePaperPath(variant, x, y, width, height, radius, seed, curl = 0, cut = false) {
  // Every node is a sheet of paper. The seed changes the silhouette itself,
  // so the edges stay imperfect after the visible outline is removed.
  return irregularPaperPath(
    x,
    y,
    width,
    height,
    radius,
    seed,
    curl,
    cut,
  );
}

const cardFlag = (attributes, style, key) => Boolean(dataValue(attributes, key, style[key]));

/** Hand-drawn mark paths for a card's level and kind (card-local, origin top-left of the box). */
function levelKindMarks({ x, y, width, height, seed, cut, strip, outline, marker }) {
  const marks = {};
  if (cut) {
    const size = cutSize(width, height);
    marks.cut = `M${(x + width - size).toFixed(2)} ${(y + jitter(seed, 81, 1)).toFixed(2)} L${(x + width + jitter(seed, 82, 1)).toFixed(2)} ${(y + size).toFixed(2)}`;
  }
  if (strip) {
    // A marker swash along the top: the section's colour tab.
    const inset = Math.min(16, width * 0.08);
    const top = y + 8 + jitter(seed, 83, 1.2);
    marks.strip = `M${(x + inset).toFixed(2)} ${top.toFixed(2)} L${(x + width - inset - (cut ? cutSize(width, height) : 0)).toFixed(2)} ${(top + jitter(seed, 84, 1.6)).toFixed(2)}`;
  }
  if (outline) marks.outline = true;
  if (marker) marks.marker = { cx: x + 3 + jitter(seed, 85, 1.5), cy: y + 3 + jitter(seed, 86, 1.5) };
  return marks;
}

function accentDefinition(variant, x, y, width, height, padding, seed) {
  if (variant === 'section') {
    const start = [x + padding, y + height - Math.max(8, padding * 0.65)];
    const end = [x + width - padding + jitter(seed, 31, 2), start[1] + jitter(seed, 32, 1.5)];
    return `M${start[0]} ${start[1]} L${end[0]} ${end[1]}`;
  }
  if (variant === 'annotation') {
    const start = [x + padding, y + padding + jitter(seed, 33, 1.5)];
    const end = [x + padding + Math.min(width * 0.42, 96), start[1] + jitter(seed, 34, 1.8)];
    return `M${start[0]} ${start[1]} L${end[0]} ${end[1]}`;
  }
  return null;
}

function noteCurlDefinition(x, y, width, height, seed, paperCurl = 0) {
  const curl = clamp(paperCurl);
  if (!curl) return null;
  const size = curlSizeFor(width, height, curl);
  const displacedX = jitter(seed, 35, 1.8) * curl;
  const displacedY = jitter(seed, 36, 1.4) * curl;
  const right = x + width + displacedX;
  const bottom = y + height + displacedY;
  const foldX = right - size;
  const foldY = bottom - size;
  const triangle = (offsetX, offsetY) => [
    `M${foldX + offsetX} ${bottom + offsetY}`,
    `Q${right - size * 0.18 + offsetX} ${bottom - size * 0.1 + offsetY} ${right + offsetX} ${foldY + offsetY}`,
    `Q${right + size * 0.1 + offsetX} ${bottom - size * 0.24 + offsetY} ${right + size * 0.08 + offsetX} ${bottom + size * 0.06 + offsetY}`,
    `Q${right - size * 0.38 + offsetX} ${bottom + size * 0.12 + offsetY} ${foldX + offsetX} ${bottom + offsetY}Z`,
  ].join(' ');
  return {
    face: triangle(0, 0),
    shadow: triangle(1.4 + curl * 1.8, 2.1 + curl * 2.2),
    softShadow: triangle(0.2 + curl, 1 + curl),
  };
}

function inkBleedDefinition(attributes, style, variant, x, y, width, height, seed) {
  // `inkBleed` defaults to true for paper variants; pass false for a clean
  // card or set a color/opacity through inkBleedColor/inkBleedOpacity.
  if (!['anchor', 'note', 'action'].includes(variant)) return null;
  if (dataValue(attributes, 'inkBleed', style.inkBleed ?? true) === false) return null;
  // Keep the marks sparse: roughly one in three paper nodes gets one mark.
  const selector = hashSeed(`${seed}:ink-bleed`);
  if (selector % 3 !== 0) return null;
  const corner = selector % 4;
  const inset = Math.min(4, Math.max(2.5, Math.min(width, height) * 0.035));
  const base = [
    [x + inset, y + inset],
    [x + width - inset, y + inset],
    [x + width - inset, y + height - inset],
    [x + inset, y + height - inset],
  ][corner];
  const offsetX = jitter(seed, 41, 1.7);
  const offsetY = jitter(seed, 42, 1.7);
  return {
    cx: base[0] + offsetX,
    cy: base[1] + offsetY,
    offsetX,
    offsetY,
    radius: 2.2 + (selector % 5) * 0.36,
    blur: 2.2 + (selector % 4) * 0.55,
  };
}

function roughOptions(style, seed, { fill = false } = {}) {
  return {
    seed,
    roughness: Number(style.roughness ?? 0.72),
    bowing: Number(style.bowing ?? 0.55),
    stroke: style.stroke || '#1c4690',
    strokeWidth: Number(style.lineWidth ?? 1.25),
    fill: fill ? style.fill || '#faf8f1' : 'none',
    fillStyle: style.fillStyle || 'solid',
    disableMultiStroke: Boolean(style.disableMultiStroke),
    disableMultiStrokeFill: Boolean(style.disableMultiStrokeFill),
    preserveVertices: true,
  };
}

function effectiveNodeStroke(style) {
  const stroke = style.stroke;
  return stroke && stroke !== 'transparent' && stroke !== 'none' ? stroke : '#1c46904d';
}

function progressStyle(style, progress, isEdge, pathLength = 1000) {
  const next = { ...style, lineDash: style.lineDash ?? [], lineDashOffset: 0 };
  const amount = progress == null ? 1 : clamp(progress);
  // G's dash reveal works on the rough path as well as the normal path. The
  // caller supplies a geometry-length estimate so progress traces the curve.
  if (isEdge && amount < 1) {
    next.lineDash = [Math.max(0, amount * pathLength), pathLength * 2];
    next.lineDashOffset = 0;
    // A zero-length dash still paints its round cap as a dot; hide undrawn edges.
    if (amount <= 0) next.strokeOpacity = 0;
  }
  if (!isEdge && style.drawProgress != null && amount < 1) {
    next.lineDash = [Math.max(0, amount * pathLength), pathLength * 2];
    next.lineDashOffset = 0;
    next.fillOpacity = amount;
  }
  return next;
}


function iconTilt(id) {
  let hash = 2166136261;
  for (const ch of `icon:${id}`) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return ((hash >>> 0) / 4294967295) * 14 - 7;
}

export class SketchNode extends BaseNode {
  getSketchPaths(attributes, style) {
    const [width, height] = this.getSize(attributes);
    const x = -width / 2;
    const y = -height / 2;
    const variant = nodeVariant(attributes);
    const radius = Number(style.radius ?? attributes.radius ?? 10);
    const seed = seedFor(attributes, this.id || 'node');
    const paperCurl = shownCurl(variant, dataValue(attributes, 'paperCurl', style.paperCurl ?? 0.35), liftValue(attributes, style));
    const cut = cardFlag(attributes, style, 'cardCutCorner');
    // The silhouette carries the hand-made character now. Rough.js is still
    // used for the paper fill, but its perimeter stroke is deliberately off.
    const roughStyle = { ...style, stroke: 'none', lineWidth: 0 };
    const key = [
      'node', variant, seed, width, height, radius, paperCurl, cut, roughStyle.stroke, roughStyle.fill,
      roughStyle.lineWidth, roughStyle.roughness, roughStyle.bowing, roughStyle.fillStyle,
    ].join('|');
    return cachedPaths(key, () => generator.toPaths(
      generator.path(nodePaperPath(variant, x, y, width, height, radius, seed, paperCurl, cut), roughOptions(roughStyle, seed, { fill: true })),
    ));
  }

  getKeyStyle(attributes) {
    const style = super.getKeyStyle(attributes);
    const [width, height] = this.getSize(attributes);
    const x = -width / 2;
    const y = -height / 2;
    const variant = nodeVariant(attributes);
    const radius = Number(style.radius ?? attributes.radius ?? 10);
    const seed = seedFor(attributes, this.id || 'node');
    const paperCurl = shownCurl(variant, dataValue(attributes, 'paperCurl', style.paperCurl ?? 0.35), liftValue(attributes, style));
    const paperPath = nodePaperPath(variant, x, y, width, height, radius, seed, paperCurl, cardFlag(attributes, style, 'cardCutCorner'));
    const perimeter = Math.max(width * 2 + height * 2, 1);
    const progress = dataValue(attributes, 'drawProgress', style.drawProgress);
    return progressStyle({
      ...style,
      drawProgress: progress,
      x,
      y,
      width,
      height,
      d: paperPath,
      // Keep the key shape for bounds/hit testing while removing its visual
      // contribution. The paper surface and texture are separate paths.
      fill: 'transparent',
      fillOpacity: 0,
      stroke: 'transparent',
      strokeOpacity: 0,
      lineWidth: 0,
      pointerEvents: 'auto',
      shadowColor: 'transparent',
    }, progress, false, perimeter);
  }

  getLabelStyle(attributes) {
    if (hasNodeText(attributes)) return false;
    const style = super.getLabelStyle(attributes);
    const progress = dataValue(attributes, 'drawProgress', style?.drawProgress);
    if (!style || progress == null) return style;
    return { ...style, opacity: clamp(progress) * (style.opacity ?? 1) };
  }

  drawKeyShape(sourceAttributes, container) {
    // Paper, shadow and decorations draw at the eased on-screen size; G6 data
    // keeps the target size so routing and placement see it immediately.
    const attributes = this.shownCardAttributes(sourceAttributes);
    const style = super.getKeyStyle(attributes);
    const variant = nodeVariant(attributes);
    const [width, height] = this.getSize(attributes);
    const x = -width / 2;
    const y = -height / 2;
    const seed = seedFor(attributes, this.id || 'node');
    const padding = Number(dataValue(attributes, 'textPadding', style.textPadding ?? 20));
    // Placing a card: held up (larger, softer and deeper shadow, extra tilt,
    // corner curled) at lift 1, then pressed flat. A small negative lift is
    // the landing press: the shadow tightens a touch below its resting value.
    const lift = liftValue(attributes, style);
    const liftProgress = Math.max(0, lift);
    const paperCurl = shownCurl(variant, dataValue(attributes, 'paperCurl', style.paperCurl ?? 0.35), liftProgress);
    const liftScale = 1 + 0.075 * lift;
    const paths = this.getSketchPaths(attributes, style);
    const fills = paths.filter((item) => item.fill && item.fill !== 'none');
    const surfacePath = pathData(fills)
      || nodePaperPath(variant, x, y, width, height, Number(style.radius ?? attributes.radius ?? 10), seed, paperCurl, cardFlag(attributes, style, 'cardCutCorner'));
    const progress = dataValue(attributes, 'drawProgress', style.drawProgress) == null
      ? 1
      : clamp(dataValue(attributes, 'drawProgress', style.drawProgress));
    this.upsert('fill', Path, surfacePath ? {
      d: surfacePath,
      fill: style.fill || '#e5e6e3',
      fillOpacity: progress,
      stroke: 'none',
      pointerEvents: 'none',
      shadowColor: style.shadowColor || '#173b6b14',
      shadowBlur: Math.max(0, (style.shadowBlur ?? 14) + 28 * lift),
      shadowOffsetY: Math.max(0, (style.shadowOffsetY ?? 4) + 12 * lift),
    } : false, container);
    const key = this.upsert('key', Path, this.getKeyStyle(attributes), container);
    this.upsert('paper-texture', Path, {
      d: surfacePath,
      fill: paperTexturePattern(seed),
      fillOpacity: progress * (style.paperTextureOpacity ?? 0),
      stroke: 'none',
      pointerEvents: 'none',
      zIndex: 1,
    }, container);

    const inkBleed = inkBleedDefinition(attributes, style, variant, x, y, width, height, seed);
    this.upsert('ink-bleed', GCircle, inkBleed ? {
      cx: inkBleed.cx,
      cy: inkBleed.cy,
      r: inkBleed.radius,
      fill: style.inkBleedColor || '#1c4690',
      fillOpacity: style.inkBleedFillOpacity ?? 0.2,
      opacity: progress * (style.inkBleedOpacity ?? 0.65),
      shadowColor: style.inkBleedShadowColor || '#1c469070',
      shadowBlur: inkBleed.blur,
      shadowOffsetX: inkBleed.offsetX,
      shadowOffsetY: inkBleed.offsetY,
      pointerEvents: 'none',
      zIndex: 1,
    } : false, container);

    const accent = style.accent && style.accent !== 'transparent' && style.accent !== 'none'
      ? accentDefinition(variant, x, y, width, height, padding, seed)
      : null;
    const accentDrawable = accent
      ? generator.toPaths(generator.path(accent, roughOptions({
        ...style,
        stroke: style.accent,
        lineWidth: style.accentLineWidth ?? 1.35,
        disableMultiStroke: true,
      }, seed + 101)))
      : [];
    this.upsert('accent', Path, accentDrawable.length ? {
      d: pathData(accentDrawable),
      fill: 'none',
      stroke: style.accent,
      lineWidth: style.accentLineWidth ?? 1.35,
      opacity: progress * (style.accentOpacity ?? 0.76),
      pointerEvents: 'none',
    } : false, container);

    const curl = paperCurl > 0 && dataValue(attributes, 'fold', true) !== false
      ? noteCurlDefinition(x, y, width, height, seed, paperCurl)
      : null;
    this.upsert('curl-shadow-soft', Path, curl ? {
      d: curl.softShadow,
      fill: '#707679',
      fillOpacity: progress * (0.07 + 0.04 * liftProgress),
      stroke: 'none',
      shadowColor: '#4b515455',
      shadowBlur: 3 + 3 * liftProgress,
      shadowOffsetY: 1 + 2 * liftProgress,
      pointerEvents: 'none',
      zIndex: 0,
    } : false, container);
    this.upsert('curl-shadow', Path, curl ? {
      d: curl.shadow,
      fill: '#4c5356',
      fillOpacity: progress * (0.11 + 0.08 * liftProgress),
      stroke: 'none',
      shadowColor: '#33393d66',
      shadowBlur: 3 + 6 * liftProgress,
      shadowOffsetY: 2 + 3 * liftProgress,
      pointerEvents: 'none',
      zIndex: 0,
    } : false, container);
    this.upsert('curl-face', Path, curl ? {
      d: curl.face,
      fill: style.paperCurlFill || '#f2f3f0',
      fillOpacity: progress * (0.82 + 0.08 * liftProgress),
      stroke: 'none',
      shadowColor: '#454b4e2e',
      shadowBlur: 1.5 + 3 * liftProgress,
      shadowOffsetY: 1 + 2 * liftProgress,
      pointerEvents: 'none',
      zIndex: 1,
    } : false, container);
    // Clear the old fold child if a graph update arrives from a previous
    // version of the note renderer. The curl has no colored crease or border.
    this.upsert('fold', Path, false, container);

    const textColor = style.textColor || dataValue(attributes, 'labelFill') || '#173b6b';
    this.drawLevelKindMarks(attributes, style, { x, y, width, height, seed, progress, surfacePath }, container);
    this.drawCardText(attributes, style, { variant, padding, progress, textColor, origin: [x, y], held: this.textHeld(attributes, style) }, container);
    // This is an absolute local scale, so repeated graph updates never
    // compound the lift. The element origin is the node center; x/y data and
    // the key shape remain the source of truth for layout and hit testing.
    // A numbered step wears its round number sticker on the top-left corner,
    // so its tape goes only on the opposite (bottom-right) corner.
    const numbered = Number(dataValue(attributes, 'cardStep', style.cardStep ?? 0)) > 0
      && (dataValue(attributes, 'cardMarker', style.cardMarker ?? '') || '') === 'number';
    const tape = (index) => Number(dataValue(attributes, `tape${index}Progress`, 0)) || 0;
    drawWashiTape(this, numbered ? { ...attributes, tape1Progress: 0, tape2Progress: Math.max(tape(1), tape(2)) } : attributes, container);
    drawDoodleDecoration(this, attributes, container);
    this.setLocalScale(liftScale, liftScale, 1);
    // A seeded tilt of at most 1.5 degrees: cut paper never sits square.
    // While lifted it turns a few more seeded degrees and straightens on landing.
    const liftTilt = (jitter(seed, 91, 1) < 0 ? -1 : 1) * (2.5 + Math.abs(jitter(seed, 92, 2)));
    this.setLocalEulerAngles?.(jitter(seed, 90, Number(dataValue(attributes, 'cardTilt', style.cardTilt ?? 1.5)) || 1.5)
      + liftTilt * liftProgress);
    return key;
  }

  /**
   * Level and kind marks: the title's inked outline, a section's colour strip,
   * a decision's cut-corner stroke, a question's faint "?" and a task's step
   * number or checkbox. Each is drawn only when its style flag is set.
   */
  drawLevelKindMarks(attributes, style, { x, y, width, height, seed, progress, surfacePath }, container) {
    const ink = dataValue(attributes, 'cardInk', style.cardInk) || '#173b6b';
    const outlineWidth = Number(dataValue(attributes, 'cardOutline', style.cardOutline ?? 0)) || 0;
    const marker = dataValue(attributes, 'cardMarker', style.cardMarker ?? '') || '';
    const marks = levelKindMarks({
      x, y, width, height, seed,
      cut: cardFlag(attributes, style, 'cardCutCorner'),
      strip: cardFlag(attributes, style, 'cardStrip'),
      outline: outlineWidth > 0,
      marker,
    });
    const rough = (key, d, options) => cachedPaths(`${key}|${seed}|${d}`, () => generator.toPaths(generator.path(d, roughOptions({
      roughness: 0.9, bowing: 0.6, disableMultiStroke: true, ...options,
    }, seed + 211))));
    const line = (name, d, options, attrs) => {
      const drawn = d ? rough(name, d, options) : [];
      this.upsert(name, Path, drawn.length ? {
        d: pathData(drawn), fill: 'none', stroke: options.stroke, lineWidth: options.lineWidth,
        lineCap: 'round', lineJoin: 'round', pointerEvents: 'none', zIndex: 1, ...attrs,
      } : false, container);
    };
    line('level-outline', marks.outline ? surfacePath : null, { stroke: ink, lineWidth: outlineWidth, roughness: 0.7 }, { opacity: progress * 0.55 });
    line('level-strip', marks.strip, { stroke: ink, lineWidth: 6, roughness: 1.1 }, { opacity: progress * 0.32 });
    line('kind-cut', marks.cut, { stroke: ink, lineWidth: 1.4 }, { opacity: progress * 0.6 });
    const mark = dataValue(attributes, 'cardCornerMark', style.cardCornerMark ?? '');
    this.upsert('kind-mark', GText, mark ? {
      x: x + width - 16 + jitter(seed, 87, 2), y: y + 6 + jitter(seed, 88, 2),
      text: mark, fontFamily: 'Patrick Hand, cursive', fontSize: Math.min(34, Math.max(20, height * 0.22)),
      fill: ink, opacity: progress * 0.34, textAlign: 'center', textBaseline: 'top',
      transform: [['rotate', 8 + jitter(seed, 89, 6)]], transformOrigin: 'center',
      pointerEvents: 'none', zIndex: 1,
    } : false, container);
    const badge = marks.marker;
    const step = Number(dataValue(attributes, 'cardStep', style.cardStep ?? 0)) || 0;
    const paper = style.fill || '#fcfcfc';
    if (badge && marker === 'number' && step > 0) {
      // A paper sticker: a white die-cut rim, a softly tinted centre in the
      // card's colour, the number in ink, lifted by a small shadow, with one
      // edge just starting to peel. It replaces washi tape on numbered steps.
      const r = 15, inner = 11.5;
      const cx = badge.cx + 4, cy = badge.cy + 4;
      const ring = (radius, a, b) => `M${cx - radius} ${cy} a${radius} ${radius + a} 0 1 0 ${2 * radius} 0 a${radius} ${radius - b} 0 1 0 ${-2 * radius} 0`;
      const wobble = [jitter(seed, 94, .7), jitter(seed, 95, .7)];
      this.upsert('kind-badge', Path, { d: ring(r, ...wobble), fill: '#fffdf8', stroke: ink, strokeOpacity: .16, lineWidth: .8,
        shadowColor: '#1a1f2a2e', shadowBlur: 4, shadowOffsetX: .5, shadowOffsetY: 1.5, opacity: progress, pointerEvents: 'none', zIndex: 3 }, container);
      this.upsert('kind-badge-ring', Path, { d: ring(inner, wobble[1] * .6, wobble[0] * .6), fill: ink, fillOpacity: .2, stroke: 'none',
        opacity: progress, pointerEvents: 'none', zIndex: 3 }, container);
      // The peel: a sliver of the sticker's underside catching the light.
      const peelAt = Math.PI * (1.4 + jitter(seed, 97, .25));
      const px = cx + Math.cos(peelAt) * r, py = cy + Math.sin(peelAt) * r;
      const tx = cx + Math.cos(peelAt + .5) * r * .92, ty = cy + Math.sin(peelAt + .5) * r * .92;
      this.upsert('kind-check', Path, { d: `M${px} ${py} Q${(px + tx) / 2 + Math.cos(peelAt) * 3} ${(py + ty) / 2 + Math.sin(peelAt) * 3} ${tx} ${ty} Z`,
        fill: '#efe9df', stroke: ink, strokeOpacity: .12, lineWidth: .6, opacity: progress, pointerEvents: 'none', zIndex: 3 }, container);
      this.upsert('kind-badge-text', GText, {
        x: cx, y: cy + 1, text: String(step), fontFamily: 'Patrick Hand, cursive', fontSize: 17,
        fill: ink, opacity: progress * .9, textAlign: 'center', textBaseline: 'middle', pointerEvents: 'none', zIndex: 3,
        transform: [['rotate', jitter(seed, 96, 6)]], transformOrigin: 'center',
      }, container);
    } else if (badge && marker === 'checkbox') {
      const s = 13, left = badge.cx - s / 2 + 4, top = badge.cy - s / 2 + 4;
      const done = cardFlag(attributes, style, 'cardDone');
      const box = `M${left} ${top} L${left + s} ${top + jitter(seed, 91, 1)} L${left + s + jitter(seed, 92, 1)} ${top + s} L${left} ${top + s + jitter(seed, 93, 1)} Z`;
      const tick = done ? ` M${left + 2.5} ${top + s * 0.55} L${left + s * 0.45} ${top + s - 2} L${left + s + 3} ${top - 3}` : '';
      const drawn = rough('kind-check', box + tick, { stroke: ink, lineWidth: 1.2 });
      this.upsert('kind-badge', Path, { d: box, fill: paper, stroke: 'none', opacity: progress, pointerEvents: 'none', zIndex: 3 }, container);
      this.upsert('kind-check', Path, { d: pathData(drawn), fill: 'none', stroke: ink, lineWidth: 1.2, lineCap: 'round', lineJoin: 'round', opacity: progress * 0.7, pointerEvents: 'none', zIndex: 3 }, container);
      this.upsert('kind-badge-ring', Path, false, container);
      this.upsert('kind-badge-text', GText, false, container);
    } else {
      for (const name of ['kind-badge', 'kind-badge-ring', 'kind-check']) this.upsert(name, Path, false, container);
      this.upsert('kind-badge-text', GText, false, container);
    }
  }

  /** Attributes with the on-screen size, which eases toward the G6 size. */
  shownCardAttributes(attributes) {
    this._cardSource = attributes;
    const target = this.getSize(attributes);
    const time = performance.now();
    const motion = this._sizeMotion;
    if (!motion) this._sizeMotion = { from: target, to: target, start: time };
    else if (motion.to[0] !== target[0] || motion.to[1] !== target[1]) {
      const shown = this.shownSize(time);
      this._sizeMotion = { from: prefersReducedMotion() ? target : shown, to: target, start: time };
      this.startCardMotion();
    }
    const shown = this.shownSize(time);
    this._cardTarget = target;
    return shown[0] === target[0] && shown[1] === target[1] ? attributes : { ...attributes, size: shown };
  }

  shownSize(time) {
    const { from, to, start } = this._sizeMotion;
    const progress = Math.min(1, Math.max(0, (time - start) / CARD_GROW.duration));
    if (progress >= 1) return to;
    const eased = easeGrow(progress);
    return [0, 1].map((index) => Math.round((from[index] + (to[index] - from[index]) * eased) * 2) / 2);
  }

  /** Redraws the paper every frame while the size or icon is still moving. */
  startCardMotion() {
    this._cardTicker ??= {
      tick: (time) => {
        if (this.destroyed) return false;
        this.drawKeyShape(this._cardSource, this);
        const sizeMoving = time - this._sizeMotion.start < CARD_GROW.duration;
        const iconMoving = this._iconMotion && time - this._iconMotion.start < CARD_GROW.duration;
        return sizeMoving || iconMoving;
      },
    };
    startTicking(this._cardTicker);
  }

  /**
   * A card being placed keeps its words back until it lands. The entrance
   * refreshes `textHold` every frame; the hold lapses shortly after the last
   * refresh, so a redraw that drops the style (or a cancelled entrance) can
   * neither start the words early nor keep them hidden.
   */
  textHeld(attributes, style) {
    const hold = dataValue(attributes, 'textHold', style.textHold);
    const now = performance.now();
    if (hold === false) this._textHoldUntil = 0;
    else if (hold === true || dataValue(attributes, 'drawProgress', style.drawProgress) === 0) this._textHoldUntil = now + TEXT_HOLD_GRACE;
    return hold !== false && now < (this._textHoldUntil || 0);
  }

  drawCardText(attributes, style, { variant, padding, progress, textColor, origin, held = false }, container) {
    // Single-text shapes from earlier renderer versions.
    this.upsert('heading', GText, false, container);
    this.upsert('body', GText, false, container);
    const heading = String(dataValue(attributes, 'headingText', '') || '').trim();
    const body = String(dataValue(attributes, 'bodyText', '') || '').trim();
    const icons = sketchIcons(attributes);
    const [width, height] = this._cardTarget || this.getSize(attributes);
    const headingFont = {
      size: Number(style.headingFontSize ?? (variant === 'anchor' ? 30 : 24)),
      family: style.headingFontFamily || 'Patrick Hand, Comic Sans MS, cursive',
      weight: style.headingFontWeight ?? (variant === 'anchor' ? 500 : 400),
    };
    const bodyFont = {
      size: Number(style.bodyFontSize ?? 13),
      family: style.bodyFontFamily || 'Patrick Hand, cursive',
      weight: style.bodyFontWeight ?? 400,
    };
    const bodyLineHeight = style.bodyLineHeight == null ? undefined : Number(style.bodyLineHeight);
    const layoutKey = JSON.stringify([heading, body, icons.length > 0, width, height, padding, headingFont, bodyFont, bodyLineHeight]);
    if (layoutKey !== this._cardLayoutKey) {
      const mode = chooseCardLayout({ heading, body, previous: this._cardLayout?.mode });
      this._cardLayout = layoutCard({
        width, height, padding, mode, heading, body, hasIcon: icons.length > 0, headingFont, bodyFont, bodyLineHeight, measure: measureText,
      });
      this._cardLayoutKey = layoutKey;
    }
    const layout = this._cardLayout;
    const time = performance.now();
    const opacity = progress * (style.textOpacity ?? .86);

    // Icon: glides (with a soft fade) to its new layout slot instead of jumping.
    const iconTarget = layout.icon;
    const iconMotion = this._iconMotion;
    let icon = iconTarget;
    if (iconTarget && iconMotion?.to && !prefersReducedMotion()
      && (iconMotion.to.x !== iconTarget.x || iconMotion.to.y !== iconTarget.y || iconMotion.to.size !== iconTarget.size)) {
      const current = iconFrame(iconMotion.from, iconMotion.to, Math.min(1, (time - iconMotion.start) / CARD_GROW.duration));
      this._iconMotion = { from: current, to: iconTarget, start: time };
      this.startCardMotion();
    } else if (!iconMotion || !iconTarget || !iconMotion.to || prefersReducedMotion()) {
      this._iconMotion = { from: iconTarget, to: iconTarget, start: 0 };
    }
    if (iconTarget) icon = iconFrame(this._iconMotion.from, this._iconMotion.to, Math.min(1, (time - this._iconMotion.start) / CARD_GROW.duration));
    const iconFill = style.iconFill || textColor;
    const previousIconCount = this._sketchIconCount || 0;
    for (let index = 0; index < Math.max(previousIconCount, icons.length); index += 1) {
      const path = iconTarget && icons[index];
      this.upsert(`icon-${index}`, Path, path ? {
        d: path.d,
        fill: path.fill === 'currentColor' ? iconFill : (path.fill ?? (path.stroke ? 'none' : iconFill)),
        stroke: path.stroke === 'currentColor' ? iconFill : (path.stroke || 'none'),
        lineWidth: path.lineWidth ?? 1.45,
        lineCap: 'round',
        lineJoin: 'round',
        // A small seeded tilt per card so icons never line up perfectly.
        transform: [['translate', origin[0] + icon.x + icon.size / 2, origin[1] + icon.y + icon.size / 2], ['rotate', iconTilt(this.id)],
          ['scale', icon.size / 24, icon.size / 24], ['translate', -12, -12]],
        opacity: opacity * icon.alpha,
        pointerEvents: 'none',
        zIndex: 2,
      } : false, container);
    }
    this._sketchIconCount = icons.length;

    this._cardWords ??= new CardWords({
      createText: (textStyle) => container.appendChild(new GText({ style: textStyle })),
      removeText: (shape) => { if (!shape.destroyed) shape.remove(); },
      reducedMotion: prefersReducedMotion,
      onGeometryChange: () => {
        if (!this.destroyed && this._cardSource) drawDoodleDecoration(this, this.shownCardAttributes(this._cardSource), this);
      },
      onFontsChanged: () => {
        this._cardLayoutKey = null;
        if (!this.destroyed && this._cardSource) this.drawKeyShape(this._cardSource, this);
      },
    });
    const growing = time - this._sizeMotion.start < CARD_GROW.duration;
    if (held) return;
    this._cardWords.sync(layout.words, {
      origin,
      opacity,
      fills: { heading: style.headingFill || textColor, body: style.bodyFill || textColor },
      minEnterDelay: growing ? CARD_GROW.duration * 0.5 : 0,
    });
  }

  destroy() {
    this._cardWords?.destroy();
    if (this._cardTicker) stopTicking(this._cardTicker);
    super.destroy();
  }
}

/**
 * The arrowhead is part of the connector's own stroke: one open chevron,
 * inked last, so it never sits on the shaft as a separate darker mark.
 */
const ARROW_INK = 19;
function arrowhead(last) {
  if (last?.[0] !== 'C') return [];
  const c2 = last.slice(3, 5), tip = last.slice(5, 7);
  const angle = Math.atan2(tip[1] - c2[1], tip[0] - c2[0]);
  const wing = (turn, size) => [tip[0] - Math.cos(angle + turn) * size, tip[1] - Math.sin(angle + turn) * size];
  return [['M', ...wing(0.5, 10)], ['L', ...tip], ['L', ...wing(-0.5, 9)]];
}

export class SketchEdge extends Polyline {
  // Geometry comes only from the organic router (graph-edge-routes.js), which
  // works from card positions and sizes; G6's own routers are never used.
  getControlPoints() { return []; }

  getPoints(attributes) {
    const route = organicRoute(this.context.graph, this.id);
    if (!route) return super.getPoints(attributes);
    this._inkLength = route.length;
    return route.points;
  }

  getKeyPath(attributes) {
    const route = organicRoute(this.context.graph, this.id);
    if (!route) return super.getKeyPath(attributes);
    this._inkLength = route.length + ARROW_INK;
    return [...route.path, ...arrowhead(route.path.at(-1))];
  }

  getKeyStyle(attributes) {
    const style = super.getKeyStyle({ ...attributes, radius: EDGE_CORNER_RADIUS });
    const progress = clamp(attributes.drawProgress ?? 1);
    const length = Math.max(1, this._inkLength || 1);
    const seed = seedFor(attributes, this.id);
    const pressure = .9 + (seed % 101) / 500;
    const width = (attributes.lineWidth || 2.2) * pressure;
    const nativePath = Array.isArray(style.d) ? style.d.map(part => part.join(' ')).join(' ') : String(style.d || '');
    // Keep the routed curve and its endpoints. Rough.js adds only a small,
    // seeded pen tremor once cards are settled; while they move, the clean
    // curve follows them without regenerating ink every frame.
    if (edgeRoutesFrozen(this.context.graph)) this._inkTexture = style.d;
    else {
      const paths = cachedPaths(`edge-ink:${seed}:${width}:${nativePath}`, () => generator.toPaths(generator.path(nativePath, {
        seed, roughness: .55, bowing: .25, maxRandomnessOffset: .85,
        preserveVertices: true, disableMultiStroke: true, stroke: style.stroke || '#123f85', strokeWidth: width, fill: 'none',
      })));
      this._inkTexture = pathData(paths) || style.d;
    }
    return { ...style, d: this._inkTexture, fill: 'none', lineWidth: width,
      lineCap: 'round', lineJoin: 'round',
      lineDash: progress < 1 ? [length, length] : [], lineDashOffset: length * (1 - progress),
      strokeOpacity: progress === 0 ? 0 : (attributes.strokeOpacity ?? .85) * (.9 + (seed % 17) / 170),
      increasedLineWidthForHitTesting: 8 };
  }

  // The arrowhead is drawn inside the routed path (graph-edge-routes.js).
  drawTargetArrow(attributes) { super.drawTargetArrow({ ...attributes, endArrow: false }); }
}

export function registerSketchElements() {
  register(ExtensionCategory.NODE, SKETCH_NODE_TYPE, SketchNode);
  register(ExtensionCategory.EDGE, SKETCH_EDGE_TYPE, SketchEdge);
  return { nodeType: SKETCH_NODE_TYPE, edgeType: SKETCH_EDGE_TYPE, types: { node: SKETCH_NODE_TYPE, edge: SKETCH_EDGE_TYPE } };
}

export const sketchElementOptions = {
  node: { type: SKETCH_NODE_TYPE },
  edge: { type: SKETCH_EDGE_TYPE },
};

