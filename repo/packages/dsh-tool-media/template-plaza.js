/**
 * @dsh-video/tool-media — 影核广场 · CinePulse Hub (Built-in & Community MOTION.md Template Plaza)
 * Copyright (c) 2026 Merziller (QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com)
 *
 * Official Community Name: 影核广场 · CinePulse Hub
 *   - Built-in curated templates live in `<PACKAGE_ROOT>/templates/cinepulse-hub/<templateId>/`
 *     (`DSH_PLAZA_TEMPLATES_DIR` points this at another folder — tests and the maintainer CLI use it for scratch copies)
 *   - User-published templates live in `<REPO_ROOT>/templates/cinepulse-hub-custom/<templateId>/`
 *   - Online templates (accepted by the maintainer after the plugin was released, see plaza-community.js) are synced on the
 *     user's click into `<DSH_VIDEO_HOME>/plaza-online/<templateId>/` and listed with `source: 'online'`
 *   - Each template ships: `template.json` + `MOTION.md` + `script.json` (sanitized) + optional `cover.jpg` / `preview.png`
 *     + optional playable sample clip `preview.mp4` (short, small, metadata-stripped; streamed with HTTP Range)
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { PACKAGE_ROOT, readScriptJson, REPO_ROOT, resolveBinaries, resolveEnvPath, runCommandRedirected, writeScriptJson } from '../shared/index.js'
import { resolveAdaptiveAudioProfile } from './beat-analyzer.js'
import { buildMotionMarkdown, exportProjectMotionMd } from './reference-analyzer.js'
import { applyStyleDecision } from './style-presets.js'
import { buildPlazaGuidanceBlock, stripPlazaTemplateGuidance } from './plaza-guidance.js'

export const PLAZA_BRAND = {
  id: 'cinepulse-hub',
  zhName: '影核广场',
  enName: 'CinePulse Hub',
  displayName: '影核广场 · CinePulse Hub',
  tagline: '双引擎动效 · 全品类节拍卡点 · 开放 MOTION.md 蓝图模板社区',
  author: 'Merziller',
  qq: '1411574209',
  wechat: 'Merziller',
  email: 'k26789228@gmail.com',
  repoUrl: 'https://github.com/Merziller/dsh-video-workbench/tree/main/templates/cinepulse-hub',
}

export const PLAZA_CATEGORIES = [
  { id: 'all', label: '全部模板' },
  { id: 'history-theater', label: '历史高燃卡点' },
  { id: 'product-promo', label: '科技产品发布会' },
  { id: 'ui-tutorial', label: 'SaaS / 软件教程' },
  { id: 'science-explainer', label: '深度科普拆解' },
  { id: 'data-story', label: '数据榜单洞察' },
  { id: 'custom', label: '社区 / 我的发布' },
]

/** Built-in (maintainer-curated) templates; `DSH_PLAZA_TEMPLATES_DIR` overrides the folder (scratch copies in tests / CLI). */
export function getBuiltinPlazaDir() {
  const override = String(process.env.DSH_PLAZA_TEMPLATES_DIR || '').trim()
  return override ? resolve(override) : join(PACKAGE_ROOT, 'templates', 'cinepulse-hub')
}

/** The user's own local publications (「我的发布」). */
export function getCustomPlazaDir() {
  return join(REPO_ROOT, 'templates', 'cinepulse-hub-custom')
}

/** Writable plugin home (`$DSH_VIDEO_HOME`, default `<REPO_ROOT>/.dsh-home`). */
export function getPlazaHomeDir() {
  return resolveEnvPath('DSH_VIDEO_HOME', './.dsh-home')
}

/** Online templates synced from the maintainer's catalogue (data files only, sha256-verified). */
export function getOnlinePlazaDir() {
  return join(getPlazaHomeDir(), 'plaza-online')
}

function sanitizeTemplateScript(raw = {}) {
  const clone = JSON.parse(JSON.stringify(raw || {}))
  if (clone.bgm && typeof clone.bgm === 'object') {
    if (clone.bgm.audioPath && /^[a-zA-Z]:[\\/]|^\//.test(String(clone.bgm.audioPath))) {
      clone.bgm.audioPath = 'audio/bgm-generated.wav'
    }
    if (clone.bgm.path && /^[a-zA-Z]:[\\/]|^\//.test(String(clone.bgm.path))) {
      clone.bgm.path = 'audio/bgm-generated.wav'
    }
  }
  if (Array.isArray(clone.scenes)) {
    clone.scenes = clone.scenes.map((sc) => {
      const next = { ...sc }
      delete next.audioFile
      delete next.masteredAudioFile
      if (Array.isArray(next.media)) {
        next.media = next.media.map((m) => ({
          ...m,
          path: String(m.path || '').replace(/^[a-zA-Z]:[\\/].*?[\\/]assets[\\/]/i, 'assets/').replace(/\\/g, '/'),
        }))
      }
      return next
    })
  }
  return clone
}

