/**
 * Real Frame-by-Frame Dual-Engine Video Renderer
 * 1. HTML/GSAP/Canvas Engine: Serves project over localhost HTTP (Range-enabled for <video>)
 *    + controls headless Chromium via Node 24 native WebSocket CDP to seek & capture EVERY frame.
 * 2. Remotion Engine: Bundles `src/index.ts` & renders via local `@remotion/bundler` + `@remotion/renderer`.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { cpus } from 'node:os'
import { pathToFileURL } from 'node:url'
import {
  REPO_ROOT,
  createAbortError,
  ensureRemotionJunction,
  killProcessTree,
  readScriptJson,
  resolveBinaries,
  resolveBrowserExecutable,
  resolveLowSpecPolicy,
  resolveRemotionRuntime,
  runCommandRedirected,
} from '../shared/index.js'
import { renderHtmlSegmentsWithCache } from './segment-cache.js'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

function startStaticProjectServer(projectDir) {
  const absRoot = resolve(projectDir)
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const file = resolve(absRoot, rel)
    if (!file.startsWith(absRoot) || !existsSync(file) || statSync(file).isDirectory()) {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    const st = statSync(file)
    const ext = extname(file).toLowerCase()
    const ctype = MIME[ext] || 'application/octet-stream'
    const range = req.headers.range
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range)
      if (m) {
        const start = Number(m[1])
        const end = m[2] ? Math.min(st.size - 1, Number(m[2])) : st.size - 1
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${st.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': ctype,
        })
        createReadStream(file, { start, end }).pipe(res)
        return
      }
    }
    res.writeHead(200, {
      'Content-Length': st.size,
      'Content-Type': ctype,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    })
    createReadStream(file).pipe(res)
  })
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolvePromise({ server, port: addr.port })
    })
  })
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true })
      this.ws.addEventListener('error', (e) => rej(new Error(`CDP WebSocket error: ${e.message || 'failed'}`)), { once: true })
    })
    this.ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data))
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: r, reject: j } = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          if (msg.error) j(new Error(msg.error.message || 'CDP error'))
          else r(msg.result)
        }
      } catch {}
    })
    // A closed socket (browser killed on abort/timeout) must fail in-flight calls instead of leaving them pending forever
    this.ws.addEventListener('close', () => {
      for (const { reject: j } of this.pending.values()) {
        try { j(new Error('CDP 连接已关闭')) } catch {}
      }
      this.pending.clear()
    })
  }
  async send(method, params = {}) {
    await this.ready
    const id = this.nextId++
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  close() {
    try { this.ws.close() } catch {}
  }
}

async function openCdpSession(browserBin, width, height) {
  const tmpBase = join(REPO_ROOT, '.tmp')
  mkdirSync(tmpBase, { recursive: true })
  const userDataDir = join(tmpBase, `cdp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  mkdirSync(userDataDir, { recursive: true })

  const child = spawn(
    browserBin,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--disable-gpu-vsync',
      '--run-all-compositor-stages-before-draw',
      '--no-sandbox',
      '--hide-scrollbars',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-dev-shm-usage',
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  )

  const activePortFile = join(userDataDir, 'DevToolsActivePort')
  const deadline = Date.now() + 20_000
  let port = ''
  while (Date.now() < deadline) {
    if (existsSync(activePortFile)) {
      const lines = readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/)
      if (lines[0] && /^\d+$/.test(lines[0])) {
        port = lines[0]
        break
      }
    }
    await new Promise((r) => setTimeout(r, 120))
  }
  if (!port) {
    try { child.kill() } catch {}
    throw new Error('Chromium DevToolsActivePort timed out')
  }

  // Wait for page target
  let wsUrl = ''
  const targetDeadline = Date.now() + 10_000
  while (Date.now() < targetDeadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) {
        wsUrl = page.webSocketDebuggerUrl
        break
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!wsUrl) {
    try { child.kill() } catch {}
    throw new Error('No Chromium page target found')
  }

  const cdp = new CdpClient(wsUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })

  return {
    cdp,
    cleanup() {
      cdp.close()
      killProcessTree(child)
      try { child.kill() } catch {}
      setTimeout(() => {
        try { rmSync(userDataDir, { recursive: true, force: true }) } catch {}
      }, 300)
    },
  }
}

async function waitForPageReady(cdp, url) {
  await cdp.send('Page.navigate', { url })
  for (let i = 0; i < 120; i++) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    })
    if (r?.result?.value === 'complete') break
    await new Promise((res) => setTimeout(res, 100))
  }
  // Wait for fonts, images, and video metadata
  await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      try { await document.fonts.ready; } catch {}
      const imgs = Array.from(document.querySelectorAll('img'));
      await Promise.all(imgs.map(img => img.complete ? null : new Promise(r => { img.onload = r; img.onerror = r; setTimeout(r, 2000); })));
      const vids = Array.from(document.querySelectorAll('video'));
      await Promise.all(vids.map(v => v.readyState >= 1 ? null : new Promise(r => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 2500); })));
      return true;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
}

/**
 * Capture N specific frame numbers to PNG files in a single warm Chromium CDP session.
 */
export async function captureHtmlSnapshots({ projectDir, browserBin, frames, outDir, width = 1280, height = 720, signal }) {
  if (signal?.aborted) throw createAbortError()
  mkdirSync(outDir, { recursive: true })
  const { server, port } = await startStaticProjectServer(projectDir)
  const session = await openCdpSession(browserBin, width, height)
  const files = []
  const onAbort = () => {
    try { session.cleanup() } catch {}
    try { server.close() } catch {}
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    await waitForPageReady(session.cdp, `http://127.0.0.1:${port}/index.html?render=1`)
    for (let i = 0; i < frames.length; i++) {
      if (signal?.aborted) throw createAbortError()
      const f = frames[i]
      await session.cdp.send('Runtime.evaluate', {
        expression: `Promise.resolve(window.__seekToFrame ? window.__seekToFrame(${f}) : ${f}).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`,
        awaitPromise: true,
      })
      const shot = await session.cdp.send('Page.captureScreenshot', { format: 'png' })
      const pngPath = join(outDir, `shot_${String(i).padStart(2, '0')}.png`)
      const fd = openSync(pngPath, 'w')
      writeSync(fd, Buffer.from(shot.data, 'base64'))
      closeSync(fd)
      files.push(pngPath)
    }
    return files
  } finally {
    signal?.removeEventListener('abort', onAbort)
    session.cleanup()
    try { server.close() } catch {}
  }
}

/**
 * Capture EVERY frame (0..totalFrames-1) of HTML5 animation via Chromium CDP
 * and encode directly with master audio into H.264 yuv420p MP4.
 */
