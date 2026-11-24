import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  unlinkSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncProjectFonts } from './compliance.js'
import { chunksRespectWords, cleanSubtitleChunk, segmentSubtitleLines, toSubtitleText, toTtsText } from './subtitle-engine.js'
import { sanitizeScriptForRender } from './meta-guard.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
/** Read-only plugin installation root (`packages/`, `scripts/`, bundled OFL fonts & npm deps). */
export const PACKAGE_ROOT = resolve(__dirname, '..', '..')

const isInstalledInNodeModules = /[\\/]node_modules[\\/]/i.test(PACKAGE_ROOT)
const isDevWorkspace =
  !isInstalledInNodeModules &&
  (existsSync(join(PACKAGE_ROOT, '.git')) || existsSync(join(PACKAGE_ROOT, 'start-workbench.cmd')))

/**
 * Writable runtime workspace/config root:
 * - In local git checkout dev mode: points to the cloned repo folder itself
 * - When installed into DSH `node_modules`: defaults to `$DSH_VIDEO_HOME` or `~/.dsh/video-workbench`
 *   so updates never overwrite user configs/projects and pnpm's read-only store stays untouched.
 */
export const REPO_ROOT = isDevWorkspace
  ? PACKAGE_ROOT
  : resolve(
      (process.env.DSH_VIDEO_HOME || '').trim() ||
        join((process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh'), 'video-workbench'),
    )

try {
  if (!existsSync(REPO_ROOT)) mkdirSync(REPO_ROOT, { recursive: true })
} catch {}

/**
 * Resolve a read-only file shipped inside the plugin package (e.g. `scripts/tts-bridge.py`).
 */
export function resolvePackagePath(...segments) {
  const inPkg = join(PACKAGE_ROOT, ...segments)
  if (existsSync(inPkg)) return inPkg
  return join(REPO_ROOT, ...segments)
}

function getPkgRequire() {
  try {
    return createRequire(join(PACKAGE_ROOT, 'package.json'))
  } catch {
    return null
  }
}

function findExecutableOnPath(cmdName) {
  const pathStr = process.env.PATH || process.env.Path || ''
  if (!pathStr) return ''
  const sep = process.platform === 'win32' ? ';' : ':'
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  for (const dir of pathStr.split(sep)) {
    const cleanDir = dir.trim().replace(/^"+|"+$/g, '')
    if (!cleanDir) continue
    for (const ext of exts) {
      const candidate = join(cleanDir, cmdName.endsWith(ext) ? cmdName : `${cmdName}${ext}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return ''
}

let envLoaded = false

/**
 * JSON for embedding inside an HTML `<script type="application/json">` tag: `<` becomes `\u003c` (the same JSON
 * value), so user text such as `</script>` or `<!--` cannot end or break the tag.
 */
export function scriptJsonForHtml(data, space = 2) {
  return JSON.stringify(data, null, space).replace(/</g, '\\u003c')
}

/**
 * Load `.env` from writable workspace root (never hardcodes personal paths).
 */
export function loadEnv(force = false) {
  if (envLoaded && !force) return process.env
  const envPath = process.env.DSH_VIDEO_ENV_PATH || join(REPO_ROOT, '.env')
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx <= 0) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let val = trimmed.slice(eqIdx + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) {
        process.env[key] = val
      }
    }
  }
  // Ensure temporary directories default to writable `.tmp` (preventing C: drive temp bloat)
  const localTmp = join(REPO_ROOT, '.tmp')
  try {
    if (!existsSync(localTmp)) mkdirSync(localTmp, { recursive: true })
    process.env.TMP = localTmp
    process.env.TEMP = localTmp
    process.env.TMPDIR = localTmp
  } catch {}
  envLoaded = true
  return process.env
}

/**
 * Resolve a path from env (supports relative paths anchored to writable REPO_ROOT).
 */
export function resolveEnvPath(envKey, fallbackRelative = '') {
  loadEnv()
  const raw = (process.env[envKey] || fallbackRelative || '').trim()
  if (!raw) return ''
  return isAbsolute(raw) ? raw : resolve(REPO_ROOT, raw)
}

/**
 * Resolve Remotion runtime (`remotion`, `@remotion/renderer`, `@remotion/bundler`, `typescript`)
 * cleanly across `.env REMOTION_TEMPLATE_ROOT` override, flat npm, and pnpm virtual stores.
 */
export function resolveRemotionRuntime() {
  loadEnv()
  const explicitRoot = resolveEnvPath('REMOTION_TEMPLATE_ROOT', '')
  const nmCandidates = [
    join(PACKAGE_ROOT, 'node_modules'),
    basename(dirname(PACKAGE_ROOT)) === 'node_modules' ? dirname(PACKAGE_ROOT) : '',
    basename(dirname(dirname(PACKAGE_ROOT))) === 'node_modules' ? dirname(dirname(PACKAGE_ROOT)) : '',
    explicitRoot ? join(explicitRoot, 'node_modules') : '',
  ].filter(Boolean)

  for (const nmDir of nmCandidates) {
    const rendererDir = join(nmDir, '@remotion', 'renderer')
    const bundlerDir = join(nmDir, '@remotion', 'bundler')
    const remotionDir = join(nmDir, 'remotion')
    if (
      existsSync(join(rendererDir, 'package.json')) &&
      existsSync(join(bundlerDir, 'package.json')) &&
      existsSync(join(remotionDir, 'package.json'))
    ) {
      const tscCand = join(nmDir, 'typescript', 'bin', 'tsc')
      return {
        templateRoot: nmDir === join(PACKAGE_ROOT, 'node_modules') ? PACKAGE_ROOT : dirname(nmDir),
        nodeModulesDir: nmDir,
        rendererEntry: join(rendererDir, 'dist', 'index.js'),
        bundlerEntry: join(bundlerDir, 'dist', 'index.js'),
        tscBin: existsSync(tscCand) ? tscCand : '',
      }
    }
  }
  return null
}

/**
 * Link bundled `node_modules` (Remotion, Three.js, @remotion/three, React, TypeScript) into a generated video project
 * so `tsc --noEmit` and `@remotion/bundler` work with zero manual `npm install`.
 */
export function ensureRemotionJunction(projectDir) {
  const absDir = resolve(projectDir)
  const runtime = resolveRemotionRuntime()
  const projNm = join(absDir, 'node_modules')
  if (runtime?.nodeModulesDir && existsSync(runtime.nodeModulesDir)) {
    let hasProjNm = existsSync(projNm)
    if (hasProjNm) {
      // Upgrade stale junction if it lacks newly bundled Three.js / @remotion/three
      const hasThreeInTarget = existsSync(join(runtime.nodeModulesDir, 'three', 'package.json'))
      const hasThreeInProj = existsSync(join(projNm, 'three', 'package.json'))
      if (hasThreeInTarget && !hasThreeInProj) {
        try {
          rmSync(projNm, { recursive: true, force: true })
          hasProjNm = false
        } catch {}
      }
    }
    if (!hasProjNm) {
      try {
        lstatSync(projNm)
        rmSync(projNm, { recursive: true, force: true })
      } catch {}
      try {
        symlinkSync(runtime.nodeModulesDir, projNm, 'junction')
      } catch {}
    }
  }
  return { absDir, templateRoot: runtime?.templateRoot || '', runtime }
}

/**
 * Resolve ffmpeg & ffprobe binaries cleanly:
 * 1) Explicit custom `.env` `FFMPEG_PATH` / `FFPROBE_PATH`
 * 2) Existing binary on system `PATH`
 * 3) Bundled zero-script npm packages (`@ffmpeg-installer/ffmpeg`, `@ffprobe-installer/ffprobe`)
 * 4) Fallback `@remotion/compositor-*` binaries
 */
export function resolveBinaries() {
  loadEnv()
  const ffmpegEnv = (process.env.FFMPEG_PATH || '').trim()
  const ffprobeEnv = (process.env.FFPROBE_PATH || '').trim()

  const req = getPkgRequire()
  let bundledFfmpeg = ''
  let bundledFfprobe = ''
  if (req) {
    try {
      const m = req('@ffmpeg-installer/ffmpeg')
      if (m?.path && existsSync(m.path)) bundledFfmpeg = m.path
    } catch {}
    try {
      const p = req('@ffprobe-installer/ffprobe')
      if (p?.path && existsSync(p.path)) bundledFfprobe = p.path
    } catch {}
  }

  let ffmpeg = ''
  if (ffmpegEnv && !/^ffmpeg(?:\.exe)?$/i.test(ffmpegEnv) && existsSync(ffmpegEnv)) {
    ffmpeg = ffmpegEnv
  } else if (findExecutableOnPath('ffmpeg')) {
    ffmpeg = findExecutableOnPath('ffmpeg')
  } else if (bundledFfmpeg) {
    ffmpeg = bundledFfmpeg
  }

  let ffprobe = ''
  if (ffprobeEnv && !/^ffprobe(?:\.exe)?$/i.test(ffprobeEnv) && existsSync(ffprobeEnv)) {
    ffprobe = ffprobeEnv
  } else if (ffmpeg) {
    const sibling = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    if (existsSync(sibling)) ffprobe = sibling
  }
  if (!ffprobe && findExecutableOnPath('ffprobe')) {
    ffprobe = findExecutableOnPath('ffprobe')
  }
  if (!ffprobe && bundledFfprobe) {
    ffprobe = bundledFfprobe
  }

  // Last-resort Remotion compositor native binaries if available
  if ((!ffmpeg || !ffprobe) && req) {
    try {
      const rendererDir = dirname(req.resolve('@remotion/renderer/package.json'))
      const nm = dirname(dirname(rendererDir))
      const remDir = join(nm, '@remotion')
      if (existsSync(remDir)) {
        const compPkg = `@remotion/compositor-${process.platform}-${process.arch}${process.platform === 'win32' ? '-msvc' : ''}`
        const compDir = join(nm, ...compPkg.split('/'))
        const ffCand = join(compDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
        const fpCand = join(compDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
        if (!ffmpeg && existsSync(ffCand)) ffmpeg = ffCand
        if (!ffprobe && existsSync(fpCand)) ffprobe = fpCand
      }
    } catch {}
  }

  return {
    ffmpeg: ffmpeg || ffmpegEnv || 'ffmpeg',
    ffprobe: ffprobe || ffprobeEnv || 'ffprobe',
  }
}

/*
 * FFmpeg build differences. When neither FFMPEG_PATH nor a system ffmpeg exists, resolveBinaries() falls back to the
 * npm-bundled @ffmpeg-installer build — a late-2018 FFmpeg (4.1-dev). Filter graphs must therefore work on it as well as on
 * current releases: no `amix normalize`, no `adelay all`, no `apad whole_dur`, and an endless `apad` followed by `atrim`
 * never terminates there. The helpers below hide those differences.
 */
const ffmpegFilterOptionCache = new Map()
/** Option names of one FFmpeg filter in the given build (empty Set when the build cannot be queried). Cached. */
export function ffmpegFilterOptions(ffmpegBin, filter) {
  const key = `${ffmpegBin}\n${filter}`
  if (ffmpegFilterOptionCache.has(key)) return ffmpegFilterOptionCache.get(key)
  const opts = new Set()
  try {
    const out = execFileSync(ffmpegBin, ['-hide_banner', '-h', `filter=${filter}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 8000,
    })
    for (const m of String(out || '').matchAll(/^\s{1,6}([a-z][a-z0-9_]*)\s+</gm)) opts.add(m[1])
  } catch {}
  ffmpegFilterOptionCache.set(key, opts)
  return opts
}
export const ffmpegFilterHasOption = (ffmpegBin, filter, option) => ffmpegFilterOptions(ffmpegBin, filter).has(option)

/**
 * `amix` that sums its inputs without rescaling (`normalize=0`) on every FFmpeg version. Builds without `normalize` divide
 * by the weight sum, which the trailing `volume` restores exactly — provided all inputs last equally long (pad them to the
 * same length first, see ffmpegPadTo), otherwise those builds re-scale the remaining inputs each time one ends.
 */
export function ffmpegAmixNoRescale(ffmpegBin, inputs, { duration = 'longest', weights = null, dropoutTransition = null } = {}) {
  const w = Array.isArray(weights) && weights.length === inputs ? weights.map((x) => Number(x)) : null
  const parts = [`inputs=${inputs}`]
  if (ffmpegFilterHasOption(ffmpegBin, 'amix', 'normalize')) parts.push('normalize=0')
  parts.push(`duration=${duration}`)
  if (dropoutTransition !== null && dropoutTransition !== undefined) parts.push(`dropout_transition=${dropoutTransition}`)
  if (w) parts.push(`weights=${w.join('|')}`)
  if (parts.includes('normalize=0')) return `amix=${parts.join(':')}`
  const sum = w ? w.reduce((a, b) => a + b, 0) : inputs
  return `amix=${parts.join(':')},volume=${Number(sum.toFixed(6))}`
}

/** Finite `apad` to at least `sec` seconds at `sampleRate` (works on every build; follow with `atrim=0:<sec>` to cut). */
export const ffmpegPadTo = (sec, sampleRate) => `apad=whole_len=${Math.max(1, Math.round(Number(sec) * Number(sampleRate)))}`

/**
 * Resolve local Chromium / Chrome / Edge binary for HTML frame capture and fallback Remotion rendering.
 */
export function resolveBrowserExecutable() {
  loadEnv()
  const explicit = resolveEnvPath('BROWSER_EXECUTABLE_PATH', '')
  if (explicit && existsSync(explicit)) return explicit

  const pwPath = resolveEnvPath('PLAYWRIGHT_BROWSERS_PATH', '')
  if (pwPath && existsSync(pwPath)) {
    try {
      for (const entry of readdirSync(pwPath)) {
        if (entry.startsWith('chromium-')) {
          const candidate = join(pwPath, entry, 'chrome-win', 'chrome.exe')
          if (existsSync(candidate)) return candidate
        }
      }
    } catch {}
  }

  const progFilesX86 = process.env['ProgramFiles(x86)'] || ''
  const progFiles = process.env.ProgramFiles || ''
  const localAppData = process.env.LOCALAPPDATA || ''
  const candidates =
    process.platform === 'win32'
      ? [
          progFilesX86 && join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          progFiles && join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          progFiles && join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          progFilesX86 && join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          localAppData && join(localAppData, 'ms-playwright', 'chromium-1148', 'chrome-win', 'chrome.exe'),
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : [
            findExecutableOnPath('google-chrome'),
            findExecutableOnPath('chromium'),
            findExecutableOnPath('chromium-browser'),
            findExecutableOnPath('microsoft-edge'),
          ]

  for (const c of candidates.filter(Boolean)) {
    if (existsSync(c)) return c
  }
  return ''
}

/**
 * Forcefully terminate a spawned child process tree (Windows `taskkill /T /F` fallback `SIGKILL`).
 */
export function killProcessTree(child) {
  if (!child) return
  try {
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.on('error', () => {})
    }
  } catch {}
  try {
    child.kill('SIGKILL')
  } catch {
    try {
      child.kill()
    } catch {}
  }
}

export function createAbortError(message = '任务已手动停止 (Aborted)') {
  const err = new Error(message)
  err.name = 'AbortError'
  err.code = 'ABORT_ERR'
  return err
}

/** Last `time=` position of an FFmpeg progress report in a (growing) stderr log, or '' when none was printed yet. */
function readFfmpegProgressPosition(logFile) {
  let fd
  try {
    const size = statSync(logFile).size
    if (!size) return ''
    const len = Math.min(size, 4096)
    const buf = Buffer.alloc(len)
    fd = openSync(logFile, 'r')
    readSync(fd, buf, 0, len, size - len)
    const hits = [...buf.toString('latin1').matchAll(/time=\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/g)]
    return hits.length ? hits[hits.length - 1][1] : ''
  } catch {
    return ''
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd) } catch {}
    }
  }
}

