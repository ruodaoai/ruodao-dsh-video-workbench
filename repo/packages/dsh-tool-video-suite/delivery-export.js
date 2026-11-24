/**
 * Delivery exports (documented interchange formats only):
 *   - SRT / WebVTT subtitles with global timing
 *   - Aligned audio stems (voice / sfx / bgm) via `mixVideoAudio({ writeStems: true })`
 *   - FCPXML 1.10 (Final Cut Pro, also imported by DaVinci Resolve)
 *   - XMEML v5 (Final Cut Pro 7 XML, imported by Premiere Pro & DaVinci Resolve)
 * Timelines reference per-scene ranges of the final MP4 plus the stems, with markers at scene cuts and musical downbeats.
 * No proprietary / undocumented project formats are generated.
 */
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readScriptJson, REPO_ROOT, resolveBinaries, runCommandRedirected } from '../shared/index.js'
import { readAssets } from '../dsh-tool-media/asset-manager.js'
import { mixVideoAudio } from '../dsh-tool-media/audio-synth.js'
import { buildSceneTimeline } from './qa-detectors.js'
import { applyColorLut } from './color-tools.js'

export const DELIVERY_FORMATS = Object.freeze(['srt', 'vtt', 'stems', 'fcpxml', 'xmeml'])
const FORMAT_ALIASES = {
  srt: 'srt',
  vtt: 'vtt',
  webvtt: 'vtt',
  stems: 'stems',
  stem: 'stems',
  fcpxml: 'fcpxml',
  fcpx: 'fcpxml',
  finalcut: 'fcpxml',
  xmeml: 'xmeml',
  fcp7: 'xmeml',
  'fcp7xml': 'xmeml',
  premiere: 'xmeml',
  xml: 'xmeml',
}
const STEM_ROLES = [
  { role: 'voice', label: '人声 Voice', fcpRole: 'dialogue' },
  { role: 'sfx', label: '音效 SFX', fcpRole: 'effects' },
  { role: 'bgm', label: '配乐 BGM', fcpRole: 'music' },
]

export function normalizeDeliveryFormats(formats) {
  const list = Array.isArray(formats) ? formats : String(formats || '').split(/[\s,;|]+/)
  const out = []
  for (const raw of list) {
    const key = String(raw || '').trim().toLowerCase()
    if (!key) continue
    if (key === 'all') {
      out.push(...DELIVERY_FORMATS)
      continue
    }
    const fmt = FORMAT_ALIASES[key]
    if (!fmt) throw new Error(`不支持的导出格式: ${raw}（可选 ${DELIVERY_FORMATS.join(' / ')}）`)
    out.push(fmt)
  }
  return [...new Set(out)]
}

// ---------------------------------------------------------------------------------------------
// Subtitles
// ---------------------------------------------------------------------------------------------

const cleanCueText = (t) =>
  String(t ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/-->/g, '→')
    .replace(/\n{2,}/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')

const finiteOr = (...vals) => {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v))) return Number(v)
  }
  return null
}

/**
 * Global subtitle cues in frames, mirroring the Remotion composition: `script.subtitles` (global timing) first,
 * else every `scene.subtitles[]` offset by the scene start. Cues are sorted, clipped to the timeline and de-overlapped.
 */
