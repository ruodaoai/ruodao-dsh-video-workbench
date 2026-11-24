/**
 * Cross-platform Hardware Preflight & Low-Spec Computer Protection Guard.
 * Ensures users on 8GB RAM / integrated-GPU / CPU-only laptops can run DSH Video Workbench
 * reliably without OOM crashes, WebGL context loss, FFmpeg thermal freezes, or misleading blocks.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statfsSync, writeFileSync } from 'node:fs'
import { cpus, freemem, totalmem } from 'node:os'
import { join } from 'node:path'

export const HARDWARE_PREF_FILENAME = '.dsh-video-hardware-pref.json'

export const HARDWARE_REQUIREMENTS = {
  minimum: {
    id: 'minimum',
    tierLabel: '最低运行配置（开启低配保护模式可用）',
    cpu: '4 核 / 4 线程及以上处理器',
    ram: '8 GB 内存（建议可用空间 ≥ 2.5 GB）',
    gpu: '集成显卡 / 无独立显卡均可（Three.js 基于 2D 安全光栅化，无 WebGL 崩溃风险；配音可选系统原生语音或 Edge-TTS / 纯音乐卡点）',
    disk: '3 GB 及以上可用磁盘空间',
    recommendedRender: '720p · 30fps · 单并发低内存安全模式',
  },
  recommended: {
    id: 'recommended',
    tierLabel: '流畅推荐配置',
    cpu: '8 核及以上处理器（Intel i5 / AMD Ryzen 5 及以上）',
    ram: '16 GB 内存（建议可用内存 ≥ 5.5 GB）',
    gpu: 'NVIDIA 6GB–8GB+ 显存显卡（流畅运行本地 IndexTTS-2.5 / GPT-SoVITS 克隆配音与 1080p60 渲染）',
    disk: '10 GB 及以上可用空间',
    recommendedRender: '1080p · 30fps / 60fps · 双引擎全功能开启',
  },
  flagship: {
    id: 'flagship',
    tierLabel: '4K 旗舰影视配置',
    cpu: '12 核 / 16 核及以上高频处理器',
    ram: '32 GB 及以上内存',
    gpu: 'NVIDIA RTX 8GB–16GB+ 显存显卡',
    disk: '20 GB 及以上 SSD 可用空间',
    recommendedRender: '2K / 4K · 60fps · 多并发高速渲染',
  },
}

const VIRTUAL_GPU_RX = /oray|todesk|gameviewer|parsec|virtual|remote|mirror|rdp|umin/i

let cachedProbe = null
let cachedAtMs = 0

function detectNvidiaSmiGpus() {
  try {
    const out = execFileSync(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 1500 },
    )
    const gpus = []
    for (const line of String(out || '').split(/\r?\n/)) {
      const parts = line.split(',').map((s) => s.trim())
      if (parts.length >= 2 && parts[0]) {
        const totalMb = Number(parts[1]) || 0
        const freeMb = Number(parts[2]) || 0
        gpus.push({
          name: parts[0],
          vendor: 'nvidia',
          vramGB: Number((totalMb / 1024).toFixed(2)),
          freeVramGB: Number((freeMb / 1024).toFixed(2)),
          dedicated: true,
        })
      }
    }
    return gpus
  } catch {
    return []
  }
}

function detectWindowsVideoControllers() {
  if (process.platform !== 'win32') return []
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 2200 },
    )
    const raw = JSON.parse(String(out || '[]'))
    const arr = Array.isArray(raw) ? raw : [raw]
    return arr
      .filter((x) => x && x.Name && !VIRTUAL_GPU_RX.test(String(x.Name)))
      .map((x) => {
        const bytes = Number(x.AdapterRAM) || 0
        const gb = Number((bytes / 1024 ** 3).toFixed(2))
        const isNvidiaOrAmdRx = /nvidia|geforce|rtx|gtx|radeon rx|arc a\d|arc b\d/i.test(String(x.Name))
        return {
          name: String(x.Name).trim(),
          vendor: /nvidia/i.test(x.Name) ? 'nvidia' : /amd|radeon/i.test(x.Name) ? 'amd' : /intel/i.test(x.Name) ? 'intel' : 'other',
          vramGB: gb,
          dedicated: isNvidiaOrAmdRx || gb >= 3.5,
        }
      })
  } catch {
    return []
  }
}

function getFreeDiskGb(targetPath) {
  try {
    const st = statfsSync(targetPath)
    if (st && st.bavail && st.bsize) {
      return Number(((st.bavail * st.bsize) / 1024 ** 3).toFixed(2))
    }
  } catch {}
  return null
}

/**
 * Inspect live host CPU, RAM, GPU/VRAM, Disk, and capability verdicts.
 */
