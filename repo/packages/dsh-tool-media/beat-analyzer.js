/**
 * Audio Beat, Downbeat & Energy-Drop Analyzer + Beat-Locked Scene/SFX Quantizer.
 * Decodes any user BGM (`.mp3`, `.wav`, `.m4a`, `.flac`, `.ogg`, video soundtracks) with FFmpeg and runs the
 * precision spectral-flux tracker (`beat-tracker-core.js`) for tempo, phase, downbeats, drops and onsets.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { REPO_ROOT, resolveBinaries, runCommandRedirected } from '../shared/index.js'
import { analyzeBeatsFromSamples, BT_SR } from './beat-tracker-core.js'
import { isHistoricalContent } from './genre-router.js'

/**
 * Analyze actual BPM, beat phase, bar downbeats, structural drops and strong musical onsets of an audio file.
 *
 * Uses the precision spectral-flux tracker in `beat-tracker-core.js` (22.05 kHz, 5.8 ms hop, calibrated
 * attack offset, tempo-octave correction, drift-smoothed grid). Output shape is backward compatible:
 * { bpm, beatSec, phaseSec, barOffset, beats[{time,strong,isDrop,index,barIndex,beatInBar,energy}], downbeats,
 *   drops, energyCurve } plus { onsets, tempoStable, gridSupport, barConfidence, analyzer }.
 */
export async function analyzeAudioBeatStructure(audioPath, opts = {}) {
  const absAudio = resolve(audioPath)
  if (!existsSync(absAudio)) {
    throw new Error(`BGM audio file not found for beat analysis: ${absAudio}`)
  }

  const minBpm = Math.max(50, Number(opts.minBpm) || 60)
  const maxBpm = Math.min(200, Number(opts.maxBpm) || 180)
  const { ffmpeg } = resolveBinaries()
  const tmpDir = join(REPO_ROOT, '.tmp')
  mkdirSync(tmpDir, { recursive: true })
  const rawPcm = join(tmpDir, `beat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.f32`)

  let samples
  try {
    const res = await runCommandRedirected(
      ffmpeg,
      ['-y', '-v', 'error', '-i', absAudio, '-vn', '-ac', '1', '-ar', String(BT_SR), '-f', 'f32le', rawPcm],
      { timeoutMs: 90_000, signal: opts.signal },
    )
    if (res.code !== 0 || !existsSync(rawPcm)) {
      throw new Error(`FFmpeg beat decode failed: ${res.stderr || `code ${res.code}`}`)
    }
    const buf = readFileSync(rawPcm)
    samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
  } finally {
    try {
      if (existsSync(rawPcm)) unlinkSync(rawPcm)
    } catch {}
  }

  const totalDurSec = Number((samples.length / BT_SR).toFixed(4))
  const analyzed = analyzeBeatsFromSamples(samples, { minBpm, maxBpm })
  if (!analyzed || !Array.isArray(analyzed.beats) || analyzed.beats.length < 2) {
    return {
      ok: true,
      analyzed: true,
      analyzer: 'spectral-flux-v2',
      audioPath: absAudio,
      durationSec: totalDurSec,
      bpm: 112,
      beatSec: Number((60 / 112).toFixed(4)),
      phaseSec: 0,
      barOffset: 0,
      beats: [{ time: 0, strong: true, isDrop: false, index: 0, barIndex: 0, beatInBar: 0, energy: 1 }],
      downbeats: [0],
      drops: [],
      energyCurve: [],
      onsets: [],
      tempoStable: false,
    }
  }

  return {
    ok: true,
    analyzed: true,
    analyzer: 'spectral-flux-v2',
    audioPath: absAudio,
    durationSec: totalDurSec,
    bpm: analyzed.bpm,
    beatSec: Number(analyzed.beatSec.toFixed(4)),
    phaseSec: analyzed.phaseSec,
    barOffset: analyzed.barOffset,
    barConfidence: analyzed.barConfidence,
    tempoStable: analyzed.tempoStable,
    gridSupport: analyzed.gridSupport,
    tempoCandidates: analyzed.tempoCandidates,
    beats: analyzed.beats,
    downbeats: analyzed.downbeats,
    drops: analyzed.drops,
    energyCurve: analyzed.energyCurve,
    onsets: analyzed.onsets,
  }
}

/**
 * Find the best matching beat/downbeat timestamp near or at/after a target time.
 */
export function snapTimeToBeatGrid(targetSec, beatMeta, { preferDownbeat = true, direction = 'forward', maxShiftSec = 1.8 } = {}) {
  const beats = Array.isArray(beatMeta?.beats) ? beatMeta.beats : []
  if (beats.length === 0) return Number(targetSec.toFixed(4))

  const pool = preferDownbeat ? beats.filter((b) => b.strong) : beats
  const searchList = pool.length > 0 ? pool : beats

  if (direction === 'nearest') {
    let best = targetSec
    let bestDiff = Infinity
    for (const b of searchList) {
      const t = typeof b === 'number' ? b : Number(b.time)
      const diff = Math.abs(t - targetSec)
      if (diff <= maxShiftSec && diff < bestDiff) {
        bestDiff = diff
        best = t
      }
    }
    return Number(best.toFixed(4))
  }

  for (const b of searchList) {
    const t = typeof b === 'number' ? b : Number(b.time)
    if (t >= targetSec - 0.04 && t - targetSec <= maxShiftSec) {
      return Number(t.toFixed(4))
    }
  }
  if (preferDownbeat) {
    return snapTimeToBeatGrid(targetSec, beatMeta, { preferDownbeat: false, direction, maxShiftSec })
  }
  return Number(targetSec.toFixed(4))
}

/**
 * Quantize scenes & subtitles cleanly to measured BGM beat timestamps.
 * - `subtitle-mv`: scene cut points align cleanly to beat/downbeat boundaries matching total duration / beatCounts.
 * - `tts-beat-sync`: preserves spoken speech duration and pads trailing silence cleanly to the next musical beat/downbeat.
 */
