import { animate } from 'motion';

const LIFT_MS = 160;
const MOVE_MS = 600;
const SETTLE_MS = 200;
const DEFAULT_SIZE = [220, 120];
const DEFAULT_PRIMARY_GAP = 92;
const DEFAULT_SECONDARY_GAP = 58;

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function idOf(item) {
  if (item === null || item === undefined) return undefined;
  if (typeof item !== 'object') return item;
  return item.id ?? item.data?.id;
}

function styleOf(item) {
  const nested = item?.data?.style && typeof item.data.style === 'object' ? item.data.style : {};
  const direct = item?.style && typeof item.style === 'object' ? item.style : {};
  return Object.keys(nested).length ? { ...nested, ...direct } : direct;
}

function dataOf(item) {
  return item?.data && typeof item.data === 'object' ? item.data : item || {};
}

function topicRoleOf(item) {
  const data = dataOf(item);
  return item?.topicRole ?? data.topicRole;
}

function parseSize(value, fallback) {
  if (Array.isArray(value)) {
    return [positiveOr(value[0], fallback[0]), positiveOr(value[1], fallback[1])];
  }
  if (value && typeof value === 'object') {
    return [
      positiveOr(value.width ?? value[0], fallback[0]),
      positiveOr(value.height ?? value[1], fallback[1]),
    ];
  }
  if (Number.isFinite(Number(value)) && Number(value) > 0) {
    const size = Number(value);
    return [size, size];
  }
  return fallback;
}

function nodeSize(node) {
  const style = styleOf(node);
  const data = dataOf(node);
  const size = style.size ?? node?.size ?? data.size;
  const parsed = parseSize(size, DEFAULT_SIZE);
  return [
    positiveOr(style.width ?? node?.width ?? data.width, parsed[0]) + Math.max(0, numberOr(style.illustrationSpace, 0)),
    Math.max(positiveOr(style.height ?? node?.height ?? data.height, parsed[1]), style.illustrationSpace ? 160 : 0),
  ];
}

function edgeEnd(edge, end) {
  const direct = edge?.[end] ?? edge?.data?.[end];
  return idOf(direct);
}

function orientationMode(orientation) {
  const value = String(orientation ?? 'horizontal').toLowerCase().replace(/[_\s]+/g, '-');
  if (value === 'vertical' || value === 'v' || value === 'tb' || value === 'top-bottom') {
    return { axis: 'vertical', direction: 1, compact: false };
  }
  if (
    value === 'reverse'
    || value === 'reverse-horizontal'
    || value === 'horizontal-reverse'
    || value === 'rtl'
    || value === 'right-to-left'
  ) {
    return { axis: 'horizontal', direction: -1, compact: false };
  }
  if (value === 'compact' || value === 'dense') {
    return { axis: 'horizontal', direction: 1, compact: true };
  }
  return { axis: 'horizontal', direction: 1, compact: false };
}

