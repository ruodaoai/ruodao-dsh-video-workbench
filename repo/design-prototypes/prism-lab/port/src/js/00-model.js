/* ================= 0 · MODEL (host WarRoomState → render model · contract: lib/warroom/BRIDGE.md) ================= */
const SKIN_ID = 'prism-lab';
// 8 glass elements on the optical bench; ring order = pipeline order = a 400–700 nm colour wheel
const AGENTS = [
  {id:'director',  name:'策划导演', en:'DIRECTOR',     el:'色散棱镜 · DISPERSING PRISM', c:'#6B2BFF', ang:202.5, shape:'tri'},
  {id:'editor',    name:'素材剪辑', en:'EDITOR',       el:'恒偏棱镜 · PELLIN–BROCA',     c:'#2F37FF', ang:157.5, shape:'pb'},
  {id:'audio',     name:'配音混音', en:'AUDIO',        el:'衍射光栅 · GRATING',           c:'#0094FF', ang:112.5, shape:'grating'},
  {id:'motion',    name:'动效编程', en:'MOTION CODER', el:'道威棱镜 · DOVE PRISM',        c:'#00B89C', ang:67.5,  shape:'dove'},
  {id:'qa',        name:'质检渲染', en:'QA · RENDER',  el:'双凸透镜 · BICONVEX LENS',     c:'#4CBB17', ang:22.5,  shape:'lens'},
  {id:'avatar',    name:'数字人',   en:'AVATAR',       el:'球透镜 · BALL LENS',           c:'#F2A900', ang:337.5, shape:'ball'},
  {id:'cloud',     name:'云端生成', en:'CLOUD GEN',    el:'五棱镜 · PENTAPRISM',          c:'#FF7A1A', ang:292.5, shape:'penta'},
  {id:'reference', name:'参考复刻', en:'REFERENCE',    el:'分光立方 · BEAM SPLITTER',     c:'#F0284A', ang:247.5, shape:'cube'}];
const AG = {}; AGENTS.forEach((a, i) => { a.idx = i; AG[a.id] = a; });
const CORE = ['director', 'editor', 'audio', 'motion', 'qa']; // the 5 pipeline stages of the phase bar
const AG_IO = {director:['素材光源 · 参考复刻', '素材剪辑 · 取景器'], editor:['策划导演 · 素材光源', '配音混音 · 时间轴 V1'], audio:['素材剪辑', '动效编程 · A1/A2/A3'], motion:['配音混音', '质检渲染'],
  qa:['动效编程 · 数字人', '取景器 · MP4'], avatar:['云端生成 · 配音', '质检渲染'], cloud:['参考复刻', '素材剪辑 · 数字人'], reference:['参考样片', '策划导演 · 云端生成']};
const ST_MAP = {idle:'idle', queued:'queue', running:'run', paused:'pause', done:'done', failed:'err', stopped:'stop', skipped:'skip'};
const STN = {idle:'待命', queue:'排队', run:'运行', pause:'暂停', done:'完成', err:'失败', stop:'已停', skip:'跳过'};
const RUN_CN = {queued:'排队中', running:'运行中', paused:'已暂停', completed:'已完成', failed:'执行失败', stopped:'已停止'};
const KIND = {image:{cn:'图片', c:'#2F37FF', f:'image'}, video:{cn:'视频', c:'#FF5A1F', f:'video'}, host_video:{cn:'真人视频', c:'#FF5A1F', f:'video'},
  music:{cn:'音乐', c:'#6B2BFF', f:'music'}, sfx:{cn:'音效', c:'#F0284A', f:'sfx'}, voice:{cn:'配音', c:'#00B89C', f:'voice'}, note:{cn:'笔记', c:'#3A3A37', f:'other'}, other:{cn:'其他', c:'#7A7973', f:'other'}};
