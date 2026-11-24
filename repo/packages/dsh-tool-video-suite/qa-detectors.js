/**
 * Temporal post-render QA detectors (photosensitive flash risk · frozen frames · unplanned jump cuts).
 *
 * One FFmpeg decode pass (downscaled to 320px) collects:
 *   - per-frame average luma (`signalstats` YAVG, printed via `metadata`)
 *   - a 16×16 luma grid per frame (rawvideo) for area-aware (≥25% of frame) flash detection
 *   - `freezedetect` freeze intervals
 *   - `scdet` hard-cut scores
 * The detectors themselves are pure functions so they can be unit-tested with synthetic arrays.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT, runCommandRedirected } from '../shared/index.js'

export const QA_GRID_SIZE = 16

export const DEFAULT_TEMPORAL_QA_OPTIONS = Object.freeze({
  // Harding-style strong transition: ≥ 20% of full-scale luma, concurrently on ≥ 25% of the frame
  flashDelta: 0.2,
  // WCAG 2.x "general flash" floor (10%) — only used for the warning tier
  flashSoftDelta: 0.1,
  flashAreaMin: 0.25,
  // The darker image of a flash pair must be below ~0.8 relative luminance (≈ 0.9 gamma-encoded luma)
  flashDarkMax: 0.9,
  maxFlashesPerSec: 3,
  freezeThresholdSec: 2.5,
  freezeNoise: '-60dB',
  scdetThreshold: 10,
  cutToleranceFrames: 2,
})

const round3 = (n) => Number(Number(n).toFixed(3))
const fmtSec = (s) => `${Number(s).toFixed(2)}s`

/**
 * Run the single FFmpeg analysis pass and return raw per-frame signals.
 */
export async function collectTemporalSignals({
  ffmpeg,
  mp4Path,
  durationSec = 0,
  freezeNoise = DEFAULT_TEMPORAL_QA_OPTIONS.freezeNoise,
  freezeMinSec = DEFAULT_TEMPORAL_QA_OPTIONS.freezeThresholdSec,
  scdetThreshold = DEFAULT_TEMPORAL_QA_OPTIONS.scdetThreshold,
  signal,
  timeoutMs,
} = {}) {
  const startedAt = Date.now()
  const tmpDir = join(REPO_ROOT, '.tmp')
  mkdirSync(tmpDir, { recursive: true })
  const gridPath = join(tmpDir, `qa-grid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.gray`)
  const g = QA_GRID_SIZE
  const safeFreezeSec = Math.max(0.2, Number(freezeMinSec) || DEFAULT_TEMPORAL_QA_OPTIONS.freezeThresholdSec)
  // Everything is converted to full-range (pc) luma first, so YAVG and the grid are 0–255 regardless of the
  // source range (Remotion emits yuvj420p/pc, the HTML engine yuv420p/tv).
  const graph = [
    '[0:v]scale=w=320:h=-2:flags=bilinear:out_range=pc,format=yuv420p,split=4[qy][qf][qs][qg]',
    // YAVG = frame luma (flash analysis); YDIF = mean |frame − previous frame| (picture activity)
    '[qy]signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG,metadata=mode=print:key=lavfi.signalstats.YDIF,nullsink',
    `[qf]freezedetect=n=${freezeNoise}:d=${safeFreezeSec},nullsink`,
    `[qs]scdet=threshold=${Number(scdetThreshold) || 10},nullsink`,
    `[qg]scale=w=${g}:h=${g}:flags=area:out_range=pc,format=gray[grid]`,
  ].join(';')
  const lumaFullRange = true

  let res
  try {
    res = await runCommandRedirected(
      ffmpeg,
      ['-hide_banner', '-nostats', '-threads', '4', '-i', mp4Path, '-an', '-sn', '-dn', '-filter_complex', graph, '-map', '[grid]', '-f', 'rawvideo', '-y', gridPath],
      { timeoutMs: timeoutMs || Math.max(120_000, Math.round((Number(durationSec) || 60) * 2500)), signal },
    )
  } catch (err) {
    try { unlinkSync(gridPath) } catch {}
    throw err
  }

  let gridBuf = Buffer.alloc(0)
  try {
    if (existsSync(gridPath)) gridBuf = readFileSync(gridPath)
  } finally {
    try { unlinkSync(gridPath) } catch {}
  }
  if (res.code !== 0 && gridBuf.length === 0) {
    throw new Error(`时序分析 FFmpeg 失败: ${String(res.stderr || '').slice(-600)}`)
  }

  const cells = g * g
  const gridFrames = Math.floor(gridBuf.length / cells)
  const log = `${res.stderr || ''}\n${res.stdout || ''}`
  const yavgByFrame = []
  const ydifByFrame = []
  const freezes = []
  const cuts = []
  let curFrame = -1
  let pendingFreezeStart = null
  for (const line of log.split(/\r?\n/)) {
    let m = /\bframe:(\d+)\s+pts:\S+\s+pts_time:/.exec(line)
    if (m) {
      curFrame = Number(m[1])
      continue
    }
    m = /lavfi\.signalstats\.YAVG=([-\d.eE+]+)/.exec(line)
    if (m) {
      if (curFrame >= 0) yavgByFrame[curFrame] = Number(m[1])
      continue
    }
    m = /lavfi\.signalstats\.YDIF=([-\d.eE+]+)/.exec(line)
    if (m) {
      if (curFrame >= 0) ydifByFrame[curFrame] = Number(m[1])
      continue
    }
    m = /lavfi\.freezedetect\.freeze_start:\s*([-\d.eE+]+)/.exec(line)
    if (m) {
      pendingFreezeStart = Number(m[1])
      continue
    }
    m = /lavfi\.freezedetect\.freeze_end:\s*([-\d.eE+]+)/.exec(line)
    if (m) {
      const end = Number(m[1])
      const start = pendingFreezeStart !== null ? pendingFreezeStart : end
      freezes.push({ startSec: round3(start), endSec: round3(end), durationSec: round3(Math.max(0, end - start)) })
      pendingFreezeStart = null
      continue
    }
    m = /lavfi\.scd\.score:\s*([-\d.eE+]+),\s*lavfi\.scd\.time:\s*([-\d.eE+]+)/.exec(line)
    if (m) cuts.push({ timeSec: round3(Number(m[2])), score: Number(Number(m[1]).toFixed(3)) })
  }
  const frameCount = Math.max(gridFrames, yavgByFrame.length)
  if (pendingFreezeStart !== null) {
    // Freeze still running at end of file (no freeze_end line printed)
    const end = Number(durationSec) > pendingFreezeStart ? Number(durationSec) : pendingFreezeStart
    freezes.push({ startSec: round3(pendingFreezeStart), endSec: round3(end), durationSec: round3(Math.max(0, end - pendingFreezeStart)), openEnded: true })
  }

  const yavg = new Float64Array(frameCount)
  const ydif = new Float64Array(frameCount)
  for (let i = 0; i < frameCount; i++) {
    const v = yavgByFrame[i]
    yavg[i] = Number.isFinite(v) ? normalizeLuma(v, lumaFullRange) : NaN
    const d = ydifByFrame[i]
    ydif[i] = Number.isFinite(d) ? d : NaN
  }

  return {
    frameCount,
    gridFrames,
    gridCells: cells,
    grid: new Uint8Array(gridBuf.buffer, gridBuf.byteOffset, gridFrames * cells),
    yavg,
    ydif,
    fullRange: lumaFullRange,
    freezes,
    cuts,
    analysisMs: Date.now() - startedAt,
  }
}

