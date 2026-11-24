/**
 * @dsh-video/web-video-workbench — Backend REST API & Cordis Plugin Adapter
 * Copyright (c) 2026 Merziller
 * Author: Merziller | QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com
 * Official Repo: https://github.com/Merziller/dsh-video-workbench (MIT License)
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computeSafeZonePreflight,
  deriveDisplayTitle,
  formatDurationLabel,
  isMetaInstructionText,
  loadEnv,
  loadHardwarePreferences,
  PACKAGE_ROOT,
  probeAudioDuration,
  probeHardwareProfile,
  readScriptJson,
  REPO_ROOT,
  resolveBinaries,
  resolveEnvPath,
  resolveLowSpecPolicy,
  resolveTargetDurationPolicy,
  resolveVideoDimensions,
  runCommandRedirected,
  saveHardwarePreferences,
  SCRUBBED_SCENE_TEXT_KEYS,
  splitDirectorBrief,
  trustedSceneTextKey,
  writeScriptJson,
} from '../../shared/index.js'
import {
  AVATAR_TEMPLATES,
  executeGenerateAvatar,
  getAvatarProviderSummary,
  getLipsyncInstallerCatalog,
  getLipsyncStatus,
  installLipsyncEngine,
  probeVideoStream,
  saveAvatarConfig,
} from '../../dsh-tool-avatar/index.js'
import {
  addOrUpdateCustomTtsEngine,
  cloneRecordedVoice,
  deleteImportedVoice,
  ensureDefaultReferenceVoices,
  executeGenerateSpeech,
  getActiveTtsEngineId,
  getSafeTtsConfigSummary,
  getTtsInstallerCatalog,
  getTtsServerHealth,
  getVoiceCatalog,
  importVoicePack,
  installTtsEngine,
  matchAllScenesInScript,
  removeCustomTtsEngine,
  resolveTtsEngineSpec,
  saveTtsConfig,
  setActiveTtsEngine,
} from '../../dsh-tool-local-tts/index.js'
import {
  executeVideoLint,
  executeVideoRender,
  executeVideoSnapshot,
  extractSceneThumbnails,
  runPostRenderQa,
} from '../../dsh-tool-video-suite/index.js'
import {
  analyzeAudioBeatStructure,
  analyzeReferenceVideo,
  applyPlazaTemplateToProject,
  assistCloudMediaPrompt,
  callLlmChat,
  CLOUD_MEDIA_PRESETS,
  commitStagedCloudAsset,
  detectGenre,
  discardStagedCloudAsset,
  exportProjectMotionMd,
  extractJsonFromLlmText,
  generateCloudMediaAsset,
  getCloudMediaConfigSummary,
  getGenreProfile,
  getPlazaTemplate,
  GENRE_PROFILES,
  listGenresForPrompt,
  listPlazaTemplates,
  listStagedCloudAssets,
  loadBrandKit,
  exportPublishPack,
  generateAiCodedBgmTrack,
  generateBgmWav,
  getAiCodingHistory,
  getSafeLlmConfigSummary,
  importAssets,
  masterVoiceTracks,
  mixVideoAudio,
  planVideoFromAssets,
  PLAZA_BRAND,
  PLAZA_CATEGORIES,
  produceFullVideo,
  publishProjectToPlaza,
  readAssets,
  refineAiScene,
  removeAsset,
  renderVendorClipIsolated,
  rollbackAiVersion,
  runAiStudioPipeline,
  saveBrandKit,
  saveCloudMediaConfig,
  saveLlmConfig,
  saveUploadedAsset,
  summarizeAssets,
  syncProjectCodeFromScript,
  synthesizeTtsEngineAudioCue,
  testLlmConnection,
  updateAsset,
  executeCurateAndEditAssets,
  startPipelineBackground,
  taskManager,
} from '../../dsh-tool-media/index.js'
import { getVibeToolkitStatus } from '../../dsh-tool-media/vibe-toolkit-lib.js'
import {
  applyStyleDecision,
  deleteStylePreset,
  effectiveStyleMode,
  listStylePresets,
  MAX_STYLE_PRESETS,
  prepareProjectStyleForRun,
  renameStylePreset,
  resolveStyleRequest,
  saveStylePreset,
  styleSelectionValue,
} from '../../dsh-tool-media/style-presets.js'
import { DELIVERY_ROUTES, handleDeliveryApiRequest, isDeliveryRoute } from './routes-delivery.js'
import { handleProjectApiRequest, isProjectRoute, PROJECT_ROUTES } from './routes-project.js'
import { COVER_ROUTES, handleCoverApiRequest, isCoverRoute } from './routes-cover.js'
import { handlePlazaCommunityApiRequest, isPlazaCommunityRoute, PLAZA_COMMUNITY_ROUTES } from './routes-plaza.js'

function describeStyleForPrompt(v) {
  const s = String(v || '').trim()
  if (!s || s === 'auto') return 'auto（AI 自由匹配：按主题从 6 个预设里挑选，都不合适时自创新风格）'
  if (s.startsWith('user:')) {
    const p = safeStylePresets().find((x) => x.value === s)
    return p ? `用户的风格预设「${p.name}」${p.desc ? `（${p.desc}）` : ''}，基于 ${p.base}` : 'tech'
  }
  return s
}

// 「我的风格预设」 (style-presets.json in DSH_VIDEO_HOME): a broken file never breaks the state payload
function safeStylePresets() {
  try {
    return listStylePresets()
  } catch {
    return []
  }
}
const stylePresetsReply = (extra = {}) => ({ ok: true, ...extra, presets: safeStylePresets(), max: MAX_STYLE_PRESETS })

function safeVibeToolkitStatus() {
  try {
    return getVibeToolkitStatus()
  } catch {
    return []
  }
}

export const AUTHOR_INFO = Object.freeze({
  name: 'Merziller',
  qq: '1411574209',
  wechat: 'Merziller',
  email: 'k26789228@gmail.com',
  github: 'https://github.com/Merziller/dsh-video-workbench',
  license: 'MIT',
  notice: '© 2026 Merziller · 开源免费（MIT），二次分发/修改请保留原作者署名与联系方式',
})
import {
  scaffoldVideoProject,
  VIDEO_MAKER_SYSTEM_PROMPT,
} from '../../dsh-preset-video/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Switchable AI war-room skins (self-contained HTML documents driven by the postMessage bridge, see warroom/BRIDGE.md)
const WARROOM_DIR = join(__dirname, 'warroom')
// Optional skin-development overlay: DSH_VIDEO_WARROOM_DIR=<abs dir> serves <dir>/<id>.html in place of the bundled skin
function resolveWarroomSkinFile(id) {
  const devDir = String(process.env.DSH_VIDEO_WARROOM_DIR || '').trim()
  if (devDir && isAbsolute(devDir)) {
    const devFile = join(devDir, `${id}.html`)
    if (existsSync(devFile)) return devFile
  }
  return join(WARROOM_DIR, `${id}.html`)
}
const WARROOM_SKINS = [
  { id: 'nova-deck', short: 'A', name: '星舰剪辑甲板', en: 'NOVA DECK', tone: 'dark' },
  { id: 'ink-loom', short: 'B', name: '墨韵织机', en: 'INK LOOM', tone: 'dark' },
  { id: 'prism-lab', short: 'C', name: '棱镜实验室', en: 'PRISM LAB', tone: 'light' },
]

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.md': 'text/markdown; charset=utf-8',
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

async function parseRequestJson(req) {
  try {
    return await req.json()
  } catch {
    return {}
  }
}

export function getWorkspaceRoot() {
  loadEnv()
  if ((process.env.DSH_VIDEO_WORKSPACE || '').trim()) {
    const dir = resolveEnvPath('DSH_VIDEO_WORKSPACE', '')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }
  const dir = REPO_ROOT === PACKAGE_ROOT ? join(PACKAGE_ROOT, 'examples') : join(REPO_ROOT, 'projects')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * List all video projects in `DSH_VIDEO_WORKSPACE` (ensuring the 2 built-in flagship demos exist:
 * 1. `dsh-video-workbench-promo` [宣传片]
 * 2. `full-tutorial-v036` [教程]
 * ).
 */
export function listVideoProjects() {
  const wsRoot = getWorkspaceRoot()
  const ensureBuiltinDemo = (folderName, fallbackTitle, templateId) => {
    const dir = join(wsRoot, folderName)
    if (existsSync(join(dir, 'script.json'))) return
    // Try copying shipped example from PACKAGE_ROOT/examples/<folderName> first (for installed npm/DSH users)
    const pkgExample = join(PACKAGE_ROOT, 'examples', folderName)
    if (pkgExample !== dir && existsSync(join(pkgExample, 'script.json'))) {
      try {
        mkdirSync(dir, { recursive: true })
        for (const f of ['script.json', 'index.html', 'plan.json', 'MOTION.md']) {
          if (existsSync(join(pkgExample, f))) writeFileSync(join(dir, f), readFileSync(join(pkgExample, f)))
        }
        return
      } catch {}
    }
    // Try seeding from CinePulse Hub plaza template if available
    try {
      const tpl = getPlazaTemplate(templateId)
      if (tpl?.script) {
        mkdirSync(dir, { recursive: true })
        writeScriptJson(dir, tpl.script)
        if (tpl.motionMd) writeFileSync(join(dir, 'MOTION.md'), tpl.motionMd, 'utf8')
        return
      }
    } catch {}
    scaffoldVideoProject(dir, { title: fallbackTitle, engine: 'remotion' })
  }

  ensureBuiltinDemo('dsh-video-workbench-promo', 'DSH Video Workbench：双引擎全链路，开源即开拍', 'tech-launch-keynote')
  ensureBuiltinDemo('full-tutorial-v036', 'DSH 视频工作台实操：从新建工程到质检导出', 'saas-ui-tutorial')

  const projects = []
  for (const entry of readdirSync(wsRoot)) {
    const fullDir = join(wsRoot, entry)
    if (!statSync(fullDir).isDirectory()) continue
    const scriptPath = join(fullDir, 'script.json')
    if (!existsSync(scriptPath)) continue
    try {
      const { data } = readScriptJson(fullDir)
      const hasMp4 = existsSync(join(fullDir, 'output', 'final.mp4'))
      const hasSnapshot = existsSync(join(fullDir, 'output', 'snapshot-3x3.png'))
      const hasMasterAudio = existsSync(join(fullDir, 'output', 'master-audio.wav'))
      const assets = readAssets(fullDir)
      projects.push({
        id: entry,
        name: data.title || entry,
        projectDir: fullDir,
        engine: data.engine || 'html',
        style: data.style || 'tech',
        fps: data.fps || 30,
        totalDurationSec: data.totalDurationSec || 0,
        totalDurationInFrames: data.totalDurationInFrames || 0,
        sceneCount: Array.isArray(data.scenes) ? data.scenes.length : 0,
        assetCount: Array.isArray(assets.items) ? assets.items.length : 0,
        voiceMode: data.voiceMode || 'auto',
        defaultVoiceId: data.defaultVoiceId || 'auto',
        hasMp4,
        hasSnapshot,
        hasMasterAudio,
        updatedAt: data.updatedAt || null,
      })
    } catch {}
  }
  return { workspaceRoot: wsRoot, projects }
}

function collectSceneThumbMap(projectDir) {
  const thumbDir = join(resolve(projectDir), 'output', 'scene-thumbs')
  const map = {}
  if (!existsSync(thumbDir)) return map
  try {
    for (const file of readdirSync(thumbDir)) {
      if (/\.(jpg|jpeg|png|webp)$/i.test(file)) {
        const key = file.replace(/\.[^.]+$/, '')
        map[key] = `output/scene-thumbs/${file}`
      }
    }
  } catch {}
  return map
}

/**
 * Expand a short user video idea into a STRUCTURED creative brief (genre-routed).
 * The output separates what the audience sees/hears (displayTitle, contentOutline) from AI-only production
 * directives (directorNotes) so that instructions can never be rendered or narrated in the final video.
 */
