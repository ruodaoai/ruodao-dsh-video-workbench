/**
 * Audio Synthesizer & Multi-Track Mixer
 * - Delegates 48kHz stereo synthesis & Schroeder stereo reverb to `./audio-dsp.js`
 * - Supports 24+ kinetic SFX types (`hit`, `whoosh`, `swoosh`, `glitch`, `pop`, `thud`, `card`, `sparkle`, `chime`, `riser`, `sub_drop`, `crash_cym`, `suck`, `counter`, `typing`, `stamp`, etc.)
 * - Generates beat-locked multi-instrument BGM (drums, analog bass, stereo pad, FM e-piano, arp pluck)
 * - Mixes Voice Narration + Procedural Reverb SFX Bus + User Custom SFX + Sidechain-Ducked BGM via FFmpeg into `output/master-audio.wav`
 */
import { copyFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { ffmpegAmixNoRescale, ffmpegPadTo, probeAudioDuration, resolveBinaries, runCommandRedirected } from '../shared/index.js'
import {
  buildBeatGrid,
  DSP_SR,
  encodeStereoWav,
  renderBgmWavBuffer,
  renderSfxMasterBuffer,
  synthSfxStereo,
} from './audio-dsp.js'

import { planAmbienceSegments, renderAmbienceBedWav } from './ambience-dsp.js'
import {
  analyzeAudioBeatStructure,
  choreographBeatSfxCues,
  GENRE_AUDIO_PROFILES,
  quantizeScenesToBeatGrid,
  resolveAdaptiveAudioProfile,
  snapTimeToBeatGrid,
} from './beat-analyzer.js'

const SR = DSP_SR

// amix without rescaling on every FFmpeg build (see ffmpegAmixNoRescale in shared/index.js)
function formatAmixChain(inputs, durationMode, ffmpegBin) {
  return ffmpegAmixNoRescale(ffmpegBin, inputs, { duration: durationMode })
}

export {
  analyzeAudioBeatStructure,
  buildBeatGrid,
  choreographBeatSfxCues,
  GENRE_AUDIO_PROFILES,
  quantizeScenesToBeatGrid,
  resolveAdaptiveAudioProfile,
  snapTimeToBeatGrid,
}

export function generateSfxWav(type, outPath, opts = {}) {
  mkdirSync(dirname(outPath), { recursive: true })
  const { L, R } = synthSfxStereo(type, opts)
  writeFileSync(outPath, encodeStereoWav(L, R, SR))
  return outPath
}

/**
 * Audibility thresholds for a music bed (FFmpeg `volumedetect`): digital silence reads about −91 dB on 16-bit files;
 * even a quiet ambient bed at −40 LUFS peaks well above −50 dB.
 */
export const SILENT_BED_MAX_DB = -50
export const SILENT_BED_MEAN_DB = -60

/**
 * Peak / mean level of a file's audio via `volumedetect` (available on every FFmpeg build, unlike ebur128's newer
 * options); null when it cannot be measured.
 */
export async function measureAudioPresence(ffmpeg, file, { signal } = {}) {
  try {
    const res = await runCommandRedirected(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { timeoutMs: 180_000, signal })
    if (res.code !== 0) return null
    const txt = `${res.stderr || ''}\n${res.stdout || ''}`
    const num = (re) => {
      const m = txt.match(re)
      if (!m) return null
      return m[1] === '-inf' ? -Infinity : Number(m[1])
    }
    const maxDb = num(/max_volume:\s*(-inf|-?[\d.]+)\s*dB/)
    const meanDb = num(/mean_volume:\s*(-inf|-?[\d.]+)\s*dB/)
    if (maxDb === null || Number.isNaN(maxDb)) return null
    return { maxDb, meanDb }
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') throw err
    return null
  }
}

/** true = audible, false = measured silent, null = could not be measured (callers keep their previous behaviour). */
export async function isAudibleAudio(ffmpeg, file, opts = {}) {
  const p = await measureAudioPresence(ffmpeg, file, opts)
  if (!p) return null
  return p.maxDb > SILENT_BED_MAX_DB && (p.meanDb === null || p.meanDb > SILENT_BED_MEAN_DB)
}

export function generateBgmWav({ durationSec = 20, mood = 'tech', bpm, audioSpec = null, outPath }) {
  mkdirSync(dirname(outPath), { recursive: true })
  const buf = renderBgmWavBuffer({ durationSec, mood, bpm, audioSpec })
  writeFileSync(outPath, buf)
  return outPath
}

const CORE_SFX_KINDS = [
  'hit',
  'whoosh',
  'swoosh',
  'glitch',
  'pop',
  'pop_soft',
  'thud',
  'card',
  'slash',
  'metal_clash',
  'metal_clash_hi',
  'metal_clash_heavy',
  'blade_whoosh',
  'war_drum',
  'heavy_impact',
  'horse_gallop',
  'arrow_zip',
  'sparkle',
  'chime',
  'shine',
  'shimmer_swell',
  'counter',
  'typing',
  'click',
  'flip',
  'boing',
  'shutter',
  'radar',
  'bell_warm',
  'riser',
  'suck',
  'sub_drop',
  'crash_cym',
  'stamp',
  'tick',
  'hoof_stomp',
  'slash_sweep',
]

/**
 * Ensure SFX & BGM assets exist for a project (preferring user's imported files,
 * falling back to beat-matched 48kHz stereo DSP synthesis).
 */
export async function ensureProjectAudioAssets(projectDir, script, assetsManifest) {
  const absDir = resolve(projectDir)
  const sfxDir = join(absDir, 'audio', 'sfx')
  mkdirSync(sfxDir, { recursive: true })

  const builtinSfx = {}
  for (const kind of CORE_SFX_KINDS) {
    const aiRel = `audio/sfx/${kind}-ai.wav`
    const aiAbs = join(absDir, aiRel)
    if (existsSync(aiAbs)) {
      builtinSfx[kind] = aiRel
      continue
    }
    const p = join(sfxDir, `${kind}.wav`)
    if (!existsSync(p)) generateSfxWav(kind, p)
    builtinSfx[kind] = `audio/sfx/${kind}.wav`
  }

  const importedMusic = (assetsManifest?.items || []).filter((it) => it.role === 'music')
  const totalSec = Math.max(2, Number(script?.totalDurationSec) || 12)
  const bgmMode = script?.audioSpec?.bgmMode || script?.bgmMode || script?.bgm?.mode || 'auto'
  let bgmPath = ''
  let bgmSource = 'generated'

  const candidateExists = (p) => Boolean(p && existsSync(isAbsolute(p) ? p : join(absDir, p)))

  if (bgmMode === 'uploaded') {
    const selected = script?.bgm?.uploadedPath || importedMusic[0]?.path || script?.bgm?.path || ''
    if (candidateExists(selected)) {
      bgmPath = selected
      bgmSource = 'user-imported'
    } else if (importedMusic.length > 0 && candidateExists(importedMusic[0].path)) {
      bgmPath = importedMusic[0].path
      bgmSource = 'user-imported'
    }
  } else if (bgmMode === 'llm-coded') {
    if (candidateExists('audio/bgm-llm.wav')) {
      bgmPath = 'audio/bgm-llm.wav'
      bgmSource = 'llm-coded'
    } else if (importedMusic.length > 0 && candidateExists(importedMusic[0].path)) {
      bgmPath = importedMusic[0].path
      bgmSource = 'user-imported'
    } else if (candidateExists(script?.bgm?.path)) {
      bgmPath = script.bgm.path
      bgmSource = script?.bgm?.source || 'llm-coded'
    }
  } else if (bgmMode === 'tts-engine') {
    if (candidateExists('audio/bgm-tts.wav')) {
      bgmPath = 'audio/bgm-tts.wav'
      bgmSource = 'tts-engine'
    } else if (candidateExists(script?.bgm?.path)) {
      bgmPath = script.bgm.path
      bgmSource = 'tts-engine'
    }
  } else if (importedMusic.length > 0 && candidateExists(importedMusic[0].path)) {
    bgmPath = importedMusic[0].path
    bgmSource = 'user-imported'
  }

  if (!bgmPath && candidateExists(script?.bgm?.path)) {
    bgmPath = script.bgm.path
    bgmSource = script?.bgm?.source || 'generated'
  }

  if (!bgmPath) {
    if (importedMusic.length > 0) {
      bgmPath = importedMusic[0].path
      bgmSource = 'user-imported'
    } else {
      const mood = script?.audioSpec?.mood || script?.bgm?.mood || script?.style || 'tech'
      const bpm = script?.audioSpec?.bpm || script?.bgm?.bpm
      const genPath = join(absDir, 'audio', 'bgm-generated.wav')
      generateBgmWav({ durationSec: totalSec + 1.2, mood, bpm, audioSpec: script?.audioSpec || null, outPath: genPath })
      bgmPath = 'audio/bgm-generated.wav'
      bgmSource = script?.audioSpec ? 'ai-audio-spec' : 'generated'
    }
  }

  return { builtinSfx, bgmPath, bgmSource, bgmMode }
}

/**
 * Integrated loudness (EBU R128) and true peak of an audio/video file, or nulls when unmeasurable.
 */
export async function measureLoudnessStats(ffmpeg, file, { signal } = {}) {
  try {
    const res = await runCommandRedirected(
      ffmpeg,
      ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'aresample=48000,ebur128=peak=true:framelog=quiet', '-f', 'null', '-'],
      { timeoutMs: 180_000, signal },
    )
    // A failed run still prints an empty summary ("I: 0.0 LUFS", "Peak: -inf") — never trust it
    if (res.code !== 0) return { lufs: null, truePeak: null }
    const txt = `${res.stderr || ''}\n${res.stdout || ''}`
    const iM = [...txt.matchAll(/^\s*I:\s*([-\d.]+)\s*LUFS/gm)]
    const pM = [...txt.matchAll(/^\s*Peak:\s*([-\d.]+)\s*dBFS/gm)]
    const lufs = iM.length ? Number(iM[iM.length - 1][1]) : NaN
    const peak = pM.length ? Number(pM[pM.length - 1][1]) : NaN
    return {
      lufs: Number.isFinite(lufs) && lufs < -0.5 && lufs > -69 ? lufs : null,
      truePeak: Number.isFinite(peak) && peak < 12 ? peak : null,
    }
  } catch {
    return { lufs: null, truePeak: null }
  }
}

