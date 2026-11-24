/* ============================================================================================================
 * PK · 分步精修 steps 「分镜精修」(scenes) + 「交付」(delivery)                       — owner: panel agent B
 *
 * scenes  : scene list | monitor (成片 MP4 / HTML 动态预演 / 九宫格, safe-zone guides, 指哪改哪 region pick)
 *           + multi-track timeline (V1 分镜 · T1 字幕配音 · S1 音效 · A1 BGM) | inspector (分镜手调 · 对 AI 说 · 保护与锁定)
 * delivery: render (720P 审片 / 成品) with job progress, QA 体检单, 深度质检, 示波器, 调色 LUT, 专业交付包, MOTION.md,
 *           源码检视, links to 发布资料包 (export) and 版本历史 (history)
 * also    : hidden panels `code` (工程源码检视) and `scLightbox` (大图 / 视频预览)
 *
 * Drafts never live in the DOM: every hand edit is a field-level PATCH kept in the step scope (`s.local.patch`) and
 * applied on top of the latest server script at render time, so host refreshes never wipe what the user typed and a
 * save always rebases onto the newest script.json. Saving = `script` POST + scene-override protection
 * (`project/scene-overrides/batch`, so an AI re-run keeps every hand edit) + global subtitle track re-sync.
 * ============================================================================================================ */