export async function renderHtmlVideoToMp4({
  projectDir,
  browserBin,
  totalFrames,
  fps = 30,
  width = 1920,
  height = 1080,
  audioPath,
  outMp4Path,
  snapshotFrames = [],
  snapshotDir = '',
  useSegmentCache = true,
  signal,
  onProgress,
}) {
  if (signal?.aborted) throw createAbortError()
  const { ffmpeg } = resolveBinaries()
  const htmlTotalSec = Math.max(4, totalFrames / Math.max(1, fps))
  const htmlHwPolicy = resolveLowSpecPolicy({
    repoRoot: REPO_ROOT,
    requestedFps: fps,
    totalDurationSec: htmlTotalSec,
  })
  const htmlFfThreadsArgs = htmlHwPolicy.ffmpegThreads > 0 ? ['-threads', String(htmlHwPolicy.ffmpegThreads)] : []
  const snapMap = new Map()
  snapshotFrames.forEach((f, idx) => {
    if (!snapMap.has(f)) snapMap.set(f, [])
    snapMap.get(f).push(idx)
  })
  if (snapshotDir) mkdirSync(snapshotDir, { recursive: true })

  // Deterministic Per-Scene Segment Cache fast-path (when script.json has >=2 scenes)
  let scriptData = null
  if (useSegmentCache) {
    try {
      scriptData = readScriptJson(projectDir).data
    } catch {}
  }

  if (useSegmentCache && scriptData && Array.isArray(scriptData.scenes) && scriptData.scenes.length >= 2) {
    let serverObj = null
    let cdpSession = null
    const abortCleanup = () => {
      try { cdpSession?.cleanup() } catch {}
      try { serverObj?.server?.close() } catch {}
    }
    signal?.addEventListener('abort', abortCleanup, { once: true })
    const ensureBrowser = async () => {
      if (signal?.aborted) throw createAbortError()
      if (!serverObj) {
        serverObj = await startStaticProjectServer(projectDir)
      }
      if (!cdpSession) {
        cdpSession = await openCdpSession(browserBin, width, height)
        await waitForPageReady(cdpSession.cdp, `http://127.0.0.1:${serverObj.port}/index.html?render=1`)
      }
      return cdpSession
    }

    try {
      const segRes = await renderHtmlSegmentsWithCache({
        projectDir,
        script: scriptData,
        ffmpeg,
        outMp4: outMp4Path,
        audioWavPath: audioPath,
        fps,
        renderWidth: width,
        renderHeight: height,
        signal,
        onProgress,
        captureFrameRangeToSilentMp4: async ({ startFrame, endFrameExclusive, outSilentMp4 }) => {
          const sess = await ensureBrowser()
          const tmpBase = join(REPO_ROOT, '.tmp')
          mkdirSync(tmpBase, { recursive: true })
          const mjpegPath = join(tmpBase, `seg-${startFrame}-${Date.now()}.mjpeg`)
          const mjpegFd = openSync(mjpegPath, 'w')
          try {
            for (let f = startFrame; f < endFrameExclusive; f++) {
              if (signal?.aborted) throw createAbortError()
              await sess.cdp.send('Runtime.evaluate', {
                expression: `Promise.resolve(window.__seekToFrame ? window.__seekToFrame(${f}) : ${f}).then(() => new Promise(r => requestAnimationFrame(r)))`,
                awaitPromise: true,
              })
              const shot = await sess.cdp.send('Page.captureScreenshot', {
                format: 'jpeg',
                quality: 90,
                optimizeForSpeed: true,
              })
              writeSync(mjpegFd, Buffer.from(shot.data, 'base64'))
              if (onProgress && ((f - startFrame) % 15 === 0 || f === endFrameExclusive - 1)) {
                const denom = Math.max(1, Number(totalFrames) || endFrameExclusive)
                const pct = Math.min(94, Math.max(10, Math.round(((f + 1) / denom) * 90)))
                onProgress({
                  frame: f + 1,
                  totalFrames: denom,
                  pct,
                  progress: pct,
                  message: `正在逐帧合成高清画面 (${f + 1}/${denom} 帧 · ${pct}%)...`,
                })
              }
              if (snapshotDir && snapMap.has(f)) {
                const pShot = await sess.cdp.send('Page.captureScreenshot', { format: 'png' })
                const pngBuf = Buffer.from(pShot.data, 'base64')
                for (const idx of snapMap.get(f)) {
                  const sPath = join(snapshotDir, `shot_${String(idx).padStart(2, '0')}.png`)
                  const pFd = openSync(sPath, 'w')
                  writeSync(pFd, pngBuf)
                  closeSync(pFd)
                }
              }
            }
          } finally {
            try { closeSync(mjpegFd) } catch {}
          }

          const segSec = Number(((endFrameExclusive - startFrame) / fps).toFixed(3))
          try {
            const enc = await runCommandRedirected(
              ffmpeg,
              [
                '-y', '-f', 'mjpeg', '-framerate', String(fps), '-i', mjpegPath,
                '-vf', 'scale=in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p',
                '-c:v', 'libx264', '-preset', htmlHwPolicy.ffmpegPreset || 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
                ...htmlFfThreadsArgs,
                '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
                '-g', String(Math.max(15, fps)), '-sc_threshold', '0', '-video_track_timescale', '90000', '-an', '-t', String(segSec),
                outSilentMp4,
              ],
              { timeoutMs: Math.max(180_000, Math.round(segSec * 4500)), signal },
            )
            if (enc.code !== 0 || !existsSync(outSilentMp4)) {
              throw new Error(`Segment encode failed: ${enc.stderr}`)
            }
          } finally {
            try { unlinkSync(mjpegPath) } catch {}
          }
        },
      })

      // Extract any snapshot frames missing due to cache hits straight from final outMp4Path
      if (snapshotDir && snapshotFrames.length > 0) {
        for (let i = 0; i < snapshotFrames.length; i++) {
          const sPath = join(snapshotDir, `shot_${String(i).padStart(2, '0')}.png`)
          if (!existsSync(sPath)) {
            const atSec = (Number(snapshotFrames[i]) || 0) / fps
            await runCommandRedirected(
              ffmpeg,
              ['-y', '-ss', atSec.toFixed(3), '-i', outMp4Path, '-frames:v', '1', sPath],
              { timeoutMs: 15_000 },
            ).catch(() => {})
          }
        }
      }

      return { ok: true, framesRendered: totalFrames, outputPath: outMp4Path, segmentCache: segRes }
    } finally {
      signal?.removeEventListener('abort', abortCleanup)
      if (cdpSession) cdpSession.cleanup()
      if (serverObj) try { serverObj.server.close() } catch {}
    }
  }

  const tmpBase = join(REPO_ROOT, '.tmp')
  mkdirSync(tmpBase, { recursive: true })
  const mjpegPath = join(tmpBase, `frames-${Date.now()}.mjpeg`)
  const mjpegFd = openSync(mjpegPath, 'w')

  const { server, port } = await startStaticProjectServer(projectDir)
  const session = await openCdpSession(browserBin, width, height)

  try {
    await waitForPageReady(session.cdp, `http://127.0.0.1:${port}/index.html?render=1`)
    for (let f = 0; f < totalFrames; f++) {
      await session.cdp.send('Runtime.evaluate', {
        expression: `Promise.resolve(window.__seekToFrame ? window.__seekToFrame(${f}) : ${f}).then(() => new Promise(r => requestAnimationFrame(r)))`,
        awaitPromise: true,
      })
      const shot = await session.cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 90,
        optimizeForSpeed: true,
      })
      const jpg = Buffer.from(shot.data, 'base64')
      writeSync(mjpegFd, jpg)

      if (snapshotDir && snapMap.has(f)) {
        const pShot = await session.cdp.send('Page.captureScreenshot', { format: 'png' })
        const pngBuf = Buffer.from(pShot.data, 'base64')
        for (const idx of snapMap.get(f)) {
          const sPath = join(snapshotDir, `shot_${String(idx).padStart(2, '0')}.png`)
          const pFd = openSync(sPath, 'w')
          writeSync(pFd, pngBuf)
          closeSync(pFd)
        }
      }
      if (onProgress && (f % 15 === 0 || f === totalFrames - 1)) {
        const pct = Math.min(99, Math.round(((f + 1) / Math.max(1, totalFrames)) * 100))
        onProgress({ frame: f + 1, totalFrames, pct })
      }
    }
  } finally {
    try { closeSync(mjpegFd) } catch {}
    session.cleanup()
    try { server.close() } catch {}
  }

  const totalSec = Number((totalFrames / fps).toFixed(3))
  const ffArgs = ['-y', '-f', 'mjpeg', '-framerate', String(fps), '-i', mjpegPath]
  if (audioPath && existsSync(audioPath)) {
    ffArgs.push('-i', audioPath, '-map', '0:v:0', '-map', '1:a:0')
  } else {
    ffArgs.push('-f', 'lavfi', '-t', String(totalSec), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-map', '0:v:0', '-map', '1:a:0')
  }
  ffArgs.push(
    '-vf', 'scale=in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264',
    '-preset', htmlHwPolicy.ffmpegPreset || 'medium',
    '-crf', '19',
    '-pix_fmt', 'yuv420p',
    ...htmlFfThreadsArgs,
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-color_range', 'tv',
    // 320 kbit/s like the Remotion mux: at 192 kbit/s AAC overshoot lifts the master's true peak by ~2.5 dB
    '-c:a', 'aac',
    '-b:a', '320k',
    '-ar', '48000',
    '-ac', '2',
    '-t', String(totalSec),
    '-movflags', '+faststart',
    outMp4Path,
  )
  try {
    const enc = await runCommandRedirected(ffmpeg, ffArgs, {
      timeoutMs: Math.max(300_000, Math.round(totalSec * 4500)),
      signal,
    })
    if (enc.code !== 0 || !existsSync(outMp4Path)) {
      throw new Error(`FFmpeg encode failed: ${enc.stderr}`)
    }
  } finally {
    try { unlinkSync(mjpegPath) } catch {}
  }

  return { ok: true, framesRendered: totalFrames, outputPath: outMp4Path }
}