const FILTERS = [['all', '全部'], ['image', '图片'], ['video', '视频'], ['music', '音乐'], ['sfx', '音效'], ['voice', '配音'], ['other', '其他']];
const SKINS = [{id:'nova-deck', short:'A', name:'星舰剪辑甲板', en:'NOVA DECK', sw:'#3BE7FF', bg:'#05070F'}, {id:'ink-loom', short:'B', name:'墨韵织机', en:'INK LOOM', sw:'#D4A64A', bg:'#0E0D0B'},
  {id:'prism-lab', short:'C', name:'棱镜实验室', en:'PRISM LAB', sw:'#2F37FF', bg:'#F2F1EC'}];
// SFX cue type → glyph family (unknown types fall back to a neutral tick)
const SFX_GLYPH = {hit:'hi', sub_drop:'hi', crash_cym:'hi', stamp:'hi', slash:'sw', swoosh:'sw', whoosh:'sw', suck:'sw', riser:'bw', shimmer_swell:'bw', pop_soft:'wd', tick:'wd', counter:'wd', sparkle:'mc', bell_warm:'mc'};
const SFX_CN = {hit:'重击', sub_drop:'低频下坠', crash_cym:'镲片', stamp:'盖章', slash:'刀风', swoosh:'掠过', whoosh:'呼啸', suck:'吸入', riser:'上升音', shimmer_swell:'微光渐强', pop_soft:'轻弹', tick:'滴答', counter:'计数', sparkle:'闪光', bell_warm:'暖钟'};
function sfxGlyphOf(k) { k = String(k || ''); if (SFX_GLYPH[k]) return SFX_GLYPH[k];
  return /hit|boom|impact|drop|crash|thud|kick|punch/i.test(k) ? 'hi' : /swoosh|whoosh|swish|slash|sweep|swipe/i.test(k) ? 'sw' : /rise|swell|build/i.test(k) ? 'bw' : /pop|tick|click|count/i.test(k) ? 'wd' : 'tk'; }
const sfxName = k => SFX_CN[k] || String(k || 'sfx');

// ---- mutable render model, rebuilt from every dsh-vw/state ----
const PROJ = {has:false, real:false, title:'', dur:60, fps:30, bpm:0, drops:[], w:1920, h:1080, engine:'remotion'};
let BEATS = [], SCENES = [], SFX = [], ASSETS = [], STAGED = [], MUSIC = [], M = null;
const NOSCENE = {i:-1, no:0, id:'', title:'暂无分镜', start:0, dur:60, end:60, sub:'', sfx:[], mode:'c', thumb:'', voice:false, locked:false};
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const str = (v, d = '') => (v == null ? d : String(v));
const arr = v => (Array.isArray(v) ? v : []);
// style options keep their colours: AI 自由匹配 (the AI's pick / design) and 我的风格预设 carry their own palette
const HEX6 = /^#[0-9a-f]{6}$/i;
const styleOpts = v => arr(v).filter(x => x && x.value != null).map(x => ({value:String(x.value), label:str(x.label, String(x.value)) || String(x.value), hint:str(x.hint),
  kind:str(x.kind), preset:str(x.preset), colors:arr(x.colors).map(String).filter(c => HEX6.test(c)).slice(0, 3)}));
const RUN_STATUSES = ['queued', 'running', 'paused', 'completed', 'failed', 'stopped'];
const AG_STATUSES = ['idle', 'queued', 'running', 'paused', 'done', 'failed', 'stopped', 'skipped'];
const LIVE = s => s === 'queued' || s === 'running' || s === 'paused';
const pct01 = v => Math.min(1, Math.max(0, num(v) / 100));
const extOf = n => { const m = /\.([a-z0-9]{1,5})$/i.exec(String(n || '')); return m ? m[1].toUpperCase() : ''; };

