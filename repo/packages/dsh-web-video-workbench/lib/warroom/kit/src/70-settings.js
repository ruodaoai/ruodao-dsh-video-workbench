/* ============================================================================================================
 * PK · 设置与引擎 (panel agent C) — five native panels, behaviour ported from the deleted classic UI
 * (.tmp/kit-ref/client.classic.js), never its look:
 *   keys      设置 · 模型与密钥  llmHubContent · ttsHubContent · cloudHubContent (keys/presets) · 低配保护偏好
 *   voices    配音中心          voiceModal (音色库 + 3 步克隆工坊) · voices/import · voices/match · voices/delete
 *   cloud     云端媒体中心       cloudHubContent (生成 + AI 提示词助手 + 预览验收区 staging)
 *   avatar    数字人            step2 数字人卡片 · 引擎接口配置 · pro-tools 口型引擎 (状态 / 深度检测 / 一键安装)
 *   hardware  算力体检          hardwareModal (硬件档案 · 低配保护 · Vibecoding 工具链 · 配置要求)
 * Secrets: the backend only ever returns masked keys. An untouched key field is sent as KEEP_EXISTING (or left out),
 * so saving never overwrites a stored key, and no stored key is ever shown unmasked.
 * Long-running work (installs, cloud generation, avatar synthesis) is tracked by a module-level job registry, so
 * progress survives closing and re-opening a panel.
 * ============================================================================================================ */
