/**
 * @dsh-video/tool-media — Project Version History (content-addressed)
 *
 * Snapshots `script.json`, `assets.json`, `characters.json`, `index.html`,
 * `output/ai_build_log.json` and `src/**` (except regenerated `src/lib/**`) into
 * `<project>/history/objects/<aa>/<sha256>.gz` (identical content stored once) and records every
 * version in `<project>/history/versions.json` (id, time, label, stage, author ai|user, file map).
 * Large media (assets/**, audio/**) is only referenced by path + size + mtime.
 *
 * Provides list / diff summary (changed scenes + fields, changed files) / restore (which first
 * takes a "before restore" snapshot) / undo-style rollback, a retention cap (`DSH_HISTORY_MAX`,
 * default 50) and garbage collection of unreferenced objects. This store replaces the legacy
 * `history/v-<stamp>-<label>/` directory copies (they are migrated automatically on first use).
 *
 * Safety rules (the store lives inside project folders that may come from elsewhere, so its metadata is not trusted):
 *  - a restore never destroys a file it cannot bring back: a tracked file the "before restore" snapshot could not
 *    store (larger than 8 MB, unreadable) is MOVED to `history/trash/<stamp>/<path>` before the restore overwrites or
 *    deletes it (reported as `trashedFiles`); a file the target version itself recorded as too large to store is kept;
 *  - a restore only writes tracked paths (the root files above or `src/**` outside `src/lib/`) that resolve inside the
 *    project; a version with any other path or a malformed object hash is refused before anything is touched, and a
 *    path that runs through a symlink / junction is skipped;
 *  - snapshots never follow a symlinked tracked file or a symlinked / junctioned `src/`, and prune / GC lstat every
 *    shard and object and only ever delete `<aa>/<sha256>.gz` files (and their `.tmp` leftovers) of this store.
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { loadEnv } from '../shared/index.js'
import { readJsonSafe, removeTreeNoFollow, toPosixRel, withFileLockSync, writeJsonAtomic } from './safe-json-store.js'

const TRACKED_ROOT_FILES = ['script.json', 'assets.json', 'characters.json', 'index.html', 'output/ai_build_log.json', 'output/locked-html-scenes.json']
const TRACKED_TREES = ['src']
const EXCLUDED_PREFIXES = ['src/lib/']
// Manifests / banks are never deleted by a restore (older versions may predate them)
const NEVER_DELETE_ON_RESTORE = new Set(['characters.json', 'assets.json', 'script.json'])
const MEDIA_TREES = ['assets', 'audio']
const MAX_TRACKED_FILE_BYTES = 8 * 1024 * 1024
const MAX_MEDIA_REFS = 3000
const SEMANTIC_JSON_FILES = new Set(['script.json', 'assets.json', 'characters.json'])
const SCENE_IGNORED_KEYS = new Set(['ttsText', 'ttsNarrationRef', 'index', 'startFrame', 'startSec', 'updatedAt'])
const SCRIPT_IGNORED_KEYS = new Set(['scenes', 'subtitles', 'updatedAt', 'lastEditMerge'])

const hashCache = new Map() // abs -> { size, mtimeMs, ctimeMs, hash, semHash }

const HASH_RE = /^[0-9a-f]{64}$/
const SHARD_RE = /^[0-9a-f]{2}$/
const OBJECT_NAME_RE = /^([0-9a-f]{64})\.gz$/
const OBJECT_TMP_RE = /^[0-9a-f]{64}\.gz\.\d+\.[a-z0-9]+\.tmp$/

/** An error the REST layer may show to the client as-is: HTTP `status` + stable `code` (`expose` marks it safe). */
function historyError(message, status, code) {
  const err = new Error(message)
  err.status = status
  err.code = code
  err.expose = true
  return err
}

/** lstat-based: a real directory, never a symlink / junction. */
function isRealDir(p) {
  try {
    const st = lstatSync(p)
    return st.isDirectory() && !st.isSymbolicLink()
  } catch {
    return false
  }
}

/** True when `target`, or any existing path component between `root` and it, is a symlink / junction. */
function pathHasLink(root, target) {
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return true
  let cur = root
  for (const part of rel.split(/[\\/]+/)) {
    cur = join(cur, part)
    let st
    try {
      st = lstatSync(cur)
    } catch {
      return false
    }
    if (st.isSymbolicLink()) return true
  }
  return false
}

/**
 * A relative path a restore may write: one of TRACKED_ROOT_FILES or a file under a tracked tree (not under an excluded
 * prefix), in the POSIX form collectTrackedFiles records — no absolute / drive / UNC paths, no `..`, no dot or
 * node_modules segments, no backslash, colon or NUL.
 */
function isRestorableRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 512 || /[\0\\:]/.test(rel) || rel.startsWith('/')) return false
  const parts = rel.split('/')
  if (parts.some((p) => !p || p.startsWith('.') || p === 'node_modules')) return false
  if (TRACKED_ROOT_FILES.includes(rel)) return true
  return TRACKED_TREES.some((t) => rel.startsWith(`${t}/`)) && !EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))
}

export function resolveHistoryMax(override) {
  if (override !== undefined && override !== null && Number.isFinite(Number(override)) && Number(override) > 0) {
    return Math.max(2, Math.floor(Number(override)))
  }
  loadEnv()
  const n = Number(String(process.env.DSH_HISTORY_MAX ?? '').trim())
  return Number.isFinite(n) && n > 0 ? Math.max(2, Math.floor(n)) : 50
}

function historyPaths(projectDir) {
  const absDir = resolve(projectDir)
  const root = join(absDir, 'history')
  return {
    absDir,
    root,
    objects: join(root, 'objects'),
    versionsFile: join(root, 'versions.json'),
    lockFile: join(root, '.versions.lock'),
  }
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value)
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

function deepEqual(a, b) {
  return stableStringify(a) === stableStringify(b)
}

function semanticHash(rel, buf, rawHash) {
  if (!SEMANTIC_JSON_FILES.has(rel)) return rawHash
  try {
    const obj = JSON.parse(buf.toString('utf8'))
    if (obj && typeof obj === 'object') delete obj.updatedAt
    return sha256(stableStringify(obj))
  } catch {
    return rawHash
  }
}

