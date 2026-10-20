import { Graph } from '@antv/g6';
import { refreshEdgeRoutes } from './graph-edge-routes.js';
import { classifyGraphHierarchy, paperEdgeStyle } from './graph-hierarchy.js';
import { createStableDecorations } from './stable-decorations.js';
import { createIllustrationLayer } from './illustration-layer.js';
import { createSketchReorder } from './sketch-layout.js';
import { createSketchIcon } from './sketch-icons.js';
import { mountMorphingControl } from './morphing-controls.js';
import { paperNodeStyle } from './sketch-style.js';
import { mountPaperBackground } from './paper-background.js';
import { registerSketchElements } from './sketch-elements.js';
import { drawSketchEntrance, resetSketchEntrance } from './sketch-motion.js';
import { createUIMotion } from './ui-motion.js';
import { createViewportMotion } from './viewport-motion.js';
import { createSpeechRibbon } from './speech-ribbon.js';
import { createCaraAvatar } from './cara-avatar.js';
import { createVoiceOutputMute } from './voice-output-mute.js';
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
const uiMotion = createUIMotion();
const speechRibbon = createSpeechRibbon(document.querySelector('.dock'), () => reduced);
const voiceOutput = createVoiceOutputMute();
let caraMuted = false;
const cara = createCaraAvatar(document.querySelector('.dock'), { readLevels: () => readAudioLevels(), isReduced: () => reduced, onMute: muted => { caraMuted = voiceOutput.setMuted(muted); cara.update({ muted: caraMuted }); } });
const graph = new Graph({container:'graph',autoResize:true,padding:[88,64,132,64],animation:false,node:{type:'sketch-rect',style:datum=>({radius:12,labelPlacement:'center',labelFontFamily:'Patrick Hand, cursive',labelFontSize:13,labelFill:'#174a9c',labelWordWrap:true,labelMaxLines:3,labelMaxWidth:148,shadowColor:'#173b6b14',shadowBlur:12,shadowOffsetY:4,...datum.style})},edge:{type:'sketch-cubic-horizontal',style:datum=>({stroke:'#2455a6',lineWidth:2.4,endArrow:true,...datum.style})},behaviors:['drag-canvas','zoom-canvas','drag-element']});
const viewportMotion = createViewportMotion(graph, () => reduced);
const illustrationLayer = createIllustrationLayer(graph, $('graph'), { isReduced: () => reduced,
  onDrawingChange: active => { illustrationDrawing = active; updateWork(); } });