/** Map an 8-bit luma code value to 0..1 of full scale (limited 16–235 or full 0–255). */
export function normalizeLuma(v, fullRange = false) {
  const n = fullRange ? v / 255 : (v - 16) / 219
  return Math.max(0, Math.min(1, n))
}

/**
 * Harding-style extremum tracker: emits monotonic luminance runs (transitions) whose amplitude ≥ minAmp
 * and whose darker end lies below darkMax. Reversals smaller than `noise` do not split a run.
 */
export function trackLumaTransitions(getVal, n, { minAmp, noise, darkMax }, onTransition) {
  if (n < 2) return
  let dir = 0
  let anchorVal = getVal(0)
  let anchorIdx = 0
  let extVal = anchorVal
  let extIdx = 0
  const emit = (d, startIdx, endIdx, amp, darker) => {
    if (amp >= minAmp && darker < darkMax) onTransition(d, startIdx, endIdx, amp)
  }
  for (let i = 1; i < n; i++) {
    const v = getVal(i)
    if (!Number.isFinite(v)) continue
    if (dir === 0) {
      if (!Number.isFinite(anchorVal)) {
        anchorVal = v
        anchorIdx = i
        continue
      }
      if (v - anchorVal > noise) {
        dir = 1
        extVal = v
        extIdx = i
      } else if (anchorVal - v > noise) {
        dir = -1
        extVal = v
        extIdx = i
      }
      continue
    }
    if (dir === 1) {
      if (v > extVal) {
        extVal = v
        extIdx = i
      } else if (extVal - v > noise) {
        emit(1, anchorIdx, extIdx, extVal - anchorVal, anchorVal)
        anchorVal = extVal
        anchorIdx = extIdx
        dir = -1
        extVal = v
        extIdx = i
      }
    } else {
      if (v < extVal) {
        extVal = v
        extIdx = i
      } else if (v - extVal > noise) {
        emit(-1, anchorIdx, extIdx, anchorVal - extVal, extVal)
        anchorVal = extVal
        anchorIdx = extIdx
        dir = 1
        extVal = v
        extIdx = i
      }
    }
  }
  if (dir === 1) emit(1, anchorIdx, extIdx, extVal - anchorVal, anchorVal)
  else if (dir === -1) emit(-1, anchorIdx, extIdx, anchorVal - extVal, extVal)
}

