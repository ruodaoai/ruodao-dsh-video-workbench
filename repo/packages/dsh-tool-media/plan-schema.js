import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  cleanSubtitleChunk,
  deriveVerbalSubtitleParts,
  estimatePlanDurationSec,
  normalizeNumeralsForDisplay,
  normalizeVideoStyle,
  resolveSafeZoneSpec,
  resolveTargetDurationPolicy,
  sanitizeSpokenNarration,
  stripMetaInstructions,
  VIDEO_STYLES,
} from '../shared/index.js'
import { buildGenreGuidance, detectGenre, getGenreProfile, isHistoricalContent, resolveGenreSelection } from './genre-router.js'
import { buildFigureStylePlanDirective, FIG_BUILDS, FIG_HAIR, FIG_HEADWEAR, FIG_OUTFITS, FIG_PROPS, FIG_STYLES, normalizeAmbience, normalizeAtmosphere, normalizeCast, normalizeFigureStyle, normalizeFigureStyleNote } from './figure-kit.js'
import { applyStyleDecision, buildStylePlanDirective, decidePlanStyle, effectiveStyleMode } from './style-presets.js'
import { extractBriefBeats } from './brief-beats.js'
import { isBillingError } from './cloud-ledger.js'
import { stripPlazaTemplateGuidance } from './plaza-guidance.js'

/** A model call that failed for a reason worth waiting out (rate limit, gateway / server busy, timeout, network). */
export function isTransientLlmFailure(err) {
  if (!err || isBillingError(err)) return false
  const msg = String(err?.message || err || '')
  const status = Number(err?.status) || Number((msg.match(/返回错误 \((\d{3})\)/) || [])[1]) || 0
  if ([429, 502, 503, 504, 524].includes(status)) return true
  return /超时|timed? ?out|fetch failed|network|econnreset|etimedout|socket|other side closed|terminated|und_err/i.test(msg)
}

/** Rule-engine shots that follow the brief's key points (opener with the topic, then one shot per key point). */
export function buildBriefFallbackShots({ topic = '', beats = [], pacingId = 'auto' } = {}) {
  const dur = pacingId === 'calm' ? 4.6 : pacingId === 'balanced' ? 3.6 : 2.6
  const opener = String(topic || '').trim()
  const shots = []
  if (opener && !beats.includes(opener)) shots.push({ title: opener, narration: opener, durationSec: Number((dur + 0.6).toFixed(2)) })
  for (const b of beats) shots.push({ title: b, narration: b, durationSec: dur })
  return shots
}

export const PROMO_PLAN_VERSION = 'promo-plan/1'

export const PROMO_SHOT_RECIPES = {
  hold: {
    id: 'hold',
    label: '稳态定焦',
    layout: 'media-split-motion',
    kenBurns: 'hold',
    fromScale: 1.0,
    toScale: 1.02,
    transition: 'cut',
  },
  push_in: {
    id: 'push_in',
    label: '缓推聚焦 (≤1.25x)',
    layout: 'media-split-motion',
    kenBurns: 'zoom-in',
    fromScale: 1.0,
    toScale: 1.22,
    transition: 'iris-circle',
  },
  pull_out: {
    id: 'pull_out',
    label: '后拉全览',
    layout: '3d-stage-opener',
    kenBurns: 'zoom-out',
    fromScale: 1.24,
    toScale: 1.0,
    transition: 'light-wipe',
  },
  pan_down: {
    id: 'pan_down',
    label: '纵向俯仰摇镜',
    layout: 'media-split-motion',
    kenBurns: 'pan-down',
    fromScale: 1.12,
    toScale: 1.15,
    transition: 'slash-wipe',
  },
  pan_across: {
    id: 'pan_across',
    label: '横向平移扫镜',
    layout: 'compare-dual',
    kenBurns: 'pan-right',
    fromScale: 1.1,
    toScale: 1.12,
    transition: 'block-wipe',
  },
  face_focus: {
    id: 'face_focus',
    label: '主体特写焦点',
    layout: 'media-split-motion',
    kenBurns: 'zoom-in',
    fromScale: 1.08,
    toScale: 1.25,
    transition: 'iris-circle',
  },
  impact: {
    id: 'impact',
    label: '高能冲击卡点',
    layout: 'kinetic-impact',
    kenBurns: 'zoom-in',
    fromScale: 1.15,
    toScale: 1.0,
    transition: 'flash-cut',
  },
  freeze_end: {
    id: 'freeze_end',
    label: '终幕定格落版',
    layout: 'radial-climax',
    kenBurns: 'zoom-out',
    fromScale: 1.16,
    toScale: 1.0,
    transition: 'cut',
  },
  arch_flow: {
    id: 'arch_flow',
    label: '动态 SVG 架构拓扑',
    layout: 'svg-architecture-flow',
    kenBurns: 'zoom-in',
    fromScale: 1.0,
    toScale: 1.12,
    transition: 'iris-circle',
  },
  hud_telemetry: {
    id: 'hud_telemetry',
    label: 'HUD 遥测数据与代码流',
    layout: 'hud-telemetry-dashboard',
    kenBurns: 'zoom-in',
    fromScale: 1.0,
    toScale: 1.14,
    transition: 'slash-wipe',
  },
  spring_stage: {
    id: 'spring_stage',
    label: 'Vibecoding 节拍弹簧舞台',
    layout: 'vibecoding-spring-stage',
    kenBurns: 'zoom-in',
    fromScale: 1.02,
    toScale: 1.16,
    transition: 'zoom-punch',
  },
}

const VALID_SHOT_KINDS = Object.keys(PROMO_SHOT_RECIPES)
const VALID_SHOWCASE_LAYOUTS = new Set([
  'card-fan-opener',
  'app-focus-shot',
  'workflow-steps',
  'split-wipe-compare',
  'metric-dashboard',
  'multi-window-trio',
  '3d-stage-opener',
  'media-split-motion',
  'mosaic-pulse-wall',
  'compare-dual',
  'kinetic-impact',
  'radial-climax',
  'narrative-diorama',
  'svg-architecture-flow',
  'hud-telemetry-dashboard',
  'vibecoding-spring-stage',
  'freeform-stage',
])

const VALID_STAGE_ARCHETYPES = [
  'hero-numeral',
  'hero-stand',
  'oath-break',
  'cavalry-rush',
  'slash-climax',
  'duel-confront',
  'farewell-tent',
  'strategic-map',
  'scroll-calligraphy',
  'bamboo-slips',
  'plaque-summary',
  'channel-end',
]

function inferHistoryBannerChar(text = '') {
  const s = String(text || '')
  if (/霍去病|卫青|汉武|大汉|冠军侯|骠骑|河西|祁连|漠北|封狼居胥|匈奴/.test(s)) return '汉'
  if (/秦始皇|嬴政|大秦|咸阳|函谷|六国|长城|兵马俑|郡县/.test(s)) return '秦'
  if (/项羽|霸王|江东|乌江|垓下|巨鹿|鸿门|楚军|西楚/.test(s)) return '楚'
  if (/蜀汉|诸葛|刘备|关羽|张飞|赵云/.test(s)) return '蜀'
  if (/曹操|曹魏|官渡|许昌/.test(s)) return '魏'
  if (/孙权|东吴|赤壁/.test(s)) return '吴'
  if (/李世民|大唐|盛唐|安史/.test(s)) return '唐'
  if (/岳飞|大宋|汴京/.test(s)) return '宋'
  if (/朱元璋|大明|郑和/.test(s)) return '明'
  return '军'
}

function synthesizeHistoricalStageSpec(rawShot, idx, total, topicContext = '') {
  const existing = rawShot?.stageSpec && typeof rawShot.stageSpec === 'object' ? { ...rawShot.stageSpec } : {}
  const hay = `${rawShot?.title || ''} ${rawShot?.narration || ''} ${rawShot?.visualBlueprint || ''} ${topicContext}`
  const bannerChar = existing.bannerChar || inferHistoryBannerChar(hay)
  const moodCycle = ['dawn-amber', 'crimson-war', 'indigo-night', 'bronze-hall', 'ash-twilight', 'crimson-war', 'void-gold']
  const settingCycle = ['mountain-camp', 'vast-plain', 'city-siege', 'palace-stairs', 'river-gorge']
  const actionCycle = ['hero-stand', 'cavalry-rush', 'slash-climax', 'strategic-map', 'duel-confront', 'bamboo-slips', 'hero-numeral', 'cavalry-rush', 'slash-climax', 'plaque-summary']

  let archetype = existing.archetype
  if (!archetype || !VALID_STAGE_ARCHETYPES.includes(archetype)) {
    if (idx === 0) archetype = 'hero-stand'
    else if (idx === total - 1) archetype = 'channel-end'
    else if (/封狼居胥|地图|版图|河西|走廊|六国|统一|疆域|进军|路线|北击|千里|行军/.test(hay)) archetype = 'strategic-map'
    else if (/竹简|诏书|法令|功绩|册封|史记|典籍|铭刻|千古|传世|统一文字|车同轨/.test(hay)) archetype = idx % 2 === 0 ? 'bamboo-slips' : 'plaque-summary'
    else if (/冲锋|铁骑|轻骑|骠骑|奔袭|奇袭|长驱|八百|战马|千军/.test(hay)) archetype = 'cavalry-rush'
    else if (/斩|破|屠|击溃|血战|斩首|厮杀|大捷|暴击|横扫|夺/.test(hay)) archetype = 'slash-climax'
    else if (/对峙|决战|单挑|围攻|迎战|交锋/.test(hay)) archetype = 'duel-confront'
    else if (/病逝|陨落|悲|惜|离别|英年|告别|二十四岁|24岁/.test(hay)) archetype = 'farewell-tent'
    else if (/破釜沉舟|誓师|出征/.test(hay)) archetype = 'oath-break'
    else if (/\b\d{2,4}\s*(?:年|岁|里|骑|万)\b/.test(hay)) archetype = 'hero-numeral'
    else archetype = actionCycle[idx % actionCycle.length]
  }

  let mood = existing.mood
  if (!mood) {
    if (/slash|cavalry|duel|oath/.test(archetype)) mood = 'crimson-war'
    else if (/farewell|channel-end/.test(archetype)) mood = 'ash-twilight'
    else if (/bamboo|plaque|scroll/.test(archetype)) mood = 'bronze-hall'
    else if (idx === 0) mood = 'dawn-amber'
    else mood = moodCycle[idx % moodCycle.length]
  }

  let setting = existing.setting
  if (!setting) {
    if (/咸阳|大殿|朝堂|长安|宫|帝|封侯/.test(hay)) setting = 'palace-stairs'
    else if (/城|关|要塞|壁垒|攻城/.test(hay)) setting = 'city-siege'
    else if (/河|江|渡|水|瀚海/.test(hay)) setting = 'river-gorge'
    else setting = settingCycle[idx % settingCycle.length]
  }

  const numMatch = hay.match(/(?:前\s*)?(\d{2,4})\s*(年|岁|里|骑|万)/)
  return {
    ...existing,
    mood,
    setting,
    archetype,
    bannerChar,
    headwear: existing.headwear || (bannerChar === '秦' || /帝|始皇|汉武/.test(hay) ? 'emperor' : 'plume'),
    weapon: existing.weapon || (bannerChar === '汉' ? 'spear' : archetype === 'slash-climax' ? 'sword' : 'halberd'),
    ...(archetype === 'hero-numeral' && !existing.heroNum && numMatch
      ? { heroNum: numMatch[1], heroUnit: numMatch[2] }
      : {}),
    ...(archetype === 'channel-end' && !existing.headline
      ? { headline: String(rawShot?.title || '').slice(0, 14) || '千古英雄', subheadline: String(rawShot?.narration || '').slice(0, 26) }
      : {}),
  }
}

export const VALID_THREE_PRESETS = [
  'orbital-core',
  'cyber-terrain',
  'particle-vortex',
  'floating-monoliths',
  'chrono-helix',
  'matrix-cubes',
]

export const VALID_TRANSITIONS = [
  'cut',
  'flash-cut',
  'slash-wipe',
  'iris-circle',
  'block-wipe',
  'glitch-cut',
  'zoom-punch',
  'light-wipe',
]

const TRANSITION_ALIASES = {
  'wipe-right': 'light-wipe',
  'wipe-left': 'slash-wipe',
  wipe: 'slash-wipe',
  slide: 'light-wipe',
  fade: 'flash-cut',
  dissolve: 'flash-cut',
  pull_out: 'zoom-punch',
  push_in: 'zoom-punch',
  pan_across: 'slash-wipe',
  pan_down: 'light-wipe',
  face_focus: 'iris-circle',
  impact: 'flash-cut',
  hold: 'cut',
  freeze_end: 'cut',
}

