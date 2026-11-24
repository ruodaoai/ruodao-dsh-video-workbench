/**
 * @dsh-video/tool-media — Publish-pack cover studio (发布包封面：默认 / 选用视频画面 / AI 重新生成)
 *
 * Every file lives in `<project>/output/covers/` (never script.json):
 *   auto/auto-NN-<ms>.jpg + auto/auto.json   automatic candidates + scores, cached per final.mp4 (size + mtime)
 *   frame-<frame>.png                        frames picked in the player (frame-accurate, lossless)
 *   ai-<stamp>.png  (+ ai-raw/<provider file>) AI covers cropped to the chosen aspect (raw = paid result, ledger reuse)
 *   titled-<stamp>.png                       a cover with the title composited by the Studio (canvas, Noto Sans SC)
 *   cover.json                               { mode, file, timeSec, prompt, aspect, provider, createdAt, … , ai[],
 *                                              frames[], titled[], packs{ <platform>: { mode, file, usedAt, … } } }
 *
 * 默认（自动）: 8–12 candidate frames spread over 10–80 % of the film plus settled mid-scene moments are scored from their
 * pixels (no black / white / flat frame, no fade or transition — luma change to the frame 0.2 s later —, sharp, colourful,
 * contrasty, well exposed, away from scene cuts, title scene preferred). Deterministic; candidates extracted in parallel.
 * The publish pack copies the chosen cover as cover.png (`resolvePackCover`).
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { readScriptJson, resolveBinaries, runCommandRedirected } from '../shared/index.js'
import { CLOUD_MEDIA_PRESETS, generateCloudMediaAsset, loadCloudMediaConfig, resolveReferenceImageCapability } from './cloud-media.js'
import { callLlmChat, extractJsonFromLlmText, resolveLlmConfig } from './llm-client.js'
import { readJsonSafe, withFileLockSync, writeJsonAtomic } from './safe-json-store.js'

export const COVER_DIR_REL = 'output/covers'
export const COVER_ASPECTS = Object.freeze(['3:4', '9:16', '16:9', '1:1', '4:3'])
export const COVER_MODES = Object.freeze(['auto', 'frame', 'ai', 'title'])
const AUTO_CACHE_VERSION = 1
const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i
const MAX_TITLED_PNG_BYTES = 40 * 1024 * 1024
/** platform → recommended cover aspect (小红书 3:4 · 抖音 / 快手 / 视频号 9:16 · B 站 / YouTube 16:9) */
export const PLATFORM_COVER_ASPECT = Object.freeze({
  xiaohongshu: '3:4',
  douyin: '9:16',
  kuaishou: '9:16',
  wechat: '9:16',
  'wechat-channels': '9:16',
  shipinhao: '9:16',
  bilibili: '16:9',
  youtube: '16:9',
})

/** Client-input error (exposed message + 4xx status + optional code for the UI). */
export class CoverError extends Error {
  constructor(message, { status = 400, code = '' } = {}) {
    super(message)
    this.name = 'CoverError'
    this.status = status
    this.expose = true
    if (code) this.code = code
  }
}

/* ---------------------------------------------------------------------------------------------- small helpers */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}
const stamp = () => {
  const d = new Date()
  const p = (x, n = 2) => String(x).padStart(n, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
}
const coverDirAbs = (abs) => join(abs, 'output', 'covers')
const autoDirAbs = (abs) => join(abs, 'output', 'covers', 'auto')
const coverJsonAbs = (abs) => join(abs, 'output', 'covers', 'cover.json')
const toRel = (abs, file) => relative(abs, file).split(sep).join('/')
const finalMp4Abs = (abs) => join(abs, 'output', 'final.mp4')

function safeScript(abs) {
  try {
    return readScriptJson(abs).data || {}
  } catch {
    return {}
  }
}

/** `${size}:${mtime}` of output/final.mp4, '' when there is no film. */
export function mp4Signature(mp4Path) {
  try {
    const st = statSync(mp4Path)
    return st.isFile() && st.size > 0 ? `${st.size}:${Math.round(st.mtimeMs)}` : ''
  } catch {
    return ''
  }
}

/** Run `fn` over `items` with at most `n` in flight; results keep the input order. */
async function pool(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker))
  return out
}

function aspectString(w, h) {
  if (!(w > 0 && h > 0)) return ''
  const r = w / h
  let best = ''
  let bestErr = Infinity
  for (const a of COVER_ASPECTS) {
    const [x, y] = a.split(':').map(Number)
    const err = Math.abs(r - x / y) / (x / y)
    if (err < bestErr) {
      bestErr = err
      best = a
    }
  }
  return bestErr < 0.06 ? best : `${w}:${h}`
}

/** Recommended AI cover aspect for a platform; falls back to the film's own aspect (when it is one of the five) or 16:9. */
export function coverAspectForPlatform(platform = '', videoAspect = '') {
  const p = String(platform || '').toLowerCase()
  if (PLATFORM_COVER_ASPECT[p]) return PLATFORM_COVER_ASPECT[p]
  return COVER_ASPECTS.includes(videoAspect) ? videoAspect : '16:9'
}

/**
 * Resolve a cover file given by the UI ('output/covers/…' or a bare name inside it) → { abs, rel }. Anything outside
 * `<project>/output/covers/` or not an image is refused.
 */
export function resolveCoverFile(projectDir, rel) {
  const abs = resolve(projectDir)
  const s = String(rel || '').trim().replace(/\\/g, '/')
  if (!s || s.length > 300 || s.includes('\0')) throw new CoverError('封面文件路径无效')
  if (/^[a-z]:/i.test(s) || s.startsWith('/')) throw new CoverError('封面文件必须在工程的 output/covers/ 文件夹里')
  const withDir = s.startsWith(`${COVER_DIR_REL}/`) ? s : `${COVER_DIR_REL}/${s}`
  if (withDir.split('/').some((seg) => !seg || seg === '..' || seg === '.')) throw new CoverError('封面文件必须在工程的 output/covers/ 文件夹里')
  const root = coverDirAbs(abs)
  const file = resolve(abs, withDir)
  if (!file.startsWith(root + sep)) throw new CoverError('封面文件必须在工程的 output/covers/ 文件夹里')
  if (!IMAGE_EXT_RE.test(file)) throw new CoverError('封面只能是 PNG / JPG / WEBP 图片')
  return { abs: file, rel: toRel(abs, file) }
}

/* ------------------------------------------------------------------------------------------------- probing */
const PROBE_CACHE = new Map() // `${path}|${sig}` → video info

async function ffprobeJson(file, entries) {
  const { ffprobe } = resolveBinaries()
  const { code, stdout, stderr } = await runCommandRedirected(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'json', file], {
    timeoutMs: 30_000,
  })
  if (code !== 0) throw new Error(`ffprobe 读取失败：${String(stderr || '').slice(0, 200)}`)
  try {
    return JSON.parse(stdout || '{}')
  } catch {
    throw new Error('ffprobe 返回了无法解析的结果')
  }
}