/** Playable sample clip file names, in priority order (MP4/H.264 first: plays in every browser and in DSH). */
export const PLAZA_PREVIEW_VIDEO_FILES = ['preview.mp4', 'preview.webm', 'preview.m4v']
/** Template IDs are slugs (folder names); anything else could walk out of the plaza folders. */
export const PLAZA_TEMPLATE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/
export const isValidPlazaTemplateId = (id) => PLAZA_TEMPLATE_ID_RE.test(String(id || ''))

function loadTemplateFromDir(dirPath, source = 'builtin') {
  const metaPath = join(dirPath, 'template.json')
  if (!existsSync(metaPath)) return null
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
    // an online template must be what its folder says it is (the folder name was verified against the catalogue)
    if (source === 'online' && meta.id && String(meta.id) !== basename(dirPath)) return null
    const id = String(meta.id || basename(dirPath))
    if (!isValidPlazaTemplateId(id)) return null
    const motionMdPath = join(dirPath, 'MOTION.md')
    const scriptPath = join(dirPath, 'script.json')
    const coverCand = ['cover.jpg', 'cover.png', 'preview.jpg', 'preview.png'].find((f) => existsSync(join(dirPath, f))) || ''
    const previewCand = PLAZA_PREVIEW_VIDEO_FILES.find((f) => existsSync(join(dirPath, f))) || ''
    let previewBytes = 0
    if (previewCand) {
      try {
        previewBytes = statSync(join(dirPath, previewCand)).size
      } catch {}
    }
    return {
      ...meta,
      id,
      source,
      online: source === 'online',
      dirPath,
      hasMotionMd: existsSync(motionMdPath),
      hasScript: existsSync(scriptPath),
      coverFile: coverCand,
      coverAbsPath: coverCand ? join(dirPath, coverCand) : '',
      coverUrl: coverCand ? `/api/video-workbench/plaza/cover?id=${encodeURIComponent(id)}` : '',
      hasPreview: Boolean(previewCand && previewBytes > 0),
      previewFile: previewCand,
      previewAbsPath: previewCand ? join(dirPath, previewCand) : '',
      previewBytes,
      // `v` busts the browser cache when a template's sample clip is re-generated
      previewUrl: previewCand && previewBytes > 0 ? `/api/video-workbench/plaza/preview?id=${encodeURIComponent(id)}&v=${previewBytes}` : '',
    }
  } catch {
    return null
  }
}

/** Strip local absolute paths before a template record leaves the process (HTTP / MCP). */
export function toPublicPlazaTemplate(tpl) {
  if (!tpl || typeof tpl !== 'object') return tpl
  const { dirPath, coverAbsPath, previewAbsPath, ...pub } = tpl
  return pub
}

async function probeVideoForPreview(file) {
  const { ffprobe } = resolveBinaries()
  const { code, stdout } = await runCommandRedirected(
    ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file],
    { timeoutMs: 30_000 },
  )
  if (code !== 0) throw new Error('ffprobe 无法读取视频')
  const parsed = JSON.parse(stdout || '{}')
  const streams = Array.isArray(parsed.streams) ? parsed.streams : []
  const video = streams.find((s) => s.codec_type === 'video')
  if (!video) throw new Error('源文件没有视频流')
  return {
    durationSec: Number(parsed.format?.duration || 0),
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  }
}

/** Integrated loudness (LUFS) of one window of a file's audio, or null. */
async function measureWindowLufs(file, startSec, durationSec) {
  try {
    const { ffmpeg } = resolveBinaries()
    const res = await runCommandRedirected(
      ffmpeg,
      ['-hide_banner', '-nostats', '-ss', startSec.toFixed(3), '-t', durationSec.toFixed(3), '-i', file, '-vn', '-af', 'ebur128', '-f', 'null', '-'],
      { timeoutMs: 120_000 },
    )
    const m = String(res.stderr || '').match(/Summary:[\s\S]*?I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/)
    const v = m ? Number(m[1]) : NaN
    return Number.isFinite(v) && v > -70 ? v : null
  } catch {
    return null
  }
}