export async function polishTopicPrompt(body = {}, { fetchImpl } = {}) {
  const rawPrompt = String(body.rawPrompt || body.topic || '').trim()
  if (!rawPrompt) {
    const err = new Error('请先在输入框中写一句简单需求，再点击 AI 润色。')
    err.status = 400
    throw err
  }
  const overrideConfig = body.llmOverride && typeof body.llmOverride === 'object' ? body.llmOverride : undefined
  const llmSummary = getSafeLlmConfigSummary()
  if (!llmSummary.configured && !overrideConfig) {
    const err = new Error('当前尚未配置可用的大模型 API，请先在右上角「模型配置」连接或同步 DSH 客户端模型。')
    err.status = 400
    throw err
  }
  const projectDir = body.projectDir || ''
  const manifest = projectDir ? readAssets(projectDir) : { items: [], notes: [] }
  const visualList = (manifest.items || [])
    .filter((it) => it.type === 'image' || it.type === 'video')
    .map((it) => `${it.originalName || it.name || it.path} (${it.type}${it.width ? ` ${it.width}x${it.height}` : ''})`)
    .slice(0, 16)
  const musicItems = (manifest.items || []).filter((it) => it.role === 'music')
  const musicList = musicItems.map((it) => `${it.originalName || it.name}${Number(it.durationSec) > 0 ? ` (${Math.round(it.durationSec)}s)` : ''}`)
  const sfxList = (manifest.items || []).filter((it) => it.role === 'sfx').map((it) => it.originalName || it.name)
  const specialList = (manifest.items || [])
    .filter((it) => ['host_video', 'avatar_base', 'voice_clone'].includes(it.role))
    .map((it) => `${it.originalName || it.name} [${it.role}]`)
  const noteSnippets = (manifest.notes || []).map((n) => String(n.text || '').slice(0, 600)).filter(Boolean)
  let projectScriptSnap = null
  if (projectDir && existsSync(join(resolve(projectDir), 'script.json'))) {
    try { projectScriptSnap = readScriptJson(projectDir).data } catch {}
  }
  const refStyle = projectScriptSnap?.referenceStyle || null
  const wantsPureMusic =
    body.narrationMode === 'subtitle-mv' ||
    /(?:纯音乐|免配音|无配音|无旁白|不要配音|不用配音|去掉配音|无需配音|纯卡点|卡点\s*MV|无解说|免\s*TTS)/i.test(rawPrompt) ||
    (refStyle?.narrationMode === 'subtitle-mv' && !/(?:需要配音|真人配音|口播解说)/.test(rawPrompt))
  const wantsBeatSync =
    wantsPureMusic ||
    body.narrationMode === 'tts-beat-sync' ||
    /(?:踩死|踩准|踩拍|踩点|卡点|卡拍|高潮突降|主高潮|突降|重拍|切镜|同步节拍)/i.test(rawPrompt)
  const effectivePolishNarrationMode = wantsPureMusic ? 'subtitle-mv' : (wantsBeatSync && musicList.length > 0 ? 'tts-beat-sync' : (body.narrationMode || 'tts'))
  const guessedGenre = refStyle?.genre && refStyle.genre !== 'other' ? refStyle.genre : detectGenre(`${rawPrompt} ${noteSnippets.join(' ')}`, visualList.length > 0)
  const durationPolicy = resolveTargetDurationPolicy({
    durationMode: body.durationMode || 'auto',
    targetDurationSec: Number(body.targetDurationSec) || 0,
    text: rawPrompt,
    narrationMode: effectivePolishNarrationMode,
    hasVisualAssets: visualList.length > 0,
    bgmDurationSec: Number(musicItems[0]?.durationSec) || 0,
    referenceShotCount: Number(refStyle?.pacingSignature?.targetShotCount || refStyle?.shotCount || 0),
    referenceDurationSec: Number(refStyle?.durationSec || 0),
  })
  const durationRuleLine = durationPolicy.enforced
    ? `6. **目标时长硬要求**：用户明确指定目标时长为 **${durationPolicy.label}**（底线 ${durationPolicy.minSec} 秒）！请务必把 \`contentOutline\` 拆解为 **${durationPolicy.outlineCountMin}~${durationPolicy.outlineCountMax} 条** 扎实充实的内容章节要点（保证后续分镜可自然展开到 **${durationPolicy.targetSec} 秒**${effectivePolishNarrationMode === 'subtitle-mv' ? `、共 **${durationPolicy.targetShotsMin}~${durationPolicy.targetShotsMax} 个高密度卡点分镜**` : `、约 ${durationPolicy.requiredCharsMin}~${durationPolicy.requiredCharsMax} 字口播`}），并在 \`directorNotes\` 中明确写明按 **${durationPolicy.targetSec} 秒** 完整铺陈，绝不能缩水！`
    : `6. **时长策略**：当前为「AI 自由匹配时长」，请按题材和素材丰富度自由给出最合适的章节条数与节奏安排。`
  const bgmRuleLine = musicList.length > 0
    ? `\n7. **已上传 BGM 配乐**：用户已上传背景音乐 ${musicList.join('、')}，请在 \`directorNotes\` 中明确要求全程使用上传的 BGM 并贴合其真实节拍与高潮突降点${wantsPureMusic ? '（纯音乐高燃卡点免 TTS 旁白，强调动画人物剪影/动作、刀光斩击特效、转场闪切与鼓点打击音效）' : ''}。`
    : ''
  const refRuleLine = refStyle?.replicationPrompt
    ? `\n8. **已挂载参考视频复刻基因（必须严格沿用同款视觉与节奏！）**：参考视频「${refStyle.sourceName || '参考样片'}」实测 **${refStyle.shotCount || 0} 镜 / ${refStyle.bpm || '?'} BPM / ${refStyle.narrationMode || 'subtitle-mv'}**。风格基因：${String(refStyle.replicationPrompt).slice(0, 700)}。请把这套视觉与节奏要求完美迁移到用户的新主题中！`
    : ''

  const systemPrompt = `你是全品类视频创作总导演，擅长把一句大白话想法扩写成 AI 制作团队可直接执行的结构化创作方案。
先判断体裁：**没有任何题材限制**！下列只是 11 种常见写法参考，如果用户需求属于美食探店、机甲机械拆解、修仙/都市漫剧、游戏攻略、建筑空间漫游、影视解说、财经宏观、实验视觉艺术等任何未列出的题材，直接设 \`"genre": "other"\`（或简短英文 slug）并在 \`genreLabel\` 填写准确的新体裁名称：
${listGenresForPrompt()}

严格只输出一个 JSON 对象（不要 Markdown、不要代码围栏、不要寒暄），字段如下：
{
  "genre": "常见体裁 id，或自创题材填 other",
  "genreLabel": "精准的体裁中文名（支持无限自创新体裁，例如：科幻机甲拆解、美食教程、财经宏观分析等）",
  "displayTitle": "观众可见的作品标题，≤16 个字，只写作品名本身，不含任何制作要求",
  "logline": "一句话说明这部片子讲什么（给导演看）",
  "contentOutline": ["观众将看到/听到的内容要点 1", "要点 2", "..."],
  "directorNotes": "仅供 AI 制作团队阅读：视觉语言/运镜/动画技法/节奏/配乐/配音音色与情绪方案/素材使用方式。120~320 字。",
  "voiceStyle": "配音音色与情绪取向，如：富有张力史诗浑厚的纪录片男声 / 清亮亲切节奏明快的科技解说",
  "suggestedStyle": "tech|cinematic|documentary|energetic|warm|emerald 之一"
}
硬性规则：
1. directorNotes 里的任何文字都不会出现在视频中；displayTitle 与 contentOutline 才是观众可接触的信息。
2. contentOutline 写事实/情节/步骤的要点（名词短语或短句），不要写成"本视频要求…""请制作…"之类指令。
3. 结合 uploadedVisualAssets / uploadedNotes / uploadedMusic：有素材就写明如何使用；没有素材就由代码动画自由绘制（Three.js / SVG / Canvas，不受固定模板限制）。
4. 严禁虚构不存在的数据；用户给出的产品名、网址须原样保留在 contentOutline 中。
5. 数字用阿拉伯数字书写（206 年、3000 人）。
${durationRuleLine}${bgmRuleLine}${refRuleLine}`

  const userMsg = JSON.stringify({
    userInput: rawPrompt,
    guessedGenre,
    // 'auto' / 'user:<id>' in words the model understands (the director plan later picks / keeps the real style)
    style: describeStyleForPrompt(body.style),
    aspectRatio: body.aspectRatio || 'auto',
    targetPlatform: body.targetPlatform || 'universal',
    pacingMode: body.pacingMode || 'auto',
    creationMode: body.creationMode || 'ai-coded',
    narrationMode: body.narrationMode || 'tts',
    durationPolicy: durationPolicy.enforced
      ? { mode: durationPolicy.mode, targetSec: durationPolicy.targetSec, minSec: durationPolicy.minSec, outlineCount: `${durationPolicy.outlineCountMin}~${durationPolicy.outlineCountMax}` }
      : { mode: 'auto', hint: 'AI自由匹配最佳时长' },
    uploadedVisualAssets: visualList,
    uploadedMusic: musicList,
    uploadedSfx: sfxList,
    uploadedSpecialRoles: specialList,
    uploadedNotes: noteSnippets,
  })

  const reply = await callLlmChat({
    ...(overrideConfig ? { overrideConfig } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
    system: systemPrompt,
    messages: [{ role: 'user', content: userMsg }],
    temperature: 0.45,
    maxTokens: 4096,
    timeoutMs: 600_000,
  })
  const rawText = String(reply?.text || '')
    .replace(/^```[\w]*\r?\n?/, '')
    .replace(/\r?\n?```$/, '')
    .trim()
  if (!rawText) {
    const err = new Error('大模型未返回有效润色文本，请稍后重试。')
    err.status = 502
    throw err
  }

  let parsed = null
  try {
    parsed = extractJsonFromLlmText(rawText)
  } catch {}

  const model = reply.model || overrideConfig?.model || llmSummary.model
  const str = (v) => String(v ?? '').trim()
  if (!parsed || typeof parsed !== 'object') {
    // Legacy / free-text reply: keep it strictly as director notes, never as a title.
    const split = splitDirectorBrief({ topic: rawText })
    const title = deriveDisplayTitle(rawPrompt, '') || split.displayTitle
    return {
      ok: true,
      polishedTopic: `【作品标题】${title}\n【体裁】${getGenreProfile(guessedGenre).label}\n【导演备注（仅供 AI 制作，不会出现在视频里）】\n${stripMetaFree(rawText)}`,
      displayTitle: title,
      genre: guessedGenre,
      genreLabel: getGenreProfile(guessedGenre).label,
      directorNotes: rawText,
      contentOutline: [],
      model,
    }
  }

  const rawParsedGenre = str(parsed.genre)
  const matchedProfile = rawParsedGenre ? GENRE_PROFILES.find((g) => g.id === rawParsedGenre || g.label === rawParsedGenre) : null
  const genreId = matchedProfile ? matchedProfile.id : rawParsedGenre ? 'other' : guessedGenre
  const genreLabel =
    str(parsed.genreLabel) ||
    (genreId === 'other' && rawParsedGenre && rawParsedGenre !== 'other' ? rawParsedGenre : getGenreProfile(genreId).label)
  const outline = (Array.isArray(parsed.contentOutline) ? parsed.contentOutline : str(parsed.contentOutline).split(/\n+/))
    .map((x) => str(x).replace(/^[-\d.、\s]+/, ''))
    .filter((x) => x && !isMetaInstructionText(x))
  const displayTitle = str(parsed.displayTitle).slice(0, 24) || deriveDisplayTitle(rawPrompt, '作品')
  const directorNotes = str(parsed.directorNotes)
  const voiceStyle = str(parsed.voiceStyle)
  const durationLine = durationPolicy.enforced
    ? `【目标时长】${durationPolicy.targetSec} 秒（${formatDurationLabel(durationPolicy.targetSec)}）`
    : ''
  const polishedTopic = [
    `【作品标题】${displayTitle}`,
    `【体裁】${genreLabel}`,
    durationLine,
    str(parsed.logline) ? `【一句话】${str(parsed.logline)}` : '',
    outline.length ? `【内容要点】\n${outline.map((x, i) => `${i + 1}. ${x}`).join('\n')}` : '',
    `【导演备注（仅供 AI 制作，不会出现在视频里）】\n${directorNotes}${voiceStyle ? `\n配音取向：${voiceStyle}` : ''}`,
  ]
    .filter(Boolean)
    .join('\n')
  return {
    ok: true,
    polishedTopic,
    displayTitle,
    genre: genreId,
    genreLabel,
    durationMode: durationPolicy.enforced ? 'custom' : 'auto',
    targetDurationSec: durationPolicy.enforced ? durationPolicy.targetSec : 0,
    durationLabel: durationPolicy.label,
    logline: str(parsed.logline),
    contentOutline: outline,
    directorNotes: `${directorNotes}${voiceStyle ? `\n配音取向：${voiceStyle}` : ''}`,
    voiceStyle,
    suggestedStyle: str(parsed.suggestedStyle) || (refStyle?.style || ''),
    suggestedNarrationMode: effectivePolishNarrationMode,
    suggestedPacingMode: wantsPureMusic || refStyle?.pacingSignature?.recommendedPacingMode === 'dynamic' ? 'dynamic' : (body.pacingMode || 'auto'),
    model,
  }
}

function resolveAssetAbsPath(projectDir, relOrAbs) {
  if (!relOrAbs) return ''
  return isAbsolute(relOrAbs) ? relOrAbs : join(resolve(projectDir), relOrAbs)
}

/**
 * Automatically bind newly uploaded/imported special-role assets (BGM music, avatar_base,
 * voice_clone, host_video) to the active project's script.json so uploading via Card 1 or
 * Step 1 takes effect immediately without requiring extra manual clicks.
 */
async function autoBindUploadedAssets(projectDir, targetItems = [], uploadRole = '') {
  const autoBound = { bgm: null, avatarBase: null, voiceClone: null, hostVideo: null }
  if (!projectDir || !Array.isArray(targetItems) || targetItems.length === 0) return autoBound
  const manifest = readAssets(projectDir)
  const freshItems = targetItems
    .map((it) => manifest.items.find((m) => m.id === it?.id) || it)
    .filter(Boolean)

  const musicItem = freshItems.find((it) => it.role === 'music' || (uploadRole === 'music' && it.type === 'audio'))
  if (musicItem && existsSync(join(resolve(projectDir), 'script.json'))) {
    const absBgm = resolveAssetAbsPath(projectDir, musicItem.path)
    let beatInfo = null
    if (absBgm && existsSync(absBgm)) {
      try {
        beatInfo = await analyzeAudioBeatStructure(absBgm)
      } catch {}
    }
    try {
      const { data } = readScriptJson(projectDir)
      data.bgmMode = 'uploaded'
      data.audioSpec = { ...(data.audioSpec || {}), bgmMode: 'uploaded', ...(beatInfo?.bpm ? { bpm: beatInfo.bpm } : {}) }
      data.bgm = {
        ...(data.bgm || {}),
        ...(beatInfo || {}),
        enabled: true,
        mode: 'uploaded',
        uploadedPath: musicItem.path,
        path: musicItem.path,
        source: 'user-imported',
      }
      writeScriptJson(projectDir, data)
      autoBound.bgm = {
        id: musicItem.id,
        name: musicItem.name,
        path: musicItem.path,
        bpm: beatInfo?.bpm || 0,
        durationSec: beatInfo?.durationSec || musicItem.durationSec || 0,
        dropsCount: beatInfo?.drops?.length || 0,
      }
    } catch {}
  }

  const avatarItem = freshItems.find((it) => it.role === 'avatar_base')
  if (avatarItem) autoBound.avatarBase = { id: avatarItem.id, name: avatarItem.name, path: avatarItem.path }

  const voiceCloneItem = freshItems.find((it) => it.role === 'voice_clone')
  if (voiceCloneItem) autoBound.voiceClone = { id: voiceCloneItem.id, name: voiceCloneItem.name, path: voiceCloneItem.path }

  const hostVideoItem = freshItems.find((it) => it.role === 'host_video')
  if (hostVideoItem) autoBound.hostVideo = { id: hostVideoItem.id, name: hostVideoItem.name, path: hostVideoItem.path }

  return autoBound
}

function stripMetaFree(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

/**
 * Stream a file cleanly with HTTP Byte-Range support so HTML5 `<video>` and `<audio>` can seek smoothly.
 */
function serveFileWithRange(req, filePath, contentType) {
  const st = statSync(filePath)
  const total = st.size
  const rangeHeader = req.headers?.get?.('range') || req.headers?.range || ''

  if (rangeHeader && typeof rangeHeader === 'string') {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/)
    if (match) {
      let start = match[1] ? parseInt(match[1], 10) : 0
      let end = match[2] ? parseInt(match[2], 10) : total - 1
      if (!match[1] && match[2]) {
        start = Math.max(0, total - parseInt(match[2], 10))
        end = total - 1
      }
      start = Math.max(0, Math.min(start, Math.max(0, total - 1)))
      end = Math.max(start, Math.min(end, Math.max(0, total - 1)))
      const chunkSize = total === 0 ? 0 : end - start + 1
      const buf = Buffer.alloc(chunkSize)
      if (chunkSize > 0) {
        const fd = openSync(filePath, 'r')
        try {
          readSync(fd, buf, 0, chunkSize, start)
        } finally {
          closeSync(fd)
        }
      }
      return new Response(buf, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Cache-Control': 'no-cache',
        },
      })
    }
  }

  const buf = readFileSync(filePath)
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(total),
      'Cache-Control': 'no-cache',
    },
  })
}

const ASYNC_JOBS = new Map()

// runner(onProgress) → result. Optional doneMessage(result) replaces the generic '处理完成' (shown by the job poller).
function createBackgroundJob(initialMessage, runner, { doneMessage } = {}) {
  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const job = { id, status: 'running', stage: 'init', progress: 4, message: initialMessage, result: null, error: '' }
  ASYNC_JOBS.set(id, job)
  if (ASYNC_JOBS.size > 40) {
    const firstKey = ASYNC_JOBS.keys().next().value
    if (firstKey) ASYNC_JOBS.delete(firstKey)
  }
  const handleProgress = (payload) => {
    if (!payload) return
    if (typeof payload === 'string') {
      job.message = payload
      const m = /(\d+)%/.exec(payload)
      if (m) job.progress = Math.max(job.progress, Math.min(99, Number(m[1])))
      return
    }
    if (typeof payload === 'object') {
      if (payload.stage) job.stage = payload.stage
      if (Number.isFinite(Number(payload.progress))) job.progress = Number(payload.progress)
      if (payload.message) job.message = String(payload.message)
    }
  }
  Promise.resolve()
    .then(() => runner(handleProgress))
    .then((res) => {
      job.status = 'done'
      job.stage = 'done'
      job.progress = 100
      job.result = res
      let msg = '处理完成'
      try {
        if (typeof doneMessage === 'function') msg = String(doneMessage(res) || msg)
      } catch {}
      job.message = msg
    })
    .catch((err) => {
      job.status = 'error'
      job.error = err?.message || String(err)
      job.message = job.error
    })
  return job
}

function readOptionalJson(filePath) {
  try {
    if (existsSync(filePath)) return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {}
  return null
}

function collectProjectSourceFiles(projectDir) {
  const absDir = resolve(projectDir)
  const files = []
  const pushFile = (relPath) => {
    const full = join(absDir, relPath)
    if (!existsSync(full)) return
    try {
      const content = readFileSync(full, 'utf8')
      files.push({ path: relPath.replace(/\\/g, '/'), size: content.length, content: content.slice(0, 80_000) })
    } catch {}
  }
  const srcDir = join(absDir, 'src')
  if (existsSync(srcDir)) {
    const walk = (dir, prefix = 'src') => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === 'node_modules') continue
        const rel = `${prefix}/${ent.name}`
        if (ent.isDirectory()) walk(join(dir, ent.name), rel)
        else if (/\.(tsx|ts|jsx|js|json)$/i.test(ent.name)) pushFile(rel)
      }
    }
    walk(srcDir)
  }
  pushFile('index.html')
  pushFile('plan.json')
  pushFile('plan.resolved.json')
  pushFile('audio/ai_bgm_synth.js')
  pushFile('output/timing-contract.json')
  pushFile('output/ai_build_log.json')
  pushFile('output/qa_report.json')
  return files
}

