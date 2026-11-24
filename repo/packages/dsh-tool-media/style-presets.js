/**
 * Visual style engine: 「AI 自由匹配」 + 6 built-in presets + 「我的风格预设」.
 *
 * UI / request values:  'auto'  |  '<presetId>'  |  'user:<savedPresetId>'
 * Script fields (script.json):
 *   style        always one of the 6 preset ids (the base — every older consumer keeps working)
 *   styleMode    'auto' | 'preset' | 'user'            (missing = 'preset', older projects)
 *   styleProfile custom profile (AI-designed new style, or a copy of the user's saved preset):
 *                { name, desc, base, palette{background,surface,textPrimary,textSecondary,accent,accent2,gold},
 *                  typography{family,mood}, motion, bgmMood, source:'ai'|'user', presetId? }
 *   styleAuto    record of the last 「AI 自由匹配」 decision { by:'llm'|'rules', style, custom, name, at }
 *   theme        palette of the preset / profile (read by resolvePalette() → both render engines)
 *
 * Saved presets: <DSH_VIDEO_HOME>/style-presets.json (atomic writes + advisory lock), at most 60.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { normalizeVideoStyle, readScriptJson, resolveEnvPath, VIDEO_STYLES, writeScriptJson } from '../shared/index.js'
import { resolvePalette } from './html-generator.js'
import { detectGenre, getGenreProfile } from './genre-router.js'
import { readJsonSafe, withFileLockSync, writeJsonAtomic } from './safe-json-store.js'

export const STYLE_AUTO = 'auto'
export const USER_STYLE_PREFIX = 'user:'
export const MAX_STYLE_PRESETS = 60
export const STYLE_PALETTE_KEYS = ['background', 'surface', 'textPrimary', 'textSecondary', 'accent', 'accent2', 'gold']
/** Display order and wording of the 6 presets — the same labels the war room shows (client.js UNIFIED_STYLES). */
export const STYLE_PRESETS = [
  { id: 'emerald', label: '墨翠轻奢', desc: '深翠墨底 · 柔金光影' },
  { id: 'tech', label: '科技锋芒', desc: '几何光线 · 精密节奏' },
  { id: 'cinematic', label: '电影大片', desc: '黄金比例 · 光影叙事' },
  { id: 'documentary', label: '极简纪实', desc: '克制留白 · 权威旁白' },
  { id: 'energetic', label: '活力潮牌', desc: '快切节拍 · 高能撞色' },
  { id: 'warm', label: '温暖故事', desc: '柔光琥珀 · 人文温度' },
]
export const STYLE_PRESET_IDS = STYLE_PRESETS.map((p) => p.id)
const PRESET_BY_ID = Object.fromEntries(STYLE_PRESETS.map((p) => [p.id, p]))
// legacy / LLM spellings of the presets (older director schema: emerald | cyber | cinema | editorial | luxury | minimal)
const STYLE_ALIASES = {
  cyber: 'tech', 'sci-fi': 'tech', future: 'tech',
  cinema: 'cinematic', film: 'cinematic', epic: 'cinematic', movie: 'cinematic',
  editorial: 'documentary', minimal: 'documentary', 'minimal-editorial': 'documentary', doc: 'documentary',
  luxury: 'emerald', mint: 'emerald', 'emerald-trench': 'emerald',
  'vibrant-brand': 'energetic', vibrant: 'energetic', pop: 'energetic',
  cozy: 'warm', story: 'warm',
}

/* ------------------------------------------------------------------ values */
export const isPresetStyleId = (v) => typeof v === 'string' && Boolean(PRESET_BY_ID[v])
export const presetLabel = (id) => (PRESET_BY_ID[id] ? PRESET_BY_ID[id].label : String(id || ''))

/** Map a model's style answer to a preset id (null when it is not recognisable). */
export function mapStyleAnswer(raw) {
  const key = String(raw || '').trim().toLowerCase()
  if (!key) return null
  if (PRESET_BY_ID[key]) return key
  if (STYLE_ALIASES[key]) return STYLE_ALIASES[key]
  const byLabel = STYLE_PRESETS.find((p) => p.label === String(raw || '').trim())
  return byLabel ? byLabel.id : null
}