;(function () {
  'use strict'
  const PK = window.PK
  if (!PK || typeof PK.panel !== 'function') return
  const U = PK.util
  const h = PK.h
  const ui = PK.ui
  const KEEP = 'KEEP_EXISTING'

  /* ================================================================================================ helpers */
  const S = (v) => (v === undefined || v === null ? '' : String(v))
  const st = () => PK.state || {}
  const llmReady = () => Boolean(st().status && st().status.llm && st().status.llm.configured)
  const activeScript = (data) => (data && data.activeProject && data.activeProject.script) || null
  const sceneList = (data) => {
    const s = activeScript(data)
    return s && Array.isArray(s.scenes) ? s.scenes : []
  }
  const projectAssets = (data) => (data && data.activeProject && Array.isArray(data.activeProject.assets) ? data.activeProject.assets : [])
  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b)
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
  const pad2 = (n) => String(n).padStart(2, '0')
  const isLocalUrl = (u) => /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])/i.test(S(u).trim())
  /** network-level failures (service not running, wrong address, no network) → a fix-it sentence for beginners */
  const NET_ERR = /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|socket hang up|network error|getaddrinfo/i
  const friendlyErr = (err, what, fallback) => {
    const m = S(err && err.message) || fallback || '未知错误'
    return NET_ERR.test(m) ? `连接不上${what}：请检查地址是否填对、服务是否已经启动、网络或代理是否可用。（技术信息：${m}）` : m
  }
  const flex1 = (node) => h('div', { style: { flex: '1 1 auto', minWidth: 0 } }, node)
  /** form-field grid: like ui.grid but auto-fit, so the fields share the whole row instead of leaving empty tracks */
  const fgrid = (kids, o) => {
    const g = ui.grid(kids, o)
    g.style.gridTemplateColumns = 'repeat(auto-fit, minmax(min(var(--pk-min, 220px), 100%), 1fr))'
    return g
  }
  /**
   * The core ui.textarea stacks its character counter under the ⤢ button, on top of the end of the 2nd text line (the box
   * only reserves 34 px for the button) → long prompts hide characters behind the counter. Move the live counter below the
   * box instead (the primitive keeps updating the same node, skins keep styling `.pk-ta-count`).
   */
  const countBelow = (wrap) => {
    const c = wrap && wrap.querySelector('.pk-ta-tools > .pk-ta-count')
    if (c) {
      Object.assign(c.style, { alignSelf: 'flex-end', marginTop: '4px' })
      wrap.appendChild(c)
    }
    return wrap
  }

  /** Long single-line value (URL, model ID, path …) that wraps instead of being clipped. Enter never inserts a newline. */
  function lineField(o = {}) {
    let w = null
    w = ui.textarea({
      key: o.key,
      value: S(o.value),
      placeholder: o.placeholder,
      rows: 1,
      minRows: 1,
      maxRows: o.maxRows || 5,
      mono: o.mono !== false,
      expand: false,
      disabled: o.disabled,
      aria: o.aria || o.placeholder,
      onInput: (v) => {
        if (/[\r\n]/.test(v)) {
          v = v.replace(/[\r\n]+/g, '')
          if (w) w.setValue(v)
        }
        if (o.onInput) o.onInput(v)
      },
      onChange: (v) => {
        if (o.onChange) o.onChange(S(v).replace(/[\r\n]+/g, ''))
      },
    })
    w.classList.add('pk-ta--line')
    w.textarea.style.resize = 'none'
    w.textarea.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.isComposing) {
        ev.preventDefault()
        if (o.onEnter) o.onEnter(w.textarea.value)
      }
    })
    return w
  }

  /**
   * Secret input. The saved key is never shown — only its masked form as a hint. The eye button reveals what the user
   * typed in this session (as a wrapping field, so a long key is fully readable).
   */
  function secretField(ctx, o) {
    const rv = (ctx.local.reveal = ctx.local.reveal || {})
    const shown = Boolean(rv[o.key])
    const ph = o.saved ? `已加密保存${o.masked ? `（${o.masked}）` : ''} · 不修改请留空` : o.placeholder || '粘贴密钥'
    let ctl
    if (shown) ctl = lineField({ key: o.key, value: o.value, placeholder: ph, onInput: o.onInput, aria: o.aria || ph })
    else {
      ctl = ui.input({ key: o.key, type: 'password', value: S(o.value), placeholder: ph, onInput: o.onInput, autocomplete: 'new-password', aria: o.aria || ph, title: false })
      ctl.addEventListener('input', () => {
        ctl.title = ''
      })
    }
    const eye = ui.iconBtn('eye', () => {
      rv[o.key] = !shown
      ctx.render()
    }, { title: shown ? '隐藏输入内容' : '显示我刚输入的内容（已保存的密钥不会显示）', class: shown ? 'is-on' : '' })
    return ui.row([flex1(ctl), eye], { wrap: false, top: true })
  }

  /** Button whose busy state survives panel re-renders (prevents double submits while a request is in flight). */
  function actBtn(ctx, key, label, fn, o = {}) {
    const B = (ctx.local.busy = ctx.local.busy || {})
    const busy = Boolean(B[key])
    const b = ui.btn(
      busy ? o.busyText || '处理中…' : label,
      busy
        ? null
        : async () => {
            B[key] = true
            ctx.update()
            try {
              return await fn()
            } finally {
              B[key] = false
              ctx.update()
            }
          },
      { ...o, disabled: Boolean(o.disabled) || busy, key: o.key || `act-${key}` },
    )
    if (busy) b.setAttribute('aria-busy', 'true')
    return b
  }

  const confirmedOnce = new Set()
  async function confirmOnce(key, opts) {
    if (confirmedOnce.has(key)) return true
    const ok = await PK.confirm(opts)
    if (ok) confirmedOnce.add(key)
    return ok
  }

  /** Ask the host to re-read everything (used after background jobs finish — the job POST itself refreshed too early). */
  const hostRefresh = () => PK.action('refresh', {}).catch(() => {})

  /* -------------------------------------------------------------------------------- background job registry */
  const JOBS = new Map() // slot → { slot, label, state: running|done|error, pct, msg, log[], startedAt, result, error }
  const jobHosts = new Set()
  function jobsChanged(stateChanged) {
    for (const el of [...jobHosts]) {
      if (!el.isConnected) jobHosts.delete(el)
      else paintJob(el)
    }
    if (stateChanged) PK.emit('settings:jobs')
  }
  const jobRunning = (slot) => {
    const j = JOBS.get(slot)
    return Boolean(j && j.state === 'running')
  }
  /**
   * Start a backend job (`start()` must POST and resolve to `{ jobId }`), poll it until it ends and keep its
   * progress in JOBS. Resolves with the job result, rejects with PK.Error.
   */
  async function startJob(slot, o) {
    if (jobRunning(slot)) throw new PK.Error(`「${JOBS.get(slot).label}」正在进行中，请等待完成`)
    const j = { slot, label: o.label, state: 'running', pct: 2, msg: o.startText || '正在提交…', log: o.startText ? [o.startText] : [], startedAt: Date.now(), result: null, error: '' }
    JOBS.set(slot, j)
    jobsChanged(true)
    try {
      const init = await o.start()
      const jobId = init && (init.jobId || (init.job && init.job.id))
      if (!jobId) throw new PK.Error(S(init && (init.error || init.message)) || '后台任务没有启动，请重试')
      j.jobId = jobId
      if (init.job && init.job.message) {
        j.msg = S(init.job.message)
        j.log.push(j.msg)
      }
      jobsChanged(false)
      const result = await PK.job(jobId, {
        interval: o.interval || 1200,
        maxMs: o.maxMs || 4 * 3600 * 1000,
        onProgress: (job) => {
          const msg = S(job && job.message).trim()
          if (msg && msg !== j.msg) {
            j.log.push(msg)
            if (j.log.length > 80) j.log.splice(0, j.log.length - 80)
            j.msg = msg
          }
          const p = U.num(job && job.progress, j.pct)
          if (p > 0) j.pct = U.clamp(p, 0, 100)
          jobsChanged(false)
        },
      })
      if (result && result.ok === false) throw new PK.Error(S(result.error || result.message) || '任务没有完成')
      j.state = 'done'
      j.pct = 100
      j.result = result
      if (result && Array.isArray(result.logs) && result.logs.length) j.log = result.logs.map(S).slice(-40)
      j.msg = typeof o.doneText === 'function' ? o.doneText(result) : o.doneText || '已完成'
      jobsChanged(true)
      return result
    } catch (err) {
      j.state = 'error'
      j.error = S(err && err.message) || '任务失败'
      j.msg = j.error
      j.log.push(`错误：${j.error}`)
      jobsChanged(true)
      throw err
    }
  }
  function paintJob(el) {
    const j = JOBS.get(el.getAttribute('data-pk-job'))
    PK.clear(el)
    if (!j) {
      el.hidden = true
      return
    }
    el.hidden = false
    const elapsed = U.fmtDur((Date.now() - j.startedAt) / 1000)
    const tone = j.state === 'error' ? 'err' : j.state === 'done' ? 'ok' : ''
    const label = j.state === 'running' ? `${j.label} · 进行中 · 已用 ${elapsed}` : j.state === 'done' ? `${j.label} · 已完成` : `${j.label} · 未完成`
    PK.append(
      el,
      ui.meter(j.state === 'error' ? 100 : j.pct, { label, valueText: j.state === 'error' ? '失败' : `${Math.round(j.pct)}%`, tone, indeterminate: j.state === 'running' && j.pct <= 3 }),
      j.msg ? ui.text(j.msg, { tone: j.state === 'error' ? null : 'muted', class: j.state === 'error' ? 'pk-text--err' : '' }) : null,
      el.getAttribute('data-log') !== 'off' && j.log.length > 1
        ? ui.log(j.log.slice(-16).map((t) => ({ text: t, level: /错误|失败|error|failed/i.test(t) ? 'error' : /警告|warn/i.test(t) ? 'warn' : 'info' })), { class: 'pk-settings-joblog' })
        : null,
      j.state !== 'running'
        ? ui.row([ui.spacer(), ui.btn('收起进度', () => {
            JOBS.delete(j.slot)
            jobsChanged(true)
          }, { size: 'sm', kind: 'ghost' })])
        : null,
    )
  }
  /** Self-updating progress view of one job slot (repaints itself, the panel does not re-render on every poll). */
  function jobView(slot, o = {}) {
    const el = h('div.pk-stack.pk-settings-job', { 'data-pk-job': slot, 'data-log': o.log === false ? 'off' : null, role: 'status' })
    paintJob(el)
    jobHosts.add(el)
    return el
  }

  /* ============================================================================ low-spec protection (shared) */
  const LOWSPEC_MODES = [
    { id: 'auto', title: '智能自适应（推荐）', icon: 'sparkle', desc: '空闲内存 < 3.6GB 或 8GB / 核显机器自动降并发、轻缓存护航；高配机器满血运行。' },
    { id: 'safe', title: '强制低配保护', icon: 'lock', desc: '单并发渲染 · 128MB 轻缓存 · 3D 粒子减载 · FFmpeg 限核防卡死 · 最高 1080p30。' },
    { id: 'performance', title: '全速性能模式', icon: 'bolt', desc: '解除保护限流，允许 2K / 4K 60fps 与多并发极速出片（推荐 16GB+ 内存）。' },
  ]
  const lowSpecLabel = (id) => (LOWSPEC_MODES.find((m) => m.id === id) || LOWSPEC_MODES[0]).title.replace(/（.*）/, '')
  const policyLine = (p) => {
    if (!p) return ''
    const reason = S(p.reason)
    const parts = [
      reason || '—',
      /Remotion\s*\d/.test(reason) ? '' : `Remotion ${U.num(p.remotionConcurrency, 1)} 并发`,
      `视频缓存 ${Math.round(U.num(p.offthreadVideoCacheSizeInBytes) / 1048576)}MB`,
      `FFmpeg ${S(p.ffmpegPreset) || '—'}`,
      p.effectiveQuality ? `实际导出 ${p.effectiveQuality}${p.effectiveFps ? ` ${p.effectiveFps}fps` : ''}` : '',
    ]
    return parts.filter(Boolean).join(' · ')
  }
  async function setLowSpecMode(mode) {
    const d = st().director || {}
    const res = await PK.post('hardware', { lowSpecMode: mode, quality: d.quality || '1080p', fps: U.num(d.fps, 30) || 30, forceRefresh: true }, { timeout: 120000 })
    PK.toast(`算力模式已更新：${S(res && res.hardwarePolicy && res.hardwarePolicy.reason) || lowSpecLabel(mode)}`, 'success')
    return res
  }
  function lowSpecCards(ctx, prefs, policy, onSaved) {
    const cur = S(prefs && prefs.lowSpecMode) || 'auto'
    const busy = ctx.local.busy && ctx.local.busy.lowspec
    return h(
      'div.pk-stack',
      null,
      ui.grid(
        LOWSPEC_MODES.map((m) =>
          ui.card({
            key: `lowspec-${m.id}`,
            title: m.title,
            body: ui.text(m.desc, { tone: 'muted' }),
            active: cur === m.id,
            tags: cur === m.id ? [ui.pill('当前', 'acc', { dot: true })] : null,
            onClick:
              cur === m.id || busy
                ? null
                : async () => {
                    const B = (ctx.local.busy = ctx.local.busy || {})
                    B.lowspec = true
                    ctx.update()
                    try {
                      const res = await setLowSpecMode(m.id)
                      if (onSaved) onSaved(res)
                    } catch (err) {
                      PK.reportError(err, '切换算力模式失败')
                    } finally {
                      B.lowspec = false
                      ctx.update()
                    }
                  },
          }),
        ),
        { min: 210 },
      ),
      busy ? ui.spinner('正在切换并重新检测本机算力…') : null,
      policy ? ui.note(policyLine(policy), { level: policy.lowSpecSafe ? 'warn' : 'info', title: '当前生效的算力调度' }) : null,
    )
  }

  /* ======================================================================================= 设置 · 模型与密钥 */
  const KEY_TABS = ['llm', 'tts', 'cloud', 'general']
  const WIRE_CARDS = [
    { id: 'auto', title: '自动识别', path: '按地址自动判断', tag: '不确定就选它', desc: '根据 API 地址与模型名自动选择协议；跟随 DSH 时沿用该通道的协议。' },
    { id: 'openai-completions', title: 'OpenAI 兼容 Chat', path: '/v1/chat/completions', tag: '通用首选 / 中转站', desc: 'DeepSeek、Qwen、硅基流动及绝大多数 API 中转。' },
    { id: 'anthropic-messages', title: 'Anthropic 原生 Messages', path: '/v1/messages', tag: 'Claude 专属', desc: '直连 Claude Opus / Sonnet 原生协议头。' },
    { id: 'openai-responses', title: 'OpenAI Responses', path: '/v1/responses', tag: 'OpenAI 新一代', desc: '官方 GPT Reasoning / Responses 新规范接口。' },
    { id: 'gemini-native', title: 'Gemini 原生 Generate', path: '/v1beta/models', tag: 'Google 直连', desc: 'Google Gemini 原生流式与多模态通道。' },
  ]
  const protoLabel = (id) => {
    const c = WIRE_CARDS.find((x) => x.id === id)
    return c ? c.title : S(id) || '自动'
  }

  /* ---- LLM draft */
  const customKeySaved = (cfg) => Boolean(cfg && cfg.mode === 'custom' && cfg.hasApiKey)
  function llmDraftFrom(cfg = {}) {
    const dsh = cfg.dshClient || {}
    const templates = Array.isArray(cfg.templates) ? cfg.templates : []
    // auto = follow the agent hosting the plugin (DSH channel inside DSH, the agent's environment API key elsewhere)
    const mode = cfg.mode === 'custom' ? 'custom' : cfg.mode === 'follow-dsh' ? 'follow-dsh' : 'auto'
    const follow = mode === 'follow-dsh'
    const dshId = cfg.dshProviderId || 'active'
    // following DSH's *current default* with its default model → keep the model empty so it keeps following
    const followsDefaultModel = follow && dshId === 'active' && cfg.model && cfg.model === dsh.defaultModelId
    // following DSH: the summary reports the *effective* protocol; when that is just the channel's own protocol keep
    // 「自动识别」 so saving does not pin it (switching the DSH channel later then still uses the right protocol)
    const provs = Array.isArray(dsh.providers) ? dsh.providers : []
    const chanProto = dshId === 'active' ? dsh.defaultProtocol : S((provs.find((p) => p.id === dshId) || {}).api)
    const followsChannelProto = follow && cfg.format && cfg.format === chanProto
    return {
      mode,
      dshProviderId: dshId,
      provider: templates.some((t) => t.id === cfg.provider) ? cfg.provider : 'custom',
      format: mode === 'auto' || followsChannelProto ? 'auto' : cfg.format || 'auto',
      baseUrl: S(cfg.baseUrl),
      apiKey: '',
      model: mode === 'auto' || followsDefaultModel ? '' : S(cfg.model),
      maxRepairRounds: U.clamp(U.num(cfg.maxRepairRounds, 3) || 3, 1, 5),
    }
  }
  const llmPayload = (cfg, f) => ({
    mode: f.mode === 'custom' ? 'custom' : f.mode === 'follow-dsh' ? 'follow-dsh' : 'auto',
    dshProviderId: S(f.dshProviderId) || 'active',
    provider: S(f.provider) || 'custom',
    format: S(f.format) || 'auto',
    baseUrl: S(f.baseUrl).trim(),
    apiKey: S(f.apiKey).trim() || (customKeySaved(cfg) ? KEEP : ''),
    model: S(f.model).trim(),
    maxRepairRounds: U.clamp(U.num(f.maxRepairRounds, 3) || 3, 1, 5),
  })

  /* ---- TTS drafts */
  const DEFAULT_TTS_ENGINES = [
    { id: 'indextts25', builtin: true, kind: 'indextts25', name: 'IndexTTS-2.5 (高保真情感克隆)', shortName: 'IndexTTS-2.5', vramBadge: '推荐 8GB+ 显存', description: '支持零样本音色克隆、情感语音参考及 Qwen 情绪指令控制，音质细腻。', endpoint: 'http://127.0.0.1:9880' },
    { id: 'indextts2', builtin: true, kind: 'indextts2', name: 'IndexTTS-2 (经典本地版本)', shortName: 'IndexTTS-2', vramBadge: '6–8GB 显存', description: '兼容旧版 cy_app / IndexTTS-2 HTTP 与本地推理入口。', endpoint: 'http://127.0.0.1:9880' },
    { id: 'gptvoice', builtin: true, kind: 'gptvoice', name: 'GPT-SoVITS (低显存轻量克隆)', shortName: 'GPT-SoVITS', vramBadge: '4GB+ 显存 · 低配友好', description: '专为低显存 / 中低配显卡优化的轻量配音与音色克隆方案，兼容 api_v2.py 与 v1 接口。', endpoint: 'http://127.0.0.1:9881' },
    { id: 'minimax-tts', builtin: true, kind: 'minimax-tts', name: 'MiniMax Speech 云端情感语音 (T2A v2)', shortName: 'MiniMax 云端语音', vramBadge: '0GB 显存 · 云端高表现力', description: '支持 speech-2.6-hd / speech-02-hd 及任意自定义模型 ID，无需本地显卡即可合成多情绪中文配音。', endpoint: 'https://api.minimaxi.com/v1/t2a_v2' },
    { id: 'doubao-tts', builtin: true, kind: 'doubao-tts', name: '火山方舟 · 豆包语音大模型 TTS', shortName: '豆包云端语音', vramBadge: '0GB 显存 · 火山引擎云端', description: '直连火山引擎 / 豆包语音合成 HTTP 接口，支持 AppID + Token + 自定义音色 voice_type。', endpoint: 'https://openspeech.bytedance.com/api/v1/tts' },
  ]
  const DEFAULT_TTS_TEMPLATES = [
    { templateId: 'edge-tts-cpu', label: 'Edge-TTS (零显卡纯 CPU 命令行)', engine: { id: 'edge-tts-cpu', name: 'Edge-TTS 轻量旁白 (纯CPU零显存)', kind: 'cli-command', vramBadge: '0GB 显存 · 纯CPU', command: 'edge-tts', argsTemplate: '--text {{text}} --voice {{voice}} --write-media {{output}}', defaultVoice: 'zh-CN-YunxiNeural', outputExt: '.mp3' } },
    { templateId: 'fish-speech-openai', label: 'Fish Speech / OpenAI /v1/audio/speech', engine: { id: 'fish-speech-openai', name: 'Fish Speech / OpenAI TTS 接口', kind: 'openai-tts', vramBadge: '云端或本机 API', endpoint: 'http://127.0.0.1:8080/v1/audio/speech', model: 'fish-speech-1.5', voice: 'default', responseFormat: 'wav', speed: 1.0 } },
    { templateId: 'kokoro-openai', label: 'Kokoro-FastAPI (超轻量本地 / CPU)', engine: { id: 'kokoro-openai', name: 'Kokoro 82M 超轻量语音', kind: 'openai-tts', vramBadge: 'CPU / <2GB 显存', endpoint: 'http://127.0.0.1:8880/v1/audio/speech', model: 'kokoro', voice: 'zf_xiaoxiao', responseFormat: 'wav', speed: 1.0 } },
    { templateId: 'cosyvoice-http', label: 'CosyVoice / ChatTTS 通用 HTTP JSON', engine: { id: 'cosyvoice-http', name: 'CosyVoice / 自定义 HTTP 模型', kind: 'http-json', vramBadge: '自定义 HTTP', endpoint: 'http://127.0.0.1:9882/tts', method: 'POST', responseType: 'binary', responseAudioPath: 'audio', payloadTemplate: { text: '{{text}}', voice: '{{voiceName}}', lang: '{{lang}}', speed: '{{speed}}', ref_audio: '{{refAudio}}', prompt_text: '{{promptText}}' } } },
  ]
  const normTts = (cfg) => {
    const c = cfg && typeof cfg === 'object' ? cfg : {}
    return {
      ...c,
      activeEngineId: c.activeEngineId || 'indextts25',
      engines: Array.isArray(c.engines) && c.engines.length ? c.engines : DEFAULT_TTS_ENGINES,
      templates: Array.isArray(c.templates) && c.templates.length ? c.templates : DEFAULT_TTS_TEMPLATES,
    }
  }
  const engLabel = (e) => (e && (e.shortName || e.name || e.id)) || '—'
  function ttsBuiltinFrom(cfg) {
    const list = normTts(cfg).engines
    const find = (id) => list.find((e) => e.id === id) || {}
    const idx = find('indextts25')
    const gsv = find('gptvoice')
    const mm = find('minimax-tts')
    const db = find('doubao-tts')
    return {
      indextts25Endpoint: idx.endpoint || 'http://127.0.0.1:9880',
      indexttsRootDir: S(idx.rootDir),
      indexttsPythonBin: S(idx.pythonBin),
      gptvoiceEndpoint: gsv.endpoint || 'http://127.0.0.1:9881',
      gptvoiceRootDir: S(gsv.rootDir),
      gptvoicePythonBin: S(gsv.pythonBin),
      gptvoiceTextLang: gsv.textLang || 'zh',
      gptvoicePromptLang: gsv.promptLang || 'zh',
      minimaxTtsEndpoint: mm.endpoint || 'https://api.minimaxi.com/v1/t2a_v2',
      minimaxTtsModel: mm.model || 'speech-2.6-hd',
      minimaxTtsVoiceId: mm.voiceId || 'male-qn-qingse',
      minimaxTtsApiKey: '',
      minimaxClearKey: false,
      doubaoTtsEndpoint: db.endpoint || 'https://openspeech.bytedance.com/api/v1/tts',
      doubaoTtsAppId: S(db.appId),
      doubaoTtsToken: '',
      doubaoClearToken: false,
      doubaoTtsCluster: db.cluster || 'volcano_tts',
      doubaoTtsVoiceType: db.voiceType || 'zh_male_m392_conversation_wvae_bigtts',
    }
  }
  const ttsBuiltinPayload = (b) => ({
    action: 'save',
    builtins: {
      indextts25: { endpoint: b.indextts25Endpoint, rootDir: b.indexttsRootDir, pythonBin: b.indexttsPythonBin },
      indextts2: { endpoint: b.indextts25Endpoint, rootDir: b.indexttsRootDir, pythonBin: b.indexttsPythonBin },
      gptvoice: { endpoint: b.gptvoiceEndpoint, rootDir: b.gptvoiceRootDir, pythonBin: b.gptvoicePythonBin, textLang: b.gptvoiceTextLang || 'zh', promptLang: b.gptvoicePromptLang || 'zh' },
      'minimax-tts': {
        endpoint: S(b.minimaxTtsEndpoint).trim() || 'https://api.minimaxi.com/v1/t2a_v2',
        model: S(b.minimaxTtsModel).trim() || 'speech-2.6-hd',
        voiceId: S(b.minimaxTtsVoiceId).trim() || 'male-qn-qingse',
        ...(S(b.minimaxTtsApiKey).trim() ? { apiKey: S(b.minimaxTtsApiKey).trim() } : {}),
        ...(b.minimaxClearKey ? { clearApiKey: true } : {}),
      },
      'doubao-tts': {
        endpoint: S(b.doubaoTtsEndpoint).trim() || 'https://openspeech.bytedance.com/api/v1/tts',
        appId: S(b.doubaoTtsAppId).trim(),
        ...(S(b.doubaoTtsToken).trim() ? { token: S(b.doubaoTtsToken).trim() } : {}),
        ...(b.doubaoClearToken ? { clearToken: true } : {}),
        cluster: S(b.doubaoTtsCluster).trim() || 'volcano_tts',
        voiceType: S(b.doubaoTtsVoiceType).trim() || 'zh_male_m392_conversation_wvae_bigtts',
      },
    },
  })
  const DEFAULT_PAYLOAD_TPL = '{\n  "text": "{{text}}",\n  "voice": "{{voiceName}}",\n  "lang": "{{lang}}",\n  "speed": "{{speed}}"\n}'
  const customTtsBlank = () => ({
    editingId: '',
    hasApiKey: false,
    apiKeyMasked: '',
    id: '',
    name: '',
    kind: 'openai-tts',
    vramBadge: '自定义模型 / 低配友好',
    endpoint: 'http://127.0.0.1:8080/v1/audio/speech',
    method: 'POST',
    apiKey: '',
    model: 'fish-speech-1.5',
    voice: 'default',
    responseFormat: 'wav',
    speed: 1.0,
    responseType: 'binary',
    responseAudioPath: 'audio',
    payloadTemplateText: DEFAULT_PAYLOAD_TPL,
    command: 'edge-tts',
    argsTemplate: '--text {{text}} --voice {{voice}} --write-media {{output}}',
    outputExt: '.mp3',
  })
  const customTtsFromEngine = (eng, editing) => ({
    editingId: editing ? S(eng.id) : '',
    hasApiKey: Boolean(editing && eng.hasApiKey),
    apiKeyMasked: editing ? S(eng.apiKeyMasked) : '',
    id: S(eng.id) || `custom-${Date.now().toString(36)}`,
    name: S(eng.name),
    kind: ['openai-tts', 'http-json', 'cli-command'].includes(eng.kind) ? eng.kind : 'openai-tts',
    vramBadge: S(eng.vramBadge) || '自定义模型',
    endpoint: S(eng.endpoint),
    method: S(eng.method).toUpperCase() === 'GET' ? 'GET' : 'POST',
    apiKey: '',
    model: S(eng.model),
    voice: S(eng.voice || eng.defaultVoice) || 'default',
    responseFormat: S(eng.responseFormat) || 'wav',
    speed: U.num(eng.speed, 1) || 1,
    responseType: ['binary', 'json_base64', 'json_url'].includes(eng.responseType) ? eng.responseType : 'binary',
    responseAudioPath: S(eng.responseAudioPath) || 'audio',
    payloadTemplateText: eng.payloadTemplate ? JSON.stringify(eng.payloadTemplate, null, 2) : '{\n  "text": "{{text}}"\n}',
    command: S(eng.command),
    argsTemplate: S(eng.argsTemplate),
    outputExt: S(eng.outputExt) || '.wav',
  })

  /* ---- Cloud config draft (keys + presets) */
  const CLOUD_CATS = [
    { value: 'image', label: '云端生图', sub: '即梦 / Flux / 可灵 / 自定义', icon: 'image', unit: '图片' },
    { value: 'video', label: '云端生视频', sub: 'Seedance / 可灵 / 海螺', icon: 'film', unit: '视频' },
    { value: 'audio', label: '云端音乐与音频', sub: 'MiniMax Music 3 / Suno', icon: 'music', unit: '音乐' },
  ]
  const CLOUD_VARS = '{{prompt}} {{lyrics}} {{model}} {{duration}} {{aspectRatio}} {{instrumental}} {{apiKey}} {{taskId}}'
  const cloudCatDraft = (c) => ({
    providerId: S(c && c.providerId),
    protocol: S(c && c.protocol) || 'custom',
    baseUrl: S(c && c.baseUrl),
    endpoint: S(c && c.endpoint),
    model: S(c && c.model),
    apiKey: '',
    clearApiKey: false,
    custom: { ...((c && c.custom) || {}) },
  })
  const cloudDraftFrom = (cm = {}) => ({
    autoUseCloudBroll: Boolean(cm.autoUseCloudBroll),
    image: cloudCatDraft(cm.image),
    video: cloudCatDraft(cm.video),
    audio: cloudCatDraft(cm.audio),
    // free stock libraries (Pexels / Pixabay): typed keys only — stored keys are never sent to the page
    stock: { pexels: '', pixabay: '', clearPexels: false, clearPixabay: false },
  })
  /** { pexelsApiKey?, pixabayApiKey?, clearPexels?, clearPixabay? } — untouched fields are left out (stored keys kept) */
  const stockKeyPayload = (s = {}) => {
    const out = {}
    if (S(s.pexels).trim()) out.pexelsApiKey = S(s.pexels).trim()
    if (S(s.pixabay).trim()) out.pixabayApiKey = S(s.pixabay).trim()
    if (s.clearPexels) out.clearPexels = true
    if (s.clearPixabay) out.clearPixabay = true
    return out
  }
  const cloudCatPayload = (d) => {
    const out = { providerId: d.providerId, protocol: d.protocol, baseUrl: S(d.baseUrl).trim(), endpoint: S(d.endpoint).trim(), model: S(d.model).trim(), custom: { ...d.custom } }
    if (S(d.apiKey).trim()) out.apiKey = S(d.apiKey).trim()
    if (d.clearApiKey) out.clearApiKey = true
    return out
  }
  function applyCloudPreset(d, preset) {
    if (!preset) return
    d.providerId = preset.id
    d.protocol = preset.protocol || d.protocol
    d.baseUrl = preset.baseUrl || d.baseUrl || ''
    d.endpoint = preset.endpoint || d.endpoint || ''
    d.model = preset.defaultModel || d.model || ''
  }
  const presetOf = (cm, cat, id) => ((cm && cm.presets && cm.presets[cat]) || []).find((p) => p.id === id) || null

  /** (re)initialise the keys-panel drafts from fresh data; sections the user is editing are left alone */
  function syncKeyDrafts(ctx, force) {
    const d = ctx.data
    if (!d) return
    const L = ctx.local
    const base = (L.base = L.base || {})
    const syncOne = (name, make) => {
      const next = make()
      if (force || !L[name] || same(L[name], base[name])) {
        L[name] = next
        base[name] = clone(next)
        return true
      }
      return false
    }
    if (syncOne('llm', () => llmDraftFrom(d.llmConfig || {}))) L.llmStash = null
    syncOne('ttsB', () => ttsBuiltinFrom(d.ttsConfig))
    syncOne('cloudCfg', () => cloudDraftFrom(d.cloudMedia || {}))
    if (!L.ttsC) {
      L.ttsC = customTtsBlank()
      base.ttsC = clone(L.ttsC)
    }
  }
  const resetBase = (ctx, name) => {
    ctx.local.base = ctx.local.base || {}
    ctx.local.base[name] = clone(ctx.local[name])
  }
  function keysDirty(ctx) {
    const L = ctx.local
    const base = L.base || {}
    const out = []
    if (L.llm && base.llm && !same(L.llm, base.llm)) out.push('文本大模型')
    if (L.ttsB && base.ttsB && !same(L.ttsB, base.ttsB)) out.push('配音引擎参数')
    if (L.ttsC && base.ttsC && !same(L.ttsC, base.ttsC)) out.push('自定义配音模型')
    if (L.cloudCfg && base.cloudCfg && !same(L.cloudCfg, base.cloudCfg)) out.push('云端生成接口')
    return out
  }

  /* ---- LLM actions */
  async function testLlm(ctx) {
    const cfg = ctx.data.llmConfig || {}
    const f = ctx.local.llm
    if (f.mode === 'custom' && !S(f.baseUrl).trim()) throw new PK.Error('请先填写 API 地址，再测试连接')
    ctx.local.llmTest = null
    ctx.update()
    try {
      const res = await PK.post('llm-test', llmPayload(cfg, f), { timeout: 150000 })
      ctx.local.llmTest = { ok: true, ...res }
    } catch (err) {
      ctx.local.llmTest = { ok: false, error: friendlyErr(err, '这个大模型接口', '连接失败') }
    }
  }
  async function saveLlm(ctx) {
    const cfg = ctx.data.llmConfig || {}
    const f = ctx.local.llm
    if (f.mode === 'custom') {
      if (!S(f.baseUrl).trim()) throw new PK.Error('请填写 API 地址（例如 https://api.openai.com/v1 或中转站地址）')
      if (!S(f.model).trim()) throw new PK.Error('请填写要使用的模型 ID（可先点「测试连接并拉取模型」再从列表里选）')
      if (!S(f.apiKey).trim() && !customKeySaved(cfg) && !isLocalUrl(f.baseUrl) && f.provider !== 'ollama') {
        const ok = await PK.confirm({ title: '没有填写 API Key', text: '大多数在线大模型都需要 API Key 才能调用。确定不填密钥直接保存吗？（本机部署或免密钥的服务可以不填）', ok: '仍然保存' })
        if (!ok) return
      }
    }
    const res = await PK.post('llm-config', llmPayload(cfg, f))
    const conf = (res && res.config) || {}
    ctx.local.llm = llmDraftFrom(conf)
    ctx.local.llmStash = null
    resetBase(ctx, 'llm')
    ctx.local.reveal = {}
    PK.toast(conf.configured ? `已保存并生效：${conf.sourceLabel || '大模型接口'} · ${conf.model || ''}` : '已保存。注意：当前配置还不完整（缺少地址、模型或密钥），AI 功能暂时不可用。', conf.configured ? 'success' : 'warn')
  }
  async function clearLlmKey(ctx) {
    // only the key is removed — every other saved field stays as it is (unsaved edits in the form are not saved)
    await PK.post('llm-config', { mode: 'custom', clearApiKey: true })
    ctx.local.llm.apiKey = ''
    PK.toast('已清除插件里保存的 API Key', 'success')
  }
  /**
   * Switch 接入方式 without leaking one mode's fields into the other: the custom template's model / protocol must not
   * end up pinned on a DSH channel (and vice versa). Each mode keeps its own fields while the panel is open.
   */
  function switchLlmMode(ctx, next) {
    const f = ctx.local.llm
    if (!f || f.mode === next) return
    const stash = (ctx.local.llmStash = ctx.local.llmStash || {})
    if (f.mode === 'custom') stash.custom = { provider: f.provider, baseUrl: f.baseUrl, model: f.model, format: f.format }
    else if (f.mode === 'follow-dsh') stash['follow-dsh'] = { dshProviderId: f.dshProviderId, model: f.model, format: f.format }
    f.mode = next
    if (stash[next]) Object.assign(f, stash[next])
    else if (next === 'follow-dsh') Object.assign(f, { dshProviderId: 'active', model: '', format: 'auto' })
    else if (next === 'auto') Object.assign(f, { model: '', format: 'auto' })
    ctx.local.llmTest = null
  }

  /* ---- TTS actions */
  async function selectTtsEngine(ctx, eng) {
    await ctx.task(`正在切换配音引擎至 ${engLabel(eng)}…`, async () => {
      const res = await PK.post('tts-config', { action: 'select', activeEngineId: eng.id })
      ctx.local.ttsTest = null
      PK.toast(`已切换配音引擎：${(res && res.config && res.config.activeEngine && res.config.activeEngine.name) || engLabel(eng)}`, 'success')
    })
  }
  async function saveTtsBuiltin(ctx) {
    const res = await PK.post('tts-config', ttsBuiltinPayload(ctx.local.ttsB))
    ctx.local.ttsB = ttsBuiltinFrom(res && res.config)
    resetBase(ctx, 'ttsB')
    PK.toast('本地与云端配音引擎参数已保存（IndexTTS / GPT-SoVITS / MiniMax Speech / 火山方舟豆包语音）', 'success')
  }
  async function testTts(ctx) {
    const cfg = normTts(ctx.data.ttsConfig)
    ctx.local.ttsTest = null
    ctx.update()
    try {
      const res = await PK.post('tts-test', { engineId: cfg.activeEngineId || 'indextts25', voiceId: (st().director && st().director.voiceId) || 'auto', text: '你好，这是双引擎视频工作台的实时配音引擎测试音频。' }, { timeout: 300000 })
      ctx.local.ttsTest = { ok: true, ...res }
      if (res && res.audioDataUrl) PK.audio.play(res.audioDataUrl, ctx.local).catch(() => {})
    } catch (err) {
      ctx.local.ttsTest = { ok: false, error: friendlyErr(err, '配音服务', '合成失败') }
    }
  }
  async function repairTtsVoices(ctx) {
    const b = ctx.local.ttsB || {}
    const res = await PK.post('tts/repair-voices', { idxRoot: S(b.indexttsRootDir), gptRoot: S(b.gptvoiceRootDir) }, { timeout: 300000 })
    PK.toast(`voices/ 目录及默认参考音色已就绪（当前可用音色 ${U.num(res && res.availableCount)} 个），可以直接试听测试`, 'success')
  }
  async function saveCustomTts(ctx) {
    const f = ctx.local.ttsC
    if (!S(f.name).trim()) throw new PK.Error('请填写自定义配音模型的名称')
    if (f.kind === 'cli-command' && !S(f.command).trim()) throw new PK.Error('请填写要执行的命令（例如 edge-tts 或 python.exe 的完整路径）')
    if (f.kind !== 'cli-command' && !S(f.endpoint).trim()) throw new PK.Error('请填写接口地址')
    let payloadTemplate
    if (f.kind === 'http-json') {
      try {
        payloadTemplate = S(f.payloadTemplateText).trim() ? JSON.parse(f.payloadTemplateText) : { text: '{{text}}' }
      } catch (err) {
        throw new PK.Error(`HTTP JSON 请求体模板不是合法 JSON：${err.message}`)
      }
    }
    const res = await PK.post('tts-config', {
      action: 'add-custom',
      engine: {
        id: S(f.id).trim() || undefined,
        name: S(f.name).trim(),
        kind: f.kind,
        vramBadge: S(f.vramBadge).trim() || '自定义模型',
        endpoint: S(f.endpoint).trim(),
        method: f.method,
        apiKey: S(f.apiKey).trim(),
        model: S(f.model).trim(),
        voice: S(f.voice).trim(),
        defaultVoice: S(f.voice).trim(),
        responseFormat: f.responseFormat || 'wav',
        speed: U.num(f.speed, 1) || 1,
        responseType: f.responseType || 'binary',
        responseAudioPath: S(f.responseAudioPath).trim() || 'audio',
        payloadTemplate,
        command: S(f.command).trim(),
        argsTemplate: S(f.argsTemplate).trim(),
        outputExt: S(f.outputExt).trim() || '.wav',
        activate: true,
      },
    })
    ctx.local.ttsC = customTtsBlank()
    resetBase(ctx, 'ttsC')
    ctx.local.ttsSub = 'engines'
    PK.toast(`已添加并启用配音模型：${(res && res.config && res.config.activeEngine && res.config.activeEngine.name) || f.name}`, 'success')
  }
  async function removeCustomTts(ctx, eng) {
    const ok = await PK.confirm({ title: '删除自定义配音模型？', text: `将删除「${eng.name || eng.id}」这条接入配置（不会删除你电脑上的模型文件）。如果它正在使用，会自动切换回内置引擎。`, ok: '删除', danger: true })
    if (!ok) return
    await ctx.task('正在删除自定义配音模型…', async () => {
      await PK.post('tts-config', { action: 'remove-custom', id: eng.id })
      if (ctx.local.ttsC && ctx.local.ttsC.editingId === eng.id) {
        ctx.local.ttsC = customTtsBlank()
        resetBase(ctx, 'ttsC')
      }
      PK.toast('已移除自定义配音模型', 'info')
    })
  }
  async function importTtsJson(ctx) {
    const text = S(ctx.local.ttsJson).trim()
    if (!text) throw new PK.Error('请先粘贴或从文件载入配音模型 JSON 配置')
    try {
      JSON.parse(text)
    } catch (err) {
      throw new PK.Error(`JSON 格式不正确：${err.message}`)
    }
    const res = await PK.post('tts-config', { action: 'import-json', jsonText: text })
    ctx.local.ttsJson = ''
    ctx.local.ttsSub = 'engines'
    PK.toast(`已成功导入并切换至：${(res && res.config && res.config.activeEngine && res.config.activeEngine.name) || '自定义模型'}`, 'success')
  }
  /** engine config for sharing: no keys / tokens, credential-looking headers blanked, internal flags dropped */
  const safeEngineCopy = (eng) => {
    const out = { ...(eng || {}) }
    for (const k of ['apiKey', 'apiKeyMasked', 'hasApiKey', 'token', 'tokenMasked', 'hasToken', 'activate']) delete out[k]
    if (out.headers && typeof out.headers === 'object' && !Array.isArray(out.headers)) {
      out.headers = Object.fromEntries(Object.entries(out.headers).map(([k, v]) => [k, /auth|token|key|secret|cookie|sign/i.test(k) ? '（已隐藏，请填写你自己的）' : v]))
    }
    return out
  }
  async function loadTtsCatalog(ctx, quiet) {
    try {
      const res = await PK.get('tts/install-options')
      ctx.local.ttsCatalog = (res && res.catalog) || null
    } catch (err) {
      if (!quiet) PK.reportError(err, '读取安装包列表失败')
    }
    ctx.update()
  }
  async function installTts(ctx, pkg) {
    if (jobRunning('tts-install')) throw new PK.Error('已有一个配音依赖包正在安装，请等它完成')
    const L = ctx.local
    const dir = S(L.ttsInstallDir).trim() || pkg.defaultDir || ''
    const mirror = L.ttsMirror || 'cn'
    const ok = await PK.confirm({
      title: `一键安装 ${pkg.shortName || pkg.id}？`,
      text: `将自动下载并安装「${pkg.name || pkg.shortName}」：\n· 显卡要求：${pkg.vramRequired || '—'}\n· 磁盘占用：${pkg.diskRequired || '—'}\n· 预计耗时：${pkg.etaLabel || '数分钟'}\n· 下载源：${mirror === 'global' ? '官方全球源 (HuggingFace + PyPI)' : '国内高速镜像 (HF-Mirror + 清华源)'}\n· 安装位置：${dir || '默认 tts-engines 目录'}\n\n安装期间需要联网，可以关闭本面板，完成后会提示你；装好后会自动接入插件。`,
      ok: '开始安装',
    })
    if (!ok) return
    const name = pkg.shortName || pkg.id
    startJob('tts-install', {
      label: `安装 ${name}`,
      startText: `正在启动 ${name} 一键安装（${mirror === 'cn' ? '国内加速镜像' : '官方源'}）…`,
      start: () => PK.post('tts/install', { engineId: pkg.id, installDir: S(L.ttsInstallDir).trim(), mirror, autoActivate: true, async: true }),
      doneText: () => `${name} 依赖包安装完成，并已自动接入插件（含 voices/ 目录与默认参考音色）`,
    })
      .then(async () => {
        PK.toast(`${name} 依赖包安装完成并已自动接入插件（含 voices/ 目录与默认参考音色）！`, 'success')
        await hostRefresh()
        if (!ctx.frame.closed) loadTtsCatalog(ctx, true)
      })
      .catch((err) => PK.toast(`安装未完成：${S(err && err.message)}`, 'error', { title: `${name} 安装失败`, timeout: 0 }))
  }

  /* ---- Cloud config actions */
  async function saveCloudCfg(ctx) {
    const d = ctx.local.cloudCfg
    const stock = stockKeyPayload(d.stock)
    const res = await PK.post('cloud-media', { autoUseCloudBroll: Boolean(d.autoUseCloudBroll), image: cloudCatPayload(d.image), video: cloudCatPayload(d.video), audio: cloudCatPayload(d.audio), ...(Object.keys(stock).length ? { stock } : {}) })
    ctx.local.cloudCfg = cloudDraftFrom((res && res.config) || {})
    resetBase(ctx, 'cloudCfg')
    PK.toast('云端生图 / 生视频 / 音乐接口配置已保存（密钥只保存在本机，不会上传）', 'success')
  }

  /* ---- render: 文本大模型 · 跟随当前智能体 */
  // DSH → its channel; other agents (Claude Code, Codex, opencode, OpenClaw, Hermes, pi, WorkBuddy, Antigravity …) →
  // the model API key in the agent's environment. Agent logins / subscriptions cannot be shared with plugins.
  function renderLlmAuto(ctx, cfg, rerender) {
    const host = cfg.host || {}
    const hostName = S(host.label) || ''
    const envList = Array.isArray(cfg.hostEnv) ? cfg.hostEnv : []
    const by = S(cfg.resolvedBy)
    const toCustom = ui.btn('改用自定义模型', () => {
      switchLlmMode(ctx, 'custom')
      rerender()
    }, { size: 'sm', kind: by === 'none' ? 'primary' : 'ghost', icon: 'key' })
    let note
    if (by === 'dsh') {
      note = ui.note(`正在使用 DSH 的通道 · 模型 ${cfg.model || '—'}。在 DSH 里切换模型后，这里会自动跟着变。`, { level: 'ok', title: S(cfg.sourceLabel) || '跟随 DSH' })
    } else if (by === 'host-env') {
      note = ui.note(
        `正在使用 ${hostName || '智能体'} 运行环境里的 ${cfg.hostEnvVar || 'API Key'} · 模型 ${cfg.model || '—'}。想换模型：在智能体的环境里设置对应的 *_MODEL，或改用自定义。`,
        { level: 'ok', title: S(cfg.sourceLabel) || '跟随当前智能体' },
      )
    } else if (by === 'custom') {
      note = ui.note(`${hostName || '当前环境'} 没有提供可共享的模型配置，暂时使用你在「自定义」里填的模型（${cfg.model || '—'}）。`, { level: 'info', title: '使用自定义模型' })
    } else {
      note = ui.note(
        [
          `${hostName ? `${hostName} 用账号登录时，` : ''}没有可以共享给插件的模型 API Key（智能体的登录 / 订阅只能它自己用）。可以任选一种：`,
          '① 在智能体的运行环境里设置 ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY（可再设 *_BASE_URL、*_MODEL），插件会自动跟随；',
          '② 改用「自定义」，填写任意大模型的地址、密钥与模型；',
          '③ 不配置：创作模式选「本地极速草稿」，或让智能体自己写分镜与代码，再调用插件的检查与渲染出片。',
        ].join('\n'),
        { level: 'warn', title: hostName ? `${hostName} 没有可共享的模型配置` : '还没有可用的大模型', actions: [toCustom] },
      )
    }
    return ui.section(
      { title: '当前智能体', en: 'HOST AGENT', icon: 'hub', desc: hostName ? `插件当前运行在 ${hostName} 中${host.version ? `（${host.version}）` : ''}。` : '插件以独立工作台运行（没有接入智能体），会先跟随本机的 DSH 配置。' },
      note,
      envList.length > 1 || (envList.length === 1 && by !== 'host-env')
        ? ui.text(`环境中检测到：${envList.map((e) => `${e.keyVar}（${S(e.label).split(' ')[0] || e.provider}）`).join(' · ')}`, { tone: 'muted' })
        : null,
      by !== 'none' ? ui.row([toCustom]) : null,
    )
  }

  /* ---- render: tab · 文本大模型 */
  function renderLlm(ctx) {
    const cfg = ctx.data.llmConfig || {}
    const f = ctx.local.llm
    const dsh = cfg.dshClient || { available: false, providers: [] }
    const providers = Array.isArray(dsh.providers) ? dsh.providers : []
    const templates = Array.isArray(cfg.templates) ? cfg.templates : []
    const tpl = templates.find((t) => t.id === f.provider) || null
    const test = ctx.local.llmTest
    const rerender = () => {
      ctx.local.llmTest = null
      ctx.render()
    }
    const out = []
    out.push(
      cfg.configured
        ? ui.note(`${cfg.sourceLabel || '已配置'} · 模型 ${cfg.model || '—'} · 协议 ${protoLabel(cfg.detectedProtocol || cfg.format)}`, { level: 'ok', title: '大模型已就绪' })
        : ui.note('导演策划、分镜编码、AI 润色与云端提示词助手都靠它。选一种接入方式填好，先「测试连接」，再「保存并生效」。也可以不配置，把创作模式切到「本地极速草稿」零配置出片。', { level: 'warn', title: '还没有可用的大模型' }),
    )
    out.push(
      ui.section(
        { title: '接入方式', en: 'SOURCE', icon: 'link' },
        ui.seg({
          value: f.mode,
          options: [
            { value: 'auto', label: '跟随当前智能体（推荐）', icon: 'link' },
            ...(dsh.available || f.mode === 'follow-dsh' ? [{ value: 'follow-dsh', label: '指定 DSH 通道', icon: 'hub' }] : []),
            { value: 'custom', label: '自定义（自填地址与密钥）', icon: 'key' },
          ],
          onChange: (v) => {
            switchLlmMode(ctx, v)
            rerender()
          },
        }),
      ),
    )
    if (f.mode === 'auto') out.push(renderLlmAuto(ctx, cfg, rerender))
    out.push(
      f.mode === 'auto' ? null : ui.section(
        { title: '接口协议', en: 'WIRE PROTOCOL', icon: 'code', desc: '点卡片切换。不确定就选「自动识别」；DeepSeek / 通义 / 中转站一般是「OpenAI 兼容 Chat」。' },
        ui.grid(
          WIRE_CARDS.map((c) =>
            ui.card({
              key: `wire-${c.id}`,
              title: c.title,
              body: h('div.pk-stack', { style: { gap: '4px' } }, ui.text(c.path, { mono: true, tone: 'dim' }), ui.text(c.desc, { tone: 'muted' })),
              tags: [ui.tag(c.tag, { active: f.format === c.id })],
              active: f.format === c.id,
              onClick: () => {
                f.format = c.id
                rerender()
              },
            }),
          ),
          { min: 190 },
        ),
      ),
    )
    if (f.mode === 'auto') {
      // nothing else to fill in: the source is decided by the agent hosting the plugin (see above)
    } else if (f.mode === 'follow-dsh') {
      if (dsh.available) {
        const curProv = f.dshProviderId === 'active' ? dsh.defaultProviderId : f.dshProviderId
        const prov = providers.find((p) => p.id === curProv) || null
        const models = prov && Array.isArray(prov.models) ? prov.models : []
        out.push(
          ui.section(
            { title: 'DSH 客户端通道', en: 'DSH PROVIDERS', icon: 'hub', desc: `已读取本机 DSH 客户端配置（默认通道：${dsh.defaultProviderName || dsh.defaultProviderId || '未设置'}）。密钥由 DSH 客户端管理，插件不会保存或显示。` },
            ui.chips({
              value: f.dshProviderId || 'active',
              options: [
                { value: 'active', label: `跟随 DSH 当前默认${dsh.defaultProviderName ? `（${dsh.defaultProviderName}）` : ''}`, hint: '在 DSH 里切换模型后，这里会自动跟着变' },
                ...providers.map((p) => ({ value: p.id, label: `${p.displayName || p.id}${p.id === dsh.defaultProviderId ? ' · 默认' : ''}`, hint: (p.models || []).map((m) => m.id).slice(0, 6).join(' / ') })),
              ],
              onChange: (v) => {
                const p = providers.find((x) => x.id === v)
                f.mode = 'follow-dsh'
                f.dshProviderId = v
                f.format = 'auto'
                f.model = v === 'active' ? '' : S(p && p.models && p.models[0] && p.models[0].id)
                rerender()
              },
            }),
            ui.field(
              { label: '模型', en: 'MODEL', hint: '留空 = 自动沿用该通道的默认模型；也可以点下面的候选，或手动输入任意模型 ID' },
              lineField({ key: 'llm-dsh-model', value: f.model, placeholder: `留空 = 自动沿用 DSH 当前模型${dsh.defaultModelId ? `（${dsh.defaultModelId}）` : ''}`, onInput: (v) => (f.model = v) }),
            ),
            models.length
              ? ui.chips({
                  value: f.model,
                  options: models.slice(0, 24).map((m) => ({ value: m.id, label: m.name && m.name !== m.id ? `${m.name}` : m.id, hint: m.id })),
                  onChange: (v) => {
                    f.model = v
                    rerender()
                  },
                })
              : null,
          ),
        )
      } else {
        out.push(
          ui.note('没有检测到本机 DSH 客户端配置文件。请切换到「插件独立接入」，直接填入 API 地址、密钥与模型。', {
            level: 'warn',
            title: '未找到 DSH 客户端',
            actions: [ui.btn('切换到插件独立接入', () => {
              switchLlmMode(ctx, 'custom')
              rerender()
            }, { size: 'sm', kind: 'primary', icon: 'key' })],
          }),
        )
      }
    } else {
      const keySaved = customKeySaved(cfg)
      const models = test && test.ok && Array.isArray(test.availableModels) && test.availableModels.length ? test.availableModels.map((m) => (typeof m === 'string' ? m : S(m && (m.id || m.name)))) : (tpl && tpl.suggestedModels) || []
      out.push(
        ui.section(
          { title: '服务商模板', en: 'PROVIDER', icon: 'star', desc: '点一下自动填好推荐的地址、协议与模型；用中转站或私有部署就选「自由填写」。' },
          ui.chips({
            value: f.provider,
            options: templates.map((t) => ({ value: t.id, label: t.id === 'custom' ? '自由填写中转 / 私有服务' : S(t.label).split(' ')[0], hint: t.label })),
            onChange: (v) => {
              const t = templates.find((x) => x.id === v)
              f.provider = v
              if (t) {
                if (t.defaultFormat && t.defaultFormat !== 'auto') f.format = t.defaultFormat
                if (t.defaultBaseUrl) f.baseUrl = t.defaultBaseUrl
                if (t.suggestedModels && t.suggestedModels[0]) f.model = t.suggestedModels[0]
              }
              rerender()
            },
          }),
        ),
        ui.field(
          { label: 'API 地址', en: 'BASE URL', required: true, hint: '例如 https://api.openai.com/v1，或中转站给你的地址' },
          lineField({ key: 'llm-base', value: f.baseUrl, placeholder: 'API 地址，例如 https://api.openai.com/v1 或中转网址', onInput: (v) => (f.baseUrl = v) }),
        ),
        fgrid(
          [
            ui.field(
              {
                label: 'API Key',
                en: 'SECRET',
                hint: keySaved ? '已加密保存在本机，不修改就留空' : tpl && tpl.requiresKey === false ? '本地模型服务一般不需要密钥，可以留空' : '一串以 sk- 等开头的字符，在服务商后台创建',
                aside: keySaved ? ui.btn('清除已保存的密钥', () => clearLlmKey(ctx), { kind: 'link', size: 'sm', confirm: { title: '清除 API Key？', text: '将删除插件里保存的大模型 API Key，之后需要重新填写才能使用 AI 功能。', ok: '清除', danger: true } }) : null,
              },
              secretField(ctx, { key: 'llm-key', value: f.apiKey, saved: keySaved, masked: cfg.maskedApiKey, placeholder: '粘贴 API Key（sk-...）', onInput: (v) => (f.apiKey = v) }),
            ),
            ui.field(
              { label: '模型 ID', en: 'MODEL', required: true, hint: '可自由手输任意模型；测试连接后会列出该接口支持的模型' },
              lineField({ key: 'llm-model', value: f.model, placeholder: '例如 deepseek-chat / gpt-5 / claude-opus-4-6', onInput: (v) => (f.model = v) }),
            ),
          ],
          { min: 260 },
        ),
        models.length
          ? ui.field(
              { label: test && test.ok ? `该接口可用的模型（${models.length}）` : '推荐模型', en: 'MODELS' },
              ui.chips({
                value: f.model,
                options: models.slice(0, 40).map((m) => ({ value: m, label: m })),
                onChange: (v) => {
                  f.model = v
                  ctx.render()
                },
              }),
            )
          : null,
      )
    }
    out.push(
      ui.field(
        { label: 'AI 编译出错时自动修复的最大轮次', en: 'REPAIR ROUNDS', hint: '轮次越多成功率越高，但会多消耗一些模型调用' },
        ui.seg({
          value: String(f.maxRepairRounds),
          options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `最多 ${n} 轮` })),
          onChange: (v) => (f.maxRepairRounds = Number(v)),
        }),
      ),
    )
    if (test) {
      out.push(
        test.ok
          ? ui.note(
              [
                `延迟 ${U.num(test.latencyMs)} ms · 协议 ${protoLabel(test.protocol)} · 模型 ${test.model || '—'}`,
                test.replyPreview ? `模型回复：${test.replyPreview}` : '',
                Array.isArray(test.availableModels) && test.availableModels.length
                  ? f.mode === 'custom'
                    ? `已拉取 ${test.availableModels.length} 个可用模型，可在上方直接点选`
                    : `该接口共有 ${test.availableModels.length} 个可用模型`
                  : '',
              ]
                .filter(Boolean)
                .join('\n'),
              { level: 'ok', title: '测试联通' },
            )
          : ui.note(test.error, { level: 'error', title: '连接失败', actions: [ui.btn('打开帮助', () => PK.open('help'), { size: 'sm', kind: 'ghost', icon: 'help' })] }),
      )
    }
    ctx.foot([
      ui.hint(cfg.configFile ? `配置只保存在本机：${U.baseName(cfg.configFile)}` : '配置只保存在本机'),
      ui.spacer(),
      actBtn(ctx, 'llm-test', '测试连接并拉取模型', () => testLlm(ctx), { icon: 'bolt', busyText: '正在探测接口…' }),
      actBtn(ctx, 'llm-save', '保存并生效', () => saveLlm(ctx), { kind: 'primary', icon: 'check', busyText: '保存中…' }),
    ])
    return out
  }

  /* ---- render: tab · 配音引擎 */
  const GSV_LANGS = [
    { value: 'zh', label: '中文 zh' },
    { value: 'en', label: '英文 en' },
    { value: 'ja', label: '日文 ja' },
    { value: 'ko', label: '韩文 ko' },
    { value: 'yue', label: '粤语 yue' },
    { value: 'auto', label: '自动识别 auto' },
  ]
  const withValue = (opts, v) => (v && !opts.some((o) => o.value === v) ? [...opts, { value: v, label: v }] : opts)
  function renderTts(ctx) {
    const data = ctx.data
    const cfg = normTts(data.ttsConfig)
    const L = ctx.local
    const sub = L.ttsSub || 'engines'
    const status = data.ttsStatus || {}
    const active = cfg.engines.find((e) => e.id === cfg.activeEngineId) || cfg.engines[0] || {}
    const out = []
    out.push(
      ui.note(
        status.ready
          ? S(status.message) || `${active.name || engLabel(active)} 已连通，可以直接出片配音`
          : S(status.message) ||
              `${engLabel(active)} 的服务暂未连通${status.endpoint ? `（${status.endpoint}）` : ''}：本地引擎需要先启动或「一键安装」；不想折腾也可以切换到「Windows 系统原生中文语音」零配置使用。`,
        { level: status.ready ? 'ok' : 'warn', title: `当前配音引擎：${engLabel(active)}` },
      ),
    )
    out.push(
      ui.seg({
        value: sub,
        options: [
          { value: 'engines', label: '选择与配置引擎', icon: 'voice' },
          { value: 'install', label: '一键安装依赖包', icon: 'download' },
          { value: 'add', label: L.ttsC && L.ttsC.editingId ? '编辑自定义模型' : '添加自定义模型', icon: 'plus' },
          { value: 'import', label: 'JSON 导入导出', icon: 'code' },
        ],
        onChange: (v) => {
          L.ttsSub = v
          if (v === 'install') loadTtsCatalog(ctx, true)
          ctx.render()
        },
      }),
    )
    if (sub === 'engines') out.push(...renderTtsEngines(ctx, cfg))
    else if (sub === 'install') out.push(...renderTtsInstall(ctx, data))
    else if (sub === 'add') out.push(...renderTtsCustom(ctx, cfg))
    else out.push(...renderTtsImport(ctx, cfg, active))
    const t = L.ttsTest
    if (t && sub === 'engines') {
      out.push(
        t.ok
          ? ui.note(h('div.pk-stack', null, ui.text(`试听合成成功（${t.provider || t.engine || engLabel(active)}${t.durationSec ? ` · ${U.num(t.durationSec).toFixed(1)} 秒` : ''}）`), t.audioDataUrl ? ui.audio(t.audioDataUrl) : null), { level: 'ok', title: '试听测试' })
          : ui.note(t.error, { level: 'error', title: '试听测试失败', actions: [ui.btn('一键安装依赖包', () => {
              L.ttsSub = 'install'
              loadTtsCatalog(ctx, true)
              ctx.render()
            }, { size: 'sm', icon: 'download' })] }),
      )
    }
    return out
  }
  function renderTtsEngines(ctx, cfg) {
    const L = ctx.local
    const b = L.ttsB
    const data = ctx.data
    const engines = cfg.engines
    const mm = engines.find((e) => e.id === 'minimax-tts') || {}
    const db = engines.find((e) => e.id === 'doubao-tts') || {}
    const fld = (label, key, field, placeholder, hint) => ui.field({ label, hint }, lineField({ key: `ttsb-${key}`, value: b[field], placeholder, onInput: (v) => (b[field] = v) }))
    const switchBtn = (id) => (cfg.activeEngineId === id ? ui.pill('使用中', 'ok', { dot: true }) : ui.btn('切换启用', () => selectTtsEngine(ctx, engines.find((e) => e.id === id) || { id }), { size: 'sm' }))
    ctx.foot([
      actBtn(ctx, 'tts-repair', '自动补齐 voices/ 与默认音色', () => repairTtsVoices(ctx), { icon: 'wand', kind: 'ghost', busyText: '正在补齐…', title: '自动创建 voices/ 目录并生成默认参考音色 WAV' }),
      ui.spacer(),
      actBtn(ctx, 'tts-test', `试听测试（${engLabel(engines.find((e) => e.id === cfg.activeEngineId))}）`, () => testTts(ctx), { icon: 'play', busyText: '正在合成测试音频…' }),
      actBtn(ctx, 'tts-save', '保存全部配音设置', () => saveTtsBuiltin(ctx), { kind: 'primary', icon: 'save', busyText: '保存中…' }),
    ])
    return [
      ui.section(
        { title: '引擎目录', en: 'ENGINES', icon: 'voice', count: engines.length, desc: '点卡片即可切换全片配音引擎。没有独立显卡也能用「Windows 系统原生」或云端语音。' },
        ui.grid(
          engines.map((eng) => {
            const on = eng.id === cfg.activeEngineId
            const line = eng.endpoint || (eng.command ? `${eng.command} ${eng.argsTemplate || ''}`.trim() : '')
            const title = eng.shortName || eng.name || eng.id
            return ui.card({
              key: `tts-eng-${eng.id}`,
              title,
              body: h(
                'div.pk-stack',
                { style: { gap: '6px' } },
                eng.name && eng.name !== title ? ui.text(eng.name, { tone: 'muted' }) : null,
                ui.row([eng.vramBadge ? ui.pill(eng.vramBadge, on ? 'acc' : 'mute', { title: eng.vramBadge }) : null, ui.tag(S(eng.kind) || 'custom'), eng.builtin ? null : ui.tag('自定义', { active: true })]),
                eng.description ? ui.text(eng.description, { tone: 'dim' }) : null,
                line ? ui.text(line, { mono: true, tone: 'dim' }) : null,
              ),
              active: on,
              onClick: on ? null : () => selectTtsEngine(ctx, eng),
              actions: [
                on ? ui.pill('使用中', 'ok', { dot: true }) : ui.btn('切换使用', () => selectTtsEngine(ctx, eng), { size: 'sm' }),
                eng.builtin
                  ? null
                  : ui.btn('编辑', () => {
                      L.ttsC = customTtsFromEngine(eng, true)
                      resetBase(ctx, 'ttsC')
                      L.ttsSub = 'add'
                      ctx.render()
                    }, { size: 'sm', kind: 'ghost', icon: 'edit' }),
                eng.builtin ? null : ui.btn('删除', () => removeCustomTts(ctx, eng), { size: 'sm', kind: 'danger', icon: 'trash' }),
              ],
            })
          }),
          { min: 240 },
        ),
      ),
      ui.section(
        { title: 'GPT-SoVITS（低显存推荐）与 IndexTTS 本地参数', en: 'LOCAL ENGINES', icon: 'cpu', desc: '已经自己启动了服务就只填地址；填了根目录与 Python 路径，插件会在需要时自动拉起服务。' },
        fgrid(
          [
            fld('GPT-SoVITS API 地址（api_v2.py）', 'gsv-ep', 'gptvoiceEndpoint', 'http://127.0.0.1:9881'),
            fld('IndexTTS-2.5 / 2 HTTP 地址', 'idx-ep', 'indextts25Endpoint', 'http://127.0.0.1:9880'),
            fld('可选：GPT-SoVITS 根目录（自动拉起）', 'gsv-root', 'gptvoiceRootDir', '留空则直连上方已启动的 HTTP 地址'),
            fld('可选：GPT-SoVITS Python 路径', 'gsv-py', 'gptvoicePythonBin', '例如 D:/GPT-SoVITS/runtime/python.exe'),
            fld('可选：IndexTTS 根目录', 'idx-root', 'indexttsRootDir', 'INDEXTTS_ROOT 覆盖路径'),
            fld('可选：IndexTTS Python 路径', 'idx-py', 'indexttsPythonBin', 'INDEXTTS_PYTHON 覆盖路径'),
            ui.field({ label: 'GPT-SoVITS 文本语言', hint: '要合成的台词语言' }, ui.select({ value: b.gptvoiceTextLang, options: withValue(GSV_LANGS, b.gptvoiceTextLang), onChange: (v) => (b.gptvoiceTextLang = v) })),
            ui.field({ label: 'GPT-SoVITS 参考音频语言', hint: '参考音色里说话的语言' }, ui.select({ value: b.gptvoicePromptLang, options: withValue(GSV_LANGS, b.gptvoicePromptLang), onChange: (v) => (b.gptvoicePromptLang = v) })),
          ],
          { min: 260 },
        ),
      ),
      ui.section(
        { title: '云端 TTS 配音通道', en: 'CLOUD TTS · 0GB 显存', icon: 'cloud', desc: '不需要显卡，按服务商价格计费。填好密钥后点「保存全部配音设置」，再「切换启用」。' },
        fgrid(
          [
            ui.section(
              { title: 'MiniMax Speech (T2A v2)', class: 'pk-settings-subcard', actions: [switchBtn('minimax-tts')] },
              fld('接口地址 Endpoint', 'mm-ep', 'minimaxTtsEndpoint', 'https://api.minimaxi.com/v1/t2a_v2'),
              fgrid([fld('模型 ID（可自由手输）', 'mm-model', 'minimaxTtsModel', 'speech-2.6-hd'), fld('音色 ID', 'mm-voice', 'minimaxTtsVoiceId', 'male-qn-qingse')], { min: 180 }),
              ui.field(
                { label: 'MiniMax API Key', aside: mm.hasApiKey ? ui.check({ value: b.minimaxClearKey, label: '保存时清除已存密钥', onChange: (v) => (b.minimaxClearKey = v) }) : null },
                secretField(ctx, { key: 'ttsb-mm-key', value: b.minimaxTtsApiKey, saved: mm.hasApiKey, masked: mm.apiKeyMasked, placeholder: '粘贴 MiniMax API Key', onInput: (v) => (b.minimaxTtsApiKey = v) }),
              ),
            ),
            ui.section(
              { title: '火山方舟 · 豆包语音 TTS', class: 'pk-settings-subcard', actions: [switchBtn('doubao-tts')] },
              fld('接口地址 Endpoint', 'db-ep', 'doubaoTtsEndpoint', 'https://openspeech.bytedance.com/api/v1/tts'),
              fgrid(
                [
                  fld('火山 AppID', 'db-app', 'doubaoTtsAppId', '火山 AppID'),
                  ui.field(
                    { label: 'Access Token', aside: db.hasToken ? ui.check({ value: b.doubaoClearToken, label: '保存时清除', onChange: (v) => (b.doubaoClearToken = v) }) : null },
                    secretField(ctx, { key: 'ttsb-db-token', value: b.doubaoTtsToken, saved: db.hasToken, masked: db.tokenMasked, placeholder: 'Access Token', onInput: (v) => (b.doubaoTtsToken = v) }),
                  ),
                ],
                { min: 180 },
              ),
              fgrid([fld('集群 Cluster', 'db-cluster', 'doubaoTtsCluster', 'volcano_tts'), fld('音色 voice_type', 'db-voice', 'doubaoTtsVoiceType', '例如 zh_male_...')], { min: 180 }),
            ),
          ],
          { min: 300 },
        ),
      ),
      data.ttsStatus && data.ttsStatus.endpoint ? ui.hint(`当前引擎地址：${data.ttsStatus.endpoint}`) : null,
    ]
  }
  function renderTtsInstall(ctx, data) {
    const L = ctx.local
    const cat = L.ttsCatalog || data.ttsInstallCatalog || {}
    const pkgs = Array.isArray(cat.packages) && cat.packages.length
      ? cat.packages
      : [
          { id: 'edge-tts', name: 'Edge-TTS 神经网络语音', shortName: 'Edge-TTS', vramRequired: '0 GB 纯 CPU', diskRequired: '~30 MB', etaLabel: '约 15 秒', recommendedFor: '无独显 / 轻薄本首选，免下载大模型' },
          { id: 'indextts25', name: 'IndexTTS-2.5 旗舰情感克隆', shortName: 'IndexTTS-2.5', vramRequired: '8 GB+ NVIDIA 显存', diskRequired: '~9 GB', etaLabel: '约 5~15 分钟', recommendedFor: '最高保真情感克隆与 8 维情绪向量' },
          { id: 'gptvoice', name: 'GPT-SoVITS 低显存轻量配音', shortName: 'GPT-SoVITS', vramRequired: '4 GB+ NVIDIA 显存', diskRequired: '~6 GB', etaLabel: '约 5~12 分钟', recommendedFor: '4~6GB 中低配独显快速语音克隆' },
          { id: 'indextts2', name: 'IndexTTS-2 经典版本', shortName: 'IndexTTS-2', vramRequired: '6~8 GB 显存', diskRequired: '~7 GB', etaLabel: '约 5~12 分钟', recommendedFor: '经典 IndexTTS-2 兼容环境' },
        ]
    const running = jobRunning('tts-install')
    const runningLabel = running ? JOBS.get('tts-install').label : ''
    ctx.foot([ui.hint('安装包均来自官方开源仓库；不安装也能用 Windows 原生语音或纯音乐卡点出片'), ui.spacer(), ui.btn('刷新安装状态', () => loadTtsCatalog(ctx), { icon: 'refresh', kind: 'ghost' })])
    return [
      ui.note('全部本地配音模型都是【自由可选】安装：不安装也可以直接用零显卡的「Windows 系统原生中文语音」或「纯音乐卡点（免配音）」。安装完成后插件会自动创建 voices/ 目录、生成默认参考音色并完成接入，不需要任何命令行操作。', { level: 'info', title: '小白也能装' }),
      fgrid(
        [
          ui.field({ label: '安装位置（可选）', en: 'INSTALL DIR', hint: '留空 = 默认目录；建议放在空间充足的非系统盘' }, lineField({ key: 'tts-install-dir', value: L.ttsInstallDir || '', placeholder: `留空默认 ${cat.baseDir || './tts-engines'}`, onInput: (v) => (L.ttsInstallDir = v) })),
          ui.field(
            { label: '下载源', en: 'MIRROR' },
            ui.select({
              value: L.ttsMirror || 'cn',
              options: [
                { value: 'cn', label: '国内高速镜像（HF-Mirror + 清华源）', hint: '国内网络推荐' },
                { value: 'global', label: '官方全球源（HuggingFace + PyPI）', hint: '海外网络或已配置代理时使用' },
              ],
              showHint: true,
              onChange: (v) => (L.ttsMirror = v),
            }),
          ),
        ],
        { min: 260 },
      ),
      ui.grid(
        pkgs.map((pkg) =>
          ui.card({
            key: `tts-pkg-${pkg.id}`,
            title: pkg.shortName || pkg.name || pkg.id,
            body: h('div.pk-stack', { style: { gap: '4px' } }, ui.text(pkg.name || '', { tone: 'muted' }), ui.text(`${pkg.vramRequired || '—'} · 占用 ${pkg.diskRequired || '—'}`, { tone: 'dim' }), pkg.recommendedFor ? ui.text(pkg.recommendedFor, { tone: 'muted' }) : null),
            tags: [pkg.installed ? ui.pill('已安装', 'ok', { dot: true }) : ui.pill(pkg.etaLabel || '可选安装', 'warn'), pkg.active ? ui.pill('使用中', 'acc') : null].filter(Boolean),
            active: Boolean(pkg.active),
            actions: [
              ui.btn(
                running && runningLabel.includes(pkg.shortName || pkg.id) ? '正在自动安装并配置…' : pkg.installed ? '补齐 voices 并重新接入' : `一键安装 ${pkg.shortName || pkg.id} 并接入`,
                () => installTts(ctx, pkg),
                { kind: pkg.installed ? 'secondary' : 'primary', icon: pkg.installed ? 'refresh' : 'download', size: 'sm', disabled: running, block: true },
              ),
            ],
          }),
        ),
        { min: 230 },
      ),
      jobView('tts-install'),
    ]
  }
  function renderTtsCustom(ctx, cfg) {
    const L = ctx.local
    const f = L.ttsC
    const templates = cfg.templates
    const set = (k) => (v) => (f[k] = v)
    const kindFields =
      f.kind === 'cli-command'
        ? [
            fgrid(
              [
                ui.field({ label: '可执行命令', required: true, hint: '例如 edge-tts，或 D:/py/python.exe 的完整路径' }, lineField({ key: 'ttsc-cmd', value: f.command, placeholder: 'edge-tts', onInput: set('command') })),
                ui.field({ label: '输出文件扩展名' }, ui.input({ key: 'ttsc-ext', value: f.outputExt, placeholder: '.wav / .mp3', onInput: set('outputExt') })),
              ],
              { min: 200 },
            ),
            ui.field({ label: '参数模板', hint: '{{text}} 台词 · {{voice}} 音色 · {{output}} 输出文件路径' }, lineField({ key: 'ttsc-args', value: f.argsTemplate, placeholder: '--text {{text}} --voice {{voice}} --write-media {{output}}', onInput: set('argsTemplate'), maxRows: 6 })),
            ui.field({ label: '默认 {{voice}} 变量值', hint: '例如 zh-CN-YunxiNeural' }, lineField({ key: 'ttsc-voice', value: f.voice, placeholder: 'zh-CN-YunxiNeural', onInput: set('voice') })),
          ]
        : f.kind === 'openai-tts'
          ? [
              ui.field({ label: '接口地址', required: true }, lineField({ key: 'ttsc-ep', value: f.endpoint, placeholder: 'http://127.0.0.1:8080/v1/audio/speech', onInput: set('endpoint') })),
              fgrid(
                [
                  ui.field({ label: '模型名 model', hint: '例如 kokoro / fish-speech-1.5' }, lineField({ key: 'ttsc-model', value: f.model, placeholder: 'kokoro', onInput: set('model') })),
                  ui.field({ label: '音色 voice', hint: '例如 alloy / zf_xiaoxiao' }, lineField({ key: 'ttsc-voice', value: f.voice, placeholder: 'zf_xiaoxiao', onInput: set('voice') })),
                  ui.field({ label: '返回格式' }, ui.seg({ value: f.responseFormat, options: withValue(['wav', 'mp3', 'flac', 'opus'].map((x) => ({ value: x, label: x })), f.responseFormat), onChange: set('responseFormat') })),
                  ui.field({ label: '语速' }, ui.slider({ value: U.num(f.speed, 1), min: 0.5, max: 2, step: 0.05, format: (v) => `${Number(v).toFixed(2)}×`, onChange: (v) => (f.speed = v) })),
                ],
                { min: 200 },
              ),
              ui.field(
                { label: '可选 Bearer API Key' },
                secretField(ctx, { key: 'ttsc-key', value: f.apiKey, saved: f.hasApiKey, masked: f.apiKeyMasked, placeholder: '可选 Bearer API Key（本地服务一般不需要）', onInput: set('apiKey') }),
              ),
            ]
          : [
              fgrid(
                [
                  ui.field({ label: '请求方法' }, ui.seg({ value: f.method, options: [{ value: 'POST', label: 'POST' }, { value: 'GET', label: 'GET' }], onChange: set('method') })),
                  ui.field(
                    { label: '返回内容' },
                    ui.select({
                      value: f.responseType,
                      options: [
                        { value: 'binary', label: '直接返回音频流' },
                        { value: 'json_base64', label: 'JSON 里的 base64 音频' },
                        { value: 'json_url', label: 'JSON 里的音频 URL' },
                      ],
                      onChange: set('responseType'),
                    }),
                  ),
                ],
                { min: 200 },
              ),
              ui.field({ label: '接口地址', required: true }, lineField({ key: 'ttsc-ep', value: f.endpoint, placeholder: 'http://127.0.0.1:9882/tts', onInput: set('endpoint') })),
              fgrid(
                [
                  ui.field({ label: 'JSON 返回音频字段名', hint: '返回 JSON 时填写，例如 data.audio' }, lineField({ key: 'ttsc-path', value: f.responseAudioPath, placeholder: 'data.audio', onInput: set('responseAudioPath') })),
                  ui.field({ label: '可选 Bearer API Key' }, secretField(ctx, { key: 'ttsc-key', value: f.apiKey, saved: f.hasApiKey, masked: f.apiKeyMasked, placeholder: '可选 Bearer API Key', onInput: set('apiKey') })),
                ],
                { min: 240 },
              ),
              ui.field(
                { label: 'JSON 请求体模板', hint: '可用变量：{{text}} {{lang}} {{voiceName}} {{refAudio}} {{promptText}} {{speed}}' },
                ui.textarea({ key: 'ttsc-payload', value: f.payloadTemplateText, rows: 5, maxRows: 16, mono: true, onInput: set('payloadTemplateText'), expand: { title: 'JSON 请求体模板' } }),
              ),
            ]
    ctx.foot([
      ui.hint('保存后立即切换为这个配音模型'),
      ui.spacer(),
      f.editingId
        ? ui.btn('改为新建', () => {
            L.ttsC = customTtsBlank()
            resetBase(ctx, 'ttsC')
            ctx.render()
          }, { kind: 'ghost', icon: 'plus' })
        : null,
      actBtn(ctx, 'ttsc-save', f.editingId ? '保存修改并启用' : '保存并启用该模型', () => saveCustomTts(ctx), { kind: 'primary', icon: 'save', busyText: '保存中…' }),
    ])
    return [
      f.editingId ? ui.note(`正在编辑「${f.name || f.editingId}」。密钥留空 = 保持已保存的不变。`, { level: 'info', title: '编辑自定义模型' }) : null,
      ui.section(
        { title: '一键填充常用模板', en: 'TEMPLATES', icon: 'sparkle', desc: '先点一个模板，再按你的实际地址修改。' },
        ui.row(
          templates.map((tpl) =>
            ui.btn(tpl.label, () => {
              const eng = (tpl && tpl.engine) || {}
              L.ttsC = { ...customTtsFromEngine({ ...eng, id: eng.id || `custom-${Date.now().toString(36)}`, name: eng.name || tpl.label }, false) }
              ctx.render()
              PK.toast(`已载入模板「${tpl.label}」，按需修改后点「保存并启用该模型」`, 'info')
            }, { size: 'sm', kind: 'ghost', icon: 'plus', title: tpl.label }),
          ),
        ),
      ),
      fgrid(
        [
          ui.field({ label: '模型名称', required: true }, ui.input({ key: 'ttsc-name', value: f.name, placeholder: '例如 Edge-TTS 纯 CPU', onInput: set('name'), maxLength: 80 })),
          ui.field({ label: '配置标识', hint: '显示在卡片上的小标签' }, ui.input({ key: 'ttsc-badge', value: f.vramBadge, placeholder: '例如 0GB 纯 CPU', onInput: set('vramBadge'), maxLength: 40 })),
        ],
        { min: 220 },
      ),
      ui.field(
        { label: '接入方式', en: 'KIND' },
        ui.seg({
          value: f.kind,
          options: [
            { value: 'openai-tts', label: 'OpenAI /v1/audio/speech 协议' },
            { value: 'http-json', label: '通用 HTTP JSON / GET API' },
            { value: 'cli-command', label: '本地命令行 / Python（免 HTTP）' },
          ],
          onChange: (v) => {
            f.kind = v
            ctx.render()
          },
        }),
      ),
      ...kindFields,
    ]
  }
  function renderTtsImport(ctx, cfg, active) {
    const L = ctx.local
    ctx.foot([
      ui.btn('导出当前模型到文本框', () => {
        L.ttsJson = JSON.stringify(safeEngineCopy(active), null, 2)
        ctx.render()
        PK.toast('已把当前引擎的配置导出到输入框（已自动去掉密钥）', 'info')
      }, { icon: 'download', kind: 'ghost' }),
      ui.btn('复制', async () => {
        const ok = await U.copyText(S(L.ttsJson))
        PK.toast(ok ? '已复制到剪贴板' : '复制失败，请手动全选复制', ok ? 'success' : 'warn')
      }, { icon: 'copy', kind: 'ghost', disabled: !S(L.ttsJson).trim() }),
      ui.spacer(),
      actBtn(ctx, 'tts-import', '一键导入并启用', () => importTtsJson(ctx), { kind: 'primary', icon: 'upload', busyText: '导入中…' }),
    ])
    return [
      ui.text('可以把网上或朋友分享的配音模型配置 JSON 直接粘贴进来导入；也可以把当前引擎导出来分享给别人（导出时会自动去掉密钥）。', { tone: 'muted' }),
      ui.row([ui.file('从 .json 文件载入', async (files) => {
        const f = files[0]
        if (!f) return
        if (f.size > 2 * 1024 * 1024) throw new PK.Error('这个文件太大了，不像是配音模型配置（应小于 2MB）')
        L.ttsJson = typeof f.text === 'function' ? await f.text() : await new Response(f).text()
        ctx.render()
      }, { accept: '.json,application/json', kind: 'ghost', size: 'sm', icon: 'folder', busyText: '读取中…' })]),
      ui.textarea({
        key: 'tts-json',
        value: S(L.ttsJson),
        rows: 8,
        maxRows: 22,
        mono: true,
        placeholder: '{\n  "id": "my-tts",\n  "name": "我的轻量语音模型",\n  "kind": "openai-tts",\n  "endpoint": "http://127.0.0.1:8080/v1/audio/speech",\n  "model": "kokoro",\n  "voice": "zf_xiaoxiao"\n}',
        onInput: (v) => (L.ttsJson = v),
        expand: { title: '配音模型 JSON 配置' },
      }),
    ]
  }

  /* ---- render: tab · 云端生成（接口与密钥） */
  function renderCloudCfg(ctx) {
    const cm = ctx.data.cloudMedia || {}
    const L = ctx.local
    const D = L.cloudCfg
    const cat = CLOUD_CATS.some((c) => c.value === L.cloudCat) ? L.cloudCat : 'image'
    const d = D[cat]
    const sumCat = cm[cat] || {}
    const presets = (cm.presets && cm.presets[cat]) || []
    const preset = presets.find((p) => p.id === d.providerId) || null
    const setC = (k) => (v) => (d.custom[k] = v)
    const configured = CLOUD_CATS.filter((c) => (cm[c.value] || {}).hasApiKey || ((cm[c.value] || {}).protocol === 'custom' && S((cm[c.value] || {}).custom && cm[c.value].custom.submitUrl))).length
    ctx.foot([
      ui.hint('密钥只保存在本机，不会上传；生成结果先进预览验收区，满意再入库'),
      ui.spacer(),
      ui.btn('去生成', () => PK.open('cloud', { cat }), { icon: 'cloud', kind: 'ghost' }),
      actBtn(ctx, 'cloud-save', '保存云端接口配置', () => saveCloudCfg(ctx), { kind: 'primary', icon: 'save', busyText: '保存中…' }),
    ])
    return [
      ui.note(`已配置 ${configured} / 3 个类别。全部为可选功能：用你自己的密钥（BYOK）按服务商价格计费，不配置也不影响本地出片。`, { level: configured ? 'ok' : 'info', title: '云端生图 / 生视频 / 音乐' }),
      ui.tabs({
        value: cat,
        items: CLOUD_CATS.map((c) => ({ value: c.value, label: c.label, icon: c.icon, badge: (cm[c.value] || {}).hasApiKey ? '✓' : '' })),
        onChange: (v) => {
          L.cloudCat = v
          ctx.render()
        },
      }),
      fgrid(
        [
          ui.field(
            { label: '云端模型 / 协议预设', en: 'PRESET' },
            ui.select({
              key: `cloudcfg-preset-${cat}`,
              value: d.providerId,
              options: presets.map((p) => ({ value: p.id, label: p.name, hint: p.docsHint })),
              searchable: false,
              onChange: (v) => {
                applyCloudPreset(d, presets.find((p) => p.id === v))
                ctx.render()
              },
            }),
          ),
          ui.field(
            {
              label: `API Key ${sumCat.hasApiKey ? '· 已保存' : '· 未配置'}`,
              en: 'SECRET',
              hint: preset && preset.authType === 'kling-jwt-or-bearer' ? '可灵可以直接填 Bearer Token，或填 AccessKey:SecretKey' : preset && preset.authType === 'doubao-appid-token' ? '豆包语音填 AppID:Token' : '每个类别保存一个密钥',
              aside: sumCat.hasApiKey ? ui.check({ value: d.clearApiKey, label: '保存时清除', onChange: (v) => (d.clearApiKey = v) }) : null,
            },
            secretField(ctx, { key: `cloudcfg-key-${cat}`, value: d.apiKey, saved: sumCat.hasApiKey, masked: sumCat.apiKeyMasked, placeholder: '粘贴 API Key（可灵可填 AK:SK）', onInput: (v) => (d.apiKey = v) }),
          ),
        ],
        { min: 260 },
      ),
      preset && (preset.docsHint || preset.referenceImages)
        ? ui.note([preset.docsHint, preset.referenceImages ? `角色参考图：${preset.referenceImages}` : ''].filter(Boolean).join('\n'), { level: 'info' })
        : null,
      d.protocol !== 'custom'
        ? h(
            'div.pk-stack',
            null,
            ui.field({ label: '接口根地址 Base URL', hint: '服务商的接口根地址；国内 / 海外节点不同时在这里改' }, lineField({ key: `cloudcfg-base-${cat}`, value: d.baseUrl, placeholder: 'https://…', onInput: (v) => (d.baseUrl = v) })),
            fgrid(
              [
                ui.field({ label: '接口路径 Endpoint' }, lineField({ key: `cloudcfg-ep-${cat}`, value: d.endpoint, placeholder: '/v1/…', onInput: (v) => (d.endpoint = v) })),
                ui.field({ label: '模型 ID（可自由手输）' }, lineField({ key: `cloudcfg-model-${cat}`, value: d.model, placeholder: cat === 'audio' ? 'music-3.0 / chirp-v4-5' : '自由输入模型 ID', onInput: (v) => (d.model = v) })),
              ],
              { min: 240 },
            ),
          )
        : ui.section(
            { title: '自定义云端 HTTP / JSON 协议', en: 'CUSTOM PROTOCOL', icon: 'code', desc: `可用变量：${CLOUD_VARS}` },
            ui.field({ label: '提交 URL（Submit URL）', required: true }, lineField({ key: `cloudcfg-c-url-${cat}`, value: d.custom.submitUrl, placeholder: 'https://api.example.com/v1/generate', onInput: setC('submitUrl') })),
            fgrid(
              [
                ui.field({ label: '请求方法' }, ui.seg({ value: d.custom.method || 'POST', options: ['POST', 'GET'].map((m) => ({ value: m, label: m })), onChange: setC('method') })),
                ui.field({ label: '取结果方式' }, ui.seg({ value: d.custom.mode || 'sync', options: [{ value: 'sync', label: '同步直出' }, { value: 'async-poll', label: '异步轮询' }], onChange: (v) => {
                  d.custom.mode = v
                  ctx.render()
                } })),
              ],
              { min: 200 },
            ),
            fgrid(
              [
                ui.field({ label: '请求头 Headers JSON' }, ui.textarea({ key: `cloudcfg-c-headers-${cat}`, value: S(d.custom.headersJson), rows: 3, maxRows: 12, mono: true, onInput: setC('headersJson'), expand: { title: 'Headers JSON' } })),
                ui.field({ label: '请求体模板 Body JSON' }, ui.textarea({ key: `cloudcfg-c-body-${cat}`, value: S(d.custom.bodyTemplateJson), rows: 3, maxRows: 12, mono: true, onInput: setC('bodyTemplateJson'), expand: { title: 'Body 模板 JSON' } })),
              ],
              { min: 260 },
            ),
            d.custom.mode === 'async-poll'
              ? fgrid(
                  [
                    ui.field({ label: '轮询 URL 模板', hint: '用 {{taskId}} 代表任务 ID' }, lineField({ key: `cloudcfg-c-poll-${cat}`, value: d.custom.pollUrlTemplate, placeholder: 'https://api.example.com/v1/tasks/{{taskId}}', onInput: setC('pollUrlTemplate') })),
                    ui.field({ label: '任务 ID 路径', hint: '提交后返回的任务 ID 在 JSON 里的位置' }, lineField({ key: `cloudcfg-c-tid-${cat}`, value: d.custom.taskIdPath, placeholder: 'data.task_id', onInput: setC('taskIdPath') })),
                    ui.field({ label: '状态路径' }, lineField({ key: `cloudcfg-c-status-${cat}`, value: d.custom.statusPath, placeholder: 'data.status', onInput: setC('statusPath') })),
                    ui.field({ label: '成功状态值', hint: '逗号分隔' }, lineField({ key: `cloudcfg-c-ok-${cat}`, value: d.custom.successValues, placeholder: 'succeeded,completed,done', onInput: setC('successValues') })),
                    ui.field({ label: '失败状态值', hint: '逗号分隔' }, lineField({ key: `cloudcfg-c-fail-${cat}`, value: d.custom.failValues, placeholder: 'failed,error', onInput: setC('failValues') })),
                  ],
                  { min: 220 },
                )
              : null,
            fgrid(
              [
                ui.field({ label: '结果提取路径', hint: '例如 data.audio / data.0.url' }, lineField({ key: `cloudcfg-c-res-${cat}`, value: d.custom.resultUrlPath, placeholder: 'data.0.url', onInput: setC('resultUrlPath') })),
                ui.field(
                  { label: '结果格式' },
                  ui.select({
                    value: d.custom.resultFormat || 'url',
                    options: [
                      { value: 'url', label: '直链 URL' },
                      { value: 'base64', label: 'Base64' },
                      { value: 'hex', label: 'Hex（MiniMax）' },
                      { value: 'binary', label: '原始二进制' },
                    ],
                    onChange: setC('resultFormat'),
                  }),
                ),
              ],
              { min: 220 },
            ),
          ),
      stockKeysSection(ctx, cm, D),
      ui.toggle({
        value: Boolean(D.autoUseCloudBroll),
        label: '出片时自动为缺画面的分镜补 B-roll',
        hint: '顺序：先用你已导入的素材 → 免费正版素材库 → 付费云端生成（仅在显式开启付费额度时才会花钱）',
        onChange: (v) => (D.autoUseCloudBroll = v),
      }),
    ]
  }
  /* ---- 免费素材库 Key (Pexels / Pixabay): saved with the cloud config; .env keys still work and show as 「来自 .env」 */
  const STOCK_KEY_DEFS = [
    { id: 'pexels', name: 'Pexels', clear: 'clearPexels', url: 'https://www.pexels.com/api/' },
    { id: 'pixabay', name: 'Pixabay', clear: 'clearPixabay', url: 'https://pixabay.com/api/docs/' },
  ]
  function stockKeysSection(ctx, cm, D) {
    const info = (cm && cm.stock) || {}
    const s = D.stock || (D.stock = { pexels: '', pixabay: '', clearPexels: false, clearPixabay: false })
    return ui.section(
      {
        title: '免费正版素材库 Key',
        en: 'FREE STOCK · PEXELS / PIXABAY',
        icon: 'image',
        desc: '「版本历史与工程安全 → 免费素材」检索和自动补画面要用的免费 Key（填一个就能用，可在官网免费申请），点右下角保存后立即生效。.env 里的 PEXELS_API_KEY / PIXABAY_API_KEY 也照样能用，这里保存的优先。',
      },
      fgrid(
        STOCK_KEY_DEFS.map((p) => {
          const k = info[p.id] || {}
          return ui.field(
            {
              label: `${p.name} API Key · ${k.sourceLabel || '未配置'}`,
              en: p.id.toUpperCase(),
              hint: `免费申请：${p.url}`,
              aside: k.hasSavedKey ? ui.check({ value: s[p.clear], label: '保存时清除', onChange: (v) => (s[p.clear] = v) }) : null,
            },
            secretField(ctx, {
              key: `stockkey-${p.id}`,
              value: s[p.id],
              saved: k.hasSavedKey,
              masked: k.savedKeyMasked,
              placeholder: k.hasEnvKey ? `正在用 .env 里的 Key（${k.envKeyMasked || '***'}）· 粘贴新 Key 可覆盖` : `粘贴 ${p.name} API Key`,
              onInput: (v) => (s[p.id] = v),
            }),
          )
        }),
        { min: 260 },
      ),
    )
  }

  /* ---- render: tab · 通用偏好 */
  function renderGeneral(ctx) {
    const data = ctx.data
    const prefs = (ctx.local.hw && ctx.local.hw.hardwarePreferences) || data.hardwarePreferences || {}
    const policy = (ctx.local.hw && ctx.local.hw.hardwarePolicy) || data.hardwarePolicy || null
    const a = data.authorInfo || {}
    const llm = data.llmConfig || {}
    const tts = normTts(data.ttsConfig)
    ctx.foot([ui.hint('皮肤（外观）请在顶栏的皮肤切换里更换'), ui.spacer(), ui.btn('关闭', () => ctx.close(), { kind: 'ghost' })])
    return [
      ui.section(
        { title: '低配电脑保护', en: 'LOW-SPEC PROTECTION', icon: 'cpu', desc: '电脑卡顿或渲染时内存不够就打开保护；高配机器可以开全速。', actions: [ui.btn('打开算力体检', () => PK.open('hardware'), { size: 'sm', kind: 'ghost', icon: 'cpu' })] },
        lowSpecCards(ctx, prefs, policy, (res) => {
          ctx.local.hw = res
        }),
      ),
      ui.section(
        { title: '数据与密钥存放', en: 'PRIVACY', icon: 'lock', desc: '所有密钥只保存在你这台电脑上，不会上传到任何服务器，也不会写进 Git。' },
        ui.kv([
          ['大模型配置', llm.configFile ? ui.mono(llm.configFile) : '本机插件目录'],
          ['配音引擎配置', tts.configPath ? ui.mono(tts.configPath) : '本机插件目录'],
          ['云端生成密钥', '插件目录 .dsh-video-cloud-media.json'],
          ['数字人接口', '本机插件数据目录 avatar-config.json'],
        ]),
      ),
      ui.section(
        { title: '快捷入口', en: 'SHORTCUTS', icon: 'grid' },
        ui.row([
          ui.btn('配音中心', () => PK.open('voices'), { icon: 'voice' }),
          ui.btn('云端媒体中心', () => PK.open('cloud'), { icon: 'cloud' }),
          ui.btn('数字人', () => PK.open('avatar'), { icon: 'user' }),
          ui.btn('算力体检', () => PK.open('hardware'), { icon: 'cpu' }),
          ui.btn('使用帮助', () => PK.open('help'), { icon: 'help' }),
        ]),
      ),
      a.name ? ui.section({ title: '关于', en: 'ABOUT', icon: 'info' }, authorNote(a)) : null,
    ]
  }
  function authorNote(a) {
    return ui.note(
      h(
        'div.pk-stack',
        { style: { gap: '4px' } },
        ui.text(`作者：${a.name || '—'}${a.qq ? ` · QQ：${a.qq}` : ''}${a.wechat ? ` · 微信：${a.wechat}` : ''}${a.email ? ` · 邮箱：${a.email}` : ''}`),
        a.github ? ui.row([ui.text(`官方仓库：${a.github}`, { mono: true, tone: 'muted' }), ui.iconBtn('copy', async () => {
          const ok = await U.copyText(a.github)
          PK.toast(ok ? '仓库地址已复制' : '复制失败', ok ? 'success' : 'warn')
        }, { title: '复制仓库地址' })], { wrap: true }) : null,
        a.notice ? ui.text(a.notice, { tone: 'dim' }) : null,
      ),
      { level: 'info', title: `原创作者署名与开源版权声明${a.license ? `（${a.license}）` : ''}` },
    )
  }

  PK.panel('keys', {
    title: '设置 · 模型与密钥',
    en: 'SETTINGS · LLM / TTS / CLOUD KEYS',
    idx: '⚙',
    icon: 'settings',
    kind: 'modal',
    size: 'lg',
    group: 'settings',
    order: 10,
    desc: '大模型、配音引擎、云端生成的接口与密钥，低配保护',
    aliases: { llm: { tab: 'llm' }, tts: { tab: 'tts' }, settings: {}, preferences: { tab: 'general' }, cloudKeys: { tab: 'cloud' }, ttsInstall: { tab: 'tts', sub: 'install' } },
    watch: (s) => s && s.rev,
    onWatch: async (ctx) => {
      await ctx.load()
      ctx.local.hw = null
      syncKeyDrafts(ctx)
      ctx.update()
    },
    mount(ctx) {
      const a = ctx.args || {}
      ctx.local.tab = KEY_TABS.includes(a.tab) ? a.tab : 'llm'
      ctx.local.ttsSub = ['engines', 'install', 'add', 'import'].includes(a.sub) ? a.sub : 'engines'
      ctx.local.cloudCat = CLOUD_CATS.some((c) => c.value === a.cat) ? a.cat : 'image'
      ctx.listen('settings:jobs', () => ctx.update())
      ctx.load().then(() => {
        syncKeyDrafts(ctx, true)
        ctx.update()
      })
      if (ctx.local.ttsSub === 'install') loadTtsCatalog(ctx, true)
    },
    onArgs(ctx, a) {
      if (KEY_TABS.includes(a.tab)) ctx.local.tab = a.tab
      if (['engines', 'install', 'add', 'import'].includes(a.sub)) ctx.local.ttsSub = a.sub
      if (CLOUD_CATS.some((c) => c.value === a.cat)) ctx.local.cloudCat = a.cat
      if (ctx.local.ttsSub === 'install') loadTtsCatalog(ctx, true)
      ctx.render()
    },
    beforeClose(ctx, reason) {
      if (!['x', 'esc', 'scrim'].includes(reason)) return true
      const dirty = keysDirty(ctx)
      if (!dirty.length) return true
      PK.confirm({ title: '有修改还没保存', text: `「${dirty.join('、')}」里的修改还没有保存，关闭后会丢失。`, ok: '放弃修改并关闭', cancel: '继续编辑', danger: true }).then((ok) => {
        if (ok) ctx.frame.close('force')
      })
      return false
    },
    render(ctx) {
      if (!ctx.data) return ctx.loadError ? ui.errorBox(ctx.loadError, () => ctx.load(true).then(() => syncKeyDrafts(ctx, true))) : ui.loading('正在读取模型与引擎配置…')
      if (!ctx.local.llm) syncKeyDrafts(ctx, true)
      const data = ctx.data
      const llm = data.llmConfig || {}
      const tts = normTts(data.ttsConfig)
      const cm = data.cloudMedia || {}
      const cloudN = CLOUD_CATS.filter((c) => (cm[c.value] || {}).hasApiKey).length
      const prefs = (ctx.local.hw && ctx.local.hw.hardwarePreferences) || data.hardwarePreferences || {}
      const tab = ctx.local.tab
      const tabs = ui.tabs({
        value: tab,
        items: [
          { value: 'llm', label: '文本大模型', icon: 'wand', badge: llm.configured ? '✓' : '未配置' },
          { value: 'tts', label: '配音引擎', icon: 'voice', badge: engLabel(tts.engines.find((e) => e.id === tts.activeEngineId)) },
          { value: 'cloud', label: '云端生成', icon: 'cloud', badge: `${cloudN}/3` },
          { value: 'general', label: '通用偏好', icon: 'settings', badge: lowSpecLabel(prefs.lowSpecMode || 'auto') },
        ],
        onChange: (v) => {
          ctx.local.tab = v
          ctx.foot(null)
          ctx.render()
        },
      })
      let body
      try {
        body = tab === 'tts' ? renderTts(ctx) : tab === 'cloud' ? renderCloudCfg(ctx) : tab === 'general' ? renderGeneral(ctx) : renderLlm(ctx)
      } catch (err) {
        console.error('[PK] keys tab failed', err)
        body = [ui.errorBox(err, () => ctx.render())]
      }
      return [tabs, ...body]
    },
  })

  /* ============================================================================================== 配音中心 */
  const GENDER_LABEL = { female: '女声', male: '男声', neutral: '中性' }
  const AGE_LABEL = { child: '孩童', youth: '青年', adult: '成年', 'middle-aged': '中年', elderly: '老年' }
  const isImportedVoice = (v) =>
    Boolean(v) && (v.source === 'user-imported-pack' || v.source === 'user-imported-file' || /^imported[\\/]/.test(S(v.category)) || /^clone-/.test(S(v.id)) || v.category === '专属声纹克隆')
  const isClonedVoice = (v) => Boolean(v) && (v.isCloned || /^clone-/.test(S(v.id)) || v.category === '专属声纹克隆')
  const canPreview = (v) => Boolean(v) && v.available !== false && !v.isLegacyPt && v.isAudioSample !== false
  const voiceNameOf = (id, list) => (!id || id === 'auto' ? 'AI 自动匹配' : S(((list || []).find((v) => v.id === id) || {}).name) || id)
  const voicesOf = (ctx) => (Array.isArray(ctx.local.catalog) ? ctx.local.catalog : (ctx.data && Array.isArray(ctx.data.voiceCatalog) ? ctx.data.voiceCatalog : []))
  const MAX_AUDIO_UPLOAD = 60 * 1024 * 1024
  const MAX_PACK_UPLOAD = 150 * 1024 * 1024

  /**
   * 试听 / 停止 toggle that stays correct across panel re-renders: one stable audio owner per key (ui.playBtn makes a
   * new owner on every render, and its busy label restore overwrote 「停止」). Errors are already toasted by PK.audio.
   */
  function playToggle(ctx, key, src, o = {}) {
    const owners = (ctx.local.playOwners = ctx.local.playOwners || {})
    const owner = owners[key] || (owners[key] = {})
    const label = o.label || '试听'
    const b = ui.btn(label, async () => {
      if (PK.audio.isOwner(owner)) {
        PK.audio.stop()
        return
      }
      const url = typeof src === 'function' ? await src() : src
      if (!url) throw new PK.Error('没有可播放的音频')
      try {
        await PK.audio.play(url, owner)
      } catch (err) {
        const n = S(err && err.name)
        if (n === 'AbortError' || n === 'NotSupportedError') return // replaced by another preview / already toasted by PK.audio
        throw new PK.Error(n === 'NotAllowedError' ? '浏览器拦截了自动播放：请再点一次「试听」' : `音频无法播放：${S(err && err.message) || n}`)
      }
    }, { icon: 'play', size: 'sm', title: o.title, key: `play-${key}` })
    const paint = (on) => {
      const l = b.querySelector('.pk-btn-l')
      if (l) l.textContent = on ? '停止' : label
      const ic = b.querySelector('svg')
      if (ic) ic.replaceWith(PK.icon(on ? 'stop' : 'play', 13))
      b.classList.toggle('is-playing', on)
    }
    owner.onState = (on) => {
      if (b.isConnected) paint(on)
    }
    if (PK.audio.isOwner(owner)) paint(true)
    return b
  }

  async function setMainVoice(v, list) {
    const id = v === 'auto' ? 'auto' : v.id
    const applied = (s) => s && s.director && s.director.voiceId === id
    await PK.action('setDirector', { patch: { voiceId: id } })
    let ok = await PK.waitState(applied, 4000)
    if (!ok) {
      // the host only accepts voices it already knows: a just-imported / cloned voice needs one host refresh first
      await hostRefresh()
      await PK.action('setDirector', { patch: { voiceId: id } })
      ok = await PK.waitState(applied, 5000)
    }
    if (!ok) throw new PK.Error('主讲音色没有生效：音色列表可能还没刷新，请稍等一两秒再试')
    PK.toast(id === 'auto' ? '主讲已设为「AI 自动匹配」：每个分镜会按内容自动挑选音色' : `已将「${voiceNameOf(id, list)}」设为全片主配音`, 'success')
  }
  async function deleteVoice(ctx, v) {
    const ok = await PK.confirm({ title: '删除这个音色？', text: `确定删除导入 / 克隆的音色「${v.name || v.id}」吗？会同时删除它的参考音频文件，无法撤销。`, ok: '永久删除', danger: true })
    if (!ok) return
    const res = await PK.post('voices/delete', { voiceId: v.id })
    if (res && Array.isArray(res.voiceCatalog)) ctx.local.catalog = res.voiceCatalog
    const cur = st().director && st().director.voiceId
    if (cur === v.id) {
      try {
        await PK.action('setDirector', { patch: { voiceId: 'auto' } })
      } catch {}
    }
    if (ctx.local.clone && ctx.local.clone.auditionId === v.id) ctx.local.clone.auditionId = ''
    PK.toast(`已删除音色「${(res && res.name) || v.name || v.id}」`, 'info')
    ctx.update()
  }

  /* ---- microphone (MediaRecorder inside the skin iframe; the host iframe has allow="microphone") */
  function micErrorText(err) {
    const s = `${(err && err.name) || ''} ${(err && err.message) || ''}`
    if (/NotAllowed|Permission|denied|Security/i.test(s)) return '麦克风权限被拦截了：请在 Windows「设置 → 隐私和安全性 → 麦克风」里允许应用使用麦克风（DSH 桌面端也需要允许），然后再点一次「开始录音」；也可以改用「选录音文件上传」。'
    if (/NotFound|DevicesNotFound|Overconstrained/i.test(s)) return '没有检测到可用的麦克风：请插上麦克风或耳机后再试；也可以改用「选录音文件上传」。'
    if (/NotReadable|TrackStart|Abort/i.test(s)) return '麦克风正被其他程序占用（例如会议软件、录屏工具）：关闭它们后再试，或改用「选录音文件上传」。'
    if (/NotSupported|not supported/i.test(s)) return '当前环境用不了麦克风（这台电脑可能没有接麦克风，或桌面端没有开放麦克风权限）：插上麦克风 / 耳机后再试，或改用「选录音文件上传」。'
    return `无法开启麦克风（${S(err && err.message) || '未知原因'}）：可以改用「选录音文件上传」。`
  }
  function stopMicHardware(m) {
    if (!m) return
    clearInterval(m.timer)
    m.timer = 0
    if (m.raf) cancelAnimationFrame(m.raf)
    m.raf = 0
    try {
      if (m.ac) m.ac.close()
    } catch {}
    m.ac = null
    try {
      if (m.rec && m.rec.state !== 'inactive') m.rec.stop()
    } catch {}
  }
  async function startMic(ctx) {
    const C = ctx.local.clone
    C.micError = ''
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function' || typeof MediaRecorder === 'undefined') {
      C.micError = '当前环境不支持麦克风直录：请改用「选录音文件上传」，或在系统浏览器里打开工作台。'
      ctx.render()
      return
    }
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (err) {
      C.micError = micErrorText(err)
      ctx.render()
      return
    }
    const m = (ctx.local.mic = { stream, chunks: [], secs: 0, timer: 0, raf: 0, ac: null, rec: null, level: 0 })
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      if (AC) {
        const ac = new AC()
        m.ac = ac
        const an = ac.createAnalyser()
        an.fftSize = 128
        ac.createMediaStreamSource(stream).connect(an)
        const arr = new Uint8Array(an.frequencyBinCount)
        const loop = () => {
          an.getByteFrequencyData(arr)
          let sum = 0
          for (const x of arr) sum += x
          m.level = Math.min(100, Math.round(sum / arr.length))
          const bar = ctx.body.querySelector('[data-mic-vu] .pk-meter-t > i')
          if (bar) bar.style.width = `${m.level}%`
          m.raf = requestAnimationFrame(loop)
        }
        m.raf = requestAnimationFrame(loop)
      }
    } catch {}
    let rec
    try {
      rec = new MediaRecorder(stream)
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop())
      stopMicHardware(m)
      ctx.local.mic = null
      C.micError = `浏览器无法录音：${S(err && err.message)}。请改用「选录音文件上传」。`
      ctx.render()
      return
    }
    m.rec = rec
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) m.chunks.push(ev.data)
    }
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      stopMicHardware(m)
      if (ctx.local.mic === m) ctx.local.mic = null
      if (ctx.frame.closed || m.discard) return
      const blob = new Blob(m.chunks, { type: rec.mimeType || 'audio/webm' })
      if (!blob.size) {
        C.micError = '没有录到声音，请检查麦克风后重试。'
        ctx.render()
        return
      }
      const ext = /ogg/.test(blob.type) ? 'ogg' : /mp4|aac/.test(blob.type) ? 'm4a' : 'webm'
      setCloneSample(ctx, { blob, b64: await U.fileToBase64(blob), fileName: `mic-clone-${Date.now()}.${ext}`, secs: m.secs, from: 'mic' })
      if (!S(C.name).trim()) C.name = `我的声线-${new Date().toTimeString().slice(0, 5).replace(':', '')}`
      PK.toast(m.secs < 3 ? `录音只有 ${m.secs} 秒，有点短：建议录 5–12 秒效果更好` : '录音完成！下一步：给声线起个名字，然后点「一键降噪标准化并入库」', m.secs < 3 ? 'warn' : 'success')
      ctx.render()
    }
    rec.start(250)
    m.timer = setInterval(() => {
      m.secs += 1
      const t = ctx.body.querySelector('[data-mic-secs]')
      if (t) t.textContent = `${m.secs} 秒 / 最长 15 秒`
      if (m.secs >= 15) stopMic(ctx)
    }, 1000)
    ctx.render()
  }
  function stopMic(ctx, discard) {
    const m = ctx.local.mic
    if (!m) return
    m.discard = Boolean(discard)
    clearInterval(m.timer)
    m.timer = 0
    try {
      if (m.rec && m.rec.state !== 'inactive') m.rec.stop()
    } catch {}
    if (discard || !m.rec) {
      try {
        if (m.stream) m.stream.getTracks().forEach((t) => t.stop())
      } catch {}
      stopMicHardware(m)
      ctx.local.mic = null
    }
  }
  function setCloneSample(ctx, s) {
    const C = ctx.local.clone
    if (C.sample && C.sample.url) URL.revokeObjectURL(C.sample.url)
    C.sample = s ? { ...s, url: s.blob ? URL.createObjectURL(s.blob) : '' } : null
  }
  async function pickCloneFile(ctx, file) {
    if (!file) return
    if (file.size > MAX_AUDIO_UPLOAD) throw new PK.Error(`文件太大（${U.fmtBytes(file.size)}）：克隆只需要 5–15 秒的干净人声，请先剪短再上传`)
    const C = ctx.local.clone
    setCloneSample(ctx, { blob: file, b64: await U.fileToBase64(file), fileName: S(file.name) || 'voice-sample.wav', from: 'file' })
    if (!S(C.name).trim()) C.name = S(file.name).replace(/\.[^.]+$/, '')
    PK.toast(`已载入参考人声「${file.name}」，下一步点「一键降噪标准化并入库」`, 'info')
    ctx.render()
  }
  async function submitClone(ctx) {
    const C = ctx.local.clone
    if (C.mode === 'path') {
      const p = S(C.path).trim()
      if (!p) throw new PK.Error('请先填写本机音频文件的完整路径（.wav / .mp3 / .flac / .pt）')
      const res = await PK.post('voices/import', { sourcePath: p, name: S(C.name).trim() || undefined, gender: C.gender, promptText: S(C.prompt).trim() }, { timeout: 600000 })
      if (res && Array.isArray(res.voiceCatalog)) ctx.local.catalog = res.voiceCatalog
      const first = res && res.importedVoices && res.importedVoices[0]
      if (first) C.auditionId = first.id
      PK.toast(`音色已加入专属库${first ? `：「${first.name}」` : ''}，可以在第 ③ 步试听`, 'success')
      return
    }
    if (!C.sample || !C.sample.b64) throw new PK.Error('请先完成第 ① 步：录一段 5–12 秒清晰人声，或上传本地录音')
    const res = await PK.post(
      'voices/clone-upload',
      { audioBase64: C.sample.b64, fileName: C.sample.fileName || 'voice-clone.webm', name: S(C.name).trim() || '我的专属声线', gender: C.gender, promptText: S(C.prompt).trim(), stripSilence: true },
      { timeout: 600000 },
    )
    if (res && Array.isArray(res.voiceCatalog)) ctx.local.catalog = res.voiceCatalog
    C.auditionId = S(res && res.voice && res.voice.id)
    setCloneSample(ctx, null)
    PK.toast(`声纹克隆入库成功！音色「${S(res && res.voice && res.voice.name) || C.name}」${res && res.durationSec ? `（有效人声 ${res.durationSec} 秒）` : ''}，可以在第 ③ 步试听`, 'success')
  }
  async function auditionClone(ctx) {
    const C = ctx.local.clone
    const list = voicesOf(ctx)
    const vid = C.auditionId || S((list.find(isClonedVoice) || {}).id) || 'auto'
    const res = await PK.post('voices/clone-preview', { voiceId: vid, text: S(C.text).trim(), emotion: '温暖' }, { timeout: 300000 })
    if (!res || !res.audioDataUrl) throw new PK.Error('试听没有生成音频，请检查配音引擎是否已就绪（设置 · 模型与密钥 → 配音引擎）')
    C.auditionUrl = res.audioDataUrl
    C.auditionId = S(res.voiceUsed) || vid
    PK.audio.play(res.audioDataUrl, C).catch(() => {})
    PK.toast(`试听合成完毕${res.durationSec ? `（${U.num(res.durationSec).toFixed(1)} 秒）` : ''}`, 'success')
  }
  async function importVoiceFiles(ctx, files) {
    const I = ctx.local.imp
    const list = Array.from(files || [])
    if (!list.length) return
    if (I.progress) throw new PK.Error('上一批音色还在导入中，请等它完成再继续')
    const tooBig = list.find((f) => f.size > MAX_PACK_UPLOAD)
    if (tooBig) throw new PK.Error(`「${tooBig.name}」太大（${U.fmtBytes(tooBig.size)}）：超过 150MB 的音色包请改用下方「填本地路径导入」`)
    const done = []
    try {
      for (let i = 0; i < list.length; i++) {
        const f = list[i]
        I.progress = { i: i + 1, n: list.length, name: f.name }
        ctx.update()
        let res
        try {
          res = await PK.post(
            'voices/import',
            {
              dataBase64: await U.fileToBase64(f),
              fileName: f.name,
              name: list.length === 1 && S(I.name).trim() ? S(I.name).trim() : undefined,
              gender: I.gender || '',
              category: S(I.category).trim() || '',
              tags: S(I.tags).trim(),
              promptText: list.length === 1 ? S(I.prompt).trim() : '',
            },
            { timeout: 900000 },
          )
        } catch (err) {
          throw new PK.Error(`「${f.name}」导入失败：${S(err && err.message) || '未知原因'}${done.length ? `（前面 ${done.length} 个已成功导入）` : ''}`)
        }
        if (res && Array.isArray(res.voiceCatalog)) ctx.local.catalog = res.voiceCatalog
        for (const v of (res && res.importedVoices) || []) done.push(v)
      }
    } finally {
      I.progress = null
      I.result = done
    }
    PK.toast(`音色已加入专属库：共 ${done.length} 个`, done.length ? 'success' : 'warn')
  }
  async function importVoicePath(ctx) {
    const I = ctx.local.imp
    const p = S(I.path).trim()
    if (!p) throw new PK.Error('请填写本机音色文件、音色包文件夹或 .zip 的完整路径')
    const res = await PK.post('voices/import', { sourcePath: p, name: S(I.name).trim() || undefined, gender: I.gender || '', category: S(I.category).trim() || '', tags: S(I.tags).trim(), promptText: S(I.prompt).trim() }, { timeout: 900000 })
    if (res && Array.isArray(res.voiceCatalog)) ctx.local.catalog = res.voiceCatalog
    I.result = (res && res.importedVoices) || []
    PK.toast(`音色已加入专属库：共 ${U.num(res && res.importedCount, I.result.length)} 个`, 'success')
  }
  async function matchSceneVoices(ctx) {
    PK.needProject()
    const M = ctx.local
    const res = await PK.postP('voices/match', { voiceId: 'auto', forceAuto: Boolean(M.matchForce) }, { timeout: 300000 })
    M.matchResult = (res && res.matches) || []
    try {
      await PK.action('setDirector', { patch: { voiceId: 'auto' } })
    } catch {}
    PK.toast(`AI 已为 ${M.matchResult.length} 个分镜匹配好音色`, 'success')
  }

  function renderVoiceLibrary(ctx) {
    const L = ctx.local
    const list = voicesOf(ctx)
    const F = L.vf
    const cur = (st().director && st().director.voiceId) || 'auto'
    const cats = ctx.data && ctx.data.voiceCategories && typeof ctx.data.voiceCategories === 'object' ? ctx.data.voiceCategories : {}
    const pick = typeof (ctx.args && ctx.args.onPick) === 'function' ? ctx.args.onPick : null
    const ql = S(F.q).trim().toLowerCase()
    const filtered = list.filter((v) => {
      if (F.onlyAvail && v.available === false) return false
      if (F.gender !== 'all' && (v.gender || 'neutral') !== F.gender) return false
      if (F.age !== 'all' && (v.ageGroup || 'adult') !== F.age) return false
      if (F.cat !== 'all' && (v.category || '未分类') !== F.cat) return false
      if (F.mine && !isImportedVoice(v)) return false
      if (!ql) return true
      return [v.name, v.id, v.category, v.description, ...(Array.isArray(v.tags) ? v.tags : [])].some((x) => S(x).toLowerCase().includes(ql))
    })
    filtered.sort((a, b) => Number(isImportedVoice(b)) - Number(isImportedVoice(a)))
    const shown = filtered.slice(0, F.limit)
    const hiddenUnavailable = F.onlyAvail ? list.filter((v) => v.available === false).length : 0
    const rerender = () => {
      F.limit = 60
      ctx.render()
    }
    const rows = shown.map((v, i) => {
      const isMain = cur === v.id
      const tags = (Array.isArray(v.tags) ? v.tags : []).filter((t) => t !== v.category && t !== v.name).slice(0, 4)
      return ui.item({
        key: `vo-${v.id}`,
        lead: pad2(i + 1),
        title: v.name || v.id,
        sub: [GENDER_LABEL[v.gender] || '', AGE_LABEL[v.ageGroup] || '', v.category || '', tags.join(' / ')].filter(Boolean).join(' · '),
        meta: v.durationSec ? `${U.num(v.durationSec).toFixed(1)}s` : null,
        active: isMain && !pick,
        tone: v.available === false ? 'warn' : null,
        tip: v.description || null,
        right: [
          v.available === false ? ui.pill(v.requiresWav ? '需 WAV 参考' : '不可用', 'warn', { title: v.requiresWav ? '这是 IndexTTS-2 的 .pt 向量音色，当前引擎需要 WAV 参考音频，暂不能使用' : '找不到参考音频文件' }) : null,
          canPreview(v)
            ? playToggle(ctx, v.id, PK.routeUrl('voices/preview', { id: v.id }), { title: `试听「${v.name}」的参考原声` })
            : ui.btn('试听', null, { size: 'sm', icon: 'play', disabled: true, title: '这个音色是 .pt 向量文件，暂无原声试听；选用后生成分镜配音即可听到效果' }),
          pick
            ? ui.btn('选用', async () => {
                await pick(v)
                ctx.close()
              }, { size: 'sm', kind: 'primary', icon: 'check' })
            : isMain
              ? ui.pill('主讲', 'acc', { dot: true })
              : ui.btn('设为主讲', () => setMainVoice(v, list), { size: 'sm', busyText: '设置中…', disabled: v.available === false }),
          isImportedVoice(v) ? ui.iconBtn('trash', () => deleteVoice(ctx, v), { title: '删除这个导入 / 克隆的音色（会删除其参考音频）', kind: 'ghost' }) : null,
        ],
      })
    })
    ctx.foot([
      ui.hint(`显示 ${filtered.length} / ${list.length} 个音色${hiddenUnavailable ? ` · ${hiddenUnavailable} 个暂不可用已隐藏` : ''}`),
      ui.spacer(),
      ui.btn('导入音色包', () => {
        L.tab = 'import'
        ctx.render()
      }, { icon: 'upload', kind: 'ghost' }),
      ui.btn('克隆我的声音', () => {
        L.tab = 'clone'
        ctx.render()
      }, { icon: 'mic', kind: 'primary' }),
    ])
    return [
      pick ? ui.note(S(ctx.args.pickHint) || '点「选用」把音色应用到当前分镜（只影响这一幕）。', { level: 'info', title: S(ctx.args.pickTitle) || '为分镜挑选音色' }) : null,
      ui.row([
        flex1(ui.input({ key: 'vo-q', value: S(F.q), type: 'search', placeholder: `搜索音色名称、风格或标签（共 ${list.length} 个）…`, onInput: (v) => {
          F.q = v
          rerender()
        } })),
        ui.seg({ value: F.gender, options: [{ value: 'all', label: '全部' }, { value: 'female', label: '女声' }, { value: 'male', label: '男声' }, { value: 'neutral', label: '中性' }], onChange: (v) => {
          F.gender = v
          rerender()
        } }),
      ], { wrap: true }),
      fgrid([
        ui.select({
          value: F.cat,
          options: [{ value: 'all', label: '全部分类' }, ...Object.entries(cats).map(([name, n]) => ({ value: name, label: name, hint: `${n} 个` }))],
          onChange: (v) => {
            F.cat = v
            rerender()
          },
          aria: '音色分类',
          class: 'pk-settings-sel',
        }),
        ui.select({
          value: F.age,
          options: [{ value: 'all', label: '全部年龄' }, ...Object.entries(AGE_LABEL).map(([k, lbl]) => ({ value: k, label: lbl }))],
          onChange: (v) => {
            F.age = v
            rerender()
          },
          aria: '年龄段',
          class: 'pk-settings-sel',
        }),
      ], { min: 150 }),
      ui.row([
        ui.check({ value: F.onlyAvail, label: '只看可用', onChange: (v) => {
          F.onlyAvail = v
          rerender()
        } }),
        ui.check({ value: F.mine, label: '只看我导入 / 克隆的', onChange: (v) => {
          F.mine = v
          rerender()
        } }),
      ], { wrap: true }),
      pick
        ? null
        : ui.section(
            { title: 'AI 自动配音', en: 'AUTO CAST', icon: 'wand', desc: '按每一幕的内容、情绪与角色自动挑选最合适的音色；你在分镜里逐幕手动挑选的音色始终保留。' },
            ui.row([
              cur === 'auto' ? ui.pill('主讲：AI 自动匹配', 'acc', { dot: true }) : ui.btn('主讲改为「AI 自动匹配」', () => setMainVoice('auto', list), { size: 'sm', icon: 'wand', busyText: '设置中…' }),
              actBtn(ctx, 'vo-match', 'AI 一键为全部分镜匹配音色', () => matchSceneVoices(ctx), { size: 'sm', icon: 'sparkle', busyText: 'AI 正在匹配…', disabled: !PK.hasProject(), title: PK.hasProject() ? '按每一幕的内容、情绪与角色自动挑选最合适的音色' : '需要先打开一个视频工程' }),
              ui.check({ value: Boolean(L.matchForce), label: '已锁定音色的分镜也重新匹配', onChange: (v) => (L.matchForce = v) }),
            ]),
            Array.isArray(L.matchResult) && L.matchResult.length
              ? ui.table({
                  columns: [
                    { key: 'title', label: '分镜', render: (r, i) => `${pad2(i + 1)} · ${S(r.title) || S(r.sceneId)}` },
                    { key: 'voiceName', label: '匹配音色' },
                    { key: 'reason', label: '理由' },
                  ],
                  rows: L.matchResult,
                })
              : null,
          ),
      rows.length
        ? ui.list(rows, { dense: true })
        : ui.empty({ icon: 'voice', title: '没有符合条件的音色', text: '换个关键词，或者清空筛选条件试试。', actions: [ui.btn('清空筛选', () => {
            Object.assign(F, { q: '', gender: 'all', age: 'all', cat: 'all', mine: false, onlyAvail: true })
            rerender()
          }, { kind: 'primary' })] }),
      filtered.length > shown.length
        ? ui.row([ui.btn(`显示更多（还有 ${filtered.length - shown.length} 个）`, () => {
            F.limit += 60
            ctx.render()
          }, { kind: 'ghost', icon: 'chev' })], { center: true })
        : null,
    ]
  }
  function renderVoiceClone(ctx) {
    const L = ctx.local
    const C = L.clone
    const list = voicesOf(ctx)
    const ttsCfg = normTts(ctx.data && ctx.data.ttsConfig)
    const engineLabel = engLabel(ttsCfg.engines.find((e) => e.id === ttsCfg.activeEngineId))
    const mic = L.mic
    const cloned = list.filter(isClonedVoice)
    const auditionOpts = (cloned.length ? cloned : list.filter((v) => v.available !== false).slice(0, 20)).map((v) => ({ value: v.id, label: v.name || v.id, hint: v.category }))
    const auditionId = C.auditionId || S(cloned[0] && cloned[0].id)
    const stepN = C.auditionId ? 3 : C.sample || (C.mode === 'path' && S(C.path).trim()) ? 2 : 1
    const sampleView = C.sample
      ? ui.note(
          h('div.pk-stack', null, ui.text(`${C.sample.from === 'mic' ? '已录好' : '已载入'}：${C.sample.fileName}${C.sample.secs ? ` · ${C.sample.secs} 秒` : ''}${C.sample.blob ? ` · ${U.fmtBytes(C.sample.blob.size)}` : ''}`), C.sample.url ? ui.audio(C.sample.url) : null),
          { level: 'ok', title: '① 人声样本', actions: [ui.btn('重新采集', () => {
            setCloneSample(ctx, null)
            ctx.render()
          }, { size: 'sm', kind: 'ghost', icon: 'retry' })] },
        )
      : null
    let capture
    if (C.mode === 'mic') {
      capture = h(
        'div.pk-stack',
        null,
        ui.row([
          mic
            ? ui.btn('停止录音', () => stopMic(ctx), { kind: 'danger', icon: 'stop' })
            : ui.btn('开始录音（说 5–12 秒普通话）', () => startMic(ctx), { kind: 'primary', icon: 'mic' }),
          mic ? h('span.pk-mono', { 'data-mic-secs': '' }, `${mic.secs} 秒 / 最长 15 秒`) : ui.hint('找个安静的地方，用平时说话的语气自然朗读一段话，效果最好'),
        ]),
        mic ? h('div', { 'data-mic-vu': '' }, ui.meter(mic.level || 0, { label: '收音音量（说话时绿条会跳动）', valueText: '● 录音中', tone: 'ok' })) : null,
        C.micError ? ui.note(C.micError, { level: 'warn', title: '麦克风用不了', actions: [ui.btn('改用上传录音文件', () => {
          C.mode = 'file'
          C.micError = ''
          ctx.render()
        }, { size: 'sm', icon: 'upload' })] }) : null,
      )
    } else if (C.mode === 'file') {
      capture = ui.drop({
        label: '拖入录音文件，或点击选择',
        hint: '支持 .wav / .mp3 / .flac / .m4a / .webm（建议 5–15 秒、只有一个人说话的干净人声）',
        accept: 'audio/*,.wav,.mp3,.flac,.m4a,.webm,.ogg,.aac',
        icon: 'music',
        onFiles: (files) => pickCloneFile(ctx, files[0]),
      })
    } else {
      capture = ui.field(
        { label: '本机音频路径', hint: '填写完整路径，例如 D:/voices/my-voice.wav（也支持 .pt 音色向量）' },
        lineField({ key: 'clone-path', value: S(C.path), placeholder: 'D:/voices/my-voice.wav', onInput: (v) => (C.path = v) }),
      )
    }
    ctx.foot([ui.hint(`试听使用当前配音引擎：${engineLabel}`), ui.spacer(), ui.btn('切换配音引擎', () => PK.open('keys', { tab: 'tts' }), { kind: 'ghost', icon: 'settings' })])
    return [
      ui.steps([
        { label: '采集人声', sub: '5–12 秒干净人声', state: stepN > 1 ? 'done' : 'active' },
        { label: '降噪入库', sub: '自动降噪 · 标准化', state: stepN > 2 ? 'done' : stepN === 2 ? 'active' : 'todo' },
        { label: '试听选用', sub: '即时合成 · 一键选用', state: stepN === 3 ? 'active' : 'todo' },
      ]),
      ui.section(
        { title: '第 ① 步 · 采集人声', en: 'RECORD', icon: 'mic' },
        ui.seg({
          value: C.mode,
          options: [
            { value: 'mic', label: '麦克风当场录音', icon: 'mic' },
            { value: 'file', label: '选录音文件上传', icon: 'upload' },
            { value: 'path', label: '填本地音频路径', icon: 'folder' },
          ],
          onChange: (v) => {
            if (L.mic) stopMic(ctx, true)
            C.mode = v
            C.micError = ''
            ctx.render()
          },
        }),
        C.mode !== 'path' ? sampleView : null,
        C.mode !== 'path' && C.sample ? null : capture,
      ),
      ui.section(
        { title: '第 ② 步 · 起名并入库', en: 'CLONE', icon: 'wand', desc: '会自动降噪、去掉静音、统一音量后存进你的专属音色库。' },
        fgrid(
          [
            ui.field({ label: '声线名称' }, ui.input({ key: 'clone-name', value: S(C.name), placeholder: '例如 我的解说音', maxLength: 60, onInput: (v) => (C.name = v) })),
            ui.field({ label: '性别' }, ui.seg({ value: C.gender, options: [{ value: 'female', label: '女声' }, { value: 'male', label: '男声' }], onChange: (v) => (C.gender = v) })),
          ],
          { min: 220 },
        ),
        ui.field(
          { label: '参考台词文本（选填）', hint: '录音里说的原话，填了能让克隆更像' },
          countBelow(ui.textarea({ key: 'clone-prompt', value: S(C.prompt), rows: 2, minRows: 2, maxRows: 6, maxLength: 500, onInput: (v) => (C.prompt = v), expand: { title: '参考台词文本' } })),
        ),
        actBtn(ctx, 'clone-submit', '一键降噪标准化并入库', () => submitClone(ctx), { kind: 'primary', icon: 'wand', block: true, busyText: '正在降噪、去静音、响度标准化并建档入库…', disabled: Boolean(L.mic) }),
      ),
      ui.section(
        { title: '第 ③ 步 · 试听并选用', en: 'AUDITION', icon: 'play' },
        fgrid(
          [
            ui.field({ label: '要试听的声线' }, ui.select({ value: auditionId, options: auditionOpts, placeholder: '选择已克隆的声线', onChange: (v) => (C.auditionId = v) })),
            ui.field({ label: '试听台词' }, countBelow(ui.textarea({ key: 'clone-text', value: S(C.text), rows: 2, minRows: 2, maxRows: 5, maxLength: 300, onInput: (v) => (C.text = v), expand: { title: '试听台词' } }))),
          ],
          { min: 240 },
        ),
        ui.row([
          actBtn(ctx, 'clone-audition', `用 ${engineLabel} 合成试听`, () => auditionClone(ctx), { icon: 'play', busyText: '正在即时合成试听音频…', disabled: !auditionOpts.length }),
          ui.btn('设为当前全局音色', async () => {
            const id = C.auditionId || auditionId
            if (!id) throw new PK.Error('还没有可以选用的克隆声线，请先完成第 ② 步')
            await setMainVoice(list.find((v) => v.id === id) || { id, name: id }, list)
          }, { icon: 'check', busyText: '设置中…', disabled: !auditionOpts.length }),
        ]),
        C.auditionUrl ? ui.audio(C.auditionUrl) : null,
      ),
    ]
  }
  function renderVoiceImport(ctx) {
    const I = ctx.local.imp
    ctx.foot([ui.hint('单个文件会复制进专属音色库；文件夹会原地引用（不复制）'), ui.spacer(), ui.btn('回到音色库', () => {
      ctx.local.tab = 'library'
      ctx.render()
    }, { kind: 'ghost', icon: 'list' })])
    return [
      ui.text('把你已有的音色导进来：单个参考音频（.wav / .mp3 / .flac）、IndexTTS 的 .pt 向量，或者整包音色（.zip / 文件夹，支持 manifest.json 和按文件夹分类的 WAV）。', { tone: 'muted' }),
      fgrid(
        [
          ui.field({ label: '音色名称（选填）', hint: '只导入一个文件时生效；不填就用文件名' }, ui.input({ key: 'imp-name', value: S(I.name), maxLength: 60, placeholder: '例如 浑厚纪录片男声', onInput: (v) => (I.name = v) })),
          ui.field({ label: '性别' }, ui.seg({ value: I.gender, options: [{ value: 'female', label: '女声' }, { value: 'male', label: '男声' }, { value: 'neutral', label: '中性' }], onChange: (v) => (I.gender = v) })),
          ui.field({ label: '分类（选填）', hint: '不填自动归到「自定义导入」' }, ui.input({ key: 'imp-cat', value: S(I.category), maxLength: 40, placeholder: '例如 纪录片', onInput: (v) => (I.category = v) })),
          ui.field({ label: '风格标签（选填）', hint: '用逗号分隔，AI 自动配音时会参考' }, lineField({ key: 'imp-tags', value: S(I.tags), mono: false, placeholder: '纪录片, 深沉, 历史', onInput: (v) => (I.tags = v) })),
        ],
        { min: 220 },
      ),
      ui.field({ label: '参考台词文本（选填）', hint: '参考音频里说的原话' }, countBelow(ui.textarea({ key: 'imp-prompt', value: S(I.prompt), rows: 2, minRows: 2, maxRows: 5, maxLength: 500, onInput: (v) => (I.prompt = v), expand: { title: '参考台词文本' } }))),
      ui.section(
        { title: '上传文件导入', en: 'UPLOAD', icon: 'upload' },
        ui.drop({
          label: I.progress ? `正在导入 ${I.progress.i}/${I.progress.n}：${I.progress.name}` : '拖入音色文件或 .zip 音色包，或点击选择（可多选）',
          hint: '支持 .wav / .mp3 / .flac / .pt / .zip，单个文件不超过 150MB',
          accept: '.wav,.mp3,.flac,.pt,.zip,audio/*',
          multiple: true,
          icon: 'voice',
          onFiles: (files) => importVoiceFiles(ctx, files).finally(() => ctx.update()),
        }),
      ),
      ui.section(
        { title: '填本地路径导入', en: 'LOCAL PATH', icon: 'folder', desc: '适合很大的音色包或整个文件夹：直接填写本机路径，不用上传。' },
        ui.row([
          flex1(lineField({ key: 'imp-path', value: S(I.path), placeholder: '例如 D:/音色包/纪录片男声 或 D:/voices/pack.zip', onInput: (v) => (I.path = v) })),
          actBtn(ctx, 'imp-path', '导入', () => importVoicePath(ctx), { kind: 'primary', icon: 'upload', busyText: '导入中…' }),
        ], { wrap: false, top: true }),
      ),
      Array.isArray(I.result)
        ? ui.section(
            { title: '本次导入结果', en: 'RESULT', icon: 'check', count: I.result.length },
            I.result.length
              ? ui.list(
                  I.result.map((v, i) =>
                    ui.item({
                      key: `imp-res-${v.id}`,
                      lead: pad2(i + 1),
                      title: v.name || v.id,
                      sub: [GENDER_LABEL[v.gender], v.category, (v.tags || []).slice(0, 3).join(' / ')].filter(Boolean).join(' · '),
                      right: [ui.btn('设为主讲', () => setMainVoice(v, voicesOf(ctx)), { size: 'sm', busyText: '设置中…' })],
                    }),
                  ),
                  { dense: true },
                )
              : ui.hint('没有找到可以导入的音频文件。'),
          )
        : null,
    ]
  }

  PK.panel('voices', {
    title: '配音中心',
    en: 'VOICE LIBRARY · 音色库 · 声音克隆',
    idx: 'VO',
    icon: 'voice',
    kind: 'modal',
    size: 'lg',
    group: 'tools',
    order: 30,
    desc: '试听 200+ 音色、设为主讲、克隆你自己的声音',
    aliases: { voice: {}, voiceLibrary: {}, voiceClone: { tab: 'clone' }, clone: { tab: 'clone' }, voiceImport: { tab: 'import' } },
    watch: (s) => [s && s.rev, s && s.director && s.director.voiceId],
    onWatch: async (ctx, v) => {
      if (v[0] !== ctx.local.rev) {
        ctx.local.rev = v[0]
        await ctx.load()
        ctx.local.catalog = null
      }
      ctx.update()
    },
    mount(ctx) {
      const a = ctx.args || {}
      ctx.local.rev = st().rev
      ctx.local.tab = ['library', 'clone', 'import'].includes(a.tab) ? a.tab : 'library'
      ctx.local.vf = { q: S(a.q), gender: 'all', age: 'all', cat: 'all', onlyAvail: true, mine: false, limit: 60 }
      ctx.local.clone = { mode: 'mic', sample: null, name: '', gender: 'female', prompt: '', path: '', auditionId: '', auditionUrl: '', text: '你好，这是我刚克隆完成的专属声线，用来给视频配音听起来自然流畅吗？', micError: '' }
      ctx.local.imp = { name: '', gender: 'female', category: '', tags: '', prompt: '', path: '', progress: null, result: null }
      ctx.onCleanup(() => {
        if (ctx.local.mic) stopMic(ctx, true)
        setCloneSample(ctx, null)
        const owners = Object.values(ctx.local.playOwners || {})
        if (PK.audio.isOwner(ctx.local.clone) || owners.some((o) => PK.audio.isOwner(o))) PK.audio.stop()
      })
      ctx.load()
    },
    onArgs(ctx, a) {
      if (['library', 'clone', 'import'].includes(a.tab)) ctx.local.tab = a.tab
      ctx.render()
    },
    render(ctx) {
      if (!ctx.data) return ctx.loadError ? ui.errorBox(ctx.loadError, () => ctx.load(true)) : ui.loading('正在读取音色库…')
      const list = voicesOf(ctx)
      const tts = normTts(ctx.data.ttsConfig)
      const active = tts.engines.find((e) => e.id === tts.activeEngineId)
      const ready = Boolean(ctx.data.ttsStatus && ctx.data.ttsStatus.ready)
      const cur = (st().director && st().director.voiceId) || 'auto'
      const tab = ctx.local.tab
      const head = ui.row([
        ui.pill(`主讲：${voiceNameOf(cur, list)}`, 'acc', { dot: true, title: '全片默认使用的配音音色' }),
        ui.pill(`配音引擎：${engLabel(active)}${ready ? '' : ' · 未连通'}`, ready ? 'ok' : 'warn', { title: ready ? '配音引擎已连通' : '配音引擎还没有连通，可以在设置里一键安装或切换' }),
        ui.spacer(),
        ui.btn('切换配音引擎', () => PK.open('keys', { tab: 'tts' }), { size: 'sm', kind: 'ghost', icon: 'settings' }),
      ])
      const tabs = ui.tabs({
        value: tab,
        items: [
          { value: 'library', label: '音色库', icon: 'list', badge: list.length },
          { value: 'clone', label: '克隆我的声音', icon: 'mic', badge: list.filter(isClonedVoice).length || '' },
          { value: 'import', label: '导入音色包', icon: 'upload' },
        ],
        onChange: (v) => {
          if (ctx.local.mic && v !== 'clone') stopMic(ctx, true)
          ctx.local.tab = v
          ctx.foot(null)
          ctx.render()
        },
      })
      const body = tab === 'clone' ? renderVoiceClone(ctx) : tab === 'import' ? renderVoiceImport(ctx) : renderVoiceLibrary(ctx)
      return [head, tabs, ...body]
    },
  })

  /* ========================================================================================== 云端媒体中心 */
  const CLOUD_DRAFT = { cat: 'image' } // module-level: prompts survive closing the panel
  const cloudGen = (cat) =>
    (CLOUD_DRAFT[cat] = CLOUD_DRAFT[cat] || { prompt: '', lyrics: '', instrumental: false, duration: 5, sceneId: '' })
  const catMeta = (cat) => CLOUD_CATS.find((c) => c.value === cat) || CLOUD_CATS[0]
  const cloudReady = (c) => Boolean(c && (c.hasApiKey || (c.protocol === 'custom' && S(c.custom && c.custom.submitUrl).trim())))

  async function saveCloudCat(cat, patch) {
    const res = await PK.post('cloud-media', { [cat]: patch })
    return (res && res.config) || null
  }
  async function assistCloudPrompt(ctx, field) {
    if (!llmReady()) {
      PK.toast('AI 提示词助手需要先配置文本大模型', 'warn', { action: { label: '去配置', onClick: () => PK.open('keys', { tab: 'llm' }) } })
      return
    }
    const cat = CLOUD_DRAFT.cat
    const g = cloudGen(cat)
    const script = activeScript(ctx.data) || {}
    const d = st().director || {}
    const scenes = sceneList(ctx.data)
    const sc = scenes.find((s) => s.id === g.sceneId) || null
    const res = await PK.post(
      'cloud-media/assist-prompt',
      {
        category: cat,
        field,
        topic: S(d.topic) || S(script.title) || '电影感创意短视频',
        style: S(d.style) || S(script.style) || 'cinematic',
        genreLabel: S(d.genreLabel) || S(script.genreLabel),
        sceneTitle: S(sc && sc.title),
        sceneNarration: S(sc && (sc.narration || sc.subtitle)),
        existingPrompt: S(g.prompt).trim(),
        instrumental: Boolean(g.instrumental),
      },
      { timeout: 240000 },
    )
    if (cat === 'audio') {
      if ((field === 'both' || field === 'prompt') && res && res.prompt) g.prompt = res.prompt
      if ((field === 'both' || field === 'lyrics') && res && res.lyrics) g.lyrics = res.lyrics
    } else if (res && res.prompt) g.prompt = res.prompt
    const what = cat === 'audio' ? (field === 'lyrics' ? '歌词' : field === 'prompt' ? '音乐风格描述' : '风格与歌词') : cat === 'video' ? '运镜视频提示词' : '画面配图提示词'
    PK.toast(`已由文本大模型（${S(res && res.model) || '大模型'}）写好专业${what}，可以直接微调后生成`, 'success')
  }
  async function generateCloud(ctx, override) {
    PK.needProject()
    const cm = (ctx.data && ctx.data.cloudMedia) || {}
    const cat = (override && override.category) || CLOUD_DRAFT.cat
    const g = cloudGen(cat)
    const prompt = S(override && override.prompt !== undefined ? override.prompt : g.prompt).trim()
    const lyrics = S(override && override.lyrics !== undefined ? override.lyrics : g.lyrics).trim()
    const instrumental = override && override.instrumental !== undefined ? Boolean(override.instrumental) : Boolean(g.instrumental)
    const sceneId = override && override.sceneId !== undefined ? S(override.sceneId) : S(g.sceneId)
    const durationSec = U.clamp(U.num(override && override.durationSec, g.duration) || 5, 3, 15)
    if (!prompt && !lyrics) throw new PK.Error('请先填写提示词（或点「AI 协助生成」自动帮你写）')
    const c = cm[cat] || {}
    if (!cloudReady(c)) {
      PK.toast(`还没有配置「${catMeta(cat).label}」的 API Key：请先在「设置 · 模型与密钥 → 云端生成」里填写并保存`, 'warn', { action: { label: '去配置密钥', onClick: () => PK.open('keys', { tab: 'cloud', cat }) }, timeout: 9000 })
      return
    }
    const preset = presetOf(cm, cat, c.providerId)
    const ok = await confirmOnce(`cloud-gen-${cat}`, {
      title: '调用云端服务生成？',
      text: `将使用你自己配置的「${S(preset && preset.name) || c.providerId}」（模型 ${c.model || '默认'}）生成${catMeta(cat).unit}，按该服务商的价格计费。\n结果会先放进右侧「预览验收区」，满意后再存入素材库。`,
      ok: '开始生成',
    })
    if (!ok) return
    const script = activeScript(ctx.data) || {}
    const label = `生成${catMeta(cat).unit}`
    await startJob(`cloud-gen:${cat}`, {
      label,
      startText: `已提交云端${catMeta(cat).unit}生成任务…`,
      start: () =>
        PK.postP(
          'cloud-media/generate',
          { category: cat, prompt, lyrics, instrumental, durationSec, aspectRatio: S(script.aspectRatio) || '16:9', sceneId, autoBindToScript: true, stageOnly: true },
          { timeout: 120000 },
        ),
      doneText: '已生成到预览验收区，请先查看 / 试听，满意再「确认入库」',
      maxMs: 3600 * 1000,
    })
      .then(async () => {
        await hostRefresh()
        PK.toast('云端结果已生成到预览验收区：先查看 / 试听，满意后点「确认满意并存入素材库」', 'success')
      })
      .catch((err) => PK.toast(`云端生成失败：${S(err && err.message)}`, 'error', { title: label, action: { label: '检查密钥与模型', onClick: () => PK.open('keys', { tab: 'cloud', cat }) } }))
  }
  function openStagedLightbox(item, url) {
    const f = PK.frame({ kind: 'modal', size: 'xl', title: '预览大图', en: [item.providerId, item.model].filter(Boolean).join(' · ') || 'PREVIEW', class: 'pk-settings-lightbox' })
    PK.append(f.body, ui.image(url, { fit: 'contain', alt: S(item.prompt) }), item.prompt ? ui.text(item.prompt, { tone: 'muted' }) : null)
    f.setFoot([ui.spacer(), ui.btn('关闭', () => f.close('x'), { kind: 'ghost' })])
  }
  function stagedCard(ctx, item, scenes) {
    const url = PK.assetUrl(item.relPath)
    const cat = item.category === 'audio' ? 'audio' : item.category === 'video' ? 'video' : 'image'
    const meta = catMeta(cat)
    const sc = item.sceneId ? scenes.find((s) => s.id === item.sceneId) : null
    const scIdx = sc ? scenes.indexOf(sc) : -1
    const busyId = ctx.local.stageBusy
    const genBusy = jobRunning(`cloud-gen:${cat}`)
    const media =
      cat === 'image'
        ? h(
            'button.pk-settings-zoom',
            {
              type: 'button',
              title: '点击查看大图',
              'aria-label': '查看大图',
              style: { display: 'block', width: '100%', padding: 0, margin: 0, border: 0, background: 'transparent', cursor: 'zoom-in' },
              onClick: () => openStagedLightbox(item, url),
            },
            ui.image(url, { alt: S(item.prompt) }),
          )
        : cat === 'video'
          ? ui.video(url, { preload: 'metadata' })
          : null
    const runStage = async (action) => {
      ctx.local.stageBusy = item.stagingId
      ctx.update()
      try {
        await PK.action(action, { stagingId: item.stagingId }, { timeout: 300000 })
        // discarding does not make the host re-read its data, so refresh this panel's snapshot ourselves
        PK.store.invalidate()
        await ctx.load(true)
      } finally {
        ctx.local.stageBusy = ''
        ctx.update()
      }
    }
    return ui.card({
      key: `stg-${item.stagingId}`,
      title: `${meta.unit} · ${item.model || item.providerId || '云端生成'}`,
      body: h(
        'div.pk-stack',
        { style: { gap: '6px' } },
        media,
        cat === 'audio' ? ui.audio(url) : null,
        ui.text([item.durationSec ? `${U.num(item.durationSec).toFixed(1)} 秒` : '', item.sizeBytes ? U.fmtBytes(item.sizeBytes) : '', item.createdAt ? U.fmtTime(item.createdAt) : ''].filter(Boolean).join(' · '), { tone: 'dim', mono: true }),
        item.prompt ? ui.text(item.prompt, { tone: 'muted' }) : null,
        item.lyrics ? ui.text(`歌词：${item.lyrics}`, { tone: 'dim' }) : null,
        sc ? ui.pill(`入库后绑定到第 ${scIdx + 1} 幕：${sc.title || sc.id}`, 'acc') : cat === 'audio' ? ui.pill('入库后自动设为背景音乐', 'acc') : null,
      ),
      actions: [
        ui.btn(busyId === item.stagingId ? '处理中…' : '确认满意并存入素材库', () => runStage('confirmStaging'), { kind: 'primary', size: 'sm', icon: 'check', disabled: Boolean(busyId) }),
        ui.btn('不满意重新生成', () =>
          generateCloud(ctx, { category: cat, prompt: S(item.prompt), lyrics: S(item.lyrics), instrumental: Boolean(item.instrumental), sceneId: S(item.sceneId) }),
          { size: 'sm', icon: 'refresh', disabled: Boolean(busyId) || genBusy },
        ),
        ui.btn('丢弃', () => runStage('discardStaging'), {
          size: 'sm',
          kind: 'danger',
          icon: 'trash',
          disabled: Boolean(busyId),
          confirm: { title: '丢弃这个生成结果？', text: '丢弃后文件会被删除，无法恢复（已经花掉的生成费用不会退回）。', ok: '丢弃', danger: true },
        }),
      ],
    })
  }

  PK.panel('cloud', {
    title: '云端媒体中心',
    en: 'CLOUD MEDIA · BYOK 生图 / 生视频 / 音乐',
    idx: 'CL',
    icon: 'cloud',
    kind: 'modal',
    size: 'xl',
    group: 'tools',
    order: 40,
    desc: '用你自己的密钥云端生成图片、视频、音乐，先验收再入库',
    aliases: { cloudMedia: {}, staging: {}, cloudGen: {} },
    watch: (s) => [s && s.rev, s && s.project && s.project.dir],
    onWatch: async (ctx) => {
      await ctx.load()
      ctx.update()
    },
    mount(ctx) {
      const a = ctx.args || {}
      if (CLOUD_CATS.some((c) => c.value === a.cat)) CLOUD_DRAFT.cat = a.cat
      if (a.prompt) cloudGen(CLOUD_DRAFT.cat).prompt = S(a.prompt)
      if (a.sceneId) cloudGen(CLOUD_DRAFT.cat).sceneId = S(a.sceneId)
      ctx.listen('settings:jobs', () => ctx.update())
      ctx.load()
    },
    onArgs(ctx, a) {
      if (CLOUD_CATS.some((c) => c.value === a.cat)) CLOUD_DRAFT.cat = a.cat
      if (a.prompt) cloudGen(CLOUD_DRAFT.cat).prompt = S(a.prompt)
      if (a.sceneId) cloudGen(CLOUD_DRAFT.cat).sceneId = S(a.sceneId)
      ctx.render()
    },
    render(ctx) {
      if (!ctx.data) return ctx.loadError ? ui.errorBox(ctx.loadError, () => ctx.load(true)) : ui.loading('正在读取云端生成配置…')
      const data = ctx.data
      const cm = data.cloudMedia || {}
      const cat = CLOUD_DRAFT.cat
      const meta = catMeta(cat)
      const g = cloudGen(cat)
      const c = cm[cat] || {}
      const presets = (cm.presets && cm.presets[cat]) || []
      const preset = presets.find((p) => p.id === c.providerId) || null
      const scenes = sceneList(data)
      const staged = Array.isArray(data.stagedCloudAssets) ? data.stagedCloudAssets : []
      const hasProject = PK.hasProject()
      const genSlot = `cloud-gen:${cat}`
      const genBusy = jobRunning(genSlot)
      const assistBusy = (ctx.local.busy || {})
      const modelDrafts = (ctx.local.modelDrafts = ctx.local.modelDrafts || {})
      const ready = cloudReady(c)
      const promptLabel = cat === 'audio' ? '音乐风格与情绪描述' : cat === 'video' ? '视频提示词（实拍镜头画面与运镜）' : '生图提示词（高清配图画面描述）'
      const promptPh =
        cat === 'audio'
          ? '描述音乐风格与情绪（或点「AI 协助生成」按当前视频主题自动写好，支持 MiniMax Music 3 / Suno）…'
          : cat === 'video'
            ? '描述实拍镜头画面与运镜（或点「AI 协助生成」根据主题和分镜自动写出专业运镜提示词）…'
            : '描述配图画面构图与光影（或点「AI 协助生成」根据主题和分镜自动生成电影级画面提示词）…'
      ctx.foot([
        ui.hint(hasProject ? '所有结果先进预览验收区，不会弄乱正式素材库' : '生成与验收需要先打开一个视频工程'),
        ui.spacer(),
        ui.btn('配置密钥与模型', () => PK.open('keys', { tab: 'cloud', cat }), { kind: 'ghost', icon: 'key' }),
      ])
      const left = [
        ui.section(
          {
            title: '当前云端接口',
            en: 'PROVIDER',
            icon: meta.icon,
            actions: [ready ? ui.pill('密钥已配置', 'ok', { dot: true }) : ui.pill('未配置密钥', 'warn', { dot: true })],
          },
          fgrid(
            [
              ui.field(
                { label: '模型 / 协议预设', hint: '切换后立即保存' },
                ui.select({
                  key: `cloud-preset-${cat}`,
                  value: c.providerId,
                  options: presets.map((p) => ({ value: p.id, label: p.name, hint: p.docsHint })),
                  searchable: false,
                  onChange: async (v) => {
                    const p = presets.find((x) => x.id === v)
                    if (!p) return
                    const d = cloudCatDraft(c)
                    applyCloudPreset(d, p)
                    await PK.run(async () => {
                      await saveCloudCat(cat, { providerId: d.providerId, protocol: d.protocol, baseUrl: d.baseUrl, endpoint: d.endpoint, model: d.model })
                      PK.toast(`已切换到「${p.name}」`, 'success')
                      await ctx.load(true)
                    }, { fail: '切换失败' })
                  },
                }),
              ),
              ui.field(
                { label: '模型 ID', hint: '可自由手输任意版本，离开输入框后自动保存' },
                lineField({
                  key: `cloud-model-${cat}`,
                  // typed text is kept as a draft until it is saved, so a re-render never wipes it
                  value: modelDrafts[cat] !== undefined ? modelDrafts[cat] : c.model,
                  placeholder: cat === 'audio' ? 'music-3.0 / chirp-v4-5' : '自由输入模型 ID',
                  onInput: (v) => (modelDrafts[cat] = v),
                  onChange: async (v) => {
                    const m = S(v).trim()
                    if (!m || m === S(c.model)) {
                      delete modelDrafts[cat]
                      return
                    }
                    await PK.run(async () => {
                      await saveCloudCat(cat, { model: m })
                      delete modelDrafts[cat]
                      PK.toast(`模型已改为 ${m}`, 'success')
                    }, { fail: '保存模型失败' })
                  },
                }),
              ),
            ],
            { min: 230 },
          ),
          preset && preset.docsHint ? ui.hint(preset.docsHint) : null,
          ready ? null : ui.note('先在「设置 · 模型与密钥 → 云端生成」里填好这个类别的 API Key 并保存。', { level: 'warn', actions: [ui.btn('去配置密钥', () => PK.open('keys', { tab: 'cloud', cat }), { size: 'sm', kind: 'primary', icon: 'key' })] }),
        ),
        ui.section(
          {
            title: promptLabel,
            en: 'PROMPT',
            icon: 'prompt',
            actions: [
              actBtn(ctx, 'assist-main', 'AI 协助生成', () => assistCloudPrompt(ctx, cat === 'audio' ? 'prompt' : 'both'), { size: 'sm', icon: 'sparkle', busyText: 'AI 构思中…', disabled: Boolean(assistBusy['assist-both'] || assistBusy['assist-lyrics']) }),
              cat === 'audio' ? actBtn(ctx, 'assist-both', '一键填风格 + 歌词', () => assistCloudPrompt(ctx, 'both'), { size: 'sm', icon: 'bolt', busyText: '生成中…', disabled: Boolean(assistBusy['assist-main'] || assistBusy['assist-lyrics']) }) : null,
            ],
          },
          countBelow(ui.textarea({ key: `cloud-prompt-${cat}`, value: g.prompt, rows: 3, minRows: 3, maxRows: 12, maxLength: 4000, counter: true, placeholder: promptPh, onInput: (v) => (g.prompt = v), expand: { title: promptLabel } })),
          cat === 'audio'
            ? h(
                'div.pk-stack',
                null,
                ui.field(
                  { label: '歌词 / 编曲结构（支持 [Verse] / [Chorus] 标签）', aside: actBtn(ctx, 'assist-lyrics', 'AI 协助写歌词', () => assistCloudPrompt(ctx, 'lyrics'), { size: 'sm', kind: 'ghost', icon: 'sparkle', busyText: '填词中…', disabled: Boolean(assistBusy['assist-main'] || assistBusy['assist-both']) }) },
                  countBelow(ui.textarea({ key: 'cloud-lyrics', value: g.lyrics, rows: 4, minRows: 3, maxRows: 16, maxLength: 6000, placeholder: '输入歌词，或点「AI 协助写歌词」按视频主题自动写词；纯音乐可勾选下方「纯音乐」', onInput: (v) => (g.lyrics = v), expand: { title: '歌词 / 编曲结构' } })),
                ),
                ui.check({ value: Boolean(g.instrumental), label: '纯音乐（Instrumental，不含演唱人声）', onChange: (v) => (g.instrumental = v) }),
              )
            : fgrid(
                [
                  cat === 'video' ? ui.field({ label: '视频时长' }, ui.slider({ value: U.clamp(U.num(g.duration, 5), 3, 15), min: 3, max: 15, step: 1, format: (v) => `${v} 秒`, onChange: (v) => (g.duration = v) })) : null,
                  scenes.length
                    ? ui.field(
                        { label: '确认入库时绑定到分镜' },
                        ui.select({
                          value: g.sceneId || '',
                          options: [{ value: '', label: '只存入项目素材库' }, ...scenes.map((s, i) => ({ value: s.id, label: `${pad2(i + 1)} · ${S(s.title) || s.id}` }))],
                          onChange: (v) => (g.sceneId = v),
                        }),
                      )
                    : null,
                ].filter(Boolean),
                { min: 220 },
              ),
          ui.btn(genBusy ? '云端生成中…' : `生成并先进入预览验收区（${c.model || c.providerId || meta.unit}）`, () => generateCloud(ctx), { kind: 'primary', size: 'lg', icon: 'cloud', block: true, disabled: genBusy || !hasProject, title: hasProject ? '' : '需要先打开一个视频工程' }),
          jobView(genSlot, { log: false }),
        ),
      ]
      const right = [
        ui.section(
          {
            title: '生成结果预览区',
            en: 'STAGING · 先验收再入库',
            icon: 'eye',
            count: staged.length,
            desc: '未确认的结果只放在临时区，不会弄乱正式素材库。',
            actions: staged.length
              ? [
                  ui.btn('清空暂存', async () => {
                    await PK.postP('cloud-media/staging/discard', { clearAll: true })
                    PK.toast('已清空预览验收区', 'info')
                  }, { size: 'sm', kind: 'danger', icon: 'trash', confirm: { title: '清空全部暂存结果？', text: `将删除预览区里的 ${staged.length} 个生成结果，无法恢复。`, ok: '全部清空', danger: true } }),
                ]
              : null,
          },
          !hasProject
            ? ui.empty({ icon: 'folder', title: '还没有打开视频工程', text: '云端生成的结果需要放进一个工程里验收。', actions: [ui.btn('新建 / 打开工程', () => PK.open('projects'), { kind: 'primary' })] })
            : staged.length
              ? h('div.pk-stack', { 'data-pk-scroll': 'cloud-staging' }, staged.map((item) => stagedCard(ctx, item, scenes)))
              : ui.empty({ icon: 'eye', title: '暂无待验收的结果', text: '在左侧写好提示词（或点「AI 协助生成」）并生成后，图片 / 视频 / 音乐会第一时间出现在这里：图片可放大、视频直接播放、音乐可试听，满意再一键入库。' }),
        ),
      ]
      return [
        ui.tabs({
          value: cat,
          items: CLOUD_CATS.map((x) => ({ value: x.value, label: x.label, icon: x.icon, hint: x.sub, badge: jobRunning(`cloud-gen:${x.value}`) ? '生成中' : staged.filter((s) => (s.category || 'image') === x.value).length || '' })),
          onChange: (v) => {
            CLOUD_DRAFT.cat = v
            ctx.render()
          },
        }),
        ui.split(left, right, { ratio: 'minmax(0, 1.1fr) minmax(0, 1fr)' }),
      ]
    },
  })

  /* ================================================================================================= 数字人 */
  const AVATAR_LAYOUTS = [
    { value: 'pip-br', label: '右下小窗' },
    { value: 'pip-bl', label: '左下小窗' },
    { value: 'fullscreen', label: '全屏口播' },
  ]
  const CHROMA = [
    { value: '', label: '不抠像' },
    { value: '#00FF00', label: '绿幕' },
    { value: '#0000FF', label: '蓝幕' },
    { value: 'custom', label: '自定义颜色' },
  ]
  const avatarState = () => st().avatar || { enabled: false, mode: 'ai-human', layout: 'pip-br', presetId: '', sourcePath: '', voiceSamplePath: '', chromaKeyColor: '' }
  const setAvatar = async (patch) => {
    await PK.action('setAvatar', { patch })
  }
  async function loadLipsync(ctx, deep) {
    const res = await PK.get('avatar/lipsync', deep ? { deep: 1 } : undefined, { timeout: deep ? 240000 : 60000 })
    ctx.local.lipsync = (res && res.lipsync) || null
    ctx.local.lipInstaller = (res && res.installer) || null
    return res
  }
  async function generateAvatar(ctx) {
    PK.needProject()
    const av = avatarState()
    const assets = projectAssets(ctx.data)
    const source = S(av.sourcePath) || S((assets.find((a) => a.role === 'avatar_base' || a.role === 'host_video') || {}).path)
    const sample = S(av.voiceSamplePath) || S((assets.find((a) => a.role === 'voice_clone') || {}).path)
    if (av.mode === 'cloned-human' && !source) throw new PK.Error('「克隆真人」需要一段本人出镜视频或正脸照片：请先在下方上传，或用提词器录一段')
    const ok = await PK.confirm({
      title: '立即合成数字人？',
      text: `将用${av.mode === 'cloned-human' ? '你上传的真人底板' : 'AI 主播形象'}合成带透明通道的数字人口播叠层（${(AVATAR_LAYOUTS.find((l) => l.value === av.layout) || AVATAR_LAYOUTS[0]).label}）。需要先合成配音，可能要几分钟，期间可以关闭本面板。`,
      ok: '开始合成',
    })
    if (!ok) return
    const d = st().director || {}
    startJob('avatar-gen', {
      label: '合成数字人',
      startText: '正在合成带 Alpha 透明通道的数字人出镜视频…',
      start: () =>
        PK.postP('avatar/generate', {
          async: true,
          avatarMode: av.mode,
          sourceVideoPath: source,
          voiceId: S(d.voiceId) || 'auto',
          voiceSamplePath: sample,
          avatarLayout: av.layout,
          presetId: av.presetId,
          chromaKeyColor: S(av.chromaKeyColor),
        }),
      doneText: (r) => S(r && r.visualNotice) || '透明通道数字人已写入时间轴',
      maxMs: 2 * 3600 * 1000,
    })
      .then(async (r) => {
        ctx.local.visualNotice = S(r && r.visualNotice)
        try {
          await setAvatar({ enabled: true })
        } catch {}
        await hostRefresh()
        PK.toast(r && r.visualNotice ? `数字人生成完成：${r.visualNotice}` : '透明通道数字人已写入时间轴，可以在分步精修里实时监看', 'success')
      })
      .catch((err) => PK.toast(`数字人生成失败：${S(err && err.message)}`, 'error', { title: '合成数字人' }))
  }
  async function saveAvatarEndpoint(ctx) {
    const f = ctx.local.ep
    const prov = (ctx.data && ctx.data.avatarProvider) || {}
    const res = await PK.post('avatar/config', { provider: f.provider || 'auto', endpoint: S(f.endpoint).trim(), apiKey: S(f.apiKey).trim() || (prov.hasApiKey ? KEEP : '') })
    const p = (res && res.avatarProvider) || {}
    ctx.local.ep = { provider: p.provider || 'auto', endpoint: S(p.endpoint), apiKey: '' }
    ctx.local.epBase = clone(ctx.local.ep)
    PK.toast(p.neuralReady ? '外接唇形驱动服务已保存并启用' : '已切换为内置本地声波驱动 / 抠像引擎', 'success')
  }
  async function clearAvatarKey(ctx) {
    const f = ctx.local.ep
    await PK.post('avatar/config', { provider: f.provider || 'auto', endpoint: S(f.endpoint).trim(), apiKey: '' })
    f.apiKey = ''
    PK.toast('已清除数字人接口的 API Key', 'info')
  }
  async function installLipsync(ctx, pkg) {
    if (jobRunning('lipsync-install')) throw new PK.Error('口型引擎正在安装中，请等它完成')
    const L = ctx.local
    const dir = S(L.lipDir).trim() || S(pkg.defaultDir)
    const mirror = L.lipMirror || 'cn'
    const ok = await PK.confirm({
      title: `一键安装 ${pkg.shortName || 'MuseTalk 1.5'}？`,
      text: `将从官方仓库下载并安装「${pkg.name || pkg.shortName}」：\n· 显卡要求：${pkg.vramRequired || '—'}\n· 磁盘占用：${pkg.diskRequired || '—'}\n· 预计耗时：${pkg.etaLabel || '数分钟'}\n· 下载源：${mirror === 'global' ? '官方全球源' : '国内高速镜像（HF-Mirror + 清华源）'}\n· 安装位置：${dir || '默认目录'}\n${pkg.licenseNote ? `· 授权说明：${pkg.licenseNote}\n` : ''}\n安装期间需要联网，可以关闭本面板，完成后会提示你。`,
      ok: '开始安装',
    })
    if (!ok) return
    startJob('lipsync-install', {
      label: `安装 ${pkg.shortName || 'MuseTalk'}`,
      startText: '正在启动口型引擎一键安装…',
      start: () => PK.post('avatar/lipsync/install', { engineId: pkg.id || 'musetalk', installDir: S(L.lipDir).trim(), mirror }),
      doneText: '口型引擎安装完成',
      maxMs: 4 * 3600 * 1000,
    })
      .then(async () => {
        PK.toast(`${pkg.shortName || 'MuseTalk'} 安装完成，克隆真人口播将自动使用真实口型同步`, 'success')
        await hostRefresh()
        if (!ctx.frame.closed) loadLipsync(ctx).then(() => ctx.update()).catch(() => {})
      })
      .catch((err) => PK.toast(`口型引擎安装未完成：${S(err && err.message)}`, 'error', { title: '口型引擎安装失败', timeout: 0 }))
  }

  /** `PK.open('avatar', { tab })` jump targets (版本历史 · 工程安全 → 口型引擎 opens `{ tab: 'lipsync' }`) */
  const AVATAR_JUMP = { lipsync: 'av-sec-lipsync', provider: 'av-sec-provider', generate: 'av-sec-generate' }
  const LIPSYNC_ENGINES = { musetalk: 'MuseTalk 1.5', 'cloud-fal': 'fal LatentSync', latentsync: 'LatentSync', cli: '自定义口型引擎' }
  /** after the render that contains it: scroll the panel body so the section starts at the top (+ flash its outline once) */
  function pinSection(ctx, key, flash) {
    requestAnimationFrame(() => {
      const body = ctx.frame && !ctx.frame.closed ? ctx.frame.body : null
      const el = body && body.querySelector(`[data-pk-key="${CSS.escape(key)}"]`)
      if (!el) return
      // the frame body is the panel scroller (kit contract); only if a skin moved scrolling elsewhere use the nearest scrollable ancestor
      let sc = body
      if (sc.scrollHeight <= sc.clientHeight + 1) {
        for (let p = el.parentElement; p && p !== body.parentElement; p = p.parentElement) {
          const oy = getComputedStyle(p).overflowY
          if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) {
            sc = p
            break
          }
        }
      }
      const want = Math.max(0, Math.round(sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8))
      if (Math.abs(sc.scrollTop - want) > 1) sc.scrollTop = want
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (!flash || reduce || typeof el.animate !== 'function') return
      const acc = getComputedStyle(el).getPropertyValue('--pk-acc').trim() || '#3be7ff'
      try {
        el.animate([{ boxShadow: `inset 0 0 0 2px ${acc}` }, { boxShadow: `inset 0 0 0 2px ${acc}`, offset: 0.6 }, { boxShadow: 'inset 0 0 0 2px transparent' }], { duration: 1800, easing: 'ease-out' })
      } catch {}
    })
  }
  /**
   * Jump requested by `ctx.local.jump`: scroll there now and keep the section pinned while the panel is still filling in
   * (e.g. the lip-sync status arrives later and makes the page taller) — until the user scrolls / clicks / types, max 15 s.
   */
  function applyJump(ctx) {
    const L = ctx.local
    if (L.jump) {
      L.pin = L.jump
      L.pinUntil = Date.now() + 15000
      L.jump = null
      if (!L.pinArmed && ctx.frame && ctx.frame.body) {
        L.pinArmed = true
        for (const ev of ['wheel', 'touchstart', 'pointerdown', 'keydown']) ctx.frame.body.addEventListener(ev, () => (L.pin = null), { passive: true })
      }
      pinSection(ctx, L.pin, true)
    } else if (L.pin) {
      if (Date.now() < L.pinUntil) pinSection(ctx, L.pin, false)
      else L.pin = null
    }
  }

  function renderAvatar(ctx) {
    const data = ctx.data
    const L = ctx.local
    const av = avatarState()
    const assets = projectAssets(data)
    const script = activeScript(data) || {}
    const templates = Array.isArray(data.avatarTemplates) && data.avatarTemplates.length ? data.avatarTemplates : [{ id: 'cyber-anchor', name: '赛博科技主理人' }, { id: 'editorial-mentor', name: '黑金质感顾问' }, { id: 'studio-creator', name: '活力创意播主' }]
    const prov = data.avatarProvider || {}
    const hasProject = PK.hasProject()
    const ls = L.lipsync
    const lipPkgs = (L.lipInstaller && Array.isArray(L.lipInstaller.packages) && L.lipInstaller.packages) || []
    const genBusy = jobRunning('avatar-gen')
    const set = (patch, msg) =>
      PK.run(async () => {
        await setAvatar(patch)
        if (msg) PK.toast(msg, 'success')
      }, { fail: '保存数字人设置失败' })
    const chromaVal = S(av.chromaKeyColor).toUpperCase()
    const chromaSel = L.chromaCustom && chromaVal ? 'custom' : !chromaVal ? '' : ['#00FF00', '#0000FF'].includes(chromaVal) ? chromaVal : 'custom'
    if (!L.setChroma) L.setChroma = U.debounce((v) => set({ chromaKeyColor: v }), 350)
    const sourceOpts = assets
      .filter((a) => a.type === 'video' || a.type === 'image')
      .map((a) => ({ value: a.path, label: a.originalName || a.name || U.baseName(a.path), hint: a.role === 'avatar_base' ? '★ 数字人底板' : a.role === 'host_video' ? '真人出镜视频' : a.type === 'image' ? '图片' : '视频' }))
    const sampleOpts = assets
      .filter((a) => a.role === 'voice_clone' || a.type === 'audio' || a.role === 'host_video')
      .map((a) => ({ value: a.path, label: a.originalName || a.name || U.baseName(a.path), hint: a.role === 'voice_clone' ? '★ 声音克隆样本' : a.role === 'host_video' ? '真人出镜视频（取原声）' : '音频' }))
    const clip = script.avatarClip || null
    const out = []
    out.push(
      ui.section(
        { title: '数字人出镜', en: 'AVATAR OVERLAY', icon: 'user', desc: '开启后输出透明通道 WebM，与你的产品画面同框出镜口播（支持画中画与绿幕抠像）。' },
        ui.toggle({ value: Boolean(av.enabled), label: '开启数字人 / 克隆分身口播叠层', hint: av.enabled ? '下次一键出片时会自动生成并叠加数字人' : '关闭时成片里不会出现数字人', onChange: (v) => set({ enabled: v }, v ? '已开启数字人口播' : '已关闭数字人') }),
        fgrid(
          [
            ui.field({ label: '形象来源' }, ui.seg({ value: av.mode, options: [{ value: 'ai-human', label: '纯 AI 主播形象', icon: 'sparkle' }, { value: 'cloned-human', label: '克隆真人底板', icon: 'user' }], onChange: (v) => set({ mode: v }) })),
            ui.field({ label: '画面布局' }, ui.seg({ value: av.layout, options: AVATAR_LAYOUTS, onChange: (v) => set({ layout: v }) })),
          ],
          { min: 260 },
        ),
      ),
    )
    if (av.mode === 'cloned-human') {
      out.push(
        ui.section(
          { title: '克隆真人底板', en: 'CLONED HUMAN', icon: 'cam', desc: '上传一段 30 秒左右、正对镜头、光线均匀的本人视频（或一张正脸照片），再配一段声音样本，就能让「你」出镜口播。' },
          !hasProject
            ? ui.note('需要先打开一个视频工程，才能上传和选择底板素材。', { level: 'warn', actions: [ui.btn('新建 / 打开工程', () => PK.open('projects'), { size: 'sm', kind: 'primary' })] })
            : h(
                'div.pk-stack',
                null,
                fgrid(
                  [
                    ui.field(
                      { label: '本人出镜底板（视频 / 人像照片）' },
                      ui.select({ value: S(av.sourcePath), options: [{ value: '', label: '自动：使用第一个数字人底板素材' }, ...sourceOpts], placeholder: '选本人出镜底板视频 / 人像', onChange: (v) => set({ sourcePath: v }) }),
                    ),
                    ui.field(
                      { label: '声音克隆样本（选填）', hint: '不选就用当前主讲音色配音' },
                      ui.select({ value: S(av.voiceSamplePath), options: [{ value: '', label: '自动：使用第一个声音克隆样本' }, ...sampleOpts], placeholder: '选声音克隆样本', onChange: (v) => set({ voiceSamplePath: v }) }),
                    ),
                  ],
                  { min: 260 },
                ),
                ui.row([
                  ui.file('上传本人视频 / 照片', async (files) => {
                    const n = await PK.importFiles(files, { role: 'avatar_base' })
                    PK.toast(`已导入 ${n} 个数字人底板素材，并自动设为底板`, 'success')
                  }, { accept: 'video/*,image/*', icon: 'upload', kind: 'primary', size: 'sm', busyText: '上传中…' }),
                  ui.file('上传声音样本', async (files) => {
                    const n = await PK.importFiles(files, { role: 'voice_clone' })
                    PK.toast(`已导入 ${n} 个声音克隆样本`, 'success')
                  }, { accept: 'audio/*,video/*', icon: 'mic', size: 'sm', busyText: '上传中…' }),
                  ui.btn('提词器录制', () => PK.open('teleprompter'), { icon: 'cam', size: 'sm' }),
                  ui.btn('配音中心 · 克隆声音', () => PK.open('voices', { tab: 'clone' }), { icon: 'voice', size: 'sm', kind: 'ghost' }),
                ]),
                ui.field(
                  { label: '绿幕 / 蓝幕抠像', hint: '底板视频是在纯色背景前拍的，就选对应颜色把背景抠掉' },
                  ui.row([
                    ui.seg({
                      value: chromaSel,
                      options: CHROMA,
                      onChange: (v) => {
                        if (v === 'custom') {
                          L.chromaCustom = true
                          if (!chromaVal) set({ chromaKeyColor: '#00B140' })
                          else ctx.render()
                        } else {
                          L.chromaCustom = false
                          set({ chromaKeyColor: v })
                        }
                      },
                    }),
                    chromaSel === 'custom' ? ui.color({ value: chromaVal || '#00B140', onChange: (v) => L.setChroma(v) }) : null,
                  ]),
                ),
              ),
        ),
      )
    } else {
      out.push(
        ui.section(
          { title: 'AI 主播形象', en: 'AI PRESENTER', icon: 'sparkle', desc: '按配音声波实时驱动眨眼与口型，零外部算力。' },
          ui.grid(
            templates.map((t) =>
              ui.card({
                key: `av-tpl-${t.id}`,
                media: h(
                  'div.pk-settings-swatch',
                  {
                    'aria-hidden': 'true',
                    style: {
                      width: '100%',
                      height: '100%',
                      display: 'grid',
                      placeItems: 'center',
                      background: `linear-gradient(135deg, ${t.primary || '#22D3EE'}, ${t.secondary || '#818CF8'})`,
                      color: '#fff',
                      font: '800 12px/1.2 var(--pk-font-mono)',
                      letterSpacing: '0.12em',
                      textShadow: '0 1px 3px rgba(0,0,0,.45)',
                    },
                  },
                  h('span', null, t.badge || 'AI HOST'),
                ),
                aspect: '16/7',
                title: t.name || t.id,
                sub: t.subtitle || '',
                active: av.presetId === t.id,
                tags: av.presetId === t.id ? [ui.pill('已选', 'acc', { dot: true })] : null,
                onClick: () => set({ presetId: t.id }, `已选择「${t.name || t.id}」`),
              }),
            ),
            { min: 200 },
          ),
        ),
      )
    }
    out.push(
      ui.section(
        { key: AVATAR_JUMP.generate, title: '生成数字人片段', en: 'GENERATE', icon: 'film' },
        actBtn(ctx, 'av-gen', genBusy ? '数字人合成中…' : '立即合成透明数字人', () => generateAvatar(ctx), { kind: 'primary', icon: 'wand', disabled: genBusy || !hasProject, busyText: '准备中…', title: hasProject ? '' : '需要先打开一个视频工程' }),
        jobView('avatar-gen', { log: false }),
        L.visualNotice || (clip && clip.visualNotice) ? ui.note(L.visualNotice || clip.visualNotice, { level: 'info' }) : null,
        clip && clip.path
          ? ui.split(
              [ui.video(PK.assetUrl(clip.path), { autoplay: true, loop: true, muted: true, aspect: '8/9', class: 'pk-settings-avclip' })],
              [
                ui.note(`${S(clip.providerUsed) || 'local'} · ${S(clip.pixFmt) || 'yuva420p'} · ${U.num(clip.durationSec).toFixed(1)} 秒`, { level: 'ok', title: '透明通道数字人贴片已生成' }),
                ui.btn('在分步精修里监看', () => PK.open('studio', { step: 'scenes' }), { icon: 'eye', size: 'sm' }),
              ],
              { ratio: 'minmax(0, 0.6fr) minmax(0, 1fr)' },
            )
          : hasProject
            ? ui.hint('还没有生成过数字人片段。开启数字人后一键出片会自动生成；也可以点上面的按钮先单独合成看看效果。')
            : null,
      ),
    )
    out.push(
      ui.section(
        {
          key: AVATAR_JUMP.lipsync,
          title: '口型引擎',
          en: 'LIP-SYNC',
          icon: 'mic',
          desc: '克隆真人口播时让嘴型跟着配音动（真人口型同步）。',
          actions: [
            actBtn(ctx, 'lip-deep', '深度检测', async () => {
              await loadLipsync(ctx, true)
              const r = ctx.local.lipsync
              PK.toast(r && r.ready ? '口型引擎深度检测通过（已加载模型与 CUDA）' : S(r && r.reason) || '检测未通过', r && r.ready ? 'success' : 'info')
            }, { size: 'sm', icon: 'search', kind: 'ghost', busyText: '检测中…', title: '加载模型与显卡做一次完整检测（可能要一两分钟）' }),
          ],
        },
        ls
          ? ui.note(S(ls.reason) || (ls.ready ? '口型引擎已就绪' : '口型引擎未就绪'), { level: ls.ready ? 'ok' : 'warn', title: ls.ready ? `唇形同步引擎已就绪${LIPSYNC_ENGINES[S(ls.engine)] ? ` · ${LIPSYNC_ENGINES[S(ls.engine)]}` : ''}` : '唇形同步引擎未就绪' })
          : L.lipErr
            ? ui.errorBox(L.lipErr, () => loadLipsync(ctx).then(() => ctx.update(), (e) => {
                L.lipErr = e
                ctx.update()
              }))
            : ui.spinner('正在检测口型引擎…'),
        ui.text('克隆真人口播会用本地 MuseTalk 1.5（或 .env 里配置的云端 fal LatentSync）对口型；引擎不可用时会自动退回无口型的合成叠层，不会中断出片。', { tone: 'muted' }),
        ls && !ls.ready && ls.installHint ? ui.field({ label: '手动安装命令（高级）' }, ui.code(ls.installHint)) : null,
        lipPkgs.length && !(ls && ls.ready && ls.engine === 'musetalk')
          ? h(
              'div.pk-stack',
              null,
              fgrid(
                [
                  ui.field({ label: '安装位置（可选）', hint: '建议放在空间充足的非系统盘' }, lineField({ key: 'lip-dir', value: S(L.lipDir), placeholder: `留空默认 ${S(lipPkgs[0].defaultDir) || '插件数据目录'}`, onInput: (v) => (L.lipDir = v) })),
                  ui.field({ label: '下载源' }, ui.select({ value: L.lipMirror || 'cn', options: [{ value: 'cn', label: '国内高速镜像（HF-Mirror + 清华源）' }, { value: 'global', label: '官方全球源（HuggingFace + PyPI）' }], onChange: (v) => (L.lipMirror = v) })),
                ],
                { min: 240 },
              ),
              ...lipPkgs.map((pkg) =>
                ui.card({
                  key: `lip-pkg-${pkg.id}`,
                  title: pkg.shortName || pkg.name,
                  body: h('div.pk-stack', { style: { gap: '4px' } }, ui.text(pkg.name || '', { tone: 'muted' }), ui.text(`${pkg.vramRequired || '—'} · 占用 ${pkg.diskRequired || '—'} · ${pkg.etaLabel || ''}`, { tone: 'dim' }), pkg.licenseNote ? ui.text(pkg.licenseNote, { tone: 'dim' }) : null),
                  tags: [pkg.installed ? ui.pill('已安装', 'ok', { dot: true }) : ui.pill('可选安装', 'warn')],
                  actions: [ui.btn(jobRunning('lipsync-install') ? '正在安装…' : pkg.installed ? '重新安装 / 修复' : `一键安装 ${pkg.shortName || pkg.id}`, () => installLipsync(ctx, pkg), { kind: pkg.installed ? 'secondary' : 'primary', icon: 'download', size: 'sm', disabled: jobRunning('lipsync-install') })],
                }),
              ),
            )
          : null,
        jobView('lipsync-install'),
      ),
    )
    const ep = L.ep
    const epDirty = !same(ep, L.epBase)
    out.push(
      ui.section(
        { key: AVATAR_JUMP.provider, title: '外接数字人 / 唇形驱动服务（高级）', en: 'EXTERNAL PROVIDER', icon: 'link', desc: '免外部算力模式：AI 主播按音轨声波实时驱动眨眼 / 嘴型生成透明 WebM；克隆真人则对本人视频叠加克隆声音。需要对真人照片 / 视频做真实唇形同步时，填写外接 MuseTalk / LatentSync 接口。' },
        ui.row([ui.pill(prov.neuralReady ? `外接神经对口型（${prov.provider}）` : '内置声波口型 / 本地人像合成', prov.neuralReady ? 'ok' : 'mute', { dot: true })]),
        fgrid(
          [
            ui.field(
              { label: '服务类型' },
              ui.select({
                value: ep.provider || 'auto',
                options: [
                  { value: 'auto', label: '自动（auto）' },
                  { value: 'musetalk', label: 'MuseTalk' },
                  { value: 'latentsync', label: 'LatentSync' },
                  { value: 'local-composite', label: '仅本地合成' },
                ],
                onChange: (v) => {
                  ep.provider = v
                  ctx.render()
                },
              }),
            ),
            ui.field({ label: '接口地址（可选）' }, lineField({ key: 'av-ep', value: ep.endpoint, placeholder: '例如 http://127.0.0.1:7865', onInput: (v) => (ep.endpoint = v) })),
          ],
          { min: 240 },
        ),
        ui.field(
          {
            label: 'Bearer API Key（可选）',
            hint: '本地服务没有鉴权就留空',
            aside: prov.hasApiKey ? ui.btn('清除已保存的 Key', () => clearAvatarKey(ctx), { kind: 'link', size: 'sm', confirm: { title: '清除数字人接口 Key？', text: '将删除已保存的数字人接口 API Key。', ok: '清除', danger: true } }) : null,
          },
          secretField(ctx, { key: 'av-key', value: ep.apiKey, saved: prov.hasApiKey, masked: prov.maskedApiKey, placeholder: '可选：Bearer API Key（留空表示本地无鉴权）', onInput: (v) => (ep.apiKey = v) }),
        ),
        ui.row([ui.spacer(), actBtn(ctx, 'av-ep-save', '保存接口', () => saveAvatarEndpoint(ctx), { kind: epDirty ? 'primary' : 'secondary', icon: 'save', busyText: '保存中…' })]),
      ),
    )
    return out
  }

  PK.panel('avatar', {
    title: '数字人',
    en: 'AVATAR · AI 主播 / 克隆本人 · 透明通道 yuva420p',
    idx: 'AV',
    icon: 'user',
    kind: 'modal',
    size: 'lg',
    group: 'tools',
    order: 50,
    desc: 'AI 主播或克隆本人出镜口播，生成透明叠层',
    aliases: { avatarClone: {}, digitalHuman: {}, lipsync: { tab: 'lipsync' } },
    watch: (s) => [s && s.rev, s && s.avatar, s && s.project && s.project.dir],
    /** re-opened while open: `{ tab: 'lipsync' | 'provider' | 'generate' }` jumps to that section again */
    onArgs(ctx, a) {
      if (a && AVATAR_JUMP[S(a.tab)]) ctx.local.jump = AVATAR_JUMP[S(a.tab)]
      ctx.render()
    },
    onWatch: async (ctx, v) => {
      if (v[0] !== ctx.local.rev || v[2] !== ctx.local.dir) {
        ctx.local.rev = v[0]
        ctx.local.dir = v[2]
        await ctx.load()
        const prov = (ctx.data && ctx.data.avatarProvider) || {}
        if (same(ctx.local.ep, ctx.local.epBase)) {
          ctx.local.ep = { provider: prov.provider || 'auto', endpoint: S(prov.endpoint), apiKey: '' }
          ctx.local.epBase = clone(ctx.local.ep)
        }
      }
      ctx.update()
    },
    mount(ctx) {
      ctx.local.rev = st().rev
      ctx.local.dir = PK.dir()
      ctx.local.jump = AVATAR_JUMP[S(ctx.args && ctx.args.tab)] || null
      ctx.listen('settings:jobs', () => ctx.update())
      ctx.load().then(() => {
        const prov = (ctx.data && ctx.data.avatarProvider) || {}
        ctx.local.ep = { provider: prov.provider || 'auto', endpoint: S(prov.endpoint), apiKey: '' }
        ctx.local.epBase = clone(ctx.local.ep)
        ctx.update()
      })
      loadLipsync(ctx)
        .catch((err) => {
          ctx.local.lipErr = err
        })
        .finally(() => ctx.update())
    },
    beforeClose(ctx, reason) {
      if (!['x', 'esc', 'scrim'].includes(reason) || !ctx.local.ep || same(ctx.local.ep, ctx.local.epBase)) return true
      PK.confirm({ title: '接口设置还没保存', text: '「外接数字人服务」里的修改还没有保存，关闭后会丢失。', ok: '放弃修改并关闭', cancel: '继续编辑', danger: true }).then((ok) => {
        if (ok) ctx.frame.close('force')
      })
      return false
    },
    render(ctx) {
      if (!ctx.data) return ctx.loadError ? ui.errorBox(ctx.loadError, () => ctx.load(true)) : ui.loading('正在读取数字人配置…')
      if (!ctx.local.ep) {
        const prov = ctx.data.avatarProvider || {}
        ctx.local.ep = { provider: prov.provider || 'auto', endpoint: S(prov.endpoint), apiKey: '' }
        ctx.local.epBase = clone(ctx.local.ep)
      }
      const av = avatarState()
      ctx.foot([
        ui.hint(av.enabled ? `已开启 · ${av.mode === 'cloned-human' ? '克隆真人' : 'AI 主播'} · ${(AVATAR_LAYOUTS.find((l) => l.value === av.layout) || AVATAR_LAYOUTS[0]).label}` : '数字人未开启'),
        ui.spacer(),
        ui.btn('关闭', () => ctx.close(), { kind: 'ghost' }),
      ])
      const nodes = renderAvatar(ctx)
      applyJump(ctx)
      return nodes
    },
  })

  /* =============================================================================================== 算力体检 */
  PK.panel('hardware', {
    title: '算力体检',
    en: 'HARDWARE PROFILE · VIBECODING 八件套',
    idx: 'HW',
    icon: 'cpu',
    kind: 'modal',
    size: 'lg',
    group: 'settings',
    order: 20,
    desc: '本机配置、低配保护模式与工具链状态',
    aliases: { compute: {}, health: {}, lowSpec: {} },
    watch: (s) => s && s.rev,
    onWatch: async (ctx) => {
      await ctx.load()
      ctx.local.hw = null
      ctx.update()
    },
    mount(ctx) {
      ctx.load()
    },
    render(ctx) {
      if (!ctx.data) return ctx.loadError ? ui.errorBox(ctx.loadError, () => ctx.load(true)) : ui.loading('正在检测本机硬件…')
      const src = ctx.local.hw || ctx.data
      const p = src.hardwareProfile || null
      const prefs = src.hardwarePreferences || {}
      const policy = src.hardwarePolicy || null
      const vibe = Array.isArray(src.vibeToolkit) ? src.vibeToolkit : []
      const a = ctx.data.authorInfo || {}
      const recheck = async () => {
        const d = st().director || {}
        const res = await PK.get('hardware', { refresh: 1, quality: d.quality || '1080p', fps: U.num(d.fps, 30) || 30 }, { timeout: 120000 })
        ctx.local.hw = res
        PK.toast('已重新检测本机硬件', 'success')
      }
      ctx.foot([ui.hint(p && p.probedAt ? `检测时间：${U.fmtTime(p.probedAt)}` : '8GB 内存与核显电脑也可以安全出片'), ui.spacer(), actBtn(ctx, 'hw-recheck', '重新检测', recheck, { icon: 'refresh', busyText: '检测中…' })])
      const out = []
      if (p) {
        const tone = !p.canRun ? 'error' : policy && policy.lowSpecSafe ? 'warn' : 'ok'
        const gpuSub = S(p.gpu && p.gpu.primaryName)
        out.push(ui.note(S(p.verdictSummary), { level: tone, title: S(p.verdictTitle).replace(/^[\s✓✔✅⚠❌✕×!！]+/u, '') || S(p.tierLabel) || '本机体检结果' }))
        if (p.criticalBlocker) out.push(ui.note(S(p.criticalBlocker), { level: 'error', title: '需要先解决' }))
        out.push(
          ui.grid(
            [
              ['CPU 处理器', `${U.num(p.cpu && p.cpu.threads) || '?'} 线程`, S(p.cpu && p.cpu.model)],
              ['系统内存', `${S(p.memory && p.memory.freeGB) || '?'} / ${S(p.memory && p.memory.totalGB) || '?'} GB 可用`, p.checks && p.checks.ramOk ? '满足运行标准' : '内存偏紧，建议开启低配保护'],
              ['显卡与显存', p.gpu && U.num(p.gpu.vramGB) > 0 ? `${U.num(p.gpu.vramGB).toFixed(1)} GB 显存` : '核显 / 通用', gpuSub],
              ['磁盘可用空间', p.disk && p.disk.freeGB != null ? `${S(p.disk.freeGB)} GB` : '充足', p.checks && p.checks.diskOk === false ? '建议清理磁盘空间' : '空间充足'],
            ].map(([k, v, sub]) => ui.card({ key: `hw-${k}`, title: k, body: h('div.pk-stack', { style: { gap: '2px' } }, ui.strong(v), sub ? ui.text(sub, { tone: 'dim' }) : null) })),
            { min: 200 },
          ),
        )
      }
      out.push(
        ui.section(
          { title: '低配电脑保护策略', en: 'LOW-SPEC PROTECTION', icon: 'lock', desc: '如果客户端误报配置过低，或者渲染时电脑很卡，可以在这里切换。' },
          lowSpecCards(ctx, prefs, policy, (res) => {
            ctx.local.hw = res
          }),
        ),
      )
      if (p && p.ttsAdvice) {
        out.push(
          ui.note(S(p.ttsAdvice), {
            level: 'info',
            title: `配音引擎建议${p.recommendedTtsEngine ? `：${p.recommendedTtsEngine}` : ''}`,
            actions: [ui.btn('打开配音引擎设置', () => PK.open('keys', { tab: 'tts' }), { size: 'sm', icon: 'voice' })],
          }),
        )
      }
      if (vibe.length) {
        out.push(
          ui.section(
            { title: 'Vibecoding 工具箱', en: 'TOOLKIT', icon: 'box', count: `${vibe.filter((t) => t.available).length}/${vibe.length}` },
            ui.grid(
              vibe.map((t) =>
                ui.card({
                  key: `vibe-${t.id}`,
                  title: t.name || t.id,
                  body: h('div.pk-stack', { style: { gap: '2px' } }, ui.text(t.available ? S(t.version) || S(t.source) || '已安装' : t.optional ? '可选 · 未安装时自动用内置引擎' : '未安装', { tone: 'muted', mono: Boolean(t.available && t.version) }), t.role ? ui.text(t.role, { tone: 'dim' }) : null),
                  tags: [t.available ? ui.pill('就绪', 'ok', { dot: true }) : t.optional ? ui.pill('可选', 'mute') : ui.pill('未安装', 'warn')],
                }),
              ),
              { min: 190 },
            ),
          ),
        )
      }
      const reqs = p && p.requirements ? [p.requirements.minimum, p.requirements.recommended, p.requirements.flagship].filter(Boolean) : []
      if (reqs.length) {
        out.push(
          ui.section(
            { title: '配置要求参考', en: 'REQUIREMENTS', icon: 'list' },
            ui.grid(
              reqs.map((r) =>
                ui.card({
                  key: `req-${r.id}`,
                  title: r.tierLabel || r.id,
                  active: r.id === ({ 'low-spec': 'minimum', low: 'minimum', standard: 'recommended', high: 'flagship' }[p.tier] || ''),
                  tags: r.id === ({ 'low-spec': 'minimum', low: 'minimum', standard: 'recommended', high: 'flagship' }[p.tier] || '') ? [ui.pill('本机所在档位', 'acc', { dot: true })] : null,
                  body: ui.kv([
                    ['CPU', S(r.cpu)],
                    ['内存', S(r.ram)],
                    ['显卡', S(r.gpu)],
                    ['磁盘', S(r.disk)],
                    ['推荐导出', S(r.recommendedRender)],
                  ]),
                }),
              ),
              { min: 240 },
            ),
          ),
        )
      }
      if (a.name) out.push(authorNote(a))
      return out
    },
  })
})()
