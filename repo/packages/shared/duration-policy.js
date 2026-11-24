/**
 * Unified Video Duration Policy & Natural-Language Duration Parser
 * - Supports explicit user-defined duration (`durationMode: 'custom'`, `targetDurationSec: 15..600`)
 * - Supports AI automatic duration matching (`durationMode: 'auto'`) while STILL honoring
 *   explicit duration requirements written in natural language (e.g. "两分钟以上", "2分30秒", "150秒").
 * - Computes realistic scene counts & Chinese narration character budgets so final TTS + rendered
 *   MP4 duration reliably matches the user's target instead of shrinking to ~55s.
 */

const CN_DIGIT = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

export function parseChineseOrArabicNumber(raw) {
  const s = String(raw || '').trim()
  if (!s) return NaN
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s)
  if (s === '半') return 0.5
  let val = 0
  if (s.includes('十')) {
    const [left, right] = s.split('十')
    const tens = left ? (CN_DIGIT[left] ?? NaN) : 1
    const ones = right ? (CN_DIGIT[right] ?? NaN) : 0
    if (Number.isNaN(tens) || Number.isNaN(ones)) return NaN
    val = tens * 10 + ones
  } else if (s.length === 1 && CN_DIGIT[s] !== undefined) {
    val = CN_DIGIT[s]
  } else {
    return NaN
  }
  return val
}

export function clampDurationSec(sec) {
  const n = Math.round(Number(sec) || 0)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.max(10, Math.min(600, n))
}

export function formatDurationLabel(sec) {
  const s = clampDurationSec(sec)
  if (!s) return 'AI 自由匹配'
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r === 0 ? `${m} 分钟 (${s}秒)` : `${m} 分 ${String(r).padStart(2, '0')} 秒 (${s}秒)`
}

/**
 * Extract explicit duration intent from Chinese / English natural language prompt.
 * Examples:
 *  - "视频时长需要两分钟以上" -> { sec: 135, minSec: 120, isAtLeast: true }
 *  - "2分30秒" / "两分半" -> { sec: 150, minSec: 138, isAtLeast: false }
 *  - "120秒" / "3分钟" -> { sec: 120/180, minSec: ..., isAtLeast: false }
 *  - "不限制时长" -> { sec: 180, minSec: 145, isAtLeast: true, unlimited: true }
 */
