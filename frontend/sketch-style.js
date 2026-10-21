import { sketchIconPaths } from './sketch-icons.js';
import { PRIMARY, paletteColour } from './palette.js';
import { estimateCardSize } from './card-text.js';

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

export function paperNodeStyle(node) {
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
    hasIcon: Boolean(node.icon),
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
    ...(main ? {
      headingFill: '#0e316c',
      stroke: '#123f85c7',
      lineWidth: 1.35,
    } : {}),
    size,
    headingFontSize,
    nodeVariant,
    sketchIconPaths: node.icon ? sketchIconPaths(node.icon) : [],
    iconSize: 24,
    headingText,
    bodyText,
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
