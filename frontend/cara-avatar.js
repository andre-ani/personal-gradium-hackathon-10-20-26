import atlas from './cara-atlas.json' with { type: 'json' };
import { CaraState } from './cara-state.js';
export const CARA_FRAMES = atlas.frames;
export const CARA_FPS = atlas.fps;

export function createCaraAvatar(dock, { readLevels = () => ({}), isReduced = () => false, onMute = () => {} } = {}) {
  const figure = document.createElement('div');
  figure.className = 'cara-avatar';
  figure.insertAdjacentHTML('afterbegin', `<svg width="0" height="0" aria-hidden="true" class="cara-paper-filter"><defs><filter id="cara-paper-ink" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".055 .12" numOctaves="2" seed="9" result="paper"/><feDisplacementMap in="SourceGraphic" in2="paper" scale="1.15" xChannelSelector="R" yChannelSelector="G"/></filter></defs></svg>`);
  const mouth = document.createElement('button');
  mouth.type = 'button'; mouth.className = 'cara-mouth';
  mouth.setAttribute('aria-label', 'Mute Cara’s voice');
  mouth.setAttribute('aria-pressed', 'false');
  mouth.title = 'Mute Cara’s voice';
  mouth.innerHTML = '<svg class="cara-muted-mark" viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><path d="M3 6h3l3-3v10l-3-3H3zM2 2l12 12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  mouth.addEventListener('click', () => onMute(!state.muted));
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 280;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Cara, ready');
  figure.append(canvas, mouth); dock.prepend(figure);
  const context = canvas.getContext('2d');
  const image = new Image();
  let spawnAt = null, spawned = false, lastAsset = '';
  const behavior = new CaraState(performance.now());
  const state = behavior.state;
  let disposed = false, lastFrame = -1, lastMood = '';
  const peak = bins => {
    let value = 0;
    for (const bin of bins || []) value = Math.max(value, Number(bin) || 0);
    return value;
  };
  function tick() {
    if (disposed || document.hidden) return;
    const now = performance.now();
    let output = 0;
    if (state.active && !behavior.outputBlocked) {
      try { output = peak(readLevels().output); } catch { /* Player may be stopping. */ }
    }
    const next = behavior.sample(output, now, isReduced());
    figure.dataset.mood = next.mood;
    if (next.mood !== lastMood) {
      lastMood = next.mood;
      figure.dataset.mood = next.mood;
      canvas.setAttribute('aria-label', `Cara, ${next.mood === 'idle' ? 'ready' : next.mood}${state.muted ? ', voice muted' : ''}`);
    }
    let asset = image, frame = next.frame, box = CARA_FRAMES[frame];
    if (isReduced() || state.active || state.connecting || state.thinking) spawned = true;
    if (!spawned && image.complete && image.naturalWidth) {
      spawnAt ??= now;
      const index = Math.floor((now - spawnAt) / 160);
      if (index < atlas.states.reveal.length) {
        frame = atlas.states.reveal[index]; box = CARA_FRAMES[frame];
        figure.dataset.mood = 'arriving';
      } else spawned = true;
    }
    if ((frame === lastFrame && asset.src === lastAsset) || !asset.complete || !asset.naturalWidth || !context) return;
    lastFrame = frame; lastAsset = asset.src;
    figure.dataset.frame = String(frame);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const [vx,vy,vw,vh] = atlas.viewport;
    context.drawImage(asset, box[0]+vx, box[1]+vy, vw, vh, 6, 8, 308, 260);
  }
  image.onload = () => { lastFrame = -1; tick(); };
  image.onerror = () => { figure.hidden = true; };
  image.src = atlas.image;
  const timer = setInterval(tick, 1000 / CARA_FPS);
  const visible = () => tick();
  document.addEventListener('visibilitychange', visible);
  tick();
  return {
    update(values) {
      behavior.update(values, performance.now());
      if ('muted' in values) {
        figure.dataset.muted = String(state.muted);
        mouth.setAttribute('aria-pressed', String(state.muted));
        mouth.setAttribute('aria-label', state.muted ? 'Unmute Cara’s voice' : 'Mute Cara’s voice');
        mouth.title = state.muted ? 'Unmute Cara’s voice' : 'Mute Cara’s voice';
        lastMood = '';
      }
      tick();
    },
    happy(delighted = false) { behavior.react(delighted ? 'delighted' : 'pleased', performance.now()); tick(); },
    react(name) { behavior.react(name, performance.now(), 2400); tick(); },
    hear() { behavior.hear(performance.now()); tick(); },
    voiceEvent(event) { behavior.voiceEvent(event, performance.now()); tick(); },
    turnFinished() { behavior.turnFinished(); tick(); },
    dispose() { disposed = true; clearInterval(timer); image.onload = null; image.onerror = null;
      document.removeEventListener('visibilitychange', visible); figure.remove(); },
  };
}
