// Soft hand-drawn colour fields behind section blocks: one rounded, slightly
// irregular blob per section that has children, around the section card and
// everything under it (item series included, so fields never double up), in
// the section's wash colour on the canvas background layer, under every
// card and arrow. The geometry half is pure and tested.

import { Path } from '@antv/g';

function seeded(text, salt) {
  let hash = 2166136261;
  for (const char of `${text}:${salt}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x85ebca6b); hash ^= hash >>> 13;
  return ((hash >>> 0) / 4294967295) * 2 - 1;
}

function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/**
 * Hull around card boxes [{x, y, width, height}] (centres). Each box is
 * padded by `pad` with rounded corners, the convex hull is resampled about
 * every `spacing` px and pushed outward by a seeded wobble, then smoothed
 * into a closed Catmull-Rom curve. Returns { d, points } (points is the
 * wobbled polygon the curve passes through) or null with no boxes.
 */
export function seriesHull(boxes = [], { pad = 22, seed = 'series', spacing = 70, wobble = 5 } = {}) {
  const cards = boxes.filter(box => [box?.x, box?.y, box?.width, box?.height].every(Number.isFinite));
  if (!cards.length) return null;
  const samples = [];
  for (const box of cards) {
    const hw = box.width / 2, hh = box.height / 2;
    for (const [sx, sy, start] of [[1, 1, 0], [-1, 1, 0.5], [-1, -1, 1], [1, -1, 1.5]]) {
      const cx = box.x + sx * hw, cy = box.y + sy * hh;
      for (let step = 0; step <= 3; step += 1) {
        const angle = (start + step / 6) * Math.PI;
        samples.push([cx + Math.cos(angle) * pad, cy + Math.sin(angle) * pad]);
      }
    }
  }
  const hull = convexHull(samples);
  const centre = hull.reduce((acc, p) => [acc[0] + p[0] / hull.length, acc[1] + p[1] / hull.length], [0, 0]);
  const points = [];
  hull.forEach((a, index) => {
    const b = hull[(index + 1) % hull.length];
    const pieces = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing));
    for (let piece = 0; piece < pieces; piece += 1) {
      const t = piece / pieces;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      // Outward only, so the wash never cuts into a card.
      const push = (seeded(seed, points.length) + 1) / 2 * wobble;
      const dx = p[0] - centre[0], dy = p[1] - centre[1], length = Math.hypot(dx, dy) || 1;
      points.push([p[0] + (dx / length) * push, p[1] + (dy / length) * push]);
    }
  });
  const n = points.length;
  const at = index => points[(index + n) % n];
  const f = value => value.toFixed(1);
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let index = 0; index < n; index += 1) {
    const p0 = at(index - 1), p1 = at(index), p2 = at(index + 1), p3 = at(index + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return { d: `${d}Z`, points };
}

/**
 * One field per section with children: a first-level card (its parent is a
 * title, which has no parent) plus all its descendants. nodes: [{id,
 * parent_id}]. Returns [{ key, section, members: [id] }] in input order.
 */
export function sectionGroups(nodes = []) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parentOf = (id) => {
    const parent = byId.get(id)?.parent_id;
    return parent != null && parent !== id && byId.has(parent) ? parent : undefined;
  };
  const children = new Map();
  for (const node of nodes) {
    const parent = parentOf(node.id);
    if (parent === undefined) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(node.id);
  }
  const groups = [];
  for (const node of nodes) {
    const parent = parentOf(node.id);
    if (parent === undefined || parentOf(parent) !== undefined || !children.has(node.id)) continue;
    const members = [node.id];
    const seen = new Set(members);
    for (let index = 0; index < members.length; index += 1) {
      for (const child of children.get(members[index]) || []) if (!seen.has(child)) { seen.add(child); members.push(child); }
    }
    groups.push({ key: `section:${node.id}`, section: node.id, members });
  }
  return groups;
}

/**
 * Whether cards sit together as one block: every card is within `gap` of
 * another, and they all chain together. A field around cards spread across
 * the map would read as a box around unrelated things.
 */
export function compactBlock(boxes = [], gap = 96) {
  if (boxes.length < 2) return false;
  const near = (a, b) => Math.max(0, Math.abs(a.x - b.x) - (a.width + b.width) / 2) <= gap
    && Math.max(0, Math.abs(a.y - b.y) - (a.height + b.height) / 2) <= gap;
  const reached = new Set([0]);
  for (let grew = true; grew;) {
    grew = false;
    for (let i = 0; i < boxes.length; i += 1) {
      if (reached.has(i)) continue;
      if ([...reached].some(j => near(boxes[i], boxes[j]))) { reached.add(i); grew = true; }
    }
  }
  return reached.size === boxes.length;
}

/** Quiet time (ms) after the last change before a new field appears. */
export const WASH_SETTLE = 2200;

/**
 * Runtime layer. sync([{ key, members, wash, ink }]) sets which blocks get a
 * field; the shapes follow the cards on every draw, drag and reorder frame.
 * A new field waits until the map has been quiet for WASH_SETTLE and its
 * cards form a compact block; a block that spreads out loses its field.
 */
export function createSeriesWash(graph, { isReduced = () => false } = {}) {
  const shapes = new Map();
  let wanted = [];
  let frame = 0;
  let changedAt = 0, settleTimer = 0;
  const layer = () => graph.getCanvas?.()?.getLayer?.('background');
  const boxOf = id => {
    try {
      const node = graph.getNodeData(id);
      const [x, y] = graph.getElementPosition(id);
      const size = Array.isArray(node?.style?.size) ? node.style.size : [220, 120];
      return { x, y, width: size[0], height: size[1] };
    } catch { return null; }
  };
  function update() {
    frame = 0;
    const target = layer();
    if (!target) return;
    const live = new Set();
    for (const item of wanted) {
      const boxes = item.members.map(boxOf).filter(Boolean);
      if (!compactBlock(boxes)) continue;
      let shape = shapes.get(item.key);
      if (!shape && Date.now() - changedAt < WASH_SETTLE) continue;
      const hull = seriesHull(boxes, { seed: item.key, pad: 24 });
      if (!hull) continue;
      live.add(item.key);
      if (!shape) {
        shape = new Path({ style: { d: hull.d, opacity: 0 } });
        target.appendChild(shape);
        shapes.set(item.key, shape);
        shape.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: isReduced() ? 0 : 520, fill: 'both', easing: 'ease-out' });
      }
      shape.attr({ d: hull.d, fill: item.wash, fillOpacity: 0.5, stroke: item.ink, strokeOpacity: 0.13, lineWidth: 1.3, pointerEvents: 'none' });
    }
    for (const [key, shape] of shapes) {
      if (live.has(key)) continue;
      shape.remove();
      shapes.delete(key);
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  for (const event of ['afterdraw', 'afterrender', 'node:drag', 'node:dragend']) graph.on(event, schedule);
  return {
    sync(series) {
      wanted = series;
      changedAt = Date.now();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(schedule, WASH_SETTLE + 50);
      schedule();
    },
    clear() { wanted = []; schedule(); },
  };
}
export const createSectionWash = createSeriesWash;
