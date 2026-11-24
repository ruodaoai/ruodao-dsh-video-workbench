/**
 * @dsh-video/tool-media — 影核广场社区 (CinePulse Hub community)
 * Copyright (c) 2026 Merziller (QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com)
 *
 * There is no server of our own. The flow is:
 *   1. 用户投稿 — the user builds a privacy-checked submission package (zip) of a finished project under
 *      `<DSH_VIDEO_HOME>/plaza-submissions/<id>/` and sends it to the author HIMSELF: a prefilled GitHub issue form or an
 *      e-mail (nothing is uploaded automatically).
 *   2. 作者维护 — the author reviews / accepts packages with `dsh-video-cli plaza review|accept|add|index` into the
 *      built-in templates (`templates/cinepulse-hub/<id>/`) and commits them together with `index.json`.
 *   3. 在线模板库 — on the user's click the plugin downloads new / changed accepted templates listed in that `index.json`
 *      (jsDelivr, fallback GitHub raw) into `<DSH_VIDEO_HOME>/plaza-online/<id>/`: data files only (json / md / mp4 / jpg /
 *      png), size-limited and sha256-verified; nothing downloaded is ever executed; the last good copy is kept on failure.
 *
 * Layout of one submission:
 *   plaza-submissions/<id>/<id>.zip   ← the package to attach (files inside a top-level `<id>/` folder)
 *   plaza-submissions/<id>/files/…    ← exactly the files that are inside the zip (shown in the UI before sharing)
 *   plaza-submissions/<id>/status.json← local only: 「已投稿」 mark
 */
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import * as zlib from 'node:zlib'
import { PACKAGE_ROOT, readScriptJson, REPO_ROOT, resolveBinaries, runCommandRedirected } from '../shared/index.js'
import { readJsonSafe, removeTreeNoFollow, writeJsonAtomic } from './safe-json-store.js'
import {
  createPrivacyContext,
  createPrivacyReport,
  describePrivacyReport,
  PRIVACY_KIND_LABEL,
  privacyError,
  sanitizeValueForShare,
  scanBinaryForPrivacy,
  scanForPrivacy,
  cleanTextForShare,
} from './plaza-privacy.js'
import {
  buildPlazaMotionMarkdown,
  buildPlazaPreviewClip,
  buildPlazaTemplateMeta,
  getBuiltinPlazaDir,
  getOnlinePlazaDir,
  getPlazaHomeDir,
  isValidPlazaTemplateId,
  PLAZA_BRAND,
  PLAZA_CATEGORIES,
} from './template-plaza.js'

/* ================================================================================================ constants */

export const PLAZA_COMMUNITY = Object.freeze({
  repo: 'Merziller/dsh-video-workbench',
  repoUrl: 'https://github.com/Merziller/dsh-video-workbench',
  issueTemplate: 'plaza-submission.yml',
  email: PLAZA_BRAND.email,
  author: PLAZA_BRAND.author,
  indexUrls: Object.freeze([
    'https://cdn.jsdelivr.net/gh/Merziller/dsh-video-workbench@main/templates/cinepulse-hub/index.json',
    'https://fastly.jsdelivr.net/gh/Merziller/dsh-video-workbench@main/templates/cinepulse-hub/index.json',
    'https://raw.githubusercontent.com/Merziller/dsh-video-workbench/main/templates/cinepulse-hub/index.json',
  ]),
})

export const PLAZA_SUBMISSION_SCHEMA = 'dsh-plaza-submission/1'
export const PLAZA_INDEX_SCHEMA = 'dsh-plaza-index/1'

/** The consent the user gives (stored in submission.json; repeated as a required checkbox on the GitHub form). */
export const PLAZA_CONSENT_TEXT = `我授权作者 ${PLAZA_BRAND.author} 在「${PLAZA_BRAND.zhName}」展示、整理（可调整标题、分类与简介）和分发这份投稿；投稿内容为本人原创或已获授权，不侵犯他人的版权、肖像权与隐私。`

const MB = 1024 * 1024
/** Files a package / template may contain (json / md / mp4 / jpg / png only) and their size limits. */
export const PLAZA_FILE_RULES = Object.freeze({
  'template.json': { type: 'json', max: 128 * 1024, label: '模板信息' },
  'MOTION.md': { type: 'md', max: 512 * 1024, label: '动效蓝图' },
  'script.json': { type: 'json', max: 4 * MB, label: '分镜脚本（已脱敏）' },
  // 4 MB = the npm bundle's limit for a built-in sample clip (scripts/pack-bundle.mjs MAX_PREVIEW_BYTES)
  'preview.mp4': { type: 'mp4', max: 4 * MB, label: '样片（≤ 15 秒）' },
  'cover.jpg': { type: 'jpg', max: 4 * MB, label: '封面' },
  'cover.png': { type: 'png', max: 4 * MB, label: '封面' },
  'preview.jpg': { type: 'jpg', max: 4 * MB, label: '封面' },
  'preview.png': { type: 'png', max: 4 * MB, label: '封面' },
  'submission.json': { type: 'json', max: 128 * 1024, label: '投稿说明' },
})
const TEMPLATE_FILES = ['template.json', 'MOTION.md', 'script.json', 'preview.mp4', 'cover.jpg', 'cover.png', 'preview.jpg', 'preview.png']
const SUBMISSION_FILES = ['template.json', 'MOTION.md', 'script.json', 'preview.mp4', 'cover.jpg', 'cover.png', 'submission.json']
const ALLOWED_EXTENSIONS = new Set(['.json', '.md', '.mp4', '.jpg', '.jpeg', '.png'])

export const PLAZA_LIMITS = Object.freeze({
  previewMaxSec: 15,
  previewToleranceSec: 0.35,
  zipMaxBytes: 25 * MB, // GitHub attachment limit
  templateMaxBytes: 24 * MB,
  indexMaxBytes: 2 * MB,
  indexMaxTemplates: 300,
  zipMaxEntries: 32,
  titleMax: 60,
  descriptionMax: 300,
  tagsMax: 8,
  tagMax: 20,
  authorMax: 32,
  contactMax: 80,
})

const SUBMISSION_ID_RE = /^[a-z0-9][a-z0-9-]{2,79}$/
const SHA256_RE = /^[a-f0-9]{64}$/

const NOT_SHARED = Object.freeze([
  '素材原文件（图片 / 视频 / 音乐 / 录音）',
  '配音与混音音频、数字人视频',
  'API 密钥、模型与云端服务设置',
  '本机路径、电脑用户名与计算机名',
  '工程里的其他文件（代码、缓存、历史版本）',
])

/* ================================================================================================ small utils */

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const sha256File = (file) => sha256(readFileSync(file))
const rand = (n = 4) => randomBytes(n).toString('hex')
const nowIso = () => new Date().toISOString()

function pluginVersion() {
  try {
    return String(JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version || '0.0.0')
  } catch {
    return '0.0.0'
  }
}

function userError(message, status = 400, code = '') {
  const err = new Error(message)
  err.status = status
  err.expose = true
  if (code) err.code = code
  return err
}

const str = (v, max = 10000) =>
  String(v ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max)
const oneLine = (v, max) => str(v, max * 4).replace(/\s+/g, ' ').trim().slice(0, max)

export function slugifyPlazaId(text, max = 48) {
  return String(text || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
}

function stamp(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function fmtBytes(n) {
  const v = Number(n) || 0
  if (v >= MB) return `${(v / MB).toFixed(1)} MB`
  if (v >= 1024) return `${Math.round(v / 1024)} KB`
  return `${v} B`
}

function isInside(root, target) {
  const rel = relative(resolve(root), resolve(target))
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
}

export function categoryLabel(id) {
  const c = PLAZA_CATEGORIES.find((x) => x.id === id)
  if (!c) return String(id || '')
  return c.id === 'custom' ? '其他 / 社区' : c.label
}
const isValidCategory = (id) => PLAZA_CATEGORIES.some((c) => c.id === id && c.id !== 'all')

function parseTags(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(/[,，、;；\s]+/)
  const out = []
  for (const t of list) {
    const v = oneLine(t, PLAZA_LIMITS.tagMax).replace(/^#+/, '')
    if (v && !out.includes(v)) out.push(v)
    if (out.length >= PLAZA_LIMITS.tagsMax) break
  }
  return out
}

/* ================================================================================================ zip (store / deflate, UTF-8 names) */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
export function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d) {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()))
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds() / 2) & 31),
    date: (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31),
  }
}

/**
 * Write a zip. `entries`: [{ name, data?: Buffer, dir?: true, compress?: boolean }]. Text files are deflated, media
 * stored (already compressed). Written to a temp file first, then renamed.
 */
