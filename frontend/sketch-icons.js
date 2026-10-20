/**
 * Small, hand-authored marks for the paper / blue-ink canvas.
 *
 * The source geometry stays inside a 24 × 24 viewBox. Rough.js only adds a
 * restrained, seeded wobble at the final path boundary; it never chooses the
 * shape. That keeps the icons legible while making a redraw feel drawn rather
 * than stamped.
 */
import { RoughGenerator } from 'roughjs/bin/generator.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_SIZE = 24;
const DEFAULT_STROKE_WIDTH = 1.45;
const MAX_CACHE_ENTRIES = 96;
const EMPTY_PATHS = Object.freeze([]);

const roughGenerator = new RoughGenerator();
const pathCache = new Map();
let titleId = 0;

const iconDefinition = (label, shapes) => Object.freeze({
  label,
  shapes: Object.freeze(shapes.map((d) => Object.freeze({ d }))),
});

// Deliberate, quiet asymmetry makes the set feel like one pencil hand. The
// geometry itself is clean; Rough.js supplies only the last few percent.
const ICON_DEFINITIONS = Object.freeze({
  mug: iconDefinition('Mug', [
    'M6.2 6.2H14.7V12.9C14.7 15.6 13 17.4 10.5 17.4C8 17.4 6.2 15.6 6.2 12.9V6.2Z',
    'M14.7 8.7H16.7C18.2 8.7 19.1 9.6 19.1 10.9C19.1 12.3 18.1 13.3 16.7 13.3H14.7',
    'M8.3 19.3H13.1',
    'M8.3 3.9C7.9 4.6 8 5.1 8.5 5.7',
    'M11.2 3.2C10.7 4 10.9 4.7 11.4 5.3',
  ]),

  kettle: iconDefinition('Kettle', [
    'M5.2 10.9C5.2 7.8 8 6 12 6C16.1 6 18.8 7.9 18.8 11.1C18.8 15.1 16 17.8 12 17.8C8 17.8 5.2 15 5.2 10.9Z',
    'M9 5.7C9.2 4.4 10.3 3.8 12 3.8C13.7 3.8 14.8 4.4 15 5.7',
    'M5.4 10C4 9.4 3.1 9.1 2.7 9.7C3.6 10.9 4.3 11.7 5.4 12',
    'M15.3 7.3C18.2 4.7 21 6.6 21 9.4C21 11.4 20.1 12.5 18.7 13.2',
    'M8.4 19.2H15.8',
  ]),

  tea: iconDefinition('Tea', [
    'M7.1 6.7H15.3V13.1C15.3 15.8 13.7 17.2 11.2 17.2C8.7 17.2 7.1 15.8 7.1 13.1V6.7Z',
    'M15.3 9.1H17.1C18.5 9.1 19.4 10 19.4 11.3C19.4 12.5 18.5 13.4 17.1 13.4H15.3',
    'M9.2 4.2V6.7',
    'M8.2 3.1H10.2L10 4.8H8.4L8.2 3.1Z',
    'M8.4 19.1H14',
  ]),

  spoon: iconDefinition('Spoon', [
    'M11.9 8.1C10.4 8.1 9.3 7 9.3 5.5C9.3 3.9 10.4 2.8 11.9 2.8C13.5 2.8 14.6 3.9 14.6 5.5C14.6 7 13.5 8.1 11.9 8.1Z',
    'M11.9 8.1V20',
    'M10.8 19.8H13',
  ]),

  milk: iconDefinition('Milk', [
    'M7.2 5.2L9.1 3.4H14.7L16.8 5.2V20H7.2V5.2Z',
    'M9.1 3.4L10 6.2H16.8',
    'M7.3 9.2H16.8',
    'M10 12.4H13.9',
    'M10 14.7H13.1',
  ]),

  utensils: iconDefinition('Kitchen utensils', [
    'M6.1 3.1V8.7',
    'M8.2 3.1V8.7',
    'M10.3 3.1V8.7',
    'M8.2 8.7V20.2',
    'M15.3 3.1C13.7 5.1 13.2 7.8 13.5 10.1C13.8 11.7 14.7 12.4 16 12.4H16.7V20.2',
    'M16 3.1V12.4',
  ]),

  repeat: iconDefinition('Repeat', [
    'M5.1 8.1C6.4 5.6 8.6 4.3 11.3 4.3C14.5 4.3 16.7 5.8 18.1 8.1',
    'M16.3 6L18.4 8.5L20.6 6.1',
    'M18.9 15.8C17.6 18.4 15.4 19.7 12.7 19.7C9.5 19.7 7.3 18.2 5.9 15.9',
    'M7.7 17.9L5.6 15.5L3.4 17.9',
  ]),

  activity: iconDefinition('Group by activity', [
    'M12 6.2V11.8',
    'M6.3 17.9L10.1 13.8',
    'M17.7 17.9L13.9 13.8',
    'M12 3.1C13.7 3.1 15 4.3 15 5.8C15 7.4 13.7 8.5 12 8.5C10.3 8.5 9 7.4 9 5.8C9 4.3 10.3 3.1 12 3.1Z',
    'M4.4 17.2C4.4 15.4 5.8 14.2 7.3 14.2C8.9 14.2 10.2 15.4 10.2 17.2V19.7H4.4V17.2Z',
    'M13.8 17.2C13.8 15.4 15.1 14.2 16.7 14.2C18.2 14.2 19.6 15.4 19.6 17.2V19.7H13.8V17.2Z',
  ]),

  'chopping-board': iconDefinition('Chopping board', [
    'M5.2 5.4C5.2 4.3 6 3.6 7.1 3.6H16.8C18 3.6 18.8 4.3 18.8 5.4V18.1C18.8 19.3 18 20 16.8 20H7.1C6 20 5.2 19.3 5.2 18.1V5.4Z',
    'M8.1 7.2H15.9',
    'M8.1 9.7H14.6',
    'M8.1 16.9H16.1',
    'M9.9 3.7C9.7 2.9 10.4 2.3 12 2.3C13.6 2.3 14.3 2.9 14.1 3.7',
  ]),

  knife: iconDefinition('Knife', [
    'M4 4.1C7.9 4.1 11 6.1 12.8 9.4L15 13.4H4V4.1Z',
    'M15 13.4L20 18.4C20.7 19.1 20.7 19.8 20.2 20.2C19.7 20.7 19 20.7 18.4 20L13.5 15.1',
    'M6.2 13.4V18.9C6.2 19.7 6.8 20.2 7.5 20.2H10.5',
  ]),

  safety: iconDefinition('Safety', [
    'M12 3.1L19 5.7V10.5C19 15 16.3 18.3 12 20.3C7.7 18.3 5 15 5 10.5V5.7L12 3.1Z',
    'M8.5 11.8L10.8 14.1L15.8 8.9',
  ]),

  breakfast: iconDefinition('Breakfast', [
    'M3.8 14.8C4.9 17.2 7.8 18.6 12 18.6C16.2 18.6 19.1 17.2 20.2 14.8',
    'M4.2 14.6C4.2 11.9 7.7 10.1 12 10.1C16.3 10.1 19.8 11.9 19.8 14.6',
    'M10.7 7.6C10.7 6 12.1 5.2 13.4 5.8C14.5 6.3 14.8 7.7 14 8.5C13.3 9.2 12.3 9.1 11.5 8.6',
    'M3.3 20.1H20.7',
  ]),

  dishwasher: iconDefinition('Dishwasher', [
    'M4.2 3.5H19.8V20.3H4.2V3.5Z',
    'M4.4 7.2H19.6',
    'M7.2 5.3H7.3',
    'M9.3 5.3H9.4',
    'M6.3 11.2C7.9 10.4 9.2 10.4 10.7 11.2C12.2 12 13.5 12 15 11.2C16.2 10.6 17.1 10.7 17.9 11.2',
    'M6.3 14.5C7.9 13.7 9.2 13.7 10.7 14.5C12.2 15.3 13.5 15.3 15 14.5C16.2 13.9 17.1 14 17.9 14.5',
    'M6.3 17.7C7.9 16.9 9.2 16.9 10.7 17.7C12.2 18.5 13.5 18.5 15 17.7C16.2 17.1 17.1 17.2 17.9 17.7',
  ]),

  move: iconDefinition('Move', [
    'M12 3.1V20.9',
    'M8.9 6.2L12 3.1L15.1 6.2',
    'M8.9 17.8L12 20.9L15.1 17.8',
    'M3.1 12H20.9',
    'M6.2 8.9L3.1 12L6.2 15.1',
    'M17.8 8.9L20.9 12L17.8 15.1',
  ]),

  calendar: iconDefinition('Calendar', [
    'M5.1 5.2H18.9C19.6 5.2 20.2 5.8 20.2 6.5V18.4C20.2 19.1 19.6 19.7 18.9 19.7H5.1C4.4 19.7 3.8 19.1 3.8 18.4V6.5C3.8 5.8 4.4 5.2 5.1 5.2Z',
    'M3.9 9.3H20.1',
    'M8 3.1V7.1',
    'M16 3.1V7.1',
    'M7.4 12.2H7.5',
    'M11.9 12.2H12',
    'M16.4 12.2H16.5',
    'M7.4 15.5H7.5',
    'M11.9 15.5H12',
    'M16.4 15.5H16.5',
  ]),

  mic: iconDefinition('Microphone', [
    'M12 3.1C10.2 3.1 8.9 4.4 8.9 6.2V11C8.9 12.8 10.2 14.1 12 14.1C13.8 14.1 15.1 12.8 15.1 11V6.2C15.1 4.4 13.8 3.1 12 3.1Z',
    'M6.5 10.1V11C6.5 14.1 8.8 16.4 12 16.4C15.2 16.4 17.5 14.1 17.5 11V10.1',
    'M12 16.4V20.4',
    'M8.7 20.4H15.3',
  ]),

  stop: iconDefinition('Stop', [
    'M12 3.4C16.8 3.4 20.6 7.2 20.6 12C20.6 16.8 16.8 20.6 12 20.6C7.2 20.6 3.4 16.8 3.4 12C3.4 7.2 7.2 3.4 12 3.4Z',
    'M8.6 8.6H15.4V15.4H8.6V8.6Z',
  ]),

  play: iconDefinition('Play', [
    'M9.1 5.7L18 12L9.1 18.3V5.7Z',
  ]),

  pause: iconDefinition('Pause', [
    'M8.1 5.1V18.9',
    'M15.9 5.1V18.9',
  ]),

  fit: iconDefinition('Fit canvas', [
    'M8.5 4H5.1C4.5 4 4 4.5 4 5.1V8.5',
    'M15.5 4H18.9C19.5 4 20 4.5 20 5.1V8.5',
    'M8.5 20H5.1C4.5 20 4 19.5 4 18.9V15.5',
    'M15.5 20H18.9C19.5 20 20 19.5 20 18.9V15.5',
    'M9.2 9.2H14.8V14.8H9.2V9.2Z',
  ]),

  chat: iconDefinition('Chat', [
    'M4.1 5.2C4.1 4.4 4.7 3.8 5.5 3.8H18.5C19.3 3.8 19.9 4.4 19.9 5.2V14.4C19.9 15.2 19.3 15.8 18.5 15.8H10.2L6.1 19.3V15.8H5.5C4.7 15.8 4.1 15.2 4.1 14.4V5.2Z',
    'M7.8 8.1H16.2',
    'M7.8 11.5H13.8',
  ]),

  close: iconDefinition('Close', [
    'M5.2 5.2L18.8 18.8',
    'M18.8 5.2L5.2 18.8',
  ]),

  replay: iconDefinition('Replay', [
    'M6 8.1C7.5 5.5 9.6 4.2 12.3 4.2C16.6 4.2 19.6 7.2 19.6 11.8C19.6 16.4 16.6 19.5 12.2 19.5C8.9 19.5 6.2 17.8 5.1 14.9',
    'M6.1 4.9V8.8H10',
  ]),

  reset: iconDefinition('Reset', [
    'M7.1 7C8.4 5.2 10.1 4.3 12.5 4.3C16.6 4.3 19.5 7.5 19.5 12C19.5 16.4 16.6 19.6 12.4 19.6C8.6 19.6 5.8 17.2 5.2 13.7',
    'M4.4 6.9H8.1V3.4',
    'M12.2 8.1V12.3L15 14',
  ]),
});

