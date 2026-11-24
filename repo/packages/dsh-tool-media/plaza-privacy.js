/**
 * @dsh-video/tool-media — 影核广场 · 隐私闸门 (privacy gate for everything that leaves this computer through the plaza)
 * Copyright (c) 2026 Merziller (QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com)
 *
 * Used by 投稿包 (user submissions), `plaza add` (the author's own publications) and `plaza review` (the author's check of
 * a received package). Two layers:
 *   1. sanitize — deep-walks a JSON value / text and cleans what can be cleaned automatically:
 *      machine-specific keys (rendered audio, logs, hardware policy, absolute media paths …) and secret-named keys are
 *      dropped; absolute paths become project-relative paths or bare file names; API keys / tokens (pattern-based and the
 *      literal values configured on this computer) and e-mail addresses (except the contact the user typed and the
 *      plugin author's public address) are replaced with placeholders. Every cleanup is counted so the UI can show it.
 *   2. scan — a read-only check of the final files. Anything still found (absolute paths, drive letters, user folders,
 *      keys, foreign e-mails, the computer's user name) blocks the package with a clear, field-level message.
 * The OS user name / computer name in free text cannot be judged automatically (it may be a brand or a character's
 * name), so it is reported as an issue the user must confirm (`allowNames`) instead of being silently rewritten.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir, hostname, userInfo } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { loadEnv, REPO_ROOT, resolveEnvPath } from '../shared/index.js'

/** Placeholders written in place of removed values (Chinese, so a reviewer immediately sees why text changed). */
export const PRIVACY_PLACEHOLDER = Object.freeze({
  path: '[本地路径已移除]',
  email: '[邮箱已隐藏]',
  secret: '[密钥已隐藏]',
})

export const PRIVACY_KIND_LABEL = Object.freeze({
  path: '本机路径',
  email: '邮箱地址',
  secret: 'API 密钥 / 令牌',
  name: '电脑用户名 / 计算机名',
  dropped: '本机专用字段（配音文件、日志、硬件信息等）',
  userFolder: '用户文件夹路径',
})

// Account / machine names that are too generic to identify anyone (default OEM accounts are often brand names).
const GENERIC_NAMES = new Set(
  [
    'user', 'users', 'admin', 'administrator', 'owner', 'pc', 'default', 'guest', 'public', 'root', 'me', 'test', 'dev',
    'home', 'desktop', 'laptop', 'windows', 'local', 'system', 'localhost', 'computer', 'mac', 'macbook', 'imac', 'ubuntu',
    'lenovo', 'dell', 'hp', 'asus', 'acer', 'msi', 'huawei', 'xiaomi', 'honor', 'apple', 'thinkpad', 'surface',
    'microsoft', 'samsung', 'redmi', 'legion', 'think', 'win', 'win10', 'win11', 'runner', 'docker', 'node', 'video',
  ].map((s) => s.toLowerCase()),
)

// Keys whose values are secrets: removed wherever they appear.
const SECRET_KEY_RE =
  /^(?:api[-_ ]?key|apikey|secret|secret[-_]?key|client[-_]?secret|access[-_]?token|refresh[-_]?token|auth[-_]?token|id[-_]?token|token|bearer|password|passwd|pwd|authorization|cookie|cookies|session[-_]?id|private[-_]?key|access[-_]?key(?:[-_]?id)?|signature)$/i

// Machine-specific keys: rendered audio files, logs, hardware state, absolute media paths, reference video files, voice
// clones … none of these belong in a shared template (the files themselves are never shipped).
const DROP_KEYS = new Set([
  'audioFile', 'masteredAudioFile', 'voiceMasteringReport', 'hardwarePolicy', 'mediaDims', 'avatarClip', 'avatarClipPath',
  'voiceSamplePath', 'voiceSample', 'refAudio', 'refAudioPath', 'promptAudio', 'promptAudioPath', 'referenceAudio',
  'sourcePath', 'sourceRel', 'sourceRelPath', 'sheetRelPath', 'frameRelPaths', 'framePaths', 'localPath', 'absPath',
  'absolutePath', 'filePath', 'fullPath', 'batchErrors', 'buildLog', 'qaReport', 'logs', 'log', 'stack', 'stderr', 'stdout',
  'lastError', 'errors', 'error', 'renderLog', 'cloneVoiceId', 'voiceCloneId', 'defaultVoiceId', 'voiceId', 'speakerId',
  'workspaceRoot', 'projectDir', 'projectPath', 'outputPath', 'outputDir', 'mp4Path', 'cachePath', 'tempDir', 'tmpDir',
])

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-(?:ant-|proj-|live-|test-|or-v1-)?[A-Za-z0-9_-]{16,}/g,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bhf_[A-Za-z0-9]{30,}\b/g,
  /\br8_[A-Za-z0-9]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\b(?:api[-_ ]?key|apikey|secret[-_ ]?key|secret|access[-_ ]?token|auth[-_ ]?token|token|password|passwd|access[-_ ]?key)\b\s*[:=：]\s*["'`]?[A-Za-z0-9._~+/-]{8,}/gi,
]