export function collectGlobalSubtitleCues(script, { fps, totalFrames } = {}) {
  const f = Number(fps) > 0 ? Number(fps) : Number(script?.fps) || 30
  const timeline = buildSceneTimeline(script || {}, f)
  const total =
    Number(totalFrames) > 0
      ? Math.round(Number(totalFrames))
      : Number(script?.totalDurationInFrames) > 0
        ? Math.round(Number(script.totalDurationInFrames))
        : timeline.length
          ? timeline[timeline.length - 1].endFrame
          : 0
  const raw = []
  const globalSubs = Array.isArray(script?.subtitles) ? script.subtitles : []
  if (globalSubs.length > 0) {
    for (const sub of globalSubs) {
      const text = cleanCueText(sub?.text)
      if (!text) continue
      const secStart = finiteOr(sub.globalStartSec, sub.startSec)
      const secEnd = finiteOr(sub.globalEndSec, sub.endSec)
      const sf = finiteOr(sub.globalStartFrame, sub.startFrame, secStart !== null ? Math.round(secStart * f) : null)
      const ef = finiteOr(sub.globalEndFrame, sub.endFrame, secEnd !== null ? Math.round(secEnd * f) : null)
      if (sf === null || ef === null) continue
      raw.push({ text, sf, ef, sceneId: sub.sceneId || '' })
    }
  } else {
    for (const row of timeline) {
      for (const sub of Array.isArray(row.scene?.subtitles) ? row.scene.subtitles : []) {
        const text = cleanCueText(sub?.text)
        if (!text) continue
        const localStartFrame = finiteOr(sub.startFrame, finiteOr(sub.localStartSec, sub.startSec) !== null ? Math.round(finiteOr(sub.localStartSec, sub.startSec) * f) : null)
        const localEndFrame = finiteOr(sub.endFrame, finiteOr(sub.localEndSec, sub.endSec) !== null ? Math.round(finiteOr(sub.localEndSec, sub.endSec) * f) : null)
        if (localStartFrame === null || localEndFrame === null) continue
        raw.push({ text, sf: row.startFrame + localStartFrame, ef: row.startFrame + localEndFrame, sceneId: row.id })
      }
    }
  }
  raw.sort((a, b) => a.sf - b.sf || a.ef - b.ef)
  const cues = []
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i]
    let sf = Math.max(0, Math.round(cur.sf))
    let ef = Math.round(cur.ef)
    if (total > 0) {
      sf = Math.min(sf, total)
      ef = Math.min(ef, total)
    }
    const prev = cues[cues.length - 1]
    if (prev && prev.endFrame > sf) prev.endFrame = sf
    if (prev && prev.endFrame <= prev.startFrame) cues.pop()
    if (ef <= sf) continue
    cues.push({ text: cur.text, startFrame: sf, endFrame: ef, sceneId: cur.sceneId })
  }
  return cues
    .filter((c) => c.endFrame > c.startFrame)
    .map((c, i) => ({
      index: i + 1,
      ...c,
      startSec: Number((c.startFrame / f).toFixed(3)),
      endSec: Number((c.endFrame / f).toFixed(3)),
    }))
}

function formatCueTime(sec, sep) {
  const totalMs = Math.max(0, Math.round(Number(sec) * 1000))
  const h = Math.floor(totalMs / 3_600_000)
  const m = Math.floor((totalMs % 3_600_000) / 60_000)
  const s = Math.floor((totalMs % 60_000) / 1000)
  const ms = totalMs % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms).padStart(3, '0')}`
}

export function buildSrt(cues) {
  return (
    cues
      .map((c, i) => `${i + 1}\r\n${formatCueTime(c.startSec, ',')} --> ${formatCueTime(c.endSec, ',')}\r\n${c.text.replace(/\n/g, '\r\n')}\r\n`)
      .join('\r\n') + (cues.length ? '\r\n' : '')
  )
}

export function buildVtt(cues, { title = '' } = {}) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const header = `WEBVTT${title ? ` - ${String(title).replace(/[\r\n]+/g, ' ').replace(/-->/g, '→')}` : ''}\n\n`
  return header + cues.map((c, i) => `${i + 1}\n${formatCueTime(c.startSec, '.')} --> ${formatCueTime(c.endSec, '.')}\n${esc(c.text)}\n`).join('\n')
}

// ---------------------------------------------------------------------------------------------
// Timeline model shared by FCPXML and XMEML
// ---------------------------------------------------------------------------------------------

function gcd(a, b) {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a || 1
}

/** Rational frame rate: integer fps → n/1, NTSC rates (29.97 / 23.976 / 59.94) → n·1000/1001. */
export function toRationalFps(fps) {
  const f = Number(fps) > 0 ? Number(fps) : 30
  if (Math.abs(f - Math.round(f)) < 1e-6) return { num: Math.round(f), den: 1, timebase: Math.round(f), ntsc: false }
  const ntscBase = Math.round((f * 1001) / 1000)
  if (Math.abs((ntscBase * 1000) / 1001 - f) < 0.01) return { num: ntscBase * 1000, den: 1001, timebase: ntscBase, ntsc: true }
  return { num: Math.round(f * 1000), den: 1000, timebase: Math.round(f), ntsc: false }
}

/** FCPXML rational time string for a frame count, e.g. `58/30s`, `0s`, `1001/30000s`. */
export function fcpTime(frames, rate) {
  const n = Math.round(Number(frames) || 0) * rate.den
  const d = rate.num
  if (n === 0) return '0s'
  const g = gcd(n, d)
  return d / g === 1 ? `${n / g}s` : `${n / g}/${d / g}s`
}

export function framesToTimecode(frames, rate) {
  const tb = rate.timebase
  const f = Math.max(0, Math.round(frames))
  const hh = Math.floor(f / (tb * 3600))
  const mm = Math.floor((f % (tb * 3600)) / (tb * 60))
  const ss = Math.floor((f % (tb * 60)) / tb)
  const ff = f % tb
  return [hh, mm, ss, ff].map((v) => String(v).padStart(2, '0')).join(':')
}

export function xmlEscape(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** `file:///D:/dir/a%20b.mp4` (FCPXML media-rep src). */
export function toFileUrl(absPath) {
  return pathToFileURL(resolve(absPath)).href
}

