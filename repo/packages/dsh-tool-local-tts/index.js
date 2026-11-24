import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  alignSubtitlesToSpeechAudio,
  buildSentenceSubtitles,
  loadEnv,
  normalizeNumeralsForDisplay,
  probeAudioDuration,
  readScriptJson,
  REPO_ROOT,
  resolveBinaries,
  resolveEnvPath,
  resolvePackagePath,
  runCommandRedirected,
  subChunksMatchNarration,
  toTtsText,
  writeScriptJson,
} from '../shared/index.js'
import {
  castVoicesWithLlm,
  cloneRecordedVoice,
  deleteImportedVoice,
  ensureDefaultReferenceVoices,
  findBestAvailableWavVoice,
  getVoiceCatalog,
  importVoicePack,
  matchAllScenesInScript,
  matchVoiceForScene,
  syncVoiceLibraryJson,
} from './voice-manager.js'
import { ensureTtsServer, getTtsServerHealth, stopTtsServer } from './tts-server-manager.js'
import {
  getTtsInstallerCatalog,
  installTtsEngine,
  TTS_INSTALLER_PACKAGES,
} from './tts-installer.js'
import {
  addOrUpdateCustomTtsEngine,
  BUILTIN_TTS_ENGINES,
  getActiveTtsEngineId,
  getSafeTtsConfigSummary,
  loadTtsConfig,
  QUICK_TTS_TEMPLATES,
  removeCustomTtsEngine,
  resolveTtsEngineSpec,
  saveTtsConfig,
  setActiveTtsEngine,
} from './tts-config.js'

export {
  castVoicesWithLlm,
  cloneRecordedVoice,
  deleteImportedVoice,
  ensureDefaultReferenceVoices,
  getVoiceCatalog,
  importVoicePack,
  matchAllScenesInScript,
  matchVoiceForScene,
  syncVoiceLibraryJson,
  ensureTtsServer,
  getTtsServerHealth,
  stopTtsServer,
  getTtsInstallerCatalog,
  installTtsEngine,
  TTS_INSTALLER_PACKAGES,
  loadTtsConfig,
  saveTtsConfig,
  setActiveTtsEngine,
  addOrUpdateCustomTtsEngine,
  removeCustomTtsEngine,
  getActiveTtsEngineId,
  resolveTtsEngineSpec,
  getSafeTtsConfigSummary,
  BUILTIN_TTS_ENGINES,
  QUICK_TTS_TEMPLATES,
}

function substituteTemplateValue(tmpl, vars) {
  if (typeof tmpl === 'string') {
    const exactKey = /^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/.exec(tmpl.trim())
    if (exactKey && exactKey[1] in vars && typeof vars[exactKey[1]] === 'number') {
      return vars[exactKey[1]]
    }
    return tmpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => (k in vars ? String(vars[k] ?? '') : ''))
  }
  if (Array.isArray(tmpl)) return tmpl.map((x) => substituteTemplateValue(x, vars))
  if (tmpl && typeof tmpl === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(tmpl)) out[k] = substituteTemplateValue(v, vars)
    return out
  }
  return tmpl
}

function getByDotPath(obj, dotPath) {
  if (!obj || typeof obj !== 'object') return undefined
  const parts = String(dotPath || '').split('.').filter(Boolean)
  let cur = obj
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in cur) cur = cur[part]
    else return undefined
  }
  return cur
}

function splitCliArgsTemplate(argsTemplate, vars) {
  if (Array.isArray(argsTemplate)) {
    return argsTemplate.map((token) => String(substituteTemplateValue(String(token), vars)))
  }
  const raw = String(argsTemplate || '')
  const tokens = []
  const rx = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = rx.exec(raw)) !== null) {
    const tok = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]
    tokens.push(String(substituteTemplateValue(tok, vars)))
  }
  return tokens
}