/** { width, height, fps, durationSec, frames, aspect } of a video file. */
export async function probeVideo(mp4Path) {
  const j = await ffprobeJson(mp4Path, 'stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,duration:format=duration')
  const s = (j.streams && j.streams[0]) || {}
  const rate = (r) => {
    const [a, b] = String(r || '').split('/').map(Number)
    return a > 0 && b > 0 ? a / b : 0
  }
  let fps = rate(s.r_frame_rate) || rate(s.avg_frame_rate) || 30
  if (!(fps > 0.5 && fps <= 240)) fps = 30
  const durationSec = Number(s.duration) || Number(j.format && j.format.duration) || 0
  const width = Number(s.width) || 0
  const height = Number(s.height) || 0
  const frames = Number(s.nb_frames) > 0 ? Number(s.nb_frames) : Math.max(1, Math.round(durationSec * fps))
  return { width, height, fps: round(fps, 3), durationSec: round(durationSec, 3), frames, aspect: aspectString(width, height) }
}

async function probeVideoCached(mp4Path, sig) {
  const key = `${mp4Path}|${sig}`
  if (PROBE_CACHE.has(key)) return PROBE_CACHE.get(key)
  const info = await probeVideo(mp4Path)
  if (PROBE_CACHE.size > 50) PROBE_CACHE.delete(PROBE_CACHE.keys().next().value)
  PROBE_CACHE.set(key, info)
  return info
}

/** { width, height } of an image file. */
export async function probeImageSize(file) {
  const j = await ffprobeJson(file, 'stream=width,height')
  const s = (j.streams && j.streams[0]) || {}
  return { width: Number(s.width) || 0, height: Number(s.height) || 0 }
}

/* ------------------------------------------------------------------------------------------------ timeline */
/** Scene start / end seconds from script.json (startFrame, startSec or cumulative durations — like the scene thumbs). */
export function sceneTimeline(script, fps = 30) {
  const scenes = Array.isArray(script && script.scenes) ? script.scenes : []
  let cursor = 0
  return scenes.map((sc, i) => {
    const s = sc || {}
    const start = Number.isFinite(Number(s.startFrame)) && s.startFrame !== null && s.startFrame !== '' ? Number(s.startFrame) / fps : Number.isFinite(Number(s.startSec)) && s.startSec !== null && s.startSec !== '' ? Number(s.startSec) : cursor
    const dur = Math.max(0.2, Number(s.durationSec) || (Number(s.durationInFrames) ? Number(s.durationInFrames) / fps : 3))
    cursor = start + dur
    return { index: i, id: String(s.id || `scene-${String(i + 1).padStart(2, '0')}`), start, end: start + dur, dur, scene: s }
  })
}

function sceneAt(timeline, t) {
  if (!Array.isArray(timeline) || !Number.isFinite(t)) return null
  return timeline.find((s) => t >= s.start && t < s.end) || null
}

const normTitle = (s) => String(s || '').replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase()

function isTitleScene(sc, title) {
  const t = normTitle(title)
  if (!t || t.length < 2) return false
  const s = sc && sc.scene
  if (!s) return false
  return [s.headline, s.title, s.subheadline, s.onScreenText].some((x) => {
    const n = normTitle(x)
    return n && (n.includes(t) || (n.length >= 4 && t.includes(n)))
  })
}

/** Text that describes what a scene shows (for the AI prompt writer). */
function sceneVisualText(s = {}) {
  const parts = [s.visualBlueprint, s.visualPrompt, s.visual, s.description, s.motionNotes, s.headline, s.subheadline]
  if (Array.isArray(s.highlights)) parts.push(s.highlights.join('、'))
  return parts
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim())
    .filter((x, i, a) => a.indexOf(x) === i)
    .join('；')
}

/**
 * Candidate moments: evenly over 10–80 % of the film (8–10) plus the settled middle of up to 4 scenes (scene thumbnails
 * are taken from the same moments), snapped to frames, de-duplicated, at most 12.
 */
export function candidateTimes(durationSec, fps = 30, timeline = []) {
  const D = Number(durationSec)
  if (!(D > 0)) return []
  const f = fps > 0 ? fps : 30
  const snap = (t) => Math.max(0, Math.min(Math.max(0, D - 1 / f), Math.round(t * f) / f))
  if (D < 1.2) return [{ t: snap(D * 0.5), source: 'uniform' }]
  const mids = (timeline || [])
    .filter((s) => s.dur >= 0.8)
    .map((s) => ({ t: s.start + s.dur * 0.55, source: 'scene', sceneId: s.id }))
    .filter((c) => c.t >= D * 0.06 && c.t <= D * 0.9)
  const pickedMids = []
  if (mids.length <= 4) pickedMids.push(...mids)
  else for (let i = 0; i < 4; i++) pickedMids.push(mids[Math.round((i * (mids.length - 1)) / 3)])
  const nUniform = pickedMids.length >= 3 ? 8 : 10
  const uniform = Array.from({ length: nUniform }, (_, i) => ({ t: D * (0.1 + (0.7 * i) / (nUniform - 1)), source: 'uniform' }))
  const all = [...pickedMids, ...uniform].map((c) => ({ ...c, t: snap(c.t) }))
  const minGap = Math.max(0.25, D * 0.02)
  const kept = []
  for (const c of all) if (!kept.some((k) => Math.abs(k.t - c.t) < minGap)) kept.push(c) // scene mids first: they win ties
  return kept.sort((a, b) => a.t - b.t).slice(0, 12)
}

/* ------------------------------------------------------------------------------------------------- metrics */
/**
 * Pixel statistics of one RGB24 frame (+ the frame 0.2 s later for motion / fades). Pure & deterministic.
 * meanY / stdY (BT.601 luma), dark / bright fractions, 64-bin luma entropy (bits), Hasler–Süsstrunk colourfulness,
 * Laplacian variance + edge density (sharpness), motion = mean |ΔY| to the next frame, lumaDelta = meanY(next) − meanY.
 */
export function frameMetrics(rgb, w, h, rgbNext = null) {
  const n = w * h
  if (!rgb || rgb.length < n * 3 || n <= 0) return null
  const Y = new Float32Array(n)
  const hist = new Uint32Array(64)
  let sumY = 0
  let sumY2 = 0
  let dark = 0
  let bright = 0
  let sRg = 0
  let sRg2 = 0
  let sYb = 0
  let sYb2 = 0
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const r = rgb[p]
    const g = rgb[p + 1]
    const b = rgb[p + 2]
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    Y[i] = y
    sumY += y
    sumY2 += y * y
    if (y < 20) dark++
    else if (y > 245) bright++
    hist[Math.min(63, Math.floor(y / 4))]++
    const rg = r - g
    const yb = 0.5 * (r + g) - b
    sRg += rg
    sRg2 += rg * rg
    sYb += yb
    sYb2 += yb * yb
  }
  const meanY = sumY / n
  const stdY = Math.sqrt(Math.max(0, sumY2 / n - meanY * meanY))
  const mRg = sRg / n
  const mYb = sYb / n
  const dRg = Math.sqrt(Math.max(0, sRg2 / n - mRg * mRg))
  const dYb = Math.sqrt(Math.max(0, sYb2 / n - mYb * mYb))
  const colorfulness = Math.sqrt(dRg * dRg + dYb * dYb) + 0.3 * Math.sqrt(mRg * mRg + mYb * mYb)
  let entropy = 0
  for (let k = 0; k < 64; k++) {
    if (!hist[k]) continue
    const pr = hist[k] / n
    entropy -= pr * Math.log2(pr)
  }
  let ls = 0
  let ls2 = 0
  let ln = 0
  let edges = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const l = 4 * Y[i] - Y[i - 1] - Y[i + 1] - Y[i - w] - Y[i + w]
      ls += l
      ls2 += l * l
      ln++
      if (l > 24 || l < -24) edges++
    }
  }
  const lapVar = ln ? Math.max(0, ls2 / ln - (ls / ln) ** 2) : 0
  let motion = null
  let lumaDelta = null
  if (rgbNext && rgbNext.length >= n * 3) {
    let d = 0
    let s2 = 0
    for (let i = 0, p = 0; i < n; i++, p += 3) {
      const y2 = 0.299 * rgbNext[p] + 0.587 * rgbNext[p + 1] + 0.114 * rgbNext[p + 2]
      d += Math.abs(y2 - Y[i])
      s2 += y2
    }
    motion = d / n
    lumaDelta = s2 / n - meanY
  }
  return {
    meanY: round(meanY, 2),
    stdY: round(stdY, 2),
    darkFrac: round(dark / n, 4),
    brightFrac: round(bright / n, 4),
    entropy: round(entropy, 3),
    colorfulness: round(colorfulness, 2),
    lapVar: round(lapVar, 1),
    edgeDensity: round(ln ? edges / ln : 0, 4),
    motion: motion === null ? null : round(motion, 2),
    lumaDelta: lumaDelta === null ? null : round(lumaDelta, 2),
  }
}

