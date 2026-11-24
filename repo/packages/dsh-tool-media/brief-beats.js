/**
 * @dsh-video/tool-media — key points of a brief for the rule-based fallback storyboard.
 *
 * Used only when no LLM storyboard is available (the model is rate-limited or down): instead of generic filler the
 * fallback storyboard follows the user's own key points — the explicit outline first, otherwise the enumeration in
 * the brief ("…的一生：会稽起兵、破釜沉舟、巨鹿之战…"). Template style recipes are stripped first, and every key point is
 * shorter than the brief-leak gate's 14-character window, so it is shown as written and never scrubbed as an echo.
 */
import { stripPlazaTemplateGuidance } from './plaza-guidance.js'

export const MAX_BRIEF_BEAT_CHARS = 13

const LEAD_RE = /^(?:从|到|直到|再到|然后|最后|最终|以及|及|并且|还有|直至|包括|比如|例如|和)\s*/
const IMPERATIVE_RE = /^(?:请你?|麻烦|帮我|给我|我想|我要|想要)?\s*(?:制作|生成|创作|拍摄|做|产出|设计|出)(?:一部|一条|一个|一段|一支|一份|个|支|部|条)?/
const SPLIT_RE = /[、，,；;。！？!?\n]|直到|再到|然后|最后|最终|直至|以及/

const cleanBeat = (s) =>
  String(s || '')
    .replace(/^[\s\d一二三四五六七八九十]+[.、．)）]\s*/, '')
    .replace(LEAD_RE, '')
    .replace(/^[“"'‘《（(\s]+|[”"'’》）)\s]+$/g, '')
    .replace(/[。！？!?；;，,、:：\s]+$/, '')
    .trim()

const usable = (s) => s.length >= 2 && s.length <= MAX_BRIEF_BEAT_CHARS && /[一-龥]/.test(s) && !IMPERATIVE_RE.test(s)

const dedupe = (arr) => {
  const seen = new Set()
  return arr.filter((x) => (seen.has(x) ? false : (seen.add(x), true)))
}

/**
 * @param {{ contentOutline?: string[]|string, texts?: string[], max?: number }} opts
 * @returns {string[]} 3+ short key points, or [] when the brief has no usable list
 */
export function extractBriefBeats({ contentOutline = [], texts = [], max = 24 } = {}) {
  const outlineItems = (Array.isArray(contentOutline) ? contentOutline : String(contentOutline || '').split(/\r?\n+/))
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
  // an outline point is often "标题：说明" — its heading is the key point
  const outlineBeats = outlineItems
    .map((it) => {
      const head = cleanBeat(it.split(/[：:]/)[0])
      return usable(head) ? head : cleanBeat(it.split(/[，,。；;]/)[0])
    })
    .filter(usable)
  if (outlineBeats.length >= 3) return dedupe(outlineBeats).slice(0, max)

  for (const raw of Array.isArray(texts) ? texts : [texts]) {
    const text = stripPlazaTemplateGuidance(raw).replace(/【[^】]{1,24}】/g, '\n')
    if (!text.trim()) continue
    const segs = text.split(/[：:]/)
    const tails = segs.length > 1 ? segs.slice(1) : [text]
    let best = []
    for (const tail of tails) {
      const items = tail.split(SPLIT_RE).map(cleanBeat).filter(usable)
      if (items.length > best.length) best = items
    }
    if (best.length >= 3) return dedupe(best).slice(0, max)
  }
  return []
}
