/* ================= 10 · UI: toasts, sample rack (assets · staging · import) ================= */
const TOAST_MAX = 3;
// ONE toast renderer: the skin's cues go through the kit's toast layer (above every panel, restyled in the prism language by
// css/90-kit-theme.css), so the stage and the native panels never show two different toast styles. Same text within 1.5 s = once.
const lastToast = {msg:'', t:0};
function toast(msg, level) { msg = String(msg || '').trim(); if (!msg) return; const lv = level === 'error' ? 'error' : level === 'success' ? 'success' : level === 'warn' ? 'warn' : 'info', pk = KIT();
  if (pk && pk.toast) { const now = performance.now(); if (lastToast.msg === msg && now - lastToast.t < 1500) return; lastToast.msg = msg; lastToast.t = now;
    try { pk.toast(msg, lv, {timeout:lv === 'error' ? 8000 : 3400}); return; } catch (e) {} }
  const box = $('#toasts');
  const old = [...box.children].find(t => t._msg === msg && !t.classList.contains('out')); if (old) { clearTimeout(old._to); old._to = setTimeout(() => dropToast(old), lv === 'error' ? 6000 : 3200); return; }
  const el = html('div', 'toast ' + lv); el._msg = msg; el.setAttribute('role', lv === 'error' ? 'alert' : 'status');
  el.innerHTML = `<i aria-hidden="true"></i><span title="${esc(msg)}">${esc(msg)}</span>${lv === 'error' ? '<button class="tx" aria-label="关闭提示">' + icon('x') + '</button>' : ''}`;
  const x = qs(el, '.tx'); if (x) x.onclick = () => dropToast(el);
  box.appendChild(el); while (box.children.length > TOAST_MAX) box.removeChild(box.firstChild);
  requestAnimationFrame(() => el.classList.add('on')); el._to = setTimeout(() => dropToast(el), lv === 'error' ? 6000 : 3200); }
function dropToast(el) { if (!el.isConnected) return; clearTimeout(el._to); el.classList.add('out'); el.classList.remove('on'); setTimeout(() => el.remove(), 260); }

/* ---- scroll lists: text of items that are not fully inside the viewport is hidden (no clipped/overlapping text) ---- */
function clipList(list) { if (!list || !list.isConnected) return; const l0 = list.getBoundingClientRect(), host = list.parentElement && list.parentElement.closest('.panel,.menu,.vp-pop,.sheet,.modal');
  const hr = host ? host.getBoundingClientRect() : l0, lr = {top:Math.max(l0.top, hr.top), bottom:Math.min(l0.bottom, hr.bottom)};
  for (const it of list.children) { const r = it.getBoundingClientRect(); if (!r.height) continue;
    const out = r.bottom <= lr.top + 1 || r.top >= lr.bottom - 1, part = !out && (r.top < lr.top - .5 || r.bottom > lr.bottom + .5);
    it.classList.toggle('oov', out); it.classList.toggle('part', part); } }
const LISTS = () => [D.rackList, $('#stList'), D.log, $('#mList')].filter(Boolean);
const listRO = typeof ResizeObserver === 'function' ? new ResizeObserver(() => LISTS().forEach(clipLater)) : null;
const clipLater = (() => { const q = new Set(); let raf = 0; return el => { q.add(el); if (!raf) raf = requestAnimationFrame(() => { raf = 0; q.forEach(clipList); q.clear(); }); }; })();

/* ---- rack ---- */
let rackFilter = LS.get('filter', 'all'), rackSig = '', stSig = '', rackCounts = {};
const rackCompact = () => { const r = $('#rack'); return r.clientWidth < 250 || window.innerHeight <= 700; };
const thumbArtCanvas = (A, w, h) => { const cv = document.createElement('canvas'), d = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.round(w * d); cv.height = Math.round(h * d);
  const c = cv.getContext('2d'); c.scale(d, d); drawArt(c, w, h, artOf(A), 0); return cv; };
function thumbEl(A, w, h) { if (A.thumb) { const im = new Image(); im.alt = ''; im.decoding = 'async'; im.loading = 'lazy'; im.draggable = false; im.src = A.thumb;
    im.onerror = () => { if (im.isConnected) im.replaceWith(thumbArtCanvas(A, w, h)); }; return im; } return thumbArtCanvas(A, w, h); }
