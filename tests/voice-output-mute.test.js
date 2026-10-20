import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceOutputMute } from '../frontend/voice-output-mute.js';

test('mute changes only speaker gain and retains the upstream analyser branch', () => {
  const destination = {}, analyser = {}, links = new Set([destination, analyser]);
  const values = [];
  const gain = { gain: { value: 1, setTargetAtTime: value => values.push(value) }, connect: target => assert.equal(target, destination), disconnect() {} };
  const processor = { audioContext: { destination, currentTime: 1, createGain: () => gain }, outputWorklet: {
    disconnect: target => links.delete(target), connect: target => links.add(target),
  } };
  const output = createVoiceOutputMute();
  output.setMuted(true);
  output.attach(processor);
  assert.equal(gain.gain.value, 0); // A pre-muted session cannot leak its first syllable.
  assert.ok(links.has(analyser));
  assert.ok(!links.has(destination));
  output.setMuted(false);
  output.setMuted(true);
  assert.deepEqual(values, [1,0]);
  output.detach();
  assert.ok(links.has(analyser));
  assert.ok(!links.has(gain));
});
