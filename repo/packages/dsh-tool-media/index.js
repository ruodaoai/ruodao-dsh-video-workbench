/**
 * @dsh-video/tool-media
 * Cordis plugin registering user asset management, procedural SFX/BGM synthesis,
 * multi-track audio mixing, AI storyboard planning, and one-click full video production.
 */
import { join, resolve } from 'node:path'
import { readScriptJson, writeScriptJson } from '../shared/index.js'
import { executeGenerateSpeech, getActiveTtsEngineId } from '../dsh-tool-local-tts/index.js'
import {
  importAssets,
  readAssets,
  removeAsset,
  saveUploadedAsset,
  summarizeAssets,
  updateAsset,
} from './asset-manager.js'
import {
  analyzeAudioBeatStructure,
  choreographBeatSfxCues,
  ensureProjectAudioAssets,
  generateBgmWav,
  generateSfxWav,
  mixVideoAudio,
  quantizeScenesToBeatGrid,
} from './audio-synth.js'
import {
  planVideoFromAssets,
  syncProjectCodeFromScript,
} from './ai-director.js'
import { buildRichHtmlVideo } from './html-generator.js'
import { syncRemotionPublicAssets, writeRemotionProjectFiles } from './remotion-generator.js'
import {
  WIRE_PROTOCOLS,
  discoverDshClientConfig,
  getSafeLlmConfigSummary,
  saveLlmConfig,
  testLlmConnection,
  fetchAvailableModels,
  callLlmChat,
} from './llm-client.js'
import {
  masterVoiceTracks,
  probeVoiceAcousticTelemetry,
} from './voice-master.js'
import {
  authorBatchedRemotionScenes,
  getAiCodingHistory,
  refineAiScene,
  rollbackAiVersion,
  runAiStudioPipeline,
} from './ai-coder.js'
import { executeCurateAndEditAssets } from './media-editor.js'
import { generateAiCodedSfxCues } from './audio-coder.js'
import { runMultiAgentPipeline, startPipelineBackground } from './pipeline-orchestrator.js'
import { taskManager } from './task-manager.js'
import {
  generateAiCodedBgmTrack,
  synthesizeTtsEngineAudioCue,
} from './audio-coder.js'
import {
  normalizeTransitionKind,
  PROMO_SHOT_RECIPES,
  runSchemaDirectorWithDegradation,
  VALID_TRANSITIONS,
} from './plan-schema.js'
import { buildMediaDimsMap, groundVisualAssets, loadSidecarAnchors } from './vision-grounding.js'
import { exportPublishPack } from './publish-pack.js'
import { registerVendorClip, renderVendorClipIsolated } from './vendor-clip.js'
import {
  analyzeReferenceVideo,
  buildMotionMarkdown,
  exportProjectMotionMd,
  loadBrandKit,
  saveBrandKit,
} from './reference-analyzer.js'
import {
  assistCloudMediaPrompt,
  CLOUD_MEDIA_PRESETS,
  commitStagedCloudAsset,
  discardStagedCloudAsset,
  generateCloudMediaAsset,
  getCloudMediaConfigSummary,
  listStagedCloudAssets,
  loadCloudMediaConfig,
  saveCloudMediaConfig,
} from './cloud-media.js'
import {
  applyPlazaTemplateToProject,
  getPlazaTemplate,
  listPlazaTemplates,
  PLAZA_BRAND,
  PLAZA_CATEGORIES,
  publishProjectToPlaza,
} from './template-plaza.js'
import { buildPlazaSubmission, listPlazaSubmissions, previewPlazaSubmission, syncOnlinePlazaTemplates } from './plaza-community.js'
import { listCloudJobs, resolveMediaSourcingPlan } from './cloud-media.js'
import { restoreAiProjectVersion } from './ai-coder.js'
import { createProjectSnapshot, diffProjectVersions, listProjectVersions, pruneProjectHistory } from './project-history.js'
import { listSceneEdits, setSceneLock, setSceneOverrides } from './scene-locks.js'
import { attachCharacter, deleteCharacter, listCharacters, saveCharacter } from './character-bank.js'
import { importStockMedia, searchStockMedia } from './stock-media.js'
import { prepareProjectStyleForRun } from './style-presets.js'

export {
  analyzeAudioBeatStructure,
  analyzeReferenceVideo,
  buildMotionMarkdown,
  exportProjectMotionMd,
  loadBrandKit,
  saveBrandKit,
  choreographBeatSfxCues,
  quantizeScenesToBeatGrid,
  importAssets,
  readAssets,
  removeAsset,
  saveUploadedAsset,
  summarizeAssets,
  updateAsset,
  ensureProjectAudioAssets,
  generateBgmWav,
  generateSfxWav,
  mixVideoAudio,
  generateAiCodedBgmTrack,
  synthesizeTtsEngineAudioCue,
  PROMO_SHOT_RECIPES,
  VALID_TRANSITIONS,
  normalizeTransitionKind,
  runSchemaDirectorWithDegradation,
  groundVisualAssets,
  loadSidecarAnchors,
  buildMediaDimsMap,
  exportPublishPack,
  registerVendorClip,
  renderVendorClipIsolated,
  masterVoiceTracks,
  probeVoiceAcousticTelemetry,
  planVideoFromAssets,
  syncProjectCodeFromScript,
  buildRichHtmlVideo,
  syncRemotionPublicAssets,
  writeRemotionProjectFiles,
  WIRE_PROTOCOLS,
  discoverDshClientConfig,
  getSafeLlmConfigSummary,
  saveLlmConfig,
  testLlmConnection,
  fetchAvailableModels,
  callLlmChat,
  authorBatchedRemotionScenes,
  runAiStudioPipeline,
  refineAiScene,
  rollbackAiVersion,
  getAiCodingHistory,
}

/**
 * One-click full production pipeline:
 * 1. Import user sources (images/videos/music/sfx/notes)
 * 2. AI plan storyboard, copy, VFX, camera motion, SFX cues & BGM
 * 3. Synthesize REAL human voice narration per scene (IndexTTS-2) + ffprobe duration backfill
 * 4. Generate HTML5 & Remotion code + lint
 * 5. Multi-track audio mix + full-FPS dual-engine MP4 render + 3x3 snapshot
 */
