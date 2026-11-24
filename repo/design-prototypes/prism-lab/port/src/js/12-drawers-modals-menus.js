/* ================= 12 · MENUS · MODALS (every tool / setting is a NATIVE kit panel — see 14b-kit.js; nothing is simulated) ================= */
// the skin's own previews (library asset · cloud result · 3×3 contact sheet) also live in a kit frame: one modal system, one look
let skinFrame = null;
function closeAll(keepScrim) { const sh = $('#sheet'); if (sh.classList.contains('open')) { flushDir(); sh.classList.remove('open'); } $('#hud').classList.remove('open');
  if (skinFrame) { const f = skinFrame; skinFrame = null; try { f.close('api'); } catch (e) {} }
  const m = $('#modal'); if (m.classList.contains('open')) { m.querySelectorAll('video,audio').forEach(v => { try { v.pause(); } catch (e) {} }); m.classList.remove('open'); }
  closeMenu(); S.modalTick = null;
  if (!keepScrim) $('#scrim').classList.remove('on'); }
function closeMenu() { const m = $('#menu'); if (!m.classList.contains('open')) return; m.classList.remove('open'); m._kind = null; ['#toolsBtn', '#projBtn', '#skinBtn', '#fSel'].forEach(s => { const el = $(s); if (!el) return; el.classList.remove('on'); el.setAttribute('aria-expanded', 'false'); }); }
const anyOpen = () => !!document.querySelector('.sheet.open,.modal.open,.menu.open') || !!skinFrame;
function openMenu(kind, trigger, inner, width) { const m = $('#menu'); if (m.classList.contains('open') && m._kind === kind) { closeMenu(); return null; } closeAll();
  m._kind = kind; m.className = 'menu m-' + kind; m.innerHTML = inner; const w = Math.min(width, window.innerWidth - 16); m.style.width = w + 'px';
  const r = trigger.getBoundingClientRect(); m.style.top = (r.bottom + 8) + 'px'; m.style.left = clamp(kind === 'projects' ? r.left : r.right - w, 8, window.innerWidth - w - 8) + 'px';
  m.style.maxHeight = (window.innerHeight - r.bottom - 20) + 'px'; m.classList.add('open'); trigger.classList.add('on'); trigger.setAttribute('aria-expanded', 'true');
  const f = m.querySelector('button:not([disabled])'); if (f && document.activeElement && document.activeElement.closest && document.activeElement.closest('#topbar')) setTimeout(() => f.focus(), 30); return m; }
// quick project picker (the skin's own); 新建 / 管理 go to the native kit panels
function openProjects() { const W = M; if (!W) return; const cur = W.project && W.project.dir, ps = W.projects.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const day = s => { const d = new Date(s); return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const m = openMenu('projects', $('#projBtn'), `<div class="mh"><span>工程 · PROJECTS</span><b>${ps.length}</b></div><div class="m-list" id="mList">${ps.length ? ps.map((p, i) => `<button class="mp${p.dir === cur ? ' on' : ''}" role="menuitem" data-dir="${esc(p.dir)}" title="${esc(p.title)}"><i class="no">${p2(i + 1)}</i><b>${esc(p.title)}</b><span>${p.engine === 'html' ? 'HTML5' : 'Remotion'}${p.hasMp4 ? ' · 已出片' : ''}${day(p.updatedAt) ? ' · ' + day(p.updatedAt) : ''}</span>${p.dir === cur ? '<i class="pill ok">当前</i>' : ''}</button>`).join('') : '<div class="m-none">还没有工程 · 新建一个，写一句创意就能出片</div>'}</div>
    <div class="m-foot"><button class="btn pri" role="menuitem" id="mNew">${icon('plus')}新建工程</button><button class="btn" role="menuitem" id="mAll">${icon('folder')}管理工程…</button></div>`, 400);
  if (!m) return; m.onclick = e => { const b = e.target.closest('.mp'); if (b) { closeMenu(); if (b.dataset.dir !== cur) act('selectProject', {dir:b.dataset.dir}); return; }
    if (e.target.closest('#mNew')) openPanel('newProject'); else if (e.target.closest('#mAll')) openPanel('projects'); };
  const L = qs(m, '#mList'); L.addEventListener('scroll', () => clipLater(L), {passive:true}); clipLater(L); }
function openFilterMenu() { const t = $('#fSel'); if (!t) return; const fl = FILTERS.filter(([k]) => k === 'all' || rackCounts[k]);
  const m = openMenu('filter', t, `<div class="mh"><span>按类型筛选</span></div>${fl.map(([k, n]) => `<button class="mf${rackFilter === k ? ' on' : ''}" role="menuitemradio" aria-checked="${rackFilter === k}" data-f="${k}"><span>${n}</span><i>${rackCounts[k] || 0}</i></button>`).join('')}`, 200);
  if (!m) return; m.style.left = clamp(t.getBoundingClientRect().left, 8, window.innerWidth - 208) + 'px';
  m.onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; closeMenu(); rackFilter = b.dataset.f; LS.set('filter', rackFilter); renderRack(true); }; }
