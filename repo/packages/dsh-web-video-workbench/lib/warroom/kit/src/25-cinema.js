/* ============================================================================================================
 * PK · 全屏观影 (cinema) — watch the finished film full-window, above the whole war room, in every skin.
 *
 *   PK.cinema({ src, poster, title, sub, startAt, onClose })  →  { el, video, close() } | null
 *
 *   · fills the skin's window (black, letterboxed with object-fit: contain) with native video controls, so no HUD,
 *     side deck or camera mode can cover the picture
 *   · 「全屏」 / F: real browser fullscreen of the viewer (the skin iframe is allowed to); Esc leaves fullscreen first,
 *     a second Esc (or 「退出」) closes the viewer. The native video controls keep their own fullscreen button.
 *   · it is appended after the open panels, so it covers them; popovers and toasts (later in #pk-root) stay on top
 *   · Space / K play · pause, ← → 5 s, M mute; the title bar and cursor hide after 2.5 s without pointer movement
 *     while the film plays
 *   · it sits on the kit frame stack, so the skins' global shortcuts (R / 1-3 / P …) stay off while it is open
 *     (PK.isOpenAny()); it does not emit frame-open / frame-close (skins decorate real panel frames on those)
 *   · onClose({ time, playing, duration }) lets the skin continue its own monitor at the same moment
 * ============================================================================================================ */
