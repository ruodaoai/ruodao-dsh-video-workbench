/* ================= 11 · PARAMETER CONTROL SHEET (director brief/params ⇄ setDirector · options from the host) ================= */
const STYLE_SW = {tech:['#111111', '#2F37FF', '#C8F53B'], cinematic:['#1A1512', '#E8462A', '#F3C98F'], documentary:['#3A3A37', '#AAA9A2', '#F2F1EC'], energetic:['#FF2D8A', '#FF5A1F', '#00C2FF'],
  warm:['#7A4B2A', '#F2A900', '#F6E3C4'], emerald:['#0F3D33', '#2E8B6F', '#D9C9A3']};
// 3 swatch bars: the host's colours (AI 自由匹配's pick / design, 我的风格预设) > this skin's preset palette > a stable hash
const swOf = o => (o.colors && o.colors.length >= 3 ? o.colors : STYLE_SW[o.preset || o.value]) || (o.value === 'auto' ? ['#6B2BFF', '#0094FF', '#F2A900'] : (() => { const h = hashStr(o.value); return [0, 1, 2].map(k => rgba(SPECTRUM[(h + k * 3) % 8], 1)); })());
// 风格: AI 自由匹配 first, the 6 presets, then 我的风格预设 under a heading; long names end with … (full name + hint in the tooltip)
function styleBtnHtml(s, cur) { const on = cur === s.value, tip = s.hint ? `${s.label} · ${s.hint}` : s.label;
  return `<button class="sty${on ? ' on' : ''}${s.value === 'auto' ? ' ai' : ''}" data-sty="${esc(s.value)}" title="${esc(tip)}" aria-pressed="${on}"><span class="sw" aria-hidden="true">${swOf(s).map(c => `<i style="background:${c}"></i>`).join('')}</span><span class="sn">${esc(s.label)}</span></button>`; }
function stylesHtml(styles, cur) { const mine = styles.filter(s => s.kind === 'user' || s.value.startsWith('user:')), base = styles.filter(s => !mine.includes(s));
  return `<div class="styles" role="group" aria-label="视觉风格">${base.map(s => styleBtnHtml(s, cur)).join('')}${mine.length ? `<div class="sty-h">我的风格预设 · ${mine.length}</div>${mine.map(s => styleBtnHtml(s, cur)).join('')}` : ''}</div>`; }
const DUR_STOPS = [[0, 'AI 智能'], [30, '30 秒'], [60, '1 分'], [120, '2 分'], [180, '3 分'], [300, '5 分'], [600, '10 分']];
const FPS_OPTS = [24, 25, 30, 50, 60];
// optimistic edits: shown immediately, kept until the throttled state echo confirms them (or 3 s pass)
const pendingDir = {};
function dirVal(k) { const d = M ? M.director : {}, p = pendingDir[k]; if (p && performance.now() - p.t < 3000 && d[k] !== p.v) return p.v; if (p) delete pendingDir[k]; return d[k]; }
// discrete edits are coalesced for 300 ms (knob drag / wheel spin / rapid clicks → ONE setDirector); flushed before run, polish, close, skin switch
let dirQ = null, dirT = 0; const sentDir = {};
const same = (a, b) => String(a) === String(b);
// what the host will hold once our in-flight edits land (last value we sent, else the state echo)
const effDir = k => { const s = sentDir[k]; return s && performance.now() - s.t < 5000 ? s.v : (M ? M.director[k] : undefined); };
function setDir(patch) { if (!PROJ.has) { toast('请先新建或打开一个视频工程', 'error'); return; } const now = performance.now();
  if (Object.entries(patch).every(([k, v]) => same(dirVal(k), v))) return; // nothing changes (coupled keys still travel together)
  Object.entries(patch).forEach(([k, v]) => { pendingDir[k] = {v, t:now}; }); dirQ = Object.assign(dirQ || {}, patch); clearTimeout(dirT); dirT = setTimeout(flushDir, 300);
  if (sheetOpen()) buildSheet(true); renderCapsuleFrom(); }
function flushDir() { clearTimeout(dirT); if (!dirQ) return; const patch = dirQ, now = performance.now(); dirQ = null;
  if (Object.entries(patch).every(([k, v]) => same(effDir(k), v))) return; // net no-op (e.g. the knob was spun back)
  Object.keys(patch).forEach(k => { if (pendingDir[k]) pendingDir[k].t = now; sentDir[k] = {v:patch[k], t:now}; });
  act('setDirector', {patch}, {fail:() => { Object.keys(patch).forEach(k => { delete pendingDir[k]; delete sentDir[k]; }); if (sheetOpen()) buildSheet(); renderCapsule(); }}); }