/**
 * Integrated loudness of several stem files summed together (amix without normalisation).
 */
async function measureStemSumLoudness(ffmpeg, files, { signal } = {}) {
  if (files.length === 1) return measureLoudnessStats(ffmpeg, files[0], { signal })
  try {
    const args = ['-hide_banner', '-nostats']
    for (const f of files) args.push('-i', f)
    const ins = files.map((_, i) => `[${i}:a]`).join('')
    args.push('-filter_complex', `${ins}${formatAmixChain(files.length, 'longest', ffmpeg)},aresample=${SR},ebur128=peak=true:framelog=quiet`, '-f', 'null', '-')
    const res = await runCommandRedirected(ffmpeg, args, { timeoutMs: 180_000, signal })
    if (res.code !== 0) return { lufs: null, truePeak: null }
    const txt = `${res.stderr || ''}\n${res.stdout || ''}`
    const iM = [...txt.matchAll(/^\s*I:\s*([-\d.]+)\s*LUFS/gm)]
    const lufs = iM.length ? Number(iM[iM.length - 1][1]) : NaN
    return { lufs: Number.isFinite(lufs) && lufs < -0.5 && lufs > -69 ? lufs : null, truePeak: null }
  } catch {
    return { lufs: null, truePeak: null }
  }
}