/** `file://localhost/D%3a/dir/a%20b.mp4` — the form Premiere Pro itself writes into FCP7 XML on Windows. */
export function toXmemlPathUrl(absPath) {
  const href = pathToFileURL(resolve(absPath)).href
  return href.replace(/^file:\/\/\/([A-Za-z]):\//, (_, d) => `file://localhost/${d}%3a/`).replace(/^file:\/\/\/(?!localhost)/, 'file://localhost/')
}

async function probeMediaInfo(file) {
  const { ffprobe } = resolveBinaries()
  const res = await runCommandRedirected(
    ffprobe,
    ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,r_frame_rate,nb_frames,duration,sample_rate,channels:format=duration', '-of', 'json', file],
    { timeoutMs: 60_000 },
  )
  try {
    return JSON.parse(res.stdout || '{}')
  } catch {
    return {}
  }
}

function parseRate(r) {
  const m = /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(String(r || ''))
  if (!m) return 0
  const v = Number(m[1]) / (m[2] ? Number(m[2]) || 1 : 1)
  return Number.isFinite(v) && v > 0 ? v : 0
}

/**
 * Build the NLE-agnostic timeline: per-scene ranges of the final MP4, stems and markers (scene cuts + downbeats + drops).
 */
export async function buildDeliveryTimeline({ script, mp4Path, stems = null, title = '' }) {
  const info = await probeMediaInfo(mp4Path)
  const streams = Array.isArray(info.streams) ? info.streams : []
  const v = streams.find((s) => s.codec_type === 'video') || {}
  const a = streams.find((s) => s.codec_type === 'audio') || null
  const fps = parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate) || Number(script?.fps) || 30
  const rate = toRationalFps(fps)
  const fpsExact = rate.num / rate.den
  const durSec = Number(v.duration || info.format?.duration || 0)
  const totalFrames = Number(v.nb_frames) > 0 ? Number(v.nb_frames) : Math.max(1, Math.round(durSec * fpsExact) || Number(script?.totalDurationInFrames) || 1)

  // Scene ranges → contiguous clip list covering [0, totalFrames)
  const rows = buildSceneTimeline(script || {}, fpsExact)
  const starts = [...new Set(rows.map((r) => r.startFrame).filter((sf) => sf > 0 && sf < totalFrames))].sort((x, y) => x - y)
  const bounds = [0, ...starts, totalFrames]
  const clips = []
  for (let i = 0; i + 1 < bounds.length; i++) {
    const startFrame = bounds[i]
    const endFrame = bounds[i + 1]
    if (endFrame <= startFrame) continue
    const row = rows.find((r) => r.startFrame === startFrame) || rows.find((r) => r.startFrame <= startFrame && r.endFrame > startFrame) || null
    const n = clips.length + 1
    const sceneTitle = row?.title ? String(row.title) : ''
    clips.push({
      index: n,
      sceneId: row?.id || `scene-${String(n).padStart(2, '0')}`,
      name: `${String(n).padStart(2, '0')} · ${sceneTitle || row?.id || '分镜'}`.slice(0, 120),
      startFrame,
      endFrame,
      frames: endFrame - startFrame,
    })
  }

  const markers = []
  for (const c of clips) {
    markers.push({ frame: c.startFrame, kind: 'scene', name: `▶ ${c.name}`, note: c.sceneId })
  }
  const beats = Array.isArray(script?.bgm?.beats) ? script.bgm.beats : []
  let downbeatTimes = beats.filter((b) => b && b.strong === true && Number.isFinite(Number(b.time))).map((b) => Number(b.time))
  if (downbeatTimes.length === 0 && Array.isArray(script?.bgm?.downbeats)) {
    downbeatTimes = script.bgm.downbeats.map((t) => Number(typeof t === 'object' ? t?.time : t)).filter(Number.isFinite)
  }
  const drops = (Array.isArray(script?.bgm?.drops) ? script.bgm.drops : [])
    .map((t) => Number(typeof t === 'object' ? t?.time : t))
    .filter(Number.isFinite)
  let bar = 0
  for (const t of downbeatTimes.sort((x, y) => x - y)) {
    const frame = Math.round(t * fpsExact)
    if (frame < 0 || frame >= totalFrames) continue
    bar++
    const scene = markers.find((m) => m.kind === 'scene' && m.frame === frame)
    if (scene) {
      scene.name += ' ♪'
      continue
    }
    markers.push({ frame, kind: 'downbeat', name: `♪ 强拍 ${bar}`, note: `downbeat @ ${t.toFixed(3)}s` })
  }
  for (const t of drops.sort((x, y) => x - y)) {
    const frame = Math.round(t * fpsExact)
    if (frame < 0 || frame >= totalFrames) continue
    markers.push({ frame, kind: 'drop', name: '⚡ 高潮 Drop', note: `drop @ ${t.toFixed(3)}s` })
  }
  markers.sort((x, y) => x.frame - y.frame || (x.kind === 'scene' ? -1 : 1))

  const stemList = []
  if (stems) {
    for (const s of STEM_ROLES) {
      const p = stems[s.role]
      if (!p || !existsSync(p)) continue
      const sInfo = await probeMediaInfo(p)
      const st = (sInfo.streams || []).find((x) => x.codec_type === 'audio') || {}
      const sDur = Number(st.duration || sInfo.format?.duration || 0)
      stemList.push({
        ...s,
        path: resolve(p),
        frames: Math.max(1, Math.round(sDur * fpsExact) || totalFrames),
        channels: Number(st.channels) || 2,
        sampleRate: Number(st.sample_rate) || 48000,
        silent: stems.roles?.[s.role] === 'silent',
      })
    }
  }

  return {
    title: title || script?.displayTitle || script?.title || basename(mp4Path),
    rate,
    fps: fpsExact,
    totalFrames,
    width: Number(v.width) || Number(script?.width) || 1920,
    height: Number(v.height) || Number(script?.height) || 1080,
    video: {
      path: resolve(mp4Path),
      name: basename(mp4Path),
      frames: totalFrames,
      hasAudio: Boolean(a),
      audioChannels: Number(a?.channels) || 2,
      sampleRate: Number(a?.sample_rate) || 48000,
    },
    clips,
    markers,
    stems: stemList,
  }
}

