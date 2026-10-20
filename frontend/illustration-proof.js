import { mountPencilDrawing } from './illustration-layer.js';
const root = '/static/illustration-proof/benchmark-20261020/';
const report = await fetch(`${root}results.json`, { cache: 'no-store' }).then(r => r.json());
const page = document.querySelector('main');
const summary = document.querySelector('#summary');
const mounted = [];
const client = [];
const reducedToggle = document.querySelector('#reduce-motion');
reducedToggle.checked = matchMedia('(prefers-reduced-motion: reduce)').matches;
reducedToggle.addEventListener('change', () => {
  for (const entry of mounted) {
    entry.current.dispose();
    entry.current = mountPencilDrawing(entry.holder, entry.drawing, { reducedMotion: reducedToggle.checked });
  }
});
const shortName = model => model.includes('opus') ? 'Opus 5.5' : model.endsWith('-image') ? 'Nano Banana Lite' : 'Gemini Flash-Lite';
const money = value => value == null ? 'unreported' : `$${Number(value).toFixed(6)}`;
const table = document.createElement('table');
const head = document.createElement('thead');
head.innerHTML = '<tr><th>Model / native output</th><th>Subject</th><th>API response</th><th>Saved + validated</th><th>Actual USD</th><th>Output size</th></tr>';
table.append(head);
const body = document.createElement('tbody'); table.append(body); summary.append(table);
const successful = report.runs.filter(run => run.status === 'ok');
for (const run of successful) {
  const row = document.createElement('tr');
  const values = [`${shortName(run.model)} / ${run.kind.toUpperCase()}`, run.subject, `${((run.response_ms ?? run.ready_ms) / 1000).toFixed(2)}s`, `${(run.ready_ms / 1000).toFixed(2)}s`, money(run.cost_usd), run.status === 'ok' ? `${(run.asset_bytes / 1024).toFixed(1)} KB · ${run.dimensions.join('×')}` : run.error];
  values.forEach(value => { const td = document.createElement('td'); td.textContent = value; row.append(td); });
  body.append(row);
}
let serial = 0;
function mountRaster(holder, src, concept) {
  const id = `raster-wobble-${++serial}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 80 80'); svg.setAttribute('width', '160'); svg.setAttribute('height', '160');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', concept);
  svg.style.mixBlendMode = 'multiply';
  // Local trusted filter; raster pixels receive the same small persistent bend.
  svg.innerHTML = `<defs><filter id="${id}" filterUnits="userSpaceOnUse" x="-4" y="-4" width="88" height="88"><feTurbulence type="fractalNoise" baseFrequency=".085" numOctaves="2" seed="11"/><feDisplacementMap in="SourceGraphic" scale=".65" xChannelSelector="R" yChannelSelector="G"/></filter></defs>`;
  const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
  image.setAttribute('href', src); image.setAttribute('width', '80'); image.setAttribute('height', '80'); image.setAttribute('filter', `url(#${id})`);
  svg.append(image); holder.append(svg);
}
for (const run of successful) {
  const article = document.createElement('article');
  const title = document.createElement('h2'); title.textContent = `${shortName(run.model)} · ${run.kind.toUpperCase()} · ${run.subject}`;
  const status = document.createElement('p'); status.className = 'metrics';
  status.textContent = `${(run.ready_ms / 1000).toFixed(2)}s · ${money(run.cost_usd)} · ${run.concept}`;
  article.append(title, status); page.append(article);
  if (run.status !== 'ok') { const error = document.createElement('p'); error.textContent = run.error; article.append(error); continue; }
  const previews = document.createElement('div'); previews.className = 'previews'; article.append(previews);
  function column(label) {
    const figure = document.createElement('figure'); const holder = document.createElement('div'); holder.className = 'drawing';
    const caption = document.createElement('figcaption'); caption.textContent = label;
    figure.append(holder, caption); previews.append(figure); return holder;
  }
  const started = performance.now();
  const response = await fetch(root + run.file); const blob = await response.blob();
  const fetched = performance.now();
  let source;
  if (run.kind === 'svg') {
    const svg = await blob.text();
    const holder = column('Native SVG · 160px');
    const drawing = { svg, concept: run.concept };
    mounted.push({ holder, drawing, current: mountPencilDrawing(holder, drawing, { reducedMotion: reducedToggle.checked }) });
    source = new Blob([svg], {type: 'image/svg+xml'});
  } else {
    const holder = column(`Native ${run.dimensions[0]}px · shown 160px`);
    mountRaster(holder, URL.createObjectURL(blob), `Native raster of ${run.concept}`);
    source = blob;
  }
  const image = new Image(); const url = URL.createObjectURL(source); image.src = url; await image.decode();
  const decoded = performance.now();
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 80, 80); ctx.drawImage(image, 0, 0, 80, 80);
  const dataURL = canvas.toDataURL('image/png');
  const processed = performance.now();
  const holder = column(run.kind === 'svg' ? 'Rasterized SVG · 80px → 160px' : 'Downscaled raster · 80px → 160px');
  mountRaster(holder, dataURL, `80px rendition of ${run.concept}`);
  URL.revokeObjectURL(url);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  client.push({ id: run.id, fetch_ms: +(fetched - started).toFixed(2), decode_and_mount_ms: +(decoded - fetched).toFixed(2), resize_encode_ms: +(processed - decoded).toFixed(2), local_first_paint_ms: +(performance.now() - started).toFixed(2), raster_80_bytes: Math.floor((dataURL.length - dataURL.indexOf(',') - 1) * .75) });
}
const footer = document.querySelector('#details');
const total = document.createElement('p');
total.textContent = `Total provider-reported cost: ${money(report.total_reported_cost_usd)}. ${report.runs.length} live calls total, including rejected output attempts; two subjects per successful output path. All previews use multiply and subtle displacement. No application-cache reuse or hidden retries.`;
footer.append(total);
const details = document.createElement('details'); const label = document.createElement('summary'); label.textContent = 'Exact prompts, token usage, timing definitions and local rendering measurements';
const data = document.createElement('pre'); data.id = 'benchmark-details'; data.textContent = JSON.stringify({ ...report, browser_measurements: client }, null, 2);
details.append(label, data); footer.append(details);
const failures = document.createElement('p');
failures.textContent = `Rejected attempts (included in total): ${report.runs.filter(run => run.status !== 'ok').map(run => `${shortName(run.model)} ${run.kind}/${run.subject}: ${(run.ready_ms / 1000).toFixed(2)}s, ${money(run.cost_usd)} — ${run.error}`).join('; ')}.`; footer.append(failures);
const unsupported = document.createElement('p'); unsupported.textContent = 'Flash-Lite and Opus have no native raster output. Their 80px previews are local SVG conversions, not separate image generations. Nano Banana Lite generates at 1024px minimum; reducing to 80px does not lower the API bill. Costs are API-reported USD. Two prompts are a comparison sample, not p95 or a reliability estimate.'; footer.append(unsupported);
