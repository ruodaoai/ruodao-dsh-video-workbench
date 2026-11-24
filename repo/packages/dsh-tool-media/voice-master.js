/**
 * Post-TTS AI Voice Mastering & Studio DSP Vocal Chain
 * - Measures real acoustic telemetry (LUFS, LRA, True Peak, RMS, Silence) via FFmpeg
 * - Consults configured AI LLM (or telemetry-adaptive studio fallback in Draft mode)
 *   to prescribe per-scene vocal EQ, de-ess, compression, studio ambience, and target LUFS
 * - Applies non-destructive FFmpeg mastering into `audio/mastered/<sceneId>.wav`
 *   while preserving original dry TTS tracks in `audio/<sceneId>.wav`.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import {
  alignSubtitlesToSpeechAudio,
  ffmpegAmixNoRescale,
  normalizeNumeralsForDisplay,
  probeAudioDuration,
  readScriptJson,
  resolveBinaries,
  runCommandRedirected,
  writeScriptJson,
} from '../shared/index.js'
import { callLlmChat, extractJsonFromLlmText, getSafeLlmConfigSummary } from './llm-client.js'

const clamp = (v, min, max, fallback) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

/**
 * Probe acoustic telemetry of a speech WAV using FFmpeg volumedetect + ebur128 + silencedetect.
 */
export async function probeVoiceAcousticTelemetry(absWavPath, fps = 30) {
  const base = await probeAudioDuration(absWavPath, fps)
  const { ffmpeg } = resolveBinaries()
  const res = await runCommandRedirected(
    ffmpeg,
    [
      '-hide_banner',
      '-i',
      absWavPath,
      '-af',
      'volumedetect,ebur128=peak=true,silencedetect=noise=-42dB:d=0.15',
      '-f',
      'null',
      process.platform === 'win32' ? 'NUL' : '/dev/null',
    ],
    { timeoutMs: 45_000 },
  )

  const log = `${res.stderr || ''}\n${res.stdout || ''}`
  const meanMatch = /mean_volume:\s*([-\d.]+)\s*dB/i.exec(log)
  const maxMatch = /max_volume:\s*([-\d.]+)\s*dB/i.exec(log)
  const lufsMatches = [...log.matchAll(/I:\s*([-\d.]+)\s*LUFS/gi)]
  const lraMatches = [...log.matchAll(/LRA:\s*([-\d.]+)\s*LU/gi)]
  const peakMatches = [...log.matchAll(/Peak:\s*([-\d.]+)\s*dBFS/gi)]

  const silenceStarts = [...log.matchAll(/silence_start:\s*([\d.]+)/gi)].map((m) => Number(m[1]))
  const silenceEnds = [...log.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/gi)].map((m) => ({
    end: Number(m[1]),
    duration: Number(m[2]),
  }))

  let leadingSilenceSec = 0
  if (silenceStarts[0] !== undefined && silenceStarts[0] <= 0.08 && silenceEnds[0]) {
    leadingSilenceSec = Number(silenceEnds[0].duration.toFixed(3))
  }
  let trailingSilenceSec = 0
  const lastEnd = silenceEnds[silenceEnds.length - 1]
  if (lastEnd && Math.abs(lastEnd.end - base.durationSec) < 0.25) {
    trailingSilenceSec = Number(lastEnd.duration.toFixed(3))
  }

  const integratedLufs = lufsMatches.length > 0 ? Number(lufsMatches[lufsMatches.length - 1][1]) : -20
  const loudnessRangeLu = lraMatches.length > 0 ? Number(lraMatches[lraMatches.length - 1][1]) : 5.5
  const truePeakDbtp = peakMatches.length > 0 ? Number(peakMatches[peakMatches.length - 1][1]) : -2.0
  const meanVolumeDb = meanMatch ? Number(meanMatch[1]) : -22
  const maxVolumeDb = maxMatch ? Number(maxMatch[1]) : -2

  return {
    ...base,
    meanVolumeDb,
    maxVolumeDb,
    integratedLufs,
    loudnessRangeLu,
    truePeakDbtp,
    leadingSilenceSec,
    trailingSilenceSec,
    dynamicCrestDb: Number((maxVolumeDb - meanVolumeDb).toFixed(2)),
  }
}

