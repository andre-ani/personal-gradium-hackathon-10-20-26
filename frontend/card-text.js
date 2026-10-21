/**
 * Card text layout and word-by-word motion for the sketch cards.
 *
 * The pure half (layout choice, wrapping, card layout, word diff, timing)
 * has no canvas dependency so it is unit tested directly. The small runtime
 * half animates per-word text shapes with one shared frame loop, using the
 * caption arc's motion: words rise in while fading, sink out while fading.
 */

export const WORD_RISE = 20;
export const WORD_ENTER = { duration: 380, ease: [0.22, 1, 0.36, 1] };
export const WORD_EXIT = { duration: 320, ease: [0.55, 0, 0.75, 0.4] };
export const CARD_GROW = { duration: 420, ease: [0.22, 1, 0.36, 1] };

const SPARSE_MAX_WORDS = 4;
const SPARSE_MAX_CHARS = 28;
const RICH_MIN_WORDS = 6;
const RICH_MIN_CHARS = 35;

export function splitWords(text) {
  return String(text ?? '').trim().split(/\s+/).filter(Boolean);
}

/**
 * Sparse (icon centred above a centred heading) or rich (small heading at the
 * top-left with an inline icon, body below). Any body text means rich. A
 * heading-only card enters rich when it gets long and only returns to sparse
 * once it is clearly short again, so edits near the threshold never flip.
 */
export function chooseCardLayout({ heading = '', body = '', previous } = {}) {
  if (splitWords(body).length) return 'rich';
  const words = splitWords(heading).length;
  const chars = String(heading).trim().length;
  if (previous === 'rich') return words <= SPARSE_MAX_WORDS && chars <= SPARSE_MAX_CHARS ? 'sparse' : 'rich';
  return words >= RICH_MIN_WORDS || chars >= RICH_MIN_CHARS ? 'rich' : 'sparse';
}

export const fontString = ({ size, family, weight = 400 }) => `${weight} ${size}px ${family}`;

/**
 * Greedy word wrap with measured widths. Returns lines of `{ text, x, width }`
 * words (x relative to the line start). Overflowing text ends with an ellipsis.
 */
export function wrapWords(text, { maxWidth, measure, font, maxLines = Infinity }) {
  const words = Array.isArray(text) ? text : splitWords(text);
  const space = measure(' ', font);
  const lines = [];
  let line = null;
  for (const word of words) {
    const width = measure(word, font);
    if (line && line.width + space + width <= maxWidth) {
      line.words.push({ text: word, x: line.width + space, width });
      line.width += space + width;
    } else {
      line = { words: [{ text: word, x: 0, width }], width };
      lines.push(line);
    }
  }
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, Math.max(1, maxLines));
  const last = kept[kept.length - 1];
  const ellipsis = '…';
  for (;;) {
    const tail = last.words[last.words.length - 1];
    const text = tail.text.replace(/[.,;:!?…-]+$/, '') + ellipsis;
    const width = measure(text, font);
    if (tail.x + width <= maxWidth || last.words.length === 1) {
      last.words[last.words.length - 1] = { text, x: tail.x, width };
      last.width = tail.x + width;
      return kept;
    }
    last.words.pop();
  }
}

/**
 * Card-local layout (origin at the card's top-left). Each word carries a key
 * from its role, text, position and size: an identical key means the word did
 * not change or move, so it can stay on screen untouched.
 */
