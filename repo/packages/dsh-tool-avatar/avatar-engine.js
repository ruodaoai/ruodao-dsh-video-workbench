import { spawn } from 'node:child_process'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  createAbortError,
  ffmpegAmixNoRescale,
  ffmpegPadTo,
  loadEnv,
  probeAudioDuration,
  readScriptJson,
  REPO_ROOT,
  resolveBinaries,
  resolveBrowserExecutable,
  resolveEnvPath,
  runCommandRedirected,
  writeScriptJson,
} from '../shared/index.js'
import { cloneRecordedVoice, executeGenerateSpeech } from '../dsh-tool-local-tts/index.js'
import { IMAGE_EXT_RX, LipsyncUnavailableError, resolveLipsyncConfig, runLipsync } from './lipsync-engine.js'

export const AVATAR_TEMPLATES = [
  {
    id: 'cyber-anchor',
    name: '赛博科技主理人',
    subtitle: 'Cyber Anchor · 深海青光环',
    primary: '#22D3EE',
    secondary: '#38BDF8',
    skin: '#F3D2C1',
    hair: '#0F172A',
    suit: '#111827',
    badge: 'CYBER HOST',
  },
  {
    id: 'editorial-mentor',
    name: '黑金质感顾问',
    subtitle: 'Executive Mentor · 琥珀金质感',
    primary: '#E5A93C',
    secondary: '#FBBF24',
    skin: '#ECC8B4',
    hair: '#1E293B',
    suit: '#18181B',
    badge: 'CHIEF ADVISOR',
  },
  {
    id: 'studio-creator',
    name: '活力创意播主',
    subtitle: 'Creator Studio · 电光紫珊瑚',
    primary: '#FB7185',
    secondary: '#818CF8',
    skin: '#F6D6C7',
    hair: '#312E81',
    suit: '#1E1B4B',
    badge: 'CREATOR AI',
  },
]

function readSavedAvatarConfig() {
  try {
    const cfgPath = join(resolveEnvPath('DSH_VIDEO_HOME', './.dsh-home'), 'avatar-config.json')
    if (existsSync(cfgPath)) return JSON.parse(readFileSync(cfgPath, 'utf8'))
  } catch {}
  return {}
}