const sheetOpen = () => $('#sheet').classList.contains('open');
function renderCapsuleFrom() { if (!M) return; const keep = M.director; M.director = Object.assign({}, keep, Object.fromEntries(Object.keys(keep).map(k => [k, dirVal(k)]))); renderCapsule(); M.director = keep; }
function segHtml(key, opts, cur) { if (!opts.length) return '<span class="none">宿主未提供选项</span>';
  return `<div class="seg wrap" data-k="${key}" role="group">${opts.map(o => `<button data-v="${esc(o.value)}" class="${String(cur) === String(o.value) ? 'on' : ''}" title="${esc(o.label)}" aria-pressed="${String(cur) === String(o.value)}">${esc(o.label)}</button>`).join('')}</div>`; }
const rowHtml = (cn, en, inner) => `<div class="row"><label>${cn}<span class="mono">${en}</span></label>${inner}</div>`;
// the brief preview shared by the task center and the sheet (renderTopic/editBrief in 10c-ui-task.js)
const topicBoxHtml = (id, lines) => `<div class="topic" id="${id}" role="button" tabindex="0" style="--tl:${lines}"><p class="tp-tx"></p><div class="tp-f"><span class="tp-n"></span><span class="spacer"></span><span class="tp-more">${icon('expand')}展开编辑</span></div></div>`;
function buildSheet(keepScroll) {
  const sh = $('#sheet'), st = sh.scrollTop, o = M ? M.options : {}, p = M && M.project, V_ = k => dirVal(k);
  const td = +V_('targetDurationSec') || 120; let durIdx = 0;
  if (V_('durationMode') === 'custom') { durIdx = 1; for (let i = 2; i < DUR_STOPS.length; i++) if (Math.abs(DUR_STOPS[i][0] - td) < Math.abs(DUR_STOPS[durIdx][0] - td)) durIdx = i; }
  const fpsOpts = [...new Set(FPS_OPTS.concat([+V_('fps') || 30]))].sort((a, b) => a - b).map(v => ({value:String(v), label:v + ' fps'}));
  const voices = (o.voices || []), vcur = voices.find(x => x.value === V_('voiceId')), styles = o.styles || [], vlab = vcur ? vcur.label : (V_('voiceId') === 'auto' ? 'AI 自动匹配' : V_('voiceId'));
  sh.innerHTML = `<div class="sh-h"><div class="sh-t"><div class="ttl">参数控制单</div><div class="mono">CONTROL SHEET${p ? ' · ' + esc(p.title) : ''}</div></div><span class="spacer"></span><button class="x icon-btn" id="shClose" title="关闭 · Esc" aria-label="关闭参数控制单">${icon('x')}</button></div>
  <div class="sh-grid">
    <div class="grp"><div class="grp-h"><span class="n">01</span><b>输出</b><span class="mono">OUTPUT</span></div>
      ${rowHtml('引擎', 'ENGINE', segHtml('engine', o.engines || [], V_('engine')))}${rowHtml('模式', 'MODE', segHtml('creationMode', o.creationModes || [], V_('creationMode')))}
      ${rowHtml('画幅', 'ASPECT', segHtml('aspectRatio', o.aspectRatios || [], V_('aspectRatio')))}${rowHtml('画质', 'QUALITY', segHtml('quality', o.qualities || [], V_('quality')))}${rowHtml('帧率', 'FPS', segHtml('fps', fpsOpts, String(V_('fps'))))}</div>
    <div class="grp"><div class="grp-h"><span class="n">02</span><b>节奏</b><span class="mono">TEMPO · DURATION</span></div>
      ${rowHtml('时长', 'DURATION', '<div class="tick" id="tkDur" role="slider" tabindex="0" aria-label="目标时长"></div>')}
      ${rowHtml('节奏', 'PACING', `<div class="knob-wrap"><svg class="knob" id="knob" viewBox="0 0 62 62" role="slider" tabindex="0" aria-label="节奏"></svg><div class="knob-l"><b id="knobV"></b><span class="mono">拖动 / 滚轮 / 点击</span></div></div>`)}</div>
    <div class="grp"><div class="grp-h"><span class="n">03</span><b>声音</b><span class="mono">SOUND</span></div>
      ${rowHtml('旁白', 'NARRATION', segHtml('narrationMode', o.narrationModes || [], V_('narrationMode')))}${rowHtml('配乐', 'MUSIC', segHtml('bgmMode', o.bgmModes || [], V_('bgmMode')))}
      ${rowHtml('音色', 'VOICE', `<div class="vcol"><button type="button" class="vp-btn" id="vpBtn" aria-haspopup="listbox" aria-expanded="false" title="${esc(vlab)}"><span>${esc(vlab)}</span><i>${voices.length} 个</i>${icon('chev')}</button><button class="btn" id="vpLib" title="打开配音中心：试听 · 克隆 · 导入音色">${icon('voice')}配音中心</button></div>`)}</div>
    <div class="grp"><div class="grp-h"><span class="n">04</span><b>画面</b><span class="mono">PICTURE · AVATAR</span></div>
      ${rowHtml('风格', 'STYLE', styles.length ? stylesHtml(styles, V_('style')) : '<span class="none">宿主未提供选项</span>')}
      ${rowHtml('数字人', 'AVATAR', `<div class="av-row"><button class="toggle${V_('avatarEnabled') ? ' on' : ''}" id="tgAv" role="switch" aria-checked="${!!V_('avatarEnabled')}" aria-label="数字人"></button><span class="av-l">${V_('avatarEnabled') ? '已启用' : '关闭'}</span>
        <div class="pos" id="posBox">${(o.avatarLayouts || []).map(l => `<button data-pos="${esc(l.value)}" class="${V_('avatarLayout') === l.value ? 'on' : ''}" title="${esc(l.label)}" aria-label="${esc(l.label)}"${V_('avatarEnabled') ? '' : ' disabled'}>${l.value === 'fullscreen' ? '<i style="inset:3px"></i>' : `<i style="width:13px;height:9px;bottom:3px;${l.value === 'pip-bl' ? 'left' : 'right'}:3px"></i>`}</button>`).join('')}</div><button class="btn" id="avMore" title="数字人：主播形象 / 克隆真人 / 口型引擎">${icon('avatar')}数字人设置</button></div>`)}</div>
    <div class="grp wide"><div class="grp-h"><span class="n">05</span><b>创意简报</b><span class="mono">BRIEF · LLM</span></div>
      ${topicBoxHtml('shTopicBox', 4)}
      <div class="br-row"><button class="btn" id="shEdit">${icon('expand')}放大编辑</button><button class="btn" id="shPolish">${icon('spark')}AI 润色</button><span class="llm ${M && M.status.llm.configured ? 'ok' : 'warn'}"><i class="dot ${M && M.status.llm.configured ? 'ok' : 'warn'}"></i>大模型 · ${esc(M && M.status.llm.configured ? M.status.llm.label || '已连接' : '未配置')}</span><button class="btn" id="shLlm">${icon('key')}模型设置</button></div></div>
  </div>
  <div class="sh-f"><div class="sum" id="shSum"></div><span class="spacer"></span><button class="btn" id="shMore" title="全部导演参数：标题 / 平台 / 角标 / 3D / 大纲 …">${icon('layers')}更多参数</button><button class="btn pri" id="shDone">${icon('check')}完成</button></div>`;
  sh.querySelectorAll('.seg[data-k]').forEach(sg => sg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const k = sg.dataset.k; setDir({[k]:k === 'fps' ? Number(b.dataset.v) : b.dataset.v}); }));
  sh.querySelectorAll('.sty').forEach(b => b.onclick = () => setDir({style:b.dataset.sty}));
  qs(sh, '#tgAv').onclick = () => setDir({avatarEnabled:!dirVal('avatarEnabled')});
  sh.querySelectorAll('#posBox button').forEach(b => b.onclick = () => setDir({avatarLayout:b.dataset.pos}));
  qs(sh, '#shClose').onclick = () => closeAll(); qs(sh, '#shDone').onclick = () => closeAll();
  qs(sh, '#vpLib').onclick = () => openPanel('voices'); qs(sh, '#shLlm').onclick = () => openPanel('keys', {tab:'llm'}); qs(sh, '#avMore').onclick = () => openPanel('avatar');
  qs(sh, '#shMore').onclick = () => { flushDir(); openPanel('studio', {step:'director'}); }; qs(sh, '#shEdit').onclick = () => editBrief();
  qs(sh, '#shPolish').onclick = () => { flushDir(); act('polishTopic', {}); };
  makeTick(qs(sh, '#tkDur'), DUR_STOPS.map(s => s[1]), durIdx, i => setDir(i ? {durationMode:'custom', targetDurationSec:DUR_STOPS[i][0]} : {durationMode:'auto'}));
  bindVoicePicker(qs(sh, '#vpBtn')); bindTopicBox(qs(sh, '#shTopicBox')); buildKnob(); sheetSummary(); if (keepScroll) sh.scrollTop = st; requestAnimationFrame(renderTopics); }
