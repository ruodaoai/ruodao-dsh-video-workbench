/* ============================================================================================================
 * PK · overlays — panel frames (modal / drawer / workspace), toasts, confirm / prompt, the big text editor,
 * popover menus and searchable pickers. All DOM lives in #pk-root (fixed, above the skin).
 * ============================================================================================================ */
;(function () {
  'use strict'
  const PK = window.PK
  const U = PK.util
  const h = PK.h
  const ui = PK.ui

  let root = null
  const layers = () => {
    if (root && root.isConnected) return root
    root = h(
      'div#pk-root',
      { 'data-pk-skin': PK.skin || null },
      h('div.pk-l-frames'),
      h('div.pk-l-pop'),
      h('div.pk-toasts', { 'aria-live': 'polite' }),
    )
    document.body.appendChild(root)
    // keyboard events typed inside a kit panel never reach the skin's global shortcuts (R / Space / arrows …)
    for (const t of ['keydown', 'keyup', 'keypress']) root.addEventListener(t, (ev) => ev.stopPropagation())
    return root
  }
  PK.root = layers
  PK.on('configure', () => {
    if (root) root.setAttribute('data-pk-skin', PK.skin || '')
  })

  /* ---------------------------------------------------------------- frames */
  const stack = [] // open frames, last = top
  PK.frames = { stack }
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

  /**
   * PK.frame({ id, title, en, idx, icon, kind: 'modal'|'drawer'|'workspace'|'dialog', size: 'sm'|'md'|'lg'|'xl',
   *            side: 'right'|'left', dismissible: true, onClose })
   * → { el, body, foot, tools, setTitle(t, en), setFoot(nodes), busy(text|false), close() }
   */
  PK.frame = (o = {}) => {
    const kind = o.kind || 'modal'
    const titleId = U.uid('pkt')
    const x = h('button.pk-frame-x', { type: 'button', 'aria-label': '关闭（Esc）', title: '关闭（Esc）' }, PK.icon('x', 16))
    const tTitle = h('h2.pk-frame-t', { id: titleId }, o.title || '')
    const tEn = h('span.pk-frame-en', null, o.en || '')
    const tools = h('div.pk-frame-tools')
    const busyEl = h('div.pk-frame-busy', { hidden: true, role: 'status' }, ui.spinner(), h('span'))
    const body = h('div.pk-frame-b', { tabindex: '-1' })
    const foot = h('footer.pk-frame-f', { hidden: true })
    const frame = h(
      'section.pk-frame',
      { class: [`pk-frame--${kind}`, `pk-size--${o.size || 'md'}`, o.side ? `pk-side--${o.side}` : '', o.id ? `pk-panel--${o.id}` : '', o.class], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'data-pk-panel': o.id || null },
      h('header.pk-frame-h', null, o.idx ? h('span.pk-frame-idx', null, o.idx) : o.icon ? h('span.pk-frame-ico', null, PK.icon(o.icon, 18)) : null, h('div.pk-frame-tt', null, tTitle, tEn), tools, x),
      busyEl,
      body,
      foot,
    )
    const scrim = h('div.pk-scrim')
    const layer = h('div.pk-layer', { class: `pk-layer--${kind}` }, scrim, frame)
    const prevFocus = document.activeElement
    const api = {
      id: o.id || '',
      kind,
      el: frame,
      layer,
      body,
      foot,
      tools,
      closed: false,
      setTitle(t, en) {
        if (t !== undefined) tTitle.textContent = t
        if (en !== undefined) tEn.textContent = en
      },
      setFoot(nodes) {
        PK.clear(foot)
        const list = Array.isArray(nodes) ? nodes : nodes ? [nodes] : []
        PK.append(foot, list)
        foot.hidden = list.filter(Boolean).length === 0
      },
      busy(text) {
        busyEl.hidden = !text
        busyEl.lastChild.textContent = text ? String(text) : ''
        frame.classList.toggle('is-busy', Boolean(text))
      },
      close(reason) {
        if (api.closed) return
        if (o.beforeClose && reason !== 'force') {
          const r = o.beforeClose(reason)
          if (r === false) return
        }
        api.closed = true
        const i = stack.indexOf(api)
        if (i >= 0) stack.splice(i, 1)
        layer.classList.remove('is-open')
        layer.classList.add('is-closing')
        setTimeout(() => layer.remove(), 220)
        try {
          o.onClose && o.onClose(reason)
        } catch (err) {
          console.error(err)
        }
        PK.emit('frame-close', api)
        syncRootState()
        if (prevFocus && prevFocus.isConnected && typeof prevFocus.focus === 'function' && !stack.length) {
          try {
            prevFocus.focus({ preventScroll: true })
          } catch {}
        } else if (stack.length) focusFrame(stack[stack.length - 1])
      },
    }
    x.addEventListener('click', () => api.close('x'))
    scrim.addEventListener('click', () => {
      if (o.dismissible === false) return
      api.close('scrim')
    })
    stack.push(api)
    layers().querySelector('.pk-l-frames').appendChild(layer)
    syncRootState()
    requestAnimationFrame(() => {
      layer.classList.add('is-open')
      focusFrame(api)
    })
    PK.emit('frame-open', api)
    return api
  }
  function focusFrame(api) {
    try {
      const first = api.body.querySelector('[autofocus]') || api.body
      first.focus({ preventScroll: true })
    } catch {}
  }
  function syncRootState() {
    const r = layers()
    r.classList.toggle('has-frames', stack.length > 0)
    document.documentElement.classList.toggle('pk-has-frames', stack.length > 0)
  }
  PK.topFrame = () => stack[stack.length - 1] || null
  PK.closeAll = () => [...stack].reverse().forEach((f) => f.close('all'))

  // Esc closes the top-most popover, then frame; Tab is trapped inside the top frame
  document.addEventListener(
    'keydown',
    (ev) => {
      if (ev.key === 'Escape') {
        if (closePop()) {
          ev.stopPropagation()
          ev.preventDefault()
          return
        }
        const top = PK.topFrame()
        if (top) {
          ev.stopPropagation()
          ev.preventDefault()
          top.close('esc')
        }
      } else if (ev.key === 'Tab') {
        const top = PK.topFrame()
        if (!top || popEl) return
        const f = [...top.el.querySelectorAll(FOCUSABLE)].filter((e) => e.offsetParent !== null)
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (!top.el.contains(document.activeElement)) {
          ev.preventDefault()
          first.focus()
        } else if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault()
          last.focus()
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault()
          first.focus()
        }
      }
    },
    true,
  )
  // keyboard shortcuts of the skin must not fire while a panel is open (skins check this)
  PK.isOpenAny = () => stack.length > 0 || Boolean(popEl)

  /* ---------------------------------------------------------------- toasts */
  /**
   * PK.toast(text, level = 'info'|'success'|'error'|'warn', { title, detail, action: { label, onClick }, timeout })
   * Skins may route toasts to their own renderer with PK.configure({ toast(text, level, opts) { … ; return true } }).
   */
  PK.toast = (text, level = 'info', o = {}) => {
    if (typeof PK.cfg.toast === 'function') {
      try {
        if (PK.cfg.toast(String(text || ''), level, o) === true) return
      } catch {}
    }
    const box = layers().querySelector('.pk-toasts')
    const lvl = level === 'ok' ? 'success' : level
    const detail = o.detail ? h('pre.pk-toast-d', { hidden: true }, String(o.detail)) : null
    const t = h(
      'div.pk-toast',
      { class: `pk-toast--${lvl}`, role: lvl === 'error' ? 'alert' : 'status' },
      h('span.pk-toast-i', null, PK.icon(lvl === 'error' || lvl === 'warn' ? 'warn' : lvl === 'success' ? 'check' : 'info', 15)),
      h(
        'div.pk-toast-b',
        null,
        o.title ? h('b.pk-toast-t', null, o.title) : null,
        h('div.pk-toast-x', null, String(text || '')),
        o.action || detail
          ? h(
              'div.pk-toast-a',
              null,
              o.action
                ? ui.btn(o.action.label, async () => {
                    close()
                    await o.action.onClick()
                  }, { size: 'sm', kind: lvl === 'error' ? 'primary' : 'secondary' })
                : null,
              detail
                ? ui.btn('技术细节', (ev, b) => {
                    detail.hidden = !detail.hidden
                    b.querySelector('.pk-btn-l').textContent = detail.hidden ? '技术细节' : '收起细节'
                  }, { size: 'sm', kind: 'ghost' })
                : null,
            )
          : null,
        detail,
      ),
      h('button.pk-toast-c', { type: 'button', 'aria-label': '关闭' }, PK.icon('x', 13)),
    )
    let timer = 0
    const close = () => {
      clearTimeout(timer)
      t.classList.add('is-out')
      setTimeout(() => t.remove(), 220)
    }
    t.querySelector('.pk-toast-c').addEventListener('click', close)
    box.appendChild(t)
    while (box.children.length > 4) box.firstChild.remove()
    requestAnimationFrame(() => t.classList.add('is-in'))
    const ms = o.timeout !== undefined ? o.timeout : lvl === 'error' ? 12000 : 4200
    if (ms > 0) {
      const arm = () => (timer = setTimeout(close, ms))
      arm()
      t.addEventListener('mouseenter', () => clearTimeout(timer))
      t.addEventListener('mouseleave', arm)
    }
  }

  /* ---------------------------------------------------------------- confirm / prompt */
  PK.confirm = (o = {}) =>
    new Promise((resolve) => {
      let done = false
      const f = PK.frame({ kind: 'dialog', size: 'sm', title: o.title || '请确认', en: o.en || 'CONFIRM', class: 'pk-confirm', onClose: () => !done && resolve(false) })
      PK.append(f.body, o.text instanceof Node ? o.text : h('p.pk-text', null, String(o.text || '')))
      const ok = ui.btn(o.ok || '确定', () => {
        done = true
        resolve(true)
        f.close('ok')
      }, { kind: o.danger ? 'danger' : 'primary' })
      f.setFoot([ui.spacer(), ui.btn(o.cancel || '取消', () => f.close('cancel'), { kind: 'ghost' }), ok])
      setTimeout(() => ok.focus(), 30)
    })
  PK.prompt = (o = {}) =>
    new Promise((resolve) => {
      let done = false
      let val = String(o.value ?? '')
      const f = PK.frame({ kind: 'dialog', size: o.multiline ? 'md' : 'sm', title: o.title || '请输入', en: o.en || 'INPUT', onClose: () => !done && resolve(null) })
      const submit = () => {
        if (o.required && !val.trim()) {
          PK.toast(`${o.label || '内容'}不能为空`, 'warn')
          return
        }
        done = true
        resolve(val)
        f.close('ok')
      }
      const ctl = o.multiline
        ? ui.textarea({ value: val, rows: o.rows || 5, placeholder: o.placeholder, maxLength: o.maxLength, onInput: (v) => (val = v), onSubmit: submit, expand: false })
        : ui.input({ value: val, placeholder: o.placeholder, type: o.type, maxLength: o.maxLength, onInput: (v) => (val = String(v)), onEnter: submit })
      PK.append(f.body, o.text ? h('p.pk-text', null, o.text) : null, ui.field({ label: o.label || '', hint: o.hint }, ctl))
      f.setFoot([ui.spacer(), ui.btn(o.cancel || '取消', () => f.close('cancel'), { kind: 'ghost' }), ui.btn(o.ok || '确定', submit, { kind: 'primary' })])
      setTimeout(() => (ctl.textarea || ctl).focus(), 40)
    })

  /* ---------------------------------------------------------------- the big text editor */
  /**
   * PK.editText({ title, en, value, placeholder, maxLength, hint, mono, templates: [{ label, text }],
   *               actions: [{ label, icon, kind, run: async (text, api) => newText|undefined }],
   *               okText, extraButtons: [{ label, kind, run: async (text) => true }] })
   * → Promise<string|null>  (null = cancelled). Ctrl+Enter saves. The editor always shows the full text.
   */
  PK.editText = (o = {}) =>
    new Promise((resolve) => {
      let done = false
      let text = String(o.value ?? '')
      const f = PK.frame({ kind: 'modal', size: o.size || 'lg', title: o.title || '编辑内容', en: o.en || 'EDITOR', class: 'pk-editor', onClose: () => !done && resolve(null) })
      const ta = h('textarea.pk-editor-ta', { placeholder: o.placeholder || '', spellcheck: 'false', maxlength: o.maxLength || null, 'aria-label': o.title || '编辑内容', class: { 'pk-textarea--mono': o.mono } })
      ta.value = text
      const count = h('span.pk-editor-count')
      const upd = () => {
        const n = U.countChars(ta.value)
        const lines = ta.value ? ta.value.split(/\n/).length : 0
        count.textContent = `${n}${o.maxLength ? ` / ${o.maxLength}` : ''} 字 · ${lines} 行`
        count.classList.toggle('is-over', Boolean(o.maxLength && n > o.maxLength))
      }
      ta.addEventListener('input', () => {
        text = ta.value
        upd()
      })
      const api = {
        get value() {
          return ta.value
        },
        set(v) {
          ta.value = String(v ?? '')
          text = ta.value
          upd()
        },
        insert(s) {
          const a = ta.selectionStart
          const b = ta.selectionEnd
          ta.setRangeText(String(s), a, b, 'end')
          text = ta.value
          upd()
          ta.focus()
        },
        frame: f,
      }
      const save = () => {
        if (o.maxLength && U.countChars(ta.value) > o.maxLength) {
          PK.toast(`内容超出 ${o.maxLength} 字上限，请精简后再保存`, 'warn')
          return
        }
        done = true
        resolve(ta.value)
        f.close('ok')
      }
      ta.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault()
          save()
        }
      })
      const tpl = o.templates && o.templates.length
        ? h(
            'div.pk-editor-tpl',
            null,
            h('span.pk-editor-tpl-l', null, '灵感模板'),
            o.templates.map((t) =>
              ui.btn(t.label, async () => {
                if (ta.value.trim() && ta.value.trim() !== t.text.trim()) {
                  const ok = await PK.confirm({ title: '替换当前内容？', text: `用模板「${t.label}」替换编辑框里的内容（可随时改回）。`, ok: '替换' })
                  if (!ok) return
                }
                api.set(t.text)
                ta.focus()
              }, { size: 'sm', kind: 'ghost', title: t.text }),
            ),
          )
        : null
      PK.append(
        f.body,
        o.hint ? h('p.pk-hint.pk-editor-hint', null, o.hint) : null,
        tpl,
        h('div.pk-editor-wrap', null, ta),
      )
      const actionBtns = (o.actions || []).map((a) =>
        ui.btn(a.label, async () => {
          const r = await a.run(ta.value, api)
          if (typeof r === 'string') api.set(r)
        }, { icon: a.icon, kind: a.kind || 'secondary', busyText: a.busyText || '处理中…' }),
      )
      const extra = (o.extraButtons || []).map((a) =>
        ui.btn(a.label, async () => {
          const r = await a.run(ta.value, api)
          if (r) {
            done = true
            resolve(ta.value)
            f.close('extra')
          }
        }, { icon: a.icon, kind: a.kind || 'secondary', busyText: a.busyText }),
      )
      f.setFoot([count, ...actionBtns, ui.spacer(), h('span.pk-editor-key', null, 'Ctrl + Enter 保存'), ui.btn('取消', () => f.close('cancel'), { kind: 'ghost' }), ...extra, ui.btn(o.okText || '保存', save, { kind: 'primary', icon: 'check' })])
      upd()
      setTimeout(() => {
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
      }, 60)
    })

  /* ---------------------------------------------------------------- popovers / menus / pickers */
  let popEl = null
  let popAnchor = null
  function closePop() {
    if (!popEl) return false
    const el = popEl
    popEl = null
    if (popAnchor) popAnchor.setAttribute('aria-expanded', 'false')
    popAnchor = null
    el.classList.remove('is-open')
    setTimeout(() => el.remove(), 140)
    document.removeEventListener('pointerdown', popOutside, true)
    return true
  }
  PK.closePop = closePop
  function popOutside(ev) {
    if (popEl && !popEl.contains(ev.target) && !(popAnchor && popAnchor.contains(ev.target))) closePop()
  }
  /** PK.popover(anchorEl, contentNode, { className, width, align: 'start'|'end' }) */
  PK.popover = (anchor, content, o = {}) => {
    const reopen = popAnchor === anchor
    closePop()
    if (reopen && !o.force) return null
    const el = h('div.pk-pop', { class: o.className, role: o.role || 'dialog' }, content)
    layers().querySelector('.pk-l-pop').appendChild(el)
    popEl = el
    popAnchor = anchor
    anchor.setAttribute('aria-expanded', 'true')
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const w = Math.min(vw - 16, Math.max(o.width || 0, r.width, o.minWidth || 200))
      el.style.width = `${w}px`
      el.style.maxHeight = ''
      const ph = el.offsetHeight
      let x = o.align === 'end' ? r.right - w : r.left
      x = U.clamp(x, 8, vw - w - 8)
      const below = vh - r.bottom - 10
      const above = r.top - 10
      let y
      if (ph <= below || below >= above) {
        y = r.bottom + 6
        el.style.maxHeight = `${Math.max(120, below - 4)}px`
      } else {
        const hh = Math.min(ph, above - 4)
        y = r.top - 6 - hh
        el.style.maxHeight = `${Math.max(120, above - 4)}px`
      }
      el.style.left = `${x}px`
      // the anchor may be scrolled partly/fully out of view: keep the whole popover inside the viewport
      const maxH = Math.max(120, Math.min(parseFloat(el.style.maxHeight) || vh, vh - 16))
      el.style.maxHeight = `${maxH}px`
      const hNow = Math.min(el.offsetHeight, maxH)
      el.style.top = `${U.clamp(y, 8, Math.max(8, vh - 8 - hNow))}px`
    }
    place()
    requestAnimationFrame(() => el.classList.add('is-open'))
    setTimeout(() => document.addEventListener('pointerdown', popOutside, true), 0)
    el.reposition = place
    return el
  }
  /** PK.menu(anchor, [{ label, icon, hint, onClick, danger, disabled, checked } | '-' | { group: '标题' }]) */
  PK.menu = (anchor, items, o = {}) => {
    const list = h('div.pk-menu', { role: 'menu' })
    for (const it of items || []) {
      if (!it) continue
      if (it === '-') {
        list.appendChild(h('div.pk-menu-sep', { role: 'separator' }))
        continue
      }
      if (it.group) {
        list.appendChild(h('div.pk-menu-g', null, it.group))
        continue
      }
      const b = h(
        'button.pk-menu-i',
        { type: 'button', role: 'menuitem', disabled: it.disabled, class: { 'is-danger': it.danger, 'is-on': it.checked } },
        h('span.pk-menu-ic', null, it.checked ? PK.icon('check', 14) : it.icon ? PK.icon(it.icon, 14) : null),
        h('span.pk-menu-l', null, it.label),
        it.hint ? h('em.pk-menu-h', null, it.hint) : null,
      )
      b.addEventListener('click', async () => {
        closePop()
        try {
          await it.onClick()
        } catch (err) {
          PK.reportError(err)
        }
      })
      list.appendChild(b)
    }
    return PK.popover(anchor, list, { className: `pk-pop--menu ${o.className || ''}`, minWidth: o.minWidth || 200, align: o.align, role: 'menu' })
  }
  /** searchable list picker used by ui.select */
  PK.pickFrom = (anchor, o = {}) => {
    const opts = o.options || []
    const box = h('div.pk-picker')
    const listEl = h('div.pk-picker-l', { role: 'listbox' })
    let q = ''
    let hi = Math.max(0, opts.findIndex((x) => String(x.value) === String(o.value)))
    let shown = opts
    const paint = () => {
      PK.clear(listEl)
      const ql = q.trim().toLowerCase()
      shown = ql ? opts.filter((x) => `${x.label} ${x.hint || ''} ${x.value}`.toLowerCase().includes(ql)) : opts
      if (!shown.length) listEl.appendChild(h('div.pk-picker-empty', null, '没有匹配的选项'))
      let lastGroup = null
      shown.forEach((x, i) => {
        if (x.group && x.group !== lastGroup) {
          lastGroup = x.group
          listEl.appendChild(h('div.pk-menu-g', null, x.group))
        }
        const on = String(x.value) === String(o.value)
        const b = h(
          'button.pk-picker-i',
          { type: 'button', role: 'option', 'aria-selected': on ? 'true' : 'false', disabled: x.disabled, class: { 'is-on': on, 'is-hi': i === hi } },
          h('span.pk-picker-ic', null, on ? PK.icon('check', 14) : null),
          x.swatch ? h('i.pk-chip-sw', { style: { background: x.swatch } }) : null,
          h('span.pk-picker-t', null, h('b', null, x.label), x.hint ? h('small', null, x.hint) : null),
        )
        b.addEventListener('click', () => {
          closePop()
          o.onPick && o.onPick(x.value)
        })
        listEl.appendChild(b)
      })
    }
    let search = null
    if (o.searchable) {
      search = h('input.pk-input.pk-picker-q', { type: 'search', placeholder: `搜索 ${opts.length} 个选项…`, 'aria-label': '搜索选项' })
      search.addEventListener('input', () => {
        q = search.value
        hi = 0
        paint()
      })
      search.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault()
          hi = U.clamp(hi + (ev.key === 'ArrowDown' ? 1 : -1), 0, Math.max(0, shown.length - 1))
          paint()
          const el = listEl.querySelector('.is-hi')
          if (el) el.scrollIntoView({ block: 'nearest' })
        } else if (ev.key === 'Enter') {
          ev.preventDefault()
          const x = shown[hi]
          if (x && !x.disabled) {
            closePop()
            o.onPick && o.onPick(x.value)
          }
        }
      })
      box.appendChild(search)
    }
    if (o.title) box.appendChild(h('div.pk-menu-g', null, o.title))
    box.appendChild(listEl)
    paint()
    const pop = PK.popover(anchor, box, { className: 'pk-pop--picker', minWidth: 240, width: o.width })
    if (pop) {
      setTimeout(() => {
        if (search) search.focus()
        const cur = listEl.querySelector('.is-on')
        if (cur) cur.scrollIntoView({ block: 'center' })
      }, 30)
    }
    return pop
  }
  window.addEventListener('resize', () => {
    if (popEl && popEl.reposition) popEl.reposition()
  })
})()