async function normalizeOutputToPcmWav(rawAudioPath, targetWavPath) {
  const { ffmpeg } = resolveBinaries()
  const header = readFileSync(rawAudioPath).subarray(0, 12)
  const isRiffWav = header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE'
  if (isRiffWav && resolve(rawAudioPath) === resolve(targetWavPath)) {
    return targetWavPath
  }
  const tmpOut = resolve(rawAudioPath) === resolve(targetWavPath) ? `${targetWavPath}.norm.wav` : targetWavPath
  const conv = await runCommandRedirected(
    ffmpeg,
    ['-y', '-i', rawAudioPath, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', tmpOut],
    { timeoutMs: 60_000 },
  )
  if (conv.code !== 0 || !existsSync(tmpOut)) {
    throw new Error(`FFmpeg 音频转码失败: ${conv.stderr || conv.stdout}`)
  }
  if (tmpOut !== targetWavPath) {
    const buf = readFileSync(tmpOut)
    writeFileSync(targetWavPath, buf)
    try { rmSync(tmpOut, { force: true }) } catch {}
  }
  return targetWavPath
}

async function synthesizeViaCustomHttpTts(spec, vars, absOutputPath) {
  const endpointRaw = String(spec.endpoint || '').trim()
  if (!endpointRaw) throw new Error(`自定义配音模型「${spec.name}」未配置接口地址 (endpoint)。`)
  const headers = { ...(spec.headers && typeof spec.headers === 'object' ? spec.headers : {}) }
  if (spec.apiKey && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${spec.apiKey}`
  }

  let targetUrl = endpointRaw
  let method = spec.kind === 'openai-tts' ? 'POST' : spec.method === 'GET' ? 'GET' : 'POST'
  let reqBody = undefined

  if (spec.kind === 'openai-tts') {
    if (!/\/audio\/speech\/?$/i.test(targetUrl)) {
      targetUrl = `${targetUrl.replace(/\/+$/, '')}/audio/speech`
    }
    headers['Content-Type'] = headers['Content-Type'] || 'application/json'
    reqBody = JSON.stringify({
      model: spec.model || 'tts-1',
      input: vars.text,
      voice: spec.voice || vars.voice || 'alloy',
      response_format: spec.responseFormat || 'wav',
      speed: Number(vars.speed) || 1.0,
    })
  } else if (method === 'GET') {
    const u = new URL(targetUrl)
    const tmpl = typeof spec.payloadTemplate === 'object' && spec.payloadTemplate !== null ? substituteTemplateValue(spec.payloadTemplate, vars) : {}
    for (const [k, v] of Object.entries(tmpl)) {
      if (v !== undefined && v !== '') u.searchParams.set(k, String(v))
    }
    targetUrl = u.toString()
  } else {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json'
    const baseTmpl =
      typeof spec.payloadTemplate === 'string'
        ? JSON.parse(substituteTemplateValue(spec.payloadTemplate, vars))
        : substituteTemplateValue(spec.payloadTemplate || { text: '{{text}}', voice: '{{voiceName}}', lang: '{{lang}}' }, vars)
    reqBody = JSON.stringify(baseTmpl)
  }

  const res = await fetch(targetUrl, {
    method,
    headers,
    body: reqBody,
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} (${spec.name}): ${errText.slice(0, 240)}`)
  }
  const ctype = String(res.headers.get('content-type') || '').toLowerCase()
  const rawBuf = Buffer.from(await res.arrayBuffer())
  if (rawBuf.length < 32) {
    throw new Error(`自定义 TTS「${spec.name}」返回空音频数据`)
  }

  const tmpRawPath = `${absOutputPath}.raw${ctype.includes('mpeg') || spec.responseFormat === 'mp3' ? '.mp3' : '.bin'}`
  if (spec.responseType === 'json_base64' || (ctype.includes('application/json') && spec.responseType !== 'binary')) {
    const json = JSON.parse(rawBuf.toString('utf8'))
    if (spec.responseType === 'json_url' || (!spec.responseType && typeof getByDotPath(json, spec.responseAudioPath || 'url') === 'string' && /^https?:\/\//i.test(getByDotPath(json, spec.responseAudioPath || 'url')))) {
      const audioUrl = getByDotPath(json, spec.responseAudioPath || 'url') || json.url || json.audio_url
      if (!audioUrl) throw new Error(`未在 JSON 返回字段「${spec.responseAudioPath || 'url'}」找到音频链接`)
      const dl = await fetch(audioUrl, { signal: AbortSignal.timeout(120_000) })
      if (!dl.ok) throw new Error(`下载返回音频失败 HTTP ${dl.status}`)
      writeFileSync(tmpRawPath, Buffer.from(await dl.arrayBuffer()))
    } else {
      const b64Field =
        getByDotPath(json, spec.responseAudioPath || 'audio') ||
        json.audio ||
        json.audio_base64 ||
        json.data?.audio
      if (typeof b64Field !== 'string' || !b64Field.trim()) {
        throw new Error(`未在 JSON 返回字段「${spec.responseAudioPath || 'audio'}」找到 base64 音频`)
      }
      writeFileSync(tmpRawPath, Buffer.from(b64Field.replace(/^data:.*?;base64,/, ''), 'base64'))
    }
  } else {
    writeFileSync(tmpRawPath, rawBuf)
  }

  try {
    await normalizeOutputToPcmWav(tmpRawPath, absOutputPath)
  } finally {
    try { rmSync(tmpRawPath, { force: true }) } catch {}
  }
  return { ok: true, provider: `${spec.id}-http`, outputPath: absOutputPath }
}

async function synthesizeViaCustomCliTts(spec, vars, absOutputPath) {
  const cmd = String(spec.command || '').trim()
  if (!cmd) throw new Error(`自定义命令行配音模型「${spec.name}」未填写可执行命令 (command)。`)
  const outExt = String(spec.outputExt || '.wav').startsWith('.') ? spec.outputExt : `.${spec.outputExt || 'wav'}`
  const stagedOut = outExt.toLowerCase() === '.wav' ? absOutputPath : `${absOutputPath}${outExt}`
  const cmdVars = { ...vars, output: stagedOut }
  const args = splitCliArgsTemplate(spec.argsTemplate || '--text {{text}} --output {{output}}', cmdVars)
  const run = await runCommandRedirected(cmd, args, {
    cwd: spec.cwd && existsSync(spec.cwd) ? spec.cwd : REPO_ROOT,
    timeoutMs: 180_000,
  })
  if (run.code !== 0 || !existsSync(stagedOut) || statSync(stagedOut).size < 100) {
    throw new Error(`命令执行失败 (${cmd}): ${(run.stderr || run.stdout || `exit ${run.code}`).slice(0, 320)}`)
  }
  try {
    await normalizeOutputToPcmWav(stagedOut, absOutputPath)
  } finally {
    if (stagedOut !== absOutputPath) {
      try { rmSync(stagedOut, { force: true }) } catch {}
    }
  }
  return { ok: true, provider: `${spec.id}-cli`, outputPath: absOutputPath }
}

async function synthesizeViaMinimaxCloudTts(spec, text, speed = 1.0, emotion = '平静', absOutputPath = '') {
  const apiKey = String(spec.apiKey || process.env.MINIMAX_API_KEY || '').trim()
  if (!apiKey) throw new Error('MiniMax Speech 云端配音未填写 API Key，请在「AI 引擎中心 -> 配音引擎」中配置。')
  const endpoint = String(spec.endpoint || 'https://api.minimaxi.com/v1/t2a_v2').trim()
  const model = String(spec.model || 'speech-2.6-hd').trim()
  const voiceId = String(spec.voiceId || spec.voice || 'male-qn-qingse').trim()
  const emoMap = { 高兴: 'happy', 激昂: 'happy', 伤心: 'sad', 严肃: 'angry', 悬念低沉: 'fearful', 平静: 'neutral' }
  const emoVal = emoMap[emotion] || 'neutral'
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      text: String(text || ''),
      stream: false,
      voice_setting: {
        voice_id: voiceId,
        speed: Math.max(0.5, Math.min(2.0, Number(speed) || 1.0)),
        vol: 1.0,
        pitch: 0,
        ...(emoVal !== 'neutral' ? { emotion: emoVal } : {}),
      },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || (json?.base_resp?.status_code && json.base_resp.status_code !== 0)) {
    throw new Error(`MiniMax Speech 合成失败: ${json?.base_resp?.status_msg || json?.error?.message || `HTTP ${res.status}`}`)
  }
  const rawAudio = json?.data?.audio || json?.data?.audio_url || ''
  if (!rawAudio) throw new Error('MiniMax Speech 返回中未找到 audio 数据')
  const tmpRaw = `${absOutputPath}.minimax.mp3`
  if (/^https?:\/\//i.test(rawAudio)) {
    const dl = await fetch(rawAudio, { signal: AbortSignal.timeout(90_000) })
    if (!dl.ok) throw new Error(`下载 MiniMax 音频失败 HTTP ${dl.status}`)
    writeFileSync(tmpRaw, Buffer.from(await dl.arrayBuffer()))
  } else {
    writeFileSync(tmpRaw, Buffer.from(String(rawAudio), 'hex'))
  }
  try {
    await normalizeOutputToPcmWav(tmpRaw, absOutputPath)
  } finally {
    try { rmSync(tmpRaw, { force: true }) } catch {}
  }
  return { ok: true, provider: `minimax-tts (${model})`, outputPath: absOutputPath }
}

