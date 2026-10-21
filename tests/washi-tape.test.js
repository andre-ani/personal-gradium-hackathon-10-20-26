import test from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE } from '../frontend/palette.js';
import { TAPE_DESIGNS, drawWashiTape, tapeColours, tapeDesignFor } from '../frontend/washi-tape.js';

function render(id, progress = 1, extra = {}) {
  const shapes = new Map();
  const node = { id, getSize: () => [250, 148], upsert(key, _type, style) { if (style) shapes.set(key, style); } };
  drawWashiTape(node, { tape1Progress: progress, tape2Progress: progress, ...extra }, {});
  return shapes;
}

test('both corner tabs cross the corner on a rising diagonal', () => {
  for (let i = 0; i < 40; i++) {
    const shapes = render(`note-${i}`);
    for (let corner = 0; corner < 2; corner++) {
      const angle = shapes.get(`washi-tape-${corner}-body`).transform[1][1];
      assert.ok(angle < -9 && angle > -50);
    }
  }
});

test('placement, angles, designs and colours vary across notes but remain stable on redraw', () => {
  assert.deepEqual(render('same-note'), render('same-note'));
  assert.deepEqual(render('same-note', 1, { decorationPalette: 'rose' }), render('same-note', 1, { decorationPalette: 'rose' }));
  const positions = new Set(), angles = new Set(), designs = new Set(), combos = new Set();
  for (let i = 0; i < 40; i++) {
    const transform = render(`note-${i}`).get('washi-tape-1-body').transform;
    positions.add(JSON.stringify(transform[0]));
    angles.add(transform[1][1].toFixed(1));
    designs.add(tapeDesignFor(`note-${i}`));
    combos.add(tapeColours(`note-${i}`).combo);
  }
  assert.ok(positions.size > 20);
  assert.ok(angles.size > 20);
  assert.ok(designs.size >= 8);
  assert.ok(combos.size >= 8);
});

test('every design prints on the tape and shares its transform throughout the reveal', () => {
  const fills = new Set();
  for (const design of TAPE_DESIGNS) {
    for (const progress of [0.5, 1]) {
      const shapes = render(`pattern-${design}`, progress, { tapeDesign: design });
      for (let corner = 0; corner < 2; corner++) {
        const body = shapes.get(`washi-tape-${corner}-body`);
        const pattern = shapes.get(`washi-tape-${corner}-pattern`);
        assert.ok(pattern?.d, design);
        assert.doesNotMatch(pattern.d, /NaN/);
        assert.deepEqual(pattern.transform, body.transform);
        assert.equal(body.blend, 'multiply');
        assert.ok(body.opacity < 1);
        fills.add(pattern.fill);
      }
    }
  }
  assert.ok(fills.has('none')); // Stripes, squiggles and fibres are strokes.
  assert.ok(fills.size > 1); // Dots, stars and hearts are filled.
  assert.ok(render('tone', 1, { tapeDesign: 'gingham' }).get('washi-tape-0-tone')?.d);
  assert.ok(render('tone', 1, { tapeDesign: 'two-tone' }).get('washi-tape-0-tone')?.d);
});

test('tape colours coordinate with the card palette', () => {
  for (const key of Object.keys(PALETTE)) {
    for (let i = 0; i < 12; i++) {
      const colours = tapeColours(`card-${i}`, key);
      assert.ok(colours.combo.split('+').includes(key), `${key}: ${colours.combo}`);
    }
  }
  const pattern = render('rose-card', 1, { decorationPalette: 'rose' }).get('washi-tape-0-pattern');
  const inks = new Set([...Object.values(PALETTE).map(({ ink }) => ink), '#efe2c2']);
  assert.ok(inks.has(pattern.fill === 'none' ? pattern.stroke : pattern.fill));
});

test('fully laid strips have torn ends on both sides', () => {
  const settled = render('torn').get('washi-tape-0-body').d;
  const peeling = render('torn', 0.6).get('washi-tape-0-body').d;
  assert.ok(settled.split('L').length > peeling.split('L').length);
});
