/**
 * @dsh-video/figure-kit (Node side) — ships the stylised figure library (`remotion-lib/figure-kit.tsx`: profile people,
 * horses and troops in silhouette / papercut / puppet / ink / flat / stick looks) into Remotion projects, sanitises the
 * director's cast (演员表) into figure looks, picks the film's figure art style, infers per-shot atmosphere / ambience
 * and writes the coder guide.
 *
 * Genre-agnostic by design: the same library draws a Han general, an office worker, a barista, a child in a fairy tale,
 * a lab scientist or a stick figure. Nothing here assumes a historical setting.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GENRE_PROFILES, isHistoricalContent } from './genre-router.js'

export const FIGURE_KIT_TSX_PATH = fileURLToPath(new URL('./remotion-lib/figure-kit.tsx', import.meta.url))

export function readFigureKitSource() {
  return readFileSync(FIGURE_KIT_TSX_PATH, 'utf8')
}

/** Copy the library into `<project>/src/lib/figure-kit.tsx` (imported by AI-coded scenes as '../lib/figure-kit'). */
export function writeFigureKitRemotionLib(projectDir) {
  const libDir = join(resolve(projectDir), 'src', 'lib')
  mkdirSync(libDir, { recursive: true })
  const out = join(libDir, 'figure-kit.tsx')
  if (existsSync(FIGURE_KIT_TSX_PATH)) copyFileSync(FIGURE_KIT_TSX_PATH, out)
  return out
}

export const FIG_STYLES = ['silhouette', 'papercut', 'puppet', 'ink', 'flat', 'stick']
export const FIG_GENDERS = ['male', 'female', 'neutral']
export const FIG_BUILDS = ['average', 'slim', 'heroic', 'stocky', 'child', 'elder']
export const FIG_OUTFITS = ['robe', 'hanfu', 'armor', 'tunic', 'suit', 'casual', 'hoodie', 'dress', 'coat', 'apron', 'lab-coat', 'uniform', 'sport']
export const FIG_HAIR = ['short', 'long', 'bun', 'topknot', 'ponytail', 'bob', 'curly', 'spiky', 'bald']
export const FIG_HEADWEAR = ['none', 'helmet', 'plume-helmet', 'crown', 'mian-crown', 'guan', 'hat', 'straw-hat', 'cap', 'beanie', 'hood', 'headband', 'chef-hat', 'hard-hat', 'veil', 'flower']
export const FIG_PROPS = ['none', 'sword', 'spear', 'halberd', 'staff', 'flag', 'bow', 'shield', 'torch', 'lantern', 'scroll', 'book', 'cup', 'brush', 'fan', 'phone', 'mic', 'laptop', 'tablet', 'briefcase', 'umbrella', 'bag', 'box', 'coffee', 'pen', 'sign', 'wrench']
export const FIG_ACTIONS = [
  'idle', 'walk', 'run', 'march', 'talk', 'point', 'wave', 'raise', 'cheer', 'clap', 'salute', 'bow', 'kneel', 'kneel-sit',
  'sit', 'sit-ground', 'crouch', 'stand-guard', 'drink', 'write', 'read', 'think', 'type', 'present', 'carry', 'push',
  'swing', 'thrust', 'block', 'ready', 'draw-bow', 'throw', 'jump', 'dance', 'fall', 'collapse', 'look-back',
]
export const ATMOSPHERE_KINDS = ['none', 'dust', 'embers', 'snow', 'rain', 'petals', 'leaves', 'bokeh', 'motes', 'fireflies', 'mist']
export const AMBIENCE_KINDS = ['none', 'wind', 'river', 'rain', 'fire', 'crowd', 'night', 'city', 'office', 'forest', 'sea', 'space', 'battle']

// Free-text / Chinese synonyms a director may write instead of the enum values (first match wins)
const OUTFIT_SYNONYMS = [
  [/铠|盔甲|甲胄|战甲|armou?r|knight/i, 'armor'],
  [/汉服|襦裙|曲裾|深衣|hanfu/i, 'hanfu'],
  [/长袍|袍|道袍|僧袍|robe|gown|朝服|龙袍/i, 'robe'],
  [/西装|西服|正装|suit|tuxedo/i, 'suit'],
  [/白大褂|实验服|lab/i, 'lab-coat'],
  [/制服|军装|警服|校服|uniform/i, 'uniform'],
  [/运动|球衣|sport|jersey/i, 'sport'],
  [/围裙|厨师|咖啡师|apron|chef|barista/i, 'apron'],
  [/大衣|风衣|外套|coat|jacket|trench/i, 'coat'],
  [/连衣裙|裙|dress|skirt/i, 'dress'],
  [/短褐|布衣|tunic|农夫|胡服/i, 'tunic'],
  [/卫衣|hoodie|sweatshirt/i, 'hoodie'],
  [/休闲|t恤|casual|shirt/i, 'casual'],
]
const HEADWEAR_SYNONYMS = [
  [/冕|冕旒|mian/i, 'mian-crown'],
  [/红缨|翎|plume/i, 'plume-helmet'],
  [/头盔|兜鍪|胄|helmet/i, 'helmet'],
  [/王冠|皇冠|crown|tiara/i, 'crown'],
  [/发冠|冠|guan/i, 'guan'],
  [/斗笠|草帽|straw/i, 'straw-hat'],
  [/安全帽|hard.?hat/i, 'hard-hat'],
  [/厨师帽|chef/i, 'chef-hat'],
  [/棒球帽|鸭舌帽|cap/i, 'cap'],
  [/毛线帽|beanie/i, 'beanie'],
  [/兜帽|斗篷帽|hood/i, 'hood'],
  [/头巾|抹额|发带|headband|bandana/i, 'headband'],
  [/面纱|头纱|veil/i, 'veil'],
  [/簪花|花环|flower/i, 'flower'],
  [/帽|hat/i, 'hat'],
]
const HAIR_SYNONYMS = [
  [/光头|秃|bald/i, 'bald'],
  [/马尾|ponytail/i, 'ponytail'],
  [/发髻|盘发|丸子|bun/i, 'bun'],
  [/束发|顶髻|topknot/i, 'topknot'],
  [/波波|短发齐|bob/i, 'bob'],
  [/卷发|curly/i, 'curly'],
  [/刺猬|spiky/i, 'spiky'],
  [/长发|披发|long/i, 'long'],
  [/短发|short/i, 'short'],
]
const PROP_SYNONYMS = [
  [/戟|halberd/i, 'halberd'],
  [/剑|刀|sword|sabre|saber|katana/i, 'sword'],
  [/矛|枪|槊|spear|lance|pike/i, 'spear'],
  [/杖|棍|staff|stick/i, 'staff'],
  [/旗|flag|banner/i, 'flag'],
  [/弓|bow/i, 'bow'],
  [/盾|shield/i, 'shield'],
  [/火把|torch/i, 'torch'],
  [/灯笼|提灯|lantern/i, 'lantern'],
  [/竹简|卷轴|诏书|scroll/i, 'scroll'],
  [/书|book/i, 'book'],
  [/咖啡|coffee/i, 'coffee'],
  [/酒杯|杯|爵|cup|goblet|glass/i, 'cup'],
  [/手机|phone|smartphone/i, 'phone'],
  [/话筒|麦克风|mic/i, 'mic'],
  [/笔记本电脑|电脑|laptop/i, 'laptop'],
  [/平板|tablet|ipad/i, 'tablet'],
  [/公文包|briefcase/i, 'briefcase'],
  [/伞|umbrella/i, 'umbrella'],
  [/毛笔|brush/i, 'brush'],
  [/笔|pen|pencil/i, 'pen'],
  [/扇|fan/i, 'fan'],
  [/箱|盒|box|crate|package/i, 'box'],
  [/包|bag|purse/i, 'bag'],
  [/扳手|工具|wrench/i, 'wrench'],
  [/牌|标语|sign|placard/i, 'sign'],
]

