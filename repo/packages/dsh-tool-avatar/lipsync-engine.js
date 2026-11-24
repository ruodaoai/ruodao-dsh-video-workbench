/**
 * @dsh-video/tool-avatar — Pluggable talking-head lip-sync engine layer.
 *
 * AVATAR_LIPSYNC_ENGINE=auto | musetalk | latentsync | cli | cloud-fal | off
 *   - musetalk   : local MuseTalk 1.5 (scripts/avatar/musetalk_infer.py, Python subprocess, JSON-line progress)
 *   - latentsync : official LatentSync repo CLI (user-installed; preset of the `cli` adapter)
 *   - cli        : any command template with {video} {audio} {output} {fps} placeholders
 *   - cloud-fal  : fal.ai queue API (BYOK, default model fal-ai/latentsync)
 *   - off        : never lip-sync (keeps the legacy non-lip-sync composite)
 *   - auto       : musetalk when installed, else cloud-fal when a key is configured, else off
 *
 * Never throws for "engine not installed": callers receive a LipsyncUnavailableError they can turn into a
 * graceful fallback to the existing compositor.
 */
import { spawn } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import {
  createAbortError,
  killProcessTree,
  loadEnv,
  probeAudioDuration,
  REPO_ROOT,
  resolveBinaries,
  resolveEnvPath,
  resolvePackagePath,
  runCommandRedirected,
} from '../shared/index.js'

export const LIPSYNC_ENGINE_IDS = ['auto', 'musetalk', 'latentsync', 'cli', 'cloud-fal', 'off']
export const IMAGE_EXT_RX = /\.(png|jpe?g|webp|bmp)$/i

export class LipsyncUnavailableError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'LipsyncUnavailableError'
    this.code = details.code || 'LIPSYNC_UNAVAILABLE'
    this.details = details
  }
}

function envNum(key, def) {
  const v = Number(process.env[key])
  return Number.isFinite(v) && String(process.env[key] ?? '').trim() !== '' ? v : def
}

function envBool(key, def) {
  const raw = String(process.env[key] ?? '').trim().toLowerCase()
  if (!raw) return def
  return ['1', 'true', 'yes', 'on'].includes(raw)
}