export async function produceFullVideo(options = {}) {
  const {
    projectDir,
    sources,
    title,
    topic,
    style,
    engine = 'html',
    aspectRatio = 'auto',
    quality = '1080p',
    width,
    height,
    aiBadge = true,
    targetPlatform = 'universal',
    bgmMode = 'auto',
    voiceId = 'auto',
    ttsEngine,
    allowPlaceholder = false,
    fps,
    renderWidth,
    renderHeight,
    scenesSpec,
    workflowSteps,
    brandMark,
    curateAssets = false,
    masterVoice = true,
    useLlmMastering = false,
    onProgress,
  } = options

  if (!projectDir) throw new Error('projectDir is required')
  const absDir = resolve(projectDir)

  if (curateAssets) {
    onProgress?.('0/5 正在智能筛选与无损分辨率适配素材...')
    if (sources && (Array.isArray(sources) ? sources.length > 0 : true)) {
      await importAssets({ projectDir: absDir, sources })
    }
    await executeCurateAndEditAssets({ projectDir: absDir, style, quality, aspectRatio })
  }

  onProgress?.('1/5 正在导入并分析素材（本地草稿快速生成）...')
  const planned = await planVideoFromAssets({
    projectDir: absDir,
    sources: curateAssets ? undefined : sources,
    title,
    topic,
    style,
    engine,
    aspectRatio,
    quality,
    width,
    height,
    aiBadge,
    voiceId,
    scenesSpec,
    workflowSteps,
    brandMark,
    ...(fps ? { fps: Number(fps) } : {}),
  })

  onProgress?.('2/5 正在启动本地配音引擎并逐幕生成真人配音...')
  let curScript = planned.script
  for (let i = 0; i < (curScript.scenes || []).length; i++) {
    const s = curScript.scenes[i]
    onProgress?.(`2/5 正在配音 (${i + 1}/${curScript.scenes.length}): ${s.title}`)
    await executeGenerateSpeech({
      text: s.narration,
      emotion: s.emotion || '平静',
      voiceId: s.voiceId || voiceId || 'auto',
      engine: ttsEngine || getActiveTtsEngineId(),
      speed: Number(s.speechRate) || 1.0,
      fps: curScript.fps || 30,
      outputPath: join(absDir, 'audio', `${s.id}.wav`),
      scriptPath: absDir,
      sceneId: s.id,
      allowPlaceholder,
    })
  }

  if (masterVoice && !allowPlaceholder) {
    try {
      onProgress?.('2.5/5 正在进行 AI 人声声学探测与广播级修音...')
      await masterVoiceTracks({
        projectDir: absDir,
        useLlm: Boolean(useLlmMastering),
        remixMasterAudio: false,
      })
    } catch {}
  }

  curScript = readScriptJson(absDir).data
  curScript.targetPlatform = targetPlatform || curScript.targetPlatform || 'universal'
  if (bgmMode && bgmMode !== 'auto') {
    curScript.bgmMode = bgmMode
    curScript.audioSpec = { ...(curScript.audioSpec || {}), bgmMode }
  }
  curScript = writeScriptJson(absDir, curScript).data
  onProgress?.('3/5 正在生成双引擎画面工程（商用字体/安全区/动效/字幕）...')
  syncProjectCodeFromScript(absDir, curScript)

  const { executeVideoLint, executeVideoRender } = await import('../dsh-tool-video-suite/index.js')
  const lint = await executeVideoLint({ projectDir: absDir, engine })
  if (!lint.ok) {
    throw new Error(`video_lint failed before render: ${lint.errors.join('; ')}`)
  }

  onProgress?.('4/5 正在混音（人声 + 音效 + 自动闪避配乐）并逐帧渲染 MP4...')
  const rendered = await executeVideoRender({
    projectDir: absDir,
    engine,
    renderWidth,
    renderHeight,
    onProgress: ({ frame, totalFrames, pct }) =>
      onProgress?.(`4/5 正在逐帧合成高清视频 (${frame}/${totalFrames} 帧 · ${pct}%)...`),
  })

  onProgress?.('5/5 制作完成！')
  return {
    ok: true,
    projectDir: absDir,
    engine,
    script: readScriptJson(absDir).data,
    assetsSummary: summarizeAssets(readAssets(absDir)),
    lint,
    render: rendered,
  }
}