export function normalizeTransitionKind(raw, idx = 0, isBeatNarrative = false) {
  if (idx === 0) return 'cut'
  const key = String(raw || '').trim().toLowerCase()
  if (VALID_TRANSITIONS.includes(key)) return key
  if (TRANSITION_ALIASES[key]) return TRANSITION_ALIASES[key]
  const pool = isBeatNarrative
    ? ['flash-cut', 'slash-wipe', 'zoom-punch', 'glitch-cut', 'iris-circle', 'light-wipe']
    : ['iris-circle', 'light-wipe', 'block-wipe', 'slash-wipe', 'zoom-punch']
  return pool[idx % pool.length]
}

function isRelativeAssetPath(p) {
  if (!p) return true
  const s = String(p).trim()
  if (!s) return true
  if (/^[A-Za-z]:[\\/]/.test(s) || /^https?:\/\//i.test(s) || s.startsWith('/')) return false
  return true
}

/**
 * Strictly validate a `promo-plan/1` JSON structure against hard safety invariants:
 * - max 8 non-cut transitions (up to 64 in rhythmic MV mode)
 * - min 1.5s per shot (0.26s half-beat flash cut in beat-synced narrative MV)
 * - zoom bounded within [0.95, 1.25]
 * - strictly relative asset references
 */
export const VALID_PACING_MODES = ['auto', 'calm', 'balanced', 'dynamic']

export const PACING_PROFILES = {
  calm: {
    id: 'calm',
    label: '舒缓叙事（故事/品牌/教学）',
    minDurSec: 3.8,
    maxDurSec: 12.0,
    shotsPerMin: 9,
    minShots: 6,
    maxShots: 28,
    allowHalfBeatBlitz: false,
    ruleHint: '每镜保持 4.5~10 秒从容留白与自然呼吸，让观众充分理解故事情绪与画面细节，切忌急促闪切。',
  },
  balanced: {
    id: 'balanced',
    label: '稳健解说（产品功能/教程/评测）',
    minDurSec: 2.8,
    maxDurSec: 12.0,
    shotsPerMin: 12,
    minShots: 10,
    maxShots: 36,
    allowHalfBeatBlitz: false,
    ruleHint: '以产品功能与操作逻辑清晰传达为先：开场与高潮结尾可轻快收束（2.5~3.5s），每个功能模块讲解与界面实拍保持 4.0~12.0s 舒适节奏，口播完整易懂、不赶语速。',
  },
  dynamic: {
    id: 'dynamic',
    label: '高燃快节奏（历史史诗/卡点 MV/快闪预告）',
    minDurSec: 0.26,
    maxDurSec: 5.5,
    shotsPerMin: 24,
    minShots: 18,
    maxShots: 48,
    allowHalfBeatBlitz: true,
    ruleHint: '高密度快节奏拆镜：常规叙事设 1.3~3.0s（2~4 拍），高潮冲击/鼓点突降(drops)/转折闪切可设 0.5 拍(0.33s) 或 1 拍(0.67s)，紧密踩准音乐节拍。',
  },
}

/**
 * Resolve concrete pacing profile from explicit `pacingMode` or intelligent topic/style classification.
 */
export function resolvePacingProfile({ topic = '', style = 'tech', narrationMode = '', hasAssets = false, pacingMode = 'auto' } = {}) {
  const req = String(pacingMode || 'auto').trim().toLowerCase()
  if (req === 'calm' || req === 'balanced' || req === 'dynamic') {
    return PACING_PROFILES[req]
  }
  const text = `${topic || ''} ${style || ''}`.trim()
  if (narrationMode === 'subtitle-mv' || /历史|霸王|史诗|演义|战役|征战|卡点|快闪|混剪|高燃|电音|\bMV\b/i.test(text)) {
    return PACING_PROFILES.dynamic
  }
  if (style === 'documentary' || style === 'warm' || /故事|品牌|温情|人物|访谈|文化|纪实|心路|成长|随笔|传记/i.test(text)) {
    return PACING_PROFILES.calm
  }
  if (hasAssets || /功能|教程|操作|演示|步骤|介绍|说明书|评测|指南|客户端|软件|工作台|开源/i.test(text)) {
    return PACING_PROFILES.balanced
  }
  return PACING_PROFILES.balanced
}

export function validatePromoPlan(plan) {
  const errors = []
  if (!plan || typeof plan !== 'object') {
    return { ok: false, errors: ['plan 对象无效'] }
  }
  const shots = Array.isArray(plan.shots) ? plan.shots : []
  if (shots.length === 0) {
    errors.push('shots 数组不能为空')
  }

  const isBeatNarrative =
    plan.mode === 'narrative-mv' ||
    Boolean(plan.beatSync) ||
    plan.narrationMode === 'tts-beat-sync' ||
    plan.narrationMode === 'subtitle-mv'
  const minDur = isBeatNarrative ? 0.26 : 1.5
  const maxTransitions = Math.max(64, shots.length + 4)

  let nonCutTransitions = 0
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i] || {}
    const dur = Number(s.durationSec)
    if (!Number.isFinite(dur) || dur < minDur) {
      errors.push(`shot[${i}] durationSec=${s.durationSec} 低于最小安全驻留时长 ${minDur}s`)
    }
    const maxScale = Math.max(Number(s.fromScale || 1), Number(s.toScale || 1))
    const minScale = Math.min(Number(s.fromScale || 1), Number(s.toScale || 1))
    if (maxScale > 1.25 || minScale < 0.95) {
      errors.push(`shot[${i}] 缩放倍率 [${minScale}, ${maxScale}] 超出安全范围 [0.95, 1.25]`)
    }
    if (s.recipe && !VALID_SHOT_KINDS.includes(s.recipe)) {
      errors.push(`shot[${i}] 未知镜头原语 recipe=${s.recipe}`)
    }
    const tr = String(s.transition || 'cut')
    if (i > 0 && tr !== 'cut') nonCutTransitions++
    for (const ref of Array.isArray(s.assetRefs) ? s.assetRefs : []) {
      if (!isRelativeAssetPath(ref)) {
        errors.push(`shot[${i}] 包含非相对素材路径 "${ref}"`)
      }
    }
  }
  if (nonCutTransitions > maxTransitions) {
    errors.push(`转场次数 (${nonCutTransitions}) 超过最大上限 ${maxTransitions} 次`)
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Deterministic rule sanitizer clamping bounds and enriching missing fields into clean `promo-plan/1`.
 */
export function repairPromoPlanRules(
  rawPlan = {},
  { topic = '', style = 'tech', genre = '', genreLabel = '', authoringMode = '', directorNotes = '', contentOutline = [], assetsManifest = null, existingScript = null, bgmMeta = null, narrationMode = '', pacingMode = '' } = {},
) {
  const existingScenes = Array.isArray(existingScript?.scenes) ? existingScript.scenes : []
  const mediaItems = (assetsManifest?.items || []).filter(
    (it) => it.role !== 'music' && it.role !== 'sfx' && it.role !== 'note' && it.role !== 'avatar_base' && it.role !== 'voice_clone' && it.type !== 'audio',
  )
  const cleanTopic = normalizeNumeralsForDisplay(stripMetaInstructions(topic || rawPlan?.title || existingScript?.title || '')) || '主题短片'
  const isFreeformCoding =
    String(authoringMode || rawPlan?.authoringMode || existingScript?.authoringMode || 'ai-coded').trim().toLowerCase() !== 'schema-plan'
  const genreInfo = resolveGenreSelection({
    genre: rawPlan?.genre || genre || existingScript?.genre || '',
    genreLabel: rawPlan?.genreLabel || genreLabel || existingScript?.genreLabel || '',
    text: {
      topic: cleanTopic,
      goal: directorNotes || existingScript?.goal || '',
      style: style || rawPlan?.style || existingScript?.style || 'tech',
      hasMedia: mediaItems.length > 0,
    },
    hasScreenshots: mediaItems.length > 0,
  })
  const resolvedGenre = genreInfo.id
  const resolvedGenreLabel = genreInfo.label
  const explicitPacing = String(pacingMode || rawPlan?.pacingMode || existingScript?.pacingMode || '').trim().toLowerCase()
  const resolvedPacing = resolvePacingProfile({
    topic: cleanTopic,
    style: style || rawPlan?.style || 'tech',
    narrationMode: narrationMode || existingScript?.narrationMode || '',
    hasAssets: mediaItems.length > 0,
    pacingMode: explicitPacing || (rawPlan?.mode === 'narrative-mv' ? 'dynamic' : 'auto'),
  })
  const isBeatMode =
    rawPlan?.mode === 'narrative-mv' ||
    Boolean(rawPlan?.beatSync || existingScript?.beatSync) ||
    Boolean(bgmMeta?.analyzed) ||
    narrationMode === 'subtitle-mv' ||
    narrationMode === 'tts-beat-sync' ||
    existingScript?.narrationMode === 'subtitle-mv' ||
    existingScript?.narrationMode === 'tts-beat-sync'
  const explicitSlowPacing = (explicitPacing === 'calm' || explicitPacing === 'balanced') && !isBeatMode
  const isNarrativeMv = (!explicitSlowPacing && mediaItems.length === 0 && resolvedPacing.id === 'dynamic') || isBeatMode || resolvedPacing.id === 'dynamic'
  const minDurClamp = isNarrativeMv ? 0.26 : resolvedPacing.id === 'calm' ? 2.4 : 1.5
  const defaultShotDur = resolvedPacing.id === 'calm' ? 5.2 : resolvedPacing.id === 'balanced' ? 4.2 : 2.6
  const maxTransitionsLimit = Math.max(64, (rawPlan?.shots?.length || existingScenes.length || 24) + 4)
  const candidateShots =
    Array.isArray(rawPlan?.shots) && rawPlan.shots.length > 0
      ? rawPlan.shots
      : Array.isArray(rawPlan?.scenes) && rawPlan.scenes.length > 0
        ? rawPlan.scenes
        : Array.isArray(rawPlan?.storyboard) && rawPlan.storyboard.length > 0
          ? rawPlan.storyboard
          : null

  const rawShots = candidateShots
    ? candidateShots
    : existingScenes.length > 0
      ? existingScenes.map((sc, i) => ({
          id: sc.id,
          title: sc.title,
          narration: sc.narration,
          durationSec: sc.durationSec,
          threePreset: sc.threePreset || sc?.stageSpec?.threePreset,
          stageSpec: sc.stageSpec,
          beatCount: sc.beatCount,
          accentWords: sc.accentWords,
          emotion: sc.voiceEmotion || sc.emotion,
          speechRate: sc.speechRate,
          cursors: sc.cursors,
          cams: sc.cams,
          marks: sc.marks,
          windowTheme: sc.windowTheme,
          windowTitle: sc.windowTitle,
          visualBlueprint: sc.visualBlueprint,
          recipe: i === 0 ? 'pull_out' : i === existingScenes.length - 1 ? 'freeze_end' : VALID_SHOT_KINDS[(i % 5) + 1],
        }))
      : [
          { title: cleanTopic, narration: `${cleanTopic}，核心内容即刻展开。`, recipe: 'pull_out', threePreset: 'orbital-core', durationSec: defaultShotDur + 0.4 },
          { title: '核心脉络与结构拆解', narration: `深入解析${cleanTopic}的关键逻辑与层次结构。`, recipe: 'arch_flow', threePreset: 'cyber-terrain', durationSec: defaultShotDur + 0.2 },
          { title: '关键细节与数据验证', narration: '聚焦核心节点与实证数据，关键指标清晰呈现。', recipe: 'hud_telemetry', threePreset: 'particle-vortex', durationSec: defaultShotDur },
          { title: '动态演进与协同运转', narration: '各个模块环环相扣，驱动整体系统高效运转。', recipe: 'spring_stage', threePreset: 'floating-monoliths', durationSec: defaultShotDur + 0.2 },
          { title: '高能亮点聚焦', narration: '把握核心突破点，全面释放作品表现力。', recipe: 'impact', threePreset: 'chrono-helix', durationSec: defaultShotDur },
          { title: '总结与行动指引', narration: `${cleanTopic}全流程解读至此完成。`, recipe: 'freeze_end', threePreset: 'matrix-cubes', durationSec: defaultShotDur },
        ]

  const cleanStyle = normalizeVideoStyle(rawPlan?.style || style || 'tech')
  const isHistoricalTopic =
    resolvedGenre === 'history-theater' ||
    isHistoricalContent(
      `${cleanTopic} ${rawPlan?.title || ''} ${existingScript?.title || ''} ${existingScript?.goal || ''}`,
    )
  const vibecodingZeroAssetLayouts = [
    '3d-stage-opener',
    'svg-architecture-flow',
    'hud-telemetry-dashboard',
    'vibecoding-spring-stage',
    'metric-dashboard',
    'workflow-steps',
    'kinetic-impact',
    'radial-climax',
  ]

  let transitionCount = 0
  const repairedShots = rawShots.map((s, idx) => {
    const recipeKey = VALID_SHOT_KINDS.includes(s?.recipe)
      ? s.recipe
      : idx === 0
        ? 'pull_out'
        : idx === rawShots.length - 1
          ? 'freeze_end'
          : VALID_SHOT_KINDS[(idx % 6) + 1]
    const spec = PROMO_SHOT_RECIPES[recipeKey]

    const durRaw = Number(s?.durationSec || existingScenes[idx]?.durationSec || defaultShotDur)
    const durationSec = Math.max(minDurClamp, Math.min(60, Number.isFinite(durRaw) ? durRaw : defaultShotDur))
    const fromScale = Math.max(0.95, Math.min(1.25, Number(s?.fromScale || spec.fromScale)))
    const toScale = Math.max(0.95, Math.min(1.25, Number(s?.toScale || spec.toScale)))

    let transition = normalizeTransitionKind(s?.transition || spec.transition || 'iris-circle', idx, isNarrativeMv)
    if (idx === 0) {
      transition = 'cut'
    } else if (transition === 'cut' && (isNarrativeMv || isHistoricalTopic)) {
      const punchPool = ['flash-cut', 'slash-wipe', 'zoom-punch', 'glitch-cut', 'iris-circle']
      transition = punchPool[idx % punchPool.length]
      if (transitionCount < maxTransitionsLimit) transitionCount++
    } else if (transition !== 'cut') {
      if (transitionCount >= maxTransitionsLimit) transition = 'cut'
      else transitionCount++
    }

    const rawRefs = Array.isArray(s?.assetRefs)
      ? s.assetRefs.filter(isRelativeAssetPath)
      : existingScenes[idx]?.media?.length > 0
        ? existingScenes[idx].media.map((m) => m.path).filter(Boolean)
        : mediaItems.length > 0
          ? [mediaItems[idx % mediaItems.length].path]
          : []

    const rawLayout = String(s?.layout || '').trim()
    const chosenLayout =
      rawLayout === 'freeform-stage'
        ? 'freeform-stage'
        : VALID_SHOWCASE_LAYOUTS.has(rawLayout) && (rawLayout !== 'narrative-diorama' || isHistoricalTopic)
          ? rawLayout
          : isFreeformCoding && mediaItems.length === 0 && !isHistoricalTopic
            ? 'freeform-stage'
            : mediaItems.length === 0
              ? isHistoricalTopic
                ? 'narrative-diorama'
                : idx === 0
                  ? '3d-stage-opener'
                  : idx === rawShots.length - 1
                    ? 'radial-climax'
                    : vibecodingZeroAssetLayouts[idx % vibecodingZeroAssetLayouts.length]
              : VALID_SHOWCASE_LAYOUTS.has(existingScenes[idx]?.layout)
                ? existingScenes[idx].layout
                : spec.layout

    const cleanShotTitle =
      normalizeNumeralsForDisplay(
        stripMetaInstructions(sanitizeSpokenNarration(s?.title || existingScenes[idx]?.title || `镜头 ${idx + 1}`)),
      ).slice(0, 32) || `镜头 ${idx + 1}`

    const candidateNarr = stripMetaInstructions(
      sanitizeSpokenNarration(s?.narration || existingScenes[idx]?.narration || cleanShotTitle || ''),
    )
    const nextNarration =
      normalizeNumeralsForDisplay(candidateNarr) ||
      normalizeNumeralsForDisplay(cleanShotTitle) ||
      `第 ${idx + 1} 幕`

    const rawSubChunks = Array.isArray(s?.subChunks) && s.subChunks.length > 0
      ? s.subChunks
          .map((c) => cleanSubtitleChunk(normalizeNumeralsForDisplay(stripMetaInstructions(sanitizeSpokenNarration(c)))))
          .filter(Boolean)
      : []

    const oldNarration = normalizeNumeralsForDisplay(
      stripMetaInstructions(sanitizeSpokenNarration(existingScenes[idx]?.narration || '')),
    )
    const narrChanged = Boolean(nextNarration && oldNarration && nextNarration !== oldNarration)
    const cleanSubChunks =
      rawSubChunks.length > 0
        ? rawSubChunks
        : narrChanged || !existingScenes[idx]?.subChunks
          ? deriveVerbalSubtitleParts(nextNarration, null, '', 16)
          : existingScenes[idx]?.subChunks.map((c) => cleanSubtitleChunk(normalizeNumeralsForDisplay(stripMetaInstructions(c)))).filter(Boolean)

    const reqThree = String(s?.threePreset || s?.stageSpec?.threePreset || existingScenes[idx]?.threePreset || '').trim()
    const chosenThreePreset = VALID_THREE_PRESETS.includes(reqThree)
      ? reqThree
      : VALID_THREE_PRESETS[idx % VALID_THREE_PRESETS.length]

    const defaultEmotion = isHistoricalTopic
      ? idx === 0
        ? '激昂有力'
        : idx === rawShots.length - 1
          ? '深沉史诗'
          : '肃穆震撼'
      : resolvedGenre === 'ui-tutorial'
        ? idx === 0
          ? '欢快热情'
          : idx === rawShots.length - 1
            ? '激昂有力'
            : idx % 3 === 1
              ? '温和亲切'
              : '自信明快'
        : idx === 0
          ? '欢快热情'
          : idx === rawShots.length - 1
            ? '激昂有力'
            : '自信明快'
    const chosenEmotion = String(
      s?.voiceEmotion || s?.emotion || existingScenes[idx]?.voiceEmotion || existingScenes[idx]?.emotion || defaultEmotion,
    ).trim()
    const defaultRate = resolvedGenre === 'ui-tutorial' ? (idx === 0 || idx === rawShots.length - 1 ? 1.08 : 1.05) : isHistoricalTopic ? 0.98 : 1.04

    const primaryRef = rawRefs[0] || ''
    const primaryAsset = primaryRef
      ? (assetsManifest?.items || []).find((it) => it.path === primaryRef || it.editedPath === primaryRef)
      : null
    const isPrimaryVideo =
      /\.(mp4|mov|webm|mkv)$/i.test(primaryRef) || primaryAsset?.type === 'video'
    const clickLabel = normalizeNumeralsForDisplay(stripMetaInstructions(String(s?.clickLabel || '').trim())).slice(0, 18)
    const anchors = Array.isArray(primaryAsset?.uiAnchors) ? primaryAsset.uiAnchors : []
    const findMatchingAnchor = (query) => {
      const q = String(query || '').trim().toLowerCase()
      if (!q || anchors.length === 0) return null
      return (
        anchors.find((a) => String(a.label || '').toLowerCase() === q) ||
        anchors.find((a) => String(a.label || '').toLowerCase().includes(q) || q.includes(String(a.label || '').toLowerCase())) ||
        null
      )
    }
    const matchedAnchor = findMatchingAnchor(clickLabel) || findMatchingAnchor(s?.focusAnchor) || findMatchingAnchor(cleanShotTitle)
    const rawHasFocusPt = Number.isFinite(Number(s?.focusFx)) && Number.isFinite(Number(s?.focusFy))
    const hasExactAnchorOrFocus = Boolean(matchedAnchor || rawHasFocusPt)
    const fFx = matchedAnchor
      ? Number(matchedAnchor.fx)
      : rawHasFocusPt
        ? Math.max(0.015, Math.min(0.985, Number(s.focusFx)))
        : 0.5
    const fFy = matchedAnchor
      ? Number(matchedAnchor.fy)
      : rawHasFocusPt
        ? Math.max(0.015, Math.min(0.985, Number(s.focusFy)))
        : 0.5
    const synthCams =
      Array.isArray(s?.cams) && s.cams.length > 0
        ? s.cams
        : existingScenes[idx]?.cams?.length > 0
          ? existingScenes[idx].cams
          : resolvedGenre === 'ui-tutorial' && rawRefs.length > 0 && hasExactAnchorOrFocus
            ? [
                { t: 0, fx: 0.5, fy: 0.5, z: 1.0 },
                { t: 0.35, fx: fFx, fy: fFy, z: isPrimaryVideo ? 1.45 : 1.95 },
                { t: 0.88, fx: fFx, fy: fFy, z: isPrimaryVideo ? 1.52 : 2.05 },
              ]
            : undefined
    const synthCursors =
      Array.isArray(s?.cursors) && s.cursors.length > 0
        ? s.cursors
        : existingScenes[idx]?.cursors?.length > 0
          ? existingScenes[idx].cursors
          : resolvedGenre === 'ui-tutorial' && !isPrimaryVideo && rawRefs.length > 0 && hasExactAnchorOrFocus && (clickLabel || matchedAnchor)
            ? [
                { t: 0.1, fx: Math.min(0.88, Math.max(0.12, fFx + (fFx > 0.5 ? -0.18 : 0.18))), fy: Math.min(0.88, Math.max(0.12, fFy + (fFy > 0.5 ? -0.16 : 0.16))) },
                { t: 0.44, fx: fFx, fy: fFy, click: true, label: clickLabel || matchedAnchor?.label || '' },
              ]
            : undefined

    const computedStageSpec =
      isHistoricalTopic && rawRefs.length === 0
        ? {
            ...synthesizeHistoricalStageSpec(
              { ...s, title: cleanShotTitle, narration: nextNarration, stageSpec: s?.stageSpec || existingScenes[idx]?.stageSpec },
              idx,
              rawShots.length,
              `${cleanTopic} ${directorNotes || ''}`,
            ),
            threePreset: s?.stageSpec?.threePreset || chosenThreePreset,
          }
        : s?.stageSpec
          ? { ...s.stageSpec, threePreset: s.stageSpec.threePreset || chosenThreePreset }
          : existingScenes[idx]?.stageSpec

    return {
      id: s?.id || existingScenes[idx]?.id || `scene-${String(idx + 1).padStart(2, '0')}`,
      title: cleanShotTitle,
      narration: nextNarration,
      subChunks: cleanSubChunks,
      accentWords: Array.isArray(s?.accentWords) && s.accentWords.length > 0 ? s.accentWords : existingScenes[idx]?.accentWords,
      threePreset: chosenThreePreset,
      stageSpec: computedStageSpec,
      beatCount: Number.isFinite(Number(s?.beatCount)) ? Number(s.beatCount) : existingScenes[idx]?.beatCount,
      // Keep the director's explicit audio-visual action label (the keyword guesser is only a fallback)
      actionMode: ['clash-flurry', 'single-clash', 'cavalry', 'drop-impact', 'clean'].includes(String(s?.actionMode || '').trim().toLowerCase()) ? String(s.actionMode).trim().toLowerCase() : existingScenes[idx]?.actionMode,
      impactBeats: Array.isArray(s?.impactBeats) ? s.impactBeats.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0 && n <= 16).slice(0, 12) : existingScenes[idx]?.impactBeats,
      visualBlueprint: String(s?.visualBlueprint || existingScenes[idx]?.visualBlueprint || '').trim() || undefined,
      // Director's per-shot tool plan (0-3): must-use tools for the coder, audited after coding
      vibeTools: Array.isArray(s?.vibeTools) ? s.vibeTools.map((t) => String(t).trim().toLowerCase()).map((t) => (t === 'character-rig' ? 'figure-kit' : t)).filter((t) => ['threejs', 'animejs', 'tweenjs', 'ammojs', 'tsl-textures', 'figure-kit'].includes(t)).slice(0, 3) : existingScenes[idx]?.vibeTools,
      // who is on screen (cast ids), air particles and the environmental sound bed of this shot
      castIds: Array.isArray(s?.cast) ? s.cast.map((c) => String(c ?? '').trim()).filter(Boolean).slice(0, 8) : Array.isArray(s?.castIds) ? s.castIds : existingScenes[idx]?.castIds,
      atmosphere: normalizeAtmosphere(s?.atmosphere) || existingScenes[idx]?.atmosphere,
      ambience: normalizeAmbience(s?.ambience) || existingScenes[idx]?.ambience,
      motionNotes: String(s?.motionNotes || s?.visualBlueprint || existingScenes[idx]?.motionNotes || '').trim() || undefined,
      emotion: chosenEmotion,
      voiceEmotion: chosenEmotion,
      role: String(s?.role || existingScenes[idx]?.role || 'narrator'),
      speechRate: Number(
        Math.max(
          0.78,
          Math.min(
            1.28,
            Number(
              s?.speechRate ||
                s?.speed ||
                existingScenes[idx]?.speechRate ||
                defaultRate,
            ) || defaultRate,
          ),
        ).toFixed(2),
      ),
      recipe: recipeKey,
      layout: chosenLayout,
      kenBurns: spec.kenBurns,
      fromScale: Number(fromScale.toFixed(2)),
      toScale: Number(toScale.toFixed(2)),
      transition,
      highlights: Array.isArray(s?.highlights) && s.highlights.length > 0
        ? s.highlights.map((h) => normalizeNumeralsForDisplay(stripMetaInstructions(String(h || '')))).filter(Boolean).slice(0, 6)
        : existingScenes[idx]?.highlights || [],
      cams: synthCams,
      marks: Array.isArray(s?.marks) && s.marks.length > 0 ? s.marks : existingScenes[idx]?.marks,
      cursors: synthCursors,
      loupe: s?.loupe || existingScenes[idx]?.loupe,
      windowLayout: s?.windowLayout || existingScenes[idx]?.windowLayout,
      windowTheme: s?.windowTheme || existingScenes[idx]?.windowTheme || (resolvedGenre === 'ui-tutorial' && rawRefs.length > 0 ? 'light' : undefined),
      windowTitle: s?.windowTitle || existingScenes[idx]?.windowTitle,
      durationSec: Number(durationSec.toFixed(3)),
      assetRefs: rawRefs,
    }
  })

  const rawTitle = normalizeNumeralsForDisplay(stripMetaInstructions(rawPlan?.title || existingScript?.title || cleanTopic)) || cleanTopic
  const audioProfile = rawPlan?.audioProfile && typeof rawPlan.audioProfile === 'object' ? rawPlan.audioProfile : (existingScript?.audioProfile || undefined)

  const planCast = normalizeCast(Array.isArray(rawPlan?.cast) ? rawPlan.cast : existingScript?.cast)
  const planFigureStyle = normalizeFigureStyle(rawPlan?.figureStyle) || normalizeFigureStyle(existingScript?.figureStyle)
  const planFigureNote = normalizeFigureStyleNote(rawPlan?.figureStyleNote ?? existingScript?.figureStyleNote)
  return {
    version: PROMO_PLAN_VERSION,
    ...(audioProfile ? { audioProfile } : {}),
    ...(planCast.length ? { cast: planCast } : {}),
    ...(planFigureStyle ? { figureStyle: planFigureStyle } : {}),
    ...(planFigureStyle === 'custom' && planFigureNote ? { figureStyleNote: planFigureNote } : {}),
    mode: isNarrativeMv ? 'narrative-mv' : 'promo-ui',
    genre: resolvedGenre,
    genreLabel: resolvedGenreLabel,
    pacingMode: resolvedPacing.id,
    beatSync: Boolean(bgmMeta?.analyzed || isNarrativeMv),
    title: rawTitle,
    style: cleanStyle,
    targetPlatform: rawPlan?.targetPlatform || existingScript?.targetPlatform || 'universal',
    bpm: Math.max(70, Math.min(165, Number(bgmMeta?.bpm || rawPlan?.bpm || 112))),
    shots: repairedShots,
  }
}