export function writeZip(destFile, entries, { date = new Date() } = {}) {
  const { time, date: ddate } = dosDateTime(date)
  const parts = []
  const central = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(String(e.name), 'utf8')
    const data = e.dir ? Buffer.alloc(0) : Buffer.from(e.data || Buffer.alloc(0))
    const crc = e.dir ? 0 : crc32(data)
    let method = 0
    let body = data
    if (!e.dir && e.compress !== false && data.length > 64) {
      const def = zlib.deflateRawSync(data, { level: 9 })
      if (def.length < data.length) {
        method = 8
        body = def
      }
    }
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(ddate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    parts.push(local, nameBuf, body)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4) // made by: MS-DOS / FAT, spec 2.0
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(method, 10)
    cen.writeUInt16LE(time, 12)
    cen.writeUInt16LE(ddate, 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(body.length, 20)
    cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt16LE(0, 30)
    cen.writeUInt16LE(0, 32)
    cen.writeUInt16LE(0, 34)
    cen.writeUInt16LE(0, 36)
    cen.writeUInt32LE(e.dir ? 0x10 : 0x20, 38) // DOS directory / archive attribute
    cen.writeUInt32LE(offset, 42)
    central.push(cen, nameBuf)
    offset += local.length + nameBuf.length + body.length
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(offset, 16)
  const out = Buffer.concat([...parts, ...central, eocd])
  const tmp = `${destFile}.${rand()}.part`
  writeFileSync(tmp, out)
  try {
    unlinkSync(destFile)
  } catch {}
  renameSync(tmp, destFile)
  return { bytes: out.length, sha256: sha256(out) }
}

/**
 * Read a zip safely (no zip64, no encryption, store / deflate only, no symlinks, sizes and CRC verified, inflate capped
 * at the declared size). Returns [{ name, data, dir }] with names normalised to '/'.
 */
export function readZip(file, { maxEntries = PLAZA_LIMITS.zipMaxEntries, maxBytes = PLAZA_LIMITS.zipMaxBytes, maxEntryBytes = 16 * MB, maxTotalBytes = 48 * MB } = {}) {
  const size = statSync(file).size
  if (size > maxBytes) throw userError(`投稿包太大（${fmtBytes(size)}，上限 ${fmtBytes(maxBytes)}）`)
  const buf = readFileSync(file)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw userError('不是有效的 zip 文件（找不到 zip 目录区）')
  if (buf.readUInt16LE(eocd + 4) !== 0 || buf.readUInt16LE(eocd + 6) !== 0) throw userError('不支持分卷 zip')
  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdOffset === 0xffffffff) throw userError('不支持 zip64 格式的投稿包')
  if (count > maxEntries) throw userError(`投稿包里的文件太多（${count} 个，上限 ${maxEntries} 个）`)
  const out = []
  let p = cdOffset
  let total = 0
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw userError('zip 目录区已损坏')
    const madeBy = buf.readUInt16LE(p + 4)
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const csize = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nlen = buf.readUInt16LE(p + 28)
    const xlen = buf.readUInt16LE(p + 30)
    const clen = buf.readUInt16LE(p + 32)
    const extAttr = buf.readUInt32LE(p + 38)
    const lho = buf.readUInt32LE(p + 42)
    const rawName = buf.subarray(p + 46, p + 46 + nlen)
    const name = (flags & 0x0800 ? rawName.toString('utf8') : rawName.toString('latin1')).replace(/\\/g, '/')
    p += 46 + nlen + xlen + clen
    if (flags & 0x0001) throw userError(`投稿包里的文件被加密了：${name}`)
    if (madeBy >> 8 === 3 && ((extAttr >>> 16) & 0o170000) === 0o120000) throw userError(`投稿包里有符号链接（不允许）：${name}`)
    const isDir = name.endsWith('/')
    if (isDir) {
      out.push({ name, data: Buffer.alloc(0), dir: true })
      continue
    }
    if (method !== 0 && method !== 8) throw userError(`不支持的 zip 压缩方式（${method}）：${name}`)
    if (usize > maxEntryBytes) throw userError(`文件太大：${name}（${fmtBytes(usize)}）`)
    total += usize
    if (total > maxTotalBytes) throw userError('投稿包解压后太大')
    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) throw userError(`zip 文件头损坏：${name}`)
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28)
    if (start + csize > buf.length) throw userError(`zip 数据不完整：${name}`)
    const raw = buf.subarray(start, start + csize)
    let data
    try {
      data = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, usize) })
    } catch {
      throw userError(`zip 数据无法解压（可能已损坏）：${name}`)
    }
    if (data.length !== usize) throw userError(`zip 文件大小不符：${name}`)
    if (crc32(data) !== crc) throw userError(`zip 校验失败（CRC 不符）：${name}`)
    out.push({ name, data, dir: false })
  }
  return out
}

/* ================================================================================================ media helpers */

async function probeMedia(file) {
  const { ffprobe } = resolveBinaries()
  const { code, stdout } = await runCommandRedirected(
    ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', file],
    { timeoutMs: 30_000 },
  )
  if (code !== 0) throw userError('无法读取视频（ffprobe 失败）')
  const j = JSON.parse(stdout || '{}')
  const streams = Array.isArray(j.streams) ? j.streams : []
  const v = streams.find((s) => s.codec_type === 'video') || {}
  const a = streams.find((s) => s.codec_type === 'audio') || null
  return {
    durationSec: Number(j.format?.duration || 0),
    width: Number(v.width || 0),
    height: Number(v.height || 0),
    videoCodec: String(v.codec_name || ''),
    hasVideo: Boolean(v.codec_type),
    hasAudio: Boolean(a),
    audioCodec: a ? String(a.codec_name || '') : '',
  }
}

/** Content check by type (magic bytes / UTF-8 / JSON). Returns '' or a Chinese reason. */
function checkFileContent(name, buf) {
  const rule = PLAZA_FILE_RULES[name]
  const type = rule ? rule.type : extname(name).slice(1).toLowerCase()
  if (!buf || !buf.length) return '文件是空的'
  if (rule && buf.length > rule.max) return `文件太大（${fmtBytes(buf.length)}，上限 ${fmtBytes(rule.max)}）`
  if (type === 'mp4') return buf.length > 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp' ? '' : '不是有效的 MP4 视频'
  if (type === 'jpg' || type === 'jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? '' : '不是有效的 JPG 图片'
  if (type === 'png') return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? '' : '不是有效的 PNG 图片'
  let text = ''
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return '不是 UTF-8 文本'
  }
  if (text.includes('\u0000')) return '文本里含有二进制数据'
  if (type === 'json') {
    try {
      const v = JSON.parse(text.replace(/^﻿/, ''))
      if (!v || typeof v !== 'object' || Array.isArray(v)) return 'JSON 顶层必须是对象'
    } catch {
      return '不是有效的 JSON'
    }
  }
  return ''
}

const parseJsonBuf = (buf) => JSON.parse(buf.toString('utf8').replace(/^﻿/, ''))

/** Re-encode a cover (a frame of the film or an existing image) as a metadata-free JPEG, ≤ 1280 px wide. */
async function buildCoverImage({ source, destFile, atSec = 0 }) {
  const { ffmpeg } = resolveBinaries()
  const isImage = /\.(png|jpe?g|webp)$/i.test(source)
  const args = ['-v', 'error', '-y']
  if (!isImage && atSec > 0) args.push('-ss', Number(atSec).toFixed(2))
  args.push(
    '-i', source,
    '-frames:v', '1',
    '-vf', "scale='min(1280,iw)':-2:flags=lanczos,format=yuvj420p",
    '-q:v', '3',
    '-map_metadata', '-1',
    '-fflags', '+bitexact',
    '-flags:v', '+bitexact',
    destFile,
  )
  const res = await runCommandRedirected(ffmpeg, args, { timeoutMs: 60_000 })
  if (res.code !== 0 || !existsSync(destFile)) throw userError(`封面生成失败：${String(res.stderr || '').trim().split(/\r?\n/).slice(-1)[0] || 'ffmpeg 出错'}`, 500)
  return statSync(destFile).size
}

/** Sample clip ≤ 15 s and ≤ the size limit (smaller retries when a busy film encodes too large). */
async function buildSubmissionPreview({ sourceMp4, destFile, startSec }) {
  const limit = PLAZA_FILE_RULES['preview.mp4'].max
  const attempts = [{}, { maxEdge: 720, crf: 31, audioKbps: 96 }, { maxEdge: 540, crf: 34, audioKbps: 80 }]
  let clip = null
  for (const a of attempts) {
    clip = await buildPlazaPreviewClip({ sourceMp4, destFile, startSec, durationSec: PLAZA_LIMITS.previewMaxSec, ...a })
    if (clip.bytes <= limit) return clip
  }
  throw userError(`样片压缩后仍然太大（${fmtBytes(clip.bytes)}，上限 ${fmtBytes(limit)}），请把「样片起点」换到画面更简单的一段再试`)
}

/* ================================================================================================ template content (shared) */

function projectFilm(projectDir) {
  const f = join(projectDir, 'output', 'final.mp4')
  return existsSync(f) ? f : ''
}

function pickCoverSource(projectDir, film) {
  const snap = join(projectDir, 'output', 'snapshot-3x3.png')
  try {
    if (existsSync(snap) && (!film || statSync(snap).mtimeMs >= statSync(film).mtimeMs - 1000)) return { source: snap, atSec: 0 }
  } catch {}
  return film ? { source: film, atSec: -1 } : null
}

/**
 * Sanitize a project's script and build template.json + MOTION.md for sharing (no files written, no ffmpeg).
 * Throws a privacy error (code 'privacy') when something is left that cannot be cleaned automatically.
 */
export function preparePlazaTemplateContent({ projectDir, templateId, title, category, description, tags, author, contact = '', allowNames = false, order = 60, privacy = {} }) {
  const absProject = resolve(projectDir)
  const { data: raw } = readScriptJson(absProject)
  const ctx = createPrivacyContext({
    ...privacy,
    projectDir: absProject,
    author,
    contact,
    allowNames,
    allowEmails: [PLAZA_BRAND.email, ...(privacy.allowEmails || [])],
  })
  const report = createPrivacyReport()
  const cleanScript = sanitizeValueForShare(raw, ctx, report, 'script')
  // reference videos are not shipped: keep their style, not their file names
  if (cleanScript.referenceStyle && typeof cleanScript.referenceStyle === 'object') {
    const rs = cleanScript.referenceStyle
    if (typeof rs.sourceName === 'string' && /\.[A-Za-z0-9]{2,5}$/.test(rs.sourceName.trim())) rs.sourceName = '参考视频'
  }
  const clean = {
    title: cleanTextForShare(oneLine(title, PLAZA_LIMITS.titleMax), ctx, report, '标题'),
    description: cleanTextForShare(str(description, PLAZA_LIMITS.descriptionMax), ctx, report, '简介'),
    tags: parseTags(tags).map((t, i) => cleanTextForShare(t, ctx, report, `标签 ${i + 1}`)),
    author: oneLine(author, PLAZA_LIMITS.authorMax),
  }
  const motionMd = cleanTextForShare(buildPlazaMotionMarkdown(cleanScript), ctx, report, 'MOTION.md')
  const meta = buildPlazaTemplateMeta(cleanScript, {
    id: templateId,
    order,
    name: clean.title,
    category,
    description: clean.description,
    tags: clean.tags,
    author: clean.author || PLAZA_BRAND.author,
    coverFile: 'cover.jpg',
  })
  const findings = [...scanForPrivacy(meta, ctx, 'template.json'), ...scanForPrivacy(cleanScript, ctx, 'script.json'), ...scanForPrivacy(motionMd, ctx, 'MOTION.md')]
  return { ctx, report, cleanScript, motionMd, meta, findings, clean }
}

/* ================================================================================================ submissions (user side) */

export function getPlazaSubmissionsRoot() {
  return join(getPlazaHomeDir(), 'plaza-submissions')
}

