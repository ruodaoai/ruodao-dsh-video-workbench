/* ================= 14 · BRIDGE (postMessage contract v1 · lib/warroom/BRIDGE.md) ================= */
const BRIDGE = {parent:!!(window.parent && window.parent !== window), seq:0, pending:new Map(), states:0};
const ACT_CN = {run:'一键出片', pause:'暂停', resume:'继续', stop:'停止', retry:'重试', setDirector:'修改参数', polishTopic:'AI 润色', importFiles:'导入素材', removeAsset:'删除素材',
  confirmStaging:'确认入库', discardStaging:'丢弃', selectProject:'切换工程', newProject:'新建工程', openPanel:'打开面板', openScene:'打开分镜', setSkin:'切换皮肤', setLowSpec:'低配保护', backToChat:'返回对话'};
function post(msg, transfer) { if (!BRIDGE.parent) return false; const m = Object.assign({v:1}, msg);
  try { window.parent.postMessage(m, '*', transfer && transfer.length ? transfer : undefined); return true; }
  catch (e) { try { window.parent.postMessage(m, '*'); return true; } catch (e2) { return false; } } }
// send one user intent; opts: {ok: success toast text, fail(res), done(res), transfer:[ArrayBuffer], quiet: no error toast}
function act(action, payload, opts) { opts = opts || {}; const name = ACT_CN[action] || action;
  // need-llm: the kit already answers every such result with its own hint toast + opens 设置 · 模型与密钥 → no second toast here
  const finish = res => { if (res.ok) { if (opts.ok) toast(opts.ok, 'success'); } else { if (!opts.quiet && !res.timeout && !(res.code === 'need-llm' && KIT())) toast(res.error || name + '失败', 'error'); if (opts.fail) opts.fail(res); } if (opts.done) opts.done(res); };
  if (!BRIDGE.parent) { finish({ok:false, error:'未连接宿主 · 无法' + name}); return null; }
  const id = 'pl' + (++BRIDGE.seq).toString(36) + '-' + Date.now().toString(36);
  const rec = {action, finish, timer:0}; BRIDGE.pending.set(id, rec);
  rec.timer = setTimeout(() => { if (BRIDGE.pending.delete(id)) finish({ok:false, timeout:true}); }, action === 'importFiles' ? 900000 : 300000);
  if (!post({type:'dsh-vw/action', id, action, payload:payload || {}}, opts.transfer)) { BRIDGE.pending.delete(id); clearTimeout(rec.timer); finish({ok:false, error:name + '失败：无法连接宿主'}); return null; }
  return id; }
function onResult(m) { const rec = BRIDGE.pending.get(m.id); if (!rec) return; BRIDGE.pending.delete(m.id); clearTimeout(rec.timer); rec.finish({ok:!!m.ok, error:m.error ? String(m.error) : '', data:m.data, code:m.code ? String(m.code) : ''}); }
function onEvent(ev, data) { data = data || {};
  if (ev === 'toast') toast(data.text, data.level);
  else if (ev === 'focus-agent') { if (AG[data.agentId]) { flashLabel(data.agentId); S.ag[data.agentId].glow = Math.max(S.ag[data.agentId].glow, .6); redrawSoon(); } }
  else if (ev === 'asset-added') { setTimeout(() => flashCards(data.assetIds || []), 60); }
  else if (ev === 'run-finished') { const id = String(data.runId || ''); if (data.status === 'completed' && id) { finishedEv.add(id);
      if (!firstState && M && M.run && M.run.id === id && M.run.status === 'completed' && !celebrated.has(id)) { celebrated.add(id); runCompleted(); } } redrawSoon(); }
  else if (ev === 'run-started') redrawSoon(); }
function onState(raw) {
  let W; try { W = normState(raw); } catch (e) { console.warn('[prism-lab] bad state ignored', e); return; }
  const P = PREV, projChanged = !P || (P.project ? P.project.dir : '') !== (W.project ? W.project.dir : '');
  M = W; PREV = W; BRIDGE.states++;
  rebuildModel(W); syncShots();
  S.lowSpec = W.lowSpec; document.body.classList.toggle('low', W.lowSpec);
  onModel(W, P, projChanged); firstState = false;
  syncPreview(); renderChrome(); renderRack(projChanged); renderLogs(); renderTopics(); renderCapsule(); renderOnboard(); syncSheet(); renderTlStats();
  layoutTrackLabels(); if (projChanged) { syncZoomTick(); layout(); } redrawSoon(); stillDrawn = false; }
function renderTlStats() { const el = $('#tlStats'), p = M && M.project;
  const items = !p ? [] : [[PROJ.bpm ? Math.round(PROJ.bpm) : '—', 'BPM'], [SCENES.length, '镜头'], [SFX.length, '音效'], [PROJ.drops.length, '高潮'], [PROJ.w + '×' + PROJ.h, PROJ.fps + 'fps']];
  const h2 = items.map(([b, s], i) => `<span class="s${i}"><b>${esc(b)}</b> ${esc(s)}</span>`).join(''); if (el._h !== h2) { el._h = h2; el.innerHTML = h2; }
  const tt = ' / ' + tcode(PROJ.has && PROJ.real ? PROJ.dur : 0); setTx('tcTot', tt); $('#tlPlay').disabled = !PROJ.has || (!SCENES.length && !(M && M.preview.hasMp4)); }
window.addEventListener('message', ev => { if (!BRIDGE.parent || ev.source !== window.parent) return; const m = ev.data; if (!m || typeof m !== 'object' || typeof m.type !== 'string' || m.type.indexOf('dsh-vw/') !== 0) return;
  try { if (m.type === 'dsh-vw/state') onState(m.state); else if (m.type === 'dsh-vw/result') onResult(m); else if (m.type === 'dsh-vw/event') onEvent(String(m.event || ''), m.data); }
  catch (err) { console.warn('[prism-lab] message handling failed', err); } });