/**
 * Handle API calls from the frontend Video Workbench UI (`/api/video-workbench/*`).
 */
export async function handleWorkbenchApiRequest(req) {
  const url = new URL(req.url, 'http://localhost')
  const pathname = url.pathname

  try {
    // 0. GET /api/video-workbench/jobs (poll async produce/render job)
    if (pathname === '/api/video-workbench/jobs' && req.method === 'GET') {
      const id = url.searchParams.get('id') || ''
      const job = ASYNC_JOBS.get(id)
      if (!job) {
        return jsonResponse({ ok: false, error: 'Job not found' }, 404)
      }
      return jsonResponse({ ok: true, job })
    }
    // 1. GET /api/video-workbench/state
    if (pathname === '/api/video-workbench/state' && req.method === 'GET') {
      const { workspaceRoot, projects } = listVideoProjects()
      const requestedProject = url.searchParams.get('projectDir') || projects[0]?.projectDir || ''
      let activeProject = null
      if (requestedProject && existsSync(join(requestedProject, 'script.json'))) {
        const { data } = readScriptJson(requestedProject)
        const manifest = readAssets(requestedProject)
        const refDir = join(requestedProject, 'reference')
        let referenceVideoRel = ''
        // the analyzer writes sourceRelPath; older scripts used sourceRel
        const refSourceRel = data?.referenceStyle?.sourceRelPath || data?.referenceStyle?.sourceRel || ''
        if (refSourceRel && existsSync(join(requestedProject, refSourceRel))) {
          referenceVideoRel = String(refSourceRel).replace(/\\/g, '/')
        } else if (existsSync(refDir)) {
          const refVid = readdirSync(refDir).find((f) => /\.(mp4|mov|webm|mkv)$/i.test(f))
          if (refVid) referenceVideoRel = `reference/${refVid}`
        }
        activeProject = {
          projectDir: requestedProject,
          script: data,
          assets: manifest.items || [],
          notes: manifest.notes || [],
          assetSummary: summarizeAssets(manifest),
          hasMp4: existsSync(join(requestedProject, 'output', 'final.mp4')),
          hasReferenceVideo: Boolean(referenceVideoRel),
          referenceVideoRel,
          hasSnapshot: existsSync(join(requestedProject, 'output', 'snapshot-3x3.png')),
          hasMasterAudio: existsSync(join(requestedProject, 'output', 'master-audio.wav')),
          hasAvatarClip: Boolean(data?.avatarClip?.path),
          sceneThumbs: collectSceneThumbMap(requestedProject),
          qaReport: readOptionalJson(join(requestedProject, 'output', 'qa_report.json')),
          buildLog: readOptionalJson(join(requestedProject, 'output', 'ai_build_log.json')),
          historyCount: getAiCodingHistory(requestedProject).length,
        }
      }
      const catalog = getVoiceCatalog()
      const activeTtsId = getActiveTtsEngineId()
      const ttsStatus = await getTtsServerHealth(1800, activeTtsId)
      const hardwareProfile = probeHardwareProfile({ targetDir: REPO_ROOT })
      const hardwarePreferences = loadHardwarePreferences(REPO_ROOT)
      const hardwarePolicy = resolveLowSpecPolicy({
        repoRoot: REPO_ROOT,
        hardware: hardwareProfile,
        modePref: hardwarePreferences.lowSpecMode,
        requestedQuality: activeProject?.script?.quality || '1080p',
        requestedFps: Number(activeProject?.script?.fps) || 30,
        totalDurationSec: Number(activeProject?.script?.totalDurationSec) || 60,
      })
      const plazaListing = listPlazaTemplates()
      return jsonResponse({
        ok: true,
        workspaceRoot,
        projects,
        activeProject,
        llmConfig: getSafeLlmConfigSummary(),
        ttsConfig: getSafeTtsConfigSummary(),
        ttsInstallCatalog: getTtsInstallerCatalog(),
        cloudMedia: getCloudMediaConfigSummary(),
        stagedCloudAssets: requestedProject ? listStagedCloudAssets(requestedProject) : [],
        plazaBrand: PLAZA_BRAND,
        plazaCategories: PLAZA_CATEGORIES,
        plazaTemplates: plazaListing.templates,
        voiceCatalog: catalog.voices,
        voiceCategories: catalog.categories,
        availableEmotions: Object.keys(catalog.emotionReferences),
        ttsStatus,
        brandKit: loadBrandKit(requestedProject),
        authorInfo: AUTHOR_INFO,
        hardwareProfile,
        hardwarePreferences,
        hardwarePolicy,
        vibeToolkit: safeVibeToolkitStatus(),
        stylePresets: safeStylePresets(),
        avatarTemplates: AVATAR_TEMPLATES,
        avatarProvider: getAvatarProviderSummary(),
        taskRuns: requestedProject ? taskManager.listRuns(requestedProject) : [],
        presetId: 'video-maker',
        presetName: '视频制作模式',
      })
    }

    // 1b. GET / POST /api/video-workbench/hardware (PC specs check + Low-Spec Protection toggle)
    if (pathname === '/api/video-workbench/hardware') {
      if (req.method === 'GET') {
        const forceRefresh = url.searchParams.get('refresh') === '1'
        const hardwareProfile = probeHardwareProfile({ targetDir: REPO_ROOT, forceRefresh })
        const hardwarePreferences = loadHardwarePreferences(REPO_ROOT)
        const hardwarePolicy = resolveLowSpecPolicy({
          repoRoot: REPO_ROOT,
          hardware: hardwareProfile,
          modePref: hardwarePreferences.lowSpecMode,
          requestedQuality: url.searchParams.get('quality') || '1080p',
          requestedFps: Number(url.searchParams.get('fps')) || 30,
        })
        return jsonResponse({ ok: true, hardwareProfile, hardwarePreferences, hardwarePolicy, vibeToolkit: safeVibeToolkitStatus() })
      }
      if (req.method === 'POST') {
        const body = await parseRequestJson(req)
        const hardwarePreferences = saveHardwarePreferences(REPO_ROOT, { lowSpecMode: body.lowSpecMode || 'auto' })
        const hardwareProfile = probeHardwareProfile({ targetDir: REPO_ROOT, forceRefresh: true })
        const hardwarePolicy = resolveLowSpecPolicy({
          repoRoot: REPO_ROOT,
          hardware: hardwareProfile,
          modePref: hardwarePreferences.lowSpecMode,
          requestedQuality: body.quality || '1080p',
          requestedFps: Number(body.fps) || 30,
        })
        return jsonResponse({ ok: true, hardwareProfile, hardwarePreferences, hardwarePolicy, vibeToolkit: safeVibeToolkitStatus() })
      }
    }

    // 1c. GET / POST /api/video-workbench/llm-config & POST /llm-test
    if (pathname === '/api/video-workbench/llm-config' && req.method === 'GET') {
      return jsonResponse({ ok: true, config: getSafeLlmConfigSummary() })
    }
    if (pathname === '/api/video-workbench/llm-config' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const saved = saveLlmConfig(body)
      return jsonResponse({ ok: true, config: saved })
    }
    if (pathname === '/api/video-workbench/llm-test' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const testRes = await testLlmConnection(body)
      return jsonResponse({ ok: true, ...testRes })
    }

    // 1d. GET / POST /api/video-workbench/tts-config & POST /tts-test
    if (pathname === '/api/video-workbench/tts-config' && req.method === 'GET') {
      const summary = getSafeTtsConfigSummary()
      const health = await getTtsServerHealth(1800, summary.activeEngineId)
      return jsonResponse({ ok: true, config: summary, ttsStatus: health })
    }
    if (pathname === '/api/video-workbench/tts-config' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const act = String(body.action || 'save').toLowerCase()
      if (act === 'select' && body.activeEngineId) {
        setActiveTtsEngine(body.activeEngineId)
      } else if (act === 'add-custom' && body.engine) {
        addOrUpdateCustomTtsEngine(body.engine)
      } else if (act === 'remove-custom' && body.id) {
        removeCustomTtsEngine(body.id)
      } else if (act === 'import-json' && body.jsonText) {
        const parsed = typeof body.jsonText === 'string' ? JSON.parse(body.jsonText) : body.jsonText
        if (Array.isArray(parsed.customEngines)) {
          saveTtsConfig(parsed)
        } else if (parsed && typeof parsed === 'object') {
          addOrUpdateCustomTtsEngine({ activate: true, ...parsed })
        }
      } else {
        saveTtsConfig(body)
      }
      const summary = getSafeTtsConfigSummary()
      const health = await getTtsServerHealth(1800, summary.activeEngineId)
      return jsonResponse({ ok: true, config: summary, ttsStatus: health })
    }
    if (pathname === '/api/video-workbench/tts-test' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const testDir = join(REPO_ROOT, 'voice-packs', 'imported', '_previews')
      mkdirSync(testDir, { recursive: true })
      const testWav = join(testDir, `tts-test-${Date.now()}.wav`)
      const targetEngine = body.engineId || body.engine || getActiveTtsEngineId()
      const sampleText = String(body.text || '').trim() || '你好，这是一段语音引擎测试音频，音色清晰稳定。'
      try {
        const synth = await executeGenerateSpeech({
          text: sampleText,
          voiceId: body.voiceId || 'auto',
          emotion: body.emotion || '平静',
          engine: targetEngine,
          outputPath: testWav,
        })
        const outFile = synth.audioPath || synth.outputPath || testWav
        const wavB64 = existsSync(outFile) ? readFileSync(outFile).toString('base64') : ''
        try { rmSync(outFile, { force: true }) } catch {}
        return jsonResponse({
          ok: true,
          engine: synth.engine,
          provider: synth.provider,
          durationSec: synth.durationSec,
          voiceUsed: synth.voiceUsed,
          audioDataUrl: wavB64 ? `data:audio/wav;base64,${wavB64}` : '',
        })
      } catch (err) {
        try { rmSync(testWav, { force: true }) } catch {}
        throw err
      }
    }

    // 1b. GET /api/video-workbench/voices/preview?id=...
    if (pathname === '/api/video-workbench/voices/preview' && req.method === 'GET') {
      const voiceId = url.searchParams.get('id') || ''
      const catalog = getVoiceCatalog()
      const hit = catalog.voices.find((v) => v.id === voiceId)
      if (!hit || !hit.resolvedRefPath || !existsSync(hit.resolvedRefPath)) {
        return new Response('Voice reference audio not found', { status: 404 })
      }
      const ext = extname(hit.resolvedRefPath).toLowerCase()
      if (ext === '.pt') {
        return jsonResponse(
          {
            ok: false,
            error: 'IndexTTS .pt 音色向量文件暂无原声直出流，请为分镜配音后试听生成效果。',
          },
          400,
        )
      }
      return serveFileWithRange(req, hit.resolvedRefPath, MIME_MAP[ext] || 'audio/wav')
    }

    // 2. POST /api/video-workbench/projects (create new project)
    if (pathname === '/api/video-workbench/projects' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const wsRoot = getWorkspaceRoot()
      const slug =
        String(body.slug || body.title || `video-project-${Date.now()}`)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
          .replace(/^-+|-+$/g, '') || `video-${Date.now()}`
      const projectDir = join(wsRoot, slug)
      const dims = resolveVideoDimensions({
        aspectRatio: body.aspectRatio || 'auto',
        quality: body.quality || '1080p',
        width: body.width,
        height: body.height,
        topic: body.title || body.goal || '',
        targetPlatform: body.targetPlatform || '',
      })
      // 视觉风格: new projects default to 「AI 自由匹配」; the base preset is picked from the title by keyword rules
      const createStyleText = `${body.title || ''} ${body.goal || ''}`
      let createStyle
      try {
        createStyle = resolveStyleRequest({}, body.style || 'auto', { text: createStyleText })
      } catch {
        createStyle = resolveStyleRequest({}, 'auto', { text: createStyleText })
      }
      const createStyleFields = applyStyleDecision({}, createStyle, { record: false })
      const created = scaffoldVideoProject(projectDir, {
        title: body.title || '新建双引擎视频项目',
        engine: body.engine || 'html',
        style: createStyleFields.style,
        audience: body.audience || '通用受众',
        goal: body.goal || '带有文案、配音、音效、动效、音乐与字幕的完整成片',
        voiceMode: body.voiceMode || 'auto',
        defaultVoiceId: body.defaultVoiceId || 'auto',
      })
      const patched = writeScriptJson(projectDir, {
        ...created.script,
        style: createStyleFields.style,
        styleMode: createStyleFields.styleMode,
        styleProfile: createStyleFields.styleProfile,
        styleAuto: createStyleFields.styleAuto,
        theme: createStyleFields.theme,
        width: dims.width,
        height: dims.height,
        aspectRatio: dims.aspectRatio,
        requestedAspectRatio: dims.requestedAspectRatio,
        quality: dims.quality,
        dimensionReason: dims.reason,
        aiBadge: body.aiBadgeEnabled !== undefined ? Boolean(body.aiBadgeEnabled) : (body.aiBadge !== undefined ? Boolean(body.aiBadge) : true),
        aiBadgeEnabled: body.aiBadgeEnabled !== undefined ? Boolean(body.aiBadgeEnabled) : (body.aiBadge !== undefined ? Boolean(body.aiBadge) : true),
        aiBadgePosition: body.aiBadgePosition || 'top-right',
        aiBadgeText: body.aiBadgeText || '',
        pacingMode: body.pacingMode || 'auto',
        narrationMode: body.narrationMode || 'tts',
        durationMode: body.durationMode === 'custom' ? 'custom' : 'auto',
        targetDurationSec: Number(body.targetDurationSec) || 0,
        targetPlatform: body.targetPlatform || 'universal',
        bgmMode: body.bgmMode || 'auto',
        creationMode: body.creationMode || 'ai-coded',
      })
      matchAllScenesInScript(projectDir, { voiceId: body.defaultVoiceId || 'auto' })
      const reloaded = readScriptJson(projectDir)
      syncProjectCodeFromScript(projectDir, reloaded.data, { forceOverwrite: true })
      return jsonResponse({
        ok: true,
        projectDir: created.projectDir,
        script: reloaded.data,
      })
    }

    // 2b. POST /api/video-workbench/projects/delete (delete custom project inside workspaceRoot)
    if (pathname === '/api/video-workbench/projects/delete' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir) {
        return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      }
      const wsRoot = resolve(getWorkspaceRoot())
      const targetDir = resolve(body.projectDir)
      const folderName = basename(targetDir)
      const protectedNames = new Set(['dsh-video-workbench-promo', 'full-tutorial-v036'])
      if (protectedNames.has(folderName)) {
        return jsonResponse({ ok: false, error: '内置旗舰演示示例（宣传片/教程）不可删除' }, 400)
      }
      if (!targetDir.startsWith(wsRoot + '\\') && !targetDir.startsWith(wsRoot + '/')) {
        return jsonResponse({ ok: false, error: '仅允许删除工作区内的自定义项目' }, 403)
      }
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true })
      }
      return jsonResponse({
        ok: true,
        workspaceRoot: wsRoot,
        projects: listVideoProjects(),
      })
    }

    // 3. POST /api/video-workbench/script (save script.json & sync HTML/Remotion files)
    if (pathname === '/api/video-workbench/script' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir || !body.script) {
        return jsonResponse({ ok: false, error: 'projectDir and script are required' }, 400)
      }
      // scene text the user changed in this save is theirs: the brief-leak gate (meant for AI output) must not blank it
      // (the editors record the override from this reply, so a scrubbed reply would lock the wrong text)
      const trustedSceneText = new Set()
      try {
        const prevScenes = new Map(((readScriptJson(body.projectDir).data || {}).scenes || []).map((s) => [s && s.id, s]))
        for (const sc of Array.isArray(body.script.scenes) ? body.script.scenes : []) {
          if (!sc || !sc.id) continue
          const prev = prevScenes.get(sc.id) || {}
          for (const k of SCRUBBED_SCENE_TEXT_KEYS) {
            if (typeof sc[k] === 'string' && sc[k] !== String(prev[k] ?? '')) trustedSceneText.add(trustedSceneTextKey(sc.id, k))
          }
        }
      } catch {}
      const saved = writeScriptJson(body.projectDir, body.script, { trustedSceneText })
      if (body.regenerateHtml !== false && body.regenerateCode !== false) {
        syncProjectCodeFromScript(saved.projectDir, saved.data)
      }
      return jsonResponse({
        ok: true,
        projectDir: saved.projectDir,
        script: saved.data,
      })
    }

    // 3b. POST /api/video-workbench/assets/import (import local folders/files by path)
    if (pathname === '/api/video-workbench/assets/import' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir || !body.sources) {
        return jsonResponse({ ok: false, error: 'projectDir and sources are required' }, 400)
      }
      const res = await importAssets({
        projectDir: body.projectDir,
        sources: body.sources,
      })
      const targetItems = [...(res.added || []), ...(res.existing || [])]
      if (body.role && targetItems.length > 0) {
        for (const item of targetItems) {
          if (item?.id) updateAsset(body.projectDir, item.id, { role: String(body.role) })
        }
      }
      const autoBound = await autoBindUploadedAssets(body.projectDir, targetItems, body.role ? String(body.role) : '')
      const manifest = readAssets(body.projectDir)
      return jsonResponse({
        ok: true,
        importedCount: res.matchedCount || res.addedCount || 0,
        ...res,
        autoBound,
        manifest,
        summary: summarizeAssets(manifest),
      })
    }

    // 3c. POST /api/video-workbench/assets/upload (supports raw binary stream, localPath fallback, OR JSON base64 files[])
    if (pathname === '/api/video-workbench/assets/upload' && req.method === 'POST') {
      const ct = String(req.headers.get('content-type') || '').toLowerCase()
      let projectDir = ''
      let uploadRole = ''
      const savedPaths = []

      if (ct.includes('application/json')) {
        const body = await parseRequestJson(req)
        projectDir = body.projectDir || ''
        uploadRole = body.role ? String(body.role) : ''
        const files = body.files
        if (!projectDir || !Array.isArray(files) || files.length === 0) {
          return jsonResponse({ ok: false, error: 'projectDir and files[] are required' }, 400)
        }
        for (const file of files) {
          if (file?.localPath && existsSync(file.localPath)) {
            savedPaths.push(file.localPath)
            continue
          }
          if (!file?.name || typeof file.dataBase64 !== 'string') continue
          const cleanB64 = file.dataBase64.replace(/^data:.*?;base64,/, '')
          const buf = Buffer.from(cleanB64, 'base64')
          const savedPath = await saveUploadedAsset(projectDir, file.name, buf)
          savedPaths.push(savedPath)
        }
      } else {
        projectDir = url.searchParams.get('projectDir') || ''
        uploadRole = url.searchParams.get('role') || ''
        const fileName = url.searchParams.get('fileName') || `upload-${Date.now()}.mp4`
        const localPath = url.searchParams.get('localPath') || ''
        if (!projectDir) {
          return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
        }
        let buf = Buffer.alloc(0)
        try {
          buf = Buffer.from(await req.arrayBuffer())
        } catch {}
        if ((!buf || buf.length === 0) && localPath && existsSync(localPath)) {
          savedPaths.push(localPath)
        } else {
          if (!buf || buf.length === 0) {
            return jsonResponse({ ok: false, error: 'Uploaded binary file is empty' }, 400)
          }
          const savedPath = await saveUploadedAsset(projectDir, fileName, buf)
          savedPaths.push(savedPath)
        }
      }

      const res = await importAssets({
        projectDir,
        sources: savedPaths,
      })
      const targetItems = [...(res.added || []), ...(res.existing || [])]
      if (uploadRole && targetItems.length > 0) {
        for (const item of targetItems) {
          if (item?.id) updateAsset(projectDir, item.id, { role: uploadRole })
        }
      }
      const autoBound = await autoBindUploadedAssets(projectDir, targetItems, uploadRole)
      const manifest = readAssets(projectDir)
      const effectiveCount = res.matchedCount ?? ((res.addedCount || 0) + (res.existingCount || 0))
      if (effectiveCount === 0) {
        return jsonResponse({
          ok: false,
          error: '未识别到受支持的图片、视频、音频或文本文档格式（支持 MP4/MOV/WEBM/MKV/AVI/JPG/PNG/WEBP/MP3/WAV/FLAC/M4A/TXT/MD 等）',
          manifest,
          summary: summarizeAssets(manifest),
        }, 400)
      }
      return jsonResponse({
        ok: true,
        uploadedCount: effectiveCount,
        ...res,
        autoBound,
        manifest,
        summary: summarizeAssets(manifest),
      })
    }

    // 3d. POST /api/video-workbench/assets/delete (remove an imported asset)
    if (pathname === '/api/video-workbench/assets/delete' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir || !body.assetId) {
        return jsonResponse({ ok: false, error: 'projectDir and assetId are required' }, 400)
      }
      removeAsset(body.projectDir, body.assetId)
      const manifest = readAssets(body.projectDir)
      return jsonResponse({
        ok: true,
        manifest,
        summary: summarizeAssets(manifest),
      })
    }

    // 3e. POST /api/video-workbench/plan (AI plan storyboard from assets + topic)
    if (pathname === '/api/video-workbench/plan' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir) {
        return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      }
      const res = await planVideoFromAssets(body)
      if (body.targetPlatform || body.bgmMode || body.creationMode) {
        const cur = readScriptJson(body.projectDir)
        const updated = writeScriptJson(body.projectDir, {
          ...cur.data,
          ...(body.targetPlatform ? { targetPlatform: body.targetPlatform } : {}),
          ...(body.bgmMode && body.bgmMode !== 'auto'
            ? { bgmMode: body.bgmMode, audioSpec: { ...(cur.data.audioSpec || {}), bgmMode: body.bgmMode } }
            : {}),
          ...(body.creationMode ? { creationMode: body.creationMode } : {}),
        })
        syncProjectCodeFromScript(body.projectDir, updated.data)
        res.script = updated.data
      }
      return jsonResponse({
        ok: true,
        ...res,
      })
    }

    // 3f. POST /api/video-workbench/produce (Local Draft 0-token pipeline)
    if (pathname === '/api/video-workbench/produce' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir) {
        return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      }
      if (body.async) {
        const job = createBackgroundJob('正在生成本地演练草稿...', (onProgress) =>
          produceFullVideo({ ...body, onProgress }),
        )
        return jsonResponse({ ok: true, jobId: job.id })
      }
      const res = await produceFullVideo(body)
      return jsonResponse({
        ok: true,
        ...res,
      })
    }

    // 3g. POST /api/video-workbench/ai-produce (Model-Agnostic LLM Coding Studio pipeline)
    if (pathname === '/api/video-workbench/ai-produce' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir) {
        return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      }
      if (body.async) {
        const job = createBackgroundJob('正在启动大模型创意编程工作流...', (onProgress) =>
          runAiStudioPipeline({ ...body, onProgress }),
        )
        return jsonResponse({ ok: true, jobId: job.id })
      }
      const res = await runAiStudioPipeline(body)
      return jsonResponse({ ok: true, ...res })
    }

    // 3h. POST /api/video-workbench/ai-refine (natural language refine OR rollback snapshot)
    if (pathname === '/api/video-workbench/ai-refine' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir) {
        return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      }
      if (body.rollback) {
        return jsonResponse(rollbackAiVersion(body.projectDir))
      }
      if (body.async) {
        const job = createBackgroundJob('正在按您的反馈让大模型精修分镜代码...', (onProgress) =>
          refineAiScene({ ...body, onProgress }),
        )
        return jsonResponse({ ok: true, jobId: job.id })
      }
      return jsonResponse(await refineAiScene(body))
    }

    // 3i. GET /api/video-workbench/code & POST /qa
    if (pathname === '/api/video-workbench/code' && req.method === 'GET') {
      const projectDir = url.searchParams.get('projectDir') || ''
      if (!projectDir) return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      return jsonResponse({
        ok: true,
        files: collectProjectSourceFiles(projectDir),
        history: getAiCodingHistory(projectDir),
      })
    }
    if (pathname === '/api/video-workbench/qa' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir) return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      const { data } = readScriptJson(body.projectDir)
      const qa = await runPostRenderQa({ projectDir: body.projectDir, mp4Path: body.mp4Path, script: data })
      return jsonResponse({ ok: true, qa })
    }

    // 4. POST /api/video-workbench/voices/import (import custom voice pack via path or uploaded file)
    if (pathname === '/api/video-workbench/voices/import' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const importPayload = { ...body }
      let stagedPath = ''
      if (!importPayload.sourcePath && body.dataBase64 && body.fileName) {
        const uploadDir = join(REPO_ROOT, 'voice-packs', 'imported', '_uploads')
        mkdirSync(uploadDir, { recursive: true })
        const safeName = basename(String(body.fileName)).replace(/[<>:"/\\|?*]+/g, '_') || `voice-${Date.now()}.wav`
        stagedPath = join(uploadDir, `${Date.now()}-${safeName}`)
        const cleanB64 = String(body.dataBase64).replace(/^data:.*?;base64,/, '')
        writeFileSync(stagedPath, Buffer.from(cleanB64, 'base64'))
        importPayload.sourcePath = stagedPath
        if (!importPayload.name) {
          importPayload.name = safeName.replace(/\.[^.]+$/, '')
        }
      }
      let res
      try {
        res = await importVoicePack(importPayload)
      } finally {
        // the import copied (or extracted) the upload into the voice library: drop the staged copy, which would otherwise
        // pile up — and, with the default library location, be catalogued as a duplicate voice. Kept only when the
        // caller asked to reference files in place.
        if (stagedPath && importPayload.copyToVoicePacks !== false) {
          try {
            rmSync(stagedPath, { force: true })
          } catch {}
        }
      }
      const catalog = getVoiceCatalog()
      return jsonResponse({
        ok: true,
        ...res,
        voiceCatalog: catalog.voices,
        voiceCategories: catalog.categories,
      })
    }

    // 4b. POST /api/video-workbench/voices/clone-upload (mic WebM or uploaded local audio -> FFmpeg normalized 24kHz WAV clone)
    if (pathname === '/api/video-workbench/voices/clone-upload' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const res = await cloneRecordedVoice(body)
      const catalog = getVoiceCatalog()
      return jsonResponse({
        ok: true,
        ...res,
        voiceCatalog: catalog.voices,
        voiceCategories: catalog.categories,
      })
    }

    // 4b2. POST /api/video-workbench/voices/delete { voiceId } — remove a user-imported / cloned voice (built-ins refused)
    if (pathname === '/api/video-workbench/voices/delete' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const res = deleteImportedVoice(body.voiceId || body.id || '')
      const catalog = getVoiceCatalog()
      return jsonResponse({ ...res, voiceCatalog: catalog.voices, voiceCategories: catalog.categories }, res.ok ? 200 : 404)
    }

    // 4c. POST /api/video-workbench/voices/clone-preview (live audition of cloned/selected voice via IndexTTS-2.5)
    if (pathname === '/api/video-workbench/voices/clone-preview' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const previewDir = join(REPO_ROOT, 'voice-packs', 'imported', '_previews')
      mkdirSync(previewDir, { recursive: true })
      const previewWav = join(previewDir, `audition-${Date.now()}.wav`)
      const auditionText =
        String(body.text || '').trim() ||
        '你好，这是用你的声音实时克隆合成的效果试听，音色自然清晰，适合短视频与知识口播旁白。'
      const synth = await executeGenerateSpeech({
        text: auditionText,
        voiceId: body.voiceId || 'auto',
        emotion: body.emotion || '平静',
        engine: body.ttsEngine || getActiveTtsEngineId(),
        outputPath: previewWav,
      })
      const wavB64 = existsSync(synth.audioPath || previewWav)
        ? readFileSync(synth.audioPath || previewWav).toString('base64')
        : ''
      try { rmSync(previewWav, { force: true }) } catch {}
      return jsonResponse({
        ok: true,
        voiceUsed: synth.voiceUsed,
        durationSec: synth.durationSec,
        audioDataUrl: wavB64 ? `data:audio/wav;base64,${wavB64}` : '',
      })
    }

    // 4d. POST /api/video-workbench/bgm/upload (dedicated BGM uploader: raw binary OR JSON base64)
    if (pathname === '/api/video-workbench/bgm/upload' && req.method === 'POST') {
      const ct = String(req.headers.get('content-type') || '').toLowerCase()
      let projectDir = ''
      let fileName = `bgm-${Date.now()}.mp3`
      let description = '用户自由上传的背景音乐 BGM'
      let buf = null
      if (ct.includes('application/json')) {
        const body = await parseRequestJson(req)
        projectDir = body.projectDir || ''
        fileName = body.fileName || fileName
        description = body.description || description
        if (typeof body.dataBase64 === 'string') {
          buf = Buffer.from(body.dataBase64.replace(/^data:.*?;base64,/, ''), 'base64')
        }
      } else {
        projectDir = url.searchParams.get('projectDir') || ''
        fileName = url.searchParams.get('fileName') || fileName
        buf = Buffer.from(await req.arrayBuffer())
      }
      if (!projectDir || !buf || buf.length === 0) {
        return jsonResponse({ ok: false, error: 'projectDir and BGM audio payload are required' }, 400)
      }
      const safeName = `bgm-${basename(fileName)}`
      const savedPath = await saveUploadedAsset(projectDir, safeName, buf)
      const imp = await importAssets({ projectDir, sources: [savedPath] })
      const manifestBefore = readAssets(projectDir)
      const uploadedItem =
        manifestBefore.items.find((x) => x.id === imp.added?.[0]?.id) ||
        manifestBefore.items.find((x) => x.type === 'audio' && (x.originalName === safeName || x.originalName === basename(fileName))) ||
        manifestBefore.items.find((x) => x.role === 'music' || x.type === 'audio')
      if (!uploadedItem) {
        return jsonResponse({ ok: false, error: '上传文件未识别为有效音频格式 (.mp3/.wav/.flac/.m4a/.ogg/.aac)' }, 400)
      }
      const patchedAsset = updateAsset(projectDir, uploadedItem.id, {
        role: 'music',
        description,
      })
      let beatInfo = null
      try {
        beatInfo = await analyzeAudioBeatStructure(savedPath)
      } catch {}
      const { data } = readScriptJson(projectDir)
      data.bgmMode = 'uploaded'
      data.audioSpec = { ...(data.audioSpec || {}), bgmMode: 'uploaded', ...(beatInfo?.bpm ? { bpm: beatInfo.bpm } : {}) }
      data.bgm = {
        ...(data.bgm || {}),
        ...(beatInfo || {}),
        enabled: true,
        mode: 'uploaded',
        uploadedPath: patchedAsset.path,
        path: patchedAsset.path,
        source: 'user-imported',
      }
      writeScriptJson(projectDir, data)
      const manifest = readAssets(projectDir)
      return jsonResponse({
        ok: true,
        asset: patchedAsset,
        beatAnalysis: beatInfo
          ? {
              bpm: beatInfo.bpm,
              phaseSec: beatInfo.phaseSec,
              durationSec: beatInfo.durationSec,
              downbeatsCount: beatInfo.downbeats?.length || 0,
              dropsCount: beatInfo.drops?.length || 0,
            }
          : null,
        assets: manifest.items || [],
        script: readScriptJson(projectDir).data,
      })
    }

    // 4e. POST /api/video-workbench/audio/llm-compose (AI LLM DSP code generation & WAV synthesis)
    if (pathname === '/api/video-workbench/audio/llm-compose' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir) return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      const { data } = readScriptJson(body.projectDir)
      const res = await generateAiCodedBgmTrack({
        projectDir: body.projectDir,
        script: data,
        callLlmChatFn: (p) => callLlmChat(p),
      })
      data.bgmMode = 'llm-coded'
      data.audioSpec = { ...(data.audioSpec || {}), bgmMode: 'llm-coded' }
      data.bgm = {
        ...(data.bgm || {}),
        enabled: true,
        mode: 'llm-coded',
        path: res.relWavPath,
        codeScriptPath: res.relScriptPath,
        source: 'llm-coded',
      }
      writeScriptJson(body.projectDir, data)
      return jsonResponse({
        ok: true,
        ...res,
        previewUrl: `/api/video-workbench/asset?projectDir=${encodeURIComponent(body.projectDir)}&rel=${encodeURIComponent(res.relWavPath)}&t=${Date.now()}`,
        script: readScriptJson(body.projectDir).data,
      })
    }

    // 4f. POST /api/video-workbench/audio/tts-compose (IndexTTS-2.5 atmospheric pad / hook / stinger)
    if (pathname === '/api/video-workbench/audio/tts-compose' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir) return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      const { data } = readScriptJson(body.projectDir)
      const res = await synthesizeTtsEngineAudioCue({
        projectDir: body.projectDir,
        promptText: body.promptText || `${data.title || '光影律动'} 沉浸式氛围人声`,
        voiceId: body.voiceId || data.defaultVoiceId || 'auto',
        mode: body.mode || 'bgm-pad',
        durationSec: Number(body.durationSec) || data.totalDurationSec || 10,
        emotion: body.emotion || '深沉空灵',
      })
      if (body.mode !== 'sfx-stinger') {
        data.bgmMode = 'tts-engine'
        data.audioSpec = { ...(data.audioSpec || {}), bgmMode: 'tts-engine' }
        data.bgm = {
          ...(data.bgm || {}),
          enabled: true,
          mode: 'tts-engine',
          path: res.relWavPath,
          source: 'tts-engine',
        }
        writeScriptJson(body.projectDir, data)
      }
      return jsonResponse({
        ok: true,
        ...res,
        previewUrl: `/api/video-workbench/asset?projectDir=${encodeURIComponent(body.projectDir)}&rel=${encodeURIComponent(res.relWavPath)}&t=${Date.now()}`,
        script: readScriptJson(body.projectDir).data,
      })
    }

    // 4g. POST /api/video-workbench/publish-pack (One-click platform export bundle)
    if (pathname === '/api/video-workbench/publish-pack' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir) return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      const res = await exportPublishPack({
        projectDir: body.projectDir,
        platform: body.platform || '',
      })
      const absProj = resolve(body.projectDir)
      const relCover = res.files.coverPath ? res.files.coverPath.replace(absProj, '').replace(/^[\\/]+/, '').replace(/\\/g, '/') : ''
      const relSnap = res.files.snapshotPath ? res.files.snapshotPath.replace(absProj, '').replace(/^[\\/]+/, '').replace(/\\/g, '/') : ''
      return jsonResponse({
        ok: true,
        ...res,
        coverUrl: relCover ? `/api/video-workbench/asset?projectDir=${encodeURIComponent(absProj)}&rel=${encodeURIComponent(relCover)}&t=${Date.now()}` : '',
        snapshotUrl: relSnap ? `/api/video-workbench/asset?projectDir=${encodeURIComponent(absProj)}&rel=${encodeURIComponent(relSnap)}&t=${Date.now()}` : '',
      })
    }

    // 4h. POST /api/video-workbench/vendor/import (Isolated .motion ExternalClip importer)
    if (pathname === '/api/video-workbench/vendor/import' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir || !body.sourceDir) {
        return jsonResponse({ ok: false, error: 'projectDir and sourceDir are required' }, 400)
      }
      const { data } = readScriptJson(body.projectDir)
      const res = await renderVendorClipIsolated({
        projectDir: body.projectDir,
        sourceDir: body.sourceDir,
        name: body.name || '',
        version: body.version || '1.0.0',
        width: Number(body.width) || Number(data.width) || 1920,
        height: Number(body.height) || Number(data.height) || 1080,
        fps: Number(body.fps) || Number(data.fps) || 30,
        durationSec: Number(body.durationSec) || 4.0,
      })
      const manifest = readAssets(body.projectDir)
      return jsonResponse({
        ok: true,
        ...res,
        assets: manifest.items || [],
        assetSummary: summarizeAssets(manifest),
      })
    }

    // 4h2. 「我的风格预设」: list / save the project's (AI-designed) style / rename / delete
    if (pathname === '/api/video-workbench/style-presets' && req.method === 'GET') {
      return jsonResponse(stylePresetsReply())
    }
    if (pathname === '/api/video-workbench/style-presets/save' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      let profile = body.profile && typeof body.profile === 'object' ? body.profile : null
      if (!profile) {
        if (!body.projectDir || !existsSync(join(resolve(body.projectDir), 'script.json'))) {
          return jsonResponse({ ok: false, error: '请先打开一个工程' }, 400)
        }
        const { data } = readScriptJson(body.projectDir)
        const mode = effectiveStyleMode(data)
        profile = (mode === 'auto' || mode === 'user') && data.styleProfile ? data.styleProfile : null
        if (!profile) return jsonResponse({ ok: false, error: '当前工程还没有 AI 设计的新风格：选择「AI 自由匹配」并生成一次，AI 自创风格后才能保存为预设' }, 400)
      }
      try {
        return jsonResponse(stylePresetsReply({ preset: saveStylePreset({ name: body.name, profile }) }))
      } catch (err) {
        return jsonResponse({ ok: false, error: err.message }, 400)
      }
    }
    if (pathname === '/api/video-workbench/style-presets/rename' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      try {
        return jsonResponse(stylePresetsReply({ preset: renameStylePreset(String(body.id || ''), body.name) }))
      } catch (err) {
        return jsonResponse({ ok: false, error: err.message }, 400)
      }
    }
    if (pathname === '/api/video-workbench/style-presets/delete' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      try {
        deleteStylePreset(String(body.id || ''))
      } catch (err) {
        return jsonResponse({ ok: false, error: err.message }, 400)
      }
      return jsonResponse(stylePresetsReply({ removed: String(body.id || '') }))
    }

    // 4i. GET /api/video-workbench/safe-zone (Geometric platform safe-zone geometry & collisions)
    if (pathname === '/api/video-workbench/safe-zone' && req.method === 'GET') {
      const projectDir = url.searchParams.get('projectDir') || ''
      const platform = url.searchParams.get('platform') || ''
      if (!projectDir) return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      const { data } = readScriptJson(projectDir)
      const htmlPath = join(resolve(projectDir), 'index.html')
      const htmlContent = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : ''
      const preflight = computeSafeZonePreflight(data, { platform: platform || data.targetPlatform || 'universal', htmlContent })
      return jsonResponse({ ok: true, preflight })
    }

    // 5. POST /api/video-workbench/voices/match (AI auto-match or lock voice across scenes)
    if (pathname === '/api/video-workbench/voices/match' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir) {
        return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      }
      const matchRes = matchAllScenesInScript(body.projectDir, {
        voiceId: body.voiceId || 'auto',
        forceAuto: Boolean(body.forceAuto),
      })
      const reloaded = readScriptJson(body.projectDir)
      syncProjectCodeFromScript(reloaded.projectDir, reloaded.data)
      return jsonResponse({
        ok: true,
        ...matchRes,
        script: reloaded.data,
      })
    }

    // 6. POST /api/video-workbench/action (tts-scene, tts-all, mix, lint, snapshot, render)
    if (pathname === '/api/video-workbench/action' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const { action, projectDir } = body
      if (!projectDir) {
        return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      }

      if (action === 'lint') {
        const result = await executeVideoLint({ projectDir, engine: body.engine })
        return jsonResponse({ ok: true, action, result })
      }

      if (action === 'mix') {
        const { data } = readScriptJson(projectDir)
        const result = await mixVideoAudio({ projectDir, script: data })
        return jsonResponse({ ok: true, action, result, script: data })
      }

      if (action === 'extract-scene-thumbs') {
        const res = await extractSceneThumbnails(projectDir, null, { force: Boolean(body.force) })
        return jsonResponse({
          ok: true,
          action,
          sceneThumbs: res.thumbs || collectSceneThumbMap(projectDir),
        })
      }

      if (action === 'tts-scene') {
        const { data } = readScriptJson(projectDir)
        const scene = (data.scenes || []).find((s) => s.id === body.sceneId) || data.scenes?.[0]
        if (!scene) {
          return jsonResponse({ ok: false, error: 'Scene not found' }, 404)
        }
        const outWav = join(projectDir, 'audio', `${scene.id}.wav`)
        const result = await executeGenerateSpeech({
          text: body.text || scene.narration,
          emotion: body.emotion || scene.emotion || '平静',
          speed: Number(body.speechRate || scene.speechRate || 1.0),
          voiceId: body.voiceId || scene.voiceId || data.defaultVoiceId || 'auto',
          engine: body.ttsEngine || getActiveTtsEngineId(),
          fps: data.fps || 30,
          outputPath: outWav,
          scriptPath: projectDir,
          sceneId: scene.id,
          allowPlaceholder: Boolean(body.allowPlaceholder),
        })
        if (body.autoMaster) {
          await masterVoiceTracks({
            projectDir,
            sceneIds: [scene.id],
            useLlm: body.useLlm !== false,
          })
        }
        const updated = readScriptJson(projectDir)
        syncProjectCodeFromScript(projectDir, updated.data)
        const mixResult = await mixVideoAudio({ projectDir, script: updated.data })
        return jsonResponse({ ok: true, action, result, mixResult, script: updated.data })
      }

      if (action === 'tts-all') {
        const runTtsAll = async (onProgress) => {
          const { data } = readScriptJson(projectDir)
          const scenes = data.scenes || []
          const results = []
          for (let i = 0; i < scenes.length; i++) {
            const scene = scenes[i]
            onProgress?.(`正在生成全片配音 (${i + 1}/${scenes.length}): ${scene.title || scene.id}`)
            const outWav = join(projectDir, 'audio', `${scene.id}.wav`)
            const res = await executeGenerateSpeech({
              text: scene.narration,
              emotion: scene.emotion || '平静',
              speed: Number(scene.speechRate || body.speechRate || 1.0),
              voiceId: scene.voiceId || data.defaultVoiceId || 'auto',
              engine: body.ttsEngine || getActiveTtsEngineId(),
              fps: data.fps || 30,
              outputPath: outWav,
              scriptPath: projectDir,
              sceneId: scene.id,
              allowPlaceholder: Boolean(body.allowPlaceholder),
            })
            results.push(res)
          }
          let mastering = null
          if (body.autoMaster) {
            mastering = await masterVoiceTracks({
              projectDir,
              useLlm: body.useLlm !== false,
              onProgress,
            })
          }
          onProgress?.('正在合成配音、音效与背景音乐混音...')
          const updated = readScriptJson(projectDir)
          syncProjectCodeFromScript(projectDir, updated.data)
          const mixResult = await mixVideoAudio({ projectDir, script: updated.data })
          return { ok: true, action, results, mastering, mixResult, script: updated.data }
        }
        if (body.async) {
          const activeSpec = resolveTtsEngineSpec(body.ttsEngine || getActiveTtsEngineId())
          const job = createBackgroundJob(`正在启动 ${activeSpec.shortName || activeSpec.name} 配音引擎...`, runTtsAll)
          return jsonResponse({ ok: true, jobId: job.id })
        }
        return jsonResponse(await runTtsAll())
      }

      if (action === 'ai-master-voice') {
        const runMaster = async (onProgress) => {
          const report = await masterVoiceTracks({
            projectDir,
            sceneIds: Array.isArray(body.sceneIds) ? body.sceneIds : [],
            useLlm: body.useLlm !== false,
            onProgress,
          })
          onProgress?.('正在将 AI 修音人声与音效、背景音乐重新混音...')
          const updated = readScriptJson(projectDir)
          syncProjectCodeFromScript(projectDir, updated.data)
          const mixResult = await mixVideoAudio({ projectDir, script: updated.data })
          return { ok: true, action, report, mixResult, script: updated.data }
        }
        if (body.async) {
          const job = createBackgroundJob('正在执行配音后 AI 大模型声学修音...', runMaster)
          return jsonResponse({ ok: true, jobId: job.id })
        }
        return jsonResponse(await runMaster())
      }

      if (action === 'snapshot') {
        const result = await executeVideoSnapshot({ projectDir, engine: body.engine })
        return jsonResponse({ ok: true, action, result })
      }

      if (action === 'update-format') {
        const { data } = readScriptJson(projectDir)
        // Re-resolve the canvas only when the request changes it (or the project has none yet). Other settings and the
        // war room's debounced brief saves must keep the canvas: with aspect 'auto', re-resolving against the current
        // assets flipped a 16:9 project to 9:16 as soon as portrait images had been imported.
        const hasValue = (v) => v !== undefined && v !== null && v !== ''
        // a new 首发平台 on an 'auto' canvas also re-resolves it (小红书 → 3:4)
        const platformChange =
          hasValue(body.targetPlatform) && body.targetPlatform !== data.targetPlatform && String(body.aspectRatio || data.requestedAspectRatio || 'auto') === 'auto'
        const formatChange = ['aspectRatio', 'quality', 'width', 'height'].some((k) => hasValue(body[k])) || platformChange
        let dims
        if (formatChange || !data.width || !data.height) {
          const manifest = readAssets(projectDir)
          const visuals = (manifest.items || []).filter((i) => i.type === 'image' || i.type === 'video')
          dims = resolveVideoDimensions({
            aspectRatio: body.aspectRatio || data.requestedAspectRatio || 'auto',
            quality: body.quality || data.quality || '1080p',
            width: body.width,
            height: body.height,
            topic: data.topic || data.title || '',
            assets: visuals,
            targetPlatform: body.targetPlatform || data.targetPlatform || '',
          })
        } else {
          dims = {
            width: data.width,
            height: data.height,
            aspectRatio: data.aspectRatio,
            requestedAspectRatio: data.requestedAspectRatio,
            quality: data.quality,
            reason: data.dimensionReason,
          }
        }
        // 视觉风格: 'auto' (AI 自由匹配) | preset | 'user:<id>' (我的风格预设) → style (always the base preset) +
        // styleMode / styleProfile / theme. Re-picking the current 「AI 自由匹配」 / preset changes nothing (a re-picked
        // 我的预设 refreshes the project's copy from the saved preset).
        let styleFields = null
        if (body.style && !(styleSelectionValue(data) === body.style && !String(body.style).startsWith('user:'))) {
          let decision
          try {
            decision = resolveStyleRequest(data, body.style, {
              text: `${data.topic || data.title || ''} ${data.directorNotes || ''} ${data.goal || ''}`,
              genre: data.genre || '',
              genreLabel: data.genreLabel || '',
            })
          } catch (err) {
            return jsonResponse({ ok: false, action, error: err.message }, 400)
          }
          const sc = applyStyleDecision({ theme: data.theme }, decision, { record: false })
          styleFields = { style: sc.style, styleMode: sc.styleMode, styleProfile: sc.styleProfile, styleAuto: sc.styleAuto, theme: sc.theme }
        }
        const updated = writeScriptJson(projectDir, {
          ...data,
          width: dims.width,
          height: dims.height,
          aspectRatio: dims.aspectRatio,
          requestedAspectRatio: dims.requestedAspectRatio,
          quality: dims.quality,
          dimensionReason: dims.reason,
          ...(body.aiBadge !== undefined ? { aiBadge: Boolean(body.aiBadge), aiBadgeEnabled: Boolean(body.aiBadge) } : {}),
          ...(body.aiBadgeEnabled !== undefined ? { aiBadge: Boolean(body.aiBadgeEnabled), aiBadgeEnabled: Boolean(body.aiBadgeEnabled) } : {}),
          ...(body.aiBadgePosition ? { aiBadgePosition: String(body.aiBadgePosition) } : {}),
          ...(body.aiBadgeText !== undefined ? { aiBadgeText: String(body.aiBadgeText) } : {}),
          ...(body.targetPlatform ? { targetPlatform: body.targetPlatform } : {}),
          ...(body.bgmMode ? { bgmMode: body.bgmMode, audioSpec: { ...(data.audioSpec || {}), bgmMode: body.bgmMode } } : {}),
          ...(body.creationMode ? { creationMode: body.creationMode } : {}),
          ...(body.narrationMode ? { narrationMode: body.narrationMode } : {}),
          ...(body.pacingMode ? { pacingMode: body.pacingMode } : {}),
          ...(body.visual3dMode ? { visual3dMode: body.visual3dMode } : {}),
          ...(body.visualReview !== undefined ? { visualReview: body.visualReview !== false } : {}),
          ...(['auto', 'silhouette', 'papercut', 'puppet', 'ink', 'flat', 'stick', 'custom'].includes(body.figureStyleChoice) ? { figureStyleChoice: body.figureStyleChoice } : {}),
          ...(body.figureStyleChoiceNote !== undefined ? { figureStyleChoiceNote: String(body.figureStyleChoiceNote ?? '').replace(/["“”'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) } : {}),
          ...(body.durationMode !== undefined ? { durationMode: body.durationMode === 'custom' ? 'custom' : 'auto' } : {}),
          ...(body.targetDurationSec !== undefined ? { targetDurationSec: Math.max(0, Math.min(600, Math.round(Number(body.targetDurationSec) || 0))) } : {}),
          ...(styleFields || {}),
          ...(body.fps ? { fps: Number(body.fps) || 30 } : {}),
          ...(body.voiceId ? { defaultVoiceId: body.voiceId } : {}),
          ...(body.engine ? { engine: body.engine } : {}),
          ...(body.topic !== undefined ? { topic: String(body.topic) } : {}),
          ...(body.goal !== undefined ? { goal: String(body.goal) } : body.topic !== undefined ? { goal: String(body.topic) } : {}),
          ...(body.displayTitle !== undefined ? { displayTitle: String(body.displayTitle) } : {}),
          ...(body.directorNotes !== undefined ? { directorNotes: String(body.directorNotes) } : {}),
          ...(Array.isArray(body.contentOutline) ? { contentOutline: body.contentOutline } : {}),
          ...(body.genre !== undefined ? { genre: String(body.genre) } : {}),
          ...(body.genreLabel !== undefined ? { genreLabel: String(body.genreLabel) } : {}),
        })
        syncProjectCodeFromScript(projectDir, updated.data)
        return jsonResponse({ ok: true, action, dimensions: dims, script: updated.data })
      }

      if (action === 'render') {
        const runRender = async (onProgress) => {
          onProgress?.('正在混音与启动逐帧渲染...')
          const { data: sc } = readScriptJson(projectDir)
          let rW = body.renderWidth
          let rH = body.renderHeight
          let draftScale = body.draftScale
          // Keep portrait / square ratios intact when draft720p is requested
          if (body.draft720p && !rW && !rH) {
            const curW = Number(sc.width) || 1920
            const curH = Number(sc.height) || 1080
            const shortEdge = Math.min(curW, curH)
            if (shortEdge > 720) {
              draftScale = 720 / shortEdge
            }
          }
          const result = await executeVideoRender({
            projectDir,
            engine: body.engine,
            renderWidth: rW,
            renderHeight: rH,
            draftScale,
            onProgress: ({ frame, totalFrames, pct }) =>
              onProgress?.({ stage: 'render', progress: pct, message: `正在逐帧合成 MP4 (${frame}/${totalFrames} 帧 · ${pct}%)...` }),
          })
          return { ok: true, action, result }
        }
        if (body.async) {
          const job = createBackgroundJob('正在准备渲染视频...', runRender)
          return jsonResponse({ ok: true, jobId: job.id })
        }
        return jsonResponse(await runRender())
      }

      return jsonResponse({ ok: false, error: `Unknown action: ${action}` }, 400)
    }

    // 6a. GET /api/video-workbench/tasks (list real-time & historical Task Center runs)
    if (pathname === '/api/video-workbench/tasks' && req.method === 'GET') {
      const projectDir = url.searchParams.get('projectDir') || ''
      const runId = url.searchParams.get('runId') || ''
      const runs = taskManager.listRuns(projectDir)
      const activeRun = runId ? taskManager.getRun(runId) : (runs.find((r) => r.status === 'running' || r.status === 'paused') || runs[0] || null)
      return jsonResponse({
        ok: true,
        runs,
        activeRun,
      })
    }

    // 6b. POST /api/video-workbench/tasks/control (pause, resume, stop, retry, pause-all, stop-all)
    if (pathname === '/api/video-workbench/tasks/control' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const action = String(body.action || '').trim().toLowerCase()
      const projectDir = body.projectDir || ''
      const runId = body.runId || ''

      if (action === 'stop-all') {
        const stopped = taskManager.stopAll(projectDir)
        return jsonResponse({ ok: true, action, stoppedCount: stopped.length, runs: taskManager.listRuns(projectDir) })
      }
      if (action === 'pause-all') {
        const paused = taskManager.pauseAll(projectDir)
        return jsonResponse({ ok: true, action, pausedCount: paused.length, runs: taskManager.listRuns(projectDir) })
      }
      if (!runId) return jsonResponse({ ok: false, error: 'runId is required for single-run control' }, 400)

      let updated = null
      if (action === 'pause') updated = taskManager.pauseRun(runId)
      else if (action === 'resume' || action === 'start') updated = await taskManager.resumeRun(runId)
      else if (action === 'stop') updated = taskManager.stopRun(runId)
      else if (action === 'retry') updated = await taskManager.retryRun(runId, { taskId: body.taskId || '' })
      else return jsonResponse({ ok: false, error: `Unsupported task action: ${action}` }, 400)

      return jsonResponse({
        ok: true,
        action,
        run: updated,
        runs: taskManager.listRuns(projectDir || updated?.projectDir || ''),
      })
    }

    // 6c. POST /api/video-workbench/pipeline/start (Launch 4-Agent Command Pipeline)
    if (pathname === '/api/video-workbench/pipeline/start' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir) return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      // 视觉风格: resolve 'auto' / 'user:<id>' against the project and persist it before the run — every pipeline stage
      // then works with the base preset (an AI run's plan call may still design a new style for an auto project)
      try {
        body.style = prepareProjectStyleForRun({
          projectDir: body.projectDir,
          style: body.style,
          text: `${body.topic || ''} ${body.directorNotes || ''} ${body.userPrompt || body.goal || ''}`,
          genre: body.genre || '',
          genreLabel: body.genreLabel || '',
        }).style
      } catch {}
      const run = await startPipelineBackground(body)
      return jsonResponse({
        ok: true,
        runId: run.id,
        run,
        runs: taskManager.listRuns(body.projectDir),
      })
    }

    // 6d. POST /api/video-workbench/assets/recording (Save webcam capture to assets/recordings/, ffprobe & optional clone)
    if (pathname === '/api/video-workbench/assets/recording' && req.method === 'POST') {
      const ct = String(req.headers.get('content-type') || '').toLowerCase()
      let projectDir = ''
      let fileName = ''
      let role = 'host_video'
      let extractVoiceClone = false
      let cloneName = ''
      let binBuf = null

      if (ct.includes('application/json')) {
        const body = await parseRequestJson(req)
        projectDir = body.projectDir || ''
        fileName = body.fileName || `camera-${Date.now()}.webm`
        role = body.role || 'host_video'
        extractVoiceClone = Boolean(body.extractVoiceClone)
        cloneName = body.cloneName || ''
        if (typeof body.dataBase64 === 'string') {
          binBuf = Buffer.from(body.dataBase64.replace(/^data:.*?;base64,/, ''), 'base64')
        }
      } else {
        projectDir = url.searchParams.get('projectDir') || ''
        fileName = url.searchParams.get('fileName') || `camera-${Date.now()}.webm`
        role = url.searchParams.get('role') || 'host_video'
        extractVoiceClone = ['1', 'true', 'yes'].includes(String(url.searchParams.get('extractVoiceClone') || '').toLowerCase())
        cloneName = url.searchParams.get('cloneName') || ''
        binBuf = Buffer.from(await req.arrayBuffer())
      }

      if (!projectDir || !binBuf || binBuf.length === 0) {
        return jsonResponse({ ok: false, error: 'projectDir and recording payload are required' }, 400)
      }

      const absDir = resolve(projectDir)
      const recDir = join(absDir, 'assets', 'recordings')
      mkdirSync(recDir, { recursive: true })
      const safeName = `${Date.now().toString(36)}-${basename(fileName).replace(/[^a-zA-Z0-9._\u4e00-\u9fa5-]/g, '_')}`
      const destAbs = join(recDir, safeName)
      writeFileSync(destAbs, binBuf)

      // Browser (MediaRecorder) WebM has no Duration / Cues: probes report 0 s and players cannot seek it.
      // Remux once with stream copy (no re-encode) so the file carries its real duration; keep the original on failure.
      if (/\.(webm|mkv)$/i.test(safeName)) {
        const remuxed = destAbs.replace(/(\.[^.]+)$/, '.remux$1')
        try {
          const { ffmpeg } = resolveBinaries()
          const rr = await runCommandRedirected(ffmpeg, ['-y', '-v', 'error', '-i', destAbs, '-map', '0', '-c', 'copy', remuxed], {
            timeoutMs: 60_000,
          })
          if (rr.code === 0 && existsSync(remuxed) && statSync(remuxed).size > 0) renameSync(remuxed, destAbs)
        } catch {}
        try {
          if (existsSync(remuxed)) rmSync(remuxed, { force: true })
        } catch {}
      }

      const probe = await probeVideoStream(destAbs).catch(() => ({ durationSec: 0, width: 0, height: 0 }))
      const audioProbe = await probeAudioDuration(destAbs, 30).catch(() => ({ durationSec: 0 }))
      const imp = await importAssets({ projectDir: absDir, sources: [destAbs] })

      let addedItem = (imp.added && imp.added[0]) || null
      if (!addedItem) {
        const curManifest = readAssets(absDir)
        addedItem = curManifest.items.find((x) => x.path.endsWith(safeName)) || null
      }
      if (addedItem) {
        updateAsset(absDir, addedItem.id, { role })
      }

      let clonedVoice = null
      if (extractVoiceClone) {
        try {
          const { ffmpeg } = resolveBinaries()
          const dryWav = join(recDir, `${safeName.replace(/\.[^.]+$/, '')}-vocal24k.wav`)
          const ffRes = await runCommandRedirected(
            ffmpeg,
            ['-y', '-i', destAbs, '-vn', '-af', 'highpass=f=80', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', dryWav],
            { timeoutMs: 30_000 },
          )
          const refSrc = ffRes.code === 0 && existsSync(dryWav) ? dryWav : destAbs
          const cloned = await cloneRecordedVoice({
            sourcePath: refSrc,
            name: cloneName || `出镜录制声纹-${new Date().toLocaleTimeString('zh-CN', { hour12: false }).replace(/:/g, '')}`,
            gender: 'neutral',
          })
          clonedVoice = cloned?.voice || null
        } catch {}
      }

      const manifest = readAssets(absDir)
      return jsonResponse({
        ok: true,
        relPath: `assets/recordings/${safeName}`,
        durationSec: probe.durationSec || audioProbe.durationSec || 0,
        probe,
        asset: addedItem ? { ...addedItem, role } : null,
        clonedVoice,
        manifest,
        summary: summarizeAssets(manifest),
      })
    }

    // 6e. POST /api/video-workbench/assets/role (Reclassify uploaded asset role in Step 1)
    if (pathname === '/api/video-workbench/assets/role' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir || !body.assetId || !body.role) {
        return jsonResponse({ ok: false, error: 'projectDir, assetId, and role are required' }, 400)
      }
      const patched = updateAsset(body.projectDir, body.assetId, { role: String(body.role) })
      const autoBound = await autoBindUploadedAssets(body.projectDir, [patched], String(body.role))
      const manifest = readAssets(body.projectDir)
      return jsonResponse({
        ok: true,
        asset: patched,
        autoBound,
        manifest,
        summary: summarizeAssets(manifest),
      })
    }

    // 6f. POST /api/video-workbench/assets/curate (Manual invoke of FFmpeg Media Editor Agent)
    if (pathname === '/api/video-workbench/assets/curate' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir) return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      const res = await executeCurateAndEditAssets(body)
      const manifest = readAssets(body.projectDir)
      const script = existsSync(join(resolve(body.projectDir), 'script.json')) ? readScriptJson(body.projectDir).data : null
      return jsonResponse({
        ok: true,
        ...res,
        manifest,
        summary: summarizeAssets(manifest),
        script,
      })
    }

    // 6f-2. POST /api/video-workbench/assets/starter-pack (1-click beginner demo assets)
    if (pathname === '/api/video-workbench/assets/starter-pack' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir) return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      const absDir = resolve(body.projectDir)
      const starterDir = join(absDir, 'uploads', '_starter-pack')
      mkdirSync(starterDir, { recursive: true })
      const { ffmpeg } = resolveBinaries()
      const slides = [
        { name: '01-cinema-opener.png', expr: "gradients=s=1280x720:c0=0x1e3a8a:c1=0x38bdf8:nb_colors=4:seed=11,eq=contrast=1.12:saturation=1.35", role: 'visual' },
        { name: '02-aurora-showcase.png', expr: "gradients=s=1280x720:c0=0x0b2b36:c1=0x1ea896:nb_colors=4:seed=27,eq=contrast=1.08:saturation=1.28", role: 'visual' },
        { name: '03-amber-finale.png', expr: "gradients=s=1280x720:c0=0x2a1a0a:c1=0xd97706:nb_colors=4:seed=42,eq=contrast=1.08:saturation=1.22", role: 'visual' },
      ]
      const generatedFiles = []
      for (const sl of slides) {
        const outPng = join(starterDir, sl.name)
        const ff = await runCommandRedirected(
          ffmpeg,
          ['-y', '-f', 'lavfi', '-i', sl.expr, '-frames:v', '1', outPng],
          { timeoutMs: 20_000 },
        ).catch(() => ({ code: 1 }))
        if (ff.code !== 0 || !existsSync(outPng)) {
          await runCommandRedirected(
            ffmpeg,
            ['-y', '-f', 'lavfi', '-i', `color=c=#13243e:s=1280x720:d=0.1`, '-frames:v', '1', outPng],
            { timeoutMs: 15_000 },
          )
        }
        if (existsSync(outPng)) generatedFiles.push(outPng)
      }
      const starterBgm = join(starterDir, 'starter-cinematic-bgm.wav')
      generateBgmWav({ durationSec: 18, mood: 'cinematic', bpm: 108, outPath: starterBgm })
      if (existsSync(starterBgm)) generatedFiles.push(starterBgm)

      const res = await importAssets({ projectDir: absDir, sources: generatedFiles })
      const manifest = readAssets(absDir)
      for (const item of manifest.items || []) {
        if (item.originalName?.includes('starter-cinematic-bgm')) {
          updateAsset(absDir, item.id, { role: 'music', description: '新手试玩演示配乐' })
        }
      }
      const finalManifest = readAssets(absDir)
      return jsonResponse({
        ok: true,
        addedCount: res.addedCount || generatedFiles.length,
        manifest: finalManifest,
        summary: summarizeAssets(finalManifest),
      })
    }

    // 6g. POST /api/video-workbench/teleprompter/generate (AI Teleprompter script lines)
    if (pathname === '/api/video-workbench/teleprompter/generate' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const projectDir = body.projectDir || ''
      const existingScript = projectDir && existsSync(join(resolve(projectDir), 'script.json'))
        ? readScriptJson(projectDir).data
        : null
      const topic = String(body.topic || existingScript?.topic || existingScript?.title || 'AI 智能视觉产品发布').trim()
      const durationSec = Math.max(15, Math.min(180, Number(body.durationSec) || 45))
      const tone = String(body.tone || '口语自然、开场抓人、节奏利落').trim()
      const llmSummary = getSafeLlmConfigSummary()

      let spokenText = ''
      let modelUsed = 'local-script-template'

      if (llmSummary.configured && !body.forceLocal) {
        try {
          const reply = await callLlmChat({
            system: `你是顶级短视频真人口播与黄金三秒编剧。请根据主题撰写可直接放在提词器上朗读的口播文稿：
- 总时长约 ${durationSec} 秒（每句 12~24 字自动换行，适合相机直视朗读）。
- 语气风格：${tone}。
- 纯口播台词，不要加“【镜头1】”、“（微笑）”等括号或场记符号，只输出分句换行文本。`,
            messages: [
              {
                role: 'user',
                content: JSON.stringify({
                  topic,
                  existingScenes: (existingScript?.scenes || []).map((s) => s.narration || s.title).filter(Boolean),
                }),
              },
            ],
            temperature: 0.45,
            maxTokens: 1200,
            timeoutMs: 45_000,
          })
          spokenText = String(reply.text || '').trim()
          modelUsed = reply.model || llmSummary.model
        } catch {}
      }

      if (!spokenText) {
        const fromScenes = (existingScript?.scenes || []).map((s) => String(s.narration || '').trim()).filter(Boolean)
        if (fromScenes.length > 0) {
          spokenText = fromScenes.join('\n\n')
        } else {
          spokenText = [
            `大家好，今天我们用不到一分钟时间，带你沉浸体验「${topic}」。`,
            `以前做一条电影级质感短片，需要反复找素材、剪辑调色、配音修音还要对字幕。`,
            `现在只需要在第一步导入你的素材、背景音乐或者现场录一段口播，`,
            `AI 导演、素材剪辑、配音混音与动效质检四位智能体就会协同完成全部制作。`,
            `点击下方开始录制或一键出片，立刻看到你的电影级成品！`,
          ].join('\n\n')
        }
      }

      const lines = spokenText.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean)
      return jsonResponse({
        ok: true,
        model: modelUsed,
        text: lines.join('\n\n'),
        lines,
      })
    }

    // 6h. POST /api/video-workbench/avatar/generate (Generate transparent alpha WebM avatar)
    if (pathname === '/api/video-workbench/avatar/generate' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir) return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      if (body.async) {
        // Lip-sync can take minutes: optional background job (poll /api/video-workbench/jobs?id=...)
        const { async: _async, ...avatarArgs } = body
        const job = createBackgroundJob('🤖 正在生成数字人（唇形同步 + 透明通道合成）...', async (onProgress) => {
          const res = await executeGenerateAvatar({ ...avatarArgs, onProgress })
          return {
            ...res,
            previewUrl: res.relPath
              ? `/api/video-workbench/asset?projectDir=${encodeURIComponent(body.projectDir)}&rel=${encodeURIComponent(res.relPath)}&t=${Date.now()}`
              : '',
          }
        })
        return jsonResponse({ ok: true, async: true, jobId: job.id, job })
      }
      const res = await executeGenerateAvatar(body)
      const updatedScript = existsSync(join(resolve(body.projectDir), 'script.json'))
        ? readScriptJson(body.projectDir).data
        : null
      return jsonResponse({
        ok: true,
        ...res,
        previewUrl: res.relPath
          ? `/api/video-workbench/asset?projectDir=${encodeURIComponent(body.projectDir)}&rel=${encodeURIComponent(res.relPath)}&t=${Date.now()}`
          : '',
        script: updatedScript,
      })
    }

    // 6h-2. GET/POST /api/video-workbench/avatar/config (External MuseTalk / LatentSync config)
    if (pathname === '/api/video-workbench/avatar/config') {
      if (req.method === 'GET') {
        const lipsync = await getLipsyncStatus({ deep: false }).catch((err) => ({ ready: false, reason: err.message }))
        return jsonResponse({ ok: true, avatarProvider: getAvatarProviderSummary(), lipsync })
      }
      if (req.method === 'POST') {
        const body = await parseRequestJson(req)
        const updated = saveAvatarConfig(body)
        return jsonResponse({ ok: true, avatarProvider: updated })
      }
    }

    // 6h-2b. GET /api/video-workbench/avatar/lipsync (lip-sync engine status / doctor; ?deep=1 loads Python + CUDA)
    if (pathname === '/api/video-workbench/avatar/lipsync' && req.method === 'GET') {
      const deep = ['1', 'true', 'yes'].includes(String(url.searchParams.get('deep') || '').toLowerCase())
      const status = await getLipsyncStatus({ deep, force: deep })
      return jsonResponse({ ok: true, lipsync: status, installer: getLipsyncInstallerCatalog() })
    }

    // 6h-2c. POST /api/video-workbench/avatar/lipsync/install (optional one-click MuseTalk installer, background job)
    if (pathname === '/api/video-workbench/avatar/lipsync/install' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const job = createBackgroundJob('📦 正在安装本地唇形同步引擎 (MuseTalk 1.5)...', async (onProgress) => {
        return await installLipsyncEngine({
          engineId: body.engineId || 'musetalk',
          installDir: body.installDir || '',
          cacheDir: body.cacheDir || '',
          mirror: body.mirror || 'cn',
          pythonBin: body.pythonBin || '',
          reuseTorch: body.reuseTorch === false ? 'no' : 'auto',
          withEvalModels: body.withEvalModels !== false,
          writeEnv: body.writeEnv !== false,
          onProgress,
        })
      })
      return jsonResponse({ ok: true, async: true, jobId: job.id, job })
    }

    // 6h-3. POST /api/video-workbench/polish-topic (AI polish user short prompt into rich director brief; supports 10-min async job)
    if (pathname === '/api/video-workbench/polish-topic' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (body.async) {
        const job = createBackgroundJob('✨ AI 大模型正在深度分析素材与需求并润色专业导演指令（支持最长 10 分钟）...', async () => {
          return await polishTopicPrompt(body)
        })
        return jsonResponse({ ok: true, async: true, jobId: job.id, job })
      }
      try {
        const res = await polishTopicPrompt(body)
        return jsonResponse(res)
      } catch (err) {
        return jsonResponse({ ok: false, error: err?.message || String(err) }, Number(err?.status) || 500)
      }
    }

    // 6h-4. GET /api/video-workbench/tts/install-options & POST /tts/install & POST /tts/repair-voices
    if (pathname === '/api/video-workbench/tts/install-options' && req.method === 'GET') {
      return jsonResponse({ ok: true, catalog: getTtsInstallerCatalog() })
    }
    if (pathname === '/api/video-workbench/tts/repair-voices' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const res = await ensureDefaultReferenceVoices({
        idxRoot: body.idxRoot || '',
        gptRoot: body.gptRoot || '',
      })
      const cat = getVoiceCatalog()
      return jsonResponse({
        ok: true,
        ...res,
        voiceCount: cat.voices.length,
        availableCount: cat.voices.filter((v) => v.available).length,
      })
    }
    if (pathname === '/api/video-workbench/tts/install' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.engineId) return jsonResponse({ ok: false, error: 'engineId is required' }, 400)
      if (body.async !== false) {
        const job = createBackgroundJob(`📦 正在自动安装 ${body.engineId} 配音依赖包并接入插件...`, async (onProgress) => {
          return await installTtsEngine({
            engineId: body.engineId,
            installDir: body.installDir || '',
            mirror: body.mirror || 'cn',
            pythonBin: body.pythonBin || '',
            autoActivate: body.autoActivate !== false,
            skipModelDownload: Boolean(body.skipModelDownload),
            onProgress,
          })
        })
        return jsonResponse({ ok: true, async: true, jobId: job.id, job })
      }
      const res = await installTtsEngine(body)
      return jsonResponse({ ok: true, ...res, ttsConfig: getSafeTtsConfigSummary(), catalog: getTtsInstallerCatalog() })
    }

    // 6h-5. Reference Video Upload & Deep Reverse-Engineering (/reference/upload, /reference/analyze, /reference/clear)
    if (pathname === '/api/video-workbench/reference/upload' && req.method === 'POST') {
      const ct = String(req.headers.get('content-type') || '').toLowerCase()
      let projectDir = ''
      let fileName = `reference-${Date.now()}.mp4`
      let extractAudioAsBgm = false
      let useVision = true
      let isAsync = true
      let localPath = ''
      let binBuf = null

      if (ct.includes('application/json')) {
        const body = await parseRequestJson(req)
        projectDir = body.projectDir || ''
        fileName = body.fileName || fileName
        extractAudioAsBgm = Boolean(body.extractAudioAsBgm)
        useVision = body.useVision !== false
        isAsync = body.async !== false
        localPath = body.localPath || body.videoPath || ''
        if (typeof body.dataBase64 === 'string') {
          binBuf = Buffer.from(body.dataBase64.replace(/^data:.*?;base64,/, ''), 'base64')
        }
      } else {
        projectDir = url.searchParams.get('projectDir') || ''
        fileName = url.searchParams.get('fileName') || fileName
        extractAudioAsBgm = ['1', 'true', 'yes'].includes(String(url.searchParams.get('extractAudioAsBgm') || '').toLowerCase())
        useVision = url.searchParams.get('useVision') !== '0'
        isAsync = url.searchParams.get('async') !== '0'
        localPath = url.searchParams.get('localPath') || ''
        try {
          binBuf = Buffer.from(await req.arrayBuffer())
        } catch {}
      }

      if (!projectDir) return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      const absProject = resolve(projectDir)
      const refDir = join(absProject, 'reference')
      mkdirSync(refDir, { recursive: true })

      let stagedPath = ''
      if (binBuf && binBuf.length > 0) {
        const safeName = basename(fileName).replace(/[^a-zA-Z0-9._\u4e00-\u9fa5-]/g, '_') || 'reference.mp4'
        stagedPath = join(refDir, safeName)
        writeFileSync(stagedPath, binBuf)
      } else if (localPath && existsSync(localPath)) {
        stagedPath = localPath
      } else {
        return jsonResponse({ ok: false, error: '请上传参考视频文件或提供有效本地路径' }, 400)
      }

      const runner = (onProgress) =>
        analyzeReferenceVideo({
          projectDir: absProject,
          videoPath: stagedPath,
          extractAudioAsBgm,
          applyToScript: true,
          useVision,
          onProgress,
        })

      if (isAsync) {
        const job = createBackgroundJob('🎯 正在拆解参考视频分镜节奏、节拍与多模态视觉基因...', runner)
        return jsonResponse({ ok: true, async: true, jobId: job.id, job })
      }
      const res = await runner()
      return jsonResponse(res)
    }

    if (pathname === '/api/video-workbench/reference/analyze' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir || !body.videoPath) {
        return jsonResponse({ ok: false, error: 'projectDir and videoPath are required' }, 400)
      }
      if (body.async) {
        const job = createBackgroundJob('🎯 正在拆解参考视频视觉基因与镜头公式...', (onProgress) =>
          analyzeReferenceVideo({ ...body, onProgress }),
        )
        return jsonResponse({ ok: true, async: true, jobId: job.id, job })
      }
      const res = await analyzeReferenceVideo(body)
      return jsonResponse(res)
    }

    if (pathname === '/api/video-workbench/reference/clear' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir) return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      const { data } = readScriptJson(body.projectDir)
      delete data.referenceStyle
      const saved = writeScriptJson(body.projectDir, data)
      return jsonResponse({ ok: true, script: saved.data })
    }

    // 6h-6. Brand Kit & MOTION.md Blueprint (/brand-kit, /motion-md)
    if (pathname === '/api/video-workbench/brand-kit') {
      const projectDir = url.searchParams.get('projectDir') || ''
      if (req.method === 'GET') {
        return jsonResponse({ ok: true, brandKit: loadBrandKit(projectDir) })
      }
      if (req.method === 'POST') {
        const body = await parseRequestJson(req)
        const saved = saveBrandKit(body.brandKit || body, body.projectDir || projectDir)
        return jsonResponse({ ok: true, brandKit: saved })
      }
    }

    if (pathname === '/api/video-workbench/motion-md' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      if (!body.projectDir) return jsonResponse({ ok: false, error: 'projectDir is required' }, 400)
      return jsonResponse(exportProjectMotionMd(body.projectDir))
    }

    // 6i. POST /api/video-workbench/skin/upload & GET /api/video-workbench/skin (Custom background skin)
    if (pathname === '/api/video-workbench/skin/upload' && req.method === 'POST') {
      const ct = String(req.headers.get('content-type') || '').toLowerCase()
      let fileName = `skin-${Date.now()}.jpg`
      let buf = null
      if (ct.includes('application/json')) {
        const body = await parseRequestJson(req)
        fileName = body.fileName || fileName
        if (typeof body.dataBase64 === 'string') {
          buf = Buffer.from(body.dataBase64.replace(/^data:.*?;base64,/, ''), 'base64')
        }
      } else {
        fileName = url.searchParams.get('fileName') || fileName
        buf = Buffer.from(await req.arrayBuffer())
      }
      if (!buf || buf.length === 0) return jsonResponse({ ok: false, error: 'Image payload required' }, 400)
      const skinsDir = join(getWorkspaceRoot(), '.skins')
      mkdirSync(skinsDir, { recursive: true })
      const safeSkin = `${Date.now().toString(36)}-${basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_')}`
      writeFileSync(join(skinsDir, safeSkin), buf)
      return jsonResponse({
        ok: true,
        name: safeSkin,
        url: `/api/video-workbench/skin?name=${encodeURIComponent(safeSkin)}`,
      })
    }

    if (pathname === '/api/video-workbench/skin' && req.method === 'GET') {
      const nameParam = basename(url.searchParams.get('name') || '')
      if (!nameParam) return new Response('Not found', { status: 404 })
      const skinFile = join(getWorkspaceRoot(), '.skins', nameParam)
      if (!existsSync(skinFile)) return new Response('Not found', { status: 404 })
      const ext = extname(skinFile).toLowerCase()
      return new Response(readFileSync(skinFile), {
        status: 200,
        headers: { 'Content-Type': MIME_MAP[ext] || 'image/png', 'Cache-Control': 'public, max-age=86400' },
      })
    }

    // 6f. Optional BYOK Cloud AI Media (Image / Video / Suno & MiniMax Audio + Custom HTTP Protocol)
    if (pathname === '/api/video-workbench/cloud-media') {
      if (req.method === 'GET') {
        return jsonResponse({ ok: true, config: getCloudMediaConfigSummary() })
      }
      if (req.method === 'POST') {
        const body = await parseRequestJson(req)
        return jsonResponse({ ok: true, config: saveCloudMediaConfig(body) })
      }
    }

    if (pathname === '/api/video-workbench/cloud-media/generate' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const stageOnly = body.stageOnly !== false
      // Runs on the shared background-job registry polled by GET jobs?id= (status running → done | error).
      // (This route used createJob/updateJob, which were never defined, so every request threw.)
      const job = createBackgroundJob(
        `☁️ 云端 AI 生成 (${body.category || 'image'})：任务已提交…`,
        (onProgress) => generateCloudMediaAsset({ ...body, stageOnly, onProgress }),
        { doneMessage: (res) => (res?.staged ? '✨ 已生成至预览验收区，请先查看/试听满意后再确认入库' : `✅ 云端生成并入库完成：${res?.path || ''}`) },
      )
      return jsonResponse({ ok: true, jobId: job.id, job })
    }

    if (pathname === '/api/video-workbench/cloud-media/assist-prompt' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const res = await assistCloudMediaPrompt(body)
      return jsonResponse(res)
    }

    if (pathname === '/api/video-workbench/cloud-media/staging' && req.method === 'GET') {
      const projectDir = url.searchParams.get('projectDir') || ''
      return jsonResponse({ ok: true, items: projectDir ? listStagedCloudAssets(projectDir) : [] })
    }

    if (pathname === '/api/video-workbench/cloud-media/staging/commit' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const res = await commitStagedCloudAsset(body)
      return jsonResponse(res)
    }

    if (pathname === '/api/video-workbench/cloud-media/staging/discard' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const res = discardStagedCloudAsset(body)
      return jsonResponse(res)
    }

    // 6g. 影核广场 · CinePulse Hub (Built-in & Community MOTION.md Template Plaza)
    if (pathname === '/api/video-workbench/plaza/templates' && req.method === 'GET') {
      const category = url.searchParams.get('category') || 'all'
      const query = url.searchParams.get('q') || ''
      return jsonResponse(listPlazaTemplates({ category, query }))
    }

    if (pathname === '/api/video-workbench/plaza/template' && req.method === 'GET') {
      const id = url.searchParams.get('id') || ''
      const detail = getPlazaTemplate(id)
      const { dirPath, coverAbsPath, previewAbsPath, ...pubTpl } = detail.template
      return jsonResponse({ ok: true, template: pubTpl, motionMd: detail.motionMd, sceneCount: detail.script?.scenes?.length || 0 })
    }

    // Playable sample clip of a plaza template (HTTP Range, so the player can seek and show its progress bar)
    if (pathname === '/api/video-workbench/plaza/preview' && req.method === 'GET') {
      const id = url.searchParams.get('id') || ''
      let detail = null
      try {
        detail = getPlazaTemplate(id)
      } catch {
        return new Response('Template Not Found', { status: 404 })
      }
      const file = detail.template?.previewAbsPath
      if (!file || !existsSync(file)) {
        return new Response('Preview Not Found', { status: 404 })
      }
      const ext = extname(file).toLowerCase()
      return serveFileWithRange(req, file, MIME_MAP[ext] || 'video/mp4')
    }

    // War-room skins: 3 switchable full-viewport skin documents (contract: lib/warroom/BRIDGE.md)
    if (pathname === '/api/video-workbench/warroom/skins' && req.method === 'GET') {
      return jsonResponse({
        ok: true,
        skins: WARROOM_SKINS.map((s) => ({ ...s, available: existsSync(resolveWarroomSkinFile(s.id)) })),
      })
    }
    // Native panel kit shared by all skins (built from lib/warroom/kit/src → lib/warroom/kit.js + kit.css); a skin
    // loads it relatively ("kit.js"), which resolves here when the skin is served from /warroom/skin
    if ((pathname === '/api/video-workbench/warroom/kit.js' || pathname === '/api/video-workbench/warroom/kit.css') && req.method === 'GET') {
      const isCss = pathname.endsWith('.css')
      const file = join(WARROOM_DIR, isCss ? 'kit.css' : 'kit.js')
      const type = isCss ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8'
      if (!existsSync(file)) return new Response(isCss ? '/* kit.css missing */' : '/* kit.js missing */', { status: 404, headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } })
      return new Response(readFileSync(file), { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' } })
    }
    if (pathname === '/api/video-workbench/warroom/skin' && req.method === 'GET') {
      const id = String(url.searchParams.get('id') || '')
      const skin = WARROOM_SKINS.find((s) => s.id === id)
      const file = skin ? resolveWarroomSkinFile(skin.id) : ''
      if (!file || !existsSync(file)) {
        return new Response(
          `<!doctype html><meta charset="utf-8"><title>皮肤不存在</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0f1a;color:#cbd5e1;font:14px 'Microsoft YaHei UI',system-ui,sans-serif">作战大屏皮肤「${skin ? skin.name : '未知'}」未安装，请切换到其他大屏或重新安装插件。</body>`,
          { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
        )
      }
      return new Response(readFileSync(file), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' },
      })
    }

    if (pathname === '/api/video-workbench/plaza/cover' && req.method === 'GET') {
      const id = url.searchParams.get('id') || ''
      const detail = getPlazaTemplate(id)
      if (!detail.template?.coverAbsPath || !existsSync(detail.template.coverAbsPath)) {
        return new Response('Cover Not Found', { status: 404 })
      }
      const ext = extname(detail.template.coverAbsPath).toLowerCase()
      return new Response(readFileSync(detail.template.coverAbsPath), {
        status: 200,
        headers: { 'Content-Type': MIME_MAP[ext] || 'image/jpeg', 'Cache-Control': 'public, max-age=3600' },
      })
    }

    if (pathname === '/api/video-workbench/plaza/apply' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const res = applyPlazaTemplateToProject(body)
      return jsonResponse(res)
    }

    if (pathname === '/api/video-workbench/plaza/publish' && req.method === 'POST') {
      const body = await parseRequestJson(req)
      const res = await publishProjectToPlaza(body)
      return jsonResponse({ ...res, plaza: listPlazaTemplates() })
    }

    // 6h. GET /api/video-workbench/reference/video (Range-stream uploaded reference video for side-by-side sync compare player)
    if (pathname === '/api/video-workbench/reference/video' && req.method === 'GET') {
      const projectDir = url.searchParams.get('projectDir') || ''
      if (!projectDir) return new Response('projectDir required', { status: 400 })
      const absProject = resolve(projectDir)
      let rel = ''
      try {
        const { data } = readScriptJson(absProject)
        // the analyzer writes sourceRelPath; older scripts used sourceRel
        rel = data?.referenceStyle?.sourceRelPath || data?.referenceStyle?.sourceRel || ''
      } catch {}
      let refFile = rel ? resolve(absProject, rel) : ''
      if (!refFile || !existsSync(refFile)) {
        const refDir = join(absProject, 'reference')
        if (existsSync(refDir)) {
          const hit = readdirSync(refDir).find((f) => /\.(mp4|mov|webm|mkv)$/i.test(f))
          if (hit) refFile = join(refDir, hit)
        }
      }
      if (!refFile || !refFile.startsWith(absProject) || !existsSync(refFile)) {
        return new Response('Reference Video Not Found', { status: 404 })
      }
      const ext = extname(refFile).toLowerCase()
      return serveFileWithRange(req, refFile, MIME_MAP[ext] || 'video/mp4')
    }

    // 7. GET /api/video-workbench/asset?projectDir=...&rel=... (stream HTML, images, video, WAV, MP4 with Range support)
    if (pathname === '/api/video-workbench/asset' && req.method === 'GET') {
      const projectDir = url.searchParams.get('projectDir') || ''
      const rel = url.searchParams.get('rel') || 'index.html'
      const absProject = resolve(projectDir)
      const targetFile = resolve(absProject, rel)
      if (!targetFile.startsWith(absProject) || !existsSync(targetFile)) {
        return new Response('Asset Not Found', { status: 404 })
      }
      const ext = extname(targetFile).toLowerCase()
      if (ext === '.html' && url.searchParams.get('preview') === '1') {
        const assetBase = `/api/video-workbench/asset?projectDir=${encodeURIComponent(absProject)}&rel=`
        const html = readFileSync(targetFile, 'utf8')
          .replace(/(src|data-media-src)="(assets|output)\//g, `$1="${assetBase}$2/`)
          .replace(/"output\/avatar\//g, `"${assetBase}output/avatar/`)
          .replace(/fetch\('(assets|output)\//g, `fetch('${assetBase}$1/`)
          .replace(/url\((['"]?)fonts\//g, `url($1${assetBase}fonts/`)
        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
          },
        })
      }
      const contentType = MIME_MAP[ext] || 'application/octet-stream'
      return serveFileWithRange(req, targetFile, contentType)
    }

    if (isDeliveryRoute(pathname)) return await handleDeliveryApiRequest(req, url)
    if (isProjectRoute(pathname)) return await handleProjectApiRequest(req, url, { createBackgroundJob })
    if (isCoverRoute(pathname)) return await handleCoverApiRequest(req, url, { createBackgroundJob })
    if (isPlazaCommunityRoute(pathname)) return await handlePlazaCommunityApiRequest(req, url, { createBackgroundJob })
    return jsonResponse({ ok: false, error: `Route not found: ${pathname}` }, 404)
  } catch (err) {
    return jsonResponse({ ok: false, error: err?.message || String(err) }, 500)
  }
}

export const name = 'dsh-web-video-workbench'

export function apply(ctx) {
  // Loaded by the real DSH client (not the MCP server's / standalone studio's shim): the host agent is DSH, which the
  // default LLM mode 「跟随当前智能体」 follows. A value already set (by the user or an MCP client) wins.
  if (ctx && !ctx.__dshVideoShim && !String(process.env.DSH_VIDEO_HOST_AGENT || '').trim()) process.env.DSH_VIDEO_HOST_AGENT = 'dsh'
  try {
    listVideoProjects()
  } catch {}

  // 1. Register Web Fetch API routes (`connection.fetch.register`)
  ctx.inject(['connection'], (innerCtx) => {
    const routes = [
      { path: '/api/video-workbench/state', methods: ['GET'] },
      { path: '/api/video-workbench/hardware', methods: ['GET', 'POST'] },
      { path: '/api/video-workbench/jobs', methods: ['GET'] },
      { path: '/api/video-workbench/llm-config', methods: ['GET', 'POST'] },
      { path: '/api/video-workbench/llm-test', methods: ['POST'] },
      { path: '/api/video-workbench/tts-config', methods: ['GET', 'POST'] },
      { path: '/api/video-workbench/tts-test', methods: ['POST'] },
      { path: '/api/video-workbench/voices/preview', methods: ['GET'] },
      { path: '/api/video-workbench/projects', methods: ['POST'] },
      { path: '/api/video-workbench/projects/delete', methods: ['POST'] },
      { path: '/api/video-workbench/script', methods: ['POST'] },
      { path: '/api/video-workbench/assets/import', methods: ['POST'] },
      { path: '/api/video-workbench/assets/upload', methods: ['POST'] },
      { path: '/api/video-workbench/assets/delete', methods: ['POST'] },
      { path: '/api/video-workbench/plan', methods: ['POST'] },
      { path: '/api/video-workbench/produce', methods: ['POST'] },
      { path: '/api/video-workbench/ai-produce', methods: ['POST'] },
      { path: '/api/video-workbench/ai-refine', methods: ['POST'] },
      { path: '/api/video-workbench/code', methods: ['GET'] },
      { path: '/api/video-workbench/qa', methods: ['POST'] },
      { path: '/api/video-workbench/voices/import', methods: ['POST'] },
      { path: '/api/video-workbench/voices/clone-upload', methods: ['POST'] },
      { path: '/api/video-workbench/voices/delete', methods: ['POST'] },
      { path: '/api/video-workbench/voices/clone-preview', methods: ['POST'] },
      { path: '/api/video-workbench/voices/match', methods: ['POST'] },
      { path: '/api/video-workbench/bgm/upload', methods: ['POST'] },
      { path: '/api/video-workbench/audio/llm-compose', methods: ['POST'] },
      { path: '/api/video-workbench/audio/tts-compose', methods: ['POST'] },
      { path: '/api/video-workbench/publish-pack', methods: ['POST'] },
      { path: '/api/video-workbench/vendor/import', methods: ['POST'] },
      { path: '/api/video-workbench/safe-zone', methods: ['GET'] },
      { path: '/api/video-workbench/style-presets', methods: ['GET'] },
      { path: '/api/video-workbench/style-presets/save', methods: ['POST'] },
      { path: '/api/video-workbench/style-presets/rename', methods: ['POST'] },
      { path: '/api/video-workbench/style-presets/delete', methods: ['POST'] },
      { path: '/api/video-workbench/action', methods: ['POST'] },
      { path: '/api/video-workbench/tasks', methods: ['GET'] },
      { path: '/api/video-workbench/tasks/control', methods: ['POST'] },
      { path: '/api/video-workbench/pipeline/start', methods: ['POST'] },
      { path: '/api/video-workbench/assets/recording', methods: ['POST'] },
      { path: '/api/video-workbench/assets/role', methods: ['POST'] },
      { path: '/api/video-workbench/assets/curate', methods: ['POST'] },
      { path: '/api/video-workbench/assets/starter-pack', methods: ['POST'] },
      { path: '/api/video-workbench/teleprompter/generate', methods: ['POST'] },
      { path: '/api/video-workbench/avatar/generate', methods: ['POST'] },
      { path: '/api/video-workbench/avatar/config', methods: ['GET', 'POST'] },
      { path: '/api/video-workbench/avatar/lipsync', methods: ['GET'] },
      { path: '/api/video-workbench/avatar/lipsync/install', methods: ['POST'] },
      { path: '/api/video-workbench/polish-topic', methods: ['POST'] },
      { path: '/api/video-workbench/tts/install-options', methods: ['GET'] },
      { path: '/api/video-workbench/tts/install', methods: ['POST'] },
      { path: '/api/video-workbench/tts/repair-voices', methods: ['POST'] },
      { path: '/api/video-workbench/reference/upload', methods: ['POST'] },
      { path: '/api/video-workbench/reference/analyze', methods: ['POST'] },
      { path: '/api/video-workbench/reference/clear', methods: ['POST'] },
      { path: '/api/video-workbench/reference/video', methods: ['GET'] },
      { path: '/api/video-workbench/brand-kit', methods: ['GET', 'POST'] },
      { path: '/api/video-workbench/motion-md', methods: ['POST'] },
      { path: '/api/video-workbench/cloud-media', methods: ['GET', 'POST'] },
      { path: '/api/video-workbench/cloud-media/generate', methods: ['POST'] },
      { path: '/api/video-workbench/cloud-media/assist-prompt', methods: ['POST'] },
      { path: '/api/video-workbench/cloud-media/staging', methods: ['GET'] },
      { path: '/api/video-workbench/cloud-media/staging/commit', methods: ['POST'] },
      { path: '/api/video-workbench/cloud-media/staging/discard', methods: ['POST'] },
      { path: '/api/video-workbench/plaza/templates', methods: ['GET'] },
      { path: '/api/video-workbench/plaza/template', methods: ['GET'] },
      { path: '/api/video-workbench/plaza/cover', methods: ['GET'] },
      { path: '/api/video-workbench/plaza/preview', methods: ['GET'] },
      { path: '/api/video-workbench/warroom/skins', methods: ['GET'] },
      { path: '/api/video-workbench/warroom/skin', methods: ['GET'] },
      { path: '/api/video-workbench/warroom/kit.js', methods: ['GET'] },
      { path: '/api/video-workbench/warroom/kit.css', methods: ['GET'] },
      { path: '/api/video-workbench/plaza/apply', methods: ['POST'] },
      { path: '/api/video-workbench/plaza/publish', methods: ['POST'] },
      { path: '/api/video-workbench/skin/upload', methods: ['POST'] },
      { path: '/api/video-workbench/skin', methods: ['GET'] },
      { path: '/api/video-workbench/asset', methods: ['GET'] },
      ...DELIVERY_ROUTES,
      ...PROJECT_ROUTES,
      ...COVER_ROUTES,
      ...PLAZA_COMMUNITY_ROUTES,
    ]
    for (const r of routes) {
      try {
        innerCtx.connection.fetch.register({
          path: r.path,
          methods: r.methods,
          requestBody: 'buffered',
          fetch: handleWorkbenchApiRequest,
        })
      } catch {}
    }
  })

  // Optional native DSH Jobs bridge (never listed in mandatory `inject` so standalone/self-test works cleanly)
  try {
    if (ctx.jobs) taskManager.attachDshJobs(ctx.jobs)
    else if (typeof ctx.inject === 'function') {
      ctx.inject(['jobs'], (innerCtx) => {
        if (innerCtx?.jobs) taskManager.attachDshJobs(innerCtx.jobs)
      })
    }
  } catch {}

  // 2. Inject Frontend Module (`lib/client.js`) into DSH Web UI when webui service is available
  try {
    ctx.inject(['webui'], (innerCtx) => {
      innerCtx?.webui?.addStaticModule?.({
        id: 'dsh-video-workbench',
        path: join(__dirname, 'client.js'),
      })
    })
  } catch {}
}

export { VIDEO_MAKER_SYSTEM_PROMPT }
export default { name, apply }
