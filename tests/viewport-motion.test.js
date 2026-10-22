import test from 'node:test';
import assert from 'node:assert/strict';
import { FOLLOW, createViewportMotion, followTarget, viewportTarget } from '../frontend/viewport-motion.js';

function fixture(t, { reduced = false, x = 1200, y = 200, nodes } = {}) {
  const previousDocument = globalThis.document;
  const element = new EventTarget();
  globalThis.document = { getElementById: () => element };
  t.after(() => { globalThis.document = previousDocument; });
  let zoom = 1, origin = [0, 0], options;
  const events = new Map();
  const calls = [], driver = { starts: 0, stopped: false };
  const graph = {
    on: (name, handler) => events.set(name, handler), off: name => events.delete(name),
    getData: () => ({ nodes: nodes || [{ id: 'a', style: { x, y, size: [100, 100] } }] }),
    getSize: () => [800, 600], getOptions: () => ({ padding: [50, 50, 50, 50] }),
    getZoom: () => zoom,
    getViewportByCanvas: p => [...p.slice(0, 2).map((v, i) => v * zoom + origin[i]), 0],
    getCanvasByViewport: p => [...p.slice(0, 2).map((v, i) => (v - origin[i]) / zoom), 0],
    fitView() { throw new Error('Measuring must never move the camera'); },
    async zoomTo(value) { calls.push(['zoom', value]); const ratio = value / zoom; origin = origin.map(v => v * ratio); zoom = value; },
    async translateBy(value) { assert.equal(value.length, 2); assert.ok(value.every(Number.isFinite)); calls.push(['pan', value]); origin = origin.map((v, i) => v + value[i]); },
  };
  const motion = createViewportMotion(graph, () => reduced, (from, to, next) => {
    driver.starts++; driver.duration = next.duration; options = next; return { stop() { driver.stopped = true; } };
  });
  driver.update = value => options.onUpdate(value);
  driver.finish = () => options.onComplete();
  t.after(() => motion.dispose());
  return { graph, motion, driver, calls, element, resize() { events.get('beforesizechange')(); origin[0] -= 150; events.get('aftersizechange')(); } };
}

test('a centred map leaves the camera completely untouched', t => {
  const { graph, motion, calls, driver } = fixture(t, { x: 400, y: 300 });
  assert.equal(viewportTarget(graph, { when: 'overflow' }), null);
  motion.fit({ when: 'overflow' });
  assert.deepEqual(calls, []); assert.equal(driver.starts, 0);
});

test('an in-view but off-centre map pans to the middle without zooming', t => {
  const { graph } = fixture(t, { x: 200 });
  const target = viewportTarget(graph, { when: 'overflow' });
  assert.equal(target.zoom, 1);
  assert.deepEqual(target.origin, [200, 100]);
});

test('reframing has no measurement teleport or zoom-in, and same bounds do not restart it', async t => {
  const { graph, motion, calls, driver } = fixture(t);
  const fitting = motion.fit({ when: 'overflow' });
  assert.deepEqual(calls, []);
  await motion.fit({ when: 'overflow' }); assert.equal(driver.starts, 1);
  driver.update(.5); await new Promise(resolve => setImmediate(resolve));
  assert.equal(graph.getZoom(), 1);
  assert.deepEqual(graph.getViewportByCanvas([0, 0]).slice(0, 2), [-400, 50]);
  driver.finish(); await fitting;
  assert.deepEqual(graph.getViewportByCanvas([0, 0]).slice(0, 2), [-800, 100]);
});

test('pointer cancellation prevents a stale pan after an awaited zoom', async t => {
  const { graph, motion, calls, driver, element } = fixture(t);
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  graph.zoomTo = async value => { calls.push(['zoom', value]); entered(); await new Promise(resolve => { release = resolve; }); };
  const fitting = motion.fit(); driver.update(.5); await waiting;
  element.dispatchEvent(new Event('pointerdown')); release(); await fitting;
  assert.deepEqual(calls.map(call => call[0]), ['zoom']);
  await motion.fit({ when: 'overflow' }); assert.equal(driver.starts, 1);
});