export function findRemotionBrowser(remotionRuntime) {
  const candidates = [
    remotionRuntime?.nodeModulesDir && join(remotionRuntime.nodeModulesDir, '.remotion', 'chrome-headless-shell'),
    remotionRuntime?.templateRoot && join(remotionRuntime.templateRoot, 'node_modules', '.remotion', 'chrome-headless-shell'),
  ].filter(Boolean)
  for (const remotionCache of candidates) {
    if (!existsSync(remotionCache)) continue
    const win64 = join(remotionCache, 'win64')
    if (existsSync(win64)) {
      for (const sub of readdirSync(win64)) {
        const exe = join(win64, sub, 'chrome-headless-shell.exe')
        if (existsSync(exe)) return exe
      }
    }
  }
  return null
}

function removeTreeNoFollow(target) {
  let st
  try {
    st = lstatSync(target)
  } catch {
    return
  }
  if (st.isSymbolicLink() || !st.isDirectory()) {
    // Files, symlinks and Windows junctions: remove the entry itself, never what a link points to
    try {
      unlinkSync(target)
    } catch {
      try {
        if (st.isSymbolicLink()) rmdirSync(target)
        else rmSync(target, { force: true })
      } catch {}
    }
    return
  }
  for (const name of readdirSync(target)) removeTreeNoFollow(join(target, name))
  try { rmdirSync(target) } catch {}
}

/**
 * Delete one Remotion `bundle()` output folder (`remotion-webpack-bundle-*`, ~100 MB each because `public/` is copied in).
 * Refuses any other folder name so it can never touch project or shared directories.
 */
export function removeRemotionBundleDir(dir) {
  if (!dir || typeof dir !== 'string' || /^https?:\/\//i.test(dir)) return false
  const abs = resolve(dir)
  if (!/^remotion-webpack-bundle-/i.test(basename(abs))) return false
  try {
    if (existsSync(abs)) removeTreeNoFollow(abs)
  } catch {}
  return !existsSync(abs)
}

// ---------------------------------------------------------------------------------------------
// Resumable frame-exact chunked Remotion rendering
// ---------------------------------------------------------------------------------------------

const CHUNK_MANIFEST_VERSION = 1
const CHUNK_RENDER_SETTINGS = Object.freeze({
  codec: 'h264',
  container: 'mp4',
  crf: 19,
  pixelFormat: 'yuv420p',
  muted: true,
})
const AUDIO_REACTIVE_RE = /\b(?:useAudioData|visualizeAudio|visualizeAudioWaveform|getAudioData|useWindowedAudioData)\b/

/**
 * Chunk length in seconds: explicit argument → `DSH_RENDER_CHUNK_SEC` → 10. `0` selects the legacy single pass.
 */
export function resolveRenderChunkSec(explicit) {
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    const v = Number(explicit)
    return Number.isFinite(v) && v > 0 ? v : 0
  }
  const raw = String(process.env.DSH_RENDER_CHUNK_SEC ?? '').trim()
  if (raw === '') return 10
  const v = Number(raw)
  return Number.isFinite(v) && v > 0 ? v : 0
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value === undefined ? null : value)
}

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex')

