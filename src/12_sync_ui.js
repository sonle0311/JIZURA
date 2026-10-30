/* Local audio alignment: confident timing applies automatically; uncertain rows remain reviewable. */
(() => {
'use strict';
J.initSyncUI = function (host) {
  const anchor = document.getElementById('audioName')?.closest('.sec') || document.querySelector('.col-left .sec');
  if (!anchor || !J.sync || document.getElementById('syncPanel')) return null;
  const vi = document.documentElement.lang === 'vi';
  const direct = typeof host.applyTranscript === 'function';
  const copy = vi ? {
    title: 'Tự đồng bộ audio và lời', start: 'Đồng bộ audio và lời', cancel: 'Hủy', apply: 'Áp dụng thời gian đã chọn', audition: 'Nghe câu', retry: 'Kiểm tra lại', undo: 'Hoàn tác thời gian', undone: 'Đã hoàn tác thời gian vừa đồng bộ.',
    privacy: 'Xử lý trên máy bằng WhisperX. Audio gốc ở trên máy. Lần đầu có thể cần tải mô hình; CPU có thể xử lý chậm.',
    confidence: 'Câu khớp chắc chắn được tự cập nhật. Điểm khớp là ước lượng; nghe lại và chọn các câu còn cần kiểm tra. Có thể dùng Hoàn tác hoặc Ctrl+Z.',
    checking: 'Đang kiểm tra bộ đồng bộ…', ready: 'Sẵn sàng. Thêm audio và lời rồi bắt đầu; câu khớp chắc chắn sẽ tự cập nhật và dựng lại cảnh.', need: 'Cần audio đã giải mã (tối đa 10 phút) và 1–200 câu lời.',
    unavailable: 'Chưa có bộ đồng bộ local. Chạy python alignment/setup.py rồi bun run start; sau đó kiểm tra lại.',
    uploading: 'Đang chuẩn bị và gửi audio đến bộ xử lý local…', done: 'Các mốc còn lại chưa đủ chắc để tự áp dụng. Bạn có thể kiểm tra thêm.', canceled: 'Đã hủy đồng bộ.', stale: 'Dự án hoặc audio đã thay đổi. Hãy đồng bộ lại.',
    noMatches: 'Chưa tìm được mốc lời trong audio nên chưa thể tự ghép hoặc cập nhật cắt cảnh. Dự án được giữ nguyên.',
    failed: 'Không đồng bộ được. Kiểm tra bộ xử lý local rồi thử lại.', invalid: 'Kết quả không hợp lệ (invalid). Hãy thử lại.', busy: 'Đang có công việc khác. Chờ xong rồi thử lại.',
    conflict: 'Thời gian đã chọn xung đột với câu khóa hoặc câu chưa chọn. Chọn lại các câu rồi thử lại.', applied: 'Đã áp dụng thời gian. Dùng Hoàn tác thời gian hoặc Ctrl+Z để hoàn tác.',
    automatic: 'Đã tự cập nhật Lời bài hát và cắt cảnh. Có thể Hoàn tác.', updated: 'Đã cập nhật',
    matched: 'Khớp', review: 'Cần kiểm tra', unmatched: 'Chưa tìm thấy', locked: 'Đã khóa', select: 'Chọn câu', warnings: 'Lưu ý',
  } : {
    title: 'Auto-sync audio and lyrics', start: 'Sync audio and lyrics', cancel: 'Cancel', apply: 'Apply selected times', audition: 'Audition line', retry: 'Check again', undo: 'Undo synced times', undone: 'Synced timing changes undone.',
    privacy: 'Runs locally with WhisperX. Source audio stays on your machine. The first run may download models; CPU processing can take a while.',
    confidence: 'Confident matches update automatically. Match scores are heuristic; audition and select remaining lines. Undo timing changes with Undo or Ctrl+Z.',
    checking: 'Checking local alignment engine…', ready: 'Ready. Load audio and lyrics, then start; confident matches automatically update timing and scene cuts.', need: 'Load decoded audio (up to 10 minutes) and 1–200 lyric lines.',
    unavailable: 'Local alignment engine unavailable. Run python alignment/setup.py and bun run start, then check again.',
    uploading: 'Preparing and sending audio to the local worker…', done: 'Remaining timestamps need review before they can be applied. You can check them if needed.', canceled: 'Alignment cancelled.', stale: 'Project or audio changed. Run alignment again.',
    noMatches: 'No lyric timing was found in the audio, so automatic alignment and scene updates could not run. Your project is unchanged.',
    failed: 'Alignment failed. Check the local worker and try again.', invalid: 'The alignment result is invalid. Try again.', busy: 'Another operation is running. Wait, then try again.',
    conflict: 'Selected times conflict with locked or unselected lines. Adjust the selection and try again.', applied: 'Times applied. Use Undo synced times or Ctrl+Z to undo.',
    automatic: 'Lyrics and scene cuts updated automatically. Undo is available.', updated: 'Updated',
    matched: 'Matched', review: 'Review', unmatched: 'Unmatched', locked: 'Locked', select: 'Select line', warnings: 'Warnings',
  };
  if (direct) Object.assign(copy, vi ? {
    title:'Lấy lời từ audio và dựng cảnh', start:'Lấy lời từ audio và dựng cảnh',
    privacy:'Nhận dạng lời trực tiếp từ audio trên máy bằng WhisperX. Không so sánh với lời nhập sẵn. Kết quả thay lời hiện tại và dựng cảnh; có thể Hoàn tác. CPU có thể xử lý chậm.',
    ready:'Sẵn sàng. Chọn audio rồi bắt đầu; không cần nhập lời trước.', need:'Cần audio đã giải mã, dài tối đa 10 phút.',
    noMatches:'Chưa chép được lời từ audio này. Lời và cảnh hiện tại được giữ nguyên.',
    automatic:'Đã chép lời từ audio và tự dựng cảnh. Có thể sửa lời trực tiếp hoặc Hoàn tác.',
    transcriptHelp:'Lời được nhận dạng trực tiếp từ audio và có thể có từ nghe sai. Các câu đã được đưa vào mục Lời bài hát và cắt cảnh.',
    truncated:'Chỉ tạo phần đầu bản chép lời vì đã đạt giới hạn 200 câu hoặc 30.000 ký tự. Hãy chia audio thành các phần ngắn hơn để lấy phần còn lại.',
    undo:'Hoàn tác lời và cảnh', undone:'Đã khôi phục lời và thời gian trước khi nhận dạng.',
  } : {
    title:'Transcribe audio and build scenes', start:'Transcribe audio and build scenes',
    privacy:'Transcribes audio locally with WhisperX, without comparing entered lyrics. Replaces current lyrics and builds scenes; Undo is available. CPU processing can take a while.',
    ready:'Ready. Load audio, then start; no lyric sheet required.', need:'Load decoded audio, up to 10 minutes.',
    noMatches:'Could not transcribe lyrics from this audio. Current lyrics and scenes are unchanged.',
    automatic:'Audio transcribed and scenes built automatically. Edit the lyrics or use Undo.',
    transcriptHelp:'Lyrics come directly from audio recognition and may contain misheard words. They are now available in Lyrics and scene cuts.',
    truncated:'Only the beginning was transcribed: the 200-line or 30,000-character limit was reached. Split the audio into shorter parts to obtain the rest.',
    undo:'Undo lyrics and scenes', undone:'Previous lyrics and timing restored.',
  });
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  const button = (id, text, cls) => { const n = el('button', cls, text); n.id = id; n.type = 'button'; return n; };
  const panel = el('section', 'sec sync-panel'); panel.id = 'syncPanel'; panel.setAttribute('aria-labelledby', 'syncTitle');
  const title = el('h2', '', copy.title); title.id = 'syncTitle'; const head = el('div', 'sec-h'); head.append(title); panel.append(head);
  const privacy = el('p', 'sync-help', copy.privacy); privacy.id = 'syncPrivacy'; panel.append(privacy);
  const actions = el('div', 'row sync-actions'), start = button('syncStart', copy.start, 'primary'), cancel = button('syncCancel', copy.cancel, 'ghost'), retry = button('syncRetry', copy.retry, 'ghost small');
  start.setAttribute('aria-describedby', privacy.id); cancel.hidden = true; retry.hidden = true; actions.append(start, cancel, retry); panel.append(actions);
  const status = el('p', 'sync-status', copy.checking); status.id = 'syncStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); panel.append(status);
  const progress = el('progress', 'sync-progress'); progress.max = 1; progress.hidden = true; progress.setAttribute('aria-label', copy.title); panel.append(progress);
  const review = el('div', 'sync-review'); review.id = 'syncReview'; review.hidden = true; panel.append(review);
  const apply = button('syncApply', copy.apply, 'primary'), undo = button('syncUndo', copy.undo, 'ghost'); apply.hidden = undo.hidden = true; panel.append(apply, undo); anchor.after(panel);
  let available = false, checking = false, active = null, proposal = null, applied = null, selections = [], generation = 0;
  const say = (text, error = false) => { status.textContent = text; status.classList.toggle('is-error', error); };
  const removeJob = id => { if (typeof id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(id)) fetch('/api/sync/jobs/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' }).catch(() => {}); };
  const clearReview = () => { proposal = null; selections = []; review.replaceChildren(); review.hidden = apply.hidden = true; };
  const invalidate = (message = copy.stale) => {
    const had = active || proposal || applied;
    if (active) { clearTimeout(active.timer); if (active.id) removeJob(active.id); active = null; ++generation; }
    clearReview(); applied = null; progress.hidden = true;
    if (had) say(message);
    update();
  };
  const validSnapshot = () => J.sync.snapshot(host.getProject(), host.getPlan(), host.getAudio(), 'auto', direct ? 'transcribe' : 'align');
  const update = () => {
    let valid = false; try { validSnapshot(); valid = true; } catch (_) {}
    start.disabled = checking || !available || !valid || !!active || !!host.isBusy();
    cancel.hidden = !active; retry.hidden = available || checking || !!active;
    apply.disabled = !!host.isBusy() || !proposal || !selections.some(s => s.input.checked && !s.input.disabled);
    undo.hidden = !applied || typeof host.undoSync !== 'function'; undo.disabled = !!host.isBusy() || !!active;
    panel.setAttribute('aria-busy', String(!!active || checking));
  };
  const refresh = () => {
    if (applied && !J.sync.current(host.getProject(), host.getAudio(), applied)) { invalidate(); return; }
    const held = active || proposal;
    if (held && (host.isBusy() || !J.sync.current(host.getProject(), host.getAudio(), held.snapshot))) { invalidate(); return; }
    update();
  };
  const renderReview = (result, snapshot, updated = []) => {
    clearReview(); proposal = { result, snapshot, updated };
    const hasTiming = result.lines.some(row => row.start != null);
    if (hasTiming) review.append(el('p', 'sync-help', copy.confidence));
    if (result.warnings.length) {
      const warnings = vi ? {
        singing_vad_retry: 'Đã nhận dạng lại phần hát bị bộ phát hiện giọng bỏ qua.',
        no_speech_detected: 'Chưa nhận ra giọng hát hoặc lời nói. Thử audio có giọng rõ hơn, hoặc nhập bản vocal.',
        alignment_model_unavailable: 'Chưa tải được mô hình căn chỉnh cho ngôn ngữ này. Kiểm tra kết nối khi tải mô hình lần đầu rồi thử lại.',
        some_segments_exceeded_alignment_bounds: 'Một số đoạn quá dài để căn chỉnh. Thử audio ngắn hơn và kiểm tra các câu chưa khớp.',
        no_aligned_words: 'Chưa tìm được thời điểm của từ. Thử audio có giọng rõ hơn hoặc đồng bộ bằng thao tác chạm.',
      } : {
        singing_vad_retry: 'Retried singing that the speech detector had removed.',
        no_speech_detected: 'No speech or singing detected. Try clearer audio or import a vocal stem.',
        alignment_model_unavailable: 'The alignment model for this language could not load. Check the connection for the first model download, then retry.',
        some_segments_exceeded_alignment_bounds: 'Some segments were too long to align. Try shorter audio and review the unmatched lines.',
        no_aligned_words: 'No word timestamps were found. Try clearer vocals or use tap sync.',
      };
      const fallback = vi ? 'Một số câu cần kiểm tra thêm. Nghe lại trước khi áp dụng.' : 'Some lines need extra review. Audition them before applying.';
      const notices = [...new Set(result.warnings.map(w => warnings[w] || fallback))];
      review.append(el('p', 'sync-help sync-warnings', copy.warnings + ': ' + notices.join(' ')));
    }
    if (!hasTiming) {
      review.hidden = false; apply.hidden = true; say(copy.noMatches, true); update(); return;
    }
    const rows = el('div', 'sync-rows');
    for (const source of snapshot.lines) {
      const row = result.lines.find(r => r.index === source.index), wrap = el('div', 'sync-row'); wrap.setAttribute('data-sync-index', source.index);
      const label = el('label', 'sync-select'), input = el('input'); input.type = 'checkbox'; input.setAttribute('data-sync-select', source.index); input.setAttribute('aria-label', copy.select + ' ' + (source.index + 1));
      const alreadyApplied = updated.includes(source.index);
      input.disabled = alreadyApplied || source.locked || row.status === 'unmatched'; input.checked = alreadyApplied || (!input.disabled && row.status === 'matched' && row.confidence >= 0.75);
      const lyric = el('span', 'sync-lyric', source.text); label.append(input, lyric); wrap.append(label);
      const info = el('div', 'sync-row-info'), time = row.start == null ? '—' : row.start.toFixed(2) + '–' + row.end.toFixed(2) + ' s';
      info.append(el('span', 'sync-time', time), el('span', 'sync-score', (alreadyApplied ? copy.updated : source.locked ? copy.locked : copy[row.status]) + ' · ' + Math.round(row.confidence * 100) + '/100'));
      const audition = button('', copy.audition, 'ghost small'); audition.setAttribute('data-sync-audition', source.index); audition.setAttribute('aria-label', copy.audition + ' ' + (source.index + 1)); audition.disabled = row.start == null;
      audition.addEventListener('click', () => { if (!host.isBusy() && proposal && J.sync.current(host.getProject(), host.getAudio(), snapshot) && row.start != null) host.audition(row.start, row.end); });
      info.append(audition); wrap.append(info); rows.append(wrap); selections.push({ index: source.index, input }); input.addEventListener('change', update);
    }
    review.append(rows); review.hidden = false; apply.hidden = !selections.some(s => !s.input.disabled); say(copy.done); update();
  };
  const applyRows = (selected, automatic = false) => {
    if (host.isBusy() || !proposal || !selected.length) return;
    const previous = proposal;
    try {
      const next = J.sync.apply(host.getProject(), previous.result, selected, previous.snapshot, host.getAudio());
      // Replanning refreshes this controller synchronously. Release the old snapshot first.
      proposal = null; applied = null;
      host.applySync(next);
      applied = { fingerprint: J.sync.fingerprint(host.getProject()), buffer: host.getAudio()?.buffer };
      const snapshot = J.sync.snapshot(host.getProject(), host.getPlan(), host.getAudio(), previous.snapshot.language);
      renderReview(previous.result, snapshot, [...previous.updated, ...selected]);
      say(automatic ? copy.automatic : copy.applied); update();
    } catch (error) { if (error.message === 'stale') invalidate(); else say(error.message === 'conflict' ? copy.conflict : copy.invalid, true); }
  };
  const accept = (job, operation) => {
    if (!job || typeof job.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(job.id) || !['queued', 'running', 'completed', 'failed', 'cancelled'].includes(job.status)) throw new Error('invalid');
    if (active !== operation || operation.generation !== generation) { removeJob(job.id); return; }
    if (operation.id && operation.id !== job.id) throw new Error('invalid');
    operation.id = job.id;
    if (host.isBusy() || !J.sync.current(host.getProject(), host.getAudio(), operation.snapshot)) { invalidate(); return; }
    if (job.status === 'completed') {
      J.sync.validateResult(job.result, operation.snapshot); active = null; progress.hidden = true;
      if (direct) {
        clearReview();
        if (!job.result.lines.length) { say(copy.noMatches, true); update(); return; }
        try {
          const next = J.sync.applyTranscript(host.getProject(), job.result, operation.snapshot, host.getAudio());
          applied = null; host.applyTranscript(next);
          applied = {fingerprint:J.sync.fingerprint(host.getProject()),buffer:host.getAudio()?.buffer};
          review.append(el('p','sync-help',(vi ? 'Đã tạo ' : 'Created ') + job.result.lines.length + (vi ? ' câu. ' : ' lines. ') + copy.transcriptHelp));
          if (job.result.warnings.includes('transcript_truncated')) review.append(el('p','sync-help sync-warnings',copy.truncated));
          review.hidden = false; say(copy.automatic); update();
        } catch (error) { if(error.message==='stale')invalidate();else {say(copy.invalid,true);update();} }
        return;
      }
      renderReview(job.result, operation.snapshot);
      applyRows(selections.filter(s => s.input.checked && !s.input.disabled).map(s => s.index), true); return;
    }
    if (job.status === 'failed' || job.status === 'cancelled') { active = null; progress.hidden = true; say(job.status === 'failed' ? copy.failed : copy.canceled, job.status === 'failed'); update(); return; }
    const stages = vi ? {queued:'Đang chờ',starting:'Đang khởi động',loading_model:'Đang tải mô hình nhận giọng',transcribing:'Đang nhận giọng',retrying_singing:'Đang nhận dạng lại giọng hát trên nền nhạc',loading_alignment_model:'Đang tải mô hình căn chỉnh',aligning:'Đang căn chỉnh giọng',matching:'Đang đối chiếu lời'} : {queued:'Queued',starting:'Starting local worker',loading_model:'Loading speech model',transcribing:'Transcribing audio',retrying_singing:'Retrying singing over music',loading_alignment_model:'Loading alignment model',aligning:'Aligning speech',matching:'Matching lyrics'};
    const stage = stages[job.stage] || (vi ? 'Đang xử lý audio' : 'Processing audio');
    progress.hidden = false;
    const value = typeof job.progress === 'number' && Number.isFinite(job.progress) ? Math.max(0, Math.min(1, job.progress)) : null;
    if (value != null) progress.value = value; else progress.removeAttribute?.('value');
    say(stage + (value == null ? '…' : ' · ' + Math.round(value * 100) + '%'));
    operation.timer = setTimeout(() => poll(operation), 1000); update();
  };
  const failed = (error, operation) => {
    if (active !== operation) return;
    if (operation.id) removeJob(operation.id);
    active = null; progress.hidden = true; say(error.message === 'invalid' ? copy.invalid : error.message === 'busy' ? copy.busy : copy.failed, true); update();
  };
  const json = async response => { if (!response.ok) throw new Error(response.status === 409 ? 'busy' : 'failed'); return JSON.parse(await response.text()); };
  const poll = async operation => {
    if (active !== operation) return;
    try { accept(await json(await fetch('/api/sync/jobs/' + encodeURIComponent(operation.id), { credentials: 'same-origin' })), operation); }
    catch (error) { failed(error, operation); }
  };
  start.addEventListener('click', async () => {
    if (host.isBusy() || active || !available || checking) return;
    let snapshot; try { snapshot = validSnapshot(); } catch (_) { say(copy.need, true); return; }
    clearReview(); const operation = { snapshot, generation: ++generation, id: null, timer: null }; active = operation; say(copy.uploading); update();
    try {
      const metadata = direct ? {mode:'transcribe',language:snapshot.language,lines:[]} : {language:snapshot.language,lines:snapshot.lines};
      const form = new FormData(); form.append('metadata', JSON.stringify(metadata)); form.append('audio', J.sync.wav(snapshot.buffer), 'current-audio.wav');
      // Keep the POST response observable after cancellation: its eventual ID must be deleted.
      accept(await json(await fetch('/api/sync/jobs', { method: 'POST', body: form, credentials: 'same-origin' })), operation);
    } catch (error) { failed(error, operation); }
  });
  cancel.addEventListener('click', () => invalidate(copy.canceled));
  apply.addEventListener('click', () => {
    if (host.isBusy() || !proposal) return;
    const selected = selections.filter(s => s.input.checked && !s.input.disabled).map(s => s.index);
    applyRows(selected);
  });
  undo.addEventListener('click', () => {
    if (!applied || host.isBusy() || active || typeof host.undoSync !== 'function') return;
    if (!J.sync.current(host.getProject(), host.getAudio(), applied)) { invalidate(); return; }
    applied = null; clearReview(); host.undoSync(); say(copy.undone); update();
  });
  const check = async () => {
    checking = true; say(copy.checking); update();
    try { const r = await json(await fetch('/api/sync/status', { credentials: 'same-origin' })); available = r.available === true && r.engine === 'whisperx'; }
    catch (_) { available = false; }
    checking = false; say(available ? copy.ready : copy.unavailable, !available); update();
  };
  retry.addEventListener('click', check);
  const heartbeat = setInterval(refresh, 500);
  window.addEventListener('pagehide', () => { invalidate(copy.canceled); clearInterval(heartbeat); });
  check();
  return { refresh, invalidate };
};
})();