function cardEl(A) { const K = KIND[A.kind] || KIND.other, el = html('div', 'card'); el.dataset.id = A.id; el.dataset.f = A.f; el.setAttribute('role', 'listitem'); el.style.setProperty('--c', K.c);
  const visual = A.f === 'image' || A.f === 'video', lane = A.kind === 'music' && MUSIC.some(m => m.name.includes(A.name) || A.name.includes(m.name.replace(/^.*·\s*/, '')));
  const dest = A.used.length ? `<span class="go">→ <b>V1 ${esc(sceneRange(A.used))}</b></span>` : lane ? '<span class="go">→ <b>A3 配乐</b></span>' : `<span class="nu">${visual ? '未被分镜引用' : '素材库待用'}</span>`;
  el.innerHTML = `<i class="strip" aria-hidden="true"></i><button class="th" title="预览 · ${esc(A.name)}" aria-label="预览 ${esc(A.name)}"></button>
    <div class="meta"><div class="nm" title="${esc(A.name)}">${esc(A.name)}</div><div class="sub" title="${esc(assetSub(A))}">${esc(assetSub(A))}</div><div class="dest"><span class="k">${K.cn}</span>${dest}</div></div>
    <div class="acts"><button class="ib del" title="删除素材" aria-label="删除素材 ${esc(A.name)}">${icon('trash')}</button></div>`;
  qs(el, '.th').appendChild(thumbEl(A, 62, 38)); if (S.used.has(A.id)) el.classList.add('used');
  qs(el, '.th').onclick = () => openAssetModal(A);
  const del = qs(el, '.del'); del.onclick = () => { if (!del.classList.contains('arm')) { del.classList.add('arm'); del.title = '再次点击确认删除'; del.setAttribute('aria-label', '确认删除 ' + A.name); clearTimeout(del._t);
      del._t = setTimeout(() => { del.classList.remove('arm'); del.title = '删除素材'; }, 2600); return; }
    clearTimeout(del._t); del.disabled = true; el.classList.add('removing'); act('removeAsset', {assetId:A.id}, {fail:() => { del.disabled = false; el.classList.remove('removing'); del.classList.remove('arm'); }}); };
  return el; }
function renderRack(force) {
  const list = D.rackList, has = PROJ.has;
  const sig = (has ? 'P' : 'N') + (rackCompact() ? 'c' : 'w') + '|' + rackFilter + '|' + MUSIC.map(m => m.name).join(',') + '|' + ASSETS.map(A => A.id + ':' + A.kind + ':' + A.name + ':' + A.thumb + ':' + A.used.join('.') + ':' + (A.dur || '') + ':' + (A.w || '')).join('|');
  if (sig !== rackSig || force) { rackSig = sig; const st = list.scrollTop; list.innerHTML = '';
    const counts = {all:ASSETS.length}; ASSETS.forEach(A => { counts[A.f] = (counts[A.f] || 0) + 1; });
    if (rackFilter !== 'all' && !counts[rackFilter]) rackFilter = 'all';
    const fl = FILTERS.filter(([k]) => k === 'all' || counts[k]), cur = fl.find(([k]) => k === rackFilter) || fl[0]; rackCounts = counts;
    $('#rackFilters').innerHTML = !has ? '' : rackCompact() ? `<button class="fsel" id="fSel" aria-haspopup="menu" aria-expanded="false" title="按类型筛选">${cur[1]}<i>${counts[cur[0]] || 0}</i>${icon('chev')}</button>`
      : fl.map(([k, n]) => `<button class="chip${rackFilter === k ? ' on' : ''}" data-f="${k}" aria-pressed="${rackFilter === k}">${n}<i>${counts[k] || 0}</i></button>`).join('');
    const shown = ASSETS.filter(A => rackFilter === 'all' || A.f === rackFilter);
    if (!has) list.appendChild(html('div', 'rack-empty', `<b>未打开工程</b><span>新建或打开工程后，素材会出现在这里</span>`));
    else if (!ASSETS.length) list.appendChild(html('div', 'rack-empty', `<b>暂无素材</b><span>点击「导入素材」或把文件拖进来</span>`));
    else shown.forEach(A => list.appendChild(cardEl(A)));
    list.scrollTop = st; $('#rackCount').textContent = has ? ASSETS.length + ' 件' : '—';
    S.flights.forEach(f => { f.card = null; }); }
  renderStaging(force); clipLater(list); }
