import { Graph } from '@antv/g6';
import { mountMorphingControl } from './morphing-controls.js';
import { paperNodeStyle } from './sketch-style.js';
import { mountPaperBackground } from './paper-background.js';
import { registerSketchElements } from './sketch-elements.js';
import { drawSketchEntrance, animateSketchUpdates, resetSketchEntrance } from './sketch-motion.js';
import { createUIMotion } from './ui-motion.js';
import { createViewportMotion } from './viewport-motion.js';
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
const graph = new Graph({container:'graph',autoResize:true,padding:[100,60,140,60],animation:false,node:{type:'sketch-rect',style:datum=>({radius:12,labelPlacement:'center',labelFontFamily:'Figtree, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',labelFontSize:13,labelFill:'#174a9c',labelWordWrap:true,labelMaxLines:3,labelMaxWidth:148,shadowColor:'#173b6b14',shadowBlur:12,shadowOffsetY:4,...datum.style})},edge:{type:'sketch-cubic-horizontal',style:datum=>({stroke:'#2455a6',lineWidth:1.4,endArrow:false,...datum.style})},behaviors:['drag-canvas','zoom-canvas','drag-element']});
const viewportMotion = createViewportMotion(graph, () => reduced);
let graphSessionId=null, renderEpoch=0, resetPending=false;
let entranceController = new AbortController();
let renderGeneration = 0;
let nodes=new Map(), edges=new Map(), positions=new Map(), slot=0, graphSocket, renderChain=Promise.resolve(), reconnectTimer, demoTimers=[];
function position(n){if(positions.has(n.id))return positions.get(n.id);const parent=positions.get(n.parent_id);let p;if(parent){const siblings=[...nodes.values()].filter(v=>v.parent_id===n.parent_id);const i=siblings.findIndex(v=>v.id===n.id);p={x:parent.x+370,y:parent.y+((i%2?1:-1)*Math.ceil(i/2)*200)};while([...positions.values()].some(v=>Math.abs(v.x-p.x)<330&&Math.abs(v.y-p.y)<170))p.y+=200;}else{p={x:170,y:190+slot++*200};}positions.set(n.id,p);return p;}
async function draw({ animate = false } = {}) {
  const signal = entranceController.signal;
  const previous = graph.getData();
  const existingNodes = new Set(previous.nodes.map(n => n.id));
  const previousNodes = new Map(previous.nodes.map(n => [n.id, n.data]));
  const changedNodes = animate ? [...nodes.values()].filter(n => previousNodes.has(n.id) && JSON.stringify(previousNodes.get(n.id)) !== JSON.stringify(n)).map(n => n.id) : [];
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
  const dataNodes = [...nodes.values()].map(n => ({ id: n.id, data: n, style: {
    ...paperNodeStyle(n), ...position(n),
    drawProgress: !reduced && addedNodes.includes(n.id) ? 0 : 1,
  }}));
  graph.setData({ nodes: dataNodes, edges: visibleEdges.map(e => ({ ...e, style: {
    ...e.style, drawProgress: !reduced && addedEdges.includes(e.id) ? 0 : 1,
  }})) });
  await graph.render();
  updateEmpty(nodes.size === 0);
  await Promise.all([
    nodes.size ? viewportMotion.fit({ when: 'overflow', direction: 'both' }) : Promise.resolve(),
    drawSketchEntrance(graph, { nodes: addedNodes, edges: addedEdges, reducedMotion: reduced, signal }),
    animateSketchUpdates(graph, { nodes: changedNodes, reducedMotion: reduced, signal }),
  ]);
}
let semanticWorking = false, rendering = false, queueDepth = 0;
function updateWork() {
  const busy = semanticWorking || rendering || queueDepth > 0;
  $('pulse').classList.toggle('busy', busy);
  uiMotion.busy(busy);
}
function enqueue(message) {
  if (message.type === 'graph_session') { graphSessionId = message.id; voiceUI(); return; }
  if (resetPending && message.type === 'graph_patch') return;
  if (message.type === 'graph_snapshot' && !message.nodes.length) {
    resetPending = false; renderEpoch++;
    entranceController.abort(); entranceController = new AbortController();
  }
  const epoch = renderEpoch;
  renderChain = renderChain.then(async () => {
    if (epoch !== renderEpoch) return;
    if (message.type === 'graph_snapshot') {
      nodes = new Map(message.nodes.map(n => [n.id, n]));
      edges = new Map(message.edges.map(e => [e.id, e]));
      if (!nodes.size) { positions.clear(); slot = 0; resetSketchEntrance(graph); queueDepth = 0; semanticWorking = false; updateWork(); }
      await draw();
    } else if (message.type === 'graph_patch') {
      const op = message.op;
      if (op.node) nodes.set(op.node.id, { ...nodes.get(op.node.id), ...op.node });
      if (op.edge) edges.set(op.edge.id, op.edge);
      rendering = true; queueDepth = message.queue_depth || 0; updateWork();
      uiMotion.status($('graph-status'), message.layer === 'structure' ? 'Finding connections…' : 'Adding a little detail…');
      try { await draw({ animate: true }); } finally { rendering = false; updateWork(); }
      if (!semanticWorking && !queueDepth) uiMotion.status($('graph-status'), 'Ready for your next thought');
    } else if (message.type === 'graph_status') {
      semanticWorking = message.status === 'working';
      if (Number.isFinite(message.queue_depth)) queueDepth = message.queue_depth;
      updateWork();
      uiMotion.status($('graph-status'), message.message || (semanticWorking ? 'Shaping your thoughts…' : 'Ready for your next thought'));
      if (message.status === 'error' || message.status === 'unavailable') uiMotion.status($('graph-help'), message.message || 'The map could not update. Try another thought.');
      else if (semanticWorking) uiMotion.status($('graph-help'), '');
    } else if (message.type === 'refinement') {
      addTranscript(message.question, false); uiMotion.status($('graph-help'), message.question);
    } else if (message.type === 'graph_error' || message.type === 'error') {
      uiMotion.status($('graph-help'), message.message || 'The map could not update.');
    }
  }).catch(error => {
    rendering = false; semanticWorking = false; queueDepth = 0; updateWork();
    uiMotion.status($('graph-help'), 'Canvas update failed. Reload to reconnect.'); console.error(error);
  });
}
function connectGraph(){graphSocket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws/graph`);graphSocket.onopen=()=>{voiceUI();uiMotion.status($('graph-help'), '');uiMotion.status($('graph-status'), 'Ready for your first thought');$('send').disabled=false;$('example').disabled=false;};graphSocket.onmessage=e=>{try{enqueue(JSON.parse(e.data));}catch{ uiMotion.status($('graph-help'), 'A map update could not be read.');}};graphSocket.onclose=()=>{graphSessionId=null;if(listening||starting)stopVoice('Canvas disconnected. Restart voice after it reconnects.');else voiceUI();uiMotion.status($('graph-status'), 'Reconnecting canvas…');$('send').disabled=true;$('example').disabled=true;reconnectTimer=setTimeout(connectGraph,2000);};graphSocket.onerror=()=>{uiMotion.status($('graph-help'), 'Canvas connection unavailable. Reconnecting…');};}
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
$('conversation-toggle').onclick = () => showConversation(!conversationOpen);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && conversationOpen) {
    showConversation(false);
    $('conversation-toggle').focus();
  }
});
$('text-form').onsubmit=e=>{e.preventDefault();const text=$('thought').value.trim();if(text&&sendThought(text)){addTranscript(text);$('thought').value='';}};$('thought').onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))$('text-form').requestSubmit();};
$('fit').onclick=()=>void viewportMotion.fit().catch(error=>{uiMotion.status($('graph-help'), 'The map could not fit. Try again.');console.error(error);});$('reset').onclick=()=>{viewportMotion.cancel();renderGeneration++;entranceController.abort();entranceController=new AbortController();demoTimers.forEach(clearTimeout);demoTimers=[];if(graphSocket?.readyState===WebSocket.OPEN){resetPending=true;renderEpoch++;graphSocket.send(JSON.stringify({type:'reset'}));uiMotion.clear([...$('transcript').children]);$('transcript').replaceChildren();uiMotion.status($('graph-help'), '');}};
$('example').onclick=()=>{const phrases=['We are going to talk about three topics.','First design.','Second engineering.','Third launch.','For design, focus on accessibility and a clear visual hierarchy.'];$('example').disabled=true;phrases.forEach((text,i)=>demoTimers.push(setTimeout(()=>{if(sendThought(text))addTranscript(text);if(i===phrases.length-1)$('example').disabled=false;},i*2200)));};
let voiceReady=false,starting=false,listening=false,player=null,voiceSocket=null,audioConfig={};
function graphVoiceReady(){return graphSocket?.readyState===WebSocket.OPEN&&Boolean(graphSessionId);}
const readAudioLevels = () => ({ input: player?.audioProcessor?.getInputLevels() || [], output: player?.audioProcessor?.getOutputLevels() || [] });
function voiceUI(){micMorph.set(listening);uiMotion.voice({ starting, listening });uiMotion.meter(listening ? readAudioLevels : null); $('mic').classList.toggle('recording',listening);$('mic').disabled=starting||!voiceReady||!graphVoiceReady();$('mic').setAttribute('aria-label',listening?'Stop listening':'Start listening');uiMotion.status($('voice-status'), starting?'Connecting…':listening?'Listening…':voiceReady?(graphVoiceReady()?'Start talking':'Reconnecting…'):'Use text below');}
function stopVoice(message){listening=false;starting=false;const socket=voiceSocket;voiceSocket=null;if(socket){if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'stop'}));socket.close();}if(player){player.stop();player=null;}voiceUI();if(message)uiMotion.status($('notice'), message);}
async function startVoice(){if(starting||listening||!voiceReady||!graphVoiceReady())return;starting=true;voiceUI();uiMotion.status($('notice'), '');try{player=new window.SyncedAudioPlayer({basePath:'/static/js',sampleRate:24000,pcmOutput:audioConfig.pcm||false,echoCancellation:true,onEncodedAudio:data=>{if(listening&&voiceSocket?.readyState===WebSocket.OPEN)voiceSocket.send(data);},onText:({text,turnIdx,isUser})=>{addTranscript(text,isUser,`${isUser?'u':'a'}${turnIdx}`);if(isUser)sendThought(text);},onError:error=>stopVoice(error.message||'Voice stopped. You can keep typing.')});const activePlayer=player;const sessionId=graphSessionId;await activePlayer.start();if(!starting||player!==activePlayer||!graphVoiceReady()||graphSessionId!==sessionId){activePlayer.stop();return;}voiceSocket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws/chat`);const socket=voiceSocket;socket.onopen=()=>{if(socket!==voiceSocket)return;socket.send(JSON.stringify({type:'start',graph_session_id:graphSessionId}));starting=false;listening=true;voiceUI();};socket.onmessage=e=>player?.handleMessage(e.data);socket.onerror=()=>stopVoice('Voice connection failed. You can keep typing.');socket.onclose=()=>{if(socket===voiceSocket)stopVoice('Voice disconnected. Your map is still here.');};}catch(e){stopVoice(e.name==='NotAllowedError'?'Allow microphone access to talk, or keep typing.':`Voice unavailable: ${e.message}`);}}
$('mic').onclick=()=>listening?stopVoice():startVoice();
async function readiness(){try{const [r,a]=await Promise.all([fetch('/api/readiness'),fetch('/api/audio-config')]);const ready=await r.json();audioConfig=await a.json();voiceReady=Boolean(ready.voice_ready)&&Boolean(window.SyncedAudioPlayer);if(!voiceReady)$('notice').textContent='Voice is not configured yet. Type a thought to start your map.';}catch{$('notice').textContent='Voice setup unavailable. You can still build your map with text.';}voiceUI();}
window.addEventListener('pagehide',()=>{uiMotion.dispose();viewportMotion.dispose();reducedMedia.removeEventListener('change', reducedChanged);entranceController.abort();clearTimeout(reconnectTimer);demoTimers.forEach(clearTimeout);if(graphSocket){graphSocket.onclose=null;graphSocket.close();}stopVoice();});
function reducedChanged() {
  reduced = reducedMedia.matches;
  viewportMotion.cancel();
  entranceController.abort(); entranceController = new AbortController();
  renderChain = renderChain.then(() => draw()).catch(console.error);
}
reducedMedia.addEventListener('change', reducedChanged);
connectGraph();readiness();draw();uiMotion.intro();
