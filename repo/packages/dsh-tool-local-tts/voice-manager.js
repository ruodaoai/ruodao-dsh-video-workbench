import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  loadEnv,
  PACKAGE_ROOT,
  probeAudioDuration,
  readScriptJson,
  REPO_ROOT,
  resolveBinaries,
  resolveEnvPath,
  runCommandRedirected,
  writeScriptJson,
} from '../shared/index.js'
import { resolveTtsEngineSpec } from './tts-config.js'

function resolveConfiguredTtsRoots() {
  loadEnv()
  let idxRoot = resolveEnvPath('INDEXTTS_ROOT', '')
  let gptRoot = resolveEnvPath('GPTVOICE_ROOT', '')
  try {
    const idxSpec = resolveTtsEngineSpec('indextts25')
    const idx2Spec = resolveTtsEngineSpec('indextts2')
    const gptSpec = resolveTtsEngineSpec('gptvoice')
    if (idxSpec?.rootDir && existsSync(idxSpec.rootDir)) idxRoot = idxSpec.rootDir
    else if (idx2Spec?.rootDir && existsSync(idx2Spec.rootDir)) idxRoot = idx2Spec.rootDir
    if (gptSpec?.rootDir && existsSync(gptSpec.rootDir)) gptRoot = gptSpec.rootDir
  } catch {}
  return { idxRoot, gptRoot }
}

/**
 * Guarantee `<idxRoot>/voices/` exists and at least one real 24kHz WAV reference speaker prompt
 * is available on disk so brand-new IndexTTS-2.5 / IndexTTS-2 / GPT-SoVITS installs NEVER fail
 * on first click due to missing `voices/` directory or empty speaker references.
 */
export async function ensureDefaultReferenceVoices({ idxRoot: explicitIdxRoot = '', gptRoot: explicitGptRoot = '' } = {}) {
  const roots = resolveConfiguredTtsRoots()
  const idxRoot = explicitIdxRoot || roots.idxRoot
  const gptRoot = explicitGptRoot || roots.gptRoot
  const created = []

  if (idxRoot && existsSync(idxRoot)) {
    const voicesDir = join(idxRoot, 'voices')
    if (!existsSync(voicesDir)) {
      try {
        mkdirSync(voicesDir, { recursive: true })
      } catch {}
    }
  }

  const packsBuiltinDir = join(getVoicePacksDir(), 'builtin')
  mkdirSync(packsBuiltinDir, { recursive: true })

  // Check if any usable WAV already exists in builtin/ or idxRoot/voices or idxRoot/examples
  const probeDirs = [
    packsBuiltinDir,
    ...(idxRoot && existsSync(idxRoot) ? [join(idxRoot, 'voices'), join(idxRoot, 'examples'), join(idxRoot, 'prompts')] : []),
    ...(gptRoot && existsSync(gptRoot) ? [join(gptRoot, 'voices'), join(gptRoot, 'reference_audio')] : []),
  ].filter((d) => d && existsSync(d))

  const existingWavs = []
  for (const d of probeDirs) {
    try {
      for (const fn of readdirSync(d)) {
        if (/\.(wav|mp3|flac)$/i.test(fn)) {
          const full = join(d, fn)
          if (statSync(full).size >= 4096) existingWavs.push(full)
        }
      }
    } catch {}
  }

  if (existingWavs.length > 0) {
    // Ensure <idxRoot>/voices has at least one wav if empty
    if (idxRoot && existsSync(join(idxRoot, 'voices'))) {
      try {
        const hasAnyInVoices = readdirSync(join(idxRoot, 'voices')).some((f) => /\.(wav|mp3|flac)$/i.test(f))
        if (!hasAnyInVoices) {
          const dst = join(idxRoot, 'voices', basename(existingWavs[0]))
          copyFileSync(existingWavs[0], dst)
          created.push(dst)
        }
      } catch {}
    }
    return { ok: true, refPath: existingWavs[0], created, existingCount: existingWavs.length }
  }

  // Synthesize crisp 24kHz default Chinese reference speaker WAV via Windows SAPI (zero GPU, built into Windows 10/11)
  const targetRefWav = join(packsBuiltinDir, '女主播-默认参考音色.wav')
  const promptText = '大家好，欢迎使用视频创作工作台，这是一段清晰纯净的默认中文播报参考音色。'
  if (process.platform === 'win32') {
    const { ffmpeg } = resolveBinaries()
    const rawTmp = join(packsBuiltinDir, `_sapi_seed_${Date.now()}.wav`)
    const b64Text = Buffer.from(promptText, 'utf8').toString('base64')
    const b64Out = Buffer.from(rawTmp, 'utf8').toString('base64')
    const psScript = [
      'Add-Type -AssemblyName System.Speech',
      '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64Text}'))`,
      `$out = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64Out}'))`,
      '$zh = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like "zh*" }',
      'if ($zh) { $synth.SelectVoice(($zh | Select-Object -First 1).VoiceInfo.Name) }',
      '$synth.Rate = 0',
      '$synth.SetOutputToWaveFile($out)',
      '$synth.Speak($text)',
      '$synth.Dispose()',
    ].join('; ')
    try {
      const r = await runCommandRedirected(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        { timeoutMs: 25_000 },
      )
      if (r.code === 0 && existsSync(rawTmp) && statSync(rawTmp).size > 2000) {
        const conv = await runCommandRedirected(
          ffmpeg,
          ['-y', '-i', rawTmp, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', targetRefWav],
          { timeoutMs: 25_000 },
        )
        try { rmSync(rawTmp, { force: true }) } catch {}
        if (conv.code === 0 && existsSync(targetRefWav)) {
          created.push(targetRefWav)
          if (idxRoot && existsSync(idxRoot)) {
            const idxVoices = join(idxRoot, 'voices')
            mkdirSync(idxVoices, { recursive: true })
            const mirrored = join(idxVoices, '女主播-默认参考音色.wav')
            if (!existsSync(mirrored)) {
              copyFileSync(targetRefWav, mirrored)
              created.push(mirrored)
            }
          }
          return { ok: true, refPath: targetRefWav, promptText, created, existingCount: 1 }
        }
      }
    } catch {}
    try { rmSync(rawTmp, { force: true }) } catch {}
  }

  return { ok: false, refPath: '', created, existingCount: 0 }
}

const VOICE_FILENAME_PRESETS = {
  '女主播': {
    id: 'indextts-female-anchor',
    name: '知性女主播 (IndexTTS-2.5)',
    category: 'IndexTTS-2.5 内置',
    ageGroup: 'adult',
    gender: 'female',
    tags: ['女主播', '新闻', '科技', '商业', '科普', '清晰', '现代', '产品'],
    emotions: ['平静', '高兴'],
    roles: ['narrator', 'host', 'anchor', 'female'],
  },
  '无底噪': {
    id: 'indextts-clean-studio',
    name: '纯净无底噪旁白 (IndexTTS-2.5)',
    category: 'IndexTTS-2.5 内置',
    ageGroup: 'adult',
    gender: 'neutral',
    tags: ['无底噪', '旁白', '教程', '通用', '演示', '客观', '技术'],
    emotions: ['平静'],
    roles: ['narrator', 'instructor', 'system'],
  },
  '苏瑶': {
    id: 'indextts-suyao',
    name: '苏瑶·温婉叙事女声 (IndexTTS-2.5)',
    category: 'IndexTTS-2.5 内置',
    ageGroup: 'youth',
    gender: 'female',
    tags: ['苏瑶', '温婉', '故事', '人文', '治愈', '情感', '动漫', '文学'],
    emotions: ['平静', '高兴', '伤心', '害怕'],
    roles: ['female', 'storyteller', 'narrator', 'heroine'],
  },
  '评书': {
    id: 'indextts-pingshu',
    name: '传统评书·激昂说书人 (IndexTTS-2.5)',
    category: 'IndexTTS-2.5 内置',
    ageGroup: 'middle-aged',
    gender: 'male',
    tags: ['评书', '历史', '悬疑', '故事', '激昂', '国风', '传奇', '开场'],
    emotions: ['高兴', '生气', '害怕', '平静'],
    roles: ['storyteller', 'male', 'historian'],
  },
}

function slugifyId(str) {
  const base = String(str || 'voice')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || `voice-${Date.now()}`
}

/**
 * Ultra-fast WAV duration reader (reads only the first 128 bytes of the file header)
 * so scanning 200+ WAV files in a multi-folder voice pack takes < 30ms.
 */
export function fastReadWavDurationSec(filePath) {
  try {
    const st = statSync(filePath)
    if (st.size < 44) return null
    const fd = openSync(filePath, 'r')
    const header = Buffer.alloc(Math.min(256, st.size))
    readSync(fd, header, 0, header.length, 0)
    closeSync(fd)
    if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') {
      return null
    }
    let offset = 12
    let byteRate = 0
    while (offset + 8 <= header.length) {
      const chunkId = header.toString('ascii', offset, offset + 4)
      const chunkSize = header.readUInt32LE(offset + 4)
      if (chunkId === 'fmt ' && offset + 20 <= header.length) {
        byteRate = header.readUInt32LE(offset + 16)
        break
      }
      offset += 8 + chunkSize + (chunkSize % 2)
    }
    if (byteRate > 0) {
      return Number(((st.size - 44) / byteRate).toFixed(2))
    }
  } catch {}
  return null
}