async function synthesizeViaDoubaoCloudTts(spec, text, speed = 1.0, absOutputPath = '') {
  const appId = String(spec.appId || process.env.DOUBAO_TTS_APPID || '').trim()
  const token = String(spec.token || process.env.DOUBAO_TTS_TOKEN || '').trim()
  if (!appId || !token) {
    throw new Error('火山方舟豆包语音 TTS 未填写 AppID 或 Token，请在「AI 引擎中心 -> 配音引擎」中配置。')
  }
  const endpoint = String(spec.endpoint || 'https://openspeech.bytedance.com/api/v1/tts').trim()
  const cluster = String(spec.cluster || 'volcano_tts').trim()
  const voiceType = String(spec.voiceType || spec.voice || 'zh_male_m392_conversation_wvae_bigtts').trim()
  const reqId = `dsh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer;${token}`,
    },
    body: JSON.stringify({
      app: { appid: appId, token, cluster },
      user: { uid: 'dsh-video-workbench' },
      audio: {
        voice_type: voiceType,
        encoding: 'mp3',
        speed_ratio: Math.max(0.8, Math.min(2.0, Number(speed) || 1.0)),
        volume_ratio: 1.0,
        pitch_ratio: 1.0,
      },
      request: {
        reqid: reqId,
        text: String(text || ''),
        text_type: 'plain',
        operation: 'query',
      },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || (json?.code !== undefined && Number(json.code) !== 3000 && Number(json.code) !== 0)) {
    throw new Error(`火山方舟豆包 TTS 合成失败: ${json?.message || json?.error || `code ${json?.code || res.status}`}`)
  }
  const b64 = String(json?.data || '').trim()
  if (!b64) throw new Error('火山方舟豆包 TTS 未返回音频 base64 数据')
  const tmpRaw = `${absOutputPath}.doubao.mp3`
  writeFileSync(tmpRaw, Buffer.from(b64, 'base64'))
  try {
    await normalizeOutputToPcmWav(tmpRaw, absOutputPath)
  } finally {
    try { rmSync(tmpRaw, { force: true }) } catch {}
  }
  return { ok: true, provider: `doubao-tts (${voiceType})`, outputPath: absOutputPath }
}

