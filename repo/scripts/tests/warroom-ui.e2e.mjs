// War-room UI end-to-end test: real plugin router + standalone host shell + the three skins + the native panel kit,
// driven in headless Chrome over the DevTools protocol.
//
// usage: node scripts/tests/warroom-ui.e2e.mjs [--port 4460] [--viewports 1100x640,1920x1080] [--skins prism-lab,nova-deck,ink-loom]
//                                              [--full] [--keep] [--shots <dir>] [--gpu]
//   --skins  skins to run the full matrix in (main screen + every panel/step at every viewport); default: all three
//   --full   also runs a real local-draft (免大模型) one-click pipeline through the skin and checks the rendered MP4
//   --keep   keep the scratch workspace (.tmp/e2e-warroom/<stamp>) for inspection
//   --shots  write a PNG per panel/viewport into <dir>
// Needs Node >= 22 (global WebSocket) and a Chrome / chrome-headless-shell (BROWSER env, or Remotion's bundled one).
// Uses only scratch data under <repo>/.tmp/e2e-warroom — never your real projects. React 18 is loaded by the shell from
// a public CDN (esm.sh / jsDelivr), so this test needs network access.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def
}
const FULL = args.includes('--full')
const KEEP = args.includes('--keep')
// --gpu: real GPU rendering (ANGLE/D3D11 on Windows). The default software renderer (SwiftShader) is portable but ~4× slower;
// the animated skins can starve frame production under load, which makes screenshots time out.
const GPU = args.includes('--gpu')
const PORT = Number(opt('--port', 4460))
if (PORT === 4399) throw new Error('port 4399 is reserved for the user studio')
const VIEWPORTS = String(opt('--viewports', '1100x640,1920x1080'))
  .split(',')
  .map((v) => v.split('x').map(Number))
  .filter(([w, h]) => w > 0 && h > 0)
const SKIN_IDS = ['prism-lab', 'nova-deck', 'ink-loom']
const SKINS = String(opt('--skins', SKIN_IDS.join(',')))
  .split(',')
  .map((s) => s.trim())
  .filter((s) => SKIN_IDS.includes(s))
if (!SKINS.length) throw new Error(`--skins must list some of: ${SKIN_IDS.join(', ')}`)
const SHOTS = opt('--shots', '')
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

// ---------------------------------------------------------------- scratch workspace + plugin router
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const scratch = join(ROOT, '.tmp', 'e2e-warroom', stamp)
mkdirSync(join(scratch, 'ws'), { recursive: true })
mkdirSync(join(scratch, 'home'), { recursive: true })
process.env.DSH_VIDEO_WORKSPACE = join(scratch, 'ws')
process.env.DSH_VIDEO_HOME = join(scratch, 'home')
const { handleWorkbenchApiRequest } = await import('../../packages/dsh-web-video-workbench/lib/index.js')
// the studio runner's own guard + forwarding, so this test exercises exactly what the user's studio runs
const { standaloneShellHtml, apiRequestRejection, forwardApiRequest, sendJson, API_FORBIDDEN_MESSAGE } = await import('../dsh-runner.mjs')

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
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

