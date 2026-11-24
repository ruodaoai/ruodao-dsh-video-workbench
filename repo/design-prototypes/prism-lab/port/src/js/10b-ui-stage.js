/* ================= 10b · UI: element labels (collision-free placement), viewfinder controls + real MP4, banner, onboarding, agent card ================= */
const LBL = {};
function buildLabels() { AGENTS.forEach(a => { const el = html('div', 'alabel'); el.style.setProperty('--ac', a.c); el.setAttribute('role', 'button'); el.tabIndex = 0;
  el.innerHTML = `<div class="r1"><i class="sw" aria-hidden="true"></i><span class="no">${String(a.idx + 1).padStart(2, '0')}</span><span class="nm">${a.name}</span><span class="st idle">待命</span></div><div class="en">${a.en} · ${a.el.split(' · ')[0]}</div><div class="tk"></div><div class="bar"><i></i></div>`;
  el.addEventListener('click', () => focusAgent(a.id)); el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusAgent(a.id); } });
  D.labels.appendChild(el); LBL[a.id] = {el, st:qs(el, '.st'), tk:qs(el, '.tk'), last:'', dirty:true, w:0, h:0}; });
  const s = html('div', 'src-label', '<span>SRC · 素材光源</span>'); s.setAttribute('aria-hidden', 'true'); D.labels.appendChild(s); LBL.src = {el:s, dirty:true, w:0, h:0, src:true}; }
const flashLabel = id => { const L = LBL[id]; if (L && L.el.isConnected && !S.reduce) L.el.animate([{boxShadow:'0 0 0 5px rgba(47,55,255,.35)'}, {boxShadow:'0 0 0 0 rgba(47,55,255,0)'}], {duration:700, easing:'ease-out'}); };
// stage-relative rects of DOM things labels must never cover
function stageObstacles() { const out = [], add = (el, pad = 4) => { if (!el || el.hidden || !el.offsetParent) return; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < .05) return;
    const r = el.getBoundingClientRect(); if (r.width > 1 && r.height > 1) out.push([r.left - stageRect.left - pad, r.top - stageRect.top - pad, r.right - stageRect.left + pad, r.bottom - stageRect.top + pad]); };
  add($('#hudCap'), 6); add(D.vfCtl); if (PROJ.has) { const v = vfRect(), a = w2s(v.x - 9, v.y - 9 - wfs(12) * 1.6), b = w2s(v.x + v.w + 9, v.y + v.h + 9); out.push([a[0] - 4, a[1] - 4, b[0] + 4, b[1] + 4]); } add($('#agentCard.open')); add($('#readyBanner.on')); add($('#pauseStamp.on')); add($('#onboard.on .ob-card'), 8); $$('#stage .corner:not(.off)').forEach(c => add(c)); return out; }