export function parseDurationFromText(text = '') {
  const s = String(text || '')
  if (!s.trim()) return null

  // 0. Explicit structured tag `【目标时长】120 秒`
  const tagMatch = s.match(/【\s*目标时长[^】]*】[^\n\d]*(\d{2,4})\s*秒?/)
  if (tagMatch) {
    const sec = clampDurationSec(Number(tagMatch[1]))
    if (sec >= 10) {
      return { sec, minSec: Math.round(sec * 0.92), maxSec: Math.round(sec * 1.18), isAtLeast: false, source: 'brief-tag' }
    }
  }

  // 1. "X分Y秒" or "X分半" (e.g., 2分30秒, 两分半, 1分45秒)
  const minSecCombo = s.match(/(至少|不少于|超过|大于|≥|>=)?\s*(\d+(?:\.\d+)?|[一二两兩三四五六七八九十]+)\s*分(?:钟)?\s*(半|\d{1,2}\s*秒?)\s*(以上|左右|上下|起)?/)
  if (minSecCombo) {
    const mins = parseChineseOrArabicNumber(minSecCombo[2])
    const secPartRaw = String(minSecCombo[3] || '').replace(/秒/g, '').trim()
    const extraSec = secPartRaw === '半' ? 30 : Number(secPartRaw)
    if (Number.isFinite(mins) && mins >= 0 && mins <= 10 && Number.isFinite(extraSec)) {
      const base = Math.round(mins * 60 + extraSec)
      if (base >= 10) {
        const isAtLeast = Boolean(minSecCombo[1] || (minSecCombo[4] && /以上|起/.test(minSecCombo[4])))
        const target = clampDurationSec(isAtLeast ? Math.round(base * 1.12) : base)
        return {
          sec: target,
          minSec: clampDurationSec(isAtLeast ? base : Math.round(base * 0.9)),
          maxSec: clampDurationSec(Math.round(target * 1.2)),
          isAtLeast,
          source: 'text',
        }
      }
    }
  }

  // 2. "两分钟以上" / "2分钟" / "至少3分钟" / "2 min"
  const minOnly = s.match(/(至少|不少于|超过|大于|高于|≥|>=|需要|要求|做成|做到|大概|约|大约)?\s*(\d+(?:\.\d+)?|[一二两兩三四五六七八九十]+)\s*(?:分钟|min(?:ute)?s?)\s*(以上|左右|上下|多|起)?/i)
  if (minOnly) {
    const mins = parseChineseOrArabicNumber(minOnly[2])
    if (Number.isFinite(mins) && mins > 0 && mins <= 10) {
      const base = Math.round(mins * 60)
      const isAtLeast = Boolean(
        (minOnly[1] && /至少|不少于|超过|大于|高于|≥|>=/.test(minOnly[1])) ||
        (minOnly[3] && /以上|多|起/.test(minOnly[3])),
      )
      const target = clampDurationSec(isAtLeast ? Math.round(base + Math.max(12, base * 0.12)) : base)
      return {
        sec: target,
        minSec: clampDurationSec(isAtLeast ? base : Math.round(base * 0.9)),
        maxSec: clampDurationSec(Math.round(target * 1.22)),
        isAtLeast,
        source: 'text',
      }
    }
  }

  // 3. Explicit seconds: "120秒以上" / "90秒" / "150s" (ignore tiny numbers like "3秒钩子", "黄金3秒", "4秒/镜")
  const secMatches = [...s.matchAll(/(至少|不少于|超过|大于|≥|>=|时长(?:为|约|需要|要|在)?)?\s*(\d{2,3})\s*(?:秒钟|秒|s\b|sec)\s*(以上|左右|上下|起)?/gi)]
  for (const m of secMatches) {
    const around = s.slice(Math.max(0, (m.index || 0) - 8), Math.min(s.length, (m.index || 0) + m[0].length + 8))
    if (/每镜|单镜|每幕|\/\s*镜|钩子|前\d+秒|片尾|最后|平均|均长|最短|最长|每个镜头|每段|每拍/.test(around)) continue
    // the digits must be a whole number: "3.42秒" / "154.05秒" are decimals (per-shot averages), not a 42 s / 5 s target
    const numAt = (m.index || 0) + m[0].indexOf(m[2])
    const prevCh = s[numAt - 1] || ''
    if (/[\d.．]/.test(prevCh)) continue
    const base = Number(m[2])
    if (base >= 15 && base <= 600) {
      const isAtLeast = Boolean((m[1] && /至少|不少于|超过|大于|≥|>=/.test(m[1])) || (m[3] && /以上|起/.test(m[3])))
      const target = clampDurationSec(isAtLeast ? Math.round(base + Math.max(10, base * 0.1)) : base)
      return {
        sec: target,
        minSec: clampDurationSec(isAtLeast ? base : Math.round(base * 0.9)),
        maxSec: clampDurationSec(Math.round(target * 1.2)),
        isAtLeast,
        source: 'text',
      }
    }
  }

  // 4. Unlimited / comprehensive long-form request
  if (/不限制时长|不限时长|全量教程|完整教程|全功能教程|从头到尾教程|全部功能板块/.test(s)) {
    return { sec: 165, minSec: 130, maxSec: 300, isAtLeast: true, unlimited: true, source: 'unlimited-hint' }
  }

  return null
}

/**
 * Resolve effective duration target & planning constraints for polishTopicPrompt, plan-schema,
 * pipeline-orchestrator, ai-coder, and beat-analyzer.
 */
