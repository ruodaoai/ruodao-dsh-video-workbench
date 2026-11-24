/**
 * @dsh-video/tool-media — Free Stock Media Search via OFFICIAL APIs only
 *
 * - Pexels API  : https://api.pexels.com/v1/search  ·  https://api.pexels.com/videos/search
 *                 (header `Authorization: <PEXELS_API_KEY>`)
 * - Pixabay API : https://pixabay.com/api/  ·  https://pixabay.com/api/videos/  (query `key=<PIXABAY_API_KEY>`)
 *
 * Keys: saved in the Studio (cloud-media config `stock` section — 「免费素材」 tab / 「设置 · 云端生成」, masked on read)
 * take precedence over `.env` / environment `PEXELS_API_KEY` / `PIXABAY_API_KEY`; changes apply without a restart.
 *
 * No scraping. Responses are normalised (thumb, preview, size, duration, author, source page,
 * license), cached for 24 h under `.dsh-home/stock-cache` (Pixabay's caching requirement), and
 * provider rate limits (response headers + local sliding window + HTTP 429) are respected.
 * `importStockMedia` downloads a chosen item from the provider's official CDN into the project via
 * the regular asset import path, keeping attribution metadata in `assets.json`.
 */
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { loadEnv, readScriptJson, resolveEnvPath, writeScriptJson } from '../shared/index.js'
import { importAssets, readAssets, writeAssets } from './asset-manager.js'
import { readCloudMediaConfigFile } from './cloud-config-file.js'
import { readJsonSafe, writeJsonAtomic } from './safe-json-store.js'
import { isSceneLocked } from './scene-locks.js'

export const STOCK_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024

export const STOCK_PROVIDERS = {
  pexels: {
    id: 'pexels',
    name: 'Pexels',
    envKey: 'PEXELS_API_KEY',
    photoSearchUrl: 'https://api.pexels.com/v1/search',
    videoSearchUrl: 'https://api.pexels.com/videos/search',
    photoByIdUrl: 'https://api.pexels.com/v1/photos/',
    videoByIdUrl: 'https://api.pexels.com/videos/videos/',
    license: {
      name: 'Pexels License',
      url: 'https://www.pexels.com/license/',
      attributionRequired: false,
      notes: '可免费商用，无需署名（建议注明作者与 Pexels）；禁止原样转售或暗示人物/品牌背书。',
    },
    cdnHosts: ['images.pexels.com', 'videos.pexels.com', 'player.vimeo.com'],
    // Official default limit: 200 requests / hour
    window: { limit: 200, ms: 60 * 60 * 1000 },
  },
  pixabay: {
    id: 'pixabay',
    name: 'Pixabay',
    envKey: 'PIXABAY_API_KEY',
    photoSearchUrl: 'https://pixabay.com/api/',
    videoSearchUrl: 'https://pixabay.com/api/videos/',
    license: {
      name: 'Pixabay Content License',
      url: 'https://pixabay.com/service/license-summary/',
      attributionRequired: false,
      notes: '可免费商用，无需署名（建议注明作者与 Pixabay）；禁止原样转售、禁止用于误导性或违法用途。',
    },
    cdnHosts: ['pixabay.com', 'cdn.pixabay.com'],
    // Official default limit: 100 requests / 60 seconds
    window: { limit: 100, ms: 60 * 1000 },
  },
}

const rateState = new Map() // providerId -> { calls: number[], remaining: number|null, resetAt: number }

/** Free sign-up pages for the API keys (shown next to the key fields in the Studio). */
export const STOCK_KEY_SIGNUP_URLS = Object.freeze({ pexels: 'https://www.pexels.com/api/', pixabay: 'https://pixabay.com/api/docs/' })
/** Field names of the keys inside the cloud-media config's `stock` section. */
export const STOCK_KEY_FIELDS = Object.freeze({ pexels: 'pexelsApiKey', pixabay: 'pixabayApiKey' })
const KEEP_EXISTING = 'KEEP_EXISTING'

/** Keys saved in the Studio (cloud-media config file, `stock` section); '' when not saved. */
export function readSavedStockKeys(stockSection) {
  const st = stockSection === undefined ? readCloudMediaConfigFile()?.stock : stockSection
  const pick = (field) => (st && typeof st[field] === 'string' ? st[field].trim() : '')
  return { pexels: pick(STOCK_KEY_FIELDS.pexels), pixabay: pick(STOCK_KEY_FIELDS.pixabay) }
}

/**
 * Effective stock keys. Precedence: explicit `overrides` (an empty string means "no key") → keys saved in the Studio
 * (「免费素材」 / 「设置 · 云端生成」) → `.env` / environment (`PEXELS_API_KEY` / `PIXABAY_API_KEY`).
 * `sources` says where each key came from: 'override' | 'saved' | 'env' | ''.
 */