// bounded quantifiers: an unbounded local part is retried at every start position (quadratic on long base64 strings)
const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g

// Absolute paths. Directory segments may contain spaces (they end with a separator); the last segment stops at white
// space or punctuation, so "C:\Users\<名字 含空格>\Videos\a.mp4 是…" is matched completely.
const SEG = String.raw`[^\\/\r\n"'<>|*?\u0000]+`
const LAST = String.raw`[^\\/\s"'<>|*?，。；：、！？）)】\]\u0000]*`
const PATH_PATTERNS = [
  // C:\… or C:/…
  new RegExp(String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/](?:${SEG}[\\/])*${LAST}`, 'g'),
  // \\server\share\…
  new RegExp(String.raw`(?<![\\\w])\\\\${SEG}[\\/](?:${SEG}[\\/])*${LAST}`, 'g'),
  // file:///…
  new RegExp(String.raw`file:\/\/[^\s"'<>]*`, 'gi'),
  // %USERPROFILE%\… , %APPDATA%/…
  new RegExp(String.raw`%[A-Za-z_]+%[\\/](?:${SEG}[\\/])*${LAST}`, 'g'),
  // ~/… (home-relative)
  new RegExp(String.raw`(?<![\w/~])~[\\/](?:${SEG}[\\/])*${LAST}`, 'g'),
  // /Users/… /home/… and other POSIX system roots (never inside URLs: a word char, '.', '/', ':' must not precede)
  new RegExp(
    String.raw`(?<![\w./:~-])\/(?:Users|home|root|var|tmp|private|Volumes|mnt|opt|etc|usr|srv|media|run|snap|data|storage|sdcard|Library|Applications|System)\/(?:[^\/\r\n"'<>|*?\u0000]+\/)*[^\/\s"'<>|*?，。；：、！？）)】\]\u0000]*`,
    'g',
  ),
]

// User folders inside binary files (cover / preview): checked in UTF-8 and UTF-16LE.
const USER_FOLDER_RE = /(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]|\/Users\/|\/home\/)[^\\/\s"'<>|*?\u0000]{2,}/

function safeCall(fn, fallback = '') {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function normSlashes(p) {
  return String(p || '').replace(/\\/g, '/')
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isNameish(s) {
  const v = String(s || '').trim()
  if (v.length < 3 || v.length > 64) return false
  if (GENERIC_NAMES.has(v.toLowerCase())) return false
  if (/^\d{1,3}$/.test(v)) return false
  return true
}

/** "zhangsan" → "z*******" (never echo a found name / secret in full) */
export function maskValue(value, keep = 1) {
  const s = String(value || '')
  if (!s) return ''
  const arr = Array.from(s)
  if (arr.length <= keep) return '*'.repeat(arr.length)
  return arr.slice(0, keep).join('') + '*'.repeat(Math.min(10, arr.length - keep))
}

function collectConfiguredSecrets() {
  const out = new Set()
  const consider = (key, val) => {
    if (typeof val !== 'string') return
    const v = val.trim()
    if (!/(?:key|token|secret|password|passwd|credential|cookie|auth)/i.test(String(key || ''))) return
    if (v.length < 8 || v.length > 400) return
    if (/^(?:true|false|null|undefined|none|auto|on|off)$/i.test(v)) return
    if (/^[A-Za-z]:[\\/]|^\/|^https?:\/\//i.test(v)) return // paths and URLs are handled by the path rules
    if (v.length < 12 && !(/[A-Za-z]/.test(v) && /\d/.test(v))) return
    if (new Set(v).size < 5) return
    out.add(v)
  }
  try {
    loadEnv()
    for (const [k, v] of Object.entries(process.env)) consider(k, v)
  } catch {}
  const walk = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 6) return
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') consider(k, v)
      else if (v && typeof v === 'object') walk(v, depth + 1)
    }
  }
  const home = safeCall(() => resolveEnvPath('DSH_VIDEO_HOME', './.dsh-home'), '')
  const files = [
    home ? join(home, 'llm-config.json') : '',
    home ? join(home, 'avatar-config.json') : '',
    join(REPO_ROOT, '.dsh-video-cloud-media.json'),
    join(REPO_ROOT, '.dsh-video-tts-config.json'),
    join(REPO_ROOT, '.dsh-video-avatar-config.json'),
  ].filter(Boolean)
  for (const f of files) {
    try {
      if (existsSync(f)) walk(JSON.parse(readFileSync(f, 'utf8')))
    } catch {}
  }
  return [...out].sort((a, b) => b.length - a.length)
}

/**
 * Privacy context for one package.
 * @param {{ projectDir?: string, author?: string, contact?: string, allowNames?: boolean, allowEmails?: string[],
 *           extraNames?: string[], secrets?: string[], includeConfiguredSecrets?: boolean, checkLocalNames?: boolean }} opts
 */
export function createPrivacyContext(opts = {}) {
  const {
    projectDir = '',
    author = '',
    contact = '',
    allowNames = false,
    allowEmails = [],
    extraNames = [],
    secrets = [],
    includeConfiguredSecrets = true,
    checkLocalNames = true,
  } = opts
  const home = safeCall(() => homedir(), '')
  const names = new Set()
  const addName = (n) => {
    const v = String(n || '').trim()
    if (isNameish(v)) names.add(v)
  }
  if (checkLocalNames) {
    addName(safeCall(() => userInfo().username, ''))
    addName(home ? basename(home) : '')
    addName(process.env.USERNAME)
    addName(process.env.USER)
    addName(safeCall(() => hostname(), ''))
    // words the user wants treated like his user name (real name, company code names …): DSH_PLAZA_PRIVATE_WORDS=a,b
    for (const w of String(process.env.DSH_PLAZA_PRIVATE_WORDS || '').split(/[,，;；\n]+/)) addName(w)
  }
  for (const n of extraNames || []) addName(n)
  // the nickname / contact the user typed are theirs to share
  const typed = [author, contact].map((s) => String(s || '').trim().toLowerCase()).filter(Boolean)
  for (const n of [...names]) {
    const low = n.toLowerCase()
    if (typed.some((t) => t === low || t.includes(low))) names.delete(n)
  }
  const emails = new Set((allowEmails || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))
  for (const m of String(contact || '').match(EMAIL_RE) || []) emails.add(m.toLowerCase())
  const secretList = new Set((secrets || []).map((s) => String(s || '').trim()).filter((s) => s.length >= 8))
  if (includeConfiguredSecrets) for (const s of collectConfiguredSecrets()) secretList.add(s)
  return {
    projectDir: projectDir ? normSlashes(resolve(projectDir)).replace(/\/+$/, '') : '',
    home: home ? normSlashes(home).replace(/\/+$/, '') : '',
    names: [...names],
    allowNames: Boolean(allowNames),
    allowedEmails: emails,
    secrets: [...secretList].sort((a, b) => b.length - a.length),
  }
}

/** A fresh cleanup report (counts per kind, a few example locations, name issues). */
export function createPrivacyReport() {
  return { counts: { path: 0, email: 0, secret: 0, dropped: 0 }, examples: { path: [], email: [], secret: [], dropped: [] }, names: [] }
}

function note(report, kind, where) {
  if (!report) return
  report.counts[kind] = (report.counts[kind] || 0) + 1
  const ex = (report.examples[kind] = report.examples[kind] || [])
  if (where && ex.length < 6 && !ex.includes(where)) ex.push(where)
}

function replacePathMatch(match, ctx) {
  const raw = String(match)
  const trail = (/[.,;:!?)\]}]+$/.exec(raw) || [''])[0]
  const p = normSlashes(raw.slice(0, raw.length - trail.length).replace(/^file:\/\/\/?/i, ''))
  if (ctx.projectDir) {
    const low = p.toLowerCase()
    const root = ctx.projectDir.toLowerCase()
    if (low === root) return `.${trail}`
    if (low.startsWith(`${root}/`)) return p.slice(ctx.projectDir.length + 1) + trail
  }
  const last = p.split('/').filter(Boolean).pop() || ''
  // keep a bare file name (the file itself is never shared); folders and drive roots become a placeholder
  if (last && /\.[A-Za-z0-9]{1,8}$/.test(last) && !/^[A-Za-z]:$/.test(last) && last.length <= 120) return last + trail
  return PRIVACY_PLACEHOLDER.path + trail
}

