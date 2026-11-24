/**
 * @dsh-video/tool-media — Optional BYOK Cloud AI Media Generation Hub (Image · Video · Music/Audio + Open Custom HTTP Protocol)
 * Copyright (c) 2026 Merziller (QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com)
 *
 * 100% Optional BYOK connectors:
 *   - Image : Volcengine 即梦 Seedream · OpenAI/Flux Compatible · BFL Flux Pro · Fal.ai Flux · Kling Image · Custom HTTP Protocol
 *   - Video : Volcengine 方舟 Seedance/即梦 · Kling 可灵 (JWT/Bearer) · MiniMax 海螺 Hailuo · OpenAI/Runway/Luma · Custom HTTP Protocol
 *   - Audio : Suno Music API (v4/v4.5/v5) · MiniMax Music (music-2.0/1.5) · MiniMax Speech (speech-02-hd) · ElevenLabs SFX · Custom HTTP Protocol
 */
import { createHash, createHmac } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createAbortError, loadEnv, probeAudioDuration, readScriptJson, REPO_ROOT, writeScriptJson } from '../shared/index.js'
import { readAssets, writeAssets } from './asset-manager.js'
import { analyzeAudioBeatStructure } from './beat-analyzer.js'
import { buildCharacterPromptContext, loadReferenceImagePayloads } from './character-bank.js'
import {
  CloudBudgetExceededError,
  classifyCloudError,
  computeCloudParamsHash,
  createLedgerJob,
  decideLedgerAction,
  findLatestLedgerJob,
  isBillingError,
  isProcessAlive,
  LEDGER_STATUS,
  ledgerResultExists,
  readCloudLedger,
  relToLedgerRoot,
  resolveLedgerRoot,
  resolveMaxPaidJobsPerRun,
  toBillingError,
  updateLedgerJob,
} from './cloud-ledger.js'
import { CLOUD_MEDIA_CONFIG_FILENAME, getCloudMediaConfigPath } from './cloud-config-file.js'
import { callLlmChat, extractJsonFromLlmText } from './llm-client.js'
import { isSceneLocked } from './scene-locks.js'
import { applyStockKeyPatch, getStockKeySummary, getStockMediaConfig, importStockMedia, searchStockMedia } from './stock-media.js'

export {
  CloudBillingError,
  CloudBudgetExceededError,
  classifyCloudError,
  createPaidJobBudget,
  getCloudLedgerPath,
  isBillingError,
  listCloudJobs,
  resolveMaxPaidJobsPerRun,
  toBillingError,
} from './cloud-ledger.js'

const CONFIG_FILENAME = CLOUD_MEDIA_CONFIG_FILENAME

export const CLOUD_MEDIA_PRESETS = {
  image: [
    {
      id: 'volcengine-seedream',
      name: '火山方舟 · 即梦 Seedream（生图）',
      protocol: 'openai-image',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      endpoint: '/images/generations',
      defaultModel: 'doubao-seedream-3-0-t2i-250415',
      authType: 'bearer',
      docsHint: '填写火山方舟 ARK_API_KEY 与模型/接入点 ID',
      referenceImages: '角色多图参考（需 Seedream 4.0+ 模型，如 doubao-seedream-4-0-250828）',
    },
    {
      id: 'openai-image',
      name: 'OpenAI / Flux / 硅基流动 / OneAPI 兼容生图',
      protocol: 'openai-image',
      baseUrl: 'https://api.openai.com/v1',
      endpoint: '/images/generations',
      defaultModel: 'gpt-image-1',
      authType: 'bearer',
      docsHint: '兼容所有 /v1/images/generations 协议（GPT Image 1、Flux.1、SiliconFlow、NewAPI 等）',
    },
    {
      id: 'bfl-flux',
      name: 'Black Forest Labs · Flux Pro（生图）',
      protocol: 'bfl-flux',
      baseUrl: 'https://api.bfl.ai',
      endpoint: '/v1/flux-pro-1.1',
      defaultModel: 'flux-pro-1.1',
      authType: 'x-key',
      docsHint: '使用官方 x-key 异步提交与轮询 /v1/get_result',
      referenceImages: '单图 image_prompt 参考（Kontext 端点使用 input_image）',
    },
    {
      id: 'fal-flux',
      name: 'Fal.ai · Flux Schnell / Pro（极速生图）',
      protocol: 'fal-image',
      baseUrl: 'https://fal.run',
      endpoint: '/fal-ai/flux/schnell',
      defaultModel: 'fal-ai/flux/schnell',
      authType: 'fal-key',
      docsHint: 'Header 自动携带 Authorization: Key <FAL_KEY>',
    },
    {
      id: 'kling-image',
      name: '可灵 Kling AI（生图）',
      protocol: 'kling-image',
      baseUrl: 'https://api.klingai.com',
      endpoint: '/v1/images/generations',
      defaultModel: 'kling-v2',
      authType: 'kling-jwt-or-bearer',
      docsHint: '支持直接填 Bearer Token，或填 "AK:SK" 自动生成 HS256 JWT',
      referenceImages: '单图主体/人脸参考（image + image_reference）',
    },
    {
      id: 'custom-image',
      name: '自定义云端生图接口（Custom HTTP JSON 协议）',
      protocol: 'custom',
      baseUrl: '',
      endpoint: '',
      defaultModel: 'custom-image-model',
      authType: 'custom',
      docsHint: '自由填写提交 URL、Headers、JSON 请求模板（支持 {{prompt}} / {{model}} / {{aspectRatio}}）与响应/轮询路径',
      referenceImages: '在 JSON 模板中使用 {{referenceImagesJson}}（图片 dataURI 数组）或 {{referenceImage}} 即可携带角色参考图',
    },
  ],
  video: [
    {
      id: 'volcengine-seedance',
      name: '火山方舟 · Seedance 2.5 / 即梦视频',
      protocol: 'volcengine-seedance',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      endpoint: '/contents/generations/tasks',
      defaultModel: 'doubao-seedance-2-5-260628',
      authType: 'bearer',
      docsHint: '标准火山方舟异步任务 /contents/generations/tasks + 轮询提取 content.video_url',
      referenceImages: '参考图生视频（i2v/ref 模型或 extraParams.supportsReferenceImages=true）',
    },
    {
      id: 'kling-video',
      name: '可灵 Kling AI（文生/图生视频）',
      protocol: 'kling-video',
      baseUrl: 'https://api.klingai.com',
      endpoint: '/v1/videos/text2video',
      defaultModel: 'kling-v2-6',
      authType: 'kling-jwt-or-bearer',
      docsHint: '支持 Bearer Token 或 "AccessKey:SecretKey" 自动 HS256 JWT 签发',
    },
    {
      id: 'minimax-hailuo',
      name: 'MiniMax · 海螺视频 Hailuo',
      protocol: 'minimax-hailuo',
      baseUrl: 'https://api.minimaxi.com',
      endpoint: '/v1/video_generation',
      defaultModel: 'MiniMax-Hailuo-02',
      authType: 'bearer',
      docsHint: '国内填 https://api.minimaxi.com，海外填 https://api.minimax.io',
      referenceImages: '主体参考（S2V-01 模型）',
    },
    {
      id: 'openai-video',
      name: 'OpenAI Sora / Runway / 兼容视频接口',
      protocol: 'openai-video',
      baseUrl: 'https://api.openai.com/v1',
      endpoint: '/videos/generations',
      defaultModel: 'sora-2',
      authType: 'bearer',
      docsHint: '兼容中转站 /v1/videos/generations 同步或异步任务接口',
    },
    {
      id: 'custom-video',
      name: '自定义云端生视频接口（Custom HTTP JSON 协议）',
      protocol: 'custom',
      baseUrl: '',
      endpoint: '',
      defaultModel: 'custom-video-model',
      authType: 'custom',
      docsHint: '自由配置提交 URL、轮询 URL ({{taskId}})、状态路径与视频 URL 提取路径，兼容任意新模型',
      referenceImages: '在 JSON 模板中使用 {{referenceImagesJson}} / {{referenceImage}} 携带角色参考图',
    },
  ],
  audio: [
    {
      id: 'suno-music',
      name: 'Suno Music API（AI 完整编曲/人声歌曲）',
      protocol: 'suno-music',
      baseUrl: 'https://api.sunoapi.org',
      endpoint: '/suno/submit/music',
      defaultModel: 'chirp-v4-5',
      authType: 'bearer',
      docsHint: '兼容主流 Suno API / NewAPI / GoAPI（支持纯音乐 instrumental、歌词 lyrics、风格标签 tags）',
    },
    {
      id: 'minimax-music',
      name: 'MiniMax 音乐大模型（Music 3 / 2.5 / 2.0，支持自定义模型 ID）',
      protocol: 'minimax-music',
      baseUrl: 'https://api.minimaxi.com',
      endpoint: '/v1/music_generation',
      defaultModel: 'music-3.0',
      authType: 'bearer',
      docsHint: '默认支持最新 MiniMax Music 3 (music-3.0)，可在下方「Model 模型名」自由改写任意版本号；国内 api.minimaxi.com / 海外 api.minimax.io',
    },
    {
      id: 'minimax-speech',
      name: 'MiniMax Speech 云端语音（Speech-2.6 / 02-HD）',
      protocol: 'minimax-speech',
      baseUrl: 'https://api.minimaxi.com',
      endpoint: '/v1/t2a_v2',
      defaultModel: 'speech-2.6-hd',
      authType: 'bearer',
      docsHint: 'MiniMax 高表现力云端语音/旁白生成，支持自定义模型 ID 与多情绪控制',
    },
    {
      id: 'volcengine-doubao-tts',
      name: '火山方舟 · 豆包语音大模型 TTS（支持自定义音色）',
      protocol: 'volcengine-doubao-tts',
      baseUrl: 'https://openspeech.bytedance.com',
      endpoint: '/api/v1/tts',
      defaultModel: 'zh_male_m392_conversation_wvae_bigtts',
      authType: 'doubao-appid-token',
      docsHint: 'API Key 填 "AppID:Token"（或在配音引擎面板分栏填写），Model 栏填 voice_type 音色代号',
    },
    {
      id: 'elevenlabs-sfx',
      name: 'ElevenLabs · AI 音效与配音（Sound Generation）',
      protocol: 'elevenlabs-sfx',
      baseUrl: 'https://api.elevenlabs.io',
      endpoint: '/v1/sound-generation',
      defaultModel: 'eleven_sound_v2',
      authType: 'xi-api-key',
      docsHint: 'Header 自动使用 xi-api-key，直接返回高质量 MP3 音效',
    },
    {
      id: 'custom-audio',
      name: '自定义云端音频/音乐接口（Custom HTTP JSON 协议）',
      protocol: 'custom',
      baseUrl: '',
      endpoint: '',
      defaultModel: 'custom-audio-model',
      authType: 'custom',
      docsHint: '自由接入 Udio / Mureka / 豆包音乐 / 任意自建音频 API（支持 url/base64/hex/binary 与异步轮询）',
    },
  ],
}

// `<workspace root>/.dsh-video-cloud-media.json` (CONFIG_FILENAME); DSH_VIDEO_CLOUD_MEDIA_CONFIG redirects it (tests)
function getConfigPath() {
  return getCloudMediaConfigPath()
}

function createDefaultCategoryConfig(category) {
  const first = CLOUD_MEDIA_PRESETS[category][0]
  return {
    enabled: false,
    providerId: first.id,
    protocol: first.protocol,
    baseUrl: first.baseUrl,
    endpoint: first.endpoint,
    model: first.defaultModel,
    apiKey: '',
    extraParams: {},
    custom: {
      submitUrl: '',
      method: 'POST',
      headersJson: '{\n  "Content-Type": "application/json",\n  "Authorization": "Bearer {{apiKey}}"\n}',
      bodyTemplateJson:
        category === 'audio'
          ? '{\n  "model": "{{model}}",\n  "prompt": "{{prompt}}",\n  "lyrics": "{{lyrics}}",\n  "instrumental": {{instrumental}}\n}'
          : category === 'video'
            ? '{\n  "model": "{{model}}",\n  "prompt": "{{prompt}}",\n  "duration": {{duration}},\n  "aspect_ratio": "{{aspectRatio}}"\n}'
            : '{\n  "model": "{{model}}",\n  "prompt": "{{prompt}}",\n  "size": "1536x1024"\n}',
      mode: category === 'image' ? 'sync' : 'async-poll',
      taskIdPath: 'data.task_id',
      pollUrlTemplate: '',
      pollMethod: 'GET',
      statusPath: 'data.status',
      successValues: 'succeeded,completed,done,SUCCESS,2',
      failValues: 'failed,error,FAILED,cancelled',
      resultUrlPath: category === 'audio' ? 'data.audio' : category === 'video' ? 'data.video_url' : 'data.0.url',
      resultFormat: 'url',
    },
  }
}

export function loadCloudMediaConfig() {
  loadEnv()
  const defaults = {
    image: createDefaultCategoryConfig('image'),
    video: createDefaultCategoryConfig('video'),
    audio: createDefaultCategoryConfig('audio'),
    autoUseCloudBroll: false,
    // free stock libraries (Pexels / Pixabay) — saved from the Studio, override .env PEXELS_API_KEY / PIXABAY_API_KEY
    stock: applyStockKeyPatch({}),
    updatedAt: '',
  }
  const p = getConfigPath()
  if (existsSync(p)) {
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8'))
      for (const cat of ['image', 'video', 'audio']) {
        if (parsed?.[cat] && typeof parsed[cat] === 'object') {
          defaults[cat] = {
            ...defaults[cat],
            ...parsed[cat],
            custom: { ...defaults[cat].custom, ...(parsed[cat].custom || {}) },
          }
        }
      }
      if (typeof parsed?.autoUseCloudBroll === 'boolean') defaults.autoUseCloudBroll = parsed.autoUseCloudBroll
      if (parsed?.stock && typeof parsed.stock === 'object') defaults.stock = applyStockKeyPatch(parsed.stock)
      if (parsed?.updatedAt) defaults.updatedAt = parsed.updatedAt
    } catch {}
  }
  return defaults
}

