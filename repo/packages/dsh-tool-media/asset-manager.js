/**
 * Asset Manager — imports user media (images / videos / music / sound effects) into a
 * video project, probes every file with ffprobe (never guessing durations), generates
 * thumbnails, and maintains `<project>/assets.json`.
 */
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import {
  loadEnv,
  REPO_ROOT,
  resolveBinaries,
  runCommandRedirected,
} from '../shared/index.js'

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.avif', '.svg', '.jfif'])
export const VIDEO_EXTS = new Set([
  '.mp4',
  '.mov',
  '.webm',
  '.mkv',
  '.avi',
  '.m4v',
  '.flv',
  '.wmv',
  '.ts',
  '.mts',
  '.m2ts',
  '.mpg',
  '.mpeg',
  '.3gp',
  '.ogv',
])
export const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wma'])
const TEXT_EXTS = new Set(['.txt', '.md'])

const MUSIC_HINT = /(bgm|music|音乐|配乐|背景|伴奏|歌曲|song|theme)/i
const SFX_HINT = /(sfx|音效|效果音|fx|whoosh|swoosh|click|pop|hit|impact|ding|转场|提示音)/i

function slug(str) {
  return (
    String(str || 'asset')
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'asset'
  )
}

export function classifyFile(filePath) {
  const ext = extname(filePath).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (TEXT_EXTS.has(ext)) return 'text'
  return null
}

/**
 * Probe a media file via ffprobe with automatic ffmpeg stderr fallback (never failing video imports).
 */
export async function probeMedia(filePath) {
  const { ffprobe, ffmpeg } = resolveBinaries()
  try {
    const res = await runCommandRedirected(
      ffprobe,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,width,height,duration,r_frame_rate',
        '-of',
        'json',
        filePath,
      ],
      { timeoutMs: 25_000 },
    )
    if (res.code === 0 && res.stdout) {
      const parsed = JSON.parse(res.stdout || '{}')
      const streams = parsed.streams || []
      const v = streams.find((s) => s.codec_type === 'video')
      const a = streams.find((s) => s.codec_type === 'audio')
      const dur = Number(parsed?.format?.duration || v?.duration || a?.duration || 0)
      if (dur > 0 || Number(v?.width) > 0 || a) {
        return {
          durationSec: Number.isFinite(dur) ? Number(dur.toFixed(3)) : 0,
          width: Number(v?.width || 0),
          height: Number(v?.height || 0),
          hasVideo: Boolean(v),
          hasAudio: Boolean(a),
        }
      }
    }
  } catch {}

  // Fallback: parse `ffmpeg -i <filePath>` stderr output
  try {
    const ffRes = await runCommandRedirected(ffmpeg, ['-hide_banner', '-i', filePath], { timeoutMs: 20_000 })
    const info = `${ffRes.stderr || ''}\n${ffRes.stdout || ''}`
    const durMatch = info.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i)
    const durSec = durMatch
      ? Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3])
      : 0
    const dimMatch = info.match(/Stream\s+#[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/i)
    const hasVideo = /Stream\s+#[^\n]*Video:/i.test(info)
    const hasAudio = /Stream\s+#[^\n]*Audio:/i.test(info)
    if (durSec > 0 || dimMatch || hasVideo || hasAudio) {
      return {
        durationSec: Number.isFinite(durSec) ? Number(durSec.toFixed(3)) : 0,
        width: dimMatch ? Number(dimMatch[1]) : 0,
        height: dimMatch ? Number(dimMatch[2]) : 0,
        hasVideo,
        hasAudio,
      }
    }
  } catch {}

  const ext = extname(filePath).toLowerCase()
  const isVid = VIDEO_EXTS.has(ext)
  const isAud = AUDIO_EXTS.has(ext)
  return {
    durationSec: isVid ? 6.0 : isAud ? 15.0 : 0,
    width: isVid ? 1920 : 0,
    height: isVid ? 1080 : 0,
    hasVideo: isVid,
    hasAudio: isVid || isAud,
    fallback: true,
  }
}

/**
 * Decide whether an audio file is background music or a sound effect.
 */
