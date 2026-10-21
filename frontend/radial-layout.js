// Radial mind-map placement. The main topic sits at the centre, first-level
// branches own angular sectors sized by their subtree, and deeper cards fan
// outward inside their parent's sector. Everything here is pure and
// deterministic: the same input always yields the same positions.

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
const SATELLITE_ROOM = 380;
const CLUSTER_GAP = 180; // clear paper between separate topic clusters // free paper reserved around a separate topic

/** Illustration room the live canvas keeps beside cards before art arrives. */
export const LIVE_ILLUSTRATION_RESERVE = 170;

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
  return ((hash >>> 0) / 4294967295) * 2 - 1;
}

function findSlot({ origin, size, angle, spread, occupied, kin = [], outwardOf, reach = 0 }) {
  let best = null;
  let bestRing = Infinity;
  for (let ring = 0; ring < RINGS && ring <= bestRing + EXTRA_RINGS; ring += 1) {
    for (const offset of OFFSETS) {
      if (offset && spread <= 0) continue;
      const theta = angle + offset * spread;
      const distance = clearance(origin, size, theta) + LINK + reach + ring * STEP;
      const x = origin.x + Math.cos(theta) * distance;
      const y = origin.y + Math.sin(theta) * distance;
      const box = footprint({ ...size, x, y }, outwardOf(x, y));
      if (occupied.some((other) => overlaps(box, other, GAP))) continue;
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
    const box = footprint({ ...size, x, y }, outwardOf(x, y));
    if (!occupied.some((other) => overlaps(box, other, GAP))) return { x, y, angle };
  }
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
 */
export function withContainsEdges(nodes, edges) {
  const ids = new Set(nodes.map((node) => node.id));
  // At most one arrow per pair of cards, whichever direction it was declared.
  const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const seen = new Set();
  const visible = [];
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue;
    const key = pair(edge.source, edge.target);
    if (seen.has(key)) continue;
    seen.add(key);
    visible.push(edge);
  }
  for (const node of nodes) {
    const parentId = node.parent_id;
    if (parentId === undefined || parentId === null || parentId === node.id || !ids.has(parentId)) continue;
    const key = pair(parentId, node.id);
    if (seen.has(key)) continue;
    seen.add(key);
    visible.push({ id: `contains:${parentId}:${node.id}`, source: parentId, target: node.id });
  }
  return visible;
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
        const box = footprint({ ...size, x, y }, outwardOf(x, y));
        if (occupied.some((other) => overlaps(box, other, GAP))) continue;
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

function layoutTree(root, childrenOf, weight) {
  const placed = new Map([[root.id, { ...root, x: 0, y: 0 }]]);
  const occupied = [footprint({ ...root, x: 0, y: 0 }, 0)];
  const outwardOf = (x, y) => Math.atan2(y, x);
  const sectors = new Map([[root.id, { start: -Math.PI / 2, width: TAU }]]);
  let frontier = [root];
  for (let depth = 1; frontier.length; depth += 1) {
    const next = [];
    for (const parent of frontier) {
      const children = groupOrder(childrenOf.get(parent.id) || []);
      if (!children.length) continue;
      const sector = sectors.get(parent.id);
      const total = children.reduce((sum, child) => sum + weight(child.id), 0);
      let cursor = sector.start;
      const origin = placed.get(parent.id);
      for (const child of children) {
        const share = (sector.width * weight(child.id)) / total;
        sectors.set(child.id, { start: cursor, width: share });
        const angle = cursor + share / 2;
        cursor += share;
        const kin = children
          .filter((other) => other !== child && other.group && other.group === child.group && placed.has(other.id))
          .map((other) => placed.get(other.id));
        const slot = findSlot({
          origin,
          size: child,
          angle,
          spread: depth === 1 ? share / 2 : Math.min(1.1, Math.max(0.35, share / 2)),
          occupied,
          kin,
          outwardOf,
        });
        const box = { ...child, x: slot.x, y: slot.y };
        placed.set(child.id, box);
        occupied.push(footprint(box, outwardOf(slot.x, slot.y)));
        next.push(child);
      }
    }
    frontier = next;
  }
  return { placed, occupied };
}

/**
 * Plan a whole radial map. nodes: [{id, parent_id, group, kind, width,
 * height, space}] in arrival order. The primary topic lands on `anchor`;
 * separate topics become satellite centres around it. Returns [{id, x, y}]
 * in input order.
 */
export function planRadialLayout(nodes = [], { anchor = { x: 0, y: 0 } } = {}) {
  const list = [];
  const ids = new Set();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node?.id === undefined || ids.has(node.id)) continue;
    ids.add(node.id);
    list.push(card(node));
  }
  if (!list.length) return [];
  const parent = parentLinks(list);
  const childrenOf = new Map();
  for (const node of list) {
    if (!parent.has(node.id)) continue;
    const siblings = childrenOf.get(parent.get(node.id)) || [];
    siblings.push(node);
    childrenOf.set(parent.get(node.id), siblings);
  }
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
    const tree = layoutTree(root, childrenOf, weight);
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
          if (occupied.some((box) => overlaps(moved, box, CLUSTER_GAP))) continue;
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
  const occupied = cards.map((item) => {
    const centre = centreOf(item.id);
    return footprint(item, item === centre ? 0 : Math.atan2(item.y - centre.y, item.x - centre.x));
  });
  let origin = byId.get(node.parent_id);
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
  // Up to ~±12° and +0..70px of seeded drift; collisions are still checked.
  angle += wobble(node.id, 'angle') * .21;
  const reach = (wobble(node.id, 'reach') + 1) * 35;
  const slot = findSlot({ origin, size, angle, spread, occupied, kin, outwardOf, reach });
  return { x: clean(slot.x), y: clean(slot.y) };
}
