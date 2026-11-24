/**
 * @dsh-video/tool-avatar — Optional One-Click Local Lip-Sync Engine Installer (MuseTalk 1.5)
 *
 * - Official sources only: GitHub (TMElyralab/MuseTalk), official Hugging Face model repos, PyPI.
 * - Optional CN mirror (hf-mirror.com + Tsinghua PyPI).
 * - Reuses an existing CUDA PyTorch (e.g. the IndexTTS-2.5 base interpreter) instead of downloading ~3 GB again.
 * - Every cache (uv / pip / HF / torch hub / temp) is kept under the install base, never on the system drive by default.
 * - Writes `<home>/lipsync-engine.json` and (optionally) `AVATAR_LIPSYNC_*` keys into `.env`.
 */
import { spawn } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { loadEnv, REPO_ROOT, resolveEnvPath } from '../shared/index.js'
import { getLipsyncStatus, resolveLipsyncConfig } from './lipsync-engine.js'

export const LIPSYNC_INSTALLER_PACKAGES = [
  {
    id: 'musetalk',
    name: 'MuseTalk 1.5 实时唇形同步引擎（腾讯音乐 Lyra Lab · 代码 MIT）',
    shortName: 'MuseTalk 1.5',
    vramRequired: '≥4 GB NVIDIA 显存（fp16，可与 IndexTTS-2.5 同时驻留 12 GB 显卡）',
    diskRequired: '~4.5 GB（含模型权重；复用已有 CUDA PyTorch 时无需再下载 ~3 GB torch）',
    etaLabel: '约 5~20 分钟（视网速）',
    inputKinds: ['video', 'image'],
    repoUrl: 'https://github.com/TMElyralab/MuseTalk.git',
    licenseNote: '代码 MIT；权重 README 声明可商用，NOTICE 提示训练集含 HDTF，商用前请自行确认数据授权。',
  },
]

// Pinned, Windows-friendly (no mmcv / mmpose / compiler) extra packages on top of a CUDA PyTorch.
// DWPose (mmpose) landmarks are replaced by face-alignment (FAN, pure PyTorch) inside scripts/avatar/musetalk_infer.py.
export const MUSETALK_EXTRA_PACKAGES = [
  'diffusers==0.35.2',
  'opencv-python-headless==4.10.0.84',
  'face-alignment==1.4.1',
  'scikit-image==0.25.2',
  'imageio==2.37.0',
  'tifffile==2024.8.30',
  'python_speech_features==0.6',
]

// Only used when no reusable CUDA PyTorch is found (fresh environment, ~3 GB torch download).
export const MUSETALK_FRESH_BASE_PACKAGES = [
  'numpy<2',
  'scipy',
  'transformers==4.52.4',
  'tokenizers',
  'huggingface-hub>=0.34,<1',
  'safetensors',
  'librosa==0.11.0',
  'soundfile',
  'numba',
  'einops',
  'omegaconf',
  'tqdm',
  'requests',
  'Pillow',
  'packaging',
  'networkx',
  'lazy-loader',
  'psutil',
  'nvidia-ml-py',
]

/**
 * Model weights, all from official Hugging Face model repos (MuseTalk's own download script uses
 * `ManyOtherFunctions/face-parse-bisent` for the BiSeNet face parser). `root` is relative to:
 *   - 'models'   -> <MuseTalk>/models
 *   - 'torchHub' -> <TORCH_HOME>/hub/checkpoints (face-alignment / S3FD lookup location)
 *   - 'eval'     -> <home>/eval (optional SyncNet evaluation weights)
 */