let HB = null;
function updateLabels() {
  const compact = S.cam.z < .6 || stageW < 640, dofOn = (S.cam.mode !== 'overview' || S.cam.user), obs = stageObstacles(), placed = [], W = stageW, H = stageH;
  const fits = r => r[0] >= 4 && r[1] >= 4 && r[2] <= W - 4 && r[3] <= H - 4 && !hitsAny(r, obs) && !hitsAny(r, placed);
  const pr = a => (S.cam.user === a.id ? 0 : S.run.active === a.id ? 1 : ['run', 'err', 'pause'].includes(S.ag[a.id].st) ? 2 : 3) * 10 + a.idx;
  const order = AGENTS.slice().sort((a, b) => pr(a) - pr(b));
  order.forEach(a => { const L = LBL[a.id], st = S.ag[a.id];
    const key = st.st + '|' + st.task + '|' + compact; if (key !== L.last) { L.last = key; L.dirty = true; L.st.className = 'st ' + st.st; L.st.textContent = STN[st.st] || '待命'; L.tk.textContent = st.task; L.tk.title = st.task;
      L.el.classList.toggle('compact', compact); L.el.setAttribute('aria-label', a.name + ' · ' + (STN[st.st] || '待命') + ' · ' + st.task); }
    if (L.dirty) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; L.dirty = false; }
    const lw = L.w, lh = L.h, c = w2s(a.x, a.y), rr = PR * S.cam.z * 1.12 + 8;
    const cand = {below:[c[0] - lw / 2, c[1] + rr], above:[c[0] - lw / 2, c[1] - rr - lh], left:[c[0] - rr - lw, c[1] - lh / 2], right:[c[0] + rr, c[1] - lh / 2]};
    const pref = a.id === 'reference' ? ['left', 'above', 'below', 'right'] : a.id === 'cloud' ? ['right', 'above', 'below', 'left'] : ['below', 'above', a.x < WORLD.cx ? 'left' : 'right', a.x < WORLD.cx ? 'right' : 'left'];
    let pos = null; for (const k of pref) { const p = cand[k], r = [p[0], p[1], p[0] + lw, p[1] + lh]; if (fits(r)) { pos = p; placed.push([r[0] - 4, r[1] - 4, r[2] + 4, r[3] + 4]); break; } }
    L.el.classList.toggle('gone', !pos || !PROJ.has); if (pos) L.el.style.transform = `translate(${Math.round(pos[0])}px,${Math.round(pos[1])}px)`;
    L.el.style.setProperty('--p', (st.p || 0).toFixed(3)); L.el.classList.toggle('sel', S.cam.user === a.id); L.el.classList.toggle('act', S.run.active === a.id && S.run.live);
    L.el.classList.toggle('blur', dofOn && S.cam.focus !== a.id && S.cam.dof > 2); });
  const Ls = LBL.src; if (Ls.dirty) { Ls.w = Ls.el.offsetWidth; Ls.h = Ls.el.offsetHeight; Ls.dirty = false; }
  const sp = w2s(SOURCE.x - 40, SOURCE.y + 26), sr = [sp[0], sp[1], sp[0] + Ls.w, sp[1] + Ls.h], ok = fits(sr) && PROJ.has;
  Ls.el.classList.toggle('gone', !ok); if (ok) Ls.el.style.transform = `translate(${Math.round(sp[0])}px,${Math.round(sp[1])}px)`; }

/* ---- viewfinder controls + real preview video (drawn into the finder canvas; 9:16 letterboxed) ---- */
const V = D.video; let pvUrl = '', userMuted = LS.get('muted', '1') !== '0';
V.loop = true; V.muted = true; V.playsInline = true;
V.addEventListener('loadeddata', () => { redrawSoon(); if (pvSeek != null) { try { V.currentTime = pvSeek; } catch (e) {} pvSeek = null; } });
// only when the user asked to play: a project switch can abort / miss the old preview, which is not worth an alarm
V.addEventListener('error', () => { if (pvUrl && S.film.play) toast('成片预览暂时无法播放，可在「分步精修」中查看', 'info'); });
let pvSeek = null;
let pvStarted = false;
V.addEventListener('playing', () => { pvStarted = true; });
function syncPreview() { const url = M && M.project && M.preview.hasMp4 ? M.preview.mp4Url : '';
  if (url === pvUrl) return; pvUrl = url; pvStarted = false; S.film.play = false; try { V.pause(); } catch (e) {} if (url) { V.src = url; try { V.load(); } catch (e) {} } else { V.removeAttribute('src'); try { V.load(); } catch (e) {} } }
const pvReady = () => !!pvUrl && V.readyState >= 2 && !S.run.live && S.film.mode === 'film' && !(S.finale && !S.finale.started);
function drawVideoFrame(c, r) { c.fillStyle = '#000'; c.fillRect(r.x, r.y, r.w, r.h);
  const po = !pvStarted && V.currentTime < .05 && M && M.preview.posterUrl ? img(M.preview.posterUrl) : null;
  try { if (po) drawImg(c, po, r.x, r.y, r.w, r.h, true); else drawImg(c, V, r.x, r.y, r.w, r.h, true); } catch (e) {} }