function pickEnum(value, allowed, synonyms = [], fallback = undefined) {
  const v = String(value ?? '').trim()
  if (!v) return fallback
  const low = v.toLowerCase()
  if (allowed.includes(low)) return low
  for (const [rx, id] of synonyms) if (rx.test(v)) return id
  return fallback
}
function hexColor(value) {
  const v = String(value ?? '').trim()
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v)
  return m ? `#${m[1].toUpperCase()}` : undefined
}
function slugId(raw, idx) {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return s || `cast${idx + 1}`
}

/**
 * Sanitise one figure look (enum values, #hex colours, short emblem). Accepts the nested `colors` object and the flat
 * colour fields older plans used (top / bottom / accent / capeColor / hairStyle …). Unknown values are dropped.
 */
export function normalizeFigureLook(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const props = src.props && typeof src.props === 'object' ? src.props : {}
  const colorsIn = src.colors && typeof src.colors === 'object' ? src.colors : {}
  const hairIsColor = hexColor(src.hair)
  const out = {
    gender: pickEnum(src.gender, FIG_GENDERS, [[/女|female|woman|girl/i, 'female'], [/男|male|man|boy/i, 'male']]),
    build: pickEnum(src.build, FIG_BUILDS, [[/孩|童|child|kid/i, 'child'], [/老|elder|old/i, 'elder'], [/魁|壮|英武|heroic|muscular/i, 'heroic'], [/胖|敦实|stocky/i, 'stocky'], [/瘦|纤|slim|thin/i, 'slim']]),
    outfit: pickEnum(src.outfit, FIG_OUTFITS, OUTFIT_SYNONYMS),
    hair: pickEnum(hairIsColor ? src.hairStyle : src.hair ?? src.hairStyle ?? src.hair_style, FIG_HAIR, HAIR_SYNONYMS),
    headwear: pickEnum(src.headwear, FIG_HEADWEAR, HEADWEAR_SYNONYMS),
    beard: pickEnum(src.beard, ['none', 'short', 'long'], [[/长须|长髯|long/i, 'long'], [/短须|短髯|胡|beard|short|stubble|胡茬/i, 'short']]),
    cape: src.cape === true || /^(cape|true|披风|斗篷)$/i.test(String(src.cape ?? '')) ? true : /^(scarf|围巾)$/i.test(String(src.cape ?? '')) ? 'scarf' : undefined,
    emblem: src.emblem ? String(src.emblem).trim().slice(0, 2) : undefined,
  }
  const colors = {
    skin: hexColor(colorsIn.skin ?? src.skin),
    hair: hexColor(colorsIn.hair ?? src.hairColor ?? (hairIsColor ? src.hair : undefined)),
    top: hexColor(colorsIn.top ?? src.top),
    bottom: hexColor(colorsIn.bottom ?? src.bottom),
    accent: hexColor(colorsIn.accent ?? src.accent),
    cape: hexColor(colorsIn.cape ?? src.capeColor),
    shoes: hexColor(colorsIn.shoes ?? src.shoes),
    trim: hexColor(colorsIn.trim ?? src.trim),
  }
  for (const k of Object.keys(colors)) if (colors[k] === undefined) delete colors[k]
  if (Object.keys(colors).length) out.colors = colors
  const right = pickEnum(props.right ?? src.prop ?? src.weapon, FIG_PROPS, PROP_SYNONYMS)
  const left = pickEnum(props.left, FIG_PROPS, PROP_SYNONYMS)
  if ((right && right !== 'none') || (left && left !== 'none')) out.props = { ...(right && right !== 'none' ? { right } : {}), ...(left && left !== 'none' ? { left } : {}) }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  return out
}

/** Merge two looks: `primary` wins field by field (colours merged per key). */
export function mergeFigureLooks(primary = {}, secondary = {}) {
  const a = primary && typeof primary === 'object' ? primary : {}
  const b = secondary && typeof secondary === 'object' ? secondary : {}
  const out = { ...b, ...a }
  if (a.colors || b.colors) out.colors = { ...(b.colors || {}), ...(a.colors || {}) }
  if (a.props || b.props) out.props = { ...(b.props || {}), ...(a.props || {}) }
  return out
}