/** Classify a UI / request value. */
export function parseStyleValue(v) {
  const s = String(v ?? '').trim()
  if (!s) return { kind: 'none', id: '' }
  if (s === STYLE_AUTO) return { kind: 'auto', id: '' }
  if (s.startsWith(USER_STYLE_PREFIX)) {
    const id = s.slice(USER_STYLE_PREFIX.length)
    return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? { kind: 'user', id } : { kind: 'invalid', id: '' }
  }
  const mapped = mapStyleAnswer(s)
  return mapped ? { kind: 'preset', id: mapped } : { kind: 'invalid', id: '' }
}
export const isValidStyleValue = (v) => ['auto', 'preset', 'user'].includes(parseStyleValue(v).kind)

/* ------------------------------------------------------------------ colour math (WCAG 2.x) */
function parseHex(raw) {
  let s = String(raw ?? '').trim()
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(s)
  if (rgb) {
    const c = rgb.slice(1, 4).map((x) => Math.max(0, Math.min(255, Number(x))))
    return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
  }
  if (!s.startsWith('#')) s = `#${s}`
  if (/^#[0-9a-f]{3}$/i.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
  if (/^#[0-9a-f]{8}$/i.test(s)) s = s.slice(0, 7) // drop alpha
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toUpperCase() : null
}
export const normalizeHexColor = parseHex
const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const fromRgb = (c) => `#${c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
const mix = (a, b, t) => {
  const A = toRgb(a)
  const B = toRgb(b)
  return fromRgb(A.map((x, i) => x + (B[i] - x) * t))
}
export function relativeLuminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
/** Move `fg` towards white / black (whichever contrasts more with `bg`) until the ratio reaches `target`. */
function adjustForContrast(fg, bg, target) {
  if (contrastRatio(fg, bg) >= target) return fg
  const towards = contrastRatio('#FFFFFF', bg) >= contrastRatio('#000000', bg) ? '#FFFFFF' : '#000000'
  for (let t = 0.08; t < 1; t += 0.08) {
    const c = mix(fg, towards, t)
    if (contrastRatio(c, bg) >= target) return c
  }
  return towards
}
const rgbTriplet = (hex) => toRgb(hex).join(',')

/* ------------------------------------------------------------------ profile validation */
const clipChars = (s, n) => Array.from(String(s ?? '')).slice(0, n).join('')
function cleanLine(raw, max) {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>`"“”'‘’「」『』《》【】\[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clipChars(s, max).trim()
}
function normalizeTypography(raw) {
  let family = ''
  let mood = ''
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    family = String(raw.family || raw.font || raw.type || '')
    mood = String(raw.mood || raw.feel || raw.desc || raw.words || '')
  } else {
    const s = String(raw ?? '')
    const m = /^\s*(sans|serif|mono)\b\s*[·:：,，\-|/、]*\s*(.*)$/i.exec(s)
    if (m) {
      family = m[1]
      mood = m[2]
    } else mood = s
  }
  const famRaw = family.trim().toLowerCase()
  let fam = ['sans', 'serif', 'mono'].includes(famRaw) ? famRaw : ''
  if (!fam) {
    const probe = `${family} ${mood}`.toLowerCase()
    fam = /mono|等宽|代码|终端|像素/.test(probe) ? 'mono' : /无衬线|黑体|sans/.test(probe) ? 'sans' : /serif|衬线|宋|楷|书法|手写|古籍|碑/.test(probe) ? 'serif' : 'sans'
  }
  return { family: fam, mood: cleanLine(mood, 16) }
}
export const typographyText = (t) => {
  if (!t) return ''
  const fam = { sans: '无衬线黑体', serif: '衬线 / 书法感', mono: '等宽代码体' }[t.family] || '无衬线黑体'
  return t.mood ? `${fam} · ${t.mood}` : fam
}

/**
 * Validate a style profile (from the plan LLM or a saved preset). Never rejects for bad contrast — colours are fixed up
 * to WCAG AA (text ≥ 4.5:1 on the background / cards, accents ≥ 3:1). Returns null when it is not a usable profile
 * (no name, or too few valid colours to be a real design).
 */
