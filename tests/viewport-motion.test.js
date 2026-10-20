import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewportMotion, viewportTarget } from '../frontend/viewport-motion.js';

function fixture(t, { reduced = false, x = 1200 } = {}) {
  const previousDocument = globalThis.document;
  const element = new EventTarget();
  globalThis.document = { getElementById: () => element };
  t.after(() => { globalThis.document = previousDocument; });
  let zoom = 1, origin = [0, 0], options;
  const events = new Map();
  const calls = [], driver = { starts: 0, stopped: false };
  const graph = {
    on: (name, handler) => events.set(name, handler), off: name => events.delete(name),
    getData: () => ({ nodes: [{ id: 'a', style: { x, y: 200, size: [100, 100] } }] }),
    getSize: () => [800, 600], getOptions: () => ({ padding: [50, 50, 50, 50] }),
    getZoom: () => zoom,
    getViewportByCanvas: p => [...p.slice(0, 2).map((v, i) => v * zoom + origin[i]), 0],
    getCanvasByViewport: p => [...p.slice(0, 2).map((v, i) => (v - origin[i]) / zoom), 0],
    fitView() { throw new Error('Measuring must never move the camera'); },
    async zoomTo(value) { calls.push(['zoom', value]); const ratio = value / zoom; origin = origin.map(v => v * ratio); zoom = value; },
    async translateBy(value) { assert.equal(value.length, 2); assert.ok(value.every(Number.isFinite)); calls.push(['pan', value]); origin = origin.map((v, i) => v + value[i]); },
  };
  const motion = createViewportMotion(graph, () => reduced, (from, to, next) => {
    driver.starts++; options = next; return { stop() { driver.stopped = true; } };
  });
  driver.update = value => options.onUpdate(value);
  driver.finish = () => options.onComplete();
  t.after(() => motion.dispose());
  return { graph, motion, driver, calls, element, resize() { events.get('beforesizechange')(); origin[0] -= 150; events.get('aftersizechange')(); } };
}

test('in-view patches leave the camera completely untouched', t => {
  const { graph, motion, calls, driver } = fixture(t, { x: 200 });
  assert.equal(viewportTarget(graph, { when: 'overflow' }), null);
  motion.fit({ when: 'overflow' });
  assert.deepEqual(calls, []); assert.equal(driver.starts, 0);
});

test('reframing has no measurement teleport or zoom-in, and same bounds do not restart it', async t => {
  const { graph, motion, calls, driver } = fixture(t);
  const fitting = motion.fit({ when: 'overflow' });
  assert.deepEqual(calls, []);
  await motion.fit({ when: 'overflow' }); assert.equal(driver.starts, 1);
  driver.update(.5); await new Promise(resolve => setImmediate(resolve));
  assert.equal(graph.getZoom(), 1);
  assert.deepEqual(graph.getViewportByCanvas([0, 0]).slice(0, 2), [-258, 0]);
  driver.finish(); await fitting;
  assert.deepEqual(graph.getViewportByCanvas([0, 0]).slice(0, 2), [-516, 0]);
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
  assert.deepEqual(graph.getViewportByCanvas([0, 0]).slice(0, 2), [-516, 0]);
});


test('container resize preserves the visible origin instead of shifting every card', async t => {
  const { graph, driver, resize } = fixture(t, { x: 200 });
  resize();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(graph.getViewportByCanvas([0, 0]).slice(0, 2), [0, 0]);
  assert.equal(driver.starts, 0);
});