function readJsonSafe(p) {
  try {
    if (p && existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'))
  } catch {}
  return null
}

function fileOk(p, minBytes = 1) {
  try {
    return Boolean(p) && existsSync(p) && statSync(p).size >= minBytes
  } catch {
    return false
  }
}

/**
 * Resolve the effective lip-sync configuration from `.env` + installer manifest (+ optional overrides).
 */
export function resolveLipsyncConfig(overrides = {}) {
  loadEnv()
  const rawEngine = String(overrides.engine || process.env.AVATAR_LIPSYNC_ENGINE || 'auto').trim().toLowerCase() || 'auto'
  const home = resolve(
    overrides.home || resolveEnvPath('AVATAR_LIPSYNC_HOME', '') || join(REPO_ROOT, 'ai-engines', 'lipsync'),
  )
  const manifest = readJsonSafe(join(home, 'lipsync-engine.json'))
  const isWin = process.platform === 'win32'

  const musetalkDir = resolve(
    overrides.musetalkDir || resolveEnvPath('AVATAR_LIPSYNC_MUSETALK_DIR', '') || manifest?.musetalkDir || join(home, 'MuseTalk'),
  )
  const python = resolve(
    overrides.python ||
      resolveEnvPath('AVATAR_LIPSYNC_PYTHON', '') ||
      manifest?.python ||
      (isWin ? join(home, '.venv', 'Scripts', 'python.exe') : join(home, '.venv', 'bin', 'python')),
  )
  const torchHome = resolve(resolveEnvPath('AVATAR_LIPSYNC_TORCH_HOME', '') || manifest?.torchHome || join(home, 'torch-hub'))
  const wrapper = resolvePackagePath('scripts', 'avatar', 'musetalk_infer.py')
  const modelsDir = join(musetalkDir, 'models')
  const ckptDir = join(torchHome, 'hub', 'checkpoints')
  const requiredFiles = {
    python,
    wrapper,
    unet: join(modelsDir, 'musetalkV15', 'unet.pth'),
    unetConfig: join(modelsDir, 'musetalkV15', 'musetalk.json'),
    vaeConfig: join(modelsDir, 'sd-vae', 'config.json'),
    whisperConfig: join(modelsDir, 'whisper', 'config.json'),
    faceParse: join(modelsDir, 'face-parse-bisent', '79999_iter.pth'),
    faceParseBackbone: join(modelsDir, 'face-parse-bisent', 'resnet18-5c106cde.pth'),
    s3fd: join(ckptDir, 's3fd-619a316812.pth'),
    fan: join(ckptDir, '2DFAN4-cd938726ad.zip'),
  }
  const missing = Object.entries(requiredFiles)
    .filter(([, p]) => !fileOk(p))
    .map(([k, p]) => `${k}: ${p}`)
  const vaeWeights = ['diffusion_pytorch_model.safetensors', 'diffusion_pytorch_model.bin'].map((f) => join(modelsDir, 'sd-vae', f))
  if (!vaeWeights.some((p) => fileOk(p))) missing.push(`vaeWeights: ${vaeWeights[0]}`)
  const whisperWeights = ['model.safetensors', 'pytorch_model.bin'].map((f) => join(modelsDir, 'whisper', f))
  if (!whisperWeights.some((p) => fileOk(p))) missing.push(`whisperWeights: ${whisperWeights[0]}`)

  const cloudModel = String(process.env.AVATAR_LIPSYNC_CLOUD_MODEL || 'fal-ai/latentsync').trim()
  let cloudExtraInput = {}
  try {
    const rawExtra = String(process.env.AVATAR_LIPSYNC_CLOUD_INPUT_JSON || '').trim()
    if (rawExtra) cloudExtraInput = JSON.parse(rawExtra)
  } catch {}
  const cloud = {
    provider: 'fal',
    endpoint: String(process.env.AVATAR_LIPSYNC_CLOUD_ENDPOINT || 'https://queue.fal.run').trim().replace(/\/+$/, ''),
    model: cloudModel,
    apiKey: String(process.env.AVATAR_LIPSYNC_CLOUD_API_KEY || process.env.FAL_KEY || '').trim(),
    timeoutSec: envNum('AVATAR_LIPSYNC_CLOUD_TIMEOUT_SEC', 900),
    extraInput: cloudExtraInput,
  }

  const latentsyncDir = resolveEnvPath('AVATAR_LIPSYNC_LATENTSYNC_DIR', '')
  const latentsyncPython =
    resolveEnvPath('AVATAR_LIPSYNC_LATENTSYNC_PYTHON', '') ||
    (latentsyncDir ? (isWin ? join(latentsyncDir, '.venv', 'Scripts', 'python.exe') : join(latentsyncDir, '.venv', 'bin', 'python')) : '')
  const cli =
    rawEngine === 'latentsync'
      ? {
          command: latentsyncPython,
          args:
            String(process.env.AVATAR_LIPSYNC_CLI_ARGS || '').trim() ||
            '-m scripts.inference --unet_config_path configs/unet/stage2_512.yaml --inference_ckpt_path checkpoints/latentsync_unet.pt --inference_steps 20 --guidance_scale 1.5 --video_path {video} --audio_path {audio} --video_out_path {output}',
          cwd: latentsyncDir,
          needsVideo: true,
        }
      : {
          command: resolveEnvPath('AVATAR_LIPSYNC_CLI_COMMAND', '') || String(process.env.AVATAR_LIPSYNC_CLI_COMMAND || '').trim(),
          args: String(process.env.AVATAR_LIPSYNC_CLI_ARGS || '').trim(),
          cwd: resolveEnvPath('AVATAR_LIPSYNC_CLI_CWD', ''),
          needsVideo: true,
        }

  const tuning = {
    device: String(process.env.AVATAR_LIPSYNC_DEVICE || 'cuda').trim().toLowerCase() || 'cuda',
    fp16: envBool('AVATAR_LIPSYNC_FP16', true),
    batchSize: Math.max(1, Math.min(64, envNum('AVATAR_LIPSYNC_BATCH_SIZE', 16))),
    fps: Math.max(10, Math.min(60, envNum('AVATAR_LIPSYNC_FPS', 25))),
    maxSide: Math.max(320, Math.min(2160, envNum('AVATAR_LIPSYNC_MAX_SIDE', 1280))),
    maxSourceSec: Math.max(1, Math.min(120, envNum('AVATAR_LIPSYNC_MAX_SOURCE_SEC', 8))),
    extraMargin: envNum('AVATAR_LIPSYNC_EXTRA_MARGIN', 10),
    parsingMode: String(process.env.AVATAR_LIPSYNC_PARSING_MODE || 'jaw').trim() || 'jaw',
    cheekWidth: envNum('AVATAR_LIPSYNC_CHEEK_WIDTH', 90),
    smooth: Math.max(1, envNum('AVATAR_LIPSYNC_BBOX_SMOOTH', 5)),
    timeoutSec: envNum('AVATAR_LIPSYNC_TIMEOUT_SEC', 0),
    minFreeVramMb: envNum('AVATAR_LIPSYNC_MIN_FREE_VRAM_MB', 4500),
    freeTtsVram: String(process.env.AVATAR_LIPSYNC_FREE_TTS_VRAM || 'auto').trim().toLowerCase(),
  }

  const musetalkInstalled = missing.length === 0
  let engine = rawEngine
  if (!LIPSYNC_ENGINE_IDS.includes(engine)) engine = 'auto'
  if (engine === 'auto') {
    engine = musetalkInstalled ? 'musetalk' : cloud.apiKey ? 'cloud-fal' : 'off'
  }

  return {
    rawEngine,
    engine,
    home,
    manifest,
    musetalk: {
      dir: musetalkDir,
      python,
      wrapper,
      torchHome,
      cacheDir: manifest?.cacheDir || join(dirname(home), '.cache'),
      installed: musetalkInstalled,
      missing,
    },
    cloud,
    cli,
    tuning,
    fallback: String(process.env.AVATAR_LIPSYNC_FALLBACK || 'composite').trim().toLowerCase(),
  }
}

/** Extra DLL / PATH dirs for venv-on-conda interpreters (mirrors tts-server-manager). */
function collectPythonPathDirs(pythonExe) {
  const pyDir = dirname(pythonExe)
  const pyRoot = existsSync(join(pyDir, 'python.exe')) && !/scripts$/i.test(pyDir) ? pyDir : dirname(pyDir)
  const dirs = [pyDir, pyRoot, join(pyRoot, 'Scripts'), join(pyRoot, 'Library', 'bin')]
  const cfgPath = join(pyRoot, 'pyvenv.cfg')
  if (existsSync(cfgPath)) {
    try {
      const m = /^home\s*=\s*(.+)$/im.exec(readFileSync(cfgPath, 'utf8'))
      if (m && m[1]) {
        const baseHome = m[1].trim()
        dirs.push(baseHome, join(baseHome, 'Scripts'), join(baseHome, 'Library', 'bin'), join(baseHome, 'Lib', 'site-packages', 'torch', 'lib'))
      }
    } catch {}
  }
  return dirs.filter((d) => d && existsSync(d))
}

function buildPythonEnv(cfg, extra = {}) {
  const tmp = join(REPO_ROOT, '.tmp')
  mkdirSync(tmp, { recursive: true })
  const pathSep = process.platform === 'win32' ? ';' : ':'
  const { ffmpeg } = resolveBinaries()
  const ffDir = ffmpeg && isAbsolute(ffmpeg) ? dirname(ffmpeg) : ''
  return {
    ...process.env,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONNOUSERSITE: '1',
    PYTHONHOME: '',
    PYTHONPATH: '',
    TORCH_HOME: cfg.musetalk.torchHome,
    HF_HOME: join(cfg.musetalk.cacheDir, 'hf'),
    CUDA_CACHE_PATH: join(cfg.musetalk.cacheDir, 'nv-compute'),
    CUDA_CACHE_MAXSIZE: process.env.CUDA_CACHE_MAXSIZE || '2147483648',
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    DIFFUSERS_OFFLINE: '1',
    TQDM_DISABLE: '1',
    PYTORCH_CUDA_ALLOC_CONF: process.env.PYTORCH_CUDA_ALLOC_CONF || 'expandable_segments:True',
    TEMP: tmp,
    TMP: tmp,
    TMPDIR: tmp,
    PATH: [...collectPythonPathDirs(cfg.musetalk.python), ffDir, process.env.PATH || process.env.Path || ''].filter(Boolean).join(pathSep),
    ...extra,
  }
}

/**
 * Spawn a process with file-redirected stdio (Windows sandbox safe) and tail its stdout for JSON lines.
 */
function spawnTailed(bin, args, { cwd, env, timeoutMs = 600_000, signal, onStdoutLine, logFile } = {}) {
  if (signal?.aborted) return Promise.reject(createAbortError())
  const tmp = join(REPO_ROOT, '.tmp')
  mkdirSync(tmp, { recursive: true })
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const outFile = join(tmp, `lipsync-${id}.stdout.log`)
  const errFile = logFile || join(tmp, `lipsync-${id}.stderr.log`)
  return new Promise((resolvePromise, rejectPromise) => {
    let outFd
    let errFd
    try {
      outFd = openSync(outFile, 'w')
      errFd = openSync(errFile, 'w')
    } catch (err) {
      rejectPromise(err)
      return
    }
    let settled = false
    let readPos = 0
    let lineBuf = ''
    const pump = () => {
      try {
        const fd = openSync(outFile, 'r')
        try {
          const size = statSync(outFile).size
          if (size > readPos) {
            const buf = Buffer.alloc(size - readPos)
            readSync(fd, buf, 0, buf.length, readPos)
            readPos = size
            lineBuf += buf.toString('utf8')
            const parts = lineBuf.split(/\r?\n/)
            lineBuf = parts.pop() || ''
            for (const ln of parts) if (ln.trim()) onStdoutLine?.(ln.trim())
          }
        } finally {
          closeSync(fd)
        }
      } catch {}
    }
    const child = spawn(bin, args, { cwd, env, stdio: ['ignore', outFd, errFd], windowsHide: true })
    const poll = setInterval(pump, 400)
    const finish = (fn) => {
      if (settled) return
      settled = true
      clearInterval(poll)
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      try { closeSync(outFd) } catch {}
      try { closeSync(errFd) } catch {}
      pump()
      if (lineBuf.trim()) {
        onStdoutLine?.(lineBuf.trim())
        lineBuf = ''
      }
      let stderr = ''
      try { stderr = readFileSync(errFile, 'utf8') } catch {}
      try { rmSync(outFile, { force: true }) } catch {}
      if (!logFile) {
        try { rmSync(errFile, { force: true }) } catch {}
      }
      fn(stderr)
    }
    const onAbort = () => {
      killProcessTree(child)
      finish(() => rejectPromise(createAbortError('唇形同步子进程已响应停止指令并终止')))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
    const timer = setTimeout(() => {
      killProcessTree(child)
      finish((stderr) => rejectPromise(new Error(`唇形同步超时 (${Math.round(timeoutMs / 1000)}s)\n${stderr.slice(-1500)}`)))
    }, timeoutMs)
    child.on('error', (err) => finish(() => rejectPromise(err)))
    child.on('close', (code) => finish((stderr) => resolvePromise({ code: code ?? 0, stderr })))
  })
}

// ---------------------------------------------------------------------------
// GPU / VRAM helpers
// ---------------------------------------------------------------------------

export async function queryGpuMemory() {
  try {
    const res = await runCommandRedirected(
      'nvidia-smi',
      ['--query-gpu=name,memory.used,memory.free,memory.total', '--format=csv,noheader,nounits'],
      { timeoutMs: 10_000 },
    )
    if (res.code !== 0) return null
    const line = res.stdout.trim().split(/\r?\n/)[0] || ''
    const [name, used, free, total] = line.split(',').map((s) => s.trim())
    return { name, usedMb: Number(used), freeMb: Number(free), totalMb: Number(total) }
  } catch {
    return null
  }
}

let ttsManagerPromise = null
async function loadTtsManager() {
  if (!ttsManagerPromise) {
    ttsManagerPromise = import('../dsh-tool-local-tts/tts-server-manager.js').catch(() => null)
  }
  return ttsManagerPromise
}

/**
 * Free VRAM for lip-sync according to AVATAR_LIPSYNC_FREE_TTS_VRAM (auto | always | never).
 * Returns a restore() function that brings the TTS server back (non-blocking) when we stopped it.
 */
async function ensureVramForLipsync(cfg, onProgress) {
  const policy = cfg.tuning.freeTtsVram
  const noop = { stoppedTts: false, restore: async () => {}, before: null }
  if (cfg.tuning.device !== 'cuda' || policy === 'never') return noop
  const before = await queryGpuMemory()
  const needStop = policy === 'always' || (before && before.freeMb < cfg.tuning.minFreeVramMb)
  if (!needStop) return { ...noop, before }
  const mgr = await loadTtsManager()
  if (!mgr?.stopTtsServer) return { ...noop, before }
  const stopped = await mgr.stopTtsServer().catch(() => ({ stopped: false }))
  if (!stopped?.stopped) return { ...noop, before }
  onProgress?.({
    stage: 'lipsync-vram',
    message: `显存仅剩 ${before?.freeMb ?? '?'} MB，已暂停本地 TTS 服务 (PID ${stopped.pid}) 为唇形同步腾出显存`,
  })
  await new Promise((r) => setTimeout(r, 1500))
  return {
    stoppedTts: true,
    before,
    ttsPid: stopped.pid,
    restore: async () => {
      try {
        // Re-launch in the background; the next speech request also awaits readiness on demand.
        mgr.ensureTtsServer?.({ waitMs: 300_000 }).catch(() => {})
      } catch {}
    },
  }
}

// ---------------------------------------------------------------------------
// Status / doctor
// ---------------------------------------------------------------------------

let doctorCache = { key: '', at: 0, value: null }

async function runMusetalkDoctor(cfg) {
  const m = cfg.musetalk
  const r = await runCommandRedirected(
    m.python,
    ['-I', m.wrapper, '--doctor', '--engine-root', m.dir, '--device', cfg.tuning.device],
    { cwd: m.dir, env: buildPythonEnv(cfg), timeoutMs: 180_000 },
  ).catch((err) => ({ code: -1, stdout: '', stderr: err.message }))
  const last = String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || ''
  try {
    return JSON.parse(last)
  } catch {
    return { ok: false, error: `doctor exit ${r.code}: ${(r.stderr || r.stdout || '').trim().slice(-800)}` }
  }
}

/**
 * Report whether the configured lip-sync engine is ready. `deep` runs the Python doctor (imports + CUDA + VRAM).
 */
export async function getLipsyncStatus({ deep = false, force = false, overrides = {} } = {}) {
  const cfg = resolveLipsyncConfig(overrides)
  const base = {
    engine: cfg.engine,
    configuredEngine: cfg.rawEngine,
    home: cfg.home,
    ready: false,
    reason: '',
    inputKinds: [],
    fallback: cfg.fallback,
    installHint: 'node scripts/install-lipsync-engine.mjs --engine musetalk --dir <安装目录> --mirror cn',
    tuning: cfg.tuning,
  }
  if (cfg.engine === 'off') {
    return {
      ...base,
      reason:
        cfg.rawEngine === 'off'
          ? '唇形同步已关闭 (AVATAR_LIPSYNC_ENGINE=off)，克隆真人将使用无口型合成叠层'
          : '未安装本地唇形引擎且未配置云端密钥，克隆真人将使用无口型合成叠层',
      musetalk: { installed: cfg.musetalk.installed, missing: cfg.musetalk.missing.slice(0, 6), dir: cfg.musetalk.dir },
    }
  }
  if (cfg.engine === 'musetalk') {
    const m = cfg.musetalk
    const mf = cfg.manifest || {}
    const out = {
      ...base,
      inputKinds: ['video', 'image'],
      musetalk: {
        dir: m.dir,
        python: m.python,
        torchHome: m.torchHome,
        installed: m.installed,
        missing: m.missing,
        version: mf.version || '',
        repoCommit: mf.repoCommit || '',
        installedAt: mf.installedAt || '',
        torchSource: mf.torchSource || null,
        fp16UnetCache: existsSync(join(m.dir, 'models', 'musetalkV15', 'unet_fp16.safetensors')),
      },
    }
    if (!m.installed) {
      return { ...out, reason: `MuseTalk 未安装或文件缺失 (${m.missing.length} 项)：${m.missing.slice(0, 3).join('; ')}` }
    }
    if (!deep) return { ...out, ready: true, reason: 'MuseTalk 1.5 文件齐全（快速检查，未加载模型）', depth: 'quick' }
    const key = `${m.python}|${m.dir}|${cfg.tuning.device}`
    if (!force && doctorCache.key === key && Date.now() - doctorCache.at < 60_000 && doctorCache.value) {
      return { ...out, ...doctorCache.value, depth: 'deep-cached' }
    }
    const doc = await runMusetalkDoctor(cfg)
    const gpu = await queryGpuMemory()
    const value = {
      ready: Boolean(doc?.ok),
      reason: doc?.ok
        ? `MuseTalk 1.5 就绪 · ${doc?.cuda?.device || 'CPU'} · torch ${doc?.versions?.torch || '?'}`
        : `MuseTalk 自检失败：${doc?.error || (doc?.checks || []).filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; ') || '未知错误'}`,
      doctor: doc,
      gpu,
    }
    doctorCache = { key, at: Date.now(), value }
    return { ...out, ...value, depth: 'deep' }
  }
  if (cfg.engine === 'cloud-fal') {
    return {
      ...base,
      inputKinds: ['video', 'image'],
      ready: Boolean(cfg.cloud.apiKey),
      reason: cfg.cloud.apiKey
        ? `fal.ai 云端唇形同步就绪 (${cfg.cloud.model})`
        : '未配置 fal.ai 密钥 (AVATAR_LIPSYNC_CLOUD_API_KEY 或 FAL_KEY)',
      cloud: { provider: 'fal', endpoint: cfg.cloud.endpoint, model: cfg.cloud.model, hasApiKey: Boolean(cfg.cloud.apiKey) },
    }
  }
  // cli / latentsync
  const cmdOk = Boolean(cfg.cli.command) && (!isAbsolute(cfg.cli.command) || existsSync(cfg.cli.command))
  return {
    ...base,
    inputKinds: ['video', 'image'],
    ready: cmdOk && Boolean(cfg.cli.args),
    reason: cmdOk
      ? `${cfg.engine === 'latentsync' ? 'LatentSync' : '自定义命令行'}唇形引擎已配置: ${cfg.cli.command}`
      : `${cfg.engine === 'latentsync' ? 'LatentSync (AVATAR_LIPSYNC_LATENTSYNC_DIR)' : 'AVATAR_LIPSYNC_CLI_COMMAND'} 未配置或不存在`,
    cli: { command: cfg.cli.command, args: cfg.cli.args, cwd: cfg.cli.cwd },
  }
}

// ---------------------------------------------------------------------------
// Media helpers
// ---------------------------------------------------------------------------

/**
 * Build a gentle-motion base clip (slow breathing zoom + tiny drift) from a portrait photo.
 */
export async function buildPhotoBaseClip({ imagePath, durationSec, outPath, fps = 25, maxSide = 1280, signal }) {
  const { ffmpeg, ffprobe } = resolveBinaries()
  mkdirSync(dirname(outPath), { recursive: true })
  const frames = Math.max(fps, Math.ceil(durationSec * fps))
  const dims = await runCommandRedirected(
    ffprobe,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', imagePath],
    { timeoutMs: 20_000, signal },
  )
  const [w0, h0] = String(dims.stdout || '').trim().split(',').map(Number)
  const scale = Math.min(1, maxSide / Math.max(w0 || 720, h0 || 960))
  const w = Math.max(2, Math.round(((w0 || 720) * scale) / 2) * 2)
  const h = Math.max(2, Math.round(((h0 || 960) * scale) / 2) * 2)
  // Slow breathing zoom (6 s period) + sub-percent drift so a still portrait reads as a live camera shot
  const vf =
    `scale=${w}:${h},` +
    `zoompan=z='1.03+0.02*sin(2*PI*on/(${fps}*6))'` +
    `:x='iw/2-(iw/zoom/2)+iw*0.004*sin(2*PI*on/(${fps}*7.3))'` +
    `:y='ih/2-(ih/zoom/2)+ih*0.003*sin(2*PI*on/(${fps}*5.1))'` +
    `:d=1:s=${w}x${h}:fps=${fps}`
  const res = await runCommandRedirected(
    ffmpeg,
    ['-y', '-loop', '1', '-i', imagePath, '-vf', vf, '-frames:v', String(frames), '-r', String(fps), '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', outPath],
    { timeoutMs: 180_000, signal },
  )
  if (res.code !== 0 || !existsSync(outPath)) throw new Error(`人像底板动效生成失败: ${res.stderr.slice(-400)}`)
  return outPath
}

async function transcodeForUpload({ srcPath, durationSec, outPath, signal }) {
  const { ffmpeg } = resolveBinaries()
  const res = await runCommandRedirected(
    ffmpeg,
    [
      '-y', '-stream_loop', '-1', '-i', srcPath,
      '-t', String(Math.max(1, durationSec).toFixed(3)),
      '-vf', "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',fps=25",
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', outPath,
    ],
    { timeoutMs: 300_000, signal },
  )
  if (res.code !== 0 || !existsSync(outPath)) throw new Error(`云端上传前转码失败: ${res.stderr.slice(-300)}`)
  return outPath
}

/** Mux the original (timeline) audio back onto an engine output so every engine returns identical audio. */
async function remuxWithAudio({ videoPath, audioPath, outPath, durationSec, signal }) {
  const { ffmpeg } = resolveBinaries()
  const res = await runCommandRedirected(
    ffmpeg,
    [
      '-y', '-i', videoPath, '-i', audioPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-t', Number(durationSec).toFixed(3),
      outPath,
    ],
    { timeoutMs: 180_000, signal },
  )
  if (res.code !== 0 || !existsSync(outPath)) throw new Error(`音视频重新封装失败: ${res.stderr.slice(-300)}`)
  return outPath
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

async function runMusetalkLocal(cfg, { sourcePath, audioPath, outputPath, audioSec, isImage, signal, onProgress, logFile }) {
  const m = cfg.musetalk
  if (!m.installed) {
    throw new LipsyncUnavailableError(`MuseTalk 未安装：${m.missing.slice(0, 2).join('; ')}`, { code: 'NOT_INSTALLED', missing: m.missing })
  }
  const { ffmpeg } = resolveBinaries()
  const t = cfg.tuning
  const args = [
    '-I', m.wrapper,
    '--engine-root', m.dir,
    '--source', sourcePath,
    '--audio', audioPath,
    '--output', outputPath,
    '--fps', String(t.fps),
    '--batch-size', String(t.batchSize),
    '--device', t.device,
    '--max-side', String(t.maxSide),
    '--max-source-sec', String(t.maxSourceSec),
    '--extra-margin', String(t.extraMargin),
    '--parsing-mode', t.parsingMode,
    '--cheek-width', String(t.cheekWidth),
    '--smooth', String(t.smooth),
    '--ffmpeg', ffmpeg,
  ]
  if (t.fp16) args.push('--fp16')
  if (isImage) args.push('--source-is-image')
  const timeoutMs = (t.timeoutSec > 0 ? t.timeoutSec : Math.max(240, 150 + audioSec * 14)) * 1000

  const vram = await ensureVramForLipsync(cfg, onProgress)
  let resultEvt = null
  let errorEvt = null
  const t0 = Date.now()
  try {
    const run = await spawnTailed(m.python, args, {
      cwd: m.dir,
      env: buildPythonEnv(cfg),
      timeoutMs,
      signal,
      logFile,
      onStdoutLine: (line) => {
        let evt = null
        try {
          evt = JSON.parse(line)
        } catch {
          return
        }
        if (evt.event === 'progress') {
          onProgress?.({ stage: `lipsync-${evt.stage}`, pct: Number(evt.pct) || 0, message: evt.message })
        } else if (evt.event === 'result') {
          resultEvt = evt
        } else if (evt.event === 'error') {
          errorEvt = evt
        }
      },
    })
    // Windows: CUDA / PyTorch can crash during interpreter teardown (e.g. 0xC0000409) AFTER the result was written.
    // A completed `result` event + a non-empty output file is authoritative; the exit status is then only logged.
    const resultComplete = Boolean(resultEvt?.ok) && !errorEvt && fileOk(outputPath, 1024)
    if (run.code !== 0 && resultComplete) {
      onProgress?.({ stage: 'lipsync-exit', pct: 100, message: `推理进程退出时异常 (exit ${run.code})，但结果已完整写出，已采用` })
    }
    if (!resultComplete && (run.code !== 0 || !resultEvt || !existsSync(outputPath))) {
      const msg = errorEvt?.message || run.stderr.trim().split(/\r?\n/).slice(-6).join(' | ') || `exit ${run.code}`
      const err = new Error(`MuseTalk 唇形同步失败 [${errorEvt?.code || `exit ${run.code}`}]: ${msg}`)
      err.code = errorEvt?.code || 'MUSETALK_FAILED'
      throw err
    }
  } finally {
    if (vram.stoppedTts) await vram.restore()
  }
  return {
    ok: true,
    engine: 'musetalk',
    outputPath,
    wallSec: Number(((Date.now() - t0) / 1000).toFixed(2)),
    metrics: resultEvt,
    vram: { before: vram.before, stoppedTts: vram.stoppedTts, ttsPid: vram.ttsPid || null },
  }
}

function fillTemplate(tmpl, vars) {
  const tokens = []
  const rx = /"([^"]*)"|'([^']*)'|(\S+)/g
  let mm
  while ((mm = rx.exec(String(tmpl || ''))) !== null) {
    const tok = mm[1] !== undefined ? mm[1] : mm[2] !== undefined ? mm[2] : mm[3]
    tokens.push(tok.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`)))
  }
  return tokens
}

async function runCliEngine(cfg, { sourcePath, audioPath, outputPath, audioSec, isImage, signal, onProgress, workDir }) {
  const cli = cfg.cli
  if (!cli.command || !cli.args) {
    throw new LipsyncUnavailableError('命令行唇形引擎未配置 (AVATAR_LIPSYNC_CLI_COMMAND / AVATAR_LIPSYNC_CLI_ARGS)', { code: 'NOT_CONFIGURED' })
  }
  let videoIn = sourcePath
  if (isImage) {
    onProgress?.({ stage: 'lipsync-prepare', pct: 5, message: '正在将人像照片生成轻微动态底板视频...' })
    videoIn = await buildPhotoBaseClip({ imagePath: sourcePath, durationSec: Math.min(audioSec, 8), outPath: join(workDir, 'photo-base.mp4'), signal })
  }
  const rawOut = join(workDir, `cli-raw${extname(outputPath) || '.mp4'}`)
  const args = fillTemplate(cli.args, { video: videoIn, audio: audioPath, output: rawOut, fps: cfg.tuning.fps })
  onProgress?.({ stage: 'lipsync-infer', pct: 20, message: `正在调用 ${cfg.engine === 'latentsync' ? 'LatentSync' : '自定义'} 唇形引擎...` })
  const t0 = Date.now()
  const run = await spawnTailed(cli.command, args, {
    cwd: cli.cwd && existsSync(cli.cwd) ? cli.cwd : REPO_ROOT,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    timeoutMs: (cfg.tuning.timeoutSec > 0 ? cfg.tuning.timeoutSec : Math.max(600, 300 + audioSec * 60)) * 1000,
    signal,
    onStdoutLine: (l) => onProgress?.({ stage: 'lipsync-infer', message: l.slice(0, 160) }),
  })
  if (run.code !== 0 || !existsSync(rawOut)) {
    throw new Error(`命令行唇形引擎失败 (exit ${run.code}): ${run.stderr.slice(-600)}`)
  }
  await remuxWithAudio({ videoPath: rawOut, audioPath, outPath: outputPath, durationSec: audioSec, signal })
  return { ok: true, engine: cfg.engine, outputPath, wallSec: Number(((Date.now() - t0) / 1000).toFixed(2)), metrics: null }
}

const FAL_MODEL_DEFAULT_INPUT = {
  'fal-ai/latentsync': { loop_mode: 'pingpong' },
  'fal-ai/sync-lipsync': { sync_mode: 'bounce' },
  'fal-ai/sync-lipsync/v2': { sync_mode: 'bounce' },
  'fal-ai/sync-lipsync/v2/pro': { sync_mode: 'bounce' },
}

async function falFetchJson(url, { method = 'GET', apiKey, body, signal }) {
  const resp = await fetch(url, {
    method,
    headers: { Authorization: `Key ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
  const text = await resp.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {}
  if (!resp.ok && resp.status !== 202) {
    const err = new Error(`fal.ai HTTP ${resp.status}: ${(data?.detail ? JSON.stringify(data.detail) : text).slice(0, 300)}`)
    err.status = resp.status
    throw err
  }
  return data || {}
}

async function runFalCloud(cfg, { sourcePath, audioPath, outputPath, audioSec, isImage, signal, onProgress, workDir }) {
  const c = cfg.cloud
  if (!c.apiKey) throw new LipsyncUnavailableError('未配置 fal.ai 密钥 (AVATAR_LIPSYNC_CLOUD_API_KEY / FAL_KEY)', { code: 'NO_API_KEY' })
  onProgress?.({ stage: 'lipsync-upload', pct: 5, message: `正在准备上传至 fal.ai (${c.model})...` })
  const baseVideo = isImage
    ? await buildPhotoBaseClip({ imagePath: sourcePath, durationSec: Math.min(audioSec, 8), outPath: join(workDir, 'photo-base.mp4'), signal })
    : sourcePath
  const upVideo = await transcodeForUpload({ srcPath: baseVideo, durationSec: audioSec, outPath: join(workDir, 'cloud-src.mp4'), signal })
  const { ffmpeg } = resolveBinaries()
  const upAudio = join(workDir, 'cloud-audio.mp3')
  const ar = await runCommandRedirected(ffmpeg, ['-y', '-i', audioPath, '-ac', '1', '-ar', '44100', '-b:a', '160k', upAudio], { timeoutMs: 60_000, signal })
  if (ar.code !== 0) throw new Error(`云端音频转码失败: ${ar.stderr.slice(-300)}`)
  const vidB64 = readFileSync(upVideo).toString('base64')
  const audB64 = readFileSync(upAudio).toString('base64')
  if (vidB64.length + audB64.length > 60 * 1024 * 1024) {
    throw new Error(`上传数据过大 (${((vidB64.length + audB64.length) / 1024 / 1024).toFixed(1)} MB base64)，请缩短口播或降低分辨率`)
  }
  const input = {
    video_url: `data:video/mp4;base64,${vidB64}`,
    audio_url: `data:audio/mpeg;base64,${audB64}`,
    ...(FAL_MODEL_DEFAULT_INPUT[c.model] || {}),
    ...(c.extraInput || {}),
  }
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  signal?.addEventListener?.('abort', onAbort, { once: true })
  const deadline = Date.now() + c.timeoutSec * 1000
  let submit = null
  const t0 = Date.now()
  try {
    submit = await falFetchJson(`${c.endpoint}/${c.model}`, { method: 'POST', apiKey: c.apiKey, body: input, signal: ctrl.signal })
    const requestId = submit.request_id
    if (!requestId) throw new Error(`fal.ai 未返回 request_id: ${JSON.stringify(submit).slice(0, 200)}`)
    const [owner, app] = c.model.split('/')
    const statusUrl = submit.status_url || `${c.endpoint}/${owner}/${app}/requests/${requestId}/status`
    const responseUrl = submit.response_url || `${c.endpoint}/${owner}/${app}/requests/${requestId}`
    onProgress?.({ stage: 'lipsync-cloud', pct: 20, message: `fal.ai 任务已提交 (${requestId})，排队中...` })
    while (true) {
      if (signal?.aborted) throw createAbortError()
      if (Date.now() > deadline) throw new Error(`fal.ai 唇形同步超时 (${c.timeoutSec}s)`)
      await new Promise((r) => setTimeout(r, 3000))
      const st = await falFetchJson(`${statusUrl}${statusUrl.includes('?') ? '&' : '?'}logs=0`, { apiKey: c.apiKey, signal: ctrl.signal })
      if (st.status === 'COMPLETED') {
        if (st.error) throw new Error(`fal.ai 任务失败: ${st.error}`)
        break
      }
      const elapsed = Math.round((Date.now() - t0) / 1000)
      onProgress?.({
        stage: 'lipsync-cloud',
        pct: st.status === 'IN_PROGRESS' ? Math.min(85, 30 + elapsed) : 22,
        message: st.status === 'IN_QUEUE' ? `fal.ai 排队中 (位置 ${st.queue_position ?? '?'})...` : `fal.ai 云端唇形同步中 (${elapsed}s)...`,
      })
    }
    const result = await falFetchJson(responseUrl, { apiKey: c.apiKey, signal: ctrl.signal })
    const videoUrl = result?.video?.url || result?.output?.video?.url || result?.data?.video?.url
    if (!videoUrl) throw new Error(`fal.ai 返回中未找到 video.url: ${JSON.stringify(result).slice(0, 240)}`)
    onProgress?.({ stage: 'lipsync-download', pct: 90, message: '正在下载云端唇形同步结果...' })
    const dl = await fetch(videoUrl, { signal: ctrl.signal })
    if (!dl.ok) throw new Error(`下载 fal.ai 结果失败 HTTP ${dl.status}`)
    const rawOut = join(workDir, 'cloud-raw.mp4')
    writeFileSync(rawOut, Buffer.from(await dl.arrayBuffer()))
    await remuxWithAudio({ videoPath: rawOut, audioPath, outPath: outputPath, durationSec: audioSec, signal })
    return {
      ok: true,
      engine: `cloud-fal:${c.model}`,
      outputPath,
      wallSec: Number(((Date.now() - t0) / 1000).toFixed(2)),
      metrics: { requestId, inferenceTimeSec: result?.metrics?.inference_time || null },
    }
  } catch (err) {
    if (signal?.aborted && submit?.cancel_url) {
      try {
        await fetch(submit.cancel_url, { method: 'PUT', headers: { Authorization: `Key ${c.apiKey}` } })
      } catch {}
    }
    if (signal?.aborted) throw createAbortError()
    throw err
  } finally {
    signal?.removeEventListener?.('abort', onAbort)
  }
}

/**
 * Lip-sync a person video (or portrait photo) to an audio track.
 * Resolves to `{ ok, engine, outputPath, wallSec, metrics }` (H.264 MP4 with the given audio, exact audio duration).
 * Throws LipsyncUnavailableError when no engine is usable, or Error/AbortError on failures.
 */
export async function runLipsync({
  sourcePath,
  audioPath,
  outputPath,
  engine = '',
  isImage,
  signal,
  onProgress,
  keepWorkDir = false,
  logFile = '',
} = {}) {
  const cfg = resolveLipsyncConfig(engine ? { engine } : {})
  if (cfg.engine === 'off') {
    throw new LipsyncUnavailableError(
      cfg.rawEngine === 'off' ? '唇形同步已关闭 (AVATAR_LIPSYNC_ENGINE=off)' : '未安装本地唇形引擎 (MuseTalk) 且未配置云端密钥',
      { code: cfg.rawEngine === 'off' ? 'DISABLED' : 'NOT_INSTALLED', missing: cfg.musetalk.missing },
    )
  }
  if (!sourcePath || !existsSync(sourcePath)) throw new Error(`唇形同步源素材不存在: ${sourcePath}`)
  if (!audioPath || !existsSync(audioPath)) throw new Error(`唇形同步驱动音频不存在: ${audioPath}`)
  const audioMeta = await probeAudioDuration(audioPath, cfg.tuning.fps)
  const audioSec = Number(audioMeta.durationSec) || 0
  if (audioSec <= 0.2) throw new Error('驱动音频过短，无法唇形同步')
  const imageInput = isImage ?? IMAGE_EXT_RX.test(sourcePath)
  const workDir = join(REPO_ROOT, '.tmp', `lipsync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)
  mkdirSync(workDir, { recursive: true })
  mkdirSync(dirname(outputPath), { recursive: true })
  const ctx = { sourcePath, audioPath, outputPath, audioSec, isImage: imageInput, signal, onProgress, workDir, logFile }
  try {
    let res
    if (cfg.engine === 'musetalk') res = await runMusetalkLocal(cfg, ctx)
    else if (cfg.engine === 'cloud-fal') res = await runFalCloud(cfg, ctx)
    else res = await runCliEngine(cfg, ctx)
    const outMeta = await probeAudioDuration(outputPath, cfg.tuning.fps).catch(() => ({ durationSec: 0 }))
    return {
      ...res,
      audioSec,
      outputDurationSec: Number(outMeta.durationSec) || 0,
      durationDeltaMs: Math.round(((Number(outMeta.durationSec) || 0) - audioSec) * 1000),
      inputKind: imageInput ? 'image' : 'video',
      sourceName: basename(sourcePath),
    }
  } finally {
    if (!keepWorkDir) {
      try { rmSync(workDir, { recursive: true, force: true }) } catch {}
    }
  }
}
