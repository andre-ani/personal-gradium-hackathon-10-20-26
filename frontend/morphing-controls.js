import { createMorph } from 'morphicons/dom';
import { sketchIconPaths } from './sketch-icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_VIEWBOX = '0 0 24 24';

function iconPathData(name) {
  const paths = sketchIconPaths(name);
  if (!Array.isArray(paths)) throw new TypeError(`Unknown sketch icon: ${name}`);

  const records = paths.filter((path) => {
    if (typeof path === 'string') return Boolean(path.trim());
    return typeof path?.d === 'string' && Boolean(path.d.trim());
  });
  const strokes = records.filter((path) => {
    if (typeof path === 'string') return true;
    return path.stroke !== 'none' && (!path.fill || path.fill === 'none');
  });
  const selected = strokes.length ? strokes : records;
  const data = selected.map((path) => (typeof path === 'string' ? path : path.d).trim()).join(' ');
  if (!data) throw new TypeError(`Sketch icon has no path data: ${name}`);
  return data;
}

function makeIcon(size) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', ICON_VIEWBOX);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('data-morphing-control', 'true');

  const path = document.createElementNS(SVG_NS, 'path');
  svg.append(path);
  return { path, svg };
}

/**
 * Mount an interruptible morphing icon in an existing HTML button.
 * The generated SVG is decorative and inserted before the button's existing
 * content; callers retain ownership of text, labels, and any old markup.
 */
export function mountMorphingControl(button, { from, to, initial = false, size = 20 } = {}) {
  if (!button || typeof button.insertBefore !== 'function') {
    throw new TypeError('mountMorphingControl requires an HTML button');
  }

  const fromIcon = iconPathData(from);
  const toIcon = iconPathData(to);
  const { path, svg } = makeIcon(size);
  button.insertBefore(svg, button.firstChild);

  const morph = createMorph(path, initial ? toIcon : fromIcon, { reducedMotion: 'user' });
  const page = typeof window === 'undefined' ? null : window;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    morph.destroy();
    svg.remove();
    page?.removeEventListener('pagehide', dispose);
  };

  page?.addEventListener('pagehide', dispose, { once: true });

  return {
    set(active) {
      if (disposed) return;
      morph.morphTo(active ? toIcon : fromIcon);
    },
    dispose,
  };
}
