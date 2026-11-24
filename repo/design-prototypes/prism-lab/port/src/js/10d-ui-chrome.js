/* ================= 10d · UI: top bar chrome (project selector, tabs, busy, status chips, skin switcher, back) ================= */
function renderChrome() { const W = M; if (!W) return; const p = W.project;
  const pn = $('#projName'), t = p ? p.title : '未打开工程'; if (pn.textContent !== t) { pn.textContent = t; } $('#projBtn').title = p ? '当前工程 · ' + p.title + ' · 点击切换' : '打开或新建工程';
  $('#projBtn').classList.toggle('empty', !p);
  $('#backBtn').hidden = W.host !== 'dsh';
  const pc = $('#plazaCnt'), pt = W.counts.plazaTemplates ? String(W.counts.plazaTemplates) : ''; if (pc.textContent !== pt) pc.textContent = pt;
  // busy (any non-empty string → visible indicator)
  const b = $('#busy'), bt = W.busy; b.hidden = !bt; if (bt) { const tx = $('#busyTx'); if (tx.textContent !== bt) tx.textContent = bt; b.title = bt; }
  document.body.classList.toggle('is-busy', !!bt);
  // status chips → openPanel
  const s = W.status, ag = id => agentOf(W, id).status === 'running', live = S.run.live;
  chip('#stLlm', s.llm.configured ? (live && (ag('director') || ag('motion')) ? 'busy' : 'ok') : 'warn', s.llm.configured ? (s.llm.label || '已连接') : '未配置', '大模型 · ' + (s.llm.configured ? (s.llm.label || '已连接') : '未配置 · 点击设置'));
  chip('#stTts', s.tts.ready ? (live && ag('audio') ? 'busy' : 'ok') : 'idle', s.tts.label || (s.tts.ready ? '就绪' : '未就绪'), '配音引擎 · ' + (s.tts.label || '') + (s.tts.ready ? ' · 就绪' : ' · 未就绪'));
  chip('#stGpu', W.lowSpec ? 'warn' : live && (ag('qa') || ag('motion')) ? 'busy' : 'ok', W.lowSpec ? '低配保护' : (s.gpu.label || 'CPU'), '算力 · ' + (s.gpu.label || 'CPU 模式') + (W.lowSpec ? ' · 低配保护已开启' : '') + (s.gpu.lowSpecMode ? ' · 模式 ' + s.gpu.lowSpecMode : ''));
  chip('#stLip', s.lipsync.ready ? (live && ag('avatar') ? 'busy' : 'ok') : 'idle', s.lipsync.label || (s.lipsync.ready ? '就绪' : '未启用'), '口型引擎 · ' + (s.lipsync.label || '未启用'));
  const sk = SKINS.find(x => x.id === W.skin) || SKINS[2]; $('#skinBtn b').textContent = sk.short; $('#skinBtn').title = '作战大屏皮肤 · ' + sk.short + ' ' + sk.name + ' · 点击切换';
  fitTopbar(); }
function chip(sel, st, val, title) { const el = $(sel); if (!el) return; const d = qs(el, '.dot'), v = qs(el, 'b'); const cls = 'dot ' + st; if (d.className !== cls) d.className = cls; if (v.textContent !== val) v.textContent = val;
  el.title = title + ' · 点击打开'; el.setAttribute('aria-label', title); }
// progressive collapse of the top bar so nothing ever overflows (labels → values → chips)
function fitTopbar() { const tb = $('#topbar'), cls = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']; cls.forEach(c => tb.classList.remove(c));
  const over = () => tb.scrollWidth > tb.clientWidth + 1 || [...tb.children].some(el => !el.hidden && el.offsetParent && el.getBoundingClientRect().right > tb.getBoundingClientRect().right + .5);
  for (const c of cls) { if (!over()) break; tb.classList.add(c); } }
// status chips → native panels: 模型 / 配音 → 设置 · 模型与密钥 (tab), 算力 → 算力体检, 口型 → 数字人
const CHIP_PANEL = {stLlm:['keys', {tab:'llm'}], stTts:['keys', {tab:'tts'}], stGpu:['hardware', {}], stLip:['avatar', {}]};
function bindChrome() {
  $('#backBtn').onclick = () => act('backToChat', {});
  $('#projBtn').onclick = e => { e.stopPropagation(); openProjects(); };
  $$('#tabs .tab').forEach(b => b.onclick = () => { const k = b.dataset.tab; closeAll(); if (k === 'ops') { const pk = KIT(); if (pk) pk.closeAll(); syncTabs(); return; } openPanel(k); });
  $$('#status .sl').forEach(b => b.onclick = () => { const p = CHIP_PANEL[b.id]; if (p) openPanel(p[0], p[1]); });
  $('#skinBtn').onclick = e => { e.stopPropagation(); openSkins(); };
  $('#toolsBtn').onclick = e => { e.stopPropagation(); openTools(); };
  $('#themeBtn').onclick = toggleTheme;
  $$('#camSeg button').forEach(b => b.onclick = () => { S.cam.manual = true; setCam(b.dataset.cam); });
  $('#hudCap').onclick = () => $('#sheet').classList.contains('open') ? closeAll() : openSheet();
}
