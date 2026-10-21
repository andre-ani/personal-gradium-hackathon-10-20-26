import test from 'node:test';
import assert from 'node:assert/strict';
import { footprint, isLooseCard, overlaps, placeRadialNode, planRadialLayout, withContainsEdges } from '../frontend/radial-layout.js';

const root = (id = 'root', extra = {}) => ({ id, kind: 'root', width: 340, height: 190, ...extra });
const card = (id, parent_id, extra = {}) => ({ id, parent_id, width: 300, height: 150, ...extra });

// Footprint check including illustration room on the side away from the topic.
function assertNoOverlap(nodes, positions, centreOf = () => positions.get(nodes[0].id)) {
  const boxes = nodes.map((node) => {
    const p = positions.get(node.id);
    const centre = centreOf(node);
    const outward = p === centre ? 0 : Math.atan2(p.y - centre.y, p.x - centre.x);
    return { id: node.id, box: footprint({ ...node, ...p }, outward) };
  });
  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      assert.equal(overlaps(boxes[a].box, boxes[b].box), false, `${boxes[a].id} overlaps ${boxes[b].id}`);
    }
  }
}

const asMap = (list) => new Map(list.map(({ id, x, y }) => [id, { x, y }]));

function typicalMap(branches, { nested = 0, illustrated = false } = {}) {
  const nodes = [root()];
  for (let i = 0; i < branches; i += 1) {
    nodes.push(card(`b${i}`, 'root', { group: `g${i % 3}`, space: illustrated && i % 2 ? 200 : 0, width: 250 + (i % 3) * 50, height: 110 + (i % 4) * 25 }));
    for (let j = 0; j < nested; j += 1) nodes.push(card(`b${i}-${j}`, `b${i}`, { width: 260, height: 130, space: illustrated && j === 0 ? 200 : 0 }));
  }
  return nodes;
}

test('radial plan is deterministic and centres the main topic on the anchor', () => {
  const nodes = typicalMap(5, { nested: 2 });
  const first = planRadialLayout(nodes, { anchor: { x: 120, y: -40 } });
  const second = planRadialLayout(nodes.map((node) => ({ ...node })), { anchor: { x: 120, y: -40 } });
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((p) => p.id), nodes.map((n) => n.id));
  assert.deepEqual(asMap(first).get('root'), { x: 120, y: -40 });
});

test('typical maps (3-8 branches, nested, illustrated) never overlap', () => {
  for (let branches = 3; branches <= 8; branches += 1) {
    for (const nested of [0, 1, 3]) {
      for (const illustrated of [false, true]) {
        const nodes = typicalMap(branches, { nested, illustrated });
        assertNoOverlap(nodes, asMap(planRadialLayout(nodes)));
      }
    }
  }
});

test('first-level branches surround the topic on all sides', () => {
  const nodes = typicalMap(6, { nested: 1 });
  const p = asMap(planRadialLayout(nodes));
  const branches = nodes.filter((n) => n.parent_id === 'root').map((n) => p.get(n.id));
  assert.ok(branches.some((b) => b.x > 150) && branches.some((b) => b.x < -150), 'left and right');
  assert.ok(branches.some((b) => b.y > 100) && branches.some((b) => b.y < -100), 'top and bottom');
  const left = branches.filter((b) => b.x < 0).length;
  assert.ok(Math.abs(left - (branches.length - left)) <= 2, 'balanced left/right');
  // Angles are spread: no two first-level branches share a direction.
  const angles = branches.map((b) => Math.atan2(b.y, b.x)).sort((a, b) => a - b);
  for (let i = 1; i < angles.length; i += 1) assert.ok(angles[i] - angles[i - 1] > 0.3);
});

test('second-level cards continue outward from their branch', () => {
  const nodes = typicalMap(4, { nested: 2 });
  const p = asMap(planRadialLayout(nodes));
  for (const node of nodes.filter((n) => n.parent_id && n.parent_id !== 'root')) {
    const parent = p.get(node.parent_id);
    const child = p.get(node.id);
    assert.ok(Math.hypot(child.x, child.y) > Math.hypot(parent.x, parent.y), `${node.id} is further out`);
  }
});