/**
 * Cut a short, small, metadata-stripped sample clip (H.264 + AAC, faststart) for the plaza player.
 * When `startSec` is omitted the clip skips the opening title (~18 % in) so the sample shows real motion.
 * Audio is levelled to `targetLufs` and limited with headroom so the low-bitrate AAC never clips.
 */
export async function buildPlazaPreviewClip({ sourceMp4, destFile, startSec, durationSec = 15, maxEdge = 960, crf = 27, audioKbps = 128, targetLufs = -14 } = {}) {
  if (!sourceMp4 || !existsSync(sourceMp4)) throw new Error(`样片源视频不存在: ${sourceMp4 || '(空)'}`)
  if (!destFile) throw new Error('destFile is required')
  const info = await probeVideoForPreview(sourceMp4)
  const total = info.durationSec > 0 ? info.durationSec : Number(durationSec) || 15
  const clip = Math.max(1, Math.min(Number(durationSec) || 15, total))
  let start = Number.isFinite(Number(startSec)) ? Number(startSec) : total > clip + 1 ? total * 0.18 : 0
  start = Math.max(0, Math.min(start, Math.max(0, total - clip)))
  const edge = Math.max(240, Math.round(Number(maxEdge) || 960))
  let w = info.width || 1920
  let h = info.height || 1080
  if (w >= h) {
    const tw = Math.min(edge, w)
    h = Math.max(2, Math.round((tw * h) / w / 2) * 2)
    w = Math.round(tw / 2) * 2
  } else {
    const th = Math.min(edge, h)
    w = Math.max(2, Math.round((th * w) / h / 2) * 2)
    h = Math.round(th / 2) * 2
  }
  const fadeIn = Math.min(0.35, clip / 6)
  const fadeOut = Math.min(0.6, clip / 5)
  const outStart = Math.max(0, clip - fadeOut).toFixed(3)
  const vf = `scale=${w}:${h}:flags=lanczos,fps=30,fade=t=in:st=0:d=${fadeIn.toFixed(3)},fade=t=out:st=${outStart}:d=${fadeOut.toFixed(3)},format=yuv420p`
  const args = ['-v', 'error', '-y', '-ss', start.toFixed(3), '-t', clip.toFixed(3), '-i', sourceMp4, '-map', '0:v:0']
  if (info.hasAudio) args.push('-map', '0:a:0')
  args.push('-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p')
  let measuredLufs = null
  let gainDb = 0
  if (info.hasAudio) {
    measuredLufs = await measureWindowLufs(sourceMp4, start, clip)
    if (measuredLufs !== null && Number.isFinite(Number(targetLufs))) gainDb = Math.max(-12, Math.min(8, Number(targetLufs) - measuredLufs))
    const af = [
      `afade=t=in:st=0:d=${fadeIn.toFixed(3)}`,
      `afade=t=out:st=${outStart}:d=${fadeOut.toFixed(3)}`,
      Math.abs(gainDb) >= 0.2 ? `volume=${gainDb.toFixed(2)}dB` : '',
      // band-limit + oversampled limiter: about -3 dBFS of headroom for the AAC encoder's overshoot
      'lowpass=f=16000:poles=2',
      'aresample=192000',
      'alimiter=limit=0.708:level=disabled:attack=1:release=60',
      'aresample=48000',
    ].filter(Boolean)
    args.push('-af', af.join(','), '-c:a', 'aac', '-b:a', `${Math.round(audioKbps)}k`, '-ac', '2', '-ar', '48000')
  } else {
    args.push('-an')
  }
  // no source metadata (titles, comments, local paths) may leak into a shared template
  args.push('-map_metadata', '-1', '-map_chapters', '-1', '-fflags', '+bitexact', '-movflags', '+faststart', destFile)
  const { ffmpeg } = resolveBinaries()
  const tmpOut = `${destFile}.part.mp4`
  args[args.length - 1] = tmpOut
  const res = await runCommandRedirected(ffmpeg, args, { timeoutMs: 300_000 })
  if (res.code !== 0 || !existsSync(tmpOut)) {
    try {
      unlinkSync(tmpOut)
    } catch {}
    throw new Error(`样片转码失败: ${String(res.stderr || '').trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 300)}`)
  }
  try {
    unlinkSync(destFile)
  } catch {}
  copyFileSync(tmpOut, destFile)
  try {
    unlinkSync(tmpOut)
  } catch {}
  return {
    ok: true,
    destFile,
    startSec: Number(start.toFixed(2)),
    durationSec: Number(clip.toFixed(2)),
    width: w,
    height: h,
    hasAudio: info.hasAudio,
    sourceLufs: measuredLufs,
    gainDb: Number(gainDb.toFixed(2)),
    bytes: statSync(destFile).size,
  }
}

