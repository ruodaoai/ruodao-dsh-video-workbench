import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import {
  buildGlobalSubtitleTrack,
  buildSentenceSubtitles,
  cleanSubtitleChunk,
  createAbortError,
  formatDirectorBrief,
  loadEnv,
  normalizeContentOutline,
  normalizeNumeralsForDisplay,
  probeAudioDuration,
  probeHardwareProfile,
  readScriptJson,
  REPO_ROOT,
  resolveBinaries,
  resolveLowSpecPolicy,
  resolveTargetDurationPolicy,
  runCommandRedirected,
  sanitizeSpokenNarration,
  splitDirectorBrief,
  stripMetaInstructions,
  toTtsText,
  writeScriptJson,
} from '../shared/index.js'
import { castVoicesWithLlm, cloneRecordedVoice, executeGenerateSpeech, getActiveTtsEngineId, matchAllScenesInScript, resolveTtsEngineSpec } from '../dsh-tool-local-tts/index.js'
import { executeGenerateAvatar } from '../dsh-tool-avatar/index.js'
import {
  executeVideoLint,
  executeVideoRender,
  executeVideoSnapshot,
} from '../dsh-tool-video-suite/index.js'
import { importAssets, readAssets } from './asset-manager.js'
import { planVideoFromAssets, syncProjectCodeFromScript } from './ai-director.js'
import { buildRichHtmlVideo } from './html-generator.js'
import { authorBatchedRemotionScenes, runCodeAutoRepairLoop } from './ai-coder.js'
import { applyFigureStyleChoice, enrichScenesForVisuals, FIGURE_STYLE_ZH, normalizeCast, normalizeFigureStyle, normalizeFigureStyleNote } from './figure-kit.js'
import { syncCastWithCharacterBank } from './cast-bank-sync.js'

import { formatToolSummary } from './scene-tool-plan.js'
import { summarizeVisualReview } from './visual-review.js'
import { AMBIENCE_LABELS_ZH } from './ambience-dsp.js'
import { executeCurateAndEditAssets } from './media-editor.js'
import { buildGenreGuidance, detectGenre, isEpicCombatContext, isHistoricalContent, resolveGenreSelection } from './genre-router.js'
import { generateAiCodedBgmTrack, generateAiCodedSfxCues, synthesizeTtsEngineAudioCue } from './audio-coder.js'
import {
  analyzeAudioBeatStructure,
  buildBeatGrid,
  choreographBeatSfxCues,
  ensureProjectAudioAssets,
  generateBgmWav,
  mixVideoAudio,
  quantizeScenesToBeatGrid,
} from './audio-synth.js'
import { buildHtmlCoderSkillsPrompt, buildRemotionCoderSkillsPrompt } from './shotcraft-lib.js'
import { withStyleGuide } from './style-presets.js'
import { callLlmChat, extractJsonFromLlmText, getSafeLlmConfigSummary, resolveLlmConfig } from './llm-client.js'
import { stripPlazaTemplateGuidance } from './plaza-guidance.js'
import { runSchemaDirectorWithDegradation } from './plan-schema.js'
import { writeRemotionProjectFiles } from './remotion-generator.js'
import { taskManager } from './task-manager.js'
import { buildMediaDimsMap, groundVisualAssets } from './vision-grounding.js'
import {
  createPaidJobBudget,
  executeMediaSourcingPlan,
  isBillingError,
  loadCloudMediaConfig,
  resolveMediaSourcingPlan,
  toBillingError,
} from './cloud-media.js'
import { billingErrorFromText, createBillingSentinel } from './cloud-ledger.js'
import { safeProjectSnapshot } from './project-history.js'
import { applyLockedHtmlStore, syncLockedHtmlStore } from './region-refine.js'
import {
  applyUserOverrides,
  getLockedSceneIds,
  isSceneLocked,
  reassertLockedScenes,
  reconcileUserEdits,
  restoreLockedSceneSfx,
  snapshotLockedSceneAudio,
  summarizeEditMerge,
} from './scene-locks.js'

/**
 * Normalize pipeline execution mode (`local-draft` / `draft` / `fast-draft` -> `fast-draft`).
 */
export function resolvePipelineMode(rawMode) {
  const cleaned = String(rawMode || '').trim()
  const isDraftMode = ['fast-draft', 'local-draft', 'draft'].includes(cleaned.toLowerCase())
  const effectiveMode = isDraftMode ? 'fast-draft' : 'ai-coded'
  return {
    isDraftMode,
    effectiveMode,
    mode: isDraftMode ? 'fast-draft' : cleaned || 'ai-coded',
    modeLabel: isDraftMode ? '极速本地出片' : 'AI 团队协同出片',
  }
}
import { masterVoiceTracks } from './voice-master.js'

function isDoneTask(run, taskId) {
  const t = run?.tasks?.find((x) => x.id === taskId)
  return Boolean(t && t.status === 'completed')
}

async function recomputeCumulativeTimeline(absDir) {
  const { data: script } = readScriptJson(absDir)
  const fps = Number(script.fps) || 30
  let cursorFrame = 0
  let totalSec = 0

  for (let i = 0; i < (script.scenes || []).length; i++) {
    const sc = script.scenes[i]
    const minScDur = script.narrationMode === 'subtitle-mv' || sc.beatCutAligned ? 0.45 : 1.5
    const durSec = Math.max(minScDur, Number(sc.durationSec) || 4.0)
    const durFrames = Math.max(12, Number(sc.durationInFrames) || Math.ceil(durSec * fps))
    sc.startFrame = cursorFrame
    sc.durationInFrames = durFrames
    sc.durationSec = Number((durFrames / fps).toFixed(4))

    if (Array.isArray(sc.subtitles) && sc.subtitles.length > 0) {
      sc.subtitles = sc.subtitles.map((sub) => ({ ...sub, sceneId: sc.id }))
    } else if (sc.narration) {
      const startOffsetSec = Number.isFinite(Number(sc.voiceLeadSec)) ? Number(sc.voiceLeadSec) : 0.35
      const voiceDur = Math.max(0.8, Number(sc.voiceDurationSec) || sc.durationSec - startOffsetSec - 0.35)
      const subMaxW = Number(script.width) < Number(script.height) ? 11 : Number(script.width) === Number(script.height) ? 13 : 16
      sc.subtitles = buildSentenceSubtitles(sc.narration, voiceDur, fps, { maxLineWidth: subMaxW }).map((sub) => ({
        ...sub,
        startSec: Number((sub.startSec + startOffsetSec).toFixed(3)),
        endSec: Number((sub.endSec + startOffsetSec).toFixed(3)),
        startFrame: Math.floor((sub.startSec + startOffsetSec) * fps),
        endFrame: Math.ceil((sub.endSec + startOffsetSec) * fps),
        sceneId: sc.id,
      }))
    }

    cursorFrame += durFrames
    totalSec += sc.durationSec
  }

  // Global track = every scene cue at its scene's timeline position (the same builder writeScriptJson keeps in step)
  script.subtitles = buildGlobalSubtitleTrack(script.scenes || [], fps)
  script.totalDurationInFrames = cursorFrame
  script.totalDurationSec = Number(totalSec.toFixed(4))
  return writeScriptJson(absDir, script).data
}

