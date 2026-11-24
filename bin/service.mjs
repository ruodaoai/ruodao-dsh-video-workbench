#!/usr/bin/env node
/**
 * dsh-video-workbench × Ruodao Agent 插件常驻服务桥。
 *
 * 职责（宿主通过 stdin/stdout JSON 行协议调用，见 douyin-live-workbench 同款协议）：
 *  1. boot：定位上游 repo（DSH_REPO env 或插件同级默认路径），缺依赖时自动 pnpm install；
 *  2. 模型适配：把宿主注入的 RUODAO_LLM_BASE_URL/API_KEY/MODEL 写入 workbench 的
 *     llm-config.json（OpenAI 兼容协议），让「AI 一键润色 / run_agent_pipeline」直接用若道当前模型；
 *  3. 号池适配：读 %LOCALAPPDATA%/RuodaoImagePool/api-token.txt，把本地生图号池
 *     (127.0.0.1:8100/v1, gpt-image-2.6, OpenAI images 协议) 写入 .dsh-video-cloud-media.json；
 *  4. 拉起并托管 studio HTTP 服务 (127.0.0.1:4399)，健康检查后回报 runtime 信息；
 *  5. runtime / health / stop 等 service.call 方法。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const log = (msg) => {
  try { process.stderr.write(`[dsh-video-workbench] ${String(msg).replace(/\s+/g, ' ').slice(0, 600)}\n`) } catch {}
}
const send = (msg) => { try { if (process.stdout.writable) process.stdout.write(JSON.stringify(msg) + '\n') } catch {} }

/* ── 上游 repo 定位 ── */
function resolveRepoRoot() {
  const candidates = [
    process.env.DSH_REPO_ROOT,
    resolve(PLUGIN_ROOT, 'repo'),
    resolve(PLUGIN_ROOT, '..', '..', '..', '..', 'dsh', 'Merziller-dsh-video-workbench-8f3f8d7'),
    resolve(homedir(), '.dsh', 'video-workbench-repo'),
  ].filter(Boolean)
  for (const c of candidates) {
    if (existsSync(join(c, 'bin', 'dsh-video-cli.mjs'))) return resolve(c)
  }
  return ''
}

function resolveStudioPort() {
  return Number(process.env.DSH_STUDIO_PORT) || 4399
}

/* ── 依赖自动安装 ── */
function ensureDeps(repoRoot) {
  const hasNodeModules = existsSync(join(repoRoot, 'node_modules', 'remotion', 'package.json'))
  if (hasNodeModules) return { ok: true, installed: false }
  log('node_modules 缺失，开始 pnpm install（首次约 1~3 分钟）...')
  const res = spawnSync('pnpm', ['install', '--ignore-scripts'], { cwd: repoRoot, encoding: 'utf8', timeout: 300_000, shell: process.platform === 'win32' })
  if (res.status !== 0) {
    return { ok: false, error: `pnpm install 失败: ${(res.stderr || res.stdout || '').slice(-400)}` }
  }
  spawnSync('pnpm', ['rebuild'], { cwd: repoRoot, timeout: 120_000, shell: process.platform === 'win32' })
  return { ok: true, installed: true }
}

