import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  computeSafeZonePreflight,
  ensureRemotionJunction,
  resolveBinaries,
  resolveRemotionRuntime,
  RESTRICTED_COMMERCIAL_FONT_PATTERNS,
  runCommandRedirected,
} from '../shared/index.js'
import {
  analyzeFrozenFrames,
  analyzeJumpCuts,
  analyzeMotionActivity,
  buildSceneTimeline,
  buildTemporalQaChecks,
  collectIntentionalImpactTimes,
  collectTemporalSignals,
  DEFAULT_TEMPORAL_QA_OPTIONS,
  detectOutlierFrameBursts,
  detectPhotosensitiveFlashes,
} from './qa-detectors.js'
import { buildDeterminismCheck, runDeterminismCheck } from './determinism-check.js'

function parseFrameRate(rate, fallback = 30) {
  const m = /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(String(rate || '').trim())
  if (!m) return fallback
  const v = Number(m[1]) / (m[2] ? Number(m[2]) || 1 : 1)
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/**
 * Photosensitive-flash / frozen-frame / jump-cut analysis (one extra downscaled decode pass).
 */
export async function runTemporalQaAnalysis({ mp4Path, script, fps, durationSec, freezeThresholdSec, options = {}, signal } = {}) {
  const { ffmpeg } = resolveBinaries()
  const opts = { ...DEFAULT_TEMPORAL_QA_OPTIONS, ...options }
  const freezeSec = Number(freezeThresholdSec) > 0
    ? Number(freezeThresholdSec)
    : Number(process.env.DSH_QA_FREEZE_SEC) > 0
      ? Number(process.env.DSH_QA_FREEZE_SEC)
      : opts.freezeThresholdSec
  const sig = await collectTemporalSignals({
    ffmpeg,
    mp4Path,
    durationSec,
    freezeNoise: opts.freezeNoise,
    freezeMinSec: freezeSec,
    scdetThreshold: opts.scdetThreshold,
    signal,
  })
  const timeline = buildSceneTimeline(script || {}, fps)
  const impactTimes = collectIntentionalImpactTimes(script || {}, timeline)
  const flash = detectPhotosensitiveFlashes({
    grid: sig.grid,
    gridCells: sig.gridCells,
    frameCount: sig.frameCount,
    yavg: sig.yavg,
    fps,
    fullRange: sig.fullRange,
    intentionalTimes: impactTimes,
    options: opts,
  })
  const freeze = analyzeFrozenFrames({
    freezes: sig.freezes,
    timeline,
    totalSec: durationSec,
    thresholdSec: freezeSec,
    allowedIntervals: script?.qa?.allowedFreezes || [],
  })
  const jumps = analyzeJumpCuts({
    cuts: sig.cuts,
    timeline,
    fps,
    flashFrames: flash.softTransitionFrames,
    impactTimes,
    outlierBursts: detectOutlierFrameBursts({ grid: sig.grid, gridCells: sig.gridCells, frameCount: sig.frameCount }),
    toleranceFrames: opts.cutToleranceFrames,
  })
  const motion = analyzeMotionActivity({ ydif: sig.ydif, fps, timeline, cutTimes: (sig.cuts || []).map((c) => c.timeSec) })
  const { softTransitionFrames, ...flashReport } = flash
  return {
    flash: flashReport,
    freeze,
    jumps,
    motion,
    checks: buildTemporalQaChecks({ flash, freeze, jumps, motion }),
    frameCount: sig.frameCount,
    analysisMs: sig.analysisMs,
  }
}

/**
 * Scan LLM-generated TSX/HTML files for unsafe APIs, external links, hardcoded Windows paths, or Remotion/HyperFrames violations.
 */
export function scanAiGeneratedCodeSandbox(filesMap = {}, { engine = 'remotion', hasMasterAudio = true } = {}) {
  const errors = []
  const warnings = []

  const entries = Object.entries(filesMap || {})
  if (entries.length === 0) {
    errors.push('生成文件列表为空。')
    return { ok: false, errors, warnings }
  }

  for (const [relPath, rawCode] of entries) {
    const code = String(rawCode || '')
    if (!code.trim()) {
      errors.push(`${relPath}: 文件内容为空`)
      continue
    }

    if (/\b(?:child_process|node:fs|node:child_process|fs\/promises|worker_threads|node:vm)\b/.test(code) || /require\s*\(\s*['"]fs['"]\s*\)/.test(code)) {
      errors.push(`${relPath}: 禁止在前端视频代码中使用 Node fs / child_process / vm 等系统模块`)
    }
    if (/\beval\s*\(/.test(code) || /\bnew\s+Function\s*\(/.test(code)) {
      errors.push(`${relPath}: 禁止使用 eval() 或 new Function()`)
    }
    if (/<script[^>]+src\s*=\s*["']https?:\/\//i.test(code) || /@import\s+url\s*\(\s*["']https?:\/\//i.test(code)) {
      errors.push(`${relPath}: 禁止引用外网 CDN 脚本或在线样式表，请保持完全离线可渲染`)
    }
    if (/[A-Za-z]:\\(?:Users|Windows|Program Files|dsh)/i.test(code)) {
      errors.push(`${relPath}: 禁止硬编码本地盘符路径，请使用 staticFile() 或相对路径 assets/...`)
    }
    for (const rx of RESTRICTED_COMMERCIAL_FONT_PATTERNS) {
      if (rx.test(code)) {
        errors.push(`${relPath}: 禁止使用受限商业字体 (${rx.source})，请改用开源商用 Noto Sans SC / FONT_SANS`)
        break
      }
    }

    if (engine === 'remotion' && /\.(tsx|ts|jsx|js)$/i.test(relPath)) {
      if (/\bMath\.random\s*\(/.test(code)) {
        errors.push(`${relPath}: 禁止使用 Math.random()，请从 'remotion' 导入 deterministic random(seed)`)
      }
      if (/transition\s*:/i.test(code) || /@keyframes/i.test(code)) {
        errors.push(`${relPath}: Remotion 严禁出现 CSS transition 或 @keyframes，请改用 useCurrentFrame() + interpolate()/spring()`)
      }
    }

    if (engine === 'html' && /\.html?$/i.test(relPath)) {
      if (!/window\.__seekToFrame/.test(code)) {
        errors.push(`${relPath}: HyperFrames HTML 必须定义 window.__seekToFrame(frame) 供 Chromium CDP 逐帧渲染`)
      }
      if (!/window\.__totalFrames/.test(code)) {
        errors.push(`${relPath}: HyperFrames HTML 必须定义 window.__totalFrames`)
      }
      if (!/<script\s+id=["']dsh-script-data["']/i.test(code)) {
        errors.push(`${relPath}: 必须保留 <script id="dsh-script-data" type="application/json"> 标签占位符`)
      }
      if (!/<template\s+id=["']scene-/i.test(code) && !/data-scene-id=["']scene-/i.test(code)) {
        warnings.push(`${relPath}: 建议包含各分镜对应的 <template id="scene-XX"> 节点以匹配分镜检视`)
      }
      if (!/ai-badge/i.test(code)) {
        warnings.push(`${relPath}: 建议保留 #ai-badge 合规标注元素`)
      }
    }
  }

  if (engine === 'remotion') {
    const vc = filesMap['src/VideoComposition.tsx'] || filesMap['VideoComposition.tsx'] || ''
    if (!vc) {
      errors.push('缺少 src/VideoComposition.tsx 入口组件')
    } else {
      if (!/export\s+(?:const|function)\s+VideoComposition\b/.test(vc)) {
        errors.push('src/VideoComposition.tsx 必须命名导出 export const VideoComposition')
      }
      if (!/useCurrentFrame\s*\(/.test(vc) && !Object.values(filesMap).some((s) => /useCurrentFrame\s*\(/.test(String(s)))) {
        errors.push('Remotion 组件必须调用 useCurrentFrame() 驱动动画')
      }
      if (hasMasterAudio && !vc.includes('master-audio.wav')) {
        errors.push(`src/VideoComposition.tsx 必须通过 <Audio src={staticFile('master-audio.wav')} /> 挂载同步主音轨`)
      }
      if (!/AIBadge/.test(vc)) {
        warnings.push('建议在 src/VideoComposition.tsx 最外层保留 <AIBadge /> 合规角标与 <EndNotice />')
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

/**
 * Run strict TypeScript typechecking (`tsc --noEmit`) against a Remotion project directory.
 */
export async function runTypecheckOnProject(projectDir) {
  const { absDir, templateRoot, runtime } = ensureRemotionJunction(projectDir)
  const candidates = [
    join(absDir, 'node_modules', 'typescript', 'bin', 'tsc'),
    ...(runtime?.tscBin ? [runtime.tscBin] : []),
    ...(templateRoot ? [join(templateRoot, 'node_modules', 'typescript', 'bin', 'tsc')] : []),
  ]
  const tscBin = candidates.find((p) => existsSync(p))
  if (!tscBin) {
    return {
      ok: true,
      skipped: true,
      errorCount: 0,
      errors: [],
      message: '未找到 TypeScript 编译器，已跳过 tsc 检查',
    }
  }

  const tsConfigPath = join(absDir, 'tsconfig.preflight.json')
  writeFileSync(
    tsConfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: true,
          resolveJsonModule: true,
          esModuleInterop: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ['src/**/*'],
        exclude: ['node_modules', 'output', 'history', 'public'],
      },
      null,
      2,
    ),
    'utf8',
  )

  const res = await runCommandRedirected(
    process.execPath,
    [tscBin, '--noEmit', '-p', tsConfigPath],
    { cwd: absDir, timeoutMs: 45_000 },
  )

  const rawOutput = `${res.stdout || ''}\n${res.stderr || ''}`.trim()
  if (res.code === 0) {
    return {
      ok: true,
      skipped: false,
      errorCount: 0,
      errors: [],
      rawOutput: '',
    }
  }

  const lines = rawOutput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /error TS\d+:/i.test(l) || l.length > 0)
  const tsErrors = lines.filter((l) => /error TS\d+:/i.test(l)).slice(0, 20)

  return {
    ok: false,
    skipped: false,
    errorCount: tsErrors.length || lines.length,
    errors: tsErrors.length > 0 ? tsErrors : lines.slice(0, 15),
    rawOutput: rawOutput.slice(0, 3000),
  }
}

/**
 * Post-render automated FFmpeg quality audit (`ffprobe` + `blackdetect` + `ebur128` LUFS),
 * plus temporal checks (photosensitive flash risk · frozen frames · unplanned jump cuts)
 * and an optional `deep` determinism check (same frame rendered twice, pixel hashes compared).
 * Persists result to `output/qa_report.json`.
 */
/** QA entry for the render's exposure guard result (null when the guard did not run). */
export function buildExposureCheck(exposure) {
  if (!exposure || typeof exposure !== 'object') return null
  const pct = (y) => {
    if (!Number.isFinite(Number(y))) return '?'
    const lo = exposure.fullRange ? 0 : 16
    const hi = exposure.fullRange ? 255 : 235
    return `${Math.round(((Number(y) - lo) / (hi - lo)) * 100)}%`
  }
  const lifted = Array.isArray(exposure.lifted) ? exposure.lifted : []
  if (exposure.applied) {
    return {
      name: '画面亮度可读性（过暗镜头自动提亮）',
      passed: true,
      value: `${lifted.length} 个过暗镜头已提亮（全片平均亮度 ${pct(exposure.before?.meanY)} → ${pct(exposure.after?.meanY)}，黑白场不变）`,
    }
  }
  if (exposure.reason === 'within-range') {
    return { name: '画面亮度可读性（过暗镜头自动提亮）', passed: true, value: `全片平均亮度 ${pct(exposure.before?.meanY)}，无过暗镜头` }
  }
  if (exposure.reason === 'error' && lifted.length) {
    return {
      name: '画面亮度可读性（过暗镜头自动提亮）',
      passed: false,
      severity: 'warning',
      value: `${lifted.length} 个镜头过暗（最暗约 ${pct(exposure.before?.darkestMeanY)}），自动提亮未完成：${String(exposure.error || '').slice(0, 120)}`,
    }
  }
  return null
}

export async function runPostRenderQa({
  projectDir,
  mp4Path,
  script,
  expectedWidth,
  expectedHeight,
  deep = false,
  temporal,
  freezeThresholdSec,
  temporalOptions = {},
  determinismFrames,
  exposure = null,
  signal,
}) {
  const absDir = resolve(projectDir)
  const targetMp4 = mp4Path ? resolve(mp4Path) : join(absDir, 'output', 'final.mp4')
  const qaOutPath = join(absDir, 'output', 'qa_report.json')
  mkdirSync(dirname(qaOutPath), { recursive: true })

  if (!existsSync(targetMp4)) {
    const emptyReport = {
      ok: false,
      passed: false,
      mp4Path: targetMp4,
      errors: ['成片 MP4 文件不存在'],
      checks: [],
      checkedAt: new Date().toISOString(),
    }
    writeFileSync(qaOutPath, JSON.stringify(emptyReport, null, 2) + '\n', 'utf8')
    return emptyReport
  }

  const { ffmpeg, ffprobe } = resolveBinaries()
  const probeRes = await runCommandRedirected(
    ffprobe,
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', targetMp4],
    { timeoutMs: 30_000 },
  )
  let probeJson = {}
  try {
    probeJson = JSON.parse(probeRes.stdout || '{}')
  } catch {}

  const streams = Array.isArray(probeJson.streams) ? probeJson.streams : []
  const vStream = streams.find((s) => s.codec_type === 'video') || {}
  const aStream = streams.find((s) => s.codec_type === 'audio') || {}
  const actualDurationSec = Number(probeJson.format?.duration || 0)
  const expectedDurationSec = Number(script?.totalDurationSec || actualDurationSec)
  const durationDiffSec = Number(Math.abs(actualDurationSec - expectedDurationSec).toFixed(3))

  // Run blackdetect + EBU R128 loudness in a single FFmpeg analysis pass
  const filterRes = await runCommandRedirected(
    ffmpeg,
    [
      '-hide_banner',
      '-nostats',
      '-i',
      targetMp4,
      '-vf',
      'blackdetect=d=0.45:pix_th=0.06',
      '-af',
      'ebur128=peak=true',
      '-f',
      'null',
      '-',
    ],
    { timeoutMs: Math.max(120_000, Math.round((expectedDurationSec || 60) * 2000)) },
  )
  const logText = `${filterRes.stderr || ''}\n${filterRes.stdout || ''}`

  const blackSegments = []
  for (const m of logText.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)) {
    const startSec = Number(m[1])
    const endSec = Number(m[2])
    const durationSec = Number(m[3])
    // Ignore sub-0.5s or very end fade-out tails in last 0.6s
    if (durationSec >= 0.5 && startSec < Math.max(0.5, actualDurationSec - 0.6)) {
      blackSegments.push({ startSec, endSec, durationSec })
    }
  }

  const lufsMatches = [...logText.matchAll(/^\s*I:\s*([-\d.]+)\s*LUFS/gm)]
  const lraMatches = [...logText.matchAll(/^\s*LRA:\s*([-\d.]+)\s*LU/gm)]
  const peakMatches = [...logText.matchAll(/^\s*Peak:\s*([-\d.]+)\s*dBFS/gm)]

  const integratedLufs = lufsMatches.length ? Number(lufsMatches[lufsMatches.length - 1][1]) : null
  const rangeLu = lraMatches.length ? Number(lraMatches[lraMatches.length - 1][1]) : null
  const truePeakDbtp = peakMatches.length ? Number(peakMatches[peakMatches.length - 1][1]) : null

  const expectedW = Number(expectedWidth) || Number(script?.width) || Number(vStream.width) || 1920
  const expectedH = Number(expectedHeight) || Number(script?.height) || Number(vStream.height) || 1080
  const actualW = Number(vStream.width || 0)
  const actualH = Number(vStream.height || 0)
  const exactSizeMatch = actualW === expectedW && actualH === expectedH
  const proportionalDraftMatch =
    actualW >= 480 &&
    actualH >= 480 &&
    Math.abs(actualW / Math.max(1, actualH) - expectedW / Math.max(1, expectedH)) <= 0.03

  const checks = [
    {
      name: '分辨率与像素格式 (H.264 yuv420p)',
      passed:
        (exactSizeMatch || proportionalDraftMatch) &&
        vStream.codec_name === 'h264' &&
        (vStream.pix_fmt === 'yuv420p' || vStream.pix_fmt === 'yuvj420p'),
      value: exactSizeMatch
        ? `${actualW}×${actualH} · ${vStream.codec_name || '?'}/${vStream.pix_fmt || '?'} (完全匹配)`
        : `${actualW}×${actualH} · ${vStream.codec_name || '?'}/${vStream.pix_fmt || '?'} (${proportionalDraftMatch ? '同比例缩放渲染' : `期望 ${expectedW}×${expectedH}`})`,
    },
    {
      name: 'AAC 立体声音频轨 (48kHz)',
      passed: aStream.codec_name === 'aac' && Number(aStream.sample_rate) >= 44100,
      value: aStream.codec_name ? `${aStream.codec_name} · ${aStream.sample_rate} Hz` : '无音轨',
    },
    {
      name: '成片与配音时长同步 (偏差 ≤ 0.45s)',
      passed: durationDiffSec <= 0.45 && actualDurationSec > 0.5,
      value: `实测 ${actualDurationSec.toFixed(2)}s / 规划 ${expectedDurationSec.toFixed(2)}s (Δ=${durationDiffSec}s)`,
    },
    {
      name: '异常黑屏检测 (blackdetect)',
      passed: blackSegments.length === 0,
      value:
        blackSegments.length === 0
          ? '全程零异常黑屏'
          : `发现 ${blackSegments.length} 处连续黑屏 (${blackSegments.map((b) => `${b.startSec.toFixed(1)}s`).join(', ')})`,
    },
    {
      name: '响度与峰值标准 (EBU R128)',
      // Delivered (AAC-encoded) true peak must keep headroom so platform re-encodes cannot clip (≤ -0.5 dBTP)
      passed:
        integratedLufs === null ||
        (integratedLufs >= -24 && integratedLufs <= -7.5 && (truePeakDbtp === null || truePeakDbtp <= -0.5)),
      value:
        integratedLufs !== null
          ? `响度 ${integratedLufs.toFixed(1)} LUFS · 峰值 ${(truePeakDbtp ?? 0).toFixed(1)} dBTP · LRA ${(rangeLu ?? 0).toFixed(1)} LU${truePeakDbtp !== null && truePeakDbtp > -0.5 ? '（峰值过高，平台转码可能削波）' : ''}`
          : '音轨响度分析完成',
    },
  ]

  // Check Platform Safe-Zone Preflight + Commercial OFL Font Bundle
  const htmlPath = join(absDir, 'index.html')
  const htmlContent = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : ''
  const safeZonePreflight = computeSafeZonePreflight(script || { width: actualW, height: actualH }, { htmlContent })
  const hasOflFont =
    existsSync(join(absDir, 'fonts', 'NotoSansSC-VF.woff2')) ||
    existsSync(join(absDir, 'public', 'fonts', 'NotoSansSC-VF.woff2'))
  checks.push({
    name: `商用字体与平台安全区 (${safeZonePreflight.platformLabel})`,
    passed: safeZonePreflight.passed && hasOflFont,
    value:
      safeZonePreflight.passed && hasOflFont
        ? `SIL OFL Noto Sans SC 已就绪 · 字幕安全边距 ${safeZonePreflight.recommendedSubtitleBottomPx}px`
        : !hasOflFont
          ? '缺少 bundled NotoSansSC-VF.woff2'
          : safeZonePreflight.collisions.map((c) => c.suggestion).join('; '),
  })

  // Exposure: the render's exposure guard measured every shot (and lifted unreadably dark ones)
  const expCheck = buildExposureCheck(exposure)
  if (expCheck) checks.push(expCheck)

  // Generate compact 3x3 verification contact sheet directly from final MP4
  const contactSheetOut = join(absDir, 'output', 'snapshot-3x3.png')
  if (actualDurationSec > 0.5 && actualW > 0 && actualH > 0) {
    const sampleFps = Math.max(0.15, Number((9 / Math.max(1, actualDurationSec)).toFixed(4)))
    const thumbW = actualW < actualH ? 360 : 540
    await runCommandRedirected(
      ffmpeg,
      [
        '-y',
        '-i',
        targetMp4,
        '-vf',
        `fps=${sampleFps},scale=${thumbW}:-2,tile=3x3:padding=8:margin=8:color=0x0b1020`,
        '-frames:v',
        '1',
        contactSheetOut,
      ],
      { timeoutMs: 30_000 },
    ).catch(() => {})
  }
  const hasContactSheet = existsSync(contactSheetOut) || existsSync(join(absDir, 'snapshot-3x3.png'))
  checks.push({
    name: '成片抽帧 3×3 视觉质检墙',
    passed: hasContactSheet,
    value: hasContactSheet ? '已生成 3×3 成片抽帧对比图' : '未生成抽帧图',
  })

  // Temporal checks run on every QA (one extra 320px decode pass ≈ 20–25× realtime); DSH_QA_TEMPORAL=0 disables
  let temporalReport = null
  const temporalEnabled = temporal !== undefined ? Boolean(temporal) : process.env.DSH_QA_TEMPORAL !== '0'
  if (temporalEnabled && vStream.codec_name && actualDurationSec > 0.3) {
    const videoFps = parseFrameRate(vStream.avg_frame_rate || vStream.r_frame_rate, Number(script?.fps) || 30)
    try {
      temporalReport = await runTemporalQaAnalysis({
        mp4Path: targetMp4,
        script,
        fps: videoFps,
        durationSec: actualDurationSec,
        freezeThresholdSec,
        options: temporalOptions,
        signal,
      })
      checks.push(...temporalReport.checks)
    } catch (err) {
      if (signal?.aborted) throw err
      checks.push({
        name: '时序质检 (闪烁/冻结/跳帧)',
        passed: true,
        severity: 'skipped',
        value: `已跳过：${String(err?.message || err).slice(0, 160)}`,
      })
    }
  }

  let determinism = null
  if (deep) {
    try {
      determinism = await runDeterminismCheck({
        projectDir: absDir,
        script,
        engine: script?.engine,
        frames: determinismFrames,
        signal,
      })
    } catch (err) {
      if (signal?.aborted) throw err
      determinism = { ok: false, error: String(err?.message || err).slice(0, 240) }
    }
    const detCheck = buildDeterminismCheck(determinism)
    if (detCheck) checks.push(detCheck)
  }

  const passed = checks.every((c) => c.passed)
  const report = {
    ok: true,
    passed,
    mp4Path: targetMp4,
    qaReportPath: qaOutPath,
    frameWallPath: existsSync(contactSheetOut) ? contactSheetOut : join(absDir, 'snapshot-3x3.png'),
    safeZonePreflight,
    videoMeta: {
      width: actualW,
      height: actualH,
      codec: vStream.codec_name || '',
      pixFmt: vStream.pix_fmt || '',
      durationSec: Number(actualDurationSec.toFixed(3)),
      audioCodec: aStream.codec_name || '',
      sampleRate: Number(aStream.sample_rate || 0),
    },
    loudness: { integratedLufs, rangeLu, truePeakDbtp },
    blackSegments,
    photosensitivity: temporalReport?.flash || null,
    frozenFrames: temporalReport?.freeze || null,
    jumpCuts: temporalReport?.jumps || null,
    motionActivity: temporalReport?.motion ? { ...temporalReport.motion, perSec: undefined } : null,
    temporalAnalysisMs: temporalReport?.analysisMs ?? null,
    determinism,
    deep: Boolean(deep),
    warnings: checks.filter((c) => c.severity === 'warning').map((c) => `${c.name}：${c.value}`),
    checks,
    checkedAt: new Date().toISOString(),
  }

  writeFileSync(qaOutPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  return report
}
