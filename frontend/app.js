import { Graph } from '@antv/g6';
import { createIllustrationLayer } from './illustration-layer.js';
import { refreshEdgeRoutes, installPlannedRoutes, clearPlannedRoutes } from './graph-edge-routes.js';
import { planNativeLayout } from './native-layout.js';
import { classifyGraphHierarchy, paperEdgeStyle } from './graph-hierarchy.js';
import { createStableDecorations } from './stable-decorations.js';
import { createSketchReorder, planSketchLayout, radialNeedsArrangement } from './sketch-layout.js';
import { createDebugTimeline } from './debug-timeline.js';
import { isLooseCard, placeRadialNode, withContainsEdges } from './radial-layout.js';
import { createSketchIcon } from './sketch-icons.js';
import { mountMorphingControl } from './morphing-controls.js';
import { mountInkTooltips } from './ink-tooltip.js';
import { paperNodeStyle } from './sketch-style.js';
import { describeHierarchy } from './card-hierarchy.js';
import { createSectionWash, sectionGroups } from './series-wash.js';
import { PRIMARY, paletteColour } from './palette.js';
import { mountPaperBackground } from './paper-background.js';
import { registerSketchElements } from './sketch-elements.js';
import { drawSketchEntrance, resetSketchEntrance, redrawSketchEdges } from './sketch-motion.js';
import { createUIMotion } from './ui-motion.js';
import { createViewportMotion } from './viewport-motion.js';
import { createSpeechRibbon } from './speech-ribbon.js';
import { createCaraAvatar } from './cara-avatar.js';
import { createVoiceOutputMute } from './voice-output-mute.js';
import { mountSplash } from './splash.js';
import { createShareRecorder } from './share-recorder.js';
import { createShareDialog } from './share-dialog.js';
registerSketchElements();
mountPaperBackground();
const $ = id => document.getElementById(id);
$('mic').querySelector('svg')?.remove();
const micMorph = mountMorphingControl($('mic'), {from:'mic',to:'stop',size:23});
const conversationLabel = document.createElement('span');
conversationLabel.textContent = 'Conversation';
$('conversation-toggle').replaceChildren(conversationLabel);
const conversationMorph = mountMorphingControl($('conversation-toggle'), {from:'chat',to:'close',size:18});

const reducedMedia = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = reducedMedia.matches;
const splash = mountSplash($('splash'), { isReduced: () => reduced, onVoice: () => startVoice(),
  onReveal: () => uiMotion.intro(), onEntered: () => cara.happy() });
const uiMotion = createUIMotion();
// Two concentric caption arcs: your words on the outer arc, Cara's on the inner one.
const userRibbon = createSpeechRibbon(document.querySelector('.dock'), () => reduced, { width: 400, radius: 470, variant: 'outer' });
const caraRibbon = createSpeechRibbon(document.querySelector('.dock'), () => reduced, { width: 250, radius: 290, variant: 'inner' });
const speechRibbon = {
  append: (text, options = {}) => (options.speaker === 'user' ? userRibbon : caraRibbon).append(text, options),
  snapshot: () => userRibbon.snapshot(),
  clear: () => { userRibbon.clear(); caraRibbon.clear(); },
  reduce: () => { userRibbon.reduce(); caraRibbon.reduce(); },
  dispose: () => { userRibbon.dispose(); caraRibbon.dispose(); },
};
const voiceOutput = createVoiceOutputMute();
let caraMuted = false;
const cara = createCaraAvatar(document.querySelector('.dock'), { readLevels: () => readAudioLevels(), isReduced: () => reduced, onMute: muted => { caraMuted = voiceOutput.setMuted(muted); cara.update({ muted: caraMuted }); } });
const graph = new Graph({container:'graph',autoResize:true,padding:[108,64,200,64],animation:false,node:{type:'sketch-rect',style:datum=>({radius:12,labelPlacement:'center',labelFontFamily:'Patrick Hand, cursive',labelFontSize:13,labelFill:'#123f85',labelWordWrap:true,labelMaxLines:3,labelMaxWidth:148,shadowColor:'#173b6b14',shadowBlur:12,shadowOffsetY:4,...datum.style})},edge:{type:'sketch-cubic-horizontal',style:datum=>({stroke:'#1c4690',lineWidth:2.4,endArrow:true,...datum.style})},behaviors:['drag-canvas','zoom-canvas','drag-element']});
// Generated drawings sit beside their cards (not inside them), pencil-revealed on the paper.
const illustrationLayer = createIllustrationLayer(graph, $('graph'), { isReduced: () => reduced,
  onDrawingChange: active => { illustrationDrawing = active; updateWork(); } });
const viewportMotion = createViewportMotion(graph, () => reduced);
// Each section with children gets one soft colour field behind its block (background layer).
const sectionWash = createSectionWash(graph, { isReduced: () => reduced });
// Heading levels and series from parent_id chains and sequence edges.
let cardShape = describeHierarchy([], []);
const refreshShape = () => { cardShape = describeHierarchy([...nodes.values()], [...edges.values()]); };
const withLevel = (n, shape = cardShape) => {
  const info = shape.cards.get(n.id);
  return info ? { ...n, level: info.level, series: info.series } : n;
};
const reorderMotion = createSketchReorder(graph, { reducedMotion: () => reduced });
const recorder = createShareRecorder({ graph, graphElement: $('graph'), readCaptions: () => speechRibbon.snapshot(),
  caraCanvas: () => document.querySelector('.cara-avatar canvas'),
  isBusy: () => rendering || semanticWorking || queueDepth > 0 });
