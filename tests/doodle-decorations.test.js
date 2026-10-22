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

test('circle and underline follow the laid-out heading words across wrapped lines', async () => {
  const { headingLineGeometry, layoutCard } = await import('../frontend/card-text.js');
  const font = { size: 24, family: 'Patrick Hand', weight: 400 };
  const card = { width: 220, height: 160 };
  const layout = layoutCard({ ...card, padding: 20, mode: 'sparse', heading: 'A rather long heading that wraps',
    headingFont: font, bodyFont: { size: 13, family: 'Patrick Hand' }, measure: text => text.length * 11 });
  const words = layout.words.filter(word => word.role === 'heading');
  const origin = [-card.width / 2, -card.height / 2];
  const geometry = headingLineGeometry(words, origin);
  assert.ok(geometry.lines.length >= 2, 'the heading wraps');
  const frame = { x: origin[0], y: origin[1], ...card };
  const parse = d => d.slice(1).split('L').map(pair => pair.trim().split(' ').map(Number));

  const underlines = doodleStrokes('underline', frame, 'w', { heading: geometry });
  assert.equal(underlines.length, geometry.lines.length);
  underlines.forEach(({ d }, index) => {
    const line = geometry.lines[index], points = parse(d);
    const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
    assert.ok(Math.min(...xs) <= line.minX && Math.max(...xs) >= line.maxX, 'spans its line');
    assert.ok(Math.min(...ys) > line.baseline && Math.max(...ys) < line.baseline + 12, 'just under its baseline');
  });

  const [{ d }] = doodleStrokes('circle', frame, 'w', { heading: geometry });
  const ring = parse(d);
  const cx = (geometry.minX + geometry.maxX) / 2, cy = (geometry.minY + geometry.maxY) / 2;
  // Every word corner lies inside the drawn loop (checked along rays from the centre).
  for (const word of words) {
    const left = origin[0] + word.x, top = origin[1] + word.y;
    for (const [x, y] of [[left, top], [left + word.width, top], [left, top + 24 * 1.04], [left + word.width, top + 24 * 1.04]]) {
      const angle = Math.atan2(y - cy, x - cx), reach = Math.hypot(x - cx, y - cy);
      const near = ring.reduce((best, [px, py]) => {
        const delta = Math.abs(Math.atan2(Math.sin(Math.atan2(py - cy, px - cx) - angle), Math.cos(Math.atan2(py - cy, px - cx) - angle)));
        return delta < best.delta ? { delta, reach: Math.hypot(px - cx, py - cy) } : best;
      }, { delta: Infinity, reach: 0 });
      assert.ok(near.reach > reach, `ring clears ${word.text} at ${x.toFixed(1)},${y.toFixed(1)}`);
    }
  }
});