export function sanitizeStyleProfile(raw, { fallbackBase = 'tech', source = 'ai', nameMax = 12 } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const name = cleanLine(raw.name || raw.label || raw.title, nameMax)
  if (!name) return null
  const base = mapStyleAnswer(raw.base || raw.basePreset || raw.closestPreset) || mapStyleAnswer(fallbackBase) || 'tech'
  const rawPal = raw.palette && typeof raw.palette === 'object' ? raw.palette : raw.colors && typeof raw.colors === 'object' ? raw.colors : {}
  const alias = { bgPrimary: 'background', bg: 'background', bgSecondary: 'surface', card: 'surface', text: 'textPrimary', textMuted: 'textSecondary', accentPrimary: 'accent', primary: 'accent', accentSecondary: 'accent2', secondary: 'accent2', highlight: 'gold' }
  const given = {}
  for (const [k, v] of Object.entries(rawPal)) {
    const key = STYLE_PALETTE_KEYS.includes(k) ? k : alias[k]
    const hex = key ? parseHex(v) : null
    if (key && hex && !given[key]) given[key] = hex
  }
  if (!given.background || !given.accent || Object.keys(given).length < 3) return null
  const basePal = resolvePalette({ style: base })
  const pal = {}
  for (const k of STYLE_PALETTE_KEYS) pal[k] = given[k] || parseHex(basePal[k]) || '#888888'
  const fixes = []
  const fix = (key, next, against) => {
    if (next !== pal[key]) {
      fixes.push({ key, from: pal[key], to: next, ratio: Number(contrastRatio(next, against).toFixed(2)) })
      pal[key] = next
    }
  }
  // main text: readable on the background and on cards
  let tp = pal.textPrimary
  for (let i = 0; i < 3; i++) {
    tp = adjustForContrast(adjustForContrast(tp, pal.background, 4.5), pal.surface, 4.5)
    if (contrastRatio(tp, pal.background) >= 4.5 && contrastRatio(tp, pal.surface) >= 4.5) break
  }
  if (contrastRatio(tp, pal.background) < 4.5) tp = adjustForContrast(tp, pal.background, 4.5)
  fix('textPrimary', tp, pal.background)
  if (contrastRatio(pal.textPrimary, pal.surface) < 4.5) {
    // cards on the other side of the luminance range than the background: pull them towards the background
    let s = pal.surface
    for (let t = 0.12; t <= 1.0001 && contrastRatio(pal.textPrimary, s) < 4.5; t += 0.12) s = mix(pal.surface, pal.background, Math.min(1, t))
    fix('surface', s, pal.textPrimary)
  }
  fix('textSecondary', adjustForContrast(adjustForContrast(pal.textSecondary, pal.background, 4.5), pal.surface, 3), pal.background)
  for (const k of ['accent', 'accent2', 'gold']) fix(k, adjustForContrast(pal[k], pal.background, 3), pal.background)
  const motionRaw = Array.isArray(raw.motion) ? raw.motion.join('、') : raw.motion || raw.camera || raw.transitions
  const profile = {
    name,
    desc: cleanLine(raw.desc || raw.description || raw.tagline, 24),
    base,
    palette: pal,
    typography: normalizeTypography(raw.typography || raw.font || raw.fonts),
    motion: cleanLine(motionRaw, 40),
    bgmMood: cleanLine(raw.bgmMood || raw.musicMood || raw.bgm, 24),
    source: source === 'user' ? 'user' : 'ai',
  }
  if (raw.presetId && /^[A-Za-z0-9_-]{1,40}$/.test(String(raw.presetId))) profile.presetId = String(raw.presetId)
  if (fixes.length) Object.defineProperty(profile, 'fixes', { value: fixes, enumerable: false })
  return profile
}

/* ------------------------------------------------------------------ themes */
const keepBrand = (prevTheme) => (prevTheme && prevTheme.brandMark ? { brandMark: prevTheme.brandMark } : {})
/** The render theme of a preset (keeps a brand mark that lived in the previous theme). */
export function presetTheme(styleId, prevTheme) {
  return { ...resolvePalette({ style: normalizeVideoStyle(styleId) }), ...keepBrand(prevTheme) }
}
/** The render theme of a custom profile: its palette + the derived values the HTML engine reads. */
export function buildThemeFromProfile(profile, prevTheme) {
  const p = profile.palette
  const dark = relativeLuminance(p.background) < 0.4
  return {
    ...p,
    rgbAccent: rgbTriplet(p.accent),
    rgbGold: rgbTriplet(p.gold),
    titleGrad: dark
      ? `linear-gradient(180deg,#FFFFFF 0%,${mix(p.textPrimary, '#FFFFFF', 0.35)} 52%,${p.textSecondary} 100%)`
      : `linear-gradient(180deg,${p.textPrimary} 0%,${mix(p.textPrimary, p.textSecondary, 0.45)} 100%)`,
    accentGrad: `linear-gradient(180deg,${mix(p.accent, '#FFFFFF', 0.55)} 0%,${p.accent} 55%,${mix(p.accent, '#000000', 0.32)} 100%)`,
    ...keepBrand(prevTheme),
  }
}

