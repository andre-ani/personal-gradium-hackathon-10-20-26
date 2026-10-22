// A development drawer that writes the session's real chronology along the
// bottom edge: recognised and typed text, interpretation turnarounds, patches
// queued and rendered, mic and socket transitions, layout and tool commands.
//
// The drawer takes its band out of the page rather than floating over it: it
// publishes its height as `--thread-debug-height` and takes that band in the
// page's flex layout, so the workspace gets shorter and nothing at the bottom
// of the canvas is hidden. `onResize` tells the host to refit once
// the band changes, including while the divider is dragged.
//
// Rows are appended, never re-rendered, and the list is trimmed to the last
// MAX_ROWS entries, so a long session cannot grow the DOM without bound.

const MAX_ROWS = 250;
const DETAIL_MAX = 180;
const MIN_HEIGHT = 148;
const DEFAULT_HEIGHT = 260;
const STORE_KEY = 'thread.debug-timeline';
const HISTORY_KEY = 'thread.debug-input-history';
const HISTORY_LIMIT = 50;

// Each stage family gets its own ink colour, so a burst reads as shape first.
const STAGE_TONES = {
  text: 'speech', speech: 'speech', transcript: 'speech', utterance: 'speech', thought: 'speech', typed: 'speech',
  interpretation: 'think', semantic: 'think', model: 'think', provider: 'think',
  patch: 'patch', render: 'patch', graph: 'patch', queue: 'patch',
  mic: 'mic', voice: 'mic', audio: 'mic', socket: 'mic', session: 'mic',
  layout: 'layout', view: 'layout', viewport: 'layout', camera: 'layout',
  tool: 'tool', command: 'tool', share: 'tool',
};
const TROUBLE = /error|fail|refus|denied|lost|closed|timeout|abort|retry|reconnect/i;
const SECRETS = /\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9._-]{16,})/g;

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; }
}

function writeStore(patch) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...readStore(), ...patch })); } catch { /* private mode */ }
}

/* The four row formatters are exported so they can be checked without a DOM. */