export function getStockMediaConfig(overrides = {}) {
  loadEnv()
  const saved = readSavedStockKeys()
  const pick = (id, overrideVal) => {
    if (overrideVal !== undefined && overrideVal !== null) {
      const key = String(overrideVal).trim()
      return { key, source: key ? 'override' : '' }
    }
    if (saved[id]) return { key: saved[id], source: 'saved' }
    const envVal = String(process.env[STOCK_PROVIDERS[id].envKey] || '').trim()
    return { key: envVal, source: envVal ? 'env' : '' }
  }
  const px = pick('pexels', overrides.pexelsApiKey)
  const pb = pick('pixabay', overrides.pixabayApiKey)
  return {
    keys: { pexels: px.key, pixabay: pb.key },
    configured: { pexels: Boolean(px.key), pixabay: Boolean(pb.key) },
    sources: { pexels: px.source, pixabay: pb.source },
    anyConfigured: Boolean(px.key || pb.key),
  }
}

/** `abcd***wxyz` (same convention as the other masked keys in the Studio); never the key itself. */
export function maskStockKey(k = '') {
  const s = String(k || '').trim()
  if (!s) return ''
  if (s.length <= 8) return '***'
  return `${s.slice(0, 4)}***${s.slice(-4)}`
}

/**
 * Masked status of both stock keys for the UI (no key is ever returned). `stockSection` = the config's `stock` section
 * when the caller already loaded it.
 */
export function getStockKeySummary(stockSection) {
  loadEnv()
  const saved = readSavedStockKeys(stockSection)
  const one = (id) => {
    const envKey = STOCK_PROVIDERS[id].envKey
    const envVal = String(process.env[envKey] || '').trim()
    const source = saved[id] ? 'saved' : envVal ? 'env' : ''
    return {
      id,
      name: STOCK_PROVIDERS[id].name,
      configured: Boolean(source),
      source,
      sourceLabel: source === 'saved' ? (envVal ? '已保存（优先于 .env）' : '已保存') : source === 'env' ? '来自 .env' : '未配置',
      hasSavedKey: Boolean(saved[id]),
      hasEnvKey: Boolean(envVal),
      savedKeyMasked: maskStockKey(saved[id]),
      envKeyMasked: maskStockKey(envVal),
      envKey,
      signupUrl: STOCK_KEY_SIGNUP_URLS[id],
    }
  }
  const pexels = one('pexels')
  const pixabay = one('pixabay')
  return { pexels, pixabay, anyConfigured: pexels.configured || pixabay.configured }
}

/**
 * Apply a stock-key patch from the Studio to the saved `stock` section (pure; the caller persists it).
 *   { pexelsApiKey | pixabayApiKey: '<key>' }  → save; '' / 'KEEP_EXISTING' / a masked value (`***`) → keep the stored key
 *   { clearPexels | clearPixabay: true }       → delete the stored key (an `.env` key then applies again)
 */
export function applyStockKeyPatch(cur = {}, patch = {}) {
  const next = {
    [STOCK_KEY_FIELDS.pexels]: typeof cur?.[STOCK_KEY_FIELDS.pexels] === 'string' ? cur[STOCK_KEY_FIELDS.pexels].trim() : '',
    [STOCK_KEY_FIELDS.pixabay]: typeof cur?.[STOCK_KEY_FIELDS.pixabay] === 'string' ? cur[STOCK_KEY_FIELDS.pixabay].trim() : '',
  }
  if (!patch || typeof patch !== 'object') return next
  for (const id of ['pexels', 'pixabay']) {
    const field = STOCK_KEY_FIELDS[id]
    const cap = id === 'pexels' ? 'Pexels' : 'Pixabay'
    if (patch[`clear${cap}`] === true) {
      next[field] = ''
      continue
    }
    const v = patch[field]
    if (typeof v !== 'string') continue
    const t = v.trim()
    if (!t || t === KEEP_EXISTING || t.includes('***')) continue
    if (t.length > 512 || /[\s\u0000-\u001f]/.test(t)) {
      const err = new Error(`${STOCK_PROVIDERS[id].name} API Key 格式不对：不能包含空格或换行，请重新复制完整的 Key`)
      err.status = 400
      err.expose = true
      throw err
    }
    next[field] = t
  }
  return next
}

export function getStockCacheDir(override = '') {
  if (override) return resolve(override)
  return join(resolveEnvPath('DSH_VIDEO_HOME', './.dsh-home'), 'stock-cache')
}

function notConfiguredResult(extra = {}) {
  return {
    ok: false,
    configured: false,
    status: '未配置',
    message:
      '未配置免费素材库 API Key：在工作台「版本历史与工程安全 → 免费素材」或「设置 · 模型与密钥 → 云端生成」里填写 Pexels 或 Pixabay 的 API Key（均可在官网免费申请），保存后立即可以检索；也可以写在 .env 的 PEXELS_API_KEY / PIXABAY_API_KEY。',
    results: [],
    ...extra,
  }
}

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return dflt
  return Math.max(lo, Math.min(hi, n))
}

function normalizeOrientation(o) {
  const s = String(o || '').toLowerCase()
  if (['landscape', 'horizontal', '横屏', '16:9'].includes(s)) return 'landscape'
  if (['portrait', 'vertical', '竖屏', '9:16'].includes(s)) return 'portrait'
  if (['square', '1:1', '方形'].includes(s)) return 'square'
  return ''
}

function orientationOf(w, h) {
  if (!(w > 0 && h > 0)) return ''
  const r = w / h
  if (r > 1.08) return 'landscape'
  if (r < 0.93) return 'portrait'
  return 'square'
}

