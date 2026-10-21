import { animate } from 'motion';

let sequence = 0;
export function seededRandom(text) {
  let state = 2166136261;
  for (const c of String(text)) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/** Small ink-directed gestures. Gaps are pen lifts, never connecting sweeps. */
export function planBrushStrokes(points, seed, cell = 12, passes = 4) {
  const random = seededRandom(seed);
  const strokes = [];
  for (let pass = 0; pass < passes; pass++) {
    const pending = points.map((p, point) => ({ ...p, point }));
    let last = pending[Math.floor(random() * pending.length)] || { x: 0, y: 0 };
    while (pending.length) {
      let index = 0, score = Infinity;
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        const distance = Math.hypot(p.x - last.x, p.y - last.y) + random() * cell * .45;
        if (distance < score) { score = distance; index = i; }
      }
      const point = pending.splice(index, 1)[0];
      const angle = (point.angle || 0) + (random() - .5) * .65;
      const length = cell * (.6 + random() * .6);
      const x = point.x + (random() - .5) * cell * .2;
      const y = point.y + (random() - .5) * cell * .2;
      const dx = Math.cos(angle) * length / 2, dy = Math.sin(angle) * length / 2;
      strokes.push({ pass, point: point.point, x1: x - dx, y1: y - dy, x2: x + dx, y2: y + dy, bend: (random() - .5) * cell * .45, radius: cell * (.34 + random() * .1) });
      last = point;
    }
  }
  return strokes;
}

/** Finish local patches instead of fading the entire subject pass by pass. */
export function scribbleGestures(strokes, clusterSize = 8) {
  const first = strokes.filter(stroke => stroke.pass === 0);
  const lookup = new Map(strokes.map(stroke => [`${stroke.point}:${stroke.pass}`, stroke]));
  const gestures = [];
  for (let i = 0; i < first.length; i += clusterSize) {
    const patch = first.slice(i, i + clusterSize);
    for (let pass = 0; pass < 5; pass++) {
      const ordered = pass % 2 ? [...patch].reverse() : patch;
      const local = ordered.map(stroke => {
        const original = lookup.get(`${stroke.point}:${Math.min(pass, 3)}`);
        return pass === 4 ? {...original, pass: 4, radius: original.radius * 1.5} : original;
      }).filter(Boolean);
      if (local.length) gestures.push(local);
    }
  }
  return gestures;
}

export const strokeEase = t => 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;

function canvas(size) { const el = document.createElement('canvas'); el.width = el.height = size; return el; }

function brush(random) {
  const stamp = canvas(48), ctx = stamp.getContext('2d');
  ctx.fillStyle = 'white'; ctx.beginPath();
  for (let i = 0; i < 28; i++) {
    const angle = i / 28 * Math.PI * 2, r = 20 + random() * 4;
    const x = 24 + Math.cos(angle) * r, y = 24 + Math.sin(angle) * r;
    if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.fill();
  // A dry, irregular brush edge; repeated passes fill the slight bristle gaps.
  ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = .16;
  for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.arc(random() * 48, random() * 48, .3 + random() * .8, 0, Math.PI * 2); ctx.fill(); }
  return stamp;
}

function inkPoints(pixels, size, cell) {
  const points = [];
  for (let y = 0; y < size; y += cell) for (let x = 0; x < size; x += cell) {
    let weight = 0, sx = 0, sy = 0, xx = 0, yy = 0, xy = 0;
    for (let py = y; py < Math.min(size, y + cell); py++) for (let px = x; px < Math.min(size, x + cell); px++) {
      const i = (py * size + px) * 4;
      const v = 255 - (pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722);
      if (v < 12) continue;
      weight += v; sx += px * v; sy += py * v; xx += px * px * v; yy += py * py * v; xy += px * py * v;
    }
    if (weight < 24) continue;
    const cx = sx / weight, cy = sy / weight;
    points.push({ x: cx, y: cy, angle: .5 * Math.atan2(2 * (xy / weight - cx * cy), xx / weight - cx * cx - yy / weight + cy * cy) });
  }
  return points;
}

