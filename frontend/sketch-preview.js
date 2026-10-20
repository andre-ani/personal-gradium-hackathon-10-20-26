import { Graph } from '@antv/g6';
import { mountMorphingControl } from './morphing-controls.js';
import { createSketchIcon } from './sketch-icons.js';
import { registerSketchElements } from './sketch-elements.js';
import { drawSketchEntrance, resetSketchEntrance } from './sketch-motion.js';
import mountPaperBackground from './paper-background.js';
import { kitchenScript } from './kitchen-script.js';
import { paperNodeStyle } from './sketch-style.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Keep this fixture independent from the websocket graph. It is deliberately
// small enough to make the renderer's stroke, label, and replay behavior easy
// to inspect by eye.
const registration = registerSketchElements();
const nodeType = registration.nodeType;
const edgeType = registration.edgeType;

const palette = {
  ink: '#174a9c',
  line: '#2455a6',
  paper: '#e5e5e2',
  rootFill: '#f3f3ef',
  nodeFill: '#f6f6f3',
  pendingFill: '#e8e9e5',
  pendingStroke: '#6f8eb8',
};

const graph = new Graph({
  container: 'graph',
  autoResize: true,
  padding: [110, 80, 120, 80],
  animation: false,
  node: {
    type: nodeType,
    style: datum => ({
      size: [188, 64],
      radius: 16,
      labelPlacement: 'center',
      labelFontFamily: 'Figtree, Avenir Next, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      labelFontSize: 14,
      labelFill: palette.ink,
      labelWordWrap: true,
      labelMaxLines: 3,
      labelMaxWidth: 154,
      fill: palette.nodeFill,
      stroke: palette.line,
      lineWidth: 1.35,
      roughness: 0.72,
      ...datum.style,
    }),
  },
  edge: {
    type: edgeType,
    style: datum => ({
      stroke: palette.line,
      lineWidth: 1.45,
      endArrow: true,
      roughness: 0.66,
      ...datum.style,
    }),
  },
  behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
});

const allNodes = [
  { id: 'root', label: 'Organize around what you do', heading: 'Organize around what you do', body: 'Easy when things are where you expect them. It is not really about the size of the kitchen.', nodeVariant: 'anchor', kind: 'root', status: 'named', x: 700, y: 460 },
  { id: 'easy', label: 'Easy when things are where expected', body: 'Kitchens feel easy when things are where you expect them.', nodeVariant: 'annotation', kind: 'topic', status: 'named', render: false, x: 235, y: 180 },
  { id: 'size', label: 'Size is not the cause', body: "It isn't really about the size of the kitchen.", nodeVariant: 'annotation', kind: 'topic', status: 'named', render: false, x: 235, y: 330 },
  { id: 'tea', label: 'Making tea', heading: 'Making tea', body: 'A very small job reveals the search.', nodeVariant: 'section', kind: 'topic', status: 'named', x: 700, y: 160 },
  { id: 'spread', label: 'Tea kit', heading: 'Tea kit', body: 'Mug, kettle, tea bag, spoon, maybe milk — spread across corners means a little tour each morning.', nodeVariant: 'note', kind: 'topic', status: 'named', x: 1050, y: 160 },
  { id: 'repeat', label: 'The morning search repeats', body: 'Every morning, sometimes twice.', nodeVariant: 'annotation', kind: 'topic', status: 'named', render: false, x: 1030, y: 345 },
  { id: 'counter', label: 'A favorite counter?', heading: 'Favorite counter', body: 'Everything gradually gathers where the routine feels easiest.', nodeVariant: 'note', kind: 'topic', status: 'pending', x: 1100, y: 380 },
  { id: 'similar', label: 'Group similar objects', heading: 'Group similar objects', body: 'Cups together, utensils in a drawer.', nodeVariant: 'section', kind: 'topic', status: 'named', x: 250, y: 720 },
  { id: 'activity', label: 'Group by activity', heading: 'Group by activity', body: 'Put things near the activity they belong to.', nodeVariant: 'section', kind: 'topic', status: 'named', x: 590, y: 720 },
  { id: 'tea-set', label: 'Tea bags + kettle + mugs nearby', heading: 'Tea set', body: 'Tea bags near the kettle; mugs just above it. Spoons stay in the main drawer for other things.', nodeVariant: 'note', kind: 'topic', status: 'named', x: 1030, y: 700 },
  { id: 'spoons', label: 'Spoons stay in the shared drawer', body: 'Spoons stay in the main drawer for other things.', nodeVariant: 'annotation', kind: 'topic', status: 'named', render: false, x: 1320, y: 730 },
  { id: 'observe', label: 'Watch the real sequence', body: 'Watch what you actually do.', nodeVariant: 'annotation', kind: 'topic', status: 'named', x: 250, y: 900 },
  { id: 'chop', label: 'Boards by the left sink', heading: 'Chopping boards', body: 'Left side of the sink, even if the other cupboard is neater. Keep knives somewhere safe.', nodeVariant: 'note', kind: 'topic', status: 'named', x: 590, y: 930 },
  { id: 'safe', label: 'Knives stay safe', body: 'Keep knives somewhere safe.', nodeVariant: 'annotation', kind: 'topic', status: 'named', render: false, x: 865, y: 950 },
  { id: 'breakfast', label: 'One breakfast routine', heading: 'One breakfast routine', body: 'Pick one thing you do often.', nodeVariant: 'section', kind: 'topic', status: 'named', x: 250, y: 1080 },
  { id: 'reach', label: 'Notice reach order and search', body: 'Notice what you reach for, in what order, and where you search.', nodeVariant: 'annotation', kind: 'topic', status: 'named', x: 510, y: 1080 },
  { id: 'move', label: 'Move one thing', heading: 'Move one thing', body: 'Try the sequence again with one small change.', nodeVariant: 'action', kind: 'topic', status: 'named', x: 800, y: 1080 },
  { id: 'compete', label: 'Mugs above the dishwasher', heading: 'Two jobs compete', body: 'Mugs above the dishwasher are easy to put away, but nowhere near the kettle.', nodeVariant: 'note', kind: 'topic', status: 'named', x: 1320, y: 850 },
  { id: 'week', label: 'Try the arrangement for a week', heading: 'Try it for a week', body: 'See which arrangement is less annoying.', nodeVariant: 'action', kind: 'topic', status: 'named', x: 1320, y: 1080 },
];