async function synthesizeViaWindowsSapi(text, speed = 1.0, gender = 'neutral', absOutputPath = '') {
  if (process.platform !== 'win32') {
    throw new Error('Windows SAPI 引擎仅在 Windows 系统可用')
  }
  const tmpDir = join(REPO_ROOT, '.tmp')
  mkdirSync(tmpDir, { recursive: true })
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const tmpTxt = join(tmpDir, `sapi-${stamp}.txt`)
  const tmpRawWav = join(tmpDir, `sapi-${stamp}.wav`)
  writeFileSync(tmpTxt, String(text || '').trim(), 'utf8')

  // System.Speech Rate range is -10..10 (roughly +-10% speed per step)
  const sapiRate = Math.max(-6, Math.min(6, Math.round((Number(speed || 1.0) - 1.0) * 14)))
  const psScript = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$voices = $s.GetInstalledVoices() | Where-Object { $_.Enabled }`,
    '$zh = $voices | Where-Object { $_.VoiceInfo.Culture.Name -like "zh*" } | Select-Object -First 1',
    'if ($zh) { $s.SelectVoice($zh.VoiceInfo.Name) }',
    `$s.Rate = ${sapiRate}`,
    '$s.Volume = 100',
    `$s.SetOutputToWaveFile('${tmpRawWav.replace(/'/g, "''")}')`,
    `$txt = [System.IO.File]::ReadAllText('${tmpTxt.replace(/'/g, "''")}', [System.Text.Encoding]::UTF8)`,
    '$s.Speak($txt)',
    '$s.Dispose()',
  ].join('; ')

  try {
    const run = await runCommandRedirected(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { cwd: tmpDir, timeoutMs: 60_000 },
    )
    if (run.code !== 0 || !existsSync(tmpRawWav) || statSync(tmpRawWav).size < 128) {
      throw new Error(`Windows 原生语音合成失败: ${(run.stderr || run.stdout || `exit ${run.code}`).slice(0, 300)}`)
    }
    await normalizeOutputToPcmWav(tmpRawWav, absOutputPath)
    return { ok: true, provider: 'windows-sapi-cpu', outputPath: absOutputPath }
  } finally {
    try { rmSync(tmpTxt, { force: true }) } catch {}
    try { rmSync(tmpRawWav, { force: true }) } catch {}
  }
}

/**
 * Core execution function for `generate_speech`.
 * Synthesizes WAV via IndexTTS-2.5, IndexTTS-2, GPT-SoVITS, or user-configured custom HTTP/OpenAI/CLI TTS engines,
 * measures exact duration via `ffprobe`, computes `durationInFrames = Math.ceil(durationSec * fps)`, and updates `script.json`.
 */
