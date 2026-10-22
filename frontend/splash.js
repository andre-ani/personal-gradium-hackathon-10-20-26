import { Graph } from '@antv/g6';
import { animate } from 'motion';
import atlas from './cara-atlas.json' with { type: 'json' };
import { classifyGraphHierarchy, paperEdgeStyle } from './graph-hierarchy.js';
import { createIllustrationLayer } from './illustration-layer.js';
import { PRIMARY, paletteColour } from './palette.js';
import { createSketchIcon } from './sketch-icons.js';
import { drawSketchEntrance, resetSketchEntrance } from './sketch-motion.js';
import { createSpeechRibbon } from './speech-ribbon.js';
import { paperNodeStyle } from './sketch-style.js';

// The splash sits on the same paper as the workspace and shows the idea with
// the real pieces: Cara, the speech ribbon and a tiny live-style sketch map.
// It hands over with a view transition once the mic is granted. Voice only.
const EASE = [.22, 1, .36, 1];
const CARA = atlas.states;
// A small mind map: one blue topic with coloured branches on both sides and
// one second-level idea. Illustrated cards use saved outputs of the app's own
// raster generator (static/splash/), drawn by the live illustration layer.
const art = (name, label) => ({ image_url: `/static/splash/${name}.jpg?v=gouache`, concept: label });
// Hand-placed like a real sketch: no two cards share an edge or a row.
const DEMO_NODES = [
  { id: 'party', label: 'Garden party', kind: 'topic', icon: 'calendar', palette: 'blue', x: 6, y: -4 },
  { id: 'food', label: 'Food', parent_id: 'party', icon: 'utensils', palette: 'terracotta', x: -318, y: -96 },
  // A drink isn't food: Lemonade floats loose near the party, with no arrow.
  { id: 'lemonade', label: 'Lemonade', loose: true, topicRole: 'supporting', icon: 'mug', palette: 'rose', x: -128, y: -226, illustration: art('lemonade', 'Lemonade') },
  { id: 'friends', label: 'Friends', parent_id: 'party', icon: 'group', palette: 'green', x: -268, y: 104 },
  { id: 'music', label: 'Music', parent_id: 'party', icon: 'play', palette: 'plum', x: 288, y: -58, illustration: art('music', 'Music') },
  { id: 'lights', label: 'Fairy lights', parent_id: 'party', palette: 'ochre', x: 336, y: 112, illustration: art('fairy-lights', 'Fairy lights') },
];
const DEMO_EDGES = DEMO_NODES.filter(node => node.parent_id).map(node => ({ id: `e-${node.id}`, source: node.parent_id, target: node.id }));
// Each spoken phrase reveals the part of the map it describes.
const DEMO_SCRIPT = [
  { words: 'so… a garden party', nodes: ['party'], edges: [] },
  { words: 'with food,', nodes: ['food'], edges: ['e-food'] },
  { words: 'homemade lemonade,', nodes: ['lemonade'], edges: [] },
  { words: 'some music,', nodes: ['music'], edges: ['e-music'] },
  { words: 'fairy lights', nodes: ['lights'], edges: ['e-lights'] },
  { words: 'and all our friends', nodes: ['friends'], edges: ['e-friends'] },
];
const BRANCH_SIZE = [180, 78];
const TOPIC_SIZE = [240, 92];
// Drawings sit beside the outer cards; fit room for them so none is clipped.
const ART_MARGIN = 190;
// Finished cards collect washi strips, as stable decorations do in the app.
const DEMO_TAPES = [['party', 'tape1Progress'], ['party', 'tape2Progress'], ['music', 'tape1Progress'], ['friends', 'tape2Progress'],
  ['food', 'decorationProgress'], ['lights', 'decorationProgress'], ['lemonade', 'decorationProgress']];
// The same hand-drawn doodles the live map adds to finished cards.
const DEMO_DOODLES = { food: 'stars', lights: 'sparkle', lemonade: 'heart' };
const byId = new Map(DEMO_NODES.map(node => [node.id, node]));
// Mirrors app.js edgeTint: lines take the target's group ink unless both ends are blue.
function edgeTint(edge) {
  const source = byId.get(edge.source), target = byId.get(edge.target);
  const primary = key => paletteColour(key) === paletteColour(PRIMARY);
  return primary(target.palette) && primary(source.palette) ? {} : { stroke: paletteColour(target.palette).ink };
}

