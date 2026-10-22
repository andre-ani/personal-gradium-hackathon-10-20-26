// Radial mind-map placement. The main topic sits at the centre, first-level
// branches own angular sectors sized by their subtree, and deeper cards fan
// outward inside their parent's sector. Everything here is pure and
// deterministic: the same input always yields the same positions.

import { isSequenceEdge } from './card-hierarchy.js';

const GAP = 40; // clear paper between two card footprints
const LINK = 56; // room for an arrow beyond the touching distance
const STEP = 36; // radial search step
const RINGS = 90; // bounded radial search (about 3200px)
const EXTRA_RINGS = 3; // keep looking a little past the first free ring
const ANGLE_COST = 260; // px of distance one radian of drift is worth
const KIN_COST = 0.4; // pull towards same-group siblings
const OFFSETS = [0, 0.2, -0.2, 0.4, -0.4, 0.6, -0.6, 0.8, -0.8, 1, -1];
const TAU = Math.PI * 2;
const SATELLITE_DIRECTIONS = [0, Math.PI, Math.PI / 2, -Math.PI / 2, Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4, -Math.PI / 4];
const SATELLITE_ROOM = 260;
const CLUSTER_GAP = [100, 140]; // seeded clear paper between separate topic clusters
const BRANCH_REACH = 52; // seeded extra ring distance shared by one first-level branch
const CARD_REACH = 20; // seeded extra ring distance per card
// Hierarchy spacing: steps of one series sit closer than plain neighbours,
// and cards of different first-level sections keep more paper between them.
export const SERIES_GAP = 36;
export const SECTION_GAP = 64;

/** Illustration room the live canvas keeps beside cards before art arrives. */
export const LIVE_ILLUSTRATION_RESERVE = 128;

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const positive = (value, fallback) => (finite(value) > 0 ? Number(value) : fallback);
const clean = (value) => (Object.is(value, -0) ? 0 : Math.round(value * 100) / 100);
const normalise = (angle) => ((angle % TAU) + TAU) % TAU;

function card(node) {
  return {
    ...node,
    width: positive(node.width, 280),
    height: positive(node.height, 150),
    space: Math.max(0, finite(node.space ?? node.illustrationSpace)),
  };
}

/**
 * The paper a card occupies: its own box plus illustration room on the side
 * facing away from its topic centre, where the illustration layer finds space.
 */
export function footprint(node, outward = 0) {
  const { x, y, width, height, space } = card(node);
  const tall = space ? Math.max(height, 160) : height;
  const right = Math.cos(outward) >= -1e-6;
  return {
    left: x - width / 2 - (right ? 0 : space),
    right: x + width / 2 + (right ? space : 0),
    top: y - tall / 2,
    bottom: y + tall / 2,
  };
}

export function overlaps(a, b, gap = 0) {
  return a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
}

/** Clear paper two footprints need, from their `series` and `branch` tags. */
export function gapBetween(a, b) {
  if (a.series != null && a.series === b.series) return SERIES_GAP;
  if (a.branch != null && b.branch != null && a.branch !== b.branch) return SECTION_GAP;
  return GAP;
}
const blocked = (box, occupied) => occupied.some((other) => overlaps(box, other, gapBetween(box, other)));
const seriesKey = (node) => node?.series?.key ?? undefined;

// Distance from an origin card's centre, along `angle`, at which a new card
// of the given size just clears it (illustration room included).
function clearance(origin, size, angle) {
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const along = (origin.width + size.width) / 2 + size.space + GAP;
  const across = (Math.max(origin.height, size.space ? 160 : 0) + Math.max(size.height, size.space ? 160 : 0)) / 2 + GAP;
  return Math.min(cos > 1e-6 ? along / cos : Infinity, sin > 1e-6 ? across / sin : Infinity);
}

/**
 * Search outward from `origin` for the free spot closest to `angle` (within
 * +/- `spread`). Score favours short links, little angular drift and staying
 * near same-group kin. Returns {x, y, angle}.
 */
// Seeded irregularity so maps look hand-placed rather than compass-aligned.
function wobble(id, salt) {
  let hash = 2166136261;
  for (const ch of `${salt}:${id}`) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  // Avalanche so ids differing only in their last character still spread.
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x85ebca6b); hash ^= hash >>> 13; hash = Math.imul(hash, 0xc2b2ae35); hash ^= hash >>> 16;
  return ((hash >>> 0) / 4294967295) * 2 - 1;
}

/**
 * Extra link length beyond the touching distance: a seeded share for the whole
 * first-level branch (so its rings sit a little nearer or further) plus a small
 * per-card share. Bounded to 12..84px so maps vary without sprawling.
 */
export function ringReach(branchId, id) {
  return 12 + ((wobble(branchId, 'ring') + 1) / 2) * BRANCH_REACH + ((wobble(id, 'reach') + 1) / 2) * CARD_REACH;
}

const clusterGap = (id) => CLUSTER_GAP[0] + ((wobble(id, 'gap') + 1) / 2) * (CLUSTER_GAP[1] - CLUSTER_GAP[0]);