function cacheKeyFor(provider, mediaType, params) {
  return createHash('sha1').update(JSON.stringify({ provider, mediaType, ...params })).digest('hex')
}

function readCache(cacheDir, key, nowMs) {
  const p = join(cacheDir, `${key}.json`)
  const hit = readJsonSafe(p, null)
  if (!hit || !Array.isArray(hit.results)) return null
  if (nowMs - Number(hit.cachedAtMs || 0) > STOCK_CACHE_TTL_MS) return null
  return hit
}

function pruneCache(cacheDir, nowMs) {
  try {
    for (const name of readdirSync(cacheDir)) {
      if (!name.endsWith('.json')) continue
      const p = join(cacheDir, name)
      try {
        if (nowMs - statSync(p).mtimeMs > STOCK_CACHE_TTL_MS) unlinkSync(p)
      } catch {}
    }
  } catch {}
}

function writeCache(cacheDir, key, payload) {
  try {
    mkdirSync(cacheDir, { recursive: true })
    writeJsonAtomic(join(cacheDir, `${key}.json`), payload)
  } catch {}
}

function checkLocalRateWindow(providerId, nowMs) {
  const spec = STOCK_PROVIDERS[providerId].window
  const st = rateState.get(providerId) || { calls: [], remaining: null, resetAt: 0 }
  st.calls = st.calls.filter((t) => nowMs - t < spec.ms)
  rateState.set(providerId, st)
  if (st.remaining !== null && st.remaining <= 0 && st.resetAt > nowMs) {
    return { allowed: false, retryAfterSec: Math.ceil((st.resetAt - nowMs) / 1000) }
  }
  if (st.calls.length >= spec.limit) {
    return { allowed: false, retryAfterSec: Math.ceil((spec.ms - (nowMs - st.calls[0])) / 1000) }
  }
  return { allowed: true, retryAfterSec: 0 }
}

function recordRateHeaders(providerId, resp, nowMs) {
  const st = rateState.get(providerId) || { calls: [], remaining: null, resetAt: 0 }
  st.calls.push(nowMs)
  const get = (k) => {
    try {
      return resp?.headers?.get?.(k)
    } catch {
      return null
    }
  }
  const remaining = Number(get('x-ratelimit-remaining'))
  const reset = Number(get('x-ratelimit-reset'))
  if (Number.isFinite(remaining) && get('x-ratelimit-remaining') !== null) st.remaining = remaining
  if (Number.isFinite(reset) && reset > 0) {
    // Pexels sends a UNIX timestamp; Pixabay sends seconds until reset
    st.resetAt = reset > 1e9 ? reset * 1000 : nowMs + reset * 1000
  }
  rateState.set(providerId, st)
}

/** Test helper: forget local rate-limit state. */
export function resetStockRateLimitState() {
  rateState.clear()
}

function pickPexelsVideoFile(files = [], { minWidth = 0, minHeight = 0 } = {}) {
  const mp4 = files.filter((f) => f?.link && (!f.file_type || /mp4/i.test(f.file_type)))
  const ok = mp4
    .filter((f) => Number(f.width || 0) >= minWidth && Number(f.height || 0) >= minHeight)
    .sort((a, b) => Number(a.width || 0) * Number(a.height || 0) - Number(b.width || 0) * Number(b.height || 0))
  // Prefer the smallest rendition meeting the minimum, but not below 720p when available (disk-friendly)
  const hd = ok.find((f) => Math.min(Number(f.width || 0), Number(f.height || 0)) >= 720)
  return hd || ok[ok.length - 1] || mp4.sort((a, b) => Number(b.width || 0) - Number(a.width || 0))[0] || null
}

export function normalizePexelsPhoto(p = {}, { minWidth = 0 } = {}) {
  const src = p.src || {}
  const downloadUrl = minWidth > 1880 || !src.large2x ? src.original || src.large2x || src.large : src.large2x
  return {
    id: `pexels:image:${p.id}`,
    provider: 'pexels',
    providerItemId: String(p.id),
    mediaType: 'image',
    thumb: src.tiny || src.small || src.medium || '',
    preview: src.medium || src.large || '',
    downloadUrl: downloadUrl || '',
    width: Number(p.width || 0),
    height: Number(p.height || 0),
    orientation: orientationOf(Number(p.width), Number(p.height)),
    sizeBytes: null,
    durationSec: null,
    author: { name: p.photographer || '', url: p.photographer_url || '' },
    sourcePage: p.url || '',
    license: STOCK_PROVIDERS.pexels.license,
    alt: p.alt || '',
    tags: [],
    attribution: `Photo by ${p.photographer || 'Unknown'} on Pexels`,
  }
}