export async function executeGenerateSpeech(args = {}) {
  loadEnv()
  const {
    text,
    emotion = '平静',
    lang = '',
    durationFactor = 1.0,
    outputPath,
    fps = 30,
    engine: requestedEngine = '',
    voiceId = 'auto',
    scriptPath = '',
    sceneId = '',
    allowDirectPython = false,
  } = args

  if (!text || !String(text).trim()) {
    throw new Error('Parameter `text` is required for generate_speech.')
  }
  if (!outputPath || !String(outputPath).trim()) {
    throw new Error('Parameter `outputPath` is required for generate_speech.')
  }

  const engineSpec = resolveTtsEngineSpec(requestedEngine || getActiveTtsEngineId())
  const engine = engineSpec.id

  let projectMeta = {}
  let targetScene = { narration: text, emotion, voiceId }
  let resolvedScriptPath = ''

  if (scriptPath) {
    try {
      const loaded = readScriptJson(scriptPath)
      resolvedScriptPath = loaded.scriptPath
      projectMeta = loaded.data
      if (sceneId && Array.isArray(loaded.data.scenes)) {
        const found = loaded.data.scenes.find((s) => s.id === sceneId || String(s.index) === String(sceneId))
        if (found) targetScene = { ...found, narration: text, emotion: emotion || found.emotion }
      }
    } catch {}
  }

  // 1. Match or select voice from Voice Pack Catalog
  const { voices } = getVoiceCatalog()
  const matched = matchVoiceForScene(targetScene, projectMeta, voices, voiceId)
  const selectedVoice = matched.voice

  // 2. Resolve output WAV path
  const baseDir = resolvedScriptPath ? dirname(resolvedScriptPath) : REPO_ROOT
  const absOutputPath = isAbsolute(outputPath) ? outputPath : resolve(baseDir, outputPath)
  mkdirSync(dirname(absOutputPath), { recursive: true })

  // Reference audio selection
  let effectiveVoice = selectedVoice
  let refAudio = selectedVoice.resolvedRefPath || ''
  const fallbackRef = resolveEnvPath('DEFAULT_REF_AUDIO', '')
  if (!refAudio || !existsSync(refAudio) || refAudio.toLowerCase().endsWith('.pt')) {
    const siblingWav = ['.wav', '.mp3', '.flac']
      .map((audioExt) => (refAudio ? refAudio.replace(/\.pt$/i, audioExt) : ''))
      .find((cand) => cand && existsSync(cand))
    if (siblingWav) {
      refAudio = siblingWav
    } else {
      const wavMatch = findBestAvailableWavVoice(voices, selectedVoice)
      if (wavMatch?.resolvedRefPath) {
        effectiveVoice = wavMatch
        refAudio = wavMatch.resolvedRefPath
      } else {
        refAudio = fallbackRef || refAudio
      }
    }
  }

  const resolvedPromptText =
    effectiveVoice.promptText || (fallbackRef && refAudio === fallbackRef ? process.env.DEFAULT_REF_TEXT || '' : '')
  const allowPlaceholder =
    Boolean(args.allowPlaceholder) || String(process.env.TTS_ALLOW_PLACEHOLDER || '') === '1'
  const bridgeScript = resolvePackagePath('scripts', 'tts-bridge.py')
  const placeholderPythonBin = resolveEnvPath('INDEXTTS_PYTHON', '') || resolveEnvPath('GPTVOICE_PYTHON', '') || 'python'

  const displayNarration = normalizeNumeralsForDisplay(String(text).trim())
  const explicitTtsText = args.ttsText ? String(args.ttsText).trim() : ''
  const cachedTargetTts =
    targetScene?.ttsText && targetScene?.ttsNarrationRef === displayNarration
      ? String(targetScene.ttsText).trim()
      : ''
  // Pronunciation-only text (digits → Chinese spoken reading + breath pauses); NEVER shown on screen
  const spokenText = explicitTtsText || cachedTargetTts || toTtsText(displayNarration)

  const explicitSpeed = Number(args.speed)
  const explicitDurFactor = args.durationFactor !== undefined ? Number(args.durationFactor) : NaN
  const sceneSpeed = Number(targetScene?.speechRate)
  const effectiveSpeed =
    Number.isFinite(explicitSpeed) && explicitSpeed > 0
      ? Math.max(0.7, Math.min(1.4, explicitSpeed))
      : Number.isFinite(explicitDurFactor) && explicitDurFactor > 0
        ? Math.max(0.7, Math.min(1.4, 1 / explicitDurFactor))
        : Number.isFinite(sceneSpeed) && sceneSpeed > 0
          ? Math.max(0.7, Math.min(1.4, sceneSpeed))
          : 1.0
  const effectiveDurationFactor =
    Number.isFinite(explicitDurFactor) && explicitDurFactor > 0 && !(Number.isFinite(explicitSpeed) && explicitSpeed > 0)
      ? Math.max(0.7, Math.min(1.4, explicitDurFactor))
      : Number((1.0 / effectiveSpeed).toFixed(3))

  let providerInfo = {}

  if (engineSpec.kind === 'windows-sapi') {
    providerInfo = await synthesizeViaWindowsSapi(spokenText, effectiveSpeed, effectiveVoice.gender || 'neutral', absOutputPath)
  } else if (engineSpec.kind === 'minimax-tts') {
    providerInfo = await synthesizeViaMinimaxCloudTts(engineSpec, spokenText, effectiveSpeed, emotion, absOutputPath)
  } else if (engineSpec.kind === 'doubao-tts') {
    providerInfo = await synthesizeViaDoubaoCloudTts(engineSpec, spokenText, effectiveSpeed, absOutputPath)
  } else if (engineSpec.kind === 'openai-tts' || engineSpec.kind === 'http-json' || engineSpec.kind === 'cli-command') {
    const customVars = {
      text: spokenText,
      emotion: String(emotion || '平静'),
      lang: String(lang || 'zh'),
      speed: Number((effectiveSpeed * (Number(engineSpec.speed) || 1.0)).toFixed(3)) || 1.0,
      voiceId: String(effectiveVoice.id || voiceId || 'default'),
      voice: String(engineSpec.voice || engineSpec.defaultVoice || effectiveVoice.name || 'default'),
      voiceName: String(effectiveVoice.name || engineSpec.voice || 'default'),
      model: String(engineSpec.model || ''),
      refAudio: refAudio || '',
      promptText: resolvedPromptText || '',
    }
    try {
      providerInfo =
        engineSpec.kind === 'cli-command'
          ? await synthesizeViaCustomCliTts(engineSpec, customVars, absOutputPath)
          : await synthesizeViaCustomHttpTts(engineSpec, customVars, absOutputPath)
    } catch (customErr) {
      if (!allowPlaceholder) {
        throw customErr
      }
      const fbRes = await runCommandRedirected(
        placeholderPythonBin,
        [
          bridgeScript,
          '--engine', 'fallback',
          '--text', spokenText,
          '--output', absOutputPath,
          '--emotion', emotion,
          '--voice-id', effectiveVoice.id,
        ],
        { timeoutMs: 60_000 },
      )
      if (fbRes.code !== 0 || !existsSync(absOutputPath)) throw customErr
      providerInfo = { ok: true, provider: 'acoustic-cadence-synth', placeholder: true }
    }
  } else {
    // 3. Built-in IndexTTS-2.5 / IndexTTS-2 / GPT-SoVITS bridge path
    const pythonBin =
      engineSpec.kind === 'gptvoice'
        ? engineSpec.pythonBin || resolveEnvPath('GPTVOICE_PYTHON', '') || resolveEnvPath('INDEXTTS_PYTHON', '') || 'python'
        : engineSpec.pythonBin || resolveEnvPath('INDEXTTS_PYTHON', '') || 'python'

    const endpoint =
      engineSpec.kind === 'gptvoice'
        ? engineSpec.endpoint || process.env.GPTVOICE_ENDPOINT || 'http://127.0.0.1:9881'
        : engineSpec.endpoint || process.env.INDEXTTS_ENDPOINT || 'http://127.0.0.1:9880'

    const engineRoot =
      engineSpec.kind === 'gptvoice'
        ? engineSpec.rootDir || resolveEnvPath('GPTVOICE_ROOT', '')
        : engineSpec.rootDir || resolveEnvPath('INDEXTTS_ROOT', '')

    // Zero-friction fresh-install guard: auto-create <engineRoot>/voices/ and seed a default speaker WAV if none exist
    if (!refAudio || !existsSync(refAudio)) {
      try {
        const seeded = await ensureDefaultReferenceVoices({
          idxRoot: engineSpec.kind === 'gptvoice' ? '' : engineRoot,
          gptRoot: engineSpec.kind === 'gptvoice' ? engineRoot : '',
        })
        if (seeded?.refPath && existsSync(seeded.refPath)) {
          refAudio = seeded.refPath
        }
      } catch {}
    }

    // Ensure / reuse persistent server for IndexTTS-2.5/2 (or check/start GPT-SoVITS if root configured)
    if (engineSpec.kind !== 'gptvoice' && !allowPlaceholder) {
      await ensureTtsServer({ engineId: engineSpec.id })
    } else if (engineSpec.kind === 'gptvoice' && !allowPlaceholder) {
      const h = await getTtsServerHealth(2500, 'gptvoice')
      if (!h.reachable) {
        await ensureTtsServer({ waitMs: 90_000, engineId: 'gptvoice' })
      }
    } else if (engineSpec.kind !== 'gptvoice') {
      try {
        const h = await getTtsServerHealth(2500, engineSpec.id)
        if (!h.ready) await ensureTtsServer({ waitMs: 5_000, engineId: engineSpec.id }).catch(() => {})
      } catch {}
    }

    const effectiveLang = String(lang || (engineSpec.kind === 'gptvoice' ? engineSpec.textLang || 'zh' : '')).trim()

    const bridgeArgs = [
      bridgeScript,
      '--engine', engineSpec.kind,
      '--text', spokenText,
      '--output', absOutputPath,
      '--emotion', emotion,
      '--lang', effectiveLang,
      '--duration-factor', String(effectiveDurationFactor),
      '--speed', String(effectiveSpeed.toFixed(3)),
      '--voice-id', effectiveVoice.id,
      '--ref-audio', refAudio,
      '--emo-audio', matched.emotionAudio || '',
      '--prompt-text', resolvedPromptText,
      '--endpoint', endpoint,
      '--engine-root', engineRoot,
      '--fallback-ref', fallbackRef || refAudio || '',
    ]
    if (allowDirectPython) {
      bridgeArgs.push('--allow-direct-python')
    }
    if (allowPlaceholder) {
      bridgeArgs.push('--allow-placeholder')
    }

    const synthResult = await runCommandRedirected(pythonBin, bridgeArgs, {
      timeoutMs: 420_000,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    })
    if (synthResult.code !== 0 || !existsSync(absOutputPath)) {
      let msg = synthResult.stderr || synthResult.stdout
      try {
        msg = JSON.parse(synthResult.stdout.trim().split(/\r?\n/).pop()).error || msg
      } catch {}
      throw new Error(`TTS synthesis failed: ${msg}`)
    }

    try {
      const lastLine = synthResult.stdout.trim().split(/\r?\n/).pop()
      providerInfo = JSON.parse(lastLine)
    } catch {}
  }

  // 4. Probe exact duration via `ffprobe` (strictly forbidden to guess duration)
  const safeFps = Number(fps) > 0 ? Number(fps) : Number(projectMeta.fps) || 30
  const probe = await probeAudioDuration(absOutputPath, safeFps)

  // 5. Write back exact durationSec, durationInFrames, voiceId, and subtitle timestamps into `script.json`
  let scriptUpdated = false
  if (resolvedScriptPath && existsSync(resolvedScriptPath)) {
    const { data, projectDir } = readScriptJson(resolvedScriptPath)
    const relAudio = relative(projectDir, absOutputPath).replace(/\\/g, '/')
    if (Array.isArray(data.scenes)) {
      let updatedAny = false
      const subtitleMaxW =
        Number(data.width) < Number(data.height) ? 11 : Number(data.width) === Number(data.height) ? 13 : 16
      data.scenes = await Promise.all(
        data.scenes.map(async (scene) => {
          const isTarget =
            (sceneId && (scene.id === sceneId || String(scene.index) === String(sceneId))) ||
            (!sceneId && scene.audioFile && resolve(projectDir, scene.audioFile) === absOutputPath)
          if (!isTarget) return scene
          updatedAny = true
          // Scene length = lead-in + MEASURED voice duration + tail (never guessed)
          const leadSec = Number.isFinite(Number(scene.voiceLeadSec)) ? Number(scene.voiceLeadSec) : 0.35
          const tailSec = Number.isFinite(Number(scene.tailSec)) ? Number(scene.tailSec) : 0.65
          const sceneDurationSec = Number((leadSec + probe.durationSec + tailSec).toFixed(4))
          const cleanNarration = displayNarration
          // Chunks cut from an older narration (the user edited the text since the last dub) are stale: re-derive the
          // subtitle lines from the narration being dubbed, so the new words — not the old ones — reach the screen
          const subs = await alignSubtitlesToSpeechAudio({
            audioPath: absOutputPath,
            narration: cleanNarration,
            subtitleText: scene.subtitleText,
            subChunks: subChunksMatchNarration(scene.subChunks, cleanNarration) ? scene.subChunks : null,
            leadSec,
            durationSec: probe.durationSec,
            fps: safeFps,
            maxLineWidth: subtitleMaxW,
          })
          const finalSubs =
            subs.length > 0
              ? subs
              : buildSentenceSubtitles(cleanNarration, probe.durationSec, safeFps, {
                  maxLineWidth: subtitleMaxW,
                }).map((s) => ({
                  ...s,
                  startSec: Number((s.startSec + leadSec).toFixed(3)),
                  endSec: Number((s.endSec + leadSec).toFixed(3)),
                  startFrame: Math.floor((s.startSec + leadSec) * safeFps),
                  endFrame: Math.ceil((s.endSec + leadSec) * safeFps),
                }))
          return {
            ...scene,
            narration: cleanNarration,
            ttsText: spokenText,
            ttsNarrationRef: cleanNarration,
            subtitleText: finalSubs.map((s) => s.text).join(' '),
            subChunks: finalSubs.map((s) => s.text),
            emotion,
            speechRate: Number(effectiveSpeed.toFixed(2)),
            voiceId: effectiveVoice.id,
            voiceName: effectiveVoice.name,
            voiceRefAudio: refAudio,
            voiceMatchReason:
              effectiveVoice.id !== selectedVoice.id
                ? `${matched.reason} -> 实际合成音色: [${effectiveVoice.category}] ${effectiveVoice.name}`
                : matched.reason,
            audioFile: relAudio,
            voiceLeadSec: leadSec,
            tailSec,
            voiceDurationSec: probe.durationSec,
            voiceProvider: providerInfo.provider || engine,
            voicePlaceholder: Boolean(providerInfo.placeholder),
            durationSec: sceneDurationSec,
            durationInFrames: Math.max(1, Math.ceil(sceneDurationSec * safeFps)),
            subtitles: finalSubs,
          }
        }),
      )
      if (updatedAny) {
        writeScriptJson(resolvedScriptPath, data)
        scriptUpdated = true
      }
    }
  }

  return {
    ok: true,
    engine,
    provider: providerInfo.provider || engine,
    placeholder: Boolean(providerInfo.placeholder),
    outputPath: absOutputPath,
    audioPath: absOutputPath,
    durationSec: probe.durationSec,
    durationInFrames: probe.durationInFrames,
    fps: safeFps,
    voiceId: effectiveVoice.id,
    voiceName: effectiveVoice.name,
    voiceUsed: effectiveVoice.name,
    voiceRefAudio: refAudio,
    voiceMatchMode: matched.mode,
    voiceMatchReason:
      effectiveVoice.id !== selectedVoice.id
        ? `${matched.reason} -> 实际合成音色: [${effectiveVoice.category}] ${effectiveVoice.name}`
        : matched.reason,
    scriptUpdated,
    scriptPath: resolvedScriptPath || null,
  }
}

