/* ================= 14b · NATIVE PANEL KIT (PK, lib/warroom/kit) — entries, frames, icons, toasts, shortcuts ================= */
// Every panel (分步精修 · 任务中心 · 影核广场 · 设置 · 配音 · 云端 · 数字人 · 算力 …) is a native kit panel restyled in the
// PRISM LAB language by css/90-kit-theme.css. The skin only decides WHERE (frame kind / size) and opens them with PK.open().
const KIT = () => (window.PK && window.PK.__v && typeof window.PK.open === 'function' ? window.PK : null);
// prototype mapping: DRAWERS (right glass drawer, 12 px off the edges) for tools / settings, centred modals for the template
// hub, players and A/B compare, the full lab bench workspace for 分步精修
const KIT_FRAMES = {studio:'workspace', tasks:'drawer', plaza:'modal', keys:'drawer', voices:'drawer', cloud:'drawer', avatar:'drawer', hardware:'drawer',
  teleprompter:'modal', reference:'modal', brand:'drawer', export:'drawer', history:'drawer', projects:'drawer', newProject:'modal', help:'modal', kitchen:'modal'};
const KIT_SIZES = {studio:'xl', tasks:'lg', plaza:'xl', keys:'lg', voices:'md', cloud:'lg', avatar:'md', hardware:'md', teleprompter:'xl', reference:'xl',
  brand:'md', export:'md', history:'lg', projects:'sm', newProject:'md', help:'md', kitchen:'xl'};
const KIT_KEYS = [['R', '一键出片 / 继续'], ['空格', '播放 / 暂停成片预览'], ['Esc', '关闭浮层 · 回到全景'], ['1 / 2 / 3', '镜头：全景 / 跟随 / 微距'], ['P', '参数控制单'],
  ['T', '实验工具'], ['N', '熄灯 / 开灯'], ['G', '3×3 抽帧'], ['V', '全屏观看成片'], ['[ / ]', '时间轴缩放'], ['F', '时间轴适配全长'], ['?', '使用帮助'], ['Ctrl + Enter', '在大号编辑器里保存']];
// kit icon names → the skin's own sprite (same 24-grid line icons); anything else keeps the kit's drawing
const KIT_ICON = {play:'play', pause:'pause', stop:'stop', retry:'retry', check:'check', x:'x', plus:'plus', upload:'upload', trash:'trash', search:'search', chev:'chev',
  arrowR:'arrow', chevL:'back', voice:'voice', cloud:'cloud', cpu:'chip', key:'key', brand:'brand', box:'pack', user:'avatar', history:'history', layers:'layers', folder:'folder',
  eye:'eye', mic:'mic', expand:'expand', tasks:'list', list:'list', hub:'plaza', split:'ref', prompt:'tele', sparkle:'spark', wand:'spark', image:'media', film:'clap', grid:'grid9',
  target:'target', settings:'gear'};
const SVGNS = 'http://www.w3.org/2000/svg';
function kitIcon(name, size) { const id = KIT_ICON[name]; if (!id || !document.getElementById('i-' + id)) return null;
  const s = document.createElementNS(SVGNS, 'svg'), u = document.createElementNS(SVGNS, 'use'); u.setAttribute('href', '#i-' + id); s.appendChild(u);
  const px = (size || 16) + 'px'; s.setAttribute('class', 'i pk-ico pk-ico--' + name); s.setAttribute('aria-hidden', 'true'); s.setAttribute('width', String(size || 16)); s.setAttribute('height', String(size || 16));
  s.style.width = px; s.style.height = px; return s; } // inline size: the skin's `svg.i{16px}` must not override the kit's requested size
// open a native panel (host `openPanel` is only the fallback when kit.js failed to load)
function openPanel(id, args) { closeMenu(); const pk = KIT();
  if (pk) { try { pk.open(id, args || {}); return; } catch (e) { console.warn('[prism-lab] panel failed to open:', id, e); } }
  act('openPanel', {panel:id, args:args || {}}); }
const kitOpen = () => { const pk = KIT(); return !!(pk && pk.isOpenAny && pk.isOpenAny()); };
const kitStack = () => { const pk = KIT(); return pk && pk.frames ? pk.frames.stack : []; };
// which frame covers the bench: 2 = the full workspace (stop drawing), 1 = drawer / modal over a scrim (draw slower), 0 = none
function kitCover() { const st = kitStack(); return st.some(f => f.kind === 'workspace' && !f.closed) ? 2 : st.length ? 1 : 0; }
// top-bar tabs follow the panel on top (分步精修 / 影核广场 / 任务中心), else 作战大屏
const TAB_PANELS = ['studio', 'plaza', 'tasks'];
function syncTabs() { const st = kitStack(); let on = 'ops'; for (let i = st.length - 1; i >= 0; i--) if (TAB_PANELS.includes(st[i].id)) { on = st[i].id; break; }
  $$('#tabs .tab').forEach(b => { const k = b.dataset.tab === on; b.classList.toggle('on', k); if (k) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }); }