test('same-group siblings stay angularly adjacent', () => {
  const groups = ['a', 'b', 'a', 'c', 'b', 'a'];
  const nodes = [root(), ...groups.map((group, i) => card(`n${i}`, 'root', { group }))];
  const p = asMap(planRadialLayout(nodes));
  const order = nodes.slice(1)
    .map((n) => ({ group: n.group, angle: Math.atan2(p.get(n.id).y, p.get(n.id).x) }))
    .sort((a, b) => a.angle - b.angle)
    .map((entry) => entry.group);
  const runs = order.filter((group, i) => group !== order[(i + order.length - 1) % order.length]).length;
  assert.equal(runs, 3, `groups contiguous around the circle: ${order.join(',')}`);
});

test('incremental placement never moves placed cards and stays clear', () => {
  const nodes = typicalMap(7, { nested: 2, illustrated: true });
  const placed = [];
  for (const node of nodes) {
    const before = placed.map((item) => ({ id: item.id, x: item.x, y: item.y }));
    const p = placeRadialNode(node, placed);
    assert.deepEqual(placed.map((item) => ({ id: item.id, x: item.x, y: item.y })), before);
    placed.push({ ...node, ...p });
  }
  assertNoOverlap(nodes, new Map(placed.map((item) => [item.id, item])));
  const again = [];
  for (const node of nodes) again.push({ ...node, ...placeRadialNode(node, again) });
  assert.deepEqual(again.map(({ x, y }) => [x, y]), placed.map(({ x, y }) => [x, y]));
});

test('incremental first-level branches balance around the topic', () => {
  const placed = [{ ...root(), x: 0, y: 0 }];
  for (let i = 0; i < 4; i += 1) placed.push({ ...card(`b${i}`, 'root'), ...placeRadialNode(card(`b${i}`, 'root'), placed) });
  const [right, left, bottom, top] = placed.slice(1);
  // Placement is deliberately a little irregular (seeded drift), so check the
  // dominant direction rather than exact compass points.
  assert.ok(right.x > Math.abs(right.y), JSON.stringify(right));
  assert.ok(-left.x > Math.abs(left.y), JSON.stringify(left));
  // The third and fourth branches fill the vertical gaps: one above, one below.
  assert.ok(Math.sign(bottom.y) !== Math.sign(top.y) && Math.abs(bottom.y) > 150 && Math.abs(top.y) > 150, JSON.stringify({ bottom, top }));
  // A same-group branch opens beside its group rather than in the widest gap.
  const kin = { ...card('kin', 'root', { group: 'g' }) };
  placed[1].group = 'g';
  const p = placeRadialNode(kin, placed);
  const angle = Math.atan2(p.y, p.x);
  assert.ok(Math.abs(angle) < Math.PI / 2, 'kin opens on the right, beside its group');
});

test('separate topics become non-overlapping satellite centres', () => {
  const nodes = [
    root('a'), card('a1', 'a'), card('a2', 'a'), card('a3', 'a'),
    root('b'), card('b1', 'b'), card('b2', 'b'),
    { id: 'c', width: 300, height: 150 }, card('c1', 'c'),
  ];
  const planned = asMap(planRadialLayout(nodes));
  const topicOf = (node) => planned.get(node.id === node.parent_id ? node.id : (node.parent_id ?? node.id));
  assertNoOverlap(nodes, planned, topicOf);
  assert.deepEqual(planned.get('a'), { x: 0, y: 0 });
  assert.ok(Math.hypot(planned.get('b').x, planned.get('b').y) > 600);

  const placed = [];
  for (const node of nodes) placed.push({ ...node, ...placeRadialNode(node, placed) });
  const live = new Map(placed.map((item) => [item.id, item]));
  assertNoOverlap(nodes, live, topicOf);
  assert.ok(Math.hypot(live.get('c').x - live.get('b').x, live.get('c').y - live.get('b').y) >= 900);
});