function clusterAreaEvents(counts, ampMax, n, cells, areaMin, dir) {
  const thr = Math.max(1, areaMin * cells)
  const sum3 = (f) => (f > 0 ? counts[f - 1] : 0) + counts[f] + (f + 1 < n ? counts[f + 1] : 0)
  const amp3 = (f) => Math.max(f > 0 ? ampMax[f - 1] : 0, ampMax[f], f + 1 < n ? ampMax[f + 1] : 0)
  const out = []
  let f = 0
  while (f < n) {
    const s = sum3(f)
    if (s < thr) {
      f++
      continue
    }
    // Threshold on the 3-frame area sum, but place the event on the single frame where most cells peaked
    let best = f
    let bestS = s
    let peakFrame = f
    let g = f
    while (g < n) {
      const sg = sum3(g)
      if (sg < thr) break
      if (sg > bestS) {
        bestS = sg
        best = g
      }
      if (counts[g] > counts[peakFrame]) peakFrame = g
      g++
    }
    out.push({ frame: peakFrame, dir, area: Math.min(1, bestS / cells), amp: amp3(best) })
    f = g + 1
  }
  return out
}

function countFlashPairs(evs) {
  let pairs = 0
  for (let k = 0; k + 1 < evs.length; ) {
    if (evs[k].dir !== evs[k + 1].dir) {
      pairs++
      k += 2
    } else {
      k++
    }
  }
  return pairs
}

/**
 * Area-aware transition events for one amplitude tier.
 */
