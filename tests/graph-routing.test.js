import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGraphHierarchy, paperEdgeStyle } from '../frontend/graph-hierarchy.js';
import { graphEdgeRoute } from '../frontend/graph-edge-routes.js';
import { minTurnRadius } from '../frontend/edge-geometry.js';

test('root topics and their branches receive stronger arrows than supporting details', () => {
  const nodes = [{ id: 'root', kind: 'root' }, { id: 'topic' }, { id: 'detail' }];
  const edges = [{ id: 'branch', source: 'root', target: 'topic' }, { id: 'detail', source: 'topic', target: 'detail' }];
  const roles = classifyGraphHierarchy(nodes, edges);
  assert.equal(roles.nodeRoles.get('topic'), 'main');
  assert.equal(roles.nodeRoles.get('detail'), 'supporting');
  assert.equal(roles.edgeRoles.get('branch'), 'primary');
  assert.equal(roles.edgeRoles.get('detail'), 'supporting');
  assert.ok(paperEdgeStyle('primary').lineWidth > paperEdgeStyle('supporting').lineWidth);
});

test('moving an unrelated card invalidates cached routes without changing edge data', () => {
  const nodes = [
    { id: 'source', style: { x: 0, y: 0, size: [100, 80] } },
    { id: 'obstacle', style: { x: 220, y: 0, size: [120, 100] } },
    { id: 'target', style: { x: 440, y: 0, size: [100, 80] } },
  ];
  const edges = [{ id: 'connection', source: 'source', target: 'target', style: { edgeRole: 'primary', seed: 10 } }];
  const graph = { getNodeData: () => nodes, getEdgeData: () => edges };
  const detour = graphEdgeRoute(graph, 'connection', [50, 0], [390, 0], 10);
  assert.ok(sample(detour.path).some(point => Math.abs(point[1]) > 62));
  assert.equal(graphEdgeRoute(graph, 'connection', [50, 0], [390, 0], 10), detour);
  nodes[1].style.y = 250;
  const clear = graphEdgeRoute(graph, 'connection', [50, 0], [390, 0], 10);
  assert.notEqual(clear.d, detour.d);
  assert.ok(clear.path.flatMap(segment => segment.filter((_, i) => i > 0 && i % 2 === 0)).every(y => Math.abs(y) < 20));
  assert.equal(edges[0].source, 'source');
  assert.equal(edges[0].target, 'target');
});


function sample(path, steps = 24) {
  const result = []; let start;
  for (const part of path) {
    if (part[0] === 'M') { start = part.slice(1); result.push(start); continue; }
    for (let step = 1; step <= steps; step++) {
      const t = step / steps, u = 1 - t;
      result.push([u**3*start[0]+3*u*u*t*part[1]+3*u*t*t*part[3]+t**3*part[5], u**3*start[1]+3*u*u*t*part[2]+3*u*t*t*part[4]+t**3*part[6]]);
    }
    start = part.slice(-2);
  }
  return result;
}

function assertSmooth(path) {
  for (let index = 1; index < path.length - 1; index++) {
    const a = path[index], b = path[index + 1];
    const incoming = [a[5] - a[3], a[6] - a[4]], outgoing = [b[1] - a[5], b[2] - a[6]];
    const lengthA = Math.hypot(...incoming), lengthB = Math.hypot(...outgoing);
    if (lengthA < 1e-6 || lengthB < 1e-6) continue;
    assert.ok((incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) / lengthA / lengthB > .999, 'No angular joints');
  }
}
function assertClearOfCards(points, nodes, ids) {
  for (const node of nodes) {
    if (ids.includes(node.id)) continue;
    const { x, y, size: [w, h] } = node.style;
    assert.ok(points.every(([px, py]) => !(px > x - w / 2 && px < x + w / 2 && py > y - h / 2 && py < y + h / 2)), `route crosses ${node.id}`);
  }
}
// The last segment is straight, at least 36 long and perpendicular to the side it lands on.
function assertRunIn(path, target, width, height) {
  const last = path.at(-1), end = last.slice(5, 7), before = path.at(-2).slice(-2);
  const onX = Math.abs(Math.abs(end[0] - target.x) - width / 2) < .001, onY = Math.abs(Math.abs(end[1] - target.y) - height / 2) < .001;
  assert.ok(onX || onY, 'ends on the target edge');
  const dx = end[0] - before[0], dy = end[1] - before[1];
  assert.ok(Math.hypot(dx, dy) >= 36, 'straight run-in of at least 36');
  assert.ok(onX ? Math.abs(dy) < 1e-6 : Math.abs(dx) < 1e-6, 'run-in is perpendicular to the landing side');
}
const route = (graph, id) => graphEdgeRoute(graph, id, [0, 0], [0, 0], 1);
const skipLoop = route => route.loop ? { skip: route.loop.segments } : {};