function submissionDir(id, { mustExist = true } = {}) {
  const sid = String(id || '').trim()
  if (!SUBMISSION_ID_RE.test(sid)) throw userError('投稿包编号无效', 400, 'bad-id')
  const root = getPlazaSubmissionsRoot()
  const dir = join(root, sid)
  if (!isInside(root, dir)) throw userError('投稿包编号无效', 400, 'bad-id')
  if (mustExist) {
    let st = null
    try {
      st = lstatSync(dir)
    } catch {}
    if (!st || !st.isDirectory() || st.isSymbolicLink()) throw userError('找不到这个投稿包（可能已被删除）', 404, 'not-found')
  }
  return dir
}

function validateSubmissionForm(input, { requireConsent }) {
  const errors = []
  const title = oneLine(input.title, PLAZA_LIMITS.titleMax + 1)
  if (!title) errors.push('请填写作品标题')
  else if (Array.from(title).length > PLAZA_LIMITS.titleMax) errors.push(`作品标题最多 ${PLAZA_LIMITS.titleMax} 个字`)
  const category = String(input.category || '').trim()
  if (!isValidCategory(category)) errors.push('请选择一个分类')
  const author = oneLine(input.author, PLAZA_LIMITS.authorMax + 1)
  if (!author) errors.push('请填写作者昵称（会显示在模板卡片上）')
  else if (Array.from(author).length > PLAZA_LIMITS.authorMax) errors.push(`作者昵称最多 ${PLAZA_LIMITS.authorMax} 个字`)
  const contact = oneLine(input.contact, PLAZA_LIMITS.contactMax + 1)
  if (Array.from(contact).length > PLAZA_LIMITS.contactMax) errors.push(`联系方式最多 ${PLAZA_LIMITS.contactMax} 个字`)
  const description = str(input.description, PLAZA_LIMITS.descriptionMax + 1)
  if (Array.from(description).length > PLAZA_LIMITS.descriptionMax) errors.push(`简介最多 ${PLAZA_LIMITS.descriptionMax} 个字`)
  if (requireConsent && input.consent !== true) errors.push('请先勾选授权声明（授权作者展示、整理和分发；内容不侵犯他人版权与隐私）')
  const start = input.previewStartSec === '' || input.previewStartSec === null || input.previewStartSec === undefined ? undefined : Number(input.previewStartSec)
  if (start !== undefined && !(Number.isFinite(start) && start >= 0)) errors.push('样片起点必须是不小于 0 的秒数')
  return { errors, title, category, author, contact, description, tags: parseTags(input.tags), previewStartSec: start }
}

/** Template ID of a submission: the title as a slug, else the project folder, else a short hash of the title. */
function submissionTemplateId(title, absProject) {
  // a Chinese-only title has no slug; a 1–2 letter leftover (e.g. "ui") is not a useful ID either
  const pick = [slugifyPlazaId(title), slugifyPlazaId(basename(absProject))].find((s) => s.length >= 3)
  const slug = pick || `tpl-${sha256(String(title || basename(absProject))).slice(0, 8)}`
  return slug.slice(0, 48).replace(/-+$/g, '') || 'tpl'
}

function previewPlan(info, startSec) {
  const total = Number(info?.durationSec) || 0
  const clip = Math.max(1, Math.min(PLAZA_LIMITS.previewMaxSec, total || PLAZA_LIMITS.previewMaxSec))
  let start = Number.isFinite(startSec) ? startSec : total > clip + 1 ? total * 0.18 : 0
  start = Math.max(0, Math.min(start, Math.max(0, total - clip)))
  return { startSec: Number(start.toFixed(1)), durationSec: Number(clip.toFixed(1)) }
}

const cap = (text, max) => (text.length > max ? { text: `${text.slice(0, max)}\n…（内容较长，此处只显示前 ${Math.round(max / 1024)} KB；投稿包里是完整文件）`, truncated: true } : { text, truncated: false })

function shareFileList({ meta, scriptText, motionMd, film, plan }) {
  const scenes = Number(meta.shotCount) || 0
  return [
    { name: 'template.json', label: PLAZA_FILE_RULES['template.json'].label, desc: '标题、分类、简介、标签、作者昵称，以及配色、节奏、转场等风格参数', bytes: Buffer.byteLength(JSON.stringify(meta, null, 2)) },
    { name: 'MOTION.md', label: PLAZA_FILE_RULES['MOTION.md'].label, desc: '分镜表（每镜前 36 字文案）、转场与节奏，任何 AI 都能照着复刻', bytes: Buffer.byteLength(motionMd) },
    { name: 'script.json', label: PLAZA_FILE_RULES['script.json'].label, desc: `${scenes} 个分镜的文案、画面描述与时间轴；素材只保留文件名，不含素材本身`, bytes: Buffer.byteLength(scriptText) },
    { name: 'preview.mp4', label: PLAZA_FILE_RULES['preview.mp4'].label, desc: film ? `从成片第 ${plan.startSec} 秒起截取 ${plan.durationSec} 秒，最长边不超过 960 像素，已去掉视频里的元数据` : '需要先渲染成片', bytes: null },
    { name: 'cover.jpg', label: PLAZA_FILE_RULES['cover.jpg'].label, desc: '成片画面截图（JPG），已去掉图片元数据', bytes: null },
    { name: 'submission.json', label: PLAZA_FILE_RULES['submission.json'].label, desc: '投稿信息、授权声明、插件版本、创建时间，以及每个文件的 SHA-256 校验值', bytes: null },
  ]
}

function namesNeedConfirm(report) {
  return report.names.length > 0
}

/**
 * 「预览将分享的内容」: everything the package will contain (texts, sizes, privacy cleanups) without writing anything.
 */
export async function previewPlazaSubmission(input = {}) {
  const projectDir = String(input.projectDir || '').trim()
  if (!projectDir || !existsSync(join(resolve(projectDir), 'script.json'))) throw userError('请先打开一个视频工程（找不到 script.json）')
  const absProject = resolve(projectDir)
  const form = validateSubmissionForm(input, { requireConsent: false })
  const film = projectFilm(absProject)
  const blocking = []
  if (!film) blocking.push('当前工程还没有成片（output/final.mp4）：投稿包需要从成片截取一段 ≤ 15 秒的样片，请先渲染成片。')
  let info = null
  if (film) {
    try {
      info = await probeMedia(film)
    } catch {
      blocking.push('成片无法读取（文件可能损坏），请重新渲染成片后再投稿。')
    }
  }
  const prep = preparePlazaTemplateContent({ projectDir: absProject, templateId: submissionTemplateId(form.title, absProject), ...form, allowNames: input.allowNames === true })
  const scriptText = JSON.stringify(prep.cleanScript, null, 2)
  const plan = previewPlan(info, form.previewStartSec)
  const hardFindings = prep.findings.filter((f) => f.kind !== 'name')
  if (hardFindings.length) blocking.push(privacyError(hardFindings, '这些内容无法自动清理').message)
  const needNames = namesNeedConfirm(prep.report) && input.allowNames !== true
  return {
    ok: true,
    dryRun: true,
    formErrors: form.errors,
    blocking,
    canBuild: !blocking.length && !form.errors.length && !needNames,
    film: info ? { durationSec: Number(info.durationSec.toFixed(2)), width: info.width, height: info.height, hasAudio: info.hasAudio } : null,
    previewPlan: plan,
    files: shareFileList({ meta: prep.meta, scriptText, motionMd: prep.motionMd, film, plan }),
    notShared: NOT_SHARED,
    privacy: {
      summary: describePrivacyReport(prep.report),
      counts: prep.report.counts,
      examples: prep.report.examples,
      names: prep.report.names.slice(0, 12),
      needsNameConfirm: needNames,
      labels: PRIVACY_KIND_LABEL,
    },
    texts: {
      'template.json': JSON.stringify(prep.meta, null, 2),
      'MOTION.md': cap(prep.motionMd, 200 * 1024).text,
      'script.json': cap(scriptText, 300 * 1024).text,
    },
    scriptStats: { scenes: Number(prep.meta.shotCount) || 0, durationSec: Number(prep.meta.durationSec) || 0, chars: scriptText.length },
    consentText: PLAZA_CONSENT_TEXT,
  }
}