/**
 * Compile `promo-plan/1` into deterministic `plan.resolved.json` schedule + `scriptData` patches.
 */
export function resolvePlanSchedule(plan, baseScript = {}) {
  const fps = Number(baseScript?.fps) || 30
  const width = Number(baseScript?.width) || 1920
  const height = Number(baseScript?.height) || 1080
  const safeZone = resolveSafeZoneSpec(width, height, plan?.targetPlatform || baseScript?.targetPlatform || 'universal')

  const minResolveDur = plan?.mode === 'narrative-mv' || plan?.beatSync ? 0.26 : 1.5
  let cursorFrame = 0
  let cursorSec = 0
  const resolvedShots = (plan?.shots || []).map((shot, idx) => {
    const durSec = Math.max(minResolveDur, Number(shot.durationSec || 4))
    const durFrames = Math.max(Math.ceil(minResolveDur * fps), Math.round(durSec * fps))
    const startFrame = cursorFrame
    const startSec = Number(cursorSec.toFixed(3))
    cursorFrame += durFrames
    cursorSec += durFrames / fps

    const baseScene = baseScript?.scenes?.[idx] || {}
    return {
      ...baseScene,
      id: shot.id || `scene-${String(idx + 1).padStart(2, '0')}`,
      index: idx + 1,
      title: shot.title,
      narration: shot.narration || baseScene.narration || shot.title,
      subChunks: Array.isArray(shot.subChunks) ? shot.subChunks : baseScene.subChunks,
      accentWords: Array.isArray(shot.accentWords) ? shot.accentWords : baseScene.accentWords,
      threePreset: shot.threePreset || shot?.stageSpec?.threePreset || baseScene.threePreset || VALID_THREE_PRESETS[idx % VALID_THREE_PRESETS.length],
      stageSpec: shot.stageSpec || baseScene.stageSpec,
      beatCount: Number.isFinite(Number(shot.beatCount)) ? Number(shot.beatCount) : baseScene.beatCount,
      actionMode: shot.actionMode || baseScene.actionMode,
      impactBeats: Array.isArray(shot.impactBeats) ? shot.impactBeats : baseScene.impactBeats,
      vibeTools: Array.isArray(shot.vibeTools) ? shot.vibeTools : baseScene.vibeTools,
      castIds: Array.isArray(shot.castIds) ? shot.castIds : baseScene.castIds,
      atmosphere: shot.atmosphere || baseScene.atmosphere,
      ambience: shot.ambience || baseScene.ambience,
      visualBlueprint: shot.visualBlueprint || baseScene.visualBlueprint,
      motionNotes: shot.motionNotes || shot.visualBlueprint || baseScene.motionNotes,
      emotion: shot.voiceEmotion || shot.emotion || baseScene.emotion || '自信明快',
      voiceEmotion: shot.voiceEmotion || shot.emotion || baseScene.voiceEmotion || baseScene.emotion || '自信明快',
      role: shot.role || baseScene.role || 'narrator',
      speechRate: Number(shot.speechRate || baseScene.speechRate || 1.04),
      layout: shot.layout || 'freeform-stage',
      kenBurns: shot.kenBurns || 'zoom-in',
      transition: normalizeTransitionKind(shot.transition || 'iris-circle', idx, plan?.mode === 'narrative-mv' || Boolean(plan?.beatSync)),
      highlights: shot.highlights?.length ? shot.highlights : baseScene.highlights || [PROMO_SHOT_RECIPES[shot.recipe]?.label || shot.recipe],
      recipe: shot.recipe,
      fromScale: shot.fromScale,
      toScale: shot.toScale,
      cams: Array.isArray(shot.cams) && shot.cams.length > 0 ? shot.cams : baseScene.cams,
      marks: Array.isArray(shot.marks) && shot.marks.length > 0 ? shot.marks : baseScene.marks,
      cursors: Array.isArray(shot.cursors) && shot.cursors.length > 0 ? shot.cursors : baseScene.cursors,
      loupe: shot.loupe || baseScene.loupe,
      windowLayout: shot.windowLayout || baseScene.windowLayout,
      windowTheme: shot.windowTheme || baseScene.windowTheme,
      windowTitle: shot.windowTitle || baseScene.windowTitle,
      explicitZeroAsset: Array.isArray(shot.assetRefs) && shot.assetRefs.length === 0,
      media:
        Array.isArray(shot.assetRefs)
          ? shot.assetRefs.map((p) => {
              const existingM = (baseScene.media || []).find((m) => m.path === p || m.originalPath === p)
              const dims = shot._mediaDimMap?.get?.(p) || {}
              return {
                ...existingM,
                path: p,
                width: Number(existingM?.width || dims.width || 0),
                height: Number(existingM?.height || dims.height || 0),
                type: /\.(mp4|mov|webm|mkv)$/i.test(p) ? 'video' : 'image',
                motion: shot.kenBurns || 'zoom-in',
              }
            })
          : baseScene.media || [],
      durationSec: Number((durFrames / fps).toFixed(4)),
      durationInFrames: durFrames,
      startFrame,
      startSec,
    }
  })

  const totalSec = Number(cursorSec.toFixed(4))
  const totalFrames = cursorFrame
  const beatStep = 60 / (Number(plan?.bpm) || 112)
  const beats = []
  for (let bt = 0, bi = 0; bt < totalSec; bt += beatStep, bi++) {
    beats.push({ time: Number(bt.toFixed(3)), strong: bi % 4 === 0 })
  }

  return {
    version: PROMO_PLAN_VERSION,
    genre: plan?.genre || baseScript?.genre || '',
    genreLabel: plan?.genreLabel || baseScript?.genreLabel || '',
    fps,
    width,
    height,
    totalDurationSec: totalSec,
    totalDurationInFrames: totalFrames,
    safeZone,
    resolvedShots,
    beats,
  }
}

