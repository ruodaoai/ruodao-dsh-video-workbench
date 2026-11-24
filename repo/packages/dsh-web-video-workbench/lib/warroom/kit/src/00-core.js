/* ============================================================================================================
 * PK · 原生面板内核 (Panel Kit) — core: namespace, utils, events, host bridge (api / upload / actions), data store
 * One shared implementation of every war-room panel; each skin styles it in its own visual language (KIT.md).
 * ============================================================================================================ */
;(function () {
  'use strict'
  if (window.PK && window.PK.__v) return
  const PK = (window.PK = { __v: 1, skin: '', cfg: {} })

  /* ---------------------------------------------------------------- utils */
  const U = (PK.util = {})
  U.clamp = (v, a, b) => Math.min(b, Math.max(a, v))
  U.num = (v, d = 0) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : d
  }
  U.str = (v, d = '') => (v === undefined || v === null ? d : String(v))
  U.esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  U.uid = (p = 'pk') => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  U.debounce = (fn, ms = 300) => {
    let t = 0
    const d = (...a) => {
      clearTimeout(t)
      t = setTimeout(() => fn(...a), ms)
    }
    d.flush = (...a) => {
      clearTimeout(t)
      fn(...a)
    }
    d.cancel = () => clearTimeout(t)
    return d
  }
  U.fmtBytes = (n) => {
    n = U.num(n)
    if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`
    if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`
    if (n >= 1024) return `${Math.round(n / 1024)} KB`
    return `${Math.max(0, Math.round(n))} B`
  }
  /** 83.4 → "01:23" ; 3723 → "1:02:03" */
  U.fmtDur = (sec) => {
    sec = Math.max(0, Math.round(U.num(sec)))
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    const p = (x) => String(x).padStart(2, '0')
    return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`
  }
  U.fmtSec = (sec, digits = 1) => `${U.num(sec).toFixed(digits)} 秒`
  /** ISO / epoch → "今天 14:05" / "11-20 09:12" / "2025-11-20" */
  U.fmtTime = (v) => {
    if (!v) return ''
    const d = typeof v === 'number' ? new Date(v) : new Date(String(v))
    if (Number.isNaN(d.getTime())) return String(v)
    const now = new Date()
    const p = (x) => String(x).padStart(2, '0')
    const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
    if (d.toDateString() === now.toDateString()) return `今天 ${hm}`
    const y = new Date(now.getTime() - 86400000)
    if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`
    if (d.getFullYear() === now.getFullYear()) return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  U.ago = (v) => {
    const t = typeof v === 'number' ? v : Date.parse(String(v || ''))
    if (!Number.isFinite(t)) return ''
    const s = Math.round((Date.now() - t) / 1000)
    if (s < 45) return '刚刚'
    if (s < 3600) return `${Math.round(s / 60)} 分钟前`
    if (s < 86400) return `${Math.round(s / 3600)} 小时前`
    return `${Math.round(s / 86400)} 天前`
  }
  U.baseName = (p) => String(p || '').split(/[\\/]/).pop() || ''
  U.ext = (name) => {
    const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''))
    return m ? m[1].toLowerCase() : ''
  }
  U.kindOfFile = (name, type = '') => {
    const e = U.ext(name)
    const t = String(type || '')
    if (/^image\//.test(t) || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif'].includes(e)) return 'image'
    if (/^video\//.test(t) || ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'].includes(e)) return 'video'
    if (/^audio\//.test(t) || ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'opus'].includes(e)) return 'audio'
    if (['txt', 'md', 'json', 'srt', 'vtt', 'csv'].includes(e)) return 'text'
    return 'other'
  }
  U.copyText = async (text) => {
    const s = String(text ?? '')
    try {
      await navigator.clipboard.writeText(s)
      return true
    } catch {}
    try {
      const ta = document.createElement('textarea')
      ta.value = s
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
  U.fileToArrayBuffer = (file) => (file && typeof file.arrayBuffer === 'function' ? file.arrayBuffer() : new Response(file).arrayBuffer())
  // Payload of the data URL. Split on ';base64,' — NOT on the first comma: MediaRecorder blobs are typed like
  // 'video/webm;codecs=vp9,opus', and cutting at that comma would hand the server a corrupt stream.
  U.fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => {
        const s = String(fr.result || '')
        const i = s.indexOf(';base64,')
        resolve(i >= 0 ? s.slice(i + 8) : s.slice(s.indexOf(',') + 1))
      }
      fr.onerror = () => reject(fr.error || new Error('读取文件失败'))
      fr.readAsDataURL(file)
    })
  U.deepEqual = (a, b) => {
    if (a === b) return true
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }
  U.cloneJson = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
  U.trimText = (s, n = 80) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim()
    return t.length > n ? `${t.slice(0, n - 1)}…` : t
  }
  U.countChars = (s) => Array.from(String(s ?? '')).length

  /* ---------------------------------------------------------------- events */
  const listeners = Object.create(null)
  PK.on = (ev, fn) => {
    ;(listeners[ev] || (listeners[ev] = new Set())).add(fn)
    return () => listeners[ev] && listeners[ev].delete(fn)
  }
  PK.once = (ev, fn) => {
    const off = PK.on(ev, (...a) => {
      off()
      fn(...a)
    })
    return off
  }
  PK.emit = (ev, ...args) => {
    const set = listeners[ev]
    if (!set) return
    for (const fn of [...set]) {
      try {
        fn(...args)
      } catch (err) {
        console.error(`[PK] listener ${ev} failed`, err)
      }
    }
  }

  /* ---------------------------------------------------------------- host bridge */
  PK.state = null // latest WarRoomState pushed by the host (BRIDGE.md §3)
  let seq = 0
  const pending = new Map()
  const toHost = (msg, transfer) => {
    try {
      window.parent.postMessage({ v: 1, ...msg }, '*', transfer && transfer.length ? transfer : undefined)
      return true
    } catch (err) {
      console.error('[PK] postMessage failed', err)
      return false
    }
  }
  class PKError extends Error {
    constructor(message, extra = {}) {
      super(message)
      this.name = 'PKError'
      Object.assign(this, extra)
    }
  }
  PK.Error = PKError
  /** Send one action to the host (BRIDGE.md §4). Resolves with `data`, rejects with PK.Error(message, {code}). */
  PK.action = (action, payload = {}, opts = {}) =>
    new Promise((resolve, reject) => {
      const id = `pk:${++seq}:${Date.now().toString(36)}`
      const timeout = opts.timeout === 0 ? 0 : U.num(opts.timeout, 180000)
      const timer = timeout
        ? setTimeout(() => {
            pending.delete(id)
            reject(new PKError(`操作超时（${Math.round(timeout / 1000)} 秒没有响应）`, { code: 'timeout' }))
          }, timeout)
        : 0
      pending.set(id, { resolve, reject, timer, action })
      if (!toHost({ type: 'dsh-vw/action', id, action, payload }, opts.transfer)) {
        clearTimeout(timer)
        pending.delete(id)
        reject(new PKError('无法连接宿主页面', { code: 'no-host' }))
      }
    })

  window.addEventListener('message', (ev) => {
    if (ev.source !== window.parent) return
    const m = ev.data
    if (!m || typeof m !== 'object' || typeof m.type !== 'string' || m.type.indexOf('dsh-vw/') !== 0) return
    if (m.type === 'dsh-vw/result') {
      if (m.code === 'need-llm') PK.emit('need-llm', m)
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      clearTimeout(p.timer)
      if (m.ok) p.resolve(m.data)
      else p.reject(new PKError(String(m.error || '操作失败'), { code: m.code || '' }))
    } else if (m.type === 'dsh-vw/state') {
      const prev = PK.state
      PK.state = m.state || null
      PK.emit('state', PK.state, prev)
      if (!prev || (prev.project && prev.project.dir) !== (PK.state && PK.state.project && PK.state.project.dir)) PK.emit('project', PK.state && PK.state.project)
    } else if (m.type === 'dsh-vw/event') {
      PK.emit(`event:${m.event}`, m.data || {})
    }
  })

  /** resolve when pred(PK.state) is truthy (checked on every state push), or after `timeout` ms (resolves false) */
  PK.waitState = (pred, timeout = 5000) =>
    new Promise((resolve) => {
      try {
        if (pred(PK.state)) return resolve(true)
      } catch {}
      let off = null
      const timer = setTimeout(() => {
        if (off) off()
        resolve(false)
      }, timeout)
      off = PK.on('state', (s) => {
        let ok = false
        try {
          ok = Boolean(pred(s))
        } catch {}
        if (ok) {
          clearTimeout(timer)
          off()
          resolve(true)
        }
      })
    })
  PK.dir = () => (PK.state && PK.state.project && PK.state.project.dir) || ''
  PK.hasProject = () => Boolean(PK.dir())
  PK.needProject = () => {
    if (!PK.dir()) throw new PKError('请先新建或打开一个视频工程', { code: 'no-project' })
    return PK.dir()
  }
  PK.option = (listName, value) => {
    const list = (PK.state && PK.state.options && PK.state.options[listName]) || []
    return list.find((o) => o.value === value) || null
  }
  PK.optionLabel = (listName, value, fallback) => {
    const o = PK.option(listName, value)
    return o ? o.label : fallback !== undefined ? fallback : U.str(value)
  }

  /**
   * Call a plugin route through the host (`api` action, allow-listed — BRIDGE.md §4b).
   * Returns the parsed JSON body. Throws PK.Error when the HTTP status ≥ 400 or the body says `ok:false`
   * (pass `{ raw: true }` to get `{ status, body }` without throwing).
   */
  PK.api = async (method, path, opts = {}) => {
    const out = await PK.action(
      'api',
      { method: String(method || 'GET').toUpperCase(), path: String(path || ''), query: opts.query || undefined, body: opts.body || undefined },
      { timeout: opts.timeout === undefined ? 600000 : opts.timeout },
    )
    if (opts.raw) return out
    const body = out && out.body
    const status = U.num(out && out.status)
    if (status >= 400 || (body && typeof body === 'object' && body.ok === false)) {
      const msg = (body && (body.error || body.message)) || `请求失败（HTTP ${status}）`
      throw new PKError(String(msg), { code: (body && body.code) || `http-${status}`, status, body })
    }
    return body
  }
  PK.get = (path, query, opts = {}) => PK.api('GET', path, { ...opts, query })
  PK.post = (path, body, opts = {}) => PK.api('POST', path, { ...opts, body })
  /** projectDir-scoped POST helper: merges `{ projectDir }` into the body */
  PK.postP = (path, body = {}, opts = {}) => PK.post(path, { projectDir: PK.needProject(), ...body }, opts)

  /** Raw binary upload (BRIDGE.md §4b `upload`): bgm/upload · reference/upload · skin/upload · assets/upload */
  PK.upload = async (path, file, opts = {}) => {
    const buf = await U.fileToArrayBuffer(file)
    const out = await PK.action(
      'upload',
      { path, query: opts.query || {}, name: file && file.name ? String(file.name) : 'upload.bin', type: (file && file.type) || '', data: buf },
      { timeout: opts.timeout === undefined ? 1800000 : opts.timeout, transfer: [buf] },
    )
    const body = out && out.body
    if (U.num(out && out.status) >= 400 || (body && body.ok === false)) throw new PKError(String((body && body.error) || '上传失败'), { body })
    return body
  }

  /** Import files into the project asset library through the host (keeps its auto-binding logic). */
  PK.importFiles = async (files, opts = {}) => {
    const list = Array.from(files || []).filter(Boolean)
    if (!list.length) return 0
    PK.needProject()
    const payloadFiles = []
    const transfer = []
    for (const f of list) {
      const data = await U.fileToArrayBuffer(f)
      payloadFiles.push({ name: String(f.name || 'file'), type: String(f.type || ''), data })
      transfer.push(data)
    }
    const res = await PK.action('importFiles', { files: payloadFiles, role: opts.role || '' }, { timeout: 1800000, transfer })
    PK.store.invalidate()
    return U.num(res && res.count)
  }

  /** Poll a background job (`GET jobs?id=`) until it finishes; returns the job's final result body. */
  PK.job = async (jobId, opts = {}) => {
    const interval = U.num(opts.interval, 900)
    const started = Date.now()
    const maxMs = U.num(opts.maxMs, 3600000)
    for (;;) {
      if (opts.signal && opts.signal.aborted) throw new PKError('已取消', { code: 'aborted' })
      const d = await PK.api('GET', 'jobs', { query: { id: jobId }, raw: true })
      const b = (d && d.body) || {}
      if (b.ok === false || !b.job) throw new PKError(String(b.error || '后台任务查询失败'), { code: 'job-missing' })
      const job = b.job
      const st = String(job.status || b.status || '')
      if (opts.onProgress) {
        try {
          opts.onProgress(job)
        } catch {}
      }
      if (st === 'done' || st === 'completed' || st === 'success') return job.result || b.result || job
      if (st === 'failed' || st === 'error') throw new PKError(String(job.error || b.error || '后台任务失败'), { job })
      if (Date.now() - started > maxMs) throw new PKError('后台任务超时', { code: 'timeout' })
      await U.sleep(interval)
    }
  }

  /** Same-origin URL for a project file (relative path inside the project dir) */
  PK.assetUrl = (rel, dir) => {
    const d = dir || PK.dir()
    if (!d || !rel) return ''
    const v = (PK.state && PK.state.rev) || 0
    return `/api/video-workbench/asset?projectDir=${encodeURIComponent(d)}&rel=${encodeURIComponent(rel)}&v=${v}`
  }
  PK.routeUrl = (path, query) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
    const s = q.toString()
    return `/api/video-workbench/${String(path).replace(/^\/+/, '')}${s ? `?${s}` : ''}`
  }

  /* ---------------------------------------------------------------- data store (raw GET /state snapshot) */
  PK.store = {
    data: null,
    rev: -1,
    dir: null,
    _loading: null,
    /** Raw `/state` payload (projects, activeProject{script,assets,…}, llmConfig, ttsConfig, voiceCatalog, …) */
    async load(force) {
      const dir = PK.dir()
      const rev = (PK.state && PK.state.rev) || 0
      if (!force && this.data && this.dir === dir && this.rev === rev) return this.data
      if (this._loading && this._loadingKey === `${dir}|${rev}` && !force) return this._loading
      this._loadingKey = `${dir}|${rev}`
      this._loading = (async () => {
        try {
          const d = await PK.api('GET', 'state', { query: dir ? { projectDir: dir } : {} })
          this.data = d
          this.dir = dir
          this.rev = rev
          PK.emit('store', d)
          return d
        } finally {
          this._loading = null
        }
      })()
      return this._loading
    },
    invalidate() {
      this.rev = -1
    },
    get project() {
      return (this.data && this.data.activeProject) || null
    },
    get script() {
      return (this.data && this.data.activeProject && this.data.activeProject.script) || null
    },
  }

  /** Small helper used by panels: run an async op with a busy flag on `ctx`, toast the error (never throws). */
  PK.run = async (fn, opts = {}) => {
    try {
      const r = await fn()
      if (opts.ok) PK.toast(typeof opts.ok === 'function' ? opts.ok(r) : opts.ok, 'success')
      return r
    } catch (err) {
      PK.reportError(err, opts.fail)
      return undefined
    }
  }
  PK.reportError = (err, prefix) => {
    const msg = String((err && err.message) || err || '操作失败')
    if (err && err.code === 'need-llm') return
    if (err && err.code === 'no-project') {
      if (PK.toast) PK.toast(msg, 'info', { action: { label: '新建 / 打开工程', onClick: () => PK.open && PK.open('projects') } })
      return
    }
    if (PK.toast) PK.toast(prefix ? `${prefix}：${msg}` : msg, 'error')
    else console.error('[PK]', msg)
  }

  /** Skin configuration (call once from the skin script, before or after DOM ready). */
  PK.configure = (cfg = {}) => {
    PK.cfg = { ...PK.cfg, ...cfg }
    if (cfg.skin) {
      PK.skin = String(cfg.skin)
      try {
        document.documentElement.setAttribute('data-pk-skin', PK.skin)
      } catch {}
    }
    PK.emit('configure', PK.cfg)
    return PK
  }
})()
