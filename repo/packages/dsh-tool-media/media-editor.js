import { existsSync, mkdirSync } from 'node:fs'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import {
  createAbortError,
  readScriptJson,
  resolveBinaries,
  resolveStyleKey,
  resolveVideoDimensions,
  runCommandRedirected,
  VIDEO_STYLES,
  writeScriptJson,
} from '../shared/index.js'
import { readAssets, writeAssets } from './asset-manager.js'
import { buildMediaDimsMap } from './vision-grounding.js'

const STYLE_COLOR_GRADE = Object.fromEntries(
  Object.entries(VIDEO_STYLES).map(([k, v]) => [k, v.colorGrade]),
)

/**
 * Curate, smart-crop, color-grade, speed-scale, and optionally chroma-key visual assets
 * via FFmpeg into `assets/edited/` while keeping originals untouched.
 */
export async function executeCurateAndEditAssets(options = {}) {
  const {
    projectDir,
    aspectRatio = 'auto',
    quality = '1080p',
    width,
    height,
    style = '',
    trimSeconds = 0,
    clipSpeed = 1.0,
    chromaKeyColor = '',
    enhanceColor = true,
    includeAvatarBase = false,
    signal,
    onChild,
    onProgress,
  } = options

  if (!projectDir) throw new Error('projectDir is required for curate_and_edit_assets')
  if (signal?.aborted) throw createAbortError()

  const absDir = resolve(projectDir)
  const { ffmpeg } = resolveBinaries()
  const manifest = readAssets(absDir)
  const scriptObj = existsSync(join(absDir, 'script.json')) ? readScriptJson(absDir).data : null

  // 'auto' follows the project's resolved canvas (e.g. 3:4 picked for 小红书) instead of guessing again from the assets
  const dims = resolveVideoDimensions({
    aspectRatio: aspectRatio && aspectRatio !== 'auto' ? aspectRatio : scriptObj?.aspectRatio || 'auto',
    quality: quality || scriptObj?.quality || '1080p',
    width: width || scriptObj?.width,
    height: height || scriptObj?.height,
    topic: scriptObj?.topic || scriptObj?.title || '',
    assets: (manifest.items || []).filter((i) => i.type === 'image' || i.type === 'video'),
    targetPlatform: scriptObj?.targetPlatform || '',
  })

  const targetW = dims.width
  const targetH = dims.height
  const safeSpeed = Math.max(0.5, Math.min(2.5, Number(clipSpeed) || 1.0))
  const safeTrim = Math.max(0, Number(trimSeconds) || 0)
  // 'auto' (AI 自由匹配) / 'user:<id>' (我的风格预设) grade with the project's base preset
  const resolvedStyle = resolveStyleKey(style, scriptObj)
  const gradeFilter = enhanceColor ? (STYLE_COLOR_GRADE[resolvedStyle] || STYLE_COLOR_GRADE.tech) : ''

  const visuals = (manifest.items || []).filter((it) => {
    if (it.type !== 'image' && it.type !== 'video') return false
    if (!includeAvatarBase && it.role === 'avatar_base') return false
    return true
  })

  if (visuals.length === 0) {
    return {
      ok: true,
      editedCount: 0,
      targetWidth: targetW,
      targetHeight: targetH,
      items: [],
      message: '暂无可剪辑的视觉图片或视频素材，已跳过剪辑精修步骤。',
    }
  }

  const outDir = join(absDir, 'assets', 'edited')
  mkdirSync(outDir, { recursive: true })

  const editedItems = []
  for (let i = 0; i < visuals.length; i++) {
    if (signal?.aborted) throw createAbortError()
    const item = visuals[i]
    const srcAbs = isAbsolute(item.path) ? item.path : resolve(absDir, item.path)
    if (!existsSync(srcAbs)) continue

    onProgress?.({
      progress: Math.round(((i + 0.5) / visuals.length) * 100),
      message: `正在智能剪辑精修 (${i + 1}/${visuals.length}): ${item.originalName || item.name || item.id}`,
    })

    const baseName = `${item.id || `clip-${i + 1}`}`
    const wantsChroma = Boolean(chromaKeyColor && /^#[0-9a-f]{6}$/i.test(String(chromaKeyColor).trim()))
    const roleHint = `${item.role || ''} ${item.name || ''} ${item.originalName || ''} ${item.path || ''}`.toLowerCase()
    const iw = Number(item.width || 0)
    const ih = Number(item.height || 0)
    const isUiHiResShot = /ui|screen|app|shot|drawer|modal|step|warroom|task|hardware|tts|llm|light|dark|studio|board|polish|record|demo|tutorial|walkthrough|capture/i.test(roleHint)
    const preserveAspect =
      item.fitMode === 'preserve' ||
      item.fitMode === 'contain' ||
      isUiHiResShot ||
      (item.type === 'image' && (
        /logo|brand|mark|comic|char|art|theme|compare|shelf|asset|render|export/.test(roleHint) ||
        (iw > 0 && ih > 0 && iw !== ih && Math.abs(iw / ih - targetW / targetH) > 0.04)
      ))

    const maxPresW = item.type === 'image' && isUiHiResShot ? Math.max(targetW * 2, 3840) : targetW
    const maxPresH = item.type === 'image' && isUiHiResShot ? Math.max(targetH * 2, 2160) : targetH
    const vfChain = preserveAspect
      ? [
          `scale='min(${maxPresW},iw)':'min(${maxPresH},ih)':force_original_aspect_ratio=decrease:flags=lanczos`,
          `pad='ceil(iw/2)*2':'ceil(ih/2)*2'`,
          'setsar=1',
        ]
      : [
          `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase`,
          `crop=${targetW}:${targetH}`,
          'setsar=1',
        ]
    if (gradeFilter && !preserveAspect) vfChain.push(gradeFilter)

    if (item.type === 'image') {
      const outRel = `assets/edited/${baseName}-edited.png`
      const outAbs = join(absDir, outRel)
      if (wantsChroma) {
        const hex = String(chromaKeyColor).trim().replace(/^#/, '0x')
        vfChain.push(`colorkey=${hex}:0.14:0.08`, 'format=rgba')
      } else {
        vfChain.push('format=rgba')
      }
      const res = await runCommandRedirected(
        ffmpeg,
        ['-y', '-i', srcAbs, '-vf', vfChain.join(','), '-frames:v', '1', outAbs],
        { timeoutMs: 45_000, signal, onChild },
      )
      if (res.code === 0 && existsSync(outAbs)) {
        const scaleDown = preserveAspect && iw > 0 && ih > 0 ? Math.min(1, maxPresW / iw, maxPresH / ih) : 1
        const actualW = preserveAspect && iw > 0 ? Math.ceil((iw * scaleDown) / 2) * 2 : targetW
        const actualH = preserveAspect && ih > 0 ? Math.ceil((ih * scaleDown) / 2) * 2 : targetH
        item.editedPath = outRel
        item.editedWebPath = `./${outRel}`
        item.editedWidth = actualW
        item.editedHeight = actualH
        item.editedSpec = { width: actualW, height: actualH, style: resolvedStyle, chromaKeyColor: wantsChroma ? chromaKeyColor : '' }
        editedItems.push({ id: item.id, type: item.type, editedPath: outRel })
      }
    } else {
      const extOut = wantsChroma ? 'webm' : 'mp4'
      const outRel = `assets/edited/${baseName}-edited.${extOut}`
      const outAbs = join(absDir, outRel)
      if (Math.abs(safeSpeed - 1.0) > 0.02) {
        vfChain.push(`setpts=PTS/${safeSpeed.toFixed(3)}`)
      }
      if (wantsChroma) {
        const hex = String(chromaKeyColor).trim().replace(/^#/, '0x')
        vfChain.push(`colorkey=${hex}:0.14:0.08`, 'format=yuva420p')
      } else {
        vfChain.push('format=yuv420p')
      }

      const ffArgs = ['-y', '-i', srcAbs]
      if (safeTrim > 0) {
        ffArgs.push('-t', String(safeTrim))
      }
      ffArgs.push('-vf', vfChain.join(','))
      if (wantsChroma) {
        ffArgs.push('-c:v', 'libvpx', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '2200k', '-an')
      } else {
        ffArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart')
      }
      ffArgs.push(outAbs)

      const res = await runCommandRedirected(ffmpeg, ffArgs, { timeoutMs: 120_000, signal, onChild })
      if (res.code === 0 && existsSync(outAbs)) {
        const vScaleDown = preserveAspect && iw > 0 && ih > 0 ? Math.min(1, maxPresW / iw, maxPresH / ih) : 1
        const actualVW = preserveAspect && iw > 0 ? Math.ceil((iw * vScaleDown) / 2) * 2 : targetW
        const actualVH = preserveAspect && ih > 0 ? Math.ceil((ih * vScaleDown) / 2) * 2 : targetH
        item.editedPath = outRel
        item.editedWebPath = `./${outRel}`
        item.editedWidth = actualVW
        item.editedHeight = actualVH
        item.editedSpec = {
          width: actualVW,
          height: actualVH,
          style: resolvedStyle,
          clipSpeed: safeSpeed,
          trimSeconds: safeTrim,
          chromaKeyColor: wantsChroma ? chromaKeyColor : '',
        }
        editedItems.push({ id: item.id, type: item.type, editedPath: outRel })
      }
    }
  }

  writeAssets(absDir, manifest)

  // Map edited paths, exact dimensions & UI anchors onto script.json media entries if scenes exist
  if (scriptObj && Array.isArray(scriptObj.scenes)) {
    const itemByPath = new Map()
    const itemById = new Map()
    for (const it of manifest.items || []) {
      if (it.path) itemByPath.set(it.path, it)
      if (it.editedPath) itemByPath.set(it.editedPath, it)
      if (it.id) itemById.set(it.id, it)
    }
    let updatedScenes = false
    for (const sc of scriptObj.scenes) {
      if (Array.isArray(sc.media)) {
        for (const m of sc.media) {
          const hit = (m.assetId && itemById.get(m.assetId)) || itemByPath.get(m.originalPath || m.path)
          if (hit?.editedPath) {
            if (!m.originalPath) m.originalPath = m.path
            m.path = hit.editedPath
            m.width = Number(hit.editedWidth || hit.width || m.width || 0)
            m.height = Number(hit.editedHeight || hit.height || m.height || 0)
            if (Number(hit.durationSec) > 0) m.durationSec = hit.durationSec
            if (Array.isArray(hit.uiAnchors) && hit.uiAnchors.length > 0) m.uiAnchors = hit.uiAnchors
            if (hit.visualSummary) m.visualSummary = hit.visualSummary
            updatedScenes = true
          }
        }
        sc.assetPaths = sc.media.map((x) => x.path).filter(Boolean)
      }
    }
    scriptObj.mediaDims = buildMediaDimsMap(manifest, scriptObj)
    if (updatedScenes || Object.keys(scriptObj.mediaDims).length > 0) {
      writeScriptJson(absDir, scriptObj)
    }
  }

  onProgress?.({
    progress: 100,
    message: `素材智能剪辑完成：共处理 ${editedItems.length} 个视觉素材 (${targetW}x${targetH})`,
  })

  return {
    ok: true,
    editedCount: editedItems.length,
    targetWidth: targetW,
    targetHeight: targetH,
    style: resolvedStyle,
    items: editedItems,
  }
}
