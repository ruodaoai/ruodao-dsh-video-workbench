/* ============================================================================================================
 * PK · 工程工具 (panel agent E) — 发布包导出 `export` · 品牌套件 `brand` · 版本历史与工程安全 `history`
 *
 * Behaviour ported from the deleted classic UI (handleExportPublishPack + publishPackResult, handleExportMotionMd,
 * the 「工程安全与高级工具」 modal: loadProTab / handleProSnapshot / handleProDiff / handleProRestore /
 * handleToggleSceneLock / handleClearOverrides / handleSaveCharacter / handleDeleteCharacter / handleStockSearch /
 * handleStockImport, friendlyVersionLabel, overrideFieldNames) and completed with every option the backend offers
 * (version prune, batch locks, character attach, stock filters + scene binding, ledger filter, B-roll sourcing plan,
 * brand logo → project 品牌标识 asset, MOTION.md export).
 * 发布包封面 (publish-pack/cover): 默认自动挑选 / 选用视频画面（逐帧）/ AI 重新生成（BYOK 生图，后台任务）/ 加标题（canvas +
 * 随包 Noto Sans SC）. 免费素材 tab: Pexels / Pixabay API Key form (saved with the cloud-media config, masked, .env fallback).
 *
 * Built only from PK primitives so every skin restyles it natively. Backend only through the bridge
 * (PK.get / post / upload / action); media through same-origin URLs (stock thumbnails are the official
 * Pexels / Pixabay CDN images returned by the backend search). No fetch, no eval.
 * ============================================================================================================ */
