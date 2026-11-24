/**
 * Per-shot tool plan + post-generation audit for AI-coded Remotion scenes.
 *
 * Why: the Vibecoding toolkit was only *mentioned* to the coder ("optional"), so the model hand-drew every shot from
 * scratch — no physics, no 3D, no staggered typography. Now every shot gets an explicit plan (must / suggest) from
 * the director's hints plus content rules, the coder is told which tools each shot must use, and the generated code
 * is audited shot by shot; shots that ignored a must-use tool get one targeted upgrade request. Nothing is
 * genre-specific: the rules read what the shot shows.
 *
 * People / horses / crowds only get the figure library as a *suggestion* — and not at all when the film asks for a
 * character style the library does not draw (figureStyle 'custom'): the look of people follows each film.
 */
import { castIdsForScene, sceneShowsCrowd, sceneShowsHorse, sceneShowsPeople } from './figure-kit.js'

export const PLAN_TOOL_IDS = ['figure-kit', 'threejs', 'animejs', 'tweenjs', 'ammojs', 'tsl-textures']
/** tools that are only ever suggested, never enforced by the audit */
const SUGGEST_ONLY = new Set(['figure-kit'])

const TOOL_RULES = {
  threejs: {
    must: /三维|3D|立体旋转|宇宙|太空|星系|行星|星球|分子|DNA|晶体|全息|穿梭|飞越|环绕镜头|俯冲|透视纵深|点云|粒子漩涡/i,
    suggest: /俯瞰|鸟瞰|航拍|纵深|大全景|千军万马|星空|天际线|地形|山河|立体/i,
  },
  animejs: {
    must: /书法|题字|印章|竹简|榜单|排行|清单|步骤|流程图|时间线|里程碑|信息图|图表|柱状|折线|饼图|年份|数字滚动|计数器|依次|逐个|交错|错落|逐字|弹出/i,
    suggest: /字幕|大字|标题|文字|标语|标签|卡片|界面|按钮|菜单|列表/i,
  },
  tweenjs: {
    must: /弹性|回弹|弹跳|抛物线|急停/i,
    suggest: /推镜|推近|缓推|拉远|拉开|摇镜|摇向|跟拍|甩镜|升起|降下|环绕|缓移|滑入|飞入|缩放|卡点|重拍|镜头随/i,
  },
  ammojs: {
    must: /坠落|掉落|落下|砸落|砸碎|倒塌|坍塌|崩塌|碎裂|破碎|散落|飞散|溅起|翻滚|多米诺|落石|碎石|箭雨|硬币|骰子|倾倒|木屑|碎片|投掷|抛出/i,
    suggest: /撞|碰撞|弹开|堆叠|物理/i,
  },
  'tsl-textures': {
    must: null,
    suggest: /江面|水面|河水|海面|波光|水纹|云海|云层|晚霞|烟雾|熔岩|岩浆|大理石|玉石|青铜|金属质感|丝绸|瓷器|木纹|星球表面|材质|纹理/i,
  },
}

