import { PRIMARY, paletteColour } from './palette.js';
import { estimateCardSize } from './card-text.js';
import { cardKind } from './card-hierarchy.js';

/** Seeded per-card size wobble (about ±5%), so no two sheets are cut alike. */
function sizeWobble(id, salt) {
  let hash = 2166136261;
  for (const char of `${id ?? ''}:${salt}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return 1 + (((hash >>> 0) % 1001) / 1000 - 0.5) * 0.1;
}

const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
/** Blend `amount` of `wash` into a card's base paper so the tint stays subtle. */
function tint(base, wash, amount = 0.6) {
  const a = channels(base), b = channels(wash);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('');
}

/**
 * Shared visual roles for the live graph and local story replays. Card size is
 * content-driven (see estimateCardSize): sparse cards sit between `minSize`
 * and `sparseMaxWidth`, close to square; rich cards grow up to `maxSize`.
 */
export const paperNodeVariants = {
  anchor: { minSize: [200, 150], sparseMaxWidth: 340, maxSize: [460, 320], radius: 3, fill: '#fcfcfc', stroke: '#1c4690b3', lineWidth: 0.8, shadowColor: '#28313a26', shadowBlur: 24, shadowOffsetY: 7, headingFontSize: 32, bodyFontSize: 14 },
  section: { minSize: [140, 110], sparseMaxWidth: 280, maxSize: [400, 280], radius: 3, fill: '#fbfbfb', stroke: '#1c4690a6', lineWidth: 0.9, shadowColor: '#28313a10', shadowBlur: 10, shadowOffsetY: 3, headingFontSize: 26, bodyFontSize: 13 },
  note: { minSize: [140, 110], sparseMaxWidth: 260, maxSize: [380, 270], radius: 2, fill: '#fdfdfd', stroke: '#1c469099', lineWidth: 0.65, shadowColor: '#28313a20', shadowBlur: 20, shadowOffsetY: 5, headingFontSize: 24, bodyFontSize: 13 },
  annotation: { minSize: [120, 90], sparseMaxWidth: 220, maxSize: [300, 200], radius: 4, fill: '#f6f6f6', stroke: '#1c46908c', lineWidth: 0.85, shadowColor: '#28313a0c', shadowBlur: 8, shadowOffsetY: 2, headingFontSize: 18, bodyFontSize: 12 },
  action: { minSize: [140, 110], sparseMaxWidth: 260, maxSize: [380, 270], radius: 2, fill: '#efefef', stroke: '#1c4690b3', lineWidth: 0.9, shadowColor: '#28313a25', shadowBlur: 22, shadowOffsetY: 6, headingFontSize: 27, bodyFontSize: 13 },
};

/**
 * Heading-like levels for the live map (see card-hierarchy.js). L1 is the
 * title sheet, L2 a section card (semi-bold, strongest tint of its branch
 * colour), L3 a clearly smaller item in a lighter tint of that colour and L4+
 * a small, pale detail. Sizes stay content-driven within each range.
 */
export const levelStyles = {
  1: { variant: 'anchor', headingFontSize: 44, headingFontWeight: 700, bodyFontSize: 16, textPadding: 26, minSize: [240, 116], sparseMaxWidth: 520, maxSize: [580, 340], sparseAspect: 2.3, tintAmount: .95, shadowColor: '#28313a2e', shadowBlur: 28, shadowOffsetY: 8 },
  2: { variant: 'section', headingFontSize: 32, headingFontWeight: 600, bodyFontSize: 14, textPadding: 22, minSize: [200, 100], sparseMaxWidth: 400, maxSize: [460, 280], sparseAspect: 2, tintAmount: .92, shadowColor: '#28313a1c', shadowBlur: 14, shadowOffsetY: 4 },
  3: { variant: 'note', headingFontSize: 19, headingFontWeight: 400, bodyFontSize: 12, textPadding: 14, minSize: [124, 60], sparseMaxWidth: 240, maxSize: [300, 200], sparseAspect: 1.7, tintAmount: .5, shadowColor: '#28313a1a', shadowBlur: 12, shadowOffsetY: 3 },
  4: { variant: 'annotation', headingFontSize: 15, headingFontWeight: 400, bodyFontSize: 11, textPadding: 11, minSize: [92, 44], sparseMaxWidth: 180, maxSize: [230, 150], sparseAspect: 1.6, tintAmount: .28, shadowColor: '#28313a10', shadowBlur: 6, shadowOffsetY: 2 },
};

/**
 * Kind treatments, subtle and hand-made: questions get a rounder sheet and a
 * faint "?", decisions a cut corner, ideas a sticky-note curl and stronger
 * wash, tasks a step number (in a series) or an empty checkbox.
 */
export const kindStyles = {
  topic: {},
  question: { radius: 22, cornerMark: '?' },
  decision: { cutCorner: true },
  idea: { paperCurl: .6, tintBoost: .14, tilt: 3 },
  task: { marker: 'checkbox' },
};

/** Card style for a level and kind family (pure table lookup). */
export function levelKindStyle(level, kind, series) {
  const base = levelStyles[Math.max(1, Math.min(4, Math.round(Number(level) || 3)))];
  const family = kindStyles[kind] ? kind : 'topic';
  const treat = { ...kindStyles[family] };
  // An ordered series numbers its steps; the number replaces the checkbox.
  if (series && series.size > 1) treat.marker = 'number';
  const variant = base.variant === 'note' || base.variant === 'annotation'
    ? (family === 'task' ? 'action' : family === 'idea' ? 'note' : base.variant)
    : base.variant;
  return { ...base, ...treat, variant, kindFamily: family };
}

function levelNodeStyle(node) {
  const kind = cardKind(node.kind);
  const look = levelKindStyle(node.level, kind, node.series);
  const level = Math.max(1, Math.round(Number(node.level) || 3));
  const pending = ['placeholder', 'pending'].includes(node.status);
  const main = node.kind === 'root' || node.topicRole === 'main';
  const colour = node.palette && !pending ? paletteColour(node.palette) : null;
  const ink = colour ? (main && colour === paletteColour(PRIMARY) ? '#0e316c' : colour.ink) : '#173b6b';
  const headingText = node.heading || node.title || node.label || 'Taking shape…';
  const bodyText = node.body || node.description || node.detail || '';
  const headingFont = { size: look.headingFontSize, family: 'Patrick Hand, sans-serif', weight: look.headingFontWeight };
  const size = estimateCardSize({
    minSize: look.minSize, maxSize: look.maxSize, sparseMaxWidth: look.sparseMaxWidth, sparseAspect: look.sparseAspect,
    padding: look.textPadding,
    wobble: [sizeWobble(node.id, 'w'), sizeWobble(node.id, 'h')],
    heading: headingText, body: bodyText, hasIcon: false, headingFont,
    bodyFont: { size: look.bodyFontSize, family: 'Patrick Hand, cursive', weight: 400 },
  });
  const paperBase = level >= 4 ? '#fefefe' : '#fcfcfc';
  const wash = colour?.wash || paletteColour(PRIMARY).wash;
  return {
    radius: look.radius ?? (level === 1 ? 4 : 3),
    fill: tint(paperBase, wash, Math.min(1, look.tintAmount + (look.tintBoost || 0)) * (colour ? 1 : .5)),
    shadowColor: look.shadowColor, shadowBlur: look.shadowBlur, shadowOffsetY: look.shadowOffsetY,
    headingFill: pending ? '#6f8eb8' : ink, bodyFill: ink, iconFill: ink,
    size, maxSize: look.maxSize,
    headingFontSize: look.headingFontSize, headingFontWeight: look.headingFontWeight, bodyFontSize: look.bodyFontSize,
    textPadding: look.textPadding,
    nodeVariant: look.variant,
    cardLevel: level, cardKind: look.kindFamily,
    cardOutline: look.outline || 0, cardStrip: Boolean(look.strip),
    cardCornerMark: look.cornerMark || '', cardCutCorner: Boolean(look.cutCorner),
    cardMarker: look.marker || '', cardStep: look.marker === 'number' ? node.series.index + 1 : 0,
    cardDone: ['done', 'complete', 'completed'].includes(String(node.status || '').toLowerCase()),
    cardTilt: look.tilt || 1.5,
    cardInk: ink,
    sketchIconPaths: [], iconSize: 0,
    headingText, bodyText,
    illustration: !pending && node.illustration?.concept === String(node.label || '').trim().replace(/\s+/g, ' ').slice(0, 160) ? node.illustration : null,
    illustrationSpace: 0,
    headingFontFamily: 'Patrick Hand, sans-serif', bodyFontFamily: 'Patrick Hand, cursive',
    labelText: '', roughness: 0.85,
    stroke: 'transparent', strokeOpacity: 0, lineWidth: 0,
    paperCurl: look.paperCurl ?? 0,
    lineDash: pending ? [5, 4] : [],
  };
}

export function paperNodeStyle(node) {
  // Live maps pass a level (from the parent chain); replays keep their variants.
  if (Number.isFinite(Number(node.level)) && node.level != null && !node.nodeVariant && !node.presentation?.variant) return levelNodeStyle(node);
  const body = node.body || node.description || node.detail || '';
  const explicit = node.nodeVariant || node.presentation?.variant;
  const inferred = node.kind === 'root' ? 'anchor'
    : ['action', 'task', 'step'].includes(node.kind) ? 'action'
      : body ? 'note'
        : !node.parent_id ? 'section' : 'annotation';
  const nodeVariant = Object.hasOwn(paperNodeVariants, explicit) ? explicit : inferred;
  const pending = ['placeholder', 'pending'].includes(node.status);
  const main = node.kind === 'root' || node.topicRole === 'main';
  const base = paperNodeVariants[nodeVariant];
  // Topic-group colour coding; pending cards and uncoloured replays keep their look.
  const colour = node.palette && !pending ? paletteColour(node.palette) : null;
  // Main blue headings keep their deeper primary ink.
  const ink = colour && (main && colour === paletteColour(PRIMARY) ? '#0e316c' : colour.ink);
  const headingText = node.heading || node.title || node.label || 'Taking shape…';
  const bodyText = nodeVariant === 'annotation' ? '' : body;
  const bump = main && nodeVariant !== 'anchor';
  const grow = ([w, h]) => (bump ? [w + 20, h + 16] : [w, h]);
  const headingFontSize = base.headingFontSize + (bump ? 3 : 0);
  // Content-driven proportions; every card gets a seeded ±5% wobble.
  const size = estimateCardSize({
    minSize: grow(base.minSize),
    maxSize: grow(base.maxSize),
    sparseMaxWidth: base.sparseMaxWidth + (bump ? 20 : 0),
    wobble: [sizeWobble(node.id, 'w'), sizeWobble(node.id, 'h')],
    heading: headingText,
    body: bodyText,
    hasIcon: false,
    headingFont: { size: headingFontSize, family: 'Patrick Hand, sans-serif', weight: nodeVariant === 'anchor' ? 500 : 400 },
    bodyFont: { size: base.bodyFontSize, family: 'Patrick Hand, cursive', weight: 400 },
  });
  const { minSize, maxSize, sparseMaxWidth, ...paper } = base;
  return {
    ...paper,
    // Explicit resets: G6 merges styles, so a dropped ink (pending → named)
    // would otherwise keep the muted colour.
    headingFill: undefined,
    bodyFill: undefined,
    iconFill: undefined,
    cardOutline: 0, cardStrip: false, cardCornerMark: '', cardCutCorner: false, cardMarker: '', cardStep: 0, cardTilt: 1.5,
    ...(main ? {
      headingFill: '#0e316c',
      stroke: '#123f85c7',
      lineWidth: 1.35,
    } : {}),
    size,
    headingFontSize,
    nodeVariant,
    sketchIconPaths: [],
    iconSize: 0,
    headingText,
    bodyText,
    illustration: !pending && node.illustration?.concept === String(node.label || '').trim().replace(/\s+/g, ' ').slice(0, 160) ? node.illustration : null,
    illustrationSpace: 0,
    headingFontFamily: 'Patrick Hand, sans-serif',
    bodyFontFamily: 'Patrick Hand, cursive',
    labelText: '',
    roughness: 0.85,
    stroke: 'transparent',
    strokeOpacity: 0,
    lineWidth: 0,
    paperCurl: 0.35,
    lineDash: pending ? [5, 4] : [],
    ...(colour ? { fill: tint(base.fill, colour.wash, .85), headingFill: ink, bodyFill: ink, iconFill: ink } : {}),
    ...(pending ? { headingFill: '#6f8eb8' } : {}),
  };
}