function scanPlazaRoot(root, source) {
  const out = new Map()
  if (!root || !existsSync(root)) return out
  let entries = []
  try {
    entries = readdirSync(root)
  } catch {
    return out
  }
  for (const entry of entries) {
    // dot folders are staging / backup copies of the online sync, never templates
    if (entry.startsWith('.') || !isValidPlazaTemplateId(entry)) continue
    const full = join(root, entry)
    try {
      if (!statSync(full).isDirectory()) continue
    } catch {
      continue
    }
    const tpl = loadTemplateFromDir(full, source)
    if (!tpl || out.has(tpl.id)) continue
    out.set(tpl.id, tpl)
  }
  return out
}

const tplTime = (t) => Date.parse(String((t && t.updatedAt) || '')) || 0

/**
 * The same template ID can exist built-in (shipped with the plugin) and online (synced later): the newer `updatedAt` wins
 * (the maintainer updated it after the release), a tie keeps the built-in copy. The user's own publications never shadow
 * either of them.
 */
function mergePlazaSources(builtin, online, custom) {
  const merged = new Map(builtin)
  for (const [id, t] of online) {
    const cur = merged.get(id)
    if (!cur) merged.set(id, t)
    else if (tplTime(t) > tplTime(cur)) merged.set(id, { ...t, updatesBuiltin: true })
  }
  for (const [id, t] of custom) if (!merged.has(id)) merged.set(id, t)
  return merged
}

function scanAllPlazaSources() {
  const builtin = scanPlazaRoot(getBuiltinPlazaDir(), 'builtin')
  const online = scanPlazaRoot(getOnlinePlazaDir(), 'online')
  const custom = scanPlazaRoot(getCustomPlazaDir(), 'custom')
  return { builtin, online, custom, merged: mergePlazaSources(builtin, online, custom) }
}

export function listPlazaTemplates(opts = {}) {
  const category = String(opts.category || 'all').trim().toLowerCase()
  const query = String(opts.query || '').trim().toLowerCase()
  const { merged } = scanAllPlazaSources()
  const list = [...merged.values()]

  list.sort((a, b) => Number(a.order || 99) - Number(b.order || 99) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))

  const filtered = list.filter((t) => {
    if (category && category !== 'all') {
      if (category === 'custom' && t.source !== 'custom') return false
      if (category === 'online' && t.source !== 'online') return false
      if (category !== 'custom' && category !== 'online' && String(t.category || t.genre || '').toLowerCase() !== category) return false
    }
    if (query) {
      const hay = `${t.id} ${t.name || ''} ${t.genreLabel || ''} ${t.description || ''} ${(t.tags || []).join(' ')}`.toLowerCase()
      if (!hay.includes(query)) return false
    }
    return true
  })

  return {
    ok: true,
    brand: PLAZA_BRAND,
    categories: PLAZA_CATEGORIES,
    totalCount: list.length,
    onlineCount: list.filter((t) => t.source === 'online').length,
    templates: filtered.map((t) => toPublicPlazaTemplate(t)),
  }
}

/** The copy of one template the plaza uses (same precedence as the listing), or null. */
function resolvePlazaTemplate(id) {
  const one = (root, source) => {
    const dir = join(root, id)
    return existsSync(join(dir, 'template.json')) ? loadTemplateFromDir(dir, source) : null
  }
  const builtin = one(getBuiltinPlazaDir(), 'builtin')
  const online = one(getOnlinePlazaDir(), 'online')
  if (builtin && online) return tplTime(online) > tplTime(builtin) ? { ...online, updatesBuiltin: true } : builtin
  return builtin || online || one(getCustomPlazaDir(), 'custom')
}