export const name = 'dsh-tool-media'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({
    name: 'import_assets',
    description:
      'Import user media files or folders (images, videos, background music, sound effects, and text notes) into a video project and measure each file via ffprobe.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of local file or folder paths containing user assets.',
        },
      },
      required: ['projectDir', 'sources'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 120_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await importAssets(args)
    },
  })

  ctx.tools.register({
    name: 'list_assets',
    description: 'List all imported images, videos, music, sound effects, and notes in a video project.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 15_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const m = readAssets(args.projectDir)
      return { ok: true, summary: summarizeAssets(m), ...m }
    },
  })

  ctx.tools.register({
    name: 'generate_sfx_bgm',
    description:
      'Generate studio-grade sound effects (whoosh, impact, pop, chime, riser) and mood-matched background music WAVs, and mix them with voice narration into master-audio.wav.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        mood: {
          type: 'string',
          enum: ['tech', 'cinematic', 'warm', 'energetic', 'emerald'],
          description: 'Music mood when generating BGM.',
        },
        mixMaster: { type: 'boolean', description: 'If true, mix voice + SFX + BGM into output/master-audio.wav.' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 120_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const { data: script } = readScriptJson(args.projectDir)
      if (args.mood) {
        script.bgm = { ...(script.bgm || {}), mood: args.mood }
      }
      const assets = readAssets(args.projectDir)
      const audioAssets = await ensureProjectAudioAssets(args.projectDir, script, assets)
      if (args.mixMaster) {
        const mix = await mixVideoAudio({ projectDir: args.projectDir, script, assetsManifest: assets })
        return { ok: true, ...audioAssets, mix }
      }
      return { ok: true, ...audioAssets }
    },
  })

  ctx.tools.register({
    name: 'plan_video_from_assets',
    description:
      'Analyze imported project assets and user topic/style to generate a complete storyboard (script.json) with copy, camera motion, VFX, SFX cues, BGM, and HTML/Remotion scene code.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        sources: { type: 'array', items: { type: 'string' }, description: 'Optional paths to import first.' },
        title: { type: 'string', description: 'Video title.' },
        topic: { type: 'string', description: 'Creative brief or topic.' },
        style: {
          type: 'string',
          pattern: '^(auto|tech|cinematic|documentary|energetic|warm|emerald|user:[A-Za-z0-9_-]{1,40})$',
          description: "Visual style: 'auto' = AI 自由匹配 (the AI picks the best of the 6 presets for the topic, or designs a new style when none fits; local drafts pick a preset by keyword rules), one of the presets tech (科技锋芒) / cinematic (电影大片) / documentary (极简纪实) / energetic (活力潮牌) / warm (温暖故事) / emerald (墨翠轻奢), or 'user:<id>' for a saved 我的风格预设. Omit to keep the project's current style (new projects: auto).",
        },
        engine: { type: 'string', enum: ['html', 'remotion'], description: 'Target render engine.' },
        aspectRatio: { type: 'string', enum: ['auto', '16:9', '9:16', '3:4', '1:1', '4:3', 'custom'], description: 'Aspect ratio preset or auto AI selection.' },
        quality: { type: 'string', enum: ['720p', '1080p', '2k', '4k', 'custom'], description: 'Output resolution tier.' },
        width: { type: 'number', description: 'Optional custom width (even integer >= 320).' },
        height: { type: 'number', description: 'Optional custom height (even integer >= 320).' },
        aiBadge: { type: 'boolean', description: 'Whether to show an optional AI badge corner watermark.' },
        fps: { type: 'number', description: 'Target frame rate (e.g. 30 or 60).' },
        voiceId: { type: 'string', description: 'Voice ID or "auto" for AI voice matching.' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 120_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await planVideoFromAssets(args)
    },
  })

  ctx.tools.register({
    name: 'produce_video',
    description:
      'Local Draft one-click production: import assets -> storyboard -> local IndexTTS-2 narration -> HTML/Remotion code -> SFX/BGM ducked mix -> MP4.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        sources: { type: 'array', items: { type: 'string' }, description: 'Optional local media folders or files to import.' },
        title: { type: 'string', description: 'Video title.' },
        topic: { type: 'string', description: 'Topic / prompt.' },
        style: { type: 'string', pattern: '^(auto|tech|cinematic|documentary|energetic|warm|emerald|user:[A-Za-z0-9_-]{1,40})$', description: "Visual style: 'auto' = AI 自由匹配 (the AI picks the best of the 6 presets for the topic, or designs a new style when none fits; local drafts pick a preset by keyword rules), one of the presets tech (科技锋芒) / cinematic (电影大片) / documentary (极简纪实) / energetic (活力潮牌) / warm (温暖故事) / emerald (墨翠轻奢), or 'user:<id>' for a saved 我的风格预设. Omit to keep the project's current style (new projects: auto)." },
        engine: { type: 'string', enum: ['html', 'remotion'] },
        aspectRatio: { type: 'string', enum: ['auto', '16:9', '9:16', '3:4', '1:1', '4:3', 'custom'] },
        quality: { type: 'string', enum: ['720p', '1080p', '2k', '4k', 'custom'] },
        width: { type: 'number', description: 'Optional custom width.' },
        height: { type: 'number', description: 'Optional custom height.' },
        aiBadge: { type: 'boolean', description: 'Optional corner AI badge.' },
        fps: { type: 'number', description: 'Target frame rate (e.g. 30 or 60).' },
        voiceId: { type: 'string', description: 'Voice ID or "auto".' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 600_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await produceFullVideo(args)
    },
  })

  ctx.tools.register({
    name: 'get_llm_config',
    description:
      'Inspect the LLM the plugin uses: mode (auto = follow the host agent / follow-dsh / custom), the detected host agent, where the model came from (DSH channel, the host agent\'s environment API key such as ANTHROPIC_API_KEY / OPENAI_API_KEY, or custom fields), masked key status, baseUrl, model and protocol.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 10_000,
    isConcurrencySafe: () => true,
    async execute() {
      return getSafeLlmConfigSummary()
    },
  })

  ctx.tools.register({
    name: 'configure_llm_model',
    description:
      'Configure the LLM the plugin uses. Default `mode: "auto"` follows the agent hosting the plugin: inside DeepSeek Harness the active DSH channel; inside Claude Code / Codex / opencode / OpenClaw / Hermes / pi / WorkBuddy / Antigravity / Cursor … the model API key found in that agent\'s environment (ANTHROPIC_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, with *_BASE_URL / *_MODEL); agent logins / subscriptions are never reused. `mode: "follow-dsh"` pins a DSH channel; `mode: "custom"` uses your own endpoint across all 4 wire protocols (`openai-completions`, `anthropic-messages`, `openai-responses`, `gemini-native`).',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['auto', 'follow-dsh', 'custom'],
          description: 'auto (default) follows the host agent (DSH channel inside DSH, the agent environment API key elsewhere); follow-dsh pins a DSH channel; custom uses the plugin fields below.',
        },
        dshProviderId: { type: 'string', description: 'Optional specific DSH provider ID from cordis.patch.yml (or "active" to track DSH active selection).' },
        provider: { type: 'string', description: 'Preset template ID (custom, anthropic, openai, gemini, deepseek, openrouter, ollama).' },
        format: {
          type: 'string',
          enum: ['auto', 'openai-completions', 'anthropic-messages', 'openai-responses', 'gemini-native', 'openai', 'anthropic'],
          description: 'API wire protocol format.',
        },
        baseUrl: { type: 'string', description: 'LLM API Base URL.' },
        apiKey: { type: 'string', description: 'API Key (never logged or returned).' },
        model: { type: 'string', description: 'Target model ID string (e.g. claude-opus-5-5, gpt-6.1-sol, gemini-2.5-pro).' },
        maxRepairRounds: { type: 'number', description: 'Max compiler/lint self-repair attempts (1-5).' },
        runTest: { type: 'boolean', description: 'If true, also test endpoint connectivity.' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 30_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const saved = saveLlmConfig(args)
      if (args.runTest) {
        const test = await testLlmConnection(args)
        return { ...saved, test }
      }
      return saved
    },
  })

  ctx.tools.register({
    name: 'ai_master_voice',
    description:
      'Probe acoustic telemetry (LUFS loudness, true peak, crest, silence) on post-TTS scene vocals and use the configured AI LLM (or adaptive studio fallback) + FFmpeg DSP to master every voice track into `audio/mastered/<scene>.wav` and re-mix `output/master-audio.wav`.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        sceneIds: { type: 'array', items: { type: 'string' }, description: 'Optional subset of scene IDs to master (defaults to all scenes with WAVs).' },
        useLlm: { type: 'boolean', description: 'Consult configured AI LLM for acoustic mastering EQ/compression/reverb specs (default true).' },
        remixMasterAudio: { type: 'boolean', description: 'Re-mix mastered vocals + SFX + ducked BGM into output/master-audio.wav (default true).' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 180_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const report = await masterVoiceTracks({
        projectDir: args.projectDir,
        sceneIds: args.sceneIds,
        useLlm: args.useLlm !== false,
      })
      if (args.remixMasterAudio !== false) {
        const assets = readAssets(args.projectDir)
        await mixVideoAudio({ projectDir: args.projectDir, script: report.script, assetsManifest: assets })
        syncRemotionPublicAssets(args.projectDir, report.script)
      }
      return report
    },
  })

  ctx.tools.register({
    name: 'ai_create_video',
    description:
      'Use the configured LLM coding model + local IndexTTS-2.5 voices + AI post-TTS voice mastering to author bespoke Remotion TSX or HyperFrames HTML code, custom DSP BGM/SFX, run TypeScript & lint auto-repair (up to 3 rounds), and render + QA the final MP4.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        sources: { type: 'array', items: { type: 'string' }, description: 'Optional local asset folders or files.' },
        topic: { type: 'string', description: 'Creative brief or video topic.' },
        userPrompt: { type: 'string', description: 'Detailed visual, pacing, or aesthetic instructions for the AI director/coder.' },
        engine: { type: 'string', enum: ['remotion', 'html'], description: 'Output engine (remotion strongly recommended for AI coding).' },
        creationMode: { type: 'string', enum: ['ai-coded', 'schema-plan'], description: 'ai-coded for max creative ceiling or schema-plan for 4-tier degradation reliability.' },
        bgmMode: { type: 'string', enum: ['llm-coded', 'uploaded', 'tts-engine'], description: 'BGM synthesis mode: llm-coded (LLM writes JS DSP synth code), uploaded (user track), or tts-engine (IndexTTS-2.5 atmospheric).' },
        narrationMode: { type: 'string', enum: ['tts', 'tts-beat-sync', 'subtitle-mv'], description: 'Narration rhythm mode: tts (standard spoken narration), tts-beat-sync (spoken TTS + cut snapped to BGM downbeats), or subtitle-mv (pure beat-locked music/animation with bold subtitles & SFX, no voiceover).' },
        targetDurationSec: { type: 'number', description: 'Optional target total duration in seconds when generating a beat-synced MV.' },
        targetPlatform: { type: 'string', enum: ['universal', 'douyin', 'kuaishou', 'xiaohongshu', 'bilibili'], description: 'Target publishing platform safe zone preset.' },
        aspectRatio: { type: 'string', enum: ['auto', '16:9', '9:16', '3:4', '1:1', '4:3', 'custom'], description: 'auto lets AI select from topic/assets; or specify exact ratio.' },
        style: { type: 'string', pattern: '^(auto|tech|cinematic|documentary|energetic|warm|emerald|user:[A-Za-z0-9_-]{1,40})$', description: "Visual style: 'auto' = AI 自由匹配 (the AI picks the best of the 6 presets for the topic, or designs a new style when none fits; local drafts pick a preset by keyword rules), one of the presets tech (科技锋芒) / cinematic (电影大片) / documentary (极简纪实) / energetic (活力潮牌) / warm (温暖故事) / emerald (墨翠轻奢), or 'user:<id>' for a saved 我的风格预设. Omit to keep the project's current style (new projects: auto)." },
        quality: { type: 'string', enum: ['720p', '1080p', '2k', '4k', 'custom'], description: 'Output quality preset.' },
        width: { type: 'number', description: 'Custom pixel width.' },
        height: { type: 'number', description: 'Custom pixel height.' },
        voiceId: { type: 'string', description: 'Voice ID or "auto".' },
        aiBadge: { type: 'boolean', description: 'Show optional AI corner attribution badge.' },
        aiBadgeEnabled: { type: 'boolean', description: 'Explicit toggle to enable/disable AI attribution corner badge.' },
        aiBadgePosition: { type: 'string', enum: ['top-right', 'top-left', 'bottom-right', 'bottom-left'], description: 'Corner placement for the AI attribution badge.' },
        aiBadgeText: { type: 'string', description: 'Custom text inside the AI attribution badge.' },
        pacingMode: { type: 'string', enum: ['auto', 'calm', 'balanced', 'dynamic'], description: 'Narrative pacing preset: auto (smart topic fit), calm, balanced, or dynamic.' },
        useDraftReference: { type: 'boolean', description: 'Read existing local draft script/WAVs as pacing baseline.' },
        render: { type: 'boolean', description: 'Whether to immediately render MP4 and run FFmpeg QA.' },
        figureStyle: { type: 'string', enum: ['auto', 'silhouette', 'papercut', 'puppet', 'ink', 'flat', 'stick', 'custom'], description: "人物画风 for people and animals in the film: 'auto' (default) lets the AI choose per film (history films default to silhouette); silhouette / papercut / puppet / ink / flat / stick use the built-in side-view figure library in that look; 'custom' makes the AI design its own characters in the look named by figureStyleNote (e.g. Q版萌系, 日系动漫, 绘本手绘). Beats style words in the brief. Omit to keep the project's saved choice." },
        figureStyleNote: { type: 'string', maxLength: 40, description: "With figureStyle 'custom': the character look in a few words (e.g. Q版萌系，圆脸大眼)." },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 600_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await runAiStudioPipeline(args)
    },
  })

  ctx.tools.register({
    name: 'ai_refine_scene',
    description:
      'Apply a natural-language modification request to an AI-coded scene or rollback to the previous snapshot. 指哪改哪: optional timeRange {startSec,endSec} (final timeline) and/or region {x,y,w,h} (normalised 0-1) confine the change to the affected scenes\' local frame window and screen area; only the affected batch/scene files may change. Locked scenes are refused/skipped. Snapshots before/after and returns the version diff.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        sceneId: { type: 'string', description: 'Target scene ID (or omit for global polish).' },
        sceneIds: { type: 'array', items: { type: 'string' }, description: 'Optional multiple target scene IDs.' },
        instruction: { type: 'string', description: 'Natural language editing request.' },
        timeRange: {
          type: 'object',
          description: 'Optional global time range on the final timeline (seconds); mapped to affected scenes and their local frame ranges.',
          properties: { startSec: { type: 'number' }, endSec: { type: 'number' } },
          required: ['startSec', 'endSec'],
          additionalProperties: false,
        },
        region: {
          type: 'object',
          description: 'Optional normalised screen region (0-1): only elements inside it may change.',
          properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
          required: ['x', 'y', 'w', 'h'],
          additionalProperties: false,
        },
        rollback: { type: 'boolean', description: 'If true, restore the previous saved snapshot instead of editing.' },
        dryRun: { type: 'boolean', description: 'Only map timeRange/region to affected scenes, local frame ranges and editable files (no LLM call, no changes).' },
        render: { type: 'boolean', description: 'Re-render MP4 after passing code validation.' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 600_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      if (args.rollback) return rollbackAiVersion(args.projectDir)
      // dryRun is handled inside refineAiScene (mapping preview only: no LLM call, nothing written)
      return await refineAiScene(args)
    },
  })

  ctx.tools.register({
    name: 'manage_project_history',
    description:
      'Project version history (content-addressed snapshots of script.json, assets.json, characters.json and src/**; large media only referenced by path + size + mtime). Actions: list versions, diff two versions (changed scenes + fields, changed files; toVersionId defaults to the working tree), restore a version (takes a "before restore" snapshot first), snapshot (manual), prune to DSH_HISTORY_MAX (default 50) with garbage collection of unreferenced objects.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'diff', 'restore', 'snapshot', 'prune'], description: 'History operation.' },
        projectDir: { type: 'string', description: 'Video project directory.' },
        versionId: { type: 'string', description: 'Version to restore (restore) or the "from" version (diff).' },
        fromVersionId: { type: 'string', description: 'Diff: older version id.' },
        toVersionId: { type: 'string', description: 'Diff: newer version id, or "current" for the working tree (default).' },
        label: { type: 'string', description: 'Snapshot label (snapshot).' },
        limit: { type: 'number', description: 'Max versions to list (default 100).' },
        max: { type: 'number', description: 'Retention cap for prune (default DSH_HISTORY_MAX or 50).' },
      },
      required: ['action', 'projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 60_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const absDir = resolve(args.projectDir)
      if (args.action === 'diff') return diffProjectVersions(absDir, args.fromVersionId || args.versionId, args.toVersionId || 'current')
      if (args.action === 'restore') {
        if (!args.versionId) throw new Error('restore 需要 versionId')
        const { script, ...res } = restoreAiProjectVersion(absDir, args.versionId)
        return { ...res, sceneCount: Array.isArray(script?.scenes) ? script.scenes.length : 0 }
      }
      if (args.action === 'snapshot') {
        return { ok: true, version: createProjectSnapshot(absDir, { label: args.label || 'manual', stage: 'manual', author: 'user', kind: 'manual' }) }
      }
      if (args.action === 'prune') return pruneProjectHistory(absDir, { max: args.max })
      return listProjectVersions(absDir, { limit: args.limit })
    },
  })

  ctx.tools.register({
    name: 'manage_scene_edits',
    description:
      'Human edit protection. lock/unlock scenes (locked scenes keep content + timing in director re-plans, are never re-coded by the batched TSX coder, are refused/skipped by refine, and keep their sfxCues in the audio stage); set_override / clear_override store UI edits as script.userOverrides[sceneId] = { field: value } (dotted paths allowed, sceneId "__project__" for project fields) that are re-applied after every AI regeneration via three-way merge (user wins, conflicts reported); list shows locks, overrides and the last merge report.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'lock', 'unlock', 'set_override', 'clear_override'], description: 'Operation.' },
        projectDir: { type: 'string', description: 'Video project directory.' },
        sceneId: { type: 'string', description: 'Target scene ID ("__project__" for project-level overrides).' },
        sceneIds: { type: 'array', items: { type: 'string' }, description: 'Multiple scene IDs (lock / unlock).' },
        overrides: { type: 'object', additionalProperties: true, description: 'Field → value map, e.g. { "title": "...", "subtitleText": "...", "durationSec": 4.5, "transition": "light-wipe" }. An empty "subtitleText" drops that override: the scene subtitles follow the narration again.' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Fields to clear (clear_override); omit to clear all overrides of the scene.' },
        reason: { type: 'string', description: 'Optional lock reason.' },
      },
      required: ['action', 'projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 30_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      if (args.action === 'lock' || args.action === 'unlock') {
        return setSceneLock({ projectDir: args.projectDir, sceneId: args.sceneId, sceneIds: args.sceneIds || [], locked: args.action === 'lock', reason: args.reason || '' })
      }
      if (args.action === 'set_override') {
        return setSceneOverrides({ projectDir: args.projectDir, sceneId: args.sceneId, overrides: args.overrides || {} })
      }
      if (args.action === 'clear_override') {
        const fields = Array.isArray(args.fields) ? args.fields : []
        return setSceneOverrides({ projectDir: args.projectDir, sceneId: args.sceneId, clearFields: fields, clearAll: fields.length === 0 })
      }
      return listSceneEdits(args.projectDir)
    },
  })

  ctx.tools.register({
    name: 'manage_characters',
    description:
      'Character consistency bank (per-project characters.json + optional global library under .dsh-home): list / save / delete / attach. A character has name, aliases, description and reference images (face, fullBody, expressions, turnaround) stored as asset paths. attach adds reference images (imported via the asset import path), binds the character to scenes, or copies a global character into the project. Cloud image/video prompts mentioning @角色名 or @别名 then carry the reference images (Seedream 4+, Kling image, Flux, Seedance i2v, MiniMax S2V, custom HTTP templates) or the textual description.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'save', 'delete', 'attach'], description: 'Operation.' },
        projectDir: { type: 'string', description: 'Video project directory (required for project scope / attach).' },
        scope: { type: 'string', enum: ['project', 'global', 'all'], description: 'Bank scope (default project; list defaults to all).' },
        character: { type: 'object', additionalProperties: true, description: '{ id?, name, aliases[], description, references: { face[], fullBody[], expressions[], turnaround[] } } (save).' },
        characterId: { type: 'string', description: 'Character ID (delete / attach).' },
        name: { type: 'string', description: 'Character name or alias (delete / attach).' },
        referenceType: { type: 'string', enum: ['face', 'fullBody', 'expressions', 'turnaround'], description: 'Reference slot for attach paths (default face).' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Reference image paths to attach (project-relative or absolute).' },
        sceneIds: { type: 'array', items: { type: 'string' }, description: 'Scenes to bind the character to (attach).' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 120_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const scope = args.scope || (args.action === 'list' ? 'all' : 'project')
      if (args.action === 'save') return await saveCharacter({ projectDir: args.projectDir || '', scope, character: args.character || {} })
      if (args.action === 'delete') return deleteCharacter({ projectDir: args.projectDir || '', scope, characterId: args.characterId || '', name: args.name || '' })
      if (args.action === 'attach') {
        return await attachCharacter({
          projectDir: args.projectDir,
          characterId: args.characterId || '',
          name: args.name || '',
          referenceType: args.referenceType || 'face',
          paths: args.paths || [],
          sceneIds: args.sceneIds || [],
        })
      }
      return listCharacters({ projectDir: args.projectDir || '', scope })
    },
  })

  ctx.tools.register({
    name: 'search_stock_media',
    description:
      'Search royalty-free stock photos / videos through the OFFICIAL Pexels API (api.pexels.com/v1/search, /videos/search) and Pixabay API (pixabay.com/api/, /api/videos/). Keys: the ones saved in the Studio (版本历史与工程安全 → 免费素材, or 设置 → 云端生成) take precedence, else PEXELS_API_KEY / PIXABAY_API_KEY in .env; both keys are free. Filters: orientation, minimum resolution, min/max duration. Returns normalised results (thumb, preview, size, duration, author, source page, license). Responses are cached for 24h and provider rate limits are respected. Without keys returns status "未配置" (the message points to the Studio form).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords (Chinese supported via locale zh-CN / lang zh).' },
        mediaType: { type: 'string', enum: ['image', 'video'], description: 'Photos or videos (default image).' },
        provider: { type: 'string', enum: ['auto', 'pexels', 'pixabay', 'all'], description: 'auto = first configured provider (falls back on error / no hits).' },
        orientation: { type: 'string', enum: ['landscape', 'portrait', 'square'], description: 'Orientation filter.' },
        minWidth: { type: 'number', description: 'Minimum width in pixels.' },
        minHeight: { type: 'number', description: 'Minimum height in pixels.' },
        minDurationSec: { type: 'number', description: 'Minimum video duration (seconds).' },
        maxDurationSec: { type: 'number', description: 'Maximum video duration (seconds).' },
        page: { type: 'number', description: 'Page number (default 1).' },
        perPage: { type: 'number', description: 'Results per page (default 15, max 80).' },
        locale: { type: 'string', description: 'Search locale (default zh-CN).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 60_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      return await searchStockMedia(args)
    },
  })

  ctx.tools.register({
    name: 'import_stock_media',
    description:
      'Download a chosen Pexels / Pixabay item (a normalised search_stock_media result, or provider + mediaType + id) from the provider\'s official CDN into the project via the regular asset import path, keeping attribution metadata (author, source page, license) in assets.json; optionally bind it to a scene.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        item: { type: 'object', additionalProperties: true, description: 'A result object returned by search_stock_media.' },
        provider: { type: 'string', enum: ['pexels', 'pixabay'], description: 'Provider (when item is omitted).' },
        mediaType: { type: 'string', enum: ['image', 'video'], description: 'Media type (when item is omitted).' },
        id: { type: 'string', description: 'Provider item ID (when item is omitted).' },
        sceneId: { type: 'string', description: 'Optional scene to bind the imported media to.' },
        query: { type: 'string', description: 'Optional original search query (stored with the attribution).' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 300_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await importStockMedia(args)
    },
  })

  ctx.tools.register({
    name: 'manage_cloud_jobs',
    description:
      'Cloud cost protection: list the paid-job ledger (<project>/output/cloud-jobs.json — provider, category, params hash, status, provider task id, result paths; retries with identical params resume / reuse instead of paying twice), or preview the auto B-roll sourcing plan (user assets → free stock → paid generation, honouring DSH_CLOUD_MAX_PAID_JOBS_PER_RUN).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'sourcing_plan'], description: 'Operation (default list).' },
        projectDir: { type: 'string', description: 'Video project directory.' },
        status: { type: 'string', description: 'Optional ledger status filter (submitting, submitted, result_ready, completed, failed, billing_failed, interrupted).' },
        limit: { type: 'number', description: 'Max jobs to return (default 100).' },
        mediaType: { type: 'string', enum: ['image', 'video'], description: 'Sourcing plan B-roll media type (default image).' },
        maxPaidJobsPerRun: { type: 'number', description: 'Sourcing plan: override the per-run paid cap for the preview.' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      if (args.action === 'sourcing_plan') {
        return resolveMediaSourcingPlan({ projectDir: args.projectDir, autoUseCloudBroll: true, mediaType: args.mediaType || 'image', maxPaidJobsPerRun: args.maxPaidJobsPerRun })
      }
      return listCloudJobs(args.projectDir, { status: args.status || '', limit: args.limit })
    },
  })

  ctx.tools.register({
    name: 'video_qa',
    description: 'Run FFmpeg automated post-render quality check (blackdetect + EBU R128 loudness + stream/duration match, plus photosensitive flash risk (WCAG ≤3 flashes/s), frozen frames vs planned holds, and unplanned jump cuts / glitch frames) on an MP4. deep=true also renders sample frames twice to verify pixel determinism (slower).',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        mp4Path: { type: 'string', description: 'Optional MP4 file path (defaults to output/final.mp4).' },
        deep: { type: 'boolean', description: 'Deep mode: re-render sample frames twice (Remotion renderStill / HTML capture) and compare pixel hashes. Default false (fast path).' },
        freezeThresholdSec: { type: 'number', description: 'Report frozen frames longer than this many seconds that the shot list does not plan (default 2.5).' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 300_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const { runPostRenderQa } = await import('../dsh-tool-video-suite/index.js')
      const script = readScriptJson(args.projectDir).data
      return await runPostRenderQa({
        projectDir: args.projectDir,
        mp4Path: args.mp4Path,
        script,
        deep: Boolean(args.deep),
        freezeThresholdSec: args.freezeThresholdSec,
      })
    },
  })

  ctx.tools.register({
    name: 'export_publish_pack',
    description:
      'Export a ready-to-publish platform bundle (MP4, cover.png, 3x3 grid, QA report, and meta.md titles/tags/AI compliance statement). cover.png is the cover chosen in the Studio (发布包导出 → 封面): by default the best automatic frame of the film (no black / fade / transition / blurry frame), or a picked video frame, an AI-generated cover or one with the title added. The result reports `cover: { mode, source, timeSec, aspect }`.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        platform: { type: 'string', enum: ['universal', 'douyin', 'kuaishou', 'xiaohongshu', 'bilibili'], description: 'Target platform preset.' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 60_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      return await exportPublishPack(args)
    },
  })

  ctx.tools.register({
    name: 'import_vendor_motion',
    description: 'Render an external third-party HTML/.motion directory in isolated headless Chromium, strip audio (-an), and import as a project video asset.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        sourceDir: { type: 'string', description: 'External .motion template folder path.' },
        name: { type: 'string', description: 'Short bundle name.' },
        durationSec: { type: 'number', description: 'Clip duration seconds (default 4).' },
      },
      required: ['projectDir', 'sourceDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 120_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await renderVendorClipIsolated(args)
    },
  })

  ctx.tools.register({
    name: 'curate_and_edit_assets',
    description:
      'Use FFmpeg to smart-crop, color-grade, speed-scale, trim, and optionally chroma-key matte Step 1 imported images and video clips into assets/edited/, updating script.json references.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        aspectRatio: { type: 'string', description: 'Target aspect ratio (auto, 16:9, 9:16, 3:4 小红书, 1:1, 4:3).' },
        quality: { type: 'string', description: 'Quality preset (720p, 1080p, 2k, 4k).' },
        style: { type: 'string', description: "Color grading style preset (tech, cinematic, documentary, energetic, warm, emerald); 'auto' / 'user:<id>' or omitted = the project's base preset." },
        trimSeconds: { type: 'number', description: 'Optional max duration cap per video clip in seconds.' },
        clipSpeed: { type: 'number', description: 'Optional video playback speed multiplier (0.5 to 2.5).' },
        chromaKeyColor: { type: 'string', description: 'Optional hex color (e.g. #00FF00) for green-screen alpha matting to yuva420p WebM.' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 180_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await executeCurateAndEditAssets(args)
    },
  })

  ctx.tools.register({
    name: 'run_agent_pipeline',
    description:
      'Launch the coordinated 4-Agent Video Production Pipeline (策划导演 Agent -> 素材剪辑 Agent -> 配音混音 Agent [+ Digital Human] -> 动效质检 Agent & MP4 render), tracked via Task Center with Pause/Stop/Retry controls.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        topic: { type: 'string', description: 'Video creative theme or brief.' },
        mode: { type: 'string', enum: ['ai-coded', 'fast-draft'], description: 'Pipeline mode: ai-coded or fast-draft.' },
        engine: { type: 'string', enum: ['html', 'remotion'], description: 'Target rendering engine.' },
        aspectRatio: { type: 'string', description: '16:9, 9:16, 3:4 (小红书), 1:1, 4:3, or auto.' },
        style: { type: 'string', pattern: '^(auto|tech|cinematic|documentary|energetic|warm|emerald|user:[A-Za-z0-9_-]{1,40})$', description: "Visual style: 'auto' = AI 自由匹配 (the AI picks the best of the 6 presets for the topic, or designs a new style when none fits; local drafts pick a preset by keyword rules), one of the presets tech (科技锋芒) / cinematic (电影大片) / documentary (极简纪实) / energetic (活力潮牌) / warm (温暖故事) / emerald (墨翠轻奢), or 'user:<id>' for a saved 我的风格预设. Omit to keep the project's current style (new projects: auto)." },
        quality: { type: 'string', description: '720p, 1080p, 2k, 4k.' },
        bgmMode: { type: 'string', enum: ['uploaded', 'llm-coded', 'tts-engine'], description: 'BGM source mode.' },
        narrationMode: { type: 'string', enum: ['tts', 'tts-beat-sync', 'subtitle-mv'], description: 'Voice vs beat-locked subtitle MV mode.' },
        aiAuthorCode: { type: 'boolean', description: 'When true (default in ai-coded mode), LLM authors per-scene bespoke Remotion TSX batch files with tsc verification.' },
        durationMode: { type: 'string', enum: ['auto', 'custom'], description: 'Duration mode: auto (AI free matching) or custom (strictly target targetDurationSec).' },
        targetDurationSec: { type: 'number', description: 'Optional target video duration in seconds (15..600).' },
        avatarEnabled: { type: 'boolean', description: 'Include transparent digital human presenter overlay.' },
        avatarMode: { type: 'string', enum: ['ai-human', 'cloned-human'], description: 'Avatar generation mode.' },
        avatarLayout: { type: 'string', enum: ['pip-br', 'pip-bl', 'fullscreen'], description: 'Avatar compositing layout.' },
        background: { type: 'boolean', description: 'If true, start asynchronously and return Task Center runId immediately.' },
        autoUseCloudBroll: { type: 'boolean', description: 'Auto B-roll for scenes without media: user assets → free stock (Pexels/Pixabay keys) → paid generation (only if maxPaidJobsPerRun / DSH_CLOUD_MAX_PAID_JOBS_PER_RUN > 0). Defaults to the cloud-media config flag.' },
        maxPaidJobsPerRun: { type: 'number', description: 'Explicit per-run cap of NEW paid cloud generations (overrides DSH_CLOUD_MAX_PAID_JOBS_PER_RUN, default 0 = auto paid generation off).' },
        brollMediaType: { type: 'string', enum: ['image', 'video'], description: 'Preferred auto B-roll media type (default image).' },
        figureStyle: { type: 'string', enum: ['auto', 'silhouette', 'papercut', 'puppet', 'ink', 'flat', 'stick', 'custom'], description: "人物画风 for people and animals in the film: 'auto' (default) lets the AI choose per film (history films default to silhouette); silhouette / papercut / puppet / ink / flat / stick use the built-in side-view figure library in that look; 'custom' makes the AI design its own characters in the look named by figureStyleNote (e.g. Q版萌系, 日系动漫, 绘本手绘). Beats style words in the brief. Omit to keep the project's saved choice." },
        figureStyleNote: { type: 'string', maxLength: 40, description: "With figureStyle 'custom': the character look in a few words (e.g. Q版萌系，圆脸大眼)." },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 600_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      // 视觉风格: resolve 'auto' / 'user:<id>' against the project and persist it; the pipeline itself works with the base preset
      const spec = { ...args }
      if (spec.projectDir) spec.style = prepareProjectStyleForRun({ projectDir: spec.projectDir, style: spec.style, text: spec.topic || '' }).style
      if (spec.background) return await startPipelineBackground(spec)
      return await runMultiAgentPipeline(spec)
    },
  })

  ctx.tools.register({
    name: 'analyze_reference_video',
    description:
      'Reverse-engineer an uploaded reference video using FFprobe + FFmpeg shot-cut detection + audio BPM/drop analysis + 9-frame contact sheet + 4-protocol Multimodal Vision LLM to extract replicable visual/character/VFX/transition/pacing DNA, write MOTION.md, and attach referenceStyle to script.json for same-style video recreation.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        videoPath: { type: 'string', description: 'Path to the reference video file (absolute or relative to projectDir).' },
        extractAudioAsBgm: { type: 'boolean', description: 'If true, also extract the reference video audio track as uploaded BGM.' },
        applyToScript: { type: 'boolean', description: 'If true (default), bind extracted referenceStyle, genre, pacing, and narrationMode directly onto script.json.' },
        useVision: { type: 'boolean', description: 'If true (default), call configured multimodal Vision LLM on the 3x3 keyframe contact sheet.' },
      },
      required: ['projectDir', 'videoPath'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 300_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await analyzeReferenceVideo(args)
    },
  })

  ctx.tools.register({
    name: 'manage_brand_kit',
    description:
      'Read or save a reusable Brand Kit (brandName, tagline, primaryColor, accentColor, backgroundColor, logoPath, watermarkText, defaultStyle, defaultPlatform) and/or export a project MOTION.md shot blueprint.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'save', 'export_motion_md'], description: 'Operation to perform.' },
        projectDir: { type: 'string', description: 'Optional project directory (required for export_motion_md).' },
        brandKit: { type: 'object', description: 'Brand kit object when action is save.', additionalProperties: true },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      if (args.action === 'save') {
        return { ok: true, brandKit: saveBrandKit(args.brandKit || {}, args.projectDir || '') }
      }
      if (args.action === 'export_motion_md') {
        if (!args.projectDir) throw new Error('projectDir is required for export_motion_md')
        return exportProjectMotionMd(args.projectDir)
      }
      return { ok: true, brandKit: loadBrandKit(args.projectDir || '') }
    },
  })

  ctx.tools.register({
    name: 'configure_cloud_media',
    description:
      'Read or save optional BYOK Cloud AI Media Generation connectors for Image (Seedream/OpenAI/Flux/Kling/Custom), Video (Seedance/Kling/MiniMax Hailuo/Sora/Custom), and Audio/Music (Suno/MiniMax Music & Speech/ElevenLabs/Custom HTTP JSON protocol).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'save'], description: 'Use get to inspect masked config + presets, or save to update.' },
        config: { type: 'object', description: 'Partial config patch { image?, video?, audio?, autoUseCloudBroll? }.', additionalProperties: true },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      if (args.action === 'save') {
        return { ok: true, config: saveCloudMediaConfig(args.config || {}) }
      }
      return { ok: true, config: getCloudMediaConfigSummary() }
    },
  })

  ctx.tools.register({
    name: 'generate_cloud_media',
    description:
      'Generate an Image, Live-Action Video B-roll, or AI Song/BGM/Audio track using configured optional BYOK Cloud AI providers (Seedream, Seedance, Kling, Flux, Suno, MiniMax Music/Speech/Hailuo, ElevenLabs, or Custom HTTP JSON protocol) and auto-import into the project.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Target video project directory.' },
        category: { type: 'string', enum: ['image', 'video', 'audio'], description: 'Media type to generate.' },
        prompt: { type: 'string', description: 'Visual or musical description prompt.' },
        lyrics: { type: 'string', description: 'Optional lyrics for Suno / MiniMax Music.' },
        tags: { type: 'string', description: 'Optional musical style tags.' },
        title: { type: 'string', description: 'Optional asset/song title.' },
        durationSec: { type: 'number', description: 'Optional target duration in seconds (e.g. 5 or 10 for video).' },
        aspectRatio: { type: 'string', description: 'Aspect ratio (16:9, 9:16, 1:1).' },
        imageUrl: { type: 'string', description: 'Optional first-frame reference image URL for image-to-video.' },
        instrumental: { type: 'boolean', description: 'Pure instrumental music without vocals (Suno/Custom).' },
        sceneId: { type: 'string', description: 'Optional scene ID to auto-bind generated image/video into.' },
        autoBindToScript: { type: 'boolean', description: 'Automatically bind generated BGM/visual into script.json (default true).' },
        forceNew: { type: 'boolean', description: 'Pay for a NEW generation even if the paid-job ledger already holds a result / running task with identical params (default false: resume or reuse, never charge twice).' },
        characterIds: { type: 'array', items: { type: 'string' }, description: 'Extra character bank IDs to keep consistent (prompts mentioning @角色名 / @别名 are detected automatically).' },
        useCharacterRefs: { type: 'boolean', description: 'Attach character reference images / descriptions for @mentions (default true).' },
      },
      required: ['category', 'prompt'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 300_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await generateCloudMediaAsset(args)
    },
  })

  ctx.tools.register({
    name: 'manage_template_plaza',
    description:
      'Browse, inspect, apply, or publish reusable MOTION.md video blueprints in the built-in, online & community Template Plaza (影核广场 · CinePulse Hub). '
      + 'Community: `submit-preview` shows exactly what a submission would share (files, cleaned texts, privacy findings); `submit` (needs consent: true after the user agreed) builds a privacy-checked submission package (zip) on this computer and returns the GitHub issue-form / e-mail links — show them to the user, who sends the package himself (never upload or e-mail anything yourself); `submissions` lists the packages; `sync-online` refreshes the online catalogue of templates the author accepted (only when the user asks).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'apply', 'publish', 'submit-preview', 'submit', 'submissions', 'sync-online'], description: 'Plaza operation.' },
        category: { type: 'string', description: 'Optional category filter when listing.' },
        query: { type: 'string', description: 'Optional search keyword when listing.' },
        templateId: { type: 'string', description: 'Template ID for get/apply/publish.' },
        projectDir: { type: 'string', description: 'Project directory for apply/publish.' },
        newTopic: { type: 'string', description: 'Optional new topic when applying a template.' },
        copyScenes: { type: 'boolean', description: 'If true, also copy starter scenes from template.' },
        name: { type: 'string', description: 'Display name when publishing.' },
        description: { type: 'string', description: 'Template description when publishing.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags when publishing / submitting.' },
        title: { type: 'string', description: 'Work title for submit-preview / submit (defaults to name).' },
        author: { type: 'string', description: 'Author nickname for a submission.' },
        contact: { type: 'string', description: 'Optional contact shown to the plaza maintainer (public on GitHub).' },
        consent: { type: 'boolean', description: 'Must be true for submit: the user agreed that the maintainer may show / curate / distribute the work and that it infringes nobody\'s rights or privacy.' },
        allowNames: { type: 'boolean', description: 'The user confirmed that a computer / user name found in the content may be published.' },
        previewStartSec: { type: 'number', description: 'Start of the ≤ 15 s sample clip taken from output/final.mp4.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 300_000, // a submission cuts a sample clip with ffmpeg; the online sync downloads templates
    isConcurrencySafe: () => true,
    async execute(args) {
      if (args.action === 'submit-preview') return previewPlazaSubmission({ ...args, title: args.title || args.name })
      if (args.action === 'submit') return buildPlazaSubmission({ ...args, title: args.title || args.name, consent: args.consent === true })
      if (args.action === 'submissions') return listPlazaSubmissions()
      if (args.action === 'sync-online') return syncOnlinePlazaTemplates()
      if (args.action === 'get') return getPlazaTemplate(args.templateId)
      if (args.action === 'apply') return applyPlazaTemplateToProject(args)
      if (args.action === 'publish') return publishProjectToPlaza(args)
      return listPlazaTemplates({ category: args.category, query: args.query })
    },
  })
}

export {
  applyPlazaTemplateToProject,
  assistCloudMediaPrompt,
  CLOUD_MEDIA_PRESETS,
  commitStagedCloudAsset,
  discardStagedCloudAsset,
  executeCurateAndEditAssets,
  generateAiCodedSfxCues,
  generateCloudMediaAsset,
  getCloudMediaConfigSummary,
  getPlazaTemplate,
  listPlazaTemplates,
  listStagedCloudAssets,
  loadCloudMediaConfig,
  PLAZA_BRAND,
  PLAZA_CATEGORIES,
  publishProjectToPlaza,
  runMultiAgentPipeline,
  saveCloudMediaConfig,
  startPipelineBackground,
  taskManager,
}

export default { name, inject, apply }
export * from './genre-router.js'
export { extractJsonFromLlmText } from './llm-client.js'