/** Build the submission package (async: ffmpeg preview + cover). `onProgress({ stage, progress, message })`. */
export async function buildPlazaSubmission(input = {}, onProgress = () => {}) {
  const progress = (stage, pct, message) => {
    try {
      onProgress({ stage, progress: pct, message })
    } catch {}
  }
  const projectDir = String(input.projectDir || '').trim()
  if (!projectDir || !existsSync(join(resolve(projectDir), 'script.json'))) throw userError('请先打开一个视频工程（找不到 script.json）')
  const absProject = resolve(projectDir)
  const form = validateSubmissionForm(input, { requireConsent: true })
  if (form.errors.length) throw userError(form.errors.join('；'))
  const film = projectFilm(absProject)
  if (!film) throw userError('当前工程还没有成片（output/final.mp4）：请先渲染成片，投稿包需要一段 ≤ 15 秒的样片', 409, 'no-film')

  progress('privacy', 8, '正在检查隐私信息并整理模板…')
  const templateId = submissionTemplateId(form.title, absProject)
  const prep = preparePlazaTemplateContent({ projectDir: absProject, templateId, ...form, allowNames: input.allowNames === true })
  const hard = prep.findings.filter((f) => f.kind !== 'name')
  if (hard.length) throw privacyError(hard, '投稿包没有生成：这些内容无法自动清理，请在工程里改掉后重试')
  if (namesNeedConfirm(prep.report) && input.allowNames !== true) {
    throw privacyError(
      prep.report.names.map((n) => ({ kind: 'name', where: n.where, sample: n.name })),
      '投稿包没有生成：内容里出现了你的电脑用户名 / 计算机名。如果这是正常内容（例如品牌名或角色名），请勾选「这些词可以公开」后重试；否则请在工程里改掉',
    )
  }

  const root = getPlazaSubmissionsRoot()
  mkdirSync(root, { recursive: true })
  let id = `${templateId.slice(0, 56)}-${stamp()}`
  for (let n = 2; existsSync(join(root, id)); n++) id = `${templateId.slice(0, 52)}-${stamp()}-${n}`
  const dir = join(root, id)
  const filesDir = join(dir, 'files')
  mkdirSync(filesDir, { recursive: true })
  try {
    progress('preview', 22, '正在从成片截取 ≤ 15 秒样片（去除元数据）…')
    const clip = await buildSubmissionPreview({ sourceMp4: film, destFile: join(filesDir, 'preview.mp4'), startSec: form.previewStartSec })
    progress('cover', 70, '正在生成封面…')
    const coverSrc = pickCoverSource(absProject, film)
    const atSec = coverSrc && coverSrc.atSec < 0 ? Math.max(0, clip.startSec + Math.min(clip.durationSec, 15) * 0.4) : 0
    await buildCoverImage({ source: coverSrc.source, destFile: join(filesDir, 'cover.jpg'), atSec })

    progress('files', 82, '正在写入模板文件…')
    const meta = { ...prep.meta, previewFile: 'preview.mp4', previewDurationSec: clip.durationSec }
    const texts = {
      'template.json': `${JSON.stringify(meta, null, 2)}\n`,
      'MOTION.md': prep.motionMd.endsWith('\n') ? prep.motionMd : `${prep.motionMd}\n`,
      'script.json': `${JSON.stringify(prep.cleanScript, null, 2)}\n`,
    }
    for (const [name, text] of Object.entries(texts)) writeFileSync(join(filesDir, name), text, 'utf8')
    const fileList = ['template.json', 'MOTION.md', 'script.json', 'preview.mp4', 'cover.jpg'].map((name) => {
      const buf = readFileSync(join(filesDir, name))
      return { name, size: buf.length, sha256: sha256(buf) }
    })
    const submission = {
      schema: PLAZA_SUBMISSION_SCHEMA,
      id,
      templateId,
      title: prep.clean.title,
      category: form.category,
      categoryLabel: categoryLabel(form.category),
      description: prep.clean.description,
      tags: prep.clean.tags,
      author: prep.clean.author,
      contact: form.contact,
      consent: { agreed: true, text: PLAZA_CONSENT_TEXT, at: nowIso() },
      pluginVersion: pluginVersion(),
      createdAt: nowIso(),
      film: { durationSec: meta.durationSec, shotCount: meta.shotCount, aspectRatio: meta.aspectRatio, engine: meta.engine },
      preview: { durationSec: clip.durationSec, startSec: clip.startSec, width: clip.width, height: clip.height, hasAudio: clip.hasAudio },
      privacy: { checked: true, summary: describePrivacyReport(prep.report), counts: prep.report.counts, namesConfirmed: input.allowNames === true && prep.report.names.length > 0 },
      files: fileList,
    }
    writeFileSync(join(filesDir, 'submission.json'), `${JSON.stringify(submission, null, 2)}\n`, 'utf8')

    progress('verify', 88, '正在做最后一次隐私检查…')
    const finalCtx = { ...prep.ctx, allowNames: true } // names were confirmed or absent; re-check paths / keys / e-mails
    const finalFindings = [
      ...scanForPrivacy(JSON.parse(texts['template.json']), finalCtx, 'template.json'),
      ...scanForPrivacy(JSON.parse(texts['script.json']), finalCtx, 'script.json'),
      ...scanForPrivacy(texts['MOTION.md'], finalCtx, 'MOTION.md'),
      ...scanForPrivacy(submission, finalCtx, 'submission.json'),
      ...scanBinaryForPrivacy(readFileSync(join(filesDir, 'preview.mp4')), prep.ctx, 'preview.mp4'),
      ...scanBinaryForPrivacy(readFileSync(join(filesDir, 'cover.jpg')), prep.ctx, 'cover.jpg'),
    ]
    if (finalFindings.length) throw privacyError(finalFindings, '投稿包没有生成：最终检查发现隐私信息')

    progress('zip', 94, '正在打包…')
    const zipFile = join(dir, `${id}.zip`)
    const entries = [{ name: `${id}/`, dir: true }]
    for (const name of SUBMISSION_FILES) {
      const f = join(filesDir, name)
      if (existsSync(f)) entries.push({ name: `${id}/${name}`, data: readFileSync(f), compress: /\.(json|md)$/i.test(name) })
    }
    const zip = writeZip(zipFile, entries)
    if (zip.bytes > PLAZA_LIMITS.zipMaxBytes) throw userError(`投稿包太大（${fmtBytes(zip.bytes)}），超过 GitHub 附件上限 ${fmtBytes(PLAZA_LIMITS.zipMaxBytes)}`)
    writeJsonAtomic(join(dir, 'status.json'), { submitted: false, submittedAt: '', channel: '', zipSha256: zip.sha256, zipBytes: zip.bytes, updatedAt: nowIso() })
    progress('done', 100, '投稿包已生成')
    return getPlazaSubmission(id)
  } catch (err) {
    removeTreeNoFollow(dir)
    throw err
  }
}

/** GitHub issue form + mailto links for one package (opened by the user; nothing is sent automatically). */
export function buildSubmissionChannels(sub) {
  const title = String(sub.title || '').slice(0, 80)
  const zipName = `${sub.id}.zip`
  const issueTitle = `[影核广场投稿] ${title}`.slice(0, 120)
  const fields = [
    ['tpl_title', title],
    ['category', `${sub.categoryLabel || categoryLabel(sub.category)}（${sub.category}）`],
    ['description', String(sub.description || '').slice(0, 300)],
    ['tags', (sub.tags || []).join('、')],
    ['author', sub.author || ''],
    ['contact', sub.contact || ''],
    ['package', zipName],
    ['sha256', sub.zipSha256 || ''],
    ['plugin_version', sub.pluginVersion ? `v${sub.pluginVersion}` : ''],
  ]
  const q = new URLSearchParams()
  q.set('template', PLAZA_COMMUNITY.issueTemplate)
  q.set('title', issueTitle)
  for (const [k, v] of fields) if (v) q.set(k, v)
  let githubUrl = `${PLAZA_COMMUNITY.repoUrl}/issues/new?${q.toString()}`
  if (githubUrl.length > 7000) {
    q.delete('description')
    githubUrl = `${PLAZA_COMMUNITY.repoUrl}/issues/new?${q.toString()}`
  }
  const subject = issueTitle
  const body = [
    `${PLAZA_BRAND.author} 你好，我想把作品投稿到${PLAZA_BRAND.displayName}：`,
    '',
    `作品标题：${title}`,
    `分类：${sub.categoryLabel || categoryLabel(sub.category)}`,
    `简介：${String(sub.description || '（未填写）').slice(0, 300)}`,
    `标签：${(sub.tags || []).join('、') || '（未填写）'}`,
    `作者昵称：${sub.author || ''}`,
    `联系方式：${sub.contact || '（未填写）'}`,
    `投稿包：${zipName}（${fmtBytes(sub.zipBytes)}，SHA-256：${sub.zipSha256 || ''}）`,
    `插件版本：v${sub.pluginVersion || ''}`,
    '',
    '【请把投稿包 zip 文件作为附件添加到这封邮件后再发送】',
    '',
    `我确认：${PLAZA_CONSENT_TEXT}`,
  ].join('\r\n')
  return {
    issueTitle,
    githubUrl,
    email: PLAZA_COMMUNITY.email,
    mailSubject: subject,
    mailBody: body,
    mailtoUrl: `mailto:${PLAZA_COMMUNITY.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  }
}

function readSubmissionRecord(dir) {
  const id = basename(dir)
  const meta = readJsonSafe(join(dir, 'files', 'submission.json'), null)
  if (!meta || meta.schema !== PLAZA_SUBMISSION_SCHEMA) return null
  const zipFile = join(dir, `${id}.zip`)
  const status = readJsonSafe(join(dir, 'status.json'), {}) || {}
  let zipBytes = 0
  try {
    zipBytes = statSync(zipFile).size
  } catch {}
  const hasFile = (n) => existsSync(join(dir, 'files', n))
  const v = encodeURIComponent(String(meta.createdAt || '').replace(/\D/g, '').slice(-10) || '0')
  const rec = {
    id,
    title: String(meta.title || id),
    category: String(meta.category || ''),
    categoryLabel: String(meta.categoryLabel || categoryLabel(meta.category)),
    description: String(meta.description || ''),
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    author: String(meta.author || ''),
    contact: String(meta.contact || ''),
    createdAt: String(meta.createdAt || ''),
    pluginVersion: String(meta.pluginVersion || ''),
    zipName: `${id}.zip`,
    zipBytes,
    zipSha256: String(status.zipSha256 || ''),
    hasZip: zipBytes > 0,
    submitted: Boolean(status.submitted),
    submittedAt: String(status.submittedAt || ''),
    channel: String(status.channel || ''),
    folder: dir,
    zipPath: zipFile,
    files: Array.isArray(meta.files) ? meta.files.map((f) => ({ name: f.name, size: f.size, sha256: f.sha256 })) : [],
    preview: meta.preview || null,
    privacy: meta.privacy || null,
    coverUrl: hasFile('cover.jpg') ? `/api/video-workbench/plaza/submissions?id=${encodeURIComponent(id)}&file=cover.jpg&v=${v}` : '',
    previewUrl: hasFile('preview.mp4') ? `/api/video-workbench/plaza/submissions?id=${encodeURIComponent(id)}&file=preview.mp4&v=${v}` : '',
  }
  if (!rec.zipSha256 && rec.hasZip) {
    try {
      rec.zipSha256 = sha256File(zipFile)
    } catch {}
  }
  return rec
}

/** 「我的投稿」 */
export function listPlazaSubmissions() {
  const root = getPlazaSubmissionsRoot()
  const list = []
  if (existsSync(root)) {
    for (const name of readdirSync(root)) {
      if (!SUBMISSION_ID_RE.test(name)) continue
      const dir = join(root, name)
      try {
        const st = lstatSync(dir)
        if (!st.isDirectory() || st.isSymbolicLink()) continue
      } catch {
        continue
      }
      const rec = readSubmissionRecord(dir)
      if (rec) list.push(rec)
    }
  }
  list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { ok: true, root, submissions: list.map(({ files, privacy, ...rest }) => ({ ...rest, fileCount: files.length })) }
}

/** One package with its file list, the shared texts and the channel links. */
export function getPlazaSubmission(id, { withTexts = true } = {}) {
  const dir = submissionDir(id)
  const rec = readSubmissionRecord(dir)
  if (!rec) throw userError('这个投稿包已损坏（缺少 submission.json），可以删除后重新生成', 404, 'broken')
  const files = rec.files.map((f) => ({ ...f, label: PLAZA_FILE_RULES[f.name]?.label || f.name }))
  try {
    const st = statSync(join(dir, 'files', 'submission.json'))
    files.push({ name: 'submission.json', size: st.size, sha256: '', label: PLAZA_FILE_RULES['submission.json'].label })
  } catch {}
  const out = { ok: true, submission: { ...rec, files }, channels: buildSubmissionChannels(rec), notShared: NOT_SHARED, consentText: PLAZA_CONSENT_TEXT }
  if (withTexts) {
    const read = (n, max) => {
      try {
        return cap(readFileSync(join(dir, 'files', n), 'utf8'), max).text
      } catch {
        return ''
      }
    }
    out.texts = {
      'template.json': read('template.json', 128 * 1024),
      'MOTION.md': read('MOTION.md', 200 * 1024),
      'script.json': read('script.json', 300 * 1024),
      'submission.json': read('submission.json', 128 * 1024),
    }
  }
  return out
}

export function deletePlazaSubmission(id) {
  const dir = submissionDir(id)
  removeTreeNoFollow(dir)
  return { ok: true, id: String(id) }
}

export function markPlazaSubmission(id, { submitted = true, channel = '' } = {}) {
  const dir = submissionDir(id)
  const file = join(dir, 'status.json')
  const cur = readJsonSafe(file, {}) || {}
  const ch = ['github', 'email', 'other'].includes(String(channel)) ? String(channel) : cur.channel || ''
  const next = { ...cur, submitted: Boolean(submitted), submittedAt: submitted ? cur.submittedAt || nowIso() : '', channel: submitted ? ch : '', updatedAt: nowIso() }
  writeJsonAtomic(file, next)
  return { ok: true, id: String(id), submitted: next.submitted, submittedAt: next.submittedAt, channel: next.channel }
}

/** A file of a package for the UI (preview player / cover thumbnail). Only these names, only inside the package. */
export function resolvePlazaSubmissionFile(id, name) {
  const allowed = { 'preview.mp4': 'video/mp4', 'cover.jpg': 'image/jpeg', 'cover.png': 'image/png' }
  if (!allowed[name]) throw userError('不支持的文件', 400)
  const dir = submissionDir(id)
  const file = join(dir, 'files', name)
  if (!isInside(dir, file) || !existsSync(file)) throw userError('文件不存在', 404, 'not-found')
  return { file, type: allowed[name] }
}

/**
 * 「打开投稿包所在文件夹」: only packages inside plaza-submissions/. Windows Explorer `/select,`, macOS `open -R`,
 * elsewhere (or with `launch: false` / `DSH_PLAZA_REVEAL=0`) just returns the path.
 */
export function revealPlazaSubmission(id, { launch = process.env.DSH_PLAZA_REVEAL !== '0' } = {}) {
  const dir = submissionDir(id)
  const zip = join(dir, `${basename(dir)}.zip`)
  const target = existsSync(zip) ? zip : dir
  if (!isInside(getPlazaSubmissionsRoot(), target) || target.includes('"')) throw userError('投稿包路径无效', 400, 'bad-id')
  let opened = false
  if (launch) {
    try {
      let child = null
      if (process.platform === 'win32') {
        child = spawn('explorer.exe', [`/select,"${target}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore', windowsHide: false })
      } else if (process.platform === 'darwin') {
        child = spawn('open', ['-R', target], { detached: true, stdio: 'ignore' })
      }
      if (child) {
        child.on('error', () => {})
        child.unref()
        opened = true
      }
    } catch {}
  }
  return { ok: true, opened, path: target, folder: dir, platform: process.platform }
}