// 200+ voices: the kit's searchable picker (one picker look for the stage and every panel); full names wrap, never clipped
function bindVoicePicker(btn) { btn.onclick = e => { e.stopPropagation(); const pk = KIT(); if (!pk || !pk.pickFrom) { openPanel('voices'); return; }
    const opts = (M ? M.options.voices : []).map(v => { const i = v.label.lastIndexOf(' · '); return i > 0 ? {value:v.value, label:v.label.slice(0, i), hint:v.label.slice(i + 3)} : {value:v.value, label:v.label}; });
    pk.pickFrom(btn, {options:opts, value:dirVal('voiceId'), searchable:true, title:'主讲音色 · ' + opts.length + ' 个', width:Math.max(btn.offsetWidth, 340), onPick:v => setDir({voiceId:v})}); }; }
// state echo → rebuild, except under an open kit popover / panel (its anchor must survive); the next echo or frame-close catches up
function syncSheet() { if (!sheetOpen()) return; renderTopics();
  const sig = JSON.stringify(M ? [M.director, M.options.voices.length, M.status.llm] : 0); if (sig === syncSheet.sig) return;
  if (kitOpen()) { sheetSummary(); return; } syncSheet.sig = sig; buildSheet(true); }
function sheetSummary() { const el = $('#shSum'); if (!el || !M) return; const o = M.options, dm = dirVal('durationMode'), td = dirVal('targetDurationSec');
  const voice = (o.voices.find(v => v.value === dirVal('voiceId')) || {label:dirVal('voiceId')}).label;
  el.innerHTML = `时长 <b>${dm === 'custom' ? mmss(td) : 'AI 智能'}</b> · 画幅 <b>${esc(optLabel(o.aspectRatios, dirVal('aspectRatio')))}</b> · 音色 <b title="${esc(voice)}">${esc(voice)}</b> · 数字人 <b>${dirVal('avatarEnabled') ? esc(optLabel(o.avatarLayouts, dirVal('avatarLayout'))) : '关闭'}</b>`; }
