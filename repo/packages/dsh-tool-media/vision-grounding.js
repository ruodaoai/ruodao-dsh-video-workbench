/**
 * Visual & UI Anchor Grounding Engine
 *
 * Eliminates blind-guessed click coordinates `(fx, fy)` on UI screenshots & recorded clips by:
 * 1. Loading pixel-exact DOM bounding-box sidecar files (`<name>.anchors.json`) whenever captured from a browser/recorder;
 * 2. Automatically inspecting uploaded screenshots via the configured multimodal Vision LLM (`callLlmChat`)
 *    with a lightweight resized JPEG preview to extract `visualSummary` and real `[0..1]` `uiAnchors[]`.
 * Gracefully degrades (never breaks the pipeline) when the user configures a text-only LLM.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { resolveBinaries, runCommandRedirected } from '../shared/index.js'
import { readAssets, writeAssets } from './asset-manager.js'
import { extractJsonFromLlmText } from './llm-client.js'

const clamp01 = (v, fallback = 0.5) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Number(Math.max(0.01, Math.min(0.99, n)).toFixed(4))
}

export function normalizeUiAnchors(rawList) {
  if (!Array.isArray(rawList)) return []
  const out = []
  const seen = new Set()
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue
    const label = String(item.label || item.name || item.text || '').trim().slice(0, 48)
    if (!label) continue
    const fx = clamp01(item.fx ?? item.cx ?? item.x, NaN)
    const fy = clamp01(item.fy ?? item.cy ?? item.y, NaN)
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) continue
    const key = `${label.toLowerCase()}@${Math.round(fx * 50)}_${Math.round(fy * 50)}`
    if (seen.has(key)) continue
    seen.add(key)
    const fw = Number.isFinite(Number(item.fw ?? item.w)) ? Number(Math.max(0.02, Math.min(0.95, Number(item.fw ?? item.w))).toFixed(4)) : 0.12
    const fh = Number.isFinite(Number(item.fh ?? item.h)) ? Number(Math.max(0.02, Math.min(0.95, Number(item.fh ?? item.h))).toFixed(4)) : 0.06
    out.push({
      label,
      fx,
      fy,
      fw,
      fh,
      kind: String(item.kind || item.role || 'button').trim().slice(0, 24),
    })
    if (out.length >= 24) break
  }
  return out
}

/**
 * Look for a companion `*.anchors.json` sidecar file next to a source image/video or inside `<project>/uploads/`.
 */
export function loadSidecarAnchors(absFilePath, projectDir = '') {
  if (!absFilePath) return null
  const ext = extname(absFilePath)
  const stem = basename(absFilePath, ext)
  const dir = dirname(absFilePath)
  const candidates = [
    `${absFilePath}.anchors.json`,
    join(dir, `${stem}.anchors.json`),
  ]
  if (projectDir) {
    const absProj = resolve(projectDir)
    const origStem = stem.replace(/^(?:image|video|footage)-/, '').replace(/-[a-f0-9]{4}$/i, '')
    candidates.push(
      join(absProj, 'uploads', `${stem}.anchors.json`),
      join(absProj, 'uploads', `${origStem}.anchors.json`),
      join(absProj, 'uploads', `${origStem}${ext}.anchors.json`),
    )
  }
  for (const cand of candidates) {
    if (!existsSync(cand)) continue
    try {
      const parsed = JSON.parse(readFileSync(cand, 'utf8'))
      const anchors = normalizeUiAnchors(Array.isArray(parsed) ? parsed : parsed?.uiAnchors || parsed?.anchors)
      const visualSummary = typeof parsed?.visualSummary === 'string' ? parsed.visualSummary.trim().slice(0, 260) : ''
      const actions = Array.isArray(parsed?.actions) ? parsed.actions : undefined
      if (anchors.length > 0 || visualSummary || actions) {
        return {
          uiAnchors: anchors,
          visualSummary,
          actions,
          anchorSource: 'dom-sidecar',
        }
      }
    } catch {}
  }
  return null
}