export function extractFlashEvents({ grid, gridCells, frameCount, yavg, fullRange = true, minAmp, areaMin, darkMax }) {
  const n = Math.max(0, Number(frameCount) || 0)
  const noise = Math.max(0.01, minAmp / 4)
  const opts = { minAmp, noise, darkMax }
  const events = []
  const hasGrid = grid && gridCells > 0 && grid.length >= n * gridCells && n > 1
  if (hasGrid) {
    const up = new Float64Array(n)
    const down = new Float64Array(n)
    const upAmp = new Float64Array(n)
    const downAmp = new Float64Array(n)
    for (let c = 0; c < gridCells; c++) {
      trackLumaTransitions(
        (f) => normalizeLuma(grid[f * gridCells + c], fullRange),
        n,
        opts,
        (d, _s, endIdx, amp) => {
          if (d > 0) {
            up[endIdx] += 1
            if (amp > upAmp[endIdx]) upAmp[endIdx] = amp
          } else {
            down[endIdx] += 1
            if (amp > downAmp[endIdx]) downAmp[endIdx] = amp
          }
        },
      )
    }
    events.push(...clusterAreaEvents(up, upAmp, n, gridCells, areaMin, 1))
    events.push(...clusterAreaEvents(down, downAmp, n, gridCells, areaMin, -1))
  } else if (yavg && yavg.length > 1) {
    // Fallback: global average luma only (a ≥ minAmp swing of the mean implies ≥ minAmp of the frame changed)
    trackLumaTransitions((f) => yavg[f], Math.min(n || yavg.length, yavg.length), opts, (d, _s, endIdx, amp) => {
      events.push({ frame: endIdx, dir: d, area: null, amp })
    })
  }
  events.sort((a, b) => a.frame - b.frame || a.dir - b.dir)
  if (yavg && yavg.length > 0) {
    for (const ev of events) {
      let lo = Infinity
      let hi = -Infinity
      for (let k = Math.max(0, ev.frame - 3); k <= Math.min(yavg.length - 1, ev.frame + 3); k++) {
        const v = yavg[k]
        if (!Number.isFinite(v)) continue
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      ev.lumaSwing = Number.isFinite(hi - lo) ? round3(hi - lo) : null
    }
  }
  return events
}

function evaluateFlashWindows(events, fps, maxPerSec) {
  const winFrames = Math.max(1, Math.round(fps))
  const windows = []
  let maxFlashes = 0
  for (let i = 0; i < events.length; i++) {
    const startF = events[i].frame
    const inWin = []
    for (let j = i; j < events.length && events[j].frame < startF + winFrames; j++) inWin.push(events[j])
    const flashes = countFlashPairs(inWin)
    if (flashes > maxFlashes) maxFlashes = flashes
    if (flashes >= maxPerSec) {
      windows.push({
        startFrame: startF,
        endFrame: inWin[inWin.length - 1].frame,
        flashes,
        transitions: inWin.length,
        maxAreaPct: inWin.some((e) => e.area !== null) ? Math.round(Math.max(...inWin.map((e) => e.area || 0)) * 100) : null,
        maxAmp: round3(Math.max(...inWin.map((e) => e.amp || 0))),
        maxLumaSwing: round3(Math.max(0, ...inWin.map((e) => e.lumaSwing || 0))),
      })
    }
  }
  return { windows, maxFlashes }
}

function pickWorstWindows(windows, limit = 5) {
  const sorted = [...windows].sort((a, b) => b.flashes - a.flashes || b.maxAmp - a.maxAmp || a.startFrame - b.startFrame)
  const picked = []
  for (const w of sorted) {
    if (picked.some((p) => w.startFrame <= p.endFrame && w.endFrame >= p.startFrame)) continue
    picked.push(w)
    if (picked.length >= limit) break
  }
  return picked.sort((a, b) => a.startFrame - b.startFrame)
}

/**
 * Photosensitive flash-risk evaluation (WCAG 2.x / ITU-R BT.1702 "no more than 3 flashes in any 1-second window").
 * - fail: any 1 s window with > 3 strong flashes (≥ flashDelta luma swing on ≥ 25% of the frame)
 * - warning: exactly 3 strong flashes in a window (at the limit), or > 3 softer (10–20%) flashes
 */
export function detectPhotosensitiveFlashes({
  grid,
  gridCells = QA_GRID_SIZE * QA_GRID_SIZE,
  frameCount,
  yavg,
  fps = 30,
  fullRange = true,
  intentionalTimes = [],
  options = {},
} = {}) {
  const o = { ...DEFAULT_TEMPORAL_QA_OPTIONS, ...options }
  const safeFps = Number(fps) > 0 ? Number(fps) : 30
  const n = Math.max(0, Number(frameCount) || (yavg ? yavg.length : 0))
  const common = { grid, gridCells, frameCount: n, yavg, fullRange, areaMin: o.flashAreaMin, darkMax: o.flashDarkMax }
  const strongEvents = extractFlashEvents({ ...common, minAmp: o.flashDelta })
  const softEvents = extractFlashEvents({ ...common, minAmp: o.flashSoftDelta })
  const strong = evaluateFlashWindows(strongEvents, safeFps, o.maxFlashesPerSec)
  const soft = evaluateFlashWindows(softEvents, safeFps, o.maxFlashesPerSec)

  const intentional = (intentionalTimes || []).filter((t) => Number.isFinite(Number(t))).map(Number)
  const isIntentional = (w) => {
    const a = w.startFrame / safeFps - 0.2
    const b = (w.endFrame + 1) / safeFps + 0.2
    return intentional.some((t) => t >= a && t <= b)
  }
  const decorate = (w, tier) => {
    const level =
      tier === 'strong'
        ? w.flashes > o.maxFlashesPerSec
          ? 'fail'
          : 'warning'
        : w.flashes > o.maxFlashesPerSec
          ? 'warning'
          : 'pass'
    return {
      startSec: round3(w.startFrame / safeFps),
      endSec: round3((w.endFrame + 1) / safeFps),
      flashesPerSec: w.flashes,
      transitions: w.transitions,
      maxAreaPct: w.maxAreaPct,
      maxLumaDeltaPct: Math.round(w.maxAmp * 100),
      maxFrameLumaSwingPct: Math.round(w.maxLumaSwing * 100),
      tier,
      level,
      intentional: isIntentional(w),
    }
  }

  const strongWorst = pickWorstWindows(strong.windows).map((w) => decorate(w, 'strong'))
  const softOver = soft.windows.filter((w) => w.flashes > o.maxFlashesPerSec)
  const softWorst = strong.maxFlashes > o.maxFlashesPerSec ? [] : pickWorstWindows(softOver).map((w) => decorate(w, 'soft'))
  const severity =
    strong.maxFlashes > o.maxFlashesPerSec
      ? 'fail'
      : strong.maxFlashes === o.maxFlashesPerSec || soft.maxFlashes > o.maxFlashesPerSec
        ? 'warning'
        : 'pass'

  return {
    severity,
    maxFlashesPerSec: strong.maxFlashes,
    softMaxFlashesPerSec: soft.maxFlashes,
    strongTransitionCount: strongEvents.length,
    softTransitionCount: softEvents.length,
    worstWindows: [...strongWorst, ...softWorst].sort((a, b) => a.startSec - b.startSec),
    transitions: strongEvents.slice(0, 400).map((e) => ({
      frame: e.frame,
      timeSec: round3(e.frame / safeFps),
      dir: e.dir > 0 ? 'up' : 'down',
      areaPct: e.area === null ? null : Math.round(e.area * 100),
      lumaDeltaPct: Math.round(e.amp * 100),
    })),
    softTransitionFrames: softEvents.map((e) => e.frame),
    method: grid && grid.length ? 'grid16x16+signalstats' : 'signalstats-yavg',
    thresholds: {
      lumaDeltaPct: Math.round(o.flashDelta * 100),
      softLumaDeltaPct: Math.round(o.flashSoftDelta * 100),
      minAreaPct: Math.round(o.flashAreaMin * 100),
      maxFlashesPerSec: o.maxFlashesPerSec,
    },
  }
}

const STATIC_SCENE_TOKENS = new Set(['hold', 'static', 'still', 'freeze', 'freeze_end', 'freeze-end', 'locked', 'fixed', 'none', 'off', 'static-hold'])

/** Whether the planned shot list marks a scene as an intentional static hold (frozen frames allowed). */
export function isPlannedStaticScene(scene) {
  if (!scene || typeof scene !== 'object') return false
  if ([scene.staticHold, scene.hold, scene.freeze, scene.isStatic, scene.static].some((v) => v === true)) return true
  if (scene.qa && typeof scene.qa === 'object' && (scene.qa.allowFreeze === true || scene.qa.staticHold === true)) return true
  for (const key of ['recipe', 'kenBurns', 'camera', 'cameraMove', 'motion', 'shotType']) {
    const raw = scene[key]
    const val = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? raw.type || raw.kind || raw.mode || '' : ''
    if (STATIC_SCENE_TOKENS.has(String(val).trim().toLowerCase())) return true
  }
  return false
}

/**
 * Normalized scene timeline in frames & seconds (prefers exact `startFrame`/`durationInFrames`).
 */
export function buildSceneTimeline(script, fps = 30) {
  const safeFps = Number(fps) > 0 ? Number(fps) : Number(script?.fps) || 30
  const scenes = Array.isArray(script?.scenes) ? script.scenes : []
  const out = []
  let cursorFrame = 0
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i] || {}
    const startFrame = Number.isFinite(Number(sc.startFrame))
      ? Math.max(0, Math.round(Number(sc.startFrame)))
      : Number.isFinite(Number(sc.startSec))
        ? Math.max(0, Math.round(Number(sc.startSec) * safeFps))
        : cursorFrame
    const durFrames =
      Number(sc.durationInFrames) > 0
        ? Math.round(Number(sc.durationInFrames))
        : Math.max(1, Math.round((Number(sc.durationSec) || 4) * safeFps))
    out.push({
      index: i,
      id: sc.id || `scene-${String(i + 1).padStart(2, '0')}`,
      title: sc.title || '',
      startFrame,
      endFrame: startFrame + durFrames,
      startSec: round3(startFrame / safeFps),
      endSec: round3((startFrame + durFrames) / safeFps),
      transition: sc.transition || '',
      scene: sc,
    })
    cursorFrame = startFrame + durFrames
  }
  return out
}

