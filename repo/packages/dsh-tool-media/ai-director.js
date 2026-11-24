/**
 * AI Storyboard & Motion Choreography Director
 * Turns user topic + imported assets (`assets.json`) into a beat-locked, multi-scene `script.json`
 * featuring 6 .motion-grade layouts, choreographed transitions, layered Canvas VFX,
 * 6-8 stereo-panned SFX cues per scene, BPM-matched BGM, and real TTS voice matching.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  cleanSubtitleChunk,
  deriveVerbalSubtitleParts,
  formatDirectorBrief,
  normalizeContentOutline,
  normalizeNumeralsForDisplay,
  readScriptJson,
  resolveStyleKey,
  resolveVideoDimensions,
  splitDirectorBrief,
  stripMetaInstructions,
  toTtsText,
  VIDEO_STYLES,
  writeScriptJson,
} from '../shared/index.js'
import { isHistoricalContent, resolveGenreSelection } from './genre-router.js'
import { matchAllScenesInScript } from '../dsh-tool-local-tts/index.js'
import { importAssets, readAssets } from './asset-manager.js'
import { buildRichHtmlVideo } from './html-generator.js'
import { writeRemotionProjectFiles } from './remotion-generator.js'
import { buildBeatGrid, ensureProjectAudioAssets } from './audio-synth.js'
import { reassertLockedScenes, reconcileUserEdits } from './scene-locks.js'
import { applyLockedHtmlStore, syncLockedHtmlStore } from './region-refine.js'
import { applyStyleDecision, resolveStyleRequest, styleMoodKey } from './style-presets.js'

const TRANSITIONS = ['iris-circle', 'block-wipe', 'glitch-cut', 'zoom-punch', 'light-wipe']
const MOTIONS = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right']
const VFX_MODES = ['3d-depth+sweep', 'sparks+shockwave', 'halftone+glitch', 'grid+scan', 'radial-speedlines']
const THREE_PRESETS = ['orbital-core', 'cyber-terrain', 'particle-vortex', 'floating-monoliths', 'chrono-helix', 'matrix-cubes']

const STYLE_CONFIG = VIDEO_STYLES

function extractChapterTitle(narration, fallback) {
  const raw = String(narration || '')
    .trim()
    .replace(/^(?:请|帮我|帮忙)?(?:制作|生成|创作|拍|做)(?:一条|一个|一段)?\s*(?:\d+\s*秒(?:左右的?)?)?\s*/, '')
  if (!raw) return fallback
  const first = raw.split(/[，。！？；,!?;：:\n]/)[0].trim()
  if (!first) return fallback
  return first.length > 14 ? first.slice(0, 14) : first
}

function extractSemanticHighlights(text, fallbackTag, excludeTitle = '') {
  const cleanTitle = String(excludeTitle || '').trim()
  const clauses = String(text || '')
    .split(/[，。！？；、,!?;:\n]+/)
    .map((s) => s.trim().replace(/^[\d.\s、]+/, ''))
    .filter((s) => s.length >= 2 && s.length <= 14 && s !== cleanTitle)
  const uniq = []
  for (const c of clauses) {
    if (!uniq.includes(c)) uniq.push(c)
    if (uniq.length >= 3) break
  }
  const defaults = [fallbackTag, '声画同步', '节奏转场'].filter((x) => x && x !== cleanTitle)
  for (const d of defaults) {
    if (uniq.length >= 3) break
    if (!uniq.includes(d)) uniq.push(d)
  }
  return uniq
}

function ensureBeatGridOnScript(scriptData) {
  if (!scriptData || typeof scriptData !== 'object') return scriptData
  const mood = scriptData?.bgm?.mood || scriptData?.style || 'tech'
  const cfg = STYLE_CONFIG[scriptData?.style] || STYLE_CONFIG.tech
  const bpm = Number(scriptData?.bgm?.bpm) || cfg.bpm
  const totalSec = Math.max(
    4,
    Number(scriptData.totalDurationSec) ||
      (scriptData.scenes || []).reduce((acc, s) => acc + Number(s.durationSec || 4), 0),
  )
  const hasAnalyzedBeats =
    Boolean(scriptData?.bgm?.analyzed) &&
    Array.isArray(scriptData?.bgm?.beats) &&
    scriptData.bgm.beats.length >= 4
  if (hasAnalyzedBeats) {
    scriptData.bgm = {
      ...scriptData.bgm,
      enabled: scriptData?.bgm?.enabled !== false,
      mood,
      volume: Number.isFinite(Number(scriptData?.bgm?.volume)) ? Number(scriptData.bgm.volume) : 0.28,
      bpm,
    }
    return scriptData
  }
  const grid = buildBeatGrid(totalSec + 2, bpm)
  scriptData.bgm = {
    ...(scriptData?.bgm || {}),
    enabled: scriptData?.bgm?.enabled !== false,
    mood,
    volume: Number.isFinite(Number(scriptData?.bgm?.volume)) ? Number(scriptData.bgm.volume) : 0.28,
    path: scriptData?.bgm?.path || '',
    uploadedPath: scriptData?.bgm?.uploadedPath || '',
    source: scriptData?.bgm?.source || 'generated',
    bpm: grid.bpm,
    beats: grid.beats,
  }
  return scriptData
}

export function syncProjectCodeFromScript(projectDir, scriptData, { forceOverwrite = false } = {}) {
  const absDir = resolve(projectDir)
  const enriched = ensureBeatGridOnScript(scriptData)
  if (enriched.authoringMode === 'ai-coded' && !forceOverwrite) {
    // Preserve custom LLM-authored scene code; still refresh Remotion shotcraft libs & HTML5 skeleton when engine is remotion
    if (enriched.engine !== 'html') {
      writeFileSync(join(absDir, 'index.html'), buildRichHtmlVideo(enriched), 'utf8')
    }
    writeRemotionProjectFiles(absDir, enriched, { rebuildTemplate: false })
    return
  }
  writeFileSync(join(absDir, 'index.html'), buildRichHtmlVideo(enriched), 'utf8')
  writeRemotionProjectFiles(absDir, enriched, { rebuildTemplate: true })
}

