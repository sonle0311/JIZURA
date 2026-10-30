import {test, expect} from 'bun:test';
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path';
const ctx=vm.createContext({window:{},console,Intl,Blob,document:{createElement:()=>({getContext:()=>({measureText:t=>({width:t.length*30})})})}});
for(const f of fs.readdirSync('src').filter(f=>f.endsWith('.js')&&!f.startsWith('12')).sort()) vm.runInContext(fs.readFileSync(path.join('src',f),'utf8'),ctx,{filename:f});
const J=ctx.window.J; const plain=x=>JSON.parse(JSON.stringify(x));
const fixture=()=>{const p=J.defaultProject();p.lyrics='first\nsecond\nlast';p.timing.snap=false;p.timing.lineTimes={0:0,1:4,2:8};const audio={duration:20,buffer:{}};return {p,audio,plan:J.plan(p,audio)};};
const result=s=>({duration:20,language:'en',warnings:[],lines:s.lines.map(l=>({index:l.index,text:l.text,start:l.index*4+0.2,end:l.index*4+2,confidence:0.9,status:'matched'}))});
test('optional sung ends hold full final line, clamp before next, ignore invalid old ends',()=>{const {p,audio}=fixture(); const old=plain(J.plan(p,audio));p.timing.lineEnds={0:3,1:99,2:19};const plan=J.plan(p,audio);expect(plan.lines.map(l=>l.visEnd)).toEqual([3,8,19]);expect(plan.lines[2].end).toBe(19);p.timing.lineEnds={0:-1,1:'bad',2:null};expect(plain(J.plan(p,audio))).toEqual(old);});
test('review validates every original index and exact text; rejects invented evidence',()=>{const {p,plan,audio}=fixture();expect(J.sync).toBeDefined(); const s=J.sync.snapshot(p,plan,audio);const r=result(s);expect(J.sync.validateResult(r,s).lines).toHaveLength(3);r.lines[1].index=0;expect(()=>J.sync.validateResult(r,s)).toThrow();r.lines[1].index=1;r.lines[0].start=NaN;expect(()=>J.sync.validateResult(r,s)).toThrow();});
test('apply is atomic, preserves unselected/locked implicit anchors and all visual settings',()=>{const {p,plan,audio}=fixture();delete p.timing.lineTimes[1];p.overrides[1]={lock:true,layout:'center'};const current=J.plan(p,audio),s=J.sync.snapshot(p,current,audio),r=result(s),before=plain(p);r.lines[0].start=0.1;r.lines[0].end=1;const out=J.sync.apply(p,r,[0],s,audio);expect(plain(p)).toEqual(before);expect(plain(out.overrides)).toEqual(before.overrides);expect(out.timing.lineTimes[1]).toBe(current.lines[1].start);expect(out.timing.lineEnds[1]).toBe(current.lines[1].visEnd);expect(out.timing.lineTimes[2]).toBe(current.lines[2].start);expect(out.timing.lineEnds[0]).toBe(1);expect(()=>J.sync.apply(p,r,[1],s,audio)).toThrow();r.lines[0].end=10;expect(()=>J.sync.apply(p,r,[0],s,audio)).toThrow();});
test('rejects changed project and same-name replacement audio',()=>{const {p,plan,audio}=fixture(),s=J.sync.snapshot(p,plan,audio),r=result(s);expect(()=>J.sync.apply(p,r,[0],s,{...audio,buffer:{}})).toThrow();p.title='changed';expect(()=>J.sync.apply(p,r,[0],s,audio)).toThrow();});
test('mono 16k WAV averages channels and bounds input',async()=>{expect(J.sync).toBeDefined();const buffer={sampleRate:16000,length:4,duration:4/16000,numberOfChannels:2,getChannelData:i=>Float32Array.from(i?[0,-1,0,1]:[1,0,-1,0])};const bytes=new DataView(await J.sync.wav(buffer).arrayBuffer());expect(bytes.getUint32(24,true)).toBe(16000);expect(bytes.getUint16(22,true)).toBe(1);expect(bytes.getInt16(44,true)).toBe(16383);expect(()=>J.sync.wav({...buffer,duration:601})).toThrow();});
test('aligned ends and starts remain exact in typeset mode while frozen rows keep their old rendered anchors',()=>{const {p,audio}=fixture();p.typeset=true;const plan=J.plan(p,audio),s=J.sync.snapshot(p,plan,audio),r=result(s);r.lines[0].start=0.1;r.lines[0].end=2;const out=J.sync.apply(p,r,[0],s,audio),next=J.plan(out,audio);expect(next.lines[0].start).toBe(0.1);expect(next.lines[0].visEnd).toBe(2);expect(next.lines[1].start).toBe(plan.lines[1].start);expect(next.lines[1].visEnd).toBe(plan.lines[1].visEnd);});
test('result rejects overlapping evidence and malformed warning values',()=>{const {p,plan,audio}=fixture(),s=J.sync.snapshot(p,plan,audio),r=result(s);r.lines[0].end=5;expect(()=>J.sync.validateResult(r,s)).toThrow();r.lines[0].end=2;r.warnings=[{stack:'private'}];expect(()=>J.sync.validateResult(r,s)).toThrow();});
test('request rejects empty lyric text and duplicate indices even when the plan is malformed',()=>{const {p,plan,audio}=fixture();plan.lines[1].index=0;expect(()=>J.sync.snapshot(p,plan,audio)).toThrow();plan.lines[1].index=1;plan.lines[0].text=' ';expect(()=>J.sync.snapshot(p,plan,audio)).toThrow();});
test('old end-map values outside the decoded audio duration are ignored',()=>{const {p,audio}=fixture(),before=plain(J.plan(p,audio));p.timing.lineEnds={2:99999};expect(plain(J.plan(p,audio))).toEqual(before);});
test('partial explicit end maps clamp before a typeset neighbour read-ahead start',()=>{const {p,audio}=fixture();p.typeset=true;p.timing.lineEnds={0:4};const plan=J.plan(p,audio);expect(plan.lines[0].visEnd).toBe(plan.lines[1].start);});