function findSlot({ origin, size, angle, spread, occupied, kin = [], outwardOf, reach = 0, tags = {} }) {
  let best = null;
  let bestRing = Infinity;
  for (let ring = 0; ring < RINGS && ring <= bestRing + EXTRA_RINGS; ring += 1) {
    for (const offset of OFFSETS) {
      if (offset && spread <= 0) continue;
      const theta = angle + offset * spread;
      const distance = clearance(origin, size, theta) + LINK + reach + ring * STEP;
      const x = origin.x + Math.cos(theta) * distance;
      const y = origin.y + Math.sin(theta) * distance;
      const box = { ...footprint({ ...size, x, y }, outwardOf(x, y)), ...tags };
      if (blocked(box, occupied)) continue;
      const near = kin.length ? Math.min(...kin.map((k) => Math.hypot(k.x - x, k.y - y))) : 0;
      const score = distance + ANGLE_COST * Math.abs(offset * spread) + KIN_COST * near;
      if (!best || score < best.score - 1e-9) best = { x, y, angle: theta, score };
      bestRing = Math.min(bestRing, ring);
    }
  }
  if (best) return best;
  // Pathological crowding: step straight out until the card is clear.
  for (let distance = clearance(origin, size, angle) + LINK; ; distance += STEP) {
    const x = origin.x + Math.cos(angle) * distance;
    const y = origin.y + Math.sin(angle) * distance;
    const box = { ...footprint({ ...size, x, y }, outwardOf(x, y)), ...tags };
    if (!blocked(box, occupied)) return { x, y, angle };
  }
}

const axisOf = (dx, dy) => (Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1]);

/**
 * The next step of a series goes right beside the previous one, in a straight
 * row: continuing the row's direction, else along the ring (tangent to
 * `angle`), else outward. SERIES_GAP apart, so a series reads as one group.
 * Returns {x, y, angle} or null when every nearby spot is taken.
 */
export function chainSlot({ prev, before, size, angle, occupied, outwardOf, tags = {} }) {
  const dirs = [];
  if (before) dirs.push(axisOf(prev.x - before.x, prev.y - before.y));
  const tangent = axisOf(-Math.sin(angle), Math.cos(angle));
  dirs.push(tangent, axisOf(Math.cos(angle), Math.sin(angle)), [-tangent[0], -tangent[1]]);
  const unique = dirs.filter((dir, index) => dirs.findIndex((other) => other[0] === dir[0] && other[1] === dir[1]) === index);
  const item = card(size);
  const from = card(prev);
  for (let extra = 0; extra <= 6; extra += 1) {
    for (const [dx, dy] of unique) {
      const along = dx
        ? (from.width + item.width) / 2 + Math.max(from.space, item.space)
        : (Math.max(from.height, from.space ? 160 : 0) + Math.max(item.height, item.space ? 160 : 0)) / 2;
      const distance = along + SERIES_GAP + 0.5 + extra * (STEP / 2);
      const x = prev.x + dx * distance;
      const y = prev.y + dy * distance;
      const box = { ...footprint({ ...item, x, y }, outwardOf(x, y)), ...tags };
      if (!blocked(box, occupied)) return { x, y, angle: Math.atan2(dy, dx) };
    }
  }
  return null;
}

/** Siblings with series members pulled together in step order. */
function seriesOrder(children) {
  const out = [];
  const done = new Set();
  for (const child of children) {
    if (done.has(child)) continue;
    const key = seriesKey(child);
    const mates = key === undefined ? [child]
      : children.filter((other) => seriesKey(other) === key).sort((a, b) => (a.series.index ?? 0) - (b.series.index ?? 0));
    for (const mate of mates) { done.add(mate); out.push(mate); }
  }
  return out;
}

// A free centre for a separate topic: around the first topic, with room to grow.
function findSatellite({ centre, size, occupied, centres, kin = [] }) {
  let best = null;
  for (let ring = 0; ring < RINGS && !best; ring += 1) {
    for (const direction of SATELLITE_DIRECTIONS) {
      const distance = 760 + ring * STEP * 2;
      const x = centre.x + Math.cos(direction) * distance * 1.25;
      const y = centre.y + Math.sin(direction) * distance;
      const box = footprint({ ...size, x, y }, 0);
      const room = { left: box.left - SATELLITE_ROOM, right: box.right + SATELLITE_ROOM, top: box.top - SATELLITE_ROOM / 2, bottom: box.bottom + SATELLITE_ROOM / 2 };
      if (occupied.some((other) => overlaps(room, other, GAP))) continue;
      if (centres.some((other) => Math.hypot(other.x - x, other.y - y) < 900)) continue;
      const near = kin.length ? Math.min(...kin.map((k) => Math.hypot(k.x - x, k.y - y))) : 0;
      const score = distance + KIN_COST * near;
      if (!best || score < best.score - 1e-9) best = { x, y, score };
    }
  }
  return best || { x: centre.x + 2000, y: centre.y };
}

// Parent links, ignoring missing parents and breaking cycles deterministically.
function parentLinks(list) {
  const byId = new Map(list.map((node) => [node.id, node]));
  const parent = new Map();
  for (const node of list) {
    if (node.parent_id === undefined || node.parent_id === null || node.parent_id === node.id || !byId.has(node.parent_id)) continue;
    let cursor = node.parent_id;
    const seen = new Set([node.id]);
    while (cursor !== undefined && !seen.has(cursor)) { seen.add(cursor); cursor = parent.get(cursor); }
    if (cursor === undefined) parent.set(node.id, node.parent_id);
  }
  return parent;
}

function treeRoot(id, parent) {
  let cursor = id;
  const seen = new Set();
  while (parent.has(cursor) && !seen.has(cursor)) { seen.add(cursor); cursor = parent.get(cursor); }
  return cursor;
}

