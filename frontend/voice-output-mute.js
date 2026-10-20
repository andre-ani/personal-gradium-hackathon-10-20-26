// Keep the SDK's output analyser upstream of the gain: a silent Cara still speaks visually.
export function createVoiceOutputMute() {
  let processor = null, gain = null, muted = false;
  return {
    attach(next) {
      processor = next;
      gain = next.audioContext.createGain();
      gain.gain.value = muted ? 0 : 1;
      next.outputWorklet.disconnect(next.audioContext.destination);
      next.outputWorklet.connect(gain);
      gain.connect(next.audioContext.destination);
    },
    setMuted(value) {
      muted = Boolean(value);
      if (gain) gain.gain.setTargetAtTime(muted ? 0 : 1, processor.audioContext.currentTime, .015);
      return muted;
    },
    detach() {
      if (gain) { processor.outputWorklet.disconnect(gain); gain.disconnect(); }
      gain = null; processor = null;
    },
  };
}