const shareDialog = createShareDialog({ isReduced: () => reduced });
let shareSupported = true;
const updateShare = () => { $('share').disabled = !shareSupported || nodes.size === 0 || !recorder.hasClip; };
let activeOrientation = 'radial', layoutSource = 'automatic', autoLayoutPending = false, automaticLayoutFrame = 0;
let preparedNativePlan = null, plannedStructure = '', planGeneration = 0;
const nodeRevisions = new Map();
let graphSessionId=null, renderEpoch=0, resetPending=false, renderedRevision=null, voiceContextTimer;
let entranceController = new AbortController();
let renderGeneration = 0, graphInitialized = false;
let nodes=new Map(), edges=new Map(), positions=new Map(), graphSocket, renderChain=Promise.resolve(), reconnectTimer, demoTimers=[];
let traceResizeFrame = 0;
const debug = createDebugTimeline({
  onSubmit: text => { void splash.enter(); const sent = sendThought(text); if (sent) addTranscript(text); return sent; },
  // Track the drawer every frame; viewportMotion refits once the size settles.
  onResize: () => {
    cancelAnimationFrame(traceResizeFrame);
    traceResizeFrame = requestAnimationFrame(() => { if (graphInitialized) graph.resize(); });
  },
});
const trace = (stage, label, detail = '', extra = {}) => debug.record({ stage, label, detail, ...extra });
// Placement only ever assigns new cards; placed cards never move. The live
// canvas grows as a radial mind map: branches open in the widest free angle
// around their topic (beside their group), deeper cards fan outward from
// their parent, and separate topics become satellite centres.
function liveCard(n) {
  // Cards take their drawn size so section blocks stack tightly; a card that
  // later outgrows its slot makes the idle arrangement glide the block apart.
  const root = n.kind === 'root' || (!n.parent_id && !isLooseCard(n));
  const style = paperNodeStyle(withLevel({ ...n, topicRole: root ? 'main' : n.topicRole }));
  const [width, height] = style.size;
  return { id: n.id, parent_id: n.parent_id, near: n.near, group: n.group, kind: n.kind, series: cardShape.cards.get(n.id)?.series || undefined,
    width, height, space: 0 };
}
function position(n){
  if(positions.has(n.id))return positions.get(n.id);
  const prepared = preparedNativePlan?.nodes.find(node => node.id === n.id);
  if (prepared) { const point = { x: prepared.style.x, y: prepared.style.y }; positions.set(n.id, point); return point; }
  const placed=[...positions].filter(([id])=>id!==n.id&&nodes.has(id)).map(([id,p])=>({...liveCard(nodes.get(id)),x:p.x,y:p.y}));
  let p;
  if (activeOrientation !== 'radial' && graphInitialized) {
    const planned = planSketchLayout([...nodes.values()].map(value => ({ id: value.id, data: withLevel(value), style: { ...paperNodeStyle(withLevel(value)), ...(positions.get(value.id) || {}) } })), withContainsEdges([...nodes.values()], [...edges.values()], activeOrientation), activeOrientation);
    const target = planned.find(item => item.id === n.id);
    p = target ? { x: target.style.x, y: target.style.y } : placeRadialNode(liveCard(n), placed);
  } else p=placeRadialNode(liveCard(n),placed);
  positions.set(n.id,p);return p;
}
// Edges take the target card's group ink; blue-to-blue lines keep the role style.
function edgeTint(e) {
  const source = nodes.get(e.source), target = nodes.get(e.target);
  if (!target?.palette || ['placeholder', 'pending'].includes(target.status)) return {};
  const primary = key => paletteColour(key) === paletteColour(PRIMARY);
  return primary(target.palette) && primary(source?.palette) ? {} : { stroke: paletteColour(target.palette).ink };
}
async function draw({ animate = false } = {}) {
  const signal = entranceController.signal;
  refreshShape();
  const previous = graph.getData();
  for (const id of positions.keys()) if (!nodes.has(id)) positions.delete(id);
  for (const node of previous.nodes) {
    if (Number.isFinite(node.style?.x) && Number.isFinite(node.style?.y)) positions.set(node.id, { x: node.style.x, y: node.style.y });
  }
  const existingNodes = new Set(previous.nodes.map(n => n.id));
  const existingEdges = new Set(previous.edges.map(e => e.id));
  const addedNodes = animate ? [...nodes.keys()].filter(id => !existingNodes.has(id)) : [];
  // The backend sends a declared parent and its contains edge as separate
  // patches. Draw that known connection first so the child follows its line;
  // loose cards (no parent_id, optional `near`) get no arrow.
  const visibleEdges = withContainsEdges([...nodes.values()], [...edges.values()], activeOrientation);
  const addedEdges = animate ? visibleEdges.filter(e => !existingEdges.has(e.id)).map(e => e.id) : [];
  // A loose card is a supporting idea, not another main topic, despite having no incoming arrow.
  const firstNode = nodes.keys().next().value;
  // Roles read every containment link, including the arrows hidden inside section blocks.
  const hierarchy = classifyGraphHierarchy([...nodes.values()].map(n => n.id !== firstNode && isLooseCard(n) && !n.topicRole ? { ...n, topicRole: 'supporting' } : n),
    withContainsEdges([...nodes.values()], [...edges.values()], activeOrientation, { grouped: false }));
  const routeRevision = Date.now();
  stableDecorations.sync([...nodes.values()], visibleEdges, { nodeRevisions, renderedRevision });
  const dataNodes = [...nodes.values()].map(n => ({ id: n.id, data: withLevel({ ...n, topicRole: hierarchy.nodeRoles.get(n.id) }), style: {
    ...paperNodeStyle(withLevel({ ...n, topicRole: hierarchy.nodeRoles.get(n.id) })), ...stableDecorations.styleFor(n.id), ...position(n),
    // Room for the drawing beside the card, so layout and fitting never clip it.
    ...(n.illustration ? { illustrationSpace: 170 } : {}),
    drawProgress: !reduced && addedNodes.includes(n.id) ? 0 : 1,
  }}));
  graph.setData({ nodes: dataNodes, edges: visibleEdges.map(e => ({ ...e, style: {
    ...e.style, ...paperEdgeStyle(hierarchy.edgeRoles.get(e.id)), ...edgeTint(e), routeRevision, drawProgress: !reduced && addedEdges.includes(e.id) ? 0 : 1,
  }})) });
  if (preparedNativePlan && nativePlanMatchesVisible()) {
    const visibleIds = new Set(visibleEdges.map(edge => edge.id));
    installPlannedRoutes(graph, preparedNativePlan.edges.filter(edge => visibleIds.has(edge.id)));
  }
  if (!graphInitialized) { await graph.render(); graphInitialized = true; }
  else await graph.draw();
  illustrationLayer.sync(nodes.values());
  // One field per section block (section plus items and details, series included).
  sectionWash.sync(sectionGroups([...nodes.values()]).map(item => {
    const colour = paletteColour(nodes.get(item.section)?.palette || nodes.get(item.members[1])?.palette);
    return { key: item.key, members: item.members, wash: colour.wash, ink: colour.ink };
  }));
  // A block that grew, an item that arrived before its slot was free or a
  // section order that appeared: glide into the arrangement once idle.
  if (layoutSource === 'automatic' && activeOrientation === 'radial' && !reorderMotion.busy && nodes.size > 1
    && radialNeedsArrangement(graph.getNodeData(), graph.getEdgeData())) autoLayoutPending = true;
  updateEmpty(nodes.size === 0);
  updateShare();
  // New cards draw the camera toward them; it returns to the whole map once
  // additions pause. Otherwise reframing retargets smoothly between patches.
  viewportMotion.follow(addedNodes);
  if (nodes.size) void viewportMotion.fit({ when: 'overflow' }).catch(error => {
    uiMotion.status($('graph-help'), 'The map could not reframe. Try Fit map.'); console.error(error);
  });
  // Cards grow to their content (and drawings arrive beside them) after this
  // draw, so check the frame again once that has settled.
  clearTimeout(settledFitTimer);
  if (nodes.size) settledFitTimer = setTimeout(() => {
    void viewportMotion.fit({ when: 'overflow' }).catch(console.error);
  }, 700);
  // Entry decoration is visual work, not a barrier to the next semantic patch.
  void drawSketchEntrance(graph, { nodes: addedNodes, edges: addedEdges, reducedMotion: reduced, signal }).catch(error => { if (!signal.aborted) console.error(error); });
}
let semanticWorking = false, rendering = false, queueDepth = 0, illustrationDrawing = false;
let settledFitTimer = 0;
const stableDecorations = createStableDecorations(graph, {
  reducedMotion: () => reduced,
  getRenderedRevision: () => renderedRevision,
  isReady: () => graphInitialized && graphSessionId && !rendering && !semanticWorking && !queueDepth && !reorderMotion.busy && !document.hidden,
  runExclusive: task => {
    const work = renderChain.then(task);
    renderChain = work.catch(error => console.error(error));
    return work;
  },
  onApplied: event => {
    if (graphSocket?.readyState === WebSocket.OPEN) {
      graphSocket.send(JSON.stringify({ type: 'decoration_applied', ...event, rendered_revision: renderedRevision }));
    }
  },
});

