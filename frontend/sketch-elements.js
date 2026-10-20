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

function irregularPaperPath(x, y, width, height, radius, seed) {
  const r = Math.max(2, Math.min(radius || 10, Math.min(width, height) / 2));
  const topLeft = r + jitter(seed, 1, 2.4);
  const topRight = r + jitter(seed, 2, 2.2);
  const bottomRight = r + jitter(seed, 3, 2.4);
  const bottomLeft = r + jitter(seed, 4, 2.2);
  return [
    `M${x + topLeft} ${y + jitter(seed, 5, 1.2)}`,
    `L${x + width - topRight} ${y + jitter(seed, 6, 1.2)}`,
    `Q${x + width + jitter(seed, 7, 1.8)} ${y + jitter(seed, 8, 1.6)} ${x + width + jitter(seed, 9, 1.2)} ${y + bottomRight}`,
    `L${x + width + jitter(seed, 10, 1.2)} ${y + height - bottomRight}`,
    `Q${x + width + jitter(seed, 11, 1.8)} ${y + height + jitter(seed, 12, 1.6)} ${x + width - bottomRight} ${y + height + jitter(seed, 13, 1.2)}`,
    `L${x + bottomLeft} ${y + height + jitter(seed, 14, 1.2)}`,
    `Q${x + jitter(seed, 15, 1.8)} ${y + height + jitter(seed, 16, 1.6)} ${x + jitter(seed, 17, 1.2)} ${y + height - bottomLeft}`,
    `L${x + jitter(seed, 18, 1.2)} ${y + topLeft}`,
    `Q${x + jitter(seed, 19, 1.8)} ${y + jitter(seed, 20, 1.6)} ${x + topLeft} ${y + jitter(seed, 21, 1.2)}Z`,
  ].join(' ');
}