/* ================================================================================================ maintainer: review / accept / add / index */

function collectDirFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = lstatSync(full)
    if (st.isSymbolicLink()) throw userError(`包里有符号链接（不允许）：${name}`)
    if (st.isDirectory()) continue
    if (st.size > 16 * MB) throw userError(`文件太大：${name}（${fmtBytes(st.size)}）`)
    out.push({ name, data: readFileSync(full) })
  }
  return out
}

/** Read a package (zip, package folder, or a folder with the files) into { name → Buffer }. */
function loadPackage(src) {
  const abs = resolve(String(src || ''))
  if (!existsSync(abs)) throw userError(`找不到：${src}`)
  const st = statSync(abs)
  let entries = []
  let kind = 'dir'
  if (st.isFile()) {
    if (!/\.zip$/i.test(abs)) throw userError('请指定投稿包 zip 文件或解压后的文件夹')
    kind = 'zip'
    entries = readZip(abs).filter((e) => !e.dir)
    const bad = entries.find((e) => !e.name || e.name.startsWith('/') || /^[A-Za-z]:/.test(e.name) || e.name.split('/').some((s) => s === '..' || s === '.') || /[\u0000-\u001f]/.test(e.name))
    if (bad) throw userError(`投稿包里有不安全的文件路径：${bad.name.slice(0, 80)}`)
    const tops = new Set(entries.map((e) => (e.name.includes('/') ? e.name.split('/')[0] : '')))
    if (tops.size === 1 && !tops.has('')) entries = entries.map((e) => ({ ...e, name: e.name.slice(e.name.indexOf('/') + 1) }))
    const nested = entries.find((e) => e.name.includes('/'))
    if (nested) throw userError(`投稿包里不应有子文件夹：${nested.name.slice(0, 80)}`)
  } else {
    let dir = abs
    if (!existsSync(join(dir, 'submission.json')) && !existsSync(join(dir, 'template.json'))) {
      if (existsSync(join(dir, 'files', 'submission.json'))) dir = join(dir, 'files')
      else {
        const subs = readdirSync(dir).filter((n) => {
          try {
            return statSync(join(dir, n)).isDirectory()
          } catch {
            return false
          }
        })
        if (subs.length === 1 && existsSync(join(dir, subs[0], 'submission.json'))) dir = join(dir, subs[0])
      }
    }
    entries = collectDirFiles(dir)
  }
  const files = new Map()
  for (const e of entries) {
    if (files.has(e.name)) throw userError(`投稿包里有重复的文件：${e.name}`)
    files.set(e.name, e.data)
  }
  return { abs, kind, files, bytes: st.isFile() ? st.size : [...files.values()].reduce((a, b) => a + b.length, 0) }
}

async function probeBuffer(buf, name) {
  const dir = join(REPO_ROOT, '.tmp', `plaza-review-${process.pid}-${rand()}`)
  mkdirSync(dir, { recursive: true })
  const f = join(dir, name)
  try {
    writeFileSync(f, buf)
    return await probeMedia(f)
  } finally {
    removeTreeNoFollow(dir)
  }
}

/**
 * Validate a received package: schema, file types (json / md / mp4 / jpg / png only), sizes, sha256, preview ≤ 15 s and
 * the privacy gate. Returns { ok, errors, warnings, summary, files } (files = Map name → Buffer, for accept).
 */
