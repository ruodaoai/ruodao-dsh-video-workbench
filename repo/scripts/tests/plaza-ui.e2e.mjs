// 影核广场社区 UI check: the plaza panel's community views (模板广场 with 「刷新在线模板」 + 在线 badge, 投稿到影核广场 form +
// 将分享的内容, the generated package with its channels, 我的投稿) in the real router + standalone host + skins + kit,
// driven in headless Chrome. Checks clipped / overlapping / off-screen text (same rules as warroom-ui.e2e.mjs) and
// console errors at every viewport, and runs the real flow: online sync from a local fake catalogue → dry run → build
// the package → mark → list.
//
// usage: node scripts/tests/plaza-ui.e2e.mjs [--port 4474] [--viewports 1100x640,1920x1080] [--skins prism-lab,nova-deck,ink-loom]
//                                          [--shots <dir>] [--gpu] [--keep]
// Scratch data only (<repo>/.tmp/plaza-ui/<stamp>); the online catalogue is served by this script on 127.0.0.1; Explorer /
// Finder is never opened (DSH_PLAZA_REVEAL=0). Like warroom-ui.e2e.mjs, the standalone host loads React from a public CDN.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def
}
const GPU = args.includes('--gpu')
const KEEP = args.includes('--keep')
const PORT = Number(opt('--port', 4474))
if (PORT === 4399 || PORT === 4400) throw new Error('ports 4399 / 4400 are reserved for the user studios')
const VIEWPORTS = String(opt('--viewports', '1100x640,1920x1080'))
  .split(',')
  .map((v) => v.split('x').map(Number))
  .filter(([w, h]) => w > 0 && h > 0)
const SKIN_IDS = ['prism-lab', 'nova-deck', 'ink-loom']
const SKINS = String(opt('--skins', SKIN_IDS.join(',')))
  .split(',')
  .map((s) => s.trim())
  .filter((s) => SKIN_IDS.includes(s))
const SHOTS = opt('--shots', '')
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

