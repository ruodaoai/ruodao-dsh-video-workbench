/**
 * Subtitle & TTS text engine (strictly separates what viewers READ from what the TTS engine SPEAKS).
 *
 *  - `toSubtitleText(narration)`  → on-screen subtitle source: natural Arabic numerals (206年 / 3000人),
 *    NO quotes / book-title marks / trailing punctuation.
 *  - `segmentSubtitleLines(text, maxW)` → semantic line breaking: never splits a number+unit token or a
 *    segmented word, never lets punctuation or quote marks start / end a subtitle line.
 *  - `toTtsText(narration)` → background-only pronunciation text (digits → spoken Chinese, breath pauses).
 */

const QUOTE_CHARS_RE = /[“”"‘’'「」『』《》〈〉«»„‟〝〞＂＇`´]/g
const EDGE_PUNCT_RE = /^[\s，。！？；：、,.!?;:…—–\-·‥)）\]】}]+|[\s，。！？；：、,.!?;:…—–\-·‥(（\[【{]+$/g
const CLAUSE_SPLIT_RE = /(?<=[，。！？；：、,!?;:…])/

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_DIGIT_CHARS = '零〇一二两三四五六七八九'
const NUM_UNITS =
  '年|月|日|号|人|个|座|匹|名|位|条|场|次|天|秒|分钟|小时|岁|倍|万|亿|元|块|度|公里|里|米|步|级|代|周|辆|支|张|份|战|将|骑|兵|户|家|军|营|所|处|种|套|页|行|帧|款|项|门|台'

/** Parse a Chinese numeral string (e.g. 二百零六 / 三千 / 一万二千 / 十五) to an integer, or NaN. */
export function parseChineseNumber(str) {
  const s = String(str || '').trim()
  if (!s) return NaN
  let total = 0
  let section = 0
  let digit = null
  let seen = false
  for (const ch of s) {
    if (ch in CN_DIGIT) {
      digit = CN_DIGIT[ch]
      seen = true
    } else if (ch === '十') {
      section += (digit === null ? 1 : digit) * 10
      digit = null
      seen = true
    } else if (ch === '百') {
      if (digit === null) return NaN
      section += digit * 100
      digit = null
    } else if (ch === '千') {
      if (digit === null) return NaN
      section += digit * 1000
      digit = null
    } else if (ch === '万' || ch === '亿') {
      section += digit === null ? 0 : digit
      digit = null
      if (section === 0) return NaN
      total += section * (ch === '万' ? 10000 : 100000000)
      section = 0
    } else {
      return NaN
    }
  }
  if (!seen) return NaN
  return total + section + (digit === null ? 0 : digit)
}

const CN_SMALL = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']

function sectionToChinese(n) {
  // n in [1, 9999]
  const units = [
    [1000, '千'],
    [100, '百'],
    [10, '十'],
  ]
  let out = ''
  let rest = n
  let zeroPending = false
  for (const [u, label] of units) {
    const d = Math.floor(rest / u)
    rest %= u
    if (d > 0) {
      if (zeroPending) out += '零'
      zeroPending = false
      out += (u === 10 && d === 1 && out === '' ? '' : CN_SMALL[d]) + label
    } else if (out) {
      zeroPending = true
    }
  }
  if (rest > 0) {
    if (zeroPending) out += '零'
    out += CN_SMALL[rest]
  }
  return out
}

/** Spoken Chinese reading of a non-negative integer (206 → 二百零六, 3000 → 三千, 12 → 十二). */
export function arabicToChinese(n) {
  const num = Math.floor(Number(n))
  if (!Number.isFinite(num) || num < 0) return String(n)
  if (num === 0) return '零'
  if (num >= 1e12) return String(num).split('').map((c) => CN_SMALL[Number(c)]).join('')
  const yi = Math.floor(num / 1e8)
  const wan = Math.floor((num % 1e8) / 1e4)
  const ge = num % 1e4
  let out = ''
  if (yi > 0) out += `${arabicToChinese(yi)}亿`
  if (wan > 0) {
    if (yi > 0 && wan < 1000) out += '零'
    out += `${sectionToChinese(wan)}万`
  } else if (yi > 0 && ge > 0) {
    out += '零'
  }
  if (ge > 0) {
    if (wan > 0 && ge < 1000) out += '零'
    out += sectionToChinese(ge)
  }
  return out
}

const digitByDigit = (s) => String(s).split('').map((c) => (c >= '0' && c <= '9' ? CN_SMALL[Number(c)] : c)).join('')

/**
 * On-screen text: convert spoken Chinese numerals back to natural Arabic numerals when they carry
 * real quantity/year meaning (二百零六年 → 206年, 三千人 → 3000人). Small counts (三步 / 一个) stay.
 */
export function normalizeNumeralsForDisplay(text) {
  let s = String(text || '')
  // Years written digit-by-digit: 二零六年 / 二〇二五年
  s = s.replace(new RegExp(`(?<![${CN_DIGIT_CHARS}十百千万亿])([${CN_DIGIT_CHARS}]{2,4})年`, 'g'), (m, d) => {
    const digits = d.split('').map((c) => CN_DIGIT[c])
    if (digits.some((x) => x === undefined)) return m
    return `${digits.join('')}年`
  })
  // Quantities with magnitude / tens followed by a counting unit
  const re = new RegExp(`([${CN_DIGIT_CHARS}十百千万亿]{1,12})(${NUM_UNITS})`, 'g')
  s = s.replace(re, (m, num, unit) => {
    const v = parseChineseNumber(num)
    if (!Number.isFinite(v)) return m
    const hasMagnitude = /[十百千万亿]/.test(num)
    if (!hasMagnitude) return m
    if (v < 10) return m
    // Guard idioms like 万一 / 千万 handled by requiring a leading digit char for 百千万亿
    if (/^[百千万亿]/.test(num)) return m
    if (unit === '万' || unit === '亿') return m
    return `${v}${unit}`
  })
  // "N万/N亿" with a digit prefix (三万 → 3万, 二十万 → 20万, 一万二千 → 12000)
  s = s.replace(new RegExp(`([${CN_DIGIT_CHARS}十百千]{1,6}[万亿](?:[${CN_DIGIT_CHARS}十百千]{1,6})?)(?=人|余|多|名|个|匹|骑|兵|户|元|倍|座|里|公里|米|年|岁|$|[，。！？；、\\s])`, 'g'), (m, num) => {
    const v = parseChineseNumber(num)
    if (!Number.isFinite(v) || v < 10000) return m
    if (/[千百十]/.test(num.replace(/[万亿]/g, ' ')) || /亿/.test(num)) {
      return String(v)
    }
    return `${v / 10000}万`
  })
  return s
}

/** Pronunciation-only text: digits become spoken Chinese, URL / quote noise removed. NEVER shown on screen. */
export function toTtsText(narration, opts = {}) {
  let s = String(narration || '')
    .replace(/https?:\/\/[^\s)）\]】"']+/gi, '')
    .replace(QUOTE_CHARS_RE, '')
  // Years: 4 digits + 年 → digit by digit
  s = s.replace(/(\d{4})\s*年(?!代)/g, (_, y) => (/^[12]/.test(y) ? `${digitByDigit(y)}年` : `${arabicToChinese(Number(y))}年`))
  s = s.replace(/(公元前?|[前后于自从至到在])\s*(\d{3})\s*年/g, (_, pre, y) => `${pre}${digitByDigit(y)}年`)
  s = s.replace(/(\d{3,4})\s*([pP])(?![A-Za-z])/g, (_, n, u) => `${digitByDigit(n)}${u}`)
  // Percent
  s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, (_, n) => `百分之${toSpokenDecimal(n)}`)
  // Ranges 3-5 / 3~5
  s = s.replace(/(\d+)\s*[~～–—-]\s*(\d+)(?=\s*[\u4e00-\u9fa5])/g, (_, a, b) => `${arabicToChinese(Number(a))}到${arabicToChinese(Number(b))}`)
  // Decimals
  s = s.replace(/(\d+)\.(\d+)/g, (_, a, b) => `${arabicToChinese(Number(a))}点${digitByDigit(b)}`)
  // 11-digit phone-like / long ids → digit by digit
  s = s.replace(/\d{6,}/g, (m) => digitByDigit(m))
  // Remaining integers
  s = s.replace(/\d+/g, (m) => {
    // keep digits glued to latin words (4K, 2K, 720p, H264, v0.3.3 pieces) readable by the engine
    return arabicToChinese(Number(m))
  })
  s = s.replace(/\s{2,}/g, ' ').trim()
  if (opts.pauses !== false) s = insertBreathPauses(s)
  return s
}

function toSpokenDecimal(n) {
  const [a, b] = String(n).split('.')
  return b ? `${arabicToChinese(Number(a))}点${digitByDigit(b)}` : arabicToChinese(Number(a))
}

/** Add comma breaths into long unpunctuated runs so the TTS engine breathes like a human narrator. */
export function insertBreathPauses(text, maxRun = 18) {
  const clauses = String(text || '').split(CLAUSE_SPLIT_RE)
  const out = []
  for (const clause of clauses) {
    const pure = clause.replace(/[，。！？；：、,!?;:…]+$/g, '')
    if (displayWidth(pure) <= maxRun + 4) {
      out.push(clause)
      continue
    }
    const tail = clause.slice(pure.length)
    const words = segmentWords(pure)
    let cur = ''
    const pieces = []
    for (const w of words) {
      if (displayWidth(cur + w) > maxRun && cur) {
        pieces.push(cur)
        cur = w
      } else {
        cur += w
      }
    }
    if (cur) pieces.push(cur)
    out.push(pieces.join('，') + tail)
  }
  return out.join('')
}

export function displayWidth(s) {
  return [...String(s || '')].reduce((acc, ch) => acc + (/[\u0000-\u00ff]/.test(ch) ? 0.58 : 1), 0)
}

let zhSegmenter = null
function getSegmenter() {
  if (zhSegmenter === null) {
    try {
      zhSegmenter = new Intl.Segmenter('zh', { granularity: 'word' })
    } catch {
      zhSegmenter = false
    }
  }
  return zhSegmenter || null
}

/** Word tokens; numbers with units (206年, 3000人, 4K, 1080p) are kept atomic. */
export function segmentWords(text) {
  const s = String(text || '')
  const atoms = []
  // Protect number+unit tokens and ASCII words as atomic chunks
  const protectedRe = new RegExp(`(?:\\d[\\d,.]*\\s?(?:${NUM_UNITS}|%|[A-Za-z]+)?|[A-Za-z][A-Za-z0-9_.+\\-]*)`, 'g')
  let last = 0
  let m
  while ((m = protectedRe.exec(s))) {
    if (m.index > last) atoms.push(...segmentPlain(s.slice(last, m.index)))
    atoms.push(m[0])
    last = m.index + m[0].length
  }
  if (last < s.length) atoms.push(...segmentPlain(s.slice(last)))
  return atoms.filter((x) => x !== '')
}

function segmentPlain(chunk) {
  const seg = getSegmenter()
  if (!seg) return chunk.match(/[\u4e00-\u9fff]{1,2}|[^\u4e00-\u9fff]+/g) || [chunk]
  return Array.from(seg.segment(chunk), (x) => x.segment)
}

export function stripUrls(raw = '') {
  return String(raw || '')
    .replace(/\(\s*\[[^\]]*\]\(\s*https?:\/\/[^)]*\)\s*\)/gi, '')
    .replace(/\[([^\]]+)\]\(\s*https?:\/\/[^)]*\)/gi, '$1')
    .replace(/\(\s*https?:\/\/[^)]*\)/gi, '')
    .replace(/https?:\/\/[^\s)）\]】"']+/gi, '')
    .replace(/\[cite[:：\s][^\]]*\]/gi, '')
    .replace(/\(\s*\)|（\s*）/g, '')
}