export function normalizePexelsVideo(v = {}, { minWidth = 0, minHeight = 0 } = {}) {
  const file = pickPexelsVideoFile(v.video_files || [], { minWidth, minHeight })
  return {
    id: `pexels:video:${v.id}`,
    provider: 'pexels',
    providerItemId: String(v.id),
    mediaType: 'video',
    thumb: v.image || v.video_pictures?.[0]?.picture || '',
    preview: (v.video_files || []).filter((f) => f?.link).sort((a, b) => Number(a.width || 0) - Number(b.width || 0))[0]?.link || file?.link || '',
    downloadUrl: file?.link || '',
    width: Number(file?.width || v.width || 0),
    height: Number(file?.height || v.height || 0),
    orientation: orientationOf(Number(v.width), Number(v.height)),
    sizeBytes: null,
    durationSec: Number(v.duration || 0) || null,
    author: { name: v.user?.name || '', url: v.user?.url || '' },
    sourcePage: v.url || '',
    license: STOCK_PROVIDERS.pexels.license,
    alt: '',
    tags: [],
    attribution: `Video by ${v.user?.name || 'Unknown'} on Pexels`,
  }
}

export function normalizePixabayImage(h = {}) {
  return {
    id: `pixabay:image:${h.id}`,
    provider: 'pixabay',
    providerItemId: String(h.id),
    mediaType: 'image',
    thumb: h.previewURL || '',
    preview: h.webformatURL || h.previewURL || '',
    downloadUrl: h.largeImageURL || h.webformatURL || '',
    width: Number(h.imageWidth || 0),
    height: Number(h.imageHeight || 0),
    orientation: orientationOf(Number(h.imageWidth), Number(h.imageHeight)),
    sizeBytes: Number(h.imageSize || 0) || null,
    durationSec: null,
    author: { name: h.user || '', url: h.user && h.user_id ? `https://pixabay.com/users/${encodeURIComponent(h.user)}-${h.user_id}/` : '' },
    sourcePage: h.pageURL || '',
    license: STOCK_PROVIDERS.pixabay.license,
    alt: '',
    tags: String(h.tags || '').split(',').map((s) => s.trim()).filter(Boolean),
    attribution: `Image by ${h.user || 'Unknown'} on Pixabay`,
  }
}

export function normalizePixabayVideo(h = {}, { minWidth = 0, minHeight = 0 } = {}) {
  const renditions = ['tiny', 'small', 'medium', 'large']
    .map((k) => ({ key: k, ...(h.videos?.[k] || {}) }))
    .filter((r) => r.url)
  const meets = renditions.filter((r) => Number(r.width || 0) >= minWidth && Number(r.height || 0) >= minHeight)
  const pick = meets.find((r) => Math.min(Number(r.width || 0), Number(r.height || 0)) >= 720) || meets[meets.length - 1] || renditions[renditions.length - 1] || null
  const smallest = renditions[0] || pick
  return {
    id: `pixabay:video:${h.id}`,
    provider: 'pixabay',
    providerItemId: String(h.id),
    mediaType: 'video',
    thumb: smallest?.thumbnail || pick?.thumbnail || '',
    preview: smallest?.url || '',
    downloadUrl: pick?.url || '',
    width: Number(pick?.width || 0),
    height: Number(pick?.height || 0),
    orientation: orientationOf(Number(pick?.width), Number(pick?.height)),
    sizeBytes: Number(pick?.size || 0) || null,
    durationSec: Number(h.duration || 0) || null,
    author: { name: h.user || '', url: h.user && h.user_id ? `https://pixabay.com/users/${encodeURIComponent(h.user)}-${h.user_id}/` : '' },
    sourcePage: h.pageURL || '',
    license: STOCK_PROVIDERS.pixabay.license,
    alt: '',
    tags: String(h.tags || '').split(',').map((s) => s.trim()).filter(Boolean),
    attribution: `Video by ${h.user || 'Unknown'} on Pixabay`,
  }
}

function applyClientFilters(results, { orientation, minWidth, minHeight, minDurationSec, maxDurationSec }) {
  return results.filter((r) => {
    if (!r.downloadUrl) return false
    if (orientation && r.orientation && r.orientation !== orientation) return false
    if (minWidth && r.width && r.width < minWidth) return false
    if (minHeight && r.height && r.height < minHeight) return false
    if (r.mediaType === 'video') {
      if (minDurationSec && r.durationSec && r.durationSec < minDurationSec) return false
      if (maxDurationSec && r.durationSec && r.durationSec > maxDurationSec) return false
    }
    return true
  })
}

async function fetchProviderJson(fetchFn, providerId, url, init, nowMs) {
  const resp = await fetchFn(url, init)
  recordRateHeaders(providerId, resp, nowMs)
  const status = Number(resp?.status || 0)
  const text = typeof resp?.text === 'function' ? await resp.text() : ''
  if (status === 429) {
    const retryAfter = Number(resp?.headers?.get?.('retry-after') || 0)
    const err = new Error(`${STOCK_PROVIDERS[providerId].name} 免费素材接口触发频率限制 (HTTP 429)${retryAfter ? `，请 ${retryAfter}s 后再试` : '，请稍后再试'}`)
    err.status = 429
    err.rateLimited = true
    throw err
  }
  if (!resp?.ok) {
    const err = new Error(
      isInvalidKeyResponse(providerId, status, text)
        ? invalidKeyMessage(providerId, status)
        : `${STOCK_PROVIDERS[providerId].name} 接口返回错误 (HTTP ${status}): ${String(text).slice(0, 200)}`,
    )
    err.status = status
    throw err
  }
  try {
    return JSON.parse(text || '{}')
  } catch {
    throw new Error(`${STOCK_PROVIDERS[providerId].name} 返回了无法解析的 JSON`)
  }
}