export function saveAvatarConfig({ provider, endpoint, apiKey } = {}) {
  const dshHome = resolveEnvPath('DSH_VIDEO_HOME', './.dsh-home')
  mkdirSync(dshHome, { recursive: true })
  const cfgPath = join(dshHome, 'avatar-config.json')
  const prev = readSavedAvatarConfig()
  const rawKey = apiKey !== undefined ? String(apiKey).trim() : undefined
  const nextKey = rawKey === 'KEEP_EXISTING' || (rawKey && rawKey.includes('****')) ? prev.apiKey || '' : (rawKey ?? prev.apiKey ?? '')
  const next = {
    provider: String(provider ?? prev.provider ?? 'auto').trim().toLowerCase() || 'auto',
    endpoint: String(endpoint ?? prev.endpoint ?? '').trim(),
    apiKey: nextKey,
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(cfgPath, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return getAvatarProviderSummary()
}

function resolveAvatarAuthKey() {
  loadEnv()
  const fileCfg = readSavedAvatarConfig()
  return String(fileCfg.apiKey || process.env.AVATAR_API_KEY || '').trim()
}

export function getAvatarProviderSummary() {
  loadEnv()
  const fileCfg = readSavedAvatarConfig()
  const provider = String(fileCfg.provider || process.env.AVATAR_PROVIDER || 'auto').trim().toLowerCase() || 'auto'
  const endpoint = String(fileCfg.endpoint || process.env.AVATAR_ENDPOINT || '').trim()
  const apiKey = String(fileCfg.apiKey || process.env.AVATAR_API_KEY || '').trim()
  const timeoutMs = Math.max(15_000, Number(process.env.AVATAR_TIMEOUT_MS) || 180_000)
  return {
    provider,
    endpoint,
    hasApiKey: Boolean(apiKey),
    maskedApiKey: apiKey ? `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}` : '',
    neuralReady: Boolean(endpoint),
    timeoutMs,
  }
}

export function resolveSafeAvatarLayout(rawLayout) {
  const txt = String(rawLayout || '').trim().toLowerCase()
  if (['fullscreen', 'full', '全屏', '全屏口播'].includes(txt)) return 'fullscreen'
  if (['pip-bl', 'bl', 'bottom-left', '左下', '左下角', '左下角画中画'].includes(txt)) return 'pip-bl'
  if (['pip-br', 'br', 'bottom-right', '右下', '右下角', '右下角画中画'].includes(txt)) return 'pip-br'
  if (['off', 'none', '关闭'].includes(txt)) return 'off'
  return 'pip-br'
}

/**
 * Probe video / pixel format metadata cleanly with ffprobe.
 */
export async function probeVideoStream(filePath, signal) {
  const { ffprobe } = resolveBinaries()
  const res = await runCommandRedirected(
    ffprobe,
    [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_name,codec_type,width,height,pix_fmt:stream_tags=alpha_mode',
      '-of', 'json',
      filePath,
    ],
    { timeoutMs: 25_000, signal },
  )
  if (res.code !== 0) {
    throw new Error(`ffprobe video check failed: ${res.stderr}`)
  }
  const parsed = JSON.parse(res.stdout || '{}')
  const v = (parsed.streams || []).find((s) => s.codec_type === 'video') || {}
  const a = (parsed.streams || []).find((s) => s.codec_type === 'audio')
  const pixFmt = String(v.pix_fmt || '')
  // VP8/VP9 WebM keeps alpha in a side channel: ffprobe's native decoder reports yuv420p plus `alpha_mode=1`
  const alphaTag = String(v.tags?.alpha_mode ?? v.tags?.ALPHA_MODE ?? '').trim() === '1'
  return {
    durationSec: Number(Number(parsed?.format?.duration || 0).toFixed(3)),
    width: Number(v.width || 0),
    height: Number(v.height || 0),
    codec: String(v.codec_name || ''),
    pixFmt: alphaTag && pixFmt === 'yuv420p' ? 'yuva420p' : pixFmt,
    hasAlpha: alphaTag || pixFmt.includes('yuva') || pixFmt.includes('rgba') || pixFmt.includes('argb'),
    hasAudio: Boolean(a),
  }
}

/**
 * Extract per-frame speech RMS mouth-open envelope [0..1] from any audio/WAV file.
 */
export async function extractAudioRmsEnvelope(audioPath, fps = 30, durationSec = 5, signal) {
  const totalFrames = Math.max(15, Math.ceil(durationSec * fps))
  const env = new Array(totalFrames).fill(0.08)
  try {
    const tmpPcm = join(REPO_ROOT, '.tmp', `avatar-pcm-${Date.now()}.wav`)
    mkdirSync(dirname(tmpPcm), { recursive: true })
    const { ffmpeg } = resolveBinaries()
    await runCommandRedirected(
      ffmpeg,
      ['-y', '-i', audioPath, '-ac', '1', '-ar', '8000', '-f', 'wav', tmpPcm],
      { timeoutMs: 30_000, signal },
    )
    if (existsSync(tmpPcm)) {
      const buf = readFileSync(tmpPcm)
      try { unlinkSync(tmpPcm) } catch {}
      // Find 'data' chunk
      let offset = 12
      let dataStart = 44
      let dataLen = Math.max(0, buf.length - 44)
      while (offset + 8 <= buf.length) {
        const cid = buf.toString('ascii', offset, offset + 4)
        const csz = buf.readUInt32LE(offset + 4)
        if (cid === 'data') {
          dataStart = offset + 8
          dataLen = Math.min(csz, buf.length - dataStart)
          break
        }
        offset += 8 + csz + (csz % 2)
      }
      const samplesCount = Math.floor(dataLen / 2)
      const samplesPerFrame = Math.max(1, Math.floor(8000 / fps))
      let peakRms = 0.01
      const rawRms = []
      for (let f = 0; f < totalFrames; f++) {
        const startS = Math.floor(f * samplesPerFrame)
        let sumSq = 0
        let count = 0
        for (let i = 0; i < samplesPerFrame; i++) {
          const sIdx = startS + i
          if (sIdx < samplesCount) {
            const v = buf.readInt16LE(dataStart + sIdx * 2) / 32768
            sumSq += v * v
            count++
          }
        }
        const rms = count > 0 ? Math.sqrt(sumSq / count) : 0
        if (rms > peakRms) peakRms = rms
        rawRms.push(rms)
      }
      for (let f = 0; f < totalFrames; f++) {
        env[f] = Math.min(1, Math.max(0.04, Number((rawRms[f] / (peakRms * 0.72)).toFixed(3))))
      }
      return env
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err
  }
  for (let f = 0; f < totalFrames; f++) {
    env[f] = Number((0.25 + 0.55 * Math.abs(Math.sin(f * 0.42) * Math.cos(f * 0.19))).toFixed(3))
  }
  return env
}

/**
 * Call pluggable MuseTalk / LatentSync / HTTP lip-sync service configured in `.env`.
 */
async function invokeRemoteAvatarEndpoint({
  endpoint,
  apiKey,
  provider,
  avatarMode,
  audioPath,
  sourceMediaPath,
  presetId,
  chromaKeyColor,
  outRawPath,
  timeoutMs,
  signal,
}) {
  const cleanUrl = endpoint.replace(/\/+$/, '')
  const targetUrl = /\/generate/.test(cleanUrl) ? cleanUrl : `${cleanUrl}/api/generate_avatar`
  const audioB64 = existsSync(audioPath) ? readFileSync(audioPath).toString('base64') : ''
  const srcB64 = sourceMediaPath && existsSync(sourceMediaPath) ? readFileSync(sourceMediaPath).toString('base64') : ''
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener?.('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const resp = await fetch(targetUrl, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        provider,
        avatarMode,
        presetId,
        chromaKeyColor,
        audioExt: extname(audioPath) || '.wav',
        audioBase64: audioB64,
        sourceExt: sourceMediaPath ? extname(sourceMediaPath) : '',
        sourceMediaBase64: srcB64,
      }),
    })
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 240)}`)
    }
    const ctype = resp.headers.get('content-type') || ''
    if (ctype.includes('video/')) {
      const ab = await resp.arrayBuffer()
      mkdirSync(dirname(outRawPath), { recursive: true })
      writeFileSync(outRawPath, Buffer.from(ab))
      return { ok: true, rawPath: outRawPath, providerUsed: provider }
    }
    const data = await resp.json()
    if (data.videoBase64) {
      const clean = String(data.videoBase64).replace(/^data:.*?;base64,/, '')
      mkdirSync(dirname(outRawPath), { recursive: true })
      writeFileSync(outRawPath, Buffer.from(clean, 'base64'))
      return { ok: true, rawPath: outRawPath, providerUsed: data.provider || provider }
    }
    if (data.outputPath && existsSync(data.outputPath)) {
      mkdirSync(dirname(outRawPath), { recursive: true })
      copyFileSync(data.outputPath, outRawPath)
      return { ok: true, rawPath: outRawPath, providerUsed: data.provider || provider }
    }
    if (data.videoUrl) {
      const vResp = await fetch(data.videoUrl, { signal: controller.signal })
      if (!vResp.ok) throw new Error(`Failed downloading avatar video: HTTP ${vResp.status}`)
      mkdirSync(dirname(outRawPath), { recursive: true })
      writeFileSync(outRawPath, Buffer.from(await vResp.arrayBuffer()))
      return { ok: true, rawPath: outRawPath, providerUsed: data.provider || provider }
    }
    throw new Error('数字人接口未返回有效的视频流或 videoBase64/outputPath')
  } catch (err) {
    if (signal?.aborted) throw createAbortError()
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onAbort)
  }
}

/**
 * Create an oval/squircle studio alpha mask PNG in `.tmp` cleanly using FFmpeg geq on 1 single frame (fast).
 */
async function buildSquircleAlphaMaskPng(ffmpeg, width, height, outPngPath, signal) {
  const cx = (width / 2).toFixed(1)
  const cy = (height / 2).toFixed(1)
  const rx = (width * 0.45).toFixed(1)
  const ry = (height * 0.46).toFixed(1)
  // Smooth antialiased squircle/oval mask: white inside, black outside
  const lumExpr = `if(lte(pow((X-${cx})/${rx},4)+pow((Y-${cy})/${ry},4),1),255,if(lte(pow((X-${cx})/${rx},4)+pow((Y-${cy})/${ry},4),1.18),255*(1-(pow((X-${cx})/${rx},4)+pow((Y-${cy})/${ry},4)-1)/0.18),0))`
  const r = await runCommandRedirected(
    ffmpeg,
    [
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=black:s=${width}x${height}:d=0.1,format=gray,geq=lum='${lumExpr}'`,
      '-frames:v', '1',
      outPngPath,
    ],
    { timeoutMs: 20_000, signal },
  )
  return r.code === 0 && existsSync(outPngPath)
}