const REJECT_LABEL = { black: '黑屏', white: '白屏 / 过曝', flat: '画面单调', unreadable: '读取失败' }
const NOTE_LABEL = { motion: '运动模糊 / 转场中', dim: '偏暗', fade: '淡入淡出中', cut: '靠近镜头切换', title: '标题画面' }

/**
 * Score the candidates in place (score, rejected, notes, labels) and return { bestIndex }. Deterministic: ties go to the
 * moment closest to 35 % of the film, then the earlier one.
 */
export function scoreCandidates(cands, { durationSec = 0, timeline = [], title = '' } = {}) {
  const meanYs = cands
    .map((c) => c.metrics && c.metrics.meanY)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  const medianY = meanYs.length ? meanYs[Math.floor(meanYs.length / 2)] : 110
  for (const c of cands) {
    const m = c.metrics
    const notes = []
    const good = []
    if (!m) {
      c.score = -100
      c.rejected = 'unreadable'
      c.notes = []
      c.labels = [REJECT_LABEL.unreadable]
      continue
    }
    let rejected = ''
    if (m.meanY < 24 || m.darkFrac > 0.9) rejected = 'black'
    else if (m.meanY > 238 && m.stdY < 12) rejected = 'white'
    else if (m.stdY < 7 || m.entropy < 2.2) rejected = 'flat'
    const detail = clamp01(Math.log1p(m.lapVar) / Math.log1p(2500))
    const color = clamp01(m.colorfulness / 85)
    const contrast = clamp01(m.stdY / 62)
    const info = clamp01((m.entropy - 2) / 3.6)
    const exposure = 1 - clamp01(Math.abs(m.meanY - 120) / 120)
    let score = 100 * (0.3 * detail + 0.2 * color + 0.16 * contrast + 0.16 * info + 0.18 * exposure)
    if (m.motion !== null) {
      const mot = clamp01((m.motion - 4) / 22)
      score -= 26 * mot
      if (mot > 0.5) notes.push('motion')
    }
    if (medianY > 40 && m.meanY < medianY * 0.55) {
      score -= 22
      notes.push('dim')
    }
    if (m.lumaDelta !== null && Math.abs(m.lumaDelta) > 10) {
      score -= 14
      notes.push('fade')
    }
    score -= 30 * clamp01((m.darkFrac - 0.45) / 0.45)
    const sc = sceneAt(timeline, c.timeSec)
    if (sc) {
      const pos = (c.timeSec - sc.start) / sc.dur
      const edge = Math.min(c.timeSec - sc.start, sc.end - c.timeSec)
      if (edge < 0.3 && timeline.length > 1) {
        score -= 12
        notes.push('cut')
      } else if (pos >= 0.3 && pos <= 0.8) score += 4
      if (pos >= 0.35 && isTitleScene(sc, title)) {
        score += 6
        notes.push('title')
      }
    }
    if (rejected) score = Math.min(score, 0) - 50
    if (!rejected) {
      if (detail >= 0.6) good.push('清晰')
      if (color >= 0.55) good.push('色彩饱满')
      if (contrast >= 0.6) good.push('对比强')
    }
    c.score = round(score, 1)
    c.rejected = rejected
    c.notes = notes
    c.labels = rejected ? [REJECT_LABEL[rejected]] : [...notes.map((k) => NOTE_LABEL[k]), ...good].slice(0, 3)
  }
  const target = durationSec * 0.35
  let bestIndex = -1
  const better = (a, b) => {
    if (a.score !== b.score) return a.score > b.score
    const da = Math.abs(a.timeSec - target)
    const db = Math.abs(b.timeSec - target)
    if (da !== db) return da < db
    return a.timeSec < b.timeSec
  }
  for (const pass of [false, true]) {
    for (let i = 0; i < cands.length; i++) {
      if (!pass && cands[i].rejected) continue
      if (bestIndex < 0 || better(cands[i], cands[bestIndex])) bestIndex = i
    }
    if (bestIndex >= 0) break
  }
  return { bestIndex, medianY }
}

/* ---------------------------------------------------------------------------------------- frame extraction */
function analysisSize(w, h) {
  const W = 320
  if (!(w > 0 && h > 0)) return { w: W, h: 180 }
  return { w: W, h: Math.max(2, Math.round((W * h) / w / 2) * 2) }
}

/**
 * One ffmpeg call per candidate (frame-accurate input seek): the full-resolution JPEG of frame n=0 at `t` plus two small
 * RGB24 analysis frames (n=0 and n=6 ≈ 0.2 s later) for the scores.
 */
async function extractCandidate(mp4, t, outJpg, an, { signal } = {}) {
  const { ffmpeg } = resolveBinaries()
  const base = outJpg.replace(/\.jpg$/i, '')
  const a0 = `${base}.a0.rgb`
  const a1 = `${base}.a1.rgb`
  const fc =
    `[0:v]split=3[f][x][y];[f]select='eq(n,0)'[full];` +
    `[x]select='eq(n,0)',scale=${an.w}:${an.h}:flags=area,format=rgb24[an0];` +
    `[y]select='eq(n,6)',scale=${an.w}:${an.h}:flags=area,format=rgb24[an1]`
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', t.toFixed(3), '-i', mp4,
    '-an', '-sn', '-dn',
    '-filter_complex', fc,
    '-map', '[full]', '-frames:v', '1', '-q:v', '2', '-update', '1', outJpg,
    '-map', '[an0]', '-frames:v', '1', '-f', 'rawvideo', a0,
    '-map', '[an1]', '-frames:v', '1', '-f', 'rawvideo', a1,
  ]
  try {
    const { code, stderr } = await runCommandRedirected(ffmpeg, args, { timeoutMs: 90_000, signal })
    const need = an.w * an.h * 3
    const read = (p) => {
      try {
        const b = readFileSync(p)
        return b.length >= need ? b : null
      } catch {
        return null
      }
    }
    const rgb0 = read(a0)
    if (!rgb0 || !existsSync(outJpg)) throw new Error(`截取候选画面失败 (exit ${code})：${String(stderr || '').slice(0, 200)}`)
    return { rgb0, rgb1: read(a1) }
  } finally {
    for (const p of [a0, a1]) rmSync(p, { force: true })
  }
}