/**
 * Spawn a child process using file-redirected stdio to avoid Windows sandbox pipe `EPERM`.
 * Supports AbortSignal cancellation and immediate process-tree cleanup.
 * Adapted from MIT-licensed `dsh-video-studio/dsh/ffmpeg.js`.
 *
 * `stallTimeoutMs` (opt-in, only for FFmpeg commands that print their progress report, i.e. without `-nostats` /
 * `-v error`): kill the command once the report's `time=` position stops advancing for that long — FFmpeg can deadlock
 * at the end of a filter graph while its main thread keeps printing the same report. Rejects with
 * `err.code === 'ESTALLED'` so the caller can run the command again. `stallStartupMs` bounds the wait for the first
 * `time=` (default: 4 × stallTimeoutMs, at least 60 s).
 */
export function runCommandRedirected(bin, args = [], options = {}) {
  const { cwd = REPO_ROOT, env = process.env, timeoutMs = 180_000, signal, onChild, stallTimeoutMs = 0, stallStartupMs = 0 } = options
  if (signal?.aborted) {
    return Promise.reject(createAbortError())
  }
  const tempRoot = join(REPO_ROOT, '.tmp')
  if (!existsSync(tempRoot)) {
    try {
      mkdirSync(tempRoot, { recursive: true })
    } catch {
      // Fallback to OS tmpdir if repo .tmp is unavailable
    }
  }
  const baseTmp = existsSync(tempRoot) ? tempRoot : tmpdir()
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const stdoutFile = join(baseTmp, `cmd-${id}.stdout.log`)
  const stderrFile = join(baseTmp, `cmd-${id}.stderr.log`)

  return new Promise((resolvePromise, rejectPromise) => {
    let stdoutFd
    let stderrFd
    try {
      stdoutFd = openSync(stdoutFile, 'w')
      stderrFd = openSync(stderrFile, 'w')
    } catch (err) {
      rejectPromise(err)
      return
    }

    let settled = false
    let timer = null
    let stallTimer = null
    const stopStallWatch = () => {
      if (stallTimer) clearInterval(stallTimer)
      stallTimer = null
    }

    const cleanupAndRead = () => {
      try { closeSync(stdoutFd) } catch {}
      try { closeSync(stderrFd) } catch {}
      let stdout = ''
      let stderr = ''
      try { stdout = readFileSync(stdoutFile, 'utf8') } catch {}
      try { stderr = readFileSync(stderrFile, 'utf8') } catch {}
      try { unlinkSync(stdoutFile) } catch {}
      try { unlinkSync(stderrFile) } catch {}
      return { stdout, stderr }
    }

    const child = spawn(bin, args, {
      cwd,
      env,
      stdio: ['ignore', stdoutFd, stderrFd],
      windowsHide: true,
    })
    if (typeof onChild === 'function') {
      try { onChild(child) } catch {}
    }

    const onAbort = () => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      stopStallWatch()
      killProcessTree(child)
      cleanupAndRead()
      rejectPromise(createAbortError('子进程已响应停止指令并终止'))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return
        settled = true
        stopStallWatch()
        signal?.removeEventListener?.('abort', onAbort)
        killProcessTree(child)
        const { stdout, stderr } = cleanupAndRead()
        rejectPromise(new Error(`Command timed out after ${timeoutMs}ms: ${bin}\n${stderr || stdout}`))
      }, timeoutMs)
    }

    if (stallTimeoutMs > 0) {
      const startupMs = stallStartupMs > 0 ? stallStartupMs : Math.max(60_000, stallTimeoutMs * 4)
      let lastPos = ''
      let lastChange = Date.now()
      stallTimer = setInterval(() => {
        if (settled) return stopStallWatch()
        const pos = readFfmpegProgressPosition(stderrFile)
        const now = Date.now()
        if (pos && pos !== lastPos) {
          lastPos = pos
          lastChange = now
          return
        }
        if (now - lastChange < (lastPos ? stallTimeoutMs : startupMs)) return
        settled = true
        stopStallWatch()
        if (timer) clearTimeout(timer)
        signal?.removeEventListener?.('abort', onAbort)
        killProcessTree(child)
        const { stdout, stderr } = cleanupAndRead()
        const err = new Error(
          `Command stalled (no progress for ${Math.round((now - lastChange) / 1000)} s${lastPos ? ` at time=${lastPos}` : ''}): ${bin}\n${String(stderr || stdout).slice(-2000)}`,
        )
        err.code = 'ESTALLED'
        rejectPromise(err)
      }, Math.min(1000, Math.max(200, Math.floor(stallTimeoutMs / 4))))
    }

    child.on('error', (err) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      stopStallWatch()
      signal?.removeEventListener?.('abort', onAbort)
      cleanupAndRead()
      rejectPromise(err)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      stopStallWatch()
      signal?.removeEventListener?.('abort', onAbort)
      const { stdout, stderr } = cleanupAndRead()
      resolvePromise({ code: code ?? 0, stdout, stderr })
    })
  })
}

