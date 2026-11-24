/* ============================================================================================================
 * PK · UI primitives — a tiny DOM builder + semantic components (`pk-*` classes, styled per skin)
 * Every component returns a real DOM node. Skins restyle them in CSS; panels only compose them.
 * ============================================================================================================ */
;(function () {
  'use strict'
  const PK = window.PK
  const U = PK.util

  /* ---------------------------------------------------------------- DOM builder */
  /**
   * h('div.pk-row.cls', { attrs }, ...children)
   * attrs: class / className (string|array|object), style (object|string), dataset, on: { evt: fn }, onClick… (onXxx),
   *        key (→ data-pk-key, used to restore focus/caret across re-renders), html (trusted static markup only),
   *        any other attribute (aria-*, role, title, type, value, checked, disabled …; false/null = omitted)
   */
  function h(tag, attrs, ...children) {
    let t = String(tag || 'div')
    const classes = []
    let id = ''
    t = t.replace(/([.#])([\w-]+)/g, (_, sym, name) => {
      if (sym === '.') classes.push(name)
      else id = name
      return ''
    })
    const el = document.createElement(t || 'div')
    if (id) el.id = id
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
      children.unshift(attrs)
      attrs = null
    }
    if (classes.length) el.className = classes.join(' ')
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue
        if (k === 'class' || k === 'className') addClass(el, v)
        else if (k === 'style') {
          if (typeof v === 'string') el.style.cssText += v
          else
            for (const [sk, sv] of Object.entries(v)) {
              if (sv === undefined || sv === null || sv === false) continue
              if (sk.startsWith('--')) el.style.setProperty(sk, String(sv))
              else el.style[sk] = typeof sv === 'number' && !/^(opacity|zIndex|flex|order|fontWeight|lineHeight)$/.test(sk) ? `${sv}px` : sv
            }
        } else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = String(dv)
        else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn)
        else if (/^on[A-Z]/.test(k) && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
        else if (k === 'key') el.setAttribute('data-pk-key', String(v))
        else if (k === 'html') el.innerHTML = String(v)
        else if (k === 'value' && ('value' in el)) el.value = String(v)
        else if ((k === 'checked' || k === 'disabled' || k === 'readOnly' || k === 'multiple' || k === 'selected' || k === 'hidden') && k in el) el[k] = Boolean(v)
        else if (v === true) el.setAttribute(k, '')
        else el.setAttribute(k, String(v))
      }
    }
    append(el, children)
    return el
  }
  function addClass(el, v) {
    if (!v) return
    if (typeof v === 'string') v.split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c))
    else if (Array.isArray(v)) v.forEach((c) => addClass(el, c))
    else if (typeof v === 'object') for (const [c, on] of Object.entries(v)) if (on) el.classList.add(c)
  }
  function append(el, kids) {
    for (const c of kids) {
      if (c === null || c === undefined || c === false || c === true) continue
      if (Array.isArray(c)) append(el, c)
      else if (c instanceof Node) el.appendChild(c)
      else el.appendChild(document.createTextNode(String(c)))
    }
    return el
  }
  PK.h = h
  /** PK.append(el, ...nodesOrArrays) — null/false skipped, arrays flattened */
  PK.append = (el, ...kids) => append(el, kids)
  PK.clear = (el) => {
    while (el && el.firstChild) el.removeChild(el.firstChild)
    return el
  }
  PK.frag = (...kids) => append(document.createDocumentFragment(), kids)

  /* ---------------------------------------------------------------- icons (skins may replace via PK.configure({ icon })) */
  const ICONS = {
    x: 'M6 6l12 12M18 6L6 18',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3',
    download: 'M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3',
    play: 'M8 5.5v13l10.5-6.5z',
    pause: 'M8 5h3v14H8zM13 5h3v14h-3z',
    stop: 'M6.5 6.5h11v11h-11z',
    retry: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4',
    refresh: 'M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4',
    trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
    collapse: 'M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7',
    search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4',
    chev: 'M8 10l4 4 4-4',
    chevR: 'M10 8l4 4-4 4',
    chevL: 'M14 8l-4 4 4 4',
    arrowR: 'M5 12h14M13 6l6 6-6 6',
    film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
    image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01',
    music: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
    mic: 'M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v3',
    voice: 'M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2',
    cloud: 'M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z',
    cpu: 'M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
    key: 'M14 10a4 4 0 1 1-1.2-2.8L21 15v3h-3v-2h-2v-2h-2z',
    brand: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
    box: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4 4.5-6 8-6s7 2 8 6',
    wand: 'M4 20L15 9M14 4v3M18.5 5.5l-2 2M20 10h-3M12 6.5L14 4M9 4h.01M20 15h.01',
    sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
    lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
    history: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v4l3 2',
    layers: 'M12 4l9 5-9 5-9-5zM3 14l9 5 9-5',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    folder: 'M3 7h6l2 2h10v10H3z',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2.2.2-1.4-1.4L16.6 5l-3-1-1 2h-1.2l-1-2-3 1 .2 2.2L6.2 8.6 4 8.4l-1 3 2 1v1.2l-2 1 1 3 2.2-.2 1.4 1.4-.2 2.2 3 1 1-2h1.2l1 2 3-1-.2-2.2 1.4-1.4 2.2.2 1-3-2-1z',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
    warn: 'M12 4l9 16H3zM12 10v4M12 17h.01',
    help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01',
    cam: 'M4 7h11v10H4zM15 10l5-3v10l-5-3z',
    scissors: 'M6 7a2 2 0 1 0 0-.1M6 17a2 2 0 1 0 0 .1M8 8l12 9M8 16L20 7',
    wave: 'M2 12h3l2-6 3 12 3-9 2 6 2-3h5',
    star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
    save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
    filter: 'M4 5h16l-6 7v6l-4 2v-8z',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
    tasks: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
    hub: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM15.5 13.5l5 3-5 3z',
    split: 'M12 3v18M4 6h5v12H4zM15 6h5v12h-5z',
    prompt: 'M4 5h16v11H8l-4 4zM8 9h8M8 12h5',
    brush: 'M14 4l6 6-8 8H6v-6zM4 20h4',
    lut: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-.5-.3-.8-.3-1.3 0-.8.7-1.2 1.5-1.2H17a4 4 0 0 0 4-4c0-5-4-10-9-10zM7.5 12h.01M9.5 8h.01M14.5 8h.01',
    scope: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 3v3M12 18v3M3 12h3M18 12h3',
    code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14',
    dot: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    send: 'M4 12l16-8-6 16-2-6z',
    target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  }
  PK.ICONS = ICONS
  PK.icon = (name, size = 16) => {
    if (typeof PK.cfg.icon === 'function') {
      const custom = PK.cfg.icon(name, size)
      if (custom) return custom
    }
    const d = ICONS[name] || ICONS.dot
    const svgNS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(svgNS, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('width', String(size))
    svg.setAttribute('height', String(size))
    svg.setAttribute('fill', name === 'play' ? 'currentColor' : 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '1.7')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('class', `pk-ico pk-ico--${name}`)
    const path = document.createElementNS(svgNS, 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
    return svg
  }

  /* ---------------------------------------------------------------- components */
  const ui = (PK.ui = {})
  const asArr = (x) => (Array.isArray(x) ? x : x === undefined || x === null ? [] : [x])

  // ---- layout
  ui.section = (o = {}, ...children) =>
    h(
      'section.pk-sec',
      { class: [o.class, { 'pk-sec--flush': o.flush }], key: o.key },
      o.title || o.actions
        ? h(
            'header.pk-sec-h',
            null,
            h('h3.pk-sec-t', null, o.icon ? PK.icon(o.icon, 15) : null, h('span.pk-sec-tt', null, o.title || ''), o.en ? h('em.pk-en', null, o.en) : null, o.count !== undefined ? h('span.pk-sec-n', null, String(o.count)) : null),
            o.actions ? h('div.pk-sec-a', null, asArr(o.actions)) : null,
          )
        : null,
      o.desc ? h('p.pk-sec-d', null, o.desc) : null,
      h('div.pk-sec-b', null, children),
    )
  ui.row = (children, o = {}) =>
    h('div.pk-row', { class: [o.class, { 'pk-row--wrap': o.wrap !== false, 'pk-row--end': o.end, 'pk-row--between': o.between, 'pk-row--center': o.center, 'pk-row--top': o.top }], style: o.gap !== undefined ? { gap: o.gap } : null }, asArr(children))
  ui.stack = (children, o = {}) => h('div.pk-stack', { class: o.class, style: o.gap !== undefined ? { gap: o.gap } : null }, asArr(children))
  /** responsive auto-fill grid; o.min = min column width (px) */
  // o.fit: items stretch over the whole row instead of leaving empty column slots (forms; not for card walls)
  ui.grid = (children, o = {}) => h('div.pk-grid', { class: [o.class, o.cols ? `pk-grid--c${o.cols}` : '', { 'pk-grid--fit': o.fit }], style: { '--pk-min': `${o.min || 220}px` } }, asArr(children))
  /** two columns that stack when the panel is narrow; o.ratio e.g. '1.4fr 1fr' */
  ui.split = (left, right, o = {}) => h('div.pk-split', { class: o.class, style: o.ratio ? { '--pk-split': o.ratio } : null }, h('div.pk-split-a', null, asArr(left)), h('div.pk-split-b', null, asArr(right)))
  ui.spacer = () => h('span.pk-spacer')
  ui.divider = (label) => h('div.pk-divider', { role: 'separator' }, label ? h('span', null, label) : null)

  // ---- text / status
  ui.text = (s, o = {}) => h('p.pk-text', { class: [o.class, o.tone ? `pk-text--${o.tone}` : '', { 'pk-text--mono': o.mono }] }, s)
  ui.hint = (s, o = {}) => h('p.pk-hint', { class: o.class }, s)
  ui.mono = (s) => h('span.pk-mono', null, s)
  ui.strong = (s) => h('b.pk-strong', null, s)
  /** level: info | ok | warn | error */
  ui.note = (text, o = {}) =>
    h(
      'div.pk-note',
      { class: `pk-note--${o.level || 'info'}`, role: o.level === 'error' ? 'alert' : 'note' },
      h('span.pk-note-i', null, PK.icon(o.level === 'error' || o.level === 'warn' ? 'warn' : o.level === 'ok' ? 'check' : 'info', 15)),
      h('div.pk-note-b', null, o.title ? h('b.pk-note-t', null, o.title) : null, text ? h('div.pk-note-x', null, text) : null, o.actions ? ui.row(o.actions, { class: 'pk-note-a' }) : null),
    )
  /** pairs: [[label, value], …] or { label: value } */
  ui.kv = (pairs, o = {}) => {
    const list = Array.isArray(pairs) ? pairs : Object.entries(pairs || {})
    return h(
      'dl.pk-kv',
      { class: o.class },
      list.filter(Boolean).map(([k, v]) => h('div.pk-kv-r', null, h('dt', null, k), h('dd', { title: typeof v === 'string' ? v : null }, v === undefined || v === null || v === '' ? '—' : v))),
    )
  }
  /** tone: ok | warn | err | acc | mute | info */
  ui.pill = (text, tone = 'mute', o = {}) => h('span.pk-pill', { class: [`pk-pill--${tone}`, o.class], title: o.title || null }, o.dot ? h('i.pk-pill-dot') : null, text)
  ui.tag = (text, o = {}) => h('span.pk-tag', { class: [o.active ? 'is-on' : '', o.class] }, text)
  ui.stat = (value, label, o = {}) => h('div.pk-stat', { class: o.tone ? `pk-stat--${o.tone}` : '' }, h('b.pk-stat-v', null, value), h('span.pk-stat-l', null, label))
  ui.empty = (o = {}) =>
    h('div.pk-empty', { class: o.class }, o.icon ? h('span.pk-empty-i', null, PK.icon(o.icon, 28)) : null, o.title ? h('b.pk-empty-t', null, o.title) : null, o.text ? h('p.pk-empty-x', null, o.text) : null, o.actions ? ui.row(o.actions, { center: true }) : null)
  ui.spinner = (label) => h('span.pk-spin', { role: 'status', 'aria-label': label || '加载中' }, h('i'), label ? h('span', null, label) : null)
  ui.loading = (label = '正在读取…') => h('div.pk-loading', null, ui.spinner(), h('span', null, label))
  ui.errorBox = (err, retry) =>
    ui.note(String((err && err.message) || err || '加载失败'), { level: 'error', title: '加载失败', actions: retry ? [ui.btn('重试', retry, { icon: 'retry', size: 'sm' })] : null })

  // ---- buttons
  /**
   * ui.btn(label, onClick, { kind: 'primary'|'secondary'|'ghost'|'danger'|'link', size: 'sm'|'md'|'lg', icon, title,
   *        disabled, busyText, block, confirm: '确认文案' })
   * Async handlers: the button shows a busy state and toasts thrown errors.
   */
  ui.btn = (label, onClick, o = {}) => {
    const b = h(
      'button.pk-btn',
      {
        type: 'button',
        class: [`pk-btn--${o.kind || 'secondary'}`, `pk-btn--${o.size || 'md'}`, { 'pk-btn--block': o.block, 'pk-btn--icon': !label && o.icon }, o.class],
        title: o.title || (typeof label === 'string' && !label ? '' : null),
        'aria-label': o.aria || (!label && o.title ? o.title : null),
        disabled: o.disabled,
        key: o.key,
      },
      o.icon ? PK.icon(o.icon, o.size === 'sm' ? 13 : 15) : null,
      label ? h('span.pk-btn-l', null, label) : null,
    )
    if (onClick) {
      b.addEventListener('click', async (ev) => {
        if (b.disabled || b.getAttribute('aria-busy') === 'true') return
        if (o.confirm) {
          const ok = await PK.confirm(typeof o.confirm === 'object' ? o.confirm : { title: '请确认', text: String(o.confirm), danger: o.kind === 'danger' })
          if (!ok) return
        }
        let res
        try {
          res = onClick(ev, b)
        } catch (err) {
          PK.reportError(err)
          return
        }
        if (res && typeof res.then === 'function') {
          const lbl = b.querySelector('.pk-btn-l')
          const old = lbl ? lbl.textContent : ''
          b.setAttribute('aria-busy', 'true')
          b.disabled = true
          if (lbl && o.busyText) lbl.textContent = o.busyText
          try {
            await res
          } catch (err) {
            PK.reportError(err)
          } finally {
            b.removeAttribute('aria-busy')
            b.disabled = Boolean(o.disabled)
            if (lbl && o.busyText) lbl.textContent = old
          }
        }
      })
    }
    return b
  }
  ui.iconBtn = (icon, onClick, o = {}) => ui.btn('', onClick, { ...o, icon, kind: o.kind || 'ghost', size: o.size || 'sm', title: o.title, aria: o.title })
  ui.link = (label, href, o = {}) => h('a.pk-a', { href, target: o.target || '_blank', rel: 'noopener noreferrer' }, label)

  // ---- form controls
  /** ui.field({ label, en, hint, error, wide, required, inline }, control) */
  ui.field = (o, control) =>
    h(
      'div.pk-field',
      { class: [o.class, { 'pk-field--wide': o.wide, 'pk-field--inline': o.inline, 'pk-field--err': o.error }] },
      o.label ? h('div.pk-field-l', null, h('span', null, o.label), o.required ? h('i.pk-req', { title: '必填' }, '*') : null, o.en ? h('em.pk-en', null, o.en) : null, o.aside ? h('span.pk-field-aside', null, o.aside) : null) : null,
      h('div.pk-field-c', null, control),
      o.error ? h('p.pk-field-e', { role: 'alert' }, o.error) : o.hint ? h('p.pk-field-h', null, o.hint) : null,
    )
  ui.input = (o = {}) => {
    const el = h('input.pk-input', {
      type: o.type || 'text',
      value: o.value ?? '',
      placeholder: o.placeholder || null,
      key: o.key,
      min: o.min,
      max: o.max,
      step: o.step,
      maxlength: o.maxLength,
      readonly: o.readOnly ? 'readonly' : null,
      disabled: o.disabled,
      autocomplete: o.autocomplete || 'off',
      spellcheck: 'false',
      'aria-label': o.aria || o.placeholder || null,
      class: [o.class, { 'pk-input--mono': o.mono }],
    })
    if (o.title !== false) el.title = String(o.value ?? '')
    el.addEventListener('input', () => {
      el.title = el.value
      o.onInput && o.onInput(o.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value, el)
    })
    el.addEventListener('change', () => o.onChange && o.onChange(o.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value, el))
    if (o.onEnter) el.addEventListener('keydown', (ev) => ev.key === 'Enter' && !ev.isComposing && o.onEnter(el.value, el))
    return el
  }
  /** auto-growing textarea that always shows its full content (up to maxRows, then scrolls) + optional ⤢ big editor */
  ui.textarea = (o = {}) => {
    const ta = h('textarea.pk-textarea', {
      placeholder: o.placeholder || null,
      key: o.key,
      rows: o.rows || 3,
      maxlength: o.maxLength,
      readonly: o.readOnly ? 'readonly' : null,
      disabled: o.disabled,
      spellcheck: 'false',
      'aria-label': o.aria || o.placeholder || null,
      class: { 'pk-textarea--mono': o.mono },
    })
    ta.value = String(o.value ?? '')
    const counter = o.maxLength || o.counter ? h('span.pk-ta-count') : null
    const grow = () => {
      if (o.autoGrow === false) return
      const cs = getComputedStyle(ta)
      const lh = parseFloat(cs.lineHeight) || 20
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
      const minH = lh * (o.minRows || o.rows || 3) + pad
      const maxH = lh * (o.maxRows || 14) + pad
      ta.style.height = 'auto'
      ta.style.height = `${U.clamp(ta.scrollHeight + (cs.boxSizing === 'border-box' ? parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) : 0), minH, maxH)}px`
      ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden'
    }
    const count = () => {
      if (!counter) return
      const n = U.countChars(ta.value)
      counter.textContent = o.maxLength ? `${n} / ${o.maxLength}` : `${n} 字`
      counter.classList.toggle('is-over', Boolean(o.maxLength && n > o.maxLength))
    }
    ta.addEventListener('input', () => {
      grow()
      count()
      o.onInput && o.onInput(ta.value, ta)
    })
    ta.addEventListener('change', () => o.onChange && o.onChange(ta.value, ta))
    if (o.onSubmit) ta.addEventListener('keydown', (ev) => ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && o.onSubmit(ta.value, ta))
    // ⤢ sits in the box's reserved top-right gutter; the counter goes BELOW the box (in flow) — inside the gutter it was
    // wider than the reserved space and covered the end of the 2nd text line
    const wrap = h(
      'div.pk-ta',
      { class: [o.class, { 'pk-ta--noexpand': o.expand === false }] },
      ta,
      o.expand !== false
        ? h(
            'div.pk-ta-tools',
            null,
            o.expand !== false
              ? ui.iconBtn(
                  'expand',
                  async () => {
                    const v = await PK.editText({
                      title: (o.expand && o.expand.title) || o.label || o.aria || o.placeholder || '编辑内容',
                      en: o.expand && o.expand.en,
                      value: ta.value,
                      placeholder: o.placeholder,
                      maxLength: o.maxLength,
                      mono: o.mono,
                      hint: o.expand && o.expand.hint,
                      templates: o.expand && o.expand.templates,
                      actions: o.expand && o.expand.actions,
                    })
                    if (v === null || v === undefined) return
                    ta.value = v
                    grow()
                    count()
                    o.onInput && o.onInput(v, ta)
                    o.onChange && o.onChange(v, ta)
                  },
                  { title: '放大编辑（完整显示全部内容）', class: 'pk-ta-expand' },
                )
              : null,
          )
        : null,
      counter,
    )
    wrap.textarea = ta
    wrap.setValue = (v) => {
      ta.value = String(v ?? '')
      grow()
      count()
    }
    // size after insertion (layout needed), and whenever the panel re-lays out
    requestAnimationFrame(() => {
      grow()
      count()
    })
    if (typeof ResizeObserver === 'function') {
      let lastW = 0
      new ResizeObserver((ents) => {
        const w = Math.round(ents[0].contentRect.width)
        if (w !== lastW) {
          lastW = w
          grow()
        }
      }).observe(ta)
    }
    return wrap
  }
  /**
   * Custom dropdown (never a native <select>, so every skin can style it).
   * options: [{ value, label, hint, group, disabled }] ; searchable defaults to true for > 10 options.
   */
  ui.select = (o = {}) => {
    const opts = (o.options || []).map((x) => (typeof x === 'object' ? x : { value: x, label: String(x) }))
    const cur = () => opts.find((x) => String(x.value) === String(o.value))
    const label = h('span.pk-select-l')
    const sub = h('span.pk-select-s')
    const btn = h(
      'button.pk-select',
      { type: 'button', key: o.key, 'aria-haspopup': 'listbox', 'aria-expanded': 'false', disabled: o.disabled, class: o.class, 'aria-label': o.aria || null },
      h('span.pk-select-v', null, label, sub),
      PK.icon('chev', 14),
    )
    const paint = () => {
      const c = cur()
      label.textContent = c ? c.label : o.placeholder || '请选择'
      sub.textContent = c && c.hint && o.showHint ? c.hint : ''
      btn.title = c ? `${c.label}${c.hint ? ` · ${c.hint}` : ''}` : ''
      btn.classList.toggle('is-empty', !c)
    }
    paint()
    btn.addEventListener('click', () => {
      if (btn.disabled) return
      const searchable = o.searchable !== undefined ? o.searchable : opts.length > 10
      PK.pickFrom(btn, {
        options: opts,
        value: o.value,
        searchable,
        title: o.menuTitle,
        onPick: (v) => {
          o.value = v
          paint()
          o.onChange && o.onChange(v)
        },
      })
    })
    btn.setValue = (v) => {
      o.value = v
      paint()
    }
    return btn
  }
  /** segmented control */
  ui.seg = (o = {}) => {
    const wrap = h('div.pk-seg', { role: 'radiogroup', class: o.class, 'aria-label': o.aria || null })
    const opts = (o.options || []).map((x) => (typeof x === 'object' ? x : { value: x, label: String(x) }))
    const paint = () => {
      PK.clear(wrap)
      for (const op of opts) {
        const on = String(op.value) === String(o.value)
        const b = h(
          'button.pk-seg-b',
          { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', class: { 'is-on': on }, title: op.hint || op.label, disabled: o.disabled || op.disabled },
          op.icon ? PK.icon(op.icon, 13) : null,
          h('span', null, op.label),
        )
        b.addEventListener('click', () => {
          if (String(o.value) === String(op.value)) return
          o.value = op.value
          paint()
          o.onChange && o.onChange(op.value)
        })
        wrap.appendChild(b)
      }
    }
    paint()
    wrap.setValue = (v) => {
      o.value = v
      paint()
    }
    return wrap
  }
  /** switch */
  ui.toggle = (o = {}) => {
    const sw = h('button.pk-toggle', { type: 'button', role: 'switch', 'aria-checked': o.value ? 'true' : 'false', disabled: o.disabled, title: o.title || null, 'aria-label': o.label || o.aria || null }, h('i.pk-toggle-k'))
    sw.addEventListener('click', () => {
      o.value = !o.value
      sw.setAttribute('aria-checked', o.value ? 'true' : 'false')
      o.onChange && o.onChange(o.value)
    })
    if (!o.label) return sw
    return h('label.pk-toggle-row', null, sw, h('span.pk-toggle-t', null, h('b', null, o.label), o.hint ? h('small', null, o.hint) : null))
  }
  ui.check = (o = {}) => {
    const box = h('input.pk-check', { type: 'checkbox', checked: Boolean(o.value), disabled: o.disabled })
    box.addEventListener('change', () => o.onChange && o.onChange(box.checked))
    return h('label.pk-check-row', { class: o.class }, box, h('span', null, o.label || ''), o.hint ? h('small', null, o.hint) : null)
  }
  /** range slider with live value */
  ui.slider = (o = {}) => {
    const fmt = o.format || ((v) => String(v))
    const out = h('output.pk-slider-v', null, fmt(o.value))
    const r = h('input.pk-range', { type: 'range', min: o.min ?? 0, max: o.max ?? 100, step: o.step ?? 1, value: o.value ?? 0, disabled: o.disabled, 'aria-label': o.aria || null })
    const fill = () => {
      const p = ((Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min) || 1)) * 100
      r.style.setProperty('--pk-fill', `${U.clamp(p, 0, 100)}%`)
    }
    fill()
    r.addEventListener('input', () => {
      out.textContent = fmt(Number(r.value))
      fill()
      o.onInput && o.onInput(Number(r.value))
    })
    r.addEventListener('change', () => o.onChange && o.onChange(Number(r.value)))
    return h('div.pk-slider', { class: o.class }, r, out)
  }
  /** multi / single choice chips */
  ui.chips = (o = {}) => {
    const wrap = h('div.pk-chips', { class: o.class, role: o.multi ? 'group' : 'radiogroup' })
    const opts = (o.options || []).map((x) => (typeof x === 'object' ? x : { value: x, label: String(x) }))
    const val = () => (o.multi ? new Set(asArr(o.value).map(String)) : new Set([String(o.value)]))
    const paint = () => {
      PK.clear(wrap)
      const v = val()
      for (const op of opts) {
        const on = v.has(String(op.value))
        const b = h('button.pk-chip', { type: 'button', class: { 'is-on': on }, 'aria-pressed': on ? 'true' : 'false', title: op.hint || op.label, disabled: o.disabled }, op.swatch ? h('i.pk-chip-sw', { style: { background: op.swatch } }) : null, op.label)
        b.addEventListener('click', () => {
          if (o.multi) {
            const s = val()
            if (s.has(String(op.value))) s.delete(String(op.value))
            else s.add(String(op.value))
            o.value = opts.filter((x) => s.has(String(x.value))).map((x) => x.value)
          } else o.value = op.value
          paint()
          o.onChange && o.onChange(o.value)
        })
        wrap.appendChild(b)
      }
    }
    paint()
    return wrap
  }
  ui.color = (o = {}) => {
    const c = h('input.pk-color', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(o.value || '') ? o.value : '#000000', disabled: o.disabled })
    const t = ui.input({ value: o.value || '', placeholder: '#RRGGBB', mono: true, onChange: (v) => {
      if (/^#[0-9a-f]{6}$/i.test(v)) {
        c.value = v
        o.onChange && o.onChange(v)
      }
    } })
    c.addEventListener('input', () => {
      t.value = c.value
      o.onChange && o.onChange(c.value)
    })
    return h('div.pk-colorpick', null, c, t)
  }
  /** opens the OS file picker */
  PK.pickFiles = (o = {}) =>
    new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept: o.accept || null, multiple: Boolean(o.multiple), style: 'position:fixed;left:-9999px;top:0' })
      if (o.directory) inp.setAttribute('webkitdirectory', '')
      let done = false
      inp.addEventListener('change', () => {
        done = true
        resolve(Array.from(inp.files || []))
        inp.remove()
      })
      window.addEventListener(
        'focus',
        () =>
          setTimeout(() => {
            if (!done) {
              resolve([])
              inp.remove()
            }
          }, 600),
        { once: true },
      )
      document.body.appendChild(inp)
      inp.click()
    })
  ui.file = (label, onFiles, o = {}) => ui.btn(label, async () => {
    const files = await PK.pickFiles(o)
    if (files.length) await onFiles(files)
  }, { icon: o.icon || 'upload', kind: o.kind, size: o.size, busyText: o.busyText || '上传中…', disabled: o.disabled })
  /** drag & drop zone (+ click to pick) */
  ui.drop = (o = {}) => {
    const z = h(
      'div.pk-drop',
      { role: 'button', tabindex: '0', class: o.class, 'aria-label': o.label || '拖入文件或点击选择' },
      h('span.pk-drop-i', null, PK.icon(o.icon || 'upload', 22)),
      h('b.pk-drop-t', null, o.label || '拖入文件，或点击选择'),
      o.hint ? h('span.pk-drop-h', null, o.hint) : null,
    )
    let busy = false
    const take = async (files) => {
      files = Array.from(files || [])
      if (o.filter) files = files.filter(o.filter)
      if (!files.length || busy) return
      busy = true
      z.classList.add('is-busy')
      try {
        await o.onFiles(files)
      } catch (err) {
        PK.reportError(err)
      } finally {
        busy = false
        z.classList.remove('is-busy')
      }
    }
    z.addEventListener('click', async () => take(await PK.pickFiles(o)))
    z.addEventListener('keydown', async (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        take(await PK.pickFiles(o))
      }
    })
    z.addEventListener('dragover', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      z.classList.add('is-over')
    })
    z.addEventListener('dragleave', () => z.classList.remove('is-over'))
    z.addEventListener('drop', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      z.classList.remove('is-over')
      take(ev.dataTransfer && ev.dataTransfer.files)
    })
    return z
  }

  // ---- lists, cards, tables
  ui.list = (items, o = {}) => h('div.pk-list', { class: [o.class, { 'pk-list--dense': o.dense }], role: 'list' }, asArr(items))
  /** ui.item({ lead, icon, thumb, title, sub, meta, right, onClick, active, tone, key }) */
  ui.item = (o = {}) => {
    const el = h(
      'div.pk-item',
      {
        role: o.onClick ? 'button' : 'listitem',
        tabindex: o.onClick ? '0' : null,
        class: [o.class, { 'is-active': o.active, 'is-click': o.onClick }, o.tone ? `pk-item--${o.tone}` : ''],
        key: o.key,
        title: o.tip || null,
      },
      o.lead !== undefined && o.lead !== null ? h('span.pk-item-lead', null, o.lead) : null,
      o.icon ? h('span.pk-item-ico', null, PK.icon(o.icon, 16)) : null,
      o.thumb ? h('span.pk-item-thumb', null, o.thumb) : null,
      h(
        'div.pk-item-main',
        null,
        h('div.pk-item-t', { title: typeof o.title === 'string' ? o.title : null }, o.title || ''),
        o.sub ? h('div.pk-item-s', { title: typeof o.sub === 'string' ? o.sub : null }, o.sub) : null,
        o.body || null,
      ),
      o.meta ? h('div.pk-item-meta', null, o.meta) : null,
      o.right ? h('div.pk-item-r', null, asArr(o.right)) : null,
    )
    if (o.onClick) {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('button, a, input, textarea, .pk-select') && ev.target.closest('.pk-item-r, .pk-item-main button')) return
        o.onClick(ev)
      })
      el.addEventListener('keydown', (ev) => {
        if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === el) {
          ev.preventDefault()
          o.onClick(ev)
        }
      })
    }
    return el
  }
  /** ui.card({ media, title, sub, body, tags, actions, onClick, active, badge, key }) */
  ui.card = (o = {}) => {
    const el = h(
      'article.pk-card',
      { class: [o.class, { 'is-active': o.active, 'is-click': o.onClick }], tabindex: o.onClick ? '0' : null, role: o.onClick ? 'button' : null, key: o.key },
      o.media ? h('div.pk-card-m', { style: o.aspect ? { aspectRatio: o.aspect } : null }, o.media, o.badge ? h('span.pk-card-badge', null, o.badge) : null) : null,
      h(
        'div.pk-card-b',
        null,
        o.title ? h('h4.pk-card-t', { title: typeof o.title === 'string' ? o.title : null }, o.title) : null,
        o.sub ? h('p.pk-card-s', null, o.sub) : null,
        o.body || null,
        o.tags && o.tags.length ? h('div.pk-card-tags', null, o.tags.map((t) => (t instanceof Node ? t : ui.tag(t)))) : null,
      ),
      o.actions ? h('div.pk-card-a', null, asArr(o.actions)) : null,
    )
    if (o.onClick) {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('.pk-card-a, button, a, input, video')) return
        o.onClick(ev)
      })
      el.addEventListener('keydown', (ev) => {
        if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === el) {
          ev.preventDefault()
          o.onClick(ev)
        }
      })
    }
    return el
  }
  /** ui.table({ columns: [{ key, label, width, align, render(row) }], rows, empty, onRow }) */
  ui.table = (o = {}) => {
    const cols = o.columns || []
    const rows = o.rows || []
    return h(
      'div.pk-table-wrap',
      { class: o.class },
      h(
        'table.pk-table',
        null,
        h('thead', null, h('tr', null, cols.map((c) => h('th', { style: { width: c.width || null, textAlign: c.align || null } }, c.label || '')))),
        h(
          'tbody',
          null,
          rows.length
            ? rows.map((r, i) => {
                const tr = h(
                  'tr',
                  { class: { 'is-click': o.onRow, 'is-active': o.isActive && o.isActive(r) } },
                  cols.map((c) => {
                    const v = c.render ? c.render(r, i) : r[c.key]
                    return h('td', { style: { textAlign: c.align || null }, title: typeof v === 'string' ? v : null }, v === undefined || v === null || v === '' ? '—' : v)
                  }),
                )
                if (o.onRow) tr.addEventListener('click', (ev) => !ev.target.closest('button,a,input') && o.onRow(r, i))
                return tr
              })
            : h('tr', null, h('td.pk-table-empty', { colspan: String(Math.max(1, cols.length)) }, o.empty || '暂无数据')),
        ),
      ),
    )
  }

  // ---- progress / navigation
  ui.meter = (pct, o = {}) => {
    const p = U.clamp(U.num(pct), 0, 100)
    return h(
      'div.pk-meter',
      { class: [o.tone ? `pk-meter--${o.tone}` : '', { 'is-ind': o.indeterminate }], role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(p)) },
      o.label ? h('div.pk-meter-l', null, h('span', null, o.label), h('b', null, o.valueText || `${Math.round(p)}%`)) : null,
      h('div.pk-meter-t', null, h('i', { style: { width: `${p}%` } })),
    )
  }
  /** steps: [{ label, sub, state: 'done'|'active'|'todo'|'error', value }] */
  ui.steps = (steps, o = {}) =>
    h(
      'ol.pk-steps',
      { class: o.class },
      asArr(steps).map((s, i) => {
        const li = h(
          'li.pk-step',
          { class: [`is-${s.state || 'todo'}`, { 'is-click': o.onClick }], tabindex: o.onClick ? '0' : null, role: o.onClick ? 'button' : null, 'aria-current': s.state === 'active' ? 'step' : null },
          h('span.pk-step-n', null, s.state === 'done' ? PK.icon('check', 13) : s.n || String(i + 1)),
          h('span.pk-step-b', null, h('b', null, s.label), s.sub ? h('small', null, s.sub) : null),
        )
        if (o.onClick) {
          li.addEventListener('click', () => o.onClick(s.value !== undefined ? s.value : i))
          li.addEventListener('keydown', (ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), o.onClick(s.value !== undefined ? s.value : i)))
        }
        return li
      }),
    )
  /** tabs: { value, items: [{ value, label, icon, badge }], onChange } */
  ui.tabs = (o = {}) => {
    const wrap = h('div.pk-tabs', { role: 'tablist', class: o.class })
    for (const it of o.items || []) {
      const on = String(it.value) === String(o.value)
      const b = h('button.pk-tab', { type: 'button', role: 'tab', 'aria-selected': on ? 'true' : 'false', class: { 'is-on': on }, title: it.hint || null }, it.icon ? PK.icon(it.icon, 14) : null, h('span', null, it.label), it.badge !== undefined && it.badge !== null && it.badge !== '' ? h('i.pk-tab-badge', null, String(it.badge)) : null)
      b.addEventListener('click', () => {
        if (on) return
        o.onChange && o.onChange(it.value)
      })
      wrap.appendChild(b)
    }
    return wrap
  }
  ui.log = (lines, o = {}) =>
    h(
      'div.pk-log',
      { class: o.class, role: 'log' },
      asArr(lines).map((l) => h('div.pk-log-l', { class: `is-${l.level || 'info'}` }, l.ts ? h('time', null, U.fmtTime(l.ts).replace('今天 ', '')) : null, l.tag ? h('em', null, l.tag) : null, h('span', null, l.text || ''))),
    )
  ui.code = (text, o = {}) => h('pre.pk-code', { class: o.class }, h('code', null, String(text ?? '')))

  // ---- media
  ui.video = (src, o = {}) => {
    const v = h('video.pk-video', { src: src || null, poster: o.poster || null, controls: o.controls === false ? null : 'controls', preload: o.preload || 'metadata', playsinline: '', loop: o.loop ? '' : null, muted: o.muted ? '' : null })
    if (o.muted) v.muted = true
    if (o.autoplay) v.autoplay = true
    return h('div.pk-media', { class: o.class, style: o.aspect ? { aspectRatio: o.aspect } : null }, src ? v : h('div.pk-media-empty', null, PK.icon('film', 26), h('span', null, o.empty || '暂无画面')))
  }
  ui.image = (src, o = {}) =>
    h('div.pk-media', { class: [o.class, 'pk-media--img'], style: o.aspect ? { aspectRatio: o.aspect } : null }, src ? h('img.pk-img', { src, alt: o.alt || '', loading: 'lazy', draggable: 'false', style: o.fit ? { objectFit: o.fit } : null }) : h('div.pk-media-empty', null, PK.icon('image', 24)))
  // one shared <audio> for every preview button, so only one sound plays at a time
  let sharedAudio = null
  let sharedOwner = null
  let sharedKey = ''
  PK.audio = {
    el() {
      if (!sharedAudio) {
        sharedAudio = new Audio()
        sharedAudio.preload = 'auto'
        sharedAudio.addEventListener('ended', () => PK.audio._notify(false))
        sharedAudio.addEventListener('pause', () => PK.audio._notify(false))
        sharedAudio.addEventListener('play', () => PK.audio._notify(true))
        sharedAudio.addEventListener('error', () => {
          if (sharedOwner) PK.toast('音频无法播放（文件不存在或格式不支持）', 'error')
          PK.audio._notify(false)
        })
      }
      return sharedAudio
    },
    _notify(playing) {
      if (sharedOwner && sharedOwner.onState) sharedOwner.onState(playing)
    },
    async play(src, owner, key) {
      const a = PK.audio.el()
      if (sharedOwner && sharedOwner !== owner && sharedOwner.onState) sharedOwner.onState(false)
      sharedOwner = owner || null
      sharedKey = String(key || src || '')
      if (a.src !== new URL(src, location.href).href) a.src = src
      a.currentTime = 0
      await a.play()
    },
    stop() {
      if (sharedAudio) sharedAudio.pause()
    },
    isOwner: (owner) => sharedOwner === owner && sharedAudio && !sharedAudio.paused,
    /** a re-rendered play button takes over the clip that is still playing under its key → true when it did */
    adopt(owner, key) {
      if (!key || !sharedAudio || sharedAudio.paused || sharedKey !== String(key)) return false
      sharedOwner = owner
      return true
    },
  }
  /** play/stop toggle; src may be a string or an async function returning the URL (e.g. synthesise first) */
  // o.key identifies the clip across re-renders (defaults to src when it is a URL string): a button rendered while its
  // clip is playing shows 「停止」 and stops it.
  ui.playBtn = (src, o = {}) => {
    const owner = {}
    const key = o.key || (typeof src === 'string' ? src : '')
    const b = ui.btn(o.label === undefined ? '试听' : o.label, async () => {
      try {
        if (PK.audio.isOwner(owner)) {
          PK.audio.stop()
          return
        }
        const url = typeof src === 'function' ? await src() : src
        if (!url) throw new Error('没有可播放的音频')
        await PK.audio.play(url, owner, key || url)
      } finally {
        // ui.btn restores the pre-click label once this promise settles → re-apply the real state after that
        setTimeout(() => owner.onState(PK.audio.isOwner(owner)), 0)
      }
    }, { icon: 'play', size: o.size || 'sm', kind: o.kind || 'secondary', busyText: o.busyText || '准备中…', title: o.title })
    owner.onState = (playing) => {
      const l = b.querySelector('.pk-btn-l')
      const ic = b.querySelector('svg')
      if (ic) ic.replaceWith(PK.icon(playing ? 'stop' : 'play', o.size === 'md' ? 15 : 13))
      if (l && o.label !== '') l.textContent = playing ? o.stopLabel || '停止' : o.label === undefined ? '试听' : o.label
      b.classList.toggle('is-playing', playing)
    }
    if (PK.audio.adopt(owner, key)) owner.onState(true)
    return b
  }
  ui.audio = (src, o = {}) => (src ? h('audio.pk-audio', { src, controls: 'controls', preload: 'metadata', class: o.class }) : ui.hint(o.empty || '暂无音频'))
})()