// Same-group siblings stay together: order by each group's first appearance.
function groupOrder(children) {
  const firstSeen = new Map();
  children.forEach((child, index) => {
    const key = child.group ?? `\u0000${child.id}`;
    if (!firstSeen.has(key)) firstSeen.set(key, index);
  });
  return children
    .map((child, index) => ({ child, index, rank: firstSeen.get(child.group ?? `\u0000${child.id}`) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.child);
}

const TOPIC_KINDS = new Set(['topic', 'root']);
// Only a known non-topic kind (idea, task, ...) is loose by default; an unknown kind stays a topic.
const nonTopic = (kind) => kind !== undefined && kind !== null && !TOPIC_KINDS.has(kind);

/**
 * Parentless cards that are not their own topic centre: a card with a `near`
 * hint, or a non-topic card, placed beside its neighbour (or the main topic)
 * with no arrow. Cards with children and the main topic are never loose.
 * Returns Map(id -> anchor id).
 */
function looseAnchors(list, parent) {
  const byId = new Map(list.map((node) => [node.id, node]));
  const hasChildren = new Set(parent.values());
  const primary = list.find((node) => node.kind === 'root') || list.find((node) => !parent.has(node.id)) || list[0];
  const anchors = new Map();
  for (const node of list) {
    if (parent.has(node.id) || node === primary || hasChildren.has(node.id)) continue;
    const near = node.near !== undefined && node.near !== null && node.near !== node.id && byId.has(node.near) ? node.near : undefined;
    if (near !== undefined) anchors.set(node.id, near);
    else if (nonTopic(node.kind)) anchors.set(node.id, primary.id);
  }
  return anchors;
}

/**
 * The explicit edges plus each declared parent's implicit `contains:` edge.
 * A loose card (no parent_id) gets no edge: `near` never draws an arrow.
 * With `grouped` (default), parents below the title draw no containment
 * arrow to their children: the section field and stacking show membership.
 */
export function withContainsEdges(nodes, edges, orientation = 'radial', { grouped = true } = {}) {
  const ids = new Set(nodes.map((node) => node.id));
  // Inside a section block membership shows through the field and the
  // stacking, so a non-title parent draws no arrow to its own children (an
  // implicit contains, an explicit "contains" or an unlabeled parent link).
  const parentOf = new Map(nodes.filter((node) => node.parent_id != null && node.parent_id !== node.id && ids.has(node.parent_id)).map((node) => [node.id, node.parent_id]));
  const inBlock = (source, target) => grouped && parentOf.get(target) === source && parentOf.has(source);
  const quiet = (edge) => inBlock(edge.source, edge.target)
    && (String(edge.id ?? '').startsWith('contains:') || edge.label === 'contains' || edge.label == null || edge.label === '');
  // At most one arrow per pair of cards, whichever direction it was declared.
  const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const seen = new Set();
  const visible = [];
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue;
    const key = pair(edge.source, edge.target);
    if (seen.has(key)) continue;
    seen.add(key);
    if (quiet(edge)) continue;
    visible.push(edge);
  }
  for (const node of nodes) {
    const parentId = node.parent_id;
    if (parentId === undefined || parentId === null || parentId === node.id || !ids.has(parentId)) continue;
    const key = pair(parentId, node.id);
    if (seen.has(key)) continue;
    seen.add(key);
    if (inBlock(parentId, node.id)) continue;
    visible.push({ id: `contains:${parentId}:${node.id}`, source: parentId, target: node.id });
  }
  if (orientation === 'flow') {
    // Containment belongs to the semantic map, but a second topic-to-stage
    // arrow is redundant when the process already reaches that stage.
    const outgoing = new Map();
    for (const edge of visible) {
      if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
      outgoing.get(edge.source).push(edge);
    }
    return visible.filter(edge => {
      const containment = String(edge.id).startsWith('contains:') || edge.label === 'contains';
      if (!containment) return true;
      const visited = new Set([edge.source]), pending = [edge.source];
      while (pending.length) {
        for (const next of outgoing.get(pending.pop()) || []) {
          if (next === edge) continue;
          if (next.target === edge.target) {
            // Later decisions must retain a real alternate path, including
            // in cyclic workflows where every stage has an incoming edge.
            outgoing.set(edge.source, outgoing.get(edge.source).filter(item => item !== edge));
            return false;
          }
          if (!visited.has(next.target)) { visited.add(next.target); pending.push(next.target); }
        }
      }
      return true;
    });
  }
  return withoutRedundantSteps(visible, parentOf);
}

/**
 * Drop "then" links the map already says another way: a skip over a step
 * (a→c when a→b→c is drawn), and a link from inside a block to the block's
 * own next step (a sub-step → "Bake" when "Preparation" → "Bake" is drawn).
 */
function withoutRedundantSteps(edges, parentOf) {
  const order = edges.filter(isSequenceEdge);
  const next = new Map();
  for (const edge of order) {
    if (!next.has(edge.source)) next.set(edge.source, new Set());
    next.get(edge.source).add(edge.target);
  }
  const reachesAround = (edge) => {
    const pending = [...(next.get(edge.source) || [])].filter(id => id !== edge.target);
    const seen = new Set(pending);
    while (pending.length) {
      const id = pending.pop();
      for (const target of next.get(id) || []) {
        if (target === edge.target) return true;
        if (!seen.has(target)) { seen.add(target); pending.push(target); }
      }
    }
    return false;
  };
  const leaksFromBlock = (edge) => {
    for (let owner = parentOf.get(edge.source); owner; owner = parentOf.get(owner)) {
      if (owner === edge.target) return false;
      if (next.get(owner)?.has(edge.target)) return true;
    }
    return false;
  };
  const dropped = new Set(order.filter(edge => reachesAround(edge) || leaksFromBlock(edge)));
  return dropped.size ? edges.filter(edge => !dropped.has(edge)) : edges;
}

/** True for a card drawn without a parent arrow beside another card. */
export function isLooseCard(node) {
  return (node?.parent_id === undefined || node?.parent_id === null)
    && ((node?.near !== undefined && node?.near !== null) || nonTopic(node?.kind));
}

// The free spot on the anchor's ring (around the anchor's own parent) closest
// to the anchor: sibling-like distance, no overlaps, and no arrow.
function findBeside({ origin, anchor, size, occupied, outwardOf }) {
  const radius = Math.hypot(anchor.x - origin.x, anchor.y - origin.y);
  const base = Math.atan2(anchor.y - origin.y, anchor.x - origin.x);
  let best = null;
  for (let ring = 0; ring <= 24; ring += 1) {
    const dr = (ring % 2 ? 1 : -1) * Math.ceil(ring / 2) * STEP;
    const r = radius + dr;
    if (r < clearance(origin, size, base) * 0.5) continue;
    const step = Math.min(0.2, 24 / r);
    for (let offset = step; offset <= Math.PI; offset += step) {
      for (const theta of [base + offset, base - offset]) {
        const x = origin.x + Math.cos(theta) * r;
        const y = origin.y + Math.sin(theta) * r;
        const score = Math.hypot(anchor.x - x, anchor.y - y) + 0.5 * Math.abs(dr);
        if (best && score >= best.score - 1e-9) continue;
        const box = { ...footprint({ ...size, x, y }, outwardOf(x, y)), series: seriesKey(size) };
        if (blocked(box, occupied)) continue;
        best = { x, y, score };
      }
    }
  }
  return best;
}

function primaryRootFirst(roots) {
  const main = roots.findIndex((node) => node.kind === 'root');
  return main <= 0 ? roots : [roots[main], ...roots.slice(0, main), ...roots.slice(main + 1)];
}

// ---- Section blocks -------------------------------------------------------
// A section (a first-level card) and everything under it form one block: its
// items stack in a tight column on the block's outward side, in series order,
// and each item's details sit right beside it. Blocks keep clearly wider
// gaps between each other than the gaps inside them.

/** Seeded clear paper inside one block (section to item, item to item). */
export const BLOCK_INNER_GAP = [18, 28];
/** Seeded clear paper between two blocks (and between the title and a block). */
export const BLOCK_GAP = [70, 110];
const between = ([low, high], id, salt) => low + ((wobble(id, salt) + 1) / 2) * (high - low);
export const innerGap = (id) => between(BLOCK_INNER_GAP, id, 'inner');
export const blockGap = (id) => between(BLOCK_GAP, id, 'block');
const DRIFT = 40; // px a block member may sit away from its slot before a re-arrangement
const GRID_AFTER = 5; // a concept block with more items than this uses two columns

const rectOf = (node, x = 0, y = 0) => {
  const { width, height } = card(node);
  return { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 };
};
const moveRect = (rect, dx, dy) => ({ left: rect.left + dx, right: rect.right + dx, top: rect.top + dy, bottom: rect.bottom + dy });
const unionRect = (rects) => rects.reduce((acc, rect) => ({
  left: Math.min(acc.left, rect.left), right: Math.max(acc.right, rect.right),
  top: Math.min(acc.top, rect.top), bottom: Math.max(acc.bottom, rect.bottom),
}), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });

