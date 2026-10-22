import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CARD_LANDING, EDGE_DRAW, animateSketchUpdates, cardLandingFrame, drawSketchEntrance, edgeDrawDuration, resetSketchEntrance,
} from '../frontend/sketch-motion.js';

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
  assert.equal(driver.duration, CARD_LANDING.duration / 1000);
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


/** A driver that records each animation and lets the test finish them in turn. */
function queueDriver() {
  const runs = [];
  return {
    runs,
    animate(from, to, options) {
      const run = { options, stopped: false };
      runs.push(run);
      return { stop() { run.stopped = true; } };
    },
    finish(index) { runs[index].options.onUpdate(1); runs[index].options.onComplete(); },
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('connectors ink with a pen-like ease-in-out over a length-scaled duration', async () => {
  assert.equal(edgeDrawDuration(0), edgeDrawDuration(undefined));
  assert.ok(edgeDrawDuration(80) >= 600 && edgeDrawDuration(80) < edgeDrawDuration(400));
  assert.ok(edgeDrawDuration(400) < edgeDrawDuration(700));
  assert.equal(edgeDrawDuration(5000), EDGE_DRAW.max);
  const [x1, y1, x2, y2] = EDGE_DRAW.ease;
  assert.ok(x1 > 0.3 && y1 < 0.2 && x2 < 0.5 && y2 === 1, 'slow start, gentle landing');

  const positions = { a: [0, 0], b: [600, 0], c: [0, 150] };
  const graph = mockGraph({ long: { source: 'a', target: 'b' }, short: { source: 'a', target: 'c' } });
  graph.getElementPosition = (id) => positions[id];
  const driver = queueDriver();
  const drawing = drawSketchEntrance(graph, { edges: ['long', 'short'], animateDriver: driver.animate, stagger: 0 });
  driver.finish(0);
  while (driver.runs.length < 2) await new Promise((resolve) => setTimeout(resolve, 2));
  driver.finish(1);
  await drawing;
  const [long, short] = driver.runs.map(({ options }) => options);
  assert.equal(long.duration, edgeDrawDuration(600) / 1000);
  assert.equal(short.duration, edgeDrawDuration(150) / 1000);
  assert.ok(long.duration > short.duration);
  assert.deepEqual(long.ease, EDGE_DRAW.ease);
});

test('a big batch draws one element at a time at full duration, with a pause between', async () => {
  const graph = mockGraph();
  const driver = queueDriver();
  const ids = Array.from({ length: 12 }, (_, i) => `n${i}`);
  const drawing = drawSketchEntrance(graph, { nodes: ids, animateDriver: driver.animate, stagger: 5 });
  for (let i = 0; i < ids.length; i++) {
    while (driver.runs.length <= i) await new Promise((resolve) => setTimeout(resolve, 2));
    await new Promise((resolve) => setTimeout(resolve, 12));
    assert.equal(driver.runs.length, i + 1, 'the next card waits for this one to land');
    driver.finish(i);
  }
  assert.ok(driver.runs.every(({ options }) => options.duration === CARD_LANDING.duration / 1000));
  await drawing;
});

test('a card waits for its incoming connector to finish before landing', async () => {
  const graph = mockGraph({ link: { source: 'old', target: 'child' } });
  const driver = queueDriver();
  const drawing = drawSketchEntrance(graph, { nodes: ['child'], edges: ['link'], animateDriver: driver.animate, stagger: 0 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(driver.runs.length, 1, 'only the connector is inking');
  driver.finish(0);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(driver.runs.length, 2);
  driver.finish(1);
  await drawing;
});

test('a card lands like a sticky note: lifted, pressed flat, then its words write in', async () => {
  const { drop, press, appear } = CARD_LANDING;
  assert.ok(CARD_LANDING.duration >= 700 && CARD_LANDING.duration <= 900);
  const start = cardLandingFrame(0);
  assert.deepEqual(start, { drawProgress: 0, liftProgress: 1, textHold: true });
  assert.ok(cardLandingFrame(appear).drawProgress === 1, 'paper is fully in while still held up');
  let previous = 1;
  for (let t = 0.05; t < drop; t += 0.05) {
    const { liftProgress } = cardLandingFrame(t);
    assert.ok(liftProgress < previous, 'the drop only descends');
    previous = liftProgress;
  }
  assert.ok(Math.abs(cardLandingFrame(drop).liftProgress) < 1e-3, 'touches down at the drop');
  const settle = Array.from({ length: 20 }, (_, i) => cardLandingFrame(drop + (1 - drop) * (i + 0.5) / 20).liftProgress);
  assert.ok(Math.min(...settle) < 0 && Math.min(...settle) >= -press, 'a tiny press, no bounce');
  for (let t = 0; t < 1; t += 0.1) assert.equal(cardLandingFrame(t).textHold, true, 'words wait for the landing');
  assert.deepEqual(cardLandingFrame(1), { drawProgress: 1, liftProgress: 0, textHold: false });

  const patches = [];
  const graph = mockGraph();
  graph.updateNodeData = (patch) => patches.push(patch[0].style);
  const driver = queueDriver();
  const landing = drawSketchEntrance(graph, { nodes: ['card'], animateDriver: driver.animate });
  assert.equal(driver.runs[0].options.ease, 'linear');
  assert.equal(driver.runs[0].options.duration, CARD_LANDING.duration / 1000);
  driver.runs[0].options.onUpdate(0.5);
  assert.equal(patches.at(-1).textHold, true);
  assert.ok(patches.at(-1).liftProgress > 0);
  driver.finish(0);
  await landing;
  assert.deepEqual(patches.at(-1), { drawProgress: 1, liftProgress: 0, textHold: false });
});

test('reduced motion places a card flat with its words immediately', async () => {
  const patches = [];
  const graph = mockGraph();
  graph.updateNodeData = (patch) => patches.push(patch[0].style);
  await drawSketchEntrance(graph, { nodes: ['card'], reducedMotion: true });
  assert.deepEqual(patches, [{ drawProgress: 1, liftProgress: 0, textHold: false }]);
});