/**
 * Times (seconds) of intentional flashes / impacts declared by the plan: sword-clash action events and flash-style cuts.
 */
export function collectIntentionalImpactTimes(script, timeline = null) {
  const fps = Number(script?.fps) || 30
  const tl = timeline || buildSceneTimeline(script, fps)
  const times = []
  for (const row of tl) {
    const sc = row.scene || {}
    for (const ev of Array.isArray(sc.actionEvents) ? sc.actionEvents : []) {
      const tag = `${ev?.kind || ''} ${ev?.role || ''}`
      if (!/clash|impact|flash|hit|strike|slash|stab|explo|boom/i.test(tag)) continue
      const t = Number.isFinite(Number(ev.hitSec))
        ? Number(ev.hitSec)
        : Number.isFinite(Number(ev.absSec))
          ? Number(ev.absSec)
          : row.startSec + (Number(ev.offsetSec) || 0)
      if (Number.isFinite(t)) times.push(round3(t))
    }
    if (row.index > 0 && /flash|white|strobe|punch|impact|glitch/i.test(String(row.transition || ''))) {
      times.push(row.startSec)
    }
  }
  return [...new Set(times)].sort((a, b) => a - b)
}

function mergeIntervals(list) {
  const sorted = list.filter((iv) => iv.end > iv.start).sort((a, b) => a.start - b.start)
  const out = []
  for (const iv of sorted) {
    const last = out[out.length - 1]
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end)
    else out.push({ ...iv })
  }
  return out
}

function overlapSec(a0, a1, intervals) {
  let sum = 0
  for (const iv of intervals) {
    const lo = Math.max(a0, iv.start)
    const hi = Math.min(a1, iv.end)
    if (hi > lo) sum += hi - lo
  }
  return sum
}

/**
 * Frozen-frame analysis: freezes longer than `thresholdSec` that the planned shot list does not explain.
 */
export function analyzeFrozenFrames({ freezes = [], timeline = [], totalSec = 0, thresholdSec = 2.5, allowedIntervals = [] } = {}) {
  const pad = 0.15
  const planned = mergeIntervals([
    ...timeline.filter((r) => isPlannedStaticScene(r.scene)).map((r) => ({ start: r.startSec - pad, end: r.endSec + pad })),
    ...(Array.isArray(allowedIntervals) ? allowedIntervals : [])
      .map((iv) => ({ start: Number(iv?.startSec ?? iv?.start) - pad, end: Number(iv?.endSec ?? iv?.end) + pad }))
      .filter((iv) => Number.isFinite(iv.start) && Number.isFinite(iv.end)),
  ])
  const items = freezes.map((fz) => {
    const start = Number(fz.startSec) || 0
    const end = Number(fz.endSec) || start
    const dur = Math.max(0, end - start)
    const covered = Math.min(dur, overlapSec(start, end, planned))
    const unexplained = round3(Math.max(0, dur - covered))
    // Ignore edge overlaps of a frame or two (freezedetect starts on the last moving frame)
    const minOverlap = Math.min(0.25, dur * 0.1)
    const scenes = timeline.filter((r) => Math.min(end, r.endSec) - Math.max(start, r.startSec) >= minOverlap)
    return {
      startSec: round3(start),
      endSec: round3(end),
      durationSec: round3(dur),
      unexplainedSec: unexplained,
      explained: unexplained < thresholdSec,
      sceneIds: scenes.map((r) => r.id),
      plannedStaticSceneIds: scenes.filter((r) => isPlannedStaticScene(r.scene)).map((r) => r.id),
    }
  })
  const unexplained = items.filter((it) => !it.explained && it.durationSec >= thresholdSec)
  const unexplainedTotal = unexplained.reduce((a, it) => a + it.unexplainedSec, 0)
  const severity = unexplained.length === 0 ? 'pass' : totalSec > 0 && unexplainedTotal > totalSec * 0.4 ? 'fail' : 'warning'
  return {
    severity,
    thresholdSec,
    freezes: items,
    unexplained,
    unexplainedTotalSec: round3(unexplainedTotal),
    plannedStaticSceneIds: timeline.filter((r) => isPlannedStaticScene(r.scene)).map((r) => r.id),
  }
}