/* ── 模型适配：RUODAO_LLM_* → llm-config.json ── */
function adaptLlmConfig(repoRoot) {
  const baseUrl = String(process.env.RUODAO_LLM_BASE_URL || '').trim()
  const apiKey = String(process.env.RUODAO_LLM_API_KEY || '').trim()
  const model = String(process.env.RUODAO_LLM_MODEL || '').trim()
  if (!baseUrl || !model) {
    return { adapted: false, reason: '宿主未注入 RUODAO_LLM_*（未选模型或服务直启）' }
  }
  // ruodao 桌面端归一化的 baseUrl 是 OpenAI 兼容 chat/completions 根
  const homeDir = process.env.DSH_VIDEO_HOME || join(repoRoot, '.dsh-home')
  const cfgPath = join(homeDir, 'llm-config.json')
  mkdirSync(dirname(cfgPath), { recursive: true })
  let existing = {}
  try { existing = JSON.parse(readFileSync(cfgPath, 'utf8')) } catch {}
  const next = {
    mode: 'custom',
    dshProviderId: '',
    provider: 'openai',
    format: 'openai-completions',
    baseUrl,
    apiKey,
    model,
    maxRepairRounds: existing.maxRepairRounds ?? 3,
    temperature: existing.temperature ?? 0.45,
    maxTokens: existing.maxTokens ?? 16000,
    updatedAt: new Date().toISOString(),
    ruodaoAdapted: true,
  }
  writeFileSync(cfgPath, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return { adapted: true, baseUrl, model, cfgPath, hasKey: Boolean(apiKey) }
}

/* ── 号池适配：RuodaoImagePool token → .dsh-video-cloud-media.json ── */
async function adaptImagePool(repoRoot) {
  const tokenFile = process.env.RUODAO_IMAGE_POOL_TOKEN_FILE
    || join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'RuodaoImagePool', 'api-token.txt')
  let token = ''
  try { token = readFileSync(tokenFile, 'utf8').trim() } catch {}
  if (!token) return { adapted: false, reason: `号池 token 不存在 (${tokenFile})` }
  // 健康检查：号池没跑就不写配置，避免写入死配置
  let alive = false
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    const res = await fetch('http://127.0.0.1:8100/health', { signal: ctrl.signal })
    clearTimeout(t)
    alive = res.ok
  } catch {}
  if (!alive) return { adapted: false, reason: '本地号池 (127.0.0.1:8100) 未运行，跳过适配' }

  const cfgPath = process.env.DSH_VIDEO_HOME
    ? join(process.env.DSH_VIDEO_HOME, '.dsh-video-cloud-media.json')
    : join(repoRoot, '.dsh-video-cloud-media.json')
  let cfg = {}
  try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) } catch {}
  cfg.image = {
    ...(cfg.image || {}),
    enabled: true,
    providerId: 'openai-image',
    protocol: 'openai-image',
    baseUrl: 'http://127.0.0.1:8100/v1',
    endpoint: '/images/generations',
    model: 'gpt-image-2.6',
    apiKey: token,
    ruodaoAdapted: true,
  }
  cfg.updatedAt = new Date().toISOString()
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  return { adapted: true, baseUrl: 'http://127.0.0.1:8100/v1', model: 'gpt-image-2.6', cfgPath }
}

/* ── studio 托管 ── */
let studioChild = null
let studioPort = resolveStudioPort()

async function startStudio(repoRoot) {
  if (studioChild && !studioChild.killed) return { ok: true, alreadyRunning: true }
  const healthy = await probeStudio(studioPort, 4000)
  if (healthy) return { ok: true, alreadyRunning: true, external: true }
  log('拉起 studio 服务...')
  studioChild = spawn(process.execPath, [join(repoRoot, 'bin', 'dsh-video-cli.mjs'), 'studio', '--daemon'], {
    cwd: repoRoot,
    stdio: 'ignore',
    windowsHide: true,
    detached: false,
  })
  studioChild.on('exit', () => { studioChild = null })
  const ok = await probeStudio(studioPort, 30000)
  return ok ? { ok: true } : { ok: false, error: `studio 30s 内未就绪 (port ${studioPort})` }
}