function walkFiles(absRoot, relPrefix, out, depth = 0) {
  if (depth > 12) return
  let entries = []
  try {
    entries = readdirSync(absRoot, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue
    const abs = join(absRoot, ent.name)
    const rel = `${relPrefix}/${ent.name}`
    if (ent.isSymbolicLink()) continue
    if (ent.isDirectory()) walkFiles(abs, rel, out, depth + 1)
    else if (ent.isFile()) out.push({ rel, abs })
  }
}

function collectTrackedFiles(absDir) {
  const out = []
  for (const rel of TRACKED_ROOT_FILES) {
    const abs = join(absDir, rel)
    let st = null
    try {
      st = lstatSync(abs)
    } catch {}
    // a symlinked file (or one behind a junctioned folder such as output/) is never read, overwritten or deleted
    if (st?.isFile() && !pathHasLink(absDir, abs)) out.push({ rel, abs })
  }
  for (const tree of TRACKED_TREES) {
    const absTree = join(absDir, tree)
    if (isRealDir(absTree)) walkFiles(absTree, tree, out) // a symlinked / junctioned src/ is never followed
  }
  return out.filter((f) => !EXCLUDED_PREFIXES.some((p) => f.rel.startsWith(p)))
}

function collectMediaRefs(absDir) {
  const media = {}
  let count = 0
  let truncated = false
  for (const tree of MEDIA_TREES) {
    const files = []
    const absTree = join(absDir, tree)
    if (existsSync(absTree)) walkFiles(absTree, tree, files)
    for (const f of files) {
      if (count >= MAX_MEDIA_REFS) {
        truncated = true
        break
      }
      try {
        const st = statSync(f.abs)
        media[f.rel] = { size: st.size, mtimeMs: Math.round(st.mtimeMs) }
        count++
      } catch {}
    }
  }
  return { media, truncated }
}

function hashTrackedFile(f) {
  const st = statSync(f.abs)
  if (st.size > MAX_TRACKED_FILE_BYTES) return { skipped: true, size: st.size }
  const cached = hashCache.get(f.abs)
  const stable = Date.now() - st.mtimeMs > 1500
  if (stable && cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs && cached.ctimeMs === st.ctimeMs) {
    return { hash: cached.hash, semHash: cached.semHash, size: st.size, buf: null }
  }
  const buf = readFileSync(f.abs)
  const hash = sha256(buf)
  const semHash = semanticHash(f.rel, buf, hash)
  hashCache.set(f.abs, { size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, hash, semHash })
  return { hash, semHash, size: st.size, buf }
}

function objectPath(objectsDir, hash) {
  // versions.json is not trusted: a hash is exactly 64 lowercase hex chars, so it can never name a path elsewhere
  const h = String(hash ?? '')
  if (!HASH_RE.test(h)) throw historyError(`历史对象哈希无效: ${h.slice(0, 16) || '(空)'}（版本记录可能已损坏或被改动）`, 409, 'HISTORY_CORRUPT')
  return join(objectsDir, h.slice(0, 2), `${h}.gz`)
}

function putObject(objectsDir, hash, buf) {
  const p = objectPath(objectsDir, hash)
  if (existsSync(p)) return false
  mkdirSync(dirname(p), { recursive: true })
  if (![dirname(objectsDir), objectsDir, dirname(p)].every(isRealDir)) {
    throw historyError('history/objects 中存在符号链接 / 联接 (junction)，为安全起见不写入版本对象', 409, 'HISTORY_STORE_LINK')
  }
  const gz = gzipSync(buf, { level: 6 })
  const tmp = `${p}.${process.pid}.${Math.random().toString(36).slice(2, 6)}.tmp`
  writeFileSync(tmp, gz)
  try {
    renameSync(tmp, p)
  } catch {
    try {
      unlinkSync(tmp)
    } catch {}
    if (!existsSync(p)) writeFileSync(p, gz)
  }
  return true
}

function readObject(objectsDir, hash) {
  const p = objectPath(objectsDir, hash)
  if (!existsSync(p)) throw historyError(`历史对象缺失: ${String(hash).slice(0, 12)}（可能已被清理）`, 409, 'HISTORY_OBJECT_MISSING')
  return gunzipSync(readFileSync(p))
}

function computeStateHash(files = {}) {
  const parts = Object.keys(files)
    .sort()
    .map((rel) => `${rel}:${files[rel].semHash || files[rel].hash}`)
  return sha256(parts.join('\n')).slice(0, 40)
}

function readVersionsDoc(paths) {
  const doc = readJsonSafe(paths.versionsFile, null)
  return {
    version: 1,
    seq: Number(doc?.seq || 0),
    versions: Array.isArray(doc?.versions) ? doc.versions : [],
    lastRestore: doc?.lastRestore || null,
    legacyMigrated: Boolean(doc?.legacyMigrated),
    updatedAt: doc?.updatedAt || '',
  }
}

function writeVersionsDoc(paths, doc) {
  doc.updatedAt = new Date().toISOString()
  writeJsonAtomic(paths.versionsFile, doc)
}

function summarizeVersion(v, currentStateHash = '') {
  if (!v) return null
  return {
    id: v.id,
    seq: v.seq,
    time: v.time,
    label: v.label,
    stage: v.stage,
    author: v.author,
    kind: v.kind,
    note: v.note || '',
    runId: v.runId || '',
    stateHash: v.stateHash,
    fileCount: Object.keys(v.files || {}).length,
    mediaCount: Object.keys(v.media || {}).length,
    isCurrent: Boolean(currentStateHash && v.stateHash === currentStateHash),
  }
}

/**
 * Hash the working tree (no objects written). Used for dedupe / rollback candidate selection.
 */
export function computeCurrentProjectState(projectDir) {
  const { absDir } = historyPaths(projectDir)
  const files = {}
  for (const f of collectTrackedFiles(absDir)) {
    try {
      const h = hashTrackedFile(f)
      if (h.skipped) continue
      files[f.rel] = { hash: h.hash, semHash: h.semHash, size: h.size }
    } catch {}
  }
  return { files, stateHash: computeStateHash(files) }
}

function buildVersionEntry(doc, { files, media, mediaTruncated, skipped, label, stage, author, kind, note, runId, time }) {
  doc.seq += 1
  const t = time || new Date().toISOString()
  return {
    id: `ver-${Date.parse(t).toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    seq: doc.seq,
    time: t,
    label: String(label || 'snapshot'),
    stage: String(stage || ''),
    author: author === 'user' ? 'user' : 'ai',
    kind: String(kind || 'checkpoint'),
    note: String(note || ''),
    runId: String(runId || ''),
    stateHash: computeStateHash(files),
    files,
    media,
    mediaTruncated: Boolean(mediaTruncated),
    skipped: skipped || [],
  }
}

/**
 * Remove objects no longer referenced by any version. Unreferenced objects younger than `GC_GRACE_MS` are kept:
 * a writer that had to proceed without the history lock (lock wait timed out) may be about to record a version
 * that references them (createProjectSnapshot refreshes the mtime of every object it re-uses).
 */
const GC_GRACE_MS = 2 * 60 * 1000

function touchObject(objectsDir, hash) {
  try {
    const now = new Date()
    utimesSync(objectPath(objectsDir, hash), now, now)
  } catch {}
}

function gcObjects(paths, versions, { nowMs = Date.now(), graceMs = GC_GRACE_MS } = {}) {
  // Never follows a symlink / junction (history/, history/objects/, shards and objects are all lstat-checked) and
  // only ever deletes names this store writes: <aa>/<sha256>.gz and its .tmp leftovers — anything else is left alone.
  if (!isRealDir(paths.root) || !isRealDir(paths.objects)) return 0
  const referenced = new Set()
  for (const v of versions) for (const f of Object.values(v.files || {})) if (f?.hash) referenced.add(f.hash)
  let removed = 0
  let shards = []
  try {
    shards = readdirSync(paths.objects)
  } catch {
    return 0
  }
  for (const shard of shards) {
    const shardDir = join(paths.objects, shard)
    if (!SHARD_RE.test(shard) || !isRealDir(shardDir)) continue
    let names = []
    try {
      names = readdirSync(shardDir)
    } catch {
      continue
    }
    for (const name of names) {
      const obj = OBJECT_NAME_RE.exec(name)
      if (obj ? referenced.has(obj[1]) : !OBJECT_TMP_RE.test(name)) continue
      try {
        const st = lstatSync(join(shardDir, name))
        if (!st.isFile() || nowMs - st.mtimeMs < graceMs) continue
        unlinkSync(join(shardDir, name))
        removed++
      } catch {}
    }
    try {
      if (readdirSync(shardDir).length === 0) rmdirSync(shardDir)
    } catch {}
  }
  return removed
}

function pruneDoc(paths, doc, max, keepIds = []) {
  if (doc.versions.length <= max) return { prunedVersions: 0, removedObjects: 0 }
  doc.versions.sort((a, b) => a.seq - b.seq)
  const keep = new Set((keepIds || []).filter(Boolean))
  const before = doc.versions.length
  let drop = before - max
  // Oldest first; versions an in-progress operation relies on (e.g. a restore target) are never dropped
  doc.versions = doc.versions.filter((v) => {
    if (drop > 0 && !keep.has(v.id)) {
      drop--
      return false
    }
    return true
  })
  if (doc.lastRestore && !doc.versions.some((v) => v.id === doc.lastRestore.versionId)) doc.lastRestore = null
  return { prunedVersions: before - doc.versions.length, removedObjects: gcObjects(paths, doc.versions) }
}

/**
 * Migrate legacy `history/v-<stamp>-<label>/` directory copies into the content-addressed store.
 */
function migrateLegacySnapshots(paths) {
  let dirs = []
  try {
    dirs = readdirSync(paths.root, { withFileTypes: true }).filter((d) => d.isDirectory() && /^v-\d+/.test(d.name))
  } catch {
    return 0
  }
  if (dirs.length === 0) return 0
  let migrated = 0
  withFileLockSync(paths.lockFile, () => {
    const doc = readVersionsDoc(paths)
    const legacy = dirs
      .map((d) => {
        const m = d.name.match(/^v-(\d+)-?(.*)$/)
        return { name: d.name, ms: Number(m?.[1] || 0), label: (m?.[2] || 'legacy').replace(/-restored$/, '') }
      })
      .sort((a, b) => a.ms - b.ms)
    for (const lg of legacy) {
      const legacyAbs = join(paths.root, lg.name)
      const files = {}
      for (const f of collectTrackedFiles(legacyAbs)) {
        try {
          const buf = readFileSync(f.abs)
          if (buf.length > MAX_TRACKED_FILE_BYTES) continue
          const hash = sha256(buf)
          putObject(paths.objects, hash, buf)
          files[f.rel] = { hash, semHash: semanticHash(f.rel, buf, hash), size: buf.length }
        } catch {}
      }
      if (Object.keys(files).length > 0) {
        doc.versions.push(
          buildVersionEntry(doc, {
            files,
            media: {},
            label: `legacy:${lg.label}`,
            stage: lg.label,
            author: 'ai',
            kind: lg.name.endsWith('-restored') ? 'before-restore' : 'legacy',
            note: '由旧版 history/v-* 目录快照自动迁移',
            time: new Date(lg.ms || Date.now()).toISOString(),
          }),
        )
        migrated++
      }
      try {
        removeTreeNoFollow(legacyAbs)
      } catch {}
    }
    // Re-sequence chronologically so legacy versions sort before newer content-addressed ones
    doc.versions.sort((a, b) => String(a.time).localeCompare(String(b.time)) || a.seq - b.seq)
    doc.versions.forEach((v, i) => {
      v.seq = i + 1
    })
    doc.seq = doc.versions.length
    doc.legacyMigrated = true
    writeVersionsDoc(paths, doc)
  })
  return migrated
}

/**
 * Take a snapshot of the project's tracked files. Identical states are deduplicated (the latest
 * matching version is returned with `deduped: true`).
 */
export function createProjectSnapshot(projectDir, {
  label = 'snapshot',
  stage = '',
  author = 'ai',
  kind = 'checkpoint',
  note = '',
  runId = '',
  force = false,
  max,
  keepVersionIds = [],
} = {}) {
  if (!projectDir) throw historyError('projectDir is required', 400, 'BAD_REQUEST')
  const paths = historyPaths(projectDir)
  if (!existsSync(paths.absDir)) return null
  migrateLegacySnapshots(paths)
  const tracked = collectTrackedFiles(paths.absDir)
  if (tracked.length === 0) return null
  const { media, truncated } = collectMediaRefs(paths.absDir)
  // Objects are written while holding the history lock so a concurrent prune/GC can never delete
  // an object that a not-yet-recorded version is about to reference.
  return withFileLockSync(paths.lockFile, () => {
    const files = {}
    const skipped = []
    for (const f of tracked) {
      try {
        const h = hashTrackedFile(f)
        if (h.skipped) {
          skipped.push({ rel: f.rel, reason: 'too-large', size: h.size })
          continue
        }
        if (!existsSync(objectPath(paths.objects, h.hash))) putObject(paths.objects, h.hash, h.buf || readFileSync(f.abs))
        else touchObject(paths.objects, h.hash)
        files[f.rel] = { hash: h.hash, semHash: h.semHash, size: h.size }
      } catch (err) {
        skipped.push({ rel: f.rel, reason: String(err?.message || err).slice(0, 120) })
      }
    }
    const stateHash = computeStateHash(files)
    const doc = readVersionsDoc(paths)
    const latest = [...doc.versions].sort((a, b) => b.seq - a.seq)[0]
    if (!force && latest && latest.stateHash === stateHash) {
      return { ...summarizeVersion(latest, stateHash), deduped: true }
    }
    const entry = buildVersionEntry(doc, { files, media, mediaTruncated: truncated, skipped, label, stage, author, kind, note, runId })
    doc.versions.push(entry)
    const pruned = pruneDoc(paths, doc, resolveHistoryMax(max), keepVersionIds)
    writeVersionsDoc(paths, doc)
    return { ...summarizeVersion(entry, stateHash), deduped: false, pruned }
  })
}

export function listProjectVersions(projectDir, { limit = 100 } = {}) {
  const paths = historyPaths(projectDir)
  migrateLegacySnapshots(paths)
  const doc = readVersionsDoc(paths)
  const current = computeCurrentProjectState(projectDir).stateHash
  const versions = [...doc.versions].sort((a, b) => b.seq - a.seq)
  return {
    ok: true,
    total: versions.length,
    max: resolveHistoryMax(),
    currentStateHash: current,
    lastRestore: doc.lastRestore,
    versions: versions.slice(0, Math.max(1, Number(limit) || 100)).map((v) => summarizeVersion(v, current)),
  }
}

export function getProjectVersion(projectDir, versionId) {
  const doc = readVersionsDoc(historyPaths(projectDir))
  return doc.versions.find((v) => v.id === versionId) || null
}

/**
 * Read one tracked file's content from a version (Buffer), or `null` when absent.
 */
export function readVersionFile(projectDir, versionOrId, rel) {
  const paths = historyPaths(projectDir)
  const v = typeof versionOrId === 'string' ? getProjectVersion(projectDir, versionOrId) : versionOrId
  const meta = v?.files?.[rel]
  if (!meta) return null
  return readObject(paths.objects, meta.hash)
}

export function readVersionJson(projectDir, versionOrId, rel = 'script.json') {
  const buf = readVersionFile(projectDir, versionOrId, rel)
  if (!buf) return null
  try {
    return JSON.parse(buf.toString('utf8'))
  } catch {
    return null
  }
}

/**
 * Latest AI-authored script.json (the "base" for three-way merges of user edits).
 */
export function getLatestAiScript(projectDir, { beforeSeq = Infinity } = {}) {
  try {
    const doc = readVersionsDoc(historyPaths(projectDir))
    const cands = doc.versions
      .filter((v) => v.author === 'ai' && v.seq < beforeSeq && v.files?.['script.json'])
      .sort((a, b) => b.seq - a.seq)
    for (const v of cands) {
      const obj = readVersionJson(projectDir, v, 'script.json')
      if (obj) return { version: summarizeVersion(v), script: obj }
    }
  } catch {}
  return null
}

function sceneMap(script) {
  const m = new Map()
  for (const sc of Array.isArray(script?.scenes) ? script.scenes : []) if (sc?.id) m.set(sc.id, sc)
  return m
}

/**
 * Field-level diff between two script.json objects.
 */
export function diffScripts(a = {}, b = {}) {
  const ma = sceneMap(a)
  const mb = sceneMap(b)
  const added = [...mb.keys()].filter((id) => !ma.has(id))
  const removed = [...ma.keys()].filter((id) => !mb.has(id))
  const changed = []
  for (const [id, sb] of mb) {
    const sa = ma.get(id)
    if (!sa) continue
    const keys = new Set([...Object.keys(sa), ...Object.keys(sb)])
    const fields = [...keys].filter((k) => !SCENE_IGNORED_KEYS.has(k) && !deepEqual(sa[k], sb[k])).sort()
    if (fields.length > 0) changed.push({ sceneId: id, title: sb.title || sa.title || '', fields })
  }
  const orderA = [...ma.keys()].filter((id) => mb.has(id))
  const orderB = [...mb.keys()].filter((id) => ma.has(id))
  const reordered = orderA.join('|') !== orderB.join('|')
  const topKeys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
  const scriptFields = [...topKeys].filter((k) => !SCRIPT_IGNORED_KEYS.has(k) && !deepEqual(a?.[k], b?.[k])).sort()
  return { scenes: { added, removed, changed, reordered }, scriptFields }
}

function resolveStateForDiff(projectDir, ref) {
  if (!ref || ref === 'current') {
    const cur = computeCurrentProjectState(projectDir)
    const { absDir } = historyPaths(projectDir)
    return {
      meta: { id: 'current', label: '当前工作区', time: new Date().toISOString() },
      files: cur.files,
      media: collectMediaRefs(absDir).media,
      readJson: (rel) => {
        try {
          return JSON.parse(readFileSync(join(absDir, rel), 'utf8'))
        } catch {
          return null
        }
      },
    }
  }
  const v = getProjectVersion(projectDir, ref)
  if (!v) throw historyError(`未找到历史版本: ${ref}`, 404, 'VERSION_NOT_FOUND')
  return {
    meta: summarizeVersion(v),
    files: v.files || {},
    media: v.media || {},
    readJson: (rel) => readVersionJson(projectDir, v, rel),
  }
}

/**
 * Diff summary between two versions (`toVersionId` may be 'current' for the working tree).
 */
export function diffProjectVersions(projectDir, fromVersionId, toVersionId = 'current') {
  if (!fromVersionId) throw historyError('fromVersionId is required', 400, 'BAD_REQUEST')
  const from = resolveStateForDiff(projectDir, fromVersionId)
  const to = resolveStateForDiff(projectDir, toVersionId)
  const changedFiles = []
  const allRel = new Set([...Object.keys(from.files), ...Object.keys(to.files)])
  for (const rel of [...allRel].sort()) {
    const fa = from.files[rel]
    const fb = to.files[rel]
    if (fa && !fb) changedFiles.push({ path: rel, change: 'removed' })
    else if (!fa && fb) changedFiles.push({ path: rel, change: 'added' })
    else if ((fa.semHash || fa.hash) !== (fb.semHash || fb.hash)) changedFiles.push({ path: rel, change: 'modified' })
  }
  let scriptDiff = { scenes: { added: [], removed: [], changed: [], reordered: false }, scriptFields: [] }
  if (changedFiles.some((f) => f.path === 'script.json')) {
    scriptDiff = diffScripts(from.readJson('script.json') || {}, to.readJson('script.json') || {})
  }
  const media = { added: [], removed: [], modified: [] }
  const allMedia = new Set([...Object.keys(from.media || {}), ...Object.keys(to.media || {})])
  for (const rel of allMedia) {
    const ma = from.media[rel]
    const mb = to.media[rel]
    if (ma && !mb) media.removed.push(rel)
    else if (!ma && mb) media.added.push(rel)
    else if (ma.size !== mb.size || ma.mtimeMs !== mb.mtimeMs) media.modified.push(rel)
  }
  const sc = scriptDiff.scenes
  const summaryText = [
    changedFiles.length ? `文件变更 ${changedFiles.length} 个` : '文件无变更',
    sc.changed.length ? `场景修改 ${sc.changed.length} 个（${sc.changed.slice(0, 6).map((c) => `${c.sceneId}: ${c.fields.slice(0, 5).join('/')}`).join('；')}）` : '',
    sc.added.length ? `新增场景 ${sc.added.join(', ')}` : '',
    sc.removed.length ? `删除场景 ${sc.removed.join(', ')}` : '',
    sc.reordered ? '场景顺序调整' : '',
    scriptDiff.scriptFields.length ? `全局字段 ${scriptDiff.scriptFields.slice(0, 8).join('/')}` : '',
    media.added.length + media.removed.length + media.modified.length ? `媒体引用变化 ${media.added.length + media.removed.length + media.modified.length} 个` : '',
  ]
    .filter(Boolean)
    .join('；')
  return {
    ok: true,
    from: from.meta,
    to: to.meta,
    changedFiles,
    scenes: sc,
    scriptFields: scriptDiff.scriptFields,
    media,
    summaryText,
  }
}

/**
 * Move files the restore is about to overwrite / delete, but that history could not store, to
 * `history/trash/<stamp>/<rel>`. All-or-nothing: on any failure the moves are undone and the restore is refused.
 */
function moveToTrash(paths, files) {
  const trashRoot = join(paths.root, 'trash')
  for (const p of [paths.root, trashRoot]) {
    if (existsSync(p) && !isRealDir(p)) {
      throw historyError(`${p === trashRoot ? 'history/trash' : 'history'} 是符号链接 / 联接，无法安全备份未进版本库的文件，已取消恢复（工程未改动）`, 409, 'HISTORY_TRASH_FAILED')
    }
  }
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`
  const moved = []
  try {
    for (const f of files) {
      const dest = join(trashRoot, stamp, ...f.rel.split('/'))
      mkdirSync(dirname(dest), { recursive: true })
      renameSync(f.abs, dest)
      hashCache.delete(f.abs)
      moved.push({ ...f, dest })
    }
  } catch (err) {
    for (const m of moved.reverse()) {
      try {
        renameSync(m.dest, m.abs)
      } catch {}
    }
    throw historyError(
      `无法把未进版本库的文件移到 history/trash（${err?.code || err?.message || err}），已取消恢复（工程未改动）`,
      409,
      'HISTORY_TRASH_FAILED',
    )
  }
  return {
    dir: `history/trash/${stamp}`,
    files: moved.map((m) => ({ path: m.rel, trashPath: `history/trash/${stamp}/${m.rel}`, size: m.size, reason: m.reason })),
  }
}

/**
 * Restore a version. A "before restore" snapshot of the current state is taken first.
 * Media files are referenced only (never rewritten); missing/changed media is reported.
 * Nothing the restore replaces is lost for good: a tracked file the "before restore" snapshot could not store (> 8 MB,
 * unreadable) is moved to `history/trash/<stamp>/` first (`trashedFiles`, `trashDir`), and a file the target version
 * recorded as too large to store is kept instead of deleted (`keptFiles`). Only tracked paths inside the project are
 * written: a version with any other path or a malformed hash is refused before anything changes, and a path running
 * through a symlink / junction is skipped (`skippedFiles`).
 */
export function restoreProjectVersion(projectDir, versionId, { author = 'user', onRestored, reason = '' } = {}) {
  const paths = historyPaths(projectDir)
  migrateLegacySnapshots(paths)
  const target = getProjectVersion(projectDir, versionId)
  if (!target) throw historyError(`未找到历史版本: ${versionId}`, 404, 'VERSION_NOT_FOUND')
  // versions.json is not trusted (projects may come from elsewhere): validate every path + hash before anything is
  // read or written — never write outside the project or to an untracked location
  const entries = Object.entries(target.files && typeof target.files === 'object' ? target.files : {})
  const unsafe = entries.filter(([rel, meta]) => !isRestorableRel(rel) || !HASH_RE.test(String(meta?.hash ?? ''))).map(([rel]) => rel)
  if (unsafe.length > 0) {
    const shown = unsafe.slice(0, 5).map((r) => String(r).slice(0, 120)).join(', ')
    throw historyError(
      `历史版本 ${versionId} 含有不安全的文件路径或损坏的记录，已拒绝恢复（工程未改动）: ${shown}${unsafe.length > 5 ? ` 等 ${unsafe.length} 项` : ''}`,
      409,
      'HISTORY_UNSAFE_VERSION',
    )
  }
  // Read every object first so a missing object aborts before touching the working tree
  const contents = new Map()
  const skippedFiles = []
  for (const [rel, meta] of entries) {
    const abs = join(paths.absDir, ...rel.split('/'))
    if (pathHasLink(paths.absDir, abs)) {
      skippedFiles.push({ path: rel, reason: 'link' }) // a symlink / junction on the way: never written through
      continue
    }
    contents.set(rel, { abs, buf: readObject(paths.objects, meta.hash) })
  }

  const before = createProjectSnapshot(projectDir, {
    label: `before-restore→${target.label}`,
    stage: 'restore',
    author,
    kind: 'before-restore',
    note: reason || `恢复版本 ${versionId} 前自动备份`,
    keepVersionIds: [target.id],
  })

  // What the restore will overwrite / delete (collectTrackedFiles never lists anything behind a link)
  const targetSkipped = new Set((Array.isArray(target.skipped) ? target.skipped : []).filter((s) => s?.reason === 'too-large').map((s) => s.rel))
  const keptFiles = []
  const toWrite = []
  const toDelete = []
  for (const f of collectTrackedFiles(paths.absDir)) {
    if (contents.has(f.rel)) toWrite.push(f)
    else if (NEVER_DELETE_ON_RESTORE.has(f.rel) || (!f.rel.startsWith('src/') && !TRACKED_ROOT_FILES.includes(f.rel))) continue
    else if (targetSkipped.has(f.rel)) keptFiles.push({ path: f.rel, reason: 'target-too-large' }) // the target had one too
    else toDelete.push(f)
  }
  // Anything the before-restore snapshot could not store would be lost: move it to history/trash/<stamp>/ first
  const beforeFiles = (before?.id && getProjectVersion(projectDir, before.id)?.files) || {}
  const unrecoverable = []
  for (const f of [...toWrite, ...toDelete]) {
    if (beforeFiles[f.rel]) continue
    let size = 0
    try {
      size = statSync(f.abs).size
    } catch {}
    unrecoverable.push({ ...f, size, reason: size > MAX_TRACKED_FILE_BYTES ? 'too-large' : 'not-in-history' })
  }
  const trash = unrecoverable.length > 0 ? moveToTrash(paths, unrecoverable) : null
  const trashedRels = new Set((trash?.files || []).map((t) => t.path))

  const restoredFiles = []
  const removedFiles = []
  for (const [rel, { abs, buf }] of contents) {
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, buf)
    hashCache.delete(abs)
    restoredFiles.push(rel)
  }
  for (const f of toDelete) {
    if (trashedRels.has(f.rel)) {
      removedFiles.push(f.rel) // already moved to history/trash/
      continue
    }
    try {
      unlinkSync(f.abs)
      hashCache.delete(f.abs)
      removedFiles.push(f.rel)
    } catch {}
  }
  const mediaWarnings = []
  for (const [rel, meta] of Object.entries(target.media || {})) {
    try {
      const st = statSync(join(paths.absDir, rel))
      if (st.size !== meta.size) mediaWarnings.push({ path: rel, issue: 'changed' })
    } catch {
      mediaWarnings.push({ path: rel, issue: 'missing' })
    }
  }
  withFileLockSync(paths.lockFile, () => {
    const doc = readVersionsDoc(paths)
    doc.lastRestore = { versionId: target.id, stateHash: target.stateHash, at: new Date().toISOString() }
    writeVersionsDoc(paths, doc)
  })
  let script = null
  try {
    const scriptBuf = contents.get('script.json')?.buf
    script = scriptBuf ? JSON.parse(scriptBuf.toString('utf8')) : null
  } catch {}
  let hookError = ''
  if (typeof onRestored === 'function') {
    try {
      onRestored(script)
    } catch (err) {
      hookError = String(err?.message || err)
    }
  }
  return {
    ok: true,
    restoredVersion: summarizeVersion(target),
    beforeRestoreVersion: before,
    restoredFiles,
    removedFiles,
    trashedFiles: trash?.files || [],
    trashDir: trash?.dir || '',
    keptFiles,
    skippedFiles,
    mediaWarnings,
    hookError,
    script,
  }
}

/**
 * Versions an undo ("撤回") would step back to: newest first, skipping "before restore" safety
 * snapshots and states identical to the working tree. After a restore, only versions older than
 * the restored one are offered so repeated undo walks further back.
 */
export function listRollbackCandidates(projectDir) {
  const paths = historyPaths(projectDir)
  if (!existsSync(paths.root)) return []
  migrateLegacySnapshots(paths)
  const doc = readVersionsDoc(paths)
  if (doc.versions.length === 0) return []
  const current = computeCurrentProjectState(projectDir).stateHash
  let maxSeq = Infinity
  if (doc.lastRestore && doc.lastRestore.stateHash === current) {
    const anchor = doc.versions.find((v) => v.id === doc.lastRestore.versionId)
    if (anchor) maxSeq = anchor.seq
  }
  return doc.versions
    .filter((v) => v.seq < maxSeq && v.kind !== 'before-restore' && v.stateHash !== current)
    .sort((a, b) => b.seq - a.seq)
    .map((v) => summarizeVersion(v, current))
}

export function rollbackToPreviousVersion(projectDir, { onRestored } = {}) {
  const cands = listRollbackCandidates(projectDir)
  if (cands.length === 0) return { ok: false, message: '暂无可供撤回的历史版本快照。', remainingSnapshots: 0 }
  const res = restoreProjectVersion(projectDir, cands[0].id, { author: 'user', onRestored, reason: '一键撤回到上一版本' })
  return {
    ...res,
    restoredSnapshot: cands[0].id,
    remainingSnapshots: Math.max(0, cands.length - 1),
  }
}

export function pruneProjectHistory(projectDir, { max } = {}) {
  const paths = historyPaths(projectDir)
  if (!existsSync(paths.versionsFile)) return { ok: true, prunedVersions: 0, removedObjects: 0 }
  return withFileLockSync(paths.lockFile, () => {
    const doc = readVersionsDoc(paths)
    const res = pruneDoc(paths, doc, resolveHistoryMax(max))
    if (res.prunedVersions === 0) res.removedObjects = gcObjects(paths, doc.versions)
    writeVersionsDoc(paths, doc)
    return { ok: true, ...res, remaining: doc.versions.length }
  })
}

/**
 * Never-throwing snapshot helper for pipeline stage boundaries.
 */
export function safeProjectSnapshot(projectDir, opts = {}) {
  try {
    return createProjectSnapshot(projectDir, opts)
  } catch (err) {
    return { ok: false, error: String(err?.message || err) }
  }
}

export function relProjectPath(projectDir, abs) {
  const r = resolve(projectDir)
  return toPosixRel(resolve(abs).slice(r.length + 1))
}