function condenseSubtitleText(narration, fallback = '') {
  const clean = cleanSubtitleChunk(normalizeNumeralsForDisplay(stripMetaInstructions(narration || '')))
  return clean || cleanSubtitleChunk(normalizeNumeralsForDisplay(stripMetaInstructions(fallback || '')))
}

function buildSceneSubChunks(narration, subtitleText, specSubChunks = null, maxLineWidth = 16) {
  const cleanSpecChunks = Array.isArray(specSubChunks)
    ? specSubChunks.map((c) => cleanSubtitleChunk(normalizeNumeralsForDisplay(stripMetaInstructions(c)))).filter(Boolean)
    : null
  return deriveVerbalSubtitleParts(
    normalizeNumeralsForDisplay(stripMetaInstructions(narration || '')),
    cleanSpecChunks && cleanSpecChunks.length > 0 ? cleanSpecChunks : null,
    normalizeNumeralsForDisplay(stripMetaInstructions(subtitleText || '')),
    maxLineWidth,
  )
}

export function buildSceneSfxCues({ idx, total, layout, dur, sfxPick, cursors = [], visualBlueprint = '', genre = '' }) {
  const cues = []
  const gLow = String(genre || '').toLowerCase()
  // Historical / epic beat-sync genres are strictly choreographed on the real BGM beat grid
  // via `choreographBeatSfxCues()` — never inject off-beat UI chimes/pops/glitches here!
  if (gLow === 'history-theater' || gLow === 'mv-lyric') {
    if (idx === 0) {
      // war drum only for history; a modern MV opens on a clean hit
      const kind = gLow === 'history-theater' ? 'war_drum' : 'hit'
      cues.push({ type: kind, path: sfxPick(kind), offsetSec: 0, volume: 0.85, pan: 0 })
    }
    return cues
  }
  if (idx === 0) {
    cues.push({ type: 'hit', path: sfxPick('hit'), offsetSec: 0, volume: 0.62, pan: 0 })
    cues.push({ type: 'shimmer_swell', path: sfxPick('shimmer_swell'), offsetSec: 0.04, volume: 0.45, pan: 0 })
  } else {
    cues.push({
      type: layout === 'mosaic-pulse-wall' || layout === 'radial-climax' ? 'sub_drop' : 'hit',
      path: sfxPick('hit'),
      offsetSec: 0,
      volume: 0.52,
      pan: 0,
    })
  }

  // Interactive cursor clicks / drawer transitions / typing cues (synced to UI cursor keyframes)
  if (Array.isArray(cursors) && cursors.length > 0) {
    for (const c of cursors) {
      const clickAtSec = Number.isFinite(Number(c?.clickAt))
        ? Number(c.clickAt)
        : c?.click
          ? (Number(c?.t) > 1.01 ? Number(c.t) : (Number(c?.t) || 0.45) * dur)
          : NaN
      if (Number.isFinite(clickAtSec) && clickAtSec >= 0) {
        const clickAt = Math.min(Math.max(0.15, clickAtSec), Math.max(0.25, dur - 0.14))
        const pan = Number.isFinite(Number(c?.fx)) ? Math.max(-0.4, Math.min(0.4, (Number(c.fx) - 0.5) * 0.7)) : 0
        cues.push({ type: 'click', path: sfxPick('click'), offsetSec: Number(clickAt.toFixed(2)), volume: 0.68, pan })
        const lbl = `${c?.label || ''} ${visualBlueprint || ''}`
        if (/抽屉|展开|打开|弹窗|新建|菜单|切换|滑出/.test(lbl)) {
          cues.push({ type: 'whoosh', path: sfxPick('whoosh'), offsetSec: Number(Math.min(dur - 0.1, clickAt + 0.16).toFixed(2)), volume: 0.46, pan: pan * 0.5 })
        }
        if (/输入|打字|填写|润色|提示词/.test(lbl)) {
          cues.push({ type: 'typing', path: sfxPick('typing'), offsetSec: Number(Math.min(dur - 0.35, clickAt + 0.28).toFixed(2)), volume: 0.36, pan: 0, d: 0.6 })
        }
      }
    }
  } else if (genre === 'ui-tutorial' && /输入|打字|点击|抽屉/.test(visualBlueprint || '')) {
    if (/点击/.test(visualBlueprint)) cues.push({ type: 'click', path: sfxPick('click'), offsetSec: Math.min(dur - 0.25, 0.95), volume: 0.62, pan: 0 })
    if (/抽屉|展开|弹窗/.test(visualBlueprint)) cues.push({ type: 'whoosh', path: sfxPick('whoosh'), offsetSec: Math.min(dur - 0.2, 1.15), volume: 0.46, pan: 0 })
    if (/输入|打字/.test(visualBlueprint)) cues.push({ type: 'typing', path: sfxPick('typing'), offsetSec: Math.min(dur - 0.4, 1.4), volume: 0.34, pan: 0, d: 0.6 })
  }

  if (layout === 'card-fan-opener') {
    cues.push({ type: 'flip', path: sfxPick('flip'), offsetSec: 0.16, volume: 0.44, pan: -0.22 })
    cues.push({ type: 'flip', path: sfxPick('flip'), offsetSec: 0.34, volume: 0.44, pan: 0.18 })
    cues.push({ type: 'flip', path: sfxPick('flip'), offsetSec: 0.52, volume: 0.44, pan: -0.14 })
    cues.push({ type: 'whoosh', path: sfxPick('whoosh'), offsetSec: Math.min(0.85, dur * 0.28), volume: 0.46, pan: 0.15 })
  } else if (layout === 'app-focus-shot') {
    cues.push({ type: 'whoosh', path: sfxPick('whoosh'), offsetSec: 0.14, volume: 0.45, pan: -0.16 })
    cues.push({ type: 'pop_soft', path: sfxPick('pop_soft'), offsetSec: Math.min(0.62, dur * 0.2), volume: 0.48, pan: 0.14 })
    cues.push({ type: 'lock', path: sfxPick('lock'), offsetSec: Math.min(1.5, dur * 0.46), volume: 0.44, pan: 0 })
  } else if (layout === 'workflow-steps') {
    cues.push({ type: 'pop_soft', path: sfxPick('pop_soft'), offsetSec: 0.24, volume: 0.44, pan: -0.2 })
    cues.push({ type: 'pop_soft', path: sfxPick('pop_soft'), offsetSec: Math.min(0.62, dur * 0.26), volume: 0.44, pan: 0 })
    cues.push({ type: 'pop_soft', path: sfxPick('pop_soft'), offsetSec: Math.min(1.02, dur * 0.45), volume: 0.44, pan: 0.2 })
    cues.push({ type: 'shine', path: sfxPick('shine'), offsetSec: Math.min(1.8, dur * 0.65), volume: 0.4, pan: 0 })
  } else if (layout === 'split-wipe-compare') {
    cues.push({ type: 'swoosh', path: sfxPick('swoosh'), offsetSec: 0.24, volume: 0.48, pan: -0.15 })
    cues.push({ type: 'flip', path: sfxPick('flip'), offsetSec: Math.min(1.55, dur * 0.48), volume: 0.45, pan: 0.18 })
  } else if (layout === 'metric-dashboard') {
    cues.push({ type: 'tick_burst', path: sfxPick('tick_burst'), offsetSec: 0.2, volume: 0.44, pan: -0.1 })
    cues.push({ type: 'counter', path: sfxPick('counter'), offsetSec: 0.48, volume: 0.4, pan: 0, d: 0.65 })
    cues.push({ type: 'ding', path: sfxPick('ding'), offsetSec: Math.min(1.75, dur * 0.56), volume: 0.42, pan: 0.14 })
  } else if (layout === 'multi-window-trio') {
    cues.push({ type: 'pop_soft', path: sfxPick('pop_soft'), offsetSec: 0.2, volume: 0.42, pan: -0.24 })
    cues.push({ type: 'pop_soft', path: sfxPick('pop_soft'), offsetSec: 0.48, volume: 0.42, pan: 0 })
    cues.push({ type: 'pop_soft', path: sfxPick('pop_soft'), offsetSec: 0.76, volume: 0.42, pan: 0.24 })
    cues.push({ type: 'shimmer_swell', path: sfxPick('shimmer_swell'), offsetSec: Math.min(1.6, dur * 0.5), volume: 0.36, pan: 0 })
  } else if (layout === '3d-stage-opener' || layout === 'mosaic-pulse-wall') {
    cues.push({ type: 'whoosh', path: sfxPick('whoosh'), offsetSec: 0.3, volume: 0.48, pan: 0.2 })
    cues.push({ type: 'counter', path: sfxPick('counter'), offsetSec: 0.62, volume: 0.38, pan: 0, d: 0.7 })
    cues.push({ type: 'card', path: sfxPick('card'), offsetSec: 1.0, volume: 0.42, pan: -0.22 })
    cues.push({ type: 'card', path: sfxPick('card'), offsetSec: 1.28, volume: 0.42, pan: 0.22 })
  } else if (layout === 'media-split-motion' || layout === 'compare-dual') {
    cues.push({ type: 'card', path: sfxPick('card'), offsetSec: 0.38, volume: 0.46, pan: -0.24 })
    cues.push({ type: 'pop', path: sfxPick('pop'), offsetSec: 0.68, volume: 0.42, pan: 0.2 })
    cues.push({ type: 'pop', path: sfxPick('pop'), offsetSec: 0.94, volume: 0.42, pan: -0.18 })
    cues.push({ type: 'shine', path: sfxPick('shine'), offsetSec: Math.min(1.9, dur * 0.48), volume: 0.38, pan: 0.14 })
  } else if (layout === 'kinetic-impact') {
    cues.push({ type: 'glitch', path: sfxPick('glitch'), offsetSec: 0.26, volume: 0.46, pan: 0.1 })
    cues.push({ type: 'sparkle', path: sfxPick('sparkle'), offsetSec: 0.75, volume: 0.42, pan: -0.15 })
    cues.push({ type: 'typing', path: sfxPick('typing'), offsetSec: Math.min(1.5, dur * 0.4), volume: 0.34, pan: 0, d: 0.55 })
  } else {
    cues.push({ type: 'shimmer_swell', path: sfxPick('shimmer_swell'), offsetSec: 0.15, volume: 0.44, pan: 0 })
    cues.push({ type: 'sparkle', path: sfxPick('sparkle'), offsetSec: 0.42, volume: 0.45, pan: 0 })
    cues.push({ type: 'stamp', path: sfxPick('stamp'), offsetSec: Math.min(1.4, dur * 0.38), volume: 0.48, pan: 0 })
    cues.push({ type: 'chime', path: sfxPick('chime'), offsetSec: Math.max(0.5, dur - 1.35), volume: 0.48, pan: 0.1 })
  }

  if (idx < total - 1) {
    const preTime = Math.max(0.55, Number((dur - 0.52).toFixed(2)))
    cues.push({ type: idx % 2 === 0 ? 'riser' : 'suck', path: sfxPick('riser'), offsetSec: preTime, volume: 0.42, pan: 0, d: 0.52 })
    cues.push({ type: 'swoosh', path: sfxPick('swoosh'), offsetSec: Math.max(0.35, Number((dur - 0.2).toFixed(2))), volume: 0.46, pan: 0 })
  }

  return cues
}