/**
 * Render crisp transparent AI Avatar HTML canvas animation -> RGBA PNG sequence -> yuva420p WebM.
 */
async function renderAiPresenterToAlphaWebm({
  presetId = 'cyber-anchor',
  rmsEnvelope,
  fps = 30,
  width = 480,
  height = 540,
  outWebmPath,
  chromaKeyFallbackColor = '#040812',
  signal,
  onProgress,
}) {
  const template = AVATAR_TEMPLATES.find((t) => t.id === presetId) || AVATAR_TEMPLATES[0]
  const browserBin = resolveBrowserExecutable()
  const { ffmpeg } = resolveBinaries()
  const totalFrames = rmsEnvelope.length
  const totalSec = Number((totalFrames / fps).toFixed(3))

  if (browserBin) {
    const tmpDir = join(REPO_ROOT, '.tmp', `avatar-cdp-${Date.now()}`)
    const frameDir = join(tmpDir, 'frames')
    const userDataDir = join(tmpDir, 'profile')
    mkdirSync(frameDir, { recursive: true })
    mkdirSync(userDataDir, { recursive: true })

    const htmlPath = join(tmpDir, 'avatar.html')
    writeFileSync(
      htmlPath,
      `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; width: ${width}px; height: ${height}px; background: transparent !important; overflow: hidden; }
  svg { width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
  <svg id="av" viewBox="0 0 480 540" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bgAura" cx="50%" cy="46%" r="48%">
        <stop offset="0%" stop-color="${template.primary}" stop-opacity="0.34"/>
        <stop offset="72%" stop-color="${template.secondary}" stop-opacity="0.14"/>
        <stop offset="100%" stop-color="#07090E" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="rimGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${template.primary}"/>
        <stop offset="100%" stop-color="${template.secondary}"/>
      </linearGradient>
      <clipPath id="stageClip"><circle cx="240" cy="245" r="196"/></clipPath>
    </defs>
    <circle id="pulseRing" cx="240" cy="245" r="218" fill="none" stroke="url(#rimGrad)" stroke-width="2.5" stroke-dasharray="14 8" opacity="0.72"/>
    <circle cx="240" cy="245" r="204" fill="#0B111E" fill-opacity="0.88" stroke="url(#rimGrad)" stroke-width="4"/>
    <circle cx="240" cy="245" r="200" fill="url(#bgAura)"/>
    <g clip-path="url(#stageClip)">
      <g id="rig">
        <!-- Shoulders / Studio Jacket -->
        <path d="M98,465 C106,358 168,332 240,332 C312,332 374,358 382,465 Z" fill="${template.suit}" stroke="${template.primary}" stroke-opacity="0.45" stroke-width="2"/>
        <path d="M210,334 L240,392 L270,334 Z" fill="#F8FAFC" opacity="0.9"/>
        <!-- Neck & Head -->
        <rect x="218" y="294" width="44" height="52" rx="18" fill="${template.skin}" opacity="0.92"/>
        <ellipse cx="240" cy="222" rx="76" ry="92" fill="${template.skin}"/>
        <!-- Hair -->
        <path d="M162,214 C162,138 205,112 246,112 C292,112 318,144 318,214 C300,174 268,164 236,164 C196,164 176,184 162,214 Z" fill="${template.hair}"/>
        <!-- Eyes + Blink lids -->
        <g id="eyes">
          <ellipse cx="212" cy="218" rx="9.5" ry="7" fill="#0F172A"/>
          <ellipse cx="268" cy="218" rx="9.5" ry="7" fill="#0F172A"/>
          <circle cx="215" cy="215.5" r="2.6" fill="#FFFFFF"/>
          <circle cx="271" cy="215.5" r="2.6" fill="#FFFFFF"/>
        </g>
        <!-- Dynamic Lips driven by RMS speech envelope -->
        <ellipse id="mouthOuter" cx="240" cy="264" rx="18" ry="4" fill="#9F1239"/>
        <ellipse id="mouthInner" cx="240" cy="264.5" rx="13" ry="1.5" fill="#4C0519"/>
      </g>
    </g>
    <!-- Bottom HUD Badge -->
    <rect x="132" y="458" width="216" height="36" rx="18" fill="#090D16" fill-opacity="0.9" stroke="${template.primary}" stroke-width="1.8"/>
    <text x="240" y="481" text-anchor="middle" fill="${template.primary}" font-family="Noto Sans SC, sans-serif" font-size="15" font-weight="800" letter-spacing="1.6">${template.badge}</text>
  </svg>
  <script>
    const RMS = ${JSON.stringify(rmsEnvelope)};
    window.__seekAvatar = (f) => {
      const idx = Math.max(0, Math.min(RMS.length - 1, Math.round(f)));
      const amp = RMS[idx] || 0.08;
      const t = idx / ${fps};
      const bobY = Math.sin(t * 2.4) * 3.2 - amp * 2.5;
      const tilt = Math.sin(t * 1.5) * 1.6;
      const blink = (idx % 95 >= 91) ? 0.14 : 1.0;
      document.getElementById('rig').setAttribute('transform', 'translate(0,' + bobY.toFixed(2) + ') rotate(' + tilt.toFixed(2) + ' 240 310)');
      document.getElementById('eyes').setAttribute('transform', 'translate(0,' + (218 * (1 - blink)).toFixed(2) + ') scale(1,' + blink.toFixed(2) + ')');
      const mouthRy = (2.8 + amp * 13.5).toFixed(2);
      const mouthRx = (15 + amp * 6).toFixed(2);
      document.getElementById('mouthOuter').setAttribute('rx', mouthRx);
      document.getElementById('mouthOuter').setAttribute('ry', mouthRy);
      document.getElementById('mouthInner').setAttribute('rx', (Number(mouthRx) * 0.72).toFixed(2));
      document.getElementById('mouthInner').setAttribute('ry', Math.max(1.2, Number(mouthRy) * 0.68).toFixed(2));
      const ring = document.getElementById('pulseRing');
      ring.setAttribute('transform', 'rotate(' + ((t * 24) % 360).toFixed(1) + ' 240 245)');
      ring.setAttribute('opacity', (0.48 + amp * 0.45).toFixed(2));
      return idx;
    };
    window.__seekAvatar(0);
  </script>
</body>
</html>`,
      'utf8',
    )

    const child = spawn(
      browserBin,
      [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--no-sandbox',
        '--hide-scrollbars',
        '--disable-dev-shm-usage',
        `--window-size=${width},${height}`,
        'about:blank',
      ],
      { stdio: 'ignore', windowsHide: true },
    )

    let ws = null
    const cleanupBrowser = () => {
      try { ws?.close() } catch {}
      try { child.kill('SIGKILL') } catch {}
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    }

    const abortHandler = () => cleanupBrowser()
    signal?.addEventListener?.('abort', abortHandler, { once: true })

    try {
      if (signal?.aborted) throw createAbortError()
      const activePortFile = join(userDataDir, 'DevToolsActivePort')
      let port = ''
      const deadline = Date.now() + 18_000
      while (Date.now() < deadline) {
        if (signal?.aborted) throw createAbortError()
        if (existsSync(activePortFile)) {
          const lines = readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/)
          if (lines[0] && /^\d+$/.test(lines[0])) {
            port = lines[0]
            break
          }
        }
        await new Promise((r) => setTimeout(r, 90))
      }
      if (!port) throw new Error('数字人渲染无头浏览器端口启动超时')

      let wsUrl = ''
      const tEnd = Date.now() + 10_000
      while (Date.now() < tEnd && !wsUrl) {
        try {
          const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
          wsUrl = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl)?.webSocketDebuggerUrl || ''
        } catch {}
        if (!wsUrl) await new Promise((r) => setTimeout(r, 90))
      }
      if (!wsUrl) throw new Error('无法建立数字人 Chromium CDP 页面连接')

      ws = new WebSocket(wsUrl)
      let nextId = 1
      const pending = new Map()
      const ready = new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true })
        ws.addEventListener('error', (e) => rej(new Error(e.message || 'CDP WS failed')), { once: true })
      })
      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(String(ev.data))
        if (msg.id && pending.has(msg.id)) {
          const { r, j } = pending.get(msg.id)
          pending.delete(msg.id)
          if (msg.error) j(new Error(msg.error.message))
          else r(msg.result)
        }
      })
      const send = async (method, params = {}) => {
        await ready
        if (signal?.aborted) throw createAbortError()
        const id = nextId++
        return new Promise((r, j) => {
          pending.set(id, { r, j })
          ws.send(JSON.stringify({ id, method, params }))
        })
      }

      await send('Page.enable')
      await send('Runtime.enable')
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
      await send('Page.navigate', { url: `file:///${htmlPath.replace(/\\/g, '/')}` })
      await new Promise((r) => setTimeout(r, 250))

      for (let f = 0; f < totalFrames; f++) {
        if (signal?.aborted) throw createAbortError()
        await send('Runtime.evaluate', { expression: `window.__seekAvatar(${f})` })
        const shot = await send('Page.captureScreenshot', { format: 'png', omitBackground: true })
        const outPng = join(frameDir, `f_${String(f).padStart(5, '0')}.png`)
        const fd = openSync(outPng, 'w')
        writeSync(fd, Buffer.from(shot.data, 'base64'))
        closeSync(fd)
        if (onProgress && (f % 15 === 0 || f === totalFrames - 1)) {
          onProgress({ pct: Math.min(88, Math.round(((f + 1) / totalFrames) * 85)), frame: f + 1, totalFrames })
        }
      }

      mkdirSync(dirname(outWebmPath), { recursive: true })
      const enc = await runCommandRedirected(
        ffmpeg,
        [
          '-y',
          '-framerate', String(fps),
          '-i', join(frameDir, 'f_%05d.png'),
          '-c:v', 'libvpx',
          '-pix_fmt', 'yuva420p',
          '-auto-alt-ref', '0',
          '-b:v', '1200k',
          '-deadline', 'realtime',
          '-cpu-used', '4',
          '-t', String(totalSec),
          '-an',
          outWebmPath,
        ],
        { timeoutMs: 180_000, signal },
      )
      if (enc.code !== 0 || !existsSync(outWebmPath)) {
        throw new Error(`Alpha WebM encode failed: ${enc.stderr}`)
      }
      return { ok: true, outputPath: outWebmPath, providerUsed: 'ai-chromium-canvas' }
    } finally {
      signal?.removeEventListener?.('abort', abortHandler)
      cleanupBrowser()
    }
  }

  // Fallback without Chromium: pure FFmpeg glowing presenter alpha silhouette
  const maskPng = join(dirname(outWebmPath), `.avatar-mask-${Date.now()}.png`)
  mkdirSync(dirname(outWebmPath), { recursive: true })
  await buildSquircleAlphaMaskPng(ffmpeg, width, height, maskPng, signal)
  const enc = await runCommandRedirected(
    ffmpeg,
    [
      '-y',
      '-f', 'lavfi', '-t', String(totalSec), '-r', String(fps), '-i', `color=c=${chromaKeyFallbackColor}:s=${width}x${height}`,
      '-loop', '1', '-i', maskPng,
      '-filter_complex', '[0:v]format=rgba[bg];[1:v]format=gray[m];[bg][m]alphamerge,format=yuva420p[v]',
      '-map', '[v]',
      '-c:v', 'libvpx', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
      '-t', String(totalSec), '-an', outWebmPath,
    ],
    { timeoutMs: 120_000, signal },
  )
  try { unlinkSync(maskPng) } catch {}
  if (enc.code !== 0 || !existsSync(outWebmPath)) {
    throw new Error(`Fallback Alpha WebM encode failed: ${enc.stderr}`)
  }
  return { ok: true, outputPath: outWebmPath, providerUsed: 'local-ffmpeg-composite' }
}

