import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DECORATION_TYPES, chooseDecoration, createStableDecorations, decorationInk, decorationPreference,
} from '../frontend/stable-decorations.js';
import { PALETTE } from '../frontend/palette.js';
import { TAPE_DESIGNS } from '../frontend/washi-tape.js';

const tapes = (decorations, id) => {
  const { tape1Progress, tape2Progress } = decorations.styleFor(id);
  return { tape1Progress, tape2Progress };
};

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
    types: ['washi_tape'],
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
  assert.deepEqual(tapes(decorations, 'a'), { tape1Progress: 1, tape2Progress: 0 });
  assert.deepEqual(events, [{ node_id: 'a', level: 1, node_revision: 7, rendered_revision: 11, decoration: 'washi_tape' }]);

  clock = 35;
  await decorations.tick();
  assert.deepEqual(tapes(decorations, 'a'), { tape1Progress: 1, tape2Progress: 1 });
  assert.deepEqual(events.at(-1), { node_id: 'a', level: 2, node_revision: 7, rendered_revision: 11, decoration: 'washi_tape' });
  assert.equal(events.length, 2);
  decorations.dispose();
});

test('geometry and renderer revision changes do not reset semantic stability or duplicate events', async () => {
  let clock = 0;
  const events = [];
  const graph = graphFixture();
  const decorations = createStableDecorations(graph, {
    types: ['washi_tape'],
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
  assert.deepEqual(tapes(decorations, 'a'), { tape1Progress: 1, tape2Progress: 0 });
  await decorations.tick();
  assert.equal(events.length, 1);
  decorations.dispose();
});

test('spaces the second strip from the first strip as well', async () => {
  let clock = 0;
  const events = [];
  const decorations = createStableDecorations(graphFixture(), {
    types: ['washi_tape'],
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
    types: ['washi_tape'],
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
  assert.deepEqual(tapes(decorations, 'a'), { tape1Progress: 0, tape2Progress: 0 });
  clock = 20;
  await decorations.tick();
  assert.equal(events.length, 1);

  decorations.sync([node('a', { label: 'changed' })], [{ source: 'a', target: 'b', label: 'new' }]);
  assert.deepEqual(tapes(decorations, 'a'), { tape1Progress: 0, tape2Progress: 0 });
  decorations.dispose();
});

test('caps decorated nodes, spaces additions, and prioritizes anchors and notes', async () => {
  let clock = 0;
  const graph = graphFixture();
  const decorations = createStableDecorations(graph, {
    types: ['washi_tape'],
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
    types: ['washi_tape'],
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
  assert.deepEqual(tapes(decorations, 'a'), { tape1Progress: 0, tape2Progress: 0 });
  assert.deepEqual(events, []);
  assert.equal(graph.updates.length, 0);
  decorations.dispose();
});

test('passes the 700ms reveal as 0.7 seconds to Motion', async () => {
  let clock = 0;
  let animationOptions;
  const decorations = createStableDecorations(graphFixture(), {
    types: ['washi_tape'],
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
    types: ['washi_tape'],
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
  assert.deepEqual(tapes(decorations, 'a'), { tape1Progress: 0, tape2Progress: 0 });

  clock = 24;
  const second = decorations.tick();
  const current = queued.shift();
  current.resolve(await current.work());
  await second;
  assert.deepEqual(tapes(decorations, 'a'), { tape1Progress: 1, tape2Progress: 0 });
  assert.deepEqual(errors, ['listener failed']);
  decorations.dispose();
});

test('each card gets one seeded type, and doodles finish in a single stage', async () => {
  let clock = 0;
  const events = [];
  const graph = graphFixture();
  const decorations = createStableDecorations(graph, {
    now: () => clock, reducedMotion: true, stage1Ms: 12, stage2Ms: 35, additionSpacingMs: 0,
    types: ['stars'], onApplied: (event) => events.push(event),
  });
  decorations.sync([node('a', { palette: 'teal' })], []);
  clock = 12;
  await decorations.tick();
  const style = decorations.styleFor('a');
  assert.equal(style.decorationType, 'stars');
  assert.equal(style.decorationProgress, 1);
  assert.equal(style.tape1Progress, 0);
  assert.equal(style.decorationPalette, 'teal');
  assert.ok([PALETTE.teal.ink, PALETTE.terracotta.ink].includes(style.decorationInk));
  // The patch that reveals the doodle also tells the node what to draw.
  assert.equal(graph.state.get('a').decorationType, 'stars');
  assert.equal(graph.state.get('a').decorationProgress, 1);
  clock = 100;
  await decorations.tick();
  assert.deepEqual(events.map((event) => [event.level, event.decoration]), [[1, 'stars']]);
  decorations.dispose();
});

test('type preference is deterministic and varied across cards', () => {
  assert.deepEqual(decorationPreference('tea'), decorationPreference('tea'));
  assert.deepEqual([...decorationPreference('tea')].sort(), [...DECORATION_TYPES].sort());
  const firsts = new Set();
  for (let i = 0; i < 60; i++) firsts.add(decorationPreference(`card-${i}`)[0]);
  assert.equal(firsts.size, DECORATION_TYPES.length);
  const preferred = decorationPreference('tea')[0];
  assert.notEqual(chooseDecoration('tea', [preferred]), preferred);
  assert.notEqual(chooseDecoration('tea', [], [preferred]), preferred);
});

test('neighbouring and consecutive cards do not repeat a type', async () => {
  let clock = 0;
  const decorations = createStableDecorations(graphFixture(), {
    now: () => clock, reducedMotion: true, stage1Ms: 12, stage2Ms: 1e9, additionSpacingMs: 0, maxDecoratedNodes: 20,
  });
  const ids = Array.from({ length: 12 }, (_, i) => `n${i}`);
  const edges = ids.slice(1).map((id, i) => ({ source: ids[i], target: id }));
  decorations.sync(ids.map((id) => node(id)), edges);
  clock = 12;
  for (let i = 0; i < ids.length; i++) await decorations.tick();
  const chosen = ids.map((id) => decorations.styleFor(id).decorationType);
  assert.ok(chosen.every((type) => DECORATION_TYPES.includes(type)));
  for (let i = 1; i < chosen.length; i++) assert.notEqual(chosen[i], chosen[i - 1]);
  assert.ok(new Set(chosen).size >= 4);
  decorations.dispose();
});

test('tape designs avoid repeating on neighbouring cards', async () => {
  let clock = 0;
  const decorations = createStableDecorations(graphFixture(), {
    now: () => clock, reducedMotion: true, stage1Ms: 12, stage2Ms: 1e9, additionSpacingMs: 0,
    maxDecoratedNodes: 20, types: ['washi_tape'],
  });
  const ids = Array.from({ length: 10 }, (_, i) => `t${i}`);
  decorations.sync(ids.map((id) => node(id)), ids.slice(1).map((id, i) => ({ source: ids[i], target: id })));
  clock = 12;
  for (let i = 0; i < ids.length; i++) await decorations.tick();
  const designs = ids.map((id) => decorations.styleFor(id).tapeDesign);
  assert.ok(designs.every((design) => TAPE_DESIGNS.includes(design)));
  for (let i = 1; i < designs.length; i++) assert.notEqual(designs[i], designs[i - 1]);
  decorations.dispose();
});

test('doodle ink comes from the card palette or its accent, blue by default', () => {
  const inks = new Set(Object.values(PALETTE).map(({ ink }) => ink));
  let accents = 0;
  for (let i = 0; i < 30; i++) {
    const ink = decorationInk({ id: `r${i}`, palette: 'rose' }, 'stars');
    assert.ok([PALETTE.rose.ink, PALETTE.plum.ink].includes(ink));
    if (ink !== PALETTE.rose.ink) accents += 1;
    assert.ok(inks.has(ink));
    assert.equal(decorationInk({ id: `r${i}`, palette: 'rose' }, 'underline'), PALETTE.rose.ink);
  }
  assert.ok(accents > 0 && accents < 30);
  assert.equal(decorationInk({ id: 'x' }, 'circle'), PALETTE.blue.ink);
  assert.equal(decorationInk({ id: 'x', palette: 'nope' }, 'circle'), PALETTE.blue.ink);
});