/**
 * Smart metadata parser tailored for structured Chinese voice pack directories
 * such as `<VOICE_PACK_ROOT>/不同年龄人群音色/{中年-男声, 孩童, 热门音色, 老年}/*.wav`.
 */
export function inferVoiceMetadataFromPath(filePath, categoryHint = '') {
  const ext = extname(filePath).toLowerCase()
  const rawStem = basename(filePath, ext)
  const parentName = categoryHint || basename(dirname(filePath))

  // Clean leading numeric timestamp (`1717752345764-老妇叫卖试听` -> `老妇叫卖`)
  const cleanedName = rawStem
    .replace(/^\d{8,}-/, '')
    .replace(/试听$/g, '')
    .trim()

  const combined = `${parentName} ${cleanedName}`

  // 1. Category determination
  let category = parentName || '本地音色'
  if (category === 'voices') category = 'IndexTTS-2.5 内置'

  // 2. Gender inference
  let gender = 'neutral'
  const femaleKeywords = /(女|姐|妹|娘|妃|后|姑|妈|奶|萝莉|佳佳|璐|雯|姝|甜|琴|娇|媚|狐|花魁|冰淇淋|颜姐|巧克力|小西|师太|老妇|老鸨|婶)/
  const maleKeywords = /(男|叔|哥|爷|公公|军士|大当家|小伙|霸总|侠客|书童|帝王|掌门|白马|少年侠|小帅|小石头|球球|智峻|沈磊|周野芒|袁野)/
  if (parentName.includes('男') || cleanedName.startsWith('男-') || cleanedName.includes('（男')) {
    gender = 'male'
  } else if (parentName.includes('女') || cleanedName.startsWith('女-') || cleanedName.includes('（女')) {
    gender = 'female'
  } else if (femaleKeywords.test(combined) && !maleKeywords.test(combined)) {
    gender = 'female'
  } else if (maleKeywords.test(combined)) {
    gender = 'male'
  }

  // 3. Age group inference
  let ageGroup = 'adult'
  if (/(孩童|儿童|\d+-\d+岁|\d+岁|小男孩|小女孩|小孩|书童|奶声|奶凶|稚嫩|萝莉)/.test(combined)) {
    ageGroup = 'child'
  } else if (/(老年|老妇|奶奶|太后|师太|长老|沧桑|老年嗓|老年音|老顽童)/.test(combined)) {
    ageGroup = 'elderly'
  } else if (/(中年|中老年|45岁|大叔|青叔|婶)/.test(combined)) {
    ageGroup = 'middle-aged'
  } else if (/(青年|少年|少女|小哥|小姐|师妹|师姐|学霸|学堂)/.test(combined)) {
    ageGroup = 'youth'
  }

  // 4. Tokenize descriptive tags from folder + filename
  const rawTokens = cleanedName
    .split(/[-—_、，,\s（）()\[\]【】！!]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '中文' && s !== '1' && s !== '2')

  const tagSet = new Set([category, ...rawTokens])
  if (gender === 'male') tagSet.add('男声')
  if (gender === 'female') tagSet.add('女声')
  if (ageGroup === 'child') tagSet.add('少儿')
  if (ageGroup === 'elderly') tagSet.add('老年')
  if (ageGroup === 'middle-aged') tagSet.add('中年')
  if (ageGroup === 'youth') tagSet.add('青年')

  // Semantic domain enrichment for AI voice matcher
  if (/(纪录|专题|宣传片|党政|旁白)/.test(combined)) {
    tagSet.add('纪录片')
    tagSet.add('旁白')
    tagSet.add('宣传片')
  }
  if (/(解说|up主|主播|带货|播报)/.test(combined)) {
    tagSet.add('解说')
    tagSet.add('短视频')
    tagSet.add('主播')
  }
  if (/(故事|有声书|文学|独白|娓娓道来)/.test(combined)) {
    tagSet.add('故事')
    tagSet.add('有声书')
    tagSet.add('叙事')
  }
  if (/(侠|公公|太后|妃|掌门|师叔|师妹|师姐|古板|长老|花魁)/.test(combined)) {
    tagSet.add('古风')
    tagSet.add('角色配音')
    tagSet.add('剧情')
  }

  // 5. Emotions & Roles inference
  const emotions = ['平静']
  if (/(活泼|热情|开朗|甜美|可爱|阳光|欢快|有趣)/.test(combined)) emotions.push('高兴')
  if (/(哀|伤|虚弱|沧桑|深沉|低沉)/.test(combined)) emotions.push('伤心')
  if (/(凶狠|嚣张|恶毒|阴狠|傲慢|刻薄|作威作福|毒舌|霸总|威严)/.test(combined)) emotions.push('生气')
  if (/(求饶|害怕|病娇)/.test(combined)) emotions.push('害怕')
  if (emotions.length === 1) emotions.push('高兴')

  const roles = []
  if (/(旁白|解说|专题|纪录|文学|有声书|讲述)/.test(combined)) roles.push('narrator', 'documentary')
  if (/(主播|up主|播报|带货)/.test(combined)) roles.push('host', 'anchor')
  if (/(故事|有声书|独白)/.test(combined)) roles.push('storyteller')
  if (ageGroup === 'child') roles.push('child')
  if (ageGroup === 'elderly') roles.push('elder')
  roles.push(gender === 'female' ? 'female' : gender === 'male' ? 'male' : 'narrator')

  const durationSec = ext === '.wav' ? fastReadWavDurationSec(filePath) : null

  return {
    id: `pack-${slugifyId(`${category}-${cleanedName}`)}`,
    name: cleanedName,
    category,
    ageGroup,
    gender,
    tags: Array.from(tagSet),
    emotions: Array.from(new Set(emotions)),
    roles: Array.from(new Set(roles)),
    durationSec,
  }
}

export function getVoicePacksDir() {
  loadEnv()
  const dir = resolveEnvPath('VOICE_PACKS_DIR', './voice-packs')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  if (REPO_ROOT !== PACKAGE_ROOT) {
    const pkgEx = join(PACKAGE_ROOT, 'voice-packs', 'catalog.example.json')
    const dstEx = join(dir, 'catalog.example.json')
    if (existsSync(pkgEx) && !existsSync(dstEx)) {
      try {
        copyFileSync(pkgEx, dstEx)
      } catch {}
    }
  }
  return dir
}

function expandEnvPlaceholders(str) {
  if (!str || typeof str !== 'string') return ''
  return str.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => process.env[key] || '')
}

/**
 * Discover emotion reference WAV files from INDEXTTS_ROOT/情感参考 and EXTRA_VOICE_SCAN_DIRS.
 */
export function discoverEmotionReferences() {
  loadEnv()
  const emoMap = {}
  const candidateDirs = []
  const idxRoot = resolveEnvPath('INDEXTTS_ROOT', '')
  if (idxRoot && existsSync(join(idxRoot, '情感参考'))) {
    candidateDirs.push(join(idxRoot, '情感参考'))
  }
  const extraRaw = process.env.EXTRA_VOICE_SCAN_DIRS || ''
  for (const part of extraRaw.split(';').map((s) => s.trim()).filter(Boolean)) {
    const abs = isAbsolute(part) ? part : resolve(REPO_ROOT, part)
    if (existsSync(abs) && (basename(abs).includes('情感') || existsSync(join(abs, '平静.wav')))) {
      candidateDirs.push(abs)
    }
  }
  for (const emoDir of candidateDirs) {
    if (!existsSync(emoDir) || !statSync(emoDir).isDirectory()) continue
    for (const entry of readdirSync(emoDir)) {
      const ext = extname(entry).toLowerCase()
      if (['.wav', '.mp3', '.flac'].includes(ext)) {
        const label = basename(entry, ext)
        if (!emoMap[label]) emoMap[label] = join(emoDir, entry)
      }
    }
  }
  return emoMap
}

/**
 * Recursively scan a directory (up to depth 4) for `.wav`/`.mp3`/`.flac`/`.pt` and `voices.json`/`manifest.json`.
 */