;(function () {
  'use strict'
  const PK = window.PK
  if (!PK || typeof PK.panel !== 'function') return
  const U = PK.util
  const h = PK.h
  const ui = PK.ui

  /* ================================================================================================ helpers */
  const p2 = (x) => String(x).padStart(2, '0')
  const asArr = (x) => (Array.isArray(x) ? x : x === undefined || x === null ? [] : [x])
  /** ISO / epoch → "2026-11-21 19:27" */
  const fmtFull = (v) => {
    if (!v) return ''
    const d = typeof v === 'number' ? new Date(v) : new Date(String(v))
    if (Number.isNaN(d.getTime())) return String(v)
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
  }
  const normPath = (p) => String(p || '').replace(/\\/g, '/')
  const isAbsPath = (p) => /^(?:[a-z]:[\\/]|[\\/])/i.test(String(p || ''))
  /** project-relative path of an absolute file inside the current project ('' when it is outside) */
  const relInProject = (abs, dir) => {
    const a = normPath(abs)
    const d = normPath(dir === undefined ? PK.dir() : dir).replace(/\/+$/, '')
    if (!a || !d) return ''
    return a.toLowerCase().startsWith(`${d.toLowerCase()}/`) ? a.slice(d.length + 1) : ''
  }
  const joinPath = (base, ...parts) => {
    const b = String(base || '')
    const sep = b.includes('\\') ? '\\' : '/'
    return [b.replace(/[\\/]+$/, ''), ...parts.map((x) => String(x).replace(/^[\\/]+|[\\/]+$/g, '').replace(/[\\/]+/g, sep))].join(sep)
  }
  /** "a,b,c,d" → "a、b、c 等 4 个" */
  const shortList = (raw, n = 3) => {
    const a = (Array.isArray(raw) ? raw : String(raw || '').split(',')).map((s) => String(s).trim()).filter(Boolean)
    return a.length > n ? `${a.slice(0, n).join('、')} 等 ${a.length} 个` : a.join('、')
  }
  /** compact one-line rendering of any JSON value (conflict summaries) */
  const shortVal = (v, n = 80) => {
    let s
    try {
      s = typeof v === 'string' ? v : JSON.stringify(v)
    } catch {
      s = String(v)
    }
    return U.trimText(s === undefined || s === null ? '（空）' : s, n) || '（空）'
  }
  const copy = async (text, what = '内容') => {
    const ok = await U.copyText(String(text ?? ''))
    PK.toast(ok ? `已复制${what}` : '复制失败：请手动选中文字后按 Ctrl + C 复制', ok ? 'success' : 'error')
    return ok
  }
  const copyBtn = (text, o = {}) =>
    ui.btn(o.label === undefined ? '复制' : o.label, () => copy(typeof text === 'function' ? text() : text, o.what), {
      icon: 'copy',
      size: o.size || 'sm',
      kind: o.kind || 'ghost',
      title: o.title || '复制到剪贴板',
    })
  /** a real <a> styled as a kit button — { download: 'name.ext' } saves the file, otherwise opens a new tab */
  const linkBtn = (label, href, o = {}) =>
    h(
      'a.pk-btn',
      {
        class: [`pk-btn--${o.kind || 'secondary'}`, `pk-btn--${o.size || 'sm'}`, { 'pk-btn--icon': !label }, o.class],
        href: href || null,
        download: o.download === undefined ? null : String(o.download || ''),
        target: o.download === undefined ? '_blank' : null,
        rel: 'noopener noreferrer',
        title: o.title || null,
        'aria-label': !label ? o.title || null : null,
        style: { textDecoration: 'none' },
      },
      o.icon ? PK.icon(o.icon, o.size === 'md' ? 15 : 13) : null,
      label ? h('span.pk-btn-l', null, label) : null,
    )
  /** wrapped pre-formatted text (markdown / logs) that never clips: long lines wrap, tall text scrolls */
  const preText = (text, o = {}) => {
    const el = ui.code(text, { class: 'pk-pre-wrap' })
    for (const n of [el, el.firstChild]) {
      if (!n || !n.style) continue
      n.style.whiteSpace = 'pre-wrap'
      n.style.overflowWrap = 'anywhere'
      n.style.wordBreak = 'break-word'
    }
    el.style.maxHeight = o.max === false ? 'none' : `${o.max || 300}px`
    el.setAttribute('tabindex', '0')
    if (o.scrollKey) el.setAttribute('data-pk-scroll', o.scrollKey)
    return el
  }
  /** big in-skin preview of an image / video (never a new browser tab) */
  const lightbox = (src, o = {}) => {
    const f = PK.frame({ id: 'pt-lightbox', kind: 'modal', size: 'xl', title: o.title || '预览', en: o.en || 'PREVIEW' })
    const media = o.video ? ui.video(src, { autoplay: true }) : ui.image(src, { fit: 'contain', alt: o.title || '' })
    media.style.aspectRatio = 'auto'
    media.style.height = 'min(66vh, 860px)'
    PK.append(f.body, media, o.caption ? ui.hint(o.caption) : null)
    f.setFoot([o.download ? linkBtn('下载', src, { download: o.download, icon: 'download', size: 'md' }) : null, ui.spacer(), ui.btn('关闭', () => f.close('x'), { kind: 'primary' })])
    return f
  }
  /** read-only full-text reader */
  const textViewer = (title, text, o = {}) => {
    const f = PK.frame({ id: 'pt-text', kind: 'modal', size: 'lg', title, en: o.en || 'FULL TEXT' })
    PK.append(f.body, o.hint ? ui.hint(o.hint) : null, preText(text, { max: false }))
    f.setFoot([
      ui.hint(`${U.countChars(text)} 字`),
      ui.spacer(),
      copyBtn(text, { label: '复制全文', what: o.what || '全文', kind: 'secondary', size: 'md' }),
      o.download ? linkBtn('下载', o.download.href, { download: o.download.name, icon: 'download', size: 'md' }) : null,
      ui.btn('关闭', () => f.close('x'), { kind: 'primary' }),
    ])
    return f
  }
  /**
   * Re-rendering while a Chinese IME composition is active would cancel the candidate window and lose the
   * half-typed syllables — defer every re-render of this panel until the composition ends.
   */
  const guardIme = (ctx) => {
    let composing = false
    let pending = false
    const orig = ctx.render
    ctx.render = function () {
      if (composing) {
        pending = true
        return undefined
      }
      return orig.apply(ctx, arguments)
    }
    const el = ctx.frame.el
    const on = () => {
      composing = true
    }
    const off = () => {
      composing = false
      if (pending) {
        pending = false
        setTimeout(() => ctx.update(), 0)
      }
    }
    el.addEventListener('compositionstart', on)
    el.addEventListener('compositionend', off)
    ctx.onCleanup(() => {
      el.removeEventListener('compositionstart', on)
      el.removeEventListener('compositionend', off)
    })
  }
  /** a single-line input that grows to fill the row it sits in */
  const growInput = (o) => h('div', { style: { flex: '1 1 260px', minWidth: 0 } }, ui.input(o))
  /**
   * label → value rows whose values can be long / multi-line (diffs, a user's edited narration …): label above, value
   * below, so they read naturally in every skin (some skins right-align ui.kv values, which suits short values only)
   */
  const longKv = (pairs) =>
    ui.stack(
      pairs.filter(Boolean).map(([k, v]) => ui.field({ label: k }, typeof v === 'string' ? ui.text(v) : v)),
      { gap: 8 },
    )

  /* ------------------------------------------------------------------------------------------ platforms */
  const PLATFORMS = [
    { value: 'universal', label: '通用', name: '通用全平台', hint: '一份资料包发多个平台，标题与话题标签通用', fit: null },
    { value: 'douyin', label: '抖音', name: '抖音', hint: '竖屏 9:16 效果最好', fit: ['9:16'] },
    { value: 'kuaishou', label: '快手', name: '快手', hint: '竖屏 9:16 效果最好', fit: ['9:16'] },
    { value: 'xiaohongshu', label: '小红书', name: '小红书', hint: '竖屏 3:4 / 9:16 效果最好，附带效率工具类话题', fit: ['3:4', '9:16', '1:1'] },
    { value: 'bilibili', label: 'B 站', name: '哔哩哔哩（B 站）', hint: '横屏 16:9 效果最好', fit: ['16:9'] },
  ]
  const platformOf = (v) => PLATFORMS.find((p) => p.value === v) || null
  const aspectOf = (w, hh) => {
    w = U.num(w)
    hh = U.num(hh)
    if (!w || !hh) return ''
    const r = w / hh
    const near = (x, tol) => Math.abs(r - x) < tol
    if (near(16 / 9, 0.06)) return '16:9'
    if (near(9 / 16, 0.04)) return '9:16'
    if (near(1, 0.04)) return '1:1'
    if (near(3 / 4, 0.04)) return '3:4'
    if (near(4 / 3, 0.05)) return '4:3'
    return `${w}:${hh}`
  }

  /* ================================================================================================
   * 发布包导出 · PUBLISH PACK
   * ================================================================================================ */
  const packCache = new Map() // `${dir}|${platform}` → last publish-pack result (kept for this session)
  const packKey = (p, dir) => `${dir === undefined ? PK.dir() : dir}|${p}`
  const slugOf = (raw) =>
    String(raw || 'dsh-video')
      .trim()
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'dsh-video'

  const exportDefaultPlatform = (ctx) => {
    const a = ctx.args && ctx.args.platform
    if (platformOf(a)) return a
    const d = (PK.state && PK.state.director) || {}
    if (platformOf(d.targetPlatform) && d.targetPlatform !== 'universal') return d.targetPlatform
    const bk = ctx.data && ctx.data.brandKit
    if (bk && platformOf(bk.defaultPlatform)) return bk.defaultPlatform
    return platformOf(d.targetPlatform) ? d.targetPlatform : 'universal'
  }
  const selectPlatform = (ctx, p) => {
    const L = ctx.local
    L.platform = p
    L.platformTouched = true
    L.result = packCache.get(packKey(p)) || null
    L.error = null
  }
  /**
   * Was a pack for this platform generated in an earlier session? (its files stay in publish/<p>-pack/). Probed with
   * an <img> load of the cover — a same-origin media request, no fetch. → undefined/null while probing, false, or { cover }
   */
  const probePrevPack = (ctx, p) => {
    const L = ctx.local
    const key = packKey(p)
    L.prevPack = L.prevPack || {}
    if (key in L.prevPack) return L.prevPack[key]
    L.prevPack[key] = null
    const src = `${PK.assetUrl(`publish/${p}-pack/cover.png`)}&probe=${Date.now().toString(36)}`
    const img = new Image()
    img.onload = () => {
      if (L.prevPack[key] !== null) return
      L.prevPack[key] = { cover: src, w: img.naturalWidth, h: img.naturalHeight }
      ctx.update()
    }
    img.onerror = () => {
      if (L.prevPack[key] === null) L.prevPack[key] = false
    }
    img.src = src
    return null
  }
  const qaSummary = (qa) => {
    if (!qa || typeof qa !== 'object') return ''
    const checks = Array.isArray(qa.checks) ? qa.checks : []
    const pass = checks.filter((c) => c && c.passed).length
    const lufs = qa.loudness && qa.loudness.integratedLufs !== undefined && qa.loudness.integratedLufs !== null ? `响度 ${qa.loudness.integratedLufs} LUFS` : ''
    return [checks.length ? `${pass}/${checks.length} 项通过` : qa.passed ? '质检通过' : '', lufs].filter(Boolean).join(' · ')
  }

  const elapsedSec = (L) => (L.busy ? Math.max(0, Math.round((Date.now() - (L.startedAt || Date.now())) / 1000)) : 0)
  /** live "已用时 N 秒" counters: updated in place, so the panel (and its video player) is not rebuilt every second */
  const paintElapsed = (L) => {
    const s = elapsedSec(L)
    for (const [el, fmt] of L.tickEls || []) if (el && el.isConnected) el.textContent = fmt(s)
  }
  const generatePack = async (ctx) => {
    const L = ctx.local
    const dir = PK.needProject()
    const st = PK.state || {}
    if (!(st.preview && st.preview.hasMp4)) throw new PK.Error('还没有渲染成片 MP4：请先在「分步精修 → 交付」渲染成片，再生成发布包')
    if (L.busy) return
    const platform = L.platform
    L.busy = true
    L.error = null
    L.startedAt = Date.now()
    const tick = setInterval(() => paintElapsed(L), 1000)
    ctx.onCleanup(() => clearInterval(tick))
    ctx.render()
    try {
      const res = await PK.post('publish-pack', { projectDir: dir, platform }, { timeout: 900000 })
      const r = { ...res, platform: res.platform || platform, generatedAt: Date.now(), elapsedMs: Date.now() - L.startedAt }
      packCache.set(packKey(r.platform, dir), r)
      if (L.prevPack) delete L.prevPack[packKey(r.platform, dir)]
      if (PK.dir() === dir && L.platform === platform) {
        L.result = r
        L.scrollToResult = true
      }
      PK.toast(`「${r.platformLabel || platform}」发布包已生成，保存在工程的 publish/${r.platform}-pack/ 文件夹`, 'success')
      // the cover section shows which cover this pack used
      if (PK.dir() === dir && !ctx.frame.closed) loadCover(ctx, { quiet: true })
    } catch (err) {
      L.error = err
      throw err
    } finally {
      clearInterval(tick)
      L.busy = false
      ctx.update()
    }
  }

  /** the final-MP4 player is reused across re-renders (same node → playback position survives a platform switch) */
  const exportPlayer = (ctx, src, poster, w, hh) => {
    const L = ctx.local
    const key = `${src}|${poster || ''}|${w}x${hh}`
    if (L.player && L.player.key === key) return L.player.el
    const v = ui.video(src, { poster: poster || undefined, aspect: w && hh ? `${w} / ${hh}` : '16 / 9' })
    if (w && hh && hh > w) {
      // portrait: keep the player compact and centred instead of a 800 px tall column
      v.style.width = `min(100%, ${Math.round((320 * w) / hh)}px)`
      v.style.marginInline = 'auto'
    }
    L.player = { key, el: v }
    return v
  }

  const imgCard = (title, url, name, emptyText) =>
    ui.card({
      media: url ? ui.image(url, { fit: 'contain', alt: title }) : h('div.pk-media-empty', null, PK.icon('image', 22), h('span', null, emptyText || '未包含')),
      aspect: '4 / 3',
      title,
      onClick: url ? () => lightbox(url, { title, download: name }) : null,
      actions: url ? [ui.btn('放大', () => lightbox(url, { title, download: name }), { size: 'sm', icon: 'expand' }), linkBtn('下载', url, { download: name, icon: 'download' })] : null,
    })

  const renderPackResult = (ctx, r) => {
    const base = `publish/${r.platform}-pack`
    const files = r.files || {}
    const meta = String(r.metaMarkdown || '')
    const mp4Name = files.mp4Path ? U.baseName(files.mp4Path) : ''
    const hasQaFile = /qa_report\.json/.test(meta)
    const url = (name) => PK.assetUrl(`${base}/${name}`)
    const coverUrl = files.coverPath ? r.coverUrl || url('cover.png') : ''
    const sheetUrl = files.snapshotPath ? r.snapshotUrl || url('snapshot-3x3.png') : ''
    const rows = [
      mp4Name && { name: mp4Name, what: '成片 MP4（原画质拷贝，直接上传平台）', icon: 'film', kind: 'video' },
      files.coverPath && { name: 'cover.png', what: '封面图', icon: 'image', kind: 'image' },
      files.snapshotPath && { name: 'snapshot-3x3.png', what: '3×3 九宫格抽帧验收墙', icon: 'grid', kind: 'image' },
      hasQaFile && { name: 'qa_report.json', what: '成片自动化质检报告', icon: 'check', kind: 'file' },
      files.metaPath && { name: 'meta.md', what: '推荐标题 · 话题标签 · AI 合规声明 · 文件清单', icon: 'prompt', kind: 'text' },
    ].filter(Boolean)
    const titles = Array.isArray(r.suggestedTitles) ? r.suggestedTitles : []
    const tags = Array.isArray(r.hashtags) ? r.hashtags : []
    const readMeta = () => textViewer('meta.md · 发布说明', meta, { en: 'META.MD', what: 'meta.md 全文', download: { href: url('meta.md'), name: 'meta.md' } })
    return [
      ui.note(h('span', null, '文件已保存到工程文件夹：', h('span.pk-mono', null, r.packDir || base)), {
        level: 'ok',
        title: `「${r.platformLabel || r.platform}」发布包已生成 · ${U.fmtTime(r.generatedAt)}`,
        actions: [copyBtn(r.packDir || base, { label: '复制文件夹路径', what: '文件夹路径', kind: 'secondary' })],
      }),
      ui.split(
        [
          ui.section(
            { title: '封面与九宫格', en: 'COVER · 3×3', icon: 'image' },
            ui.grid([imgCard('封面 cover.png', coverUrl, 'cover.png'), imgCard('九宫格 snapshot-3x3.png', sheetUrl, 'snapshot-3x3.png', '这次没有九宫格（渲染成片时会自动生成）')], { min: 170 }),
            r.cover ? ui.hint(`这次的封面：${packCoverText(r.cover)}`) : null,
          ),
        ],
        [
          ui.section(
            { title: '推荐标题（三选一）', en: 'TITLES', icon: 'edit', count: titles.length },
            titles.length ? ui.list(titles.map((t, i) => ui.item({ key: `pk-t-${i}`, lead: p2(i + 1), body: ui.text(t), right: [copyBtn(t, { what: '标题' })] })), { dense: true }) : ui.hint('没有生成标题'),
          ),
          ui.section(
            { title: '话题标签', en: 'HASHTAGS', icon: 'link', count: tags.length, actions: tags.length ? [copyBtn(tags.join(' '), { label: '复制全部', what: '话题标签' })] : null },
            tags.length ? ui.row(tags.map((t) => ui.tag(t)), { wrap: true }) : ui.hint('没有生成话题标签'),
          ),
          ui.section(
            { title: 'AI 合成合规声明', en: 'AI DISCLOSURE', icon: 'info', actions: r.complianceNotice ? [copyBtn(r.complianceNotice, { what: '合规声明' })] : null },
            ui.text(r.complianceNotice || '—'),
            ui.hint('按平台规范，AI 生成内容发布时需要标注。可直接粘贴到视频简介里。'),
          ),
        ],
        { ratio: 'minmax(0, 1fr) minmax(0, 1.2fr)' },
      ),
      meta
        ? ui.section(
            {
              title: '发布说明 meta.md',
              en: 'META.MD',
              icon: 'prompt',
              actions: [copyBtn(meta, { label: '复制全文', what: 'meta.md 全文' }), ui.btn('全屏阅读', readMeta, { size: 'sm', kind: 'ghost', icon: 'expand' })],
            },
            preText(meta, { max: 260, scrollKey: 'pk-meta' }),
          )
        : null,
      ui.section(
        { title: '文件清单', en: 'FILES', icon: 'folder', count: rows.length },
        ui.list(
          rows.map((f) =>
            ui.item({
              key: `pk-f-${f.name}`,
              icon: f.icon,
              title: f.name,
              sub: f.what,
              right: [
                f.kind === 'image' ? ui.btn('预览', () => lightbox(url(f.name), { title: f.name, download: f.name }), { size: 'sm', icon: 'eye' }) : null,
                f.kind === 'video' ? ui.btn('预览', () => lightbox(url(f.name), { title: f.name, video: true, download: f.name }), { size: 'sm', icon: 'play' }) : null,
                f.kind === 'text' ? ui.btn('阅读', readMeta, { size: 'sm', icon: 'eye' }) : null,
                linkBtn('下载', url(f.name), { download: f.name, icon: 'download' }),
              ],
            }),
          ),
          { dense: true },
        ),
      ),
    ]
  }

  /* ================================================================================================
   * 发布包封面 · COVER STUDIO — 默认（自动挑选最好的一帧）/ 选用视频画面（逐帧精确）/ AI 重新生成（BYOK 生图）/ 加标题
   * Backend: GET / POST publish-pack/cover (routes-cover.js · dsh-tool-media/cover-studio.js). Files live in the
   * project's output/covers/; the publish pack copies the chosen cover as cover.png.
   * ================================================================================================ */
  const COVER_ASPECTS = ['3:4', '9:16', '16:9', '1:1', '4:3']
  const ASPECT_FOR = { '3:4': '小红书', '9:16': '抖音 / 快手 / 视频号', '16:9': 'B 站 / YouTube', '1:1': '方形封面', '4:3': '横版 4:3' }
  const PLATFORM_COVER_ASPECT = { xiaohongshu: '3:4', douyin: '9:16', kuaishou: '9:16', bilibili: '16:9' }
  const COVER_MODE_LABEL = { auto: '自动挑选', frame: '视频画面', ai: 'AI 生成', title: '已加标题' }
  const COVER_TABS = [
    { value: 'auto', label: '默认（自动）', icon: 'sparkle', hint: '自动挑选成片里最清晰、最好看的一帧' },
    { value: 'frame', label: '选用视频画面', icon: 'film', hint: '在播放器里选中任意一帧做封面' },
    { value: 'ai', label: 'AI 重新生成', icon: 'wand', hint: '根据画面和主题让 AI 生成新封面' },
  ]
  const BADGE_SHORT = { black: '黑屏', white: '过曝', flat: '单调', unreadable: '失败', motion: '转场', fade: '淡出', dim: '偏暗', cut: '切换点' }
  const coverJobs = new Map() // project dir → running AI cover job { jobId, startedAt, progress, message, aspect, els }
  const coverDrafts = new Map() // project dir → AI prompt draft { prompt, prev, aspect, aspectTouched, useRef }
  let coverCostOk = false // the first AI cover of a session asks once (billed by the user's provider)
  let exportCtx = null // the open 发布包导出 panel (job callbacks refresh it)

  const aspectCss = (a) => {
    const [x, y] = String(a || '').split(':').map(Number)
    return x > 0 && y > 0 ? `${x} / ${y}` : '16 / 9'
  }
  const hasNum = (t) => t !== null && t !== undefined && t !== '' && Number.isFinite(Number(t))
  const fmtSec = (t) => (hasNum(t) ? `${Number(t).toFixed(2)} 秒` : '')
  const fmtClock = (t) => {
    const s = Math.max(0, Number(t) || 0)
    return `${p2(Math.floor(s / 60))}:${String((s % 60).toFixed(2)).padStart(5, '0')}`
  }
  const coverDraft = (dir) => {
    let d = coverDrafts.get(dir)
    if (!d) {
      d = { prompt: '', prev: '', aspect: '', aspectTouched: false, useRef: true }
      coverDrafts.set(dir, d)
    }
    return d
  }
  const coverCands = (cv) => (cv && cv.auto && Array.isArray(cv.auto.candidates) ? cv.auto.candidates : [])
  const coverBest = (cv) => (cv && cv.auto && cv.auto.bestIndex >= 0 ? coverCands(cv)[cv.auto.bestIndex] || null : null)
  /** the image the current choice points at (shown as 发布包封面; the AI reference frame) */
  const coverFileOf = (cv) => (cv && cv.cover && cv.cover.effective && cv.cover.effective.file) || ''
  /** the final.mp4 URL keyed by the film's size + mtime, so host data refreshes do not rebuild the players */
  const filmSrc = (ctx) => {
    const cv = ctx.local.cv
    const dir = PK.dir()
    if (cv && cv.hasMp4 && cv.mp4Sig && dir && cv.projectDir && normPath(cv.projectDir).toLowerCase() === normPath(dir).toLowerCase()) {
      return `/api/video-workbench/asset?projectDir=${encodeURIComponent(dir)}&rel=${encodeURIComponent('output/final.mp4')}&s=${encodeURIComponent(cv.mp4Sig)}`
    }
    return (PK.state && PK.state.preview && PK.state.preview.mp4Url) || ''
  }
  const aiAspectOf = (ctx) => {
    const L = ctx.local
    const d = coverDraft(PK.dir())
    if (d.aspectTouched && COVER_ASPECTS.includes(d.aspect)) return d.aspect
    const va = L.cv && L.cv.video && L.cv.video.aspect
    return PLATFORM_COVER_ASPECT[L.platform] || (COVER_ASPECTS.includes(va) ? va : '16:9')
  }
  const packCoverText = (info) => {
    if (!info) return ''
    const t = hasNum(info.timeSec) ? `（第 ${fmtSec(info.timeSec)}）` : ''
    const base =
      info.mode === 'frame' ? `选用的视频画面${t}` : info.mode === 'ai' ? `AI 生成封面${info.aspect ? ` ${info.aspect}` : ''}` : info.mode === 'title' ? '加了标题的封面' : info.mode === 'auto' ? `自动挑选的画面${t}` : `旧版自动截帧${t}`
    return `${base}${info.fallbackFrom ? '（之前选的封面文件不见了，已改用自动挑选）' : ''}${info.refreshed ? '（成片更新过，已在同一时间点重新截取）' : ''}`
  }

  /* ---- data */
  const scheduleCoverPoll = (ctx) => {
    const L = ctx.local
    clearTimeout(L.cvPollT)
    L.cvPolls = (L.cvPolls || 0) + 1
    if (L.cvPolls > 120) return
    L.cvPollT = setTimeout(() => {
      if (!ctx.frame.closed) loadCover(ctx, { quiet: true })
    }, 1200)
  }
  const loadCover = async (ctx, o = {}) => {
    const L = ctx.local
    const dir = PK.dir()
    if (!dir) return
    const seq = (L.cvSeq = (L.cvSeq || 0) + 1)
    if (!o.quiet) {
      L.cvLoading = true
      ctx.update()
    }
    try {
      const res = await PK.get('publish-pack/cover', { projectDir: dir, platform: L.platform })
      if (seq !== L.cvSeq || dir !== PK.dir()) return
      L.cv = res
      L.cvErr = null
      if (!L.cvTab) L.cvTab = res.cover && res.cover.mode === 'frame' ? 'frame' : res.cover && (res.cover.mode === 'ai' || res.cover.mode === 'title') ? 'ai' : 'auto'
      if (res.aiJob && res.aiJob.jobId && !coverJobs.has(dir)) trackCoverJob(dir, res.aiJob.jobId, res.aiJob)
      if (res.auto && res.auto.status === 'pending') scheduleCoverPoll(ctx)
      else L.cvPolls = 0
    } catch (err) {
      if (seq === L.cvSeq) L.cvErr = err
    } finally {
      if (seq === L.cvSeq) {
        L.cvLoading = false
        ctx.update()
      }
    }
  }
  /** POST publish-pack/cover { action, … } → the full cover state comes back; toasts its message */
  const coverAct = async (ctx, action, body = {}, o = {}) => {
    const L = ctx.local
    const dir = PK.needProject()
    const res = await PK.post('publish-pack/cover', { projectDir: dir, platform: L.platform, action, ...body }, { timeout: o.timeout || 300000 })
    if (PK.dir() === dir && res && res.auto) {
      L.cv = res
      if (res.auto.status === 'pending') scheduleCoverPoll(ctx)
    }
    if (res && res.message && o.toast !== false) PK.toast(res.message, 'success')
    ctx.update()
    return res
  }
  const needImageProvider = (msg) =>
    PK.toast(msg || '还没有配置云端生图服务：先在「设置 · 模型与密钥 → 云端生成 → 云端生图」里选择服务商并填写 API Key', 'warn', {
      action: { label: '去配置云端生图', onClick: () => PK.open('keys', { tab: 'cloud', cat: 'image' }) },
      timeout: 9000,
    })
  const paintCoverJob = (entry) => {
    const m = entry && entry.els && entry.els.meter
    if (!m || !m.isConnected) return
    const bar = m.querySelector('.pk-meter-t i')
    if (bar) bar.style.width = `${U.clamp(U.num(entry.progress), 0, 100)}%`
    const l = m.querySelector('.pk-meter-l span')
    if (l) l.textContent = U.trimText(entry.message || 'AI 正在生成封面…', 48)
    const b = m.querySelector('.pk-meter-l b')
    if (b) b.textContent = `${Math.round(U.num(entry.progress))}%`
  }
  /** follow a background AI cover job (survives closing the panel; the open panel is refreshed when it ends) */
  const trackCoverJob = (dir, jobId, info = {}) => {
    const entry = { jobId, startedAt: Date.parse(info.startedAt || '') || Date.now(), progress: 6, message: '已提交，正在生成…', aspect: info.aspect || '', els: null }
    coverJobs.set(dir, entry)
    const refresh = () => {
      if (exportCtx && !exportCtx.frame.closed && PK.dir() === dir) loadCover(exportCtx, { quiet: true })
    }
    PK.job(jobId, {
      interval: 1200,
      onProgress: (job) => {
        entry.progress = Math.max(entry.progress, U.num(job.progress, entry.progress))
        entry.message = String(job.message || entry.message)
        paintCoverJob(entry)
      },
    })
      .then((res) => {
        coverJobs.delete(dir)
        PK.toast(
          res && res.reused ? '参数和上次一样：已直接复用上次生成的封面（没有重复扣费）' : `AI 封面生成好了${res && res.item && res.item.aspect ? `（${res.item.aspect}）` : ''}：在「AI 重新生成」的结果里点「设为封面」即可使用`,
          'success',
          { timeout: 8000 },
        )
        refresh()
      })
      .catch((err) => {
        coverJobs.delete(dir)
        PK.toast(`AI 封面生成失败：${String((err && err.message) || err)}`, 'error', {
          action: { label: '检查云端生图设置', onClick: () => PK.open('keys', { tab: 'cloud', cat: 'image' }) },
          timeout: 12000,
        })
        refresh()
      })
    return entry
  }

  /* ---- actions */
  const pickFrameCover = async (ctx) => {
    const pk = ctx.local.picker
    const v = pk && pk.video
    if (!v) throw new PK.Error('播放器还没准备好，请稍等')
    v.pause()
    await coverAct(ctx, 'frame', { timeSec: Number(v.currentTime) || 0 })
  }
  const deleteCover = async (ctx, file, what = '这张图片') => {
    const ok = await PK.confirm({ title: `删除${what}？`, text: '会从工程的 output/covers/ 里删除这个文件（不影响成片和已经生成的发布包）。', ok: '删除', danger: true })
    if (!ok) return
    await coverAct(ctx, 'delete', { file })
  }
  const writeCoverPrompt = async (ctx) => {
    const L = ctx.local
    const dir = PK.needProject()
    const d = coverDraft(dir)
    const cv = L.cv || {}
    const llmOk = Boolean((cv.llm && cv.llm.configured) || (PK.state && PK.state.status && PK.state.status.llm && PK.state.status.llm.configured))
    if (!llmOk) {
      PK.emit('need-llm', { error: '「AI 写提示词」需要先配置 AI 大模型接口（也可以直接自己写提示词）' })
      return
    }
    const eff = (cv.cover && cv.cover.effective) || {}
    try {
      const res = await PK.post(
        'publish-pack/cover',
        { projectDir: dir, action: 'ai-prompt', aspect: aiAspectOf(ctx), platform: L.platform, timeSec: hasNum(eff.timeSec) ? eff.timeSec : undefined, draft: d.prompt },
        { timeout: 150000 },
      )
      const next = String((res && res.prompt) || '').trim()
      if (!next) throw new PK.Error('AI 没有写出提示词，请再试一次')
      if (String(d.prompt || '').trim() && d.prompt.trim() !== next) d.prev = d.prompt
      d.prompt = next
      PK.toast('AI 已写好封面提示词，可以继续修改后再生成', 'success')
      ctx.render()
    } catch (err) {
      if (err && err.code === 'need-llm') {
        PK.emit('need-llm', { error: err.message })
        return
      }
      throw err
    }
  }
  const generateCover = async (ctx) => {
    const L = ctx.local
    const dir = PK.needProject()
    const cv = L.cv || {}
    const d = coverDraft(dir)
    const prov = cv.imageProvider || {}
    const prompt = String(d.prompt || '').trim()
    if (!prompt) throw new PK.Error('请先写封面描述（提示词），或点「AI 写提示词」让 AI 写一段')
    if (!prov.configured) {
      needImageProvider()
      return
    }
    if (coverJobs.has(dir)) throw new PK.Error('已经有一张封面正在生成，请等它完成')
    if (!coverCostOk) {
      const ok = await PK.confirm({
        title: '用 AI 生成封面？',
        text: `会调用你在「设置 · 云端生成」里配置的 ${prov.providerName || '云端生图服务'}${prov.model ? `（${prov.model}）` : ''}，按服务商的价格计费（用你自己的密钥）。同样的描述、比例和参考画面再次生成时，会直接复用上次的结果，不会重复扣费。`,
        ok: '生成封面',
      })
      if (!ok) return
      coverCostOk = true
    }
    const aspect = aiAspectOf(ctx)
    const ref = coverFileOf(cv)
    const useRef = Boolean(d.useRef && prov.supportsReference && ref)
    try {
      const res = await PK.post('publish-pack/cover', { projectDir: dir, action: 'ai-generate', prompt, aspect, useReference: useRef, referenceFile: useRef ? ref : '' }, { timeout: 120000 })
      if (res && res.jobId) trackCoverJob(dir, res.jobId, res.aiJob || { aspect })
      ctx.update()
    } catch (err) {
      if (err && err.code === 'no-image-provider') {
        needImageProvider(err.message)
        return
      }
      if (err && err.code === 'cover-job-running' && err.body && err.body.jobId) {
        trackCoverJob(dir, err.body.jobId, { aspect })
        ctx.update()
        return
      }
      throw err
    }
  }

  /* ---- 加标题：draw the title with the bundled Noto Sans SC on a canvas (image models write Chinese badly) */
  let coverFontP = null
  const loadCoverFont = () => {
    if (!coverFontP) {
      coverFontP = (async () => {
        if (typeof FontFace !== 'function' || !document.fonts) return false
        const face = new FontFace('DSH Cover Sans', `url("${PK.routeUrl('publish-pack/cover', { font: 'sans' })}")`, { weight: '100 900', style: 'normal' })
        await face.load()
        document.fonts.add(face)
        return true
      })().catch(() => false)
    }
    return coverFontP
  }
  const TITLE_POS = [
    { value: 'top', label: '上方' },
    { value: 'center', label: '居中' },
    { value: 'bottom', label: '下方' },
  ]
  const TITLE_STYLES = [
    { value: 'shadow', label: '白字黑边' },
    { value: 'yellow', label: '黄字黑边' },
    { value: 'band', label: '黑底横条' },
  ]
  /** big, legible title inside safe margins (the bottom avoids the platform caption area of portrait covers) */
  const drawTitledCover = (canvas, img, o) => {
    const W = img.naturalWidth || img.width
    const H = img.naturalHeight || img.height
    canvas.width = W
    canvas.height = H
    const g = canvas.getContext('2d')
    g.drawImage(img, 0, 0, W, H)
    const text = String(o.text || '').trim()
    if (!text) return
    const family = '"DSH Cover Sans", "Noto Sans SC", "Source Han Sans SC", sans-serif'
    const margin = Math.round(Math.min(W, H) * 0.07)
    const maxW = W - margin * 2
    let size = Math.max(12, Math.round(Math.min(W * 0.11, H * 0.12) * (o.scale || 1)))
    const minSize = Math.max(12, Math.round(Math.min(W, H) * 0.04))
    // wrap each paragraph into balanced lines (similar widths), breaking at a space when there is one near the cut
    const wrapPara = (para, limit) => {
      const chars = Array.from(para)
      const lines = []
      let cur = ''
      for (let i = 0; i < chars.length; i++) {
        const t = cur + chars[i]
        if (cur && g.measureText(t).width > limit) {
          const sp = cur.lastIndexOf(' ')
          if (sp > 0 && sp >= cur.length * 0.5) {
            lines.push(cur.slice(0, sp))
            cur = cur.slice(sp + 1) + chars[i]
          } else {
            lines.push(cur)
            cur = chars[i] === ' ' ? '' : chars[i]
          }
        } else cur = t
      }
      if (cur) lines.push(cur)
      return lines.map((l) => l.trim()).filter(Boolean)
    }
    const layout = (sz) => {
      g.font = `900 ${sz}px ${family}`
      const lines = []
      for (const para of text.split(/\r?\n/)) {
        const trimmed = para.trim()
        if (!trimmed) continue
        const n = wrapPara(trimmed, maxW).length
        const balanced = n > 1 ? Math.min(maxW, (g.measureText(trimmed).width / n) * 1.12) : maxW
        let ls = wrapPara(trimmed, balanced)
        if (ls.length > n) ls = wrapPara(trimmed, maxW)
        lines.push(...ls)
      }
      return lines.length ? lines : ['']
    }
    let lines = layout(size)
    while (lines.length > 3 && size > minSize) {
      size = Math.max(minSize, Math.round(size * 0.9))
      lines = layout(size)
    }
    const lh = Math.round(size * 1.2)
    const blockH = lh * lines.length
    const bottomSafe = Math.round(H * (H > W ? 0.17 : 0.1))
    const y0 = o.position === 'top' ? margin + Math.round(H * 0.02) : o.position === 'center' ? Math.round((H - blockH) / 2) : H - bottomSafe - blockH
    if (o.style === 'band') {
      g.fillStyle = 'rgba(0, 0, 0, 0.58)'
      g.fillRect(0, Math.max(0, y0 - Math.round(size * 0.35)), W, blockH + Math.round(size * 0.7))
    }
    g.textAlign = 'center'
    g.textBaseline = 'top'
    g.lineJoin = 'round'
    g.font = `900 ${size}px ${family}`
    lines.forEach((line, i) => {
      const y = y0 + i * lh
      if (o.style !== 'band') {
        g.lineWidth = Math.max(2, Math.round(size * 0.14))
        g.strokeStyle = 'rgba(0, 0, 0, 0.9)'
        g.strokeText(line, W / 2, y)
      }
      g.shadowColor = 'rgba(0, 0, 0, 0.45)'
      g.shadowBlur = Math.round(size * 0.12)
      g.shadowOffsetY = Math.round(size * 0.04)
      g.fillStyle = o.style === 'yellow' ? '#FFD84A' : '#FFFFFF'
      g.fillText(line, W / 2, y)
      g.shadowColor = 'transparent'
      g.shadowBlur = 0
      g.shadowOffsetY = 0
    })
  }
  const openTitleEditor = (ctx, file) => {
    const cv = ctx.local.cv || {}
    const st = PK.state || {}
    const o = { text: String(cv.title || (st.project && st.project.title) || '').slice(0, 40), position: 'bottom', style: 'shadow', scale: 1 }
    const f = PK.frame({ id: 'pt-cover-title', kind: 'modal', size: 'lg', title: '在封面上加标题', en: 'COVER TITLE · 本地合成' })
    const canvas = h('canvas', { style: { maxWidth: '100%', maxHeight: 'min(50vh, 600px)', display: 'block', margin: '0 auto', borderRadius: '6px' } })
    const img = new Image()
    let ready = false
    const redraw = () => {
      if (ready) drawTitledCover(canvas, img, o)
    }
    const fontNote = h('div')
    loadCoverFont().then((ok) => {
      if (!ok && fontNote.isConnected) PK.append(fontNote, ui.hint('随包字体没能加载，暂时用系统字体预览；保存的图片也会用系统字体。'))
      redraw()
    })
    img.onload = () => {
      ready = true
      redraw()
    }
    img.onerror = () => PK.toast('封面图片读取失败，请关闭后重试', 'error')
    img.src = PK.assetUrl(file)
    PK.append(
      f.body,
      ui.split(
        [h('div', { style: { background: 'var(--pk-bg3)', borderRadius: '8px', padding: '8px' } }, canvas), fontNote],
        [
          ui.field(
            { label: '标题文字', hint: '最多 40 个字，可以回车换行。字体：随包分发的 Noto Sans SC 粗体（开源可商用），中文清晰，不会像 AI 生图那样写错字。' },
            ui.textarea({ key: 'cv-title-text', value: o.text, rows: 2, minRows: 2, maxRows: 4, maxLength: 40, expand: false, onInput: (v) => {
              o.text = v
              redraw()
            } }),
          ),
          ui.field({ label: '位置', hint: '竖版封面的「下方」会避开平台底部的文字区' }, ui.seg({ value: o.position, options: TITLE_POS, onChange: (v) => {
            o.position = v
            redraw()
          } })),
          ui.field({ label: '样式' }, ui.seg({ value: o.style, options: TITLE_STYLES, onChange: (v) => {
            o.style = v
            redraw()
          } })),
          ui.field({ label: '字号' }, ui.slider({ value: 100, min: 60, max: 140, step: 5, format: (v) => `${v}%`, onInput: (v) => {
            o.scale = U.num(v, 100) / 100
            redraw()
          } })),
        ],
        { ratio: 'minmax(0, 1.25fr) minmax(0, 1fr)' },
      ),
    )
    f.setFoot([
      ui.hint('在本机合成，不调用 AI，原图不变'),
      ui.spacer(),
      ui.btn('取消', () => f.close('cancel'), { kind: 'ghost' }),
      ui.btn(
        '保存为封面',
        async () => {
          if (!ready) throw new PK.Error('封面图片还没加载好，请稍等')
          if (!String(o.text || '').trim()) throw new PK.Error('请先输入标题文字')
          await loadCoverFont()
          drawTitledCover(canvas, img, o)
          const dataUrl = canvas.toDataURL('image/png')
          await coverAct(ctx, 'title', { dataUrl, baseFile: file, text: o.text, position: o.position, style: o.style }, { timeout: 180000 })
          f.close('ok')
        },
        { kind: 'primary', icon: 'check', busyText: '保存中…' },
      ),
    ])
    return f
  }

  /* ---- render */
  const coverThumb = (file, alt) => h('img', { src: PK.assetUrl(file), alt: alt || '', loading: 'lazy', draggable: 'false', style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px', display: 'block' } })
  const coverCurrentCard = (ctx, cv) => {
    const cover = cv.cover || {}
    const eff = cover.effective || {}
    const mode = cover.mode || 'auto'
    const best = coverBest(cv)
    const file = eff.file || ''
    const url = file ? PK.assetUrl(file) : ''
    const pending = mode === 'auto' && !file && cv.auto && cv.auto.status === 'pending'
    let sub
    if (eff.missing) sub = '之前选的封面文件不见了：打包时会改用自动挑选的画面'
    else if (mode === 'auto')
      sub = pending
        ? '正在从成片里挑选最好的一帧…'
        : best
          ? `自动挑选 · 第 ${fmtSec(best.timeSec)}${best.labels && best.labels.length ? ` · ${best.labels.join('、')}` : ''}`
          : cv.auto && cv.auto.status === 'error'
            ? `自动挑选失败：${cv.auto.error || ''}`
            : cv.hasMp4
              ? '打包时自动挑选'
              : '渲染成片后会自动挑选'
    else if (mode === 'frame') sub = `选用的视频画面 · 第 ${fmtSec(cover.timeSec)}${eff.stale ? '（成片更新过：打包时会在同一时间点重新截取）' : ''}`
    else if (mode === 'ai') sub = `AI 生成 · ${cover.aspect || ''}${cover.provider ? ` · ${cover.provider}` : ''}`
    else sub = `加了标题「${U.trimText((cover.titleOverlay && cover.titleOverlay.text) || '', 20)}」`
    const aspect = mode === 'ai' || mode === 'title' ? cover.aspect : cv.video && cv.video.aspect
    const baseForTitle = mode === 'title' && cover.titleOverlay && cover.titleOverlay.baseFile ? cover.titleOverlay.baseFile : file
    const card = ui.card({
      key: 'cv-current',
      media: url ? ui.image(url, { fit: 'contain', alt: '发布包封面' }) : h('div.pk-media-empty', null, pending ? ui.spinner('挑选中') : PK.icon('image', 22)),
      aspect: aspectCss(aspect),
      badge: eff.missing ? '自动挑选' : COVER_MODE_LABEL[mode] || '自动挑选',
      title: '发布包封面 cover.png',
      sub,
      onClick: url ? () => lightbox(url, { title: '发布包封面', download: 'cover.png', caption: sub }) : null,
      actions: [
        url ? ui.btn('放大', () => lightbox(url, { title: '发布包封面', download: 'cover.png', caption: sub }), { size: 'sm', icon: 'expand' }) : null,
        url ? ui.btn('加标题', () => openTitleEditor(ctx, baseForTitle), { size: 'sm', icon: 'edit', title: '在封面上叠加大标题（本地合成，中文清晰）' }) : null,
        mode !== 'auto' ? ui.btn('恢复默认', () => coverAct(ctx, 'auto'), { size: 'sm', kind: 'ghost', icon: 'retry', busyText: '恢复中…', title: '改回自动挑选成片里最好的一帧' }) : null,
      ],
    })
    const m = card.querySelector('.pk-card-m')
    if (m) m.style.maxHeight = '340px'
    return card
  }
  const coverPacksInfo = (cv) => {
    const entries = Object.entries(cv.packs || {})
      .filter(([, v]) => v && v.usedAt)
      .sort((a, b) => String(b[1].usedAt).localeCompare(String(a[1].usedAt)))
      .slice(0, 5)
    if (!entries.length) return null
    return ui.field(
      { label: '最近的发布包用的封面', en: 'LAST PACKS' },
      ui.list(
        entries.map(([p, info]) => {
          const name = (platformOf(p) || { name: p }).name
          return ui.item({
            key: `cv-pack-${p}`,
            thumb: info.packFile ? coverThumb(info.packFile, `${name} 发布包封面`) : null,
            title: `${name}发布包`,
            sub: `${packCoverText(info)} · ${fmtFull(info.usedAt)}`,
            right: info.packFile ? [ui.iconBtn('eye', () => lightbox(PK.assetUrl(info.packFile), { title: `${name}发布包的封面 cover.png`, download: 'cover.png', caption: packCoverText(info) }), { title: '查看这个发布包里的封面' })] : null,
          })
        }),
        { dense: true },
      ),
    )
  }
  const coverTitledList = (ctx, cv) => {
    const list = Array.isArray(cv.titled) ? cv.titled : []
    if (!list.length) return null
    const cur = cv.cover && cv.cover.mode === 'title' ? cv.cover.file : ''
    return ui.field(
      { label: '加了标题的封面', en: 'WITH TITLE' },
      ui.grid(
        list.slice(0, 6).map((it) => {
          const on = it.file === cur
          return ui.card({
            key: `cv-titled-${it.file}`,
            media: ui.image(PK.assetUrl(it.file), { fit: 'cover', alt: it.text || '' }),
            aspect: aspectCss(it.aspect),
            title: it.text || '带标题的封面',
            active: on,
            onClick: () => lightbox(PK.assetUrl(it.file), { title: `加了标题的封面 · ${it.text || ''}`, download: 'cover.png' }),
            actions: [
              on ? ui.pill('当前封面', 'ok', { dot: true }) : ui.btn('设为封面', () => coverAct(ctx, 'select', { file: it.file }), { size: 'sm', busyText: '设置中…' }),
              on ? null : ui.iconBtn('trash', () => deleteCover(ctx, it.file, '这张带标题的封面'), { title: '删除' }),
            ],
          })
        }),
        { min: 110 },
      ),
    )
  }
  const coverAutoTab = (ctx, cv) => {
    const cands = coverCands(cv)
    const mode = (cv.cover && cv.cover.mode) || 'auto'
    const head = ui.hint('从成片 10%–80% 均匀取候选画面（再加上每段分镜中间最稳定的时刻），自动避开黑屏、淡入淡出、转场和模糊的画面，优先清晰、色彩饱满、对比好的一帧。成片更新后会重新挑选。')
    if (!cv.hasMp4) return [head, ui.empty({ icon: 'film', title: '还没有渲染成片', text: '渲染成片后，这里会自动挑选候选画面。' })]
    if (cv.auto && cv.auto.status === 'pending') return [head, ui.loading('正在从成片里挑选候选画面…（通常几秒）')]
    if (cv.auto && cv.auto.status === 'error') {
      return [head, ui.note(String(cv.auto.error || '未知错误'), { level: 'error', title: '自动挑选失败', actions: [ui.btn('重新挑选', () => coverAct(ctx, 'refresh-auto', {}, { toast: false }), { size: 'sm', icon: 'retry', busyText: '挑选中…' })] })]
    }
    if (!cands.length) return [head, ui.empty({ icon: 'image', title: '还没有候选画面', text: '打开面板时会自动挑选；如果一直没有，点「重新挑选」。' })]
    const grid = ui.grid(
      cands.map((c, i) => {
        const isBest = i === cv.auto.bestIndex
        const active = mode === 'auto' && isBest
        const badKey = c.rejected || (c.notes && c.notes[0])
        return ui.card({
          key: `cv-auto-${c.file}`,
          media: ui.image(PK.assetUrl(c.file), { fit: 'cover', alt: `第 ${fmtSec(c.timeSec)}` }),
          aspect: aspectCss(cv.video && cv.video.aspect),
          badge: isBest ? '推荐' : badKey ? BADGE_SHORT[badKey] || null : null,
          title: `第 ${fmtSec(c.timeSec)}`,
          sub: c.labels && c.labels.length ? c.labels.join(' · ') : `得分 ${Math.round(U.num(c.score))}`,
          active,
          onClick: () => lightbox(PK.assetUrl(c.file), { title: `候选画面 · 第 ${fmtSec(c.timeSec)}`, caption: (c.labels || []).join('、') }),
          actions: [
            active
              ? ui.pill('当前封面', 'ok', { dot: true })
              : ui.btn(isBest ? '用自动推荐' : '设为封面', () => (isBest ? coverAct(ctx, 'auto') : coverAct(ctx, 'select', { file: c.file })), { size: 'sm', kind: isBest ? 'primary' : 'secondary', busyText: '设置中…' }),
          ],
        })
      }),
      { min: 128 },
    )
    return [
      head,
      mode !== 'auto' ? ui.note('现在用的是你选的封面。点「用自动推荐」或左边的「恢复默认」可以改回自动挑选。', { level: 'info' }) : null,
      grid,
      ui.row([ui.spacer(), ui.btn('重新挑选', () => coverAct(ctx, 'refresh-auto', {}, { toast: false }), { size: 'sm', kind: 'ghost', icon: 'refresh', busyText: '挑选中…', title: '重新从成片里挑选候选画面' })]),
    ]
  }
  const paintReadout = (ctx) => {
    const L = ctx.local
    const el = L.readoutEl
    const v = L.picker && L.picker.video
    if (!el || !el.isConnected || !v) return
    const fps = U.num(L.cv && L.cv.video && L.cv.video.fps, 30) || 30
    const t = Number(v.currentTime) || 0
    const total = U.num(L.cv && L.cv.video && L.cv.video.frames)
    el.textContent = `${fmtClock(t)} · 第 ${Math.floor(t * fps + 1e-3) + 1} 帧${total ? ` / 共 ${total} 帧` : ''}`
  }
  /** the frame picker <video> is reused across re-renders (keeps the chosen moment) until the film changes */
  const framePicker = (ctx, cv) => {
    const L = ctx.local
    const src = filmSrc(ctx)
    const w = U.num(cv.video && cv.video.width)
    const hh = U.num(cv.video && cv.video.height)
    const key = `${src}|${w}x${hh}`
    if (L.picker && L.picker.key === key) return L.picker
    const wrap = ui.video(src, { poster: (PK.state && PK.state.preview && PK.state.preview.posterUrl) || undefined, aspect: w && hh ? `${w} / ${hh}` : '16 / 9', preload: 'auto' })
    if (w && hh && hh > w) {
      wrap.style.width = `min(100%, ${Math.round((300 * w) / hh)}px)`
      wrap.style.marginInline = 'auto'
    }
    const video = wrap.querySelector('video')
    if (video) {
      video.muted = true
      const onT = () => paintReadout(ctx)
      for (const ev of ['timeupdate', 'seeked', 'loadedmetadata', 'pause']) video.addEventListener(ev, onT)
    }
    L.picker = { key, wrap, video }
    return L.picker
  }
  const coverFrameTab = (ctx, cv) => {
    const L = ctx.local
    if (!cv.hasMp4) return ui.empty({ icon: 'film', title: '还没有渲染成片', text: '渲染成片后，就可以在这里选任意一帧做封面。' })
    const fps = U.num(cv.video && cv.video.fps, 30) || 30
    const dur = U.num(cv.video && cv.video.durationSec)
    const pk = framePicker(ctx, cv)
    const readout = h('b.pk-mono', null, '00:00.00 · 第 1 帧')
    L.readoutEl = readout
    const seekTo = (t) => {
      const v = pk.video
      if (!v) return
      v.pause()
      const max = (Number(v.duration) || dur || 0) - 0.5 / fps
      v.currentTime = U.clamp(Number(t) || 0, 0, Math.max(0, max))
    }
    const nudgeFrames = (n) => {
      const v = pk.video
      if (!v) return
      seekTo((Math.floor((Number(v.currentTime) || 0) * fps + 1e-3) + n + 0.5) / fps)
    }
    const nudgeSec = (s) => pk.video && seekTo((Number(pk.video.currentTime) || 0) + s)
    const quick = [
      ...coverCands(cv)
        .filter((c) => !c.rejected)
        .map((c) => ({ key: c.file, file: c.file, t: c.timeSec, label: fmtSec(c.timeSec) })),
      ...(Array.isArray(cv.sceneThumbs) ? cv.sceneThumbs : []).map((s) => ({ key: s.file, file: s.file, t: s.timeSec, label: s.title || s.sceneId })),
    ].slice(0, 24)
    const frames = (Array.isArray(cv.frames) ? cv.frames : []).slice(0, 6)
    const curFile = cv.cover && cv.cover.mode === 'frame' ? cv.cover.file : ''
    setTimeout(() => paintReadout(ctx), 0)
    return [
      ui.hint('播放或拖动进度条找到想要的画面，暂停后可以用 ±1 帧 / ±0.5 秒 微调，再点「用当前画面做封面」。截取的是原画质、和播放器里完全一样的那一帧。'),
      pk.wrap,
      ui.row(
        [
          readout,
          ui.spacer(),
          ui.btn('−0.5 秒', () => nudgeSec(-0.5), { size: 'sm', icon: 'chevL', title: '后退半秒' }),
          ui.btn('−1 帧', () => nudgeFrames(-1), { size: 'sm', title: '上一帧' }),
          ui.btn('+1 帧', () => nudgeFrames(1), { size: 'sm', title: '下一帧' }),
          ui.btn('+0.5 秒', () => nudgeSec(0.5), { size: 'sm', icon: 'chevR', title: '前进半秒' }),
        ],
        { wrap: true },
      ),
      ui.btn('用当前画面做封面', () => pickFrameCover(ctx), { kind: 'primary', icon: 'image', busyText: '截取中…', block: true }),
      quick.length
        ? ui.field(
            { label: '快速定位', en: 'QUICK PICKS', hint: '点一下跳到这个画面（自动候选与每段分镜的画面），可以再微调后设为封面' },
            ui.grid(
              quick.map((q) =>
                ui.card({
                  key: `cv-q-${q.key}`,
                  media: coverThumb(q.file, q.label),
                  aspect: aspectCss(cv.video && cv.video.aspect),
                  title: q.label,
                  onClick: () => seekTo(q.t + 0.5 / fps),
                }),
              ),
              { min: 92 },
            ),
          )
        : null,
      frames.length
        ? ui.field(
            { label: '最近选用的画面', en: 'RECENT PICKS' },
            ui.grid(
              frames.map((fr) => {
                const on = fr.file === curFile
                return ui.card({
                  key: `cv-fr-${fr.file}`,
                  media: coverThumb(fr.file, fmtSec(fr.timeSec)),
                  aspect: aspectCss(cv.video && cv.video.aspect),
                  title: `第 ${fmtSec(fr.timeSec)}`,
                  active: on,
                  onClick: () => seekTo(fr.timeSec + 0.5 / fps),
                  actions: [
                    on ? ui.pill('当前封面', 'ok', { dot: true }) : ui.btn('设为封面', () => coverAct(ctx, 'select', { file: fr.file }), { size: 'sm', busyText: '设置中…' }),
                    on ? null : ui.iconBtn('trash', () => deleteCover(ctx, fr.file, '这张选用的画面'), { title: '删除' }),
                  ],
                })
              }),
              { min: 120 },
            ),
          )
        : null,
    ]
  }
  const coverAiTab = (ctx, cv) => {
    const dir = PK.dir()
    const d = coverDraft(dir)
    const prov = cv.imageProvider || {}
    const job = coverJobs.get(dir)
    const aspect = aiAspectOf(ctx)
    const ref = coverFileOf(cv)
    const refOk = Boolean(prov.configured && prov.supportsReference && ref)
    const llmOk = Boolean((cv.llm && cv.llm.configured) || (PK.state && PK.state.status && PK.state.status.llm && PK.state.status.llm.configured))
    const curFile = cv.cover && cv.cover.mode === 'ai' ? cv.cover.file : ''
    let jobNode = null
    if (job) {
      const meter = ui.meter(job.progress, { label: U.trimText(job.message || 'AI 正在生成封面…', 48), valueText: `${Math.round(U.num(job.progress))}%` })
      job.els = { meter }
      jobNode = ui.stack([meter, ui.hint('生成时可以关掉这个面板，完成后结果会保存在工程的 output/covers/ 里，回来就能看到。')], { gap: 6 })
    }
    const results = Array.isArray(cv.ai) ? cv.ai : []
    return [
      prov.configured
        ? ui.row([ui.pill(`生图服务：${prov.providerName || prov.providerId}${prov.model ? ` · ${prov.model}` : ''}`, 'ok', { dot: true }), ui.hint('用你自己的密钥，按服务商价格计费')], { wrap: true })
        : ui.note('AI 生成封面要用你自己的云端生图服务（BYOK，按服务商价格计费）。先在「设置 · 模型与密钥 → 云端生成 → 云端生图」里选服务商并填写 API Key；提示词可以先写好。', {
            level: 'warn',
            title: '还没有配置云端生图服务',
            actions: [ui.btn('去配置云端生图', () => PK.open('keys', { tab: 'cloud', cat: 'image' }), { size: 'sm', kind: 'primary', icon: 'key' })],
          }),
      ui.field(
        {
          label: '封面描述（提示词）',
          en: 'PROMPT',
          hint: '可以随意修改。写清主体、构图、光影和风格；画面里不要文字——标题可以生成后点「加标题」叠加，中文更清晰。',
          aside: d.prev
            ? ui.btn('撤销 AI 改写', () => {
                const t = d.prompt
                d.prompt = d.prev
                d.prev = t
                ctx.render()
              }, { size: 'sm', kind: 'link' })
            : null,
        },
        ui.textarea({
          key: 'cv-ai-prompt',
          value: d.prompt,
          rows: 4,
          minRows: 3,
          maxRows: 12,
          maxLength: 2000,
          counter: true,
          placeholder: '例如：金色夕阳下的骑兵剪影冲上山岗，低角度仰拍，逆光，暖橙与深蓝撞色，电影级质感，上方留出干净天空放标题',
          onInput: (v) => (d.prompt = v),
          expand: { title: '封面描述（提示词）' },
        }),
      ),
      ui.row(
        [
          ui.btn('AI 写提示词', () => writeCoverPrompt(ctx), { icon: 'sparkle', busyText: 'AI 正在写…', title: llmOk ? '根据标题、主题、分镜和当前封面的画面写一段提示词' : '需要先配置 AI 大模型（设置 · 模型与密钥）' }),
          ui.hint(llmOk ? '根据标题、主题、分镜旁白和当前封面的画面来写，写好后可以再改' : '需要先在「设置 · 模型与密钥」配置 AI 大模型；也可以直接自己写'),
        ],
        { wrap: true },
      ),
      ui.field(
        { label: '封面比例', en: 'ASPECT', hint: `${ASPECT_FOR[aspect] || ''}${d.aspectTouched ? '' : '（按当前选的发布平台自动推荐）'}` },
        ui.seg({
          value: aspect,
          options: COVER_ASPECTS.map((a) => ({ value: a, label: a, hint: ASPECT_FOR[a] })),
          onChange: (v) => {
            d.aspect = v
            d.aspectTouched = true
            ctx.render()
          },
        }),
      ),
      ui.check({
        value: Boolean(d.useRef && refOk),
        disabled: !refOk,
        label: '参考当前封面的画面（图生图）',
        hint: !prov.configured ? '' : !prov.supportsReference ? `当前生图服务不支持参考图，只按提示词生成（${prov.referenceReason || ''}）` : !ref ? '还没有可参考的画面' : '让 AI 保留画面里的主体和构图',
        onChange: (v) => (d.useRef = v),
      }),
      jobNode || ui.btn('生成封面', () => generateCover(ctx), { kind: 'primary', size: 'lg', icon: 'wand', block: true, disabled: !prov.configured, busyText: '提交中…', title: prov.configured ? '' : '先配置云端生图服务' }),
      results.length
        ? ui.field(
            { label: 'AI 生成的封面', en: 'RESULTS', hint: '点「设为封面」后，生成发布包时就会用这张' },
            ui.grid(
              results.map((it) => {
                const on = it.file === curFile
                return ui.card({
                  key: `cv-ai-${it.file}`,
                  media: ui.image(PK.assetUrl(it.file), { fit: 'cover', alt: it.prompt || '' }),
                  aspect: aspectCss(it.aspect),
                  badge: it.aspect || null,
                  title: fmtFull(it.createdAt) || 'AI 封面',
                  sub: it.prompt || '',
                  active: on,
                  onClick: () => lightbox(PK.assetUrl(it.file), { title: `AI 封面 · ${it.aspect || ''}`, caption: it.prompt || '', download: 'cover.png' }),
                  actions: [
                    on ? ui.pill('当前封面', 'ok', { dot: true }) : ui.btn('设为封面', () => coverAct(ctx, 'select', { file: it.file }), { size: 'sm', kind: 'primary', busyText: '设置中…' }),
                    ui.iconBtn('copy', () => {
                      d.prompt = it.prompt || ''
                      ctx.render()
                      PK.toast('已把这张的提示词放回输入框，可以改一改再生成', 'info')
                    }, { title: '复用这张的提示词' }),
                    on ? null : ui.iconBtn('trash', () => deleteCover(ctx, it.file, '这张 AI 封面'), { title: '删除这张' }),
                  ],
                })
              }),
              { min: 140 },
            ),
          )
        : null,
    ]
  }
  const renderCoverSection = (ctx) => {
    const L = ctx.local
    const cv = L.cv
    const head = { title: '封面', en: 'COVER', icon: 'image', desc: '发布包里的 cover.png 用这里选定的封面：默认自动挑选成片里最好的一帧；也可以从视频里选一帧，或者让 AI 根据画面和主题重新生成。' }
    if (!cv) return ui.section(head, L.cvErr ? ui.errorBox(L.cvErr, () => loadCover(ctx)) : ui.loading('正在读取封面…'))
    const tab = COVER_TABS.some((t) => t.value === L.cvTab) ? L.cvTab : 'auto'
    let body
    try {
      body = tab === 'frame' ? coverFrameTab(ctx, cv) : tab === 'ai' ? coverAiTab(ctx, cv) : coverAutoTab(ctx, cv)
    } catch (err) {
      console.error('[PK] cover tab failed', err)
      body = ui.errorBox(err, () => ctx.render())
    }
    const job = coverJobs.get(PK.dir())
    return ui.section(
      { ...head, actions: job ? [ui.pill('AI 封面生成中', 'acc', { dot: true })] : null },
      ui.split(
        [coverCurrentCard(ctx, cv), coverPacksInfo(cv), coverTitledList(ctx, cv)],
        [
          ui.tabs({
            value: tab,
            items: COVER_TABS.map((t) => ({ ...t, badge: t.value === 'ai' && job ? '…' : t.value === 'ai' && Array.isArray(cv.ai) && cv.ai.length ? cv.ai.length : '' })),
            onChange: (v) => {
              L.cvTab = v
              ctx.render()
            },
          }),
          ...asArr(body),
        ],
        { ratio: 'minmax(0, 0.85fr) minmax(0, 1.6fr)' },
      ),
    )
  }

  const renderExport = (ctx) => {
    const L = ctx.local
    const st = PK.state || {}
    const pj = st.project || {}
    const pv = st.preview || {}
    const flags = st.projectFlags || {}
    const ap = (ctx.data && ctx.data.activeProject) || null
    const script = (ap && ap.script) || {}
    const hasMp4 = Boolean(pv.hasMp4)
    // the brand-kit default platform is only known once /state arrived — adopt it unless the user already picked one
    if (!L.platformTouched && ctx.data && !L.adoptedBrand) {
      L.adoptedBrand = true
      const p = exportDefaultPlatform(ctx)
      if (p !== L.platform) {
        L.platform = p
        L.result = packCache.get(packKey(p)) || null
      }
    }
    const plat = platformOf(L.platform) || PLATFORMS[0]
    const w = U.num(script.width || pj.width)
    const hh = U.num(script.height || pj.height)
    const asp = aspectOf(w, hh)
    const fps = U.num(script.fps || pj.fps)
    const dur = U.num(pv.durationSec || pj.durationSec || script.totalDurationSec)
    const title = String(script.title || pj.title || '')
    const qa = ap && ap.qaReport
    const hasSnap = Boolean((ap && ap.hasSnapshot) || flags.hasSnapshot)
    const hasQa = Boolean(qa || flags.hasQaReport)
    const sec = elapsedSec(L)
    L.tickEls = []
    const tickText = (el, fmt) => {
      if (el) L.tickEls.push([el, fmt])
    }

    const prev = !L.busy && !L.result && hasMp4 ? probePrevPack(ctx, plat.value) : null
    const genBtn = ui.btn(L.busy ? `打包中… ${sec} 秒` : L.result || prev ? '重新生成发布包' : '生成发布包', () => generatePack(ctx), { kind: 'primary', icon: 'box', disabled: !hasMp4 || L.busy })
    if (L.busy) tickText(genBtn.querySelector('.pk-btn-l'), (s) => `打包中… ${s} 秒`)
    ctx.foot([
      ui.hint(hasMp4 ? `导出到工程文件夹 publish/${plat.value}-pack/（同一平台再次生成会覆盖旧文件）` : '先渲染成片，才能生成发布包'),
      ui.spacer(),
      genBtn,
    ])

    const goRender = () => {
      ctx.close()
      PK.open('studio', { step: 'delivery' })
    }
    const fitBad = hasMp4 && plat.fit && asp && !plat.fit.includes(asp)
    const cvMode = (L.cv && L.cv.cover && L.cv.cover.mode) || 'auto'
    const coverSub =
      cvMode === 'frame'
        ? `用你选的视频画面（第 ${fmtSec(L.cv.cover.timeSec)}）`
        : cvMode === 'ai'
          ? `用你选的 AI 封面（${(L.cv.cover && L.cv.cover.aspect) || ''}）`
          : cvMode === 'title'
            ? '用你加了标题的封面'
            : '自动挑选成片里最清晰、最好看的一帧（避开黑屏和转场）；可在下方「封面」里改'
    const contents = [
      { icon: 'film', title: '成片 MP4', sub: hasMp4 ? `${slugOf(title)}.mp4 · 原画质拷贝${w && hh ? ` · ${w}×${hh}` : ''}` : '需要先渲染成片', ok: hasMp4 },
      { icon: 'image', title: '封面图 cover.png', sub: coverSub, ok: hasMp4 },
      { icon: 'grid', title: '3×3 九宫格 snapshot-3x3.png', sub: hasSnap ? '成片抽帧验收墙，适合预告和审片' : '暂无：渲染成片时会自动生成', ok: hasSnap },
      { icon: 'check', title: '质检报告 qa_report.json', sub: hasQa ? `自动化质检${qaSummary(qa) ? ` · ${qaSummary(qa)}` : ''}` : '暂无：渲染成片后会自动质检', ok: hasQa },
      { icon: 'prompt', title: '发布说明 meta.md', sub: '3 个推荐标题 · 话题标签 · AI 合成合规声明 · 文件清单', ok: hasMp4 },
    ]

    const top = ui.split(
      [
        ui.section(
          { title: '成片', en: 'FINAL MP4', icon: 'film' },
          hasMp4
            ? exportPlayer(ctx, filmSrc(ctx), pv.posterUrl, w, hh)
            : ui.empty({
                icon: 'film',
                title: '还没有渲染成片',
                text: '发布包需要一条渲染好的 MP4 成片。去「分步精修 → 交付」点「渲染成片」，完成后回到这里一键打包。',
                actions: [ui.btn('去渲染成片', goRender, { kind: 'primary', icon: 'arrowR' })],
              }),
          ui.kv([
            ['标题', title || '—'],
            ['画面', w && hh ? `${w} × ${hh}${asp ? `（${asp}）` : ''}` : '—'],
            ['帧率', fps ? `${fps} fps` : '—'],
            ['时长', dur ? U.fmtDur(dur) : '—'],
          ]),
        ),
      ],
      [
        ui.section(
          { title: '发布平台', en: 'PLATFORM PRESET', icon: 'target', desc: '选择要发布的平台：推荐标题、话题标签和合规清单会按平台整理好，文件放在工程的 publish/<平台>-pack/ 文件夹里。' },
          ui.chips({
            value: L.platform,
            disabled: L.busy,
            options: PLATFORMS.map((p) => ({ value: p.value, label: p.label, hint: p.hint })),
            onChange: (v) => {
              selectPlatform(ctx, v)
              ctx.render()
            },
          }),
          ui.hint(`${plat.name}：${plat.hint}`),
          fitBad
            ? ui.note(`当前成片是 ${asp}（${w}×${hh}），${plat.name}更推荐 ${plat.fit.join(' / ')}。照样可以打包；想要最佳观感，可在「导演参数」改画幅后重新出片。`, {
                level: 'warn',
                actions: [
                  ui.btn('去改画幅', () => {
                    ctx.close()
                    PK.open('studio', { step: 'director' })
                  }, { size: 'sm', icon: 'arrowR' }),
                ],
              })
            : null,
        ),
        // once a pack is shown, its real 文件清单 replaces this preview list (and the result sits right under the platforms)
        L.result
          ? null
          : ui.section(
              { title: '发布包里会有', en: 'CONTENTS', icon: 'box' },
              ui.list(contents.map((c) => ui.item({ key: `pk-c-${c.icon}`, icon: c.icon, title: c.title, body: ui.hint(c.sub), right: [ui.pill(c.ok ? '会包含' : '暂缺', c.ok ? 'ok' : 'mute', { dot: true })] })), { dense: true }),
            ),
      ],
      { ratio: 'minmax(0, 1fr) minmax(0, 1.15fr)' },
    )

    let bottom = null
    if (L.busy) {
      const meter = ui.meter(0, { indeterminate: true, label: `正在为「${plat.name}」打包发布资料`, valueText: `已用时 ${sec} 秒` })
      tickText(meter.querySelector('.pk-meter-l b'), (s) => `已用时 ${s} 秒`)
      bottom = ui.section(
        { title: '正在打包', en: 'PACKING', icon: 'box' },
        meter,
        ui.hint('正在复制成片、截取封面、整理九宫格与质检报告，并写入推荐标题、话题标签和 AI 合规声明。成片越大复制越久，通常几秒到半分钟。'),
      )
    } else if (L.result) {
      bottom = renderPackResult(ctx, L.result)
      if (L.scrollToResult) {
        // just generated: bring the result into view (the drawer is narrow, the result starts below the fold)
        L.scrollToResult = false
        const anchor = asArr(bottom)[0]
        setTimeout(() => anchor && anchor.isConnected && anchor.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80)
      }
    } else if (hasMp4 && prev) {
      const base = `publish/${plat.value}-pack`
      bottom = ui.section(
        {
          title: `工程里已有「${plat.name}」发布包`,
          en: 'LAST PACK',
          icon: 'box',
          desc: '这是以前生成的发布包，文件还在工程文件夹里。点右下角「重新生成发布包」（几秒钟，会覆盖旧文件），这里就会显示推荐标题、话题标签、AI 合规声明和全部文件。',
        },
        ui.grid(
          [
            imgCard('上次的封面 cover.png', prev.cover, 'cover.png'),
            ui.stack([
              ui.kv([['文件夹', h('span.pk-mono', null, `${base}/`)]]),
              ui.row(
                [
                  linkBtn('下载 meta.md', PK.assetUrl(`${base}/meta.md`), { download: 'meta.md', icon: 'download' }),
                  linkBtn('下载封面', prev.cover, { download: 'cover.png', icon: 'download' }),
                ],
                { wrap: true },
              ),
            ]),
          ],
          { min: 200 },
        ),
      )
    } else if (hasMp4) {
      bottom = ui.empty({
        icon: 'box',
        title: `还没有生成「${plat.name}」发布包`,
        text: '点右下角「生成发布包」，几秒后这里会显示封面、九宫格、推荐标题、话题标签、AI 合规声明和全部文件，方便直接复制去发布。以前生成过的发布包也保存在工程的 publish/ 文件夹里。',
      })
    }
    let coverNode
    try {
      coverNode = renderCoverSection(ctx)
    } catch (err) {
      console.error('[PK] cover section failed', err)
      coverNode = ui.section({ title: '封面', en: 'COVER', icon: 'image' }, ui.errorBox(err, () => ctx.render()))
    }
    return [
      top,
      L.error && !L.busy ? ui.note(String(L.error.message || L.error), { level: 'error', title: '打包失败', actions: [ui.btn('重试', () => generatePack(ctx), { size: 'sm', icon: 'retry' })] }) : null,
      coverNode,
      ...asArr(bottom),
    ]
  }

  PK.panel('export', {
    title: '发布包导出',
    en: 'PUBLISH PACK · MP4 · 封面 · 九宫格 · 质检 · 标题话题',
    idx: 'PK',
    icon: 'box',
    kind: 'modal',
    size: 'lg',
    group: 'tools',
    order: 60,
    desc: '一键打包成片、封面、九宫格、质检报告与推荐标题话题',
    needsProject: true,
    aliases: { pack: {}, publish: {}, publishPack: {}, 'publish-pack': {} },
    watch: (st) => {
      const pv = (st && st.preview) || {}
      const pj = (st && st.project) || {}
      const fl = (st && st.projectFlags) || {}
      return [pj.dir, pj.title, pj.width, pj.height, pv.hasMp4, pv.mp4Url, fl.hasSnapshot, fl.hasQaReport]
    },
    onWatch(ctx) {
      if (!PK.hasProject()) return ctx.close()
      const L = ctx.local
      if (L.dir !== PK.dir()) {
        L.dir = PK.dir()
        L.platformTouched = false
        L.adoptedBrand = false
        L.platform = exportDefaultPlatform(ctx)
        L.result = packCache.get(packKey(L.platform)) || null
        L.error = null
        // another project: forget its cover state and players
        L.cv = null
        L.cvErr = null
        L.cvTab = ''
        L.picker = null
        L.player = null
        loadCover(ctx)
      } else {
        // host data refresh (a new render, a pack, a cover change …): re-read the cover state quietly
        clearTimeout(L.cvWatchT)
        L.cvWatchT = setTimeout(() => {
          if (!ctx.frame.closed) loadCover(ctx, { quiet: true })
        }, 400)
      }
      ctx.load()
      return undefined
    },
    mount(ctx) {
      guardIme(ctx)
      const L = ctx.local
      L.dir = PK.dir()
      L.platform = exportDefaultPlatform(ctx)
      L.platformTouched = Boolean(platformOf(ctx.args && ctx.args.platform))
      L.result = packCache.get(packKey(L.platform)) || null
      L.cvTab = ['auto', 'frame', 'ai'].includes(ctx.args && ctx.args.coverTab) ? ctx.args.coverTab : ''
      exportCtx = ctx
      ctx.onCleanup(() => {
        if (exportCtx === ctx) exportCtx = null
        clearTimeout(L.cvPollT)
        clearTimeout(L.cvWatchT)
        const v = L.picker && L.picker.video
        if (v) v.pause()
      })
      loadCover(ctx)
      ctx.load()
    },
    onArgs(ctx, a) {
      if (a && platformOf(a.platform) && !ctx.local.busy) selectPlatform(ctx, a.platform)
      if (a && ['auto', 'frame', 'ai'].includes(a.coverTab)) ctx.local.cvTab = a.coverTab
      ctx.render()
    },
    render: renderExport,
  })

  /* ================================================================================================
   * 品牌套件 · BRAND KIT
   * ================================================================================================ */
  const BRAND_DEFAULTS = Object.freeze({
    brandName: '',
    tagline: '',
    primaryColor: '#F5B942',
    accentColor: '#22D3EE',
    backgroundColor: '#070B16',
    logoPath: '',
    watermarkText: '',
    defaultStyle: 'cinematic',
    defaultPlatform: 'universal',
  })
  const BRAND_KEYS = Object.keys(BRAND_DEFAULTS)
  const HEX_RE = /^#[0-9a-f]{3,8}$/i
  const pickKit = (kit) => {
    const o = {}
    for (const k of BRAND_KEYS) o[k] = kit && kit[k] !== undefined && kit[k] !== null ? String(kit[k]) : BRAND_DEFAULTS[k]
    return o
  }
  const PALETTES = [
    { value: 'amber', label: '琥珀夜幕', colors: ['#F5B942', '#22D3EE', '#070B16'] },
    { value: 'ion', label: '离子青', colors: ['#3BE7FF', '#FF4FD8', '#0B1030'] },
    { value: 'ink', label: '墨韵朱砂', colors: ['#D4A64A', '#C8361D', '#0E0D0B'] },
    { value: 'prism', label: '棱镜白', colors: ['#2F37FF', '#E8462A', '#F2F1EC'] },
    { value: 'mint', label: '清新薄荷', colors: ['#10B981', '#0EA5E9', '#F0FDF4'] },
    { value: 'mono', label: '极简黑白', colors: ['#111111', '#E8462A', '#FFFFFF'] },
  ]
  const matchPalette = (f) => {
    const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()
    const p = PALETTES.find((x) => same(x.colors[0], f.primaryColor) && same(x.colors[1], f.accentColor) && same(x.colors[2], f.backgroundColor))
    return p ? p.value : ''
  }
  const safeHex = (v, d) => (HEX_RE.test(String(v || '')) ? String(v) : d)
  const hexRgb = (hex) => {
    let s = String(hex || '').replace('#', '')
    if (s.length === 3 || s.length === 4) s = s.split('').map((c) => c + c).join('')
    const n = parseInt(s.slice(0, 6), 16)
    return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : null
  }
  const isLight = (hex) => {
    const c = hexRgb(hex)
    return c ? (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 > 0.6 : false
  }
  /** displayable URL for a stored logo path (workspace .skins store, project file, or legacy URL) */
  const logoSrc = (p) => {
    const s = String(p || '').trim()
    if (!s) return ''
    if (/^\/api\/video-workbench\//.test(s)) return s
    const n = normPath(s)
    const m = /\/\.skins\/([^/]+)$/.exec(n)
    if (m) return PK.routeUrl('skin', { name: m[1] })
    const rel = relInProject(s)
    if (rel) return PK.assetUrl(rel)
    if (!isAbsPath(s) && PK.dir()) return PK.assetUrl(n)
    return ''
  }
  const brandDirty = (L) => Boolean(L.form) && JSON.stringify(L.form) !== L.saved

  const paintBrandPreview = (el, f) => {
    if (!el) return
    PK.clear(el)
    const bg = safeHex(f.backgroundColor, BRAND_DEFAULTS.backgroundColor)
    const pc = safeHex(f.primaryColor, BRAND_DEFAULTS.primaryColor)
    const ac = safeHex(f.accentColor, BRAND_DEFAULTS.accentColor)
    const light = isLight(bg)
    const src = logoSrc(f.logoPath)
    const name = String(f.brandName || '').trim()
    const tag = String(f.tagline || '').trim()
    const wm = String(f.watermarkText || '').trim()
    const dim = light ? 'rgba(0,0,0,.42)' : 'rgba(255,255,255,.45)'
    PK.append(
      el,
      h(
        'div',
        {
          role: 'img',
          'aria-label': '片尾品牌卡预览',
          style: { position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: '10px', overflow: 'hidden', background: bg, containerType: 'inline-size', boxShadow: 'inset 0 0 0 1px rgba(127,127,127,.28)' },
        },
        h(
          'div',
          { style: { position: 'absolute', left: '0', right: '0', top: '0', bottom: '17%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2.2cqw', padding: '4cqw 6cqw 0', overflow: 'hidden', textAlign: 'center' } },
          src
            ? h('img', { src, alt: '品牌 Logo', draggable: 'false', style: { maxHeight: '21cqw', maxWidth: '46%', objectFit: 'contain', display: 'block', flex: 'none' } })
            : h('span', { style: { width: '13cqw', height: '13cqw', borderRadius: '3cqw', background: pc, display: 'block', flex: 'none', opacity: '0.92' } }),
          h('b', { title: name || '品牌名称', style: { maxWidth: '100%', color: name ? pc : dim, fontSize: 'clamp(13px, 6.2cqw, 44px)', lineHeight: '1.2', fontWeight: '800', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 'none' } }, name || '品牌名称'),
          h('i', { style: { display: 'block', width: '16cqw', height: '3px', borderRadius: '3px', background: ac, flex: 'none' } }),
          h('span', { title: tag || '品牌标语', style: { maxWidth: '100%', color: tag ? ac : dim, fontSize: 'clamp(11px, 2.9cqw, 20px)', lineHeight: '1.45', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden', flex: 'none' } }, tag || '品牌标语'),
        ),
        h(
          'div',
          { style: { position: 'absolute', left: '4cqw', right: '4cqw', bottom: '0', height: '17%', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: '0' } },
          wm ? h('span', { title: wm, style: { maxWidth: '100%', color: light ? 'rgba(0,0,0,.58)' : 'rgba(255,255,255,.66)', fontSize: 'clamp(10px, 2.3cqw, 15px)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, wm) : null,
        ),
      ),
    )
  }
  const syncBrandDirty = (ctx) => {
    const L = ctx.local
    if (!L.dirtyEl) return
    const dirty = brandDirty(L)
    L.dirtyEl.textContent = dirty ? '● 有未保存的修改（点「保存品牌套件」生效）' : L.updatedAt ? `已保存 · ${U.fmtTime(L.updatedAt)}` : '还没有保存过品牌套件'
  }
  const brandChanged = (ctx) => {
    const L = ctx.local
    paintBrandPreview(L.previewEl, L.form)
    syncBrandDirty(ctx)
    // keep the 一键配色 highlight honest after a manual colour edit (swap just that row; the colour pickers stay open)
    if (L.paletteEl && L.paletteEl.isConnected && typeof L.makePalette === 'function' && matchPalette(L.form) !== L.paletteVal) {
      const next = L.makePalette()
      L.paletteEl.replaceWith(next)
      L.paletteEl = next
    }
  }

  const loadBrandKit = async (ctx) => {
    const L = ctx.local
    L.kitError = null
    try {
      const d = await PK.get('brand-kit', PK.dir() ? { projectDir: PK.dir() } : undefined)
      const kit = (d && d.brandKit) || {}
      L.form = pickKit(kit)
      L.saved = JSON.stringify(L.form)
      L.updatedAt = kit.updatedAt || ''
      L.kitDir = PK.dir()
    } catch (err) {
      L.kitError = err
    }
    ctx.update()
  }

  const saveBrand = async (ctx) => {
    const L = ctx.local
    const f = L.form
    if (!f) return
    for (const [k, label] of [
      ['primaryColor', '主色'],
      ['accentColor', '强调色'],
      ['backgroundColor', '背景色'],
    ]) {
      if (!HEX_RE.test(String(f[k] || ''))) throw new PK.Error(`${label}「${f[k] || '空'}」不是有效的颜色，请填写类似 #F5B942 的色值`)
    }
    const brandKit = { ...f, brandName: String(f.brandName).trim(), tagline: String(f.tagline).trim(), watermarkText: String(f.watermarkText).trim(), logoPath: String(f.logoPath).trim() }
    const body = { brandKit }
    if (PK.dir()) body.projectDir = PK.dir()
    const d = await PK.post('brand-kit', body)
    const kit = (d && d.brandKit) || brandKit
    L.form = pickKit(kit)
    L.saved = JSON.stringify(L.form)
    L.updatedAt = kit.updatedAt || new Date().toISOString()
    L.kitDir = PK.dir()
    PK.toast(PK.dir() ? '品牌套件已保存：所有工程通用，并已写入当前工程' : '品牌套件已保存：所有工程通用', 'success')
    ctx.render()
  }

  const resetBrand = async (ctx) => {
    const ok = await PK.confirm({ title: '恢复默认值？', text: '把表单里的品牌名、标语、配色、Logo、水印和默认设置恢复为初始值。点「保存品牌套件」之前不会真正生效。', ok: '恢复默认值' })
    if (!ok) return
    ctx.local.form = { ...BRAND_DEFAULTS }
    ctx.render()
  }

  const brandMarksOf = (data) => {
    const ap = data && data.activeProject
    return ((ap && ap.assets) || []).filter((a) => a && a.role === 'brand_mark')
  }

  const addLogoToProject = async (ctx) => {
    const L = ctx.local
    const dir = PK.needProject()
    const p = String((L.form && L.form.logoPath) || '').trim()
    if (!p || !isAbsPath(p)) throw new PK.Error('请先上传或选择一个 Logo 图片')
    const data = ctx.data || (await PK.store.load().catch(() => null))
    const marks = brandMarksOf(data)
    const d = await PK.post('assets/import', { projectDir: dir, sources: [p], role: 'brand_mark' })
    const added = [...((d && d.added) || []), ...((d && d.existing) || [])]
    if (!added.length) throw new PK.Error('Logo 没能加入工程素材库（文件可能已被移动或删除），请重新上传')
    // the renderers use the FIRST brand_mark asset → demote older marks so the new logo really takes effect
    for (const m of marks) if (!added.some((a) => a.id === m.id)) await PK.post('assets/role', { projectDir: dir, assetId: m.id, role: 'image' })
    PK.store.invalidate()
    PK.toast('Logo 已加入当前工程素材库（品牌标识）：AI 出片时片中的品牌角标与片尾落版会使用它', 'success')
    await ctx.load(true)
  }

  const uploadLogo = async (ctx) => {
    const L = ctx.local
    const files = await PK.pickFiles({ accept: 'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg' })
    const file = files[0]
    if (!file) return
    if (U.kindOfFile(file.name, file.type) !== 'image') throw new PK.Error('Logo 需要是图片文件（PNG / JPG / WEBP / SVG）')
    if (file.size > 10 * 1048576) throw new PK.Error(`Logo 图片太大（${U.fmtBytes(file.size)}），请压缩到 10 MB 以内再上传`)
    const data = ctx.data || (await PK.store.load().catch(() => null))
    const res = await PK.upload('skin/upload', file, { query: { fileName: file.name } })
    const ws = data && data.workspaceRoot
    L.form.logoPath = ws && res && res.name ? joinPath(ws, '.skins', res.name) : String((res && res.url) || '')
    ctx.render()
    PK.toast('Logo 已上传（点「保存品牌套件」后生效）', 'success')
    if (PK.hasProject() && isAbsPath(L.form.logoPath)) {
      const marks = brandMarksOf(ctx.data)
      const ok = await PK.confirm({
        title: '同时用到当前工程里？',
        text: `把这个 Logo 加入当前工程素材库作为「品牌标识」，AI 出片时片中的品牌角标和片尾落版就会使用它。${marks.length ? `（当前的品牌标识「${marks.map((m) => m.originalName || m.name).join('、')}」会变回普通图片素材，文件不会删除）` : ''}`,
        ok: '加入当前工程',
        cancel: '暂不',
      })
      if (ok) await addLogoToProject(ctx)
    }
  }

  const pickProjectLogo = async (ctx, anchor) => {
    const data = ctx.data || (await PK.store.load())
    const ap = (data && data.activeProject) || {}
    const imgs = (ap.assets || []).filter((a) => a && a.type === 'image')
    if (!imgs.length) throw new PK.Error('当前工程还没有图片素材，请直接点「上传 Logo」')
    const grid = h(
      'div',
      { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: '8px', padding: '4px' } },
      imgs.map((a) =>
        ui.card({
          key: `bk-pick-${a.id}`,
          media: ui.image(PK.assetUrl(a.path), { fit: 'contain', alt: a.originalName || a.name || '' }),
          aspect: '1 / 1',
          title: a.originalName || a.name || U.baseName(a.path),
          active: a.role === 'brand_mark',
          onClick: () => {
            PK.closePop()
            ctx.local.form.logoPath = joinPath(ap.projectDir || PK.dir(), a.path)
            ctx.render()
          },
        }),
      ),
    )
    PK.popover(anchor, h('div', null, h('div.pk-menu-g', null, '选一张图片作为 Logo（透明底 PNG / SVG 效果最好）'), grid), { width: 380, minWidth: 280 })
  }

  const exportMotionMd = async (ctx) => {
    const L = ctx.local
    const dir = PK.needProject()
    if (brandDirty(L)) {
      const ok = await PK.confirm({ title: '先保存品牌套件？', text: 'MOTION.md 会写入「已保存」的品牌信息。你有还没保存的修改，先保存再导出吗？', ok: '保存并导出' })
      if (!ok) return
      await saveBrand(ctx)
    }
    const d = await PK.post('motion-md', { projectDir: dir })
    L.motion = { content: String((d && d.content) || ''), rel: (d && d.relPath) || 'MOTION.md', at: Date.now(), dir }
    PK.toast(`已导出可跨智能体复用的分镜蓝图：${L.motion.rel}`, 'success')
    ctx.render()
  }

  const applyBrandDefaults = async (ctx) => {
    PK.needProject()
    const f = ctx.local.form
    const opts = (PK.state && PK.state.options) || {}
    const patch = {}
    const styles = (opts.styles || opts.styleCards || []).map((o) => o.value)
    if (styles.includes(f.defaultStyle)) patch.style = f.defaultStyle
    const plats = (opts.platforms || []).map((o) => o.value)
    const platOk = plats.includes(f.defaultPlatform)
    if (platOk) patch.targetPlatform = f.defaultPlatform
    if (!Object.keys(patch).length) throw new PK.Error('默认风格 / 平台不在导演参数的可选范围内，请换一个再试')
    await PK.action('setDirector', { patch })
    const styleName = patch.style ? PK.optionLabel('styles', patch.style) : ''
    const platName = patch.targetPlatform ? PK.optionLabel('platforms', patch.targetPlatform) : ''
    PK.toast(`已套用到当前工程的导演参数：${[styleName ? `风格「${styleName}」` : '', platName ? `目标平台「${platName}」` : ''].filter(Boolean).join(' · ')}（下次出片生效）`, 'success')
    if (!platOk) PK.toast(`「${(platformOf(f.defaultPlatform) || {}).name || f.defaultPlatform}」没有专门的出片安全区预设，目标平台保持不变（发布包仍可按该平台导出）`, 'info')
    ctx.update()
  }

  const renderBrand = (ctx) => {
    const L = ctx.local
    if (!L.form) {
      ctx.foot(null)
      return L.kitError ? ui.errorBox(L.kitError, () => loadBrandKit(ctx)) : ui.loading('正在读取品牌套件…')
    }
    const f = L.form
    const st = PK.state || {}
    const opts = st.options || {}
    const dir = (st.director || {})
    const data = ctx.data || null
    const hasProject = PK.hasProject()
    const styleOpts = (opts.styleCards && opts.styleCards.length ? opts.styleCards : opts.styles || []).map((o) => ({ value: o.value, label: o.label, hint: o.hint, swatch: o.swatch }))
    if (!styleOpts.some((o) => o.value === f.defaultStyle) && f.defaultStyle) styleOpts.push({ value: f.defaultStyle, label: f.defaultStyle })

    // ---- footer (dirty indicator is updated in place while typing — never re-render the form per keystroke)
    L.dirtyEl = h('span.pk-hint', { role: 'status' })
    syncBrandDirty(ctx)
    ctx.foot([L.dirtyEl, ui.spacer(), ui.btn('恢复默认值', () => resetBrand(ctx), { kind: 'ghost', icon: 'retry' }), ui.btn('保存品牌套件', () => saveBrand(ctx), { kind: 'primary', icon: 'check', busyText: '保存中…' })])

    const set = (k) => (v) => {
      f[k] = v
      brandChanged(ctx)
    }
    const infoSec = ui.section(
      { title: '品牌信息', en: 'IDENTITY', icon: 'brand', desc: '品牌套件对所有工程通用：会写进每个工程的 MOTION.md 分镜蓝图，供 AI 智能体制作和复刻时参考。' },
      ui.field({ label: '品牌名称', en: 'NAME', hint: '最多 60 字' }, ui.input({ key: 'bk-name', value: f.brandName, maxLength: 60, placeholder: '例如：山河影像工作室', onInput: set('brandName') })),
      ui.field({ label: '品牌标语', en: 'TAGLINE', hint: '一句话介绍你的品牌，最多 120 字' }, ui.textarea({ key: 'bk-tagline', value: f.tagline, rows: 2, minRows: 2, maxRows: 6, maxLength: 120, placeholder: '例如：把历史剪成热血', expand: { title: '品牌标语' }, onInput: set('tagline') })),
      ui.field({ label: '水印文字', en: 'WATERMARK', hint: '例如账号名或版权署名，最多 48 字' }, ui.input({ key: 'bk-wm', value: f.watermarkText, maxLength: 48, placeholder: '例如：@山河影像 · AI 辅助创作', onInput: set('watermarkText') })),
    )
    const colorField = (key, label, en) => ui.field({ label, en }, ui.color({ value: f[key], onChange: set(key) }))
    L.makePalette = () => {
      L.paletteVal = matchPalette(f)
      return ui.chips({
        value: L.paletteVal,
        options: PALETTES.map((p) => ({ value: p.value, label: p.label, hint: p.colors.join(' · '), swatch: `linear-gradient(90deg, ${p.colors[0]} 0 34%, ${p.colors[1]} 34% 67%, ${p.colors[2]} 67%)` })),
        onChange: (v) => {
          const p = PALETTES.find((x) => x.value === v)
          if (!p) return
          f.primaryColor = p.colors[0]
          f.accentColor = p.colors[1]
          f.backgroundColor = p.colors[2]
          ctx.render()
        },
      })
    }
    L.paletteEl = L.makePalette()
    const colorSec = ui.section(
      { title: '品牌配色', en: 'COLORS', icon: 'brush', desc: '主色用于品牌名和重点文字，强调色用于点缀线条和标语，背景色是片头片尾的底色。' },
      ui.grid([colorField('primaryColor', '主色', 'PRIMARY'), colorField('accentColor', '强调色', 'ACCENT'), colorField('backgroundColor', '背景色', 'BACKGROUND')], { min: 160 }),
      ui.field({ label: '一键配色', en: 'PRESETS', hint: '点一下套用整套配色，之后仍可单独微调' }, L.paletteEl),
    )
    const curStyle = dir.style ? PK.optionLabel('styles', dir.style) : ''
    const curPlat = dir.targetPlatform ? PK.optionLabel('platforms', dir.targetPlatform) : ''
    const defSec = ui.section(
      { title: '默认设置', en: 'DEFAULTS', icon: 'settings', desc: '「发布包导出」会默认选中这里的平台；点「套用到当前工程」可以把默认风格和平台写进当前工程的导演参数。' },
      ui.field({ label: '默认视觉风格', en: 'STYLE' }, styleOpts.length ? ui.chips({ value: f.defaultStyle, options: styleOpts, onChange: set('defaultStyle') }) : ui.hint('风格列表加载中…')),
      ui.field({ label: '默认发布平台', en: 'PLATFORM' }, ui.chips({ value: f.defaultPlatform, options: PLATFORMS.map((p) => ({ value: p.value, label: p.label, hint: p.hint })), onChange: set('defaultPlatform') })),
      hasProject
        ? ui.row([ui.hint(`当前工程：风格「${curStyle || '—'}」 · 目标平台「${curPlat || '—'}」`), ui.spacer(), ui.btn('套用到当前工程', () => applyBrandDefaults(ctx), { size: 'sm', icon: 'check', busyText: '套用中…' })], { wrap: true })
        : ui.hint('打开一个工程后，可以把默认风格和平台一键套用到工程的导演参数。'),
    )

    const preview = h('div.pk-brand-preview')
    L.previewEl = preview
    paintBrandPreview(preview, f)
    const previewSec = ui.section({ title: '效果预览', en: 'PREVIEW', icon: 'eye', desc: '片尾品牌卡示意：实时显示你的品牌名、标语、配色、Logo 和水印。' }, preview)

    const src = logoSrc(f.logoPath)
    const marks = brandMarksOf(data)
    const logoRel = relInProject(f.logoPath)
    // the mark is "this logo" when it is the same project file, or an import of the same 公共素材区 (.skins) file
    const logoBase = U.baseName(f.logoPath)
    const logoInProject = marks.some((m) => (logoRel && normPath(m.path) === normPath(logoRel)) || (logoBase && m.sourceFolder === '.skins' && m.originalName === logoBase))
    const logoSec = ui.section(
      { title: '品牌 Logo', en: 'LOGO', icon: 'image', desc: '建议透明底 PNG 或 SVG、正方形 512–1024 像素。上传的 Logo 存在工作台的公共素材区，所有工程都能用。' },
      f.logoPath ? ui.image(src, { aspect: '5 / 2', fit: 'contain', alt: '品牌 Logo' }) : ui.empty({ icon: 'image', title: '还没有 Logo', text: '上传一张 Logo 图片，或从当前工程的图片素材里选一张。' }),
      f.logoPath ? ui.kv([['Logo 文件', h('span.pk-mono', { title: f.logoPath }, f.logoPath)]]) : null,
      f.logoPath && !src ? ui.hint('这个 Logo 存在当前工程之外，无法在这里预览，但仍会写进分镜蓝图。') : null,
      ui.row(
        [
          ui.btn(f.logoPath ? '更换 Logo' : '上传 Logo', () => uploadLogo(ctx), { kind: 'primary', size: 'sm', icon: 'upload', busyText: '上传中…' }),
          hasProject ? ui.btn('从工程素材选择', (ev, b) => pickProjectLogo(ctx, b), { size: 'sm', icon: 'folder' }) : null,
          f.logoPath
            ? ui.btn('移除 Logo', () => {
                f.logoPath = ''
                ctx.render()
              }, { size: 'sm', kind: 'ghost', icon: 'x', title: '只从品牌套件里移除，不会删除文件' })
            : null,
        ],
        { wrap: true },
      ),
      hasProject
        ? marks.length
          ? ui.note(`当前工程的品牌标识：${marks.map((m) => m.originalName || m.name).join('、')}。AI 出片时片中的品牌角标和片尾落版会使用它。`, {
              level: 'ok',
              actions: f.logoPath && isAbsPath(f.logoPath) && !logoInProject ? [ui.btn('改用上面的 Logo', () => addLogoToProject(ctx), { size: 'sm', icon: 'retry', busyText: '处理中…' })] : null,
            })
          : ui.note('当前工程还没有品牌标识素材。把 Logo 加入工程素材库后，AI 出片时片中的品牌角标和片尾落版会自动使用它。', {
              level: 'info',
              actions: f.logoPath && isAbsPath(f.logoPath) ? [ui.btn('把 Logo 加入当前工程', () => addLogoToProject(ctx), { size: 'sm', icon: 'plus', busyText: '加入中…' })] : null,
            })
        : null,
    )

    const motion = L.motion && L.motion.dir === PK.dir() ? L.motion : null
    const motionSec = ui.section(
      { title: 'MOTION.md 分镜蓝图', en: 'BLUEPRINT', icon: 'layers', desc: '把当前工程的分镜、节奏、参考复刻基因和品牌信息导出成一份通用 Markdown 蓝图（工程根目录的 MOTION.md），Claude Code、Codex 等 AI 智能体可以照着复刻同款。' },
      hasProject
        ? ui.row(
            [
              ui.btn(motion ? '重新导出' : '导出 MOTION.md', () => exportMotionMd(ctx), { size: 'sm', icon: 'download', busyText: '导出中…' }),
              motion ? copyBtn(motion.content, { label: '复制全文', what: 'MOTION.md 全文' }) : null,
              motion ? ui.btn('全屏阅读', () => textViewer('MOTION.md · 分镜蓝图', motion.content, { en: 'MOTION.MD', what: 'MOTION.md 全文', download: { href: PK.assetUrl(motion.rel), name: 'MOTION.md' } }), { size: 'sm', kind: 'ghost', icon: 'expand' }) : null,
              motion ? linkBtn('下载', PK.assetUrl(motion.rel), { download: 'MOTION.md', icon: 'download', kind: 'ghost' }) : null,
            ],
            { wrap: true },
          )
        : ui.hint('打开一个工程后才能导出它的分镜蓝图。'),
      motion ? preText(motion.content, { max: 240, scrollKey: 'bk-motion' }) : null,
    )

    const a = data && data.authorInfo
    const authorText = a ? `作者：${a.name} · QQ：${a.qq} · 微信：${a.wechat} · 邮箱：${a.email} · 官方仓库：${a.github}（${a.license} 开源）` : ''
    const authorSec = a
      ? ui.section(
          { title: '原创作者署名与开源声明', en: 'AUTHOR · LICENSE', icon: 'user', actions: [copyBtn(authorText, { label: '复制署名', what: '作者署名' })] },
          ui.kv([
            ['作者', a.name],
            ['QQ', a.qq],
            ['微信', a.wechat],
            ['邮箱', a.email],
            ['官方仓库', a.github],
            ['开源协议', a.license ? `${a.license}（开源免费）` : ''],
          ]),
          a.notice ? ui.hint(a.notice) : null,
        )
      : null

    return ui.split([infoSec, colorSec, defSec], [previewSec, logoSec, motionSec, authorSec], { ratio: 'minmax(0, 1.08fr) minmax(0, 1fr)' })
  }

  PK.panel('brand', {
    title: '品牌套件',
    en: 'BRAND KIT · 品牌名 · 配色 · Logo · 水印 · 分镜蓝图',
    idx: 'BK',
    icon: 'brand',
    kind: 'modal',
    size: 'lg',
    group: 'tools',
    order: 64,
    desc: '品牌名、标语、配色、Logo、水印与 MOTION.md 分镜蓝图',
    needsProject: false,
    aliases: { brandKit: {}, 'brand-kit': {}, brandkit: {}, motionMd: {}, 'motion-md': {} },
    watch: (st) => [st && st.project && st.project.dir, ((st && st.assets) || []).map((x) => x.id).join(',')],
    onWatch(ctx) {
      const L = ctx.local
      if (L.kitDir !== PK.dir()) {
        if (!brandDirty(L)) loadBrandKit(ctx)
        else L.kitDir = PK.dir()
      }
      ctx.load()
    },
    beforeClose(ctx, reason) {
      const L = ctx.local
      if (reason === 'force' || reason === 'all' || !brandDirty(L)) return true
      PK.confirm({ title: '放弃未保存的修改？', text: '品牌套件有修改还没保存，关闭后这些修改会丢失。', ok: '放弃修改', cancel: '继续编辑', danger: true }).then((ok) => {
        if (ok) ctx.frame.close('force')
      })
      return false
    },
    mount(ctx) {
      guardIme(ctx)
      ctx.local.form = null
      loadBrandKit(ctx)
      ctx.load()
    },
    render: renderBrand,
  })

  /* ================================================================================================
   * 版本历史与工程安全 · PROJECT SAFETY
   * ================================================================================================ */
  const STAGE_CN = { director: '策划导演', editor: '素材剪辑', audio: '配音混音', avatar: '数字人', motion: '动效编程', motion_qa: '动效质检', render: '成片渲染', qa: '质检' }
  const FIELD_CN = {
    title: '标题',
    narration: '旁白',
    emotion: '情绪',
    voiceEmotion: '情绪',
    voiceId: '音色',
    speechRate: '语速',
    layout: '布局',
    threePreset: '3D 舞台',
    kenBurns: '运镜',
    transition: '转场',
    durationSec: '时长',
    durationInFrames: '时长',
    sfxCues: '音效',
    subtitleText: '字幕',
    subtitle: '字幕',
    subtitles: '字幕',
    media: '画面素材',
    mediaPath: '画面素材',
    mediaType: '画面素材',
    assetPaths: '画面素材',
    locked: '锁定',
    lockedAt: '锁定',
    lockReason: '锁定',
    voiceLocked: '音色锁定',
    voiceMatchReason: '音色',
    role: '角色',
    visualBlueprint: '画面设计',
    motionNotes: '动效说明',
    stageSpec: '立体舞台',
    characterIds: '绑定角色',
    brandMark: '品牌标识',
    kicker: '小标题',
    windowTitle: '窗口标题',
    keyPoints: '要点',
    bullets: '要点',
    audioPath: '配音音频',
    ttsAudio: '配音音频',
    avatar: '数字人',
    audioFile: '配音音频',
    masteredAudioFile: '配音音频',
    ttsText: '配音文本',
    ttsNarrationRef: '配音文本',
    voiceDurationSec: '配音时长',
    voiceLeadSec: '配音节奏',
    voiceMastering: '配音音质处理',
    voicePlaceholder: '配音',
    voiceProvider: '配音引擎',
    voiceRefAudio: '音色',
    voiceCategory: '音色',
    voiceName: '音色',
    accentWords: '强调词',
    actionEvents: '动作编排',
    actionMode: '动作编排',
    actionReason: '动作编排',
    beatCutAligned: '卡点',
    cams: '镜头运动',
    compareLeft: '对比画面',
    compareRight: '对比画面',
    counterLabel: '数字动画',
    counterTarget: '数字动画',
    cursors: '鼠标指引',
    startFrame: '时间位置',
    startSec: '时间位置',
    endFrame: '时间位置',
    endSec: '时间位置',
    tailSec: '时长',
    fanMedia: '画面素材',
    poolMedia: '画面素材',
    highlights: '高亮标注',
    metrics: '数据指标',
    steps: '步骤',
    subChunks: '字幕',
    subtitleLine: '字幕',
    tag: '标签',
    vfx: '特效',
    visualPrompt: '画面描述',
    windowTheme: '窗口样式',
    index: '顺序',
  }
  const SCRIPT_FIELD_CN = {
    topic: '主题',
    goal: '一句话需求',
    userPrompt: '创意需求',
    displayTitle: '成片标题',
    genre: '体裁',
    genreLabel: '体裁',
    directorNotes: '导演备注',
    contentOutline: '内容要点',
    width: '分辨率',
    height: '分辨率',
    fps: '帧率',
    aspectRatio: '画幅',
    requestedAspectRatio: '画幅',
    quality: '画质',
    style: '视觉风格',
    engine: '渲染引擎',
    authoringMode: '创作模式',
    creationMode: '创作模式',
    narrationMode: '解说方式',
    bgm: '配乐',
    bgmMode: '配乐模式',
    audioSpec: '音频设置',
    ttsEngine: '配音引擎',
    totalDurationSec: '总时长',
    targetPlatform: '目标平台',
    avatarClip: '数字人',
    avatarLayout: '数字人布局',
    referenceStyle: '参考复刻基因',
    userOverrides: '人工改动保护',
    aiBadge: 'AI 角标',
    aiBadgeText: 'AI 角标',
    theme: '主题配色',
    palette: '配色',
    pacingMode: '节奏',
    visual3dMode: '视效偏好',
    aiBadgeEnabled: 'AI 角标',
    aiBadgePosition: 'AI 角标',
    aiMeta: 'AI 生成记录',
    directorMeta: '导演记录',
    audience: '目标观众',
    defaultVoiceId: '默认音色',
    dimensionReason: '画幅',
    durationMode: '时长设置',
    targetDurationSec: '时长设置',
    totalDurationInFrames: '总时长',
    hardwarePolicy: '低配保护',
    lowSpecSafe: '低配保护',
    mediaDims: '素材尺寸',
    subtitleStyle: '字幕样式',
    subtitles: '字幕',
    voiceMasteringReport: '配音音质处理',
    voiceMode: '配音方式',
    cast: '演员表',
    figureStyle: '人物画风',
    figureStyleNote: '人物画风',
    figureStyleChoice: '人物画风',
    figureStyleChoiceNote: '人物画风',
    visualReview: '画面自检',
  }
  const knownLabel = (k) => {
    const s = String(k || '')
    const head = s.split('.')[0]
    return FIELD_CN[s] || SCRIPT_FIELD_CN[s] || FIELD_CN[head] || SCRIPT_FIELD_CN[head] || ''
  }
  const fieldLabel = (k) => knownLabel(k) || String(k || '')
  /**
   * Changed-field list in plain words for the version diff: friendly names, deduplicated; internal bookkeeping keys
   * are only counted ("另有 3 项内部参数") — their raw names stay available in the tooltip.
   */
  const fieldSummary = (fields) => {
    const keys = (Array.isArray(fields) ? fields : Object.keys(fields || {})).filter((k) => k !== 'voiceLocked' && k !== 'voiceCastBy')
    const known = []
    const other = []
    for (const k of keys) {
      const l = knownLabel(k)
      if (!l) other.push(String(k))
      else if (!known.includes(l)) known.push(l)
    }
    const text = known.length ? `${known.join('、')}${other.length ? `，另有 ${other.length} 项内部参数` : ''}` : other.length ? `${other.length} 项内部参数` : ''
    return h('span', { title: keys.join(', ') }, text || '—')
  }
  /** override field names → friendly labels (voice bookkeeping fields hidden), deduplicated */
  const overrideFieldNames = (fields) => {
    const keys = Array.isArray(fields) ? fields : Object.keys(fields || {})
    const out = []
    for (const k of keys) {
      if (k === 'voiceLocked' || k === 'voiceCastBy') continue
      const l = fieldLabel(k)
      if (!out.includes(l)) out.push(l)
    }
    return out
  }
  const versionLabel = (v) => {
    const raw = String((v && (v.label || v.stage)) || '').trim()
    let m = raw.match(/^pipeline:([a-z_]+):(before|after)$/i)
    if (m) return `AI 出片 · ${STAGE_CN[m[1].toLowerCase()] || m[1]}${m[2].toLowerCase() === 'before' ? '前' : '完成'}`
    const fixed = {
      'pre-ai': 'AI 编码前备份',
      'post-ai': 'AI 编码完成',
      'pre-refine': 'AI 精修前备份',
      'post-refine': 'AI 精修完成',
      'before-restore': '恢复前自动备份',
      manual: '手动保存',
      snapshot: '快照',
      auto: '自动保存',
      refine: 'AI 精修',
      'user-edit:clear-overrides': '清除人工改动保护',
    }
    if (fixed[raw]) return fixed[raw]
    if (/^before[-_]restore/i.test(raw)) return '恢复前自动备份'
    m = raw.match(/^(lock|unlock):(.+)$/i)
    if (m) return `${m[1].toLowerCase() === 'lock' ? '锁定' : '解锁'}分镜 ${shortList(m[2])}`
    m = raw.match(/^user-edit:(.+)$/i)
    if (m) return m[1] === '__project__' ? '手动修改 · 整片设置' : `手动修改分镜 ${shortList(m[1])}`
    // versions migrated from the old history/v-<time>-<label>/ folder copies
    m = raw.match(/^legacy:(.*)$/i)
    if (m) return `旧版备份${m[1] && m[1] !== 'legacy' ? ` · ${versionLabel({ label: m[1] })}` : ''}`
    return raw || '版本'
  }
  const versionNote = (v) => {
    const raw = String((v && v.label) || '')
    if ((v && v.kind === 'before-restore') || /^before[-_]restore/i.test(raw)) {
      const target = raw.includes('→') ? raw.split('→').slice(1).join('→') : ''
      return target ? `准备恢复到「${versionLabel({ label: target })}」之前，自动保存的当时状态。` : '恢复其他版本之前，自动保存的当时状态。'
    }
    return String((v && v.note) || '')
  }

  const HISTORY_TABS = [
    { value: 'history', label: '版本历史', icon: 'history', hint: '保存、对比、恢复工程版本' },
    { value: 'locks', label: '分镜锁定', icon: 'lock', hint: '锁定分镜与人工改动保护' },
    { value: 'characters', label: '角色库', icon: 'user', hint: '让同一个角色在整部片子里长得一样' },
    { value: 'stock', label: '免费素材', icon: 'image', hint: 'Pexels / Pixabay 免版税图片和视频' },
    { value: 'cloudjobs', label: '云端账本', icon: 'cloud', hint: '付费云端生成任务记录' },
    { value: 'lipsync', label: '口型引擎 ↗', icon: 'mic', hint: '在「数字人」面板里检测与安装口型同步引擎' },
  ]
  const TAB_IDS = HISTORY_TABS.map((t) => t.value)
  /** 口型引擎 → the 数字人 panel (owned by the settings module; `tab` is a hint it may use to scroll there) */
  const openLipsync = () => PK.open(PK.panels && PK.panels.has('avatar') ? 'avatar' : 'lipsync', { tab: 'lipsync' })
  const DATA_TABS = ['history', 'locks', 'characters', 'cloudjobs']
  const REF_TYPES = [
    ['face', '正脸'],
    ['fullBody', '全身'],
    ['expressions', '表情'],
    ['turnaround', '三视图'],
  ]
  const JOB_STATUS = {
    submitting: ['提交中', 'acc'],
    submitted: ['生成中', 'acc'],
    result_ready: ['结果待下载', 'warn'],
    completed: ['已完成', 'ok'],
    failed: ['失败', 'err'],
    billing_failed: ['余额不足', 'err'],
    interrupted: ['已中断', 'mute'],
  }
  const JOB_CAT = { image: '图片', video: '视频', audio: '音频', music: '音乐', bgm: '配乐', tts: '云端配音', speech: '云端配音', voice: '云端配音' }
  const blankChar = (scope = 'project') => ({ id: '', name: '', aliases: '', description: '', scope, editing: '' })
  const tlScenes = () => {
    const st = PK.state || {}
    return (st.timeline && Array.isArray(st.timeline.scenes) && st.timeline.scenes) || []
  }
  const scriptScenes = (ctx) => {
    const ap = ctx.data && ctx.data.activeProject
    return (ap && ap.script && Array.isArray(ap.script.scenes) && ap.script.scenes) || []
  }

  const hLoaders = {
    history: () => PK.get('project/history', { projectDir: PK.needProject(), limit: 200 }),
    locks: () => PK.get('project/scene-edits', { projectDir: PK.needProject() }),
    characters: () => PK.get('project/characters', { projectDir: PK.needProject(), scope: 'all' }),
    cloudjobs: (ctx) => PK.get('project/cloud-jobs', { projectDir: PK.needProject(), limit: 150, plan: 1, status: ctx.local.jobStatus || undefined }),
  }
  const loadHTab = async (ctx, tab, o = {}) => {
    const L = ctx.local
    const fn = hLoaders[tab]
    if (!fn || !PK.hasProject()) return
    const seq = (L.seq[tab] = (L.seq[tab] || 0) + 1)
    const dir = PK.dir()
    L.loading[tab] = true
    L.stale[tab] = false
    if (!o.quiet) ctx.update()
    try {
      const d = await fn(ctx)
      if (seq !== L.seq[tab] || dir !== PK.dir()) return
      L.data[tab] = d
      L.err[tab] = null
    } catch (err) {
      if (seq === L.seq[tab]) L.err[tab] = err
    } finally {
      if (seq === L.seq[tab]) {
        L.loading[tab] = false
        ctx.update()
      }
    }
  }
  const switchHTab = (ctx, v) => {
    if (v === 'lipsync') {
      // the 口型引擎 (lip-sync engine) section lives in the 数字人 panel of the settings module
      openLipsync()
      return
    }
    const L = ctx.local
    if (!TAB_IDS.includes(v)) return
    L.tab = v
    if (hLoaders[v] && (!L.data[v] || L.stale[v])) loadHTab(ctx, v, { quiet: Boolean(L.data[v]) })
    ctx.render()
    ctx.body.scrollTop = 0
  }
  const tabLoading = (ctx, tab, label) => {
    const L = ctx.local
    return L.err[tab] && !L.data[tab] ? ui.errorBox(L.err[tab], () => loadHTab(ctx, tab)) : ui.loading(label)
  }

  /* ---------------------------------------------------------------------------- tab: 版本历史 */
  const snapshotVersion = async (ctx) => {
    const L = ctx.local
    const note = String(L.snapNote || '').trim()
    const d = await PK.postP('project/history/snapshot', { label: '手动保存', note })
    const v = (d && d.version) || {}
    if (v.deduped) {
      // nothing changed since the newest version → no new version is created; keep the typed note instead of losing it
      PK.toast(
        `当前工程和最新版本${v.seq ? ` #${v.seq} ` : ''}完全一样，不需要重复保存${note ? '。备注先帮你留在输入框里：改动工程后再点「保存当前版本」就会带上它' : ''}`,
        'info',
        { timeout: note ? 7000 : undefined },
      )
    } else {
      PK.toast(`已保存当前版本（#${v.seq || '?'}）`, 'success')
      L.snapNote = ''
    }
    await loadHTab(ctx, 'history')
  }
  const toggleDiff = async (ctx, v) => {
    const L = ctx.local
    if (L.diffFor === v.id) {
      L.diffFor = ''
      L.diff = null
      ctx.render()
      return
    }
    const d = await PK.postP('project/history/diff', { fromVersionId: v.id })
    L.diffFor = v.id
    L.diff = d
    ctx.render()
  }
  const restoreVersion = async (ctx, v) => {
    const L = ctx.local
    const ok = await PK.confirm({
      title: `恢复到版本 #${v.seq}？`,
      text: h(
        'div.pk-stack',
        null,
        ui.text(`「${versionLabel(v)}」 · ${fmtFull(v.time)}`),
        ui.text('恢复会把分镜、文案、配音设置、动效代码等工程文件改回这个版本的样子。'),
        ui.text('不用担心：恢复前会先把现在的状态自动备份成一个新版本（「恢复前自动备份」），随时可以再恢复回来。图片、视频、音频等素材文件不会被删除。', { tone: 'dim' }),
      ),
      ok: '恢复到此版本',
    })
    if (!ok) return
    const d = await ctx.task(`正在恢复到版本 #${v.seq}…`, () => PK.postP('project/history/restore', { versionId: v.id }), { rerender: false })
    if (!d) return
    const before = d.beforeRestoreVersion || null
    L.backupSeq = before && before.seq ? before.seq : 0
    PK.toast(
      before && before.deduped
        ? `已恢复到版本 #${v.seq}。恢复前的状态和版本 #${before.seq} 完全一样（之前已保存），想撤销就恢复 #${before.seq}`
        : `已恢复到版本 #${v.seq}。恢复前的状态已自动备份为版本 #${(before && before.seq) || '（最新）'}，随时可以恢复回来`,
      'success',
      { timeout: 8000 },
    )
    const warns = Array.isArray(d.mediaWarnings) ? d.mediaWarnings : []
    if (warns.length) {
      PK.toast(`有 ${warns.length} 个素材文件和当时相比已变化或缺失（素材只记录引用，不随版本恢复）`, 'warn', {
        detail: warns.map((m) => `${m.path} · ${m.issue === 'missing' ? '已缺失' : '已变化'}`).join('\n'),
      })
    }
    L.diffFor = ''
    L.diff = null
    PK.store.invalidate()
    try {
      await PK.action('refresh', { syncForm: true })
    } catch (err) {
      console.warn('[PK] refresh after restore failed', err)
    }
    await Promise.all([loadHTab(ctx, 'history'), loadHTab(ctx, 'locks', { quiet: true }), loadHTab(ctx, 'characters', { quiet: true })])
  }
  const pruneVersions = async (ctx) => {
    const L = ctx.local
    const d = L.data.history || {}
    const total = U.num(d.total)
    if (total <= 2) {
      PK.toast('版本还很少，暂时不需要清理', 'info')
      return
    }
    const choices = [5, 10, 20, 30, 50].filter((n) => n < total)
    if (!choices.length) choices.push(Math.max(2, total - 1))
    let keep = choices.includes(20) ? 20 : choices[choices.length - 1]
    const info = ui.text('')
    const paint = () => {
      info.textContent = `将删除最旧的 ${total - keep} 个版本，保留最新的 ${keep} 个。删除后这些旧版本无法再恢复；工程当前的内容和素材文件都不受影响。`
    }
    paint()
    const box = h(
      'div.pk-stack',
      null,
      ui.text(`当前共有 ${total} 个版本，要保留最新的几个？`),
      ui.chips({
        value: keep,
        options: choices.map((n) => ({ value: n, label: `保留 ${n} 个` })),
        onChange: (v) => {
          keep = Number(v)
          paint()
        },
      }),
      info,
    )
    const ok = await PK.confirm({ title: '清理旧版本', text: box, ok: '清理旧版本', danger: true })
    if (!ok) return
    const r = await ctx.task('正在清理旧版本…', () => PK.postP('project/history/prune', { max: keep }), { rerender: false })
    if (!r) return
    PK.toast(
      r.prunedVersions
        ? `已清理 ${r.prunedVersions} 个旧版本，保留 ${r.remaining} 个（同时释放 ${r.removedObjects || 0} 个不再使用的存储文件）`
        : `没有需要清理的旧版本（释放了 ${r.removedObjects || 0} 个不再使用的存储文件）`,
      'success',
    )
    await loadHTab(ctx, 'history')
  }

  const diffBlock = (ctx, v) => {
    const d = ctx.local.diff || {}
    const sc = d.scenes || {}
    const changed = Array.isArray(sc.changed) ? sc.changed : []
    const added = Array.isArray(sc.added) ? sc.added : []
    const removed = Array.isArray(sc.removed) ? sc.removed : []
    const files = Array.isArray(d.changedFiles) ? d.changedFiles : []
    const media = d.media || {}
    const nMedia = asArr(media.added).length + asArr(media.removed).length + asArr(media.modified).length
    const fields = Array.isArray(d.scriptFields) ? d.scriptFields : []
    const same = !files.length && !nMedia && !changed.length && !added.length && !removed.length && !fields.length && !sc.reordered
    const FILE_CH = { added: '恢复后会删除', removed: '恢复后会找回', modified: '恢复后会改回' }
    const rows = []
    if (changed.length) rows.push(['会改回的分镜', ui.stack(changed.map((c) => ui.text([`${c.sceneId}${c.title ? `「${c.title}」` : ''}：`, fieldSummary(c.fields)])), { gap: 2 })])
    if (removed.length) rows.push(['会找回的分镜', removed.join('、')])
    if (added.length) rows.push(['会移除的分镜', added.join('、')])
    if (sc.reordered) rows.push(['分镜顺序', '会恢复成当时的顺序'])
    if (fields.length) rows.push(['整片设置', fieldSummary(fields)])
    if (files.length)
      rows.push([
        '工程文件',
        ui.stack(
          [...files.slice(0, 30).map((f) => ui.text(`${f.path} · ${FILE_CH[f.change] || f.change}`, { mono: true })), files.length > 30 ? ui.hint(`…等共 ${files.length} 个文件`) : null],
          { gap: 2 },
        ),
      ])
    if (nMedia) rows.push(['素材引用', `${nMedia} 个素材文件和当时不同（素材文件本身不会随版本恢复）`])
    return h(
      'div',
      { key: `vdiff-${v.id}` },
      ui.note(same ? ui.text('恢复它不会带来任何变化。') : longKv(rows), {
        level: same ? 'ok' : 'info',
        title: same ? `#${v.seq} 和当前工程完全一样` : `恢复到 #${v.seq} 会带来这些变化`,
        actions: [
          same ? null : ui.btn('恢复到这个版本', () => restoreVersion(ctx, v), { size: 'sm', kind: 'primary', icon: 'retry' }),
          ui.btn('收起', () => toggleDiff(ctx, v), { size: 'sm', kind: 'ghost' }),
        ],
      }),
    )
  }

  const renderVersions = (ctx) => {
    const L = ctx.local
    const d = L.data.history
    ctx.foot([
      ui.hint('AI 每次出片、精修和恢复前都会自动保存版本'),
      ui.spacer(),
      ui.btn('刷新', () => loadHTab(ctx, 'history'), { icon: 'refresh', kind: 'ghost' }),
      ui.btn('清理旧版本', () => pruneVersions(ctx), { icon: 'trash', kind: 'ghost', disabled: !d || U.num(d.total) <= 2 }),
    ])
    if (!d) return tabLoading(ctx, 'history', '正在读取版本历史…')
    const vs = Array.isArray(d.versions) ? d.versions : []
    const head = ui.section(
      {
        title: '版本历史',
        en: 'VERSION HISTORY',
        icon: 'history',
        count: U.num(d.total),
        desc: 'AI 每次出片、精修、恢复前都会自动保存版本；素材文件只记录引用、不会重复复制，几乎不占空间。恢复任何版本前都会先把当前状态再备份一次，随时可以撤回。',
      },
      ui.row(
        [
          h(
            'div',
            { style: { flex: '1 1 260px', minWidth: 0 } },
            ui.textarea({
              key: 'vh-note',
              value: L.snapNote,
              rows: 1,
              minRows: 1,
              maxRows: 6,
              maxLength: 300,
              placeholder: '给这个版本写个备注（可选），例如：改好了开场文案（Ctrl + Enter 保存）',
              expand: { title: '版本备注' },
              onInput: (v) => (L.snapNote = v),
              onSubmit: () => snapshotVersion(ctx).catch((e) => PK.reportError(e)),
            }),
          ),
          ui.btn('保存当前版本', () => snapshotVersion(ctx), { kind: 'primary', icon: 'save', busyText: '保存中…' }),
        ],
        { wrap: true },
      ),
      ui.row(
        [
          ui.pill(`共 ${U.num(d.total)} 个版本`, 'acc'),
          ui.pill(`最多保留 ${d.max || 50} 个，超出后自动清理最旧的`, 'mute'),
          d.lastRestore && d.lastRestore.at ? ui.pill(`上次恢复：${U.fmtTime(d.lastRestore.at)}`, 'warn') : null,
        ],
        { wrap: true },
      ),
    )
    const items = []
    for (const v of vs) {
      const open = L.diffFor === v.id
      const note = versionNote(v)
      items.push(
        ui.item({
          key: `ver-${v.id}`,
          lead: `#${v.seq}`,
          title: versionLabel(v),
          sub: [fmtFull(v.time), v.author === 'user' ? '你的操作' : 'AI 自动保存', `${U.num(v.fileCount)} 个工程文件`, v.mediaCount ? `${v.mediaCount} 个素材引用` : ''].filter(Boolean).join(' · '),
          body: note ? ui.text(note, { tone: 'dim' }) : null,
          active: Boolean(v.isCurrent),
          tip: `${v.label || ''} · ${v.id}`,
          right: [
            v.isCurrent ? ui.pill('当前', 'ok', { dot: true, title: '这个版本和当前工程内容完全一样' }) : null,
            v.kind === 'before-restore' ? ui.pill('恢复前备份', 'warn') : null,
            L.backupSeq && v.seq === L.backupSeq && v.kind !== 'before-restore' ? ui.pill('上次恢复前的状态', 'warn', { title: '撤销刚才的恢复：恢复这个版本即可' }) : null,
            ui.btn(open ? '收起' : '对比', () => toggleDiff(ctx, v), { size: 'sm', icon: 'split', disabled: Boolean(v.isCurrent), busyText: '对比中…', title: v.isCurrent ? '这就是当前工程的样子' : '看看恢复到这个版本会改变什么' }),
            ui.btn('恢复', () => restoreVersion(ctx, v), { size: 'sm', icon: 'retry', disabled: Boolean(v.isCurrent), title: v.isCurrent ? '这就是当前工程的样子' : '把工程恢复到这个版本（恢复前自动备份）' }),
          ],
        }),
      )
      if (open && L.diff) items.push(diffBlock(ctx, v))
    }
    return [
      head,
      vs.length
        ? ui.list(items)
        : ui.empty({ icon: 'history', title: '还没有历史版本', text: '点「保存当前版本」，或运行一次 AI 出片 / 精修后，版本就会出现在这里。' }),
    ]
  }

  /* ---------------------------------------------------------------------------- tab: 分镜锁定 */
  const setLocks = async (ctx, ids, locked) => {
    if (!ids.length) return
    const d = await PK.postP('project/scene-lock', { sceneIds: ids, locked })
    const n = asArr(d && d.changed).length || ids.length
    PK.toast(
      locked
        ? n === 1
          ? `已锁定 ${ids[0]}：AI 重新生成、批量编码和精修都不会改动它`
          : `已锁定 ${n} 个分镜：AI 重新生成、批量编码和精修都不会改动它们`
        : n === 1
          ? `已解锁 ${ids[0]}，AI 之后可以重新生成它`
          : `已解锁 ${n} 个分镜`,
      'success',
    )
    await loadHTab(ctx, 'locks')
  }
  const clearOverrides = async (ctx, sceneId) => {
    const ok = await PK.confirm({
      title: `清除「${sceneId}」的人工改动保护？`,
      text: '清除后，AI 重新生成时不会再自动恢复你在这个分镜上的手动修改。分镜现在的内容不会变。',
      ok: '清除保护',
      danger: true,
    })
    if (!ok) return
    await PK.postP('project/scene-overrides', { sceneId, clearAll: true })
    PK.toast(`已清除 ${sceneId} 的人工改动保护`, 'success')
    await loadHTab(ctx, 'locks')
  }
  const clearAllOverrides = async (ctx, n) => {
    const ok = await PK.confirm({
      title: '清除全部人工改动保护？',
      text: `将清除 ${n} 个分镜上记录的手动修改保护（整片级的设置会保留）。分镜现在的内容不会变，但之后 AI 重新生成时不会再自动恢复这些手动修改。`,
      ok: '全部清除',
      danger: true,
    })
    if (!ok) return
    const d = await PK.postP('project/scene-overrides/batch', { clear: true })
    PK.toast(`已清除 ${asArr(d && d.cleared).length || n} 个分镜的人工改动保护`, 'success')
    await loadHTab(ctx, 'locks')
  }
  const mergeNote = (ctx, m) => {
    const L = ctx.local
    const conflicts = Array.isArray(m.conflicts) ? m.conflicts : []
    const kept = asArr(m.lockedPreserved).length
    const reins = asArr(m.lockedReinserted).length
    const applied = Array.isArray(m.overridesApplied) ? m.overridesApplied : []
    const nFields = applied.reduce((n, a) => n + asArr(a && a.fields).length, 0)
    const orphan = asArr(m.orphanOverrides).length
    const STAGE = { 'ai-studio-director': 'AI 编码导演', 'local-director': '本地草稿导演', 'llm-director': 'AI 策划导演' }
    const text = [
      `原样保留锁定分镜 ${kept} 个`,
      reins ? `重新插回被 AI 删掉的锁定分镜 ${reins} 个` : '',
      `恢复你的人工改动 ${applied.length} 处${nFields ? `（共 ${nFields} 个字段）` : ''}`,
      conflicts.length ? `冲突 ${conflicts.length} 项（都已以你的人工修改为准）` : '没有冲突',
      orphan ? `${orphan} 个分镜的人工修改暂时没有对应分镜（已保留，分镜回来后自动生效）` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    const detail =
      L.mergeOpen && conflicts.length
        ? ui.stack(
            conflicts.slice(0, 60).map((c) => ui.text(`${c.sceneId === '__project__' ? '整片' : c.sceneId} · ${fieldLabel(c.field)}：AI 想改成「${shortVal(c.theirs)}」，已保留你的「${shortVal(c.ours)}」`, { tone: 'muted' })),
            { gap: 4 },
          )
        : null
    return ui.note(h('div.pk-stack', null, ui.text(text), detail), {
      level: conflicts.length ? 'warn' : 'info',
      title: `上次 AI 生成（${STAGE[m.stage] || 'AI 生成'}${m.at ? ` · ${fmtFull(m.at)}` : ''}）时的保护结果`,
      actions: conflicts.length
        ? [
            ui.btn(L.mergeOpen ? '收起冲突详情' : `查看 ${conflicts.length} 项冲突`, () => {
              L.mergeOpen = !L.mergeOpen
              ctx.render()
            }, { size: 'sm', kind: 'ghost' }),
          ]
        : null,
    })
  }
  const overrideDetail = (fields) =>
    longKv(
      Object.entries(fields || {})
        .filter(([k]) => k !== 'voiceLocked' && k !== 'voiceCastBy')
        .map(([k, v]) => [fieldLabel(k), typeof v === 'string' ? v : shortVal(v, 400)]),
    )

  const renderLocks = (ctx) => {
    const L = ctx.local
    const d = L.data.locks
    let scenes = tlScenes()
    if (!scenes.length) scenes = scriptScenes(ctx).map((s, i) => ({ id: s.id, index: i, title: s.title || '', durationSec: s.durationSec, thumbUrl: '' }))
    if (!d) {
      ctx.foot(null)
      return tabLoading(ctx, 'locks', '正在读取分镜保护状态…')
    }
    const locked = new Set(d.lockedSceneIds || [])
    const ovAll = d.userOverrides && typeof d.userOverrides === 'object' ? d.userOverrides : {}
    const hasOv = (id) => Boolean(ovAll[id] && Object.keys(ovAll[id]).length)
    const ovIds = Object.keys(ovAll).filter((k) => k !== '__project__' && hasOv(k))
    const projOv = hasOv('__project__') ? ovAll.__project__ : null
    const unlockedIds = scenes.filter((s) => !locked.has(s.id)).map((s) => s.id)
    ctx.foot([
      ui.hint(`${scenes.length} 个分镜 · 已锁定 ${locked.size} 个 · 人工改动保护 ${ovIds.length} 个`),
      ui.spacer(),
      ui.btn('全部解锁', async () => {
        const ok = await PK.confirm({ title: `解锁全部 ${locked.size} 个分镜？`, text: '解锁后，AI 重新生成、批量编码和精修时可能会改动这些分镜。', ok: '全部解锁' })
        if (ok) await setLocks(ctx, [...locked], false)
      }, { kind: 'ghost', icon: 'unlock', disabled: !locked.size }),
      ui.btn('全部锁定', () => setLocks(ctx, unlockedIds, true), { kind: 'secondary', icon: 'lock', disabled: !unlockedIds.length, busyText: '锁定中…' }),
    ])
    const q = String(L.lockQ || '').trim().toLowerCase()
    const shown = scenes.filter((s) => {
      if (L.lockFilter === 'locked' && !locked.has(s.id)) return false
      if (L.lockFilter === 'edited' && !hasOv(s.id)) return false
      if (q && !`${s.id} ${s.title || ''} ${s.subtitle || ''}`.toLowerCase().includes(q)) return false
      return true
    })
    const head = ui.section(
      {
        title: '分镜锁定与人工改动保护',
        en: 'SCENE LOCKS · EDIT PROTECTION',
        icon: 'lock',
        desc: '锁定的分镜在 AI 重新生成、批量编码和精修时都会原样保留；你在精修台手动改过的字段也会被记住，AI 重新生成后自动恢复。',
      },
      d.lastEditMerge ? mergeNote(ctx, d.lastEditMerge) : ui.hint('还没有 AI 重新生成过：之后每次重新生成，这里会显示保留了哪些锁定分镜、恢复了哪些人工改动。'),
      projOv ? ui.note(h('div.pk-stack', null, ui.text(`整片级的人工改动也在保护中：${overrideFieldNames(projOv).join('、')}`), overrideDetail(projOv)), { level: 'info', title: '整片设置保护' }) : null,
      ui.row(
        [
          ui.seg({
            value: L.lockFilter,
            options: [
              { value: 'all', label: `全部 ${scenes.length}` },
              { value: 'locked', label: `已锁定 ${locked.size}` },
              { value: 'edited', label: `有人工改动 ${ovIds.length}` },
            ],
            onChange: (v) => {
              L.lockFilter = v
              ctx.render()
            },
          }),
          scenes.length > 8
            ? growInput({
                key: 'lk-q',
                type: 'search',
                value: L.lockQ,
                placeholder: '搜索分镜编号或标题…',
                onInput: (v) => {
                  L.lockQ = v
                  ctx.update()
                },
              })
            : ui.spacer(),
          ovIds.length ? ui.btn('清除全部保护', () => clearAllOverrides(ctx, ovIds.length), { size: 'sm', kind: 'ghost', icon: 'x' }) : null,
        ],
        { wrap: true },
      ),
    )
    if (!scenes.length) return [head, ui.empty({ icon: 'film', title: '当前工程还没有分镜', text: '运行一次 AI 出片后，分镜会出现在这里，可以逐个锁定。' })]
    const items = shown.map((sc, i) => {
      const isLocked = locked.has(sc.id)
      const fields = hasOv(sc.id) ? ovAll[sc.id] : null
      const names = fields ? overrideFieldNames(fields) : []
      const open = Boolean(L.openOv[sc.id])
      const idx = typeof sc.index === 'number' ? sc.index : i
      return ui.item({
        key: `lk-${sc.id}`,
        lead: p2(idx + 1),
        thumb: sc.thumbUrl ? h('img', { src: sc.thumbUrl, alt: '', loading: 'lazy', draggable: 'false' }) : null,
        title: sc.title || '未命名分镜',
        sub: [sc.id, sc.durationSec ? U.fmtSec(sc.durationSec) : '', isLocked ? '已锁定' : ''].filter(Boolean).join(' · '),
        body: names.length
          ? [ui.row([ui.pill('人工改动保护', 'acc'), ...names.map((n) => ui.tag(n))], { wrap: true }), open ? overrideDetail(fields) : null]
          : null,
        active: isLocked,
        right: [
          names.length
            ? ui.btn(open ? '收起' : '查看改动', () => {
                L.openOv[sc.id] = !open
                ctx.render()
              }, { size: 'sm', kind: 'ghost' })
            : null,
          names.length ? ui.btn('清除保护', () => clearOverrides(ctx, sc.id), { size: 'sm', kind: 'ghost', icon: 'x' }) : null,
          ui.btn(isLocked ? '解锁' : '锁定', () => setLocks(ctx, [sc.id], !isLocked), { size: 'sm', icon: isLocked ? 'unlock' : 'lock', kind: isLocked ? 'primary' : 'secondary', title: isLocked ? '解锁后 AI 可以重新生成它' : '锁定后 AI 不会再改动它' }),
        ],
      })
    })
    return [head, shown.length ? ui.list(items) : ui.empty({ icon: 'filter', title: '没有符合条件的分镜', text: '换个筛选条件或搜索词试试。' })]
  }

  /* ---------------------------------------------------------------------------- tab: 角色库 */
  const saveChar = async (ctx) => {
    const L = ctx.local
    const f = L.charForm
    const name = String(f.name || '').trim()
    if (!name) throw new PK.Error('请填写角色名称')
    const scope = f.scope === 'global' ? 'global' : 'project'
    const body = { scope, character: { name, aliases: String(f.aliases || ''), description: String(f.description || '').trim() } }
    if (f.id) body.character.id = f.id
    if (PK.dir()) body.projectDir = PK.dir()
    await PK.post('project/characters/save', body)
    PK.toast(`已保存角色「${name}」：AI 写分镜、生成画面时会保持这个角色的外观一致`, 'success')
    L.charForm = blankChar(scope)
    await loadHTab(ctx, 'characters')
  }
  const editChar = (ctx, ch) => {
    ctx.local.charForm = {
      id: ch.id,
      name: ch.name || '',
      aliases: asArr(ch.aliases).join('、'),
      description: ch.description || '',
      scope: ch.scope === 'global' ? 'global' : 'project',
      editing: ch.name || '',
    }
    ctx.render()
    ctx.body.scrollTop = 0
  }
  const deleteChar = async (ctx, ch) => {
    const global = ch.scope === 'global'
    const ok = await PK.confirm({
      title: `删除角色「${ch.name}」？`,
      text: `将从${global ? '全局角色库（所有工程共用）' : '本工程的角色库'}删除这个角色${global ? '' : '，并解除它和分镜的绑定'}。参考图素材文件会保留在素材库里。此操作无法撤销。`,
      ok: '删除角色',
      danger: true,
    })
    if (!ok) return
    const body = { scope: global ? 'global' : 'project', characterId: ch.id }
    if (PK.dir()) body.projectDir = PK.dir()
    await PK.post('project/characters/delete', body)
    if (ctx.local.charForm.id === ch.id) ctx.local.charForm = blankChar()
    PK.toast(`已删除角色「${ch.name}」`, 'success')
    await loadHTab(ctx, 'characters')
  }
  const refThumb = (rel, label, name) => {
    const url = PK.assetUrl(rel)
    const b = h(
      'button.pk-btn.pk-btn--ghost.pk-btn--sm',
      { type: 'button', title: `${label}参考图 · ${rel}`, 'aria-label': `${name} ${label}参考图`, style: { padding: '2px', width: '48px', height: '48px', overflow: 'hidden', flex: 'none' } },
      h('img', { src: url, alt: '', loading: 'lazy', draggable: 'false', style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px', display: 'block' } }),
    )
    b.addEventListener('click', () => lightbox(url, { title: `${name} · ${label}参考图`, download: U.baseName(rel) }))
    return b
  }

  const openAttach = async (ctx, ch) => {
    const dir = PK.needProject()
    const data = ctx.data || (await PK.store.load().catch(() => null)) || {}
    const ap = data.activeProject || {}
    const imgs = (ap.assets || [])
      .filter((a) => a && a.type === 'image' && a.role !== 'brand_mark')
      .map((a) => ({ path: a.path, name: a.originalName || a.name || U.baseName(a.path), thumb: a.thumb || a.path }))
    const scenes = tlScenes()
    const bound = new Set(scriptScenes(ctx).filter((s) => Array.isArray(s.characterIds) && s.characterIds.includes(ch.id)).map((s) => s.id))
    const sel = { type: 'face', paths: new Set(), scenes: new Set() }
    const f = PK.frame({ id: 'history-attach', kind: 'modal', size: 'lg', title: `参考图与出场分镜 · ${ch.name}`, en: 'CHARACTER REFERENCES · SCENE BINDING' })
    let submitBtn = null
    const updFoot = () => {
      f.setFoot([
        ui.hint(`已选 ${sel.paths.size} 张参考图 · ${sel.scenes.size} 个分镜`),
        ui.spacer(),
        ui.btn('取消', () => f.close('cancel'), { kind: 'ghost' }),
        (submitBtn = ui.btn('确认绑定', submit, { kind: 'primary', icon: 'check', busyText: '绑定中…', disabled: !sel.paths.size && !sel.scenes.size })),
      ])
    }
    const upload = async (files) => {
      for (const file of files) {
        if (U.kindOfFile(file.name, file.type) !== 'image') {
          PK.toast(`「${file.name}」不是图片，已跳过`, 'warn')
          continue
        }
        const res = await PK.upload('assets/upload', file, { query: { projectDir: dir, fileName: file.name } })
        const it = [...((res && res.added) || []), ...((res && res.existing) || [])][0]
        if (it && it.path) {
          if (!imgs.some((x) => x.path === it.path)) imgs.unshift({ path: it.path, name: it.originalName || file.name, thumb: it.thumb || it.path })
          sel.paths.add(it.path)
        }
      }
      PK.store.invalidate()
      paint()
    }
    const submit = async () => {
      if (!sel.paths.size && !sel.scenes.size) throw new PK.Error('请至少选择一张参考图或一个出场分镜')
      const body = { projectDir: dir, characterId: ch.id, name: ch.name, referenceType: sel.type, paths: [...sel.paths], sceneIds: [...sel.scenes] }
      const d = await PK.post('project/characters/attach', body)
      PK.toast(`已为「${ch.name}」添加 ${sel.paths.size} 张参考图、绑定 ${asArr(d && d.boundScenes).length} 个出场分镜${d && d.copiedFromGlobal ? '（已从全局角色库复制到本工程）' : ''}`, 'success')
      f.close('ok')
      PK.store.invalidate()
      await loadHTab(ctx, 'characters')
      ctx.load(true)
    }
    const paint = () => {
      const top = f.body.scrollTop
      PK.clear(f.body)
      PK.append(
        f.body,
        ui.note(
          ch.scope === 'global'
            ? '这是全局角色库里的角色：确认后会先把它复制到本工程的角色库（已有参考图会一起导入），再完成绑定。'
            : '参考图让 AI 生成图片 / 视频时照着画同一个人；绑定出场分镜后，这些分镜会自动带上这个角色的设定。',
          { level: 'info' },
        ),
        ui.section(
          { title: '添加参考图', en: 'REFERENCE IMAGES', icon: 'image', count: sel.paths.size || undefined, desc: '从工程的图片素材里点选（可多选），或上传新的参考图。' },
          ui.field({ label: '这批参考图是', en: 'TYPE' }, ui.seg({ value: sel.type, options: REF_TYPES.map(([v, l]) => ({ value: v, label: l })), onChange: (v) => (sel.type = v) })),
          imgs.length
            ? ui.grid(
                imgs.map((im) =>
                  ui.card({
                    key: `ref-${im.path}`,
                    media: ui.image(PK.assetUrl(im.thumb), { fit: 'cover', alt: im.name }),
                    aspect: '1 / 1',
                    title: im.name,
                    badge: sel.paths.has(im.path) ? '已选' : null,
                    active: sel.paths.has(im.path),
                    onClick: () => {
                      if (sel.paths.has(im.path)) sel.paths.delete(im.path)
                      else sel.paths.add(im.path)
                      paint()
                    },
                  }),
                ),
                { min: 118 },
              )
            : ui.hint('工程里还没有图片素材，点下面的「上传参考图」添加。'),
          ui.row([ui.file('上传参考图', upload, { accept: 'image/*', multiple: true, size: 'sm', busyText: '上传中…' })]),
        ),
        ui.section(
          { title: '出场分镜', en: 'BIND SCENES', icon: 'film', count: sel.scenes.size || undefined, desc: '勾选这个角色出场的分镜（已绑定的分镜不用再勾）。' },
          scenes.length
            ? ui.list(
                scenes.map((sc, i) =>
                  ui.item({
                    key: `at-${sc.id}`,
                    lead: p2((typeof sc.index === 'number' ? sc.index : i) + 1),
                    title: sc.title || sc.id,
                    sub: sc.id,
                    right: bound.has(sc.id)
                      ? [ui.pill('已绑定', 'ok', { dot: true })]
                      : [
                          ui.check({
                            value: sel.scenes.has(sc.id),
                            label: '出场',
                            onChange: (on) => {
                              if (on) sel.scenes.add(sc.id)
                              else sel.scenes.delete(sc.id)
                              updFoot()
                            },
                          }),
                        ],
                  }),
                ),
                { dense: true },
              )
            : ui.hint('当前工程还没有分镜。'),
        ),
      )
      f.body.scrollTop = top
      updFoot()
    }
    paint()
    return f
  }

  const renderChars = (ctx) => {
    const L = ctx.local
    const d = L.data.characters
    const f = L.charForm
    ctx.foot([
      ui.hint('提示词里写 @角色名 即可引用角色设定'),
      ui.spacer(),
      f.id
        ? ui.btn('取消编辑', () => {
            L.charForm = blankChar(f.scope)
            ctx.render()
          }, { kind: 'ghost' })
        : null,
      ui.btn(f.id ? '保存修改' : '保存角色', () => saveChar(ctx), { kind: 'primary', icon: 'check', busyText: '保存中…' }),
    ])
    const form = ui.section(
      {
        title: f.id ? `编辑角色「${f.editing}」` : '新建角色',
        en: f.id ? 'EDIT CHARACTER' : 'NEW CHARACTER',
        icon: 'user',
        desc: '把主角的名字、别名和外观描述存进角色库，AI 写分镜、生成图片和视频时会自动带上这些设定，让同一个人物在整部片子里保持一致。',
      },
      ui.grid(
        [
          ui.field({ label: '角色名称', en: 'NAME', required: true }, ui.input({ key: 'ch-name', value: f.name, maxLength: 80, placeholder: '例如：霍去病', onInput: (v) => (f.name = v) })),
          ui.field({ label: '别名', en: 'ALIASES', hint: '多个别名用逗号或顿号分隔' }, ui.input({ key: 'ch-alias', value: f.aliases, maxLength: 300, placeholder: '例如：冠军侯、霍将军', onInput: (v) => (f.aliases = v) })),
        ],
        { min: 220 },
      ),
      ui.field(
        { label: '外观描述', en: 'LOOK', hint: '写清楚年龄感、长相、发型、服装，越具体越一致' },
        ui.textarea({ key: 'ch-desc', value: f.description, rows: 3, maxRows: 10, maxLength: 2000, placeholder: '例如：十八岁少年将军，银甲红缨，剑眉星目，身披黑色披风', expand: { title: '角色外观描述' }, onInput: (v) => (f.description = v) }),
      ),
      ui.field(
        { label: '保存到', en: 'SCOPE', hint: f.id ? '编辑时不能更改保存位置' : '全局角色库里的角色，所有工程都能使用' },
        ui.seg({
          value: f.scope,
          disabled: Boolean(f.id),
          options: [
            { value: 'project', label: '本工程' },
            { value: 'global', label: '全局角色库' },
          ],
          onChange: (v) => (f.scope = v),
        }),
      ),
    )
    const chars = (d && Array.isArray(d.characters) && d.characters) || []
    const sScenes = scriptScenes(ctx)
    const listNode = !d
      ? tabLoading(ctx, 'characters', '正在读取角色库…')
      : chars.length
        ? ui.list(
            chars.map((ch) => {
              const refs = ch.references || {}
              const refCount = REF_TYPES.reduce((n, [k]) => n + asArr(refs[k]).length, 0)
              const boundIds = sScenes.filter((s) => Array.isArray(s.characterIds) && s.characterIds.includes(ch.id)).map((s) => s.id)
              const thumbs = ch.scope === 'global' ? [] : REF_TYPES.flatMap(([k, label]) => asArr(refs[k]).map((p) => ({ p, label }))).slice(0, 10)
              const global = ch.scope === 'global'
              return ui.item({
                key: `ch-${ch.scope}-${ch.id}`,
                icon: 'user',
                title: `${ch.name}${asArr(ch.aliases).length ? `（${asArr(ch.aliases).join('、')}）` : ''}`,
                sub: [
                  global ? '全局角色库' : '本工程',
                  refCount
                    ? `${refCount} 张参考图（${REF_TYPES.filter(([k]) => asArr(refs[k]).length).map(([k, l]) => `${l} ${asArr(refs[k]).length}`).join(' · ')}）`
                    : '还没有参考图',
                  boundIds.length ? `出场 ${boundIds.length} 个分镜` : '',
                ]
                  .filter(Boolean)
                  .join(' · '),
                body: [
                  ch.description ? ui.text(ch.description, { tone: 'muted' }) : null,
                  thumbs.length ? ui.row(thumbs.map((t) => refThumb(t.p, t.label, ch.name)), { wrap: true, gap: 6 }) : null,
                  boundIds.length ? ui.row(boundIds.map((id) => ui.tag(id)), { wrap: true }) : null,
                ],
                active: f.id === ch.id,
                right: [
                  ui.pill(global ? '全局' : '本工程', global ? 'acc' : 'mute'),
                  ui.btn('编辑', () => editChar(ctx, ch), { size: 'sm', icon: 'edit' }),
                  ui.btn('参考图 / 出场', () => openAttach(ctx, ch), { size: 'sm', icon: 'link', title: '添加参考图、绑定出场分镜' }),
                  ui.iconBtn('trash', () => deleteChar(ctx, ch), { title: `删除角色「${ch.name}」` }),
                ],
              })
            }),
          )
        : ui.empty({ icon: 'user', title: '角色库还是空的', text: '在上面填好名称和外观描述，点右下角「保存角色」即可。' })
    return [form, ui.section({ title: '角色库', en: 'CHARACTERS', icon: 'user', count: chars.length }, listNode)]
  }

  /* ---------------------------------------------------------------------------- tab: 免费素材 */
  const STOCK_HOST_RE = /^https:\/\/(?:images\.pexels\.com|videos\.pexels\.com|cdn\.pixabay\.com|pixabay\.com)\//i
  const stockSearch = async (ctx, page = 1) => {
    const L = ctx.local
    const s = L.stock
    const query = String(s.q || '').trim()
    if (!query) throw new PK.Error('请输入检索关键词，例如：咖啡 拉花')
    const out = await PK.api('POST', 'project/stock/search', {
      body: { query, mediaType: s.type, provider: s.provider, orientation: s.orientation || undefined, page, perPage: 18 },
      raw: true,
    })
    const b = (out && out.body) || {}
    if (b.configured === false) {
      L.stockRes = { ...b, page, query }
      ctx.render()
      return
    }
    if (U.num(out && out.status) >= 400 || b.ok === false) throw new PK.Error(String(b.error || b.message || '检索失败，请稍后再试'))
    L.stockRes = { ...b, page, query }
    ctx.render()
    ctx.body.scrollTop = 0
  }
  const stockImport = async (ctx, it) => {
    const L = ctx.local
    const body = { item: it, query: String((L.stockRes && L.stockRes.query) || L.stock.q || '').trim() }
    if (L.stock.sceneId) body.sceneId = L.stock.sceneId
    const d = await PK.postP('project/stock/import', body, { timeout: 900000 })
    const a = (d && d.asset) || {}
    PK.toast(`已导入素材库：${a.originalName || a.name || a.path || it.id}（已记录作者署名）${d && d.boundSceneId ? ` · 已替换到分镜 ${d.boundSceneId}` : ''}`, 'success')
    if (d && d.bindSkipped === 'scene-locked') PK.toast(`分镜 ${body.sceneId} 已锁定，没有替换它的画面（解锁后可再绑定）`, 'warn')
    L.imported[it.id] = true
    PK.store.invalidate()
    ctx.update()
  }
  const stockCard = (ctx, it) => {
    const thumb = STOCK_HOST_RE.test(String(it.thumb || '')) ? it.thumb : ''
    const done = Boolean(ctx.local.imported[it.id])
    return ui.card({
      key: `stk-${it.id}`,
      media: thumb
        ? h('img', { src: thumb, alt: it.alt || '', loading: 'lazy', referrerpolicy: 'no-referrer', draggable: 'false' })
        : h('div.pk-media-empty', null, PK.icon(it.mediaType === 'video' ? 'film' : 'image', 22)),
      aspect: '16 / 10',
      badge: it.mediaType === 'video' ? (it.durationSec ? `视频 ${U.fmtDur(it.durationSec)}` : '视频') : null,
      title: it.attribution || (it.provider === 'pixabay' ? 'Pixabay' : 'Pexels'),
      sub: [it.width && it.height ? `${it.width}×${it.height}` : '', it.provider === 'pixabay' ? 'Pixabay' : 'Pexels', it.license && it.license.name].filter(Boolean).join(' · '),
      actions: [
        ui.btn(done ? '已导入 · 再次导入' : '导入素材库', () => stockImport(ctx, it), { size: 'sm', kind: done ? 'secondary' : 'primary', icon: done ? 'check' : 'download', busyText: '下载导入中…' }),
      ],
    })
  }
  /* ---- free-stock API keys: saved with the cloud-media config (masked on read, never shown), .env still works */
  const STOCK_KEYS = [
    { id: 'pexels', name: 'Pexels', field: 'pexelsApiKey', clear: 'clearPexels', url: 'https://www.pexels.com/api/', how: '注册登录后打开 Pexels API 页面，点「Your API Key」即可看到并复制' },
    { id: 'pixabay', name: 'Pixabay', field: 'pixabayApiKey', clear: 'clearPixabay', url: 'https://pixabay.com/api/docs/', how: '登录后打开 Pixabay API 文档页，在「Parameters → key」一栏里就是你的 Key' },
  ]
  /** masked key status (cloud-media summary); the answer of a save wins for a few seconds until /state caught up */
  const stockKeyInfo = (ctx) => {
    const L = ctx.local
    if (L.stockKeyInfo && Date.now() - (L.stockKeyAt || 0) < 6000) return L.stockKeyInfo
    return (ctx.data && ctx.data.cloudMedia && ctx.data.cloudMedia.stock) || L.stockKeyInfo || null
  }
  const openSignup = async (p) => {
    const ok = await U.copyText(p.url)
    try {
      window.open(p.url, '_blank', 'noopener,noreferrer')
    } catch {}
    PK.toast(`已打开 ${p.name} 免费申请页面${ok ? '，网址也已复制' : ''}：${p.url}（如果没有弹出新网页，请粘贴到浏览器里打开）`, 'info', { timeout: 9000 })
  }
  const saveStockKeys = async (ctx) => {
    const L = ctx.local
    const patch = {}
    for (const p of STOCK_KEYS) {
      const v = String(L.stockKeys[p.id] || '').trim()
      if (v) patch[p.field] = v
    }
    if (!Object.keys(patch).length) throw new PK.Error('先把申请到的 API Key 粘贴到上面的输入框，再点「保存」')
    const res = await PK.post('cloud-media', { stock: patch })
    L.stockKeys = { pexels: '', pixabay: '' }
    L.keyTest = {}
    if (res && res.config && res.config.stock) {
      L.stockKeyInfo = res.config.stock
      L.stockKeyAt = Date.now()
    }
    L.keyOpen = false
    PK.toast('免费素材库 API Key 已保存（只保存在你的电脑上），现在就可以检索了', 'success')
    ctx.render()
    // the last search said 「未配置」: run it again right away
    if (L.stockRes && L.stockRes.configured === false && String(L.stock.q || '').trim()) await stockSearch(ctx, 1).catch((err) => PK.reportError(err))
  }
  const clearStockKey = async (ctx, p) => {
    const info = stockKeyInfo(ctx) || {}
    const k = info[p.id] || {}
    const ok = await PK.confirm({
      title: `清除已保存的 ${p.name} Key？`,
      text: k.hasEnvKey ? `清除后会改用 .env 里的 ${k.envKey || ''}。` : `清除后就不能再从 ${p.name} 检索素材了，之后可以重新填写。`,
      ok: '清除',
      danger: true,
    })
    if (!ok) return
    const res = await PK.post('cloud-media', { stock: { [p.clear]: true } })
    if (res && res.config && res.config.stock) {
      ctx.local.stockKeyInfo = res.config.stock
      ctx.local.stockKeyAt = Date.now()
    }
    delete ctx.local.keyTest[p.id]
    PK.toast(`已清除保存的 ${p.name} Key`, 'success')
    ctx.render()
  }
  const testStockKey = async (ctx, p) => {
    const L = ctx.local
    const typed = String(L.stockKeys[p.id] || '').trim()
    const out = await PK.api('POST', 'publish-pack/cover', { body: { action: 'stock-test', provider: p.id, apiKey: typed || undefined }, raw: true, timeout: 60000 })
    const b = (out && out.body) || {}
    L.keyTest[p.id] = { ok: b.ok === true, message: String(b.message || b.error || '测试失败，请稍后再试'), typed: Boolean(typed) }
    ctx.render()
  }
  const stockKeyPanel = (ctx) => {
    const L = ctx.local
    const info = stockKeyInfo(ctx)
    const any = Boolean(info && info.anyConfigured)
    const pills = STOCK_KEYS.map((p) => {
      const k = (info && info[p.id]) || {}
      return ui.pill(`${p.name} · ${k.sourceLabel || (k.configured ? '已配置' : '未配置')}`, k.configured ? 'ok' : 'mute', { dot: true })
    })
    if (any && !L.keyOpen) {
      return ui.row([...pills, ui.spacer(), ui.btn('管理 API Key', () => {
        L.keyOpen = true
        ctx.render()
      }, { size: 'sm', kind: 'ghost', icon: 'key' })], { wrap: true })
    }
    const fields = STOCK_KEYS.map((p) => {
      const k = (info && info[p.id]) || {}
      const ph = k.hasSavedKey
        ? `已保存（${k.savedKeyMasked || '***'}）· 不修改请留空`
        : k.hasEnvKey
          ? `正在用 .env 里的 Key（${k.envKeyMasked || '***'}）· 粘贴新 Key 可以覆盖`
          : `粘贴 ${p.name} API Key`
      const t = L.keyTest[p.id]
      return ui.field(
        {
          label: `${p.name} API Key`,
          en: p.id.toUpperCase(),
          aside: ui.pill(k.sourceLabel || '未配置', k.configured ? 'ok' : 'mute', { dot: true }),
          hint: p.how,
        },
        ui.stack(
          [
            ui.row(
              [
                growInput({ key: `stock-key-${p.id}`, type: 'password', value: L.stockKeys[p.id], placeholder: ph, maxLength: 512, autocomplete: 'new-password', title: false, onInput: (v) => (L.stockKeys[p.id] = v) }),
                ui.btn('测试连接', () => testStockKey(ctx, p), { size: 'sm', icon: 'check', busyText: '测试中…', title: '用输入框里的 Key（留空则用已保存的 Key）发一次请求试试' }),
              ],
              { wrap: true },
            ),
            ui.row(
              [
                ui.btn(`免费申请 ${p.name} Key`, () => openSignup(p), { size: 'sm', kind: 'link', icon: 'external', title: p.url }),
                k.hasSavedKey ? ui.btn('清除已保存的 Key', () => clearStockKey(ctx, p), { size: 'sm', kind: 'link', icon: 'trash' }) : null,
              ],
              { wrap: true },
            ),
            t ? ui.note(t.message, { level: t.ok ? 'ok' : 'error', title: t.ok ? '连接成功' : '连接失败' }) : null,
          ],
          { gap: 6 },
        ),
      )
    })
    return ui.section(
      {
        title: '免费素材库 API Key',
        en: 'PEXELS / PIXABAY KEYS',
        icon: 'key',
        desc: '两个素材库都可以免费申请 Key（填一个就能用）。粘贴后点「保存」立即生效，不需要改配置文件、不需要重启。Key 只保存在你的电脑上，界面里只显示打码后的样子。',
        actions: any ? [ui.btn('收起', () => {
          L.keyOpen = false
          ctx.render()
        }, { size: 'sm', kind: 'ghost' })] : null,
      },
      ui.grid(fields, { min: 260, fit: true }),
      ui.row([ui.hint('已经写在 .env 里的 PEXELS_API_KEY / PIXABAY_API_KEY 也照样能用；在这里保存的 Key 优先。'), ui.spacer(), ui.btn('保存', () => saveStockKeys(ctx), { kind: 'primary', icon: 'save', busyText: '保存中…' })], { wrap: true }),
    )
  }

  const renderStock = (ctx) => {
    const L = ctx.local
    const s = L.stock
    const res = L.stockRes
    const scenes = tlScenes()
    ctx.foot([ui.hint('素材来自 Pexels / Pixabay 官方 API，可免费商用；导入时会自动记录作者署名'), ui.spacer()])
    const search = () => stockSearch(ctx, 1)
    const form = ui.section(
      { title: '免费正版素材', en: 'FREE STOCK · PEXELS / PIXABAY', icon: 'search' },
      ui.row(
        [
          growInput({ key: 'st-q', type: 'search', value: s.q, maxLength: 200, placeholder: '输入关键词检索免版税图片 / 视频（中英文均可，例如：咖啡 拉花）', onInput: (v) => (s.q = v), onEnter: () => search().catch((e) => PK.reportError(e)) }),
          ui.seg({
            value: s.type,
            options: [
              { value: 'image', label: '图片', icon: 'image' },
              { value: 'video', label: '视频', icon: 'film' },
            ],
            onChange: (v) => (s.type = v),
          }),
          ui.btn('检索', search, { kind: 'primary', icon: 'search', busyText: '检索中…' }),
        ],
        { wrap: true },
      ),
      ui.grid(
        [
          ui.field(
            { label: '素材来源', en: 'SOURCE' },
            ui.select({
              value: s.provider,
              options: [
                { value: 'auto', label: '自动（优先 Pexels）' },
                { value: 'pexels', label: 'Pexels' },
                { value: 'pixabay', label: 'Pixabay' },
                { value: 'all', label: '两个都搜' },
              ],
              onChange: (v) => (s.provider = v),
            }),
          ),
          ui.field(
            { label: '画面方向', en: 'ORIENTATION' },
            ui.select({
              value: s.orientation,
              options: [
                { value: '', label: '不限' },
                { value: 'landscape', label: '横屏' },
                { value: 'portrait', label: '竖屏' },
                { value: 'square', label: '方形' },
              ],
              onChange: (v) => (s.orientation = v),
            }),
          ),
          ui.field(
            { label: '导入后', en: 'AFTER IMPORT', hint: '可选：导入后直接替换某个分镜的画面（锁定的分镜不会被替换）' },
            ui.select({
              value: s.sceneId,
              searchable: scenes.length > 10,
              options: [{ value: '', label: '只放进素材库' }, ...scenes.map((sc) => ({ value: sc.id, label: `替换 ${sc.id}${sc.title ? ` · ${sc.title}` : ''}`, hint: sc.locked ? '已锁定，不会被替换' : '' }))],
              onChange: (v) => (s.sceneId = v),
            }),
          ),
        ],
        { min: 200 },
      ),
    )
    let results
    const items = (res && (res.results || res.items)) || []
    if (!res) {
      results = ui.empty({ icon: 'image', title: '检索免版税的图片和视频', text: '素材来自 Pexels / Pixabay 官方 API，可免费商用；导入时会自动记录作者署名，方便片尾致谢。' })
    } else if (res.configured === false) {
      const anyKey = Boolean((stockKeyInfo(ctx) || {}).anyConfigured)
      results = ui.note(
        anyKey
          ? '所选的素材来源还没有 API Key：把「素材来源」改成「自动」，或者在上面给它填一个 Key。'
          : '在上面的「免费素材库 API Key」里粘贴 Pexels 或 Pixabay 的 Key（都可以免费申请），点「保存」后再点「检索」就可以了。',
        {
          level: 'warn',
          title: '还没有配置免费素材库 API Key',
          actions: [
            ui.btn('填写 API Key', () => {
              L.keyOpen = true
              ctx.render()
              ctx.body.scrollTop = 0
            }, { size: 'sm', kind: 'primary', icon: 'key' }),
          ],
        },
      )
    } else {
      const errs = Array.isArray(res.errors) ? res.errors : []
      const page = U.num(res.page, 1)
      results = [
        errs.length ? ui.note(errs.map((e) => `${e.provider}：${e.message}${e.rateLimited ? `（请 ${e.retryAfterSec || 60} 秒后再试）` : ''}`).join('；'), { level: 'warn', title: '部分素材源检索失败' }) : null,
        items.length
          ? ui.section(
              { title: `「${res.query}」的检索结果`, en: 'RESULTS', icon: 'image', count: items.length },
              ui.grid(items.map((it) => stockCard(ctx, it)), { min: 172 }),
              ui.row(
                [
                  ui.btn('上一页', () => stockSearch(ctx, page - 1), { size: 'sm', icon: 'chevL', disabled: page <= 1, busyText: '检索中…' }),
                  ui.hint(`第 ${page} 页`),
                  ui.btn('下一页', () => stockSearch(ctx, page + 1), { size: 'sm', icon: 'chevR', disabled: items.length < 18, busyText: '检索中…' }),
                ],
                { center: true },
              ),
            )
          : ui.empty({ icon: 'search', title: '没有找到匹配的素材', text: '换个关键词试试（英文关键词通常结果更多），或者把画面方向改成「不限」。' }),
      ]
    }
    return [stockKeyPanel(ctx), form, ...asArr(results)]
  }

  /* ---------------------------------------------------------------------------- tab: 云端账本 */
  const PLAN_SRC = {
    existing: ['已有画面', 'ok'],
    'user-assets': ['用你的素材', 'ok'],
    'free-stock': ['免费素材库', 'acc'],
    'paid-generation': ['付费 AI 生成', 'warn'],
    none: ['暂无来源', 'mute'],
    skip: ['跳过', 'mute'],
  }
  const planSection = (ctx, plan) => {
    if (!plan || !Array.isArray(plan.scenes)) return null
    const L = ctx.local
    const p = plan.policy || {}
    const sm = plan.summary || {}
    const sc = p.stockConfigured || {}
    const stockNames = [sc.pexels ? 'Pexels' : '', sc.pixabay ? 'Pixabay' : ''].filter(Boolean)
    return ui.section(
      {
        title: '自动补画面计划',
        en: 'B-ROLL SOURCING PLAN',
        icon: 'target',
        desc: '分镜缺画面时，AI 会按「你导入但还没用上的素材 → 免费正版素材库 → 付费 AI 生成」的顺序补齐，默认绝不花钱。下面是当前工程每个分镜的计划。',
      },
      ui.row(
        [
          ui.pill(stockNames.length ? `免费素材库：${stockNames.join(' / ')} 已配置` : '免费素材库：未配置', stockNames.length ? 'ok' : 'mute', { dot: true }),
          ui.pill(p.paidEnabled ? `付费生成：已开启（每次出片最多 ${p.maxPaidJobsPerRun} 个）` : '付费生成：未开启（不会产生费用）', p.paidEnabled ? 'warn' : 'ok', { dot: true }),
        ],
        { wrap: true },
      ),
      ui.row(
        [
          ['existing', sm.existing],
          ['user-assets', sm.userAssets],
          ['free-stock', sm.freeStock],
          ['paid-generation', sm.paid],
          ['none', sm.none],
          ['skip', sm.skipped],
        ].map(([k, n]) => ui.tag(`${PLAN_SRC[k][0]} ${U.num(n)}`)),
        { wrap: true },
      ),
      plan.scenes.length
        ? ui.btn(L.planOpen ? '收起每个分镜的计划' : `查看每个分镜的计划（${plan.scenes.length} 个）`, () => {
            L.planOpen = !L.planOpen
            ctx.render()
          }, { size: 'sm', kind: 'ghost', icon: L.planOpen ? 'chev' : 'chevR' })
        : null,
      L.planOpen
        ? ui.list(
            plan.scenes.map((s) => {
              const src = PLAN_SRC[s.source] || [s.source, 'mute']
              return ui.item({ key: `plan-${s.sceneId}`, title: `${s.sceneId}${s.title ? ` · ${s.title}` : ''}`, body: ui.hint(s.reason || ''), right: [ui.pill(src[0], src[1])] })
            }),
            { dense: true },
          )
        : null,
    )
  }
  const jobItem = (j) => {
    const [label, tone] = JOB_STATUS[j.status] || [j.status || '未知', 'mute']
    const cat = JOB_CAT[j.category] || j.category || j.kind || '云端任务'
    const results = Array.isArray(j.resultPaths) ? j.resultPaths.filter(Boolean) : []
    const err = j.error || j.lastError
    return ui.item({
      key: `job-${j.id}`,
      icon: j.category === 'video' ? 'film' : j.category === 'image' ? 'image' : 'music',
      title: `${cat} · ${j.provider || j.providerId || j.protocol || '云端服务'}${j.model ? ` · ${j.model}` : ''}`,
      sub: [
        fmtFull(j.createdAt),
        j.sceneId ? `分镜 ${j.sceneId}` : '',
        U.num(j.attempts) > 1 ? `第 ${j.attempts} 次尝试` : '',
        j.deliveredAs === 'project' ? '已入素材库' : j.deliveredAs === 'staging' || (j.stageOnly && j.status === 'completed') ? '在「待确认」区，确认后入库' : j.delivered ? '已交付' : '',
      ]
        .filter(Boolean)
        .join(' · '),
      body: [
        j.promptPreview || j.prompt ? ui.text(j.promptPreview || j.prompt, { tone: 'muted' }) : null,
        err ? ui.note(String(err), { level: j.status === 'billing_failed' || j.status === 'failed' ? 'error' : 'warn', title: j.status === 'billing_failed' ? '余额不足，已停止后续付费任务' : j.status === 'failed' ? '失败原因' : '最近一次错误' }) : null,
        results.length
          ? ui.row(
              results.map((rel) => {
                const nm = U.baseName(rel)
                const url = PK.assetUrl(normPath(rel))
                const kind = U.kindOfFile(nm)
                return kind === 'image'
                  ? ui.btn(nm, () => lightbox(url, { title: nm, download: nm }), { size: 'sm', icon: 'eye', title: rel })
                  : kind === 'video'
                    ? ui.btn(nm, () => lightbox(url, { title: nm, video: true, download: nm }), { size: 'sm', icon: 'play', title: rel })
                    : linkBtn(nm, url, { download: nm, icon: 'download', title: rel })
              }),
              { wrap: true },
            )
          : null,
      ],
      right: [ui.pill(label, tone, { dot: true })],
    })
  }
  const renderJobs = (ctx) => {
    const L = ctx.local
    const d = L.data.cloudjobs
    ctx.foot([ui.hint('同样的参数不会重复扣费；中断后可以续传结果'), ui.spacer(), ui.btn('刷新', () => loadHTab(ctx, 'cloudjobs'), { icon: 'refresh', kind: 'ghost' })])
    if (!d) return tabLoading(ctx, 'cloudjobs', '正在读取云端任务账本…')
    const counts = d.counts || {}
    const jobs = Array.isArray(d.jobs) ? d.jobs : []
    const failed = U.num(counts.failed) + U.num(counts.billing_failed)
    const head = ui.section(
      {
        title: '云端付费任务账本',
        en: 'PAID CLOUD JOBS',
        icon: 'cloud',
        count: U.num(d.total),
        desc: '每一次付费云端生成（图片 / 视频 / 音乐 / 云端配音）都会先记账再提交：同样的参数不会重复扣费，中断后可以续传结果；一旦余额不足会立刻停止后续的付费任务。',
      },
      ui.row([ui.stat(String(U.num(d.total)), '全部任务'), ui.stat(String(U.num(counts.completed)), '已完成'), ui.stat(String(failed), '失败'), ui.stat(String(U.num(d.resumable)), '可续传')], { wrap: true }),
      U.num(d.total)
        ? ui.chips({
            value: L.jobStatus,
            options: [{ value: '', label: `全部 ${U.num(d.total)}` }, ...Object.keys(JOB_STATUS).filter((k) => counts[k]).map((k) => ({ value: k, label: `${JOB_STATUS[k][0]} ${counts[k]}` }))],
            onChange: (v) => {
              L.jobStatus = v
              loadHTab(ctx, 'cloudjobs', { quiet: true })
            },
          })
        : null,
    )
    return [
      head,
      jobs.length
        ? ui.list(jobs.map(jobItem))
        : ui.empty({ icon: 'cloud', title: L.jobStatus ? '没有这个状态的任务' : '还没有云端付费任务', text: L.jobStatus ? '换一个状态筛选看看。' : '在「云端媒体」里生成图片、视频或音乐后，每一笔付费任务都会记录在这里。' }),
      planSection(ctx, d.sourcingPlan),
    ]
  }

  const TAB_RENDER = { history: renderVersions, locks: renderLocks, characters: renderChars, stock: renderStock, cloudjobs: renderJobs }

  const renderHistory = (ctx) => {
    const L = ctx.local
    const st = PK.state || {}
    const pj = st.project || {}
    ctx.setTitle('版本历史与工程安全', `PROJECT SAFETY${pj.title ? ` · ${pj.title}` : ''}`)
    const d = L.data
    const badge = {
      history: d.history ? U.num(d.history.total) || '' : '',
      locks: d.locks ? asArr(d.locks.lockedSceneIds).length || '' : '',
      characters: d.characters ? asArr(d.characters.characters).length || '' : '',
      cloudjobs: d.cloudjobs ? U.num(d.cloudjobs.total) || '' : '',
    }
    const tabs = ui.tabs({ value: L.tab, items: HISTORY_TABS.map((t) => ({ ...t, badge: badge[t.value] })), onChange: (v) => switchHTab(ctx, v) })
    let body
    try {
      body = TAB_RENDER[L.tab](ctx)
    } catch (err) {
      console.error('[PK] history tab failed', err)
      body = ui.errorBox(err, () => ctx.render())
    }
    return [tabs, ...asArr(body)]
  }

  PK.panel('history', {
    title: '版本历史与工程安全',
    en: 'PROJECT SAFETY · 版本 · 锁定 · 角色 · 素材 · 云端账本',
    idx: 'VH',
    icon: 'history',
    kind: 'modal',
    size: 'lg',
    group: 'tools',
    order: 62,
    desc: '版本恢复、分镜锁定、角色库、免费素材与云端账本',
    needsProject: true,
    aliases: {
      versions: { tab: 'history' },
      version: { tab: 'history' },
      safety: {},
      protools: {},
      proTools: {},
      projectSafety: {},
      locks: { tab: 'locks' },
      sceneLocks: { tab: 'locks' },
      characters: { tab: 'characters' },
      stock: { tab: 'stock' },
      cloudjobs: { tab: 'cloudjobs' },
      ledger: { tab: 'cloudjobs' },
    },
    watch: (st) => [st && st.project && st.project.dir, st && st.rev],
    onWatch(ctx) {
      if (!PK.hasProject()) return ctx.close()
      const L = ctx.local
      if (L.dir !== PK.dir()) {
        L.dir = PK.dir()
        L.data = {}
        L.err = {}
        L.stale = {}
        L.diffFor = ''
        L.diff = null
        L.backupSeq = 0
        L.stockRes = null
        L.imported = {}
        L.openOv = {}
        L.charForm = blankChar()
        for (const t of DATA_TABS) loadHTab(ctx, t, { quiet: t !== L.tab })
      } else {
        // data refresh after any change (ours or the pipeline's): reload the visible tab, mark the others stale
        clearTimeout(L.reloadT)
        L.reloadT = setTimeout(() => {
          for (const t of DATA_TABS) {
            if (t === L.tab) loadHTab(ctx, t, { quiet: true })
            else if (L.data[t]) L.stale[t] = true
          }
        }, 450)
      }
      ctx.load()
      return undefined
    },
    mount(ctx) {
      guardIme(ctx)
      const L = ctx.local
      const want = ctx.args && ctx.args.tab
      Object.assign(L, {
        tab: TAB_IDS.includes(want) && want !== 'lipsync' ? want : 'history',
        data: {},
        err: {},
        loading: {},
        stale: {},
        seq: {},
        dir: PK.dir(),
        snapNote: '',
        diffFor: '',
        diff: null,
        backupSeq: 0,
        lockFilter: 'all',
        lockQ: '',
        openOv: {},
        mergeOpen: false,
        charForm: blankChar(),
        stock: { q: '', type: 'image', provider: 'auto', orientation: '', sceneId: '' },
        stockRes: null,
        stockKeys: { pexels: '', pixabay: '' },
        keyTest: {},
        keyOpen: false,
        stockKeyInfo: null,
        stockKeyAt: 0,
        imported: {},
        jobStatus: '',
        planOpen: false,
        reloadT: 0,
      })
      ctx.onCleanup(() => clearTimeout(L.reloadT))
      if (want === 'lipsync') setTimeout(openLipsync, 0)
      for (const t of DATA_TABS) loadHTab(ctx, t, { quiet: t !== L.tab })
      ctx.load()
    },
    onArgs(ctx, a) {
      if (a && a.tab) switchHTab(ctx, a.tab)
      else ctx.render()
    },
    render: renderHistory,
  })
})()