/* ----------------------------------------------------------------------------------------------- auto pick */
const AUTO_INFLIGHT = new Map() // `${dir}|${sig}` → Promise<cache>
const AUTO_ERRORS = new Map() // `${dir}|${sig}` → message
const autoKey = (abs, sig) => `${abs.toLowerCase()}|${sig}`

/** The cached automatic candidates when they belong to the current final.mp4 (else null). */
export function readAutoCache(projectDir) {
  const abs = resolve(projectDir)
  const sig = mp4Signature(finalMp4Abs(abs))
  if (!sig) return null
  const cache = readJsonSafe(join(autoDirAbs(abs), 'auto.json'), null)
  if (!cache || cache.version !== AUTO_CACHE_VERSION || cache.mp4Sig !== sig || !Array.isArray(cache.candidates) || !cache.candidates.length) return null
  if (!cache.candidates.every((c) => c && c.file && existsSync(join(abs, c.file)))) return null
  return cache
}

async function computeAutoCandidates(abs, mp4, sig, { signal } = {}) {
  const t0 = Date.now()
  const video = await probeVideoCached(mp4, sig)
  if (!(video.durationSec > 0)) throw new Error('无法读取成片时长')
  const script = safeScript(abs)
  const timeline = sceneTimeline(script, video.fps)
  const times = candidateTimes(video.durationSec, video.fps, timeline)
  const dir = autoDirAbs(abs)
  mkdirSync(dir, { recursive: true })
  for (const f of readdirSync(dir)) if (/^(auto-\d+.*\.(jpg|rgb)|best-\d+\.png)$/i.test(f)) rmSync(join(dir, f), { force: true })
  const an = analysisSize(video.width, video.height)
  const big = video.width * video.height > 2560 * 1440
  const results = await pool(times, big ? 2 : 3, async (c, i) => {
    const name = `auto-${String(i + 1).padStart(2, '0')}-${Math.round(c.t * 1000)}.jpg`
    const out = join(dir, name)
    try {
      const { rgb0, rgb1 } = await extractCandidate(mp4, c.t, out, an, { signal })
      const sc = sceneAt(timeline, c.t)
      return {
        file: `${COVER_DIR_REL}/auto/${name}`,
        timeSec: round(c.t, 3),
        frame: Math.round(c.t * video.fps),
        source: c.source,
        sceneId: c.sceneId || (sc ? sc.id : ''),
        metrics: frameMetrics(rgb0, an.w, an.h, rgb1),
      }
    } catch (err) {
      if (signal && signal.aborted) throw err
      return null
    }
  })
  const cands = results.filter((r) => r && existsSync(join(abs, r.file)))
  if (!cands.length) throw new Error('没能从成片里截取候选画面（ffmpeg 截帧失败）')
  const { bestIndex } = scoreCandidates(cands, { durationSec: video.durationSec, timeline, title: script.displayTitle || script.title || '' })
  const cache = {
    version: AUTO_CACHE_VERSION,
    mp4Sig: sig,
    video,
    computedAt: new Date().toISOString(),
    elapsedMs: Date.now() - t0,
    bestIndex,
    candidates: cands,
  }
  writeJsonAtomic(join(dir, 'auto.json'), cache)
  return cache
}

/**
 * Compute (or return the cached) automatic candidates for the current final.mp4. Concurrent callers share one run.
 */
export function ensureAutoCandidates(projectDir, { force = false, signal } = {}) {
  const abs = resolve(projectDir)
  const mp4 = finalMp4Abs(abs)
  const sig = mp4Signature(mp4)
  if (!sig) return Promise.reject(new CoverError('还没有渲染成片 output/final.mp4：先渲染成片，才能挑选封面', { status: 409, code: 'no-mp4' }))
  if (!force) {
    const cached = readAutoCache(abs)
    if (cached) return Promise.resolve(cached)
  }
  const key = autoKey(abs, sig)
  if (AUTO_INFLIGHT.has(key)) return AUTO_INFLIGHT.get(key)
  AUTO_ERRORS.delete(key)
  const run = computeAutoCandidates(abs, mp4, sig, { signal })
    .catch((err) => {
      AUTO_ERRORS.set(key, String((err && err.message) || err))
      throw err
    })
    .finally(() => AUTO_INFLIGHT.delete(key))
  AUTO_INFLIGHT.set(key, run)
  return run
}

/* ---------------------------------------------------------------------------------------------- cover.json */
const BLANK_COVER = Object.freeze({
  version: 1,
  mode: 'auto',
  file: '',
  timeSec: null,
  frame: null,
  prompt: '',
  aspect: '',
  provider: '',
  createdAt: '',
  mp4Sig: '',
  titleOverlay: null,
  ai: [],
  frames: [],
  titled: [],
  packs: {},
})

function normalizeCoverJson(j) {
  const out = { ...BLANK_COVER, ai: [], frames: [], titled: [], packs: {} }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return out
  if (COVER_MODES.includes(j.mode)) out.mode = j.mode
  for (const k of ['file', 'prompt', 'aspect', 'provider', 'createdAt', 'mp4Sig']) if (typeof j[k] === 'string') out[k] = j[k]
  for (const k of ['timeSec', 'frame']) if (Number.isFinite(Number(j[k])) && j[k] !== null && j[k] !== '') out[k] = Number(j[k])
  if (j.titleOverlay && typeof j.titleOverlay === 'object') out.titleOverlay = j.titleOverlay
  for (const k of ['ai', 'frames', 'titled']) if (Array.isArray(j[k])) out[k] = j[k].filter((x) => x && typeof x.file === 'string')
  if (j.packs && typeof j.packs === 'object' && !Array.isArray(j.packs)) out.packs = j.packs
  return out
}

export function readCoverJson(projectDir) {
  return normalizeCoverJson(readJsonSafe(coverJsonAbs(resolve(projectDir)), null))
}

function updateCoverJson(abs, mutate) {
  const file = coverJsonAbs(abs)
  mkdirSync(coverDirAbs(abs), { recursive: true })
  return withFileLockSync(`${file}.lock`, () => {
    const cur = normalizeCoverJson(readJsonSafe(file, null))
    const next = normalizeCoverJson(mutate(cur) || cur)
    writeJsonAtomic(file, next)
    return next
  })
}

const existsRel = (abs, rel) => Boolean(rel) && existsSync(join(abs, rel))

/* ------------------------------------------------------------------------------------------------- choices */
/** 默认（自动）: the best automatic candidate of the current film (recomputed whenever final.mp4 changes). */
export function useAutoCover(projectDir) {
  const abs = resolve(projectDir)
  return updateCoverJson(abs, (cur) => ({ ...cur, mode: 'auto', file: '', timeSec: null, frame: null, prompt: '', aspect: '', provider: '', titleOverlay: null, createdAt: new Date().toISOString(), mp4Sig: '' }))
}

/**
 * 选用视频画面: extract exactly the frame shown at `timeSec` (frame index = ⌊t·fps⌋, the frame the player displays) as a
 * lossless PNG → { file, timeSec, frame }. Re-uses the PNG when the film did not change.
 */