test('camera failures are propagated through the awaited lifecycle', async t => {
  const { graph, motion, driver } = fixture(t);
  const fitting = motion.fit();
  const rejected = assert.rejects(fitting, /camera failure/);
  graph.zoomTo = async () => { throw new Error('camera failure'); };
  driver.update(.5); await rejected; assert.equal(driver.stopped, true);
});

test('reduced motion applies target once without animation or measuring moves', async t => {
  const { graph, motion, driver } = fixture(t, { reduced: true });
  await motion.fit({ when: 'overflow' });
  assert.equal(driver.starts, 0); assert.equal(graph.getZoom(), 1);
  assert.deepEqual(graph.getViewportByCanvas([0, 0]).slice(0, 2), [-800, 100]);
});


test('container resize preserves the visible origin instead of shifting every card', async t => {
  const { graph, driver, resize } = fixture(t, { x: 400, y: 300 });
  resize();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(graph.getViewportByCanvas([0, 0]).slice(0, 2), [0, 0]);
  assert.equal(driver.starts, 0);
});

test('a taller trace drawer shrinks the canvas and the fit keeps every card inside the rest', () => {
  let height = 600;
  const nodes = [{ id: 'a', style: { x: 0, y: 0, size: [250, 148] } }, { id: 'b', style: { x: 600, y: 420, size: [250, 148] } }];
  const graph = {
    getData: () => ({ nodes }), getSize: () => [900, height], getOptions: () => ({ padding: [88, 64, 240, 64] }),
    getZoom: () => 1, getViewportByCanvas: p => [p[0], p[1], 0],
  };
  const inside = target => {
    const { zoom, origin } = target;
    const edges = [-125 - 16, -74 - 16, 725 + 16, 494 + 16];
    return [edges[0] * zoom + origin[0], edges[1] * zoom + origin[1], edges[2] * zoom + origin[0], edges[3] * zoom + origin[1]];
  };
  const open = viewportTarget(graph, { when: 'always' });
  height = 340; // the drawer now claims 260px of the workspace
  const shorter = viewportTarget(graph, { when: 'always' });
  assert.ok(shorter.zoom < open.zoom);
  const [left, top, right, bottom] = inside(shorter);
  assert.ok(left >= 0 && top >= 0 && right <= 900 && bottom <= 340, `${left},${top},${right},${bottom}`);
  assert.notEqual(shorter.signature, open.signature);
});

