import { animate, spring } from 'motion';

const WORD_INTERVAL = 90;
const GAP = 7;
// Words sit on a large circle above Cara and tilt with it.
const RISE = 20;
// Fade zones sit outside the resting line, so only arriving/leaving words fade.
const EDGE = 40;
const BOIL_ID = 'speech-ink-boil';

// Hand-drawn "line boil": a slight displacement whose noise seed flips a few
// times a second, like redrawn animation frames.
function ensureBoil() {
  let filter = document.getElementById(BOIL_ID);
  if (!filter) {
    const holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    holder.setAttribute('width', '0'); holder.setAttribute('height', '0');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.position = 'absolute';
    holder.innerHTML = `<filter id="${BOIL_ID}" x="-5%" y="-20%" width="110%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".055" numOctaves="2" seed="1"/><feDisplacementMap in="SourceGraphic" scale="2.4" xChannelSelector="R" yChannelSelector="G"/></filter>`;
    document.body.append(holder);
    filter = holder.firstElementChild;
  }
  return filter.querySelector('feTurbulence');
}

/**
 * A bounded, word-by-word caption lane. Full text stays in the transcript.
 * `width`/`radius` size the arc; `variant` adds a class (e.g. inner/outer).
 */
export function createSpeechRibbon(dock, isReduced = () => false, { width: WIDTH = 300, radius: RADIUS = 420, variant = '' } = {}) {
  const lane = document.createElement('div');
  lane.className = `speech-ribbon${variant ? ` speech-ribbon--${variant}` : ''}`;
  lane.setAttribute('aria-hidden', 'true');
  dock.append(lane);
  const turbulence = ensureBoil();
  let boilFrame = 0;
  const boil = setInterval(() => {
    if (isReduced() || !words.length) return;
    boilFrame = (boilFrame + 1) % 3;
    turbulence.setAttribute('seed', String(boilFrame + 1));
  }, 140);
  let queue = [], words = [], cursor = 0, timer = null, disposed = false, turn = null;
  const exiting = new Set();

  // Words travel along the arc: position, drop and tilt all follow x.
  const place = word => {
    const centre = Math.max(-RADIUS, Math.min(RADIUS, word.x + word.width / 2 - WIDTH / 2));
    const drop = RADIUS - Math.sqrt(RADIUS * RADIUS - centre * centre);
    const tilt = Math.asin(centre / RADIUS) * 180 / Math.PI;
    word.el.style.transform = `translate(${(word.x + EDGE).toFixed(1)}px, ${(drop + word.lift).toFixed(1)}px) rotate(${tilt.toFixed(2)}deg)`;
    word.el.style.opacity = String(word.opacity);
  };
  const stop = word => { word.slide?.stop(); word.fade?.stop(); };
  const slideTo = (word, x) => {
    word.slide?.stop();
    if (isReduced()) { word.x = x; place(word); return; }
    word.slide = animate(word.x, x, { type: spring, stiffness: 300, damping: 32, mass: .9,
      onUpdate: value => { word.x = value; place(word); } });
  };
  // Leaving mirrors arriving: the word sinks back down where it stands.
  const exit = (word, duration = .32) => {
    word.fade?.stop(); exiting.add(word);
    if (isReduced()) { word.el.remove(); exiting.delete(word); return; }
    word.fade = animate(0, 1, { duration, ease: [.55, 0, .75, .4],
      onUpdate: p => { word.lift = RISE * p; word.opacity = 1 - p; place(word); } });
    word.fade.then(() => { word.slide?.stop(); word.el.remove(); exiting.delete(word); });
  };

  function next() {
    timer = null;
    if (disposed || !queue.length) return;
    const item = queue.shift();
    // A new turn never overlaps the last one: old words clear out to the left
    // first, and the new line starts only once they're gone.
    if (turn !== null && turn !== item.turn && words.length) {
      for (const word of words) { slideTo(word, -word.width - EDGE); exit(word, .2); }
      words = []; cursor = 0; turn = item.turn;
      queue.unshift(item);
      timer = setTimeout(next, isReduced() ? 0 : 240);
      return;
    }
    turn = item.turn;
    const el = document.createElement('span');
    el.className = 'speech-word'; el.textContent = item.text;
    el.style.opacity = '0';
    lane.append(el);
    const word = { el, start: cursor, width: el.offsetWidth, x: 0, lift: RISE, opacity: 0 };
    cursor += word.width + GAP;
    // Leave room at the leading edge for the tilt of the newest word.
    const offset = Math.max(0, cursor - GAP - (WIDTH - 22));
    word.x = word.start - offset;
    place(word);
    words.push(word);
    const keep = [];
    for (const current of words) {
      const target = current.start - offset;
      if (target < 0) { slideTo(current, target - 8); exit(current); continue; }
      keep.push(current);
      if (current !== word) slideTo(current, target);
    }
    words = keep;
    // Arriving: rise from just below the arc at the leading edge.
    if (isReduced()) { word.lift = 0; word.opacity = 1; place(word); }
    else word.fade = animate(0, 1, { duration: .38, ease: [.22, 1, .36, 1],
      onUpdate: p => { word.lift = RISE * (1 - p); word.opacity = p; place(word); } });
    if (queue.length) timer = setTimeout(next, WORD_INTERVAL);
  }
  const clear = () => {
    clearTimeout(timer); timer = null; queue = []; cursor = 0; turn = null;
    for (const word of [...words, ...exiting]) { stop(word); word.el.remove(); }
    words = []; exiting.clear();
  };
  return {
    append(text, { speaker = 'user', turnId } = {}) {
      if (disposed) return;
      const key = `${speaker}:${turnId ?? 'current'}`;
      const additions = String(text).match(/\S+/g) || [];
      queue.push(...additions.map(text => ({ text, turn: key })));
      queue = queue.slice(-96);
      if (!timer && queue.length) next();
    },
    /** Words currently on the arc, for compositing captions elsewhere. */
    snapshot() {
      return words.map(word => ({ text: word.el.textContent, x: word.x, width: word.width, lift: word.lift, opacity: word.opacity }));
    },
    reduce() {
      for (const word of words) { stop(word); word.lift = 0; word.opacity = 1; place(word); }
      for (const word of exiting) { stop(word); word.el.remove(); }
      exiting.clear();
    },
    clear,
    dispose() { disposed = true; clearInterval(boil); clear(); lane.remove(); },
  };
}

export const SPEECH_ARC = Object.freeze({ width: 300, radius: 420, edge: EDGE });
