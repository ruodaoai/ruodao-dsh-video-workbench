/**
 * Meta-prompt guard: production instructions (director notes, "本视频要求…", style / camera / BGM directives)
 * must NEVER be spoken or rendered on screen. This module
 *   1. splits a raw user / AI-polished brief into { displayTitle, directorNotes, topic },
 *   2. detects & strips meta-instruction sentences,
 *   3. scrubs a script right before it is written / rendered (`sanitizeScriptForRender`).
 */

const META_CLAUSE_RES = [
  /(?:^|[，。；：、\s])(?:请你?|麻烦|务必|切记)[:：]?\s*(?:你|为我|帮我|制作|生成|创作|设计|拍摄|输出|做成|按照|严格)/,
  /(?:本视频|该视频|这条视频|本片|整支视频|整个视频|视频整体|整体视频)(?:要求|需要|须|必须|应当|应该|应|采用|风格|基调|节奏|时长|开头|结尾)/,
  /(?:分镜指令|导演指令|导演备注|制作要求|生成要求|视频要求|画面风格(?:要求)?|镜头语言(?:要求)?|创作指令|制作说明|画面要求|配音要求|字幕要求|音乐要求|转场要求|节奏要求|风格要求|旁白风格|视觉方案|拍摄要求)\s*[:：]/,
  /^\s*(?:\d+|[一二三四五六七八九十]+)\s*[.、．)）]\s*(?:开场|结尾|收尾|画面|配音|节奏|镜头|字幕|音乐|旁白|配乐|转场|风格|素材|时长|分镜|目标|章节)/,
  /^\s*(?:开场|结尾|收尾|中段|画面风格|节奏基调|镜头语言|旁白风格|配乐|字幕要求|黄金\s*3\s*秒|叙事视角)[:：]/,
  /(?:黄金\s*3\s*秒|三秒钩子|开场钩子|结尾号召)(?:[，,：:]|要|需|设置)/,
  /严禁(?:出现|使用|添加|输出|加入|上屏|配音|虚构)/,
]

const BRIEF_MARKER_RES = [
  /【\s*导演备注[^】]*】/,
  /【\s*(?:内容要点|制作要求|视觉方案|导演指令|目标时长)[^】]*】/,
]

const SENTENCE_SPLIT_RE = /(?<=[。！？；!?;\n])/