function normState(st) { // tolerate unknown / missing fields everywhere (contract §2)
  const o = st && typeof st === 'object' ? st : {};
  const p = o.project && typeof o.project === 'object' ? o.project : null, tl = o.timeline && typeof o.timeline === 'object' ? o.timeline : {};
  const r = o.run && typeof o.run === 'object' ? o.run : null, pv = o.preview || {}, dr = o.director || {}, op = o.options || {}, ss = o.status || {}, cn = o.counts || {};
  const opts = v => arr(v).filter(x => x && x.value != null).map(x => ({value:String(x.value), label:str(x.label, String(x.value)) || String(x.value)}));
  const sub = (k) => (ss[k] && typeof ss[k] === 'object' ? ss[k] : {});
  return {
    ts:num(o.ts, Date.now()), skin:str(o.skin, SKIN_ID), host:o.host === 'dsh' ? 'dsh' : 'standalone', lowSpec:!!o.lowSpec, busy:str(o.busy).trim(),
    project:p ? {dir:str(p.dir), title:str(p.title).trim() || '未命名工程', engine:p.engine === 'html' ? 'html' : 'remotion', aspectRatio:str(p.aspectRatio, 'auto'), width:num(p.width), height:num(p.height),
      fps:num(p.fps, 30) || 30, quality:str(p.quality), genreLabel:str(p.genreLabel), style:str(p.style), narrationMode:str(p.narrationMode), durationSec:Math.max(0, num(p.durationSec))} : null,
    projects:arr(o.projects).filter(x => x && x.dir).map(x => ({dir:str(x.dir), title:str(x.title).trim() || '未命名工程', engine:str(x.engine), updatedAt:str(x.updatedAt), hasMp4:!!x.hasMp4})),
    assets:arr(o.assets).filter(a => a && a.id != null && a.id !== '').map(a => ({id:str(a.id), kind:KIND[a.kind] ? a.kind : 'other', name:str(a.name).trim() || str(a.id), url:str(a.url), thumbUrl:str(a.thumbUrl),
      durationSec:num(a.durationSec) > 0 ? num(a.durationSec) : null, width:num(a.width) > 0 ? num(a.width) : null, height:num(a.height) > 0 ? num(a.height) : null, usedBySceneIds:arr(a.usedBySceneIds).map(String)})),
    staging:arr(o.staging).filter(s => s && s.id != null && s.id !== '').map(s => ({id:str(s.id), kind:s.kind === 'video' || s.kind === 'audio' ? s.kind : 'image', name:str(s.name).trim() || str(s.id),
      url:str(s.url), thumbUrl:str(s.thumbUrl), provider:str(s.provider), prompt:str(s.prompt)})),
    run:r ? {id:str(r.id), status:RUN_STATUSES.includes(r.status) ? r.status : 'queued', progress:Math.min(100, Math.max(0, num(r.progress))), activeAgentId:AG[r.activeAgentId] ? r.activeAgentId : null,
      elapsedSec:Math.max(0, num(r.elapsedSec)), error:str(r.error), message:str(r.message)} : null,
    agents:AGENTS.map(a => { const x = arr(o.agents).find(g => g && g.id === a.id) || {};
      return {id:a.id, name:str(x.name).trim() || a.name, en:str(x.en).trim() || a.en, status:AG_STATUSES.includes(x.status) ? x.status : 'idle', progress:Math.min(100, Math.max(0, num(x.progress))), message:str(x.message)}; }),
    logs:arr(o.logs).filter(l => l && typeof l === 'object').slice(-60).map(l => ({ts:str(l.ts), agentId:AG[l.agentId] ? l.agentId : 'system', level:l.level === 'error' || l.level === 'warn' ? l.level : 'info', text:str(l.text)})),
    timeline:{totalSec:Math.max(0, num(tl.totalSec)), fps:num(tl.fps, 30) || 30, bpm:num(tl.bpm) > 0 ? num(tl.bpm) : null,
      beats:arr(tl.beats).slice(0, 4000).filter(b => b).map(b => ({t:num(b.t, -1), strong:!!b.strong})).filter(b => b.t >= 0),
      drops:arr(tl.drops).map(d => num(d, -1)).filter(d => d >= 0),
      scenes:arr(tl.scenes).filter(s => s && typeof s === 'object').map((s, i) => ({id:str(s.id).trim() || 'scene-' + (i + 1), index:num(s.index, i), title:str(s.title).trim() || '第 ' + (i + 1) + ' 幕',
        startSec:Math.max(0, num(s.startSec)), durationSec:Math.max(.05, num(s.durationSec, 3) || 3), subtitle:str(s.subtitle).trim(), thumbUrl:str(s.thumbUrl), hasVoice:!!s.hasVoice,
        sfx:arr(s.sfx).filter(x => x).map(x => ({type:str(x.type, 'sfx') || 'sfx', t:num(x.t, -1)})).filter(x => x.t >= 0), locked:!!s.locked})),
      music:arr(tl.music).filter(m => m).map(m => ({name:str(m.name).trim() || '配乐', startSec:Math.max(0, num(m.startSec)), endSec:Math.max(0, num(m.endSec))}))},
    preview:{mp4Url:str(pv.mp4Url), posterUrl:str(pv.posterUrl), hasMp4:!!pv.hasMp4, durationSec:Math.max(0, num(pv.durationSec))},
    director:{topic:str(dr.topic), engine:dr.engine === 'html' ? 'html' : 'remotion', creationMode:dr.creationMode === 'fast-draft' ? 'fast-draft' : 'ai-coded', aspectRatio:str(dr.aspectRatio, 'auto') || 'auto',
      quality:str(dr.quality, '1080p') || '1080p', fps:num(dr.fps, 30) || 30, durationMode:dr.durationMode === 'custom' ? 'custom' : 'auto', targetDurationSec:num(dr.targetDurationSec, 120) || 120,
      narrationMode:str(dr.narrationMode, 'tts') || 'tts', bgmMode:str(dr.bgmMode), pacingMode:str(dr.pacingMode, 'auto') || 'auto', style:str(dr.style), voiceId:str(dr.voiceId, 'auto') || 'auto',
      avatarEnabled:!!dr.avatarEnabled, avatarLayout:['pip-br', 'pip-bl', 'fullscreen'].includes(dr.avatarLayout) ? dr.avatarLayout : 'pip-br'},
    options:{engines:opts(op.engines), creationModes:opts(op.creationModes), aspectRatios:opts(op.aspectRatios), qualities:opts(op.qualities), narrationModes:opts(op.narrationModes),
      bgmModes:opts(op.bgmModes), pacingModes:opts(op.pacingModes), styles:styleOpts(op.styles), voices:opts(op.voices), avatarLayouts:opts(op.avatarLayouts)},
    status:{llm:{configured:!!sub('llm').configured, label:str(sub('llm').label)}, tts:{ready:!!sub('tts').ready, label:str(sub('tts').label)},
      gpu:{label:str(sub('gpu').label), lowSpecMode:str(sub('gpu').lowSpecMode)}, lipsync:{ready:!!sub('lipsync').ready, label:str(sub('lipsync').label)}},
    counts:{plazaTemplates:Math.max(0, num(cn.plazaTemplates)), voices:Math.max(0, num(cn.voices))},
    flags:{ref:!!(o.projectFlags && o.projectFlags.hasReferenceVideo), history:Math.max(0, num(o.projectFlags && o.projectFlags.historyCount))}};
}

