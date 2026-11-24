/**
 * @dsh-video/tool-media — "指哪改哪" Targeted Refine (backend)
 *
 * Maps a global time range `{ startSec, endSec }` on the final timeline to the affected scenes and
 * their scene-local frame ranges, normalises a spatial region `{ x, y, w, h }` (0–1) to canvas
 * pixels, decides which source files the coder may touch (only the affected batch / scene files)
 * and builds the spatial + temporal constraint block injected into the refine prompt.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { indexSceneModules, isSceneLocked } from './scene-locks.js'

const FRAME_EPS = 1e-6

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

/** A client-input error the REST layer may show as-is: HTTP `status` + stable `code` (`expose` marks it safe). */
function refineInputError(message, status = 400, code = 'INVALID_INPUT') {
  const err = new Error(message)
  err.status = status
  err.code = code
  err.expose = true
  return err
}

/**
 * Cumulative scene timing (frames) from script.json scenes.
 */
export function computeSceneTimeline(script = {}) {
  const fps = Number(script.fps) > 0 ? Number(script.fps) : 30
  let cursor = 0
  const rows = (Array.isArray(script.scenes) ? script.scenes : []).map((sc, index) => {
    const frames =
      Number(sc.durationInFrames) > 0 ? Math.round(Number(sc.durationInFrames)) : Math.max(1, Math.ceil((Number(sc.durationSec) || 4) * fps))
    const row = { sceneId: sc.id, index, title: sc.title || '', startFrame: cursor, endFrame: cursor + frames, frames, locked: isSceneLocked(sc) }
    cursor += frames
    return row
  })
  return { fps, totalFrames: cursor, totalSec: Number((cursor / fps).toFixed(3)), rows }
}

/**
 * Map a global time range to scenes + scene-local frame ranges `[localStartFrame, localEndFrame)`.
 */
export function mapTimeRangeToScenes(script = {}, range = {}) {
  const tl = computeSceneTimeline(script)
  const s = Number(range?.startSec)
  const e = Number(range?.endSec)
  if (!Number.isFinite(s) || !Number.isFinite(e)) throw refineInputError('时间范围 timeRange 需要数值 startSec / endSec（单位：秒，基于成片全局时间轴）', 400, 'INVALID_TIME_RANGE')
  if (e <= s) throw refineInputError(`时间范围无效：endSec (${e}) 必须大于 startSec (${s})`, 400, 'INVALID_TIME_RANGE')
  const startSec = clamp(s, 0, tl.totalSec)
  const endSec = clamp(e, 0, tl.totalSec)
  if (endSec <= startSec) throw refineInputError(`时间范围 ${s}s–${e}s 超出成片总时长 ${tl.totalSec}s`, 400, 'INVALID_TIME_RANGE')
  // Frame f covers [f/fps, (f+1)/fps). FRAME_EPS absorbs float noise (3.3s × 30fps = 98.99999999999999) so a range
  // that starts / ends exactly on a scene boundary never leaks a phantom frame into the neighbouring scene.
  const gStart = Math.min(tl.totalFrames - 1, Math.floor(startSec * tl.fps + FRAME_EPS))
  const gEnd = Math.min(tl.totalFrames, Math.max(gStart + 1, Math.ceil(endSec * tl.fps - FRAME_EPS)))
  const scenes = []
  for (const row of tl.rows) {
    const ovStart = Math.max(gStart, row.startFrame)
    const ovEnd = Math.min(gEnd, row.endFrame)
    if (ovEnd <= ovStart) continue
    scenes.push({
      sceneId: row.sceneId,
      index: row.index,
      title: row.title,
      locked: row.locked,
      sceneStartFrame: row.startFrame,
      sceneEndFrame: row.endFrame,
      globalStartFrame: ovStart,
      globalEndFrame: ovEnd,
      localStartFrame: ovStart - row.startFrame,
      localEndFrame: ovEnd - row.startFrame,
      localStartSec: Number(((ovStart - row.startFrame) / tl.fps).toFixed(3)),
      localEndSec: Number(((ovEnd - row.startFrame) / tl.fps).toFixed(3)),
      globalStartSec: Number((ovStart / tl.fps).toFixed(3)),
      globalEndSec: Number((ovEnd / tl.fps).toFixed(3)),
      coverage: Number(((ovEnd - ovStart) / Math.max(1, row.frames)).toFixed(3)),
    })
  }
  return {
    fps: tl.fps,
    totalFrames: tl.totalFrames,
    totalSec: tl.totalSec,
    requested: { startSec: s, endSec: e },
    clamped: { startSec, endSec, startFrame: gStart, endFrame: gEnd },
    scenes,
  }
}

/**
 * Normalise a region and project it to pixels. Units: `region.unit` = 'norm' (0–1, default) | 'percent' | 'px';
 * without an explicit unit, values ≤ 1.5 are normalised (a slight drag overflow is clamped to the frame),
 * values ≤ 100 are percentages and larger values are canvas pixels.
 */
