import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGraphHierarchy, paperEdgeStyle } from '../frontend/graph-hierarchy.js';
import { beginEdgeRouteFreeze, endEdgeRouteFreeze, graphEdgeRoute } from '../frontend/graph-edge-routes.js';

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
const route = (graph, id) => graphEdgeRoute(graph, id, [0, 0], [0, 0], 1);


const card = (id, x, y, w = 200, h = 110) => ({ id, style: { x, y, size: [w, h] } });
const graphOf = (nodes, edges) => ({ getNodeData: () => nodes, getEdgeData: () => edges });
const onEdgeOf = (point, node) => {
  const { x, y, size: [w, h] } = node.style;
  return (Math.abs(Math.abs(point[0] - x) - w / 2) < .01 && Math.abs(point[1] - y) <= h / 2)
    || (Math.abs(Math.abs(point[1] - y) - h / 2) < .01 && Math.abs(point[0] - x) <= w / 2);
};
function crosses(a, b) {
  const s = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    const [p, q, r, t] = [a[i - 1], a[i], b[j - 1], b[j]];
    if ((s(r, t, p) > 0) !== (s(r, t, q) > 0) && (s(p, q, r) > 0) !== (s(p, q, t) > 0)) return true;
  }
  return false;
}

test('a blocking card bends the curve around it; moving it away straightens the curve', () => {
  const nodes = [card('a', 0, 0), card('block', 320, 0), card('b', 640, 0)];
  const graph = graphOf(nodes, [{ id: 'link', source: 'a', target: 'b' }]);
  const around = route(graph, 'link');
  assertClearOfCards(sample(around.path), nodes, ['a', 'b']);
  assert.ok(around.path.length <= 3, 'a bowed curve or one waypoint, never a grid detour');
  assertSmooth(around.path);
  nodes[1].style.y = 400;
  const clear = route(graph, 'link');
  assert.notEqual(clear.d, around.d);
  assert.ok(sample(clear.path).every(([, y]) => Math.abs(y) < 60), 'a gentle bow, no detour');
});

test('ends attach near the closest point between the cards, not at fixed ports', () => {
  const nodes = [card('a', 0, 0), card('up', 520, -140), card('down', 520, 160)];
  const graph = graphOf(nodes, [{ id: 'u', source: 'a', target: 'up' }, { id: 'd', source: 'a', target: 'down' }]);
  const up = route(graph, 'u'), down = route(graph, 'd');
  for (const [r, target] of [[up, nodes[1]], [down, nodes[2]]]) {
    const start = r.path[0].slice(1), end = r.path.at(-1).slice(-2);
    assert.ok(onEdgeOf(start, nodes[0]) && onEdgeOf(end, target), 'both ends sit on the card edges');
    assert.ok(start[0] > 0 && end[0] < target.style.x, 'leaves the facing side and lands on the facing side');
  }
  // Each end leans toward its partner: the upper arrow leaves higher than the lower one.
  assert.ok(up.path[0][2] < down.path[0][2]);
  assert.ok(Math.abs(up.path[0][2] - down.path[0][2]) >= 18, 'distinct, separated attachments');
  assert.ok(!crosses(up.points, down.points), 'siblings never cross');
});

test('a fan from one card to children all around it stays uncrossed and clear of cards', () => {
  const nodes = [card('hub', 0, 0, 240, 130), card('n', 0, -300), card('e', 480, -60), card('se', 420, 220), card('s', -40, 320), card('w', -480, 30)];
  const edges = nodes.slice(1).map(node => ({ id: `hub-${node.id}`, source: 'hub', target: node.id }));
  const graph = graphOf(nodes, edges);
  const routes = edges.map(edge => route(graph, edge.id));
  routes.forEach((r, i) => {
    assertSmooth(r.path);
    assertClearOfCards(sample(r.path), nodes, ['hub', edges[i].target]);
  });
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    assert.ok(!crosses(routes[i].points, routes[j].points), `${edges[i].id} and ${edges[j].id} cross`);
  }
});

test('routes are deterministic for the same layout', () => {
  const build = () => graphOf([card('a', 0, 0), card('b', 500, 120)], [{ id: 'x', source: 'a', target: 'b' }]);
  assert.equal(route(build(), 'x').d, route(build(), 'x').d);
});

test('while cards move, connectors follow them; full routing returns when they settle', () => {
  const nodes = [card('a', 0, 0), card('block', 320, 0), card('b', 640, 0)];
  const graph = graphOf(nodes, [{ id: 'link', source: 'a', target: 'b' }]);
  const settled = route(graph, 'link');
  beginEdgeRouteFreeze(graph);
  nodes[2].style.y = 200;
  const moving = route(graph, 'link');
  assert.ok(onEdgeOf(moving.path.at(-1).slice(-2), nodes[2]), 'still attached to the moving card');
  assert.notEqual(moving.d, settled.d);
  endEdgeRouteFreeze(graph);
  assertClearOfCards(sample(route(graph, 'link').path), nodes, ['a', 'b']);
});

test('the kitchen row skip link is one smooth sweep clear of every card', () => {
  const nodes = [['jobs',0,320,190],['notice',430,280,134],['move',900,340,190],['try',1350,340,190]]
    .map(([id,x,w,h]) => ({id,style:{x,y:0,size:[w,h]}}));
  const edges = [{id:'long',source:'jobs',target:'try'},{id:'notice-move',source:'notice',target:'move'},{id:'move-try',source:'move',target:'try'}];
  const graph = {getNodeData:()=>nodes,getEdgeData:()=>edges};
  const long = route(graph, 'long');
  assert.ok(long.path.length <= 3, 'one or two curves, never a staircase');
  assert.ok(sample(long.path).some(point => Math.abs(point[1]) > 95));
  assertClearOfCards(sample(long.path), nodes, ['jobs', 'try']);
  for (const edge of edges) assertSmooth(route(graph, edge.id).path);
});