/** 401 / 403 (Pexels) or Pixabay's `[ERROR 400] Invalid or missing API key` → the key is wrong. */
function isInvalidKeyResponse(providerId, status, text = '') {
  if (status === 401 || status === 403) return true
  return providerId === 'pixabay' && status === 400 && /api\s*key/i.test(String(text))
}

function invalidKeyMessage(providerId, status) {
  const name = STOCK_PROVIDERS[providerId].name
  return `${name} API Key 无效或已失效（HTTP ${status}）：请到 ${STOCK_KEY_SIGNUP_URLS[providerId]} 检查 Key 是否复制完整，然后在「免费素材」里重新填写保存。`
}

/**
 * 「测试连接」: one cheap, uncached request with a typed (not yet saved) key or the effective saved / .env key.
 * Pexels: GET /v1/curated?per_page=1 · Pixabay: GET /api/?q=nature&per_page=3. Never returns or logs the key.
 * → { ok, provider, source: 'typed'|'saved'|'env', status, message, invalidKey?, rateLimited?, configured? }
 */
export async function testStockMediaKey({ provider = 'pexels', apiKey = '', fetchImpl = null, now = Date.now(), timeoutMs = 15_000 } = {}) {
  const id = provider === 'pixabay' ? 'pixabay' : 'pexels'
  const P = STOCK_PROVIDERS[id]
  const typed = typeof apiKey === 'string' ? apiKey.trim() : ''
  const useTyped = Boolean(typed) && typed !== KEEP_EXISTING && !typed.includes('***')
  if (useTyped && (typed.length > 512 || /[\s\u0000-\u001f]/.test(typed))) {
    return { ok: false, provider: id, source: 'typed', invalidKey: true, message: `${P.name} API Key 格式不对：不能包含空格或换行，请重新复制完整的 Key` }
  }
  const cfg = getStockMediaConfig()
  const key = useTyped ? typed : cfg.keys[id]
  const source = useTyped ? 'typed' : cfg.sources[id]
  if (!key) return { ok: false, provider: id, configured: false, source: '', message: `还没有填写 ${P.name} API Key：先粘贴 Key 再测试（可在 ${STOCK_KEY_SIGNUP_URLS[id]} 免费申请）` }
  const scrub = (s) => String(s || '').split(key).join('***')
  const gate = checkLocalRateWindow(id, now)
  if (!gate.allowed) {
    return { ok: false, provider: id, source, rateLimited: true, message: `${P.name} 已达到官方频率上限，约 ${gate.retryAfterSec} 秒后再测试` }
  }
  let url
  let init
  if (id === 'pexels') {
    url = 'https://api.pexels.com/v1/curated?per_page=1'
    init = { method: 'GET', headers: { Authorization: key } }
  } else {
    const u = new URL(P.photoSearchUrl)
    u.searchParams.set('key', key)
    u.searchParams.set('q', 'nature')
    u.searchParams.set('per_page', '3')
    u.searchParams.set('safesearch', 'true')
    url = u.toString()
    init = { method: 'GET' }
  }
  const fetchFn = fetchImpl || globalThis.fetch
  const t0 = Date.now()
  let resp
  try {
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined
    resp = await fetchFn(url, { ...init, ...(signal ? { signal } : {}) })
  } catch (err) {
    const why = scrub(err?.cause?.code || err?.message || err)
    return { ok: false, provider: id, source, message: `连接不上 ${P.name}：请检查网络或代理是否可用（${why}）` }
  }
  recordRateHeaders(id, resp, now)
  const status = Number(resp?.status || 0)
  const latencyMs = Date.now() - t0
  let text = ''
  try {
    text = typeof resp?.text === 'function' ? await resp.text() : ''
  } catch {}
  if (resp?.ok) {
    return { ok: true, provider: id, source, status, latencyMs, message: `${P.name} 连接成功，API Key 可以使用（${latencyMs} 毫秒）` }
  }
  if (isInvalidKeyResponse(id, status, text)) return { ok: false, provider: id, source, status, invalidKey: true, message: invalidKeyMessage(id, status) }
  if (status === 429) {
    return { ok: false, provider: id, source, status, rateLimited: true, message: `${P.name} 提示请求太频繁 (HTTP 429)：Key 本身可能是有效的，请稍后再测试` }
  }
  return { ok: false, provider: id, source, status, message: scrub(`${P.name} 返回错误 (HTTP ${status})：${String(text).slice(0, 160)}`) }
}