function safeExtractJson(text) {
  const s = String(text || '').trim()
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced ? fenced[1].trim() : s
  try {
    return JSON.parse(raw)
  } catch {
    const a = raw.indexOf('{')
    const b = raw.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(raw.slice(a, b + 1))
      } catch {
        // Recover partial truncated shots/scenes array cleanly if relay clipped tail
        const slice = raw.slice(a)
        const shotsIdx = slice.indexOf('"shots"') >= 0 ? slice.indexOf('"shots"') : slice.indexOf('"scenes"')
        if (shotsIdx >= 0) {
          const lastObjEnd = slice.lastIndexOf('}')
          if (lastObjEnd > shotsIdx) {
            for (let cut = lastObjEnd; cut > shotsIdx; cut = slice.lastIndexOf('}', cut - 1)) {
              try {
                return JSON.parse(slice.slice(0, cut + 1) + ']}')
              } catch {}
            }
          }
        }
      }
    }
    return null
  }
}

/**
 * 4-Tier Degradation Director for `schema-plan` mode:
 * - Tier 1: Full `promo-plan/1` JSON from LLM
 * - Tier 2: Sectioned lightweight shot-recipe list from weaker LLM
 * - Tier 3: Minimal A/B/C MCQ choice token from minimal LLM
 * - Tier 4: Zero-LLM Deterministic Code Rules (guaranteed 100% pass)
 */