/**
 * Fallback duration measurement from WAV header if ffprobe is not available.
 */
function parseWavHeaderDurationSec(filePath) {
  const buf = readFileSync(filePath)
  if (buf.length < 44) return 0
  const riff = buf.toString('ascii', 0, 4)
  const wave = buf.toString('ascii', 8, 12)
  if (riff !== 'RIFF' || wave !== 'WAVE') return 0
  let offset = 12
  let byteRate = 0
  let dataSize = 0
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    if (chunkId === 'fmt ' && offset + 20 <= buf.length) {
      byteRate = buf.readUInt32LE(offset + 16)
    } else if (chunkId === 'data') {
      dataSize = chunkSize
      break
    }
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  if (byteRate > 0 && dataSize > 0) {
    return Number((dataSize / byteRate).toFixed(4))
  }
  return 0
}

/**
 * Probe exact audio duration in seconds and frames using `ffprobe` (never guess duration).
 */
export async function probeAudioDuration(audioPath, fps = 30) {
  const absPath = resolve(audioPath)
  if (!existsSync(absPath)) {
    throw new Error(`Audio file does not exist: ${absPath}`)
  }

  const { ffprobe } = resolveBinaries()
  let durationSec = 0
  let sampleRate = 0
  let channels = 0
  let proberUsed = 'ffprobe'

  try {
    const { code, stdout, stderr } = await runCommandRedirected(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=sample_rate,channels',
      '-of', 'json',
      absPath,
    ])
    if (code === 0 && stdout.trim()) {
      const parsed = JSON.parse(stdout)
      const rawDur = Number(parsed?.format?.duration || 0)
      if (Number.isFinite(rawDur) && rawDur > 0) {
        durationSec = Number(rawDur.toFixed(4))
      }
      const stream = parsed?.streams?.[0]
      if (stream) {
        sampleRate = Number(stream.sample_rate || 0)
        channels = Number(stream.channels || 0)
      }
    } else {
      throw new Error(stderr || `ffprobe exited with code ${code}`)
    }
  } catch (err) {
    durationSec = parseWavHeaderDurationSec(absPath)
    proberUsed = 'wav-header-fallback'
    if (durationSec <= 0) {
      throw new Error(`Failed to measure audio duration via ffprobe (${ffprobe}): ${err.message}`)
    }
  }

  const safeFps = Number(fps) > 0 ? Number(fps) : 30
  const durationInFrames = Math.max(1, Math.ceil(durationSec * safeFps))

  return {
    audioPath: absPath,
    durationSec,
    durationInFrames,
    fps: safeFps,
    sampleRate,
    channels,
    proberUsed,
  }
}