function playPreview(auto) { if (S.run.live) { toast('流水线运行中 · 完成后即可播放成片', 'info'); return; }
  S.film.play = true; S.film.mode = 'film'; if (!pvUrl) return; V.muted = auto ? true : userMuted;
  const p = V.play(); if (p && p.catch) p.catch(() => { V.muted = true; V.play().catch(() => { S.film.play = false; }); }); }
function pausePreview() { S.film.play = false; try { V.pause(); } catch (e) {} }
function togglePreview() { if (S.film.play) pausePreview(); else playPreview(false); }
function seekFilm(t) { t = clamp(t, 0, Math.max(0, PROJ.dur - .01)); S.film.t = t; if (!S.run.live) S.tl.ph = t;
  if (pvUrl) { if (V.readyState >= 1) { try { V.currentTime = Math.min(t, (V.duration || t + 1) - .01); } catch (e) {} } else pvSeek = t; } redrawSoon(); }
function stepFilm(dt) { if (!S.film.play || S.run.live) return;
  if (pvUrl && V.readyState >= 2) { S.film.t = V.currentTime || 0; if (V.paused && !V.ended) { /* externally paused */ } }
  else { const a = S.film.t; S.film.t += dt; if (S.film.t >= PROJ.dur) S.film.t = 0; beatCross(a, S.film.t); }
  S.tl.ph = clamp(S.film.t, 0, PROJ.dur); }
