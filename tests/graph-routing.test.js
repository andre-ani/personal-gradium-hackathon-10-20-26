import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGraphHierarchy, paperEdgeStyle } from '../frontend/graph-hierarchy.js';
import { graphEdgeRoute } from '../frontend/graph-edge-routes.js';

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
  assert.ok(sample(detour.path).some(point => point[1] > 62));
  assert.equal(graphEdgeRoute(graph, 'connection', [50, 0], [390, 0], 10), detour);
  nodes[1].style.y = 250;
  const clear = graphEdgeRoute(graph, 'connection', [50, 0], [390, 0], 10);
  assert.notEqual(clear.d, detour.d);
  assert.ok(clear.path.flatMap(segment => segment.filter((_, i) => i > 0 && i % 2 === 0)).every(y => Math.abs(y) < 20));
  assert.equal(edges[0].source, 'source');
  assert.equal(edges[0].target, 'target');
});


function sample(path) {
  const result = []; let start;
  for (const part of path) {
    if (part[0] === 'M') { start = part.slice(1); result.push(start); continue; }
    for (let step = 1; step <= 24; step++) {
      const t = step / 24, u = 1 - t;
      result.push([u**3*start[0]+3*u*u*t*part[1]+3*u*t*t*part[3]+t**3*part[5], u**3*start[1]+3*u*u*t*part[2]+3*u*t*t*part[4]+t**3*part[6]]);
    }
    start = part.slice(-2);
  }
  return result;
}

test('a long skip link goes outside the four-card row instead of through notes or adjacent links', () => {
  const nodes = [['jobs',0,320,190],['notice',430,280,134],['move',900,340,190],['try',1350,340,190]]
    .map(([id,x,w,h]) => ({id,style:{x,y:0,size:[w,h]}}));
  const edges = [{id:'long',source:'jobs',target:'try'},{id:'notice-move',source:'notice',target:'move'},{id:'move-try',source:'move',target:'try'}];
  const graph = {getNodeData:()=>nodes,getEdgeData:()=>edges};
  const points = sample(graphEdgeRoute(graph,'long',[160,0],[1180,0],1).path);
  assert.ok(points.some(point => point[1] > 110));
  for (const node of nodes) {
    const {x,y,size:[w,h]} = node.style;
    assert.ok(points.every(([px,py]) => !(px > x-w/2+.01 && px < x+w/2-.01 && py > y-h/2+.01 && py < y+h/2-.01)));
  }
  const adjacent = sample(graphEdgeRoute(graph,'move-try',[1070,0],[1180,0],1).path);
  assert.ok(points.every(a => adjacent.every(b => Math.hypot(a[0]-b[0],a[1]-b[1]) > 12)));
});

test('adding a shorter branch preserves an existing attachment lane', () => {
  const nodes = [{id:'a',style:{x:0,y:0,size:[100,80]}},{id:'b',style:{x:400,y:0,size:[100,80]}},{id:'c',style:{x:250,y:-250,size:[100,80]}}];
  const edges = [{id:'old',source:'a',target:'b'}];
  const graph = {getNodeData:()=>nodes,getEdgeData:()=>edges};
  const first = graphEdgeRoute(graph,'old',[50,0],[350,0],1);
  edges.push({id:'new',source:'a',target:'c'});
  const after = graphEdgeRoute(graph,'old',[50,0],[350,0],1);
  assert.deepEqual(after.path[0],first.path[0]);
  assert.notDeepEqual(graphEdgeRoute(graph,'new',[50,0],[200,-250],1).path[0],first.path[0]);
});


function assertSmooth(path) {
  for (let index = 1; index < path.length - 1; index++) {
    const a = path[index], b = path[index + 1];
    const incoming = [a[5] - a[3], a[6] - a[4]], outgoing = [b[1] - a[5], b[2] - a[6]];
    const lengthA = Math.hypot(...incoming), lengthB = Math.hypot(...outgoing);
    if (lengthA < 1e-6 || lengthB < 1e-6) continue;
    assert.ok((incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) / lengthA / lengthB > .999, 'No angular shaft joints');
  }
}

test('long row bypass is one sweeping curve, not a staircase', () => {
  const nodes = [['jobs',0,320,190],['notice',430,280,134],['move',900,340,190],['try',1350,340,190]]
    .map(([id,x,w,h]) => ({id,style:{x,y:0,size:[w,h]}}));
  const edges = [{id:'long',source:'jobs',target:'try'},{id:'notice-move',source:'notice',target:'move'},{id:'move-try',source:'move',target:'try'}];
  const graph = {getNodeData:()=>nodes,getEdgeData:()=>edges};
  const route = graphEdgeRoute(graph,'long',[160,0],[1180,0],1);
  assert.equal(route.path.length, 2);
  assert.ok(sample(route.path).some(point => point[1] > 140));
  edges.forEach(edge => assertSmooth(graphEdgeRoute(graph,edge.id,[0,0],[0,0],1).path));
});