function scanDirectoryRecursive(dir, registerEntry, depth = 0, maxDepth = 4) {
  if (depth > maxDepth || !existsSync(dir)) return
  let st
  try {
    st = statSync(dir)
  } catch {
    return
  }
  if (!st.isDirectory()) return

  const dirBaseName = basename(dir)
  // `_uploads` / `_previews` are the workbench's own temp folders (staged uploads, audition WAVs), never voices
  if (
    dirBaseName === '情感参考' ||
    dirBaseName === 'node_modules' ||
    dirBaseName === '_uploads' ||
    dirBaseName === '_previews' ||
    dirBaseName.startsWith('.')
  ) {
    return
  }

  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    let itemStat
    try {
      itemStat = statSync(fullPath)
    } catch {
      continue
    }

    if (itemStat.isDirectory()) {
      scanDirectoryRecursive(fullPath, registerEntry, depth + 1, maxDepth)
      continue
    }

    const ext = extname(entry).toLowerCase()
    const stem = basename(entry, ext)

    // 1. Check `voices.json` or `manifest.json`
    if (entry === 'voices.json' || entry === 'manifest.json') {
      try {
        const json = JSON.parse(readFileSync(fullPath, 'utf8'))
        if (Array.isArray(json.voices)) {
          for (const v of json.voices) {
            const refRel = v.refAudio || v.refPath || ''
            const refAbs = refRel ? resolve(dir, refRel) : ''
            registerEntry({
              ...v,
              id: v.id || `pack-${slugifyId(v.name)}`,
              category: v.category || json.packName || dirBaseName,
              refPath: refAbs,
              source: 'discovered-manifest',
            })
          }
        } else if (typeof json === 'object' && json !== null) {
          for (const [k, val] of Object.entries(json)) {
            if (!val || typeof val !== 'object' || !val.ref_audio) continue
            let refAbs = resolve(dir, val.ref_audio)
            if (!existsSync(refAbs)) {
              refAbs = resolve(dirname(dir), val.ref_audio)
            }
            const isMale = k.toUpperCase().startsWith('M') || String(val.ref_audio).includes('male')
            registerEntry({
              id: `discovered-${slugifyId(k)}`,
              name: isMale ? `纪录片沉稳男声 (${k})` : `叙事温婉女声 (${k})`,
              category: '纪录片与旁白',
              ageGroup: 'adult',
              engine: 'indextts25',
              gender: isMale ? 'male' : 'female',
              tags: isMale
                ? ['纪录片', '沉稳', '浑厚', '历史', '文化', '宣传片', '大气', '男声']
                : ['叙事', '纪录片', '故事', '清亮', '人文', '女声'],
              emotions: ['平静', '高兴', '伤心'],
              roles: isMale ? ['narrator', 'male', 'documentary'] : ['narrator', 'female', 'storyteller'],
              promptText: val.prompt_text || '',
              refPath: refAbs,
              durationSec: extname(refAbs).toLowerCase() === '.wav' ? fastReadWavDurationSec(refAbs) : null,
              source: 'discovered-voices-json',
            })
          }
        }
      } catch {}
      continue
    }

    // 2. Audio / Speaker Tensor files (`.wav`, `.mp3`, `.flac`, `.pt`) — ignore `.url`, `.txt`, etc.
    if (['.pt', '.wav', '.mp3', '.flac'].includes(ext)) {
      let effectivePath = fullPath
      if (ext === '.pt') {
        const siblingAudio = ['.wav', '.mp3', '.flac']
          .map((audioExt) => fullPath.replace(/\.pt$/i, audioExt))
          .find((cand) => existsSync(cand))
        if (siblingAudio) effectivePath = siblingAudio
      }
      const effExt = extname(effectivePath).toLowerCase()
      const preset = VOICE_FILENAME_PRESETS[stem]
      if (preset) {
        registerEntry({
          ...preset,
          engine: effExt === '.pt' ? 'indextts2' : 'indextts25',
          refPath: effectivePath,
          durationSec: effExt === '.wav' ? fastReadWavDurationSec(effectivePath) : preset.durationSec ?? null,
          source: 'discovered-local',
        })
      } else {
        const inferred = inferVoiceMetadataFromPath(effectivePath, dirBaseName)
        registerEntry({
          ...inferred,
          engine: effExt === '.pt' ? 'indextts2' : 'indextts25',
          refPath: effectivePath,
          source: 'discovered-voice-pack',
        })
      }
    }
  }
}

/**
 * Load user-saved catalog (`voice-packs/catalog.json`) + template + auto-discovered local voices
 * (including multi-level directories configured in `EXTRA_VOICE_SCAN_DIRS`).
 */
function extractVoiceCastJson(raw = '') {
  const txt = String(raw || '').trim()
  if (!txt) return null
  try { return JSON.parse(txt) } catch {}
  const fenced = txt.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1].trim()) } catch {}
  }
  const a = txt.indexOf('{')
  const b = txt.lastIndexOf('}')
  if (a >= 0 && b > a) {
    try { return JSON.parse(txt.slice(a, b + 1)) } catch {}
  }
  return null
}

export function isVoiceQualityOk(v) {
  if (!v || !v.available) return false
  if (v.isAudioSample && v.durationSec !== null && v.durationSec < 3.0) return false
  if (/(纯欲|叫卖|老鸨|太监|流氓|病娇|阴狠|恶毒)/.test(v.name || '') && v.durationSec !== null && v.durationSec < 3.5) {
    return false
  }
  return true
}

export function syncVoiceLibraryJson(voices = [], categories = {}, packsDir = '') {
  try {
    const dir = packsDir || getVoicePacksDir()
    const libPath = join(dir, 'voice_library.json')
    const qualityVoices = (voices || []).map((v) => ({
      id: v.id,
      name: v.name,
      category: v.category,
      gender: v.gender,
      ageGroup: v.ageGroup,
      durationSec: v.durationSec,
      tags: v.tags || [],
      emotions: v.emotions || [],
      roles: v.roles || [],
      available: Boolean(v.available),
      qualityOk: isVoiceQualityOk(v),
      source: v.source || 'catalog',
      refPath: v.resolvedRefPath || v.refPath || '',
    }))
    const payload = {
      updatedAt: new Date().toISOString(),
      totalVoices: qualityVoices.length,
      qualityCount: qualityVoices.filter((x) => x.qualityOk).length,
      categories,
      voices: qualityVoices,
    }
    writeFileSync(libPath, JSON.stringify(payload, null, 2) + '\n', 'utf8')
    return libPath
  } catch {
    return ''
  }
}

export function getVoiceCatalog() {
  loadEnv()
  const packsDir = getVoicePacksDir()
  const catalogPath = join(packsDir, 'catalog.json')
  const examplePath = join(packsDir, 'catalog.example.json')
  const { idxRoot, gptRoot } = resolveConfiguredTtsRoots()
  const hasInferV25 = Boolean(idxRoot && existsSync(join(idxRoot, 'indextts', 'infer_v2_5.py')))
  const supportsLegacyPt =
    String(process.env.DEFAULT_TTS_ENGINE || 'indextts25').trim().toLowerCase() === 'indextts2' && !hasInferV25

  const byId = new Map()
  const refOwner = new Map() // normalized reference file → id of the voice that registered it first
  const aliasOf = new Map() // id of a skipped duplicate → id of the voice it duplicates

  const registerEntry = (raw) => {
    if (!raw || !raw.id) return
    const expandedRef = expandEnvPlaceholders(raw.refPath || raw.refAudio || '')
    let resolvedRef = expandedRef
      ? isAbsolute(expandedRef)
        ? expandedRef
        : resolve(REPO_ROOT, expandedRef)
      : ''
    if (resolvedRef && resolvedRef.toLowerCase().endsWith('.pt')) {
      const siblingAudio = ['.wav', '.mp3', '.flac']
        .map((audioExt) => resolvedRef.replace(/\.pt$/i, audioExt))
        .find((cand) => existsSync(cand))
      if (siblingAudio) resolvedRef = siblingAudio
    }
    // A file the folder scan finds again (e.g. the copy an import made in imported/<id>/) belongs to the voice already
    // registered for it — listing it a second time as `pack-…` showed every imported voice twice.
    const refKey = resolvedRef ? (process.platform === 'win32' ? resolve(resolvedRef).toLowerCase() : resolve(resolvedRef)) : ''
    if (refKey && String(raw.source || '').startsWith('discovered') && refOwner.has(refKey) && refOwner.get(refKey) !== raw.id) {
      // keep the old id working for projects that picked the duplicate (scene voiceId, default voice)
      aliasOf.set(raw.id, refOwner.get(refKey))
      return
    }
    if (refKey && !refOwner.has(refKey)) refOwner.set(refKey, raw.id)
    const resolvedExt = extname(resolvedRef || '').toLowerCase()
    const isLegacyPt = resolvedExt === '.pt'
    const isAudioSample = ['.wav', '.mp3', '.flac'].includes(resolvedExt)
    const fileExists = Boolean(resolvedRef && existsSync(resolvedRef))
    byId.set(raw.id, {
      id: raw.id,
      name: raw.name || raw.id,
      category: raw.category || '默认分类',
      ageGroup: raw.ageGroup || 'adult',
      engine: raw.engine || (isLegacyPt ? 'indextts2' : 'indextts25'),
      gender: raw.gender || 'neutral',
      language: raw.language || 'zh-CN',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      emotions: Array.isArray(raw.emotions) ? raw.emotions : ['平静'],
      roles: Array.isArray(raw.roles) ? raw.roles : ['narrator'],
      promptText: raw.promptText || '',
      refPath: raw.refPath || raw.refAudio || '',
      resolvedRefPath: resolvedRef,
      available: fileExists && (!isLegacyPt || supportsLegacyPt),
      isLegacyPt,
      isAudioSample,
      requiresWav: isLegacyPt && !supportsLegacyPt,
      durationSec: raw.durationSec ?? (resolvedExt === '.wav' && fileExists ? fastReadWavDurationSec(resolvedRef) : null),
      source: raw.source || 'catalog',
    })
  }

  if (existsSync(examplePath)) {
    try {
      const parsed = JSON.parse(readFileSync(examplePath, 'utf8'))
      for (const v of parsed.voices || []) {
        registerEntry({ ...v, category: v.category || 'IndexTTS-2.5 内置' })
      }
    } catch {}
  }

  if (existsSync(catalogPath)) {
    try {
      const parsed = JSON.parse(readFileSync(catalogPath, 'utf8'))
      for (const v of parsed.voices || []) registerEntry(v)
    } catch {}
  }

  const scanDirs = new Set()
  if (idxRoot && existsSync(idxRoot)) {
    const idxVoicesDir = join(idxRoot, 'voices')
    if (!existsSync(idxVoicesDir)) {
      try { mkdirSync(idxVoicesDir, { recursive: true }) } catch {}
    }
    for (const sub of ['voices', 'examples', 'prompts', 'reference_audio', 'assets']) {
      const cand = join(idxRoot, sub)
      if (existsSync(cand)) scanDirs.add(cand)
    }
  }
  if (gptRoot && existsSync(gptRoot)) {
    for (const sub of ['voices', 'reference_audio', 'examples', 'prompts']) {
      const cand = join(gptRoot, sub)
      if (existsSync(cand)) scanDirs.add(cand)
    }
  }
  const builtinPacksDir = join(packsDir, 'builtin')
  if (existsSync(builtinPacksDir)) scanDirs.add(builtinPacksDir)
  const importedPacksDir = join(packsDir, 'imported')
  if (existsSync(importedPacksDir)) scanDirs.add(importedPacksDir)
  const extraRaw = process.env.EXTRA_VOICE_SCAN_DIRS || ''
  for (const part of extraRaw.split(';').map((s) => s.trim()).filter(Boolean)) {
    const abs = isAbsolute(part) ? part : resolve(REPO_ROOT, part)
    if (existsSync(abs)) scanDirs.add(abs)
  }

  for (const dir of scanDirs) {
    scanDirectoryRecursive(dir, registerEntry, 0, 4)
  }

  const defaultRef = resolveEnvPath('DEFAULT_REF_AUDIO', '')
  if (defaultRef && existsSync(defaultRef)) {
    registerEntry({
      id: 'default-ref-voice',
      name: '默认参考音色 (Default Ref)',
      category: '默认参考',
      ageGroup: 'adult',
      engine: 'indextts2',
      gender: 'neutral',
      tags: ['默认', '参考音色', '通用', '对话'],
      emotions: ['平静', '高兴'],
      roles: ['narrator', 'character'],
      promptText: process.env.DEFAULT_REF_TEXT || '',
      refPath: defaultRef,
      durationSec: fastReadWavDurationSec(defaultRef),
      source: 'env-default',
    })
  }

  const voices = Array.from(byId.values())
  const categories = {}
  for (const v of voices) {
    const cat = v.category || '未分类'
    categories[cat] = (categories[cat] || 0) + 1
  }

  const emotionReferences = discoverEmotionReferences()
  const voiceLibraryPath = syncVoiceLibraryJson(voices, categories, packsDir)
  voiceIdAliases = aliasOf
  return {
    voices,
    categories,
    emotionReferences,
    catalogPath,
    voiceLibraryPath,
    aliases: Object.fromEntries(aliasOf),
  }
}

