import test from 'node:test';
import assert from 'node:assert/strict';

import { animateSketchUpdates, drawSketchEntrance, resetSketchEntrance } from '../frontend/sketch-motion.js';

function mockGraph(edgeData) {
  const calls = [];
  const graph = {
    calls,
    updateNodeData(patch) {
      calls.push({ kind: 'node', id: patch[0].id, progress: patch[0].style.drawProgress });
    },
    updateEdgeData(patch) {
      calls.push({ kind: 'edge', id: patch[0].id, progress: patch[0].style.drawProgress });
    },
    draw() {
      return Promise.resolve();
    },
  };
  if (edgeData) graph.getEdgeData = (id) => edgeData[id];
  return graph;
}

test('reveals edges before nodes and skips duplicate ids', async () => {
  const graph = mockGraph();

  await drawSketchEntrance(graph, {
    edges: ['edge-1', 'edge-1', 'edge-2'],
    nodes: ['node-1', 'node-2'],
    reducedMotion: true,
  });

  assert.deepEqual(
    graph.calls.map(({ kind, id }) => `${kind}:${id}`),
    ['edge:edge-1', 'edge:edge-2', 'node:node-1', 'node:node-2'],
  );
  assert.ok(graph.calls.every(({ progress }) => progress === 1));
});

test('does not reanimate completed ids, then replays after reset', async () => {
  const graph = mockGraph();

  await drawSketchEntrance(graph, { edges: ['edge-1'], nodes: ['node-1'], reducedMotion: true });
  await drawSketchEntrance(graph, { edges: ['edge-1'], nodes: ['node-1'], reducedMotion: true });
  assert.equal(graph.calls.length, 2);

  resetSketchEntrance(graph);
  await drawSketchEntrance(graph, { edges: ['edge-1'], nodes: ['node-1'], reducedMotion: true });
  assert.equal(graph.calls.length, 4);
});

test('reduced motion completes immediately at progress 1', async () => {
  const graph = mockGraph();

  await drawSketchEntrance(graph, { edges: [], nodes: ['node-1'], reducedMotion: true });

  assert.deepEqual(graph.calls, [{ kind: 'node', id: 'node-1', progress: 1 }]);
});

test('dependency-aware ordering reveals source, edge, target along a chain', async () => {
  const graph = mockGraph({
    'edge-root-a': { id: 'edge-root-a', source: 'root', target: 'a' },
    'edge-a-b': { id: 'edge-a-b', source: 'a', target: 'b' },
  });

  await drawSketchEntrance(graph, {
    nodes: ['root', 'a', 'b'],
    edges: ['edge-root-a', 'edge-a-b'],
    reducedMotion: true,
  });

  assert.deepEqual(
    graph.calls.map(({ kind, id }) => `${kind}:${id}`),
    ['node:root', 'edge:edge-root-a', 'node:a', 'edge:edge-a-b', 'node:b'],
  );
});

test('dependency-aware ordering draws an existing-source edge before its new target', async () => {
  const graph = mockGraph({ childEdge: { id: 'childEdge', source: 'existing', target: 'child' } });

  await drawSketchEntrance(graph, {
    nodes: ['child'],
    edges: ['childEdge'],
    reducedMotion: true,
  });

  assert.deepEqual(
    graph.calls.map(({ kind, id }) => `${kind}:${id}`),
    ['edge:childEdge', 'node:child'],
  );
});

test('cycles fall back to a node before finishing remaining edges', async () => {
  const graph = mockGraph({
    'edge-a-b': { id: 'edge-a-b', source: 'a', target: 'b' },
    'edge-b-a': { id: 'edge-b-a', source: 'b', target: 'a' },
  });

  await drawSketchEntrance(graph, {
    nodes: ['a', 'b'],
    edges: ['edge-a-b', 'edge-b-a'],
    reducedMotion: true,
  });

  assert.equal(graph.calls[0].kind, 'node');
  assert.deepEqual(new Set(graph.calls.map(({ id }) => id)), new Set(['a', 'b', 'edge-a-b', 'edge-b-a']));
});

