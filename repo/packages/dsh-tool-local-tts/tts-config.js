import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv, REPO_ROOT, resolveEnvPath } from '../shared/index.js'

export const TTS_CONFIG_FILENAME = '.dsh-video-tts-config.json'

export const BUILTIN_TTS_ENGINES = [
  {
    id: 'indextts25',
    builtin: true,
    kind: 'indextts25',
    name: 'IndexTTS-2.5 (高保真情感克隆)',
    shortName: 'IndexTTS-2.5',
    vramBadge: '推荐 8GB+ 显存',
    description: '支持零样本音色克隆、情感语音参考及 Qwen 情绪指令控制，音质细腻。',
    supportsZeroShotClone: true,
  },
  {
    id: 'indextts2',
    builtin: true,
    kind: 'indextts2',
    name: 'IndexTTS-2 (经典本地版本)',
    shortName: 'IndexTTS-2',
    vramBadge: '6–8GB 显存',
    description: '兼容旧版 cy_app / IndexTTS-2 HTTP 与本地推理入口。',
    supportsZeroShotClone: true,
  },
  {
    id: 'gptvoice',
    builtin: true,
    kind: 'gptvoice',
    name: 'GPT-SoVITS (低显存轻量克隆)',
    shortName: 'GPT-SoVITS',
    vramBadge: '4GB+ 显存 · 低配友好',
    description: '专为低显存 / 中低配显卡优化的轻量配音与音色克隆方案，兼容 api_v2.py 与 v1 接口。',
    supportsZeroShotClone: true,
  },
  ...(process.platform === 'win32'
    ? [
        {
          id: 'windows-sapi-cpu',
          builtin: true,
          kind: 'windows-sapi',
          name: 'Windows 系统原生中文语音 (零显卡纯CPU)',
          shortName: 'Windows 原生',
          vramBadge: '0GB 显存 · 免下载开箱即用',
          description: '直接调用 Windows 10/11 内置 System.Speech 中文语音引擎并支持语速调节，无独立显卡/低配电脑零配置立即可用。',
          supportsZeroShotClone: false,
        },
      ]
    : []),
  {
    id: 'minimax-tts',
    builtin: true,
    kind: 'minimax-tts',
    name: 'MiniMax Speech 云端情感语音 (T2A v2)',
    shortName: 'MiniMax 云端语音',
    vramBadge: '0GB 显存 · 云端高表现力',
    description: '支持 speech-2.6-hd / speech-02-hd 及任意自定义模型 ID，无需本地显卡即可合成高表现力多情绪中文配音。',
    supportsZeroShotClone: false,
  },
  {
    id: 'doubao-tts',
    builtin: true,
    kind: 'doubao-tts',
    name: '火山方舟 · 豆包语音大模型 TTS',
    shortName: '豆包云端语音',
    vramBadge: '0GB 显存 · 火山引擎云端',
    description: '接入火山引擎 / 豆包语音合成 HTTP 接口 (openspeech.bytedance.com/api/v1/tts)，支持 AppID + Token + 自定义音色 voice_type。',
    supportsZeroShotClone: false,
  },
]

