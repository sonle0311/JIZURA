import { expect, test } from 'bun:test';
import { validateRequest } from './validation';
import { runRestrictedSession } from './omp';

function request() {
  return {
    provider: 'fixture', model: 'local', direction: '',
    lines: [{ index: 0, text: 'We rise', start: 1, end: 3, locked: false }],
    catalog: Object.fromEntries(['style','layout','enter','hold','exit','decor','treat','bg','cam','trans'].map(g => [g, [{ id: 'plain', name: 'Plain' }]])),
    audioFeatures: { duration: 10, bpm: 120, lines: [{ index: 0, energy: 0.7, beatCount: 4 }] },
  };
}

test('audio features validate exact indices and measured scalar ranges', () => {
  expect(validateRequest(request()).audioFeatures).toEqual(request().audioFeatures);
  for (const mutate of [
    (r: any) => r.audioFeatures.lines[0].index = 999,
    (r: any) => r.audioFeatures.lines[0].energy = 9,
    (r: any) => r.audioFeatures.lines[0].beatCount = -1,
    (r: any) => r.audioFeatures.buffer = 'waveform',
    (r: any) => r.audioFeatures.lines.push(r.audioFeatures.lines[0]),
    (r: any) => r.audioFeatures.duration = Infinity,
  ]) {
    const r = request(); mutate(r); expect(() => validateRequest(r)).toThrow();
  }
});

test('restricted agent receives measured audio cues with lyrics in one prompt', async () => {
  let prompt = '';
  const result = { summary: 'Measured build', lines: [{ index: 0, reason: 'Energy rises', layout: 'plain' }] };
  const session = {
    messages: [{ role: 'assistant', content: [{ type: 'text', text: JSON.stringify(result) }] }],
    prompt: async (text: string) => { prompt = text; }, abort: async () => {}, dispose: async () => {},
  };
  await runRestrictedSession(async () => ({ session }), {}, request(), new AbortController().signal);
  expect(JSON.parse(prompt).audioFeatures).toEqual(request().audioFeatures);
});