export async function runSchemaDirectorWithDegradation({
  projectDir,
  topic = '',
  style = 'tech',
  genre = '',
  genreLabel = '',
  authoringMode = 'ai-coded',
  directorNotes = '',
  contentOutline = [],
  targetPlatform = 'universal',
  scriptData = {},
  assetsManifest = null,
  bgmMeta = null,
  narrationMode = '',
  pacingMode = '',
  durationMode = '',
  targetDurationSec = 0,
  referenceStyle = null,
  callLlmChatFn = null,
  forceTierForTest = null,
  signal = null,
  // one extra Tier-1 attempt after a transient failure (rate limit / gateway busy); tests pass 0
  transientRetryDelayMs = 45_000,
  onLlmWait = null,
}) {
  const effectiveRefStyle = referenceStyle || scriptData?.referenceStyle || null
  const trace = []
  let chosenPlan = null
  let degradationTier = 4
  // set when the model is still unavailable after the extra Tier-1 attempt: Tier 2 / 3 would hit the same limit
  let llmOutage = null
  const sleepAbortable = (ms) =>
    new Promise((resolveSleep, rejectSleep) => {
      const abortErr = () => signal?.reason || Object.assign(new Error('Request aborted'), { name: 'AbortError' })
      if (signal?.aborted) return rejectSleep(abortErr())
      const onAbort = () => {
        clearTimeout(t)
        rejectSleep(abortErr())
      }
      const t = setTimeout(() => {
        signal?.removeEventListener?.('abort', onAbort)
        resolveSleep()
      }, Math.max(0, ms))
      signal?.addEventListener?.('abort', onAbort, { once: true })
    })
  const tier1Llm =
    typeof callLlmChatFn === 'function'
      ? async (args) => {
          try {
            return await callLlmChatFn(args)
          } catch (err) {
            if (!isTransientLlmFailure(err) || !(Number(transientRetryDelayMs) >= 0)) throw err
            try {
              onLlmWait?.({ waitMs: Number(transientRetryDelayMs), error: err })
            } catch {}
            await sleepAbortable(Number(transientRetryDelayMs))
            try {
              return await callLlmChatFn(args)
            } catch (err2) {
              if (isTransientLlmFailure(err2)) llmOutage = err2
              throw err2
            }
          }
        }
      : null
  // 视觉风格: an auto project (「AI 自由匹配」) lets the Tier-1 plan pick one of the 6 presets or design a new style
  // (styleProfile) inside the same plan JSON; preset / 「我的预设」 projects keep the user's style.
  const styleScript = { ...(scriptData && typeof scriptData === 'object' ? scriptData : {}), style: scriptData?.style || style }
  // + the 人物画风 the user picked in the studio (none → the plan chooses figureStyle itself, rule 3.21)
  const styleDirective = buildStylePlanDirective(styleScript) + buildFigureStylePlanDirective(styleScript)
  let styleAnswer = null
  const mediaCheck = (assetsManifest?.items || []).filter(
    (it) => it.role !== 'music' && it.role !== 'sfx' && it.role !== 'note' && it.role !== 'brand_mark' && it.role !== 'avatar_base' && it.role !== 'voice_clone' && it.type !== 'audio',
  )
  const cleanTopic = normalizeNumeralsForDisplay(stripMetaInstructions(topic || scriptData?.title || '')) || '主题短片'
  const effectiveDirectorNotes = String(directorNotes || scriptData?.directorNotes || '').trim()
  const effectiveAuthoringMode = String(authoringMode || scriptData?.authoringMode || 'ai-coded').trim() || 'ai-coded'
  const isFreeformCoding = effectiveAuthoringMode.toLowerCase() !== 'schema-plan'
  const genreInfo = resolveGenreSelection({
    genre: genre || scriptData?.genre || '',
    genreLabel: genreLabel || scriptData?.genreLabel || '',
    text: {
      topic: cleanTopic,
      goal: `${effectiveDirectorNotes} ${scriptData?.goal || ''}`,
      style,
      hasMedia: mediaCheck.length > 0,
    },
    hasScreenshots: mediaCheck.length > 0,
  })
  const resolvedGenre = genreInfo.id
  const resolvedGenreLabel = genreInfo.label
  const genreGuidance = buildGenreGuidance(resolvedGenre, resolvedGenreLabel)
  const effectivePacingMode = pacingMode || scriptData?.pacingMode || 'auto'
  const pacingProfile = resolvePacingProfile({
    topic: cleanTopic,
    style,
    narrationMode: narrationMode || scriptData?.narrationMode || '',
    hasAssets: mediaCheck.length > 0,
    pacingMode: effectivePacingMode,
  })

  // Tier 1: Full JSON Schema generation
  if (!forceTierForTest || forceTierForTest === 1) {
    if (typeof callLlmChatFn === 'function') {
      try {
        const mediaDimMap = new Map()
        for (const it of assetsManifest?.items || []) {
          if (it.path) mediaDimMap.set(it.path, { width: Number(it.width || 0), height: Number(it.height || 0) })
          if (it.editedPath) mediaDimMap.set(it.editedPath, { width: Number(it.editedWidth || it.width || 0), height: Number(it.editedHeight || it.height || 0) })
        }
        const visualItemsCatalog = (assetsManifest?.items || [])
          .filter((it) => it.role !== 'music' && it.role !== 'sfx' && it.role !== 'note' && it.role !== 'brand_mark' && it.role !== 'avatar_base' && it.role !== 'voice_clone' && it.type !== 'audio')
          .map((it) => ({
            path: it.path,
            type: it.type,
            name: it.originalName || it.name,
            width: Number(it.editedWidth || it.width || 0),
            height: Number(it.editedHeight || it.height || 0),
            ...(Number(it.durationSec) > 0 ? { durationSec: it.durationSec } : {}),
            ...(it.visualSummary ? { visualSummary: it.visualSummary } : {}),
            ...(Array.isArray(it.uiAnchors) && it.uiAnchors.length > 0 ? { uiAnchors: it.uiAnchors.slice(0, 16) } : {}),
          }))
        const mediaNames = visualItemsCatalog.map((it) => it.path)
        const zeroVisualAssets = mediaNames.length === 0
        const noteSummaries = (assetsManifest?.notes || [])
          .filter((n) => n?.text)
          .map((n) => String(n.text).slice(0, 1400))
          .join('\n')
        const effectiveBgm = bgmMeta?.analyzed ? bgmMeta : scriptData?.bgm?.analyzed ? scriptData.bgm : null
        const prompt = {
          task: `生成 ${PROMO_PLAN_VERSION} 分镜配方 JSON`,
          topic: cleanTopic,
          genre: resolvedGenre,
          genreLabel: resolvedGenreLabel,
          authoringMode: effectiveAuthoringMode,
          contentOutline: Array.isArray(contentOutline) && contentOutline.length > 0 ? contentOutline : undefined,
          directorNotesOnlyInternalDoNotReadAloud: effectiveDirectorNotes || undefined,
          productBrief: noteSummaries || undefined,
          targetPlatform,
          zeroVisualAssets,
          narrationMode: narrationMode || scriptData?.narrationMode || 'tts',
          bgmBeatAnalysis: effectiveBgm
            ? {
                bpm: effectiveBgm.bpm,
                phaseSec: effectiveBgm.phaseSec,
                beatSec: effectiveBgm.beatSec || Number((60 / (effectiveBgm.bpm || 112)).toFixed(4)),
                durationSec: effectiveBgm.durationSec,
                downbeatsSample: (effectiveBgm.downbeats || []).slice(0, 24),
                drops: effectiveBgm.drops || [],
              }
            : undefined,
          allowedRecipes: VALID_SHOT_KINDS,
          ...(isFreeformCoding
            ? { freeformLayoutPreferred: 'freeform-stage', optionalFallbackLayouts: Array.from(VALID_SHOWCASE_LAYOUTS) }
            : { allowedLayouts: Array.from(VALID_SHOWCASE_LAYOUTS) }),
          ...(zeroVisualAssets && resolvedGenre === 'history-theater' ? { allowedStageArchetypes: VALID_STAGE_ARCHETYPES, allowedStageMoods: ['dawn-amber', 'crimson-war', 'indigo-night', 'ash-twilight', 'bronze-hall', 'jade-river', 'void-gold'], allowedStageSettings: ['palace-stairs', 'mountain-camp', 'city-siege', 'river-gorge', 'vast-plain'] } : {}),
          relativeAssets: mediaNames,
          assetsCatalog: visualItemsCatalog.length > 0 ? visualItemsCatalog : undefined,
          scenesHint: scriptData?.authoringMode === 'local-draft'
            ? undefined
            : (scriptData?.scenes || []).map((s) => ({
                id: s.id,
                title: s.title,
                layout: s.layout,
                narration: s.narration,
                highlights: s.highlights,
              })),
        }
        const rawGoalText = `${cleanTopic} ${effectiveDirectorNotes} ${scriptData?.goal || ''} ${noteSummaries || ''}`
        const effectiveNarrationModeT1 = narrationMode || scriptData?.narrationMode || 'tts'
        const isPureMusicMvT1 = effectiveNarrationModeT1 === 'subtitle-mv'
        const durationPolicy = resolveTargetDurationPolicy({
          durationMode: durationMode || scriptData?.durationMode || 'auto',
          targetDurationSec: Number(targetDurationSec) || Number(scriptData?.targetDurationSec) || 0,
          // the user's wording only: a plaza template's style recipe describes its source film
          text: stripPlazaTemplateGuidance(rawGoalText),
          pacingProfile,
          narrationMode: effectiveNarrationModeT1,
          hasVisualAssets: mediaNames.length > 0,
          bgmDurationSec: Number(effectiveBgm?.durationSec) || 0,
          referenceShotCount: Number(effectiveRefStyle?.pacingSignature?.targetShotCount || effectiveRefStyle?.shotCount || 0),
          referenceDurationSec: Number(effectiveRefStyle?.durationSec || 0),
        })
        const isComprehensiveUnlimited = durationPolicy.unlimited || noteSummaries.length >= 420 || mediaNames.length >= 6
        const desiredZeroShotsMin = durationPolicy.enforced || isPureMusicMvT1 || pacingProfile.id === 'dynamic'
          ? durationPolicy.targetShotsMin
          : isComprehensiveUnlimited
            ? Math.max(12, Math.min(durationPolicy.hardMaxShots - 6, durationPolicy.targetShotsMin))
            : durationPolicy.targetShotsMin
        const desiredZeroShotsMax = durationPolicy.targetShotsMax
        const desiredUiShotsMin = durationPolicy.enforced
          ? Math.max(durationPolicy.targetShotsMin, Math.min(22, mediaNames.length))
          : isComprehensiveUnlimited
            ? Math.max(14, Math.min(22, mediaNames.length * 2))
            : durationPolicy.targetShotsMin
        const desiredUiShotsMax = Math.max(desiredUiShotsMin + 4, durationPolicy.targetShotsMax)
        if (durationPolicy.enforced || isPureMusicMvT1) {
          prompt.targetDuration = {
            mode: durationPolicy.mode,
            targetSec: durationPolicy.targetSec,
            minSec: durationPolicy.minSec,
            maxSec: durationPolicy.maxSec,
            recommendedShots: `${desiredZeroShotsMin}~${desiredZeroShotsMax}`,
            ...(durationPolicy.requiredCharsMin > 0 ? { recommendedNarrationChars: `${durationPolicy.requiredCharsMin}~${durationPolicy.requiredCharsMax}` } : {}),
          }
        }
        if (effectiveRefStyle?.replicationPrompt) {
          prompt.referenceVideoBlueprint = {
            sourceName: effectiveRefStyle.sourceName || effectiveRefStyle.title || 'reference',
            shotCount: effectiveRefStyle.shotCount || effectiveRefStyle.pacingSignature?.targetShotCount,
            bpm: effectiveRefStyle.bpm || undefined,
            narrationMode: effectiveRefStyle.narrationMode || undefined,
            visualStyle: effectiveRefStyle.visualStyle || undefined,
            colorPalette: effectiveRefStyle.colorPalette || undefined,
            vfxSignature: effectiveRefStyle.vfxSignature || undefined,
            transitionSignature: effectiveRefStyle.transitionSignature || undefined,
            shotFormula: effectiveRefStyle.shotFormula || undefined,
          }
        }
        const isHistoricalPrompt =
          resolvedGenre === 'history-theater' ||
          isHistoricalContent(rawGoalText)
        const unlimitedDurationHint = `\n- ${durationPolicy.promptDirective}`
        const refReplicationRules = effectiveRefStyle?.replicationPrompt
          ? `\n【红线铁律 · 参考视频复刻基因】：用户上传了参考视频并要求复刻同款风格与节奏！必须严格继承以下风格蓝图（替换为用户新主题内容）：\n${String(effectiveRefStyle.replicationPrompt).slice(0, 1200)}`
          : ''
        const pureMvRules = isPureMusicMvT1
          ? `\n【红线铁律 · 纯音乐高燃卡点 MV (免 TTS 旁白)】：
- 本片无朗读配音，完全靠 **强节拍切镜 + 高燃字幕金句 + 爆炸动画人物/动作特效 + 同步打击/刀光音效** 驱动！
- 每幕 \`narration\` 写 **6~16 字铿锵短金句**（将直接作为醒目电影衬线大字幕展示，标出 \`accentWords\` 高亮关键词），切勿写长段拖沓纪录片说明文！
- 全片必须拆足 **${desiredZeroShotsMin}~${desiredZeroShotsMax} 个高密度镜头**（常规镜 \`beatCount: 2\` 或 \`4\`，高潮突降点 \`drops\` 连续穿插 \`beatCount: 0.5\` / \`1\` 闪电快切），每镜 \`transition\` 在 \`flash-cut|slash-wipe|zoom-punch|glitch-cut|iris-circle\` 中丰富轮换（仅首镜用 \`cut\`）！
- 每镜务必写满 \`stageSpec\`（\`archetype\` 在 \`hero-stand|cavalry-rush|slash-climax|duel-confront|strategic-map|bamboo-slips|hero-numeral|plaque-summary|farewell-tent|channel-end\` 之间大幅变换，绝不连着 3 镜重复同一构图！）。`
          : ''
        const strictContentRules = `
【红线铁律 1 · 零指令词污染】：\`directorNotesOnlyInternalDoNotReadAloud\`、风格需求与润色指令仅供你规划视觉和写作 \`visualBlueprint\`，**严禁将任何“本视频要求…/分镜指令…/画面风格…/节奏设定…/受众定位…/制作规格…”写进 \`title\`、\`narration\`、\`subChunks\` 或 \`highlights\`**！输出给观众看听的必须是 100% 纯正片正文！
【红线铁律 2 · 字幕自然阿拉伯数字与去标点断句】：\`narration\` 与 \`subChunks\` 中的年份、数量、规格全部保持**自然阿拉伯数字**（如 \`206年\`、\`3000人\`、\`119年\`、\`8 GB\`），严禁写成“二零六年”“三千人”；**\`subChunks\` 中严禁出现任何双引号 \`“”""\`、单引号、书名号 \`《》\` 及首尾逗号/句号**，确保每条短句词意完整、标点不孤立出现在行首或行尾！
【红线铁律 3 · 全题材开放路由与无预设自由创作】：当前创作定位为 **${resolvedGenreLabel} (\`${resolvedGenre}\`)**。${genreGuidance}${pureMvRules}${refReplicationRules}`
        const uiInteractiveRules =
          resolvedGenre === 'ui-tutorial' || (!zeroVisualAssets && /工作台|教程|客户端|软件|UI|界面|实操/.test(rawGoalText))
            ? `\n【红线铁律 4 · 高清亮色交互式软件教程镜头规范（零错位 · 零 PPT 感！）】：
- 凡展示真实软件界面画面，**一律置 \`"windowTheme": "light"\`（严禁暗色黑底缩略图或左右分栏 PPT 幻灯片）**；
- **严格依据 \`assetsCatalog\` 中的真实内容与 \`uiAnchors\` 坐标编写分镜**：
  1. 若某素材 \`type === "video"\`（真实动态录屏），直接引用该视频播放真实交互流程，可按 \`uiAnchors\` 给柔和焦点缩放，**严禁在已有真实鼠标动作的录屏上再凭空乱填假 \`clickLabel\`**；
  2. 若某素材为静态截图且带有 \`uiAnchors\`，填写 \`focusFx\`、\`focusFy\`、\`clickLabel\` 时**必须直接照抄 \`uiAnchors\` 里的真实坐标（包括顶栏 \`fy≈0.03\` 等位置）**，严禁靠猜编造坐标！
  3. 严禁虚构与画面实际显示的文字不符的假案例（如画面显示工作台真实工程名却硬编无关示例）。`
            : ''
        const pacingLabelHint = `当前选用节奏方案【${pacingProfile.label}】：${pacingProfile.ruleHint}${unlimitedDurationHint}\n${strictContentRules}${uiInteractiveRules}`
        const zeroLayoutExample = isFreeformCoding
          ? isHistoricalPrompt
            ? 'narrative-diorama|freeform-stage'
            : 'freeform-stage'
          : isHistoricalPrompt
            ? 'narrative-diorama'
            : '3d-stage-opener|svg-architecture-flow|hud-telemetry-dashboard|vibecoding-spring-stage|metric-dashboard|workflow-steps|kinetic-impact|radial-climax'
        const systemPrompt = zeroVisualAssets
          ? `你是顶级音画动态导演 (AI Visual & Motion Director)，擅长 Remotion + 原生 Three.js 3D + 动态 SVG / Canvas 全题材无限制自由编程创作。
当前没有任何图片/视频素材 (zeroVisualAssets=true)，全部画面将由下游 AI 主程根据你为每一幕撰写的 \`visualBlueprint\`，使用 \`<FreeformThreeStage>\` + 动态 \`<svg>\` / \`<canvas>\` **100% 从零自由编写专属代码**（${isFreeformCoding ? '直接填写 `"layout": "freeform-stage"`，严禁千篇一律套用宣传片黑卡片！' : '`layout` 为内置安全预设'}）！
${pacingLabelHint}
输出严格紧凑 JSON：{ "version": "promo-plan/1", "genre": "${resolvedGenre}", "genreLabel": "${resolvedGenreLabel}", "mode": "${pacingProfile.id === 'dynamic' ? 'narrative-mv' : 'promo-ui'}", "beatSync": ${pacingProfile.id === 'dynamic' || narrationMode === 'subtitle-mv' || narrationMode === 'tts-beat-sync'}, "title": "纯粹正片作品标题", "style": "cinematic|tech|emerald|energetic|documentary", "bpm": ${effectiveBgm?.bpm || (pacingProfile.id === 'calm' ? 88 : 110)}, "audioProfile": { "profileName": "贴合本题材的专属声场名", "beatCutIntensity": "high|medium|gentle", "cameraBeatIntensity": ${isHistoricalPrompt ? '1.0' : '0.0'}, "targetLufs": ${isHistoricalPrompt && narrationMode === 'subtitle-mv' ? '-10.5' : '-14.5'}, "bgmDuckRatio": ${narrationMode === 'subtitle-mv' ? '1.35' : '2.6'}, "sfxPalette": ${isHistoricalPrompt ? '{ "opener": ["war_drum"], "drop": ["heavy_impact","war_drum"], "action": ["metal_clash","metal_clash_hi","blade_whoosh"], "data": ["war_drum"], "neutral": [], "internal": ["metal_clash","metal_clash_hi"], "preCut": [] }' : '{ "opener": ["hit","shimmer_swell"], "drop": ["sub_drop","shine"], "action": ["whoosh","slash"], "data": ["counter","tick"], "neutral": ["whoosh","pop_soft"], "internal": ["sparkle","tick"], "preCut": ["riser","swoosh"] }'} }, "figureStyle": "auto|${FIG_STYLES.join('|')}|custom", "figureStyleNote": "选 custom 时写清楚人物画风", "cast": [{ "id": "hero", "name": "角色名", "role": "主角|配角|群像", "aliases": ["你"], "look": "一句话外形", "figure": { "gender": "male|female", "build": "${FIG_BUILDS.join('|')}", "outfit": "${FIG_OUTFITS.join('|')}", "hair": "${FIG_HAIR.join('|')}", "headwear": "${FIG_HEADWEAR.join('|')}", "beard": "none|short|long", "cape": false, "props": { "right": "${FIG_PROPS.join('|')}" }, "colors": { "top": "#hex", "bottom": "#hex", "accent": "#hex", "cape": "#hex" } } }], "shots": [{ "id": "scene-01", "title": "...", "narration": "纯粹正片台词(保持自然阿拉伯数字)", "emotion": "欢快热情|激昂有力|温和亲切|重点强调|悬念低沉|深沉史诗", "speechRate": 1.04, "role": "narrator|host", "accentWords": ["核心关键词"], "actionMode": "${isHistoricalPrompt ? 'clash-flurry|single-clash|cavalry|drop-impact|clean' : 'clean'}", ${isHistoricalPrompt ? '"impactBeats": [0, 0.5, 1, 1.5, 2, 2.5, 3.5], ' : ''}"layout": "${zeroLayoutExample}", "threePreset": "orbital-core|cyber-terrain|particle-vortex|floating-monoliths|chrono-helix|matrix-cubes", "vibeTools": [], "cast": ["hero"], "atmosphere": "none", "ambience": "none", "beatCount": ${pacingProfile.id === 'dynamic' ? 2 : 4}, "durationSec": ${pacingProfile.id === 'calm' ? 5.0 : pacingProfile.id === 'balanced' ? 4.5 : 2.0}, "transition": "${pacingProfile.id === 'calm' ? 'light-wipe' : 'slash-wipe'}", "visualBlueprint": "具体描述本镜专属视觉构图（紧扣 ${resolvedGenreLabel} 自由发明贴合内容的画面与镜头语言，不受任何固定版式上限约束）与镜头物理节奏", "highlights": ["要点1","要点2"]${isHistoricalPrompt ? ', "stageSpec": { "mood": "dawn-amber|crimson-war|indigo-night|ash-twilight|bronze-hall|jade-river|void-gold", "setting": "palace-stairs|mountain-camp|city-siege|river-gorge|vast-plain", "archetype": "hero-numeral|hero-stand|oath-break|cavalry-rush|slash-climax|duel-confront|farewell-tent|strategic-map|bamboo-slips|scroll-calligraphy|plaque-summary|channel-end", "headwear": "plume|helmet|emperor|crown", "weapon": "spear|sword|halberd|raised-arm", "heroNum": "119", "heroUnit": "年", "bannerChar": "汉", "plaques": ["要点1","要点2"], "headline": "结尾主标题", "subheadline": "副标题" }' : ''} }] }。
核心硬性要求：
1. **贴合题材的拆镜与节奏（严格音画合一，绝不乱加音效！）**：拆分为 **${desiredZeroShotsMin}~${desiredZeroShotsMax} 个镜头**，${pacingProfile.ruleHint}（单镜口播长度与时长严格匹配；每幕设置富有感染力的 \`emotion\` 与合理 \`speechRate\` \`0.92~1.14\`）；为每幕精准标注 \`actionMode\`：**只有真正刀剑/长矛短兵相接激战的镜头才标 \`clash-flurry\`（触发半拍连续急促刀剑金属碰撞），单次拔剑/迎击标 \`single-clash\`，真实骑兵冲锋标 \`cavalry\`，重拍高潮标 \`drop-impact\`，其余朝堂/人物肖像/地图/竹简/封禅/尾声一律标 \`clean\`（纯 BGM 呼吸，严禁乱加打斗音或叮咚铃！）**。${isHistoricalPrompt ? '**兵刃接触必须画出来并给出拍位**：凡标 \`clash-flurry\` / \`single-clash\` 的镜头，\`visualBlueprint\` 必须写清每一次可见的兵器相交（谁的矛/剑撞上谁的兵器、火星在哪里），并用 \`impactBeats\` 给出接触发生的拍位（从本镜切入点起算，0 = 切入点，可用 0.5 半拍、0.25 四分之一拍）：\`clash-flurry\` 每半拍一次可见格挡/劈砍，2~4 拍的镜头安排 5~8 次（如 [0,0.5,1,1.5,2,2.5,3.5]，最后一击最重），接触前写出蓄力挥砍；\`single-clash\` 只给 1 个拍位；只有冲锋、对峙、行军而没有兵刃相交的镜头不要标 clash（标 \`cavalry\` 或 \`clean\`）。**每一场真正的大战（首战、主战役、决战高潮）都要安排一组连续 2~3 个镜头的短兵交锋（\`clash-flurry\` 与半拍闪切 \`single-clash\` 交替，beatCount 用 0.5~4），像参考片一样急促激烈、刀刀踩在节拍上**；不该有打斗声的镜头在 \`visualBlueprint\` 里写明“无兵刃接触/不加打斗声”。' : ''}
2. **零预设束缚，每镜写出独一无二的 \`visualBlueprint\`（下游 TSX 代码生成员直读！）**：严格遵循 ${resolvedGenreLabel} 的专属视觉审美自由造景（不要生搬硬套不相关的科技/电商卡片）。
3. **按画面为每镜规划 Vibecoding 工具**：\`vibeTools\` 从 threejs（三维空间/纵深/粒子）、animejs（文字、书法、印章、图表的交错编排）、tweenjs（弹性缓动与镜头推拉曲线）、ammojs（真实物理坠落/碰撞/散落）、tsl-textures（水面、云层、玉石青铜等程序化材质）中选出本镜真正需要的 0~3 个——下游主程会被要求在该镜代码里真正实现并逐镜核对，所以只写画面确实需要的；人物/马匹镜头系统会自动建议剪影人物库，不必写进 vibeTools。
3.2 **演员表 cast（任何题材通用）**：作品里出现的主要人物（≤6 个，古装将领、现代上班族、童话角色、讲解员都算；马匹由画面自动处理，猫狗等其他动物不进演员表）写进顶层 \`cast\`，外观 \`figure\` 字段只能从给出的选项里选、颜色用 #hex，同一角色全片外观一致；每镜 \`cast\` 列出该镜出镜的角色 id；没有人物的作品给 \`"cast": []\`。
3.21 **人物画风 \`figureStyle\`（全片统一；按每部作品自己的气质选，不要所有作品都用同一种）**：用户需求里点名了画风就照用户的——是剪影 silhouette / 剪纸 papercut / 皮影 puppet / 水墨 ink / 扁平侧身 flat / 火柴人 stick 之一就填对应 id（这些有现成人物库），是其它画风（Q版萌系、日系动漫、美式卡通、绘本手绘、年画、像素风、低多边形、黏土、写实插画等）就填 custom 并在 \`figureStyleNote\` 写清楚（如：Q版大头萌系，圆脸大眼），主程会自己设计角色；用户没提时按作品气质选：历史史诗、战争常用 silhouette，民俗节日可用 papercut，戏曲传说可用 puppet，古诗词山水可用 ink，其它题材（现代生活、产品、科普、童话、职场、MV 等）想要鲜明的角色设计就填 custom 并写清楚，拿不准就填 auto（交给主程按画面决定）。
3.3 **氛围与环境声**：每镜 \`atmosphere\`（none|dust|embers|snow|rain|petals|leaves|bokeh|motes|fireflies|mist）按画面里真实存在的空气/天气选择（篝火战火→embers，风沙→dust，雪→snow，霓虹夜景→bokeh，科技数据→motes，雾→mist，没有就 none）；\`ambience\`（none|wind|river|rain|fire|crowd|night|city|office|forest|sea|space|battle）按画面里应当听到的环境声选择（江边/渡船→river，战场→battle，宴会/集市/咖啡馆/餐厅→crowd，街道车流→city，办公室/教室→office，森林→forest，海边→sea，夜晚虫鸣→night，旷野风沙→wind，篝火壁炉→fire；界面演示、数据图表、纯文字镜头给 none）。
3.1 **绝对禁止输出任何网址 URL、参考来源标注或制作指令词**：所有旁白纯正自然，禁用双引号，阿拉伯数字原样保留（系统会自动按语义切分字幕）。
4. \`transition\` 仅允许 \`${isHistoricalPrompt ? 'cut | flash-cut | slash-wipe | zoom-punch' : VALID_TRANSITIONS.join(' | ')}\` 中的合法值（首镜用 \`cut\`${isHistoricalPrompt ? '，历史史诗题材严禁使用 glitch-cut 故障条或 iris-circle 卡通圆圈转场！' : ''}）。`
          : `你是顶级全题材动态导演兼交互式软件教程视觉总监，擅长依据具体题材灵活编排真实现场画面与自由写码分镜。
${pacingLabelHint}
输出严格紧凑 JSON（不要输出冗余 cams/subChunks 大数组，聚焦高质量剧情、精确图片路径与清晰简短 visualBlueprint）：
{ "version": "promo-plan/1", "genre": "${resolvedGenre}", "genreLabel": "${resolvedGenreLabel}", "beatSync": ${narrationMode === 'subtitle-mv' || narrationMode === 'tts-beat-sync' || pacingProfile.id === 'dynamic'}, "title": "纯粹正片作品标题", "style": "tech|energetic|emerald|cinematic|documentary", "bpm": ${effectiveBgm?.bpm || (pacingProfile.id === 'calm' ? 92 : 114)}, "shots": [{ "id": "scene-01", "title": "...", "narration": "纯粹正片台词(保持自然阿拉伯数字,不含双引号)", "emotion": "欢快热情|激昂有力|温和亲切|重点强调|悬念低沉", "speechRate": 1.07, "accentWords": ["亮点"], "windowTheme": "${resolvedGenre === 'ui-tutorial' ? 'light' : 'auto'}", "layout": "${isFreeformCoding ? 'freeform-stage|app-focus-shot' : 'app-focus-shot|svg-architecture-flow|hud-telemetry-dashboard|vibecoding-spring-stage|workflow-steps|split-wipe-compare|metric-dashboard|multi-window-trio'}", "windowTitle": "模块名称", "highlights": ["标签1","标签2"], "focusFx": 0.25, "focusFy": 0.28, "clickLabel": "点击动作", "visualBlueprint": "30~60字精炼描述画面构图、推镜放大重点与交互过渡", "durationSec": ${pacingProfile.id === 'calm' ? 5.5 : pacingProfile.id === 'balanced' ? 4.8 : 2.5}, "transition": "${pacingProfile.id === 'calm' ? 'light-wipe' : 'slash-wipe'}", "assetRefs": ["assets/xxx.png"] }] }。
核心硬性要求：
1. **依应用场景适配节奏与富有感情的配音演播**：拆分为 **${desiredUiShotsMin}~${desiredUiShotsMax} 个镜头**，${pacingProfile.ruleHint} 每幕标注生动 \`emotion\` 与节奏感 \`speechRate\`（\`1.05~1.12\`）。
2. **精确对应文件名与内容，拒绝错配！**：每张截图引用 exact \`relativeAssets\` 路径并只解说该文件名真实对应的界面（例如 \`01b-drawer-open-light\` 讲工程抽屉，\`01c-new-project-modal\` 讲新建工程弹窗，\`02a/02b\` 讲硬件/低配保护）；开篇/原理/转折/结尾或自由视觉场景可置 \`assetRefs: []\` 并用 \`layout: "freeform-stage"\` 交由 AI 自由编码。
3. **严禁网址参考来源注释与元指令词，禁用双引号且保留阿拉伯数字**。\`transition\` 仅允许 ${VALID_TRANSITIONS.join('/')}。`
        const res = await tier1Llm({
          system: systemPrompt + styleDirective,
          messages: [{ role: 'user', content: JSON.stringify(prompt) }],
          temperature: zeroVisualAssets ? 0.4 : 0.28,
          maxTokens: desiredZeroShotsMin >= 30 || durationPolicy.targetSec >= 110 ? 15000 : isComprehensiveUnlimited || zeroVisualAssets ? 10000 : 7500,
          timeoutMs: 420_000,
          responseFormat: 'json',
        })
        const candidate = safeExtractJson(res?.text)
        const candShots = candidate?.shots || candidate?.scenes || candidate?.storyboard
        const hasExplicitCandidateShots = Array.isArray(candShots) && candShots.length >= 2
        let repaired = hasExplicitCandidateShots
          ? repairPromoPlanRules(candidate, { topic: cleanTopic, style, genre: resolvedGenre, genreLabel: resolvedGenreLabel, authoringMode: effectiveAuthoringMode, directorNotes: effectiveDirectorNotes, contentOutline, assetsManifest, existingScript: scriptData, bgmMeta: effectiveBgm, narrationMode, pacingMode: effectivePacingMode })
          : null

        // Anti-shrink duration & anti-sparse shot-count guard:
        // If duration falls short OR pure-music/dynamic beat-sync returned too few shots (e.g. 20 instead of 36+),
        // automatically ask LLM to append continuation/climax shots so final video hits target density & duration!
        const needsDensityBoost =
          zeroVisualAssets &&
          (isPureMusicMvT1 || pacingProfile.id === 'dynamic') &&
          repaired &&
          repaired.shots.length < Math.round(desiredZeroShotsMin * 0.85)
        if (repaired && validatePromoPlan(repaired).ok && ((durationPolicy.enforced && durationPolicy.minSec >= 45) || needsDensityBoost)) {
          const estSec = estimatePlanDurationSec(repaired.shots, { narrationMode: effectiveNarrationModeT1 })
          const shortByDur = durationPolicy.enforced && estSec < durationPolicy.minSec * 0.84
          if (shortByDur || needsDensityBoost) {
            const missingSec = Math.max(20, Math.round(durationPolicy.targetSec - estSec))
            const missingShots = Math.max(0, desiredZeroShotsMin - repaired.shots.length)
            const extraShotsMin = Math.max(
              4,
              missingShots,
              Math.round(missingSec / Math.max(2.2, pacingProfile.id === 'dynamic' || isPureMusicMvT1 ? 2.6 : 5.2)),
            )
            const extraCharsMin = effectiveNarrationModeT1 === 'subtitle-mv' ? 0 : Math.round(missingSec * 3.85)
            try {
              const expandRes = await callLlmChatFn({
                system: `${systemPrompt}\n\n【紧急补镜加密任务】：上一轮仅输出 ${repaired.shots.length} 镜（预估约 ${Math.round(estSec)} 秒），低于要求的 **${desiredZeroShotsMin}~${desiredZeroShotsMax} 镜 / ${durationPolicy.label}**！请紧接已有分镜继续深化战役高潮、人物动作特写、地图推进、竹简功绩与收束镜头，**仅输出需要追加补充的新分镜数组**（JSON: { "appendShots": [...] }），至少补充 **${extraShotsMin} 个高质量新分镜**${extraCharsMin > 0 ? `（新增总旁白至少 ${extraCharsMin} 字，每镜深入展开细节、案例、转折或高潮收束，严禁重复已有台词）` : `（每镜 1~4 拍紧贴 BGM 重拍与高潮突降点，带完整 stageSpec 与不同 archetype）`}！`,
                messages: [
                  {
                    role: 'user',
                    content: JSON.stringify({
                      topic: cleanTopic,
                      targetDurationSec: durationPolicy.targetSec,
                      targetShotsMin: desiredZeroShotsMin,
                      currentShotCount: repaired.shots.length,
                      currentEstimatedSec: estSec,
                      missingSec,
                      existingTitles: repaired.shots.map((s) => `${s.id}: ${s.title}`),
                      lastShot: repaired.shots[repaired.shots.length - 1],
                      relativeAssets: mediaNames,
                    }),
                  },
                ],
                temperature: 0.42,
                maxTokens: 11000,
                timeoutMs: 300_000,
                responseFormat: 'json',
              })
              const expJson = safeExtractJson(expandRes?.text)
              const extraRaw = expJson?.appendShots || expJson?.shots || expJson?.scenes || []
              if (Array.isArray(extraRaw) && extraRaw.length >= 2) {
                const startIdx = repaired.shots.length
                const normalizedExtra = extraRaw.map((s, k) => ({
                  ...s,
                  id: `scene-${String(startIdx + k + 1).padStart(2, '0')}`,
                }))
                const mergedCandidate = {
                  ...candidate,
                  shots: [...repaired.shots, ...normalizedExtra],
                }
                const mergedRepaired = repairPromoPlanRules(mergedCandidate, {
                  topic: cleanTopic,
                  style,
                  genre: resolvedGenre,
                  genreLabel: resolvedGenreLabel,
                  authoringMode: effectiveAuthoringMode,
                  directorNotes: effectiveDirectorNotes,
                  contentOutline,
                  assetsManifest,
                  existingScript: scriptData,
                  bgmMeta: effectiveBgm,
                  narrationMode,
                  pacingMode: effectivePacingMode,
                })
                if (mergedRepaired && validatePromoPlan(mergedRepaired).ok) {
                  repaired = mergedRepaired
                  trace.push({ tier: '1-expand', name: 'Duration Anti-Shrink Expansion', ok: true, fromSec: estSec, toSec: estimatePlanDurationSec(mergedRepaired.shots, { narrationMode: effectiveNarrationModeT1 }) })
                }
              }
            } catch (expErr) {
              trace.push({ tier: '1-expand', name: 'Duration Anti-Shrink Expansion', ok: false, reason: expErr?.message || String(expErr) })
            }
          }
        }
        if (repaired && validatePromoPlan(repaired).ok) {
          for (const sh of repaired.shots) {
            sh._mediaDimMap = mediaDimMap
          }
          chosenPlan = repaired
          degradationTier = 1
          styleAnswer = { style: candidate?.style, profile: candidate?.styleProfile || null }
          trace.push({ tier: 1, name: 'Full JSON Schema', ok: true })
        } else {
          trace.push({ tier: 1, name: 'Full JSON Schema', ok: false, reason: 'JSON 结构未通过约束' })
        }
      } catch (err) {
        trace.push({ tier: 1, name: 'Full JSON Schema', ok: false, reason: err?.message || String(err) })
      }
    } else {
      trace.push({ tier: 1, name: 'Full JSON Schema', ok: false, reason: '未提供 LLM 客户端' })
    }
  }

  if (!chosenPlan && llmOutage) {
    const why = String(llmOutage?.message || llmOutage).slice(0, 160)
    trace.push({ tier: 2, name: 'Sectioned List', ok: false, reason: `已跳过：大模型接口暂时不可用（${why}）` })
    trace.push({ tier: 3, name: 'MCQ Choice', ok: false, reason: '已跳过：大模型接口暂时不可用' })
  }

  // Tier 2: Sectioned lightweight list
  if (!chosenPlan && !llmOutage && (!forceTierForTest || forceTierForTest <= 2) && typeof callLlmChatFn === 'function') {
    try {
      const visualItemsT2 = (assetsManifest?.items || []).filter(
        (it) => it.role !== 'music' && it.role !== 'sfx' && it.role !== 'note' && it.role !== 'brand_mark' && it.role !== 'avatar_base' && it.role !== 'voice_clone' && it.type !== 'audio',
      )
      const zeroVisT2 = visualItemsT2.length === 0
      const mediaNamesT2 = visualItemsT2.map((it) => it.path).filter(Boolean)
      const t2DurationPolicy = resolveTargetDurationPolicy({
        durationMode: durationMode || scriptData?.durationMode || 'auto',
        targetDurationSec: Number(targetDurationSec) || Number(scriptData?.targetDurationSec) || 0,
        text: stripPlazaTemplateGuidance(`${cleanTopic} ${effectiveDirectorNotes} ${scriptData?.goal || ''}`),
        pacingProfile,
        narrationMode: narrationMode || scriptData?.narrationMode || 'tts',
        hasVisualAssets: mediaNamesT2.length > 0,
        bgmDurationSec: Number(bgmMeta?.durationSec || scriptData?.bgm?.durationSec) || 0,
      })
      const t2CountRange = t2DurationPolicy.enforced
        ? `${t2DurationPolicy.targetShotsMin}~${t2DurationPolicy.targetShotsMax}`
        : pacingProfile.id === 'calm' ? '6~12' : mediaNamesT2.length >= 8 ? `${mediaNamesT2.length}~${mediaNamesT2.length + 6}` : pacingProfile.id === 'balanced' ? '10~16' : '22~30'
      const isHistoricalT2 =
        resolvedGenre === 'history-theater' ||
        isHistoricalContent(`${cleanTopic} ${effectiveDirectorNotes}`)
      const res = await callLlmChatFn({
        system: zeroVisT2
          ? isHistoricalT2
            ? `用 ${t2CountRange} 行紧凑列出完整叙事分镜表（体裁：${resolvedGenreLabel}），节奏方案【${pacingProfile.label}】：${pacingProfile.ruleHint}。严禁附带任何网址 URL、制作指令词、双引号或 Markdown 链接，保持自然阿拉伯数字。每行格式：镜头标题 | 舞台类型(${VALID_STAGE_ARCHETYPES.join('/')}) | 纯中文旁白金句(含关键要点) | 镜内视觉动作(visualBlueprint)`
            : `用 ${t2CountRange} 行紧凑列出完整视觉分镜表（体裁：${resolvedGenreLabel}），节奏方案【${pacingProfile.label}】：${pacingProfile.ruleHint}。严禁附带任何网址 URL、制作指令词、双引号或 Markdown 链接，保持自然阿拉伯数字。每行格式：镜头标题 | 自由视觉风格标签 | 纯中文旁白金句(含关键要点) | 镜内自由视觉构想与运动描述(visualBlueprint)`
          : `用 ${t2CountRange} 行紧凑列出分镜方案（体裁：${resolvedGenreLabel}），节奏方案【${pacingProfile.label}】：${pacingProfile.ruleHint}。严禁附带任何网址 URL、制作指令词、双引号或 Markdown 链接，保持自然阿拉伯数字。每行格式：镜头标题 | 配方(${VALID_SHOT_KINDS.join('/')}) | 旁白一句话 | 镜内视觉动作(含推镜放大与点击焦点) | 素材路径(从 availableAssets 精确挑选或填 none)`,
        messages: [{
          role: 'user',
          content: `主题: ${cleanTopic}\n内容纲要: ${effectiveDirectorNotes.slice(0, 700)}${mediaNamesT2.length ? `\n可用截图素材(availableAssets):\n${mediaNamesT2.join('\n')}` : ''}`,
        }],
        temperature: 0.35,
        maxTokens: 4200,
      })
      const lines = String(res?.text || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.includes('|'))
      if (lines.length >= 2) {
        const shots = lines.slice(0, 36).map((l, idx) => {
          const cols = l.split('|')
          const [rawTitle, rawType, rawNarr, rawVisual] = cols.slice(0, 4).map((x) => normalizeNumeralsForDisplay(stripMetaInstructions(sanitizeSpokenNarration(x || ''))))
          const rawAssetCol = String(cols[4] || '').trim()
          let matchedAssetRefs
          if (!zeroVisT2) {
            if (/^none$/i.test(rawAssetCol)) {
              matchedAssetRefs = []
            } else {
              const exactOrPartial = mediaNamesT2.find((m) => rawAssetCol && (m === rawAssetCol || m.toLowerCase().includes(rawAssetCol.toLowerCase()) || rawAssetCol.toLowerCase().includes(m.toLowerCase())))
              matchedAssetRefs = exactOrPartial ? [exactOrPartial] : mediaNamesT2.length ? [mediaNamesT2[idx % mediaNamesT2.length]] : []
            }
          }
          const recipe = VALID_SHOT_KINDS.find((k) => rawType?.includes(k)) || (matchedAssetRefs?.length ? 'push_in' : VALID_SHOT_KINDS[(idx % 6) + 1])
          const arch = VALID_STAGE_ARCHETYPES.find((a) => rawType?.includes(a)) || VALID_STAGE_ARCHETYPES[idx % VALID_STAGE_ARCHETYPES.length]
          const beatPattern = zeroVisT2 && pacingProfile.id === 'dynamic'
            ? (idx === 0 || idx === lines.length - 1 ? 4 : idx % 5 === 3 ? 1 : idx % 2 === 1 ? 2 : 3)
            : pacingProfile.id === 'calm'
              ? 6
              : 4
          const txPool = pacingProfile.id === 'calm'
            ? ['light-wipe', 'iris-circle', 'light-wipe']
            : ['flash-cut', 'slash-wipe', 'zoom-punch', 'glitch-cut', 'iris-circle', 'light-wipe']
          return {
            title: rawTitle || `镜头 ${idx + 1}`,
            narration: rawNarr || rawTitle || '',
            visualBlueprint: rawVisual || `${rawTitle || '核心视觉'}：推镜景深推进配合主题切换`,
            recipe,
            transition: idx === 0 ? 'cut' : txPool[idx % txPool.length],
            layout: zeroVisT2 ? (isHistoricalT2 ? 'narrative-diorama' : 'freeform-stage') : (matchedAssetRefs?.length ? 'app-focus-shot' : (isFreeformCoding ? 'freeform-stage' : undefined)),
            assetRefs: matchedAssetRefs,
            focusFx: matchedAssetRefs?.length && resolvedGenre === 'ui-tutorial' ? 0.35 : undefined,
            focusFy: matchedAssetRefs?.length && resolvedGenre === 'ui-tutorial' ? 0.32 : undefined,
            clickLabel: matchedAssetRefs?.length && resolvedGenre === 'ui-tutorial' ? rawTitle?.slice(0, 10) : undefined,
            stageSpec: zeroVisT2 && isHistoricalT2
              ? {
                  mood: idx === 0 ? 'dawn-amber' : idx >= lines.length - 3 ? 'ash-twilight' : idx % 3 === 1 ? 'crimson-war' : 'indigo-night',
                  setting: idx === 0 ? 'palace-stairs' : idx >= lines.length - 3 ? 'river-gorge' : idx % 2 === 0 ? 'city-siege' : 'mountain-camp',
                  archetype: arch,
                }
              : undefined,
            beatCount: beatPattern,
            durationSec: pacingProfile.id === 'calm'
              ? 5.0
              : pacingProfile.id === 'balanced'
                ? 4.2
                : Number((beatPattern * (60 / (bgmMeta?.bpm || 90))).toFixed(2)),
          }
        })
        const effectiveBgmT2 = bgmMeta?.analyzed ? bgmMeta : scriptData?.bgm?.analyzed ? scriptData.bgm : null
        chosenPlan = repairPromoPlanRules(
          { shots, targetPlatform, genre: resolvedGenre, genreLabel: resolvedGenreLabel, authoringMode: effectiveAuthoringMode, pacingMode: pacingProfile.id, mode: pacingProfile.id === 'dynamic' || (zeroVisT2 && isHistoricalT2) ? 'narrative-mv' : 'promo-ui' },
          { topic: cleanTopic, style, genre: resolvedGenre, genreLabel: resolvedGenreLabel, authoringMode: effectiveAuthoringMode, directorNotes: effectiveDirectorNotes, contentOutline, assetsManifest, existingScript: scriptData, bgmMeta: effectiveBgmT2, narrationMode, pacingMode: effectivePacingMode },
        )
        degradationTier = 2
        trace.push({ tier: 2, name: 'Sectioned Prompt', ok: true })
      } else {
        trace.push({ tier: 2, name: 'Sectioned Prompt', ok: false, reason: '未返回标准分栏行' })
      }
    } catch (err) {
      trace.push({ tier: 2, name: 'Sectioned Prompt', ok: false, reason: err?.message || String(err) })
    }
  }

  // Tier 3: Ultra-simple A/B/C Multiple Choice Token for weak/tiny models
  if (!chosenPlan && !llmOutage && (!forceTierForTest || forceTierForTest <= 3) && typeof callLlmChatFn === 'function') {
    try {
      const res = await callLlmChatFn({
        system: '只回复一个字母：A=科技锐利推拉风，B=电影稳重横移风，C=高能卡点快闪风。',
        messages: [{ role: 'user', content: `主题：${cleanTopic || '产品发布'}` }],
        temperature: 0.1,
        maxTokens: 20,
      })
      const ch = String(res?.text || '').toUpperCase().match(/\b([ABC])\b/)?.[1]
      if (ch) {
        const presetStyle = ch === 'B' ? 'cinematic' : ch === 'C' ? 'energetic' : 'tech'
        const recipeSeq =
          ch === 'B'
            ? ['pull_out', 'pan_across', 'face_focus', 'freeze_end']
            : ch === 'C'
              ? ['impact', 'push_in', 'pan_down', 'freeze_end']
              : ['pull_out', 'push_in', 'hold', 'freeze_end']
        const baseScenes = Array.isArray(scriptData?.scenes) && scriptData.scenes.length > 0 ? scriptData.scenes : null
        const shots = (baseScenes || recipeSeq).map((item, idx) => ({
          title: baseScenes ? item.title : `${cleanTopic || '重点展示'} ${idx + 1}`,
          narration: baseScenes ? item.narration : `${cleanTopic || '项目特性'} 核心解读第 ${idx + 1} 幕。`,
          recipe: recipeSeq[idx % recipeSeq.length],
          durationSec: baseScenes ? item.durationSec : pacingProfile.id === 'calm' ? 5.0 : 4.2,
        }))
        chosenPlan = repairPromoPlanRules(
          { style: presetStyle, genre: resolvedGenre, genreLabel: resolvedGenreLabel, authoringMode: effectiveAuthoringMode, targetPlatform, pacingMode: pacingProfile.id, shots },
          { topic: cleanTopic, style: presetStyle, genre: resolvedGenre, genreLabel: resolvedGenreLabel, authoringMode: effectiveAuthoringMode, directorNotes: effectiveDirectorNotes, contentOutline, assetsManifest, existingScript: scriptData, narrationMode, pacingMode: effectivePacingMode },
        )
        degradationTier = 3
        styleAnswer = { style: presetStyle, profile: null }
        trace.push({ tier: 3, name: `MCQ Choice (${ch})`, ok: true })
      } else {
        trace.push({ tier: 3, name: 'MCQ Choice', ok: false, reason: '模型未返回 A/B/C 单字母' })
      }
    } catch (err) {
      trace.push({ tier: 3, name: 'MCQ Choice', ok: false, reason: err?.message || String(err) })
    }
  }

  // Tier 4: Deterministic Code Rules Fallback (zero failure guarantee). Its storyboard follows the brief's own key
  // points when the brief lists them, so a degraded film is still about the user's subject.
  let briefBeatCount = 0
  if (!chosenPlan) {
    const briefBeats = extractBriefBeats({
      contentOutline,
      texts: [effectiveDirectorNotes, topic, scriptData?.goal, scriptData?.directorNotes, scriptData?.userPrompt],
    })
    const briefShots = briefBeats.length >= 3 ? buildBriefFallbackShots({ topic: cleanTopic, beats: briefBeats, pacingId: pacingProfile.id }) : null
    briefBeatCount = briefShots ? briefBeats.length : 0
    chosenPlan = repairPromoPlanRules(
      { targetPlatform, style, genre: resolvedGenre, genreLabel: resolvedGenreLabel, authoringMode: effectiveAuthoringMode, pacingMode: pacingProfile.id, ...(briefShots ? { shots: briefShots } : {}) },
      { topic: cleanTopic, style, genre: resolvedGenre, genreLabel: resolvedGenreLabel, authoringMode: effectiveAuthoringMode, directorNotes: effectiveDirectorNotes, contentOutline, assetsManifest, existingScript: scriptData, narrationMode, pacingMode: effectivePacingMode },
    )
    degradationTier = 4
    trace.push({ tier: 4, name: briefShots ? `Deterministic Rule Engine Fallback (brief key points × ${briefBeats.length})` : 'Deterministic Rule Engine Fallback', ok: true })
  }

  // Final style: an auto project follows the model's pick / design (validated, contrast fixed up) or, without a usable
  // answer (rule tiers, weak models), the keyword rules — never an error. The decision is also written onto the passed
  // scriptData so callers that persist it (the pipeline director stage) keep it.
  const styleDecision = decidePlanStyle({
    script: styleScript,
    planStyle: styleAnswer?.style,
    planProfile: styleAnswer?.profile,
    text: `${cleanTopic} ${effectiveDirectorNotes} ${scriptData?.goal || ''}`,
    genre: resolvedGenre,
    genreLabel: resolvedGenreLabel,
    by: styleAnswer ? 'llm' : 'rules',
  })
  chosenPlan.style = styleDecision.style
  chosenPlan.styleMode = styleDecision.mode
  chosenPlan.styleProfile = styleDecision.profile || null
  if (effectiveStyleMode(styleScript) === 'auto' || !styleScript.style) {
    if (scriptData && typeof scriptData === 'object') applyStyleDecision(scriptData, styleDecision)
    trace.push({
      tier: 'style',
      name: styleDecision.custom ? `AI 自创风格「${styleDecision.profile.name}」(基于 ${styleDecision.style})` : `${styleDecision.by === 'llm' ? 'AI 选择' : '规则匹配'}预设风格 ${styleDecision.style}`,
      ok: true,
      ...(styleDecision.fixes && styleDecision.fixes.length ? { contrastFixes: styleDecision.fixes.map((f) => `${f.key} ${f.from}→${f.to}`) } : {}),
    })
  }

  const validation = validatePromoPlan(chosenPlan)
  const resolved = resolvePlanSchedule(chosenPlan, { ...scriptData, genre: resolvedGenre, genreLabel: resolvedGenreLabel, targetPlatform })

  if (projectDir) {
    const absDir = resolve(projectDir)
    mkdirSync(absDir, { recursive: true })
    writeFileSync(join(absDir, 'plan.json'), JSON.stringify(chosenPlan, null, 2) + '\n', 'utf8')
    writeFileSync(join(absDir, 'plan.resolved.json'), JSON.stringify(resolved, null, 2) + '\n', 'utf8')
  }

  return {
    ok: validation.ok,
    plan: chosenPlan,
    resolved,
    degradationTier,
    tierLabel:
      degradationTier === 1
        ? 'Tier 1 · 完整 JSON Schema'
        : degradationTier === 2
          ? 'Tier 2 · 分段轻量化降级'
          : degradationTier === 3
            ? 'Tier 3 · A/B/C 选择题降级'
            : 'Tier 4 · 纯规则代码引擎兜底',
    trace,
    llmOutage: llmOutage ? String(llmOutage?.message || llmOutage).slice(0, 300) : '',
    briefBeatCount,
  }
}
