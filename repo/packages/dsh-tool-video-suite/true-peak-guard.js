/**
 * @dsh-video/tool-video-suite — delivery true-peak guard.
 *
 * The master mix (`output/master-audio.wav`) is limited before it is encoded, but AAC encoding overshoots: on a dense,
 * transient-heavy battle mix FFmpeg 7.1's native AAC encoder lifted a −2.7 dBTP master to −0.1 dBTP at 320 kbit/s,
 * which fails the render QA's EBU R128 check (≤ −0.5 dBTP) and can clip when a platform transcodes the film. The
 * overshoot depends on the material and the encoder build, so a fixed bitrate or limiter ceiling cannot guarantee
 * compliance. Instead the encoded file is measured: when its true peak is above the delivery ceiling, only the audio
 * track is re-encoded with a gain trim (the video stream is copied bit for bit) and measured again.
 *
 * - Every pass encodes from the same first-generation input: the master WAV when the caller knows the film's audio is
 *   exactly that file, otherwise the original encoded track (one extra AAC generation, never a chain of them).
 * - A pass is only kept when the frame count is unchanged and audio / video durations stay within one frame.
 * - Any failure leaves the original file in place; cancellation is re-thrown.
 */
import { existsSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { resolveBinaries, runCommandRedirected } from '../shared/index.js'

/** Delivery ceiling (EBU R128 / most platforms recommend −1 dBTP for lossy delivery). */
export const DELIVERY_TRUE_PEAK_CEILING_DBTP = -1.0
/**
 * Aim this far under the ceiling: the re-encode overshoots again (≈ 0.3 dB on the 项羽 battle mix, which landed exactly
 * on −1.0 dBTP with a 0.3 dB margin), so 0.5 dB normally fits in one pass with headroom to spare.
 */
export const TRUE_PEAK_TARGET_MARGIN_DB = 0.5
export const TRUE_PEAK_MAX_PASSES = 3

const round2 = (n) => Math.round(n * 100) / 100

/**
 * Parse the summary FFmpeg's `ebur128=peak=true` filter prints at the end of a run.
 * @returns {{ integratedLufs: number|null, rangeLu: number|null, truePeakDbtp: number|null }}
 */
export function parseEbur128Summary(text) {
  const s = String(text || '')
  const last = (re) => {
    const m = [...s.matchAll(re)]
    return m.length ? Number(m[m.length - 1][1]) : null
  }
  const num = (v) => (v === null || !Number.isFinite(v) ? null : v)
  return {
    integratedLufs: num(last(/^\s*I:\s*([-\d.]+)\s*LUFS/gm)),
    rangeLu: num(last(/^\s*LRA:\s*([-\d.]+)\s*LU/gm)),
    truePeakDbtp: num(last(/^\s*Peak:\s*([-\d.]+)\s*dBFS/gm)),
  }
}

/**
 * Gain (dB, ≤ 0) that brings a measured true peak to `ceiling − margin`; 0 when it is already at or under the ceiling.
 */
export function planTruePeakTrimDb(measuredDbtp, ceilingDbtp = DELIVERY_TRUE_PEAK_CEILING_DBTP, marginDb = TRUE_PEAK_TARGET_MARGIN_DB) {
  const m = Number(measuredDbtp)
  if (measuredDbtp === null || !Number.isFinite(m) || m <= ceilingDbtp) return 0
  return -round2(m - (ceilingDbtp - Math.max(0, Number(marginDb) || 0)))
}

/** Integrated loudness, loudness range and true peak of a file's audio (FFmpeg `ebur128=peak=true`). */
export async function measureAudioLoudness(mediaPath, { ffmpeg, signal, timeoutMs = 300_000 } = {}) {
  const bin = ffmpeg || resolveBinaries().ffmpeg
  const res = await runCommandRedirected(
    bin,
    ['-hide_banner', '-nostats', '-i', mediaPath, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    { timeoutMs, signal },
  )
  return parseEbur128Summary(`${res.stderr || ''}\n${res.stdout || ''}`)
}

/** Packet-counted frames, durations, frame rate and timescale of a file's first video / audio stream. */
export async function probeAv(file, signal) {
  const { ffprobe } = resolveBinaries()
  const res = await runCommandRedirected(
    ffprobe,
    ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,nb_read_packets,duration,time_base,avg_frame_rate', '-of', 'json', file],
    { timeoutMs: 120_000, signal },
  )
  let j = {}
  try {
    j = JSON.parse(res.stdout || '{}')
  } catch {}
  const streams = Array.isArray(j.streams) ? j.streams : []
  const v = streams.find((s) => s.codec_type === 'video')
  const a = streams.find((s) => s.codec_type === 'audio')
  const rate = String(v?.avg_frame_rate || '0/1').split('/').map(Number)
  const fps = rate[1] > 0 ? rate[0] / rate[1] : 0
  const den = Number(String(v?.time_base || '').split('/')[1]) || 0
  return {
    video: v ? { frames: Number(v.nb_read_packets) || 0, durationSec: Number(v.duration) || 0, fps, timescale: den } : null,
    audio: a ? { durationSec: Number(a.duration) || 0 } : null,
  }
}

/**
 * Keep the delivered MP4's audio under the true-peak ceiling (see the module comment).
 *
 * @param {{ mp4Path: string, sourceAudioPath?: string, ceilingDbtp?: number, ffmpeg?: string, signal?: AbortSignal,
 *           audioBitrate?: string, maxPasses?: number }} opts  `sourceAudioPath` = the WAV the film's audio was
 *           encoded from, only when the audio is exactly that file (padded / cut to the video length)
 * @returns {Promise<{ applied: boolean, reason: string, ceilingDbtp: number, source: string, passes: number,
 *           gainDb: number, before: object|null, after: object|null, error?: string }>}
 */
export async function enforceAudioTruePeak({
  mp4Path,
  sourceAudioPath = '',
  ceilingDbtp = DELIVERY_TRUE_PEAK_CEILING_DBTP,
  ffmpeg,
  signal,
  audioBitrate = '320k',
  maxPasses = TRUE_PEAK_MAX_PASSES,
} = {}) {
  const result = { applied: false, reason: '', ceilingDbtp, source: '', passes: 0, gainDb: 0, before: null, after: null }
  if (!mp4Path || !existsSync(mp4Path)) return { ...result, reason: 'missing-file' }
  const bin = ffmpeg || resolveBinaries().ffmpeg
  const before = await measureAudioLoudness(mp4Path, { ffmpeg: bin, signal })
  result.before = before
  if (before.truePeakDbtp === null) return { ...result, reason: 'no-audio' }
  if (before.truePeakDbtp <= ceilingDbtp) return { ...result, reason: 'within-ceiling', after: before }

  const orig = await probeAv(mp4Path, signal)
  if (!orig.video || !orig.audio || !orig.video.frames || !(orig.video.durationSec > 0)) {
    return { ...result, reason: 'unprobed' }
  }
  const useSource = Boolean(sourceAudioPath) && existsSync(sourceAudioPath)
  result.source = useSource ? 'master' : 'encoded'
  const frameSec = orig.video.fps > 0 ? 1 / orig.video.fps : 1 / 30
  const dir = dirname(mp4Path)
  const stem = basename(mp4Path)
  const origCopy = join(dir, `.${stem}.tp-orig-${process.pid}.mp4`)
  const tmpOut = join(dir, `.${stem}.tp-pass-${process.pid}.mp4`)
  const bestOut = join(dir, `.${stem}.tp-best-${process.pid}.mp4`)
  rmSync(origCopy, { force: true })
  renameSync(mp4Path, origCopy)
  let best = null
  try {
    let gainDb = 0
    let measured = before.truePeakDbtp
    for (let pass = 1; pass <= Math.max(1, maxPasses); pass++) {
      gainDb = round2(gainDb + planTruePeakTrimDb(measured, ceilingDbtp))
      const args = [
        '-y', '-hide_banner', '-v', 'error',
        '-i', origCopy,
        '-i', useSource ? sourceAudioPath : origCopy,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'copy',
        '-af', useSource ? `apad,volume=${gainDb}dB` : `volume=${gainDb}dB`,
        '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '48000', '-ac', '2',
        '-t', orig.video.durationSec.toFixed(6),
        ...(orig.video.timescale ? ['-video_track_timescale', String(orig.video.timescale)] : []),
        '-movflags', '+faststart',
        tmpOut,
      ]
      const enc = await runCommandRedirected(bin, args, { timeoutMs: Math.max(180_000, Math.round(orig.video.durationSec * 3000)), signal })
      if (enc.code !== 0 || !existsSync(tmpOut)) throw new Error(`audio re-encode failed: ${String(enc.stderr || '').slice(-300)}`)
      const after = await measureAudioLoudness(tmpOut, { ffmpeg: bin, signal })
      const av = await probeAv(tmpOut, signal)
      result.passes = pass
      const drift = av.video && av.audio ? Math.abs(av.video.durationSec - av.audio.durationSec) : Infinity
      const intact = Boolean(av.video && av.audio) && av.video.frames === orig.video.frames && av.audio.durationSec > 0 && drift <= frameSec + 0.0015
      if (!intact) {
        throw new Error(`re-encoded file failed verification (frames ${av.video?.frames}/${orig.video.frames}, A/V drift ${drift.toFixed(4)} s)`)
      }
      if (after.truePeakDbtp !== null && (!best || after.truePeakDbtp < best.after.truePeakDbtp)) {
        rmSync(bestOut, { force: true })
        renameSync(tmpOut, bestOut)
        best = { gainDb, after }
      } else {
        rmSync(tmpOut, { force: true })
      }
      measured = after.truePeakDbtp
      if (measured === null || measured <= ceilingDbtp) break
    }
    if (!best) throw new Error('no verified re-encode')
    renameSync(bestOut, mp4Path)
    rmSync(origCopy, { force: true })
    return {
      ...result,
      applied: true,
      reason: best.after.truePeakDbtp <= ceilingDbtp ? 'trimmed' : 'trimmed-partially',
      gainDb: best.gainDb,
      after: best.after,
    }
  } catch (err) {
    rmSync(tmpOut, { force: true })
    rmSync(bestOut, { force: true })
    if (existsSync(origCopy)) {
      rmSync(mp4Path, { force: true })
      renameSync(origCopy, mp4Path)
    }
    if (signal?.aborted || err?.name === 'AbortError') throw err
    return { ...result, applied: false, reason: 'error', error: String(err?.message || err).slice(0, 300) }
  }
}
