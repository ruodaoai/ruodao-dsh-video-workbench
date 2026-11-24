/**
 * @dsh-video/tool-local-tts — Optional One-Click Local TTS Engine Installer
 * Copyright (c) 2026 Merziller (QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com)
 *
 * Lets users freely choose whether to install IndexTTS-2.5, IndexTTS-2, GPT-SoVITS, or Edge-TTS (0-VRAM CPU),
 * automatically creates `voices/` + seeds default speaker reference WAVs, and wires the installed engine
 * directly into `tts-config.json` and `.env` with zero manual CLI steps.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import {
  loadEnv,
  REPO_ROOT,
  runCommandRedirected,
} from '../shared/index.js'
import {
  addOrUpdateCustomTtsEngine,
  loadTtsConfig,
  saveTtsConfig,
  setActiveTtsEngine,
} from './tts-config.js'
import { ensureDefaultReferenceVoices } from './voice-manager.js'

export const TTS_INSTALLER_PACKAGES = [
  {
    id: 'edge-tts',
    name: 'Edge-TTS 神经网络语音（0GB 显存 · 纯 CPU 极速安装）',
    shortName: 'Edge-TTS',
    vramRequired: '0 GB（纯 CPU，任何电脑都能装）',
    diskRequired: '~30 MB',
    etaLabel: '约 15 秒',
    recommendedFor: '轻薄本 / 无独显 / 8GB 内存 / 零配置快速出片',
    repoUrl: '',
    defaultSubdir: 'edge-tts',
    autoWireKind: 'cli-command',
  },
  {
    id: 'indextts25',
    name: 'IndexTTS-2.5 旗舰情感克隆引擎（官方开源依赖包）',
    shortName: 'IndexTTS-2.5',
    vramRequired: '推荐 8 GB+ NVIDIA 显存',
    diskRequired: '~9 GB（含模型权重）',
    etaLabel: '约 5~15 分钟（视网速）',
    recommendedFor: '高保真零样本声音克隆、8 维情感向量控制、电影解说与长视频配音',
    repoUrl: 'https://github.com/index-tts/index-tts.git',
    hfModelId: 'IndexTeam/IndexTTS-2',
    defaultSubdir: 'index-tts',
    autoWireKind: 'indextts25',
  },
  {
    id: 'indextts2',
    name: 'IndexTTS-2 经典情感配音引擎（官方开源依赖包）',
    shortName: 'IndexTTS-2',
    vramRequired: '推荐 6~8 GB NVIDIA 显存',
    diskRequired: '~7 GB（含模型权重）',
    etaLabel: '约 5~12 分钟（视网速）',
    recommendedFor: '经典 IndexTTS-2 兼容环境与轻量声音克隆',
    repoUrl: 'https://github.com/index-tts/index-tts.git',
    hfModelId: 'IndexTeam/IndexTTS-2',
    defaultSubdir: 'index-tts-v2',
    autoWireKind: 'indextts2',
  },
  {
    id: 'gptvoice',
    name: 'GPT-SoVITS 低显存轻量配音引擎（官方开源依赖包）',
    shortName: 'GPT-SoVITS',
    vramRequired: '推荐 4 GB+ NVIDIA 显存',
    diskRequired: '~6 GB（含底模权重）',
    etaLabel: '约 5~12 分钟（视网速）',
    recommendedFor: '4GB~6GB 中低配独显电脑，速度快、显存占用低',
    repoUrl: 'https://github.com/RVC-Boss/GPT-SoVITS.git',
    hfModelId: 'lj1995/GPT-SoVITS',
    defaultSubdir: 'GPT-SoVITS',
    autoWireKind: 'gptvoice',
  },
]

export function getDefaultTtsInstallBaseDir() {
  return join(REPO_ROOT, 'tts-engines')
}

export function getTtsInstallerCatalog() {
  const cfg = loadTtsConfig()
  const baseDir = getDefaultTtsInstallBaseDir()
  return {
    baseDir,
    packages: TTS_INSTALLER_PACKAGES.map((pkg) => {
      const existingEngine = (cfg.engines || []).find((e) => e.id === pkg.id || (pkg.id === 'edge-tts' && e.id === 'custom-edge-tts'))
      const configuredRoot = existingEngine?.rootDir || ''
      const candidateDir = configuredRoot || join(baseDir, pkg.defaultSubdir)
      const installed =
        pkg.id === 'edge-tts'
          ? Boolean(existingEngine?.command)
          : Boolean(
              candidateDir &&
              existsSync(candidateDir) &&
              (existsSync(join(candidateDir, 'indextts', 'infer_v2_5.py')) ||
                existsSync(join(candidateDir, 'api_v2.py')) ||
                existsSync(join(candidateDir, 'api.py'))),
            )
      return {
        ...pkg,
        defaultDir: candidateDir,
        installed,
        active: cfg.activeEngineId === (pkg.id === 'edge-tts' ? 'custom-edge-tts' : pkg.id),
      }
    }),
  }
}

function updateRepoDotEnv(patch = {}) {
  try {
    const envPath = join(REPO_ROOT, '.env')
    let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
    for (const [key, rawVal] of Object.entries(patch)) {
      if (rawVal === undefined || rawVal === null || rawVal === '') continue
      const val = String(rawVal).replace(/\\/g, '/')
      const rx = new RegExp(`^${key}=.*$`, 'm')
      if (rx.test(content)) {
        content = content.replace(rx, `${key}=${val}`)
      } else {
        content = `${content.trimEnd()}\n${key}=${val}\n`
      }
    }
    writeFileSync(envPath, content.trimStart(), 'utf8')
  } catch {}
}

function streamCmd(bin, args, { cwd, env, timeoutMs = 1_800_000, onLine } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(bin, args, {
      cwd: cwd || REPO_ROOT,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...(env || {}) },
      windowsHide: true,
      shell: false,
    })
    let outTail = ''
    let errTail = ''
    const pushLine = (chunk, isErr = false) => {
      const txt = chunk.toString('utf8')
      if (isErr) errTail = (errTail + txt).slice(-4000)
      else outTail = (outTail + txt).slice(-4000)
      for (const line of txt.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed) onLine?.(trimmed)
      }
    }
    child.stdout?.on('data', (c) => pushLine(c, false))
    child.stderr?.on('data', (c) => pushLine(c, true))
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      rejectPromise(new Error(`安装命令超时 (${Math.round(timeoutMs / 1000)}s): ${bin} ${args.join(' ')}`))
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      rejectPromise(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code: Number(code ?? 1), stdout: outTail, stderr: errTail })
    })
  })
}

async function detectCommand(candidates = []) {
  for (const cand of candidates) {
    try {
      const r = await runCommandRedirected(cand, ['--version'], { timeoutMs: 10_000 })
      if (r.code === 0) return { bin: cand, version: (r.stdout || r.stderr || '').trim().split(/\r?\n/)[0] }
    } catch {}
  }
  return null
}

/**
 * Install an optional local TTS engine package and automatically wire it into `tts-config.json` & `.env`.
 * Also guarantees `<engineDir>/voices/` exists with a ready-to-use default reference speaker WAV.
 */