function makeTick(el, labels, idx, onChange, small) {
  el.innerHTML = `<div class="ln"></div><div class="fl"></div>${labels.map(l => `<i class="tk"></i>${small ? '' : `<span class="tl">${esc(l)}</span>`}`).join('')}<div class="th"></div>`;
  const tks = el.querySelectorAll('.tk'), tls = el.querySelectorAll('.tl'), th = qs(el, '.th'), fl = qs(el, '.fl'), n = labels.length;
  const pos = i => `calc(8px + (100% - 16px) * ${n > 1 ? i / (n - 1) : 0})`;
  tks.forEach((t, i) => t.style.left = pos(i)); tls.forEach((t, i) => t.style.left = pos(i));
  const set = (i, fire) => { idx = clamp(i, 0, n - 1); th.style.left = pos(idx); fl.style.width = `calc((100% - 16px) * ${n > 1 ? idx / (n - 1) : 0})`; tls.forEach((t, j) => t.classList.toggle('on', j === idx));
    el.setAttribute('aria-valuenow', idx); el.setAttribute('aria-valuetext', labels[idx] || String(idx)); if (fire) onChange(idx); };
  const pick = e => { const r = el.getBoundingClientRect(); return Math.round(clamp((e.clientX - r.left - 8) / ((r.width - 16) || 1), 0, 1) * (n - 1)); };
  let drag = false, start = idx; el.addEventListener('pointerdown', e => { drag = true; start = idx; try { el.setPointerCapture(e.pointerId); } catch (er) {} set(pick(e), false); });
  el.addEventListener('pointermove', e => { if (drag) { const i = pick(e); if (i !== idx) set(i, false); } });
  el.addEventListener('pointerup', () => { if (drag && idx !== start) onChange(idx); drag = false; });
  el.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); set(idx - 1, true); } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); set(idx + 1, true); } });
  el.setAttribute('aria-valuemin', 0); el.setAttribute('aria-valuemax', n - 1); set(idx, false); el._set = set; return el; }
