/* AI arrangement contract. The renderer only receives validated, existing techniques. */
(() => {
'use strict';
const GROUPS = ['layout', 'enter', 'hold', 'exit', 'decor', 'treat', 'bg', 'cam', 'trans'];
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clone = o => JSON.parse(JSON.stringify(o));
const object = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const fail = message => { throw new Error(message); };
const text = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const ai = J.ai = {};
ai.fingerprint = project => JSON.stringify(project);

function catalogue(project) {
  const locked = Object.values(project.overrides || {}).some(o => o && o.lock);
  const entry = (id, d) => ({ id, name: String(d.name || id).slice(0, 160), tags: (d.tags || []).filter(t => typeof t === 'string').slice(0, 8) });
  const styleIds = locked ? [project.style] : J.STYLE_ORDER.filter(id => !J.randomOk || J.randomOk(project, 'style', id));
  const out = { style: styleIds.filter(id => J.STYLES[id]).slice(0, 36).map(id => entry(id, J.STYLES[id])) };
  for (const g of GROUPS) {
    const registry = J.registry(g);
    const ids = J.order(g).filter(id => registry[id] && !registry[id].special
      && (!J.randomOk || J.randomOk(project, g, id)) && project.enabled?.[g]?.[id] !== false);
    // Spread the bounded catalogue across the library rather than only its oldest entries.
    const chosen = ids.length <= 36 ? ids : Array.from({ length: 36 }, (_, i) => ids[Math.floor(i * ids.length / 36)]);
    out[g] = chosen.map(id => entry(id, registry[id]));
  }
  if (!out.layout.length) fail('Enable at least one layout before generating an AI plan.');
  return out;
}

ai.createRequest = (project, plan, direction, model, audio) => {
  if (!text(model?.provider, 200) || !text(model?.id, 300)) fail('Choose an available AI model.');
  if (typeof direction !== 'string' || direction.length > 2000) fail('Direction must be at most 2000 characters.');
  if (typeof project.lyrics !== 'string' || project.lyrics.length > 30000) fail('Use at most 30000 lyric characters.');
  const lines = (plan?.lines || []).filter(l => !l.interlude && l.text?.trim()).map(l => ({
    index: l.index, text: l.text, start: l.start, end: l.end,
    locked: !!project.overrides?.[l.index]?.lock,
  }));
  if (!lines.length) fail('Enter lyrics before generating an AI plan.');
  if (lines.length > 200) fail('Use at most 200 lyric lines per AI plan.');
  if (lines.every(l => l.locked)) fail('Unlock at least one lyric line.');
  if (lines.some(l => !Number.isInteger(l.index) || !Number.isFinite(l.start) || !Number.isFinite(l.end) || l.end <= l.start)) fail('Lyric timing is invalid.');
  const request = { provider: model.provider, model: model.id, direction: direction.trim(), lines, catalog: catalogue(project) };
  if (audio && Number.isFinite(audio.duration) && audio.duration > 0 && audio.duration <= 86400) {
    const rate = Number.isFinite(audio.energyRate) && audio.energyRate > 0 ? audio.energyRate : 0;
    request.audioFeatures = {
      duration: audio.duration,
      bpm: Number.isFinite(audio.bpm) && audio.bpm > 0 && audio.bpm <= 400 ? audio.bpm : null,
      lines: lines.map(line => {
        let sum = 0, count = 0;
        const energy = audio.energy || [];
        const from = Math.max(0, Math.floor(line.start * rate));
        const to = Math.min(energy.length, Math.ceil(Math.min(line.end, audio.duration) * rate));
        if (rate) for (let i = from; i < to; i++) if (Number.isFinite(energy[i])) { sum += Math.max(0, Math.min(1, energy[i])); count++; }
        const beatCount = Array.from(audio.beats || []).filter(t => Number.isFinite(t) && t >= line.start && t < line.end && t <= audio.duration).length;
        return { index: line.index, energy: count ? +(sum / count).toFixed(4) : null, beatCount };
      }),
    };
  }
  return request;
};

ai.validatePlan = (result, request) => {
  if (!object(result) || !text(result.summary, 2000) || !Array.isArray(result.lines)) fail('AI returned an invalid plan. Generate again.');
  const targets = new Set(request.lines.filter(l => !l.locked).map(l => l.index));
  if (result.lines.length !== targets.size) fail('AI plan does not cover every unlocked lyric line.');
  const validId = (g, id) => typeof id === 'string' && request.catalog[g]?.some(d => d.id === id);
  const clean = { summary: result.summary.trim(), lines: [] };
  if (own(result, 'style')) {
    if (!validId('style', result.style)) fail('AI selected an unavailable style.');
    clean.style = result.style;
  }
  for (const row of result.lines) {
    if (!object(row) || !Number.isInteger(row.index) || !targets.delete(row.index) || !text(row.reason, 1000)) fail('AI returned a duplicate, locked or invalid lyric line.');
    const item = { index: row.index, reason: row.reason.trim() };
    for (const g of GROUPS) if (own(row, g)) {
      if (g === 'decor') {
        if (!Array.isArray(row.decor) || row.decor.length > 3 || new Set(row.decor).size !== row.decor.length || row.decor.some(id => !validId(g, id))) fail('AI selected unavailable decorations.');
        item.decor = row.decor.slice();
      } else {
        if (!validId(g, row[g])) fail('AI selected an unavailable technique: ' + g);
        item[g] = row[g];
      }
    }
    if (!GROUPS.some(g => own(item, g))) fail('AI did not choose any techniques for a lyric line.');
    clean.lines.push(item);
  }
  clean.lines.sort((a, b) => a.index - b.index);
  return clean;
};

ai.applyPlan = (project, result, request, fingerprint) => {
  if (fingerprint !== ai.fingerprint(project)) fail('The project changed. Generate a new AI plan.');
  // Recheck the catalogue and lyrics against the project, even for non-UI consumers.
  const freshCatalog = catalogue(project);
  const parsed = J.parseLyrics(project.lyrics).lines;
  for (const line of request.lines) {
    const current = parsed[line.index];
    if (!current || current.interlude || current.text !== line.text || !!project.overrides?.[line.index]?.lock !== line.locked) fail('The lyrics changed. Generate a new AI plan.');
  }
  const safeRequest = { ...request, catalog: freshCatalog };
  const clean = ai.validatePlan(result, safeRequest);
  const out = clone(project);
  out.overrides = out.overrides || {};
  if (clean.style) out.style = clean.style;
  for (const line of clean.lines) {
    const previous = out.overrides[line.index] || {};
    if (previous.lock) fail('A lyric line is now locked. Generate a new AI plan.');
    // Per-cut visual overrides outrank line choices. Timing and cut counts are retained.
    delete previous.cutTech; delete previous.cutLayouts; delete previous.cutQuiet;
    for (const g of GROUPS) if (own(line, g)) previous[g] = clone(line[g]);
    out.overrides[line.index] = previous;
  }
  return out;
};
})();
