import test from 'node:test';
import assert from 'node:assert/strict';
import { createSketchReorder, planSketchLayout } from '../frontend/sketch-layout.js';

function dimensions(node) {
  const size = node.style.size;
  return Array.isArray(size) ? size : [size, size];
}

function assertNoOverlap(nodes, patches) {
  const positions = new Map(patches.map((patch) => [patch.id, patch.style]));
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const a = nodes[left];
      const b = nodes[right];
      const [aw, ah] = dimensions(a);
      const [bw, bh] = dimensions(b);
      const pa = positions.get(a.id);
      const pb = positions.get(b.id);
      const overlapsX = Math.abs(pa.x - pb.x) < (aw + bw) / 2;
      const overlapsY = Math.abs(pa.y - pb.y) < (ah + bh) / 2;
      assert.equal(overlapsX && overlapsY, false, `${a.id} overlaps ${b.id}`);
    }
  }
}

function mockGraph(nodes, edges) {
  const state = {
    nodes: nodes.map((node) => ({ ...node, style: { ...node.style } })),
    edges: edges.map((edge) => ({ ...edge })),
  };
  const calls = [];
  let draws = 0;
  const graph = {
    getData() {
      return {
        nodes: state.nodes.map((node) => ({ ...node, style: { ...node.style } })),
        edges: state.edges.map((edge) => ({ ...edge })),
      };
    },
    updateNodeData(patches) {
      calls.push(patches.map((patch) => ({ id: patch.id, style: { ...patch.style } })));
      for (const patch of patches) {
        const node = state.nodes.find((item) => item.id === patch.id);
        if (node) node.style = { ...node.style, ...patch.style };
      }
    },
    async draw() {
      draws += 1;
    },
  };
  return { graph, state, calls, get draws() { return draws; } };
}

test('plans dimension-aware layers for roots, cycles, and disconnected nodes', () => {
  const nodes = [
    { id: 'root', data: { keep: 'root' }, style: { size: [120, 50], x: 30, y: 10 } },
    { id: 'wide', data: { keep: 'wide' }, style: { size: [280, 90], x: 30, y: 10 } },
    { id: 'tall', data: { keep: 'tall' }, style: { size: [70, 220], x: 30, y: 10 } },
    { id: 'cycle', data: { keep: 'cycle' }, style: { size: [130, 65], x: 30, y: 10 } },
    { id: 'orphan', data: { keep: 'orphan' }, style: { size: [90, 55], x: 30, y: 10 } },
  ];
  const edges = [
    { source: 'root', target: 'wide' },
    { source: 'wide', target: 'tall' },
    { source: 'tall', target: 'cycle' },
    { source: 'cycle', target: 'tall' },
  ];
  const result = planSketchLayout(nodes, edges);
  assert.deepEqual(result.map((patch) => patch.id), nodes.map((node) => node.id));
  assertNoOverlap(nodes, result);
  assert.ok(result.find((patch) => patch.id === 'wide').style.x > result.find((patch) => patch.id === 'root').style.x);
  assert.deepEqual(nodes[0].data, { keep: 'root' });
});

test('orientation changes the primary axis and supports reverse horizontal', () => {
  const nodes = [
    { id: 'a', style: { size: [100, 50], x: 0, y: 0 } },
    { id: 'b', style: { size: [110, 60], x: 0, y: 0 } },
    { id: 'c', style: { size: [90, 70], x: 0, y: 0 } },
  ];
  const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }];
  const horizontal = planSketchLayout(nodes, edges, 'horizontal');
  const vertical = planSketchLayout(nodes, edges, 'vertical');
  const reverse = planSketchLayout(nodes, edges, 'reverse');
  assert.ok(horizontal[2].style.x > horizontal[0].style.x);
  assert.ok(vertical[2].style.y > vertical[0].style.y);
  assert.ok(reverse[2].style.x < reverse[0].style.x);
  assert.notDeepEqual(horizontal, vertical);
});