test('a parent spreads its arrows along one side, in target order, into stacked children and a skip link', () => {
  const art = { illustration: { svg: '<svg/>' } };
  const card = (id, x, y) => ({ id, data: art, style: { x, y, size: [250, 148], illustrationSpace: 168 } });
  const nodes = [card('skills', 0, 0), card('a', 550, -200), card('b', 550, 0), card('c', 550, 200), card('d', 1100, 0)];
  const edges = [['pa', 'skills', 'a'], ['pb', 'skills', 'b'], ['pc', 'skills', 'c'], ['bd', 'b', 'd'], ['skip', 'skills', 'd']]
    .map(([id, source, target]) => ({ id, source, target }));
  const graph = { getNodeData: () => nodes, getEdgeData: () => edges };
  const outgoing = ['pa', 'pb', 'pc', 'skip'].map(id => route(graph, id));
  // All leave the paper's right edge (images may sit on any side, so no art gutter) at distinct, well-spaced points.
  for (const r of outgoing) assert.equal(r.path[0][1], 125);
  const [ya, yb, yc] = outgoing.slice(0, 3).map(r => r.path[0][2]);
  assert.ok(ya < yb && yb < yc, 'attachments follow the order of their targets');
  const ys = outgoing.map(r => r.path[0][2]).sort((a, b) => a - b);
  ys.slice(1).forEach((y, index) => assert.ok(y - ys[index] >= 18, 'attachments stay at least 18 apart'));
  for (const [id, r] of [['pa', outgoing[0]], ['pb', outgoing[1]], ['pc', outgoing[2]], ['skip', outgoing[3]]]) {
    assertSmooth(r.path);
    assert.ok(minTurnRadius(r.path, skipLoop(r)) >= 36, `${id} has no tight corner`);
    assert.ok(r.path.length <= 7, `${id} is a sweep, not a staircase`);
    const edge = edges.find(e => e.id === id);
    assertClearOfCards(sample(r.path), nodes, [edge.source, edge.target]);
    const target = nodes.find(n => n.id === edge.target).style;
    if (id !== 'skip') assert.ok(Math.abs(r.path.at(-1)[5] - (target.x - 125)) < .001, `${id} lands on the left side`);
    assertRunIn(r.path, target, 250, 148);
  }
});

test('the kitchen row skip link is one smooth sweep clear of every card', () => {
  const nodes = [['jobs',0,320,190],['notice',430,280,134],['move',900,340,190],['try',1350,340,190]]
    .map(([id,x,w,h]) => ({id,style:{x,y:0,size:[w,h]}}));
  const edges = [{id:'long',source:'jobs',target:'try'},{id:'notice-move',source:'notice',target:'move'},{id:'move-try',source:'move',target:'try'}];
  const graph = {getNodeData:()=>nodes,getEdgeData:()=>edges};
  const long = route(graph, 'long');
  assert.ok(long.path.length <= 6);
  assert.ok(sample(long.path).some(point => Math.abs(point[1]) > 95));
  assertClearOfCards(sample(long.path), nodes, ['jobs', 'try']);
  for (const edge of edges) {
    const r = route(graph, edge.id);
    assertSmooth(r.path);
    assert.ok(minTurnRadius(r.path, skipLoop(r)) >= 36, `${edge.id} has no tight corner`);
  }
});

test('adding a branch keeps an existing attachment that still fits', () => {
  const nodes = [{id:'a',style:{x:0,y:0,size:[120,140]}},{id:'b',style:{x:400,y:60,size:[100,80]}},{id:'c',style:{x:400,y:-220,size:[100,80]}}];
  const edges = [{id:'old',source:'a',target:'b'}];
  const graph = {getNodeData:()=>nodes,getEdgeData:()=>edges};
  const first = route(graph, 'old');
  edges.push({id:'new',source:'a',target:'c'});
  assert.deepEqual(route(graph, 'old').path[0], first.path[0]);
  assert.ok(Math.abs(route(graph, 'new').path[0][2] - first.path[0][2]) >= 18);
});