/**
 * Plan a complete video storyboard from imported assets + prompt/topic.
 */
export async function planVideoFromAssets(options = {}) {
  const {
    projectDir,
    sources,
    title,
    topic = '',
    style = 'tech',
    engine = 'html',
    aspectRatio = 'auto',
    quality = '1080p',
    width: requestedWidth,
    height: requestedHeight,
    aiBadge = true,
    aiBadgeEnabled,
    aiBadgePosition = 'top-right',
    aiBadgeText = '',
    pacingMode = 'auto',
    visual3dMode = 'auto',
    fps: requestedFps,
    voiceId = 'auto',
    audience = '大众与创作者',
    goal = '呈现具备动态视觉排版、空间运镜、粒子光效、节拍音效、配乐与配音的完整成片',
  } = options

  if (!projectDir) throw new Error('projectDir is required')
  const absDir = resolve(projectDir)

  if (sources && (Array.isArray(sources) ? sources.length > 0 : true)) {
    await importAssets({ projectDir: absDir, sources })
  }

  let existing = {}
  if (existsSync(join(absDir, 'script.json'))) {
    try {
      existing = readScriptJson(absDir).data
    } catch {}
  }
  // HTML engine: capture locked scenes' <template> blocks before index.html is regenerated below (first capture wins)
  let lockedHtmlBlocks = {}
  if ((existing.engine || engine) !== 'remotion') {
    try {
      lockedHtmlBlocks = syncLockedHtmlStore(absDir, existing)
    } catch {}
  }

  const assets = readAssets(absDir)
  const allVisuals = (assets.items || []).filter((it) => it.type === 'image' || it.type === 'video')
  const nonAvatarVisuals = allVisuals.filter((it) => it.role !== 'avatar_base')
  const visuals = nonAvatarVisuals.length > 0 ? nonAvatarVisuals : allVisuals
  const importedMusic = (assets.items || []).filter((it) => it.role === 'music')
  const importedSfx = (assets.items || []).filter((it) => it.role === 'sfx')
  const notesText = (assets.notes || []).map((n) => n.text).join('\n').trim()

  // 视觉风格: 'auto' (AI 自由匹配) | preset id | 'user:<id>' (我的风格预设). The genre router only needs the base preset.
  const prelimStyle = resolveStyleKey(style, existing)
  // Production briefs are director notes ONLY — never a title / narration / on-screen text
  const briefSplit = splitDirectorBrief({
    topic,
    title: title || '',
    displayTitle: options.displayTitle,
    directorNotes: options.directorNotes || existing.directorNotes,
    contentOutline: options.contentOutline || existing.contentOutline,
    genre: options.genre || existing.genre,
    genreLabel: options.genreLabel || existing.genreLabel,
  })
  const projectTitle = briefSplit.title || existing.title || briefSplit.topic || 'AI 动效视听作品'
  const coreTopic = briefSplit.topic || projectTitle
  const fps = Number(requestedFps) || Number(existing.fps) || 30

  const genreInfo = resolveGenreSelection({
    genre: briefSplit.genre || existing.genre || '',
    genreLabel: briefSplit.genreLabel || existing.genreLabel || '',
    text: {
      topic: coreTopic,
      goal: `${briefSplit.directorNotes || ''} ${goal || ''}`,
      style: prelimStyle,
      hasMedia: visuals.length > 0,
    },
    hasScreenshots: visuals.length > 0,
  })
  const resolvedGenre = genreInfo.id
  const resolvedGenreLabel = genreInfo.label
  // The local planner never calls a model: 'auto' picks a preset with keyword rules (an AI run refines it later in the
  // plan LLM call); a plain preset equal to the project's base keeps an auto / user project as it is (the pipeline
  // passes its already resolved base); a deleted 「我的预设」 keeps the project's current style. Never an error.
  const styleOpts = {
    text: `${coreTopic} ${briefSplit.directorNotes || ''} ${options.userPrompt || options.polishedTopic || ''} ${notesText.slice(0, 600)}`,
    genre: resolvedGenre,
    genreLabel: resolvedGenreLabel,
    reResolve: true,
    keepModeIfBase: true,
  }
  let styleDecision
  try {
    styleDecision = resolveStyleRequest(existing, style ?? (existing.style ? undefined : 'auto'), styleOpts)
  } catch {
    styleDecision = resolveStyleRequest(existing, undefined, styleOpts)
  }
  const normalizedStyle = styleDecision.style
  const st = STYLE_CONFIG[normalizedStyle] || STYLE_CONFIG.tech

  const noteChunks = notesText
    ? notesText
        .split(/[。\n！？!?]+/)
        .map((s) => normalizeNumeralsForDisplay(stripMetaInstructions(s)))
        .filter((s) => s.length >= 6)
    : []

  const brandLogoAsset =
    visuals.find((m) => m.role === 'brand_mark' || /(?:^|[\/_-])(?:brand[-_]?mark|logo|app[-_]?icon)(?:[._-]|$)/i.test(String(m.name || m.path || ''))) || null
  const contentVisuals =
    visuals.length > 1 && brandLogoAsset ? visuals.filter((m) => m.id !== brandLogoAsset.id) : visuals
  const artworkVisuals = contentVisuals.filter(
    (m) => (Number(m.height) > Number(m.width) * 1.1) || /(?:comic|manga|char|poster|cover|art|sheet|p\d{2}|c\d{2})/i.test(String(m.name || m.path || '')),
  )
  const uiVisuals = contentVisuals.filter((m) => !artworkVisuals.some((a) => a.id === m.id))
  const orderedVisuals = uiVisuals.length > 0 ? uiVisuals : contentVisuals

  const toMediaEntry = (m, mi = 0) => ({
    assetId: m.id,
    path: m.editedPath || m.path,
    originalPath: m.path,
    webPath: m.editedWebPath || m.webPath || '',
    type: m.type,
    role: m.role,
    width: Number(m.editedWidth || m.width || 0),
    height: Number(m.editedHeight || m.height || 0),
    motion: MOTIONS[mi % MOTIONS.length],
    trimStartSec: 0,
  })

  const scenesSpec = Array.isArray(options.scenesSpec) && options.scenesSpec.length > 0 ? options.scenesSpec : null
  const defaultZeroAssetCount = String(coreTopic || '').trim().length >= 28 ? 6 : 4
  const sceneCount = scenesSpec
    ? scenesSpec.length
    : Math.max(
        3,
        Math.min(
          48,
          Number(options.sceneCount) ||
            Math.max(
              noteChunks.length >= 4 ? Math.min(36, noteChunks.length) : 0,
              orderedVisuals.length >= 4 ? Math.min(32, orderedVisuals.length + 2) : contentVisuals.length || defaultZeroAssetCount,
            ),
        ),
      )

  const buckets = Array.from({ length: sceneCount }, () => [])
  orderedVisuals.forEach((v, i) => {
    buckets[i % sceneCount].push(v)
  })

  // Global media pool using curated uncropped assets so mosaic-pulse-wall / card-fan-opener render cleanly
  const globalMediaPool = contentVisuals.map((m, mi) => toMediaEntry(m, mi))
  const fanPool = (artworkVisuals.length >= 3 ? artworkVisuals : contentVisuals).slice(0, 7).map((m, mi) => toMediaEntry(m, mi))

  const sfxPick = (kind) => importedSfx.find((x) => x.name.toLowerCase().includes(kind))?.path || `audio/sfx/${kind}.wav`

  const middleLayoutsWithMedia = [
    'app-focus-shot',
    'workflow-steps',
    'split-wipe-compare',
    'metric-dashboard',
    'multi-window-trio',
    'mosaic-pulse-wall',
  ]
  const isHistoricalTopic = isHistoricalContent(`${coreTopic || ''} ${notesText || ''}`)
  const zeroAssetNarrative = contentVisuals.length === 0 && isHistoricalTopic
  const middleLayoutsTextOnly = zeroAssetNarrative
    ? ['narrative-diorama']
    : [
        'svg-architecture-flow',
        'hud-telemetry-dashboard',
        'vibecoding-spring-stage',
        'metric-dashboard',
        'workflow-steps',
        'kinetic-impact',
      ]
  const NARRATIVE_DEFAULTS = [
    { mood: 'dawn-amber', setting: 'palace-stairs', archetype: 'hero-numeral', heroNum: '01', heroUnit: '幕' },
    { mood: 'crimson-war', setting: 'mountain-camp', archetype: 'oath-break' },
    { mood: 'crimson-war', setting: 'city-siege', archetype: 'strategic-map' },
    { mood: 'crimson-war', setting: 'city-siege', archetype: 'slash-climax' },
    { mood: 'indigo-night', setting: 'vast-plain', archetype: 'cavalry-rush' },
    { mood: 'ash-twilight', setting: 'river-gorge', archetype: 'farewell-tent' },
    { mood: 'void-gold', setting: 'mountain-camp', archetype: 'plaque-summary' },
  ]

  const findVisualByRef = (list, ref) => {
    const q = String(ref || '').trim().toLowerCase()
    if (!q) return null
    const qBase = q.replace(/^.*[\\/]/, '')
    const qNoExt = qBase.replace(/\.[^.]+$/, '')
    return (
      list.find((v) => {
        const orig = String(v.originalName || '').toLowerCase()
        const name = String(v.name || '').toLowerCase()
        const id = String(v.id || '').toLowerCase()
        const p = String(v.path || '').replace(/\\/g, '/').toLowerCase()
        const ep = String(v.editedPath || '').replace(/\\/g, '/').toLowerCase()
        return (
          orig === q ||
          orig === qBase ||
          orig.replace(/\.[^.]+$/, '') === qNoExt ||
          name === q ||
          name === qBase ||
          name === qNoExt ||
          id === q ||
          p === q ||
          ep === q ||
          p.endsWith(`/${qBase}`)
        )
      }) || null
    )
  }

  const resolveSpecMedia = (specItem, fallbackBucket, sceneIdx) => {
    if (Array.isArray(specItem?.media) && specItem.media.length > 0) {
      return specItem.media.map((ref, mi) => {
        if (typeof ref === 'string') {
          const hit = findVisualByRef(visuals, ref)
          if (hit) return toMediaEntry(hit, sceneIdx + mi)
          return { assetId: `ref-${sceneIdx}-${mi}`, path: ref, webPath: ref, type: 'image', motion: MOTIONS[(sceneIdx + mi) % MOTIONS.length], trimStartSec: 0 }
        }
        return ref
      })
    }
    return fallbackBucket.slice(0, 4).map((m, mi) => toMediaEntry(m, sceneIdx + mi))
  }

  const scenes = []
  let prevLayout = ''
  for (let i = 0; i < sceneCount; i++) {
    const spec = scenesSpec ? scenesSpec[i] : null
    const isFirst = i === 0
    const isLast = i === sceneCount - 1
    const bucket = buckets[i]
    const primary = bucket[0]

    let mediaArr = resolveSpecMedia(spec, bucket, i)

    let layout = spec?.layout || 'app-focus-shot'
    if (!spec?.layout) {
      if (zeroAssetNarrative) {
        layout = 'narrative-diorama'
      } else if (isFirst) {
        layout = fanPool.length >= 3 ? 'card-fan-opener' : '3d-stage-opener'
      } else if (isLast) {
        layout = 'radial-climax'
      } else {
        const candidates = contentVisuals.length > 0 ? middleLayoutsWithMedia : middleLayoutsTextOnly
        const pick = candidates[(i - 1) % candidates.length]
        layout = pick === prevLayout ? candidates[i % candidates.length] : pick
      }
    }
    prevLayout = layout
    const defaultNarrSpec =
      zeroAssetNarrative
        ? NARRATIVE_DEFAULTS[isFirst ? 0 : isLast ? NARRATIVE_DEFAULTS.length - 1 : 1 + ((i - 1) % (NARRATIVE_DEFAULTS.length - 2))]
        : undefined
    const resolvedStageSpec = spec?.stageSpec || defaultNarrSpec

    // Ensure multi-asset promo layouts always have required media items without blank frames
    if ((layout === 'multi-window-trio' || layout === 'split-wipe-compare') && orderedVisuals.length >= 2) {
      const need = layout === 'multi-window-trio' ? 3 : 2
      while (mediaArr.length < need) {
        const extra = orderedVisuals[(i + mediaArr.length) % orderedVisuals.length]
        if (extra) mediaArr.push(toMediaEntry(extra, i + mediaArr.length))
        else break
      }
    }

    let sceneTitle = normalizeNumeralsForDisplay(stripMetaInstructions(spec?.title || ''))
    let narration = normalizeNumeralsForDisplay(stripMetaInstructions(spec?.narration || ''))
    let tag = normalizeNumeralsForDisplay(stripMetaInstructions(spec?.tag || st.label))
    let subtitleLine = normalizeNumeralsForDisplay(stripMetaInstructions(spec?.subtitleLine || ''))

    if (!narration) {
      if (isFirst) {
        sceneTitle = sceneTitle || extractChapterTitle(briefSplit.displayTitle || existing.title || coreTopic, '高能开篇')
        narration =
          noteChunks[0] ||
          `${coreTopic}正式开启。光影层次与音效节拍同步推进，带你直观感受核心魅力。`
        tag = spec?.tag || st.label
        subtitleLine = subtitleLine || (coreTopic && coreTopic.length <= 28 ? coreTopic : '')
      } else if (isLast) {
        narration =
          noteChunks[i] ||
          `把每一份创意与画面瞬间定格成高品质成片，现在就开始你的创作旅程。`
        sceneTitle = sceneTitle || extractChapterTitle(narration, projectTitle)
        tag = spec?.tag || '高燃收尾'
      } else {
        narration =
          noteChunks[i] ||
          `透过动态镜头推拉、清晰步骤演示与细腻声画配合，让每一个核心要点一目了然。`
        sceneTitle = sceneTitle || extractChapterTitle(narration, `核心篇章 ${String(i + 1).padStart(2, '0')}`)
        tag = spec?.tag || `第 ${i + 1} 幕`
      }
    } else if (!sceneTitle) {
      sceneTitle = extractChapterTitle(narration, `第 ${i + 1} 幕`)
    }
    narration = normalizeNumeralsForDisplay(stripMetaInstructions(narration))
    sceneTitle = normalizeNumeralsForDisplay(stripMetaInstructions(sceneTitle)) || `第 ${i + 1} 幕`

    const subMaxW = requestedWidth && requestedHeight && requestedWidth < requestedHeight ? 11 : 16
    const subChunks = buildSceneSubChunks(narration, spec?.subtitleText || '', spec?.subChunks, subMaxW)
    const subtitleText = subChunks.join(' ') || condenseSubtitleText(narration, sceneTitle)
    const highlights = Array.isArray(spec?.highlights) && spec.highlights.length > 0
      ? spec.highlights.map((h) => normalizeNumeralsForDisplay(stripMetaInstructions(h))).filter(Boolean)
      : extractSemanticHighlights(narration, tag, sceneTitle)
    const compareLeft = spec?.compareLeft || { label: '传统方案', text: highlights[0] || '繁琐手动操作' }
    const compareRight = spec?.compareRight || { label: '智能重构', text: highlights[1] || '一键高效直出' }

    const defaultCams =
      layout === 'app-focus-shot' && !spec?.cams
        ? resolvedGenre === 'ui-tutorial'
          ? [
              { t: 0, fx: 0.5, fy: 0.46, z: 1.06 },
              { t: 0.55, fx: 0.36, fy: 0.32, z: 1.92 },
              { t: 2.6, fx: 0.45, fy: 0.42, z: 1.75 },
            ]
          : [
              { t: 0, fx: 0.5, fy: 0.5, z: 1.03 },
              { t: 0.35, fx: 0.48, fy: 0.46, z: 1.24 },
              { t: 0.86, fx: 0.5, fy: 0.5, z: 1.06 },
            ]
        : spec?.cams

    const rawSteps =
      layout === 'workflow-steps' && !spec?.steps
        ? (highlights.length >= 3 ? highlights : ['导入素材', '智能编排', '精修渲染']).map((h, si) => ({
            title: h,
            desc: si === 0 ? '聚合图文视听' : si === 1 ? '自动节奏分镜' : '高清成片交付',
            img: mediaArr[si % Math.max(1, mediaArr.length)]?.path || '',
          }))
        : spec?.steps
    const defaultSteps = Array.isArray(rawSteps)
      ? rawSteps.map((stItem, si) => {
          const ref = String(stItem?.img || stItem?.asset || '').trim()
          const hit = ref ? findVisualByRef(visuals, ref) : null
          return {
            ...stItem,
            img: hit ? hit.editedPath || hit.path : ref || mediaArr[si % Math.max(1, mediaArr.length)]?.path || '',
          }
        })
      : undefined

    const defaultMetrics =
      layout === 'metric-dashboard' && (!Array.isArray(spec?.metrics) || spec.metrics.length === 0)
        ? [
            { value: `${(i + 1) * 18}+`, label: highlights[0] || '高能分镜' },
            { value: '1080P', label: highlights[1] || '清晰直出' },
            { value: '60FPS', label: highlights[2] || '丝滑动效' },
          ]
        : spec?.metrics || []

    const estDur = Number(spec?.durationSec) > 0
      ? Number(spec.durationSec)
      : Math.max(sceneCount >= 8 ? 3.2 : 4.0, Number((narration.length / 4.8 + 0.95).toFixed(2)))
    const sfxCues = Array.isArray(spec?.sfxCues) && spec.sfxCues.length > 0
      ? spec.sfxCues
      : buildSceneSfxCues({
          idx: i,
          total: sceneCount,
          layout,
          dur: estDur,
          sfxPick,
          cursors: spec?.cursors,
          visualBlueprint: spec?.visualBlueprint || '',
          genre: resolvedGenre,
        })

    const uiSafeLayouts = ['card-fan-opener', 'app-focus-shot', 'workflow-steps', 'split-wipe-compare', 'metric-dashboard', 'multi-window-trio']
    const cleanTransitions = ['light-wipe', 'iris-circle', 'zoom-punch']
    const transitionPool = normalizedStyle === 'emerald' || uiSafeLayouts.includes(layout) ? cleanTransitions : TRANSITIONS
    const chosenSceneEmotion = spec?.voiceEmotion || spec?.emotion || (isFirst ? '欢快热情' : isLast ? '激昂有力' : resolvedGenre === 'ui-tutorial' ? '自信明快' : st.emotion)
    scenes.push({
      id: spec?.id || `scene-${String(i + 1).padStart(2, '0')}`,
      title: sceneTitle,
      narration,
      subtitleText,
      subChunks,
      subtitleLine,
      emotion: chosenSceneEmotion,
      voiceEmotion: chosenSceneEmotion,
      role: spec?.role || st.role,
      speechRate: Number(spec?.speechRate || (resolvedGenre === 'ui-tutorial' ? (isFirst || isLast ? 1.08 : 1.05) : isFirst || isLast ? 1.05 : 1.0)),
      voiceId: spec?.voiceId || voiceId || 'auto',
      voiceLeadSec: Number.isFinite(Number(spec?.voiceLeadSec)) ? Number(spec.voiceLeadSec) : sceneCount >= 6 ? 0.22 : 0.35,
      tailSec: Number.isFinite(Number(spec?.tailSec)) ? Number(spec.tailSec) : sceneCount >= 6 ? 0.32 : 0.65,
      tag,
      layout,
      threePreset: spec?.threePreset || spec?.stageSpec?.threePreset || THREE_PRESETS[i % THREE_PRESETS.length],
      transition: spec?.transition || transitionPool[i % transitionPool.length],
      kenBurns: spec?.kenBurns || MOTIONS[i % MOTIONS.length],
      vfx: spec?.vfx || VFX_MODES[i % VFX_MODES.length],
      highlights,
      compareLeft,
      compareRight,
      counterTarget: spec?.counterTarget ?? (i + 1) * 24,
      counterLabel: spec?.counterLabel || st.label,
      metrics: defaultMetrics,
      steps: defaultSteps,
      trioLabels: spec?.trioLabels,
      windowLayout: spec?.windowLayout,
      windowTitle: spec?.windowTitle || (layout === 'app-focus-shot' ? projectTitle : undefined),
      windowTheme: spec?.windowTheme || (resolvedGenre === 'ui-tutorial' && mediaArr.length > 0 ? 'light' : undefined),
      cams: defaultCams,
      marks: spec?.marks,
      cursors: spec?.cursors,
      loupe: spec?.loupe,
      visualBlueprint: spec?.visualBlueprint,
      motionNotes: spec?.motionNotes || spec?.visualBlueprint,
      hudStep: Number.isFinite(Number(spec?.hudStep)) ? Number(spec.hudStep) : undefined,
      stageSpec: resolvedStageSpec,
      beatCount: Number.isFinite(Number(spec?.beatCount)) ? Number(spec.beatCount) : undefined,
      accentWords: Array.isArray(spec?.accentWords) ? spec.accentWords : undefined,
      fanMedia: Array.isArray(spec?.fanMedia)
        ? resolveSpecMedia({ media: spec.fanMedia }, bucket, i)
        : layout === 'card-fan-opener'
          ? fanPool
          : undefined,
      media: mediaArr,
      poolMedia: layout === '3d-stage-opener' || layout === 'mosaic-pulse-wall' || layout === 'card-fan-opener' ? globalMediaPool : undefined,
      sfxCues,
      visualPrompt: spec?.visualPrompt || (primary ? `${layout} 空间动态编排 · ${primary.path}` : `${layout} 动效排版与光影特效`),
      durationSec: estDur,
    })
  }

  const dims = resolveVideoDimensions({
    aspectRatio: aspectRatio || existing.requestedAspectRatio || 'auto',
    quality: quality || existing.quality || '1080p',
    width: requestedWidth,
    height: requestedHeight,
    topic: coreTopic,
    assets: visuals,
    targetPlatform: options.targetPlatform || existing.targetPlatform || '',
  })

  const requestedBrandAsset = options.brandMark ? findVisualByRef(visuals, options.brandMark) : null
  const resolvedBrandMark =
    (requestedBrandAsset ? requestedBrandAsset.editedPath || requestedBrandAsset.path : options.brandMark) ||
    (brandLogoAsset ? brandLogoAsset.editedPath || brandLogoAsset.path : existing.brandMark || '')
  const resolvedWorkflowSteps =
    Array.isArray(options.workflowSteps) && options.workflowSteps.length > 0
      ? options.workflowSteps
      : existing.workflowSteps

  const mergedOutline = Array.isArray(briefSplit.contentOutline) && briefSplit.contentOutline.length > 0
    ? briefSplit.contentOutline
    : normalizeContentOutline(existing.contentOutline)
  const mergedNotes = briefSplit.directorNotes || existing.directorNotes || ''
  const rawGoalInput =
    String(options.userPrompt || options.polishedTopic || '').trim() ||
    (goal && goal !== '呈现具备动态视觉排版、空间运镜、粒子光效、节拍音效、配乐与配音的完整成片' ? String(goal).trim() : '') ||
    (String(topic || '').trim().length > 36 || /【/.test(String(topic || '')) ? String(topic).trim() : '') ||
    String(existing.goal || '').trim()
  const preservedGoal =
    formatDirectorBrief({
      goal: rawGoalInput,
      displayTitle: briefSplit.displayTitle,
      genreLabel: resolvedGenreLabel,
      contentOutline: mergedOutline,
      directorNotes: mergedNotes,
      topic: coreTopic,
    }) || goal

  const styleFields = applyStyleDecision({}, styleDecision)
  const nextScript = {
    ...existing,
    authoringMode: 'local-draft',
    title: projectTitle,
    topic: coreTopic,
    displayTitle: briefSplit.displayTitle,
    directorNotes: mergedNotes,
    contentOutline: mergedOutline,
    genre: resolvedGenre,
    genreLabel: resolvedGenreLabel,
    style: normalizedStyle,
    engine: engine === 'remotion' ? 'remotion' : 'html',
    fps,
    width: dims.width,
    height: dims.height,
    aspectRatio: dims.aspectRatio,
    requestedAspectRatio: dims.requestedAspectRatio,
    quality: dims.quality,
    dimensionReason: dims.reason,
    aiBadge: aiBadgeEnabled !== undefined ? Boolean(aiBadgeEnabled) : Boolean(aiBadge),
    aiBadgeEnabled: aiBadgeEnabled !== undefined ? Boolean(aiBadgeEnabled) : (existing.aiBadgeEnabled !== undefined ? Boolean(existing.aiBadgeEnabled) : aiBadge !== false),
    aiBadgePosition: String(aiBadgePosition || existing.aiBadgePosition || 'top-right'),
    aiBadgeText: String(aiBadgeText || existing.aiBadgeText || (typeof aiBadge === 'string' && aiBadge.trim() ? aiBadge : '') || ''),
    pacingMode: String(pacingMode || existing.pacingMode || 'auto'),
    visual3dMode: String(visual3dMode || existing.visual3dMode || 'auto'),
    durationMode: String(options.durationMode || existing.durationMode || 'auto'),
    targetDurationSec: Number(options.targetDurationSec) || Number(existing.targetDurationSec) || 0,
    bgmMode: String(options.bgmMode || existing.bgmMode || (importedMusic.length > 0 ? 'uploaded' : 'llm-coded')),
    brandMark: resolvedBrandMark || undefined,
    workflowSteps: resolvedWorkflowSteps,
    audience,
    goal: preservedGoal,
    voiceMode: voiceId && voiceId !== 'auto' ? 'manual' : 'auto',
    defaultVoiceId: voiceId || 'auto',
    narrationMode: options.narrationMode || existing.narrationMode || 'tts',
    subtitleStyle: zeroAssetNarrative || options.narrationMode === 'subtitle-mv' ? 'cinematic' : existing.subtitleStyle || 'pill',
    // styleMode / styleProfile / styleAuto (undefined drops a stale value) + the preset's or the custom profile's palette
    styleMode: styleFields.styleMode,
    styleProfile: styleFields.styleProfile,
    styleAuto: styleFields.styleAuto,
    theme: {
      ...styleFields.theme,
      ...(resolvedBrandMark ? { brandMark: resolvedBrandMark } : {}),
    },
    bgm: {
      ...(existing?.bgm || {}),
      enabled: true,
      mood: styleDecision.profile ? styleMoodKey(styleDecision.profile) : st.mood,
      bpm: Number(existing?.bgm?.analyzed ? existing.bgm.bpm : 0) || st.bpm,
      volume: Number.isFinite(Number(existing?.bgm?.volume)) ? Number(existing.bgm.volume) : 0.24,
      path: importedMusic[0]?.path || existing?.bgm?.path || '',
      uploadedPath: importedMusic[0]?.path || existing?.bgm?.uploadedPath || '',
      source: importedMusic.length > 0 ? 'user-imported' : existing?.bgm?.source || 'generated',
    },
    scenes,
  }

  // Human edit protection: locked scenes keep content + timing, user overrides are re-applied (user wins)
  const editMerge = reconcileUserEdits({ projectDir: absDir, prevScript: existing, nextScript, stage: 'local-director' })
  const saved = writeScriptJson(absDir, editMerge.script)
  ensureBeatGridOnScript(saved.data)
  writeScriptJson(absDir, saved.data)
  await ensureProjectAudioAssets(absDir, saved.data, assets)
  matchAllScenesInScript(absDir, { voiceId: voiceId || 'auto', forceAuto: voiceId === 'auto' })
  if (editMerge.report) reassertLockedScenes(absDir, editMerge.script)
  const reloaded = readScriptJson(absDir).data
  syncProjectCodeFromScript(absDir, reloaded, { forceOverwrite: true })
  if (Object.keys(lockedHtmlBlocks).length > 0) {
    // Locked scenes keep the HyperFrames HTML implementation they had when they were locked
    try {
      const htmlPath = join(absDir, 'index.html')
      const cur = readFileSync(htmlPath, 'utf8')
      const kept = applyLockedHtmlStore(cur, lockedHtmlBlocks)
      if (kept.html !== cur) writeFileSync(htmlPath, kept.html, 'utf8')
    } catch {}
  }

  return {
    ok: true,
    projectDir: absDir,
    engine: reloaded.engine,
    sceneCount: reloaded.scenes?.length || 0,
    assetsUsed: visuals.length,
    visualsUsed: visuals.length,
    importedMusic: importedMusic.length,
    importedSfx: importedSfx.length,
    sfxCount: (reloaded.scenes || []).reduce((n, s) => n + (Array.isArray(s.sfxCues) ? s.sfxCues.length : 0), 0),
    ...(editMerge.report ? { editMerge: editMerge.report } : {}),
    script: reloaded,
  }
}
