import test from 'node:test';
import assert from 'node:assert/strict';
import { DOODLE_TYPES, doodleStrokes, drawDoodleDecoration } from '../frontend/doodle-decorations.js';
import { PALETTE } from '../frontend/palette.js';

const box = { x: -125, y: -74, width: 250, height: 148 };
const heading = { text: 'Making tea', fontSize: 24, minX: -105, minY: -54, maxX: 10, maxY: -28 };

function render(id, attributes) {
  const shapes = new Map();
  const node = { id, getSize: () => [250, 148], upsert(key, _type, style) { shapes.set(key, style); } };
  drawDoodleDecoration(node, { headingText: 'Making tea', ...attributes }, {});
  return shapes;
}

test('every doodle type is seeded, stable and finite', () => {
  for (const type of DOODLE_TYPES) {
    const first = doodleStrokes(type, box, 'card', { heading });
    assert.deepEqual(first, doodleStrokes(type, box, 'card', { heading }));
    assert.ok(first.length >= 1 && first.length <= 8, type);
    for (const stroke of first) {
      assert.doesNotMatch(stroke.d, /NaN|Infinity/);
      assert.ok(stroke.length > 5);
    }
    const other = doodleStrokes(type, box, 'other-card', { heading });
    assert.notDeepEqual(first, other);
  }
});

test('star clusters vary between one and three stars', () => {
  const counts = new Set();
  for (let i = 0; i < 40; i++) counts.add(doodleStrokes('stars', box, `c${i}`).length);
  assert.deepEqual([...counts].sort(), [1, 2, 3]);
});

test('corner doodles sit on or just outside a card corner', () => {
  for (let i = 0; i < 30; i++) {
    for (const type of ['stars', 'sparkle', 'heart', 'burst']) {
      const [{ d }] = doodleStrokes(type, box, `k${i}`);
      const [x, y] = d.slice(1).split(/[ L]/).slice(0, 2).map(Number);
      const nearX = Math.min(Math.abs(x - box.x), Math.abs(x - box.x - box.width));
      const nearY = Math.min(Math.abs(y - box.y), Math.abs(y - box.y - box.height));
      assert.ok(nearX < 34 && nearY < 34, `${type} at ${x},${y}`);
    }
  }
});

test('underline sits below the heading and the circle surrounds its first word', () => {
  const under = doodleStrokes('underline', box, 'u', { heading });
  assert.ok(under[0].d.slice(1).split(' ').map(Number)[1] > heading.maxY);
  const [{ d }] = doodleStrokes('circle', box, 'o', { heading });
  const points = d.slice(1).split('L').map((pair) => pair.trim().split(' ').map(Number));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  assert.ok(Math.min(...xs) < heading.minX && Math.max(...xs) > heading.minX + 40);
  assert.ok(Math.min(...ys) < heading.minY && Math.max(...ys) > heading.minY + 20);
});

test('drawing uses the supplied palette ink, translucent strokes and a progressive reveal', () => {
  const half = render('tea', { decorationType: 'stars', decorationProgress: 0.5, decorationInk: PALETTE.teal.ink });
  const first = half.get('doodle-0');
  assert.equal(first.stroke, PALETTE.teal.ink);
  assert.ok(first.opacity > 0.5 && first.opacity < 1);
  assert.ok(first.lineDash.length === 2 || first.lineDash.length === 0);
  const full = render('tea', { decorationType: 'stars', decorationProgress: 1, decorationInk: PALETTE.teal.ink });
  assert.deepEqual(full.get('doodle-0').lineDash, []);
  assert.ok(full.get('doodle-0').fillOpacity > 0);
  const none = render('tea', { decorationType: 'washi_tape', decorationProgress: 1 });
  assert.equal(none.get('doodle-0'), false);
  const hidden = render('tea', { decorationType: 'heart', decorationProgress: 0 });
  assert.equal(hidden.get('doodle-0'), false);
});