const html = (tag, className, parent, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  parent?.append(el);
  return el;
};
const wait = (ms, signal) => new Promise(resolve => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});
function frameBox(frame) {
  const [vx, vy, vw, vh] = atlas.viewport;
  return `${(frame % 4) * atlas.cell + vx} ${Math.floor(frame / 4) * atlas.cell + vy} ${vw} ${vh}`;
}
function seedOf(id) {
  let hash = 2166136261;
  for (const ch of id) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function demoData(drawn = new Set(), tapes = new Set()) {
  const hierarchy = classifyGraphHierarchy(DEMO_NODES, DEMO_EDGES);
  return {
    nodes: DEMO_NODES.map(node => {
      const paper = paperNodeStyle({ ...node, topicRole: hierarchy.nodeRoles.get(node.id) });
      const tape = Object.fromEntries(DEMO_TAPES.filter(([id]) => id === node.id).map(([id, key]) => [key, tapes.has(`${id}:${key}`) ? 1 : 0]));
      // Branch headings are a touch smaller so the map reads at splash size.
      const compact = node.parent_id || node.loose ? { headingFontSize: 21 } : {};
      return { id: node.id, data: { ...node, nodeVariant: paper.nodeVariant, headingText: paper.headingText, bodyText: '' }, style: {
        ...paper, ...compact, ...tape, ...(DEMO_DOODLES[node.id] ? { decorationType: DEMO_DOODLES[node.id] } : {}), x: node.x, y: node.y, seed: seedOf(node.id), drawProgress: drawn.has(node.id) ? 1 : 0,
      } };
    }),
    edges: DEMO_EDGES.map(edge => ({ ...edge, style: {
      ...paperEdgeStyle(hierarchy.edgeRoles.get(edge.id)), ...edgeTint(edge), roughness: .6, seed: seedOf(edge.id),
      routeRevision: 1, drawProgress: drawn.has(edge.id) ? 1 : 0,
    } })),
  };
}

export function mountSplash(root, { isReduced = () => false, onVoice, onReveal, onEntered } = {}) {
  const app = [document.querySelector('body > header'), document.querySelector('body > .layout')].filter(Boolean);
  app.forEach(el => { el.inert = true; });
  root.replaceChildren();
  root.hidden = false;
  const controller = new AbortController();
  const { signal } = controller;
  const loops = [];
  const loop = animation => { loops.push(animation); return animation; };

  const main = html('div', 'splash-main', root);
  // "Powered by", the logo and the tagline travel together as one heading group.
  const heading = html('div', 'splash-heading', main);
  const top = html('div', 'splash-top', heading);
  html('span', 'splash-caps', top, 'Powered by');
  const mark = html('span', 'gradium-mark', top);
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', 'Gradium');
  const brand = html('h1', 'splash-brand', heading);
  const logo = html('img', 'splash-logo', brand);
  logo.src = '/static/brand/thread-logo-256.png?v=ink2';
  logo.alt = '';
  html('span', '', brand, 'thread');
  const tagline = html('p', 'splash-tagline', heading, 'Think out loud. Cara draws it as you talk.');

  const graphBox = html('div', 'splash-graph', main);
  graphBox.setAttribute('aria-hidden', 'true');
  // Cara and the button share the bottom band; the map owns the centre.
  const foot = html('div', 'splash-foot', main);
  const dock = html('div', 'splash-dock', foot);
  dock.setAttribute('aria-hidden', 'true');
  const caraBox = html('div', 'splash-cara', dock);
  caraBox.innerHTML = `<svg viewBox="${frameBox(CARA.reveal[0])}" width="100%" height="100%"><image href="${atlas.image}" width="${atlas.width}" height="${atlas.height}"/></svg>`;
  const cara = caraBox.firstElementChild;
  // The demo caption is the person speaking, so it uses their outer-arc ink.
  const ribbon = createSpeechRibbon(dock, isReduced, { variant: 'outer' });
  // A small handwritten name tag with an arrow curving down to Cara.
  const caraTag = html('div', 'splash-cara-tag', dock);
  caraTag.innerHTML = '<span>Cara</span><svg viewBox="0 0 30 22" width="30" height="22" aria-hidden="true"><path d="M3 4 C12 3 21 8 25 17"/><path d="M19 15 L25 18 L26 11"/></svg>';
  const tagName = caraTag.querySelector('span');
  const tagArrow = [...caraTag.querySelectorAll('path')];

  const ctaRow = html('div', 'splash-cta-row', foot);
  const button = html('button', 'splash-cta', ctaRow);
  button.type = 'button';
  const ring = html('i', 'splash-cta-ring', button);
  ring.setAttribute('aria-hidden', 'true');
  button.append(createSketchIcon('mic', { size: 22, decorative: true, strokeWidth: 2 }));
  const label = html('span', '', button, 'Warming up…');
  const note = html('p', 'splash-note', ctaRow);
  note.setAttribute('role', 'status');

  let voice = { configured: true, ready: false }, pending = false, entering = null, mood = null;
  const setCara = frame => cara.setAttribute('viewBox', frameBox(frame));
  const face = frame => { if (pending || entering) return; mood = frame; setCara(frame ?? CARA.idle); };

  function renderCta() {
    if (entering) return;
    button.disabled = pending || !voice.configured || !voice.ready;
    button.setAttribute('aria-busy', String(pending));
    label.textContent = pending ? 'Allow your mic…' : !voice.configured ? 'Voice is not set up' : voice.ready ? 'Start talking' : 'Warming up…';
  }

  async function revealCara() {
    for (const frame of CARA.reveal) {
      if (signal.aborted) return;
      setCara(frame);
      await wait(isReduced() ? 0 : 140, signal);
    }
    setCara(mood ?? CARA.idle);
    (async () => {
      while (!signal.aborted) {
        await wait(2600 + Math.random() * 2400, signal);
        if (signal.aborted || mood !== null || pending || entering) continue;
        setCara(CARA.blink);
        await wait(140, signal);
        if (mood === null && !pending && !entering) setCara(CARA.idle);
      }
    })();
  }

  function entrance() {
    if (isReduced()) return;
    const soft = { duration: 1.1, ease: EASE };
    const settle = { opacity: [0, 1], y: [10, 0] };
    animate(top, { opacity: [0, 1] }, { ...soft, delay: .1 });
    animate(logo, { opacity: [0, 1], scale: [.85, 1], rotate: [-8, 0] }, { ...soft, delay: .2 });
    animate(brand.lastElementChild, settle, { ...soft, delay: .35 });
    animate(tagline, settle, { ...soft, delay: .6 });
    animate(ctaRow, settle, { ...soft, delay: 1.2 });
    // The name arrives after Cara: the word rises in, then its arrow draws.
    tagName.style.opacity = '0';
    animate(tagName, { opacity: [0, 1], y: [8, 0] }, { duration: .45, ease: EASE, delay: 2.2 });
    tagArrow.forEach((path, i) => {
      const length = Math.ceil(path.getTotalLength());
      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = `${length}`;
      animate(path, { strokeDashoffset: [length, 0] }, { duration: i ? .22 : .55, delay: 2.5 + i * .5, ease: [.45, 0, .2, 1] });
    });
    loop(animate(ring, { scale: [1, 1.35], opacity: [.4, 0] }, { duration: 2.6, repeat: Infinity, ease: 'easeOut', delay: 2.4, repeatDelay: .6 }));
  }

  // The demo map is a real sketch graph, so it looks and draws like the canvas.
  const graph = new Graph({ container: graphBox, autoResize: true, animation: false, padding: [24, 24, 24, 24],
    node: { type: 'sketch-rect' }, edge: { type: 'sketch-cubic-horizontal' }, behaviors: [] });
  // The app's own illustration layer pencil-reveals the images beside cards.
  const artLayer = createIllustrationLayer(graph, graphBox, { isReduced });
  const artBox = [...document.querySelectorAll('body > .pencil-illustrations')].at(-1);
  const showArt = ids => artLayer.sync(DEMO_NODES.filter(node => ids.has(node.id)));
  // Tape progress is drawn through node style, exactly like stable decorations.
  const tapeFrames = new Map();
  let tapeFlush = null;
  function setTape(id, key, value) {
    tapeFrames.set(id, { ...tapeFrames.get(id), [key]: value });
    tapeFlush ??= (async () => {
      while (tapeFrames.size && !signal.aborted) {
        const batch = [...tapeFrames].map(([node, style]) => ({ id: node, style }));
        tapeFrames.clear();
        graph.updateNodeData(batch);
        await graph.draw();
      }
    })().finally(() => { tapeFlush = null; });
  }
  async function decorate() {
    for (const [id, key] of DEMO_TAPES) {
      if (signal.aborted) return;
      await animate(0, 1, { duration: .7, ease: 'easeOut', onUpdate: value => setTape(id, key, value) });
      await tapeFlush;
      await wait(180, signal);
    }
  }
  // Like fitView, but the bounds include the drawings beside the outer cards.
  async function fitDemo() {
    const edgesX = DEMO_NODES.flatMap(node => {
      const [w] = node.parent_id || node.loose ? BRANCH_SIZE : TOPIC_SIZE;
      const art = node.illustration ? ART_MARGIN : 0;
      return [node.x - w / 2 - (node.x < 0 ? art : 0), node.x + w / 2 + (node.x > 0 ? art : 0)];
    });
    const edgesY = DEMO_NODES.flatMap(node => {
      const [, h] = node.parent_id || node.loose ? BRANCH_SIZE : TOPIC_SIZE;
      return [node.y - h / 2, node.y + h / 2];
    });
    // Frame symmetrically around the central topic so it sits in the middle.
    const centre = DEMO_NODES.find(node => node.id === 'party');
    const halfX = Math.max(...edgesX.map(x => Math.abs(x - centre.x)));
    const halfY = Math.max(...edgesY.map(y => Math.abs(y - centre.y))) + 30;
    const { width, height } = graphBox.getBoundingClientRect();
    await graph.zoomTo(Math.min(.9, width / (2 * halfX), height / (2 * halfY)), false);
    const [x, y] = graph.getViewportByCanvas([centre.x, centre.y]);
    await graph.translateBy([width / 2 - x, height / 2 - y], false);
  }
  async function demoLoop() {
    await document.fonts?.ready;
    if (signal.aborted) return;
    graph.setData(demoData());
    await graph.render();
    await fitDemo();
    await revealCara();
    let turn = 0;
    while (!signal.aborted) {
      if (isReduced()) {
        graph.setData(demoData(new Set([...DEMO_NODES.map(n => n.id), ...DEMO_EDGES.map(e => e.id)]),
          new Set(DEMO_TAPES.map(([id, key]) => `${id}:${key}`))));
        await graph.draw();
        showArt(new Set(DEMO_NODES.map(n => n.id)));
        return;
      }
      graphBox.style.opacity = '1';
      if (artBox) artBox.style.opacity = '1';
      face(CARA.listening);
      const shown = new Set();
      for (const step of DEMO_SCRIPT) {
        if (signal.aborted) return;
        ribbon.append(step.words, { speaker: 'user', turnId: turn });
        await wait(step.words.split(' ').length * 110 + 260, signal);
        face(CARA.drawing);
        await drawSketchEntrance(graph, { nodes: step.nodes, edges: step.edges, duration: 520, signal });
        if (signal.aborted) return;
        step.nodes.forEach(id => shown.add(id));
        if (step.nodes.some(id => byId.get(id).illustration)) showArt(shown);
        face(CARA.listening);
      }
      face(CARA.pleased);
      await decorate();
      face(null);
      await wait(3200, signal);
      if (signal.aborted) return;
      // Cards, lines and drawings leave together: the whole map fades as one sheet.
      const fade = { opacity: 0 };
      await Promise.all([graphBox, artBox].filter(Boolean).map(el => animate(el, fade, { duration: .6, ease: 'easeIn' })));
      if (signal.aborted) return;
      ribbon.clear();
      showArt(new Set());
      resetSketchEntrance(graph);
      graph.setData(demoData());
      await graph.draw();
      graphBox.style.filter = 'none';
      if (artBox) artBox.style.filter = '';
      turn++;
      await wait(500, signal);
    }
  }

  async function enter() {
    if (entering) return entering;
    entering = (async () => {
      const finish = () => {
        controller.abort();
        loops.forEach(animation => animation.stop());
        ribbon.dispose();
        artLayer.dispose();
        graph.destroy();
        root.hidden = true;
        document.body.classList.add('thread-entered');
        app.forEach(el => { el.inert = false; });
        // The new view is live during the transition, so its entrance plays under the morph.
        onReveal?.();
      };
      button.disabled = true;
      mood = CARA.delighted; setCara(mood);
      if (isReduced()) { finish(); onEntered?.(); return; }
      await wait(320);
      // Only one Cara on screen: this one leaves before the dock's Cara arrives.
      await animate(caraBox, { opacity: 0, scale: .9 }, { duration: .22, ease: 'easeIn' });
      if (document.startViewTransition) {
        await document.startViewTransition(finish).finished.catch(() => {});
      } else {
        await animate(root, { opacity: 0 }, { duration: .5 });
        finish();
      }
      onEntered?.();
    })();
    return entering;
  }

  button.addEventListener('click', () => {
    pending = true;
    mood = CARA.curious; setCara(mood);
    note.textContent = '';
    renderCta();
    onVoice?.();
  });
  button.addEventListener('pointerenter', () => { if (!pending && !entering) setCara(CARA.listening); });
  button.addEventListener('pointerleave', () => { if (!pending && !entering) setCara(mood ?? CARA.idle); });

  renderCta();
  entrance();
  void demoLoop().catch(error => console.error(error));

  return {
    setVoice(next) { voice = { ...voice, ...next }; renderCta(); },
    enter,
    fail(message) {
      if (entering) return;
      pending = false;
      mood = CARA.puzzled; setCara(mood);
      renderCta();
      note.textContent = message || 'Voice could not start. Check your mic and try again.';
    },
  };
}
