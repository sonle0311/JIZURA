import { test, expect } from 'bun:test';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '..');
const ctx = vm.createContext({ window: {}, console, Intl, document: { createElement: () => ({ getContext: () => ({ measureText: t => ({ width: t.length * 30 }) }) }) } });
for (const f of fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js') && !f.startsWith('12')).sort()) {
  vm.runInContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), ctx, { filename: f });
}
const J = ctx.window.J;
const plain = x => JSON.parse(JSON.stringify(x));
const project = () => Object.assign(J.defaultProject(), {
  lyrics: 'I remember the dawn\n[interlude 2]\nWe will rise again!',
  timing: { bpm: 120, snap: false, lineTimes: { 0: 0.4, 2: 6 }, lineScale: 1 },
  overrides: { 0: { cuts: 2, cutTime: { 1: 1 }, cutTech: { 0: { layout: 'center' } } } },
  aspect: '9:16', audioName: 'private-song.wav',
});
function request(p = project()) {
  return J.ai.createRequest(p, J.plan(p), 'Make the final line hopeful', { provider: 'test', id: 'fixture' });
}
function response(req) {
  return { summary: 'Build from memory to hope', lines: req.lines.filter(l => !l.locked).map(l => ({ index: l.index, reason: 'Emphasize the emotion', layout: req.catalog.layout[0].id, enter: req.catalog.enter[0].id, decor: [] })) };
}

test('request contains actual lyric indexes/times, no audio/settings, and skips interludes', () => {
  const p = project(), r = request(p);
  expect(r.lines.map(l => l.index)).toEqual([0, 2]);
  expect(r.lines[0].text).toBe('I remember the dawn');
  expect(r.lines[0].start).toBeCloseTo(0.4);
  expect(JSON.stringify(r)).not.toContain('private-song');
  expect(Object.keys(r).sort()).toEqual(['catalog', 'direction', 'lines', 'model', 'provider']);
});

test('catalogue respects disabled techniques, set switches and bounded choices', () => {
  const p = project(); p.enabled.layout = { center: false };
  const r = request(p);
  expect(r.catalog.layout.some(x => x.id === 'center')).toBe(false);
  for (const [g, items] of Object.entries(r.catalog)) {
    expect(items.length).toBeLessThanOrEqual(36);
    if (g !== 'style') for (const item of items) expect(J.randomOk(p, g, item.id)).toBe(true);
  }
});

test('apply changes appearance atomically and preserves lyrics/timing/output/cuts', () => {
  const p = project(), original = plain(p), r = request(p), a = response(r);
  a.lyrics = 'malicious'; a.lines[0].cutTime = { 1: 999 }; a.lines[0].__proto__ = { polluted: true };
  const out = J.ai.applyPlan(p, a, r, J.ai.fingerprint(p));
  expect(plain(p)).toEqual(original);
  for (const k of ['lyrics', 'timing', 'aspect', 'audioName', 'locks', 'fps', 'resolution']) expect(plain(out[k] ?? null)).toEqual(plain(p[k] ?? null));
  expect(plain(out.overrides[0].cutTime)).toEqual({ 1: 1 });
  expect(out.overrides[0].cuts).toBe(2);
  expect(out.overrides[0].layout).toBe(a.lines[0].layout);
  expect(out.overrides[0].cutTech).toBeUndefined();
  expect(out.overrides[0].polluted).toBeUndefined();
  const planned = J.plan(out);
  expect(planned.cuts.find(c => c.line === 0).layout).toBe(a.lines[0].layout);
});

test('locked lines and their global style remain unchanged', () => {
  const p = project(); p.overrides[2] = { lock: true, layout: 'center', lockedCuts: J.lineSnapshot(J.plan(p), 2) };
  const r = request(p), a = response(r);
  expect(r.lines.find(l => l.index === 2).locked).toBe(true);
  expect(r.catalog.style.map(s => s.id)).toEqual([p.style]);
  const out = J.ai.applyPlan(p, a, r, J.ai.fingerprint(p));
  expect(plain(out.overrides[2])).toEqual(plain(p.overrides[2]));
  expect(out.style).toBe(p.style);
  a.style = J.STYLE_ORDER.find(s => s !== p.style);
  expect(() => J.ai.applyPlan(p, a, r, J.ai.fingerprint(p))).toThrow();
});

test('malformed, duplicate, missing and unknown technique plans are rejected', () => {
  const r = request();
  for (const a of [null, { summary: 'x', lines: [] }, { ...response(r), lines: [response(r).lines[0], response(r).lines[0]] }, { summary: 'x', lines: response(r).lines.map(l => ({ ...l, layout: 'invented-code' })) }, { summary: 'x', lines: response(r).lines.map(l => ({ ...l, decor: ['bad'] })) }]) {
    expect(() => J.ai.validatePlan(a, r)).toThrow();
  }
});

test('pending plan rejects any changed project or mismatching lyric indexes', () => {
  const p = project(), r = request(p), fingerprint = J.ai.fingerprint(p), a = response(r);
  p.timing.bpm = 130;
  expect(() => J.ai.applyPlan(p, a, r, fingerprint)).toThrow(/changed|stale/i);
  const p2 = project(); r.lines[0].text = 'different lyric';
  expect(() => J.ai.applyPlan(p2, a, r, J.ai.fingerprint(p2))).toThrow();
});

test('empty/all locked/oversized lyrics cannot generate', () => {
  for (const text of ['', '# comment\n[interlude 8]', 'x'.repeat(30001)]) {
    const p = project(); p.lyrics = text;
    expect(() => request(p)).toThrow();
  }
  const p = project(); p.overrides = { 0: { lock: true }, 2: { lock: true } };
  expect(() => request(p)).toThrow();
});

test('AI request summarizes measured audio per line without waveform or file data', () => {
  const p = project(), plan = J.plan(p);
  const audio = { duration: 20, bpm: 123.4, energyRate: 1, energy: new Float32Array(20).fill(0.5), beats: [0.5, 1, 2, 7, 9], buffer: 'PRIVATE_WAVEFORM', name: 'private-audio.wav' };
  const r = J.ai.createRequest(p, plan, '', { provider: 'test', id: 'fixture' }, audio);
  expect(r.audioFeatures.bpm).toBe(123.4);
  expect(r.audioFeatures.duration).toBe(20);
  expect(r.audioFeatures.lines[0].index).toBe(0);
  expect(r.audioFeatures.lines[0].energy).toBeCloseTo(0.5);
  expect(r.audioFeatures.lines[0].beatCount).toBe(3);
  expect(JSON.stringify(r)).not.toContain('PRIVATE_WAVEFORM');
  expect(JSON.stringify(r)).not.toContain('private-audio.wav');
  expect(request(p).audioFeatures).toBeUndefined();
});