/** Ids of de-duplicated catalog entries → the voice they duplicate (refreshed by every getVoiceCatalog call). */
let voiceIdAliases = new Map()
/** The id to use for a requested voice id: itself, or the voice a de-duplicated `pack-…` id now points to. */
export function resolveVoiceIdAlias(id) {
  const s = String(id || '')
  return voiceIdAliases.get(s) || s
}

/**
 * Save user-imported voice entries into `voice-packs/catalog.json`.
 */
function saveUserVoicesToCatalog(newEntries) {
  const packsDir = getVoicePacksDir()
  const catalogPath = join(packsDir, 'catalog.json')
  let existing = { version: '1.0.0', updatedAt: new Date().toISOString(), voices: [] }
  if (existsSync(catalogPath)) {
    try {
      existing = JSON.parse(readFileSync(catalogPath, 'utf8'))
      if (!Array.isArray(existing.voices)) existing.voices = []
    } catch {}
  }

  const map = new Map(existing.voices.map((v) => [v.id, v]))
  for (const item of newEntries) {
    map.set(item.id, item)
  }
  existing.updatedAt = new Date().toISOString()
  existing.voices = Array.from(map.values())
  writeFileSync(catalogPath, JSON.stringify(existing, null, 2) + '\n', 'utf8')
  return catalogPath
}

// Files that belong to one voice: its reference audio plus same-stem siblings (speaker tensor, transcript)
const VOICE_FILE_EXTS = new Set(['.wav', '.mp3', '.flac', '.pt', '.txt'])
const IS_WIN = process.platform === 'win32'
const fsKey = (p) => (IS_WIN ? resolve(p).toLowerCase() : resolve(p))
const stemKey = (name) => (IS_WIN ? String(name).toLowerCase() : String(name))

/** `child` lies strictly inside `root` (case-insensitive on Windows). */
function isInsideDir(root, child) {
  const r = fsKey(root)
  return Boolean(child) && fsKey(child).startsWith(r.endsWith(sep) ? r : r + sep)
}

/** True when `target`, or any existing folder between `root` and it, is a symlink / junction (never delete through one). */
function hasLinkBelow(root, target) {
  const rel = relative(resolve(root), resolve(target))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return true
  let cur = resolve(root)
  for (const part of rel.split(sep)) {
    cur = join(cur, part)
    let st
    try {
      st = lstatSync(cur)
    } catch {
      return false
    }
    if (st.isSymbolicLink()) return true
  }
  return false
}

/**
 * Drop a deleted voice from the pack manifests (`voices.json` / `manifest.json`) under `imported/`, so the folder scan
 * does not list it again. Only entries with the voice's id or pointing at one of its deleted files are removed.
 */
function pruneVoiceManifests(importedDir, voiceId, goneKeys) {
  const changed = []
  const visit = (dir, depth) => {
    if (depth > 4) return
    let ents = []
    try {
      ents = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of ents) {
      const p = join(dir, ent.name)
      if (ent.isSymbolicLink()) continue
      if (ent.isDirectory()) {
        if (!ent.name.startsWith('.') && !['_uploads', '_previews', 'node_modules', '情感参考'].includes(ent.name)) visit(p, depth + 1)
        continue
      }
      if (!ent.isFile() || (ent.name !== 'voices.json' && ent.name !== 'manifest.json')) continue
      let json
      try {
        json = JSON.parse(readFileSync(p, 'utf8'))
      } catch {
        continue
      }
      let dirty = false
      if (Array.isArray(json?.voices)) {
        // same id rule as scanDirectoryRecursive
        const keep = json.voices.filter((v) => {
          const refRel = v?.refAudio || v?.refPath || ''
          const gone = refRel && goneKeys.has(fsKey(resolve(dir, refRel)))
          return !((v?.id || `pack-${slugifyId(v?.name)}`) === voiceId || gone)
        })
        if (keep.length !== json.voices.length) {
          json.voices = keep
          dirty = true
        }
      } else if (json && typeof json === 'object') {
        for (const [k, val] of Object.entries(json)) {
          if (!val || typeof val !== 'object' || !val.ref_audio) continue
          const gone = goneKeys.has(fsKey(resolve(dir, val.ref_audio))) || goneKeys.has(fsKey(resolve(dirname(dir), val.ref_audio)))
          if (`discovered-${slugifyId(k)}` === voiceId || gone) {
            delete json[k]
            dirty = true
          }
        }
      }
      if (dirty) {
        writeFileSync(p, JSON.stringify(json, null, 2) + '\n', 'utf8')
        changed.push(p)
      }
    }
  }
  visit(importedDir, 0)
  return changed
}

/**
 * Delete ONE user-imported / cloned voice — exactly that voice, on the first call:
 *  - its reference audio plus same-stem siblings (`.wav/.mp3/.flac/.pt/.txt`) — never the other voices of a pack;
 *  - every `catalog.json` entry that points at those files, and its entry in a pack manifest (`voices.json` /
 *    `manifest.json`), so the folder scan does not list it again;
 *  - a folder only when it is the voice's own `imported/<id>/` folder and nothing else is left in it (never recursive).
 * The voice is found by exact id: its catalog entry and/or the voice(s) the folder scanner derives this id from inside
 * `imported/` (e.g. `pack-<pack>-<file>` of a zip-imported pack). Built-in voices and anything outside
 * `voice-packs/imported/` are refused; files behind a symlink / junction are never deleted.
 */
