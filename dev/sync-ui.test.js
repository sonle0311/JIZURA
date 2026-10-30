import { test, expect } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

function fixture(direct=false) {
  class Element {
    constructor(tag) { this.tagName=tag; this.children=[]; this.attrs={}; this.listeners={}; this.dataset={}; this.textContent=''; this.hidden=false; this.disabled=false; this.checked=false; this.classList={toggle(){}}; }
    append(...nodes) { this.children.push(...nodes); }
    after(n) { this.sibling=n; }
    replaceChildren(...nodes) { this.children=nodes; }
    setAttribute(k,v) { this.attrs[k]=String(v); }
    addEventListener(k,fn) { this.listeners[k]=fn; }
    click() { return this.listeners.click?.(); }
  }
  const anchor=new Element('section'), body=new Element('body'), requests=[], timers=new Map(), intervals=[];
  let timer=0;
  const find=(fn,root=anchor.sibling)=>root&&(fn(root)?root:root.children.map(n=>find(fn,n)).find(Boolean));
  const state={project:{lyrics:'<b>first</b>\nsecond\nmissing\nlocked',timing:{lineTimes:{}},overrides:{3:{lock:true}},version:1},audio:{duration:20,buffer:{duration:20,sampleRate:16000,length:320000,numberOfChannels:1,getChannelData:()=>new Float32Array(320000)}},busy:false,applies:0,undos:0,history:[],auditions:[]};
  const plan={lines:['<b>first</b>','second','missing','locked'].map((text,index)=>({index,text,start:index*5,visEnd:index*5+2}))};
  const J={}; const sandbox={J,Blob,FormData,AbortController,console,document:{documentElement:{lang:'en'},body,createElement:tag=>new Element(tag),querySelector:()=>anchor,getElementById:id=>find(n=>n.id===id)},window:{addEventListener(){}},setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval(){},setTimeout:(fn,ms)=>{timers.set(++timer,{fn,ms});return timer;},clearTimeout:id=>timers.delete(id),fetch:(url,options={})=>new Promise((resolve,reject)=>requests.push({url,options,reject,resolve:(data,ok=true,status=200)=>resolve({ok,status,json:async()=>data,text:async()=>JSON.stringify(data)})}))};
  vm.runInNewContext(readFileSync('src/11s_sync.js','utf8'),sandbox);
  if(existsSync('src/12_sync_ui.js'))vm.runInNewContext(readFileSync('src/12_sync_ui.js','utf8'),sandbox);
  expect(J.initSyncUI).toBeFunction();
  const ui=J.initSyncUI({getProject:()=>state.project,getAudio:()=>state.audio,getPlan:()=>({lines:plan.lines.map(l=>({...l,start:state.project.timing.lineTimes[l.index]??l.start,visEnd:state.project.timing.lineEnds?.[l.index]??l.visEnd}))}),isBusy:()=>state.busy,applyTranscript:direct?next=>{state.history.push(state.project);state.project=next;state.applies++;ui.refresh();}:undefined,applySync:next=>{state.history.push(state.project);state.project=next;state.applies++;ui.refresh();},undoSync:()=>{state.project=state.history.pop();state.undos++;},audition:(start,end)=>state.auditions.push([start,end])});
  return {J,ui,state,requests,timers,intervals,find,byId:id=>find(n=>n.id===id)};
}
const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const result={duration:20,language:'en',warnings:['weak_anchor'],lines:['<b>first</b>','second','missing','locked'].map((text,index)=>({index,text,start:index===2?null:index*5+0.1,end:index===2?null:index*5+1.5,confidence:index===1?0.4:0.9,status:index===2?'unmatched':index===1?'review':'matched'}))};
const ready=async f=>{f.requests[0].resolve({available:true,engine:'whisperx',device:'cpu'});await settle();};
const complete=async f=>{f.byId('syncStart').click();f.requests.at(-1).resolve({id:'job-a',status:'completed',stage:'done',result});await settle();};