/** BGM synth mood key (tech / cinematic / energetic / warm / emerald) of a script or profile. */
export function styleMoodKey(scriptOrProfile) {
  const prof = scriptOrProfile && scriptOrProfile.palette ? scriptOrProfile : scriptOrProfile && scriptOrProfile.styleProfile
  const base = normalizeVideoStyle((prof && prof.base) || (scriptOrProfile && scriptOrProfile.style) || 'tech')
  const text = String((prof && prof.bgmMood) || '')
  if (/科技|电子|合成器|赛博|未来|极简电子|ambient/i.test(text)) return 'tech'
  if (/史诗|电影|管弦|交响|宏大|悬疑|战鼓|大气/i.test(text)) return 'cinematic'
  if (/燃|鼓点|电音|嘻哈|摇滚|快节奏|动感|蹦迪|朋克|trap|edm/i.test(text)) return 'energetic'
  if (/温暖|钢琴|吉他|治愈|民谣|轻柔|木吉他|口琴|童谣|lo-?fi/i.test(text)) return 'warm'
  if (/奢|爵士|优雅|国风|古筝|古琴|琵琶|东方|禅|丝竹/i.test(text)) return 'emerald'
  return (VIDEO_STYLES[base] && VIDEO_STYLES[base].mood) || 'tech'
}

/* ------------------------------------------------------------------ deterministic 「AI 自由匹配」 (no LLM) */
const AUTO_RULES = {
  emerald: /轻奢|奢华|高端|珠宝|翡翠|玉石|茶[叶饮道艺]?|国风|东方美|中式|新中式|雅致|禅意|香氛|香水|美妆|护肤|酒店|地产|定制|匠心|非遗|瓷器|丝绸|旗袍|水墨|书法|古典|典雅/gi,
  tech: /科技|人工智能|\bAI\b|大模型|算法|代码|编程|软件|\bapp\b|应用|芯片|数码|手机|电脑|互联网|saas|云计算|机器人|赛博|智能|开发者?|工具|系统|平台|教程|界面|硬件|开源|vibe|极客|自动化/gi,
  cinematic: /电影|大片|史诗|预告|片头|震撼|历史|战争|战役|传奇|英雄|武侠|古代|王朝|帝王|将军|悬疑|科幻|奇幻|冒险|动作|悲壮|宏大|宣传片|发布会/gi,
  documentary: /纪录|纪实|洞察|行业|分析|报告|研究|深度|解读|科普|原理|知识|访谈|人物志|调查|财经|经济|政策|新闻|课程|学习|讲座|白皮书/gi,
  energetic: /潮牌|潮流|快闪|卡点|燃|爆款|带货|促销|电商|运动|健身|街舞|音乐|\bmv\b|节奏|年轻|活力|开箱|测评|游戏|电竞|热血|炫酷|派对|大促|种草|网红/gi,
  warm: /温暖|温情|治愈|故事|家庭|亲情|爱情|友情|成长|回忆|美食|咖啡|烘焙|旅行|生活|日常|宠物|童年|毕业|感恩|公益|乡村|田园|手作|vlog|情感|陪伴|母亲|父亲/gi,
}
/** Pick a preset for a topic without any model (keyword score, ties broken by the genre router; never fails). */
export function resolveAutoStyle({ text = '', genre = '', genreLabel = '' } = {}) {
  const s = `${text || ''} ${genreLabel || ''}`
  const gp = getGenreProfile(genre && genre !== 'other' ? genre : detectGenre(s))
  const genreId = gp.id
  const genreStyle = genreId !== 'other' ? normalizeVideoStyle(gp.style || 'tech') : ''
  let best = null
  let bestScore = 0
  for (const id of STYLE_PRESET_IDS) {
    const m = s.match(AUTO_RULES[id])
    const score = (m ? m.length : 0) + (id === genreStyle ? 0.5 : 0)
    if (score > bestScore) {
      best = id
      bestScore = score
    }
  }
  return bestScore >= 1 ? best : genreId !== 'other' ? genreStyle : 'tech'
}