/**
 * Clean one string (also used for object keys). Returns the cleaned text; counts what it changed and records name
 * issues (names are never rewritten).
 */
export function cleanTextForShare(text, ctx, report, where = '') {
  let s = String(text ?? '')
  if (!s) return s
  for (const secret of ctx.secrets || []) {
    if (s.includes(secret)) {
      s = s.split(secret).join(PRIVACY_PLACEHOLDER.secret)
      note(report, 'secret', where)
    }
  }
  for (const re of SECRET_PATTERNS) {
    re.lastIndex = 0
    if (re.test(s)) {
      re.lastIndex = 0
      s = s.replace(re, () => {
        note(report, 'secret', where)
        return PRIVACY_PLACEHOLDER.secret
      })
    }
  }
  for (const re of PATH_PATTERNS) {
    re.lastIndex = 0
    s = s.replace(re, (m) => {
      if (m.length < 3) return m
      note(report, 'path', where)
      return replacePathMatch(m, ctx)
    })
  }
  EMAIL_RE.lastIndex = 0
  if (s.includes('@')) s = s.replace(EMAIL_RE, (m) => {
    if (ctx.allowedEmails && ctx.allowedEmails.has(m.toLowerCase())) return m
    note(report, 'email', where)
    return PRIVACY_PLACEHOLDER.email
  })
  if (!ctx.allowNames && report) {
    for (const n of findNames(s, ctx)) {
      if (report.names.length < 40) report.names.push({ where, name: maskValue(n) })
    }
  }
  return s
}

