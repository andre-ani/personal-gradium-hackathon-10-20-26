import { animate } from 'motion';
import { mountRasterDrawing } from './raster-reveal.js';

let serial = 0;
const ns = 'http://www.w3.org/2000/svg';
const shapeTags = 'path,circle,ellipse,line,polyline,polygon,rect';

const IMAGE_SIZE = 160;
// Generated images keep white margins; collide on the inked middle only.
const INK = .8;
// Balanced so images land all around their cards, not always beside them.
const KIND_WEIGHTS = { right: 20, left: 20, corner: 8, above: 21, below: 21 };

function seeded(text) {
  let h = 2166136261;
  for (const char of String(text)) h = Math.imul(h ^ char.codePointAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (random, min, max) => min + random() * (max - min);
const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const box = (cx, cy, w, h) => ({ left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 });

/** The heading band of a card: never drawn over, not even by its own doodle. */
export function headingBand(card) {
  return { left: card.x - card.width / 2, right: card.x + card.width / 2,
    top: card.y - card.height / 2, bottom: card.y - card.height / 2 + Math.min(card.height * .58, 84) };
}

/**
 * Seeded candidate spots for one card's doodle, relative to the card centre.
 * Rotation and scale belong to the node; only the anchor varies per candidate.
 */
const MAX_COVERED = .35;

export function illustrationCandidates(id, width, height) {
  const random = seeded(`illustration:${id}`);
  const rotation = between(random, -8, 8);
  const scale = between(random, .8, 1.15);
  const ink = IMAGE_SIZE * scale * INK;
  const spots = [];
  for (const side of [1, -1]) {
    const kind = side > 0 ? 'right' : 'left';
    for (let i = 0; i < 2; i++) spots.push({ kind, x: side * (width / 2 + ink / 2 + between(random, -22, 8)),
      y: between(random, -.3, .38) * height });
    // A margin doodle touching a lower corner, clear of the heading.
    const ox = between(random, .22, .4), oy = Math.min(between(random, .22, .45), .19 / ox);
    spots.push({ kind: 'corner', x: side * (width / 2 + ink * (.5 - ox)), y: height / 2 + ink * (.5 - oy) });
    // Images sit under the cards now, so upper corners are fair game too.
    const tx = between(random, .22, .4), ty = Math.min(between(random, .22, .45), .19 / tx);
    spots.push({ kind: 'corner', x: side * (width / 2 + ink * (.5 - tx)), y: -(height / 2 + ink * (.5 - ty)) });
  }
  for (const side of [-1, 1]) {
    const kind = side < 0 ? 'above' : 'below';
    spots.push({ kind, x: between(random, -.32, .32) * width, y: side * (height / 2 + ink / 2 + between(random, -18, 6)) });
  }
  // Weighted seeded order: the preferred kind first, repeats fall behind.
  const keyed = spots.map(spot => ({ spot, key: Math.log(random() || 1e-9) / KIND_WEIGHTS[spot.kind] }));
  keyed.sort((a, b) => b.key - a.key);
  return { rotation, scale, candidates: keyed.map(({ spot }) => spot) };
}

function arrowSamples(source, target) {
  const forward = target.x >= source.x;
  const start = [source.x + (forward ? 1 : -1) * source.width / 2, source.y];
  const end = [target.x + (forward ? -1 : 1) * target.width / 2, target.y];
  const pull = (end[0] - start[0]) / 2;
  return Array.from({ length: 17 }, (_, i) => {
    const t = i / 16, u = 1 - t;
    return [u ** 3 * start[0] + 3 * u * u * t * (start[0] + pull) + 3 * u * t * t * (end[0] - pull) + t ** 3 * end[0],
      u ** 3 * start[1] + 3 * u * u * t * start[1] + 3 * u * t * t * end[1] + t ** 3 * end[1]];
  });
}
const crossesArrow = (rect, points) => points.some(([x, y]) => x > rect.left && x < rect.right && y > rect.top && y < rect.bottom);

/**
 * Pure placement. cards: [{id,x,y,width,height}] in graph units; ids lists the
 * cards that carry an illustration; edges: [{source,target}] (optional).
 * previous keeps a still-valid spot so a doodle never hops between renders.
 * Returns Map(id -> {dx,dy,rotation,scale,kind,crowded}) relative to the card centre.
 */
export function planIllustrationPlacements(cards, ids, { edges = [], previous = new Map() } = {}) {
  const byId = new Map(cards.map(card => [card.id, card]));
  const arrows = edges.filter(e => byId.has(e.source) && byId.has(e.target) && e.source !== e.target)
    .map(e => arrowSamples(byId.get(e.source), byId.get(e.target)));
  const order = [...new Set(ids)].filter(id => byId.has(id))
    .sort((a, b) => (previous.has(b) - previous.has(a)) || String(a).localeCompare(String(b)));
  const placed = [];
  const result = new Map();
  for (const id of order) {
    const card = byId.get(id);
    const { rotation, scale, candidates } = illustrationCandidates(id, card.width, card.height);
    const ink = IMAGE_SIZE * scale * INK;
    const score = spot => {
      const rect = box(card.x + spot.x, card.y + spot.y, ink, ink);
      // Images sit beneath the cards, so cards may cover part of one (up to
      // ~35%); images never overlap each other.
      let hard = placed.reduce((sum, other) => sum + overlap(rect, other), 0);
      const covered = cards.reduce((sum, other) => sum + overlap(rect, box(other.x, other.y, other.width, other.height)), 0) / (ink * ink);
      if (covered > MAX_COVERED) hard += (covered - MAX_COVERED) * ink * ink;
      return { rect, hard, soft: arrows.some(points => crossesArrow(rect, points)) };
    };
    const kept = previous.get(id);
    const prior = kept && candidates.find(spot => spot.kind === kept.kind && spot.x === kept.dx && spot.y === kept.dy);
    const scored = candidates.map(spot => ({ spot, ...score(spot) }));
    const keptScore = prior && scored.find(item => item.spot === prior);
    const best = (keptScore && !keptScore.hard ? keptScore : null)
      || scored.find(item => !item.hard && !item.soft) || scored.find(item => !item.hard)
      || scored.reduce((a, b) => (b.hard < a.hard ? b : a));
    placed.push(best.rect);
    result.set(id, { dx: best.spot.x, dy: best.spot.y, rotation, scale, kind: best.spot.kind, crowded: best.hard > 0 });
  }
  return result;
}

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
  // so white multiplies against the real paper.
  // z-index 0 keeps images under the app layer, so cards can overlap them.
  layer.style.cssText = 'position:fixed;overflow:hidden;pointer-events:none;z-index:0;mix-blend-mode:multiply;';
  document.body.append(layer);
  const entries = new Map();
  const active = new Set();
  function activity(id, drawing) {
    if (drawing) active.add(id); else active.delete(id);
    onDrawingChange(active.size > 0);
  }
  let placements = new Map();
  function cardBox(id) {
    const node = graph.getNodeData(id);
    const size = node.style?.size || [250, 148];
    const [width, height] = Array.isArray(size) ? size : [size, size];
    const [x, y] = graph.getElementPosition(id);
    return { id, x, y, width, height };
  }
  // Replan only when the layout settles; motion in between just follows cards.
  function plan() {
    if (!entries.size) { placements = new Map(); return; }
    let cards, edges;
    try {
      cards = (graph.getNodeData() || []).flatMap(node => { try { return [cardBox(node.id)]; } catch { return []; } });
      edges = graph.getEdgeData?.() || [];
    } catch { return; }
    placements = planIllustrationPlacements(cards, [...entries.keys()], { edges, previous: placements });
  }
  function position() {
    // The layer spans the viewport so images near the map's edge are never
    // sliced off; each image is offset by the map container's position.
    const bounds = container.getBoundingClientRect();
    Object.assign(layer.style, { left: '0px', top: '0px', width: '100vw', height: '100vh' });
    if (!entries.size) return;
    let zoom;
    try { zoom = graph.getZoom(); } catch { return; }
    for (const [id, entry] of entries) {
      try {
        if (!placements.has(id)) plan();
        const spot = placements.get(id);
        const [cx, cy] = graph.getElementPosition(id);
        const [x, y] = graph.getViewportByCanvas([cx + spot.dx, cy + spot.dy]);
        entry.element.style.visibility = '';
        entry.element.style.transform = `translate(${bounds.left + x - IMAGE_SIZE / 2}px,${bounds.top + y - IMAGE_SIZE / 2}px) rotate(${spot.rotation}deg) scale(${zoom * spot.scale})`;
      } catch { entry.element.style.visibility = 'hidden'; }
    }
  }
  const replan = () => { plan(); position(); };
  const events = ['aftertransform', 'afterdraw', 'afterrender'];
  events.forEach(event => graph.on(event, event === 'afterrender' ? replan : position));
  graph.on('node:dragend', replan);
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
        element.style.cssText = 'position:absolute;left:0;top:0;width:160px;height:160px;transform-origin:50% 50%;mix-blend-mode:multiply;-webkit-mask-image:radial-gradient(circle closest-side,#000 58%,transparent 96%);mask-image:radial-gradient(circle closest-side,#000 58%,transparent 96%);';
        layer.append(element);
        const token = Symbol(node.id);
        const mounted = (drawing.image_url ? mountRasterDrawing : mountPencilDrawing)(element, drawing, {
          reducedMotion: isReduced(), onActivity: drawing => activity(token, drawing) });
        entries.set(node.id, { element, asset, drawing: mounted });
      }
      for (const [id, entry] of entries) if (!visible.has(id)) {
        entry.drawing.dispose(); entry.element.remove(); entries.delete(id);
      }
      replan();
    },
    reduce() { entries.forEach(entry => entry.drawing.finish()); },
    dispose() {
      events.forEach(event => graph.off(event, event === 'afterrender' ? replan : position));
      graph.off('node:dragend', replan);
      resize.disconnect(); window.removeEventListener('scroll', position);
      entries.forEach(entry => entry.drawing.dispose()); entries.clear(); placements.clear(); layer.remove();
    },
  };
}
