import { Graph } from '@antv/g6';
import { animate as animateValue } from 'motion';
import { refreshEdgeRoutes } from './graph-edge-routes.js';
import { classifyGraphHierarchy, paperEdgeStyle } from './graph-hierarchy.js';
import { createStableDecorations } from './stable-decorations.js';
import { createIllustrationLayer } from './illustration-layer.js';
import { createSketchReorder } from './sketch-layout.js';
import { LIVE_ILLUSTRATION_RESERVE, isLooseCard, placeRadialNode, withContainsEdges } from './radial-layout.js';
import { createSketchIcon } from './sketch-icons.js';
import { mountMorphingControl } from './morphing-controls.js';
import { mountInkTooltips } from './ink-tooltip.js';
import { paperNodeStyle } from './sketch-style.js';
import { PRIMARY, paletteColour } from './palette.js';
import { mountPaperBackground } from './paper-background.js';
import { registerSketchElements } from './sketch-elements.js';
import { drawSketchEntrance, resetSketchEntrance } from './sketch-motion.js';
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
const graph = new Graph({container:'graph',autoResize:true,padding:[88,64,240,64],animation:false,node:{type:'sketch-rect',style:datum=>({radius:12,labelPlacement:'center',labelFontFamily:'Patrick Hand, cursive',labelFontSize:13,labelFill:'#123f85',labelWordWrap:true,labelMaxLines:3,labelMaxWidth:148,shadowColor:'#173b6b14',shadowBlur:12,shadowOffsetY:4,...datum.style})},edge:{type:'sketch-cubic-horizontal',style:datum=>({stroke:'#1c4690',lineWidth:2.4,endArrow:true,...datum.style})},behaviors:['drag-canvas','zoom-canvas','drag-element']});
const viewportMotion = createViewportMotion(graph, () => reduced);
const illustrationLayer = createIllustrationLayer(graph, $('graph'), { isReduced: () => reduced,
  onDrawingChange: active => { illustrationDrawing = active; updateWork(); } });
const reorderMotion = createSketchReorder(graph, { reducedMotion: () => reduced });
const recorder = createShareRecorder({ graph, graphElement: $('graph'), readCaptions: () => speechRibbon.snapshot(),
  caraCanvas: () => document.querySelector('.cara-avatar canvas'),
  isBusy: () => rendering || semanticWorking || queueDepth > 0 || illustrationDrawing });