function renderStaging(force) { const box = $('#staging'), lst = $('#stList'), sig = STAGED.map(s => s.id + ':' + s.name + ':' + s.thumb + ':' + s.provider).join('|');
  if (sig === stSig && !force) return; stSig = sig; box.hidden = !STAGED.length; $('#stCount').textContent = STAGED.length; lst.innerHTML = '';
  STAGED.forEach(A => { const el = html('div', 'st-card'); el.dataset.id = A.id;
    const kindCn = A.kind === 'video' ? '视频' : A.kind === 'audio' ? '音频' : '图片', sub = [A.provider, kindCn].filter(Boolean).join(' · ');
    el.innerHTML = `<button class="th" title="${A.kind === 'audio' ? '试听' : '预览'} · ${esc(A.name)}" aria-label="${A.kind === 'audio' ? '试听' : '预览'} ${esc(A.name)}"></button><div class="st-m"><div class="nm" title="${esc(A.name)}">${esc(A.name)}</div>
      <div class="sub" title="${esc(A.prompt || sub)}">${esc(sub)}</div><div class="st-act"><button class="btn pri" data-a="ok" aria-label="确认入库 ${esc(A.name)}">${icon('check')}确认入库</button>
      <button class="btn ic" data-a="no" title="丢弃" aria-label="丢弃 ${esc(A.name)}">${icon('trash')}</button></div></div>`;
    qs(el, '.th').appendChild(thumbEl({thumb:A.thumb, kind:A.kind === 'audio' ? 'audio' : A.kind}, 52, 34));
    qs(el, '.th').onclick = () => openAssetModal({id:A.id, name:A.name, kind:A.kind === 'audio' ? 'music' : A.kind, url:A.url, thumb:A.thumb, used:[], staged:A});
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { const ok = b.dataset.a === 'ok'; el.querySelectorAll('button').forEach(x => x.disabled = true); el.classList.add('pending');
      act(ok ? 'confirmStaging' : 'discardStaging', {stagingId:A.id}, {done:r => { if (r.ok) { el.classList.add('gone'); } else { el.querySelectorAll('button').forEach(x => x.disabled = false); el.classList.remove('pending'); } }}); });
    lst.appendChild(el); });
  clipLater(lst); }
function flashCards(ids) { let first = null; (ids || []).forEach(id => { const c = document.querySelector(cardSel(id)); if (!c) return; first = first || c;
  c.animate([{boxShadow:'0 0 0 4px rgba(200,245,59,.9)'}, {boxShadow:'0 0 0 0 rgba(200,245,59,0)'}], {duration:1100, easing:'ease-out'}); }); if (first) scrollRackTo(first); }
function bindRack() {
  $('#rackFilters').onclick = e => { if (e.target.closest('#fSel')) { e.stopPropagation(); openFilterMenu(); return; } const b = e.target.closest('.chip'); if (!b) return; rackFilter = b.dataset.f; LS.set('filter', rackFilter); renderRack(true); };
  D.rackList.addEventListener('scroll', () => clipLater(D.rackList), {passive:true}); $('#stList').addEventListener('scroll', () => clipLater($('#stList')), {passive:true});
  const fi = $('#fileIn'); $('#importBtn').onclick = () => { if (!PROJ.has) { toast('请先新建或打开一个视频工程', 'error'); return; } fi.click(); };
  fi.onchange = () => { importFiles([...fi.files]); fi.value = ''; };
  // drag & drop anywhere on the skin (files only)
  let depth = 0; const dz = $('#dropZone'), isFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  window.addEventListener('dragenter', e => { if (!isFiles(e)) return; e.preventDefault(); depth++; dz.classList.add('on'); $('#rack').classList.add('drag'); });
  window.addEventListener('dragover', e => { if (!isFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = PROJ.has ? 'copy' : 'none'; });
  window.addEventListener('dragleave', e => { if (!isFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) { dz.classList.remove('on'); $('#rack').classList.remove('drag'); } });
  window.addEventListener('drop', e => { if (!isFiles(e)) return; e.preventDefault(); depth = 0; dz.classList.remove('on'); $('#rack').classList.remove('drag'); importFiles([...e.dataTransfer.files]); });
}
let importing = false;
async function importFiles(files) {
  files = (files || []).filter(f => f && f.size >= 0); if (!files.length) return;
  if (!PROJ.has) { toast('请先新建或打开一个视频工程', 'error'); return; } if (importing) { toast('上一批素材仍在读取中，请稍候', 'info'); return; }
  importing = true; $('#importBtn').disabled = true; $('#importHint').textContent = '读取 ' + files.length + ' 个文件…';
  try { const out = await Promise.all(files.map(f => f.arrayBuffer().then(data => ({name:f.name, type:f.type || '', data}))));
    act('importFiles', {files:out}, {transfer:out.map(o => o.data), done:() => { importing = false; $('#importBtn').disabled = false; $('#importHint').textContent = '拖拽文件到此处'; }}); }
  catch (err) { importing = false; $('#importBtn').disabled = false; $('#importHint').textContent = '拖拽文件到此处'; toast('读取文件失败：' + (err && err.message || err), 'error'); } }