function buildAdaptivePresetForScene(scene, telemetry, style = 'tech') {
  const emotion = String(scene?.emotion || '平静')
  const isCinematic = style === 'cinematic' || style === 'documentary'
  const isWarm = style === 'warm' || emotion === '温柔' || emotion === '伤心'
  const isHighEnergy = emotion === '高兴' || emotion === '激昂' || style === 'energetic'

  const targetLufs = isCinematic ? -15.0 : -15.5
  const highpassHz = isWarm ? 72 : 85
  const lowWarmthFreq = isCinematic ? 175 : 200
  const lowWarmthGainDb = isCinematic ? 1.4 : isWarm ? 1.2 : 0.8
  const mudCutDb = telemetry.integratedLufs < -22 ? -0.9 : -1.2
  const presenceFreq = isHighEnergy ? 3500 : 3100
  const presenceGainDb = isHighEnergy ? 1.6 : 1.2
  const deEssDb = telemetry.dynamicCrestDb > 18 ? -1.8 : -1.2
  const needsComp = telemetry.loudnessRangeLu > 4.5 || telemetry.dynamicCrestDb > 15

  return {
    sceneId: scene.id,
    rationale: `广播级透明人声母带：保持自然动态范围 (LRA ${telemetry.loudnessRangeLu.toFixed(1)} LU)，校准至 ${targetLufs} LUFS，${highpassHz}Hz 低切清噪并微提 ${presenceFreq}Hz 清晰度。`,
    highpassHz,
    lowWarmthFreq,
    lowWarmthGainDb,
    mudCutDb,
    presenceFreq,
    presenceGainDb,
    deEssFreq: 6400,
    deEssDb,
    compThresholdDb: -15,
    compRatio: needsComp ? 1.9 : 1.2,
    airBoostDb: isWarm ? 0.5 : 0.9,
    reverbWet: isCinematic ? 0.015 : 0,
    targetLufs,
    trimLeadingSilence: telemetry.leadingSilenceSec > 0.35,
  }
}

function clampSpec(raw, scene, telemetry, style) {
  const fb = buildAdaptivePresetForScene(scene, telemetry, style)
  return {
    sceneId: scene.id,
    rationale: String(raw?.rationale || fb.rationale).trim(),
    highpassHz: Math.round(clamp(raw?.highpassHz, 60, 140, fb.highpassHz)),
    lowWarmthFreq: Math.round(clamp(raw?.lowWarmthFreq, 130, 300, fb.lowWarmthFreq)),
    lowWarmthGainDb: Number(clamp(raw?.lowWarmthGainDb, -2.0, 2.5, fb.lowWarmthGainDb).toFixed(2)),
    mudCutDb: Number(clamp(raw?.mudCutDb, -3.5, 0.5, fb.mudCutDb).toFixed(2)),
    presenceFreq: Math.round(clamp(raw?.presenceFreq, 2200, 5000, fb.presenceFreq)),
    presenceGainDb: Number(clamp(raw?.presenceGainDb, -1.0, 2.6, fb.presenceGainDb).toFixed(2)),
    deEssFreq: Math.round(clamp(raw?.deEssFreq, 5200, 8200, fb.deEssFreq)),
    deEssDb: Number(clamp(raw?.deEssDb, -3.5, 0.0, fb.deEssDb).toFixed(2)),
    compThresholdDb: Number(clamp(raw?.compThresholdDb, -22, -10, fb.compThresholdDb).toFixed(1)),
    compRatio: Number(clamp(raw?.compRatio, 1.1, 2.6, fb.compRatio).toFixed(2)),
    airBoostDb: Number(clamp(raw?.airBoostDb, -1.0, 2.0, fb.airBoostDb).toFixed(2)),
    reverbWet: Number(clamp(raw?.reverbWet, 0, 0.035, fb.reverbWet).toFixed(3)),
    targetLufs: Number(clamp(raw?.targetLufs, -18.5, -13.5, fb.targetLufs).toFixed(1)),
    trimLeadingSilence:
      raw?.trimLeadingSilence !== undefined ? Boolean(raw.trimLeadingSilence) : fb.trimLeadingSilence,
  }
}