export async function reviewPlazaPackage(src) {
  const pkg = loadPackage(src)
  const errors = []
  const warnings = []
  const files = pkg.files
  const fileReport = []
  for (const [name, buf] of files) {
    const ext = extname(name).toLowerCase()
    if (!SUBMISSION_FILES.includes(name)) {
      if (!ALLOWED_EXTENSIONS.has(ext)) errors.push(`不允许的文件类型：${name}（只允许 json / md / mp4 / jpg / png）`)
      else warnings.push(`多余的文件：${name}（不会被收录）`)
      continue
    }
    const why = checkFileContent(name, buf)
    if (why) errors.push(`${name}：${why}`)
    fileReport.push({ name, size: buf.length, sha256: sha256(buf), ok: !why })
  }
  for (const req of ['template.json', 'MOTION.md', 'script.json', 'preview.mp4', 'submission.json']) {
    if (!files.has(req)) errors.push(`缺少文件：${req}`)
  }
  if (!files.has('cover.jpg') && !files.has('cover.png')) warnings.push('没有封面（cover.jpg / cover.png），模板卡片会显示占位图')

  let sub = null
  let tpl = null
  let script = null
  try {
    if (files.has('submission.json')) sub = parseJsonBuf(files.get('submission.json'))
  } catch {}
  try {
    if (files.has('template.json')) tpl = parseJsonBuf(files.get('template.json'))
  } catch {}
  try {
    if (files.has('script.json')) script = parseJsonBuf(files.get('script.json'))
  } catch {}

  if (sub) {
    if (sub.schema !== PLAZA_SUBMISSION_SCHEMA) errors.push(`submission.json 格式不对（schema 应为 ${PLAZA_SUBMISSION_SCHEMA}）`)
    if (!SUBMISSION_ID_RE.test(String(sub.id || ''))) errors.push('submission.json：投稿编号 id 无效')
    if (!oneLine(sub.title, 200)) errors.push('submission.json：缺少作品标题')
    else if (Array.from(oneLine(sub.title, 200)).length > PLAZA_LIMITS.titleMax) errors.push(`submission.json：标题超过 ${PLAZA_LIMITS.titleMax} 字`)
    if (!isValidCategory(String(sub.category || ''))) errors.push(`submission.json：分类无效（${String(sub.category || '空')}）`)
    if (!oneLine(sub.author, 100)) errors.push('submission.json：缺少作者昵称')
    if (!sub.consent || sub.consent.agreed !== true) errors.push('submission.json：投稿人没有勾选授权声明')
    const listed = Array.isArray(sub.files) ? sub.files : []
    if (!listed.length) errors.push('submission.json：缺少文件校验清单（files）')
    const listedNames = new Set()
    for (const f of listed) {
      const name = String(f?.name || '')
      listedNames.add(name)
      if (!files.has(name)) {
        errors.push(`清单里的文件不在包里：${name}`)
        continue
      }
      const buf = files.get(name)
      if (Number(f.size) !== buf.length) errors.push(`${name}：大小与清单不符（清单 ${f.size}，实际 ${buf.length}）`)
      if (!SHA256_RE.test(String(f.sha256 || '')) || f.sha256 !== sha256(buf)) errors.push(`${name}：SHA-256 校验失败（文件被改动或损坏）`)
    }
    for (const name of files.keys()) {
      if (name !== 'submission.json' && SUBMISSION_FILES.includes(name) && !listedNames.has(name)) errors.push(`${name} 不在 submission.json 的校验清单里`)
    }
  }
  if (tpl) {
    if (!oneLine(tpl.name, 200)) errors.push('template.json：缺少模板名称 name')
    if (tpl.id && !isValidPlazaTemplateId(String(tpl.id))) errors.push(`template.json：模板 ID 无效（${String(tpl.id).slice(0, 60)}）`)
  }
  if (script && !Array.isArray(script.scenes)) warnings.push('script.json 没有分镜（scenes），套用时只能导入风格')

  // preview ≤ 15 s
  let preview = null
  if (files.has('preview.mp4') && !checkFileContent('preview.mp4', files.get('preview.mp4'))) {
    try {
      preview = await probeBuffer(files.get('preview.mp4'), 'preview.mp4')
      if (!preview.hasVideo) errors.push('preview.mp4：没有视频画面')
      if (preview.durationSec > PLAZA_LIMITS.previewMaxSec + PLAZA_LIMITS.previewToleranceSec) errors.push(`preview.mp4：样片 ${preview.durationSec.toFixed(1)} 秒，超过 ${PLAZA_LIMITS.previewMaxSec} 秒上限`)
      if (preview.videoCodec && preview.videoCodec !== 'h264') warnings.push(`preview.mp4：视频编码是 ${preview.videoCodec}，部分浏览器可能无法播放（推荐 H.264）`)
      if (Math.max(preview.width, preview.height) > 1920) warnings.push(`preview.mp4：分辨率 ${preview.width}×${preview.height} 偏大`)
    } catch {
      errors.push('preview.mp4：无法读取视频（文件可能损坏）')
    }
  }

  // privacy gate (the submitter's own user name cannot be known here: paths, keys, foreign e-mails, user folders)
  const ctx = createPrivacyContext({ checkLocalNames: false, includeConfiguredSecrets: false, allowEmails: [PLAZA_BRAND.email, ...String(sub?.contact || '').split(/\s+/)], contact: String(sub?.contact || '') })
  const findings = []
  if (tpl) findings.push(...scanForPrivacy(tpl, ctx, 'template.json'))
  if (script) findings.push(...scanForPrivacy(script, ctx, 'script.json'))
  if (sub) findings.push(...scanForPrivacy({ ...sub, contact: '' }, ctx, 'submission.json'))
  if (files.has('MOTION.md')) findings.push(...scanForPrivacy(files.get('MOTION.md').toString('utf8'), ctx, 'MOTION.md'))
  for (const n of ['preview.mp4', 'cover.jpg', 'cover.png']) if (files.has(n)) findings.push(...scanBinaryForPrivacy(files.get(n), null, n))
  for (const f of findings.slice(0, 12)) errors.push(`隐私检查：${PRIVACY_KIND_LABEL[f.kind] || f.kind} · ${f.where}${f.sample ? `（${f.sample}）` : ''}`)
  if (findings.length > 12) errors.push(`隐私检查：另有 ${findings.length - 12} 处`)

  const summary = {
    source: pkg.abs,
    kind: pkg.kind,
    bytes: pkg.bytes,
    id: String(sub?.id || ''),
    templateId: String(sub?.templateId || tpl?.id || ''),
    title: oneLine(sub?.title || tpl?.name, 200),
    category: String(sub?.category || tpl?.category || ''),
    categoryLabel: categoryLabel(String(sub?.category || tpl?.category || '')),
    description: str(sub?.description || tpl?.description, 600),
    tags: Array.isArray(sub?.tags) ? sub.tags : Array.isArray(tpl?.tags) ? tpl.tags : [],
    author: oneLine(sub?.author || tpl?.author, 100),
    contact: oneLine(sub?.contact, 120),
    createdAt: String(sub?.createdAt || ''),
    pluginVersion: String(sub?.pluginVersion || ''),
    shotCount: Number(tpl?.shotCount || script?.scenes?.length || 0),
    durationSec: Number(tpl?.durationSec || 0),
    aspectRatio: String(tpl?.aspectRatio || ''),
    engine: String(tpl?.engine || ''),
    preview: preview ? { durationSec: Number(preview.durationSec.toFixed(2)), width: preview.width, height: preview.height, videoCodec: preview.videoCodec, hasAudio: preview.hasAudio } : null,
    files: fileReport,
    privacyClean: findings.length === 0,
  }
  return { ok: errors.length === 0, errors, warnings, summary, files }
}

function installTemplateFiles(destRoot, id, writer, { force = false } = {}) {
  if (!isValidPlazaTemplateId(id)) throw userError(`模板 ID 无效：${id}（只能用英文字母、数字、- 和 _）`)
  const root = resolve(destRoot)
  mkdirSync(root, { recursive: true })
  const dest = join(root, id)
  if (!isInside(root, dest)) throw userError(`模板 ID 无效：${id}`)
  if (existsSync(dest) && !force) throw userError(`模板「${id}」已存在：${dest}\n如需覆盖，请加 --force`, 409, 'exists')
  const staging = join(root, `.staging-${id}-${rand()}`)
  mkdirSync(staging, { recursive: true })
  try {
    writer(staging)
    let old = ''
    if (existsSync(dest)) {
      old = join(root, `.old-${id}-${rand()}`)
      renameSync(dest, old)
    }
    try {
      renameSync(staging, dest)
    } catch (err) {
      if (old) renameSync(old, dest)
      throw err
    }
    if (old) removeTreeNoFollow(old)
  } catch (err) {
    removeTreeNoFollow(staging)
    throw err
  }
  return dest
}