// ---------------------------------------------------------------- browser
function findBrowser() {
  if (process.env.BROWSER && existsSync(process.env.BROWSER)) return process.env.BROWSER
  const exe = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell'
  const roots = [ROOT, resolve(ROOT, '..'), resolve(ROOT, '..', '..'), resolve(ROOT, '..', '..', '..')]
  for (const r of roots) {
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
  console.error('[e2e] no Chrome found — set BROWSER=<path to chrome / chrome-headless-shell>')
  server.close()
  process.exit(2)
}
const profile = join(scratch, 'chrome-profile')
const proc = spawn(
  browserPath,
  [
    '--headless', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
    ...(GPU ? ['--use-angle=' + (process.platform === 'win32' ? 'd3d11' : 'default'), '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
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
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id).resolve(msg)
    pending.delete(msg.id)
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400))
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    consoleErrors.push(`${d.exception?.description || d.text} @${d.url || ''}:${d.lineNumber}`.slice(0, 600))
  }
})
// Fail fast instead of hanging: every DevTools call has a timeout, and if the browser exits (crash, or killed by another
// process) or the connection drops, all pending calls are rejected with a clear message.
let browserGone = ''
const failPending = (why) => {
  if (!browserGone) browserGone = why
  for (const [, p] of pending) p.reject(new Error(why))
  pending.clear()
}
proc.on('exit', (code, signal) => failPending(`the test browser exited (code ${code}, signal ${signal}) — crashed, or killed by another process`))
ws.addEventListener('close', () => failPending('the DevTools connection to the test browser closed'))
const cdp = (method, params = {}, timeoutMs = 120000) =>
  new Promise((resolve, reject) => {
    if (browserGone) return reject(new Error(browserGone))
    const i = ++seq
    const timer = setTimeout(() => {
      pending.delete(i)
      reject(new Error(`DevTools call ${method} got no answer within ${timeoutMs / 1000} s`))
    }, timeoutMs)
    pending.set(i, {
      resolve: (msg) => (clearTimeout(timer), resolve(msg)),
      reject: (err) => (clearTimeout(timer), reject(err)),
    })
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
// in-page helpers (skin window = SW)
const SW = "document.querySelector('iframe') && document.querySelector('iframe').contentWindow"
const waitFor = async (expr, timeout = 20000, label = expr) => {
  const t0 = Date.now()
  for (;;) {
    let v = null
    try {
      v = await evaluate(`(() => { try { return ${expr} } catch { return null } })()`)
    } catch (err) {
      if (browserGone) throw err // no point polling a dead browser
    }
    if (v) return v
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for: ${label}`)
    await sleep(250)
  }
}
const OVERLAP = `(() => {
  const w = ${SW}; if (!w) return ['no skin window']; const d = w.document
  const scope = d.getElementById('pk-root'); if (!scope) return ['no #pk-root']
  const vis = (e) => { const s = w.getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 }
  // the part of an element that is actually visible: its box clipped by every overflow-clipping ancestor
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
  // a textarea's typed text is not a text node, so check its overlays explicitly: the counter must sit outside the box,
  // the ⤢ tools inside the box's reserved right padding (the user complained about text hidden behind them)
  for (const ta of scope.querySelectorAll('.pk-layer.is-open .pk-ta > textarea')) { if (!vis(ta)) continue
    const tr = ta.getBoundingClientRect(); if (tr.width < 2 || tr.height < 2) continue
    const pr = parseFloat(w.getComputedStyle(ta).paddingRight) || 0, wrap = ta.parentElement
    const hit = (o) => { const r = o.getBoundingClientRect(); return Math.min(r.right, tr.right) - Math.max(r.left, tr.left) > 0.5 && Math.min(r.bottom, tr.bottom) - Math.max(r.top, tr.top) > 0.5 }
    for (const c of wrap.querySelectorAll('.pk-ta-count')) if (vis(c) && hit(c)) bad.push('TEXT-COVERED by counter in ' + (ta.value || ta.placeholder || '').slice(0, 20))
    for (const t of wrap.querySelectorAll('.pk-ta-tools')) if (vis(t) && hit(t) && t.getBoundingClientRect().left < tr.right - pr - 1) bad.push('TEXT-COVERED by ⤢ in ' + (ta.value || ta.placeholder || '').slice(0, 20)) }
  return bad.slice(0, 30) })()`
// same checks for the skin's own main screen (everything outside the kit layer #pk-root); an element counts as visible
// only if it and all its ancestors are visible (opacity is multiplied down the tree, like the browser paints it)
const MAIN_OVERLAP = `(() => {
  const w = ${SW}; if (!w) return ['no skin window']; const d = w.document; const kit = d.getElementById('pk-root')
  const vis = (e) => { let op = 1; for (let p = e; p && p !== d.documentElement; p = p.parentElement) { const s = w.getComputedStyle(p)
      if (s.display === 'none' || (p === e && s.visibility === 'hidden')) return false; op *= +s.opacity; if (op <= 0.05) return false }
    return true }
  const visible = (e) => { const r = e.getBoundingClientRect(); let L = r.left, T = r.top, R = r.right, B = r.bottom
    for (let p = e.parentElement; p && p !== d.body; p = p.parentElement) { const s = w.getComputedStyle(p)
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') { const c = p.getBoundingClientRect(); L = Math.max(L, c.left); T = Math.max(T, c.top); R = Math.min(R, c.right); B = Math.min(B, c.bottom) } }
    return { left: L, top: T, right: R, bottom: B, w: R - L, h: B - T } }
  const texts = [...d.querySelectorAll('body *')].filter((e) => !(kit && kit.contains(e)) && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(e.tagName)
    && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && vis(e))
  const R = texts.map((e) => [e, visible(e)]).filter(([, r]) => r.w > 1 && r.h > 1)
  const bad = []
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    const [a, ra] = R[i], [b, rb] = R[j]; if (a.contains(b) || b.contains(a)) continue
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
    if (ox > 2 && oy > 2) bad.push('OVERLAP ' + a.textContent.trim().slice(0, 24) + ' ⟂ ' + b.textContent.trim().slice(0, 24)) }
  for (const [e, r] of R) { const s = w.getComputedStyle(e)
    if (e.scrollWidth > e.clientWidth + 1 && s.textOverflow !== 'ellipsis' && s.overflowX !== 'visible' && !/^(TEXTAREA|PRE|CODE|INPUT)$/.test(e.tagName)) bad.push('CLIPPED ' + e.textContent.trim().slice(0, 30))
    if (r.right > w.innerWidth + 1 || r.left < -1 || r.bottom > w.innerHeight + 1 || r.top < -1) bad.push('OFFSCREEN ' + e.textContent.trim().slice(0, 30)) }
  return bad.slice(0, 30) })()`

// text problems inside one element of the skin (the skin's own dialogs, the film viewer): overlapping / clipped /
// off-screen text, and with avoidSel: text lying on a control (e.g. a dialog's close button)
const TEXT_ISSUES_IN = (sel, avoidSel = '') => `(() => {
  const w = ${SW}; if (!w) return ['no skin window']; const d = w.document; const scope = d.querySelector(${JSON.stringify(sel)}); if (!scope) return ['missing ' + ${JSON.stringify(sel)}]
  const vis = (e) => { let op = 1; for (let p = e; p && p !== d.documentElement; p = p.parentElement) { const s = w.getComputedStyle(p)
      if (s.display === 'none' || (p === e && s.visibility === 'hidden')) return false; op *= +s.opacity; if (op <= 0.05) return false }
    return true }
  const visible = (e) => { const r = e.getBoundingClientRect(); let L = r.left, T = r.top, R = r.right, B = r.bottom
    for (let p = e.parentElement; p && p !== d.body; p = p.parentElement) { const s = w.getComputedStyle(p)
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') { const c = p.getBoundingClientRect(); L = Math.max(L, c.left); T = Math.max(T, c.top); R = Math.min(R, c.right); B = Math.min(B, c.bottom) } }
    return { left: L, top: T, right: R, bottom: B, w: R - L, h: B - T } }
  const texts = [...scope.querySelectorAll('*')].filter((e) => !/^(SCRIPT|STYLE)$/.test(e.tagName) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && vis(e))
  const R = texts.map((e) => [e, visible(e)]).filter(([, r]) => r.w > 1 && r.h > 1)
  const bad = []
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    const [a, ra] = R[i], [b, rb] = R[j]; if (a.contains(b) || b.contains(a)) continue
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
    if (ox > 2 && oy > 2) bad.push('OVERLAP ' + a.textContent.trim().slice(0, 24) + ' ⟂ ' + b.textContent.trim().slice(0, 24)) }
  for (const [e, r] of R) { const s = w.getComputedStyle(e)
    if (e.scrollWidth > e.clientWidth + 1 && s.textOverflow !== 'ellipsis' && s.overflowX !== 'visible' && !/^(TEXTAREA|PRE|CODE|INPUT)$/.test(e.tagName)) bad.push('CLIPPED ' + e.textContent.trim().slice(0, 30))
    if (r.right > w.innerWidth + 1 || r.left < -1 || r.bottom > w.innerHeight + 1 || r.top < -1) bad.push('OFFSCREEN ' + e.textContent.trim().slice(0, 30)) }
  const avoid = ${JSON.stringify(avoidSel)}
  if (avoid) for (const c of scope.querySelectorAll(avoid)) { if (!vis(c)) continue; const cr = c.getBoundingClientRect()
    for (const [e, r] of R) { if (c.contains(e)) continue
      const ox = Math.min(cr.right, r.right) - Math.max(cr.left, r.left), oy = Math.min(cr.bottom, r.bottom) - Math.max(cr.top, r.top)
      if (ox > 2 && oy > 2) bad.push('ON ' + (c.getAttribute('aria-label') || c.tagName) + ' ⟂ ' + e.textContent.trim().slice(0, 24)) } }
  return bad.slice(0, 30) })()`
// each skin's own 「全屏观看」 entry (棱镜: finder bar 「全屏」, 星舰: monitor ⤢, 墨韵: ⤢ on the monitor corner)
const FILM_ENTRY = { 'prism-lab': '#vfFull', 'nova-deck': '#mon-exp', 'ink-loom': '#monFull' }

// ---------------------------------------------------------------- checks
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).slice(0, 300)}` : ''}`)
}
try {
  await viewport(1600, 900)
  await cdp('Page.navigate', { url: BASE })
  await waitFor(`${SW} && ${SW}.PK && ${SW}.PK.state`, 30000, 'skin ready + first state')
  const boot = await evaluate(`(() => { const w = ${SW}; return { skin: w.PK.skin, stateSkin: w.PK.state.skin, hostText: document.body.innerText.slice(0, 400) } })()`)
  check('default skin is 棱镜实验室 (prism-lab)', boot.skin === 'prism-lab' && boot.stateSkin === 'prism-lab', JSON.stringify(boot.skin))
  check('host renders no classic UI', !/经典|DeepSeek 对话|分步精修|任务中心/.test(boot.hostText), boot.hostText.slice(0, 80))

  // project + assets + director round trip
  const created = await evaluate(`${SW}.PK.action('createProject', { title: 'E2E 作战大屏测试工程' }, { timeout: 60000 }).then((d) => d && d.dir)`)
  await waitFor(`${SW}.PK.state.project && ${SW}.PK.state.project.dir === ${JSON.stringify(created || '')}`, 20000, 'project created')
  check('createProject → state.project', Boolean(created))
  const imported = await evaluate(`(async () => { const w = ${SW}; const c = w.document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); g.fillStyle = '#2F37FF'; g.fillRect(0, 0, 320, 180); g.fillStyle = '#fff'; g.font = '28px sans-serif'; g.fillText('E2E', 120, 100)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png')); const f = new w.File([blob], 'e2e-cover.png', { type: 'image/png' }); return w.PK.importFiles([f]) })()`)
  await waitFor(`${SW}.PK.state.assets.length >= 1`, 20000, 'asset imported')
  check('importFiles → state.assets', imported >= 1, `count=${imported}`)
  // long file names: 墨韵 shows pictures two per row and a name must never widen the columns
  const longNamed = await evaluate(`(async () => { const w = ${SW}; const files = []
    for (const [name, color] of [['ui_05_studio_timeline_overview_long_name.png', '#FF5A1F'], ['ui_06_voice_center_catalog_long_name.png', '#00B89C'], ['ui_03_studio_assets_and_media_long_name.png', '#F2A900']]) {
      const c = w.document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 320, 180)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png')); files.push(new w.File([blob], name, { type: 'image/png' })) }
    return w.PK.importFiles(files) })()`)
  await waitFor(`${SW}.PK.state.assets.length >= 4`, 20000, 'long-named assets imported').catch(() => {})
  check('importFiles with long file names', longNamed >= 3, `count=${longNamed}`)
  await evaluate(`${SW}.PK.action('setDirector', { patch: { displayTitle: 'E2E 标题', aiBadgeText: 'AI 辅助', contentOutline: ['第一步', '第二步'], speechTempo: 1.1, topic: '为一家社区咖啡馆做一支 30 秒的秋季新品宣传片' } })`)
  const rt = await waitFor(`(() => { const s = ${SW}.PK.state; return s.director.displayTitle === 'E2E 标题' && s.director.aiBadgeText === 'AI 辅助' && s.director.contentOutline.length === 2 && s.runOptions.speechTempo === 1.1 && s.director.topic.includes('咖啡馆') })()`, 8000, 'director round trip').catch((e) => e)
  check('setDirector round trip (brief + params + run options)', rt === true, rt instanceof Error ? rt.message : '')
  // the brief must also reach script.json (it used to live only in memory: reopening the project restored the old one)
  // (bind PK first: SW is `a && b`, and `await ${SW}…` would await only the left operand)
  const saved = await waitFor(`(async () => { const PK = ${SW}.PK; const st = await PK.store.load(true); const sc = st.activeProject && st.activeProject.script
    return sc && String(sc.goal || '').includes('咖啡馆') && sc.displayTitle === 'E2E 标题' && Array.isArray(sc.contentOutline) && sc.contentOutline.length === 2 ? 'saved' : null })()`, 10000, 'brief persisted').catch((e) => e.message)
  check('brief edits are saved to the project (script.goal / title / outline)', saved === 'saved', saved)
  // 人物画风: the pick and its description reach the panel state and script.json; the director step shows the description
  // box only for 自定义, and a pick back to AI-decides keeps the typed description for later
  {
    await evaluate(`${SW}.PK.action('setDirector', { patch: { figureStyleChoice: 'custom', figureStyleChoiceNote: 'Q版萌系，圆脸大眼' } })`)
    const fsState = await waitFor(`(() => { const d = ${SW}.PK.state.director; return d.figureStyleChoice === 'custom' && d.figureStyleChoiceNote === 'Q版萌系，圆脸大眼' })()`, 8000, '人物画风 state').catch((e) => e)
    const fsSaved = await waitFor(`(async () => { const PK = ${SW}.PK; const st = await PK.store.load(true); const sc = st.activeProject && st.activeProject.script
      return sc && sc.figureStyleChoice === 'custom' && sc.figureStyleChoiceNote === 'Q版萌系，圆脸大眼' ? 'saved' : null })()`, 10000, '人物画风 saved').catch((e) => e.message)
    await evaluate(`(() => { const PK = ${SW}.PK; PK.closeAll(); PK.open('studio', { step: 'director' }); return true })()`)
    const fsBox = await waitFor(`(() => { const top = ${SW}.PK.topFrame(); if (!top) return null; const ta = top.body.querySelector('[aria-label="想要的人物画风"]')
      return ta && ta.value === 'Q版萌系，圆脸大眼' && /人物画风/.test(top.body.innerText) ? 'shown' : null })()`, 10000, '人物画风 description box').catch((e) => e.message)
    if (fsBox === 'shown' && SHOTS) {
      await evaluate(`(() => { const top = ${SW}.PK.topFrame(); const ta = top && top.body.querySelector('[aria-label="想要的人物画风"]'); if (ta) ta.scrollIntoView({ block: 'center' }); return true })()`)
      await sleep(600)
      await shot('studio-figure-style')
    }
    await evaluate(`${SW}.PK.action('setDirector', { patch: { figureStyleChoice: 'auto' } })`)
    const fsGone = await waitFor(`(() => { const top = ${SW}.PK.topFrame(); return top && ${SW}.PK.state.director.figureStyleChoice === 'auto' && !top.body.querySelector('[aria-label="想要的人物画风"]') && ${SW}.PK.state.director.figureStyleChoiceNote === 'Q版萌系，圆脸大眼' ? 'hidden' : null })()`, 10000, '人物画风 back to auto').catch((e) => e.message)
    await evaluate(`${SW}.PK.closeAll()`)
    check('人物画风 pick: state, saved to script.json, description box only for 自定义', fsState === true && fsSaved === 'saved' && fsBox === 'shown' && fsGone === 'hidden', JSON.stringify({ fsState: fsState === true || String(fsState), fsSaved, fsBox, fsGone }))
  }
  // a stale brief left by an old skin bug ("【一句话】undefined", flattened to one line) never reaches the war room
  const staleBrief = await evaluate(`(async () => { const PK = ${SW}.PK; const dir = PK.state.project.dir
    const st = await PK.store.load(true); const sc = st.activeProject && st.activeProject.script; if (!sc) return 'no script'
    await PK.post('script', { projectDir: dir, regenerateCode: false, script: { ...sc, goal: '【作品标题】E2E 标题【一句话】undefined【导演备注（仅供 AI 制作，不会出现在视频里）】温暖治愈的秋日氛围' } })
    await PK.action('refresh', { syncForm: true }); return 'ok' })()`).catch((e) => e.message)
  const staleTopic = staleBrief === 'ok' ? await waitFor(`(() => { const t = ${SW}.PK.state.director.topic; return t.includes('温暖治愈') ? t : null })()`, 10000, 'stale brief re-hydrated').catch(() => '') : ''
  check('stale 「【一句话】undefined」 brief is cleaned in the war room', staleBrief === 'ok' && staleTopic && !/undefined/.test(staleTopic), staleBrief === 'ok' ? String(staleTopic).slice(0, 80) : staleBrief)
  const denied = await evaluate(`${SW}.PK.api('GET', 'projects/delete').then(() => 'allowed', (e) => e.message)`)
  check('api proxy refuses routes outside the allow-list', /未开放/.test(denied), denied)
  // the local server refuses other websites (CSRF / DNS rebinding) while the studio page above keeps working
  {
    const evil = await fetch(new URL('api/video-workbench/state', BASE), { headers: { Origin: 'https://evil.example' } }).then((r) => r.status, (e) => e.message)
    const rebind = await fetch(new URL('api/video-workbench/state', BASE), { headers: { 'Sec-Fetch-Site': 'cross-site' } }).then((r) => r.status, (e) => e.message)
    const local = await fetch(new URL('api/video-workbench/state', BASE)).then((r) => r.status, (e) => e.message)
    check('local API refuses requests from other websites', evil === 403 && rebind === 403 && local === 200, `foreign-origin=${evil} cross-site=${rebind} local-tool=${local}`)
  }

  // a finished film (a 3-second test clip) so every skin shows its 「成片」 state, its film controls and 全屏观看
  let filmUrl = ''
  {
    const { resolveBinaries } = await import('../../packages/shared/index.js')
    const projAbs = created ? (isAbsolute(created) ? created : join(process.env.DSH_VIDEO_WORKSPACE, created)) : ''
    let made = false
    if (projAbs) {
      mkdirSync(join(projAbs, 'output'), { recursive: true })
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(projAbs, 'output', 'final.mp4')]
      made = spawnSync(resolveBinaries().ffmpeg, args, { encoding: 'utf8', windowsHide: true }).status === 0
    }
    await evaluate(`${SW}.PK.action('refresh', {}).then(() => true, () => false)`)
    filmUrl = made ? await waitFor(`(() => { const p = ${SW}.PK.state.preview; return p && p.hasMp4 && p.mp4Url ? p.mp4Url : null })()`, 20000, 'film in state').catch(() => '') : ''
    check('a finished film reaches the skins (preview.hasMp4 + mp4Url)', Boolean(filmUrl), made ? String(filmUrl) : 'ffmpeg could not make the test clip')
  }

  // a toast must never cover the footer buttons of the open panel (skins dock toasts away from panel footers).
  // Returns null when the open panel has no footer buttons, else a list of problems.
  const TOAST_COVER = `(async () => {
    const w = ${SW}; const d = w.document; const top = w.PK.topFrame(); if (!top) return ['no panel open']
    const box = (e) => e.getBoundingClientRect()
    const btns = [...top.el.querySelectorAll('.pk-frame-f button, .pk-frame-f [role=button]')].filter((b) => { const r = box(b); return r.width > 2 && r.height > 2 })
    if (!btns.length) return null
    const probe = 'E2E 提示条遮挡检测 ' + Date.now()
    w.PK.toast(probe, 'info', { timeout: 2500 })
    await new Promise((r) => setTimeout(r, 900))
    const textEl = [...d.querySelectorAll('body *')].find((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes(probe)))
    if (!textEl) return ['toast not rendered']
    // the toast card: the largest ancestor that is still small (≤ 25 % of the viewport), i.e. not a full-screen layer
    const area = w.innerWidth * w.innerHeight
    let card = textEl
    for (let p = textEl.parentElement; p && p !== d.body; p = p.parentElement) { const r = box(p); if (r.width * r.height <= area * 0.25) card = p; else break }
    const t = box(card), bad = []
    for (const b of btns) { const r = box(b)
      const ox = Math.min(t.right, r.right) - Math.max(t.left, r.left), oy = Math.min(t.bottom, r.bottom) - Math.max(t.top, r.top)
      if (ox > 2 && oy > 2) bad.push('TOAST covers footer button 「' + (b.textContent || '').trim().slice(0, 16) + '」') }
    return bad })()`
  // every skin: main screen + every panel / studio step, at every viewport (each skin restyles the same kit panels)
  for (const skin of SKINS) {
    const beforeSkin = consoleErrors.length
    await viewport(1600, 900)
    await evaluate(`${SW}.PK.action('setSkin', { skin: ${JSON.stringify(skin)} }).then(() => true, () => false)`)
    const ok = await waitFor(`${SW} && ${SW}.PK && ${SW}.PK.skin === ${JSON.stringify(skin)} && ${SW}.PK.state && ${SW}.PK.state.skin === ${JSON.stringify(skin)}`, 30000, `skin ${skin}`).catch(() => false)
    await sleep(1500)
    await shot(`${skin}-main`)
    const classic = ok ? await evaluate(`(() => { const d = ${SW}.document; return [...d.querySelectorAll('button,[role=button],a')].some((b) => /经典/.test(b.textContent || '')) })()`) : false
    check(`[${skin}] skin loads (no 「经典」 option)`, ok && !classic && consoleErrors.length === beforeSkin, [ok ? '' : 'did not load', classic ? 'still offers 经典' : '', consoleErrors.slice(beforeSkin).join(' | ')].filter(Boolean).join(' ; '))
    if (!ok) continue

    const panels = await evaluate(`[...${SW}.PK.panels.keys()]`)
    const steps = await evaluate(`[...${SW}.PK.studioSteps.keys()]`)
    check(`[${skin}] panel kit registered panels`, panels.length >= 10, panels.join(','))
    const targets = [...panels.filter((p) => p !== 'studio').map((p) => [p, {}]), ['plaza', { view: 'submit' }], ['plaza', { view: 'mine' }], ...steps.map((s) => ['studio', { step: s }])]
    for (const [w, hgt] of VIEWPORTS) {
      await viewport(w, hgt)
      await evaluate(`${SW}.PK.closeAll()`)
      await sleep(800)
      const beforeMain = consoleErrors.length
      const mainIssues = await evaluate(MAIN_OVERLAP)
      await shot(`${skin}-main-${w}x${hgt}`)
      check(`[${skin}] main screen @${w}x${hgt}`, mainIssues.length === 0 && consoleErrors.length === beforeMain, [mainIssues.join(' | '), consoleErrors.slice(beforeMain).join(' | ')].filter(Boolean).join(' ; '))
      // 全屏观看: the skin's own button opens the shared film viewer over the whole window; Esc closes it again
      if (filmUrl) {
        const beforeCine = consoleErrors.length
        const entry = await evaluate(`(() => { const d = ${SW}.document, b = d.querySelector(${JSON.stringify(FILM_ENTRY[skin])}); if (!b) return { found: false }
          const r = b.getBoundingClientRect(); let shown = r.width > 4 && r.height > 4 && !b.disabled
          for (let p = b; p && p !== d.documentElement; p = p.parentElement) { const s = ${SW}.getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) shown = false }
          b.click(); return { found: true, shown } })()`)
        const opened = await waitFor(`(() => { const c = ${SW}.document.querySelector('.pk-cine.is-open'); if (!c) return null; const r = c.getBoundingClientRect(), v = c.querySelector('video')
          return { w: Math.round(r.width), h: Math.round(r.height), vw: ${SW}.innerWidth, vh: ${SW}.innerHeight, film: Boolean(v && /final\\.mp4/.test(v.currentSrc || v.src)), kit: ${SW}.PK.isOpenAny() } })()`, 8000, 'film viewer').catch(() => null)
        await sleep(800)
        const cineIssues = opened ? await evaluate(TEXT_ISSUES_IN('.pk-cine')) : []
        await shot(`${skin}-cinema-${w}x${hgt}`)
        await evaluate(`(() => { const w = ${SW}; w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return true })()`)
        const closed = await waitFor(`(() => { const w = ${SW}; return !w.document.querySelector('.pk-cine') && !w.PK.isOpenAny() })()`, 5000, 'film viewer closed').then(() => true, () => false)
        check(
          `[${skin}] 全屏观看 @${w}x${hgt}`,
          entry.found && entry.shown && opened && opened.w >= opened.vw - 1 && opened.h >= opened.vh - 1 && opened.film && opened.kit && cineIssues.length === 0 && closed && consoleErrors.length === beforeCine,
          JSON.stringify({ entry, opened, issues: cineIssues, closed, errors: consoleErrors.slice(beforeCine) }),
        )
      }
      if (skin === 'ink-loom') {
        // 素材仓: two pictures per row that always fit the panel (long names are shortened, never widen a column)
        const vault = await evaluate(`(() => { const d = ${SW}.document, list = d.querySelector('#vList'), pics = list && list.querySelector('.pics'); if (!pics) return { pics: false }
          const lr = list.getBoundingClientRect(), cut = [...pics.querySelectorAll('.pic')].filter((p) => p.getBoundingClientRect().right > lr.right + 1).map((p) => (p.title || '').slice(0, 24))
          return { pics: true, n: pics.children.length, overflowX: pics.scrollWidth - pics.clientWidth, cut } })()`)
        check(`[ink-loom] vault pictures fit two per row @${w}x${hgt}`, vault.pics && vault.n >= 2 && vault.overflowX <= 1 && vault.cut.length === 0, JSON.stringify(vault))
        // 九宫抽帧: nothing may sit on the title bar's close button
        await evaluate(`(() => { const b = ${SW}.document.querySelector('#mc9'); if (b) b.click(); return true })()`)
        const sheetOpen = await waitFor(`${SW}.document.querySelector('#modal.on') && ${SW}.document.querySelectorAll('#mBody .sh-cell').length === 9`, 5000, 'contact sheet').then(() => true, () => false)
        await sleep(600)
        const sheetIssues = sheetOpen ? await evaluate(TEXT_ISSUES_IN('#modal .m-card', '[data-mclose]')) : ['contact sheet did not open']
        await shot(`ink-loom-sheet9-${w}x${hgt}`)
        await evaluate(`(() => { const x = ${SW}.document.querySelector('#modal [data-mclose]'); if (x) x.click(); return true })()`)
        await waitFor(`(() => { const w = ${SW}; return !w.document.querySelector('#modal.on') })()`, 3000, 'contact sheet closed').catch(() => {})
        check(`[ink-loom] 九宫抽帧 header and close button clear @${w}x${hgt}`, sheetIssues.length === 0, sheetIssues.join(' | '))
      }
      let toastChecked = false
      for (const [id, a] of targets) {
        const sub = a.step || a.view || ''
        const label = `${id}${sub ? `:${sub}` : ''} @${w}x${hgt}`
        const before = consoleErrors.length
        await evaluate(`(() => { const PK = ${SW}.PK; PK.closeAll(); PK.open(${JSON.stringify(id)}, ${JSON.stringify(a)}); return true })()`)
        await sleep(id === 'studio' ? 1600 : 900)
        const info = await evaluate(`(() => { const w = ${SW}; const top = w.PK.topFrame(); if (!top) return { open: false }; const b = top.body; return { open: true, panel: top.id, text: (b.innerText || '').trim().length, renderError: Boolean(b.querySelector('.pk-render-failed')) } })()`)
        const issues = await evaluate(OVERLAP)
        const errs = consoleErrors.slice(before)
        await shot(`${skin}-${id}${sub ? `-${sub}` : ''}-${w}x${hgt}`)
        check(`[${skin}] panel ${label}`, info.open && info.text > 0 && !info.renderError && issues.length === 0 && errs.length === 0, [info.open ? '' : 'not open', info.text > 0 ? '' : 'empty', info.renderError ? 'render failed' : '', issues.join(' | '), errs.join(' | ')].filter(Boolean).join(' ; '))
        if (!toastChecked && info.open) {
          const cover = await evaluate(TOAST_COVER)
          if (cover) {
            toastChecked = true
            await shot(`${skin}-toast-${id}-${w}x${hgt}`)
            check(`[${skin}] toast keeps footer buttons clear (${label})`, cover.length === 0, cover.join(' | '))
            // let the probe toast expire so it cannot skew the following overlap checks
            await waitFor(`![...${SW}.document.querySelectorAll('body *')].some((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.includes('E2E 提示条遮挡检测')))`, 15000, 'probe toast gone').catch(() => {})
          }
        }
      }
    }
    await evaluate(`${SW}.PK.closeAll()`)
    await viewport(1600, 900)

    // the big topic editor
    await evaluate(`(() => { ${SW}.PK.editTopic({ allowRun: false }); return true })()`)
    await sleep(600)
    const ed = await evaluate(`(() => { const ta = ${SW}.document.querySelector('.pk-editor-ta'); return ta ? { len: ta.value.length, h: ta.getBoundingClientRect().height } : null })()`)
    await shot(`${skin}-topic-editor`)
    check(`[${skin}] big topic editor opens with the current brief`, ed && ed.len > 10 && ed.h > 200, JSON.stringify(ed))
    await evaluate(`${SW}.PK.closeAll()`)
  }
  // leave the scratch home on the default skin
  if (SKINS[SKINS.length - 1] !== 'prism-lab') {
    await evaluate(`${SW}.PK.action('setSkin', { skin: 'prism-lab' }).then(() => true, () => false)`)
    await waitFor(`${SW} && ${SW}.PK && ${SW}.PK.skin === 'prism-lab'`, 30000, 'back to prism-lab').catch(() => false)
  }

  // 分镜精修 of an AI-coded project: each scene's own AI code is the first 「视觉布局」 choice; a built-in layout can be
  // picked instead and the AI picture restored again (the tools are never a closed list)
  {
    const aiDir = await evaluate(`${SW}.PK.action('createProject', { title: 'E2E AI 编码工程' }, { timeout: 60000 }).then((d) => d && d.dir)`)
    await waitFor(`${SW}.PK.state.project && ${SW}.PK.state.project.dir === ${JSON.stringify(aiDir || '')}`, 20000, 'ai project').catch(() => {})
    const posted = await evaluate(`(async () => { const PK = ${SW}.PK; const st = await PK.store.load(true); const sc = (st.activeProject && st.activeProject.script) || {}
      const scenes = [1, 2].map((i) => ({ id: 'scene-0' + i, title: '第 ' + i + ' 幕', narration: '这是第 ' + i + ' 幕的旁白', durationSec: 3, startSec: (i - 1) * 3, layout: 'svg-architecture-flow' }))
      await PK.post('script', { projectDir: PK.state.project.dir, regenerateCode: false, script: { ...sc, engine: 'remotion', authoringMode: 'ai-coded', scenes, totalDurationSec: 6 } })
      await PK.action('refresh', { syncForm: true }); return 'ok' })()`).catch((e) => e.message)
    await evaluate(`(() => { const PK = ${SW}.PK; PK.closeAll(); PK.open('studio', { step: 'scenes', sceneId: 'scene-01' }); return true })()`)
    const SEL = `${SW}.document.querySelector('.pk-layer.is-open button.pk-select[aria-label="视觉布局"]')`
    const layoutNow = () => evaluate(`(() => { const b = ${SEL}; if (!b) return null; const f = b.closest('.pk-field') || b.parentElement; return { label: (b.querySelector('.pk-select-l') || b).textContent.trim(), field: (f && f.textContent) || '' } })()`)
    const pick = async (rx) => {
      await evaluate(`(() => { const b = ${SEL}; if (b) b.click(); return true })()`)
      await sleep(400)
      const ok = await evaluate(`(() => { const o = [...${SW}.document.querySelectorAll('.pk-l-pop [role=option]')].find((x) => ${rx}.test((x.querySelector('b') || x).textContent)); if (!o) return false; o.click(); return true })()`)
      await sleep(700)
      return ok
    }
    // the studio first shows its cached script: wait for the AI-coded project's own data
    const first = await waitFor(`(() => { const b = ${SEL}; const t = b ? (b.querySelector('.pk-select-l') || b).textContent.trim() : ''; return /AI 定制代码/.test(t) ? t : null })()`, 15000, 'AI layout shown').catch(() => layoutNow().then((x) => (x ? x.label : null)))
    const toBuiltin = first ? await pick('/SVG/') : false
    const builtin = await layoutNow()
    const toAi = toBuiltin ? await pick('/AI 定制代码/') : false
    const back = await layoutNow()
    await shot('studio-ai-layout')
    check(
      'AI-coded scene: 「AI 定制代码」 is the default 视觉布局, a built-in layout can be picked and undone',
      posted === 'ok' && /AI 定制代码/.test(first || '') && toBuiltin && builtin && !/AI 定制代码/.test(builtin.label) && /内置版式/.test(builtin.field) && toAi && back && /AI 定制代码/.test(back.label),
      JSON.stringify({ posted, first, builtin: builtin && builtin.label, back: back && back.label }),
    )
    await evaluate(`${SW}.PK.closeAll()`)
    // back to the first project (the optional one-click run below uses its brief)
    await evaluate(`${SW}.PK.action('selectProject', { dir: ${JSON.stringify(created || '')} }).then(() => true, () => false)`)
    await waitFor(`${SW}.PK.state.project && ${SW}.PK.state.project.dir === ${JSON.stringify(created || '')}`, 20000, 'first project again').catch(() => {})
  }

  // optional: real local-draft one-click run through the skin
  if (FULL) {
    await evaluate(`${SW}.PK.action('setDirector', { patch: { creationMode: 'fast-draft', narrationMode: 'subtitle-mv', quality: '720p', durationMode: 'custom', targetDurationSec: 15 } })`)
    await sleep(800)
    const runId = await evaluate(`${SW}.PK.action('run', {}).then((d) => d && d.runId, (e) => 'ERR ' + e.message)`)
    check('one-click run starts', runId && !String(runId).startsWith('ERR'), runId)
    const final = await waitFor(`(() => { const r = ${SW}.PK.state.run; return r && ['completed', 'failed', 'stopped'].includes(r.status) ? r.status + '|' + (r.error || '') : null })()`, 15 * 60000, 'run finished').catch((e) => 'timeout')
    const mp4 = await evaluate(`${SW}.PK.state.preview.mp4Url`)
    let mp4Ok = false
    if (mp4) {
      const head = await fetch(new URL(mp4, BASE), { headers: { Range: 'bytes=0-1023' } })
      mp4Ok = head.status === 206 || head.status === 200
    }
    check('one-click run completes with a playable MP4', String(final).startsWith('completed') && mp4Ok, `${final} mp4=${mp4}`)
    if (!String(final).startsWith('completed')) {
      // the check line is truncated: print the whole failure (e.g. the ffmpeg stderr) for diagnosis
      const full = await evaluate(`(() => { const r = ${SW}.PK.state.run; return JSON.stringify({ status: r && r.status, error: r && r.error, logs: (${SW}.PK.state.logs || []).slice(-15) }) })()`).catch((e) => e.message)
      console.log(`[e2e] one-click run failure detail:\n${String(full).slice(0, 6000)}`)
    }
  }
} catch (err) {
  check('e2e flow', false, err?.stack || err)
} finally {
  try {
    ws.close()
  } catch {}
  try {
    proc.kill()
  } catch {}
  server.close()
  await sleep(400)
  if (!KEEP) {
    try {
      // project folders may hold a node_modules junction into the shared store: never follow links while deleting
      const { removeTreeNoFollow } = await import('../../packages/dsh-tool-media/safe-json-store.js')
      removeTreeNoFollow(scratch)
    } catch (err) {
      console.warn('[e2e] scratch cleanup failed:', err?.message || err)
    }
  }
}
const failed = results.filter((r) => !r.ok)
if (consoleErrors.length) console.log(`[e2e] console errors:\n  ${consoleErrors.slice(0, 20).join('\n  ')}`)
console.log(`\n[e2e] ${results.length - failed.length}/${results.length} checks passed · ${consoleErrors.length} console error(s)${KEEP ? ` · scratch kept at ${scratch}` : ''}`)
process.exit(failed.length ? 1 : 0)
