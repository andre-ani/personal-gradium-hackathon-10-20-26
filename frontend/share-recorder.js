// A 4:5 share image of the map (1080×1350), composed from what is on screen:
// the G6 layers, illustration canvases and Cara, with the masthead, grain and
// vignette. Client-only. (A stop-motion video is stashed in share-video.js.)
const WIDTH = 1080;
const HEIGHT = 1350;
const PAPER = '#f3f1ec';
const INK = '#123f85';
const MUTED = '#485d79';
const INK_ALPHA = .86;
const STAGE = { x: 60, y: 160, width: WIDTH - 120, height: 1000 };
const CARA_BOX = { width: 150, height: 131, y: 1190 };

function loadImage(src) {
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  return image;
}
const ready = image => image.complete && image.naturalWidth > 0;

function noiseTile(size, seed, draw) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = size;
  draw(tile.getContext('2d'), () => (seed = (seed * 16807) % 2147483647) / 2147483647);
  return tile;
}
const paperTile = () => noiseTile(192, 7, (t, rand) => {
  t.fillStyle = PAPER; t.fillRect(0, 0, 192, 192);
  for (let i = 0; i < 2600; i++) {
    const shade = rand() < .5 ? 255 : 40;
    t.fillStyle = `rgba(${shade},${shade},${shade},${(rand() * .05).toFixed(3)})`;
    t.fillRect(rand() * 192, rand() * 192, 1 + rand() * 1.5, 1);
  }
});
const grainTile = () => noiseTile(160, 11, (t, rand) => {
  const pixels = t.createImageData(160, 160);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const v = 96 + Math.floor(rand() * 64);
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = v; pixels.data[i + 3] = 255;
  }
  t.putImageData(pixels, 0, 0);
});

export function createShareRecorder({ graph, graphElement, caraCanvas }) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH; canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  const paper = ctx.createPattern(paperTile(), 'repeat');
  const grain = ctx.createPattern(grainTile(), 'repeat');
  const logo = loadImage('/static/brand/thread-logo-256.png?v=ink2');
  const gradium = loadImage('/static/brand/gradium-wordmark.svg');
  const tint = document.createElement('canvas');

  function layers() {
    const origin = graphElement.getBoundingClientRect();
    const rel = el => { const r = el.getBoundingClientRect(); return { el, x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }; };
    return {
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

  function drawTinted(image, x, y, height, colour) {
    const width = height * image.naturalWidth / image.naturalHeight;
    tint.width = Math.ceil(width); tint.height = Math.ceil(height);
    const t = tint.getContext('2d');
    t.drawImage(image, 0, 0, width, height);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = colour; t.fillRect(0, 0, tint.width, tint.height);
    ctx.drawImage(tint, x, y);
  }

  function compose() {
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Masthead: logo, wordmark and the Gradium credit.
    ctx.globalAlpha = INK_ALPHA;
    if (ready(logo)) ctx.drawImage(logo, 60, 48, 74, 74 * logo.naturalHeight / logo.naturalWidth);
    ctx.fillStyle = INK;
    ctx.font = '64px "Patrick Hand"';
    ctx.textBaseline = 'middle';
    ctx.fillText('thread', 150, 86);
    if (ready(gradium)) {
      const markWidth = 26 * gradium.naturalWidth / gradium.naturalHeight;
      ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = MUTED;
      ctx.letterSpacing = '3px';
      const label = 'POWERED BY';
      ctx.fillText(label, WIDTH - 60 - markWidth - 14 - ctx.measureText(label).width, 88);
      ctx.letterSpacing = '0px';
      drawTinted(gradium, WIDTH - 60 - markWidth, 75, 26, '#132b4e');
    }
    ctx.globalAlpha = 1;

    // The whole map, fitted into the 4:5 stage.
    const { graph: graphLayers, art } = layers();
    const view = contentBounds(art);
    if (view) {
      const scale = Math.min(STAGE.width / view.w, STAGE.height / view.h, 2);
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

    const cara = caraCanvas?.();
    if (cara?.width) ctx.drawImage(cara, (WIDTH - CARA_BOX.width) / 2, CARA_BOX.y, CARA_BOX.width, CARA_BOX.height);

    // Same finish as the page: soft-light grain, then a gentle vignette.
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = .55;
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 1;
    const vignette = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * .32, WIDTH / 2, HEIGHT / 2, HEIGHT * .78);
    vignette.addColorStop(0, 'rgba(255,255,255,0)');
    vignette.addColorStop(1, 'rgba(24,24,24,.16)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }

  return {
    ready: Promise.resolve(true),
    get hasClip() { return graph.getNodeData().length > 0; },
    /** Render the share image now. */
    async export() {
      if (!graph.getNodeData().length) throw new Error('Nothing to share yet. Talk through an idea first.');
      await document.fonts?.ready;
      compose();
      const still = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      return { still };
    },
    reset() {},
    dispose() {},
  };
}