const normForOverlap = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[\s，。！？；：、,.!?;:"“”'‘’()（）【】\[\]《》\-—_·|｜]+/g, '')

/** True when the text is (or mostly consists of) a production directive instead of audience content. */
export function isMetaInstructionText(text) {
  const s = String(text || '').trim()
  if (!s) return false
  const sentences = s.split(SENTENCE_SPLIT_RE).map((x) => x.trim()).filter(Boolean)
  if (sentences.length === 0) return false
  const metaHits = sentences.filter((sen) => META_CLAUSE_RES.some((re) => re.test(sen))).length
  if (metaHits === 0) return false
  return metaHits >= Math.max(1, Math.ceil(sentences.length * 0.34)) || s.length > 90
}

function sentenceIsMeta(sentence) {
  return META_CLAUSE_RES.some((re) => re.test(sentence))
}

/** Drop meta-instruction sentences; keep the audience-facing remainder. */
export function stripMetaInstructions(text) {
  const s = String(text || '').trim()
  if (!s) return ''
  const keep = s
    .split(SENTENCE_SPLIT_RE)
    .map((x) => x.trim())
    .filter((sen) => sen && !sentenceIsMeta(sen))
  return keep.join('').replace(/\s{2,}/g, ' ').trim()
}

/** Fraction of `text` (normalized) covered by long contiguous runs copied from `brief`. */
export function briefOverlapRatio(text, brief, windowSize = 14) {
  const t = normForOverlap(text)
  const b = normForOverlap(brief)
  if (t.length < windowSize || b.length < windowSize * 2) return 0
  const covered = new Array(t.length).fill(false)
  for (let i = 0; i + windowSize <= t.length; i++) {
    if (b.includes(t.slice(i, i + windowSize))) {
      for (let k = i; k < i + windowSize; k++) covered[k] = true
    }
  }
  return covered.filter(Boolean).length / t.length
}

/** True when `text` is largely a verbatim copy of any registered brief. */
export function leaksBrief(text, briefs = []) {
  return briefs.some((b) => b && briefOverlapRatio(text, b) >= 0.55)
}

const IMPERATIVE_PREFIX_RE = /^(?:请你?|麻烦|帮我|给我|我想|我要|想要)?\s*(?:制作|生成|创作|拍摄|做|产出|设计|出)(?:一部|一条|一个|一段|一支|一份)?\s*(?:\d+\s*(?:秒|分钟|分)(?:左右)?(?:的)?)?\s*(?:不限制时长的|不限时长的|完整的|详细的|高质量的|专业的)?/

/** Short, audience-safe title (≤ 18 chars) derived from an arbitrary brief; '' when none can be trusted. */
export function deriveDisplayTitle(brief, fallback = '') {
  const raw = String(brief || '').trim()
  if (!raw) return fallback
  const marked = raw.match(/【\s*作品标题[^】]*】\s*([^\n【]{2,28})/)
  if (marked) return marked[1].trim()
  const book = raw.match(/《([^《》]{2,28})》/)
  if (book) return book[1].trim()
  const labeled = raw.match(/(?:标题|作品名|片名|主题|题目)\s*[:：]\s*([^\n，。；;]{2,28})/)
  if (labeled && !isMetaInstructionText(labeled[1])) return labeled[1].trim()
  const firstSentence = raw.split(/[。！？\n；;]/)[0].trim()
  let t = firstSentence.replace(IMPERATIVE_PREFIX_RE, '').replace(/^(?:关于|有关)/, '').trim()
  t = t.replace(/(?:的)?(?:短视频|视频|动画|宣传片|纪录片|教学片|大片|短片)$/, (m) => m.replace(/^的/, '')).trim()
  const firstClause = t.split(/[，,：:、]/)[0].trim()
  const candidate = firstClause.length >= 2 ? firstClause : t
  if (candidate && !isMetaInstructionText(candidate) && candidate.length <= 26) return candidate.slice(0, 22)
  if (candidate && !isMetaInstructionText(candidate)) return candidate.slice(0, 18)
  return fallback
}

/**
 * Split any raw brief into audience-safe fields.
 *   topic   → short subject (≤ 40 chars), safe to use as a fallback title / topic
 *   title   → short audience-safe title
 *   directorNotes → the full brief, kept ONLY as AI-readable notes (never narrated, never rendered)
 */
function parseBriefSections(raw) {
  const grab = (label) => {
    const re = new RegExp('【\\s*' + label + '[^】]*】\\s*([\\s\\S]*?)(?=【|$)')
    const m = String(raw || '').match(re)
    return m ? m[1].trim() : ''
  }
  const parsedGenreLabel = grab('体裁').split(/\n/)[0].trim()
  const parsedDurationLine = grab('目标时长').split(/\n/)[0].trim()
  return {
    title: grab('作品标题').split(/\n/)[0].trim(),
    genre: parsedGenreLabel,
    genreLabel: parsedGenreLabel,
    durationLine: parsedDurationLine,
    outline: grab('内容要点'),
    notes: grab('导演备注'),
    hasMarkers: /【\s*(?:作品标题|体裁|目标时长|内容要点|导演备注)/.test(String(raw || '')),
  }
}

const BOILERPLATE_GOALS = new Set([
  '带有文案、配音、音效、动效、音乐与字幕的完整成片',
  '呈现具备动态视觉排版、空间运镜、粒子光效、节拍音效、配乐与配音的完整成片',
])

/**
 * A stringified missing value ("undefined" / "null") is never brief content. An old client bug stored briefs such as
 * 「【一句话】undefined」 in script.json — drop the whole value, or every 【marker】 whose value is only that (on its own
 * line, or inline before the next 【marker】 when the brief was flattened to one line).
 */
export function dropMissingBriefValues(text) {
  const s = String(text ?? '')
  if (/^\s*(?:undefined|null)\s*$/i.test(s)) return ''
  return s
    .replace(/^[ \t]*【[^】\r\n]{1,20}】[ \t]*(?:undefined|null)[ \t]*(?:\r?\n|$)/gim, '')
    .replace(/【[^】\r\n]{1,20}】[ \t]*(?:undefined|null)[ \t]*(?=【|\r?\n|$)/gi, '')
}

const BRIEF_TEXT_FIELDS = ['goal', 'userPrompt', 'polishedTopic', 'topic', 'title', 'displayTitle', 'directorNotes', 'genre', 'genreLabel']
function withoutMissingBriefValues(obj) {
  const out = { ...obj }
  for (const k of BRIEF_TEXT_FIELDS) if (typeof out[k] === 'string') out[k] = dropMissingBriefValues(out[k])
  return out
}

export function normalizeContentOutline(val) {
  if (Array.isArray(val)) {
    return val
      .map((x) => String(x ?? '').trim().replace(/^[-\d.、\s]+/, '').trim())
      .filter(Boolean)
  }
  const s = String(val ?? '').trim()
  if (!s) return []
  const byLines = s
    .split(/\r?\n+/)
    .map((x) => x.trim().replace(/^[-\d.、\s]+/, '').trim())
    .filter(Boolean)
  if (byLines.length > 1) return byLines
  // Legacy scripts saved by String(array) joined outline items with commas after '。' or before '标题：'
  const legacySplit = s
    .split(/(?<=。),|,(?=\s*(?:第\s*\d+\s*步|[\u4e00-\u9fa5A-Za-z0-9｜| ]{2,18}[：:]))/)
    .map((x) => x.trim().replace(/^[-\d.、\s]+/, '').trim())
    .filter(Boolean)
  return legacySplit.length > 1 ? legacySplit : byLines
}

export function formatDirectorBrief(scriptLike = {}) {
  if (!scriptLike || typeof scriptLike !== 'object') return ''
  scriptLike = withoutMissingBriefValues(scriptLike)
  const rawGoal = String(scriptLike.goal || scriptLike.userPrompt || scriptLike.polishedTopic || '').trim()
  const notes = String(scriptLike.directorNotes || '').trim()
  const outlineItems = normalizeContentOutline(scriptLike.contentOutline)
  const title = String(scriptLike.displayTitle || scriptLike.topic || scriptLike.title || '').trim()
  const genreLabel = String(scriptLike.genreLabel || '').trim()

  if (rawGoal && !BOILERPLATE_GOALS.has(rawGoal)) {
    // If rawGoal already contains full structured markers or detailed notes, show it directly.
    if (/【\s*(?:作品标题|体裁|内容要点|导演备注)/.test(rawGoal) || (!notes && outlineItems.length === 0) || rawGoal.length >= 60) {
      return rawGoal
    }
  }

  if (notes || outlineItems.length > 0) {
    const parts = []
    if (title) parts.push(`【作品标题】${title}`)
    if (genreLabel) parts.push(`【体裁】${genreLabel}`)
    const targetSec = Math.round(Number(scriptLike.targetDurationSec) || 0)
    if (scriptLike.durationMode === 'custom' && targetSec >= 10) {
      parts.push(`【目标时长】${targetSec} 秒`)
    }
    if (rawGoal && !BOILERPLATE_GOALS.has(rawGoal) && rawGoal !== title) {
      parts.push(`【一句话】${rawGoal}`)
    }
    if (outlineItems.length > 0) {
      parts.push(`【内容要点】\n${outlineItems.map((x, i) => `${i + 1}. ${x}`).join('\n')}`)
    }
    if (notes) {
      parts.push(`【导演备注（仅供 AI 制作，不会出现在视频里）】\n${notes}`)
    }
    return parts.join('\n')
  }

  if (rawGoal && !BOILERPLATE_GOALS.has(rawGoal)) return rawGoal
  return title
}

export function splitDirectorBrief(spec = {}) {
  spec = withoutMissingBriefValues(spec && typeof spec === 'object' ? spec : {})
  const rawTopic = String(spec.topic || '').trim()
  const sections = parseBriefSections(rawTopic)
  const explicitOutline = normalizeContentOutline(spec.contentOutline)
  const sectionOutline = normalizeContentOutline(sections.outline)
  const mergedOutline = explicitOutline.length > 0 ? explicitOutline : sectionOutline
  if (sections.hasMarkers) {
    const displayTitle = String(spec.displayTitle || '').trim() || sections.title || deriveDisplayTitle(rawTopic, '')
    const notes = [spec.directorNotes, sections.notes].map((x) => String(x || '').trim()).filter(Boolean)
    const directorNotes = Array.from(new Set(notes)).join('\n') || stripMetaInstructions(rawTopic) || rawTopic
    return {
      topic: (displayTitle || '作品').slice(0, 40),
      title: displayTitle || '作品',
      displayTitle: displayTitle || '作品',
      directorNotes,
      contentOutline: mergedOutline,
      genre: String(spec.genre || '').trim() || sections.genre,
      genreLabel: String(spec.genreLabel || '').trim() || sections.genreLabel,
      isBrief: true,
    }
  }
  const rawTitle = String(spec.title || '').trim()
  const explicit = String(spec.displayTitle || '').trim()
  const looksLikeBrief =
    rawTopic.length > 36 || isMetaInstructionText(rawTopic) || BRIEF_MARKER_RES.some((re) => re.test(rawTopic))
  const safeRawTitle = rawTitle && rawTitle.length <= 30 && !isMetaInstructionText(rawTitle) && !leaksBrief(rawTitle, [rawTopic]) ? rawTitle : ''

  const displayTitle =
    explicit ||
    (looksLikeBrief ? deriveDisplayTitle(rawTopic, safeRawTitle) : rawTopic) ||
    safeRawTitle ||
    ''

  const notes = []
  if (spec.directorNotes) notes.push(String(spec.directorNotes).trim())
  if (looksLikeBrief && rawTopic) notes.push(rawTopic)
  if (spec.userPrompt && String(spec.userPrompt).trim() !== rawTopic) notes.push(String(spec.userPrompt).trim())
  const directorNotes = Array.from(new Set(notes.filter(Boolean))).join('\n')

  const topic = (displayTitle || stripMetaInstructions(rawTopic) || rawTopic).slice(0, 40)
  return {
    topic,
    title: safeRawTitle || displayTitle || topic,
    displayTitle: displayTitle || topic,
    directorNotes,
    contentOutline: mergedOutline,
    genre: String(spec.genre || '').trim(),
    genreLabel: String(spec.genreLabel || '').trim(),
    isBrief: looksLikeBrief,
  }
}

function scrubText(text, briefs, { allowEmpty = true } = {}) {
  const s = String(text ?? '').trim()
  if (!s) return s
  let out = s
  if (leaksBrief(out, briefs)) return ''
  if (isMetaInstructionText(out)) out = stripMetaInstructions(out)
  else if (sentenceIsMeta(out) && out.length > 26) out = stripMetaInstructions(out)
  if (!out && !allowEmpty) return s.slice(0, 12)
  return out
}

/**
 * Final gate before write / render. Mutates `script` in place and returns { script, removed[] }.
 * Spoken (narration / subtitles) and on-screen (titles / tags / highlights) fields are all scrubbed.
 */
export const SCRUBBED_SCENE_TEXT_KEYS = ['narration', 'subtitleText', 'subtitleLine', 'title', 'tag', 'windowTitle', 'counterLabel', 'caption', 'text']

/** Key for `trusted`: a scene text field the user changed in the current save (see writeScriptJson's trustedSceneText). */
export const trustedSceneTextKey = (sceneId, field) => `${sceneId}\u0000${field}`

export function sanitizeScriptForRender(script, { trusted = null } = {}) {
  const removed = []
  if (!script || typeof script !== 'object') return { script, removed }
  // An over-long topic is a brief too (it is moved into directorNotes below). Registering it up front keeps the gate
  // idempotent: a second write of the same script must not scrub anything the first write kept.
  const longTopic = String(script.topic || '').length > 40 ? script.topic : ''
  const briefs = [script.directorNotes, script.goal, script.userPrompt, script.briefRaw, longTopic]
    .map((x) => String(x || '').trim())
    .filter((x) => x.length >= 24)

  // Text the user wrote by hand (recorded in `script.userOverrides` by the editors) is never scrubbed: quoting your own
  // brief in your own narration is legitimate. The gate exists for AI output (brief / director notes echoed on screen).
  const overrides = script.userOverrides && typeof script.userOverrides === 'object' ? script.userOverrides : {}
  const userOwned = (sc, key) => {
    if (trusted && sc && sc.id && trusted.has(trustedSceneTextKey(sc.id, key))) return true
    const o = sc && sc.id ? overrides[sc.id] : null
    return Boolean(o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, key) && String(o[key] ?? '') === String(sc[key] ?? ''))
  }

  const scrub = (obj, key, opts) => {
    if (!obj || typeof obj[key] !== 'string') return
    const before = obj[key]
    const after = scrubText(before, briefs, opts)
    if (after !== before) {
      removed.push({ field: key, before: before.slice(0, 60) })
      obj[key] = after
    }
  }

  // Script-level on-screen title. A short title naturally reuses words of the brief ("DSH Video Workbench：双引擎全链路…"),
  // so only a title longer than 40 chars (a pasted brief) gets the brief-overlap test; every title is checked for
  // meta instructions. (Re-deriving a short title from itself only cut it at its first comma / colon.)
  const titleBefore = String(script.title || '')
  const titleAfter = scrubText(titleBefore, titleBefore.length > 40 ? briefs : [])
  if (titleAfter !== titleBefore || titleBefore.length > 40) {
    removed.push({ field: 'title', before: titleBefore.slice(0, 60) })
    script.title = titleAfter && titleAfter.length <= 40 ? titleAfter : deriveDisplayTitle(titleBefore, script.topic && script.topic.length <= 40 ? script.topic : '作品')
  }
  if (String(script.topic || '').length > 40 || isMetaInstructionText(script.topic)) {
    removed.push({ field: 'topic', before: String(script.topic || '').slice(0, 60) })
    script.directorNotes = Array.from(new Set([script.directorNotes, script.topic].filter(Boolean))).join('\n')
    // the topic is a short subject: the (already safe) title is the best one; derive from the brief only without it
    const safeTitle = String(script.title || '').trim()
    script.topic = safeTitle && safeTitle.length <= 40 && !isMetaInstructionText(safeTitle) ? safeTitle : deriveDisplayTitle(script.topic, script.title || '作品')
  }

  for (const sc of script.scenes || []) {
    for (const key of SCRUBBED_SCENE_TEXT_KEYS) {
      if (userOwned(sc, key)) continue
      scrub(sc, key)
    }
    // subtitle chunks / cues are cut from the narration (or the on-screen subtitle text): user-written → keep them too
    const userSpoken = ['narration', 'subtitleText', 'subtitleLine'].some((k) => userOwned(sc, k))
    if (Array.isArray(sc.subChunks) && !userSpoken) {
      sc.subChunks = sc.subChunks.map((c) => scrubText(c, briefs)).filter(Boolean)
    }
    if (Array.isArray(sc.subtitles) && !userSpoken) {
      sc.subtitles = sc.subtitles.filter((c) => c && scrubText(c.text, briefs))
    }
    if (Array.isArray(sc.highlights)) {
      sc.highlights = sc.highlights.map((h) => scrubText(h, briefs)).filter(Boolean)
    }
    for (const side of ['compareLeft', 'compareRight']) {
      if (sc[side] && typeof sc[side] === 'object') {
        scrub(sc[side], 'label')
        scrub(sc[side], 'text')
      }
    }
    if (Array.isArray(sc.metrics)) {
      for (const m of sc.metrics) scrub(m, 'label')
    }
    if (sc.stageSpec && typeof sc.stageSpec === 'object') {
      for (const key of ['headline', 'subheadline']) scrub(sc.stageSpec, key)
      if (Array.isArray(sc.stageSpec.plaques)) {
        sc.stageSpec.plaques = sc.stageSpec.plaques.map((p) => scrubText(p, briefs)).filter(Boolean)
      }
    }
    if (!String(sc.narration || '').trim() && String(sc.title || '').trim() && sc.voiceMode !== 'silent') {
      // Never leave a speaking scene empty after scrubbing
      sc.narration = sc.title
    }
  }
  return { script, removed }
}