// ---------------------------------------------------------------------------------------------
// FCPXML 1.10
// ---------------------------------------------------------------------------------------------

/**
 * Final Cut Pro XML (FCPXML 1.10): per-scene `asset-clip` ranges of the final MP4 on the primary storyline,
 * stems as connected audio clips (roles dialogue / effects / music) and markers at cuts & downbeats.
 */
export function buildFcpxml(tl, { stemsEnabled = false, eventName = 'DSH Video Workbench 导出' } = {}) {
  const r = tl.rate
  const T = (frames) => fcpTime(frames, r)
  const L = []
  L.push('<?xml version="1.0" encoding="UTF-8"?>')
  L.push('<!DOCTYPE fcpxml>')
  L.push('<fcpxml version="1.10">')
  L.push('  <resources>')
  L.push(`    <format id="r1" frameDuration="${T(1)}" width="${tl.width}" height="${tl.height}" colorSpace="1-1-1 (Rec. 709)"/>`)
  L.push(
    `    <asset id="r2" name="${xmlEscape(tl.video.name)}" start="0s" duration="${T(tl.totalFrames)}" hasVideo="1" format="r1" videoSources="1"${tl.video.hasAudio ? ` hasAudio="1" audioSources="1" audioChannels="${tl.video.audioChannels}" audioRate="${tl.video.sampleRate}"` : ''}>`,
  )
  L.push(`      <media-rep kind="original-media" src="${xmlEscape(toFileUrl(tl.video.path))}"/>`)
  L.push('    </asset>')
  tl.stems.forEach((s, i) => {
    L.push(`    <asset id="r${i + 3}" name="${xmlEscape(`${s.role}.wav`)}" start="0s" duration="${T(s.frames)}" hasAudio="1" audioSources="1" audioChannels="${s.channels}" audioRate="${s.sampleRate}">`)
    L.push(`      <media-rep kind="original-media" src="${xmlEscape(toFileUrl(s.path))}"/>`)
    L.push('    </asset>')
  })
  L.push('  </resources>')
  L.push('  <library>')
  L.push(`    <event name="${xmlEscape(eventName)}">`)
  L.push(`      <project name="${xmlEscape(tl.title)}">`)
  L.push(`        <sequence format="r1" duration="${T(tl.totalFrames)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`)
  L.push('          <spine>')
  for (const c of tl.clips) {
    const clipMarkers = tl.markers.filter((m) => m.frame >= c.startFrame && m.frame < c.endFrame)
    L.push(
      `            <asset-clip ref="r2" offset="${T(c.startFrame)}" name="${xmlEscape(c.name)}" start="${T(c.startFrame)}" duration="${T(c.frames)}" format="r1" tcFormat="NDF">`,
    )
    if (stemsEnabled && tl.stems.length > 0 && tl.video.hasAudio) L.push('              <adjust-volume amount="-96dB"/>')
    if (c.index === 1) {
      tl.stems.forEach((s, i) => {
        L.push(
          `              <asset-clip ref="r${i + 3}" lane="-${i + 1}" offset="0s" name="${xmlEscape(s.label)}" start="0s" duration="${T(s.frames)}" audioRole="${s.fcpRole}"${stemsEnabled ? '' : ' enabled="0"'}/>`,
        )
      })
    }
    for (const m of clipMarkers) {
      // Clip-local time equals source time here because each clip uses the matching range of final.mp4
      L.push(`              <marker start="${T(m.frame)}" duration="${T(1)}" value="${xmlEscape(m.name)}" note="${xmlEscape(m.note || m.kind)}"/>`)
    }
    L.push('            </asset-clip>')
  }
  L.push('          </spine>')
  L.push('        </sequence>')
  L.push('      </project>')
  L.push('    </event>')
  L.push('  </library>')
  L.push('</fcpxml>')
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------------------------
// XMEML v5 (Final Cut Pro 7 XML Interchange Format)
// ---------------------------------------------------------------------------------------------

/**
 * Final Cut Pro 7 XML (xmeml v5) as imported by Premiere Pro and DaVinci Resolve: V1 = per-scene ranges of the MP4,
 * A1/A2 = its stereo mix (linked), followed by L/R track pairs for each stem; sequence markers at cuts & downbeats.
 */
export function buildXmeml(tl, { stemsEnabled = false } = {}) {
  const r = tl.rate
  const rateXml = (ind) => `${ind}<rate>\n${ind}  <timebase>${r.timebase}</timebase>\n${ind}  <ntsc>${r.ntsc ? 'TRUE' : 'FALSE'}</ntsc>\n${ind}</rate>`
  const L = []
  const videoFileId = 'file-1'
  const mixEnabled = !(stemsEnabled && tl.stems.length > 0)
  let fileDefined = false
  const videoFileXml = (ind) => {
    if (fileDefined) return `${ind}<file id="${videoFileId}"/>`
    fileDefined = true
    return [
      `${ind}<file id="${videoFileId}">`,
      `${ind}  <name>${xmlEscape(tl.video.name)}</name>`,
      `${ind}  <pathurl>${xmlEscape(toXmemlPathUrl(tl.video.path))}</pathurl>`,
      rateXml(`${ind}  `),
      `${ind}  <duration>${tl.totalFrames}</duration>`,
      `${ind}  <timecode>`,
      rateXml(`${ind}    `),
      `${ind}    <string>00:00:00:00</string>`,
      `${ind}    <frame>0</frame>`,
      `${ind}    <displayformat>NDF</displayformat>`,
      `${ind}  </timecode>`,
      `${ind}  <media>`,
      `${ind}    <video>`,
      `${ind}      <samplecharacteristics>`,
      rateXml(`${ind}        `),
      `${ind}        <width>${tl.width}</width>`,
      `${ind}        <height>${tl.height}</height>`,
      `${ind}        <anamorphic>FALSE</anamorphic>`,
      `${ind}        <pixelaspectratio>square</pixelaspectratio>`,
      `${ind}        <fielddominance>none</fielddominance>`,
      `${ind}      </samplecharacteristics>`,
      `${ind}    </video>`,
      ...(tl.video.hasAudio
        ? [
            `${ind}    <audio>`,
            `${ind}      <samplecharacteristics>`,
            `${ind}        <depth>16</depth>`,
            `${ind}        <samplerate>${tl.video.sampleRate}</samplerate>`,
            `${ind}      </samplecharacteristics>`,
            `${ind}      <channelcount>${tl.video.audioChannels}</channelcount>`,
            `${ind}    </audio>`,
          ]
        : []),
      `${ind}  </media>`,
      `${ind}</file>`,
    ].join('\n')
  }
  const linkXml = (ind, links) =>
    links
      .map((lk) =>
        [
          `${ind}<link>`,
          `${ind}  <linkclipref>${lk.id}</linkclipref>`,
          `${ind}  <mediatype>${lk.mediatype}</mediatype>`,
          `${ind}  <trackindex>${lk.trackindex}</trackindex>`,
          `${ind}  <clipindex>${lk.clipindex}</clipindex>`,
          ...(lk.mediatype === 'audio' ? [`${ind}  <groupindex>1</groupindex>`] : []),
          `${ind}</link>`,
        ].join('\n'),
      )
      .join('\n')

  const videoClipId = (c) => `clipitem-v${c.index}`
  const mixClipId = (c, ch) => `clipitem-a${ch}-${c.index}`
  const mixChannels = tl.video.hasAudio ? Math.min(2, Math.max(1, tl.video.audioChannels)) : 0
  const linksFor = (c) => [
    { id: videoClipId(c), mediatype: 'video', trackindex: 1, clipindex: c.index },
    ...Array.from({ length: mixChannels }, (_, k) => ({ id: mixClipId(c, k + 1), mediatype: 'audio', trackindex: k + 1, clipindex: c.index })),
  ]

  L.push('<?xml version="1.0" encoding="UTF-8"?>')
  L.push('<!DOCTYPE xmeml>')
  L.push('<xmeml version="5">')
  L.push('  <sequence id="sequence-1">')
  L.push(`    <name>${xmlEscape(tl.title)}</name>`)
  L.push(`    <duration>${tl.totalFrames}</duration>`)
  L.push(rateXml('    '))
  L.push('    <timecode>')
  L.push(rateXml('      '))
  L.push('      <string>00:00:00:00</string>')
  L.push('      <frame>0</frame>')
  L.push('      <displayformat>NDF</displayformat>')
  L.push('    </timecode>')
  L.push('    <in>-1</in>')
  L.push('    <out>-1</out>')
  L.push('    <media>')
  L.push('      <video>')
  L.push('        <format>')
  L.push('          <samplecharacteristics>')
  L.push(rateXml('            '))
  L.push(`            <width>${tl.width}</width>`)
  L.push(`            <height>${tl.height}</height>`)
  L.push('            <anamorphic>FALSE</anamorphic>')
  L.push('            <pixelaspectratio>square</pixelaspectratio>')
  L.push('            <fielddominance>none</fielddominance>')
  L.push('          </samplecharacteristics>')
  L.push('        </format>')
  L.push('        <track>')
  for (const c of tl.clips) {
    L.push(`          <clipitem id="${videoClipId(c)}">`)
    L.push(`            <name>${xmlEscape(c.name)}</name>`)
    L.push('            <enabled>TRUE</enabled>')
    L.push(`            <duration>${tl.totalFrames}</duration>`)
    L.push(rateXml('            '))
    L.push(`            <start>${c.startFrame}</start>`)
    L.push(`            <end>${c.endFrame}</end>`)
    L.push(`            <in>${c.startFrame}</in>`)
    L.push(`            <out>${c.endFrame}</out>`)
    L.push(videoFileXml('            '))
    if (mixChannels > 0) L.push(linkXml('            ', linksFor(c)))
    L.push('          </clipitem>')
  }
  L.push('          <enabled>TRUE</enabled>')
  L.push('          <locked>FALSE</locked>')
  L.push('        </track>')
  L.push('      </video>')
  L.push('      <audio>')
  L.push('        <numOutputChannels>2</numOutputChannels>')
  L.push('        <format>')
  L.push('          <samplecharacteristics>')
  L.push('            <depth>16</depth>')
  L.push('            <samplerate>48000</samplerate>')
  L.push('          </samplecharacteristics>')
  L.push('        </format>')
  const pushAudioTrack = (clipsXml, outputChannel) => {
    L.push('        <track>')
    L.push(...clipsXml)
    L.push('          <enabled>TRUE</enabled>')
    L.push('          <locked>FALSE</locked>')
    L.push(`          <outputchannelindex>${outputChannel}</outputchannelindex>`)
    L.push('        </track>')
  }
  for (let ch = 1; ch <= mixChannels; ch++) {
    const items = []
    for (const c of tl.clips) {
      items.push(
        [
          `          <clipitem id="${mixClipId(c, ch)}">`,
          `            <name>${xmlEscape(c.name)}</name>`,
          `            <enabled>${mixEnabled ? 'TRUE' : 'FALSE'}</enabled>`,
          `            <duration>${tl.totalFrames}</duration>`,
          rateXml('            '),
          `            <start>${c.startFrame}</start>`,
          `            <end>${c.endFrame}</end>`,
          `            <in>${c.startFrame}</in>`,
          `            <out>${c.endFrame}</out>`,
          videoFileXml('            '),
          '            <sourcetrack>',
          '              <mediatype>audio</mediatype>',
          `              <trackindex>${ch}</trackindex>`,
          '            </sourcetrack>',
          linkXml('            ', linksFor(c)),
          '          </clipitem>',
        ].join('\n'),
      )
    }
    pushAudioTrack(items, mixChannels === 1 ? 1 : ch)
  }
  tl.stems.forEach((s, si) => {
    const channels = Math.min(2, Math.max(1, s.channels))
    for (let ch = 1; ch <= channels; ch++) {
      const fileId = `file-${si + 2}`
      const fileXml =
        ch === 1
          ? [
              `            <file id="${fileId}">`,
              `              <name>${xmlEscape(`${s.role}.wav`)}</name>`,
              `              <pathurl>${xmlEscape(toXmemlPathUrl(s.path))}</pathurl>`,
              rateXml('              '),
              `              <duration>${s.frames}</duration>`,
              '              <media>',
              '                <audio>',
              '                  <samplecharacteristics>',
              '                    <depth>32</depth>',
              `                    <samplerate>${s.sampleRate}</samplerate>`,
              '                  </samplecharacteristics>',
              `                  <channelcount>${s.channels}</channelcount>`,
              '                </audio>',
              '              </media>',
              '            </file>',
            ].join('\n')
          : `            <file id="${fileId}"/>`
      pushAudioTrack(
        [
          [
            `          <clipitem id="clipitem-${s.role}-${ch}">`,
            `            <name>${xmlEscape(`${s.label}${channels > 1 ? (ch === 1 ? ' L' : ' R') : ''}`)}</name>`,
            `            <enabled>${stemsEnabled ? 'TRUE' : 'FALSE'}</enabled>`,
            `            <duration>${s.frames}</duration>`,
            rateXml('            '),
            '            <start>0</start>',
            `            <end>${Math.min(s.frames, tl.totalFrames)}</end>`,
            '            <in>0</in>',
            `            <out>${Math.min(s.frames, tl.totalFrames)}</out>`,
            fileXml,
            '            <sourcetrack>',
            '              <mediatype>audio</mediatype>',
            `              <trackindex>${ch}</trackindex>`,
            '            </sourcetrack>',
            '          </clipitem>',
          ].join('\n'),
        ],
        channels === 1 ? 1 : ch,
      )
    }
  })
  L.push('      </audio>')
  L.push('    </media>')
  for (const m of tl.markers) {
    L.push('    <marker>')
    L.push(`      <name>${xmlEscape(m.name)}</name>`)
    L.push(`      <comment>${xmlEscape(m.note || m.kind)}</comment>`)
    L.push(`      <in>${m.frame}</in>`)
    L.push('      <out>-1</out>')
    L.push('    </marker>')
  }
  L.push('  </sequence>')
  L.push('</xmeml>')
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------------

const safeFileStem = (s) =>
  String(s || '')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'timeline'

/**
 * Export a delivery package into `output/export/`: subtitles, stems and NLE timelines.
 */
export async function exportProjectPackage({
  projectDir,
  formats = ['srt', 'vtt', 'stems', 'fcpxml', 'xmeml'],
  mp4Path,
  stemsEnabled = false,
  lut = '',
  lutIntensity = 1,
  signal,
} = {}) {
  const absDir = isAbsolute(projectDir || '.') ? resolve(projectDir) : resolve(REPO_ROOT, projectDir || '.')
  const { data: script } = readScriptJson(absDir)
  const list = normalizeDeliveryFormats(formats)
  if (list.length === 0) throw new Error('formats 不能为空')
  const exportDir = join(absDir, 'output', 'export')
  mkdirSync(exportDir, { recursive: true })
  const fps = Number(script?.fps) || 30
  const result = { ok: true, projectDir: absDir, exportDir, formats: list, files: {}, warnings: [] }

  let videoPath = mp4Path ? resolve(absDir, mp4Path) : join(absDir, 'output', 'final.mp4')
  const needsVideo = list.includes('fcpxml') || list.includes('xmeml')
  if (needsVideo && !existsSync(videoPath)) throw new Error(`成片不存在，无法生成剪辑时间线: ${videoPath}`)
  if (lut && existsSync(videoPath)) {
    const graded = await applyColorLut({ projectDir: absDir, mp4Path: videoPath, lut, intensity: lutIntensity, outputPath: join(exportDir, `${safeFileStem(basename(videoPath).replace(/\.mp4$/i, ''))}.graded.mp4`), signal })
    videoPath = graded.outputPath
    result.files.gradedVideo = graded.outputPath
  }

  let totalFrames = Number(script?.totalDurationInFrames) || 0
  if (existsSync(videoPath)) {
    const info = await probeMediaInfo(videoPath)
    const v = (info.streams || []).find((s) => s.codec_type === 'video')
    if (v && Number(v.nb_frames) > 0) totalFrames = Number(v.nb_frames)
  }

  if (list.includes('srt') || list.includes('vtt')) {
    const cues = collectGlobalSubtitleCues(script, { fps, totalFrames })
    result.subtitleCues = cues.length
    if (cues.length === 0) result.warnings.push('script.json 中没有可导出的字幕')
    if (list.includes('srt')) {
      const p = join(exportDir, 'subtitles.srt')
      writeFileSync(p, '\uFEFF' + buildSrt(cues), 'utf8')
      result.files.srt = p
    }
    if (list.includes('vtt')) {
      const p = join(exportDir, 'subtitles.vtt')
      writeFileSync(p, buildVtt(cues, { title: script?.displayTitle || script?.title || '' }), 'utf8')
      result.files.vtt = p
    }
  }

  let stems = null
  const stemsDir = join(exportDir, 'stems')
  const existingStems = Object.fromEntries(STEM_ROLES.map((s) => [s.role, join(stemsDir, `${s.role}.wav`)]))
  const haveAllStems = STEM_ROLES.every((s) => existsSync(existingStems[s.role]))
  if (list.includes('stems') || (needsVideo && !haveAllStems)) {
    const refMaster = join(stemsDir, '.stems-reference-master.wav')
    try {
      const mix = await mixVideoAudio({
        projectDir: absDir,
        script,
        assetsManifest: readAssets(absDir),
        outputPath: refMaster,
        writeStems: true,
        stemsDir,
        signal,
      })
      stems = mix.stems
      const liveMaster = join(absDir, 'output', 'master-audio.wav')
      if (existsSync(liveMaster) && Math.abs(statSync(liveMaster).size - statSync(refMaster).size) > 4096) {
        result.warnings.push('当前混音与已渲染成片的 master-audio.wav 长度不同（剧本可能已修改），建议重新渲染后再导出')
      }
    } finally {
      try { unlinkSync(refMaster) } catch {}
    }
    result.files.stems = { voice: stems.voice, sfx: stems.sfx, bgm: stems.bgm }
    result.stems = { gainDb: stems.gainDb, roles: stems.roles, format: stems.format, sampleRate: stems.sampleRate, reused: false }
  } else if (needsVideo && haveAllStems) {
    stems = { ...existingStems, roles: {} }
    result.files.stems = existingStems
    result.stems = { reused: true }
  }

  if (needsVideo) {
    const tl = await buildDeliveryTimeline({ script, mp4Path: videoPath, stems, title: script?.displayTitle || script?.title || '' })
    const stem = safeFileStem(tl.title)
    if (list.includes('fcpxml')) {
      const p = join(exportDir, `${stem}.fcpxml`)
      writeFileSync(p, buildFcpxml(tl, { stemsEnabled }), 'utf8')
      result.files.fcpxml = p
    }
    if (list.includes('xmeml')) {
      const p = join(exportDir, `${stem}.fcp7.xml`)
      writeFileSync(p, buildXmeml(tl, { stemsEnabled }), 'utf8')
      result.files.xmeml = p
    }
    result.timeline = {
      fps: tl.fps,
      totalFrames: tl.totalFrames,
      clips: tl.clips.length,
      sceneMarkers: tl.markers.filter((m) => m.kind === 'scene').length,
      downbeatMarkers: tl.markers.filter((m) => m.kind === 'downbeat').length,
      dropMarkers: tl.markers.filter((m) => m.kind === 'drop').length,
      stems: tl.stems.map((s) => s.role),
      stemsEnabled: Boolean(stemsEnabled),
    }
  }

  const manifestPath = join(exportDir, 'export-manifest.json')
  writeFileSync(manifestPath, JSON.stringify({ ...result, exportedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8')
  result.files.manifest = manifestPath
  return result
}
