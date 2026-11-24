/* ================= 10c · UI: task center (brief, run button, phases, controls, QA line, live log) ================= */
function buildTaskUI() { $('#phBar').innerHTML = CORE.map((id, i) => `<div class="ph-seg" data-ag="${id}" style="--ac:${AG[id].c}" title="${AG[id].name}"><div class="tr"><i></i></div><span>${String(i + 1).padStart(2, '0')} ${AG[id].name}</span></div>`).join(''); }
let lastUI = {};
const setTx = (id, v) => { if (lastUI[id] === v) return; lastUI[id] = v; const e = document.getElementById(id); if (e) e.textContent = v; };
function elapsedNow() { const R = S.run; if (!R.on) return 0; return R.el + (R.status === 'running' && R.elAt ? Math.min(5, (performance.now() - R.elAt) / 1000) : 0); }
function syncRunUI() {
  const R = S.run, has = PROJ.has, live = R.live, st = R.status, pct = R.on ? Math.round(st === 'completed' ? 100 : R.p || 0) : 0, a = R.active && AG[R.active];
  // run button: one-click run / resume / busy
  const btn = $('#runBtn'), cn = !has ? '先打开工程' : live ? (st === 'paused' ? '继续出片' : st === 'queued' ? '排队中…' : '运行中 · ' + pct + '%') : st === 'completed' ? '再出一版' : st === 'failed' || st === 'stopped' ? '重新出片' : '一键出片';
  const en = !has ? 'NO PROJECT' : live ? (st === 'paused' ? 'RESUME · R' : a ? a.en : 'QUEUED') : st === 'completed' ? 'RUN AGAIN' : 'RUN PIPELINE · 5 STAGES';
  setTx('runCn', cn); setTx('runEn', en); btn.classList.toggle('busy', live && st !== 'paused'); btn.classList.toggle('resume', live && st === 'paused'); btn.style.setProperty('--p', (R.on ? pct / 100 : 0).toFixed(3));
  btn.disabled = !has; btn.setAttribute('aria-label', cn); const ru = qs(btn, '.rb-arrow use'), rw = live && st !== 'paused' ? '#i-pause' : '#i-play'; if (ru.getAttribute('href') !== rw) ru.setAttribute('href', rw);
  // big readout + phase
  setTx('bigPct', String(pct).padStart(2, '0'));
  const ci = a ? CORE.indexOf(a.id) : -1, done = M ? CORE.filter(id => agentOf(M, id).status === 'done').length : 0;
  setTx('phaseNo', 'PHASE ' + String(st === 'completed' ? 5 : ci >= 0 ? ci + 1 : done).padStart(2, '0') + ' / 05');
  setTx('phaseName', !R.on ? (has ? '待命' : '未打开工程') : st === 'queued' ? '排队中' : st === 'paused' ? '已暂停' : st === 'failed' ? '执行失败' : st === 'stopped' ? '已停止' : st === 'completed' ? '成片就绪' : a ? a.name : '运行中');
  const pe = !R.on ? (has ? 'STANDBY · 写下创意后一键出片' : 'STANDBY') : st === 'failed' ? (R.err || R.msg || '执行失败') : (R.msg || (a ? a.en : '')); setTx('phaseEn', pe); $('#phaseEn').title = pe;
  $('#task').classList.toggle('failed', st === 'failed'); $('#task').classList.toggle('done', st === 'completed');
  // phase bar (5 core stages, real agent progress)
  $$('#phBar .ph-seg').forEach(el => { const g = M ? agentOf(M, el.dataset.ag) : {status:'idle', progress:0}, v = g.status === 'done' ? 1 : g.status === 'skipped' ? 1 : R.on ? pct01(g.progress) : 0;
    el.style.setProperty('--p', v.toFixed(3)); el.classList.toggle('on', R.active === el.dataset.ag && live); el.classList.toggle('skip', g.status === 'skipped'); el.classList.toggle('err', g.status === 'failed'); });
  // times
  const el = elapsedNow(); setTx('tEl', R.on ? mmss(el) : '00:00');
  setTx('tRem', live && st === 'running' && pct >= 3 && pct < 100 ? mmss(el * (100 - pct) / pct) : st === 'completed' ? '00:00' : '--:--');
  const tot = M && M.project ? (M.project.durationSec || (M.director.durationMode === 'custom' ? M.director.targetDurationSec : 0)) : 0; setTx('tTot', tot > 0 ? mmss(tot) : 'AI 自动');
  // controls
  const pb = $('#pauseBtn'); qs(pb, 'span').textContent = st === 'paused' ? '继续' : '暂停'; const pu = qs(pb, 'use'), pw = st === 'paused' ? '#i-play' : '#i-pause'; if (pu.getAttribute('href') !== pw) pu.setAttribute('href', pw);
  pb.disabled = !(st === 'running' || st === 'paused' || st === 'queued'); pb.classList.toggle('on', st === 'paused'); pb.setAttribute('aria-label', st === 'paused' ? '继续' : '暂停');
  $('#stopBtn').disabled = !live; $('#retryBtn').disabled = !(st === 'failed' || st === 'stopped'); $('#retryBtn').classList.toggle('sig', st === 'failed');
  $('#polishBtn').disabled = !has; $('#tasksBtn').disabled = false;
  // QA / render line (qa agent's message is the render/QA status — nothing invented)
  const q = M ? agentOf(M, 'qa') : null, qst = q ? ST_MAP[q.status] : 'idle';
  setTx('qaTag', !R.on ? (M && M.preview.hasMp4 ? '已有成片' : '—') : (STN[qst] || '—')); $('#qaTag').className = 's-' + qst;
  $('#qaFill').style.width = (q ? (q.status === 'done' ? 100 : q.status === 'skipped' ? 0 : q.progress) : 0) + '%';
  const qm = q && q.message ? q.message : !R.on ? (M && M.preview.hasMp4 ? '成片已就绪 · 可在取景器中预览' : '暂无渲染任务') : '等待质检渲染'; setTx('qaMsg', qm); $('#qaMsg').title = qm;
  $('#runId').textContent = R.on ? (RUN_CN[st] || '—') : has ? '待命' : '未打开工程'; $('#runId').className = 'pc s-' + (st || 'idle');
}
function bindTask() {
  $('#runBtn').onclick = runOrResume;
  $('#pauseBtn').onclick = () => { const st = S.run.status; if (st === 'paused') act('resume', {}); else if (st === 'running' || st === 'queued') act('pause', {}); };
  $('#stopBtn').onclick = () => { if (S.run.live) act('stop', {}); };
  $('#retryBtn').onclick = () => { if (S.run.status === 'failed' || S.run.status === 'stopped') act('retry', {}); };
  $('#tasksBtn').onclick = () => openPanel('tasks');
  $('#polishBtn').onclick = () => { flushDir(); act('polishTopic', {}); };
  $('#paramsBtn').onclick = () => openSheet();
  bindTopicBox($('#topicBox'));
  D.log.addEventListener('scroll', () => { logStick = D.log.scrollTop + D.log.clientHeight >= D.log.scrollHeight - 8; clipLater(D.log); }, {passive:true});
}
function runOrResume() { if (!PROJ.has) { openPanel('newProject'); return; } const st = S.run.status;
  if (st === 'paused') { act('resume', {}); return; } if (S.run.live) { toast('流水线正在运行 · 可暂停或停止', 'info'); return; }
  flushDir(); act('run', {}); } // the brief is saved by the big editor (setDirector) before; the host runs with its current brief