/**
 * Convert a human video or portrait image (plus optional chromakey color) into a clean
 * yuva420p transparent WebM presenter overlay synchronized to exact target audio duration.
 */
/**
 * Face-aware PiP framing: scale the source to cover the overlay box, zoom gently when the face is small and
 * place the lip-sync face box (normalised cx/cy/w from the engine) slightly above the box centre.
 * Returns an ffmpeg `scale,crop` chain or '' when it cannot be computed.
 */
export function computeFaceFraming({ srcW, srcH, width, height, focus, targetFaceFrac = 0.36, maxZoom = 1.8 }) {
  if (!focus || !(srcW > 0) || !(srcH > 0)) return ''
  const cx = Number(focus.cx)
  const cy = Number(focus.cy)
  const fw = Number(focus.w)
  if (![cx, cy, fw].every((v) => Number.isFinite(v) && v > 0 && v < 1.5)) return ''
  const cover = Math.max(width / srcW, height / srcH)
  const faceFrac = (fw * srcW * cover) / width
  const zoom = Math.max(1, Math.min(maxZoom, targetFaceFrac / Math.max(0.05, faceFrac)))
  const s = cover * zoom
  const sw = Math.max(width, Math.round((srcW * s) / 2) * 2)
  const sh = Math.max(height, Math.round((srcH * s) / 2) * 2)
  const x = Math.round(Math.min(Math.max(cx * sw - width / 2, 0), sw - width))
  const y = Math.round(Math.min(Math.max(cy * sh - height * 0.52, 0), sh - height))
  return `scale=${sw}:${sh},crop=${width}:${height}:${x}:${y}`
}