;(function () {
  'use strict'
  const PK = window.PK
  if (!PK || typeof PK.studioStep !== 'function') return
  const U = PK.util
  const h = PK.h
  const ui = PK.ui
  const num = U.num

  /* ================================================================ constants (ported from the classic UI) */
  const QUICK_FIX_PILLS = [
    { label: 'AI 自由手写本幕 3D+SVG', prompt: '根据本幕台词与主题，使用 FreeformThreeStage 与内联动态 SVG 从零自由编写独一无二的 3D 场景与 2D 矢量图表动画，突破固定预设' },
    { label: '换成动态 SVG 架构图', prompt: '将当前镜头改为动态 SVG 系统架构拓扑图与光子数据流展示' },
    { label: '换成 HUD 遥测代码面板', prompt: '将当前镜头改为全息 HUD 遥测环形仪表与实时 TSX 代码流展示' },
    { label: '节奏加快一倍', prompt: '把全片切换节奏加快，转场更有冲击力，单幕更干脆利落', scope: 'global' },
    { label: '动效粒子更炫酷', prompt: '升级当前幕前景视觉特效与动效代码，加入光影扫描和数字动效，确保文字清晰' },
    { label: '加大重点字幕字号', prompt: '显著放大画面标题与关键字幕字号，提高文字与背景对比度，适合手机端一眼看清' },
    { label: '鼓点配乐更燃', prompt: '重编 BGM 与转场音效节奏，鼓点更有力量感并与分镜切点对齐', scope: 'global' },
  ]
  const TRANSITIONS = [
    { value: 'cut', label: '直接硬切', hint: 'cut' },
    { value: 'flash-cut', label: '闪白快切', hint: 'flash-cut' },
    { value: 'slash-wipe', label: '斜切划像', hint: 'slash-wipe' },
    { value: 'zoom-punch', label: '冲击推镜', hint: 'zoom-punch' },
    { value: 'glitch-cut', label: '故障闪切', hint: 'glitch-cut' },
    { value: 'light-wipe', label: '光扫转场', hint: 'light-wipe' },
    { value: 'iris-circle', label: '圆形开合', hint: 'iris-circle' },
    { value: 'block-wipe', label: '方块擦除', hint: 'block-wipe' },
  ]
  const TX_CYCLE = ['flash-cut', 'slash-wipe', 'zoom-punch', 'glitch-cut', 'light-wipe', 'iris-circle', 'block-wipe', 'cut']
  const SFX_TYPES = [
    ['slash', '斩切'], ['hit', '重击'], ['sub_drop', '低频下坠'], ['whoosh', '呼啸划过'], ['click', '点击'], ['typing', '打字'],
    ['counter', '数字滚动'], ['radar', '雷达扫描'], ['shutter', '快门'], ['boing', '弹簧'], ['chime', '提示风铃'], ['sparkle', '闪光'],
    ['stamp', '盖章'], ['bell_warm', '温暖铃声'], ['swoosh', '轻扫'], ['glitch', '故障噪声'], ['pop', '弹出'], ['pop_soft', '轻弹'],
    ['thud', '闷响'], ['card', '卡片翻入'], ['flip', '翻页'], ['riser', '上升铺垫'], ['suck', '吸入'], ['crash_cym', '镲片'],
    ['tick', '滴答'], ['shine', '亮光'], ['shimmer_swell', '微光渐强'], ['metal_clash', '金属撞击'], ['metal_clash_hi', '金属脆响'],
    ['metal_clash_heavy', '金属重击'], ['blade_whoosh', '刀锋破风'], ['slash_sweep', '横扫斩'], ['war_drum', '战鼓'],
    ['heavy_impact', '重型冲击'], ['horse_gallop', '马蹄奔腾'], ['hoof_stomp', '马蹄踏地'], ['arrow_zip', '箭矢飞过'],
  ].map(([value, label]) => ({ value, label, hint: value }))
  const SFX_LABEL = Object.fromEntries(SFX_TYPES.map((o) => [o.value, o.label]))
  const SPEECH_RATES = [
    { value: '0.85', label: '0.85× 舒缓' },
    { value: '0.95', label: '0.95× 稳重' },
    { value: '1.00', label: '1.00× 标准' },
    { value: '1.06', label: '1.06× 明快' },
    { value: '1.12', label: '1.12× 紧凑' },
    { value: '1.20', label: '1.20× 极速' },
  ]
  const BASE_EMOTIONS = ['平静', '高兴', '激昂', '温和', '自信', '严肃', '期待', '深沉', '伤心']
  const DELIVERY_FORMATS = [
    { value: 'srt', label: 'SRT 字幕' },
    { value: 'vtt', label: 'WebVTT 字幕' },
    { value: 'stems', label: '人声 / 音效 / 配乐 分轨' },
    { value: 'fcpxml', label: 'FCPXML（Final Cut / 达芬奇）' },
    { value: 'xmeml', label: 'XML（Premiere）' },
  ]
  const SCOPE_LABELS = { waveform: '亮度波形', vectorscope: '矢量示波器', histogram: '直方图', frame: '分析画面' }
  const AI_LAYOUT = '__ai-code__'
  const FALLBACK_LAYOUTS = [
    ['3d-stage-opener', 'Three.js 3D 空间开场', '三维透视卡片群 + 3D 几何舞台'],
    ['svg-architecture-flow', '动态 SVG 架构拓扑图', '5 种系统拓扑 + 贝塞尔光子总线'],
    ['hud-telemetry-dashboard', 'HUD 遥测数据与代码流', '实时 TSX 代码流 + 环形仪表 + 波形'],
    ['vibecoding-spring-stage', 'Vibecoding 节拍弹簧舞台', '双栏弹簧物理联动 + 拓扑/遥测'],
    ['app-focus-shot', '软件窗口推镜特写', 'AppWindow + 焦点放大镜'],
    ['workflow-steps', '多步流程演进卡片', '3~5 步横向流程拆解'],
    ['metric-dashboard', '核心数据增长看板', '滚动数字 + 进度矩阵 + 架构视窗'],
    ['split-wipe-compare', 'A/B 滑动擦除对比', '双画面动态分割线对比'],
    ['multi-window-trio', '三联多视窗矩阵', '三窗口并列脉冲高亮'],
    ['card-fan-opener', '扇形图集阵列开场', '多图弧形扇面展开'],
    ['mosaic-pulse-wall', '节拍脉冲图墙', '6 宫格随音乐鼓点跃动'],
    ['kinetic-impact', '高能大字冲击卡点', '逐字弹簧冲击 + 粒子光环'],
    ['radial-climax', '终幕流光印章收尾', '放射速度线 + 品牌落版印章'],
    ['narrative-diorama', '东方史诗剪影剧场', '水墨剪影 + 竖排书法 (历史专用)'],
  ].map(([value, label, hint]) => ({ value, label, hint }))
  const FALLBACK_THREE = [
    ['orbital-core', '星环核心 (orbital-core)'],
    ['cyber-terrain', '赛博山谷网格 (cyber-terrain)'],
    ['particle-vortex', '量子粒子星云 (particle-vortex)'],
    ['floating-monoliths', '悬浮几何碑林 (floating-monoliths)'],
    ['chrono-helix', '时空双螺旋 (chrono-helix)'],
    ['matrix-cubes', '全息算力矩阵 (matrix-cubes)'],
  ].map(([value, label]) => ({ value, label }))
  const FALLBACK_KENBURNS = [
    ['zoom-in', '缓推拉近 (Zoom In)'],
    ['zoom-out', '缓拉远景 (Zoom Out)'],
    ['pan-left', '横向左移 (Pan Left)'],
    ['pan-right', '横向右移 (Pan Right)'],
    ['static', '锁定静止 (Static)'],
  ].map(([value, label]) => ({ value, label }))
  const FALLBACK_ASPECTS = [
    { value: '16:9', label: '16:9 横屏' },
    { value: '9:16', label: '9:16 竖屏' },
    { value: '3:4', label: '3:4 竖版 · 小红书' },
    { value: '1:1', label: '1:1 方屏' },
    { value: '4:3', label: '4:3 复古' },
  ]
  const FALLBACK_QUALITIES = [
    { value: '720p', label: '720P 极速预览' },
    { value: '1080p', label: '1080P 全高清' },
    { value: '2k', label: '2K 超清' },
    { value: '4k', label: '4K 超清母带' },
  ]
  const FALLBACK_PLATFORMS = [
    { value: 'universal', label: '通用全平台', hint: '标准 5% 安全边距' },
    { value: 'douyin', label: '抖音 / 视频号', hint: '避让右侧点赞与底部字幕区' },
    { value: 'bilibili', label: 'B站 / YouTube', hint: '横屏片头与弹幕防遮挡' },
    { value: 'xiaohongshu', label: '小红书图文视频', hint: '底部文案与首图防裁切' },
  ]
  // human-edit protection: field → label shown to the user
  const FIELD_LABELS = {
    title: '标题', narration: '旁白', subtitleText: '字幕', emotion: '情绪', voiceId: '音色', voiceLocked: '音色', voiceCastBy: '音色',
    speechRate: '语速', layout: '布局', useBuiltinLayout: '布局', threePreset: '3D 舞台', kenBurns: '运镜', transition: '转场',
    durationSec: '时长', durationInFrames: '时长', sfxCues: '音效', media: '画面素材', assetPaths: '画面素材',
  }
  const fieldNames = (fields) => {
    const keys = Array.isArray(fields) ? fields : Object.keys(fields || {})
    const out = []
    for (const k of keys) {
      if (k === 'voiceLocked' || k === 'voiceCastBy') continue
      const l = FIELD_LABELS[k] || k
      if (!out.includes(l)) out.push(l)
    }
    return out
  }

  /* ================================================================ structural CSS (colours only from --pk-*) */
  // Injected FIRST in <head> and unlayered: kit.css and the skin's own rules come later, so a skin rule of equal
  // specificity always wins, while these scoped (2-class) layout rules still beat the generic one-class primitives.
  // (A cascade @layer would lose even to a skin's `* { padding: 0 }` reset.) Skin hooks: .pk-sc-* / .pk-dl-* / .pk-codev-*
  const SC_CSS = `
.pk-sc{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;--sc-list:clamp(220px,17cqw,300px);--sc-insp:clamp(340px,26cqw,470px)}
.pk-sc-main{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:var(--sc-list) minmax(0,1fr) var(--sc-insp)}
.pk-sc-col{min-width:0;min-height:0;display:flex;flex-direction:column}
.pk-sc-list{border-right:1px solid var(--pk-line);background:color-mix(in srgb,var(--pk-bg2) 45%,transparent)}
.pk-sc-insp{border-left:1px solid var(--pk-line);background:color-mix(in srgb,var(--pk-bg2) 45%,transparent)}
.pk-sc-colh{flex:none;display:flex;align-items:center;gap:8px;min-width:0;min-height:44px;padding:7px 12px;border-bottom:1px solid var(--pk-line);flex-wrap:wrap}
.pk-sc-colh-t{font:700 13.5px/1.3 var(--pk-font-title);color:var(--pk-ink);white-space:nowrap}
.pk-sc-scroll{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;padding:12px 14px 18px;display:flex;flex-direction:column;gap:14px}
.pk-sc-list .pk-sc-scroll{padding:8px;gap:6px}
.pk-sc-list .pk-item{padding:7px 8px;gap:8px}
.pk-sc-list .pk-item-thumb{width:64px}
.pk-sc-list .pk-item-r{max-width:none;flex-wrap:nowrap}
.pk-sc-ics{display:inline-flex;align-items:center;gap:4px;flex:none}
.pk-sc-ic{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:5px;color:var(--pk-ink3)}
.pk-sc-ic.is-lock{color:var(--pk-warn)}
.pk-sc-ic.is-guard{color:var(--pk-ok)}
.pk-sc-ic.is-mute{color:var(--pk-err)}
.pk-sc-dot{display:none;width:8px;height:8px;border-radius:50%;background:var(--pk-warn);flex:none}
.pk-sc-dot.is-dirty{display:inline-block}
.pk-sc-center{min-width:0;display:flex;flex-direction:column;container-type:inline-size;container-name:sccenter}
@container sccenter (max-width: 860px){
  .pk-sc-monbar .pk-seg-b>span{display:none}
  .pk-sc-tlh .pk-sc-snap .pk-btn-l{display:none}
  .pk-sc-tc{padding:5px 6px;font-size:11.5px}
}
.pk-sc-monbar{flex:none;display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;padding:7px 12px;border-bottom:1px solid var(--pk-line)}
.pk-sc-monbar .pk-seg-b{min-height:26px;padding:2px 9px}
.pk-sc-tc{font:700 12.5px/1 var(--pk-font-mono);color:var(--pk-ink2);padding:6px 8px;border-radius:var(--pk-radius-sm);background:var(--pk-bg2);white-space:nowrap}
.pk-sc-monbar .pk-sc-fmt{max-width:min(260px,40%)}
.pk-sc-monbar .pk-sc-listtoggle{display:none}
.pk-sc-iconon{color:var(--pk-acc)!important;border-color:color-mix(in srgb,var(--pk-acc) 55%,transparent)!important;background:var(--pk-acc-soft)!important}
.pk-sc-slot{flex:1 1 auto;min-height:150px;position:relative;margin:10px 12px 8px;border-radius:var(--pk-radius);background:color-mix(in srgb,var(--pk-bg3) 70%,#000 30%)}
.pk-sc-monnote{flex:none;margin:0 12px 6px;display:flex;flex-wrap:wrap;gap:6px}
.pk-sc-screenhost{position:absolute;z-index:3;display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:none;border-radius:var(--pk-radius)}
.pk-sc-screenhost[hidden]{display:none!important}
.pk-sc-stage{position:relative;flex:none;overflow:hidden;background:#000;border-radius:calc(var(--pk-radius) - 2px);box-shadow:0 10px 36px rgba(0,0,0,.35),0 0 0 1px var(--pk-line);pointer-events:auto;container-type:size;container-name:scstage}
.pk-sc-media{position:absolute;inset:0}
.pk-sc-media>video,.pk-sc-media>iframe,.pk-sc-media>img{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;object-fit:contain;background:#000}
.pk-sc-poster{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;text-align:center;color:#d6dbe8;font-size:12.5px;background:#05070c}
.pk-sc-poster>img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:.32}
.pk-sc-poster>*:not(img){position:relative}
.pk-sc-poster-c{display:flex;flex-direction:column;align-items:center;gap:8px;max-width:min(92%,340px);padding:12px 14px;border-radius:10px;background:rgba(5,7,12,.82);box-shadow:0 0 0 1px rgba(255,255,255,.08)}
.pk-sc-poster-c b{font-size:13.5px;color:#fff}
.pk-sc-poster-c span{line-height:1.55;overflow-wrap:anywhere}
.pk-sc-ov{position:absolute;inset:0;pointer-events:none}
.pk-sc-safe-b{position:absolute;display:flex;align-items:center;justify-content:center;border:1.5px dashed #f5b942;background:rgba(245,185,66,.14);container-type:size}
.pk-sc-safe-b.is-danger{border-color:#fb7185;background:rgba(244,63,94,.2)}
.pk-sc-safe-b>span{max-width:94%;padding:1px 6px;border-radius:5px;background:rgba(0,0,0,.76);color:#fff;font:700 12px/1.45 var(--pk-font);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pk-sc-safe-l{display:none}
@container (min-width: 150px) and (min-height: 24px){.pk-sc-safe-l{display:inline}}
.pk-sc-legend{display:inline-flex;flex-wrap:wrap;align-items:center;gap:2px 10px;font-size:11.5px;color:var(--pk-ink2);min-width:0}
.pk-sc-legend>span{overflow-wrap:anywhere}
.pk-sc-legend b{display:inline-grid;place-items:center;min-width:16px;height:16px;margin-right:3px;border-radius:4px;background:rgba(245,185,66,.25);color:var(--pk-ink);font:700 10.5px/1 var(--pk-font-mono)}
.pk-sc-notice{position:absolute;left:8px;right:8px;top:8px;padding:5px 10px;border-radius:7px;background:rgba(10,14,24,.86);color:#fde68a;font:700 12px/1.5 var(--pk-font);pointer-events:none;overflow-wrap:anywhere}
.pk-sc-notice-s{display:none}
@container scstage (max-width: 330px) or (max-height: 250px){
  .pk-sc-notice{left:4px;right:4px;top:4px;padding:3px 6px;font-size:12px}
  .pk-sc-notice-l{display:none}
  .pk-sc-notice-s{display:inline}
  .pk-sc-poster{padding:6px;gap:6px}
  .pk-sc-poster-c{padding:8px;gap:6px;max-width:96%}
  .pk-sc-poster-c span{display:none}
}
@container scstage (max-width: 160px){
  .pk-sc-poster-c .pk-btn-l{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
  .pk-sc-poster-c .pk-btn{width:32px;height:32px;min-height:0;padding:0;border-radius:50%;justify-content:center}
}
@container scstage (max-height: 120px){
  .pk-sc-poster-c b{display:none}
}
.pk-sc-region{position:absolute;inset:0;pointer-events:none}
.pk-sc-region.is-picking{pointer-events:auto;cursor:crosshair;background:rgba(0,0,0,.18)}
.pk-sc-region-box{position:absolute;border:2px solid var(--pk-acc);background:color-mix(in srgb,var(--pk-acc) 18%,transparent);box-shadow:0 0 0 9999px rgba(0,0,0,.28)}
.pk-sc-region-box>span{position:absolute;left:0;top:-24px;padding:2px 7px;border-radius:5px;background:var(--pk-acc);color:var(--pk-acc-ink);font:700 12px/1.5 var(--pk-font);white-space:nowrap}
.pk-sc-tl{flex:none;display:flex;flex-direction:column;height:clamp(176px,36%,268px);border-top:1px solid var(--pk-line);min-height:0}
.pk-sc-tlh{flex:none;display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 12px;border-bottom:1px solid var(--pk-line)}
.pk-sc-tlh .pk-seg-b{min-height:24px;padding:1px 8px;font-size:11.5px}
.pk-sc-tlh-t{font:700 12.5px/1.3 var(--pk-font-title);color:var(--pk-ink);white-space:nowrap}
.pk-sc-tlh .pk-sc-tltoggle{width:24px;height:24px;min-height:0;margin-left:-4px}
.pk-sc[data-tl="off"] .pk-sc-tl{height:auto}
.pk-sc[data-tl="off"] .pk-sc-tracks{display:none}
.pk-sc[data-tl="off"] .pk-sc-tlh{border-bottom:0}
.pk-sc-tracks{flex:1 1 auto;min-height:0;overflow:auto;padding:8px 12px 10px;display:flex;flex-direction:column;gap:6px;--sc-zoom:1}
.pk-sc-trk{display:flex;align-items:stretch;gap:8px;min-width:calc(var(--sc-n,4) * 140px * var(--sc-zoom) + 96px)}
.pk-sc-trk-l{position:sticky;left:-12px;z-index:1;flex:none;width:84px;display:flex;flex-direction:column;justify-content:center;padding:0 8px 0 2px;background:var(--pk-bg);font:800 11px/1.25 var(--pk-font-mono);color:var(--pk-ink3)}
.pk-sc-trk-l small{font:600 10.5px/1.3 var(--pk-font);color:var(--pk-ink3)}
.pk-sc-trk-b{flex:1;display:flex;gap:5px;min-width:0}
.pk-sc-blk,.pk-sc-sub,.pk-sc-sfx{position:relative;flex-basis:0;flex-shrink:1;min-width:calc(132px * var(--sc-zoom));border-radius:8px;border:1px solid var(--pk-line);background:var(--pk-bg2);min-height:0;overflow:hidden}
.pk-sc-blk{display:flex;flex-direction:column;gap:4px;padding:5px 7px;cursor:pointer}
.pk-sc-blk:hover{border-color:var(--pk-line2)}
.pk-sc-blk.is-sel{border-color:var(--pk-acc);box-shadow:inset 0 0 0 1px var(--pk-acc);background:var(--pk-acc-soft)}
.pk-sc-blk.is-play{border-color:var(--pk-info)}
.pk-sc-blk.is-locked::after{content:'';position:absolute;inset:0;border-radius:inherit;border:1px dashed color-mix(in srgb,var(--pk-warn) 70%,transparent);pointer-events:none}
.pk-sc-blk-h{display:flex;align-items:center;gap:6px;min-width:0}
.pk-sc-blk-h img{width:34px;height:22px;border-radius:4px;object-fit:cover;flex:none;background:var(--pk-bg3)}
.pk-sc-blk-n{font:800 11px/1.2 var(--pk-font-mono);color:var(--pk-acc);white-space:nowrap;flex:none}
.pk-sc-blk-t{font:700 11.5px/1.3 var(--pk-font);color:var(--pk-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.pk-sc-blk-c{display:flex;align-items:center;gap:3px;flex-wrap:wrap}
.pk-sc-blk-c .pk-btn--sm.pk-btn--icon{width:24px;height:24px}
.pk-sc-tx{margin-left:auto;max-width:100%;height:22px;padding:0 7px;border-radius:5px;border:1px solid color-mix(in srgb,var(--pk-acc) 45%,transparent);background:var(--pk-acc-soft);color:var(--pk-acc);font:700 10.5px/1 var(--pk-font);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pk-sc-prog{position:absolute;left:0;bottom:0;height:2px;background:var(--pk-info);width:0;pointer-events:none}
.pk-sc-sub{padding:4px 8px;font-size:11.5px;color:var(--pk-ink2);white-space:nowrap;text-overflow:ellipsis;cursor:pointer}
.pk-sc-sub.is-sel{border-color:color-mix(in srgb,var(--pk-acc) 55%,transparent);color:var(--pk-ink)}
.pk-sc-sfx{display:flex;align-items:center;align-content:center;flex-wrap:wrap;gap:3px 4px;padding:3px 6px;border-style:dashed}
.pk-sc-cue{flex:none;display:inline-flex;align-items:center;gap:3px;max-width:100%;height:22px;padding:0 6px;border-radius:5px;border:0;background:var(--pk-acc-soft);color:var(--pk-ink);font:700 10.5px/1 var(--pk-font);cursor:pointer;white-space:nowrap}
.pk-sc-cue:hover{background:color-mix(in srgb,var(--pk-err) 20%,transparent)}
.pk-sc-cue-more{font:700 10.5px/1 var(--pk-font-mono);color:var(--pk-ink3);white-space:nowrap}
.pk-sc-cue-add{margin-left:auto;flex:none;height:22px;padding:0 6px;border-radius:5px;border:1px dashed var(--pk-line2);background:transparent;color:var(--pk-ink2);font:700 10.5px/1 var(--pk-font);cursor:pointer;white-space:nowrap}
.pk-sc-bgm{flex:1;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:5px 10px;border-radius:8px;border:1px solid color-mix(in srgb,var(--pk-ok) 40%,transparent);background:color-mix(in srgb,var(--pk-ok) 9%,transparent);font-size:12px;color:var(--pk-ink2);min-width:0}
.pk-sc-bgm-t{min-width:0;flex:1 1 200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-sc-bgm .pk-slider{min-width:150px}
.pk-sc-bgm .pk-select{min-height:28px;padding:3px 8px;width:auto;min-width:130px}
.pk-sc-tabs{display:none;flex:none;padding:0 12px}
.pk-sc-insh{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}
.pk-sc-insh .pk-select{flex:1 1 160px;min-width:0}
.pk-sc-insp .pk-tabs{flex:none;padding:0 10px}
.pk-sc-insp .pk-sec{gap:8px}
.pk-sc-pills{display:flex;flex-wrap:wrap;gap:6px}
.pk-sc-pills .pk-btn{border-radius:999px;height:auto;min-height:28px;white-space:normal;text-align:left;line-height:1.35;padding:4px 11px}
.pk-sc-guard{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:var(--pk-radius-sm);border:1px dashed var(--pk-line2);background:var(--pk-bg2);font-size:12px;color:var(--pk-ink2);min-width:0}
.pk-sc-guard>span{flex:1;min-width:0;overflow-wrap:anywhere}
.pk-sc-media-list{display:flex;flex-direction:column;gap:6px}
.pk-sc-mitem{display:flex;align-items:center;gap:8px;padding:6px;border-radius:var(--pk-radius-sm);border:1px solid var(--pk-line);background:var(--pk-bg2);min-width:0}
.pk-sc-mitem img,.pk-sc-mitem .pk-sc-mph{width:56px;height:36px;border-radius:5px;object-fit:cover;flex:none;background:var(--pk-bg3);display:grid;place-items:center;color:var(--pk-ink3)}
.pk-sc-mitem b{display:block;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-sc-mitem small{display:block;font-size:11px;color:var(--pk-ink3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-sc-mitem>div{flex:1;min-width:0}
.pk-sc-cues{display:flex;flex-direction:column;gap:5px}
.pk-sc-cuerow{display:grid;grid-template-columns:minmax(0,1fr) 84px 76px auto;gap:6px;align-items:center}
.pk-sc-cuerow>b{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-sc-cuerow .pk-input{min-height:30px;padding:4px 7px}
.pk-sc-durrow{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pk-sc-durrow .pk-input{width:96px;flex:none}
.pk-sc-job{flex:none;display:flex;flex-direction:column;gap:6px;padding:8px 14px;border-bottom:1px solid var(--pk-line);background:var(--pk-acc-soft)}
.pk-sc-job[hidden]{display:none}
.pk-sc-job-t{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--pk-ink);min-width:0}
.pk-sc-job-t>span{flex:1;min-width:0;overflow-wrap:anywhere}
.pk-sc-empty{flex:1;display:flex;align-items:center;justify-content:center;padding:24px}
.pk-sc-kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px;font-size:12px;color:var(--pk-ink2)}
.pk-sc-kv>b{color:var(--pk-ink3);font-weight:600;white-space:nowrap}
.pk-sc-kv>span{min-width:0;overflow-wrap:anywhere}
.pk-sc-rowbtns{display:flex;flex-wrap:wrap;gap:6px}
.pk-sc-range{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px}
.pk-sc-lockrow{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:var(--pk-radius-sm);border:1px solid var(--pk-line);background:var(--pk-bg2);min-width:0}
.pk-sc-lockrow.is-locked{border-color:color-mix(in srgb,var(--pk-warn) 55%,transparent)}
.pk-sc-lockrow>div{flex:1;min-width:0}
.pk-sc-lockrow b{display:block;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-sc-lockrow small{display:block;font-size:11.5px;color:var(--pk-ink3);overflow-wrap:anywhere}
@container pkbody (max-width: 1279px){
  .pk-sc-monbar .pk-sc-listtoggle{display:inline-flex}
  .pk-sc{--sc-insp:clamp(330px,34cqw,400px)}
  .pk-sc-main{grid-template-columns:minmax(0,1fr) var(--sc-insp)}
  .pk-sc-list{display:none}
  .pk-sc[data-list="on"] .pk-sc-main{grid-template-columns:200px minmax(0,1fr) var(--sc-insp)}
  .pk-sc[data-list="on"] .pk-sc-list{display:flex}
  .pk-sc[data-list="on"] .pk-sc-list .pk-item-thumb{display:none}
}
@container pkbody (max-width: 899px){
  .pk-sc-tabs{display:block}
  .pk-sc-main,.pk-sc[data-list="on"] .pk-sc-main{grid-template-columns:minmax(0,1fr)}
  .pk-sc-list,.pk-sc[data-list="on"] .pk-sc-list,.pk-sc-insp,.pk-sc-center{display:none;border:0}
  .pk-sc[data-tab="preview"] .pk-sc-center,.pk-sc[data-tab="edit"] .pk-sc-insp,.pk-sc[data-tab="list"] .pk-sc-list{display:flex}
  .pk-sc[data-tab="list"] .pk-sc-list .pk-item-thumb{display:block}
  .pk-sc-monbar .pk-sc-listtoggle{display:none}
}
@media (max-height: 760px){
  .pk-sc-tl{height:clamp(150px,40%,206px)}
  .pk-sc-slot{min-height:120px;margin:6px 10px 6px}
  .pk-sc-colh,.pk-sc-monbar{min-height:0;padding-top:5px;padding-bottom:5px}
  .pk-sc-blk-h img{display:none}
}
.pk-dl{display:flex;flex-direction:column;gap:18px;min-width:0}
.pk-dl .pk-sec{padding:14px 16px;border-radius:var(--pk-radius-lg);border:1px solid var(--pk-line);background:color-mix(in srgb,var(--pk-bg2) 55%,transparent)}
.pk-dl-player{position:relative;margin:0 auto;max-width:100%;border-radius:var(--pk-radius);overflow:hidden;background:#000}
.pk-dl-player>video{width:100%;height:100%;display:block;object-fit:contain;background:#000}
.pk-dl-noplayer{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:220px;padding:20px;border-radius:var(--pk-radius);border:1px dashed var(--pk-line2);color:var(--pk-ink3);text-align:center;font-size:13px}
.pk-dl-checks{display:flex;flex-direction:column;gap:6px}
.pk-dl-check{display:flex;gap:9px;align-items:flex-start;padding:8px 10px;border-radius:var(--pk-radius-sm);border:1px solid var(--pk-line);background:var(--pk-bg2);min-width:0}
.pk-dl-check-i{flex:none;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;margin-top:1px;color:var(--pk-ink3)}
.pk-dl-check.is-ok .pk-dl-check-i{color:var(--pk-ok)}
.pk-dl-check.is-err{border-color:color-mix(in srgb,var(--pk-err) 50%,transparent)}
.pk-dl-check.is-err .pk-dl-check-i{color:var(--pk-err)}
.pk-dl-check.is-warn{border-color:color-mix(in srgb,var(--pk-warn) 50%,transparent)}
.pk-dl-check.is-warn .pk-dl-check-i{color:var(--pk-warn)}
.pk-dl-check-b{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.pk-dl-check-b>b{font-size:12.5px;color:var(--pk-ink);overflow-wrap:anywhere}
.pk-dl-check-b>span{font:11.5px/1.5 var(--pk-font-mono);color:var(--pk-ink2);overflow-wrap:anywhere}
.pk-dl-figs{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(220px,100%),1fr));gap:10px}
.pk-dl-fig{margin:0;display:flex;flex-direction:column;gap:4px;min-width:0;cursor:zoom-in}
.pk-dl-fig img{width:100%;border-radius:var(--pk-radius-sm);border:1px solid var(--pk-line);background:#000;display:block}
.pk-dl-fig figcaption{font-size:11.5px;color:var(--pk-ink3);text-align:center}
.pk-dl-links{display:flex;flex-direction:column;gap:4px}
.pk-dl-links a{display:flex;align-items:center;gap:6px;min-width:0;color:var(--pk-acc);text-decoration:none;font-size:12.5px}
.pk-dl-links a>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-dl-snap{width:100%;border-radius:var(--pk-radius-sm);border:1px solid var(--pk-line);display:block;cursor:zoom-in}
a.pk-btn{text-decoration:none}
.pk-codev{display:grid;grid-template-columns:clamp(200px,26%,300px) minmax(0,1fr);min-height:0;height:min(78vh,900px);max-height:100%}
.pk-codev-files{min-height:0;overflow:auto;border-right:1px solid var(--pk-line);padding:10px;display:flex;flex-direction:column;gap:4px}
.pk-codev-f{display:flex;flex-direction:column;align-items:flex-start;gap:1px;width:100%;padding:6px 8px;border:1px solid transparent;border-radius:var(--pk-radius-sm);background:transparent;color:var(--pk-ink2);font:12px/1.4 var(--pk-font-mono);text-align:left;cursor:pointer;overflow-wrap:anywhere}
.pk-codev-f small{font:10.5px/1.3 var(--pk-font);color:var(--pk-ink3)}
.pk-codev-f:hover{background:var(--pk-bg3)}
.pk-codev-f.is-on{border-color:var(--pk-acc);background:var(--pk-acc-soft);color:var(--pk-ink)}
.pk-codev-main{min-width:0;min-height:0;display:flex;flex-direction:column;gap:8px;padding:10px 12px}
.pk-codev-main .pk-code{flex:1 1 auto;max-height:none;min-height:0}
.pk-codev-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.pk-codev-h b{font:700 12.5px/1.4 var(--pk-font-mono);overflow-wrap:anywhere;min-width:0}
@container pkbody (max-width: 700px){.pk-codev{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}.pk-codev-files{max-height:160px;border-right:0;border-bottom:1px solid var(--pk-line)}}
.pk-lb{display:flex;flex-direction:column;align-items:center;gap:10px;min-width:0}
.pk-lb img,.pk-lb video{max-width:100%;max-height:70vh;object-fit:contain;border-radius:var(--pk-radius);background:#000;display:block}
.pk-lb p{margin:0;max-width:760px;text-align:center;font-size:12.5px;color:var(--pk-ink2);overflow-wrap:anywhere}
`
  function injectCss() {
    if (document.getElementById('pk-sc-css')) return
    const st = document.createElement('style')
    st.id = 'pk-sc-css'
    st.textContent = SC_CSS
    const head = document.head || document.documentElement
    head.insertBefore(st, head.firstChild)
  }
  injectCss()

  /* ================================================================ small helpers */
  const JOBS = new Map() // projectDir → running operation (module-level: survives closing / reopening the studio)
  const THUMBS_REQUESTED = new Set()
  // projectDir → scene ids whose narration was saved but not re-dubbed yet (module-level: survives reopening the studio)
  const REDUB = new Map()
  const redubOf = (dir) => {
    let set = REDUB.get(dir)
    if (!set) REDUB.set(dir, (set = new Set()))
    return set
  }
  // a finished AI run re-dubs every scene
  PK.on('event:run-finished', () => REDUB.delete(PK.dir()))
  let LUT_CACHE = null
  const hash = (str) => {
    let x = 5381
    const s = String(str)
    for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0
    return (x >>> 0).toString(36)
  }
  const relOf = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
  /** same-origin URL of a project file with an explicit cache key (so media does not reload on every host refresh) */
  const fileUrl = (rel, ver) => {
    const d = PK.dir()
    if (!d || !rel) return ''
    return `/api/video-workbench/asset?projectDir=${encodeURIComponent(d)}&rel=${encodeURIComponent(relOf(rel))}&v=${encodeURIComponent(String(ver === undefined ? 0 : ver))}`
  }
  const fpsOf = (script) => (num(script && script.fps) > 0 ? num(script.fps) : 30)
  const sceneNo = (i) => String(i + 1).padStart(2, '0')
  const sceneTitle = (sc, i) => String((sc && sc.title) || `第 ${i + 1} 幕`)
  const clock = (sec) => {
    const t = Math.max(0, num(sec))
    const m = Math.floor(t / 60)
    const s = t - m * 60
    return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
  }
  const isLiveRun = () => {
    const r = PK.state && PK.state.run
    return Boolean(r && ['running', 'queued', 'paused'].includes(r.status))
  }
  const llmReady = () => Boolean(PK.state && PK.state.status && PK.state.status.llm && PK.state.status.llm.configured)
  const optList = (name, fallback) => {
    const l = PK.state && PK.state.options && PK.state.options[name]
    return Array.isArray(l) && l.length ? l : fallback
  }
  const findScene = (script, id) => ((script && Array.isArray(script.scenes) ? script.scenes : []).find((x) => x && x.id === id) || null)
  const withCurrent = (list, value, label) => {
    if (value === undefined || value === null || value === '') return list
    return list.some((o) => String(o.value) === String(value)) ? list : [...list, { value, label: label || String(value), hint: '当前值' }]
  }
  const tip = (el, text) => {
    if (el && text) el.title = text
    return el
  }
  const onBtn = (b, on) => {
    if (!b) return b
    b.classList.toggle('pk-sc-iconon', Boolean(on))
    b.setAttribute('aria-pressed', on ? 'true' : 'false')
    return b
  }
  // thumbnails whose file is missing (e.g. a project copied without its assets) fall back to a placeholder once and
  // are not requested again on every re-render
  const BAD_IMG = new Set()
  const thumbImg = (src, fallback) => {
    if (!src || BAD_IMG.has(src)) return fallback ? fallback() : null
    const img = h('img', { src, alt: '', loading: 'lazy', draggable: 'false' })
    img.addEventListener('error', () => {
      BAD_IMG.add(src)
      if (fallback) img.replaceWith(fallback())
      else img.remove()
    })
    return img
  }
  const linkBtn = (label, href, o = {}) =>
    h(
      'a.pk-btn',
      { class: [`pk-btn--${o.kind || 'secondary'}`, `pk-btn--${o.size || 'md'}`], href, download: o.download === undefined ? '' : o.download, title: o.title || null, target: o.download === false ? '_blank' : null, rel: 'noopener' },
      o.icon ? PK.icon(o.icon, o.size === 'sm' ? 13 : 15) : null,
      h('span.pk-btn-l', null, label),
    )

  /* ================================================================ draft patch model */
  const HIDDEN_KEYS = new Set(['voiceLocked', 'voiceCastBy', 'useBuiltinLayout', 'assetPaths'])
  const emptyPatch = () => ({ scenes: {}, order: null, bgmVolume: undefined })
  const patchOf = (L) => L.patch || (L.patch = emptyPatch())
  const patchEmpty = (p) => !p || (!p.order && p.bgmVolume === undefined && !Object.keys(p.scenes || {}).some((id) => Object.keys(p.scenes[id] || {}).length))
  const isDirty = (L) => Boolean(L && !patchEmpty(L.patch))
  /** human-readable list of pending edits: [{ id, labels[] }], plus order / bgm flags */
  function dirtySummary(L) {
    const p = L && L.patch
    const out = { scenes: [], order: false, bgm: false, count: 0 }
    if (!p) return out
    for (const [id, f] of Object.entries(p.scenes || {})) {
      const labels = fieldNames(Object.keys(f || {}))
      if (labels.length) {
        out.scenes.push({ id, labels })
        out.count += labels.length
      }
    }
    if (p.order) {
      out.order = true
      out.count += 1
    }
    if (p.bgmVolume !== undefined) {
      out.bgm = true
      out.count += 1
    }
    return out
  }
  function same(a, b) {
    if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b)
    const na = a === undefined || a === null ? '' : a
    const nb = b === undefined || b === null ? '' : b
    if (typeof na === 'number' || typeof nb === 'number') {
      const x = Number(na)
      const y = Number(nb)
      if (Number.isFinite(x) && Number.isFinite(y)) return Math.abs(x - y) < 1e-6
    }
    if (typeof na === 'object' || typeof nb === 'object') return JSON.stringify(na) === JSON.stringify(nb)
    return String(na) === String(nb)
  }
  /** set one scene field in the draft (removes the entry again when it equals the server value) */
  function setField(L, server, id, field, value) {
    const p = patchOf(L)
    const base = findScene(server, id)
    const cur = p.scenes[id] || (p.scenes[id] = {})
    if (base && same(base[field], value)) delete cur[field]
    else cur[field] = value === undefined ? undefined : U.cloneJson(value)
    if (!Object.keys(cur).length) delete p.scenes[id]
  }
  /** server script + draft → what the editor shows (timeline recomputed when order / durations changed) */
  function applyPatch(server, p) {
    if (!server) return null
    if (patchEmpty(p)) return server
    const fps = fpsOf(server)
    const src = Array.isArray(server.scenes) ? server.scenes : []
    let scenes = src.map((sc) => {
      const f = sc && p.scenes[sc.id]
      return f ? { ...sc, ...U.cloneJson(f) } : sc
    })
    if (p.order && p.order.length) {
      const byId = new Map(scenes.map((s) => [s.id, s]))
      const seen = new Set()
      const ordered = []
      for (const id of p.order) {
        if (byId.has(id) && !seen.has(id)) {
          ordered.push(byId.get(id))
          seen.add(id)
        }
      }
      for (const s of scenes) if (!seen.has(s.id)) ordered.push(s)
      scenes = ordered
    }
    const durIds = new Set(Object.keys(p.scenes || {}).filter((id) => p.scenes[id] && Object.prototype.hasOwnProperty.call(p.scenes[id], 'durationSec')))
    const out = { ...server }
    if (p.order || durIds.size) {
      let curF = 0
      scenes = scenes.map((sc, i) => {
        const changed = durIds.has(sc.id)
        const dF = !changed && num(sc.durationInFrames) > 0 ? Math.round(num(sc.durationInFrames)) : Math.max(12, Math.round(Math.max(0.4, num(sc.durationSec, 3)) * fps))
        const dSec = changed ? Number((dF / fps).toFixed(4)) : num(sc.durationSec) > 0 ? num(sc.durationSec) : Number((dF / fps).toFixed(4))
        const next = { ...sc, index: i + 1, startFrame: curF, durationInFrames: dF, endFrame: curF + dF, startSec: Number((curF / fps).toFixed(3)), durationSec: dSec, endSec: Number(((curF + dF) / fps).toFixed(3)) }
        curF += dF
        return next
      })
      out.totalDurationInFrames = curF
      out.totalDurationSec = Number((curF / fps).toFixed(3))
    }
    if (p.bgmVolume !== undefined) out.bgm = { ...(server.bgm || {}), volume: p.bgmVolume }
    out.scenes = scenes
    return out
  }

  /* ---------------------------------------------------------------- global subtitle track (script.subtitles) */
  // The renderers prefer script.subtitles (global timing) over scene.subtitles. Hand edits that move scenes (order,
  // durations) or regenerate a scene's subtitles (re-dub, subtitle text) must keep that track in step.
  const subStartOf = (sub) => num(sub && sub.globalStartSec !== undefined ? sub.globalStartSec : sub && sub.startSec)
  function shiftSub(sub, dF, dS) {
    const out = { ...sub }
    const move = (frames, secs) => {
      for (const k of frames) if (out[k] !== undefined && Number.isFinite(Number(out[k]))) out[k] = Number(out[k]) + dF
      for (const k of secs) if (out[k] !== undefined && Number.isFinite(Number(out[k]))) out[k] = Number((Number(out[k]) + dS).toFixed(3))
    }
    if (sub.globalStartFrame !== undefined || sub.globalStartSec !== undefined) move(['globalStartFrame', 'globalEndFrame'], ['globalStartSec', 'globalEndSec'])
    else move(['startFrame', 'endFrame'], ['startSec', 'endSec'])
    return out
  }
  function toGlobalSub(scene, sub, fps) {
    const ls = num(sub.localStartSec !== undefined ? sub.localStartSec : sub.startSec)
    const le = num(sub.localEndSec !== undefined ? sub.localEndSec : sub.endSec, ls)
    const lsf = Number.isFinite(Number(sub.startFrame)) ? num(sub.startFrame) : Math.floor(ls * fps)
    const lef = Number.isFinite(Number(sub.endFrame)) ? num(sub.endFrame) : Math.ceil(le * fps)
    const f0 = num(scene.startFrame)
    const s0 = num(scene.startSec)
    const gss = Number((s0 + ls).toFixed(3))
    const ges = Number((s0 + le).toFixed(3))
    return { ...sub, sceneId: scene.id, localStartSec: ls, localEndSec: le, startSec: gss, endSec: ges, startFrame: f0 + lsf, endFrame: f0 + lef, globalStartSec: gss, globalEndSec: ges, globalStartFrame: f0 + lsf, globalEndFrame: f0 + lef }
  }
  /** returns the new global subtitle list, or null when nothing needs to change */
  function rebuildGlobalSubs(before, after, rebuildIds = []) {
    const subs = after && Array.isArray(after.subtitles) ? after.subtitles : null
    if (!subs || !subs.length) return null
    const fps = fpsOf(after)
    const oldPos = new Map(((before && before.scenes) || []).map((s) => [s.id, s]))
    const newPos = new Map((after.scenes || []).map((s) => [s.id, s]))
    const rebuild = new Set((rebuildIds || []).filter((id) => newPos.has(id)))
    let changed = false
    const out = []
    for (const sub of subs) {
      const id = sub && sub.sceneId
      if (id && rebuild.has(id)) {
        changed = true
        continue
      }
      const o = id ? oldPos.get(id) : null
      const n = id ? newPos.get(id) : null
      if (o && n) {
        const dF = Math.round(num(n.startFrame) - num(o.startFrame))
        const dS = num(n.startSec) - num(o.startSec)
        if (dF || Math.abs(dS) > 0.0005) {
          out.push(shiftSub(sub, dF, dS))
          changed = true
          continue
        }
      }
      out.push(sub)
    }
    for (const id of rebuild) {
      const sc = newPos.get(id)
      for (const sub of (sc && sc.subtitles) || []) if (sub && String(sub.text || '').trim()) out.push(toGlobalSub(sc, sub, fps))
    }
    if (!changed) return null
    out.sort((a, b) => subStartOf(a) - subStartOf(b))
    return out
  }
  async function freshScript() {
    const d = await PK.store.load(true)
    const sc = d && d.activeProject && d.activeProject.script
    if (!sc) throw new PK.Error('读取工程脚本失败，请稍后重试')
    return sc
  }
  /** after a server-side change (re-dub / mastering / subtitle override): rebuild the global subtitle track */
  async function resyncGlobalSubs(before, ids) {
    try {
      const after = await freshScript()
      const next = rebuildGlobalSubs(before, after, ids)
      if (!next) return false
      await PK.postP('script', { script: { ...after, subtitles: next }, regenerateCode: true })
      return true
    } catch (err) {
      console.warn('[PK scenes] subtitle track re-sync skipped', err)
      return false
    }
  }

  /* ---------------------------------------------------------------- human-edit protection (scene overrides) */
  /** which hand edits to protect (only fields the user really edited; values as saved by the backend) */
  function collectOverrides(base, saved, patch) {
    const edits = {}
    const baseById = new Map(((base && base.scenes) || []).map((x) => [x.id, x]))
    const savedById = new Map(((saved && saved.scenes) || []).map((x) => [x.id, x]))
    for (const [id, fields] of Object.entries((patch && patch.scenes) || {})) {
      const prev = baseById.get(id)
      const sc = savedById.get(id)
      if (!prev || !sc) continue
      const out = {}
      for (const f of Object.keys(fields || {})) {
        if (HIDDEN_KEYS.has(f)) continue
        if (f === 'voiceId') {
          if (sc.voiceId && sc.voiceId !== 'auto' && String(prev.voiceId || '') !== String(sc.voiceId)) {
            out.voiceId = sc.voiceId
            out.voiceLocked = true
            out.voiceCastBy = 'manual'
          }
        } else if (f === 'speechRate') {
          if (Math.abs((num(prev.speechRate) || 1) - (num(sc.speechRate) || 1)) > 0.004) out.speechRate = num(sc.speechRate) || 1
        } else if (f === 'durationSec') {
          // frames are exact (durationSec would be re-rounded with ceil() by the backend)
          if (Math.abs(num(prev.durationSec) - num(sc.durationSec)) > 0.03) out.durationInFrames = Math.round(num(sc.durationInFrames))
        } else if (f === 'sfxCues') {
          if (JSON.stringify(prev.sfxCues || []) !== JSON.stringify(sc.sfxCues || [])) out.sfxCues = Array.isArray(sc.sfxCues) ? sc.sfxCues : []
        } else if (f === 'media') {
          if (JSON.stringify(prev.media || []) !== JSON.stringify(sc.media || [])) {
            out.media = Array.isArray(sc.media) ? sc.media : []
            out.assetPaths = Array.isArray(sc.assetPaths) ? sc.assetPaths : out.media.map((m) => m.path).filter(Boolean)
          }
        } else if (f === 'layout') {
          if (String(prev.layout || '') !== String(sc.layout || '')) {
            out.layout = sc.layout || ''
            if (sc.useBuiltinLayout !== undefined) out.useBuiltinLayout = sc.useBuiltinLayout
          }
        } else {
          const a = prev[f] === undefined || prev[f] === null ? '' : String(prev[f])
          const b = sc[f] === undefined || sc[f] === null ? '' : String(sc[f])
          if (a !== b) out[f] = sc[f] === undefined ? '' : sc[f]
        }
      }
      if (Object.keys(out).length) edits[id] = out
    }
    return edits
  }
  /** remove from the live draft every entry that is still identical to what was just saved */
  function subtractSaved(L, snap) {
    const p = L.patch
    if (!p || !snap) return
    for (const [id, f] of Object.entries(snap.scenes || {})) {
      const cur = p.scenes[id]
      if (!cur) continue
      for (const k of Object.keys(f)) if (Object.prototype.hasOwnProperty.call(cur, k) && same(cur[k], f[k])) delete cur[k]
      if (!Object.keys(cur).length) delete p.scenes[id]
    }
    if (snap.order && p.order && snap.order.join('|') === p.order.join('|')) p.order = null
    if (snap.bgmVolume !== undefined && same(p.bgmVolume, snap.bgmVolume)) p.bgmVolume = undefined
    if (patchEmpty(p)) L.patch = null
  }
  /**
   * Save the draft: rebase onto the newest script.json, POST `script` (regenerates the preview code), then record the
   * hand edits as protected overrides so an AI re-run keeps them. Returns { saved, recorded, sceneIds }.
   */
  async function saveDraft(L, opts = {}) {
    if (!isDirty(L)) return { saved: false, recorded: 0, sceneIds: [] }
    const snap = U.cloneJson(L.patch)
    const server = await freshScript()
    const known = new Set((server.scenes || []).map((x) => x.id))
    for (const id of Object.keys(snap.scenes)) if (!known.has(id)) delete snap.scenes[id] // scene was removed by an AI re-run
    // 「屏幕字幕」 cleared = follow the narration again (an empty subtitle override would remove every on-screen subtitle)
    for (const [id, f] of Object.entries(snap.scenes)) {
      if (!Object.prototype.hasOwnProperty.call(f, 'subtitleText') || String(f.subtitleText || '').trim()) continue
      const narr = Object.prototype.hasOwnProperty.call(f, 'narration') ? f.narration : (findScene(server, id) || {}).narration
      f.subtitleText = String(narr || '').trim()
      const live = L.patch && L.patch.scenes[id]
      if (live && Object.prototype.hasOwnProperty.call(live, 'subtitleText') && !String(live.subtitleText || '').trim()) live.subtitleText = f.subtitleText
    }
    const merged = applyPatch(U.cloneJson(server), snap)
    const subs = rebuildGlobalSubs(server, merged, [])
    if (subs) merged.subtitles = subs
    const d = await PK.postP('script', { script: merged, regenerateCode: true })
    const saved = (d && d.script) || merged
    const edits = collectOverrides(server, saved, snap)
    let rec = null
    if (Object.keys(edits).length) {
      try {
        rec = await PK.postP('project/scene-overrides/batch', { edits })
      } catch (err) {
        console.warn('[PK scenes] override protection failed', err)
        PK.toast(`修改已保存，但「人工改动保护」记录失败：${err.message || err}（AI 重新出片时可能改写这些修改）`, 'warn')
      }
    }
    // subtitle text edits: the backend rebuilt those scenes' subtitles while recording the override → re-sync global track
    const subIds = Object.keys(snap.scenes).filter((id) => Object.prototype.hasOwnProperty.call(snap.scenes[id], 'subtitleText'))
    if (subIds.length && rec) await resyncGlobalSubs(saved, subIds)
    // narration edits: the voice + subtitles still speak the old text until the scene is re-dubbed
    const narrIds = Object.keys(snap.scenes).filter((id) => Object.prototype.hasOwnProperty.call(snap.scenes[id], 'narration'))
    for (const id of narrIds) redubOf(PK.dir()).add(id)
    subtractSaved(L, snap)
    PK.store.invalidate()
    const recorded = (rec && Array.isArray(rec.recorded) ? rec.recorded.length : 0) || 0
    if (!opts.silent) {
      const kept = recorded ? `；已记住你手调的 ${recorded} 幕，AI 重新出片时会保留` : ''
      PK.toast(opts.quick ? `多轨时间轴微调已保存（重新渲染成片后，新的时长 / 转场 / 音效与 BGM 音量才会出现在成片里）${kept}` : `修改已保存并同步到预演画面${kept}`, 'success')
    }
    return { saved: true, recorded, sceneIds: Object.keys(snap.scenes) }
  }

  /* ================================================================ exclusive operations (busy state, progress) */
  const curJob = () => JOBS.get(PK.dir()) || null
  const busyNow = () => Boolean(curJob())
  function emitJobs() {
    PK.emit('sc-jobs', PK.dir())
  }
  /**
   * Run one exclusive project operation. fn(job) may update job.progress / job.message (then call emitJobs()).
   * Errors are toasted (with an optional fix-it action); returns fn's result or undefined.
   */
  async function op(label, fn, o = {}) {
    let dir
    try {
      dir = PK.needProject()
    } catch (err) {
      PK.reportError(err)
      return undefined
    }
    const cur = JOBS.get(dir)
    if (cur) {
      PK.toast(`「${cur.label}」正在进行中，请等它完成后再操作`, 'info')
      return undefined
    }
    const job = { label, dir, progress: 0, indeterminate: true, message: o.message || `${label}…`, startedAt: Date.now() }
    JOBS.set(dir, job)
    emitJobs()
    try {
      return await fn(job)
    } catch (err) {
      if (err && err.code === 'need-llm') return undefined
      const msg = String((err && err.message) || err || '操作失败')
      if (o.failAction) PK.toast(`${o.fail || label + '失败'}：${msg}`, 'error', { action: o.failAction })
      else PK.reportError(err, o.fail || `${label}失败`)
      return undefined
    } finally {
      JOBS.delete(dir)
      emitJobs()
    }
  }
  /** ask the host to reload its data (an async backend job finishes long after the POST that started it, so the host's
   *  automatic refresh-after-mutation has already happened with the old files) */
  const refreshHost = () => PK.action('refresh', {}, { timeout: 60000 }).catch(() => {})
  /** start an async backend job ({ jobId }) and follow it, feeding progress into the op's job record */
  async function followJob(job, init) {
    if (!init || !init.jobId) return init
    let res
    try {
      res = await PK.job(init.jobId, {
        onProgress: (j) => {
          const p = num(j && j.progress, NaN)
          if (Number.isFinite(p)) {
            job.progress = U.clamp(p, 0, 100)
            job.indeterminate = false
          }
          if (j && j.message) job.message = String(j.message)
          emitJobs()
        },
      })
    } finally {
      // the job may have changed files even when it failed half-way (e.g. render wrote a partial QA report)
      PK.store.invalidate()
      await refreshHost()
    }
    if (res && typeof res === 'object' && res.ok === false) throw new PK.Error(String(res.error || res.message || '后台任务未完成'), { body: res })
    return res
  }
  function jobBar() {
    const el = h('div.pk-sc-job', { 'data-sc-jobbar': '1', role: 'status', 'aria-live': 'polite' })
    fillJobBar(el)
    return el
  }
  function fillJobBar(el) {
    const j = curJob()
    PK.clear(el)
    el.hidden = !j
    if (!j) return
    const secs = Math.round((Date.now() - j.startedAt) / 1000)
    PK.append(
      el,
      h('div.pk-sc-job-t', null, ui.spinner(), h('span', null, h('b', null, j.label), j.message && j.message !== j.label ? ` · ${j.message}` : ''), h('span.pk-mono', { style: { flex: 'none' } }, secs >= 3 ? `${secs}s` : '')),
      ui.meter(j.progress, { indeterminate: j.indeterminate }),
    )
  }

  /* ================================================================ per-studio wiring (once per studio ctx) */
  function ensureStudio(ctx) {
    const P = ctx.local
    if (P.__scWired) return
    P.__scWired = true
    let lastBusy = busyNow()
    ctx.listen('sc-jobs', (dir) => {
      if (dir && dir !== PK.dir()) return
      const b = busyNow()
      if (b !== lastBusy) {
        lastBusy = b
        ctx.update()
        return
      }
      ctx.frame.el.querySelectorAll('[data-sc-jobbar]').forEach(fillJobBar)
    })
    ctx.every(1000, () => {
      if (busyNow()) ctx.frame.el.querySelectorAll('[data-sc-jobbar]').forEach(fillJobBar)
    })
    installGuard()
  }

  /* ---------------------------------------------------------------- unsaved-edits guard on the studio panel */
  function askUnsaved(count) {
    return new Promise((resolve) => {
      let done = false
      const f = PK.frame({ kind: 'dialog', size: 'sm', title: '有未保存的分镜修改', en: 'UNSAVED CHANGES', onClose: () => !done && resolve('stay') })
      const pick = (v) => {
        done = true
        resolve(v)
        f.close('ok')
      }
      PK.append(f.body, ui.text(`你在「分镜精修」里还有 ${count} 处修改没有保存。关闭后这些修改会丢失。`), ui.hint('建议先保存：保存后 AI 重新出片时也会保留你的手动修改。'))
      f.setFoot([ui.btn('继续编辑', () => pick('stay'), { kind: 'ghost' }), ui.spacer(), ui.btn('不保存', () => pick('discard'), { kind: 'danger' }), ui.btn('保存后关闭', () => pick('save'), { kind: 'primary', icon: 'save' })])
    })
  }
  function installGuard() {
    const def = PK.panels && PK.panels.get('studio')
    if (!def || def.__scGuard) return
    const prev = def.beforeClose
    def.beforeClose = function (ctx, reason) {
      if (typeof prev === 'function' && prev(ctx, reason) === false) return false
      const L = ctx && ctx.local && ctx.local['s:scenes']
      if (!L || !isDirty(L) || L.__asking) return !(L && L.__asking)
      L.__asking = true
      askUnsaved(dirtySummary(L).count || 1).then(async (choice) => {
        L.__asking = false
        if (choice === 'stay') return
        if (choice === 'save') {
          const ok = await op('保存分镜修改', async () => {
            await saveDraft(L)
            return true
          })
          if (!ok) return
        } else L.patch = null
        ctx.frame.close('force')
      })
      return false
    }
    def.__scGuard = true
  }
  PK.on('panels-changed', () => installGuard())

  /* ================================================================ the monitor screen (lives outside the re-rendered body) */
  // The studio re-renders its whole body after every host refresh. A <video>/<iframe> inside it would reload each time,
  // so the screen is one persistent element mounted in the studio frame and positioned over an empty "slot".
  function getScreen(ctx) {
    const P = ctx.local
    let k = P.__scScreen
    if (k && k.frameEl === ctx.frame.el && k.host.isConnected) return k
    const media = h('div.pk-sc-media')
    const ovSafe = h('div.pk-sc-ov')
    const notice = h('div.pk-sc-notice', { hidden: true })
    const region = h('div.pk-sc-region')
    const stage = h('div.pk-sc-stage', null, media, ovSafe, region, notice)
    const host = h('div.pk-sc-screenhost', { hidden: true }, stage)
    // own stacking context for the studio frame: the screen's z-index must never rise above a dialog opened on top
    ctx.frame.el.style.isolation = 'isolate'
    ctx.frame.el.appendChild(host)
    k = { frameEl: ctx.frame.el, host, stage, media, ovSafe, notice, region, slot: null, ro: null, ar: 16 / 9, visible: false, mode: '', video: null, videoUrl: '', iframe: null, iframeUrl: '', img: null, poster: null, audio: null, playing: false, raf: 0, frame: 0, env: null, lastPlayId: '' }
    const sync = () => {
      const slot = k.slot
      const fr = k.frameEl
      const ok = Boolean(slot && slot.isConnected && fr.contains(slot) && slot.getClientRects().length && fr.isConnected)
      if (!ok) {
        if (k.visible) {
          k.visible = false
          host.hidden = true
          stopPlayback(k)
          if (k.video) {
            try {
              k.video.pause()
            } catch {}
          }
        }
        return
      }
      const frr = fr.getBoundingClientRect()
      const sx = fr.offsetWidth ? frr.width / fr.offsetWidth : 1
      const sy = fr.offsetHeight ? frr.height / fr.offsetHeight : 1
      const r = slot.getBoundingClientRect()
      let cl = r.left
      let ct = r.top
      let cr = r.right
      let cb = r.bottom
      for (let p = slot.parentElement; p && p !== fr; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (/(auto|scroll|hidden)/.test(`${cs.overflowX} ${cs.overflowY}`)) {
          const pr = p.getBoundingClientRect()
          cl = Math.max(cl, pr.left)
          ct = Math.max(ct, pr.top)
          cr = Math.min(cr, pr.right)
          cb = Math.min(cb, pr.bottom)
        }
      }
      if (cr - cl < 4 || cb - ct < 4) {
        host.hidden = true
        return
      }
      k.visible = true
      host.hidden = false
      const w = r.width / sx
      const hh = r.height / sy
      host.style.left = `${(r.left - frr.left) / sx}px`
      host.style.top = `${(r.top - frr.top) / sy}px`
      host.style.width = `${w}px`
      host.style.height = `${hh}px`
      host.style.clipPath = `inset(${Math.max(0, (ct - r.top) / sy)}px ${Math.max(0, (r.right - cr) / sx)}px ${Math.max(0, (r.bottom - cb) / sy)}px ${Math.max(0, (cl - r.left) / sx)}px)`
      const pad = 8
      const aw = Math.max(10, w - pad * 2)
      const ah = Math.max(10, hh - pad * 2)
      let sw = aw
      let sh = sw / (k.ar || 16 / 9)
      if (sh > ah) {
        sh = ah
        sw = sh * (k.ar || 16 / 9)
      }
      stage.style.width = `${Math.round(sw)}px`
      stage.style.height = `${Math.round(sh)}px`
    }
    k.sync = sync
    k.setSlot = (slot) => {
      if (k.slot === slot) return
      k.slot = slot
      if (k.ro) k.ro.disconnect()
      if (slot && typeof ResizeObserver === 'function') {
        k.ro = new ResizeObserver(() => sync())
        k.ro.observe(slot)
      }
    }
    const onWin = () => sync()
    window.addEventListener('resize', onWin)
    fr0(ctx).addEventListener('scroll', onWin, true)
    ctx.frame.layer.addEventListener('transitionend', onWin)
    const mo = new MutationObserver(() => requestAnimationFrame(sync))
    mo.observe(ctx.frame.body, { childList: true })
    const iv = setInterval(() => {
      if (!document.hidden && (k.visible || (k.slot && k.slot.isConnected))) sync()
    }, 700)
    region.addEventListener('pointerdown', (ev) => regionDown(k, ev))
    ctx.onCleanup(() => {
      window.removeEventListener('resize', onWin)
      clearInterval(iv)
      mo.disconnect()
      if (k.ro) k.ro.disconnect()
      stopPlayback(k)
      try {
        if (k.video) k.video.pause()
      } catch {}
      host.remove()
      P.__scScreen = null
    })
    P.__scScreen = k
    return k
  }
  const fr0 = (ctx) => ctx.frame.el
  function stopPlayback(k) {
    k.playing = false
    if (k.raf) cancelAnimationFrame(k.raf)
    k.raf = 0
    if (k.audio) {
      try {
        k.audio.pause()
      } catch {}
    }
  }
  function postToDraft(k, msg) {
    const w = k.iframe && k.iframe.contentWindow
    if (!w) return
    try {
      if (msg.type === 'dsh-seek' && typeof w.__seekToFrame === 'function') {
        w.__seekToFrame(msg.frame)
        return
      }
    } catch {}
    try {
      w.postMessage(msg, '*')
    } catch {}
  }
  function screenTime(k) {
    const env = k.env
    if (!env) return 0
    if (k.mode === 'mp4' && k.video) return num(k.video.currentTime)
    return k.frame / fpsOf(env.server)
  }
  /** playback clock → timecode + "now playing" scene highlight (granular DOM updates, no re-render) */
  function onScreenTime(k, t) {
    const env = k.env
    if (!env) return
    const total = num(env.server.totalDurationSec)
    const body = env.ctx.frame.body
    body.querySelectorAll('[data-sc-tc]').forEach((el) => {
      el.textContent = `${clock(t)} / ${clock(total)}`
    })
    const list = env.server.scenes || []
    let cur = null
    for (const sc of list) {
      const st = num(sc.startSec)
      const du = num(sc.durationSec)
      if (t >= st && t < st + du) {
        cur = sc
        break
      }
    }
    const id = cur ? cur.id : ''
    if (id !== k.lastPlayId) {
      k.lastPlayId = id
      body.querySelectorAll('.pk-sc-blk.is-play').forEach((el) => el.classList.remove('is-play'))
      if (id) body.querySelectorAll(`.pk-sc-blk[data-sc-id="${CSS.escape(id)}"]`).forEach((el) => el.classList.add('is-play'))
    }
    if (cur) {
      const p = U.clamp((t - num(cur.startSec)) / Math.max(0.01, num(cur.durationSec)), 0, 1)
      body.querySelectorAll(`.pk-sc-blk[data-sc-id="${CSS.escape(cur.id)}"] .pk-sc-prog`).forEach((el) => {
        el.style.width = `${(p * 100).toFixed(1)}%`
      })
    }
  }
  function playHtml(k) {
    const env = k.env
    if (!env || !k.iframe) return
    const fps = fpsOf(env.server)
    const total = Math.max(1, num(env.server.totalDurationInFrames) || Math.round(num(env.server.totalDurationSec) * fps))
    if (k.frame >= total - 1) k.frame = 0
    k.playing = true
    const hasAudio = env.s.project && env.s.project.hasMasterAudio
    if (hasAudio) {
      if (!k.audio) {
        k.audio = new Audio()
        k.audio.preload = 'auto'
      }
      const url = fileUrl('output/master-audio.wav', env.mediaVer)
      if (k.audio.dataset.url !== url) {
        k.audio.src = url
        k.audio.dataset.url = url
      }
      try {
        k.audio.currentTime = k.frame / fps
        k.audio.play().catch(() => {})
      } catch {}
    }
    let last = performance.now()
    const tick = (now) => {
      if (!k.playing) return
      const dt = (now - last) / 1000
      last = now
      if (k.audio && hasAudio && !k.audio.paused) k.frame = k.audio.currentTime * fps
      else k.frame += dt * fps
      if (k.frame >= total - 1) {
        k.frame = 0
        stopPlayback(k)
        postToDraft(k, { type: 'dsh-seek', frame: 0 })
        onScreenTime(k, 0)
        paintPlayButtons(k)
        return
      }
      postToDraft(k, { type: 'dsh-seek', frame: Math.floor(k.frame) })
      onScreenTime(k, k.frame / fps)
      k.raf = requestAnimationFrame(tick)
    }
    k.raf = requestAnimationFrame(tick)
  }
  function togglePlay(k) {
    if (!k) return
    if (k.mode === 'mp4' && k.video) {
      if (k.video.paused) k.video.play().catch(() => {})
      else k.video.pause()
    } else if (k.mode === 'html' && k.iframe) {
      if (k.playing) stopPlayback(k)
      else playHtml(k)
      paintPlayButtons(k)
    }
  }
  function paintPlayButtons(k) {
    const env = k.env
    if (!env) return
    const playing = k.mode === 'mp4' ? Boolean(k.video && !k.video.paused) : k.playing
    env.ctx.frame.body.querySelectorAll('[data-sc-play]').forEach((b) => {
      const ic = b.querySelector('svg')
      if (ic) ic.replaceWith(PK.icon(playing ? 'pause' : 'play', 13))
      b.title = playing ? '暂停预览' : '播放预览'
      b.setAttribute('aria-label', b.title)
    })
  }
  function seekScreenTo(k, sec) {
    const env = k.env
    if (!env) return
    const fps = fpsOf(env.server)
    if (k.mode === 'mp4' && k.video) {
      const go = () => {
        try {
          k.video.currentTime = Math.max(0, sec + 0.02)
        } catch {}
      }
      if (k.video.readyState >= 1) go()
      else k.video.addEventListener('loadedmetadata', go, { once: true })
    } else if (k.mode === 'html') {
      stopPlayback(k)
      k.frame = Math.max(0, Math.floor(sec * fps))
      postToDraft(k, { type: 'dsh-seek', frame: k.frame })
      paintPlayButtons(k)
    }
    onScreenTime(k, sec)
  }
  /* ---- 指哪改哪 region picking on the screen */
  function regionDown(k, ev) {
    const env = k.env
    if (!env || !env.L.refine.picking) return
    ev.preventDefault()
    const rect = k.stage.getBoundingClientRect()
    const x0 = U.clamp((ev.clientX - rect.left) / rect.width, 0, 1)
    const y0 = U.clamp((ev.clientY - rect.top) / rect.height, 0, 1)
    const R = env.L.refine
    const move = (e) => {
      const x1 = U.clamp((e.clientX - rect.left) / rect.width, 0, 1)
      const y1 = U.clamp((e.clientY - rect.top) / rect.height, 0, 1)
      R.region = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
      paintRegion(k)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!R.region || R.region.w < 0.02 || R.region.h < 0.02) {
        R.region = null
        PK.toast('框选区域太小，请按住鼠标拖出一个矩形', 'info')
      } else {
        R.picking = false
        R.preview = null
        Object.keys(R.region).forEach((key) => (R.region[key] = Number(R.region[key].toFixed(4))))
      }
      paintRegion(k)
      env.ctx.render()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  function regionText(r) {
    if (!r) return ''
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    const horiz = cx < 0.34 ? '左' : cx > 0.66 ? '右' : '中'
    const vert = cy < 0.34 ? '上' : cy > 0.66 ? '下' : '中'
    const where = vert === '中' && horiz === '中' ? '画面中央' : vert === '中' ? `画面${horiz}侧` : horiz === '中' ? `画面${vert}方` : `画面${horiz}${vert}角`
    return `${where} · ${Math.round(r.w * 100)}% × ${Math.round(r.h * 100)}%`
  }
  function paintRegion(k) {
    const env = k.env
    const R = env && env.L.refine
    PK.clear(k.region)
    k.region.classList.toggle('is-picking', Boolean(R && R.picking))
    if (!R || !R.region) return
    const r = R.region
    // the tag sits above the box; near the top edge of the picture it moves inside so it is never cut off
    k.region.appendChild(h('div.pk-sc-region-box', { style: { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` } }, h('span', { style: r.y < 0.08 ? { top: '3px', left: '3px' } : null }, 'AI 只改这里')))
  }

  /* ================================================================ 分镜精修 · scenes step */
  function initScope(ctx, s) {
    const L = s.local
    // key drafts by the project the loaded data belongs to (the host may already point at another project while the
    // studio is still re-loading)
    const dir = (s.project && s.project.projectDir) || PK.dir()
    if (L.dir !== dir) {
      // the project was switched while the studio stayed open: park unsaved edits per project (switching back restores them)
      L.stash = L.stash || {}
      if (L.dir && isDirty(L)) {
        L.stash[L.dir] = { patch: L.patch }
        PK.toast('「分镜精修」里还没保存的修改已暂存：切回原来的工程即可继续编辑并保存。', 'info', { timeout: 8000 })
      }
      const parked = L.stash[dir] || null
      delete L.stash[dir]
      L.dir = dir
      L.patch = parked ? parked.patch : null
      L.sel = ''
      L.lockOpt = {}
      L.edits = null
      L.safe = null
      L.mediaBump = 0
      L.htmlOn = false
      L.refine = { prompt: '', scope: 'scene', rangeOn: false, start: '', end: '', preview: null, region: null, picking: false }
      L.ui = L.ui || {}
    }
    L.ui = Object.assign({ tab: 'preview', insTab: 'edit', src: '', list: false, safe: false, zoom: 1, snap: true, sfxType: 'slash', tl: true }, L.ui || {})
    L.refine = L.refine || { prompt: '', scope: 'scene', rangeOn: false, start: '', end: '', preview: null, region: null, picking: false }
    L.lockOpt = L.lockOpt || {}
  }
  function mediaVerOf(s, L) {
    const qa = s.project && s.project.qaReport
    return hash(`${(qa && qa.checkedAt) || ''}|${(s.project && s.project.hasMp4) || ''}|${L.mediaBump || 0}|${Object.keys((s.project && s.project.sceneThumbs) || {}).length}`)
  }
  function thumbUrlOf(env, sc) {
    const thumbs = (env.s.project && env.s.project.sceneThumbs) || {}
    if (sc && thumbs[sc.id]) return fileUrl(thumbs[sc.id], env.mediaVer)
    const m = sc && Array.isArray(sc.media) ? sc.media.find((x) => x && x.type !== 'video' && (x.path || x.webPath)) : null
    return m ? fileUrl(m.path || m.webPath, 'm') : ''
  }
  function lockedOf(env, sc) {
    if (!sc) return false
    const o = env.L.lockOpt[sc.id]
    if (o !== undefined && Boolean(o) !== Boolean(findScene(env.server, sc.id) && findScene(env.server, sc.id).locked)) return Boolean(o)
    return Boolean(findScene(env.server, sc.id) && findScene(env.server, sc.id).locked)
  }

  function makeEnv(ctx, s) {
    const L = s.local
    const server = s.script
    const view = applyPatch(server, L.patch)
    const scenes = view.scenes
    if (ctx.args && ctx.args.sceneId) {
      const want = String(ctx.args.sceneId)
      delete ctx.args.sceneId
      if (scenes.some((x) => x.id === want)) {
        L.sel = want
        L.seek = want
        L.reveal = true
        L.ui.tab = 'preview'
      }
    }
    if (!scenes.some((x) => x.id === L.sel)) L.sel = scenes[0].id
    const idx = scenes.findIndex((x) => x.id === L.sel)
    const env = { ctx, s, L, server, view, scenes, sc: scenes[idx], idx, fps: fpsOf(view), mediaVer: mediaVerOf(s, L), busy: busyNow() }
    env.rr = () => ctx.render()
    env.select = (id, o = {}) => {
      if (!scenes.some((x) => x.id === id)) return
      L.sel = id
      L.seek = id
      L.reveal = true
      if (o.edit) L.ui.tab = 'edit'
      ctx.render()
    }
    env.edit = (field, value, o = {}) => {
      setField(L, server, env.sc.id, field, value)
      if (o.render) ctx.render()
      else marks(env)
    }
    return env
  }

  /** granular "unsaved" indicators (no re-render while typing — keeps the IME composition intact) */
  function marks(env) {
    const { ctx, L, server } = env
    const view = applyPatch(server, L.patch)
    const byId = new Map(view.scenes.map((x, i) => [x.id, [x, i]]))
    const dirtyIds = new Set(Object.keys((L.patch && L.patch.scenes) || {}))
    const root = ctx.frame.el
    root.querySelectorAll('[data-sc-mark]').forEach((el) => el.classList.toggle('is-dirty', dirtyIds.has(el.getAttribute('data-sc-mark'))))
    root.querySelectorAll('[data-sc-title]').forEach((el) => {
      const hit = byId.get(el.getAttribute('data-sc-title'))
      if (hit) {
        el.textContent = sceneTitle(hit[0], hit[1])
        el.title = el.textContent
      }
    })
    const sum = dirtySummary(L)
    root.querySelectorAll('[data-sc-dirty]').forEach((el) => paintDirty(el, sum))
    root.querySelectorAll('[data-sc-save]').forEach((b) => {
      b.disabled = !sum.count || env.busy
      b.classList.toggle('pk-btn--primary', Boolean(sum.count))
    })
  }
  function paintDirty(el, sum) {
    el.classList.toggle('is-dirty', Boolean(sum.count))
    el.textContent = sum.count ? `● ${sum.count} 处修改未保存` : '✓ 修改已全部保存'
    el.title = sum.count ? sum.scenes.map((x) => `${x.id}：${x.labels.join('、')}`).concat(sum.order ? ['分镜顺序'] : [], sum.bgm ? ['BGM 音量'] : []).join('\n') : ''
  }
  function dirtyBadge(env) {
    const el = h('span.pk-sc-dirtytxt', { 'data-sc-dirty': '1', style: { fontSize: '12.5px', fontWeight: 700, whiteSpace: 'nowrap' } })
    paintDirty(el, dirtySummary(env.L))
    el.style.color = dirtySummary(env.L).count ? 'var(--pk-warn)' : 'var(--pk-ink3)'
    return el
  }

  /* ---------------------------------------------------------------- scene actions */
  async function doSave(env, o = {}) {
    return op('保存分镜修改', async () => {
      await saveDraft(env.L, o)
      env.ctx.update()
      return true
    })
  }
  async function discardDraft(env) {
    const sum = dirtySummary(env.L)
    if (!sum.count) return
    const ok = await PK.confirm({ title: '放弃未保存的修改？', text: `将撤销 ${sum.count} 处还没保存的修改，恢复成工程里保存的版本。此操作无法撤回。`, ok: '放弃修改', danger: true })
    if (!ok) return
    env.L.patch = null
    env.ctx.render()
  }
  /** make sure the draft is saved before an operation that works on the saved project */
  async function ensureSaved(env, why) {
    if (!isDirty(env.L)) return true
    const ok = await PK.confirm({ title: '先保存修改？', text: `${why}需要基于已保存的工程进行。将先保存你当前的 ${dirtySummary(env.L).count} 处修改，再继续。`, ok: '保存并继续' })
    if (!ok) return false
    try {
      await saveDraft(env.L, { silent: true })
      return true
    } catch (err) {
      PK.reportError(err, '保存失败')
      return false
    }
  }
  function moveScene(env, id, dir) {
    const ids = env.scenes.map((x) => x.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    const srv = (env.server.scenes || []).map((x) => x.id)
    patchOf(env.L).order = ids.join('|') === srv.join('|') ? null : ids
    if (patchEmpty(env.L.patch)) env.L.patch = null
    env.rr()
  }
  function setDuration(env, id, sec) {
    const v = Math.max(0.45, Math.min(600, Number(Number(sec).toFixed(3))))
    if (!Number.isFinite(v)) return
    setField(env.L, env.server, id, 'durationSec', v)
    env.rr()
  }
  function nudgeDuration(env, id, sign) {
    const pf = env.L.patch && env.L.patch.scenes[id]
    const cur = pf && pf.durationSec !== undefined ? num(pf.durationSec) : num((findScene(env.server, id) || {}).durationSec, 3)
    const bpm = num(env.view.bgm && env.view.bgm.bpm) || 100
    const step = env.L.ui.snap ? Number((60 / bpm / 2).toFixed(3)) : 0.25
    setDuration(env, id, cur + sign * step)
  }
  function cycleTransition(env, sc) {
    const cur = sc.transition || 'cut'
    const i = TX_CYCLE.indexOf(cur)
    const next = TX_CYCLE[(i + 1) % TX_CYCLE.length]
    setField(env.L, env.server, sc.id, 'transition', next)
    env.rr()
  }
  function addCue(env, sc, type) {
    const cues = U.cloneJson(Array.isArray(sc.sfxCues) ? sc.sfxCues : [])
    const dur = num(sc.durationSec, 3)
    const off = cues.length === 0 ? 0 : Number(Math.min(dur * 0.75, cues.length * 0.45).toFixed(2))
    cues.push({ type, path: `audio/sfx/${type}.wav`, offsetSec: off, volume: 0.8, pan: 0 })
    setField(env.L, env.server, sc.id, 'sfxCues', cues)
    env.rr()
  }
  function removeCue(env, sc, i) {
    const cues = (Array.isArray(sc.sfxCues) ? sc.sfxCues : []).filter((_, ci) => ci !== i)
    setField(env.L, env.server, sc.id, 'sfxCues', cues)
    env.rr()
  }
  function editCue(env, sc, i, patch) {
    const cues = U.cloneJson(Array.isArray(sc.sfxCues) ? sc.sfxCues : [])
    if (!cues[i]) return
    Object.assign(cues[i], patch)
    setField(env.L, env.server, sc.id, 'sfxCues', cues)
    env.rr()
  }
  function setVoice(env, sc, voiceId) {
    const id = sc.id
    if (!voiceId || voiceId === 'auto') {
      setField(env.L, env.server, id, 'voiceId', 'auto')
      setField(env.L, env.server, id, 'voiceLocked', false)
    } else {
      setField(env.L, env.server, id, 'voiceId', voiceId)
      setField(env.L, env.server, id, 'voiceLocked', true)
      setField(env.L, env.server, id, 'voiceCastBy', 'manual')
    }
    env.rr()
  }
  // builtin: true = the user explicitly picked a built-in layout for an AI-coded scene (replaces its AI code)
  function setLayout(env, sc, layout, builtin = false) {
    setField(env.L, env.server, sc.id, 'layout', layout)
    const srv = findScene(env.server, sc.id)
    if (!builtin && srv && same(srv.layout, layout)) setField(env.L, env.server, sc.id, 'useBuiltinLayout', srv.useBuiltinLayout)
    else setField(env.L, env.server, sc.id, 'useBuiltinLayout', true)
    env.rr()
  }
  /** back to the scene's AI-written picture (its code stays in the project while a built-in layout is chosen) */
  function useAiLayout(env, sc) {
    const srv = findScene(env.server, sc.id)
    if (srv) setField(env.L, env.server, sc.id, 'layout', srv.layout)
    setField(env.L, env.server, sc.id, 'useBuiltinLayout', false)
    env.rr()
  }
  function mediaEntry(a, motion) {
    return {
      assetId: a.id,
      path: a.editedPath || a.path,
      originalPath: a.path,
      webPath: a.editedWebPath || a.webPath || '',
      type: a.type,
      role: a.role,
      width: num(a.editedWidth || a.width),
      height: num(a.editedHeight || a.height),
      motion: motion || 'zoom-in',
      trimStartSec: 0,
    }
  }
  function setMedia(env, sc, list) {
    setField(env.L, env.server, sc.id, 'media', list)
    setField(env.L, env.server, sc.id, 'assetPaths', list.map((m) => m.path).filter(Boolean))
    env.rr()
  }
  function pickAsset(env, title) {
    return new Promise((resolve) => {
      let done = false
      const assets = ((env.s.project && env.s.project.assets) || []).filter((a) => a && (a.type === 'image' || a.type === 'video') && !['avatar_base', 'voice_clone'].includes(a.role))
      const f = PK.frame({ kind: 'modal', size: 'lg', title: title || '选择画面素材', en: 'PICK MEDIA · 素材库', onClose: () => !done && resolve(null) })
      const pick = (a) => {
        done = true
        resolve(a)
        f.close('ok')
      }
      if (!assets.length) {
        PK.append(f.body, ui.empty({ icon: 'image', title: '素材库里还没有图片或视频', text: '先到「素材」步骤导入图片 / 视频，再回来替换本幕画面。', actions: [ui.btn('去导入素材', () => { f.close('go'); env.s.go('assets') }, { kind: 'primary', icon: 'upload' })] }))
      } else {
        PK.append(
          f.body,
          ui.hint('点一下素材即可放进本幕。图片会按本幕的「运镜」缓慢推拉；视频从开头播放。'),
          ui.grid(
            assets.map((a) =>
              ui.card({
                media: a.thumb || a.type === 'image' ? h('img', { src: fileUrl(a.thumb || a.path, 't'), alt: '', loading: 'lazy' }) : h('div.pk-media-empty', null, PK.icon('film', 22)),
                aspect: '16/9',
                badge: a.type === 'video' ? '视频' : null,
                title: a.originalName || a.name || a.id,
                sub: [a.type === 'video' ? `${num(a.durationSec).toFixed(1)} 秒` : '图片', a.width ? `${a.width}×${a.height}` : ''].filter(Boolean).join(' · '),
                onClick: () => pick(a),
              }),
            ),
            { min: 170 },
          ),
        )
      }
      f.setFoot([ui.spacer(), ui.btn('取消', () => f.close('cancel'), { kind: 'ghost' })])
    })
  }
  async function toggleLock(env, id, locked) {
    await op(locked ? '锁定分镜' : '解锁分镜', async () => {
      await PK.postP('project/scene-lock', { sceneId: id, locked })
      env.L.lockOpt[id] = locked
      env.L.edits = null
      PK.toast(locked ? `已锁定 ${id}：AI 重新生成与精修都不会改动它` : `已解锁 ${id}`, 'success')
    })
    env.ctx.update()
  }
  async function clearProtection(env, id, title, names) {
    const ok = await PK.confirm({
      title: '不再保护这些手动修改？',
      text: `清除后，AI 重新出片时可能会改写「${title}」里你手动改过的：${names.join('、') || '内容'}。当前画面不会马上改变。`,
      ok: '清除保护',
      danger: true,
    })
    if (!ok) return
    await op('清除人工改动保护', async () => {
      await PK.postP('project/scene-overrides', { sceneId: id, clearAll: true })
      env.L.edits = null
      PK.toast(`已清除 ${id} 的人工改动保护`, 'info')
    })
  }
  async function ttsScene(env, sc) {
    if (!(await ensureSaved(env, '重新配音'))) return
    const tts = PK.state && PK.state.status && PK.state.status.tts
    await op(
      `重配「${sceneTitle(sc, env.idx)}」的配音`,
      async (job) => {
        const before = await freshScript()
        const cur = findScene(before, sc.id) || sc
        // The backend re-aligns the subtitles from the scene's `subChunks` while they still cover most of the narration,
        // so after a small narration edit the new words would never reach the screen: drop chunks cut from an older text.
        const chunks = Array.isArray(cur.subChunks) ? cur.subChunks : []
        const plain = (t) => String(t || '').replace(/[\s\p{P}\p{S}]/gu, '')
        if (chunks.length && (redubOf(PK.dir()).has(cur.id) || plain(chunks.join('')) !== plain(cur.narration))) {
          job.message = '旁白有修改：字幕将按新旁白重新断句…'
          emitJobs()
          await PK.postP('script', { script: { ...before, scenes: before.scenes.map((x) => (x.id === cur.id ? { ...x, subChunks: [] } : x)) }, regenerateCode: false })
        }
        job.message = `${(tts && tts.label) || '配音引擎'} 正在配音…`
        emitJobs()
        const d = await PK.postP('action', {
          action: 'tts-scene',
          sceneId: cur.id,
          text: cur.narration,
          emotion: cur.emotion || '平静',
          speechRate: num(cur.speechRate) || 1,
          voiceId: cur.voiceId || 'auto',
        })
        job.message = '正在同步字幕时间轴…'
        emitJobs()
        await resyncGlobalSubs(before, [cur.id])
        redubOf(PK.dir()).delete(cur.id)
        env.L.mediaBump = (env.L.mediaBump || 0) + 1
        const dur = d && d.result && d.result.durationSec
        PK.toast(`配音完成${dur ? `（${num(dur).toFixed(1)} 秒）` : ''}，已同步时间轴与字幕`, 'success')
      },
      { fail: '配音失败', failAction: { label: '去配音引擎设置', onClick: () => PK.open('keys', { tab: 'tts' }) } },
    )
  }
  async function masterVoice(env, sceneIds) {
    if (!(await ensureSaved(env, 'AI 声学修音'))) return
    await op(
      sceneIds.length ? `AI 声学修音 · ${sceneIds.join('、')}` : '全片 AI 声学修音（-14 LUFS）',
      async (job) => {
        const before = await freshScript()
        const init = await PK.postP('action', { async: true, action: 'ai-master-voice', sceneIds, useLlm: true })
        const res = await followJob(job, init)
        await resyncGlobalSubs(before, sceneIds.length ? sceneIds : (before.scenes || []).map((x) => x.id))
        env.L.mediaBump = (env.L.mediaBump || 0) + 1
        PK.toast(`声学修音完成（已处理 ${num(res && res.report && res.report.scenesCount)} 幕并重混母带）`, 'success')
      },
      { fail: 'AI 修音失败' },
    )
  }
  async function runRefine(env, instruction, scopeOverride) {
    const R = env.L.refine
    const text = String(instruction || '').trim()
    if (!text) {
      PK.toast('请先写下你希望 AI 改哪里、怎么改', 'warn')
      return
    }
    if (!llmReady()) {
      R.prompt = text
      PK.toast('已为您保留指令，请先配置 AI 大模型再发起精修', 'info')
      PK.open('keys', { tab: 'llm' })
      return
    }
    const scope = scopeOverride || R.scope
    const sc = env.sc
    const ok = await PK.confirm({
      title: scope === 'scene' ? `让 AI 修改「${sceneTitle(sc, env.idx)}」？` : '让 AI 调整全片？',
      text: h('div.pk-stack', null, ui.text(`修改要求：${text}`), ui.hint('会调用大模型改写画面代码，完成后自动重新渲染成片（通常需要几分钟）。改之前会自动备份，不满意可点「撤回上一版」。')),
      ok: 'AI 立即改好',
    })
    if (!ok) return
    if (!(await ensureSaved(env, 'AI 精修'))) return
    await op(
      scope === 'scene' ? `AI 精修 · ${sc.id}` : 'AI 精修 · 全片',
      async (job) => {
        const init = await PK.postP('ai-refine', { async: true, sceneId: scope === 'scene' ? sc.id : '', instruction: text, render: true })
        await followJob(job, init)
        R.prompt = ''
        env.L.mediaBump = (env.L.mediaBump || 0) + 1
        PK.toast('AI 精修已生效！若需恢复原版可随时点「撤回上一版」', 'success')
      },
      { fail: 'AI 精修失败' },
    )
  }
  function rangeOf(env) {
    const R = env.L.refine
    const srv = findScene(env.server, env.sc.id) || env.sc
    const start = R.start === '' ? num(srv.startSec) : num(R.start)
    const end = R.end === '' ? num(srv.startSec) + num(srv.durationSec) : num(R.end)
    return { startSec: Number(start.toFixed(2)), endSec: Number(end.toFixed(2)) }
  }
  async function previewRange(env) {
    const R = env.L.refine
    const tr = rangeOf(env)
    if (!(tr.endSec > tr.startSec)) {
      PK.toast('结束时间需要大于开始时间', 'warn')
      return
    }
    await op('预览改动范围', async () => {
      const d = await PK.postP('project/refine', { dryRun: true, timeRange: tr, ...(R.region ? { region: { ...R.region, unit: 'norm' } } : {}) })
      R.preview = d
    })
    env.ctx.update()
  }
  async function runRangeRefine(env) {
    const R = env.L.refine
    const text = String(R.prompt || '').trim()
    if (!text) {
      PK.toast('请先在上面的输入框写下修改要求', 'warn')
      return
    }
    if (!llmReady()) {
      PK.toast('请先配置 AI 大模型接口', 'info')
      PK.open('keys', { tab: 'llm' })
      return
    }
    const tr = rangeOf(env)
    if (!(tr.endSec > tr.startSec)) {
      PK.toast('结束时间需要大于开始时间', 'warn')
      return
    }
    const ok = await PK.confirm({
      title: '指哪改哪：只改这一段？',
      text: h('div.pk-stack', null, ui.text(`修改要求：${text}`), ui.text(`时间范围：${tr.startSec}s – ${tr.endSec}s${R.region ? ` · 区域：${regionText(R.region)}` : ''}`), ui.hint('只会改动命中的分镜（已锁定的会跳过），完成后自动重新渲染成片。改之前会自动备份。')),
      ok: '只改这段',
    })
    if (!ok) return
    if (!(await ensureSaved(env, '指哪改哪精修'))) return
    await op(
      '指哪改哪精修',
      async (job) => {
        const init = await PK.postP('project/refine', { instruction: text, timeRange: tr, ...(R.region ? { region: { ...R.region, unit: 'norm' } } : {}), async: true, render: true })
        const res = await followJob(job, init)
        if (res && res.refused) throw new PK.Error(res.message || '所选范围内的分镜都已锁定，AI 没有改动')
        R.prompt = ''
        R.preview = null
        env.L.mediaBump = (env.L.mediaBump || 0) + 1
        PK.toast('指哪改哪精修已生效！可在「版本历史」一键恢复', 'success')
      },
      { fail: '指哪改哪精修失败' },
    )
  }
  async function rollback(env) {
    const n = num(PK.state && PK.state.projectFlags && PK.state.projectFlags.historyCount) || num(env.s.project && env.s.project.historyCount)
    const ok = await PK.confirm({
      title: '撤回到上一个版本？',
      text: `将把工程恢复到 AI 上一次修改之前的样子（共有 ${n} 个可撤回的版本）。撤回前会自动备份当前状态，之后仍可在「版本历史」里找回。`,
      ok: '撤回上一版',
      danger: true,
    })
    if (!ok) return
    if (isDirty(env.L)) {
      const drop = await PK.confirm({ title: '未保存的修改将被丢弃', text: '撤回会恢复整个工程的已保存版本，你当前没保存的分镜修改会被丢弃。继续吗？', ok: '丢弃并撤回', danger: true })
      if (!drop) return
      env.L.patch = null
    }
    await op('撤回上一版', async () => {
      let d
      try {
        d = await PK.postP('ai-refine', { rollback: true })
      } catch (err) {
        PK.toast(String((err && err.message) || '暂无可撤回的历史版本'), 'info')
        return
      }
      env.L.mediaBump = (env.L.mediaBump || 0) + 1
      PK.toast(d && d.restoredVersion ? `已撤回至上一版本（${d.restoredVersion.id || d.restoredVersion}）` : '已撤回至上一版本快照', 'success')
    })
  }
  async function loadSafeZone(env) {
    const L = env.L
    const platform = (PK.state && PK.state.director && PK.state.director.targetPlatform) || env.server.targetPlatform || 'universal'
    const key = `${platform}|${env.server.width}x${env.server.height}|${env.server.updatedAt || ''}`
    if (L.safe && L.safe.key === key) return
    L.safe = { key, loading: true, preflight: null }
    try {
      const d = await PK.get('safe-zone', { projectDir: PK.dir(), platform })
      L.safe = { key, preflight: d.preflight || null }
    } catch (err) {
      L.safe = { key, error: String(err.message || err) }
    }
    env.ctx.update()
  }
  async function loadEdits(env) {
    const L = env.L
    if (L.edits && L.edits.rev === (PK.state && PK.state.rev)) return
    L.edits = { rev: PK.state && PK.state.rev, loading: true }
    try {
      const d = await PK.get('project/scene-edits', { projectDir: PK.dir() })
      L.edits = { rev: PK.state && PK.state.rev, data: d }
    } catch (err) {
      L.edits = { rev: PK.state && PK.state.rev, error: String(err.message || err) }
    }
    env.ctx.update()
  }
  function formatDialog(env) {
    const v = env.view
    const d = (PK.state && PK.state.director) || {}
    const cur = { aspect: String(v.aspectRatio || '16:9'), quality: String(v.quality || '1080p'), platform: String(d.targetPlatform || v.targetPlatform || 'universal') }
    const f0 = { ...cur }
    const aspects = optList('aspectRatios', FALLBACK_ASPECTS).filter((o) => o.value !== 'auto' && o.value !== 'custom')
    const fr = PK.frame({ kind: 'dialog', size: 'sm', title: '画幅 · 画质 · 发布平台', en: 'FORMAT · 防遮挡安全区' })
    PK.append(
      fr.body,
      ui.field({ label: '画面比例', en: 'ASPECT' }, ui.select({ value: cur.aspect, options: withCurrent(aspects, cur.aspect), onChange: (x) => (cur.aspect = x) })),
      ui.field({ label: '成片画质', en: 'QUALITY' }, ui.select({ value: cur.quality, options: withCurrent(optList('qualities', FALLBACK_QUALITIES), cur.quality), onChange: (x) => (cur.quality = x) })),
      ui.field({ label: '发布平台（决定防遮挡安全区）', en: 'PLATFORM' }, ui.select({ value: cur.platform, options: optList('platforms', FALLBACK_PLATFORMS), showHint: true, onChange: (x) => (cur.platform = x) })),
      ui.note('修改画幅会重新排版画面代码；已经渲染好的成片需要重新渲染才会变成新画幅。', { level: 'info' }),
    )
    fr.setFoot([
      ui.spacer(),
      ui.btn('取消', () => fr.close('cancel'), { kind: 'ghost' }),
      ui.btn(
        '应用',
        async () => {
          if (cur.aspect === f0.aspect && cur.quality === f0.quality && cur.platform === f0.platform) {
            fr.close('ok')
            return
          }
          fr.close('ok')
          await op('更新画幅与安全区', async () => {
            const platChanged = cur.platform !== f0.platform
            if (platChanged) await PK.action('setDirector', { patch: { targetPlatform: cur.platform } })
            const r = await PK.postP('action', { action: 'update-format', aspectRatio: cur.aspect, quality: cur.quality, ...(platChanged ? { targetPlatform: cur.platform } : {}) })
            env.L.safe = null
            PK.toast((r && r.dimensions && r.dimensions.reason) || '画幅与安全区基准已更新', 'success')
          })
        },
        { kind: 'primary', icon: 'check' },
      ),
    ])
  }

  /* ---------------------------------------------------------------- scenes · render */
  function renderScenes(ctx, s) {
    ensureStudio(ctx)
    initScope(ctx, s)
    const L = s.local
    const server = s.script
    if (!server || !Array.isArray(server.scenes) || !server.scenes.length) {
      const k = ctx.local.__scScreen
      if (k) k.setSlot(null)
      ctx.foot([ui.hint('还没有分镜可以精修'), ui.spacer(), ui.btn('← 导演参数', () => s.go('director'), { kind: 'ghost' })])
      return h(
        'div.pk-fill',
        null,
        h(
          'div.pk-sc-empty',
          null,
          ui.empty({
            icon: 'film',
            title: '还没有分镜',
            text: '先在「导演参数」写好创意并生成分镜，或回到作战大屏点「一键出片」，AI 会自动写好每一幕。',
            actions: [ui.btn('去导演参数', () => s.go('director'), { kind: 'primary', icon: 'wand' }), ui.btn('一键出片', () => PK.action('run', {}).then(() => PK.toast('AI Agent 团队已启动出片', 'success')), { icon: 'bolt', busyText: '启动中…' })],
          }),
        ),
      )
    }
    const env = makeEnv(ctx, s)
    if (s.project && s.project.hasMp4 && !Object.keys(s.project.sceneThumbs || {}).length && !THUMBS_REQUESTED.has(PK.dir())) {
      THUMBS_REQUESTED.add(PK.dir())
      PK.postP('action', { action: 'extract-scene-thumbs' }).catch(() => {})
    }
    if (L.ui.safe) loadSafeZone(env)
    if (L.ui.insTab === 'guard') loadEdits(env)
    ctx.foot(scenesFooter(env))
    const slot = h('div.pk-sc-slot', { 'aria-label': '预览画面' })
    env.slot = slot
    const root = h(
      'div.pk-sc',
      { 'data-tab': L.ui.tab, 'data-list': L.ui.list ? 'on' : 'off', 'data-tl': L.ui.tl === false ? 'off' : 'on', onKeydown: (ev) => keys(env, ev) },
      jobBar(),
      h('div.pk-sc-tabs', null, ui.tabs({ value: L.ui.tab, items: [{ value: 'preview', label: '预览与时间轴', icon: 'film' }, { value: 'edit', label: '分镜属性', icon: 'edit', badge: dirtySummary(L).count || null }, { value: 'list', label: `分镜列表 ${env.scenes.length}`, icon: 'list' }], onChange: (v) => ((L.ui.tab = v), (L.reveal = true), env.rr()) })),
      h('div.pk-sc-main', null, listPane(env), centerPane(env), inspectorPane(env)),
    )
    const k = getScreen(ctx)
    k.env = env
    k.setSlot(slot)
    configureScreen(env, k)
    const reveal = Boolean(L.reveal)
    L.reveal = false
    requestAnimationFrame(() => {
      k.sync()
      if (reveal) revealSelected(ctx)
      requestAnimationFrame(() => k.sync())
    })
    return h('div.pk-fill', null, root)
  }
  /** a newly selected scene (list, timeline, ‹ ›, opened from the main screen) is scrolled into view in the list and
   *  on the timeline — once per selection, so a later re-render never fights the user's own scrolling */
  function revealSelected(ctx) {
    const body = ctx.frame.body
    const pairs = [
      ['.pk-sc-tracks', '.pk-sc-blk.is-sel', 96],
      ['.pk-sc-list .pk-sc-scroll', '.pk-item.is-active', 0],
    ]
    for (const [scSel, itSel, padL] of pairs) {
      const sc = body.querySelector(scSel)
      const it = sc && sc.querySelector(itSel)
      if (!it || !sc.getClientRects().length || !it.getClientRects().length) continue
      const a = sc.getBoundingClientRect()
      const b = it.getBoundingClientRect()
      // padL: the sticky track labels cover the left edge of the timeline
      if (b.left < a.left + padL) sc.scrollLeft -= a.left + padL - b.left + 8
      else if (b.right > a.right) sc.scrollLeft += Math.min(b.right - a.right + 8, b.left - a.left - padL)
      if (b.top < a.top) sc.scrollTop -= a.top - b.top + 6
      else if (b.bottom > a.bottom) sc.scrollTop += Math.min(b.bottom - a.bottom + 6, b.top - a.top)
    }
  }
  function keys(env, ev) {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 's' || ev.key === 'S')) {
      ev.preventDefault()
      if (isDirty(env.L)) doSave(env)
    }
  }
  function scenesFooter(env) {
    const sum = dirtySummary(env.L)
    const save = ui.btn('保存修改', () => doSave(env), { kind: sum.count ? 'primary' : 'secondary', icon: 'save', disabled: !sum.count || env.busy, busyText: '保存中…', title: 'Ctrl + S' })
    save.setAttribute('data-sc-save', '1')
    return [
      dirtyBadge(env),
      isLiveRun() ? ui.pill('AI 正在出片：完成前保存可能被覆盖', 'warn', { dot: true }) : null,
      ui.spacer(),
      sum.count ? ui.btn('放弃修改', () => discardDraft(env), { kind: 'ghost', disabled: env.busy }) : null,
      save,
      ui.btn('下一步：交付', () => env.s.go('delivery'), { icon: 'arrowR' }),
    ]
  }

  /* ---- left: scene list */
  function listPane(env) {
    const { L, scenes } = env
    const total = num(env.view.totalDurationSec)
    const dirtyIds = new Set(Object.keys((L.patch && L.patch.scenes) || {}))
    const ov = env.server.userOverrides || {}
    const items = scenes.map((sc, i) => {
      const thumb = thumbUrlOf(env, sc)
      const locked = lockedOf(env, sc)
      const names = ov[sc.id] ? fieldNames(ov[sc.id]) : []
      const hasVoice = Boolean(sc.audioFile)
      const title = h('span', { 'data-sc-title': sc.id, title: sceneTitle(sc, i) }, sceneTitle(sc, i))
      return ui.item({
        key: `sc-it-${sc.id}`,
        lead: sceneNo(i),
        thumb: thumbImg(thumb, () => h('div.pk-media-empty', null, PK.icon('film', 16))),
        title,
        sub: `${num(sc.durationSec).toFixed(1)} 秒 · ${env.view.narrationMode === 'subtitle-mv' ? '纯字幕' : hasVoice ? '已配音' : '未配音'}${redubOf(PK.dir()).has(sc.id) ? ' · 需重配' : ''}`,
        active: sc.id === L.sel,
        tip: `${sc.id} · ${sceneTitle(sc, i)}`,
        right: h(
          'span.pk-sc-ics',
          null,
          h('i.pk-sc-dot', { 'data-sc-mark': sc.id, class: { 'is-dirty': dirtyIds.has(sc.id) }, title: '有未保存的修改' }),
          locked ? tip(h('span.pk-sc-ic.is-lock', null, PK.icon('lock', 13)), '已锁定：AI 不会改动本幕') : null,
          names.length ? tip(h('span.pk-sc-ic.is-guard', null, PK.icon('check', 13)), `已保护你的手动修改：${names.join('、')}`) : null,
          !hasVoice && env.view.narrationMode !== 'subtitle-mv' && String(sc.narration || '').trim() ? tip(h('span.pk-sc-ic.is-mute', null, PK.icon('mic', 13)), '这一幕还没有配音') : null,
        ),
        onClick: () => env.select(sc.id, { edit: true }),
      })
    })
    return h(
      'aside.pk-sc-col.pk-sc-list',
      { 'aria-label': '分镜列表' },
      h('header.pk-sc-colh', null, h('span.pk-sc-colh-t', null, '分镜'), ui.pill(`${scenes.length} 幕 · ${U.fmtDur(total)}`, 'mute'), ui.spacer(), isDirty(L) && L.patch.order ? ui.pill('顺序已调整', 'warn') : null),
      h('div.pk-sc-scroll', { 'data-pk-scroll': 'sc-list' }, ui.list(items, { dense: true })),
    )
  }

  /* ---- center: monitor + timeline */
  function centerPane(env) {
    const { L, s } = env
    const p = s.project || {}
    const hasMp4 = Boolean(p.hasMp4)
    const hasSnap = Boolean(p.hasSnapshot)
    const src = currentSrc(env)
    const playBtn = ui.iconBtn('play', () => togglePlay(env.ctx.local.__scScreen), { title: '播放预览' })
    playBtn.setAttribute('data-sc-play', '1')
    if (src === 'snap' || (src === 'html' && !htmlLive(env))) playBtn.disabled = true
    const i = env.idx
    const fmt = `${env.view.aspectRatio || ''} · ${String(env.view.quality || '').toUpperCase()} · ${PK.optionLabel('platforms', (PK.state && PK.state.director && PK.state.director.targetPlatform) || env.view.targetPlatform || 'universal', '通用')}`
    const srcOpts = [
      { value: 'mp4', label: '成片', icon: 'film', disabled: !hasMp4, hint: hasMp4 ? '成片：渲染好的 MP4（真实画面）' : '成片：还没有渲染' },
      { value: 'html', label: '动态预演', icon: 'eye', hint: '动态预演：HTML5 骨架，改完保存后立即可看' },
      { value: 'snap', label: '九宫格', icon: 'grid', disabled: !hasSnap, hint: hasSnap ? '九宫格：成片关键帧检查图' : '九宫格：渲染成片后生成' },
    ]
    const srcSeg = ui.seg({
      value: src,
      aria: '预览来源',
      class: 'pk-sc-srcseg',
      options: srcOpts,
      onChange: (v) => {
        L.ui.src = v
        env.rr()
      },
    })
    // narrow monitors show icons only → keep an accessible name on every segment
    srcSeg.querySelectorAll('.pk-seg-b').forEach((b, k) => srcOpts[k] && b.setAttribute('aria-label', srcOpts[k].label))
    const monbar = h(
      'div.pk-sc-monbar',
      null,
      srcSeg,
      ui.iconBtn('chevL', () => i > 0 && env.select(env.scenes[i - 1].id), { title: '上一幕', disabled: i <= 0 }),
      playBtn,
      ui.iconBtn('chevR', () => i < env.scenes.length - 1 && env.select(env.scenes[i + 1].id), { title: '下一幕', disabled: i >= env.scenes.length - 1 }),
      h('span.pk-sc-tc', { 'data-sc-tc': '1' }, `${clock(num((findScene(env.server, env.sc.id) || env.sc).startSec))} / ${clock(env.server.totalDurationSec)}`),
      ui.spacer(),
      ui.btn(fmt, () => formatDialog(env), { size: 'sm', icon: 'settings', class: 'pk-sc-fmt', title: '修改画面比例、画质与发布平台（防遮挡安全区）', disabled: env.busy }),
      onBtn(ui.iconBtn('target', () => ((L.ui.safe = !L.ui.safe), env.rr()), { title: L.ui.safe ? '隐藏平台防遮挡安全线' : '显示平台防遮挡安全线' }), L.ui.safe),
      hasMp4 && p.hasReferenceVideo ? ui.iconBtn('split', () => PK.open('reference'), { title: '与参考视频对比' }) : null,
      ui.iconBtn('code', () => PK.open('code'), { title: '查看工程生成的源码' }),
      onBtn(ui.iconBtn('list', () => ((L.ui.list = !L.ui.list), (L.reveal = L.ui.list), env.rr()), { title: L.ui.list ? '收起分镜列表' : '展开分镜列表', class: 'pk-sc-listtoggle' }), L.ui.list),
    )
    const notes = []
    if (L.ui.safe && L.safe && L.safe.preflight) {
      const pf = L.safe.preflight
      const cols = Array.isArray(pf.collisions) ? pf.collisions : []
      notes.push(ui.pill(`安全区 · ${pf.platformLabel || ''}${cols.length ? ` · ${cols.length} 处可能被遮挡` : ' · 无遮挡风险'}`, cols.length ? 'warn' : 'ok', { title: cols.map((c) => c.suggestion).join('\n') || '字幕与核心文案都在安全区内' }))
    } else if (L.ui.safe && L.safe && L.safe.error) notes.push(ui.pill(`安全区读取失败：${L.safe.error}`, 'err'))
    const obs = L.ui.safe && L.safe && L.safe.preflight && Array.isArray(L.safe.preflight.obstructions) ? L.safe.preflight.obstructions : []
    if (obs.length) notes.push(h('span.pk-sc-legend', { title: '画面上虚线框是平台界面会遮住的位置，重要文字不要放在里面' }, obs.map((o, oi) => h('span', null, h('b', null, String(oi + 1)), `避让区 · ${o.label || ''}`))))
    if (L.refine.region) notes.push(ui.pill(`AI 只改：${regionText(L.refine.region)}`, 'acc', { title: '在「对 AI 说 → 指哪改哪」里可清除' }))
    return h(
      'section.pk-sc-col.pk-sc-center',
      { 'aria-label': '预览与时间轴' },
      monbar,
      env.slot,
      notes.length ? h('div.pk-sc-monnote', null, notes) : null,
      timelinePane(env),
    )
  }
  function htmlLive(env) {
    return !(PK.state && PK.state.lowSpec) || env.L.htmlOn
  }
  function currentSrc(env) {
    const p = env.s.project || {}
    let src = env.L.ui.src || (p.hasMp4 ? 'mp4' : 'html')
    if (src === 'mp4' && !p.hasMp4) src = 'html'
    if (src === 'snap' && !p.hasSnapshot) src = p.hasMp4 ? 'mp4' : 'html'
    return src
  }
  function configureScreen(env, k) {
    const { L, s, server } = env
    const W = num(server.width) || 1920
    const H = num(server.height) || 1080
    k.ar = W / H
    const src = currentSrc(env)
    const project = s.project || {}
    const srvSc = findScene(server, env.sc.id) || env.sc
    const poster = thumbUrlOf(env, env.sc)
    let mode = src
    if (src === 'html' && !htmlLive(env)) mode = 'poster'
    if (mode !== k.mode) {
      if (k.mode === 'mp4' && k.video) {
        try {
          k.video.pause()
        } catch {}
      }
      if (k.mode === 'html') stopPlayback(k)
      PK.clear(k.media)
      k.iframe = mode === 'html' ? k.iframe : null
      if (mode !== 'html') k.iframeUrl = ''
      k.mode = mode
    }
    if (mode === 'mp4') {
      const url = fileUrl('output/final.mp4', env.mediaVer)
      if (!k.video) {
        k.video = h('video', { preload: 'metadata', playsinline: '', controls: 'controls' })
        k.video.addEventListener('timeupdate', () => onScreenTime(k, k.video.currentTime))
        k.video.addEventListener('seeked', () => onScreenTime(k, k.video.currentTime))
        k.video.addEventListener('play', () => paintPlayButtons(k))
        k.video.addEventListener('pause', () => paintPlayButtons(k))
      }
      if (k.videoUrl !== url) {
        k.videoUrl = url
        k.video.src = url
      }
      if (poster) k.video.poster = poster
      if (k.video.parentNode !== k.media) {
        PK.clear(k.media)
        k.media.appendChild(k.video)
      }
    } else if (mode === 'html') {
      const url = `${fileUrl('index.html', hash(server.updatedAt || ''))}&preview=1`
      if (!k.iframe || k.iframeUrl !== url) {
        stopPlayback(k)
        const ifr = h('iframe', { src: url, title: 'HTML5 动态预演', sandbox: 'allow-scripts allow-same-origin', loading: 'eager' })
        ifr.addEventListener('load', () => {
          const e = k.env
          if (!e) return
          const sc = findScene(e.server, e.L.sel) || {}
          k.frame = Math.floor(num(sc.startSec) * fpsOf(e.server))
          setTimeout(() => postToDraft(k, { type: 'dsh-seek', frame: k.frame }), 120)
        })
        k.iframe = ifr
        k.iframeUrl = url
        PK.clear(k.media)
        k.media.appendChild(ifr)
      }
    } else if (mode === 'snap') {
      const url = fileUrl('output/snapshot-3x3.png', env.mediaVer)
      PK.clear(k.media)
      const img = h('img', { src: url, alt: '成片关键帧九宫格', draggable: 'false', style: { cursor: 'zoom-in' } })
      img.addEventListener('click', () => PK.open('scLightbox', { src: url, kind: 'image', title: '关键帧九宫格检查图', caption: '从成片中均匀抽取 9 帧，用来快速检查画面有没有黑屏、错位或花屏。' }))
      k.media.appendChild(img)
    } else {
      PK.clear(k.media)
      k.media.appendChild(
        h(
          'div.pk-sc-poster',
          null,
          thumbImg(poster),
          h(
            'div.pk-sc-poster-c',
            { title: project.hasMp4 ? '低配保护：动态预演不会自动加载，可切到「成片」或手动加载预演' : '低配保护：动态预演不会自动加载（工程还没有渲染成片），可手动加载' },
            h('b', null, '低配保护已开启'),
            h('span', null, project.hasMp4 ? '为避免电脑卡顿，动态预演不会自动加载。可以切到「成片」观看真实画面，或手动加载预演。' : '为避免电脑卡顿，动态预演不会自动加载（工程还没有渲染成片）。需要时点下方按钮手动加载。'),
            ui.btn('加载动态预演', () => {
              L.htmlOn = true
              env.rr()
            }, { kind: 'primary', icon: 'play', size: 'sm' }),
          ),
        ),
      )
    }
    // the HTML skeleton of an AI-coded Remotion project is only an approximation of the real picture
    const aiCoded = server.engine === 'remotion' && server.authoringMode === 'ai-coded'
    k.notice.hidden = !(mode === 'html' && aiCoded)
    const noticeLong = project.hasMp4
      ? '当前显示 HTML5 骨架预演（点上方「成片」可看 AI 定制代码渲染的真实画面）'
      : '当前显示 HTML5 文案 / 节奏骨架；AI 定制代码的真实画面会在「交付」渲染成片后出现'
    PK.clear(k.notice)
    PK.append(k.notice, h('span.pk-sc-notice-l', null, noticeLong), h('span.pk-sc-notice-s', null, 'HTML5 骨架预演 · 非最终画面'))
    k.notice.title = noticeLong
    // safe-zone guides
    PK.clear(k.ovSafe)
    const pf = L.ui.safe && L.safe && L.safe.preflight
    if (pf && Array.isArray(pf.obstructions)) {
      for (const [oi, o] of pf.obstructions.entries()) {
        k.ovSafe.appendChild(h('div.pk-sc-safe-b', { class: { 'is-danger': o.tone === 'danger' }, title: `避让区 · ${o.label || ''}`, style: { left: `${num(o.x) * 100}%`, top: `${num(o.y) * 100}%`, width: `${num(o.w) * 100}%`, height: `${num(o.h) * 100}%` } }, h('span', null, String(oi + 1), h('i.pk-sc-safe-l', null, ` · 避让区 · ${o.label || ''}`))))
      }
    }
    paintRegion(k)
    if (L.seek) {
      const id = L.seek
      L.seek = null
      const t = num((findScene(server, id) || srvSc).startSec)
      seekScreenTo(k, t)
    }
    paintPlayButtons(k)
  }

  /* ---- timeline */
  function timelinePane(env) {
    const { L, view, scenes } = env
    const bgm = view.bgm || {}
    const zoom = num(L.ui.zoom, 1) || 1
    const sum = dirtySummary(L)
    const quick = ui.btn(sum.count ? '保存时间轴' : '已同步', () => doSave(env, { quick: true }), { size: 'sm', icon: 'save', kind: sum.count ? 'primary' : 'ghost', disabled: !sum.count || env.busy, busyText: '保存中…' })
    quick.setAttribute('data-sc-save', '1')
    const head = h(
      'header.pk-sc-tlh',
      null,
      // disclosure: on short screens the monitor gets the whole column when the tracks are folded away
      ui.iconBtn(L.ui.tl === false ? 'chevR' : 'chev', () => ((L.ui.tl = L.ui.tl === false), (L.reveal = L.ui.tl), env.rr()), { title: L.ui.tl === false ? '展开多轨时间轴' : '收起多轨时间轴（让预览画面更大）', class: 'pk-sc-tltoggle' }),
      h('span.pk-sc-tlh-t', null, '多轨时间轴'),
      ui.pill(`${scenes.length} 镜 · ${num(view.totalDurationSec).toFixed(1)} 秒`, 'mute'),
      num(bgm.bpm) > 0 ? ui.pill(`${Math.round(num(bgm.bpm))} BPM${Array.isArray(bgm.drops) && bgm.drops.length ? ` · ${bgm.drops.length} 高潮点` : ''}`, 'acc') : null,
      view.audioProfile && view.audioProfile.profileName ? ui.pill(view.audioProfile.profileName, 'ok') : null,
      ui.spacer(),
      onBtn(ui.btn(L.ui.snap ? '节拍吸附：开' : '节拍吸附：关', () => ((L.ui.snap = !L.ui.snap), env.rr()), { size: 'sm', kind: 'ghost', icon: 'music', class: 'pk-sc-snap', title: L.ui.snap ? '节拍吸附已开启：± 时长按半拍（跟着 BGM 鼓点）调整（点击关闭）' : '节拍吸附已关闭：± 时长每次 0.25 秒（点击开启）' }), L.ui.snap),
      ui.seg({ value: String(zoom), aria: '时间轴缩放', options: ['1', '1.5', '2.5', '4'].map((z) => ({ value: z, label: `${z}×` })), onChange: (v) => ((L.ui.zoom = Number(v)), env.rr()) }),
      quick,
    )
    const n = scenes.length
    const fx = (sc) => ({ flexGrow: String(Math.max(0.8, num(sc.durationSec, 3))) })
    const v1 = scenes.map((sc, i) => {
      const sel = sc.id === L.sel
      const thumb = thumbUrlOf(env, sc)
      const tx = TRANSITIONS.find((t) => t.value === (sc.transition || 'cut'))
      const el = h(
        'div.pk-sc-blk',
        { 'data-sc-id': sc.id, class: { 'is-sel': sel, 'is-locked': lockedOf(env, sc) }, style: fx(sc), role: 'button', tabindex: '0', title: `${sc.id} · ${sceneTitle(sc, i)}（点击选中）` },
        h('div.pk-sc-blk-h', null, thumbImg(thumb), h('span.pk-sc-blk-n', null, `${sceneNo(i)} · ${num(sc.durationSec).toFixed(2)}s`), h('span.pk-sc-blk-t', { 'data-sc-title': sc.id, title: sceneTitle(sc, i) }, sceneTitle(sc, i)), h('i.pk-sc-dot', { 'data-sc-mark': sc.id, class: { 'is-dirty': Boolean(L.patch && L.patch.scenes[sc.id]) } })),
        h(
          'div.pk-sc-blk-c',
          { onClick: (ev) => ev.stopPropagation() },
          ui.iconBtn('minus', () => nudgeDuration(env, sc.id, -1), { title: L.ui.snap ? '缩短半拍' : '缩短 0.25 秒' }),
          ui.iconBtn('plus', () => nudgeDuration(env, sc.id, 1), { title: L.ui.snap ? '延长半拍' : '延长 0.25 秒' }),
          ui.iconBtn('chevL', () => moveScene(env, sc.id, -1), { title: '前移一镜', disabled: i === 0 }),
          ui.iconBtn('chevR', () => moveScene(env, sc.id, 1), { title: '后移一镜', disabled: i === n - 1 }),
          h('button.pk-sc-tx', { type: 'button', title: `转场：${tx ? tx.label : sc.transition}（点击切换下一种）`, onClick: () => cycleTransition(env, sc) }, tx ? tx.label : sc.transition || '直接硬切'),
        ),
        h('i.pk-sc-prog'),
      )
      el.addEventListener('click', () => env.select(sc.id))
      el.addEventListener('keydown', (ev) => {
        if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === el) {
          ev.preventDefault()
          env.select(sc.id)
        }
      })
      return el
    })
    const t1 = scenes.map((sc) => {
      const text = String(sc.subtitleText || sc.narration || '').trim()
      const el = h('div.pk-sc-sub', { class: { 'is-sel': sc.id === L.sel }, style: fx(sc), title: text || '（纯画面，无旁白）', role: 'button', tabindex: '0' }, `${sc.audioFile ? '🎙 ' : '💬 '}${text || '（纯画面）'}`)
      el.addEventListener('click', () => env.select(sc.id, { edit: true }))
      return el
    })
    const s1 = scenes.map((sc) => {
      const cues = Array.isArray(sc.sfxCues) ? sc.sfxCues : []
      return h(
        'div.pk-sc-sfx',
        { style: fx(sc) },
        cues.slice(0, 3).map((q, ci) => h('button.pk-sc-cue', { type: 'button', title: `点击移除音效「${SFX_LABEL[q.type] || q.type}」(@${num(q.offsetSec).toFixed(2)}s)`, onClick: () => removeCue(env, sc, ci) }, `${SFX_LABEL[q.type] || q.type} ×`)),
        cues.length > 3 ? h('span.pk-sc-cue-more', { title: cues.slice(3).map((q) => SFX_LABEL[q.type] || q.type).join('、') }, `+${cues.length - 3}`) : null,
        h('button.pk-sc-cue-add', { type: 'button', title: `给这一幕加「${SFX_LABEL[L.ui.sfxType] || L.ui.sfxType}」音效`, onClick: () => addCue(env, sc, L.ui.sfxType) }, `+ ${SFX_LABEL[L.ui.sfxType] || L.ui.sfxType}`),
      )
    })
    const defVol = view.narrationMode === 'subtitle-mv' ? 0.84 : 0.42
    const vol = num(bgm.volume, defVol)
    const bgmPath = String(bgm.uploadedPath || bgm.path || view.bgmMode || '')
    const a1 = h(
      'div.pk-sc-bgm',
      null,
      h('span.pk-sc-bgm-t', { title: bgmPath }, `♪ ${bgmPath ? U.baseName(bgmPath) : '未设置配乐'} · ${env.s.project && env.s.project.hasMasterAudio ? '母带已混音' : '待混音'}`),
      h('span', { style: { whiteSpace: 'nowrap', fontWeight: 700 } }, 'BGM 音量'),
      ui.slider({
        value: vol,
        min: 0.1,
        max: 1,
        step: 0.05,
        format: (v) => `${Math.round(v * 100)}%`,
        aria: 'BGM 音量',
        onChange: (v) => {
          const x = U.clamp(Number(v), 0, 1)
          const cur = env.server.bgm && env.server.bgm.volume
          patchOf(L).bgmVolume = cur !== undefined && same(cur, x) ? undefined : x
          if (patchEmpty(L.patch)) L.patch = null
          env.rr()
        },
      }),
      h('span', { style: { whiteSpace: 'nowrap', fontWeight: 700 } }, '加音效'),
      ui.select({ value: L.ui.sfxType, options: SFX_TYPES, searchable: true, menuTitle: '选择要追加的音效类型', onChange: (v) => ((L.ui.sfxType = v), env.rr()) }),
    )
    const track = (code, label, blocks, extraClass) =>
      h('div.pk-sc-trk', { class: extraClass || null }, h('span.pk-sc-trk-l', null, code, h('small', null, label)), h('div.pk-sc-trk-b', null, blocks))
    return h(
      'section.pk-sc-tl',
      { 'aria-label': '多轨时间轴' },
      head,
      h('div.pk-sc-tracks', { 'data-pk-scroll': 'sc-tracks', style: { '--sc-zoom': String(zoom), '--sc-n': String(n) } }, track('V1', '分镜', v1), track('T1', '字幕配音', t1), track('S1', '音效', s1), track('A1', 'BGM 混音', [a1])),
    )
  }

  /* ---- right: inspector */
  function inspectorPane(env) {
    const { L } = env
    const tab = L.ui.insTab
    const ov = env.server.userOverrides || {}
    const tabs = ui.tabs({
      value: tab,
      items: [
        { value: 'edit', label: '分镜手调', icon: 'edit' },
        { value: 'ai', label: '对 AI 说', icon: 'sparkle' },
        { value: 'guard', label: '保护与锁定', icon: 'lock', badge: Object.keys(ov).length || null },
      ],
      onChange: (v) => {
        L.ui.insTab = v
        env.rr()
      },
    })
    const body = tab === 'ai' ? aiTab(env) : tab === 'guard' ? guardTab(env) : editTab(env)
    return h('aside.pk-sc-col.pk-sc-insp', { 'aria-label': '分镜属性' }, h('div.pk-sc-colh', { style: { padding: '0', minHeight: '0', border: '0' } }), tabs, h('div.pk-sc-scroll', { 'data-pk-scroll': `sc-insp-${tab}` }, body))
  }
  function sceneSwitcher(env) {
    const opts = env.scenes.map((sc, i) => ({ value: sc.id, label: `${sceneNo(i)} · ${sceneTitle(sc, i)}`, hint: `${sc.id} · ${num(sc.durationSec).toFixed(1)} 秒` }))
    const i = env.idx
    return h(
      'div.pk-sc-insh',
      null,
      ui.select({ value: env.sc.id, options: opts, searchable: opts.length > 8, aria: '切换分镜', menuTitle: '跳到分镜', onChange: (v) => env.select(v) }),
      ui.iconBtn('chevL', () => i > 0 && env.select(env.scenes[i - 1].id), { title: '上一幕', disabled: i <= 0 }),
      ui.iconBtn('chevR', () => i < env.scenes.length - 1 && env.select(env.scenes[i + 1].id), { title: '下一幕', disabled: i >= env.scenes.length - 1 }),
    )
  }
  function voiceOptions(env, sc) {
    const cat = (env.s.data && env.s.data.voiceCatalog) || []
    const list = cat
      .filter((v) => v && v.id)
      .map((v) => ({ value: String(v.id), label: String(v.name || v.id), hint: [v.category, v.gender === 'female' ? '女声' : v.gender === 'male' ? '男声' : '', v.available === false ? '未就绪' : ''].filter(Boolean).join(' · '), ok: v.available !== false }))
      .sort((a, b) => Number(b.ok) - Number(a.ok))
    const def = (env.server.defaultVoiceId && env.server.defaultVoiceId !== 'auto' ? env.server.defaultVoiceId : '') || ''
    const defName = def ? (cat.find((v) => v.id === def) || {}).name || def : ''
    const out = [{ value: 'auto', label: defName ? `跟随全片（${defName}）` : 'AI 自动匹配', hint: '不单独指定，本幕使用全片主配音 / AI 自动选' }, ...list]
    return withCurrent(out, sc.voiceId, sc.voiceName || sc.voiceId)
  }
  /** 试听 the scene voice (「跟随全片」 → the project's main voice; AI auto-match has no sample until it is dubbed) */
  function voicePreviewBtn(env, voiceId) {
    const def = env.server.defaultVoiceId && env.server.defaultVoiceId !== 'auto' ? env.server.defaultVoiceId : ''
    const id = voiceId && voiceId !== 'auto' ? voiceId : def
    const b = ui.playBtn(() => PK.routeUrl('voices/preview', { id, v: Date.now() }), { label: '试听', title: id ? '试听这个音色的原声样本' : 'AI 自动匹配：配音时才确定具体音色，暂无样本可试听' })
    if (!id) b.disabled = true
    return b
  }
  function editTab(env) {
    const { L, sc, idx, server } = env
    const srv = findScene(server, sc.id) || sc
    const ov = (server.userOverrides && server.userOverrides[sc.id]) || null
    const names = ov ? fieldNames(ov) : []
    const locked = lockedOf(env, sc)
    const title = sceneTitle(sc, idx)
    const busy = env.busy
    const subMv = env.view.narrationMode === 'subtitle-mv'
    const fps = env.fps
    const emo = withCurrent([...new Set([...optList('emotions', []).map((o) => o.value), ...BASE_EMOTIONS])].map((e) => ({ value: e, label: e })), sc.emotion)
    const rate = String((num(sc.speechRate) || 1).toFixed(2))
    const rates = withCurrent(SPEECH_RATES, rate, `${rate}× 当前`).sort((a, b) => Number(a.value) - Number(b.value))
    const voices = voiceOptions(env, sc)
    const voiceId = sc.voiceId || 'auto'
    const audioRel = sc.masteredAudioFile || sc.audioFile
    const voiceLen = num(sc.voiceDurationSec)
    const minLen = voiceLen > 0 ? voiceLen + num(sc.voiceLeadSec, 0.35) + 0.1 : 0
    const cues = Array.isArray(sc.sfxCues) ? sc.sfxCues : []
    const media = Array.isArray(sc.media) ? sc.media : []
    const aiCoded = server.engine === 'remotion' && server.authoringMode === 'ai-coded'
    const aiPic = aiCoded && !sc.useBuiltinLayout
    const layoutOpts = withCurrent(optList('sceneLayouts', FALLBACK_LAYOUTS), sc.layout)
    const durInput = ui.input({ key: `sc-dur-${sc.id}`, type: 'number', value: num(sc.durationSec).toFixed(2), min: 0.45, max: 600, step: 0.05, aria: '镜头时长（秒）', onChange: (v) => v !== '' && setDuration(env, sc.id, v) })
    return [
      sceneSwitcher(env),
      ui.row(
        [
          h('b', { style: { fontSize: '14px', minWidth: 0, overflowWrap: 'anywhere', flex: '1 1 auto' } }, `分镜手调 · ${sc.id}`),
          ui.btn(locked ? '已锁定' : '锁定本幕', () => toggleLock(env, sc.id, !locked), { size: 'sm', icon: locked ? 'lock' : 'unlock', kind: locked ? 'secondary' : 'ghost', disabled: busy, title: locked ? '已锁定：AI 重新生成与精修都不会改动本幕（点击解锁）' : '锁定后，AI 重新生成与精修都会保留本幕不动' }),
        ],
        { wrap: true },
      ),
      ui.row([ui.btn('上移', () => moveScene(env, sc.id, -1), { size: 'sm', kind: 'ghost', icon: 'chevL', disabled: idx === 0 }), ui.btn('下移', () => moveScene(env, sc.id, 1), { size: 'sm', kind: 'ghost', icon: 'chevR', disabled: idx >= env.scenes.length - 1 }), ui.hint(`第 ${idx + 1} / ${env.scenes.length} 幕 · 从 ${num(sc.startSec).toFixed(2)}s 开始`)]),
      locked ? ui.note('本幕已锁定：AI 重新出片、批量编码和精修都会原样保留它。你仍然可以在这里手动修改。', { level: 'ok' }) : null,
      names.length
        ? h('div.pk-sc-guard', null, PK.icon('check', 14), h('span', null, `已保护你的手动修改：${names.join('、')}（AI 重新出片时会保留）`), ui.btn('不再保护', () => clearProtection(env, sc.id, title, names), { size: 'sm', kind: 'ghost', disabled: busy }))
        : null,
      redubOf(PK.dir()).has(sc.id) && !subMv
        ? ui.note('旁白已经改了，但配音和字幕还是旧的。点「重配此幕配音」让声音和字幕跟上新文字。', { level: 'warn', actions: [ui.btn('重配此幕配音', () => ttsScene(env, sc), { size: 'sm', icon: 'mic', kind: 'primary', disabled: busy })] })
        : null,
      ui.section(
        { title: '文案', en: 'COPY', icon: 'edit' },
        ui.field({ label: '画面主标题', en: 'TITLE' }, ui.textarea({ key: `sc-title-${sc.id}`, value: sc.title || '', rows: 1, minRows: 1, maxRows: 4, maxLength: 200, placeholder: '这一幕在画面上显示的大标题', onInput: (v) => env.edit('title', v), expand: { title: `画面主标题 · ${sc.id}` } })),
        ui.field(
          { label: subMv ? '画面文案' : '口播旁白', en: 'NARRATION', hint: subMv ? '纯音乐卡点模式没有配音：画面上显示的是下方「屏幕字幕」。改完文案后点「用文案重新生成字幕」同步过去。' : '改完记得点下方「重配此幕配音」，声音和字幕才会换成新文字' },
          ui.textarea({ key: `sc-narr-${sc.id}`, value: sc.narration || '', rows: 4, minRows: 3, maxRows: 12, counter: true, placeholder: subMv ? '这一幕要表达的文字' : '这一幕要说的话（也是默认字幕）', onInput: (v) => env.edit('narration', v), expand: { title: `${subMv ? '画面文案' : '口播旁白'} · ${sc.id}「${title}」`, hint: subMv ? '纯音乐卡点模式的画面文案。' : '这是 AI 配音要念的内容，也是默认字幕。写口语化的短句效果最好。' } }),
        ),
        ui.field(
          { label: '屏幕字幕', en: 'SUBTITLE', hint: subMv ? '画面上实际显示的文字。清空后保存 = 按上面的文案重新生成。' : '默认按旁白自动断句。改这里只改变屏幕上显示的字幕文字（保存后按新文字重新排版）；清空后保存 = 按旁白重新生成；重新配音时字幕会按旁白重新断句。' },
          ui.textarea({ key: `sc-sub-${sc.id}`, value: sc.subtitleText || '', rows: 2, minRows: 2, maxRows: 8, counter: true, placeholder: subMv ? '留空 = 按画面文案自动生成字幕' : '留空 = 跟随旁白自动生成字幕', onInput: (v) => env.edit('subtitleText', v), expand: { title: `屏幕字幕 · ${sc.id}「${title}」` } }),
        ),
        subMv
          ? ui.btn('用文案重新生成字幕', () => {
              // typing does not re-render: read the text from the live draft, not from this render's scene
              const draft = L.patch && L.patch.scenes[sc.id]
              const narr = draft && Object.prototype.hasOwnProperty.call(draft, 'narration') ? draft.narration : srv.narration
              setField(L, server, sc.id, 'subtitleText', String(narr || '').trim())
              env.rr()
            }, { size: 'sm', icon: 'refresh', kind: 'ghost', title: '把上面的画面文案填进屏幕字幕（保存后生效）' })
          : null,
      ),
      subMv
        ? null
        : ui.section(
            { title: '声音', en: 'VOICE', icon: 'voice' },
            ui.field(
              { label: '本幕音色', en: 'VOICE', hint: voiceId === 'auto' ? '跟随全片主配音（或 AI 自动匹配）' : '只对这一幕生效；改完点「重配此幕配音」' },
              ui.row([
                ui.select({ value: voiceId, options: voices, searchable: true, showHint: true, menuTitle: `为 ${sc.id} 选择音色`, onChange: (v) => setVoice(env, sc, v) }),
                voicePreviewBtn(env, voiceId),
              ], { wrap: false }),
            ),
            ui.grid(
              [
                ui.field({ label: '情绪', en: 'EMOTION' }, ui.select({ value: sc.emotion || '平静', options: emo, onChange: (v) => env.edit('emotion', v, { render: true }) })),
                ui.field({ label: '语速', en: 'RATE' }, ui.select({ value: rate, options: rates, onChange: (v) => env.edit('speechRate', Number(v) || 1, { render: true }) })),
              ],
              { min: 140 },
            ),
            h(
              'div.pk-sc-rowbtns',
              null,
              ui.btn('重配此幕配音', () => ttsScene(env, sc), { icon: 'mic', disabled: busy, title: '按当前旁白、音色、情绪和语速重新生成这一幕的配音' }),
              ui.btn('AI 声学修音', () => masterVoice(env, [sc.id]), { icon: 'wave', disabled: busy || !audioRel, title: audioRel ? '对这一幕的人声做降噪、均衡和响度标准化' : '这一幕还没有配音' }),
              audioRel ? ui.playBtn(fileUrl(audioRel, hash(server.updatedAt || '')), { label: '试听本幕配音' }) : null,
            ),
            ui.hint(audioRel ? `已配音 ${voiceLen ? `${voiceLen.toFixed(1)} 秒` : ''}${sc.voiceName ? ` · ${sc.voiceName}` : ''}${sc.voiceMastering && sc.voiceMastering.applied ? ' · 已修音' : ''}` : '这一幕还没有配音。'),
            ui.btn('全片 AI 声学修音（统一响度 -14 LUFS）', () => masterVoice(env, []), { size: 'sm', kind: 'link', disabled: busy }),
          ),
      ui.section(
        { title: '画面', en: 'VISUAL', icon: 'image' },
        // AI-coded scenes: their own AI code is the first choice; the built-in layouts are optional replacements
        ui.field(
          { label: '视觉布局', en: 'LAYOUT', hint: aiCoded ? (aiPic ? '本幕是 AI 按画面需要调用工具或直接写代码做的；改选下面的内置版式会替换它，随时可以切回' : '本幕正在使用内置版式；选「AI 定制代码」可切回 AI 写的画面') : '' },
          ui.select({
            value: aiPic ? AI_LAYOUT : sc.layout || '3d-stage-opener',
            options: aiCoded ? [{ value: AI_LAYOUT, label: 'AI 定制代码（按画面自由编写）', hint: 'AI 按需调用工具，做不到的效果直接写代码' }, ...layoutOpts] : layoutOpts,
            showHint: true,
            searchable: true,
            aria: '视觉布局',
            onChange: (v) => (v === AI_LAYOUT ? useAiLayout(env, sc) : setLayout(env, sc, v, aiCoded)),
          }),
        ),
        ui.grid(
          [
            ui.field({ label: '3D 舞台', en: '3D' }, ui.select({ value: sc.threePreset || 'orbital-core', options: withCurrent(optList('threePresets', FALLBACK_THREE), sc.threePreset), onChange: (v) => env.edit('threePreset', v, { render: true }) })),
            ui.field({ label: '运镜', en: 'MOTION' }, ui.select({ value: sc.kenBurns || 'zoom-in', options: withCurrent(optList('kenBurns', FALLBACK_KENBURNS), sc.kenBurns), onChange: (v) => env.edit('kenBurns', v, { render: true }) })),
            ui.field({ label: '入场转场', en: 'TRANSITION', hint: idx === 0 ? '第 1 幕没有前一幕，转场不生效' : '' }, ui.select({ value: sc.transition || 'cut', options: withCurrent(TRANSITIONS, sc.transition), onChange: (v) => env.edit('transition', v, { render: true }) })),
          ],
          { min: 140 },
        ),
        ui.field(
          { label: '画面素材', en: 'MEDIA', aside: `${media.length} 个`, hint: aiCoded ? '本幕是 AI 定制代码：换素材后，可在「对 AI 说」里让 AI 用新素材重做本幕' : '换成素材库里的图片或视频；保存后预演立即更新' },
          h(
            'div.pk-sc-media-list',
            null,
            media.map((m, mi) => {
              const url = m.type === 'video' ? '' : fileUrl(m.path || m.webPath, 'm')
              const name = U.baseName(m.originalPath || m.path || m.webPath || m.assetId || '素材')
              return h(
                'div.pk-sc-mitem',
                null,
                (() => {
                  const ph = () => h('span.pk-sc-mph', { title: url ? '素材文件缺失' : null }, PK.icon(m.type === 'video' ? 'film' : 'image', 16))
                  const img = thumbImg(url, ph)
                  if (img && img.tagName === 'IMG') {
                    img.style.cursor = 'zoom-in'
                    img.addEventListener('click', () => PK.open('scLightbox', { src: url, kind: 'image', title: name }))
                  }
                  return img
                })(),
                h('div', null, h('b', { title: name }, name), h('small', null, `${m.type === 'video' ? '视频' : '图片'}${m.width ? ` · ${m.width}×${m.height}` : ''}${mi === 0 ? ' · 主画面' : ''}`)),
                ui.btn('替换', async () => {
                  const a = await pickAsset(env, `替换 ${sc.id} 的第 ${mi + 1} 个素材`)
                  if (!a) return
                  const list = U.cloneJson(media)
                  list[mi] = mediaEntry(a, m.motion || sc.kenBurns)
                  setMedia(env, sc, list)
                }, { size: 'sm', kind: 'ghost' }),
                ui.iconBtn('trash', () => setMedia(env, sc, media.filter((_, j) => j !== mi)), { title: '从本幕移除这个素材（不会删除素材库里的文件）' }),
              )
            }),
            ui.btn('添加素材', async () => {
              const a = await pickAsset(env, `给 ${sc.id} 添加画面素材`)
              if (!a) return
              setMedia(env, sc, [...U.cloneJson(media), mediaEntry(a, sc.kenBurns)])
            }, { size: 'sm', icon: 'plus' }),
          ),
        ),
      ),
      ui.section(
        { title: '时长与音效', en: 'TIMING · SFX', icon: 'clock' },
        ui.field(
          { label: '镜头时长（秒）', en: 'DURATION', hint: L.ui.snap ? `节拍吸附已开：± 每次调整半拍（${(60 / (num(env.view.bgm && env.view.bgm.bpm) || 100) / 2).toFixed(2)} 秒）` : '± 每次调整 0.25 秒' },
          h('div.pk-sc-durrow', null, ui.btn('', () => nudgeDuration(env, sc.id, -1), { size: 'sm', icon: 'minus', title: '缩短', aria: '缩短时长' }), durInput, ui.btn('', () => nudgeDuration(env, sc.id, 1), { size: 'sm', icon: 'plus', title: '延长', aria: '延长时长' }), h('span.pk-hint', null, `${Math.round(num(sc.durationSec) * fps)} 帧`)),
        ),
        minLen && num(sc.durationSec) < minLen ? ui.note(`这一幕比配音短（配音约 ${voiceLen.toFixed(1)} 秒），结尾的话可能会被截断。`, { level: 'warn' }) : null,
        ui.field(
          { label: '音效卡点', en: 'SFX', aside: `${cues.length} 个` },
          h(
            'div.pk-sc-cues',
            null,
            cues.length
              ? cues.map((q, ci) =>
                  h(
                    'div.pk-sc-cuerow',
                    null,
                    h('b', { title: q.type }, SFX_LABEL[q.type] || q.type),
                    ui.input({ key: `sc-cue-o-${sc.id}-${ci}`, type: 'number', value: num(q.offsetSec).toFixed(2), min: 0, max: Math.max(0.1, num(sc.durationSec)), step: 0.05, aria: '出现时间（秒）', title: false, onChange: (v) => v !== '' && editCue(env, sc, ci, { offsetSec: U.clamp(Number(v), 0, Math.max(0, num(sc.durationSec))) }) }),
                    ui.input({ key: `sc-cue-v-${sc.id}-${ci}`, type: 'number', value: num(q.volume, 0.8).toFixed(2), min: 0, max: 1, step: 0.05, aria: '音量（0-1）', title: false, onChange: (v) => v !== '' && editCue(env, sc, ci, { volume: U.clamp(Number(v), 0, 1) }) }),
                    ui.iconBtn('x', () => removeCue(env, sc, ci), { title: '移除这个音效' }),
                  ),
                )
              : ui.hint('这一幕还没有音效。'),
            cues.length ? ui.hint('左：出现时间（秒，从本幕开始算）　右：音量（0–1）') : null,
            ui.row([
              ui.select({ value: L.ui.sfxType, options: SFX_TYPES, searchable: true, menuTitle: '音效类型', onChange: (v) => ((L.ui.sfxType = v), env.rr()) }),
              ui.playBtn(() => fileUrl(`audio/sfx/${L.ui.sfxType}.wav`, 's'), { label: '', title: '试听这个音效' }),
              ui.btn('添加', () => addCue(env, sc, L.ui.sfxType), { size: 'sm', icon: 'plus' }),
            ], { wrap: false }),
          ),
        ),
      ),
      ui.section(
        { title: '满意了？', en: 'NEXT' },
        ui.btn(isDirty(L) ? '保存并刷新预演画面' : '修改已保存', () => doSave(env), { kind: isDirty(L) ? 'primary' : 'secondary', icon: 'save', block: true, disabled: !isDirty(L) || busy, busyText: '保存中…' }),
        ui.btn(`满意了！渲染 ${String(server.quality || '1080p').toUpperCase()} 成品 MP4`, async () => {
          // like the classic studio: start the render right away and follow it on the 交付 step
          // (pending edits are saved first, while the user still sees them — cancelling keeps them on this step)
          if (!(await ensureSaved(env, '渲染成片'))) return
          env.s.go('delivery')
          const ctx = env.ctx
          const dl = (ctx.local['s:delivery'] = ctx.local['s:delivery'] || {})
          initDelivery({ local: dl })
          renderMp4(ctx, { local: dl, script: env.s.script, project: env.s.project, data: env.s.data }, false)
        }, { kind: 'primary', block: true, icon: 'film', disabled: busy, title: '保存好的分镜会被渲染成高清成片，并自动做音画质检（需要几分钟）' }),
        ui.btn('只去「交付」看看', () => env.s.go('delivery'), { block: true, kind: 'ghost', icon: 'arrowR' }),
      ),
    ]
  }
  function aiTab(env) {
    const { L, sc, idx } = env
    const R = L.refine
    const busy = env.busy
    const n = num(PK.state && PK.state.projectFlags && PK.state.projectFlags.historyCount) || num(env.s.project && env.s.project.historyCount)
    const srv = findScene(env.server, sc.id) || sc
    const tr = rangeOf(env)
    const pv = R.preview
    return [
      !llmReady() ? ui.note('还没有配置 AI 大模型，AI 改片需要先填好模型接口。', { level: 'warn', actions: [ui.btn('去配置大模型', () => PK.open('keys', { tab: 'llm' }), { size: 'sm', kind: 'primary', icon: 'key' })] }) : null,
      isLiveRun() ? ui.note('AI 正在出片中，等它完成后再精修，避免互相覆盖。', { level: 'warn' }) : null,
      ui.section(
        { title: '一键改片', en: 'QUICK FIX', icon: 'wand' },
        ui.hint(`点一下就让 AI 动手（默认只改当前幕 ${sc.id}，标了「全片」的会调整整部片子）。`),
        h('div.pk-sc-pills', null, QUICK_FIX_PILLS.map((p) => ui.btn(p.scope === 'global' ? `${p.label} · 全片` : p.label, () => runRefine(env, p.prompt, p.scope || R.scope), { size: 'sm', kind: 'secondary', disabled: busy, title: p.prompt }))),
        n > 0
          ? ui.row([ui.hint('AI 改得不满意？'), ui.btn(`撤回上一版（${n}）`, () => rollback(env), { size: 'sm', kind: 'ghost', icon: 'history', disabled: busy, title: '恢复到 AI 上一次修改之前的样子（撤回前会自动备份）' })])
          : null,
      ),
      ui.section(
        { title: '对 AI 说', en: 'TELL AI', icon: 'prompt' },
        ui.textarea({
          key: 'sc-ai-prompt',
          value: R.prompt,
          rows: 3,
          minRows: 3,
          maxRows: 10,
          maxLength: 4000,
          counter: true,
          placeholder: '例如：这一幕换成更震撼的数据增长动画，加大标题字号…',
          onInput: (v) => (R.prompt = v),
          onSubmit: () => runRefine(env, R.prompt),
          expand: { title: '对 AI 说 · 修改要求', hint: '用大白话描述你想怎么改：改哪里、改成什么样、要什么感觉。' },
        }),
        ui.seg({ value: R.scope, options: [{ value: 'scene', label: `只改当前幕（${sc.id}）` }, { value: 'global', label: '调整全片整体' }], onChange: (v) => ((R.scope = v), env.rr()) }),
        ui.btn('AI 立即改好', () => runRefine(env, R.prompt), { kind: 'primary', icon: 'sparkle', block: true, disabled: busy, title: 'Ctrl + Enter' }),
      ),
      ui.section(
        { title: '指哪改哪', en: 'TARGETED', icon: 'target' },
        ui.toggle({ value: R.rangeOn, label: '只改一段时间 / 画面区域', hint: '先预览会改到哪些分镜；已锁定的分镜会自动跳过', onChange: (v) => ((R.rangeOn = v), (R.preview = null), env.rr()) }),
        R.rangeOn
          ? h(
              'div.pk-stack',
              null,
              h(
                'div.pk-sc-range',
                null,
                ui.field({ label: '开始（秒）' }, ui.input({ key: 'sc-rg-a', type: 'number', min: 0, step: 0.1, value: R.start === '' ? tr.startSec : R.start, onChange: (v) => ((R.start = v === '' ? '' : Number(v)), (R.preview = null), env.rr()) })),
                ui.field({ label: '结束（秒）' }, ui.input({ key: 'sc-rg-b', type: 'number', min: 0, step: 0.1, value: R.end === '' ? tr.endSec : R.end, onChange: (v) => ((R.end = v === '' ? '' : Number(v)), (R.preview = null), env.rr()) })),
              ),
              h(
                'div.pk-sc-rowbtns',
                null,
                ui.btn(`用当前分镜（${num(srv.startSec).toFixed(1)}–${(num(srv.startSec) + num(srv.durationSec)).toFixed(1)}s）`, () => ((R.start = ''), (R.end = ''), (R.preview = null), env.rr()), { size: 'sm', kind: 'ghost' }),
                onBtn(ui.btn(R.picking ? '在画面上拖出区域…' : R.region ? '重新框选区域' : '框选画面区域（可选）', () => {
                  R.picking = !R.picking
                  if (R.picking) {
                    L.ui.tab = 'preview'
                    if (currentSrc(env) === 'html' && !htmlLive(env)) L.htmlOn = true
                    PK.toast('在预览画面上按住鼠标，拖出一个矩形框住要修改的地方', 'info')
                  }
                  env.rr()
                }, { size: 'sm', kind: 'ghost', icon: 'target' }), R.picking),
                R.region ? ui.btn('清除区域', () => ((R.region = null), (R.preview = null), env.rr()), { size: 'sm', kind: 'ghost', icon: 'x' }) : null,
              ),
              R.region ? ui.hint(`已框选：${regionText(R.region)}`) : null,
              ui.btn('预览改动范围', () => previewRange(env), { size: 'sm', icon: 'eye', disabled: busy }),
              pv
                ? pv.wouldRefuse
                  ? ui.note('这段时间里只有已锁定的分镜，AI 不会改动。如需修改请先解锁。', { level: 'warn' })
                  : ui.note(
                      `将只修改：${(pv.affectedSceneIds || []).join('、') || '—'}${(pv.skippedLockedScenes || []).length ? `（跳过已锁定：${pv.skippedLockedScenes.join('、')}）` : ''}${pv.region && pv.region.anchorHint ? ` · 区域：${pv.region.anchorHint}` : ''}`,
                      { level: 'info', title: '改动范围' },
                    )
                : null,
              ui.btn('只改这段', () => runRangeRefine(env), { kind: 'primary', icon: 'target', block: true, disabled: busy, title: '按上面「对 AI 说」输入框里的修改要求，只改这一段（和框选的区域）' }),
            )
          : null,
      ),
      ui.hint(`当前选中：${sc.id}「${sceneTitle(sc, idx)}」。AI 改之前会自动备份，可随时撤回。`),
    ]
  }
  function guardTab(env) {
    const { L } = env
    const ed = L.edits
    const busy = env.busy
    const data = ed && ed.data
    const locked = new Set((data && data.lockedSceneIds) || env.scenes.filter((x) => x.locked).map((x) => x.id))
    const overrides = (data && data.userOverrides) || env.server.userOverrides || {}
    const merge = data && data.lastEditMerge
    const conflicts = merge && Array.isArray(merge.conflicts) ? merge.conflicts : []
    const ids = env.scenes.map((x) => x.id)
    const anyOv = Object.keys(overrides).some((k) => k !== '__project__')
    return [
      ui.hint('锁定的分镜在 AI 重新生成、批量编码和精修时都会原样保留；你在这里手动改过的内容也会被记住，AI 重新出片后自动恢复。'),
      ed && ed.loading ? ui.loading('正在读取保护状态…') : null,
      ed && ed.error ? ui.note(ed.error, { level: 'error', title: '读取失败', actions: [ui.btn('重试', () => ((L.edits = null), env.rr()), { size: 'sm', icon: 'retry' })] }) : null,
      merge
        ? ui.note(
            `原样保留锁定分镜 ${Array.isArray(merge.lockedPreserved) ? merge.lockedPreserved.length : 0} 幕 · 恢复人工改动 ${(merge.overridesApplied || []).length} 处${conflicts.length ? ` · 冲突 ${conflicts.length} 项（已以你的人工修改为准）` : ' · 无冲突'}${conflicts.length ? `\n冲突字段：${conflicts.slice(0, 8).map((c) => `${c.sceneId === '__project__' ? '整片' : c.sceneId}.${c.field}`).join('、')}` : ''}`,
            { level: conflicts.length ? 'warn' : 'ok', title: `上次 AI 生成${merge.at ? `（${U.fmtTime(merge.at)}）` : ''}的保护结果` },
          )
        : null,
      h(
        'div.pk-sc-rowbtns',
        null,
        ui.btn('全部锁定', () => bulkLock(env, ids, true), { size: 'sm', icon: 'lock', disabled: busy }),
        ui.btn('全部解锁', () => bulkLock(env, ids, false), { size: 'sm', icon: 'unlock', kind: 'ghost', disabled: busy || !locked.size }),
        ui.btn('清除全部保护', () => clearAllProtection(env), { size: 'sm', kind: 'danger', disabled: busy || !anyOv }),
      ),
      h(
        'div.pk-stack',
        null,
        env.scenes.map((sc, i) => {
          const isLocked = locked.has(sc.id)
          const ov = overrides[sc.id] ? Object.keys(overrides[sc.id]) : []
          return h(
            'div.pk-sc-lockrow',
            { class: { 'is-locked': isLocked } },
            h('div', null, h('b', { title: `${sc.id} · ${sceneTitle(sc, i)}` }, `${sceneNo(i)} · ${sceneTitle(sc, i)}`), h('small', null, ov.length ? `人工改动保护：${fieldNames(ov).join('、')}` : isLocked ? '已锁定' : '未锁定 · 无保护')),
            ov.length ? ui.btn('清除', () => clearProtection(env, sc.id, sceneTitle(sc, i), fieldNames(ov)), { size: 'sm', kind: 'ghost', disabled: busy }) : null,
            ui.btn(isLocked ? '解锁' : '锁定', () => toggleLock(env, sc.id, !isLocked), { size: 'sm', icon: isLocked ? 'unlock' : 'lock', kind: isLocked ? 'secondary' : 'ghost', disabled: busy }),
          )
        }),
      ),
      ui.btn('打开版本历史（对比 / 恢复任意版本）', () => PK.open('history'), { size: 'sm', kind: 'link', icon: 'history' }),
    ]
  }
  async function bulkLock(env, ids, locked) {
    const ok = await PK.confirm({ title: locked ? '锁定全部分镜？' : '解锁全部分镜？', text: locked ? '锁定后，AI 重新出片、批量编码和精修都不会改动任何一幕（你仍可手动修改）。' : '解锁后，AI 重新出片和精修就可以改动这些分镜了。', ok: locked ? '全部锁定' : '全部解锁' })
    if (!ok) return
    await op(locked ? '锁定全部分镜' : '解锁全部分镜', async () => {
      await PK.postP('project/scene-lock', { sceneIds: ids, locked })
      for (const id of ids) env.L.lockOpt[id] = locked
      env.L.edits = null
      PK.toast(locked ? `已锁定全部 ${ids.length} 幕` : `已解锁全部 ${ids.length} 幕`, 'success')
    })
  }
  async function clearAllProtection(env) {
    const ok = await PK.confirm({ title: '清除全部人工改动保护？', text: '清除后，AI 重新出片时可能改写你之前手动修改过的标题、旁白、音色、时长等内容。当前画面不会马上改变。此操作无法撤回。', ok: '全部清除', danger: true })
    if (!ok) return
    await op('清除全部人工改动保护', async () => {
      const d = await PK.postP('project/scene-overrides/batch', { clear: true })
      env.L.edits = null
      PK.toast(`已清除 ${(d && d.cleared && d.cleared.length) || 0} 幕的人工改动保护`, 'info')
    })
  }

  PK.studioStep('scenes', { label: '分镜精修', en: 'SCENES', icon: 'film', order: 30, render: renderScenes })

  /* ================================================================ 交付 · delivery step */
  function initDelivery(s) {
    const L = s.local
    const dir = PK.dir()
    if (L.dir !== dir) {
      L.dir = dir
      L.formats = DELIVERY_FORMATS.map((f) => f.value)
      L.lut = ''
      L.lutApply = ''
      L.lutIntensity = 1
      L.scopesAt = ''
      L.scopes = null
      L.exportRes = null
      L.lutRes = null
      L.qa = null
      L.deepQa = null
      L.showSnap = false
      L.player = null
      L.motion = null
      L.mediaBump = 0
    }
  }
  async function loadLuts(ctx) {
    if (LUT_CACHE) return LUT_CACHE
    LUT_CACHE = { loading: true, luts: [] }
    try {
      const d = await PK.get('color-lut')
      LUT_CACHE = { luts: Array.isArray(d.luts) ? d.luts : [] }
    } catch (err) {
      LUT_CACHE = { luts: [], error: String(err.message || err) }
    }
    ctx.update()
    return LUT_CACHE
  }
  function scenesScope(ctx) {
    return ctx.local['s:scenes'] || null
  }
  async function renderMp4(ctx, s, draft) {
    const SL = scenesScope(ctx)
    if (SL && isDirty(SL)) {
      const ok = await PK.confirm({ title: '先保存分镜修改？', text: `「分镜精修」里还有 ${dirtySummary(SL).count} 处修改没保存。渲染会使用已保存的工程，要先保存这些修改吗？`, ok: '保存并渲染', cancel: '取消' })
      if (!ok) return
      try {
        await saveDraft(SL, { silent: true })
      } catch (err) {
        PK.reportError(err, '保存失败')
        return
      }
    }
    const L = s.local
    const engine = (s.script && s.script.engine) || (PK.state && PK.state.director && PK.state.director.engine) || 'remotion'
    await op(
      draft ? '快速渲染 720P 审片视频' : '渲染成品 MP4 并运行音画质检',
      async (job) => {
        const init = await PK.postP('action', { async: true, action: 'render', engine, draft720p: Boolean(draft) })
        const res = await followJob(job, init)
        L.mediaBump = (L.mediaBump || 0) + 1
        L.qa = null
        if (SL) SL.mediaBump = (SL.mediaBump || 0) + 1
        const r = (res && res.result) || {}
        const vm = r.qaReport && r.qaReport.videoMeta
        PK.toast(`${draft ? '审片视频' : '成品 MP4'} 已导出并完成质检${vm && vm.width ? `（${vm.width}×${vm.height} · ${num(vm.durationSec).toFixed(1)} 秒${r.fileSizeBytes ? ` · ${U.fmtBytes(r.fileSizeBytes)}` : ''}）` : ''}`, 'success')
      },
      { fail: '渲染失败' },
    )
  }
  function qaOf(s, L) {
    const a = s.project && s.project.qaReport
    const b = L.qa
    if (a && b) return String(b.checkedAt || '') >= String(a.checkedAt || '') ? b : a
    return b || a || null
  }
  function checkRow(ck) {
    const tone = ck.severity === 'skipped' ? 'mute' : ck.severity === 'warning' ? 'warn' : ck.passed ? 'ok' : 'err'
    return h(
      'div.pk-dl-check',
      { class: `is-${tone}` },
      h('span.pk-dl-check-i', null, PK.icon(tone === 'ok' ? 'check' : tone === 'err' ? 'x' : tone === 'warn' ? 'warn' : 'info', 14)),
      h('div.pk-dl-check-b', null, h('b', null, ck.name || '检查项'), ck.value ? h('span', null, String(ck.value)) : null),
    )
  }
  function playerFor(L, url, poster) {
    let p = L.player
    if (!p || p.url !== url) {
      if (p && p.el) {
        try {
          p.el.pause()
        } catch {}
      }
      const v = h('video', { src: url, controls: 'controls', preload: 'metadata', playsinline: '' })
      p = L.player = { url, el: v }
    }
    if (poster) p.el.poster = poster
    return p.el
  }
  function renderDelivery(ctx, s) {
    ensureStudio(ctx)
    initDelivery(s)
    const L = s.local
    const ap = s.project || {}
    const sc = s.script || {}
    const busy = busyNow()
    const hasMp4 = Boolean(ap.hasMp4)
    const W = num(sc.width) || num(PK.state && PK.state.project && PK.state.project.width) || 1920
    const H = num(sc.height) || num(PK.state && PK.state.project && PK.state.project.height) || 1080
    const fps = fpsOf(sc)
    const qa = s.project && (s.project.qaReport || L.qa) ? qaOf(s, L) : L.qa
    const SL = scenesScope(ctx)
    const ver = hash(`${(ap.qaReport && ap.qaReport.checkedAt) || ''}|${L.mediaBump || 0}|${hasMp4}`)
    const mp4 = hasMp4 ? fileUrl('output/final.mp4', ver) : ''
    const title = String(sc.displayTitle || sc.title || (PK.state && PK.state.project && PK.state.project.title) || 'final')
    if (!LUT_CACHE) loadLuts(ctx)
    const luts = (LUT_CACHE && LUT_CACHE.luts) || []
    const quality = String(sc.quality || '1080p').toUpperCase()
    ctx.foot([
      ui.btn('分镜精修', () => s.go('scenes'), { kind: 'ghost', icon: 'chevL' }),
      SL && isDirty(SL) ? ui.pill(`分镜还有 ${dirtySummary(SL).count} 处修改未保存`, 'warn', { dot: true }) : null,
      ui.spacer(),
      ui.btn('版本历史', () => PK.open('history'), { icon: 'history', kind: 'ghost' }),
      ui.btn('发布资料包', () => PK.open('export'), { icon: 'box', kind: hasMp4 ? 'primary' : 'secondary' }),
    ])
    const playerW = `min(100%, calc(min(56vh, 560px) * ${W} / ${H}))`
    const player = hasMp4
      ? h('div.pk-dl-player', { style: { width: playerW, aspectRatio: `${W} / ${H}` } }, playerFor(L, mp4, ap.sceneThumbs && Object.values(ap.sceneThumbs)[0] ? fileUrl(Object.values(ap.sceneThumbs)[0], ver) : ''))
      : h('div.pk-dl-noplayer', null, PK.icon('film', 28), h('b', null, '还没有成片'), h('span', null, '点下方「渲染成品 MP4」，渲染完成后就能在这里观看和下载。'))
    const checks = qa && Array.isArray(qa.checks) ? qa.checks : []
    const failed = checks.filter((c) => !c.passed && c.severity !== 'skipped')
    const build = ap.buildLog
    const snapUrl = ap.hasSnapshot ? fileUrl('output/snapshot-3x3.png', ver) : ''
    const playerSec = ui.section(
      { title: '成片播放', en: 'FINAL CUT', icon: 'film', actions: [ui.pill(`${W}×${H} · ${fps}fps`, 'acc'), hasMp4 && qa && qa.videoMeta ? ui.pill(`${num(qa.videoMeta.durationSec).toFixed(1)} 秒`, 'mute') : null] },
      player,
      h(
        'div.pk-sc-rowbtns',
        null,
        ui.btn('720P 快速审片', () => renderMp4(ctx, s, true), {
          icon: 'bolt',
          disabled: busy,
          // both engines render the draft scaled down (Remotion via its `scale` option, separate draft cache)
          title: '先快速出一版 720P 低清预览，确认节奏和画面（比成品快，不会覆盖成品的渲染缓存）',
        }),
        ui.btn(`渲染成品 MP4（${quality}）`, () => renderMp4(ctx, s, false), { kind: 'primary', icon: 'film', disabled: busy, title: '渲染全高清成品，并自动做音画质检' }),
        hasMp4 && typeof PK.cinema === 'function'
          ? ui.btn(
              '全屏观看',
              () => {
                const v = L.player && L.player.el
                const at = v ? v.currentTime || 0 : 0
                try {
                  if (v) v.pause()
                } catch {}
                PK.cinema({
                  src: mp4,
                  poster: v && v.poster ? v.poster : '',
                  title,
                  sub: `${W}×${H} · ${fps}fps`,
                  startAt: at,
                  onClose: ({ time }) => {
                    const pv = L.player && L.player.el
                    if (pv && pv.isConnected)
                      try {
                        pv.currentTime = time
                      } catch {}
                  },
                })
              },
              { icon: 'expand', title: '铺满整个窗口播放成片，再按 F 进入真正的全屏' },
            )
          : null,
        hasMp4 ? linkBtn('下载成片', mp4, { icon: 'download', download: `${title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'final'}.mp4` }) : null,
        hasMp4 ? ui.btn('一键生成发布资料包', () => PK.open('export'), { icon: 'box' }) : null,
        hasMp4 ? ui.btn('投稿到影核广场', () => PK.open('plaza', { view: 'submit' }), { icon: 'hub', kind: 'ghost', title: '把这条作品打成投稿包发给作者，审核收录后大家都能在影核广场套用' }) : null,
      ),
      ui.hint('渲染需要几分钟，期间可以关掉这个窗口去做别的事，完成后会自动提示。'),
    )
    // the buttons live in the body (not the header) so the section title is never squeezed into "成品音画体…"
    const qaBtns = [
      ui.btn('重新检测', () => runQa(ctx, s), { size: 'sm', icon: 'retry', disabled: busy || !hasMp4, title: hasMp4 ? '重新跑一遍黑屏 / 响度 / 音画同步等检查' : '需要先渲染成片' }),
      ui.btn('深度质检', () => runDeepQa(ctx, s), { size: 'sm', icon: 'scope', disabled: busy || !hasMp4, title: '额外检查冻帧、闪黑、音画漂移与渲染确定性（较慢）' }),
    ]
    const qaSec = ui.section(
      { title: '成品音画体检单', en: 'QA REPORT', icon: 'check' },
      checks.length
        ? [
            ui.row([qa.passed ? ui.pill('全部达标', 'ok', { dot: true }) : ui.pill(`${failed.length} 项需要注意`, 'warn', { dot: true }), qa.deep ? ui.pill('含深度质检', 'acc') : null, qa.checkedAt ? ui.hint(`检测于 ${U.fmtTime(qa.checkedAt)}`) : null, ui.spacer(), ...qaBtns]),
            h('div.pk-dl-checks', null, checks.map(checkRow)),
          ]
        : [ui.hint('渲染成片后会自动检查：全片无黑屏、人声响度达标（-14 LUFS）、音画完全对齐及广播色彩规格。'), ui.row(qaBtns)],
      L.deepQa ? ui.note(L.deepQa.passed === false ? `深度质检未通过（${(L.deepQa.checks || []).filter((c) => !c.passed).length} 项问题，见上方体检单）` : `深度质检通过（${(L.deepQa.checks || []).length} 项）`, { level: L.deepQa.passed === false ? 'warn' : 'ok' }) : null,
      build
        ? h('div.pk-sc-kv', null, h('b', null, '编译日志'), h('span', null, build.model || '本地引擎'), h('b', null, '自动修复'), h('span', null, `${num(build.repairRoundsUsed)} 轮`), h('b', null, '生成源码'), h('span', null, `${(build.generatedFiles && build.generatedFiles.length) || 0} 个文件`))
        : null,
      snapUrl
        ? [
            ui.btn(L.showSnap ? '收起九宫格关键帧检查图' : '展开九宫格关键帧检查图', () => ((L.showSnap = !L.showSnap), ctx.render()), { size: 'sm', kind: 'ghost', icon: 'grid', block: true }),
            L.showSnap ? h('img.pk-dl-snap', { src: snapUrl, alt: '九宫格关键帧检查图', onClick: () => PK.open('scLightbox', { src: snapUrl, kind: 'image', title: '九宫格关键帧检查图' }) }) : null,
          ]
        : null,
    )
    const exportRes = L.exportRes
    const links = exportRes
      ? Object.entries(exportRes.urls || {})
          .flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : Object.entries(v || {}).map(([k2, v2]) => [`${k} · ${k2}`, v2])))
          .filter(([, v]) => typeof v === 'string' && v)
      : []
    const exportSec = ui.section(
      { title: '专业交付包', en: 'DELIVERY PACKAGE', icon: 'box', desc: '一键导出字幕、分轨音频与可导入 Final Cut Pro / Premiere / DaVinci 的剪辑时间线，文件保存在工程的 output/export/ 目录。' },
      ui.field({ label: '导出格式', en: 'FORMATS' }, ui.chips({ multi: true, value: L.formats, options: DELIVERY_FORMATS, onChange: (v) => ((L.formats = v), ctx.render()) })),
      ui.field({ label: '调色（可选）', en: 'LUT' }, ui.select({ value: L.lut, options: [{ value: '', label: '不调色（原片）' }, ...luts.map((l) => ({ value: l.id, label: l.label, hint: l.description || '' }))], showHint: true, onChange: (v) => ((L.lut = v), ctx.render()) })),
      ui.btn('导出交付包', () => runExport(ctx, s), { kind: 'primary', icon: 'download', disabled: !hasMp4 || busy || !L.formats.length, title: !hasMp4 ? '需要先渲染成片' : '' }),
      !hasMp4 ? ui.hint('提示：剪辑时间线、分轨与调色需要先渲染成片 MP4。') : null,
      exportRes
        ? h(
            'div.pk-stack',
            null,
            ui.note(`已导出 ${(exportRes.formats || []).length} 种格式${exportRes.subtitleCues ? ` · 字幕 ${exportRes.subtitleCues} 条` : ''}`, { level: 'ok' }),
            h('div.pk-dl-links', null, links.map(([k, v]) => h('a', { href: v, download: '', title: v }, PK.icon('download', 13), h('span', null, k)))),
            (exportRes.warnings || []).map((w) => ui.note(String(w), { level: 'warn' })),
          )
        : null,
    )
    const scopes = L.scopes
    const totalSec = num(sc.totalDurationSec)
    const scopeSec = ui.section(
      { title: '示波器与深度质检', en: 'SCOPES', icon: 'scope' },
      ui.row(
        [
          ui.input({ key: 'dl-scope-t', type: 'number', min: 0, step: 0.5, value: L.scopesAt, placeholder: totalSec ? `分析时间点（秒，默认片中 ${(Math.round(totalSec * 5) / 10).toFixed(1)}）` : '分析时间点（秒，默认片中）', aria: '分析时间点（秒）', onInput: (v) => (L.scopesAt = v) }),
          ui.btn('生成示波器', () => runScopes(ctx, s), { icon: 'scope', disabled: !hasMp4 || busy }),
          ui.btn('深度质检', () => runDeepQa(ctx, s), { kind: 'primary', disabled: !hasMp4 || busy }),
        ],
        { wrap: true },
      ),
      scopes && scopes.urls
        ? h(
            'div.pk-dl-figs',
            null,
            Object.entries(scopes.urls)
              .filter(([, v]) => typeof v === 'string' && v)
              .map(([k, v]) => h('figure.pk-dl-fig', { onClick: () => PK.open('scLightbox', { src: v, kind: 'image', title: SCOPE_LABELS[k] || k, caption: `分析时间点 ${num(scopes.timeSec).toFixed(2)} 秒` }) }, h('img', { src: v, alt: SCOPE_LABELS[k] || k, loading: 'lazy' }), h('figcaption', null, SCOPE_LABELS[k] || k))),
          )
        : ui.hint('示波器帮助检查画面曝光与色彩是否符合广播规范；深度质检会额外检查冻帧、闪黑、音画漂移与渲染确定性。'),
      L.deepQa ? ui.hint(L.deepQa.passed === false ? `深度质检：${(L.deepQa.checks || []).filter((c) => !c.passed).length} 项问题（详见左侧体检单）` : `深度质检：通过（${(L.deepQa.checks || []).length} 项）`) : null,
    )
    const lutRes = L.lutRes
    const lutSec = ui.section(
      { title: '调色预览', en: 'COLOR LUT', icon: 'lut', desc: '给成片套一个电影调色风格，生成一份调色版（原片不会被覆盖）。' },
      ui.field({ label: '调色风格', en: 'LOOK' }, ui.select({ value: L.lutApply, placeholder: luts.length ? '选择一种调色风格' : '正在读取调色风格…', options: luts.map((l) => ({ value: l.id, label: l.label, hint: l.description || '' })), showHint: true, onChange: (v) => ((L.lutApply = v), ctx.render()) })),
      ui.field({ label: '强度', en: 'INTENSITY' }, ui.slider({ value: L.lutIntensity, min: 0.1, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onChange: (v) => (L.lutIntensity = v) })),
      ui.btn('生成调色版', () => runLut(ctx, s), { icon: 'lut', disabled: !hasMp4 || busy || !L.lutApply, title: !hasMp4 ? '需要先渲染成片' : !L.lutApply ? '先选择调色风格' : '' }),
      LUT_CACHE && LUT_CACHE.error ? ui.note(`调色风格读取失败：${LUT_CACHE.error}`, { level: 'error' }) : null,
      lutRes && lutRes.url
        ? h(
            'div.pk-stack',
            null,
            h('div.pk-dl-player', { style: { width: `min(100%, calc(min(40vh, 360px) * ${W} / ${H}))`, aspectRatio: `${W} / ${H}` } }, h('video', { src: lutRes.url, controls: 'controls', preload: 'metadata', playsinline: '' })),
            ui.row([linkBtn('下载调色版', lutRes.url, { icon: 'download', size: 'sm' }), ui.hint(U.baseName(lutRes.outputPath || ''))]),
          )
        : null,
    )
    const moreSec = ui.section(
      { title: '更多导出与工具', en: 'MORE', icon: 'more' },
      ui.list([
        ui.item({ icon: 'box', title: '发布资料包', sub: '高清封面、推荐标题、标签与合规说明，一键打包', onClick: () => PK.open('export') }),
        ui.item({ icon: 'history', title: '版本历史', sub: '对比、恢复任意历史版本（每次 AI 修改前都会自动备份）', onClick: () => PK.open('history') }),
        ui.item({ icon: 'code', title: '查看工程源码', sub: 'AI 生成的画面代码、剧本与质检报告（只读）', onClick: () => PK.open('code') }),
        ui.item({ icon: 'layers', title: '导出 MOTION.md 分镜蓝图', sub: '可跨智能体复用的分镜 / 动效说明文档', onClick: () => runMotionMd(ctx, s) }),
      ]),
      L.motion
        ? ui.note(`已导出：${L.motion.relPath || 'MOTION.md'}`, {
            level: 'ok',
            actions: [
              ui.btn('查看内容', () => PK.open('code', { file: L.motion.relPath || 'MOTION.md', content: L.motion.content || '' }), { size: 'sm', icon: 'eye' }),
              linkBtn('下载', fileUrl(L.motion.relPath || 'MOTION.md', hash(L.motion.at || '')), { size: 'sm', icon: 'download', download: 'MOTION.md' }),
            ],
          })
        : null,
    )
    return h(
      'div.pk-dl',
      null,
      jobBar(),
      isLiveRun() ? ui.note('AI 正在出片中：完成后成片会自动出现在这里。', { level: 'info' }) : null,
      ui.split(playerSec, qaSec, { ratio: 'minmax(0, 1.25fr) minmax(0, 1fr)' }),
      ui.split(exportSec, scopeSec),
      ui.split(lutSec, moreSec),
    )
  }
  async function runQa(ctx, s) {
    await op('音画质检', async () => {
      const d = await PK.postP('qa', {})
      s.local.qa = d.qa || null
      const passed = d.qa && d.qa.passed
      PK.toast(passed ? '全部音画质检项目均达标' : '质检已完成，请查看体检单里的建议', passed ? 'success' : 'info')
    }, { message: '正在运行 FFmpeg 黑屏检测与 -14 LUFS 响度校验…' })
  }
  async function runDeepQa(ctx, s) {
    await op('深度质检', async () => {
      const d = await PK.postP('qa-deep', {})
      s.local.deepQa = d.qa || null
      if (d.qa) s.local.qa = d.qa
      PK.toast(d.qa && d.qa.passed === false ? '深度质检发现问题，请查看体检单' : '深度质检通过', d.qa && d.qa.passed === false ? 'info' : 'success')
    }, { message: '正在执行深度质检（黑场 / 冻帧 / 响度 / 音画对齐 / 确定性）…' })
    ctx.update()
  }
  async function runScopes(ctx, s) {
    const L = s.local
    const total = num(s.script && s.script.totalDurationSec)
    const t = num(L.scopesAt) > 0 ? num(L.scopesAt) : total > 0 ? Math.round(total * 5) / 10 : 0
    await op('生成示波器', async () => {
      const d = await PK.postP('scopes', { timeSec: t })
      L.scopes = { ...d, timeSec: t }
      if (!(num(L.scopesAt) > 0) && t > 0) L.scopesAt = t
    })
    ctx.update()
  }
  async function runExport(ctx, s) {
    const L = s.local
    if (!L.formats.length) {
      PK.toast('请至少勾选一种导出格式', 'warn')
      return
    }
    await op('导出专业交付包', async () => {
      const d = await PK.postP('export', { formats: L.formats, stemsEnabled: L.formats.includes('stems'), lut: L.lut || '' })
      L.exportRes = d
      PK.toast(`专业交付包已导出到 output/export/（${(d.formats || []).join(' · ')}）`, 'success')
    }, { message: '正在导出专业交付包（字幕 / 分轨 / 剪辑时间线）…' })
  }
  async function runLut(ctx, s) {
    const L = s.local
    if (!L.lutApply) return
    await op('生成调色版', async () => {
      const d = await PK.postP('color-lut', { lut: L.lutApply, intensity: num(L.lutIntensity, 1) })
      L.lutRes = d
      PK.toast('调色版已生成（原片未改动）', 'success')
    }, { message: '正在用 FFmpeg 套用 3D LUT 调色…' })
  }
  async function runMotionMd(ctx, s) {
    await op('导出 MOTION.md', async () => {
      const d = await PK.postP('motion-md', {})
      s.local.motion = { ...d, at: Date.now() }
      PK.toast(`已导出可跨智能体复用的分镜蓝图：${d.relPath || 'MOTION.md'}`, 'success')
    })
  }

  PK.studioStep('delivery', { label: '交付', en: 'DELIVERY', icon: 'box', order: 40, render: renderDelivery })

  /* ================================================================ 工程源码检视 (code viewer) */
  async function loadCode(ctx) {
    ctx.local.err = null
    try {
      const d = await PK.get('code', { projectDir: PK.needProject() })
      ctx.local.files = Array.isArray(d.files) ? d.files : []
      ctx.local.history = Array.isArray(d.history) ? d.history : []
    } catch (err) {
      ctx.local.err = err
    }
    ctx.update()
  }
  PK.panel('code', {
    title: '工程源码检视',
    en: 'SOURCE CODE · 只读查看',
    idx: 'SRC',
    icon: 'code',
    kind: 'modal',
    size: 'xl',
    group: 'hidden',
    needsProject: true,
    fill: true,
    aliases: { source: {}, codeDrawer: {} },
    mount(ctx) {
      ctx.local.q = ''
      ctx.local.sel = ''
      if (ctx.args && ctx.args.content !== undefined) {
        ctx.local.files = [{ path: String(ctx.args.file || '文档'), size: String(ctx.args.content).length, content: String(ctx.args.content) }]
        ctx.local.history = []
        ctx.local.single = true
      } else loadCode(ctx)
    },
    onArgs(ctx, a) {
      if (a && a.content !== undefined) {
        ctx.local.files = [{ path: String(a.file || '文档'), size: String(a.content).length, content: String(a.content) }]
        ctx.local.single = true
        ctx.local.sel = ''
      } else if (ctx.local.single) {
        ctx.local.single = false
        ctx.local.files = null
        loadCode(ctx)
      }
      ctx.render()
    },
    render(ctx) {
      const L = ctx.local
      if (L.err) return h('div', { style: { padding: '18px' } }, ui.errorBox(L.err, () => loadCode(ctx)))
      if (!L.files) return h('div', { style: { padding: '18px', minHeight: '240px' } }, ui.loading('正在读取工程源码…'))
      const q = String(L.q || '').trim().toLowerCase()
      const files = q ? L.files.filter((f) => String(f.path).toLowerCase().includes(q)) : L.files
      const cur = L.files.find((f) => f.path === L.sel) || files[0] || null
      ctx.foot([
        ui.hint(L.single ? '只读预览' : `共 ${L.files.length} 个文件 · 只读${L.history && L.history.length ? ` · ${L.history.length} 个可撤回版本` : ''}`),
        ui.spacer(),
        cur ? ui.btn('复制当前文件', async () => PK.toast((await U.copyText(cur.content || '')) ? '已复制到剪贴板' : '复制失败，请手动选择复制', 'info'), { icon: 'copy' }) : null,
        L.single ? null : ui.btn('刷新', () => ((L.files = null), ctx.render(), loadCode(ctx)), { icon: 'refresh', kind: 'ghost' }),
        ui.btn('关闭', () => ctx.close(), { kind: 'primary' }),
      ])
      if (!L.files.length) return h('div', { style: { padding: '18px' } }, ui.empty({ icon: 'code', title: '暂无源码文件', text: '生成分镜或渲染成片后，这里会列出 AI 生成的画面代码与剧本文件。' }))
      return h(
        'div.pk-fill',
        null,
        h(
          'div.pk-codev',
          { style: { flex: '1 1 auto' } },
          h(
            'div.pk-codev-files',
            { 'data-pk-scroll': 'code-files' },
            L.files.length > 8 ? ui.input({ key: 'code-q', type: 'search', value: L.q, placeholder: '筛选文件名…', onInput: (v) => ((L.q = v), ctx.update()) }) : null,
            files.map((f) => h('button.pk-codev-f', { type: 'button', class: { 'is-on': cur && f.path === cur.path }, title: f.path, onClick: () => ((L.sel = f.path), ctx.render()) }, h('span', null, f.path), h('small', null, U.fmtBytes(num(f.size) * 1)))),
            q && !files.length ? ui.hint('没有匹配的文件') : null,
          ),
          h(
            'div.pk-codev-main',
            null,
            cur ? h('div.pk-codev-h', null, PK.icon('code', 14), h('b', null, cur.path), ui.pill(`${U.countChars(cur.content || '')} 字符`, 'mute'), num(cur.size) > 80000 ? ui.pill('超长文件，只显示前 8 万字符', 'warn') : null) : null,
            cur ? h('pre.pk-code', { 'data-pk-scroll': `code-${cur.path}` }, h('code', null, String(cur.content || ''))) : null,
          ),
        ),
      )
    },
  })

  /* ================================================================ 大图 / 视频预览 (lightbox) */
  PK.panel('scLightbox', {
    title: '预览',
    en: 'PREVIEW',
    icon: 'eye',
    kind: 'modal',
    size: 'xl',
    group: 'hidden',
    onArgs(ctx) {
      ctx.render()
    },
    render(ctx) {
      const a = ctx.args || {}
      ctx.setTitle(a.title || '预览', a.en || 'PREVIEW')
      ctx.foot([ui.spacer(), a.src ? linkBtn('下载', a.src, { icon: 'download', kind: 'ghost' }) : null, ui.btn('关闭', () => ctx.close(), { kind: 'primary' })])
      if (!a.src) return ui.empty({ icon: 'image', title: '没有可预览的内容' })
      return h('div.pk-lb', null, a.kind === 'video' ? h('video', { src: a.src, controls: 'controls', autoplay: '', playsinline: '' }) : h('img', { src: a.src, alt: a.title || '' }), a.caption ? h('p', null, a.caption) : null)
    },
  })

  installGuard()
})()