export function getPlazaTemplate(templateId) {
  const id = String(templateId || '').trim()
  if (!id) throw new Error('templateId is required')
  // template IDs are slugs; refuse anything that could walk out of the plaza folders
  if (!PLAZA_TEMPLATE_ID_RE.test(id)) throw new Error(`非法的模板 ID: ${id.slice(0, 80)}`)
  const tpl = resolvePlazaTemplate(id)
  if (tpl) {
    const dir = tpl.dirPath
    const motionMd = tpl.hasMotionMd ? readFileSync(join(dir, 'MOTION.md'), 'utf8') : ''
    const script = tpl.hasScript ? JSON.parse(readFileSync(join(dir, 'script.json'), 'utf8')) : null
    return { ok: true, template: tpl, motionMd, script }
  }
  throw new Error(`未在「${PLAZA_BRAND.displayName}」找到模板: ${id}`)
}

export function applyPlazaTemplateToProject({ projectDir, templateId, newTopic = '', copyScenes = false } = {}) {
  if (!projectDir) throw new Error('projectDir is required')
  const absProject = resolve(projectDir)
  if (!existsSync(join(absProject, 'script.json'))) {
    throw new Error(`目标工程缺少 script.json: ${absProject}`)
  }

  const { template, motionMd, script: tplScript } = getPlazaTemplate(templateId)
  const { data: cur } = readScriptJson(absProject)

  const refBlueprint = template.referenceStyle || {
    sourceName: `${PLAZA_BRAND.zhName}:${template.name}`,
    title: template.name,
    genre: template.genre || 'product-promo',
    genreLabel: template.genreLabel || template.name,
    style: template.style || 'cinematic',
    narrationMode: template.narrationMode || 'tts-beat-sync',
    durationSec: Number(template.durationSec || tplScript?.totalDurationSec || 60),
    shotCount: Number(template.shotCount || tplScript?.scenes?.length || 16),
    avgShotSec: Number(template.avgShotSec || 3.5),
    bpm: Number(template.bpm || 110),
    visualStyle: template.visualStyle || template.description || '',
    colorPalette: template.colorPalette || { background: '#070B16', primary: '#F59E0B', accent: '#22D3EE', highlight: '#F8FAFC' },
    characterDesign: template.characterDesign || '',
    vfxSignature: template.vfxSignature || [],
    transitionSignature: template.transitionSignature || ['slash-wipe', 'zoom-punch', 'flash-cut'],
    subtitleStyle: template.subtitleStyle || 'cinematic',
    pacingSignature: {
      targetShotCount: Number(template.shotCount || tplScript?.scenes?.length || 16),
      avgShotSec: Number(template.avgShotSec || 3.5),
      bpm: Number(template.bpm || 110),
      recommendedPacingMode: template.pacingMode || 'balanced',
    },
    shotFormula: template.shotFormula || [],
    replicationPrompt: template.replicationPrompt || `复刻【${PLAZA_BRAND.zhName}】精选模板「${template.name}」：${template.description || ''}`,
    plazaTemplateId: template.id,
    appliedAt: new Date().toISOString(),
  }

  cur.genre = template.genre || cur.genre || 'product-promo'
  cur.genreLabel = template.genreLabel || template.name
  // the template's look becomes an explicit preset: style + theme switch together (a stale AI-designed palette in
  // script.theme would otherwise keep overriding the template's colours)
  if (template.style) {
    try {
      applyStyleDecision(cur, { mode: 'preset', style: template.style, profile: null })
    } catch {
      cur.style = template.style
    }
  } else if (!cur.style) cur.style = 'cinematic'
  cur.engine = template.engine || cur.engine || 'remotion'
  cur.narrationMode = template.narrationMode || cur.narrationMode || 'tts-beat-sync'
  cur.pacingMode = template.pacingMode || cur.pacingMode || 'balanced'
  cur.subtitleStyle = template.subtitleStyle || cur.subtitleStyle || 'cinematic'
  cur.referenceStyle = refBlueprint
  cur.audioProfile = template.audioProfile || resolveAdaptiveAudioProfile({
    genre: cur.genre,
    genreLabel: cur.genreLabel,
    style: cur.style,
    narrationMode: cur.narrationMode,
  })
  cur.appliedPlazaTemplate = {
    id: template.id,
    name: template.name,
    plaza: PLAZA_BRAND.displayName,
    appliedAt: new Date().toISOString(),
  }

  if (newTopic && String(newTopic).trim()) {
    cur.title = String(newTopic).trim().slice(0, 64)
    cur.goal = String(newTopic).trim()
    // the recipe is a delimited style-only block: duration parsers and the fallback storyboard strip it, and the
    // block itself tells the director that people, events, duration and shot count follow the new topic
    cur.directorNotes = `${stripPlazaTemplateGuidance(String(newTopic).trim())}\n\n${buildPlazaGuidanceBlock(template.name, refBlueprint.replicationPrompt)}`
  }

  if (copyScenes && Array.isArray(tplScript?.scenes) && tplScript.scenes.length > 0) {
    cur.scenes = JSON.parse(JSON.stringify(tplScript.scenes))
    cur.totalDurationSec = tplScript.totalDurationSec || cur.totalDurationSec
    cur.totalDurationInFrames = tplScript.totalDurationInFrames || cur.totalDurationInFrames
  }

  const saved = writeScriptJson(absProject, cur).data
  if (motionMd) {
    writeFileSync(join(absProject, 'MOTION.md'), motionMd, 'utf8')
  } else {
    exportProjectMotionMd(absProject)
  }

  return {
    ok: true,
    plaza: PLAZA_BRAND.displayName,
    templateId: template.id,
    templateName: template.name,
    script: saved,
    motionMdPath: join(absProject, 'MOTION.md'),
  }
}

