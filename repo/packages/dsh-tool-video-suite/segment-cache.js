import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { createAbortError, runCommandRedirected } from '../shared/index.js'

export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex')
}

export function computeFileDigest(absPath) {
  if (!absPath || !existsSync(absPath) || statSync(absPath).isDirectory()) return 'missing'
  return sha256Hex(readFileSync(absPath)).slice(0, 16)
}

/**
 * Hash HTML presentation code stripping volatile script JSON metadata (`updatedAt`, timestamps)
 * so unchanged visual/JS code + unchanged scene inputs produce identical cache keys across saves.
 */
function computeHtmlVisualCodeDigest(htmlPath) {
  if (!existsSync(htmlPath)) return 'no-html'
  const raw = readFileSync(htmlPath, 'utf8')
  const stripped = raw.replace(
    /(<script\s+id=["']dsh-script-data["'][^>]*>)[\s\S]*?(<\/script>)/i,
    '$1/*script-data-stripped*/$2',
  )
  return sha256Hex(stripped).slice(0, 16)
}

/**
 * Compute deterministic SHA-256 segment fingerprint for one scene:
 * scene geometry + copy + subtitles + referenced asset file digests + canvas + visual template digest.
 */
export function computeSceneSegmentKey({ projectDir, script, scene, sceneIndex = 0, renderWidth = 0, renderHeight = 0 }) {
  const absDir = resolve(projectDir)
  const htmlPath = join(absDir, 'index.html')
  const mediaRefs = [
    ...(Array.isArray(scene?.media) ? scene.media : []),
    ...(Array.isArray(scene?.poolMedia) ? scene.poolMedia : []),
  ]
  const mediaDigests = mediaRefs.map((m) => {
    const p = String(m?.path || '').trim()
    if (!p) return 'empty'
    const abs = isAbsolute(p) ? p : resolve(absDir, p)
    return `${p}:${computeFileDigest(abs)}`
  })
  const activeAvatar = scene?.avatarClip?.path ? scene.avatarClip : (script?.avatarClip?.path ? script.avatarClip : null)
  const avatarLayout = scene?.avatarLayout || activeAvatar?.layout || script?.avatarLayout || ''
  const avatarDigest = activeAvatar?.path
    ? `${activeAvatar.path}:${avatarLayout}:${computeFileDigest(isAbsolute(activeAvatar.path) ? activeAvatar.path : resolve(absDir, activeAvatar.path))}`
    : `none:${avatarLayout}`

  const payload = {
    canvas: {
      width: Number(renderWidth) || Number(script?.width) || 1920,
      height: Number(renderHeight) || Number(script?.height) || 1080,
      fps: Number(script?.fps) || 30,
      targetPlatform: script?.targetPlatform || 'universal',
      style: script?.style || 'tech',
      theme: script?.theme || null,
      aiBadge: script?.aiBadge ?? true,
      bgmBeatsCount: Array.isArray(script?.bgm?.beats) ? script.bgm.beats.length : 0,
      avatarDigest,
    },
    codeDigest: computeHtmlVisualCodeDigest(htmlPath),
    fontDigest: computeFileDigest(join(absDir, 'fonts', 'NotoSansSC-VF.woff2')),
    scene: {
      id: scene?.id || `scene-${sceneIndex + 1}`,
      index: sceneIndex,
      startFrame: Number(scene?.startFrame || 0),
      durationInFrames: Number(scene?.durationInFrames || 90),
      title: scene?.title || '',
      narration: scene?.narration || '',
      layout: scene?.layout || '',
      kenBurns: scene?.kenBurns || '',
      transition: scene?.transition || '',
      highlights: scene?.highlights || [],
      counterTarget: scene?.counterTarget || 96,
      subtitles: scene?.subtitles || [],
      totalDurationInFrames: Number(script?.totalDurationInFrames || 0),
    },
    mediaDigests,
  }

  return `${scene?.id || `s${sceneIndex}`}_${sha256Hex(JSON.stringify(payload)).slice(0, 20)}`
}

/**
 * Render HTML5 multi-scene timeline using per-scene SHA-256 segment cache (`cache/segments/<key>.mp4`)
 * and FFmpeg fast stream-copy concat + AAC master audio muxing.
 */
export async function renderHtmlSegmentsWithCache({
  projectDir,
  script,
  ffmpeg,
  outMp4,
  audioWavPath,
  fps,
  renderWidth = 0,
  renderHeight = 0,
  captureFrameRangeToSilentMp4,
  signal,
  onProgress,
}) {
  if (signal?.aborted) throw createAbortError()
  const absDir = resolve(projectDir)
  const cacheDir = join(absDir, 'cache', 'segments')
  mkdirSync(cacheDir, { recursive: true })

  const scenes = Array.isArray(script?.scenes) ? script.scenes : []
  const segmentPaths = []
  const segmentKeys = []
  let cacheHits = 0
  let cacheMisses = 0

  for (let i = 0; i < scenes.length; i++) {
    if (signal?.aborted) throw createAbortError()
    const sc = scenes[i]
    const key = computeSceneSegmentKey({
      projectDir: absDir,
      script,
      scene: sc,
      sceneIndex: i,
      renderWidth,
      renderHeight,
    })
    const segMp4 = join(cacheDir, `${key}.mp4`)
    segmentKeys.push(key)

    if (existsSync(segMp4) && statSync(segMp4).size > 2048) {
      cacheHits++
      segmentPaths.push(segMp4)
      onProgress?.({
        stage: 'render-cache',
        progress: Math.round(((i + 1) / scenes.length) * 85),
        message: `片段 ${sc.id || i + 1} 命中缓存 (${key.slice(-8)})`,
      })
      continue
    }

    cacheMisses++
    const startFrame = Math.max(0, Number(sc.startFrame) || 0)
    const count = Math.max(1, Number(sc.durationInFrames) || Math.round((Number(sc.durationSec) || 4) * fps))
    const endFrameExclusive = startFrame + count

    const tmpSeg = join(cacheDir, `.tmp-${key}.mp4`)
    await captureFrameRangeToSilentMp4({
      startFrame,
      endFrameExclusive,
      outSilentMp4: tmpSeg,
      sceneIndex: i,
    })
    renameSync(tmpSeg, segMp4)
    segmentPaths.push(segMp4)
    onProgress?.({
      stage: 'render-segment',
      progress: Math.min(92, Math.round(((i + 1) / scenes.length) * 88)),
      message: `已渲染分镜片段 ${i + 1}/${scenes.length} (${sc.id || i + 1})`,
    })
  }

  // Concat silent scene segments via FFmpeg concat demuxer
  const concatListPath = join(cacheDir, 'concat-list.txt')
  const listText = segmentPaths
    .map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n')
  writeFileSync(concatListPath, listText + '\n', 'utf8')

  const silentMerged = join(cacheDir, '.merged-video.mp4')
  const concatRes = await runCommandRedirected(
    ffmpeg,
    ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', silentMerged],
    { timeoutMs: 60_000, signal },
  )
  if (concatRes.code !== 0 || !existsSync(silentMerged)) {
    throw new Error(`片段拼接失败: ${concatRes.stderr}`)
  }

  // Mux master audio track onto merged silent video cleanly
  const muxArgs = ['-y', '-i', silentMerged]
  if (audioWavPath && existsSync(audioWavPath)) {
    // 320 kbit/s like the Remotion mux (192 kbit/s AAC overshoot pushed the true peak over -1 dBTP)
    muxArgs.push('-i', audioWavPath, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2', '-shortest')
  } else {
    muxArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest')
  }
  muxArgs.push('-movflags', '+faststart', outMp4)

  const muxRes = await runCommandRedirected(ffmpeg, muxArgs, { timeoutMs: 60_000, signal })
  if (muxRes.code !== 0 || !existsSync(outMp4)) {
    throw new Error(`片段音频混流失败: ${muxRes.stderr}`)
  }

  return {
    cacheHits,
    cacheMisses,
    totalScenes: scenes.length,
    segmentKeys,
    cacheDir,
  }
}