export function layoutCard({
  width, height, padding = 20, mode = 'sparse', heading = '', body = '', hasIcon = false,
  headingFont, bodyFont, bodyLineHeight, measure,
}) {
  const words = [];
  const place = (lines, role, font, lineHeight, top, alignLine) => {
    lines.forEach((line, index) => {
      const left = alignLine(line);
      for (const word of line.words) {
        const x = Math.round((left + word.x) * 10) / 10;
        const y = Math.round((top + index * lineHeight) * 10) / 10;
        words.push({ key: `${role}|${word.text}|${x}|${y}|${font.size}`, role, text: word.text, x, y, width: word.width, font });
      }
    });
    return top + lines.length * lineHeight;
  };
  const inner = Math.max(1, width - padding * 2);
  if (mode === 'sparse') {
    const font = headingFont;
    const lineHeight = Math.round(font.size * 1.12);
    // Scale the icon to the card so the icon + title pair always sits centred
    // with room around it, even on short cards.
    const iconSize = hasIcon ? Math.round(Math.min(40, font.size * 1.15, height * 0.3)) : 0;
    const gap = iconSize ? Math.round(font.size * 0.16) : 0;
    const maxLines = Math.max(1, Math.min(3, Math.floor((height - padding - iconSize - gap) / lineHeight)));
    const lines = wrapWords(heading, { maxWidth: inner, measure, font, maxLines });
    const block = iconSize + gap + lines.length * lineHeight;
    const top = Math.max(padding * 0.6, (height - block) / 2);
    const bottom = place(lines, 'heading', font, lineHeight, top + iconSize + gap, (line) => (width - line.width) / 2);
    return {
      mode,
      icon: iconSize ? { x: (width - iconSize) / 2, y: top, size: iconSize } : null,
      words,
      contentHeight: bottom + padding * 0.6,
    };
  }
  const font = { ...headingFont, size: Math.round(headingFont.size * 0.76) };
  const lineHeight = Math.round(font.size * 1.15);
  const iconSize = hasIcon ? Math.round(font.size * 1.05) : 0;
  const left = padding + (iconSize ? iconSize + 7 : 0);
  const headingLines = wrapWords(heading, { maxWidth: Math.max(1, width - padding - left), measure, font, maxLines: 2 });
  let bottom = place(headingLines, 'heading', font, lineHeight, padding, () => left);
  const bodyText = splitWords(body);
  if (bodyText.length) {
    const lh = bodyLineHeight ?? Math.round(bodyFont.size * 1.45);
    const top = bottom + Math.round(font.size * 0.4);
    const maxLines = Math.max(1, Math.floor((height - padding * 0.75 - top) / lh));
    const lines = wrapWords(bodyText, { maxWidth: inner, measure, font: bodyFont, maxLines });
    bottom = place(lines, 'body', bodyFont, lh, top, () => padding);
  }
  return {
    mode,
    icon: iconSize ? { x: padding, y: padding + (lineHeight - iconSize) / 2 - 1, size: iconSize } : null,
    words,
    contentHeight: bottom + padding * 0.75,
  };
}

/** Which word keys stay, which leave and which enter. */
export function diffWords(previous, next) {
  const before = new Set(previous.map((word) => word.key));
  const after = new Set(next.map((word) => word.key));
  return {
    stay: next.filter((word) => before.has(word.key)),
    leave: previous.filter((word) => !after.has(word.key)),
    enter: next.filter((word) => !before.has(word.key)),
  };
}

const enterStagger = (count) => (count > 1 ? Math.max(22, Math.min(55, 1600 / count)) : 0);
const leaveStagger = (count) => (count > 1 ? Math.max(14, Math.min(40, 640 / count)) : 0);

/**
 * Start delays (ms) for a diff: leaving words sink one after another, then the
 * entering words rise one after another once the last leaver has gone.
 */
export function planWordMotion({ leave = [], enter = [] }, { minEnterDelay = 0 } = {}) {
  const out = leave.map((word, index) => ({ key: word.key, delay: Math.round(index * leaveStagger(leave.length)) }));
  const leaveEnd = leave.length ? out[out.length - 1].delay + WORD_EXIT.duration : 0;
  const start = Math.max(leaveEnd, minEnterDelay);
  const step = enterStagger(enter.length);
  const into = enter.map((word, index) => ({ key: word.key, delay: Math.round(start + index * step) }));
  return { leave: out, enter: into, total: into.length ? into[into.length - 1].delay + WORD_ENTER.duration : leaveEnd };
}

/** CSS-style cubic-bezier easing. */
export function cubicBezier([x1, y1, x2, y2]) {
  const at = (a, b, t) => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
  const slope = (a, b, t) => 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i += 1) {
      const d = slope(x1, x2, t);
      if (Math.abs(d) < 1e-6) break;
      t -= (at(x1, x2, t) - x) / d;
    }
    t = Math.max(0, Math.min(1, t));
    return at(y1, y2, t);
  };
}

