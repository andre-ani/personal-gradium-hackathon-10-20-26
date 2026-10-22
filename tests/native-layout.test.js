import test from 'node:test';
import assert from 'node:assert/strict';
import { BREATH_X, GROUP_GAP, packGroups, partitionGroups, planNativeLayout } from '../frontend/native-layout.js';

const W = 260, H = 140;
const node = (id, data = {}, size = [W, H]) => ({ id, data: { id, ...data }, style: { size, x: 0, y: 0 } });
const contains = (parent, child) => ({ id: `contains:${parent}:${child}`, source: parent, target: child });
const link = (source, target) => ({ id: `${source}->${target}`, source, target });

// A topic map: root plus children, with the implicit contains edges.
function topicMap(name, children) {
  const nodes = [node(name, { kind: 'topic' })];
  const edges = [];
  for (let i = 0; i < children; i += 1) {
    nodes.push(node(`${name}${i}`, { parent_id: name }));
    edges.push(contains(name, `${name}${i}`));
  }
  return { nodes, edges };
}

const boxes = (nodes, plan) => {
  const at = new Map(plan.nodes.map(n => [n.id, n.style]));
  return nodes.map(n => ({ id: n.id, x: at.get(n.id).x, y: at.get(n.id).y, width: n.style.size[0], height: n.style.size[1] }));
};
const bounds = list => ({
  left: Math.min(...list.map(b => b.x - b.width / 2)), right: Math.max(...list.map(b => b.x + b.width / 2)),
  top: Math.min(...list.map(b => b.y - b.height / 2)), bottom: Math.max(...list.map(b => b.y + b.height / 2)),
});
const gapBetween = (a, b) => Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);

function assertNoOverlap(list) {
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i], b = list[j];
      const clear = Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2;
      assert.ok(clear, `${a.id} overlaps ${b.id}`);
    }
  }
}

test('two disconnected maps pack without overlap, with a modest gap and a pleasant aspect', async () => {
  const a = topicMap('a', 5), b = topicMap('b', 4);
  const nodes = [...a.nodes, ...b.nodes], edges = [...a.edges, ...b.edges];
  const plan = await planNativeLayout(nodes, edges, 'flow');
  const all = boxes(nodes, plan);
  assertNoOverlap(all);
  const ba = bounds(all.filter(x => x.id.startsWith('a'))), bb = bounds(all.filter(x => x.id.startsWith('b')));
  const gap = gapBetween(ba, bb);
  assert.ok(gap >= GROUP_GAP[0] - 1 && gap <= GROUP_GAP[1] + 1, `group gap ${gap}`);
  const total = bounds(all);
  const aspect = (total.right - total.left) / (total.bottom - total.top);
  assert.ok(aspect > 0.6 && aspect < 3.2, `aspect ${aspect}`); // two maps: side by side or stacked
  // The main map keeps its root where it was.
  assert.deepEqual(plan.nodes.find(n => n.id === 'a').style, { x: 0, y: 0 });
});

test('cross-linked maps sit adjacent, the link stays short and avoids other maps', async () => {
  const a = topicMap('a', 4), b = topicMap('b', 4), c = topicMap('c', 4);
  const nodes = [...a.nodes, ...b.nodes, ...c.nodes];
  const edges = [...a.edges, ...b.edges, ...c.edges, link('a2', 'c1')];
  const { groups, crossLinks } = partitionGroups(
    nodes.map(n => ({ id: n.id, parent: n.data.parent_id })),
    edges.map(e => ({ ...e, containment: e.id.startsWith('contains:') })),
    { flow: true },
  );
  assert.equal(groups.length, 3);
  assert.deepEqual(crossLinks.map(e => e.id), ['a2->c1']);

  const plan = await planNativeLayout(nodes, edges, 'flow');
  const all = boxes(nodes, plan);
  assertNoOverlap(all);
  const of = name => bounds(all.filter(x => x.id[0] === name));
  assert.ok(gapBetween(of('a'), of('c')) <= GROUP_GAP[1] + 1, 'linked maps are adjacent');
  const at = new Map(all.map(x => [x.id, x]));
  const length = Math.hypot(at.get('a2').x - at.get('c1').x, at.get('a2').y - at.get('c1').y);
  const span = of('a').right - of('a').left + of('c').right - of('c').left;
  assert.ok(length < span, `link length ${length}`);
  // The link does not pass through map b.
  const B = of('b'), p = at.get('a2'), q = at.get('c1');
  for (let t = 0; t <= 1; t += 0.02) {
    const x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t;
    assert.ok(!(x > B.left && x < B.right && y > B.top && y < B.bottom), 'link crosses map b');
  }
});