function currentAnchor(records) {
  if (!records.length) return [0, 0];
  const xs = records.map((record) => record.x);
  const ys = records.map((record) => record.y);
  return [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
}

function planTopicLayout(records, rank, outgoing, incoming, mode) {
  const main = records
    .filter((record) => record.topicRole === 'main')
    .sort((left, right) => left.index - right.index);
  if (!main.length) return [];

  const anchor = main.find((record) => record.kind === 'root')
    || main.find((record) => incoming[record.index].length === 0)
    || main[0];
  const firstLevel = outgoing[anchor.index]
    .map((link) => link.target)
    .filter((index) => records[index]?.topicRole === 'main' && index !== anchor.index)
    .sort((left, right) => left - right);
  const branchRoots = firstLevel.length
    ? firstLevel
    : main.filter((record) => record.index !== anchor.index).map((record) => record.index);
  let branchCount = Math.max(1, branchRoots.length);

  // Give each node the least-cost route from a first-level topic. Primary
  // edges keep a branch together; supporting edges can cross a branch without
  // pulling its target out of the primary lane. The bounded relaxation also
  // stays safe for malformed cycles.
  const costs = Array.from({ length: branchCount }, () => Array(records.length).fill(Infinity));
  branchRoots.forEach((root, branch) => { costs[branch][root] = 0; });
  for (let pass = 0; pass < records.length; pass += 1) {
    let changed = false;
    for (let branch = 0; branch < branchCount; branch += 1) {
      for (let source = 0; source < records.length; source += 1) {
        const sourceCost = costs[branch][source];
        if (!Number.isFinite(sourceCost)) continue;
        for (const link of outgoing[source]) {
          const weight = link.priority === 'secondary' ? 3 : 1;
          const next = sourceCost + weight;
          if (next < costs[branch][link.target]) {
            costs[branch][link.target] = next;
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }

  const branchByIndex = new Map([[anchor.index, -1]]);
  for (const record of records) {
    if (record.index === anchor.index) continue;
    let branch = -1;
    let cost = Infinity;
    let parentIndex = Infinity;
    for (let candidate = 0; candidate < branchCount; candidate += 1) {
      const candidateCost = costs[candidate][record.index];
      const candidateParent = Math.min(
        ...incoming[record.index]
          .filter((link) => Number.isFinite(costs[candidate][link.source]))
          .map((link) => link.source),
        Infinity,
      );
      if (candidateCost < cost || (candidateCost === cost && candidateParent < parentIndex)) {
        cost = candidateCost;
        parentIndex = candidateParent;
        branch = candidate;
      }
    }
    if (branch < 0) {
      branch = branchCount;
      branchCount += 1;
      costs.push(Array(records.length).fill(Infinity));
    }
    branchByIndex.set(record.index, branch);
  }

  const primarySize = (record) => (mode.axis === 'horizontal' ? record.width : record.height);
  const secondarySize = (record) => (mode.axis === 'horizontal' ? record.height : record.width);
  const primaryGap = mode.compact ? 48 : DEFAULT_PRIMARY_GAP;
  const secondaryGap = mode.compact ? 30 : DEFAULT_SECONDARY_GAP + 28;
  const bandGap = mode.compact ? 36 : DEFAULT_SECONDARY_GAP + 28;
  const laneGroups = new Map();
  for (const record of records) {
    const branch = branchByIndex.get(record.index) ?? 0;
    const lane = laneGroups.get(branch) || [];
    lane.push(record);
    laneGroups.set(branch, lane);
  }
  const laneIds = [...laneGroups.keys()].filter((branch) => branch >= 0).sort((left, right) => left - right);
  if (!laneIds.length) laneIds.push(0);

  // Keep the primary axis compact. A branch owns the first slot after the
  // anchor, then wraps into another secondary band instead of creating a new
  // rank column. This keeps the hierarchy readable while preserving measured
  // gaps for paper cards and illustration sidecars.
  const branchRanks = new Map(laneIds.map((branch) => [
    branch,
    [...new Set((laneGroups.get(branch) || []).map((record) => rank[record.index]))]
      .sort((left, right) => left - right),
  ]));
  const branchSlotCount = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(records.length))));
  const primarySlotCount = branchSlotCount + 1;
  const rankPlacement = new Map();
  const placementGroups = new Map();
  const primaryExtents = Array(primarySlotCount).fill(1);
  const addPlacement = (record, branch, band, slot) => {
    const placement = { record, branch, band, slot };
    rankPlacement.set(record.index, placement);
    const key = `${branch}:${band}:${slot}`;
    const group = placementGroups.get(key) || { branch, band, slot, records: [] };
    group.records.push(record);
    placementGroups.set(key, group);
    primaryExtents[slot] = Math.max(primaryExtents[slot], primarySize(record));
  };

  const anchorRecord = records.find((record) => record.index === anchor.index);
  addPlacement(anchorRecord, -1, 0, 0);
  for (const branch of laneIds) {
    const ranks = branchRanks.get(branch) || [];
    const rankIndex = new Map(ranks.map((layerRank, index) => [layerRank, index]));
    for (const record of laneGroups.get(branch) || []) {
      const localRank = rankIndex.get(rank[record.index]) ?? 0;
      const band = Math.floor(localRank / branchSlotCount);
      const slot = 1 + (localRank % branchSlotCount);
      addPlacement(record, branch, band, slot);
    }
  }

  // A malformed graph can leave an unassigned record outside the discovered
  // lanes. Keep it deterministic and inside the same bounded slot grid.
  for (const record of records) {
    if (rankPlacement.has(record.index)) continue;
    addPlacement(record, laneIds[0], 0, 1);
  }

  const bandGroups = new Map();
  for (const group of placementGroups.values()) {
    const key = `${group.branch}:${group.band}`;
    const bands = bandGroups.get(key) || { branch: group.branch, band: group.band, groups: [] };
    bands.groups.push(group);
    bandGroups.set(key, bands);
  }
  const bandExtents = new Map();
  for (const branch of laneIds) {
    const bands = [...bandGroups.values()]
      .filter((band) => band.branch === branch)
      .sort((left, right) => left.band - right.band);
    bandExtents.set(branch, bands.map((band) => Math.max(
      ...band.groups.map((group) => (
        group.records.reduce((sum, record) => sum + secondarySize(record), 0)
          + secondaryGap * Math.max(0, group.records.length - 1)
      )),
      1,
    )));
  }
  const laneExtents = laneIds.map((branch) => {
    const extents = bandExtents.get(branch) || [1];
    return extents.reduce((sum, extent) => sum + extent, 0) + bandGap * Math.max(0, extents.length - 1);
  });

  function centers(extents, gap) {
    const values = [];
    let cursor = 0;
    extents.forEach((extent, index) => {
      if (index) cursor += extents[index - 1] / 2 + gap + extent / 2;
      else cursor = extent / 2;
      values.push(cursor);
    });
    return values;
  }

  const primaryCenters = centers(primaryExtents, primaryGap);
  const laneCenters = centers(laneExtents, secondaryGap);
  const primaryCenter = (primaryCenters[0] + primaryCenters[primaryCenters.length - 1]) / 2;
  const secondaryCenter = (laneCenters[0] + laneCenters[laneCenters.length - 1]) / 2;
  const [anchorX, anchorY] = currentAnchor(records);
  const anchorPrimary = mode.axis === 'horizontal' ? anchorX : anchorY;
  const anchorSecondary = mode.axis === 'horizontal' ? anchorY : anchorX;
  const targets = new Map();

  for (const group of placementGroups.values()) {
    const primaryIndex = group.slot;
    const laneIndex = laneIds.indexOf(group.branch);
    const laneSecondary = laneIndex < 0 ? secondaryCenter : laneCenters[laneIndex];
    const branchBands = bandExtents.get(group.branch) || [];
    const branchExtent = laneIndex < 0 ? 0 : laneExtents[laneIndex];
    const bandBefore = group.band === 0
      ? 0
      : branchBands.slice(0, group.band).reduce((sum, extent) => sum + extent, 0)
        + bandGap * group.band;
    const bandOffset = laneIndex < 0 ? 0 : -branchExtent / 2 + bandBefore + (branchBands[group.band] || 1) / 2;
    const totalSecondary = group.records.reduce((sum, record) => sum + secondarySize(record), 0)
      + secondaryGap * Math.max(0, group.records.length - 1);
    let secondaryCursor = -totalSecondary / 2;
    for (const record of group.records.sort((left, right) => left.index - right.index)) {
      const secondaryOffset = secondaryCursor + secondarySize(record) / 2;
      secondaryCursor += secondarySize(record) + secondaryGap;
      const primary = anchorPrimary + mode.direction * (primaryCenters[primaryIndex] - primaryCenter);
      const secondary = anchorSecondary + laneSecondary - secondaryCenter + bandOffset + secondaryOffset;
      const x = mode.axis === 'horizontal' ? primary : secondary;
      const y = mode.axis === 'horizontal' ? secondary : primary;
      targets.set(record.id, {
        id: record.id,
        style: { x: Object.is(x, -0) ? 0 : x, y: Object.is(y, -0) ? 0 : y },
      });
    }
  }

  return records.map((record) => targets.get(record.id));
}

/**
 * Return small G6 update patches for a deterministic, dimension-aware graph.
 * Ranks are built with a bounded Kahn pass; choosing the first remaining node
 * breaks a cycle without recursion or an unbounded retry loop.
 */
export function planSketchLayout(nodes = [], edges = [], orientation = 'horizontal') {
  const mode = orientationMode(orientation);
  const records = [];
  const byId = new Map();

  for (const node of Array.isArray(nodes) ? nodes : []) {
    const id = idOf(node);
    if (id === undefined || byId.has(id)) continue;
    const style = styleOf(node);
    const data = dataOf(node);
    const [width, height] = nodeSize(node);
    const record = {
      id,
      index: records.length,
      kind: node?.kind ?? data.kind,
      topicRole: topicRoleOf(node),
      width,
      height,
      x: numberOr(style.x ?? node?.x ?? data.x, 0),
      y: numberOr(style.y ?? node?.y ?? data.y, 0),
    };
    records.push(record);
    byId.set(id, record.index);
  }

  if (!records.length) return [];

  const outgoing = records.map(() => []);
  const rankOutgoing = records.map(() => []);
  const incoming = records.map(() => []);
  const indegree = records.map(() => 0);
  const seenEdges = new Set();
  for (const edge of Array.isArray(edges) ? edges : []) {
    const source = byId.get(edgeEnd(edge, 'source'));
    const target = byId.get(edgeEnd(edge, 'target'));
    if (source === undefined || target === undefined) continue;
    const key = `${source}:${target}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    // Self edges do not add a useful rank constraint. The cycle fallback
    // below still handles a graph made entirely of self edges.
    if (source === target) continue;
    outgoing[source].push({ target, priority: edge.priority ?? edge.data?.priority });
    rankOutgoing[source].push(target);
    incoming[target].push({ source, priority: edge.priority ?? edge.data?.priority });
    indegree[target] += 1;
  }

  const rank = records.map(() => 0);
  const processed = new Set();
  const queue = records.filter((record) => indegree[record.index] === 0).map((record) => record.index);

  while (processed.size < records.length) {
    if (!queue.length) {
      const fallback = records.find((record) => !processed.has(record.index));
      if (fallback) queue.push(fallback.index);
    }
    queue.sort((a, b) => a - b);
    const source = queue.shift();
    if (source === undefined || processed.has(source)) continue;
    processed.add(source);
    for (const target of rankOutgoing[source]) {
      if (processed.has(target)) continue;
      rank[target] = Math.max(rank[target], rank[source] + 1);
      indegree[target] -= 1;
      if (indegree[target] <= 0) queue.push(target);
    }
  }

  if (records.some((record) => record.topicRole === 'main')) {
    return planTopicLayout(records, rank, outgoing, incoming, mode);
  }

  const layers = new Map();
  records.forEach((record) => {
    const layer = layers.get(rank[record.index]) || [];
    layer.push(record);
    layers.set(rank[record.index], layer);
  });
  const layerRanks = [...layers.keys()].sort((a, b) => a - b);
  const primaryGap = mode.compact ? 48 : DEFAULT_PRIMARY_GAP;
  const secondaryGap = mode.compact ? 30 : DEFAULT_SECONDARY_GAP;
  const primarySize = (record) => (mode.axis === 'horizontal' ? record.width : record.height);
  const secondarySize = (record) => (mode.axis === 'horizontal' ? record.height : record.width);
  const layerPrimarySize = (layer) => Math.max(...layer.map(primarySize), 1);
  const layerSecondarySize = (layer) => Math.max(
    layer.reduce((sum, record) => sum + secondarySize(record), 0)
      + secondaryGap * Math.max(0, layer.length - 1),
    1,
  );

  // Long chains otherwise become a very wide strip. Keep up to four rank
  // columns/rows and wrap the remaining ranks into lanes with measured cell
  // extents, so varied paper sizes still have a guaranteed gap.
  const slots = layerRanks.length <= 4
    ? layerRanks.length
    : Math.min(4, Math.max(1, Math.ceil(Math.sqrt(records.length))));
  const horizontal = mode.axis === 'horizontal';
  const columns = horizontal ? slots : Math.ceil(layerRanks.length / slots);
  const rows = horizontal ? Math.ceil(layerRanks.length / slots) : slots;
  const cells = new Map();
  layerRanks.forEach((layerRank, index) => {
    const column = horizontal ? index % columns : Math.floor(index / rows);
    const row = horizontal ? Math.floor(index / columns) : index % rows;
    cells.set(layerRank, {
      layer: layers.get(layerRank),
      column,
      row,
      primarySize: layerPrimarySize(layers.get(layerRank)),
      secondarySize: layerSecondarySize(layers.get(layerRank)),
    });
  });

  const primaryCount = horizontal ? columns : rows;
  const secondaryCount = horizontal ? rows : columns;
  const primaryExtents = Array(primaryCount).fill(1);
  const secondaryExtents = Array(secondaryCount).fill(1);
  for (const cell of cells.values()) {
    const primaryIndex = horizontal ? cell.column : cell.row;
    const secondaryIndex = horizontal ? cell.row : cell.column;
    primaryExtents[primaryIndex] = Math.max(primaryExtents[primaryIndex], cell.primarySize);
    secondaryExtents[secondaryIndex] = Math.max(secondaryExtents[secondaryIndex], cell.secondarySize);
  }

  function centers(extents, gap) {
    const values = [];
    let cursor = 0;
    extents.forEach((extent, index) => {
      if (index) cursor += extents[index - 1] / 2 + gap + extent / 2;
      else cursor = extent / 2;
      values.push(cursor);
    });
    return values;
  }

  const primaryCenters = centers(primaryExtents, primaryGap);
  const secondaryCenters = centers(secondaryExtents, secondaryGap);
  const primaryCenter = (primaryCenters[0] + primaryCenters[primaryCenters.length - 1]) / 2;
  const secondaryCenter = (secondaryCenters[0] + secondaryCenters[secondaryCenters.length - 1]) / 2;
  const [anchorX, anchorY] = currentAnchor(records);
  const anchorPrimary = mode.axis === 'horizontal' ? anchorX : anchorY;
  const anchorSecondary = mode.axis === 'horizontal' ? anchorY : anchorX;
  const targets = new Map();

  for (const layerRank of layerRanks) {
    const cell = cells.get(layerRank);
    const primaryIndex = horizontal ? cell.column : cell.row;
    const secondaryIndex = horizontal ? cell.row : cell.column;
    const totalSecondary = cell.layer.reduce((sum, record) => sum + secondarySize(record), 0)
      + secondaryGap * Math.max(0, cell.layer.length - 1);
    let secondaryCursor = -totalSecondary / 2;
    for (const record of cell.layer) {
      const secondaryOffset = secondaryCursor + secondarySize(record) / 2;
      secondaryCursor += secondarySize(record) + secondaryGap;
      const primary = anchorPrimary + mode.direction * (primaryCenters[primaryIndex] - primaryCenter);
      const secondary = anchorSecondary + secondaryCenters[secondaryIndex] - secondaryCenter + secondaryOffset;
      const x = mode.axis === 'horizontal' ? primary : secondary;
      const y = mode.axis === 'horizontal' ? secondary : primary;
      targets.set(record.id, {
        id: record.id,
        style: { x: Object.is(x, -0) ? 0 : x, y: Object.is(y, -0) ? 0 : y },
      });
    }
  }

  return records.map((record) => targets.get(record.id));
}

function graphData(graph) {
  let data;
  if (typeof graph?.getData === 'function') {
    try { data = graph.getData(); } catch { data = undefined; }
  }
  const nodes = Array.isArray(data?.nodes)
    ? data.nodes
    : (typeof graph?.getNodeData === 'function' ? graph.getNodeData() : []);
  const edges = Array.isArray(data?.edges)
    ? data.edges
    : (typeof graph?.getEdgeData === 'function' ? graph.getEdgeData() : []);
  return { nodes: Array.isArray(nodes) ? nodes : [], edges: Array.isArray(edges) ? edges : [] };
}

function nodePosition(graph, node) {
  const id = idOf(node);
  if (id !== undefined && typeof graph?.getElementPosition === 'function') {
    try {
      const position = graph.getElementPosition(id);
      if (Array.isArray(position) && Number.isFinite(Number(position[0])) && Number.isFinite(Number(position[1]))) {
        return [Number(position[0]), Number(position[1])];
      }
    } catch {
      // A node can disappear while a streamed graph update is being applied.
    }
  }
  const style = styleOf(node);
  const data = dataOf(node);
  return [
    numberOr(style.x ?? node?.x ?? data.x, 0),
    numberOr(style.y ?? node?.y ?? data.y, 0),
  ];
}

function snapshotGraph(graph) {
  const data = graphData(graph);
  return {
    nodes: data.nodes.map((node) => {
      const [x, y] = nodePosition(graph, node);
      return { ...node, style: { ...styleOf(node), x, y } };
    }),
    edges: data.edges,
  };
}

function currentIds(graph) {
  const hasSource = typeof graph?.getData === 'function' || typeof graph?.getNodeData === 'function';
  if (!hasSource) return null;
  const ids = new Set();
  for (const node of graphData(graph).nodes) {
    const id = idOf(node);
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

function drawQueue(graph) {
  let pending;
  let dirty = false;
  let error;

  const request = () => {
    dirty = true;
    if (!pending) {
      pending = (async () => {
        while (dirty) {
          dirty = false;
          await graph?.draw?.();
        }
      })().catch((reason) => { error = reason; }).finally(() => { pending = undefined; });
    }
    return pending;
  };

  const flush = async () => {
    if (pending) await pending;
    if (error) {
      const reason = error;
      error = undefined;
      throw reason;
    }
  };

  return { request, flush };
}

function animationDriver(driver) {
  return typeof driver === 'function' ? driver : animate;
}

function animateValue(driver, from, to, duration, update, job) {
  return new Promise((resolve) => {
    let controls;
    let settled = false;
    const finish = (completed) => {
      if (settled) return;
      settled = true;
      job.controls.delete(stop);
      resolve(completed);
    };
    const stop = () => {
      try { controls?.stop?.(); } finally { finish(false); }
    };
    job.controls.add(stop);
    try {
      controls = driver(from, to, {
        duration: duration / 1000,
        ease: 'easeInOut',
        onUpdate: (value) => { if (job.valid()) update(Number(value)); },
        onComplete: () => finish(true),
      });
      const completed = controls?.finished && typeof controls.finished.then === 'function'
        ? controls.finished
        : (controls && typeof controls.then === 'function' ? controls : undefined);
      if (completed) completed.then(() => finish(true), () => finish(false));
    } catch {
      finish(false);
    }
  });
}

/**
 * Animate a graph reorder without enabling G6's global render animation.
 * The optional animateDriver is intentionally undocumented for deterministic
 * tests; production uses motion.animate above.
 */
export function createSketchReorder(
  graph,
  { reducedMotion = () => false, onFinish, animateDriver } = {},
) {
  const draws = drawQueue(graph);
  let active;
  let disposed = false;
  let nextToken = 0;

  const writeStyles = (job, styles) => {
    if (!job.valid()) return;
    const ids = currentIds(graph);
    const patches = [];
    for (const [id, style] of styles) {
      if (ids && !ids.has(id)) continue;
      patches.push({ id, style });
    }
    if (!patches.length || typeof graph?.updateNodeData !== 'function') return;
    graph.updateNodeData(patches);
    draws.request();
  };

  const settleCurrent = async (job = { valid: () => !disposed }) => {
    const ids = currentIds(graph);
    if (!ids?.size) return;
    const patches = [...ids].map((id) => ({ id, style: { liftProgress: 0 } }));
    if (typeof graph?.updateNodeData === 'function') {
      graph.updateNodeData(patches);
      draws.request();
      try { await draws.flush(); } catch { if (job.valid()) throw new Error('Sketch graph draw failed while settling'); }
    }
  };

  const cancelJob = (job) => {
    if (!job) return Promise.resolve();
    if (job.cancelPromise) return job.cancelPromise;
    job.cancelled = true;
    for (const stop of [...job.controls]) stop();
    job.cancelPromise = (async () => {
      await settleCurrent({ valid: () => false });
      try { await job.done; } catch { /* cancellation is intentionally quiet */ }
      if (active === job) active = undefined;
    })();
    return job.cancelPromise;
  };

  const run = async (job, orientation) => {
    const snapshot = snapshotGraph(graph);
    const targets = planSketchLayout(snapshot.nodes, snapshot.edges, orientation);
    const targetById = new Map(targets.map((target) => [target.id, target.style]));
    const starts = new Map(snapshot.nodes.map((node) => {
      const [x, y] = nodePosition(graph, node);
      return [node.id, { x, y }];
    }));
    const driver = animationDriver(animateDriver);
    const reduced = typeof reducedMotion === 'function' ? Boolean(reducedMotion()) : Boolean(reducedMotion);
    const valid = () => active === job && !job.cancelled && !disposed;
    job.valid = valid;

    if (!targets.length) {
      if (valid() && onFinish) await onFinish([] , orientation);
      return [];
    }

    if (reduced) {
      writeStyles(job, targets.map((target) => [target.id, { ...target.style, liftProgress: 0 }]));
      await draws.flush();
      if (!valid()) return [];
      const ids = currentIds(graph);
      const finished = targets.filter((target) => !ids || ids.has(target.id));
      if (onFinish) await onFinish(finished, orientation);
      return finished;
    }

    const setLift = (value) => writeStyles(job, snapshot.nodes.map((node) => [node.id, { liftProgress: Math.max(0, Math.min(1, value)) }]));
    const setMove = (value) => {
      const progress = Math.max(0, Math.min(1, value));
      writeStyles(job, snapshot.nodes.map((node) => {
        const start = starts.get(node.id) || { x: 0, y: 0 };
        const target = targetById.get(node.id) || start;
        return [node.id, {
          x: start.x + (target.x - start.x) * progress,
          y: start.y + (target.y - start.y) * progress,
          liftProgress: 1,
        }];
      }));
    };

    setLift(0);
    await draws.flush();
    if (!valid()) return [];
    if (!await animateValue(driver, 0, 1, LIFT_MS, setLift, job) || !valid()) return [];
    setLift(1);
    await draws.flush();
    if (!valid()) return [];
    if (!await animateValue(driver, 0, 1, MOVE_MS, setMove, job) || !valid()) return [];
    setMove(1);
    await draws.flush();
    if (!valid()) return [];
    if (!await animateValue(driver, 1, 0, SETTLE_MS, setLift, job) || !valid()) return [];
    setLift(0);
    await draws.flush();
    if (!valid()) return [];
    const ids = currentIds(graph);
    const finished = targets.filter((target) => !ids || ids.has(target.id));
    if (onFinish) await onFinish(finished, orientation);
    return finished;
  };

  const api = {
    async reorder(orientation = 'horizontal') {
      if (disposed) return [];
      if (active) await cancelJob(active);
      if (disposed) return [];
      const job = {
        token: ++nextToken,
        cancelled: false,
        controls: new Set(),
        valid: () => active === job && !job.cancelled && !disposed,
        done: undefined,
        cancelPromise: undefined,
      };
      active = job;
      job.done = run(job, orientation).catch((error) => {
        if (job.cancelled || disposed) return [];
        throw error;
      }).finally(() => {
        if (active === job) active = undefined;
      });
      return job.done;
    },
    cancel() {
      return cancelJob(active);
    },
    dispose() {
      disposed = true;
      return cancelJob(active);
    },
    get busy() {
      return Boolean(active);
    },
  };

  return api;
}