async function compositeClonedHumanToAlphaWebm({
  sourcePath,
  durationSec,
  fps = 30,
  width = 480,
  height = 540,
  chromaKeyColor = '',
  focus = null,
  outWebmPath,
  signal,
}) {
  const { ffmpeg } = resolveBinaries()
  const isImage = /\.(png|jpe?g|webp|bmp)$/i.test(sourcePath)
  const maskPng = join(REPO_ROOT, '.tmp', `human-mask-${Date.now()}.png`)
  mkdirSync(dirname(maskPng), { recursive: true })
  mkdirSync(dirname(outWebmPath), { recursive: true })
  await buildSquircleAlphaMaskPng(ffmpeg, width, height, maskPng, signal)

  let framing = ''
  if (focus && !isImage) {
    const meta = await probeVideoStream(sourcePath, signal).catch(() => null)
    framing = computeFaceFraming({ srcW: meta?.width, srcH: meta?.height, width, height, focus })
  }
  const baseFilter = isImage
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='1+0.04*sin(on*0.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps}`
    : `${framing || `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`},eq=contrast=1.06:saturation=1.08`

  const inputs = isImage
    ? ['-loop', '1', '-t', String(durationSec), '-i', sourcePath]
    : ['-stream_loop', '-1', '-t', String(durationSec), '-i', sourcePath]

  const filterComplex = chromaKeyColor
    ? `[0:v]${baseFilter},format=rgba,chromakey=${chromaKeyColor}:0.16:0.06,format=yuva420p[v]`
    : `[0:v]${baseFilter},format=rgba[fg];[1:v]format=gray[m];[fg][m]alphamerge,format=yuva420p[v]`

  const args = ['-y', ...inputs]
  if (!chromaKeyColor) {
    args.push('-loop', '1', '-t', String(durationSec), '-i', maskPng)
  }
  args.push(
    '-filter_complex', filterComplex,
    '-map', '[v]',
    '-r', String(fps),
    '-c:v', 'libvpx',
    '-pix_fmt', 'yuva420p',
    '-auto-alt-ref', '0',
    '-b:v', '1400k',
    '-deadline', 'realtime',
    '-cpu-used', '4',
    '-t', String(durationSec),
    '-an',
    outWebmPath,
  )

  const res = await runCommandRedirected(ffmpeg, args, { timeoutMs: 180_000, signal })
  try { unlinkSync(maskPng) } catch {}
  if (res.code !== 0 || !existsSync(outWebmPath)) {
    throw new Error(`Cloned human Alpha WebM encode failed: ${res.stderr}`)
  }
  return { ok: true, outputPath: outWebmPath }
}

/**
 * Normalise the `lipSync` option: 'auto' (default: use the configured engine, fall back quietly),
 * 'on' (strict: fail instead of falling back) or 'off'.
 */
export function normalizeLipSyncMode(raw) {
  if (raw === true) return 'on'
  if (raw === false) return 'off'
  const txt = String(raw ?? 'auto').trim().toLowerCase()
  if (['on', 'true', '1', 'yes', 'strict', 'required', '开启', '强制'].includes(txt)) return 'on'
  if (['off', 'false', '0', 'no', 'none', 'disabled', '关闭'].includes(txt)) return 'off'
  return 'auto'
}

/**
 * Build a dry narration track that sits exactly where `mixVideoAudio()` places each scene voice inside
 * `master-audio.wav` (scene.startSec + voiceLeadSec), padded to the whole timeline. Lip-syncing against this
 * track keeps the mouth in sync with the final render, because the avatar overlay plays from frame 0.
 */