export function normalizeRefineRegion(region, { width = 1920, height = 1080 } = {}) {
  if (!region || typeof region !== 'object') return null
  const raw = ['x', 'y', 'w', 'h'].map((k) => Number(region[k]))
  if (raw.some((v) => !Number.isFinite(v) || v < 0)) throw refineInputError('区域 region 需要非负数值 { x, y, w, h }（归一化 0–1）', 400, 'INVALID_REGION')
  const W = Number(width) || 1920
  const H = Number(height) || 1080
  const unitRaw = String(region.unit || '').trim().toLowerCase()
  let unit = ['px', 'pixel', 'pixels'].includes(unitRaw)
    ? 'px'
    : ['%', 'percent', 'pct'].includes(unitRaw)
      ? 'percent'
      : ['norm', 'normalized', 'normalised', 'ratio'].includes(unitRaw)
        ? 'norm'
        : ''
  if (!unit) {
    const maxV = Math.max(...raw)
    unit = maxV <= 1.5 ? 'norm' : maxV <= 100 ? 'percent' : 'px'
  }
  const [x0, y0, w0, h0] =
    unit === 'px' ? [raw[0] / W, raw[1] / H, raw[2] / W, raw[3] / H] : unit === 'percent' ? raw.map((v) => v / 100) : raw
  if (x0 >= 1 || y0 >= 1) throw refineInputError('区域 region 超出画面：起点 x / y 必须位于画面之内（归一化 0–1）', 400, 'INVALID_REGION')
  const x = clamp(x0, 0, 1)
  const y = clamp(y0, 0, 1)
  const w = clamp(w0, 0, 1 - x)
  const h = clamp(h0, 0, 1 - y)
  if (w < 0.005 || h < 0.005) throw refineInputError('区域 region 过小或为空：w / h 必须大于 0', 400, 'INVALID_REGION')
  const cx = x + w / 2
  const cy = y + h / 2
  const horiz = cx < 0.34 ? '左' : cx > 0.66 ? '右' : '中'
  const vert = cy < 0.34 ? '上' : cy > 0.66 ? '下' : '中'
  return {
    x: Number(x.toFixed(4)),
    y: Number(y.toFixed(4)),
    w: Number(w.toFixed(4)),
    h: Number(h.toFixed(4)),
    px: { left: Math.round(x * W), top: Math.round(y * H), width: Math.round(w * W), height: Math.round(h * H) },
    canvas: { width: W, height: H },
    inputUnit: unit,
    areaRatio: Number((w * h).toFixed(4)),
    anchorHint:
      vert === '中' && horiz === '中' ? '画面中央' : vert === '中' ? `画面${horiz}侧` : horiz === '中' ? `画面${vert}方` : `画面${horiz}${vert}角`,
  }
}

/**
 * Decide the refine scope (global / scene / targeted), the affected + skipped (locked) scenes, which
 * files the coder may modify, and the constraint block for the prompt.
 */
