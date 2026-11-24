/**
 * 画面自检 (visual self-review) for AI-coded Remotion scenes — genre-agnostic.
 *
 * Compiling is not seeing: a scene can pass tsc and still show paper-doll people, an empty sky, text on top of text or
 * a black frame. After the batches compile, a few keyframes per scene are rendered (scene-keyframes.js) and the
 * configured multimodal model looks at them batch by batch against each shot's storyboard. Shots with a major
 * problem get one targeted rewrite with their screenshots attached; the rewrite still has to compile.
 *
 * Costs: one review call per batch, plus one rewrite call per batch that has a major problem. A text-only model is
 * detected on the first call and the review is skipped without breaking the pipeline.
 */
import { FIGURE_STYLE_ZH } from './figure-kit.js'
import { extractJsonFromLlmText } from './llm-client.js'

export const REVIEW_ISSUE_KINDS = ['figure', 'empty', 'mismatch', 'text', 'dark', 'clutter', 'broken', 'static']

const KIND_ZH = {
  figure: '人物/动物画得简陋或怪异',
  empty: '画面空洞',
  mismatch: '与分镜不符',
  text: '文字问题',
  dark: '主体过暗',
  clutter: '杂乱遮挡',
  broken: '渲染异常',
  static: '画面不动',
}

/** How to fix each kind of problem (sent with the rewrite request). */
export const REVIEW_FIX_HINTS = {
  figure: "按本片的人物画风把人物重画到成片水准：比例协调、关节连贯、姿态自然、服装道具清楚，不要用方块椭圆拼纸片人；本片画风是人物库现成的（剪影 / 剪纸 / 皮影 / 水墨 / 扁平侧身 / 火柴人）时，也可以直接换成 '../lib/figure-kit' 的 <Figure look={castLook(scene, 'id')} style=… action=…/>、<Horse>、<Troop>",
  empty: '按 visualBlueprint 补上主体（人物 / 物件 / 图形）并做出前景、中景、背景三层，主体占画面 30% 以上',
  mismatch: '按 visualBlueprint 重做这一镜的构图，确保分镜里写的关键主体与动作出现在画面中',
  text: '调整文字位置、字号与换行：文字之间、文字与主体之间不重叠，不出画；底部字幕区与右上角角标区不放文字；去掉指令性文字与占位符',
  dark: '提亮主体：加轮廓光 / 补光 / 提高主体与背景的明暗对比，压暗叠层不透明度不超过 0.35',
  clutter: '减少同时出现的元素，分清主次，主体周围留白，前后景不要互相遮挡关键信息',
  broken: '修复导致白屏 / 黑屏 / 大色块 / 元素飞出画面的代码（检查坐标、viewBox、透明度与 interpolate 的输入范围）',
  static: '加入覆盖整镜的持续运动（人物动作、镜头缓推 2–4%、前后景差速漂移、粒子光影流动）',
}

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/**
 * Review request for one batch: storyboard text and the keyframes of each shot, interleaved.
 * frames: [{ sceneId, fraction, base64 }]
 */
/** Chinese name of the film's character style for review / fix prompts ('' when the film did not set one). */
function figureStyleText(figureStyle = '', figureStyleNote = '') {
  if (figureStyle === 'custom') return `自定义（${figureStyleNote || '见分镜与导演备注'}）`
  if (!figureStyle || figureStyle === 'auto') return ''
  return FIGURE_STYLE_ZH[figureStyle] || String(figureStyle)
}

