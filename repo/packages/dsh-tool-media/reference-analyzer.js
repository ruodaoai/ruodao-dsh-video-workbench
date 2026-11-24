/**
 * @dsh-video/tool-media — Reference Video Deep Reverse-Engineering, MOTION.md & Brand Kit Engine
 * Copyright (c) 2026 Merziller (QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com)
 *
 * Lets users upload ANY reference video -> automatically reverse-engineers:
 *   1. Technical specs (`ffprobe`: resolution, aspect ratio, fps, duration, audio presence)
 *   2. Real shot-boundary cuts (`ffmpeg scdet/scene` timestamps, shot count, avg/min cut cadence, blitz cuts)
 *   3. Audio beat & drop structure (`analyzeAudioBeatStructure`: BPM, downbeats, drops)
 *   4. 9-frame keyframe contact sheet (`reference/ref-sheet-3x3.jpg`)
 *   5. 4-Protocol Multimodal Vision LLM visual DNA extraction (genre, palette, characters, VFX, transitions,
 *      subtitle style, narrationMode, shotFormula[], and `replicationPrompt`)
 *   6. Shareable open-format `MOTION.md` shot blueprint + persistent Workspace Brand Kit (`brand-kit.json`)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import {
  loadEnv,
  readScriptJson,
  REPO_ROOT,
  resolveBinaries,
  runCommandRedirected,
  writeScriptJson,
} from '../shared/index.js'
import { analyzeAudioBeatStructure } from './beat-analyzer.js'
import { callLlmChat, extractJsonFromLlmText, getSafeLlmConfigSummary } from './llm-client.js'
import { applyStyleDecision } from './style-presets.js'

function getBrandKitPath(projectDir = '') {
  if (projectDir && existsSync(resolve(projectDir))) {
    const localKit = join(resolve(projectDir), 'brand-kit.json')
    if (existsSync(localKit)) return localKit
  }
  return join(REPO_ROOT, '.tmp', 'brand-kit.json')
}

export function loadBrandKit(projectDir = '') {
  const candidates = [
    ...(projectDir ? [join(resolve(projectDir), 'brand-kit.json')] : []),
    join(REPO_ROOT, '.tmp', 'brand-kit.json'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const parsed = JSON.parse(readFileSync(p, 'utf8'))
        if (parsed && typeof parsed === 'object') return parsed
      } catch {}
    }
  }
  return {
    brandName: '',
    tagline: '',
    primaryColor: '#F5B942',
    accentColor: '#22D3EE',
    backgroundColor: '#070B16',
    logoPath: '',
    watermarkText: '',
    defaultStyle: 'cinematic',
    defaultPlatform: 'universal',
  }
}

export function saveBrandKit(kit = {}, projectDir = '') {
  const clean = {
    brandName: String(kit.brandName || '').trim().slice(0, 60),
    tagline: String(kit.tagline || '').trim().slice(0, 120),
    primaryColor: /^#[0-9a-fA-F]{3,8}$/.test(String(kit.primaryColor || '')) ? String(kit.primaryColor) : '#F5B942',
    accentColor: /^#[0-9a-fA-F]{3,8}$/.test(String(kit.accentColor || '')) ? String(kit.accentColor) : '#22D3EE',
    backgroundColor: /^#[0-9a-fA-F]{3,8}$/.test(String(kit.backgroundColor || '')) ? String(kit.backgroundColor) : '#070B16',
    logoPath: String(kit.logoPath || '').trim(),
    watermarkText: String(kit.watermarkText || '').trim().slice(0, 48),
    defaultStyle: String(kit.defaultStyle || 'cinematic').trim(),
    defaultPlatform: String(kit.defaultPlatform || 'universal').trim(),
    updatedAt: new Date().toISOString(),
  }
  const globalPath = join(REPO_ROOT, '.tmp', 'brand-kit.json')
  mkdirSync(join(REPO_ROOT, '.tmp'), { recursive: true })
  writeFileSync(globalPath, JSON.stringify(clean, null, 2) + '\n', 'utf8')
  if (projectDir && existsSync(resolve(projectDir))) {
    writeFileSync(join(resolve(projectDir), 'brand-kit.json'), JSON.stringify(clean, null, 2) + '\n', 'utf8')
  }
  return clean
}

function inferAspectRatio(w, h) {
  if (!w || !h) return '16:9'
  const r = w / h
  if (Math.abs(r - 16 / 9) < 0.16) return '16:9'
  if (Math.abs(r - 9 / 16) < 0.12) return '9:16'
  if (Math.abs(r - 1) < 0.12) return '1:1'
  if (Math.abs(r - 4 / 3) < 0.14) return '4:3'
  if (Math.abs(r - 3 / 4) < 0.12) return '3:4'
  return w >= h ? '16:9' : '9:16'
}

async function probeReferenceVideo(absVideo, signal) {
  const { ffprobe } = resolveBinaries()
  const res = await runCommandRedirected(
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', absVideo],
    { timeoutMs: 30_000, signal },
  )
  if (res.code !== 0) {
    throw new Error(`无法解析参考视频流信息 (ffprobe): ${(res.stderr || res.stdout).slice(0, 260)}`)
  }
  const parsed = JSON.parse(res.stdout || '{}')
  const vStream = (parsed.streams || []).find((s) => s.codec_type === 'video') || {}
  const aStream = (parsed.streams || []).find((s) => s.codec_type === 'audio') || null
  const width = Number(vStream.width) || 1280
  const height = Number(vStream.height) || 720
  const durationSec = Number(parsed.format?.duration || vStream.duration || 0)
  let fps = 30
  if (vStream.r_frame_rate && String(vStream.r_frame_rate).includes('/')) {
    const [num, den] = String(vStream.r_frame_rate).split('/').map(Number)
    if (num > 0 && den > 0) fps = Math.round(num / den)
  }
  const sizeMb = Number((statSync(absVideo).size / 1048576).toFixed(2))
  return {
    width,
    height,
    aspectRatio: inferAspectRatio(width, height),
    fps: Math.max(15, Math.min(60, fps || 30)),
    durationSec: Number(durationSec.toFixed(2)),
    hasAudio: Boolean(aStream),
    audioCodec: aStream?.codec_name || '',
    videoCodec: vStream.codec_name || '',
    sizeMb,
  }
}

async function detectShotBoundaries(absVideo, durationSec, signal) {
  const { ffmpeg } = resolveBinaries()
  const runDetect = async (threshold) => {
    const res = await runCommandRedirected(
      ffmpeg,
      [
        '-v', 'info',
        '-i', absVideo,
        '-vf', `select='gt(scene,${threshold})',showinfo`,
        '-vsync', 'vfr',
        '-f', 'null',
        '-',
      ],
      { timeoutMs: 120_000, signal },
    )
    const pts = []
    const rx = /pts_time:(\d+(?:\.\d+)?)/g
    let m
    while ((m = rx.exec(res.stderr || '')) !== null) {
      const t = Number(m[1])
      if (Number.isFinite(t) && t > 0.25 && t < Math.max(1, durationSec - 0.25)) {
        if (pts.length === 0 || t - pts[pts.length - 1] >= 0.28) {
          pts.push(Number(t.toFixed(2)))
        }
      }
    }
    return pts
  }

  let cuts = await runDetect(0.28)
  if (cuts.length < Math.max(4, Math.floor(durationSec / 12))) {
    const softer = await runDetect(0.18)
    if (softer.length > cuts.length) cuts = softer
  }
  if (cuts.length > Math.ceil(durationSec * 1.4)) {
    const stricter = await runDetect(0.38)
    if (stricter.length >= 6) cuts = stricter
  }

  const boundaries = [0, ...cuts, Number(durationSec.toFixed(2))]
  const shotDurations = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const d = Number((boundaries[i + 1] - boundaries[i]).toFixed(2))
    if (d >= 0.2) shotDurations.push(d)
  }
  const shotCount = Math.max(1, shotDurations.length)
  const avgShotSec = Number((durationSec / shotCount).toFixed(2))
  const minShotSec = shotDurations.length ? Number(Math.min(...shotDurations).toFixed(2)) : avgShotSec
  const blitzCutCount = shotDurations.filter((d) => d <= 1.25).length
  const recommendedPacingMode = avgShotSec <= 3.6 || blitzCutCount >= 4 ? 'dynamic' : avgShotSec >= 5.8 ? 'calm' : 'balanced'

  return {
    cutTimestamps: cuts.slice(0, 96),
    shotCount,
    avgShotSec,
    minShotSec,
    blitzCutCount,
    recommendedPacingMode,
  }
}

async function extractReferenceKeyframesAndSheet(absVideo, refDir, durationSec, signal) {
  const { ffmpeg } = resolveBinaries()
  const framesDir = join(refDir, 'frames')
  mkdirSync(framesDir, { recursive: true })
  const count = 9
  const framePaths = []

  for (let i = 0; i < count; i++) {
    const pct = 0.05 + (i / (count - 1)) * 0.9
    const ts = Math.max(0.2, Math.min(Math.max(0.5, durationSec - 0.3), durationSec * pct))
    const outJpg = join(framesDir, `kf-${String(i + 1).padStart(2, '0')}.jpg`)
    await runCommandRedirected(
      ffmpeg,
      ['-y', '-ss', ts.toFixed(2), '-i', absVideo, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', outJpg],
      { timeoutMs: 25_000, signal },
    )
    if (existsSync(outJpg)) framePaths.push(outJpg)
  }

  const sheetPath = join(refDir, 'ref-sheet-3x3.jpg')
  if (framePaths.length >= 4) {
    await runCommandRedirected(
      ffmpeg,
      [
        '-y',
        '-i', join(framesDir, 'kf-%02d.jpg'),
        '-vf', 'scale=426:240:force_original_aspect_ratio=decrease,pad=426:240:(ow-iw)/2:(oh-ih)/2:color=black,tile=3x3',
        '-frames:v', '1',
        '-q:v', '3',
        sheetPath,
      ],
      { timeoutMs: 30_000, signal },
    )
  }

  return {
    framePaths,
    sheetPath: existsSync(sheetPath) ? sheetPath : (framePaths[0] || ''),
  }
}

/**
 * Generate an open, human-readable `MOTION.md` blueprint file (compatible with cross-agent workflows
 * and shareable templates) from a project's `script.json`, `referenceStyle`, and `brandKit`.
 */