async function applyFfmpegVocalChain(ffmpeg, srcWav, dstWav, spec) {
  mkdirSync(dirname(dstWav), { recursive: true })
  const baseFilters = [
    'aresample=48000',
    'aformat=sample_fmts=fltp:channel_layouts=stereo',
    ...(spec.trimLeadingSilence ? ['silenceremove=start_periods=1:start_duration=0.04:start_threshold=-42dB:stop_periods=-1:stop_duration=0.35:stop_threshold=-42dB'] : []),
    `highpass=f=${spec.highpassHz}`,
    `equalizer=f=${spec.lowWarmthFreq}:t=q:w=1.1:g=${spec.lowWarmthGainDb}`,
    `equalizer=f=360:t=q:w=1.4:g=${spec.mudCutDb}`,
    `equalizer=f=${spec.presenceFreq}:t=q:w=1.2:g=${spec.presenceGainDb}`,
    `equalizer=f=${spec.deEssFreq}:t=q:w=2.0:g=${spec.deEssDb}`,
    `highshelf=f=9500:g=${spec.airBoostDb}`,
    ...(spec.compRatio > 1.25 ? [`acompressor=threshold=${spec.compThresholdDb}dB:ratio=${spec.compRatio}:attack=18:release=200:makeup=1`] : []),
  ]

  let filterComplex = ''
  const safeTempo = Number(spec.tempo || 1.0)
  const tempoChain = []
  if (Math.abs(safeTempo - 1.0) > 0.02 && safeTempo >= 0.5 && safeTempo <= 2.0) {
    tempoChain.push(`atempo=${safeTempo.toFixed(3)}`)
  }
  const fullChain = [...baseFilters, ...tempoChain]
  const loudnormChain = `loudnorm=I=${spec.targetLufs}:TP=-1.5:LRA=11:linear=true,alimiter=limit=0.95`
  if (spec.reverbWet > 0.005) {
    const dryWeight = Math.max(0.85, Number((1 - spec.reverbWet).toFixed(3)))
    const wet2 = Number((spec.reverbWet * 0.55).toFixed(3))
    filterComplex =
      `[0:a]${fullChain.join(',')},asplit=2[vd][vr];` +
      `[vr]aecho=0.8:0.72:26|46:${spec.reverbWet}|${wet2}[vr_wet];` +
      `[vd][vr_wet]${ffmpegAmixNoRescale(ffmpeg, 2, { duration: 'longest', weights: [dryWeight, 1] })},` +
      `${loudnormChain}[v_master]`
  } else {
    filterComplex = `[0:a]${fullChain.join(',')},${loudnormChain}[v_master]`
  }

  const res = await runCommandRedirected(
    ffmpeg,
    [
      '-y',
      '-i',
      srcWav,
      '-filter_complex',
      filterComplex,
      '-map',
      '[v_master]',
      '-c:a',
      'pcm_s16le',
      '-ar',
      '48000',
      '-ac',
      '2',
      dstWav,
    ],
    { timeoutMs: 90_000, signal: spec.signal, onChild: spec.onChild },
  )
  if (res.code !== 0 || !existsSync(dstWav)) {
    throw new Error(`FFmpeg 修音链路失败: ${res.stderr || res.stdout}`)
  }
}

/**
 * Probe and AI-master all (or specified) scene TTS vocals in a video project.
 */