/**
 * Level-match the pre-limiter stems to the finished master (one static gain for all stems, so their sum
 * reproduces the master's gain staging) and describe them.
 */
async function finalizeAudioStems({ ffmpeg, outWav, stemOutputs, stemsDir, totalSec, signal, onChild }) {
  const present = stemOutputs.filter((s) => !s.silent && s.path && existsSync(s.path))
  let gainDb = 0
  if (present.length > 0) {
    const master = await measureLoudnessStats(ffmpeg, outWav, { signal })
    const sum = await measureStemSumLoudness(ffmpeg, present.map((s) => s.path), { signal })
    if (Number.isFinite(master.lufs) && Number.isFinite(sum.lufs)) {
      gainDb = Math.max(-12, Math.min(12, master.lufs - sum.lufs))
    }
    if (Math.abs(gainDb) >= 0.05) {
      for (const s of present) {
        const tmp = `${s.path.replace(/\.wav$/i, '')}.gain.wav`
        const res = await runCommandRedirected(
          ffmpeg,
          ['-y', '-hide_banner', '-i', s.path, '-af', `volume=${gainDb.toFixed(2)}dB`, '-c:a', 'pcm_f32le', '-ar', String(SR), tmp],
          { timeoutMs: Math.max(120_000, Math.round(totalSec * 1500)), signal, onChild },
        )
        if (res.code === 0 && existsSync(tmp)) {
          copyFileSync(tmp, s.path)
        }
        try {
          unlinkSync(tmp)
        } catch {}
      }
    }
  }
  const byRole = Object.fromEntries(stemOutputs.map((s) => [s.role, s]))
  return {
    dir: stemsDir,
    voice: byRole.voice?.path || '',
    sfx: byRole.sfx?.path || '',
    bgm: byRole.bgm?.path || '',
    roles: Object.fromEntries(stemOutputs.map((s) => [s.role, s.silent ? 'silent' : 'present'])),
    format: 'pcm_f32le',
    sampleRate: SR,
    durationSec: Number(Number(totalSec).toFixed(4)),
    gainDb: Number(gainDb.toFixed(2)),
    reference: 'pre-limiter bus taps (same timing/ducking as master), level-matched to master integrated loudness',
  }
}

/**
 * Mix Voice Narration + Procedural Reverb SFX Bus + User Custom SFX + Sidechain-Ducked BGM into `output/master-audio.wav`.
 * Opt-in `writeStems` additionally writes aligned `stems/{voice,sfx,bgm}.wav` (default master output unchanged).
 */