// A / B / C only (the classic UI is gone)
function openSkins() { const cur = M ? M.skin : SKIN_ID;
  const m = openMenu('skins', $('#skinBtn'), `<div class="mh"><span>作战大屏皮肤 · SKINS</span><b>A · B · C</b></div>${SKINS.map(s => `<button class="ms${s.id === cur ? ' on' : ''}" role="menuitemradio" aria-checked="${s.id === cur}" data-skin="${s.id}"><i class="sw" style="background:${s.bg};box-shadow:inset 0 0 0 3px ${s.sw}"></i><b>${s.short} · ${s.name}</b><span>${s.en}${s.id === SKIN_ID ? ' · 默认' : ''}</span>${s.id === cur ? icon('check') : ''}</button>`).join('')}`, 300);
  if (!m) return; m.onclick = e => { const b = e.target.closest('[data-skin]'); if (!b) return; closeMenu(); if (b.dataset.skin === cur) return; flushDir(); act('setSkin', {skin:b.dataset.skin}); }; }
// LAB TOOLS — the prototype's tile wall, every tile a native kit panel
const TOOLS = [['reference', '参考复刻', 'REFERENCE REMAKE', 'ref'], ['teleprompter', '提词器录制', 'TELEPROMPTER', 'tele'], ['avatar', '数字人', 'AVATAR · LIP-SYNC', 'avatar'],
  ['voices', '配音中心', 'VOICE LIBRARY', 'voice'], ['cloud', '云端媒体', 'CLOUD MEDIA', 'cloud'], ['hardware', '算力体检', 'HARDWARE', 'chip'],
  ['brand', '品牌套件', 'BRAND KIT', 'brand'], ['export', '发布包导出', 'PUBLISH PACK', 'pack'], ['history', '版本历史', 'HISTORY · SAFETY', 'history'],
  ['keys', '模型与密钥', 'LLM · TTS · CLOUD', 'key'], ['projects', '视频工程', 'PROJECTS', 'folder'], ['help', '使用帮助', 'HELP · KEYS', 'help']];
function toolMeta(k) { if (!M) return ''; const s = M.status;
  if (k === 'keys') return s.llm.configured ? '<i class="tm ok">已连接</i>' : '<i class="tm warn">未配置</i>';
  if (k === 'voices') return M.counts.voices ? `<i class="tm">${M.counts.voices}</i>` : '';
  if (k === 'avatar') return s.lipsync.ready ? '<i class="tm ok">口型就绪</i>' : '';
  if (k === 'hardware') return M.lowSpec ? '<i class="tm warn">低配保护</i>' : '';
  if (k === 'reference') return M.flags.ref ? '<i class="tm ok">已分析</i>' : '';
  if (k === 'history') return M.flags.history ? `<i class="tm">${M.flags.history}</i>` : '';
  if (k === 'projects') return M.projects.length ? `<i class="tm">${M.projects.length}</i>` : '';
  return ''; }