const shareDialog = createShareDialog({ isReduced: () => reduced });
let shareSupported = true;
const updateShare = () => { $('share').disabled = !shareSupported || nodes.size === 0 || !recorder.hasClip; };
let layoutIndex = -1;
const layoutOrientations = ['radial', 'horizontal', 'vertical'];
const nodeRevisions = new Map();
let graphSessionId=null, renderEpoch=0, resetPending=false, renderedRevision=null, voiceContextTimer;
let entranceController = new AbortController();
let renderGeneration = 0, graphInitialized = false;
let nodes=new Map(), edges=new Map(), positions=new Map(), graphSocket, renderChain=Promise.resolve(), reconnectTimer, demoTimers=[];
// Placement only ever assigns new cards; placed cards never move. The live
// canvas grows as a radial mind map: branches open in the widest free angle
// around their topic (beside their group), deeper cards fan outward from
// their parent, and separate topics become satellite centres.
function liveCard(n) {
  // Sizes grow as body text and main-topic styling arrive, so reserve the
  // larger main size and illustration room on every branch up front.
  // A loose card (no parent, beside a neighbour) reserves art room like a branch.
  const root = n.kind === 'root' || (!n.parent_id && !isLooseCard(n));
  // Cards size to their content, so reserve most of the variant's grown size:
  // compact cards stay close together, and a card that gains body text rarely
  // outgrows its slot.
  const style = paperNodeStyle({ ...n, topicRole: root ? 'main' : n.topicRole });
  const [width, height] = style.size;
  const [maxWidth, maxHeight] = style.maxSize || style.size;
  return { id: n.id, parent_id: n.parent_id, near: n.near, group: n.group, kind: n.kind,
    width: Math.max(width + 20, maxWidth * .75), height: Math.max(height + 16, maxHeight * .75),
    space: n.illustration ? 200 : root ? 0 : LIVE_ILLUSTRATION_RESERVE };
}
function position(n){
  if(positions.has(n.id))return positions.get(n.id);
  const placed=[...positions].filter(([id])=>id!==n.id&&nodes.has(id)).map(([id,p])=>({...liveCard(nodes.get(id)),x:p.x,y:p.y}));
  const p=placeRadialNode(liveCard(n),placed);
  positions.set(n.id,p);return p;
}
// A card whose group changes glides to its new group's lane instead of jumping.
const placedGroup = new Map();
function regroupMoves() {
  const moves = [];
  for (const n of nodes.values()) {
    const was = placedGroup.get(n.id);
    if (was !== undefined && n.group && was !== n.group && positions.has(n.id)) {
      const from = positions.get(n.id);
      positions.delete(n.id);
      moves.push({ id: n.id, from, to: position(n) });
    }
  }
  for (const n of nodes.values()) placedGroup.set(n.id, n.group);
  return moves;
}
async function animateMoves(moves) {
  const set = p => graph.updateNodeData(moves.map(({ id, from, to }) => ({ id, style: { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p } })));
  if (!reduced) {
    let drawing = null, dirty = false;
    const flush = () => {
      if (drawing) { dirty = true; return; }
      drawing = graph.draw().finally(() => { drawing = null; if (dirty) { dirty = false; flush(); } });
    };
    await animateValue(0, 1, { duration: .75, ease: [.65, 0, .35, 1], onUpdate: p => { set(p); flush(); } });
  }
  set(1);
  await graph.draw();
  await refreshEdgeRoutes(graph);
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
  const previous = graph.getData();
  for (const node of previous.nodes) {
    if (Number.isFinite(node.style?.x) && Number.isFinite(node.style?.y)) positions.set(node.id, { x: node.style.x, y: node.style.y });
  }
  const existingNodes = new Set(previous.nodes.map(n => n.id));
  const existingEdges = new Set(previous.edges.map(e => e.id));
  const addedNodes = animate ? [...nodes.keys()].filter(id => !existingNodes.has(id)) : [];
  // The backend sends a declared parent and its contains edge as separate
  // patches. Draw that known connection first so the child follows its line;
  // loose cards (no parent_id, optional `near`) get no arrow.
  const visibleEdges = withContainsEdges([...nodes.values()], [...edges.values()]);
  const addedEdges = animate ? visibleEdges.filter(e => !existingEdges.has(e.id)).map(e => e.id) : [];
  // A loose card is a supporting idea, not another main topic, despite having no incoming arrow.
  const firstNode = nodes.keys().next().value;
  const hierarchy = classifyGraphHierarchy([...nodes.values()].map(n => n.id !== firstNode && isLooseCard(n) && !n.topicRole ? { ...n, topicRole: 'supporting' } : n), visibleEdges);
  const routeRevision = Date.now();
  stableDecorations.sync([...nodes.values()], visibleEdges, { nodeRevisions, renderedRevision });
  const moves = regroupMoves();
  const startAt = new Map(moves.map(move => [move.id, move.from]));
  const dataNodes = [...nodes.values()].map(n => ({ id: n.id, data: { ...n, topicRole: hierarchy.nodeRoles.get(n.id) }, style: {
    ...paperNodeStyle({ ...n, topicRole: hierarchy.nodeRoles.get(n.id) }), ...stableDecorations.styleFor(n.id), ...(n.illustration ? { illustrationSpace: 200 } : {}), ...(startAt.get(n.id) || position(n)),
    drawProgress: !reduced && addedNodes.includes(n.id) ? 0 : 1,
  }}));
  graph.setData({ nodes: dataNodes, edges: visibleEdges.map(e => ({ ...e, style: {
    ...e.style, ...paperEdgeStyle(hierarchy.edgeRoles.get(e.id)), ...edgeTint(e), routeRevision, drawProgress: !reduced && addedEdges.includes(e.id) ? 0 : 1,
  }})) });
  if (!graphInitialized) { await graph.render(); graphInitialized = true; }
  else await graph.draw();
  if (moves.length) await animateMoves(moves);
  illustrationLayer.sync(nodes.values());
  updateEmpty(nodes.size === 0);
  $('reorder').disabled = nodes.size === 0;
  updateShare();
  // Reframing can retarget smoothly while new patches keep drawing.
  if (nodes.size) void viewportMotion.fit({ when: 'overflow' }).catch(error => {
    uiMotion.status($('graph-help'), 'The map could not reframe. Try Fit map.'); console.error(error);
  });
  await drawSketchEntrance(graph, { nodes: addedNodes, edges: addedEdges, reducedMotion: reduced, signal });
}
let semanticWorking = false, rendering = false, queueDepth = 0, illustrationDrawing = false;
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
  if (message.type === 'decoration_receipt') {
    if (message.accepted) { cara.happy(true); syncVoiceContext(); }
    return;
  }
  if (message.type === 'graph_session') { graphSessionId = message.id; voiceUI(); return; }
  if (resetPending && message.type === 'graph_patch') return;
  if (message.type === 'graph_snapshot' && !message.nodes.length) {
    stableDecorations.reset();
    nodeRevisions.clear();
    reorderMotion.cancel();
    layoutIndex = -1; reorderLabel.textContent = 'Rearrange';
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
      if (!nodes.size) { positions.clear(); placedGroup.clear(); resetSketchEntrance(graph); queueDepth = 0; semanticWorking = false; updateWork(); }
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
      if (op.node) nodes.set(op.node.id, { ...nodes.get(op.node.id), ...op.node });
      if (op.edge) edges.set(op.edge.id, op.edge);
      rendering = true; queueDepth = message.queue_depth || 0; updateWork();
      uiMotion.status($('graph-status'), message.layer === 'structure' ? 'Finding connections…' : 'Adding a little detail…');
      try { await draw({ animate: true }); renderedRevision = message.revision; syncVoiceContext(); } finally { rendering = false; updateWork(); }
      if (!semanticWorking && !queueDepth) { uiMotion.status($('graph-status'), 'Ready for your next thought'); cara.happy(); }
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
function connectGraph(){graphSocket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws/graph`);graphSocket.onopen=()=>{voiceUI();uiMotion.status($('graph-help'), '');uiMotion.status($('graph-status'), 'Ready for your first thought');$('example').disabled=false;};graphSocket.onmessage=e=>{try{enqueue(JSON.parse(e.data));}catch{ uiMotion.status($('graph-help'), 'A map update could not be read.');}};graphSocket.onclose=()=>{stableDecorations.reset();nodeRevisions.clear();graphSessionId=null;renderedRevision=null;if(listening||starting)stopVoice('Canvas disconnected. Restart voice after it reconnects.');else voiceUI();uiMotion.status($('graph-status'), 'Reconnecting canvas…');$('example').disabled=true;reconnectTimer=setTimeout(connectGraph,2000);};graphSocket.onerror=()=>{uiMotion.status($('graph-help'), 'Canvas connection unavailable. Reconnecting…');};}
function sendThought(text,speaker='user'){if(graphSocket?.readyState!==WebSocket.OPEN){uiMotion.status($('notice'), 'Wait for the canvas to reconnect, then add your thought.');return false;}graphSocket.send(JSON.stringify({type:'text',text,mode:'append',speaker}));return true;}
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
const reorderLabel = document.createElement('span');
reorderLabel.textContent = 'Rearrange';
$('reorder').replaceChildren(reorderLabel);
const reorderIcon = mountMorphingControl($('reorder'), { from: 'activity', to: 'move', size: 18 });
$('reorder').disabled = true;
$('reorder').onclick = () => {
  const epoch = renderEpoch;
  const orientation = layoutOrientations[++layoutIndex % layoutOrientations.length];
  $('reorder').disabled = true;
  $('reorder').setAttribute('aria-busy', 'true');
  reorderIcon.set(true);
  renderChain = renderChain.then(async () => {
    if (epoch !== renderEpoch || !graph.getNodeData().length) return;
    viewportMotion.cancel();
    const targets = await reorderMotion.reorder(orientation);
    if (epoch !== renderEpoch) return;
    for (const node of graph.getNodeData()) positions.set(node.id, { x: node.style.x, y: node.style.y });
    if (!targets.length) return;
    await refreshEdgeRoutes(graph);
    await viewportMotion.fit({ when: 'always' });
    reorderLabel.textContent = orientation === 'reverse' ? 'Right to left' : orientation[0].toUpperCase() + orientation.slice(1);
  }).catch(error => {
    console.error(error);
    uiMotion.status($('graph-help'), 'The layout could not update. Try rearranging again.');
  }).finally(() => {
    reorderIcon.set(false);
    $('reorder').removeAttribute('aria-busy');
    $('reorder').disabled = nodes.size === 0;
    updateShare();
  });
};
$('graph').addEventListener('pointerdown', () => reorderMotion.cancel());
graph.on('node:dragend', () => { renderChain = renderChain.then(() => refreshEdgeRoutes(graph)).catch(error => console.error(error)); });

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
function voiceUI(){splash.setVoice({configured:voiceReady,ready:voiceReady&&graphVoiceReady()});cara.update({ active: listening, connecting: starting, muted: caraMuted });micMorph.set(listening);uiMotion.voice({ starting, listening }); $('mic').classList.toggle('recording',listening);$('mic').disabled=starting||!voiceReady||!graphVoiceReady();$('mic').setAttribute('aria-label',listening?'Stop listening':'Start listening');uiMotion.status($('voice-status'), starting?'Connecting…':listening?'Listening…':voiceReady?(graphVoiceReady()?'Start talking':'Reconnecting…'):'Voice unavailable');}
function stopVoice(message){cara.update({fault:Boolean(message)});clearTimeout(voiceContextTimer);voiceContextTimer=null;listening=false;starting=false;const socket=voiceSocket;voiceSocket=null;if(socket){if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'stop'}));socket.close();}if(player){voiceOutput.detach();player.stop();player=null;}voiceUI();if(message){uiMotion.status($('notice'), message);splash.fail(message);}}
async function startVoice(){if(starting||listening||!voiceReady||!graphVoiceReady()){splash.fail('Voice is still warming up. Try again in a moment.');return;}starting=true;cara.update({fault:false});voiceUI();uiMotion.status($('notice'), '');try{player=new window.SyncedAudioPlayer({basePath:'/static/js',sampleRate:24000,pcmOutput:audioConfig.pcm||false,echoCancellation:true,onEncodedAudio:data=>{if(listening&&voiceSocket?.readyState===WebSocket.OPEN)voiceSocket.send(data);},onEvent:event=>{cara.voiceEvent(event);if(event==='end_tts_audio')player?.scheduleEndOfTurn();},onEndOfTurn:()=>cara.turnFinished(),onText:({text,turnIdx,isUser})=>{addTranscript(text,isUser,`${isUser?'u':'a'}${turnIdx}`);if(isUser)cara.hear();sendThought(text,isUser?'user':'assistant');},onError:error=>stopVoice(error.message||'Voice stopped. Tap the mic to try again.')});const activePlayer=player;const sessionId=graphSessionId;await activePlayer.start();if(!starting||player!==activePlayer||!graphVoiceReady()||graphSessionId!==sessionId){activePlayer.stop();return;}voiceOutput.attach(activePlayer.audioProcessor);void splash.enter();voiceSocket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws/chat`);const socket=voiceSocket;socket.onopen=()=>{if(socket!==voiceSocket)return;socket.send(JSON.stringify({type:'start',graph_session_id:graphSessionId}));starting=false;listening=true;syncVoiceContext();voiceUI();};socket.onmessage=e=>player?.handleMessage(e.data);socket.onerror=()=>stopVoice('Voice connection failed. Tap the mic to try again.');socket.onclose=()=>{if(socket===voiceSocket)stopVoice('Voice disconnected. Your map is still here.');};}catch(e){stopVoice(e.name==='NotAllowedError'?'Allow microphone access to talk with Cara.':`Voice unavailable: ${e.message}`);}}
$('mic').onclick=()=>listening?stopVoice():startVoice();
async function readiness(){try{const [r,a]=await Promise.all([fetch('/api/readiness'),fetch('/api/audio-config')]);const ready=await r.json();audioConfig=await a.json();voiceReady=Boolean(ready.voice_ready)&&Boolean(window.SyncedAudioPlayer);if(!voiceReady)$('notice').textContent='Voice is not configured yet.';}catch{$('notice').textContent='Voice setup unavailable. Reload to try again.';}voiceUI();}
window.addEventListener('pagehide',()=>{inkTips.dispose();clearInterval(shareTimer);recorder.dispose();shareDialog.dispose();cara.dispose();stableDecorations.dispose();speechRibbon.dispose();illustrationLayer.dispose();reorderMotion.dispose();uiMotion.dispose();viewportMotion.dispose();reducedMedia.removeEventListener('change', reducedChanged);entranceController.abort();clearTimeout(reconnectTimer);demoTimers.forEach(clearTimeout);if(graphSocket){graphSocket.onclose=null;graphSocket.close();}stopVoice();});
function reducedChanged() {
  reduced = reducedMedia.matches;
  if (reduced) { illustrationLayer.reduce(); speechRibbon.reduce(); }
  viewportMotion.cancel();
  entranceController.abort(); entranceController = new AbortController();
  renderChain = renderChain.then(() => draw()).catch(console.error);
}
reducedMedia.addEventListener('change', reducedChanged);
renderChain = draw();connectGraph();readiness();