function maskKey(k = '') {
  const s = String(k || '').trim()
  if (!s) return ''
  if (s.length <= 8) return '***'
  return `${s.slice(0, 4)}***${s.slice(-4)}`
}

export function getCloudMediaConfigSummary() {
  const cfg = loadCloudMediaConfig()
  const masked = {
    autoUseCloudBroll: cfg.autoUseCloudBroll,
    updatedAt: cfg.updatedAt,
    presets: CLOUD_MEDIA_PRESETS,
  }
  for (const cat of ['image', 'video', 'audio']) {
    const item = cfg[cat]
    masked[cat] = {
      ...item,
      apiKey: '',
      hasApiKey: Boolean(String(item.apiKey || '').trim()),
      apiKeyMasked: maskKey(item.apiKey),
    }
  }
  // { pexels, pixabay: { configured, source 'saved'|'env'|'', sourceLabel, hasSavedKey, hasEnvKey, savedKeyMasked, … } }
  masked.stock = getStockKeySummary(cfg.stock)
  return masked
}

export function saveCloudMediaConfig(patch = {}) {
  const cur = loadCloudMediaConfig()
  for (const cat of ['image', 'video', 'audio']) {
    const incoming = patch?.[cat]
    if (!incoming || typeof incoming !== 'object') continue
    const preset = CLOUD_MEDIA_PRESETS[cat].find((p) => p.id === incoming.providerId) || null
    const nextKey =
      incoming.clearApiKey === true
        ? ''
        : typeof incoming.apiKey === 'string' && incoming.apiKey.trim() && !incoming.apiKey.includes('***')
          ? incoming.apiKey.trim()
          : cur[cat].apiKey
    cur[cat] = {
      ...cur[cat],
      ...incoming,
      protocol: String(incoming.protocol || preset?.protocol || cur[cat].protocol || 'custom'),
      apiKey: nextKey,
      custom: {
        ...cur[cat].custom,
        ...(incoming.custom && typeof incoming.custom === 'object' ? incoming.custom : {}),
      },
    }
    delete cur[cat].clearApiKey
    delete cur[cat].hasApiKey
    delete cur[cat].apiKeyMasked
  }
  if (typeof patch?.autoUseCloudBroll === 'boolean') {
    cur.autoUseCloudBroll = patch.autoUseCloudBroll
  }
  // { stock: { pexelsApiKey?, pixabayApiKey?, clearPexels?, clearPixabay? } } — untouched / KEEP_EXISTING / masked keep
  if (patch?.stock && typeof patch.stock === 'object' && !Array.isArray(patch.stock)) {
    cur.stock = applyStockKeyPatch(cur.stock, patch.stock)
  }
  cur.updatedAt = new Date().toISOString()
  const cfgPath = getConfigPath()
  mkdirSync(dirname(cfgPath), { recursive: true })
  writeFileSync(cfgPath, JSON.stringify(cur, null, 2) + '\n', 'utf8')
  return getCloudMediaConfigSummary()
}

/**
 * Resolve dotted / bracketed JSON path (e.g. "data.task_result.videos.0.url" or "data[0].url").
 */
export function getByDotPath(obj, pathStr = '') {
  if (!obj || !pathStr) return undefined
  const tokens = String(pathStr)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)
  let cur = obj
  for (const tok of tokens) {
    if (cur == null) return undefined
    cur = cur[tok]
  }
  return cur
}

/**
 * Pure Node.js HS256 JWT signer for Kling AI official `AccessKey:SecretKey` authentication.
 */
export function createKlingJwt(ak, sk) {
  const b64u = (v) => Buffer.from(v).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64u(JSON.stringify({ iss: String(ak), exp: now + 1800, nbf: now - 5 }))
  const sig = createHmac('sha256', String(sk)).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

function buildKlingAuthHeader(rawKey = '') {
  const s = String(rawKey || '').trim()
  if (!s) return ''
  if (s.includes(':') && !s.startsWith('eyJ')) {
    const [ak, ...rest] = s.split(':')
    const sk = rest.join(':')
    if (ak && sk) return `Bearer ${createKlingJwt(ak.trim(), sk.trim())}`
  }
  return s.startsWith('Bearer ') ? s : `Bearer ${s}`
}

function renderTemplateValue(templateStr = '', vars = {}, escapeForJson = false) {
  return String(templateStr || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => {
    const raw = vars[k] !== undefined ? vars[k] : ''
    if (typeof raw === 'boolean' || typeof raw === 'number') return String(raw)
    const str = String(raw)
    if (!escapeForJson) return str
    return JSON.stringify(str).slice(1, -1)
  })
}

function joinUrl(base = '', endpoint = '') {
  const b = String(base || '').trim().replace(/\/+$/, '')
  const e = String(endpoint || '').trim()
  if (!e) return b
  if (/^https?:\/\//i.test(e)) return e
  return `${b}/${e.replace(/^\/+/, '')}`
}

async function sleepMs(ms, signal) {
  if (signal?.aborted) throw new Error('Cloud media generation aborted')
  await new Promise((resolveWait, rejectWait) => {
    const t = setTimeout(resolveWait, ms)
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(t)
        rejectWait(new Error('Cloud media generation aborted'))
      }, { once: true })
    }
  })
}

/**
 * Build a provider error carrying HTTP status / provider code / body excerpt so that
 * `classifyCloudError` can recognise billing (balance / quota) failures.
 */
function providerError(message, { status = 0, providerCode = '', body = '' } = {}) {
  const err = new Error(message)
  if (status) err.status = Number(status)
  if (providerCode !== undefined && providerCode !== null && String(providerCode) !== '') err.providerCode = String(providerCode)
  if (body) err.body = String(body).slice(0, 600)
  return err
}

async function fetchJsonChecked(fetchFn, url, init, label = 'Cloud API') {
  const resp = await fetchFn(url, init)
  const ct = String(resp.headers?.get?.('content-type') || '').toLowerCase()
  if (ct.startsWith('audio/') || ct.startsWith('image/') || ct.startsWith('video/') || ct === 'application/octet-stream') {
    const buf = Buffer.from(await resp.arrayBuffer())
    if (!resp.ok) throw providerError(`${label} HTTP ${resp.status}`, { status: resp.status })
    return { binary: buf, contentType: ct, status: resp.status }
  }
  const text = await resp.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  if (!resp.ok) {
    const msg = json?.error?.message || json?.message || json?.base_resp?.status_msg || text.slice(0, 260)
    throw providerError(`${label} HTTP ${resp.status}: ${msg}`, {
      status: resp.status,
      providerCode: json?.error?.code ?? json?.error?.type ?? json?.code ?? json?.base_resp?.status_code ?? '',
      body: text,
    })
  }
  return { json: json ?? { rawText: text }, contentType: ct, status: resp.status }
}

async function materializeOutputAsset({ fetchFn, resultVal, resultFormat = 'url', outDir, baseName, defaultExt, signal }) {
  mkdirSync(outDir, { recursive: true })
  if (Buffer.isBuffer(resultVal)) {
    const outPath = join(outDir, `${baseName}${defaultExt}`)
    writeFileSync(outPath, resultVal)
    return outPath
  }
  const str = String(resultVal || '').trim()
  if (!str) throw new Error('云端接口返回成功，但未提取到有效的资源 URL 或二进制数据')

  if (resultFormat === 'hex' || (/^[0-9a-fA-F]{64,}$/.test(str) && str.length % 2 === 0)) {
    const outPath = join(outDir, `${baseName}${defaultExt}`)
    writeFileSync(outPath, Buffer.from(str, 'hex'))
    return outPath
  }
  if (resultFormat === 'base64' || str.startsWith('data:')) {
    const cleanB64 = str.replace(/^data:.*?;base64,/, '')
    const outPath = join(outDir, `${baseName}${defaultExt}`)
    writeFileSync(outPath, Buffer.from(cleanB64, 'base64'))
    return outPath
  }
  if (/^https?:\/\//i.test(str)) {
    const dl = await fetchFn(str, { method: 'GET', signal })
    if (!dl.ok) throw new Error(`下载云端生成文件失败 (HTTP ${dl.status}): ${str.slice(0, 120)}`)
    const buf = Buffer.from(await dl.arrayBuffer())
    const urlExt = extname(new URL(str).pathname || '').toLowerCase()
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.webm', '.mp3', '.wav', '.m4a', '.ogg', '.flac'].includes(urlExt)
      ? urlExt
      : defaultExt
    const outPath = join(outDir, `${baseName}${safeExt}`)
    writeFileSync(outPath, buf)
    return outPath
  }
  throw new Error(`无法识别的云端资源返回格式 (${resultFormat}): ${str.slice(0, 120)}`)
}

/**
 * Provider reported a terminal task failure (task exists but failed) → ledger status `failed`.
 */
function terminalTaskError(message, extra = {}) {
  const err = providerError(message, extra)
  err.terminal = true
  return err
}

/**
 * Polling budget exhausted while the provider task is still running → ledger keeps `submitted`
 * so the next request with the same params resumes polling instead of paying again.
 */
function stillRunningError(label, taskId) {
  const err = new Error(`${label} 云端任务仍在生成中（任务 ${taskId}），已记录到付费任务账本；稍后用相同参数重试将继续轮询该任务，不会重复提交或扣费。`)
  err.code = 'CLOUD_JOB_PENDING'
  err.stillRunning = true
  err.taskId = taskId
  return err
}

function renderCustomHeaders(c, vars) {
  let headers = { 'Content-Type': 'application/json' }
  if (c.headersJson && String(c.headersJson).trim()) {
    try {
      headers = JSON.parse(renderTemplateValue(c.headersJson, vars, true))
    } catch (e) {
      throw new Error(`自定义 Headers JSON 格式错误: ${e.message}`)
    }
  }
  return headers
}

function renderCustomBody(c, vars) {
  // `{{referenceImagesJson}}` / `{{referenceImages}}` expand to a raw JSON array of image data URIs
  const tpl = String(c.bodyTemplateJson || '{}').replace(/\{\{\s*referenceImages(?:Json)?\s*\}\}/g, JSON.stringify(vars.referenceImagesList || []))
  return renderTemplateValue(tpl, vars, true)
}

/**
 * `size` for /images/generations. Long-standing sizes are kept for 9:16 / 1:1 / 16:9; fixed: GPT Image 1 only accepts
 * 1024x1536 for portrait (1024x1792 is DALL·E 3 only), and 3:4 / 4:3 (publish-pack covers) get a matching orientation.
 */
function openAiImageSize(model = '', providerId = '', aspectRatio = '16:9') {
  const m = String(model || '').toLowerCase()
  const a = String(aspectRatio || '16:9')
  if (/gpt-image/.test(m)) return a === '1:1' ? '1024x1024' : a === '9:16' || a === '3:4' ? '1024x1536' : '1536x1024'
  if (a === '3:4' || a === '4:3') {
    if (/seedream|seededit/.test(m) || providerId === 'volcengine-seedream') {
      const v4 = /seedream-(?:[4-9]|\d{2})/.test(m)
      if (a === '3:4') return v4 ? '1728x2304' : '864x1152'
      return v4 ? '2304x1728' : '1152x864'
    }
    if (/dall-e-3/.test(m)) return a === '3:4' ? '1024x1792' : '1792x1024'
    return a === '3:4' ? '1024x1536' : '1536x1024'
  }
  return a === '9:16' ? '1024x1792' : a === '1:1' ? '1024x1024' : '1536x1024'
}

/**
 * Protocol adapters. `submit(ctx)` returns `{ result }` (synchronous APIs) or `{ taskId, resume }`
 * (async APIs); `poll(ctx, job)` resolves `{ resultVal, resultFormat, raw }` from a recorded task id,
 * so a restarted process can resume polling without resubmitting (never charging twice).
 */