export const name = 'dsh-tool-local-tts'
export const inject = ['tools']

export function apply(ctx) {
  // Tool 1: list_voices
  ctx.tools.register({
    name: 'list_voices',
    description:
      'List all available TTS voices and imported voice packs (IndexTTS-2.5 & GPTvoice-tts), including gender, style tags, supported emotions, and availability.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional filter by category folder (e.g. 热门音色, 中年-男声, 孩童, 老年, IndexTTS-2.5 内置)',
        },
        ageGroup: {
          type: 'string',
          description: 'Optional filter by age group: child | youth | adult | middle-aged | elderly',
        },
        gender: {
          type: 'string',
          description: 'Optional filter by gender: male | female | neutral',
        },
        tag: {
          type: 'string',
          description: 'Optional filter by style tag or keyword (e.g. 纪录片, 短视频, 温柔, 沧桑, 女主播, 评书)',
        },
        limit: {
          type: 'number',
          description: 'Optional maximum number of voice items to return (defaults to 50).',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
      },
    },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    async execute(args = {}) {
      const { voices, categories, emotionReferences, catalogPath } = getVoiceCatalog()
      let filtered = voices
      if (args.category) {
        const catKw = String(args.category).toLowerCase()
        filtered = filtered.filter((v) => String(v.category || '').toLowerCase().includes(catKw))
      }
      if (args.ageGroup) {
        filtered = filtered.filter((v) => v.ageGroup === args.ageGroup)
      }
      if (args.gender) {
        filtered = filtered.filter((v) => v.gender === args.gender)
      }
      if (args.tag) {
        const kw = String(args.tag).toLowerCase()
        filtered = filtered.filter(
          (v) =>
            v.name.toLowerCase().includes(kw) ||
            String(v.category || '').toLowerCase().includes(kw) ||
            (v.tags || []).some((t) => String(t).toLowerCase().includes(kw)),
        )
      }
      const maxItems = Number(args.limit) > 0 ? Number(args.limit) : 50
      return {
        totalCatalogVoices: voices.length,
        matchedCount: filtered.length,
        categories,
        voices: filtered.slice(0, maxItems),
        availableEmotions: Object.keys(emotionReferences),
        catalogPath,
      }
    },
  })

  // Tool 2: import_voice_pack
  ctx.tools.register({
    name: 'import_voice_pack',
    description:
      'Import a custom voice pack (.wav, .mp3, .flac, .pt file, directory, or .zip archive with manifest.json/voices.json) into the local Voice Pack Catalog so AI can auto-match it or the user can select it.',
    parameters: {
      type: 'object',
      properties: {
        sourcePath: {
          type: 'string',
          description: 'Path to the .wav/.mp3/.pt audio file, voice pack directory, or .zip archive.',
        },
        id: {
          type: 'string',
          description: 'Optional unique voice ID (e.g. my-narrator-voice).',
        },
        name: {
          type: 'string',
          description: 'Display name of the voice or voice pack (e.g. 浑厚纪录片男声).',
        },
        gender: {
          type: 'string',
          enum: ['male', 'female', 'neutral'],
          description: 'Voice gender for AI role/character matching.',
        },
        engine: {
          type: 'string',
          description: 'Target TTS engine ID for this voice (e.g. indextts25, indextts2, gptvoice, or custom engine ID).',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Style & domain tags used by AI auto-matching (e.g. ["纪录片", "深沉", "历史"]).',
        },
        promptText: {
          type: 'string',
          description: 'Reference transcript corresponding to the reference audio clip.',
        },
      },
      required: ['sourcePath'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
      },
    },
    timeoutMs: 60_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await importVoicePack(args)
    },
  })

  // Tool 3: match_scene_voices
  ctx.tools.register({
    name: 'match_scene_voices',
    description:
      'Automatically match suitable voices from the Voice Pack Catalog for all scenes in `script.json` based on scene emotion, role, narration, and audience/goal, or lock a user-specified voice ID.',
    parameters: {
      type: 'object',
      properties: {
        scriptPath: {
          type: 'string',
          description: 'Path to project directory or script.json.',
        },
        voiceId: {
          type: 'string',
          description: 'Pass "auto" for AI automatic voice matching, or a specific voiceId to lock that voice.',
        },
        forceAuto: {
          type: 'boolean',
          description: 'If true, re-run AI voice matching even on previously locked scenes.',
        },
      },
      required: ['scriptPath'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
      },
    },
    timeoutMs: 30_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return matchAllScenesInScript(args.scriptPath, {
        voiceId: args.voiceId || 'auto',
        forceAuto: Boolean(args.forceAuto),
      })
    },
  })

  // Tool 4: generate_speech
  ctx.tools.register({
    name: 'generate_speech',
    description:
      'Synthesize speech audio (WAV) using active or selected TTS engine (IndexTTS-2.5, IndexTTS-2, GPT-SoVITS/gptvoice, or custom imported OpenAI/HTTP/CLI TTS model), measure exact duration via `ffprobe`, compute `durationInFrames = Math.ceil(durationSec * fps)`, and write back to `script.json`.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Narration text to synthesize into speech.',
        },
        emotion: {
          type: 'string',
          description: 'Emotion label or description (e.g. 平静, 高兴, 伤心, 生气, 害怕, 激昂).',
        },
        lang: {
          type: 'string',
          description: 'Optional language code (zh, en, ja, es, ar; auto-detected when omitted).',
        },
        durationFactor: {
          type: 'number',
          description: 'Optional speech duration multiplier for IndexTTS-2.5 (<1.0 faster, >1.0 slower).',
        },
        speed: {
          type: 'number',
          description: 'Optional speaking rate (0.7 to 1.4, default 1.0; >1.0 speaks faster). Automatically mapped per TTS engine.',
        },
        outputPath: {
          type: 'string',
          description: 'Output WAV file path (e.g. ./audio/scene-01.wav).',
        },
        fps: {
          type: 'number',
          description: 'Video frame rate (e.g. 30 or 60) used to calculate durationInFrames.',
        },
        voiceId: {
          type: 'string',
          description: 'Voice ID from `list_voices`, or "auto" to let AI match the best voice for the scene.',
        },
        engine: {
          type: 'string',
          description: 'TTS engine ID (e.g. indextts25, indextts2, gptvoice, or custom engine ID; defaults to active engine config).',
        },
        scriptPath: {
          type: 'string',
          description: 'Optional path to `script.json` (or project root) to automatically backfill durationSec & durationInFrames.',
        },
        sceneId: {
          type: 'string',
          description: 'Optional scene ID in `script.json` (e.g. "scene-01") to backfill.',
        },
      },
      required: ['text', 'outputPath'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
      },
    },
    timeoutMs: 180_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await executeGenerateSpeech(args)
    },
  })

  // Tool 5: configure_tts_engine
  ctx.tools.register({
    name: 'configure_tts_engine',
    description:
      'Inspect, switch, or add custom TTS engines (IndexTTS-2.5, IndexTTS-2, GPT-SoVITS/gptvoice, OpenAI /v1/audio/speech, custom HTTP JSON, or local CPU CLI such as edge-tts).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'select', 'add', 'remove'],
          description: 'Operation to perform (defaults to get).',
        },
        activeEngineId: {
          type: 'string',
          description: 'Engine ID to activate when action is select.',
        },
        engineSpec: {
          type: 'object',
          description: 'Custom engine specification when action is add (id, name, kind, endpoint/command/argsTemplate/payloadTemplate).',
          additionalProperties: true,
        },
        removeId: {
          type: 'string',
          description: 'Custom engine ID to remove when action is remove.',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
      },
    },
    timeoutMs: 15_000,
    isConcurrencySafe: () => false,
    async execute(args = {}) {
      const act = String(args.action || 'get').toLowerCase()
      if (act === 'select' && args.activeEngineId) {
        setActiveTtsEngine(args.activeEngineId)
      } else if (act === 'add' && args.engineSpec) {
        addOrUpdateCustomTtsEngine(args.engineSpec)
      } else if (act === 'remove' && args.removeId) {
        removeCustomTtsEngine(args.removeId)
      }
      return { ok: true, ttsConfig: getSafeTtsConfigSummary() }
    },
  })
}

export default { name, inject, apply }