export async function buildTimelineAlignedVoiceWav({ absDir, script, outWav, signal }) {
  const events = []
  for (const scene of script?.scenes || []) {
    const masteredAbs = scene.masteredAudioFile
      ? isAbsolute(scene.masteredAudioFile) ? scene.masteredAudioFile : resolve(absDir, scene.masteredAudioFile)
      : ''
    const rel = masteredAbs && existsSync(masteredAbs) ? scene.masteredAudioFile : scene.audioFile
    if (!rel) continue
    const abs = isAbsolute(rel) ? rel : resolve(absDir, rel)
    if (!existsSync(abs)) continue
    const leadSec = Number.isFinite(Number(scene.voiceLeadSec)) ? Number(scene.voiceLeadSec) : 0.3
    events.push({ path: abs, delayMs: Math.max(0, Math.round((Number(scene.startSec || 0) + leadSec) * 1000)) })
  }
  if (events.length === 0) return null
  let endSec = Number(script?.totalDurationSec) || 0
  for (const ev of events) {
    const meta = await probeAudioDuration(ev.path).catch(() => ({ durationSec: 0 }))
    ev.durationSec = Number(meta.durationSec) || 0
    endSec = Math.max(endSec, ev.delayMs / 1000 + ev.durationSec)
  }
  const { ffmpeg } = resolveBinaries()
  mkdirSync(dirname(outWav), { recursive: true })
  const inputs = events.flatMap((ev) => ['-i', ev.path])
  // Mono 24 kHz chains, each padded to the full length (keeps amix's scale constant on builds without `normalize=0`).
  // Older FFmpeg (the npm-bundled fallback) has neither `adelay all` nor `apad whole_dur`: for mono, one delay value is the
  // same as `all=1`, and whole_len (samples) is the same as whole_dur.
  const pad = ffmpegPadTo(endSec, 24000)
  const chains = events.map(
    (ev, i) => `[${i}:a]aformat=sample_fmts=fltp:sample_rates=24000:channel_layouts=mono,adelay=${ev.delayMs},${pad}[v${i}]`,
  )
  const mixIn = events.map((_, i) => `[v${i}]`).join('')
  const filter = `${chains.join(';')};${mixIn}${ffmpegAmixNoRescale(ffmpeg, events.length, { duration: 'longest', dropoutTransition: 0 })},${pad},atrim=0:${endSec.toFixed(3)}[out]`
  const res = await runCommandRedirected(
    ffmpeg,
    ['-y', ...inputs, '-filter_complex', filter, '-map', '[out]', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', outWav],
    { timeoutMs: 120_000, signal },
  )
  if (res.code !== 0 || !existsSync(outWav)) {
    throw new Error(`时间线对齐口播音轨生成失败: ${res.stderr.slice(-300)}`)
  }
  return { path: outWav, durationSec: Number(endSec.toFixed(3)), events: events.map((e) => ({ ...e, path: relative(absDir, e.path).replace(/\\/g, '/') })) }
}

/**
 * Main entrypoint (`generate_avatar` Cordis tool & API handler):
 * Generates either a Cloned Human Digital Presenter (real lip-sync via the pluggable engine layer when available)
 * or a Pure AI Digital Presenter as a transparent `yuva420p` `.webm` clip and writes `avatarClip` & `avatarLayout`
 * into `script.json`.
 */
export async function executeGenerateAvatar(options = {}) {
  loadEnv()
  const {
    projectDir,
    sceneId = '',
    avatarMode = 'ai-human', // 'cloned-human' | 'ai-human'
    sourceVideoPath = '',
    sourceImagePath = '',
    voiceId = 'auto',
    voiceSamplePath = '',
    voiceGender = 'neutral',
    narrationText = '',
    audioPath = '',
    avatarLayout = 'pip-br',
    presetId = 'cyber-anchor',
    chromaKeyColor = '',
    fps = 30,
    allowPlaceholder = false,
    lipSync = 'auto', // 'auto' | 'on' | 'off'
    lipsyncEngine = '', // override AVATAR_LIPSYNC_ENGINE for this call
    alignToTimeline = 'auto', // 'auto' | true | false
    signal,
    onProgress,
  } = options

  if (!projectDir) throw new Error('projectDir is required for generate_avatar')
  if (signal?.aborted) throw createAbortError()

  const absDir = resolve(projectDir)
  const layout = resolveSafeAvatarLayout(avatarLayout)
  // Fullscreen talking heads need more pixels than the 480x540 PiP card (same 8:9 aspect)
  const width = Number(options.width) > 0 ? Number(options.width) : layout === 'fullscreen' ? 960 : 480
  const height = Number(options.height) > 0 ? Number(options.height) : layout === 'fullscreen' ? 1080 : 540
  const cfg = getAvatarProviderSummary()
  const scriptObj = existsSync(join(absDir, 'script.json')) ? readScriptJson(absDir).data : null
  const lipSyncMode = normalizeLipSyncMode(lipSync)

  onProgress?.({ stage: 'avatar-prep', progress: 10, message: '1/4 正在准备数字人驱动音轨与声纹...' })

  // Step 1: Resolve or synthesize speech audio
  let resolvedVoiceId = voiceId || scriptObj?.defaultVoiceId || 'auto'
  if (voiceSamplePath && existsSync(resolve(absDir, voiceSamplePath))) {
    const absSample = resolve(absDir, voiceSamplePath)
    const cloned = await cloneRecordedVoice({
      sourcePath: absSample,
      name: `数字人克隆声纹-${Date.now().toString().slice(-4)}`,
      gender: voiceGender === 'male' || voiceGender === 'female' ? voiceGender : 'neutral',
    })
    if (cloned?.voice?.id) {
      resolvedVoiceId = cloned.voice.id
    }
  }

  let drivingWav = audioPath
    ? (isAbsolute(audioPath) ? audioPath : resolve(absDir, audioPath))
    : ''

  // Timeline alignment: a project-wide overlay plays from frame 0, so drive the mouth with the narration exactly
  // where master-audio.wav places it (also replaces the pipeline's gap-less concatenated dry vocal).
  let alignedInfo = null
  const sceneAudioAbs = (scriptObj?.scenes || [])
    .flatMap((s) => [s.masteredAudioFile, s.audioFile])
    .filter(Boolean)
    .map((p) => resolve(isAbsolute(p) ? p : resolve(absDir, p)).toLowerCase())
  const replaceableDrivers = new Set([
    ...sceneAudioAbs,
    resolve(absDir, 'output', 'avatar', 'driving-vocal.wav').toLowerCase(),
    resolve(absDir, 'output', 'master-audio.wav').toLowerCase(),
  ])
  const alignWanted =
    alignToTimeline === true ||
    String(alignToTimeline).toLowerCase() === 'true' ||
    (String(alignToTimeline).toLowerCase() === 'auto' && (!drivingWav || replaceableDrivers.has(resolve(drivingWav).toLowerCase())))
  if (!sceneId && scriptObj && sceneAudioAbs.length > 0 && alignWanted && String(alignToTimeline).toLowerCase() !== 'false') {
    try {
      alignedInfo = await buildTimelineAlignedVoiceWav({
        absDir,
        script: scriptObj,
        outWav: join(absDir, 'output', 'avatar', 'driving-timeline.wav'),
        signal,
      })
      if (alignedInfo?.path) drivingWav = alignedInfo.path
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      alignedInfo = null
    }
  }

  if (!drivingWav || !existsSync(drivingWav)) {
    const combinedNarration =
      String(narrationText || '').trim() ||
      (scriptObj?.scenes || []).map((s) => s.narration).filter(Boolean).join('。') ||
      '欢迎来到智能视频创作工作室，现在由数字人为您播报精彩内容。'
    const synthOut = join(absDir, 'output', 'avatar', `${sceneId || 'avatar-speech'}.wav`)
    mkdirSync(dirname(synthOut), { recursive: true })
    const ttsRes = await executeGenerateSpeech({
      text: combinedNarration,
      voiceId: resolvedVoiceId,
      emotion: '自然亲切',
      fps: Number(scriptObj?.fps || fps || 30),
      outputPath: synthOut,
      allowPlaceholder,
    })
    drivingWav = ttsRes.outputPath || ttsRes.audioPath || synthOut
  }

  const audioMeta = await probeAudioDuration(drivingWav, Number(scriptObj?.fps || fps || 30))
  const durationSec = Math.max(2, Number(audioMeta.durationSec) || 5)

  if (signal?.aborted) throw createAbortError()

  // Resolve visual base source for cloned-human
  const rawBase =
    (sourceVideoPath && (isAbsolute(sourceVideoPath) ? sourceVideoPath : resolve(absDir, sourceVideoPath))) ||
    (sourceImagePath && (isAbsolute(sourceImagePath) ? sourceImagePath : resolve(absDir, sourceImagePath))) ||
    ''

  if (avatarMode === 'cloned-human' && !rawBase) {
    throw new Error('选择「克隆真人数字人」时，请先在第一步上传或录制真人视频 / 人像底板素材。')
  }

  const outRel = `output/avatar/${sceneId ? `${sceneId}-` : ''}avatar-clip.webm`
  const outAbs = join(absDir, outRel)
  const rawLipSyncPath = join(dirname(outAbs), `.avatar-raw-${Date.now()}.mp4`)
  mkdirSync(dirname(outAbs), { recursive: true })
  let providerUsed = 'local-ffmpeg-composite'
  let usedRemoteFile = ''

  // Step 2a: Optional legacy external HTTP avatar endpoint (avatar-config.json / AVATAR_ENDPOINT)
  if (cfg.endpoint && cfg.provider !== 'local-composite') {
    onProgress?.({ stage: 'avatar-infer', progress: 38, message: `2/4 正在调用数字人接口 (${cfg.provider}) 对口型...` })
    try {
      const rem = await invokeRemoteAvatarEndpoint({
        endpoint: cfg.endpoint,
        apiKey: resolveAvatarAuthKey(),
        provider: cfg.provider === 'auto' ? 'musetalk' : cfg.provider,
        avatarMode,
        audioPath: drivingWav,
        sourceMediaPath: rawBase,
        presetId,
        chromaKeyColor,
        outRawPath: rawLipSyncPath,
        timeoutMs: cfg.timeoutMs,
        signal,
      })
      if (rem.ok && existsSync(rem.rawPath)) {
        usedRemoteFile = rem.rawPath
        providerUsed = rem.providerUsed
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      if (cfg.provider !== 'auto') {
        throw new Error(`外部数字人服务 (${cfg.provider}) 调用失败: ${err.message}`)
      }
      onProgress?.({ stage: 'avatar-fallback', progress: 42, message: '外部数字人端点未响应，自动切换本地合成引擎...' })
    }
  }

  if (signal?.aborted) throw createAbortError()

  // Step 2b: Pluggable lip-sync engine (local MuseTalk / LatentSync / CLI / fal.ai) for cloned-human mode
  const lipInfo = {
    requested: lipSyncMode,
    engine: '',
    ok: false,
    fallbackReason: '',
    alignedToTimeline: Boolean(alignedInfo),
    drivingAudio: relative(absDir, drivingWav).replace(/\\/g, '/'),
  }
  let lipSyncedPath = ''
  let lipFocus = null
  if (avatarMode === 'cloned-human' && rawBase && existsSync(rawBase) && !usedRemoteFile) {
    if (lipSyncMode === 'off') {
      lipInfo.fallbackReason = '已按请求关闭唇形同步 (lipSync=off)'
    } else {
      const lipCfg = resolveLipsyncConfig(lipsyncEngine ? { engine: lipsyncEngine } : {})
      lipInfo.engine = lipCfg.engine
      const lipOutRel = `output/avatar/${sceneId ? `${sceneId}-` : ''}avatar-lipsync.mp4`
      const lipOutAbs = join(absDir, lipOutRel)
      onProgress?.({ stage: 'avatar-lipsync', progress: 30, message: `2/4 正在启动唇形同步引擎 (${lipCfg.engine})...` })
      try {
        const res = await runLipsync({
          sourcePath: rawBase,
          audioPath: drivingWav,
          outputPath: lipOutAbs,
          engine: lipsyncEngine,
          isImage: IMAGE_EXT_RX.test(rawBase),
          signal,
          logFile: join(absDir, 'output', 'avatar', 'lipsync-last.log'),
          onProgress: (p) =>
            onProgress?.({
              stage: 'avatar-lipsync',
              progress: Math.max(30, Math.min(70, 30 + Math.round((Number(p.pct) || 0) * 0.4))),
              message: `2/4 唇形同步：${p.message || ''}`,
            }),
        })
        lipSyncedPath = res.outputPath
        lipFocus = res.metrics?.faceBox || null
        providerUsed = `lipsync-${res.engine}`
        Object.assign(lipInfo, {
          ok: true,
          engine: res.engine,
          videoPath: lipOutRel,
          wallSec: res.wallSec,
          audioSec: res.audioSec,
          outputDurationSec: res.outputDurationSec,
          durationDeltaMs: res.durationDeltaMs,
          inputKind: res.inputKind,
          rtf: res.metrics?.rtf ?? (res.audioSec ? Number((res.wallSec / res.audioSec).toFixed(3)) : null),
          fps: res.metrics?.fps ?? null,
          frames: res.metrics?.frames ?? null,
          faceFrames: res.metrics?.faceFrames ?? null,
          sourceFrames: res.metrics?.sourceFrames ?? null,
          peakVramAllocatedMb: res.metrics?.peakVramAllocatedMb ?? null,
          timings: res.metrics?.timings || null,
          stoppedTtsForVram: Boolean(res.vram?.stoppedTts),
        })
      } catch (err) {
        if (err?.name === 'AbortError') throw err
        const reason = err instanceof LipsyncUnavailableError ? err.message : `引擎运行失败：${String(err?.message || err).slice(0, 300)}`
        if (lipSyncMode === 'on') {
          throw new Error(`唇形同步失败（lipSync=on 不回退）：${reason}`)
        }
        lipInfo.fallbackReason = reason
        onProgress?.({ stage: 'avatar-fallback', progress: 60, message: `唇形同步不可用，回退为无口型合成：${reason.slice(0, 120)}` })
      }
    }
  }

  if (signal?.aborted) throw createAbortError()

  // Step 3: Encode verified yuva420p transparent WebM
  const targetFps = Number(scriptObj?.fps || fps || 30)
  if (usedRemoteFile) {
    onProgress?.({ stage: 'avatar-alpha', progress: 72, message: '3/4 正在将口型输出转码为透明通道 yuva420p WebM...' })
    await compositeClonedHumanToAlphaWebm({
      sourcePath: usedRemoteFile,
      durationSec,
      fps: targetFps,
      width,
      height,
      chromaKeyColor: chromaKeyColor || '',
      outWebmPath: outAbs,
      signal,
    })
    try { unlinkSync(usedRemoteFile) } catch {}
  } else if (avatarMode === 'cloned-human' && rawBase && existsSync(rawBase)) {
    onProgress?.({
      stage: 'avatar-alpha',
      progress: 74,
      message: lipSyncedPath ? '3/4 正在把口型同步结果合成为 yuva420p 透明通道叠层...' : '3/4 正在合成克隆真人数字人 yuva420p 透明通道贴片...',
    })
    await compositeClonedHumanToAlphaWebm({
      sourcePath: lipSyncedPath || rawBase,
      durationSec,
      fps: targetFps,
      width,
      height,
      chromaKeyColor,
      focus: lipFocus,
      outWebmPath: outAbs,
      signal,
    })
    if (!lipSyncedPath) providerUsed = 'local-cloned-human-compositor'
  } else {
    onProgress?.({ stage: 'avatar-alpha', progress: 55, message: '3/4 正在渲染 AI 数字人（口型波形锁定 + yuva420p 透明通道）...' })
    const rmsEnv = await extractAudioRmsEnvelope(drivingWav, targetFps, durationSec, signal)
    const aiRes = await renderAiPresenterToAlphaWebm({
      presetId,
      rmsEnvelope: rmsEnv,
      fps: targetFps,
      width,
      height,
      outWebmPath: outAbs,
      signal,
      onProgress: (p) => onProgress?.({ stage: 'avatar-alpha', progress: Math.min(92, 45 + Math.round((p.pct || 0) * 0.45)), message: `正在逐帧渲染数字人透明叠层 (${p.frame}/${p.totalFrames})...` }),
    })
    providerUsed = aiRes.providerUsed
  }

  onProgress?.({ stage: 'avatar-verify', progress: 95, message: '4/4 正在核验透明通道规格并写入 script.json...' })
  const streamMeta = await probeVideoStream(outAbs, signal)

  const isNeuralLipSync = Boolean(usedRemoteFile) || Boolean(lipSyncedPath)
  const engineLabel = lipInfo.engine && lipInfo.engine.startsWith('cloud-') ? `云端 ${lipInfo.engine.slice(6)}` : lipInfo.engine === 'musetalk' ? '本地 MuseTalk 1.5' : lipInfo.engine
  const visualNotice = usedRemoteFile
    ? `已通过外部数字人接口 (${providerUsed}) 生成真人口型同步叠层`
    : lipSyncedPath
      ? `已通过 ${engineLabel} 生成真人口型同步叠层（${durationSec.toFixed(1)}s 口播，耗时 ${lipInfo.wallSec}s${lipInfo.alignedToTimeline ? '，已对齐成片时间线' : ''}）`
      : avatarMode === 'cloned-human'
        ? `未生成口型同步（${lipInfo.fallbackReason || '未配置唇形引擎'}），已回退为克隆真人画中画叠层 + 克隆声音`
        : '已通过本地 AI 声波驱动虚拟播报人像生成透明通道叠层'

  const clipMeta = {
    path: outRel,
    mode: avatarMode,
    presetId,
    layout,
    voiceId: resolvedVoiceId,
    durationSec: streamMeta.durationSec || durationSec,
    width: streamMeta.width || width,
    height: streamMeta.height || height,
    pixFmt: streamMeta.pixFmt || 'yuva420p',
    hasAlpha: streamMeta.hasAlpha,
    isNeuralLipSync,
    visualNotice,
    providerUsed,
    sourceBasePath: rawBase || '',
    lipSync: avatarMode === 'cloned-human' ? lipInfo : undefined,
    updatedAt: new Date().toISOString(),
  }

  if (scriptObj) {
    if (sceneId && Array.isArray(scriptObj.scenes)) {
      const targetScene = scriptObj.scenes.find((s) => s.id === sceneId)
      if (targetScene) {
        targetScene.avatarClip = clipMeta
        targetScene.avatarLayout = layout
      }
    } else {
      scriptObj.avatarClip = clipMeta
      scriptObj.avatarLayout = layout
    }
    writeScriptJson(absDir, scriptObj)
  }

  onProgress?.({ stage: 'done', progress: 100, message: visualNotice })
  return {
    ok: true,
    outputPath: outAbs,
    relPath: outRel,
    avatarClip: clipMeta,
    avatarLayout: layout,
    isNeuralLipSync,
    lipSync: clipMeta.lipSync || null,
    visualNotice,
    streamMeta,
  }
}