export function buildMotionMarkdown({ scriptData = {}, referenceStyle = null, brandKit = null } = {}) {
  const title = scriptData?.displayTitle || scriptData?.title || referenceStyle?.title || 'AI 动效视频方案'
  const genreLabel = scriptData?.genreLabel || referenceStyle?.genreLabel || '自由创作'
  const aspect = scriptData?.aspectRatio || referenceStyle?.aspectRatio || '16:9'
  const dur = Number(scriptData?.totalDurationSec || referenceStyle?.durationSec || 0).toFixed(1)
  const bpm = scriptData?.bgm?.bpm || referenceStyle?.bpm || 110
  const narrationMode = scriptData?.narrationMode || referenceStyle?.narrationMode || 'tts'
  const scenes = Array.isArray(scriptData?.scenes) ? scriptData.scenes : []
  const formula = Array.isArray(referenceStyle?.shotFormula) ? referenceStyle.shotFormula : []

  const lines = [
    `# MOTION.md — ${title}`,
    '',
    `> Generated by **DSH Video Workbench** (Author: Merziller · QQ: 1411574209 · WeChat: Merziller · Email: k26789228@gmail.com)`,
    '',
    '## Project Overview',
    `- **Title**: ${title}`,
    `- **Genre**: ${genreLabel} (\`${scriptData?.genre || referenceStyle?.genre || 'other'}\`)`,
    `- **Format**: ${aspect} · ${dur}s · ${bpm} BPM · Narration: \`${narrationMode}\``,
    `- **Engine**: \`${scriptData?.engine || 'remotion'}\` (Dual-Engine Remotion 4.x TSX + HTML5/Canvas)`,
    '',
  ]

  if (brandKit && (brandKit.brandName || brandKit.primaryColor)) {
    lines.push(
      '## Brand Kit',
      `- **Brand**: ${brandKit.brandName || '(Default)'}${brandKit.tagline ? ` — ${brandKit.tagline}` : ''}`,
      `- **Palette**: Primary \`${brandKit.primaryColor}\` · Accent \`${brandKit.accentColor}\` · Background \`${brandKit.backgroundColor}\``,
      ...(brandKit.logoPath ? [`- **Logo**: \`${brandKit.logoPath}\``] : []),
      ...(brandKit.watermarkText ? [`- **Watermark**: ${brandKit.watermarkText}`] : []),
      '',
    )
  }

  if (referenceStyle) {
    lines.push(
      '## Reference Video Visual DNA',
      `- **Source**: ${referenceStyle.sourceName || 'Uploaded Reference'} (${referenceStyle.durationSec || 0}s · ${referenceStyle.shotCount || 0} cuts · avg ${referenceStyle.avgShotSec || 0}s/cut · ${referenceStyle.bpm || bpm} BPM)`,
      `- **Visual Style**: ${referenceStyle.visualStyle || 'Cinematic dynamic motion'}`,
      `- **Character & Composition**: ${referenceStyle.characterDesign || 'Animated foreground hero & layered motion backdrop'}`,
      `- **VFX Signature**: ${(referenceStyle.vfxSignature || []).join(', ') || 'Impact flashes, particles, beat zoom'}`,
      `- **Transitions**: ${(referenceStyle.transitionSignature || []).join(', ') || 'flash-cut, slash-wipe, zoom-punch'}`,
      `- **Subtitle Style**: ${referenceStyle.subtitleStyle || 'cinematic'}`,
      '',
      '### Replication Directive',
      referenceStyle.replicationPrompt || '',
      '',
    )
    if (formula.length > 0) {
      lines.push('### Reference Structural Formula', '| Phase | Span | Archetype | Visual Motif | Transition |', '| :--- | :--- | :--- | :--- | :--- |')
      for (const f of formula) {
        lines.push(`| ${f.phase || '-'} | ${f.pctRange || '-'} | \`${f.archetype || '-'}\` | ${f.visualMotif || '-'} | \`${f.transition || 'flash-cut'}\` |`)
      }
      lines.push('')
    }
  }

  if (scenes.length > 0) {
    lines.push(
      `## Shot List (${scenes.length} Scenes)`,
      '| # | ID | Time | Layout / Archetype | Transition | Copy / Subtitle | Visual Blueprint |',
      '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
    )
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i]
      const arch = sc.stageSpec?.archetype || sc.layout || 'freeform-stage'
      const span = `${Number(sc.startSec || 0).toFixed(1)}s (${Number(sc.durationSec || 0).toFixed(1)}s)`
      const copy = String(sc.narration || sc.title || '').replace(/\|/g, '/').slice(0, 36)
      const bp = String(sc.visualBlueprint || sc.motionNotes || '').replace(/\|/g, '/').slice(0, 64)
      lines.push(`| ${i + 1} | \`${sc.id}\` | ${span} | \`${arch}\` | \`${sc.transition || 'cut'}\` | ${copy} | ${bp} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function exportProjectMotionMd(projectDir) {
  const absDir = resolve(projectDir)
  let scriptData = {}
  if (existsSync(join(absDir, 'script.json'))) {
    try { scriptData = readScriptJson(absDir).data || {} } catch {}
  }
  const brandKit = loadBrandKit(absDir)
  const md = buildMotionMarkdown({
    scriptData,
    referenceStyle: scriptData.referenceStyle || null,
    brandKit,
  })
  const outPath = join(absDir, 'MOTION.md')
  writeFileSync(outPath, md, 'utf8')
  return { ok: true, path: outPath, relPath: 'MOTION.md', content: md }
}

/**
 * Full Reference Video Reverse-Engineering Pipeline:
 * Probes video -> detects real shot cuts -> analyzes audio BPM/drops -> extracts 3x3 visual contact sheet ->
 * invokes 4-protocol Multimodal Vision LLM to extract complete replicable visual/pacing/VFX/audio DNA ->
 * writes `reference/reference-analysis.json` + `MOTION.md` and binds `script.json.referenceStyle`.
 */
export async function analyzeReferenceVideo(options = {}) {
  loadEnv()
  const {
    projectDir,
    videoPath,
    extractAudioAsBgm = false,
    applyToScript = true,
    useVision = true,
    callLlmChatFn = null,
    signal,
    onProgress,
  } = options

  if (!projectDir) throw new Error('projectDir is required')
  if (!videoPath) throw new Error('videoPath is required')

  const absProject = resolve(projectDir)
  const absVideo = isAbsolute(videoPath) ? videoPath : resolve(absProject, videoPath)
  if (!existsSync(absVideo)) {
    throw new Error(`参考视频文件不存在: ${absVideo}`)
  }

  const refDir = join(absProject, 'reference')
  mkdirSync(refDir, { recursive: true })
  const sourceName = basename(absVideo)

  // Stage copy into project reference/ if outside projectDir
  const stagedVideoRel = `reference/ref-source${extname(absVideo) || '.mp4'}`
  const stagedVideoAbs = join(absProject, stagedVideoRel)
  if (resolve(absVideo) !== resolve(stagedVideoAbs)) {
    try { copyFileSync(absVideo, stagedVideoAbs) } catch {}
  }
  const workVideo = existsSync(stagedVideoAbs) ? stagedVideoAbs : absVideo

  onProgress?.({ stage: 'ref-probe', progress: 12, message: `正在解析参考视频「${sourceName}」分辨率、帧率与音轨...` })
  const tech = await probeReferenceVideo(workVideo, signal)

  onProgress?.({ stage: 'ref-cuts', progress: 30, message: `正在逐帧探测参考视频真实镜头切点与剪辑节奏 (${tech.durationSec}s)...` })
  const cuts = await detectShotBoundaries(workVideo, tech.durationSec, signal)

  let audioMeta = null
  let extractedBgmRel = ''
  if (tech.hasAudio) {
    onProgress?.({ stage: 'ref-audio', progress: 48, message: '正在提取参考视频音轨并测算真实 BPM、重拍与高潮突降点...' })
    const { ffmpeg } = resolveBinaries()
    const refAudioAbs = join(refDir, 'ref-audio.wav')
    const extRes = await runCommandRedirected(
      ffmpeg,
      ['-y', '-i', workVideo, '-vn', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', refAudioAbs],
      { timeoutMs: 60_000, signal },
    )
    if (extRes.code === 0 && existsSync(refAudioAbs)) {
      try {
        audioMeta = await analyzeAudioBeatStructure(refAudioAbs, { signal })
      } catch {}
      if (extractAudioAsBgm) {
        const bgmDestDir = join(absProject, 'assets')
        mkdirSync(bgmDestDir, { recursive: true })
        extractedBgmRel = 'assets/ref-extracted-bgm.wav'
        copyFileSync(refAudioAbs, join(absProject, extractedBgmRel))
      }
    }
  }

  onProgress?.({ stage: 'ref-frames', progress: 64, message: '正在抽取参考视频 9 宫格核心分镜关键帧用于多模态视觉拆解...' })
  const { framePaths, sheetPath } = await extractReferenceKeyframesAndSheet(workVideo, refDir, tech.durationSec, signal)

  // Default deterministic heuristic blueprint (used directly if vision LLM is offline, or enriched by vision LLM)
  let blueprint = {
    sourceName,
    sourceRelPath: stagedVideoRel,
    sheetRelPath: sheetPath ? 'reference/ref-sheet-3x3.jpg' : '',
    frameRelPaths: framePaths.map((_, i) => `reference/frames/kf-${String(i + 1).padStart(2, '0')}.jpg`),
    durationSec: tech.durationSec,
    width: tech.width,
    height: tech.height,
    aspectRatio: tech.aspectRatio,
    fps: tech.fps,
    shotCount: cuts.shotCount,
    avgShotSec: cuts.avgShotSec,
    minShotSec: cuts.minShotSec,
    blitzCutCount: cuts.blitzCutCount,
    cutTimestamps: cuts.cutTimestamps,
    bpm: audioMeta?.bpm || 0,
    dropsCount: audioMeta?.drops?.length || 0,
    drops: audioMeta?.drops || [],
    genre: cuts.recommendedPacingMode === 'dynamic' ? 'history-theater' : 'other',
    genreLabel: cuts.recommendedPacingMode === 'dynamic' ? '高燃卡点动态动画' : '视觉风格复刻短片',
    style: cuts.recommendedPacingMode === 'dynamic' ? 'cinematic' : 'tech',
    narrationMode: cuts.avgShotSec <= 3.5 && cuts.shotCount >= 18 ? 'subtitle-mv' : 'tts-beat-sync',
    visualStyle: `高对比电影感动态分镜（参考全长 ${tech.durationSec}s，实测 ${cuts.shotCount} 镜，平均 ${cuts.avgShotSec}s/镜，含 ${cuts.blitzCutCount} 处高燃快切）`,
    colorPalette: {
      background: '#0A0606',
      primary: '#F59E0B',
      accent: '#E11D48',
      highlight: '#FFF7DF',
    },
    characterDesign: '前景强对比动态剪影/动画主体 + 多层远景气氛与光束，配合节拍呼吸与动作挥砍',
    vfxSignature: ['鼓点镜头震动', '闪白/斜劈斩击光效', '冲击波扩散环', '飘散火星/粒子', '关键词高亮大字'],
    transitionSignature: ['flash-cut', 'slash-wipe', 'zoom-punch', 'glitch-cut'],
    subtitleStyle: 'cinematic',
    pacingSignature: {
      targetShotCount: Math.max(12, Math.min(64, cuts.shotCount)),
      avgShotSec: cuts.avgShotSec,
      minShotSec: cuts.minShotSec,
      bpm: audioMeta?.bpm || 110,
      dropsCount: audioMeta?.drops?.length || 0,
      recommendedPacingMode: cuts.recommendedPacingMode,
    },
    shotFormula: [
      { phase: '开篇定调钩子', pctRange: '0%~12%', archetype: 'hero-stand', visualMotif: '逆光英雄/主题大景 + 放射光线 + 巨幅片名', transition: 'cut' },
      { phase: '铺陈与推进', pctRange: '12%~42%', archetype: 'cavalry-rush', visualMotif: '大军/骑兵/动态主体推进 + 地图或流程演进', transition: 'slash-wipe' },
      { phase: '高潮突降爆燃连切', pctRange: '42%~75%', archetype: 'slash-climax', visualMotif: '密集 0.5~2 拍卡点斩击/冲击波/竖向光柱/闪切', transition: 'flash-cut' },
      { phase: '史册/成就高光总览', pctRange: '75%~92%', archetype: 'bamboo-slips', visualMotif: '立体竹简/功绩牌匾/疆域版图总览', transition: 'zoom-punch' },
      { phase: '史诗定格收尾', pctRange: '92%~100%', archetype: 'channel-end', visualMotif: '史诗金句收束 + 落版印章', transition: 'light-wipe' },
    ],
    replicationPrompt: '',
    visionAnalyzed: false,
    analyzedAt: new Date().toISOString(),
  }

  const llmSummary = getSafeLlmConfigSummary()
  const invoker = typeof callLlmChatFn === 'function' ? callLlmChatFn : (llmSummary.configured ? (p) => callLlmChat({ ...p, signal }) : null)

  if (useVision && invoker && sheetPath && existsSync(sheetPath)) {
    onProgress?.({ stage: 'ref-vision', progress: 78, message: `正在调用多模态大模型 (${llmSummary.model || 'Vision LLM'}) 深度拆解参考视频画风、人物、特效、转场与镜头公式...` })
    try {
      const sheetB64 = readFileSync(sheetPath).toString('base64')
      const visionSystem = `你是顶级电影拉片大师与 AI 动态图形视觉架构师。
请仔细观察这张从参考视频中按时间等距抽取的 3×3 关键帧合图，结合附带的 FFmpeg 实测剪辑节拍数据，逆向拆解出**可直接用于复刻同款风格视频的完整 JSON 基因蓝图**！

只输出严格 JSON（禁止 Markdown 围栏与多余说明）：
{
  "title": "对参考视频风格的一句话命名（<=14字）",
  "genre": "history-theater | code-animation | ui-tutorial | stickman-story | mv-lyric | product-promo | science-explainer | data-story | brand-story | talking-head | other",
  "genreLabel": "精准中文题材风格标签（如：历史剪影高燃卡点动画 / 科技产品发布会动效）",
  "style": "cinematic | energetic | tech | warm | documentary | emerald",
  "narrationMode": "subtitle-mv | tts-beat-sync | tts",
  "visualStyle": "100字以内详述构图、光影、质感、画风特征",
  "colorPalette": { "background": "#hex", "primary": "#hex", "accent": "#hex", "highlight": "#hex" },
  "characterDesign": "详述画面中人物/剪影/大军/道具或主体的造型与动画表现方式",
  "vfxSignature": ["特效1", "特效2", "特效3", "特效4"],
  "transitionSignature": ["flash-cut", "slash-wipe", "zoom-punch", "glitch-cut"],
  "subtitleStyle": "cinematic | pill",
  "subtitleNotes": "字幕字体、位置、关键词高亮颜色与字数节奏特征",
  "shotFormula": [
    { "phase": "阶段名", "pctRange": "0%~15%", "archetype": "hero-stand|cavalry-rush|slash-climax|strategic-map|bamboo-slips|plaque-summary|duel-confront|hero-numeral|channel-end|freeform-stage", "visualMotif": "该阶段核心画面构成与动作", "transition": "slash-wipe" }
  ],
  "replicationPrompt": "200~350字可直接注入下游 AI 导演与 Remotion 主程的【同款复刻指导指令】：明确画面人物构成、背景光影、特效元素、转场频率、字幕风格与音乐卡点节奏要求。"
}`
      const visionUserContent = [
        {
          type: 'text',
          text: JSON.stringify({
            task: '深度拆解这张参考视频 3x3 关键帧图，输出同款复刻视觉基因 JSON',
            sourceName,
            measuredTelemetry: {
              durationSec: tech.durationSec,
              resolution: `${tech.width}x${tech.height}`,
              aspectRatio: tech.aspectRatio,
              fps: tech.fps,
              detectedShotCount: cuts.shotCount,
              avgShotSec: cuts.avgShotSec,
              minShotSec: cuts.minShotSec,
              blitzCutCount: cuts.blitzCutCount,
              bpm: audioMeta?.bpm || 0,
              dropsCount: audioMeta?.drops?.length || 0,
              recommendedPacingMode: cuts.recommendedPacingMode,
            },
          }),
        },
        {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${sheetB64}` },
        },
      ]
      const reply = await invoker({
        system: visionSystem,
        messages: [{ role: 'user', content: visionUserContent }],
        temperature: 0.3,
        maxTokens: 2800,
        timeoutMs: 180_000,
        signal,
      })
      const parsed = extractJsonFromLlmText(reply?.text)
      if (parsed && typeof parsed === 'object') {
        blueprint = {
          ...blueprint,
          title: String(parsed.title || blueprint.genreLabel).trim(),
          genre: String(parsed.genre || blueprint.genre).trim(),
          genreLabel: String(parsed.genreLabel || blueprint.genreLabel).trim(),
          style: String(parsed.style || blueprint.style).trim(),
          narrationMode: ['subtitle-mv', 'tts-beat-sync', 'tts'].includes(String(parsed.narrationMode || '').trim())
            ? String(parsed.narrationMode).trim()
            : blueprint.narrationMode,
          visualStyle: String(parsed.visualStyle || blueprint.visualStyle).trim(),
          colorPalette: parsed.colorPalette && typeof parsed.colorPalette === 'object'
            ? { ...blueprint.colorPalette, ...parsed.colorPalette }
            : blueprint.colorPalette,
          characterDesign: String(parsed.characterDesign || blueprint.characterDesign).trim(),
          vfxSignature: Array.isArray(parsed.vfxSignature) && parsed.vfxSignature.length > 0 ? parsed.vfxSignature.slice(0, 8) : blueprint.vfxSignature,
          transitionSignature: Array.isArray(parsed.transitionSignature) && parsed.transitionSignature.length > 0 ? parsed.transitionSignature.slice(0, 6) : blueprint.transitionSignature,
          subtitleStyle: parsed.subtitleStyle === 'pill' ? 'pill' : 'cinematic',
          subtitleNotes: String(parsed.subtitleNotes || '').trim(),
          shotFormula: Array.isArray(parsed.shotFormula) && parsed.shotFormula.length >= 3 ? parsed.shotFormula.slice(0, 8) : blueprint.shotFormula,
          replicationPrompt: String(parsed.replicationPrompt || '').trim(),
          visionAnalyzed: true,
          visionModel: reply?.model || llmSummary.model || '',
        }
      }
    } catch (err) {
      blueprint.visionError = err?.message || String(err)
    }
  }

  if (!blueprint.replicationPrompt) {
    blueprint.replicationPrompt = `严格复刻参考视频「${sourceName}」的视觉与节奏基因：体裁定位为【${blueprint.genreLabel}】，总镜头密度对齐 **${blueprint.pacingSignature.targetShotCount} 镜**（平均每镜 ${blueprint.avgShotSec}s，含高燃快切与重拍同步）；画面风格为「${blueprint.visualStyle}」，人物与主体采用「${blueprint.characterDesign}」，核心特效包含 ${blueprint.vfxSignature.join('、')}，转场使用 ${blueprint.transitionSignature.join('/')}，字幕风格采用 ${blueprint.subtitleStyle}，配音节奏模式为 ${blueprint.narrationMode}。`
  }

  const analysisPath = join(refDir, 'reference-analysis.json')
  writeFileSync(analysisPath, JSON.stringify(blueprint, null, 2) + '\n', 'utf8')

  let updatedScript = null
  if (applyToScript && existsSync(join(absProject, 'script.json'))) {
    try {
      const { data } = readScriptJson(absProject)
      data.referenceStyle = blueprint
      if (blueprint.genre && blueprint.genre !== 'other') data.genre = blueprint.genre
      if (blueprint.genreLabel) data.genreLabel = blueprint.genreLabel
      // the reference's look becomes an explicit preset: style + theme switch together (a stale AI-designed palette in
      // script.theme would otherwise still override the preset colours)
      if (blueprint.style) {
        try {
          applyStyleDecision(data, { mode: 'preset', style: blueprint.style, profile: null })
        } catch {
          data.style = blueprint.style
        }
      }
      if (blueprint.narrationMode) data.narrationMode = blueprint.narrationMode
      if (blueprint.subtitleStyle) data.subtitleStyle = blueprint.subtitleStyle
      if (blueprint.pacingSignature?.recommendedPacingMode) {
        data.pacingMode = blueprint.pacingSignature.recommendedPacingMode
      }
      if (extractedBgmRel) {
        data.bgmMode = 'uploaded'
        data.bgm = {
          ...(data.bgm || {}),
          ...(audioMeta || {}),
          enabled: true,
          mode: 'uploaded',
          source: 'user-imported',
          path: extractedBgmRel,
          uploadedPath: extractedBgmRel,
        }
      }
      updatedScript = writeScriptJson(absProject, data).data
    } catch {}
  }

  const motionMd = exportProjectMotionMd(absProject)
  onProgress?.({
    stage: 'done',
    progress: 100,
    message: `✅ 参考视频拆解完成：实测 ${blueprint.shotCount} 镜 · ${blueprint.bpm || '?'} BPM · 已生成同款复刻基因与 MOTION.md！`,
  })

  return {
    ok: true,
    referenceStyle: blueprint,
    analysisPath,
    motionMdPath: motionMd.path,
    extractedBgmRel,
    script: updatedScript,
  }
}