export function deleteImportedVoice(voiceId) {
  const raw = String(voiceId || '').trim()
  if (!raw || raw.length > 200 || /[\\/]|\.\./.test(raw)) throw new Error(`非法的音色 ID: ${raw.slice(0, 80)}`)
  const packsDir = getVoicePacksDir()
  const importedDir = resolve(packsDir, 'imported')
  const catalogPath = join(packsDir, 'catalog.json')
  const relOut = (p) => relative(packsDir, p).replace(/\\/g, '/')

  let catalog = { version: '1.0.0', updatedAt: new Date().toISOString(), voices: [] }
  if (existsSync(catalogPath)) {
    try {
      catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
      if (!Array.isArray(catalog.voices)) catalog.voices = []
    } catch {}
  }
  const refOf = (v) => {
    const p = expandEnvPlaceholders(v?.refPath || v?.refAudio || '')
    return p ? resolve(REPO_ROOT, p) : ''
  }
  // Exact matches only — never guess by prefix or by folder
  const entry = catalog.voices.find((v) => v.id === raw) || null
  const refs = new Map() // fsKey → reference file of this voice
  if (entry) {
    const refAbs = refOf(entry)
    if (!isInsideDir(importedDir, refAbs)) throw new Error(`「${entry.name || entry.id}」不是导入/克隆音色，内置音色不可删除`)
    refs.set(fsKey(refAbs), refAbs)
  }
  let discoveredName = ''
  if (existsSync(importedDir)) {
    scanDirectoryRecursive(
      importedDir,
      (e) => {
        if (e?.id !== raw || !e.refPath) return
        if (!discoveredName) discoveredName = e.name || ''
        refs.set(fsKey(e.refPath), resolve(e.refPath))
      },
      0,
      4,
    )
  }
  if (!entry && refs.size === 0) return { ok: false, removedId: '', error: `未找到可删除的导入音色: ${raw}` }

  // The voice's files: each reference file and its same-stem siblings in the same folder (inside imported/, no links)
  const files = new Map()
  const linked = []
  for (const ref of refs.values()) {
    if (!isInsideDir(importedDir, ref)) continue // e.g. a manifest entry pointing outside: only the entry is dropped
    if (hasLinkBelow(importedDir, ref)) {
      linked.push(ref)
      continue
    }
    const dir = dirname(ref)
    const stem = stemKey(basename(ref, extname(ref)))
    let names = []
    try {
      names = readdirSync(dir)
    } catch {}
    const group = []
    for (const n of names) {
      if (!VOICE_FILE_EXTS.has(extname(n).toLowerCase()) || stemKey(basename(n, extname(n))) !== stem) continue
      const p = join(dir, n)
      try {
        if (lstatSync(p).isFile()) group.push(p)
      } catch {}
    }
    // the reference itself first: if it cannot be removed, its siblings are left alone
    group.sort((a, b) => Number(fsKey(b) === fsKey(ref)) - Number(fsKey(a) === fsKey(ref)))
    for (const p of group) files.set(fsKey(p), p)
  }
  if (linked.length > 0) {
    // Nothing is touched: deleting through a symlink / junction would remove files outside voice-packs/imported/
    return {
      ok: false,
      refused: true,
      removedId: '',
      error: `音色「${entry?.name || discoveredName || raw}」的文件位于符号链接 / 联接 (junction) 目录中，为安全起见不会删除: ${relOut(linked[0])}`,
    }
  }
  const removedFiles = []
  for (const p of files.values()) {
    try {
      unlinkSync(p)
      removedFiles.push(p)
    } catch (err) {
      throw new Error(`音色文件删除失败（可能正被其他程序占用）: ${relOut(p)} — ${err?.code || err?.message || err}`)
    }
  }

  // Catalog stays consistent: drop this id and every imported entry whose reference file is now gone
  const goneKeys = new Set(removedFiles.map(fsKey))
  for (const r of refs.values()) if (!existsSync(r)) goneKeys.add(fsKey(r))
  const removedCatalogIds = []
  catalog.voices = catalog.voices.filter((v) => {
    const ref = refOf(v)
    const drop = v.id === raw || (isInsideDir(importedDir, ref) && goneKeys.has(fsKey(ref)))
    if (drop) removedCatalogIds.push(v.id)
    return !drop
  })
  if (removedCatalogIds.length > 0) {
    catalog.updatedAt = new Date().toISOString()
    writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8')
  }
  const updatedManifests = existsSync(importedDir) ? pruneVoiceManifests(importedDir, raw, goneKeys) : []

  // A folder goes only when it is the voice's own imported/<id>/ folder (a real directory) and is now empty
  let folderRemoved = false
  let keptFolder = ''
  for (const id of new Set([raw, ...removedCatalogIds])) {
    if (!id || /[\\/]/.test(id) || id === '.' || id === '..') continue
    const own = join(importedDir, id)
    if (fsKey(dirname(own)) !== fsKey(importedDir)) continue
    let st = null
    try {
      st = lstatSync(own)
    } catch {}
    if (!st?.isDirectory()) continue // missing, a file, or a symlink / junction
    let left = []
    try {
      left = readdirSync(own)
    } catch {}
    if (left.length === 0) {
      try {
        rmdirSync(own)
        folderRemoved = true
      } catch {}
    } else if (id === raw) {
      keptFolder = own
    }
  }
  return {
    ok: true,
    removedId: raw,
    name: entry?.name || discoveredName || raw,
    removedFiles: removedFiles.map(relOut),
    removedCatalogIds,
    updatedManifests: updatedManifests.map(relOut),
    folderRemoved,
    keptFolder: keptFolder || undefined,
  }
}

/**
 * Import a custom voice pack from a single audio/.pt file, a multi-level directory,
 * or a `.zip` archive.
 */
export async function importVoicePack(options = {}) {
  const {
    sourcePath,
    id,
    name,
    category = '',
    gender = '',
    engine = 'indextts25',
    tags = [],
    emotions = ['平静', '高兴'],
    roles = ['narrator'],
    promptText = '',
    copyToVoicePacks,
  } = options

  if (!sourcePath) {
    throw new Error('sourcePath is required to import a voice pack.')
  }
  const absSource = isAbsolute(sourcePath) ? sourcePath : resolve(REPO_ROOT, sourcePath)
  if (!existsSync(absSource)) {
    throw new Error(`Voice pack source path does not exist: ${absSource}`)
  }

  const packsDir = getVoicePacksDir()
  const importedRoot = join(packsDir, 'imported')
  mkdirSync(importedRoot, { recursive: true })

  const stat = statSync(absSource)
  const importedVoices = []

  // Case 1: `.zip` archive -> extract into `voice-packs/imported/<packName>`
  let targetDir = null
  let shouldCopyFiles = Boolean(copyToVoicePacks)
  if (stat.isFile() && extname(absSource).toLowerCase() === '.zip') {
    const packSlug = slugifyId(basename(absSource, '.zip'))
    targetDir = join(importedRoot, packSlug)
    mkdirSync(targetDir, { recursive: true })
    if (process.platform === 'win32') {
      await runCommandRedirected('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${absSource.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force`,
      ])
    } else {
      await runCommandRedirected('unzip', ['-o', absSource, '-d', targetDir])
    }
  } else if (stat.isDirectory()) {
    targetDir = absSource
    // For existing local directories (e.g. multi-folder WAV voice packs), reference in-place by default
    shouldCopyFiles = copyToVoicePacks === true
  } else {
    shouldCopyFiles = copyToVoicePacks !== false
  }

  // Case 2: Directory (multi-level recursive scan supporting both manifest.json and categorized WAV folders)
  if (targetDir) {
    scanDirectoryRecursive(
      targetDir,
      (entry) => {
        let finalRef = entry.refPath
        if (shouldCopyFiles && finalRef && existsSync(finalRef) && !finalRef.startsWith(importedRoot)) {
          const destDir = join(importedRoot, entry.id)
          mkdirSync(destDir, { recursive: true })
          const destFile = join(destDir, basename(finalRef))
          copyFileSync(finalRef, destFile)
          finalRef = destFile
        }
        importedVoices.push({
          ...entry,
          category: category || entry.category || basename(targetDir),
          gender: gender || entry.gender || 'neutral',
          engine: engine || entry.engine || 'indextts2',
          promptText: promptText || entry.promptText || '',
          refPath: finalRef,
          source: 'user-imported-pack',
          importedAt: new Date().toISOString(),
        })
      },
      0,
      4,
    )
  } else {
    // Case 3: Single `.wav` / `.mp3` / `.flac` / `.pt` file
    const ext = extname(absSource).toLowerCase()
    const inferred = inferVoiceMetadataFromPath(absSource, category || '自定义音色')
    const voiceId = id ? slugifyId(id) : name ? slugifyId(`custom-${name}`) : inferred.id
    let finalRef = absSource
    if (shouldCopyFiles) {
      const destDir = join(importedRoot, voiceId)
      mkdirSync(destDir, { recursive: true })
      finalRef = join(destDir, basename(absSource))
      if (resolve(absSource) !== resolve(finalRef)) {
        copyFileSync(absSource, finalRef)
      }
    }
    let durationSec = inferred.durationSec
    if (durationSec === null && ext !== '.pt') {
      try {
        const probe = await probeAudioDuration(finalRef, 30)
        durationSec = probe.durationSec
      } catch {}
    }
    const userTags =
      typeof tags === 'string'
        ? tags.split(/[,，\s]+/).filter(Boolean)
        : Array.isArray(tags) && tags.length > 0
          ? tags
          : []

    importedVoices.push({
      id: voiceId,
      name: name || inferred.name,
      category: category || '自定义导入',
      ageGroup: inferred.ageGroup,
      engine,
      gender: gender || inferred.gender,
      tags: Array.from(new Set([...userTags, ...inferred.tags])),
      emotions: Array.isArray(emotions) && emotions.length > 0 ? emotions : inferred.emotions,
      roles: Array.isArray(roles) && roles.length > 0 ? roles : inferred.roles,
      promptText,
      refPath: finalRef,
      durationSec,
      source: 'user-imported-file',
      importedAt: new Date().toISOString(),
    })
  }

  if (importedVoices.length === 0) {
    throw new Error(`No valid audio (.wav/.mp3/.flac) or IndexTTS (.pt) files found in: ${absSource}`)
  }

  const catalogPath = saveUserVoicesToCatalog(importedVoices)
  const categoryBreakdown = {}
  for (const v of importedVoices) {
    categoryBreakdown[v.category] = (categoryBreakdown[v.category] || 0) + 1
  }

  return {
    importedCount: importedVoices.length,
    categoryBreakdown,
    importedVoices: importedVoices.slice(0, 30),
    totalPersistedInCatalog: importedVoices.length,
    catalogPath,
  }
}