/** Strip quotes / book-title marks and edge punctuation from a single subtitle line. */
export function cleanSubtitleChunk(chunk) {
  return String(chunk || '')
    .replace(QUOTE_CHARS_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(EDGE_PUNCT_RE, '')
    .trim()
}

/** Full on-screen subtitle source text (keeps interior clause punctuation for segmentation). */
export function toSubtitleText(narration) {
  let s = stripUrls(narration).replace(QUOTE_CHARS_RE, '')
  s = normalizeNumeralsForDisplay(s)
  s = s.replace(/\s{2,}/g, ' ').trim()
  return s.replace(/[，。！？；：、,.!?;:…\s]+$/g, '').replace(/^[，。！？；：、,.!?;:…\s]+/g, '')
}

/**
 * Semantic line breaking. Guarantees:
 *   1. no quote / bracket / punctuation at a line edge;
 *   2. number+unit and ASCII words are never split;
 *   3. short clauses are merged up to `maxW`, long clauses are cut at segmented-word boundaries.
 */
export function segmentSubtitleLines(text, maxW = 16) {
  const src = toSubtitleText(text)
  if (!src) return []
  const width = Math.max(8, Math.min(22, Number(maxW) || 16))
  // Clauses with their terminator kind: strong (。！？；…) never merges with the next clause
  const clauses = []
  const re = /([^，。！？；：、,!?;:…\n]+)([，。！？；：、,!?;:…\n]*)/g
  let m
  while ((m = re.exec(src))) {
    const body = cleanSubtitleChunk(m[1])
    if (!body) continue
    clauses.push({ body, strong: /[。！？；!?;…\n]/.test(m[2]) })
  }

  const lines = [] // { text, strongEnd }
  const pushLong = (clause, strong) => {
    const words = segmentWords(clause)
    let cur = ''
    const parts = []
    for (const w of words) {
      const next = cur + w
      if (cur && displayWidth(next) > width + 1) {
        parts.push(cur.trim())
        cur = w.trimStart()
      } else {
        cur = next
      }
    }
    if (cur.trim()) parts.push(cur.trim())
    // Avoid a dangling 1–2 char orphan line: rebalance with the previous part
    if (parts.length >= 2 && displayWidth(parts[parts.length - 1]) <= 2) {
      const orphan = parts.pop()
      parts[parts.length - 1] += orphan
    }
    parts.forEach((pt, i) => lines.push({ text: pt, strongEnd: strong && i === parts.length - 1 }))
  }
  for (const { body, strong } of clauses) {
    if (displayWidth(body) > width + 2) {
      pushLong(body, strong)
      continue
    }
    const prev = lines[lines.length - 1]
    if (
      prev &&
      !prev.strongEnd &&
      displayWidth(`${prev.text} ${body}`) <= width + 1 &&
      (displayWidth(body) <= 5 || displayWidth(prev.text) <= 5)
    ) {
      prev.text = `${prev.text} ${body}`
      prev.strongEnd = strong
    } else {
      lines.push({ text: body, strongEnd: strong })
    }
  }
  return lines.map((l) => cleanSubtitleChunk(l.text)).filter(Boolean)
}

/** True when every chunk boundary falls on a word boundary (so no word / number+unit is torn apart). */
export function chunksRespectWords(chunks) {
  const clean = (Array.isArray(chunks) ? chunks : []).map((c) => String(c || '').trim()).filter(Boolean)
  if (clean.length < 2) return true
  const joined = clean.join('')
  const boundaries = new Set()
  let off = 0
  for (const w of segmentWords(joined)) {
    off += w.length
    boundaries.add(off)
  }
  let acc = 0
  for (let i = 0; i < clean.length - 1; i++) {
    acc += clean[i].length
    if (!boundaries.has(acc)) return false
  }
  return true
}