const easeEnter = cubicBezier(WORD_ENTER.ease);
const easeExit = cubicBezier(WORD_EXIT.ease);
export const easeGrow = cubicBezier(CARD_GROW.ease);

export const wordRise = (fontSize) => Math.min(WORD_RISE, Math.max(8, fontSize * 0.8));

/** Icon glide between layouts: eased position and size, dipping opacity mid-way. */
export function iconFrame(from, to, progress) {
  const p = easeGrow(progress);
  const mix = (a, b) => a + (b - a) * p;
  return {
    x: mix(from.x, to.x), y: mix(from.y, to.y), size: mix(from.size, to.size),
    alpha: 1 - 0.6 * Math.sin(Math.PI * Math.max(0, Math.min(1, progress))),
  };
}

// --- runtime -------------------------------------------------------------

const ticking = new Set();
let frameHandle = 0;
const now = () => globalThis.performance?.now?.() ?? Date.now();
function tick() {
  frameHandle = 0;
  const time = now();
  for (const item of [...ticking]) if (!item.tick(time)) ticking.delete(item);
  if (ticking.size) frameHandle = requestFrame(tick);
}
const requestFrame = (fn) => (globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(fn) : setTimeout(() => fn(), 16));
/** Run `item.tick(time)` every frame until it returns false. One loop for every card. */
export function startTicking(item) {
  ticking.add(item);
  if (!frameHandle) frameHandle = requestFrame(tick);
}
export const stopTicking = (item) => ticking.delete(item);

const measureCache = new Map();
let measureContext;
const liveCards = new Set();
/** Canvas text measurement with a small cache, cleared when web fonts land. */
export function measureText(text, font) {
  const key = `${fontString(font)}|${text}`;
  let width = measureCache.get(key);
  if (width != null) return width;
  measureContext ??= globalThis.document?.createElement('canvas').getContext('2d');
  if (measureContext) {
    measureContext.font = fontString(font);
    width = measureContext.measureText(text).width;
  } else width = text.length * font.size * 0.46;
  if (measureCache.size > 4000) measureCache.clear();
  measureCache.set(key, width);
  return width;
}
globalThis.document?.fonts?.addEventListener?.('loadingdone', () => {
  measureCache.clear();
  for (const card of liveCards) card.onFontsChanged?.();
});

/**
 * Animated per-word text for one card. `createText(style)` returns a shape with
 * `attr(style)`; `removeText(shape)` detaches it. Positions are card-local and
 * placed against `origin`, so a growing card carries its words with its edge.
 */
export class CardWords {
  constructor({ createText, removeText, reducedMotion = () => false, onFontsChanged }) {
    Object.assign(this, { createText, removeText, reducedMotion, onFontsChanged });
    this.active = new Map();
    this.leaving = [];
    this.origin = [0, 0];
    this.base = 1;
    this.fills = {};
    liveCards.add(this);
  }

  /** Reconcile with the next layout; unchanged words are only restyled. */
  sync(words, { origin = this.origin, opacity = 1, fills = {}, minEnterDelay = 0 } = {}) {
    Object.assign(this, { origin, base: opacity, fills });
    const time = now();
    const reduced = this.reducedMotion();
    const previous = [...this.active.values()].map((entry) => entry.word);
    const diff = diffWords(previous, words);
    if (diff.leave.length || diff.enter.length) {
      const plan = planWordMotion(diff, { minEnterDelay: reduced ? 0 : minEnterDelay });
      for (const { key, delay } of plan.leave) {
        const entry = this.active.get(key);
        this.active.delete(key);
        if (reduced) this.removeText(entry.shape);
        else this.leaving.push({ ...entry, phase: 'leave', start: time + delay, from: entry.alpha ?? 1 });
      }
      const byKey = new Map(words.map((word) => [word.key, word]));
      for (const { key, delay } of plan.enter) {
        const word = byKey.get(key);
        const entry = { word, phase: reduced ? 'rest' : 'enter', start: time + delay, alpha: reduced ? 1 : 0, lift: reduced ? 0 : wordRise(word.font.size) };
        entry.shape = this.createText(this.styleFor(entry));
        this.active.set(key, entry);
      }
    }
    // Keep the newest layout's order for drawing and its fills for every word.
    for (const word of words) {
      const entry = this.active.get(word.key);
      entry.word = word;
      entry.shape.attr(this.styleFor(entry));
    }
    for (const entry of this.leaving) entry.shape.attr(this.styleFor(entry));
    if (this.animating()) startTicking(this);
  }