function buildKnob() { const k = $('#knob'); if (!k || !M) return; const opts = M.options.pacingModes; if (!opts.length) { k.innerHTML = ''; $('#knobV').textContent = '—'; return; }
  const n = opts.length, i = Math.max(0, opts.findIndex(o => o.value === dirVal('pacingMode'))), span = 270, ang = -135 + (n > 1 ? i * span / (n - 1) : 0), C = 31;
  let s = `<circle cx="${C}" cy="${C}" r="27" fill="none" stroke="var(--rule2)"/>`;
  for (let j = 0; j <= 36; j++) { const a = (-135 + j * 7.5 - 90) * Math.PI / 180, l = j % 12 === 0 ? 5 : 2.5; s += `<line x1="${C + Math.cos(a) * 27}" y1="${C + Math.sin(a) * 27}" x2="${C + Math.cos(a) * (27 + l * .6)}" y2="${C + Math.sin(a) * (27 + l * .6)}" stroke="var(--ink3)" stroke-width="${j % 12 === 0 ? 1.2 : .7}"/>`; }
  const ea = (ang - 90) * Math.PI / 180, sa = (-135 - 90) * Math.PI / 180, large = (ang + 135) > 180 ? 1 : 0;
  if (ang > -135) s += `<path d="M${C + Math.cos(sa) * 22} ${C + Math.sin(sa) * 22} A22 22 0 ${large} 1 ${C + Math.cos(ea) * 22} ${C + Math.sin(ea) * 22}" fill="none" stroke="#FF5A1F" stroke-width="3" stroke-linecap="round"/>`;
  s += `<circle cx="${C}" cy="${C}" r="17" fill="var(--ink)"/><line x1="${C}" y1="${C}" x2="${C + Math.cos(ea) * 15}" y2="${C + Math.sin(ea) * 15}" stroke="var(--bg)" stroke-width="2.4" stroke-linecap="round"/>`;
  k.innerHTML = s; $('#knobV').textContent = opts[i].label; k.setAttribute('aria-valuetext', opts[i].label);
  const go = d => { const o = M.options.pacingModes, ci = Math.max(0, o.findIndex(x => x.value === dirVal('pacingMode'))), ni = clamp(ci + d, 0, o.length - 1); if (ni !== ci) setDir({pacingMode:o[ni].value}); };
  if (!k._b) { k._b = 1; let y0 = null, moved = 0;
    k.addEventListener('pointerdown', e => { y0 = e.clientY; moved = 0; try { k.setPointerCapture(e.pointerId); } catch (er) {} });
    k.addEventListener('pointermove', e => { if (y0 == null) return; const d = Math.round((y0 - e.clientY) / 22); if (d !== moved) { go(d - moved); moved = d; } });
    k.addEventListener('pointerup', e => { if (y0 != null && Math.abs(e.clientY - y0) < 3) { const o = M.options.pacingModes, ci = Math.max(0, o.findIndex(x => x.value === dirVal('pacingMode'))); setDir({pacingMode:o[(ci + 1) % o.length].value}); } y0 = null; });
    k.addEventListener('wheel', e => { e.preventDefault(); go(e.deltaY < 0 ? 1 : -1); }, {passive:false});
    k.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); go(1); } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); go(-1); } }); } }
function openSheet() { if (!PROJ.has) { toast('请先新建或打开一个视频工程', 'error'); return; } closeAll(true); buildSheet(); const cap = $('#hudCap').getBoundingClientRect(), sh = $('#sheet'), w = Math.min(820, window.innerWidth - 24);
  const top = cap.height ? cap.bottom + 8 : 60; sh.style.width = w + 'px'; sh.style.left = clamp((cap.width ? cap.left + cap.width / 2 : window.innerWidth / 2) - w / 2, 12, window.innerWidth - w - 12) + 'px';
  sh.style.top = Math.min(top, 80) + 'px'; sh.style.maxHeight = (window.innerHeight - Math.min(top, 80) - 16) + 'px';
  sh.classList.add('open'); $('#hud').classList.add('open'); $('#scrim').classList.add('on'); syncSheet.sig = ''; }