export async function mixVideoAudio({ projectDir, script, assetsManifest, outputPath, signal, onChild, writeStems = false, stemsDir = '' }) {
  if (signal?.aborted) throw new Error('Audio mix aborted')
  const absDir = resolve(projectDir)
  const outWav = outputPath ? resolve(absDir, outputPath) : join(absDir, 'output', 'master-audio.wav')
  mkdirSync(dirname(outWav), { recursive: true })

  const totalSec = Math.max(1, Number(script.totalDurationSec) || 10)
  const assetsResolved = await ensureProjectAudioAssets(absDir, script, assetsManifest)
  const { builtinSfx } = assetsResolved
  let { bgmPath, bgmSource } = assetsResolved
  const { ffmpeg } = resolveBinaries()
  // The graph must also run on the npm-bundled 2018 FFmpeg (used when none is configured):
  // - pad with a FINITE apad: an endless `apad` followed by `atrim` never terminates there (the mix hung until its timeout);
  //   every bus input is padded to the full length, so amix keeps a constant scale on builds without `normalize=0`;
  // - pin the stereo layout around sidechaincompress: that build loses the layout through apad / amix / alimiter and then
  //   fails with "No channel layout for input 1". Both are no-ops on current FFmpeg (identical samples).
  const padToEnd = ffmpegPadTo(totalSec, SR)
  const STEREO = 'aformat=channel_layouts=stereo'

  const voiceEvents = []
  const proceduralCues = []
  const customSfxEvents = []

  for (const scene of script.scenes || []) {
    const startSec = Number(scene.startSec || 0)
    const leadSec = Number.isFinite(Number(scene.voiceLeadSec)) ? Number(scene.voiceLeadSec) : 0.3
    const chosenRelVoice =
      scene.masteredAudioFile &&
      existsSync(isAbsolute(scene.masteredAudioFile) ? scene.masteredAudioFile : resolve(absDir, scene.masteredAudioFile))
        ? scene.masteredAudioFile
        : scene.audioFile
    if (chosenRelVoice) {
      const absAudio = isAbsolute(chosenRelVoice) ? chosenRelVoice : resolve(absDir, chosenRelVoice)
      if (existsSync(absAudio)) {
        voiceEvents.push({ path: absAudio, delayMs: Math.max(0, Math.round((startSec + leadSec) * 1000)) })
      }
    }

    const cues = Array.isArray(scene.sfxCues) ? scene.sfxCues : []
    for (const cue of cues) {
      // offsetSec = musical hit time inside the shot (may sit up to one frame before a hit on the cut);
      // leadSec = how much of the sample sounds before that hit (whoosh / hooves / sweep pre-roll)
      const rawOff = Number(cue.offsetSec || 0)
      const leadSec = Math.max(0, Math.min(2, Number(cue.leadSec) || 0))
      const hitSec = startSec + (Number.isFinite(rawOff) ? Math.max(-0.05, rawOff) : 0)
      const atSec = hitSec - leadSec
      if (hitSec >= totalSec || hitSec < 0) continue
      const volume = Number.isFinite(Number(cue.volume)) ? Number(cue.volume) : 0.55
      const pan = Number.isFinite(Number(cue.pan)) ? Number(cue.pan) : 0
      const type = cue.type || 'whoosh'

      // If user supplied a custom non-builtin file path, schedule via FFmpeg; otherwise render through shared DSP stereo reverb bus
      const isCustomPath =
        cue.path &&
        !String(cue.path).replace(/\\/g, '/').startsWith('audio/sfx/')
      const absCustom = isCustomPath ? (isAbsolute(cue.path) ? cue.path : resolve(absDir, cue.path)) : ''

      if (absCustom && existsSync(absCustom)) {
        customSfxEvents.push({
          path: absCustom,
          delayMs: Math.max(0, Math.round(atSec * 1000)),
          volume,
        })
      } else {
        proceduralCues.push({
          type,
          atSec,
          volume,
          pan,
          d: cue.d,
          freqStart: cue.freqStart,
          freqEnd: cue.freqEnd,
          durationMs: cue.durationMs,
          q: cue.q,
          wave: cue.wave,
          noiseMix: cue.noiseMix,
          seed: cue.seed,
        })
      }
    }
  }

  let procSfxWav = ''
  if (proceduralCues.length > 0) {
    procSfxWav = join(absDir, 'audio', 'sfx-master.wav')
    mkdirSync(dirname(procSfxWav), { recursive: true })
    writeFileSync(procSfxWav, renderSfxMasterBuffer({ durationSec: totalSec, cues: proceduralCues }))
  }

  let absBgm = bgmPath ? (isAbsolute(bgmPath) ? bgmPath : resolve(absDir, bgmPath)) : ''
  const hasBgm = Boolean(absBgm && existsSync(absBgm)) && script?.bgm?.enabled !== false
  // Safety net: a music bed that measures silent (a failed AI render left on disk, an empty file) is never mixed as
  // "the BGM" — the procedural synth renders a full-length bed on the script's tempo instead, and the result says so.
  // A track the user imported is left alone.
  let bgmFallback = null
  if (hasBgm && bgmSource !== 'user-imported') {
    // false only when MEASURED silent; an FFmpeg that cannot measure (null) keeps the bed as before
    if ((await isAudibleAudio(ffmpeg, absBgm, { signal })) === false) {
      const fbBpm = Math.round(Number(script?.planBpm) || Number(script?.bgm?.bpm) || Number(script?.audioSpec?.bpm) || 0) || undefined
      const genAbs = join(absDir, 'audio', 'bgm-generated.wav')
      generateBgmWav({
        durationSec: totalSec + 1.2,
        mood: script?.audioSpec?.mood || script?.bgm?.mood || script?.style || 'tech',
        bpm: fbBpm,
        audioSpec: null,
        outPath: genAbs,
      })
      bgmFallback = { reason: 'silent-bgm', from: bgmPath, to: 'audio/bgm-generated.wav', bpm: fbBpm || null }
      absBgm = genAbs
      bgmPath = 'audio/bgm-generated.wav'
      bgmSource = 'generated'
    }
  }
  const isPureMvNoVoice = voiceEvents.length === 0 || script?.narrationMode === 'subtitle-mv'
  const isBeatSyncVoice = !isPureMvNoVoice && (script?.narrationMode === 'tts-beat-sync' || bgmSource === 'user-imported')
  const audioProf = resolveAdaptiveAudioProfile({
    genre: script?.genre,
    genreLabel: script?.genreLabel,
    title: script?.title,
    style: script?.style,
    narrationMode: script?.narrationMode,
    pacingMode: script?.pacingMode,
    audioProfile: script?.audioProfile,
    referenceStyle: script?.referenceStyle,
  })
  const rawBgmVol = Number(script?.bgm?.volume)
  const bgmVol = isPureMvNoVoice
    ? (Number.isFinite(rawBgmVol) && rawBgmVol >= 0.72 && rawBgmVol <= 1.25 ? rawBgmVol : Math.max(1.0, audioProf.bgmVolMv || 1.0))
    : (Number.isFinite(rawBgmVol) && rawBgmVol >= 0.20 && rawBgmVol <= 0.85 ? rawBgmVol : isBeatSyncVoice ? Math.max(audioProf.bgmVolVoice, 0.44) : audioProf.bgmVolVoice)
  const bgmFadeInSec = isPureMvNoVoice ? 0.10 : 0.40
  // Pure-music beat-sync (no TTS): protagonist-grade thrilling loudness (-10.5 LUFS, peak -0.5 dBTP) — NEVER apply -18dB voice ducking!
  // Music-only beat-sync: loud but with transient headroom (-12 … -13 LUFS, close to commercial cut-to-beat
  // edits) so steel clashes stay crisp instead of being squashed by limiting.
  const masterLufs = isPureMvNoVoice ? Math.max(-13.0, Math.min(-12.0, audioProf.targetLufs || -12.0)) : (audioProf.targetLufs || -14.5)
  // Linear BGM gain (keeps the track's own mastering/dynamics) instead of single-pass dynamic loudnorm
  let bgmLinearGainDb = null
  if (isPureMvNoVoice && hasBgm) {
    const bgmStats = await measureLoudnessStats(ffmpeg, absBgm, { signal })
    if (Number.isFinite(bgmStats.lufs)) {
      bgmLinearGainDb = Math.max(-14, Math.min(8, masterLufs - 0.35 - bgmStats.lufs))
    }
  }
  const bgmDuckRatio = audioProf.bgmDuckRatio || 2.6
  const sfxBusBoost = isPureMvNoVoice ? (audioProf.sfxBoostMv || 1.32) : (audioProf.sfxBoostVoice || 1.12)

  // Environmental bed: the sound of the place on screen (wind, river, rain, crowd, street, room…) per shot, from
  // `scene.ambience`. It joins the music bus before the voice / SFX ducking, so it dips under speech like the music
  // and fills the gaps between lines; shots without a place (`none`) stay silent. Opt out with script.ambienceBed=false.
  // A film with neither voice nor music gets no bed (the master normaliser would lift a lone bed to full loudness).
  let ambience = null
  const ambienceOff = script?.ambienceBed === false || String(script?.audioSpec?.ambience || '').toLowerCase() === 'off'
  if (!ambienceOff && (voiceEvents.length > 0 || hasBgm)) {
    const segments = planAmbienceSegments(script.scenes || [], totalSec, { genre: script?.genre, fps: Number(script?.fps) || 30 })
    if (segments.length) {
      const ambPath = join(absDir, 'audio', 'ambience-bed.wav')
      mkdirSync(dirname(ambPath), { recursive: true })
      const seed = Array.from(String(script?.title || '')).reduce((a, ch) => (Math.imul(a, 31) + ch.codePointAt(0)) >>> 0, 7)
      const { wav, coverageSec } = renderAmbienceBedWav({ durationSec: totalSec, segments, seed })
      writeFileSync(ambPath, wav)
      // the bed renders at −24 LUFS and lands ~12–15 dB under the finished programme: ~5 dB under the music bed of a
      // narrated film (and ducked with it under speech), ~11 dB under the voice of a film without music, ~10 dB under a
      // music-only beat edit (texture between the hits, never competing with the track)
      const gainDb = isPureMvNoVoice ? 2 : hasBgm ? Math.max(-10, Math.min(-1, 20 * Math.log10(Math.max(0.05, bgmVol)) + 2.5)) : -3
      ambience = { path: ambPath, gainDb, segments, coverageSec }
    }
  }

  const args = ['-y']
  const filters = []
  let idx = 0

  // Silent base that fixes the mix length (amix duration=first). It is generated inside the filter graph, never as a
  // `-f lavfi` input: FFmpeg 7.x intermittently deadlocks at the end of this graph when the base comes from the lavfi
  // input device (the master WAV then stays short of its length until the timeout).
  filters.push(`anullsrc=channel_layout=stereo:sample_rate=${SR},atrim=0:${totalSec}[base]`)

  const voiceLabels = []
  for (const v of voiceEvents) {
    args.push('-i', v.path)
    const lbl = `v${idx}`
    filters.push(
      `[${idx}:a]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${v.delayMs}|${v.delayMs},volume=1.06,${padToEnd}[${lbl}]`,
    )
    voiceLabels.push(`[${lbl}]`)
    idx++
  }

  const sfxLabels = []
  if (procSfxWav && existsSync(procSfxWav)) {
    args.push('-i', procSfxWav)
    const lbl = `sxproc`
    filters.push(`[${idx}:a]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${isPureMvNoVoice ? (bgmLinearGainDb !== null ? '1.0' : '1.15') : '0.88'},${padToEnd}[${lbl}]`)
    sfxLabels.push(`[${lbl}]`)
    idx++
  }
  for (const s of customSfxEvents) {
    args.push('-i', s.path)
    const lbl = `sx${idx}`
    filters.push(
      `[${idx}:a]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${s.delayMs}|${s.delayMs},volume=${s.volume},${padToEnd}[${lbl}]`,
    )
    sfxLabels.push(`[${lbl}]`)
    idx++
  }

  let bgmIdx = -1
  if (hasBgm) {
    args.push('-stream_loop', '-1', '-t', String(totalSec), '-i', absBgm)
    bgmIdx = idx++
    const fadeOutStart = Math.max(0, Number((totalSec - 1.5).toFixed(2)))
    if (isPureMvNoVoice) {
      // Protagonist-grade BGM loudness for pure-SFX beat-sync videos (zero -18dB voice-ducking!)
      filters.push(
        bgmLinearGainDb !== null
          ? `[${bgmIdx}:a:0]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${bgmLinearGainDb.toFixed(2)}dB${Number.isFinite(rawBgmVol) && rawBgmVol >= 0.5 && rawBgmVol <= 1.25 ? `,volume=${rawBgmVol.toFixed(2)}` : ''},afade=t=in:st=0:d=${bgmFadeInSec},afade=t=out:st=${fadeOutStart}:d=1.4,${STEREO}[bgm_raw]`
          : `[${bgmIdx}:a:0]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,loudnorm=I=-10.0:TP=-0.6:LRA=5,volume=${bgmVol.toFixed(2)},afade=t=in:st=0:d=${bgmFadeInSec},afade=t=out:st=${fadeOutStart}:d=1.4,${STEREO}[bgm_raw]`,
      )
    } else {
      filters.push(
        `[${bgmIdx}:a:0]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,loudnorm=I=-16.5:TP=-2.0:LRA=9,volume=${bgmVol.toFixed(2)},afade=t=in:st=0:d=${bgmFadeInSec},afade=t=out:st=${fadeOutStart}:d=1.5,${STEREO}[bgm_raw]`,
      )
    }
  }

  let hasAmb = false
  if (ambience && existsSync(ambience.path)) {
    args.push('-i', ambience.path)
    const ambIdx = idx++
    // labelled bgm_* so the opt-in stems count it in the music-bed stem
    filters.push(
      `[${ambIdx}:a]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${ambience.gainDb.toFixed(2)}dB,${padToEnd},atrim=0:${totalSec},${STEREO}[${hasBgm ? 'amb_raw' : 'bgm_amb'}]`,
    )
    if (hasBgm) filters.push(`[bgm_raw][amb_raw]${formatAmixChain(2, 'first', ffmpeg)},${STEREO}[bgm_bed]`)
    hasAmb = true
  }

  const mixInputs = ['[base]']
  // the music bed (BGM, BGM + ambience, or the ambience alone) that voice and SFX duck
  let bgmStreamForMix = hasBgm ? (hasAmb ? '[bgm_bed]' : '[bgm_raw]') : hasAmb ? '[bgm_amb]' : ''

  if (voiceLabels.length > 0) {
    if (voiceLabels.length === 1) {
      filters.push(`${voiceLabels[0]}${padToEnd},atrim=0:${totalSec},${STEREO}[voices]`)
    } else {
      filters.push(`${voiceLabels.join('')}${formatAmixChain(voiceLabels.length, 'longest', ffmpeg)},${padToEnd},atrim=0:${totalSec},${STEREO}[voices]`)
    }
    if (bgmStreamForMix) {
      filters.push('[voices]asplit=2[v_out][v_sc]')
      mixInputs.push('[v_out]')
      filters.push(`${bgmStreamForMix}[v_sc]sidechaincompress=threshold=0.062:ratio=${bgmDuckRatio.toFixed(2)}:attack=18:release=240:knee=4,${STEREO}[bgm_vduck]`)
      bgmStreamForMix = '[bgm_vduck]'
    } else {
      mixInputs.push('[voices]')
    }
  }

  if (sfxLabels.length > 0) {
    const sfxBoost = String(sfxBusBoost.toFixed(2))
    const sfxLim = isPureMvNoVoice ? '0.94' : '0.80'
    // Fast-attack safety limiter only: it should catch rare overs, not shave every clash transient
    const sfxAtk = isPureMvNoVoice ? '0.3' : '1.5'
    if (sfxLabels.length === 1) {
      filters.push(`${sfxLabels[0]}${padToEnd},atrim=0:${totalSec},volume=${sfxBoost},alimiter=limit=${sfxLim}:level=disabled:attack=${sfxAtk}:release=45,${STEREO}[sfx_bus]`)
    } else {
      filters.push(`${sfxLabels.join('')}${formatAmixChain(sfxLabels.length, 'longest', ffmpeg)},${padToEnd},atrim=0:${totalSec},volume=${sfxBoost},alimiter=limit=${sfxLim}:level=disabled:attack=${sfxAtk}:release=45,${STEREO}[sfx_bus]`)
    }
    if (bgmStreamForMix) {
      if (isPureMvNoVoice) {
        // Pure-music beat-sync: keep BGM thrilling & front-and-center; ultra-gentle 1.3x transient kiss only on peak clashes
        filters.push('[sfx_bus]asplit=2[sfx_out][sfx_sc]')
        filters.push(`${bgmStreamForMix}[sfx_sc]sidechaincompress=threshold=0.14:ratio=1.35:attack=2:release=55,${STEREO}[bgm_final]`)
        mixInputs.push('[bgm_final]')
        mixInputs.push('[sfx_out]')
      } else {
        filters.push('[sfx_bus]asplit=2[sfx_out][sfx_sc]')
        filters.push(`${bgmStreamForMix}[sfx_sc]sidechaincompress=threshold=0.055:ratio=2.5:attack=3:release=115,${STEREO}[bgm_final]`)
        mixInputs.push('[bgm_final]')
        mixInputs.push('[sfx_out]')
      }
    } else {
      if (bgmStreamForMix) mixInputs.push(bgmStreamForMix)
      mixInputs.push('[sfx_bus]')
    }
  } else if (bgmStreamForMix) {
    mixInputs.push(bgmStreamForMix)
  }

  // Opt-in stems: tap every bus exactly where it enters the master amix (identical timing, bus gains and ducking,
  // before the master loudness/limiter stage). asplit is a pure copy, so the master output is unchanged.
  const stemOutputs = []
  if (writeStems) {
    const stemRoleOf = (label) =>
      /^\[(?:v_out|voices)\]$/.test(label) ? 'voice' : /^\[sfx_(?:out|bus)\]$/.test(label) ? 'sfx' : /^\[bgm_/.test(label) ? 'bgm' : ''
    for (let i = 1; i < mixInputs.length; i++) {
      const role = stemRoleOf(mixInputs[i])
      if (!role || stemOutputs.some((s) => s.role === role)) continue
      filters.push(`${mixInputs[i]}asplit=2[${role}_mixin][${role}_stem]`)
      mixInputs[i] = `[${role}_mixin]`
      stemOutputs.push({ role, label: `[${role}_stem]`, silent: false })
    }
    for (const role of ['voice', 'sfx', 'bgm']) {
      if (stemOutputs.some((s) => s.role === role)) continue
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=${SR},atrim=0:${totalSec}[${role}_stem]`)
      stemOutputs.push({ role, label: `[${role}_stem]`, silent: true })
    }
  }

  // 4x-oversampled peak limiting ≈ true-peak limiting. Ceiling ≈ -2 dBTP in the WAV because the AAC encode adds
  // ~0.8-1 dB of inter-sample overshoot; the delivered MP4 then stays at or below about -1 dBTP.
  // An 18.5 kHz roll-off first removes the inaudible ultra-high band that otherwise makes lossy encoders overshoot.
  const TRUE_PEAK_LIMIT = 'lowpass=f=18500:poles=2,aresample=192000,alimiter=limit=0.73:level=disabled:attack=0.6:release=50,aresample=' + SR
  const linearMvMaster = isPureMvNoVoice && bgmLinearGainDb !== null
  const masterTp = isPureMvNoVoice ? '-0.5' : '-1.8'
  const masterLim = isPureMvNoVoice ? '0.95' : '0.82'
  const masterLra = isPureMvNoVoice ? '5' : '9'
  filters.push(
    linearMvMaster
      ? `${mixInputs.join('')}${formatAmixChain(mixInputs.length, 'first', ffmpeg)},${TRUE_PEAK_LIMIT}[master]`
      : `${mixInputs.join('')}${formatAmixChain(mixInputs.length, 'first', ffmpeg)},loudnorm=I=${masterLufs.toFixed(1)}:TP=${masterTp}:LRA=${masterLra},alimiter=limit=${masterLim}:level=disabled:attack=0.5:release=40[master]`,
  )
  args.push('-filter_complex', filters.join(';'), '-map', '[master]', '-c:a', 'pcm_s16le', '-ar', String(SR), '-t', String(totalSec), outWav)
  const resolvedStemsDir = writeStems ? (stemsDir ? resolve(absDir, stemsDir) : join(dirname(outWav), 'stems')) : ''
  if (writeStems) {
    mkdirSync(resolvedStemsDir, { recursive: true })
    for (const s of stemOutputs) {
      // 32-bit float keeps pre-limiter overs intact for NLE re-mixing; same length as the master
      s.path = join(resolvedStemsDir, `${s.role}.wav`)
      args.push('-map', s.label, '-c:a', 'pcm_f32le', '-ar', String(SR), '-t', String(totalSec), s.path)
    }
  }

  // A mix that stops making progress (an FFmpeg deadlock, not a slow machine: an audio-only mix runs far faster than
  // real time) is killed by the watchdog and run again.
  let res = null
  let mixRetries = 0
  for (let attempt = 1; ; attempt++) {
    try {
      res = await runCommandRedirected(ffmpeg, args, {
        timeoutMs: Math.max(180_000, Math.round(totalSec * 2500)),
        stallTimeoutMs: 30_000,
        stallStartupMs: 120_000,
        signal,
        onChild,
      })
      break
    } catch (err) {
      if (err?.code !== 'ESTALLED' || attempt >= 3 || signal?.aborted) throw err
      mixRetries = attempt
    }
  }
  if (res.code !== 0 || !existsSync(outWav)) {
    throw new Error(`Multi-track audio mix failed: ${res.stderr}`)
  }

  let masterStats = null
  if (linearMvMaster) {
    // Static loudness trim (no dynamic normaliser): one measured gain step, then the same true-peak limiter
    masterStats = await measureLoudnessStats(ffmpeg, outWav, { signal })
    if (Number.isFinite(masterStats.lufs) && Math.abs(masterStats.lufs - masterLufs) > 0.6) {
      const trimDb = Math.max(-8, Math.min(6, masterLufs - masterStats.lufs))
      const trimmedWav = `${outWav.replace(/\.wav$/i, '')}.trim.wav`
      const trimRes = await runCommandRedirected(
        ffmpeg,
        ['-y', '-i', outWav, '-af', `volume=${trimDb.toFixed(2)}dB,${TRUE_PEAK_LIMIT}`, '-c:a', 'pcm_s16le', '-ar', String(SR), trimmedWav],
        { timeoutMs: Math.max(120_000, Math.round(totalSec * 1500)), signal, onChild },
      )
      if (trimRes.code === 0 && existsSync(trimmedWav)) {
        copyFileSync(trimmedWav, outWav)
        try {
          unlinkSync(trimmedWav)
        } catch {}
        masterStats = await measureLoudnessStats(ffmpeg, outWav, { signal })
      }
    }
  }

  const stemsResult = writeStems
    ? await finalizeAudioStems({ ffmpeg, outWav, stemOutputs, stemsDir: resolvedStemsDir, totalSec, signal, onChild })
    : null

  const probe = await probeAudioDuration(outWav, Number(script.fps) || 30)
  return {
    ...(stemsResult ? { stems: stemsResult } : {}),
    ok: true,
    outputPath: outWav,
    durationSec: probe.durationSec,
    voiceCount: voiceEvents.length,
    sfxCount: proceduralCues.length + customSfxEvents.length,
    bgmUsed: hasBgm ? bgmPath : '',
    bgmSource: hasBgm ? bgmSource : 'none',
    ...(bgmFallback ? { bgmFallback } : {}),
    builtinSfxCount: Object.keys(builtinSfx).length,
    ambience: ambience
      ? {
          path: 'audio/ambience-bed.wav',
          kinds: Array.from(new Set(ambience.segments.map((x) => x.kind))),
          segments: ambience.segments.length,
          coverageSec: ambience.coverageSec,
          gainDb: Number(ambience.gainDb.toFixed(2)),
        }
      : null,
    masterLufs: masterStats?.lufs ?? null,
    masterTruePeak: masterStats?.truePeak ?? null,
    ...(mixRetries ? { mixRetries } : {}),
  }
}