async function encodePreviewJpegBase64(absSrc, isVideo, tmpDir) {
  const { ffmpeg } = resolveBinaries()
  mkdirSync(tmpDir, { recursive: true })
  const outJpg = join(tmpDir, `vision-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`)
  const args = ['-y']
  if (isVideo) args.push('-ss', '0.5')
  args.push('-i', absSrc, '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-q:v', '4', outJpg)
  const res = await runCommandRedirected(ffmpeg, args, { timeoutMs: 25_000 })
  if (res.code !== 0 || !existsSync(outJpg)) return ''
  try {
    return readFileSync(outJpg).toString('base64')
  } finally {
    try { rmSync(outJpg, { force: true }) } catch {}
  }
}

/**
 * Ground all visual assets in `<project>/assets.json` with exact `uiAnchors` & `visualSummary`.
 * 1. Hydrates any exact DOM sidecar `*.anchors.json` first (zero LLM cost, 0.0px error);
 * 2. Optionally inspects remaining un-anchored screenshots via multimodal Vision LLM so even
 *    user-uploaded raw screenshots get accurate real `(fx, fy)` coordinates instead of guesses.
 */
export async function groundVisualAssets({
  projectDir,
  callLlmChatFn = null,
  enableVision = true,
  maxVisionAssets = 12,
  signal,
  onProgress,
} = {}) {
  if (!projectDir) return { ok: false, grounded: 0, visionCount: 0, sidecarCount: 0 }
  const absDir = resolve(projectDir)
  const manifest = readAssets(absDir)
  const visuals = (manifest.items || []).filter(
    (it) => (it.type === 'image' || it.type === 'video') && it.role !== 'avatar_base',
  )
  if (visuals.length === 0) return { ok: true, grounded: 0, visionCount: 0, sidecarCount: 0 }

  let sidecarCount = 0
  let visionCount = 0
  let changed = false

  // Pass 1: exact DOM sidecars
  for (const it of visuals) {
    if (Array.isArray(it.uiAnchors) && it.uiAnchors.length > 0 && it.anchorSource === 'dom-sidecar') {
      continue
    }
    const absFile = isAbsolute(it.path) ? it.path : resolve(absDir, it.path)
    const sidecar = loadSidecarAnchors(absFile, absDir)
    if (sidecar) {
      if (sidecar.uiAnchors.length > 0) it.uiAnchors = sidecar.uiAnchors
      if (sidecar.visualSummary) it.visualSummary = sidecar.visualSummary
      if (sidecar.actions) it.actions = sidecar.actions
      it.anchorSource = 'dom-sidecar'
      sidecarCount++
      changed = true
    }
  }

  // Pass 2: Multimodal Vision grounding for remaining raw UI/screenshots without anchors
  if (enableVision && typeof callLlmChatFn === 'function') {
    const tmpDir = join(absDir, '.tmp-vision')
    const needVision = visuals
      .filter((it) => !(Array.isArray(it.uiAnchors) && it.uiAnchors.length > 0))
      .slice(0, Math.max(0, Number(maxVisionAssets) || 12))

    let visionRejected = false
    for (let i = 0; i < needVision.length; i++) {
      if (signal?.aborted || visionRejected) break
      const it = needVision[i]
      const absFile = isAbsolute(it.path) ? it.path : resolve(absDir, it.path)
      if (!existsSync(absFile)) continue

      onProgress?.(
        Math.round(((i + 0.5) / needVision.length) * 100),
        `正在通过视觉大模型精确定位界面元素坐标 (${i + 1}/${needVision.length}): ${it.name || it.id}`,
      )
      try {
        const b64 = await encodePreviewJpegBase64(absFile, it.type === 'video', tmpDir)
        if (!b64) continue
        const reply = await callLlmChatFn({
          system: `你是高精度 UI 界面坐标视觉定位专家。请仔细观察这张完整截图（左上角为 (0.00, 0.00)，右下角为 (1.00, 1.00)），精确识别画面内容与主要可交互按钮/输入框/开关/卡片的中心归一化坐标 (fx, fy) 及宽高 (fw, fh)。
严格只输出 JSON（无 Markdown 围栏）：
{
  "visualSummary": "用 20~60 字客观描述截图实际展示的页面/弹窗/功能（不得编造图中不存在的内容）",
  "uiAnchors": [
    { "label": "按钮或区域的真实中文文字", "fx": 0.255, "fy": 0.032, "fw": 0.14, "fh": 0.04, "kind": "button|input|tab|card|switch|modal" }
  ]
}
注意：fx=横坐标中心/图宽，fy=纵坐标中心/图高，精确到小数点后 3 位，列出最关键的 6~14 个可交互元素。`,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `请定位图片「${it.originalName || it.name || it.path}」（原始尺寸 ${it.width || '?'}x${it.height || '?'}）的真实画面说明与按钮坐标。` },
                { type: 'image', mimeType: 'image/jpeg', base64: b64 },
              ],
            },
          ],
          temperature: 0.1,
          maxTokens: 1600,
          timeoutMs: 45_000,
          signal,
        })
        const parsed = extractJsonFromLlmText(reply?.text || '')
        const anchors = normalizeUiAnchors(parsed?.uiAnchors || parsed?.anchors)
        const summary = String(parsed?.visualSummary || '').trim().slice(0, 260)
        if (anchors.length > 0 || summary) {
          if (anchors.length > 0) it.uiAnchors = anchors
          if (summary) it.visualSummary = summary
          it.anchorSource = 'vision-llm'
          visionCount++
          changed = true
        }
      } catch (err) {
        const msg = String(err?.message || '').toLowerCase()
        if (
          msg.includes('vision') ||
          msg.includes('image') ||
          msg.includes('multimodal') ||
          msg.includes('unsupported') ||
          msg.includes('invalid_request') ||
          msg.includes('400')
        ) {
          // Configured model is text-only — stop attempting vision calls cleanly without breaking pipeline
          visionRejected = true
        }
      }
    }
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }

  if (changed) {
    writeAssets(absDir, manifest)
  }
  return {
    ok: true,
    grounded: sidecarCount + visionCount,
    sidecarCount,
    visionCount,
    totalVisuals: visuals.length,
  }
}