/* ------------------------------------------------------------------ script ⇄ selection */
/** The mode a script really is in — guards against older writers that change `style` without knowing about modes. */
export function effectiveStyleMode(script) {
  const s = script && typeof script === 'object' ? script : {}
  const style = String(s.style || '')
  if (s.styleMode === 'auto') return s.styleAuto && s.styleAuto.style && s.styleAuto.style !== style ? 'preset' : 'auto'
  if (s.styleMode === 'user') return s.styleProfile && s.styleProfile.base === style ? 'user' : 'preset'
  return 'preset'
}
/** UI value of a script: 'auto' | presetId | 'user:<id>'. */
export function styleSelectionValue(script) {
  const mode = effectiveStyleMode(script)
  if (mode === 'auto') return STYLE_AUTO
  if (mode === 'user' && script.styleProfile.presetId) return `${USER_STYLE_PREFIX}${script.styleProfile.presetId}`
  return normalizeVideoStyle(script && script.style)
}
/**
 * Script fields of a decision { mode, style, profile, custom, by } (mutates and returns `script`).
 * record=false (a plain selection in the UI, a new project): the record says by:'pending' — only the production
 * planners write a real decision ('rules' / 'llm'), so the UI keeps saying 「AI 自由匹配」 until a run decided. The
 * record's `style` also lets effectiveStyleMode() notice older writers (template apply, reference analysis) that
 * change `style` without knowing about modes.
 */
export function applyStyleDecision(script, d, { now = new Date().toISOString(), record = true } = {}) {
  const prevTheme = script.theme && typeof script.theme === 'object' ? script.theme : null
  script.style = normalizeVideoStyle(d.style)
  script.styleMode = d.mode === 'auto' || d.mode === 'user' ? d.mode : 'preset'
  if (d.profile) script.styleProfile = { ...d.profile }
  else delete script.styleProfile
  if (script.styleMode === 'auto') {
    const by = !record ? 'pending' : d.by === 'llm' ? 'llm' : 'rules'
    script.styleAuto = { by, style: script.style, custom: Boolean(d.profile), name: d.profile ? d.profile.name : presetLabel(script.style), at: now }
  } else delete script.styleAuto
  script.theme = d.profile ? buildThemeFromProfile(d.profile, prevTheme) : presetTheme(script.style, prevTheme)
  return script
}
/** The decision a script currently holds (used to keep it unchanged). */
export function currentStyleDecision(script) {
  const mode = effectiveStyleMode(script)
  const style = normalizeVideoStyle(script && script.style)
  if (mode === 'user') return { mode, style, profile: script.styleProfile, custom: true, by: 'user' }
  if (mode === 'auto') return { mode, style, profile: script.styleProfile || null, custom: Boolean(script.styleProfile), by: script.styleAuto ? script.styleAuto.by : 'rules' }
  return { mode: 'preset', style, profile: null, custom: false, by: 'user' }
}

/**
 * Resolve a requested UI value against a script.
 *   reResolve      'auto' on an auto script picks again (a new production run) instead of keeping the last decision
 *   keepModeIfBase a plain preset equal to the script's base keeps an auto / user script as it is (callers that only
 *                  know the base, e.g. the pipeline passing its resolved style to the local planner)
 * Throws for a deleted / unknown saved preset.
 */
export function resolveStyleRequest(script, requested, { text = '', genre = '', genreLabel = '', reResolve = false, keepModeIfBase = false, lookupPreset = getStylePreset } = {}) {
  const sc = script && typeof script === 'object' ? script : {}
  const sel = parseStyleValue(requested)
  const mode = effectiveStyleMode(sc)
  const hasScript = Boolean(sc.style)
  if (sel.kind === 'none' || sel.kind === 'invalid') {
    if (hasScript) return currentStyleDecision(sc)
    return { mode: 'auto', style: resolveAutoStyle({ text, genre, genreLabel }), profile: null, custom: false, by: 'rules' }
  }
  if (sel.kind === 'auto') {
    if (mode === 'auto' && hasScript && !reResolve) return currentStyleDecision(sc)
    return { mode: 'auto', style: resolveAutoStyle({ text, genre, genreLabel }), profile: null, custom: false, by: 'rules' }
  }
  if (sel.kind === 'preset') {
    if (keepModeIfBase && hasScript && mode !== 'preset' && sel.id === normalizeVideoStyle(sc.style)) return currentStyleDecision(sc)
    return { mode: 'preset', style: sel.id, profile: null, custom: false, by: 'user' }
  }
  const preset = lookupPreset(sel.id)
  if (!preset) {
    // a deleted 「我的预设」 that this project still uses: the project keeps its own copy of the profile
    if (styleSelectionValue(sc) === `${USER_STYLE_PREFIX}${sel.id}`) return currentStyleDecision(sc)
    throw new Error('该风格预设不存在或已被删除，请重新选择风格')
  }
  const profile = { ...preset.profile, source: 'user', presetId: preset.id }
  return { mode: 'user', style: profile.base, profile, custom: true, by: 'user' }
}