test('cycles and missing parents fall back to separate topics deterministically', () => {
  const nodes = [root('r'), card('x', 'y'), card('y', 'x'), card('lost', 'missing')];
  const first = planRadialLayout(nodes);
  assert.deepEqual(first, planRadialLayout(nodes));
  assert.equal(first.length, 4);
  assert.ok(first.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('loose cards get no implicit contains edge; children still do', () => {
  const nodes = [root('party'), card('food', 'party'), { id: 'lemonade', kind: 'idea', near: 'party' }, { id: 'stray', kind: 'idea', parent_id: null }];
  const edges = withContainsEdges(nodes, [{ id: 'e', source: 'party', target: 'food' }, { id: 'gone', source: 'party', target: 'missing' }]);
  assert.deepEqual(edges.map((e) => e.id), ['e']);
  assert.deepEqual(withContainsEdges(nodes, []).map((e) => e.id), ['contains:party:food']);
  assert.equal(isLooseCard(nodes[2]), true);
  assert.equal(isLooseCard(nodes[1]), false);
  assert.equal(isLooseCard({ id: 't', kind: 'topic' }), false);
});

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('a near card sits beside its anchor on the same ring, clear of everything', () => {
  const nodes = [root('party'), card('food', 'party'), card('music', 'party'), card('games', 'party'), card('cake', 'food'), { id: 'lemonade', kind: 'idea', width: 300, height: 150, near: 'food' }];
  const placed = [];
  for (const node of nodes) {
    const before = placed.map(({ id, x, y }) => ({ id, x, y }));
    placed.push({ ...node, ...placeRadialNode(node, placed) });
    assert.deepEqual(placed.slice(0, -1).map(({ id, x, y }) => ({ id, x, y })), before);
  }
  const at = new Map(placed.map((item) => [item.id, item]));
  const lemonade = at.get('lemonade');
  const food = at.get('food');
  assert.ok(dist(lemonade, food) < 650, `near its anchor: ${dist(lemonade, food)}`);
  // Roughly the anchor's ring around the topic, not a 900px satellite.
  assert.ok(Math.abs(dist(lemonade, at.get('party')) - dist(food, at.get('party'))) < 250);
  assertNoOverlap(nodes, at, (node) => at.get('party'));

  // The planner agrees: same constraints when laying out the whole map.
  const planned = asMap(planRadialLayout(nodes));
  assert.ok(dist(planned.get('lemonade'), planned.get('food')) < 650);
  assertNoOverlap(nodes, planned);
});

test('loose ideas stay by the main topic; separate topics stay satellites', () => {
  const placed = [{ ...root('party'), x: 0, y: 0 }];
  for (let i = 0; i < 3; i += 1) placed.push({ ...card(`b${i}`, 'party'), ...placeRadialNode(card(`b${i}`, 'party'), placed) });
  const nearTopic = placeRadialNode({ id: 'drink', kind: 'idea', width: 300, height: 150, near: 'party' }, placed);
  const stray = placeRadialNode({ id: 'stray', kind: 'idea', width: 300, height: 150 }, placed);
  const topic = placeRadialNode({ id: 'other', kind: 'topic', width: 300, height: 150 }, placed);
  const branchRing = Math.max(...placed.slice(1).map((item) => dist(item, placed[0])));
  for (const p of [nearTopic, stray]) assert.ok(dist(p, placed[0]) <= branchRing + 120, JSON.stringify(p));
  assert.ok(dist(topic, placed[0]) >= 760, JSON.stringify(topic));
  // A later separate topic still keeps 900px from real centres, not from loose cards.
  placed.push({ id: 'stray', kind: 'idea', width: 300, height: 150, ...stray });
  const planned = asMap(planRadialLayout([...placed, { id: 'other', kind: 'topic', width: 300, height: 150 }]));
  assertNoOverlap([...placed, { id: 'other', width: 300, height: 150 }], planned);
});