export function buildVisualReviewRequest({ batchScenes = [], frames = [], genreLabel = '', figureStyle = '', figureStyleNote = '', width = 1920, height = 1080 } = {}) {
  const styleText = figureStyleText(figureStyle, figureStyleNote)
  const system = `你是严格的动画成片质检导演。你会看到一批镜头的关键帧截图（每个镜头一般 2 张：镜头进行到 35% 与 80% 时的画面）和每个镜头的分镜描述。请逐镜判断画面是否达到可以交付的成片水准，只报告真正影响观感的问题。
说明：
- 画面底部的字幕条、角落的「AI 辅助创作」角标由系统统一叠加，不算问题。
- 剪影、剪纸、皮影、水墨、扁平、火柴人、Q版、动漫、绘本、像素等风格化画法都是有意为之：人物不需要写实，但必须比例协调、关节连贯、姿态自然、能看出在做什么；如果说明了本片人物画风，而画面里的人物明显是另一种画风，记为 mismatch。
- 问题类型 kind：figure（人物或动物画得简陋/怪异：几个方块椭圆拼成的纸片人、比例失调、肢体错位扭曲、头身分离、五官诡异）· empty（画面空洞，只有背景/渐变/几条线，缺少分镜要求的主体）· mismatch（画面与分镜描述明显不符）· text（文字重叠、出画、遮挡主体、乱码、出现指令性文字或英文占位符）· dark（主体过暗看不清）· clutter（元素杂乱、互相遮挡、构图失衡）· broken（白屏、黑屏、大色块、元素飞出画面等渲染异常）· static（两张关键帧几乎一样，画面没有动起来）。
- severity：major = 观众一眼就能看出、必须返工的问题；minor = 可以接受的小瑕疵；none = 没有问题。不要为了挑错而挑错，好的镜头直接给 none。
- seen：用 10~30 个字写出你在截图里实际看到的内容（用来核对你真的看了图）。
只输出严格 JSON（不要 Markdown 围栏）：{"scenes":[{"id":"scene-01","seen":"…","severity":"none|minor|major","issues":[{"kind":"figure","detail":"具体问题，指出画面位置","fix":"具体怎么改"}]}]}`
  const content = [
    {
      type: 'text',
      text: `作品类型：${genreLabel || '未指定'}${styleText ? `；本片人物画风：${styleText}` : ''}；画布 ${width}x${height}。下面共 ${batchScenes.length} 个镜头，请逐镜检查。`,
    },
  ]
  for (const sc of batchScenes) {
    const shots = frames.filter((f) => f.sceneId === sc.id && f.base64)
    if (!shots.length) continue
    content.push({
      type: 'text',
      text: `【${sc.id}】${clip(sc.title, 24)}｜分镜：${clip(sc.visualBlueprint || sc.motionNotes || sc.visualPrompt || '', 220)}${sc.narration ? `｜旁白：${clip(sc.narration, 60)}` : ''}｜截图 ${shots.map((f) => `${Math.round(f.fraction * 100)}%`).join('、')}：`,
    })
    for (const f of shots) content.push({ type: 'image', mimeType: 'image/jpeg', base64: f.base64 })
  }
  return { system, messages: [{ role: 'user', content }] }
}

/** Normalised review: { scenes: { [id]: { severity, issues, seen } }, looked: boolean } */
export function parseVisualReview(text = '', sceneIds = []) {
  const parsed = extractJsonFromLlmText(String(text || ''))
  const list = Array.isArray(parsed?.scenes) ? parsed.scenes : Array.isArray(parsed) ? parsed : []
  const want = new Set(sceneIds)
  const scenes = {}
  let seenCount = 0
  for (const item of list) {
    const id = String(item?.id || item?.sceneId || '').trim()
    if (!want.has(id) || scenes[id]) continue
    const issues = (Array.isArray(item?.issues) ? item.issues : [])
      .map((it) => ({
        kind: REVIEW_ISSUE_KINDS.includes(String(it?.kind || '').trim()) ? String(it.kind).trim() : 'mismatch',
        detail: clip(it?.detail || it?.problem || '', 200),
        fix: clip(it?.fix || it?.suggestion || '', 200),
      }))
      .filter((it) => it.detail)
      .slice(0, 4)
    let severity = String(item?.severity || '').trim().toLowerCase()
    if (!['none', 'minor', 'major'].includes(severity)) severity = issues.length ? 'minor' : 'none'
    if (severity !== 'none' && issues.length === 0) severity = 'none'
    const seen = clip(item?.seen || '', 80)
    if (seen) seenCount++
    scenes[id] = { severity, issues, seen }
  }
  // a model that never describes what it saw did not look at the images (text-only model behind an image API)
  return { scenes, looked: seenCount > 0 }
}