function openTools() { const low = !!(M && M.lowSpec), pk = KIT(), has = id => !pk || !pk.panels || pk.panels.has(id);
  const m = openMenu('tools', $('#toolsBtn'), `<div class="mh"><span>实验工具 · LAB TOOLS</span><b>T</b></div><div class="tiles">${TOOLS.map((t, i) => `<button class="tile${has(t[0]) ? '' : ' soon'}" role="menuitem" data-panel="${t[0]}" title="${has(t[0]) ? t[1] : t[1] + ' · 面板接入中'}"><span class="th">${icon(t[3])}<i class="no">${p2(i + 1)}</i>${toolMeta(t[0])}</span><b>${t[1]}</b><span class="en">${t[2]}</span></button>`).join('')}</div>
    <div class="m-sw"><button class="msw" role="menuitemcheckbox" aria-checked="${low}" id="mLow"><span class="toggle${low ? ' on' : ''}" aria-hidden="true"></span><b>低配保护</b><span>≤ 30 FPS · 关闭景深与粒子</span></button>
      <button class="msw" role="menuitemcheckbox" aria-checked="${S.dark}" id="mDark"><span class="toggle${S.dark ? ' on' : ''}" aria-hidden="true"></span><b>熄灯模式</b><span>暗场 · 光束加色发光</span></button></div>`, 480);
  if (!m) return; m.onclick = e => { const t = e.target.closest('.tile'); if (t) { openPanel(t.dataset.panel); return; }
    if (e.target.closest('#mLow')) { closeMenu(); act('setLowSpec', {on:!low}); } else if (e.target.closest('#mDark')) { closeMenu(); toggleTheme(); } }; }
// a skin modal in a kit frame (fallback: the old #modal when kit.js is missing)
function openModal(title, en, body, after, tick, width, foot) { closeAll(true); const pk = KIT();
  if (pk && pk.frame) { const f = pk.frame({kind:'modal', title, en, class:'pl-frame', size:(width || 920) >= 880 ? 'lg' : 'md',
      onClose: () => { f.body.querySelectorAll('video,audio').forEach(v => { try { v.pause(); } catch (e) {} }); if (skinFrame === f) { skinFrame = null; S.modalTick = null; } } });
    f.el.style.maxWidth = Math.min(width || 920, window.innerWidth - 32) + 'px'; f.body.innerHTML = body; if (foot) { const ft = html('div', 'md-f', foot); f.setFoot([ft]); }
    skinFrame = f; if (after) after(f.el); S.modalTick = tick || null; return f; }
  const m = $('#modal'); m.style.width = Math.min(width || 920, window.innerWidth - 32) + 'px';
  m.innerHTML = `<div class="md-h"><div class="pt"><b title="${esc(title)}">${esc(title)}</b><span class="mono" title="${esc(en)}">${esc(en)}</span></div><button class="x" title="关闭 · Esc" aria-label="关闭">${icon('x')}</button></div><div class="md-b">${body}${foot ? `<div class="md-f">${foot}</div>` : ''}</div>`;
  m.setAttribute('aria-label', title); qs(m, '.x').onclick = () => closeAll(); m.classList.add('open'); $('#scrim').classList.add('on'); if (after) after(m); S.modalTick = tick || null; setTimeout(() => { const x = qs(m, '.x'); if (x) x.focus(); }, 40); return null; }
