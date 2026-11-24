/**
 * Manages the persistent IndexTTS-2.5 / IndexTTS-2 HTTP server (`scripts/tts-server.py`).
 * The model is loaded once (~15-60s) and then every sentence only costs fast GPU inference time.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadEnv, REPO_ROOT, resolveEnvPath, resolvePackagePath } from '../shared/index.js'
import { resolveTtsEngineSpec } from './tts-config.js'

let startingPromise = null

function endpoint(engineId = 'indextts25') {
  loadEnv()
  const spec = resolveTtsEngineSpec(engineId)
  return (spec?.endpoint || process.env.INDEXTTS_ENDPOINT || 'http://127.0.0.1:9880').replace(/\/+$/, '')
}

export async function getTtsServerHealth(timeoutMs = 2500, engineId = '') {
  const spec = resolveTtsEngineSpec(engineId)
  if (spec.kind === 'windows-sapi') {
    const ok = process.platform === 'win32'
    return {
      reachable: ok,
      ready: ok,
      engine: spec.id,
      engineName: spec.name,
      kind: spec.kind,
      vramBadge: spec.vramBadge,
      message: ok ? 'Windows 系统内置语音就绪（0 显存纯 CPU）' : '仅支持 Windows 平台',
    }
  }
  if (spec.kind === 'minimax-tts') {
    const ok = Boolean(String(spec.apiKey || process.env.MINIMAX_API_KEY || '').trim())
    return {
      reachable: ok,
      ready: ok,
      engine: spec.id,
      engineName: spec.name,
      kind: spec.kind,
      endpoint: spec.endpoint || 'https://api.minimaxi.com/v1/t2a_v2',
      vramBadge: spec.vramBadge,
      message: ok ? `MiniMax 云端语音就绪 (${spec.model || 'speech-2.6-hd'})` : '请先填写 MiniMax API Key',
    }
  }
  if (spec.kind === 'doubao-tts') {
    const ok = Boolean(String(spec.appId || process.env.DOUBAO_TTS_APPID || '').trim() && String(spec.token || process.env.DOUBAO_TTS_TOKEN || '').trim())
    return {
      reachable: ok,
      ready: ok,
      engine: spec.id,
      engineName: spec.name,
      kind: spec.kind,
      endpoint: spec.endpoint || 'https://openspeech.bytedance.com/api/v1/tts',
      vramBadge: spec.vramBadge,
      message: ok ? `火山方舟豆包语音就绪 (${spec.voiceType || 'default'})` : '请先填写豆包 AppID 与 Token',
    }
  }
  if (spec.kind === 'openai-tts' || spec.kind === 'http-json') {
    const ep = String(spec.endpoint || '').trim()
    if (!ep) return { reachable: false, ready: false, engine: spec.id, engineName: spec.name, kind: spec.kind, message: '未填写接口地址' }
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const origin = new URL(ep).origin
      const res = await fetch(origin, { method: 'GET', signal: ctrl.signal }).catch(() => null)
      const isLocal = /127\.0\.0\.1|localhost/i.test(origin)
      const reachable = Boolean(res) || !isLocal
      return {
        reachable,
        ready: reachable,
        engine: spec.id,
        engineName: spec.name,
        kind: spec.kind,
        endpoint: ep,
        vramBadge: spec.vramBadge,
      }
    } catch {
      return { reachable: true, ready: true, engine: spec.id, engineName: spec.name, kind: spec.kind, endpoint: ep, vramBadge: spec.vramBadge }
    } finally {
      clearTimeout(t)
    }
  }
  if (spec.kind === 'cli-command') {
    const hasCmd = Boolean(String(spec.command || '').trim())
    return {
      reachable: hasCmd,
      ready: hasCmd,
      engine: spec.id,
      engineName: spec.name,
      kind: spec.kind,
      command: spec.command || '',
      vramBadge: spec.vramBadge,
    }
  }
  if (spec.kind === 'gptvoice') {
    const ep = String(spec.endpoint || 'http://127.0.0.1:9881').replace(/\/+$/, '')
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      // GPT-SoVITS api_v2.py responds on / or /tts (400/405/422 proves HTTP listener is up)
      const res = await fetch(`${ep}/`, { method: 'GET', signal: ctrl.signal })
      return {
        reachable: res.status > 0,
        ready: res.status > 0,
        engine: 'gptvoice',
        engineName: spec.name,
        kind: 'gptvoice',
        endpoint: ep,
        vramBadge: spec.vramBadge,
      }
    } catch {
      return {
        reachable: false,
        ready: false,
        engine: 'gptvoice',
        engineName: spec.name,
        kind: 'gptvoice',
        endpoint: ep,
        vramBadge: spec.vramBadge,
      }
    } finally {
      clearTimeout(t)
    }
  }

  const ep = (spec.endpoint || endpoint(spec.id)).replace(/\/+$/, '')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${ep}/health`, { signal: ctrl.signal })
    const data = await res.json()
    return { reachable: true, engine: spec.id, engineName: spec.name, kind: spec.kind, endpoint: ep, vramBadge: spec.vramBadge, ...data }
  } catch {
    return { reachable: false, ready: false, engine: spec.id, engineName: spec.name, kind: spec.kind, endpoint: ep, vramBadge: spec.vramBadge }
  } finally {
    clearTimeout(t)
  }
}

function collectPythonPathDirs(pythonExe) {
  const pyDir = dirname(pythonExe)
  const pyRoot = existsSync(join(pyDir, 'python.exe')) ? pyDir : dirname(pyDir)
  const dirs = [
    pyDir,
    pyRoot,
    join(pyRoot, 'Scripts'),
    join(pyRoot, 'Lib', 'site-packages', 'torch', 'lib'),
    join(pyRoot, 'Library', 'bin'),
  ]
  const pyvenvCfg = join(pyRoot, 'pyvenv.cfg')
  if (existsSync(pyvenvCfg)) {
    try {
      const m = /^home\s*=\s*(.+)$/im.exec(readFileSync(pyvenvCfg, 'utf8'))
      if (m && m[1]) {
        const baseHome = m[1].trim()
        dirs.push(
          baseHome,
          join(baseHome, 'Scripts'),
          join(baseHome, 'Lib', 'site-packages', 'torch', 'lib'),
          join(baseHome, 'Library', 'bin'),
        )
      }
    } catch {}
  }
  return dirs.filter(Boolean)
}

function spawnServer(engineId = 'indextts25') {
  const spec = resolveTtsEngineSpec(engineId)
  if (spec.kind === 'gptvoice') {
    const root = spec.rootDir || resolveEnvPath('GPTVOICE_ROOT', '')
    const python = spec.pythonBin || resolveEnvPath('GPTVOICE_PYTHON', '')
    const ep = spec.endpoint || 'http://127.0.0.1:9881'
    if (!root || !existsSync(root) || !python || !existsSync(python)) {
      throw new Error(
        `GPT-SoVITS 服务未启动 (${ep})：请先运行本机 GPT-SoVITS api_v2.py（或在「配音引擎中心」配置 GPT-SoVITS 目录与 Python 路径以自动启动），或切换至其他配音引擎。`,
      )
    }
    const u = new URL(ep)
    const port = u.port || '9881'
    const apiV2 = join(root, 'api_v2.py')
    const apiV1 = join(root, 'api.py')
    const entryScript = existsSync(apiV2) ? apiV2 : existsSync(apiV1) ? apiV1 : ''
    if (!entryScript) {
      throw new Error(`GPT-SoVITS 目录下未找到 api_v2.py 或 api.py：${root}`)
    }
    const logDir = join(REPO_ROOT, '.tmp')
    mkdirSync(logDir, { recursive: true })
    const logFd = openSync(join(logDir, 'gptvoice-server.log'), 'a')
    const pyPaths = collectPythonPathDirs(python)
    const args = entryScript.endsWith('api_v2.py')
      ? ['-s', entryScript, '-a', u.hostname || '127.0.0.1', '-p', String(port)]
      : ['-s', entryScript, '-a', u.hostname || '127.0.0.1', '-p', String(port)]
    const child = spawn(python, args, {
      cwd: root,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PATH: [...pyPaths, process.env.PATH || ''].join(';'),
      },
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    })
    child.unref()
    return child.pid
  }

  const root = spec.rootDir || resolveEnvPath('INDEXTTS_ROOT', '')
  const python = spec.pythonBin || resolveEnvPath('INDEXTTS_PYTHON', '')
  if (!root || !existsSync(root) || !python || !existsSync(python)) {
    throw new Error('未配置 INDEXTTS_ROOT / INDEXTTS_PYTHON，无法启动本地 IndexTTS-2.5 服务（可在「配音引擎中心」切换 GPT-SoVITS 或导入轻量化配音模型）。')
  }
  const port = new URL(spec.endpoint || endpoint(engineId)).port || '9880'
  const logDir = join(REPO_ROOT, '.tmp')
  mkdirSync(logDir, { recursive: true })
  const logFd = openSync(join(logDir, 'tts-server.log'), 'a')
  const pyPaths = collectPythonPathDirs(python)
  const env = {
    ...process.env,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONHOME: '',
    PYTHONPATH: '',
    FOR_DISABLE_CONSOLE_CTRL_HANDLER: '1',
    HF_HOME: join(root, 'checkpoints'),
    HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com',
    TRANSFORMERS_CACHE: join(root, 'tf_download'),
    GRADIO_TEMP_DIR: join(REPO_ROOT, '.tmp', 'gradio'),
    XFORMERS_FORCE_DISABLE_TRITON: '1',
    PATH: [...pyPaths, process.env.PATH || ''].join(';'),
  }
  const child = spawn(python, ['-s', resolvePackagePath('scripts', 'tts-server.py'), '--root', root, '--port', String(port)], {
    cwd: root,
    env,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  })
  child.unref()
  return child.pid
}

function runQuiet(bin, args, timeoutMs = 15_000) {
  return new Promise((resolvePromise) => {
    let out = ''
    let child
    try {
      child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      resolvePromise('')
      return
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
    }, timeoutMs)
    child.stdout?.on('data', (d) => { out += d.toString('utf8') })
    child.on('error', () => { clearTimeout(timer); resolvePromise('') })
    child.on('close', () => { clearTimeout(timer); resolvePromise(out) })
  })
}

/**
 * Stop the local IndexTTS-2.5 / IndexTTS-2 server listening on the configured loopback port (used to free VRAM
 * for GPU-heavy steps such as lip-sync). Only a Python process that owns the LISTENING socket is terminated.
 * Returns `{ stopped, pid, reason }`; `ensureTtsServer()` starts it again on demand.
 */