function listFilesNoFollow(dir, prefix = '', out = []) {
  if (!existsSync(dir)) return out
  let entries = []
  try {
    entries = readdirSync(dir).sort()
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const abs = join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    let st
    try {
      st = lstatSync(abs)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) {
      // Fingerprint symlinked files, but never descend into linked directories / junctions
      try {
        const target = statSync(abs)
        if (target.isFile()) out.push({ abs, rel, size: target.size })
      } catch {}
      continue
    }
    if (st.isDirectory()) listFilesNoFollow(abs, rel, out)
    else if (st.isFile()) out.push({ abs, rel, size: st.size })
  }
  return out
}

function quickFingerprint(absPath, size) {
  const h = createHash('sha256')
  h.update(String(size))
  if (size <= 4 * 1024 * 1024) {
    h.update(readFileSync(absPath))
    return h.digest('hex')
  }
  const fd = openSync(absPath, 'r')
  try {
    const buf = Buffer.alloc(65536)
    for (const pos of [0, Math.floor(size / 2), Math.max(0, size - buf.length)]) {
      const n = readSync(fd, buf, 0, buf.length, pos)
      h.update(buf.subarray(0, n))
    }
  } finally {
    closeSync(fd)
  }
  return h.digest('hex')
}

/**
 * Hash of everything that can change the rendered pixels: `script.json` (minus `updatedAt`), every `src/**` file,
 * the `public/` asset list (size + content fingerprint), composition props and codec/chunk settings.
 * `public/master-audio.wav` is excluded unless the composition is audio-reactive — chunks are muted and audio is muxed once.
 */
export function computeRemotionBundleHash(absProject, { extra = {} } = {}) {
  const h = createHash('sha256')
  h.update(`dsh-chunk-v${CHUNK_MANIFEST_VERSION}\n`)
  const scriptPath = join(absProject, 'script.json')
  if (existsSync(scriptPath)) {
    const raw = readFileSync(scriptPath, 'utf8')
    try {
      const data = JSON.parse(raw)
      if (data && typeof data === 'object') delete data.updatedAt
      h.update(`script:${stableStringify(data)}\n`)
    } catch {
      h.update(`script-raw:${raw}\n`)
    }
  }
  let audioReactive = false
  const srcFiles = listFilesNoFollow(join(absProject, 'src'))
  for (const f of srcFiles) {
    const buf = readFileSync(f.abs)
    if (AUDIO_REACTIVE_RE.test(buf.toString('utf8'))) audioReactive = true
    h.update(`src:${f.rel}:${sha256Hex(buf)}\n`)
  }
  const publicFiles = listFilesNoFollow(join(absProject, 'public'))
  for (const f of publicFiles) {
    if (!audioReactive && /^master-audio\.wav$/i.test(f.rel)) continue
    h.update(`public:${f.rel}:${quickFingerprint(f.abs, f.size)}\n`)
  }
  let remotionVersion = ''
  try {
    const rt = resolveRemotionRuntime()
    remotionVersion = JSON.parse(readFileSync(join(rt.nodeModulesDir, 'remotion', 'package.json'), 'utf8')).version || ''
  } catch {}
  h.update(`render:${stableStringify({ ...CHUNK_RENDER_SETTINGS, remotionVersion, inputProps: {}, ...extra })}\n`)
  return {
    hash: h.digest('hex'),
    srcFileCount: srcFiles.length,
    publicFileCount: publicFiles.length,
    audioReactive,
    remotionVersion,
  }
}

/**
 * Split `durationInFrames` into inclusive `[start, end]` ranges of `chunkFrames` (a tiny tail is merged into the previous chunk).
 */
export function planRenderChunks(durationInFrames, chunkFrames) {
  const total = Math.max(0, Math.floor(Number(durationInFrames) || 0))
  const size = Math.max(1, Math.floor(Number(chunkFrames) || 1))
  const chunks = []
  for (let s = 0; s < total; s += size) {
    chunks.push({ start: s, end: Math.min(total, s + size) - 1 })
  }
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1]
    if (last.end - last.start + 1 < Math.max(5, Math.round(size * 0.25))) {
      chunks.pop()
      chunks[chunks.length - 1].end = last.end
    }
  }
  return chunks.map((c, index) => ({ index, start: c.start, end: c.end, frames: c.end - c.start + 1 }))
}

function readChunkManifest(chunkDir) {
  try {
    return JSON.parse(readFileSync(join(chunkDir, 'manifest.json'), 'utf8'))
  } catch {
    return null
  }
}

function writeChunkManifest(chunkDir, manifest) {
  manifest.updatedAt = new Date().toISOString()
  const finalPath = join(chunkDir, 'manifest.json')
  const tmpPath = join(chunkDir, `manifest.${process.pid}.tmp`)
  writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  try {
    renameSync(tmpPath, finalPath)
  } catch {
    copyFileSync(tmpPath, finalPath)
    try { unlinkSync(tmpPath) } catch {}
  }
}

/** Remove chunk artefacts that do not belong to `keepTag` (all of them when keepTag is empty), plus partial files. */
function purgeChunkDir(chunkDir, keepTag = '') {
  if (!existsSync(chunkDir)) return
  for (const name of readdirSync(chunkDir)) {
    if (name === 'manifest.json') continue
    const isPartial = /\.partial\.mp4$/i.test(name) || /\.tmp$/i.test(name)
    const belongs = keepTag && name.includes(`-${keepTag}`)
    if (isPartial || !belongs) {
      try { unlinkSync(join(chunkDir, name)) } catch {}
    }
  }
}

async function probeMediaJson(file, { countPackets = false, selectVideo = false } = {}) {
  const { ffprobe } = resolveBinaries()
  const res = await runCommandRedirected(
    ffprobe,
    [
      '-v', 'error',
      ...(countPackets ? ['-count_packets'] : []),
      ...(selectVideo ? ['-select_streams', 'v:0'] : []),
      '-show_entries', 'stream=index,codec_type,codec_name,nb_read_packets,nb_frames,duration,start_time,avg_frame_rate:format=duration',
      '-of', 'json',
      file,
    ],
    { timeoutMs: 90_000 },
  )
  try {
    return JSON.parse(res.stdout || '{}')
  } catch {
    return {}
  }
}

export async function countVideoFrames(file) {
  if (!existsSync(file)) return 0
  const j = await probeMediaJson(file, { countPackets: true, selectVideo: true })
  const v = (j.streams || []).find((s) => s.codec_type === 'video')
  return v ? Number(v.nb_read_packets || v.nb_frames || 0) : 0
}