export function probeHardwareProfile({ targetDir = process.cwd(), forceRefresh = false } = {}) {
  const now = Date.now()
  if (!forceRefresh && cachedProbe && now - cachedAtMs < 15_000) {
    return cachedProbe
  }

  const cpuList = cpus() || []
  const cpuThreads = cpuList.length || 4
  const cpuModel = String(cpuList[0]?.model || 'Unknown CPU').trim()
  const totalRamGB = Number((totalmem() / 1024 ** 3).toFixed(2))
  const freeRamGB = Number((freemem() / 1024 ** 3).toFixed(2))
  const freeDiskGB = getFreeDiskGb(targetDir)

  const nvGpus = detectNvidiaSmiGpus()
  const wmiGpus = detectWindowsVideoControllers()

  // Merge GPU list favoring nvidia-smi exact VRAM (since WMI AdapterRAM caps at uint32 4GB)
  const mergedMap = new Map()
  for (const g of wmiGpus) mergedMap.set(g.name.toLowerCase(), g)
  for (const g of nvGpus) mergedMap.set(g.name.toLowerCase(), g)
  const gpus = Array.from(mergedMap.values())

  const dedicatedGpus = gpus.filter((g) => g.dedicated)
  const primaryGpu =
    dedicatedGpus.sort((a, b) => (b.vramGB || 0) - (a.vramGB || 0))[0] ||
    gpus[0] || { name: '通用显卡 / 核显', vendor: 'integrated', vramGB: 0, dedicated: false }
  const maxVramGB = Number(primaryGpu?.vramGB || 0)
  const hasNvidiaCuda = nvGpus.length > 0

  const hasLowCpu = cpuThreads < 6
  const hasLowTotalRam = totalRamGB < 11.5
  const hasLowFreeRam = freeRamGB < 3.2
  const hasLowVram = !hasNvidiaCuda || maxVramGB < 3.5

  let tier = 'standard'
  let tierLabel = '标准均衡配置'
  if (totalRamGB < 11.5 || cpuThreads < 6 || freeRamGB < 2.8) {
    tier = 'low-spec'
    tierLabel = '轻量低配电脑（已自动适配低配保护）'
  } else if (totalRamGB >= 15.5 && cpuThreads >= 8 && hasNvidiaCuda && maxVramGB >= 6 && freeRamGB >= 4.5) {
    tier = 'high'
    tierLabel = '高配流畅配置（旗舰全功能）'
  } else if (hasLowVram) {
    tierLabel = '核显/轻量显卡配置（画面完整可用 · 配音建议选轻量/CPU方案）'
  }

  let ttsAdvice = '本机显存充裕，可流畅运行本地 IndexTTS-2.5 高保真声音克隆。'
  let recommendedTtsEngine = 'indextts25'
  if (!hasNvidiaCuda || maxVramGB < 3.5) {
    ttsAdvice =
      '检测到当前无 4GB+ NVIDIA 独立显存：建议在「配音引擎中心」一键切换为「Windows 系统原生语音 (0显存纯CPU)」、「Edge-TTS 纯CPU」或选择「纯音乐卡点 (免TTS)」，无需显卡同样流畅出片！'
    recommendedTtsEngine = 'windows-sapi-cpu'
  } else if (maxVramGB < 7.5) {
    ttsAdvice =
      '检测到当前独立显存约 4–6GB：推荐使用「GPT-SoVITS (低显存轻量版)」、「Windows 原生语音」或「Edge-TTS」，比加载大模型更稳更省内存。'
    recommendedTtsEngine = 'gptvoice'
  }

  const criticalBlocker =
    totalRamGB < 3.5
      ? '本机物理内存低于 4GB，可能无法顺利启动浏览器渲染进程。'
      : freeDiskGB !== null && freeDiskGB < 0.8
        ? `当前磁盘剩余空间仅 ${freeDiskGB} GB，请至少清理出 2 GB 以上空间再渲染视频。`
        : ''

  const canRun = !criticalBlocker
  const verdictTitle = criticalBlocker
    ? '⚠ 空间或极低内存告警'
    : tier === 'low-spec'
      ? '🛡 可用（已启用低配保护模式）'
      : hasLowVram
        ? '✓ 画面渲染可用 · 推荐轻量/纯CPU配音'
        : '✓ 配置达标 · 全功能畅享运行'

  const verdictSummary = criticalBlocker
    ? criticalBlocker
    : tier === 'low-spec'
      ? '您的电脑满足最低配置要求！工作台会自动限制并发进程数、减少缓存占用并关闭超重渲染负载，8GB 内存 / 核显电脑也可稳定出片。'
      : '本机硬件足以运行 Remotion + Three.js 3D 与 HTML5 双引擎渲染；当空闲内存偏紧时低配保护会自动介入防卡死。'

  const result = {
    probedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    cpu: { model: cpuModel, threads: cpuThreads },
    memory: { totalGB: totalRamGB, freeGB: freeRamGB },
    disk: { freeGB: freeDiskGB },
    gpu: {
      primaryName: primaryGpu.name,
      vendor: primaryGpu.vendor,
      vramGB: maxVramGB,
      hasNvidiaCuda,
      hasDedicatedGpu: Boolean(primaryGpu.dedicated),
      all: gpus,
    },
    tier,
    tierLabel,
    canRun,
    criticalBlocker,
    verdictTitle,
    verdictSummary,
    ttsAdvice,
    recommendedTtsEngine,
    checks: {
      cpuOk: cpuThreads >= 4,
      ramOk: totalRamGB >= 7.5,
      freeRamOk: freeRamGB >= 2.0,
      diskOk: freeDiskGB === null || freeDiskGB >= 2.5,
      localGpuTtsReady: hasNvidiaCuda && maxVramGB >= 4.0,
    },
    requirements: HARDWARE_REQUIREMENTS,
  }

  cachedProbe = result
  cachedAtMs = now
  return result
}