const reorderMotion = createSketchReorder(graph, { reducedMotion: () => reduced });
let layoutIndex = -1;
const layoutOrientations = ['horizontal', 'vertical', 'reverse'];
const nodeRevisions = new Map();
let graphSessionId=null, renderEpoch=0, resetPending=false, renderedRevision=null, voiceContextTimer;
let entranceController = new AbortController();
let renderGeneration = 0, graphInitialized = false;
let nodes=new Map(), edges=new Map(), positions=new Map(), slot=0, graphSocket, renderChain=Promise.resolve(), reconnectTimer, demoTimers=[];
function position(n){if(positions.has(n.id))return positions.get(n.id);const parent=positions.get(n.parent_id);let p;if(parent){const siblings=[...nodes.values()].filter(v=>v.parent_id===n.parent_id);const i=siblings.findIndex(v=>v.id===n.id);p={x:parent.x+550,y:parent.y+((i%2?1:-1)*Math.ceil(i/2)*200)};while([...positions.values()].some(v=>Math.abs(v.x-p.x)<520&&Math.abs(v.y-p.y)<170))p.y+=200;}else{p={x:170,y:190+slot++*200};}positions.set(n.id,p);return p;}
async function draw({ animate = false } = {}) {
  const signal = entranceController.signal;
  const previous = graph.getData();
  for (const node of previous.nodes) {
    if (Number.isFinite(node.style?.x) && Number.isFinite(node.style?.y)) positions.set(node.id, { x: node.style.x, y: node.style.y });
  }
  const existingNodes = new Set(previous.nodes.map(n => n.id));
  const existingEdges = new Set(previous.edges.map(e => e.id));
  const addedNodes = animate ? [...nodes.keys()].filter(id => !existingNodes.has(id)) : [];
  const visibleEdges = [...edges.values()].filter(e => nodes.has(e.source) && nodes.has(e.target));
  // The backend sends a declared parent and its contains edge as separate
  // patches. Draw that known connection first so the child follows its line.
  for (const n of nodes.values()) {
    if (n.parent_id && nodes.has(n.parent_id) && !visibleEdges.some(e => e.source === n.parent_id && e.target === n.id)) {
      visibleEdges.push({ id: `contains:${n.parent_id}:${n.id}`, source: n.parent_id, target: n.id });
    }
  }
  const addedEdges = animate ? visibleEdges.filter(e => !existingEdges.has(e.id)).map(e => e.id) : [];
  const hierarchy = classifyGraphHierarchy([...nodes.values()], visibleEdges);
  const routeRevision = Date.now();
  stableDecorations.sync([...nodes.values()], visibleEdges, { nodeRevisions, renderedRevision });
  const dataNodes = [...nodes.values()].map(n => ({ id: n.id, data: { ...n, topicRole: hierarchy.nodeRoles.get(n.id) }, style: {
    ...paperNodeStyle({ ...n, topicRole: hierarchy.nodeRoles.get(n.id) }), ...stableDecorations.styleFor(n.id), illustrationSpace:168, ...position(n),
    drawProgress: !reduced && addedNodes.includes(n.id) ? 0 : 1,
  }}));
  graph.setData({ nodes: dataNodes, edges: visibleEdges.map(e => ({ ...e, style: {
    ...e.style, ...paperEdgeStyle(hierarchy.edgeRoles.get(e.id)), routeRevision, drawProgress: !reduced && addedEdges.includes(e.id) ? 0 : 1,
  }})) });
  if (!graphInitialized) { await graph.render(); graphInitialized = true; }
  else await graph.draw();
  illustrationLayer.sync(nodes.values());
  updateEmpty(nodes.size === 0);
  $('reorder').disabled = nodes.size === 0;
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
      if (!nodes.size) { positions.clear(); slot = 0; resetSketchEntrance(graph); queueDepth = 0; semanticWorking = false; updateWork(); }
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
      if (message.status === 'error' || message.status === 'unavailable') uiMotion.status($('graph-help'), message.message || 'The map could not update. Try another thought.');
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
function connectGraph(){graphSocket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws/graph`);graphSocket.onopen=()=>{voiceUI();uiMotion.status($('graph-help'), '');uiMotion.status($('graph-status'), 'Ready for your first thought');$('send').disabled=false;$('example').disabled=false;};graphSocket.onmessage=e=>{try{enqueue(JSON.parse(e.data));}catch{ uiMotion.status($('graph-help'), 'A map update could not be read.');}};graphSocket.onclose=()=>{stableDecorations.reset();nodeRevisions.clear();graphSessionId=null;renderedRevision=null;if(listening||starting)stopVoice('Canvas disconnected. Restart voice after it reconnects.');else voiceUI();uiMotion.status($('graph-status'), 'Reconnecting canvas…');$('send').disabled=true;$('example').disabled=true;reconnectTimer=setTimeout(connectGraph,2000);};graphSocket.onerror=()=>{uiMotion.status($('graph-help'), 'Canvas connection unavailable. Reconnecting…');};}
function sendThought(text){if(graphSocket?.readyState!==WebSocket.OPEN){uiMotion.status($('notice'), 'Wait for the canvas to reconnect, then add your thought.');return false;}graphSocket.send(JSON.stringify({type:'text',text,mode:'append'}));return true;}
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
for (const [id, icon] of [['fit', 'fit'], ['reset', 'reset'], ['send', 'play'], ['example', 'play']]) {
  $(id).prepend(createSketchIcon(icon, { size: 18, decorative: true }));
}
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
  });
};
$('graph').addEventListener('pointerdown', () => reorderMotion.cancel());
graph.on('node:dragend', () => { renderChain = renderChain.then(() => refreshEdgeRoutes(graph)).catch(error => console.error(error)); });

$('conversation-toggle').onclick = () => showConversation(!conversationOpen);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && conversationOpen) {
    showConversation(false);
    $('conversation-toggle').focus();
  }
});
$('text-form').onsubmit=e=>{e.preventDefault();const text=$('thought').value.trim();if(text&&sendThought(text)){addTranscript(text);$('thought').value='';}};$('thought').onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))$('text-form').requestSubmit();};
$('fit').onclick=()=>void viewportMotion.fit().catch(error=>{uiMotion.status($('graph-help'), 'The map could not fit. Try again.');console.error(error);});$('reset').onclick=()=>{stableDecorations.reset();speechRibbon.clear();viewportMotion.reset();renderGeneration++;entranceController.abort();entranceController=new AbortController();demoTimers.forEach(clearTimeout);demoTimers=[];if(graphSocket?.readyState===WebSocket.OPEN){resetPending=true;renderEpoch++;graphSocket.send(JSON.stringify({type:'reset'}));uiMotion.clear([...$('transcript').children]);$('transcript').replaceChildren();uiMotion.status($('graph-help'), '');}};
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
function voiceUI(){cara.update({ active: listening, connecting: starting, muted: caraMuted });micMorph.set(listening);uiMotion.voice({ starting, listening }); $('mic').classList.toggle('recording',listening);$('mic').disabled=starting||!voiceReady||!graphVoiceReady();$('mic').setAttribute('aria-label',listening?'Stop listening':'Start listening');uiMotion.status($('voice-status'), starting?'Connecting…':listening?'Listening…':voiceReady?(graphVoiceReady()?'Start talking':'Reconnecting…'):'Use text below');}
function stopVoice(message){cara.update({fault:Boolean(message)});clearTimeout(voiceContextTimer);voiceContextTimer=null;listening=false;starting=false;const socket=voiceSocket;voiceSocket=null;if(socket){if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'stop'}));socket.close();}if(player){voiceOutput.detach();player.stop();player=null;}voiceUI();if(message)uiMotion.status($('notice'), message);}
async function startVoice(){if(starting||listening||!voiceReady||!graphVoiceReady())return;starting=true;cara.update({fault:false});voiceUI();uiMotion.status($('notice'), '');try{player=new window.SyncedAudioPlayer({basePath:'/static/js',sampleRate:24000,pcmOutput:audioConfig.pcm||false,echoCancellation:true,onEncodedAudio:data=>{if(listening&&voiceSocket?.readyState===WebSocket.OPEN)voiceSocket.send(data);},onEvent:event=>{cara.voiceEvent(event);if(event==='end_tts_audio')player?.scheduleEndOfTurn();},onEndOfTurn:()=>cara.turnFinished(),onText:({text,turnIdx,isUser})=>{addTranscript(text,isUser,`${isUser?'u':'a'}${turnIdx}`);if(isUser){cara.hear();sendThought(text);}},onError:error=>stopVoice(error.message||'Voice stopped. You can keep typing.')});const activePlayer=player;const sessionId=graphSessionId;await activePlayer.start();if(!starting||player!==activePlayer||!graphVoiceReady()||graphSessionId!==sessionId){activePlayer.stop();return;}voiceOutput.attach(activePlayer.audioProcessor);voiceSocket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws/chat`);const socket=voiceSocket;socket.onopen=()=>{if(socket!==voiceSocket)return;socket.send(JSON.stringify({type:'start',graph_session_id:graphSessionId}));starting=false;listening=true;syncVoiceContext();voiceUI();};socket.onmessage=e=>player?.handleMessage(e.data);socket.onerror=()=>stopVoice('Voice connection failed. You can keep typing.');socket.onclose=()=>{if(socket===voiceSocket)stopVoice('Voice disconnected. Your map is still here.');};}catch(e){stopVoice(e.name==='NotAllowedError'?'Allow microphone access to talk, or keep typing.':`Voice unavailable: ${e.message}`);}}
$('mic').onclick=()=>listening?stopVoice():startVoice();
async function readiness(){try{const [r,a]=await Promise.all([fetch('/api/readiness'),fetch('/api/audio-config')]);const ready=await r.json();audioConfig=await a.json();voiceReady=Boolean(ready.voice_ready)&&Boolean(window.SyncedAudioPlayer);if(!voiceReady)$('notice').textContent='Voice is not configured yet. Type a thought to start your map.';}catch{$('notice').textContent='Voice setup unavailable. You can still build your map with text.';}voiceUI();}
window.addEventListener('pagehide',()=>{cara.dispose();stableDecorations.dispose();speechRibbon.dispose();illustrationLayer.dispose();reorderMotion.dispose();uiMotion.dispose();viewportMotion.dispose();reducedMedia.removeEventListener('change', reducedChanged);entranceController.abort();clearTimeout(reconnectTimer);demoTimers.forEach(clearTimeout);if(graphSocket){graphSocket.onclose=null;graphSocket.close();}stopVoice();});
function reducedChanged() {
  reduced = reducedMedia.matches;
  if (reduced) { illustrationLayer.reduce(); speechRibbon.reduce(); }
  viewportMotion.cancel();
  entranceController.abort(); entranceController = new AbortController();
  renderChain = renderChain.then(() => draw()).catch(console.error);
}
reducedMedia.addEventListener('change', reducedChanged);
renderChain = draw();connectGraph();readiness();uiMotion.intro();
