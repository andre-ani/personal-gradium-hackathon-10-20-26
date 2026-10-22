import { AntVDagreLayout } from '@antv/g6';
import { hasSectionItems, planRadialLayout } from './radial-layout.js';

const DEFAULT_SIZE = [220, 120];
// Seeded per-card breathing room is capped so organic spacing never sprawls:
// edgeLabelSpace inserts a label rank, so Dagre's edge-to-edge rank gap is
// 2 * RANKSEP plus up to BREATH_X (80..120px).
export const BREATH_X = 40;
export const BREATH_Y = 32;
const NODESEP = 48;
const RANKSEP = 40;
/** Clear paper between packed groups: seeded per group within this range. */
export const GROUP_GAP = [90, 140];
const TARGET_ASPECT = 1.6; // the canvas is roughly 16:10

/** Deterministic value in [0, 1) for a key and salt (FNV-1a). */
export function seeded(key, salt = '') {
  let seed = 2166136261;
  for (const char of `${key}:${salt}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  seed ^= seed >>> 16; seed = Math.imul(seed, 0x85ebca6b); seed ^= seed >>> 13; seed = Math.imul(seed, 0xc2b2ae35); seed ^= seed >>> 16;
  return (seed >>> 0) / 4294967296;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function idOf(item) {
  if (item === null || item === undefined) return undefined;
  if (typeof item !== 'object') return item;
  return item.id ?? item.data?.id;
}

function dataOf(item) {
  return item?.data && typeof item.data === 'object' ? item.data : item || {};
}

function styleOf(item) {
  const nested = item?.data?.style && typeof item.data.style === 'object' ? item.data.style : {};
  const direct = item?.style && typeof item.style === 'object' ? item.style : {};
  return Object.keys(nested).length ? { ...nested, ...direct } : direct;
}

function parseSize(value, fallback = DEFAULT_SIZE) {
  if (Array.isArray(value)) {
    return [positive(value[0], fallback[0]), positive(value[1], fallback[1])];
  }
  if (value && typeof value === 'object') {
    return [
      positive(value.width ?? value[0], fallback[0]),
      positive(value.height ?? value[1], fallback[1]),
    ];
  }
  if (Number.isFinite(Number(value)) && Number(value) > 0) {
    const size = Number(value);
    return [size, size];
  }
  return fallback;
}

/**
 * Keep the layout's obstacle model in step with the paper card and its
 * illustration sidecar. The renderer still uses the card's own size; the
 * extra width/height only gives Dagre room to route around the artwork.
 */
function measuredSize(node) {
  const style = styleOf(node);
  const data = dataOf(node);
  const parsed = parseSize(style.size ?? node?.size ?? data.size);
  const width = positive(style.width ?? node?.width ?? data.width, parsed[0]);
  const height = positive(style.height ?? node?.height ?? data.height, parsed[1]);
  const illustrationSpace = Math.max(0, finite(
    style.illustrationSpace ?? node?.illustrationSpace ?? data.illustrationSpace,
    0,
  ));
  return [width + illustrationSpace, Math.max(height, illustrationSpace ? 160 : 0)];
}

function edgeEnd(edge, end) {
  return idOf(edge?.[end] ?? edge?.data?.[end]);
}

function directionOf(orientation) {
  const value = String(orientation ?? 'horizontal').toLowerCase().replace(/[_\s]+/g, '-');
  if (value === 'vertical' || value === 'v' || value === 'tb' || value === 'top-bottom') return 'TB';
  if (value === 'reverse' || value === 'reverse-horizontal' || value === 'horizontal-reverse'
    || value === 'rtl' || value === 'right-to-left' || value === 'rl') return 'RL';
  if (value === 'reverse-vertical' || value === 'vertical-reverse' || value === 'bottom-top' || value === 'bt') return 'BT';
  return 'LR';
}

function compactOf(orientation) {
  const value = String(orientation ?? '').toLowerCase().replace(/[_\s]+/g, '-');
  return value === 'compact' || value === 'dense';
}

function pointOf(value, dx = 0, dy = 0) {
  if (Array.isArray(value)) {
    const x = finite(value[0], NaN), y = finite(value[1], NaN);
    return Number.isFinite(x) && Number.isFinite(y) ? [x + dx, y + dy] : null;
  }
  const x = finite(value?.x, NaN), y = finite(value?.y, NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? [x + dx, y + dy] : null;
}

function rootOf(records, edges) {
  const incoming = new Set();
  for (const edge of edges) incoming.add(edge.target);
  return records.find(record => record.kind === 'root')
    || records.find(record => record.topicRole === 'main' && !incoming.has(record.id))
    || records.find(record => !incoming.has(record.id))
    || records[0];
}

function emptyPlan() {
  return { nodes: [], edges: [] };
}

/**
 * Compute a deterministic process arrangement with G6's native AntV Dagre
 * implementation. The optional fourth argument is intentionally tiny: it
 * lets callers abandon a stale request after the async layout promise settles
 * without making the planner depend on an AbortController implementation.
 */
async function planSingleLayout(nodes = [], edges = [], orientation = 'horizontal', { isCurrent } = {}) {
  if (typeof isCurrent === 'function' && !isCurrent()) return emptyPlan();

  const records = [];
  const byId = new Map();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const id = idOf(node);
    if (id === undefined || byId.has(id)) continue;
    const style = styleOf(node);
    const data = dataOf(node);
    const [width, height] = measuredSize(node);
    const record = {
      id,
      node,
      index: records.length,
      kind: node?.kind ?? data.kind,
      topicRole: node?.topicRole ?? data.topicRole,
      width,
      height,
      x: finite(style.x ?? node?.x ?? data.x),
      y: finite(style.y ?? node?.y ?? data.y),
    };
    records.push(record);
    byId.set(id, record);
  }
  if (!records.length) return emptyPlan();

  const layoutEdges = [];
  const seenEdgeIds = new Set();
  for (const edge of Array.isArray(edges) ? edges : []) {
    const source = edgeEnd(edge, 'source');
    const target = edgeEnd(edge, 'target');
    const id = idOf(edge);
    if (id === undefined || seenEdgeIds.has(id) || !byId.has(source) || !byId.has(target) || source === target) continue;
    seenEdgeIds.add(id);
    layoutEdges.push({ id, source, target });
  }

  const direction = directionOf(orientation);
  const compact = compactOf(orientation);
  const nodeOrder = records.map(record => record.id);
  // Vary reserved breathing room before Dagre runs so spacing feels organic
  // while its collision checks and routed waypoints remain consistent.
  const measuredById = new Map(records.map(record => [record.id,
    [record.width + seeded(record.id, 'x') * BREATH_X, record.height + seeded(record.id, 'y') * BREATH_Y]]));
  const layoutNodes = records.map(record => ({
    ...record.node,
    id: record.id,
    style: {
      ...styleOf(record.node),
      size: [record.width, record.height],
      x: record.x,
      y: record.y,
    },
  }));
  const root = rootOf(records, layoutEdges);
  const layout = new AntVDagreLayout({
    rankdir: direction,
    ranker: 'tight-tree',
    nodeOrder,
    nodeSize: node => measuredById.get(idOf(node)) || measuredSize(node),
    nodesep: compact ? 28 : NODESEP,
    ranksep: compact ? 44 : RANKSEP,
    // AntV Dagre only emits routed control points when this is enabled.
    edgeLabelSpace: true,
    controlPoints: true,
  });

  const positions = new Map();
  const routedEdges = new Map();
  try {
    await layout.execute({ nodes: layoutNodes, edges: layoutEdges });
    if (typeof isCurrent === 'function' && !isCurrent()) return emptyPlan();
    layout.forEachNode(node => {
      const x = finite(node.x, NaN), y = finite(node.y, NaN);
      if (Number.isFinite(x) && Number.isFinite(y)) positions.set(node.id, { x, y });
    });
    layout.forEachEdge(edge => {
      const controlPoints = Array.isArray(edge.points)
        ? edge.points.map(point => pointOf(point)).filter(Boolean)
        : [];
      routedEdges.set(edge.id, controlPoints);
    });
  } finally {
    layout.destroy?.();
  }

  const rootPosition = positions.get(root.id);
  const dx = rootPosition ? root.x - rootPosition.x : 0;
  const dy = rootPosition ? root.y - rootPosition.y : 0;
  const plannedNodes = records.map(record => {
    const position = positions.get(record.id);
    return {
      id: record.id,
      style: {
        x: position ? position.x + dx : record.x,
        y: position ? position.y + dy : record.y,
      },
    };
  });
  const plannedEdges = layoutEdges.map(edge => ({
    id: edge.id,
    style: {
      controlPoints: (routedEdges.get(edge.id) || []).map(point => [point[0] + dx, point[1] + dy]),
      router: false,
    },
  }));
  return { nodes: plannedNodes, edges: plannedEdges };
}




const isContainment = edge => String(idOf(edge)).startsWith('contains:') || (edge?.label ?? edge?.data?.label) === 'contains';

function boundsOf(boxes) {
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const box of boxes) {
    bounds.left = Math.min(bounds.left, box.x - box.width / 2);
    bounds.right = Math.max(bounds.right, box.x + box.width / 2);
    bounds.top = Math.min(bounds.top, box.y - box.height / 2);
    bounds.bottom = Math.max(bounds.bottom, box.y + box.height / 2);
  }
  return bounds;
}

const shift = (bounds, dx, dy) => ({ left: bounds.left + dx, right: bounds.right + dx, top: bounds.top + dy, bottom: bounds.bottom + dy });
const apart = (a, b, gap) => a.right + gap <= b.left || b.right + gap <= a.left || a.bottom + gap <= b.top || b.bottom + gap <= a.top;

// Liang-Barsky: does the segment a-b pass through the box?
function segmentHits(a, b, box) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - box.left], [dx, box.right - a.x], [-dy, a.y - box.top], [dy, box.bottom - a.y]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Union-find with the earliest input index as representative, so groups and
 * their order are deterministic.
 */
function unionFind(ids) {
  const index = new Map(ids.map((id, i) => [id, i]));
  const parent = new Map(ids.map(id => [id, id]));
  const find = id => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== root) { const next = parent.get(id); parent.set(id, root); id = next; }
    return root;
  };
  const union = (a, b) => {
    if (!parent.has(a) || !parent.has(b)) return;
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (index.get(ra) < index.get(rb)) parent.set(rb, ra); else parent.set(ra, rb);
  };
  const sets = () => {
    const out = new Map();
    for (const id of ids) {
      const root = find(id);
      if (!out.has(root)) out.set(root, []);
      out.get(root).push(id);
    }
    return [...out.values()];
  };
  return { find, union, sets };
}

/**
 * Split cards into arrangement groups. records: [{id, parent, near}] in input
 * order; edges: [{id, source, target, containment}].
 * - Non-flow orientations: plain connected components.
 * - Flow: topic maps (containment: parent_id, contains edges, near). A flow
 *   edge touching a card that is not part of a larger map joins it to that
 *   map (a process chain hanging off a hub). A flow edge between two real
 *   maps stays a cross link, and the packer keeps those maps adjacent.
 * Returns { groups: [[id]], crossLinks: [edge] }.
 */
export function partitionGroups(records, edges, { flow = false } = {}) {
  const ids = records.map(record => record.id);
  const known = new Set(ids);
  const sets = unionFind(ids);
  for (const record of records) {
    if (known.has(record.parent)) sets.union(record.id, record.parent);
    if (known.has(record.near)) sets.union(record.id, record.near);
  }
  const links = edges.filter(edge => known.has(edge.source) && known.has(edge.target) && edge.source !== edge.target);
  for (const edge of links) if (!flow || edge.containment) sets.union(edge.source, edge.target);
  if (flow) {
    const mapSize = new Map();
    for (const id of ids) mapSize.set(sets.find(id), (mapSize.get(sets.find(id)) || 0) + 1);
    const sizeOf = id => mapSize.get(sets.find(id));
    const trivial = new Set(ids.filter(id => sizeOf(id) === 1));
    for (const edge of links) {
      if (!edge.containment && (trivial.has(edge.source) || trivial.has(edge.target))) sets.union(edge.source, edge.target);
    }
  }
  const groups = sets.sets();
  const crossLinks = links.filter(edge => sets.find(edge.source) !== sets.find(edge.target));
  return { groups, crossLinks };
}

/**
 * Pack laid-out groups without overlap. groups: [{key, boxes: [{id, x, y,
 * width, height}]}]; group 0 stays fixed. links: [{source, target}] card ids
 * joining different groups. Each next group (most links to placed groups
 * first) tries every side of every placed group, aligned to edges, centres
 * or its linked partner, and keeps the candidate with the best mix of
 * overall aspect (near 16:10), compactness, short cross links and no link
 * passing through a third group. Returns [{dx, dy}] per group.
 */
export function packGroups(groups, links = [], { aspect = TARGET_ASPECT } = {}) {
  if (!groups.length) return [];
  const info = groups.map(group => ({ key: group.key, bounds: boundsOf(group.boxes) }));
  const owner = new Map(), centre = new Map();
  groups.forEach((group, index) => group.boxes.forEach(box => { owner.set(box.id, index); centre.set(box.id, box); }));
  const cross = links
    .map(link => ({ s: link.source, t: link.target, a: owner.get(link.source), b: owner.get(link.target) }))
    .filter(link => link.a !== undefined && link.b !== undefined && link.a !== link.b);
  const offsets = new Array(groups.length);
  offsets[0] = { dx: 0, dy: 0 };
  const placed = [0];
  const placedSet = new Set(placed);
  const at = id => {
    const box = centre.get(id), offset = offsets[owner.get(id)];
    return { x: box.x + offset.dx, y: box.y + offset.dy };
  };
  const moved = index => shift(info[index].bounds, offsets[index].dx, offsets[index].dy);
  while (placed.length < groups.length) {
    let next = -1, linked = -1;
    for (let index = 0; index < groups.length; index += 1) {
      if (placedSet.has(index)) continue;
      const count = cross.filter(link => (link.a === index && placedSet.has(link.b)) || (link.b === index && placedSet.has(link.a))).length;
      if (count > linked) { linked = count; next = index; }
    }
    const own = info[next].bounds;
    const gap = GROUP_GAP[0] + seeded(info[next].key, 'gap') * (GROUP_GAP[1] - GROUP_GAP[0]);
    const mine = cross
      .filter(link => (link.a === next && placedSet.has(link.b)) || (link.b === next && placedSet.has(link.a)))
      .map(link => (link.a === next ? { mine: link.s, other: link.t } : { mine: link.t, other: link.s }));
    const settled = cross.filter(link => placedSet.has(link.a) && placedSet.has(link.b));
    const placedBounds = placed.map(moved);
    const total = placedBounds.reduce((acc, b) => ({
      left: Math.min(acc.left, b.left), right: Math.max(acc.right, b.right),
      top: Math.min(acc.top, b.top), bottom: Math.max(acc.bottom, b.bottom),
    }));
    const candidates = [];
    const sides = (b) => {
      const alignY = [b.top - own.top, (b.top + b.bottom - own.top - own.bottom) / 2, b.bottom - own.bottom,
        ...mine.map(link => at(link.other).y - centre.get(link.mine).y)];
      const alignX = [b.left - own.left, (b.left + b.right - own.left - own.right) / 2, b.right - own.right,
        ...mine.map(link => at(link.other).x - centre.get(link.mine).x)];
      for (const dy of alignY) candidates.push({ dx: b.right + gap - own.left, dy }, { dx: b.left - gap - own.right, dy });
      for (const dx of alignX) candidates.push({ dx, dy: b.bottom + gap - own.top }, { dx, dy: b.top - gap - own.bottom });
    };
    placedBounds.forEach(sides);
    sides(total); // always yields a free spot beside everything
    let best = null;
    for (const candidate of candidates) {
      const box = shift(own, candidate.dx, candidate.dy);
      if (!placedBounds.every(other => apart(box, other, GROUP_GAP[0] - 1e-6))) continue;
      const width = Math.max(total.right, box.right) - Math.min(total.left, box.left);
      const height = Math.max(total.bottom, box.bottom) - Math.min(total.top, box.top);
      let length = 0, crossings = 0;
      for (const link of mine) {
        const from = centre.get(link.mine), to = at(link.other);
        const a = { x: from.x + candidate.dx, y: from.y + candidate.dy };
        length += Math.hypot(a.x - to.x, a.y - to.y);
        placed.forEach((index, i) => { if (index !== owner.get(link.other) && segmentHits(a, to, placedBounds[i])) crossings += 1; });
      }
      for (const link of settled) if (segmentHits(at(link.s), at(link.t), box)) crossings += 1;
      const score = Math.sqrt(width * height) * (1 + Math.abs(Math.log(width / height / aspect)))
        + 1.2 * length + 600 * crossings;
      if (!best || score < best.score - 1e-6) best = { ...candidate, score };
    }
    offsets[next] = { dx: best.dx, dy: best.dy };
    placed.push(next);
    placedSet.add(next);
  }
  return offsets;
}

function readRecords(nodes) {
  const records = [];
  const seen = new Set();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const id = idOf(node);
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const style = styleOf(node), data = dataOf(node);
    const [width, height] = measuredSize(node);
    records.push({
      id, node, index: records.length,
      kind: node?.kind ?? data.kind,
      topicRole: node?.topicRole ?? data.topicRole,
      parent: node?.parent_id ?? data.parent_id,
      near: node?.near ?? data.near,
      group: node?.group ?? data.group,
      series: node?.series ?? data.series,
      width, height,
      x: finite(style.x ?? node?.x ?? data.x),
      y: finite(style.y ?? node?.y ?? data.y),
    });
  }
  return records;
}

function readEdges(edges, known) {
  const out = [];
  const seen = new Set();
  for (const edge of Array.isArray(edges) ? edges : []) {
    const id = idOf(edge), source = edgeEnd(edge, 'source'), target = edgeEnd(edge, 'target');
    if (id === undefined || seen.has(id) || !known.has(source) || !known.has(target) || source === target) continue;
    seen.add(id);
    out.push({ id, source, target, containment: isContainment(edge) });
  }
  return out;
}

const toMap = plan => new Map(plan.nodes.map(node => [node.id, { x: node.style.x, y: node.style.y }]));

function radialPositions(cards, orientation = 'radial') {
  const planned = planRadialLayout(cards.map(card => ({ ...card, space: 0 })), { orientation });
  return new Map(planned.map(node => [node.id, { x: node.x, y: node.y }]));
}

/**
 * Lay out one group. Flow groups split into process blocks (components over
 * flow edges, arranged by Dagre so rank order reads) and conceptual cards
 * (arranged radially by containment). Each block joins the radial map as one
 * large card hung from its containment parent, then expands in place.
 * Returns { positions: Map, edges } anchored so the group's root keeps its
 * current position, or null when the request went stale.
 */
async function layoutGroup(group, allEdges, orientation, flow, options) {
  const ids = new Set(group.map(record => record.id));
  const links = allEdges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  const dagre = async (members, memberLinks) => {
    const plan = await planSingleLayout(members.map(record => record.node), memberLinks, orientation, options);
    if (options.isCurrent && !options.isCurrent()) return null;
    return plan;
  };
  let positions, edges = [];
  const process = links.filter(edge => !edge.containment);
  const containmentParent = new Map();
  for (const record of group) if (ids.has(record.parent) && record.parent !== record.id) containmentParent.set(record.id, record.parent);
  for (const edge of links) if (edge.containment && !containmentParent.has(edge.target)) containmentParent.set(edge.target, edge.source);
  const blockSets = unionFind(group.map(record => record.id));
  for (const edge of process) blockSets.union(edge.source, edge.target);
  const touched = new Set(process.flatMap(edge => [edge.source, edge.target]));
  const blocks = blockSets.sets().filter(set => set.length > 1 || touched.has(set[0]));
  // A card joined only by a process edge hangs from that edge's source.
  const fedBy = new Map();
  for (const edge of process) if (!fedBy.has(edge.target)) fedBy.set(edge.target, edge.source);
  const asCard = record => ({
    id: record.id, parent_id: containmentParent.get(record.id) ?? (record.near == null ? fedBy.get(record.id) : undefined), near: record.near,
    group: record.group, series: record.series, kind: record.kind, width: record.width, height: record.height,
  });
  // A flow map with sections and items: the title on top, sections as
  // columns in order, each section's items stacked beneath it.
  const sectioned = flow && hasSectionItems(group.map(record => ({ ...asCard(record), parent_id: containmentParent.get(record.id) })));
  if (sectioned) {
    positions = radialPositions(group.map(asCard), 'flow');
  } else if (!flow || (blocks.length === 1 && blocks[0].length === group.length)) {
    const plan = await dagre(group, links);
    if (!plan) return null;
    positions = toMap(plan); edges = plan.edges;
  } else if (!blocks.length) {
    positions = radialPositions(group.map(asCard));
  } else {
    const byId = new Map(group.map(record => [record.id, record]));
    const blockOf = new Map();
    blocks.forEach((set, index) => set.forEach(id => blockOf.set(id, index)));
    const keyOf = index => `\u0000block:${index}`;
    const superOf = id => (id === undefined || id === null ? undefined : blockOf.has(id) ? keyOf(blockOf.get(id)) : id);
    const plans = [];
    for (const set of blocks) {
      const members = set.map(id => byId.get(id));
      const memberLinks = links.filter(edge => set.includes(edge.source) && set.includes(edge.target));
      const plan = await dagre(members, memberLinks);
      if (!plan) return null;
      const local = toMap(plan);
      const bounds = boundsOf(members.map(record => ({ ...record, ...local.get(record.id) })));
      plans.push({ plan, local, bounds });
    }
    const cards = [], emitted = new Set();
    for (const record of group) {
      const key = superOf(record.id);
      if (emitted.has(key)) continue;
      emitted.add(key);
      const outside = (pick) => {
        for (const id of blockOf.has(record.id) ? blocks[blockOf.get(record.id)] : [record.id]) {
          const target = superOf(pick(id));
          if (target !== undefined && target !== key && (ids.has(pick(id)))) return target;
        }
        return undefined;
      };
      const parent_id = outside(id => containmentParent.get(id));
      const near = outside(id => byId.get(id).near);
      if (!blockOf.has(record.id)) {
        cards.push({ id: key, parent_id, near, group: record.group, series: record.series, kind: record.kind, width: record.width, height: record.height });
      } else {
        const { bounds } = plans[blockOf.get(record.id)];
        const members = blocks[blockOf.get(record.id)].map(id => byId.get(id));
        cards.push({ id: key, parent_id, near, kind: members.some(m => m.kind === 'root') ? 'root' : 'topic',
          width: bounds.right - bounds.left, height: bounds.bottom - bounds.top });
      }
    }
    const placedCards = radialPositions(cards);
    positions = new Map();
    for (const record of group) {
      if (!blockOf.has(record.id)) { positions.set(record.id, placedCards.get(record.id)); continue; }
      const index = blockOf.get(record.id);
      const { local, bounds } = plans[index];
      const at = placedCards.get(keyOf(index));
      const dx = at.x - (bounds.left + bounds.right) / 2, dy = at.y - (bounds.top + bounds.bottom) / 2;
      const p = local.get(record.id);
      positions.set(record.id, { x: p.x + dx, y: p.y + dy });
    }
    plans.forEach(({ plan, bounds }, index) => {
      const at = placedCards.get(keyOf(index));
      const dx = at.x - (bounds.left + bounds.right) / 2, dy = at.y - (bounds.top + bounds.bottom) / 2;
      edges.push(...offsetEdges(plan.edges, dx, dy));
    });
  }
  // Anchor the group's root to where it already is: unrelated updates keep
  // the map in place instead of re-centring it.
  const root = rootOf(group, links);
  const p = positions.get(root.id);
  const dx = p ? root.x - p.x : 0, dy = p ? root.y - p.y : 0;
  for (const [id, q] of positions) positions.set(id, { x: q.x + dx, y: q.y + dy });
  return { positions, edges: offsetEdges(edges, dx, dy), root };
}

function offsetEdges(edges, dx, dy) {
  if (!dx && !dy) return edges;
  return edges.map(edge => ({ ...edge, style: { ...edge.style,
    controlPoints: (edge.style?.controlPoints || []).map(point => [point[0] + dx, point[1] + dy]),
  } }));
}

/**
 * Plan the whole canvas. Groups (independent topic maps, and process chains
 * with the map they hang from) are laid out separately: process blocks with
 * Dagre in rank order, conceptual parts radially in 'flow' mode. Groups are
 * then packed near 16:10 with modest seeded gaps; maps joined by a cross link
 * sit side by side facing each other. The main group keeps its root in place.
 */
export async function planNativeLayout(nodes = [], edges = [], orientation = 'horizontal', options = {}) {
  if (options.isCurrent && !options.isCurrent()) return emptyPlan();
  const records = readRecords(nodes);
  if (!records.length) return emptyPlan();
  const known = new Set(records.map(record => record.id));
  const links = readEdges(edges, known);
  const flow = String(orientation).toLowerCase() === 'flow';
  const { groups, crossLinks } = partitionGroups(records, links, { flow });
  const byId = new Map(records.map(record => [record.id, record]));
  const main = rootOf(records, links);
  const mainGroup = groups.findIndex(ids => ids.includes(main.id));
  const ordered = mainGroup > 0 ? [groups[mainGroup], ...groups.slice(0, mainGroup), ...groups.slice(mainGroup + 1)] : groups;
  const laid = [];
  for (const ids of ordered) {
    const result = await layoutGroup(ids.map(id => byId.get(id)), links, orientation, flow, options);
    if (!result) return emptyPlan();
    laid.push(result);
  }
  const offsets = packGroups(laid.map(result => ({
    key: result.root.id,
    boxes: [...result.positions].map(([id, p]) => ({ id, x: p.x, y: p.y, width: byId.get(id).width, height: byId.get(id).height })),
  })), crossLinks);
  const final = new Map();
  const plannedEdges = [];
  laid.forEach((result, index) => {
    const { dx, dy } = offsets[index];
    for (const [id, p] of result.positions) final.set(id, { x: p.x + dx, y: p.y + dy });
    plannedEdges.push(...offsetEdges(result.edges, dx, dy));
  });
  return {
    nodes: records.map(record => ({ id: record.id, style: final.get(record.id) || { x: record.x, y: record.y } })),
    edges: plannedEdges,
  };
}
