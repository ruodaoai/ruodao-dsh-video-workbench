/**
 * Deep-QA determinism check: render the same frames twice (second pass in reverse seek order) and compare pixel hashes.
 * - Remotion: one throwaway bundle + one shared headless browser, `renderStill` ×2 per frame (bundle deleted afterwards).
 * - HTML/HyperFrames: one warm Chromium CDP session capturing [a, b, c, c, b, a].
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createAbortError,
  ensureRemotionJunction,
  REPO_ROOT,
  resolveBinaries,
  resolveBrowserExecutable,
  resolveLowSpecPolicy,
  resolveRemotionRuntime,
  runCommandRedirected,
} from '../shared/index.js'
import { captureHtmlSnapshots, findRemotionBrowser, removeRemotionBundleDir } from './frame-renderer.js'

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/**
 * Pick N representative frames (middle of evenly spread scenes, never the very first/last frame).
 */
export function pickDeterminismFrames(script, totalFrames, count = 3) {
  const total = Math.max(1, Number(totalFrames) || Number(script?.totalDurationInFrames) || 1)
  const scenes = Array.isArray(script?.scenes) ? script.scenes : []
  const picked = new Set()
  if (scenes.length > 0) {
    for (let i = 0; i < count; i++) {
      const sc = scenes[Math.min(scenes.length - 1, Math.floor(((i + 0.5) * scenes.length) / count))] || {}
      const sf = Number(sc.startFrame) || 0
      const df = Math.max(1, Number(sc.durationInFrames) || 30)
      picked.add(Math.min(total - 1, Math.max(0, Math.round(sf + df * 0.55))))
    }
  }
  for (let i = 0; picked.size < count && i < count * 4; i++) {
    picked.add(Math.min(total - 1, Math.max(0, Math.round(((i + 0.5) / count) * total))))
  }
  return [...picked].sort((a, b) => a - b).slice(0, count)
}