export const ASPECT_RATIO_PRESETS = {
  '16:9': { label: '16:9 横屏大片 (B站 / YouTube / 官网发布)', wRatio: 16, hRatio: 9 },
  '9:16': { label: '9:16 竖屏短视频 (抖音 / 快手 / 视频号)', wRatio: 9, hRatio: 16 },
  '3:4': { label: '3:4 竖版 (小红书 / 图文笔记)', wRatio: 3, hRatio: 4 },
  '1:1': { label: '1:1 正方形 (朋友圈 / 信息流)', wRatio: 1, hRatio: 1 },
  '4:3': { label: '4:3 复古横屏 (课件 / 访谈叙事)', wRatio: 4, hRatio: 3 },
}

export const QUALITY_PRESETS = {
  '720p': { label: '720P 高清草稿 (快速预览)', shortEdge: 720 },
  '1080p': { label: '1080P 全高清 (成片推荐)', shortEdge: 1080 },
  '2k': { label: '2K 超清影院', shortEdge: 1440 },
  '4k': { label: '4K 极致画质', shortEdge: 2160 },
}

function makeEven(n, min = 320) {
  const v = Math.max(min, Math.round(Number(n) || min))
  return v % 2 === 0 ? v : v + 1
}

/**
 * Resolve exact H.264-safe (even) pixel dimensions from user preset, custom values, or AI-auto topic/asset inference.
 */
export function resolveVideoDimensions({
  aspectRatio = 'auto',
  quality = '1080p',
  width,
  height,
  topic = '',
  assets = [],
  targetPlatform = '',
} = {}) {
  const rawQuality = String(quality || '1080p').toLowerCase()
  const resolvedQuality = QUALITY_PRESETS[rawQuality] ? rawQuality : rawQuality === 'custom' ? 'custom' : '1080p'
  const rawRatio = String(aspectRatio || 'auto').toLowerCase()

  if ((rawRatio === 'custom' || resolvedQuality === 'custom') && Number(width) >= 320 && Number(height) >= 320) {
    const w = makeEven(width)
    const h = makeEven(height)
    const g = (a, b) => (b === 0 ? a : g(b, a % b))
    const d = g(w, h)
    return {
      width: w,
      height: h,
      aspectRatio: rawRatio === 'custom' ? `${w / d}:${h / d}` : rawRatio,
      requestedAspectRatio: rawRatio,
      quality: 'custom',
      reason: `自定义尺寸 ${w}×${h}`,
    }
  }

  let pickedRatio = ASPECT_RATIO_PRESETS[rawRatio] ? rawRatio : 'auto'
  let reason = ''

  if (pickedRatio === 'auto') {
    const text = String(topic || '').toLowerCase()
    if (/小红书|种草|图文笔记|3:4/.test(text)) {
      pickedRatio = '3:4'
      reason = 'AI 根据主题识别为小红书/种草场景，自动选择 3:4 比例'
    } else if (/抖音|快手|视频号|reels|shorts|竖屏|9:16|手机短视频/.test(text)) {
      pickedRatio = '9:16'
      reason = 'AI 根据主题识别为移动端竖屏短视频，自动选择 9:16 比例'
    } else if (/方屏|朋友圈卡片|1:1|正方形/.test(text)) {
      pickedRatio = '1:1'
      reason = 'AI 根据主题识别为信息流方屏场景，自动选择 1:1 比例'
    } else if (String(targetPlatform || '').toLowerCase() === 'xiaohongshu') {
      pickedRatio = '3:4'
      reason = '首发平台为小红书（图文笔记多为 3:4 竖版），自动选择 3:4 比例'
    } else if (Array.isArray(assets) && assets.length > 0) {
      let portraitCount = 0
      let tallCount = 0 // 3:4 / 4:5 photos (小红书图文) — part of portraitCount
      let squareCount = 0
      let landscapeCount = 0
      for (const a of assets) {
        const aw = Number(a?.width || 0)
        const ah = Number(a?.height || 0)
        if (aw > 0 && ah > 0) {
          const r = aw / ah
          if (r < 0.85) {
            portraitCount++
            if (r >= 0.68) tallCount++
          } else if (r > 1.18) landscapeCount++
          else squareCount++
        }
      }
      if (portraitCount > landscapeCount && portraitCount >= squareCount) {
        // 3:4 photos stay uncropped in a 3:4 film; short-video platforms (抖音 / 快手 / 视频号) keep 9:16
        const shortVideoPlatform = /douyin|kuaishou|bilibili/.test(String(targetPlatform || '').toLowerCase())
        pickedRatio = tallCount * 2 > portraitCount && !shortVideoPlatform ? '3:4' : '9:16'
        reason =
          pickedRatio === '3:4'
            ? `AI 分析导入素材多为 3:4 竖版图文构图 (${tallCount} 张)，自动匹配 3:4`
            : `AI 分析导入素材多为竖构图 (${portraitCount} 竖 vs ${landscapeCount} 横)，自动匹配 9:16`
      } else if (squareCount > landscapeCount && squareCount > portraitCount) {
        pickedRatio = '1:1'
        reason = 'AI 分析导入素材以方形为主，自动匹配 1:1'
      } else {
        pickedRatio = '16:9'
        reason = 'AI 综合主题与素材横纵比，选用 16:9 影院横屏'
      }
    } else {
      pickedRatio = '16:9'
      reason = 'AI 判定为通用宣传/演示叙事，默认采用 16:9 电影横屏'
    }
  } else {
    reason = `用户指定 ${pickedRatio} · ${resolvedQuality.toUpperCase()}`
  }

  const ratioSpec = ASPECT_RATIO_PRESETS[pickedRatio] || ASPECT_RATIO_PRESETS['16:9']
  const shortEdge = (QUALITY_PRESETS[resolvedQuality] || QUALITY_PRESETS['1080p']).shortEdge

  let outW
  let outH
  if (ratioSpec.wRatio >= ratioSpec.hRatio) {
    outH = makeEven(shortEdge)
    outW = makeEven((outH * ratioSpec.wRatio) / ratioSpec.hRatio)
  } else {
    outW = makeEven(shortEdge)
    outH = makeEven((outW * ratioSpec.hRatio) / ratioSpec.wRatio)
  }

  return {
    width: outW,
    height: outH,
    aspectRatio: pickedRatio,
    requestedAspectRatio: rawRatio,
    quality: resolvedQuality,
    reason,
  }
}