export function resolveTargetDurationPolicy({
  durationMode = 'auto',
  targetDurationSec = 0,
  text = '',
  pacingProfile = null,
  narrationMode = 'tts',
  hasVisualAssets = false,
  bgmDurationSec = 0,
  referenceShotCount = 0,
  // duration of the film the reference shot count belongs to (a template film / an analysed reference video)
  referenceDurationSec = 0,
} = {}) {
  const normMode = String(durationMode || 'auto').trim().toLowerCase() === 'custom' ? 'custom' : 'auto'
  const explicitSec = clampDurationSec(targetDurationSec)
  const textParsed = parseDurationFromText(text)
  const isSubtitleMv = narrationMode === 'subtitle-mv'
  const isDynamicPacing = pacingProfile?.id === 'dynamic'

  let mode = 'auto'
  let enforced = false
  let targetSec = 0
  let minSec = 0
  let maxSec = 0
  let isAtLeast = false
  let unlimited = false

  if (normMode === 'custom' && explicitSec >= 10) {
    mode = 'custom'
    enforced = true
    targetSec = explicitSec
    minSec = clampDurationSec(Math.round(explicitSec * 0.92))
    maxSec = clampDurationSec(Math.round(explicitSec * 1.18))
  } else if (explicitSec >= 10) {
    mode = 'custom'
    enforced = true
    targetSec = explicitSec
    minSec = clampDurationSec(Math.round(explicitSec * 0.92))
    maxSec = clampDurationSec(Math.round(explicitSec * 1.18))
  } else if (textParsed && textParsed.sec >= 10) {
    mode = textParsed.unlimited ? 'unlimited' : 'text-inferred'
    enforced = true
    targetSec = textParsed.sec
    minSec = textParsed.minSec
    maxSec = textParsed.maxSec
    isAtLeast = Boolean(textParsed.isAtLeast)
    unlimited = Boolean(textParsed.unlimited)
  } else {
    // True AI free duration matching: pick sensible reference span without forcing truncation
    const bgmRef = Number(bgmDurationSec) >= 15 && Number(bgmDurationSec) <= 240 ? Math.round(Number(bgmDurationSec)) : 0
    targetSec = bgmRef || (hasVisualAssets ? 75 : 65)
    minSec = Math.max(25, Math.round(targetSec * 0.65))
    maxSec = Math.min(360, Math.round(targetSec * 1.5))
  }

  // A reference keeps its cut density, not its absolute shot count: 53 shots of a 123 s template film become ~28
  // shots of a 65 s film (when the reference film's duration is known and differs by more than 20 %).
  const refShotsRaw = Number(referenceShotCount) > 6 ? Math.round(Number(referenceShotCount)) : 0
  const refSec = Number(referenceDurationSec) || 0
  const refShotsScaled =
    refShotsRaw && refSec >= 10 && targetSec > 0 && Math.abs(targetSec / refSec - 1) > 0.2
      ? Math.round((refShotsRaw * targetSec) / refSec)
      : refShotsRaw
  const refShots = refShotsScaled > 6 ? Math.min(72, refShotsScaled) : 0
  const shotsPerMin = isSubtitleMv ? 24 : (pacingProfile?.shotsPerMin || (isDynamicPacing ? 22 : 12))
  const avgSecPerShot = Math.max(1.8, Math.min(8.5, 60 / Math.max(6, shotsPerMin)))
  const rawShots = refShots || Math.max(6, Math.round(targetSec / avgSecPerShot))
  const hardMaxShots = Math.max(
    pacingProfile?.maxShots || (isSubtitleMv || isDynamicPacing ? 64 : 36),
    Math.min(80, Math.ceil(targetSec / (isSubtitleMv ? 1.85 : 2.2)) + 8),
  )
  const computedMinShots = enforced || isSubtitleMv || isDynamicPacing
    ? Math.max(
        isSubtitleMv && targetSec >= 105 ? 34 : (isDynamicPacing && targetSec >= 105 ? 30 : 6),
        Math.min(hardMaxShots - 4, refShots ? Math.round(refShots * 0.85) : Math.round((enforced ? minSec : targetSec * 0.88) / Math.max(2.2, avgSecPerShot * (isSubtitleMv ? 1.08 : 1.2)))),
      )
    : Math.max(pacingProfile?.minShots || 8, Math.min(hardMaxShots - 4, rawShots - 2))
  const targetShotsMin = Math.min(hardMaxShots - 4, computedMinShots)
  const targetShotsMax = Math.min(hardMaxShots, Math.max(targetShotsMin + 6, rawShots + (enforced || isSubtitleMv ? 8 : 4)))

  // Spoken Chinese budget: ~4.05 spoken chars/sec + ~0.65s inter-scene breathing/SFX cushion
  const speakingSecBudget = Math.max(8, targetSec - targetShotsMin * 0.65)
  const requiredCharsMin = isSubtitleMv ? 0 : Math.round(speakingSecBudget * 3.7)
  const requiredCharsMax = isSubtitleMv ? 0 : Math.round(speakingSecBudget * 4.55)
  const outlineCountMin = Math.max(4, Math.min(20, Math.round(targetSec / (isSubtitleMv ? 12 : 18))))
  const outlineCountMax = Math.min(28, outlineCountMin + 5)

  const label = enforced
    ? isAtLeast
      ? `≥ ${formatDurationLabel(minSec)}（规划目标约 ${formatDurationLabel(targetSec)}）`
      : formatDurationLabel(targetSec)
    : 'AI 自由匹配时长'

  const promptDirective = enforced || isSubtitleMv
    ? isSubtitleMv
      ? `【纯音乐高燃卡点分镜密度硬约束】：本片为免配音纯音乐卡点 MV（目标时长 ${enforced ? label : `约 ${formatDurationLabel(targetSec)}`}）！必须规划 **${targetShotsMin}~${targetShotsMax} 个高密度快切分镜**（参考爆款历史燃剪的节奏：常规镜 2~4 拍约 1.5~3.2s，高潮突降点 drops 与战局转折穿插 0.5 拍/1 拍爆燃闪切），各镜 durationSec 之和落在 **${minSec}~${maxSec} 秒**，严禁只拆十几二十个缓慢拖沓的镜头！`
      : `【目标时长硬约束（必须达标，严禁缩水！）】：本片目标总时长为 **${label}**（硬底线不得低于 **${minSec} 秒**）！按正常中文解说语速（每秒约 4.1 字 + 幕间呼吸停顿）换算，全片必须规划 **${targetShotsMin}~${targetShotsMax} 个分镜**，全部镜头 \`narration\` 旁白总字数必须达到 **${requiredCharsMin}~${requiredCharsMax} 个汉字**（平均每镜约 ${Math.max(16, Math.round(requiredCharsMin / Math.max(1, targetShotsMax)))}~${Math.max(28, Math.round(requiredCharsMax / Math.max(1, targetShotsMin)))} 字、单镜 durationSec 合计落在 **${minSec}~${maxSec} 秒**），讲透完整内容与细节，绝不允许只写几百字导致成片缩水成 50 秒！`
    : '【时长策略：AI 自由匹配】：根据题材深度、素材丰富度与叙事节奏自由规划最舒适的完整时长（不强行压缩、也不注水凑数）。'

  return {
    mode,
    durationMode: normMode,
    enforced,
    targetSec,
    minSec,
    maxSec,
    isAtLeast,
    unlimited,
    hardMaxShots,
    targetShotsMin,
    targetShotsMax,
    requiredCharsMin,
    requiredCharsMax,
    outlineCountMin,
    outlineCountMax,
    label,
    promptDirective,
  }
}

/**
 * Estimate realistic spoken + visual duration (seconds) of a planned shot list.
 */
export function estimatePlanDurationSec(shots = [], { narrationMode = 'tts' } = {}) {
  if (!Array.isArray(shots) || shots.length === 0) return 0
  const isMv = narrationMode === 'subtitle-mv'
  let sum = 0
  for (const sh of shots) {
    const declared = Number(sh?.durationSec) || 0
    if (isMv) {
      sum += Math.max(0.45, declared || 2.5)
      continue
    }
    const text = String(sh?.narration || sh?.title || '').replace(/\s+/g, '')
    const speed = Math.max(0.75, Math.min(1.4, Number(sh?.speechRate) || 1.04))
    const spokenEst = text.length > 0 ? text.length / (4.15 * speed) + 0.72 : 2.2
    // Real TTS render takes roughly spokenEst (declared duration only extends when longer than spoken)
    sum += Math.max(1.8, Math.min(Math.max(spokenEst, declared * 0.85), Math.max(spokenEst * 1.25, declared)))
  }
  return Number(sum.toFixed(2))
}