/** Network/decode never joins the graph render promise. */
export function mountRasterDrawing(container, drawing, { reducedMotion = false, duration = 4.8, autoplay = true, onActivity = () => {} } = {}) {
  const imageURL = new URL(drawing.image_url, location.origin);
  if (imageURL.origin !== location.origin || !/^\/(?:api\/illustrations\/|static\/illustration-proof\/|static\/splash\/)/.test(imageURL.pathname)) throw new Error('Illustration must be a local image.');
  const size = 320, cell = 12;
  const output = canvas(size), ctx = output.getContext('2d');
  output.style.cssText = 'width:160px;height:160px;display:block;mix-blend-mode:multiply;';
  output.setAttribute('role', 'img'); output.setAttribute('aria-label', `Pencil drawing of ${drawing.concept}`);
  container.replaceChildren(output);
  const id = `raster-pencil-${++sequence}`;
  const filters = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  filters.setAttribute('width', '0'); filters.setAttribute('height', '0');
  filters.style.position = 'absolute'; filters.setAttribute('aria-hidden', 'true');
  filters.innerHTML = `<defs><filter id="${id}" x="-4%" y="-4%" width="108%" height="108%"><feTurbulence type="fractalNoise" baseFrequency=".085" numOctaves="2" seed="11"/><feDisplacementMap in="SourceGraphic" scale=".65" xChannelSelector="R" yChannelSelector="G"/></filter></defs>`;
  container.append(filters); output.style.filter = `url(#${id})`;
  const source = canvas(size), sourceContext = source.getContext('2d', { willReadFrequently: true });
  const masks = Array.from({ length: 5 }, () => canvas(size));
  const maskContexts = masks.map(mask => mask.getContext('2d'));
  const coverage = canvas(size), coverageContext = coverage.getContext('2d');
  let controls, disposed = false, loaded = false, forceFinish = reducedMotion, strokes = [], gestures = [], gestureEnds = [], totalUnits = 0, painted = 0, lastProgress = 0;
  const stamps = Array.from({ length: 5 }, (_, i) => brush(seededRandom(`${drawing.image_url}:${i}`)));
  const image = new Image();
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  function render(progress) {
    if (!loaded || disposed) return;
    progress = Math.max(0, Math.min(1, progress));
    if (progress < lastProgress) { maskContexts.forEach(c => c.clearRect(0, 0, size, size)); painted = 0; }
    lastProgress = progress;
    // A linear clock drives separate ease-out gestures: quick attack, slow
    // finish, a tiny pen lift, then another quick local scribble.
    const clock = progress * gestures.length;
    const gesture = Math.min(gestures.length - 1, Math.floor(clock));
    const phase = Math.min(1, (clock - Math.floor(clock)) / .88);
    const before = gesture > 0 ? gestureEnds[gesture - 1] : 0;
    const target = progress === 1 ? totalUnits : before + strokeEase(phase) * ((gestureEnds[gesture] || 0) - before);
    while (painted < target) {
      const unit = Math.floor(painted), index = Math.floor(unit / 12), step = unit % 12;
      const stroke = strokes[index];
      if (!stroke) break;
      const t = step / 11, dx = stroke.x2 - stroke.x1, dy = stroke.y2 - stroke.y1;
      const length = Math.hypot(dx, dy) || 1;
      // A short S-shaped scribble, mirrored on successive return passes.
      const wobble = Math.sin(t * Math.PI * 2) * stroke.bend;
      const x = stroke.x1 + dx * t - dy / length * wobble;
      const y = stroke.y1 + dy * t + dx / length * wobble;
      const radius = stroke.radius * (.86 + .14 * Math.sin(t * Math.PI));
      maskContexts[stroke.pass].drawImage(stamps[stroke.pass], x - radius, y - radius, radius * 2, radius * 2);
      painted = unit + 1;
    }
    coverageContext.clearRect(0, 0, size, size);
    masks.forEach((mask, pass) => { coverageContext.globalAlpha = pass === 4 ? 1 : .5; coverageContext.drawImage(mask, 0, 0); });
    coverageContext.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, size, size);
    ctx.drawImage(source, 0, 0); ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(coverage, 0, 0);
    ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
    output.dataset.progress = String(progress); output.dataset.gesture = String(gesture); output.dataset.gesturePhase = String(phase);
  }
  function finish() { forceFinish = true; controls?.stop(); render(1); onActivity(false); }
  function play() {
    if (!loaded || disposed) return;
    forceFinish = false; controls?.stop(); render(0);
    onActivity(true);
    controls = animate(0, 1, { duration, ease: 'linear', onUpdate: render, onComplete: () => { render(1); onActivity(false); } });
  }
  image.onload = () => {
    if (disposed) { resolveReady(false); return; }
    sourceContext.fillStyle = 'white'; sourceContext.fillRect(0, 0, size, size); sourceContext.drawImage(image, 0, 0, size, size);
    const pixels = sourceContext.getImageData(0, 0, size, size);
    // Remove the model's faint paper gradient using nearby bright paper as
    // the white point, preserving darker pencil instead of a visible square.
    const gray = new Uint8Array(size * size), tile = 32, columns = Math.ceil(size / tile);
    const paper = new Uint8Array(columns * columns);
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const index = py * size + px, i = index * 4;
      const value = Math.round(pixels.data[i] * .2126 + pixels.data[i + 1] * .7152 + pixels.data[i + 2] * .0722);
      gray[index] = value;
      const group = Math.floor(py / tile) * columns + Math.floor(px / tile);
      paper[group] = Math.max(paper[group], value);
    }
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const index = py * size + px, i = index * 4;
      const white = Math.max(128, paper[Math.floor(py / tile) * columns + Math.floor(px / tile)]);
      // Lift each channel against the local paper white so the palette
      // colours survive (the background still becomes pure white).
      for (let c = 0; c < 3; c++) {
        const ink = Math.max(0, white - pixels.data[i + c] - 6);
        pixels.data[i + c] = 255 - Math.min(255, Math.round(ink * 255 / Math.max(1, white - 6)));
      }
      pixels.data[i + 3] = 255;
    }
    sourceContext.putImageData(pixels, 0, 0);
    strokes = planBrushStrokes(inkPoints(pixels.data, size, cell), drawing.image_url, cell);
    gestures = scribbleGestures(strokes);
    strokes = gestures.flat();
    totalUnits = strokes.length * 12;
    let units = 0; gestureEnds = gestures.map(group => (units += group.length * 12));
    loaded = true; output.dataset.strokeCount = String(strokes.length); output.dataset.gestureCount = String(gestures.length); output.dataset.duration = String(duration);
    if (forceFinish) render(1); else if (autoplay) play(); else render(0);
    resolveReady(true);
  };
  image.onerror = () => { output.dataset.error = 'unavailable'; onActivity(false); resolveReady(false); };
  image.src = imageURL.href;
  return { canvas: output, ready, finish, play, setProgress(value) { controls?.stop(); render(value); onActivity(false); }, dispose() { disposed = true; controls?.stop(); onActivity(false); image.onload = null; image.onerror = null; image.src = ''; output.remove(); filters.remove(); resolveReady(false); } };
}