// local media preview of a library / staging item (same-origin URLs from the state)
function openAssetModal(A) { const K = KIND[A.kind] || KIND.other, url = A.url || '', kind = A.kind, st = A.staged;
  const media = !url ? (A.thumb ? `<img src="${esc(A.thumb)}" alt="">` : '<div class="md-none">该素材没有可预览的文件</div>')
    : kind === 'image' ? `<img src="${esc(url)}" alt="${esc(A.name)}">` : kind === 'video' || kind === 'host_video' ? `<video src="${esc(url)}" controls playsinline preload="metadata"${A.thumb ? ` poster="${esc(A.thumb)}"` : ''}></video>`
    : kind === 'music' || kind === 'sfx' || kind === 'voice' ? `<div class="md-aud"><canvas id="audArt" width="880" height="220"></canvas><audio src="${esc(url)}" controls preload="metadata"></audio></div>` : `<div class="md-none">该类型暂不支持预览 · <b>${esc(A.name)}</b></div>`;
  const used = (A.used || []).map(i => SCENES[i]).filter(Boolean);
  const info = st ? [st.provider, st.prompt].filter(Boolean).join(' · ') : assetSub(A);
  openModal(A.name, (st ? '云端生成 · 待确认' : K.cn) + (info ? ' · ' + info : ''), `<div class="player">${media}</div>`,
    m => { m.querySelectorAll('#mdClose').forEach(b => b.onclick = () => closeAll()); m.querySelectorAll('[data-sc]').forEach(b => b.onclick = () => { closeAll(); openPanel('studio', {step:'scenes', sceneId:b.dataset.sc}); });
      if (st) { qs(m, '#mdOk').onclick = () => { closeAll(); act('confirmStaging', {stagingId:st.id}); }; qs(m, '#mdNo').onclick = () => { closeAll(); act('discardStaging', {stagingId:st.id}); }; }
      const cv = qs(m, '#audArt'); if (cv) { const c = cv.getContext('2d'); c.scale(2, 2); drawArt(c, 440, 110, artOf(A), 0); } }, null, 860,
    `${used.length ? `<span class="mono">被 ${used.length} 个分镜引用</span>${used.slice(0, 6).map(s => `<button class="chip" data-sc="${esc(s.id)}" title="在分步精修中打开 · ${esc(s.title)}">S${String(s.no).padStart(2, '0')}</button>`).join('')}` : `<span class="mono">${st ? '确认入库后即可在分镜中使用' : '尚未被分镜引用'}</span>`}
      <span class="spacer"></span>${st ? `<button class="btn pri" id="mdOk">${icon('check')}确认入库</button><button class="btn" id="mdNo">${icon('trash')}丢弃</button>` : ''}<button class="btn" id="mdClose">关闭</button>`); }
// 3×3 contact sheet from the real scene thumbnails (or the finder animatic when a scene has no thumbnail yet)
function openContactSheet() { if (!SCENES.length) { toast('暂无分镜 · 出片后可查看 3×3 抽帧', 'info'); return; }
  const ts = Array.from({length:9}, (_, i) => (i + .5) / 9 * PROJ.dur), ar = projAspect();
  openModal('3×3 抽帧', 'CONTACT SHEET · 9 FRAMES · ' + (M && M.project ? M.project.title : ''), `<div class="sheet9" style="--ar:${ar.toFixed(4)}">${ts.map((t, i) => { const s = sceneAt(t);
      return `<button data-t="${t.toFixed(3)}" title="跳转到 ${secs(t)} · ${esc(s.title)}"><canvas width="${ar >= 1 ? 560 : Math.round(315 * ar)}" height="${ar >= 1 ? Math.round(560 / ar) : 315}"></canvas><span class="tc">${secs(t)}</span></button>`; }).join('')}</div>`,
    m => m.querySelectorAll('.sheet9 button').forEach(b => { const cv = qs(b, 'canvas'), c = cv.getContext('2d'), t = +b.dataset.t; c.scale(2, 2); drawFilm(c, 0, 0, cv.width / 2, cv.height / 2, t, {noFlash:true, px:.5, top:22});
      b.onclick = () => { closeAll(); seekFilm(t); }; }), null, ar >= 1 ? 900 : 620); }
// keyboard list → the native 使用帮助 panel (shortcuts handed to the kit in 14b-kit.js)
function openKeys() { openPanel('help'); }
