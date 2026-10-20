import test from 'node:test';
import assert from 'node:assert/strict';

import { createStableDecorations } from '../frontend/stable-decorations.js';

function graphFixture({ draw = async () => {} } = {}) {
  const state = new Map();
  const updates = [];
  const graph = {
    updates,
    state,
    updateNodeData(patches) {
      updates.push(patches.map((patch) => ({ ...patch, style: { ...patch.style } })));
      for (const patch of patches) {
        state.set(String(patch.id), { ...(state.get(String(patch.id)) || {}), ...patch.style });
      }
    },
    draw,
  };
  return graph;
}

function node(id, extra = {}) {
  return { id, label: id, kind: 'topic', status: 'named', ...extra };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('waits for semantic stability, applies both stages, and reports captured revisions', async () => {
  let clock = 0;
  const events = [];
  const graph = graphFixture();
  const decorations = createStableDecorations(graph, {
    now: () => clock,
    reducedMotion: true,
    stage1Ms: 12,
    stage2Ms: 35,
    additionSpacingMs: 6,
    onApplied: (event) => events.push(event),
    getRenderedRevision: () => 11,
  });
  decorations.sync([node('a')], [], {
    nodeRevisions: new Map([['a', 7]]),
    renderedRevision: 10,
  });

  clock = 12;
  await decorations.tick();
  assert.deepEqual(decorations.styleFor('a'), { tape1Progress: 1, tape2Progress: 0 });
  assert.deepEqual(events, [{ node_id: 'a', level: 1, node_revision: 7, rendered_revision: 11 }]);

  clock = 35;
  await decorations.tick();
  assert.deepEqual(decorations.styleFor('a'), { tape1Progress: 1, tape2Progress: 1 });
  assert.deepEqual(events.at(-1), { node_id: 'a', level: 2, node_revision: 7, rendered_revision: 11 });
  assert.equal(events.length, 2);
  decorations.dispose();
});

test('geometry and renderer revision changes do not reset semantic stability or duplicate events', async () => {
  let clock = 0;
  const events = [];
  const graph = graphFixture();
  const decorations = createStableDecorations(graph, {
    now: () => clock,
    reducedMotion: true,
    stage1Ms: 12,
    stage2Ms: 1000,
    additionSpacingMs: 0,
    onApplied: (event) => events.push(event),
  });
  decorations.sync([node('a', { nodeRevision: 1, x: 10, y: 20, style: { fill: 'red' } })], [], {
    nodeRevisions: { a: 1 },
    renderedRevision: 1,
  });
  clock = 12;
  await decorations.tick();
  decorations.sync([node('a', { nodeRevision: 2, x: 900, y: 600, style: { fill: 'blue' } })], [], {
    nodeRevisions: { a: 2 },
    renderedRevision: 2,
  });
  assert.deepEqual(decorations.styleFor('a'), { tape1Progress: 1, tape2Progress: 0 });
  await decorations.tick();
  assert.equal(events.length, 1);
  decorations.dispose();
});

test('spaces the second strip from the first strip as well', async () => {
  let clock = 0;
  const events = [];
  const decorations = createStableDecorations(graphFixture(), {
    now: () => clock,
    reducedMotion: true,
    stage1Ms: 12,
    stage2Ms: 15,
    additionSpacingMs: 6,
    onApplied: (event) => events.push(event),
  });
  decorations.sync([node('a')], []);
  clock = 12;
  await decorations.tick();
  clock = 15;
  await decorations.tick();
  assert.equal(events.length, 1);
  clock = 18;
  await decorations.tick();
  assert.equal(events.length, 2);
  decorations.dispose();
});

test('semantic changes clear tapes and edge changes count as semantic changes', async () => {
  let clock = 0;
  const events = [];
  const graph = graphFixture();
  const decorations = createStableDecorations(graph, {
    now: () => clock,
    reducedMotion: true,
    stage1Ms: 12,
    stage2Ms: 1000,
    additionSpacingMs: 0,
    onApplied: (event) => events.push(event),
  });
  decorations.sync([node('a')], [{ source: 'a', target: 'b', label: 'old' }]);
  clock = 12;
  await decorations.tick();
  assert.equal(decorations.styleFor('a').tape1Progress, 1);

  clock = 13;
  decorations.sync([node('a', { label: 'changed' })], [{ source: 'a', target: 'b', label: 'old' }]);
  assert.deepEqual(decorations.styleFor('a'), { tape1Progress: 0, tape2Progress: 0 });
  clock = 20;
  await decorations.tick();
  assert.equal(events.length, 1);

  decorations.sync([node('a', { label: 'changed' })], [{ source: 'a', target: 'b', label: 'new' }]);
  assert.deepEqual(decorations.styleFor('a'), { tape1Progress: 0, tape2Progress: 0 });
  decorations.dispose();
});

test('caps decorated nodes, spaces additions, and prioritizes anchors and notes', async () => {
  let clock = 0;
  const graph = graphFixture();
  const decorations = createStableDecorations(graph, {
    now: () => clock,
    reducedMotion: true,
    stage1Ms: 12,
    stage2Ms: 100000,
    additionSpacingMs: 6,
    maxDecoratedNodes: 2,
  });
  decorations.sync([
    node('annotation', { nodeVariant: 'annotation' }),
    node('note', { nodeVariant: 'note' }),
    node('root', { kind: 'root' }),
  ], []);
  clock = 12;
  await decorations.tick();
  assert.equal(decorations.styleFor('root').tape1Progress, 1);
  assert.equal(decorations.styleFor('note').tape1Progress, 0);

  clock = 18;
  await decorations.tick();
  assert.equal(decorations.styleFor('note').tape1Progress, 1);
  assert.equal(decorations.styleFor('annotation').tape1Progress, 0);

  clock = 24;
  await decorations.tick();
  assert.equal(decorations.styleFor('annotation').tape1Progress, 0);
  decorations.dispose();
});

test('cancels an in-flight animation and never applies stale progress or completion', async () => {
  let clock = 0;
  let animationOptions;
  const events = [];
  const graph = graphFixture();
  const decorations = createStableDecorations(graph, {
    now: () => clock,
    stage1Ms: 12,
    stage2Ms: 1000,
    additionSpacingMs: 0,
    animateDriver: (_from, _to, options) => {
      animationOptions = options;
      return { stop() {} };
    },
    onApplied: (event) => events.push(event),
  });
  decorations.sync([node('a')], []);
  clock = 12;
  const running = decorations.tick();
  decorations.sync([node('a', { label: 'new meaning' })], []);
  animationOptions.onUpdate(1);
  animationOptions.onComplete();
  await running;
  await settle();
  assert.deepEqual(decorations.styleFor('a'), { tape1Progress: 0, tape2Progress: 0 });
  assert.deepEqual(events, []);
  assert.equal(graph.updates.length, 0);
  decorations.dispose();
});

test('passes the 700ms reveal as 0.7 seconds to Motion', async () => {
  let clock = 0;
  let animationOptions;
  const decorations = createStableDecorations(graphFixture(), {
    now: () => clock,
    stage1Ms: 12,
    additionSpacingMs: 0,
    animateDriver: (_from, _to, options) => {
      animationOptions = options;
      return { stop() {} };
    },
  });
  decorations.sync([node('a')], []);
  clock = 12;
  const running = decorations.tick();
  assert.equal(animationOptions.duration, 0.7);
  decorations.reset();
  await running;
  decorations.dispose();
});

test('queued work re-checks state at exclusive start and callback failures do not stop scheduling', async () => {
  let clock = 0;
  const queued = [];
  const events = [];
  const errors = [];
  const graph = graphFixture();
  const decorations = createStableDecorations(graph, {
    now: () => clock,
    reducedMotion: true,
    stage1Ms: 12,
    stage2Ms: 1000,
    additionSpacingMs: 0,
    runExclusive: (work) => new Promise((resolve, reject) => queued.push({ work, resolve, reject })),
    onApplied: () => { throw new Error('listener failed'); },
    onError: (error) => errors.push(error.message),
  });
  decorations.sync([node('a')], []);
  clock = 12;
  const first = decorations.tick();
  decorations.sync([node('a', { label: 'superseded' })], []);
  const stale = queued.shift();
  stale.resolve(await stale.work());
  await first;
  assert.deepEqual(decorations.styleFor('a'), { tape1Progress: 0, tape2Progress: 0 });

  clock = 24;
  const second = decorations.tick();
  const current = queued.shift();
  current.resolve(await current.work());
  await second;
  assert.deepEqual(decorations.styleFor('a'), { tape1Progress: 1, tape2Progress: 0 });
  assert.deepEqual(errors, ['listener failed']);
  decorations.dispose();
});