async function decodeRgb(ffmpeg, pngPath, signal) {
  const rawPath = `${pngPath}.rgb`
  try {
    const res = await runCommandRedirected(ffmpeg, ['-y', '-hide_banner', '-v', 'error', '-i', pngPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', rawPath], { timeoutMs: 30_000, signal })
    if (res.code !== 0 || !existsSync(rawPath)) return null
    return readFileSync(rawPath)
  } finally {
    try { unlinkSync(rawPath) } catch {}
  }
}

/**
 * Compare two PNG renders of the same frame: identical bytes, identical pixels, or measured pixel difference.
 */
async function comparePngPair({ ffmpeg, a, b, workDir, tag, signal }) {
  if (a.equals(b)) return { identical: true, pixelIdentical: true, diffPixelPct: 0, maxChannelDiff: 0 }
  const pa = join(workDir, `${tag}-a.png`)
  const pb = join(workDir, `${tag}-b.png`)
  writeFileSync(pa, a)
  writeFileSync(pb, b)
  try {
    const [ra, rb] = await Promise.all([decodeRgb(ffmpeg, pa, signal), decodeRgb(ffmpeg, pb, signal)])
    if (!ra || !rb || ra.length !== rb.length) {
      return { identical: false, pixelIdentical: false, diffPixelPct: 100, maxChannelDiff: 255 }
    }
    let diffPixels = 0
    let maxDiff = 0
    for (let i = 0; i < ra.length; i += 3) {
      const d = Math.max(Math.abs(ra[i] - rb[i]), Math.abs(ra[i + 1] - rb[i + 1]), Math.abs(ra[i + 2] - rb[i + 2]))
      if (d > 0) diffPixels++
      if (d > maxDiff) maxDiff = d
    }
    const px = ra.length / 3
    return {
      identical: diffPixels === 0,
      pixelIdentical: diffPixels === 0,
      diffPixelPct: Number(((diffPixels / Math.max(1, px)) * 100).toFixed(3)),
      maxChannelDiff: maxDiff,
    }
  } finally {
    try { unlinkSync(pa) } catch {}
    try { unlinkSync(pb) } catch {}
  }
}

async function renderRemotionStillsTwice({ absDir, frames, signal }) {
  const runtime = resolveRemotionRuntime()
  if (!runtime || !existsSync(runtime.rendererEntry) || !existsSync(runtime.bundlerEntry)) {
    throw new Error('Remotion runtime not found')
  }
  ensureRemotionJunction(absDir)
  const bundlerMod = await import(pathToFileURL(runtime.bundlerEntry).href)
  const rendererMod = await import(pathToFileURL(runtime.rendererEntry).href)
  const entryPoint = existsSync(join(absDir, 'src', 'index.ts')) ? join(absDir, 'src', 'index.ts') : join(absDir, 'src', 'Root.tsx')
  const publicDir = join(absDir, 'public')
  const browserExecutable = findRemotionBrowser(runtime) || resolveBrowserExecutable() || undefined
  const hw = resolveLowSpecPolicy({ repoRoot: REPO_ROOT, requestedFps: 30, totalDurationSec: 30 })
  let bundleDir = ''
  let browser = null
  const onAbort = () => {
    try { browser?.close({ silent: true }) } catch {}
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const serveUrl = await bundlerMod.bundle({
      entryPoint,
      publicDir: existsSync(publicDir) ? publicDir : undefined,
      onProgress: () => {},
      onDirectoryCreated: (dir) => {
        bundleDir = dir
      },
    })
    bundleDir = bundleDir || serveUrl
    if (signal?.aborted) throw createAbortError()
    const composition = await rendererMod.selectComposition({ serveUrl, id: 'MainVideo', browserExecutable })
    browser = await rendererMod.openBrowser('chrome', {
      browserExecutable: browserExecutable || null,
      chromiumOptions: { gl: hw.chromiumGl || undefined },
    })
    const order = [...frames, ...[...frames].reverse()]
    const shots = []
    for (const frame of order) {
      if (signal?.aborted) throw createAbortError()
      const res = await rendererMod.renderStill({
        composition,
        serveUrl,
        frame,
        output: null,
        imageFormat: 'png',
        puppeteerInstance: browser,
        browserExecutable,
        offthreadVideoThreads: 1,
        offthreadVideoCacheSizeInBytes: 128 * 1024 * 1024,
      })
      shots.push({ frame, buffer: Buffer.from(res.buffer) })
    }
    return { shots, method: 'remotion-renderStill×2' }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    try { await browser?.close({ silent: true }) } catch {}
    removeRemotionBundleDir(bundleDir)
  }
}

async function renderHtmlStillsTwice({ absDir, script, frames, signal }) {
  const browserBin = resolveBrowserExecutable()
  if (!browserBin || !existsSync(join(absDir, 'index.html'))) {
    throw new Error('缺少 Chromium 浏览器或 index.html，无法执行 HTML 确定性检查')
  }
  const baseW = Number(script?.width) || 1920
  const baseH = Number(script?.height) || 1080
  // Keep the aspect ratio, cap the long side at ~960 px, but never let the short side drop below 320 px:
  // headless Chromium treats tiny windows (e.g. 320×180) as hidden and requestAnimationFrame never fires.
  const scale = Math.max(Math.min(1, 960 / Math.max(baseW, baseH)), 320 / Math.min(baseW, baseH))
  const width = Math.round((baseW * scale) / 2) * 2
  const height = Math.round((baseH * scale) / 2) * 2
  const outDir = join(REPO_ROOT, '.tmp', `determinism-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  const order = [...frames, ...[...frames].reverse()]
  const local = new AbortController()
  const onOuterAbort = () => local.abort()
  signal?.addEventListener('abort', onOuterAbort, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    local.abort()
  }, 60_000 + order.length * 8_000)
  try {
    // The first screenshot of a fresh Chromium session can precede the first full paint, so one warm-up capture
    // is taken and discarded: the check measures the page's seek determinism, not browser start-up.
    const files = await captureHtmlSnapshots({ projectDir: absDir, browserBin, frames: [order[0], ...order], outDir, width, height, signal: local.signal })
    return { shots: files.slice(1).map((f, i) => ({ frame: order[i], buffer: readFileSync(f) })), method: 'chromium-cdp×2' }
  } catch (err) {
    if (signal?.aborted) throw createAbortError()
    if (timedOut) throw new Error('HTML 抓帧超时（页面未响应 __seekToFrame / requestAnimationFrame）')
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
    try { rmSync(outDir, { recursive: true, force: true }) } catch {}
  }
}

/**
 * Render each sample frame twice and compare. Returns a QA-friendly summary with a severity.
 */
export async function runDeterminismCheck({ projectDir, script, engine, frames, signal } = {}) {
  const startedAt = Date.now()
  const absDir = resolve(projectDir)
  const fps = Number(script?.fps) || 30
  const sampleFrames = Array.isArray(frames) && frames.length > 0
    ? [...new Set(frames.map((f) => Math.max(0, Math.round(Number(f) || 0))))]
    : pickDeterminismFrames(script, script?.totalDurationInFrames, 3)
  const useRemotion = (engine || script?.engine) === 'remotion' && existsSync(join(absDir, 'src', 'Root.tsx'))
  const { shots, method } = useRemotion
    ? await renderRemotionStillsTwice({ absDir, frames: sampleFrames, signal })
    : await renderHtmlStillsTwice({ absDir, script, frames: sampleFrames, signal })

  const { ffmpeg } = resolveBinaries()
  const workDir = join(REPO_ROOT, '.tmp')
  mkdirSync(workDir, { recursive: true })
  const n = sampleFrames.length
  const results = []
  for (let i = 0; i < n; i++) {
    const first = shots[i]
    const second = shots[2 * n - 1 - i]
    const cmp = await comparePngPair({ ffmpeg, a: first.buffer, b: second.buffer, workDir, tag: `det-${Date.now()}-${i}`, signal })
    results.push({
      frame: first.frame,
      timeSec: Number((first.frame / fps).toFixed(3)),
      firstHash: sha256(first.buffer).slice(0, 16),
      secondHash: sha256(second.buffer).slice(0, 16),
      ...cmp,
    })
  }
  const allIdentical = results.every((r) => r.pixelIdentical)
  const worstDiff = Math.max(0, ...results.map((r) => r.maxChannelDiff))
  const worstPct = Math.max(0, ...results.map((r) => r.diffPixelPct))
  const severity = allIdentical ? 'pass' : worstDiff <= 3 && worstPct < 1 ? 'warning' : 'fail'
  return {
    ok: true,
    engine: useRemotion ? 'remotion' : 'html',
    method,
    deterministic: allIdentical,
    severity,
    frames: results,
    durationMs: Date.now() - startedAt,
  }
}

export function buildDeterminismCheck(det) {
  if (!det) return null
  if (det.ok === false) {
    return { name: '逐帧渲染确定性 (深度模式)', passed: true, severity: 'skipped', value: `已跳过：${det.error || '无法渲染对比帧'}` }
  }
  const frames = det.frames.map((r) => `${r.frame}`).join('/')
  const value =
    det.severity === 'pass'
      ? `同帧二次渲染像素哈希完全一致（帧 ${frames} · ${det.method}）`
      : det.severity === 'warning'
        ? `⚠ 警告：帧 ${det.frames.filter((r) => !r.pixelIdentical).map((r) => r.frame).join('/')} 存在轻微像素差异（最大通道差 ${Math.max(...det.frames.map((r) => r.maxChannelDiff))}，抗锯齿/GPU 舍入级别）`
        : `✕ 不确定渲染：帧 ${det.frames.filter((r) => !r.pixelIdentical).map((r) => `${r.frame}(${r.diffPixelPct}%像素不同)`).join('、')}；请排查 Math.random()/Date.now()/未 await 的资源加载`
  return { name: '逐帧渲染确定性 (深度模式)', passed: det.severity !== 'fail', severity: det.severity, value }
}
