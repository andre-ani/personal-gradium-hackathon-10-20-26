import test from 'node:test';
import assert from 'node:assert/strict';
import { coverCrop, inkFocus, resolveIllustrationUrl } from '../frontend/illustration-layer.js';

const origin = 'http://127.0.0.1:8000';

test('illustration URLs resolve against the page origin and refuse other origins', () => {
  assert.equal(resolveIllustrationUrl('/api/illustrations/abc', origin), `${origin}/api/illustrations/abc`);
  assert.equal(resolveIllustrationUrl('api/illustrations/abc', origin), `${origin}/api/illustrations/abc`);
  assert.equal(resolveIllustrationUrl(`${origin}/api/illustrations/abc`, origin), `${origin}/api/illustrations/abc`);
  assert.equal(resolveIllustrationUrl('https://cdn.example.com/a.png', origin), null);
  assert.equal(resolveIllustrationUrl('//cdn.example.com/a.png', origin), null);
  assert.equal(resolveIllustrationUrl('javascript:alert(1)', origin), null);
  assert.equal(resolveIllustrationUrl('data:text/html,<b>x</b>', origin), null);
  assert.match(resolveIllustrationUrl('data:image/svg+xml;charset=utf-8,%3Csvg%3E', origin), /^data:image\/svg/);
  assert.equal(resolveIllustrationUrl('', origin), null);
  assert.equal(resolveIllustrationUrl('/api/illustrations/abc', undefined), null);
});

test('cover crop fills the card and centres the subject as far as the image allows', () => {
  const centred = coverCrop(1024, 1024, 250, 148);
  assert.equal(centred.dw, 250); assert.equal(centred.dh, 250);
  assert.equal(centred.dx, 0); assert.equal(centred.dy, (148 - 250) / 2);
  // A subject high in the picture moves the crop up, never past the image edge.
  const high = coverCrop(1024, 1024, 250, 148, [.5, .3]);
  assert.equal(high.dy, 74 - .3 * 250);
  const top = coverCrop(1024, 1024, 250, 148, [.5, 0]);
  assert.equal(top.dy, 0);
  const bottom = coverCrop(1024, 1024, 250, 148, [.5, 1]);
  assert.equal(bottom.dy, 148 - 250);
  for (const crop of [centred, high, top, bottom]) {
    assert.ok(crop.dx <= 0 && crop.dy <= 0 && crop.dx + crop.dw >= 250 && crop.dy + crop.dh >= 148);
  }
});

test('ink focus finds the centre of the drawn subject inside white margins', () => {
  const size = 10, data = new Uint8ClampedArray(size * size * 4).fill(255);
  assert.equal(inkFocus(data, size, size), null);
  for (const [x, y] of [[2, 1], [5, 3]]) data.set([20, 20, 20, 255], (y * size + x) * 4);
  assert.deepEqual(inkFocus(data, size, size), [.4, .25]);
});