const kitchenIcons = { root: 'utensils', tea: 'kettle', spread: 'mug', counter: 'repeat', similar: 'group', activity: 'activity', 'tea-set': 'tea', observe: 'repeat', chop: 'chopping-board', breakfast: 'breakfast', reach: 'activity', move: 'move', compete: 'dishwasher', week: 'calendar' };
for (const node of allNodes) node.icon = kitchenIcons[node.id];

const allEdges = [
  { id: 'root-easy', source: 'root', target: 'easy', priority: 'primary' },
  { id: 'root-size', source: 'root', target: 'size', priority: 'secondary' },
  { id: 'root-tea', source: 'root', target: 'tea', priority: 'primary' },
  { id: 'tea-spread', source: 'tea', target: 'spread', priority: 'primary' },
  { id: 'spread-counter', source: 'spread', target: 'counter', priority: 'secondary' },
  { id: 'spread-repeat', source: 'spread', target: 'repeat', priority: 'secondary' },
  { id: 'repeat-counter', source: 'repeat', target: 'counter', priority: 'secondary' },
  { id: 'tea-similar', source: 'tea', target: 'similar', priority: 'secondary' },
  { id: 'tea-activity', source: 'tea', target: 'activity', priority: 'primary' },
  { id: 'root-activity', source: 'root', target: 'activity', priority: 'primary' },
  { id: 'activity-tea-set', source: 'activity', target: 'tea-set', priority: 'primary' },
  { id: 'activity-spoons', source: 'activity', target: 'spoons', priority: 'secondary' },
  { id: 'activity-observe', source: 'activity', target: 'observe', priority: 'primary' },
  { id: 'observe-chop', source: 'observe', target: 'chop', priority: 'primary' },
  { id: 'chop-safe', source: 'chop', target: 'safe', priority: 'secondary' },
  { id: 'observe-breakfast', source: 'observe', target: 'breakfast', priority: 'primary' },
  { id: 'breakfast-reach', source: 'breakfast', target: 'reach', priority: 'secondary' },
  { id: 'reach-move', source: 'reach', target: 'move', priority: 'primary' },
  { id: 'tea-compete', source: 'tea', target: 'compete', priority: 'secondary' },
  { id: 'counter-compete', source: 'counter', target: 'compete', priority: 'secondary' },
  { id: 'move-week', source: 'move', target: 'week', priority: 'primary' },
  { id: 'compete-week', source: 'compete', target: 'week', priority: 'secondary' },
];