const ICON_ALIASES = Object.freeze({
  kitchen: 'utensils',
  'kitchen/utensils': 'utensils',
  'kitchen-utensils': 'utensils',
  group: 'activity',
  'group/activity': 'activity',
  'group-activity': 'activity',
  'chopping_board': 'chopping-board',
  'chopping board': 'chopping-board',
  'dish-washer': 'dishwasher',
  'fit-view': 'fit',
  'record-stop': 'stop',
});

export const SKETCH_ICON_NAMES = Object.freeze(Object.keys(ICON_DEFINITIONS));

function canonicalName(name) {
  const normalized = String(name ?? '').trim().toLowerCase();
  return ICON_ALIASES[normalized] || normalized;
}

function normalizedSize(size) {
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_SIZE;
  return Math.round(value * 100) / 100;
}

function stableSeed(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

function roughOptions(seed, shape) {
  return {
    seed,
    roughness: 0.38,
    bowing: 0.24,
    maxRandomnessOffset: 0.7,
    curveStepCount: 8,
    stroke: shape.stroke || 'currentColor',
    strokeWidth: DEFAULT_STROKE_WIDTH,
    fill: shape.fill || 'none',
    fillStyle: 'solid',
    disableMultiStroke: true,
    disableMultiStrokeFill: true,
    preserveVertices: true,
  };
}

function generatePaths(canonical, size) {
  const definition = ICON_DEFINITIONS[canonical];
  if (!definition) return EMPTY_PATHS;

  const baseSeed = stableSeed(`sketch-icon:${canonical}`);
  const paths = definition.shapes.flatMap((shape, index) => {
    const rough = roughGenerator.path(
      shape.d,
      roughOptions(baseSeed + index * 977, shape),
    );
    return roughGenerator.toPaths(rough).map(({ d, fill = 'none', stroke = 'currentColor' }) => ({
      d,
      fill,
      stroke,
    }));
  });

  // Size participates in the cache key so callers can request an independent
  // redraw budget without sharing mutable arrays. Geometry remains native 24px
  // so G6 can place it directly and SVG can scale it through its viewBox.
  void size;
  return Object.freeze(paths.map((path) => Object.freeze(path)));
}

function pathsFor(name, size) {
  const canonical = canonicalName(name);
  if (!ICON_DEFINITIONS[canonical]) return EMPTY_PATHS;
  const key = `${canonical}|${normalizedSize(size)}`;
  const cached = pathCache.get(key);
  if (cached) return cached;
  const paths = generatePaths(canonical, normalizedSize(size));
  pathCache.set(key, paths);
  if (pathCache.size > MAX_CACHE_ENTRIES) {
    pathCache.delete(pathCache.keys().next().value);
  }
  return paths;
}

/**
 * Return deterministic, native 24 × 24 SVG path records for a named icon.
 * `size` is accepted for cache separation and future optical variants.
 */
export function sketchIconPaths(name, options = {}) {
  const size = typeof options === 'number' ? options : options?.size;
  return pathsFor(name, size ?? DEFAULT_SIZE);
}

function optionSize(size) {
  if (typeof size === 'string' && size.trim()) return size.trim();
  return String(normalizedSize(size));
}

/**
 * Create an accessible standalone SVG icon. Consumers theme the line through
 * `currentColor`; no palette is baked into the geometry.
 */
export function createSketchIcon(name, options = {}) {
  if (typeof document === 'undefined') {
    throw new Error('createSketchIcon requires a DOM document');
  }

  const canonical = canonicalName(name);
  const definition = ICON_DEFINITIONS[canonical];
  const size = options.size ?? DEFAULT_SIZE;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', optionSize(size));
  svg.setAttribute('height', optionSize(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('color', 'currentColor');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('data-sketch-icon', canonical || String(name ?? ''));
  if (options.className) svg.setAttribute('class', String(options.className));

  const decorative = Boolean(options.decorative);
  if (decorative) {
    svg.setAttribute('aria-hidden', 'true');
  } else {
    const label = String(options.label || options.title || definition?.label || name || 'Icon').trim();
    const title = document.createElementNS(SVG_NS, 'title');
    titleId += 1;
    title.setAttribute('id', `sketch-icon-title-${titleId}`);
    title.textContent = label;
    svg.append(title);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    svg.setAttribute('aria-labelledby', title.getAttribute('id'));
  }

  const strokeWidth = Number(options.strokeWidth);
  const width = Number.isFinite(strokeWidth) && strokeWidth > 0 ? strokeWidth : DEFAULT_STROKE_WIDTH;
  for (const path of pathsFor(canonical, size)) {
    const element = document.createElementNS(SVG_NS, 'path');
    element.setAttribute('d', path.d);
    element.setAttribute('fill', path.fill || 'none');
    element.setAttribute('stroke', path.stroke || 'currentColor');
    element.setAttribute('stroke-width', String(width));
    element.setAttribute('stroke-linecap', 'round');
    element.setAttribute('stroke-linejoin', 'round');
    element.setAttribute('vector-effect', 'non-scaling-stroke');
    element.setAttribute('pointer-events', 'none');
    svg.append(element);
  }

  return svg;
}

export const sketchIconRegistry = ICON_DEFINITIONS;
