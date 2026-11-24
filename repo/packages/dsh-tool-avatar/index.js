import {
  AVATAR_TEMPLATES,
  buildTimelineAlignedVoiceWav,
  executeGenerateAvatar,
  extractAudioRmsEnvelope,
  getAvatarProviderSummary,
  normalizeLipSyncMode,
  probeVideoStream,
  resolveSafeAvatarLayout,
  saveAvatarConfig,
} from './avatar-engine.js'
import {
  getLipsyncStatus,
  LIPSYNC_ENGINE_IDS,
  LipsyncUnavailableError,
  resolveLipsyncConfig,
  runLipsync,
} from './lipsync-engine.js'
import { getLipsyncInstallerCatalog, installLipsyncEngine } from './lipsync-installer.js'

export {
  AVATAR_TEMPLATES,
  buildTimelineAlignedVoiceWav,
  executeGenerateAvatar,
  extractAudioRmsEnvelope,
  getAvatarProviderSummary,
  getLipsyncInstallerCatalog,
  getLipsyncStatus,
  installLipsyncEngine,
  LIPSYNC_ENGINE_IDS,
  LipsyncUnavailableError,
  normalizeLipSyncMode,
  probeVideoStream,
  resolveLipsyncConfig,
  resolveSafeAvatarLayout,
  runLipsync,
  saveAvatarConfig,
}

export const name = 'dsh-tool-avatar'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({
    name: 'generate_avatar',
    description:
      'Generate a transparent alpha-channel (yuva420p .webm) AI digital human or cloned human spokesperson overlay video clip, and mount avatarClip + avatarLayout (fullscreen / pip-bl / pip-br) into script.json for transparent compositing in both Remotion and HyperFrames HTML5. In cloned-human mode the recorded person video (or portrait photo) is lip-synced to the (voice-cloned) narration by the configured engine (AVATAR_LIPSYNC_ENGINE: local MuseTalk 1.5, LatentSync/CLI or fal.ai), aligned to the project timeline, with automatic fallback to the non-lip-sync compositor when no engine is available.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: {
          type: 'string',
          description: 'Absolute or relative path to the video project directory.',
        },
        sceneId: {
          type: 'string',
          description: 'Optional scene ID to mount the avatar onto (omit to mount as a project-wide spokesperson overlay).',
        },
        avatarMode: {
          type: 'string',
          enum: ['ai-human', 'cloned-human'],
          description: 'Use "cloned-human" to drive uploaded/recorded human base video with IndexTTS-2.5 cloned voice, or "ai-human" for a built-in AI presenter.',
        },
        sourceVideoPath: {
          type: 'string',
          description: 'Uploaded or webcam-recorded human base video path (relative to projectDir or absolute) for cloned-human mode.',
        },
        sourceImagePath: {
          type: 'string',
          description: 'Portrait photo path for cloned-human talking head when no video clip is provided.',
        },
        voiceId: {
          type: 'string',
          description: 'Voice ID from IndexTTS-2.5 Voice Catalog, or "auto".',
        },
        voiceSamplePath: {
          type: 'string',
          description: 'Optional voice sample audio/video file path in Step 1 to clone before driving the avatar.',
        },
        narrationText: {
          type: 'string',
          description: 'Spoken script text to drive lip-sync speech when audioPath is not supplied.',
        },
        audioPath: {
          type: 'string',
          description: 'Optional pre-synthesized or mastered WAV audio path.',
        },
        avatarLayout: {
          type: 'string',
          enum: ['fullscreen', 'pip-bl', 'pip-br', 'off'],
          description: 'Compositing layout: fullscreen, pip-bl (bottom-left PiP), pip-br (bottom-right PiP), or off.',
        },
        presetId: {
          type: 'string',
          description: 'Built-in AI presenter template ID (cyber-anchor, editorial-mentor, studio-creator).',
        },
        chromaKeyColor: {
          type: 'string',
          description: 'Optional hex chroma-key background color (e.g. #00FF00) when matting green/blue screen human video.',
        },
        lipSync: {
          type: 'string',
          enum: ['auto', 'on', 'off'],
          description: 'Real mouth lip-sync for cloned-human mode: auto (default; use the configured engine, fall back to the non-lip-sync overlay if unavailable), on (fail instead of falling back), off.',
        },
        lipsyncEngine: {
          type: 'string',
          enum: ['auto', 'musetalk', 'latentsync', 'cli', 'cloud-fal', 'off'],
          description: 'Optional per-call override of AVATAR_LIPSYNC_ENGINE.',
        },
        alignToTimeline: {
          type: 'string',
          enum: ['auto', 'true', 'false'],
          description: 'Drive the mouth with the narration placed exactly where master-audio.wav places it (project-wide overlays). Default auto.',
        },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
      },
    },
    timeoutMs: 1_800_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return executeGenerateAvatar(args)
    },
  })
}

export default { name, inject, apply }
