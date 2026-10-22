import test from 'node:test';
import assert from 'node:assert/strict';
import { elapsed, metaFor, tidy, toneFor } from '../frontend/debug-timeline.js';

test('row text stays bounded and never carries a credential through', () => {
  const long = 'word '.repeat(80);
  const short = tidy(long);
  assert.ok(short.length <= 180, short.length);
  assert.ok(short.endsWith('…'));
  assert.equal(tidy('  two   lines\nhere  '), 'two lines here'); // One line per event.
  assert.equal(tidy('auth sk-livekey01234567890 done'), 'auth [redacted] done');
  assert.equal(tidy('Bearer abcdefgh.ijklmnop'), '[redacted]');
  assert.equal(tidy(undefined), '');
});

test('elapsed reads as tenths of a second, then minutes', () => {
  assert.equal(elapsed(0), '+0.0s');
  assert.equal(elapsed(12_430), '+12.4s');
  assert.equal(elapsed(-5), '+0.0s'); // A clock step back must not print a negative.
  assert.equal(elapsed(61_500), '+1:01');
});

test('stages colour by family, and trouble anywhere wins', () => {
  assert.equal(toneFor('patch', 'rendered'), 'patch');
  assert.equal(toneFor('Mic', 'started'), 'mic');
  assert.equal(toneFor('mic', 'reconnecting'), 'trouble');
  assert.equal(toneFor('interpretation', 'result'), 'think');
  assert.equal(toneFor('whatever', 'fine'), 'plain');
});

test('timings print only the measurements that were supplied', () => {
  assert.equal(metaFor({ duration_ms: 419.6, server_ms: 380, revision: 7 }), '420ms · srv 380ms · r7');
  assert.equal(metaFor({ revision: 0 }), 'r0'); // Revision zero is still a revision.
  assert.equal(metaFor({ duration_ms: undefined, server_ms: null }), '');
});