async function probeStudio(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, 6000))
      // runner-info 由 HTTP 层直接返回；state 会周期性重算项目（冷调用可达 3.5s），不适合做存活探测
      const res = await fetch(`http://127.0.0.1:${port}/api/video-workbench/runner-info`, { signal: ctrl.signal })
      clearTimeout(t)
      if (res.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

/* ── boot ── */
let bootInfo = null
async function boot(payload = {}) {
  const repoRoot = resolveRepoRoot()
  if (!repoRoot) {
    throw new Error('未找到 dsh-video-workbench 上游 repo（设置 DSH_REPO_ROOT 或将 repo 放到插件目录 repo/ 子目录）')
  }
  const dep = ensureDeps(repoRoot)
  if (!dep.ok) throw new Error(dep.error)
  const llm = adaptLlmConfig(repoRoot)
  const pool = await adaptImagePool(repoRoot)
  const studio = await startStudio(repoRoot)
  if (!studio.ok) throw new Error(studio.error)
  bootInfo = {
    repoRoot,
    port: studioPort,
    studioUrl: `http://127.0.0.1:${studioPort}`,
    llm,
    imagePool: pool,
    depsInstalled: dep.installed,
    bootedAt: new Date().toISOString(),
  }
  log(`boot 完成: studio=${bootInfo.studioUrl} llm=${llm.adapted ? llm.model : llm.reason} pool=${pool.adapted ? pool.model : pool.reason}`)
  return bootInfo
}

/* ── service.call 方法 ── */
async function handle(method, params = {}) {
  switch (method) {
    case 'ping':
      return { ok: true, at: Date.now(), booted: Boolean(bootInfo) }
    case 'runtime': {
      if (!bootInfo) await boot()
      return {
        baseUrl: bootInfo.studioUrl,
        studioUrl: bootInfo.studioUrl,
        port: bootInfo.port,
        token: '',
        version: '0.6.0',
        llm: bootInfo.llm,
        imagePool: bootInfo.imagePool,
        repoRoot: bootInfo.repoRoot,
      }
    }
    case 'health': {
      const alive = await probeStudio(studioPort, 8000)
      return { ok: alive, port: studioPort }
    }
    case 're_adapt': {
      if (!bootInfo) await boot()
      const llm = adaptLlmConfig(bootInfo.repoRoot)
      const pool = await adaptImagePool(bootInfo.repoRoot)
      bootInfo.llm = llm
      bootInfo.imagePool = pool
      return { ok: true, llm, imagePool: pool }
    }
    case 'shutdown': {
      send({ type: 'event', event: 'closing', payload: {} })
      await shutdown(0)
      return { ok: true }
    }
    default:
      throw new Error(`未知方法: ${method}`)
  }
}

/* ── 宿主协议（init / request / shutdown） ── */
async function onMessage(message) {
  if (!message || typeof message !== 'object') return
  const type = String(message.type || '')
  if (type === 'init') {
    try {
      const result = await boot(message.payload || {})
      send({ type: 'ready', payload: result })
    } catch (error) {
      log(`init failed: ${error?.stack ?? error}`)
      send({ type: 'event', event: 'service-error', payload: { message: String(error?.message ?? error) } })
      await shutdown(1)
    }
    return
  }
  if (type === 'request') {
    const id = String(message.id || '')
    try {
      const result = await handle(String(message.method || ''), message.params || {})
      send({ type: 'response', id, ok: true, result })
    } catch (error) {
      send({ type: 'response', id, ok: false, error: String(error?.message ?? error).slice(0, 2000) })
    }
    return
  }
  if (type === 'shutdown') await shutdown(0)
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  if (buffer.length > 16 * 1024 * 1024) { buffer = ''; return }
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index).replace(/\r$/, '').trim()
    buffer = buffer.slice(index + 1)
    if (line) {
      try { void onMessage(JSON.parse(line)) } catch (error) { log(`invalid message: ${error?.message ?? error}`) }
    }
    index = buffer.indexOf('\n')
  }
})
process.stdin.on('end', () => shutdown(0))
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
process.on('uncaughtException', (error) => log(`uncaught: ${error?.stack ?? error}`))

async function shutdown(code) {
  try { if (studioChild && !studioChild.killed) studioChild.kill() } catch {}
  process.exit(code)
}