export function quantizeScenesToBeatGrid(scenes = [], beatMeta = {}, opts = {}) {
  const { mode = 'tts-beat-sync', fps = 30, targetDurationSec = 0, planBpm = 0 } = opts || {}
  if (!Array.isArray(scenes) || scenes.length === 0) return []
  const beats = Array.isArray(beatMeta?.beats) && beatMeta.beats.length > 0 ? beatMeta.beats : []
  const beatStep = Number(beatMeta?.beatSec) || (60 / (Number(beatMeta?.bpm) || 112))
  const safeFps = Number(fps) > 0 ? Number(fps) : 30

  if (beats.length === 0) return scenes

  const normBeats = beats
    .map((b, i) => (typeof b === 'number' ? { time: b, strong: i % 4 === 0, index: i } : b))
    .filter((b) => Number.isFinite(Number(b?.time)))
    .sort((a, b) => a.time - b.time)

  const maxBgmDur = Number(beatMeta?.durationSec) || normBeats[normBeats.length - 1]?.time || 60
  // NEVER clamp user's targetDurationSec down to a shorter BGM file!
  // BGM loops seamlessly in FFmpeg (`-stream_loop -1`), so extend the beat grid to cover targetDurationSec.
  const capDur = targetDurationSec > 4 ? targetDurationSec : maxBgmDur
  if (normBeats.length > 0 && normBeats[normBeats.length - 1].time < capDur + 4) {
    const barOffset = Number(beatMeta?.barOffset) || 0
    let lastT = normBeats[normBeats.length - 1].time
    let nextIdx = (Number(normBeats[normBeats.length - 1].index) || normBeats.length - 1) + 1
    while (lastT < capDur + 4) {
      lastT = Number((lastT + beatStep).toFixed(4))
      normBeats.push({
        time: lastT,
        strong: (nextIdx - barOffset + 4000) % 4 === 0,
        index: nextIdx,
      })
      nextIdx++
    }
  }

  const updated = scenes.map((s) => ({ ...s }))
  const audioProf = resolveAdaptiveAudioProfile(opts)
  const allowBlitzCut = audioProf.blitzAllowed !== false
  const minBeatSpan = Math.max(0.5, Number(audioProf.minBeatMultiple) || (allowBlitzCut ? 0.5 : 1.0))

  if (mode === 'subtitle-mv') {
    const usableBeats = normBeats.filter((b) => b.time <= capDur + 0.1)
    const fallbackBeats = usableBeats.length >= scenes.length + 1 ? usableBeats : normBeats
    const totalAvailableBeats = Math.max(scenes.length, Math.round(capDur / beatStep))

    // Allocate beat counts honoring explicit `beatCount` hints (0.5-beat blitzes when allowed by genre/AI audioProfile).
    // Counts planned on another tempo (the storyboard's planBpm) are converted by seconds onto this track's beats.
    const trackBpm = 60 / beatStep
    const tempoRatio = Number(planBpm) > 20 && Math.abs(trackBpm / Number(planBpm) - 1) > 0.03 ? trackBpm / Number(planBpm) : 1
    const rawCounts = updated.map((sc, idx) => {
      const explicit = Number(sc.beatCount)
      if (Number.isFinite(explicit) && explicit >= 0.45) {
        const conv = explicit * tempoRatio
        if (explicit <= 0.5 && allowBlitzCut) return 0.5
        return allowBlitzCut ? conv : Math.max(minBeatSpan, conv)
      }
      const hintDur = Number(sc.durationSec)
      if (Number.isFinite(hintDur) && hintDur >= 0.26 && targetDurationSec <= 0) {
        return Math.max(minBeatSpan, Number((hintDur / beatStep).toFixed(2)))
      }
      if (sc.stageSpec?.archetype === 'slash-climax' || sc.transition === 'flash-cut') return allowBlitzCut ? 1 : Math.max(1, minBeatSpan)
      if (idx === 0 || idx === updated.length - 1) return 4
      return Math.max(minBeatSpan, 3)
    })

    const rawSum = rawCounts.reduce((a, b) => a + b, 0) || scenes.length
    const scale = targetDurationSec > 0 || rawSum > totalAvailableBeats ? totalAvailableBeats / rawSum : 1

    // Whole-beat spans by largest-remainder rounding, so the spans add up to the beats the film needs (rounding every
    // shot on its own lost up to half a beat per shot). 0.5-beat blitz cuts stay 0.5.
    const minWhole = minBeatSpan >= 2 ? 2 : 1
    const wantBeats = rawCounts.map((c) => c * scale)
    const spans = wantBeats.map((d) => (allowBlitzCut && d <= 0.72 ? 0.5 : Math.max(minWhole, Math.floor(d))))
    const targetBeats = scale !== 1 ? totalAvailableBeats : Math.round(rawSum * 2) / 2
    let spanSum = spans.reduce((a, b) => a + b, 0)
    const byRemainder = wantBeats
      .map((d, i) => ({ i, rem: spans[i] < 1 ? -1 : d - Math.floor(d) }))
      .filter((x) => x.rem >= 0)
      .sort((a, b) => b.rem - a.rem || a.i - b.i)
    for (let k = 0; byRemainder.length > 0 && spanSum + 1 <= targetBeats + 0.25 && k < 4 * spans.length + 64; k++) {
      spans[byRemainder[k % byRemainder.length].i] += 1
      spanSum += 1
    }
    for (let k = 0; spanSum - 1 >= targetBeats - 0.25 && k < 4 * spans.length + 64; k++) {
      let big = -1
      for (let i = 0; i < spans.length; i++) if (spans[i] > minWhole && (big < 0 || spans[i] > spans[big])) big = i
      if (big < 0) break
      spans[big] -= 1
      spanSum -= 1
    }

    let beatCursor = 0
    let subBeatAcc = 0
    // Start scene 0 at frame 0 while syncing scene 1+ cuts strictly onto real beat or half-beat hits
    let curStartSec = 0
    for (let i = 0; i < updated.length; i++) {
      const sc = updated[i]
      const isLast = i === updated.length - 1
      const spanBeats = spans[i]

      if (spanBeats < 1) {
        subBeatAcc += spanBeats
        if (subBeatAcc >= 0.99) {
          beatCursor += Math.floor(subBeatAcc + 0.01)
          subBeatAcc = subBeatAcc - Math.floor(subBeatAcc + 0.01)
        }
      } else {
        if (i === 0 && beatMeta.phaseSec > 0.25 && beatMeta.phaseSec < beatStep * 1.2) {
          beatCursor = Math.max(1, Math.round(spanBeats) - 1)
        } else {
          beatCursor += Math.round(spanBeats)
        }
      }

      let nextBoundarySec
      if (isLast) {
        // a target duration is met exactly: the last shot ends on it (the spans above already add up to it)
        nextBoundarySec = targetDurationSec > 0
          ? Math.max(curStartSec + 1.2, capDur)
          : Math.min(maxBgmDur, Math.max(curStartSec + 1.5, curStartSec + spanBeats * beatStep))
      } else if (spanBeats < 1) {
        const halfSec = Math.max(0.27, spanBeats * beatStep)
        nextBoundarySec = curStartSec + halfSec
      } else {
        // Snap cut to nearest strong downbeat when span >= 4 beats to feel ultra-locked
        const candBeat = beatCursor < fallbackBeats.length ? fallbackBeats[beatCursor] : null
        let cutSec = candBeat && candBeat.time > curStartSec + 0.3 ? candBeat.time : curStartSec + spanBeats * beatStep
        if (spanBeats >= 4 && candBeat && !candBeat.strong) {
          const nearbyStrong = fallbackBeats.find((b) => b.strong && Math.abs(b.time - cutSec) <= beatStep * 1.1 && b.time > curStartSec + 0.5)
          if (nearbyStrong) {
            cutSec = nearbyStrong.time
            beatCursor = fallbackBeats.indexOf(nearbyStrong)
            subBeatAcc = 0
          }
        }
        nextBoundarySec = Math.max(curStartSec + 0.27, cutSec)
      }

      const startFrame = Math.round(curStartSec * safeFps)
      const endFrame = Math.max(startFrame + 8, Math.round(nextBoundarySec * safeFps))
      const durFrames = endFrame - startFrame
      const durSec = Number((durFrames / safeFps).toFixed(4))

      sc.startSec = Number((startFrame / safeFps).toFixed(4))
      sc.endSec = Number((endFrame / safeFps).toFixed(4))
      sc.durationSec = durSec
      sc.startFrame = startFrame
      sc.endFrame = endFrame
      sc.durationInFrames = durFrames
      sc.beatCutAligned = true

      // Align scene subtitle lines proportionally inside beat-locked scene
      const chunks = Array.isArray(sc.subChunks) && sc.subChunks.length > 0
        ? sc.subChunks
        : Array.isArray(sc.subtitles) && sc.subtitles.length > 0
          ? sc.subtitles.map((u) => u.text).filter(Boolean)
          : sc.subtitleText
            ? [sc.subtitleText]
            : sc.narration
              ? [sc.narration]
              : []

      if (chunks.length > 0) {
        const totalW = chunks.reduce((acc, c) => acc + Math.max(1, String(c).length), 0)
        let subCur = 0
        sc.subtitles = chunks.map((text, ci) => {
          const w = Math.max(1, String(text).length)
          const isLastSub = ci === chunks.length - 1
          const localEnd = isLastSub ? durSec : Math.min(durSec, Number((subCur + (durSec * w) / totalW).toFixed(3)))
          const item = {
            index: ci + 1,
            text: String(text).trim(),
            startSec: Number(subCur.toFixed(3)),
            endSec: Number(localEnd.toFixed(3)),
            startFrame: Math.floor(subCur * safeFps),
            endFrame: Math.ceil(localEnd * safeFps),
            sceneId: sc.id,
            localStartSec: Number(subCur.toFixed(3)),
            localEndSec: Number(localEnd.toFixed(3)),
            globalStartSec: Number((sc.startSec + subCur).toFixed(3)),
            globalEndSec: Number((sc.startSec + localEnd).toFixed(3)),
            globalStartFrame: startFrame + Math.floor(subCur * safeFps),
            globalEndFrame: startFrame + Math.ceil(localEnd * safeFps),
          }
          subCur = localEnd
          return item
        })
      }

      curStartSec = sc.endSec
    }
    return updated
  }

  // Mode 2: tts-beat-sync — honor TTS voice duration + pause, snap trailing boundary to next beat/downbeat
  // If user requested a specific targetDurationSec longer than raw speech, distribute musical breathing evenly
  const rawMinTotal = updated.reduce(
    (acc, sc) => acc + Math.max(Number(sc.durationSec) || 2.5, (Number(sc.voiceDurationSec) || 0) + (Number(sc.voiceLeadSec) ?? 0.28) + 0.2),
    0,
  )
  const extraPadPerScene =
    targetDurationSec > 4 && rawMinTotal > 2 && rawMinTotal < targetDurationSec * 0.96
      ? Math.min(4.2, (targetDurationSec - rawMinTotal) / Math.max(1, updated.length))
      : 0

  let cursorSec = 0
  let cursorFrame = 0
  for (let i = 0; i < updated.length; i++) {
    const sc = updated[i]
    const baseMinDur = Math.max(Number(sc.durationSec) || 2.5, (Number(sc.voiceDurationSec) || 0) + (Number(sc.voiceLeadSec) ?? 0.28) + 0.2)
    const minDur = baseMinDur + extraPadPerScene
    const minEnd = cursorSec + minDur
    const snappedEnd = i === updated.length - 1
      ? Math.max(minEnd, targetDurationSec > 4 && rawMinTotal < targetDurationSec ? Math.min(targetDurationSec, minEnd + 2.0) : minEnd)
      : snapTimeToBeatGrid(minEnd, { beats: normBeats }, { preferDownbeat: extraPadPerScene >= beatStep, direction: 'forward', maxShiftSec: beatStep * 1.45 })

    const endFrame = Math.max(cursorFrame + 18, Math.round(snappedEnd * safeFps))
    const durFrames = endFrame - cursorFrame
    const durSec = Number((durFrames / safeFps).toFixed(4))

    sc.startFrame = cursorFrame
    sc.durationInFrames = durFrames
    sc.endFrame = endFrame
    sc.startSec = Number((cursorFrame / safeFps).toFixed(4))
    sc.endSec = Number((endFrame / safeFps).toFixed(4))
    sc.durationSec = durSec
    sc.beatCutAligned = true

    if (Array.isArray(sc.subtitles)) {
      sc.subtitles = sc.subtitles.map((sub) => {
        const l0 = Number(sub.localStartSec ?? sub.startSec ?? 0)
        const l1 = Math.min(durSec, Number(sub.localEndSec ?? sub.endSec ?? durSec))
        return {
          ...sub,
          sceneId: sc.id,
          localStartSec: l0,
          localEndSec: l1,
          globalStartSec: Number((sc.startSec + l0).toFixed(3)),
          globalEndSec: Number((sc.startSec + l1).toFixed(3)),
          globalStartFrame: cursorFrame + Math.round(l0 * safeFps),
          globalEndFrame: cursorFrame + Math.round(l1 * safeFps),
        }
      })
    }

    cursorFrame = endFrame
    cursorSec = sc.endSec
  }

  return updated
}

/**
 * Universal Cross-Genre Adaptive Audio-Visual Rhythm Profiles.
 * Ensures FFmpeg beat-grid quantization, 48kHz procedural SFX choreography, camera beat pulse,
 * BGM sidechain ducking, and EBU R128 loudness mastering automatically adapt to EVERY video genre
 * (and honor any AI Director `script.audioProfile` custom override for open/custom genres!).
 */