export function prepareTargetedRefine({ absDir, script = {}, sceneId = '', sceneIds = [], timeRange = null, region = null } = {}) {
  const engine = script.engine === 'remotion' ? 'remotion' : 'html'
  const allScenes = Array.isArray(script.scenes) ? script.scenes : []
  const byId = new Map(allScenes.map((s) => [s.id, s]))
  let timeMap = null
  let requested = []
  if (timeRange && (timeRange.startSec !== undefined || timeRange.endSec !== undefined)) {
    timeMap = mapTimeRangeToScenes(script, timeRange)
    requested = timeMap.scenes.map((s) => s.sceneId)
    if (sceneId && !requested.includes(sceneId)) {
      throw refineInputError(`场景 ${sceneId} 不在所选时间范围 ${timeMap.clamped.startSec}s–${timeMap.clamped.endSec}s 内`, 400, 'SCENE_NOT_IN_TIME_RANGE')
    }
    if (sceneId) requested = [sceneId]
  } else {
    requested = [...new Set([sceneId, ...(Array.isArray(sceneIds) ? sceneIds : [])].filter((id) => id && id !== 'ALL'))]
  }
  for (const id of requested) if (!byId.has(id)) throw refineInputError(`未找到场景 ${id}`, 404, 'SCENE_NOT_FOUND')
  const normRegion = region ? normalizeRefineRegion(region, { width: script.width, height: script.height }) : null
  const mode = timeMap || normRegion ? 'targeted' : requested.length > 0 ? 'scene' : 'global'
  if (mode === 'targeted' && requested.length === 0) {
    // Region only, no scene / time → whole video, region constraint applies to every unlocked scene
    requested = allScenes.map((s) => s.id)
  }
  const lockedAll = allScenes.filter(isSceneLocked).map((s) => s.id)
  const affected = requested.filter((id) => !isSceneLocked(byId.get(id)))
  const skippedLockedScenes = requested.filter((id) => isSceneLocked(byId.get(id)))

  let allowedFiles = null // null = unrestricted (global refine)
  let createAllowed = true
  let moduleIndex = { bySceneId: {} }
  if (engine === 'html') {
    allowedFiles = ['index.html']
    createAllowed = false
  } else if (mode !== 'global') {
    moduleIndex = indexSceneModules(absDir, affected)
    const files = new Set()
    for (const id of affected) for (const f of moduleIndex.bySceneId[id] || []) if (!/\/Locked_/.test(f)) files.add(f)
    const uncovered = affected.filter((id) => !(moduleIndex.bySceneId[id] || []).some((f) => !/\/Locked_/.test(f)))
    if (uncovered.length > 0) {
      // Scenes rendered by built-in layouts: allow authoring a new scene module + registering it
      files.add('src/scenes/index.ts')
      files.add('src/VideoComposition.tsx')
    }
    allowedFiles = [...files]
    createAllowed = uncovered.length > 0
  }

  const timeRows = timeMap ? timeMap.scenes.filter((s) => affected.includes(s.sceneId)) : []
  const lines = []
  if (mode !== 'global') {
    lines.push('【指哪改哪 · 定向精修约束（必须严格遵守）】')
    if (timeMap) {
      lines.push(`- 时间范围：成片全局 ${timeMap.clamped.startSec}s–${timeMap.clamped.endSec}s（全局第 ${timeMap.clamped.startFrame}–${timeMap.clamped.endFrame} 帧，${timeMap.fps}fps）。`)
      for (const r of timeRows) {
        lines.push(`  • ${r.sceneId}「${r.title}」：场景内本地帧 [${r.localStartFrame}, ${r.localEndFrame})（即 useCurrentFrame() 局部帧，约占该场景 ${Math.round(r.coverage * 100)}%）`)
      }
      lines.push('- 时间约束：仅让改动在上述本地帧窗口内生效（例如 frame >= 起始帧 && frame < 结束帧，或 interpolate 的输入区间限制在该窗口），窗口外的每一帧画面必须保持与修改前完全一致。')
    } else {
      lines.push(`- 目标场景：${affected.join(', ')}`)
    }
    if (normRegion) {
      lines.push(
        `- 空间区域：归一化 x=${normRegion.x}, y=${normRegion.y}, w=${normRegion.w}, h=${normRegion.h}（像素 left=${normRegion.px.left}, top=${normRegion.px.top}, width=${normRegion.px.width}, height=${normRegion.px.height}；画布 ${normRegion.canvas.width}×${normRegion.canvas.height}，位于${normRegion.anchorHint}）。`,
      )
      lines.push('- 空间约束：只修改完全或主要落在该矩形区域内的元素；区域外的所有元素（布局、位置、颜色、文字、字体、动画曲线与时序）必须保持不变，不得整体重排或重写场景。')
    }
    if (skippedLockedScenes.length > 0) lines.push(`- 以下场景已被用户锁定，严禁修改：${skippedLockedScenes.join(', ')}`)
    if (lockedAll.length > 0) lines.push(`- 锁定场景（任何情况下都不得修改其组件实现）：${lockedAll.join(', ')}`)
    if (allowedFiles) {
      lines.push(
        `- 允许修改的文件：${allowedFiles.join(', ')}${createAllowed ? '（必要时可在 src/scenes/ 下新建场景模块并在 src/scenes/index.ts 中注册）' : ''}；其他文件的任何改动都会被丢弃。`,
      )
    }
    lines.push('- 返回 files 时只包含真正修改过的文件，且必须是完整文件内容。')
  } else if (lockedAll.length > 0) {
    lines.push(`【锁定场景保护】以下场景已被用户锁定，严禁修改其组件实现或口播：${lockedAll.join(', ')}`)
  }

  return {
    mode,
    engine,
    requestedSceneIds: requested,
    affectedSceneIds: affected,
    skippedLockedScenes,
    lockedSceneIds: lockedAll,
    timeMap,
    region: normRegion,
    allowedFiles,
    createAllowed,
    promptBlock: lines.join('\n'),
  }
}

/**
 * Keep only patch files the targeted refine may touch. Locked-scene copies are never writable.
 */
export function filterRefinePatch(patchFiles = {}, prep = {}, currentFiles = {}) {
  const accepted = {}
  const rejected = []
  for (const [rel, code] of Object.entries(patchFiles || {})) {
    const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (/(^|\/)src\/scenes\/Locked_/.test(clean)) {
      rejected.push({ path: clean, reason: '锁定场景实现不可修改' })
      continue
    }
    if (prep.allowedFiles) {
      const allowed = prep.allowedFiles.includes(clean)
      const isNewSceneModule = prep.createAllowed && /^src\/scenes\/[\w-]+\.tsx$/.test(clean) && !(clean in currentFiles)
      if (!allowed && !isNewSceneModule) {
        rejected.push({ path: clean, reason: '超出本次定向精修允许的文件范围' })
        continue
      }
    }
    accepted[clean] = code
  }
  return { accepted, rejected }
}

export function projectHasSceneRegistry(absDir) {
  return existsSync(join(resolve(absDir), 'src', 'scenes', 'index.ts'))
}

// HyperFrames HTML locked-scene blocks live in scene-locks.js (setSceneLock captures them at lock time)
export { applyLockedHtmlStore, extractHtmlSceneBlock, LOCKED_HTML_STORE_REL, restoreLockedHtmlScenes, syncLockedHtmlStore } from './scene-locks.js'
