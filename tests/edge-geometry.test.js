import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_TURN_RADIUS, inkArrowPath, minTurnRadius, sketchEdgeRoute, sketchEdgeScale, sketchLoopPlan } from '../frontend/edge-geometry.js';

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

test('an optional loop is one generous curl partway along a long route', () => {
  const loop = sketchEdgeRoute([0, 0], [600, 0], 10, { loop: true });
  const simple = sketchEdgeRoute([0, 0], [600, 0], 10, { loop: false });
  assert.ok(loop.loop, 'a forced loop fits on a long clear route');
  assert.ok(loop.loop.at >= 0.3 && loop.loop.at <= 0.7);
  assert.ok(loop.loop.radius >= 14 && loop.loop.radius <= 22);
  assert.ok(Math.max(...sampledPoints(loop.path).map((point) => Math.abs(point[1]))) <= loop.loop.radius * 2 + 1);
  assert.notEqual(loop.d, simple.d);
  assert.equal(sketchEdgeRoute([0, 0], [200, 0], 10, { loop: true }).loop, undefined, 'short edges never loop');
});

test('loops stay rare and deterministic across seeds', () => {
  const enabled = Array.from({ length: 400 }, (_, seed) => sketchLoopPlan(seed).enabled).filter(Boolean).length;
  assert.ok(enabled > 40 && enabled < 120, `about one in five edges loop (${enabled}/400)`);
  assert.deepEqual(sketchLoopPlan('edge-a'), sketchLoopPlan('edge-a'));
});

test('routes bend smoothly around unrelated card interiors', () => {
  const card = { id: 'middle', x: 150, y: -40, width: 100, height: 80 };
  const options = {
    obstacles: [
      { id: 'source', x: -90, y: -60, width: 80, height: 120 },
      card,
      { id: 'target', x: 410, y: -60, width: 80, height: 120 },
    ],
    sourceId: 'source',
    targetId: 'target',
    sourceNormal: [1, 0],
    targetNormal: [-1, 0],
    loop: false,
  };
  const route = sketchEdgeRoute([-10, 0], [410, 0], 3, options);
  assert.ok(route.path.length > 2);
  assert.ok(sampledPoints(route.path).every((point) => !inside(point, card)));
  assert.ok(minTurnRadius(route.path) >= MIN_TURN_RADIUS * 0.9);
  assert.deepEqual(route, sketchEdgeRoute([-10, 0], [410, 0], 3, options));
});

test('edge size varies by seed between 0.8x and 1.5x', () => {
  const scales = Array.from({ length: 200 }, (_, seed) => sketchEdgeScale(`edge-${seed}`));
  assert.ok(scales.every((scale) => scale >= 0.8 && scale <= 1.5));
  assert.ok(Math.max(...scales) - Math.min(...scales) > 0.5);
  assert.equal(sketchEdgeScale('edge-1'), sketchEdgeScale('edge-1'));
});

test('short or coincident connections stay finite', () => {
  for (const target of [[30, 10], [0, 0]]) {
    const route = sketchEdgeRoute([0, 0], target, 5, { loop: true });
    assert.ok(Number.isFinite(route.length));
    assert.ok(!route.d.includes('NaN'));
  }
});

test('ink arrows carry their tip a few pixels past the route end, inside the target card', () => {
  const route = sketchEdgeRoute([0, 0], [300, 0], 4, { loop: false, sourceNormal: [1, 0], targetNormal: [-1, 0] });
  const xs = (d) => [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((match) => Number(match[1]));
  const flush = Math.max(...xs(inkArrowPath(route, 4, { width: 3, head: 12 }).d));
  const inside = Math.max(...xs(inkArrowPath(route, 4, { width: 3, head: 12, overlap: 8 }).d));
  assert.ok(inside - flush > 6 && inside - flush < 10);
  assert.equal(inkArrowPath(route, 4, { progress: 0, overlap: 8 }).d, '', 'an undrawn arrow has no ink');
});