/** `plaza accept`: install a reviewed package as a built-in template (ready to commit). */
export async function acceptPlazaPackage(src, { id = '', category = '', force = false, templatesDir = '' } = {}) {
  const review = await reviewPlazaPackage(src)
  if (!review.ok) {
    const err = userError(`投稿包没有通过审核，未收录：\n${review.errors.map((e) => `· ${e}`).join('\n')}`, 422, 'review-failed')
    err.review = review
    throw err
  }
  const files = review.files
  const sub = parseJsonBuf(files.get('submission.json'))
  const tpl = parseJsonBuf(files.get('template.json'))
  const finalId = String(id || slugifyPlazaId(sub.templateId || tpl.id || sub.title) || '').trim()
  if (!finalId) throw userError('无法确定模板 ID，请用 --id <英文ID> 指定')
  const finalCategory = String(category || sub.category || tpl.category || '').trim()
  if (!isValidCategory(finalCategory)) throw userError(`分类无效：${finalCategory}（可选：${PLAZA_CATEGORIES.filter((c) => c.id !== 'all').map((c) => c.id).join(' / ')}）`)
  const cover = files.has('cover.jpg') ? 'cover.jpg' : files.has('cover.png') ? 'cover.png' : ''
  const now = nowIso()
  const meta = {
    ...tpl,
    id: finalId,
    category: finalCategory,
    order: Number.isFinite(Number(tpl.order)) && Number(tpl.order) >= 10 ? Number(tpl.order) : 60,
    author: oneLine(sub.author || tpl.author, PLAZA_LIMITS.authorMax) || PLAZA_BRAND.author,
    plaza: PLAZA_BRAND.displayName,
    coverFile: cover,
    previewFile: 'preview.mp4',
    previewDurationSec: review.summary.preview ? Number(review.summary.preview.durationSec.toFixed(2)) : tpl.previewDurationSec,
    updatedAt: now,
    community: { submissionId: sub.id, submittedAt: sub.createdAt || '', acceptedAt: now, pluginVersion: sub.pluginVersion || '' },
  }
  delete meta.contact
  const destRoot = templatesDir ? resolve(templatesDir) : getBuiltinPlazaDir()
  const dest = installTemplateFiles(
    destRoot,
    finalId,
    (dir) => {
      writeFileSync(join(dir, 'template.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
      for (const n of ['MOTION.md', 'script.json', 'preview.mp4', cover].filter(Boolean)) writeFileSync(join(dir, n), files.get(n))
    },
    { force },
  )
  return { ok: true, id: finalId, category: finalCategory, title: meta.name, dest, review }
}

/** `plaza add`: the author publishes one of his own projects straight into the built-in plaza (preview clip + cover). */
export async function addProjectToBuiltinPlaza({ projectDir, id = '', category = '', title = '', description = '', tags = [], author = '', force = false, templatesDir = '', allowNames = false, previewStartSec, onProgress = () => {} } = {}) {
  if (!projectDir) throw userError('请用 --project <工程目录> 指定工程')
  const absProject = resolve(projectDir)
  if (!existsSync(join(absProject, 'script.json'))) throw userError(`工程缺少 script.json：${absProject}`)
  const film = projectFilm(absProject)
  if (!film) throw userError('工程还没有成片（output/final.mp4）：请先渲染成片，模板需要 ≤ 15 秒样片')
  const { data: raw } = readScriptJson(absProject)
  const finalTitle = oneLine(title || raw.displayTitle || raw.title || basename(absProject), PLAZA_LIMITS.titleMax)
  const finalId = String(id || slugifyPlazaId(finalTitle) || slugifyPlazaId(basename(absProject)) || '').trim()
  if (!finalId) throw userError('无法从标题生成英文 ID，请用 --id <英文ID> 指定')
  const finalCategory = String(category || raw.genre || '').trim()
  if (!isValidCategory(finalCategory)) throw userError(`请用 --category 指定分类（可选：${PLAZA_CATEGORIES.filter((c) => c.id !== 'all').map((c) => c.id).join(' / ')}）`)
  const prep = preparePlazaTemplateContent({
    projectDir: absProject,
    templateId: finalId,
    title: finalTitle,
    category: finalCategory,
    description,
    tags,
    author: author || PLAZA_BRAND.author,
    allowNames,
    order: 50,
  })
  const hard = prep.findings.filter((f) => f.kind !== 'name')
  if (hard.length) throw privacyError(hard, '没有发布：这些内容无法自动清理')
  if (prep.report.names.length && !allowNames) {
    throw privacyError(prep.report.names.map((n) => ({ kind: 'name', where: n.where, sample: n.name })), '没有发布：内容里出现了电脑用户名 / 计算机名（确认可以公开请加 --allow-names）')
  }
  const destRoot = templatesDir ? resolve(templatesDir) : getBuiltinPlazaDir()
  if (existsSync(join(destRoot, finalId)) && !force) throw userError(`模板「${finalId}」已存在，如需覆盖请加 --force`, 409, 'exists')
  const work = join(REPO_ROOT, '.tmp', `plaza-add-${process.pid}-${rand()}`)
  mkdirSync(work, { recursive: true })
  try {
    onProgress('正在截取 ≤ 15 秒样片…')
    const start = previewStartSec === undefined || previewStartSec === null || previewStartSec === '' ? undefined : Number(previewStartSec)
    if (start !== undefined && !(start >= 0)) throw userError('--preview-start 必须是不小于 0 的秒数')
    const clip = await buildSubmissionPreview({ sourceMp4: film, destFile: join(work, 'preview.mp4'), startSec: start })
    onProgress('正在生成封面…')
    const coverSrc = pickCoverSource(absProject, film)
    await buildCoverImage({ source: coverSrc.source, destFile: join(work, 'cover.jpg'), atSec: coverSrc.atSec < 0 ? clip.startSec + clip.durationSec * 0.4 : 0 })
    const meta = { ...prep.meta, previewFile: 'preview.mp4', previewDurationSec: clip.durationSec }
    const findings = [...scanBinaryForPrivacy(readFileSync(join(work, 'preview.mp4')), prep.ctx, 'preview.mp4'), ...scanBinaryForPrivacy(readFileSync(join(work, 'cover.jpg')), prep.ctx, 'cover.jpg')]
    if (findings.length) throw privacyError(findings, '没有发布：样片 / 封面里有本机路径')
    const dest = installTemplateFiles(
      destRoot,
      finalId,
      (dir) => {
        writeFileSync(join(dir, 'template.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
        writeFileSync(join(dir, 'MOTION.md'), prep.motionMd.endsWith('\n') ? prep.motionMd : `${prep.motionMd}\n`, 'utf8')
        writeFileSync(join(dir, 'script.json'), `${JSON.stringify(prep.cleanScript, null, 2)}\n`, 'utf8')
        copyFileSync(join(work, 'preview.mp4'), join(dir, 'preview.mp4'))
        copyFileSync(join(work, 'cover.jpg'), join(dir, 'cover.jpg'))
      },
      { force },
    )
    return { ok: true, id: finalId, title: meta.name, category: finalCategory, dest, preview: clip, privacy: describePrivacyReport(prep.report) }
  } finally {
    removeTreeNoFollow(work)
  }
}

function listTemplateFiles(dir) {
  return TEMPLATE_FILES.filter((n) => {
    try {
      const st = lstatSync(join(dir, n))
      return st.isFile() && !st.isSymbolicLink()
    } catch {
      return false
    }
  })
}

/**
 * `plaza index`: write `<templates>/index.json` (id, title, category, version, files with size + sha256) — the online
 * catalogue users refresh from. Invalid templates are reported and left out.
 */
export async function writePlazaIndex({ templatesDir = '', probe = true } = {}) {
  const root = templatesDir ? resolve(templatesDir) : getBuiltinPlazaDir()
  if (!existsSync(root)) throw userError(`模板目录不存在：${root}`)
  const templates = []
  const problems = []
  for (const name of readdirSync(root).sort()) {
    if (name.startsWith('.')) continue
    const dir = join(root, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    const issues = []
    if (!isValidPlazaTemplateId(name)) issues.push('文件夹名不是合法的模板 ID')
    const present = listTemplateFiles(dir)
    const extra = readdirSync(dir).filter((n) => !present.includes(n) && !n.startsWith('.'))
    for (const n of extra) issues.push(`多余的文件（不会进入在线模板库）：${n}`)
    if (!present.includes('template.json')) {
      problems.push({ id: name, issues: ['缺少 template.json'] })
      continue
    }
    let meta = null
    try {
      meta = parseJsonBuf(readFileSync(join(dir, 'template.json')))
    } catch {
      problems.push({ id: name, issues: ['template.json 不是有效的 JSON'] })
      continue
    }
    if (meta.id && meta.id !== name) issues.push(`template.json 的 id（${meta.id}）与文件夹名不一致`)
    const files = []
    let total = 0
    let fatal = false
    for (const n of present) {
      const buf = readFileSync(join(dir, n))
      const why = checkFileContent(n, buf)
      if (why) {
        issues.push(`${n}：${why}`)
        fatal = true
      }
      total += buf.length
      files.push({ name: n, size: buf.length, sha256: sha256(buf) })
    }
    if (total > PLAZA_LIMITS.templateMaxBytes) {
      issues.push(`模板总大小 ${fmtBytes(total)} 超过 ${fmtBytes(PLAZA_LIMITS.templateMaxBytes)}`)
      fatal = true
    }
    if (probe && present.includes('preview.mp4')) {
      try {
        const info = await probeMedia(join(dir, 'preview.mp4'))
        if (info.durationSec > PLAZA_LIMITS.previewMaxSec + PLAZA_LIMITS.previewToleranceSec) {
          issues.push(`preview.mp4 时长 ${info.durationSec.toFixed(1)} 秒，超过 ${PLAZA_LIMITS.previewMaxSec} 秒`)
          fatal = true
        }
      } catch {
        issues.push('preview.mp4 无法读取')
        fatal = true
      }
    }
    if (fatal || !isValidPlazaTemplateId(name) || (meta.id && meta.id !== name)) {
      problems.push({ id: name, issues })
      continue
    }
    if (issues.length) problems.push({ id: name, issues, included: true })
    const version = String(meta.version || sha256(files.map((f) => `${f.name}:${f.sha256}`).join('|')).slice(0, 12))
    templates.push({
      id: name,
      title: String(meta.name || name),
      category: String(meta.category || meta.genre || ''),
      categoryLabel: categoryLabel(String(meta.category || meta.genre || '')),
      author: String(meta.author || ''),
      version,
      order: Number(meta.order || 99),
      updatedAt: String(meta.updatedAt || ''),
      durationSec: Number(meta.durationSec || 0),
      shotCount: Number(meta.shotCount || 0),
      aspectRatio: String(meta.aspectRatio || ''),
      totalBytes: total,
      files,
    })
  }
  templates.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const file = join(root, 'index.json')
  const prev = readJsonSafe(file, null)
  const sameContent = prev && JSON.stringify(prev.templates) === JSON.stringify(templates)
  const index = {
    schema: PLAZA_INDEX_SCHEMA,
    plaza: PLAZA_BRAND.displayName,
    repo: PLAZA_COMMUNITY.repo,
    generatedAt: sameContent && prev.generatedAt ? prev.generatedAt : nowIso(),
    count: templates.length,
    templates,
  }
  writeFileSync(file, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  return { ok: problems.every((p) => p.included), file, count: templates.length, changed: !sameContent, templates, problems }
}

/* ================================================================================================ online catalogue (user side) */

let syncInFlight = null

function indexUrlList(indexUrls) {
  const fromEnv = String(process.env.DSH_PLAZA_INDEX_URLS || '').trim()
  const list = (Array.isArray(indexUrls) && indexUrls.length ? indexUrls : fromEnv ? fromEnv.split(/[\s,;]+/) : PLAZA_COMMUNITY.indexUrls).map((u) => String(u || '').trim()).filter(Boolean)
  return list.filter((u) => {
    try {
      const url = new URL(u)
      if (url.protocol === 'https:') return true
      // plain http only for this computer (tests / a local mirror)
      return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    } catch {
      return false
    }
  })
}

const hostOf = (u) => {
  try {
    return new URL(u).host
  } catch {
    return String(u).slice(0, 40)
  }
}

function friendlyNetError(err) {
  const m = String(err?.cause?.code || err?.code || err?.message || err || '')
  if (/size|太大|超出/i.test(m)) return String(err?.message || m)
  if (/abort|timeout|超时/i.test(m)) return '连接超时'
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) return '找不到服务器（网络未连接或 DNS 不可用）'
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|fetch failed|network|socket/i.test(m)) return '网络连接失败'
  if (/HTTP \d+/.test(m)) return m.match(/HTTP \d+/)[0]
  return m.slice(0, 120)
}

async function fetchBytes(fetchFn, url, { maxBytes, timeoutMs = 20_000 }) {
  const ac = new AbortController()
  let sizeExceeded = false
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetchFn(url, { signal: ac.signal, redirect: 'follow', headers: { accept: '*/*', 'user-agent': `dsh-video-workbench/${pluginVersion()} (plaza-sync)` } })
    if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : '?'}`)
    const declared = Number(res.headers?.get?.('content-length') || 0)
    if (declared && declared > maxBytes) {
      sizeExceeded = true
      throw new Error(`文件超出大小限制（${fmtBytes(declared)} > ${fmtBytes(maxBytes)}）`)
    }
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader()
      const chunks = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) {
          sizeExceeded = true
          try {
            await reader.cancel()
          } catch {}
          throw new Error(`文件超出大小限制（> ${fmtBytes(maxBytes)}）`)
        }
        chunks.push(Buffer.from(value))
      }
      return Buffer.concat(chunks, total)
    }
    const ab = await res.arrayBuffer()
    if (ab.byteLength > maxBytes) {
      sizeExceeded = true
      throw new Error(`文件超出大小限制（> ${fmtBytes(maxBytes)}）`)
    }
    return Buffer.from(ab)
  } catch (err) {
    if (sizeExceeded) throw err
    if (ac.signal.aborted) throw new Error('连接超时')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function parseIndex(buf) {
  let j
  try {
    j = parseJsonBuf(buf)
  } catch {
    throw new Error('在线模板目录不是有效的 JSON')
  }
  if (!j || j.schema !== PLAZA_INDEX_SCHEMA || !Array.isArray(j.templates)) throw new Error('在线模板目录格式不对')
  if (j.templates.length > PLAZA_LIMITS.indexMaxTemplates) throw new Error('在线模板目录条目过多')
  return j
}

function validateIndexEntry(e) {
  if (!e || typeof e !== 'object') return '条目格式不对'
  if (!isValidPlazaTemplateId(String(e.id || ''))) return '模板 ID 无效'
  if (!Array.isArray(e.files) || !e.files.length) return '没有文件清单'
  const names = new Set()
  let total = 0
  for (const f of e.files) {
    const name = String(f?.name || '')
    if (!TEMPLATE_FILES.includes(name)) return `不允许的文件：${name.slice(0, 40)}（只允许 json / md / mp4 / jpg / png 模板文件）`
    if (names.has(name)) return `文件重复：${name}`
    names.add(name)
    const size = Number(f.size)
    if (!Number.isInteger(size) || size <= 0) return `${name} 的大小无效`
    if (size > PLAZA_FILE_RULES[name].max) return `${name} 超出大小限制（${fmtBytes(size)} > ${fmtBytes(PLAZA_FILE_RULES[name].max)}）`
    if (!SHA256_RE.test(String(f.sha256 || ''))) return `${name} 缺少 SHA-256 校验值`
    total += size
  }
  if (!names.has('template.json')) return '缺少 template.json'
  if (total > PLAZA_LIMITS.templateMaxBytes) return `模板总大小超出限制（${fmtBytes(total)}）`
  return ''
}

function fileMatches(file, f) {
  try {
    const st = lstatSync(file)
    return st.isFile() && !st.isSymbolicLink() && st.size === Number(f.size) && sha256File(file) === f.sha256
  } catch {
    return false
  }
}

function sameAsLocal(dir, entry) {
  if (!existsSync(dir)) return false
  const present = listTemplateFiles(dir)
  if (present.length !== entry.files.length) return false
  return entry.files.every((f) => present.includes(f.name) && fileMatches(join(dir, f.name), f))
}

function cleanupStaging(root) {
  try {
    for (const n of readdirSync(root)) {
      if (!/^\.(staging|old)-/.test(n)) continue
      const p = join(root, n)
      try {
        if (Date.now() - statSync(p).mtimeMs > 10 * 60 * 1000) removeTreeNoFollow(p)
      } catch {}
    }
  } catch {}
}

function localOnlineIds(root) {
  try {
    return readdirSync(root).filter((n) => isValidPlazaTemplateId(n) && existsSync(join(root, n, 'template.json')))
  } catch {
    return []
  }
}

async function downloadTemplate({ entry, root, bases, fetchFn, timeoutMs }) {
  const id = entry.id
  const localDir = join(root, id)
  const staging = join(root, `.staging-${id}-${rand()}`)
  mkdirSync(staging, { recursive: true })
  try {
    for (const f of entry.files) {
      const dest = join(staging, f.name)
      const localFile = join(localDir, f.name)
      if (fileMatches(localFile, f)) {
        copyFileSync(localFile, dest)
        continue
      }
      let buf = null
      let lastErr = null
      for (const base of bases) {
        const url = `${base}/${encodeURIComponent(id)}/${encodeURIComponent(f.name)}`
        try {
          const data = await fetchBytes(fetchFn, url, { maxBytes: Number(f.size), timeoutMs: Math.max(timeoutMs, 60_000) })
          if (data.length !== Number(f.size)) throw new Error(`${f.name} 大小不符`)
          if (sha256(data) !== f.sha256) throw new Error(`${f.name} 校验失败（SHA-256 不一致）`)
          const why = checkFileContent(f.name, data)
          if (why) throw new Error(`${f.name}：${why}`)
          if (f.name === 'template.json') {
            const meta = parseJsonBuf(data)
            if (meta.id && meta.id !== id) throw new Error('template.json 的 id 与目录不符')
          }
          buf = data
          break
        } catch (err) {
          lastErr = err
        }
      }
      if (!buf) throw new Error(friendlyNetError(lastErr))
      writeFileSync(dest, buf)
    }
    writeJsonAtomic(join(staging, '.plaza-online.json'), { id, title: String(entry.title || ''), version: String(entry.version || ''), files: entry.files, syncedAt: nowIso() })
    let old = ''
    if (existsSync(localDir)) {
      old = join(root, `.old-${id}-${rand()}`)
      try {
        renameSync(localDir, old)
      } catch {
        throw new Error('旧版本文件正被占用（可能正在播放它的样片），请关闭样片后重试')
      }
    }
    try {
      renameSync(staging, localDir)
    } catch (err) {
      if (old) {
        try {
          renameSync(old, localDir)
        } catch {}
      }
      throw err
    }
    if (old) removeTreeNoFollow(old)
  } catch (err) {
    removeTreeNoFollow(staging)
    throw err
  }
}

function catalogFile() {
  return join(getOnlinePlazaDir(), 'catalog.json')
}

/** Last sync state of the online catalogue (for the plaza panel). */
export function getOnlinePlazaStatus() {
  const root = getOnlinePlazaDir()
  const cat = readJsonSafe(catalogFile(), {}) || {}
  return {
    count: localOnlineIds(root).length,
    lastSyncAt: String(cat.lastSyncAt || ''),
    lastAttemptAt: String(cat.lastAttemptAt || ''),
    source: String(cat.source || ''),
    lastError: String(cat.lastError || ''),
  }
}

/**
 * 「刷新在线模板」: download new / changed templates of the maintainer's online catalogue (only on the user's click).
 * @param {{ indexUrls?: string[], fetchImpl?: typeof fetch, onProgress?: Function, timeoutMs?: number }} opts
 */
export function syncOnlinePlazaTemplates(opts = {}) {
  if (syncInFlight) return syncInFlight
  syncInFlight = doSync(opts).finally(() => {
    syncInFlight = null
  })
  return syncInFlight
}

async function doSync({ indexUrls, fetchImpl, onProgress = () => {}, timeoutMs = 20_000 } = {}) {
  const progress = (pct, message) => {
    try {
      onProgress({ stage: 'sync', progress: pct, message })
    } catch {}
  }
  const fetchFn = fetchImpl || globalThis.fetch
  const root = getOnlinePlazaDir()
  mkdirSync(root, { recursive: true })
  cleanupStaging(root)
  const prevCat = readJsonSafe(catalogFile(), {}) || {}
  const before = localOnlineIds(root)
  const urls = indexUrlList(indexUrls)
  if (typeof fetchFn !== 'function') {
    return { ok: false, offline: true, message: '当前环境无法联网下载在线模板（需要 Node.js 18 或更高版本）。', kept: before.length, results: [] }
  }
  if (!urls.length) {
    return { ok: false, offline: true, message: '没有可用的在线模板库地址（只允许 https 地址，或本机 http 镜像）。', kept: before.length, results: [] }
  }
  progress(5, '正在连接影核广场在线模板库…')
  let index = null
  let indexUrl = ''
  const attempts = []
  for (const u of urls) {
    try {
      index = parseIndex(await fetchBytes(fetchFn, u, { maxBytes: PLAZA_LIMITS.indexMaxBytes, timeoutMs }))
      indexUrl = u
      break
    } catch (err) {
      attempts.push({ host: hostOf(u), error: friendlyNetError(err) })
    }
  }
  if (!index) {
    const hosts = [...new Set(attempts.map((a) => a.host))].join('、')
    // every mirror answered "404": the maintainer has not published an online catalogue yet — not a network problem
    const notPublished = attempts.length > 0 && attempts.every((a) => a.error === 'HTTP 404')
    const message = notPublished
      ? `影核广场在线模板库还没有发布在线目录（作者尚未上传 index.json），现在看到的内置模板就是全部模板。${before.length ? `已保留之前下载的 ${before.length} 个在线模板。` : ''}`
      : `暂时连不上影核广场在线模板库（已尝试 ${hosts}）。可能是网络未连接，或被代理 / 防火墙拦截。${before.length ? `已保留上次同步的 ${before.length} 个在线模板；` : ''}稍后再点「刷新在线模板」重试即可。`
    writeJsonAtomic(catalogFile(), { ...prevCat, lastAttemptAt: nowIso(), lastError: message })
    return { ok: false, offline: !notPublished, notPublished, message, attempts, kept: before.length, results: [] }
  }
  const base = indexUrl.replace(/\/index\.json(?:[?#].*)?$/i, '')
  const bases = [base, ...urls.map((u) => u.replace(/\/index\.json(?:[?#].*)?$/i, '')).filter((b) => b !== base)]
  const builtinRoot = getBuiltinPlazaDir()
  const results = []
  const listed = new Set()
  const entries = index.templates
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const id = isValidPlazaTemplateId(String(entry?.id || '')) ? String(entry.id) : ''
    const title = oneLine(entry?.title || id, 80)
    if (id) listed.add(id)
    const invalid = validateIndexEntry(entry)
    if (invalid) {
      results.push({ id: id || String(entry?.id || '').slice(0, 40), title, status: 'rejected', reason: invalid, keptPrevious: id ? existsSync(join(root, id)) : false })
      continue
    }
    progress(10 + Math.round((80 * i) / Math.max(1, entries.length)), `正在检查「${title}」（${i + 1}/${entries.length}）…`)
    // identical to the copy shipped with this plugin: nothing to download (and no stale online duplicate)
    if (sameAsLocal(join(builtinRoot, id), entry)) {
      if (existsSync(join(root, id))) removeTreeNoFollow(join(root, id))
      results.push({ id, title, status: 'builtin' })
      continue
    }
    const had = existsSync(join(root, id, 'template.json'))
    if (had && sameAsLocal(join(root, id), entry)) {
      results.push({ id, title, status: 'unchanged' })
      continue
    }
    try {
      progress(10 + Math.round((80 * (i + 0.5)) / Math.max(1, entries.length)), `正在下载「${title}」…`)
      await downloadTemplate({ entry, root, bases, fetchFn, timeoutMs })
      results.push({ id, title, status: had ? 'updated' : 'added' })
    } catch (err) {
      results.push({ id, title, status: 'failed', reason: String(err?.message || err).slice(0, 200), keptPrevious: had })
    }
  }
  // withdrawn by the maintainer → removed here as well
  for (const id of before) {
    if (!listed.has(id)) {
      removeTreeNoFollow(join(root, id))
      results.push({ id, title: id, status: 'removed' })
    }
  }
  const count = (s) => results.filter((r) => r.status === s).length
  const summary = { added: count('added'), updated: count('updated'), unchanged: count('unchanged'), builtin: count('builtin'), failed: count('failed'), rejected: count('rejected'), removed: count('removed') }
  const online = localOnlineIds(root).length
  const bits = []
  if (summary.added) bits.push(`新增 ${summary.added} 个`)
  if (summary.updated) bits.push(`更新 ${summary.updated} 个`)
  if (summary.removed) bits.push(`下架 ${summary.removed} 个`)
  if (summary.failed + summary.rejected) bits.push(`${summary.failed + summary.rejected} 个下载失败（已保留旧版本）`)
  const message = bits.length ? `在线模板已刷新：${bits.join('，')}。现在共有 ${online} 个在线模板。` : `在线模板已是最新（${online} 个在线模板${summary.builtin ? `，另有 ${summary.builtin} 个已随插件内置` : ''}）。`
  writeJsonAtomic(catalogFile(), {
    lastSyncAt: nowIso(),
    lastAttemptAt: nowIso(),
    source: hostOf(indexUrl),
    indexGeneratedAt: String(index.generatedAt || ''),
    lastError: summary.failed + summary.rejected ? message : '',
    summary,
    results: results.slice(0, 300),
  })
  progress(100, message)
  return { ok: true, source: hostOf(indexUrl), message, ...summary, onlineCount: online, results }
}