export const QUICK_TTS_TEMPLATES = [
  {
    templateId: 'edge-tts-cpu',
    label: 'Edge-TTS (零显卡纯 CPU 命令行)',
    engine: {
      id: 'edge-tts-cpu',
      name: 'Edge-TTS 轻量旁白 (纯CPU零显存)',
      kind: 'cli-command',
      vramBadge: '0GB 显存 · 纯CPU',
      description: '通过本机 `pip install edge-tts` 调用微软神经语音，完全不需要显卡；支持 zh-CN-XiaoxiaoNeural / YunxiNeural 等音色。',
      command: 'edge-tts',
      argsTemplate: '--text {{text}} --voice {{voice}} --write-media {{output}}',
      defaultVoice: 'zh-CN-YunxiNeural',
      outputExt: '.mp3',
    },
  },
  {
    templateId: 'fish-speech-openai',
    label: 'Fish Speech / OpenAI /v1/audio/speech',
    engine: {
      id: 'fish-speech-openai',
      name: 'Fish Speech / OpenAI TTS 接口',
      kind: 'openai-tts',
      vramBadge: '云端或本机 API',
      description: '标准 `/v1/audio/speech` 协议，兼容 Fish Speech、OneAPI、SiliconFlow、OpenAI 等服务。',
      endpoint: 'http://127.0.0.1:8080/v1/audio/speech',
      model: 'fish-speech-1.5',
      voice: 'default',
      responseFormat: 'wav',
      speed: 1.0,
    },
  },
  {
    templateId: 'kokoro-openai',
    label: 'Kokoro-FastAPI (超轻量本地 / CPU)',
    engine: {
      id: 'kokoro-openai',
      name: 'Kokoro 82M 超轻量语音',
      kind: 'openai-tts',
      vramBadge: 'CPU / <2GB 显存',
      description: '82M 参数超轻量语音模型，低配电脑与核显/CPU也能高速合成。',
      endpoint: 'http://127.0.0.1:8880/v1/audio/speech',
      model: 'kokoro',
      voice: 'zf_xiaoxiao',
      responseFormat: 'wav',
      speed: 1.0,
    },
  },
  {
    templateId: 'cosyvoice-http',
    label: 'CosyVoice / ChatTTS 通用 HTTP JSON',
    engine: {
      id: 'cosyvoice-http',
      name: 'CosyVoice / 自定义 HTTP 模型',
      kind: 'http-json',
      vramBadge: '自定义 HTTP',
      description: '通用 JSON HTTP POST/GET 接口，可对接 CosyVoice、ChatTTS、Sherpa-ONNX 等任意服务，支持 {{text}} / {{refAudio}} 占位符。',
      endpoint: 'http://127.0.0.1:9882/tts',
      method: 'POST',
      responseType: 'binary',
      responseAudioPath: 'audio',
      payloadTemplate: {
        text: '{{text}}',
        voice: '{{voiceName}}',
        lang: '{{lang}}',
        speed: '{{speed}}',
        ref_audio: '{{refAudio}}',
        prompt_text: '{{promptText}}',
      },
    },
  },
]

function configFilePath(repoRoot = REPO_ROOT) {
  return join(repoRoot, TTS_CONFIG_FILENAME)
}

function maskSecret(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (s.length <= 6) return '******'
  return `${s.slice(0, 3)}***${s.slice(-4)}`
}

function isMaskedPlaceholder(val) {
  const s = String(val || '').trim()
  return !s || s === '******' || /^.{1,6}\*{3,}.{1,6}$/.test(s)
}

export function slugifyEngineId(raw, fallback = 'custom-tts') {
  const slug = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || `${fallback}-${Date.now().toString(36)}`
}

function defaultBuiltinOverridesFromEnv() {
  loadEnv()
  return {
    indextts25: {
      endpoint: (process.env.INDEXTTS_ENDPOINT || 'http://127.0.0.1:9880').replace(/\/+$/, ''),
      rootDir: resolveEnvPath('INDEXTTS_ROOT', ''),
      pythonBin: resolveEnvPath('INDEXTTS_PYTHON', ''),
    },
    indextts2: {
      endpoint: (process.env.INDEXTTS_ENDPOINT || 'http://127.0.0.1:9880').replace(/\/+$/, ''),
      rootDir: resolveEnvPath('INDEXTTS_ROOT', ''),
      pythonBin: resolveEnvPath('INDEXTTS_PYTHON', ''),
    },
    gptvoice: {
      endpoint: (process.env.GPTVOICE_ENDPOINT || 'http://127.0.0.1:9881').replace(/\/+$/, ''),
      rootDir: resolveEnvPath('GPTVOICE_ROOT', ''),
      pythonBin: resolveEnvPath('GPTVOICE_PYTHON', ''),
      apiVersion: process.env.GPTVOICE_API_VERSION || 'v2',
      textLang: process.env.GPTVOICE_TEXT_LANG || 'zh',
      promptLang: process.env.GPTVOICE_PROMPT_LANG || 'zh',
      howToCut: process.env.GPTVOICE_HOW_TO_CUT || '凑四句一切',
    },
    'minimax-tts': {
      endpoint: (process.env.MINIMAX_TTS_ENDPOINT || 'https://api.minimaxi.com/v1/t2a_v2').replace(/\/+$/, ''),
      model: process.env.MINIMAX_TTS_MODEL || 'speech-2.6-hd',
      voiceId: process.env.MINIMAX_TTS_VOICE || 'male-qn-qingse',
      apiKey: process.env.MINIMAX_API_KEY || '',
    },
    'doubao-tts': {
      endpoint: (process.env.DOUBAO_TTS_ENDPOINT || 'https://openspeech.bytedance.com/api/v1/tts').replace(/\/+$/, ''),
      appId: process.env.DOUBAO_TTS_APPID || '',
      token: process.env.DOUBAO_TTS_TOKEN || '',
      cluster: process.env.DOUBAO_TTS_CLUSTER || 'volcano_tts',
      voiceType: process.env.DOUBAO_TTS_VOICE || 'zh_male_m392_conversation_wvae_bigtts',
    },
  }
}