function controlledDriver() {
  let options;
  let stopped = false;
  return {
    animate(from, to, next) {
      assert.equal(from, 0);
      assert.equal(to, 1);
      options = next;
      return { stop() { stopped = true; } };
    },
    update(value) { options.onUpdate(value); },
    complete() { options.onComplete(); },
    get stopped() { return stopped; },
    get duration() { return options.duration; },
  };
}

test('cancellation stops the Motion driver and prevents queued stale writes', async () => {
  const graph = mockGraph();
  const controller = new AbortController();
  const driver = controlledDriver();
  const animation = drawSketchEntrance(graph, {
    nodes: ['node-1'], signal: controller.signal, animateDriver: driver.animate,
  });
  controller.abort();
  driver.update(0.5);
  driver.complete();
  await animation;
  assert.equal(driver.stopped, true);
  assert.deepEqual(graph.calls, [{ kind: 'node', id: 'node-1', progress: 0 }]);
});

test('reset stops an active driver without requiring an AbortSignal', async () => {
  const graph = mockGraph();
  const driver = controlledDriver();
  const animation = drawSketchEntrance(graph, { nodes: ['node-1'], animateDriver: driver.animate });
  resetSketchEntrance(graph);
  driver.update(0.8);
  await animation;
  assert.equal(driver.stopped, true);
  assert.equal(graph.calls.length, 1);
  await drawSketchEntrance(graph, { nodes: ['node-1'], reducedMotion: true });
  assert.equal(graph.calls.at(-1).progress, 1);
});

test('Motion updates coalesce slow draws and flush final progress', async () => {
  const graph = mockGraph();
  const driver = controlledDriver();
  let release;
  let draws = 0;
  let active = 0;
  let maximum = 0;
  graph.draw = async () => {
    draws++;
    active++;
    maximum = Math.max(maximum, active);
    if (draws === 1) await new Promise((resolve) => { release = resolve; });
    active--;
  };
  const animation = drawSketchEntrance(graph, { nodes: ['node-1'], animateDriver: driver.animate });
  await new Promise((resolve) => setImmediate(resolve));
  for (let i = 1; i <= 100; i++) driver.update(i / 100);
  driver.complete();
  assert.equal(draws, 1);
  release();
  await animation;
  assert.equal(maximum, 1);
  assert.equal(draws, 2);
  assert.equal(graph.calls.at(-1).progress, 1);
  assert.ok(driver.duration <= 0.28);
});


test('changed nodes finish immediately with reduced motion and do not change entrance cache', async () => {
  const graph = mockGraph();
  await animateSketchUpdates(graph, { nodes: ['node-1', 'node-1'], reducedMotion: true });
  assert.deepEqual(graph.calls, [{ kind: 'node', id: 'node-1', progress: 1 }]);
  await drawSketchEntrance(graph, { nodes: ['node-1'], reducedMotion: true });
  assert.equal(graph.calls.length, 2);
});

test('changed-node re-inking batches writes and rejects stale updates after abort', async () => {
  const patches = [];
  const graph = mockGraph();
  graph.updateNodeData = (patch) => patches.push(patch);
  const controller = new AbortController();
  let options;
  let stopped = false;
  const animation = animateSketchUpdates(graph, {
    nodes: ['a', 'b'], signal: controller.signal, duration: 400,
    animateDriver(from, to, next) {
      assert.equal(from, 0.78);
      assert.equal(to, 1);
      assert.equal(next.duration, 0.16);
      options = next;
      return { stop() { stopped = true; } };
    },
  });
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].map(({ id }) => id), ['a', 'b']);
  controller.abort();
  options.onUpdate(0.9);
  options.onComplete();
  await animation;
  assert.equal(stopped, true);
  assert.equal(patches.length, 1);
});