/** Elapsed since the drawer opened: tenths under a minute, then m:ss. */
export function elapsed(ms) {
  const seconds = Math.max(ms, 0) / 1000;
  if (seconds < 60) return `+${seconds.toFixed(1)}s`;
  return `+${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function tidy(value) {
  const text = String(value ?? '').replace(SECRETS, '[redacted]').replace(/\s+/g, ' ').trim();
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text;
}

export function toneFor(stage, label) {
  if (TROUBLE.test(`${stage} ${label}`)) return 'trouble';
  return STAGE_TONES[String(stage).toLowerCase()] || 'plain';
}

export function metaFor({ duration_ms: duration, server_ms: server, revision }) {
  const parts = [];
  if (Number.isFinite(duration)) parts.push(`${Math.round(duration)}ms`);
  if (Number.isFinite(server)) parts.push(`srv ${Math.round(server)}ms`);
  if (revision !== undefined && revision !== null && revision !== '') parts.push(`r${revision}`);
  return parts.join(' · ');
}

/**
 * Mount the bottom debug drawer.
 *
 * @param {object} options
 * @param {(text: string) => boolean|undefined} [options.onSubmit] Send a typed
 *   thought to the graph. `false` marks the row as rejected and keeps the text;
 *   `true` or `undefined` clears the box.
 * @param {(height: number) => void} [options.onResize] Called with the band's
 *   height in CSS pixels whenever it changes (0 when hidden), after the layout
 *   variable is applied, so the host can refit the viewport.
 * @returns {{record: (event: object) => void, open: () => void, close: () => void,
 *   clear: () => void, height: () => number, element: HTMLElement, dispose: () => void}}
 */
export function createDebugTimeline({ onSubmit, onResize } = {}) {
  const saved = readStore();
  const root = document.documentElement;
  const start = performance.now();
  let disposed = false;
  let open = saved.open !== false;
  let height = clamp(Number(saved.height) || DEFAULT_HEIGHT, MIN_HEIGHT, 1200);
  let following = true;
  let programmaticScroll = false;
  let total = 0;
  let frame = 0;
  let inputHistory = [];
  try {
    const savedHistory = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]');
    if (Array.isArray(savedHistory)) inputHistory = savedHistory.filter(value => typeof value === 'string' && value.trim()).slice(-HISTORY_LIMIT);
  } catch { /* History still works in memory when storage is unavailable. */ }
  let historyIndex = inputHistory.length;
  let draft = '';
  const queued = [];
  const hidden = new Set();
  const chips = new Map();

  const panel = document.createElement('section');
  panel.className = 'dbg';
  panel.id = 'debug-timeline';
  panel.setAttribute('aria-label', 'Debug timeline');
  panel.innerHTML = `
    <div class="dbg-grip" role="separator" aria-orientation="horizontal" tabindex="0"
      aria-label="Resize debug timeline" title="Drag or use arrow keys to resize"></div>
    <div class="dbg-bar">
      <h2 class="dbg-title">Trace</h2>
      <span class="dbg-count" aria-hidden="true"></span>
      <div class="dbg-chips" aria-label="Filter stages" role="group"></div>
      <div class="dbg-tools">
        <button class="dbg-btn" type="button" data-action="pause" aria-pressed="false">Following</button>
        <button class="dbg-btn" type="button" data-action="clear">Clear</button>
        <button class="dbg-btn" type="button" data-action="close" aria-label="Hide debug timeline">Hide</button>
      </div>
    </div>
    <div class="dbg-body">
      <ol class="dbg-log" tabindex="0" aria-label="Session events, newest last"></ol>
      <form class="dbg-form" novalidate>
        <label class="dbg-label-text" for="dbg-thought">Type a thought</label>
        <textarea id="dbg-thought" rows="3" placeholder="Say it here to test the map without the mic."></textarea>
        <div class="dbg-form-foot">
          <span class="dbg-hint">Enter sends · ↑/↓ history · Shift+Enter breaks</span>
          <button class="dbg-send" type="submit">Send</button>
        </div>
      </form>
    </div>
    <p class="dbg-say" role="status"></p>`;

  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'dbg-tab';
  tab.setAttribute('aria-controls', 'debug-timeline');
  tab.textContent = 'Trace';

  document.body.append(panel, tab);
  const grip = panel.querySelector('.dbg-grip');
  const log = panel.querySelector('.dbg-log');
  const count = panel.querySelector('.dbg-count');
  const chipBox = panel.querySelector('.dbg-chips');
  const pauseButton = panel.querySelector('[data-action="pause"]');
  const form = panel.querySelector('.dbg-form');
  const field = panel.querySelector('#dbg-thought');
  const say = panel.querySelector('.dbg-say');

  const maxHeight = () => Math.max(MIN_HEIGHT, Math.min(window.innerHeight * 0.6, window.innerHeight - 220));

  function measureHeader() {
    const bar = document.querySelector('body > header');
    const value = bar ? Math.round(bar.getBoundingClientRect().height) : 64;
    root.style.setProperty('--thread-debug-header', `${value}px`);
  }

  /** Push the band's size into the page; `commit` also asks the host to refit. */
  function applyHeight(commit) {
    const band = open ? clamp(height, MIN_HEIGHT, maxHeight()) : 0;
    root.style.setProperty('--thread-debug-height', `${band}px`);
    panel.style.height = `${clamp(height, MIN_HEIGHT, maxHeight())}px`;
    grip.setAttribute('aria-valuenow', String(Math.round(height)));
    grip.setAttribute('aria-valuemin', String(MIN_HEIGHT));
    grip.setAttribute('aria-valuemax', String(Math.round(maxHeight())));
    onResize?.(band, { interactive: !commit });
  }

  function setOpen(next, { focus = false } = {}) {
    open = next;
    root.classList.toggle('thread-debug-open', open);
    panel.hidden = !open;
    tab.hidden = open;
    tab.setAttribute('aria-expanded', String(open));
    writeStore({ open });
    measureHeader();
    applyHeight(true);
    say.textContent = open ? 'Debug timeline shown.' : 'Debug timeline hidden.';
    if (!focus) return;
    if (open) field.focus();
    else tab.focus();
  }

  function setFollowing(next) {
    following = next;
    pauseButton.textContent = following ? 'Following' : 'Paused';
    pauseButton.setAttribute('aria-pressed', String(!following));
    if (following) scrollToEnd();
  }

  function scrollToEnd() {
    programmaticScroll = true;
    log.scrollTop = log.scrollHeight;
    requestAnimationFrame(() => { programmaticScroll = false; });
  }

  function chipFor(stage) {
    if (chips.has(stage)) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'dbg-chip';
    chip.dataset.stage = stage;
    chip.setAttribute('aria-pressed', 'true');
    chip.textContent = stage;
    chips.set(stage, chip);
    chipBox.append(chip);
  }

  function buildRow(entry) {
    const row = document.createElement('li');
    row.className = 'dbg-row';
    row.dataset.stage = entry.stage;
    row.dataset.tone = entry.tone;
    row.hidden = hidden.has(entry.stage);

    const time = document.createElement('span');
    time.className = 'dbg-t';
    time.textContent = elapsed(entry.at - start);
    time.title = entry.clock;

    const stage = document.createElement('span');
    stage.className = 'dbg-stage';
    stage.textContent = entry.stage;

    const text = document.createElement('span');
    text.className = 'dbg-text';
    const label = document.createElement('b');
    label.className = 'dbg-label';
    label.textContent = entry.label;
    text.append(label);
    if (entry.detail) {
      const detail = document.createElement('span');
      detail.className = 'dbg-detail';
      detail.textContent = entry.detail;
      text.append(detail);
    }

    row.append(time, stage, text);
    if (entry.meta) {
      const meta = document.createElement('span');
      meta.className = 'dbg-meta';
      meta.textContent = entry.meta;
      row.append(meta);
    }
    return row;
  }

  /** One append per animation frame, however fast events arrive. */
  function flush() {
    frame = 0;
    if (disposed || !queued.length) return;
    const batch = document.createDocumentFragment();
    for (const entry of queued.splice(0)) {
      chipFor(entry.stage);
      batch.append(buildRow(entry));
    }
    log.append(batch);
    while (log.childElementCount > MAX_ROWS) log.firstElementChild.remove();
    count.textContent = total > MAX_ROWS ? `${total} events · last ${MAX_ROWS}` : `${total} events`;
    if (following) scrollToEnd();
  }

  function record(event) {
    if (disposed || !event) return;
    const stage = tidy(event.stage) || 'note';
    const label = tidy(event.label) || '—';
    total += 1;
    queued.push({
      stage, label,
      detail: tidy(event.detail),
      meta: metaFor(event),
      tone: toneFor(stage, label),
      at: performance.now(),
      clock: new Date().toLocaleTimeString(),
    });
    if (!frame) frame = requestAnimationFrame(flush);
  }

  function clear() {
    queued.length = 0;
    total = 0;
    log.replaceChildren();
    count.textContent = '0 events';
    say.textContent = 'Timeline cleared.';
  }

  function send() {
    const text = field.value.trim();
    if (!text) { field.focus(); return; }
    let accepted = true;
    try {
      const result = onSubmit?.(text);
      accepted = result === undefined ? true : Boolean(result);
    } catch (error) {
      accepted = false;
      record({ stage: 'thought', label: 'typed → failed', detail: error?.message || String(error) });
    }
    record({ stage: 'thought', label: accepted ? 'typed → sent' : 'typed → not sent', detail: text });
    if (accepted) {
      inputHistory.push(text);
      inputHistory = inputHistory.slice(-HISTORY_LIMIT);
      historyIndex = inputHistory.length;
      draft = '';
      try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(inputHistory)); } catch { /* In-memory fallback. */ }
      field.value = '';
    }
    say.textContent = accepted ? 'Thought sent.' : 'Thought not sent.';
    field.focus();
  }

  const onBarClick = event => {
    const chip = event.target.closest('.dbg-chip');
    if (chip) {
      const stage = chip.dataset.stage;
      const off = !hidden.has(stage);
      if (off) hidden.add(stage); else hidden.delete(stage);
      chip.setAttribute('aria-pressed', String(!off));
      for (const row of log.children) if (row.dataset.stage === stage) row.hidden = off;
      if (following) scrollToEnd();
      return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'pause') setFollowing(!following);
    else if (action === 'clear') clear();
    else if (action === 'close') setOpen(false, { focus: true });
  };

  const onPanelKeyDown = event => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      setOpen(false, { focus: true });
    }
  };

  const onFieldKeyDown = event => {
    if (event.isComposing) return;
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && inputHistory.length) {
      if (event.key === 'ArrowDown' && historyIndex === inputHistory.length) return;
      event.preventDefault();
      if (historyIndex === inputHistory.length) draft = field.value;
      historyIndex = clamp(historyIndex + (event.key === 'ArrowUp' ? -1 : 1), 0, inputHistory.length);
      field.value = historyIndex === inputHistory.length ? draft : inputHistory[historyIndex];
      field.setSelectionRange(field.value.length, field.value.length);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
  };

  const onSubmitEvent = event => { event.preventDefault(); send(); };

  // Scrolling away from the bottom pauses the follow; returning resumes it.
  const onLogScroll = () => {
    if (programmaticScroll) return;
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    if (atEnd !== following) setFollowing(atEnd);
  };

  const onTabClick = () => setOpen(true, { focus: true });

  let dragFrom = 0;
  let dragHeight = 0;
  const onGripDown = event => {
    if (event.button !== 0) return;
    dragFrom = event.clientY;
    dragHeight = height;
    grip.setPointerCapture(event.pointerId);
    panel.classList.add('dbg-resizing');
    event.preventDefault();
  };
  const onGripMove = event => {
    if (!grip.hasPointerCapture(event.pointerId)) return;
    height = clamp(dragHeight + (dragFrom - event.clientY), MIN_HEIGHT, maxHeight());
    applyHeight(false);
  };
  const onGripUp = event => {
    if (!grip.hasPointerCapture(event.pointerId)) return;
    grip.releasePointerCapture(event.pointerId);
    panel.classList.remove('dbg-resizing');
    writeStore({ height });
    applyHeight(true);
  };
  const onGripKeyDown = event => {
    const step = event.key === 'ArrowUp' ? 24 : event.key === 'ArrowDown' ? -24
      : event.key === 'Home' ? maxHeight() : event.key === 'End' ? -maxHeight() : 0;
    if (!step) return;
    event.preventDefault();
    height = clamp(height + step, MIN_HEIGHT, maxHeight());
    writeStore({ height });
    applyHeight(true);
  };

  const onWindowResize = () => {
    measureHeader();
    const next = clamp(height, MIN_HEIGHT, maxHeight());
    const changed = next !== height;
    height = next;
    applyHeight(changed);
  };

  panel.querySelector('.dbg-bar').addEventListener('click', onBarClick);
  panel.addEventListener('keydown', onPanelKeyDown);
  field.addEventListener('keydown', onFieldKeyDown);
  form.addEventListener('submit', onSubmitEvent);
  log.addEventListener('scroll', onLogScroll, { passive: true });
  tab.addEventListener('click', onTabClick);
  grip.addEventListener('pointerdown', onGripDown);
  grip.addEventListener('pointermove', onGripMove);
  grip.addEventListener('pointerup', onGripUp);
  grip.addEventListener('pointercancel', onGripUp);
  grip.addEventListener('keydown', onGripKeyDown);
  window.addEventListener('resize', onWindowResize);

  count.textContent = '0 events';
  setFollowing(true);
  setOpen(open);

  return {
    record,
    open: () => setOpen(true),
    close: () => setOpen(false),
    clear,
    /** Current band height in CSS pixels; 0 while hidden. */
    height: () => (open ? clamp(height, MIN_HEIGHT, maxHeight()) : 0),
    element: panel,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('resize', onWindowResize);
      root.classList.remove('thread-debug-open');
      root.style.removeProperty('--thread-debug-height');
      root.style.removeProperty('--thread-debug-header');
      panel.remove();
      tab.remove();
      onResize?.(0);
    },
  };
}