/**
 * Frame-difference spike detector for 1–`maxBurst`-frame foreign bursts (A → X → A): both edges jump by at least
 * `minJump` (mean absolute luma difference on the 16×16 grid, 0–1) while the frames before and after the burst match.
 * This catches the classic single bad frame that `scdet` misses — scdet scores min(mafd, |mafd − prev_mafd|),
 * so the second, equally large edge of a one-frame glitch is suppressed.
 */
export function detectOutlierFrameBursts({ grid, gridCells = QA_GRID_SIZE * QA_GRID_SIZE, frameCount, maxBurst = 2, minJump = 0.08, returnRatio = 3 } = {}) {
  const n = Math.max(0, Number(frameCount) || 0)
  const cells = gridCells
  if (!grid || n < 3 || grid.length < n * cells) return []
  const mad = (a, b) => {
    let s = 0
    const oa = a * cells
    const ob = b * cells
    for (let c = 0; c < cells; c++) s += Math.abs(grid[oa + c] - grid[ob + c])
    return s / cells / 255
  }
  const step = new Float64Array(n)
  for (let f = 1; f < n; f++) step[f] = mad(f - 1, f)
  const out = []
  for (let f = 1; f < n - 1; f++) {
    if (step[f] < minJump) continue
    for (let k = 1; k <= maxBurst && f + k < n; k++) {
      const into = step[f]
      const outOf = step[f + k]
      if (outOf < minJump) continue
      const across = mad(f - 1, f + k)
      if (across * returnRatio <= Math.min(into, outOf)) {
        out.push({ frame: f, frames: k, into: round3(into), outOf: round3(outOf), across: round3(across) })
        f += k
        break
      }
    }
  }
  return out
}

/**
 * Hard-cut / glitch analysis: `scdet` cuts not within ±toleranceFrames of a planned scene boundary.
 * Cuts explained by detected flashes or declared impacts (sword clashes) are reported separately.
 */
export function analyzeJumpCuts({ cuts = [], timeline = [], fps = 30, flashFrames = [], impactTimes = [], outlierBursts = [], toleranceFrames = 2 } = {}) {
  const safeFps = Number(fps) > 0 ? Number(fps) : 30
  const tol = Math.max(0, Math.round(Number(toleranceFrames) || 0))
  const boundaries = timeline.filter((r) => r.index > 0).map((r) => r.startFrame)
  const impactFrames = (impactTimes || []).map((t) => Math.round(Number(t) * safeFps)).filter(Number.isFinite)
  const near = (frame, list, d) => list.some((b) => Math.abs(frame - b) <= d)
  // planned scene cut → declared impact/flash-cut → undeclared luminance flash → unplanned jump
  const classified = cuts
    .map((c) => {
      const frame = Math.round(Number(c.timeSec) * safeFps)
      let kind = 'unplanned'
      if (near(frame, boundaries, tol)) kind = 'planned'
      else if (near(frame, impactFrames, tol + 1)) kind = 'impact'
      else if (near(frame, flashFrames, tol)) kind = 'flash'
      return { timeSec: round3(Number(c.timeSec)), frame, score: c.score, kind }
    })
    .sort((a, b) => a.frame - b.frame)
  const unplanned = classified.filter((c) => c.kind === 'unplanned')
  // A 1–3 frame burst (cut in + cut out) that the plan does not explain is the classic render glitch:
  // blank/white/foreign frame. Undeclared flashes are included because a glitch frame usually changes luminance too.
  const suspects = classified.filter((c) => c.kind === 'unplanned' || c.kind === 'flash')
  const glitches = []
  for (let i = 0; i + 1 < suspects.length; i++) {
    const a = suspects[i]
    const b = suspects[i + 1]
    if (b.frame - a.frame <= 3) {
      glitches.push({
        startSec: a.timeSec,
        endSec: round3((b.frame + 1) / safeFps),
        startFrame: a.frame,
        frames: b.frame - a.frame,
        scores: [a.score, b.score],
        kinds: [a.kind, b.kind],
        source: 'scdet',
      })
      i++
    }
  }
  // Foreign 1–2 frame bursts from the luma-grid frame-difference spikes (not explained by a cut or declared impact)
  for (const ob of outlierBursts || []) {
    const f = Number(ob.frame)
    const k = Math.max(1, Number(ob.frames) || 1)
    if (!Number.isFinite(f)) continue
    if (near(f, boundaries, tol) || near(f + k, boundaries, tol)) continue
    if (near(f, impactFrames, tol + 1)) continue
    if (glitches.some((gl) => Math.abs(gl.startFrame - f) <= 2)) continue
    glitches.push({
      startSec: round3(f / safeFps),
      endSec: round3((f + k) / safeFps),
      startFrame: f,
      frames: k,
      scores: [],
      kinds: ['frame-diff'],
      source: 'frame-diff',
      jumpPct: Math.round(Math.min(ob.into, ob.outOf) * 100),
      returnPct: Math.round(ob.across * 100),
    })
  }
  glitches.sort((x, y) => x.startFrame - y.startFrame)
  const count = (k) => classified.filter((c) => c.kind === k).length
  return {
    severity: unplanned.length > 0 || glitches.length > 0 ? 'warning' : 'pass',
    toleranceFrames: tol,
    totalCuts: classified.length,
    plannedCount: count('planned'),
    flashCount: count('flash'),
    impactCount: count('impact'),
    unplanned,
    glitchCandidates: glitches,
    plannedBoundaryCount: boundaries.length,
  }
}