export async function stopTtsServer({ engineId = 'indextts25' } = {}) {
  const spec = resolveTtsEngineSpec(engineId)
  if (!['indextts25', 'indextts2'].includes(spec.kind)) return { stopped: false, pid: null, reason: `not a local IndexTTS engine (${spec.kind})` }
  let url
  try {
    url = new URL(spec.endpoint || endpoint(spec.id))
  } catch {
    return { stopped: false, pid: null, reason: 'invalid endpoint' }
  }
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return { stopped: false, pid: null, reason: 'remote endpoint' }
  const port = url.port || '9880'
  if (process.platform !== 'win32') return { stopped: false, pid: null, reason: 'only implemented on Windows' }
  const netstat = await runQuiet('netstat', ['-ano', '-p', 'tcp'])
  const line = netstat
    .split(/\r?\n/)
    .find((l) => /LISTENING/i.test(l) && new RegExp(`(127\\.0\\.0\\.1|0\\.0\\.0\\.0):${port}\\s`).test(l))
  const pid = line ? Number(line.trim().split(/\s+/).pop()) : 0
  if (!pid) return { stopped: false, pid: null, reason: `no listener on port ${port}` }
  const tasklist = await runQuiet('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
  if (!/python/i.test(tasklist)) return { stopped: false, pid, reason: `PID ${pid} is not a Python process` }
  await runQuiet('taskkill', ['/PID', String(pid), '/T', '/F'])
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250))
    const h = await getTtsServerHealth(800, spec.id)
    if (!h.reachable) return { stopped: true, pid, reason: 'terminated' }
  }
  return { stopped: false, pid, reason: 'still reachable after taskkill' }
}

/**
 * Ensure the configured local TTS server (IndexTTS-2.5 / IndexTTS-2 / GPT-SoVITS) is running and ready.
 */
export async function ensureTtsServer({ waitMs = 300_000, onWait, engineId = '' } = {}) {
  const spec = resolveTtsEngineSpec(engineId)
  if (spec.kind === 'windows-sapi' || !['indextts25', 'indextts2', 'gptvoice'].includes(spec.kind)) {
    return await getTtsServerHealth(2500, spec.id)
  }
  const h = await getTtsServerHealth(2500, spec.id)
  if (h.reachable && h.ready) return h
  if (!startingPromise) {
    startingPromise = (async () => {
      if (!h.reachable) spawnServer(spec.id)
      const deadline = Date.now() + waitMs
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000))
        const cur = await getTtsServerHealth(2500, spec.id)
        if (cur.reachable && cur.ready) return cur
        if (cur.reachable && cur.error) throw new Error(`${spec.name} 加载失败: ${cur.error}`)
        onWait?.(Math.round((deadline - Date.now()) / 1000))
      }
      throw new Error(`等待 ${spec.name} 加载超时（详见 .tmp/ 目录日志）`)
    })().finally(() => {
      startingPromise = null
    })
  }
  return startingPromise
}
