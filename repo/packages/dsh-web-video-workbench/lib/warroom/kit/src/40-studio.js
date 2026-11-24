/* ============================================================================================================
 * PK · 分步精修 workspace shell — one big panel with 4 steps (素材 → 导演参数 → 分镜精修 → 交付)
 * Steps are registered by panel modules:  PK.studioStep(id, { label, en, icon, order, render(ctx, s) })
 *   s = { data (raw /state), project (activeProject), script, local (per-step store), go(stepId, args), reload() }
 * ============================================================================================================ */
;(function () {
  'use strict'
  const PK = window.PK
  const h = PK.h
  const ui = PK.ui

  const steps = new Map()
  PK.studioSteps = steps
  PK.studioStep = (id, def) => {
    steps.set(id, { id, order: 50, ...def })
    PK.emit('panels-changed')
  }
  const DEFAULT_STEPS = [
    ['assets', '素材', 'ASSETS', 'image', 10],
    ['director', '导演参数', 'DIRECTOR', 'wand', 20],
    ['scenes', '分镜精修', 'SCENES', 'film', 30],
    ['delivery', '交付', 'DELIVERY', 'box', 40],
  ]
  const ordered = () => {
    const out = DEFAULT_STEPS.map(([id, label, en, icon, order]) => steps.get(id) || { id, label, en, icon, order, placeholder: true })
    for (const s of steps.values()) if (!out.some((x) => x.id === s.id)) out.push(s)
    return out.sort((a, b) => a.order - b.order)
  }

  PK.panel('studio', {
    title: '分步精修',
    en: 'STEP-BY-STEP REFINE · 素材 → 导演 → 分镜 → 交付',
    idx: '02',
    icon: 'layers',
    kind: 'workspace',
    size: 'xl',
    group: 'main',
    order: 10,
    desc: '逐步把关：素材、参数、分镜、交付',
    needsProject: true,
    fill: true,
    aliases: {
      refine: {},
      assets: { step: 'assets' },
      director: { step: 'director' },
      scenes: { step: 'scenes' },
      scene: { step: 'scenes' },
      delivery: { step: 'delivery' },
    },
    watch: (st) => [st && st.project && st.project.dir, st && st.rev],
    onWatch: (ctx) => {
      if (!PK.hasProject()) {
        ctx.close()
        return
      }
      ctx.load(true)
    },
    mount(ctx) {
      ctx.local.step = ctx.args.step && ordered().some((s) => s.id === ctx.args.step) ? ctx.args.step : 'assets'
      ctx.load()
    },
    onArgs(ctx, a) {
      if (a.step) ctx.local.step = a.step
      ctx.render()
    },
    render(ctx) {
      const list = ordered()
      const cur = list.find((s) => s.id === ctx.local.step) || list[0]
      const sScope = (ctx.local[`s:${cur.id}`] = ctx.local[`s:${cur.id}`] || {})
      const go = (id, args = {}) => {
        ctx.local.step = id
        ctx.args = { ...ctx.args, ...args, step: id }
        ctx.foot(null)
        ctx.render()
      }
      const st = PK.state || {}
      const title = (st.project && st.project.title) || ''
      ctx.setTitle('分步精修', title ? `STEP-BY-STEP REFINE · ${title}` : 'STEP-BY-STEP REFINE')
      const nav = ui.steps(
        list.map((s, i) => ({
          value: s.id,
          n: String(i + 1).padStart(2, '0'),
          label: s.label,
          sub: s.en,
          state: s.id === cur.id ? 'active' : 'todo',
        })),
        { onClick: (id) => go(id), class: 'pk-studio-steps' },
      )
      let body
      if (!ctx.data && !ctx.loadError) body = ui.loading('正在读取工程…')
      else if (ctx.loadError && !ctx.data) body = ui.errorBox(ctx.loadError, () => ctx.load(true))
      else if (cur.placeholder || typeof cur.render !== 'function') body = ui.empty({ icon: cur.icon || 'layers', title: `「${cur.label}」正在接入`, text: '该步骤的原生面板正在开发中。' })
      else {
        const data = ctx.data || {}
        const s = {
          data,
          project: data.activeProject || null,
          script: (data.activeProject && data.activeProject.script) || null,
          local: sScope,
          go,
          reload: () => ctx.load(true),
          args: ctx.args,
        }
        try {
          body = cur.render(ctx, s)
        } catch (err) {
          console.error('[PK] studio step failed', err)
          body = h('div.pk-render-failed', null, ui.errorBox(err, () => ctx.render()))
        }
      }
      return h('div.pk-studio', { 'data-step': cur.id }, h('nav.pk-studio-nav', { 'aria-label': '分步精修步骤' }, nav), h('div.pk-studio-body', { 'data-pk-scroll': `studio-${cur.id}` }, Array.isArray(body) ? body : [body]))
    },
  })
})()