/**
 * Director cast → [{ id, name, role, aliases, look, figure }]. The structured look may come as `figure`, the older `rig`,
 * `appearance` or flat fields. At most `max` members; ids are ASCII slugs (a missing / non-ASCII id becomes cast1…).
 */
export function normalizeCast(rawCast, { max = 8 } = {}) {
  const list = Array.isArray(rawCast) ? rawCast : []
  const out = []
  const used = new Set()
  for (let i = 0; i < list.length && out.length < max; i++) {
    const c = list[i]
    if (!c || typeof c !== 'object') continue
    const name = String(c.name ?? c.displayName ?? '').trim().slice(0, 24)
    let id = slugId(c.id, out.length)
    while (used.has(id)) id = `${id}-${out.length + 1}`
    used.add(id)
    const figSrc = [c.figure, c.rig, c.appearance].find((x) => x && typeof x === 'object') || c
    const aliases = (Array.isArray(c.aliases) ? c.aliases : typeof c.aliases === 'string' ? c.aliases.split(/[,，、]/) : [])
      .map((a) => String(a).trim())
      .filter((a) => a && a !== name)
      .slice(0, 6)
    out.push({
      id,
      name: name || id,
      role: String(c.role ?? '').trim().slice(0, 24) || undefined,
      aliases,
      look: String(typeof c.look === 'string' ? c.look : c.description ?? '').trim().slice(0, 120) || undefined,
      figure: normalizeFigureLook(figSrc),
      ...(c.bankId ? { bankId: String(c.bankId) } : {}),
    })
  }
  return out
}

/** Ids of cast members a shot shows: the director's per-shot list first, otherwise names / aliases found in the shot text. */
export function castIdsForScene(scene = {}, cast = []) {
  const ids = new Set(cast.map((c) => c.id))
  const explicit = Array.isArray(scene.cast) ? scene.cast.map((x) => String(x).trim()) : []
  const hits = []
  for (const x of explicit) {
    const byId = cast.find((c) => c.id === x.toLowerCase())
    const byName = cast.find((c) => c.name === x || (c.aliases || []).includes(x))
    const id = byId?.id || byName?.id
    if (id && !hits.includes(id)) hits.push(id)
  }
  if (hits.length) return hits
  const text = `${scene.title || ''} ${scene.visualBlueprint || ''} ${scene.motionNotes || ''} ${scene.narration || ''}`
  for (const c of cast) {
    const keys = [c.name, ...(c.aliases || [])].filter((k) => k && k.length >= 1)
    if (keys.some((k) => text.includes(k)) && ids.has(c.id) && !hits.includes(c.id)) hits.push(c.id)
  }
  return hits
}

// People / creatures in a shot (any genre) — decides whether the figure library is suggested for it
const PEOPLE_RX = /人物|人群|群众|观众|路人|主角|主人公|男孩|女孩|孩子|小孩|儿童|少年|少女|老人|老者|青年|男子|女子|男人|女人|夫妻|情侣|家人|父亲|母亲|爸爸|妈妈|爷爷|奶奶|学生|老师|医生|护士|工程师|程序员|厨师|店员|顾客|员工|同事|上班族|白领|老板|打工人|火柴人|主播|主持人|讲解员|科学家|工人|农民|警察|士兵|将军|将领|武将|骑兵|大军|军队|兵卒|帝王|皇帝|君王|诸侯|谋士|侍女|美人|姬|王后|公主|王子|英雄|勇士|侠|剑客|舞者|歌手|运动员|球员|选手|骑手|策马|挥戟|挥剑|挥刀|回首|跪|拱手|作揖|举杯|奔跑|行走|走向|转身|招手|拥抱|跳舞|骑马|马匹|战马|骏马|\bperson\b|\bpeople\b|\bcrowd\b|\bman\b|\bwoman\b|\bgirl\b|\bboy\b|\bhorse\b/i
// second/third-person narration ("你扛戟跨过门槛") names the protagonist in story genres, but not in tutorials/data
const PRONOUN_RX = /你|他|她/
const PRONOUN_FREE_GENRES = new Set(['ui-tutorial', 'data-story', 'code-animation', 'science-explainer', 'product-promo'])
const HORSE_RX = /马|骑兵|铁骑|策马|骑手|horse|cavalry|rider/i
const CROWD_RX = /人群|群众|观众|大军|军队|军阵|千军万马|士兵们|兵卒|诸侯|将领们|crowd|army|audience/i

export function sceneShowsPeople(scene = {}, castIds = [], genre = '') {
  if (castIds.length) return true
  const text = `${scene.title || ''} ${scene.visualBlueprint || ''} ${scene.motionNotes || ''}`
  if (PEOPLE_RX.test(text)) return true
  return !PRONOUN_FREE_GENRES.has(String(genre || '')) && PRONOUN_RX.test(`${scene.visualBlueprint || ''} ${scene.motionNotes || ''}`)
}
export function sceneShowsHorse(scene = {}) {
  return HORSE_RX.test(`${scene.visualBlueprint || ''} ${scene.motionNotes || ''}`)
}
export function sceneShowsCrowd(scene = {}) {
  return CROWD_RX.test(`${scene.visualBlueprint || ''} ${scene.motionNotes || ''}`)
}

// ---------------------------------------------------------------------------------------------- figure art style
//
// The figure library is ONE option, never the look of every film. Each film decides its own character style:
//   - wording that names a look the library draws (剪影 / 剪纸 / 皮影 / 水墨 / 扁平 / 火柴人) → that kit style;
//   - wording that names any other character look (Q版萌系, 日系动漫, 绘本手绘, 像素, 写实插画 …) → 'custom': the coder
//     designs its own characters and the library is not offered for people;
//   - nothing said → history films default to silhouette (the director may choose otherwise), every other film to
//     'auto': the coder picks what suits the film (a kit look or its own design).
// The user's pick in the studio (人物画风 · `figureStyleChoice`) beats everything; then the user's own words in the brief,
// then the director's choice, then the genre default.

