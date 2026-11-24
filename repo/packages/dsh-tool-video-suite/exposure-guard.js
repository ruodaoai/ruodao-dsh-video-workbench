/**
 * @dsh-video/tool-video-suite — delivery exposure guard.
 *
 * AI-coded scenes are often designed on near-black backgrounds: in the 6th 「项羽生平」 run most of the film averaged
 * 8–17 % of white (full-range luma 20–42) with the 90th percentile under 40 % — figures and landscapes read as a dark
 * smear on a phone screen. The scene coder is told to keep mid-tones readable, but nothing checked the result.
 *
 * After the render every shot is measured (FFmpeg signalstats on a small, sparsely sampled copy). A shot whose average
 * luma is below the readable floor AND that has no real highlights (silhouette / rim-light / night shots with bright
 * accents are lit by design and stay untouched) gets a gamma lift for exactly its frames: black stays black and white
 * stays white, only the shadows and mid-tones open up, with a slight chroma gain so colours do not wash out. The file's
 * own range (Remotion delivers full-range yuvj420p, BT.601 matrix), pixel format and colour tags are kept — no range or
 * matrix conversion. Only the video is re-encoded (audio copied); the pass is kept only when the frame count, the A/V
 * durations and the measured result are as planned. Any failure leaves the original file in place; cancellation is
 * re-thrown.
 *
 * UI / data / code / explainer / product films are dark-themed on purpose (high-contrast text on deep backgrounds):
 * there only near-black shots are touched, gently.
 */
import { existsSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { resolveBinaries, runCommandRedirected } from '../shared/index.js'
import { probeAv } from './true-peak-guard.js'

const INTERFACE_GENRES = new Set(['ui-tutorial', 'data-story', 'code-animation', 'science-explainer', 'product-promo'])

/** Thresholds as a fraction of the luma range (0 = black, 1 = white), independent of full / video range. */
export const EXPOSURE_PROFILES = Object.freeze({
  picture: Object.freeze({ darkMean: 0.15, targetMean: 0.2, brightP90: 0.6, maxGamma: 1.6 }),
  interface: Object.freeze({ darkMean: 0.06, targetMean: 0.1, brightP90: 0.3, maxGamma: 1.3 }),
})
const MIN_GAMMA = 1.08
const SAMPLE_FPS = 5

const round1 = (n) => Math.round(n * 10) / 10
const round2 = (n) => Math.round(n * 100) / 100

export function exposureProfileFor(genre) {
  return INTERFACE_GENRES.has(String(genre || '')) ? 'interface' : 'picture'
}

/** Shots of a script as frame ranges [startFrame, endFrame] (inclusive) plus seconds. */
export function shotsFromScript(script = {}, fps = Number(script?.fps) || 30) {
  const out = []
  let cursor = 0
  for (const sc of Array.isArray(script?.scenes) ? script.scenes : []) {
    if (!sc || typeof sc !== 'object') continue
    const sf = Number(sc.startFrame)
    const start = Number.isFinite(sf) && sf >= 0 ? Math.round(sf) : Number.isFinite(Number(sc.startSec)) ? Math.round(Number(sc.startSec) * fps) : cursor
    const df = Number(sc.durationInFrames)
    const dur = Number.isFinite(df) && df > 0 ? Math.round(df) : Math.max(1, Math.round((Number(sc.durationSec) || 0) * fps))
    if (!(dur > 0)) continue
    out.push({ id: String(sc.id || `scene-${out.length + 1}`), startFrame: start, endFrame: start + dur - 1, startSec: start / fps, endSec: (start + dur) / fps })
    cursor = start + dur
  }
  return out
}

/** Per-frame YAVG / YHIGH (90th percentile) / pts_time from `signalstats,metadata=print`. */
export function parseSignalstats(text) {
  const frames = []
  let cur = null
  for (const line of String(text || '').split(/\r?\n/)) {
    const f = line.match(/^frame:\d+\s+pts:\S+\s+pts_time:([-\d.]+)/)
    if (f) {
      cur = { t: Number(f[1]) }
      frames.push(cur)
      continue
    }
    const m = cur && line.match(/lavfi\.signalstats\.(YAVG|YHIGH)=([\d.]+)/)
    if (m) cur[m[1] === 'YAVG' ? 'yavg' : 'yhigh'] = Number(m[2])
  }
  return frames.filter((x) => Number.isFinite(x.t) && Number.isFinite(x.yavg))
}

/** Measure every shot's average luma and average 90th-percentile luma from a sparse, downscaled decode. */
export async function measureShotLuma({ mp4Path, shots, ffmpeg, signal, sampleFps = SAMPLE_FPS, durationSec = 60 } = {}) {
  const bin = ffmpeg || resolveBinaries().ffmpeg
  const res = await runCommandRedirected(
    bin,
    ['-hide_banner', '-nostats', '-i', mp4Path, '-an', '-vf', `fps=${sampleFps},scale=320:-2,signalstats,metadata=print:file=-`, '-f', 'null', '-'],
    { timeoutMs: Math.max(120_000, Math.round(durationSec * 3000)), signal },
  )
  const samples = parseSignalstats(`${res.stdout || ''}\n${res.stderr || ''}`)
  return (Array.isArray(shots) ? shots : []).map((s) => {
    const inShot = samples.filter((x) => x.t >= s.startSec - 0.001 && x.t < s.endSec - 0.001)
    const n = inShot.length
    return {
      ...s,
      samples: n,
      meanY: n ? round1(inShot.reduce((a, b) => a + b.yavg, 0) / n) : null,
      p90Y: n ? round1(inShot.reduce((a, b) => a + (Number.isFinite(b.yhigh) ? b.yhigh : b.yavg), 0) / n) : null,
    }
  })
}

/** Luma code range of a stream: full range (yuvj / pc) 0–255, video range 16–235. */
export const lumaRange = (fullRange) => (fullRange ? { lo: 0, hi: 255 } : { lo: 16, hi: 235 })

/**
 * Shots that need a lift and the gamma that brings their average up to the readable target (an upper estimate:
 * the curve is concave, so the measured result lands a little lower).
 */
export function planExposureLift(shotStats = [], { genre = '', fullRange = false } = {}) {
  const profileId = exposureProfileFor(genre)
  const prof = EXPOSURE_PROFILES[profileId]
  const { lo, hi } = lumaRange(fullRange)
  const norm = (y) => (y - lo) / (hi - lo)
  const lifts = []
  for (const s of shotStats) {
    if (!s?.samples || !Number.isFinite(s.meanY) || !Number.isFinite(s.p90Y)) continue
    if (norm(s.meanY) >= prof.darkMean || norm(s.p90Y) >= prof.brightP90) continue
    const m = Math.max(0.012, norm(s.meanY))
    const gamma = Math.min(prof.maxGamma, Math.log(m) / Math.log(prof.targetMean))
    if (!(gamma >= MIN_GAMMA)) continue
    const g = round2(gamma)
    lifts.push({
      id: s.id,
      startFrame: s.startFrame,
      endFrame: s.endFrame,
      startSec: round2(s.startSec),
      endSec: round2(s.endSec),
      meanY: s.meanY,
      p90Y: s.p90Y,
      gamma: g,
      saturation: round2(1 + (g - 1) * 0.3),
      expectedMeanY: round1(lo + (hi - lo) * Math.pow(m, 1 / g)),
    })
  }
  return { profile: profileId, lifts }
}

/**
 * FFmpeg filter chain, per lifted shot and enabled for exactly its frames: `gradfun` first (a dark 8-bit gradient has
 * only a handful of code values; opening it up would turn them into visible rings, so flat areas are smoothed with a
 * fine dither before the curve), then the video-range lutyuv curve.
 */
export function buildExposureFilter(lifts = [], { fullRange = false } = {}) {
  const { lo, hi } = lumaRange(fullRange)
  const cLo = fullRange ? 0 : 16
  const cHi = fullRange ? 255 : 240
  // gradfun / lutyuv work on the raw code values: relabel full-range frames as planar 4:2:0 without converting them
  const head = fullRange ? 'scale=in_range=pc:out_range=pc,format=yuv420p' : 'format=yuv420p'
  const parts = lifts.map((l) => {
    const inv = (1 / l.gamma).toFixed(4)
    const sat = Number(l.saturation || 1).toFixed(3)
    const range = `enable='between(n,${Math.max(0, l.startFrame)},${Math.max(0, l.endFrame)})'`
    const deband = Math.min(6, 1.5 + (l.gamma - 1) * 4).toFixed(2)
    const y = `if(lt(val,${lo}),val,if(gt(val,${hi}),val,${lo}+${hi - lo}*pow((val-${lo})/${hi - lo},${inv})))`
    const c = `clip(128+(val-128)*${sat},${cLo},${cHi})`
    return `gradfun=strength=${deband}:radius=24:${range},lutyuv=y='${y}':u='${c}':v='${c}':${range}`
  })
  return [head, ...parts].join(',')
}

/** Pixel format, range and colour tags of a file's first video stream. */
export async function probeVideoColor(file, signal) {
  const { ffprobe } = resolveBinaries()
  const res = await runCommandRedirected(
    ffprobe,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt,color_range,color_space,color_primaries,color_transfer', '-of', 'json', file],
    { timeoutMs: 60_000, signal },
  )
  let st = {}
  try {
    st = JSON.parse(res.stdout || '{}')?.streams?.[0] || {}
  } catch {}
  const known = (v) => (v && v !== 'unknown' && v !== 'reserved' ? String(v) : '')
  const pixFmt = String(st.pix_fmt || '')
  return {
    pixFmt,
    fullRange: pixFmt.startsWith('yuvj') || st.color_range === 'pc',
    colorSpace: known(st.color_space),
    colorPrimaries: known(st.color_primaries),
    colorTransfer: known(st.color_transfer),
  }
}

function summarize(stats = []) {
  const measured = stats.filter((s) => Number.isFinite(s.meanY))
  if (!measured.length) return null
  const w = measured.reduce((a, s) => a + (s.endSec - s.startSec), 0) || 1
  return {
    meanY: round1(measured.reduce((a, s) => a + s.meanY * (s.endSec - s.startSec), 0) / w),
    darkestShot: measured.reduce((a, s) => (a && a.meanY <= s.meanY ? a : s), null)?.id || null,
    darkestMeanY: Math.min(...measured.map((s) => s.meanY)),
  }
}

/**
 * Lift unreadably dark shots of a rendered film (see the module comment).
 * @returns {Promise<{ applied: boolean, reason: string, profile: string, shots: number, lifted: object[],
 *           before: object|null, after: object|null, error?: string }>}
 */
export async function enforceExposure({ mp4Path, script = {}, ffmpeg, signal, crf = 18, enabled = true } = {}) {
  const genre = String(script?.genre || '')
  const result = { applied: false, reason: '', profile: exposureProfileFor(genre), shots: 0, lifted: [], before: null, after: null }
  if (!enabled || script?.exposureGuard === false) return { ...result, reason: 'disabled' }
  if (!mp4Path || !existsSync(mp4Path)) return { ...result, reason: 'missing-file' }
  const fps = Number(script?.fps) || 30
  const shots = shotsFromScript(script, fps)
  result.shots = shots.length
  if (!shots.length) return { ...result, reason: 'no-shots' }
  const bin = ffmpeg || resolveBinaries().ffmpeg
  const durationSec = shots[shots.length - 1].endSec
  const color = await probeVideoColor(mp4Path, signal)
  result.fullRange = color.fullRange
  const stats = await measureShotLuma({ mp4Path, shots, ffmpeg: bin, signal, durationSec })
  result.before = summarize(stats)
  const { lifts } = planExposureLift(stats, { genre, fullRange: color.fullRange })
  if (!lifts.length) return { ...result, reason: result.before ? 'within-range' : 'unmeasured' }

  const orig = await probeAv(mp4Path, signal)
  if (!orig.video || !orig.video.frames || !(orig.video.durationSec > 0)) return { ...result, reason: 'unprobed' }
  const frameSec = orig.video.fps > 0 ? 1 / orig.video.fps : 1 / fps
  const dir = dirname(mp4Path)
  const stem = basename(mp4Path)
  const origCopy = join(dir, `.${stem}.exp-orig-${process.pid}.mp4`)
  const tmpOut = join(dir, `.${stem}.exp-pass-${process.pid}.mp4`)
  rmSync(origCopy, { force: true })
  renameSync(mp4Path, origCopy)
  try {
    const args = [
      '-y', '-hide_banner', '-v', 'error',
      '-i', origCopy,
      '-map', '0:v:0', '-map', '0:a?',
      '-vf', buildExposureFilter(lifts, { fullRange: color.fullRange }),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', String(Math.max(12, Math.min(28, Number(crf) || 18))),
      // same range and colour tags as the delivered file (values are not converted)
      '-pix_fmt', 'yuv420p', '-color_range', color.fullRange ? 'pc' : 'tv',
      ...(color.colorSpace ? ['-colorspace', color.colorSpace] : []),
      ...(color.colorPrimaries ? ['-color_primaries', color.colorPrimaries] : []),
      ...(color.colorTransfer ? ['-color_trc', color.colorTransfer] : []),
      '-c:a', 'copy',
      ...(orig.video.timescale ? ['-video_track_timescale', String(orig.video.timescale)] : []),
      '-movflags', '+faststart',
      tmpOut,
    ]
    const enc = await runCommandRedirected(bin, args, { timeoutMs: Math.max(300_000, Math.round(orig.video.durationSec * 8000)), signal })
    if (enc.code !== 0 || !existsSync(tmpOut)) throw new Error(`video re-encode failed: ${String(enc.stderr || '').slice(-300)}`)
    const av = await probeAv(tmpOut, signal)
    const durOk = av.video && Math.abs(av.video.durationSec - orig.video.durationSec) <= frameSec + 0.0015
    const audioOk = !orig.audio || (av.audio && Math.abs(av.audio.durationSec - orig.audio.durationSec) <= frameSec + 0.0015)
    if (!av.video || av.video.frames !== orig.video.frames || !durOk || !audioOk) {
      throw new Error(`re-encoded file failed verification (frames ${av.video?.frames}/${orig.video.frames})`)
    }
    const afterColor = await probeVideoColor(tmpOut, signal)
    if (afterColor.fullRange !== color.fullRange) throw new Error(`re-encoded file changed the luma range (${color.pixFmt} → ${afterColor.pixFmt})`)
    const liftedIds = new Set(lifts.map((l) => l.id))
    const afterStats = await measureShotLuma({ mp4Path: tmpOut, shots: shots.filter((s) => liftedIds.has(s.id)), ffmpeg: bin, signal, durationSec })
    const afterById = new Map(afterStats.map((s) => [s.id, s]))
    // the curve must have opened every lifted shot up, and not past the planned estimate (a range mix-up would)
    const off = lifts.find((l) => {
      const a = afterById.get(l.id)?.meanY
      return !Number.isFinite(a) || a < l.meanY + 0.5 || a > l.expectedMeanY + 6
    })
    if (off) throw new Error(`lift result off plan on ${off.id} (mean ${off.meanY} → ${afterById.get(off.id)?.meanY}, planned ≤ ${off.expectedMeanY})`)
    renameSync(tmpOut, mp4Path)
    rmSync(origCopy, { force: true })
    return {
      ...result,
      applied: true,
      reason: 'lifted',
      lifted: lifts.map((l) => ({ ...l, afterMeanY: afterById.get(l.id)?.meanY ?? null })),
      after: summarize(stats.map((s) => (afterById.get(s.id)?.meanY != null ? { ...s, meanY: afterById.get(s.id).meanY } : s))),
    }
  } catch (err) {
    rmSync(tmpOut, { force: true })
    if (existsSync(origCopy)) {
      rmSync(mp4Path, { force: true })
      renameSync(origCopy, mp4Path)
    }
    if (signal?.aborted || err?.name === 'AbortError') throw err
    return { ...result, applied: false, reason: 'error', lifted: lifts, error: String(err?.message || err).slice(0, 300) }
  }
}
