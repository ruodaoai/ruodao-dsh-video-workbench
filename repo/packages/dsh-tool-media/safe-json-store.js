/**
 * @dsh-video/tool-media — Crash-safe JSON persistence helpers shared by project-level stores
 * (cloud paid-job ledger, version history, character bank, stock search cache).
 *
 * - `writeJsonAtomic`: write to a temp file then rename (never leaves a half-written JSON behind)
 * - `withFileLockSync`: tiny cross-process advisory lock (O_EXCL lock file + stale takeover)
 * - `removeTreeNoFollow`: recursive delete that NEVER follows symlinks / Windows junctions
 */
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4))

function sleepSync(ms) {
  try {
    Atomics.wait(SLEEP_CELL, 0, 0, Math.max(1, ms))
  } catch {}
}

/**
 * Read JSON from disk. Missing file → `fallback`. A corrupt file is moved aside
 * (`<file>.corrupt-<time>`) so it can be inspected, then `fallback` is returned.
 */
export function readJsonSafe(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback
  let raw = ''
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return fallback
  }
  if (!raw.trim()) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    try {
      renameSync(filePath, `${filePath}.corrupt-${Date.now().toString(36)}`)
    } catch {}
    return fallback
  }
}

/**
 * Atomically persist JSON (temp file + rename). Falls back to a direct write when Windows
 * refuses the rename because another process holds the target open.
 */
export function writeJsonAtomic(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true })
  const payload = JSON.stringify(data, null, 2) + '\n'
  const tmp = `${filePath}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.tmp`
  writeFileSync(tmp, payload, 'utf8')
  try {
    renameSync(tmp, filePath)
  } catch {
    try {
      writeFileSync(filePath, payload, 'utf8')
    } finally {
      try {
        unlinkSync(tmp)
      } catch {}
    }
  }
  return filePath
}

/**
 * Run `fn` while holding an advisory lock file. Stale locks (crashed owner) are taken over
 * after `staleMs`. If the lock cannot be acquired within `timeoutMs`, `fn` still runs so a
 * stuck lock can never deadlock a production pipeline (writes stay atomic either way).
 */
export function withFileLockSync(lockPath, fn, { timeoutMs = 6000, staleMs = 20_000 } = {}) {
  mkdirSync(dirname(lockPath), { recursive: true })
  const deadline = Date.now() + timeoutMs
  let fd = null
  while (fd === null) {
    try {
      fd = openSync(lockPath, 'wx')
      try {
        writeSync(fd, `${process.pid} ${new Date().toISOString()}`)
      } catch {}
    } catch (err) {
      if (err?.code !== 'EEXIST') return fn()
      try {
        const st = statSync(lockPath)
        if (Date.now() - st.mtimeMs > staleMs) {
          unlinkSync(lockPath)
          continue
        }
      } catch {
        continue
      }
      if (Date.now() > deadline) return fn()
      sleepSync(15)
    }
  }
  try {
    return fn()
  } finally {
    try {
      closeSync(fd)
    } catch {}
    try {
      unlinkSync(lockPath)
    } catch {}
  }
}

function unlinkLinkOnly(p) {
  try {
    unlinkSync(p)
  } catch {
    // Windows directory junctions: RemoveDirectory removes the reparse point, never the target
    rmdirSync(p)
  }
}

/**
 * Recursively delete a directory tree WITHOUT following symlinks or Windows junctions
 * (project folders may contain a `node_modules` junction into the shared dependency store).
 */
export function removeTreeNoFollow(target) {
  let st
  try {
    st = lstatSync(target)
  } catch {
    return
  }
  if (st.isSymbolicLink()) {
    unlinkLinkOnly(target)
    return
  }
  if (!st.isDirectory()) {
    unlinkSync(target)
    return
  }
  for (const name of readdirSync(target)) {
    removeTreeNoFollow(join(target, name))
  }
  rmdirSync(target)
}

export function toPosixRel(p = '') {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '')
}