function findNames(text, ctx) {
  const hits = []
  for (const n of ctx.names || []) {
    const ascii = /^[\x20-\x7e]+$/.test(n)
    const re = ascii ? new RegExp(`(?<![A-Za-z0-9])${escapeRe(n)}(?![A-Za-z0-9])`, 'i') : new RegExp(escapeRe(n))
    if (re.test(text)) hits.push(n)
  }
  return hits
}

/** A value stored under a secret-named key that could be a secret: a non-empty string (numbers / flags are not). */
const secretValue = (v) => typeof v === 'string' && v.trim() !== ''

function dropReason(key, value) {
  if (SECRET_KEY_RE.test(key) && (secretValue(value) || (value && typeof value === 'object'))) return 'secret'
  if (DROP_KEYS.has(key)) return 'dropped'
  return ''
}

/**
 * Deep-clean a JSON value for sharing. Secret-named keys and machine-specific keys are removed, every string and key is
 * cleaned with `cleanTextForShare`. Returns a new value (the input is not modified).
 */
export function sanitizeValueForShare(value, ctx, report, path = '') {
  if (typeof value === 'string') return cleanTextForShare(value, ctx, report, path)
  if (Array.isArray(value)) return value.map((v, i) => sanitizeValueForShare(v, ctx, report, `${path}[${i}]`))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      const where = path ? `${path}.${k}` : k
      const reason = dropReason(k, v)
      if (reason) {
        // an empty field leaks nothing — drop it silently
        if (!(v === '' || v === null || v === undefined || v === false)) note(report, reason, where)
        continue
      }
      const ck = cleanTextForShare(k, ctx, report, `${where} (字段名)`)
      out[ck] = sanitizeValueForShare(v, ctx, report, where)
    }
    return out
  }
  return value
}

/**
 * Read-only check of one text (Markdown) or JSON value. Returns findings `{ kind, where, sample }`; empty = clean.
 * `sample` never contains the secret / name itself.
 */