test('wraps long chains into bounded lanes without overlap', () => {
  const nodes = Array.from({ length: 14 }, (_, index) => ({
    id: `node-${index}`,
    style: { size: [250 + (index % 3) * 18, 140 + (index % 2) * 24], x: index * 360, y: 0 },
  }));
  const edges = nodes.slice(1).map((node, index) => ({ source: nodes[index].id, target: node.id }));
  const horizontal = planSketchLayout(nodes, edges, 'horizontal');
  const vertical = planSketchLayout(nodes, edges, 'vertical');
  const span = (patches, axis) => {
    const values = patches.map((patch) => patch.style[axis]);
    return Math.max(...values) - Math.min(...values);
  };
  assertNoOverlap(nodes, horizontal);
  assertNoOverlap(nodes, vertical);
  assert.ok(span(horizontal, 'x') < 1_500);
  assert.ok(span(horizontal, 'y') < 1_000);
  assert.ok(span(vertical, 'y') < 1_500);
  assert.ok(span(vertical, 'x') < 1_200);
  assert.ok(new Set(horizontal.map((patch) => patch.style.x)).size <= 4);
  assert.ok(new Set(vertical.map((patch) => patch.style.y)).size <= 4);
});

test('keeps main topic branches in separate lanes with supporting nodes nearby', () => {
  const nodes = [
    { id: 'root', kind: 'root', topicRole: 'main', style: { size: [340, 190], x: 0, y: 0 } },
    { id: 'tea', topicRole: 'main', style: { size: [300, 150], x: 0, y: 0 } },
    { id: 'similar', topicRole: 'main', style: { size: [300, 150], x: 0, y: 0 } },
    { id: 'activity', topicRole: 'main', style: { size: [300, 150], x: 0, y: 0 } },
    { id: 'spread', topicRole: 'supporting', style: { size: [250, 148], x: 0, y: 0 } },
    { id: 'observe', topicRole: 'supporting', style: { size: [220, 110], x: 0, y: 0 } },
    { id: 'move', topicRole: 'supporting', style: { size: [260, 130], x: 0, y: 0 } },
    { id: 'compete', topicRole: 'supporting', style: { size: [250, 148], x: 0, y: 0 } },
    { id: 'week', topicRole: 'supporting', style: { size: [260, 130], x: 0, y: 0 } },
  ];
  const edges = [
    { source: 'root', target: 'tea', priority: 'primary' },
    { source: 'root', target: 'similar', priority: 'primary' },
    { source: 'root', target: 'activity', priority: 'primary' },
    { source: 'tea', target: 'spread', priority: 'primary' },
    { source: 'spread', target: 'compete' },
    { source: 'activity', target: 'observe', priority: 'primary' },
    { source: 'observe', target: 'move', priority: 'primary' },
    { source: 'move', target: 'week' },
    { source: 'compete', target: 'week' },
  ];
  const result = planSketchLayout(nodes, edges, 'horizontal');
  const position = new Map(result.map((patch) => [patch.id, patch.style]));
  assertNoOverlap(nodes, result);
  assert.ok(position.get('tea').x > position.get('root').x);
  assert.ok(position.get('similar').x > position.get('root').x);
  assert.ok(position.get('activity').x > position.get('root').x);
  assert.ok(position.get('tea').y < position.get('similar').y);
  assert.ok(position.get('similar').y < position.get('activity').y);
  assert.ok(position.get('spread').x > position.get('tea').x);
  assert.ok(position.get('observe').x > position.get('activity').x);
  assert.ok(position.get('move').x > position.get('observe').x);
  assert.ok(new Set(result.map((patch) => patch.style.x)).size <= 4);
});