export async function masterVoiceTracks({
  projectDir,
  sceneIds = [],
  useLlm = true,
  speechTempo = 1.0,
  trimSilence = false,
  llmOverride = {},
  fetchImpl,
  signal,
  onChild,
  onProgress,
} = {}) {
  if (!projectDir) throw new Error('projectDir is required')
  const absDir = resolve(projectDir)
  const { data: script } = readScriptJson(absDir)
  const { ffmpeg } = resolveBinaries()
  const fps = Number(script.fps) || 30

  const targets = (script.scenes || []).filter((sc) => {
    if (Array.isArray(sceneIds) && sceneIds.length > 0 && !sceneIds.includes(sc.id)) {
      return false
    }
    const rawWav = sc.audioFile ? (isAbsolute(sc.audioFile) ? sc.audioFile : resolve(absDir, sc.audioFile)) : ''
    return Boolean(rawWav && existsSync(rawWav))
  })

  if (targets.length === 0) {
    throw new Error('当前工程尚无已生成的干声配音 WAV，请先生成配音后再执行 AI 大模型修音。')
  }

  onProgress?.(`1/3 正在采样测量 ${targets.length} 幕人声的响度 (LUFS) 与声学动态...`)
  const telemetryByScene = {}
  for (const sc of targets) {
    const rawWav = isAbsolute(sc.audioFile) ? sc.audioFile : resolve(absDir, sc.audioFile)
    telemetryByScene[sc.id] = await probeVoiceAcousticTelemetry(rawWav, fps)
  }

  let planMode = 'dsp-adaptive-fallback'
  let aiModelUsed = ''
  let engineerSummary = '已依据各幕实测 LUFS 与峰值动态，执行自适应广播级人声均衡与压限修音。'
  let rawAiSpecsById = new Map()

  const llmSummary = getSafeLlmConfigSummary()
  const shouldCallLlm = Boolean(useLlm && (llmOverride?.baseUrl || llmSummary.configured))

  if (shouldCallLlm) {
    try {
      onProgress?.(`2/3 正在调用大模型 (${llmOverride?.model || llmSummary.model}) 分析声学指纹并定制修音方案...`)
      const systemPrompt = `你是好莱坞级电影混音师与广播级人声母带工程师。
你收到了本地 IndexTTS-2.5 合成后各分镜干声 WAV 的客观 FFmpeg 声学测量结果。
请结合影片风格、每幕情绪与背景下潜配乐（BGM），为每一幕分别开出精准的人声修音配方，输出严格 JSON：
{
  "engineerSummary": "20~50字整体声学诊断与修音策略说明",
  "masterTargetLufs": -15.5,
  "perScene": [
    {
      "sceneId": "scene-01",
      "rationale": "一句精准解释（为何如此调整低频/亮度/齿音/压缩/混响）",
      "highpassHz": 82,
      "lowWarmthFreq": 185,
      "lowWarmthGainDb": 1.8,
      "mudCutDb": -1.6,
      "presenceFreq": 3300,
      "presenceGainDb": 2.1,
      "deEssFreq": 6400,
      "deEssDb": -2.2,
      "compThresholdDb": -18,
      "compRatio": 2.8,
      "airBoostDb": 1.1,
      "reverbWet": 0.04,
      "targetLufs": -15.5,
      "trimLeadingSilence": false
    }
  ]
}
注意安全边界：highpassHz [60,140]，gains [-5,4.5]，reverbWet [0,0.12]，targetLufs [-19,-12.5]。严禁输出解释性闲聊，仅返回纯 JSON。`

      const userPayload = JSON.stringify(
        {
          title: script.title,
          style: script.style,
          bgmMood: script.audioSpec?.mood || script.bgm?.mood || 'tech',
          bgmBpm: script.bgm?.bpm || 118,
          scenes: targets.map((sc) => ({
            sceneId: sc.id,
            title: sc.title,
            emotion: sc.emotion || '平静',
            voiceName: sc.voiceName || sc.voiceId || 'default',
            voiceProvider: sc.voiceProvider || 'indextts25',
            telemetry: telemetryByScene[sc.id],
          })),
        },
        null,
        2,
      )

      const llmRes = await callLlmChat({
        overrideConfig: llmOverride,
        fetchImpl,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPayload }],
        temperature: 0.25,
        maxTokens: 4096,
        timeoutMs: 90_000,
      })
      const parsed = extractJsonFromLlmText(llmRes.text)
      if (Array.isArray(parsed?.perScene)) {
        for (const row of parsed.perScene) {
          if (row?.sceneId) rawAiSpecsById.set(String(row.sceneId), row)
        }
      }
      if (parsed?.engineerSummary) {
        engineerSummary = String(parsed.engineerSummary).trim()
      }
      planMode = 'ai-llm'
      aiModelUsed = llmRes.model
    } catch (err) {
      engineerSummary = `大模型修音方案生成回退至自适应母带 (${err.message.slice(0, 90)})`
    }
  }

  onProgress?.(`3/3 正在使用 FFmpeg 48kHz 浮点链路逐幕精修并对比 LUFS 指标...`)
  const masteredDir = join(absDir, 'audio', 'mastered')
  mkdirSync(masteredDir, { recursive: true })

  const results = []
  for (const sc of targets) {
    if (signal?.aborted) break
    const rawWav = isAbsolute(sc.audioFile) ? sc.audioFile : resolve(absDir, sc.audioFile)
    const before = telemetryByScene[sc.id]
    const spec = clampSpec(rawAiSpecsById.get(sc.id), sc, before, script.style)
    if (Math.abs(Number(speechTempo || 1) - 1.0) > 0.02) {
      spec.tempo = Math.max(0.75, Math.min(1.65, Number(speechTempo)))
    }
    if (trimSilence) spec.trimLeadingSilence = true
    spec.signal = signal
    spec.onChild = onChild
    const dstRel = `audio/mastered/${sc.id}.wav`
    const dstAbs = join(absDir, dstRel)

    await applyFfmpegVocalChain(ffmpeg, rawWav, dstAbs, spec)
    const after = await probeVoiceAcousticTelemetry(dstAbs, fps)

    sc.masteredAudioFile = dstRel
    sc.voiceMastering = {
      applied: true,
      mode: planMode,
      model: aiModelUsed,
      rationale: spec.rationale,
      beforeLufs: before.integratedLufs,
      afterLufs: after.integratedLufs,
      beforePeakDbtp: before.truePeakDbtp,
      afterPeakDbtp: after.truePeakDbtp,
      eqSummary: `HPF ${spec.highpassHz}Hz · Warm ${spec.lowWarmthGainDb >= 0 ? '+' : ''}${spec.lowWarmthGainDb}dB · Clarity +${spec.presenceGainDb}dB · DeEss ${spec.deEssDb}dB`,
      spec,
      masteredAt: new Date().toISOString(),
    }

    const leadSec = Number.isFinite(Number(sc.voiceLeadSec)) ? Number(sc.voiceLeadSec) : 0.35
    const tailSec = Number.isFinite(Number(sc.tailSec)) ? Number(sc.tailSec) : 0.65
    sc.voiceDurationSec = after.durationSec
    sc.durationSec = Number((leadSec + after.durationSec + tailSec).toFixed(4))
    sc.durationInFrames = Math.max(1, Math.ceil(sc.durationSec * fps))

    // Re-sync subtitle cue boundaries against the actual mastered/retimed vocal waveform
    const subMaxW =
      Number(script.width) < Number(script.height) ? 11 : Number(script.width) === Number(script.height) ? 13 : 16
    if (sc.narration || sc.subtitleText || (Array.isArray(sc.subChunks) && sc.subChunks.length > 0)) {
      const displayNar = sc.narration ? normalizeNumeralsForDisplay(sc.narration) : sc.narration
      if (displayNar) sc.narration = displayNar
      const syncedSubs = await alignSubtitlesToSpeechAudio({
        audioPath: dstAbs,
        narration: displayNar,
        subtitleText: sc.subtitleText,
        subChunks: sc.subChunks,
        leadSec,
        durationSec: after.durationSec,
        fps,
        maxLineWidth: subMaxW,
      })
      if (syncedSubs.length > 0) {
        sc.subtitles = syncedSubs
        sc.subChunks = syncedSubs.map((s) => s.text)
        sc.subtitleText = syncedSubs.map((s) => s.text).join(' ')
      }
    }

    results.push({
      sceneId: sc.id,
      title: sc.title,
      masteredAudioFile: dstRel,
      beforeLufs: before.integratedLufs,
      afterLufs: after.integratedLufs,
      beforePeakDbtp: before.truePeakDbtp,
      afterPeakDbtp: after.truePeakDbtp,
      durationSec: after.durationSec,
      rationale: spec.rationale,
      spec,
    })
  }

  const report = {
    ok: true,
    mode: planMode,
    model: aiModelUsed || null,
    engineerSummary,
    scenesCount: results.length,
    results,
    updatedAt: new Date().toISOString(),
  }

  script.voiceMasteringReport = report
  const savedScript = writeScriptJson(absDir, script).data
  mkdirSync(join(absDir, 'output'), { recursive: true })
  writeFileSync(join(absDir, 'output', 'voice_mastering_report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')

  return {
    ...report,
    script: savedScript,
  }
}