export function scanForPrivacy(input, ctx, label = '') {
  const findings = []
  const push = (kind, where, sample = '') => {
    if (findings.length < 80) findings.push({ kind, where, sample })
  }
  const checkString = (s, where) => {
    if (typeof s !== 'string' || !s) return
    for (const secret of ctx.secrets || []) if (s.includes(secret)) push('secret', where, maskValue(secret, 3))
    for (const re of SECRET_PATTERNS) {
      re.lastIndex = 0
      const m = re.exec(s)
      if (m) push('secret', where, maskValue(m[0], 3))
    }
    for (const re of PATH_PATTERNS) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(s))) {
        if (m[0].length >= 3) {
          push('path', where, maskValue(m[0], 3))
          break
        }
      }
    }
    EMAIL_RE.lastIndex = 0
    let em
    while (s.includes('@') && (em = EMAIL_RE.exec(s))) {
      if (!(ctx.allowedEmails && ctx.allowedEmails.has(em[0].toLowerCase()))) {
        push('email', where, maskValue(em[0], 2))
        break
      }
    }
    if (!ctx.allowNames) for (const n of findNames(s, ctx)) push('name', where, maskValue(n))
  }
  const walk = (v, where) => {
    if (typeof v === 'string') return checkString(v, where)
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${where}[${i}]`))
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        const w = where ? `${where}.${k}` : k
        if (SECRET_KEY_RE.test(k) && secretValue(x)) push('secret', w, '(字段)')
        checkString(k, `${w} (字段名)`)
        walk(x, w)
      }
    }
  }
  if (typeof input === 'string') {
    // Markdown / plain text: report per line so the message points at something findable
    const lines = input.split(/\r?\n/)
    lines.forEach((line, i) => checkString(line, `${label || '文本'} 第 ${i + 1} 行`))
  } else {
    walk(input, label)
  }
  return findings
}

/** Binary check (cover / preview): no user-folder path and no known user / computer name inside a path. */
export function scanBinaryForPrivacy(buf, ctx, label = '') {
  const findings = []
  if (!buf || !buf.length) return findings
  const views = [buf.toString('latin1')]
  // UTF-16LE strings (Windows metadata): keep the low byte of every 16-bit unit whose high byte is 0 (both alignments)
  try {
    for (const start of [0, 1]) {
      const half = Buffer.alloc(Math.max(0, Math.floor((buf.length - start) / 2)))
      for (let i = start, j = 0; i + 1 < buf.length; i += 2, j++) half[j] = buf[i + 1] === 0 ? buf[i] : 1
      views.push(half.toString('latin1'))
    }
  } catch {}
  for (const v of views) {
    const m = USER_FOLDER_RE.exec(v)
    if (m) {
      findings.push({ kind: 'userFolder', where: label, sample: maskValue(m[0], 4) })
      break
    }
  }
  if (ctx && ctx.home) {
    const homeVariants = [ctx.home, ctx.home.replace(/\//g, '\\')]
    if (homeVariants.some((h) => h.length >= 6 && views.some((v) => v.toLowerCase().includes(h.toLowerCase())))) {
      findings.push({ kind: 'userFolder', where: label, sample: '(用户目录)' })
    }
  }
  return findings
}

/** Human readable (Chinese) one-line summary of a cleanup report, for UI / CLI. */
export function describePrivacyReport(report) {
  if (!report) return ''
  const parts = []
  const c = report.counts || {}
  if (c.path) parts.push(`${c.path} 处本机路径`)
  if (c.email) parts.push(`${c.email} 处邮箱地址`)
  if (c.secret) parts.push(`${c.secret} 处密钥 / 令牌`)
  if (c.dropped) parts.push(`${c.dropped} 个本机专用字段`)
  return parts.length ? `已自动清理：${parts.join('、')}` : '没有发现需要清理的隐私信息'
}

/** A privacy error with structured findings (`err.findings`, `err.code = 'privacy'`). */
export function privacyError(findings, intro = '隐私检查未通过') {
  const lines = findings.slice(0, 8).map((f) => `· ${PRIVACY_KIND_LABEL[f.kind] || f.kind}：${f.where}${f.sample ? `（${f.sample}）` : ''}`)
  const more = findings.length > 8 ? `\n· …… 另有 ${findings.length - 8} 处` : ''
  const err = new Error(`${intro}：\n${lines.join('\n')}${more}`)
  err.code = 'privacy'
  err.findings = findings
  err.status = 422
  err.expose = true
  return err
}