async function buildCombinedDryVoiceWav(absDir, script, signal, onChild) {
  const { ffmpeg } = resolveBinaries()
  const wavs = (script?.scenes || [])
    .map((sc) => sc.masteredAudioFile || sc.audioFile)
    .filter(Boolean)
    .map((rel) => (isAbsolute(rel) ? rel : resolve(absDir, rel)))
    .filter((p) => existsSync(p))

  if (wavs.length === 0) return ''
  const outDir = join(absDir, 'output', 'avatar')
  mkdirSync(outDir, { recursive: true })
  const outWav = join(outDir, 'driving-vocal.wav')
  if (wavs.length === 1) return wavs[0]

  const concatTxt = join(outDir, 'vocal-concat.txt')
  writeFileSync(
    concatTxt,
    wavs.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n',
    'utf8',
  )
  const res = await runCommandRedirected(
    ffmpeg,
    ['-y', '-f', 'concat', '-safe', '0', '-i', concatTxt, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', outWav],
    { timeoutMs: 45_000, signal, onChild },
  )
  return res.code === 0 && existsSync(outWav) ? outWav : wavs[0]
}

async function executeMultiAgentRunner(run, helpers) {
  loadEnv()
  const { signal, onChild, waitIfPaused, updateTask, appendLog } = helpers
  const spec = run.spec || {}
  // Everything that made this film worse than a normal run (a model fallback, a failed QA check) is collected here,
  // shown as a yellow log line right away and summed up in the completion message and the run summary.
  const runWarnings = []
  const warnUser = (stage, message) => {
    runWarnings.push({ stage, message: String(message) })
    appendLog(stage, String(message), 'warn')
  }
  const onLlmRetry = ({ waitMs, status, reason, attempt } = {}) => {
    const sec = Math.max(1, Math.round((Number(waitMs) || 0) / 1000))
    appendLog(
      undefined,
      reason === 'rate-limit'
        ? `大模型接口限流（HTTP 429），${sec} 秒后自动重试（第 ${attempt} 次）…`
        : `大模型接口暂时异常${status ? `（HTTP ${status}）` : ''}，${sec} 秒后自动重试…`,
      'warn',
    )
  }
  // Split any (AI-polished) brief into audience-safe title/topic + AI-only director notes
  {
    const brief = splitDirectorBrief(spec)
    spec.rawTopic = spec.rawTopic || spec.topic || ''
    spec.directorNotes = brief.directorNotes
    spec.contentOutline = Array.isArray(brief.contentOutline) && brief.contentOutline.length > 0
      ? brief.contentOutline
      : normalizeContentOutline(spec.contentOutline)
    spec.genre = brief.genre || spec.genre || ''
    spec.genreLabel = brief.genreLabel || spec.genreLabel || ''
    spec.displayTitle = brief.displayTitle
    spec.topic = brief.topic
    spec.title = brief.title
  }
  const absDir = resolve(spec.projectDir || run.projectDir)
  const { isDraftMode, effectiveMode: mode } = resolvePipelineMode(spec.mode)
  const engine = spec.engine === 'remotion' ? 'remotion' : 'html'
  // the director stage may turn 「AI 自由匹配」 into a preset (or an AI-designed style based on one): re-read below
  let style = spec.style || 'tech'
  const aspectRatio = spec.aspectRatio || 'auto'

  // Optional initial source import BEFORE resolving BGM & duration policy
  if (spec.sources && (Array.isArray(spec.sources) ? spec.sources.length > 0 : true)) {
    await importAssets({ projectDir: absDir, sources: spec.sources })
  }

  let initialScriptSnap = {}
  if (existsSync(join(absDir, 'script.json'))) {
    try {
      initialScriptSnap = readScriptJson(absDir).data || {}
    } catch {}
  }
  const initialAssetsSnap = readAssets(absDir)
  // HTML engine: capture locked scenes' <template> blocks before the director rewrites index.html (first capture
  // wins, so retries and later runs keep the implementation from the moment of locking)
  if ((initialScriptSnap.engine || spec.engine) !== 'remotion') {
    try {
      syncLockedHtmlStore(absDir, initialScriptSnap)
    } catch {}
  }
  // Cost protection (per-run paid-job cap, DSH_CLOUD_MAX_PAID_JOBS_PER_RUN) + project version history
  const paidBudget = createPaidJobBudget({ runId: run.id, max: spec.maxPaidJobsPerRun })
  const stageSnap = (stage, phase, author = 'ai') =>
    safeProjectSnapshot(absDir, { label: `pipeline:${stage}:${phase}`, stage, author, kind: 'pipeline', runId: run.id })
  const uploadedMusicSnap = (initialAssetsSnap.items || []).filter((it) => it.role === 'music')
  const intentFullText = `${spec.rawTopic || ''} ${spec.directorNotes || ''} ${spec.goal || ''} ${initialScriptSnap.goal || ''}`
  const wantsUploadedBgmByPrompt = /(?:上传|自带|导入|个人|我的|现有|本机).{0,10}(?:bgm|配乐|音乐|背景音|歌曲)|(?:bgm|配乐|背景音).{0,12}(?:节拍|卡点|踩拍|踩死|突降|高潮|同步)/i.test(intentFullText)
  const wantsBeatSyncByPrompt = /(?:踩死|踩准|踩拍|踩点|卡点|卡拍|高潮突降|主高潮|突降|重拍|切镜|同步节拍|节拍同步|beat[- ]?sync)/i.test(intentFullText)
  const wantsPureMusicByPrompt = /(?:纯音乐|免配音|无配音|无旁白|不要配音|不用配音|去掉配音|无需配音|纯卡点|卡点\s*MV|无解说|免\s*TTS)/i.test(intentFullText)
  const refStyleSnap = spec.referenceStyle || initialScriptSnap.referenceStyle || null
  const wantsRefSubtitleMv =
    refStyleSnap?.narrationMode === 'subtitle-mv' &&
    !/(?:需要配音|真人配音|口播解说|语音旁白|人声旁白)/.test(intentFullText)
  if (wantsBeatSyncByPrompt || wantsPureMusicByPrompt || refStyleSnap?.narrationMode === 'subtitle-mv' || refStyleSnap?.narrationMode === 'tts-beat-sync') {
    spec.beatSync = true
  }
  if ((wantsPureMusicByPrompt || wantsRefSubtitleMv) && (!spec.narrationMode || spec.narrationMode === 'tts')) {
    spec.narrationMode = 'subtitle-mv'
    appendLog('director', `检测到${wantsPureMusicByPrompt ? '指令要求纯音乐卡点/免配音' : '参考视频为纯音乐卡点 MV 模式'}，已自动切换为「🔥 纯音乐卡点 (subtitle-mv · 免 TTS)」并激活高密度重拍切镜与卡点音效！`)
  }

  let bgmMode = spec.bgmMode || initialScriptSnap.bgmMode || initialScriptSnap.audioSpec?.bgmMode || (uploadedMusicSnap.length > 0 ? 'uploaded' : 'llm-coded')
  const hasPreGeneratedLlmBgm = existsSync(join(absDir, 'audio', 'bgm-llm.wav'))
  if (
    uploadedMusicSnap.length > 0 &&
    (bgmMode === 'auto' || bgmMode === 'uploaded' || (bgmMode === 'llm-coded' && (!hasPreGeneratedLlmBgm || wantsUploadedBgmByPrompt)))
  ) {
    if (bgmMode !== 'uploaded') {
      appendLog('director', `检测到工程已上传背景音乐「${uploadedMusicSnap[0].name || uploadedMusicSnap[0].path}」，已自动优先挂载上传 BGM 音频与真实节拍！`)
    }
    bgmMode = 'uploaded'
  }

  const durationPolicy = resolveTargetDurationPolicy({
    durationMode: spec.durationMode || initialScriptSnap.durationMode || 'auto',
    targetDurationSec: Number(spec.targetDurationSec) || Number(initialScriptSnap.targetDurationSec) || 0,
    // the user's wording only: a template's style recipe describes its source film ("平均3.42秒" once became 42 s)
    text: stripPlazaTemplateGuidance(intentFullText),
    narrationMode: spec.narrationMode || initialScriptSnap.narrationMode || 'tts',
    hasVisualAssets: (initialAssetsSnap.items || []).some((it) => it.type === 'image' || it.type === 'video'),
    bgmDurationSec: Number(uploadedMusicSnap[0]?.durationSec || initialScriptSnap.bgm?.durationSec) || 0,
    referenceShotCount: Number(refStyleSnap?.pacingSignature?.targetShotCount || refStyleSnap?.shotCount || 0),
    referenceDurationSec: Number(refStyleSnap?.durationSec || 0),
  })
  const effectiveDurationMode = durationPolicy.durationMode === 'custom' ? 'custom' : (spec.durationMode || initialScriptSnap.durationMode || 'auto')
  const effectiveTargetDurationSec = durationPolicy.enforced ? durationPolicy.targetSec : 0
  if (durationPolicy.enforced) {
    appendLog('director', `已锁定目标时长策略: ${durationPolicy.label}（规划目标 ${durationPolicy.targetSec}s，底线 ${durationPolicy.minSec}s）`)
  }

  const hwProfile = probeHardwareProfile({ targetDir: absDir })
  const hwPolicy = resolveLowSpecPolicy({
    repoRoot: REPO_ROOT,
    hardware: hwProfile,
    modePref: spec.lowSpecMode || '',
    requestedQuality: spec.quality || '1080p',
    requestedFps: Number(spec.fps) || 30,
    totalDurationSec: effectiveTargetDurationSec || 60,
  })
  const quality = hwPolicy.effectiveQuality || spec.quality || '1080p'
  const effectiveFps = hwPolicy.effectiveFps || Number(spec.fps) || 30
  const targetPlatform = spec.targetPlatform || 'universal'
  let voiceId = spec.voiceId || 'auto'
  const speechTempo = Number(spec.speechTempo) || 1.0
  const allowPlaceholder = Boolean(spec.allowPlaceholder)
  const llmSummary = getSafeLlmConfigSummary()
  // Billing tripwire for every injected LLM call: helpers with graceful fallbacks (schema director tiers, vision
  // grounding, voice casting, AI BGM) must never re-call a provider that reported no balance / quota — after the
  // first billing failure later calls fail without network and stage checkpoints stop the whole run.
  const llmBilling = createBillingSentinel({ scope: 'llm', provider: llmSummary.model || '' })
  const guardedLlm = llmBilling.wrap((p) => callLlmChat({ ...p, signal, onRetry: onLlmRetry }))
  const llmBillingInfo = { scope: 'llm', provider: llmSummary.model || '' }
  appendLog(
    'director',
    `本机算力体检: ${hwProfile.cpu.threads}核 · ${hwProfile.memory.freeGB}/${hwProfile.memory.totalGB}GB 内存 · ${hwProfile.gpu.primaryName} | ${hwPolicy.reason}${hwPolicy.clampedFields.length ? ` [保护限幅: ${hwPolicy.clampedFields.join(' / ')}]` : ''}`,
  )

  // =========================================================================
  // AGENT 1: 策划导演 Agent (director)
  // =========================================================================
  if (!isDoneTask(run, 't-director')) {
    await waitIfPaused('t-director')
    updateTask('t-director', {
      status: 'running',
      progress: 12,
      message: `策划导演 Agent 启动：正在整合主题「${spec.topic || '智能短片'}」与 Step 1 素材库...`,
    })
    // Version history: capture the pre-run state (includes any manual edits since the last AI run)
    stageSnap('director', 'before', 'user')

    const preserveExisting = Boolean(spec.preserveExistingScript && existsSync(join(absDir, 'script.json')))
    if (preserveExisting) {
      // Allow re-running director preservation smoothly
    } else {
      let existingBeforePlan = {}
      if (existsSync(join(absDir, 'script.json'))) {
        try {
          existingBeforePlan = readScriptJson(absDir).data || {}
        } catch {}
      }
      const preservedGoal = formatDirectorBrief({
        goal:
          String(spec.userPrompt || spec.polishedTopic || spec.goal || '').trim() ||
          (String(spec.rawTopic || '').trim().length > 36 || /【/.test(String(spec.rawTopic || '')) ? String(spec.rawTopic).trim() : '') ||
          String(existingBeforePlan.goal || '').trim(),
        displayTitle: spec.displayTitle,
        genreLabel: spec.genreLabel,
        contentOutline: spec.contentOutline,
        directorNotes: spec.directorNotes,
        topic: spec.rawTopic || spec.topic,
      })
      await planVideoFromAssets({
        projectDir: absDir,
        topic: spec.topic || '',
        title: spec.title || spec.topic || '',
        displayTitle: spec.displayTitle,
        directorNotes: spec.directorNotes,
        contentOutline: spec.contentOutline,
        genre: spec.genre,
        genreLabel: spec.genreLabel,
        style,
        engine,
        aspectRatio,
        quality,
        width: spec.width,
        height: spec.height,
        aiBadge: spec.aiBadgeEnabled !== undefined ? Boolean(spec.aiBadgeEnabled) : spec.aiBadge !== false,
        aiBadgeEnabled: spec.aiBadgeEnabled !== undefined ? Boolean(spec.aiBadgeEnabled) : spec.aiBadge !== false,
        aiBadgePosition: spec.aiBadgePosition || 'top-right',
        aiBadgeText: spec.aiBadgeText || (typeof spec.aiBadge === 'string' ? spec.aiBadge : ''),
        pacingMode: spec.pacingMode || 'auto',
        visual3dMode: spec.visual3dMode || 'auto',
        fps: effectiveFps,
        voiceId,
        narrationMode: spec.narrationMode || '',
        durationMode: effectiveDurationMode,
        targetDurationSec: effectiveTargetDurationSec || undefined,
        bgmMode,
        userPrompt: preservedGoal,
        goal: preservedGoal,
      })
    }

    // Analyze uploaded BGM beats BEFORE AI director runs so scene rhythm aligns to measured BPM & drops
    let analyzedBgmMeta = null
    {
      const preScript = readScriptJson(absDir).data
      const preAssets = readAssets(absDir)
      const upMusic = (preAssets.items || []).filter((it) => it.role === 'music')
      const upPath = spec.uploadedBgmPath || upMusic[0]?.path || preScript?.bgm?.uploadedPath || ''
      if (bgmMode === 'uploaded' && upPath) {
        const absBgmSrc = isAbsolute(upPath) ? upPath : resolve(absDir, upPath)
        if (existsSync(absBgmSrc)) {
          try {
            updateTask('t-director', {
              status: 'running',
              progress: 34,
              message: '正在分析上传 BGM 真实 BPM、重拍相位与能量高潮区间...',
            })
            analyzedBgmMeta = await analyzeAudioBeatStructure(absBgmSrc, { signal })
            preScript.bgm = {
              ...(preScript.bgm || {}),
              ...analyzedBgmMeta,
              mode: 'uploaded',
              source: 'user-imported',
              path: upPath,
              uploadedPath: upPath,
            }
            preScript.audioSpec = { ...(preScript.audioSpec || {}), bgmMode: 'uploaded', bpm: analyzedBgmMeta.bpm }
            writeScriptJson(absDir, preScript)
            appendLog('director', `已测得上传 BGM 真实节拍: ${analyzedBgmMeta.bpm} BPM · 首拍 ${analyzedBgmMeta.phaseSec}s · ${analyzedBgmMeta.downbeats.length} 个重拍 · ${analyzedBgmMeta.drops.length} 个高潮突降点`)
          } catch (err) {
            appendLog('director', `上传 BGM 节拍解析略过 (${err.message})`, 'warn')
          }
        }
      }
    }

    if (signal.aborted) throw createAbortError()
    await waitIfPaused('t-director')

    if (mode === 'ai-coded' && llmSummary.configured && !spec.skipLlmDirector) {
      updateTask('t-director', {
        status: 'running',
        progress: 55,
        message: `策划导演 Agent 正在调用大模型 (${llmSummary.model}) 润色分镜口播文案与节奏曲线...`,
      })
      try {
        const curScript = readScriptJson(absDir).data
        curScript.durationMode = effectiveDurationMode
        // 人物画风 picked for this run (studio form / MCP figureStyle): the director writes the cast for it
        applyFigureStyleChoice(curScript, spec)
        if (effectiveTargetDurationSec > 0) {
          curScript.targetDurationSec = effectiveTargetDurationSec
          curScript.totalDurationSec = effectiveTargetDurationSec
        }
        // Ground visual assets with exact DOM sidecars (*.anchors.json) or multimodal Vision LLM coordinates
        try {
          const groundRes = await groundVisualAssets({
            projectDir: absDir,
            callLlmChatFn: guardedLlm,
            enableVision: mode === 'ai-coded' && llmSummary.configured,
            signal,
            onProgress: (pct, msg) => {
              updateTask('t-director', {
                status: 'running',
                progress: Math.max(40, Math.min(54, Math.round(40 + pct * 0.14))),
                message: msg,
                log: false,
              })
            },
          })
          if (groundRes?.grounded > 0) {
            appendLog('director', `已完成界面视觉坐标锚点定位：精确 DOM 侧车 ${groundRes.sidecarCount} 份 · 视觉识别 ${groundRes.visionCount} 份`)
          }
        } catch {}
        llmBilling.throwIfTripped()
        const assetsManifest = readAssets(absDir)
        curScript.mediaDims = buildMediaDimsMap(assetsManifest, curScript)
        const schemaRes = await runSchemaDirectorWithDegradation({
          projectDir: absDir,
          topic: spec.topic || curScript.topic || curScript.title,
          directorNotes: spec.directorNotes || curScript.directorNotes || '',
          contentOutline: spec.contentOutline || curScript.contentOutline || '',
          genre: spec.genre || curScript.genre || '',
          genreLabel: spec.genreLabel || curScript.genreLabel || '',
          authoringMode: mode,
          style,
          targetPlatform,
          scriptData: curScript,
          assetsManifest,
          bgmMeta: analyzedBgmMeta,
          narrationMode: spec.narrationMode || curScript.narrationMode || '',
          pacingMode: spec.pacingMode || curScript.pacingMode || (spec.narrationMode === 'subtitle-mv' ? 'dynamic' : 'auto'),
          durationMode: effectiveDurationMode,
          targetDurationSec: effectiveTargetDurationSec,
          referenceStyle: refStyleSnap || curScript.referenceStyle || null,
          callLlmChatFn: guardedLlm,
          signal,
          onLlmWait: ({ waitMs }) =>
            appendLog('director', `大模型接口仍不可用，${Math.round((Number(waitMs) || 0) / 1000)} 秒后再试一次完整策划…`, 'warn'),
        })
        // The schema director degrades through tiers on errors: a billing failure must stop here, not fall back
        llmBilling.throwIfTripped()
        if (schemaRes?.resolved?.resolvedShots?.length >= 2) {
          const oldScenes = Array.isArray(curScript.scenes) ? curScript.scenes : []
          const visualPool = (assetsManifest?.items || []).filter((it) => it.type === 'image' || it.type === 'video')
          const updatedScenes = schemaRes.resolved.resolvedShots.map((shot, i) => {
            const oldSc = oldScenes[i] || oldScenes[i % Math.max(1, oldScenes.length)] || {}
            const fallbackAsset = visualPool.length > 0 ? visualPool[i % visualPool.length] : null
            const mediaList =
              Array.isArray(shot.media) && shot.media.length > 0
                ? shot.media.map((m) => {
                    const hit = visualPool.find((v) => v.path === m.path || v.editedPath === m.path)
                    return hit ? { ...m, width: Number(m.width || hit.editedWidth || hit.width || 0), height: Number(m.height || hit.editedHeight || hit.height || 0) } : m
                  })
                : shot.explicitZeroAsset
                  ? []
                  : Array.isArray(oldSc.media) && oldSc.media.length > 0
                    ? oldSc.media
                    : fallbackAsset
                      ? [{ assetId: fallbackAsset.id, path: fallbackAsset.path, webPath: fallbackAsset.webPath || '', type: fallbackAsset.type, width: Number(fallbackAsset.width || 0), height: Number(fallbackAsset.height || 0) }]
                      : []
            const nextNarration =
              normalizeNumeralsForDisplay(
                stripMetaInstructions(sanitizeSpokenNarration(shot.narration || oldSc.narration || shot.title || '')),
              ) ||
              normalizeNumeralsForDisplay(stripMetaInstructions(sanitizeSpokenNarration(shot.title || ''))) ||
              `镜头 ${i + 1}`
            const narrationChanged = Boolean(
              oldSc.narration &&
                nextNarration &&
                nextNarration !== normalizeNumeralsForDisplay(stripMetaInstructions(sanitizeSpokenNarration(oldSc.narration))),
            )
            const cleanTitle =
              normalizeNumeralsForDisplay(stripMetaInstructions(sanitizeSpokenNarration(shot.title || oldSc.title || `镜头 ${i + 1}`))) ||
              `镜头 ${i + 1}`
            const cleanSubChunks =
              Array.isArray(shot.subChunks) && shot.subChunks.length > 0
                ? shot.subChunks
                    .map((c) => cleanSubtitleChunk(normalizeNumeralsForDisplay(stripMetaInstructions(sanitizeSpokenNarration(c)))))
                    .filter(Boolean)
                : narrationChanged
                  ? undefined
                  : Array.isArray(oldSc.subChunks)
                    ? oldSc.subChunks
                        .map((c) => cleanSubtitleChunk(normalizeNumeralsForDisplay(stripMetaInstructions(c))))
                        .filter(Boolean)
                    : undefined
            const resolvedEmotion = shot.voiceEmotion || shot.emotion || oldSc.voiceEmotion || oldSc.emotion || '自信明快'
            return {
              ...oldSc,
              id: shot.id || oldSc.id || `scene-${String(i + 1).padStart(2, '0')}`,
              index: i + 1,
              title: cleanTitle,
              narration: nextNarration,
              subtitleText: cleanSubChunks?.length ? cleanSubChunks.join(' ') : nextNarration,
              subChunks: cleanSubChunks,
              accentWords: Array.isArray(shot.accentWords) ? shot.accentWords : oldSc.accentWords,
              threePreset: shot.threePreset || shot?.stageSpec?.threePreset || oldSc.threePreset,
              stageSpec: shot.stageSpec || oldSc.stageSpec,
              beatCount: Number.isFinite(Number(shot.beatCount)) ? Number(shot.beatCount) : oldSc.beatCount,
              visualBlueprint: shot.visualBlueprint || oldSc.visualBlueprint,
              motionNotes: shot.motionNotes || shot.visualBlueprint || oldSc.motionNotes,
              emotion: resolvedEmotion,
              voiceEmotion: resolvedEmotion,
              role: shot.role || oldSc.role || 'narrator',
              speechRate: Number(shot.speechRate || oldSc.speechRate || 1.04),
              layout:
                shot.layout ||
                oldSc.layout ||
                (visualPool.length === 0
                  ? (isHistoricalContent(`${spec.topic || ''} ${curScript.title || ''}`)
                      ? 'narrative-diorama'
                      : '3d-stage-opener')
                  : 'app-focus-shot'),
              kenBurns: shot.kenBurns || oldSc.kenBurns || 'zoom-in',
              actionMode: shot.actionMode || oldSc.actionMode || undefined,
              impactBeats: Array.isArray(shot.impactBeats) ? shot.impactBeats : oldSc.impactBeats,
              vibeTools: Array.isArray(shot.vibeTools) ? shot.vibeTools : oldSc.vibeTools,
              castIds: Array.isArray(shot.castIds) ? shot.castIds : oldSc.castIds,
              atmosphere: shot.atmosphere || oldSc.atmosphere,
              ambience: shot.ambience || oldSc.ambience,
              transition: shot.transition || oldSc.transition || (visualPool.length === 0 ? 'flash-cut' : 'iris-circle'),
              highlights: Array.isArray(shot.highlights) && shot.highlights.length > 0
                ? shot.highlights.map((h) => normalizeNumeralsForDisplay(stripMetaInstructions(h))).filter(Boolean)
                : oldSc.highlights || [],
              hudStep: Number.isFinite(Number(shot.hudStep)) ? Number(shot.hudStep) : oldSc.hudStep,
              cams: Array.isArray(shot.cams) && shot.cams.length > 0 ? shot.cams : oldSc.cams,
              marks: Array.isArray(shot.marks) && shot.marks.length > 0 ? shot.marks : oldSc.marks,
              cursors: Array.isArray(shot.cursors) && shot.cursors.length > 0 ? shot.cursors : oldSc.cursors,
              loupe: shot.loupe || oldSc.loupe,
              windowTheme: shot.windowTheme || oldSc.windowTheme || (schemaRes.plan?.genre === 'ui-tutorial' && mediaList.length > 0 ? 'light' : undefined),
              windowTitle: shot.windowTitle || oldSc.windowTitle,
              durationSec: Number(shot.durationSec) || oldSc.durationSec || 4.0,
              durationInFrames: undefined,
              media: mediaList,
              assetPaths: mediaList.map((m) => m.path),
            }
          })
          curScript.scenes = updatedScenes
          // the film's cast (演员表): one appearance per character for every shot (any genre)
          if (Array.isArray(schemaRes.plan?.cast) && schemaRes.plan.cast.length) curScript.cast = normalizeCast(schemaRes.plan.cast)
          if (normalizeFigureStyle(schemaRes.plan?.figureStyle)) curScript.figureStyle = normalizeFigureStyle(schemaRes.plan.figureStyle)
          if (normalizeFigureStyleNote(schemaRes.plan?.figureStyleNote)) curScript.figureStyleNote = normalizeFigureStyleNote(schemaRes.plan.figureStyleNote)
          const genreAfterDir = resolveGenreSelection({
            genre: schemaRes.plan?.genre || curScript.genre || spec.genre || '',
            genreLabel: schemaRes.plan?.genreLabel || curScript.genreLabel || spec.genreLabel || '',
            text: { topic: spec.topic || curScript.title, goal: curScript.directorNotes || curScript.goal, style, hasMedia: visualPool.length > 0 },
            hasScreenshots: visualPool.length > 0,
          })
          curScript.genre = genreAfterDir.id
          curScript.genreLabel = genreAfterDir.label
          if (schemaRes.plan?.audioProfile && typeof schemaRes.plan.audioProfile === 'object') {
            curScript.audioProfile = schemaRes.plan.audioProfile
          }
          curScript.title =
            normalizeNumeralsForDisplay(stripMetaInstructions(schemaRes.plan?.title || curScript.displayTitle || curScript.title)) ||
            curScript.title
          curScript.targetPlatform = targetPlatform
          if (visualPool.length === 0 || spec.narrationMode === 'subtitle-mv') {
            curScript.subtitleStyle = 'cinematic'
          }
          if (spec.narrationMode) {
            curScript.narrationMode = spec.narrationMode
          }
          if (Number(schemaRes.degradationTier || 4) <= 3) {
            curScript.authoringMode = 'ai-coded'
          }
          curScript.directorMeta = {
            tier: schemaRes.degradationTier || 4,
            tierLabel: schemaRes.tierLabel || 'Schema Tier',
            model: llmSummary.model || '',
            llmUsed: Number(schemaRes.degradationTier || 4) <= 3,
          }
          // the storyboard's beat grid: the AI-composed music is written at this tempo (see the BGM stage)
          if (Number(schemaRes.degradationTier || 4) <= 3 && Number(schemaRes.plan?.bpm) > 0) curScript.planBpm = Number(schemaRes.plan.bpm)
          else delete curScript.planBpm
          // Human edit protection: locked scenes keep content + timing; user overrides win (3-way merge)
          const directorMerge = reconcileUserEdits({ projectDir: absDir, prevScript: initialScriptSnap, nextScript: curScript, stage: 'llm-director' })
          if (directorMerge.report) {
            Object.assign(curScript, directorMerge.script)
            appendLog('director', `人工修改保护：${summarizeEditMerge(directorMerge.report)}`)
          }
          writeScriptJson(absDir, curScript)
          appendLog('director', `大模型导演调度完成 (${schemaRes.tierLabel || 'Schema Tier'} · ${updatedScenes.length} 幕${schemaRes.degradationTier > 1 ? ` · Tier1详情: ${schemaRes.trace?.[0]?.reason || 'unknown'}` : ''})`)
          const tierNo = Number(schemaRes.degradationTier || 4)
          if (tierNo >= 4) {
            const why = schemaRes.llmOutage
              ? `大模型接口持续限流或不可用（${String(schemaRes.llmOutage).slice(0, 90)}）`
              : `大模型没有返回可用的分镜（${String(schemaRes.trace?.[0]?.reason || '未知原因').slice(0, 90)}）`
            warnUser(
              'director',
              `⚠ ${why}，本次分镜改由规则引擎${schemaRes.briefBeatCount ? `按你需求里的 ${schemaRes.briefBeatCount} 个要点` : ''}生成（${updatedScenes.length} 幕），文案和节奏会比正常出片简单很多；建议稍后点「重新出片」。`,
            )
          } else if (tierNo >= 2) {
            warnUser('director', `⚠ 大模型返回的分镜不完整，已降级为简化策划（${schemaRes.tierLabel || `Tier ${tierNo}`}），画面编排会比完整策划简单。`)
          }
        }
      } catch (err) {
        if (err?.name === 'AbortError' || signal.aborted) throw createAbortError()
        // Billing errors (balance / quota) are never retried or silently degraded: stop the run
        if (isBillingError(err)) throw toBillingError(err, { scope: 'llm', provider: llmSummary.model || '' })
        warnUser('director', `⚠ 大模型策划失败，已回退本地规则规划：${err.message}`)
      }
    }

    const sAfterDir = readScriptJson(absDir).data
    sAfterDir.targetPlatform = targetPlatform
    if (spec.aiBadgeEnabled !== undefined) {
      sAfterDir.aiBadgeEnabled = Boolean(spec.aiBadgeEnabled)
      sAfterDir.aiBadge = Boolean(spec.aiBadgeEnabled)
    } else if (spec.aiBadge !== undefined) {
      sAfterDir.aiBadgeEnabled = Boolean(spec.aiBadge)
      sAfterDir.aiBadge = spec.aiBadge
    }
    if (spec.aiBadgePosition) sAfterDir.aiBadgePosition = String(spec.aiBadgePosition)
    if (spec.aiBadgeText !== undefined) sAfterDir.aiBadgeText = String(spec.aiBadgeText)
    if (spec.pacingMode) sAfterDir.pacingMode = String(spec.pacingMode)
    if (spec.visual3dMode) sAfterDir.visual3dMode = String(spec.visual3dMode)
    if (spec.visualReview !== undefined) sAfterDir.visualReview = spec.visualReview !== false
    sAfterDir.fps = effectiveFps
    sAfterDir.lowSpecSafe = hwPolicy.lowSpecSafe
    sAfterDir.hardwarePolicy = {
      profileMode: hwPolicy.profileMode,
      lowSpecSafe: hwPolicy.lowSpecSafe,
      clampedFields: hwPolicy.clampedFields,
      reason: hwPolicy.reason,
    }
    if (spec.avatarLayout) sAfterDir.avatarLayout = spec.avatarLayout
    // per-shot atmosphere (particles), ambience (sound bed) and on-screen cast, read by the audio and coding stages
    try {
      applyFigureStyleChoice(sAfterDir, spec)
      enrichScenesForVisuals(sAfterDir)
      const figStyle = sAfterDir.figureStyle
      const picked = normalizeFigureStyle(sAfterDir.figureStyleChoice)
      const byUser = picked && picked !== 'auto' ? '，你指定的' : ''
      const figText =
        figStyle === 'custom'
          ? `自定义「${sAfterDir.figureStyleNote || '按需求'}」（AI 自己设计角色，不套用人物库${byUser}）`
          : figStyle === 'auto'
            ? '未指定，由 AI 按作品气质决定'
            : `${FIGURE_STYLE_ZH[figStyle] || figStyle}（全片统一，可直接用人物库${byUser}）`
      appendLog('director', `🎨 人物画风：${figText}`)
    } catch {}
    // 演员表 ↔ 角色库: a person already in the character bank keeps its look; new cast members are saved to the project bank
    try {
      const sync = await syncCastWithCharacterBank({ projectDir: absDir, script: sAfterDir })
      const parts = [...sync.linked.map((n) => `${n}（沿用角色库形象）`), ...sync.created.map((n) => `${n}（已存入角色库）`)]
      if (parts.length) appendLog('director', `🧑‍🎨 演员表与角色库已打通：${parts.join('、')}`)
    } catch (err) {
      appendLog('director', `演员表同步角色库跳过：${String(err?.message || err).slice(0, 120)}`)
    }
    writeScriptJson(absDir, sAfterDir)
    stageSnap('director', 'after')
    updateTask('t-director', {
      status: 'completed',
      progress: 100,
      message: `策划完成：${sAfterDir.scenes?.length || 0} 幕分镜已生成 (${sAfterDir.width}x${sAfterDir.height})`,
    })
  }
  // later stages (SFX, beat quantize, BGM mood, mastering) use the project's decided base preset (script.style is
  // always a preset id; a custom AI / user style keeps its closest preset there)
  try {
    const decided = readScriptJson(absDir).data?.style
    if (decided) style = String(decided)
  } catch {}

  // =========================================================================
  // AGENT 2: 素材剪辑 Agent (editor)
  // =========================================================================
  if (!isDoneTask(run, 't-editor')) {
    await waitIfPaused('t-editor')
    updateTask('t-editor', {
      status: 'running',
      progress: 10,
      message: '素材剪辑 Agent 启动：正在调用 FFmpeg 智能裁切构图、调色增强与镜头对齐...',
    })

    // Auto B-roll (opt-in via cloud config / spec.autoUseCloudBroll): user assets → free stock → paid (budget-capped)
    {
      const cloudCfgNow = loadCloudMediaConfig()
      const wantsBroll = spec.autoUseCloudBroll !== undefined ? Boolean(spec.autoUseCloudBroll) : Boolean(cloudCfgNow.autoUseCloudBroll)
      if (wantsBroll) try {
        const sourcingPlan = resolveMediaSourcingPlan({
          projectDir: absDir,
          cloudConfig: cloudCfgNow,
          autoUseCloudBroll: true,
          maxPaidJobsPerRun: paidBudget.max,
          mediaType: spec.brollMediaType === 'video' ? 'video' : 'image',
        })
        if (sourcingPlan.scenes.some((x) => x.needsMedia)) {
          const sm = sourcingPlan.summary
          updateTask('t-editor', {
            status: 'running',
            progress: 6,
            message: `B-roll 素材调度：用户素材 ${sm.userAssets} 幕 · 免费素材库 ${sm.freeStock} 幕 · 付费生成 ${sm.paid} 幕（本次上限 ${paidBudget.max}）`,
          })
          const sourcingRes = await executeMediaSourcingPlan({
            projectDir: absDir,
            plan: sourcingPlan,
            budget: paidBudget,
            runId: run.id,
            signal,
            onLog: (msg, level) => appendLog('editor', msg, level === 'warn' ? 'warn' : 'info'),
          })
          appendLog(
            'editor',
            `B-roll 素材调度完成：补齐 ${sourcingRes.applied.length} 幕 · 跳过 ${sourcingRes.skipped.length} 幕 · 新提交付费任务 ${sourcingRes.paidSubmitted} 个（复用已付费结果 ${sourcingRes.paidReused} 个）`,
          )
        }
      } catch (err) {
        // Optional step: only cancellation and billing stops propagate (billing ends the whole run)
        if (err?.name === 'AbortError' || signal.aborted) throw createAbortError()
        if (isBillingError(err)) throw toBillingError(err, { scope: err?.scope || 'cloud', provider: err?.provider || '' })
        appendLog('editor', `B-roll 素材调度已跳过: ${err?.message || err}`, 'warn')
      }
    }

    const curScript = readScriptJson(absDir).data
    const editRes = await executeCurateAndEditAssets({
      projectDir: absDir,
      aspectRatio: curScript.aspectRatio || aspectRatio,
      quality: curScript.quality || quality,
      width: curScript.width,
      height: curScript.height,
      style: curScript.style || style,
      trimSeconds: Number(spec.trimSeconds) || 0,
      clipSpeed: Number(spec.clipSpeed) || 1.0,
      chromaKeyColor: spec.mediaChromaKeyColor || '',
      enhanceColor: spec.enhanceColor !== false,
      signal,
      onChild,
      onProgress: (p) => {
        updateTask('t-editor', {
          status: 'running',
          progress: Math.max(10, Math.min(95, Number(p.progress) || 50)),
          message: p.message || '素材剪辑中...',
          log: false,
        })
      },
    })

    stageSnap('editor', 'after')
    updateTask('t-editor', {
      status: 'completed',
      progress: 100,
      message: `素材精修完成：已裁切调色 ${editRes.editedCount || 0} 份视觉素材`,
    })
  }

  // =========================================================================
  // AGENT 3: 配音混音 Agent (audio) + 数字人生成 (avatar)
  // =========================================================================
  if (!isDoneTask(run, 't-audio')) {
    await waitIfPaused('t-audio')
    const activeTtsSpec = resolveTtsEngineSpec(spec.ttsEngine || getActiveTtsEngineId())
    updateTask('t-audio', {
      status: 'running',
      progress: 10,
      message: `配音混音 Agent 启动：正在使用 ${activeTtsSpec.shortName || activeTtsSpec.name} 生成旁白语音与音色匹配...`,
    })

    let scriptNow = readScriptJson(absDir).data
    // Human edit protection: remember locked scenes' sfxCues + voice fields before TTS / beat quantization
    const lockedAudioSnap = snapshotLockedSceneAudio(scriptNow)
    const lockedVoiceSource = lockedAudioSnap.lockedIds.length > 0 ? JSON.parse(JSON.stringify(scriptNow)) : null
    const assetsNow = readAssets(absDir)
    const fps = Number(scriptNow.fps) || 30
    const hostVideoAsset = (assetsNow.items || []).find((it) => it.role === 'host_video' && it.type === 'video')
    const voiceCloneSample = (assetsNow.items || []).find((it) => it.role === 'voice_clone')

    if (spec.useHostVocal && hostVideoAsset && hostVideoAsset.hasAudio !== false) {
      updateTask('t-audio', {
        status: 'running',
        progress: 25,
        message: '检测到真人出镜原声视频，正在提取 48kHz 干声并按分镜口播智能分段对齐...',
      })
      const { ffmpeg } = resolveBinaries()
      const hostAbs = isAbsolute(hostVideoAsset.path) ? hostVideoAsset.path : resolve(absDir, hostVideoAsset.path)
      const scenesList = Array.isArray(scriptNow.scenes) ? scriptNow.scenes : []
      if (scenesList.length > 0 && existsSync(hostAbs)) {
        const hostFullAbs = join(absDir, 'audio', 'host-full.wav')
        mkdirSync(join(absDir, 'audio'), { recursive: true })
        const extRes = await runCommandRedirected(
          ffmpeg,
          ['-y', '-i', hostAbs, '-vn', '-af', 'highpass=f=75,aresample=48000', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', hostFullAbs],
          { timeoutMs: 45_000, signal, onChild },
        )
        if (extRes.code === 0 && existsSync(hostFullAbs)) {
          const probedHost = await probeAudioDuration(hostFullAbs, fps).catch(() => ({ durationSec: 0 }))
          const totalHostSec = Number(probedHost.durationSec) || 0
          // Split full recorded monologue proportionally across ALL scenes if long enough so speaker voice never switches mid-video
          if (totalHostSec >= 2.2 && scenesList.length > 1) {
            const weights = scenesList.map((sc) => Math.max(4, String(sc.narration || sc.title || '').length, Number(sc.durationSec || 3) * 4))
            const sumW = weights.reduce((a, b) => a + b, 0) || 1
            let cursorSec = 0
            let assigned = 0
            for (let si = 0; si < scenesList.length; si++) {
              const sc = scenesList[si]
              const segDur = si === scenesList.length - 1
                ? Math.max(0.8, totalHostSec - cursorSec)
                : Math.max(0.8, Number(((weights[si] / sumW) * totalHostSec).toFixed(3)))
              const segRel = `audio/${sc.id}-host.wav`
              const segAbs = join(absDir, segRel)
              const sliceRes = await runCommandRedirected(
                ffmpeg,
                ['-y', '-ss', cursorSec.toFixed(3), '-t', segDur.toFixed(3), '-i', hostFullAbs, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', segAbs],
                { timeoutMs: 30_000, signal, onChild },
              )
              cursorSec += segDur
              if (sliceRes.code === 0 && existsSync(segAbs)) {
                sc.audioFile = segRel
                sc.voiceDurationSec = segDur
                sc.durationSec = Math.max(1.8, Number((segDur + 0.35).toFixed(3)))
                sc.durationInFrames = Math.ceil(sc.durationSec * fps)
                assigned++
              }
            }
            writeScriptJson(absDir, scriptNow)
            appendLog('audio', `已抽取真人出镜原声 (${totalHostSec.toFixed(1)}s) 并按口播节奏切分至全部 ${assigned} 幕`)
          } else {
            const firstSc = scenesList[0]
            const hostWavRel = `audio/${firstSc.id}-host.wav`
            const hostWavAbs = join(absDir, hostWavRel)
            const copyRes = await runCommandRedirected(
              ffmpeg,
              ['-y', '-i', hostFullAbs, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', hostWavAbs],
              { timeoutMs: 25_000, signal, onChild },
            )
            if (copyRes.code === 0 && existsSync(hostWavAbs)) {
              firstSc.audioFile = hostWavRel
              writeScriptJson(absDir, scriptNow)
              appendLog('audio', `真人原声较短 (${totalHostSec.toFixed(1)}s)，已作为第 1 幕开场原声挂载`)
            }
          }
        }
      }
    }

    scriptNow = readScriptJson(absDir).data
    const visualItemsNow = (assetsNow.items || []).filter((it) => it.type === 'image' || it.type === 'video')
    let effectiveNarrationMode =
      spec.narrationMode ||
      scriptNow.narrationMode ||
      (visualItemsNow.length === 0 && bgmMode === 'uploaded' && !spec.useHostVocal ? 'subtitle-mv' : 'tts')
    if ((wantsPureMusicByPrompt || wantsRefSubtitleMv) && !spec.useHostVocal) {
      effectiveNarrationMode = 'subtitle-mv'
    } else if (wantsBeatSyncByPrompt && bgmMode === 'uploaded' && effectiveNarrationMode === 'tts') {
      effectiveNarrationMode = 'tts-beat-sync'
      appendLog('audio', '检测到指令要求分镜与动效全程踩死上传 BGM 节拍，已自动切换为「AI 配音 + 真实节拍踩点切镜」模式')
    }
    scriptNow.narrationMode = effectiveNarrationMode
    if (effectiveNarrationMode === 'subtitle-mv') {
      scriptNow.subtitleStyle = 'cinematic'
    }

    // Auto-adopt uploaded voice_clone sample when user didn't pick another voice explicitly
    if (effectiveNarrationMode !== 'subtitle-mv' && voiceCloneSample && (!voiceId || voiceId === 'auto')) {
      const sampleAbs = isAbsolute(voiceCloneSample.path) ? voiceCloneSample.path : resolve(absDir, voiceCloneSample.path)
      if (existsSync(sampleAbs)) {
        try {
          const cloned = await cloneRecordedVoice({
            audioPath: sampleAbs,
            voiceName: `项目声纹_${voiceCloneSample.name || '克隆人声'}`,
          })
          if (cloned?.voice?.id) {
            voiceId = cloned.voice.id
            scriptNow.defaultVoiceId = voiceId
            scriptNow.voiceMode = 'manual'
            writeScriptJson(absDir, scriptNow)
            appendLog('audio', `检测到已上传声音克隆样本「${voiceCloneSample.name}」，已自动注册并绑定为主讲声纹 (${voiceId})`)
          }
        } catch (vcErr) {
          appendLog('audio', `声音克隆样本自动注册略过: ${vcErr?.message || vcErr}`, 'warn')
        }
      }
    }

    if (effectiveNarrationMode === 'subtitle-mv') {
      updateTask('t-audio', {
        status: 'running',
        progress: 45,
        message: '纯音乐卡点动画模式：跳过 TTS 朗读，正在精确绑定镜头切入与字幕至音乐重拍...',
      })
      writeScriptJson(absDir, scriptNow)
    } else {
      let llmCastOk = false
      if (mode === 'ai-coded' && llmSummary.configured && (!voiceId || voiceId === 'auto')) {
        updateTask('t-audio', {
          status: 'running',
          progress: 14,
          message: `正在召唤大模型 (${llmSummary.model}) 根据主题与情绪语义挑选精品音色...`,
        })
        try {
          const curGenreInfo = resolveGenreSelection({
            genre: scriptNow.genre || spec.genre || '',
            genreLabel: scriptNow.genreLabel || spec.genreLabel || '',
            text: { topic: scriptNow.title || spec.topic, goal: scriptNow.directorNotes || scriptNow.goal, style, hasMedia: visualItemsNow.length > 0 },
            hasScreenshots: visualItemsNow.length > 0,
          })
          const castRes = await castVoicesWithLlm({
            projectDir: absDir,
            scriptData: scriptNow,
            genre: curGenreInfo.id,
            genreGuidance: buildGenreGuidance(curGenreInfo.id, curGenreInfo.label),
            callLlmChatFn: guardedLlm,
          })
          if (castRes?.ok) {
            llmCastOk = true
            appendLog('audio', `AI 语义选音完成: 主讲 [${castRes.primaryVoiceName || castRes.primaryVoiceId}] · ${castRes.primaryReason || ''}`)
          }
        } catch (castErr) {
          if (isBillingError(castErr)) throw toBillingError(castErr, llmBillingInfo)
          appendLog('audio', `AI 语义选音回退规则匹配: ${castErr?.message || castErr}`, 'warn')
        }
        llmBilling.throwIfTripped()
      }
      if (!llmCastOk) {
        matchAllScenesInScript(absDir, { voiceId, forceAuto: false })
      }
      if (lockedVoiceSource) reassertLockedScenes(absDir, lockedVoiceSource)
      scriptNow = readScriptJson(absDir).data

      const scenesToTts = (scriptNow.scenes || []).filter((sc) => {
        const hasExisting = sc.audioFile && existsSync(isAbsolute(sc.audioFile) ? sc.audioFile : resolve(absDir, sc.audioFile))
        // Locked scenes keep their existing narration audio
        return !hasExisting || (!spec.preserveExistingAudio && !isSceneLocked(sc))
      })

      for (let i = 0; i < scenesToTts.length; i++) {
        if (signal.aborted) throw createAbortError()
        await waitIfPaused('t-audio')
        const sc = scenesToTts[i]
        if (spec.useHostVocal && sc.audioFile && sc.audioFile.includes('-host.wav')) continue
        updateTask('t-audio', {
          status: 'running',
          progress: Math.round(20 + ((i + 0.5) / Math.max(1, scenesToTts.length)) * 30),
          message: `正在合成第 ${i + 1}/${scenesToTts.length} 幕配音 (${sc.title || sc.id})...`,
          log: false,
        })
        const sceneSpeed = Number(((Number(sc.speechRate) || 1.04) * speechTempo).toFixed(2))
        const displayText = sc.narration || sc.title || '欢迎来到 AI 视频创作工坊'
        const spokenTtsText = sc.ttsText || toTtsText(displayText)
        await executeGenerateSpeech({
          text: displayText,
          ttsText: spokenTtsText,
          emotion: sc.voiceEmotion || sc.emotion || '自信明快',
          speed: sceneSpeed,
          outputPath: `audio/${sc.id}.wav`,
          fps,
          voiceId: sc.voiceId || voiceId || 'auto',
          engine: spec.ttsEngine || getActiveTtsEngineId(),
          scriptPath: absDir,
          sceneId: sc.id,
          allowPlaceholder,
        })
      }

      if (signal.aborted) throw createAbortError()
      await waitIfPaused('t-audio')
      updateTask('t-audio', {
        status: 'running',
        progress: 58,
        message: '正在执行 AI 修音去静音、响度标准化与人声母带均衡...',
      })
      try {
        const masterRes = await masterVoiceTracks({
          projectDir: absDir,
          useLlm: mode === 'ai-coded' && llmSummary.configured,
          speechTempo: 1.0,
          trimSilence: true,
          signal,
          onChild,
          onProgress: (msg) => appendLog('audio', msg),
        })
        // The mastering helper falls back to DSP on LLM errors and only keeps the reason text
        const masterBilling = masterRes?.mode !== 'ai-llm' ? billingErrorFromText(masterRes?.engineerSummary, llmBillingInfo) : null
        if (masterBilling) throw masterBilling
      } catch (err) {
        if (err?.name === 'AbortError' || signal.aborted) throw createAbortError()
        if (isBillingError(err)) throw toBillingError(err, llmBillingInfo)
        appendLog('audio', `修音阶段跳过未完成音轨: ${err.message}`, 'warn')
      }

      scriptNow = await recomputeCumulativeTimeline(absDir)
    }

    if (signal.aborted) throw createAbortError()
    await waitIfPaused('t-audio')
    updateTask('t-audio', {
      status: 'running',
      progress: 75,
      message: '正在生成转场 SFX 音效与背景配乐，并执行节拍踩点混音...',
    })

    if (mode === 'ai-coded' && llmSummary.configured) {
      llmBilling.throwIfTripped()
      const sfxRes = await generateAiCodedSfxCues({ projectDir: absDir, style, signal }).catch((err) =>
        isBillingError(err) ? { fallback: true, billingErr: toBillingError(err, llmBillingInfo) } : null,
      )
      // generateAiCodedSfxCues returns { fallback, reason } instead of throwing: never ignore a billing failure
      const sfxBilling = sfxRes?.billingErr || (sfxRes?.fallback ? billingErrorFromText(sfxRes.reason, llmBillingInfo) : null)
      if (sfxBilling) throw sfxBilling
    }

    const totalSec = Math.max(4, Number(scriptNow.totalDurationSec) || 12)
    const uploadedMusic = (assetsNow.items || []).filter((it) => it.role === 'music')
    const uploadedSfx = (assetsNow.items || []).filter((it) => it.role === 'sfx')
    const chosenUploadPath = spec.uploadedBgmPath || uploadedMusic[0]?.path || scriptNow.bgm?.uploadedPath || ''
    const customSfxPick = (kind) => {
      if (uploadedSfx.length > 0) {
        const hit = uploadedSfx.find((x) => String(x.name || x.originalName || '').toLowerCase().includes(String(kind || '').toLowerCase()))
        if (hit?.path) return hit.path
      }
      return `audio/sfx/${kind}.wav`
    }
    scriptNow.bgmMode = bgmMode
    scriptNow.audioSpec = { ...(scriptNow.audioSpec || {}), bgmMode }

    if (bgmMode === 'uploaded' && chosenUploadPath) {
      const absBgmFile = isAbsolute(chosenUploadPath) ? chosenUploadPath : resolve(absDir, chosenUploadPath)
      let beatMeta = scriptNow.bgm?.analyzed ? scriptNow.bgm : null
      if (!beatMeta && existsSync(absBgmFile)) {
        try {
          beatMeta = await analyzeAudioBeatStructure(absBgmFile, { signal })
        } catch {}
      }
      scriptNow.bgm = {
        ...(scriptNow.bgm || {}),
        ...(beatMeta || {}),
        enabled: true,
        mode: 'uploaded',
        source: 'user-imported',
        path: chosenUploadPath,
        uploadedPath: chosenUploadPath,
      }
      if (beatMeta?.analyzed && (effectiveNarrationMode === 'subtitle-mv' || effectiveNarrationMode === 'tts-beat-sync' || spec.beatSync || true)) {
        const qMode = effectiveNarrationMode === 'subtitle-mv' ? 'subtitle-mv' : 'tts-beat-sync'
        const adaptiveOpts = {
          genre: scriptNow.genre || spec.genre,
          genreLabel: scriptNow.genreLabel || spec.genreLabel,
          title: scriptNow.title || spec.topic,
          style,
          narrationMode: effectiveNarrationMode,
          pacingMode: scriptNow.pacingMode || spec.pacingMode,
          audioProfile: scriptNow.audioProfile,
          referenceStyle: scriptNow.referenceStyle,
          sfxPick: customSfxPick,
        }
        scriptNow.scenes = quantizeScenesToBeatGrid(scriptNow.scenes || [], beatMeta, {
          ...adaptiveOpts,
          mode: qMode,
          fps,
          targetDurationSec: effectiveTargetDurationSec,
        })
        scriptNow.scenes = choreographBeatSfxCues(scriptNow.scenes, beatMeta, { ...adaptiveOpts, fps })
        scriptNow.subtitles = scriptNow.scenes.flatMap((sc) => sc.subtitles || [])
        const lastSc = scriptNow.scenes[scriptNow.scenes.length - 1]
        scriptNow.totalDurationInFrames = lastSc ? Number(lastSc.startFrame || 0) + Number(lastSc.durationInFrames || 0) : scriptNow.totalDurationInFrames
        scriptNow.totalDurationSec = Number(((scriptNow.totalDurationInFrames || 30) / fps).toFixed(4))
        appendLog('audio', `已完成全品类自适应上传 BGM 节拍踩点与音效编排：${scriptNow.scenes.length} 幕锁定 ${beatMeta.bpm} BPM (${scriptNow.totalDurationSec.toFixed(1)}s)`)
      }
      writeScriptJson(absDir, scriptNow)
    } else if (bgmMode === 'llm-coded' && mode === 'ai-coded' && llmSummary.configured) {
      try {
        const bgmScriptInput = {
          ...scriptNow,
          title: spec.topic || scriptNow.title || scriptNow.topic,
          style,
          totalDurationSec: totalSec + 1.0,
          // the storyboard's beat grid (planBpm) wins over the placeholder track's tempo: shots were planned on it
          audioSpec: { ...(scriptNow.audioSpec || {}), mood: style, bpm: Number(scriptNow.planBpm) || Number(scriptNow.bgm?.bpm) || 118 },
        }
        const bgmRes = await generateAiCodedBgmTrack({
          projectDir: absDir,
          script: bgmScriptInput,
          callLlmChatFn: llmBilling.wrap((p) => callLlmChat({ timeoutMs: 240_000, ...p, signal, onRetry: onLlmRetry })),
        })
        scriptNow.bgm = { ...(scriptNow.bgm || {}), mode: 'llm-coded', source: 'llm-coded', path: bgmRes.relWavPath }
        writeScriptJson(absDir, scriptNow)
        appendLog('audio', `AI 大模型编写 BGM 合成代码完成: ${bgmRes.relWavPath}${bgmRes.engineNote ? `（${String(bgmRes.engineNote).slice(0, 160)}）` : ''}`)
      } catch (err) {
        if (isBillingError(err)) throw toBillingError(err, llmBillingInfo)
        // The AI composer failed (after its own retry): render the local synth bed NOW — full film length, on the
        // storyboard's tempo — and switch the mix to it. "Fell back" must mean the film has music: before, the
        // mode stayed 'llm-coded' and the mixer picked up a failed attempt's silent bgm-llm.wav instead.
        const fbBpm = Math.round(Number(scriptNow.planBpm) || Number(scriptNow.bgm?.bpm) || 118)
        const fbReason = String(err?.message || err).slice(0, 120)
        try {
          generateBgmWav({
            durationSec: totalSec + 1.2,
            mood: scriptNow.audioSpec?.mood || scriptNow.bgm?.mood || style,
            bpm: fbBpm,
            audioSpec: null,
            outPath: join(absDir, 'audio', 'bgm-generated.wav'),
          })
          bgmMode = 'generated'
          scriptNow.bgmMode = bgmMode
          scriptNow.audioSpec = { ...(scriptNow.audioSpec || {}), bgmMode }
          scriptNow.bgm = { ...(scriptNow.bgm || {}), enabled: true, mode: 'generated', source: 'generated', path: 'audio/bgm-generated.wav', bpm: fbBpm }
          writeScriptJson(absDir, scriptNow)
          warnUser('audio', `⚠ 大模型编曲失败（${fbReason}），已改用本地合成配乐（${fbBpm} BPM，覆盖全片）`)
        } catch (genErr) {
          warnUser('audio', `⚠ 大模型编曲失败（${fbReason}），本地合成配乐也未能生成：${String(genErr?.message || genErr).slice(0, 120)}`)
        }
      }
      llmBilling.throwIfTripped()
    } else if (bgmMode === 'tts-engine') {
      try {
        const ttsBgm = await synthesizeTtsEngineAudioCue({
          projectDir: absDir,
          promptText: spec.bgmTtsPrompt || `${spec.topic || '沉浸光影'} 氛围声场`,
          voiceId: voiceCloneSample?.id || voiceId || 'auto',
          durationSec: totalSec + 1.0,
        })
        scriptNow.bgm = { ...(scriptNow.bgm || {}), mode: 'tts-engine', source: 'tts-engine', path: ttsBgm.relWavPath }
        writeScriptJson(absDir, scriptNow)
      } catch (err) {
        appendLog('audio', `配音引擎氛围配乐回退本地合成: ${err.message}`, 'warn')
      }
    }

    const postBgmScript = readScriptJson(absDir).data
    const curGenreForBeat = String(postBgmScript.genre || spec.genre || '').toLowerCase()
    const adaptiveAudioMeta = {
      genre: postBgmScript.genre || spec.genre,
      genreLabel: postBgmScript.genreLabel || spec.genreLabel,
      title: postBgmScript.title || spec.topic,
      style,
      narrationMode: effectiveNarrationMode,
      pacingMode: postBgmScript.pacingMode || spec.pacingMode,
      audioProfile: postBgmScript.audioProfile,
      referenceStyle: postBgmScript.referenceStyle,
      sfxPick: customSfxPick,
    }
    const wantsBeatSync =
      effectiveNarrationMode === 'subtitle-mv' ||
      effectiveNarrationMode === 'tts-beat-sync' ||
      Boolean(spec.beatSync) ||
      bgmMode === 'uploaded' ||
      curGenreForBeat === 'history-theater' ||
      curGenreForBeat === 'mv-lyric' ||
      postBgmScript.audioProfile?.beatCutIntensity !== 'off'
    if (wantsBeatSync && !(postBgmScript.scenes || []).some((s) => s.beatCutAligned)) {
      const bgmWavRel = postBgmScript.bgm?.path || ''
      const bgmWavAbs = bgmWavRel ? (isAbsolute(bgmWavRel) ? bgmWavRel : resolve(absDir, bgmWavRel)) : ''
      let analyzedSynth = null
      if (bgmWavAbs && existsSync(bgmWavAbs)) {
        try {
          analyzedSynth = await analyzeAudioBeatStructure(bgmWavAbs, { signal })
        } catch {}
      }
      const grid = analyzedSynth?.analyzed
        ? analyzedSynth
        : buildBeatGrid((Number(postBgmScript.totalDurationSec) || totalSec) + 2, Number(postBgmScript.bgm?.bpm) || 120)
      postBgmScript.bgm = { ...(postBgmScript.bgm || {}), ...grid, beats: grid.beats }
      const qMode = effectiveNarrationMode === 'subtitle-mv' ? 'subtitle-mv' : 'tts-beat-sync'
      postBgmScript.scenes = quantizeScenesToBeatGrid(postBgmScript.scenes || [], grid, {
        ...adaptiveAudioMeta,
        mode: qMode,
        fps,
        targetDurationSec: effectiveTargetDurationSec,
        // beat counts were planned on the storyboard's tempo; an AI-composed track may come out at another one
        planBpm: bgmMode !== 'uploaded' ? Number(postBgmScript.planBpm) || 0 : 0,
      })
      postBgmScript.scenes = choreographBeatSfxCues(postBgmScript.scenes, grid, { ...adaptiveAudioMeta, fps })
      postBgmScript.subtitles = postBgmScript.scenes.flatMap((sc) => sc.subtitles || [])
      const lastSc = postBgmScript.scenes[postBgmScript.scenes.length - 1]
      postBgmScript.totalDurationInFrames = lastSc ? Number(lastSc.startFrame || 0) + Number(lastSc.durationInFrames || 0) : postBgmScript.totalDurationInFrames
      postBgmScript.totalDurationSec = Number(((postBgmScript.totalDurationInFrames || 30) / fps).toFixed(4))
      writeScriptJson(absDir, postBgmScript)
      appendLog('audio', `已对全品类声场执行自适应音画踩点与音效编排 (${qMode} · ${postBgmScript.bgm?.bpm || 120} BPM · ${postBgmScript.scenes.length} 幕)`)
    } else if (durationPolicy.enforced && effectiveTargetDurationSec > 10 && !wantsBeatSync) {
      // Non-beat-sync TTS mode: if user set a strict duration and spoken tracks fell slightly short, add smooth visual breathing cushion
      const curTot = Number(postBgmScript.totalDurationSec) || 0
      const scArr = Array.isArray(postBgmScript.scenes) ? postBgmScript.scenes : []
      if (scArr.length > 0 && curTot > 2 && curTot < durationPolicy.minSec * 0.96) {
        const extraEach = Math.min(3.6, (durationPolicy.targetSec - curTot) / scArr.length)
        for (const sc of scArr) {
          sc.durationSec = Number(((Number(sc.durationSec) || 3.5) + extraEach).toFixed(4))
          sc.durationInFrames = Math.max(15, Math.ceil(sc.durationSec * fps))
        }
        writeScriptJson(absDir, postBgmScript)
        await recomputeCumulativeTimeline(absDir)
      }
    }

    const scriptForMix = readScriptJson(absDir).data
    scriptForMix.bgmMode = bgmMode
    scriptForMix.audioSpec = { ...(scriptForMix.audioSpec || {}), bgmMode }
    if (bgmMode === 'uploaded' && chosenUploadPath) {
      scriptForMix.bgm = { ...(scriptForMix.bgm || {}), enabled: true, mode: 'uploaded', source: 'user-imported', path: chosenUploadPath, uploadedPath: chosenUploadPath }
    }
    let sfxInjected = false
    // Inject user-uploaded custom SFX files (role === 'sfx') onto scene transition/accent points if not already wired
    if (uploadedSfx.length > 0 && Array.isArray(scriptForMix.scenes) && scriptForMix.scenes.length > 0) {
      const alreadyUsed = new Set(
        scriptForMix.scenes.flatMap((s) => (s.sfxCues || []).map((q) => q.path)).filter(Boolean),
      )
      const unusedSfx = uploadedSfx.filter((u) => u.path && !alreadyUsed.has(u.path))
      if (unusedSfx.length > 0) {
        for (let ui = 0; ui < unusedSfx.length; ui++) {
          const targetSc = scriptForMix.scenes[Math.min(scriptForMix.scenes.length - 1, Math.floor(((ui + 0.5) * scriptForMix.scenes.length) / unusedSfx.length))]
          targetSc.sfxCues = Array.isArray(targetSc.sfxCues) ? [...targetSc.sfxCues] : []
          targetSc.sfxCues.push({ type: 'custom', path: unusedSfx[ui].path, offsetSec: 0.12, volume: 0.68, pan: 0 })
          sfxInjected = true
        }
        appendLog('audio', `已将用户上传的 ${unusedSfx.length} 份自定义音效挂入成片分镜混音轨`)
      }
    }
    for (const sc of scriptForMix.scenes || []) {
      const scDur = Math.max(1.0, Number(sc.durationSec) || 4.0)
      sc.sfxCues = Array.isArray(sc.sfxCues) ? [...sc.sfxCues] : []
      if (Array.isArray(sc.cursors) && sc.cursors.length > 0) {
        for (const c of sc.cursors) {
          const clickAtRaw = Number.isFinite(Number(c?.clickAt))
            ? Number(c.clickAt)
            : c?.click
              ? (Number(c?.t) > 1.01 ? Number(c.t) : (Number(c?.t) || 0.45) * scDur)
              : NaN
          if (!Number.isFinite(clickAtRaw) || clickAtRaw < 0) continue
          const clickAt = Number(Math.min(Math.max(0.15, clickAtRaw), Math.max(0.25, scDur - 0.14)).toFixed(2))
          const pan = Number.isFinite(Number(c?.fx)) ? Math.max(-0.4, Math.min(0.4, (Number(c.fx) - 0.5) * 0.7)) : 0
          if (!sc.sfxCues.some((q) => q.type === 'click' && Math.abs(Number(q.offsetSec || 0) - clickAt) < 0.25)) {
            sc.sfxCues.push({ type: 'click', path: 'audio/sfx/click.wav', offsetSec: clickAt, volume: 0.68, pan })
            sfxInjected = true
          }
          const lbl = `${c?.label || ''} ${sc.visualBlueprint || ''}`
          if (/抽屉|展开|打开|弹窗|新建|菜单|切换|滑出/.test(lbl)) {
            const wAt = Number(Math.min(scDur - 0.1, clickAt + 0.16).toFixed(2))
            if (!sc.sfxCues.some((q) => q.type === 'whoosh' && Math.abs(Number(q.offsetSec || 0) - wAt) < 0.35)) {
              sc.sfxCues.push({ type: 'whoosh', path: 'audio/sfx/whoosh.wav', offsetSec: wAt, volume: 0.46, pan: pan * 0.5 })
              sfxInjected = true
            }
          }
          if (/输入|打字|填写|润色|提示词/.test(lbl)) {
            const tAt = Number(Math.min(scDur - 0.35, clickAt + 0.26).toFixed(2))
            if (!sc.sfxCues.some((q) => q.type === 'typing' && Math.abs(Number(q.offsetSec || 0) - tAt) < 0.45)) {
              sc.sfxCues.push({ type: 'typing', path: 'audio/sfx/typing.wav', offsetSec: tAt, volume: 0.36, pan: 0, d: 0.6 })
              sfxInjected = true
            }
          }
        }
      } else if (scriptForMix.genre === 'ui-tutorial' && (Array.isArray(sc.media) && sc.media.length > 0)) {
        const bp = `${sc.title || ''} ${sc.visualBlueprint || ''} ${sc.narration || ''}`
        if (/点击|新建|打开|抽屉|按钮|切换|启动/.test(bp) && !sc.sfxCues.some((q) => q.type === 'click')) {
          sc.sfxCues.push({ type: 'click', path: 'audio/sfx/click.wav', offsetSec: Number(Math.min(scDur - 0.25, 1.05).toFixed(2)), volume: 0.64, pan: 0 })
          sfxInjected = true
        }
        if (/抽屉|展开|打开|滑出|弹窗|页面/.test(bp) && !sc.sfxCues.some((q) => q.type === 'whoosh')) {
          sc.sfxCues.push({ type: 'whoosh', path: 'audio/sfx/whoosh.wav', offsetSec: Number(Math.min(scDur - 0.2, 1.22).toFixed(2)), volume: 0.45, pan: 0 })
          sfxInjected = true
        }
        if (/输入|打字|填写|润色|提示词/.test(bp) && !sc.sfxCues.some((q) => q.type === 'typing')) {
          sc.sfxCues.push({ type: 'typing', path: 'audio/sfx/typing.wav', offsetSec: Number(Math.min(scDur - 0.4, 1.45).toFixed(2)), volume: 0.35, pan: 0, d: 0.6 })
          sfxInjected = true
        }
      }
    }
    if (sfxInjected) {
      writeScriptJson(absDir, scriptForMix)
    }

    // Human edit protection: locked scenes keep their sfxCues (scene-relative if the beat grid changed),
    // and user overrides are re-applied after beat quantization (user changes win)
    {
      const sfxRestore = restoreLockedSceneSfx(scriptForMix, lockedAudioSnap)
      const ovr = applyUserOverrides(scriptForMix)
      if (sfxRestore.restored.length > 0 || ovr.applied.length > 0) {
        writeScriptJson(absDir, scriptForMix)
        if (ovr.applied.some((a) => (a.fields || []).some((f) => f === 'durationSec' || f === 'durationInFrames'))) {
          Object.assign(scriptForMix, await recomputeCumulativeTimeline(absDir))
        }
        if (sfxRestore.restored.length > 0) {
          appendLog(
            'audio',
            `已保留锁定场景 ${sfxRestore.restored.join(', ')} 的音效编排${sfxRestore.gridChanged ? '（节拍网格已变化，音效按场景内相对时间保留）' : ''}`,
          )
        }
      }
    }

    await ensureProjectAudioAssets(absDir, scriptForMix, assetsNow)
    const audioMix = await mixVideoAudio({
      projectDir: absDir,
      script: scriptForMix,
      assetsManifest: assetsNow,
      outputPath: join(absDir, 'output', 'master-audio.wav'),
      signal,
      onChild,
    })
    if (audioMix?.bgmFallback) {
      warnUser('audio', `⚠ 配乐文件是静音（${audioMix.bgmFallback.from || '未知'}），已自动改用本地合成配乐${audioMix.bgmFallback.bpm ? `（${audioMix.bgmFallback.bpm} BPM）` : ''}`)
    } else if (audioMix && audioMix.bgmSource === 'none' && scriptForMix?.bgm?.enabled !== false) {
      warnUser('audio', '⚠ 本次混音没有找到可用的背景音乐，成片只有音效')
    }

    stageSnap('audio', 'after')
    updateTask('t-audio', {
      status: 'completed',
      progress: 100,
      message: '配音混音完成：人声母带 + SFX + 闪避 BGM 已混录为 output/master-audio.wav',
    })
  }

  // Optional Avatar Subtask (`t-avatar`)
  if (spec.avatarEnabled && !isDoneTask(run, 't-avatar')) {
    await waitIfPaused('t-avatar')
    updateTask('t-avatar', {
      status: 'running',
      progress: 12,
      message: '数字人引擎启动：正在准备口播人声与透明通道合成...',
    })
    const scriptForAvatar = readScriptJson(absDir).data
    const assetsAv = readAssets(absDir)
    const avatarBase =
      spec.avatarSourcePath ||
      (assetsAv.items || []).find((it) => it.role === 'avatar_base')?.path ||
      (assetsAv.items || []).find((it) => it.role === 'host_video')?.path ||
      ''
    const voiceCloneItem = (assetsAv.items || []).find((it) => it.role === 'voice_clone')
    const drivingWav = await buildCombinedDryVoiceWav(absDir, scriptForAvatar, signal, onChild)

    const isImgBase = avatarBase && /\.(jpg|jpeg|png|webp|bmp)$/i.test(avatarBase)
    const avResult = await executeGenerateAvatar({
      projectDir: absDir,
      avatarMode: spec.avatarMode || (avatarBase ? 'cloned-human' : 'ai-human'),
      sourceVideoPath: !isImgBase ? avatarBase : '',
      sourceImagePath: isImgBase ? avatarBase : '',
      voiceId,
      voiceSamplePath: spec.voiceSamplePath || voiceCloneItem?.path || '',
      voiceGender: spec.voiceGender || 'neutral',
      narrationText: (scriptForAvatar.scenes || []).map((s) => s.narration).filter(Boolean).join('。'),
      audioPath: drivingWav,
      avatarLayout: spec.avatarLayout || scriptForAvatar.avatarLayout || 'pip-br',
      presetId: spec.avatarPresetId || 'cyber-anchor',
      chromaKeyColor: spec.avatarChromaKeyColor || '',
      fps: Number(scriptForAvatar.fps) || 30,
      allowPlaceholder,
      signal,
      onProgress: (p) => {
        updateTask('t-avatar', {
          status: 'running',
          progress: Math.max(15, Math.min(96, Number(p.progress) || 50)),
          message: p.message || '数字人生成中...',
          log: false,
        })
      },
    })

    updateTask('t-avatar', {
      status: 'completed',
      progress: 100,
      message: avResult?.visualNotice || '透明通道数字人叠层 (yuva420p WebM) 已挂载到视频时间轴',
    })
  }

  // =========================================================================
  // AGENT 4a: 动效质检 Agent — 动效编码 + video_lint + video_snapshot (t-motion)
  // =========================================================================
  if (!isDoneTask(run, 't-motion')) {
    await waitIfPaused('t-motion')
    updateTask('t-motion', {
      status: 'running',
      progress: 15,
      message: `动效质检 Agent 启动：正在生成 ${engine.toUpperCase()} 动效工程与透明数字人叠层...`,
    })
    llmBilling.throwIfTripped()

    const curScript = readScriptJson(absDir).data
    curScript.mediaDims = buildMediaDimsMap(readAssets(absDir), curScript)
    const enableAiCode = spec.aiAuthorCode !== undefined ? Boolean(spec.aiAuthorCode) : mode === 'ai-coded'
    if (enableAiCode && llmSummary.configured) {
      curScript.authoringMode = 'ai-coded'
    }
    // HyperFrames HTML is regenerated as one page: locked scenes keep the <template data-scene-id> blocks captured
    // when they were locked (store written at run start / earlier runs, before any rewrite of index.html)
    let lockedHtmlBlocks = {}
    if (engine === 'html' && getLockedSceneIds(curScript).size > 0) {
      try {
        lockedHtmlBlocks = syncLockedHtmlStore(absDir, curScript)
      } catch {}
    }
    const lockedHtmlBefore = Object.keys(lockedHtmlBlocks).length > 0
    const keepLockedHtmlBlocks = (html) => applyLockedHtmlStore(html, lockedHtmlBlocks)
    syncProjectCodeFromScript(absDir, curScript, { forceOverwrite: true })

    if (mode === 'ai-coded' && llmSummary.configured && enableAiCode) {
      try {
        updateTask('t-motion', {
          status: 'running',
          progress: 35,
          message: `动效质检 Agent 正在分批召唤大模型 (${llmSummary.model}) 手写定制 ${engine === 'remotion' ? 'Remotion TSX' : 'HyperFrames HTML'} 动效模块...`,
        })

        let repairRes = null
        if (engine === 'remotion') {
          const isHeavyNarrative =
            String(curScript.genre || '').toLowerCase() === 'history-theater' ||
            String(curScript.genre || '').toLowerCase() === 'mv-lyric' ||
            curScript.narrationMode === 'subtitle-mv'
          const tsxLlmOverride = spec.llmOverride && typeof spec.llmOverride === 'object' && Object.keys(spec.llmOverride).length > 0 ? spec.llmOverride : null
          repairRes = await authorBatchedRemotionScenes({
            absDir,
            lockedScript: curScript,
            llmConfig: spec.llmOverride || {},
            callLlmChatFn: (p) =>
              callLlmChat({ ...(tsxLlmOverride ? { overrideConfig: resolveLlmConfig(tsxLlmOverride) } : {}), signal, ...p, onRetry: onLlmRetry }),
            batchSize: isHeavyNarrative ? 4 : (curScript.scenes || []).length >= 16 ? 5 : 4,
            concurrency: Math.max(2, hwPolicy.batchCoderConcurrency || 3),
            maxRepairRounds: Math.max(1, Math.min(3, Number(llmSummary.maxRepairRounds) || 2)),
            // 画面自检 (keyframes → multimodal review → one targeted rewrite); on unless the user switched it off
            visualReview: spec.visualReview !== undefined ? spec.visualReview !== false : curScript.visualReview !== false,
            signal,
            onProgress: (_stage, pct, msg) => {
              updateTask('t-motion', {
                status: 'running',
                progress: Math.max(38, Math.min(68, Number(pct) || 55)),
                message: msg || '大模型正在逐镜手写并自检 TSX 代码...',
                log: false,
              })
            },
          })
          const ta = repairRes?.toolAudit
          if (ta?.after?.shots) {
            const fixed = ta.before && ta.before.violating > ta.after.violating ? `，定向返工后缺口 ${ta.before.violating} → ${ta.after.violating} 镜` : ''
            appendLog('motion_qa', `🧰 工具调用核对（实际使用/计划）：${formatToolSummary(ta.after)}${fixed}`)
            if (ta.after.violating > 0) warnUser('motion_qa', `⚠ 仍有 ${ta.after.violating} 个镜头没按计划使用指定工具（返工后仍未达标），这些镜头的人物/特效可能偏简单`)
          }
          if (repairRes?.visualReview) {
            const vr = repairRes.visualReview
            appendLog('motion_qa', `👀 ${summarizeVisualReview(vr)}`)
            if (!vr.skipped && vr.majorScenes > vr.fixedScenes) warnUser('motion_qa', `⚠ 画面自检发现 ${vr.majorScenes - vr.fixedScenes} 个镜头的问题没能返工，建议在成片里重点查看这些镜头`)
          }
          if (repairRes?.lockedSceneIds?.length) {
            appendLog('motion_qa', `人工锁定场景 ${repairRes.lockedSceneIds.join(', ')} 未重新生成 TSX（沿用锁定时的实现）`)
          }
        } else {
          // a custom AI-designed / saved style reaches the HTML coder too (soft guide, deduped by its marker)
          const promptPkg = withStyleGuide(
            buildHtmlCoderSkillsPrompt({
              plan: curScript,
              timingContract: curScript,
              width: curScript.width,
              height: curScript.height,
              aspectRatio: curScript.aspectRatio,
            }),
            curScript,
            { engine: 'html' },
          )
          const aiReply = await callLlmChat({
            system: promptPkg.system,
            messages: [{ role: 'user', content: promptPkg.user }],
            temperature: 0.3,
            maxTokens: 15000,
            signal,
            onRetry: onLlmRetry,
          })
          const parsedFiles = extractJsonFromLlmText(aiReply.text)?.files
          if (parsedFiles && typeof parsedFiles === 'object') {
            repairRes = await runCodeAutoRepairLoop({
              absDir,
              engine,
              systemPrompt: promptPkg.system,
              initialFiles: parsedFiles,
              lockedScript: curScript,
              maxRepairRounds: Math.max(1, Math.min(3, Number(llmSummary.maxRepairRounds) || 2)),
              protectFiles: lockedHtmlBefore
                ? (map) => (typeof map['index.html'] === 'string' ? { ...map, 'index.html': keepLockedHtmlBlocks(map['index.html']).html } : map)
                : undefined,
              signal,
              onProgress: (_stage, pct, msg) => {
                updateTask('t-motion', {
                  status: 'running',
                  progress: Math.max(45, Math.min(68, Number(pct) || 55)),
                  message: msg || 'AI 代码自检与自动修复中...',
                  log: false,
                })
              },
            })
          }
        }

        const hasValidAiCode =
          engine === 'remotion'
            ? Number(repairRes?.authoredBatchCount || 0) > 0
            : Boolean(repairRes?.files?.['index.html'])

        if (repairRes?.ok && hasValidAiCode) {
          curScript.authoringMode = 'ai-coded'
          curScript.aiMeta = {
            ...(curScript.aiMeta || {}),
            model: llmSummary.model,
            protocol: llmSummary.protocol,
            authoredBatchCount: Number(repairRes.authoredBatchCount || 1),
            totalBatches: Number(repairRes.totalBatches || 1),
            isolatedBatches: repairRes.isolatedBatches || [],
            batchErrors: repairRes.batchErrors || [],
            generatedFiles: Object.keys(repairRes.files || {}),
            builtAt: new Date().toISOString(),
          }
          writeScriptJson(absDir, curScript)
          if (engine === 'remotion') {
            try {
              writeFileSync(join(absDir, 'index.html'), buildRichHtmlVideo(curScript), 'utf8')
            } catch {}
          }
          mkdirSync(join(absDir, 'output'), { recursive: true })
          writeFileSync(
            join(absDir, 'output', 'ai_build_log.json'),
            JSON.stringify(
              {
                ok: true,
                engine,
                model: llmSummary.model,
                protocol: llmSummary.protocol,
                authoredBatchCount: Number(repairRes.authoredBatchCount || 0),
                totalBatches: Number(repairRes.totalBatches || 1),
                isolatedBatches: repairRes.isolatedBatches || [],
                batchErrors: repairRes.batchErrors || [],
                repairHistory: repairRes.repairHistory || [],
                generatedFiles: Object.keys(repairRes.files || {}),
                builtAt: new Date().toISOString(),
              },
              null,
              2,
            ) + '\n',
            'utf8',
          )
          appendLog(
            'motion_qa',
            `大模型 (${llmSummary.model}) 定制 TSX 动效代码通过沙箱、Lint 与 tsc 编译质检（成功模块: ${Number(repairRes.authoredBatchCount || 0)}/${Number(repairRes.totalBatches || 1)} 批，修复轮次: ${Math.max(0, (repairRes.repairHistory?.length || 1) - 1)}${repairRes.batchErrors?.length ? `，异常批次: ${repairRes.batchErrors.join('; ')}` : ''}）`,
          )
          const missedBatches = Math.max(0, Number(repairRes.totalBatches || 1) - Number(repairRes.authoredBatchCount || 0))
          if (engine === 'remotion' && (missedBatches > 0 || repairRes.isolatedBatches?.length)) {
            warnUser(
              'motion_qa',
              `⚠ 有 ${Math.max(missedBatches, repairRes.isolatedBatches?.length || 0)} 批镜头的大模型动效代码没能通过检查，这些镜头改用内置版式${repairRes.batchErrors?.length ? `（${String(repairRes.batchErrors[0]).slice(0, 80)}）` : ''}。`,
            )
          }
        } else {
          curScript.authoringMode = 'schema-plan'
          writeScriptJson(absDir, curScript)
          warnUser(
            'motion_qa',
            `⚠ AI 动效代码自动修复后仍未通过质检，整片回退内置模板：${(repairRes?.errors || []).slice(0, 3).join('; ')}`,
          )
          syncProjectCodeFromScript(absDir, readScriptJson(absDir).data, { forceOverwrite: true })
        }
      } catch (err) {
        if (err?.name === 'AbortError' || signal.aborted) throw createAbortError()
        if (isBillingError(err)) throw toBillingError(err, { scope: 'llm', provider: llmSummary.model || '' })
        curScript.authoringMode = 'schema-plan'
        writeScriptJson(absDir, curScript)
        warnUser('motion_qa', `⚠ 大模型动效定制失败，整片回退内置模板：${err.message}`)
        syncProjectCodeFromScript(absDir, readScriptJson(absDir).data, { forceOverwrite: true })
      }
    }
    if (lockedHtmlBefore && existsSync(join(absDir, 'index.html'))) {
      // Final pass covers every path above (AI page, template fallback, forced re-sync)
      try {
        const htmlNow = readFileSync(join(absDir, 'index.html'), 'utf8')
        const kept = keepLockedHtmlBlocks(htmlNow)
        if (kept.html !== htmlNow) writeFileSync(join(absDir, 'index.html'), kept.html, 'utf8')
        if (kept.restored.length > 0) appendLog('motion_qa', `人工锁定场景 ${kept.restored.join(', ')} 保留锁定时的 HTML 实现（未被重新生成覆盖）`)
        if (kept.missing.length > 0) appendLog('motion_qa', `新页面缺少锁定场景 ${kept.missing.join(', ')} 的场景块，无法自动保留`, 'warn')
      } catch {}
    }

    if (signal.aborted) throw createAbortError()
    await waitIfPaused('t-motion')
    updateTask('t-motion', {
      status: 'running',
      progress: 70,
      message: '正在执行 video_lint 合规检测与九宫格视觉快照预检...',
    })
    const lintRes = await executeVideoLint({ projectDir: absDir })
    // executeVideoLint reports `ok` + `errors` / `warnings` (there is no `passed` field)
    const lintErrors = Array.isArray(lintRes?.errors) ? lintRes.errors : []
    const lintWarnings = Array.isArray(lintRes?.warnings) ? lintRes.warnings : []
    if (lintErrors.length > 0 || lintWarnings.length > 0) {
      appendLog('motion_qa', `video_lint：${[...lintErrors, ...lintWarnings].slice(0, 3).join('；')}`, 'warn')
    }
    const lintLabel = lintErrors.length > 0 || lintRes?.ok === false ? '有问题' : lintWarnings.length > 0 ? '带警告' : '通过'
    let snapRes = null
    try {
      snapRes = await executeVideoSnapshot({ projectDir: absDir })
    } catch (err) {
      if (err?.name === 'AbortError' || signal.aborted) throw createAbortError()
      appendLog('motion_qa', `九宫格预检跳过: ${err.message}`, 'warn')
    }
    stageSnap('motion', 'after')
    updateTask('t-motion', {
      status: 'completed',
      progress: 100,
      message: `动效质检完成：Lint ${lintLabel} · 九宫格快照${snapRes?.ok ? '已生成' : '略过'}`,
    })
  }

  // =========================================================================
  // AGENT 4b: 高清 MP4 渲染交付 (t-render)
  // =========================================================================
  let finalRender = null
  if (!isDoneTask(run, 't-render')) {
    await waitIfPaused('t-render')
    updateTask('t-render', {
      status: 'running',
      progress: 8,
      message: `正在启动 ${engine.toUpperCase()} 全帧率高清渲染与自动音画质检...`,
    })

    finalRender = await executeVideoRender({
      projectDir: absDir,
      engine,
      signal,
      onProgress: (p) => {
        const rawPct = p && typeof p === 'object' ? (p.progress ?? p.pct) : undefined
        updateTask('t-render', {
          status: 'running',
          progress: Math.max(8, Math.min(97, Number(rawPct) || 50)),
          message: p?.message || '全帧率编码渲染中...',
          log: false,
        })
      },
    })

    // shots designed too dark to read were lifted (black / white unchanged): say how many and how much
    const expg = finalRender?.exposureGuard
    if (expg?.applied) {
      const lo = expg.fullRange ? 0 : 16
      const span = expg.fullRange ? 255 : 219
      const pct = (y) => (Number.isFinite(Number(y)) ? `${Math.round(((Number(y) - lo) / span) * 100)}%` : '?')
      appendLog('motion_qa', `🔆 画面亮度保护：${(expg.lifted || []).length} 个过暗镜头已提亮（全片平均亮度 ${pct(expg.before?.meanY)} → ${pct(expg.after?.meanY)}，黑场与高光不变）`)
    } else if (expg?.reason === 'error' && (expg.lifted || []).length) {
      warnUser('motion_qa', `⚠ ${(expg.lifted || []).length} 个镜头画面偏暗，自动提亮未完成：${String(expg.error || '').slice(0, 140)}`)
    }
    const amb = finalRender?.ambience
    if (amb?.kinds?.length) appendLog('motion_qa', `🌬 环境声底：${amb.kinds.map((k) => AMBIENCE_LABELS_ZH[k] || k).join('、')}（覆盖 ${Math.round(amb.coverageSec || 0)} 秒，随镜头切换交叉淡入淡出）`)

    // AAC encoding overshoots the limited master: say so when the delivered audio was trimmed under −1 dBTP
    const tpg = finalRender?.truePeakGuard
    if (tpg?.applied && Number.isFinite(tpg.before?.truePeakDbtp) && Number.isFinite(tpg.after?.truePeakDbtp)) {
      appendLog('motion_qa', `🎚 成片音频峰值保护：编码后真峰值 ${tpg.before.truePeakDbtp.toFixed(1)} dBTP → ${tpg.after.truePeakDbtp.toFixed(1)} dBTP（整体音量 ${tpg.gainDb} dB），避免平台转码削波`)
    } else if (tpg?.reason === 'error') {
      appendLog('motion_qa', `ℹ 成片音频峰值保护未执行：${String(tpg.error || '').slice(0, 160)}`)
    }

    // the automatic QA after the render: every failed check is a warning the user sees, never a silent "completed"
    const qaRep = finalRender?.qaReport || finalRender?.qa || null
    const qaFailed = qaRep && qaRep.passed === false ? (Array.isArray(qaRep.checks) ? qaRep.checks : []).filter((c) => c && c.passed === false) : []
    for (const c of qaFailed.slice(0, 4)) {
      warnUser('motion_qa', `⚠ 成片质检未通过：${c.name || c.id || '未命名检查'}${c.value ? ` — ${String(c.value).slice(0, 180)}` : ''}`)
    }
    if (qaRep && qaRep.passed === false && qaFailed.length === 0) warnUser('motion_qa', '⚠ 成片质检未通过（详见 output/qa_report.json）')
    // checks that passed at the limit (severity "warning", e.g. flashes at exactly 3/s) are shown as hints, not failures
    const qaHints = qaRep ? (Array.isArray(qaRep.checks) ? qaRep.checks : []).filter((c) => c && c.passed !== false && c.severity === 'warning') : []
    for (const c of qaHints.slice(0, 4)) {
      appendLog('motion_qa', `ℹ 质检提示（未超标）：${c.name || c.id || '未命名检查'}${c.value ? ` — ${String(c.value).slice(0, 180)}` : ''}`)
    }
    updateTask('t-render', {
      status: 'completed',
      progress: 100,
      message: `成品导出成功：${finalRender.resolution} · ${finalRender.durationSec}s (${Math.round((finalRender.fileSizeBytes || 0) / 1024)} KB)${qaRep ? (qaRep.passed === false ? ` · ⚠ 质检 ${Math.max(1, qaFailed.length)} 项未通过` : qaHints.length ? ` · 质检通过（${qaHints.length} 项提示）` : ' · 质检通过') : ''}`,
    })
  }

  const qaFinal = finalRender?.qaReport || finalRender?.qa || null
  return {
    ok: true,
    projectDir: absDir,
    engine,
    mode,
    outputPath: finalRender?.outputPath || join(absDir, 'output', 'final.mp4'),
    snapshotPath: finalRender?.snapshotPath || join(absDir, 'output', 'snapshot-3x3.png'),
    qa: qaFinal,
    qaPassed: qaFinal ? qaFinal.passed !== false : null,
    warnings: runWarnings,
  }
}

/**
 * Billing errors (HTTP 402 / insufficient balance / quota / 欠费 ...) from cloud media, LLM or TTS stop the
 * whole run immediately with a clear Chinese message, are never retried automatically, and the Task Center
 * run is marked as a billing stop (`run.errorKind = 'billing'`, `run.billingStop`).
 * Exported for any Task Center runner (and tests): `runWithBillingGuard(runner, run, helpers)`.
 */
export async function runWithBillingGuard(runner, run, helpers) {
  delete run.errorKind
  delete run.billingStop
  try {
    return await runner(run, helpers)
  } catch (err) {
    if (err?.name !== 'AbortError' && !helpers?.signal?.aborted && isBillingError(err)) {
      const billingErr = toBillingError(err, { scope: err?.scope || 'cloud', provider: err?.provider || '' })
      run.errorKind = 'billing'
      run.billingStop = {
        at: new Date().toISOString(),
        scope: billingErr.scope,
        provider: billingErr.provider,
        status: billingErr.status,
        providerCode: billingErr.providerCode,
        ledgerJobId: billingErr.ledgerJobId || '',
        retryable: false,
        message: billingErr.message,
      }
      const activeTask = (run.tasks || []).find((t) => t.status === 'running' || t.status === 'paused')
      if (activeTask) helpers.updateTask(activeTask.id, { status: 'failed', message: billingErr.message, error: billingErr.message })
      helpers.appendLog(activeTask?.stage || run.activeStage || 'director', `⛔ ${billingErr.message}`, 'error')
      throw billingErr
    }
    throw err
  }
}

function executeMultiAgentRunnerGuarded(run, helpers) {
  return runWithBillingGuard(executeMultiAgentRunner, run, helpers)
}

// Register default runner factory so historical persisted runs remain retryable across daemon restarts
taskManager.setDefaultRunnerFactory(() => executeMultiAgentRunnerGuarded)

/**
 * Start a 4-Agent pipeline in the background (returns immediately with runId + initial status).
 */
function createNormalizedPipelineRun(spec = {}) {
  if (!spec.projectDir) throw new Error('projectDir is required')
  const { modeLabel, mode } = resolvePipelineMode(spec.mode)
  const briefView = splitDirectorBrief(spec)
  return taskManager.createRun({
    projectDir: spec.projectDir,
    title: `${modeLabel} · ${briefView.displayTitle || '视觉作品'}`,
    topic: briefView.topic || '',
    mode,
    spec,
  })
}

export async function startPipelineBackground(spec = {}) {
  const run = createNormalizedPipelineRun(spec)
  const started = await taskManager.startRun(run.id, executeMultiAgentRunnerGuarded)
  started.promise.catch(() => {})
  return started.run
}

/**
 * Synchronous pipeline entrypoint for MCP/Cordis tool call `run_agent_pipeline`.
 */
export async function runMultiAgentPipeline(spec = {}) {
  const run = createNormalizedPipelineRun(spec)
  const started = await taskManager.startRun(run.id, executeMultiAgentRunnerGuarded)
  const completed = await started.promise
  const summary = completed?.resultSummary || {}
  return {
    ...completed,
    ok: completed?.status === 'completed' && summary?.ok !== false,
    outputPath: summary?.outputPath || null,
    snapshotPath: summary?.snapshotPath || null,
    qa: summary?.qa || null,
  }
}