const listSecs = (arr, pick, max = 6) => {
  const head = arr.slice(0, max).map(pick).join('、')
  return arr.length > max ? `${head} 等 ${arr.length} 处` : head
}

/** Build the three Chinese QA check rows (name/passed/value/severity) from detector results. */
/**
 * Seconds whose average frame-to-frame change (full-range luma, 320 px, cut frames excluded) is below this read as
 * "nothing moves". Calibrated on rendered films: a calm shot whose figure breathes / turns its head over drifting
 * particles measures 0.22–0.26, the frozen second halves of the 6th 项羽 run 0.11–0.17.
 */
export const NEAR_STILL_YDIF = 0.2
/** More than this share of near-still seconds turns the picture-activity entry into a warning (never a failure). */
export const NEAR_STILL_WARN_RATIO = 0.2

/**
 * Picture activity: per-second mean |frame − previous frame| (YDIF) without the cut frames (a cut changes the whole
 * frame and would hide a frozen second), the near-still seconds and where they cluster (runs of ≥ 2 s, with the shots
 * they belong to). A hint for static stretches, not a pass/fail criterion.
 */
export function analyzeMotionActivity({ ydif, fps = 30, timeline = [], cutTimes = [], threshold = NEAR_STILL_YDIF } = {}) {
  const n = ydif?.length || 0
  const f = Math.max(1, Math.round(Number(fps) || 30))
  const skip = new Set()
  const tl = Array.isArray(timeline) ? timeline : []
  for (const t of tl) {
    const sf = Number.isFinite(Number(t.startFrame)) ? Number(t.startFrame) : Math.round(Number(t.startSec || 0) * f)
    for (let k = -1; k <= 1; k++) skip.add(sf + k)
  }
  for (const c of Array.isArray(cutTimes) ? cutTimes : []) {
    const cf = Math.round(Number(c) * f)
    for (let k = -1; k <= 1; k++) skip.add(cf + k)
  }
  const perSec = []
  for (let s = 0; s * f < n; s++) {
    let sum = 0
    let cnt = 0
    for (let i = s * f; i < Math.min(n, (s + 1) * f); i++) {
      if (i === 0 || skip.has(i) || !Number.isFinite(ydif[i])) continue
      sum += ydif[i]
      cnt++
    }
    perSec.push(cnt ? Number((sum / cnt).toFixed(3)) : null)
  }
  const measured = perSec.filter((v) => v !== null)
  const still = perSec.map((v) => v !== null && v < threshold)
  const ranges = []
  for (let s = 0; s < still.length; s++) {
    if (!still[s]) continue
    let e = s
    while (e + 1 < still.length && still[e + 1]) e++
    if (e - s + 1 >= 2) {
      const sceneIds = tl.filter((t) => t.startSec < e + 1 && t.endSec > s).map((t) => t.id)
      ranges.push({ startSec: s, endSec: e + 1, durationSec: e - s + 1, sceneIds })
    }
    s = e
  }
  const sorted = [...measured].sort((a, b) => a - b)
  return {
    threshold,
    totalSec: measured.length,
    nearStillSec: still.filter(Boolean).length,
    medianPerSec: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    perSec,
    ranges,
  }
}