;(function () {
  'use strict'
  const PK = window.PK
  if (!PK || typeof PK.h !== 'function' || !PK.frames || typeof PK.root !== 'function') return
  const h = PK.h
  const stack = PK.frames.stack

  const CSS = `
.pk-cine{position:absolute;inset:0;pointer-events:auto;background:#000;color:#f4f6fb;overflow:hidden;opacity:0;transition:opacity .22s ease;outline:none;font-family:var(--pk-font)}
.pk-cine.is-open{opacity:1}
.pk-cine-v{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:block;outline:none}
.pk-cine-bar{position:absolute;left:0;right:0;top:0;z-index:2;display:flex;align-items:center;gap:12px;padding:14px 18px 30px;background:linear-gradient(180deg,rgba(0,0,0,.8),rgba(0,0,0,.45) 62%,rgba(0,0,0,0));transition:opacity .25s ease}
.pk-cine-k{flex:none;font:600 12px/1 var(--pk-font-mono);letter-spacing:.14em;color:var(--pk-acc);padding:6px 8px;border:1px solid currentColor;border-radius:4px;white-space:nowrap}
.pk-cine-tt{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px}
.pk-cine-title{font:700 16px/1.35 var(--pk-font);color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pk-cine-sub{font:12px/1.4 var(--pk-font-mono);color:rgba(255,255,255,.74);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pk-cine-btn{flex:none;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.3);background:rgba(10,12,18,.58);color:#fff;font:600 13px/1 var(--pk-font);white-space:nowrap;cursor:pointer;transition:border-color .15s ease,color .15s ease}
.pk-cine-btn:hover,.pk-cine-btn:focus-visible{border-color:var(--pk-acc);color:var(--pk-acc);outline:none}
.pk-cine-btn svg{flex:none}
.pk-cine-tip{position:absolute;left:50%;top:84px;z-index:2;transform:translateX(-50%);max-width:calc(100% - 32px);padding:7px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:rgba(10,12,18,.74);color:rgba(255,255,255,.9);font:12.5px/1.4 var(--pk-font);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;transition:opacity .45s ease}
.pk-cine-tip.is-gone{opacity:0}
.pk-cine-note{position:absolute;left:50%;bottom:76px;z-index:2;transform:translateX(-50%);max-width:calc(100% - 32px);padding:8px 14px;border-radius:999px;border:1px solid var(--pk-acc);background:rgba(10,12,18,.84);color:#fff;font:600 13px/1.3 var(--pk-font);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.pk-cine.is-idle{cursor:none}
.pk-cine.is-idle .pk-cine-bar,.pk-cine.is-idle .pk-cine-tip{opacity:0;pointer-events:none}
.pk-cine:fullscreen{width:100%;height:100%}
@media (max-width:720px){.pk-cine-k,.pk-cine-btn span{display:none}.pk-cine-btn{padding:0 9px}}
`
  function injectCss() {
    if (document.getElementById('pk-cine-css')) return
    const st = document.createElement('style')
    st.id = 'pk-cine-css'
    st.textContent = CSS
    document.head.appendChild(st)
  }
  const syncRoot = () => {
    const r = PK.root()
    r.classList.toggle('has-frames', stack.length > 0)
    document.documentElement.classList.toggle('pk-has-frames', stack.length > 0)
  }
  let current = null

  PK.cinema = (o = {}) => {
    const src = String(o.src || '')
    if (!src) {
      PK.toast('还没有可以播放的成片：一键出片完成后就能全屏观看', 'info')
      return null
    }
    if (current) current.close('replace')
    injectCss()
    const title = String(o.title || '成片')
    const prevFocus = document.activeElement
    const video = h('video.pk-cine-v', {
      src,
      poster: o.poster ? String(o.poster) : null,
      controls: true,
      playsinline: true,
      preload: 'auto',
      // the native controls keep their own fullscreen button / double-click; 「全屏」 / F makes the whole viewer fullscreen
      controlslist: 'noremoteplayback',
      'aria-label': `成片：${title}`,
    })
    const fsBtn = h('button.pk-cine-btn.pk-cine-fs', { type: 'button' })
    const xBtn = h('button.pk-cine-btn.pk-cine-x', { type: 'button', title: '退出观影（Esc）', 'aria-label': '退出观影（Esc）' }, PK.icon('x', 16), h('span', null, '退出'))
    const bar = h(
      'header.pk-cine-bar',
      null,
      h('span.pk-cine-k', null, 'FILM'),
      h('div.pk-cine-tt', null, h('b.pk-cine-title', { title }, title), o.sub ? h('span.pk-cine-sub', null, String(o.sub)) : null),
      fsBtn,
      xBtn,
    )
    const tip = h('div.pk-cine-tip', { role: 'note' }, '空格 播放 / 暂停 · ← → 快退 / 快进 5 秒 · M 静音 · F 全屏 · Esc 退出')
    const muteNote = h('button.pk-cine-note', { type: 'button', hidden: true }, '已静音播放 · 点这里或按 M 打开声音')
    const el = h('div.pk-cine', { role: 'dialog', 'aria-modal': 'true', 'aria-label': `全屏观看：${title}`, tabindex: '-1' }, video, bar, tip, muteNote)

    let idleT = 0
    let tipT = 0
    let lastFsExit = 0
    const isFs = () => document.fullscreenElement === el
    const paintFs = () => {
      const on = isFs()
      PK.clear(fsBtn)
      PK.append(fsBtn, PK.icon(on ? 'collapse' : 'expand', 16), h('span', null, on ? '退出全屏' : '全屏'))
      fsBtn.title = on ? '退出全屏（F / Esc）' : '全屏（F）'
      fsBtn.setAttribute('aria-label', fsBtn.title)
      el.classList.toggle('is-fs', on)
    }
    const onFsChange = () => {
      if (!isFs()) lastFsExit = performance.now()
      paintFs()
      wake()
    }
    const toggleFs = async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen()
        else await el.requestFullscreen({ navigationUI: 'hide' })
      } catch {
        PK.toast('当前窗口不允许网页全屏，可以按 F11 让整个浏览器全屏', 'warn')
      }
    }
    const playing = () => !video.paused && !video.ended
    const wake = () => {
      el.classList.remove('is-idle')
      clearTimeout(idleT)
      idleT = setTimeout(() => {
        // never hide the bar under a keyboard user's focus
        const f = document.activeElement
        if (playing() && !(f && bar.contains(f))) el.classList.add('is-idle')
      }, 2500)
    }
    const play = () => {
      const p = video.play()
      if (p && p.catch)
        p.catch(() => {
          // no user activation reached the frame: play muted and offer the sound
          video.muted = true
          muteNote.hidden = false
          const q = video.play()
          if (q && q.catch) q.catch(() => {})
        })
    }
    const togglePlay = () => (playing() ? video.pause() : play())
    const seekBy = (dt) => {
      const d = Number.isFinite(video.duration) ? video.duration : 0
      try {
        video.currentTime = Math.max(0, d ? Math.min(d - 0.05, video.currentTime + dt) : video.currentTime + dt)
      } catch {}
    }
    const toggleMute = () => {
      video.muted = !video.muted
      if (!video.muted) muteNote.hidden = true
    }

    const api = {
      id: 'cinema',
      kind: 'cinema',
      el,
      layer: el,
      body: el,
      video,
      closed: false,
      setTitle() {},
      setFoot() {},
      busy() {},
      close(reason) {
        if (api.closed) return
        // Esc in browser fullscreen only leaves fullscreen (the browser may deliver that same Esc right after)
        if (reason === 'esc' && (isFs() || performance.now() - lastFsExit < 450)) {
          if (isFs()) document.exitFullscreen().catch(() => {})
          return
        }
        api.closed = true
        const info = { time: video.currentTime || 0, playing: playing(), duration: Number.isFinite(video.duration) ? video.duration : 0 }
        try {
          video.pause()
        } catch {}
        if (isFs()) document.exitFullscreen().catch(() => {})
        document.removeEventListener('fullscreenchange', onFsChange)
        clearTimeout(idleT)
        clearTimeout(tipT)
        const i = stack.indexOf(api)
        if (i >= 0) stack.splice(i, 1)
        syncRoot()
        if (current === api) current = null
        el.classList.remove('is-open')
        setTimeout(() => {
          video.removeAttribute('src')
          try {
            video.load()
          } catch {}
          el.remove()
        }, 240)
        try {
          o.onClose && o.onClose(info)
        } catch (err) {
          console.error(err)
        }
        PK.emit('cinema-close', info)
        if (prevFocus && prevFocus.isConnected && typeof prevFocus.focus === 'function' && !stack.length) {
          try {
            prevFocus.focus({ preventScroll: true })
          } catch {}
        }
      },
    }

    fsBtn.addEventListener('click', toggleFs)
    xBtn.addEventListener('click', () => api.close('x'))
    muteNote.addEventListener('click', () => {
      video.muted = false
      muteNote.hidden = true
      el.focus({ preventScroll: true })
    })
    video.addEventListener('volumechange', () => {
      if (!video.muted) muteNote.hidden = true
    })
    video.addEventListener('pause', wake)
    video.addEventListener('play', wake)
    video.addEventListener('error', () => PK.toast('成片暂时无法播放：文件可能还在写入，稍后再试', 'error'))
    video.addEventListener(
      'loadedmetadata',
      () => {
        const t = Number(o.startAt) || 0
        const d = Number.isFinite(video.duration) ? video.duration : 0
        if (t > 0.05 && (!d || t < d - 0.25)) {
          try {
            video.currentTime = t
          } catch {}
        }
      },
      { once: true },
    )
    el.addEventListener('pointermove', wake)
    el.addEventListener('pointerdown', wake)
    el.addEventListener('keydown', (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return
      const k = ev.key
      const onBtn = ev.target && ev.target.tagName === 'BUTTON'
      if (k === ' ' || k === 'Spacebar' || k === 'k' || k === 'K') {
        if (onBtn && k !== 'k' && k !== 'K') return // Space presses the focused button
        ev.preventDefault()
        togglePlay()
      } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        ev.preventDefault()
        seekBy(k === 'ArrowLeft' ? -5 : 5)
      } else if (k === 'm' || k === 'M') {
        ev.preventDefault()
        toggleMute()
      } else if (k === 'f' || k === 'F') {
        ev.preventDefault()
        toggleFs()
      } else return
      wake()
    })
    document.addEventListener('fullscreenchange', onFsChange)

    paintFs()
    stack.push(api)
    current = api
    PK.root().querySelector('.pk-l-frames').appendChild(el)
    syncRoot()
    requestAnimationFrame(() => {
      el.classList.add('is-open')
      try {
        el.focus({ preventScroll: true })
      } catch {}
    })
    tipT = setTimeout(() => tip.classList.add('is-gone'), 3200)
    play()
    wake()
    PK.emit('cinema-open', api)
    return api
  }
  PK.cinemaOpen = () => Boolean(current && !current.closed)
})()
