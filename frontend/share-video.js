// STASHED for later: live 4:5 MP4 recorder (WebCodecs + mp4-muxer). Not imported anywhere.
// Plan: capture stills at key moments and stitch them into a stop-motion clip.

import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { SPEECH_ARC } from './speech-ribbon.js';

// Client-only 4:5 share clip. Every frame is composed from what is already on
// screen (the G6 layers, illustration canvases, captions and Cara), encoded to
// H.264 MP4 with WebCodecs. Quiet stretches are skipped, so the clip plays as
// a tight time-lapse of the conversation becoming a map.
const WIDTH = 1080;
const HEIGHT = 1350;
const FPS = 30;
const FRAME_US = 1_000_000 / FPS;
const HOLD_FRAMES = FPS * 3;
const IDLE_GRACE = 1200;
const PAPER = '#e7e7e7';
const INK_ALPHA = .86;
const INK = '#123f85';
const MUTED = '#485d79';
const CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028'];
const STAGE = { x: 60, y: 150, width: WIDTH - 120, height: 880 };
const CAPTION_Y = 1150;
const CARA_BOX = { width: 168, height: 146, y: 1180 };

function loadImage(src) {
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  return image;
}
const ready = image => image.complete && image.naturalWidth > 0;

function paperTile() {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 192;
  const ctx = tile.getContext('2d');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, 192, 192);
  // Deterministic fibre speckle so frames don't shimmer.
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2600; i++) {
    const shade = rand() < .5 ? 255 : 40;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${(rand() * .05).toFixed(3)})`;
    ctx.fillRect(rand() * 192, rand() * 192, 1 + rand() * 1.5, 1);
  }
  return tile;
}

function grainTile() {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 160;
  const t = tile.getContext('2d');
  const pixels = t.createImageData(160, 160);
  let seed = 11;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const v = 96 + (seed % 64);
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v; pixels.data[i + 3] = 255;
  }
  t.putImageData(pixels, 0, 0);
  return tile;
}

export async function shareRecorderSupported() {
  if (!('VideoEncoder' in window)) return null;
  for (const codec of CODECS) {
    const config = { codec, width: WIDTH, height: HEIGHT, bitrate: 6_000_000, framerate: FPS };
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config; } catch { /* try next */ }
  }
  return null;
}

export function createShareRecorder({ graph, graphElement, readCaptions, caraCanvas, isBusy = () => false }) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH; canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  const paper = ctx.createPattern(paperTile(), 'repeat');
  const grain = ctx.createPattern(grainTile(), 'repeat');
  const logo = loadImage('/static/brand/thread-logo-256.png?v=ink');
  const gradium = loadImage('/static/brand/gradium-wordmark.svg');
  const tint = document.createElement('canvas');
  let config = null, encoder = null, chunks = [], timestamp = 0, frames = 0, forceKey = true;
  let crop = null, lastSignature = '', lastChange = -Infinity, timer = 0, disposed = false, exporting = false;

  const supported = shareRecorderSupported().then(found => { config = found; if (found) start(); return Boolean(found); });

  function makeEncoder() {
    encoder = new VideoEncoder({
      output: (chunk, meta) => chunks.push({ chunk, meta }),
      error: error => { console.error('Share recorder stopped', error); encoder = null; },
    });
    encoder.configure(config);
    forceKey = true;
  }

  // Everything the map shows, in graph-container pixels.
  function layers() {
    const origin = graphElement.getBoundingClientRect();
    const rel = el => { const r = el.getBoundingClientRect(); return { el, x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }; };
    return {
      origin,
      graph: [...graphElement.querySelectorAll('canvas')].map(rel),
      art: [...document.querySelectorAll('.pencil-illustrations canvas')].filter(el => el.width && el.isConnected).map(rel),
    };
  }

  function contentBounds(art) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x1, y1, x2, y2) => { minX = Math.min(minX, x1); minY = Math.min(minY, y1); maxX = Math.max(maxX, x2); maxY = Math.max(maxY, y2); };
    for (const node of graph.getNodeData()) {
      try {
        const box = graph.getElementRenderBounds(node.id);
        const [x1, y1] = graph.getViewportByCanvas(box.min);
        const [x2, y2] = graph.getViewportByCanvas(box.max);
        grow(x1, y1, x2, y2);
      } catch { /* element not rendered yet */ }
    }
    for (const item of art) grow(item.x, item.y, item.x + item.w, item.y + item.h);
    if (!Number.isFinite(minX)) return null;
    const pad = 36;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }

  // Ease the camera instead of snapping to every new card.
  function follow(target) {
    if (!target) return crop;
    const aspect = STAGE.width / STAGE.height;
    let { x, y, w, h } = target;
    const minW = 520;
    if (w < minW) { x -= (minW - w) / 2; w = minW; }
    if (w / h > aspect) { const nh = w / aspect; y -= (nh - h) / 2; h = nh; } else { const nw = h * aspect; x -= (nw - w) / 2; w = nw; }
    if (!crop) crop = { x, y, w, h };
    else for (const key of ['x', 'y', 'w', 'h']) crop[key] += ({ x, y, w, h }[key] - crop[key]) * .14;
    return crop;
  }

  function drawTinted(image, x, y, height, colour) {
    const width = height * image.naturalWidth / image.naturalHeight;
    tint.width = Math.ceil(width); tint.height = Math.ceil(height);
    const t = tint.getContext('2d');
    t.clearRect(0, 0, tint.width, tint.height);
    t.drawImage(image, 0, 0, width, height);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = colour; t.fillRect(0, 0, tint.width, tint.height);
    t.globalCompositeOperation = 'source-over';
    ctx.drawImage(tint, x, y);
    return width;
  }

  function compose() {
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalAlpha = INK_ALPHA;

    // Masthead: the real logo and wordmark, Gradium credit on the right.
    if (ready(logo)) ctx.drawImage(logo, 60, 44, 74, 74 * logo.naturalHeight / logo.naturalWidth);
    ctx.fillStyle = INK;
    ctx.font = '64px "Patrick Hand"';
    ctx.textBaseline = 'middle';
    ctx.fillText('thread', 150, 84);
    if (ready(gradium)) {
      ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = MUTED;
      const markWidth = 26 * gradium.naturalWidth / gradium.naturalHeight;
      const label = 'POWERED BY';
      ctx.letterSpacing = '3px';
      const labelWidth = ctx.measureText(label).width;
      ctx.fillText(label, WIDTH - 60 - markWidth - 14 - labelWidth, 86);
      ctx.letterSpacing = '0px';
      drawTinted(gradium, WIDTH - 60 - markWidth, 73, 26, '#132b4e');
    }
    ctx.globalAlpha = 1;

    // The map, framed into the 4:5 stage.
    const { graph: graphLayers, art } = layers();
    const view = follow(contentBounds(art));
    if (view) {
      const scale = Math.min(STAGE.width / view.w, STAGE.height / view.h);
      ctx.save();
      ctx.beginPath(); ctx.rect(STAGE.x, STAGE.y, STAGE.width, STAGE.height); ctx.clip();
      ctx.translate(STAGE.x + (STAGE.width - view.w * scale) / 2, STAGE.y + (STAGE.height - view.h * scale) / 2);
      ctx.scale(scale, scale);
      ctx.translate(-view.x, -view.y);
      for (const layer of graphLayers) ctx.drawImage(layer.el, layer.x, layer.y, layer.w, layer.h);
      ctx.globalCompositeOperation = 'multiply';
      for (const layer of art) ctx.drawImage(layer.el, layer.x, layer.y, layer.w, layer.h);
      ctx.restore();
    }

    // Captions on the same arc as the live ribbon, scaled up for the clip.
    const words = readCaptions?.() || [];
    const k = 1.75;
    ctx.save();
    ctx.font = `${Math.round(21 * k)}px "Patrick Hand"`;
    ctx.fillStyle = INK;
    ctx.textBaseline = 'top';
    const left = WIDTH / 2 - SPEECH_ARC.width * k / 2;
    for (const word of words) {
      const centre = Math.max(-SPEECH_ARC.radius, Math.min(SPEECH_ARC.radius, word.x + word.width / 2 - SPEECH_ARC.width / 2));
      const drop = SPEECH_ARC.radius - Math.sqrt(SPEECH_ARC.radius ** 2 - centre ** 2);
      const fade = Math.min(1, Math.max(0, (word.x + SPEECH_ARC.edge) / SPEECH_ARC.edge));
      ctx.save();
      ctx.globalAlpha = word.opacity * fade * INK_ALPHA;
      ctx.translate(left + (word.x + word.width / 2) * k, CAPTION_Y - 70 + (drop + word.lift) * k);
      ctx.rotate(Math.asin(centre / SPEECH_ARC.radius));
      ctx.textAlign = 'center';
      ctx.fillText(word.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();

    // Cara, straight from the live avatar canvas.
    const caraSource = caraCanvas();
    if (caraSource?.width) ctx.drawImage(caraSource, (WIDTH - CARA_BOX.width) / 2, CARA_BOX.y, CARA_BOX.width, CARA_BOX.height);

    // The same soft-light grain the page has on top of everything.
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = .55;
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }

  function signature() {
    const words = (readCaptions?.() || []).map(word => `${word.text}${Math.round(word.x)}${Math.round(word.opacity * 10)}`).join('|');
    return `${words}/${isBusy() ? 1 : 0}/${graph.getNodeData().length}/${graph.getEdgeData().length}`;
  }

  function encodeFrame() {
    if (!encoder || encoder.state !== 'configured' || encoder.encodeQueueSize > 6) return;
    compose();
    const frame = new VideoFrame(canvas, { timestamp, duration: FRAME_US });
    encoder.encode(frame, { keyFrame: forceKey || frames % (FPS * 2) === 0 });
    frame.close();
    forceKey = false;
    frames++;
    timestamp += FRAME_US;
  }

  function tick() {
    if (disposed || exporting || document.hidden || !graph.getNodeData().length) return;
    const now = performance.now();
    const sig = signature();
    if (sig !== lastSignature || isBusy()) { lastSignature = sig; lastChange = now; }
    if (now - lastChange < IDLE_GRACE) encodeFrame();
  }

  function start() {
    if (disposed || !config) return;
    makeEncoder();
    timer = setInterval(tick, 1000 / FPS);
  }

  return {
    ready: supported,
    get hasClip() { return frames > 0; },
    /** Finish the clip so far: a few seconds holding on the map, as MP4 plus a still. */
    async export() {
      if (!encoder || !frames) throw new Error('Nothing recorded yet. Talk through an idea first.');
      exporting = true;
      const keep = chunks.length, resume = timestamp, resumeFrames = frames;
      try {
        forceKey = true;
        for (let i = 0; i < HOLD_FRAMES; i++) {
          compose();
          const frame = new VideoFrame(canvas, { timestamp, duration: FRAME_US });
          encoder.encode(frame, { keyFrame: forceKey });
          frame.close();
          forceKey = false;
          timestamp += FRAME_US; frames++;
        }
        await encoder.flush();
        const still = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const muxer = new Muxer({ target: new ArrayBufferTarget(), fastStart: 'in-memory', firstTimestampBehavior: 'offset',
          video: { codec: 'avc', width: WIDTH, height: HEIGHT, frameRate: FPS } });
        for (const { chunk, meta } of chunks) muxer.addVideoChunk(chunk, meta);
        muxer.finalize();
        const video = new Blob([muxer.target.buffer], { type: 'video/mp4' });
        return { video, still, seconds: Math.round(frames / FPS) };
      } finally {
        // Drop the hold so recording continues seamlessly from where it was.
        chunks.length = keep; timestamp = resume; frames = resumeFrames; forceKey = true;
        exporting = false;
      }
    },
    reset() {
      chunks = []; timestamp = 0; frames = 0; crop = null; lastSignature = '';
      if (encoder?.state === 'configured') { encoder.reset(); encoder.configure(config); }
      forceKey = true;
    },
    dispose() { disposed = true; clearInterval(timer); if (encoder?.state !== 'closed') encoder?.close(); },
  };
}
