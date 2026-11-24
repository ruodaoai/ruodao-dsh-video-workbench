/* ============================================================================================================
 * PK · panel registry & router — PK.panel(id, def) / PK.open(id, args) / PK.catalog()
 * plus the host event wiring (open-panel, error, need-llm) and the shared 主题需求 big editor (PK.editTopic).
 * ============================================================================================================ */
;(function () {
  'use strict'
  const PK = window.PK
  const U = PK.util
  const h = PK.h
  const ui = PK.ui

  const registry = new Map() // id → def
  const aliases = new Map() // alias → { id, args }
  const open = new Map() // id → ctx
  PK.panels = registry

  /* Coalesced re-renders (ctx.update — host data refreshes, async results) wait while the user is mid-gesture inside the
   * kit: a mouse button held down (a click whose button got replaced between down and up was lost; slider drags broke)
   * or an IME composition in progress (re-creating the input committed half-typed pinyin). They run on release.
   * Explicit ctx.render() calls are never deferred. */
  const gesture = { down: false, composing: false, waiting: new Set() }
  const inKit = (t) => Boolean(t && t.closest && t.closest('#pk-root'))
  const releaseGesture = () => {
    if (gesture.down || gesture.composing) return
    const list = [...gesture.waiting]
    gesture.waiting.clear()
    for (const ctx of list) ctx.update()
  }
  document.addEventListener('pointerdown', (ev) => (gesture.down = inKit(ev.target)), true)
  for (const evName of ['pointerup', 'pointercancel']) {
    document.addEventListener(evName, () => {
      if (!gesture.down) return
      gesture.down = false
      // after the click event that follows pointerup has been dispatched to the original button
      setTimeout(releaseGesture, 0)
    }, true)
  }
  document.addEventListener('compositionstart', (ev) => (gesture.composing = inKit(ev.target)), true)
  document.addEventListener('compositionend', () => {
    gesture.composing = false
    setTimeout(releaseGesture, 0)
  }, true)
  window.addEventListener('blur', () => {
    gesture.down = false
    gesture.composing = false
    releaseGesture()
  })

  /**
   * Register a panel.
   * def = {
   *   title, en, idx, icon,                 // header (idx = short code shown by skins that number their drawers)
   *   kind: 'modal'|'drawer'|'workspace',   // default frame kind (skins may override per panel: PK.configure({ frames: { id: kind } }))
   *   size: 'sm'|'md'|'lg'|'xl',
   *   group: 'main'|'tools'|'settings'|'hidden', order: number, desc: '一句话说明（菜单副标题）',
   *   needsProject: boolean,                // opens the 工程 panel instead when no project is open
   *   aliases: { legacyName: { ...args } }  // e.g. { llm: { tab: 'llm' } }
   *   mount(ctx), render(ctx) → Node|Node[], unmount(ctx),
   *   watch(state) → any                    // re-render when this value changes (deep-equal) — keep it narrow!
   * }
   */
  PK.panel = (id, def) => {
    if (!id || !def || typeof def.render !== 'function') throw new Error(`PK.panel(${id}): render() is required`)
    registry.set(id, { id, kind: 'modal', size: 'lg', group: 'tools', order: 50, ...def })
    for (const [alias, args] of Object.entries(def.aliases || {})) aliases.set(alias, { id, args: args || {} })
    PK.emit('panels-changed')
    return registry.get(id)
  }
  PK.alias = (alias, id, args = {}) => aliases.set(alias, { id, args })
  PK.catalog = (group) =>
    [...registry.values()]
      .filter((d) => d.group !== 'hidden' && (!group || d.group === group))
      .sort((a, b) => a.order - b.order)
      .map((d) => ({ id: d.id, title: d.title, en: d.en || '', idx: d.idx || '', icon: d.icon || '', desc: d.desc || '', group: d.group, needsProject: Boolean(d.needsProject) }))
  PK.isOpen = (id) => open.has(id)
  PK.close = (id) => {
    const c = open.get(id)
    if (c) c.close()
  }

  /** capture focus + caret + scroll so a re-render does not disturb the user */
  function snapshot(ctx) {
    const s = { scroll: [], focusKey: null, selStart: null, selEnd: null }
    const scrollers = [ctx.frame.body, ...ctx.frame.body.querySelectorAll('[data-pk-scroll]')]
    for (const el of scrollers) s.scroll.push([el === ctx.frame.body ? '__body' : el.getAttribute('data-pk-scroll'), el.scrollTop, el.scrollLeft])
    const a = document.activeElement
    if (a && ctx.frame.el.contains(a)) {
      const k = a.closest('[data-pk-key]')
      if (k) {
        s.focusKey = k.getAttribute('data-pk-key')
        if (typeof a.selectionStart === 'number') {
          s.selStart = a.selectionStart
          s.selEnd = a.selectionEnd
        }
      }
    }
    return s
  }
  function restore(ctx, s) {
    for (const [key, top, left] of s.scroll) {
      const el = key === '__body' ? ctx.frame.body : ctx.frame.body.querySelector(`[data-pk-scroll="${CSS.escape(key)}"]`)
      if (el) {
        el.scrollTop = top
        el.scrollLeft = left
      }
    }
    if (s.focusKey) {
      const el = ctx.frame.body.querySelector(`[data-pk-key="${CSS.escape(s.focusKey)}"]`)
      const target = el && (el.matches('input,textarea,button,[tabindex]') ? el : el.querySelector('input,textarea,button,[tabindex]'))
      if (target) {
        try {
          target.focus({ preventScroll: true })
          if (s.selStart !== null && typeof target.setSelectionRange === 'function') target.setSelectionRange(s.selStart, s.selEnd)
        } catch {}
      }
    }
  }

  /**
   * Open (or focus) a panel. Legacy host names (llm, tts, teleprompter, …) resolve through aliases.
   * Returns the panel ctx (or null when the panel is unknown).
   */
  PK.open = (rawId, args = {}) => {
    PK.closePop()
    let id = String(rawId || '')
    let a = args && typeof args === 'object' ? { ...args } : {}
    if (!registry.has(id) && aliases.has(id)) {
      const al = aliases.get(id)
      id = al.id
      a = { ...al.args, ...a }
    }
    const def = registry.get(id)
    if (!def) {
      PK.toast(`「${rawId}」面板正在接入中`, 'info')
      return null
    }
    if (def.needsProject && !PK.hasProject()) {
      PK.toast('请先新建或打开一个视频工程', 'info')
      if (id !== 'projects' && registry.has('projects')) return PK.open('projects')
      return null
    }
    const existing = open.get(id)
    if (existing) {
      existing.args = { ...existing.args, ...a }
      const i = PK.frames.stack.indexOf(existing.frame)
      if (i >= 0 && i !== PK.frames.stack.length - 1) {
        // bring to front
        PK.frames.stack.splice(i, 1)
        PK.frames.stack.push(existing.frame)
        existing.frame.layer.parentNode.appendChild(existing.frame.layer)
      }
      if (def.onArgs) def.onArgs(existing, a)
      else existing.render()
      return existing
    }
    const kindOverride = PK.cfg.frames && PK.cfg.frames[id]
    const frame = PK.frame({
      id,
      class: def.fill ? 'pk-frame--fill' : '',
      title: def.title,
      en: def.en,
      idx: def.idx,
      icon: def.icon,
      kind: kindOverride || def.kind,
      size: (PK.cfg.sizes && PK.cfg.sizes[id]) || def.size,
      side: def.side,
      beforeClose: (reason) => (def.beforeClose ? def.beforeClose(ctx, reason) : true),
      onClose: () => {
        open.delete(id)
        for (const fn of ctx._cleanup.splice(0)) {
          try {
            fn()
          } catch {}
        }
        try {
          def.unmount && def.unmount(ctx)
        } catch (err) {
          console.error(err)
        }
        PK.emit('panel-close', id)
        if (typeof PK.cfg.onPanelClose === 'function') PK.cfg.onPanelClose(id)
      },
    })
    let renderQueued = false
    let lastWatch
    const ctx = {
      id,
      def,
      args: a,
      frame,
      body: frame.body,
      local: {},
      _cleanup: [],
      get state() {
        return PK.state
      },
      close: () => frame.close('api'),
      setTitle: (t, en) => frame.setTitle(t, en),
      foot: (nodes) => frame.setFoot(nodes),
      busy: (text) => frame.busy(text),
      onCleanup: (fn) => ctx._cleanup.push(fn),
      /** subscribe to a PK event for the panel's lifetime */
      listen: (ev, fn) => ctx._cleanup.push(PK.on(ev, fn)),
      /** setInterval that dies with the panel */
      every: (ms, fn) => {
        const t = setInterval(() => {
          if (!document.hidden) fn()
        }, ms)
        ctx._cleanup.push(() => clearInterval(t))
        return t
      },
      /** re-render the body now (focus, caret and scroll positions are preserved) */
      render() {
        if (frame.closed) return
        const snap = snapshot(ctx)
        let nodes
        try {
          nodes = def.render(ctx)
        } catch (err) {
          console.error(`[PK] panel ${id} render failed`, err)
          nodes = h('div.pk-render-failed', null, ui.errorBox(err, () => ctx.render()))
        }
        PK.clear(frame.body)
        PK.append(frame.body, Array.isArray(nodes) ? nodes : [nodes])
        restore(ctx, snap)
      },
      /** coalesced re-render (use from async callbacks); waits while the user is mid-click or mid-IME-composition */
      update() {
        if (gesture.down || gesture.composing) {
          gesture.waiting.add(ctx)
          return
        }
        if (renderQueued) return
        renderQueued = true
        requestAnimationFrame(() => {
          renderQueued = false
          if (gesture.down || gesture.composing) {
            gesture.waiting.add(ctx)
            return
          }
          ctx.render()
        })
      },
      /** async helper: show the frame busy strip while fn runs; toasts errors; returns fn's result or undefined */
      async task(label, fn, opts = {}) {
        frame.busy(label)
        try {
          const r = await fn()
          if (opts.ok) PK.toast(typeof opts.ok === 'function' ? opts.ok(r) : opts.ok, 'success')
          return r
        } catch (err) {
          PK.reportError(err, opts.fail)
          return undefined
        } finally {
          frame.busy(false)
          if (opts.rerender !== false) ctx.update()
        }
      },
      /** load the raw /state snapshot into ctx.data (re-renders when done) */
      async load(force) {
        try {
          ctx.loadError = null
          ctx.data = await PK.store.load(force)
        } catch (err) {
          ctx.loadError = err
        }
        ctx.update()
        return ctx.data
      },
    }
    open.set(id, ctx)
    if (def.watch) {
      try {
        lastWatch = def.watch(PK.state, ctx)
      } catch {}
      ctx.listen('state', (st) => {
        let v
        try {
          v = def.watch(st, ctx)
        } catch {
          return
        }
        if (!U.deepEqual(v, lastWatch)) {
          lastWatch = U.cloneJson(v)
          if (def.onWatch) def.onWatch(ctx, v)
          else ctx.update()
        }
      })
    }
    try {
      def.mount && def.mount(ctx)
    } catch (err) {
      console.error(`[PK] panel ${id} mount failed`, err)
    }
    ctx.render()
    PK.emit('panel-open', id)
    if (typeof PK.cfg.onPanelOpen === 'function') PK.cfg.onPanelOpen(id)
    return ctx
  }

  /* ---------------------------------------------------------------- legacy host panel names */
  // (kept so older skin builds / host `openPanel` requests still land on the native panels)
  const LEGACY = {
    llm: ['keys', { tab: 'llm' }],
    tts: ['keys', { tab: 'tts' }],
    settings: ['keys', {}],
    teleprompter: ['teleprompter', {}],
    prompter: ['teleprompter', {}],
    hardware: ['hardware', {}],
    compute: ['hardware', {}],
    health: ['hardware', {}],
    export: ['export', {}],
    pack: ['export', {}],
    voice: ['voices', {}],
    refine: ['studio', {}],
    ref: ['reference', {}],
    compare: ['reference', {}],
    hub: ['plaza', {}],
    new: ['newProject', {}],
  }
  for (const [k, [id, args]] of Object.entries(LEGACY)) if (!aliases.has(k)) aliases.set(k, { id, args })

  /* ---------------------------------------------------------------- host events */
  PK.on('event:open-panel', (d) => {
    if (d && d.panel) PK.open(String(d.panel), d.args || {})
  })
  PK.on('event:error', (d) => {
    const action = d && d.action === 'open-llm' ? { label: '去设置 · 模型与密钥', onClick: () => PK.open('keys', { tab: 'llm' }) } : d && d.action === 'load-starter' ? { label: '一键加载演示素材', onClick: () => PK.post('assets/starter-pack', { projectDir: PK.needProject() }).then(() => PK.toast('演示素材已载入', 'success')) } : null
    PK.toast(String((d && d.title) || '操作遇到问题'), 'error', { detail: d && d.detail && d.detail !== d.title ? d.detail : '', action })
  })
  let lastNeedLlm = 0
  PK.on('need-llm', (m) => {
    if (Date.now() - lastNeedLlm < 1500) return
    lastNeedLlm = Date.now()
    PK.toast(String((m && m.error) || '请先配置 AI 大模型接口'), 'warn', { action: { label: '去配置', onClick: () => PK.open('keys', { tab: 'llm' }) } })
    if (registry.has('keys')) PK.open('keys', { tab: 'llm' })
  })

  /* ---------------------------------------------------------------- the shared 主题需求 editor */
  const TOPIC_TEMPLATES = [
    { label: '产品宣传', text: '为【产品名】制作一支 60 秒宣传片：开场 3 秒抛出用户痛点，中段用 3 个镜头展示核心卖点（速度 / 体验 / 价格），结尾给出行动号召。整体科技感、节奏明快，配激昂的电子乐。' },
    { label: '知识科普', text: '用通俗易懂的方式讲清楚【一个知识点】：先用一个生活化的问题引入，再分 3 步拆解原理，每一步配动态图解，最后用一句话总结。语气亲切，像朋友聊天。' },
    { label: '历史人物', text: '讲述【历史人物】波澜壮阔的一生：少年立志 → 关键转折 → 高光时刻 → 结局与评价。史诗卡点风格，战鼓配乐，高潮处慢镜头 + 大字冲击。' },
    { label: '门店探店', text: '为【店名】拍一支 45 秒探店短视频：门头 → 招牌产品特写 → 环境氛围 → 顾客好评 → 地址与优惠信息。温暖治愈的色调，轻快的吉他配乐。' },
    { label: '软件教程', text: '做一个【软件 / 功能】的零基础教程：先展示最终效果，再分步骤演示操作（每步配高亮标注和字幕），最后总结常见问题。语速适中，界面放大清晰。' },
    { label: 'Vlog 旅行', text: '把我在【地点】的旅行剪成 1 分钟 Vlog：清晨出发 → 风景大片 → 美食 → 夜景，结尾一句感悟。胶片色调，节奏随音乐卡点。' },
  ]
  PK.TOPIC_TEMPLATES = TOPIC_TEMPLATES
  /**
   * The big 「创意需求 / 导演指令」 editor used by every skin's brief input.
   * Saves through `setDirector {topic}`; optional 「保存并一键出片」 sends `run`.
   */
  PK.editTopic = async (o = {}) => {
    const st = PK.state || {}
    const cur = o.value !== undefined ? String(o.value) : String((st.director && st.director.topic) || '')
    const v = await PK.editText({
      title: o.title || '创意需求 · 导演指令',
      en: 'BRIEF · 一句话也能出片，写得越具体成片越贴心',
      value: cur,
      size: 'xl',
      maxLength: 8000,
      placeholder: '例如：为一家社区咖啡馆做一支 45 秒的秋季新品宣传片，突出「桂花拿铁」的温暖口感，镜头温柔、配轻爵士乐，结尾给出门店地址和第二杯半价的活动……',
      hint: '写下你想要的视频：主题、时长、风格、节奏、配乐、必须出现的信息都可以。AI 会据此完成分镜、配音、配乐、动效与成片。',
      templates: TOPIC_TEMPLATES,
      actions: [
        {
          label: 'AI 一键润色',
          icon: 'wand',
          busyText: 'AI 润色中…',
          run: async (text) => {
            if (!text.trim()) throw new PK.Error('先写一句你的想法，再让 AI 润色扩写')
            if (!PK.hasProject()) throw new PK.Error('请先新建或打开一个视频工程', { code: 'no-project' })
            await PK.action('setDirector', { patch: { topic: text } })
            await PK.action('polishTopic', { topic: text }, { timeout: 300000 })
            // the host updates director.topic when the polish completes; wait for that state push
            await PK.waitState((s) => s && s.director && s.director.topic && s.director.topic !== text, 4000)
            const polished = String((PK.state && PK.state.director && PK.state.director.topic) || '')
            if (polished && polished !== text) {
              PK.toast('已润色为专业导演指令，可继续修改', 'success')
              return polished
            }
            return undefined
          },
        },
      ],
      extraButtons: o.allowRun === false
        ? []
        : [
            {
              label: '保存并一键出片',
              icon: 'bolt',
              kind: 'secondary',
              busyText: '启动中…',
              run: async (text) => {
                if (!text.trim()) throw new PK.Error('请先写下创意需求')
                await PK.action('setDirector', { patch: { topic: text } })
                await PK.action('run', { topic: text })
                PK.toast('AI Agent 团队已启动出片', 'success')
                return true
              },
            },
          ],
      okText: '保存需求',
    })
    if (v === null || v === undefined) return null
    if (v !== cur) {
      try {
        await PK.action('setDirector', { patch: { topic: v } })
      } catch (err) {
        PK.reportError(err)
      }
    }
    if (typeof o.onSaved === 'function') o.onSaved(v)
    return v
  }
})()