export function loadHardwarePreferences(repoRoot) {
  const prefPath = join(repoRoot, HARDWARE_PREF_FILENAME)
  let raw = {}
  if (existsSync(prefPath)) {
    try {
      raw = JSON.parse(readFileSync(prefPath, 'utf8')) || {}
    } catch {}
  }
  const mode = ['auto', 'safe', 'performance'].includes(String(raw.lowSpecMode || '').toLowerCase())
    ? String(raw.lowSpecMode).toLowerCase()
    : 'auto'
  return {
    lowSpecMode: mode,
    updatedAt: raw.updatedAt || null,
    prefPath,
  }
}

export function saveHardwarePreferences(repoRoot, patch = {}) {
  const cur = loadHardwarePreferences(repoRoot)
  const nextMode = ['auto', 'safe', 'performance'].includes(String(patch.lowSpecMode || '').toLowerCase())
    ? String(patch.lowSpecMode).toLowerCase()
    : cur.lowSpecMode
  const next = {
    lowSpecMode: nextMode,
    updatedAt: new Date().toISOString(),
  }
  try {
    writeFileSync(cur.prefPath, JSON.stringify(next, null, 2) + '\n', 'utf8')
  } catch {}
  return { ...next, prefPath: cur.prefPath }
}

/**
 * Compute deterministic Low-Spec Protection resource limits from live hardware & user preference.
 */
