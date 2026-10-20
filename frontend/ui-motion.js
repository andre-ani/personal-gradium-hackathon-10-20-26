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
    intro() {
      const elements = [...document.querySelectorAll('.brand, .header-actions, .graph-top, .graph-help, .empty > *, .legend, .dock')];
      const delay = stagger(.045, { startDelay: .03 });
      elements.forEach((element, index) => run(element, { opacity: [0, 1] },
        { duration: .5, delay: delay(index, elements.length) }, { opacity: '1' }));
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
      run(element, { opacity: [.55, 1] }, { duration: .22 }, { opacity: '1' });
    },
    busy,
    voice,
    meter,
    panel(element, open) {
      return run(element, { opacity: open ? [.25, 1] : 0, translate: open ? ['18px 0', '0 0'] : '14px 0' },
        { duration: open ? .27 : .18 }, { opacity: open ? '1' : '0', translate: open ? '0 0' : '14px 0' });
    },
    empty(element, visible) {
      return run(element, { opacity: visible ? [0, 1] : 0 }, { duration: .25 }, { opacity: visible ? '1' : '0' });
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
