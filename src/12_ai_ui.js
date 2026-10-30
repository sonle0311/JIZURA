/* Reviewed AI arrangements. Model text is always rendered as text. */
(() => {
'use strict';
J.initAIUI = function (host) {
  const anchor = document.querySelector('.col-left .sec');
  if (!anchor || !J.ai || document.getElementById('aiArrangement')) return null;
  const vi = document.documentElement.lang === 'vi';
  const copy = vi ? {
    title: 'Dàn dựng bằng AI', intro: 'AI đề xuất bố cục và chuyển động cho từng câu. Xem trước đề xuất rồi mới áp dụng.',
    provider: 'Nhà cung cấp', model: 'Mô hình', refresh: 'Tải lại mô hình', direction: 'Định hướng (không bắt buộc)', placeholder: 'Ví dụ: mở đầu nhẹ nhàng, điệp khúc mạnh và dứt khoát',
    privacy: 'Gửi lời, thời gian, đặc trưng nhịp/âm lượng khi có nhạc và danh sách kỹ thuật cho mô hình đã chọn. Audio gốc ở trên máy.',
    generate: 'Tạo đề xuất', retry: 'Thử lại', cancel: 'Hủy', apply: 'Áp dụng đề xuất', previous: 'Về phương án trước',
    loadingModels: 'Đang tìm mô hình đã cấu hình…', choose: 'Chọn mô hình', ready: 'Sẵn sàng tạo đề xuất',
    unavailable: 'Chưa kết nối được AI. Chạy bun run start, đăng nhập nhà cung cấp bằng omp login rồi tải lại mô hình.',
    noModels: 'Chưa có mô hình đã cấu hình. Mở Cài đặt AI để đăng nhập hoặc tải lại mô hình.',
    generating: 'Đang tạo đề xuất… Có thể mất tối đa 2 phút.', canceled: 'Đã hủy. Bạn có thể tạo đề xuất mới.',
    timeout: 'Đã hết thời gian chờ. Thử lại hoặc chọn mô hình khác.', serviceBusy: 'Một đề xuất khác đang được xử lý. Chờ một chút rồi thử lại.', failed: 'Không tạo được đề xuất. Kiểm tra kết nối và đăng nhập nhà cung cấp rồi thử lại.',
    invalid: 'Đề xuất không hợp lệ. Hãy thử lại hoặc chọn mô hình khác.', empty: 'Thêm lời bài hát và ít nhất một câu chưa khóa để tạo đề xuất.',
    stale: 'Dự án đã thay đổi. Tạo đề xuất mới để dùng đúng lời và thiết lập hiện tại.', review: 'Đề xuất đã sẵn sàng. Xem từng câu trước khi áp dụng.',
    applied: 'Đã áp dụng. Có thể quay về phương án trước.', busy: 'Dừng đồng bộ bằng chạm hoặc chờ xuất xong để tiếp tục.',
    preview: 'Đề xuất', line: 'Câu', style: 'Phong cách', choices: 'Kỹ thuật', keep: 'Giữ thiết lập hiện tại',
    limitChars: 'AI hỗ trợ tối đa 30.000 ký tự lời bài hát.', limitLines: 'AI hỗ trợ tối đa 200 câu lời bài hát.',
    limitDirection: 'Định hướng cần ngắn hơn hoặc bằng 2.000 ký tự.', layout: 'Bật ít nhất một bố cục trước khi tạo đề xuất AI.', timing: 'Thời gian của câu không hợp lệ. Kiểm tra lại thời gian từng câu.',
  } : {
    title: 'Arrange with AI', intro: 'Get layout and motion ideas for each lyric line. Review the proposal before applying it.',
    provider: 'Provider', model: 'Model', refresh: 'Refresh models', direction: 'Direction (optional)', placeholder: 'For example: a quiet opening, then a sharp, energetic chorus',
    privacy: 'Sends lyrics, line timing, available beat/energy features and the technique catalogue to your selected model. The audio file stays here.',
    generate: 'Generate proposal', retry: 'Try again', cancel: 'Cancel', apply: 'Apply proposal', previous: 'Previous arrangement',
    loadingModels: 'Finding configured models…', choose: 'Choose a model', ready: 'Ready to generate a proposal',
    unavailable: 'AI is unavailable. Run bun run start, sign in to a provider with omp login, then refresh models.',
    noModels: 'No configured models found. Open AI settings to sign in or refresh models.',
    generating: 'Creating a proposal… This can take up to 2 minutes.', canceled: 'Canceled. You can generate another proposal.',
    timeout: 'The request timed out. Try again or choose another model.', serviceBusy: 'Another arrangement is running. Wait a moment, then try again.', failed: 'Could not create a proposal. Check your connection and provider sign-in, then try again.',
    invalid: 'The proposal was invalid. Try again or choose another model.', empty: 'Add lyrics and at least one unlocked line to generate a proposal.',
    stale: 'The project changed. Generate a new proposal for the current lyrics and settings.', review: 'Proposal ready. Review each line before applying.',
    applied: 'Applied. You can return to the previous arrangement.', busy: 'Stop tap syncing or wait for export to finish to continue.',
    preview: 'Proposal', line: 'Line', style: 'Style', choices: 'Techniques', keep: 'Keep current settings',
    limitChars: 'AI supports up to 30,000 lyric characters.', limitLines: 'AI supports up to 200 lyric lines.',
    limitDirection: 'Keep the direction to 2,000 characters or fewer.', layout: 'Enable at least one layout before generating an AI proposal.', timing: 'Lyric timing is invalid. Check the start and end of each line.',
  };
  const settingsCopy = vi ? {
    title: 'Cài đặt AI', close: 'Đóng', defaultModel: 'Mô hình mặc định', accounts: 'Tài khoản nhà cung cấp', none: 'Chưa chọn mô hình',
    missing: 'Mô hình đã lưu không còn khả dụng. Mở Cài đặt AI và chọn mô hình để tiếp tục.',
    configured: 'Đã cấu hình · chưa kiểm tra kết nối trực tiếp', unconfigured: 'Chưa cấu hình',
    shared: 'Thông tin đăng nhập OMP được dùng chung trên máy này. Đăng xuất chỉ xóa tài khoản đã chọn. Thông tin từ môi trường/cấu hình cần quản lý bên ngoài.',
    login: 'Đăng nhập', logout: 'Đăng xuất', confirm: 'Xóa thông tin đăng nhập này khỏi kho OMP dùng chung?', remove: 'Xác nhận đăng xuất', keep: 'Giữ tài khoản',
    loading: 'Đang tải tài khoản…', failed: 'Không thể hoàn thành. Kiểm tra máy chủ và thử lại.', busy: 'Chờ tác vụ AI hiện tại hoàn tất rồi thử lại.',
    starting: 'Đang bắt đầu đăng nhập…', waiting: 'Hoàn tất bước đăng nhập của nhà cung cấp.', success: 'Đã đăng nhập. Đang tải lại mô hình.', cancelled: 'Đã hủy đăng nhập.',
    continue: 'Tiếp tục', cancel: 'Hủy đăng nhập', link: 'Mở trang đăng nhập của nhà cung cấp', input: 'Nhập thông tin theo yêu cầu của nhà cung cấp', connect: 'Thêm tài khoản',
  } : {
    title: 'AI settings', close: 'Close', defaultModel: 'Default model', accounts: 'Provider accounts', none: 'No model selected',
    missing: 'Your saved model is no longer available. Open AI settings and choose a model to continue.',
    configured: 'Configured · live connection not checked', unconfigured: 'Not configured',
    shared: 'OMP sign-ins are shared on this machine. Signing out removes only the selected stored credential. Manage environment/config credentials externally.',
    login: 'Sign in', logout: 'Sign out', confirm: 'Remove this credential from shared OMP storage?', remove: 'Confirm sign out', keep: 'Keep account',
    loading: 'Loading accounts…', failed: 'Could not complete this action. Check the local server and try again.', busy: 'Wait for the current AI operation to finish, then try again.',
    starting: 'Starting sign-in…', waiting: 'Complete the provider sign-in step.', success: 'Signed in. Refreshing models.', cancelled: 'Sign-in canceled.',
    continue: 'Continue', cancel: 'Cancel sign-in', link: 'Open provider sign-in page', input: 'Enter the information requested by the provider', connect: 'Add account',
  };
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const panel = node('section', 'sec ai-panel'); panel.id = 'aiArrangement'; panel.setAttribute('aria-labelledby', 'aiHeading');
  const header = node('div', 'sec-h'); const heading = node('h2', '', copy.title); heading.id = 'aiHeading'; header.append(heading); panel.append(header);
  panel.append(node('p', 'ai-intro', copy.intro));
  const dialog = node('dialog', 'ai-settings'); dialog.id = 'aiSettingsDialog'; dialog.setAttribute('aria-labelledby', 'aiSettingsTitle');
  const dialogHeader = node('div', 'ai-settings-header'), dialogTitle = node('h2', '', settingsCopy.title), closeSettings = node('button', 'ghost', settingsCopy.close);
  dialogTitle.id = 'aiSettingsTitle'; closeSettings.id = 'aiSettingsClose'; closeSettings.type = 'button'; dialogHeader.append(dialogTitle, closeSettings); dialog.append(dialogHeader, node('h3', '', settingsCopy.defaultModel));
  const settingsOpen = node('button', 'ghost small', settingsCopy.title); settingsOpen.type = 'button'; settingsOpen.id = 'aiSettingsOpen';
  settingsOpen.setAttribute('aria-haspopup', 'dialog'); document.querySelector('.bar .acts')?.append(settingsOpen);
  const modelSummary = node('p', 'ai-current-model', settingsCopy.none), settingsLink = node('button', 'ghost small', settingsCopy.title);
  settingsLink.type = 'button'; settingsLink.id = 'aiPanelSettings'; settingsLink.setAttribute('aria-haspopup', 'dialog'); const summaryRow = node('div', 'ai-current-row'); summaryRow.append(modelSummary, settingsLink); panel.append(summaryRow);
  const providerLabel = node('label', 'ai-field ai-provider', copy.provider), providers = node('select'); providers.id = 'aiProvider'; providerLabel.htmlFor = providers.id; providerLabel.append(providers); dialog.append(providerLabel);
  const modelRow = node('div', 'ai-model-row'), modelLabel = node('label', 'ai-field', copy.model), models = node('select'); models.id = 'aiModel'; modelLabel.htmlFor = models.id; modelLabel.append(models);
  const refresh = node('button', 'ghost small', copy.refresh); refresh.type = 'button'; modelRow.append(modelLabel, refresh); dialog.append(modelRow);
  const modelStatus = node('p', 'ai-status'); modelStatus.setAttribute('role', 'status'); dialog.append(modelStatus);
  dialog.append(node('h3', '', settingsCopy.accounts), node('p', 'ai-help', settingsCopy.shared));
  const accountStatus = node('p', 'ai-status', ''), accounts = node('div', 'ai-accounts'); accountStatus.setAttribute('role', 'status'); dialog.append(accountStatus);
  const loginLabel = node('label', 'ai-field', settingsCopy.connect), loginProvider = node('select'), loginStart = node('button', 'ghost', settingsCopy.login);
  loginProvider.id = 'aiLoginProvider'; loginLabel.htmlFor = loginProvider.id; loginLabel.append(loginProvider); loginStart.id = 'aiLoginStart'; loginStart.type = 'button'; loginStart.disabled = true;
  const loginOptions = node('div', 'ai-model-row'); loginOptions.append(loginLabel, loginStart); dialog.append(loginOptions);
  const auth = node('section', 'ai-auth'); auth.hidden = true;
  const authStatus = node('p', 'ai-status'), authLink = node('a', 'ai-auth-link', settingsCopy.link), instructions = node('p', 'ai-help'), promptLabel = node('label', 'ai-field'), authInput = node('input'), authSubmit = node('button', 'primary', settingsCopy.continue), authCancel = node('button', 'ghost', settingsCopy.cancel);
  authStatus.id = 'aiAuthStatus'; authStatus.setAttribute('role', 'status'); authStatus.setAttribute('aria-live', 'polite');
  authLink.id = 'aiAuthLink'; authLink.target = '_blank'; authLink.rel = 'noopener noreferrer'; authLink.hidden = true;
  authInput.id = 'aiLoginInput'; authInput.autocomplete = 'off'; authInput.maxLength = 16384; promptLabel.htmlFor = authInput.id;
  const promptText = node('span'); promptLabel.append(promptText, authInput); authSubmit.id = 'aiLoginSubmit'; authCancel.id = 'aiLoginCancel'; authSubmit.type = authCancel.type = 'button';
  const authActions = node('div', 'ai-actions'); authActions.append(authSubmit, authCancel); auth.append(authStatus, authLink, instructions, promptLabel, authActions); dialog.append(auth, accounts); document.body.append(dialog);
  const directionLabel = node('label', 'ai-field', copy.direction), direction = node('textarea'); direction.id = 'aiDirection'; directionLabel.htmlFor = direction.id; direction.rows = 3; direction.maxLength = 2000; direction.placeholder = copy.placeholder; directionLabel.append(direction); panel.append(directionLabel);
  const privacy = node('p', 'ai-help', copy.privacy); privacy.id = 'aiPrivacy'; panel.append(privacy);
  const actions = node('div', 'ai-actions'), generate = node('button', 'primary', copy.generate), cancel = node('button', 'ghost', copy.cancel);
  generate.type = cancel.type = 'button'; generate.setAttribute('aria-describedby', privacy.id); cancel.hidden = true; actions.append(generate, cancel); panel.append(actions);
  const status = node('p', 'ai-status', copy.loadingModels); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true'); panel.append(status);
  const preview = node('div', 'ai-preview'); preview.hidden = true; panel.append(preview);
  const reviewActions = node('div', 'ai-actions'), apply = node('button', 'primary', copy.apply), previous = node('button', 'ghost', copy.previous);
  apply.type = previous.type = 'button'; apply.hidden = previous.hidden = true; reviewActions.append(apply, previous); panel.append(reviewActions);
  anchor.after(panel);
  let available = [], loadingModels = false, active = null, proposal = null, appliedFingerprint = null, sequence = 0, modelSequence = 0, failed = false;
  let preferred = null, flow = null, authTimer = null, authSequence = 0, accountsSequence = 0, authPending = false;
  try { const saved = JSON.parse(localStorage.getItem('jizura.ai.settings.v1')); if (saved && typeof saved.provider === 'string' && typeof saved.id === 'string') preferred = { provider: saved.provider, id: saved.id }; } catch (_) { /* Browser preferences may be unavailable. */ }
  const rememberModel = () => { const chosen = selectedModel(); if (chosen) { preferred = { provider: chosen.provider, id: chosen.id }; try { localStorage.setItem('jizura.ai.settings.v1', JSON.stringify(preferred)); } catch (_) {} } update(); };
  const currentFingerprint = () => J.ai.fingerprint(host.getProject());
  const say = (text, error) => { status.textContent = modelStatus.textContent = text; status.classList.toggle('is-error', !!error); modelStatus.classList.toggle('is-error', !!error); };
  const clearPreview = () => { proposal = null; preview.replaceChildren(); preview.hidden = true; apply.hidden = true; };
  const update = () => {
    const busy = !!host.isBusy();
    if ((active && active.fingerprint !== currentFingerprint()) || (proposal && proposal.fingerprint !== currentFingerprint()) || (appliedFingerprint && appliedFingerprint !== currentFingerprint())) {
      if (active) { active.controller.abort(); clearTimeout(active.timer); active = null; ++sequence; }
      clearPreview(); appliedFingerprint = null; previous.hidden = true; say(copy.stale);
    }
    generate.disabled = !!active || loadingModels || busy || !!flow || authPending || !selectedModel();
    const chosen = selectedModel(); modelSummary.textContent = chosen ? chosen.provider + ' · ' + chosen.name : settingsCopy.none;
    models.disabled = providers.disabled = !!active || !!flow || authPending || loadingModels || !available.length; direction.disabled = !!active; refresh.disabled = !!active || !!flow || authPending || loadingModels;
    loginStart.disabled = !!active || !!flow || authPending || !loginProvider.value; loginProvider.disabled = !!flow || authPending;
    cancel.hidden = !active; apply.disabled = busy || !proposal; previous.disabled = busy;
    panel.setAttribute('aria-busy', String(!!active));
  };
  const fetchJSON = async (url, options) => {
    const response = await fetch(url, options); const text = await response.text();
    if (text.length > 1000000) throw new Error('invalid');
    let body; try { body = JSON.parse(text); } catch (_) { throw new Error('invalid'); }
    if (!response.ok) { const error = new Error('api'); error.code = body && body.error && body.error.code; throw error; }
    return body;
  };
  const selectedModel = () => available.find((m, i) => String(i) === models.value);
  function fillModels(provider, selected) {
    models.replaceChildren();
    const indices = [];
    available.forEach((m, i) => { if (m.provider !== provider) return; indices.push(i); const option = node('option', '', m.name); option.value = String(i); models.append(option); });
    const found = selected && indices.find(i => available[i].provider === selected.provider && available[i].id === selected.id);
    models.value = String(found != null && found !== false ? found : indices[0] ?? '');
    if (!indices.length) { const option = node('option', '', copy.choose); option.value = ''; models.append(option); }
  }
  async function loadModels() {
    const ticket = ++modelSequence, selected = selectedModel() || preferred; loadingModels = true; say(copy.loadingModels); update();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const body = await fetchJSON('/api/ai/models', { signal: controller.signal });
      if (ticket !== modelSequence) return;
      available = (Array.isArray(body.models) ? body.models : []).filter(m => m && typeof m.provider === 'string' && m.provider.length > 0 && m.provider.length <= 200 && typeof m.id === 'string' && m.id.length > 0 && m.id.length <= 300 && typeof m.name === 'string' && m.name.length <= 200);
      const names = [...new Set(available.map(m => m.provider))].sort(); providers.replaceChildren();
      names.forEach(provider => { const option = node('option', '', provider); option.value = provider; providers.append(option); });
      providers.value = selected && names.includes(selected.provider) ? selected.provider : names[0] || '';
      fillModels(providers.value, selected);
      const missing = selected && !available.some(m => m.provider === selected.provider && m.id === selected.id);
      if (missing) { const option = node('option', '', copy.choose); option.value = ''; models.append(option); models.value = ''; }
      if (!selected && selectedModel()) rememberModel();
      say(missing ? settingsCopy.missing : available.length ? copy.ready : copy.noModels, missing || !available.length);
    } catch (_) { if (ticket === modelSequence) { available = []; providers.replaceChildren(); models.replaceChildren(node('option', '', copy.choose)); say(copy.unavailable, true); } }
    finally { clearTimeout(timer); if (ticket === modelSequence) { loadingModels = false; update(); } }
  }
  const jsonOptions = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const authError = error => error.code === 'busy' ? settingsCopy.busy : settingsCopy.failed;
  const safeText = value => typeof value === 'string' ? value.slice(0, 10000) : '';
  async function loadAccounts() {
    const ticket = ++accountsSequence; accountStatus.textContent = settingsCopy.loading;
    try {
      const body = await fetchJSON('/api/ai/accounts'); if (ticket !== accountsSequence || !dialog.open) return;
      accounts.replaceChildren(); loginProvider.replaceChildren(); accountStatus.textContent = '';
      for (const provider of Array.isArray(body.providers) ? body.providers : []) {
        if (!provider || typeof provider.id !== 'string') continue;
        if (!provider.configured && !(Array.isArray(provider.accounts) && provider.accounts.length)) continue;
        const group = node('div', 'ai-account'); group.append(node('strong', '', safeText(provider.name) || provider.id), node('p', 'ai-help', provider.configured ? settingsCopy.configured : settingsCopy.unconfigured));
        for (const account of Array.isArray(provider.accounts) ? provider.accounts : []) {
          if (!account || typeof account.id !== 'string') continue;
          const row = node('div', 'ai-account-row'), label = node('span', '', safeText(account.label)), logout = node('button', 'ghost small', settingsCopy.logout); logout.type = 'button'; logout.setAttribute('data-credential-id', account.id);
          const confirmation = node('div', 'ai-logout-confirm'); confirmation.hidden = true;
          const remove = node('button', 'ghost', settingsCopy.remove), keep = node('button', 'ghost', settingsCopy.keep); remove.type = keep.type = 'button';
          remove.setAttribute('data-logout-confirm', account.id); keep.setAttribute('data-logout-cancel', account.id);
          confirmation.append(node('p', 'ai-help', settingsCopy.confirm), remove, keep); row.append(label, logout); group.append(row, confirmation);
          logout.addEventListener('click', () => { confirmation.hidden = false; remove.focus(); });
          keep.addEventListener('click', () => { confirmation.hidden = true; logout.focus(); });
          remove.addEventListener('click', async () => {
            if (active || flow || authPending) { accountStatus.textContent = settingsCopy.busy; return; }
            authPending = true; remove.disabled = true; update();
            try { await fetchJSON('/api/ai/logout', jsonOptions({ provider: provider.id, credentialId: account.id })); await Promise.all([loadModels(), loadAccounts()]); }
            catch (error) { accountStatus.textContent = authError(error); } finally { authPending = false; remove.disabled = false; update(); }
          });
        }
        accounts.append(group);
      }
      for (const provider of Array.isArray(body.loginProviders) ? body.loginProviders : []) {
        if (!provider || typeof provider.id !== 'string') continue;
        const option = node('option', '', safeText(provider.name) || provider.id); option.value = provider.id; loginProvider.append(option);
      }
      loginProvider.value = loginProvider.children[0]?.value || ''; update();
    } catch (error) { if (ticket === accountsSequence) accountStatus.textContent = authError(error); }
  }
  function renderFlow(snapshot) {
    const previousPrompt = flow && flow.prompt && flow.prompt.id;
    const live = ['starting', 'waiting', 'input'].includes(snapshot.status); flow = live ? snapshot : null; auth.hidden = false;
    authStatus.textContent = snapshot.status === 'success' ? settingsCopy.success : snapshot.status === 'cancelled' ? settingsCopy.cancelled : snapshot.status === 'error' ? settingsCopy.failed : snapshot.status === 'starting' ? settingsCopy.starting : settingsCopy.waiting;
    if (live && safeText(snapshot.message)) authStatus.textContent = safeText(snapshot.message);
    instructions.textContent = safeText(snapshot.auth && snapshot.auth.instructions);
    const url = safeText(snapshot.auth && snapshot.auth.url); authLink.hidden = !/^https?:\/\//i.test(url); authLink.href = authLink.hidden ? '' : url;
    const prompt = live && snapshot.prompt; promptLabel.hidden = authSubmit.hidden = !prompt; authCancel.hidden = !live;
    if (!prompt || previousPrompt !== prompt.id) authInput.value = '';
    if (prompt) { promptText.textContent = safeText(prompt.message) || settingsCopy.input; authInput.type = prompt.secret ? 'password' : 'text'; authInput.placeholder = safeText(prompt.placeholder); authInput.required = !prompt.allowEmpty; if (previousPrompt !== prompt.id) authInput.focus(); }
    authSubmit.disabled = authPending; update();
    if (snapshot.status === 'success') { loadModels(); loadAccounts(); }
    if (live) { clearTimeout(authTimer); const ticket = authSequence; authTimer = setTimeout(async () => {
      if (!flow || ticket !== authSequence || !dialog.open) return;
      try { const next = await fetchJSON('/api/ai/login/' + encodeURIComponent(flow.id)); if (ticket === authSequence && dialog.open) renderFlow(next); }
      catch (_) { if (ticket === authSequence) { cancelLogin(); authStatus.textContent = settingsCopy.failed; } }
    }, 1000); }
  }
  async function startLogin(provider) {
    if (active || flow || authPending || !provider) { accountStatus.textContent = settingsCopy.busy; return; }
    const ticket = ++authSequence; authPending = true; auth.hidden = false; authStatus.textContent = settingsCopy.starting;
    authInput.value = ''; promptLabel.hidden = authSubmit.hidden = true; authCancel.hidden = false; update();
    try {
      const snapshot = await fetchJSON('/api/ai/login', jsonOptions({ provider }));
      if (ticket !== authSequence || !dialog.open) { if (snapshot.id) fetchJSON('/api/ai/login/' + encodeURIComponent(snapshot.id), { method: 'DELETE' }).catch(() => {}); return; }
      authPending = false; renderFlow(snapshot);
    } catch (error) { if (ticket === authSequence) authStatus.textContent = authError(error); }
    finally { if (ticket === authSequence) { authPending = false; update(); } }
  }
  function cancelLogin() {
    ++authSequence; clearTimeout(authTimer); authInput.value = ''; const previousFlow = flow; flow = null; authPending = false;
    authLink.hidden = true; authLink.href = ''; instructions.textContent = ''; promptLabel.hidden = authSubmit.hidden = authCancel.hidden = true;
    if (previousFlow) fetchJSON('/api/ai/login/' + encodeURIComponent(previousFlow.id), { method: 'DELETE' }).catch(() => { if (dialog.open) authStatus.textContent = settingsCopy.failed; });
    authStatus.textContent = settingsCopy.cancelled; update();
  }
  loginStart.addEventListener('click', () => startLogin(loginProvider.value));
  authCancel.addEventListener('click', cancelLogin);
  authSubmit.addEventListener('click', async () => {
    if (!flow || !flow.prompt || authPending || (!flow.prompt.allowEmpty && !authInput.value)) return;
    // An older status response must not replace the prompt returned by this submission.
    const snapshot = flow, ticket = ++authSequence, answer = authInput.value; authInput.value = ''; authPending = true; authSubmit.disabled = true; clearTimeout(authTimer);
    try { const next = await fetchJSON('/api/ai/login/' + encodeURIComponent(snapshot.id) + '/input', jsonOptions({ promptId: snapshot.prompt.id, value: answer })); if (ticket === authSequence && dialog.open) { authPending = false; renderFlow(next); } }
    catch (_) { if (ticket === authSequence) { cancelLogin(); authStatus.textContent = settingsCopy.failed; } }
    finally { if (ticket === authSequence) { authPending = false; authSubmit.disabled = false; } }
  });
  const openSettings = () => { if (!dialog.open) dialog.showModal(); closeSettings.focus(); loadAccounts(); };
  settingsOpen.addEventListener('click', openSettings); settingsLink.addEventListener('click', openSettings);
  closeSettings.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { ++accountsSequence; cancelLogin(); auth.hidden = true; });
  dialog.addEventListener('cancel', cancelLogin);
  function renderProposal(plan, request) {
    preview.replaceChildren(node('h3', '', copy.preview), node('p', 'ai-summary', plan.summary));
    const name = (group, id) => { const item = (request.catalog[group] || []).find(x => x.id === id); return item ? item.name : id; };
    if (plan.style) preview.append(node('p', 'ai-help', copy.style + ': ' + name('style', plan.style)));
    const list = node('ol', 'ai-lines');
    for (const line of plan.lines) {
      const item = node('li'), source = request.lines.find(x => x.index === line.index);
      item.append(node('strong', '', copy.line + ' ' + (line.index + 1)), node('p', 'ai-lyric', (source ? source.text : '').slice(0, 1000)), node('p', 'ai-reason', line.reason));
      const choices = [];
      for (const group of ['layout', 'enter', 'hold', 'exit', 'decor', 'treat', 'bg', 'cam', 'trans']) if (line[group] != null) { const values = Array.isArray(line[group]) ? line[group] : [line[group]]; choices.push(...values.map(id => name(group, id))); }
      item.append(node('p', 'ai-techniques', copy.choices + ': ' + (choices.join(' · ') || copy.keep))); list.append(item);
    }
    preview.append(list); preview.hidden = false; apply.hidden = false;
  }
  async function arrange() {
    update(); if (generate.disabled) return;
    clearPreview(); appliedFingerprint = null; previous.hidden = true;
    let request;
    try { request = J.ai.createRequest(host.getProject(), host.getPlan(), direction.value, selectedModel(), host.getAudio?.()); }
    catch (error) {
      const validationCopy = {
        'Choose an available AI model.': copy.choose, 'Direction must be at most 2000 characters.': copy.limitDirection,
        'Use at most 30000 lyric characters.': copy.limitChars, 'Use at most 200 lyric lines per AI plan.': copy.limitLines,
        'Enable at least one layout before generating an AI plan.': copy.layout, 'Lyric timing is invalid.': copy.timing,
      };
      say(validationCopy[error.message] || copy.empty, true); return;
    }
    const ticket = ++sequence, controller = new AbortController();
    const job = { controller, fingerprint: currentFingerprint(), timer: null, timedOut: false }; active = job;
    job.timer = setTimeout(() => { job.timedOut = true; controller.abort(); }, 120000);
    say(copy.generating); update();
    try {
      const body = await fetchJSON('/api/ai/arrange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
      if (ticket !== sequence || active !== job) return;
      if (job.fingerprint !== currentFingerprint()) { say(copy.stale); return; }
      let plan; try { plan = J.ai.validatePlan(body, request); } catch (_) { throw new Error('invalid'); }
      proposal = { plan, request, fingerprint: job.fingerprint }; renderProposal(plan, request); say(copy.review); failed = false;
    } catch (error) {
      if (ticket !== sequence || active !== job) return;
      failed = true;
      say(job.timedOut || error.code === 'timeout' ? copy.timeout : controller.signal.aborted ? copy.canceled : error.code === 'busy' ? copy.serviceBusy : error.message === 'invalid' || error.code === 'invalid_plan' || error.code === 'INVALID_PLAN' ? copy.invalid : copy.failed, !controller.signal.aborted || job.timedOut);
    } finally {
      clearTimeout(job.timer); if (ticket === sequence && active === job) { active = null; generate.textContent = failed ? copy.retry : copy.generate; update(); }
    }
  }
  refresh.addEventListener('click', loadModels); generate.addEventListener('click', arrange);
  providers.addEventListener('change', () => { fillModels(providers.value); rememberModel(); });
  models.addEventListener('change', rememberModel);
  cancel.addEventListener('click', () => { if (!active) return; active.controller.abort(); clearTimeout(active.timer); active = null; ++sequence; say(copy.canceled); update(); });
  apply.addEventListener('click', () => {
    update(); if (!proposal || host.isBusy()) { if (host.isBusy()) say(copy.busy); return; }
    const chosen = proposal;
    try { host.applyAI(chosen.plan, chosen.request, chosen.fingerprint); clearPreview(); appliedFingerprint = currentFingerprint(); previous.hidden = !host.previous; say(copy.applied); }
    catch (_) { clearPreview(); say(copy.stale, true); }
    update();
  });
  previous.addEventListener('click', () => { if (!host.isBusy() && host.previous) { host.previous(); appliedFingerprint = null; previous.hidden = true; say(copy.ready); update(); } });
  // Also cover settings which save without rebuilding the visual plan.
  const interval = setInterval(() => { if (active || proposal || appliedFingerprint) update(); }, 600);
  window.addEventListener('pagehide', () => { clearInterval(interval); cancelLogin(); if (active) active.controller.abort(); }, { once: true });
  loadModels();
  return { refresh: update };
};
})();