/* brief: a readable multi-line PREVIEW of director.topic (auto-height, clamped at whole lines with a fade + 「展开编辑」, char count).
   Click / Enter opens the kit's big editor PK.editTopic (灵感模板 · AI 润色 · 保存并一键出片). Nothing is typed in place, so a
   throttled state echo can never overwrite the user's text (BRIDGE rule 9 holds by construction). */
function editBrief() { if (!PROJ.has) { openPanel('newProject'); return; } const pk = KIT(); if (!pk || !pk.editTopic) { toast('大号编辑器未加载（kit.js），请刷新页面后重试', 'error'); return; }
  closeAll(); flushDir(); pk.editTopic(); }
function bindTopicBox(box) { if (!box) return; box.addEventListener('click', e => { if (!e.target.closest('button')) editBrief(); });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editBrief(); } }); }
function renderTopic(box) { if (!box) return; const t = M && M.project ? M.director.topic.trim() : '', n = Array.from(t).length, tx = qs(box, '.tp-tx');
  const v = t || (PROJ.has ? '写下你的创意：主题、受众、风格、节奏…… 一句话也能出片' : '新建或打开工程后，在这里写下创意');
  if (tx.textContent !== v) tx.textContent = v; box.classList.toggle('empty', !t); box.classList.toggle('off', !PROJ.has); box.setAttribute('aria-disabled', String(!PROJ.has));
  const cn = qs(box, '.tp-n'), ct = t ? n + ' 字' : '未填写'; if (cn.textContent !== ct) cn.textContent = ct;
  box.setAttribute('aria-label', '创意简报' + (t ? '（' + n + ' 字）' : '（未填写）') + ' · 点击放大编辑'); fitTopic(box); }
function fitTopic(box) { if (!box) return; const tx = qs(box, '.tp-tx'); box.classList.toggle('more', tx.scrollHeight > tx.clientHeight + 2); }
const renderTopics = () => { renderTopic($('#topicBox')); renderTopic($('#shTopicBox')); };
/* live log: append-only diff, auto-scroll unless the user scrolled up */
let logKeys = [], logStick = true;
const logKey = l => l.ts + '|' + l.agentId + '|' + l.text;
function logLine(l, anim) { const a = AG[l.agentId], el = html('div', 'll lv-' + l.level + (anim ? ' in' : '')); el.style.setProperty('--ac', a ? a.c : (l.level === 'error' ? '#FF5A1F' : '#7A7973'));
  el.innerHTML = `<span class="t">${esc(fmtClock(l.ts))}</span><i class="q" aria-hidden="true"></i><span class="x" title="${esc((a ? a.name + ' · ' : '') + l.text)}">${a ? `<b>${a.name}</b> · ` : ''}${esc(l.text)}</span>`; return el; }
function renderLogs() { const logs = M ? M.logs : [], keys = logs.map(logKey), box = D.log;
  const same = keys.length >= logKeys.length && logKeys.every((k, i) => k === keys[i]);
  const stick = logStick || box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
  if (same) { if (keys.length === logKeys.length) { clipLater(box); return; } logs.slice(logKeys.length).forEach(l => box.appendChild(logLine(l, true))); }
  else { // the ≤ 60 window slid: drop d old lines when old[d..] is a prefix of the new list, else rebuild
    let d = -1; for (let k = 1; k < logKeys.length; k++) { const n = logKeys.length - k; if (n <= keys.length && logKeys.slice(k).every((x, i) => x === keys[i])) { d = k; break; } }
    if (d > 0 && box.children.length === logKeys.length) { for (let i = 0; i < d; i++) box.removeChild(box.firstChild); logs.slice(logKeys.length - d).forEach(l => box.appendChild(logLine(l, true))); }
    else { box.innerHTML = ''; logs.forEach(l => box.appendChild(logLine(l, false))); } }
  logKeys = keys; $('#logCount').textContent = logs.length + ' 条'; if (stick) box.scrollTop = box.scrollHeight; logStick = stick; clipLater(box); }