test('a hub with a hanging process chain keeps the chain in rank order', async () => {
  const hub = topicMap('hub', 3);
  const chain = ['s1', 's2', 's3', 's4'];
  const nodes = [...hub.nodes, node('s1', { parent_id: 'hub' }), node('s2'), node('s3'), node('s4')];
  const edges = [...hub.edges, contains('hub', 's1'), link('s1', 's2'), link('s2', 's3'), link('s3', 's4')];
  const plan = await planNativeLayout(nodes, edges, 'flow');
  const all = boxes(nodes, plan);
  assertNoOverlap(all);
  const at = new Map(all.map(x => [x.id, x]));
  for (let i = 1; i < chain.length; i += 1) {
    assert.ok(at.get(chain[i]).x > at.get(chain[i - 1]).x, `${chain[i]} follows ${chain[i - 1]}`);
    assert.ok(Math.abs(at.get(chain[i]).y - at.get(chain[i - 1]).y) < H, 'chain stays on one rank line');
  }
  // Conceptual children still surround the hub rather than joining the chain line.
  const hubAt = at.get('hub');
  for (const id of ['hub0', 'hub1', 'hub2']) assert.ok(Math.hypot(at.get(id).x - hubAt.x, at.get(id).y - hubAt.y) < 700, id);
});

test('layout is deterministic and anchored to the main root', async () => {
  const a = topicMap('a', 3), b = topicMap('b', 2);
  const nodes = [...a.nodes, node('p1', { parent_id: 'a' }), node('p2'), ...b.nodes];
  nodes[0].style.x = 400; nodes[0].style.y = -120;
  const edges = [...a.edges, contains('a', 'p1'), link('p1', 'p2'), ...b.edges, link('p2', 'b1')];
  const first = await planNativeLayout(nodes, edges, 'flow');
  const second = await planNativeLayout(structuredClone(nodes), structuredClone(edges), 'flow');
  assert.deepEqual(first, second);
  assert.deepEqual(first.nodes.find(n => n.id === 'a').style, { x: 400, y: -120 });
  assertNoOverlap(boxes(nodes, first));
});

test('process spacing varies per card but stays capped', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const nodes = ids.map(id => node(id));
  const edges = ids.slice(1).map((id, i) => link(ids[i], id));
  const plan = await planNativeLayout(nodes, edges, 'horizontal');
  const at = new Map(plan.nodes.map(n => [n.id, n.style]));
  const gaps = ids.slice(1).map((id, i) => at.get(id).x - at.get(ids[i]).x - W);
  for (const gap of gaps) assert.ok(gap >= 70 && gap <= 80 + BREATH_X + 1, `gap ${gap}`);
  assert.ok(new Set(gaps.map(g => Math.round(g))).size > 2, 'gaps vary');
});

test('separate process chains in a fixed direction are packed, not overlapped', async () => {
  const nodes = ['a1', 'a2', 'a3', 'b1', 'b2'].map(id => node(id));
  const edges = [link('a1', 'a2'), link('a2', 'a3'), link('b1', 'b2')];
  const plan = await planNativeLayout(nodes, edges, 'vertical');
  const all = boxes(nodes, plan);
  assertNoOverlap(all);
  const at = new Map(all.map(x => [x.id, x]));
  assert.ok(at.get('a2').y > at.get('a1').y && at.get('a3').y > at.get('a2').y);
});

test('packGroups keeps many groups near 16:10 with no overlaps', () => {
  const groups = Array.from({ length: 6 }, (_, i) => ({
    key: `g${i}`,
    boxes: [{ id: `g${i}`, x: 0, y: 0, width: 500 + (i % 3) * 120, height: 320 + (i % 2) * 90 }],
  }));
  const offsets = packGroups(groups);
  const placed = groups.map((g, i) => ({ ...g.boxes[0], x: offsets[i].dx, y: offsets[i].dy }));
  assertNoOverlap(placed);
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      assert.ok(gapBetween(bounds([placed[i]]), bounds([placed[j]])) >= GROUP_GAP[0] - 1);
    }
  }
  const total = bounds(placed);
  const aspect = (total.right - total.left) / (total.bottom - total.top);
  assert.ok(aspect > 1 && aspect < 2.4, `aspect ${aspect}`);
  assert.deepEqual(packGroups(groups), offsets);
});

test('flow maps with sections and items: title on top, sections as columns, items stacked beneath', async () => {
  const nodes = [node('t', { kind: 'topic' }, [380, 120])];
  const edges = [];
  for (const section of ['s1', 's2', 's3']) {
    nodes.push(node(section, { parent_id: 't' }, [240, 100]));
    edges.push(contains('t', section));
    for (let i = 0; i < 3; i += 1) nodes.push(node(`${section}-${i}`, { parent_id: section }, [170, 64]));
  }
  edges.push(link('s1', 's2'), link('s2', 's3'));
  const plan = await planNativeLayout(nodes, edges, 'flow');
  const all = boxes(nodes, plan);
  assertNoOverlap(all);
  const at = new Map(all.map(x => [x.id, x]));
  assert.ok(at.get('s1').x < at.get('s2').x && at.get('s2').x < at.get('s3').x, 'columns in order');
  assert.ok(at.get('t').y < at.get('s1').y && Math.abs(at.get('s1').y - at.get('s3').y) < 1, 'title above one row of sections');
  for (const section of ['s1', 's2', 's3']) {
    for (let i = 0; i < 3; i += 1) {
      const item = at.get(`${section}-${i}`);
      assert.ok(Math.abs(item.x - at.get(section).x) <= 4 && item.y > at.get(section).y, `${section}-${i} under its section`);
    }
  }
});