/** Film-level figure style values: the six kit looks, 'custom' (own character design) and 'auto' (coder decides). */
export const FILM_FIGURE_STYLES = [...FIG_STYLES, 'custom', 'auto']
export const FIGURE_STYLE_ZH = { silhouette: '剪影', papercut: '剪纸', puppet: '皮影', ink: '水墨', flat: '扁平侧身插画', stick: '火柴人', custom: '自定义画风', auto: '未指定（AI 按作品气质决定）' }
/**
 * The studio's 人物画风 options (value, label, hint). The web studio shows the same list (client.js / the panel kit
 * fallback); the tests keep them in sync.
 */
export const FIGURE_STYLE_CHOICES = [
  { value: 'auto', label: 'AI 按作品气质决定（推荐）', hint: '历史题材默认剪影，其它题材由 AI 自己定；需求里写明的画风照样有效' },
  { value: 'silhouette', label: '剪影', hint: '逆光黑色轮廓加金边轮廓光，适合历史、史诗、战争' },
  { value: 'papercut', label: '剪纸', hint: '红纸镂空的窗花质感，适合民俗、节日' },
  { value: 'puppet', label: '皮影', hint: '半透明彩色皮影，带关节铆钉和操纵杆，适合戏曲、传说' },
  { value: 'ink', label: '水墨', hint: '墨色晕染，适合古诗词、山水' },
  { value: 'flat', label: '扁平插画', hint: '彩色扁平侧身人物，适合生活、产品、科普' },
  { value: 'stick', label: '火柴人', hint: '线条小人，适合搞笑段子、教程、简笔故事' },
  { value: 'custom', label: '自定义（AI 自己设计角色）', hint: 'Q版、动漫、绘本、像素等人物库没有的画风，在下面写清楚想要的样子' },
]

// wording that names a look the library draws (first match wins)
const KIT_STYLE_CUES = [
  [/皮影|影戏|shadow puppet/i, 'puppet'],
  [/剪纸|窗花|papercut|paper-cut/i, 'papercut'],
  [/水墨|写意|国画|ink wash/i, 'ink'],
  [/火柴人|简笔小人|stickman|stick figure/i, 'stick'],
  [/剪影|逆光轮廓|silhouette/i, 'silhouette'],
  [/扁平|flat illustration|\bmbe\b/i, 'flat'],
]
// wording that names a character look the library does not draw → the coder designs its own characters (label = note)
const CUSTOM_STYLE_CUES = [
  [/q版|萌系|大头娃娃|chibi/i, 'Q版萌系'],
  [/二次元|动漫|日漫|\banime\b/i, '日系动漫'],
  [/美漫|美式卡通/i, '美式卡通'],
  [/绘本|蜡笔画|蜡笔风|水彩风|水彩画|水彩插画|手绘风|手绘画风|手绘动画|手绘人物|手绘插画/i, '绘本手绘'],
  [/年画/, '年画'],
  [/像素风|像素画|像素游戏|pixel art/i, '像素风'],
  [/低多边形|low.?poly/i, '低多边形'],
  [/黏土|粘土|定格动画|claymation/i, '黏土定格'],
  [/三维卡通|3d\s*卡通|c4d/i, '三维卡通'],
  [/工笔|国风插画|国潮/i, '国风插画'],
  [/写实风|写实画风|写实人物|写实插画|realistic/i, '写实插画'],
  [/漫画|\bmanga\b|\bcomic/i, '漫画'],
  [/卡通|cartoon/i, '卡通'],
]

// The built-in genre labels (e.g. 「火柴人 / 角色故事动画」 for every story / fairy-tale / comedy film) describe a whole
// category, not a style the user asked for: they never decide the look of people.
const BUILTIN_GENRE_LABELS = GENRE_PROFILES.map((g) => String(g?.label || '')).filter(Boolean)
function withoutBuiltinLabels(text = '') {
  let t = String(text || '')
  for (const label of BUILTIN_GENRE_LABELS) t = t.split(label).join(' ')
  return t
}

function styleCue(text = '') {
  const t = withoutBuiltinLabels(text)
  for (const [rx, id] of KIT_STYLE_CUES) if (rx.test(t)) return id
  return CUSTOM_STYLE_CUES.some(([rx]) => rx.test(t)) ? 'custom' : ''
}

/** Label of the character look the text asks for when the library cannot draw it ('' when none). */
export function inferFigureStyleNote(text = '') {
  const t = withoutBuiltinLabels(text)
  for (const [rx, label] of CUSTOM_STYLE_CUES) if (rx.test(t)) return label
  return ''
}