async function searchOneProvider(providerId, mediaType, q, opts) {
  const { key, fetchFn, cacheDir, noCache, nowMs } = opts
  const params = {
    query: q.query,
    orientation: q.orientation,
    minWidth: q.minWidth,
    minHeight: q.minHeight,
    minDurationSec: q.minDurationSec,
    maxDurationSec: q.maxDurationSec,
    page: q.page,
    perPage: q.perPage,
    locale: q.locale,
  }
  const cacheKey = cacheKeyFor(providerId, mediaType, params)
  if (!noCache) {
    const cached = readCache(cacheDir, cacheKey, nowMs)
    if (cached) return { provider: providerId, results: cached.results, total: cached.total || cached.results.length, cached: true }
  }
  const gate = checkLocalRateWindow(providerId, nowMs)
  if (!gate.allowed) {
    const err = new Error(`${STOCK_PROVIDERS[providerId].name} 已达到官方频率上限，已暂停请求（约 ${gate.retryAfterSec}s 后恢复）`)
    err.rateLimited = true
    err.retryAfterSec = gate.retryAfterSec
    throw err
  }

  let raw = null
  let results = []
  let total = 0
  if (providerId === 'pexels') {
    const base = mediaType === 'video' ? STOCK_PROVIDERS.pexels.videoSearchUrl : STOCK_PROVIDERS.pexels.photoSearchUrl
    const u = new URL(base)
    u.searchParams.set('query', q.query)
    u.searchParams.set('per_page', String(q.perPage))
    u.searchParams.set('page', String(q.page))
    if (q.orientation) u.searchParams.set('orientation', q.orientation)
    if (q.locale) u.searchParams.set('locale', q.locale)
    if (mediaType === 'video') {
      if (q.minWidth) u.searchParams.set('min_width', String(q.minWidth))
      if (q.minHeight) u.searchParams.set('min_height', String(q.minHeight))
      if (q.minDurationSec) u.searchParams.set('min_duration', String(q.minDurationSec))
      if (q.maxDurationSec) u.searchParams.set('max_duration', String(q.maxDurationSec))
    } else if (Math.max(q.minWidth, q.minHeight) >= 4000) {
      u.searchParams.set('size', 'large')
    } else if (Math.max(q.minWidth, q.minHeight) >= 2500) {
      u.searchParams.set('size', 'medium')
    }
    raw = await fetchProviderJson(fetchFn, 'pexels', u.toString(), { method: 'GET', headers: { Authorization: key } }, nowMs)
    total = Number(raw?.total_results || 0)
    results =
      mediaType === 'video'
        ? (raw?.videos || []).map((v) => normalizePexelsVideo(v, q))
        : (raw?.photos || []).map((p) => normalizePexelsPhoto(p, q))
  } else {
    const base = mediaType === 'video' ? STOCK_PROVIDERS.pixabay.videoSearchUrl : STOCK_PROVIDERS.pixabay.photoSearchUrl
    const u = new URL(base)
    u.searchParams.set('key', key)
    u.searchParams.set('q', String(q.query).slice(0, 100))
    u.searchParams.set('per_page', String(Math.max(3, q.perPage)))
    u.searchParams.set('page', String(q.page))
    u.searchParams.set('safesearch', 'true')
    if (q.locale) u.searchParams.set('lang', String(q.locale).slice(0, 2).toLowerCase())
    if (q.minWidth) u.searchParams.set('min_width', String(q.minWidth))
    if (q.minHeight) u.searchParams.set('min_height', String(q.minHeight))
    if (mediaType === 'image') {
      u.searchParams.set('image_type', 'photo')
      if (q.orientation === 'landscape') u.searchParams.set('orientation', 'horizontal')
      else if (q.orientation === 'portrait') u.searchParams.set('orientation', 'vertical')
    }
    raw = await fetchProviderJson(fetchFn, 'pixabay', u.toString(), { method: 'GET' }, nowMs)
    total = Number(raw?.totalHits || raw?.total || 0)
    results = mediaType === 'video' ? (raw?.hits || []).map((h) => normalizePixabayVideo(h, q)) : (raw?.hits || []).map((h) => normalizePixabayImage(h))
  }
  results = applyClientFilters(results, q)
  writeCache(cacheDir, cacheKey, { cachedAt: new Date(nowMs).toISOString(), cachedAtMs: nowMs, provider: providerId, mediaType, params, total, results })
  return { provider: providerId, results, total, cached: false }
}

/**
 * Search free stock photos / videos on Pexels and/or Pixabay.
 */
