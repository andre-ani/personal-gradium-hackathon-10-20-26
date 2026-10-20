import test from 'node:test';
import assert from 'node:assert/strict';
import { drawWashiTape } from '../frontend/washi-tape.js';

function render(id, progress = 1) {
  const shapes = new Map();
  const node = { id, getSize: () => [250, 148], upsert(key, _type, style) { if (style) shapes.set(key, style); } };
  drawWashiTape(node, { tape1Progress: progress, tape2Progress: progress }, {});
  return shapes;
}

test('both corner tabs cross the corner on a rising diagonal', () => {
  for (let i = 0; i < 40; i++) {
    const shapes = render(`note-${i}`);
    for (let corner = 0; corner < 2; corner++) {
      const angle = shapes.get(`washi-tape-${corner}-body`).transform[1][1];
      assert.ok(angle < -15 && angle > -50);
    }
  }
});

test('placement and angles vary across notes but remain stable on redraw', () => {
  assert.deepEqual(render('same-note'), render('same-note'));
  const positions = new Set(), angles = new Set();
  for (let i = 0; i < 30; i++) {
    const transform = render(`note-${i}`).get('washi-tape-1-body').transform;
    positions.add(JSON.stringify(transform[0]));
    angles.add(transform[1][1].toFixed(1));
  }
  assert.ok(positions.size > 20);
  assert.ok(angles.size > 20);
});

test('printed motifs share the tape transform throughout the reveal', () => {
  const fills = new Set();
  for (let i = 0; i < 16; i++) {
    for (const progress of [0.5, 1]) {
      const shapes = render(`pattern-${i}`, progress);
      for (let corner = 0; corner < 2; corner++) {
        const body = shapes.get(`washi-tape-${corner}-body`);
        const pattern = shapes.get(`washi-tape-${corner}-pattern`);
        assert.ok(pattern?.d);
        assert.deepEqual(pattern.transform, body.transform);
        fills.add(pattern.fill);
      }
    }
  }
  assert.ok(fills.has('none')); // Printed sprinkles use strokes.
  assert.ok(fills.size > 1); // Stars, dots and hearts use filled motifs.
});