const PROTOCOL_ADAPTERS = {
  custom: {
    async submit(ctx) {
      const { catCfg, vars, fetchFn, signal, onProgress } = ctx
      const c = catCfg.custom || {}
      const submitUrl = renderTemplateValue(c.submitUrl || joinUrl(catCfg.baseUrl, catCfg.endpoint), vars, false)
      if (!submitUrl || !/^https?:\/\//i.test(submitUrl)) {
        throw new Error('自定义云端接口缺少合法的 Submit URL (https://...)')
      }
      const headers = renderCustomHeaders(c, vars)
      const method = String(c.method || 'POST').toUpperCase()
      const bodyStr = method !== 'GET' && method !== 'HEAD' ? renderCustomBody(c, vars) : undefined
      onProgress?.({ stage: 'cloud-submit', progress: 20, message: `正在调用自定义云端接口: ${submitUrl}` })
      const firstRes = await fetchJsonChecked(fetchFn, submitUrl, { method, headers, body: bodyStr, signal }, 'Custom Cloud API')
      if (firstRes.binary) {
        return { result: { resultVal: firstRes.binary, resultFormat: 'binary', raw: { binaryBytes: firstRes.binary.length } } }
      }
      const submitData = firstRes.json
      if (c.mode !== 'async-poll' || !c.pollUrlTemplate) {
        return { result: { resultVal: getByDotPath(submitData, c.resultUrlPath || 'data.0.url'), resultFormat: c.resultFormat || 'url', raw: submitData } }
      }
      const taskId = getByDotPath(submitData, c.taskIdPath || 'data.task_id') || submitData?.id || submitData?.task_id
      if (!taskId) {
        // Fallback if API returned sync result directly
        const directVal = getByDotPath(submitData, c.resultUrlPath || '')
        if (directVal) return { result: { resultVal: directVal, resultFormat: c.resultFormat || 'url', raw: submitData } }
        throw providerError(`自定义异步接口未在路径 "${c.taskIdPath}" 找到 taskId: ${JSON.stringify(submitData).slice(0, 200)}`)
      }
      return { taskId: String(taskId), resume: {} }
    },
    async poll(ctx, job) {
      const { catCfg, vars, fetchFn, signal, onProgress, pollIntervalMs, maxPolls } = ctx
      const c = catCfg.custom || {}
      const taskId = job.taskId
      const headers = renderCustomHeaders(c, vars)
      const successSet = new Set(String(c.successValues || 'succeeded,completed,done,SUCCESS,2').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
      const failSet = new Set(String(c.failValues || 'failed,error,FAILED,cancelled').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
      const pollUrl = renderTemplateValue(c.pollUrlTemplate, { ...vars, taskId }, false)
      const pollMethod = String(c.pollMethod || 'GET').toUpperCase()
      for (let i = 0; i < maxPolls; i++) {
        onProgress?.({ stage: 'cloud-poll', progress: Math.min(88, 28 + Math.round((i / maxPolls) * 60)), message: `自定义异步任务轮询中 (${taskId} · 第 ${i + 1} 次)...` })
        const pollRes = await fetchJsonChecked(fetchFn, pollUrl, { method: pollMethod, headers, signal }, 'Custom Cloud Poll')
        if (pollRes.binary) return { resultVal: pollRes.binary, resultFormat: 'binary', raw: { binaryBytes: pollRes.binary.length } }
        const pJson = pollRes.json
        const st = String(getByDotPath(pJson, c.statusPath || 'data.status') ?? '').trim().toLowerCase()
        if (failSet.has(st)) {
          throw terminalTaskError(`自定义云端任务失败 (status=${st}): ${JSON.stringify(pJson).slice(0, 220)}`)
        }
        const maybeOut = getByDotPath(pJson, c.resultUrlPath || '')
        if (successSet.has(st) || (!st && maybeOut)) {
          return { resultVal: maybeOut, resultFormat: c.resultFormat || 'url', raw: pJson }
        }
        await sleepMs(pollIntervalMs, signal)
      }
      throw stillRunningError('自定义', taskId)
    },
  },

  'openai-image': {
    async submit(ctx) {
      const { catCfg, vars, aspectRatio, apiKey, fetchFn, signal, onProgress, refs } = ctx
      const url = joinUrl(catCfg.baseUrl || 'https://api.openai.com/v1', catCfg.endpoint || '/images/generations')
      const size = openAiImageSize(vars.model, catCfg.providerId, aspectRatio)
      onProgress?.({ stage: 'cloud-submit', progress: 35, message: `正在调用云端生图模型 (${vars.model})...` })
      const body = { model: vars.model, prompt: vars.prompt, n: 1, size }
      // Seedream 4.0+ multi-image reference (character consistency)
      if (refs?.mode === 'image-array' && refs.images.length > 0) body.image = refs.images.map((r) => r.dataUri)
      const res = await fetchJsonChecked(
        fetchFn,
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal },
        'Cloud Image API',
      )
      const item = res.json?.data?.[0] || {}
      return { result: { resultVal: item.url || item.b64_json || '', resultFormat: item.url ? 'url' : 'base64', raw: res.json } }
    },
  },

  'bfl-flux': {
    async submit(ctx) {
      const { catCfg, vars, aspectRatio, apiKey, fetchFn, signal, refs } = ctx
      const submitUrl = joinUrl(catCfg.baseUrl || 'https://api.bfl.ai', catCfg.endpoint || '/v1/flux-pro-1.1')
      // multiples of 32; 3:4 / 4:3 covers get a portrait / landscape 4:3 frame instead of 16:9
      const width = aspectRatio === '9:16' ? 768 : aspectRatio === '1:1' ? 1024 : aspectRatio === '3:4' ? 896 : aspectRatio === '4:3' ? 1184 : 1344
      const height = aspectRatio === '9:16' ? 1344 : aspectRatio === '1:1' ? 1024 : aspectRatio === '3:4' ? 1184 : aspectRatio === '4:3' ? 896 : 768
      const body = { prompt: vars.prompt, width, height }
      if (refs?.mode === 'bfl-image-prompt' && refs.images[0]) {
        if (/kontext/i.test(submitUrl)) body.input_image = refs.images[0].base64
        else body.image_prompt = refs.images[0].base64
      }
      const sub = await fetchJsonChecked(
        fetchFn,
        submitUrl,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-key': apiKey }, body: JSON.stringify(body), signal },
        'BFL Flux',
      )
      const taskId = sub.json?.id
      if (!taskId) throw providerError(`BFL Flux 未返回任务 id: ${JSON.stringify(sub.json).slice(0, 200)}`)
      return { taskId: String(taskId), resume: {} }
    },
    async poll(ctx, job) {
      const { catCfg, apiKey, fetchFn, signal, onProgress, pollIntervalMs, maxPolls } = ctx
      const pollBase = joinUrl(catCfg.baseUrl || 'https://api.bfl.ai', `/v1/get_result?id=${encodeURIComponent(job.taskId)}`)
      for (let i = 0; i < maxPolls; i++) {
        onProgress?.({ stage: 'cloud-poll', progress: Math.min(88, 26 + i * 2), message: `Flux 生成中 (${job.taskId} · 第 ${i + 1} 次查询)...` })
        const pr = await fetchJsonChecked(fetchFn, pollBase, { method: 'GET', headers: { 'x-key': apiKey }, signal }, 'BFL Flux Poll')
        if (pr.json?.status === 'Ready' && pr.json?.result?.sample) {
          return { resultVal: pr.json.result.sample, resultFormat: 'url', raw: pr.json }
        }
        if (['Error', 'Failed', 'Request Moderated', 'Content Moderated'].includes(pr.json?.status)) {
          throw terminalTaskError(`BFL Flux 生成失败: ${pr.json.status}`)
        }
        await sleepMs(pollIntervalMs, signal)
      }
      throw stillRunningError('BFL Flux', job.taskId)
    },
  },

  'fal-image': {
    async submit(ctx) {
      const { catCfg, vars, aspectRatio, apiKey, fetchFn, signal } = ctx
      const url = joinUrl(catCfg.baseUrl || 'https://fal.run', catCfg.endpoint || `/${vars.model || 'fal-ai/flux/schnell'}`)
      const imageSize =
        aspectRatio === '9:16' ? 'portrait_16_9' : aspectRatio === '1:1' ? 'square_hd' : aspectRatio === '3:4' ? 'portrait_4_3' : aspectRatio === '4:3' ? 'landscape_4_3' : 'landscape_16_9'
      const res = await fetchJsonChecked(
        fetchFn,
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
          body: JSON.stringify({ prompt: vars.prompt, image_size: imageSize, num_images: 1 }),
          signal,
        },
        'Fal.ai Flux',
      )
      return { result: { resultVal: res.json?.images?.[0]?.url || '', resultFormat: 'url', raw: res.json } }
    },
  },

  'kling-image': {
    async submit(ctx) {
      const { catCfg, vars, aspectRatio, apiKey, fetchFn, signal, refs } = ctx
      const url = joinUrl(catCfg.baseUrl || 'https://api.klingai.com', catCfg.endpoint || '/v1/images/generations')
      const payload = { model_name: vars.model || 'kling-v2', prompt: vars.prompt, aspect_ratio: aspectRatio, n: 1 }
      if (refs?.mode === 'kling-image-ref' && refs.images[0]) {
        payload.image = refs.images[0].base64
        if (/v1-5/i.test(payload.model_name)) payload.image_reference = refs.images[0].type === 'face' ? 'face' : 'subject'
      }
      const sub = await fetchJsonChecked(
        fetchFn,
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: buildKlingAuthHeader(apiKey) }, body: JSON.stringify(payload), signal },
        'Kling Image',
      )
      const taskId = sub.json?.data?.task_id
      if (!taskId) throw providerError(`Kling Image 未返回 task_id: ${JSON.stringify(sub.json).slice(0, 200)}`, { providerCode: sub.json?.code ?? '' })
      return { taskId: String(taskId), resume: {} }
    },
    async poll(ctx, job) {
      const { catCfg, apiKey, fetchFn, signal, onProgress, pollIntervalMs, maxPolls } = ctx
      const url = joinUrl(catCfg.baseUrl || 'https://api.klingai.com', catCfg.endpoint || '/v1/images/generations')
      const auth = buildKlingAuthHeader(apiKey)
      const pollUrl = `${url}/${encodeURIComponent(job.taskId)}`
      for (let i = 0; i < maxPolls; i++) {
        onProgress?.({ stage: 'cloud-poll', progress: Math.min(88, 26 + i * 2), message: `可灵 Kling 生图中 (${job.taskId} · 第 ${i + 1} 次查询)...` })
        const pr = await fetchJsonChecked(fetchFn, pollUrl, { method: 'GET', headers: { Authorization: auth }, signal }, 'Kling Image Poll')
        const st = pr.json?.data?.task_status
        if (st === 'succeeded') {
          return { resultVal: pr.json?.data?.task_result?.images?.[0]?.url || '', resultFormat: 'url', raw: pr.json }
        }
        if (st === 'failed') throw terminalTaskError(`Kling Image 任务失败: ${pr.json?.data?.task_status_msg || 'failed'}`)
        await sleepMs(pollIntervalMs, signal)
      }
      throw stillRunningError('Kling Image', job.taskId)
    },
  },

  'volcengine-seedance': {
    async submit(ctx) {
      const { catCfg, vars, aspectRatio, durationSec, imageUrl, apiKey, fetchFn, signal, onProgress, refs } = ctx
      const url = joinUrl(catCfg.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3', catCfg.endpoint || '/contents/generations/tasks')
      const contentArr = [{ type: 'text', text: `${vars.prompt} --ratio ${aspectRatio} --duration ${Math.max(4, Math.min(12, Math.round(Number(durationSec) || 5)))}` }]
      if (imageUrl) contentArr.push({ type: 'image_url', image_url: { url: imageUrl }, role: 'first_frame' })
      else if (refs?.mode === 'seedance-reference') {
        for (const r of refs.images) contentArr.push({ type: 'image_url', image_url: { url: r.dataUri }, role: 'reference_image' })
      }
      onProgress?.({ stage: 'cloud-submit', progress: 20, message: `正在提交火山方舟 Seedance 视频任务 (${vars.model})...` })
      const sub = await fetchJsonChecked(
        fetchFn,
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: vars.model || 'doubao-seedance-2-5-260628', content: contentArr }),
          signal,
        },
        'Volcengine Seedance',
      )
      const taskId = sub.json?.id
      if (!taskId) throw providerError(`Volcengine Seedance 未返回任务 id: ${JSON.stringify(sub.json).slice(0, 200)}`)
      return { taskId: String(taskId), resume: {} }
    },
    async poll(ctx, job) {
      const { catCfg, apiKey, fetchFn, signal, onProgress, pollIntervalMs, maxPolls } = ctx
      const url = joinUrl(catCfg.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3', catCfg.endpoint || '/contents/generations/tasks')
      const pollUrl = `${url}/${encodeURIComponent(job.taskId)}`
      for (let i = 0; i < maxPolls; i++) {
        onProgress?.({ stage: 'cloud-poll', progress: Math.min(88, 26 + i * 2), message: `火山方舟 Seedance 渲染中 (${job.taskId} · 第 ${i + 1} 次查询)...` })
        const pr = await fetchJsonChecked(fetchFn, pollUrl, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, signal }, 'Seedance Poll')
        if (pr.json?.status === 'succeeded') {
          return { resultVal: pr.json?.content?.video_url || pr.json?.video_url || '', resultFormat: 'url', raw: pr.json }
        }
        if (['failed', 'cancelled', 'expired'].includes(pr.json?.status)) {
          throw terminalTaskError(`Seedance 视频任务失败: ${pr.json?.error?.message || pr.json?.status}`, { providerCode: pr.json?.error?.code ?? '' })
        }
        await sleepMs(pollIntervalMs, signal)
      }
      throw stillRunningError('Seedance', job.taskId)
    },
  },

  'kling-video': {
    async submit(ctx) {
      const { catCfg, vars, aspectRatio, durationSec, imageUrl, apiKey, fetchFn, signal, onProgress } = ctx
      const ep = imageUrl ? '/v1/videos/image2video' : (catCfg.endpoint || '/v1/videos/text2video')
      const url = joinUrl(catCfg.baseUrl || 'https://api.klingai.com', ep)
      const payload = {
        model_name: vars.model || 'kling-v2-6',
        prompt: vars.prompt,
        duration: String(Number(durationSec) >= 8 ? 10 : 5),
        aspect_ratio: aspectRatio,
        mode: 'std',
        ...(imageUrl ? { image: imageUrl } : {}),
      }
      onProgress?.({ stage: 'cloud-submit', progress: 20, message: `正在提交可灵 Kling 视频任务 (${payload.model_name})...` })
      const sub = await fetchJsonChecked(
        fetchFn,
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: buildKlingAuthHeader(apiKey) }, body: JSON.stringify(payload), signal },
        'Kling Video',
      )
      const taskId = sub.json?.data?.task_id
      if (!taskId) throw providerError(`Kling Video 未返回 task_id: ${JSON.stringify(sub.json).slice(0, 200)}`, { providerCode: sub.json?.code ?? '' })
      return { taskId: String(taskId), resume: { endpoint: ep } }
    },
    async poll(ctx, job) {
      const { catCfg, apiKey, fetchFn, signal, onProgress, pollIntervalMs, maxPolls } = ctx
      const url = joinUrl(catCfg.baseUrl || 'https://api.klingai.com', job.resume?.endpoint || catCfg.endpoint || '/v1/videos/text2video')
      const auth = buildKlingAuthHeader(apiKey)
      const pollUrl = `${url}/${encodeURIComponent(job.taskId)}`
      for (let i = 0; i < maxPolls; i++) {
        onProgress?.({ stage: 'cloud-poll', progress: Math.min(88, 26 + i * 2), message: `可灵 Kling 生成中 (${job.taskId} · 第 ${i + 1} 次查询)...` })
        const pr = await fetchJsonChecked(fetchFn, pollUrl, { method: 'GET', headers: { Authorization: auth }, signal }, 'Kling Poll')
        const st = pr.json?.data?.task_status
        if (st === 'succeeded') {
          return { resultVal: pr.json?.data?.task_result?.videos?.[0]?.url || '', resultFormat: 'url', raw: pr.json }
        }
        if (st === 'failed') throw terminalTaskError(`Kling 视频任务失败: ${pr.json?.data?.task_status_msg || 'failed'}`)
        await sleepMs(pollIntervalMs, signal)
      }
      throw stillRunningError('Kling 视频', job.taskId)
    },
  },

  'minimax-hailuo': {
    async submit(ctx) {
      const { catCfg, vars, imageUrl, apiKey, fetchFn, signal, refs } = ctx
      const base = catCfg.baseUrl || 'https://api.minimaxi.com'
      const url = joinUrl(base, catCfg.endpoint || '/v1/video_generation')
      const body = { model: vars.model || 'MiniMax-Hailuo-02', prompt: vars.prompt, ...(imageUrl ? { first_frame_image: imageUrl } : {}) }
      if (refs?.mode === 'minimax-subject' && refs.images[0]) body.subject_reference = [{ type: 'character', image: [refs.images[0].dataUri] }]
      const sub = await fetchJsonChecked(
        fetchFn,
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal },
        'MiniMax Hailuo',
      )
      if (sub.json?.base_resp?.status_code && sub.json.base_resp.status_code !== 0) {
        throw providerError(`MiniMax 海螺提交失败: ${sub.json.base_resp.status_msg || sub.json.base_resp.status_code}`, { providerCode: sub.json.base_resp.status_code })
      }
      const taskId = sub.json?.task_id
      if (!taskId) throw providerError(`MiniMax 海螺未返回 task_id: ${JSON.stringify(sub.json).slice(0, 200)}`)
      return { taskId: String(taskId), resume: {} }
    },
    async poll(ctx, job) {
      const { catCfg, apiKey, fetchFn, signal, onProgress, pollIntervalMs, maxPolls } = ctx
      const base = catCfg.baseUrl || 'https://api.minimaxi.com'
      const pollUrl = joinUrl(base, `/v1/query/video_generation?task_id=${encodeURIComponent(job.taskId)}`)
      for (let i = 0; i < maxPolls; i++) {
        onProgress?.({ stage: 'cloud-poll', progress: Math.min(88, 26 + i * 2), message: `MiniMax 海螺生成中 (${job.taskId} · 第 ${i + 1} 次查询)...` })
        const pr = await fetchJsonChecked(fetchFn, pollUrl, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, signal }, 'MiniMax Hailuo Poll')
        if (pr.json?.status === 'Success' && pr.json?.file_id) {
          const retUrl = joinUrl(base, `/v1/files/retrieve?file_id=${encodeURIComponent(pr.json.file_id)}`)
          const fr = await fetchJsonChecked(fetchFn, retUrl, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, signal }, 'MiniMax File Retrieve')
          return { resultVal: fr.json?.file?.download_url || '', resultFormat: 'url', raw: fr.json }
        }
        if (pr.json?.status === 'Fail') {
          throw terminalTaskError(`MiniMax 海螺任务失败: ${pr.json?.base_resp?.status_msg || 'Fail'}`, { providerCode: pr.json?.base_resp?.status_code ?? '' })
        }
        await sleepMs(pollIntervalMs, signal)
      }
      throw stillRunningError('MiniMax 海螺', job.taskId)
    },
  },

  'openai-video': {
    async submit(ctx) {
      const { catCfg, vars, aspectRatio, durationSec, apiKey, fetchFn, signal } = ctx
      const url = joinUrl(catCfg.baseUrl || 'https://api.openai.com/v1', catCfg.endpoint || '/videos/generations')
      const res = await fetchJsonChecked(
        fetchFn,
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: vars.model || 'sora-2', prompt: vars.prompt, duration: Number(durationSec) || 5, aspect_ratio: aspectRatio }),
          signal,
        },
        'OpenAI Video',
      )
      const directUrl = res.json?.data?.[0]?.url || res.json?.video_url || res.json?.url
      if (directUrl) return { result: { resultVal: directUrl, resultFormat: 'url', raw: res.json } }
      if (res.json?.id) return { taskId: String(res.json.id), resume: {} }
      throw providerError(`云端 video 生成任务未返回有效结果: ${JSON.stringify(res.json).slice(0, 200)}`)
    },
    async poll(ctx, job) {
      const { catCfg, apiKey, fetchFn, signal, onProgress, pollIntervalMs, maxPolls } = ctx
      const url = joinUrl(catCfg.baseUrl || 'https://api.openai.com/v1', catCfg.endpoint || '/videos/generations')
      const pollUrl = `${url}/${encodeURIComponent(job.taskId)}`
      for (let i = 0; i < maxPolls; i++) {
        onProgress?.({ stage: 'cloud-poll', progress: Math.min(88, 26 + i * 2), message: `云端视频生成中 (${job.taskId} · 第 ${i + 1} 次查询)...` })
        const pr = await fetchJsonChecked(fetchFn, pollUrl, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, signal }, 'OpenAI Video Poll')
        const u = pr.json?.data?.[0]?.url || pr.json?.video_url || pr.json?.output?.url
        if (u) return { resultVal: u, resultFormat: 'url', raw: pr.json }
        if (['failed', 'error'].includes(String(pr.json?.status || '').toLowerCase())) {
          throw terminalTaskError(`云端视频生成失败: ${pr.json?.error?.message || pr.json?.status}`, { providerCode: pr.json?.error?.code ?? '' })
        }
        await sleepMs(pollIntervalMs, signal)
      }
      throw stillRunningError('云端视频', job.taskId)
    },
  },

  'suno-music': {
    async submit(ctx) {
      const { catCfg, vars, lyrics, instrumental, apiKey, fetchFn, signal, onProgress } = ctx
      const base = catCfg.baseUrl || 'https://api.sunoapi.org'
      const submitUrl = joinUrl(base, catCfg.endpoint || '/suno/submit/music')
      const payload = {
        prompt: String(lyrics || '').trim() || vars.prompt,
        gpt_description_prompt: vars.prompt,
        tags: vars.tags,
        title: vars.title,
        mv: vars.model || 'chirp-v4-5',
        make_instrumental: Boolean(instrumental),
      }
      onProgress?.({ stage: 'cloud-submit', progress: 22, message: `正在提交 Suno AI 音乐生成任务 (${payload.mv})...` })
      const sub = await fetchJsonChecked(
        fetchFn,
        submitUrl,
        { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload), signal },
        'Suno Music API',
      )
      const directAudio = sub.json?.audio_url || sub.json?.data?.[0]?.audio_url
      if (directAudio) return { result: { resultVal: directAudio, resultFormat: 'url', raw: sub.json } }
      const taskId = sub.json?.data?.task_id || sub.json?.data || sub.json?.id || sub.json?.task_id
      if (!taskId || typeof taskId !== 'string') {
        throw providerError(`Suno API 未返回任务 ID: ${JSON.stringify(sub.json).slice(0, 220)}`, { providerCode: sub.json?.code ?? '' })
      }
      return { taskId, resume: {} }
    },
    async poll(ctx, job) {
      const { catCfg, apiKey, fetchFn, signal, onProgress, pollIntervalMs, maxPolls } = ctx
      const base = catCfg.baseUrl || 'https://api.sunoapi.org'
      const pollUrl = joinUrl(base, `/suno/fetch/${encodeURIComponent(job.taskId)}`)
      for (let i = 0; i < maxPolls; i++) {
        onProgress?.({ stage: 'cloud-poll', progress: Math.min(88, 28 + i * 2), message: `Suno AI 编曲渲染中 (${job.taskId} · 第 ${i + 1} 次查询)...` })
        const pr = await fetchJsonChecked(fetchFn, pollUrl, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, signal }, 'Suno Poll')
        const clips = Array.isArray(pr.json?.data?.data) ? pr.json.data.data : Array.isArray(pr.json?.data) ? pr.json.data : [pr.json?.data || pr.json]
        const readyClip = clips.find((c) => c?.audio_url && (!c?.status || ['complete', 'completed', 'SUCCESS', 'succeeded'].includes(String(c.status))))
        if (readyClip?.audio_url) return { resultVal: readyClip.audio_url, resultFormat: 'url', raw: pr.json }
        const st = String(pr.json?.data?.status || pr.json?.status || '').toUpperCase()
        if (['FAILURE', 'FAILED', 'ERROR'].includes(st)) {
          throw terminalTaskError(`Suno 音乐生成失败: ${pr.json?.data?.fail_reason || st}`)
        }
        await sleepMs(pollIntervalMs, signal)
      }
      throw stillRunningError('Suno', job.taskId)
    },
  },

  'minimax-music': {
    async submit(ctx) {
      const { catCfg, vars, instrumental, apiKey, fetchFn, signal, onProgress } = ctx
      const url = joinUrl(catCfg.baseUrl || 'https://api.minimaxi.com', catCfg.endpoint || '/v1/music_generation')
      const musicModel = vars.model || 'music-3.0'
      onProgress?.({ stage: 'cloud-submit', progress: 35, message: `正在调用 MiniMax 音乐大模型 (${musicModel})...` })
      const res = await fetchJsonChecked(
        fetchFn,
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: musicModel,
            prompt: vars.prompt,
            lyrics: vars.lyrics,
            ...(instrumental ? { is_instrumental: true } : {}),
            audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3' },
          }),
          signal,
        },
        'MiniMax Music',
      )
      if (res.json?.base_resp?.status_code && res.json.base_resp.status_code !== 0) {
        throw providerError(`MiniMax Music 失败: ${res.json.base_resp.status_msg || res.json.base_resp.status_code}`, { providerCode: res.json.base_resp.status_code })
      }
      const audioVal = res.json?.data?.audio || res.json?.data?.audio_url || res.json?.audio_url || ''
      return { result: { resultVal: audioVal, resultFormat: /^https?:\/\//i.test(String(audioVal)) ? 'url' : 'hex', raw: res.json } }
    },
  },

  'minimax-speech': {
    async submit(ctx) {
      const { catCfg, vars, apiKey, fetchFn, signal } = ctx
      const url = joinUrl(catCfg.baseUrl || 'https://api.minimaxi.com', catCfg.endpoint || '/v1/t2a_v2')
      const res = await fetchJsonChecked(
        fetchFn,
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: vars.model || 'speech-2.6-hd',
            text: vars.prompt,
            stream: false,
            voice_setting: { voice_id: 'male-qn-qingse', speed: 1.0, vol: 1.0, pitch: 0 },
            audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
          }),
          signal,
        },
        'MiniMax Speech',
      )
      if (res.json?.base_resp?.status_code && res.json.base_resp.status_code !== 0) {
        throw providerError(`MiniMax Speech 失败: ${res.json.base_resp.status_msg || res.json.base_resp.status_code}`, { providerCode: res.json.base_resp.status_code })
      }
      const audioVal = res.json?.data?.audio || ''
      return { result: { resultVal: audioVal, resultFormat: /^https?:\/\//i.test(String(audioVal)) ? 'url' : 'hex', raw: res.json } }
    },
  },

  'volcengine-doubao-tts': {
    async submit(ctx) {
      const { catCfg, vars, apiKey, fetchFn, signal } = ctx
      const url = joinUrl(catCfg.baseUrl || 'https://openspeech.bytedance.com', catCfg.endpoint || '/api/v1/tts')
      const [appId, ...tokRest] = apiKey.split(':')
      const token = tokRest.join(':') || apiKey
      const res = await fetchJsonChecked(
        fetchFn,
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer;${token.trim()}` },
          body: JSON.stringify({
            app: { appid: (appId || '').trim(), token: token.trim(), cluster: 'volcano_tts' },
            user: { uid: 'dsh-video-workbench' },
            audio: { voice_type: vars.model || 'zh_male_m392_conversation_wvae_bigtts', encoding: 'mp3', speed_ratio: 1.0 },
            request: { reqid: `dsh-${Date.now()}`, text: vars.prompt, text_type: 'plain', operation: 'query' },
          }),
          signal,
        },
        'Volcengine Doubao TTS',
      )
      if (res.json?.code !== undefined && Number(res.json.code) !== 3000 && Number(res.json.code) !== 0) {
        throw providerError(`火山豆包 TTS 失败: ${res.json?.message || res.json?.code}`, { providerCode: res.json.code })
      }
      return { result: { resultVal: res.json?.data || '', resultFormat: 'base64', raw: res.json } }
    },
  },

  'elevenlabs-sfx': {
    async submit(ctx) {
      const { catCfg, vars, durationSec, apiKey, fetchFn, signal } = ctx
      const url = joinUrl(catCfg.baseUrl || 'https://api.elevenlabs.io', catCfg.endpoint || '/v1/sound-generation')
      const res = await fetchJsonChecked(
        fetchFn,
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
          body: JSON.stringify({ text: vars.prompt, duration_seconds: Math.max(0.5, Math.min(22, Number(durationSec) || 5)) }),
          signal,
        },
        'ElevenLabs SFX',
      )
      return { result: { resultVal: res.binary || res.json?.audio_url || '', resultFormat: res.binary ? 'binary' : 'url', raw: res.json || {} } }
    },
  },
}

export const CLOUD_PROTOCOLS_WITH_RESUME = Object.keys(PROTOCOL_ADAPTERS).filter((k) => typeof PROTOCOL_ADAPTERS[k].poll === 'function')

/**
 * Which providers can receive character reference images (others get the textual description).
 */
export function resolveReferenceImageCapability(catCfg = {}, protocol = '', category = '', model = '') {
  const extra = catCfg?.extraParams && typeof catCfg.extraParams === 'object' ? catCfg.extraParams : {}
  if (extra.supportsReferenceImages === false) return { supported: false, mode: 'text', maxImages: 0, reason: '已在 extraParams 中关闭参考图' }
  const forced = extra.supportsReferenceImages === true
  const pid = String(catCfg?.providerId || '')
  const m = String(model || catCfg?.model || '')
  if (protocol === 'custom') {
    const tpl = String(catCfg?.custom?.bodyTemplateJson || '')
    if (/\{\{\s*referenceImages(?:Json)?\s*\}\}|\{\{\s*referenceImage\s*\}\}/.test(tpl)) {
      return { supported: true, mode: 'custom-template', maxImages: 4, reason: '自定义模板声明了 {{referenceImagesJson}} / {{referenceImage}}' }
    }
    return { supported: false, mode: 'text', maxImages: 0, reason: '自定义模板未声明参考图变量，改为注入角色文字设定' }
  }
  if (category === 'image') {
    if (protocol === 'openai-image' && (forced || (pid === 'volcengine-seedream' && /seedream-(?:[4-9]|\d{2})|seededit/i.test(m)))) {
      return { supported: true, mode: 'image-array', maxImages: 6, reason: 'Seedream 4.0+ 多图参考' }
    }
    if (protocol === 'kling-image') return { supported: true, mode: 'kling-image-ref', maxImages: 1, reason: '可灵 Kling 图像参考' }
    if (protocol === 'bfl-flux') return { supported: true, mode: 'bfl-image-prompt', maxImages: 1, reason: 'Flux image_prompt / Kontext input_image' }
  }
  if (category === 'video') {
    if (protocol === 'volcengine-seedance' && (forced || /i2v|ref/i.test(m))) return { supported: true, mode: 'seedance-reference', maxImages: 4, reason: 'Seedance 参考图生视频' }
    if (protocol === 'minimax-hailuo' && (forced || /^s2v/i.test(m))) return { supported: true, mode: 'minimax-subject', maxImages: 1, reason: 'MiniMax S2V 主体参考' }
  }
  return { supported: false, mode: 'text', maxImages: 0, reason: '该服务商/模型不支持参考图，改为注入角色文字设定' }
}

function inferPaidJobKind(category, protocol) {
  if (category === 'image') return 'image'
  if (category === 'video') return 'video'
  if (protocol === 'minimax-speech' || protocol === 'volcengine-doubao-tts') return 'tts'
  if (protocol === 'elevenlabs-sfx') return 'sfx'
  return 'music'
}

function categoryAssetSubdir(category) {
  return category === 'audio' ? join('assets', 'audio') : category === 'video' ? join('assets', 'videos') : join('assets', 'images')
}

// Gateway answers that can arrive after the upstream already accepted the request (502/504/520/524)
const SUBMIT_OUTCOME_UNKNOWN_STATUS = new Set([502, 504, 520, 524])

/**
 * Persist a failure into the ledger and return the error to throw. Billing errors become
 * `CloudBillingError` (never retried). Network failures during submission are recorded as
 * `interrupted` (the provider may have accepted and charged); polling failures stay resumable.
 */
function recordLedgerFailure(targetRoot, job, err, phase, catCfg, category) {
  const cls = classifyCloudError(err)
  const msg = String(err?.message || err || '').slice(0, 400)
  const nowIso = new Date().toISOString()
  if (cls.kind === 'billing') {
    if (job?.id) updateLedgerJob(targetRoot, job.id, { status: LEDGER_STATUS.BILLING_FAILED, error: msg, errorKind: 'billing', failedAt: nowIso, phase })
    return toBillingError(err, { scope: 'cloud', provider: catCfg?.providerId || '', category, ledgerJobId: job?.id || '' })
  }
  if (!job?.id) return err
  if (phase === 'submit') {
    // Outcome unknown (aborted, network failure without an HTTP answer, gateway timeout after the request reached
    // the upstream) → the provider may have accepted and charged the task → `interrupted` (resubmission held)
    const st = Number(cls.status) || 0
    const outcomeUnknown = cls.kind === 'abort' || (cls.kind === 'transient' && (!st || SUBMIT_OUTCOME_UNKNOWN_STATUS.has(st)))
    updateLedgerJob(targetRoot, job.id, {
      status: outcomeUnknown ? LEDGER_STATUS.INTERRUPTED : LEDGER_STATUS.FAILED,
      error: msg,
      errorKind: cls.kind,
      [outcomeUnknown ? 'interruptedAt' : 'failedAt']: nowIso,
    })
    return err
  }
  if (err?.terminal || (cls.kind === 'fatal' && Number(cls.status) >= 400 && Number(cls.status) < 500)) {
    updateLedgerJob(targetRoot, job.id, { status: LEDGER_STATUS.FAILED, error: msg, errorKind: err?.terminal ? 'provider-failed' : cls.kind, failedAt: nowIso })
  } else {
    // still running / aborted / transient network: keep `submitted` (task id recorded) → resumable
    updateLedgerJob(targetRoot, job.id, { lastError: msg, lastErrorAt: nowIso, errorKind: err?.stillRunning ? 'still-running' : cls.kind })
  }
  return err
}

/**
 * Save the generated asset into staging (preview → confirm → save flow) or the project
 * (assets.json registration + optional script.json binding). Idempotent for the same file.
 */
async function deliverCloudResult(args) {
  const { targetRoot, projectDir, savedAbs, category, catCfg, protocol, vars, cleanPrompt, lyrics, instrumental, sceneId, stageOnly, autoBindToScript, signal, onProgress, ledgerJobId = '', fileOut = null, referenceInfo = null } = args
  const savedRel = savedAbs.slice(targetRoot.length + 1).replace(/\\/g, '/')
  // Plain file delivery (publish-pack covers): the caller owns the file — no staging, assets.json or script binding
  if (fileOut) {
    onProgress?.({ stage: 'done', progress: 100, message: `✅ 云端 ${category} 已生成：${savedRel}` })
    return {
      ok: true,
      staged: false,
      fileOnly: true,
      category,
      providerId: catCfg.providerId,
      protocol,
      model: vars.model || catCfg.model || '',
      path: savedRel,
      absolutePath: savedAbs,
      referenceImages: referenceInfo,
    }
  }
  let probedDur = 0
  if (category === 'audio' || category === 'video') {
    try {
      const p = await probeAudioDuration(savedAbs, 30)
      probedDur = Number(p?.durationSec || 0)
    } catch {}
  }

  // Staging Preview Mode: keep unapproved drafts isolated inside `.staging/` until user clicks Confirm!
  if (stageOnly) {
    const items = loadStagingManifest(targetRoot)
    let stgItem = items.find((it) => it.relPath === savedRel)
    if (!stgItem) {
      stgItem = {
        stagingId: `stg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        category,
        providerId: catCfg.providerId,
        model: vars.model || catCfg.model || '',
        protocol,
        relPath: savedRel,
        fileName: basename(savedAbs),
        prompt: cleanPrompt,
        lyrics: String(lyrics || '').trim(),
        title: vars.title || '',
        sceneId: sceneId || '',
        instrumental: Boolean(instrumental),
        durationSec: Number(probedDur.toFixed(2)),
        sizeBytes: existsSync(savedAbs) ? statSync(savedAbs).size : 0,
        createdAt: new Date().toISOString(),
        ...(ledgerJobId ? { ledgerJobId } : {}),
      }
      items.unshift(stgItem)
      saveStagingManifest(targetRoot, items.slice(0, 30))
    }
    onProgress?.({ stage: 'done', progress: 100, message: `✨ 已生成至预览验收区，请先查看/试听满意后再存入项目素材库！` })
    return {
      ok: true,
      staged: true,
      stagingItem: stgItem,
      category,
      providerId: catCfg.providerId,
      protocol,
      path: savedRel,
      absolutePath: savedAbs,
    }
  }

  let registeredAsset = null
  let beatMeta = null
  let bindSkipped = ''
  if (projectDir && existsSync(join(targetRoot, 'script.json'))) {
    const manifest = readAssets(targetRoot)
    registeredAsset = (manifest.items || []).find((it) => it.path === savedRel) || null
    if (!registeredAsset) {
      registeredAsset = {
        id: `cloud-${category}-${Date.now().toString(36)}`,
        name: `${vars.title || catCfg.providerId} (云端AI生成)`,
        originalName: basename(savedAbs),
        path: savedRel,
        type: category === 'audio' ? 'audio' : category === 'video' ? 'video' : 'image',
        role: category === 'audio' ? 'music' : 'visual',
        source: `cloud:${catCfg.providerId}`,
        prompt: cleanPrompt,
        durationSec: probedDur || undefined,
        importedAt: new Date().toISOString(),
        ...(ledgerJobId ? { cloudJobId: ledgerJobId } : {}),
      }
      manifest.items = [...(manifest.items || []), registeredAsset]
      writeAssets(targetRoot, manifest)
    }

    if (autoBindToScript) {
      const { data } = readScriptJson(targetRoot)
      if (category === 'audio') {
        try {
          beatMeta = await analyzeAudioBeatStructure(savedAbs, { signal })
        } catch {}
        data.bgmMode = 'uploaded'
        data.bgm = {
          ...(data.bgm || {}),
          ...(beatMeta || {}),
          enabled: true,
          mode: 'uploaded',
          source: `cloud:${catCfg.providerId}`,
          path: savedRel,
          uploadedPath: savedRel,
        }
        writeScriptJson(targetRoot, data)
      } else if (sceneId && Array.isArray(data.scenes)) {
        const sc = data.scenes.find((s) => s.id === sceneId)
        // Human edit protection: a locked scene's media is never replaced automatically (asset stays registered)
        if (sc && isSceneLocked(sc)) {
          bindSkipped = 'scene-locked'
        } else if (sc) {
          sc.media = [{ assetId: registeredAsset.id, path: savedRel, type: category, source: `cloud:${catCfg.providerId}` }]
          sc.mediaPath = savedRel
          sc.mediaType = category
          writeScriptJson(targetRoot, data)
        }
      }
    }
  }

  onProgress?.({ stage: 'done', progress: 100, message: `✅ 云端 ${category} 素材生成并入库完成：${savedRel}${bindSkipped ? `（场景 ${sceneId} 已锁定，未自动替换其素材）` : ''}` })
  return {
    ok: true,
    staged: false,
    category,
    providerId: catCfg.providerId,
    protocol,
    path: savedRel,
    absolutePath: savedAbs,
    asset: registeredAsset,
    beatMeta,
    ...(bindSkipped ? { bindSkipped } : {}),
  }
}