test('wraps a deep main-role graph into bounded primary bands', () => {
  const nodes = [
    { id: 'root', kind: 'root', topicRole: 'main', style: { size: [340, 190], x: 0, y: 0 } },
    { id: 'tea', topicRole: 'main', style: { size: [300, 150], x: 0, y: 0 } },
    { id: 'similar', topicRole: 'main', style: { size: [300, 150], x: 0, y: 0 } },
    { id: 'activity', topicRole: 'main', style: { size: [300, 150], x: 0, y: 0 } },
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `support-${index}`,
      topicRole: 'supporting',
      style: {
        size: [250 + (index % 2) * 24, 130 + (index % 3) * 12],
        illustrationSpace: index === 4 ? 84 : 0,
        x: 0,
        y: 0,
      },
    })),
  ];
  const edges = [
    { source: 'root', target: 'tea', priority: 'primary' },
    { source: 'root', target: 'similar', priority: 'primary' },
    { source: 'root', target: 'activity', priority: 'primary' },
    { source: 'tea', target: 'support-0', priority: 'primary' },
    { source: 'support-0', target: 'support-1', priority: 'primary' },
    { source: 'support-1', target: 'support-2', priority: 'primary' },
    { source: 'support-2', target: 'support-3', priority: 'primary' },
    { source: 'similar', target: 'support-4', priority: 'primary' },
    { source: 'support-4', target: 'support-5', priority: 'primary' },
    { source: 'activity', target: 'support-6', priority: 'primary' },
    { source: 'support-6', target: 'support-7', priority: 'primary' },
    { source: 'support-7', target: 'support-8', priority: 'primary' },
    { source: 'support-8', target: 'support-9', priority: 'primary' },
  ];
  const horizontal = planSketchLayout(nodes, edges, 'horizontal');
  const vertical = planSketchLayout(nodes, edges, 'vertical');
  const span = (patches, axis) => {
    const values = patches.map((patch) => patch.style[axis]);
    return Math.max(...values) - Math.min(...values);
  };
  assertNoOverlap(nodes, horizontal);
  assertNoOverlap(nodes, vertical);
  assert.ok(new Set(horizontal.map((patch) => patch.style.x)).size <= 4);
  assert.ok(new Set(vertical.map((patch) => patch.style.y)).size <= 4);
  assert.ok(span(horizontal, 'x') < 1_500);
  assert.ok(span(vertical, 'y') < 1_500);
});

test('reduced-motion reorder writes only style patches and returns finish targets', async () => {
  const initial = [
    { id: 'a', data: { label: 'A' }, style: { x: 0, y: 0, size: [100, 50], custom: 'keep' } },
    { id: 'b', data: { label: 'B' }, style: { x: 200, y: 0, size: [100, 50], custom: 'keep' } },
  ];
  const harness = mockGraph(initial, [{ source: 'a', target: 'b' }]);
  const { graph, state, calls } = harness;
  let finished;
  const controller = createSketchReorder(graph, {
    reducedMotion: () => true,
    onFinish: (targets) => { finished = targets; },
  });
  const result = await controller.reorder('vertical');
  assert.equal(controller.busy, false);
  assert.deepEqual(result, finished);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 2);
  assert.ok(calls[0].every((patch) => patch.style.liftProgress === 0));
  assert.ok(calls[0].every((patch) => Number.isFinite(patch.style.x) && Number.isFinite(patch.style.y)));
  assert.equal(state.nodes[0].style.custom, 'keep');
  assert.deepEqual(state.nodes[0].data, { label: 'A' });
  assert.equal(harness.draws, 1);
});

test('cancellation settles current nodes and does not resurrect a removed node', async () => {
  const initial = [
    { id: 'a', style: { x: 0, y: 0, size: [100, 50] } },
    { id: 'b', style: { x: 200, y: 0, size: [100, 50] } },
  ];
  const { graph, state } = mockGraph(initial, [{ source: 'a', target: 'b' }]);
  let started = false;
  const driver = (from, _to, options) => {
    started = true;
    options.onUpdate(from);
    return { stop() {} };
  };
  const controller = createSketchReorder(graph, { animateDriver: driver });
  const running = controller.reorder('vertical');
  while (!started) await new Promise((resolve) => setTimeout(resolve, 0));
  state.nodes = state.nodes.filter((node) => node.id !== 'b');
  await controller.cancel();
  assert.deepEqual(await running, []);
  assert.equal(controller.busy, false);
  assert.deepEqual(state.nodes.map((node) => node.id), ['a']);
  assert.equal(state.nodes[0].style.liftProgress, 0);
});