test('sync uploads the current mono WAV, reviews safe text, auditions, and applies only selected unlocked rows',async()=>{
  const f=fixture();await ready(f);await complete(f);
  const post=f.requests.find(r=>r.options.method==='POST'),metadata=JSON.parse(post.options.body.get('metadata'));
  expect(metadata.lines[0].text).toBe('<b>first</b>');expect(metadata.lines[3].locked).toBe(true);expect(metadata.language).toBe('auto');
  expect(post.options.body.get('audio').type).toBe('audio/wav');expect(f.state.applies).toBe(1);
  const check=i=>f.find(n=>n.attrs['data-sync-select']===String(i));
  expect(check(0).checked).toBe(true);expect(check(1).checked).toBe(false);expect(check(2).disabled).toBe(true);expect(check(3).disabled).toBe(true);
  const lyric=f.find(n=>n.className==='sync-lyric'&&n.textContent==='<b>first</b>');expect(lyric.children).toHaveLength(0);
  f.find(n=>n.attrs['data-sync-audition']==='0').click();expect(f.state.auditions).toEqual([[0.1,1.5]]);
  check(1).checked=true;f.state.busy=true;f.byId('syncApply').click();expect(f.state.applies).toBe(1);f.state.busy=false;f.byId('syncApply').click();expect(f.state.applies).toBe(2);expect(f.state.project.timing.lineEnds[0]).toBe(1.5);expect(f.state.project.timing.lineTimes[0]).toBe(0.1);expect(f.state.project.timing.lineTimes[1]).toBe(5.1);
});
test('polling is one second, shows stages and cancellation deletes the known job',async()=>{
  const f=fixture();await ready(f);f.byId('syncStart').click();f.requests.at(-1).resolve({id:'job-a',status:'running',stage:'transcribing',progress:0.4});await settle();
  expect(f.byId('syncStatus').textContent).toContain('40%');expect(f.byId('syncStatus').textContent).toContain('Transcribing');
  const poll=[...f.timers.values()].find(t=>t.ms===1000);expect(poll).toBeDefined();poll.fn();expect(f.requests.at(-1).url).toBe('/api/sync/jobs/job-a');
  f.byId('syncCancel').click();expect(f.requests.at(-1).options.method).toBe('DELETE');expect(f.byId('syncApply').hidden).toBe(true);
});
test('cancelling during upload cleans a late accepted job without displaying its result',async()=>{
  const f=fixture();await ready(f);f.byId('syncStart').click();const pending=f.requests.at(-1);f.byId('syncCancel').click();pending.resolve({id:'late',status:'completed',stage:'done',result});await settle();
  expect(f.requests.at(-1).url).toBe('/api/sync/jobs/late');expect(f.requests.at(-1).options.method).toBe('DELETE');expect(f.byId('syncReview').hidden).toBe(true);expect(f.state.applies).toBe(0);
});
test('edits, replacement audio and busy transitions invalidate pending and reviewed proposals',async()=>{
  const f=fixture();await ready(f);await complete(f);f.state.audio={...f.state.audio,buffer:{}};f.ui.refresh();expect(f.byId('syncReview').hidden).toBe(true);
  f.state.audio.buffer={duration:20,sampleRate:16000,length:320000,numberOfChannels:1,getChannelData:()=>new Float32Array(320000)};
  f.byId('syncStart').click();const post=f.requests.at(-1);f.state.project.version++;f.ui.refresh();post.resolve({id:'stale',status:'running',stage:'loading'});await settle();expect(f.requests.at(-1).options.method).toBe('DELETE');
  await complete(f);f.state.busy=true;f.ui.refresh();expect(f.byId('syncReview').hidden).toBe(true);
});
test('unavailable engine gives local setup instructions and malformed results cannot be applied',async()=>{
  const f=fixture();f.requests[0].resolve({available:false,engine:'whisperx',message:'private stack'});await settle();expect(f.byId('syncStatus').textContent).toContain('alignment');expect(f.byId('syncStart').disabled).toBe(true);expect(f.byId('syncStatus').textContent).not.toContain('private stack');
  const g=fixture();await ready(g);g.byId('syncStart').click();g.requests.at(-1).resolve({id:'bad',status:'completed',stage:'done',result:{...result,lines:result.lines.slice(1)}});await settle();expect(g.byId('syncApply').hidden).toBe(true);expect(g.byId('syncStatus').textContent).toContain('invalid');
});
test('low heuristic scores stay unchecked even if a server labels the row matched',async()=>{const f=fixture();await ready(f);f.byId('syncStart').click();f.requests.at(-1).resolve({id:'weak',status:'completed',stage:'done',result:{...result,lines:result.lines.map(r=>r.index===0?{...r,confidence:0.4}:r)}});await settle();expect(f.find(n=>n.attrs['data-sync-select']==='0').checked).toBe(false);expect(f.byId('syncApply').disabled).toBe(true);expect(f.state.applies).toBe(0);});
test('worker warnings are readable recovery guidance, including a safe fallback for unknown codes',async()=>{const f=fixture();await ready(f);f.byId('syncStart').click();f.requests.at(-1).resolve({id:'warn',status:'completed',stage:'done',result:{...result,warnings:['no_speech_detected','alignment_model_unavailable','some_segments_exceeded_alignment_bounds','no_aligned_words','unknown_private_code']}});await settle();const text=f.find(n=>n.className==='sync-help sync-warnings').textContent;expect(text).toContain('No speech');expect(text).toContain('model');expect(text).toContain('shorter');expect(text).not.toContain('no_aligned_words');expect(text).not.toContain('unknown_private_code');});
test('inline Undo appears after apply and restores the previous timing through the host',async()=>{const f=fixture();await ready(f);expect(f.byId('syncUndo')).toBeDefined();expect(f.byId('syncUndo').hidden).toBe(true);const before=JSON.stringify(f.state.project);await complete(f);expect(f.byId('syncUndo').hidden).toBe(false);f.state.busy=true;f.byId('syncUndo').click();expect(f.state.undos).toBe(0);f.state.busy=false;f.byId('syncUndo').click();expect(f.state.undos).toBe(1);expect(JSON.stringify(f.state.project)).toBe(before);expect(f.byId('syncUndo').hidden).toBe(true);});
test('inline Undo cannot roll back unrelated edits or replacement audio, even before refresh runs',async()=>{const f=fixture();await ready(f);await complete(f);f.byId('syncApply').click();f.state.project.version++;f.byId('syncUndo').click();expect(f.state.undos).toBe(0);expect(f.byId('syncUndo').hidden).toBe(true);const g=fixture();await ready(g);await complete(g);g.byId('syncApply').click();g.state.audio={...g.state.audio,buffer:{}};g.ui.refresh();expect(g.byId('syncUndo').hidden).toBe(true);g.byId('syncUndo').click();expect(g.state.undos).toBe(0);});