/** Which side of its title a block opens to: right, left, down or up. */
export function sideOf(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}

/**
 * Local geometry of one section block. childrenOf: Map(id -> [card]); side:
 * where the items go ('down' for ordered maps). Items stack in series order
 * (two columns when a concept block has many); a detail (and anything under
 * it) is tucked beside its item on the outward side. Returns { offsets:
 * Map(id -> {x, y}) relative to the section centre, rects: [{id, ...rect}],
 * bounds, sectionRect }.
 */
export function sectionBlock(section, childrenOf, side = 'down', { grid = true } = {}) {
  const gap = innerGap(section.id);
  const sectionRect = rectOf(section);
  const offsets = new Map();
  const rects = [{ id: section.id, ...sectionRect }];
  const items = seriesOrder(groupOrder(childrenOf.get(section.id) || []));
  if (!items.length) return { offsets, rects, bounds: { ...sectionRect }, sectionRect, gap };
  const seen = new Set([section.id]);
  const units = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const details = [];
    const walk = (id) => {
      for (const child of seriesOrder(groupOrder(childrenOf.get(id) || []))) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        details.push(card(child));
        walk(child.id);
      }
    };
    walk(item.id);
    const own = card(item);
    const detailHeight = details.reduce((sum, detail) => sum + detail.height, 0) + Math.max(0, details.length - 1) * gap;
    const detailWidth = details.length ? Math.max(...details.map((detail) => detail.width)) : 0;
    units.push({ item: own, details, height: Math.max(own.height, detailHeight), width: own.width + (details.length ? gap + detailWidth : 0) });
  }
  const columns = grid && units.length > GRID_AFTER ? 2 : 1;
  const perColumn = Math.ceil(units.length / columns);
  const stacks = Array.from({ length: columns }, (_, index) => units.slice(index * perColumn, (index + 1) * perColumn)).filter((stack) => stack.length);
  const vertical = side === 'down' || side === 'up';
  // Lay out as if the items open downward (vertical) or rightward, then mirror.
  const columnInfo = stacks.map((stack) => {
    const itemWidth = Math.max(...stack.map((unit) => unit.item.width));
    const width = Math.max(...stack.map((unit) => unit.width - unit.item.width)) + itemWidth;
    const height = stack.reduce((sum, unit) => sum + unit.height, 0) + (stack.length - 1) * gap;
    return { stack, itemWidth, width, height };
  });
  let cursorX;
  if (vertical) {
    const total = columnInfo.reduce((sum, column) => sum + column.width, 0) + (columnInfo.length - 1) * gap;
    cursorX = columnInfo.length === 1 ? -columnInfo[0].itemWidth / 2 : -total / 2;
  } else {
    cursorX = sectionRect.right + gap;
  }
  for (const column of columnInfo) {
    const axis = cursorX + column.itemWidth / 2;
    let top = vertical ? sectionRect.bottom + gap : -column.height / 2;
    for (const unit of column.stack) {
      const x = axis + wobble(unit.item.id, 'stack-x') * 3;
      const y = top + unit.item.height / 2;
      offsets.set(unit.item.id, { x, y });
      rects.push({ id: unit.item.id, ...rectOf(unit.item, x, y) });
      let detailTop = top;
      for (const detail of unit.details) {
        const dx = x + unit.item.width / 2 + gap + detail.width / 2;
        const dy = detailTop + detail.height / 2;
        offsets.set(detail.id, { x: dx, y: dy });
        rects.push({ id: detail.id, ...rectOf(detail, dx, dy) });
        detailTop += detail.height + gap;
      }
      top += unit.height + gap;
    }
    cursorX += column.width + gap;
  }
  if (side === 'up') {
    // Same reading order (first item on top), with the stack above the section.
    const members = rects.slice(1);
    const shift = sectionRect.top - gap - Math.max(...members.map((rect) => rect.bottom));
    for (const rect of members) Object.assign(rect, moveRect(rect, 0, shift));
    for (const [id, p] of offsets) offsets.set(id, { x: p.x, y: p.y + shift });
  }
  if (side === 'left') {
    for (const rect of rects.slice(1)) Object.assign(rect, { left: -rect.right, right: -rect.left });
    for (const [id, p] of offsets) offsets.set(id, { x: -p.x, y: p.y });
  }
  for (const [id, p] of offsets) offsets.set(id, { x: clean(p.x), y: clean(p.y) });
  return { offsets, rects, bounds: unionRect(rects), sectionRect, gap };
}