export async function searchStockMedia(options = {}) {
  const {
    query = '',
    mediaType = 'image',
    provider = 'auto',
    orientation = '',
    minWidth = 0,
    minHeight = 0,
    minDurationSec = 0,
    maxDurationSec = 0,
    page = 1,
    perPage = 15,
    locale = 'zh-CN',
    fetchImpl = null,
    cacheDir = '',
    noCache = false,
    apiKeys = {},
    now = Date.now(),
  } = options
  const cfg = getStockMediaConfig(apiKeys)
  const q = {
    query: String(query || '').trim(),
    orientation: normalizeOrientation(orientation),
    minWidth: clampInt(minWidth, 0, 8000, 0),
    minHeight: clampInt(minHeight, 0, 8000, 0),
    minDurationSec: clampInt(minDurationSec, 0, 3600, 0),
    maxDurationSec: clampInt(maxDurationSec, 0, 3600, 0),
    page: clampInt(page, 1, 100, 1),
    perPage: clampInt(perPage, 1, 80, 15),
    locale: String(locale || '').trim(),
  }
  const type = mediaType === 'video' ? 'video' : 'image'
  if (!q.query) throw new Error('请填写素材检索关键词 query')
  if (!cfg.anyConfigured) return notConfiguredResult({ query: q.query, mediaType: type })

  const wanted =
    provider === 'pexels' || provider === 'pixabay'
      ? [provider]
      : provider === 'all'
        ? ['pexels', 'pixabay']
        : cfg.configured.pexels
          ? ['pexels', ...(cfg.configured.pixabay ? ['pixabay'] : [])]
          : ['pixabay']
  const active = wanted.filter((p) => cfg.configured[p])
  if (active.length === 0) {
    return notConfiguredResult({
      query: q.query,
      mediaType: type,
      message: `所选素材源「${wanted.map((p) => STOCK_PROVIDERS[p].name).join(' / ')}」还没有 API Key：在「免费素材」里填写并保存它的 Key（或 .env 的 ${wanted.map((p) => STOCK_PROVIDERS[p].envKey).join(' / ')}），或把素材来源改成「自动」。`,
    })
  }
  const dir = getStockCacheDir(cacheDir)
  pruneCache(dir, now)
  const fetchFn = fetchImpl || globalThis.fetch
  const perProvider = []
  const errors = []
  for (const p of active) {
    // auto mode: query the first configured provider; fall through to the next one only on error / zero hits
    if (provider === 'auto' && perProvider.some((r) => r.results.length > 0)) break
    try {
      perProvider.push(await searchOneProvider(p, type, q, { key: cfg.keys[p], fetchFn, cacheDir: dir, noCache, nowMs: now }))
    } catch (err) {
      errors.push({ provider: p, message: err?.message || String(err), rateLimited: Boolean(err?.rateLimited), retryAfterSec: err?.retryAfterSec || 0 })
    }
  }
  const results = perProvider.flatMap((r) => r.results)
  return {
    ok: perProvider.length > 0,
    configured: true,
    status: perProvider.length > 0 ? 'ok' : 'error',
    query: q.query,
    mediaType: type,
    filters: q,
    providers: perProvider.map((r) => ({ provider: r.provider, total: r.total, returned: r.results.length, cached: r.cached })),
    results,
    errors,
    message: perProvider.length > 0 ? `共检索到 ${results.length} 条免版税素材` : errors.map((e) => e.message).join('；'),
  }
}

function assertOfficialCdnUrl(providerId, url) {
  let host = ''
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') throw new Error('仅允许 https 下载')
    host = u.hostname.toLowerCase()
  } catch (err) {
    throw new Error(`素材下载地址无效: ${err.message}`)
  }
  const allowed = STOCK_PROVIDERS[providerId]?.cdnHosts || []
  if (!allowed.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new Error(`拒绝下载：${host} 不是 ${STOCK_PROVIDERS[providerId]?.name || providerId} 官方素材 CDN`)
  }
}

async function resolveItemById(providerId, mediaType, itemId, { key, fetchFn, nowMs }) {
  if (providerId === 'pexels') {
    const url = `${mediaType === 'video' ? STOCK_PROVIDERS.pexels.videoByIdUrl : STOCK_PROVIDERS.pexels.photoByIdUrl}${encodeURIComponent(itemId)}`
    const raw = await fetchProviderJson(fetchFn, 'pexels', url, { method: 'GET', headers: { Authorization: key } }, nowMs)
    return mediaType === 'video' ? normalizePexelsVideo(raw) : normalizePexelsPhoto(raw)
  }
  const u = new URL(mediaType === 'video' ? STOCK_PROVIDERS.pixabay.videoSearchUrl : STOCK_PROVIDERS.pixabay.photoSearchUrl)
  u.searchParams.set('key', key)
  u.searchParams.set('id', String(itemId))
  const raw = await fetchProviderJson(fetchFn, 'pixabay', u.toString(), { method: 'GET' }, nowMs)
  const hit = raw?.hits?.[0]
  if (!hit) throw new Error(`Pixabay 未找到素材 id=${itemId}`)
  return mediaType === 'video' ? normalizePixabayVideo(hit) : normalizePixabayImage(hit)
}

async function downloadToFile(fetchFn, url, outPath, maxBytes, signal) {
  const resp = await fetchFn(url, { method: 'GET', signal })
  if (!resp?.ok) throw new Error(`素材下载失败 (HTTP ${resp?.status}): ${String(url).slice(0, 120)}`)
  const declared = Number(resp.headers?.get?.('content-length') || 0)
  if (declared && declared > maxBytes) {
    throw new Error(`素材文件过大 (${Math.round(declared / 1048576)}MB > ${Math.round(maxBytes / 1048576)}MB)，为保护磁盘空间已拒绝下载`)
  }
  if (resp.body && typeof resp.body.getReader === 'function') {
    let bytes = 0
    const nodeStream = Readable.fromWeb(resp.body)
    nodeStream.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > maxBytes) nodeStream.destroy(new Error(`素材文件超过 ${Math.round(maxBytes / 1048576)}MB 上限，已中止下载`))
    })
    try {
      await pipeline(nodeStream, createWriteStream(outPath))
    } catch (err) {
      try {
        unlinkSync(outPath)
      } catch {}
      throw err
    }
    return bytes
  }
  const buf = Buffer.from(await resp.arrayBuffer())
  if (buf.length > maxBytes) throw new Error(`素材文件超过 ${Math.round(maxBytes / 1048576)}MB 上限`)
  writeFileSync(outPath, buf)
  return buf.length
}

/**
 * Download a chosen stock item (normalised search result, or provider + mediaType + id) into the
 * project's assets via the existing import path and record attribution metadata in `assets.json`.
 */