export async function installTtsEngine(options = {}) {
  loadEnv()
  const {
    engineId = 'indextts25',
    installDir = '',
    mirror = 'cn',
    pythonBin = '',
    autoActivate = true,
    skipModelDownload = false,
    onProgress,
  } = options

  const pkg = TTS_INSTALLER_PACKAGES.find((p) => p.id === engineId)
  if (!pkg) {
    throw new Error(`不支持的配音模型包: ${engineId}（支持: edge-tts / indextts25 / indextts2 / gptvoice）`)
  }

  const logs = []
  const emit = (progress, message) => {
    logs.push(message)
    if (logs.length > 160) logs.shift()
    onProgress?.({ stage: 'tts-install', progress, message, logs: logs.slice(-24) })
  }

  const useCnMirror = String(mirror || 'cn').toLowerCase() !== 'global'
  const pipMirrorArgs = useCnMirror ? ['-i', 'https://pypi.tuna.tsinghua.edu.cn/simple'] : []
  const hfEndpoint = useCnMirror ? 'https://hf-mirror.com' : 'https://huggingface.co'
  const targetDir = resolve(installDir || join(getDefaultTtsInstallBaseDir(), pkg.defaultSubdir))
  mkdirSync(dirname(targetDir), { recursive: true })

  emit(5, `正在检查本机 Python / Git 运行环境（目标引擎: ${pkg.shortName}）...`)
  const pyCheck = pythonBin
    ? { bin: pythonBin, version: 'user-specified' }
    : await detectCommand(process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'])
  if (!pyCheck) {
    throw new Error('本机未检测到 Python（建议安装 Python 3.10~3.12 并勾选 Add to PATH），或者直接选用「Windows 系统原生中文语音 (0GB 显存免安装)」。')
  }
  emit(10, `检测到 Python: ${pyCheck.bin} (${pyCheck.version})`)

  // =========================================================================
  // Fast Path: Edge-TTS (0GB VRAM, pure CPU, ~15s install)
  // =========================================================================
  if (engineId === 'edge-tts') {
    emit(30, `正在安装 edge-tts 纯 CPU 神经网络语音包 (${useCnMirror ? '清华镜像源' : '官方 PyPI'})...`)
    const pipRes = await streamCmd(pyCheck.bin, ['-m', 'pip', 'install', '-U', 'edge-tts', ...pipMirrorArgs], {
      timeoutMs: 300_000,
      onLine: (l) => emit(55, `[pip] ${l.slice(0, 120)}`),
    })
    if (pipRes.code !== 0) {
      throw new Error(`安装 edge-tts 失败: ${(pipRes.stderr || pipRes.stdout).slice(-400)}`)
    }
    const engineDef = {
      id: 'custom-edge-tts',
      name: 'Edge-TTS 神经网络语音（已自动接入 · 0GB 纯 CPU）',
      shortName: 'Edge-TTS',
      kind: 'cli-command',
      vramBadge: '0GB 纯CPU',
      description: '微软高自然度在线神经网络中文语音，零显存占用、支持 40+ 中文男女音色。',
      command: pyCheck.bin,
      argsTemplate: '-m edge_tts --text {{text}} --voice {{voice}} --write-media {{output}}',
      voice: 'zh-CN-YunxiNeural',
      outputExt: '.mp3',
    }
    addOrUpdateCustomTtsEngine(engineDef)
    if (autoActivate) {
      setActiveTtsEngine('custom-edge-tts')
    }
    emit(100, '✅ Edge-TTS 安装完成并已自动接入工作台！可直接点击试听或一键出片。')
    return {
      ok: true,
      engineId: 'custom-edge-tts',
      installedDir: targetDir,
      pythonBin: pyCheck.bin,
      activated: Boolean(autoActivate),
      logs,
    }
  }

  // =========================================================================
  // Full Local Neural Voice Cloning Path: IndexTTS-2.5 / IndexTTS-2 / GPT-SoVITS
  // =========================================================================
  const gitCheck = await detectCommand(['git'])
  if (!gitCheck) {
    throw new Error('安装 IndexTTS / GPT-SoVITS 需要 Git，请先安装 Git for Windows（或先使用 Edge-TTS / Windows 系统原生语音）。')
  }

  const gitEnv = {
    HF_ENDPOINT: hfEndpoint,
    GIT_LFS_SKIP_SMUDGE: '1',
  }

  // 1. Clone or reuse repo
  if (!existsSync(join(targetDir, '.git'))) {
    emit(18, `正在拉取官方仓库 ${pkg.repoUrl} 到 ${targetDir}...`)
    const cloneRes = await streamCmd('git', ['clone', '--depth', '1', pkg.repoUrl, targetDir], {
      env: gitEnv,
      timeoutMs: 600_000,
      onLine: (l) => emit(25, `[git] ${l.slice(0, 120)}`),
    })
    if (cloneRes.code !== 0) {
      throw new Error(`克隆 ${pkg.shortName} 仓库失败: ${(cloneRes.stderr || cloneRes.stdout).slice(-400)}`)
    }
  } else {
    emit(25, `检测到已有目录 ${targetDir}，跳过重复克隆，继续补齐虚拟环境与 voices 目录...`)
  }

  // 2. Create isolated .venv
  const venvDir = join(targetDir, '.venv')
  const venvPy = process.platform === 'win32' ? join(venvDir, 'Scripts', 'python.exe') : join(venvDir, 'bin', 'python')
  if (!existsSync(venvPy)) {
    emit(34, `正在创建独立 Python 虚拟环境 ${venvDir}...`)
    const venvRes = await streamCmd(pyCheck.bin, ['-m', 'venv', venvDir], {
      cwd: targetDir,
      timeoutMs: 180_000,
      onLine: (l) => emit(38, `[venv] ${l.slice(0, 120)}`),
    })
    if (venvRes.code !== 0 || !existsSync(venvPy)) {
      throw new Error(`创建 Python 虚拟环境失败: ${(venvRes.stderr || venvRes.stdout).slice(-400)}`)
    }
  }

  // 3. Install requirements (prefer uv if present, else pip with mirror)
  const uvCheck = await detectCommand(['uv'])
  emit(46, `正在安装 ${pkg.shortName} Python 运行依赖（${useCnMirror ? '国内镜像加速' : '官方源'}）...`)
  if (existsSync(join(targetDir, 'pyproject.toml')) && uvCheck && (engineId === 'indextts25' || engineId === 'indextts2')) {
    const uvArgs = ['sync', '--no-dev']
    const uvRes = await streamCmd(uvCheck.bin, uvArgs, {
      cwd: targetDir,
      env: {
        ...gitEnv,
        ...(useCnMirror ? { UV_DEFAULT_INDEX: 'https://pypi.tuna.tsinghua.edu.cn/simple' } : {}),
      },
      timeoutMs: 1_800_000,
      onLine: (l) => emit(58, `[uv] ${l.slice(0, 120)}`),
    })
    if (uvRes.code !== 0) {
      emit(60, 'uv 同步回退至 pip 安装 requirements...')
    }
  }
  const reqFile = join(targetDir, 'requirements.txt')
  if (existsSync(reqFile)) {
    await streamCmd(venvPy, ['-m', 'pip', 'install', '-U', 'pip', 'huggingface_hub', ...pipMirrorArgs], {
      cwd: targetDir,
      env: gitEnv,
      timeoutMs: 300_000,
      onLine: (l) => emit(62, `[pip] ${l.slice(0, 120)}`),
    })
    const reqRes = await streamCmd(venvPy, ['-m', 'pip', 'install', '-r', reqFile, ...pipMirrorArgs], {
      cwd: targetDir,
      env: gitEnv,
      timeoutMs: 1_800_000,
      onLine: (l) => emit(70, `[pip] ${l.slice(0, 120)}`),
    })
    if (reqRes.code !== 0) {
      throw new Error(`安装 ${pkg.shortName} 依赖失败: ${(reqRes.stderr || reqRes.stdout).slice(-450)}`)
    }
  }

  // 4. Download checkpoints (optional skip for offline test or pre-downloaded weights)
  const ckptDir = join(targetDir, 'checkpoints')
  mkdirSync(ckptDir, { recursive: true })
  if (!skipModelDownload && pkg.hfModelId && !existsSync(join(ckptDir, 'config.yaml')) && engineId !== 'gptvoice') {
    emit(78, `正在通过 ${hfEndpoint} 下载 ${pkg.hfModelId} 模型权重到 checkpoints/（支持断点续传）...`)
    const dlScript = `from huggingface_hub import snapshot_download; snapshot_download(repo_id="${pkg.hfModelId}", local_dir=r"${ckptDir.replace(/\\/g, '/')}", resume_download=True)`
    const dlRes = await streamCmd(venvPy, ['-c', dlScript], {
      cwd: targetDir,
      env: { ...gitEnv, HF_ENDPOINT: hfEndpoint },
      timeoutMs: 3_600_000,
      onLine: (l) => emit(84, `[model] ${l.slice(0, 120)}`),
    })
    if (dlRes.code !== 0) {
      emit(86, `⚠ 模型权重下载未全部完成（可稍后重试或手动拷贝 checkpoints/）：${(dlRes.stderr || '').slice(-200)}`)
    }
  }

  // 5. Auto-create `voices/` directory & seed default reference speaker WAV so first test NEVER fails!
  emit(90, '正在自动初始化 voices/ 音色目录与默认参考音色 WAV（杜绝小白首次使用缺少 voices 目录报错）...')
  const voicesDir = join(targetDir, 'voices')
  mkdirSync(voicesDir, { recursive: true })
  const seeded = await ensureDefaultReferenceVoices({
    idxRoot: engineId === 'gptvoice' ? '' : targetDir,
    gptRoot: engineId === 'gptvoice' ? targetDir : '',
  })

  // 6. Auto-wire into `tts-config.json` & `.env`
  emit(95, `正在自动将 ${pkg.shortName} 路径与 Python 环境接入插件配置...`)
  const cfg = loadTtsConfig()
  const updatedEngines = (cfg.engines || []).map((eng) => {
    if (eng.id === engineId || (engineId === 'indextts25' && eng.id === 'indextts2')) {
      return {
        ...eng,
        rootDir: targetDir.replace(/\\/g, '/'),
        pythonBin: venvPy.replace(/\\/g, '/'),
      }
    }
    return eng
  })
  saveTtsConfig({
    ...cfg,
    activeEngineId: autoActivate ? engineId : cfg.activeEngineId,
    engines: updatedEngines,
  })
  if (engineId === 'gptvoice') {
    updateRepoDotEnv({
      GPTVOICE_ROOT: targetDir,
      GPTVOICE_PYTHON: venvPy,
      ...(autoActivate ? { DEFAULT_TTS_ENGINE: 'gptvoice' } : {}),
    })
  } else {
    updateRepoDotEnv({
      INDEXTTS_ROOT: targetDir,
      INDEXTTS_PYTHON: venvPy,
      ...(seeded?.refPath ? { DEFAULT_REF_AUDIO: seeded.refPath } : {}),
      ...(autoActivate ? { DEFAULT_TTS_ENGINE: engineId } : {}),
    })
  }

  emit(100, `✅ ${pkg.shortName} 安装完成！已自动创建 voices/ 目录并接入插件，现在即可点击「试听测试」或直接出片！`)
  return {
    ok: true,
    engineId,
    installedDir: targetDir,
    pythonBin: venvPy,
    voicesDir,
    seededRefAudio: seeded?.refPath || '',
    activated: Boolean(autoActivate),
    logs,
  }
}
