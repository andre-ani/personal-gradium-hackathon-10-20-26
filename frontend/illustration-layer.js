import { animate } from 'motion';
import { mountRasterDrawing } from './raster-reveal.js';

let serial = 0;
const ns = 'http://www.w3.org/2000/svg';
const shapeTags = 'path,circle,ellipse,line,polyline,polygon,rect';

/** Only call with server-sanitized shape SVGs, never raw model output. */
export function mountPencilDrawing(container, drawing, { reducedMotion = false, onActivity = () => {} } = {}) {
  const doc = new DOMParser().parseFromString(drawing.svg, 'image/svg+xml');
  const svg = document.importNode(doc.documentElement, true);
  // Defense in depth for cached/foreign graph snapshots.
  const tags = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect']);
  const attributes = new Set(['xmlns', 'viewBox', 'width', 'height', 'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'transform']);
  if (svg.localName !== 'svg' || svg.getAttribute('viewBox') !== '0 0 80 80'
      || [...svg.querySelectorAll('*'), svg].some(el => !tags.has(el.localName) || [...el.attributes].some(a => !attributes.has(a.name) || /url\s*\(|javascript:|https?:/i.test(a.value) && a.name !== 'xmlns'))) {
    throw new Error('Unsafe illustration rejected.');
  }
  svg.setAttribute('width', '160'); svg.setAttribute('height', '160');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Pencil drawing of ${drawing.concept}`);
  svg.style.cssText = 'display:block;overflow:visible;mix-blend-mode:multiply;';
  const id = `pencil-grain-${++serial}`;
  const defs = document.createElementNS(ns, 'defs');
  // Trusted local filter. The model cannot supply filters or URL references.
  defs.innerHTML = `<filter id="${id}" filterUnits="userSpaceOnUse" x="-4" y="-4" width="88" height="88"><feTurbulence type="fractalNoise" baseFrequency=".085" numOctaves="2" seed="11" result="wobble"/><feDisplacementMap in="SourceGraphic" in2="wobble" scale=".65" xChannelSelector="R" yChannelSelector="G" result="pencil"/><feTurbulence type="fractalNoise" baseFrequency=".68" numOctaves="2" seed="7" result="grain"/><feColorMatrix in="grain" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .65 .35" result="tooth"/><feComposite in="pencil" in2="tooth" operator="in"/></filter>`;
  const group = document.createElementNS(ns, 'g');
  while (svg.firstChild) group.append(svg.firstChild);
  svg.append(defs, group);
  const strokes = [...group.querySelectorAll(shapeTags)];
  // Apply a static bend to every stroke, including model circles and lines.
  // User-space filter bounds also cover horizontal/vertical zero-area paths.
  strokes.forEach(stroke => stroke.setAttribute('filter', `url(#${id})`));
  const controls = [];
  let settled = false;
  const displacement = defs.querySelector('feDisplacementMap');
  function finish() {
    if (settled) return;
    settled = true;
    controls.forEach(control => control.stop());
    strokes.forEach(el => { el.style.strokeDasharray = ''; el.style.strokeDashoffset = ''; });
    displacement.setAttribute('scale', '.65');
    onActivity(false);
  }
  container.replaceChildren(svg);
  if (!reducedMotion) {
    onActivity(true);
    strokes.forEach((el, index) => {
      let length = 100;
      try { length = el.getTotalLength?.() || 100; } catch { /* Detached preview; retain a finite reveal. */ }
      el.style.strokeDasharray = `${length} ${length}`;
      el.style.strokeDashoffset = String(length);
      controls.push(animate(el, { strokeDashoffset: [length, 0] }, { duration: .22, delay: index * .018, ease: 'easeOut' }));
    });
    controls.push(animate(1.4, .65, { duration: .55, onUpdate: value => displacement.setAttribute('scale', String(value)) }));
    Promise.all(controls.map(control => Promise.resolve(control))).then(() => onActivity(false));
  }
  return { svg, finish, dispose() { finish(); svg.remove(); } };
}

/** A passive layer: jobs arrive through the graph queue; no fetch from here. */
export function createIllustrationLayer(graph, container, { isReduced = () => false, onDrawingChange = () => {} } = {}) {
  const layer = document.createElement('div');
  layer.className = 'pencil-illustrations';
  // Paper is a body sibling outside the app's stacking context. Blend here
  // so white multiplies against the real paper, then clip to the graph rect.
  layer.style.cssText = 'position:fixed;overflow:hidden;pointer-events:none;z-index:2;mix-blend-mode:multiply;';
  document.body.append(layer);
  const entries = new Map();
  const active = new Set();
  function activity(id, drawing) {
    if (drawing) active.add(id); else active.delete(id);
    onDrawingChange(active.size > 0);
  }
  function position() {
    const bounds = container.getBoundingClientRect();
    Object.assign(layer.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
    if (!entries.size) return;
    let zoom;
    try { zoom = graph.getZoom(); } catch { return; }
    for (const [id, entry] of entries) {
      try {
        const [x, y] = graph.getViewportByCanvas(graph.getElementPosition(id));
        const node = graph.getNodeData(id);
        const size = node.style?.size || [250, 148];
        const width = Array.isArray(size) ? size[0] : size;
        entry.element.style.visibility = '';
        entry.element.style.transform = `translate(${x + (width / 2 + 8) * zoom}px,${y - 80 * zoom}px) scale(${zoom})`;
      } catch { entry.element.style.visibility = 'hidden'; }
    }
  }
  const events = ['aftertransform', 'afterdraw', 'afterrender'];
  events.forEach(event => graph.on(event, position));
  const resize = new ResizeObserver(position); resize.observe(container);
  window.addEventListener('scroll', position, { passive: true });
  return {
    sync(nodes) {
      const visible = new Set();
      for (const node of nodes) {
        const drawing = node.illustration;
        if (!(drawing?.image_url || drawing?.svg) || drawing.concept !== String(node.label || '').trim().replace(/\s+/g, ' ').slice(0, 160) || ['placeholder', 'pending'].includes(node.status)) continue;
        visible.add(node.id);
        const asset = drawing.image_url || drawing.svg;
        if (entries.get(node.id)?.asset === asset) continue;
        entries.get(node.id)?.drawing.dispose();
        entries.get(node.id)?.element.remove();
        const element = document.createElement('div');
        element.dataset.nodeId = node.id;
        element.style.cssText = 'position:absolute;left:0;top:0;width:160px;height:160px;transform-origin:0 0;mix-blend-mode:multiply;';
        layer.append(element);
        const token = Symbol(node.id);
        const mounted = (drawing.image_url ? mountRasterDrawing : mountPencilDrawing)(element, drawing, {
          reducedMotion: isReduced(), onActivity: drawing => activity(token, drawing) });
        entries.set(node.id, { element, asset, drawing: mounted });
      }
      for (const [id, entry] of entries) if (!visible.has(id)) {
        entry.drawing.dispose(); entry.element.remove(); entries.delete(id);
      }
      position();
    },
    reduce() { entries.forEach(entry => entry.drawing.finish()); },
    dispose() {
      events.forEach(event => graph.off(event, position));
      resize.disconnect(); window.removeEventListener('scroll', position);
      entries.forEach(entry => entry.drawing.dispose()); entries.clear(); layer.remove();
    },
  };
}