const beatAdditions = [
  { title: 'Start with the friction', message: 'A kitchen feels easy when things are where you expect them.', nodes: ['root'], edges: [] },
  { title: 'Follow one small job', message: 'Making tea turns the hidden search into a visible route.', nodes: ['tea', 'spread'], edges: ['root-tea', 'tea-spread'] },
  { title: 'Notice repetition', message: 'The same little tour happens every morning.', nodes: ['counter'], edges: ['spread-counter'] },
  { title: 'Compare two systems', message: 'Similar objects and activities suggest different groupings.', nodes: ['similar'], edges: ['tea-similar'] },
  { title: 'Try activity grouping', message: 'The activity becomes the organizing parent.', nodes: ['activity'], edges: ['root-activity'] },
  { title: 'Keep the exceptions', message: 'Tea items can cluster while spoons stay shared.', nodes: ['tea-set'], edges: ['activity-tea-set'] },
  { title: 'Watch before moving', message: 'Observe the sequence you actually use.', nodes: ['observe'], edges: ['activity-observe'] },
  { title: 'Make the work surface honest', message: 'If chopping starts left of the sink, boards belong there.', nodes: ['chop'], edges: ['observe-chop'] },
  { title: 'Keep convenience bounded', message: 'Knives still need a safe home.', nodes: [], edges: [] },
  { title: 'Choose one routine', message: 'Breakfast gives the experiment a small boundary.', nodes: ['breakfast', 'reach'], edges: ['observe-breakfast', 'breakfast-reach'] },
  { title: 'Change one thing', message: 'Notice reach order and move a single item.', nodes: ['move'], edges: ['reach-move'] },
  { title: 'Spot competing jobs', message: 'Mugs above the dishwasher serve putting away and making tea.', nodes: ['compete'], edges: ['counter-compete'] },
  { title: 'Run the week', message: 'Try the arrangement, then see which job feels less annoying.', nodes: ['week'], edges: ['move-week', 'compete-week'] },
];

let accumulatedNodes = [];
let accumulatedEdges = [];
const steps = beatAdditions.map((beat, index) => {
  accumulatedNodes = [...accumulatedNodes, ...beat.nodes];
  accumulatedEdges = [...accumulatedEdges, ...beat.edges];
  return {
    ...beat,
    index,
    nodes: [...accumulatedNodes],
    edges: [...accumulatedEdges],
    transcript: kitchenScript[index],
  };
});

let runToken = 0;
let timer;
let entranceController;
let wakeWait;

function nodeData(id, newNodeIds) {
  const node = allNodes.find((item) => item.id === id);
  const paperStyle = paperNodeStyle(node);
  return {
    id: node.id,
    data: { ...node, nodeVariant: paperStyle.nodeVariant, headingText: paperStyle.headingText, bodyText: paperStyle.bodyText },
    style: {
      ...paperStyle,
      x: node.x,
      y: node.y,
      labelPlacement: 'center',
      labelFontFamily: paperStyle.bodyFontFamily,
      labelFill: paperStyle.labelFill || palette.ink,
      labelMaxWidth: paperStyle.labelMaxWidth || 225,
      labelMaxLines: paperStyle.labelMaxLines || 6,
      seed: stableSeed(node.id),
      drawProgress: reducedMotion || !newNodeIds.has(node.id) ? 1 : 0,
    },
  };
}

function stableSeed(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function edgeData(id, newEdgeIds) {
  const edge = allEdges.find((item) => item.id === id);
  const primary = edge.priority === 'primary';
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    style: {
      stroke: primary ? palette.ink : palette.line,
      lineWidth: primary ? 2 : 0.95,
      lineDash: primary ? [] : [6, 7],
      endArrow: true,
      roughness: primary ? 0.62 : 0.78,
      seed: stableSeed(edge.id),
      drawProgress: reducedMotion || !newEdgeIds.has(edge.id) ? 1 : 0,
    },
  };
}