/**
 * AI Voice Auto-Matcher + User Manual Override Selector.
 * Scores all catalog voices (including categorized local & imported voice packs)
 * against scene text, emotion, role, age group, and project audience/goal.
 */
export function matchVoiceForScene(scene = {}, projectMeta = {}, catalogVoices = null, explicitVoiceId = '') {
  const { voices, emotionReferences } = catalogVoices
    ? { voices: catalogVoices, emotionReferences: discoverEmotionReferences() }
    : getVoiceCatalog()

  if (!voices || voices.length === 0) {
    throw new Error('Voice catalog is empty. Please import a voice pack or check INDEXTTS_ROOT in .env.')
  }

  // 1. Check if user explicitly specified a voiceId or voice name (an id of a de-duplicated entry maps to its voice)
  const requestedId = resolveVoiceIdAlias(
    explicitVoiceId && explicitVoiceId !== 'auto'
      ? explicitVoiceId
      : scene.voiceLocked && scene.voiceId && scene.voiceId !== 'auto'
        ? scene.voiceId
        : projectMeta.voiceMode === 'manual' && projectMeta.defaultVoiceId && projectMeta.defaultVoiceId !== 'auto'
          ? projectMeta.defaultVoiceId
          : scene.voiceId && scene.voiceId !== 'auto'
            ? scene.voiceId
            : '',
  )

  if (requestedId) {
    const kw = requestedId.toLowerCase()
    const manualHit =
      voices.find((v) => v.id === requestedId || v.name === requestedId) ||
      voices.find((v) => v.id.toLowerCase().includes(kw) || v.name.toLowerCase().includes(kw))
    if (manualHit) {
      // Keep speaker's authentic timbre via native emo_vector / Qwen emo_text rather than foreign emotion clips
      return {
        voice: manualHit,
        emotionAudio: '',
        mode: 'manual',
        score: 100,
        reason: `用户指定音色: [${manualHit.category}] ${manualHit.name} (${manualHit.id})`,
      }
    }
  }

  // 2. AI Auto-Matching across all discovered & imported voice packs
  const contextText = [
    scene.title || '',
    scene.narration || scene.text || '',
    scene.visualPrompt || '',
    scene.role || '',
    projectMeta.genre || '',
    projectMeta.title || '',
    projectMeta.audience || '',
    projectMeta.goal || '',
    projectMeta.directorNotes || '',
  ]
    .join(' ')
    .toLowerCase()

  const sceneEmotion = (scene.emotion || '平静').trim()
  const sceneRole = (scene.role || 'narrator').trim().toLowerCase()

  // Detect age / style / genre hints from context
  const wantsChild = /(孩童|儿童|少儿|小孩|男孩|女孩|宝宝|童年|小学|幼儿园|child|kid)/.test(contextText)
  const wantsElderly = /(老年|老者|老爷爷|老奶奶|长老|太后|师太|岁月|沧桑|古稀|elder)/.test(contextText)
  const wantsYouth = /(青年|少年|少女|up主|短视频|青春|学霸|师妹|师姐|侠客|教程|上手)/.test(contextText)
  const isTutorialOrGuide = projectMeta.genre === 'ui-tutorial' || /(教程|教学|实操|操作|指南|工作台|插件|上手|入门|功能演示|点击)/.test(contextText)
  const isTechOrBiz = ['code-animation', 'product-promo', 'science-explainer'].includes(projectMeta.genre) || /(科技|架构|系统|代码|数据|引擎|产品|工作台|商业|ai|remotion|dsh)/.test(contextText)
  const isEpicOrDoc = projectMeta.genre === 'history-theater' || /(历史|千年|戈壁|山河|传奇|史诗|文明|霍去病|项羽|秦汉|三国|战役)/.test(contextText)
  const isWarmOrStory = ['brand-story', 'stickman-story'].includes(projectMeta.genre) || /(故事|温暖|心灵|情感|火柴人|漫步|治愈|回忆|文学|有声书)/.test(contextText)
  const primaryAnchorId = String(projectMeta?._primaryVoiceId || '').trim()
  const isStandardHostScene = !sceneRole || ['narrator', 'host', 'instructor', 'default'].includes(sceneRole)

  const scored = voices.map((v) => {
    let score = 40
    const reasons = []

    if (v.available) {
      score += 15
    } else {
      // Never pick `.pt`-only legacy tensors or missing files over verified zero-shot WAVs
      score -= v.requiresWav ? 80 : 60
    }
    if (v.isAudioSample && v.durationSec !== null && v.durationSec < 3.0) {
      score -= 48
    } else if (v.isAudioSample && v.durationSec >= 4.0 && v.durationSec <= 25.0) {
      score += 15
      reasons.push(`高清晰参考时长(${v.durationSec}s)`)
    } else if (v.isAudioSample && v.durationSec > 25.0) {
      score += 10
    }
    if (v.source === 'env-default' && voices.some((x) => x.available && x.isAudioSample && x.source !== 'env-default')) {
      score -= 28
    }
    if (v.source === 'user-imported-file' || v.category === '专属声纹克隆') {
      score += 10
    }

    // Age group alignment (crucial when child/elderly voices are in catalog!)
    if (wantsChild) {
      if (v.ageGroup === 'child') {
        score += 30
        reasons.push('少儿角色年龄契合')
      } else {
        score -= 15
      }
    } else if (wantsElderly) {
      if (v.ageGroup === 'elderly') {
        score += 30
        reasons.push('长者沧桑声线契合')
      } else {
        score -= 10
      }
    } else {
      if (v.ageGroup === 'child') score -= 28
      if (v.ageGroup === 'elderly') score -= 18
    }

    if (wantsYouth && (v.ageGroup === 'youth' || /(青年|学霸|男青年|女青年|解说配音)/.test(v.name))) {
      score += 14
      reasons.push('青年活力声线')
    }

    // Penalize extreme villain/comic/domain-mismatch character archetypes on normal narration unless requested
    if (/(太监|流氓|恶毒|病娇|叫卖|老鸨|狐狸精|公公|傻|弱智)/.test(v.name) && !/(反派|太监|流氓|叫卖|剧情|搞笑)/.test(contextText)) {
      score -= 32
    }
    if (/(党政|动物|野史|古代帝王|老古板|刻薄)/.test(v.name) && !/(党政|政务|动物|古代帝王)/.test(contextText)) {
      score -= 28
    }
    if (primaryAnchorId && v.id === primaryAnchorId && isStandardHostScene) {
      score += 24
      reasons.push('全片主讲连贯音色')
    }

    // Role & gender alignment
    if (v.roles && v.roles.some((r) => r.toLowerCase() === sceneRole)) {
      score += 10
    }
    if ((sceneRole.includes('female') || sceneRole.includes('女')) && v.gender === 'female') {
      score += 18
      reasons.push('女性声线')
    } else if ((sceneRole.includes('male') || sceneRole.includes('男')) && v.gender === 'male') {
      score += 18
      reasons.push('男性声线')
    }

    // Emotion affinity
    if (Array.isArray(v.emotions) && v.emotions.includes(sceneEmotion)) {
      score += 6
    }

    // Tag keyword matching (cap contribution so generic tags like "专题/旁白" don't monopolize)
    const matchedTags = (v.tags || []).filter(
      (tag) => tag.length >= 2 && contextText.includes(String(tag).toLowerCase()),
    )
    if (matchedTags.length > 0) {
      score += Math.min(18, matchedTags.length * 7)
      reasons.push(`标签命中(${matchedTags.slice(0, 3).join('/')})`)
    }

    // Expressive genre scoring (breaks the monotone 男-专题 纪录 旁白 bias!)
    if (isTutorialOrGuide) {
      if (/(短视频解说青年男声|短视频温柔女青年解说|专业解说配音|阳光有趣的学霸小哥|大羊磁性舒适音|温软姐姐|温柔青年音)/.test(v.name)) {
        score += 26
        reasons.push('高活力教程讲解音色')
      } else if (/(男-专题 纪录 旁白|古板)/.test(v.name)) {
        score -= 12
      } else if (v.tags?.some((t) => ['解说', '主播', '无底噪', '清晰'].includes(t))) {
        score += 14
      }
    } else if (isEpicOrDoc) {
      if (/(男-低沉 厚重 历历在目|纪录片宣传片高质男音|文学旁白解说|若天歌|男-正经专注 流畅饱满|中年男烟酒嗓独白|男-专题 纪录 旁白)/.test(v.name)) {
        score += 26
        reasons.push('史诗浑厚纪录旁白')
      }
    } else if (isTechOrBiz) {
      if (/(专业解说配音|短视频解说青年男声|大羊磁性舒适音|纪录片宣传片高质男音|男-正经专注 流畅饱满|女主播|无底噪)/.test(v.name)) {
        score += 22
        reasons.push('科技商业专业解说')
      }
    } else if (isWarmOrStory) {
      if (/(苏瑶|台湾男青年音故事讲述|有声书主播|温柔贤淑|温和|温软姐姐|中音磁性女声旁白|文学旁白解说)/.test(v.name)) {
        score += 22
        reasons.push('故事情感叙事音色')
      }
    }

    return {
      voice: v,
      score: Math.max(1, Math.min(99, score)),
      reasons,
    }
  })

  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]
  // Keep authentic speaker timbre without blending third-party emotion reference audio
  const reasonSummary =
    best.reasons.length > 0 ? best.reasons.join(' + ') : '综合语境最优音色'

  return {
    voice: best.voice,
    emotionAudio: '',
    mode: 'auto',
    score: best.score,
    reason: `AI 自动匹配: [${best.voice.category}] ${best.voice.name} [匹配度 ${best.score}% — ${reasonSummary}]`,
  }
}