/** Regexes that prove a tool is really used in a shot's code. */
export const TOOL_USAGE_PATTERNS = {
  'figure-kit': /<\s*(?:Figure|Horse|Troop)\b/,
  threejs: /<\s*(?:FreeformThreeStage|ThreeCyberStage|ThreeCanvas)\b|\bnew\s+THREE\./,
  animejs: /<\s*AnimeStage\b|\banime(?:StaggerAt|Ease|Stagger|Spring|Eases|Utils)\b/,
  tweenjs: /\btween(?:At|Sequence)\s*[(<]|\buseTween\s*[(<]|\bTweenEasing\./,
  ammojs: /<\s*PhysicsSvgStage\b|\busePhysicsTrack\s*[(<]|\bphysicsPoseAt\s*\(/,
  'tsl-textures': /<\s*TslTextureStage\b/,
}

export const TOOL_LABELS = {
  'figure-kit': '人物库',
  threejs: 'Three.js',
  animejs: 'Anime.js',
  tweenjs: 'Tween.js',
  ammojs: 'Ammo.js 物理',
  'tsl-textures': 'TSL 材质',
}

export const TOOL_HOWTO = {
  'figure-kit': "把这一镜里简陋的人物/马匹换成 <Figure look={castLook(scene, 'id')} … action=…/>（军队人群用 <Troop>，马用 <Horse rider=…>），动作按 visualBlueprint 选 action / script / upper，保留原来的构图位置与大小",
  threejs: '用 <FreeformThreeStage buildScene={(api) => …} /> 做出本镜需要的三维空间或纵深（可以作为背景层，人物和文字叠在上面）',
  animejs: '用 <AnimeStage build={(tl, root) => …}> 或 animeStaggerAt / animeEase 做文字、印章、列表或图形的交错入场',
  tweenjs: '用 tweenAt / tweenSequence（TweenEasing 曲线）驱动镜头的推拉摇移或物体的弹性运动',
  ammojs: '用 <PhysicsSvgStage spec={{ bodies: […] }} totalFrames={…} renderBody={…} /> 做真实的坠落、碰撞与散落',
  'tsl-textures': '用 <TslTextureStage texture="…" /> 做水面 / 云层 / 材质的程序化纹理（每镜最多 1 个）',
}

function sceneText(sc = {}) {
  return `${sc.title || ''} ${sc.headline || ''} ${sc.visualBlueprint || ''} ${sc.motionNotes || ''} ${(Array.isArray(sc.highlights) ? sc.highlights : []).join(' ')}`
}

/**
 * Plan the tools for every shot. Director hints (scene.vibeTools) are must-use; content rules add must / suggest.
 * status: getVibeToolkitStatus() result (unavailable tools are never planned). Returns { perScene, totals }.
 */
export function planSceneTools({ scenes = [], cast = [], genre = '', status = [], lowSpec = false, visual3dMode = 'auto', hasScreenshotsFor = () => false, figureStyle = 'auto' } = {}) {
  // a film with its own character style ('custom') is never steered towards the library's look
  const offerKit = String(figureStyle || 'auto') !== 'custom'
  const avail = new Set((Array.isArray(status) ? status : []).filter((t) => t && t.available).map((t) => t.id))
  avail.add('figure-kit')
  const allowed = (id) => avail.has(id) && !(lowSpec && id === 'tsl-textures') && !(String(visual3dMode).toLowerCase() === 'off' && (id === 'threejs' || id === 'tsl-textures'))
  const perScene = {}
  const totals = {}
  for (const sc of Array.isArray(scenes) ? scenes : []) {
    if (!sc?.id) continue
    const text = sceneText(sc)
    const must = new Set()
    const suggest = new Set()
    const reasons = {}
    const hinted = Array.isArray(sc.vibeTools) ? sc.vibeTools.map((t) => String(t).trim().toLowerCase()).map((t) => (t === 'character-rig' ? 'figure-kit' : t)) : []
    for (const t of hinted) {
      if (!PLAN_TOOL_IDS.includes(t) || !allowed(t)) continue
      if (SUGGEST_ONLY.has(t)) suggest.add(t)
      else must.add(t)
      reasons[t] = '导演为本镜指定'
    }
    const castIds = castIdsForScene(sc, cast)
    const screenshotShot = Boolean(hasScreenshotsFor(sc))
    if (offerKit && !screenshotShot && sceneShowsPeople(sc, castIds, genre)) {
      suggest.add('figure-kit')
      reasons['figure-kit'] = castIds.length ? `画面有角色 ${castIds.join('、')}` : '画面有人物'
    } else if (offerKit && !screenshotShot && (sceneShowsHorse(sc) || sceneShowsCrowd(sc))) {
      suggest.add('figure-kit')
      reasons['figure-kit'] = '画面有马匹或群像'
    }
    for (const [id, rule] of Object.entries(TOOL_RULES)) {
      if (!allowed(id) || must.has(id)) continue
      if (rule.must && rule.must.test(text)) {
        must.add(id)
        reasons[id] = '画面内容需要'
      } else if (rule.suggest && rule.suggest.test(text)) {
        suggest.add(id)
      }
    }
    // keep each shot buildable: at most two must-use tools (the rest become suggestions)
    const mustList = [...must]
    const finalMust = mustList.slice(0, 2)
    for (const t of mustList.slice(2)) suggest.add(t)
    const suggested = [...suggest].filter((t) => !finalMust.includes(t))
    // the figure library stays first in the suggestions when the shot shows people
    suggested.sort((a, b) => Number(b === 'figure-kit') - Number(a === 'figure-kit'))
    perScene[sc.id] = {
      must: finalMust,
      suggest: suggested.slice(0, 3),
      reasons,
      cast: castIds,
    }
    for (const t of finalMust) totals[t] = (totals[t] || 0) + 1
  }
  return { perScene, totals }
}

// ---------------------------------------------------------------------------------------------- audit

const TOP_LEVEL_DEF_RX = /^(?:export\s+)?(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm

/** scene id → source of its component plus the file-level helpers it references (transitively). */
export function extractSceneSources(code = '', sceneIds = []) {
  const src = String(code || '')
  const defs = []
  for (const m of src.matchAll(TOP_LEVEL_DEF_RX)) defs.push({ name: m[1], start: m.index })
  defs.sort((a, b) => a.start - b.start)
  const bodyOf = new Map()
  for (let i = 0; i < defs.length; i++) bodyOf.set(defs[i].name, src.slice(defs[i].start, i + 1 < defs.length ? defs[i + 1].start : src.length))
  // export dictionary: 'scene-01': Scene_scene_01
  const map = {}
  const dictMatch = src.match(/export\s+const\s+BATCH_\w+\s*(?::[^=]+)?=\s*\{([\s\S]*?)\}\s*;?/)
  if (dictMatch) {
    for (const m of dictMatch[1].matchAll(/['"]([^'"]+)['"]\s*:\s*([A-Za-z_$][\w$]*)/g)) map[m[1]] = m[2]
  }
  const sceneComponentNames = new Set(Object.values(map))
  const helperNames = defs.map((d) => d.name).filter((n) => !sceneComponentNames.has(n) && !/^BATCH_/.test(n))
  const out = {}
  for (const id of sceneIds) {
    const comp = map[id]
    if (!comp || !bodyOf.has(comp)) {
      out[id] = null
      continue
    }
    let combined = bodyOf.get(comp)
    const seen = new Set([comp])
    for (let depth = 0; depth < 3; depth++) {
      let added = false
      for (const h of helperNames) {
        if (seen.has(h)) continue
        if (new RegExp(`\\b${h.replace(/\$/g, '\\$')}\\b`).test(combined)) {
          seen.add(h)
          combined += `\n${bodyOf.get(h) || ''}`
          added = true
        }
      }
      if (!added) break
    }
    out[id] = combined
  }
  return out
}

// A tool only counts when its API is imported from the shipped lib (a hand-drawn local `const Horse = …` is not the rig)
const TOOL_IMPORTS = {
  'figure-kit': { module: /['"]\.\.?\/(?:\.\.\/)?lib\/figure-kit['"]/, names: ['Figure', 'Horse', 'Troop'] },
  threejs: { module: /['"](?:\.\.?\/(?:\.\.\/)?lib\/shotcraft|three|@remotion\/three)['"]/, names: ['FreeformThreeStage', 'ThreeCyberStage', 'ThreeCanvas', 'THREE'] },
  animejs: { module: /['"]\.\.?\/(?:\.\.\/)?lib\/vibe-anime['"]/, names: ['AnimeStage', 'animeStaggerAt', 'animeEase', 'animeStagger', 'animeSpring', 'animeEases', 'animeUtils'] },
  tweenjs: { module: /['"]\.\.?\/(?:\.\.\/)?lib\/vibe-tween['"]/, names: ['tweenAt', 'tweenSequence', 'useTween', 'TweenEasing'] },
  ammojs: { module: /['"]\.\.?\/(?:\.\.\/)?lib\/vibe-physics['"]/, names: ['PhysicsSvgStage', 'usePhysicsTrack', 'physicsPoseAt'] },
  'tsl-textures': { module: /['"]\.\.?\/(?:\.\.\/)?lib\/vibe-tsl['"]/, names: ['TslTextureStage'] },
}

/** Local identifiers the file imported for each tool (handles `import { A as B }`). */
export function importedToolNames(code = '') {
  const src = String(code || '')
  const out = {}
  for (const [tool, spec] of Object.entries(TOOL_IMPORTS)) {
    const locals = []
    for (const m of src.matchAll(/import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*(['"][^'"]+['"])/g)) {
      if (!spec.module.test(m[2])) continue
      for (const part of m[1].split(',')) {
        const [orig, alias] = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)
        if (orig && spec.names.includes(orig.trim())) locals.push((alias || orig).trim())
      }
    }
    if (tool === 'threejs') {
      for (const m of src.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]three['"]/g)) locals.push(m[1])
    }
    out[tool] = [...new Set(locals)]
  }
  return out
}

function toolUsedIn(body, tool, locals) {
  if (!locals.length) return false
  return locals.some((name) => {
    const n = name.replace(/\$/g, '\\$')
    if (name === 'THREE' || (tool === 'threejs' && /^[a-z]/.test(name))) return new RegExp(`\\bnew\\s+${n}\\.|\\b${n}\\.[A-Z]\\w+\\s*\\(`).test(body)
    return new RegExp(`<\\s*${n}\\b|\\b${n}\\s*[(<.]`).test(body)
  })
}

/** Which planned must-use tools each shot of one batch file really calls. */
export function auditToolUsage(code = '', sceneIds = [], plan = { perScene: {} }) {
  const sources = extractSceneSources(code, sceneIds)
  const imported = importedToolNames(code)
  const perScene = {}
  const violations = []
  for (const id of sceneIds) {
    const s = sources[id]
    const planned = plan?.perScene?.[id] || { must: [], suggest: [] }
    // unparseable file layout: judge the whole file (never invent a violation we cannot localise)
    const body = s ?? String(code || '')
    const used = PLAN_TOOL_IDS.filter((t) => toolUsedIn(body, t, imported[t] || []))
    const missing = (planned.must || []).filter((t) => !used.includes(t))
    perScene[id] = { used, missing, located: s !== null }
    if (missing.length && s !== null) violations.push({ sceneId: id, missing })
  }
  return { perScene, violations }
}

/** Totals across batches: how many shots planned / used each tool. */
export function summarizeToolAudit(audits = [], plan = { perScene: {} }) {
  const planned = {}
  const used = {}
  let shots = 0
  let violating = 0
  for (const a of audits) {
    for (const [id, r] of Object.entries(a?.perScene || {})) {
      shots++
      if (r.missing?.length) violating++
      for (const t of r.used || []) used[t] = (used[t] || 0) + 1
      for (const t of plan?.perScene?.[id]?.must || []) planned[t] = (planned[t] || 0) + 1
    }
  }
  return { shots, violating, planned, used }
}

export function formatToolSummary(summary) {
  const parts = PLAN_TOOL_IDS.filter((t) => summary.planned[t] || summary.used[t]).map((t) => `${TOOL_LABELS[t]} ${summary.used[t] || 0}/${summary.planned[t] || 0}`)
  return parts.length ? parts.join('、') : '无'
}

/** One targeted upgrade request for a batch whose shots ignored must-use tools. */
export function buildToolUpgradePrompt({ filePath, exportName, code, violations = [], batchScenes = [] }) {
  const byId = new Map((batchScenes || []).map((s) => [s.id, s]))
  return JSON.stringify(
    {
      task: `请升级 ${filePath}：下列镜头没有按"工具调用计划"实现。只修改这些镜头，把缺失的工具真正用上；其它镜头、整体构图位置、文字内容、镜头节奏与 scene.actionEvents 接触帧对齐全部保持不变。`,
      violations: violations.map((v) => ({
        sceneId: v.sceneId,
        visualBlueprint: byId.get(v.sceneId)?.visualBlueprint || undefined,
        missing: v.missing,
        how: v.missing.map((t) => TOOL_HOWTO[t]).filter(Boolean),
      })),
      currentCode: code,
      requiredExportName: exportName,
      requiredSceneIds: (batchScenes || []).map((s) => s.id),
      strictReminder: `仅输出严格 JSON { "files": { "${filePath}": "<完整代码>" } }；TypeScript strict 零错误；禁止 Math.random()、@keyframes 与 transition 冒号写法；人物从 '../lib/figure-kit' 导入 Figure / Horse / Troop / castLook。`,
    },
    null,
    2,
  )
}