export const GENRE_AUDIO_PROFILES = {
  'history-theater': {
    profileName: '冷兵器史诗战场高燃声场',
    beatCutIntensity: 'high',
    blitzAllowed: true,
    minBeatMultiple: 0.5,
    cameraBeatIntensity: 1.05,
    targetLufs: -10.5,
    bgmDuckRatio: 1.4,
    sfxBoostVoice: 1.28,
    sfxBoostMv: 1.32,
    bgmVolVoice: 0.48,
    bgmVolMv: 1.0,
    sfxPalette: {
      opener: ['war_drum', 'blade_whoosh'],
      drop: ['heavy_impact', 'metal_clash'],
      action: ['metal_clash', 'blade_whoosh'],
      data: ['war_drum', 'stamp'],
      neutral: ['blade_whoosh', 'war_drum'],
      internal: ['metal_clash', 'blade_whoosh', 'war_drum'],
      preCut: ['riser', 'blade_whoosh'],
    },
  },
  'mv-lyric': {
    profileName: '高燃节奏卡点 MV 声场',
    beatCutIntensity: 'high',
    blitzAllowed: true,
    minBeatMultiple: 0.5,
    cameraBeatIntensity: 0.96,
    targetLufs: -10.5,
    bgmDuckRatio: 1.4,
    sfxBoostVoice: 1.25,
    sfxBoostMv: 1.28,
    bgmVolVoice: 0.50,
    bgmVolMv: 1.0,
    // a modern beat edit: punchy hits, sub drops and swooshes (history-themed MVs resolve to 'history-theater')
    sfxPalette: {
      opener: ['hit', 'riser'],
      drop: ['sub_drop', 'hit'],
      action: ['whoosh', 'shutter'],
      data: ['tick', 'counter'],
      neutral: ['swoosh', 'whoosh'],
      internal: ['shutter', 'hit', 'swoosh'],
      preCut: ['riser', 'suck'],
    },
  },
  'cinematic-story': {
    profileName: '电影感叙事声场',
    beatCutIntensity: 'medium',
    blitzAllowed: false,
    minBeatMultiple: 1.0,
    cameraBeatIntensity: 0.3,
    targetLufs: -14.0,
    bgmDuckRatio: 2.6,
    sfxBoostVoice: 1.0,
    sfxBoostMv: 1.2,
    bgmVolVoice: 0.42,
    bgmVolMv: 0.85,
    sfxPalette: {
      opener: ['riser', 'sub_drop'],
      drop: ['sub_drop', 'hit'],
      action: ['whoosh', 'swoosh'],
      data: ['tick', 'flip'],
      neutral: ['whoosh', 'swoosh'],
      internal: ['shimmer_swell', 'whoosh'],
      preCut: ['riser', 'swoosh'],
    },
  },
  'product-promo': {
    profileName: '科技旗舰商业发布会声场',
    beatCutIntensity: 'medium',
    blitzAllowed: true,
    minBeatMultiple: 1.0,
    cameraBeatIntensity: 0.48,
    targetLufs: -14.0,
    bgmDuckRatio: 2.6,
    sfxBoostVoice: 1.15,
    sfxBoostMv: 1.38,
    bgmVolVoice: 0.42,
    bgmVolMv: 0.80,
    sfxPalette: {
      opener: ['riser', 'shine'],
      drop: ['sub_drop', 'shine'],
      action: ['swoosh', 'shutter'],
      data: ['counter', 'radar'],
      neutral: ['whoosh', 'pop_soft'],
      internal: ['sparkle', 'shutter', 'chime'],
      preCut: ['riser', 'swoosh'],
    },
  },
  'ui-tutorial': {
    profileName: '软件实操清晰键鼠声场',
    beatCutIntensity: 'gentle',
    blitzAllowed: false,
    minBeatMultiple: 2.0,
    cameraBeatIntensity: 0.0,
    targetLufs: -15.0,
    bgmDuckRatio: 3.4,
    sfxBoostVoice: 0.84,
    sfxBoostMv: 1.05,
    bgmVolVoice: 0.30,
    bgmVolMv: 0.68,
    sfxPalette: {
      opener: ['chime', 'pop_soft'],
      drop: ['card', 'chime'],
      action: ['click', 'pop_soft'],
      data: ['typing', 'tick'],
      neutral: ['click', 'card'],
      internal: ['click', 'typing', 'pop_soft'],
      preCut: ['swoosh', 'flip'],
    },
  },
  'code-animation': {
    profileName: '代码与架构演进精密声场',
    beatCutIntensity: 'gentle',
    blitzAllowed: false,
    minBeatMultiple: 2.0,
    cameraBeatIntensity: 0.12,
    targetLufs: -14.8,
    bgmDuckRatio: 3.2,
    sfxBoostVoice: 0.92,
    sfxBoostMv: 1.18,
    bgmVolVoice: 0.34,
    bgmVolMv: 0.72,
    sfxPalette: {
      opener: ['radar', 'chime'],
      drop: ['glitch', 'shine'],
      action: ['typing', 'radar'],
      data: ['counter', 'tick'],
      neutral: ['click', 'swoosh'],
      internal: ['typing', 'radar', 'lock'],
      preCut: ['swoosh', 'riser'],
    },
  },
  'science-explainer': {
    profileName: '深度科普动态拆解声场',
    beatCutIntensity: 'medium',
    blitzAllowed: false,
    minBeatMultiple: 1.0,
    cameraBeatIntensity: 0.24,
    targetLufs: -14.5,
    bgmDuckRatio: 3.0,
    sfxBoostVoice: 1.02,
    sfxBoostMv: 1.24,
    bgmVolVoice: 0.36,
    bgmVolMv: 0.74,
    sfxPalette: {
      opener: ['shimmer_swell', 'radar'],
      drop: ['sub_drop', 'sparkle'],
      action: ['whoosh', 'radar'],
      data: ['counter', 'tick'],
      neutral: ['card', 'pop_soft'],
      internal: ['radar', 'counter', 'sparkle'],
      preCut: ['riser', 'swoosh'],
    },
  },
  'data-story': {
    profileName: '数据榜单与商业洞察声场',
    beatCutIntensity: 'medium',
    blitzAllowed: true,
    minBeatMultiple: 1.0,
    cameraBeatIntensity: 0.30,
    targetLufs: -14.3,
    bgmDuckRatio: 2.9,
    sfxBoostVoice: 1.08,
    sfxBoostMv: 1.32,
    bgmVolVoice: 0.38,
    bgmVolMv: 0.76,
    sfxPalette: {
      opener: ['counter', 'shine'],
      drop: ['sub_drop', 'stamp'],
      action: ['counter', 'whoosh'],
      data: ['counter', 'tick'],
      neutral: ['card', 'tick'],
      internal: ['counter', 'tick', 'chime'],
      preCut: ['riser', 'swoosh'],
    },
  },
  'stickman-story': {
    profileName: '趣味故事/轻喜剧节奏声场',
    beatCutIntensity: 'medium',
    blitzAllowed: false,
    minBeatMultiple: 1.0,
    cameraBeatIntensity: 0.32,
    targetLufs: -14.5,
    bgmDuckRatio: 3.0,
    sfxBoostVoice: 1.06,
    sfxBoostMv: 1.25,
    bgmVolVoice: 0.36,
    bgmVolMv: 0.74,
    sfxPalette: {
      opener: ['pop', 'chime'],
      drop: ['boing', 'sparkle'],
      action: ['pop', 'whoosh'],
      data: ['flip', 'tick'],
      neutral: ['pop_soft', 'flip'],
      internal: ['pop', 'boing', 'chime'],
      preCut: ['swoosh', 'pop_soft'],
    },
  },
  'brand-story': {
    profileName: '品牌人文与治愈叙事声场',
    beatCutIntensity: 'gentle',
    blitzAllowed: false,
    minBeatMultiple: 2.0,
    cameraBeatIntensity: 0.16,
    targetLufs: -14.8,
    bgmDuckRatio: 2.8,
    sfxBoostVoice: 0.90,
    sfxBoostMv: 1.12,
    bgmVolVoice: 0.42,
    bgmVolMv: 0.78,
    sfxPalette: {
      opener: ['shimmer_swell', 'bell_warm'],
      drop: ['shimmer_swell', 'shine'],
      action: ['swoosh', 'shutter'],
      data: ['flip', 'bell_warm'],
      neutral: ['swoosh', 'pop_soft'],
      internal: ['bell_warm', 'sparkle'],
      preCut: ['shimmer_swell', 'swoosh'],
    },
  },
  'talking-head': {
    profileName: '口播干货清晰人声声场',
    beatCutIntensity: 'gentle',
    blitzAllowed: false,
    minBeatMultiple: 2.0,
    cameraBeatIntensity: 0.08,
    targetLufs: -15.0,
    bgmDuckRatio: 3.4,
    sfxBoostVoice: 0.85,
    sfxBoostMv: 1.05,
    bgmVolVoice: 0.30,
    bgmVolMv: 0.68,
    sfxPalette: {
      opener: ['pop_soft', 'chime'],
      drop: ['pop', 'chime'],
      action: ['swoosh', 'pop'],
      data: ['tick', 'card'],
      neutral: ['pop_soft', 'card'],
      internal: ['pop_soft', 'chime'],
      preCut: ['swoosh', 'flip'],
    },
  },
}

/**
 * Resolve the adaptive audio/rhythm profile for ANY video genre or custom AI Director override.
 */
