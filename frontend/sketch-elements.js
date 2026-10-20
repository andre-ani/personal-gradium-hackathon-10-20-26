import { drawWashiTape } from './washi-tape.js';
/**
 * The graph's hand-drawn layer.
 *
 * G6 still owns layout, hit testing and interaction. These elements only
 * replace the key shape with a deterministic Rough.js path, which keeps the
 * sketch stable while the camera or a node moves.
 */
import { Circle as GCircle, Path, Text as GText } from '@antv/g';
import { BaseEdge, BaseNode, ExtensionCategory, register } from '@antv/g6';
import { RoughGenerator } from 'roughjs/bin/generator.js';
import { graphEdgeRoute } from './graph-edge-routes.js';
import { paperTexturePattern } from './note-paper.js';

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

function irregularPaperPath(x, y, width, height, radius, seed, paperCurl = 0) {
  const r = Math.max(2, Math.min(radius || 10, Math.min(width, height) / 2));
  const topLeft = r + jitter(seed, 1, 2.4);
  const topRight = r + jitter(seed, 2, 2.2);
  const bottomRight = r + jitter(seed, 3, 2.4);
  const bottomLeft = r + jitter(seed, 4, 2.2);
  const curl = clamp(paperCurl);
  const curlSize = curl
    ? Math.min(24, Math.max(10, Math.min(width, height) * (0.08 + curl * 0.08)))
    : 0;
  const rightCorner = curlSize
    ? [
      `L${x + width + jitter(seed, 10, 1.2)} ${y + height - curlSize}`,
      `Q${x + width + jitter(seed, 11, 1.8)} ${y + height - curlSize * 0.16} ${x + width - curlSize * 0.45} ${y + height + jitter(seed, 12, 1.6)}`,
      `Q${x + width - curlSize * 0.7} ${y + height + jitter(seed, 13, 1.2)} ${x + width - curlSize} ${y + height + jitter(seed, 14, 1.2)}`,
    ]
    : [
      `L${x + width + jitter(seed, 10, 1.2)} ${y + height - bottomRight}`,
      `Q${x + width + jitter(seed, 11, 1.8)} ${y + height + jitter(seed, 12, 1.6)} ${x + width - bottomRight} ${y + height + jitter(seed, 13, 1.2)}`,
    ];
  return [
    `M${x + topLeft} ${y + jitter(seed, 5, 1.2)}`,
    `L${x + width - topRight} ${y + jitter(seed, 6, 1.2)}`,
    `Q${x + width + jitter(seed, 7, 1.8)} ${y + jitter(seed, 8, 1.6)} ${x + width + jitter(seed, 9, 1.2)} ${y + bottomRight}`,
    ...rightCorner,
    `L${x + bottomLeft} ${y + height + jitter(seed, 14, 1.2)}`,
    `Q${x + jitter(seed, 15, 1.8)} ${y + height + jitter(seed, 16, 1.6)} ${x + jitter(seed, 17, 1.2)} ${y + height - bottomLeft}`,
    `L${x + jitter(seed, 18, 1.2)} ${y + topLeft}`,
    `Q${x + jitter(seed, 19, 1.8)} ${y + jitter(seed, 20, 1.6)} ${x + topLeft} ${y + jitter(seed, 21, 1.2)}Z`,
  ].join(' ');
}

function nodePaperPath(variant, x, y, width, height, radius, seed, paperCurl = 0) {
  // Every node is a sheet of paper. The seed changes the silhouette itself,
  // so the edges stay imperfect after the visible outline is removed.
  return irregularPaperPath(
    x,
    y,
    width,
    height,
    radius,
    seed,
    variant === 'note' ? paperCurl : 0,
  );
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
  const size = Math.min(24, Math.max(10, Math.min(width, height) * (0.08 + curl * 0.08)));
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
    stroke: style.stroke || '#2455a6',
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
  return stroke && stroke !== 'transparent' && stroke !== 'none' ? stroke : '#2455a64d';
}

function progressStyle(style, progress, isEdge, pathLength = 1000) {
  const next = { ...style, lineDash: style.lineDash ?? [], lineDashOffset: 0 };
  const amount = progress == null ? 1 : clamp(progress);
  // G's dash reveal works on the rough path as well as the normal path. The
  // caller supplies a geometry-length estimate so progress traces the curve.
  if (isEdge && amount < 1) {
    next.lineDash = [Math.max(0, amount * pathLength), pathLength * 2];
    next.lineDashOffset = 0;
  }
  if (!isEdge && style.drawProgress != null && amount < 1) {
    next.lineDash = [Math.max(0, amount * pathLength), pathLength * 2];
    next.lineDashOffset = 0;
    next.fillOpacity = amount;
  }
  return next;
}