/** MOTION.md blueprint of a (sanitized) template script — no brand kit (its logo path is local). */
export function buildPlazaMotionMarkdown(cleanScript = {}) {
  return buildMotionMarkdown({ scriptData: cleanScript, referenceStyle: cleanScript.referenceStyle || null })
}

/**
 * template.json of a plaza template built from a sanitized project script (shared by 发布 / 投稿 / `plaza add` / accept).
 * `extra` is merged last (e.g. `previewFile`, `previewDurationSec`, `community`).
 */
export function buildPlazaTemplateMeta(cleanScript = {}, opts = {}) {
  const { id = '', order = 50, name = '', category = '', description = '', tags = [], author = PLAZA_BRAND.author, coverFile = '', extra = {} } = opts
  const scenes = Array.isArray(cleanScript.scenes) ? cleanScript.scenes : []
  const totalSec = Number(cleanScript.totalDurationSec || scenes.reduce((a, s) => a + (Number(s.durationSec) || 3), 0) || 30)
  const avgShotSec = scenes.length > 0 ? Number((totalSec / scenes.length).toFixed(2)) : 3.5
  const audioProfile =
    cleanScript.audioProfile ||
    resolveAdaptiveAudioProfile({
      genre: cleanScript.genre,
      genreLabel: cleanScript.genreLabel,
      title: cleanScript.title,
      style: cleanScript.style,
      narrationMode: cleanScript.narrationMode,
    })
  const slug = String(id || '').trim()
  return {
    id: slug,
    order,
    name: String(name || cleanScript.title || slug).trim(),
    category: String(category || cleanScript.genre || 'product-promo').trim(),
    genre: String(cleanScript.genre || category || 'product-promo').trim(),
    genreLabel: String(cleanScript.genreLabel || name || '全品类动效模板').trim(),
    style: String(cleanScript.style || 'cinematic').trim(),
    engine: String(cleanScript.engine || 'remotion').trim(),
    narrationMode: String(cleanScript.narrationMode || 'tts-beat-sync').trim(),
    pacingMode: String(cleanScript.pacingMode || 'balanced').trim(),
    subtitleStyle: String(cleanScript.subtitleStyle || 'cinematic').trim(),
    aspectRatio: String(cleanScript.aspectRatio || '16:9').trim(),
    fps: Number(cleanScript.fps || 30),
    shotCount: scenes.length,
    durationSec: Number(totalSec.toFixed(1)),
    avgShotSec,
    bpm: Number(cleanScript.bgm?.bpm || cleanScript.referenceStyle?.bpm || 110),
    description: String(description || cleanScript.referenceStyle?.visualStyle || `${scenes.length} 镜 · ${Math.round(totalSec)}s · ${audioProfile.profileName}`).trim(),
    tags: Array.isArray(tags) && tags.length > 0 ? tags.slice(0, 8) : [cleanScript.genreLabel || '精选模板', cleanScript.engine === 'html' ? 'HTML5' : 'Remotion 3D', audioProfile.profileName],
    colorPalette: cleanScript.referenceStyle?.colorPalette || {
      background: cleanScript.genre === 'ui-tutorial' ? '#F8FAFC' : '#070B16',
      primary: cleanScript.genre === 'history-theater' ? '#C9462F' : '#2563EB',
      accent: '#F59E0B',
      highlight: '#FFF7DF',
    },
    vfxSignature: cleanScript.referenceStyle?.vfxSignature || [],
    transitionSignature: cleanScript.referenceStyle?.transitionSignature || Array.from(new Set(scenes.map((s) => s.transition).filter(Boolean))).slice(0, 5),
    replicationPrompt: cleanScript.referenceStyle?.replicationPrompt || '',
    audioProfile,
    author: String(author || PLAZA_BRAND.author),
    plaza: PLAZA_BRAND.displayName,
    coverFile,
    updatedAt: new Date().toISOString(),
    ...(extra && typeof extra === 'object' ? extra : {}),
  }
}

