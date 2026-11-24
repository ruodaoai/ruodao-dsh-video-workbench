import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import {
  computeSafeZonePreflight,
  ensureWin11ProjectGuards,
  loadEnv,
  readScriptJson,
  REPO_ROOT,
  resolveBinaries,
  resolveBrowserExecutable,
  resolveEnvPath,
  RESTRICTED_COMMERCIAL_FONT_PATTERNS,
  runCommandRedirected,
  syncProjectFonts,
  writeScriptJson,
} from '../shared/index.js'
import { readAssets } from '../dsh-tool-media/asset-manager.js'
import { mixVideoAudio } from '../dsh-tool-media/audio-synth.js'
import {
  syncRemotionPublicAssets,
  writeRemotionProjectFiles,
} from '../dsh-tool-media/remotion-generator.js'
import {
  captureHtmlSnapshots,
  computeRemotionOutputSize,
  renderHtmlVideoToMp4,
  renderRemotionProject,
  resolveCompositionAudioPlan,
} from './frame-renderer.js'
import { enforceAudioTruePeak } from './true-peak-guard.js'
import { enforceExposure } from './exposure-guard.js'
import {
  runPostRenderQa,
  runTemporalQaAnalysis,
  runTypecheckOnProject,
  scanAiGeneratedCodeSandbox,
} from './qa-checker.js'
import { DELIVERY_FORMATS, exportProjectPackage } from './delivery-export.js'
import { applyColorLut, applyProjectColorLut, BUILTIN_LUTS, listColorLuts, renderVideoScopes, SCOPE_KINDS } from './color-tools.js'

export { resolveBrowserExecutable, runPostRenderQa, runTemporalQaAnalysis, runTypecheckOnProject, scanAiGeneratedCodeSandbox }
export { applyColorLut, applyProjectColorLut, exportProjectPackage, listColorLuts, renderVideoScopes }

/**
 * Parse hex color (#RRGGBB or #RGB) to relative luminance per WCAG 2.1.
 */
function parseHexLuminance(hex) {
  const clean = String(hex || '').trim().replace(/^#/, '')
  let r = 0, g = 0, b = 0
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16)
    g = parseInt(clean[1] + clean[1], 16)
    b = parseInt(clean[2] + clean[2], 16)
  } else if (clean.length >= 6) {
    r = parseInt(clean.slice(0, 2), 16)
    g = parseInt(clean.slice(2, 4), 16)
    b = parseInt(clean.slice(4, 6), 16)
  } else {
    return null
  }
  if ([r, g, b].some((v) => Number.isNaN(v))) return null
  const toLinear = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

export function computeContrastRatio(hexA, hexB) {
  const lumA = parseHexLuminance(hexA)
  const lumB = parseHexLuminance(hexB)
  if (lumA === null || lumB === null) return null
  const lighter = Math.max(lumA, lumB)
  const darker = Math.min(lumA, lumB)
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2))
}

/**
 * 1. `video_lint` implementation (HTML & Remotion dual-engine validator)
 */
