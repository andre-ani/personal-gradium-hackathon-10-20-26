import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewportMotion } from '../frontend/viewport-motion.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(t, reduced = false) {
  const previousDocument = globalThis.document;
  const element = new EventTarget();
  globalThis.document = { getElementById: () => element };
  t.after(() => { globalThis.document = previousDocument; });
  const calls = [];
  let zoom = 1, position = [10, 20], options;
  const started = deferred();
  const driver = {
    starts: 0,
    stopped: false,
    animate(from, to, next) {
      driver.starts++;
      assert.equal(from, 0);
      assert.equal(to, 1);
      options = next;
      started.resolve();
      return { stop() { driver.stopped = true; } };
    },
    update(value) { options.onUpdate(value); },
  };
  const graph = {
    getZoom: () => zoom,
    getPosition: () => position,
    async fitView(options, animation) {
      calls.push(['fit', options, animation]);
      zoom = 2;
      position = [100, 200];
    },
    async zoomTo(value) { calls.push(['zoom', value]); zoom = value; },
    async translateTo(value) { calls.push(['translate', value]); position = value; },
  };
  const motion = createViewportMotion(graph, () => reduced, driver.animate);
  t.after(() => motion.dispose());
  return { element, graph, calls, driver, started: started.promise, motion };
}

test('pointer cancellation during restore zoom prevents stale translation', async t => {
  const { element, graph, calls, driver, motion } = fixture(t);
  const entered = deferred(), release = deferred();
  graph.zoomTo = async value => {
    calls.push(['zoom', value]);
    entered.resolve();
    await release.promise;
  };
  const fitting = motion.fit();
  await entered.promise;
  element.dispatchEvent(new Event('pointerdown'));
  release.resolve();
  await fitting;
  assert.deepEqual(calls.map(([kind]) => kind), ['fit', 'zoom']);
  assert.equal(driver.starts, 0);
});

test('an in-flight camera rejection propagates and stops the driver', async t => {
  const { graph, calls, driver, started, motion } = fixture(t);
  const update = deferred();
  const fitting = motion.fit();
  const error = new Error('camera update failed');
  const rejected = assert.rejects(fitting, error);
  await started;
  graph.zoomTo = () => update.promise;
  driver.update(.5);
  update.reject(error);
  await rejected;
  assert.equal(driver.stopped, true);
  assert.equal(calls.filter(([kind]) => kind === 'translate').length, 1);
});

test('reduced motion applies the fit without starting a driver', async t => {
  const { graph, calls, driver, motion } = fixture(t, true);
  await motion.fit({ when: 'overflow' });
  assert.deepEqual(calls, [['fit', { when: 'overflow' }, false]]);
  assert.equal(graph.getZoom(), 2);
  assert.deepEqual(graph.getPosition(), [100, 200]);
  assert.equal(driver.starts, 0);
});