export async function publishProjectToPlaza(options = {}) {
  const {
    projectDir,
    templateId = '',
    name = '',
    category = '',
    description = '',
    tags = [],
    author = 'Merziller',
    targetRoot = '',
    order = 50,
    preview = true,
    previewSource = '',
    previewStartSec,
    previewDurationSec = 15,
  } = options
  if (!projectDir) throw new Error('projectDir is required')
  const absProject = resolve(projectDir)
  if (!existsSync(join(absProject, 'script.json'))) {
    throw new Error(`无法发布：工程缺少 script.json (${absProject})`)
  }

  const { data: rawScript } = readScriptJson(absProject)
  const cleanScript = sanitizeTemplateScript(rawScript)
  const slug = String(templateId || basename(absProject))
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `tpl-${Date.now().toString(36)}`

  const destBase = targetRoot ? resolve(targetRoot) : getCustomPlazaDir()
  const destDir = join(destBase, slug)
  mkdirSync(destDir, { recursive: true })

  // Copy best available visual preview cover
  const coverCandidates = [
    join(absProject, 'output', 'snapshot-3x3.png'),
    join(absProject, 'reference', 'ref-sheet-3x3.jpg'),
    join(absProject, 'output', 'scene-thumbs', 'scene-01.jpg'),
    join(absProject, 'output', 'scene-thumbs', 'scene-02.jpg'),
  ]
  let coverFile = ''
  for (const cand of coverCandidates) {
    if (existsSync(cand)) {
      const ext = extname(cand).toLowerCase() === '.png' ? '.png' : '.jpg'
      coverFile = `cover${ext}`
      copyFileSync(cand, join(destDir, coverFile))
      break
    }
  }

  // the builder reads `scriptData` (an older call passed `script`, so published blueprints had no shot list)
  const motionContent = buildPlazaMotionMarkdown(cleanScript)
  writeFileSync(join(destDir, 'MOTION.md'), motionContent, 'utf8')
  writeFileSync(join(destDir, 'script.json'), JSON.stringify(cleanScript, null, 2) + '\n', 'utf8')

  const templateMeta = buildPlazaTemplateMeta(cleanScript, { id: slug, order, name, category, description, tags, author, coverFile })

  // Playable sample clip: a short cut of the rendered film, so the plaza card can be clicked and watched
  let previewNote = ''
  if (preview !== false) {
    const src = previewSource ? resolve(absProject, previewSource) : join(absProject, 'output', 'final.mp4')
    if (existsSync(src)) {
      try {
        const clip = await buildPlazaPreviewClip({
          sourceMp4: src,
          destFile: join(destDir, 'preview.mp4'),
          startSec: previewStartSec,
          durationSec: previewDurationSec,
        })
        templateMeta.previewFile = 'preview.mp4'
        templateMeta.previewDurationSec = clip.durationSec
      } catch (err) {
        previewNote = `样片截取失败（模板其余部分已发布）: ${String(err?.message || err).slice(0, 200)}`
      }
    } else {
      previewNote = '工程尚未渲染 output/final.mp4，暂无可播放样片；渲染成片后重新发布即可自动附带 15 秒样片'
    }
  }
  writeFileSync(join(destDir, 'template.json'), JSON.stringify(templateMeta, null, 2) + '\n', 'utf8')

  return {
    ok: true,
    template: templateMeta,
    dirPath: destDir,
    motionMdPath: join(destDir, 'MOTION.md'),
    hasPreview: Boolean(templateMeta.previewFile),
    previewNote: previewNote || undefined,
  }
}