export async function grabCoverFrame(projectDir, { timeSec, signal, auto = false } = {}) {
  const abs = resolve(projectDir)
  const mp4 = finalMp4Abs(abs)
  const sig = mp4Signature(mp4)
  if (!sig) throw new CoverError('还没有渲染成片 output/final.mp4：先渲染成片，才能选用视频画面', { status: 409, code: 'no-mp4' })
  const t = Number(timeSec)
  if (timeSec === null || timeSec === undefined || timeSec === '' || !Number.isFinite(t) || t < 0) throw new CoverError('请指定要截取的时间点 timeSec（秒）')
  const video = await probeVideoCached(mp4, sig)
  const last = Math.max(0, (video.frames || Math.round(video.durationSec * video.fps)) - 1)
  const frame = Math.min(last, Math.max(0, Math.floor(t * video.fps + 1e-3)))
  const at = frame / video.fps
  // auto: the lossless PNG of the automatic pick lives with the candidates (cleaned up when the film changes)
  const sub = auto ? 'auto' : ''
  const name = `${auto ? 'best' : 'frame'}-${String(frame).padStart(6, '0')}.png`
  const outDir = auto ? autoDirAbs(abs) : coverDirAbs(abs)
  const out = join(outDir, name)
  mkdirSync(outDir, { recursive: true })
  let fresh = false
  try {
    fresh = statSync(out).size > 100 && statSync(out).mtimeMs >= statSync(mp4).mtimeMs
  } catch {}
  if (!fresh) {
    const { ffmpeg } = resolveBinaries()
    // seek half a frame early: the trim keeps the first frame whose pts ≥ the target → exactly `frame`
    const seek = Math.max(0, (frame - 0.5) / video.fps)
    const { code, stderr } = await runCommandRedirected(
      ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-y', '-ss', seek.toFixed(4), '-i', mp4, '-an', '-sn', '-dn', '-frames:v', '1', '-update', '1', out],
      { timeoutMs: 90_000, signal },
    )
    if (!existsSync(out)) throw new Error(`截取画面失败 (exit ${code})：${String(stderr || '').slice(0, 200)}`)
  }
  return { file: `${COVER_DIR_REL}/${sub ? `${sub}/` : ''}${name}`, timeSec: round(at, 4), frame, video }
}

/** Grab the frame at `timeSec` and make it the cover. */
export async function useFrameCover(projectDir, { timeSec, signal } = {}) {
  const abs = resolve(projectDir)
  const g = await grabCoverFrame(abs, { timeSec, signal })
  const sig = mp4Signature(finalMp4Abs(abs))
  const now = new Date().toISOString()
  const cj = updateCoverJson(abs, (cur) => ({
    ...cur,
    mode: 'frame',
    file: g.file,
    timeSec: g.timeSec,
    frame: g.frame,
    prompt: '',
    aspect: g.video.aspect,
    provider: '',
    titleOverlay: null,
    createdAt: now,
    mp4Sig: sig,
    frames: [{ file: g.file, timeSec: g.timeSec, frame: g.frame, createdAt: now }, ...cur.frames.filter((x) => x.file !== g.file)].slice(0, 24),
  }))
  return { cover: cj, picked: g }
}

/** Make an existing file of output/covers/ the cover (auto candidates are re-extracted losslessly as a frame pick). */
export async function selectCoverFile(projectDir, { file, signal } = {}) {
  const abs = resolve(projectDir)
  const { abs: fileAbs, rel } = resolveCoverFile(abs, file)
  if (!existsSync(fileAbs)) throw new CoverError('这张封面文件已经不存在了，请刷新后重新选择', { status: 404 })
  const name = rel.slice(COVER_DIR_REL.length + 1)
  if (name.startsWith('auto/')) {
    const cache = readAutoCache(abs)
    const c = cache && cache.candidates.find((x) => x.file === rel)
    if (!c) throw new CoverError('这个自动候选已过期（成片更新过），请刷新后重新选择', { status: 409 })
    const best = cache.candidates[cache.bestIndex]
    if (best && best.file === rel) return { cover: useAutoCover(abs) }
    return useFrameCover(abs, { timeSec: c.timeSec, signal })
  }
  if (/^frame-\d+\.png$/i.test(name)) {
    const cur = readCoverJson(abs)
    const entry = cur.frames.find((x) => x.file === rel)
    const video = await probeVideoCached(finalMp4Abs(abs), mp4Signature(finalMp4Abs(abs))).catch(() => null)
    const frame = entry ? entry.frame : Number(/frame-(\d+)/i.exec(name)[1])
    const timeSec = entry ? entry.timeSec : video ? round(frame / video.fps, 4) : null
    if (timeSec !== null) return useFrameCover(abs, { timeSec, signal })
  }
  const cj = updateCoverJson(abs, (cur) => {
    const ai = cur.ai.find((x) => x.file === rel)
    const titled = cur.titled.find((x) => x.file === rel)
    const now = new Date().toISOString()
    if (ai) return { ...cur, mode: 'ai', file: rel, timeSec: null, frame: null, prompt: ai.prompt || '', aspect: ai.aspect || '', provider: [ai.providerName || ai.provider, ai.model].filter(Boolean).join(' · '), titleOverlay: null, createdAt: now, mp4Sig: '' }
    if (titled) return { ...cur, mode: 'title', file: rel, timeSec: titled.timeSec ?? null, frame: null, prompt: titled.prompt || '', aspect: titled.aspect || '', provider: titled.provider || '', titleOverlay: { text: titled.text || '', position: titled.position || '', style: titled.style || '', baseFile: titled.baseFile || '' }, createdAt: now, mp4Sig: '' }
    throw new CoverError('只能选择封面工作室生成的画面（自动候选、选用的画面、AI 封面或加了标题的封面）')
  })
  return { cover: cj }
}

/** Delete a picked frame / AI cover / titled cover (never the current cover). */
export function deleteCoverFile(projectDir, { file } = {}) {
  const abs = resolve(projectDir)
  const { abs: fileAbs, rel } = resolveCoverFile(abs, file)
  const name = rel.slice(COVER_DIR_REL.length + 1)
  if (!/^(frame-\d+\.png|ai-[\w-]+\.png|titled-[\w-]+\.png)$/i.test(name)) throw new CoverError('只能删除选用的画面、AI 封面或加了标题的封面')
  const cur = readCoverJson(abs)
  if (cur.mode !== 'auto' && cur.file === rel) throw new CoverError('这张是当前封面：先换一张封面（或恢复默认），再删除它', { status: 409 })
  rmSync(fileAbs, { force: true })
  return updateCoverJson(abs, (c) => ({
    ...c,
    ai: c.ai.filter((x) => x.file !== rel),
    frames: c.frames.filter((x) => x.file !== rel),
    titled: c.titled.filter((x) => x.file !== rel),
  }))
}

/* ------------------------------------------------------------------------------------------- AI cover prompt */
function llmStatus() {
  try {
    const c = resolveLlmConfig()
    const local = c.provider === 'ollama' || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(String(c.baseUrl || ''))
    return { configured: Boolean(c.baseUrl && c.model && (c.apiKey || local)), model: String(c.model || ''), label: String(c.sourceLabel || '') }
  } catch {
    return { configured: false, model: '', label: '' }
  }
}

const NEED_LLM_RE = /尚未配置大模型|尚未找到可用 API Key|尚未指定模型|未填写 LLM Base URL/

/**
 * 「AI 写提示词」: one short text-LLM call that writes a cover prompt from the title, topic, outline, scene narration /
 * visual notes and the chosen frame's scene. The image must not contain text (the title can be composited locally).
 */
