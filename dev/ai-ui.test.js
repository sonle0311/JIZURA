import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// A small DOM fixture tests async lifecycle and text-only rendering without a browser.
function fixture(saved) {
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.value = ''; this.hidden = false; this.textContent = ''; this.className = ''; this.classList = { toggle() {} }; }
    append(...nodes) { this.children.push(...nodes); for (const n of nodes) n.parent = this; }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.close?.(); }
    focus() { this.focused = true; }
    after(node) { this.sibling = node; }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(k, cb) { this.listeners[k] = cb; }
    click() { return this.listeners.click?.(); }
  }
  const anchor = new Element('div'), body = new Element('body'), acts = new Element('div'), storage = new Map(saved ? [['jizura.ai.settings.v1', JSON.stringify(saved)]] : []), requests = [], intervals = [], timers = new Map(), delays = new Map(); let timerId = 0;
  const state = { project: { version: 1 }, busy: false, applies: 0 };
  const find = (predicate, root = { children: [anchor.sibling, ...body.children, acts].filter(Boolean) }) => root && (predicate(root) ? root : root.children.map(n => find(predicate, n)).find(Boolean));
  const document = { documentElement: { lang: 'en' }, body, querySelector: selector => selector === '.bar .acts' ? acts : anchor, createElement: tag => new Element(tag), getElementById: id => find(n => n.id === id) };
  const J = { ai: {
    fingerprint: p => String(p.version),
    createRequest: () => ({ provider: 'test', model: 'fixture', lines: [{ index: 0, text: '<script>lyrics</script>', start: 0, end: 2, locked: false }], catalog: { layout: [{ id: 'center', name: 'Centered' }] } }),
    validatePlan: p => p,
  } };
  vm.runInNewContext(readFileSync(new URL('../src/12_ai_ui.js', import.meta.url), 'utf8'), {
    J, document, localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v) }, window: { addEventListener() {} }, AbortController,
    setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval() {},
    setTimeout: (fn, delay) => { delays.set(++timerId, delay); timers.set(timerId, fn); return timerId; }, clearTimeout: id => { timers.delete(id); delays.delete(id); },
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve: (body, ok = true) => resolve({ ok, text: async () => JSON.stringify(body) }), reject })),
  });
  const ui = J.initAIUI({ getProject: () => state.project, getPlan: () => ({}), isBusy: () => state.busy,
    applyAI: () => { state.applies++; state.project.version++; }, previous() {} });
  return { J, state, ui, find, requests, timers, delays, intervals, body, acts, storage, button: text => find(n => n.tagName === 'button' && n.textContent === text) };
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const plan = { summary: '<img src=x onerror=alert(1)>', lines: [{ index: 0, reason: '<b>Reason</b>', layout: 'center' }] };
async function ready(f) { f.requests[0].resolve({ models: [{ provider: 'test', id: 'fixture', name: 'Fixture' }] }); await settle(); }

test('AI preview is text, waits for explicit apply, and guards busy apply', async () => {
  const f = fixture(); await ready(f); f.button('Generate proposal').click(); f.requests[1].resolve(plan); await settle();
  expect(f.state.applies).toBe(0);
  expect(f.find(n => n.className === 'ai-summary').textContent).toBe(plan.summary);
  expect(f.find(n => n.className === 'ai-summary').children).toHaveLength(0);
  f.state.busy = true; f.button('Apply proposal').click(); expect(f.state.applies).toBe(0);
  f.state.busy = false; f.button('Apply proposal').click(); expect(f.state.applies).toBe(1);
  expect(f.button('Previous arrangement').hidden).toBe(false);
});

test('canceled response cannot overwrite the next request', async () => {
  const f = fixture(); await ready(f); f.button('Generate proposal').click(); const old = f.requests[1];
  f.button('Cancel').click(); expect(old.options.signal.aborted).toBe(true);
  f.button('Generate proposal').click(); old.resolve(plan); await settle();
  expect(f.find(n => n.className === 'ai-preview').hidden).toBe(true);
  f.requests[2].resolve({ ...plan, summary: 'Current' }); await settle();
  expect(f.find(n => n.className === 'ai-summary').textContent).toBe('Current');
});

