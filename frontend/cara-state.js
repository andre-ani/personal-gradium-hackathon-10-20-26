import atlas from './cara-atlas.json' with { type: 'json' };
const poses = atlas.states;
const modes = new Set(['idle','listening','thinking','drawing','pleased','delighted','curious','puzzled','recovering']);

/** Signal-driven holds. Ten fps is a sampling ceiling, never an instruction to fidget. */
export class CaraState {
  constructor(now = 0) {
    this.state = { active:false, connecting:false, thinking:false, drawing:false, fault:false, muted:false };
    this.mood = 'idle'; this.candidate = 'idle'; this.candidateAt = now;
    this.nextBlink = now + 6100; this.blinkUntil = 0; this.blinks = 0;
    this.heardUntil = 0; this.drawingUntil = 0; this.lastOutput = -Infinity;
    this.voiceThinking = false; this.outputBlocked = true; this.played = false;
    this.reactionUntil = 0; this.reaction = 'pleased'; this.lastReaction = -Infinity;
  }
  update(values, now) {
    Object.assign(this.state, values);
    if (values.drawing) this.drawingUntil = now + 650;
    if (values.active === false) {
      this.voiceThinking = false; this.outputBlocked = true; this.played = false;
      this.lastOutput = -Infinity; this.heardUntil = 0;
    }
  }
  hear(now) { this.heardUntil = now + 1300; this.voiceThinking = false; }
  voiceEvent(event, now) {
    if (event === 'llm_started') { this.voiceThinking = true; this.heardUntil = 0; this.played = false; }
    if (event === 'first_tts_audio') this.outputBlocked = false;
    if (event === 'interrupted') {
      this.outputBlocked = true; this.lastOutput = -Infinity; this.played = false;
      this.hear(now);
    }
  }
  turnFinished() {
    if (this.played) { this.voiceThinking = false; this.outputBlocked = true; this.lastOutput = -Infinity; this.played = false; }
  }
  react(name, now, duration = 1600) {
    if (!modes.has(name) || now - this.lastReaction < 8000) return;
    this.reaction = name; this.reactionUntil = now + duration; this.lastReaction = now;
  }
  sample(output, now, reduced = false) {
    const audible = this.state.active && !this.outputBlocked && output > 18;
    if (audible) { this.lastOutput = now; this.voiceThinking = false; this.played = true; }
    const speaking = this.state.active && !this.outputBlocked && now - this.lastOutput < 240;
    let requested = speaking ? 'speaking'
      : this.state.active && now < this.heardUntil ? 'listening'
      : this.state.connecting || this.voiceThinking ? 'thinking'
      : this.state.fault ? 'recovering'
      : this.state.drawing || now < this.drawingUntil ? 'drawing'
      : this.state.thinking ? 'thinking'
      : now < this.reactionUntil ? this.reaction
      : this.state.active ? 'listening' : 'idle';
    const urgent = speaking || (this.state.active && now < this.heardUntil)
      || (!this.state.active && this.mood === 'speaking');
    if (requested !== this.candidate) { this.candidate = requested; this.candidateAt = now; }
    if (requested !== this.mood && (urgent || now - this.candidateAt >= 250)) {
      this.mood = requested; this.nextBlink = now + 6100; this.blinkUntil = 0;
    }
    // A response ends with a closed mouth immediately, even during the pose hold.
    let frame = this.mood === 'speaking' ? (reduced ? poses.mouthMedium
      : !audible ? poses.idle : output < 60 ? poses.mouthSmall : output < 110 ? poses.mouthRound
      : output < 175 ? poses.mouthMedium : poses.mouthWide) : poses[this.mood];
    if (!reduced && ['idle','listening','drawing'].includes(this.mood)) {
      if (now >= this.nextBlink) {
        this.blinkUntil = now + 120;
        this.nextBlink = now + [6400,7800,5900][this.blinks++ % 3];
      }
      if (now < this.blinkUntil) frame = poses[this.mood === 'idle' ? 'blink' : `${this.mood}Blink`];
    }
    return { mood:this.mood, frame };
  }
}