  /** Move every word with the card's top-left (used while the card resizes). */
  setOrigin(origin) {
    this.origin = origin;
    for (const entry of this.active.values()) entry.shape.attr(this.position(entry));
    for (const entry of this.leaving) entry.shape.attr(this.position(entry));
  }

  animating() {
    return this.leaving.length > 0 || [...this.active.values()].some((entry) => entry.phase === 'enter');
  }

  position(entry) {
    return { x: this.origin[0] + entry.word.x, y: this.origin[1] + entry.word.y + (entry.lift || 0) };
  }

  styleFor(entry) {
    const { word } = entry;
    return {
      ...this.position(entry),
      text: word.text,
      fontFamily: word.font.family,
      fontSize: word.font.size,
      fontWeight: word.font.weight,
      fill: this.fills[word.role] || this.fills.heading || '#173b6b',
      textBaseline: 'top',
      textAlign: 'left',
      opacity: this.base * (entry.alpha ?? 1),
      pointerEvents: 'none',
      zIndex: 2,
    };
  }

  tick(time) {
    for (const entry of this.active.values()) {
      if (entry.phase !== 'enter') continue;
      const p = Math.max(0, Math.min(1, (time - entry.start) / WORD_ENTER.duration));
      const eased = easeEnter(p);
      entry.alpha = eased;
      entry.lift = wordRise(entry.word.font.size) * (1 - eased);
      if (p >= 1) { entry.phase = 'rest'; entry.alpha = 1; entry.lift = 0; }
      entry.shape.attr({ ...this.position(entry), opacity: this.base * entry.alpha });
    }
    this.leaving = this.leaving.filter((entry) => {
      const p = Math.max(0, Math.min(1, (time - entry.start) / WORD_EXIT.duration));
      const eased = easeExit(p);
      entry.alpha = entry.from * (1 - eased);
      entry.lift = wordRise(entry.word.font.size) * eased;
      if (p >= 1) { this.removeText(entry.shape); return false; }
      entry.shape.attr({ ...this.position(entry), opacity: this.base * entry.alpha });
      return true;
    });
    return this.animating();
  }

  destroy() {
    stopTicking(this);
    liveCards.delete(this);
    for (const entry of this.active.values()) this.removeText(entry.shape);
    for (const entry of this.leaving) this.removeText(entry.shape);
    this.active.clear();
    this.leaving = [];
  }
}

const SPARSE_MAX_ASPECT = 1.28;
const sizeMemo = new Map();
globalThis.document?.fonts?.addEventListener?.('loadingdone', () => sizeMemo.clear());

const widest = (lines) => Math.max(0, ...lines.map((line) => line.width));
const truncated = (words, text) => {
  const source = splitWords(text);
  return words.length !== source.length || (words.length > 0 && words.at(-1).text !== source.at(-1));
};

/** Narrowest wrap width that keeps `text` within `lines` lines (balanced lines). */
function balancedWrap(text, lines, { measure, font }) {
  const full = measure(splitWords(text).join(' '), font);
  let low = Math.max(0, ...splitWords(text).map((word) => measure(word, font)));
  let high = Math.max(low, full);
  for (let step = 0; step < 14 && high - low > 1; step += 1) {
    const mid = (low + high) / 2;
    if (wrapWords(text, { maxWidth: mid, measure, font }).length <= lines) high = mid;
    else low = mid;
  }
  return wrapWords(text, { maxWidth: high + 0.01, measure, font });
}

/**
 * Sparse card: width follows the measured heading (wrapping to two or three
 * balanced lines before it gets wide), height fits icon + heading with room,
 * and the result stays between square and about 4:3.
 */