test('direct transcription ignores supplied text and applies recognized lyrics, times and fresh line settings atomically',()=>{
  const {p,audio}=fixture();p.lyrics='';p.overrides={0:{lock:true}};p.exportRange={from:0,to:0};
  const s=J.sync.snapshot(p,{lines:[]},audio,'auto','transcribe');
  const r={duration:20,language:'vi',warnings:[],lines:[{index:0,text:'Lời lấy từ audio',start:2,end:4,confidence:.4,status:'review'}]};
  expect(s.lines).toHaveLength(0);expect(s.mode).toBe('transcribe');
  const before=JSON.stringify(p),next=J.sync.applyTranscript(p,r,s,audio);
  expect(next.lyrics).toBe('Lời lấy từ audio');expect(next.timing.lineTimes[0]).toBe(2);expect(next.timing.lineEnds[0]).toBe(4);
  expect(plain(next.overrides)).toEqual({});expect(next.exportRange).toBe(null);expect(next.style).toBe(p.style);expect(JSON.stringify(p)).toBe(before);
  p.title='changed';expect(()=>J.sync.applyTranscript(p,r,s,audio)).toThrow('stale');
});

test('direct transcription validates generated indexes, text and acoustic timing without a lyric sheet',()=>{
  const {p,audio}=fixture(),s=J.sync.snapshot(p,{lines:[]},audio,'auto','transcribe');
  const row={index:0,text:'Different words from the song',start:1,end:2,confidence:.6,status:'review'};
  const r={duration:20,language:'en',warnings:[],lines:[row]};expect(J.sync.validateResult(r,s)).toBe(r);
  for(const bad of [{...row,index:1},{...row,text:'a\nb'},{...row,start:null},{...row,status:'unmatched'},{...row,end:21}])expect(()=>J.sync.validateResult({...r,lines:[bad]},s)).toThrow();
  expect(()=>J.sync.applyTranscript(p,{...r,lines:[]},s,audio)).toThrow();
});


test('recognized lyric punctuation remains literal and cannot shift generated time indices',()=>{
 const {p,audio}=fixture(),s=J.sync.snapshot(p,{lines:[]},audio,'auto','transcribe');
 const texts=['#1','[00:00]literal [interlude]','a/b|c *word*!','actual lyric'];
 const r={duration:20,language:'en',warnings:[],lines:texts.map((text,index)=>({index,text,start:index*4+1,end:index*4+2,confidence:.5,status:'review'}))};
 const next=J.sync.applyTranscript(p,r,s,audio),parsed=J.parseLyrics(next.lyrics),plan=J.plan(next,audio);
 expect(parsed.lines.map(l=>l.text)).toEqual(texts);expect(plan.lines.map(l=>l.start)).toEqual([1,5,9,13]);
});