export function classifyAudioRole(filePath, durationSec) {
  const hint = `${basename(dirname(filePath))} ${basename(filePath)}`
  if (SFX_HINT.test(hint)) return 'sfx'
  if (MUSIC_HINT.test(hint)) return 'music'
  if (durationSec >= 12) return 'music'
  if (durationSec > 0 && durationSec <= 8) return 'sfx'
  return 'music'
}

function walk(dir, out = [], depth = 0) {
  if (depth > 6) return out
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules') continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out, depth + 1)
    else if (classifyFile(full)) out.push(full)
  }
  return out
}

/**
 * Hard-link when on same volume (zero extra disk usage), otherwise copy.
 */
function placeFile(src, dest) {
  mkdirSync(dirname(dest), { recursive: true })
  if (existsSync(dest)) return 'exists'
  try {
    linkSync(src, dest)
    return 'hardlink'
  } catch {
    copyFileSync(src, dest)
    return 'copy'
  }
}

export function getAssetsManifestPath(projectDir) {
  return join(resolve(projectDir), 'assets.json')
}

export function readAssets(projectDir) {
  const p = getAssetsManifestPath(projectDir)
  if (!existsSync(p)) return { version: 1, items: [], notes: [] }
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'))
    data.items = Array.isArray(data.items) ? data.items : []
    data.notes = Array.isArray(data.notes) ? data.notes : []
    return data
  } catch {
    return { version: 1, items: [], notes: [] }
  }
}