/**
 * Strip web search citations, markdown links, bare URLs, and citation brackets cleanly
 * so LLM-grounded narration/subtitles never show `utm_source` or broken `https:` strings.
 */
export function sanitizeSpokenNarration(raw = '') {
  return String(raw || '')
    .replace(/\(\s*\[[^\]]*\]\(\s*https?:\/\/[^)]*\)\s*\)/gi, '')
    .replace(/\[([^\]]+)\]\(\s*https?:\/\/[^)]*\)/gi, '$1')
    .replace(/\(\s*https?:\/\/[^)]*\)/gi, '')
    .replace(/https?:\/\/[^\s)）\]】"']+/gi, '')
    .replace(/\[cite[:：\s][^\]]*\]/gi, '')
    .replace(/\(\s*\)|（\s*）/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Split narration text into clean single-line subtitle cues proportional to character count.
 * Adapts line width automatically for portrait (11 CJK chars), square (13), or landscape (16).
 */
export function buildSentenceSubtitles(narration, durationSec, fps = 30, opts = {}) {
  const clean = sanitizeSpokenNarration(narration)
  if (!clean || durationSec <= 0) return []
  // Semantic line breaking: no quotes / edge punctuation, numbers+units & words stay whole
  const finalParts = segmentSubtitleLines(clean, opts?.maxLineWidth)
  if (finalParts.length === 0) return []
  const totalWeight = finalParts.reduce(
    (acc, s) => acc + Math.max(1, s.replace(/[^\w\u4e00-\u9fa5]/g, '').length),
    0,
  )

  let cursorSec = 0
  return finalParts.map((text, idx) => {
    const weight = Math.max(1, text.replace(/[^\w\u4e00-\u9fa5]/g, '').length)
    const isLast = idx === finalParts.length - 1
    const segDur = isLast
      ? Math.max(0.1, Number((durationSec - cursorSec).toFixed(3)))
      : Number(((durationSec * weight) / totalWeight).toFixed(3))
    const startSec = Number(cursorSec.toFixed(3))
    const endSec = Number((isLast ? durationSec : cursorSec + segDur).toFixed(3))
    cursorSec = endSec
    return {
      index: idx + 1,
      text,
      startSec,
      endSec,
      startFrame: Math.floor(startSec * fps),
      endFrame: Math.ceil(endSec * fps),
    }
  })
}

const stripSubNorm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[\s，。！？；、,!?;:："'""''·｜|\-—_()（）【】\[\]]+/g, '')

/**
 * Guarantee displayed subtitles match the actual spoken narration words in sequential order.
 * Rejects paraphrased slogan chunks that diverge from the audio transcript.
 */
export function deriveVerbalSubtitleParts(narration, subChunks = null, subtitleText = '', maxLineWidth = 16) {
  const cleanNar = sanitizeSpokenNarration(narration)
  const displayNar = toSubtitleText(cleanNar)
  const normNar = stripSubNorm(displayNar)

  if (Array.isArray(subChunks) && subChunks.length > 0) {
    const cleanChunks = subChunks
      .map((c) => cleanSubtitleChunk(toSubtitleText(sanitizeSpokenNarration(c))))
      .filter(Boolean)
    if (cleanChunks.length > 0 && chunksRespectWords(cleanChunks)) {
      if (!normNar) return cleanChunks
      const normChunks = stripSubNorm(cleanChunks.join(''))
      // Check sequential overlap: ensure chunks cover at least 75% of spoken characters
      let matchedChars = 0
      let pos = 0
      for (const ch of normChunks) {
        const hit = normNar.indexOf(ch, pos)
        if (hit >= 0) {
          matchedChars++
          pos = hit + 1
        }
      }
      const coverage = matchedChars / Math.max(1, normNar.length)
      const ratio = normChunks.length / Math.max(1, normNar.length)
      if (coverage >= 0.72 && ratio >= 0.72 && ratio <= 1.28) {
        return cleanChunks
      }
    }
  }

  const fallbackSrc = displayNar || toSubtitleText(String(subtitleText || '').trim())
  if (!fallbackSrc) return []
  return segmentSubtitleLines(fallbackSrc, maxLineWidth)
}

/** Letters and digits of an on-screen text: punctuation, quotes, spacing, URLs and display-numeral spelling ignored. */
const subtitleWordCore = (text) =>
  toSubtitleText(sanitizeSpokenNarration(text))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

/**
 * True while stored subtitle chunks are still a line split of `narration` — the same words in the same order (only
 * punctuation, quotes, spacing and display-numeral spelling may differ). Chunks cut from an older narration are stale:
 * a re-dub must re-derive the lines from the new text instead of re-timing the old words
 * (`deriveVerbalSubtitleParts` alone keeps chunks that still cover ~72 % of the narration, i.e. after a small edit).
 */
export function subChunksMatchNarration(subChunks, narration) {
  if (!Array.isArray(subChunks) || subChunks.length === 0) return false
  const chunks = subtitleWordCore(subChunks.map((c) => String(c ?? '')).join(''))
  return Boolean(chunks) && chunks === subtitleWordCore(narration)
}

/**
 * Detect acoustic pause midpoints and true speech onset/end inside a speech WAV via FFmpeg silencedetect.
 */
export async function detectSpeechPauses(audioPath, totalDurationSec = 0) {
  const result = {
    onsetSec: 0,
    speechEndSec: totalDurationSec,
    pauseMidpoints: [],
  }
  if (!audioPath || !existsSync(audioPath)) return result

  try {
    const { ffmpeg } = resolveBinaries()
    const res = await runCommandRedirected(
      ffmpeg,
      [
        '-hide_banner',
        '-i',
        audioPath,
        '-af',
        'silencedetect=noise=-38dB:d=0.14',
        '-f',
        'null',
        process.platform === 'win32' ? 'NUL' : '/dev/null',
      ],
      { timeoutMs: 25_000 },
    )
    const log = `${res.stderr || ''}\n${res.stdout || ''}`
    const intervals = []
    let curStart = null
    for (const line of log.split(/\r?\n/)) {
      const sm = /silence_start:\s*([\d.]+)/i.exec(line)
      if (sm) curStart = Number(sm[1])
      const em = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/i.exec(line)
      if (em) {
        const end = Number(em[1])
        const dur = Number(em[2])
        const start = curStart !== null ? curStart : Math.max(0, end - dur)
        intervals.push({ start, end, dur, mid: Number(((start + end) / 2).toFixed(3)) })
        curStart = null
      }
    }
    if (curStart !== null && totalDurationSec > curStart) {
      intervals.push({
        start: curStart,
        end: totalDurationSec,
        dur: totalDurationSec - curStart,
        mid: Number(((curStart + totalDurationSec) / 2).toFixed(3)),
      })
    }

    if (intervals.length > 0 && intervals[0].start <= 0.08 && intervals[0].end < totalDurationSec * 0.45) {
      result.onsetSec = Math.max(0, Number((intervals[0].end - 0.04).toFixed(3)))
    }
    const last = intervals[intervals.length - 1]
    if (last && totalDurationSec > 0 && Math.abs(last.end - totalDurationSec) <= 0.18 && last.start > result.onsetSec + 0.35) {
      result.speechEndSec = Math.max(result.onsetSec + 0.35, Number((last.start + 0.05).toFixed(3)))
    }
    result.pauseMidpoints = intervals
      .filter((iv) => iv.mid > result.onsetSec + 0.25 && iv.mid < (result.speechEndSec || totalDurationSec) - 0.25)
      .map((iv) => iv.mid)
  } catch {}
  return result
}

/**
 * Align exact sequential spoken subtitle parts onto acoustic pause midpoints in the actual TTS/mastered WAV.
 */
export async function alignSubtitlesToSpeechAudio({
  audioPath = '',
  narration = '',
  subtitleText = '',
  subChunks = null,
  leadSec = 0.35,
  durationSec = 0,
  fps = 30,
  maxLineWidth = 16,
} = {}) {
  const safeFps = Number(fps) > 0 ? Number(fps) : 30
  const dur = Math.max(0.2, Number(durationSec) || 0)
  const parts = deriveVerbalSubtitleParts(narration, subChunks, subtitleText, maxLineWidth)
  if (parts.length === 0) return []

  const pauses = await detectSpeechPauses(audioPath, dur)
  const onset = Math.max(0, Math.min(dur * 0.35, Number(pauses.onsetSec || 0)))
  const finish = Math.max(onset + 0.3, Math.min(dur, Number(pauses.speechEndSec || dur)))
  const activeDur = Math.max(0.3, finish - onset)

  if (parts.length === 1) {
    const s0 = Number(leadSec.toFixed(3))
    const s1 = Number((leadSec + Math.max(finish, onset + 0.4)).toFixed(3))
    const sf = Math.floor(s0 * safeFps)
    const ef = Math.max(sf + 1, Math.ceil(s1 * safeFps))
    return [{ index: 1, text: parts[0], startSec: s0, endSec: s1, startFrame: sf, endFrame: ef }]
  }

  const weights = parts.map((c) => Math.max(2, c.replace(/[^\w\u4e00-\u9fa5]/g, '').length))
  const totalW = weights.reduce((a, b) => a + b, 0) || 1
  const rawBoundaries = [onset]
  let accW = 0
  for (let i = 0; i < parts.length - 1; i++) {
    accW += weights[i]
    rawBoundaries.push(onset + (activeDur * accW) / totalW)
  }
  rawBoundaries.push(finish)

  // Snap internal boundaries onto nearest unclaimed FFmpeg-detected breath pauses with minimum readability floors
  const snapped = [onset]
  const usedPauseIdx = new Set()
  const maxSnapWindow = Math.max(0.45, activeDur * 0.24)
  const minDurFor = (idx) => Math.min(activeDur / parts.length, Math.max(0.72, weights[idx] * 0.085))
  for (let i = 1; i < parts.length; i++) {
    const target = rawBoundaries[i]
    const prevBound = snapped[i - 1]
    const prevMinDur = minDurFor(i - 1)
    let remMin = 0
    for (let k = i; k < parts.length; k++) remMin += minDurFor(k)
    const minBound = prevBound + prevMinDur
    const maxAllowed = Math.max(minBound, finish - remMin)
    const idealSpan = rawBoundaries[i] - rawBoundaries[i - 1]
    let bestMid = Math.max(minBound, Math.min(maxAllowed, target))
    let bestDist = Infinity
    let bestIdx = -1

    for (let pi = 0; pi < pauses.pauseMidpoints.length; pi++) {
      if (usedPauseIdx.has(pi)) continue
      const cand = pauses.pauseMidpoints[pi]
      if (cand < minBound || cand > maxAllowed) continue
      const candSpan = cand - prevBound
      if (candSpan < idealSpan * 0.48) continue
      const d = Math.abs(cand - target)
      if (d <= maxSnapWindow && d < bestDist) {
        bestDist = d
        bestMid = cand
        bestIdx = pi
      }
    }
    if (bestIdx >= 0) usedPauseIdx.add(bestIdx)
    snapped.push(Math.max(minBound, Math.min(maxAllowed, Number(bestMid.toFixed(3)))))
  }
  snapped.push(finish)

  return parts.map((text, ci) => {
    const s0 = Number((leadSec + (ci === 0 ? 0 : snapped[ci])).toFixed(3))
    const s1 = Number((leadSec + (ci === parts.length - 1 ? dur : snapped[ci + 1])).toFixed(3))
    const sf = Math.floor(s0 * safeFps)
    const ef = Math.max(sf + 1, Math.ceil(s1 * safeFps))
    return {
      index: ci + 1,
      text,
      startSec: s0,
      endSec: s1,
      startFrame: sf,
      endFrame: ef,
    }
  })
}

/**
 * Ensure Windows 11 project guards (`.npmrc` with local cache to prevent sandbox `EPERM`).
 */
export function ensureWin11ProjectGuards(projectDir) {
  const absDir = resolve(projectDir)
  if (!existsSync(absDir)) {
    mkdirSync(absDir, { recursive: true })
  }
  const npmrcPath = join(absDir, '.npmrc')
  if (!existsSync(npmrcPath)) {
    writeFileSync(
      npmrcPath,
      [
        '# Auto-generated by DSH Video Workbench for Windows 11 sandbox EPERM protection',
        'cache=./.npm-cache',
        'prefer-offline=true',
        'fund=false',
        'audit=false',
        '',
      ].join('\n'),
      'utf8',
    )
  }
  syncProjectFonts(absDir)
  return { npmrcPath }
}

/**
 * Read and normalize `script.json` from a project directory or explicit file path.
 */
export function resolveScriptJsonPath(projectOrFile) {
  const abs = resolve(projectOrFile)
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    return join(abs, 'script.json')
  }
  if (abs.toLowerCase().endsWith('.json')) {
    return abs
  }
  return join(abs, 'script.json')
}

export function readScriptJson(projectOrFile) {
  const scriptPath = resolveScriptJsonPath(projectOrFile)
  if (!existsSync(scriptPath)) {
    throw new Error(`script.json not found at: ${scriptPath}`)
  }
  const data = JSON.parse(readFileSync(scriptPath, 'utf8'))
  return { scriptPath, projectDir: dirname(scriptPath), data }
}

/** On-screen subtitle line width (display columns) for a canvas: portrait 11, square 13, landscape 16. */
export function subtitleLineWidthFor(script) {
  const w = Number(script?.width) || 1920
  const h = Number(script?.height) || 1080
  return w < h ? 11 : w === h ? 13 : 16
}

/** Length of one scene on the timeline — the one rule shared by `writeScriptJson` and the global subtitle track. */
function resolveSceneSpan(scene, fps) {
  const durationSec = Number(scene?.durationSec || 4)
  const durationInFrames =
    Number(scene?.durationInFrames) > 0 ? Number(scene.durationInFrames) : Math.max(1, Math.ceil(durationSec * fps))
  return { durationSec, durationInFrames }
}

/**
 * Time ordered subtitle lines inside one scene: each line gets a share of [offsetSec, offsetSec + spanSec] proportional
 * to its spoken length (scene-local seconds and frames). offsetSec 0 + the scene length is the default scene timing;
 * the voice lead-in + the measured voice length times a dubbed scene's lines.
 */
export function timeSubtitleParts(parts, { offsetSec = 0, spanSec = 0, fps = 30 } = {}) {
  const f = Number(fps) > 0 ? Number(fps) : 30
  const lines = (Array.isArray(parts) ? parts : []).map((c) => String(c || '').trim()).filter(Boolean)
  if (lines.length === 0) return []
  const span = Math.max(0, Number(spanSec) || 0)
  const offset = Math.max(0, Number(offsetSec) || 0)
  const weights = lines.map((c) => Math.max(2, c.replace(/[^\w\u4e00-\u9fa5]/g, '').length))
  const sumW = weights.reduce((a, b) => a + b, 0) || 1
  let cSec = 0
  return lines.map((text, ci) => {
    const isLast = ci === lines.length - 1
    const seg = isLast ? Math.max(0.1, Number((span - cSec).toFixed(3))) : Number(((span * weights[ci]) / sumW).toFixed(3))
    const s0 = Number(cSec.toFixed(3))
    const s1 = Number((isLast ? span : cSec + seg).toFixed(3))
    cSec = s1
    const startSec = Number((offset + s0).toFixed(3))
    const endSec = Number((offset + s1).toFixed(3))
    return { index: ci + 1, text, startSec, endSec, startFrame: Math.floor(startSec * f), endFrame: Math.ceil(endSec * f) }
  })
}

const finiteOrNull = (...vals) => {
  for (const v of vals) {
    if (v === null || v === undefined || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * The global subtitle track (`script.subtitles`): every scene-local cue of `scene.subtitles`, placed at its scene's
 * position on the timeline (cumulative scene lengths, the same rule `writeScriptJson` uses for `startFrame` /
 * `startSec`) and clamped to its scene. The Remotion composition and the delivery export (SRT / VTT) prefer this track
 * over the scene cues, so it is derived from the scenes — never edited on its own.
 */
export function buildGlobalSubtitleTrack(scenes = [], fps = 30) {
  const f = Number(fps) > 0 ? Number(fps) : 30
  const out = []
  let frame0 = 0
  let sec0 = 0
  for (const scene of Array.isArray(scenes) ? scenes : []) {
    if (!scene || typeof scene !== 'object') continue
    const { durationSec, durationInFrames } = resolveSceneSpan(scene, f)
    const s0 = Number(sec0.toFixed(3))
    const rows = []
    for (const sub of Array.isArray(scene.subtitles) ? scene.subtitles : []) {
      const text = String(sub?.text ?? '').trim()
      if (!text) continue
      const localStartFrame = finiteOrNull(sub.startFrame)
      const localEndFrame = finiteOrNull(sub.endFrame)
      const ls = finiteOrNull(sub.localStartSec, sub.startSec, localStartFrame !== null ? localStartFrame / f : null)
      const le = finiteOrNull(sub.localEndSec, sub.endSec, localEndFrame !== null ? localEndFrame / f : null)
      if (ls === null || le === null) continue
      const sf = Math.max(0, Math.min(durationInFrames, localStartFrame !== null ? Math.round(localStartFrame) : Math.floor(ls * f)))
      const ef = Math.max(0, Math.min(durationInFrames, localEndFrame !== null ? Math.round(localEndFrame) : Math.ceil(le * f)))
      if (ef <= sf) continue // the cue lies outside its (shortened) scene
      const localStartSec = Number(Math.max(0, Math.min(durationSec, ls)).toFixed(3))
      const localEndSec = Number(Math.max(localStartSec, Math.min(durationSec, le)).toFixed(3))
      const startSec = Number((s0 + localStartSec).toFixed(3))
      const endSec = Number((s0 + localEndSec).toFixed(3))
      rows.push({
        ...sub,
        text,
        sceneId: scene.id,
        localStartSec,
        localEndSec,
        startSec,
        endSec,
        startFrame: frame0 + sf,
        endFrame: frame0 + ef,
        globalStartSec: startSec,
        globalEndSec: endSec,
        globalStartFrame: frame0 + sf,
        globalEndFrame: frame0 + ef,
      })
    }
    rows.sort((a, b) => a.startFrame - b.startFrame)
    out.push(...rows)
    frame0 += durationInFrames
    sec0 += durationSec
  }
  return out
}

/**
 * `options.trustedSceneText`: Set of trustedSceneTextKey(sceneId, field) — scene text the USER changed in this save
 * (the editors' `POST script`); the brief-leak gate leaves it alone. AI writes never pass it.
 */
export function writeScriptJson(projectOrFile, scriptData, options = {}) {
  const scriptPath = resolveScriptJsonPath(projectOrFile)
  const projectDir = dirname(scriptPath)
  ensureWin11ProjectGuards(projectDir)

  const fps = Number(scriptData.fps) > 0 ? Number(scriptData.fps) : 30
  const resolvedWidth = Number(scriptData.width) || 1920
  const resolvedHeight = Number(scriptData.height) || 1080
  const subtitleMaxW = subtitleLineWidthFor({ width: resolvedWidth, height: resolvedHeight })
  let currentFrame = 0
  let currentSec = 0

  // Final gate: production directives must never reach narration / subtitles / on-screen text
  try {
    sanitizeScriptForRender(scriptData, { trusted: options.trustedSceneText || null })
  } catch {}

  if (Array.isArray(scriptData.scenes)) {
    scriptData.scenes = scriptData.scenes.map((scene, idx) => {
      const { durationSec, durationInFrames } = resolveSceneSpan(scene, fps)
      const startFrame = currentFrame
      const startSec = Number(currentSec.toFixed(3))
      currentFrame += durationInFrames
      currentSec += durationSec

      const buildChunkedSubtitles = (chunks) => timeSubtitleParts(chunks, { offsetSec: 0, spanSec: durationSec, fps })

      const resolvedParts = deriveVerbalSubtitleParts(
        scene.narration ?? scene.text ?? '',
        scene.subChunks,
        scene.subtitleText || scene.caption || '',
        subtitleMaxW,
      )
      const cleanedExistingSubs = Array.isArray(scene.subtitles)
        ? scene.subtitles
            .map((s) => ({ ...s, text: cleanSubtitleChunk(toSubtitleText(s?.text || '')) }))
            .filter((s) => s.text)
        : []
      const subtitles =
        cleanedExistingSubs.length > 0
          ? cleanedExistingSubs
          : resolvedParts.length > 0
            ? buildChunkedSubtitles(resolvedParts)
            : buildSentenceSubtitles(scene.narration || scene.text || scene.subtitleText || '', durationSec, fps, {
                maxLineWidth: subtitleMaxW,
              })

      return {
        id: scene.id || `scene-${String(idx + 1).padStart(2, '0')}`,
        index: idx + 1,
        title: scene.title || `分镜 ${idx + 1}`,
        narration: scene.narration ?? scene.text ?? '',
        emotion: scene.emotion || '平静',
        role: scene.role || 'narrator',
        voiceId: scene.voiceId || scriptData.defaultVoiceId || 'auto',
        voiceLocked: Boolean(scene.voiceLocked),
        voiceMatchReason: scene.voiceMatchReason || '',
        visualPrompt: scene.visualPrompt || '',
        audioFile: scene.audioFile || '',
        durationSec: Number(durationSec.toFixed(4)),
        durationInFrames,
        startFrame,
        startSec,
        subtitles,
        ...scene,
        narration: scene.narration ?? scene.text ?? '',
        // TTS-only pronunciation text (never shown); recomputed whenever the narration changes
        ttsText:
          scene.ttsText && scene.ttsNarrationRef === (scene.narration ?? scene.text ?? '')
            ? scene.ttsText
            : toTtsText(scene.narration ?? scene.text ?? ''),
        ttsNarrationRef: scene.narration ?? scene.text ?? '',
        durationSec: Number(durationSec.toFixed(4)),
        durationInFrames,
        startFrame,
        startSec,
        subtitles,
      }
    })
  }

  // The renderers prefer the global subtitle track over the scene cues: an existing track is re-derived from the scenes
  // on every write, so a re-dub, voice mastering, a subtitle override or a duration / order edit can never leave it stale
  if (Array.isArray(scriptData.subtitles) && scriptData.subtitles.length > 0 && Array.isArray(scriptData.scenes)) {
    scriptData.subtitles = buildGlobalSubtitleTrack(scriptData.scenes, fps)
  }

  scriptData.fps = fps
  scriptData.width = resolvedWidth
  scriptData.height = resolvedHeight
  if (!scriptData.aspectRatio) {
    scriptData.aspectRatio =
      resolvedWidth < resolvedHeight
        ? Math.abs(resolvedWidth / resolvedHeight - 0.75) < 0.05
          ? '3:4'
          : '9:16'
        : resolvedWidth === resolvedHeight
          ? '1:1'
          : Math.abs(resolvedWidth / resolvedHeight - 4 / 3) < 0.05
            ? '4:3'
            : '16:9'
  }
  scriptData.quality = scriptData.quality || (Math.min(resolvedWidth, resolvedHeight) <= 720 ? '720p' : '1080p')
  scriptData.engine = scriptData.engine === 'remotion' ? 'remotion' : 'html'
  scriptData.voiceMode = scriptData.voiceMode === 'manual' ? 'manual' : 'auto'
  scriptData.defaultVoiceId = scriptData.defaultVoiceId || 'auto'
  scriptData.totalDurationSec = Number(currentSec.toFixed(4))
  scriptData.totalDurationInFrames = currentFrame
  scriptData.updatedAt = new Date().toISOString()

  writeFileSync(scriptPath, JSON.stringify(scriptData, null, 2) + '\n', 'utf8')

  // Automatically keep embedded `#dsh-script-data` in `index.html` synchronized with `script.json`
  const htmlPath = join(projectDir, 'index.html')
  if (existsSync(htmlPath)) {
    try {
      const htmlContent = readFileSync(htmlPath, 'utf8')
      const scriptTagPattern = /(<script\s+id=["']dsh-script-data["']\s+type=["']application\/json["']>)([\s\S]*?)(<\/script>)/i
      if (scriptTagPattern.test(htmlContent)) {
        // replacer FUNCTION: a replacement string would expand `$1` / `$'` / `$&` typed in narration (prices, quotes)
        // and corrupt the page; scriptJsonForHtml escapes `<` so text like `</script>` cannot close the data tag
        const syncedHtml = htmlContent.replace(
          scriptTagPattern,
          (_m, open, _old, close) => `${open}\n${scriptJsonForHtml(scriptData)}\n  ${close}`,
        )
        if (syncedHtml !== htmlContent) {
          writeFileSync(htmlPath, syncedHtml, 'utf8')
        }
      }
    } catch {}
  }

  return { scriptPath, projectDir, data: scriptData }
}

export * from './compliance.js'
export * from './hardware-guard.js'
export * from './meta-guard.js'
export * from './duration-policy.js'
export * from './subtitle-engine.js'