export async function importStockMedia(options = {}) {
  const {
    projectDir,
    item = null,
    provider = '',
    mediaType = 'image',
    id = '',
    sceneId = '',
    query = '',
    fetchImpl = null,
    apiKeys = {},
    maxBytes = DEFAULT_MAX_DOWNLOAD_BYTES,
    signal,
  } = options
  if (!projectDir) throw new Error('projectDir is required')
  const absProject = resolve(projectDir)
  const cfg = getStockMediaConfig(apiKeys)
  const fetchFn = fetchImpl || globalThis.fetch
  const nowMs = Date.now()

  let chosen = item && typeof item === 'object' ? { ...item } : null
  const providerId = String(chosen?.provider || provider || '').toLowerCase()
  if (!STOCK_PROVIDERS[providerId]) throw new Error('请指定素材来源 provider（pexels 或 pixabay）')
  const type = (chosen?.mediaType || mediaType) === 'video' ? 'video' : 'image'
  const itemId = String(chosen?.providerItemId || id || String(chosen?.id || '').split(':').pop() || '').trim()
  if (!chosen?.downloadUrl) {
    if (!cfg.configured[providerId]) return notConfiguredResult({ provider: providerId })
    if (!itemId) throw new Error('缺少素材 id')
    chosen = await resolveItemById(providerId, type, itemId, { key: cfg.keys[providerId], fetchFn, nowMs })
  }
  assertOfficialCdnUrl(providerId, chosen.downloadUrl)

  const urlExt = extname(new URL(chosen.downloadUrl).pathname || '').toLowerCase()
  const ext = type === 'video' ? (['.mp4', '.webm', '.mov'].includes(urlExt) ? urlExt : '.mp4') : ['.jpg', '.jpeg', '.png', '.webp'].includes(urlExt) ? urlExt : '.jpg'
  const dlDir = join(absProject, 'uploads', 'stock')
  mkdirSync(dlDir, { recursive: true })
  // Provider ids are numeric; never let a caller-supplied id shape the file path (no separators / "..")
  const safeItemId = String(itemId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
  const fileName = `${providerId}-${type}-${safeItemId || Date.now().toString(36)}${ext}`
  const dlAbs = join(dlDir, fileName)
  let downloadedBytes = 0
  if (!existsSync(dlAbs)) {
    downloadedBytes = await downloadToFile(fetchFn, chosen.downloadUrl, dlAbs, maxBytes, signal)
  }

  const importRes = await importAssets({ projectDir: absProject, sources: [dlAbs] })
  const manifest = readAssets(absProject)
  const asset =
    [...(importRes.added || []), ...(importRes.existing || [])].find((it) => it.originalName === fileName) ||
    manifest.items.find((it) => it.originalName === fileName)
  if (!asset) throw new Error('素材已下载，但导入项目素材库失败')
  const stockMeta = {
    provider: providerId,
    providerName: STOCK_PROVIDERS[providerId].name,
    mediaType: type,
    itemId,
    author: chosen.author?.name || '',
    authorUrl: chosen.author?.url || '',
    sourcePage: chosen.sourcePage || '',
    license: chosen.license?.name || STOCK_PROVIDERS[providerId].license.name,
    licenseUrl: chosen.license?.url || STOCK_PROVIDERS[providerId].license.url,
    attribution: chosen.attribution || '',
    query: String(query || ''),
    importedAt: new Date().toISOString(),
  }
  const target = manifest.items.find((it) => it.id === asset.id)
  if (target) {
    target.source = `stock:${providerId}`
    target.stock = stockMeta
    target.attribution = stockMeta.attribution
    if (!target.description) target.description = chosen.alt || stockMeta.attribution
    writeAssets(absProject, manifest)
  }

  let boundSceneId = ''
  let bindSkipped = ''
  if (sceneId && existsSync(join(absProject, 'script.json'))) {
    const { data } = readScriptJson(absProject)
    const sc = (data.scenes || []).find((s) => s.id === sceneId)
    if (sc && isSceneLocked(sc)) {
      // Human edit protection: the asset is imported, but a locked scene's media is never replaced
      bindSkipped = 'scene-locked'
    } else if (sc) {
      sc.media = [{ assetId: asset.id, path: asset.path, webPath: asset.webPath || '', type, source: `stock:${providerId}`, width: Number(asset.width || chosen.width || 0), height: Number(asset.height || chosen.height || 0) }]
      sc.assetPaths = [asset.path]
      sc.mediaPath = asset.path
      sc.mediaType = type
      writeScriptJson(absProject, data)
      boundSceneId = sceneId
    }
  }
  return {
    ok: true,
    provider: providerId,
    mediaType: type,
    asset: target || asset,
    attribution: stockMeta,
    downloadedBytes,
    boundSceneId,
    ...(bindSkipped ? { bindSkipped } : {}),
    message: `已从 ${STOCK_PROVIDERS[providerId].name} 导入免版税${type === 'video' ? '视频' : '图片'}：${asset.path}（${stockMeta.attribution || stockMeta.license}）${bindSkipped ? `；场景 ${sceneId} 已锁定，未替换其素材（解锁后可再绑定）` : ''}`,
  }
}