export function normalizeFigureStyleNote(value) {
  return String(value ?? '').replace(/["“”'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40)
}

/**
 * The user's own 人物画风 pick carried by a run request: `figureStyleChoice` / `figureStyleChoiceNote` (studio form, run
 * body, script.json) or `figureStyle` / `figureStyleNote` (MCP tool arguments). null when the request does not say.
 * Pass run requests only: on a script, `figureStyle` is the film's resolved style, not a pick.
 */
export function figureStyleChoiceFrom(src = {}) {
  if (!src || typeof src !== 'object') return null
  const fromStudio = String(src.figureStyleChoice ?? '').trim() !== ''
  const raw = fromStudio ? src.figureStyleChoice : src.figureStyle
  const style = normalizeFigureStyle(raw)
  if (!style) return null
  const noteRaw = fromStudio ? src.figureStyleChoiceNote : src.figureStyleNote
  return { style, note: noteRaw === undefined || noteRaw === null ? undefined : normalizeFigureStyleNote(noteRaw) }
}

/** Store a run request's 人物画风 pick on the script; without one the project's saved pick stays. Returns the script. */
export function applyFigureStyleChoice(script, src) {
  const c = figureStyleChoiceFrom(src)
  if (!c || !script || typeof script !== 'object') return script
  script.figureStyleChoice = c.style
  if (c.note !== undefined) {
    if (c.note) script.figureStyleChoiceNote = c.note
    else delete script.figureStyleChoiceNote
  }
  return script
}

/**
 * Name of a custom character style: the user's own words in the studio, then the director's note, then a style word
 * in the brief ('' for every other style).
 */
export function resolveFigureStyleNote({ style = '', chosen = '', chosenNote = '', note = '', text = '' } = {}) {
  if (style !== 'custom') return ''
  if (normalizeFigureStyle(chosen) === 'custom' && normalizeFigureStyleNote(chosenNote)) return normalizeFigureStyleNote(chosenNote)
  return normalizeFigureStyleNote(note) || inferFigureStyleNote(text) || ''
}

/** Director prompt line for a character style the user picked in the studio ('' when the film leaves it open). */
export function buildFigureStylePlanDirective(script = {}, { planJson = true } = {}) {
  const style = normalizeFigureStyle(script?.figureStyleChoice)
  if (!style || style === 'auto') return ''
  const note = style === 'custom' ? normalizeFigureStyleNote(script?.figureStyleChoiceNote) : ''
  const name = style === 'custom' ? note || '自定义画风' : FIGURE_STYLE_ZH[style]
  const own = style === 'custom' ? '（人物库没有的画风，主程会自己设计角色）' : ''
  const json = planJson ? `；JSON 的 figureStyle 填 "${style}"${note ? `，figureStyleNote 填「${note}」` : ''}` : ''
  return `\n\n【人物画风：用户已指定「${name}」${own}，全片统一，必须照用】分镜描述${planJson ? '与演员表' : ''}里的人物、动物外形都按这种画风来写${json}。`
}

/**
 * The film's figure (character) art style: one of the six kit looks, 'custom' or 'auto'.
 * chosen = the user's pick in the studio (人物画风): any pick but 'auto' decides. userText = the user's own brief
 * (topic / goal / title): a style named there wins next. Then the director's explicit choice (`current`), then style
 * words in `text` (genre label, director notes), then the genre default: history films and history-themed MVs →
 * silhouette, every other film → 'auto'. Never one look for every genre.
 */
export function inferFigureStyle({ genre = '', text = '', userText = '', current = '', chosen = '' } = {}) {
  const picked = normalizeFigureStyle(chosen)
  if (picked && picked !== 'auto') return picked
  const fromUser = styleCue(userText)
  if (fromUser) return fromUser
  const given = normalizeFigureStyle(current)
  if (given && given !== 'auto') return given
  const fromNotes = styleCue(text)
  if (fromNotes) return fromNotes
  if (given === 'auto') return 'auto'
  const g = String(genre || '').toLowerCase()
  const all = withoutBuiltinLabels(`${userText} ${text}`)
  if (g === 'history-theater') return 'silhouette'
  if ((g === 'mv-lyric' || g === 'other' || g === 'brand-story' || !g) && isHistoricalContent(all)) return 'silhouette'
  return 'auto'
}

export function normalizeFigureStyle(value) {
  return pickEnum(value, FILM_FIGURE_STYLES, [[/剪影/, 'silhouette'], [/剪纸/, 'papercut'], [/皮影/, 'puppet'], [/水墨/, 'ink'], [/扁平/, 'flat'], [/火柴/, 'stick'], [/自定义|自己画|custom/i, 'custom'], [/自动|未指定|auto/i, 'auto']])
}

// Keyword cues read only the picture description (title / visualBlueprint / motionNotes), never the narration, and
// use whole words: a single 雪 / 沙 / 风 / 海 also hides in 雪碧, 沙发, 风格, 上海 — those must not change the shot.
const RAIN_WORD = String.raw`\brain(?:y|ing|drop|drops|fall|storm)?\b`
const ATMOSPHERE_RULES = [
  ['snow', /下雪|大雪|小雪|飞雪|风雪|雪花|雪地|雪山|雪原|白雪|雪景|雪夜|\bsnow/i],
  ['rain', new RegExp(`下雨|雨中|雨夜|大雨|小雨|细雨|暴雨|骤雨|雨水|雨滴|雨幕|烟雨|淋雨|${RAIN_WORD}`, 'i')],
  ['petals', /花瓣|樱花|落英|桃花|飞花|petal|blossom/i],
  ['leaves', /落叶|秋叶|枫叶|黄叶|fallen leaves|autumn/i],
  ['embers', /火星|余烬|篝火|营火|战火|烽火|火光|烈焰|火海|灯焰|火把|ember|bonfire/i],
  ['fireflies', /萤火|夏夜|firefl/i],
  ['mist', /雾|云海|\bmist|\bfog|\bhaze/i],
  ['dust', /尘|风沙|黄沙|沙尘|沙漠|沙场|戈壁|\bdust|sandstorm|desert/i],
  ['bokeh', /霓虹|夜景|派对|舞台|演唱会|灯海|\bneon|bokeh|\bparty\b|concert/i],
  ['motes', /数据|代码|芯片|实验室|宇宙|太空|星空|粒子|\bdata\b|\bcode\b|\blab\b|outer space|galaxy/i],
]
const AMBIENCE_RULES = [
  ['battle', /厮杀|交锋|鏖战|激战|血战|混战|交战|两军|杀声|喊杀|冲锋陷阵|骑兵冲锋|战场|敌军|敌阵|冲阵|破阵|短兵相接|千军万马|金戈铁马|刀光剑影|兵器交击|秦兵|秦军|汉兵|汉军|楚兵|楚军|骑队|精骑|battlefield|\bcombat/i],
  ['rain', new RegExp(`下雨|雨中|雨夜|大雨|小雨|细雨|暴雨|骤雨|雨声|雨滴|雨幕|淋雨|${RAIN_WORD}`, 'i')],
  ['river', /江面|江水|江边|江畔|大江|乌江|长江|黄河|河面|河水|河边|河畔|溪流|溪水|小溪|山涧|瀑布|水面|水流|水纹|渡口|渡船|渡河|渡江|扁舟|小舟|舟头|船头|船上|船舷|桨叶|撑篙|划船|摇橹|\briver|\bstream\b|waterfall|\bboat/i],
  ['sea', /大海|海面|海浪|海边|海岸|海滩|浪花|浪涛|海风|沙滩|港口|码头|\bsea\b|\bocean|\bwaves?\b|\bbeach/i],
  ['fire', /篝火|营火|火堆|壁炉|灯焰|油灯|炉火|火把|fireplace|campfire|bonfire/i],
  ['crowd', /人群|人流|人潮|群众|观众|宴会|宴席|酒宴|集市|闹市|会场|大军|军阵|欢呼|喧闹|咖啡馆|咖啡店|餐厅|饭馆|酒吧|\bcafe\b|\brestaurant|\bcrowd|\baudience|\bmarket\b|cheering/i],
  ['city', /城市|街道|车流|地铁|写字楼|马路|街头|\bcity\b|\bstreet|\btraffic/i],
  ['office', /办公室|会议室|教室|实验室|工作室|自习室|图书馆|\boffice\b|classroom|\blibrary/i],
  ['forest', /森林|树林|山林|竹林|林间|鸟鸣|\bforest|\bwoods\b|birdsong/i],
  ['space', /太空|宇宙|星系|飞船|空间站|outer space|deep space|galaxy|spaceship/i],
  ['night', /夜晚|深夜|夜色|夜空|月光|月色|月下|星空|虫鸣|蝉鸣|蛙声|\bnight\b|moonlight/i],
  ['wind', /狂风|大风|寒风|朔风|北风|风沙|风雪|风声|风吹|风卷|风把|受风|迎风|猎猎|旗面|旌旗|呼啸|旷野|原野|草原|大漠|荒原|山巅|高原|戈壁|\bwind\b|\bwindy\b|desert|prairie/i],
]
// Explainers, tutorials, data and product films get an environmental bed only when the director asks for one
const AMBIENCE_OPT_IN_GENRES = new Set(['ui-tutorial', 'data-story', 'code-animation', 'science-explainer', 'product-promo'])

export function normalizeAtmosphere(value) {
  return pickEnum(value, ATMOSPHERE_KINDS, [[/雪/, 'snow'], [/雨/, 'rain'], [/花瓣|樱/, 'petals'], [/落叶|枫/, 'leaves'], [/火星|余烬/, 'embers'], [/萤/, 'fireflies'], [/雾/, 'mist'], [/尘|沙/, 'dust'], [/霓虹|光斑/, 'bokeh'], [/粒子|数据/, 'motes'], [/无/, 'none']])
}
export function normalizeAmbience(value) {
  return pickEnum(value, AMBIENCE_KINDS, [[/战|厮杀/, 'battle'], [/雨/, 'rain'], [/江|河|水/, 'river'], [/海|浪/, 'sea'], [/火/, 'fire'], [/人群|宴|集市/, 'crowd'], [/城市|街/, 'city'], [/办公|室内|教室/, 'office'], [/林|鸟/, 'forest'], [/太空|宇宙/, 'space'], [/夜/, 'night'], [/风/, 'wind'], [/无/, 'none']])
}

/**
 * Fill per-shot visual metadata before the audio / coding stages: atmosphere (particles), ambience (sound bed),
 * castIds (who is on screen) and the film's figure art style. Director values win; inferred values only fill gaps.
 * Mutates and returns `script`.
 */
export function enrichScenesForVisuals(script = {}) {
  const cast = Array.isArray(script.cast) ? script.cast : []
  const genre = String(script.genre || '')
  for (const sc of Array.isArray(script.scenes) ? script.scenes : []) {
    if (!sc || typeof sc !== 'object') continue
    sc.atmosphere = normalizeAtmosphere(sc.atmosphere) || inferAtmosphere(sc, genre)
    sc.ambience = normalizeAmbience(sc.ambience) || inferAmbience(sc, genre)
    const ids = castIdsForScene({ ...sc, cast: Array.isArray(sc.castIds) ? sc.castIds : undefined }, cast)
    if (ids.length) sc.castIds = ids
    else delete sc.castIds
  }
  const userText = `${script.topic || ''} ${script.goal || ''} ${script.displayTitle || script.title || ''}`
  const notesText = `${script.genreLabel || ''} ${script.directorNotes || ''}`
  script.figureStyle = inferFigureStyle({ genre, current: script.figureStyle, chosen: script.figureStyleChoice, userText, text: notesText })
  const note = resolveFigureStyleNote({ style: script.figureStyle, chosen: script.figureStyleChoice, chosenNote: script.figureStyleChoiceNote, note: script.figureStyleNote, text: `${userText} ${notesText}` })
  if (note) script.figureStyleNote = note
  else delete script.figureStyleNote
  return script
}

/** Weather / air particles that suit a shot (content-driven; most genres default to none). */
export function inferAtmosphere(scene = {}, genre = '') {
  const given = pickEnum(scene.atmosphere, ATMOSPHERE_KINDS)
  if (given) return given
  const text = `${scene.title || ''} ${scene.visualBlueprint || ''} ${scene.motionNotes || ''}`
  for (const [id, rx] of ATMOSPHERE_RULES) if (rx.test(text)) return id
  return genre === 'history-theater' ? 'dust' : 'none'
}

/**
 * Environmental sound bed for a shot (content-driven; none when nothing in the picture makes a sound). Explainer,
 * tutorial, data and product genres keep silence unless the director chose a bed.
 */
export function inferAmbience(scene = {}, genre = '') {
  const given = pickEnum(scene.ambience, AMBIENCE_KINDS)
  if (given) return given
  if (AMBIENCE_OPT_IN_GENRES.has(String(genre || ''))) return 'none'
  const text = `${scene.title || ''} ${scene.visualBlueprint || ''} ${scene.motionNotes || ''}`
  for (const [id, rx] of AMBIENCE_RULES) if (rx.test(text)) return id
  return 'none'
}

// ---------------------------------------------------------------------------------------------- descriptions

const ZH = {
  gender: { male: '男', female: '女' },
  build: { slim: '清瘦', heroic: '魁梧', stocky: '敦实', child: '孩童', elder: '年长' },
  outfit: { robe: '长袍', hanfu: '汉服', armor: '铠甲', tunic: '短褐布衣', suit: '西装', casual: '休闲装', hoodie: '卫衣', dress: '连衣裙', coat: '大衣', apron: '围裙工装', 'lab-coat': '白大褂', uniform: '制服', sport: '运动装' },
  hair: { short: '短发', long: '长发', bun: '发髻', topknot: '束发', ponytail: '马尾', bob: '短波波头', curly: '卷发', spiky: '刺猬头', bald: '光头' },
  headwear: { helmet: '头盔', 'plume-helmet': '红缨头盔', crown: '王冠', 'mian-crown': '冕旒', guan: '发冠', hat: '礼帽', 'straw-hat': '斗笠', cap: '鸭舌帽', beanie: '毛线帽', hood: '兜帽', headband: '头巾', 'chef-hat': '厨师帽', 'hard-hat': '安全帽', veil: '面纱', flower: '簪花' },
  prop: { sword: '剑', spear: '长矛', halberd: '长戟', staff: '长杖', flag: '旗帜', bow: '弓', shield: '盾', torch: '火把', lantern: '灯笼', scroll: '卷轴', book: '书', cup: '酒杯', brush: '毛笔', fan: '扇子', phone: '手机', mic: '话筒', laptop: '笔记本电脑', tablet: '平板', briefcase: '公文包', umbrella: '伞', bag: '包', box: '箱子', coffee: '咖啡杯', pen: '笔', sign: '标牌', wrench: '扳手' },
}

/** Short Chinese appearance line from a figure look (character-bank description / AI image prompts). */
export function describeFigureZh(fig = {}) {
  if (!fig || typeof fig !== 'object') return ''
  const parts = []
  if (ZH.gender[fig.gender]) parts.push(ZH.gender[fig.gender])
  if (ZH.build[fig.build]) parts.push(ZH.build[fig.build])
  if (ZH.outfit[fig.outfit]) parts.push(`穿${ZH.outfit[fig.outfit]}`)
  if (ZH.hair[fig.hair]) parts.push(ZH.hair[fig.hair])
  if (ZH.headwear[fig.headwear]) parts.push(`戴${ZH.headwear[fig.headwear]}`)
  if (fig.beard === 'long') parts.push('长须')
  else if (fig.beard === 'short') parts.push('短须')
  if (fig.cape === true) parts.push('披风')
  else if (fig.cape === 'scarf') parts.push('围巾')
  const held = [fig.props?.right, fig.props?.left].map((p) => ZH.prop[p]).filter(Boolean)
  if (held.length) parts.push(`手持${held.join('、')}`)
  return parts.join('，')
}

function describeFigure(fig = {}) {
  const parts = []
  if (fig.gender) parts.push(fig.gender)
  if (fig.build && fig.build !== 'average') parts.push(fig.build)
  if (fig.outfit) parts.push(fig.outfit)
  if (fig.headwear && fig.headwear !== 'none') parts.push(fig.headwear)
  if (fig.hair) parts.push(`hair:${fig.hair}`)
  if (fig.cape) parts.push(fig.cape === true ? 'cape' : fig.cape)
  if (fig.beard && fig.beard !== 'none') parts.push(`beard:${fig.beard}`)
  if (fig.props?.right) parts.push(`R:${fig.props.right}`)
  if (fig.props?.left) parts.push(`L:${fig.props.left}`)
  if (fig.colors?.top) parts.push(`top:${fig.colors.top}`)
  if (fig.colors?.cape) parts.push(`cape:${fig.colors.cape}`)
  return parts.join(' ')
}

const KIT_STYLE_LINE = {
  silhouette: '实色人形 + `accent` 披风/盔缨/旗帜点缀色 + `rim` 轮廓光，适合逆光、夕阳、史诗、氛围镜头',
  papercut: '整张纸镂空纹样 + 纸片投影，`color` 设纸色',
  puppet: '半透明彩色皮料 + 镂空花纹 + 关节铆钉 + 操纵杆，放在暖色光幕前',
  ink: '毛边墨色人形，宣纸底',
  flat: '服装配色 + 一个眼点的侧身插画人物',
  stick: '线条人形',
}

/**
 * Coder-prompt section about people (genre-agnostic) + the film's cast. The film's figure style decides how the
 * library is offered: a kit look → use the library in that style; 'custom' → design own characters, do not substitute
 * the library; 'auto' → the coder decides (library or own design). `combat` adds the weapon-contact timing line
 * (history / fight content only — a product or tutorial prompt never mentions blades).
 */
export function buildFigureKitCoderGuide({ cast = [], combat = false, figureStyle = 'auto', figureStyleNote = '' } = {}) {
  const q = '`'
  const film = FILM_FIGURE_STYLES.includes(figureStyle) ? figureStyle : 'auto'
  const kit = FIG_STYLES.includes(film) ? film : ''
  const note = normalizeFigureStyleNote(figureStyleNote)
  const styleAttr = kit ? `style="${kit}"` : `style="${FIG_STYLES.join('|')}"`
  const lines = []
  if (kit) {
    lines.push(`- **【人物画风（全片统一）：${FIGURE_STYLE_ZH[kit]}】** 人物、马匹、军阵用人物库 ${q}from '../lib/figure-kit'${q} 的 ${q}${styleAttr}${q} 最稳（${KIT_STYLE_LINE[kit]}）；个别镜头需要人物库做不到的表现（正面对镜头、表情特写、库里没有的动物或姿势）时可以自己画，但要和全片画风一致。`)
  } else if (film === 'custom') {
    lines.push(`- **【人物画风（全片统一）：${note || '自定义画风（见导演备注）'}】** 这是人物库没有的画风：请你自己设计角色并逐镜绘制——同一角色每个镜头的脸型、发型、服装、配色保持一致，比例协调、关节连贯、动作清楚；**不要用人物库的侧身人形代替**（人物库只适合与本片画风不冲突的极远景元素）。`)
  } else {
    lines.push(`- **【人物画风：本片未指定，由你按作品气质决定，全片统一】** 先想清楚这部片的人物应该长什么样（扁平插画、Q版、绘本、剪影、线条小人……跟着题材和氛围走，不要每部片都一个样）。人物库 ${q}from '../lib/figure-kit'${q} 现成有 6 种画风（剪影 silhouette · 剪纸 papercut · 皮影 puppet · 水墨 ink · 扁平侧身 flat · 火柴人 stick，都是侧身人形）：合适就用它，省事也稳；作品需要别的画风、正面对镜头或表情特写的人物时，自己设计绘制。`)
  }
  if (film !== 'custom') {
    lines.push(
      `  - 人物库用法：${q}<Figure look={castLook(scene, 'id')} x={…} y={脚底地面Y} height={站立身高px} facing={1|-1} action="…" ${styleAttr} />${q}（侧身人形，没有会乱动的写实五官，关节由重叠的形体连接、不会错位；自带关节动作、服装发型头饰道具，披风/头发/衣摆/宽袖随风与速度摆动，逐帧确定）。silhouette / ink / papercut 用 ${q}color${q} 设主色，${q}light={角度}${q}（0 = 光从右来，-90 = 正上方）让轮廓光朝向画面里的光源。`,
      `  - 动作 action：${FIG_ACTIONS.join(' · ')}（salute = 拱手作揖，bow = 鞠躬，kneel = 单膝跪，kneel-sit = 跪坐，sit = 坐椅子并用 ${q}seat${q} 给座面高 px，ready = 双手持兵器待战/横戟横枪，look-back = 回头）。跪、坐类不给 ${q}start${q} 时第 0 帧起就保持该姿势；鞠躬、挥砍、饮酒、倒地等一次性动作用 ${q}start${q} / ${q}duration${q}（帧）控制，结束后保持最后姿势。`,
      `  - 一镜内的动作序列：${q}script={[{ action: 'walk', from: 0, dur: 40, dx: 260 }, { action: 'kneel', from: 40, dur: 20 }]}${q}（dx = 这一段水平位移 px，步频自动匹配位移、脚不打滑，动作之间自动衔接）；单个走动用 ${q}action="walk" travel={位移px} duration={帧数}${q}；上半身叠加：${q}action="walk" upper="talk"${q}；${q}wind${q}（-1~1）让披风头发往后飘。`,
      `  - 外观 look：gender male|female · build average|slim|heroic|stocky|child|elder · outfit ${FIG_OUTFITS.join('|')} · hair ${FIG_HAIR.join('|')} · headwear ${FIG_HEADWEAR.join('|')} · beard none|short|long · cape true · props { right, left }（${FIG_PROPS.filter((p) => p !== 'none').join('|')}）· colors { top, bottom, accent, cape, skin, hair, shoes }（#hex）· emblem（旗面一个字）。`,
      `  - 马：${q}<Horse x y height={与同景深人物相同的数} gait="idle|walk|trot|canter|gallop|rear" rider={castLook(scene, 'id')} riderAction="raise|swing|thrust|point|wave|draw-bow" travel={px} duration={帧} dust ${styleAttr} />${q}（马按真实比例画，鬃毛马尾随速度飘动）；军队 / 人群：${q}<Troop x y width height rows perRow kind="spear|infantry|archer|flag|cavalry|crowd|audience" action="march|idle|cheer|run|walk" haze="远处背景色" emblem="旗面字" ${styleAttr} />${q}（自动纵深缩放、雾化与动作错拍）。`,
      `  - 景别：特写/近景把 height 设大（例如 1600，脚底 y 可以在画面下方以外，只露出上半身）；中景人物约占画高 45–70%；远景 10–30%。`,
    )
  }
  if (combat) {
    lines.push(film === 'custom'
      ? `  - 兵刃接触：用 ${q}computeStrikeSwing(scene, frame)${q} 的 swing / recoil 驱动你画的手臂与兵器，挥砍恰好在接触帧命中并在接触后回弹；火星、刀光只画在兵器相交处。`
      : `  - 兵刃接触：${q}action="swing"${q}（或 thrust / block）配 ${q}strike={computeStrikeSwing(scene, frame)}${q}，挥砍恰好在接触帧命中并在接触后回弹（自己画人物时同样用 computeStrikeSwing 的 swing / recoil 驱动手臂与兵器）；火星、刀光只画在兵器相交处。`)
  }
  lines.push(
    `  - 人物要有动作（说话、行走、呼吸、挥动），不要整镜僵立；自己画人物时（任何画风）要达到成片水准：比例协调、关节连贯、姿态自然、服装道具清楚，表情简洁统一（不画诡异的写实五官），不要用几个方块或椭圆拼"纸片人"；库里没有的动物（猫、狗、鸟）用 SVG 分组画并按 frame 做关节动作。`,
  )
  if (Array.isArray(cast) && cast.length) {
    lines.push(film === 'custom'
      ? `  - **演员表（全片统一形象：按这里的服装、发型、配色设计角色，每个镜头保持一致；${q}scene.cast${q} 里有同样的数据）**：`
      : `  - **演员表（全片统一形象：用人物库时用 ${q}castLook(scene, 'id')${q} 取外观；自己画时按这里的服装、发型、配色画，每个镜头保持一致）**：`)
    for (const c of cast) {
      const fig = c.figure || c.rig || {}
      lines.push(`     · ${q}${c.id}${q} = ${c.name}${c.role ? `（${c.role}）` : ''}${c.look ? `：${c.look}` : ''}${describeFigure(fig) ? ` [${describeFigure(fig)}]` : ''}`)
    }
  }
  return lines.join('\n')
}