function sparseSize({ heading, hasIcon, headingFont: font, padding, minSize, sparseMaxWidth, measure }) {
  const lineHeight = Math.round(font.size * 1.12);
  const icon = hasIcon ? Math.round(Math.min(40, font.size * 1.15)) : 0;
  const gap = icon ? Math.round(font.size * 0.16) : 0;
  let lines;
  for (let count = 1; count <= 3; count += 1) {
    lines = count === 1 ? wrapWords(heading, { maxWidth: Infinity, measure, font }) : balancedWrap(heading, count, { measure, font });
    if (widest(lines) + padding * 2 <= sparseMaxWidth) break;
  }
  const needWidth = Math.min(sparseMaxWidth, Math.ceil(widest(lines) + padding * 2 + 2));
  const content = icon + gap + Math.min(3, lines.length) * lineHeight;
  const needHeight = Math.ceil(Math.max(content + padding * 1.8, icon / 0.3));
  let width = Math.max(minSize[0], needWidth);
  const height = Math.max(minSize[1], needHeight, Math.ceil(width / SPARSE_MAX_ASPECT));
  width = Math.max(width, height);
  return { width, height, needWidth, needHeight };
}

/**
 * Rich card: try widths from narrow to wide and keep the one whose laid-out
 * text block lands nearest a target aspect (about 1.3 for a sentence, up to
 * 1.6 for a paragraph), so lines are neither long and thin nor tall and narrow.
 */
function richSize({ heading, body, hasIcon, headingFont, bodyFont, padding, minSize, maxSize, measure }) {
  const chars = String(body).trim().length + String(heading).trim().length * 0.5;
  const target = Math.min(1.55, Math.max(1.3, 1.3 + (0.25 * (chars - 60)) / 240));
  const minWidth = minSize[0] + 30;
  const minHeight = minSize[1];
  let best = null;
  const widths = [];
  for (let width = minWidth; width < maxSize[0]; width += 8) widths.push(width);
  widths.push(maxSize[0]);
  for (const width of widths) {
    const layout = layoutCard({ width, height: 10000, padding, mode: 'rich', heading, body, hasIcon, headingFont, bodyFont, measure });
    const headingWords = layout.words.filter((word) => word.role === 'heading');
    if (truncated(headingWords, heading) && width < maxSize[0]) continue;
    const content = Math.ceil(layout.contentHeight);
    const height = Math.min(maxSize[1], Math.max(minHeight, content));
    const overflow = Math.max(0, content - maxSize[1]);
    const score = Math.abs(Math.log(width / height / target)) + (overflow ? 4 + overflow / 40 : 0) + width * 0.0002;
    if (!best || score < best.score) best = { score, width, height, needWidth: width, needHeight: Math.min(maxSize[1], content) };
  }
  return best;
}

/**
 * Content-driven card size. `minSize`, `maxSize` and `sparseMaxWidth` come
 * from the card variant; `wobble` is the seeded [w, h] factor (about ±5%),
 * applied without ever squeezing the text below what it needs.
 */
export function estimateCardSize({
  heading = '', body = '', hasIcon = false, headingFont, bodyFont, padding = 20,
  minSize = [140, 110], maxSize = [400, 280], sparseMaxWidth = 260, wobble = [1, 1], measure,
}) {
  const cacheable = !measure;
  const key = cacheable && JSON.stringify([heading, body, hasIcon, headingFont, bodyFont, padding, minSize, maxSize, sparseMaxWidth, wobble]);
  if (cacheable && sizeMemo.has(key)) return [...sizeMemo.get(key)];
  const options = { heading, body, hasIcon, headingFont, bodyFont, padding, minSize, maxSize, sparseMaxWidth, measure: measure ?? measureText };
  const fit = chooseCardLayout({ heading, body }) === 'sparse' ? sparseSize(options) : richSize(options);
  const size = [
    Math.max(fit.needWidth, Math.round(fit.width * wobble[0])),
    Math.max(fit.needHeight, Math.round(fit.height * wobble[1])),
  ];
  if (cacheable) {
    if (sizeMemo.size > 600) sizeMemo.clear();
    sizeMemo.set(key, size);
  }
  return [...size];
}