// skin ornaments on every kit frame: a spectral hairline under the header + the panel's code stamped in the corner
const STAMP = {studio:'02 · REFINE', plaza:'03 · HUB', tasks:'04 · RUNS'};
function decorateFrame(f) { try { const h = f.el.querySelector('.pk-frame-h'); if (!h || h.querySelector('.pl-spec')) return;
    const sp = document.createElement('i'); sp.className = 'pl-spec'; sp.setAttribute('aria-hidden', 'true'); h.appendChild(sp);
    if (STAMP[f.id]) h.setAttribute('data-stamp', STAMP[f.id]);
    if (!f.el.querySelector('.pk-frame-idx,.pk-frame-ico')) f.el.classList.add('pl-noidx'); } catch (e) {} }
// ONE toast renderer (the kit's, restyled as the ink bar) that never covers a panel's actions. The stack sits at the bottom
// centre (0) unless the panel on top reaches into that spot; then the first that fits: (1) just under the panel (dialogs, short
// modals), (2) just above it, (3) beside it on the dimmed bench (side drawers, wide gutters), (4) inside it, above its footer.
function boxOf(el) { let x = 0, y = 0; for (let e = el; e; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
  return {l:x, t:y, r:x + el.offsetWidth, b:y + el.offsetHeight, w:el.offsetWidth}; } // layout box: ignores slide-in transforms
// the panel the user works in: {R: its box, foot: top of its footer actions (or its bottom edge), side: docked to an edge}
function toastSurface() { const st = kitStack().filter(f => !f.closed && f.el && f.el.isConnected), f = st[st.length - 1];
  if (f) { const R = boxOf(f.el), ft = f.el.querySelector(':scope > .pk-frame-f');
    return {R, foot:ft && !ft.hidden && ft.offsetHeight ? boxOf(ft).t : R.b - 12, side:f.kind === 'drawer'}; }
  const sh = $('#sheet'); if (!sh || !sh.classList.contains('open')) return null;
  const r = sh.getBoundingClientRect(), R = {l:r.left, t:r.top, r:r.right, b:r.bottom, w:r.width}, ft = sh.querySelector('.sh-f'); // the sheet scrolls as a whole
  return {R, foot:Math.min(ft && ft.offsetHeight ? ft.getBoundingClientRect().top : R.b, R.b - 12), side:false}; }
let toastIv = 0;
function dockToasts() { const box = document.querySelector('#pk-root .pk-toasts'); if (!box) return;
  const live = box.childElementCount > 0; // while toasts are visible re-dock 5×/s (panels resize, footers appear, details expand)
  if (live && !toastIv) toastIv = setInterval(dockToasts, 200); else if (!live && toastIv) { clearInterval(toastIv); toastIv = 0; }
  if (!live) return;
  const vw = innerWidth, vh = innerHeight, G = 10, s = toastSurface(), px = v => Math.round(v) + 'px';
  const put = (x, w, bottom) => { box.style.setProperty('--pl-tx', px(x)); box.style.setProperty('--pl-tw', px(Math.max(240, w)));
    if (bottom !== undefined) box.style.setProperty('--pl-tb', px(bottom)); return box; };
  let b = put(vw / 2, Math.min(640, vw - 32), 20);
  if (!s) return;
  const R = s.R, bw0 = b.offsetWidth, top0 = vh - 20 - b.offsetHeight;
  if (vw / 2 - bw0 / 2 >= R.r || vw / 2 + bw0 / 2 <= R.l || top0 >= R.b || vh - 20 <= R.t) return; // 0 · the usual spot is free
  const cx = R.l + R.w / 2, w = Math.min(640, R.w - 32, vw - 32), H = put(cx, w).offsetHeight;
  if (vh - R.b >= H + 2 * G) return void put(cx, w, vh - R.b - G - H);                         // 1 · just under the panel
  if (R.t >= H + 2 * G) return void put(cx, w, vh - R.t + G);                                  // 2 · just above it
  const lf = R.l, rf = vw - R.r, free = Math.max(lf, rf), bw = Math.min(640, free - 2 * G);
  if (free >= (s.side ? 360 : 300) + 2 * G) { b = put(lf >= rf ? lf / 2 : R.r + rf / 2, bw);      // 3 · beside it, as near the centre as it gets
    const half = b.offsetWidth / 2, x = lf >= rf ? Math.min(vw / 2, lf - G - half) : Math.max(vw / 2, R.r + G + half);
    if (b.offsetHeight + 40 <= vh) return void put(x, bw, 20); }
  put(cx, w, vh - s.foot + G); }                                                // 4 · inside, right above its footer rule
function initKit() { const pk = KIT(); if (!pk) { console.warn('[prism-lab] panel kit (kit.js) not loaded — panels fall back to the host'); return; }
  // toast hook = "a toast is coming": returning false keeps the kit's renderer; the dock runs before the toast is painted
  pk.configure({skin:SKIN_ID, frames:KIT_FRAMES, sizes:KIT_SIZES, icon:kitIcon, shortcuts:KIT_KEYS, toast:() => { queueMicrotask(dockToasts); return false; }});
  window.addEventListener('resize', dockToasts);
  pk.on('frame-open', f => { decorateFrame(f); syncTabs(); closeMenu(); closeAgentCard(); stillDrawn = false; dockToasts(); });
  pk.on('frame-close', () => { syncTabs(); stillDrawn = false; redrawSoon(); syncSheet(); renderTopics(); dockToasts(); });
  pk.on('panel-open', syncTabs); pk.on('panel-close', syncTabs);
  pk.on('project-created', () => { closeAll(); }); }