/**
 * Deliver a ledger result that was already paid for (copying between staging and project assets when
 * the delivery mode differs). Never touches the network.
 */
async function deliverReusedCloudResult(args) {
  const { targetRoot, job, stageOnly, category, fileOut = null } = args
  const existing = (job.resultPaths || []).find((rel) => existsSync(join(targetRoot, rel)))
  let abs = join(targetRoot, existing)
  const inStaging = existing.startsWith('.staging/')
  if (fileOut) {
    // plain-file delivery: reuse the paid result in place when it already sits in the target folder, else copy it there
    if (!existing.startsWith(`${fileOut.subdir}/`)) {
      const destDir = join(targetRoot, fileOut.subdir)
      mkdirSync(destDir, { recursive: true })
      const dest = join(destDir, basename(abs))
      if (!existsSync(dest)) copyFileSync(abs, dest)
      abs = dest
    }
  } else if (inStaging !== Boolean(stageOnly)) {
    const destDir = join(targetRoot, stageOnly ? '.staging' : categoryAssetSubdir(category))
    mkdirSync(destDir, { recursive: true })
    const dest = join(destDir, basename(abs))
    if (!existsSync(dest)) copyFileSync(abs, dest)
    abs = dest
  }
  const result = await deliverCloudResult({ ...args, savedAbs: abs, ledgerJobId: job.id })
  const rel = relToLedgerRoot(targetRoot, abs)
  return { result, resultPaths: [...new Set([rel, ...(job.resultPaths || [])])] }
}