test('a centre card spreads ordered attachments on every side toward children all around it', () => {
  const card = (id, x, y) => ({ id, style: { x, y, size: [240, 130] } });
  const nodes = [card('hub', 0, 0),
    card('r1', 520, -170), card('r2', 520, 170), card('l1', -520, -170), card('l2', -520, 170),
    card('t1', -170, -330), card('t2', 170, -330), card('b1', -170, 330), card('b2', 170, 330)];
  const edges = nodes.slice(1).map(node => ({ id: `hub-${node.id}`, source: 'hub', target: node.id }));
  const graph = { getNodeData: () => nodes, getEdgeData: () => edges };
  const sides = { r: [0, 120], l: [0, -120], t: [1, -65], b: [1, 65] };
  for (const prefix of 'rltb') {
    const [axis, edgeValue] = sides[prefix];
    const [first, second] = [1, 2].map(index => route(graph, `hub-${prefix}${index}`));
    for (const r of [first, second]) assert.ok(Math.abs(r.path[0][1 + axis] - edgeValue) < .001, `${prefix} leaves its facing side`);
    // Siblings sit in target order (1 is above/left of 2) and at least 18 apart.
    const along = r => r.path[0][2 - axis];
    assert.ok(along(second) - along(first) >= 18, `${prefix} attachments are ordered and spaced`);
  }
  for (const edge of edges) {
    const r = route(graph, edge.id);
    assertSmooth(r.path);
    assert.ok(minTurnRadius(r.path, skipLoop(r)) >= 36, `${edge.id} has no tight corner`);
    assert.ok(r.path.length <= 7, `${edge.id} is a sweep, not a staircase`);
    assertClearOfCards(sample(r.path), nodes, ['hub', edge.target]);
    const target = nodes.find(n => n.id === edge.target).style;
    assertRunIn(r.path, target, 240, 130);
  }
});

// Circumradius of nearby triples over the final stretch of a route.
function approachRadius(path, stretch) {
  const points = sample(path, 96);
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = lengths.at(-1);
  let minimum = Infinity;
  for (let i = 1; i < points.length - 1; i++) {
    if (lengths[i] < total - stretch) continue;
    const [a, b, c] = [points[i - 1], points[i], points[i + 1]];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    if (ab < .5 || bc < .5) continue;
    if (area > 1e-9) minimum = Math.min(minimum, ab * bc * ca / (4 * area));
  }
  return minimum;
}

test('an arrow arriving along the bottom of an above-left target lands straight, without a hook', () => {
  const nodes = [{ id: 'target', style: { x: 0, y: 0, size: [240, 130] } }, { id: 'source', style: { x: 260, y: 420, size: [240, 130] } }];
  const edges = [{ id: 'up', source: 'source', target: 'target' }];
  const graph = { getNodeData: () => nodes, getEdgeData: () => edges };
  const r = route(graph, 'up');
  const last = r.path.at(-1), end = last.slice(5, 7);
  assert.ok(Math.abs(end[1] - 65) < .001, 'lands on the bottom edge');
  // The final run-in is straight along the bottom side's normal (pointing up into the card).
  const heading = Math.atan2(end[1] - last[4], end[0] - last[3]);
  assert.ok(Math.abs(heading - -Math.PI / 2) < 15 * Math.PI / 180, 'final segment within 15° of the side normal');
  assertRunIn(r.path, nodes[0].style, 240, 130);
  assert.ok(approachRadius(r.path, 80) >= 60, `no tight hook in the last 80px (${approachRadius(r.path, 80).toFixed(1)})`);
  assertSmooth(r.path);
});

test('two arrows from one card to targets above and below separate at once and land on their facing sides', () => {
  const nodes = [{ id: 'hub', style: { x: 0, y: 0, size: [240, 130] } },
    { id: 'lights', style: { x: 400, y: -150, size: [200, 110] } }, { id: 'fairy', style: { x: 400, y: 150, size: [200, 110] } }];
  const edges = [{ id: 'up', source: 'hub', target: 'lights' }, { id: 'down', source: 'hub', target: 'fairy' }];
  const graph = { getNodeData: () => nodes, getEdgeData: () => edges };
  const [up, down] = ['up', 'down'].map(id => route(graph, id));
  assert.ok(up.path[0][2] < down.path[0][2] - 18, 'distinct attachments in target order');
  // Beyond the first 20px the two curves never run together.
  const tail = path => { const points = sample(path, 48); let length = 0;
    return points.filter((point, index) => (length += index ? Math.hypot(point[0] - points[index - 1][0], point[1] - points[index - 1][1]) : 0) > 20); };
  const [a, b] = [tail(up.path), tail(down.path)];
  assert.ok(a.every(p => b.every(q => Math.hypot(p[0] - q[0], p[1] - q[1]) > 12)), 'no stacked overlap');
  for (const [r, target] of [[up, nodes[1].style], [down, nodes[2].style]]) {
    const last = r.path.at(-1);
    assert.ok(Math.abs(last[5] - (target.x - 100)) < .001, 'lands on the left (facing) side');
    const heading = Math.atan2(last[6] - last[4], last[5] - last[3]);
    assert.ok(Math.abs(heading) < 15 * Math.PI / 180, 'lands within 15° of the side normal');
    assert.ok(approachRadius(r.path, 80) >= 60, 'no late hook');
    assertSmooth(r.path);
  }
});
