/* Local lyric alignment: request/result checks and nonmutating timing application. */
(() => {
'use strict';
const fail = code => { throw new Error(code); };
const finite = n => typeof n === 'number' && Number.isFinite(n);
const fingerprint = p => JSON.stringify(p);
const current = (p,a,s) => !!s && a?.buffer === s.buffer && fingerprint(p) === s.fingerprint;
const snapshot = (p,plan,a,language='auto',mode='align') => {
  if (!a?.buffer || !finite(a.duration) || a.duration <= 0 || a.duration > 600) fail('audio');
  if(!/^(auto|[a-z]{2,3})$/.test(language)) fail('language');
  if(mode==='transcribe') return {fingerprint:fingerprint(p),buffer:a.buffer,duration:a.duration,language,mode,lines:[],anchors:[]};
  const lines = plan.lines.filter(l=>!l.interlude).map(l=>({index:l.index,text:l.text,locked:!!p.overrides?.[l.index]?.lock}));
  if(!lines.length || lines.length>200 || lines.reduce((n,l)=>n+l.text.length,0)>30000) fail('lyrics');
  const seen = new Set();
  for (const l of lines) {
    if (!Number.isInteger(l.index) || l.index < 0 || seen.has(l.index) || typeof l.text !== 'string' || !l.text.trim()) fail('lyrics');
    seen.add(l.index);
  }
  if(!/^(auto|[a-z]{2,3})$/.test(language)) fail('language');
  return {fingerprint:fingerprint(p),buffer:a.buffer,duration:a.duration,language,lines,anchors:plan.lines.map(l=>({index:l.index,start:l.start,end:l.visEnd}))};
};
const validateResult = (r,s) => {
  if(s.mode==='transcribe') {
    if(!r || !finite(r.duration) || Math.abs(r.duration-s.duration)>.1 || typeof r.language!=='string' || !/^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(r.language) || !Array.isArray(r.lines) || r.lines.length>200 || !Array.isArray(r.warnings) || r.warnings.length>100 || r.warnings.some(w=>typeof w!=='string'||w.length>300||/[\x00-\x1f]/.test(w)))fail('invalid');
    let end=0,previous=-Infinity,chars=0;
    r.lines.forEach((l,i)=>{
      if(!l || l.index!==i || typeof l.text!=='string'||!l.text.trim()||/[\x00-\x1f]/.test(l.text)||!finite(l.confidence)||l.confidence<0||l.confidence>1||!['matched','review'].includes(l.status)||!finite(l.start)||!finite(l.end)||l.start<end||l.start-previous<.05-1e-8||l.end<=l.start||l.end>r.duration)fail('invalid');
      chars+=l.text.length;previous=l.start;end=l.end;
    });
    if(chars>30000)fail('invalid');return r;
  }
  if(!r || !finite(r.duration) || Math.abs(r.duration-s.duration)>0.1 || !Array.isArray(r.lines) || r.lines.length!==s.lines.length || typeof r.language!=='string' || r.language.length>32 || !Array.isArray(r.warnings) || r.warnings.length>100 || r.warnings.some(w=>typeof w!=='string'||w.length>500)) fail('invalid');
  const seen=new Set(); let previous=-Infinity;
  for(const l of r.lines){const source=s.lines.find(x=>x.index===l?.index);
    if(!source || seen.has(l.index) || l.text!==source.text || !finite(l.confidence) || l.confidence<0 || l.confidence>1 || !['matched','review','unmatched'].includes(l.status)) fail('invalid');
    seen.add(l.index);
    if(l.status==='unmatched'){if(l.start!==null || l.end!==null) fail('invalid');}
    else if(!finite(l.start)||!finite(l.end)||l.start<0||l.end<=l.start||l.end>r.duration) fail('invalid');
  }
  for(const source of s.lines){const l=r.lines.find(x=>x.index===source.index);if(l.start!==null){if(l.start<previous)fail('invalid');previous=l.end;}}
  return r;
};
const apply = (p,r,selected,s,a) => {
  if(!current(p,a,s)) fail('stale');validateResult(r,s);
  const chosen=new Set(selected);if(!chosen.size || chosen.size!==selected.length)fail('selection');
  for(const i of chosen){const source=s.lines.find(l=>l.index===i),row=r.lines.find(l=>l.index===i);if(!source || source.locked || row.status==='unmatched')fail('selection');}
  const anchors=s.anchors.map(l=>{const row=chosen.has(l.index)?r.lines.find(x=>x.index===l.index):null;return row?{index:l.index,start:row.start,end:row.end}:l;});
  for(let i=0;i<anchors.length;i++){const l=anchors[i],next=anchors[i+1];if(next && (next.start-l.start<0.05-1e-8 || l.end>next.start+1e-8))fail('conflict');}
  const out=JSON.parse(JSON.stringify(p));out.timing=out.timing||{};out.timing.lineTimes={...(out.timing.lineTimes||{})};out.timing.lineEnds={...(out.timing.lineEnds||{})};
  anchors.forEach(l=>{out.timing.lineTimes[l.index]=l.start;out.timing.lineEnds[l.index]=l.end;});return out;
};
const applyTranscript = (p,r,s,a) => {
  if(!current(p,a,s))fail('stale');
  if(s.mode!=='transcribe')fail('invalid');validateResult(r,s);
  if(!r.lines.length)fail('empty');
  const out=JSON.parse(JSON.stringify(p));
  out.lyrics=r.lines.map(l=>/^[#\[\\]|[|/*]|!$/.test(l.text)?'\\'+l.text:l.text).join('\n');
  out.timing=out.timing||{};out.timing.lineTimes={};out.timing.lineEnds={};out.overrides={};out.exportRange=null;
  r.lines.forEach(l=>{out.timing.lineTimes[l.index]=l.start;out.timing.lineEnds[l.index]=l.end;});return out;
};
const wav = b => {
  if(!b || !finite(b.duration)||b.duration<=0||b.duration>600||!finite(b.sampleRate)||b.sampleRate<1||!Number.isInteger(b.length)||b.length<=0||!Number.isInteger(b.numberOfChannels)||b.numberOfChannels<1||b.numberOfChannels>32)fail('audio');
  const rate=16000,n=Math.ceil(b.length*rate/b.sampleRate),size=44+n*2;if(size>24*1024*1024)fail('audio');
  const bytes=new ArrayBuffer(size),v=new DataView(bytes),str=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};
  str(0,'RIFF');v.setUint32(4,size-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,n*2,true);
  const channels=Array.from({length:b.numberOfChannels},(_,i)=>b.getChannelData(i));
  // Average each resampling bin: anti-alias high-frequency content before downsampling.
  for(let i=0;i<n;i++){let value=0,count=0;const from=Math.floor(i*b.sampleRate/rate),to=Math.max(from+1,Math.floor((i+1)*b.sampleRate/rate));for(let k=from;k<Math.min(to,b.length);k++){for(const ch of channels)value+=Number.isFinite(ch[k])?ch[k]:0;count+=channels.length;}value=Math.max(-1,Math.min(1,count?value/count:0));v.setInt16(44+i*2,value<0?value*32768:value*32767,true);}
  return new Blob([bytes],{type:'audio/wav'});
};
J.sync={snapshot,current,fingerprint,validateResult,apply,applyTranscript,wav};
})();