export async function writeAiCoverPrompt(projectDir, { timeSec = null, aspect = '', platform = '', draft = '', callLlmChatFn = null, signal } = {}) {
  const abs = resolve(projectDir)
  if (typeof callLlmChatFn !== 'function' && !llmStatus().configured) {
    throw new CoverError('「AI 写提示词」需要先配置 AI 大模型接口：请在「设置 · 模型与密钥」里填好（也可以直接自己写提示词）', { status: 400, code: 'need-llm' })
  }
  const script = safeScript(abs)
  const sig = mp4Signature(finalMp4Abs(abs))
  const video = sig ? await probeVideoCached(finalMp4Abs(abs), sig).catch(() => null) : null
  const fps = (video && video.fps) || Number(script.fps) || 30
  const timeline = sceneTimeline(script, fps)
  let t = timeSec === null || timeSec === undefined || timeSec === '' ? NaN : Number(timeSec)
  if (!Number.isFinite(t)) {
    const cj = readCoverJson(abs)
    if (cj.mode === 'frame' && Number.isFinite(cj.timeSec)) t = cj.timeSec
    else {
      const cache = readAutoCache(abs)
      const best = cache && cache.candidates[cache.bestIndex]
      if (best) t = best.timeSec
    }
  }
  const sc = sceneAt(timeline, t)
  const videoAspect = (video && video.aspect) || String(script.aspectRatio || '')
  const asp = COVER_ASPECTS.includes(aspect) ? aspect : coverAspectForPlatform(platform || script.targetPlatform, videoAspect)
  const [aw, ah] = asp.split(':').map(Number)
  const orient = aw === ah ? '方形' : aw > ah ? '横' : '竖'
  const outline = Array.isArray(script.contentOutline) ? script.contentOutline : typeof script.contentOutline === 'string' ? script.contentOutline.split(/\r?\n/) : []
  const payload = {
    title: clip(script.displayTitle || script.title || '', 60),
    topic: clip(script.topic || script.brief || '', 500),
    genre: clip(script.genreLabel || script.genre || script.style || '', 30),
    platform: String(platform || script.targetPlatform || ''),
    coverAspect: `${asp}（${orient}版封面）`,
    outline: outline.map((x) => clip(x, 80)).filter(Boolean).slice(0, 8),
    scenes: timeline.slice(0, 10).map((s) => ({ title: clip(s.scene.title, 40), narration: clip(s.scene.narration, 80), visual: clip(sceneVisualText(s.scene), 120) })),
    chosenFrame: sc
      ? { timeSec: round(t, 2), sceneTitle: clip(sc.scene.title, 60), narration: clip(sc.scene.narration, 220), visual: clip(sceneVisualText(sc.scene), 320) }
      : undefined,
    userDraft: clip(draft, 800) || undefined,
  }
  const system = `你是短视频封面设计师兼 AI 绘画提示词专家（熟悉即梦 Seedream、Flux、GPT Image、可灵的写法）。
根据视频的标题、主题、分镜内容和选中的画面，写一段用于「AI 生成视频封面」的中文提示词。要求：
1. 80~180 字，可以直接交给文生图 / 图生图模型；
2. 写清：核心主体与动作或情绪、构图（${orient}版 ${asp} 封面，主体醒目，上方或下方留出约四分之一的干净区域放标题）、景别与视角、光影与配色（高对比、吸睛）、质感与风格，并与视频主题一致；
3. 画面里不要出现任何文字、字母、数字、水印或 logo（标题会在本地另外叠加）；
4. 如果提供了 userDraft，保留用户的意图，在此基础上改写润色。
只输出 JSON（不要 Markdown 代码块）：{"prompt": "……"}`
  const invoke = typeof callLlmChatFn === 'function' ? callLlmChatFn : (p) => callLlmChat({ ...p, signal })
  let reply
  try {
    reply = await invoke({ system, messages: [{ role: 'user', content: JSON.stringify(payload) }], temperature: 0.7, maxTokens: 900, timeoutMs: 90_000 })
  } catch (err) {
    const msg = String((err && err.message) || err)
    if (NEED_LLM_RE.test(msg)) throw new CoverError(`「AI 写提示词」需要先配置 AI 大模型接口：${msg}`, { status: 400, code: 'need-llm' })
    throw err
  }
  const parsed = extractJsonFromLlmText(reply && reply.text) || {}
  let prompt = String((parsed && parsed.prompt) || (reply && reply.text) || '').trim()
  prompt = prompt
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/, '')
    .replace(/^["“]|["”]$/g, '')
    .trim()
    .slice(0, 1500)
  if (!prompt) throw new CoverError('大模型没有返回提示词，请再试一次', { status: 502 })
  return { ok: true, prompt, aspect: asp, timeSec: Number.isFinite(t) ? round(t, 3) : null, sceneId: sc ? sc.id : '', model: (reply && reply.model) || '' }
}

/* ----------------------------------------------------------------------------------------- AI cover generate */
/** The BYOK image provider from 「设置 · 云端媒体」 (no key ever returned). */
export function describeImageProvider() {
  let cfg = {}
  try {
    cfg = loadCloudMediaConfig().image || {}
  } catch {}
  const protocol = String(cfg.protocol || 'custom')
  const hasKey = Boolean(String(cfg.apiKey || '').trim())
  const configured = protocol === 'custom' ? Boolean(String((cfg.custom && cfg.custom.submitUrl) || '').trim()) : hasKey
  const preset = (CLOUD_MEDIA_PRESETS.image || []).find((p) => p.id === cfg.providerId) || null
  const cap = resolveReferenceImageCapability(cfg, protocol, 'image', String(cfg.model || ''))
  return {
    configured,
    providerId: String(cfg.providerId || ''),
    providerName: (preset && preset.name) || String(cfg.providerId || '自定义接口'),
    model: String(cfg.model || ''),
    protocol,
    supportsReference: Boolean(cap.supported),
    referenceReason: String(cap.reason || ''),
  }
}

function cropFor(w, h, aspect) {
  const [aw, ah] = String(aspect).split(':').map(Number)
  if (!(w > 0 && h > 0 && aw > 0 && ah > 0)) return null
  const target = aw / ah
  const cur = w / h
  if (Math.abs(cur - target) / target < 0.008) return null
  if (cur > target) {
    const cw = Math.max(2, Math.round((h * target) / 2) * 2)
    return { w: cw, h, x: Math.floor((w - cw) / 2), y: 0 }
  }
  const ch = Math.max(2, Math.round(w / target / 2) * 2)
  return { w, h: ch, x: 0, y: Math.floor((h - ch) / 2) }
}

/** Centre-crop an image to `aspect` (when it does not match already) and write it as PNG. */
export async function cropImageToAspect(src, dst, aspect) {
  const { width, height } = await probeImageSize(src)
  const c = cropFor(width, height, aspect)
  const { ffmpeg } = resolveBinaries()
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', src]
  if (c) args.push('-vf', `crop=${c.w}:${c.h}:${c.x}:${c.y}`)
  args.push('-frames:v', '1', '-update', '1', dst)
  const { code, stderr } = await runCommandRedirected(ffmpeg, args, { timeoutMs: 60_000 })
  if (!existsSync(dst)) throw new Error(`处理 AI 封面图片失败 (exit ${code})：${String(stderr || '').slice(0, 200)}`)
  return c ? { width: c.w, height: c.h, cropped: true } : { width, height, cropped: false }
}

/** The image file the current cover choice points at (auto → best candidate), '' when unknown. */
function currentCoverImage(abs) {
  const cj = readCoverJson(abs)
  if (cj.mode !== 'auto' && existsRel(abs, cj.file)) return cj.file
  const cache = readAutoCache(abs)
  const best = cache && cache.candidates[cache.bestIndex]
  return best ? best.file : ''
}