/**
 * The plan model's style answer → final decision. Only an auto script follows the model: a preset / user choice is
 * the user's and stays. A model that names no usable preset or profile (weak models, rule tiers) → keyword rules.
 */
export function decidePlanStyle({ script, planStyle, planProfile, text = '', genre = '', genreLabel = '', by = 'llm' } = {}) {
  const sc = script && typeof script === 'object' ? script : {}
  const mode = effectiveStyleMode(sc)
  if (mode !== 'auto' && sc.style) return currentStyleDecision(sc)
  const picked = mapStyleAnswer(planStyle)
  const profile = by === 'llm' && planProfile ? sanitizeStyleProfile(planProfile, { fallbackBase: picked || resolveAutoStyle({ text, genre, genreLabel }), source: 'ai' }) : null
  if (profile) return { mode: 'auto', style: profile.base, profile, custom: true, by: 'llm', fixes: profile.fixes || [] }
  if (picked && by === 'llm') return { mode: 'auto', style: picked, profile: null, custom: false, by: 'llm' }
  return { mode: 'auto', style: resolveAutoStyle({ text, genre, genreLabel }), profile: null, custom: false, by: 'rules' }
}

const STYLE_FIELDS = ['style', 'styleMode', 'styleProfile', 'styleAuto', 'theme']
const styleFieldsSig = (sc) => JSON.stringify(STYLE_FIELDS.map((k) => (k === 'styleAuto' && sc[k] ? { ...sc[k], at: '' } : sc[k] ?? null)))
/**
 * Before a production run: resolve the requested value against the project's script.json and persist it, so every stage
 * (and code that only knows the base preset) sees one consistent style. 'auto' picks again with the keyword rules —
 * the plan LLM call of an AI run then refines it. Returns the preset base to hand to the pipeline. Never throws for a
 * deleted 「我的预设」 (the project keeps its current style; `warning` says why).
 */
export function prepareProjectStyleForRun({ projectDir, style, text = '', genre = '', genreLabel = '' } = {}) {
  const sel = parseStyleValue(style)
  if (!projectDir || !existsSync(join(resolve(projectDir), 'script.json'))) {
    const preset = sel.kind === 'preset' ? sel.id : resolveAutoStyle({ text, genre, genreLabel })
    return { style: preset, styleMode: sel.kind === 'preset' ? 'preset' : 'auto', styleProfile: null, warning: '' }
  }
  const { data } = readScriptJson(projectDir)
  const opts = { text: text || `${data.topic || data.title || ''} ${data.directorNotes || ''} ${data.goal || ''}`, genre: genre || data.genre || '', genreLabel: genreLabel || data.genreLabel || '', reResolve: true }
  let decision
  let warning = ''
  try {
    decision = resolveStyleRequest(data, sel.kind === 'none' ? undefined : style, opts)
  } catch (err) {
    decision = currentStyleDecision(data)
    warning = err.message
  }
  const before = styleFieldsSig(data)
  applyStyleDecision(data, decision)
  if (styleFieldsSig(data) !== before) writeScriptJson(projectDir, data)
  return { style: data.style, styleMode: data.styleMode, styleProfile: data.styleProfile || null, warning }
}

/* ------------------------------------------------------------------ prompts */
const presetLines = () => STYLE_PRESETS.map((p) => `   - ${p.id}（${p.label}：${p.desc}）`).join('\n')
const paletteText = (p) => `背景 ${p.background}、卡片 ${p.surface}、主文字 ${p.textPrimary}、次文字 ${p.textSecondary}、主强调 ${p.accent}、辅强调 ${p.accent2}、点缀 ${p.gold}`