/**
 * Find the closest real WAV/audio voice matching a requested (possibly legacy `.pt`) voice profile.
 */
export function findBestAvailableWavVoice(voices = [], hintVoice = {}) {
  const wavPool = (voices || []).filter(
    (v) => v && v.available && v.isAudioSample && existsSync(v.resolvedRefPath || ''),
  )
  if (wavPool.length === 0) return null
  const wantGender = hintVoice?.gender || ''
  const wantTags = new Set((hintVoice?.tags || []).map((t) => String(t).toLowerCase()))
  const scored = wavPool
    .filter((v) => v.source !== 'env-default' || wavPool.length === 1)
    .map((v) => {
      let s = 30
      if (wantGender && wantGender !== 'neutral') {
        if (v.gender === wantGender) s += 30
        else if (v.gender !== 'neutral') s -= 20
      }
      if (v.ageGroup !== 'child' && v.ageGroup !== 'elderly') s += 10
      if (v.durationSec >= 4.0 && v.durationSec <= 12.0) s += 12
      if (/(专业解说|纪录片宣传片|旁白|故事|解说|沉稳|温柔)/.test(v.name)) s += 14
      for (const t of v.tags || []) {
        if (wantTags.has(String(t).toLowerCase())) s += 10
      }
      return { voice: v, score: s }
    })
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.voice || wavPool[0]
}

/**
 * Run AI voice matching (or apply manual overrides) across all scenes in `script.json`.
 */
export function matchAllScenesInScript(projectOrFile, options = {}) {
  const { data } = readScriptJson(projectOrFile)
  const { voices } = getVoiceCatalog()
  const forceAuto = Boolean(options.forceAuto)
  const globalVoiceId = options.voiceId || ''

  if (globalVoiceId) {
    data.defaultVoiceId = globalVoiceId
    data.voiceMode = globalVoiceId === 'auto' ? 'auto' : 'manual'
  }

  let primaryAnchorId = ''
  if (data.voiceMode !== 'manual' && (!globalVoiceId || globalVoiceId === 'auto')) {
    try {
      const sampleText = (data.scenes || []).slice(0, 6).map((s) => `${s.title || ''} ${s.narration || ''}`).join(' ')
      const anchorMatch = matchVoiceForScene(
        { title: data.title || '', narration: sampleText, role: 'narrator', emotion: '平静' },
        { ...data, _primaryVoiceId: '' },
        voices,
        '',
      )
      primaryAnchorId = anchorMatch?.voice?.id || ''
    } catch {}
  }

  const results = []
  data.scenes = (data.scenes || []).map((scene) => {
    // A voice the user picked by hand for this one scene (Web Studio inspector) beats both the global
    // voice and an automatic re-match, as long as that voice still exists in the catalog.
    const manualPick =
      scene.voiceCastBy === 'manual' &&
      scene.voiceLocked &&
      scene.voiceId &&
      scene.voiceId !== 'auto' &&
      voices.some((v) => v.id === scene.voiceId && v.available !== false)
    const effectiveScene = forceAuto && !manualPick ? { ...scene, voiceId: 'auto', voiceLocked: false } : scene
    const matched = matchVoiceForScene(
      effectiveScene,
      { ...data, _primaryVoiceId: primaryAnchorId },
      voices,
      manualPick ? scene.voiceId : globalVoiceId,
    )
    const updated = {
      ...scene,
      voiceId: matched.voice.id,
      voiceName: matched.voice.name,
      voiceCategory: matched.voice.category,
      voiceLocked: matched.mode === 'manual' ? true : Boolean(scene.voiceLocked && (!forceAuto || manualPick)),
      voiceMatchReason: manualPick ? `用户为本幕手动指定音色: ${matched.voice.name}` : matched.reason,
    }
    results.push({
      sceneId: updated.id,
      title: updated.title,
      voiceId: updated.voiceId,
      voiceName: updated.voiceName,
      category: updated.voiceCategory,
      mode: matched.mode,
      score: matched.score,
      reason: matched.reason,
    })
    return updated
  })

  const saved = writeScriptJson(projectOrFile, data)
  return {
    scriptPath: saved.scriptPath,
    voiceMode: saved.data.voiceMode,
    defaultVoiceId: saved.data.defaultVoiceId,
    matches: results,
  }
}

function curateCandidatesForLlm(voices = [], maxTotal = 55) {
  const clean = (voices || []).filter((v) => isVoiceQualityOk(v) && v.source !== 'env-default')
  const pool = clean.length >= 4 ? clean : (voices || []).filter((v) => v.available)
  // Prioritize narrator/host/story/expressive voices while preserving diverse character roles across categories
  const scored = pool.map((v) => {
    let w = 10
    if (v.source === 'user-imported-file' || v.category === '专属声纹克隆') w += 45
    if (/(解说|旁白|纪录片|宣传片|青年|学霸|主播|故事|有声|磁性|温柔|帝王|将军|大叔|青年音|少女|少儿|评书|苏瑶)/.test(v.name)) w += 25
    if (v.durationSec >= 4.5 && v.durationSec <= 25) w += 12
    if (/(太监|流氓|老鸨|叫卖|恶毒|病娇)/.test(v.name)) w -= 18
    return { v, w }
  })
  scored.sort((a, b) => b.w - a.w)
  return scored.slice(0, maxTotal).map(({ v }) => ({
    id: v.id,
    name: v.name,
    category: v.category,
    gender: v.gender,
    ageGroup: v.ageGroup,
    durationSec: v.durationSec,
    tags: (v.tags || []).filter((t) => t !== v.category).slice(0, 6),
  }))
}

/**
 * LLM Semantic Voice Casting:
 * Exposes curated high-quality voices from the local voice pack to the AI LLM so it picks
 * the best speaker(s), per-scene emotion & expressive speed instead of picking hardcoded defaults.
 */