/**
 * 「生成封面」: generate a cover with the configured BYOK image provider (optionally image-to-image from a reference
 * frame), crop it to the exact aspect and add it to the AI results (not selected automatically — 「设为封面」 picks it).
 * Same prompt + aspect + reference again → the paid-job ledger re-uses the previous result (no second charge) unless
 * `forceNew`.
 */
export async function generateAiCover(projectDir, { prompt = '', aspect = '16:9', useReference = false, referenceFile = '', forceNew = false, onProgress, signal, fetchImpl = null } = {}) {
  const abs = resolve(projectDir)
  const text = String(prompt || '').trim()
  if (!text) throw new CoverError('请先填写封面描述（提示词），或点「AI 写提示词」自动生成')
  if (text.length > 2000) throw new CoverError('提示词太长了（最多 2000 字），请精简一下')
  if (!COVER_ASPECTS.includes(aspect)) throw new CoverError(`封面比例只能是 ${COVER_ASPECTS.join(' / ')}`)
  const prov = describeImageProvider()
  if (!prov.configured) {
    throw new CoverError('还没有配置云端生图服务：请先在「设置 · 模型与密钥 → 云端生成 → 云端生图」选择服务商并填写 API Key', { status: 400, code: 'no-image-provider' })
  }
  let refAbs = ''
  if (useReference) {
    const rel = referenceFile ? resolveCoverFile(abs, referenceFile).rel : currentCoverImage(abs)
    if (rel && existsRel(abs, rel)) refAbs = join(abs, rel)
  }
  onProgress && onProgress({ stage: 'cover-ai', progress: 6, message: `正在调用 ${prov.providerName}${prov.model ? `（${prov.model}）` : ''} 生成 ${aspect} 封面…` })
  const res = await generateCloudMediaAsset({
    projectDir: abs,
    category: 'image',
    prompt: text,
    aspectRatio: aspect,
    fileOutput: { subdir: `${COVER_DIR_REL}/ai-raw`, prefix: 'ai-raw' },
    referenceImages: refAbs ? [refAbs] : [],
    autoBindToScript: false,
    stageOnly: false,
    forceNew: Boolean(forceNew),
    onProgress,
    signal,
    fetchImpl,
  })
  const rawAbs = res.absolutePath
  const rawRel = toRel(abs, rawAbs)
  const reused = Boolean(res.reused || res.joinedInFlight)
  if (reused) {
    const prev = readCoverJson(abs).ai.find((x) => x.rawFile === rawRel && x.aspect === aspect && existsRel(abs, x.file))
    if (prev) return { ok: true, reused: true, item: prev, referenceImages: res.referenceImages || null }
  }
  onProgress && onProgress({ stage: 'cover-crop', progress: 96, message: `正在裁成 ${aspect} 封面…` })
  const outAbs = join(coverDirAbs(abs), `ai-${stamp()}.png`)
  const dims = await cropImageToAspect(rawAbs, outAbs, aspect)
  const item = {
    file: toRel(abs, outAbs),
    rawFile: rawRel,
    prompt: text,
    aspect,
    width: dims.width,
    height: dims.height,
    provider: prov.providerId,
    providerName: prov.providerName,
    model: res.model || prov.model,
    referenceFile: refAbs ? toRel(abs, refAbs) : '',
    referenceUsed: Boolean(res.referenceImages && res.referenceImages.used),
    reused,
    createdAt: new Date().toISOString(),
    ledgerJobId: (res.ledger && res.ledger.jobId) || '',
  }
  updateCoverJson(abs, (cur) => ({ ...cur, ai: [item, ...cur.ai.filter((x) => x.file !== item.file)].slice(0, 40) }))
  return { ok: true, reused, item, referenceImages: res.referenceImages || null }
}

/* -------------------------------------------------------------------------------------------- title overlay */
/**
 * Save a cover with the title composited by the Studio (PNG data URL from a canvas drawn with the bundled Noto Sans SC)
 * and make it the cover.
 */
export function saveTitledCover(projectDir, { dataUrl = '', baseFile = '', text = '', position = '', style = '' } = {}) {
  const abs = resolve(projectDir)
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''))
  if (!m) throw new CoverError('带标题的封面图片数据无效（需要 PNG）')
  const buf = Buffer.from(m[1].replace(/\s+/g, ''), 'base64')
  if (buf.length < 64 || buf.length > MAX_TITLED_PNG_BYTES) throw new CoverError('带标题的封面图片大小不对')
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a || buf.toString('latin1', 12, 16) !== 'IHDR') throw new CoverError('带标题的封面不是有效的 PNG 图片')
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  if (!(width > 0 && height > 0 && width <= 8192 && height <= 8192)) throw new CoverError('带标题的封面尺寸不对')
  let baseRel = ''
  if (baseFile) {
    const b = resolveCoverFile(abs, baseFile)
    baseRel = b.rel
  }
  mkdirSync(coverDirAbs(abs), { recursive: true })
  const outAbs = join(coverDirAbs(abs), `titled-${stamp()}.png`)
  writeFileSync(outAbs, buf)
  const rel = toRel(abs, outAbs)
  const cur = readCoverJson(abs)
  const baseAi = cur.ai.find((x) => x.file === baseRel)
  const baseFrame = cur.frames.find((x) => x.file === baseRel)
  const autoCache = baseRel.startsWith(`${COVER_DIR_REL}/auto/`) ? readAutoCache(abs) : null
  const baseAuto = autoCache && autoCache.candidates.find((x) => x.file === baseRel)
  const now = new Date().toISOString()
  const entry = {
    file: rel,
    baseFile: baseRel,
    text: clip(text, 120),
    position: ['top', 'center', 'bottom'].includes(position) ? position : 'bottom',
    style: clip(style, 24),
    aspect: aspectString(width, height),
    width,
    height,
    timeSec: baseFrame ? baseFrame.timeSec : baseAuto ? baseAuto.timeSec : null,
    prompt: baseAi ? baseAi.prompt : '',
    provider: baseAi ? [baseAi.providerName || baseAi.provider, baseAi.model].filter(Boolean).join(' · ') : '',
    createdAt: now,
  }
  const cj = updateCoverJson(abs, (c) => ({
    ...c,
    mode: 'title',
    file: rel,
    timeSec: entry.timeSec,
    frame: null,
    prompt: entry.prompt,
    aspect: entry.aspect,
    provider: entry.provider,
    titleOverlay: { text: entry.text, position: entry.position, style: entry.style, baseFile: baseRel },
    createdAt: now,
    mp4Sig: '',
    titled: [entry, ...c.titled.filter((x) => x.file !== rel)].slice(0, 20),
  }))
  return { cover: cj, item: entry }
}

/* ------------------------------------------------------------------------------------------- publish pack */
/**
 * The image the publish pack uses as cover.png → { abs, rel, mode, timeSec?, aspect?, refreshed?, fallbackFrom? }.
 * auto → the best automatic candidate; frame → the picked frame (re-extracted at the same moment when the film was
 * re-rendered since); ai / title → that image; a chosen file that disappeared falls back to auto.
 */