/** Style instructions for the plan / director LLM call (part of the existing plan JSON — no extra call). */
export function buildStylePlanDirective(script) {
  const sc = script && typeof script === 'object' ? script : {}
  const mode = effectiveStyleMode(sc)
  if (mode === 'auto' || !sc.style) {
    return `\n\n【视觉风格 · AI 自由匹配（用户在导演参数里选择了让 AI 决定风格）】：
1. 先从下面 6 个预设风格里挑一个最贴合本片主题、受众与情绪的，把它的 id 填进 JSON 的 "style"，并令 "styleProfile": null：
${presetLines()}
2. 只有当 6 个预设都明显不合适（例如：水墨国风、复古胶片、童趣手绘、粉紫赛博霓虹、极简白底杂志风……）时，才为本片设计一个新风格，在 JSON 里额外输出：
   "styleProfile": { "name": "≤12 字中文风格名", "desc": "≤24 字一句话描述", "base": "最接近的预设 id（emerald|tech|cinematic|documentary|energetic|warm）", "palette": { "background": "#RRGGBB", "surface": "#RRGGBB", "textPrimary": "#RRGGBB", "textSecondary": "#RRGGBB", "accent": "#RRGGBB", "accent2": "#RRGGBB", "gold": "#RRGGBB" }, "typography": "sans|serif|mono · 字体气质词", "motion": "转场与运镜关键词", "bgmMood": "配乐气质" }
   此时 "style" 填 base 的 id。文字色与背景色必须高对比（主文字 ≥ 4.5:1），颜色一律写 6 位十六进制。
3. 风格只影响配色、字体气质、运镜与配乐基调，不要把风格名写进 title / narration / subChunks / highlights。`
  }
  const prof = mode === 'user' ? sc.styleProfile : null
  if (prof) {
    return `\n\n【视觉风格（用户已指定，不要更改）】："style" 固定填 "${normalizeVideoStyle(sc.style)}"，"styleProfile" 填 null。本片使用用户保存的风格「${prof.name}」${prof.desc ? `（${prof.desc}）` : ''}：配色 ${paletteText(prof.palette)}；字体气质 ${typographyText(prof.typography)}${prof.motion ? `；运镜与转场 ${prof.motion}` : ''}${prof.bgmMood ? `；配乐气质 ${prof.bgmMood}` : ''}。每一镜的 visualBlueprint 请与这个风格保持一致。`
  }
  const id = normalizeVideoStyle(sc.style)
  return `\n\n【视觉风格（用户已指定，不要更改）】："style" 固定填 "${id}"（${presetLabel(id)}：${(PRESET_BY_ID[id] || {}).desc || ''}），"styleProfile" 填 null。`
}

/**
 * Soft coder guidance (like the 视效偏好 line) for a custom style — the Remotion / HTML coder prompts get its name,
 * description, palette, typography and motion. Empty for plain presets (the coders already receive the palette).
 */
export const STYLE_GUIDE_MARKER = '【视觉风格：'
export function buildStyleProfileGuide(script, { engine = 'remotion' } = {}) {
  const sc = script && typeof script === 'object' ? script : {}
  const mode = effectiveStyleMode(sc)
  const prof = mode === 'auto' || mode === 'user' ? sc.styleProfile : null
  if (!prof || !prof.palette) return ''
  const who = prof.source === 'user' ? '用户保存的风格预设' : 'AI 为本片定制的风格'
  const fonts = engine === 'html' ? '（字体仍按下方合规规则加载）' : '（只用 FONT_SANS / FONT_SERIF / FONT_MONO）'
  return `- **${STYLE_GUIDE_MARKER}${prof.name}${prof.desc ? `（${prof.desc}）` : ''} —— ${who}，配色以它为准，优先于上文按题材给出的配色建议】**：全片配色用 PALETTE / theme（${paletteText(prof.palette)}）；字体气质：${typographyText(prof.typography)}${fonts}${prof.motion ? `；镜头与转场：${prof.motion}` : ''}。这是整体风格方向，每一镜的构图与动效仍按画面需要自由创作。`
}
/** Append the guide to a prompt package's system text once (no duplicate when an upstream builder already added it). */
export function withStyleGuide(pkg, script, opts) {
  const guide = buildStyleProfileGuide(script, opts)
  if (!guide || !pkg || typeof pkg.system !== 'string' || pkg.system.includes(STYLE_GUIDE_MARKER)) return pkg
  return { ...pkg, system: `${pkg.system}\n${guide}` }
}

