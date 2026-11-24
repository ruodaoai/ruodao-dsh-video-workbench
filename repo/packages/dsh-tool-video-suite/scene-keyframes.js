/**
 * Render a few keyframes per scene of a Remotion project as small JPEGs — the eyes of the visual self-review
 * (packages/dsh-tool-media/visual-review.js): the AI coder's scenes are looked at before the film is rendered.
 *
 * One throwaway bundle + one headless browser for all stills; the bundle is always deleted afterwards. Frames are
 * absolute composition frames of `MainVideo` (so the compositor's subtitles / badge are visible, as in the film).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createAbortError,
  ensureRemotionJunction,
  REPO_ROOT,
  resolveBrowserExecutable,
  resolveLowSpecPolicy,
  resolveRemotionRuntime,
} from '../shared/index.js'
import { findRemotionBrowser, removeRemotionBundleDir } from './frame-renderer.js'

/** Absolute start / length (frames) of every scene, from the locked timing or the running sum of durations. */
export function sceneFrameSpans(scenes = [], fps = 30) {
  const out = []
  let cursor = 0
  for (const sc of Array.isArray(scenes) ? scenes : []) {
    const dur = Number(sc?.durationInFrames) > 0 ? Math.round(Number(sc.durationInFrames)) : Math.max(1, Math.round((Number(sc?.durationSec) || 4) * fps))
    const start = Number.isFinite(Number(sc?.startFrame)) ? Math.max(0, Math.round(Number(sc.startFrame))) : cursor
    out.push({ id: sc?.id, start, dur })
    cursor = start + dur
  }
  return out
}

/**
 * Keyframes to look at for each scene: `fractions` of the way through the shot (entry animations finish within the
 * first ~25%, so 0.35 shows the composed shot and 0.8 shows whether it is still alive near the end).
 */
export function planSceneKeyframes(scenes = [], fps = 30, fractions = [0.35, 0.8]) {
  const spans = sceneFrameSpans(scenes, fps)
  const out = []
  for (const sp of spans) {
    if (!sp.id) continue
    for (const f of fractions) {
      const local = Math.min(sp.dur - 1, Math.max(0, Math.round(sp.dur * f)))
      out.push({ sceneId: sp.id, fraction: f, frame: sp.start + local })
    }
  }
  return out
}

/**
 * Render the planned keyframes. Returns { ok, frames: [{ sceneId, fraction, frame, base64, file }], reason }.
 * `scale` shrinks the stills (0.5 → 960×540 for a 1080p film); `outDir` (optional) keeps a copy of every JPEG.
 */
export async function renderSceneKeyframes({ projectDir, keyframes = [], scale = 0.5, jpegQuality = 78, outDir = '', signal, onProgress } = {}) {
  if (!projectDir || keyframes.length === 0) return { ok: false, frames: [], reason: 'no keyframes' }
  const runtime = resolveRemotionRuntime()
  if (!runtime || !existsSync(runtime.rendererEntry) || !existsSync(runtime.bundlerEntry)) {
    return { ok: false, frames: [], reason: 'Remotion runtime not found' }
  }
  ensureRemotionJunction(projectDir)
  const bundlerMod = await import(pathToFileURL(runtime.bundlerEntry).href)
  const rendererMod = await import(pathToFileURL(runtime.rendererEntry).href)
  const entryPoint = existsSync(join(projectDir, 'src', 'index.ts')) ? join(projectDir, 'src', 'index.ts') : join(projectDir, 'src', 'Root.tsx')
  const publicDir = join(projectDir, 'public')
  const browserExecutable = findRemotionBrowser(runtime) || resolveBrowserExecutable() || undefined
  const hw = resolveLowSpecPolicy({ repoRoot: REPO_ROOT, requestedFps: 30, totalDurationSec: 30 })
  if (outDir) mkdirSync(outDir, { recursive: true })
  let bundleDir = ''
  let browser = null
  const onAbort = () => {
    try {
      browser?.close({ silent: true })
    } catch {}
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  const frames = []
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
    browser = await rendererMod.openBrowser('chrome', {
      browserExecutable: browserExecutable || null,
      chromiumOptions: { gl: hw.chromiumGl || undefined },
    })
    const composition = await rendererMod.selectComposition({ serveUrl, id: 'MainVideo', browserExecutable, puppeteerInstance: browser })
    const last = Math.max(0, (composition.durationInFrames || 1) - 1)
    for (let i = 0; i < keyframes.length; i++) {
      if (signal?.aborted) throw createAbortError()
      const kf = keyframes[i]
      const frame = Math.min(last, Math.max(0, Math.round(kf.frame)))
      const res = await rendererMod.renderStill({
        composition,
        serveUrl,
        frame,
        output: null,
        imageFormat: 'jpeg',
        jpegQuality,
        scale,
        puppeteerInstance: browser,
        browserExecutable,
        offthreadVideoThreads: 1,
        offthreadVideoCacheSizeInBytes: 128 * 1024 * 1024,
      })
      const buf = Buffer.from(res.buffer)
      let file = ''
      if (outDir) {
        file = join(outDir, `${String(kf.sceneId).replace(/[^\w-]+/g, '_')}-${Math.round(kf.fraction * 100)}.jpg`)
        try {
          writeFileSync(file, buf)
        } catch {
          file = ''
        }
      }
      frames.push({ ...kf, frame, base64: buf.toString('base64'), file })
      onProgress?.(Math.round(((i + 1) / keyframes.length) * 100), `${i + 1}/${keyframes.length}`)
    }
    return { ok: frames.length > 0, frames, reason: '' }
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') throw err
    return { ok: frames.length > 0, frames, reason: String(err?.message || err).slice(0, 300) }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    try {
      await browser?.close({ silent: true })
    } catch {}
    removeRemotionBundleDir(bundleDir)
  }
}