// ---------------------------------------------------------------- scratch + fake online catalogue
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const scratch = join(ROOT, '.tmp', 'plaza-ui', stamp)
for (const d of ['ws', 'home', 'net']) mkdirSync(join(scratch, d), { recursive: true })
writeFileSync(join(scratch, 'empty.env'), '# intentionally empty\n')
process.env.DSH_VIDEO_ENV_PATH = join(scratch, 'empty.env')
process.env.DSH_VIDEO_WORKSPACE = join(scratch, 'ws')
process.env.DSH_VIDEO_HOME = join(scratch, 'home')
process.env.DSH_PLAZA_REVEAL = '0'
const sha = (b) => createHash('sha256').update(b).digest('hex')
const netTpl = join(scratch, 'net', 'templates', 'cinepulse-hub')
{
  // one "newly accepted" template: a copy of a shipped one under a new ID, so 「刷新在线模板」 has something to download
  const src = join(ROOT, 'templates', 'cinepulse-hub', 'data-ranking-story')
  const dest = join(netTpl, 'community-demo-story')
  cpSync(src, dest, { recursive: true })
  const meta = JSON.parse(readFileSync(join(dest, 'template.json'), 'utf8'))
  writeFileSync(join(dest, 'template.json'), JSON.stringify({ ...meta, id: 'community-demo-story', name: '社区投稿示例 · 数据榜单卡点', author: '社区作者', order: 60, updatedAt: new Date().toISOString() }, null, 2))
  const files = readdirSync(dest).map((n) => {
    const b = readFileSync(join(dest, n))
    return { name: n, size: b.length, sha256: sha(b) }
  })
  writeFileSync(join(netTpl, 'index.json'), JSON.stringify({ schema: 'dsh-plaza-index/1', plaza: '影核广场 · CinePulse Hub', generatedAt: new Date().toISOString(), count: 1, templates: [{ id: 'community-demo-story', title: '社区投稿示例', category: 'data-story', version: '1', files }] }, null, 2))
}
const { handleWorkbenchApiRequest } = await import('../../packages/dsh-web-video-workbench/lib/index.js')
const { standaloneShellHtml, apiRequestRejection, forwardApiRequest, sendJson, API_FORBIDDEN_MESSAGE } = await import('../dsh-runner.mjs')
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
    if (url.pathname.startsWith('/net/')) {
      const file = resolve(scratch, '.' + decodeURIComponent(url.pathname))
      if (!file.startsWith(join(scratch, 'net') + sep) || !existsSync(file) || statSync(file).isDirectory()) {
        res.statusCode = 404
        res.end('nf')
        return
      }
      res.end(readFileSync(file))
      return
    }
    if (url.pathname.startsWith('/api/')) {
      const why = apiRequestRejection(req, PORT)
      if (why) {
        sendJson(res, 403, { ok: false, error: API_FORBIDDEN_MESSAGE, reason: why })
        return
      }
    }
    if (url.pathname.startsWith('/api/video-workbench/')) {
      await forwardApiRequest(req, res, url, handleWorkbenchApiRequest)
      return
    }
    if (url.pathname === '/client.js') {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(readFileSync(join(ROOT, 'packages', 'dsh-web-video-workbench', 'lib', 'client.js'), 'utf8'))
      return
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(standaloneShellHtml('video'))
  } catch (err) {
    res.statusCode = 500
    res.end(String(err?.stack || err))
  }
})
await new Promise((r, j) => server.once('error', j).listen(PORT, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${PORT}/`
process.env.DSH_PLAZA_INDEX_URLS = `http://127.0.0.1:${PORT}/net/templates/cinepulse-hub/index.json`

// ---------------------------------------------------------------- browser
function findBrowser() {
  if (process.env.BROWSER && existsSync(process.env.BROWSER)) return process.env.BROWSER
  const exe = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell'
  for (const r of [ROOT, resolve(ROOT, '..'), resolve(ROOT, '..', '..'), resolve(ROOT, '..', '..', '..')]) {
    const base = join(r, 'node_modules', '.remotion', 'chrome-headless-shell')
    if (!existsSync(base)) continue
    const stack = [base]
    while (stack.length) {
      const d = stack.pop()
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (n === exe) return p
        try {
          if (statSync(p).isDirectory()) stack.push(p)
        } catch {}
      }
    }
  }
  return ''
}
const browserPath = findBrowser()
if (!browserPath) {
  console.error('[plaza-ui] no Chrome found — set BROWSER=<path to chrome / chrome-headless-shell>')
  server.close()
  process.exit(2)
}
const proc = spawn(
  browserPath,
  [
    '--headless', '--remote-debugging-port=0', `--user-data-dir=${join(scratch, 'chrome-profile')}`, '--no-first-run', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
    ...(GPU ? ['--use-angle=' + (process.platform === 'win32' ? 'd3d11' : 'default'), '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
console.log(`[plaza-ui] browser pid ${proc.pid}, server port ${PORT}`)
const wsUrl = await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('browser did not start')), 20000)
  proc.stderr.on('data', (d) => {
    const m = String(d).match(/DevTools listening on (ws:\/\/\S+)/)
    if (m) {
      clearTimeout(to)
      res(m[1])
    }
  })
})
const list = await (await fetch(wsUrl.replace(/^ws/, 'http').replace(/\/devtools\/browser\/.*/, '/json/list'))).json()
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map()
const consoleErrors = []
let gone = ''
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id).resolve(msg)
    pending.delete(msg.id)
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400))
  else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    consoleErrors.push(`${d.exception?.description || d.text} @${d.url || ''}:${d.lineNumber}`.slice(0, 600))
  }
})
const failAll = (why) => {
  if (!gone) gone = why
  for (const [, p] of pending) p.reject(new Error(why))
  pending.clear()
}
proc.on('exit', (code, signal) => failAll(`the test browser exited (code ${code}, signal ${signal})`))
ws.addEventListener('close', () => failAll('DevTools connection closed'))
const cdp = (method, params = {}, timeoutMs = 120000) =>
  new Promise((resolveP, reject) => {
    if (gone) return reject(new Error(gone))
    const i = ++seq
    const timer = setTimeout(() => {
      pending.delete(i)
      reject(new Error(`DevTools call ${method} timed out`))
    }, timeoutMs)
    pending.set(i, { resolve: (m) => (clearTimeout(timer), resolveP(m)), reject: (e) => (clearTimeout(timer), reject(e)) })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
await cdp('Runtime.enable')
await cdp('Page.enable')
const evaluate = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const viewport = (w, h) => cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
const shot = async (name) => {
  if (!SHOTS) return
  const r = await cdp('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64'))
}
const SW = "document.querySelector('iframe') && document.querySelector('iframe').contentWindow"
const waitFor = async (expr, timeout = 20000, label = expr) => {
  const t0 = Date.now()
  for (;;) {
    let v = null
    try {
      v = await evaluate(`(() => { try { return ${expr} } catch { return null } })()`)
    } catch (err) {
      if (gone) throw err
    }
    if (v) return v
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for: ${String(label).slice(0, 120)}`)
    await sleep(250)
  }
}
// the panel-layer overlap checker of warroom-ui.e2e.mjs (clipped / overlapping / off-screen text, textarea overlays)
const OVERLAP = `(() => {
  const w = ${SW}; if (!w) return ['no skin window']; const d = w.document
  const scope = d.getElementById('pk-root'); if (!scope) return ['no #pk-root']
  const vis = (e) => { const s = w.getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 }
  const visible = (e) => { const r = e.getBoundingClientRect(); let L = r.left, T = r.top, R = r.right, B = r.bottom
    for (let p = e.parentElement; p && p !== scope; p = p.parentElement) { const s = w.getComputedStyle(p)
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') { const c = p.getBoundingClientRect(); L = Math.max(L, c.left); T = Math.max(T, c.top); R = Math.min(R, c.right); B = Math.min(B, c.bottom) } }
    return { left: L, top: T, right: R, bottom: B, w: R - L, h: B - T, full: r } }
  const texts = [...scope.querySelectorAll('.pk-layer.is-open *')].filter((e) => vis(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
  const R = texts.map((e) => [e, visible(e)]).filter(([, r]) => r.w > 1 && r.h > 1)
  const bad = []
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    const [a, ra] = R[i], [b, rb] = R[j]; if (a.contains(b) || b.contains(a)) continue
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
    if (ox > 2 && oy > 2) bad.push('OVERLAP ' + a.textContent.trim().slice(0, 24) + ' ⟂ ' + b.textContent.trim().slice(0, 24)) }
  for (const [e, r] of R) { const s = w.getComputedStyle(e)
    if (e.scrollWidth > e.clientWidth + 1 && s.textOverflow !== 'ellipsis' && s.overflowX !== 'visible' && !/^(TEXTAREA|PRE|CODE|INPUT)$/.test(e.tagName)) bad.push('CLIPPED ' + e.textContent.trim().slice(0, 30))
    if (r.right > w.innerWidth + 1 || r.left < -1 || r.bottom > w.innerHeight + 1 || r.top < -1) bad.push('OFFSCREEN ' + e.textContent.trim().slice(0, 30)) }
  for (const ta of scope.querySelectorAll('.pk-layer.is-open .pk-ta > textarea')) { if (!vis(ta)) continue
    const tr = ta.getBoundingClientRect(); if (tr.width < 2 || tr.height < 2) continue
    const pr = parseFloat(w.getComputedStyle(ta).paddingRight) || 0, wrap = ta.parentElement
    const hit = (o) => { const r = o.getBoundingClientRect(); return Math.min(r.right, tr.right) - Math.max(r.left, tr.left) > 0.5 && Math.min(r.bottom, tr.bottom) - Math.max(r.top, tr.top) > 0.5 }
    for (const c of wrap.querySelectorAll('.pk-ta-count')) if (vis(c) && hit(c)) bad.push('TEXT-COVERED by counter in ' + (ta.value || ta.placeholder || '').slice(0, 20))
    for (const t of wrap.querySelectorAll('.pk-ta-tools')) if (vis(t) && hit(t) && t.getBoundingClientRect().left < tr.right - pr - 1) bad.push('TEXT-COVERED by ⤢ in ' + (ta.value || ta.placeholder || '').slice(0, 20)) }
  return bad.slice(0, 30) })()`
// scroll every scrollable area of the open panel through its whole height and collect issues on the way
const OVERLAP_SCROLLED = `(async () => {
  const w = ${SW}; const top = w.PK.topFrame(); if (!top) return ['no panel']
  const scrollers = [top.body, ...top.el.querySelectorAll('[data-pk-scroll]')].filter((e) => e && e.scrollHeight > e.clientHeight + 4)
  const all = new Set((${OVERLAP}))
  for (const s of scrollers) { for (let y = 0; y <= s.scrollHeight; y += Math.max(120, s.clientHeight * 0.8)) { s.scrollTop = y; await new Promise((r) => setTimeout(r, 120)); for (const x of (${OVERLAP})) all.add(x) } s.scrollTop = 0 }
  return [...all].slice(0, 30) })()`
const clickText = (text, scopeSel = '.pk-layer.is-open') => `(() => { const d = ${SW}.document; const b = [...d.querySelectorAll('${scopeSel} button')].find((x) => (x.textContent || '').trim() === ${JSON.stringify(text)} && !x.disabled); if (!b) return false; b.click(); return true })()`

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).slice(0, 400)}` : ''}`)
}
try {
  await viewport(1600, 900)
  await cdp('Page.navigate', { url: BASE })
  await waitFor(`${SW} && ${SW}.PK && ${SW}.PK.state`, 30000, 'skin ready')
  const created = await evaluate(`${SW}.PK.action('createProject', { title: '影核广场投稿 UI 测试' }, { timeout: 60000 }).then((d) => d && d.dir)`)
  await waitFor(`${SW}.PK.state.project && ${SW}.PK.state.project.dir === ${JSON.stringify(created || '')}`, 20000, 'project created')
  // a finished 20 s film so the package can cut a 15 s sample
  const { resolveBinaries } = await import('../../packages/shared/index.js')
  const projAbs = isAbsolute(created) ? created : join(process.env.DSH_VIDEO_WORKSPACE, created)
  mkdirSync(join(projAbs, 'output'), { recursive: true })
  const made = spawnSync(resolveBinaries().ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=20', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(projAbs, 'output', 'final.mp4')], { encoding: 'utf8', windowsHide: true }).status === 0
  await evaluate(`${SW}.PK.action('refresh', {}).then(() => true, () => false)`)
  await waitFor(`${SW}.PK.state.preview && ${SW}.PK.state.preview.hasMp4`, 20000, 'film in state')
  check('test project with a finished film', made && Boolean(created))

  for (const skin of SKINS) {
    if (skin !== 'prism-lab') {
      await viewport(1600, 900)
      await evaluate(`${SW}.PK.action('setSkin', { skin: ${JSON.stringify(skin)} }).then(() => true, () => false)`)
      await sleep(1500)
      await waitFor(`${SW} && ${SW}.PK && ${SW}.PK.skin === ${JSON.stringify(skin)} && ${SW}.PK.state && ${SW}.PK.state.project`, 30000, `skin ${skin}`)
      await sleep(1200)
    }
    const first = skin === SKINS[0]
    for (const [w, hgt] of VIEWPORTS) {
      await viewport(w, hgt)
      const tag = `${skin} @${w}x${hgt}`
      // ---- 模板广场 (+ 刷新在线模板 once)
      let before = consoleErrors.length
      await evaluate(`(() => { const PK = ${SW}.PK; PK.closeAll(); PK.open('plaza', { view: 'grid' }); return true })()`)
      await waitFor(`${SW}.document.querySelector('.pk-layer.is-open .pk-card')`, 20000, 'plaza cards')
      if (first && w === VIEWPORTS[0][0]) {
        const clicked = await evaluate(clickText('刷新在线模板'))
        const online = await waitFor(`[...${SW}.document.querySelectorAll('.pk-layer.is-open .pk-ops-cover-src.is-online')].length`, 30000, 'online card').catch(() => 0)
        check(`[${tag}] 刷新在线模板 downloads the accepted template (在线 badge)`, clicked && online >= 1, `clicked=${clicked} online=${online}`)
        await sleep(600)
      }
      await sleep(700)
      let issues = await evaluate(OVERLAP)
      await shot(`${skin}-plaza-grid-${w}x${hgt}`)
      check(`[${tag}] 模板广场`, issues.length === 0 && consoleErrors.length === before, [issues.join(' | '), consoleErrors.slice(before).join(' | ')].filter(Boolean).join(' ; '))

      // ---- 投稿到影核广场 (form + 将分享的内容)
      before = consoleErrors.length
      await evaluate(`(() => { const PK = ${SW}.PK; PK.closeAll(); PK.open('plaza', { view: 'submit' }); return true })()`)
      await waitFor(`${SW}.document.querySelector('.pk-layer.is-open .pk-ops-share') && [...${SW}.document.querySelectorAll('.pk-layer.is-open .pk-note')].some((n) => n.textContent.includes('隐私检查'))`, 30000, 'share list + privacy check')
      await sleep(500)
      issues = await evaluate(OVERLAP_SCROLLED)
      await shot(`${skin}-plaza-submit-${w}x${hgt}`)
      check(`[${tag}] 投稿表单 + 将分享的内容`, issues.length === 0 && consoleErrors.length === before, [issues.join(' | '), consoleErrors.slice(before).join(' | ')].filter(Boolean).join(' ; '))

      if (first && w === VIEWPORTS[0][0]) {
        // fill the form through the real inputs and build the package
        const filled = await evaluate(`(() => { const w = ${SW}; const d = w.document, ev = (el, v) => { el.focus(); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })) }
          const inputs = [...d.querySelectorAll('.pk-layer.is-open input.pk-input')]
          const byPh = (re) => inputs.find((i) => re.test(i.placeholder || ''))
          const title = byPh(/秋日咖啡馆/), author = byPh(/你的昵称/), tags = byPh(/温暖, 门店/)
          if (!title || !author) return false
          ev(title, '社区示例 · 秋日咖啡馆宣传片'); ev(author, 'UI 测试作者'); if (tags) ev(tags, '温暖, 门店')
          const box = d.querySelector('.pk-layer.is-open input.pk-check'); if (!box) return false; box.click(); return true })()`)
        await sleep(400)
        const enabled = await waitFor(`(() => { const b = [...${SW}.document.querySelectorAll('.pk-layer.is-open button')].find((x) => x.textContent.trim() === '生成投稿包'); return b && !b.disabled })()`, 10000, 'build enabled').catch(() => false)
        check('[flow] form filled through the inputs → 生成投稿包 enabled', filled && enabled, `filled=${filled} enabled=${enabled}`)
        await evaluate(clickText('生成投稿包'))
        const built = await waitFor(`[...${SW}.document.querySelectorAll('.pk-layer.is-open .pk-note')].some((n) => n.textContent.includes('投稿包已准备好'))`, 120000, 'package built').catch(() => false)
        check('[flow] 生成投稿包 → package view with channels', built)
        await sleep(800)
        const pk = await evaluate(`(() => { const d = ${SW}.document; return { channels: d.querySelectorAll('.pk-layer.is-open .pk-ops-channel').length, rows: d.querySelectorAll('.pk-layer.is-open .pk-table tbody tr').length, video: Boolean(d.querySelector('.pk-layer.is-open .pk-ops-player video')) } })()`)
        check('[flow] package view: 3 channels, 6 files, sample player', pk.channels === 3 && pk.rows === 6 && pk.video, JSON.stringify(pk))
        before = consoleErrors.length
        issues = await evaluate(OVERLAP_SCROLLED)
        await shot(`${skin}-plaza-package-${w}x${hgt}`)
        check(`[${tag}] 投稿包（发给作者）`, issues.length === 0 && consoleErrors.length === before, [issues.join(' | '), consoleErrors.slice(before).join(' | ')].filter(Boolean).join(' ; '))
        await evaluate(clickText('标记为已投稿', '.pk-layer.is-open .pk-frame-f'))
        await sleep(800)
      }

      // ---- 我的投稿 (+ 再次打开)
      before = consoleErrors.length
      await evaluate(`(() => { const PK = ${SW}.PK; PK.closeAll(); PK.open('plaza', { view: 'mine' }); return true })()`)
      await waitFor(`${SW}.document.querySelector('.pk-layer.is-open .pk-item')`, 20000, 'mine list')
      await sleep(600)
      const marked = await evaluate(`[...${SW}.document.querySelectorAll('.pk-layer.is-open .pk-item .pk-pill')].some((p) => p.textContent.includes('已投稿'))`)
      if (first && w === VIEWPORTS[0][0]) check('[flow] 我的投稿 lists the package marked 已投稿', marked)
      issues = await evaluate(OVERLAP)
      await shot(`${skin}-plaza-mine-${w}x${hgt}`)
      check(`[${tag}] 我的投稿`, issues.length === 0 && consoleErrors.length === before, [issues.join(' | '), consoleErrors.slice(before).join(' | ')].filter(Boolean).join(' ; '))
      before = consoleErrors.length
      await evaluate(clickText('再次打开'))
      await waitFor(`${SW}.document.querySelectorAll('.pk-layer.is-open .pk-ops-channel').length === 3`, 20000, 'reopened package')
      await sleep(600)
      issues = await evaluate(OVERLAP_SCROLLED)
      if (!first || w !== VIEWPORTS[0][0]) await shot(`${skin}-plaza-reopen-${w}x${hgt}`)
      check(`[${tag}] 再次打开投稿包`, issues.length === 0 && consoleErrors.length === before, [issues.join(' | '), consoleErrors.slice(before).join(' | ')].filter(Boolean).join(' ; '))
    }
  }
  await evaluate(`${SW}.PK.closeAll()`)
} catch (err) {
  check('plaza UI run finished', false, err?.stack || err)
} finally {
  try {
    ws.close()
  } catch {}
  try {
    proc.kill()
  } catch {}
  server.close()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — FAILED: ${failed.map((f) => f.name).join(' · ')}` : ''}`)
if (!KEEP) {
  await sleep(800)
  try {
    const { removeTreeNoFollow } = await import('../../packages/dsh-tool-media/safe-json-store.js')
    removeTreeNoFollow(scratch)
  } catch (err) {
    console.log(`(scratch cleanup incomplete: ${err?.message || err})`)
  }
}
process.exit(failed.length ? 1 : 0)