function updateWork() {
  const busy = semanticWorking || rendering || queueDepth > 0;
  $('pulse').classList.toggle('busy', busy);
  uiMotion.busy(busy);
  cara.update({ thinking: semanticWorking, drawing: rendering || queueDepth > 0 || illustrationDrawing });
}
function enqueue(message) {
  if (message.type === 'graph_plan') {
    if (layoutSource !== 'automatic' || activeOrientation === 'radial') return;
    const plannedEdges = withContainsEdges(message.nodes, message.edges, activeOrientation);
    const signature = JSON.stringify([activeOrientation, message.nodes.map(node => [node.id, node.parent_id]), plannedEdges.map(edge => [edge.id, edge.source, edge.target])]);
    if (signature === plannedStructure) return;
    plannedStructure = signature;
    const generation = ++planGeneration, epoch = renderEpoch, orientation = activeOrientation;
    const firstId = message.nodes[0]?.id;
    const roles = classifyGraphHierarchy(message.nodes.map(node => node.id !== firstId && isLooseCard(node) && !node.topicRole ? { ...node, topicRole: 'supporting' } : node),
      withContainsEdges(message.nodes, message.edges, activeOrientation, { grouped: false }));
    const planShape = describeHierarchy(message.nodes, message.edges);
    const sourceNodes = message.nodes.map(node => {
      const data = withLevel({ ...node, topicRole: roles.nodeRoles.get(node.id) }, planShape);
      return { id: node.id, data, style: { ...paperNodeStyle(data), ...(positions.get(node.id) || {}) } };
    });
    renderChain = renderChain.then(async () => {
      const plan = await planNativeLayout(sourceNodes, plannedEdges, orientation, { isCurrent: () => epoch === renderEpoch && generation === planGeneration });
      if (epoch !== renderEpoch || generation !== planGeneration || layoutSource !== 'automatic') return;
      preparedNativePlan = { ...plan, sizes: new Map(sourceNodes.map(node => [node.id, node.style.size])) };
      clearPlannedRoutes(graph);
      for (const node of plan.nodes) if (!nodes.has(node.id)) positions.set(node.id, { x: node.style.x, y: node.style.y });
      autoLayoutPending = true;
      trace('layout', 'Native layout planned', `${plan.nodes.length} cards · ${plan.edges.length} connectors`);
    }).catch(error => { plannedStructure = ''; trace('error', 'Layout planning failed', error.message); });
    return;
  }
  if (message.type === 'layout_hint') {
    if (!['radial', 'flow'].includes(message.orientation)) return;
    if (layoutSource === 'manual') { trace('layout', 'Manual layout preserved', message.orientation); return; }
    activeOrientation = message.orientation;
    autoLayoutPending = true;
    trace('layout', 'Layout selected', activeOrientation === 'flow' ? 'Ordered process → flow' : 'Related ideas → radial');
    maybeAutoArrange();
    return;
  }
  if (message.type === 'debug_event') { debug.record(message); return; }
  if (message.type === 'layout_command') { void applyLayoutCommand(message); return; }
  if (message.type === 'layout_receipt' || message.type === 'edit_receipt') { trace('tool', message.type, JSON.stringify(message)); syncVoiceContext(); return; }
  if (message.type === 'graph_patch') {
    if (layoutSource === 'automatic' && message.layer === 'edit' && ['add_node', 'remove_node', 'add_edge', 'remove_edge'].includes(message.op?.type)) { autoLayoutPending = true; preparedNativePlan = null; plannedStructure = ''; clearPlannedRoutes(graph); }
    trace('queue', 'Patch received', message.op?.type || '', { revision: message.revision });
    if (reorderMotion.busy) void reorderMotion.cancel();
  }
  if (message.type === 'decoration_receipt') {
    if (message.accepted) { cara.happy(true); syncVoiceContext(); }
    return;
  }
  if (message.type === 'graph_session') { graphSessionId = message.id; voiceUI(); return; }
  if (resetPending && message.type === 'graph_patch') return;
  if (message.type === 'graph_snapshot' && !message.nodes.length) {
    stableDecorations.reset();
    nodeRevisions.clear();
    arrangementGeneration++; planGeneration++; preparedNativePlan = null; plannedStructure = ''; clearPlannedRoutes(graph);
    reorderMotion.cancel();
    activeOrientation = 'radial'; layoutSource = 'automatic'; autoLayoutPending = false; cancelAnimationFrame(automaticLayoutFrame); automaticLayoutFrame = 0;
    resetPending = false; renderEpoch++;
    entranceController.abort(); entranceController = new AbortController();
  }
  const epoch = renderEpoch;
  renderChain = renderChain.then(async () => {
    if (epoch !== renderEpoch) return;
    if (message.type === 'graph_snapshot') {
      nodeRevisions.clear();
      for (const [id, revision] of Object.entries(message.node_revisions || {})) nodeRevisions.set(id, revision);
      nodes = new Map(message.nodes.map(n => [n.id, n]));
      edges = new Map(message.edges.map(e => [e.id, e]));
      if (!nodes.size) { positions.clear(); resetSketchEntrance(graph); queueDepth = 0; semanticWorking = false; updateWork(); }
      await draw();
      renderedRevision = message.revision;
      syncVoiceContext();
    } else if (message.type === 'graph_patch') {
      const op = message.op;
      for (const [id, revision] of Object.entries(message.node_revisions || {})) nodeRevisions.set(id, revision);
      if (!message.node_revisions) {
        if (op.node) nodeRevisions.set(op.node.id, message.revision);
        if (op.edge) { nodeRevisions.set(op.edge.source, message.revision); nodeRevisions.set(op.edge.target, message.revision); }
      }
      // Re-parenting moves a card into another section: let the automatic
      // arrangement glide it into its new group once the patch is drawn.
      const reparented = op.node && ['update_node', 'add_node'].includes(op.type) && nodes.has(op.node.id)
        && Object.hasOwn(op.node, 'parent_id') && (nodes.get(op.node.id).parent_id ?? null) !== (op.node.parent_id ?? null);
      if ((reparented || (op.type === 'remove_edge' && message.layer === 'meaning')) && layoutSource === 'automatic') {
        autoLayoutPending = true; preparedNativePlan = null; plannedStructure = ''; clearPlannedRoutes(graph);
      }
      if (op.type === 'remove_node') {
        const id = op.node?.id || op.id;
        nodes.delete(id); positions.delete(id); nodeRevisions.delete(id);
        for (const [edgeId, edge] of edges) if (edge.source === id || edge.target === id) edges.delete(edgeId);
      } else if (op.type === 'remove_edge') edges.delete(op.edge?.id || op.id);
      else {
        if (op.node) nodes.set(op.node.id, { ...nodes.get(op.node.id), ...op.node });
        if (op.edge) edges.set(op.edge.id, op.edge);
      }
      rendering = true; queueDepth = message.queue_depth || 0; updateWork();
      uiMotion.status($('graph-status'), message.layer === 'structure' ? 'Finding connections…' : 'Adding a little detail…');
      const drawStarted = performance.now();
      try { await draw({ animate: true }); renderedRevision = message.revision; syncVoiceContext(); trace('render', 'Patch visible', op.node?.label || op.type, { duration_ms: performance.now() - drawStarted, revision: message.revision }); } finally { rendering = false; updateWork(); }
      if (!semanticWorking && !queueDepth) { uiMotion.status($('graph-status'), 'Ready for your next thought'); cara.happy(); maybeAutoArrange(); }
    } else if (message.type === 'graph_status') {
      syncVoiceContext();
      const wasWorking = semanticWorking;
      semanticWorking = message.status === 'working';
      cara.update({ fault: message.status === 'error' || message.status === 'unavailable' });
      if (wasWorking && message.status === 'idle' && nodes.size && !message.queue_depth) cara.happy();
      if (Number.isFinite(message.queue_depth)) queueDepth = message.queue_depth;
      updateWork();
      uiMotion.status($('graph-status'), message.message || (semanticWorking ? 'Shaping your thoughts…' : 'Ready for your next thought'));
      // The status line already carries the message; the help line stays quiet to avoid repeating it.
      if (message.status === 'error' || message.status === 'unavailable') uiMotion.status($('graph-help'), message.message ? '' : 'The map could not update. Try another thought.');
      else if (semanticWorking) uiMotion.status($('graph-help'), '');
      if (!semanticWorking && !queueDepth) maybeAutoArrange();
    } else if (message.type === 'refinement') {
      cara.react('curious');
      addTranscript(message.question, false); uiMotion.status($('graph-help'), message.question);
    } else if (message.type === 'graph_error' || message.type === 'error') {
      cara.update({ fault: true });
      uiMotion.status($('graph-help'), message.message || 'The map could not update.');
    }
  }).catch(error => {
    rendering = false; semanticWorking = false; queueDepth = 0; updateWork();
    uiMotion.status($('graph-help'), 'Canvas update failed. Reload to reconnect.'); console.error(error);
  });
}
function connectGraph(){graphSocket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws/graph`);graphSocket.onopen=()=>{trace('connection', 'Map connected');voiceUI();uiMotion.status($('graph-help'), '');uiMotion.status($('graph-status'), 'Ready for your first thought');$('example').disabled=false;};graphSocket.onmessage=e=>{try{enqueue(JSON.parse(e.data));}catch{ uiMotion.status($('graph-help'), 'A map update could not be read.');}};graphSocket.onclose=()=>{trace('connection', 'Map disconnected');stableDecorations.reset();nodeRevisions.clear();graphSessionId=null;renderedRevision=null;if(listening||starting)stopVoice('Canvas disconnected. Restart voice after it reconnects.');else voiceUI();uiMotion.status($('graph-status'), 'Reconnecting canvas…');$('example').disabled=true;reconnectTimer=setTimeout(connectGraph,2000);};graphSocket.onerror=()=>{uiMotion.status($('graph-help'), 'Canvas connection unavailable. Reconnecting…');};}
function sendThought(text,speaker='user'){if(graphSocket?.readyState!==WebSocket.OPEN){uiMotion.status($('notice'), 'Wait for the canvas to reconnect, then add your thought.');return false;}trace('transcript', 'Text sent', text);graphSocket.send(JSON.stringify({type:'text',text,mode:'append',speaker}));return true;}
function addTranscript(text, isUser = true, key) {
  if (!text?.trim()) return;
  let el = key ? document.querySelector(`[data-turn="${key}"]`) : null;
  const isNew = !el;
  if (!el) {
    el = document.createElement('p'); el.className = `utterance ${isUser ? 'user' : 'assistant'}`;
    if (key) el.dataset.turn = key;
    const small = document.createElement('small'); small.textContent = isUser ? 'You' : 'Thread';
    el.append(small, document.createElement('span')); $('transcript').append(el);
  }
  el.lastElementChild.textContent += text + ' ';
  speechRibbon.append(text, { speaker: isUser ? 'user' : 'assistant', turnId: key });
  uiMotion.transcript(el, { isNew });
  $('transcript').scrollTop = $('transcript').scrollHeight;
}
let conversationOpen = !$('conversation-panel').hidden, panelGeneration = 0;
async function showConversation(open) {
  conversationOpen = open;
  const generation = ++panelGeneration, panel = $('conversation-panel');
  const toggle = $('conversation-toggle');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close conversation' : 'Show conversation');
  conversationLabel.textContent = open ? 'Close conversation' : 'Conversation';
  conversationMorph.set(open);
  panel.inert = !open;
  if (open) {
    panel.hidden = false;
    document.querySelector('.layout').classList.add('conversation-open');
    await graph.resize();
    await uiMotion.panel(panel, true);
  } else {
    if (panel.contains(document.activeElement)) toggle.focus();
    await uiMotion.panel(panel, false);
    if (generation !== panelGeneration || conversationOpen) return;
    panel.hidden = true;
    document.querySelector('.layout').classList.remove('conversation-open');
    await graph.resize();
  }
}
let emptyVisible = null, emptyGeneration = 0;
function updateEmpty(visible) {
  if (emptyVisible === visible) return;
  emptyVisible = visible;
  const generation = ++emptyGeneration, el = $('empty');
  el.inert = !visible;
  if (visible) el.hidden = false;
  void uiMotion.empty(el, visible).then(() => {
    if (generation === emptyGeneration && !visible) el.hidden = true;
  });
}
for (const [id, icon] of [['fit', 'fit'], ['reset', 'reset'], ['example', 'play'], ['share', 'replay']]) {
  $(id).prepend(createSketchIcon(icon, { size: 18, decorative: true }));
}
$('share').disabled = true;
$('share').onclick = () => void shareDialog.open(() => recorder.export());
const shareTimer = setInterval(updateShare, 1000);
void recorder.ready.then(ok => { shareSupported = ok; if (!ok) { $('share').hidden = true; clearInterval(shareTimer); } updateShare(); });
function reportLayout(commandId, applied = true) {
  if (graphSocket?.readyState !== WebSocket.OPEN) return;
  const current = Object.fromEntries(graph.getNodeData().slice(0, 160).map(node => [node.id, { x: node.style.x, y: node.style.y }]));
  graphSocket.send(JSON.stringify({ type: 'layout_applied', applied, source: layoutSource, command_id: commandId || null, orientation: activeOrientation, positions: current }));
}
function nativePlanMatchesVisible() {
  if (!preparedNativePlan) return false;
  const targets = new Map(preparedNativePlan.nodes.map(node => [node.id, node.style]));
  return graph.getNodeData().every(node => {
    const target = targets.get(node.id);
    const expectedSize = preparedNativePlan.sizes?.get(node.id), actualSize = node.style.size;
    const sizeMatches = !expectedSize || (Array.isArray(actualSize) && Math.abs(expectedSize[0] - actualSize[0]) < .5 && Math.abs(expectedSize[1] - actualSize[1]) < .5);
    return target && sizeMatches && Math.abs(node.style.x - target.x) < .5 && Math.abs(node.style.y - target.y) < .5;
  });
}
function maybeAutoArrange() {
  if (!autoLayoutPending || automaticLayoutFrame || layoutSource !== 'automatic' || nodes.size < 2 || rendering || semanticWorking || queueDepth) return;
  const epoch = renderEpoch;
  automaticLayoutFrame = requestAnimationFrame(() => {
    automaticLayoutFrame = 0;
    if (epoch !== renderEpoch || layoutSource !== 'automatic' || rendering || semanticWorking || queueDepth) return;
    autoLayoutPending = false;
    if (activeOrientation !== 'radial' && nativePlanMatchesVisible()) {
      reportLayout();
      trace('layout', 'Positions retained', 'Native plan already matches the canvas');
      return;
    }
    void arrange(activeOrientation, undefined, { automatic: true });
  });
}
let arrangementGeneration = 0;
async function arrange(orientation, commandId, { automatic = false } = {}) {
  layoutSource = automatic ? 'automatic' : 'manual';
  if (!automatic) { autoLayoutPending = false; planGeneration++; preparedNativePlan = null; plannedStructure = ''; }
  const generation = ++arrangementGeneration;
  await reorderMotion.cancel();
  if (generation !== arrangementGeneration) return;
  activeOrientation = orientation;
  const epoch = renderEpoch, started = performance.now();
  entranceController.abort(); entranceController = new AbortController();
  const signal = entranceController.signal;
  resetSketchEntrance(graph);
  // Settle partial card entrances, then remove only the visual connectors.
  // Their semantic edges stay intact while cards are being repositioned.
  graph.updateNodeData(graph.getNodeData().map(node => ({ id: node.id, style: { drawProgress: 1 } })));
  const edgeIds = graph.getEdgeData().map(edge => edge.id);
  let reinked = false;
  trace('layout', 'Rearranging', orientation);
  try {
    await graph.hideElement(edgeIds, false);
    viewportMotion.cancel();
    const targets = await reorderMotion.reorder(orientation);
    if (epoch !== renderEpoch || generation !== arrangementGeneration) return;
    for (const node of graph.getNodeData()) positions.set(node.id, { x: node.style.x, y: node.style.y });
    if (targets.length) {
      await refreshEdgeRoutes(graph);
          await viewportMotion.fit({ when: 'always' });
      const currentIds = new Set(graph.getEdgeData().map(edge => edge.id));
      await redrawSketchEdges(graph, { edges: edgeIds.filter(id => currentIds.has(id)), reducedMotion: reduced, signal });
      if (epoch !== renderEpoch || generation !== arrangementGeneration || signal.aborted) return;
      reinked = true;
    }
    reportLayout(commandId, targets.length > 0);
    syncVoiceContext();
    trace('layout', targets.length ? 'Arrangement visible' : 'Arrangement interrupted', orientation, { duration_ms: performance.now() - started });
  } catch (error) { trace('error', 'Layout failed', error.message); console.error(error); }
  finally {
    if (generation === arrangementGeneration) {
      const currentIds = new Set(graph.getEdgeData().map(edge => edge.id));
      const retained = edgeIds.filter(id => currentIds.has(id));
      // Cancellation and reduced motion must never leave hidden connectors.
      if (!reinked) graph.updateEdgeData(retained.map(id => ({ id, style: { drawProgress: 1 } })));
      await graph.showElement(retained, false);
    }
  }
}
async function applyLayoutCommand(command) {
  const epoch = renderEpoch;
  trace('tool', 'Layout requested', command.action);
  // Finish only the already queued patches; layout animation never blocks later patches.
  await renderChain;
  if (epoch !== renderEpoch) return;
  if (command.action === 'arrange') return arrange(command.orientation, command.id);
  layoutSource = 'manual'; autoLayoutPending = false; planGeneration++; preparedNativePlan = null; clearPlannedRoutes(graph);
  const node = graph.getNodeData(command.node_id), reference = graph.getNodeData(command.reference_id);
  if (!node || !reference) { reportLayout(command.id, false); trace('error', 'Card unavailable', command.node_id); return; }
  await reorderMotion.cancel();
  const size = item => Array.isArray(item.style?.size) ? item.style.size : [220, 120];
  const [width, height] = size(node), [refWidth, refHeight] = size(reference);
  const point = { x: reference.style.x, y: reference.style.y };
  if (command.placement === 'left' || command.placement === 'right') point.x += (command.placement === 'left' ? -1 : 1) * ((width + refWidth) / 2 + 36);
  else point.y += (command.placement === 'above' ? -1 : 1) * ((height + refHeight) / 2 + 36);
  positions.set(node.id, point); graph.updateNodeData([{ id: node.id, style: point }]);
  await graph.draw(); await refreshEdgeRoutes(graph); reportLayout(command.id); syncVoiceContext();
  trace('layout', 'Card moved', node.data?.label || node.id);
}
$('graph').addEventListener('pointerdown', () => reorderMotion.cancel());
graph.on('node:dragend', () => { layoutSource = 'manual'; autoLayoutPending = false; planGeneration++; preparedNativePlan = null; clearPlannedRoutes(graph); renderChain = renderChain.then(async () => { await refreshEdgeRoutes(graph); reportLayout(); syncVoiceContext(); }).catch(console.error); });

const inkTips = mountInkTooltips(document.querySelectorAll('.bar-side .quiet'), { isReduced: () => reduced });
$('conversation-toggle').onclick = () => showConversation(!conversationOpen);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && conversationOpen) {
    showConversation(false);
    $('conversation-toggle').focus();
  }
});
$('fit').onclick=()=>void viewportMotion.fit().catch(error=>{uiMotion.status($('graph-help'), 'The map could not fit. Try again.');console.error(error);});$('reset').onclick=()=>{recorder.reset();updateShare();if(nodes.size)void uiMotion.erase($('graph'));stableDecorations.reset();speechRibbon.clear();viewportMotion.reset();renderGeneration++;entranceController.abort();entranceController=new AbortController();demoTimers.forEach(clearTimeout);demoTimers=[];if(graphSocket?.readyState===WebSocket.OPEN){resetPending=true;renderEpoch++;graphSocket.send(JSON.stringify({type:'reset'}));uiMotion.clear([...$('transcript').children]);$('transcript').replaceChildren();uiMotion.status($('graph-help'), '');}};
$('example').onclick=()=>{const phrases=['We are going to talk about three topics.','First design.','Second engineering.','Third launch.','For design, focus on accessibility and a clear visual hierarchy.'];$('example').disabled=true;phrases.forEach((text,i)=>demoTimers.push(setTimeout(()=>{if(sendThought(text))addTranscript(text);if(i===phrases.length-1)$('example').disabled=false;},i*2200)));};
let voiceReady=false,starting=false,listening=false,player=null,voiceSocket=null,audioConfig={};
// Ask the server to refresh its own context; never send client-authored labels
// or instructions. Coalesce drawing events while reporting completed renders.
function syncVoiceContext() {
  if (voiceContextTimer || !listening || voiceSocket?.readyState !== WebSocket.OPEN) return;
  voiceContextTimer = setTimeout(() => {
    voiceContextTimer = null;
    if (listening && voiceSocket?.readyState === WebSocket.OPEN) {
      voiceSocket.send(JSON.stringify({ type: 'config', rendered_revision: renderedRevision }));
    }
  }, 500);
}
function graphVoiceReady(){return graphSocket?.readyState===WebSocket.OPEN&&Boolean(graphSessionId);}
const readAudioLevels = () => ({ input: player?.audioProcessor?.getInputLevels() || [], output: player?.audioProcessor?.getOutputLevels() || [] });
let voiceGeneration = 0;
function voiceUI() {
  splash.setVoice({ configured: voiceReady, ready: voiceReady && graphVoiceReady() });
  cara.update({ active: listening, connecting: starting, muted: caraMuted }); micMorph.set(listening); uiMotion.voice({ starting, listening });
  $('mic').classList.toggle('recording', listening);
  $('mic').disabled = !voiceReady || !graphVoiceReady();
  $('mic').setAttribute('aria-label', starting ? 'Cancel microphone connection' : listening ? 'Stop listening' : 'Start listening');
  uiMotion.status($('voice-status'), starting ? 'Connecting… tap to cancel' : listening ? 'Listening…' : voiceReady ? (graphVoiceReady() ? 'Start talking' : 'Reconnecting…') : 'Voice unavailable');
}
function stopVoice(message) {
  voiceGeneration++; clearTimeout(voiceContextTimer); voiceContextTimer = null; listening = false; starting = false;
  const socket = voiceSocket; voiceSocket = null;
  if (socket) { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' })); socket.close(); }
  const oldPlayer = player; player = null;
  if (oldPlayer) { voiceOutput.detach(); oldPlayer.stop(); }
  cara.update({ fault: Boolean(message) }); voiceUI(); trace('voice', 'Microphone stopped', message || 'Map preserved');
  if (message) { uiMotion.status($('notice'), message); splash.fail(message); }
}
async function startVoice() {
  if (starting || listening || !voiceReady || !graphVoiceReady()) return;
  const generation = ++voiceGeneration, pendingAudio = [];
  starting = true; cara.update({ fault: false }); voiceUI(); uiMotion.status($('notice'), ''); trace('voice', 'Requesting microphone');
  let activePlayer;
  const current = () => generation === voiceGeneration && player === activePlayer;
  try {
    activePlayer = new window.SyncedAudioPlayer({ basePath: '/static/js', sampleRate: 24000, pcmOutput: audioConfig.pcm || false, echoCancellation: true,
      onEncodedAudio: data => {
        if (!current()) return;
        if (listening && voiceSocket?.readyState === WebSocket.OPEN) voiceSocket.send(data);
        else if (starting) { if (pendingAudio.length < 150) pendingAudio.push(data); else stopVoice('Voice connection took too long. Try again.'); }
      },
      onEvent: event => { if (!current()) return; cara.voiceEvent(event); if (event === 'end_tts_audio') activePlayer.scheduleEndOfTurn(); },
      onEndOfTurn: () => { if (current()) cara.turnFinished(); },
      onText: ({ text, turnIdx, isUser }) => { if (!current()) return; addTranscript(text, isUser, `v${generation}-${isUser ? 'u' : 'a'}${turnIdx}`); if (isUser) cara.hear(); },
      onError: error => { if (current()) stopVoice(error.message || 'Voice stopped. Tap the mic to try again.'); },
    });
    player = activePlayer;
    const sessionId = graphSessionId;
    await activePlayer.start();
    if (!current() || !starting || !graphVoiceReady() || graphSessionId !== sessionId) { activePlayer.stop(); return; }
    voiceOutput.attach(activePlayer.audioProcessor); void splash.enter();
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/chat`); voiceSocket = socket;
    socket.onopen = () => {
      if (!current() || socket !== voiceSocket) { socket.close(); return; }
      socket.send(JSON.stringify({ type: 'start', graph_session_id: sessionId, server_transcript: true })); starting = false; listening = true;
      for (const chunk of pendingAudio.splice(0)) socket.send(chunk);
      trace('voice', 'Microphone connected', 'Early audio buffered and forwarded'); syncVoiceContext(); voiceUI();
    };
    socket.onmessage = event => {
      if (!current()) return;
      if (typeof event.data === 'string') {
        try { const value = JSON.parse(event.data); if (value.type === 'event' || value.type === 'error') trace('voice', value.event || 'Voice error', value.message || ''); } catch { /* player owns protocol errors */ }
      }
      activePlayer.handleMessage(event.data);
    };
    socket.onerror = () => { if (current()) stopVoice('Voice connection failed. Tap the mic to try again.'); };
    socket.onclose = () => { if (current() && socket === voiceSocket) stopVoice('Voice disconnected. Your map is still here.'); };
  } catch (error) { if (current()) stopVoice(error.name === 'NotAllowedError' ? 'Allow microphone access to talk with Cara.' : `Voice unavailable: ${error.message}`); }
}
$('mic').onclick=()=>(listening||starting)?stopVoice():startVoice();
async function readiness(){try{const [r,a]=await Promise.all([fetch('/api/readiness'),fetch('/api/audio-config')]);const ready=await r.json();audioConfig=await a.json();voiceReady=Boolean(ready.voice_ready)&&Boolean(window.SyncedAudioPlayer);if(!voiceReady)$('notice').textContent='Voice is not configured yet.';}catch{$('notice').textContent='Voice setup unavailable. Reload to try again.';}voiceUI();}
window.addEventListener('pagehide',()=>{clearTimeout(settledFitTimer);cancelAnimationFrame(automaticLayoutFrame);cancelAnimationFrame(traceResizeFrame);debug.dispose();inkTips.dispose();clearInterval(shareTimer);recorder.dispose();shareDialog.dispose();cara.dispose();stableDecorations.dispose();speechRibbon.dispose();illustrationLayer.dispose();reorderMotion.dispose();uiMotion.dispose();viewportMotion.dispose();reducedMedia.removeEventListener('change', reducedChanged);entranceController.abort();clearTimeout(reconnectTimer);demoTimers.forEach(clearTimeout);if(graphSocket){graphSocket.onclose=null;graphSocket.close();}stopVoice();});
function reducedChanged() {
  reduced = reducedMedia.matches;
  if (reduced) { illustrationLayer.reduce(); speechRibbon.reduce(); }
  viewportMotion.cancel();
  entranceController.abort(); entranceController = new AbortController();
  renderChain = renderChain.then(() => draw()).catch(console.error);
}
reducedMedia.addEventListener('change', reducedChanged);
renderChain = draw();connectGraph();readiness();