export const MUSETALK_WEIGHTS = [
  { repo: 'TMElyralab/MuseTalk', file: 'musetalkV15/musetalk.json', root: 'models', rel: 'musetalkV15/musetalk.json' },
  { repo: 'TMElyralab/MuseTalk', file: 'musetalkV15/unet.pth', root: 'models', rel: 'musetalkV15/unet.pth', approxMb: 3400 },
  { repo: 'stabilityai/sd-vae-ft-mse', file: 'config.json', root: 'models', rel: 'sd-vae/config.json' },
  { repo: 'stabilityai/sd-vae-ft-mse', file: 'diffusion_pytorch_model.safetensors', root: 'models', rel: 'sd-vae/diffusion_pytorch_model.safetensors', approxMb: 335 },
  { repo: 'openai/whisper-tiny', file: 'config.json', root: 'models', rel: 'whisper/config.json' },
  { repo: 'openai/whisper-tiny', file: 'model.safetensors', root: 'models', rel: 'whisper/model.safetensors', approxMb: 151 },
  { repo: 'openai/whisper-tiny', file: 'preprocessor_config.json', root: 'models', rel: 'whisper/preprocessor_config.json' },
  { repo: 'ManyOtherFunctions/face-parse-bisent', file: '79999_iter.pth', root: 'models', rel: 'face-parse-bisent/79999_iter.pth', approxMb: 53 },
  { repo: 'ManyOtherFunctions/face-parse-bisent', file: 'resnet18-5c106cde.pth', root: 'models', rel: 'face-parse-bisent/resnet18-5c106cde.pth', approxMb: 47 },
  { repo: 'ByteDance/LatentSync', file: 'auxiliary/s3fd-619a316812.pth', root: 'torchHub', rel: 's3fd-619a316812.pth', approxMb: 90 },
  { repo: 'ByteDance/LatentSync', file: 'auxiliary/2DFAN4-cd938726ad.zip', root: 'torchHub', rel: '2DFAN4-cd938726ad.zip', approxMb: 96 },
  { repo: 'ByteDance/LatentSync', file: 'auxiliary/syncnet_v2.model', root: 'eval', rel: 'syncnet_v2.model', approxMb: 55, optional: 'eval' },
]

export function getLipsyncInstallerCatalog() {
  const cfg = resolveLipsyncConfig()
  return {
    defaultHome: cfg.home,
    configuredEngine: cfg.engine,
    packages: LIPSYNC_INSTALLER_PACKAGES.map((pkg) => ({
      ...pkg,
      installed: pkg.id === 'musetalk' ? Boolean(cfg.musetalk.installed) : false,
      defaultDir: cfg.home,
    })),
  }
}

function resolveDotEnvPath() {
  loadEnv()
  const explicit = String(process.env.DSH_VIDEO_ENV_PATH || '').trim()
  return explicit ? resolve(explicit) : join(REPO_ROOT, '.env')
}

/** Upsert `KEY=value` lines into the active `.env` without touching any other line. */
export function upsertDotEnvKeys(patch = {}, envPath = resolveDotEnvPath()) {
  let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const written = []
  for (const [key, rawVal] of Object.entries(patch)) {
    if (rawVal === undefined || rawVal === null || rawVal === '') continue
    const val = String(rawVal).replace(/\\/g, '/')
    const rx = new RegExp(`^${key}=.*$`, 'm')
    if (rx.test(content)) {
      content = content.replace(rx, `${key}=${val}`)
    } else {
      content = `${content.replace(/\s+$/, '')}${eol}${key}=${val}${eol}`
    }
    process.env[key] = val
    written.push(key)
  }
  if (written.length > 0) writeFileSync(envPath, content.replace(/^\s+/, ''), 'utf8')
  return { envPath, written }
}