export function loadTtsConfig(repoRoot = REPO_ROOT) {
  loadEnv()
  const envBuiltins = defaultBuiltinOverridesFromEnv()
  const p = configFilePath(repoRoot)
  let saved = {}
  if (existsSync(p)) {
    try {
      saved = JSON.parse(readFileSync(p, 'utf8')) || {}
    } catch {
      saved = {}
    }
  }
  const builtins = {
    indextts25: { ...envBuiltins.indextts25, ...(saved.builtins?.indextts25 || {}) },
    indextts2: { ...envBuiltins.indextts2, ...(saved.builtins?.indextts2 || {}) },
    gptvoice: { ...envBuiltins.gptvoice, ...(saved.builtins?.gptvoice || {}) },
    'minimax-tts': { ...envBuiltins['minimax-tts'], ...(saved.builtins?.['minimax-tts'] || {}) },
    'doubao-tts': { ...envBuiltins['doubao-tts'], ...(saved.builtins?.['doubao-tts'] || {}) },
  }
  const customEngines = Array.isArray(saved.customEngines)
    ? saved.customEngines.filter((e) => e && typeof e === 'object' && e.id)
    : []
  const envDefault = String(process.env.DEFAULT_TTS_ENGINE || '').trim()
  const hasLocalGpuRoots = Boolean(
    (envBuiltins.indextts25?.rootDir && existsSync(envBuiltins.indextts25.rootDir)) ||
      (envBuiltins.gptvoice?.rootDir && existsSync(envBuiltins.gptvoice.rootDir)),
  )
  const autoFallbackDefault = !hasLocalGpuRoots && process.platform === 'win32' ? 'windows-sapi-cpu' : 'indextts25'
  const activeEngineId = String(saved.activeEngineId || envDefault || autoFallbackDefault).trim() || autoFallbackDefault
  return {
    version: 1,
    activeEngineId,
    builtins,
    customEngines,
    updatedAt: saved.updatedAt || null,
  }
}