test('project changes invalidate a pending request and a reviewed proposal', async () => {
  const f = fixture(); await ready(f); f.button('Generate proposal').click();
  f.state.project.version++; f.ui.refresh(); expect(f.requests[1].options.signal.aborted).toBe(true);
  f.requests[1].resolve(plan); await settle(); expect(f.find(n => n.className === 'ai-preview').hidden).toBe(true);
  f.button('Generate proposal').click(); f.requests[2].resolve(plan); await settle();
  f.state.project.version++; f.ui.refresh(); expect(f.button('Apply proposal').hidden).toBe(true); expect(f.state.applies).toBe(0);
});

test('model discovery failure gives setup help and refresh recovery', async () => {
  const f = fixture(); f.requests[0].reject(new Error('sensitive internal error')); await settle();
  expect(f.find(n => n.className === 'ai-status').textContent).toContain('bun run start');
  expect(f.find(n => n.className === 'ai-status').textContent).not.toContain('sensitive');
  expect(f.button('Generate proposal').disabled).toBe(true);
  f.button('Refresh models').click(); f.requests[1].resolve({ models: [{ provider: 'test', id: 'fixture', name: 'Fixture' }] }); await settle();
  expect(f.button('Generate proposal').disabled).toBe(false);
});

test('provider selection includes large registries and refresh preserves model identity', async () => {
  const f = fixture(), models = Array.from({ length: 1100 }, (_, i) => ({ provider: 'first', id: String(i), name: 'Model ' + i }));
  models.push({ provider: 'last', id: 'retained', name: 'Chosen model' });
  f.requests[0].resolve({ models }); await settle();
  const provider = f.find(n => n.id === 'aiProvider'), model = f.find(n => n.id === 'aiModel');
  expect(provider.children.map(n => n.value)).toEqual(['first', 'last']);
  provider.value = 'last'; provider.listeners.change(); expect(model.children[0].textContent).toBe('Chosen model');
  f.button('Refresh models').click(); f.requests[1].resolve({ models: models.slice().reverse() }); await settle();
  expect(provider.value).toBe('last'); expect(model.value).toBe('0'); expect(model.children[0].textContent).toBe('Chosen model');
  f.button('Refresh models').click(); f.requests[2].resolve({ models: [{ provider: 'first', id: 'new', name: 'Replacement' }] }); await settle();
  expect(model.value).toBe(''); expect(f.button('Generate proposal').disabled).toBe(true); expect(f.find(n => n.className === 'ai-status').textContent).toContain('no longer available');
});

test('request validation reports the actionable limit and disabled layout error', async () => {
  const f = fixture(); await ready(f);
  f.J.ai.createRequest = () => { throw new Error('Use at most 200 lyric lines per AI plan.'); };
  f.button('Generate proposal').click(); expect(f.find(n => n.className === 'ai-status').textContent).toContain('200 lyric lines');
  f.J.ai.createRequest = () => { throw new Error('Enable at least one layout before generating an AI plan.'); };
  f.button('Generate proposal').click(); expect(f.find(n => n.className === 'ai-status').textContent).toContain('Enable at least one layout');
});

test('timeout aborts generation and exposes a retry', async () => {
  const f = fixture(); await ready(f); f.button('Generate proposal').click();
  [...f.timers.values()][0](); expect(f.requests[1].options.signal.aborted).toBe(true);
  f.requests[1].reject(new Error('Abort')); await settle();
  expect(f.find(n => n.className === 'ai-status').textContent).toContain('timed out');
  expect(f.button('Try again').disabled).toBe(false);
});

test('server timeout and busy errors explain how to recover', async () => {
  for (const [code, message] of [['timeout', 'timed out'], ['busy', 'Another arrangement']]) {
    const f = fixture(); await ready(f); f.button('Generate proposal').click();
    f.requests[1].resolve({ error: { code } }, false); await settle();
    expect(f.find(n => n.className === 'ai-status').textContent).toContain(message);
    expect(f.button('Try again').disabled).toBe(false);
  }
});