export async function resolvePackCover(projectDir, { signal } = {}) {
  const abs = resolve(projectDir)
  const cj = readCoverJson(abs)
  const sig = mp4Signature(finalMp4Abs(abs))
  const autoPick = async (fallbackFrom = '') => {
    const cache = await ensureAutoCandidates(abs, { signal })
    const best = cache.candidates[cache.bestIndex] || cache.candidates[0]
    // the pack gets a lossless PNG of the picked frame (the candidate JPEG is only the preview)
    let png = null
    try {
      png = await grabCoverFrame(abs, { timeSec: best.timeSec, signal, auto: true })
    } catch {}
    const rel = png ? png.file : best.file
    return { abs: join(abs, rel), rel, candidate: best.file, mode: 'auto', timeSec: best.timeSec, score: best.score, fallbackFrom }
  }
  if (cj.mode === 'frame' && Number.isFinite(cj.timeSec)) {
    const stale = Boolean(sig && cj.mp4Sig && cj.mp4Sig !== sig)
    if (!stale && existsRel(abs, cj.file)) return { abs: join(abs, cj.file), rel: cj.file, mode: 'frame', timeSec: cj.timeSec }
    if (sig) {
      const g = await grabCoverFrame(abs, { timeSec: cj.timeSec, signal })
      updateCoverJson(abs, (cur) => (cur.mode === 'frame' ? { ...cur, file: g.file, frame: g.frame, timeSec: g.timeSec, mp4Sig: sig } : cur))
      return { abs: join(abs, g.file), rel: g.file, mode: 'frame', timeSec: g.timeSec, refreshed: stale }
    }
  }
  if ((cj.mode === 'ai' || cj.mode === 'title') && existsRel(abs, cj.file)) {
    return { abs: join(abs, cj.file), rel: cj.file, mode: cj.mode, aspect: cj.aspect, timeSec: cj.timeSec }
  }
  return autoPick(cj.mode !== 'auto' ? cj.mode : '')
}

/** Write the chosen cover as `<packDir>/cover.png` (PNG copy or conversion). */
export async function writePackCoverPng(srcAbs, dstPng) {
  if (extname(srcAbs).toLowerCase() === '.png') {
    copyFileSync(srcAbs, dstPng)
    return dstPng
  }
  const { ffmpeg } = resolveBinaries()
  const { code, stderr } = await runCommandRedirected(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', srcAbs, '-frames:v', '1', '-update', '1', dstPng], { timeoutMs: 60_000 })
  if (!existsSync(dstPng)) throw new Error(`封面转换为 PNG 失败 (exit ${code})：${String(stderr || '').slice(0, 200)}`)
  return dstPng
}

/** Remember which cover a pack used (shown in the 发布包导出 panel). */
export function recordPackCover(projectDir, platform, info = {}) {
  const abs = resolve(projectDir)
  const p = String(platform || 'universal').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'universal'
  let packFileHash = ''
  try {
    if (info.packFile && existsSync(info.packFile)) packFileHash = createHash('sha1').update(readFileSync(info.packFile)).digest('hex').slice(0, 12)
  } catch {}
  return updateCoverJson(abs, (cur) => ({
    ...cur,
    packs: {
      ...cur.packs,
      [p]: {
        mode: info.mode || 'auto',
        file: info.rel || '',
        candidate: info.candidate || '',
        timeSec: Number.isFinite(info.timeSec) ? info.timeSec : null,
        aspect: info.aspect || '',
        fallbackFrom: info.fallbackFrom || '',
        packFile: info.packFile ? toRel(abs, info.packFile) : '',
        packFileHash,
        usedAt: new Date().toISOString(),
      },
    },
  }))
}

/* ------------------------------------------------------------------------------------------------ UI state */
function listSceneThumbs(abs, timeline) {
  const dir = join(abs, 'output', 'scene-thumbs')
  if (!existsSync(dir)) return []
  const out = []
  for (const s of timeline) {
    const sid = s.id.replace(/[^a-zA-Z0-9._-]/g, '_')
    const rel = `output/scene-thumbs/${sid}.jpg`
    if (!existsSync(join(abs, rel))) continue
    out.push({ file: rel, sceneId: s.id, title: clip(s.scene.title, 40), timeSec: round(s.start + Math.min(s.dur * 0.48, 0.85), 3) })
  }
  return out.slice(0, 40)
}

/**
 * Everything the 发布包导出 cover section shows. Never blocks on ffmpeg: missing automatic candidates are computed in the
 * background (auto.status 'pending' → poll again).
 */
export async function getCoverState(projectDir, { platform = '', kick = true } = {}) {
  const abs = resolve(projectDir)
  const mp4 = finalMp4Abs(abs)
  const sig = mp4Signature(mp4)
  const cj = readCoverJson(abs)
  const script = safeScript(abs)
  let video = null
  if (sig) {
    try {
      video = await probeVideoCached(mp4, sig)
    } catch {}
  }
  let auto = { status: sig ? 'pending' : 'none', candidates: [], bestIndex: -1, error: '' }
  if (sig) {
    const cache = readAutoCache(abs)
    const key = autoKey(abs, sig)
    if (cache) auto = { status: 'ready', candidates: cache.candidates, bestIndex: cache.bestIndex, computedAt: cache.computedAt, elapsedMs: cache.elapsedMs, error: '' }
    else if (AUTO_ERRORS.has(key) && !AUTO_INFLIGHT.has(key)) auto = { status: 'error', candidates: [], bestIndex: -1, error: AUTO_ERRORS.get(key) }
    else if (kick) ensureAutoCandidates(abs).catch(() => {})
  }
  const best = auto.bestIndex >= 0 ? auto.candidates[auto.bestIndex] : null
  // what the next pack will use
  let effective = null
  if (cj.mode === 'auto') effective = best ? { mode: 'auto', file: best.file, timeSec: best.timeSec, pending: false } : { mode: 'auto', file: '', pending: Boolean(sig) }
  else if (existsRel(abs, cj.file)) effective = { mode: cj.mode, file: cj.file, timeSec: cj.timeSec, stale: cj.mode === 'frame' && Boolean(sig && cj.mp4Sig && cj.mp4Sig !== sig) }
  else effective = { mode: 'auto', file: best ? best.file : '', timeSec: best ? best.timeSec : null, missing: cj.mode, pending: !best && Boolean(sig) }
  const timeline = sceneTimeline(script, (video && video.fps) || Number(script.fps) || 30)
  const packs = {}
  for (const [p, info] of Object.entries(cj.packs || {})) {
    if (!info || typeof info !== 'object') continue
    const packCover = `publish/${p}-pack/cover.png`
    packs[p] = { ...info, packFile: existsRel(abs, packCover) ? packCover : '' }
  }
  const videoAspect = (video && video.aspect) || String(script.aspectRatio || '')
  const { file: _f, timeSec: _t, frame: _fr, ai: _ai, frames: _fs, titled: _ti, packs: _p, ...coverRest } = cj
  return {
    ok: true,
    projectDir: abs,
    hasMp4: Boolean(sig),
    mp4Sig: sig,
    video,
    title: String(script.displayTitle || script.title || ''),
    cover: { ...coverRest, file: cj.file, timeSec: cj.timeSec, frame: cj.frame, effective },
    auto,
    frames: cj.frames.filter((x) => existsRel(abs, x.file)).slice(0, 12),
    ai: cj.ai.filter((x) => existsRel(abs, x.file)).slice(0, 24),
    titled: cj.titled.filter((x) => existsRel(abs, x.file)).slice(0, 12),
    packs,
    sceneThumbs: listSceneThumbs(abs, timeline),
    aspects: COVER_ASPECTS,
    defaultAspect: coverAspectForPlatform(platform || script.targetPlatform, videoAspect),
    imageProvider: describeImageProvider(),
    llm: llmStatus(),
  }
}