/* ------------------------------------------------------------------ 「我的风格预设」 store */
export function getStylePresetsPath() {
  return join(resolveEnvPath('DSH_VIDEO_HOME', './.dsh-home'), 'style-presets.json')
}
function cleanPresetName(raw) {
  const name = cleanLine(raw, 20)
  if (!name) throw new Error('请给风格预设起一个名字')
  return name
}
function storedToPreset(x) {
  if (!x || typeof x !== 'object' || !/^[A-Za-z0-9_-]{1,40}$/.test(String(x.id || ''))) return null
  const profile = sanitizeStyleProfile({ ...x, name: x.name }, { fallbackBase: x.base, source: 'user', nameMax: 20 })
  if (!profile) return null
  delete profile.presetId
  return { id: String(x.id), name: profile.name, createdAt: String(x.createdAt || ''), updatedAt: String(x.updatedAt || x.createdAt || ''), profile }
}
function readPresetStore() {
  const raw = readJsonSafe(getStylePresetsPath(), null)
  const list = Array.isArray(raw && raw.presets) ? raw.presets : []
  return list.map(storedToPreset).filter(Boolean)
}
function writePresetStore(list) {
  writeJsonAtomic(getStylePresetsPath(), {
    version: 1,
    updatedAt: new Date().toISOString(),
    presets: list.map((p) => ({ id: p.id, createdAt: p.createdAt, updatedAt: p.updatedAt, ...p.profile, name: p.name, source: undefined })),
  })
}
const withStore = (fn) => withFileLockSync(`${getStylePresetsPath()}.lock`, fn)
/** Public shape of a saved preset (UI + API). */
export const presetSummary = (p) => ({ id: p.id, value: `${USER_STYLE_PREFIX}${p.id}`, name: p.name, desc: p.profile.desc, base: p.profile.base, palette: p.profile.palette, typography: p.profile.typography, motion: p.profile.motion, bgmMood: p.profile.bgmMood, createdAt: p.createdAt, updatedAt: p.updatedAt })
export function listStylePresets() {
  return readPresetStore().map(presetSummary)
}
export function getStylePreset(id) {
  return readPresetStore().find((p) => p.id === String(id || '')) || null
}
/** Save a profile (usually the project's AI-designed style) as 「我的风格预设」. */
export function saveStylePreset({ name, profile } = {}) {
  const clean = sanitizeStyleProfile(profile, { fallbackBase: profile && profile.base, source: 'user', nameMax: 20 })
  if (!clean) throw new Error('这个风格缺少名称或配色，不能保存为预设')
  const finalName = cleanPresetName(name || clean.name)
  return withStore(() => {
    const list = readPresetStore()
    if (list.length >= MAX_STYLE_PRESETS) throw new Error(`最多保存 ${MAX_STYLE_PRESETS} 个风格预设，请先删除不再使用的预设`)
    if (list.some((p) => p.name === finalName)) throw new Error(`已经有名为「${finalName}」的预设，请换一个名字`)
    const now = new Date().toISOString()
    const id = `sp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    delete clean.presetId
    const preset = { id, name: finalName, createdAt: now, updatedAt: now, profile: { ...clean, name: finalName, source: 'user' } }
    writePresetStore([...list, preset])
    return presetSummary(preset)
  })
}
export function renameStylePreset(id, name) {
  const finalName = cleanPresetName(name)
  return withStore(() => {
    const list = readPresetStore()
    const hit = list.find((p) => p.id === String(id || ''))
    if (!hit) throw new Error('该风格预设不存在或已被删除')
    if (list.some((p) => p.id !== hit.id && p.name === finalName)) throw new Error(`已经有名为「${finalName}」的预设，请换一个名字`)
    hit.name = finalName
    hit.profile = { ...hit.profile, name: finalName }
    hit.updatedAt = new Date().toISOString()
    writePresetStore(list)
    return presetSummary(hit)
  })
}
export function deleteStylePreset(id) {
  return withStore(() => {
    const list = readPresetStore()
    const next = list.filter((p) => p.id !== String(id || ''))
    if (next.length === list.length) throw new Error('该风格预设不存在或已被删除')
    writePresetStore(next)
    return { ok: true, removed: String(id) }
  })
}