function streamCmd(bin, args, { cwd, env, timeoutMs = 1_800_000, onLine, signal } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(bin, args, {
      cwd: cwd || REPO_ROOT,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...(env || {}) },
      windowsHide: true,
      shell: false,
    })
    let outTail = ''
    let errTail = ''
    const partial = { out: '', err: '' }
    const pushLine = (chunk, isErr) => {
      const txt = chunk.toString('utf8')
      if (isErr) errTail = (errTail + txt).slice(-6000)
      else outTail = (outTail + txt).slice(-6000)
      const key = isErr ? 'err' : 'out'
      const parts = (partial[key] + txt).split(/\r?\n|\r/)
      partial[key] = parts.pop() || ''
      for (const line of parts) {
        const trimmed = line.trim()
        if (trimmed) onLine?.(trimmed)
      }
    }
    child.stdout?.on('data', (c) => pushLine(c, false))
    child.stderr?.on('data', (c) => pushLine(c, true))
    const kill = () => {
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {})
        }
        child.kill('SIGKILL')
      } catch {}
    }
    const onAbort = () => {
      kill()
      rejectPromise(Object.assign(new Error('安装已手动停止'), { name: 'AbortError' }))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
    const timer = setTimeout(() => {
      kill()
      rejectPromise(new Error(`安装命令超时 (${Math.round(timeoutMs / 1000)}s): ${bin} ${args.join(' ')}`))
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      rejectPromise(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      for (const k of ['out', 'err']) {
        if (partial[k].trim()) onLine?.(partial[k].trim())
      }
      resolvePromise({ code: Number(code ?? 1), stdout: outTail, stderr: errTail })
    })
  })
}

async function probePythonTorch(pythonBin, env) {
  if (!pythonBin || !existsSync(pythonBin)) return null
  const code = [
    'import json, sys, site',
    'info = {"python": sys.executable, "version": sys.version.split()[0], "prefix": sys.prefix, "basePrefix": sys.base_prefix}',
    'try:',
    '    import torch',
    '    info.update(torch=torch.__version__, cuda=torch.version.cuda, cudaAvailable=bool(torch.cuda.is_available()), torchFile=torch.__file__)',
    '    if torch.cuda.is_available():',
    '        info.update(gpu=torch.cuda.get_device_name(0), capability=list(torch.cuda.get_device_capability(0)))',
    'except Exception as exc:',
    '    info["torchError"] = str(exc)',
    'print(json.dumps(info))',
  ].join('\n')
  const res = await streamCmd(pythonBin, ['-I', '-c', code], { env, timeoutMs: 120_000 })
  if (res.code !== 0) return null
  try {
    return JSON.parse(res.stdout.trim().split(/\r?\n/).pop())
  } catch {
    return null
  }
}

/** Resolve the real base interpreter of a venv python (reads `pyvenv.cfg` `home`). */
function resolveBaseInterpreter(pythonBin) {
  const pyDir = dirname(pythonBin)
  const venvRoot = /scripts$/i.test(pyDir) || /bin$/i.test(pyDir) ? dirname(pyDir) : pyDir
  const cfgPath = join(venvRoot, 'pyvenv.cfg')
  if (!existsSync(cfgPath)) return pythonBin
  const m = /^home\s*=\s*(.+)$/im.exec(readFileSync(cfgPath, 'utf8'))
  if (!m) return pythonBin
  const home = m[1].trim()
  const cand = process.platform === 'win32' ? join(home, 'python.exe') : join(home, 'python3')
  return existsSync(cand) ? cand : pythonBin
}

async function detectUv() {
  const cands = [
    String(process.env.UV_BIN || '').trim(),
    'uv',
    join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv'),
    join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv'),
  ].filter(Boolean)
  for (const c of cands) {
    try {
      const r = await streamCmd(c, ['--version'], { timeoutMs: 15_000 })
      if (r.code === 0) return { bin: c, version: r.stdout.trim() }
    } catch {}
  }
  return null
}

function freeBytesOf(dir) {
  try {
    let probe = resolve(dir)
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe)
    const s = statfsSync(probe)
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function dirSizeBytes(dir) {
  let total = 0
  const walk = (d) => {
    let entries = []
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) walk(p)
      else {
        try {
          total += statSync(p).size
        } catch {}
      }
    }
  }
  if (existsSync(dir)) walk(dir)
  return total
}

/**
 * Resumable streaming download of one file from an official Hugging Face repo (or hf-mirror.com).
 */