export async function castVoicesWithLlm({
  projectDir,
  scriptData = null,
  genre = '',
  genreGuidance = '',
  callLlmChatFn,
} = {}) {
  if (typeof callLlmChatFn !== 'function') {
    return { ok: false, reason: 'missing callLlmChatFn' }
  }
  const data = scriptData || (projectDir ? readScriptJson(projectDir).data : null)
  if (!data || !Array.isArray(data.scenes) || data.scenes.length === 0) {
    return { ok: false, reason: 'no scenes' }
  }
  if (data.voiceMode === 'manual' && data.defaultVoiceId && data.defaultVoiceId !== 'auto') {
    return { ok: false, skipped: true, reason: 'manual defaultVoiceId locked' }
  }

  const { voices, categories } = getVoiceCatalog()
  const candidates = curateCandidatesForLlm(voices, 56)
  if (candidates.length === 0) {
    return { ok: false, reason: 'no quality candidates available' }
  }
  const byId = new Map(voices.map((v) => [v.id, v]))

  const system = `你是顶级音频配音选角导演（Voice Casting Director）。
你的职责：从用户的本地精品音色库中，根据创作主题、题材（教程/代码演示/历史剧场/火柴人故事/科普/宣发等）和每一幕的口播语境，为全片挑选**真实有感染力、抑扬顿挫**的配音音色，并为每一幕设定情绪词 \`voiceEmotion\` 与轻快自然的语速 \`speechRate\`。

硬性原则：
1. 只能从 \`availableVoices\` 的 \`id\` 中选取真实存在的音色！
2. 选角品味：
   - 实操教程 / 科技产品讲解：优先选“充满活力、清亮亲切、节奏明快”的解说音色（例如 短视频解说青年男声、短视频温柔女青年解说、专业解说配音、阳光有趣的学霸小哥、大羊磁性舒适音、温软姐姐 等），**严禁选用刻板沉闷老旧风格**，教程语速默认控制在 **1.06 ~ 1.14** 保持明快不拖沓！
   - 历史剧场 / 纪实传奇：主讲选“史诗浑厚、富有张力、抑扬顿挫”的中青年或纪录片旁白（如 男-低沉 厚重 历历在目、纪录片宣传片高质男音、文学旁白解说、若天歌 青叔音 等），人物台词可按角色（青年将领/帝王/老年谋士等）切换对应角色音色！
   - 角色动画 / 火柴人故事：按主角/旁白/反派分角色选音，富于戏剧张力！
3. 每幕必须填 \`voiceEmotion\`（推荐取值：高兴、欢快热情、激昂有力、自信、重点强调、温和、亲切、严肃强调、悬念低沉、深沉、悲壮、兴奋、期待），避免整片全写“平静”导致平淡无味！
4. 输出严格 JSON（无 Markdown 围栏）：
{
  "primaryVoiceId": "选中的主讲音色 id",
  "primaryReason": "为什么选该音色",
  "sceneCasting": [
    { "id": "scene-01", "voiceId": "可用同一主讲或切换角色音色 id", "voiceEmotion": "欢快热情", "speechRate": 1.08, "rationale": "一句选角理由" }
  ]
}`

  const user = JSON.stringify(
    {
      title: data.displayTitle || data.title || data.topic || '',
      genre: genre || data.genre || '',
      genreGuidance: genreGuidance || '',
      directorNotes: data.directorNotes || '',
      voiceCategoriesSummary: categories,
      availableVoices: candidates,
      scenes: data.scenes.map((s) => ({
        id: s.id,
        title: s.title,
        role: s.role || 'narrator',
        narration: s.narration || '',
        currentEmotion: s.emotion || '平静',
      })),
    },
    null,
    2,
  )

  const reply = await callLlmChatFn({
    system,
    messages: [{ role: 'user', content: user }],
    temperature: 0.35,
    maxTokens: 3200,
    timeoutMs: 90_000,
  })

  const parsed = extractVoiceCastJson(reply?.text || '')
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'LLM voice casting JSON parse failed' }
  }

  const primaryVoice = byId.get(parsed.primaryVoiceId) && isVoiceQualityOk(byId.get(parsed.primaryVoiceId))
    ? byId.get(parsed.primaryVoiceId)
    : byId.get(candidates[0]?.id)
  if (!primaryVoice) return { ok: false, reason: 'no valid primary voice resolved' }

  const castMap = new Map()
  for (const row of Array.isArray(parsed.sceneCasting) ? parsed.sceneCasting : []) {
    if (row?.id) castMap.set(String(row.id), row)
  }

  const isUpbeatGenre = ['ui-tutorial', 'code-animation', 'product-promo', 'stickman-story', 'talking-head', 'digital-human'].includes(genre || data.genre || '')
  const speedMin = isUpbeatGenre ? 1.03 : 0.94
  const speedMax = isUpbeatGenre ? 1.16 : 1.14

  data.defaultVoiceId = primaryVoice.id
  data.scenes = data.scenes.map((sc) => {
    const row = castMap.get(sc.id)
    const picked = row?.voiceId && byId.get(row.voiceId)?.available ? byId.get(row.voiceId) : primaryVoice
    const rawRate = Number(row?.speechRate || sc.speechRate || (isUpbeatGenre ? 1.07 : 1.02))
    const speechRate = Number(Math.max(speedMin, Math.min(speedMax, Number.isFinite(rawRate) ? rawRate : 1.06)).toFixed(2))
    const voiceEmotion = String(row?.voiceEmotion || row?.emotion || sc.emotion || '自信').trim()
    const finalEmo = voiceEmotion === '平静' && isUpbeatGenre ? '自信' : voiceEmotion

    if (sc.voiceLocked && sc.voiceId && sc.voiceId !== 'auto' && sc.voiceCastBy === 'manual') {
      return sc
    }
    return {
      ...sc,
      voiceId: picked.id,
      voiceName: picked.name,
      voiceCategory: picked.category,
      voiceEmotion: finalEmo,
      emotion: finalEmo,
      speechRate,
      voiceCastBy: 'llm',
      voiceLocked: true,
      voiceMatchReason: `AI 导演选角 (${picked.name} · ${finalEmo} · ${speechRate}x): ${row?.rationale || parsed.primaryReason || '贴合题材与情绪节奏'}`,
    }
  })

  if (projectDir) {
    writeScriptJson(projectDir, data)
  }

  return {
    ok: true,
    primaryVoiceId: primaryVoice.id,
    primaryVoiceName: primaryVoice.name,
    primaryReason: parsed.primaryReason || '',
    castCount: data.scenes.length,
    script: data,
  }
}

/**
 * Decode recorded microphone WebM/WAV or uploaded local audio binary, strip silence/rumble,
 * loudness-normalize to clean 24kHz mono WAV via FFmpeg, and register as a zero-shot clone voice pack.
 */
export async function cloneRecordedVoice({
  audioBase64,
  sourcePath = '',
  fileName = 'recorded-voice.webm',
  name = '',
  gender = 'female',
  tags = [],
  emotions = ['平静', '高兴', '激动'],
  roles = ['narrator'],
  promptText = '',
  stripSilence = true,
}) {
  // Callers may pass a local recording / audio / video file (`sourcePath`) instead of base64 bytes
  const srcAbs = sourcePath ? resolve(String(sourcePath)) : ''
  if (srcAbs && !existsSync(srcAbs)) {
    throw new Error(`克隆声纹的源文件不存在: ${srcAbs}`)
  }
  const cleanB64 = srcAbs ? '' : String(audioBase64 || '').replace(/^data:.*?;base64,/, '').trim()
  if (!srcAbs && !cleanB64) {
    throw new Error('录音或音频文件二进制内容为空，无法克隆声纹')
  }
  if (srcAbs && (!fileName || fileName === 'recorded-voice.webm')) {
    fileName = basename(srcAbs)
  }

  const packsDir = getVoicePacksDir()
  const tmpDir = join(packsDir, 'imported', '.tmp-clone')
  mkdirSync(tmpDir, { recursive: true })

  const safeSlug = String(name || 'my-voice')
    .trim()
    .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'my-voice'
  const stamp = Date.now()
  const rawExt = extname(String(fileName || 'mic.webm')).toLowerCase() || '.webm'
  const rawInputPath = join(tmpDir, `${safeSlug}-${stamp}${rawExt}`)
  const normalizedWav = join(tmpDir, `${safeSlug}-${stamp}-clean.wav`)

  if (srcAbs) copyFileSync(srcAbs, rawInputPath)
  else writeFileSync(rawInputPath, Buffer.from(cleanB64, 'base64'))

  const { ffmpeg } = resolveBinaries()
  const baseFilter = 'highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=9'
  const trimFilter = stripSilence
    ? `${baseFilter},silenceremove=start_periods=1:start_threshold=-42dB:detection=peak`
    : baseFilter

  let convRes = await runCommandRedirected(
    ffmpeg,
    ['-y', '-i', rawInputPath, '-t', '16', '-ac', '1', '-ar', '24000', '-af', trimFilter, normalizedWav],
    { timeoutMs: 30_000 },
  )
  let probe = existsSync(normalizedWav) ? await probeAudioDuration(normalizedWav).catch(() => ({ durationSec: 0 })) : { durationSec: 0 }

  // If aggressive silence gate trimmed soft microphone audio below 0.5s, fallback cleanly without silence removal
  if (convRes.code !== 0 || probe.durationSec < 0.5) {
    convRes = await runCommandRedirected(
      ffmpeg,
      ['-y', '-i', rawInputPath, '-t', '16', '-ac', '1', '-ar', '24000', '-af', baseFilter, normalizedWav],
      { timeoutMs: 30_000 },
    )
    probe = existsSync(normalizedWav) ? await probeAudioDuration(normalizedWav).catch(() => ({ durationSec: 0 })) : { durationSec: 0 }
  }

  if (convRes.code !== 0 || !existsSync(normalizedWav) || probe.durationSec < 0.35) {
    try { rmSync(rawInputPath, { force: true }) } catch {}
    throw new Error(`克隆人声预处理失败 (有效发音时长 ${(probe.durationSec || 0).toFixed(2)}s 太短): ${convRes.stderr}`)
  }

  try {
    const imported = await importVoicePack({
      sourcePath: normalizedWav,
      id: `clone-${safeSlug}-${stamp}`,
      name: String(name || `我的声音克隆 (${safeSlug})`).trim(),
      category: '专属声纹克隆',
      gender: gender === 'male' ? 'male' : 'female',
      engine: 'indextts25',
      tags: ['我的声音', '零样本克隆', '自定义音色', ...(Array.isArray(tags) ? tags : [])],
      emotions,
      roles,
      promptText,
      copyToVoicePacks: true,
    })

    return {
      ok: true,
      voice: imported.importedVoices?.[0] || imported.voices?.[0] || null,
      durationSec: Number(probe.durationSec.toFixed(2)),
      normalizedSampleRate: 24000,
    }
  } finally {
    try { rmSync(rawInputPath, { force: true }) } catch {}
    try { rmSync(normalizedWav, { force: true }) } catch {}
  }
}