/** True when a title's sections read in order (two or more share one series). */
function sectionsOrdered(sections, orientation) {
  if (orientation === 'flow') return true;
  const counts = new Map();
  for (const section of sections) {
    const key = seriesKey(section);
    if (key !== undefined) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.values()].some((count) => count > 1);
}

function layoutTree(root, childrenOf, weight, { orientation = 'radial' } = {}) {
  const placed = new Map([[root.id, { ...root, x: 0, y: 0 }]]);
  const titleRect = rectOf(root);
  const occupied = [titleRect];
  const sections = seriesOrder(groupOrder(childrenOf.get(root.id) || []));
  const commit = (block, section, x, y) => {
    placed.set(section.id, { ...section, x, y });
    for (const [id, p] of block.offsets) placed.set(id, { x: p.x + x, y: p.y + y });
    occupied.push(moveRect(block.bounds, x, y));
  };
  if (sectionsOrdered(sections, orientation)) {
    // Columns left to right under the title; the first column lines up with
    // the title's left edge, so a new section only ever adds a column.
    const rowTop = titleRect.bottom + blockGap(root.id);
    let left = titleRect.left;
    for (const section of sections) {
      const block = sectionBlock(section, childrenOf, 'down', { grid: false });
      const x = left - block.bounds.left;
      const y = rowTop - block.sectionRect.top;
      commit(block, section, x, y);
      left = x + block.bounds.right + blockGap(section.id);
    }
    return { placed, occupied };
  }
  // Concept map: sections around the title, each block opening outward.
  const total = sections.reduce((sum, section) => sum + weight(section.id), 0);
  let cursor = -Math.PI / 2;
  for (const section of sections) {
    const share = (TAU * weight(section.id)) / total;
    const angle = cursor + share / 2 + wobble(section.id, 'angle') * Math.min(.16, share * .16);
    cursor += share;
    const spread = Math.min(Math.PI / 2, share / 2);
    const blocks = new Map();
    const blockFor = (side) => {
      if (!blocks.has(side)) blocks.set(side, sectionBlock(section, childrenOf, side));
      return blocks.get(side);
    };
    const gap = blockGap(section.id);
    const reach = ((wobble(section.id, 'reach') + 1) / 2) * 24;
    let best = null;
    let bestRing = Infinity;
    for (let ring = 0; ring < RINGS && ring <= bestRing + EXTRA_RINGS; ring += 1) {
      for (const offset of OFFSETS) {
        const theta = angle + offset * spread;
        const distance = clearance(root, { ...section, space: 0 }, theta) + LINK + reach + ring * STEP;
        const x = Math.cos(theta) * distance;
        const y = Math.sin(theta) * distance;
        const block = blockFor(sideOf(x, y));
        const bounds = moveRect(block.bounds, x, y);
        if (occupied.some((other) => overlaps(bounds, other, gap))) continue;
        const score = distance + ANGLE_COST * Math.abs(offset * spread);
        if (!best || score < best.score - 1e-9) best = { x, y, block, score };
        bestRing = Math.min(bestRing, ring);
      }
    }
    if (!best) {
      // Pathological crowding: step straight out until the block is clear.
      for (let distance = clearance(root, section, angle) + LINK; ; distance += STEP) {
        const x = Math.cos(angle) * distance, y = Math.sin(angle) * distance;
        const block = blockFor(sideOf(x, y));
        if (!occupied.some((other) => overlaps(moveRect(block.bounds, x, y), other, gap))) { best = { x, y, block }; break; }
      }
    }
    commit(best.block, section, best.x, best.y);
  }
  return { placed, occupied };
}