export function resolveAdaptiveAudioProfile(opts = {}) {
  const genreRaw = String(opts.genre || opts.referenceStyle?.genre || '').trim().toLowerCase()
  const labelRaw = `${opts.genreLabel || ''} ${opts.title || ''} ${opts.topic || ''} ${opts.style || ''}`.toLowerCase()

  let baseKey = GENRE_AUDIO_PROFILES[genreRaw] ? genreRaw : ''
  if (!baseKey) {
    // only clearly historical content gets the cold-weapon battle palette (single characters such as 汉 / 楚 / 秦
    // also occur in 汉堡 / 清楚 / 秦岭); 卡点 / MV / 高燃 alone means a modern beat edit
    if (isHistoricalContent(labelRaw)) baseKey = 'history-theater'
    else if (/歌词|mv|混剪|卡点|踩点|律动|音乐视频|高燃|燃剪/.test(labelRaw)) baseKey = 'mv-lyric'
    else if (/教程|实操|指南|教学|软件|界面|操作|演示|ui/.test(labelRaw)) baseKey = 'ui-tutorial'
    else if (/代码|架构|编程|开源|源码|api|算法/.test(labelRaw)) baseKey = 'code-animation'
    else if (/发布|产品|宣传|旗舰|科技|商业|广告|promo/.test(labelRaw)) baseKey = 'product-promo'
    else if (/数据|榜单|排行|财报|对比|趋势|统计|洞察/.test(labelRaw)) baseKey = 'data-story'
    else if (/科普|原理|解剖|科学|物理|生物|天文|拆解/.test(labelRaw)) baseKey = 'science-explainer'
    else if (/火柴人|搞笑|段子|吐槽|漫剧|趣味|故事/.test(labelRaw)) baseKey = 'stickman-story'
    else if (/治愈|旅行|vlog|纪录|温暖|品牌|情感|人文|美食/.test(labelRaw)) baseKey = 'brand-story'
    else if (/口播|访谈|干货|解说/.test(labelRaw)) baseKey = 'talking-head'
    else if (opts.style === 'energetic') baseKey = 'product-promo'
    else if (opts.style === 'warm' || opts.style === 'documentary') baseKey = 'brand-story'
    else if (opts.style === 'cinematic') baseKey = 'cinematic-story'
    else baseKey = 'product-promo'
  }
  // a history-themed MV keeps the epic battle choreography; every other MV stays a modern beat edit
  if (baseKey === 'mv-lyric' && isHistoricalContent(labelRaw)) baseKey = 'history-theater'

  const base = GENRE_AUDIO_PROFILES[baseKey] || GENRE_AUDIO_PROFILES['product-promo']
  const aiOv = opts.audioProfile && typeof opts.audioProfile === 'object' ? opts.audioProfile : {}
  const SOFT_CHIME_SET = new Set(['chime', 'shimmer_swell', 'sparkle', 'ding', 'shine', 'bell_warm', 'pop_soft', 'notif'])
  const isEpicCombat = baseKey === 'history-theater'
  const rawMergedPalette = {
    ...base.sfxPalette,
    ...(aiOv.sfxPalette && typeof aiOv.sfxPalette === 'object' ? aiOv.sfxPalette : {}),
  }
  const mergedPalette = {}
  for (const [slot, list] of Object.entries(rawMergedPalette)) {
    const arr = Array.isArray(list) ? list : []
    if (isEpicCombat) {
      const cleaned = arr.map((k) => {
        const lk = String(k || '').toLowerCase()
        if (!SOFT_CHIME_SET.has(lk)) return k
        if (slot === 'opener') return 'war_drum'
        if (slot === 'drop') return 'heavy_impact'
        if (slot === 'preCut') return 'blade_whoosh'
        return 'metal_clash'
      })
      mergedPalette[slot] = cleaned.length ? Array.from(new Set(cleaned)) : base.sfxPalette[slot] || ['metal_clash']
    } else {
      mergedPalette[slot] = arr.length ? arr : base.sfxPalette[slot] || ['whoosh']
    }
  }

  const intensity = String(aiOv.beatCutIntensity || base.beatCutIntensity).toLowerCase()
  const clampNum = (v, min, max, fallback) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }

  return {
    genreKey: baseKey,
    profileName: String(aiOv.profileName || base.profileName),
    beatCutIntensity: ['high', 'medium', 'gentle', 'off'].includes(intensity) ? intensity : base.beatCutIntensity,
    blitzAllowed: typeof aiOv.blitzAllowed === 'boolean' ? aiOv.blitzAllowed : (intensity === 'high' ? true : base.blitzAllowed),
    minBeatMultiple: clampNum(aiOv.minBeatMultiple, 0.5, 4, intensity === 'high' ? 0.5 : intensity === 'gentle' ? 2.0 : base.minBeatMultiple),
    cameraBeatIntensity: clampNum(aiOv.cameraBeatIntensity, 0, 1.2, base.cameraBeatIntensity),
    targetLufs: clampNum(aiOv.targetLufs, -18.0, -9.5, base.targetLufs),
    bgmDuckRatio: clampNum(aiOv.bgmDuckRatio, 1.2, 5.0, base.bgmDuckRatio),
    sfxBoostVoice: clampNum(aiOv.sfxBoostVoice ?? aiOv.sfxBoost, 0.4, 1.8, base.sfxBoostVoice),
    sfxBoostMv: clampNum(aiOv.sfxBoostMv ?? aiOv.sfxBoost, 0.6, 2.0, base.sfxBoostMv),
    bgmVolVoice: clampNum(aiOv.bgmVolVoice, 0.18, 0.65, base.bgmVolVoice),
    bgmVolMv: clampNum(aiOv.bgmVolMv, 0.5, 1.25, base.bgmVolMv),
    sfxPalette: mergedPalette,
  }
}

// ===========================================================================
// PICTURE-DRIVEN, BEAT-LOCKED SFX CHOREOGRAPHY
// ---------------------------------------------------------------------------
// What a shot SHOWS decides its sound. The director's `visualBlueprint` / `motionNotes` (the text the coder
// actually draws from) outrank poetic titles and subtitle lines; explicit negations such as "不表现兵刃接触",
// "无额外金属声", "而非兵刃接触", "下一镜才发生碰撞" silence a shot; only visible weapon contact earns a steel
// clash. Every hit is placed on the measured BGM grid (beat / half / quarter), snapped onto the music's own
// transient when one sits within a few milliseconds, and mirrored into `scene.actionEvents` so the clash
// flash, camera shake, kill counter and coder-drawn sparks fire on the same frame as the sound.
// ===========================================================================

export const ACTION_MODES = ['clash-flurry', 'single-clash', 'cavalry', 'drop-impact', 'clean']

const STATIC_ARCHETYPES = new Set([
  'hero-numeral',
  'strategic-map',
  'bamboo-slips',
  'scroll-calligraphy',
  'farewell-tent',
  'plaque-summary',
  'channel-end',
])

// Multi-contact melee wording (a fight, not a single hit)
const MELEE_RE = /短兵相接|短兵|厮杀|激战|搏杀|鏖战|混战|肉搏|白刃|刀光剑影|连斩|连击|连打|乱战|血战|冲杀|破阵|撞阵|对砍|砍杀|一个一个杀|杀过去|交锋/g
// Weapon-contact verbs that stand on their own
const CONTACT_STRONG_RE = /格挡|格开|招架|劈砍|挥砍|劈中|劈落|斩落|斩中|斩杀|斩首|刺中|刺穿|挑飞|挑落|兵刃交错|兵刃相交|兵刃相撞|兵刃碰撞|兵刃相击|兵器相撞|刀剑相交|刀剑碰撞|金属撞击|金属碰撞|金属重击|金属交击|金属声|金属音|金铁|铿锵|撞击声|交击|拼刀|架刀/g
// Contact words that only count when a weapon is named in the same clause ("马鼻接触水面" is not a clash)
const CONTACT_WEAK_RE = /接触|相撞|撞击|碰撞|撞开|撞上|撞向|撞在|砍中|劈在|击在|磕上|磕开|挡住|架住|迎住|拨开|打偏|抵住|交叉|交错|擦过|相交|交点|火星|击中|命中/g
const WEAPON_RE = /兵刃|兵器|刀|剑|矛|戟|刃|长枪|枪尖|枪杆|武器|刀锋|锋刃|剑锋|矛锋|金属|盾|钺|斧|干戈|戈矛|槊/
// Director shorthand "矛尖撞敌矛" / "敌刀击汉军剑" / "矛杆架敌刀": two weapons joined by a one-character contact verb
const WEAPON_NOUN_G_RE = /兵刃|兵器|长矛|矛尖|矛杆|矛刃|刀背|刀刃|刀|剑|矛|戟|长枪|枪|盾|钺|斧|槊|武器/g
const SHORT_CONTACT_VERB_RE = /撞|击|架|抵|挡|劈|砍|刺|磕|格|斩|碰|拨|压|撩/
const CAVALRY_MOTION_RE = /冲锋|冲阵|疾驰|奔袭|狂奔|纵马|策马|奔腾|奔驰|飞驰|驰骋|马蹄|落蹄|蹄声|蹄尘|横向爆出|穿透|楔形|骑流|骑阵|突进|掠过|横穿|逼近|追击|逐敌|踏破|铁骑|轻骑/g
const HORSE_RE = /骑|马|蹄/
const CALM_HORSE_RE = /勒马|驻马|立马|缓行|缓缓经过|静立|伫立|饮马|触水|牵缰|牵马|归拢|待发|艰难行进|徒步/
const IMPACT_RE = /重击|冲击环|冲击波|爆发|轰然|巨响|震地|砸落|重锤|落锤|drop/gi
// "No added sound" requests. A request naming a combat sound ("不加打斗声", "无额外金属声", "不提前添加接战声")
// only removes steel/fight SFX (hooves, drums of a charge stay); a generic one ("不加音效", "保持安静") silences the shot.
const NO_SFX_RE = /(?:不|无|勿|禁止|避免)[^，。；,;]{0,4}(?:添加|加入|叠加|加|配|增加)[^，。；,;]{0,6}(?:声|音效|音)|无额外[^，。；,;]{0,4}声|保持[^，。；,;]{0,6}(?:安静|静默|无声)|静默|留白无声|(?:仅|只)(?:保留|留|有)\s*(?:BGM|背景音乐|配乐)|纯\s*BGM/i
const COMBAT_SOUND_WORD_RE = /打斗|战斗|金属|刀剑|接战|兵刃|碰撞|金戈|铁器|撞击/
const IMPACT_SOUND_WORD_RE = /冲击|重击|鼓|轰/
// Negation / not-in-this-shot markers. Chinese negation scopes rightwards inside a clause.
const NEGATION_RE = /不|无|未|非|没有|禁止|避免|勿|别再|而非|并非|尚未|毫无|拒绝|即将|将要|待发|蓄势|下一镜|上一镜|之后才|才发生|留给|留到/
// "交锋前一瞬" / "撞击留给 drop" negate the word that precedes them
const ANTICIPATION_AFTER_RE = /(交锋|接触|碰撞|撞击|相撞|接战)(?:前一瞬|之前|前夕|前的|前一刻|留给|留到|放到)/g
// Battle statistics ("斩首2028级", "战果") describe a tally, not a visible blade contact
const STAT_PHRASE_RE = /斩(?:首|杀|获)?\s*[\d,，.万千百]+\s*(?:余)?\s*(?:级|人|骑|众)?|战果|军功|首功|斩获|击杀计数/g
// Positive compounds that merely contain a negation character
const POSITIVE_COMPOUND_RE = /不断|不停|不息|不止|不绝|不休|无数|无尽|无畏|无双|无敌|非常|非凡|未央|毫不犹豫|不顾/g
const SINGLE_HIT_RE = /(?:这|那|仅|只)?一击|一斩|一刺|一劈|仅\s*1\s*次|只\s*1\s*次|仅一次|只有一次|一次[^，。；,;]{0,6}(?:撞击|碰撞|格挡|接触|劈|斩|刺|击)/
const COUNT_RE = /([一二两三四五六七八九十\d]{1,2})\s*(?:次|下|记|回合?)[^，。；,;]{0,6}?(?:撞击|碰撞|格挡|接触|交锋|交击|劈砍|斩击|相撞|劈|斩|刺|挡|击)/g
const BEAT_REF_RE = /第\s*([一二三四五六七八九\d]{1,2})\s*(?:[和与及、]\s*第?\s*([一二三四五六七八九\d]{1,2})\s*)?拍/g
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