function stripCodeComments(code) {
  return String(code || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1')
}

function extractJsxOpenTags(code, names) {
  const out = []
  const re = new RegExp(`<(?:${names.join('|')})(?=[\\s/>])`, 'g')
  let m
  while ((m = re.exec(code))) {
    let i = m.index + m[0].length
    let depth = 0
    let quote = ''
    for (; i < code.length; i++) {
      const ch = code[i]
      if (quote) {
        if (ch === '\\') i++
        else if (ch === quote) quote = ''
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch
      else if (ch === '{') depth++
      else if (ch === '}') depth = Math.max(0, depth - 1)
      else if (ch === '>' && depth === 0) break
    }
    out.push(code.slice(m.index, i + 1))
    re.lastIndex = i + 1
  }
  return out
}

const PLAIN_MASTER_AUDIO_RE = /^<(?:Audio|Html5Audio) src=\{ ?staticFile\( ?['"`]\/?master-audio\.wav['"`] ?\) ?\} ?\/?>$/

/**
 * Decide how chunk renders get their audio: `master` (composition only plays public/master-audio.wav verbatim),
 * `silent` (no audio elements) or `composition` (anything else → render the composition audio once with Remotion).
 */
export function resolveCompositionAudioPlan(absProject) {
  const files = listFilesNoFollow(join(absProject, 'src')).filter((f) => /\.(?:tsx?|jsx?)$/i.test(f.rel))
  let audioTags = 0
  let plainMasterTags = 0
  let unmutedVideos = 0
  for (const f of files) {
    const code = stripCodeComments(readFileSync(f.abs, 'utf8'))
    for (const tag of extractJsxOpenTags(code, ['Audio', 'Html5Audio'])) {
      audioTags++
      if (PLAIN_MASTER_AUDIO_RE.test(tag.replace(/\s+/g, ' ').trim())) plainMasterTags++
    }
    for (const tag of extractJsxOpenTags(code, ['OffthreadVideo', 'Video', 'Html5Video'])) {
      const muted = /\bmuted\b/.test(tag) && !/\bmuted\s*=\s*\{\s*false\s*\}/.test(tag)
      if (!muted) unmutedVideos++
    }
  }
  const masterPath = join(absProject, 'public', 'master-audio.wav')
  if (audioTags === 0 && unmutedVideos === 0) return { mode: 'silent', audioTags, unmutedVideos }
  if (audioTags === plainMasterTags && unmutedVideos === 0 && existsSync(masterPath)) {
    return { mode: 'master', path: masterPath, audioTags, unmutedVideos }
  }
  return { mode: 'composition', audioTags, plainMasterTags, unmutedVideos }
}

function makeRemotionCancel(rendererMod, signal) {
  const { cancelSignal, cancel } =
    typeof rendererMod.makeCancelSignal === 'function' ? rendererMod.makeCancelSignal() : { cancelSignal: undefined, cancel: () => {} }
  const onAbort = () => {
    try { cancel() } catch {}
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  return { cancelSignal, dispose: () => signal?.removeEventListener('abort', onAbort) }
}

/** Remotion `scale` render option: a finite factor in (0, 16]; anything else is 1 (the composition size). */
function normalizeRenderScale(scale) {
  const s = Number(scale)
  return Number.isFinite(s) && s > 0 && s <= 16 ? s : 1
}

/**
 * Output size of a Remotion H.264 render at `scale`, computed exactly like @remotion/renderer
 * (validateEvenDimensionsWithCodec lowers width / height until the scaled size is even, then scales and rounds).
 */
export function computeRemotionOutputSize(width, height, scale = 1) {
  const s = normalizeRenderScale(scale)
  let w = Math.max(0, Math.round(Number(width) || 0))
  let h = Math.max(0, Math.round(Number(height) || 0))
  while (Math.round(h * s) % 2 !== 0) h--
  while (Math.round(w * s) % 2 !== 0) w--
  return { width: Math.round(w * s), height: Math.round(h * s) }
}

async function renderOneChunk({ rendererMod, composition, serveUrl, chunk, outPath, settings, browser, browserExecutable, signal, onFrames, scale = 1 }) {
  const partial = outPath.replace(/\.mp4$/i, '.partial.mp4')
  try { unlinkSync(partial) } catch {}
  const { cancelSignal, dispose } = makeRemotionCancel(rendererMod, signal)
  try {
    await rendererMod.renderMedia({
      composition,
      serveUrl,
      ...(scale !== 1 ? { scale } : {}),
      codec: CHUNK_RENDER_SETTINGS.codec,
      pixelFormat: CHUNK_RENDER_SETTINGS.pixelFormat,
      crf: CHUNK_RENDER_SETTINGS.crf,
      muted: true,
      frameRange: [chunk.start, chunk.end],
      outputLocation: partial,
      overwrite: true,
      browserExecutable,
      puppeteerInstance: browser || undefined,
      concurrency: settings.concurrency,
      offthreadVideoThreads: settings.videoThreads,
      offthreadVideoCacheSizeInBytes: settings.cacheBytes,
      delayRenderTimeoutInMilliseconds: settings.delayMs,
      chromiumOptions: { gl: settings.gl || undefined },
      cancelSignal,
      onProgress: (p) => {
        try { onFrames?.(Number(p?.renderedFrames) || 0) } catch {}
      },
    })
  } catch (err) {
    try { unlinkSync(partial) } catch {}
    if (signal?.aborted) throw createAbortError()
    throw err
  } finally {
    dispose()
  }
  const frames = await countVideoFrames(partial)
  if (frames !== chunk.frames) {
    try { unlinkSync(partial) } catch {}
    throw new Error(`分段 #${chunk.index} 帧数校验失败：期望 ${chunk.frames} 帧，实际 ${frames} 帧`)
  }
  try { unlinkSync(outPath) } catch {}
  renameSync(partial, outPath)
  return { frames, sizeBytes: statSync(outPath).size }
}

function chunkVerifyError(message, details) {
  const err = new Error(message)
  err.code = 'CHUNK_VERIFY'
  err.details = details
  return err
}

async function renderRemotionInChunks({
  absProject,
  outMp4Path,
  rendererMod,
  ensureBundle,
  browserExecutable,
  chunkSec,
  snapshotFrames = [],
  snapshotDir = '',
  signal,
  onProgress,
  scale = 1,
}) {
  const { ffmpeg } = resolveBinaries()
  // A scaled (draft) render keeps its own chunk cache: it never evicts the full-quality chunks, and vice versa
  const chunkDir = join(absProject, 'output', scale !== 1 ? '.chunks-draft' : '.chunks')
  mkdirSync(chunkDir, { recursive: true })
  const hashInfo = computeRemotionBundleHash(absProject, { extra: { chunkSec, ...(scale !== 1 ? { scale } : {}) } })
  const tag = hashInfo.hash.slice(0, 12)
  let manifest = readChunkManifest(chunkDir)
  if (!manifest || manifest.version !== CHUNK_MANIFEST_VERSION || manifest.hash !== hashInfo.hash) {
    purgeChunkDir(chunkDir, '')
    manifest = {
      version: CHUNK_MANIFEST_VERSION,
      hash: hashInfo.hash,
      inputs: hashInfo,
      chunkSec,
      fps: null,
      durationInFrames: null,
      chunkFrames: null,
      width: null,
      height: null,
      propsHash: null,
      settings: CHUNK_RENDER_SETTINGS,
      chunks: [],
      createdAt: new Date().toISOString(),
    }
  } else {
    purgeChunkDir(chunkDir, tag)
  }

  let lastEmittedPct = -1
  // Callers format `${frame}/${totalFrames}`, so every event carries the last known frame counters
  let lastFrame = 0
  let lastTotal = Number(manifest.durationInFrames) || 0
  const emit = (pct, message, extra = {}) => {
    if (Number.isFinite(extra.frame)) lastFrame = extra.frame
    if (Number.isFinite(extra.totalFrames)) lastTotal = extra.totalFrames
    if (typeof onProgress !== 'function' || pct === lastEmittedPct) return
    lastEmittedPct = pct
    try {
      onProgress({ pct, progress: pct, message, frame: lastFrame, totalFrames: lastTotal })
    } catch {}
  }

  const chunkPath = (c) => join(chunkDir, c.file)
  const isChunkValid = async (c) => {
    if (!c?.done || !c.file) return false
    const p = chunkPath(c)
    if (!existsSync(p)) return false
    try {
      if (statSync(p).size !== c.sizeBytes) return false
    } catch {
      return false
    }
    return (await countVideoFrames(p)) === c.frames
  }
  const coversTimeline = (m) =>
    Number(m.durationInFrames) > 0 &&
    Array.isArray(m.chunks) &&
    m.chunks.length > 0 &&
    m.chunks[0].start === 0 &&
    m.chunks[m.chunks.length - 1].end === m.durationInFrames - 1 &&
    m.chunks.every((c, i) => i === 0 || c.start === m.chunks[i - 1].end + 1)

  let allDone = coversTimeline(manifest) && manifest.chunks.every((c) => c.done)
  if (allDone) {
    for (const c of manifest.chunks) {
      if (!(await isChunkValid(c))) {
        c.done = false
        allDone = false
      }
    }
  }

  const hw = resolveLowSpecPolicy({
    repoRoot: REPO_ROOT,
    requestedFps: manifest.fps || 30,
    totalDurationSec: manifest.durationInFrames && manifest.fps ? manifest.durationInFrames / manifest.fps : 60,
  })
  let settings = {
    concurrency: hw.remotionConcurrency,
    videoThreads: hw.offthreadVideoThreads,
    cacheBytes: hw.offthreadVideoCacheSizeInBytes,
    delayMs: hw.delayRenderTimeoutMs,
    gl: hw.chromiumGl || undefined,
    lowSpec: false,
  }
  let composition = null
  let browser = null
  const openShared = async () => {
    browser = await rendererMod.openBrowser('chrome', {
      browserExecutable: browserExecutable || null,
      chromiumOptions: { gl: settings.gl },
    })
    return browser
  }
  const closeShared = async () => {
    const b = browser
    browser = null
    if (b) {
      try { await b.close({ silent: true }) } catch {}
    }
  }

  let renderedChunks = 0
  let reusedChunks = 0
  const bundleSkipped = allDone
  const tempFiles = []
  try {
    if (!allDone) {
      const serveUrl = await ensureBundle()
      if (signal?.aborted) throw createAbortError()
      composition = await rendererMod.selectComposition({ serveUrl, id: 'MainVideo', browserExecutable })
      const fps = Number(composition.fps) || 30
      const total = Number(composition.durationInFrames) || 0
      const chunkFrames = Math.max(1, Math.round(chunkSec * fps))
      const propsHash = sha256Hex(stableStringify(composition.props || composition.defaultProps || {}))
      const geometryChanged =
        manifest.fps !== fps ||
        manifest.durationInFrames !== total ||
        manifest.chunkFrames !== chunkFrames ||
        manifest.width !== composition.width ||
        manifest.height !== composition.height ||
        (manifest.propsHash && manifest.propsHash !== propsHash)
      if (geometryChanged || !coversTimeline({ ...manifest, durationInFrames: total })) {
        purgeChunkDir(chunkDir, '')
        manifest.chunks = planRenderChunks(total, chunkFrames).map((c) => ({
          ...c,
          file: `chunk-${tag}-${String(c.index).padStart(4, '0')}.mp4`,
          done: false,
        }))
      }
      Object.assign(manifest, { fps, durationInFrames: total, chunkFrames, width: composition.width, height: composition.height, propsHash })
      for (const c of manifest.chunks) {
        if (c.done && !(await isChunkValid(c))) c.done = false
      }
      writeChunkManifest(chunkDir, manifest)

      const pending = manifest.chunks.filter((c) => !c.done)
      reusedChunks = manifest.chunks.length - pending.length
      let framesDone = manifest.chunks.filter((c) => c.done).reduce((a, c) => a + c.frames, 0)
      emit(5, reusedChunks > 0 ? `复用 ${reusedChunks}/${manifest.chunks.length} 个已完成分段，继续渲染剩余 ${pending.length} 段...` : `分段渲染 ${manifest.chunks.length} 段 (每段 ${chunkFrames} 帧)...`, {
        frame: framesDone,
        totalFrames: total,
      })

      for (const c of pending) {
        if (signal?.aborted) throw createAbortError()
        const startedAt = Date.now()
        const attempt = async () => {
          if (!browser) await openShared()
          return renderOneChunk({
            rendererMod,
            composition,
            serveUrl,
            chunk: c,
            outPath: chunkPath(c),
            settings,
            browser,
            browserExecutable,
            signal,
            scale,
            onFrames: (rendered) => {
              const cur = framesDone + Math.min(c.frames, rendered)
              const pct = Math.min(92, Math.max(5, Math.round(5 + (87 * cur) / Math.max(1, total))))
              emit(pct, `分段 ${c.index + 1}/${manifest.chunks.length} 渲染中 (${cur}/${total} 帧 · ${pct}%)...`, { frame: cur, totalFrames: total })
            },
          })
        }
        let res
        try {
          res = await attempt()
        } catch (err) {
          if (signal?.aborted || err?.name === 'AbortError') throw createAbortError()
          const msg = String(err?.message || err || '')
          const canFallbackLowSpec =
            !settings.lowSpec &&
            (settings.concurrency > 1 || /No frame found at position|Compositor error|timeout|out of memory|Target closed/i.test(msg))
          if (!canFallbackLowSpec) throw err
          settings = {
            ...settings,
            concurrency: 1,
            videoThreads: 1,
            cacheBytes: 128 * 1024 * 1024,
            delayMs: Math.max(180_000, settings.delayMs),
            lowSpec: true,
          }
          await closeShared()
          res = await attempt()
        }
        Object.assign(c, { done: true, sizeBytes: res.sizeBytes, renderedAt: new Date().toISOString(), renderMs: Date.now() - startedAt })
        writeChunkManifest(chunkDir, manifest)
        renderedChunks++
        framesDone += c.frames
      }
    } else {
      reusedChunks = manifest.chunks.length
      emit(90, `全部 ${reusedChunks} 个分段命中缓存，跳过打包与渲染，直接拼接...`, {
        frame: manifest.durationInFrames,
        totalFrames: manifest.durationInFrames,
      })
    }

    const total = manifest.durationInFrames
    const fps = manifest.fps
    const durSec = total / fps
    if (signal?.aborted) throw createAbortError()

    // 1) Frame-exact concat of video-only chunks (stream copy)
    emit(94, '拼接视频分段 (无损流拷贝)...')
    const listPath = join(chunkDir, `concat-${tag}.txt`)
    writeFileSync(listPath, manifest.chunks.map((c) => `file '${c.file}'`).join('\n') + '\n', 'utf8')
    tempFiles.push(listPath)
    const videoOnly = join(chunkDir, `video-${tag}.mp4`)
    tempFiles.push(videoOnly)
    const catRes = await runCommandRedirected(
      ffmpeg,
      ['-y', '-hide_banner', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-map', '0:v:0', '-c', 'copy', '-an', '-video_track_timescale', '90000', videoOnly],
      { cwd: chunkDir, timeoutMs: Math.max(120_000, Math.round(durSec * 1500)), signal },
    )
    if (catRes.code !== 0 || !existsSync(videoOnly)) {
      throw chunkVerifyError(`分段拼接失败: ${String(catRes.stderr || '').slice(-400)}`)
    }

    // 2) Mux the composition audio once
    const audioPlan = resolveCompositionAudioPlan(absProject)
    let audioArgs
    if (audioPlan.mode === 'master') {
      audioArgs = ['-i', audioPlan.path]
    } else if (audioPlan.mode === 'composition') {
      emit(95, '合成组件音轨 (一次性音频渲染)...')
      const serveUrl = await ensureBundle()
      if (!composition) composition = await rendererMod.selectComposition({ serveUrl, id: 'MainVideo', browserExecutable })
      const audioWav = join(chunkDir, `audio-${tag}.wav`)
      tempFiles.push(audioWav)
      const { cancelSignal, dispose } = makeRemotionCancel(rendererMod, signal)
      try {
        await rendererMod.renderMedia({
          composition,
          serveUrl,
          codec: 'wav',
          outputLocation: audioWav,
          overwrite: true,
          browserExecutable,
          concurrency: settings.concurrency,
          delayRenderTimeoutInMilliseconds: settings.delayMs,
          chromiumOptions: { gl: settings.gl || undefined },
          cancelSignal,
        })
      } catch (err) {
        if (signal?.aborted) throw createAbortError()
        throw err
      } finally {
        dispose()
      }
      audioArgs = ['-i', audioWav]
    } else {
      audioArgs = ['-f', 'lavfi', '-t', durSec.toFixed(6), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000']
    }
    emit(97, '封装主音轨并校验帧数与音画同步...')
    const tmpOut = `${outMp4Path}.chunked-${process.pid}.mp4`
    tempFiles.push(tmpOut)
    const muxRes = await runCommandRedirected(
      ffmpeg,
      [
        '-y', '-hide_banner', '-v', 'error',
        '-i', videoOnly,
        ...audioArgs,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy',
        '-af', 'apad',
        '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2',
        '-t', durSec.toFixed(6),
        '-video_track_timescale', '90000',
        '-movflags', '+faststart',
        tmpOut,
      ],
      { timeoutMs: Math.max(180_000, Math.round(durSec * 2000)), signal },
    )
    if (muxRes.code !== 0 || !existsSync(tmpOut)) {
      throw chunkVerifyError(`音轨封装失败: ${String(muxRes.stderr || '').slice(-400)}`)
    }

    // 3) Verify: exact frame count, no boundary duplication/drop, A/V drift ≤ 1 frame
    const probe = await probeMediaJson(tmpOut, { countPackets: true })
    const vStream = (probe.streams || []).find((s) => s.codec_type === 'video') || {}
    const aStream = (probe.streams || []).find((s) => s.codec_type === 'audio') || {}
    const frames = Number(vStream.nb_read_packets || 0)
    const videoDurationSec = Number(vStream.duration || 0)
    const audioDurationSec = Number(aStream.duration || 0)
    const driftSec = Number(Math.abs(videoDurationSec - audioDurationSec).toFixed(4))
    const verify = { frames, expectedFrames: total, videoDurationSec, audioDurationSec, driftSec, maxDriftSec: Number((1 / fps).toFixed(4)) }
    if (frames !== total || !(audioDurationSec > 0) || driftSec > 1 / fps + 0.0015) {
      throw chunkVerifyError(`分段成片校验失败：帧数 ${frames}/${total}，音画漂移 ${driftSec}s`, verify)
    }
    try {
      renameSync(tmpOut, outMp4Path)
    } catch {
      copyFileSync(tmpOut, outMp4Path)
    }

    // 4) Snapshot frames straight from the verified MP4 (exact frame seek)
    if (snapshotDir && snapshotFrames.length > 0) {
      mkdirSync(snapshotDir, { recursive: true })
      for (let i = 0; i < snapshotFrames.length; i++) {
        const f = Math.max(0, Math.min(total - 1, Number(snapshotFrames[i]) || 0))
        await runCommandRedirected(
          ffmpeg,
          ['-y', '-hide_banner', '-v', 'error', '-ss', Math.max(0, (f - 0.5) / fps).toFixed(4), '-i', outMp4Path, '-frames:v', '1', join(snapshotDir, `shot_${String(i).padStart(2, '0')}.png`)],
          { timeoutMs: 20_000, signal },
        ).catch(() => {})
      }
    }

    if (String(process.env.DSH_RENDER_CHUNK_KEEP ?? '').trim() === '0') {
      purgeChunkDir(chunkDir, '')
      try { unlinkSync(join(chunkDir, 'manifest.json')) } catch {}
    }
    emit(100, `分段渲染完成：新渲染 ${renderedChunks} 段 · 复用 ${reusedChunks} 段 · ${total} 帧校验通过`)
    return {
      ok: true,
      framesRendered: total,
      outputPath: outMp4Path,
      chunked: {
        enabled: true,
        chunkSec,
        chunkFrames: manifest.chunkFrames,
        totalChunks: manifest.chunks.length,
        renderedChunks,
        reusedChunks,
        bundleSkipped,
        hash: tag,
        manifestPath: join(chunkDir, 'manifest.json'),
        audioMode: audioPlan.mode,
        lowSpecFallback: settings.lowSpec,
        verify,
      },
    }
  } finally {
    await closeShared()
    for (const f of tempFiles) {
      try { unlinkSync(f) } catch {}
    }
  }
}

/**
 * Render the project's `MainVideo` composition. `scale` (Remotion's render option, e.g. 2/3 for a 720p draft of a 1080p
 * composition) renders every frame / still at the scaled size; omitted or 1 renders at the composition size.
 */
export async function renderRemotionProject({
  projectDir,
  outMp4Path,
  snapshotFrames = [],
  snapshotDir = '',
  onlySnapshots = false,
  signal,
  onProgress,
  chunkSec,
  scale,
}) {
  if (signal?.aborted) throw createAbortError()
  const renderScale = normalizeRenderScale(scale)
  const scaleOption = renderScale !== 1 ? { scale: renderScale } : {}
  const runtime = resolveRemotionRuntime()
  if (!runtime || !existsSync(runtime.rendererEntry) || !existsSync(runtime.bundlerEntry)) {
    return {
      ok: false,
      reason: 'Remotion runtime not found (install plugin dependencies or configure REMOTION_TEMPLATE_ROOT)',
    }
  }

  const absProject = resolve(projectDir)
  ensureRemotionJunction(absProject)

  const bundlerMod = await import(pathToFileURL(runtime.bundlerEntry).href)
  const rendererMod = await import(pathToFileURL(runtime.rendererEntry).href)

  const entryPoint = existsSync(join(absProject, 'src', 'index.ts'))
    ? join(absProject, 'src', 'index.ts')
    : join(absProject, 'src', 'Root.tsx')
  const publicDir = join(absProject, 'public')
  const browserExecutable = findRemotionBrowser(runtime) || resolveBrowserExecutable() || undefined

  // Every bundle created by THIS call is deleted in `finally` (success, failure or abort)
  const bundleState = { dir: '', serveUrl: '' }
  const ensureBundle = async () => {
    if (bundleState.serveUrl) return bundleState.serveUrl
    const serveUrl = await bundlerMod.bundle({
      entryPoint,
      publicDir: existsSync(publicDir) ? publicDir : undefined,
      onProgress: () => {},
      onDirectoryCreated: (dir) => {
        bundleState.dir = dir
      },
    })
    bundleState.serveUrl = serveUrl
    if (!bundleState.dir) bundleState.dir = serveUrl
    return serveUrl
  }

  const effectiveChunkSec = resolveRenderChunkSec(chunkSec)
  let chunkFallbackReason = ''
  try {
    if (!onlySnapshots && outMp4Path && effectiveChunkSec > 0) {
      try {
        return await renderRemotionInChunks({
          absProject,
          outMp4Path,
          rendererMod,
          ensureBundle,
          browserExecutable,
          chunkSec: effectiveChunkSec,
          snapshotFrames,
          snapshotDir,
          signal,
          onProgress,
          scale: renderScale,
        })
      } catch (err) {
        if (signal?.aborted || err?.name === 'AbortError' || err?.code !== 'CHUNK_VERIFY') throw err
        // Concat/mux/verification problem: fall back to the legacy single pass with the same bundle
        chunkFallbackReason = String(err?.message || err)
      }
    }

    const serveUrl = await ensureBundle()

    const composition = await rendererMod.selectComposition({
      serveUrl,
      id: 'MainVideo',
      browserExecutable,
    })

    if (snapshotDir && snapshotFrames.length > 0) {
      mkdirSync(snapshotDir, { recursive: true })
      for (let i = 0; i < snapshotFrames.length; i++) {
        await rendererMod.renderStill({
          composition,
          serveUrl,
          frame: snapshotFrames[i],
          output: join(snapshotDir, `shot_${String(i).padStart(2, '0')}.png`),
          imageFormat: 'png',
          browserExecutable,
          offthreadVideoThreads: 1,
          offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024,
          ...scaleOption,
        })
      }
    }

    if (!onlySnapshots && outMp4Path) {
      const totalSec = Math.max(4, (composition.durationInFrames || 300) / (composition.fps || 30))
      const hwPolicy = resolveLowSpecPolicy({
        repoRoot: REPO_ROOT,
        requestedFps: composition.fps || 30,
        totalDurationSec: totalSec,
      })
      const attemptRender = async (concurrency, videoThreads, cacheBytes, delayTimeoutMs) => {
        const { cancelSignal, cancel } = typeof rendererMod.makeCancelSignal === 'function'
          ? rendererMod.makeCancelSignal()
          : { cancelSignal: undefined, cancel: () => {} }
        const onRemotionAbort = () => {
          try { cancel() } catch {}
        }
        signal?.addEventListener('abort', onRemotionAbort, { once: true })
        try {
          await rendererMod.renderMedia({
            composition,
            serveUrl,
            ...scaleOption,
            codec: 'h264',
            pixelFormat: 'yuv420p',
            audioCodec: 'aac',
            crf: 19,
            outputLocation: outMp4Path,
            browserExecutable,
            concurrency,
            offthreadVideoThreads: videoThreads,
            offthreadVideoCacheSizeInBytes: cacheBytes,
            delayRenderTimeoutInMilliseconds: delayTimeoutMs,
            chromiumOptions: {
              gl: hwPolicy.chromiumGl || undefined,
            },
            cancelSignal,
          })
        } finally {
          signal?.removeEventListener('abort', onRemotionAbort)
        }
      }

      try {
        await attemptRender(
          hwPolicy.remotionConcurrency,
          hwPolicy.offthreadVideoThreads,
          hwPolicy.offthreadVideoCacheSizeInBytes,
          hwPolicy.delayRenderTimeoutMs,
        )
      } catch (err) {
        const msg = String(err?.message || err || '')
        const canFallbackLowSpec =
          !signal?.aborted &&
          (hwPolicy.remotionConcurrency > 1 || /No frame found at position|Compositor error|timeout|out of memory|Target closed/i.test(msg))
        if (!canFallbackLowSpec) throw err
        await attemptRender(1, 1, 128 * 1024 * 1024, Math.max(180_000, hwPolicy.delayRenderTimeoutMs))
      }
    }

    return {
      ok: true,
      framesRendered: composition.durationInFrames,
      outputPath: outMp4Path,
      chunked: { enabled: false, ...(chunkFallbackReason ? { fallbackReason: chunkFallbackReason } : {}) },
    }
  } finally {
    removeRemotionBundleDir(bundleState.dir)
  }
}
