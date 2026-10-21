import { animate, hover, press, stagger, spring } from 'motion';

// Browser binding is deliberately deferred so importing the module is SSR-safe.
export function createUIMotion() {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Map();
  const streaming = new WeakMap();
  const cleanup = [];
  let disposed = false;
  let working = false;
  let voiceState = '';
  let meterSource = null;
  let meterFrame = 0;
  let meterSampleTime = -Infinity;
  const meterBars = [...document.querySelectorAll('#audio-meter > span')].slice(0, 5);
  const micRings = [];
  const micButton = document.querySelector('#mic');
  if (micButton) {
    for (let i = 0; i < 2; i++) {
      const ring = document.createElement('span');
      ring.className = 'mic-ring';
      ring.setAttribute('aria-hidden', 'true');
      ring.style.opacity = '0';
      micButton.append(ring);
      micRings.push(ring);
    }
  }
  const find = selector => document.querySelector(selector);
  const settle = (element, finish = false) => {
    const entry = active.get(element);
    if (!entry) return;
    active.delete(element);
    entry.animation.stop();
    if (finish) Object.assign(element.style, entry.final);
    entry.resolve();
  };
  function run(element, frames, options = {}, final = {}) {
    if (!element) return Promise.resolve();
    settle(element);
    if (disposed || media.matches) {
      Object.assign(element.style, final);
      return Promise.resolve();
    }
    let resolve;
    const done = new Promise(r => { resolve = r; });
    const animation = animate(element, frames, { duration: .24, ease: 'easeOut', ...options });
    const entry = { animation, final, resolve };
    active.set(element, entry);
    animation.then(() => {
      if (active.get(element) !== entry) return;
      active.delete(element);
      Object.assign(element.style, final);
      resolve();
    });
    return done;
  }
  const controls = [...document.querySelectorAll('button, select, textarea')];
  const feedback = (element, scale) => {
    if (element.disabled || media.matches || disposed) return;
    run(element, { transform: `scale(${scale})` }, { type: spring, stiffness: 420, damping: 28 }, { transform: `scale(${scale})` });
  };
  cleanup.push(hover(controls, element => {
    feedback(element, 1.035);
    return () => feedback(element, 1);
  }));
  cleanup.push(press(controls.filter(el => el.tagName === 'BUTTON'), element => {
    feedback(element, .96);
    return () => feedback(element, 1);
  }));
  for (const element of controls) {
    const focus = () => feedback(element, 1.015);
    const blur = () => feedback(element, 1);
    element.addEventListener('focus', focus);
    element.addEventListener('blur', blur);
    cleanup.push(() => {
      element.removeEventListener('focus', focus);
      element.removeEventListener('blur', blur);
      element.style.transform = 'none';
    });
  }
  function busy(value) {
    const changed = working !== Boolean(value);
    working = Boolean(value);
    const element = find('#pulse');
    if (!element || (!changed && active.has(element))) return;
    settle(element);
    element.style.opacity = '1';
    element.style.transform = 'none';
    if (working && !media.matches && !disposed) {
      run(element, { opacity: [1, .4, 1], transform: ['scale(1)', 'scale(1.3)', 'scale(1)'] },
        { duration: 1.15, repeat: Infinity, ease: 'easeInOut' }, { opacity: '1', transform: 'none' });
    }
  }
  function resetMeter() {
    for (const bar of meterBars) {
      settle(bar);
      bar.style.transform = 'scaleY(.15)';
    }
  }
  function sampleMeter(now) {
    meterFrame = 0;
    if (!meterSource || disposed) return;
    if (now - meterSampleTime >= 80) {
      meterSampleTime = now;
      let levels;
      try { levels = meterSource(); } catch { levels = null; }
      meterBars.forEach((bar, index) => {
        let peak = 0;
        for (const bins of [levels?.input, levels?.output]) {
          if (!bins?.length) continue;
          const start = Math.floor(index * bins.length / 5);
          const end = Math.max(start + 1, Math.floor((index + 1) * bins.length / 5));
          for (let bin = start; bin < end; bin++) peak = Math.max(peak, bins[bin] || 0);
        }
        const level = Math.max(.15, Math.min(1, peak / 255));
        run(bar, { transform: `scaleY(${level})` }, { duration: .075, ease: 'easeOut' },
          { transform: `scaleY(${level})` });
      });
    }
    meterFrame = requestAnimationFrame(sampleMeter);
  }
  function meter(getLevels) {
    const source = typeof getLevels === 'function' ? getLevels : null;
    if (disposed || source === meterSource) return;
    meterSource = source;
    if (meterFrame) cancelAnimationFrame(meterFrame);
    meterFrame = 0;
    meterSampleTime = -Infinity;
    resetMeter();
    if (meterSource) meterFrame = requestAnimationFrame(sampleMeter);
  }
  resetMeter();
  function voice({ starting = false, listening = false } = {}) {
    const state = listening ? 'listening' : starting ? 'starting' : 'idle';
    if (state === voiceState) return;
    voiceState = state;
    const mic = find('#mic');
    if (!mic) return;
    // The shadow ring never competes with the button's press/hover transform.
    const icon = mic.querySelector('svg');
    settle(icon, true);
    for (const ring of micRings) {
      settle(ring);
      ring.style.opacity = '0';
    }
    mic.style.boxShadow = '';
    if (state !== 'idle' && !media.matches && !disposed) {
      run(icon, { opacity: [1, .45, 1] },
        { duration: listening ? 1.5 : .8, repeat: Infinity, ease: 'easeInOut' }, { opacity: '1' });
      micRings.forEach((ring, index) => run(ring,
        { opacity: [.32, 0], transform: ['scale(1)', 'scale(1.65)'] },
        { duration: listening ? 1.8 : 1.1, delay: index * .65, repeat: Infinity, ease: 'easeOut' },
        { opacity: '0', transform: 'scale(1)' }));
    }
  }
  function reducedChanged() {
    if (media.matches) {
      for (const element of [...active.keys()]) settle(element, true);
      for (const element of controls) element.style.transform = 'none';
      const mic = find('#mic');
      if (mic) mic.style.boxShadow = '';
    } else {
      busy(working);
      const previous = voiceState;
      voiceState = '';
      voice({ starting: previous === 'starting', listening: previous === 'listening' });
    }
  }
  media.addEventListener('change', reducedChanged);
  function dispose() {
    if (disposed) return;
    meter(null);
    disposed = true;
    for (const element of [...active.keys()]) settle(element, true);
    cleanup.forEach(fn => fn());
    media.removeEventListener('change', reducedChanged);
    window.removeEventListener('pagehide', dispose);
    const mic = find('#mic');
    if (mic) mic.style.boxShadow = '';
    micRings.forEach(ring => ring.remove());
  }
  window.addEventListener('pagehide', dispose, { once: true });
  return {
    // Ink settling onto the page: soft blur-in, a short rise, the brand loop
    // drawn with a pencil stroke. No springs; this runs as the splash lifts.
    intro() {
      const soft = [.22, 1, .36, 1];
      const loop = find('.brand svg path');
      if (loop && !media.matches && !disposed) {
        const length = Math.ceil(loop.getTotalLength());
        loop.style.strokeDasharray = `${length}`;
        run(loop, { strokeDashoffset: [length, 0] }, { duration: 1.2, delay: .2, ease: [.45, 0, .2, 1] }, { strokeDashoffset: '0' });
      }
      const elements = [...document.querySelectorAll('.tagline, .header-credit, .graph-label, .bar-side > *, .graph-help, .empty > *, .legend')];
      if (media.matches || disposed) return;
      const delay = stagger(.06, { startDelay: .35 });
      // Plays once, outside the shared per-element slot used by hover/press
      // feedback, so a first hover can't interrupt or replay it.
      elements.forEach((element, index) => animate(element,
        { opacity: [0, 1], translate: ['0 6px', '0 0'] },
        { duration: .7, ease: soft, delay: delay(index, elements.length) }));
    },
    transcript(element, { isNew = false } = {}) {
      const now = performance.now();
      if (!isNew && now - (streaming.get(element) || 0) < 500) return;
      streaming.set(element, now);
      if (isNew) run(element, { opacity: [.25, 1], translate: ['0 8px', '0 0'] },
        { duration: .32 }, { opacity: '1', translate: '0 0' });
      else run(element, { opacity: [.68, 1] }, { duration: .24 }, { opacity: '1' });
    },
    status(element, text) {
      if (!element || element.textContent === text) return;
      element.textContent = text;
      run(element, { opacity: [.35, 1], translate: ['0 3px', '0 0'] },
        { duration: .38, ease: [.22, 1, .36, 1] }, { opacity: '1', translate: '0 0', filter: 'none' });
    },
    busy,
    voice,
    meter,
    panel(element, open) {
      return run(element, { opacity: open ? [.25, 1] : 0, translate: open ? ['18px 0', '0 0'] : '14px 0' },
        { duration: open ? .27 : .18 }, { opacity: open ? '1' : '0', translate: open ? '0 0' : '14px 0' });
    },
    empty(element, visible) {
      return run(element, visible
        ? { opacity: [0, 1], translate: ['0 6px', '0 0'] }
        : { opacity: 0, translate: '0 -4px' },
      { duration: visible ? .6 : .4, ease: [.22, 1, .36, 1] }, { opacity: visible ? '1' : '0', translate: '0 0' });
    },
    // Clearing the map fades the ink out, then the blank sheet settles back.
    erase(element) {
      return run(element, { opacity: [1, 0, 0, 1] },
        { duration: 1.1, times: [0, .35, .55, 1], ease: 'easeInOut' }, { opacity: '1', filter: 'none' });
    },
    clear(elements = []) {
      for (const element of elements) {
        settle(element, true);
        streaming.delete(element);
      }
    },
    dispose,
  };
}