test('completion immediately updates confident unlocked lines and keeps uncertain lines for review',async()=>{
  const f=fixture();await ready(f);const before=JSON.stringify(f.state.project);await complete(f);
  expect(f.state.applies).toBe(1);
  expect(f.state.project.timing.lineTimes[0]).toBe(0.1);
  expect(f.state.project.timing.lineTimes[1]).toBe(5);
  expect(f.state.project.overrides[3].lock).toBe(true);
  expect(f.find(n=>n.attrs['data-sync-select']==='0').disabled).toBe(true);
  expect(f.find(n=>n.attrs['data-sync-select']==='1').disabled).toBe(false);
  expect(f.find(n=>n.attrs['data-sync-select']==='1').checked).toBe(false);
  expect(f.byId('syncStatus').textContent).toContain('automatically');
  f.byId('syncUndo').click();expect(JSON.stringify(f.state.project)).toBe(before);
});

test('automatic completion preserves project when confident rows conflict with unchanged anchors',async()=>{
  const f=fixture();await ready(f);const before=JSON.stringify(f.state.project);f.byId('syncStart').click();
  const conflicting={...result,lines:result.lines.map(r=>r.index===0?{...r,end:5.05}:r)};
  f.requests.at(-1).resolve({id:'conflict',status:'completed',stage:'done',result:conflicting});await settle();
  expect(f.state.applies).toBe(0);expect(JSON.stringify(f.state.project)).toBe(before);
  expect(f.byId('syncReview').hidden).toBe(false);expect(f.byId('syncStatus').textContent).toContain('conflict');
});


test('no detected voice is a failed match, not a proposal asking the user to listen and select',async()=>{
  const f=fixture();await ready(f);const before=JSON.stringify(f.state.project);f.byId('syncStart').click();
  f.requests.at(-1).resolve({id:'no-voice',status:'completed',result:{...result,warnings:['no_speech_detected'],lines:result.lines.map(r=>({...r,start:null,end:null,confidence:0,status:'unmatched'}))}});await settle();
  expect(f.state.applies).toBe(0);expect(JSON.stringify(f.state.project)).toBe(before);
  expect(f.byId('syncStatus').textContent).toContain('No lyric timing');
  expect(f.byId('syncStatus').textContent).not.toContain('Proposal ready');
  expect(f.byId('syncApply').hidden).toBe(true);
  expect(f.find(n=>n.attrs['data-sync-audition']!==undefined)).toBeUndefined();
  expect(f.find(n=>n.textContent.includes('Confident matches update automatically'))).toBeUndefined();
});


test('audio-only action sends no supplied lyrics and automatically replaces text and cuts without checkboxes',async()=>{
  const f=fixture(true);f.state.project.lyrics='';await ready(f);const before=JSON.stringify(f.state.project);
  expect(f.byId('syncStart').disabled).toBe(false);f.byId('syncStart').click();
  const post=f.requests.at(-1),metadata=JSON.parse(post.options.body.get('metadata'));
  expect(metadata).toEqual({mode:'transcribe',language:'auto',lines:[]});
  const recognized={duration:20,language:'vi',warnings:[],lines:[{index:0,text:'Words directly from the audio',start:2,end:4,confidence:.4,status:'review'}]};
  post.resolve({id:'direct-audio',status:'completed',result:recognized});await settle();
  expect(f.state.applies).toBe(1);expect(f.state.project.lyrics).toBe('Words directly from the audio');expect(f.state.project.timing.lineTimes[0]).toBe(2);
  expect(f.byId('syncApply').hidden).toBe(true);expect(f.find(n=>n.attrs['data-sync-select']!==undefined)).toBeUndefined();
  expect(f.byId('syncStatus').textContent).toContain('transcribed');
  f.byId('syncUndo').click();expect(JSON.stringify(f.state.project)).toBe(before);
});

test('empty audio transcription preserves the entered project and never presents a match selection',async()=>{
  const f=fixture(true);await ready(f);const before=JSON.stringify(f.state.project);f.byId('syncStart').click();
  f.requests.at(-1).resolve({id:'no-transcript',status:'completed',result:{duration:20,language:'und',warnings:['no_speech_detected'],lines:[]}});await settle();
  expect(f.state.applies).toBe(0);expect(JSON.stringify(f.state.project)).toBe(before);expect(f.byId('syncApply').hidden).toBe(true);
  expect(f.byId('syncStatus').textContent).toContain('transcribe');
});
