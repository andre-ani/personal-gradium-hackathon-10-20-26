import { sketchIconPaths } from './sketch-icons.js';

/** Shared visual roles for the live graph and local story replays. */
export const paperNodeVariants = {
  anchor: { size: [340, 190], radius: 3, fill: '#f3f3ef', stroke: '#2455a6b3', lineWidth: 0.8, shadowColor: '#28313a26', shadowBlur: 24, shadowOffsetY: 7, headingFontSize: 32, bodyFontSize: 14 },
  section: { size: [280, 134], radius: 3, fill: '#f0f0ec', stroke: '#2455a6a6', lineWidth: 0.9, shadowColor: '#28313a10', shadowBlur: 10, shadowOffsetY: 3, headingFontSize: 26, bodyFontSize: 13 },
  note: { size: [250, 148], radius: 2, fill: '#f6f6f3', stroke: '#2455a699', lineWidth: 0.65, shadowColor: '#28313a20', shadowBlur: 20, shadowOffsetY: 5, headingFontSize: 24, bodyFontSize: 13 },
  annotation: { size: [220, 110], radius: 4, fill: '#e8e9e5', stroke: '#2455a68c', lineWidth: 0.85, shadowColor: '#28313a0c', shadowBlur: 8, shadowOffsetY: 2, headingFontSize: 18, bodyFontSize: 12 },
  action: { size: [260, 130], radius: 2, fill: '#dedfdb', stroke: '#2455a6b3', lineWidth: 0.9, shadowColor: '#28313a25', shadowBlur: 22, shadowOffsetY: 6, headingFontSize: 27, bodyFontSize: 13 },
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
  return {
    ...paperNodeVariants[nodeVariant],
    nodeVariant,
    sketchIconPaths: node.icon ? sketchIconPaths(node.icon) : [],
    iconSize: 24,
    headingText: node.heading || node.title || node.label || 'Taking shape…',
    bodyText: nodeVariant === 'annotation' ? '' : body,
    headingFontFamily: 'Patrick Hand, sans-serif',
    bodyFontFamily: 'Figtree, sans-serif',
    labelText: '',
    roughness: 0.85,
    strokeOpacity: 0.9,
    lineDash: pending ? [5, 4] : [],
    ...(pending ? { headingFill: '#6f8eb8' } : {}),
  };
}