let waveSig = '';
const EMPTY_TL = {totalSec:0, fps:30, bpm:null, beats:[], drops:[], scenes:[], music:[]};
function rebuildModel(W) {
  const p = W.project, tl = p ? W.timeline : EMPTY_TL;
  const sc = tl.scenes.slice().sort((a, b) => a.startSec - b.startSec || a.index - b.index);
  const end = sc.reduce((m, s) => Math.max(m, s.startSec + s.durationSec), 0);
  const total = Math.max(tl.totalSec, end, tl.music.reduce((m, x) => Math.max(m, x.endSec), 0));
  PROJ.has = !!p; PROJ.title = p ? p.title : ''; PROJ.real = total > 0; PROJ.dur = total > 0 ? total : 60;
  PROJ.fps = tl.fps || (p && p.fps) || 30; PROJ.bpm = tl.bpm || 0;
  PROJ.drops = tl.drops.filter(d => d <= PROJ.dur + .5).sort((a, b) => a - b);
  PROJ.w = p && p.width > 0 ? p.width : 1920; PROJ.h = p && p.height > 0 ? p.height : 1080; PROJ.engine = p ? p.engine : 'remotion';
  NOSCENE.dur = NOSCENE.end = PROJ.dur;
  BEATS = tl.beats.filter(b => b.t <= PROJ.dur + .5).sort((a, b) => a.t - b.t).map(b => ({t:b.t, s:b.strong}));
  SCENES = sc.map((s, i) => { const st = s.startSec, du = s.durationSec, en = st + du;
    const sfx = s.sfx.map(x => ({k:x.type, g:sfxGlyphOf(x.type), t:x.t, sc:i}));
    const heavy = sfx.filter(x => x.g === 'hi').length, drop = PROJ.drops.some(d => d >= st && d < en);
    return {i, no:i + 1, id:s.id, title:s.title, start:st, dur:du, end:en, sub:s.subtitle, sfx, thumb:s.thumbUrl, voice:s.hasVoice, locked:s.locked, mode:drop ? 'd' : (heavy >= 2 || sfx.length >= 4) ? 'f' : 'c'}; });
  SFX = SCENES.flatMap(s => s.sfx).sort((a, b) => a.t - b.t);
  MUSIC = tl.music.filter(m => m.endSec > m.startSec || m.endSec === 0).map(m => ({name:m.name, s0:m.startSec, s1:m.endSec > m.startSec ? m.endSec : PROJ.dur}));
  const idx = {}; SCENES.forEach(s => { idx[s.id] = s.i; });
  ASSETS = W.assets.map((a, k) => ({id:a.id, kind:a.kind, f:KIND[a.kind].f, name:a.name, url:a.url, thumb:a.thumbUrl, dur:a.durationSec, w:a.width, h:a.height, ext:extOf(a.name), n:k,
    used:[...new Set(a.usedBySceneIds.map(id => idx[id]).filter(i => i != null))].sort((x, y) => x - y)}));
  STAGED = W.staging.map(s => ({id:s.id, kind:s.kind, name:s.name, url:s.url, thumb:s.thumbUrl, provider:s.provider, prompt:s.prompt, ext:extOf(s.name)}));
  const sig = PROJ.dur.toFixed(2) + '|' + BEATS.length + '|' + (BEATS.length ? BEATS[0].t + ':' + BEATS[BEATS.length - 1].t : '') + '|' + PROJ.drops.join(',') + '|' + MUSIC.length + '|' +
    SCENES.map(s => s.start.toFixed(2) + ':' + s.dur.toFixed(2) + ':' + s.sub.length + (s.voice ? 'v' : '')).join(',');
  if (sig !== waveSig) { waveSig = sig; rebuildWaves(); }
}
const assetSub = A => [A.ext || KIND[A.kind].cn, A.dur ? A.dur.toFixed(1) + 's' : '', A.w && A.h ? A.w + '×' + A.h : ''].filter(Boolean).join(' · ');
const sceneRange = used => { if (!used.length) return ''; const f = i => 'S' + String(i + 1).padStart(2, '0'); return used.length === 1 ? f(used[0]) : f(used[0]) + (used.length === 2 ? ' · ' : '–') + f(used[used.length - 1]) + (used.length > 2 ? ' ×' + used.length : ''); };