export function resolveLowSpecPolicy({
  repoRoot,
  hardware = null,
  modePref = '',
  requestedQuality = '1080p',
  requestedFps = 30,
  totalDurationSec = 0,
} = {}) {
  const hw = hardware || probeHardwareProfile({ targetDir: repoRoot })
  const savedPref = repoRoot ? loadHardwarePreferences(repoRoot).lowSpecMode : 'auto'
  const pref = ['auto', 'safe', 'performance'].includes(String(modePref || '').toLowerCase())
    ? String(modePref).toLowerCase()
    : savedPref

  const lowFreeMemRightNow = hw.memory.freeGB > 0 && hw.memory.freeGB < 3.6
  const lowTotalHardware = hw.tier === 'low-spec'
  const engageSafe = pref === 'safe' || (pref === 'auto' && (lowTotalHardware || lowFreeMemRightNow))
  const engageStandardClamp =
    !engageSafe &&
    pref === 'auto' &&
    (hw.tier === 'standard' || (hw.memory.freeGB > 0 && hw.memory.freeGB < 6.0))

  const reqQ = String(requestedQuality || '1080p').toLowerCase()
  const reqF = Number(requestedFps) || 30
  let effectiveQuality = reqQ
  let effectiveFps = reqF
  const clampedFields = []

  // Protect low-spec hardware from OOM on 4K/2K/60fps while preserving normal 1080p on high-RAM PCs
  if (pref === 'safe' || (pref === 'auto' && lowTotalHardware)) {
    if (reqQ === '4k' || reqQ === '2k') {
      effectiveQuality = hw.memory.totalGB < 10 ? '720p' : '1080p'
      clampedFields.push(`画质 ${reqQ.toUpperCase()}→${effectiveQuality.toUpperCase()}`)
    } else if (reqQ === '1080p' && hw.memory.totalGB < 9.5) {
      effectiveQuality = '720p'
      clampedFields.push('画质 1080P→720P (8GB 内存防爆内存)')
    }
    if (reqF > 30) {
      effectiveFps = 30
      clampedFields.push(`帧率 ${reqF}fps→30fps`)
    }
  } else if (engageStandardClamp && reqQ === '4k') {
    effectiveQuality = '2k'
    clampedFields.push('可用内存偏紧：画质 4K→2K')
  }

  const durHint = Math.max(20, Number(totalDurationSec) || 60)

  if (engageSafe) {
    return {
      pref,
      profileMode: 'safe',
      lowSpecSafe: true,
      remotionConcurrency: 1,
      offthreadVideoThreads: 1,
      offthreadVideoCacheSizeInBytes: 128 * 1024 * 1024,
      delayRenderTimeoutMs: Math.max(180_000, Math.round(durHint * 1200)),
      chromiumGl: hw.gpu.hasDedicatedGpu ? 'angle' : 'swangle',
      ffmpegThreads: Math.max(2, Math.min(4, Math.floor(hw.cpu.threads / 2))),
      ffmpegPreset: 'veryfast',
      batchCoderConcurrency: 2,
      effectiveQuality,
      effectiveFps,
      clampedFields,
      reason:
        pref === 'safe'
          ? '已开启「手动强制低配保护」：单并发渲染 + 128MB 轻缓存 + 3D 粒子减载 + FFmpeg 限线程防卡死'
          : `低配保护自动激活 (${hw.memory.freeGB}GB 可用内存 / ${hw.cpu.threads} 线程)：单并发渲染 + 轻量内存上限`,
    }
  }

  if (engageStandardClamp || pref === 'auto') {
    const conc =
      hw.tier === 'high' && hw.memory.freeGB >= 7.5
        ? Math.max(1, Math.min(3, Math.floor(hw.cpu.threads / 4)))
        : hw.memory.freeGB >= 4.2
          ? Math.max(1, Math.min(2, Math.floor(hw.cpu.threads / 6)))
          : 1
    return {
      pref,
      profileMode: conc === 1 ? 'balanced-1x' : 'standard',
      lowSpecSafe: false,
      remotionConcurrency: conc,
      offthreadVideoThreads: conc > 1 ? 2 : 1,
      offthreadVideoCacheSizeInBytes: conc > 1 ? 256 * 1024 * 1024 : 192 * 1024 * 1024,
      delayRenderTimeoutMs: Math.max(120_000, Math.round(durHint * 900)),
      chromiumGl: hw.gpu.hasDedicatedGpu ? 'angle' : 'swangle',
      ffmpegThreads: Math.max(2, Math.min(8, Math.floor(hw.cpu.threads / 2))),
      ffmpegPreset: 'medium',
      batchCoderConcurrency: conc > 1 ? 3 : 2,
      effectiveQuality,
      effectiveFps,
      clampedFields,
      reason: `智能自适应调度 (${hw.tierLabel} · Remotion ${conc} 并发 · 空闲内存 ${hw.memory.freeGB}GB)`,
    }
  }

  // Forced performance mode
  const perfConc = Math.max(1, Math.min(3, Math.floor(hw.cpu.threads / 4)))
  return {
    pref,
    profileMode: 'performance',
    lowSpecSafe: false,
    remotionConcurrency: perfConc,
    offthreadVideoThreads: 2,
    offthreadVideoCacheSizeInBytes: 512 * 1024 * 1024,
    delayRenderTimeoutMs: Math.max(90_000, Math.round(durHint * 800)),
    chromiumGl: 'angle',
    ffmpegThreads: 0,
    ffmpegPreset: 'medium',
    batchCoderConcurrency: 4,
    effectiveQuality,
    effectiveFps,
    clampedFields,
    reason: `全速性能模式 (Remotion ${perfConc} 并发 · 512MB 缓存)`,
  }
}