/** Children lists from parent links, in input order. */
function childrenFrom(list, parent) {
  const childrenOf = new Map();
  for (const node of list) {
    if (!parent.has(node.id)) continue;
    const siblings = childrenOf.get(parent.get(node.id)) || [];
    siblings.push(node);
    childrenOf.set(parent.get(node.id), siblings);
  }
  return childrenOf;
}

/** True when some section has items (a card two parent hops below its title). */
export function hasSectionItems(nodes = []) {
  const list = nodes.filter((node) => node?.id !== undefined).map(card);
  const parent = parentLinks(list);
  return list.some((node) => parent.has(node.id) && parent.has(parent.get(node.id)));
}

/**
 * Should the live map glide into its planned arrangement? True when two cards
 * overlap, when a block member sits more than DRIFT px from its slot beside
 * its section, or (ordered maps) when a section left its column. Cards are
 * [{id, parent_id, near, kind, series, width, height, x, y}].
 */
export function needsArrangement(nodes = [], { orientation = 'radial' } = {}) {
  const list = nodes.filter((node) => node?.id !== undefined && Number.isFinite(node.x) && Number.isFinite(node.y)).map(card);
  const byId = new Map(list.map((node) => [node.id, node]));
  const boxes = list.map((node) => rectOf(node, node.x, node.y));
  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) if (overlaps(boxes[a], boxes[b], -2)) return true;
  }
  const parent = parentLinks(list);
  const childrenOf = childrenFrom(list, parent);
  const far = (id, x, y) => Math.hypot(byId.get(id).x - x, byId.get(id).y - y) > DRIFT;
  for (const title of list.filter((node) => !parent.has(node.id))) {
    const sections = seriesOrder(groupOrder(childrenOf.get(title.id) || []));
    if (!sections.length) continue;
    const ordered = sectionsOrdered(sections, orientation);
    if (ordered) {
      const tree = layoutTree({ ...title, x: 0, y: 0 }, childrenOf, () => 1, { orientation });
      for (const section of sections) {
        const p = tree.placed.get(section.id);
        if (far(section.id, title.x + p.x, title.y + p.y)) return true;
      }
    }
    for (const section of sections) {
      const block = sectionBlock(section, childrenOf, ordered ? 'down' : sideOf(section.x - title.x, section.y - title.y), { grid: !ordered });
      for (const [id, p] of block.offsets) if (far(id, section.x + p.x, section.y + p.y)) return true;
    }
  }
  return false;
}

/**
 * Live slot for a new block member (an item or detail) or a new column of an
 * ordered map, from its section's or title's current spot. Null when the card
 * is not part of a block or its slot is taken.
 */
function blockSlot(node, cards) {
  const list = [...cards.filter((item) => item.id !== node.id), card(node)];
  const links = parentLinks(list);
  if (!links.has(node.id)) return null;
  const childrenOf = childrenFrom(list, links);
  const byId = new Map(list.map((item) => [item.id, item]));
  let section = node.id;
  const seen = new Set();
  while (links.has(links.get(section)) && !seen.has(section)) { seen.add(section); section = links.get(section); }
  const title = byId.get(links.get(section));
  const sections = seriesOrder(groupOrder(childrenOf.get(title.id) || []));
  const ordered = sectionsOrdered(sections, 'radial');
  let x, y;
  if (section === node.id) {
    if (!ordered) return null;
    const tree = layoutTree({ ...title, x: 0, y: 0 }, childrenOf, () => 1);
    const p = tree.placed.get(node.id);
    x = title.x + p.x; y = title.y + p.y;
  } else {
    const anchor = byId.get(section);
    const block = sectionBlock(anchor, childrenOf, ordered ? 'down' : sideOf(anchor.x - title.x, anchor.y - title.y), { grid: !ordered });
    const p = block.offsets.get(node.id);
    if (!p) return null;
    x = anchor.x + p.x; y = anchor.y + p.y;
  }
  const box = rectOf(node, x, y);
  const others = cards.filter((item) => item.id !== node.id).map((item) => rectOf(item, item.x, item.y));
  if (others.some((other) => overlaps(box, other, 12))) {
    // Taken (the block grew or an earlier step arrived late): the nearest
    // free spot for now; the idle arrangement glides it into place.
    for (let ring = 1; ring < 40; ring += 1) {
      for (const direction of SATELLITE_DIRECTIONS) {
        const cx = x + Math.cos(direction) * ring * STEP, cy = y + Math.sin(direction) * ring * STEP;
        if (!others.some((other) => overlaps(rectOf(node, cx, cy), other, 12))) return { x: clean(cx), y: clean(cy) };
      }
    }
    return null;
  }
  return { x: clean(x), y: clean(y) };
}