test('settings own selectors, header and panel expose entry, saved identity restores', async () => {
  const f = fixture({ provider: 'b', id: 'two' });
  f.requests[0].resolve({ models: [{ provider: 'a', id: 'one', name: 'One' }, { provider: 'b', id: 'two', name: 'Two' }] }); await settle();
  const dialog = f.find(n => n.id === 'aiSettingsDialog');
  expect(dialog?.tagName).toBe('dialog');
  expect(f.find(n => n.id === 'aiProvider').parent.parent).toBe(dialog);
  const accountList = f.find(n => n.className === 'ai-accounts'), loginRow = f.find(n => n.id === 'aiLoginStart').parent, authFlow = f.find(n => n.className === 'ai-auth');
  expect(dialog.children.indexOf(loginRow)).toBeLessThan(dialog.children.indexOf(accountList));
  expect(dialog.children.indexOf(authFlow)).toBeLessThan(dialog.children.indexOf(accountList));
  expect(f.acts.children.some(n => n.textContent === 'AI settings')).toBe(true);
  expect(f.find(n => n.id === 'aiModel').value).toBe('1');
  f.button('AI settings').click(); expect(dialog.open).toBe(true);
  expect(f.requests.at(-1).url).toBe('/api/ai/accounts');
});

test('explicit login masks and clears prompt, safe link, close cancels flow', async () => {
  const f = fixture(); await ready(f); f.button('AI settings').click();
  f.requests.at(-1).resolve({ providers: [], loginProviders: [{id:'test-login',name:'Test account',provider:'test'}] }); await settle();
  expect(f.requests.filter(r => r.url === '/api/ai/login')).toHaveLength(0);
  f.button('Sign in').click();
  f.requests.at(-1).resolve({ id:'flow', status:'input', auth:{url:'javascript:alert(1)',instructions:'<b>Instruction</b>'}, prompt:{id:'p1',message:'Code',secret:true,allowEmpty:false} }); await settle();
  expect(f.find(n => n.id === 'aiAuthLink').hidden).toBe(true);
  const input = f.find(n => n.id === 'aiLoginInput'); expect(input.type).toBe('password');
  input.value = 'fixture-answer'; f.button('Continue').click(); expect(input.value).toBe('');
  expect(JSON.parse(f.requests.at(-1).options.body)).toEqual({promptId:'p1',value:'fixture-answer'});
  f.requests.at(-1).resolve({id:'flow',status:'waiting',auth:{url:'https://example.test/consent'}}); await settle();
  expect(f.find(n => n.id === 'aiAuthLink').rel).toBe('noopener noreferrer');
  f.button('Close').click(); expect(f.requests.at(-1).options.method).toBe('DELETE');
  expect(f.find(n => n.id === 'aiSettingsDialog').open).toBe(false);
  expect([...f.storage.values()].join('')).not.toContain('fixture-answer');
});

async function accountsReady(f, providers = []) {
  f.button('AI settings').click();
  f.requests.at(-1).resolve({ providers, loginProviders: [{id:'test-login',name:'Test account',provider:'test'}] }); await settle();
}

test('account list shows configured credentials safely and requires exact logout confirmation', async () => {
  const f = fixture(); await ready(f);
  await accountsReady(f, [{id:'unused',name:'Not configured',configured:false,accounts:[]}, {id:'test',name:'Test',configured:true,accounts:[{id:'9',label:'<b>masked@example.test</b>',kind:'oauth'}]}]);
  expect(f.find(n => n.textContent === 'Not configured')).toBeUndefined();
  expect(f.find(n => n.textContent === '<b>masked@example.test</b>').children).toHaveLength(0);
  const logout = f.find(n => n.attrs?.['data-credential-id'] === '9'); logout.click();
  expect(f.requests.filter(r => r.url === '/api/ai/logout')).toHaveLength(0);
  f.find(n => n.attrs?.['data-logout-cancel'] === '9').click();
  expect(f.find(n => n.className === 'ai-logout-confirm').hidden).toBe(true);
  logout.click(); f.find(n => n.attrs?.['data-logout-confirm'] === '9').click();
  expect(JSON.parse(f.requests.at(-1).options.body)).toEqual({provider:'test',credentialId:'9'});
  f.requests.at(-1).resolve({removed:true}); await settle();
  expect(f.requests.at(-2).url).toBe('/api/ai/models'); expect(f.requests.at(-1).url).toBe('/api/ai/accounts');
});