/** Rewrite request for the flagged shots of one batch (screenshots of those shots attached). */
export function buildVisualFixRequest({ filePath, exportName, code, batchScenes = [], review = {}, frames = [], figureStyle = '', figureStyleNote = '' } = {}) {
  const byId = new Map(batchScenes.map((s) => [s.id, s]))
  const styleText = figureStyleText(figureStyle, figureStyleNote)
  // a film with its own character style is never pushed onto the library's look by a rewrite
  const howFor = (kind) =>
    kind === 'figure' && figureStyle === 'custom'
      ? `按本片的人物画风（${styleText}）把人物重画到成片水准：比例协调、关节连贯、姿态自然、服装道具清楚，同一角色每个镜头保持一致；不要换成人物库的侧身人形`
      : REVIEW_FIX_HINTS[kind]
  const flagged = Object.entries(review).filter(([, r]) => r.severity === 'major')
  const task = {
    task: `请根据画面自检结果修改 ${filePath}：下列镜头渲染出来的画面有明显问题（附当前画面截图）。只修改这些镜头，其它镜头保持原样；保留每镜的文字内容、时长节奏与 scene.actionEvents 接触帧对齐，只解决列出的问题。`,
    problems: flagged.map(([id, r]) => ({
      sceneId: id,
      visualBlueprint: clip(byId.get(id)?.visualBlueprint || byId.get(id)?.motionNotes || '', 260) || undefined,
      issues: r.issues.map((it) => ({ kind: it.kind, problem: it.detail, suggestion: it.fix || undefined, how: howFor(it.kind) })),
    })),
    filmFigureStyle: styleText || undefined,
    currentCode: code,
    requiredExportName: exportName,
    requiredSceneIds: batchScenes.map((s) => s.id),
    strictReminder: `仅输出严格 JSON { "files": { "${filePath}": "<完整代码>" } }；TypeScript strict 零错误；禁止 Math.random()、@keyframes 与 transition 冒号写法。`,
  }
  const content = [{ type: 'text', text: JSON.stringify(task, null, 2) }]
  for (const [id] of flagged) {
    const shots = frames.filter((f) => f.sceneId === id && f.base64)
    if (!shots.length) continue
    content.push({ type: 'text', text: `【${id}】当前画面（${shots.map((f) => `${Math.round(f.fraction * 100)}%`).join('、')}）：` })
    for (const f of shots) content.push({ type: 'image', mimeType: 'image/jpeg', base64: f.base64 })
  }
  return { messages: [{ role: 'user', content }] }
}

/** True when an LLM error means "this model / endpoint cannot take images" (stop reviewing, keep the film). */
export function isVisionUnsupportedError(err) {
  const msg = String(err?.message || err || '').toLowerCase()
  return /vision|image|multimodal|multi-modal|unsupported|not support|invalid_request|content type|\b400\b|\b415\b|\b422\b/.test(msg)
}

/** One-line Chinese summary for the task log. */
export function summarizeVisualReview(report) {
  if (!report) return ''
  if (report.skipped) return `画面自检跳过：${report.skipped}`
  const kinds = {}
  for (const r of Object.values(report.scenes || {})) {
    if (r.severity !== 'major') continue
    for (const it of r.issues) kinds[it.kind] = (kinds[it.kind] || 0) + 1
  }
  const kindText = Object.entries(kinds).map(([k, n]) => `${KIND_ZH[k] || k} ${n}`).join('、')
  return `画面自检：看了 ${report.reviewedScenes} 个镜头 ${report.frameCount} 张关键帧，${report.majorScenes} 个镜头有明显问题${kindText ? `（${kindText}）` : ''}${report.majorScenes ? `，已返工 ${report.fixedScenes} 个` : ''}${report.failedBatches ? `，${report.failedBatches} 批返工未通过编译已保留原画面` : ''}`
}