const ACTIVE_CLOUD_JOBS = new Map()

/**
 * Generate an Image, Video B-roll, or Music/Audio asset via optional BYOK Cloud Providers or Custom Protocol,
 * download into `<projectDir>/assets/cloud-<category>/`, register in `assets.json`, and optionally bind to `script.json`.
 *
 * Cost protection: every paid submission is recorded in `<project>/output/cloud-jobs.json` BEFORE it is sent.
 * A retry / restart with the same normalised params resumes polling the recorded task id or reuses the
 * completed result file (pass `forceNew: true` to deliberately pay for a new variant). Billing errors throw
 * `CloudBillingError` and are never retried. An optional per-run `budget` (createPaidJobBudget) caps new
 * paid submissions. Prompts mentioning `@角色名` attach character reference images (or descriptions).
 */
export async function generateCloudMediaAsset(options = {}) {
  loadEnv()
  const {
    projectDir = '',
    category = 'image',
    prompt = '',
    lyrics = '',
    tags = '',
    title = '',
    durationSec = 5,
    aspectRatio = '16:9',
    imageUrl = '',
    instrumental = false,
    stageOnly = false,
    sceneId = '',
    autoBindToScript = true,
    providerOverride = null,
    fetchImpl = null,
    pollIntervalMs = 2500,
    maxPolls = 60,
    signal,
    onProgress,
    forceNew = false,
    ledger = true,
    budget = null,
    runId = '',
    characterIds = [],
    useCharacterRefs = true,
    characterLibraryPath = '',
    resubmitHoldMs,
    // { subdir: 'output/covers/ai-raw', prefix: 'ai-raw' }: save the result as a plain project file there (no assets.json
    // registration, no staging, no script binding) — used by the publish-pack cover studio
    fileOutput = null,
    // absolute paths of extra reference images (image-to-image) for providers that support reference images
    referenceImages = [],
  } = options

  if (!['image', 'video', 'audio'].includes(category)) {
    throw new Error(`Unsupported cloud media category: ${category}`)
  }
  let fileOut = null
  if (fileOutput && typeof fileOutput === 'object') {
    const sub = String(fileOutput.subdir || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (!sub || /^[a-z]:/i.test(sub) || sub.split('/').some((seg) => !seg || seg === '..' || seg === '.')) {
      throw new Error(`fileOutput.subdir 必须是工程内的相对目录: ${fileOutput.subdir}`)
    }
    fileOut = { subdir: sub, prefix: String(fileOutput.prefix || 'cloud').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'cloud' }
  }
  const cleanPrompt = String(prompt || '').trim()
  if (!cleanPrompt && !String(lyrics || '').trim()) {
    throw new Error('请填写生成提示词 prompt（或音乐歌词 lyrics）')
  }

  const cfg = loadCloudMediaConfig()
  const catCfg = providerOverride
    ? {
        ...cfg[category],
        ...providerOverride,
        custom: { ...cfg[category].custom, ...(providerOverride.custom || {}) },
      }
    : cfg[category]

  const protocol = String(catCfg.protocol || 'custom')
  const apiKey = String(catCfg.apiKey || '').trim()
  if (protocol !== 'custom' && !apiKey) {
    throw new Error(`尚未配置云端 ${category} 模型的 API Key，请先在「☁️ 云端生图/视频/音乐 (BYOK)」中填写并保存。`)
  }
  const adapter = PROTOCOL_ADAPTERS[protocol]
  if (!adapter) throw new Error(`不支持的云端协议类型: ${protocol}`)

  const fetchFn = fetchImpl || globalThis.fetch

  // Character consistency: "@角色名" / "@别名" → reference images (capable providers) or text description
  let character = { mentioned: [], prompt: cleanPrompt, descriptionBlock: '', references: [], referenceSignatures: [] }
  if (useCharacterRefs !== false && (category === 'image' || category === 'video') && cleanPrompt) {
    try {
      character = buildCharacterPromptContext({ projectDir, prompt: cleanPrompt, characterIds, globalLibraryPath: characterLibraryPath })
    } catch {}
  }
  const refCap = resolveReferenceImageCapability(catCfg, protocol, category, String(catCfg.model || ''))
  let refs = null
  let finalPrompt = character.prompt || cleanPrompt
  let characterInjection = 'none'
  if (character.mentioned.length > 0) {
    if (refCap.supported && !(protocol === 'volcengine-seedance' && imageUrl)) {
      const images = loadReferenceImagePayloads(character.references, { maxImages: refCap.maxImages })
      if (images.length > 0) {
        refs = { mode: refCap.mode, images }
        characterInjection = 'reference-images'
      }
    }
    if (!refs) {
      finalPrompt = `${finalPrompt}\n${character.descriptionBlock}`.trim()
      characterInjection = 'text-description'
    }
  }
  // Explicit reference images (e.g. a film frame for an image-to-image publish-pack cover) — only sent to providers
  // that accept reference images; they go first, character references fill the remaining slots
  const explicitRefPaths = (Array.isArray(referenceImages) ? referenceImages : [])
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => resolve(p))
    .filter((p) => existsSync(p))
    .slice(0, 4)
  const referenceInfo = { requested: explicitRefPaths.length, used: 0, supported: Boolean(refCap.supported), mode: refCap.mode, reason: refCap.reason }
  let explicitSignatures = []
  if (explicitRefPaths.length > 0 && refCap.supported && !(protocol === 'volcengine-seedance' && imageUrl)) {
    const payloads = loadReferenceImagePayloads(
      explicitRefPaths.map((p) => ({ path: p, type: 'reference', signature: `file:${createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 24)}` })),
      { maxImages: refCap.maxImages },
    )
    if (payloads.length > 0) {
      const charImages = refs?.images || []
      refs = { mode: refCap.mode, images: [...payloads, ...charImages].slice(0, Math.max(1, refCap.maxImages)) }
      explicitSignatures = payloads.map((r) => r.signature)
      referenceInfo.used = payloads.length
    }
  }

  const vars = {
    prompt: finalPrompt,
    lyrics: String(lyrics || '').trim() || `[Instrumental]\n${finalPrompt}`,
    tags: String(tags || '').trim() || finalPrompt.slice(0, 60),
    title: String(title || '').trim() || finalPrompt.slice(0, 28),
    model: String(catCfg.model || '').trim(),
    duration: Number(durationSec) || 5,
    aspectRatio: String(aspectRatio || '16:9'),
    imageUrl: String(imageUrl || '').trim(),
    instrumental: Boolean(instrumental),
    apiKey,
    characterDescription: character.descriptionBlock || '',
    referenceImage: refs?.images?.[0]?.dataUri || '',
    referenceImagesList: refs ? refs.images.map((r) => r.dataUri) : [],
  }
  const ctx = {
    catCfg,
    protocol,
    category,
    apiKey,
    vars,
    lyrics,
    aspectRatio,
    durationSec,
    imageUrl,
    instrumental,
    fetchFn,
    signal,
    onProgress,
    pollIntervalMs,
    maxPolls,
    refs,
  }

  const targetRoot = resolveLedgerRoot(projectDir)
  const useLedger = ledger !== false
  const { paramsHash } = computeCloudParamsHash({
    providerId: catCfg.providerId,
    protocol,
    category,
    model: vars.model,
    baseUrl: catCfg.baseUrl,
    endpoint: catCfg.endpoint,
    prompt: finalPrompt,
    lyrics,
    tags,
    title,
    durationSec,
    aspectRatio,
    imageUrl,
    instrumental,
    // unchanged for character-only references; explicit reference images (cover frames) are part of the params too
    referenceSignatures: refs ? [...explicitSignatures, ...(characterInjection === 'reference-images' ? character.referenceSignatures : [])] : [],
    custom: protocol === 'custom' ? catCfg.custom : null,
    extraParams: catCfg.extraParams,
  })
  const characterInfo = {
    mentioned: character.mentioned,
    injection: characterInjection,
    referenceCount: refs?.images?.length || 0,
    referenceMode: refCap.mode,
    referenceSupport: refCap.reason,
  }
  const deliverArgs = { targetRoot, projectDir, category, catCfg, protocol, vars, cleanPrompt, lyrics, instrumental, sceneId, stageOnly, autoBindToScript, signal, onProgress, fileOut, referenceInfo }

  const activeKey = `${targetRoot}::${paramsHash}::${fileOut ? `file:${fileOut.subdir}` : stageOnly ? 'stage' : 'project'}`
  if (useLedger && ACTIVE_CLOUD_JOBS.has(activeKey)) {
    onProgress?.({ stage: 'cloud-dedupe', progress: 30, message: '检测到相同参数的云端任务正在进行中，已合并等待同一结果（不会重复扣费）...' })
    const shared = await ACTIVE_CLOUD_JOBS.get(activeKey)
    // The joined caller did not pay: never count the shared result as a second paid submission
    return { ...shared, joinedInFlight: true, ...(shared?.ledger ? { ledger: { ...shared.ledger, paidSubmission: false, joined: true } } : {}) }
  }

  const work = (async () => {
    const decide = (p) =>
      useLedger
        ? decideLedgerAction(p, {
            stageOnly,
            forceNew,
            resultExists: p ? ledgerResultExists(targetRoot, p) : false,
            ownerAlive: Boolean(p && p.status === LEDGER_STATUS.SUBMITTING && isProcessAlive(p.pid)),
            ...(resubmitHoldMs !== undefined ? { resubmitHoldMs } : {}),
          })
        : { action: 'new', reason: 'ledger-disabled' }
    let prev = useLedger ? findLatestLedgerJob(targetRoot, paramsHash) : null
    let decision = decide(prev)
    let job = null
    if (decision.action === 'new') {
      // Brand-new PAID submission: budget gate first, then persist the ledger entry BEFORE sending. The create is a
      // compare-and-swap inside the ledger lock: when another request / process recorded a newer job for the same
      // params in the meantime, the slot is given back and the decision is re-made (resume / reuse / blocked).
      for (let attempt = 0; attempt < 4 && decision.action === 'new'; attempt++) {
        const budgetRef = { paramsHash, provider: catCfg.providerId || protocol, category }
        if (budget && typeof budget.consume === 'function') budget.consume(budgetRef)
        if (!useLedger) break
        try {
          job = createLedgerJob(
            targetRoot,
            {
              paramsHash,
              provider: catCfg.providerId || protocol,
              protocol,
              category,
              kind: inferPaidJobKind(category, protocol),
              model: vars.model,
              stageOnly: Boolean(stageOnly),
              sceneId: sceneId || '',
              runId: runId || '',
              promptPreview: String(finalPrompt).slice(0, 120),
              characterIds: character.mentioned.map((c) => c.id),
              decisionReason: decision.reason,
              previousJobId: prev?.id || '',
            },
            { expectLatestId: prev?.id || '', supersedeId: prev?.status === LEDGER_STATUS.SUBMITTING ? prev.id : '' },
          )
        } catch (err) {
          if (typeof budget?.release === 'function') budget.release(budgetRef)
          throw err
        }
        if (job) break
        if (typeof budget?.release === 'function') budget.release(budgetRef)
        prev = findLatestLedgerJob(targetRoot, paramsHash)
        decision = decide(prev)
      }
      if (useLedger && decision.action === 'new' && !job) {
        const err = new Error('付费任务账本出现并发写入冲突，为避免重复扣费已放弃本次提交，请稍后用相同参数重试（将自动续跑或复用结果）。')
        err.code = 'CLOUD_JOB_BLOCKED'
        throw err
      }
    }
    const ledgerInfo = (j) => ({
      jobId: j?.id || '',
      paramsHash,
      action: decision.action,
      reason: decision.reason,
      paidSubmission: decision.action === 'new',
    })

    if (decision.action === 'blocked') {
      const mins = Math.max(1, Math.ceil((Number(decision.holdRemainingMs) || 0) / 60000))
      const err = new Error(
        decision.reason === 'submission-in-flight'
          ? `相同参数的云端付费任务（${prev.id}）正在另一个请求/进程中提交，为避免重复扣费本次未提交；请稍候用相同参数重试，将自动续跑该任务或复用其结果。`
          : `相同参数的云端付费任务（${prev.id}）此前在提交途中中断，无法确认服务商是否已扣费。为避免重复扣费已暂停自动重提（约 ${mins} 分钟后解除）；如确认需要重新生成，请传入 forceNew: true 或修改提示词。`,
      )
      err.code = 'CLOUD_JOB_BLOCKED'
      err.ledgerJobId = prev.id
      throw err
    }

    if (decision.action === 'reuse') {
      onProgress?.({ stage: 'cloud-reuse', progress: 60, message: `检测到相同参数的云端任务已完成（${prev.id}），直接复用已付费的结果文件，未重复扣费。` })
      const reused = await deliverReusedCloudResult({ ...deliverArgs, job: prev })
      updateLedgerJob(targetRoot, prev.id, {
        delivered: true,
        resultPaths: reused.resultPaths,
        lastReusedAt: new Date().toISOString(),
        reuseCount: (Number(prev.reuseCount) || 0) + 1,
      })
      return { ...reused.result, reused: true, ledger: ledgerInfo(prev), character: characterInfo }
    }

    let result = null
    if (decision.action === 'resume') {
      job = updateLedgerJob(targetRoot, prev.id, { attempts: (Number(prev.attempts) || 1) + 1, resumedAt: new Date().toISOString(), pid: process.pid }) || prev
      onProgress?.({ stage: 'cloud-resume', progress: 26, message: `检测到相同参数的云端任务（${job.taskId || job.id}）已提交过，正在继续轮询原任务，不会重复提交或扣费...` })
      if (job.status === LEDGER_STATUS.RESULT_READY && job.resultUrl) {
        result = { resultVal: job.resultUrl, resultFormat: 'url', raw: { resumedFromLedger: true } }
      } else if (typeof adapter.poll === 'function' && job.taskId) {
        try {
          result = await adapter.poll(ctx, job)
        } catch (err) {
          throw recordLedgerFailure(targetRoot, job, err, 'poll', catCfg, category)
        }
      } else {
        throw new Error(`账本任务 ${job.id} 缺少可恢复的任务 ID`)
      }
    } else {
      // New paid submission: budget consumed + ledger entry (`submitting`) persisted above, BEFORE sending
      let sub
      try {
        sub = await adapter.submit(ctx)
      } catch (err) {
        throw recordLedgerFailure(targetRoot, job, err, 'submit', catCfg, category)
      }
      if (sub?.result) {
        result = sub.result
      } else {
        if (job) {
          job =
            updateLedgerJob(targetRoot, job.id, { status: LEDGER_STATUS.SUBMITTED, taskId: sub.taskId, resume: sub.resume || {}, submittedAt: new Date().toISOString() }) ||
            job
        }
        const pollJob = { ...(job || {}), taskId: sub.taskId, resume: sub.resume || {} }
        onProgress?.({ stage: 'cloud-submitted', progress: 26, message: `云端任务已提交（${sub.taskId}）并写入付费任务账本，开始轮询结果...` })
        try {
          result = await adapter.poll(ctx, pollJob)
        } catch (err) {
          throw recordLedgerFailure(targetRoot, job, err, 'poll', catCfg, category)
        }
      }
    }

    if (!result || !result.resultVal) {
      if (job?.id) updateLedgerJob(targetRoot, job.id, { status: LEDGER_STATUS.FAILED, error: '云端任务未返回有效结果', failedAt: new Date().toISOString() })
      throw new Error(`云端 ${category} 生成任务未返回有效结果`)
    }
    const isUrlResult = typeof result.resultVal === 'string' && /^https?:\/\//i.test(result.resultVal.trim())
    if (job?.id && isUrlResult) updateLedgerJob(targetRoot, job.id, { status: LEDGER_STATUS.RESULT_READY, resultUrl: result.resultVal.trim() })

    const outSubdir = fileOut ? fileOut.subdir : stageOnly ? '.staging' : categoryAssetSubdir(category)
    const outDir = join(targetRoot, outSubdir)
    const baseName = `${fileOut ? fileOut.prefix : 'cloud'}-${catCfg.providerId || category}-${Date.now()}`
    const defaultExt = category === 'video' ? '.mp4' : category === 'audio' ? '.mp3' : '.png'
    onProgress?.({ stage: 'cloud-save', progress: 92, message: stageOnly ? '正在保存至预览暂存区（确认满意后才会入库）...' : '正在下载并保存云端生成素材到本地工程...' })
    let savedAbs = ''
    try {
      savedAbs = await materializeOutputAsset({
        fetchFn,
        resultVal: result.resultVal,
        resultFormat: result.resultFormat,
        outDir,
        baseName,
        defaultExt,
        signal,
      })
    } catch (err) {
      // URL results stay `result_ready` (a retry re-downloads without paying again)
      if (job?.id) {
        updateLedgerJob(targetRoot, job.id, isUrlResult ? { lastError: String(err?.message || err).slice(0, 300) } : { status: LEDGER_STATUS.FAILED, error: String(err?.message || err).slice(0, 300) })
      }
      throw err
    }
    if (job?.id) {
      updateLedgerJob(targetRoot, job.id, { status: LEDGER_STATUS.COMPLETED, resultPaths: [relToLedgerRoot(targetRoot, savedAbs)], completedAt: new Date().toISOString() })
    }
    const delivered = await deliverCloudResult({ ...deliverArgs, savedAbs, ledgerJobId: job?.id || '' })
    if (job?.id) {
      updateLedgerJob(targetRoot, job.id, {
        delivered: true,
        deliveredAt: new Date().toISOString(),
        deliveredAs: delivered.staged ? 'staging' : 'project',
        ...(delivered.stagingItem?.stagingId ? { stagingId: delivered.stagingItem.stagingId } : {}),
        ...(delivered.asset?.id ? { assetId: delivered.asset.id } : {}),
      })
    }
    return { ...delivered, reused: false, ledger: ledgerInfo(job), character: characterInfo }
  })()

  if (useLedger) ACTIVE_CLOUD_JOBS.set(activeKey, work)
  try {
    return await work
  } finally {
    if (ACTIVE_CLOUD_JOBS.get(activeKey) === work) ACTIVE_CLOUD_JOBS.delete(activeKey)
  }
}