test('drawer drags keep the camera still and refit once after the size settles', async t => {
  const { motion, driver, resize } = fixture(t);
  const { RESIZE_SETTLE_MS } = await import('../frontend/viewport-motion.js');
  for (let i = 0; i < 4; i++) { resize(); await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.equal(driver.starts, 0, 'no fit while the drawer is still moving');
  await new Promise(resolve => setTimeout(resolve, RESIZE_SETTLE_MS + 30));
  assert.equal(driver.starts, 1, 'one smooth refit at the end');
  motion.cancel();
});


// Canvas 800x600 with 50px padding: the usable area is [50, 50, 750, 550].
const card = (id, x, y) => ({ id, style: { x, y, size: [100, 100] } });
const screenX = (graph, x) => x * graph.getZoom() + graph.getViewportByCanvas([0, 0])[0];
const settle = () => new Promise(resolve => setImmediate(resolve));

function followFixture(t, extra = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const nodes = [card('a', 400, 300), card('b', 1200, 300)];
  return { nodes, ...fixture(t, { nodes, ...extra }) };
}

test('follow brings the newest card into view, nudged toward the centre', async t => {
  const { graph, motion, driver } = followFixture(t);
  const target = followTarget(graph, ['b']);
  assert.equal(target.zoom, 1, 'one card fits: no zoom change');
  motion.follow(['b']);
  assert.equal(driver.starts, 0, 'waits for the batch window');
  t.mock.timers.tick(FOLLOW.batchMs);
  assert.equal(driver.starts, 1);
  assert.equal(driver.duration, FOLLOW.duration);
  assert.ok(FOLLOW.duration >= 0.9 && FOLLOW.duration <= 1.2);
  driver.finish(); await settle();
  const x = screenX(graph, 1200);
  assert.ok(x + 66 <= 750 && x > 400, `newest card sits inside, toward the centre (${x})`);
});

test('a follow zooms out only when the new cards would not fit', t => {
  const { graph } = followFixture(t);
  graph.getData = () => ({ nodes: [card('b', 0, 0), card('c', 1400, 0)] });
  const target = followTarget(graph, ['b', 'c']);
  assert.ok(target.zoom < 1);
  const left = (-66) * target.zoom + target.origin[0], right = 1466 * target.zoom + target.origin[0];
  assert.ok(left >= 50 && right <= 750, `${left}..${right}`);
});

test('rapid additions are batched into one camera move', async t => {
  const { graph, motion, driver } = followFixture(t);
  motion.follow(['b']);
  t.mock.timers.tick(60);
  graph.getData = () => ({ nodes: [card('a', 400, 300), card('b', 1200, 300), card('c', 1200, 700)] });
  motion.follow(['c']);
  t.mock.timers.tick(FOLLOW.batchMs - 1);
  assert.equal(driver.starts, 0);
  t.mock.timers.tick(1);
  assert.equal(driver.starts, 1, 'one move for both cards');
  driver.finish(); await settle();
  const zoom = graph.getZoom(), origin = graph.getViewportByCanvas([0, 0]);
  assert.ok(1266 * zoom + origin[0] <= 751 && 766 * zoom + origin[1] <= 551 && 234 * zoom + origin[1] >= 49, 'both new cards in view');
});

test('routine reframes wait while following, then the map returns to the overview', async t => {
  const { graph, motion, driver } = followFixture(t);
  motion.follow(['b']);
  await motion.fit({ when: 'overflow' });
  assert.equal(driver.starts, 0, 'the overflow fit does not fight the follow');
  t.mock.timers.tick(FOLLOW.batchMs);
  driver.finish(); await settle();
  t.mock.timers.tick(FOLLOW.returnMs - FOLLOW.batchMs - 1);
  assert.equal(driver.starts, 1, 'no return while additions might continue');
  t.mock.timers.tick(1);
  assert.equal(driver.starts, 2, 'eases back to the whole map');
  assert.equal(driver.duration, FOLLOW.overviewDuration);
  driver.finish(); await settle();
  const zoom = graph.getZoom(), origin = graph.getViewportByCanvas([0, 0]);
  assert.ok(334 * zoom + origin[0] >= 49 && 1266 * zoom + origin[0] <= 751, 'every card in view');
});

test('the overview waits a moment after a follow move lands', async t => {
  const { motion, driver } = followFixture(t);
  motion.follow(['b']);
  t.mock.timers.tick(FOLLOW.batchMs + 1100);
  driver.finish(); await settle(); // lands 540ms before the return was due
  t.mock.timers.tick(FOLLOW.returnMs - FOLLOW.batchMs - 1100);
  assert.equal(driver.starts, 1, 'still resting on the new card');
  t.mock.timers.tick(FOLLOW.restMs - (FOLLOW.returnMs - FOLLOW.batchMs - 1100));
  assert.equal(driver.starts, 2);
});

test('follow never fights the user: a user-framed map only keeps content in the canvas', async t => {
  const { graph, motion, driver, element } = followFixture(t);
  element.dispatchEvent(new Event('wheel'));
  motion.follow(['b']);
  t.mock.timers.tick(FOLLOW.batchMs + FOLLOW.returnMs + 10);
  assert.equal(driver.starts, 0, 'no follow move and no overview return');
  const keeping = motion.fit({ when: 'overflow' });
  assert.equal(driver.starts, 1, 'the existing keep-in-canvas fit still runs');
  driver.finish(); await keeping;
  const zoom = graph.getZoom(), origin = graph.getViewportByCanvas([0, 0]);
  assert.ok(334 * zoom + origin[0] >= 49 && 1266 * zoom + origin[0] <= 751, 'content kept inside the canvas');
});

test('a drag during a pending follow cancels it', t => {
  const { motion, driver, element } = followFixture(t);
  motion.follow(['b']);
  element.dispatchEvent(Object.assign(new Event('pointerdown'), { clientX: 0, clientY: 0 }));
  t.mock.timers.tick(FOLLOW.batchMs + FOLLOW.returnMs + 10);
  assert.equal(driver.starts, 0);
});