test('live flow polls at one second, switches prompts, refreshes after success and stops polling', async () => {
  const f = fixture(); await ready(f); await accountsReady(f);
  f.button('Sign in').click(); f.requests.at(-1).resolve({id:'flow',status:'input',prompt:{id:'first',message:'First',secret:true,allowEmpty:false}}); await settle();
  expect([...f.delays.values()]).toEqual([1000]);
  const input = f.find(n => n.id === 'aiLoginInput'); input.value = 'unsent fixture';
  [...f.timers.values()][0](); f.requests.at(-1).resolve({id:'flow',status:'input',prompt:{id:'second',message:'Second',secret:false,allowEmpty:true}}); await settle();
  expect(input.value).toBe(''); expect(input.type).toBe('text');
  f.button('Continue').click(); expect(JSON.parse(f.requests.at(-1).options.body)).toEqual({promptId:'second',value:''});
  f.requests.at(-1).resolve({id:'flow',status:'success'}); await settle();
  expect(f.requests.at(-2).url).toBe('/api/ai/models'); expect(f.requests.at(-1).url).toBe('/api/ai/accounts');
  expect([...f.delays.values()]).toEqual([15000]);
});

test('closing while login starts cancels the eventual flow without resurrecting the dialog', async () => {
  const f = fixture(); await ready(f); await accountsReady(f); f.button('Sign in').click(); const start = f.requests.at(-1);
  expect(f.find(n => n.id === 'aiLoginInput').parent.hidden).toBe(true);
  expect(f.find(n => n.id === 'aiLoginCancel').hidden).toBe(false);
  f.button('Close').click(); start.resolve({id:'late',status:'waiting'}); await settle();
  expect(f.requests.at(-1).url).toBe('/api/ai/login/late'); expect(f.requests.at(-1).options.method).toBe('DELETE');
  expect(f.find(n => n.id === 'aiSettingsDialog').open).toBe(false);
});

test('SDK progress is rendered as text during a live sign-in', async () => {
  const f = fixture(); await ready(f); await accountsReady(f); f.button('Sign in').click();
  f.requests.at(-1).resolve({id:'flow',status:'waiting',message:'<b>Waiting for consent</b>'}); await settle();
  const status = f.find(n => n.id === 'aiAuthStatus');
  expect(status.textContent).toBe('<b>Waiting for consent</b>'); expect(status.children).toHaveLength(0);
});

test('explicit model selection saves provider and model identity only', async () => {
  const f = fixture(); f.requests[0].resolve({models:[{provider:'test',id:'one',name:'One'},{provider:'test',id:'two',name:'Two'}]}); await settle();
  const select = f.find(n => n.id === 'aiModel'); select.value = '1'; select.listeners.change();
  expect(JSON.parse(f.storage.get('jizura.ai.settings.v1'))).toEqual({provider:'test',id:'two'});
});

test('panel copy reflects saved model setup in settings', async () => {
  const f = fixture(); await ready(f);
  expect(f.find(n => n.className === 'ai-status' && n.parent.id === 'aiArrangement').textContent).toBe('Ready to generate a proposal');
  f.button('Refresh models').click(); f.requests.at(-1).resolve({models:[]}); await settle();
  expect(f.find(n => n.className === 'ai-status' && n.parent.id === 'aiArrangement').textContent).toContain('AI settings');
});

test('poll started before prompt submission cannot restore a stale prompt or erase the new answer', async () => {
  const f = fixture(); await ready(f); await accountsReady(f); f.button('Sign in').click();
  const first = {id:'flow',status:'input',prompt:{id:'first',message:'First',secret:true,allowEmpty:false}};
  f.requests.at(-1).resolve(first); await settle();
  [...f.timers.values()][0](); const pendingPoll = f.requests.at(-1);
  const input = f.find(n => n.id === 'aiLoginInput'); input.value = 'first-fixture'; f.button('Continue').click();
  f.requests.at(-1).resolve({id:'flow',status:'input',prompt:{id:'second',message:'Second',secret:true,allowEmpty:false}}); await settle();
  input.value = 'unsent-second-fixture'; pendingPoll.resolve(first); await settle();
  expect(input.value).toBe('unsent-second-fixture');
  f.button('Continue').click(); expect(JSON.parse(f.requests.at(-1).options.body)).toEqual({promptId:'second',value:'unsent-second-fixture'});
});
