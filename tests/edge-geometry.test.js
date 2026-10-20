import test from 'node:test';
import assert from 'node:assert/strict';
import { sketchEdgeRoute } from '../frontend/edge-geometry.js';

function sampledPoints(path, steps = 32) {
  const points = [];
  let start = null;
  for (const segment of path) {
    if (segment[0] === 'M') {
      start = [segment[1], segment[2]];
      points.push(start);
      continue;
    }
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const inverse = 1 - t;
      points.push([
        inverse ** 3 * start[0] + 3 * inverse ** 2 * t * segment[1] + 3 * inverse * t ** 2 * segment[3] + t ** 3 * segment[5],
        inverse ** 3 * start[1] + 3 * inverse ** 2 * t * segment[2] + 3 * inverse * t ** 2 * segment[4] + t ** 3 * segment[6],
      ]);
    }
    start = [segment[5], segment[6]];
  }
  return points;
}

function inside(point, box) {
  return point[0] > box.x && point[0] < box.x + box.width && point[1] > box.y && point[1] < box.y + box.height;
}

test('G6 3D points produce valid, deterministic 2D drawing commands', () => {
  const a = sketchEdgeRoute([10, 20, 4], [410, 120, 9], 25);
  assert.deepEqual(a, sketchEdgeRoute([10, 20, 4], [410, 120, 9], 25));
  assert.equal(a.path[0].length, 3);
  assert.ok(a.path.slice(1).every((segment) => segment.length === 7));
  assert.ok(a.path.every((segment) => segment.slice(1).every(Number.isFinite)));
  const end = a.path.at(-1).slice(-2);
  assert.ok(Math.abs(end[0] - 410) < .001 && Math.abs(end[1] - 120) < .001);
});

test('long clear routes keep a compact optional loop and a small gesture', () => {
  const loop = sketchEdgeRoute([0, 0], [400, 0], 10, { loop: true });
  const simple = sketchEdgeRoute([0, 0], [400, 0], 11, { loop: false });
  const loopPoints = sampledPoints(loop.path);
  assert.ok(loop.path.length > 2);
  assert.ok(Math.max(...loopPoints.map((point) => Math.abs(point[1]))) <= 18);
  assert.ok(loop.length < 450);
  assert.notEqual(loop.d, simple.d);
});

test('routes detour around unrelated card interiors with compact rounded corners', () => {
  const card = { id: 'middle', x: 150, y: -40, width: 100, height: 80 };
  const route = sketchEdgeRoute([0, 0, 0], [400, 0, 0], 3, {
    obstacles: [
      { id: 'source', x: -90, y: -60, width: 80, height: 120 },
      card,
      { id: 'target', x: 410, y: -60, width: 80, height: 120 },
    ],
    sourceId: 'source',
    targetId: 'target',
    loop: true,
  });
  assert.ok(route.path.length > 2);
  assert.ok(sampledPoints(route.path).every((point) => !inside(point, card)));
  assert.ok(route.path.every((segment) => segment.slice(1).every(Number.isFinite)));
  assert.deepEqual(route, sketchEdgeRoute([0, 0, 0], [400, 0, 0], 3, {
    obstacles: [
      { id: 'source', x: -90, y: -60, width: 80, height: 120 },
      card,
      { id: 'target', x: 410, y: -60, width: 80, height: 120 },
    ],
    sourceId: 'source',
    targetId: 'target',
    loop: true,
  }));
});

test('occupied routes add a deterministic crossing detour when a channel exists', () => {
  const occupied = { path: [['M', 200, -50], ['C', 200, -20, 200, 20, 200, 50]] };
  const options = { occupiedRoutes: [occupied], loop: false };
  const route = sketchEdgeRoute([0, 0], [400, 0], 1, options);
  assert.ok(route.path.length > 2);
  assert.ok(sampledPoints(route.path).every(([x, y]) => Math.abs(x - 200) > 1 || Math.abs(y) > 50));
  assert.deepEqual(route, sketchEdgeRoute([0, 0], [400, 0], 1, options));
});

test('short or coincident connections stay finite', () => {
  for (const target of [[30, 10], [0, 0]]) {
    const route = sketchEdgeRoute([0, 0], target, 5, { loop: true });
    assert.ok(Number.isFinite(route.length));
    assert.ok(!route.d.includes('NaN'));
  }
});