/**
 * Keep the paid-job ledger pointing at a result file after it moves (staging → project assets).
 */
function relinkLedgerResultPath(root, oldRel, newRel, jobId = '') {
  try {
    const ledgerJobs = readCloudLedger(root).jobs
    const job = ledgerJobs.find((j) => (jobId && j.id === jobId) || (j.resultPaths || []).includes(oldRel))
    if (!job) return null
    const paths = [newRel, ...(job.resultPaths || []).filter((p) => p !== oldRel && p !== newRel)]
    return updateLedgerJob(root, job.id, { resultPaths: paths, deliveredAs: 'project', committedAt: new Date().toISOString() })
  } catch {
    return null
  }
}

function getStagingManifestPath(projectDir) {
  const root = projectDir ? resolve(projectDir) : join(REPO_ROOT, '.tmp', 'cloud-media-sandbox')
  return join(root, '.staging', 'staging.json')
}

function loadStagingManifest(projectDir) {
  const root = projectDir ? resolve(projectDir) : join(REPO_ROOT, '.tmp', 'cloud-media-sandbox')
  const p = getStagingManifestPath(root)
  if (!existsSync(p)) return []
  try {
    const arr = JSON.parse(readFileSync(p, 'utf8'))
    return Array.isArray(arr) ? arr.filter((it) => it?.relPath && existsSync(join(root, it.relPath))) : []
  } catch {
    return []
  }
}

