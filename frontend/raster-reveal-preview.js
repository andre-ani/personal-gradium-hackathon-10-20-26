import { mountRasterDrawing } from './raster-reveal.js';
const base = '/static/illustration-proof/benchmark-20261020/';
const sources = [
  {concept: 'a kitchen with a stove and a pot', image_url: base + 'gemini-3.1-flash-lite-image-raster-kitchen-jpeg.jpg'},
  {concept: 'a bicycle with a basket of apples', image_url: base + 'gemini-3.1-flash-lite-image-raster-bicycle-jpeg.jpg'},
];
const active = [], all = [];
const reduced = document.querySelector('#reduced'); reduced.checked = matchMedia('(prefers-reduced-motion: reduce)').matches;
const progress = document.querySelector('#progress');
for (const source of sources) {
  const row = document.createElement('section');
  const title = document.createElement('h2'); title.textContent = source.concept; row.append(title);
  const stages = document.createElement('div'); stages.className = 'stages'; row.append(stages);
  document.querySelector('main').append(row);
  for (const [label, value] of [['Live reveal', null], ['Early scribbles · 0.86s', .18], ['Building up · 2.21s', .46], ['Finished', 1]]) {
    const figure = document.createElement('figure'), holder = document.createElement('div'), caption = document.createElement('figcaption');
    holder.className = 'drawing'; caption.textContent = label; figure.append(holder, caption); stages.append(figure);
    const mounted = mountRasterDrawing(holder, source, { reducedMotion: value === null && reduced.checked, autoplay: value === null });
    all.push(mounted);
    await mounted.ready;
    if (value === null) active.push(mounted); else mounted.setProgress(value);
  }
}
document.querySelector('#replay').onclick = () => { progress.value = 0; active.forEach(drawing => reduced.checked ? drawing.finish() : drawing.play()); };
progress.oninput = () => active.forEach(drawing => drawing.setProgress(Number(progress.value)));
reduced.onchange = () => { if (reduced.checked) { active.forEach(drawing => drawing.finish()); progress.value = 1; } };
window.addEventListener('pagehide', () => all.forEach(drawing => drawing.dispose()), {once:true});
// Read-only diagnostics from actual rendered masks, not fabricated progress labels.
const diagnostics = document.querySelector('#diagnostics');
const coverage = [...document.querySelectorAll('canvas[role="img"]')].map(canvas => {
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let darkness = 0; for (let i = 0; i < pixels.length; i += 4) darkness += 255 - pixels[i];
  return {progress:Number(canvas.dataset.progress), strokeCount:Number(canvas.dataset.strokeCount), totalDarkness:darkness, cornerRGB:[...pixels.slice(0,3)], bottomRGB:[...pixels.slice((310*320+160)*4,(310*320+160)*4+3)]};
});
diagnostics.textContent = JSON.stringify(coverage, null, 2);