/**
 * Build a deterministic path -> { width, height, type, durationSec } lookup map for `script.json`
 * so Remotion `<FocusShot>` always locks to the exact media aspect ratio even when AI-coded TSX omits mediaWidth/mediaHeight.
 */
export function buildMediaDimsMap(manifest, script = null) {
  const map = {}
  const register = (rel, w, h, type = 'image', dur = 0) => {
    const clean = String(rel || '').replace(/^\.?[\\/]+/, '').replace(/\\/g, '/')
    if (!clean || !(Number(w) > 0 && Number(h) > 0)) return
    const entry = {
      width: Number(w),
      height: Number(h),
      type: type === 'video' || /\.(mp4|mov|webm|mkv)$/i.test(clean) ? 'video' : 'image',
      ...(Number(dur) > 0 ? { durationSec: Number(Number(dur).toFixed(3)) } : {}),
    }
    map[clean] = entry
  }
  for (const it of manifest?.items || []) {
    if (it.type !== 'image' && it.type !== 'video') continue
    if (it.path) register(it.path, it.width, it.height, it.type, it.durationSec)
    if (it.editedPath) register(it.editedPath, it.editedWidth || it.width, it.editedHeight || it.height, it.type, it.durationSec)
    if (it.webPath) register(it.webPath, it.width, it.height, 'video', it.durationSec)
  }
  for (const sc of script?.scenes || []) {
    for (const m of sc.media || []) {
      if (m?.path) register(m.path, m.width, m.height, m.type, m.durationSec)
      if (m?.originalPath) register(m.originalPath, m.width, m.height, m.type, m.durationSec)
    }
  }
  return map
}
