// Heading-like hierarchy for the map: each card's level from its parent_id
// chain, its kind family, and the ordered series it belongs to. Pure and
// deterministic; the renderer and layouts read the result.

const TOPIC_KINDS = new Set(['topic', 'root']);
const present = value => value !== undefined && value !== null && value !== '';
// Labels that mean "comes after"; an unlabeled sibling link counts too.
const SEQUENCE_LABEL = /^\s*(then|next|after(wards)?|followed by|leads to|step|before|finally|and then)\b/i;

export const isContainmentEdge = edge => String(edge?.id ?? '').startsWith('contains:') || edge?.label === 'contains';

/** A non-containment edge that reads as order (unlabeled, "then", "next", ...). */
export function isSequenceEdge(edge) {
  if (!edge || isContainmentEdge(edge)) return false;
  return !present(edge.label) || SEQUENCE_LABEL.test(String(edge.label));
}

/** Kind family for card styling. */
export function cardKind(kind) {
  const value = String(kind ?? '').toLowerCase();
  if (value === 'question') return 'question';
  if (value === 'decision') return 'decision';
  if (['idea', 'note', 'tip', 'example'].includes(value)) return 'idea';
  if (['task', 'step', 'action'].includes(value)) return 'task';
  return 'topic';
}

/**
 * Level per card: a root is 1, each parent_id hop adds one. A parentless card
 * that is loose (a `near` hint or a non-topic kind) and has no children is a
 * level-3 note. Missing parents and cycles fall back to root. Map(id -> level).
 */
export function cardLevels(nodes = []) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const hasChildren = new Set(nodes.filter(node => present(node.parent_id) && node.parent_id !== node.id && byId.has(node.parent_id)).map(node => node.parent_id));
  const levels = new Map();
  const visiting = new Set();
  const levelOf = id => {
    if (levels.has(id)) return levels.get(id);
    const node = byId.get(id);
    const parent = node.parent_id;
    let level;
    if (present(parent) && parent !== id && byId.has(parent) && !visiting.has(parent)) {
      visiting.add(id);
      level = levelOf(parent) + 1;
      visiting.delete(id);
    } else {
      const loose = present(node.near) || (present(node.kind) && !TOPIC_KINDS.has(node.kind));
      level = loose && node.kind !== 'root' && !hasChildren.has(id) ? 3 : 1;
    }
    levels.set(id, level);
    return level;
  };
  for (const node of nodes) levelOf(node.id);
  // Some card is always the title: the first one if every card was loose.
  if (nodes.length && ![...levels.values()].includes(1)) levels.set(nodes[0].id, 1);
  return levels;
}

/**
 * Ordered series: siblings (same parent_id) joined by sequence edges.
 * Returns [{ key, parent, members: [id in order] }] with at least two members,
 * ordered topologically (input order breaks ties and cycles).
 */
export function detectSeries(nodes = [], edges = []) {
  const byId = new Map(nodes.map((node, index) => [node.id, { node, index }]));
  const parentOf = id => {
    const parent = byId.get(id)?.node.parent_id;
    return present(parent) && parent !== id && byId.has(parent) ? parent : undefined;
  };
  const links = edges.filter(edge => edge.source !== edge.target && byId.has(edge.source) && byId.has(edge.target)
    && parentOf(edge.source) !== undefined && parentOf(edge.source) === parentOf(edge.target) && isSequenceEdge(edge));
  const root = new Map();
  const find = id => { while (root.has(id) && root.get(id) !== id) id = root.get(id); return id; };
  for (const edge of links) {
    const a = find(edge.source), b = find(edge.target);
    if (a === b) continue;
    if (byId.get(a).index < byId.get(b).index) root.set(b, a); else root.set(a, b);
    if (!root.has(a)) root.set(a, a);
    if (!root.has(b)) root.set(b, b);
  }
  const groups = new Map();
  for (const node of nodes) {
    if (!root.has(node.id)) continue;
    const key = find(node.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node.id);
  }
  const series = [];
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const set = new Set(ids);
    const own = links.filter(edge => set.has(edge.source) && set.has(edge.target));
    const indegree = new Map(ids.map(id => [id, 0]));
    for (const edge of own) indegree.set(edge.target, indegree.get(edge.target) + 1);
    const order = [], done = new Set();
    while (order.length < ids.length) {
      let next = ids.find(id => !done.has(id) && indegree.get(id) === 0);
      if (next === undefined) next = ids.find(id => !done.has(id)); // cycle: earliest card
      done.add(next); order.push(next);
      for (const edge of own) if (edge.source === next && !done.has(edge.target)) indegree.set(edge.target, indegree.get(edge.target) - 1);
    }
    series.push({ key: `series:${parentOf(order[0])}:${order[0]}`, parent: parentOf(order[0]), members: order });
  }
  return series;
}

/**
 * Everything the renderer needs per card: level, kind family and series
 * position. Returns { cards: Map(id -> {level, kind, series}), series }.
 */
export function describeHierarchy(nodes = [], edges = []) {
  const levels = cardLevels(nodes);
  const series = detectSeries(nodes, edges);
  const position = new Map();
  for (const item of series) {
    item.members.forEach((id, index) => position.set(id, { key: item.key, index, size: item.members.length }));
  }
  const cards = new Map(nodes.map(node => [node.id, {
    level: levels.get(node.id), kind: cardKind(node.kind), series: position.get(node.id) || null,
  }]));
  for (const item of series) item.level = levels.get(item.members[0]);
  return { cards, series };
}