const round4 = (x) => Number(Number(x).toFixed(4))
const round2 = (x) => Number(Number(x).toFixed(2))
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const parseCnInt = (s) => {
  const raw = String(s || '').trim()
  if (/^\d+$/.test(raw)) return Number(raw)
  if (raw === '十') return 10
  if (raw.length === 2 && raw[0] === '十') return 10 + (CN_NUM[raw[1]] || 0)
  return CN_NUM[raw] || 0
}

function matchAll(re, text) {
  const out = []
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  let m
  while ((m = rx.exec(text)) !== null) {
    out.push({ index: m.index, text: m[0], groups: m })
    if (m[0].length === 0) rx.lastIndex++
  }
  return out
}

function splitClauses(text) {
  return String(text || '')
    .replace(STAT_PHRASE_RE, (m) => '＃'.repeat(m.length))
    .replace(POSITIVE_COMPOUND_RE, (m) => '＊'.repeat(m.length))
    .split(/[，。；;,!！?？：:\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Read what a shot shows. Prefers the director's visual blueprint (what the coder draws); falls back to the
 * title + subtitle line only when no blueprint exists. Negated / not-in-this-shot mentions are counted apart.
 */
export function analyzeSceneActionText(sc = {}) {
  const blueParts = [sc?.visualBlueprint, sc?.motionNotes]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
  const blueprint = Array.from(new Set(blueParts)).join('。')
  const hasBlueprint = blueprint.replace(/\s/g, '').length >= 8
  const text = hasBlueprint ? blueprint : `${sc?.title || ''}。${sc?.narration || ''}`
  const res = {
    source: hasBlueprint ? 'blueprint' : 'lines',
    melee: 0,
    meleeNeg: 0,
    contact: 0,
    contactNeg: 0,
    cavalry: 0,
    cavalryNeg: 0,
    calmHorse: 0,
    horse: false,
    impact: 0,
    impactNeg: 0,
    noSfx: false,
    noFight: false,
    noImpact: false,
    single: false,
    count: 0,
    halfBeat: false,
    heavyTone: false,
    brightTone: false,
    contactBeats: [],
    hoofBeats: [],
  }
  for (const clause of splitClauses(text)) {
    const negHit = NEGATION_RE.exec(clause)
    const negIdx = negHit ? negHit.index : -1
    const isNeg = (i) => negIdx >= 0 && i > negIdx
    const anticIdx = new Set(matchAll(ANTICIPATION_AFTER_RE, clause).map((m) => m.index))
    const hasWeapon = WEAPON_RE.test(clause)
    let clauseContact = 0
    for (const m of matchAll(MELEE_RE, clause)) {
      if (isNeg(m.index) || anticIdx.has(m.index)) res.meleeNeg++
      else {
        res.melee++
        clauseContact++
      }
    }
    for (const m of matchAll(CONTACT_STRONG_RE, clause)) {
      if (isNeg(m.index) || anticIdx.has(m.index)) res.contactNeg++
      else {
        res.contact++
        clauseContact++
      }
    }
    if (hasWeapon) {
      for (const m of matchAll(CONTACT_WEAK_RE, clause)) {
        if (isNeg(m.index) || anticIdx.has(m.index)) res.contactNeg++
        else {
          res.contact++
          clauseContact++
        }
      }
      // Two weapons with a contact verb between them, in the positive (pre-negation) part of the clause
      if (clauseContact === 0) {
        const positive = negIdx >= 0 ? clause.slice(0, negIdx) : clause
        const weapons = matchAll(WEAPON_NOUN_G_RE, positive)
        if (weapons.length >= 2) {
          const between = positive.slice(weapons[0].index + weapons[0].text.length, weapons[weapons.length - 1].index)
          if (SHORT_CONTACT_VERB_RE.test(between)) {
            res.contact++
            clauseContact++
          }
        }
      }
    }
    let clauseCavalry = 0
    // motion words only describe a charge when riders / horses / troops are in the same clause ("雪粒横向掠过" is not)
    const riders = HORSE_RE.test(clause) || /军|队|兵|阵|将/.test(clause)
    for (const m of riders ? matchAll(CAVALRY_MOTION_RE, clause) : []) {
      if (isNeg(m.index)) res.cavalryNeg++
      else {
        res.cavalry++
        clauseCavalry++
      }
    }
    if (CALM_HORSE_RE.test(clause)) res.calmHorse++
    if (HORSE_RE.test(clause)) res.horse = true
    for (const m of matchAll(IMPACT_RE, clause)) {
      if (isNeg(m.index)) res.impactNeg++
      else res.impact++
    }
    const noSfxHit = NO_SFX_RE.exec(clause)
    if (noSfxHit) {
      const said = noSfxHit[0]
      const fight = COMBAT_SOUND_WORD_RE.test(said)
      const impact = IMPACT_SOUND_WORD_RE.test(said)
      if (fight) res.noFight = true
      if (impact) res.noImpact = true
      if (!fight && !impact) res.noSfx = true
    }
    if (clauseContact > 0) {
      const single = SINGLE_HIT_RE.exec(clause)
      if (single && !isNeg(single.index)) res.single = true
      for (const m of matchAll(COUNT_RE, clause)) {
        if (isNeg(m.index)) continue
        const n = parseCnInt(m.groups[1])
        if (n > 0 && n <= 16) res.count = Math.max(res.count, n)
      }
      if (/低|重|沉|闷|巨|厚/.test(clause)) res.heavyTone = true
      if (/清亮|清脆|尖锐|脆响|清越/.test(clause)) res.brightTone = true
    }
    const halfAt = clause.indexOf('半拍')
    if (halfAt >= 0 && !isNeg(halfAt)) res.halfBeat = true
    for (const m of matchAll(BEAT_REF_RE, clause)) {
      if (isNeg(m.index)) continue
      const refs = [parseCnInt(m.groups[1]), parseCnInt(m.groups[2])].filter((n) => n >= 1 && n <= 16)
      if (clauseContact > 0) res.contactBeats.push(...refs)
      else if (clauseCavalry > 0 || /蹄/.test(clause)) res.hoofBeats.push(...refs)
    }
  }
  res.contactBeats = Array.from(new Set(res.contactBeats)).sort((a, b) => a - b)
  res.hoofBeats = Array.from(new Set(res.hoofBeats)).sort((a, b) => a - b)
  return res
}

/**
 * Classify a shot's on-screen action and explain why.
 * Returns { mode: 'clash-flurry' | 'single-clash' | 'cavalry' | 'drop-impact' | 'clean', reason, text }.
 */
export function explainSceneActionMode(sc = {}, { nearDrop = false, genreKey = 'history-theater', idx = 0 } = {}) {
  // The director's own label survives re-choreography (actionMode is overwritten with the resolved mode)
  const explicitRaw = String(sc?.directorActionMode || sc?.actionMode || '').trim().toLowerCase()
  const explicit = ACTION_MODES.includes(explicitRaw) ? explicitRaw : ''
  if (genreKey !== 'history-theater') {
    return { mode: explicit || (nearDrop ? 'drop-impact' : 'clean'), reason: explicit ? 'director label' : nearDrop ? 'music drop' : 'no action', text: null }
  }
  const arch = String(sc?.stageSpec?.archetype || '').toLowerCase()
  const t = analyzeSceneActionText(sc)
  const lines = t.source === 'lines'
  const impactBeats = Array.isArray(sc?.impactBeats) ? sc.impactBeats.filter((n) => Number.isFinite(Number(n))) : []
  const staticArch = STATIC_ARCHETYPES.has(arch)
  const contactYes = staticArch ? t.melee > 0 || t.contact >= 2 : t.contact + t.melee > 0
  const flurryNegated = t.meleeNeg > 0 && t.melee === 0

  // 1. Visible weapon contact → steel (count decides single vs. flurry)
  const silenced = t.noSfx || (t.noFight && t.noImpact)
  if (contactYes && !silenced && !t.noFight) {
    let flurry
    if (t.count >= 2 || impactBeats.length >= 2 || t.contactBeats.length >= 2) flurry = true
    else if (t.count === 1 || t.single || impactBeats.length === 1 || flurryNegated) flurry = false
    else if (t.melee > 0) flurry = true
    else flurry = explicit === 'clash-flurry'
    return {
      mode: flurry ? 'clash-flurry' : 'single-clash',
      reason: `${lines ? 'line' : 'blueprint'} shows weapon contact${t.count ? ` x${t.count}` : ''}`,
      text: t,
    }
  }
  const contactDenied = t.contactNeg + t.meleeNeg > 0
  // 2. No visible contact but the director still labelled a fight: trust the label only without a blueprint
  if (lines && !contactDenied && (explicit === 'clash-flurry' || explicit === 'single-clash') && !silenced && !t.noFight) {
    return { mode: explicit, reason: 'director label (no blueprint)', text: t }
  }
  const staticShot = staticArch
  const impactYes = t.impact > 0 && !t.noImpact
  // 3. Explicit silence
  if (silenced && (!impactYes || staticShot)) return { mode: 'clean', reason: 'blueprint asks for no extra sound', text: t }
  // 4. Riders in motion → tempo-locked hooves
  const calm = t.calmHorse > 0 && t.calmHorse >= t.cavalry
  const cavalryYes =
    explicit !== 'clean' &&
    !staticShot &&
    !calm &&
    (t.cavalry > 0 || (arch === 'cavalry-rush' && t.cavalryNeg === 0) || (explicit === 'cavalry' && t.horse && t.cavalryNeg === 0))
  if (cavalryYes && !impactYes) return { mode: 'cavalry', reason: 'riders in motion', text: t }
  // 5. Big hit without steel (drop, heavy landing, reveal)
  if ((impactYes && explicit !== 'clean') || ((explicit === 'drop-impact' || (idx === 0 && nearDrop)) && !t.noImpact)) {
    return { mode: 'drop-impact', reason: impactYes ? 'blueprint calls for a heavy hit' : 'director drop label', text: t }
  }
  if (cavalryYes) return { mode: 'cavalry', reason: 'riders in motion', text: t }
  return { mode: 'clean', reason: contactDenied ? 'contact explicitly not in this shot' : staticShot ? 'static shot (number/map/slips/title)' : 'no visible action', text: t }
}

/**
 * Strict visual-action classifier for beat-locked SFX & VFX (string mode only, see `explainSceneActionMode`).
 */
export function classifySceneActionMode(sc = {}, opts = {}) {
  return explainSceneActionMode(sc, opts).mode
}

function normalizeBeatList(beatMeta = {}) {
  const raw = Array.isArray(beatMeta?.beats) ? beatMeta.beats : []
  return raw
    .map((b, i) => (typeof b === 'number' ? { time: b, strong: i % 4 === 0, index: i } : { ...b, time: Number(b?.time) }))
    .filter((b) => Number.isFinite(b.time))
    .sort((a, b) => a.time - b.time)
}

/**
 * Musical grid over the measured (drift-corrected) beats: fractional beat positions, sub-beat points and
 * snapping onto the BGM's own transients (`beatMeta.onsets`).
 */
export function createMusicalGrid(beatMeta = {}) {
  const beats = normalizeBeatList(beatMeta)
  const times = beats.map((b) => b.time)
  const n = times.length
  let step = Number(beatMeta?.beatSec) > 0.2 ? Number(beatMeta.beatSec) : Number(beatMeta?.bpm) > 0 ? 60 / Number(beatMeta.bpm) : 0
  if (!(step > 0.2 && step < 1.6) && n >= 2) step = (times[n - 1] - times[0]) / (n - 1)
  if (!(step > 0.2 && step < 1.6)) step = 0.6
  const phase = n ? times[0] : Number(beatMeta?.phaseSec) || 0
  const barOffset = Number(beatMeta?.barOffset) || 0
  const timeAt = (p) => {
    if (!n) return phase + p * step
    if (p <= 0) return times[0] + p * step
    if (p >= n - 1) return times[n - 1] + (p - (n - 1)) * step
    const i = Math.floor(p)
    return times[i] + (p - i) * (times[i + 1] - times[i])
  }
  const posAt = (t) => {
    if (!n) return (t - phase) / step
    if (t <= times[0]) return (t - times[0]) / step
    if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / step
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (times[mid] <= t) lo = mid
      else hi = mid
    }
    return lo + (t - times[lo]) / Math.max(1e-6, times[lo + 1] - times[lo])
  }
  const beatInfoAt = (i) => {
    if (i >= 0 && i < n) return beats[i]
    return { time: timeAt(i), strong: (((i - barOffset) % 4) + 4) % 4 === 0, isDrop: false, index: i }
  }
  const onsets = (Array.isArray(beatMeta?.onsets) ? beatMeta.onsets : [])
    .map((o) => (typeof o === 'number' ? { time: o, strength: 0.5 } : { time: Number(o?.time), strength: Number(o?.strength) || 0.5 }))
    .filter((o) => Number.isFinite(o.time))
    .sort((a, b) => a.time - b.time)
  const onsetNear = (t, win = 0.024) => {
    if (!onsets.length) return null
    let lo = 0
    let hi = onsets.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (onsets[mid].time < t - win) lo = mid + 1
      else hi = mid
    }
    let best = null
    for (let i = lo; i < onsets.length && onsets[i].time <= t + win; i++) {
      const o = onsets[i]
      const score = o.strength - Math.abs(o.time - t) * 4
      if (!best || score > best.score) best = { ...o, score }
    }
    return best
  }
  // Sound lands exactly on the music's own transient when one sits within ±maxDev of the grid point
  const snap = (t, maxDev = 0.022, minStrength = 0.22) => {
    const o = onsetNear(t, maxDev)
    return o && o.strength >= minStrength ? o.time : t
  }
  const pointAt = (p) => {
    const q = Math.round(p * 4) / 4
    const frac = q - Math.floor(q)
    const level = frac === 0 ? 'beat' : frac === 0.5 ? 'half' : 'quarter'
    const info = level === 'beat' ? beatInfoAt(Math.round(q)) : null
    return { time: timeAt(q), pos: q, level, strong: Boolean(info?.strong), isDrop: Boolean(info?.isDrop) }
  }
  // Grid points at 1/div-beat resolution inside [a, b)
  const points = (a, b, div = 1) => {
    const out = []
    if (!(b > a)) return out
    let k = Math.ceil(posAt(a) * div - 1e-6)
    for (let guard = 0; guard < 6000; guard++, k++) {
      const pt = pointAt(k / div)
      if (pt.time >= b) break
      if (pt.time >= a) out.push(pt)
    }
    return out
  }
  const drops = (Array.isArray(beatMeta?.drops) ? beatMeta.drops : [])
    .map((d) => (typeof d === 'number' ? d : Number(d?.time)))
    .filter((d) => Number.isFinite(d))
    .sort((a, b) => a - b)
  return { beats, step, firstBeat: phase, timeAt, posAt, pointAt, points, onsets, onsetNear, snap, drops, hasOnsets: onsets.length > 0 }
}

/** Epic genres: minimum spacing between the cut accents of clean shots (≈ one bar at 90–96 BPM). */
export const CUT_ACCENT_MIN_GAP_SEC = 2.5
// A history film is not automatically a war film: biographies of poets, painters, scholars or emperors at court get
// the transition sounds of an epic film without war drums and steel.
const MARTIAL_RX = /战|兵|将军|武将|大将|杀|戟|剑|刀|枪|矛|弓|箭|骑|阵|铁甲|铠甲|甲胄|攻城|征伐|霸王|楚汉|三国|battle|war|sword|spear|army|cavalry|knight/i

/** True when enough shots of a film show fighting, soldiers or weapons for martial accents (war drum, blade swish). */
export function isMartialFilm(scenes = []) {
  const list = Array.isArray(scenes) ? scenes : []
  if (!list.length) return false
  const hits = list.filter((sc) =>
    MARTIAL_RX.test(`${sc?.title || ''} ${sc?.visualBlueprint || ''} ${sc?.motionNotes || ''} ${sc?.narration || ''}`) ||
    ['clash-flurry', 'single-clash', 'cavalry'].includes(String(sc?.actionMode || sc?.directorActionMode || '')),
  ).length
  return hits >= Math.max(1, Math.ceil(list.length * 0.15))
}
/** Epic genres: minimum spacing between slash-wipe sweeps on action shots (was 9 s: long stretches without a sound). */
export const SWEEP_MIN_GAP_SEC = 4

/**
 * Align transition & impact SFX cues onto EXACT BGM beat/half-beat/quarter-beat timestamps,
 * producing a shared `scene.actionEvents` timeline so audio SFX and visual combat animations
 * (blade slashes, clash sparks, camera shake, strobe flash, kill counter) trigger on the same frame.
 *
 * Cue contract: `offsetSec` = musical hit time relative to the shot start (exact, may be up to one frame
 * negative for hits on the cut), `leadSec` = pre-roll of the sample before its hit (whoosh / hooves / sweep).
 */
export function choreographBeatSfxCues(scenes = [], beatMeta = {}, opts = {}) {
  const list = Array.isArray(scenes) ? scenes : []
  if (!list.length) return []
  const fps = Math.max(15, Math.min(60, Number(opts.fps) || 30))
  const grid = createMusicalGrid(beatMeta)
  const step = grid.step
  const sfxPick = typeof opts.sfxPick === 'function' ? opts.sfxPick : (kind) => `audio/sfx/${kind}.wav`
  const profile = resolveAdaptiveAudioProfile(opts)
  const pal = profile.sfxPalette || GENRE_AUDIO_PROFILES['product-promo'].sfxPalette
  const isEpicCombat = profile.genreKey === 'history-theater'
  const volScale = profile.beatCutIntensity === 'gentle' ? 0.76 : profile.beatCutIntensity === 'medium' ? 0.9 : 1.0
  const pickFrom = (arr, fallback, i = 0) => {
    const l = Array.isArray(arr) && arr.length > 0 ? arr : [fallback]
    return String(l[i % l.length] || fallback)
  }
  const EPIC_ALLOWED_TX = ['cut', 'flash-cut', 'slash-wipe', 'zoom-punch']
  const COMBAT_MODES = new Set(['clash-flurry', 'single-clash', 'cavalry'])
  const martialFilm = isEpicCombat && isMartialFilm(list)

  let killStep = 0
  let lastSweepAbs = -1e9
  let lastCutAccentAbs = -1e9
  let cutAccentCount = 0
  let prevMode = 'clean'
  const out = []

  for (let idx = 0; idx < list.length; idx++) {
    const sc = list[idx]
    const startSec = Number(sc.startSec) || 0
    const durRaw = Number(sc.durationSec)
    const dur = Math.max(0.2, Number.isFinite(durRaw) && durRaw > 0 ? durRaw : (Number(sc.durationInFrames) || 120) / fps)
    const durFrames = Math.max(1, Number(sc.durationInFrames) || Math.round(dur * fps))
    const endSec = startSec + dur
    const cues = []
    const actionEvents = []
    const seedBase = idx * 101 + 17

    const eventFor = (hitAbs, kind, role, intensity, pan, extra = {}) => {
      const rel = Math.max(0, hitAbs - startSec)
      const frame = Math.min(durFrames - 1, Math.max(0, Math.round(rel * fps)))
      return {
        frame,
        offsetSec: round4(frame / fps),
        absSec: round4(startSec + frame / fps),
        hitSec: round4(hitAbs),
        kind,
        role,
        intensity: round2(clampNum(Number(intensity) || 0.8, 0.2, 1)),
        pan: round2(clampNum(Number(pan) || 0, -0.85, 0.85)),
        ...extra,
      }
    }
    // Sound + matching visual event at an exact musical time
    const add = (hitAbs, type, volume, pan = 0, extra = {}) => {
      const { leadSec = 0, role = 'hit', d, durationMs, intensity, ...rest } = extra
      const rel = hitAbs - startSec
      if (!Number.isFinite(rel) || rel < -0.035 || rel > dur - 0.01) return false
      const relC = Math.max(-0.035, rel)
      if (cues.some((c) => c.type === type && Math.abs(c.offsetSec - relC) < 0.045)) return false
      const cue = {
        type,
        path: sfxPick(type),
        offsetSec: round4(relC),
        volume: round2(clampNum(volume * volScale, 0.12, 1)),
        pan: round2(clampNum(pan, -0.85, 0.85)),
        seed: seedBase + cues.length * 7,
      }
      if (leadSec > 0) cue.leadSec = round4(leadSec)
      if (d) cue.d = round4(d)
      if (durationMs) cue.durationMs = Math.round(durationMs)
      cues.push(cue)
      actionEvents.push(eventFor(hitAbs, type, role, intensity ?? volume, pan, leadSec > 0 ? { leadFrames: Math.round(leadSec * fps), ...rest } : rest))
      return true
    }
    // Visual-only event (e.g. each gallop stride accent) — no extra sound
    const mark = (hitAbs, kind, role, intensity, pan = 0, extra = {}) => {
      if (hitAbs < startSec - 0.035 || hitAbs > endSec - 0.01) return
      actionEvents.push(eventFor(hitAbs, kind, role, intensity, pan, extra))
    }

    const dropsIn = grid.drops.filter((t) => t >= startSec - 0.035 && t < endSec - 0.05)
    const nearDrop = grid.drops.some((t) => Math.abs(t - startSec) <= 0.18)
    const explained = explainSceneActionMode(sc, { nearDrop, genreKey: profile.genreKey, idx })
    const actionMode = explained.mode
    const textInfo = explained.text || {}

    // Sanitize transitions for historical/epic combat genres (no cyberpunk glitch-cut, no cartoon iris-circle)
    let cleanTransition = sc.transition || 'cut'
    if (isEpicCombat) {
      if (idx === 0) cleanTransition = 'cut'
      else if (!EPIC_ALLOWED_TX.includes(cleanTransition)) {
        cleanTransition =
          actionMode === 'clash-flurry'
            ? 'slash-wipe'
            : actionMode === 'single-clash' || nearDrop
              ? 'flash-cut'
              : actionMode === 'cavalry'
                ? 'zoom-punch'
                : 'cut'
      }
    }

    if (isEpicCombat) {
      const basePos = Math.round(grid.posAt(startSec) * 4) / 4
      const inShot = (pt) => pt && pt.time >= startSec - 0.035 && pt.time <= endSec - 0.1
      const impactBeats = (Array.isArray(sc.impactBeats) ? sc.impactBeats : [])
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 16)
      const fromImpactBeats = () =>
        impactBeats
          .map((b) => grid.pointAt(basePos + Math.round(b * 4) / 4))
          .filter(inShot)
          .sort((a, b) => a.time - b.time)
      const fromBeatRefs = (refs) => refs.map((r) => grid.pointAt(basePos + (r - 1))).filter(inShot)
      const markDrop = (pt) => ({ ...pt, isDrop: pt.isDrop || dropsIn.some((d) => Math.abs(d - pt.time) < 0.06) })

      if (actionMode === 'clash-flurry' || actionMode === 'single-clash') {
        if (prevMode !== 'clash-flurry' && prevMode !== 'single-clash' && prevMode !== 'cavalry') killStep = 0
      } else if (actionMode !== 'cavalry') {
        killStep = 0
      }

      if (actionMode === 'clash-flurry') {
        // Rapid melee: a visible weapon contact on the half-beat grid ("锵 锵 锵 锵 锵 — 锵锵 锵!"),
        // quarter-beat doubles only where the BGM itself accents a 16th, a one-slot breath before the finisher.
        const half = grid.points(startSec - 0.035, endSec - 0.12, 2)
        let hits = fromImpactBeats()
        if (!hits.length && textInfo.contactBeats?.length >= 2) hits = fromBeatRefs(textInfo.contactBeats)
        if (!hits.length && textInfo.count >= 2 && half.length) {
          const want = Math.min(textInfo.count, half.length)
          const from = textInfo.halfBeat && half.length > want ? 1 : 0
          const span = half.length - 1 - from
          const picks = new Set()
          for (let k = 0; k < want; k++) picks.add(from + Math.round(want === 1 ? 0 : (k * span) / (want - 1)))
          hits = Array.from(picks).sort((a, b) => a - b).map((i) => half[i])
        }
        if (!hits.length) {
          const nSlots = half.length
          if (nSlots <= 3) hits = half.slice()
          else {
            const breath = nSlots - 3
            hits = half.filter((_, i) => i !== breath)
            // "锵锵": quarter double right after the breath, unless the music already offers its own 16th accent
            const last = hits[hits.length - 1]
            const prev = hits[hits.length - 2]
            if (prev && last && last.pos - prev.pos >= 0.5 && !grid.hasOnsets) {
              hits.splice(hits.length - 1, 0, grid.pointAt(prev.pos + 0.25))
            }
          }
          if (grid.hasOnsets) {
            let doubles = 0
            const base = hits.slice()
            for (let k = 0; k < base.length - 1 && doubles < 2; k++) {
              if (base[k + 1].pos - base[k].pos !== 0.5) continue
              const q = grid.pointAt(base[k].pos + 0.25)
              const o = grid.onsetNear(q.time, 0.02)
              if (o && o.strength >= 0.45) {
                hits.push(q)
                doubles++
              }
            }
            hits.sort((a, b) => a.time - b.time)
          }
        }
        if (!hits.length) hits = [grid.pointAt(basePos)]
        hits = hits.map(markDrop)
        const nHits = hits.length
        for (let k = 0; k < nHits; k++) {
          const pt = hits[k]
          const isLast = k === nHits - 1 && nHits > 1
          const isQuarter = pt.level === 'quarter'
          const t = grid.snap(pt.time)
          killStep++
          const type = isLast || pt.isDrop ? 'metal_clash_heavy' : isQuarter || k % 2 === 1 ? 'metal_clash_hi' : 'metal_clash'
          const pan = isLast ? 0 : k % 2 === 0 ? -0.3 : 0.3
          const vol = isLast ? 1.0 : isQuarter ? 0.84 : 0.86 + 0.1 * (k / Math.max(1, nHits - 1))
          if ((k % 2 === 0 || isLast) && !isQuarter && t - 0.16 >= 0) {
            add(t, 'blade_whoosh', 0.42, -pan * 0.7, { role: 'whoosh', leadSec: 0.16, contactIndex: k })
          }
          add(t, type, vol, pan, { role: 'clash', killStep, contactIndex: k, swingFrames: Math.round(fps * Math.min(0.2, step / 3)), sub: pt.level })
          if ((isLast && (pt.strong || pt.isDrop)) || (pt.isDrop && !isLast)) {
            add(t, 'heavy_impact', 0.62, 0, { role: 'drop', intensity: 0.9 })
          }
        }
      } else if (actionMode === 'single-clash') {
        let pt = fromImpactBeats()[0] || fromBeatRefs(textInfo.contactBeats || [])[0] || null
        if (!pt && dropsIn.length) pt = { ...grid.pointAt(Math.round(grid.posAt(dropsIn[0]) * 2) / 2), time: dropsIn[0], isDrop: true, strong: true }
        if (!pt) {
          const cands = grid.points(startSec - 0.035, endSec - 0.15, 2)
          if (dur <= step * 1.3 || cands.length <= 2) pt = cands[0] || grid.pointAt(basePos)
          else {
            const after = cands.filter((c) => c.time >= startSec + step * 0.45)
            pt =
              after.find((c) => c.strong) ||
              after.filter((c) => c.level === 'beat').sort((a, b) => (grid.onsetNear(b.time)?.strength || 0) - (grid.onsetNear(a.time)?.strength || 0))[0] ||
              cands[0]
          }
        }
        pt = markDrop(pt)
        const t = grid.snap(pt.time)
        const heavy = textInfo.heavyTone || pt.isDrop || String(sc?.stageSpec?.archetype || '') === 'slash-climax'
        const type = textInfo.brightTone && !pt.isDrop ? 'metal_clash_hi' : heavy ? 'metal_clash_heavy' : 'metal_clash'
        killStep++
        if (t - 0.16 >= 0) add(t, 'blade_whoosh', 0.46, -0.2, { role: 'whoosh', leadSec: 0.16, contactIndex: 0 })
        add(t, type, 0.97, 0.08, { role: 'clash', killStep, contactIndex: 0, swingFrames: Math.round(fps * Math.min(0.2, step / 3)), sub: pt.level })
        if (pt.isDrop) add(t, 'heavy_impact', 0.66, 0, { role: 'drop', intensity: 0.9 })
      } else if (actionMode === 'cavalry') {
        // Tempo-locked gallop ("da-da-DUM" per beat, accent ON the beat) + a war drum only where a charge begins
        const beatsIn = grid.points(startSec - 0.035, endSec - 0.05, 1)
        if (beatsIn.length) {
          const pan = idx % 2 === 0 ? -0.18 : 0.18
          const lead = 0.25 * step
          add(beatsIn[0].time, 'horse_gallop', 0.56, pan, {
            role: 'gallop',
            leadSec: lead,
            d: step,
            durationMs: (beatsIn.length * step + 0.05) * 1000,
            intensity: 0.5,
            strides: beatsIn.length,
          })
          beatsIn.forEach((b, bi) => mark(b.time, 'hoof', 'hoof', b.strong ? 0.62 : 0.48, pan, { stride: bi }))
          for (const b of fromBeatRefs(textInfo.hoofBeats || [])) add(grid.snap(b.time), 'hoof_stomp', 0.8, -pan, { role: 'hoof', intensity: 0.75 })
          if (!COMBAT_MODES.has(prevMode)) {
            const onCut = beatsIn[0] && Math.abs(beatsIn[0].time - startSec) < 0.05 ? beatsIn[0] : null
            const drumAt = (onCut && (onCut.strong || onCut.isDrop) ? onCut : beatsIn.find((b) => b.strong)) || onCut
            if (drumAt) add(grid.snap(drumAt.time), 'war_drum', 0.72, 0, { role: 'drum', intensity: 0.7 })
          }
        }
      } else if (actionMode === 'drop-impact') {
        let t0 = dropsIn[0]
        if (t0 === undefined) {
          const bs = grid.points(Math.max(startSec - 0.035, grid.firstBeat - 0.035), endSec - 0.1, 1)
          const onCut = bs[0] && Math.abs(bs[0].time - startSec) < 0.05 ? bs[0] : null
          const pick = idx === 0 ? bs[0] : onCut && (onCut.strong || onCut.isDrop) ? onCut : bs.find((b) => b.strong) || onCut
          t0 = pick ? pick.time : undefined
        }
        if (t0 !== undefined) add(grid.snap(t0), idx === 0 && martialFilm ? 'war_drum' : 'heavy_impact', 0.86, 0, { role: 'drop', intensity: 0.9 })
      }
      // 'clean': picture without action → no clash, gallop or impact of its own; only its cut may speak (below).

      // Beat-locked cut accent: a clean shot whose cut lands ON a downbeat / drop gets one short epic hit that matches
      // the transition (war drum → the camera rig punches in; blade swish; slash sweep). Never a chime, never steel
      // without visible contact, never a flash-producing impact on a clean shot; at least CUT_ACCENT_MIN_GAP_SEC apart.
      // Off-beat cuts and the opening shot stay silent (the shot's ambience bed carries them). A history film without
      // fighting (a poet, a painter, a court) uses the same grid with an unpitched whoosh and a low boom on drops
      // instead of war drums and blades.
      if (idx > 0 && actionMode === 'clean' && startSec - lastCutAccentAbs >= CUT_ACCENT_MIN_GAP_SEC) {
        const cutPt = grid.points(startSec - 0.04, startSec + 0.04, 1)[0]
        const onDrop = Boolean(cutPt && (cutPt.isDrop || dropsIn.some((d) => Math.abs(d - startSec) < 0.06)))
        if (cutPt && (cutPt.strong || onDrop)) {
          const t = grid.snap(cutPt.time)
          const pan = idx % 2 === 0 ? -0.2 : 0.2
          let placed = false
          if (!martialFilm) {
            placed = onDrop
              ? add(t, 'sub_boom', 0.5, 0, { role: 'cut', intensity: 0.5 })
              : add(t, 'whoosh', 0.42, pan, { role: 'cut', leadSec: 0.16, intensity: 0.4 })
          } else if (cleanTransition === 'slash-wipe') {
            placed = add(t, 'slash_sweep', 0.5, 0, { role: 'sweep', leadSec: 0.2, intensity: 0.55 })
            if (placed) lastSweepAbs = startSec
          } else if (onDrop || cleanTransition === 'zoom-punch' || cleanTransition === 'flash-cut' || cutAccentCount % 2 === 0) {
            placed = add(t, 'war_drum', onDrop ? 0.7 : 0.62, 0, { role: 'cut', intensity: onDrop ? 0.7 : 0.6 })
          } else {
            placed = add(t, 'blade_whoosh', 0.44, pan, { role: 'cut', leadSec: 0.16, intensity: 0.45 })
          }
          if (placed) {
            lastCutAccentAbs = startSec
            cutAccentCount++
          }
        }
      }

      // Beat-locked transition sweep on action shots: a slash-wipe cut on a downbeat, spaced out, never on top of a clash
      if (idx > 0 && cleanTransition === 'slash-wipe' && actionMode !== 'clash-flurry' && actionMode !== 'clean' && startSec - lastSweepAbs >= SWEEP_MIN_GAP_SEC) {
        const cutPt = grid.points(startSec - 0.04, startSec + 0.04, 1)[0]
        const cutBusy = cues.some((c) => Math.abs(c.offsetSec) < 0.07 && /metal_clash|heavy_impact|war_drum/.test(c.type))
        if (cutPt && (cutPt.strong || cutPt.isDrop) && !cutBusy) {
          if (add(grid.snap(cutPt.time), 'slash_sweep', 0.5, 0, { role: 'sweep', leadSec: 0.2, intensity: 0.55 })) lastSweepAbs = startSec
        }
      }
    } else {
      // =========================================================================
      // NON-EPIC GENRES (Tutorial / Product Promo / Science / Data / Story / etc.)
      // Cross-genre adaptive palette, strictly placed on measured beats.
      // =========================================================================
      const arch = String(sc.stageSpec?.archetype || '').toLowerCase()
      const layoutStr = String(sc.layout || '')
      const blueStr = `${sc.visualBlueprint || ''} ${sc.motionNotes || ''} ${sc.title || ''} ${sc.narration || ''}`
      const isAction =
        sc.transition === 'flash-cut' || sc.transition === 'slash-wipe' || /冲击|爆发|劈|闪切|撞击|跃迁|点击|高光|切换/i.test(blueStr)
      const isMapOrData = /strategic-map|scroll-calligraphy|bamboo-slips|metric-dashboard|workflow-steps|chart|ranking|code/i.test(
        `${arch} ${layoutStr} ${blueStr}`,
      )
      if (idx === 0) {
        add(startSec, pickFrom(pal.opener, 'hit', 0), 0.85, 0, { role: 'opener' })
      } else if (nearDrop || sc.transition === 'zoom-punch' || sc.transition === 'glitch-cut') {
        add(startSec, sc.transition === 'glitch-cut' ? 'glitch' : pickFrom(pal.drop, 'sub_drop', idx), 0.88, 0, { role: 'drop' })
      } else if (isAction) {
        add(startSec, pickFrom(pal.action, 'whoosh', idx), 0.82, idx % 2 === 0 ? -0.16 : 0.16, { role: 'action' })
      } else if (isMapOrData) {
        add(startSec, pickFrom(pal.data, 'counter', idx), 0.78, 0, { role: 'data' })
      } else if (profile.beatCutIntensity !== 'gentle' || idx % 2 === 0) {
        add(startSec, pickFrom(pal.neutral, 'whoosh', idx), 0.72, idx % 2 === 0 ? -0.1 : 0.1, { role: 'neutral' })
      }
      const internal = grid.points(startSec + 0.35, endSec - 0.35, 1)
      const preferred = internal.filter((b) => b.strong)
      const maxHits = profile.beatCutIntensity === 'gentle' ? (dur >= 4.5 ? 1 : 0) : dur >= 3.2 ? 1 : 0
      const chosen = (preferred.length > 0 ? preferred : internal).slice(0, maxHits)
      for (let hi = 0; hi < chosen.length; hi++) {
        add(chosen[hi].time, pickFrom(pal.internal, isMapOrData ? 'counter' : 'pop_soft', idx + hi), 0.72, (idx + hi) % 2 === 0 ? 0.18 : -0.18, { role: 'accent' })
      }
    }

    cues.sort((a, b) => a.offsetSec - b.offsetSec)
    actionEvents.sort((a, b) => a.frame - b.frame || String(a.role).localeCompare(String(b.role)))
    prevMode = actionMode
    out.push({
      ...sc,
      transition: cleanTransition,
      directorActionMode: sc.directorActionMode || (ACTION_MODES.includes(String(sc.actionMode || '')) ? sc.actionMode : undefined),
      actionMode,
      actionReason: explained.reason,
      actionEvents,
      sfxCues: cues,
    })
  }
  return out
}