function saveStagingManifest(projectDir, items) {
  const root = projectDir ? resolve(projectDir) : join(REPO_ROOT, '.tmp', 'cloud-media-sandbox')
  const dir = join(root, '.staging')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'staging.json'), JSON.stringify(items || [], null, 2) + '\n', 'utf8')
}

export function listStagedCloudAssets(projectDir) {
  return loadStagingManifest(projectDir)
}

export async function commitStagedCloudAsset({ projectDir, stagingId, sceneId = '', bindAsBgm = true } = {}) {
  if (!projectDir) throw new Error('projectDir is required')
  if (!stagingId) throw new Error('stagingId is required')
  const root = resolve(projectDir)
  const items = loadStagingManifest(root)
  const item = items.find((x) => x.stagingId === stagingId)
  if (!item) throw new Error(`暂存区未找到该预览项: ${stagingId}`)
  const srcAbs = join(root, item.relPath)
  if (!existsSync(srcAbs)) throw new Error(`暂存文件不存在: ${item.relPath}`)

  const sub = item.category === 'audio' ? join('assets', 'audio') : item.category === 'video' ? join('assets', 'videos') : join('assets', 'images')
  const destDir = join(root, sub)
  mkdirSync(destDir, { recursive: true })
  const destFile = basename(srcAbs)
  const destAbs = join(destDir, destFile)
  copyFileSync(srcAbs, destAbs)
  const destRel = destAbs.slice(root.length + 1).replace(/\\/g, '/')

  const manifest = readAssets(root)
  const assetId = `cloud-${item.category}-${Date.now().toString(36)}`
  const registeredAsset = {
    id: assetId,
    name: `${item.title || item.providerId} (云端验收采用)`,
    originalName: destFile,
    path: destRel,
    type: item.category === 'audio' ? 'audio' : item.category === 'video' ? 'video' : 'image',
    role: item.category === 'audio' ? 'music' : 'visual',
    source: `cloud:${item.providerId}`,
    prompt: item.prompt || '',
    durationSec: item.durationSec || undefined,
    importedAt: new Date().toISOString(),
  }
  manifest.items = [...(manifest.items || []), registeredAsset]
  writeAssets(root, manifest)

  let beatMeta = null
  if (existsSync(join(root, 'script.json'))) {
    const { data } = readScriptJson(root)
    if (item.category === 'audio' && bindAsBgm) {
      try {
        beatMeta = await analyzeAudioBeatStructure(destAbs)
      } catch {}
      data.bgmMode = 'uploaded'
      data.bgm = {
        ...(data.bgm || {}),
        ...(beatMeta || {}),
        enabled: true,
        mode: 'uploaded',
        source: `cloud:${item.providerId}`,
        path: destRel,
        uploadedPath: destRel,
      }
      writeScriptJson(root, data)
    } else if ((sceneId || item.sceneId) && Array.isArray(data.scenes)) {
      const targetScId = sceneId || item.sceneId
      const sc = data.scenes.find((s) => s.id === targetScId)
      if (sc) {
        sc.media = [{ assetId, path: destRel, type: item.category, source: `cloud:${item.providerId}` }]
        sc.mediaPath = destRel
        sc.mediaType = item.category
        writeScriptJson(root, data)
      }
    }
  }

  // Remove from staging after commit (the paid-job ledger now points at the committed file)
  relinkLedgerResultPath(root, item.relPath, destRel, item.ledgerJobId || '')
  try { rmSync(srcAbs, { force: true }) } catch {}
  const remaining = items.filter((x) => x.stagingId !== stagingId)
  saveStagingManifest(root, remaining)

  return {
    ok: true,
    asset: registeredAsset,
    path: destRel,
    beatMeta,
    remainingStaging: remaining,
  }
}

export function discardStagedCloudAsset({ projectDir, stagingId = '', clearAll = false } = {}) {
  const root = projectDir ? resolve(projectDir) : join(REPO_ROOT, '.tmp', 'cloud-media-sandbox')
  const items = loadStagingManifest(root)
  if (clearAll) {
    for (const it of items) {
      try { rmSync(join(root, it.relPath), { force: true }) } catch {}
    }
    saveStagingManifest(root, [])
    return { ok: true, remainingStaging: [] }
  }
  const hit = items.find((x) => x.stagingId === stagingId)
  if (hit) {
    try { rmSync(join(root, hit.relPath), { force: true }) } catch {}
  }
  const remaining = items.filter((x) => x.stagingId !== stagingId)
  saveStagingManifest(root, remaining)
  return { ok: true, remainingStaging: remaining }
}

/**
 * AI Prompt Assistant for ALL Cloud Media categories (Music Style + Lyrics, Image Prompt, Video Camera Prompt).
 */
export async function assistCloudMediaPrompt(options = {}) {
  const {
    category = 'audio',
    field = 'both', // 'both' | 'prompt' | 'lyrics'
    topic = '',
    sceneTitle = '',
    sceneNarration = '',
    style = 'cinematic',
    genreLabel = '',
    existingPrompt = '',
    instrumental = false,
    callLlmChatFn = null,
    signal,
  } = options

  const invoker = typeof callLlmChatFn === 'function' ? callLlmChatFn : (p) => callLlmChat({ ...p, signal })
  const cleanTopic = String(topic || sceneTitle || '史诗电影感创意短片').trim()
  const sysPrompt =
    category === 'audio'
      ? `你是顶级影视配乐制作人与词曲总监（精通 MiniMax Music 3 与 Suno v4.5/v5 提示词规范）。
请结合视频主题与情绪基调，输出严格 JSON（禁止 Markdown 围栏）：
{
  "prompt": "60~140字专业音乐风格、配器、BPM、情绪推进与混音质感描述（如：史诗古风战鼓融合重型电子摇滚与唢呐，92 BPM，前半段低沉弦乐铺陈，中段双踩战鼓与金属冲击瞬间爆发，电影级宽广声场）",
  "lyrics": "${instrumental ? '[Instrumental]\\n(纯音乐编排结构：[Intro] 低沉战鼓 -> [Build-up] 弦乐推进 -> [Drop] 震撼铜管与重鼓齐鸣 -> [Outro] 余韵收束)' : '完整带结构标签 [Intro] [Verse 1] [Chorus] [Bridge] [Outro] 的高感染力中文歌词（每段4行，朗朗上口、紧扣主题）'}",
  "tags": "3~5个英文/中文音乐流派标签，逗号分隔",
  "title": "<=12字歌曲名"
}`
      : category === 'video'
        ? `你是顶级电影摄影指导兼 AI 视频生成提示词专家（精通 Seedance 2.5 / 可灵 Kling / MiniMax 海螺视频提示词）。
请结合当前视频主题与目标分镜内容，写出一段可直接用于云端生视频模型的电影级实拍画面与运镜提示词。
输出严格 JSON（禁止 Markdown 围栏）：
{
  "prompt": "80~160字专业视频生成提示词，明确：主体动作 + 镜头运动（如低角度跟拍/航拍俯冲/急推环绕）+ 光影氛围（逆光/丁达尔光/体积雾/电影色温）+ 物理细节（扬尘/火星/衣袂翻飞）+ 胶片质感与高帧率稳定性，无多余解释。"
}`
        : `你是顶级概念原画总监兼 AI 绘画提示词大师（精通即梦 Seedream / Flux Pro / GPT Image 1）。
请结合当前视频主题与目标分镜内容，写出一段高质量配图生成提示词。
输出严格 JSON（禁止 Markdown 围栏）：
{
  "prompt": "70~140字专业图像生成提示词，明确：核心视觉主体 + 电影级构图视角 + 配色与主副光影 + 材质细节 + 画面纯净无水印无乱码文字，适合直接用于 16:9/9:16 高清视频画面。"
}`

  const userPayload = {
    category,
    field,
    videoTopic: cleanTopic,
    genreLabel: genreLabel || style,
    style,
    sceneTitle: sceneTitle || undefined,
    sceneNarration: sceneNarration || undefined,
    existingDraft: existingPrompt || undefined,
    instrumental: Boolean(instrumental),
  }
  const reply = await invoker({
    system: sysPrompt,
    messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
    temperature: 0.65,
    maxTokens: 1600,
    timeoutMs: 90_000,
    responseFormat: 'json',
  })
  const parsed = extractJsonFromLlmText(reply?.text) || {}
  return {
    ok: true,
    category,
    prompt: String(parsed.prompt || reply?.text || '').trim(),
    lyrics: String(parsed.lyrics || '').trim(),
    tags: String(parsed.tags || '').trim(),
    title: String(parsed.title || '').trim(),
    model: reply?.model || '',
  }
}

// ---------------------------------------------------------------------------
// Auto B-roll sourcing policy: user's own assets → free stock (Pexels / Pixabay, when keys are
// configured) → paid generation (only when explicitly enabled: DSH_CLOUD_MAX_PAID_JOBS_PER_RUN > 0).
// ---------------------------------------------------------------------------

const MEDIA_CAPABLE_LAYOUTS = new Set(['app-focus-shot', 'media-split-motion', 'card-fan-opener', 'split-wipe-compare', 'multi-window-trio', 'mosaic-pulse-wall', 'compare-dual'])
const NON_BROLL_ROLES = new Set(['avatar_base', 'host_video', 'voice_clone', 'brand_mark'])

