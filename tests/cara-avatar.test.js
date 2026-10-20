import test from 'node:test';
import assert from 'node:assert/strict';
import { CARA_FRAMES, CARA_FPS, createCaraAvatar } from '../frontend/cara-avatar.js';
import { CaraState } from '../frontend/cara-state.js';

test('idle holds its pose for seconds, with one short blink instead of a loop', () => {
  const state = new CaraState(0);
  for(let time=0;time<6100;time+=100) assert.equal(state.sample(0,time).frame,0);
  assert.equal(state.sample(0,6100).frame,1);
  assert.equal(state.sample(0,6300).frame,0);
  assert.equal(state.sample(0,8000).frame,0);
});
test('listening holds a pose; actual user speech takes priority over background drawing', () => {
  const state = new CaraState(0);
  state.update({active:true},0);state.sample(0,0);
  for(let time=300;time<5000;time+=100) assert.equal(state.sample(0,time).frame,2);
  state.update({drawing:true},5000);state.hear(5000);
  assert.equal(state.sample(0,5000).mood,'listening');
});
test('short work pulses coalesce into the tongue-out drawing hold', () => {
  const state = new CaraState(0);
  state.update({drawing:true},0);state.sample(0,0);
  assert.equal(state.sample(0,300).frame,5);
  state.update({drawing:false},350);
  assert.equal(state.sample(0,500).frame,5);
  state.update({drawing:true},550);state.update({drawing:false},700);
  assert.equal(state.sample(0,1000).mood,'drawing');
  state.sample(0,1300);
  assert.equal(state.sample(0,1600).mood,'idle');
});
test('Gradium generation waits for playback and mouth changes track level, not time', () => {
  const state = new CaraState(0);
  state.update({active:true},0);state.voiceEvent('llm_started',0);state.sample(0,0);
  assert.equal(state.sample(0,300).frame,4);
  state.voiceEvent('first_tts_audio',350);
  assert.equal(state.sample(0,400).mood,'thinking');
  assert.equal(state.sample(110,500).frame,13);
  assert.equal(state.sample(110,800).frame,13);
  assert.equal(state.sample(40,900).frame,12);
  assert.equal(state.sample(210,1000).frame,15);
  assert.equal(state.sample(0,1100).frame,0);
});
test('muting retains visual speech; interruption closes it despite residual analyser data', () => {
  const state = new CaraState(0);
  state.update({active:true,muted:true},0);state.voiceEvent('first_tts_audio',0);
  assert.equal(state.sample(210,100).mood,'speaking');
  state.voiceEvent('interrupted',200);
  assert.equal(state.sample(210,200).mood,'listening');
  state.update({active:false},300);state.sample(210,300);
  assert.equal(state.sample(210,600).mood,'idle');
});
test('celebrations are bounded and reduced motion has no blinking or mouth cycling', () => {
  const state = new CaraState(0);
  state.react('delighted',0);state.sample(0,0);
  assert.equal(state.sample(0,300).frame,8);
  state.sample(0,1700);assert.equal(state.sample(0,2000).mood,'idle');
  state.react('delighted',2100);assert.equal(state.sample(0,2500).mood,'idle');
  assert.equal(new CaraState(0).sample(0,7000,true).frame,0);
  state.update({active:true},3000);state.voiceEvent('first_tts_audio',3000);
  assert.equal(state.sample(220,3100,true).frame,13);
});
test('production atlas uses spacious integer cells with no crop overlaps', () => {
  assert.equal(CARA_FRAMES.length,24);assert.equal(CARA_FPS,10);
  for(const [index,[x,y,w,h]] of CARA_FRAMES.entries()) {
    assert.deepEqual([x,y,w,h],[(index%4)*256,Math.floor(index/4)*256,256,256]);
  }
});
test('renderer arrives once, then stops redrawing an idle head and cleans up', t => {
  const previous={document:globalThis.document,Image:globalThis.Image,performance:globalThis.performance,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
  let now=0,sampler,cleared=false,draws=0,figure;
  const element=()=>({dataset:{},setAttribute(){},insertAdjacentHTML(){},addEventListener(){},append(){},remove(){},getContext:()=>({clearRect(){},drawImage(){draws++;}})});
  globalThis.document={hidden:false,createElement:element,addEventListener(){},removeEventListener(){}};
  globalThis.Image=class{complete=true;naturalWidth=1024;};
  globalThis.performance={now:()=>now};globalThis.setInterval=fn=>{sampler=fn;return 1;};globalThis.clearInterval=()=>{cleared=true;};
  t.after(()=>Object.assign(globalThis,previous));
  const avatar=createCaraAvatar({prepend:el=>{figure=el;}});
  assert.equal(figure.dataset.mood,'arriving');assert.equal(figure.dataset.frame,'16');
  now=1400;sampler();assert.equal(figure.dataset.mood,'idle');
  const settled=draws;
  for(now=1500;now<5000;now+=100)sampler();
  assert.equal(draws,settled);
  avatar.dispose();assert.equal(cleared,true);
});