function renderTranscript(index) {
  const entries = kitchenScript.slice(0, index + 1);
  $('transcript').replaceChildren(...entries.map((text, entryIndex) => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    paragraph.dataset.beat = String(entryIndex + 1);
    if (entryIndex === index) paragraph.dataset.current = 'true';
    return paragraph;
  }));
  const current = $('transcript').lastElementChild;
  current?.scrollIntoView({ block: 'nearest' });
}

async function renderStep(step, token) {
  const shownNodes = new Set(renderStep.shownNodes || []);
  const shownEdges = new Set(renderStep.shownEdges || []);
  const newNodeIds = new Set(step.nodes.filter((id) => !shownNodes.has(id)));
  const newEdgeIds = new Set(step.edges.filter((id) => !shownEdges.has(id)));
  graph.setData({
    nodes: step.nodes.map((id) => nodeData(id, newNodeIds)),
    edges: step.edges.map((id) => edgeData(id, newEdgeIds)),
  });
  await graph.render();
  await graph.fitView({ when: 'always', direction: 'both' }, false);
  if (graph.getZoom() > 1) await graph.zoomTo(1, false);
  entranceController?.abort();
  entranceController = new AbortController();
  await drawSketchEntrance(graph, {
    nodes: [...newNodeIds],
    edges: [...newEdgeIds],
    duration: reducedMotion ? 0 : 420,
    reducedMotion,
    signal: entranceController.signal,
  });
  if (token !== runToken) return;
  $('step-title').textContent = step.title;
  $('step-message').textContent = step.message;
  renderTranscript(step.index);
  renderStep.shownNodes = step.nodes;
  renderStep.shownEdges = step.edges;
}

async function runDemo() {
  const token = ++runToken;
  cancelWait();
  entranceController?.abort();
  resetSketchEntrance(graph);
  renderStep.shownNodes = [];
  renderStep.shownEdges = [];
  graph.setData({ nodes: [], edges: [] });
  await graph.render();
  $('draw').disabled = true;
  $('reset').disabled = false;
  for (const [index, step] of steps.entries()) {
    if (token !== runToken) return;
    await renderStep(step, token);
    if (index < steps.length - 1 && !reducedMotion) {
      await waitForNextStage(token);
    }
  }
  if (token === runToken) {
    $('draw').disabled = false;
    $('reset').disabled = false;
  }
}

function reset() {
  runToken += 1;
  cancelWait();
  entranceController?.abort();
  resetSketchEntrance(graph);
  renderStep.shownNodes = [];
  renderStep.shownEdges = [];
  graph.setData({ nodes: [], edges: [] });
  graph.render();
  $('step-title').textContent = 'Ready to draw';
  $('step-message').textContent = 'Replay the kitchen story to inspect the sketch renderer.';
  $('transcript').replaceChildren();
  $('draw').disabled = false;
  $('reset').disabled = false;
}

function cancelWait() {
  clearTimeout(timer);
  timer = undefined;
  wakeWait?.();
  wakeWait = undefined;
}

function waitForNextStage(token) {
  return new Promise((resolve) => {
    wakeWait = resolve;
    timer = setTimeout(() => {
      timer = undefined;
      wakeWait = undefined;
      resolve();
    }, 780);
    if (token !== runToken) cancelWait();
  });
}

const scriptMorph = mountMorphingControl($('script-toggle'), {from:'chat',to:'close',size:18});
$('draw').prepend(createSketchIcon('replay', {size:18,decorative:true}));
$('reset').prepend(createSketchIcon('reset', {size:18,decorative:true}));
$('draw').addEventListener('click', runDemo);
$('reset').addEventListener('click', reset);
function setScriptOpen(open) {
  const panel = $('script-panel');
  panel.hidden = !open;
  scriptMorph.set(open);
  $('script-toggle').setAttribute('aria-expanded', String(open));
  $('script-toggle').dataset.active = String(open);
  if (open) $('script-close').focus();
}

$('script-toggle').addEventListener('click', () => {
  setScriptOpen($('script-panel').hidden);
});
$('script-close').addEventListener('click', () => setScriptOpen(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('script-panel').hidden) setScriptOpen(false);
});
mountPaperBackground();
runDemo();