export async function executeVideoLint(args = {}) {
  loadEnv()
  const targetDir = isAbsolute(args.projectDir || '.')
    ? args.projectDir
    : resolve(REPO_ROOT, args.projectDir || '.')

  ensureWin11ProjectGuards(targetDir)
  const { data: script } = readScriptJson(targetDir)
  const engine = args.engine || script.engine || 'html'

  const errors = []
  const warnings = []
  const checks = []

  // Check 1: Theme WCAG AA Contrast Ratio
  const theme = script.theme || {}
  const bg = theme.background || '#0B1020'
  const fg = theme.textPrimary || '#F8FAFC'
  const ratio = computeContrastRatio(bg, fg)
  if (ratio !== null) {
    const passed = ratio >= 4.5
    checks.push({
      name: 'WCAG AA Text Contrast (textPrimary vs background)',
      passed,
      value: `${ratio}:1 (minimum 4.5:1)`,
    })
    if (!passed) {
      errors.push(
        `WCAG AA contrast check failed: textPrimary (${fg}) on background (${bg}) is ${ratio}:1 (< 4.5:1).`,
      )
    }
  }

  if (engine === 'html') {
    const htmlPath = join(targetDir, args.entryFile || 'index.html')
    if (!existsSync(htmlPath)) {
      errors.push(`HTML entry file not found: ${htmlPath}`)
    } else {
      const html = readFileSync(htmlPath, 'utf8')

      // Check <template> or data-scene-id scene wrapping
      const templateMatches = [...html.matchAll(/<template\b[^>]*>|data-scene-id=/gi)]
      const hasTemplates = templateMatches.length > 0
      checks.push({
        name: 'HTML Scene Isolation (<template> / data-scene-id)',
        passed: hasTemplates,
        value: `${templateMatches.length} scene block(s) found`,
      })
      if (!hasTemplates) {
        errors.push(
          'HTML mode requires each scene to use `<template id="scene-XX">` or `data-scene-id="scene-XX"` to prevent DOM/CSS collisions.',
        )
      }

      // Check SVG <defs> & DOM ID collisions across document (strip <script> blocks and ignore data-* attributes)
      const htmlWithoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      const idMatches = [...htmlWithoutScripts.matchAll(/(?<![-\w])id=["']([^"']+)["']/gi)].map((m) => m[1])
      const seenIds = new Set()
      const duplicateIds = new Set()
      for (const id of idMatches) {
        if (seenIds.has(id)) duplicateIds.add(id)
        seenIds.add(id)
      }
      const noDupIds = duplicateIds.size === 0
      checks.push({
        name: 'DOM & SVG <defs> ID Uniqueness',
        passed: noDupIds,
        value: noDupIds ? '0 collisions' : `Duplicate IDs: ${[...duplicateIds].join(', ')}`,
      })
      if (!noDupIds) {
        errors.push(`Duplicate DOM/SVG IDs detected: ${[...duplicateIds].join(', ')}`)
      }

      // Commercial Open-Source Font Whitelist check (SIL OFL Noto Sans SC + JetBrains Mono)
      syncProjectFonts(targetDir)
      const hasCommercialFont = /Noto Sans SC|Source Han (?:Sans|Serif) SC|Alibaba PuHuiTi|HarmonyOS Sans/i.test(html)
      const restrictedFontsFound = RESTRICTED_COMMERCIAL_FONT_PATTERNS.filter((rx) => rx.test(html)).map((rx) => rx.source)
      const fontPolicyPassed = hasCommercialFont && restrictedFontsFound.length === 0
      checks.push({
        name: 'Commercial Font Whitelist (SIL OFL Noto Sans SC)',
        passed: fontPolicyPassed,
        value: fontPolicyPassed
          ? 'Noto Sans SC (SIL OFL 1.1) Verified'
          : restrictedFontsFound.length > 0
            ? `Restricted non-OFL font detected: ${restrictedFontsFound.join(', ')}`
            : 'Missing bundled Noto Sans SC font stack',
      })
      if (restrictedFontsFound.length > 0) {
        errors.push(`Restricted commercial font declared (${restrictedFontsFound.join(', ')}); use bundled SIL OFL Noto Sans SC instead.`)
      } else if (!hasCommercialFont) {
        warnings.push('Recommend declaring `Noto Sans SC` with `@font-face { src: url("fonts/NotoSansSC-VF.woff2") }` for commercial distribution compliance.')
      }

      // Mandatory AI synthesis compliance overlay check
      const hasAiBadgeEl = /id=["']ai-badge["']/i.test(html)
      checks.push({
        name: 'AI Synthesis Compliance Overlay (#ai-badge)',
        passed: hasAiBadgeEl,
        value: hasAiBadgeEl ? 'Present' : 'Missing mandatory #ai-badge disclosure overlay',
      })
      if (!hasAiBadgeEl) {
        warnings.push('Missing compositor-level `#ai-badge` compliance overlay.')
      }

      // Check deterministic timeline seek hook (`window.__seekToFrame`)
      const hasSeekHook = /__seekToFrame/.test(html)
      checks.push({
        name: 'GSAP Frame-Seek Bridge (window.__seekToFrame)',
        passed: hasSeekHook,
        value: hasSeekHook ? 'Present' : 'Missing window.__seekToFrame(frame)',
      })
      if (!hasSeekHook) {
        warnings.push('Recommend exposing `window.__seekToFrame(frame)` so video_snapshot and video_render can seek deterministically.')
      }

      // Platform Safe-Zone Geometry Preflight
      var safeZonePreflight = computeSafeZonePreflight(script, { htmlContent: html })
      checks.push({
        name: `Platform Safe-Zone Geometry (${safeZonePreflight.platformLabel})`,
        passed: safeZonePreflight.passed,
        value: safeZonePreflight.passed
          ? `0 collisions (subtitle bottom=${safeZonePreflight.measuredSubtitleBottomPx}px >= ${safeZonePreflight.recommendedSubtitleBottomPx}px)`
          : safeZonePreflight.collisions.map((c) => c.suggestion).join('; '),
      })
      for (const col of safeZonePreflight.collisions) {
        if (col.severity === 'error') errors.push(col.suggestion)
        else warnings.push(col.suggestion)
      }
    }
  } else {
    // Remotion Mode Lint
    syncProjectFonts(targetDir)
    const srcDir = join(targetDir, 'src')
    const hasSrc = existsSync(srcDir)
    checks.push({
      name: 'Remotion src/ Directory Structure',
      passed: hasSrc,
      value: hasSrc ? 'Found src/' : 'Missing src/ directory',
    })
    if (!hasSrc) {
      errors.push(`Remotion mode requires a src/ directory inside ${targetDir}`)
    } else {
      const files = []
      const walkSrc = (dir, prefix = '') => {
        for (const ent of readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${ent.name}` : ent.name
          const full = join(dir, ent.name)
          if (ent.isDirectory()) walkSrc(full, rel)
          else if (/\.(tsx|ts|jsx|js)$/.test(ent.name)) files.push({ rel, full })
        }
      }
      walkSrc(srcDir)

      let usesCurrentFrame = false
      let usesCommercialFont = false
      let hasAiBadgeComp = false
      const restrictedRemotionFonts = []
      const cssTransitionViolations = []
      const mathRandomViolations = []

      for (const f of files) {
        const content = readFileSync(f.full, 'utf8')
        if (/useCurrentFrame\s*\(/.test(content)) usesCurrentFrame = true
        if (/Noto Sans SC|FONT_SANS|Source Han/i.test(content)) usesCommercialFont = true
        if (/AIBadge/i.test(content)) hasAiBadgeComp = true
        for (const rx of RESTRICTED_COMMERCIAL_FONT_PATTERNS) {
          if (rx.test(content)) restrictedRemotionFonts.push(`${f.rel}:${rx.source}`)
        }
        if (/transition\s*:/i.test(content) || /@keyframes/i.test(content)) {
          cssTransitionViolations.push(f.rel)
        }
        if (/\bMath\.random\s*\(/.test(content)) {
          mathRandomViolations.push(f.rel)
        }
      }
      checks.push({
        name: 'Commercial Font Whitelist (SIL OFL Noto Sans SC)',
        passed: usesCommercialFont && restrictedRemotionFonts.length === 0,
        value: restrictedRemotionFonts.length > 0
          ? `Restricted: ${restrictedRemotionFonts.join(', ')}`
          : usesCommercialFont
            ? 'Noto Sans SC Verified'
            : 'Missing FONT_SANS / Noto Sans SC',
      })
      if (restrictedRemotionFonts.length > 0) {
        errors.push(`Restricted commercial font declared (${restrictedRemotionFonts.join(', ')}); use FONT_SANS (Noto Sans SC).`)
      }
      checks.push({
        name: 'AI Synthesis Compliance Overlay (<AIBadge />)',
        passed: hasAiBadgeComp,
        value: hasAiBadgeComp ? 'Present' : 'Missing <AIBadge /> in Remotion composition',
      })
      checks.push({
        name: 'Remotion Frame-Driven Animation (useCurrentFrame)',
        passed: usesCurrentFrame,
        value: usesCurrentFrame ? 'Verified' : 'No useCurrentFrame() call found',
      })
      checks.push({
        name: 'No Forbidden CSS Transitions/@keyframes in Remotion',
        passed: cssTransitionViolations.length === 0,
        value:
          cssTransitionViolations.length === 0
            ? 'Clean'
            : `Found in: ${cssTransitionViolations.join(', ')}`,
      })
      checks.push({
        name: 'Deterministic Random Only (No Math.random)',
        passed: mathRandomViolations.length === 0,
        value:
          mathRandomViolations.length === 0
            ? 'Clean'
            : `Found in: ${mathRandomViolations.join(', ')}`,
      })
      var safeZonePreflight = computeSafeZonePreflight(script)
      checks.push({
        name: `Platform Safe-Zone Geometry (${safeZonePreflight.platformLabel})`,
        passed: safeZonePreflight.passed,
        value: safeZonePreflight.passed
          ? `0 collisions (subtitle bottom=${safeZonePreflight.recommendedSubtitleBottomPx}px)`
          : safeZonePreflight.collisions.map((c) => c.suggestion).join('; '),
      })
      if (cssTransitionViolations.length > 0) {
        errors.push(
          `Avoid CSS transitions/@keyframes in Remotion components (${cssTransitionViolations.join(', ')}); use interpolate() or spring() instead.`,
        )
      }
      if (mathRandomViolations.length > 0) {
        errors.push(
          `Avoid Math.random() in Remotion components (${mathRandomViolations.join(', ')}); use random(seed) instead.`,
        )
      }
    }
  }

  return {
    ok: errors.length === 0,
    engine,
    projectDir: targetDir,
    contrastRatio: ratio,
    safeZonePreflight: typeof safeZonePreflight !== 'undefined' ? safeZonePreflight : null,
    checks,
    errors,
    warnings,
  }
}

function computeSampleFrames(script) {
  const totalFrames = Math.max(9, Number(script.totalDurationInFrames) || 270)
  const scenes = Array.isArray(script.scenes) ? script.scenes : []
  const picked = []
  const used = new Set()

  const pickUnique = (target) => {
    let f = Math.min(totalFrames - 1, Math.max(0, Math.floor(target)))
    while (used.has(f) && f + 1 < totalFrames) f++
    while (used.has(f) && f > 0) f--
    used.add(f)
    return f
  }

  if (scenes.length >= 2) {
    for (let i = 0; i < 9; i++) {
      const sceneIdx = Math.min(scenes.length - 1, Math.floor((i * scenes.length) / 9))
      const s = scenes[sceneIdx]
      const startF = Number(s.startFrame || 0)
      const durF = Math.max(3, Number(s.durationInFrames || 90))
      const countForScene = Math.max(1, Math.ceil(9 / scenes.length))
      const idxInScene = i - Math.floor((sceneIdx * 9) / scenes.length)
      const ratio = Math.min(0.88, Math.max(0.12, (idxInScene + 0.5) / (countForScene + 0.3)))
      picked.push(pickUnique(startF + Math.floor(ratio * durF)))
    }
    return picked.sort((a, b) => a - b)
  }

  for (let i = 0; i < 9; i++) {
    picked.push(pickUnique(((i + 0.5) / 9) * totalFrames))
  }
  return picked.sort((a, b) => a - b)
}

/** Re-extract the contact-sheet frames from the delivered film (after a guard changed the picture). */
async function refreshSnapshotFrames(ffmpeg, mp4Path, frames, framesDir, signal) {
  const list = (Array.isArray(frames) ? frames : []).map((f) => Math.max(0, Math.round(Number(f) || 0)))
  if (!list.length || !existsSync(mp4Path)) return false
  mkdirSync(framesDir, { recursive: true })
  const sel = list.map((f) => `eq(n,${f})`).join('+')
  const res = await runCommandRedirected(
    ffmpeg,
    ['-y', '-hide_banner', '-v', 'error', '-i', mp4Path, '-an', '-vf', `select='${sel}'`, '-vsync', '0', '-frames:v', String(list.length), '-start_number', '1', join(framesDir, 'shot_%02d.png')],
    { timeoutMs: 180_000, signal },
  )
  return res.code === 0
}

async function stitch3x3Grid(ffmpeg, framesDir, outPath) {
  const stitchRes = await runCommandRedirected(ffmpeg, [
    '-y',
    '-framerate', '1',
    '-i', join(framesDir, 'shot_%02d.png'),
    '-vf', 'scale=640:360,tile=3x3:padding=10:margin=10:color=0x0b1020',
    '-frames:v', '1',
    outPath,
  ])
  if (stitchRes.code !== 0 || !existsSync(outPath)) {
    throw new Error(`Failed to stitch 3x3 snapshot grid: ${stitchRes.stderr}`)
  }
}

/**
 * Capture 9 frames and stitch into `snapshot-3x3.png`.
 * Uses Remotion `renderStill` when engine=remotion (and template available), or single-session Chromium CDP over HTTP.
 */
export async function executeVideoSnapshot(args = {}) {
  loadEnv()
  const targetDir = isAbsolute(args.projectDir || '.')
    ? args.projectDir
    : resolve(REPO_ROOT, args.projectDir || '.')

  const { data: script } = writeScriptJson(targetDir, readScriptJson(targetDir).data)
  const engine = args.engine || script.engine || 'html'
  const fps = Number(script.fps) || 30
  const totalFrames = Math.max(9, Number(script.totalDurationInFrames) || 270)
  const scenes = Array.isArray(script.scenes) ? script.scenes : []

  const outPath = args.outputPath
    ? isAbsolute(args.outputPath)
      ? args.outputPath
      : resolve(targetDir, args.outputPath)
    : join(targetDir, 'output', 'snapshot-3x3.png')

  mkdirSync(dirname(outPath), { recursive: true })
  const framesDir = join(dirname(outPath), '.frames-snapshot')
  mkdirSync(framesDir, { recursive: true })

  const sampleFrames = computeSampleFrames(script)
  const { ffmpeg } = resolveBinaries()
  const browserBin = resolveBrowserExecutable()
  const htmlEntry = join(targetDir, 'index.html')

  let captureMethod = 'ffmpeg-fallback'
  let captured = false

  if (engine === 'remotion' && existsSync(join(targetDir, 'src', 'Root.tsx'))) {
    try {
      syncRemotionPublicAssets(targetDir, script)
      const r = await renderRemotionProject({
        projectDir: targetDir,
        snapshotFrames: sampleFrames,
        snapshotDir: framesDir,
        onlySnapshots: true,
      })
      if (r.ok) {
        captureMethod = 'remotion-still'
        captured = true
      }
    } catch {}
  }

  if (!captured && browserBin && existsSync(htmlEntry)) {
    try {
      const baseW = Number(script.width) || 1920
      const baseH = Number(script.height) || 1080
      const snapScale = Math.min(1, 1280 / Math.max(baseW, baseH))
      const snapW = Math.max(320, Math.round((baseW * snapScale) / 2) * 2)
      const snapH = Math.max(320, Math.round((baseH * snapScale) / 2) * 2)
      await captureHtmlSnapshots({
        projectDir: targetDir,
        browserBin,
        frames: sampleFrames,
        outDir: framesDir,
        width: snapW,
        height: snapH,
      })
      captureMethod = 'chromium-cdp-dom'
      captured = true
    } catch {}
  }

  if (!captured) {
    for (let i = 0; i < sampleFrames.length; i++) {
      const framePng = join(framesDir, `shot_${String(i).padStart(2, '0')}.png`)
      await runCommandRedirected(ffmpeg, [
        '-y', '-f', 'lavfi', '-i', `color=c=0x0f172a:s=640x360:d=1`,
        '-vf', 'drawgrid=w=80:h=80:t=1:c=white@0.07',
        '-frames:v', '1', framePng,
      ])
    }
  }

  await stitch3x3Grid(ffmpeg, framesDir, outPath)

  const frameMetadata = sampleFrames.map((frame, idx) => {
    const sec = Number((frame / fps).toFixed(2))
    const scene =
      scenes.find(
        (s) => frame >= (s.startFrame || 0) && frame < (s.startFrame || 0) + (s.durationInFrames || 90),
      ) || scenes[idx % Math.max(1, scenes.length || 1)] || {}
    return {
      gridCell: `R${Math.floor(idx / 3) + 1}C${(idx % 3) + 1}`,
      frame,
      timeSec: sec,
      sceneId: scene.id || `scene-0${idx + 1}`,
      sceneTitle: scene.title || '',
      voiceName: scene.voiceName || scene.voiceId || 'auto',
    }
  })

  return {
    ok: true,
    engine,
    captureMethod,
    snapshotPath: outPath,
    gridLayout: '3x3',
    totalDurationInFrames: totalFrames,
    fps,
    frames: frameMetadata,
    hint: 'Call `read_image` on `snapshotPath` to perform multimodal visual QA before rendering MP4.',
  }
}

/**
 * Extract fast per-scene keyframe JPEG thumbnails directly from rendered `output/final.mp4`
 * so Step 3 storyboard cards & Warroom filmstrip always reflect the exact rendered pixels.
 */
export async function extractSceneThumbnails(projectDir, scriptInput = null, { force = false } = {}) {
  const absDir = isAbsolute(projectDir || '.')
    ? resolve(projectDir)
    : resolve(REPO_ROOT, projectDir || '.')
  const mp4Path = join(absDir, 'output', 'final.mp4')
  if (!existsSync(mp4Path)) {
    return { ok: false, reason: 'final.mp4 not rendered yet', thumbs: {} }
  }
  const script = scriptInput || readScriptJson(absDir).data
  const scenes = Array.isArray(script?.scenes) ? script.scenes : []
  const fps = Math.max(1, Number(script?.fps) || 30)
  const thumbDir = join(absDir, 'output', 'scene-thumbs')
  mkdirSync(thumbDir, { recursive: true })
  const mp4Mtime = statSync(mp4Path).mtimeMs
  const { ffmpeg } = resolveBinaries()
  const thumbs = {}
  let cursorSec = 0

  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i] || {}
    const sid = String(sc.id || `scene-${String(i + 1).padStart(2, '0')}`).replace(/[^a-zA-Z0-9._-]/g, '_')
    const startSec = Number.isFinite(Number(sc.startFrame)) ? Number(sc.startFrame) / fps : cursorSec
    const durSec = Math.max(0.4, Number(sc.durationSec) || (Number(sc.durationInFrames) ? Number(sc.durationInFrames) / fps : 3))
    cursorSec = startSec + durSec
    const sampleSec = Math.max(0.05, Number((startSec + Math.min(durSec * 0.48, 0.85)).toFixed(3)))
    const outFile = join(thumbDir, `${sid}.jpg`)
    const rel = `output/scene-thumbs/${sid}.jpg`

    let fresh = false
    if (!force && existsSync(outFile)) {
      try {
        if (statSync(outFile).mtimeMs >= mp4Mtime && statSync(outFile).size > 200) fresh = true
      } catch {}
    }
    if (!fresh) {
      try {
        await runCommandRedirected(
          ffmpeg,
          ['-y', '-ss', String(sampleSec), '-i', mp4Path, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', outFile],
          { timeoutMs: 12_000 },
        )
      } catch {}
    }
    if (existsSync(outFile)) {
      thumbs[sid] = rel
    }
  }
  return { ok: true, thumbs }
}

/**
 * 3. `video_render` — True full-FPS Dual-Engine Render + Multi-Track Audio Mix (Voice + SFX + Ducked BGM) -> H.264 MP4
 */
export async function executeVideoRender(args = {}) {
  loadEnv()
  const targetDir = isAbsolute(args.projectDir || '.')
    ? args.projectDir
    : resolve(REPO_ROOT, args.projectDir || '.')

  const { data: script } = writeScriptJson(targetDir, readScriptJson(targetDir).data)
  const engine = args.engine || script.engine || 'html'
  const fps = Number(script.fps) || 30
  const width = Number(args.width) || Number(script.width) || 1920
  const height = Number(args.height) || Number(script.height) || 1080
  const totalFrames = Math.max(30, Number(script.totalDurationInFrames) || 300)
  const totalSec = Number((totalFrames / fps).toFixed(3))

  const outPath = args.outputPath
    ? isAbsolute(args.outputPath)
      ? args.outputPath
      : resolve(targetDir, args.outputPath)
    : join(targetDir, 'output', 'final.mp4')

  mkdirSync(dirname(outPath), { recursive: true })
  const snapshotOut = join(dirname(outPath), 'snapshot-3x3.png')
  const framesDir = join(dirname(outPath), '.frames-snapshot')
  const sampleFrames = computeSampleFrames(script)
  const { ffmpeg } = resolveBinaries()

  // 1. Mix Voice Narration + SFX + Sidechain-Ducked BGM into `output/master-audio.wav`
  const assetsManifest = readAssets(targetDir)
  const mixRes = await mixVideoAudio({
    projectDir: targetDir,
    script,
    assetsManifest,
    outputPath: join(dirname(outPath), 'master-audio.wav'),
    signal: args.signal,
    writeStems: Boolean(args.writeStems),
  })

  // 2. Render every frame via selected engine
  // 「720P 快速审片」: a draft scale in (0, 1) shrinks the output of BOTH engines (full-quality renders pass none)
  const draftScale = Number(args.draftScale) > 0 && Number(args.draftScale) < 1 ? Number(args.draftScale) : 0
  let renderMethod = ''
  let renderW = width
  let renderH = height
  if (engine === 'remotion' && existsSync(join(targetDir, 'src', 'Root.tsx'))) {
    syncRemotionPublicAssets(targetDir, script)
    const vcPath = join(targetDir, 'src', 'VideoComposition.tsx')
    if (existsSync(vcPath)) {
      const vcSrc = readFileSync(vcPath, 'utf8')
      if (
        !vcSrc.includes('master-audio.wav') &&
        existsSync(join(targetDir, 'public', 'master-audio.wav'))
      ) {
        writeRemotionProjectFiles(targetDir, script, {
          useCustomSceneRegistry: script?.authoringMode === 'ai-coded' && existsSync(join(targetDir, 'src', 'scenes', 'index.ts')),
        })
      }
    }
    const r = await renderRemotionProject({
      projectDir: targetDir,
      outMp4Path: outPath,
      snapshotFrames: sampleFrames,
      snapshotDir: framesDir,
      onlySnapshots: false,
      signal: args.signal,
      onProgress: args.onProgress,
      chunkSec: args.chunkSec,
      ...(draftScale ? { scale: draftScale } : {}),
    })
    if (r.ok && existsSync(outPath)) {
      renderMethod = r.chunked?.enabled ? 'remotion-renderer-chunked' : 'remotion-renderer'
      var remotionChunkInfo = r.chunked || null
      if (draftScale) {
        const scaled = computeRemotionOutputSize(width, height, draftScale)
        renderW = scaled.width
        renderH = scaled.height
      }
    }
  }

  if (!renderMethod) {
    const browserBin = resolveBrowserExecutable()
    const htmlEntry = join(targetDir, 'index.html')
    if (!browserBin || !existsSync(htmlEntry)) {
      throw new Error(`Cannot render HTML video: missing browser (${browserBin}) or ${htmlEntry}`)
    }
    // Preserve aspect ratio if caller passed draft renderWidth / renderHeight or custom scale
    let rW = Number(args.renderWidth) || width
    let rH = Number(args.renderHeight) || height
    if (args.draftScale && Number(args.draftScale) > 0 && Number(args.draftScale) < 1) {
      const s = Number(args.draftScale)
      rW = Math.max(320, Math.round((width * s) / 2) * 2)
      rH = Math.max(320, Math.round((height * s) / 2) * 2)
    }
    renderW = rW
    renderH = rH
    var htmlRenderRes = await renderHtmlVideoToMp4({
      projectDir: targetDir,
      browserBin,
      totalFrames,
      fps,
      width: rW,
      height: rH,
      audioPath: mixRes.outputPath,
      outMp4Path: outPath,
      snapshotFrames: sampleFrames,
      snapshotDir: framesDir,
      useSegmentCache: args.useSegmentCache !== false,
      signal: args.signal,
      onProgress: args.onProgress,
    })
    renderMethod = 'chromium-cdp-full-fps'
  }

  // 3a. Delivery exposure guard: shots designed on near-black backgrounds (figures unreadable on a phone) get a
  //     video-range gamma lift for exactly their frames; lit-by-design shots and dark UI themes are left alone.
  let exposureGuard = null
  try {
    exposureGuard = await enforceExposure({ mp4Path: outPath, script, ffmpeg, signal: args.signal, enabled: args.exposureGuard !== false })
  } catch (err) {
    if (args.signal?.aborted || err?.name === 'AbortError') throw err
    exposureGuard = { applied: false, reason: 'error', error: String(err?.message || err).slice(0, 300) }
  }

  // 3b. Delivery true-peak guard: AAC encoding can lift the limited master above the R128 ceiling (codec overshoot);
  //    re-encode only the audio with a gain trim when the delivered file measures above −1 dBTP.
  let truePeakGuard = null
  try {
    let sourceAudioPath = ''
    if (renderMethod === 'chromium-cdp-full-fps') sourceAudioPath = mixRes.outputPath
    else if (renderMethod.startsWith('remotion')) {
      const plan = resolveCompositionAudioPlan(targetDir)
      if (plan.mode === 'master') sourceAudioPath = plan.path
    }
    truePeakGuard = await enforceAudioTruePeak({ mp4Path: outPath, sourceAudioPath, ffmpeg, signal: args.signal })
  } catch (err) {
    if (args.signal?.aborted || err?.name === 'AbortError') throw err
    truePeakGuard = { applied: false, reason: 'error', error: String(err?.message || err).slice(0, 300) }
  }

  if (exposureGuard?.applied) {
    try {
      await refreshSnapshotFrames(ffmpeg, outPath, sampleFrames, framesDir, args.signal)
    } catch (err) {
      if (args.signal?.aborted || err?.name === 'AbortError') throw err
    }
  }
  await stitch3x3Grid(ffmpeg, framesDir, snapshotOut)
  const qaReport = await runPostRenderQa({
    projectDir: targetDir,
    mp4Path: outPath,
    script,
    expectedWidth: renderW,
    expectedHeight: renderH,
    exposure: exposureGuard,
    signal: args.signal,
  })

  const fileSizeBytes = statSync(outPath).size
  if (outPath === join(targetDir, 'output', 'final.mp4')) {
    try {
      await extractSceneThumbnails(targetDir, script, { force: true })
    } catch {}
  }
  return {
    ok: true,
    engine,
    renderMethod,
    outputPath: outPath,
    snapshotPath: snapshotOut,
    masterAudioPath: mixRes.outputPath,
    fileSizeBytes,
    framesRendered: totalFrames,
    durationSec: totalSec,
    fps,
    resolution: `${width}x${height}`,
    audioTracksMixed: mixRes.voiceCount,
    sfxCount: mixRes.sfxCount,
    bgmSource: mixRes.bgmSource,
    segmentCache: typeof htmlRenderRes !== 'undefined' ? (htmlRenderRes?.segmentCache || null) : null,
    chunkedRender: typeof remotionChunkInfo !== 'undefined' ? remotionChunkInfo : null,
    stems: mixRes.stems || null,
    ambience: mixRes.ambience || null,
    exposureGuard,
    truePeakGuard,
    qaReportPath: qaReport?.qaReportPath || '',
    qaReport,
  }
}

export const name = 'dsh-tool-video-suite'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({
    name: 'video_lint',
    description:
      'Validate a dual-engine (HTML/GSAP or Remotion) video project: checks <template> scene wrapping, DOM/SVG ID collisions, WCAG AA contrast ratio, Windows 11 local fonts, and Remotion frame-driven animation rules.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: {
          type: 'string',
          description: 'Path to the video project directory containing script.json.',
        },
        engine: {
          type: 'string',
          enum: ['html', 'remotion'],
          description: 'Optional engine override (defaults to engine in script.json).',
        },
        entryFile: {
          type: 'string',
          description: 'Optional HTML entry filename (defaults to index.html).',
        },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
      },
    },
    timeoutMs: 60_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      return await executeVideoLint(args)
    },
  })

  ctx.tools.register({
    name: 'video_snapshot',
    description:
      'Generate a 3x3 contact sheet PNG (`snapshot-3x3.png`) by sampling 9 evenly spaced frames across the video timeline (HTML/GSAP via headless Chromium or Remotion still capture) for multimodal QA with `read_image`.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: {
          type: 'string',
          description: 'Path to the video project directory containing script.json.',
        },
        outputPath: {
          type: 'string',
          description: 'Optional output PNG path (defaults to <projectDir>/output/snapshot-3x3.png).',
        },
        engine: {
          type: 'string',
          enum: ['html', 'remotion'],
          description: 'Optional engine override.',
        },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
      },
    },
    timeoutMs: 120_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await executeVideoSnapshot(args)
    },
  })

  ctx.tools.register({
    name: 'video_render',
    description:
      'Render the video project (HTML/GSAP or Remotion) and mix all scene WAV audio tracks via FFmpeg into a final H.264 (`yuv420p`) MP4 file.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: {
          type: 'string',
          description: 'Path to the video project directory containing script.json.',
        },
        outputPath: {
          type: 'string',
          description: 'Optional output MP4 path (defaults to <projectDir>/output/final.mp4).',
        },
        engine: {
          type: 'string',
          enum: ['html', 'remotion'],
          description: 'Optional engine override.',
        },
        chunkSec: {
          type: 'number',
          description: 'Remotion only: resumable frame-exact chunk length in seconds (default DSH_RENDER_CHUNK_SEC or 10; 0 = legacy single pass). Completed chunks are reused when the bundle inputs are unchanged.',
        },
        writeStems: {
          type: 'boolean',
          description: 'Also write aligned voice/sfx/bgm stems (32-bit float WAV, pre-limiter) to output/stems/. The master mix is unchanged.',
        },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
      },
    },
    timeoutMs: 300_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await executeVideoRender(args)
    },
  })

  ctx.tools.register({
    name: 'export_project_package',
    description:
      'Export a delivery package into <projectDir>/output/export/: SRT/WebVTT subtitles (global timing), aligned audio stems (voice/sfx/bgm WAV), and NLE timelines — FCPXML 1.10 (Final Cut Pro / DaVinci Resolve) and Final Cut Pro 7 XML (xmeml v5, Premiere Pro / DaVinci Resolve) referencing per-scene ranges of the final MP4 plus the stems, with markers at scene cuts, musical downbeats and drops. Only documented interchange formats are produced. Optionally grade the video with a LUT first.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory containing script.json.' },
        formats: {
          type: 'array',
          items: { type: 'string', enum: [...DELIVERY_FORMATS, 'all'] },
          description: 'Formats to export (default: srt, vtt, stems, fcpxml, xmeml). Timelines automatically include stems (reused if already exported).',
        },
        mp4Path: { type: 'string', description: 'Optional video to reference (defaults to output/final.mp4).' },
        stemsEnabled: {
          type: 'boolean',
          description: 'If true the stems are active in the timeline and the MP4 mix is muted; default false keeps the finished mix active and stems disabled for re-mixing.',
        },
        lut: { type: 'string', description: `Optional LUT applied to a graded copy that the timelines then reference (built-in: ${BUILTIN_LUTS.map((l) => l.id).join(', ')}, or a .cube path).` },
        lutIntensity: { type: 'number', description: 'LUT strength 0–1 (default 1).' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 900_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      loadEnv()
      return await exportProjectPackage({ ...args, formats: args.formats?.length ? args.formats : undefined, signal: args.signal })
    },
  })

  ctx.tools.register({
    name: 'apply_color_lut',
    description:
      'Grade a rendered video with a 3D LUT via FFmpeg lut3d (tetrahedral) and an intensity mix (0–1), writing a graded copy (H.264 BT.709, audio copied) ONLY inside the project\'s output/ folder (default output/<source>.graded-<lut>.mp4). Never overwrites the source, and never overwrites an existing file unless overwrite=true is passed explicitly: an existing outputPath is refused, the default name gets a -2, -3 … suffix instead. Built-in 17³ LUTs: teal-orange, warm-film, bleach-bypass, mono-contrast, night-cool; or pass a user .cube path. Pass lut="list" to list built-ins.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        lut: { type: 'string', description: 'Built-in LUT id, path to a .cube/.3dl file, or "list".' },
        intensity: { type: 'number', description: 'Mix between original (0) and fully graded (1). Default 1.' },
        mp4Path: { type: 'string', description: 'Optional source video (defaults to output/final.mp4).' },
        outputPath: {
          type: 'string',
          description:
            'Optional output file relative to the project\'s output/ folder, e.g. "graded/final-teal.mp4" (.mp4/.mov/.m4v; a leading "output/" is accepted). Absolute, drive, UNC and ".." paths are rejected.',
        },
        overwrite: { type: 'boolean', description: 'Replace an existing file at the output path (default false: existing files are never overwritten).' },
        crf: { type: 'number', description: 'x264 CRF for the graded copy (default 18).' },
      },
      required: ['projectDir', 'lut'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 900_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      loadEnv()
      if (String(args.lut || '').trim().toLowerCase() === 'list') return { ok: true, luts: listColorLuts() }
      return await applyProjectColorLut({ ...args, overwrite: args.overwrite === true, signal: args.signal })
    },
  })

  ctx.tools.register({
    name: 'render_video_scopes',
    description:
      'Render broadcast scopes for one timestamp of a video into output/scopes/: luma waveform, vectorscope and RGB/YUV histogram PNGs plus the analysed frame (FFmpeg waveform / vectorscope / histogram filters). Use read_image on the returned files to judge exposure, clipping and colour balance.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        timeSec: { type: 'number', description: 'Timestamp in seconds (default 0).' },
        mp4Path: { type: 'string', description: 'Optional video path (defaults to output/final.mp4).' },
        kinds: {
          type: 'array',
          items: { type: 'string', enum: [...SCOPE_KINDS] },
          description: 'Which scopes to render (default all).',
        },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 120_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      loadEnv()
      return await renderVideoScopes({ ...args, signal: args.signal })
    },
  })
}

export default { name, inject, apply }
