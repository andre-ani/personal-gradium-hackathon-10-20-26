import { animate, spring } from 'motion';

const WORD_INTERVAL = 90;
const WIDTH = 240;
const GAP = 7;

/** A bounded, word-by-word caption lane. Full text stays in the transcript. */
export function createSpeechRibbon(dock, isReduced = () => false) {
  const lane = document.createElement('div');
  lane.className = 'speech-ribbon';
  lane.setAttribute('aria-hidden', 'true');
  dock.append(lane);
  let queue = [], words = [], cursor = 8, timer = null, disposed = false, turn = null;
  const exiting = new Set();
  const stop = word => { word.slide?.stop(); word.pop?.stop(); };
  const exit = (word, x = word.x - 16) => {
    stop(word); exiting.add(word);
    if (isReduced()) { word.el.remove(); exiting.delete(word); return; }
    word.pop = animate(word.el, { x, y: 16, opacity: 0, scale: .82, rotate: -4 }, { duration: .24, ease: 'easeIn' });
    word.pop.then(() => { word.el.remove(); exiting.delete(word); });
  };
  function next() {
    timer = null;
    if (disposed || !queue.length) return;
    const item = queue.shift();
    if (turn !== null && turn !== item.turn) {
      words.forEach(word => exit(word, word.x - 24)); words = []; cursor = 8;
    }
    turn = item.turn;
    const el = document.createElement('span');
    el.className = 'speech-word'; el.textContent = item.text;
    el.style.cssText = 'opacity:0;transform:translateY(18px) scale(.78);';
    lane.append(el);
    const word = { el, start: cursor, width: el.offsetWidth, x: 0 };
    cursor += word.width + GAP;
    const offset = Math.max(0, cursor - GAP - WIDTH);
    words.push(word);
    const keep = [];
    for (const current of words) {
      current.x = current.start - offset;
      if (current.x < -current.width * .35) { exit(current); continue; }
      keep.push(current);
      current.slide?.stop();
      if (isReduced()) {
        current.el.style.cssText = `opacity:1;transform:translateX(${current.x}px);`;
      } else {
        if (current === word) {
          current.el.style.transform = `translate(${current.x}px,18px) scale(.78)`;
          current.pop = animate(current.el, { y: 0, scale: 1, opacity: 1 }, { type: spring, stiffness: 510, damping: 24, mass: .65 });
        }
        current.slide = animate(current.el, { x: current.x }, { type: spring, stiffness: 440, damping: 32, mass: .8 });
      }
    }
    words = keep;
    if (queue.length) timer = setTimeout(next, WORD_INTERVAL);
  }
  const clear = () => {
    clearTimeout(timer); timer = null; queue = []; cursor = 8; turn = null;
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
    reduce() {
      for (const word of words) { stop(word); word.el.style.cssText = `opacity:1;transform:translateX(${word.x}px);`; }
      for (const word of exiting) { stop(word); word.el.remove(); }
      exiting.clear();
    },
    clear,
    dispose() { disposed = true; clear(); lane.remove(); },
  };
}