export class SketchNode extends BaseNode {
  getSketchPaths(attributes, style) {
    const [width, height] = this.getSize(attributes);
    const x = -width / 2;
    const y = -height / 2;
    const variant = nodeVariant(attributes);
    const radius = Number(style.radius ?? attributes.radius ?? 10);
    const seed = seedFor(attributes, this.id || 'node');
    const paperCurl = clamp(dataValue(attributes, 'paperCurl', style.paperCurl ?? 0.35));
    // The silhouette carries the hand-made character now. Rough.js is still
    // used for the paper fill, but its perimeter stroke is deliberately off.
    const roughStyle = { ...style, stroke: 'none', lineWidth: 0 };
    const key = [
      'node', variant, seed, width, height, radius, paperCurl, roughStyle.stroke, roughStyle.fill,
      roughStyle.lineWidth, roughStyle.roughness, roughStyle.bowing, roughStyle.fillStyle,
    ].join('|');
    return cachedPaths(key, () => generator.toPaths(
      generator.path(nodePaperPath(variant, x, y, width, height, radius, seed, paperCurl), roughOptions(roughStyle, seed, { fill: true })),
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
    const paperCurl = clamp(dataValue(attributes, 'paperCurl', style.paperCurl ?? 0.35));
    const paperPath = nodePaperPath(variant, x, y, width, height, radius, seed, paperCurl);
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

  drawKeyShape(attributes, container) {
    const style = super.getKeyStyle(attributes);
    const variant = nodeVariant(attributes);
    const [width, height] = this.getSize(attributes);
    const x = -width / 2;
    const y = -height / 2;
    const seed = seedFor(attributes, this.id || 'node');
    const padding = Number(dataValue(attributes, 'textPadding', style.textPadding ?? 20));
    const paperCurl = clamp(dataValue(attributes, 'paperCurl', style.paperCurl ?? 0.35));
    const liftProgress = clamp(dataValue(attributes, 'liftProgress', style.liftProgress ?? 0));
    const liftScale = 1 + 0.075 * liftProgress;
    const paths = this.getSketchPaths(attributes, style);
    const fills = paths.filter((item) => item.fill && item.fill !== 'none');
    const surfacePath = pathData(fills)
      || nodePaperPath(variant, x, y, width, height, Number(style.radius ?? attributes.radius ?? 10), seed, paperCurl);
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
      shadowBlur: (style.shadowBlur ?? 14) + 28 * liftProgress,
      shadowOffsetY: (style.shadowOffsetY ?? 4) + 12 * liftProgress,
    } : false, container);
    const key = this.upsert('key', Path, this.getKeyStyle(attributes), container);
    this.upsert('paper-texture', Path, {
      d: surfacePath,
      fill: paperTexturePattern(seed),
      fillOpacity: progress * (style.paperTextureOpacity ?? 0.78),
      stroke: 'none',
      pointerEvents: 'none',
      zIndex: 1,
    }, container);

    const inkBleed = inkBleedDefinition(attributes, style, variant, x, y, width, height, seed);
    this.upsert('ink-bleed', GCircle, inkBleed ? {
      cx: inkBleed.cx,
      cy: inkBleed.cy,
      r: inkBleed.radius,
      fill: style.inkBleedColor || '#2455a6',
      fillOpacity: style.inkBleedFillOpacity ?? 0.2,
      opacity: progress * (style.inkBleedOpacity ?? 0.65),
      shadowColor: style.inkBleedShadowColor || '#2455a670',
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

    const curl = variant === 'note' && dataValue(attributes, 'fold', true) !== false
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

    const headingText = String(dataValue(attributes, 'headingText', '') || '').trim();
    const bodyText = String(dataValue(attributes, 'bodyText', '') || '').trim();
    const headingSize = variant === 'anchor' ? 30 : 24;
    const headingFontSize = Number(style.headingFontSize ?? headingSize);
    const headingY = y + padding;
    const headingLineHeight = Number(style.headingLineHeight ?? headingFontSize + 2);
    const bodyLineHeight = Number(style.bodyLineHeight ?? 19);
    const maxHeadingLines = bodyText
      ? Math.max(1, Math.min(2, Math.floor((height - padding * 2 - bodyLineHeight - 6) / headingLineHeight)))
      : 2;
    const textColor = style.textColor || dataValue(attributes, 'labelFill') || '#173b6b';
    const icons = sketchIcons(attributes);
    const iconOffset = icons.length ? 34 : 0;
    const iconSize = Number(style.iconSize ?? 22);
    const iconTransform = [['translate', x + padding, y + padding], ['scale', iconSize / 24, iconSize / 24]];
    const previousIconCount = this._sketchIconCount || 0;
    for (let index = 0; index < Math.max(previousIconCount, icons.length); index += 1) {
      const icon = icons[index];
      this.upsert(`icon-${index}`, Path, icon ? {
        d: icon.d,
        fill: icon.fill === 'currentColor'
          ? (style.iconFill || textColor)
          : (icon.fill ?? (icon.stroke ? 'none' : (style.iconFill || textColor))),
        stroke: icon.stroke === 'currentColor' ? (style.iconFill || textColor) : (icon.stroke || 'none'),
        lineWidth: icon.lineWidth ?? 1.45,
        lineCap: 'round',
        lineJoin: 'round',
        transform: iconTransform,
        opacity: progress,
        pointerEvents: 'none',
        zIndex: 2,
      } : false, container);
    }
    this._sketchIconCount = icons.length;
    const headingShape = this.upsert('heading', GText, headingText ? {
      x: x + padding + iconOffset,
      y: headingY,
      text: headingText,
      fill: style.headingFill || textColor,
      fontFamily: style.headingFontFamily || 'Patrick Hand, Comic Sans MS, cursive',
      fontSize: headingFontSize,
      fontWeight: style.headingFontWeight ?? (variant === 'anchor' ? 500 : 400),
      textBaseline: 'top',
      textAlign: 'left',
      wordWrap: true,
      wordWrapWidth: Math.max(1, width - padding * 2 - iconOffset),
      maxLines: maxHeadingLines,
      textOverflow: 'ellipsis',
      lineHeight: headingLineHeight,
      opacity: progress,
      pointerEvents: 'none',
      zIndex: 2,
    } : false, container);

    // G's text metrics account for actual wrapping, so reserve the measured
    // heading height before placing the body. The fallback covers the first
    // frame on renderers that defer text metrics until the next tick.
    let bodyY = headingY + (headingText ? headingFontSize + 6 : 0);
    const headingBounds = headingShape?.getLocalBounds?.();
    const measuredHeadingBottom = headingBounds?.max?.[1];
    if (headingText && Number.isFinite(measuredHeadingBottom)) bodyY = Math.max(bodyY, measuredHeadingBottom + 6);
    const bodyLines = Math.max(1, Math.floor((y + height - padding - bodyY) / bodyLineHeight));
    this.upsert('body', GText, bodyText ? {
      x: x + padding,
      y: bodyY,
      text: bodyText,
      fill: style.bodyFill || textColor,
      fontFamily: style.bodyFontFamily || 'Patrick Hand, cursive',
      fontSize: style.bodyFontSize ?? 13,
      fontWeight: style.bodyFontWeight ?? 400,
      lineHeight: bodyLineHeight,
      textBaseline: 'top',
      textAlign: 'left',
      wordWrap: true,
      wordWrapWidth: Math.max(1, width - padding * 2),
      maxLines: bodyLines,
      textOverflow: 'ellipsis',
      opacity: progress,
      pointerEvents: 'none',
      zIndex: 2,
    } : false, container);
    // This is an absolute local scale, so repeated graph updates never
    // compound the lift. The element origin is the node center; x/y data and
    // the key shape remain the source of truth for layout and hit testing.
    drawWashiTape(this, attributes, container);
    this.setLocalScale(liftScale, liftScale, 1);
    return key;
  }
}

export class SketchEdge extends BaseEdge {
  getArrowStyle(attributes, isStart) {
    const style = super.getArrowStyle(attributes, isStart);
    const seed = seedFor(attributes, this.id || 'arrow');
    const width = Math.max(2, Number(attributes.lineWidth || style.lineWidth || 2.7) * .85);
    const head = cachedPaths(`arrow:${seed}:${width}`, () => generator.toPaths(generator.path(
      `M8 -${6 + seed % 3} Q2 -3 -7 0 Q1 2 ${7 + seed % 2} 7`,
      { ...roughOptions({ stroke: style.stroke, lineWidth: 2.2, roughness: 1.15, disableMultiStroke: true }, seed), maxRandomnessOffset: 1.4 },
    )));
    const progress = attributes.drawProgress == null ? 1 : clamp(attributes.drawProgress);
    return { ...style, d: pathData(head), width: attributes.edgeRole === 'primary' ? 18 : 14, height: attributes.edgeRole === 'primary' ? 17 : 13, fill: 'none', lineWidth: width, lineCap: 'round', lineJoin: 'round', opacity: clamp((progress - .72) / .28) };
  }

  getKeyPath(attributes) {
    const [source, target] = this.getEndpoints(attributes);
    const seed = seedFor(attributes, this.id || `${attributes.source}:${attributes.target}`);
    return graphEdgeRoute(this.context.graph, this.id, source, target, seed).path;
  }

  getKeyStyle(attributes) {
    const style = super.getKeyStyle(attributes);
    const rawStyle = this.getGraphicStyle(attributes);
    const [source, target] = this.getEndpoints(attributes);
    const seed = seedFor(attributes, this.id || `${attributes.source}:${attributes.target}`);
    const route = graphEdgeRoute(this.context.graph, this.id, source, target, seed);
    const lineWidth = Math.max(1.5, Number(rawStyle.lineWidth) || 2.7);
    const key = ['gestural-edge', seed, route.d, rawStyle.stroke, lineWidth].join('|');
    const paths = cachedPaths(key, () => generator.toPaths(generator.path(route.d, {
      ...roughOptions({ ...rawStyle, lineWidth, roughness: 0.65, bowing: .4, disableMultiStroke: true }, seed), maxRandomnessOffset: 0.9,
    })));
    return { ...progressStyle({ ...style, lineWidth, strokeOpacity: rawStyle.strokeOpacity ?? .85, lineCap: 'round', lineJoin: 'round', d: pathData(paths) }, rawStyle.drawProgress, true, route.length), fill: 'none' };
  }

  drawKeyShape(attributes, container) {
    return this.upsert('key', Path, this.getKeyStyle(attributes), container);
  }
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