function cleanSceneText(s = '') {
  return String(s || '')
    .replace(/[【】[\]「」"'“”‘’《》<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function deriveBrollQuery(scene = {}) {
  const explicit = cleanSceneText(scene.brollQuery || scene.stockQuery || '')
  if (explicit) return explicit.slice(0, 80)
  const parts = [scene.title, ...(Array.isArray(scene.highlights) ? scene.highlights.slice(0, 2) : [])].map(cleanSceneText).filter(Boolean)
  return (parts.join(' ') || cleanSceneText(scene.narration).slice(0, 24) || '城市 风景').slice(0, 80)
}

export function deriveBrollPrompt(scene = {}) {
  const base =
    cleanSceneText(scene.brollPrompt || '') ||
    cleanSceneText(scene.visualBlueprint || '') ||
    `${cleanSceneText(scene.title)}，${cleanSceneText(scene.narration).slice(0, 120)}`
  return `${base.slice(0, 300)}。电影级实拍质感 B-roll 画面，构图干净，无文字、无水印、无字幕。`
}

function orientationForAspect(aspectRatio = '16:9') {
  const [w, h] = String(aspectRatio || '16:9').split(':').map(Number)
  if (w > 0 && h > 0) return w > h ? 'landscape' : w < h ? 'portrait' : 'square'
  return 'landscape'
}

/**
 * Decide, per scene without media, where auto B-roll should come from. Pure (no network, no writes).
 * Order: user's imported-but-unused visuals → free stock (keys configured) → paid generation
 * (only if explicitly enabled and within the per-run cap). Locked / diorama / no-broll scenes are skipped.
 */
export function resolveMediaSourcingPlan({
  projectDir = '',
  script = null,
  assetsManifest = null,
  cloudConfig = null,
  stockConfig = null,
  autoUseCloudBroll,
  allowPaid,
  maxPaidJobsPerRun,
  mediaType = 'image',
  sceneIds = null,
} = {}) {
  const sc = script || (projectDir ? readScriptJson(projectDir).data : {})
  const assets = assetsManifest || (projectDir ? readAssets(projectDir) : { items: [] })
  const cfg = cloudConfig || loadCloudMediaConfig()
  const stock = stockConfig || getStockMediaConfig()
  const maxPaid = resolveMaxPaidJobsPerRun(maxPaidJobsPerRun)
  const paidCategory = mediaType === 'video' ? 'video' : 'image'
  const paidCfg = cfg?.[paidCategory] || {}
  const paidProviderReady =
    Boolean(String(paidCfg.apiKey || '').trim()) || (paidCfg.protocol === 'custom' && Boolean(String(paidCfg.custom?.submitUrl || '').trim()))
  const paidEnabled = allowPaid !== false && maxPaid > 0 && paidProviderReady
  const enabled = autoUseCloudBroll !== undefined ? Boolean(autoUseCloudBroll) : Boolean(cfg?.autoUseCloudBroll)

  const visuals = (assets.items || []).filter((it) => (it.type === 'image' || it.type === 'video') && !NON_BROLL_ROLES.has(it.role))
  const used = new Set((sc.scenes || []).flatMap((s) => (Array.isArray(s.media) ? s.media : []).map((m) => m?.path).filter(Boolean)))
  const unusedVisuals = visuals.filter((v) => !used.has(v.path) && !(v.editedPath && used.has(v.editedPath)))

  const scenes = []
  let userIdx = 0
  let paidPlanned = 0
  for (const s of sc.scenes || []) {
    if (Array.isArray(sceneIds) && sceneIds.length > 0 && !sceneIds.includes(s.id)) continue
    const base = { sceneId: s.id, title: s.title || '' }
    if (Array.isArray(s.media) && s.media.length > 0) {
      scenes.push({ ...base, needsMedia: false, source: 'existing', reason: '场景已有素材' })
      continue
    }
    if (isSceneLocked(s)) {
      scenes.push({ ...base, needsMedia: false, source: 'skip', reason: '场景已锁定（人工保护）' })
      continue
    }
    if (s.noBroll || s.explicitZeroAsset) {
      scenes.push({ ...base, needsMedia: false, source: 'skip', reason: '场景声明无需实拍素材' })
      continue
    }
    if (s.stageSpec || s.layout === 'narrative-diorama') {
      scenes.push({ ...base, needsMedia: false, source: 'skip', reason: '叙事立体场景（stageSpec）不使用实拍 B-roll' })
      continue
    }
    if (userIdx < unusedVisuals.length) {
      const a = unusedVisuals[userIdx++]
      scenes.push({ ...base, needsMedia: true, source: 'user-assets', assetId: a.id, assetPath: a.editedPath || a.path, webPath: a.editedWebPath || a.webPath || '', mediaType: a.type, width: Number(a.editedWidth || a.width || 0), height: Number(a.editedHeight || a.height || 0), reason: '优先使用用户已导入但尚未使用的素材（免费）' })
      continue
    }
    if (stock.anyConfigured) {
      scenes.push({ ...base, needsMedia: true, source: 'free-stock', query: deriveBrollQuery(s), mediaType, provider: stock.configured.pexels ? 'pexels' : 'pixabay', reason: '使用免费正版素材库（Pexels / Pixabay 官方 API）' })
      continue
    }
    if (paidEnabled && paidPlanned < maxPaid) {
      paidPlanned++
      scenes.push({ ...base, needsMedia: true, source: 'paid-generation', category: paidCategory, prompt: deriveBrollPrompt(s), providerId: paidCfg.providerId || '', reason: `已显式开启付费生成（本次运行上限 ${maxPaid} 个）` })
      continue
    }
    scenes.push({
      ...base,
      needsMedia: true,
      source: 'none',
      reason:
        maxPaid <= 0
          ? '未配置免费素材库 Key，且未开启付费生成（DSH_CLOUD_MAX_PAID_JOBS_PER_RUN=0），不会产生任何费用'
          : !paidProviderReady
            ? `付费生成服务（${paidCategory}）未配置 API Key`
            : `付费生成已达本次运行上限 ${maxPaid} 个`,
    })
  }
  const summary = { userAssets: 0, freeStock: 0, paid: 0, none: 0, skipped: 0, existing: 0 }
  for (const p of scenes) {
    if (p.source === 'user-assets') summary.userAssets++
    else if (p.source === 'free-stock') summary.freeStock++
    else if (p.source === 'paid-generation') summary.paid++
    else if (p.source === 'none') summary.none++
    else if (p.source === 'skip') summary.skipped++
    else summary.existing++
  }
  return {
    ok: true,
    enabled,
    order: ['user-assets', 'free-stock', 'paid-generation'],
    policy: {
      autoUseCloudBroll: enabled,
      stockConfigured: stock.configured,
      paidEnabled,
      paidProviderReady,
      maxPaidJobsPerRun: maxPaid,
      paidCategory,
      paidProviderId: paidCfg.providerId || '',
    },
    scenes,
    summary,
  }
}

function bindAssetToScene(absDir, sceneId, media) {
  const { data } = readScriptJson(absDir)
  const sc = (data.scenes || []).find((s) => s.id === sceneId)
  if (!sc || isSceneLocked(sc)) return false
  sc.media = [
    {
      assetId: media.assetId,
      path: media.path,
      webPath: media.webPath || '',
      type: media.type || 'image',
      source: media.source || 'user-assets',
      width: Number(media.width || 0),
      height: Number(media.height || 0),
    },
  ]
  sc.assetPaths = [media.path]
  writeScriptJson(absDir, data)
  return true
}

/**
 * Execute a sourcing plan. Billing errors stop immediately (CloudBillingError); budget exhaustion and
 * transient failures only skip that scene (paid jobs stay resumable in the ledger).
 */
export async function executeMediaSourcingPlan({
  projectDir,
  plan,
  budget = null,
  runId = '',
  fetchImpl = null,
  stockFetchImpl = null,
  stockApiKeys = {},
  stockCacheDir = '',
  providerOverride = null,
  signal,
  onLog,
  generateFn = generateCloudMediaAsset,
  searchFn = searchStockMedia,
  importFn = importStockMedia,
} = {}) {
  if (!projectDir) throw new Error('projectDir is required')
  const absDir = resolve(projectDir)
  const log = (msg, level = 'info') => {
    try {
      onLog?.(msg, level)
    } catch {}
  }
  const applied = []
  const skipped = []
  const errors = []
  let paidSubmitted = 0
  let paidReused = 0
  const script0 = readScriptJson(absDir).data
  const aspect = script0.aspectRatio || '16:9'
  const orientation = orientationForAspect(aspect)
  const byId = new Map((script0.scenes || []).map((s) => [s.id, s]))
  const paidAllowed = Boolean(plan?.policy?.paidEnabled)

  const tryPaid = async (item, scene) => {
    const category = item.category || plan?.policy?.paidCategory || 'image'
    try {
      const res = await generateFn({
        projectDir: absDir,
        category,
        prompt: item.prompt || deriveBrollPrompt(scene),
        aspectRatio: aspect,
        durationSec: Math.max(4, Math.min(10, Math.round(Number(scene?.durationSec) || 5))),
        sceneId: item.sceneId,
        autoBindToScript: true,
        stageOnly: false,
        budget,
        runId,
        fetchImpl,
        signal,
        characterIds: Array.isArray(scene?.characterIds) ? scene.characterIds : [],
        ...(providerOverride ? { providerOverride } : {}),
      })
      if (res?.ledger?.paidSubmission) paidSubmitted++
      else paidReused++
      if (res?.bindSkipped) {
        skipped.push({ sceneId: item.sceneId, source: 'paid-generation', reason: '场景已锁定（人工保护），生成结果已入库但未绑定' })
        return true
      }
      applied.push({ sceneId: item.sceneId, source: 'paid-generation', assetPath: res?.path || '', reused: Boolean(res?.reused), ledgerJobId: res?.ledger?.jobId || '' })
      log(`场景 ${item.sceneId} 已获得付费 B-roll${res?.reused ? '（复用已付费结果，未重复扣费）' : ''}：${res?.path || ''}`)
      return true
    } catch (err) {
      if (err?.code === 'CLOUD_BUDGET_EXCEEDED' || err instanceof CloudBudgetExceededError) {
        skipped.push({ sceneId: item.sceneId, source: 'paid-generation', reason: err.message })
        log(err.message, 'warn')
        return false
      }
      if (err?.name === 'AbortError' || signal?.aborted) throw err
      if (isBillingError(err)) throw toBillingError(err, { scope: 'cloud', provider: item.providerId || plan?.policy?.paidProviderId || '' })
      errors.push({ sceneId: item.sceneId, source: 'paid-generation', message: err?.message || String(err) })
      log(`场景 ${item.sceneId} 付费 B-roll 未完成（已记录到付费任务账本，可稍后续跑）：${err?.message || err}`, 'warn')
      return false
    }
  }

  for (const item of (plan?.scenes || []).filter((x) => x.needsMedia)) {
    if (signal?.aborted) throw createAbortError()
    const scene = byId.get(item.sceneId) || {}
    if (item.source === 'user-assets') {
      if (bindAssetToScene(absDir, item.sceneId, { assetId: item.assetId, path: item.assetPath, webPath: item.webPath, type: item.mediaType, width: item.width, height: item.height, source: 'user-assets' })) {
        applied.push({ sceneId: item.sceneId, source: 'user-assets', assetPath: item.assetPath })
      }
      continue
    }
    if (item.source === 'free-stock') {
      let done = false
      try {
        const isVideo = item.mediaType === 'video'
        const longSide = isVideo ? 1280 : 1024
        const sr = await searchFn({
          query: item.query,
          mediaType: item.mediaType,
          orientation,
          minWidth: orientation === 'portrait' ? 0 : longSide,
          minHeight: orientation === 'portrait' ? longSide : 0,
          ...(isVideo ? { minDurationSec: Math.max(2, Math.ceil(Number(scene.durationSec) || 4)), maxDurationSec: 60 } : {}),
          perPage: 8,
          fetchImpl: stockFetchImpl || fetchImpl,
          cacheDir: stockCacheDir,
          apiKeys: stockApiKeys,
        })
        const pick = sr?.ok ? (sr.results || []).find((r) => r.downloadUrl) : null
        if (pick) {
          const imp = await importFn({ projectDir: absDir, item: pick, sceneId: item.sceneId, query: item.query, fetchImpl: stockFetchImpl || fetchImpl, apiKeys: stockApiKeys, signal })
          if (imp?.bindSkipped) {
            skipped.push({ sceneId: item.sceneId, source: 'free-stock', reason: '场景已锁定（人工保护），素材已导入但未绑定' })
          } else {
            applied.push({ sceneId: item.sceneId, source: 'free-stock', provider: pick.provider, assetPath: imp?.asset?.path || '', attribution: imp?.attribution?.attribution || '' })
            log(`场景 ${item.sceneId} 已使用免费素材（${pick.provider}）：${imp?.attribution?.attribution || imp?.asset?.path || ''}`)
          }
          done = true
        } else {
          log(`场景 ${item.sceneId} 免费素材库未检索到合适结果（${item.query}）`, 'warn')
        }
      } catch (err) {
        if (err?.name === 'AbortError' || signal?.aborted) throw err
        errors.push({ sceneId: item.sceneId, source: 'free-stock', message: err?.message || String(err) })
      }
      if (done) continue
      if (paidAllowed && (!budget || typeof budget.canSpend !== 'function' || budget.canSpend())) {
        await tryPaid({ ...item, category: plan?.policy?.paidCategory || 'image', prompt: deriveBrollPrompt(scene) }, scene)
      } else {
        skipped.push({ sceneId: item.sceneId, source: 'free-stock', reason: '免费素材库无可用结果，且未开启付费生成' })
      }
      continue
    }
    if (item.source === 'paid-generation') {
      await tryPaid(item, scene)
      continue
    }
    skipped.push({ sceneId: item.sceneId, source: item.source, reason: item.reason || '无可用素材来源' })
  }

  // Scenes that received B-roll while on a zero-asset layout switch to a media layout (diorama scenes never)
  const appliedIds = new Set(applied.map((a) => a.sceneId))
  if (appliedIds.size > 0) {
    const { data } = readScriptJson(absDir)
    let touched = false
    for (const s of data.scenes || []) {
      if (!appliedIds.has(s.id) || isSceneLocked(s)) continue
      s.brollSource = applied.find((a) => a.sceneId === s.id)?.source || ''
      if (!MEDIA_CAPABLE_LAYOUTS.has(s.layout) && !s.stageSpec) {
        s.layoutBeforeBroll = s.layout || ''
        s.layout = 'media-split-motion'
      }
      touched = true
    }
    if (touched) writeScriptJson(absDir, data)
  }
  return {
    ok: true,
    applied,
    skipped,
    errors,
    paidSubmitted,
    paidReused,
    budget: typeof budget?.summary === 'function' ? budget.summary() : null,
  }
}