export function buildTemporalQaChecks({ flash, freeze, jumps, motion }) {
  const checks = []
  if (flash) {
    const t = flash.thresholds
    const worst = flash.worstWindows.filter((w) => w.level !== 'pass')
    const desc = (w) => `${fmtSec(w.startSec)}–${fmtSec(w.endSec)} ${w.flashesPerSec}次/秒${w.maxAreaPct !== null ? `·面积${w.maxAreaPct}%` : ''}${w.intentional ? '(含剧情闪白)' : ''}`
    let value
    if (flash.severity === 'fail') {
      value = `✕ 超标：${listSecs(worst.filter((w) => w.level === 'fail'), desc, 4)}（任意 1 秒内 > ${t.maxFlashesPerSec} 次强闪烁，亮度跳变 ≥${t.lumaDeltaPct}% 且面积 ≥${t.minAreaPct}%）；请拉开闪白间隔或把闪白强度降到 ${t.lumaDeltaPct}% 以下`
    } else if (flash.severity === 'warning') {
      value = `⚠ 警告：${listSecs(worst, desc, 4)}（已达 ${t.maxFlashesPerSec} 次/秒上限或存在 ${t.softLumaDeltaPct}–${t.lumaDeltaPct}% 中等强度频闪），建议适当拉开闪白节奏`
    } else {
      value = `最高 ${flash.maxFlashesPerSec} 次强闪烁/秒 (上限 ${t.maxFlashesPerSec} 次/秒，亮度跳变 ≥${t.lumaDeltaPct}% 且面积 ≥${t.minAreaPct}%)，无光敏癫痫风险`
    }
    checks.push({ name: '光敏癫痫闪烁风险 (WCAG/Harding ≤3次/秒)', passed: flash.severity !== 'fail', severity: flash.severity, value })
  }
  if (freeze) {
    const desc = (f) => `${fmtSec(f.startSec)}–${fmtSec(f.endSec)}(${f.durationSec.toFixed(1)}s${f.sceneIds.length ? `·${f.sceneIds.slice(0, 2).join('/')}` : ''})`
    const explainedCount = freeze.freezes.length - freeze.unexplained.length
    const value =
      freeze.severity === 'pass'
        ? freeze.freezes.length === 0
          ? `全片无 > ${freeze.thresholdSec}s 的冻结画面`
          : `检测到 ${freeze.freezes.length} 处静止画面，均属计划内定格镜头`
        : `${freeze.severity === 'fail' ? '✕ 大面积冻结' : '⚠ 警告'}：计划外冻结 ${listSecs(freeze.unexplained, desc, 4)}${explainedCount > 0 ? `；另有 ${explainedCount} 处计划内定格` : ''}（> ${freeze.thresholdSec}s，可能是动画卡死/素材未加载）`
    checks.push({ name: `冻结帧检测 (freezedetect > ${freeze.thresholdSec}s)`, passed: freeze.severity !== 'fail', severity: freeze.severity, value })
  }
  if (jumps) {
    const extra = [
      jumps.flashCount ? `闪白 ${jumps.flashCount}` : '',
      jumps.impactCount ? `动作冲击 ${jumps.impactCount}` : '',
    ].filter(Boolean).join(' / ')
    const problems = [
      jumps.unplanned.length ? `${jumps.unplanned.length} 处计划外跳切 ${listSecs(jumps.unplanned, (c) => fmtSec(c.timeSec), 6)}` : '',
      jumps.glitchCandidates.length ? `疑似单帧坏帧/未声明闪帧 ${listSecs(jumps.glitchCandidates, (g) => `${fmtSec(g.startSec)}(${g.frames}帧)`, 4)}` : '',
    ].filter(Boolean).join('；')
    const value =
      jumps.severity === 'pass'
        ? `检测到 ${jumps.totalCuts} 处硬切，均可由分镜切点 ±${jumps.toleranceFrames} 帧或计划内冲击/闪白解释${extra ? `（${extra}）` : ''}`
        : `⚠ 警告：${problems}（计划内 ${jumps.plannedCount}${extra ? ` / ${extra}` : ''}）`
    checks.push({ name: `跳帧/渲染故障检测 (scdet + 帧差离群 · 分镜外 ±${jumps.toleranceFrames} 帧)`, passed: true, severity: jumps.severity, value })
  }
  if (motion && motion.totalSec > 0) {
    const ratio = motion.nearStillSec / motion.totalSec
    const where = motion.ranges.length
      ? `，集中在 ${listSecs(motion.ranges, (r) => `${fmtSec(r.startSec)}–${fmtSec(r.endSec)}${r.sceneIds.length ? `(${r.sceneIds.slice(0, 2).join('/')})` : ''}`, 4)}`
      : ''
    checks.push({
      name: '画面动势（几乎不动的秒数）',
      passed: true,
      severity: ratio > NEAR_STILL_WARN_RATIO ? 'warning' : 'pass',
      value: `几乎不动 ${motion.nearStillSec}/${motion.totalSec} 秒${where}${ratio > NEAR_STILL_WARN_RATIO ? '；这些地方除了缓慢运镜几乎没有元素在动（入场动画做完就定住），画面显得呆板' : ''}`,
    })
  }
  return checks
}
