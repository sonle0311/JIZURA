import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync('src/12_ui.js','utf8');
function fixture() {
  const S={project:{lyrics:'one\ntwo',timing:{lineTimes:{0:1},lineEnds:{0:2}},overrides:{0:{lock:true}},exportRange:{from:0,to:0}}};
  const lyrics={value:'',focus(){}},ctx=vm.createContext({S,$:id=>id==='lyrics'?lyrics:{},J:{parseLyrics:()=>({lines:[]}),parseOrderV1:()=>[1,0]},replan(){},flushSave(){},toast(){},pause(){},seek(){}});
  vm.runInContext(source.slice(source.indexOf('const ED ='),source.indexOf('\nfunction updateEditBtns()'))+'\nfunction updateEditBtns(){}; globalThis.api={pushEdit,edGo,loadLrc,clearLyrics,applyAudioTranscript};',ctx);
  vm.runInContext(source.slice(source.indexOf('function migrateOrder('),source.indexOf('const SET_UI')),ctx);
  return {S,api:ctx.api,migrate:ctx.migrateOrder};
}
test('timing Undo and Redo restore sung ends as well as starts without rolling back appearance',()=>{const f=fixture();f.api.pushEdit();f.S.project.timing.lineTimes={0:3};f.S.project.timing.lineEnds={0:4};f.S.project.style='new-look';f.api.edGo(-1);expect(f.S.project.timing.lineTimes[0]).toBe(1);expect(f.S.project.timing.lineEnds[0]).toBe(2);expect(f.S.project.style).toBe('new-look');f.api.edGo(1);expect(f.S.project.timing.lineEnds[0]).toBe(4);});
test('LRC import and clear remove sung ends; Undo restores end maps and tied per-line settings',()=>{const f=fixture();f.api.loadLrc('[00:01]replacement');expect(Object.keys(f.S.project.timing.lineEnds)).toHaveLength(0);f.api.edGo(-1);expect(f.S.project.timing.lineEnds[0]).toBe(2);expect(f.S.project.overrides[0].lock).toBe(true);f.api.clearLyrics();expect(Object.keys(f.S.project.timing.lineEnds)).toHaveLength(0);f.api.edGo(-1);expect(f.S.project.timing.lineEnds[0]).toBe(2);});
test('old lyric-order migration moves end-map indices alongside starts',()=>{const f=fixture();f.migrate(f.S.project,{timingOrder:1});expect(f.S.project.timing.lineTimes[1]).toBe(1);expect(f.S.project.timing.lineEnds[1]).toBe(2);expect(f.S.project.timing.lineEnds[0]).toBeUndefined();});


test('audio transcript replacement restores the previous lyrics and line-specific settings on Undo and Redo',()=>{
 const f=fixture(),before=JSON.parse(JSON.stringify(f.S.project));
 const next={...before,lyrics:'Recognized from audio',timing:{...before.timing,lineTimes:{0:5},lineEnds:{0:7}},overrides:{},exportRange:null};
 f.api.applyAudioTranscript(next);expect(f.S.project.lyrics).toBe('Recognized from audio');expect(f.S.project.overrides).toEqual({});
 f.api.edGo(-1);expect(f.S.project.lyrics).toBe(before.lyrics);expect(f.S.project.overrides).toEqual(before.overrides);expect(f.S.project.exportRange).toEqual(before.exportRange);expect(f.S.project.timing.lineEnds).toEqual(before.timing.lineEnds);
 f.api.edGo(1);expect(f.S.project.lyrics).toBe('Recognized from audio');expect(f.S.project.overrides).toEqual({});expect(f.S.project.timing.lineTimes[0]).toBe(5);
});