function nodePaperPath(variant, x, y, width, height, radius, seed) {
  if (variant === 'anchor' || variant === 'note') return irregularPaperPath(x, y, width, height, radius, seed);
  return roundedRectPath(x, y, width, height, variant === 'action' ? radius : 0);
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

function noteFoldDefinition(x, y, width, height, seed) {
  const fold = Math.min(14, Math.max(9, Math.min(width, height) * 0.18));
  const fx = x + width - fold;
  const fy = y + jitter(seed, 35, 1.2);
  return `M${fx} ${fy} L${x + width + jitter(seed, 36, 1)} ${y + fold + jitter(seed, 37, 1)} L${fx} ${y + fold}`;
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
    const roughStyle = { ...style, stroke: effectiveNodeStroke(style) };
    const key = [
      'node', variant, seed, width, height, radius, roughStyle.stroke, roughStyle.fill,
      roughStyle.lineWidth, roughStyle.roughness, roughStyle.bowing, roughStyle.fillStyle,
    ].join('|');
    return cachedPaths(key, () => generator.toPaths(
      generator.path(nodePaperPath(variant, x, y, width, height, radius, seed), roughOptions(roughStyle, seed, { fill: true })),
    ));
  }

  getKeyStyle(attributes) {
    const style = super.getKeyStyle(attributes);
    const [width, height] = this.getSize(attributes);
    const x = -width / 2;
    const y = -height / 2;
    const paths = this.getSketchPaths(attributes, style);
    const outline = paths.filter((item) => item.stroke && item.stroke !== 'none');
    const perimeter = Math.max(width * 2 + height * 2, 1);
    const progress = dataValue(attributes, 'drawProgress', style.drawProgress);
    const stroke = effectiveNodeStroke(style);
    return progressStyle({
      ...style,
      drawProgress: progress,
      x,
      y,
      width,
      height,
      d: pathData(outline),
      fill: 'none',
      stroke,
      strokeOpacity: style.strokeOpacity ?? 0.42,
      lineWidth: style.lineWidth ?? 1.2,
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
    const liftProgress = clamp(dataValue(attributes, 'liftProgress', style.liftProgress ?? 0));
    const liftScale = 1 + 0.045 * liftProgress;
    const paths = this.getSketchPaths(attributes, style);
    const fills = paths.filter((item) => item.fill && item.fill !== 'none');
    const progress = dataValue(attributes, 'drawProgress', style.drawProgress) == null
      ? 1
      : clamp(dataValue(attributes, 'drawProgress', style.drawProgress));
    this.upsert('fill', Path, fills.length ? {
      d: pathData(fills),
      fill: style.fill || '#faf8f1',
      fillOpacity: progress,
      stroke: 'none',
      pointerEvents: 'auto',
      shadowColor: style.shadowColor || '#173b6b14',
      shadowBlur: (style.shadowBlur ?? 14) + 22 * liftProgress,
      shadowOffsetY: (style.shadowOffsetY ?? 4) + 9 * liftProgress,
    } : false, container);
    const key = this.upsert('key', Path, this.getKeyStyle(attributes), container);

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

    if (variant === 'note' && dataValue(attributes, 'fold', true) !== false) {
      const fold = generator.toPaths(generator.path(
        noteFoldDefinition(x, y, width, height, seed),
        roughOptions({
          ...style,
          stroke: style.accent || style.stroke || '#2455a6',
          lineWidth: style.foldLineWidth ?? 1,
          disableMultiStroke: true,
        }, seed + 102),
      ));
      this.upsert('fold', Path, {
        d: pathData(fold),
        fill: 'none',
        stroke: style.accent || style.stroke || '#2455a6',
        lineWidth: style.foldLineWidth ?? 1,
        opacity: progress * 0.5,
        pointerEvents: 'none',
      }, container);
    } else this.upsert('fold', Path, false, container);

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
      fontFamily: style.bodyFontFamily || 'Figtree, -apple-system, BlinkMacSystemFont, sans-serif',
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
    this.setLocalScale(liftScale, liftScale, 1);
    return key;
  }
}

export class SketchEdge extends BaseEdge {
  getArrowStyle(attributes, isStart) {
    const style = super.getArrowStyle(attributes, isStart);
    const progress = attributes.drawProgress == null ? 1 : clamp(attributes.drawProgress);
    return { ...style, opacity: progress < 1 ? 0 : (style.opacity ?? 1) };
  }

  getKeyPath(attributes) {
    const [source, target] = this.getEndpoints(attributes);
    const [sx, sy] = source;
    const [tx, ty] = target;
    const bend = Math.max(24, Math.abs(tx - sx) * 0.42) * (tx >= sx ? 1 : -1);
    return [['M', sx, sy], ['C', sx + bend, sy, tx - bend, ty, tx, ty]];
  }

  getKeyStyle(attributes) {
    const style = super.getKeyStyle(attributes);
    // BaseEdge filters custom keys through Path.PARSED_STYLE_LIST. Keep a
    // second view of the original attributes for Rough.js options and the
    // transient entrance progress value.
    const rawStyle = this.getGraphicStyle(attributes);
    const [source, target] = this.getEndpoints(attributes);
    const [sx, sy] = source;
    const [tx, ty] = target;
    const bend = Math.max(24, Math.abs(tx - sx) * 0.42) * (tx >= sx ? 1 : -1);
    const d = `M${sx} ${sy} C${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
    const seed = seedFor(attributes, this.id || `${attributes.source || ''}:${attributes.target || ''}`);
    const key = ['edge', seed, sx, sy, tx, ty, rawStyle.stroke, rawStyle.lineWidth, rawStyle.roughness, rawStyle.bowing].join('|');
    const paths = cachedPaths(key, () => generator.toPaths(
      // A single rough stroke keeps the reveal moving source → target. The
      // default double pass can contain a reversed second pass, which makes
      // a dash reveal appear to grow from both ends.
      generator.path(d, roughOptions({ ...rawStyle, disableMultiStroke: true }, seed)),
    ));
    const pathLength = cubicLength(
      [sx, sy],
      [sx + bend, sy],
      [tx - bend, ty],
      [tx, ty],
    );
    const next = progressStyle({ ...style, d: pathData(paths) }, rawStyle.drawProgress, true, pathLength);
    return { ...next, d: pathData(paths), fill: 'none' };
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