/**
 * Plan a whole map. nodes: [{id, parent_id, group, kind, series, width,
 * height, space}] in arrival order. The primary topic lands on `anchor`.
 * Ordered maps (sections in a series, or orientation 'flow') put the
 * sections in columns under the title; concept maps put them around it. Each
 * section block stacks its items on its outward side. Loose cards sit beside
 * their anchor; separate topics become satellite centres around it. Returns [{id, x, y}]
 * in input order.
 */
export function planRadialLayout(nodes = [], { anchor = { x: 0, y: 0 }, orientation = 'radial' } = {}) {
  const list = [];
  const ids = new Set();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node?.id === undefined || ids.has(node.id)) continue;
    ids.add(node.id);
    list.push(card(node));
  }
  if (!list.length) return [];
  const parent = parentLinks(list);
  const childrenOf = childrenFrom(list, parent);
  const weights = new Map();
  const weight = (id) => {
    if (!weights.has(id)) weights.set(id, 1 + (childrenOf.get(id) || []).reduce((sum, child) => sum + weight(child.id), 0) * 0.85);
    return weights.get(id);
  };

  const loose = looseAnchors(list, parent);
  const roots = primaryRootFirst(list.filter((node) => !parent.has(node.id) && !loose.has(node.id)));
  const positions = new Map();
  const occupied = [];
  for (const [index, root] of roots.entries()) {
    const tree = layoutTree(root, childrenOf, weight, { orientation });
    let offset = { x: 0, y: 0 };
    if (index) {
      // Slide the whole cluster outward from the first topic until it is clear.
      const bounds = tree.occupied.reduce((acc, box) => ({
        left: Math.min(acc.left, box.left), right: Math.max(acc.right, box.right),
        top: Math.min(acc.top, box.top), bottom: Math.max(acc.bottom, box.bottom),
      }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
      let best = null;
      for (const direction of SATELLITE_DIRECTIONS) {
        for (let distance = 0; distance < 20000; distance += STEP * 2) {
          const x = Math.cos(direction) * distance;
          const y = Math.sin(direction) * distance;
          const moved = { left: bounds.left + x, right: bounds.right + x, top: bounds.top + y, bottom: bounds.bottom + y };
          if (occupied.some((box) => overlaps(moved, box, clusterGap(root.id)))) continue;
          // Wide screens: side by side reads better than stacked topics.
          const score = Math.hypot(x, y * 1.4);
          if (!best || score < best.score - 1e-9) best = { x, y, score };
          break;
        }
      }
      offset = best || { x: 0, y: 0 };
    }
    for (const [id, box] of tree.placed) positions.set(id, { x: box.x + offset.x, y: box.y + offset.y });
    for (const box of tree.occupied) occupied.push({ left: box.left + offset.x, right: box.right + offset.x, top: box.top + offset.y, bottom: box.bottom + offset.y });
  }
  // Loose cards go beside their neighbour once its cluster is placed; a card
  // whose neighbour is itself unplaced loose waits a pass, then falls back.
  let pending = list.filter((node) => loose.has(node.id));
  while (pending.length) {
    const ready = pending.filter((node) => positions.has(loose.get(node.id)));
    const batch = ready.length ? ready : [pending[0]];
    for (const node of batch) {
      const placed = list.filter((item) => positions.has(item.id)).map((item) => ({ ...item, ...positions.get(item.id) }));
      positions.set(node.id, placeRadialNode({ ...node, near: loose.get(node.id) }, placed));
    }
    pending = pending.filter((node) => !positions.has(node.id));
  }
  const ax = finite(anchor?.x);
  const ay = finite(anchor?.y);
  return list.map((node) => {
    const p = positions.get(node.id);
    return { id: node.id, x: clean(p.x + ax), y: clean(p.y + ay) };
  });
}

/**
 * Place one new card without moving any placed card. placed: [{id, x, y,
 * parent_id, group, kind, width, height, space}]. A new first-level branch
 * opens in the widest free angle around its topic (or beside its group); a
 * deeper card fans outward from its parent; a new topic becomes a satellite.
 */
export function placeRadialNode(node, placed = []) {
  const size = card(node);
  const cards = placed.map(card);
  const byId = new Map(cards.map((item) => [item.id, item]));
  if (!cards.length) return { x: 0, y: 0 };
  const parent = parentLinks(cards);
  const loose = looseAnchors(cards, parent);
  // A loose card belongs to its anchor's centre, so its illustration room
  // faces outward like a branch.
  const centreOf = (id, seen = new Set()) => {
    const root = treeRoot(id, parent);
    if (!loose.has(root) || seen.has(root)) return byId.get(root);
    seen.add(root);
    return centreOf(loose.get(root), seen);
  };
  const outwardFrom = (centre) => (x, y) => Math.atan2(y - centre.y, x - centre.x);
  // First-level section each placed card belongs to (undefined for centres and loose cards).
  const branchOf = (id) => {
    if (!parent.has(id)) return undefined;
    let cursor = id;
    const seen = new Set();
    while (parent.has(parent.get(cursor)) && !seen.has(cursor)) { seen.add(cursor); cursor = parent.get(cursor); }
    return cursor;
  };
  const occupied = cards.map((item) => {
    const centre = centreOf(item.id);
    return { ...footprint(item, item === centre ? 0 : Math.atan2(item.y - centre.y, item.x - centre.x)), branch: branchOf(item.id), series: seriesKey(item) };
  });
  let origin = byId.get(node.parent_id);
  // Items, details and the next column of an ordered map take their block slot.
  if (origin) {
    const slot = blockSlot(node, cards);
    if (slot) return slot;
  }
  const kinOf = (filter) => cards.filter((item) => item.id !== node.id && size.group && item.group === size.group && filter(item));
  // Loose: no parent arrow. Beside its `near` card, else beside the main topic
  // unless it is a separate topic (which keeps the satellite logic below).
  let beside = null;
  if (!origin && node.parent_id == null) {
    const near = node.near != null && node.near !== node.id ? byId.get(node.near) : undefined;
    const roots = cards.filter((item) => !parent.has(item.id) && !loose.has(item.id));
    const primary = cards.find((item) => item.kind === 'root') || roots[0] || cards[0];
    beside = near || (nonTopic(node.kind) ? primary : null);
  }
  const besideCentre = beside && centreOf(beside.id);
  if (beside && besideCentre && beside !== besideCentre) {
    const outwardOf = outwardFrom(besideCentre);
    const slot = findBeside({ origin: byId.get(parent.get(beside.id)) || besideCentre, anchor: beside, size, occupied, outwardOf });
    if (slot) return { x: clean(slot.x), y: clean(slot.y) };
  }
  // Beside a topic centre: open like one of its first-level branches.
  const asBranchOf = beside && besideCentre ? besideCentre : null;
  if (asBranchOf) origin = asBranchOf;

  if (!origin) {
    const centres = cards.filter((item) => !parent.has(item.id) && !loose.has(item.id));
    const primary = centres.find((item) => item.kind === 'root') || centres[0] || cards[0];
    const slot = findSatellite({ centre: primary, size, occupied, centres, kin: kinOf((item) => !parent.has(item.id)) });
    return { x: clean(slot.x), y: clean(slot.y) };
  }

  const centre = centreOf(origin.id);
  const outwardOf = outwardFrom(centre);
  const tags = {
    branch: byId.get(node.parent_id) ? (parent.has(node.parent_id) ? branchOf(node.parent_id) : node.id) : undefined,
    series: seriesKey(size),
  };
  // The next step of a series goes beside the previous step.
  if (tags.series !== undefined && byId.get(node.parent_id)) {
    const index = size.series.index ?? 0;
    const mates = cards.filter((item) => item.id !== node.id && seriesKey(item) === tags.series && (item.series.index ?? 0) < index)
      .sort((a, b) => a.series.index - b.series.index);
    const prev = mates.at(-1);
    const slot = prev && chainSlot({
      prev, before: mates.at(-2), size, occupied, outwardOf, tags,
      angle: Math.atan2(prev.y - origin.y, prev.x - origin.x),
    });
    if (slot) return { x: clean(slot.x), y: clean(slot.y) };
  }
  const isSibling = (item) => parent.get(item.id) === origin.id || (origin === centre && loose.has(item.id) && centreOf(item.id) === origin);
  const siblings = cards.filter(isSibling);
  const kin = kinOf(isSibling);
  let angle;
  let spread;
  if (origin === centre) {
    // First-level branch: aim into the widest free angle so branches balance
    // around the topic; a same-group branch opens next to its group instead.
    const around = siblings
      .map((item) => ({ angle: normalise(Math.atan2(item.y - origin.y, item.x - origin.x)), kin: kin.includes(item) }))
      .sort((a, b) => a.angle - b.angle);
    if (!around.length) {
      angle = 0;
      spread = Math.PI;
    } else {
      const gaps = around.map((from, index) => {
        const to = around[(index + 1) % around.length];
        return { from: from.angle, size: index + 1 < around.length ? to.angle - from.angle : to.angle + TAU - from.angle, fromKin: from.kin, toKin: to.kin };
      });
      const near = gaps.filter((gap) => gap.fromKin || gap.toKin);
      const pool = near.length ? near : gaps;
      const widest = pool.reduce((a, b) => (b.size > a.size + 1e-9 ? b : a));
      if (near.length) {
        const step = Math.min(widest.size / 2, 0.7);
        angle = widest.fromKin ? widest.from + step : widest.from + widest.size - step;
      } else {
        angle = widest.from + widest.size / 2;
      }
      spread = Math.min(Math.PI / 2, (widest.size / 2) * 0.85);
    }
  } else {
    angle = Math.atan2(origin.y - centre.y, origin.x - centre.x);
    spread = 1.1;
  }
  // Up to ~±12° and a bounded seeded reach; collisions are still checked.
  angle += wobble(node.id, 'angle') * .21;
  let branch = origin === centre ? node.id : origin.id;
  const climbed = new Set();
  while (parent.has(branch) && parent.get(branch) !== centre.id && !climbed.has(branch)) { climbed.add(branch); branch = parent.get(branch); }
  const reach = ringReach(branch, node.id);
  const slot = findSlot({ origin, size, angle, spread, occupied, kin, outwardOf, reach, tags });
  return { x: clean(slot.x), y: clean(slot.y) };
}