export async function downloadHfFile({ endpoint, repo, file, destPath, onBytes, signal, timeoutMs = 3_600_000 }) {
  const url = `${endpoint.replace(/\/+$/, '')}/${repo}/resolve/main/${file.split('/').map(encodeURIComponent).join('/')}`
  mkdirSync(dirname(destPath), { recursive: true })
  const partPath = `${destPath}.part`
  const startAt = existsSync(partPath) ? statSync(partPath).size : 0
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  signal?.addEventListener?.('abort', onAbort, { once: true })
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const headers = { 'User-Agent': 'dsh-video-workbench-lipsync-installer' }
    const hfToken = String(process.env.HF_TOKEN || '').trim()
    if (hfToken) headers.Authorization = `Bearer ${hfToken}`
    if (startAt > 0) headers.Range = `bytes=${startAt}-`
    const resp = await fetch(url, { headers, redirect: 'follow', signal: ctrl.signal })
    if (resp.status === 416 && startAt > 0) {
      renameSync(partPath, destPath)
      return { url, bytes: statSync(destPath).size, resumed: true }
    }
    if (!(resp.status === 200 || resp.status === 206)) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText} · ${url}`)
    }
    const append = resp.status === 206 && startAt > 0
    const totalHeader = Number(resp.headers.get('content-length') || 0)
    const expectedTotal = append ? startAt + totalHeader : totalHeader
    let received = append ? startAt : 0
    const out = createWriteStream(partPath, { flags: append ? 'a' : 'w' })
    const body = Readable.fromWeb(resp.body)
    body.on('data', (chunk) => {
      received += chunk.length
      onBytes?.(received, expectedTotal)
    })
    await pipeline(body, out)
    if (expectedTotal > 0 && statSync(partPath).size !== expectedTotal) {
      throw new Error(`下载不完整 (${statSync(partPath).size}/${expectedTotal} bytes): ${url}`)
    }
    if (existsSync(destPath)) rmSync(destPath, { force: true })
    renameSync(partPath, destPath)
    return { url, bytes: statSync(destPath).size, resumed: append }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onAbort)
  }
}

/**
 * Install the MuseTalk 1.5 local lip-sync engine and wire it into the plugin.
 */
export async function installLipsyncEngine(options = {}) {
  loadEnv()
  const {
    engineId = 'musetalk',
    installDir = '',
    mirror = 'cn',
    pythonBin = '',
    reuseTorch = 'auto',
    repoUrl = '',
    withEvalModels = true,
    writeEnv = true,
    skipModelDownload = false,
    cacheDir = '',
    signal,
    onProgress,
  } = options

  const pkg = LIPSYNC_INSTALLER_PACKAGES.find((p) => p.id === engineId)
  if (!pkg) throw new Error(`不支持的唇形同步引擎: ${engineId}（当前支持: musetalk）`)

  const logs = []
  const emit = (progress, message) => {
    logs.push(message)
    if (logs.length > 200) logs.shift()
    onProgress?.({ stage: 'lipsync-install', progress, message, logs: logs.slice(-24) })
  }

  const useCn = String(mirror || 'cn').toLowerCase() !== 'global'
  const hfEndpoint = String(process.env.HF_ENDPOINT || '').trim() || (useCn ? 'https://hf-mirror.com' : 'https://huggingface.co')
  const pypiIndex = useCn ? 'https://pypi.tuna.tsinghua.edu.cn/simple' : 'https://pypi.org/simple'

  const cfg = resolveLipsyncConfig()
  const home = resolve(installDir || cfg.home)
  const musetalkDir = join(home, 'MuseTalk')
  const venvDir = join(home, '.venv')
  const venvPy = process.platform === 'win32' ? join(venvDir, 'Scripts', 'python.exe') : join(venvDir, 'bin', 'python')
  const torchHome = join(home, 'torch-hub')
  const cacheRoot = resolve(cacheDir || join(dirname(home), '.cache'))
  const tmpDir = join(cacheRoot, 'tmp')
  for (const d of [home, cacheRoot, tmpDir, join(cacheRoot, 'uv'), join(cacheRoot, 'pip'), join(cacheRoot, 'hf'), join(torchHome, 'hub', 'checkpoints')]) {
    mkdirSync(d, { recursive: true })
  }
  const childEnv = {
    UV_CACHE_DIR: join(cacheRoot, 'uv'),
    PIP_CACHE_DIR: join(cacheRoot, 'pip'),
    HF_HOME: join(cacheRoot, 'hf'),
    HF_ENDPOINT: hfEndpoint,
    TORCH_HOME: torchHome,
    CUDA_CACHE_PATH: join(cacheRoot, 'nv-compute'),
    TEMP: tmpDir,
    TMP: tmpDir,
    TMPDIR: tmpDir,
    GIT_LFS_SKIP_SMUDGE: '1',
    PYTHONNOUSERSITE: '1',
  }

  // 0. Disk budget guard (weights + venv + repo, plus 1 GB margin)
  const needWeightsMb = MUSETALK_WEIGHTS.filter((w) => withEvalModels || !w.optional).reduce((a, w) => a + (w.approxMb || 1), 0)
  const needBytes = (needWeightsMb + 400 + 1024) * 1024 * 1024
  const freeBytes = freeBytesOf(home)
  emit(3, `安装目录 ${home} · 可用空间 ${(freeBytes / 1024 ** 3).toFixed(1)} GB · 预计需要 ${(needBytes / 1024 ** 3).toFixed(1)} GB`)
  if (Number.isFinite(freeBytes) && freeBytes < needBytes) {
    throw new Error(
      `磁盘空间不足：${home} 所在分区仅剩 ${(freeBytes / 1024 ** 3).toFixed(2)} GB，安装 ${pkg.shortName} 至少需要 ${(needBytes / 1024 ** 3).toFixed(2)} GB（权重约 ${(needWeightsMb / 1024).toFixed(2)} GB + 运行环境与余量）。请清理空间或通过 --dir 指定其它盘符。`,
    )
  }

  // 1. Official source code (GitHub)
  const gitCheck = await streamCmd('git', ['--version'], { timeoutMs: 15_000 }).catch(() => null)
  if (!gitCheck || gitCheck.code !== 0) throw new Error('安装 MuseTalk 需要 Git（Git for Windows），请先安装后重试。')
  if (!existsSync(join(musetalkDir, 'musetalk', 'models', 'unet.py'))) {
    const src = repoUrl || pkg.repoUrl
    emit(6, `正在拉取官方仓库 ${src} -> ${musetalkDir} ...`)
    const cloneRes = await streamCmd('git', ['clone', '--depth', '1', src, musetalkDir], {
      env: childEnv,
      timeoutMs: 900_000,
      signal,
      onLine: (l) => emit(8, `[git] ${l.slice(0, 140)}`),
    })
    if (cloneRes.code !== 0) throw new Error(`克隆 MuseTalk 仓库失败: ${(cloneRes.stderr || cloneRes.stdout).slice(-400)}`)
  } else {
    emit(8, `检测到已有 MuseTalk 源码 ${musetalkDir}，跳过克隆`)
  }
  let repoCommit = ''
  try {
    const r = await streamCmd('git', ['-C', musetalkDir, 'rev-parse', 'HEAD'], { timeoutMs: 15_000 })
    repoCommit = r.stdout.trim().split(/\r?\n/)[0] || ''
  } catch {}

  // 2. Find a reusable CUDA PyTorch interpreter (saves ~3 GB)
  emit(12, '正在探测可复用的 CUDA PyTorch 运行时（避免重复下载 ~3 GB torch）...')
  const candidates = []
  if (pythonBin) candidates.push(pythonBin)
  if (process.env.AVATAR_LIPSYNC_BASE_PYTHON) candidates.push(process.env.AVATAR_LIPSYNC_BASE_PYTHON)
  const idxPy = resolveEnvPath('INDEXTTS_PYTHON', '')
  if (idxPy) candidates.push(idxPy)
  const gptPy = resolveEnvPath('GPTVOICE_PYTHON', '')
  if (gptPy) candidates.push(gptPy)
  let torchSource = null
  if (String(reuseTorch).toLowerCase() !== 'no') {
    for (const cand of candidates) {
      const info = await probePythonTorch(cand, childEnv)
      if (info?.torch && info.cudaAvailable) {
        torchSource = info
        break
      }
      if (info?.torch && !torchSource) torchSource = info
    }
  }
  const reuse = Boolean(torchSource?.torch && torchSource.cudaAvailable)
  if (reuse) {
    emit(16, `复用 ${torchSource.python} · torch ${torchSource.torch} (CUDA ${torchSource.cuda}) · ${torchSource.gpu || ''}`)
  } else {
    emit(16, '未找到可复用的 CUDA PyTorch，将创建全新环境并下载 torch (cu128, ~3 GB)')
  }

  // 3. Create isolated venv (inherits torch through system-site-packages or a low-priority .pth)
  const uv = await detectUv()
  if (!existsSync(venvPy)) {
    const baseInterp = reuse ? resolveBaseInterpreter(torchSource.python) : (pythonBin || 'python')
    const torchSite = reuse ? dirname(dirname(torchSource.torchFile)) : ''
    const baseSite = reuse ? (process.platform === 'win32' ? join(dirname(baseInterp), 'Lib', 'site-packages') : '') : ''
    const torchInBase = reuse && baseSite && resolve(torchSite).toLowerCase() === resolve(baseSite).toLowerCase()
    emit(20, `正在创建独立虚拟环境 ${venvDir}（基础解释器 ${baseInterp}${torchInBase ? '，继承系统 site-packages' : ''}）...`)
    const venvArgs = uv
      ? ['venv', '--python', baseInterp, ...(torchInBase ? ['--system-site-packages'] : []), venvDir]
      : ['-m', 'venv', ...(torchInBase ? ['--system-site-packages'] : []), venvDir]
    const venvRes = await streamCmd(uv ? uv.bin : baseInterp, venvArgs, {
      env: childEnv,
      timeoutMs: 300_000,
      signal,
      onLine: (l) => emit(22, `[venv] ${l.slice(0, 140)}`),
    })
    if (venvRes.code !== 0 || !existsSync(venvPy)) {
      throw new Error(`创建 Python 虚拟环境失败: ${(venvRes.stderr || venvRes.stdout).slice(-400)}`)
    }
    if (reuse && !torchInBase) {
      // Lower-priority .pth (appended after the venv's own site-packages) exposing the existing torch install
      const siteDir = process.platform === 'win32' ? join(venvDir, 'Lib', 'site-packages') : ''
      if (siteDir) writeFileSync(join(siteDir, 'zz-dsh-reuse-torch.pth'), `${torchSite}\n`, 'utf8')
    }
  } else {
    emit(22, `检测到已有虚拟环境 ${venvDir}，继续补齐依赖`)
  }

  // 4. Python packages
  const pipInstall = async (pkgs, extraArgs = [], progress = 40) => {
    const args = uv
      ? ['pip', 'install', '--python', venvPy, '--index-url', pypiIndex, ...extraArgs, ...pkgs]
      : ['-m', 'pip', 'install', '-i', pypiIndex, ...extraArgs, ...pkgs]
    const res = await streamCmd(uv ? uv.bin : venvPy, args, {
      env: childEnv,
      timeoutMs: 3_600_000,
      signal,
      onLine: (l) => emit(progress, `[${uv ? 'uv' : 'pip'}] ${l.slice(0, 140)}`),
    })
    if (res.code !== 0) throw new Error(`安装 Python 依赖失败: ${(res.stderr || res.stdout).slice(-500)}`)
  }
  if (!reuse) {
    emit(28, '正在安装 PyTorch 2.8 (CUDA 12.8, 支持 RTX 50 系 Blackwell)...')
    await pipInstall(['torch==2.8.0', 'torchvision==0.23.0'], ['--index-url', 'https://download.pytorch.org/whl/cu128'], 30)
    await pipInstall(MUSETALK_FRESH_BASE_PACKAGES, [], 36)
  }
  emit(40, `正在安装 MuseTalk 推理依赖（免 mmcv/mmpose 编译）：${MUSETALK_EXTRA_PACKAGES.join(' ')}`)
  await pipInstall(MUSETALK_EXTRA_PACKAGES, ['--no-deps'], 44)

  // 5. Verify imports inside the new environment
  emit(50, '正在校验 Python 运行环境 (torch / diffusers / transformers / cv2 / face_alignment)...')
  const verifyCode = [
    'import json, torch, diffusers, transformers, cv2, face_alignment, librosa, skimage',
    'print(json.dumps({"torch": torch.__version__, "cuda": torch.cuda.is_available(), "diffusers": diffusers.__version__, "transformers": transformers.__version__, "cv2": cv2.__version__}))',
  ].join('\n')
  const verify = await streamCmd(venvPy, ['-I', '-c', verifyCode], { env: childEnv, timeoutMs: 300_000, signal })
  if (verify.code !== 0) throw new Error(`Python 环境校验失败: ${(verify.stderr || verify.stdout).slice(-600)}`)
  emit(52, `环境校验通过: ${verify.stdout.trim().split(/\r?\n/).pop()}`)

  // 6. Model weights (resumable, size-verified)
  const weightTargets = MUSETALK_WEIGHTS.filter((w) => withEvalModels || !w.optional).map((w) => {
    const rootDir = w.root === 'models' ? join(musetalkDir, 'models') : w.root === 'torchHub' ? join(torchHome, 'hub', 'checkpoints') : join(home, 'eval')
    return { ...w, destPath: join(rootDir, w.rel) }
  })
  const downloaded = []
  if (!skipModelDownload) {
    const totalMb = weightTargets.reduce((a, w) => a + (w.approxMb || 1), 0)
    let doneMb = 0
    for (const w of weightTargets) {
      if (existsSync(w.destPath) && statSync(w.destPath).size > 0) {
        doneMb += w.approxMb || 1
        downloaded.push({ repo: w.repo, file: w.file, path: w.destPath, bytes: statSync(w.destPath).size, skipped: true })
        continue
      }
      emit(55 + Math.round((doneMb / totalMb) * 38), `正在下载 ${w.repo}/${w.file} (${hfEndpoint})...`)
      let lastEmit = 0
      let res = null
      for (let attempt = 1; attempt <= 8 && !res; attempt++) {
        try {
          res = await downloadHfFile({
            endpoint: hfEndpoint,
            repo: w.repo,
            file: w.file,
            destPath: w.destPath,
            signal,
            onBytes: (got, total) => {
              const now = Date.now()
              if (now - lastEmit < 2000) return
              lastEmit = now
              const fileMb = got / 1024 / 1024
              const pct = 55 + Math.round(((doneMb + Math.min(fileMb, w.approxMb || fileMb)) / totalMb) * 38)
              emit(Math.min(93, pct), `下载 ${w.file}: ${fileMb.toFixed(0)}${total ? ` / ${(total / 1024 / 1024).toFixed(0)}` : ''} MB`)
            },
          })
        } catch (err) {
          if (signal?.aborted || err?.name === 'AbortError') throw err
          if (/HTTP 4(0[134]|10)/.test(String(err?.message))) throw err
          if (attempt >= 8) throw new Error(`下载 ${w.repo}/${w.file} 连续失败 ${attempt} 次: ${err?.message || err}`)
          const waitSec = Math.min(30, 2 ** attempt)
          emit(55 + Math.round((doneMb / totalMb) * 38), `⚠ 下载中断 (${err?.message || err})，${waitSec}s 后断点续传 (第 ${attempt + 1} 次)...`)
          await new Promise((r) => setTimeout(r, waitSec * 1000))
        }
      }
      doneMb += w.approxMb || 1
      downloaded.push({ repo: w.repo, file: w.file, path: w.destPath, bytes: res.bytes, url: res.url })
    }
  } else {
    emit(90, '已跳过模型权重下载 (--skip-model-download)')
  }

  // 6b. One-time fp16 safetensors copy of the UNet (1.7 GB): halves the per-job disk read, loads straight to GPU
  const wrapperPy = resolveLipsyncConfig({ home }).musetalk.wrapper
  const fp16Path = join(musetalkDir, 'models', 'musetalkV15', 'unet_fp16.safetensors')
  if (!skipModelDownload && !existsSync(fp16Path) && existsSync(join(musetalkDir, 'models', 'musetalkV15', 'unet.pth')) && existsSync(wrapperPy)) {
    if (freeBytesOf(home) < 2.5 * 1024 ** 3) {
      emit(94, '⚠ 剩余空间不足 2.5 GB，跳过 UNet fp16 加速缓存（不影响使用）')
    } else {
      emit(94, '正在生成 UNet fp16 加速缓存 (unet_fp16.safetensors, ~1.7 GB，一次性)...')
      const conv = await streamCmd(venvPy, ['-I', wrapperPy, '--convert-fp16', '--engine-root', musetalkDir], {
        cwd: musetalkDir,
        env: childEnv,
        timeoutMs: 900_000,
        signal,
      })
      emit(95, conv.code === 0 && existsSync(fp16Path) ? '✓ UNet fp16 缓存已生成' : `⚠ fp16 缓存生成失败（不影响使用）: ${(conv.stderr || conv.stdout).slice(-200)}`)
    }
  }

  // 7. Manifest + .env wiring
  const manifest = {
    engine: 'musetalk',
    version: '1.5',
    home,
    musetalkDir,
    python: venvPy,
    torchHome,
    cacheDir: cacheRoot,
    repoUrl: repoUrl || pkg.repoUrl,
    repoCommit,
    torchSource: torchSource ? { python: torchSource.python, torch: torchSource.torch, cuda: torchSource.cuda, gpu: torchSource.gpu || '' } : null,
    hfEndpoint,
    weights: weightTargets.map((w) => ({ repo: w.repo, file: w.file, path: w.destPath })),
    extraPackages: MUSETALK_EXTRA_PACKAGES,
    installedAt: new Date().toISOString(),
  }
  writeFileSync(join(home, 'lipsync-engine.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  let envWrite = { envPath: '', written: [] }
  if (writeEnv) {
    envWrite = upsertDotEnvKeys({
      AVATAR_LIPSYNC_ENGINE: 'musetalk',
      AVATAR_LIPSYNC_HOME: home,
      AVATAR_LIPSYNC_PYTHON: venvPy,
    })
    emit(95, `已写入 ${envWrite.envPath}: ${envWrite.written.join(', ')}`)
  }

  // 8. Doctor
  emit(97, '正在运行唇形引擎自检 (doctor)...')
  let status = null
  try {
    status = await getLipsyncStatus({ deep: true, force: true, overrides: { engine: 'musetalk', home, python: venvPy } })
  } catch (err) {
    status = { ready: false, reason: err?.message || String(err) }
  }
  const usage = {
    homeBytes: dirSizeBytes(home),
    cacheBytes: dirSizeBytes(cacheRoot),
  }
  emit(100, status?.ready ? `✅ ${pkg.shortName} 安装完成并通过自检` : `⚠ ${pkg.shortName} 已安装，但自检未通过: ${status?.reason || '未知原因'}`)
  return {
    ok: Boolean(status?.ready),
    engineId,
    home,
    python: venvPy,
    manifest,
    downloaded,
    env: envWrite,
    status,
    usage,
    logs,
  }
}

export function formatBytes(n) {
  const v = Number(n) || 0
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GB`
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB`
  return `${(v / 1024).toFixed(0)} KB`
}

export { dirSizeBytes }