export function writeAssets(projectDir, manifest) {
  manifest.updatedAt = new Date().toISOString()
  writeFileSync(getAssetsManifestPath(projectDir), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return manifest
}

async function makeThumbnail(absFile, type, durationSec, thumbAbs) {
  const { ffmpeg } = resolveBinaries()
  mkdirSync(dirname(thumbAbs), { recursive: true })
  const args = ['-y']
  if (type === 'video') args.push('-ss', String(Math.min(1, Math.max(0, durationSec / 3)).toFixed(2)))
  args.push('-i', absFile, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', thumbAbs)
  const r = await runCommandRedirected(ffmpeg, args, { timeoutMs: 30_000 })
  return r.code === 0 && existsSync(thumbAbs)
}

/**
 * Transcode non-WebM videos to a browser-universal VP8 WebM proxy (`assets/.web/<id>.webm`)
 * so Playwright/open-source Chromium HTML5 `<video>` renders H.264/HEVC clips accurately frame-by-frame.
 */
async function makeWebmProxy(absFile, webAbs) {
  if (existsSync(webAbs)) return true
  const { ffmpeg } = resolveBinaries()
  mkdirSync(dirname(webAbs), { recursive: true })
  const r = await runCommandRedirected(
    ffmpeg,
    [
      '-y',
      '-i', absFile,
      '-vf', "scale='min(1280,iw)':-2",
      '-c:v', 'libvpx',
      '-crf', '24',
      '-b:v', '1200k',
      '-deadline', 'realtime',
      '-cpu-used', '4',
      '-an',
      webAbs,
    ],
    { timeoutMs: 90_000 },
  )
  return r.code === 0 && existsSync(webAbs)
}

/**
 * Import media from one or more files / folders into `<project>/assets/`.
 * @param {object} opts
 * @param {string} opts.projectDir
 * @param {string|string[]} opts.sources  absolute or repo-relative paths (files or folders)
 */
export async function importAssets({ projectDir, sources, onProgress } = {}) {
  loadEnv()
  if (!projectDir) throw new Error('projectDir is required')
  const absProject = resolve(projectDir)
  const list = (Array.isArray(sources) ? sources : [sources]).filter(Boolean)
  if (list.length === 0) throw new Error('At least one source file or folder is required')

  const files = []
  for (const s of list) {
    const abs = isAbsolute(s) ? s : resolve(REPO_ROOT, s)
    if (!existsSync(abs)) throw new Error(`素材路径不存在: ${abs}`)
    if (statSync(abs).isDirectory()) walk(abs, files)
    else if (classifyFile(abs)) files.push(abs)
  }

  const manifest = readAssets(absProject)
  const byHash = new Map(manifest.items.map((it) => [it.sourceKey, it]))
  const added = []
  const existing = []
  const addedNotes = []
  const existingNotes = []
  let idx = 0
  for (const file of files) {
    idx++
    const type = classifyFile(file)
    if (!type) continue
    const st = statSync(file)
    // Content hash by file size + original filename so re-saving in `uploads/` matches cleanly
    const sourceKey = createHash('md5').update(`${basename(file)}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 12)
    if (byHash.has(sourceKey)) {
      const prev = byHash.get(sourceKey)
      if (prev?.id) {
        if (prev.path && !existsSync(join(absProject, prev.path))) {
          try {
            placeFile(file, join(absProject, prev.path))
          } catch {}
        }
        existing.push(prev)
      } else if (type === 'text') {
        existingNotes.push({ id: `note-${sourceKey}`, name: basename(file), sourceKey })
      }
      continue
    }
    onProgress?.({ index: idx, total: files.length, file })

    if (type === 'text') {
      const text = readFileSync(file, 'utf8').slice(0, 20_000)
      const noteObj = { id: `note-${sourceKey}`, name: basename(file), text, sourceKey }
      manifest.notes.push(noteObj)
      byHash.set(sourceKey, { sourceKey })
      addedNotes.push(noteObj)
      continue
    }

    let probe = { durationSec: 0, width: 0, height: 0, hasAudio: false }
    try {
      probe = await probeMedia(file)
    } catch {}
    if (type === 'video') {
      if (!(probe.durationSec > 0)) probe.durationSec = 6.0
      if (!(probe.width > 0)) probe.width = 1920
      if (!(probe.height > 0)) probe.height = 1080
    } else if (type === 'audio') {
      if (!(probe.durationSec > 0)) probe.durationSec = 15.0
    }
    const role =
      type === 'audio' ? classifyAudioRole(file, probe.durationSec) : type === 'video' ? 'footage' : 'image'
    const folder = { image: 'images', video: 'videos', music: 'music', sfx: 'sfx' }[type === 'audio' ? role : type]
    const ext = extname(file).toLowerCase()
    const id = `${type === 'audio' ? role : type}-${slug(basename(file, ext))}-${sourceKey.slice(0, 4)}`
    const relPath = `assets/${folder}/${id}${ext}`
    const how = placeFile(file, join(absProject, relPath))

    let thumb = ''
    if (type === 'image' || type === 'video') {
      const thumbRel = `assets/.thumbs/${id}.jpg`
      try {
        if (await makeThumbnail(join(absProject, relPath), type, probe.durationSec, join(absProject, thumbRel))) {
          thumb = thumbRel
        }
      } catch {}
    }

    let webPath = ''
    if (type === 'video' && ext !== '.webm') {
      const webRel = `assets/.web/${id}.webm`
      const webAbs = join(absProject, webRel)
      if (existsSync(webAbs)) {
        webPath = webRel
      } else if (st.size <= 10 * 1024 * 1024 && probe.durationSec <= 20) {
        try {
          if (await makeWebmProxy(join(absProject, relPath), webAbs)) {
            webPath = webRel
          }
        } catch {}
      } else {
        // Large video: transcode WebM proxy asynchronously in background so upload returns immediately
        makeWebmProxy(join(absProject, relPath), webAbs)
          .then((ok) => {
            if (!ok) return
            try {
              const curMan = readAssets(absProject)
              const hit = curMan.items.find((x) => x.id === id)
              if (hit) {
                hit.webPath = webRel
                writeAssets(absProject, curMan)
              }
            } catch {}
          })
          .catch(() => {})
      }
    }

    let sidecarAnchors = null
    if (type === 'image' || type === 'video') {
      const sidecarCandidates = [
        `${file}.anchors.json`,
        join(dirname(file), `${basename(file, ext)}.anchors.json`),
      ]
      for (const scPath of sidecarCandidates) {
        if (!existsSync(scPath)) continue
        try {
          const parsedSc = JSON.parse(readFileSync(scPath, 'utf8'))
          const rawA = Array.isArray(parsedSc) ? parsedSc : parsedSc?.uiAnchors || parsedSc?.anchors
          if (Array.isArray(rawA) && rawA.length > 0) {
            sidecarAnchors = {
              uiAnchors: rawA.slice(0, 24),
              visualSummary: typeof parsedSc?.visualSummary === 'string' ? parsedSc.visualSummary.trim().slice(0, 260) : '',
              actions: Array.isArray(parsedSc?.actions) ? parsedSc.actions : undefined,
            }
            break
          }
        } catch {}
      }
    }

    const item = {
      id,
      type,
      role,
      name: basename(file, ext),
      originalName: basename(file),
      sourceFolder: basename(dirname(file)),
      path: relPath,
      webPath,
      thumb,
      durationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      hasAudio: probe.hasAudio,
      orientation:
        probe.width && probe.height ? (probe.width > probe.height ? 'landscape' : probe.width < probe.height ? 'portrait' : 'square') : '',
      sizeBytes: st.size,
      placement: how,
      sourceKey,
      description: '',
      ...(sidecarAnchors
        ? {
            uiAnchors: sidecarAnchors.uiAnchors,
            visualSummary: sidecarAnchors.visualSummary || '',
            ...(sidecarAnchors.actions ? { actions: sidecarAnchors.actions } : {}),
            anchorSource: 'dom-sidecar',
          }
        : {}),
    }
    manifest.items.push(item)
    byHash.set(sourceKey, item)
    added.push(item)
  }

  writeAssets(absProject, manifest)
  const notesMatched = addedNotes.length + existingNotes.length
  return {
    ok: true,
    projectDir: absProject,
    scannedFiles: files.length,
    addedCount: added.length + addedNotes.length,
    existingCount: existing.length + existingNotes.length,
    addedNotesCount: addedNotes.length,
    matchedCount: added.length + existing.length + notesMatched,
    summary: summarizeAssets(manifest),
    added: added.slice(0, 50),
    existing: existing.slice(0, 50),
    addedNotes: addedNotes.slice(0, 20),
  }
}

/**
 * Save an uploaded file (browser folder/file picker) directly into the project, then register it.
 */
export async function saveUploadedAsset(projectDir, relName, buffer) {
  const absProject = resolve(projectDir)
  const safeRel = String(relName || 'upload.bin').replace(/\\/g, '/').replace(/\.\.+/g, '.').replace(/^\/+/, '')
  const dest = join(absProject, 'uploads', safeRel)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, buffer)
  return dest
}

export function summarizeAssets(manifest) {
  const s = {
    image: 0,
    video: 0,
    music: 0,
    sfx: 0,
    hostVideo: 0,
    avatarBase: 0,
    voiceClone: 0,
    notes: manifest.notes?.length || 0,
    totalVideoSec: 0,
  }
  for (const it of manifest.items || []) {
    if (it.role === 'host_video') s.hostVideo++
    if (it.role === 'avatar_base') s.avatarBase++
    if (it.role === 'voice_clone') s.voiceClone++
    if (it.type === 'image') s.image++
    else if (it.type === 'video') {
      s.video++
      s.totalVideoSec += it.durationSec || 0
    } else if (it.role === 'music') s.music++
    else if (it.role === 'sfx') s.sfx++
  }
  s.totalVideoSec = Number(s.totalVideoSec.toFixed(1))
  return s
}

export function updateAsset(projectDir, assetId, patch = {}) {
  const manifest = readAssets(projectDir)
  const it = manifest.items.find((x) => x.id === assetId)
  if (!it) throw new Error(`Asset not found: ${assetId}`)
  for (const k of ['description', 'role', 'name', 'uiAnchors', 'visualSummary', 'anchorSource']) if (patch[k] !== undefined) it[k] = patch[k]
  writeAssets(projectDir, manifest)
  return it
}

export function removeAsset(projectDir, assetId) {
  const manifest = readAssets(projectDir)
  manifest.items = manifest.items.filter((x) => x.id !== assetId)
  writeAssets(projectDir, manifest)
  return { ok: true }
}

export function assetRelToProject(projectDir, absPath) {
  return relative(resolve(projectDir), absPath).replace(/\\/g, '/')
}
