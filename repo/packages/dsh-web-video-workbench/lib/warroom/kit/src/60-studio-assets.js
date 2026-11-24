/* ============================================================================================================
 * PK · 60 — 分步精修 steps 「素材」(assets) and 「导演参数」(director)                         owner: panel agent A
 * Behaviour ported from the deleted classic UI (step1Panel / step2Panel + their handlers): every option of the
 * classic UI lives here, composed from kit primitives so each skin restyles it. Backend only via the bridge helpers.
 * Related native panels (other owners): 提词器拍摄棚 → `teleprompter`, 数字人合成 / 引擎 → `avatar`, 配音中心 → `voices`,
 * 云端媒体 → `cloud`, 参考复刻 → `reference`, 设置 → `keys`, 任务中心 → `tasks`.
 * ============================================================================================================ */
;(function () {
  'use strict'
  const PK = window.PK
  if (!PK || typeof PK.studioStep !== 'function') return
  const U = PK.util
  const h = PK.h
  const ui = PK.ui

  /* ---------------------------------------------------------------- constants */
  const ROLE_OPTIONS = [
    { value: 'visual', label: '画面素材', hint: '用在分镜画面里（默认）' },
    { value: 'music', label: 'BGM 配乐', hint: '设为背景音乐，自动测量节拍' },
    { value: 'host_video', label: '真人出镜视频', hint: '口播 / 采访原片，可沿用原声' },
    { value: 'avatar_base', label: '数字人底板', hint: '合成克隆数字人用的本人视频或照片' },
    { value: 'voice_clone', label: '声音克隆样本', hint: '克隆音色用的 10~30 秒清晰人声' },
    { value: 'sfx', label: '转场音效', hint: '切镜时的短音效' },
  ]
  const ROLE_LABEL = { visual: '画面素材', music: 'BGM 配乐', host_video: '真人出镜视频', avatar_base: '数字人底板', voice_clone: '声音克隆样本', sfx: '转场音效', brand_mark: '品牌 Logo' }
  const VISUAL_ROLES = new Set(['', 'general', 'hero', 'broll', 'image', 'video', 'footage', 'visual'])
  const SPECIAL_ROLES = new Set(['host_video', 'avatar_base', 'voice_clone'])
  const KIND_CN = { image: '图片', video: '视频', audio: '音频', text: '文本' }
  const ACCEPT = {
    any: 'image/*,video/*,audio/*,.txt,.md',
    bgm: 'audio/*,.mp3,.wav,.flac,.m4a,.ogg,.aac',
    host_video: 'video/*,.mp4,.mov,.webm,.mkv,.avi,.m4v',
    avatar_base: 'video/*,image/*,.mp4,.mov,.webm,.png,.jpg,.jpeg,.webp',
    voice_clone: 'audio/*,.mp3,.wav,.flac,.m4a,.ogg',
  }
  // quick-start briefs of the classic war room (topic + style + aspect)
  const INSPIRATIONS = [
    { label: '架构与代码动画', style: 'tech', aspect: '16:9', topic: '制作一条 35 秒 Opus 5.5 级 Vibecoding 技术大片：融合 Three.js 3D 星环/赛博网格舞台、动态 SVG 系统架构拓扑总线、全息 HUD 遥测代码面板与节拍同步弹簧物理 (spring/interpolate)，硬核拆解 AI 多智能体协同架构。' },
    { label: 'AI 产品震撼发布', style: 'tech', aspect: '16:9', topic: '制作一条 30 秒电影级产品发布短片：节奏先慢后燃，用高对比霓虹视觉、震撼数字计数动效与强鼓点转场，讲透我们的 AI 新品如何让普通人 3 分钟出大片。' },
    { label: '爆款口播干货教程', style: 'energetic', aspect: '9:16', topic: '制作一条 35 秒竖屏高完播干货口播短片：前 3 秒抛出反常识金句，配合大字高亮动画与重点卡片弹出，分享普通人一定要知道的三个高效创作秘诀。' },
    { label: '品牌温情故事短片', style: 'warm', aspect: '16:9', topic: '制作一条 30 秒温暖电影感品牌故事短片：采用柔和琥珀光影与舒缓钢琴弦乐铺底，讲述团队从灵感萌芽到打磨出第一件作品的真实历程。' },
    { label: '深度洞察与行业拆解', style: 'documentary', aspect: '16:9', topic: '制作一条 35 秒极简纪实风格行业洞察视频：用清晰的图表对比动效、章节导航条与沉稳权威旁白，客观拆解今年行业变革与核心机会点。' },
  ]
  // backend genre router profiles (packages/dsh-tool-media/genre-router.js): [id, label, pacing hint]
  const GENRES = [
    ['code-animation', '代码动画 / Vibecoding 科技演示', '3~6 秒/镜，信息密度高'],
    ['ui-tutorial', '软件实操教程 / 产品使用演示', '每个操作一个镜头，清晰不拖沓'],
    ['stickman-story', '火柴人 / 角色故事动画', '随剧情起伏，动作镜头短'],
    ['history-theater', '历史剧场 / 史诗卡点动画', '高燃卡点，高潮处连切'],
    ['talking-head', '真人口播 / 访谈包装', '口播为主线，6~10 秒一次视觉强调'],
    ['digital-human', '数字人口播 / 虚拟主播', '稳健解说 4~6 秒/镜'],
    ['product-promo', '产品宣发 / 发布会短片', '3 秒钩子，卖点 3~5 秒/镜'],
    ['science-explainer', '科普讲解 / 概念可视化', '一镜一概念，4~7 秒'],
    ['data-story', '数据故事 / 信息图', '一镜一结论，4~6 秒'],
    ['brand-story', '品牌故事 / 情感短片', '4~7 秒/镜，从容留白'],
    ['mv-lyric', '音乐卡点 / 歌词 MV', '随节拍半拍 / 一拍切镜'],
    ['other', '自由创作（任意其他题材）', '按内容自由设计'],
  ]
  const HINTS = {
    engine: { remotion: 'React 动画 + Three.js 3D，画面最精致（推荐）', html: 'HTML5 网页动画 + Three.js，渲染更快、兼容性更好' },
    mode: { 'ai-coded': '大模型为每一幕手写动效代码，效果最好（需要先配置大模型）', 'fast-draft': '零配置本地快速出片，不调用大模型、不花钱' },
    aspect: { auto: '依据主题自动判断', '16:9': 'B站 / YouTube / 大屏', '9:16': '抖音 / 快手 / 视频号', '3:4': '图文笔记 · 首图不裁切', '1:1': '信息流 / 动态卡片', '4:3': '课件 / 访谈叙事', custom: '手动输入宽高像素' },
    quality: { '720p': '快速渲染 · 审片演练', '1080p': '主流平台发布标准', '2k': '细节更锐利 · 渲染稍慢', '4k': '极致画质 · 耗时较长', custom: '自由输入宽高像素' },
    pacing: { auto: '自动区分教程 / 故事 / 快闪', calm: '适合品牌故事、温情纪实', balanced: '适合产品功能、软件演示', dynamic: '适合历史史诗、音乐 MV' },
    fx: {
      auto: '每一镜由 AI 按画面需要挑工具，做不到的效果直接写代码实现',
      on: '仍由 AI 自由创作，合适的镜头多用 Three.js 3D 空间与全息 HUD',
      off: '不用 3D 舞台和全屏 HUD；SVG、Canvas、文字与图表动效照常自由编写',
    },
    badge: { 'top-right': '避开左上角的主标题', 'top-left': '传统角标位置', 'bottom-right': '贴底安全区展示', 'bottom-left': '左下安全区展示' },
    narration: { tts: 'AI 真人音色逐幕配音解说（标准）', 'tts-beat-sync': '配音的同时，切镜对齐背景音乐的重拍', 'subtitle-mv': '纯音乐卡点 MV：不配音，只有字幕和音效' },
    bgm: { 'llm-coded': '大模型写代码合成原创配乐（需要先配置大模型）', uploaded: '用你上传的音乐，自动测量节拍', 'tts-engine': '用配音引擎生成沉浸式氛围音景' },
    layout: { 'pip-br': '画面右下角小窗出镜', 'pip-bl': '画面左下角小窗出镜', fullscreen: '数字人占满全屏口播' },
  }
  const o2 = (pairs) => pairs.map(([value, label, hint]) => ({ value, label, hint: hint || '' }))
  // used only when the host did not send an option list (older host builds)
  const FALLBACK = {
    engines: o2([['remotion', 'Remotion + Three.js 3D'], ['html', 'HTML5 + Three.js']]),
    creationModes: o2([['ai-coded', '大模型编码大片'], ['fast-draft', '本地极速草稿']]),
    aspectRatios: o2([['auto', 'AI 智能判断'], ['16:9', '16:9 横屏'], ['9:16', '9:16 竖屏'], ['3:4', '3:4 竖版 · 小红书'], ['1:1', '1:1 方屏'], ['4:3', '4:3 复古']]),
    qualities: o2([['720p', '720P 极速预览'], ['1080p', '1080P 全高清'], ['2k', '2K 超清'], ['4k', '4K 超清母带']]),
    narrationModes: o2([['tts', 'AI 真人配音'], ['tts-beat-sync', '配音 + 踩拍切镜'], ['subtitle-mv', '纯音乐卡点 MV（免配音）']]),
    bgmModes: o2([['llm-coded', 'AI 写代码作曲'], ['uploaded', '使用已上传 BGM'], ['tts-engine', 'TTS 氛围音景']]),
    pacingModes: o2([['auto', 'AI 自动节奏'], ['calm', '舒缓叙事 (4~7s/镜)'], ['balanced', '稳健解说 (3~5s/镜)'], ['dynamic', '高燃踩点 (0.5~3s/镜)']]),
    avatarLayouts: o2([['pip-br', '右下画中画'], ['pip-bl', '左下画中画'], ['fullscreen', '全屏口播']]),
    avatarModes: o2([['ai-human', 'AI 虚拟主播'], ['cloned-human', '克隆真人（上传 / 录制本人）']]),
    platforms: o2([['universal', '通用全平台', '标准 5% 安全边距'], ['douyin', '抖音 / 视频号', '避让右侧点赞与底部字幕区'], ['bilibili', 'B站 / YouTube', '横屏片头与弹幕防遮挡'], ['xiaohongshu', '小红书图文视频', '底部文案与首图防裁切']]),
    aiBadgePositions: o2([['top-right', '右上角（推荐）'], ['top-left', '左上角'], ['bottom-right', '右下角'], ['bottom-left', '左下角']]),
    visual3dModes: o2([['auto', 'AI 按需自由创作（推荐）'], ['on', '偏好 3D 与全息 HUD 科技感'], ['off', '偏好纯 2D 平面动效']]),
    figureStyles: o2([
      ['auto', 'AI 按作品气质决定（推荐）', '历史题材默认剪影，其它题材由 AI 自己定；需求里写明的画风照样有效'],
      ['silhouette', '剪影', '逆光黑色轮廓加金边轮廓光，适合历史、史诗、战争'],
      ['papercut', '剪纸', '红纸镂空的窗花质感，适合民俗、节日'],
      ['puppet', '皮影', '半透明彩色皮影，带关节铆钉和操纵杆，适合戏曲、传说'],
      ['ink', '水墨', '墨色晕染，适合古诗词、山水'],
      ['flat', '扁平插画', '彩色扁平侧身人物，适合生活、产品、科普'],
      ['stick', '火柴人', '线条小人，适合搞笑段子、教程、简笔故事'],
      ['custom', '自定义（AI 自己设计角色）', 'Q版、动漫、绘本、像素等人物库没有的画风，在下面写清楚想要的样子'],
    ]),
    styleCards: [
      { value: 'auto', label: 'AI 自由匹配', hint: 'AI 按主题从这些风格里挑选，都不合适时自创新风格', swatch: 'linear-gradient(135deg, #7C5CFF, #22D3EE 55%, #F5B942)', kind: 'auto' },
      { value: 'emerald', label: '墨翠轻奢', hint: '深翠墨底 · 柔金光影', swatch: '#45D1B2' },
      { value: 'tech', label: '科技锋芒', hint: '几何光线 · 精密节奏', swatch: '#22D3EE' },
      { value: 'cinematic', label: '电影大片', hint: '黄金比例 · 光影叙事', swatch: '#F5B942' },
      { value: 'documentary', label: '极简纪实', hint: '克制留白 · 权威旁白', swatch: '#94A3B8' },
      { value: 'energetic', label: '活力潮牌', hint: '快切节拍 · 高能撞色', swatch: '#FB7185' },
      { value: 'warm', label: '温暖故事', hint: '柔光琥珀 · 人文温度', swatch: '#FB923C' },
    ],
  }
  const DURATION_PRESETS = [[30, '30 秒'], [60, '1 分钟'], [90, '90 秒'], [120, '2 分钟'], [180, '3 分钟'], [300, '5 分钟']]
  const FPS_LIST = [24, 25, 30, 50, 60]
  const SIZE_PRESETS = [[1080, 1920, '竖屏 1080×1920'], [1920, 1080, '横屏 1920×1080'], [1080, 1440, '3:4 1080×1440'], [1080, 1080, '方屏 1080×1080'], [1440, 1080, '4:3 1440×1080'], [3840, 2160, '4K 3840×2160']]
  const CHROMA = [['', '不抠像'], ['#00FF00', '绿幕'], ['#0000FF', '蓝幕']]
  const GENDER_CN = { male: '男声', female: '女声', neutral: '中性' }
  const AGE_CN = { child: '童声', youth: '青年', adult: '成年', 'middle-aged': '中年', elderly: '老年' }

  /* ---------------------------------------------------------------- module state (outlives one studio window) */
  const REF = { ctx: null, go: null, s: null } // latest studio ctx + step navigator (job completion jumps to 分镜 / 交付)
  const OPS = { n: 0 } // imports in flight → mirror the host's per-file upload progress into the busy strip
  const FLASH = { ids: new Set(), until: 0 } // assets just added (host `asset-added` event) → highlighted cards
  const JOB = { cur: null } // background production job (plan / produce / ai-produce); keeps running when the studio closes
  // director saves in flight (until the host echoed them): production buttons wait for these first, because the host
  // starts a run / plan from its OWN form — a request sent right after an edit would otherwise use the old settings
  const PENDING = new Set()
  const hold = () => {
    const tok = {}
    PENDING.add(tok)
    return () => PENDING.delete(tok)
  }

  /* ---------------------------------------------------------------- small helpers */
  const st = () => PK.state || {}
  const D = () => st().director || {}
  const RO = () => st().runOptions || {}
  const AV = () => st().avatar || {}
  const OP = (name) => {
    const l = st().options && st().options[name]
    return Array.isArray(l) && l.length ? l : FALLBACK[name] || []
  }
  const runLive = (s0) => {
    const r = (s0 || st()).run
    return Boolean(r && (r.status === 'queued' || r.status === 'running' || r.status === 'paused'))
  }
  const llmReady = () => Boolean(st().status && st().status.llm && st().status.llm.configured)
  const llmLabel = () => String((st().status && st().status.llm && st().status.llm.label) || '')
  const ttsInfo = () => (st().status && st().status.tts) || { ready: false, label: '配音引擎' }
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
  const eq = (a, b) => U.deepEqual(a, b)
  const clampInt = (v, lo, hi, d) => {
    const n = Math.round(Number(v))
    return v === '' || v === null || v === undefined || !Number.isFinite(n) ? d : U.clamp(n, lo, hi)
  }
  const cnDur = (sec) => {
    sec = Math.max(0, Math.round(U.num(sec)))
    const m = Math.floor(sec / 60)
    const r = sec % 60
    return m ? (r ? `${m} 分 ${r} 秒` : `${m} 分钟`) : `${sec} 秒`
  }
  const secShort = (v) => {
    const n = U.num(v)
    return n >= 10 ? `${Math.round(n)} 秒` : `${n.toFixed(1)} 秒`
  }
  const withHints = (list, map) => (list || []).map((o) => ({ ...o, hint: o.hint || (map && map[o.value]) || '' }))
  // the host already toasted the real reason for these generic action failures (its handler notified, then failed)
  const quiet = (err) => Boolean(err && /请查看提示|^(移除素材失败|确认入库失败|丢弃失败)$/.test(String(err.message || '')))
  const report = (err, prefix) => {
    if (!quiet(err)) PK.reportError(err, prefix)
  }
  const guard = (fn) => Promise.resolve().then(fn).catch((err) => report(err))
  /** host action; resolves false (instead of throwing a second toast) when the host already explained the failure */
  async function act(name, payload, opts) {
    try {
      await PK.action(name, payload, opts)
      return true
    } catch (err) {
      if (quiet(err)) return false
      throw err
    }
  }
  /** an IME composition (拼音 etc.) is running in the focused field — never save or rebuild the form under it */
  const composingIn = (W) => Boolean(W && W.composing && W.compEl && W.compEl.isConnected && document.activeElement === W.compEl)
  const needLlm = (msg) => {
    PK.emit('need-llm', { error: msg })
    return undefined
  }
  const assetName = (a) => String((a && (a.originalName || a.name || a.id)) || '')
  const roleOf = (a) => (VISUAL_ROLES.has(String((a && a.role) || '')) ? 'visual' : String(a.role))
  const roleOptions = (cur) => (ROLE_OPTIONS.some((r) => r.value === cur) ? ROLE_OPTIONS : [...ROLE_OPTIONS, { value: cur, label: ROLE_LABEL[cur] || `其他（${cur}）`, hint: '当前用途' }])
  const firstLine = (t) => U.trimText(String(t || '').split(/\r?\n/).find((x) => x.trim()) || '（空白）', 80)
  const parseSources = (raw) => {
    const list = String(raw || '')
      .split(/\r?\n+/)
      .map((x) => x.trim().replace(/^"(.*)"$/, '$1').trim())
      .filter(Boolean)
    return list.length ? (list.length > 1 ? list : list[0]) : undefined
  }
  /** debounce that can flush / cancel the pending call */
  function saver(fn, ms) {
    let t = 0
    let args = null
    const d = (...a) => {
      args = a
      clearTimeout(t)
      t = setTimeout(() => {
        const x = args
        args = null
        if (x) fn(...x)
      }, ms)
    }
    d.flush = () => {
      clearTimeout(t)
      const x = args
      args = null
      return x ? fn(...x) : undefined
    }
    d.cancel = () => {
      clearTimeout(t)
      args = null
    }
    return d
  }
  /**
   * Commit a field's pending draft on blur even when the browser fires no `change`: when the step re-rendered while the
   * user was editing, the focused field is a NEW element that started with the draft value, so leaving it is not a
   * "change" for the browser. `dirty()` says whether a draft is pending, `commit(el)` saves it.
   */
  function commitOnBlur(el, dirty, commit) {
    el.addEventListener('focus', () => {
      el.__a60done = false
    })
    el.addEventListener('change', () => {
      el.__a60done = true
    })
    el.addEventListener('blur', () => {
      if (!el.__a60done && dirty()) commit(el)
      el.__a60done = false
    })
    return el
  }
  /** number input with optional prefix / unit labels (structural inline width only); o.dirty() → draft pending */
  function numInput(o) {
    const inp = ui.input({
      key: o.key,
      type: 'number',
      value: o.value,
      min: o.min,
      max: o.max,
      step: o.step,
      aria: o.aria,
      onInput: o.onInput,
      onChange: o.onCommit,
      onEnter: () => inp.blur(),
    })
    if (o.dirty) commitOnBlur(inp, o.dirty, (el) => o.onCommit(el.value === '' ? '' : Number(el.value)))
    inp.style.width = o.width || '96px'
    inp.style.flex = 'none'
    if (!o.pre && !o.unit) return inp
    return ui.row([o.pre ? h('span.pk-hint', null, o.pre) : null, inp, o.unit ? h('span.pk-hint', null, o.unit) : null], { wrap: false, gap: 6 })
  }
  const grow = (el, basis = '220px') => {
    el.style.flex = `1 1 ${basis}`
    el.style.width = 'auto'
    el.style.minWidth = '0'
    return el
  }
  /** descriptions must stay fully readable: let an item's sub line wrap (its title keeps the ellipsis + tooltip) */
  const wrapSub = (el) => {
    const sub = el.querySelector('.pk-item-s')
    if (sub) {
      sub.style.whiteSpace = 'normal'
      sub.style.overflowWrap = 'anywhere'
      sub.style.textOverflow = 'clip'
    }
    return el
  }
  /** two controls side by side (stacks when the step is narrow) — a 2-item ui.grid would leave empty tracks */
  const pair = (a, b, ratio) => ui.split(a, b, { ratio: ratio || 'minmax(0, 1fr) minmax(0, 1fr)' })
  /** single-line value shown in a wrapping textarea (title, label…): Enter confirms like an input instead of adding a line break */
  const enterCommits = (wrap) => {
    const ta = wrap.textarea || wrap
    ta.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return // Enter that picks an IME candidate
      ev.preventDefault()
      ta.blur() // → change / commitOnBlur saves it
    })
    return wrap
  }

  /* ---------------------------------------------------------------- per-step scope, re-render policy */
  function scope(s) {
    const L = s.local
    const dir = PK.dir()
    if (L.__dir !== dir) {
      if (L.savers) for (const sv of Object.values(L.savers)) sv.cancel()
      L.__dir = dir
      L.drafts = {}
      L.opt = {}
      L.savers = {}
      L.finishers = {}
      L.bgmPreview = ''
      L.unpolished = ''
      L.pathDraft = ''
      L.chromaCustom = false
    }
    return L
  }
  /** narrow fingerprint of the host state a step shows — a re-render only happens when it changes */
  function signature(ctx) {
    const s0 = st()
    const step = ctx.local.step
    if (step === 'assets') {
      return JSON.stringify(['a', (s0.staging || []).map((x) => x.id), (s0.assets || []).map((a) => [a.id, (a.usedBySceneIds || []).length]), AV().sourcePath, AV().voiceSamplePath, s0.projectFlags && s0.projectFlags.hasReferenceVideo])
    }
    if (step === 'director') {
      const stt = s0.status || {}
      return JSON.stringify(['d', s0.director, s0.runOptions, s0.avatar, stt.llm, stt.tts, ((s0.options || {}).voices || []).length, runLive(s0)])
    }
    return String(step)
  }
  function typingNow(ctx, W) {
    if (document.querySelector('#pk-root .pk-pop.is-open')) return true
    const a = document.activeElement
    if (!a || !ctx.frame.el.contains(a) || a.readOnly) return false
    const field = a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|range|color|button|submit|file)$/i.test(a.type || ''))
    return field && (composingIn(W) || Date.now() - W.lastKey < 1200)
  }
  /** one listener set per studio window: state echo, job progress, new assets, IME guard, drag & drop */
  function hook(ctx, s) {
    REF.ctx = ctx
    REF.go = s.go
    REF.s = s
    let W = ctx.local.__a60
    if (W) return W
    W = ctx.local.__a60 = { sig: '', pending: false, timer: 0, composing: false, compEl: null, lastKey: 0, over: 0 }
    const mine = () => ctx.local.step === 'assets' || ctx.local.step === 'director'
    // a mouse button held down in the studio (click in progress, slider drag): a rebuild in between would swallow the
    // click / break the drag. (5 s cap: a release outside this window must not block re-renders for good.)
    const pressed = () => Boolean(W.downAt && Date.now() - W.downAt < 5000)
    W.request = () => {
      clearTimeout(W.timer)
      if (ctx.frame.closed) return
      if (!mine()) {
        W.pending = false
        return
      }
      // never rebuild the form under the user's fingers (IME composition / caret / pressed button) or under an open picker
      if (typingNow(ctx, W) || pressed()) {
        W.pending = true
        W.timer = setTimeout(W.request, pressed() ? 150 : 700)
        return
      }
      W.pending = false
      ctx.update()
    }
    ctx.listen('state', (s1, prev) => {
      if (!mine()) return
      if (OPS.n > 0 && st().busy) ctx.busy(st().busy)
      // a data refresh (rev bump) makes the studio reload /state and re-render this step anyway: rendering now as well
      // would rebuild every card twice (first with stale library data) and widen the window in which a click is lost
      if (s1 && prev && s1.rev !== prev.rev) return
      if (signature(ctx) !== W.sig) W.request()
    })
    ctx.frame.el.addEventListener('pointerdown', () => {
      W.downAt = Date.now()
    }, true)
    const released = () => {
      if (!W.downAt) return
      W.downAt = 0
      if (W.pending) setTimeout(W.request, 120)
    }
    window.addEventListener('pointerup', released, true)
    window.addEventListener('pointercancel', released, true)
    ctx.onCleanup(() => {
      window.removeEventListener('pointerup', released, true)
      window.removeEventListener('pointercancel', released, true)
    })
    ctx.listen('a60:job', (j, phase) => {
      if (!mine()) return
      if (phase === 'progress' && patchJobDom(ctx)) return
      W.request()
    })
    ctx.every(1000, () => {
      if (JOB.cur && JOB.cur.status === 'running' && ctx.local.step === 'director') patchJobDom(ctx)
    })
    ctx.listen('event:asset-added', (d) => {
      FLASH.ids = new Set(((d && d.assetIds) || []).map(String))
      FLASH.until = Date.now() + 8000
      if (ctx.local.step === 'assets') W.request()
    })
    const body = ctx.frame.body
    // (the composing field is remembered: if it gets replaced mid-composition, its compositionend never reaches us —
    // composingIn() then stops counting it instead of blocking re-renders and saves forever)
    body.addEventListener('compositionstart', (ev) => {
      W.composing = true
      W.compEl = ev.target
    })
    body.addEventListener('compositionend', () => {
      W.composing = false
      W.compEl = null
      if (W.pending) setTimeout(W.request, 60)
    })
    body.addEventListener('keydown', () => {
      W.lastKey = Date.now()
    }, true)
    body.addEventListener('focusout', () => {
      if (W.pending) setTimeout(W.request, 80)
    })
    // Drag & drop files or whole folders anywhere in my steps (素材 highlights its drop zone). File drags never reach
    // the skin while one of my steps is shown: some skins import window-level drops themselves (→ a second import of
    // the same files) and without a handler the browser would open the dropped file in place of the war room.
    // On the other studio steps only the browser default (navigation) is prevented; the skin may still take the drop.
    const isFiles = (ev) => Boolean(ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files'))
    const zone = () => (ctx.local['s:assets'] || {}).zoneEl
    body.addEventListener('dragenter', (ev) => {
      if (!isFiles(ev) || !mine()) return
      ev.stopPropagation()
      if (ctx.local.step !== 'assets') return
      W.over++
      const z = zone()
      if (z) z.classList.add('is-over')
    })
    body.addEventListener('dragover', (ev) => {
      if (!isFiles(ev)) return
      ev.preventDefault()
      if (!mine()) return
      ev.stopPropagation()
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = PK.hasProject() ? 'copy' : 'none'
    })
    body.addEventListener('dragleave', (ev) => {
      if (!isFiles(ev) || !mine()) return
      ev.stopPropagation()
      if (ctx.local.step !== 'assets') return
      W.over = Math.max(0, W.over - 1)
      const z = zone()
      if (!W.over && z) z.classList.remove('is-over')
    })
    body.addEventListener('drop', (ev) => {
      if (!isFiles(ev)) return
      ev.preventDefault()
      if (!mine()) return
      ev.stopPropagation()
      W.over = 0
      const z = zone()
      if (z) z.classList.remove('is-over')
      const pending = filesFromDrop(ev.dataTransfer) // reads the DataTransfer synchronously, resolves later
      guard(async () => importFiles(ctx, await pending, ''))
    })
    ctx.onCleanup(() => {
      clearTimeout(W.timer)
      for (const key of ['s:assets', 's:director']) {
        const sc = ctx.local[key]
        if (sc && sc.savers && sc.__dir === PK.dir()) for (const sv of Object.values(sc.savers)) sv.flush()
      }
      if (REF.ctx === ctx) {
        REF.ctx = null
        REF.go = null
        REF.s = null
      }
    })
    return W
  }
  const refresh = (ctx) => (ctx.local.__a60 ? ctx.local.__a60.request() : ctx.update())

  /* ---------------------------------------------------------------- director patches: optimistic values + text drafts */
  function shown(L, key, stateVal) {
    const o = L.opt[key]
    if (!o) return stateVal
    if (eq(o.v, stateVal) || Date.now() - o.t > 4000) {
      delete L.opt[key]
      return stateVal
    }
    return o.v
  }
  /** send one patch, keep the picked value on screen until the host echoes it (or show the host's value if it refused) */
  async function commit(ctx, L, key, value, send, read) {
    const done = hold()
    L.opt[key] = { v: value, t: Date.now() }
    try {
      try {
        await send()
      } catch (err) {
        delete L.opt[key]
        refresh(ctx)
        report(err, '保存失败')
        return false
      }
      const ok = await PK.waitState((s0) => eq(read(s0 || {}), value), 2500)
      if (!ok) {
        delete L.opt[key]
        refresh(ctx)
      }
      return ok
    } finally {
      done()
    }
  }
  const setD = (ctx, L, key, value, patch) => commit(ctx, L, key, value, () => PK.action('setDirector', { patch: patch || { [key]: value } }), (s0) => (s0.director || {})[key])
  const setR = (ctx, L, key, value) => commit(ctx, L, `ro:${key}`, value, () => PK.action('setDirector', { patch: { [key]: value } }), (s0) => (s0.runOptions || {})[key])
  const setA = (ctx, L, key, value) => commit(ctx, L, `av:${key}`, value, () => PK.action('setAvatar', { patch: { [key]: value } }), (s0) => (s0.avatar || {})[key])
  const dv = (L, key) => shown(L, key, D()[key])
  const rv = (L, key) => shown(L, `ro:${key}`, RO()[key])
  const av = (L, key) => shown(L, `av:${key}`, AV()[key])
  /**
   * Free-text director field: the draft in L.drafts wins while the user edits; saved debounced (600 ms) while typing and
   * immediately on change/blur; the draft is dropped once the host echoed the value.
   */
  function bindText(ctx, L, key, stateVal, o = {}) {
    const toPatch = o.toPatch || ((v) => ({ [key]: v }))
    const read = o.read || ((s0) => (s0.director || {})[key])
    const norm = o.norm || ((v) => String(v ?? ''))
    const send = (v) => PK.action('setDirector', { patch: toPatch(v) })
    const sv =
      L.savers[key] ||
      (L.savers[key] = saver((v) => {
        // mid-composition the field still holds raw 拼音 letters: wait for the composed text (the saver re-arms itself)
        if (composingIn(ctx.local.__a60)) return L.savers[key](has(L.drafts, key) ? L.drafts[key] : v)
        return send(v).catch((err) => report(err, '保存失败'))
      }, o.ms || 600))
    const finish = async (v) => {
      const done = hold()
      try {
        L.drafts[key] = v
        sv.cancel()
        try {
          await send(v)
        } catch (err) {
          report(err, '保存失败')
          return
        }
        await PK.waitState((s0) => norm(read(s0 || {})) === norm(v), 1500)
        if (L.drafts[key] === v) {
          delete L.drafts[key]
          refresh(ctx)
        }
      } finally {
        done()
      }
    }
    ;(L.finishers || (L.finishers = {}))[key] = finish // settle() commits a pending draft through it
    return {
      value: has(L.drafts, key) ? L.drafts[key] : stateVal,
      onInput: (v) => {
        L.drafts[key] = v
        sv(v)
      },
      onChange: finish,
      /** attach to the created ui.textarea: also finishes the draft on blur when no `change` fires (see commitOnBlur) */
      wire: (wrap) => {
        commitOnBlur(wrap.textarea || wrap, () => has(L.drafts, key), (el) => finish(el.value))
        return wrap
      },
    }
  }
  /**
   * Before a production / curate / compose request: commit the field being edited and every pending draft, then wait
   * (≤ 5 s) until the host echoed all director saves in flight — the host builds those requests from its own form.
   */
  async function settle(ctx) {
    const L = ctx && ctx.local && ctx.local['s:director']
    const a = document.activeElement
    if (a && ctx && ctx.frame && ctx.frame.el.contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && !a.readOnly) a.blur() // its change / commitOnBlur saves it
    if (L && L.__dir === PK.dir()) {
      if (L.savers && L.savers.chroma) L.savers.chroma.flush()
      for (const [k, fin] of Object.entries(L.finishers || {})) if (has(L.drafts, k)) fin(L.drafts[k])
    }
    await U.sleep(0) // commits queued by the blur start in a microtask
    const t0 = Date.now()
    while (PENDING.size && Date.now() - t0 < 5000) await U.sleep(50)
  }

  /* ---------------------------------------------------------------- import helpers */
  function boundNotes(ab) {
    const out = []
    if (!ab || typeof ab !== 'object') return out
    if (ab.bgm) out.push(`已自动设为背景音乐「${ab.bgm.name || ''}」${ab.bgm.bpm ? ` · ${ab.bgm.bpm} BPM` : ''}${ab.bgm.dropsCount ? ` · ${ab.bgm.dropsCount} 个高潮点` : ''}`)
    if (ab.avatarBase && ab.avatarBase.path) out.push(`已绑定为数字人底板「${ab.avatarBase.name || ''}」`)
    if (ab.voiceClone && ab.voiceClone.path) out.push(`已绑定为声音克隆样本「${ab.voiceClone.name || ''}」`)
    if (ab.hostVideo && ab.hostVideo.path) out.push(`已启用真人出镜原声「${ab.hostVideo.name || ''}」`)
    return out
  }
  const supported = (f) => Boolean(f && f.size > 0 && U.kindOfFile(f.name, f.type) !== 'other')
  /** give files from a folder a unique flat name ("folder_sub_a.png") so same-named files never collide */
  const renamed = (f, rel) => {
    const name = String(rel || f.name)
      .replace(/^[\\/]+/, '')
      .replace(/[\\/]+/g, '_')
    if (!name || name === f.name) return f
    try {
      return new File([f], name, { type: f.type, lastModified: f.lastModified })
    } catch {
      return f
    }
  }
  /** files of a drop, including whole folders (webkitGetAsEntry); DataTransfer is read synchronously */
  async function filesFromDrop(dt) {
    const items = dt && dt.items ? Array.from(dt.items) : []
    const entries = items.map((it) => (it.kind === 'file' && typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null))
    const plain = items.map((it) => (it.kind === 'file' && typeof it.getAsFile === 'function' ? it.getAsFile() : null))
    if (!entries.some((e) => e && e.isDirectory)) return Array.from((dt && dt.files) || []).length ? Array.from(dt.files) : plain.filter(Boolean)
    const out = []
    const walk = async (entry, prefix) => {
      if (!entry) return
      if (entry.isFile) {
        const f = await new Promise((res) => entry.file(res, () => res(null)))
        if (f) out.push(prefix ? renamed(f, `${prefix}${f.name}`) : f)
      } else if (entry.isDirectory) {
        const reader = entry.createReader()
        for (;;) {
          const batch = await new Promise((res) => reader.readEntries(res, () => res([])))
          if (!batch.length) break
          for (const e of batch) await walk(e, `${prefix}${entry.name}_`)
        }
      }
    }
    for (let i = 0; i < entries.length; i++) {
      if (entries[i]) await walk(entries[i], '')
      else if (plain[i]) out.push(plain[i])
    }
    return out
  }
  /** import through the host (keeps its auto-binding), in batches so a big folder never sits in memory at once */
  async function importFiles(ctx, files, role) {
    PK.needProject()
    const all = Array.from(files || []).filter(Boolean)
    if (!all.length) return 0
    const ok = all.filter(supported)
    const skipped = all.length - ok.length
    if (!ok.length) throw new PK.Error(`选中的 ${skipped} 个文件都不是支持的素材格式。支持：图片 JPG / PNG / WEBP、视频 MP4 / MOV / WEBM、音频 MP3 / WAV / FLAC / M4A、文本 TXT / MD`)
    const batches = []
    let cur = []
    let size = 0
    for (const f of ok) {
      if (cur.length && (cur.length >= 20 || size + f.size > 384 * 1048576)) {
        batches.push(cur)
        cur = []
        size = 0
      }
      cur.push(f)
      size += f.size
    }
    if (cur.length) batches.push(cur)
    let count = 0
    OPS.n++
    try {
      await ctx.task(`正在导入 ${ok.length} 个素材…`, async () => {
        for (let i = 0; i < batches.length; i++) {
          if (batches.length > 1) ctx.busy(`正在导入素材：第 ${i + 1} / ${batches.length} 批（共 ${ok.length} 个文件）…`)
          try {
            count += await PK.importFiles(batches[i], { role: role || '' })
          } catch (err) {
            if (!quiet(err)) throw err
          }
        }
      }, { fail: '导入素材失败' })
    } finally {
      OPS.n--
    }
    if (skipped) PK.toast(`已跳过 ${skipped} 个不支持的文件（只导入图片、视频、音频和 TXT / MD 文本）`, 'info')
    if (count) {
      const L = ctx.local['s:assets']
      if (L) L.filter = 'all'
    }
    return count
  }
  /**
   * OS file picker that never loses a selection. (PK.pickFiles gives up 600 ms after the window regains focus, so a
   * `change` that arrives later — e.g. while the browser enumerates a big folder — would be dropped silently.)
   * Resolves on `change` or on the dialog's `cancel` event; browsers without `cancel` fall back to "nothing picked"
   * 3 s after focus returns, and a selection that still arrives after that is handed to `late(files)`.
   */
  function pickFilesSafe(o, late) {
    return new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept: o.accept || null, multiple: Boolean(o.multiple), tabindex: '-1', 'aria-hidden': 'true', style: 'position:fixed;left:-9999px;top:0' })
      if (o.directory) inp.setAttribute('webkitdirectory', '')
      let settled = false
      const done = (files) => {
        if (!settled) {
          settled = true
          resolve(files)
        } else if (files.length && late) late(files)
      }
      inp.addEventListener('change', () => {
        done(Array.from(inp.files || []))
        inp.remove()
      })
      inp.addEventListener('cancel', () => {
        done([])
        inp.remove()
      })
      window.addEventListener('focus', () => setTimeout(() => done([]), 3000), { once: true })
      setTimeout(() => inp.remove(), 30 * 60 * 1000) // an abandoned picker never lingers
      document.body.appendChild(inp)
      inp.click()
    })
  }
  async function pickAndImport(ctx, kind) {
    PK.needProject()
    const run = (files) => {
      if (kind === 'bgm') return files[0] ? uploadBgm(ctx, files[0]) : undefined
      if (kind === 'folder') return importFiles(ctx, files.map((f) => (f.webkitRelativePath ? renamed(f, f.webkitRelativePath) : f)), '')
      return importFiles(ctx, files, kind === 'any' ? '' : kind)
    }
    const opts = kind === 'bgm' ? { accept: ACCEPT.bgm } : kind === 'folder' ? { directory: true, multiple: true } : { accept: ACCEPT[kind] || ACCEPT.any, multiple: true }
    const files = await pickFilesSafe(opts, (lateFiles) => guard(() => run(lateFiles)))
    if (files.length) await run(files)
  }
  async function uploadBgm(ctx, file) {
    const dir = PK.needProject()
    if (U.kindOfFile(file.name, file.type) !== 'audio') throw new PK.Error(`「${file.name}」不是音频文件。背景音乐支持 MP3 / WAV / FLAC / M4A / OGG / AAC`)
    await ctx.task(`正在导入配乐「${file.name}」并测量节拍…`, async () => {
      const d = await PK.upload('bgm/upload', file, { query: { projectDir: dir, fileName: file.name } })
      await PK.action('setDirector', { patch: { bgmMode: 'uploaded' } })
      const b = (d && d.beatAnalysis) || null
      const nm = (d && d.asset && (d.asset.originalName || d.asset.name)) || file.name
      PK.toast(`已绑定背景音乐「${nm}」${b && b.bpm ? ` · ${b.bpm} BPM` : ''}${b && b.dropsCount ? ` · ${b.dropsCount} 个高潮点` : ''}（人声出现时会自动压低配乐）`, 'success')
    }, { fail: '导入配乐失败' })
  }
  async function importByPath(ctx, L) {
    const src = parseSources(L.pathDraft)
    if (!src) throw new PK.Error('请先粘贴电脑上的文件夹或文件完整路径（例如 D:\\素材\\咖啡馆），再点「扫描导入」')
    await ctx.task('正在扫描本机素材目录并检测规格…', async () => {
      let d
      try {
        d = await PK.postP('assets/import', { sources: src, role: L.pathRole || '' }, { timeout: 1800000 })
      } catch (err) {
        throw new PK.Error(`扫描导入失败：${err.message}。请确认这个路径存在，并且填的是完整路径（例如 D:\\素材\\咖啡馆）`, { code: err.code })
      }
      L.pathDraft = ''
      L.filter = 'all'
      const notes = boundNotes(d && d.autoBound)
      const n = U.num(d && (d.importedCount ?? d.matchedCount ?? d.addedCount), 0)
      PK.toast(n ? `已识别导入 ${n} 份本地素材${notes.length ? ` · ${notes[0]}` : ''}` : '这个路径里没有找到支持的图片 / 视频 / 音频 / 文本文件', n ? 'success' : 'warn')
    })
  }
  async function starterPack(ctx) {
    PK.needProject()
    await ctx.task('正在生成新手体验包（3 张高清概念图 + 电影级配乐）…', async () => {
      const d = await PK.postP('assets/starter-pack', {}, { timeout: 300000 })
      if (!String(D().topic || '').trim()) {
        const tpl = INSPIRATIONS[0]
        await PK.action('setDirector', { patch: { topic: tpl.topic, style: tpl.style } }).catch(() => {})
      }
      PK.toast(`已装载 ${U.num(d && d.addedCount, 0) || 4} 份演示素材与配乐！直接点「一键出片」就能体验`, 'success')
    }, { fail: '生成演示素材失败' })
  }
  async function curate(ctx) {
    PK.needProject()
    await settle(ctx) // crop / grade with the ratio, quality and trim the user just picked
    const d = D()
    const r = RO()
    const a = AV()
    await ctx.task('素材剪辑 Agent 正在用 FFmpeg 智能构图裁切与调色…', async () => {
      const res = await PK.postP(
        'assets/curate',
        { aspectRatio: d.aspectRatio || 'auto', quality: d.quality || '1080p', style: d.style || 'tech', trimSeconds: U.num(r.trimClipSec, 0), clipSpeed: U.num(r.clipSpeedMult, 1) || 1, chromaKeyColor: a.chromaKeyColor || '' },
        { timeout: 1800000 },
      )
      PK.toast(`已完成 ${U.num(res && res.editedCount, 0)} 份素材精修（保存在工程的 assets/edited/ 文件夹，原素材不变）`, 'success')
    }, { fail: '素材智能精修失败' })
  }
  async function changeRole(ctx, a, role) {
    if (roleOf(a) === role) return
    await ctx.task('正在更新素材用途…', async () => {
      const d = await PK.postP('assets/role', { assetId: a.id, role })
      a.role = role
      const notes = boundNotes(d && d.autoBound)
      PK.toast(notes[0] || `「${assetName(a)}」的用途已改为「${ROLE_LABEL[role] || role}」`, 'success')
    }, { fail: '修改素材用途失败' })
  }
  async function removeAssetFlow(a) {
    const ok = await PK.confirm({
      title: '从素材库移除？',
      text: `将从素材库移除「${assetName(a)}」。工程文件夹里的原文件会保留，已经生成的分镜暂时不受影响；之后重新出片时，AI 只会从素材库里挑选素材。`,
      ok: '移除',
      danger: true,
    })
    if (!ok) return false
    return act('removeAsset', { assetId: a.id })
  }
  async function discardStaging(it) {
    const ok = await PK.confirm({ title: '丢弃这个云端结果？', text: `丢弃「${it.name || '云端生成结果'}」后无法找回；想要类似效果需要重新生成（可能再次产生费用）。`, ok: '丢弃', danger: true })
    if (!ok) return false
    return act('discardStaging', { stagingId: it.id })
  }
  /**
   * 全部丢弃: one host `discardStaging` per item (the host updates its staging list in place). The bulk
   * `cloud-media/staging/discard {clearAll}` route makes the host bump its media version before it re-reads the list,
   * so the skin re-requests thumbnails of files that were just deleted (404 noise in the console).
   */
  async function discardAllStaging(ctx, list) {
    const n = list.length
    const ok = await PK.confirm({ title: `丢弃全部 ${n} 个云端结果？`, text: '暂存区里的所有云端生成结果都会被清空，无法找回；想要类似效果需要重新生成（可能再次产生费用）。', ok: '全部丢弃', danger: true })
    if (!ok) return
    await ctx.task(`正在丢弃 ${n} 个云端结果…`, async () => {
      for (let i = 0; i < n; i++) {
        if (n > 1) ctx.busy(`正在丢弃云端结果 ${i + 1} / ${n}…`)
        try {
          if (!(await act('discardStaging', { stagingId: list[i].id }))) return // the host toasted why; stop here
        } catch (err) {
          if (!/已不存在/.test(String(err && err.message))) throw err
        }
      }
    }, { fail: '丢弃云端结果失败' })
  }
  function openStaging(it) {
    const f = PK.frame({ kind: 'modal', size: 'lg', title: it.name || '云端生成结果', en: 'CLOUD RESULT · 云端生成结果预览', icon: 'cloud' })
    const media =
      it.kind === 'video' ? ui.video(it.url, { aspect: '16/9' }) : it.kind === 'image' ? ui.image(it.thumbUrl || it.url, { aspect: '16/9' }) : ui.audio(it.url)
    if (media.classList.contains('pk-media')) media.style.maxHeight = '52vh'
    PK.append(f.body, [
      media,
      ui.kv([
        ['类型', KIND_CN[it.kind] || '素材'],
        ['来源', it.provider || '云端模型'],
      ]),
      it.prompt ? ui.field({ label: '提示词', en: 'PROMPT' }, ui.textarea({ value: it.prompt, readOnly: true, rows: 2, minRows: 2, maxRows: 12, expand: false, aria: '提示词（只读）' })) : null,
      ui.hint('满意就「确认入库」（图片 / 视频进入素材库，配乐会自动设为背景音乐）；不满意就丢弃。'),
    ])
    f.setFoot([
      ui.btn('丢弃', async () => {
        if (await discardStaging(it)) f.close('discarded')
      }, { kind: 'ghost', icon: 'trash', busyText: '丢弃中…' }),
      ui.spacer(),
      ui.btn('关闭', () => f.close('ok'), { kind: 'ghost' }),
      ui.btn('确认入库', async () => {
        if (await act('confirmStaging', { stagingId: it.id })) f.close('confirmed')
      }, { kind: 'primary', icon: 'check', busyText: '入库中…' }),
    ])
  }

  /* ---------------------------------------------------------------- modals: preview / note / vendor motion */
  function openPreview(ctx, a) {
    const name = assetName(a)
    const f = PK.frame({ kind: 'modal', size: 'lg', title: name, en: 'ASSET PREVIEW · 素材预览', icon: 'eye' })
    let edited = false
    const used = usedCounts().get(String(a.id)) || 0
    const paint = () => {
      PK.clear(f.body)
      const rel = edited && a.editedPath ? a.editedPath : a.path
      const url = PK.assetUrl(rel)
      const ratio = U.num(a.width) > 0 && U.num(a.height) > 0 ? `${a.width}/${a.height}` : '16/9'
      let media
      if (a.type === 'image') media = ui.image(url, { aspect: ratio, alt: name })
      else if (a.type === 'video') media = ui.video(PK.assetUrl(edited && a.editedPath ? a.editedPath : a.webPath || a.path), { poster: a.thumb ? PK.assetUrl(a.thumb) : '', aspect: ratio })
      else media = ui.audio(url)
      if (media.classList.contains('pk-media')) media.style.maxHeight = '56vh'
      const role = roleOf(a)
      PK.append(f.body, [
        media,
        a.editedPath && a.type !== 'audio'
          ? ui.seg({ value: edited ? 'e' : 'o', options: [{ value: 'o', label: '原素材' }, { value: 'e', label: 'AI 精修版' }], onChange: (v) => {
              edited = v === 'e'
              paint()
            } })
          : null,
        ui.kv([
          ['类型', KIND_CN[a.type] || '素材'],
          ['用途', ROLE_LABEL[role] || role],
          U.num(a.width) > 0 ? ['尺寸', `${a.width} × ${a.height}`] : null,
          U.num(a.durationSec) > 0 && a.type !== 'image' ? ['时长', secShort(a.durationSec)] : null,
          U.num(a.sizeBytes) > 0 ? ['大小', U.fmtBytes(a.sizeBytes)] : null,
          used ? ['已用于', `${used} 个分镜`] : null,
          ['文件', String(a.path || '')],
          a.editedPath ? ['精修版', String(a.editedPath)] : null,
        ]),
        ui.field(
          { label: '用途', en: 'ROLE', hint: '改成「BGM 配乐 / 数字人底板 / 声音克隆样本」会自动绑定到出片设置。' },
          ui.select({ value: role, options: roleOptions(role), showHint: true, searchable: false, menuTitle: '这个素材用来做什么？', onChange: (r) => guard(async () => {
            await changeRole(ctx, a, r)
            paint()
          }) }),
        ),
      ])
    }
    paint()
    f.setFoot([
      ui.btn('从素材库移除', async () => {
        if (await removeAssetFlow(a)) f.close('removed')
      }, { kind: 'danger', icon: 'trash', busyText: '移除中…' }),
      ui.spacer(),
      ui.btn('关闭', () => f.close('ok'), { kind: 'ghost' }),
    ])
  }
  function openNote(n) {
    const f = PK.frame({ kind: 'modal', size: 'md', title: n.name || '文本笔记', en: 'NOTE · 文本笔记（只读）', icon: 'list' })
    PK.append(f.body, ui.textarea({ value: String(n.text || ''), readOnly: true, rows: 8, maxRows: 24, expand: false, counter: true, aria: '文本笔记内容' }))
    f.setFoot([
      ui.spacer(),
      ui.btn('复制全文', async () => {
        if (await U.copyText(String(n.text || ''))) PK.toast('已复制到剪贴板', 'success')
      }, { icon: 'copy' }),
      ui.btn('关闭', () => f.close('ok'), { kind: 'primary' }),
    ])
  }
  function openClip(clip) {
    const f = PK.frame({ kind: 'modal', size: 'md', title: '透明数字人贴片', en: 'AVATAR CLIP', icon: 'user' })
    PK.append(f.body, [ui.video(PK.assetUrl(clip.path), { autoplay: true, loop: true, muted: false, aspect: '9/16' }), ui.hint('这是带透明通道的口播贴片，出片时会叠加在画面上。重新合成或更换引擎请到「数字人」面板。')])
    const v = f.body.querySelector('.pk-media')
    if (v) v.style.maxHeight = '60vh'
    f.setFoot([ui.btn('打开数字人面板', () => {
      f.close('ok')
      PK.open('avatar')
    }, { icon: 'user' }), ui.spacer(), ui.btn('关闭', () => f.close('ok'), { kind: 'primary' })])
  }
  function openVendor() {
    const form = { sourceDir: '', name: '', durationSec: 6 }
    const f = PK.frame({ kind: 'modal', size: 'md', title: '第三方动效包导入', en: 'VENDOR MOTION · .motion / HTML → 无声视频贴片', icon: 'box' })
    const submit = async () => {
      const dir = PK.needProject()
      const src = String(form.sourceDir || '').trim().replace(/^"(.*)"$/, '$1').trim()
      if (!src) throw new PK.Error('请填写动效模板所在文件夹的完整路径（文件夹里要有 index.html）')
      const dur = clampInt(form.durationSec, 1, 30, 6)
      f.busy('正在独立的无头浏览器里渲染无声动效贴片（不会影响主工程）…')
      try {
        let d
        try {
          d = await PK.post('vendor/import', { projectDir: dir, sourceDir: src, name: String(form.name || '').trim() || 'motion-overlay', durationSec: dur }, { timeout: 900000 })
        } catch (err) {
          throw new PK.Error(`外部动效模板导入失败：${err.message}（请确认文件夹路径正确、里面有 index.html）`, { code: err.code })
        }
        f.close('ok')
        const where = (d && (d.assetPath || (d.asset && (d.asset.path || d.asset.name)))) || ''
        PK.toast(`动效贴片已安全转码入库${where ? `：${where}` : '，可以在素材库里找到它'}（${U.num(d && d.durationSec, dur)} 秒无声视频）`, 'success')
      } finally {
        if (!f.closed) f.busy(false)
      }
    }
    const pathTa = ui.textarea({ rows: 1, minRows: 1, maxRows: 4, placeholder: '外部模板文件夹的完整路径（里面要有 index.html）', aria: '模板文件夹路径', onInput: (v) => (form.sourceDir = v), onChange: (v) => (form.sourceDir = v), expand: { title: '模板文件夹路径' } })
    PK.append(f.body, [
      ui.note('在隔离的无头浏览器里把第三方动画工程安全渲染成无声的纯画面视频，再作为素材入库，不会污染主工程的代码规范。', { level: 'info' }),
      ui.field({ label: '模板文件夹路径', en: 'SOURCE DIR', required: true, hint: '例如 D:\\动效\\logo-reveal（文件夹里需要有 index.html）' }, pathTa),
      pair(
        ui.field({ label: '片段代号', en: 'NAME', hint: '方便在素材库里认出它' }, ui.input({ placeholder: '例如 logo-reveal', maxLength: 60, onInput: (v) => (form.name = v) })),
        ui.field({ label: '时长（秒）', en: 'DURATION', hint: '1 ~ 30 秒，默认 6 秒' }, ui.input({ type: 'number', min: 1, max: 30, step: 1, value: form.durationSec, onInput: (v) => (form.durationSec = v) })),
        'minmax(0, 1.4fr) minmax(0, 1fr)',
      ),
    ])
    f.setFoot([ui.spacer(), ui.btn('取消', () => f.close('cancel'), { kind: 'ghost' }), ui.btn('渲染导入', submit, { kind: 'primary', icon: 'film', busyText: '渲染中…' })])
    setTimeout(() => pathTa.textarea.focus(), 60)
  }

  /* ---------------------------------------------------------------- step 01 · 素材 */
  const usedCounts = () => new Map((st().assets || []).map((a) => [String(a.id), (a.usedBySceneIds || []).length]))
  function dropZone(ctx, L) {
    const z = h(
      'div.pk-drop',
      { role: 'button', tabindex: '0', key: 'a60-drop', 'aria-label': '拖入文件或文件夹，或点击选择文件' },
      h('span.pk-drop-i', null, PK.icon('upload', 22)),
      h('b.pk-drop-t', null, '把图片、视频、音频或整个文件夹拖到这里'),
      h('span.pk-drop-h', null, '也可以点击选择文件 · 支持多选 · 百兆视频直传不卡顿'),
    )
    const pick = () => guard(() => pickAndImport(ctx, 'any'))
    z.addEventListener('click', pick)
    z.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        pick()
      }
    })
    if (OPS.n > 0) z.classList.add('is-busy')
    L.zoneEl = z
    return z
  }
  function importSection(ctx, L) {
    const item = (icon, title, sub, kind) => wrapSub(ui.item({ key: `a60-imp-${kind}`, icon, title, sub, tip: `${title}：${sub}`, onClick: () => guard(() => pickAndImport(ctx, kind)) }))
    const roleSel = grow(
      ui.select({
        key: 'a60-pathrole',
        value: L.pathRole || '',
        options: [{ value: '', label: '自动识别用途', hint: '按文件类型自动判断' }, ...ROLE_OPTIONS],
        searchable: false,
        menuTitle: '导入后作为…',
        aria: '导入后的用途',
        onChange: (v) => {
          L.pathRole = v
        },
      }),
      '200px',
    )
    roleSel.style.maxWidth = '320px'
    return ui.section(
      {
        title: '导入素材',
        en: 'IMPORT',
        icon: 'upload',
        desc: '图片、视频、背景音乐、真人出镜、数字人底板和声音样本都从这里导入；也可以直接把文件或整个文件夹拖进窗口。',
        actions: [ui.btn('一键加载演示素材', () => starterPack(ctx), { icon: 'sparkle', size: 'sm', busyText: '生成中…', title: '自动生成 3 张高清概念图 + 1 段电影级配乐，零素材也能马上体验出片' })],
      },
      ui.split(
        dropZone(ctx, L),
        ui.grid(
          [
            item('upload', '图片 / 视频 / 音频', '可多选；TXT / MD 文本会作为文案笔记', 'any'),
            item('folder', '整个文件夹', '自动扫描子文件夹里的全部素材', 'folder'),
            item('music', 'BGM 背景音乐', '自动测节拍并设为配乐，人声出现时自动压低', 'bgm'),
            item('cam', '真人出镜视频', '你的口播 / 采访原片，可保留原声', 'host_video'),
            item('user', '数字人底板', '本人正脸视频或照片，用来合成克隆数字人', 'avatar_base'),
            item('mic', '声音克隆样本', '10~30 秒清晰人声，用来克隆你的音色', 'voice_clone'),
          ],
          { min: 230 },
        ),
        { ratio: 'minmax(0, 0.9fr) minmax(0, 1.6fr)' },
      ),
      ui.field(
        { label: '本机路径扫描导入', en: 'LOCAL PATH', hint: '适合大批量素材：不经过浏览器上传，直接从硬盘扫描导入（会自动跳过不支持的格式；可以一行一个路径）。' },
        [
          ui.textarea({
            key: 'a60-path',
            value: L.pathDraft || '',
            rows: 1,
            minRows: 1,
            maxRows: 4,
            placeholder: '粘贴电脑上的文件夹或文件完整路径，例如 D:\\素材\\咖啡馆',
            aria: '本机路径',
            onInput: (v) => {
              L.pathDraft = v
            },
            onChange: (v) => {
              L.pathDraft = v
            },
            expand: { title: '本机路径（每行一个）' },
          }),
          ui.row([roleSel, ui.btn('扫描导入', () => importByPath(ctx, L), { icon: 'search', busyText: '扫描中…' })], { wrap: true }),
        ],
      ),
    )
  }
  function stagingCard(it) {
    const media =
      it.kind === 'video'
        ? h('video', { src: it.url || null, muted: '', preload: 'metadata', playsinline: '', controls: '' })
        : it.kind === 'image'
          ? h('img', { src: it.thumbUrl || it.url || null, alt: '', loading: 'lazy', draggable: 'false' })
          : h('div.pk-media-empty', null, PK.icon('music', 28))
    if (media.tagName === 'VIDEO') media.muted = true
    const subText = [it.provider, it.prompt ? `提示词：${it.prompt}` : ''].filter(Boolean).join(' · ') || '云端生成结果'
    const card = ui.card({
      key: `a60-stg-${it.id}`,
      media,
      aspect: '16/9',
      badge: KIND_CN[it.kind] || '素材',
      title: it.name || '云端生成结果',
      sub: subText,
      actions: [
        ui.btn('确认入库', () => act('confirmStaging', { stagingId: it.id }), { kind: 'primary', size: 'sm', icon: 'check', busyText: '入库中…' }),
        it.kind === 'audio' && it.url ? ui.playBtn(it.url, { label: '试听' }) : null,
        ui.btn('丢弃', () => discardStaging(it), { size: 'sm', kind: 'ghost', icon: 'trash', busyText: '丢弃中…' }),
      ],
      onClick: () => openStaging(it),
    })
    // long prompts are clamped by the skins: the tooltip shows all of it, a click opens the full preview
    const subEl = card.querySelector('.pk-card-s')
    if (subEl) subEl.title = subText
    return card
  }
  function stagingSection(ctx, list) {
    return ui.section(
      {
        title: '云端生成 · 待确认',
        en: 'CLOUD STAGING',
        icon: 'cloud',
        count: list.length,
        desc: '云端 AI 生成的图片 / 视频 / 配乐先放在这里预览：满意就「确认入库」，不满意就丢弃。',
        actions: [
          ui.btn('打开云端媒体', () => PK.open('cloud'), { icon: 'cloud', size: 'sm', kind: 'ghost' }),
          ui.btn('全部丢弃', () => discardAllStaging(ctx, list), { icon: 'trash', size: 'sm', kind: 'danger', busyText: '清理中…' }),
        ],
      },
      ui.grid(list.map(stagingCard), { min: 220 }),
    )
  }
  function cardMedia(a) {
    if (a.type === 'image') return h('img', { src: PK.assetUrl(a.thumb || a.path), alt: '', loading: 'lazy', draggable: 'false' })
    if (a.type === 'video') {
      if (a.thumb) return h('img', { src: PK.assetUrl(a.thumb), alt: '', loading: 'lazy', draggable: 'false' })
      const v = h('video', { src: PK.assetUrl(a.webPath || a.path), muted: '', preload: 'metadata', playsinline: '' })
      v.muted = true
      v.style.pointerEvents = 'none' // a click on the poster frame opens the preview (cards ignore clicks on <video>)
      return v
    }
    return h('div.pk-media-empty', null, PK.icon(a.role === 'voice_clone' ? 'mic' : a.role === 'sfx' ? 'bolt' : a.role === 'host_video' ? 'cam' : 'music', 28))
  }
  function kindBadge(a) {
    const dur = U.num(a.durationSec) > 0 ? secShort(a.durationSec) : ''
    if (a.type === 'video') return `视频${dur ? ` · ${dur}` : ''}`
    if (a.type === 'audio') return `音频${dur ? ` · ${dur}` : ''}`
    return KIND_CN[a.type] || '素材'
  }
  function assetCard(ctx, a, o) {
    const name = assetName(a)
    const role = roleOf(a)
    const tags = []
    if (o.bgmPath && a.path === o.bgmPath) tags.push(ui.tag('当前配乐', { active: true }))
    if (o.avs.sourcePath && a.path === o.avs.sourcePath) tags.push(ui.tag('数字人底板 · 已选用', { active: true }))
    if (o.avs.voiceSamplePath && a.path === o.avs.voiceSamplePath) tags.push(ui.tag('克隆声音 · 已选用', { active: true }))
    if (a.editedPath) tags.push(ui.tag('已 AI 精修'))
    const meta = [
      U.num(a.width) > 0 && U.num(a.height) > 0 ? `${a.width}×${a.height}` : '',
      U.num(a.sizeBytes) > 0 ? U.fmtBytes(a.sizeBytes) : '',
      o.used ? `已用于 ${o.used} 幕` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    const card = ui.card({
      key: `a60-asset-${a.id}`,
      media: cardMedia(a),
      aspect: '16/9',
      badge: kindBadge(a),
      title: name,
      sub: meta || KIND_CN[a.type] || '素材',
      body: ui.select({
        key: `a60-role-${a.id}`,
        value: role,
        options: roleOptions(role),
        searchable: false,
        aria: `「${name}」的用途`,
        menuTitle: '这个素材用来做什么？',
        onChange: (r) => guard(() => changeRole(ctx, a, r)),
      }),
      tags: tags.length ? tags : null,
      actions: [
        ui.btn('预览', () => openPreview(ctx, a), { size: 'sm', icon: 'eye' }),
        a.type === 'audio' ? ui.playBtn(PK.assetUrl(a.path), { label: '试听' }) : null,
        ui.btn('移除', () => removeAssetFlow(a), { size: 'sm', kind: 'ghost', icon: 'trash', busyText: '移除中…' }),
      ],
      onClick: () => openPreview(ctx, a),
      active: Boolean(o.flash && o.flash.has(String(a.id))),
    })
    card.dataset.a60q = `${name} ${a.name || ''} ${ROLE_LABEL[role] || role} ${KIND_CN[a.type] || ''}`.toLowerCase()
    return card
  }
  function librarySection(ctx, L, s, items) {
    const used = usedCounts()
    const bgm = (s.script && s.script.bgm) || {}
    const bgmPath = bgm.enabled === false ? '' : String(bgm.uploadedPath || bgm.path || '')
    const avs = AV()
    const FILTERS = [
      ['all', '全部', () => true],
      ['image', '图片', (a) => a.type === 'image'],
      ['video', '视频', (a) => a.type === 'video'],
      ['audio', '音频', (a) => a.type === 'audio'],
      ['music', 'BGM 配乐', (a) => a.role === 'music'],
      ['special', '出镜 / 数字人 / 声纹', (a) => SPECIAL_ROLES.has(a.role)],
      ['used', '已用于分镜', (a) => (used.get(String(a.id)) || 0) > 0],
    ]
    const cur = FILTERS.find((f) => f[0] === L.filter) || FILTERS[0]
    const list = items.filter(cur[2])
    const flash = Date.now() < FLASH.until ? FLASH.ids : null
    const cards = list.map((a) => assetCard(ctx, a, { used: used.get(String(a.id)) || 0, bgmPath, avs, flash }))
    let search = null
    const noHit = ui.hint('没有名称匹配的素材，换个关键词试试，或者清空搜索框。')
    noHit.hidden = true
    if (items.length > 8) {
      const applyQ = () => {
        const q = String(L.q || '').trim().toLowerCase()
        let n = 0
        for (const c of cards) {
          c.hidden = Boolean(q) && !String(c.dataset.a60q || '').includes(q)
          if (!c.hidden) n++
        }
        noHit.hidden = !(q && cards.length && !n)
      }
      // filtering hides cards in place (no re-render) so Chinese IME input is never interrupted
      search = grow(ui.input({ key: 'a60-q', type: 'search', value: L.q || '', placeholder: `在 ${items.length} 个素材里搜索名称…`, aria: '搜索素材', onInput: (v) => {
        L.q = v
        applyQ()
      } }), '200px')
      search.style.maxWidth = '280px'
      applyQ()
    }
    const chips = ui.chips({
      value: cur[0],
      options: FILTERS.map(([value, label, fn]) => ({ value, label: `${label} ${value === 'all' ? items.length : items.filter(fn).length}` })),
      onChange: (v) => {
        L.filter = v
        refresh(ctx)
      },
    })
    return ui.section(
      {
        title: '素材库',
        en: 'LIBRARY',
        icon: 'grid',
        count: items.length,
        desc: '点素材可以预览；在卡片下方指定它的用途（画面 / 配乐 / 真人出镜 / 数字人底板 / 声音样本 / 音效）。',
        actions: [ui.btn('AI 智能精修', () => curate(ctx), { icon: 'scissors', size: 'sm', busyText: '精修中…', title: '按当前画幅、清晰度与风格自动裁切构图、统一调色（生成在 assets/edited/，原素材不变）', disabled: !items.some((a) => a.type === 'image' || a.type === 'video') })],
      },
      ui.row([chips, search], { between: true, wrap: true }),
      noHit,
      cards.length
        ? ui.grid(cards, { min: 200 })
        : ui.empty({
            icon: 'image',
            title: items.length ? '这一类还没有素材' : '素材库还是空的',
            text: items.length ? '换个分类看看，或者继续导入新素材。' : '把图片、视频、音频拖进窗口，或者点「一键加载演示素材」马上体验出片。',
            actions: items.length ? [ui.btn('查看全部', () => {
              L.filter = 'all'
              refresh(ctx)
            }, { size: 'sm' })] : [ui.btn('一键加载演示素材', () => starterPack(ctx), { kind: 'primary', icon: 'sparkle', busyText: '生成中…' })],
          }),
    )
  }
  function sourcesSection() {
    const flags = st().projectFlags || {}
    const it = (key, icon, title, sub, onClick, right) => wrapSub(ui.item({ key: `a60-src-${key}`, icon, title, sub, tip: `${title}：${sub}`, onClick, right }))
    return ui.section(
      { title: '更多素材来源', en: 'MORE SOURCES', icon: 'layers' },
      ui.grid(
        [
          it('tele', 'cam', '提词器录制', '对着摄像头边看提词边录口播，录好直接入库', () => PK.open('teleprompter')),
          it('ref', 'target', '参考视频复刻', '上传一段喜欢的视频，AI 拆解节奏与风格做同款', () => PK.open('reference'), flags.hasReferenceVideo ? ui.pill('已上传', 'ok') : null),
          it('cloud', 'cloud', '云端 AI 生成', '用云端模型生成图片、视频或配乐，确认后入库', () => PK.open('cloud')),
          it('vendor', 'box', '第三方动效包', '把 .motion / HTML 动效渲染成无声视频贴片', () => openVendor()),
        ],
        { min: 230 },
      ),
    )
  }
  function notesSection(notes) {
    return ui.section(
      { title: '文本笔记', en: 'NOTES', icon: 'list', count: notes.length, desc: '导入的 TXT / MD 文档会作为文案参考交给 AI 导演（只读）。' },
      ui.list(notes.map((n) => ui.item({ key: `a60-note-${n.id}`, icon: 'list', title: n.name || '文本笔记', sub: firstLine(n.text), onClick: () => openNote(n) })), { dense: true }),
    )
  }
  function renderAssets(ctx, s) {
    const L = scope(s)
    const W = hook(ctx, s)
    if (!L.filter) L.filter = 'all'
    const proj = s.project
    if (!proj) {
      ctx.foot([ui.spacer(), ui.btn('新建 / 打开工程', () => PK.open('projects'), { kind: 'primary', icon: 'folder' })])
      W.sig = signature(ctx)
      return ui.empty({ icon: 'folder', title: '还没有打开视频工程', text: '先新建或打开一个工程，再导入素材。', actions: [ui.btn('新建 / 打开工程', () => PK.open('projects'), { kind: 'primary' })] })
    }
    const items = (Array.isArray(proj.assets) ? proj.assets : []).slice().reverse() // newest first
    const notes = Array.isArray(proj.notes) ? proj.notes : []
    const staging = Array.isArray(st().staging) ? st().staging : []
    ctx.foot([
      ui.hint(`共 ${items.length} 个素材${notes.length ? ` · ${notes.length} 份文本笔记` : ''}${staging.length ? ` · ${staging.length} 个云端结果待确认` : ''}`),
      ui.spacer(),
      ui.btn('下一步：导演参数', () => s.go('director'), { kind: 'primary', icon: 'arrowR' }),
    ])
    W.sig = signature(ctx)
    return [importSection(ctx, L), staging.length ? stagingSection(ctx, staging) : null, librarySection(ctx, L, s, items), sourcesSection(), notes.length ? notesSection(notes) : null]
  }

  /* ---------------------------------------------------------------- step 02 · 导演参数 */
  async function polish(ctx, L) {
    PK.needProject()
    const before = String(D().topic || '')
    if (!before.trim()) throw new PK.Error('请先写一句简单想法（例如：帮我做一个咖啡馆新品宣传片），再点 AI 润色')
    if (!llmReady()) return needLlm('AI 润色需要先连接大模型接口（设置 · 模型与密钥）')
    if (!(await act('polishTopic', { topic: before }, { timeout: 660000 }))) return undefined // the host toasted why
    await PK.waitState((s0) => Boolean(s0 && s0.director && s0.director.topic !== before), 4000)
    if (String(D().topic || '') !== before) {
      L.unpolished = before
      refresh(ctx)
    }
    return undefined
  }
  async function restoreTopic(ctx, L) {
    const back = L.unpolished
    if (!back) return
    await PK.action('setDirector', { patch: { topic: back } })
    L.unpolished = ''
    PK.toast('已恢复润色前的原句', 'info')
    refresh(ctx)
  }
  async function applyInspiration(t) {
    PK.needProject()
    const cur = String(D().topic || '').trim()
    if (cur && cur !== t.topic) {
      const ok = await PK.confirm({ title: '套用灵感模板？', text: `用「${t.label}」替换当前的创意需求，并把视觉风格和画面比例一起设好（之后可以随时再改）。`, ok: '套用' })
      if (!ok) return
    }
    await PK.action('setDirector', { patch: { topic: t.topic, style: t.style, aspectRatio: t.aspect } })
    PK.toast(`已套用灵感模板「${t.label}」`, 'success')
  }
  function briefSection(ctx, L) {
    const topic = String(D().topic || '')
    // read-only, auto-growing preview of the brief; editing happens in the shared big editor (PK.editTopic).
    // Grows up to ~8 lines on a 640 px tall window and 14 lines on large screens (then scrolls; ⤢ shows everything).
    const ta = ui.textarea({
      key: 'a60-topic',
      value: topic,
      readOnly: true,
      rows: 4,
      minRows: 4,
      maxRows: Math.max(6, Math.min(14, Math.floor((window.innerHeight || 900) / 76))),
      expand: false,
      aria: '创意需求（点击放大编辑）',
      placeholder: '还没有写创意需求。点这里写下你想要的视频，例如：为社区咖啡馆做一支 45 秒的秋季新品宣传片，突出桂花拿铁的温暖口感，镜头温柔、配轻爵士乐，结尾给出门店地址和第二杯半价活动……',
    })
    const open = () => guard(() => PK.editTopic())
    ta.textarea.title = '点击放大编辑（灵感模板 · AI 润色 · 保存并一键出片）'
    ta.textarea.style.cursor = 'pointer'
    ta.textarea.addEventListener('click', open)
    ta.textarea.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        open()
      }
    })
    return ui.section(
      {
        title: '创意需求 · 导演指令',
        en: 'BRIEF',
        icon: 'prompt',
        desc: '一句话也能出片；写清主题、时长、风格和必须出现的信息，成片会更贴心。点下面的文字框可以放大编辑。',
        actions: [
          ui.btn('编辑', open, { icon: 'expand', size: 'sm', title: '打开大号编辑器' }),
          ui.btn('AI 一键润色', () => polish(ctx, L), { icon: 'wand', size: 'sm', busyText: 'AI 润色中…', title: '让大模型把你的一句话扩写成专业导演指令（会同时整理标题、题材、要点和时长）' }),
          L.unpolished ? ui.btn('恢复原句', () => restoreTopic(ctx, L), { icon: 'retry', size: 'sm', kind: 'ghost', title: `恢复为：${L.unpolished}` }) : null,
        ],
      },
      ta,
      ui.hint(topic.trim() ? `共 ${U.countChars(topic)} 字 · 点上面的文字框放大编辑（可套用灵感模板、AI 润色、保存并一键出片）` : '还没有写创意需求：点上面的文字框开始写，或者直接套用下面的灵感模板。'),
      ui.row([h('span.pk-hint', null, '灵感模板：'), ...INSPIRATIONS.map((t) => ui.btn(t.label, () => applyInspiration(t), { size: 'sm', kind: 'ghost', title: t.topic, busyText: '套用中…' }))], { wrap: true }),
    )
  }
  function workSection(ctx, L) {
    const d = D()
    const genreVal = String(dv(L, 'genre') || '')
    const gOpts = [{ value: '', label: 'AI 自动判断', hint: '按创意需求自动识别题材' }, ...GENRES.map(([value, label, hint]) => ({ value, label, hint }))]
    if (genreVal && !gOpts.some((o) => o.value === genreVal)) gOpts.push({ value: genreVal, label: `自定义：${genreVal}`, hint: '' })
    const title = bindText(ctx, L, 'displayTitle', String(d.displayTitle || ''))
    const glabel = bindText(ctx, L, 'genreLabel', String(d.genreLabel || ''))
    const notes = bindText(ctx, L, 'directorNotes', String(d.directorNotes || ''))
    const outlineNorm = (v) =>
      (Array.isArray(v) ? v : String(v ?? '').split(/\r?\n+/))
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
        .join('\n')
    const outline = bindText(ctx, L, 'contentOutline', (Array.isArray(d.contentOutline) ? d.contentOutline : []).join('\n'), { norm: outlineNorm })
    const oneLine = (b, key, ph, max) => {
      const t = enterCommits(b.wire(ui.textarea({ key, rows: 1, minRows: 1, maxRows: 4, value: b.value, placeholder: ph, aria: ph, onInput: b.onInput, onChange: b.onChange, expand: { title: ph } })))
      if (max) t.textarea.maxLength = max
      return t
    }
    const notesTa = notes.wire(ui.textarea({ key: 'a60-notes', rows: 3, minRows: 3, maxRows: 12, value: notes.value, placeholder: '例如：整体暖色调，避免出现竞品 Logo，结尾停留 2 秒展示二维码', aria: '导演备注', onInput: notes.onInput, onChange: notes.onChange, expand: { title: '导演备注' } }))
    notesTa.textarea.maxLength = 8000 // (no in-box counter: it would cover the text)
    return ui.section(
      { title: '作品信息', en: 'TITLE · GENRE · OUTLINE', icon: 'edit', desc: 'AI 润色后会自动填好这些内容，你也可以随时手动修改。' },
      pair(
        ui.field({ label: '成片标题', en: 'TITLE', hint: '显示在片头和发布包里' }, oneLine(title, 'a60-title', '例如：秋日咖啡馆 · 桂花拿铁上新', 200)),
        ui.field(
          { label: '题材类型', en: 'GENRE', hint: '决定镜头语言和节奏' },
          ui.select({
            key: 'a60-genre',
            value: genreVal,
            options: gOpts,
            showHint: true,
            searchable: false,
            menuTitle: '选择题材',
            aria: '题材类型',
            onChange: (v) => {
              const g = GENRES.find((x) => x[0] === v)
              // the genre preset also renames the 题材名称 below: drop a pending draft so the new label shows
              if (L.savers.genreLabel) L.savers.genreLabel.cancel()
              delete L.drafts.genreLabel
              guard(() => setD(ctx, L, 'genre', v, { genre: v, genreLabel: g ? g[1] : '' }))
            },
          }),
        ),
      ),
      ui.field({ label: '题材名称（可自定义）', en: 'GENRE LABEL', hint: '会写进导演指令，例如：社区咖啡馆探店 · 治愈系' }, oneLine(glabel, 'a60-glabel', '例如：社区咖啡馆探店 · 治愈系', 200)),
      ui.field(
        { label: '内容要点', en: 'OUTLINE', hint: '每行写一个要点，AI 会按顺序安排分镜（最多 80 条）' },
        outline.wire(ui.textarea({ key: 'a60-outline', rows: 3, minRows: 3, maxRows: 12, value: outline.value, placeholder: '例如：\n开场：窗边阳光与咖啡香气\n主角：桂花拿铁特写\n结尾：门店地址与第二杯半价', aria: '内容要点', onInput: outline.onInput, onChange: outline.onChange, expand: { title: '内容要点（每行一个）' } })),
      ),
      ui.field({ label: '导演备注', en: 'DIRECTOR NOTES', hint: '只给 AI 看的制作要求（镜头、色调、禁忌等），不会出现在视频画面里（最多 8000 字）' }, notesTa),
    )
  }
  function durationSection(ctx, L) {
    const mode = dv(L, 'durationMode') === 'custom' ? 'custom' : 'auto'
    const secs = clampInt(dv(L, 'targetDurationSec'), 15, 600, 120)
    const draft = has(L.drafts, 'targetDurationSec') ? L.drafts.targetDurationSec : secs
    const setDur = (v) =>
      guard(async () => {
        delete L.drafts.targetDurationSec
        if (v === '' || v === null || v === undefined) return refresh(ctx) // emptied box → keep the current duration
        const n = clampInt(v, 15, 600, 120)
        if (Number(v) !== n) PK.toast(`目标时长已调整为 ${n} 秒（范围 15 ~ 600 秒）`, 'info')
        await setD(ctx, L, 'targetDurationSec', n, { durationMode: 'custom', targetDurationSec: n })
      })
    const pacing = String(dv(L, 'pacingMode') || 'auto')
    return ui.section(
      { title: '时长与节奏', en: 'DURATION · PACING', icon: 'clock' },
      ui.field(
        {
          label: '目标视频时长',
          en: 'DURATION',
          hint: mode === 'auto' ? '由 AI 按题材复杂度和素材多少自由匹配；也可以在需求里直接写“两分钟以上”“150 秒”。' : `约 ${cnDur(secs)}；AI 润色和分镜策划会严格按这个时长规划内容（15 ~ 600 秒）。`,
        },
        [
          ui.seg({
            value: mode,
            options: [{ value: 'auto', label: 'AI 自由匹配' }, { value: 'custom', label: '自定义时长' }],
            onChange: (m) => guard(() => (m === 'custom' ? setD(ctx, L, 'durationMode', 'custom', { durationMode: 'custom', targetDurationSec: secs }) : setD(ctx, L, 'durationMode', 'auto', { durationMode: 'auto' }))),
          }),
          mode === 'custom'
            ? ui.row(
                [
                  ...DURATION_PRESETS.map(([n, lbl]) => ui.btn(lbl, () => setDur(n), { size: 'sm', kind: n === secs ? 'primary' : 'ghost' })),
                  numInput({ key: 'a60-dur', value: draft, min: 15, max: 600, step: 5, aria: '目标时长（秒）', unit: '秒', dirty: () => has(L.drafts, 'targetDurationSec'), onInput: (v) => {
                    L.drafts.targetDurationSec = v
                  }, onCommit: setDur }),
                ],
                { wrap: true },
              )
            : null,
        ],
      ),
      ui.field(
        { label: '剪辑节奏', en: 'PACING', hint: '决定每个镜头停留多久' },
        ui.select({ key: 'a60-pacing', value: pacing, options: withHints(OP('pacingModes'), HINTS.pacing), showHint: true, searchable: false, aria: '剪辑节奏', onChange: (v) => guard(() => setD(ctx, L, 'pacingMode', v)) }),
      ),
    )
  }
  /* ---------------------------------------------------------------- 视觉风格: AI 自由匹配 · 6 presets · 我的风格预设 */
  const STYLE_LABEL = { emerald: '墨翠轻奢', tech: '科技锋芒', cinematic: '电影大片', documentary: '极简纪实', energetic: '活力潮牌', warm: '温暖故事' }
  // the same rule as effectiveStyleMode() in dsh-tool-media/style-presets.js (an older writer that changed only
  // `style` turns the project into an explicit preset)
  function styleModeOf(sc) {
    if (!sc || typeof sc !== 'object') return 'preset'
    if (sc.styleMode === 'auto') return sc.styleAuto && sc.styleAuto.style && sc.styleAuto.style !== sc.style ? 'preset' : 'auto'
    if (sc.styleMode === 'user') return sc.styleProfile && sc.styleProfile.base === sc.style ? 'user' : 'preset'
    return 'preset'
  }
  const PALETTE_KEYS = [['background', '背景'], ['surface', '卡片'], ['textPrimary', '主文字'], ['textSecondary', '次文字'], ['accent', '主强调'], ['accent2', '辅强调'], ['gold', '点缀']]
  const TYPO_CN = { sans: '无衬线黑体', serif: '衬线 / 书法感', mono: '等宽代码体' }
  const typoText = (t) => (t && typeof t === 'object' ? `${TYPO_CN[t.family] || TYPO_CN.sans}${t.mood ? ` · ${t.mood}` : ''}` : String(t || ''))
  const isMine = (c) => c.kind === 'user' || String(c.value).startsWith('user:')
  const dot = (bg) => h('i', { 'aria-hidden': 'true', style: { display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: bg, boxShadow: 'inset 0 0 0 1px rgba(127,127,127,.35)' } })
  /** the 7 colours of a profile palette (hover shows the role and the hex value) */
  function swatchRow(pal) {
    const keys = PALETTE_KEYS.filter(([k]) => pal && pal[k])
    return h(
      'div',
      { role: 'img', 'aria-label': `配色：${keys.map(([k, cn]) => `${cn} ${pal[k]}`).join('，')}`, style: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 } },
      keys.map(([k, cn]) => h('i', { title: `${cn} ${pal[k]}`, style: { display: 'block', width: 22, height: 22, borderRadius: 5, background: pal[k], boxShadow: 'inset 0 0 0 1px rgba(127,127,127,.4)' } })),
    )
  }
  async function saveStylePreset(prof) {
    PK.needProject()
    const name = await PK.prompt({ title: '保存为我的风格预设', en: 'SAVE STYLE PRESET', label: '预设名称', hint: '最多 20 个字。保存后在「视觉风格」里直接选它，所有工程都能用。', value: String(prof.name || ''), maxLength: 20, required: true, ok: '保存' })
    if (name === null || !String(name).trim()) return
    const d = await PK.postP('style-presets/save', { name: String(name).trim() })
    PK.toast(`已保存为我的风格预设「${(d && d.preset && d.preset.name) || String(name).trim()}」`, 'success', { detail: '想让这个工程以后一直用它：在上面的风格列表里选中这个预设即可。' })
  }
  async function renameStylePreset(card) {
    const name = await PK.prompt({ title: '重命名风格预设', en: 'RENAME', label: '新名称', hint: '最多 20 个字', value: String(card.label || ''), maxLength: 20, required: true, ok: '保存' })
    if (name === null || !String(name).trim() || String(name).trim() === card.label) return
    await PK.post('style-presets/rename', { id: String(card.value).slice(5), name: String(name).trim() })
    PK.toast('风格预设已重命名', 'success')
  }
  async function deleteStylePreset(card) {
    const ok = await PK.confirm({ title: '删除风格预设', text: `确定删除「${card.label}」吗？删除后不能恢复；已经在用它的工程会保留原来的配色和风格。`, ok: '删除', danger: true })
    if (!ok) return
    await PK.post('style-presets/delete', { id: String(card.value).slice(5) })
    PK.toast(`已删除风格预设「${card.label}」`, 'success')
  }
  /** what the project uses: the AI's pick or new design (保存为我的预设), or one of 我的预设 */
  function styleStatus(sc, cur) {
    const mode = styleModeOf(sc)
    const prof = sc && sc.styleProfile && typeof sc.styleProfile === 'object' ? sc.styleProfile : null
    if (cur === 'auto' && mode === 'auto' && sc.styleAuto && sc.styleAuto.style && sc.styleAuto.by !== 'pending') {
      if (sc.styleAuto.custom && prof) {
        return h(
          'div',
          { 'data-a60': 'ai-style' },
          ui.note(
            [
              h('div', null, h('b', null, `AI 为本片设计了新风格「${prof.name}」`), prof.desc ? `：${prof.desc}` : ''),
              h('div', { style: { opacity: 0.85, marginTop: 4 } }, `基于「${STYLE_LABEL[prof.base] || prof.base}」 · 字体 ${typoText(prof.typography)}${prof.motion ? ` · 运镜 ${prof.motion}` : ''}${prof.bgmMood ? ` · 配乐 ${prof.bgmMood}` : ''}`),
              swatchRow(prof.palette),
            ],
            { level: 'ok', title: 'AI 自创风格', actions: [ui.btn('保存为我的预设', () => saveStylePreset(prof), { kind: 'primary', size: 'sm', icon: 'save', busyText: '保存中…' })] },
          ),
          ui.hint('「AI 自由匹配」每次生成都会重新挑选；想固定这个风格，先保存为我的预设，再在上面选中它。'),
        )
      }
      const by = sc.styleAuto.by === 'llm' ? 'AI 为本片选择了' : '已按主题自动匹配'
      return ui.note(`${by}「${STYLE_LABEL[sc.style] || sc.style}」。用大模型编码出片时 AI 会再按主题挑选，预设都不合适时会自创新风格。`, { level: 'info' })
    }
    if (cur === 'auto') return ui.hint('生成时由 AI 按主题从上面的风格里挑选；都不合适时自创新风格，之后可以保存为我的预设。')
    if (cur.startsWith('user:') && mode === 'user' && prof) {
      return ui.note([h('div', null, `正在使用我的预设「${prof.name}」${prof.desc ? `：${prof.desc}` : ''}`), swatchRow(prof.palette)], { level: 'info' })
    }
    return null
  }
  function styleSection(ctx, L, s) {
    const cur = String(dv(L, 'style') || 'auto')
    const cards = OP('styleCards')
    const sc = (s && s.script) || {}
    const card = (c) =>
      ui.item({
        key: `a60-style-${c.value}`,
        lead: c.swatch ? dot(c.swatch) : null,
        title: c.label,
        sub: c.hint || '',
        tip: c.hint ? `${c.label} · ${c.hint}` : c.label,
        active: c.value === cur,
        right: isMine(c)
          ? ui.iconBtn(
              'more',
              (ev, btn) => {
                const anchor = btn || (ev && ev.currentTarget)
                if (!anchor) return
                PK.menu(
                  anchor,
                  [
                    { group: `我的预设 · ${c.label}` },
                    { label: '重命名…', icon: 'edit', onClick: () => renameStylePreset(c) },
                    { label: '删除…', icon: 'trash', danger: true, onClick: () => deleteStylePreset(c) },
                  ],
                  { align: 'end' },
                )
              },
              { title: `管理预设「${c.label}」：重命名 / 删除` },
            )
          : null,
        onClick: () => guard(() => setD(ctx, L, 'style', c.value)),
      })
    const builtin = cards.filter((c) => !isMine(c))
    const mine = cards.filter(isMine)
    return ui.section(
      { title: '视觉风格', en: 'STYLE', icon: 'brush', desc: '统一全片的色彩、字体与转场基调。选「AI 自由匹配」让 AI 按主题挑选或自创风格。' },
      ui.grid(builtin.map(card), { min: 160 }),
      mine.length ? ui.divider(`我的风格预设 · ${mine.length}`) : null,
      mine.length ? ui.grid(mine.map(card), { min: 160 }) : null,
      styleStatus(sc, cur),
      figureStyleField(ctx, L, sc),
    )
  }
  /** 人物画风: how people and animals are drawn — any pick but AI-decides beats style words in the brief */
  function figureStyleField(ctx, L, sc) {
    const opts = OP('figureStyles')
    const cur0 = String(dv(L, 'figureStyleChoice') || 'auto')
    const cur = opts.some((o) => o.value === cur0) ? cur0 : 'auto'
    const fields = [
      ui.field(
        { label: '人物画风', en: 'CHARACTERS', hint: '全片统一，优先于需求里写的画风；剪影到火柴人用现成的侧身人物库，自定义由 AI 按你的描述自己设计角色' },
        ui.select({ key: 'a60-figstyle', value: cur, options: opts, showHint: true, searchable: false, aria: '人物画风', onChange: (v) => guard(() => setD(ctx, L, 'figureStyleChoice', v)) }),
      ),
    ]
    if (cur === 'custom') {
      const b = bindText(ctx, L, 'figureStyleChoiceNote', String(D().figureStyleChoiceNote || ''))
      const ta = enterCommits(b.wire(ui.textarea({ key: 'a60-fignote', rows: 1, minRows: 1, maxRows: 2, value: b.value, placeholder: '例如：Q版萌系，圆脸大眼；日系动漫；绘本手绘；像素风', aria: '想要的人物画风', onInput: b.onInput, onChange: b.onChange, expand: false })))
      ta.textarea.maxLength = 40
      fields.push(ui.field({ label: '想要的人物画风', en: 'DESCRIBE', hint: 'AI 会按这里写的画风自己设计角色，全片统一（最多 40 个字）' }, ta))
    }
    const resolved = String((sc && sc.figureStyle) || '')
    const ZH = { silhouette: '剪影', papercut: '剪纸', puppet: '皮影', ink: '水墨', flat: '扁平插画', stick: '火柴人' }
    if (cur === 'auto' && resolved && resolved !== 'auto') {
      const name = resolved === 'custom' ? `自定义「${String(sc.figureStyleNote || '按需求')}」` : ZH[resolved] || resolved
      fields.push(ui.hint(`上一次出片的人物画风：${name}。想固定或换一种，直接在上面选。`))
    }
    return ui.stack([ui.divider(), ...fields])
  }
  async function composeLlm(ctx, L) {
    PK.needProject()
    if (!llmReady()) return needLlm('请先配置大模型接口，才能让 AI 编写纯代码配乐')
    await ctx.task('AI 大模型正在编写合成器代码并生成 48kHz 配乐母带…', async () => {
      const d = await PK.postP('audio/llm-compose', {}, { timeout: 900000 })
      await PK.action('setDirector', { patch: { bgmMode: 'llm-coded' } })
      L.bgmPreview = String((d && d.previewUrl) || '')
      PK.toast(`AI 配乐合成完毕${d && d.relScriptPath ? `（${d.relScriptPath}）` : ''}，可以直接点播放器试听`, 'success')
    }, { fail: 'AI 作曲失败' })
    return undefined
  }
  async function composeTts(ctx, L, s) {
    PK.needProject()
    const typed = has(L.drafts, 'bgmTtsPrompt') ? L.drafts.bgmTtsPrompt : null
    await settle(ctx) // saves the description being typed (and a voice just picked) first
    const d = D()
    const prompt = String((typed !== null ? typed : d.bgmTtsPrompt) || '').trim()
    const label = ttsInfo().label || '配音引擎'
    await ctx.task(`${label} 正在合成沉浸式氛围音景…`, async () => {
      const res = await PK.postP(
        'audio/tts-compose',
        {
          promptText: prompt || String((s.script && s.script.title) || '') || '深沉空灵氛围音景',
          voiceId: d.voiceId || 'auto',
          mode: 'bgm-pad',
          durationSec: Math.min(18, Math.max(6, U.num(s.script && s.script.totalDurationSec, 10) || 10)),
          emotion: '深沉',
        },
        { timeout: 900000 },
      )
      await PK.action('setDirector', { patch: { bgmMode: 'tts-engine' } })
      L.bgmPreview = String((res && res.previewUrl) || '')
      PK.toast(`${label} 氛围音景已绑定为主配乐，可以直接试听`, 'success')
    }, { fail: '生成氛围音景失败' })
  }
  async function bindBgm(a) {
    let d
    try {
      d = await PK.postP('assets/role', { assetId: a.id, role: 'music' })
    } catch (err) {
      throw new PK.Error(`设为背景音乐失败：${err.message}`, { code: err.code })
    }
    await PK.action('setDirector', { patch: { bgmMode: 'uploaded' } }).catch(() => {})
    const notes = boundNotes(d && d.autoBound)
    PK.toast(notes[0] || `已把「${assetName(a)}」设为背景音乐`, 'success')
  }
  function currentBgm(script, assets) {
    const bgm = (script && script.bgm) || {}
    const rel = String(bgm.uploadedPath || bgm.path || '')
    if (!rel || bgm.enabled === false) return ui.hint('当前还没有生成或绑定配乐：出片时会按上面选的来源自动生成。')
    const lib = (assets || []).find((a) => a && a.path === rel)
    const src = bgm.source === 'llm-coded' ? 'AI 编码配乐' : bgm.source === 'tts-engine' ? 'TTS 氛围音景' : bgm.source === 'user-imported' ? '你上传的配乐' : '配乐'
    const beat = U.num(bgm.bpm) > 0
      ? [`已测定节拍 ${Math.round(U.num(bgm.bpm))} BPM`, bgm.phaseSec !== undefined ? `首拍 ${U.num(bgm.phaseSec).toFixed(2)} 秒` : '', Array.isArray(bgm.downbeats) ? `${bgm.downbeats.length} 个重拍` : '', Array.isArray(bgm.drops) ? `${bgm.drops.length} 个高潮突降点` : ''].filter(Boolean).join(' · ')
      : ''
    return wrapSub(ui.item({ key: 'a60-curbgm', icon: 'music', title: `当前配乐：${lib ? assetName(lib) : U.baseName(rel)}`, sub: [src, beat].filter(Boolean).join(' · '), tip: rel, right: [ui.playBtn(PK.assetUrl(rel), { label: '试听' })] }))
  }
  function bgmSection(ctx, L, s) {
    const mode = String(dv(L, 'bgmMode') || 'llm-coded')
    const narr = String(dv(L, 'narrationMode') || 'tts')
    const script = s.script || {}
    const bgm = script.bgm || {}
    const assets = s.project && Array.isArray(s.project.assets) ? s.project.assets : []
    const music = assets.filter((a) => a.type === 'audio' && a.role === 'music')
    const curPath = String(bgm.uploadedPath || bgm.path || '')
    let panel
    if (mode === 'llm-coded') {
      panel = ui.stack([
        ui.hint('大模型会现场编写一段合成器代码，生成 48kHz 原创配乐（需要已配置大模型，会消耗少量额度）。'),
        ui.row([ui.btn('让 AI 编写配乐并试听', () => composeLlm(ctx, L), { icon: 'wand', busyText: 'AI 作曲中…' })]),
        L.bgmPreview ? ui.audio(L.bgmPreview) : null,
      ])
    } else if (mode === 'uploaded') {
      panel = ui.stack([
        music.length
          ? ui.list(
              music.map((a) => {
                const isCur = a.path === curPath
                return ui.item({
                  key: `a60-bgm-${a.id}`,
                  icon: 'music',
                  title: assetName(a),
                  sub: [U.num(a.durationSec) > 0 ? secShort(a.durationSec) : '', isCur && U.num(bgm.bpm) > 0 ? `${Math.round(U.num(bgm.bpm))} BPM` : ''].filter(Boolean).join(' · ') || '音频',
                  active: isCur,
                  right: [ui.playBtn(PK.assetUrl(a.path), { label: '试听' }), isCur ? ui.pill('当前配乐', 'acc') : ui.btn('用这首', () => bindBgm(a), { size: 'sm', busyText: '绑定中…' })],
                })
              }),
              { dense: true },
            )
          : ui.note('还没有上传配乐。上传一首你喜欢的音乐，会自动测量节拍并作为背景音乐。', { level: 'info' }),
        ui.row([ui.btn('上传新的 BGM', () => pickAndImport(ctx, 'bgm'), { icon: 'upload', size: 'sm', busyText: '上传中…' }), ui.btn('去素材库', () => s.go('assets'), { size: 'sm', kind: 'ghost', icon: 'chevL' })], { wrap: true }),
      ])
    } else {
      const b = bindText(ctx, L, 'bgmTtsPrompt', String(D().bgmTtsPrompt || ''))
      const tts = ttsInfo()
      panel = ui.stack([
        ui.field(
          { label: '氛围音景描述', en: 'PROMPT', hint: '用文字描述想要的氛围，配音引擎会生成一段沉浸式的人声氛围音景作为配乐。' },
          enterCommits(b.wire(ui.textarea({ key: 'a60-bgmtts', rows: 1, minRows: 1, maxRows: 4, value: b.value, placeholder: '例如：科技光影律动 温暖氛围铺底', aria: '氛围音景描述', onInput: b.onInput, onChange: b.onChange, expand: { title: '氛围音景描述' } }))),
        ),
        !tts.ready
          ? ui.note(`配音引擎「${tts.label || '本地 TTS'}」还没就绪：生成时会尝试自动启动（第一次可能要等 1~2 分钟）；启动不了可以去配音引擎设置里一键安装或修复。`, { level: 'warn', actions: [ui.btn('配音引擎设置', () => PK.open('keys', { tab: 'tts' }), { size: 'sm', icon: 'settings' })] })
          : null,
        ui.row([ui.btn('生成氛围音景', () => composeTts(ctx, L, s), { icon: 'wave', busyText: '生成中…' })]),
        L.bgmPreview ? ui.audio(L.bgmPreview) : null,
      ])
    }
    return ui.section(
      { title: '背景音乐与配音节奏', en: 'BGM · NARRATION', icon: 'music', desc: '混音时人声一出现，配乐会自动压低（闪避）。' },
      ui.field({ label: '配乐来源', en: 'BGM', hint: HINTS.bgm[mode] || '' }, ui.seg({ value: mode, options: withHints(OP('bgmModes'), HINTS.bgm), onChange: (v) => guard(() => setD(ctx, L, 'bgmMode', v)) })),
      panel,
      currentBgm(script, assets),
      ui.field({ label: '配音与卡点模式', en: 'NARRATION', hint: HINTS.narration[narr] || '' }, ui.seg({ value: narr, options: withHints(OP('narrationModes'), HINTS.narration), onChange: (v) => guard(() => setD(ctx, L, 'narrationMode', v)) })),
    )
  }
  function customSize(ctx, L) {
    const d = D()
    const w = has(L.drafts, 'customWidth') ? L.drafts.customWidth : U.num(dv(L, 'customWidth'), 1080)
    const hh = has(L.drafts, 'customHeight') ? L.drafts.customHeight : U.num(dv(L, 'customHeight'), 1920)
    const commitSize = (key) => (v) =>
      guard(async () => {
        delete L.drafts[key]
        if (v === '' || v === null || v === undefined) return refresh(ctx) // emptied box → keep the current size
        const n = clampInt(v, 240, 7680, key === 'customWidth' ? 1080 : 1920)
        const even = Math.round(n / 2) * 2
        if (Number(v) !== even) PK.toast(`${key === 'customWidth' ? '宽度' : '高度'}已调整为 ${even} 像素（240 ~ 7680，且须为偶数）`, 'info')
        await setD(ctx, L, key, even)
      })
    return ui.field({ label: '自定义分辨率（像素）', en: 'CUSTOM SIZE', hint: '宽、高范围 240 ~ 7680，会自动取偶数；画面比例或清晰度选「自定义」时生效。' }, [
      ui.row(
        [
          numInput({ key: 'a60-cw', value: w, min: 240, max: 7680, step: 2, pre: '宽', width: '104px', aria: '自定义宽度（像素）', dirty: () => has(L.drafts, 'customWidth'), onInput: (v) => {
            L.drafts.customWidth = v
          }, onCommit: commitSize('customWidth') }),
          h('span.pk-hint', null, '×'),
          numInput({ key: 'a60-ch', value: hh, min: 240, max: 7680, step: 2, pre: '高', width: '104px', aria: '自定义高度（像素）', dirty: () => has(L.drafts, 'customHeight'), onInput: (v) => {
            L.drafts.customHeight = v
          }, onCommit: commitSize('customHeight') }),
        ],
        { wrap: true },
      ),
      ui.row(
        SIZE_PRESETS.map(([pw, ph, lbl]) =>
          ui.btn(lbl, async () => {
            delete L.drafts.customWidth
            delete L.drafts.customHeight
            await setD(ctx, L, 'customWidth', pw, { customWidth: pw, customHeight: ph })
          }, { size: 'sm', kind: pw === U.num(d.customWidth) && ph === U.num(d.customHeight) ? 'primary' : 'ghost' }),
        ),
        { wrap: true },
      ),
    ])
  }
  function formatSection(ctx, L, s) {
    const engine = String(dv(L, 'engine') || 'remotion')
    const mode = String(dv(L, 'creationMode') || 'ai-coded')
    const aspect = String(dv(L, 'aspectRatio') || 'auto')
    const quality = String(dv(L, 'quality') || '1080p')
    const fps = U.num(dv(L, 'fps'), 30) || 30
    const platform = String(dv(L, 'targetPlatform') || 'universal')
    const fx = String(dv(L, 'visual3dMode') || 'auto')
    // the Vibecoding tools are never picked here: the AI calls them per scene and writes its own code when none fits
    const vibe = Array.isArray(s && s.data && s.data.vibeToolkit) ? s.data.vibeToolkit : []
    const vibeReady = vibe.filter((t) => t && t.available).length
    const fxHint = `${vibe.length ? `Vibecoding 工具箱（本机就绪 ${vibeReady}/${vibe.length}）` : 'Vibecoding 工具箱'}由 AI 按每一镜的需要自动调用，不用手动挑选；工具满足不了的效果，AI 会直接写代码实现。这里只定整体视效偏好。`
    const badgeOn = Boolean(dv(L, 'aiBadgeEnabled'))
    const reviewOn = dv(L, 'visualReview') !== false
    const badgePos = String(dv(L, 'aiBadgePosition') || 'top-right')
    const aspects = withHints(OP('aspectRatios'), HINTS.aspect)
    if (!aspects.some((o) => o.value === 'custom')) aspects.push({ value: 'custom', label: '自定义宽高', hint: HINTS.aspect.custom })
    const quals = withHints(OP('qualities'), HINTS.quality)
    if (!quals.some((o) => o.value === 'custom')) quals.push({ value: 'custom', label: '自定义分辨率', hint: HINTS.quality.custom })
    const badgeText = bindText(ctx, L, 'aiBadgeText', String(D().aiBadgeText || ''))
    const badgeTa = enterCommits(badgeText.wire(ui.textarea({ key: 'a60-badge', rows: 1, minRows: 1, maxRows: 3, value: badgeText.value, placeholder: '留空默认显示「AI 辅助创作」', aria: '角标文字', onInput: badgeText.onInput, onChange: badgeText.onChange, expand: false })))
    badgeTa.textarea.maxLength = 40
    return ui.section(
      { title: '画面规格', en: 'FORMAT', icon: 'film' },
      ui.field({ label: '渲染引擎', en: 'ENGINE', hint: HINTS.engine[engine] || '' }, ui.seg({ value: engine, options: withHints(OP('engines'), HINTS.engine), onChange: (v) => guard(() => setD(ctx, L, 'engine', v)) })),
      ui.field({ label: '创作模式', en: 'MODE', hint: HINTS.mode[mode] || '' }, ui.seg({ value: mode, options: withHints(OP('creationModes'), HINTS.mode), onChange: (v) => guard(() => setD(ctx, L, 'creationMode', v)) })),
      pair(
        ui.field({ label: '画面比例', en: 'ASPECT' }, ui.select({ key: 'a60-aspect', value: aspect, options: aspects, showHint: true, searchable: false, aria: '画面比例', onChange: (v) => guard(() => setD(ctx, L, 'aspectRatio', v)) })),
        ui.field({ label: '清晰度', en: 'QUALITY' }, ui.select({ key: 'a60-quality', value: quality, options: quals, showHint: true, searchable: false, aria: '清晰度', onChange: (v) => guard(() => setD(ctx, L, 'quality', v)) })),
      ),
      aspect === 'custom' || quality === 'custom' ? customSize(ctx, L) : null,
      platform === 'xiaohongshu' && !['3:4', 'auto', 'custom'].includes(aspect)
        ? ui.note('小红书图文笔记大多是 3:4 竖版，用 3:4 画面首图不会被裁切。', { level: 'info', actions: [ui.btn('改为 3:4', () => guard(() => setD(ctx, L, 'aspectRatio', '3:4')), { size: 'sm' })] })
        : null,
      pair(
        ui.field({ label: '帧率', en: 'FPS', hint: '30 帧通用；60 帧更顺滑但渲染更慢' }, ui.seg({ value: fps, options: FPS_LIST.map((n) => ({ value: n, label: String(n), hint: `${n} 帧 / 秒` })), onChange: (v) => guard(() => setD(ctx, L, 'fps', Number(v))) })),
        ui.field({ label: '首发平台', en: 'PLATFORM', hint: platform === 'xiaohongshu' ? '小红书推荐 3:4 竖版（画面比例选「AI 智能判断」时自动用 3:4）' : '自动避让平台的按钮和字幕区' }, ui.select({ key: 'a60-platform', value: platform, options: OP('platforms'), showHint: true, searchable: false, aria: '首发平台', onChange: (v) => guard(() => setD(ctx, L, 'targetPlatform', v)) })),
      ),
      ui.field({ label: '视效偏好', en: 'VISUAL FX · AI TOOLS', hint: fxHint }, ui.select({ key: 'a60-fx', value: fx, options: withHints(OP('visual3dModes'), HINTS.fx), showHint: true, searchable: false, aria: '视效偏好', onChange: (v) => guard(() => setD(ctx, L, 'visual3dMode', v)) })),
      mode === 'ai-coded'
        ? ui.toggle({ value: reviewOn, label: '画面自检（AI 看图返工）', hint: '代码写完后先渲染每个镜头的关键帧，让大模型看图检查人物、构图、文字和亮度，有明显问题的镜头带截图返工一次。需要能看图的模型；每批镜头多 1~2 次大模型调用', onChange: (v) => guard(() => setD(ctx, L, 'visualReview', v)) })
        : null,
      ui.toggle({ value: badgeOn, label: '添加 AI 创作角标', hint: '在画面角落标注「AI 辅助创作」，符合平台对 AI 内容的标注要求', onChange: (v) => guard(() => setD(ctx, L, 'aiBadgeEnabled', v)) }),
      badgeOn
        ? pair(
            ui.field({ label: '角标位置', en: 'POSITION' }, ui.select({ key: 'a60-badgepos', value: badgePos, options: withHints(OP('aiBadgePositions'), HINTS.badge), showHint: true, searchable: false, aria: '角标位置', onChange: (v) => guard(() => setD(ctx, L, 'aiBadgePosition', v)) })),
            ui.field({ label: '角标文字', en: 'TEXT', hint: '最多 40 个字' }, badgeTa),
          )
        : null,
    )
  }
  function voiceOptions(s, cur) {
    const cat = Array.isArray(s.data && s.data.voiceCatalog) ? s.data.voiceCatalog : []
    const groups = new Map()
    for (const v of cat) {
      if (!v || !v.id || v.available === false) continue
      const g = String(v.category || '其他音色')
      if (!groups.has(g)) groups.set(g, [])
      groups.get(g).push({
        value: String(v.id),
        label: String(v.name || v.id),
        hint: [GENDER_CN[v.gender], AGE_CN[v.ageGroup], (Array.isArray(v.tags) ? v.tags : []).slice(0, 4).join(' / ')].filter(Boolean).join(' · '),
        group: g,
      })
    }
    let list = [].concat(...groups.values())
    if (!list.length) list = OP('voices').filter((o) => o.value !== 'auto').map((o) => ({ value: o.value, label: o.label, group: '音色库' }))
    const out = [{ value: 'auto', label: 'AI 自动匹配音色', hint: '按每一幕的情绪和角色自动挑选', group: '智能推荐' }, ...list]
    if (cur && !out.some((o) => o.value === cur)) {
      const raw = cat.find((v) => v && v.id === cur)
      out.splice(1, 0, { value: cur, label: `${raw ? raw.name || cur : cur}（当前 · 暂不可用）`, hint: '音色文件缺失或当前引擎不支持，建议换一个', group: '当前音色', missing: true })
    }
    return out
  }
  async function switchEngine(ctx, id, engines) {
    const e = engines.find((x) => String(x.id) === id)
    try {
      const d = await PK.post('tts-config', { action: 'select', activeEngineId: id })
      PK.toast(`已切换配音引擎：${(d && d.config && d.config.activeEngine && d.config.activeEngine.name) || (e && (e.name || e.shortName)) || id}`, 'success')
    } catch (err) {
      refresh(ctx)
      throw err
    }
  }
  function voiceSection(ctx, L, s) {
    const voiceId = String(dv(L, 'voiceId') || 'auto')
    const opts = voiceOptions(s, voiceId)
    const count = opts.filter((o) => o.value !== 'auto' && !o.missing).length
    const sel = grow(
      ui.select({ key: 'a60-voice', value: voiceId, options: opts, searchable: true, showHint: true, menuTitle: `${count} 个可用音色 · 可搜索名字 / 性别 / 风格`, aria: '全片主配音', onChange: (v) => guard(() => setD(ctx, L, 'voiceId', v)) }),
      '220px',
    )
    const play = ui.playBtn(voiceId === 'auto' ? '' : PK.routeUrl('voices/preview', { id: voiceId }), { label: '试听', title: voiceId === 'auto' ? '「AI 自动匹配」会按每一幕挑选音色，没有固定的试听' : '试听这个音色的原声样本' })
    if (voiceId === 'auto') play.disabled = true
    const tempo = U.num(rv(L, 'speechTempo'), 1) || 1
    const tts = ttsInfo()
    const cfg = (s.data && s.data.ttsConfig) || {}
    // (the classic UI fell back to the three local engines when the config summary was not loaded)
    const engines = Array.isArray(cfg.engines) && cfg.engines.length ? cfg.engines : [{ id: 'indextts25', shortName: 'IndexTTS-2.5' }, { id: 'indextts2', shortName: 'IndexTTS-2' }, { id: 'gptvoice', shortName: 'GPT-SoVITS (低显存)' }]
    const activeId = String(cfg.activeEngineId || 'indextts25')
    const activeEng = engines.find((e) => String(e.id) === activeId) || null
    return ui.section(
      { title: '配音音色', en: 'VOICE', icon: 'voice', actions: [ui.btn('打开配音中心', () => PK.open('voices'), { size: 'sm', icon: 'voice', title: '试听全部音色、克隆你自己的声音、导入音色包' })] },
      ui.field(
        { label: '全片主配音', en: 'NARRATOR', hint: voiceId === 'auto' ? 'AI 会按每一幕的情绪和角色自动挑选最合适的音色。' : '在「分镜精修」里还可以给某一幕单独换音色。' },
        ui.row([sel, play], { wrap: true }),
      ),
      ui.field(
        {
          label: '配音引擎',
          en: 'TTS ENGINE',
          aside: ui.pill(tts.ready ? '已就绪' : '待连接', tts.ready ? 'ok' : 'warn', { dot: true, title: `${tts.label || '配音引擎'}${tts.ready ? ' 已就绪' : ' 还没启动：配音时会自动尝试启动'}` }),
          hint: `${activeEng && activeEng.vramBadge ? `当前引擎建议：${activeEng.vramBadge}。` : ''}切换后对所有工程生效；云端引擎需要先在设置里填写密钥。`,
        },
        [
          ui.chips({
            value: activeId,
            options: engines.map((e) => ({ value: String(e.id), label: String(e.shortName || e.name || e.id), hint: [e.name, e.vramBadge].filter(Boolean).join(' · ') })),
            onChange: (id) => guard(() => switchEngine(ctx, String(id), engines)),
          }),
          ui.row(
            [
              ui.btn('配音引擎设置', () => PK.open('keys', { tab: 'tts' }), { size: 'sm', kind: 'ghost', icon: 'settings', title: '检测、安装或修复本地配音引擎，填写云端语音密钥' }),
              ui.btn('添加 / 导入其他模型', () => PK.open('keys', { tab: 'tts' }), { size: 'sm', kind: 'ghost', icon: 'plus', title: '接入自定义的 OpenAI 兼容 / HTTP / 命令行配音模型' }),
            ],
            { wrap: true },
          ),
        ],
      ),
      ui.field(
        { label: '口播语速', en: 'TEMPO', hint: '1.00× 为正常语速；数字越大说得越快' },
        ui.slider({ value: tempo, min: Math.min(0.75, tempo), max: Math.max(1.5, tempo), step: 0.05, aria: '口播语速', format: (v) => `${Number(v).toFixed(2)}×`, onChange: (v) => guard(() => setR(ctx, L, 'speechTempo', Math.round(Number(v) * 100) / 100)) }),
      ),
    )
  }
  function presetField(ctx, L, s) {
    const raw = Array.isArray(s.data && s.data.avatarTemplates) ? s.data.avatarTemplates : []
    let opts = raw.filter((t) => t && t.id).map((t) => ({ value: String(t.id), label: String(t.name || t.id), hint: String(t.subtitle || ''), swatch: t.primary || null }))
    if (!opts.length) opts = OP('avatarPresets')
    if (!opts.length) opts = o2([['cyber-anchor', '赛博科技主理人'], ['editorial-mentor', '黑金质感顾问'], ['studio-creator', '活力创意播主']])
    const cur = String(av(L, 'presetId') || '')
    if (cur && !opts.some((o) => o.value === cur)) opts.push({ value: cur, label: cur, hint: '当前形象' })
    return ui.field(
      { label: 'AI 主播形象', en: 'PRESET', hint: '形象细节、口型引擎和试合成在「数字人」面板里' },
      ui.select({ key: 'a60-preset', value: cur, options: opts, placeholder: '选择一个 AI 主播形象', showHint: true, searchable: false, aria: 'AI 主播形象', onChange: (v) => guard(() => setA(ctx, L, 'presetId', v)) }),
    )
  }
  function clonedFields(ctx, L, s) {
    const assets = s.project && Array.isArray(s.project.assets) ? s.project.assets : []
    const srcCur = String(av(L, 'sourcePath') || '')
    const vsCur = String(av(L, 'voiceSamplePath') || '')
    const srcList = assets.filter((a) => a.type === 'video' || a.type === 'image').sort((a, b) => Number(b.role === 'avatar_base') - Number(a.role === 'avatar_base'))
    const vsList = assets.filter((a) => a.role === 'voice_clone' || a.type === 'audio' || a.role === 'host_video').sort((a, b) => Number(b.role === 'voice_clone') - Number(a.role === 'voice_clone'))
    const mk = (list, cur, autoLabel) => {
      const o = [
        { value: '', label: autoLabel, hint: '' },
        ...list.map((a) => ({ value: String(a.path), label: assetName(a), hint: a.role === 'avatar_base' ? '★ 数字人底板' : a.role === 'voice_clone' ? '★ 声音克隆样本' : ROLE_LABEL[roleOf(a)] || KIND_CN[a.type] || '' })),
      ]
      if (cur && !o.some((x) => x.value === cur)) o.push({ value: cur, label: U.baseName(cur), hint: '当前选择（不在素材库里）' })
      return o
    }
    const pick = (key, list, cur, autoLabel) =>
      grow(ui.select({ key: `a60-${key}`, value: cur, options: mk(list, cur, autoLabel), showHint: true, searchable: list.length > 10, aria: key === 'sourcePath' ? '本人出镜底板' : '声音克隆样本', onChange: (v) => guard(() => setA(ctx, L, key, v)) }), '220px')
    return [
      ui.field(
        { label: '本人出镜底板', en: 'SOURCE', hint: srcList.length ? '选一段本人正脸视频，或一张清晰的正脸照片' : '素材库里还没有视频或照片：先导入一段本人正脸视频' },
        ui.row([pick('sourcePath', srcList, srcCur, '自动（优先用标记为「数字人底板」的素材）'), ui.btn('导入底板', () => pickAndImport(ctx, 'avatar_base'), { size: 'sm', icon: 'upload', busyText: '导入中…' })], { wrap: true }),
      ),
      ui.field(
        { label: '声音克隆样本', en: 'VOICE SAMPLE', hint: '10~30 秒清晰人声，用来让数字人说出你的声音' },
        ui.row([pick('voiceSamplePath', vsList, vsCur, '自动（优先用标记为「声音克隆样本」的素材）'), ui.btn('导入样本', () => pickAndImport(ctx, 'voice_clone'), { size: 'sm', icon: 'upload', busyText: '导入中…' })], { wrap: true }),
      ),
    ]
  }
  function chromaField(ctx, L) {
    const cur = String(av(L, 'chromaKeyColor') || '')
    const preset = CHROMA.find(([v]) => v.toLowerCase() === cur.toLowerCase())
    const custom = L.chromaCustom || !preset
    return ui.field({ label: '绿幕抠像', en: 'CHROMA KEY', hint: '只有底板是绿幕 / 蓝幕拍摄时才需要；普通视频保持「不抠像」。' }, [
      ui.seg({
        value: custom ? 'custom' : preset[0],
        options: [...CHROMA.map(([value, label]) => ({ value, label })), { value: 'custom', label: '自定义颜色' }],
        onChange: (v) => {
          if (v === 'custom') {
            L.chromaCustom = true
            refresh(ctx)
            return
          }
          L.chromaCustom = false
          guard(() => setA(ctx, L, 'chromaKeyColor', v))
        },
      }),
      custom ? ui.color({ value: cur || '#00FF00', onChange: (v) => chromaSaver(ctx, L)(String(v).toUpperCase()) }) : null,
    ])
  }
  /** the native colour picker fires on every drag step: save the picked colour debounced */
  const chromaSaver = (ctx, L) => L.savers.chroma || (L.savers.chroma = saver((v) => guard(() => setA(ctx, L, 'chromaKeyColor', v)), 400))
  function avatarSection(ctx, L, s) {
    const enabled = Boolean(av(L, 'enabled'))
    const mode = av(L, 'mode') === 'cloned-human' ? 'cloned-human' : 'ai-human'
    const layout = String(av(L, 'layout') || 'pip-br')
    const clip = (s.script && s.script.avatarClip) || null
    const prov = (s.data && s.data.avatarProvider) || {}
    const engineText = prov.neuralReady ? `外接神经对口型（${prov.provider || '已连接'}）` : '内置声波口型 / 本地人像合成'
    const body = [
      ui.toggle({ value: enabled, label: '开启数字人 / 克隆分身口播', hint: '输出带透明通道的口播视频，和你的画面同框出镜（支持画中画与绿幕抠像）', onChange: (v) => guard(() => setA(ctx, L, 'enabled', v)) }),
    ]
    if (enabled) {
      body.push(ui.field({ label: '数字人类型', en: 'MODE' }, ui.seg({ value: mode, options: OP('avatarModes'), onChange: (v) => guard(() => setA(ctx, L, 'mode', v)) })))
      if (mode === 'ai-human') body.push(presetField(ctx, L, s))
      else body.push(...clonedFields(ctx, L, s))
      body.push(ui.field({ label: '出镜位置', en: 'LAYOUT', hint: HINTS.layout[layout] || '' }, ui.seg({ value: layout, options: withHints(OP('avatarLayouts'), HINTS.layout), onChange: (v) => guard(() => setA(ctx, L, 'layout', v)) })))
      body.push(chromaField(ctx, L))
      body.push(
        ui.field(
          { label: '口型引擎', en: 'LIP-SYNC', aside: ui.pill(prov.neuralReady ? '神经对口型' : '本地合成', prov.neuralReady ? 'ok' : 'mute', { dot: true, title: engineText }), hint: `当前：${engineText}。出片时会自动合成数字人；想先单独合成看看效果、或接入 MuseTalk / LatentSync 真人对口型，请到「数字人」面板。` },
          ui.row([ui.btn('去合成透明数字人', () => PK.open('avatar', { tab: 'generate' }), { size: 'sm', icon: 'user', title: '在「数字人」面板里一键合成透明通道数字人，并查看合成进度' }), ui.btn('口型引擎配置', () => PK.open('avatar', { tab: 'lipsync' }), { size: 'sm', kind: 'ghost', icon: 'settings', title: '接入外部 MuseTalk / LatentSync 对口型接口' })], { wrap: true }),
        ),
      )
    }
    if (clip && clip.path) {
      body.push(
        ui.item({
          key: 'a60-clip',
          icon: 'user',
          title: '透明通道数字人贴片已生成',
          sub: [clip.providerUsed || 'local', clip.pixFmt || 'yuva420p', U.num(clip.durationSec) > 0 ? secShort(clip.durationSec) : ''].filter(Boolean).join(' · '),
          right: [ui.btn('预览', () => openClip(clip), { size: 'sm', icon: 'play' })],
        }),
      )
      if (clip.visualNotice) body.push(ui.note(String(clip.visualNotice), { level: 'info' }))
    }
    return ui.section({ title: '数字人', en: 'AVATAR', icon: 'user', actions: [ui.btn('打开数字人面板', () => PK.open('avatar'), { size: 'sm', icon: 'user', title: '合成透明数字人、配置外接口型引擎' })] }, ...body)
  }
  function advancedSection(ctx, L) {
    const speed = U.num(rv(L, 'clipSpeedMult'), 1) || 1
    const trimDraft = has(L.drafts, 'trimClipSec') ? L.drafts.trimClipSec : U.num(rv(L, 'trimClipSec'), 0)
    return ui.section(
      { title: '高级参数', en: 'ADVANCED', icon: 'settings', desc: '一般保持默认即可。' },
      ui.field(
        { label: '视频片源播放倍速', en: 'CLIP SPEED', hint: '素材视频整体加速或放慢（1.0× 为原速）' },
        ui.slider({ value: speed, min: Math.min(0.5, speed), max: Math.max(2, speed), step: 0.1, aria: '视频片源播放倍速', format: (v) => `${Number(v).toFixed(2)}×`, onChange: (v) => guard(() => setR(ctx, L, 'clipSpeedMult', Math.round(Number(v) * 100) / 100)) }),
      ),
      ui.field(
        { label: '单段视频最长截取', en: 'TRIM', hint: '每段素材视频最多只用前 N 秒（0 = 不截取，最多 600 秒）' },
        numInput({ key: 'a60-trim', value: trimDraft, min: 0, max: 600, step: 1, unit: '秒', aria: '单段视频最长截取（秒）', dirty: () => has(L.drafts, 'trimClipSec'), onInput: (v) => {
          L.drafts.trimClipSec = v
        }, onCommit: (v) => guard(async () => {
          delete L.drafts.trimClipSec
          if (v === '' || v === null || v === undefined) return refresh(ctx) // emptied box → keep the current value (type 0 to switch trimming off)
          const n = clampInt(v, 0, 600, 0)
          if (Number(v) !== n) PK.toast(`单段截取已调整为 ${n} 秒（范围 0 ~ 600 秒，0 = 不截取）`, 'info')
          await setR(ctx, L, 'trimClipSec', n)
        }) }),
      ),
      ui.toggle({ value: Boolean(rv(L, 'useHostVocal')), label: '优先沿用真人出镜原声', hint: '素材里有真人出镜视频时，用视频原声代替 AI 配音', onChange: (v) => guard(() => setR(ctx, L, 'useHostVocal', v)) }),
      ui.toggle({ value: Boolean(rv(L, 'aiAuthorCode')), label: '允许大模型手写动效源码', hint: '关闭后只用内置版式，出片更快、更稳定', onChange: (v) => guard(() => setR(ctx, L, 'aiAuthorCode', v)) }),
      ui.toggle({ value: dv(L, 'useDraftReference') !== false, label: 'AI 编码出片时参考现有草稿', hint: '沿用已生成草稿的分镜和配音时长作为节奏基准', onChange: (v) => guard(() => setD(ctx, L, 'useDraftReference', v)) }),
      ui.field(
        { label: '素材智能构图与调色', en: 'CURATE', hint: '按当前画面比例、清晰度、风格、截取 / 倍速和抠像设置，用 FFmpeg 批量裁切构图、统一调色（结果在 assets/edited/，原素材不变）。' },
        ui.row([ui.btn('立刻执行 FFmpeg 素材智能构图与调色', () => curate(ctx), { size: 'sm', icon: 'scissors', busyText: '精修中…' })]),
      ),
    )
  }

  /* ---------------------------------------------------------------- production (run / plan / produce / ai-produce) */
  /** the classic handlePlanLocalDraft / handleAiCodingProduce payload, built from the host's brief + the raw script */
  function buildBody(ctx, s, kind) {
    const d = D()
    const script = (s && s.script) || {}
    const topic = String(d.topic || '').trim()
    const custom = d.quality === 'custom' || d.aspectRatio === 'custom'
    const outline = (Array.isArray(d.contentOutline) ? d.contentOutline : []).map((x) => String(x || '').trim()).filter(Boolean)
    const body = {
      topic: topic || String(script.title || '') || (kind === 'ai-produce' ? '' : '个人品牌介绍'),
      userPrompt: topic || String(script.goal || ''),
      goal: topic || String(script.goal || ''),
      displayTitle: d.displayTitle || undefined,
      genre: d.genre || undefined,
      genreLabel: d.genreLabel || undefined,
      directorNotes: d.directorNotes || undefined,
      contentOutline: outline.length ? outline : undefined,
      style: d.style,
      engine: d.engine,
      aspectRatio: d.aspectRatio,
      quality: d.quality,
      width: custom ? U.num(d.customWidth, 1080) : undefined,
      height: custom ? U.num(d.customHeight, 1920) : undefined,
      aiBadge: Boolean(d.aiBadgeEnabled),
      aiBadgeEnabled: Boolean(d.aiBadgeEnabled),
      aiBadgePosition: d.aiBadgePosition || 'top-right',
      aiBadgeText: d.aiBadgeText || '',
      pacingMode: d.pacingMode || 'auto',
      durationMode: d.durationMode === 'custom' ? 'custom' : 'auto',
      targetDurationSec: d.durationMode === 'custom' ? clampInt(d.targetDurationSec, 15, 600, 120) : 0,
      visual3dMode: d.visual3dMode || 'auto',
      visualReview: d.visualReview !== false,
      figureStyleChoice: d.figureStyleChoice || 'auto',
      figureStyleChoiceNote: d.figureStyleChoiceNote || '',
      narrationMode: d.narrationMode || 'tts',
      bgmMode: d.bgmMode,
      targetPlatform: d.targetPlatform,
      fps: d.fps,
      voiceId: d.voiceId,
    }
    const sa = ctx && ctx.local && ctx.local['s:assets']
    const src = sa && sa.__dir === PK.dir() ? parseSources(sa.pathDraft) : undefined
    if (src) body.sources = src
    if (kind === 'produce') body.async = true
    if (kind === 'ai-produce') {
      Object.assign(body, {
        async: true,
        creationMode: d.creationMode === 'fast-draft' ? 'local-draft' : 'ai-coded',
        bgmTtsPrompt: d.bgmTtsPrompt || '',
        useDraftReference: d.useDraftReference !== false,
        render: true,
      })
    }
    return body
  }
  function goStep(id, dir) {
    if (dir && dir !== PK.dir()) return
    const c = REF.ctx
    if (c && !c.frame.closed && REF.go) REF.go(id)
    else PK.toast('结果已更新，可以在「分步精修」里查看', 'info', { action: { label: '打开分步精修', onClick: () => PK.open('studio', { step: id }) } })
  }
  async function runJob(kind, label, start, finish) {
    PK.needProject()
    if (JOB.cur && JOB.cur.status === 'running') throw new PK.Error(`「${JOB.cur.label}」还在进行中，请等它完成后再试`)
    const j = (JOB.cur = { kind, label, dir: PK.dir(), progress: 3, message: '正在启动…', startedAt: Date.now(), status: 'running', error: '', resultText: '', next: '' })
    PK.emit('a60:job', j, 'status')
    const upd = (p, m) => {
      const np = U.clamp(U.num(p, j.progress), 0, 100)
      const nm = m ? String(m) : j.message
      if (np === j.progress && nm === j.message) return
      j.progress = np
      j.message = nm
      PK.emit('a60:job', j, 'progress')
    }
    try {
      const res = await start(upd)
      j.status = 'done'
      j.progress = 100
      j.message = '已完成'
      await finish(res, j)
    } catch (err) {
      j.status = 'error'
      j.error = String((err && err.message) || err || '任务失败')
      PK.emit('a60:job', j, 'status')
      throw err
    }
    PK.emit('a60:job', j, 'status')
    return j
  }
  async function doRun(ctx) {
    PK.needProject()
    await settle(ctx) // the host starts the run from its own form: let the edit just made land there first
    const d = D()
    if ((d.creationMode || 'ai-coded') === 'ai-coded' && !llmReady()) return needLlm('尚未配置 AI 大模型接口：请先填入 API Key，或把创作模式切换为「本地极速草稿」再一键出片')
    const topic = String(d.topic || '')
    if (!topic.trim()) {
      const title = (st().project && st().project.title) || '未命名工程'
      const ok = await PK.confirm({ title: '还没写创意需求', text: `没有创意需求时，AI 会按工程标题「${title}」和你的素材自由发挥。也可以先写一句需求再出片。`, ok: '直接出片', cancel: '先写需求' })
      if (!ok) {
        guard(() => PK.editTopic())
        return undefined
      }
    }
    if (!(await act('run', { topic }, { timeout: 180000 }))) return undefined // the host toasted why it did not start
    ctx.close() // the war room shows the 8 agents working
    return undefined
  }
  async function doPlan(ctx, s) {
    PK.needProject()
    await settle(ctx)
    await runJob(
      'plan',
      '本地草稿分镜',
      async (upd) => {
        upd(12, '正在快速构建本地导演剧本草稿…')
        return PK.postP('plan', buildBody(ctx, s, 'plan'), { timeout: 900000 })
      },
      async (res, j) => {
        const n = U.num(res && res.sceneCount, 0) || ((res && res.script && res.script.scenes) || []).length
        j.resultText = `已生成 ${n} 幕分镜剧本草稿，可以去「分镜精修」预览和修改。`
        j.next = 'scenes'
        PK.toast(`已生成 ${n} 幕剧本草稿，先去「分镜精修」预览一下吧`, 'success')
        goStep('scenes', j.dir)
      },
    )
  }
  async function doProduce(ctx, s) {
    PK.needProject()
    await settle(ctx)
    await runJob(
      'produce',
      '本地演练成片',
      async (upd) => {
        upd(6, '正在快速生成本地草稿成片（含配音与 MP4）…')
        const init = await PK.postP('produce', buildBody(ctx, s, 'produce'))
        return init && init.jobId ? PK.job(init.jobId, { onProgress: (job) => upd(job.progress, job.message) }) : init
      },
      async (res, j) => {
        await PK.action('refresh', {}).catch(() => {})
        const sc = res && res.script
        j.resultText = `本地演练成片已输出${sc && sc.width ? `（${sc.width}×${sc.height}）` : ''}，可以在「交付」里预览和导出。`
        j.next = 'delivery'
        PK.toast(`本地演练成片已输出${sc && sc.width ? `（${sc.width}×${sc.height}）` : ''}`, 'success')
        goStep('delivery', j.dir)
      },
    )
  }
  async function doAiProduce(ctx, s) {
    PK.needProject()
    if (!llmReady()) return needLlm('请先配置您的大模型接口，再启动 AI 编码出片')
    await settle(ctx)
    await runJob(
      'ai-produce',
      'AI 编码出片',
      async (upd) => {
        upd(6, `大模型（${llmLabel() || 'AI'}）正在编写动画源码与音轨并渲染…`)
        const init = await PK.postP('ai-produce', buildBody(ctx, s, 'ai-produce'))
        return init && init.jobId ? PK.job(init.jobId, { onProgress: (job) => upd(job.progress, job.message) }) : init
      },
      async (res, j) => {
        await PK.action('refresh', {}).catch(() => {})
        const rounds = U.num(res && res.buildLog && res.buildLog.repairRoundsUsed, 0)
        j.resultText = `大模型 AI 编码出片完成（自动修复 ${rounds} 轮），可以在「交付」里预览和导出。`
        j.next = 'delivery'
        PK.toast(`大模型 AI 编程出片完成（修复轮次 ${rounds}）`, 'success')
        goStep('delivery', j.dir)
      },
    )
    return undefined
  }
  function jobNote(j) {
    const pct = U.clamp(U.num(j.progress), 0, 100)
    if (j.status === 'running') {
      return ui.note(ui.meter(pct, { label: j.message || '处理中…', valueText: `${Math.round(pct)}% · ${U.fmtDur((Date.now() - j.startedAt) / 1000)}`, indeterminate: j.kind === 'plan' }), {
        level: 'info',
        title: `「${j.label}」进行中 · 关掉窗口也会在后台继续`,
      })
    }
    if (j.status === 'done') {
      return ui.note(j.resultText || '已完成', {
        level: 'ok',
        title: `「${j.label}」已完成`,
        actions: [
          j.next ? ui.btn(j.next === 'scenes' ? '去分镜精修' : '去交付', () => goStep(j.next), { size: 'sm', kind: 'primary', icon: 'arrowR' }) : null,
          ui.btn('收起', () => {
            JOB.cur = null
            PK.emit('a60:job', null, 'status')
          }, { size: 'sm', kind: 'ghost' }),
        ],
      })
    }
    return ui.note(j.error || '任务失败', {
      level: 'error',
      title: `「${j.label}」失败`,
      actions: [ui.btn('知道了', () => {
        JOB.cur = null
        PK.emit('a60:job', null, 'status')
      }, { size: 'sm' })],
    })
  }
  /** progress ticks patch the job card + footer pill in place (no full re-render while a job runs) */
  function patchJobDom(ctx) {
    const j = JOB.cur
    if (!j || j.status !== 'running' || j.dir !== PK.dir() || ctx.local.step !== 'director') return false
    const box = ctx.frame.body.querySelector('[data-a60job]')
    if (!box) return false
    PK.clear(box)
    box.appendChild(jobNote(j))
    const foot = ctx.frame.foot && ctx.frame.foot.querySelector('[data-a60jobfoot]')
    if (foot) {
      PK.clear(foot)
      foot.appendChild(ui.pill(`${j.label} · ${Math.round(j.progress)}%`, 'acc', { dot: true, title: j.message }))
    }
    return true
  }
  function produceSection(ctx, L, s) {
    const d = D()
    const live = runLive()
    const job = JOB.cur && JOB.cur.dir === PK.dir() ? JOB.cur : null
    const lock = live || Boolean(job && job.status === 'running')
    const sa = ctx.local['s:assets']
    const pathSrc = sa && sa.__dir === PK.dir() ? String(sa.pathDraft || '').trim() : ''
    const modeLabel = PK.optionLabel('creationModes', d.creationMode, d.creationMode === 'fast-draft' ? '本地极速草稿' : '大模型编码大片')
    const opt = (btn, hint) => ui.stack([btn, ui.hint(hint)], { gap: 4 })
    return ui.section(
      { title: '开始出片', en: 'PRODUCE', icon: 'bolt', desc: '按上面的设定出片。拿不准就先做免费的本地草稿，看看分镜再决定。' },
      live ? ui.note('当前工程已经有出片任务在运行，完成或停止后才能再次出片。', { level: 'info', actions: [ui.btn('打开任务中心', () => PK.open('tasks'), { size: 'sm', icon: 'tasks' })] }) : null,
      job ? h('div', { 'data-a60job': '1' }, jobNote(job)) : null,
      pathSrc ? ui.note(`出片时会一并导入你在「素材」页填写的本机路径：${pathSrc}`, { level: 'info' }) : null,
      opt(ui.btn('一键出片', () => doRun(ctx), { kind: 'primary', size: 'lg', block: true, icon: 'bolt', disabled: lock, busyText: '启动中…' }), `8 位 AI Agent 全自动完成分镜、配音、配乐、动效与渲染（当前创作模式：${modeLabel}）。`),
      pair(
        opt(ui.btn('本地草稿分镜', () => doPlan(ctx, s), { block: true, icon: 'list', disabled: lock, busyText: '生成中…' }), '免费 · 只生成分镜剧本，马上去「分镜精修」预览和修改。'),
        opt(ui.btn('本地演练成片', () => doProduce(ctx, s), { block: true, icon: 'film', disabled: lock, busyText: '出片中…' }), '免费 · 用本地配音和渲染出一版草稿 MP4（需要几分钟）。'),
      ),
      opt(
        ui.btn(llmReady() ? 'AI 编码出片' : '先配置大模型 → AI 编码出片', () => doAiProduce(ctx, s), { block: true, icon: 'sparkle', disabled: lock, busyText: '编码中…' }),
        llmReady() ? `大模型（${llmLabel()}）为每一幕手写动效代码并渲染成片，会消耗模型额度。` : 'AI 编码出片需要先在「设置 · 模型与密钥」连接大模型。',
      ),
    )
  }
  function renderDirector(ctx, s) {
    const L = scope(s)
    const W = hook(ctx, s)
    if (!s.project) {
      ctx.foot([ui.spacer(), ui.btn('新建 / 打开工程', () => PK.open('projects'), { kind: 'primary', icon: 'folder' })])
      W.sig = signature(ctx)
      return ui.empty({ icon: 'folder', title: '还没有打开视频工程', text: '先新建或打开一个工程，再设置导演参数。', actions: [ui.btn('新建 / 打开工程', () => PK.open('projects'), { kind: 'primary' })] })
    }
    const job = JOB.cur && JOB.cur.dir === PK.dir() && JOB.cur.status === 'running' ? JOB.cur : null
    ctx.foot([
      ui.btn('上一步：素材', () => s.go('assets'), { kind: 'ghost', icon: 'chevL' }),
      job ? h('span', { 'data-a60jobfoot': '1' }, ui.pill(`${job.label} · ${Math.round(job.progress)}%`, 'acc', { dot: true, title: job.message })) : null,
      ui.spacer(),
      ui.btn('下一步：分镜精修', () => s.go('scenes'), { icon: 'arrowR' }),
      ui.btn('一键出片', () => doRun(ctx), { kind: 'primary', icon: 'bolt', disabled: runLive() || Boolean(job), busyText: '启动中…' }),
    ])
    W.sig = signature(ctx)
    return ui.split(
      [briefSection(ctx, L), workSection(ctx, L), durationSection(ctx, L), styleSection(ctx, L, s), bgmSection(ctx, L, s)],
      [formatSection(ctx, L, s), voiceSection(ctx, L, s), avatarSection(ctx, L, s), advancedSection(ctx, L), produceSection(ctx, L, s)],
      { ratio: 'minmax(0, 1.08fr) minmax(0, 1fr)' },
    )
  }

  /* ---------------------------------------------------------------- registration */
  PK.studioStep('assets', { label: '素材', en: 'ASSETS', icon: 'image', order: 10, render: (ctx, s) => renderAssets(ctx, s) })
  PK.studioStep('director', { label: '导演参数', en: 'DIRECTOR', icon: 'wand', order: 20, render: (ctx, s) => renderDirector(ctx, s) })
  // read-only inspection handle (tests / skin authors): current background job and the payload a production button would send
  PK.studioAssets = {
    job: () => (JOB.cur ? { ...JOB.cur } : null),
    payload: (kind) => (REF.s ? buildBody(REF.ctx, REF.s, kind || 'plan') : null),
  }
})()