export function saveTtsConfig(nextInput = {}, repoRoot = REPO_ROOT) {
  const current = loadTtsConfig(repoRoot)
  const mergedBuiltins = { ...current.builtins }
  if (nextInput.builtins && typeof nextInput.builtins === 'object') {
    for (const id of ['indextts25', 'indextts2', 'gptvoice', 'minimax-tts', 'doubao-tts']) {
      if (nextInput.builtins[id] && typeof nextInput.builtins[id] === 'object') {
        const prevB = mergedBuiltins[id] || {}
        const patch = { ...nextInput.builtins[id] }
        if (typeof patch.endpoint === 'string') patch.endpoint = patch.endpoint.trim().replace(/\/+$/, '')
        if (patch.clearApiKey === true) patch.apiKey = ''
        else if ('apiKey' in patch && isMaskedPlaceholder(patch.apiKey)) patch.apiKey = prevB.apiKey || ''
        if (patch.clearToken === true) patch.token = ''
        else if ('token' in patch && isMaskedPlaceholder(patch.token)) patch.token = prevB.token || ''
        delete patch.clearApiKey
        delete patch.clearToken
        delete patch.hasApiKey
        delete patch.apiKeyMasked
        delete patch.hasToken
        delete patch.tokenMasked
        mergedBuiltins[id] = { ...prevB, ...patch }
      }
    }
  }

  let nextCustom = [...current.customEngines]
  if (Array.isArray(nextInput.customEngines)) {
    nextCustom = nextInput.customEngines
      .filter((e) => e && typeof e === 'object')
      .map((item) => {
        const cleanId = slugifyEngineId(item.id || item.name, 'custom-tts')
        const prev = current.customEngines.find((c) => c.id === cleanId)
        const nextApiKey =
          item.clearApiKey === true
            ? ''
            : isMaskedPlaceholder(item.apiKey)
              ? prev?.apiKey || ''
              : String(item.apiKey || '').trim()
        return {
          ...prev,
          ...item,
          id: cleanId,
          builtin: false,
          name: String(item.name || cleanId).trim(),
          kind: ['openai-tts', 'http-json', 'cli-command'].includes(item.kind) ? item.kind : 'http-json',
          apiKey: nextApiKey,
          clearApiKey: undefined,
        }
      })
  }

  const nextActive = String(nextInput.activeEngineId || current.activeEngineId || 'indextts25').trim()
  const knownIds = new Set([...BUILTIN_TTS_ENGINES.map((b) => b.id), ...nextCustom.map((c) => c.id)])
  const finalActive = knownIds.has(nextActive) ? nextActive : 'indextts25'

  const payload = {
    version: 1,
    activeEngineId: finalActive,
    builtins: mergedBuiltins,
    customEngines: nextCustom,
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(configFilePath(repoRoot), JSON.stringify(payload, null, 2) + '\n', 'utf8')
  return payload
}

export function setActiveTtsEngine(engineId, repoRoot = REPO_ROOT) {
  return saveTtsConfig({ activeEngineId: engineId }, repoRoot)
}

export function addOrUpdateCustomTtsEngine(engineSpec = {}, repoRoot = REPO_ROOT) {
  const cfg = loadTtsConfig(repoRoot)
  const rawId = String(engineSpec.id || engineSpec.name || '').trim()
  let cleanId = slugifyEngineId(rawId, 'custom-tts')
  if (['indextts25', 'indextts2', 'gptvoice', 'auto', 'fallback'].includes(cleanId)) {
    cleanId = `custom-${cleanId}`
  }
  const existingIdx = cfg.customEngines.findIndex((e) => e.id === cleanId)
  const prev = existingIdx >= 0 ? cfg.customEngines[existingIdx] : null
  const nextApiKey =
    engineSpec.clearApiKey === true
      ? ''
      : isMaskedPlaceholder(engineSpec.apiKey)
        ? prev?.apiKey || ''
        : String(engineSpec.apiKey || '').trim()

  const normalized = {
    ...(prev || {}),
    ...engineSpec,
    id: cleanId,
    builtin: false,
    name: String(engineSpec.name || cleanId).trim(),
    kind: ['openai-tts', 'http-json', 'cli-command'].includes(engineSpec.kind) ? engineSpec.kind : 'http-json',
    vramBadge: String(engineSpec.vramBadge || (engineSpec.kind === 'cli-command' ? '本地命令 / 低配友好' : '自定义模型')).trim(),
    endpoint: typeof engineSpec.endpoint === 'string' ? engineSpec.endpoint.trim() : prev?.endpoint || '',
    method: String(engineSpec.method || prev?.method || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST',
    model: typeof engineSpec.model === 'string' ? engineSpec.model.trim() : prev?.model || '',
    voice: typeof engineSpec.voice === 'string' ? engineSpec.voice.trim() : prev?.voice || prev?.defaultVoice || '',
    defaultVoice:
      typeof engineSpec.defaultVoice === 'string'
        ? engineSpec.defaultVoice.trim()
        : typeof engineSpec.voice === 'string'
          ? engineSpec.voice.trim()
          : prev?.defaultVoice || 'default',
    responseFormat: String(engineSpec.responseFormat || prev?.responseFormat || 'wav').trim().toLowerCase(),
    speed: Number(engineSpec.speed ?? prev?.speed ?? 1.0) || 1.0,
    responseType: ['binary', 'json_base64', 'json_url'].includes(engineSpec.responseType)
      ? engineSpec.responseType
      : prev?.responseType || 'binary',
    responseAudioPath: String(engineSpec.responseAudioPath || prev?.responseAudioPath || 'audio').trim(),
    payloadTemplate:
      engineSpec.payloadTemplate !== undefined
        ? engineSpec.payloadTemplate
        : prev?.payloadTemplate || { text: '{{text}}', voice: '{{voiceName}}', lang: '{{lang}}' },
    headers: engineSpec.headers && typeof engineSpec.headers === 'object' ? engineSpec.headers : prev?.headers || {},
    command: typeof engineSpec.command === 'string' ? engineSpec.command.trim() : prev?.command || '',
    argsTemplate: engineSpec.argsTemplate !== undefined ? engineSpec.argsTemplate : prev?.argsTemplate || '',
    cwd: typeof engineSpec.cwd === 'string' ? engineSpec.cwd.trim() : prev?.cwd || '',
    outputExt: String(engineSpec.outputExt || prev?.outputExt || '.wav').trim(),
    apiKey: nextApiKey,
  }
  delete normalized.clearApiKey

  const nextCustom = [...cfg.customEngines]
  if (existingIdx >= 0) nextCustom[existingIdx] = normalized
  else nextCustom.push(normalized)

  const shouldActivate = engineSpec.activate !== false
  return saveTtsConfig(
    {
      customEngines: nextCustom,
      ...(shouldActivate ? { activeEngineId: cleanId } : {}),
    },
    repoRoot,
  )
}

export function removeCustomTtsEngine(id, repoRoot = REPO_ROOT) {
  const cfg = loadTtsConfig(repoRoot)
  const target = String(id || '').trim()
  const nextCustom = cfg.customEngines.filter((e) => e.id !== target)
  const nextActive = cfg.activeEngineId === target ? 'gptvoice' : cfg.activeEngineId
  return saveTtsConfig({ customEngines: nextCustom, activeEngineId: nextActive }, repoRoot)
}

export function getActiveTtsEngineId(repoRoot = REPO_ROOT) {
  return loadTtsConfig(repoRoot).activeEngineId || 'indextts25'
}

export function resolveTtsEngineSpec(requestedEngine = '', repoRoot = REPO_ROOT) {
  const cfg = loadTtsConfig(repoRoot)
  const wantedRaw = String(requestedEngine || '').trim()
  const wanted = !wantedRaw || wantedRaw === 'auto' ? cfg.activeEngineId : wantedRaw

  const builtin = BUILTIN_TTS_ENGINES.find((b) => b.id === wanted)
  if (builtin) {
    const overrides = cfg.builtins[builtin.id] || {}
    return {
      ...builtin,
      ...overrides,
      endpoint:
        builtin.kind === 'windows-sapi'
          ? ''
          : overrides.endpoint ||
            (builtin.id === 'gptvoice'
              ? 'http://127.0.0.1:9881'
              : builtin.id === 'minimax-tts'
                ? 'https://api.minimaxi.com/v1/t2a_v2'
                : builtin.id === 'doubao-tts'
                  ? 'https://openspeech.bytedance.com/api/v1/tts'
                  : 'http://127.0.0.1:9880'),
    }
  }

  const custom = cfg.customEngines.find((c) => c.id === wanted)
  if (custom) {
    return { ...custom, builtin: false }
  }

  // Fallback to indextts25 if unknown ID was passed
  const fallbackBuiltin = BUILTIN_TTS_ENGINES[0]
  return {
    ...fallbackBuiltin,
    ...(cfg.builtins.indextts25 || {}),
  }
}

export function getSafeTtsConfigSummary(repoRoot = REPO_ROOT) {
  const cfg = loadTtsConfig(repoRoot)
  const engines = [
    ...BUILTIN_TTS_ENGINES.map((b) => {
      const ov = cfg.builtins[b.id] || {}
      const out = { ...b, ...ov }
      if (b.id === 'minimax-tts') {
        out.hasApiKey = Boolean(String(ov.apiKey || '').trim())
        out.apiKeyMasked = maskSecret(ov.apiKey)
        out.apiKey = undefined
      }
      if (b.id === 'doubao-tts') {
        out.hasToken = Boolean(String(ov.token || '').trim())
        out.tokenMasked = maskSecret(ov.token)
        out.token = undefined
      }
      return out
    }),
    ...cfg.customEngines.map((c) => ({
      ...c,
      hasApiKey: Boolean(c.apiKey),
      apiKeyMasked: maskSecret(c.apiKey),
      apiKey: undefined,
    })),
  ]
  const activeEngine = engines.find((e) => e.id === cfg.activeEngineId) || engines[0]
  return {
    activeEngineId: cfg.activeEngineId,
    activeEngine,
    engines,
    templates: QUICK_TTS_TEMPLATES,
    configPath: configFilePath(repoRoot),
    updatedAt: cfg.updatedAt,
  }
}