function updateVfCtl() { const el = D.vfCtl, r = vfRect(), top = w2s(r.x, r.y), p = w2s(r.x, r.y + r.h + 16), vwid = r.w * S.cam.z;
  const show = PROJ.has && p[1] > 40 && top[1] < stageH - 40, w = clamp(Math.max(300, vwid), 260, stageW - 16);
  el.classList.toggle('off', !show); if (!show) return;
  const h = el.offsetHeight || 30, x = clamp(p[0] + (vwid - w) / 2, 8, stageW - w - 8), y = clamp(p[1], 8, stageH - h - 8);
  el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`; if (el._w !== w) { el._w = w; el.style.width = w + 'px'; el.classList.toggle('narrow', w < 440); }
  el.classList.toggle('blur', (S.cam.mode !== 'overview' || S.cam.user) && S.cam.focus !== 'vf' && S.cam.dof > 2);
  const dur = pvUrl && V.duration > 0 && isFinite(V.duration) ? V.duration : PROJ.dur, ft = clamp(S.film.t, 0, dur), pct = dur ? ft / dur : 0;
  $('#vfBar').style.setProperty('--p', pct.toFixed(4)); $('#vfBar').setAttribute('aria-valuenow', Math.round(pct * 100));
  const tc = el._w < 380 || !PROJ.real ? secs(ft) : secs(ft) + ' / ' + secs(dur); if (el._tc !== tc) { el._tc = tc; $('#vfTc').textContent = tc; }
  const pl = $('#vfPlay use'), want = S.film.play ? '#i-pause' : '#i-play'; if (pl.getAttribute('href') !== want) pl.setAttribute('href', want);
  const mu = $('#vfMute use'), mw = userMuted ? '#i-mute' : '#i-sound'; if (mu.getAttribute('href') !== mw) mu.setAttribute('href', mw);
  $('#vfMute').disabled = !pvUrl; $('#vf9').disabled = !SCENES.length; $('#vfFull').disabled = !pvUrl || S.run.live; $('#vfPlay').disabled = S.run.live || (!pvUrl && !SCENES.length); $('#vfPrev').disabled = $('#vfNext').disabled = !SCENES.length; }
function bindVf() {
  $('#vfPlay').onclick = togglePreview; $('#tlPlay').onclick = togglePreview;
  $('#vfPrev').onclick = () => { if (!SCENES.length) return; const s = sceneAt(S.film.t); seekFilm(S.film.t - s.start > .4 ? s.start : (SCENES[s.i - 1] || s).start); };
  $('#vfNext').onclick = () => { if (!SCENES.length) return; const s = sceneAt(S.film.t); seekFilm((SCENES[s.i + 1] || s).start); };
  $('#vfMute').onclick = () => { userMuted = !userMuted; LS.set('muted', userMuted ? '1' : '0'); V.muted = userMuted; if (!userMuted && S.film.play && V.paused && pvUrl) V.play().catch(() => {}); };
  const bar = $('#vfBar'), seekAt = e => { const r = bar.getBoundingClientRect(), dur = pvUrl && V.duration > 0 && isFinite(V.duration) ? V.duration : PROJ.dur; seekFilm(clamp((e.clientX - r.left) / (r.width || 1), 0, 1) * dur); };
  bar.addEventListener('pointerdown', e => { seekAt(e); try { bar.setPointerCapture(e.pointerId); } catch (er) {} bar.onpointermove = seekAt; }); bar.addEventListener('pointerup', () => { bar.onpointermove = null; });
  bar.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seekFilm(S.film.t + (e.key === 'ArrowLeft' ? -2 : 2)); } });
  $('#vf9').onclick = openContactSheet; $('#vfFull').onclick = openCinema; }
/* ---- 全屏观看: the finished film full-window above the whole lab (kit cinema), then F = real fullscreen ---- */
function openCinema() { const pk = KIT();
  if (S.run.live) { toast('流水线运行中 · 完成后即可全屏观看成片', 'info'); return; }
  if (!pvUrl) { toast('还没有成片 · 一键出片完成后即可全屏观看', 'info'); return; }
  if (!pk || typeof pk.cinema !== 'function') { toast('面板内核未加载，请刷新页面后重试', 'warn'); return; }
  const at = V.readyState >= 1 ? V.currentTime || 0 : S.film.t, dur = (M && M.preview.durationSec) || (V.duration > 0 && isFinite(V.duration) ? V.duration : 0); pausePreview();
  pk.cinema({ src: pvUrl, poster: (M && M.preview.posterUrl) || '', title: (M && M.project && M.project.title) || '成片',
    sub: `${dur ? dur.toFixed(1) + ' 秒 · ' : ''}${PROJ.w}×${PROJ.h} · ${PROJ.fps}fps`, startAt: at, onClose: ({ time }) => { seekFilm(time); redrawSoon(); } }); }

/* ---- completion banner ---- */
function showBanner() { const b = $('#readyBanner'), p = M && M.project; if (!p) return; const dur = (M.preview.durationSec || PROJ.dur || 0).toFixed(1);
  b.innerHTML = `<div class="rb-l"><span class="mono">FINAL READY</span><b>成片就绪</b></div><div class="rb-m"><span class="t" title="${esc(p.title)}">${esc(p.title)}</span><span class="s">${dur}s · ${PROJ.w}×${PROJ.h} · ${PROJ.fps}fps</span></div>
    <div class="rb-b"><button class="btn pri" id="rbPlay">${icon('expand')}全屏观看</button><button class="btn" id="rbPack">${icon('pack')}导出发布</button><button class="btn ic" id="rbX" title="关闭" aria-label="关闭">${icon('x')}</button></div>`;
  b.className = 'on'; qs(b, '#rbPlay').onclick = () => { hideBanner(); seekFilm(0); openCinema(); }; qs(b, '#rbPack').onclick = () => openPanel('export'); qs(b, '#rbX').onclick = hideBanner;
  clearTimeout(b._t); b._t = setTimeout(hideBanner, 16000); placeBanner(); layoutCorners(); } // corners yield to the banner at once (no 300 ms overlap)
function hideBanner() { const b = $('#readyBanner'); if (b) { b.className = ''; clearTimeout(b._t); } }
function placeBanner() { const b = $('#readyBanner'); if (!b.classList.contains('on')) return; const w = b.offsetWidth, h = b.offsetHeight, ob = [];
  [$('#hudCap'), D.vfCtl.classList.contains('off') ? null : D.vfCtl, $('#agentCard.open')].forEach(el => { if (!el) return; const r = el.getBoundingClientRect(); ob.push([r.left - stageRect.left - 6, r.top - stageRect.top - 6, r.right - stageRect.left + 6, r.bottom - stageRect.top + 6]); });
  const v = vfRect(), va = w2s(v.x - 9, v.y - 9 - wfs(12) * 1.6), vb = w2s(v.x + v.w + 9, v.y + v.h + 9), vfr = [va[0], va[1], vb[0], vb[1]];
  const area = r => Math.max(0, Math.min(r[2], vfr[2]) - Math.max(r[0], vfr[0])) * Math.max(0, Math.min(r[3], vfr[3]) - Math.max(r[1], vfr[1]));
  const spots = [[12, stageH - h - 12], [12, 56], [stageW - w - 12, stageH - h - 12], [stageW - w - 12, 56]].filter(([x, y]) => x >= 0 && y >= 0 && !hitsAny([x, y, x + w, y + h], ob));
  const s = spots.sort((p, q) => area([p[0], p[1], p[0] + w, p[1] + h]) - area([q[0], q[1], q[0] + w, q[1] + h]))[0] || [12, Math.max(0, stageH - h - 12)];
  if (b._x !== s[0] || b._y !== s[1]) { b._x = s[0]; b._y = s[1]; b.style.left = s[0] + 'px'; b.style.top = s[1] + 'px'; } }

/* ---- onboarding (no project) ---- */
let obSig = '';
function renderOnboard() { const box = $('#onboard'), on = !M || !M.project; box.classList.toggle('on', on); document.body.classList.toggle('noproj', on); if (!on) { obSig = ''; return; }
  const ps = M ? M.projects.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 5) : [];
  const sig = (M ? 'M' : 'W') + (BRIDGE.parent ? 'p' : 's') + ps.map(p => p.dir + p.title + p.hasMp4).join('|'); if (sig === obSig) return; obSig = sig;
  if (!M) { box.innerHTML = `<div class="ob-card"><span class="ob-k">PRISM LAB · STANDBY</span><b class="ob-t">${BRIDGE.parent ? '正在连接宿主…' : '未连接宿主'}</b><p>${BRIDGE.parent ? '等待 DSH 视频工坊推送工程数据。' : '该页面需要在 DSH 视频工坊中打开，才能载入工程与 Agent 数据。'}</p></div>`; return; }
  const day = s => { const d = new Date(s); return isNaN(d) ? '' : (d.getMonth() + 1) + '月' + d.getDate() + '日'; };
  box.innerHTML = `<div class="ob-card"><span class="ob-k">NO SAMPLE LOADED · 未装入样片</span><b class="ob-t">棱镜尚未装入样片</b><p>新建一个视频工程，或打开已有工程，8 位 AI Agent 即刻就位。</p>
    <div class="ob-b"><button class="btn pri" id="obNew">${icon('plus')}新建工程</button><button class="btn" id="obOpen">${icon('folder')}打开工程</button></div>
    ${ps.length ? `<div class="ob-l"><span class="ob-h">最近工程</span>${ps.map(p => `<button class="ob-p" data-dir="${esc(p.dir)}" title="${esc(p.title)}"><b>${esc(p.title)}</b><span>${p.hasMp4 ? '已出片' : (p.engine === 'html' ? 'HTML5' : 'Remotion')}${day(p.updatedAt) ? ' · ' + day(p.updatedAt) : ''}</span></button>`).join('')}</div>` : ''}</div>`;
  qs(box, '#obNew').onclick = () => openPanel('newProject'); qs(box, '#obOpen').onclick = () => openPanel('projects');
  box.querySelectorAll('.ob-p').forEach(b => b.onclick = () => act('selectProject', {dir:b.dataset.dir})); }

/* ---- agent detail card ---- */
// each agent card jumps to the native panel where that agent's work is edited
const AG_PANEL = {director:['参数控制单', null], editor:['分步精修 · 素材', 'studio', {step:'assets'}], audio:['配音中心', 'voices'], motion:['分步精修 · 分镜', 'studio', {step:'scenes'}],
  qa:['分步精修 · 交付', 'studio', {step:'delivery'}], avatar:['数字人', 'avatar'], cloud:['云端媒体', 'cloud'], reference:['参考复刻', 'reference']};
function focusAgent(id) { if (S.cam.user === id) { S.cam.user = null; closeAgentCard(); return; } S.cam.user = id; showAgentCard(id); }
function closeAgentCard() { const c = $('#agentCard'); c.classList.remove('open'); c._id = null; }
function showAgentCard(id) { const a = AG[id], card = $('#agentCard'); if (!a) return; card._id = id; card.style.setProperty('--ac', a.c); renderAgentCard(); card.classList.add('open'); }
function renderAgentCard() { const card = $('#agentCard'), id = card._id; if (!id) return; const a = AG[id], st = S.ag[id], g = agentOf(M, id), io = AG_IO[id], pan = AG_PANEL[id];
  const logs = M ? M.logs.filter(l => l.agentId === id).slice(-3) : [];
  const sig = id + '|' + st.st + '|' + Math.round(st.p * 100) + '|' + st.task + '|' + logs.map(l => l.ts + l.text).join('|') + '|' + stageH; if (card._sig === sig) return; card._sig = sig;
  const run = S.run.on ? (RUN_CN[S.run.status] || '—') : '无任务';
  card.innerHTML = `<div class="ac-h"><i class="sw" aria-hidden="true"></i><div class="ac-t"><b>${a.name}</b><span>${a.en} · ${a.el.split(' · ')[0]}</span></div><button class="x" title="返回全景 · Esc" aria-label="关闭详情">${icon('x')}</button></div>
    <div class="ac-grid"><div><span>状态</span><b class="s-${st.st}">${STN[st.st] || '待命'}</b></div><div><span>进度</span><b>${g.status === 'skipped' ? '—' : Math.round(st.p * 100) + '%'}</b></div><div><span>本轮任务</span><b>${run}</b></div><div><span>光学元件</span><b>${a.el.split(' · ')[0]}</b></div></div>
    <div class="ac-body"><div class="ac-task"><span>当前子任务</span><p title="${esc(st.task)}">${esc(st.task)}</p></div>
      <div class="ac-io"><span>输入</span><em>${io[0]}</em><span>输出</span><em>${io[1]}</em></div>
      <div class="ac-log"><span>最近日志</span>${logs.length ? logs.map(l => `<p class="${l.level}" title="${esc(l.text)}">${esc(l.text)}</p>`).join('') : '<p class="none">暂无本轮日志</p>'}</div>
      <div class="ac-f"><button class="btn" id="acGo">${icon('arrow')}${pan[0]}</button></div></div>`;
  qs(card, '.x').onclick = () => focusAgent(id); qs(card, '#acGo').onclick = () => { if (pan[1]) openPanel(pan[1], pan[2]); else openSheet(); };
  // never let the card run past the stage: drop optional blocks until it fits
  const max = stageH - 64; ['.ac-log', '.ac-io', '.ac-task'].forEach(s => { if (card.offsetHeight > max) { const x = qs(card, s); if (x) x.remove(); } }); }

/* ---- HUD capsule + corners + pause stamp ---- */
const optLabel = (list, v) => { const o = (list || []).find(x => x.value === v); return o ? o.label : v; };
const SHORT = s => String(s || '').replace(/[（(].*?[）)]/g, '').trim();
function renderCapsule() { const d = M && M.director, el = $('#hudVals'); $('#hud').classList.toggle('off', !PROJ.has); if (!d) { el.innerHTML = ''; return; }
  const o = M.options, ar = d.aspectRatio === 'auto' ? 'AI 画幅' : d.aspectRatio, parts = [[ar, 'p0'], [optLabel(o.qualities, d.quality).split(' ')[0] || d.quality, 'p1'], [d.fps + 'fps', 'p2'], [d.engine === 'html' ? 'HTML5' : 'Remotion', 'p3'],
    [SHORT(optLabel(o.narrationModes, d.narrationMode)), 'p4'], [SHORT(optLabel(o.styles, d.style)), 'p5 dim']];
  const h2 = parts.map(([t, c]) => `<span class="${c}" title="${esc(t)}">${esc(t)}</span>`).join(''); if (el._h !== h2) { el._h = h2; el.innerHTML = h2; HB = null; fitCapsule(); } }
function fitCapsule() { const cap = $('#hudCap'); if (!cap) return; const spans = [...$('#hudVals').children]; spans.forEach(s => s.hidden = false);
  for (let i = spans.length - 1; i >= 1 && cap.offsetWidth > stageW - 40; i--) spans[i].hidden = true; }
function updateCorners() { if (!M) return; const cm = S.cam;
  const cr = $('#camRead'), crx = `<span class="sm">CAM ${(cm.z / cm.fit).toFixed(2)}×${cm.lock > .85 && cm.mode !== 'overview' ? ' · AF LOCK' : ''}</span><b>${cm.user ? '聚焦 · ' + AG[cm.user].name : {overview:'全景 OVERVIEW', follow:'跟随 FOLLOW', close:'微距 MACRO'}[cm.mode]}</b>`;
  if (cr._h !== crx) { cr._h = crx; cr.innerHTML = crx; }
  const br = $('#fpsRead'), brx = `<span class="sm">${window.__fps || 0} FPS · ${S.flights.filter(f => f.phase !== 'done').length} BEAMS</span><b class="${S.lowSpec || S.eco ? 'eco' : ''}">${S.lowSpec ? '低配保护 · 30 FPS' : S.eco ? 'ECO 自适应降级' : 'DSH · PRISM LAB'}</b>`;
  if (br._h !== brx) { br._h = brx; br.innerHTML = brx; }
  const bl = $('#benchRead'), a = S.run.active && AG[S.run.active], blx = `<span class="sm">SRC → 01–05 → VF · λ 400–700 nm</span><b>${S.run.live && a ? 'BEAM ON · ' + String(a.idx + 1).padStart(2, '0') + ' ' + a.name : S.run.status === 'failed' ? '光路中断 · 待重试' : S.run.status === 'completed' ? '白光汇聚 · 成片' : 'ALIGNED · 光路就绪'}</b>`;
  if (bl._h !== blx) { bl._h = blx; bl.innerHTML = blx; }
  $('#pauseStamp').classList.toggle('on', S.run.live && S.run.status === 'paused'); }
function layoutCorners() { // hide corner readouts that would touch the HUD capsule / finder controls / each other on small stages
  const cap = $('#hudCap').getBoundingClientRect(), vf = D.vfCtl.classList.contains('off') ? null : D.vfCtl.getBoundingClientRect(), card = $('#agentCard.open'), cardR = card ? card.getBoundingClientRect() : null,
    ban = $('#readyBanner.on'), banR = ban ? ban.getBoundingClientRect() : null, stp = $('#pauseStamp.on'), stpR = stp ? stp.getBoundingClientRect() : null;
  $$('#stage .corner').forEach(c => { c.classList.remove('off'); const r = c.getBoundingClientRect(), hit = o => o && r.left < o.right + 8 && r.right > o.left - 8 && r.top < o.bottom + 6 && r.bottom > o.top - 6;
    const small = (c.id === 'cTl' || c.id === 'camRead') ? stageW < 700 || stageH < 330 : stageH < 360 || stageW < 560;
    c.classList.toggle('off', small || !PROJ.has || hit(cap) || hit(vf) || hit(cardR) || hit(banR) || hit(stpR)); }); }
