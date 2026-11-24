#!/usr/bin/env node
/**
 * Genre-agnostic picture & sound upgrades from the 6th 「项羽生平」 review (backend, no network, no LLM, no render):
 *   - genre leaks: history is decided by multi-character cues (a single 王 / 将 / 战 no longer turns a burger ad or a
 *     game MV into a history film), the audio profile and the epic composition follow the content, the MV palette has
 *     no war drums or steel, a product prompt carries no combat instructions
 *   - figure kit: cast bible normalisation (enum synonyms, ASCII ids, nested colours), who is on screen, people
 *     detection that ignores software "roles" and tutorial "you", the film's character style (no lock-in: the user's
 *     own words win, a look the kit cannot draw → custom / own design, history → silhouette, everything else → the
 *     coder decides; built-in genre labels never pick a style), per-shot tool plan (director tools → must, people →
 *     suggested figure kit, never for a custom style, screenshot shots exempt), the import-aware audit, strict
 *     typecheck of the shipped TSX library (default style flat)
 *   - the studio's 人物画风 pick: it beats words in the brief / the director / the genre ('auto' changes nothing), the user's
 *     own words name a custom style, run requests (studio body or MCP args) store it and a request without one keeps the
 *     saved pick, the directors are told, the coder prompt follows it; the option list is the same in the Node library,
 *     the host page, the panel kit and the MCP schemas
 *   - cast ↔ character bank: a known character keeps the bank's look, a new named one is saved, placeholders are not
 *   - visual self-review: keyframe planning, review request / parsing (looked-at check), rewrite request only for major
 *     problems with their screenshots, text-only model detection, task-log summary
 *   - atmosphere / ambience inference: whole-word cues (沙发 / 雪碧 / 风格 / 上海 change nothing), explainer genres opt in
 *   - ambience beds: segments merge across shots, `none` is silence, deterministic loudness-matched beds per kind,
 *     equal-power crossfades without a dip, the mixer adds the bed under music and voice (and never alone)
 *   - exposure guard: an unreadably dark shot is lifted with black / white and the file's full range kept, a mid-grey
 *     or lit-by-design shot is untouched, dark UI themes are left alone, the QA entry reports it
 *   - picture activity: frozen-looking seconds (cut frames excluded) are reported as a QA hint; the coder is told to
 *     keep every shot moving after its entrance
 *
 *   node scripts/tests/genre-visuals.test.mjs
 *
 * Scratch data only (<repo>/.tmp/genre-visuals-test/<stamp>); network is blocked; the real `.env` / DSH client are never read.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCR = join(ROOT, '.tmp', 'genre-visuals-test', new Date().toISOString().replace(/[:.]/g, '-'))
const dirs = { home: join(SCR, 'home'), ws: join(SCR, 'ws'), dshClient: join(SCR, 'no-dsh-client') }
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true })
const emptyEnv = join(SCR, 'empty.env')
writeFileSync(emptyEnv, '# intentionally empty\n')
for (const v of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_API_KEY', 'LLM_MODE', 'LLM_BASE_URL', 'LLM_MODEL']) delete process.env[v]
Object.assign(process.env, {
  DSH_VIDEO_ENV_PATH: emptyEnv,
  DSH_VIDEO_HOME: dirs.home,
  DSH_VIDEO_WORKSPACE: dirs.ws,
  DSH_CLIENT_HOME: dirs.dshClient,
  DSH_HOME: dirs.dshClient,
  DSH_VIDEO_SKIP_PROFILE_MOUNT: '1',
})
globalThis.fetch = async (input) => {
  throw new Error(`network blocked in tests: ${typeof input === 'string' ? input : input?.url || input}`)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`)
}
const imp = (rel) => import(pathToFileURL(join(ROOT, ...rel.split('/'))).href)
const section = async (name, fn) => {
  try {
    await fn()
  } catch (err) {
    check(`${name} (threw)`, false, String(err?.stack || err).slice(0, 600))
  }
}

/* ------------------------------------------------------------------------------------------- genre leaks */
await section('genre leaks', async () => {
  const gr = await imp('packages/dsh-tool-media/genre-router.js')
  check('modern briefs are not history (no single-character cue decides it)', ['汉堡店新品上市', '王者荣耀新赛季上线', '将军令 BGM 混剪', '公司宫廷风年会'].every((t) => !gr.isHistoricalContent(t)))
  check('history briefs are history (a strong cue, or two weak ones)', gr.isHistoricalContent('项羽乌江自刎') && gr.isHistoricalContent('将军率铁骑攻城'))
  check('genre detection: burger ad / history film / game MV', gr.detectGenre('汉堡店新品宣传片') === 'product-promo' && gr.detectGenre('项羽生平历史动画') === 'history-theater' && gr.detectGenre('王者荣耀赛季MV') === 'mv-lyric')
  check('a modern MV is not an epic combat context, a history MV or film is', !gr.isEpicCombatContext({ genre: 'mv-lyric', text: '夏日海边的恋爱 MV' }) && gr.isEpicCombatContext({ genre: 'mv-lyric', text: '项羽霸王别姬卡点 MV' }) && gr.isEpicCombatContext({ genre: 'history-theater', text: '' }))

  const ba = await imp('packages/dsh-tool-media/beat-analyzer.js')
  const key = (o) => ba.resolveAdaptiveAudioProfile(o).genreKey
  check('audio profile follows the content', key({ genre: '', title: '汉堡店新品' }) === 'product-promo' && key({ genre: 'mv-lyric', title: '夏日恋爱' }) === 'mv-lyric' && key({ genre: 'mv-lyric', title: '项羽卡点MV' }) === 'history-theater' && key({ genre: '', title: '电影感短片', style: 'cinematic' }) === 'cinematic-story')
  check('the MV palette has no war drums, steel or blades', !/war_drum|metal_clash|blade/.test(JSON.stringify(ba.GENRE_AUDIO_PROFILES['mv-lyric'].sfxPalette)))

  // composition: the epic flag is decided from the content
  const { writeRemotionProjectFiles } = await imp('packages/dsh-tool-media/remotion-generator.js')
  const mk = (name, sc) => {
    const proj = join(dirs.ws, name)
    mkdirSync(proj, { recursive: true })
    writeFileSync(join(proj, 'script.json'), JSON.stringify(sc, null, 2))
    writeRemotionProjectFiles(proj, sc, {})
    return readFileSync(join(proj, 'src', 'VideoComposition.tsx'), 'utf8')
  }
  const base = { engine: 'remotion', fps: 30, width: 1920, height: 1080, totalDurationInFrames: 90, scenes: [{ id: 'scene-01', startFrame: 0, durationInFrames: 90, durationSec: 3, transition: 'cut' }] }
  const vcPromo = mk('promo', { ...base, title: '汉堡店新品', genre: 'product-promo', narrationMode: 'tts' })
  const vcMv = mk('mv', { ...base, title: '夏日恋爱 MV', genre: 'mv-lyric', narrationMode: 'subtitle-mv' })
  const vcHist = mk('hist', { ...base, title: '项羽生平', genre: 'history-theater', narrationMode: 'subtitle-mv' })
  check('composition: product ad and modern MV are not epic, the history film is', /const EPIC_CONTEXT: boolean = false/.test(vcPromo) && /const EPIC_CONTEXT: boolean = false/.test(vcMv) && /const EPIC_CONTEXT: boolean = true/.test(vcHist))
  check('composition: the shipped figure kit is written into every project', ['promo', 'mv', 'hist'].every((p) => existsSync(join(dirs.ws, p, 'src', 'lib', 'figure-kit.tsx'))))

  // coder prompt: a product shot carries no combat instructions; a person in it is offered the figure kit
  const { buildBatchedRemotionScenesPrompt } = await imp('packages/dsh-tool-media/shotcraft-lib.js')
  const promptFor = (genre, topic, visualBlueprint) => {
    const p = buildBatchedRemotionScenesPrompt({ batchIndex: 0, totalBatches: 1, batchScenes: [{ id: 'scene-01', title: '镜头', visualBlueprint, durationSec: 3, durationInFrames: 90 }], totalScenes: 1, width: 1920, height: 1080, genre, topic })
    return { text: `${p.system}\n${p.user}`, plan: p.toolPlan }
  }
  const promo = promptFor('product-promo', '汉堡店新品', '店员把刚出炉的汉堡递给顾客，芝士缓缓流下')
  check('product prompt: no strike / war horse / battle instructions', !/strike=\{computeStrikeSwing|战马|兵刃|战鼓|厮杀|军阵|刀光/.test(promo.text))
  check('product prompt: no character style imposed (the coder decides), the figure kit is only an option', promo.plan?.perScene?.['scene-01']?.suggest?.includes('figure-kit') && !promo.plan?.perScene?.['scene-01']?.must?.includes('figure-kit') && promo.text.includes('人物画风：本片未指定') && !promo.text.includes('人物画风（全片统一）'))
  const hist = promptFor('history-theater', '项羽生平', '项羽横戟立马，与秦将交锋')
  check('history prompt: weapon contact uses the strike timing, silhouette by default', hist.text.includes('strike={computeStrikeSwing(scene, frame)}') && hist.text.includes('人物画风（全片统一）：剪影') && hist.text.includes('style="silhouette"'))
  check('no prompt mentions the retired skeleton rig or calls the library a silhouette library', ![promo.text, hist.text].some((t) => /character-rig|<Character|castOf\(|骨骼角色库|剪影人物库/.test(t)))
  // no lock-in across genres: each brief gets its own character style, the user's own words always win
  const styleOf = (topic, shot) => {
    const genre = gr.detectGenre(topic)
    const pp = buildBatchedRemotionScenesPrompt({ batchIndex: 0, totalBatches: 1, batchScenes: [{ id: 'scene-01', title: '镜头', visualBlueprint: shot, durationSec: 3, durationInFrames: 90 }], totalScenes: 1, width: 1920, height: 1080, genre, topic })
    const u = JSON.parse(pp.user)
    return { style: u.figureStyle, note: u.figureStyleNote || '', kit: Boolean(pp.toolPlan?.perScene?.['scene-01']?.suggest?.includes('figure-kit')), text: pp.system }
  }
  const fairy = styleOf('小兔子找妈妈的童话故事动画', '小兔子在森林里奔跑，遇到松鼠')
  const comedy = styleOf('办公室搞笑段子小剧场', '上班族对着电脑抓狂，同事在旁边偷笑')
  check('fairy tales and comedy sketches are not turned into stick figures (the built-in genre label is no style request)', fairy.style === 'auto' && comedy.style === 'auto' && !/人物画风（全片统一）：火柴人/.test(fairy.text + comedy.text))
  const anime = styleOf('日系动漫风格的校园恋爱MV', '女孩在樱花树下回头微笑')
  const mascot = styleOf('Q版萌系的品牌吉祥物短片', '吉祥物向镜头挥手')
  check('a look the kit cannot draw (动漫 / Q版) → the coder designs its own characters, the kit is not offered', anime.style === 'custom' && anime.note === '日系动漫' && mascot.style === 'custom' && mascot.note === 'Q版萌系' && !anime.kit && anime.text.includes('不要用人物库的侧身人形代替') && !anime.text.includes('人物库用法'))
  const paper = styleOf('春节剪纸动画', '一家人围坐吃年夜饭')
  const stick = styleOf('火柴人搞笑打工日常', '火柴人被闹钟吵醒')
  check('a kit look the user names is used (剪纸 / 火柴人), anything else stays open', paper.style === 'papercut' && stick.style === 'stick' && styleOf('夏日海边恋爱 MV', '情侣在沙滩上奔跑').style === 'auto' && styleOf('量子计算科普讲解', '讲解员指着示意图讲解').style === 'auto')
  const duel = promptFor('stickman-story', '火柴人对决', '两个火柴人拔剑对决')
  check('a sword fight in any genre gets the strike timing too', duel.text.includes('strike={computeStrikeSwing(scene, frame)}'))
})

/* ------------------------------------------------------------------------------------------- figure kit & tool plan */
await section('figure kit & tool plan', async () => {
  const fk = await imp('packages/dsh-tool-media/figure-kit.js')
  const plan = await imp('packages/dsh-tool-media/scene-tool-plan.js')
  const { getVibeToolkitStatus } = await imp('packages/dsh-tool-media/vibe-toolkit-lib.js')
  const cast = fk.normalizeCast([
    { id: '项羽', name: '项羽', aliases: ['你'], figure: { build: '魁梧', outfit: '铠甲', headwear: '红缨头盔', props: { right: '长戟' }, colors: { top: 'red', cape: '#8B1E1E' }, cape: true } },
    { name: '虞姬', rig: { gender: '女', outfit: '汉服', hairStyle: '发髻', capeColor: '#9f1239' } },
    { id: 'clerk', name: '店员', figure: { outfit: '咖啡师围裙', gender: 'female', props: { right: '咖啡' } } },
  ])
  check('cast: non-ASCII ids become cast1/cast2, ASCII ids are kept, names stay', cast.map((c) => c.id).join() === 'cast1,cast2,clerk' && cast[0].name === '项羽')
  check('cast: Chinese appearance words map to figure enums, colours must be #hex', cast[0].figure.build === 'heroic' && cast[0].figure.outfit === 'armor' && cast[0].figure.headwear === 'plume-helmet' && cast[0].figure.props?.right === 'halberd' && cast[0].figure.cape === true && !('top' in (cast[0].figure.colors || {})) && cast[0].figure.colors?.cape === '#8B1E1E')
  check('cast: the older rig fields (hairStyle, capeColor) still map', cast[1].figure.gender === 'female' && cast[1].figure.outfit === 'hanfu' && cast[1].figure.hair === 'bun' && cast[1].figure.colors?.cape === '#9F1239' && cast[2].figure.outfit === 'apron' && cast[2].figure.props?.right === 'coffee')
  check('who is on screen: by name / alias in the shot text, or the director list', fk.castIdsForScene({ visualBlueprint: '虞姬起舞，你举杯' }, cast).join() === 'cast1,cast2' && fk.castIdsForScene({ cast: ['clerk'] }, cast).join() === 'clerk')
  check('people: a software role or a tutorial "you" is no person; a girl running is', !fk.sceneShowsPeople({ visualBlueprint: '角色权限管理界面' }, [], 'ui-tutorial') && !fk.sceneShowsPeople({ visualBlueprint: '你点击右上角的按钮' }, [], 'ui-tutorial') && fk.sceneShowsPeople({ visualBlueprint: '你点击右上角的按钮' }, [], 'history-theater') && fk.sceneShowsPeople({ visualBlueprint: '一位女孩在跑步' }, [], 'product-promo'))
  check('people: animals (cat / dog) are not people', !fk.sceneShowsPeople({ visualBlueprint: '沙发上的猫咪伸懒腰' }, [], 'product-promo'))
  const fs = (o) => fk.inferFigureStyle(o)
  check('figure style: named kit looks win, history defaults to silhouette, everything else stays open (auto)', fs({ genre: 'history-theater', userText: '项羽生平 皮影戏风格' }) === 'puppet' && fs({ genre: 'history-theater', userText: '项羽生平' }) === 'silhouette' && fs({ genre: 'product-promo', userText: '咖啡店新品' }) === 'auto' && fs({ genre: 'stickman-story', userText: '童话故事', text: '火柴人 / 角色故事动画' }) === 'auto' && fs({ genre: 'stickman-story', userText: '火柴人打工日常' }) === 'stick' && fs({ genre: 'mv-lyric', userText: '霸王别姬 卡点' }) === 'silhouette' && fs({ genre: 'mv-lyric', userText: '夏日海边恋爱' }) === 'auto' && fs({ genre: 'other', userText: '春节剪纸动画' }) === 'papercut')
  check('figure style: other looks → custom with a note; the user\'s words beat the director, the director beats the genre', fs({ genre: 'history-theater', userText: 'Q版三国小剧场' }) === 'custom' && fk.inferFigureStyleNote('Q版三国小剧场') === 'Q版萌系' && fs({ genre: 'product-promo', userText: '日系动漫风咖啡店', current: 'flat' }) === 'custom' && fs({ genre: 'history-theater', userText: '项羽生平', current: 'ink' }) === 'ink' && fs({ genre: 'history-theater', userText: '项羽生平', current: 'auto' }) === 'auto' && fs({ genre: 'product-promo', userText: '咖啡店', current: '自定义' }) === 'custom' && fs({ genre: 'history-theater', userText: '项羽 手绘地图' }) === 'silhouette')
  const guide = fk.buildFigureKitCoderGuide({ cast, figureStyle: 'papercut' })
  check('coder guide: the film style, the figure kit in that style, the cast with castLook, no blades without combat', guide.includes("from '../lib/figure-kit'") && guide.includes('人物画风（全片统一）：剪纸') && guide.includes('style="papercut"') && guide.includes('`cast2` = 虞姬') && guide.includes('castLook(scene') && !guide.includes('computeStrikeSwing') && fk.buildFigureKitCoderGuide({ combat: true }).includes('computeStrikeSwing'))
  const customGuide = fk.buildFigureKitCoderGuide({ cast, figureStyle: 'custom', figureStyleNote: '绘本手绘', combat: true })
  check('coder guide for a custom style: own character design, no kit API, the cast as a character sheet', customGuide.includes('人物画风（全片统一）：绘本手绘') && customGuide.includes('不要用人物库的侧身人形代替') && !customGuide.includes('<Figure') && customGuide.includes('`cast2` = 虞姬') && customGuide.includes('computeStrikeSwing'))
  const autoGuide = fk.buildFigureKitCoderGuide({ cast })
  check('coder guide without a style: the coder decides, the kit is offered as one option', autoGuide.includes('本片未指定') && autoGuide.includes('合适就用它') && autoGuide.includes('自己设计绘制'))
  check('appearance line in Chinese (character bank description)', fk.describeFigureZh(cast[0].figure).includes('铠甲') && fk.describeFigureZh(cast[0].figure).includes('长戟'))

  const scenes = [
    { id: 'scene-01', title: '登场', visualBlueprint: '项羽横戟立马于江边', castIds: ['cast1'] },
    { id: 'scene-02', title: '地图', visualBlueprint: '疆域地图上箭头推进', vibeTools: ['animejs'] },
    { id: 'scene-03', title: '界面', visualBlueprint: '店员在收银台把汉堡递给顾客', screenshot: true },
    { id: 'scene-04', title: '旧计划', visualBlueprint: '军阵前进', vibeTools: ['character-rig'] },
  ]
  const p = plan.planSceneTools({ scenes, cast, genre: 'history-theater', status: getVibeToolkitStatus(), hasScreenshotsFor: (sc) => Boolean(sc.screenshot) })
  check('tool plan: a shot with people is offered the figure kit, never forced', p.perScene['scene-01'].suggest[0] === 'figure-kit' && !p.perScene['scene-01'].must.includes('figure-kit'))
  check('tool plan: the director tool of a shot becomes a must', p.perScene['scene-02'].must.join() === 'animejs')
  check('tool plan: a screenshot shot is not offered the figure kit; an old character-rig hint becomes a suggestion', !p.perScene['scene-03'].suggest.includes('figure-kit') && p.perScene['scene-04'].suggest.includes('figure-kit') && p.perScene['scene-04'].must.length === 0)
  const pc = plan.planSceneTools({ scenes, cast, genre: 'history-theater', status: getVibeToolkitStatus(), hasScreenshotsFor: (sc) => Boolean(sc.screenshot), figureStyle: 'custom' })
  check('tool plan: a film with its own character style is never steered to the kit (unless the director named it)', !pc.perScene['scene-01'].suggest.includes('figure-kit') && pc.perScene['scene-04'].suggest.includes('figure-kit'))
  const codeLocal = "import React from 'react'\nconst Horse = () => <g/>\nconst Scene1 = ({scene}) => <svg><Horse/></svg>\nexport const BATCH_01_SCENES = { 'scene-01': Scene1 }"
  const codeKit = "import React from 'react'\nimport { Figure, castLook } from '../lib/figure-kit'\nconst Scene1 = ({scene}) => <svg><Figure look={castLook(scene,'cast1')} x={1} y={2} height={300} action=\"walk\"/></svg>\nexport const BATCH_01_SCENES = { 'scene-01': Scene1 }"
  const forced = { perScene: { 'scene-01': { must: ['figure-kit'], suggest: [] } } }
  const aLocal = plan.auditToolUsage(codeLocal, ['scene-01'], forced)
  const aKit = plan.auditToolUsage(codeKit, ['scene-01'], forced)
  check('audit: a hand-drawn local Horse is not the shipped kit; the imported Figure is', aLocal.perScene['scene-01'].used.length === 0 && aKit.perScene['scene-01'].used.includes('figure-kit'))
  check('audit: the people suggestion never creates a violation', plan.auditToolUsage(codeLocal, ['scene-01'], p).violations.length === 0)
  const up = plan.buildToolUpgradePrompt({ filePath: 'src/scenes/Batch01.tsx', exportName: 'BATCH_01_SCENES', code: codeLocal, violations: [{ sceneId: 'scene-01', missing: ['figure-kit'] }], batchScenes: scenes.slice(0, 1) })
  check('upgrade prompt names the shot and how to use the figure kit', String(up).includes('scene-01') && String(up).includes('<Figure'))

  // the shipped TSX library compiles under the plugin's strict preflight and exports what the coder guide promises
  const kitSrc = readFileSync(join(ROOT, 'packages', 'dsh-tool-media', 'remotion-lib', 'figure-kit.tsx'), 'utf8')
  check('figure-kit.tsx exports Figure / Horse / Troop / castLook / figureStride / mixColor', ['export const Figure', 'export const Horse', 'export const Troop', 'export function castLook', 'export function figureStride', 'export function mixColor'].every((k) => kitSrc.includes(k)) && !/Math\.random\(|@keyframes|transition\s*:/.test(kitSrc))
  check('figure-kit.tsx: a figure or horse without a style prop is drawn in the neutral colour style, never silhouette', (kitSrc.match(/\(props\.style as FigureStyle\) : 'flat'/g) || []).length === 2 && !/\(props\.style as FigureStyle\) : 'silhouette'/.test(kitSrc))
  const shared = await imp('packages/shared/index.js')
  const suite = await imp('packages/dsh-tool-video-suite/index.js')
  const tproj = join(SCR, 'kit-tsc')
  mkdirSync(join(tproj, 'src', 'lib'), { recursive: true })
  fk.writeFigureKitRemotionLib(tproj)
  writeFileSync(join(tproj, 'src', 'Use.tsx'), [
    "import React from 'react'",
    "import { Figure, Horse, Troop, castLook, FigureLook } from './lib/figure-kit'",
    "const scene = { cast: [{ id: 'hero', name: '项羽', figure: { outfit: 'armor', headwear: 'plume-helmet', props: { right: 'halberd' } } }] }",
    "const look: FigureLook = castLook(scene, 'hero')",
    'export const Use: React.FC = () => (',
    '  <svg>',
    '    <Figure look={look} x={300} y={900} height={420} action="walk" travel={200} duration={60} style="silhouette" rim="#FFD8A0" />',
    "    <Figure look={{ gender: 'female', outfit: 'apron' }} x={900} y={900} height={420} script={[{ action: 'walk', from: 0, dur: 30, dx: 120 }, { action: 'present', from: 30, dur: 20 }]} style=\"flat\" />",
    '    <Horse x={1300} y={900} height={420} gait="gallop" rider={look} riderAction="raise" dust />',
    '    <Troop x={0} y={600} width={1900} height={120} rows={3} perRow={12} kind="spear" action="march" haze="#C77452" />',
    '  </svg>',
    ')',
  ].join('\n'))
  writeFileSync(join(tproj, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, noEmit: true }, include: ['src/**/*'] }))
  shared.ensureRemotionJunction(tproj)
  const tc = await suite.runTypecheckOnProject(tproj)
  check('figure-kit.tsx + typical scene usage pass a strict typecheck', tc?.ok === true || (tc?.errors || []).length === 0, JSON.stringify((tc?.errors || []).slice(0, 3)))

  // atmosphere / ambience inference
  const t = (v) => ({ visualBlueprint: v })
  check('inference: 沙发 / 雪碧 / 风格 / 上海 change nothing', ['沙发上的猫咪', '雪碧新品海报', '风格化的产品展示', '上海的产品发布会'].every((v) => fk.inferAtmosphere(t(v), 'story') === 'none' && fk.inferAmbience(t(v), 'story') === 'none'))
  check('inference: real places and weather are recognised', fk.inferAmbience(t('乌江边，项羽回望江东'), 'history-theater') === 'river' && fk.inferAmbience(t('上海街头车流'), 'story') === 'city' && fk.inferAtmosphere(t('暴风雪中的山巅'), 'story') === 'snow' && fk.inferAmbience(t('篝火旁的士兵'), 'story') === 'fire')
  check('inference: explainer / product genres get a sound bed only when the director chose one', fk.inferAmbience(t('大雨中的城市街道'), 'product-promo') === 'none' && fk.inferAmbience({ ...t('大雨中的城市街道'), ambience: 'rain' }, 'product-promo') === 'rain')
  const enriched = fk.enrichScenesForVisuals({ genre: 'history-theater', topic: '项羽生平', cast, scenes: [{ id: 's1', visualBlueprint: '虞姬起舞' }] })
  check('enrich: on-screen cast and the film figure style are filled in', enriched.scenes[0].castIds?.join() === 'cast2' && enriched.figureStyle === 'silhouette')
  const enrichedQ = fk.enrichScenesForVisuals({ genre: 'brand-story', topic: 'Q版萌系的品牌吉祥物短片', scenes: [{ id: 's1', visualBlueprint: '吉祥物向镜头挥手' }] })
  const enrichedKit = fk.enrichScenesForVisuals({ genre: 'product-promo', topic: '咖啡店新品', figureStyle: 'flat', figureStyleNote: 'stale', scenes: [{ id: 's1', visualBlueprint: '店员递咖啡' }] })
  const enrichedOpen = fk.enrichScenesForVisuals({ genre: 'product-promo', topic: '咖啡店新品', scenes: [{ id: 's1', visualBlueprint: '店员递咖啡' }] })
  check('enrich: a Q版 brief becomes a custom style with its note, a director kit choice is kept without a stale note, a plain ad stays open', enrichedQ.figureStyle === 'custom' && enrichedQ.figureStyleNote === 'Q版萌系' && enrichedKit.figureStyle === 'flat' && !('figureStyleNote' in enrichedKit) && enrichedOpen.figureStyle === 'auto')
})

/* ------------------------------------------------------------------------------------------- studio 人物画风 pick */
await section('studio character-style pick', async () => {
  const fk = await imp('packages/dsh-tool-media/figure-kit.js')
  const fs = (o) => fk.inferFigureStyle(o)
  check('the pick beats style words in the brief, the director and the genre default', fs({ genre: 'other', userText: '皮影戏风格的西游记', chosen: 'papercut' }) === 'papercut' && fs({ genre: 'history-theater', userText: '项羽生平', current: 'silhouette', chosen: 'custom' }) === 'custom' && fs({ genre: 'product-promo', userText: '咖啡店', current: 'flat', chosen: 'ink' }) === 'ink' && fs({ genre: 'product-promo', userText: '咖啡店', chosen: '水墨' }) === 'ink')
  check('picking AI-decides (or nothing) changes nothing', fs({ genre: 'other', userText: '皮影戏风格的西游记', chosen: 'auto' }) === 'puppet' && fs({ genre: 'history-theater', userText: '项羽生平', chosen: '' }) === 'silhouette' && fs({ genre: 'product-promo', userText: '咖啡店', chosen: 'nonsense' }) === 'auto')
  check('custom style name: the user\'s own words, then the director, then the brief', fk.resolveFigureStyleNote({ style: 'custom', chosen: 'custom', chosenNote: 'Q版萌系，圆脸大眼', note: '日系动漫' }) === 'Q版萌系，圆脸大眼' && fk.resolveFigureStyleNote({ style: 'custom', chosen: 'custom', chosenNote: ' ', note: '日系动漫' }) === '日系动漫' && fk.resolveFigureStyleNote({ style: 'custom', chosen: 'auto', chosenNote: '绘本', note: '', text: '像素风小游戏' }) === '像素风' && fk.resolveFigureStyleNote({ style: 'ink', chosen: 'custom', chosenNote: 'Q版' }) === '')
  check('a run request carries the pick (studio body or MCP args); without one it says nothing', JSON.stringify(fk.figureStyleChoiceFrom({ figureStyleChoice: 'custom', figureStyleChoiceNote: ' "Q版" 萌系 ' })) === JSON.stringify({ style: 'custom', note: 'Q版 萌系' }) && fk.figureStyleChoiceFrom({ figureStyle: 'ink' })?.style === 'ink' && fk.figureStyleChoiceFrom({ topic: '咖啡店' }) === null && fk.figureStyleChoiceFrom({ figureStyleChoice: 'bogus' }) === null)
  const sc = { figureStyleChoice: 'flat', figureStyleChoiceNote: '旧描述', figureStyle: 'silhouette' }
  fk.applyFigureStyleChoice(sc, { topic: '没有选画风的请求' })
  const kept = sc.figureStyleChoice === 'flat' && sc.figureStyleChoiceNote === '旧描述'
  fk.applyFigureStyleChoice(sc, { figureStyleChoice: 'custom', figureStyleChoiceNote: '绘本手绘' })
  const took = sc.figureStyleChoice === 'custom' && sc.figureStyleChoiceNote === '绘本手绘' && sc.figureStyle === 'silhouette'
  fk.applyFigureStyleChoice(sc, { figureStyleChoice: 'stick', figureStyleChoiceNote: '' })
  check('the script keeps its saved pick unless the run carries a new one (the resolved style is not touched)', kept && took && sc.figureStyleChoice === 'stick' && !('figureStyleChoiceNote' in sc))
  const dirCustom = fk.buildFigureStylePlanDirective({ figureStyleChoice: 'custom', figureStyleChoiceNote: 'Q版萌系' })
  const dirFree = fk.buildFigureStylePlanDirective({ figureStyleChoice: 'papercut' }, { planJson: false })
  check('the directors are told the pick (the plan JSON gets its value); no pick → no line', dirCustom.includes('用户已指定「Q版萌系」') && dirCustom.includes('figureStyle 填 "custom"') && dirCustom.includes('figureStyleNote 填「Q版萌系」') && dirFree.includes('用户已指定「剪纸」') && !dirFree.includes('JSON') && !dirFree.includes('演员表') && fk.buildFigureStylePlanDirective({ figureStyleChoice: 'auto' }) === '' && fk.buildFigureStylePlanDirective({ figureStyle: 'ink' }) === '')
  const en = fk.enrichScenesForVisuals({ genre: 'history-theater', topic: '项羽生平', figureStyle: 'silhouette', figureStyleChoice: 'custom', figureStyleChoiceNote: 'Q版萌系', scenes: [{ id: 's1', visualBlueprint: '项羽横戟立马' }] })
  const enKit = fk.enrichScenesForVisuals({ genre: 'product-promo', topic: 'Q版萌系的吉祥物', figureStyleChoice: 'flat', figureStyleChoiceNote: 'Q版萌系', scenes: [] })
  check('enrich: a history film with a Q版 pick becomes custom Q版; a kit pick beats Q版 words and carries no note', en.figureStyle === 'custom' && en.figureStyleNote === 'Q版萌系' && enKit.figureStyle === 'flat' && !('figureStyleNote' in enKit))
  const { buildBatchedRemotionScenesPrompt } = await imp('packages/dsh-tool-media/shotcraft-lib.js')
  const coder = (extra) => buildBatchedRemotionScenesPrompt({ batchIndex: 0, totalBatches: 1, batchScenes: [{ id: 'scene-01', title: '镜头', visualBlueprint: '项羽横戟立马于乌江边', durationSec: 3, durationInFrames: 90 }], totalScenes: 1, width: 1920, height: 1080, genre: 'history-theater', topic: '项羽生平', ...extra })
  const cq = coder({ figureStyle: 'silhouette', figureStyleChoice: 'custom', figureStyleChoiceNote: 'Q版萌系' })
  const ci = coder({ figureStyleChoice: 'ink' })
  check('coder prompt follows the pick: Q版 → own design without the kit (not even in the history branch); 水墨 → the kit in ink', cq.system.includes('人物画风（全片统一）：Q版萌系') && !cq.system.includes('人物库用法') && !cq.system.includes('<Figure') && cq.system.includes('本片画风由你自己设计角色') && !cq.toolPlan?.perScene?.['scene-01']?.suggest?.includes('figure-kit') && JSON.parse(cq.user).figureStyle === 'custom' && ci.system.includes('人物画风（全片统一）：水墨') && ci.system.includes('style="ink"'))

  // one option list everywhere: the Node library, the host page, the panel kit fallback, the MCP schemas
  const values = fk.FIGURE_STYLE_CHOICES.map((o) => o.value)
  check('the option list covers every film style exactly once', values.length === fk.FILM_FIGURE_STYLES.length && fk.FILM_FIGURE_STYLES.every((v) => values.includes(v)) && values[0] === 'auto')
  const clientSrc = readFileSync(join(ROOT, 'packages', 'dsh-web-video-workbench', 'lib', 'client.js'), 'utf8')
  const kitSrc = readFileSync(join(ROOT, 'packages', 'dsh-web-video-workbench', 'lib', 'warroom', 'kit', 'src', '60-studio-assets.js'), 'utf8')
  const kitBuilt = readFileSync(join(ROOT, 'packages', 'dsh-web-video-workbench', 'lib', 'warroom', 'kit.js'), 'utf8')
  check('host page and panel kit show the same options (label and hint)', fk.FIGURE_STYLE_CHOICES.every((o) => clientSrc.includes(`{ value: '${o.value}', label: '${o.label}', hint: '${o.hint}' }`) && kitSrc.includes(`['${o.value}', '${o.label}', '${o.hint}']`)))
  check('host page: form default, project load, save, run body and panel state carry the pick', (clientSrc.match(/figureStyleChoice:/g) || []).length >= 4 && clientSrc.includes("k === 'figureStyleChoice'") && clientSrc.includes("k === 'figureStyleChoiceNote'") && clientSrc.includes('figureStyles: FIGURE_STYLE_OPTIONS'))
  check('panel kit: the 人物画风 field (custom → a description box) is in the built kit and the run body', kitSrc.includes("label: '人物画风'") && kitSrc.includes("'a60-fignote'") && kitBuilt.includes("'a60-figstyle'") && kitBuilt.includes('figureStyleChoice: d.figureStyleChoice'))
  const serverSrc = readFileSync(join(ROOT, 'packages', 'dsh-web-video-workbench', 'lib', 'index.js'), 'utf8')
  check('the studio server saves the pick and its description', serverSrc.includes('figureStyleChoice: body.figureStyleChoice') && serverSrc.includes('figureStyleChoiceNote: String(body.figureStyleChoiceNote'))
  const media = await imp('packages/dsh-tool-media/index.js')
  const tools = {}
  media.apply({ tools: { register: (t) => (tools[t.name] = t) } })
  const mcpOk = (name) => {
    const props = tools[name]?.parameters?.properties || {}
    return JSON.stringify(props.figureStyle?.enum) === JSON.stringify(values) && props.figureStyleNote?.type === 'string' && /人物画风/.test(props.figureStyle?.description || '')
  }
  check('MCP ai_create_video and run_agent_pipeline take figureStyle / figureStyleNote', mcpOk('ai_create_video') && mcpOk('run_agent_pipeline'))
})

/* ------------------------------------------------------------------------------------------- cast ↔ character bank */
await section('cast and character bank', async () => {
  const fk = await imp('packages/dsh-tool-media/figure-kit.js')
  const bank = await imp('packages/dsh-tool-media/character-bank.js')
  const { syncCastWithCharacterBank } = await imp('packages/dsh-tool-media/cast-bank-sync.js')
  const proj = join(dirs.ws, 'bank-sync')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(proj, 'script.json'), JSON.stringify({ scenes: [] }))
  await bank.saveCharacter({ projectDir: proj, scope: 'project', character: { name: '小林', aliases: ['林店长'], description: '短发咖啡店长', figure: { outfit: 'apron', hair: 'short', colors: { top: '#F3EEE6', trim: '#2F5D50' } } } })
  const script = {
    cast: fk.normalizeCast([
      { id: 'lin', name: '小林', figure: { outfit: 'suit', gender: 'male' } },
      { id: 'guest', name: '王阿姨', look: '戴眼镜的老顾客', figure: { gender: 'female', build: 'elder', outfit: 'coat' } },
      { id: 'hero', name: '主角', figure: { outfit: 'casual' } },
    ]),
    scenes: [{ id: 's1', castIds: ['lin', 'guest'] }, { id: 's2', castIds: ['hero'] }],
  }
  const res = await syncCastWithCharacterBank({ projectDir: proj, script })
  const lin = script.cast.find((c) => c.id === 'lin')
  check('a known character keeps the bank look (bank wins), and is linked', res.linked.includes('小林') && lin.figure.outfit === 'apron' && lin.figure.gender === 'male' && Boolean(lin.bankId))
  const listed = bank.listCharacters({ projectDir: proj, scope: 'project' }).project
  const aunt = listed.find((c) => c.name === '王阿姨')
  check('a new named cast member is saved to the project bank with its look', res.created.includes('王阿姨') && aunt?.figure?.outfit === 'coat' && aunt?.description === '戴眼镜的老顾客')
  check('placeholders (主角) are never saved; shots are bound to bank characters', !listed.some((c) => c.name === '主角') && script.scenes[0].characterIds?.length === 2 && !script.scenes[1].characterIds)
  const ctx = bank.buildCharacterPromptContext({ projectDir: proj, prompt: '@小林 在吧台拉花' })
  check('an @mention in a cloud prompt finds the same person', ctx.mentioned[0]?.name === '小林' && ctx.descriptionBlock.includes('短发咖啡店长'))
})

/* ------------------------------------------------------------------------------------------- visual self-review */
await section('visual self-review', async () => {
  const vr = await imp('packages/dsh-tool-media/visual-review.js')
  const kf = await imp('packages/dsh-tool-video-suite/scene-keyframes.js')
  const scenes = [{ id: 'scene-01', durationInFrames: 100 }, { id: 'scene-02', durationInFrames: 60 }, { id: 'scene-03', startFrame: 200, durationInFrames: 40 }]
  const plan = kf.planSceneKeyframes(scenes, 30)
  check('keyframes: 35% and 80% of every shot, absolute frames (running sum or locked start)', JSON.stringify(plan.map((k) => k.frame)) === JSON.stringify([35, 80, 121, 148, 214, 232]), JSON.stringify(plan.map((k) => k.frame)))
  const frames = [{ sceneId: 'scene-01', fraction: 0.35, base64: 'AAA' }, { sceneId: 'scene-01', fraction: 0.8, base64: 'BBB' }, { sceneId: 'scene-02', fraction: 0.35, base64: 'CCC' }]
  const batch = [{ id: 'scene-01', title: '登场', visualBlueprint: '项羽横戟立马' }, { id: 'scene-02', title: '地图', visualBlueprint: '疆域地图' }]
  const req = vr.buildVisualReviewRequest({ batchScenes: batch, frames, genreLabel: '历史', figureStyle: 'silhouette' })
  const parts = req.messages[0].content
  check('review request: storyboard text then that shot\'s screenshots, in order', parts.filter((p) => p.type === 'image').length === 3 && parts[1].type === 'text' && parts[1].text.includes('scene-01') && parts[2].type === 'image' && parts[4].text.includes('scene-02') && req.system.includes('figure'))
  const reply = '```json\n{"scenes":[{"id":"scene-01","seen":"夕阳下骑马的将军剪影","severity":"major","issues":[{"kind":"figure","detail":"人物由几个方块拼成","fix":"换成剪影人物"}]},{"id":"scene-02","seen":"一张地图","severity":"minor","issues":[]},{"id":"scene-99","severity":"major","issues":[{"kind":"text","detail":"x"}]}]}\n```'
  const parsed = vr.parseVisualReview(reply, ['scene-01', 'scene-02'])
  check('review parsing: known shots only, a minor without issues is none, looked-at check', parsed.looked && parsed.scenes['scene-01'].severity === 'major' && parsed.scenes['scene-01'].issues[0].kind === 'figure' && parsed.scenes['scene-02'].severity === 'none' && !parsed.scenes['scene-99'])
  check('review parsing: a reply that never says what it saw did not look', !vr.parseVisualReview('{"scenes":[{"id":"scene-01","severity":"none","issues":[]}]}', ['scene-01']).looked)
  const fix = vr.buildVisualFixRequest({ filePath: 'src/scenes/Batch01.tsx', exportName: 'BATCH_01_SCENES', code: 'CODE', batchScenes: batch, review: parsed.scenes, frames })
  const fparts = fix.messages[0].content
  const ftask = JSON.parse(fparts[0].text)
  check('rewrite request: only major shots, with how-to and their screenshots', ftask.problems.length === 1 && ftask.problems[0].sceneId === 'scene-01' && /figure-kit/.test(ftask.problems[0].issues[0].how) && fparts.filter((p) => p.type === 'image').length === 2 && ftask.currentCode === 'CODE')
  const fixCustom = JSON.parse(vr.buildVisualFixRequest({ filePath: 'src/scenes/Batch01.tsx', exportName: 'BATCH_01_SCENES', code: 'CODE', batchScenes: batch, review: parsed.scenes, frames, figureStyle: 'custom', figureStyleNote: 'Q版萌系' }).messages[0].content[0].text)
  check('rewrite request for a custom-style film keeps its own look (never swapped to the kit)', /Q版萌系/.test(fixCustom.problems[0].issues[0].how) && /不要换成人物库/.test(fixCustom.problems[0].issues[0].how) && !/<Figure/.test(fixCustom.problems[0].issues[0].how) && fixCustom.filmFigureStyle === '自定义（Q版萌系）')
  const reqCustom = vr.buildVisualReviewRequest({ batchScenes: batch, frames, genreLabel: '品牌吉祥物', figureStyle: 'custom', figureStyleNote: 'Q版萌系' })
  check('the reviewer is told the film\'s character style (and judges against it)', reqCustom.messages[0].content[0].text.includes('本片人物画风：自定义（Q版萌系）') && reqCustom.system.includes('Q版') && reqCustom.system.includes('另一种画风'))
  check('text-only models are recognised from the error', vr.isVisionUnsupportedError(new Error('HTTP 400: model does not support image input')) && !vr.isVisionUnsupportedError(new Error('socket hang up')))
  const summary = vr.summarizeVisualReview({ reviewedScenes: 2, frameCount: 3, majorScenes: 1, fixedScenes: 1, failedBatches: 0, scenes: parsed.scenes, skipped: '' })
  check('task-log summary in plain Chinese', summary.includes('看了 2 个镜头') && summary.includes('已返工 1 个') && summary.includes('人物/动物画得简陋或怪异'))
  check('skipped review says why', vr.summarizeVisualReview({ skipped: '当前模型不支持图片输入' }).includes('当前模型不支持图片输入'))
})

/* ------------------------------------------------------------------------------------------- ambience beds */
await section('ambience beds', async () => {
  const amb = await imp('packages/dsh-tool-media/ambience-dsp.js')
  const shots = [
    { id: 's1', startSec: 0, durationSec: 3, ambience: 'wind' },
    { id: 's2', startSec: 3, durationSec: 2, ambience: 'wind' },
    { id: 's3', startSec: 5, durationSec: 3, ambience: 'river' },
    { id: 's4', startSec: 8, durationSec: 2, ambience: 'none' },
    { id: 's5', startSec: 10, durationSec: 2, title: '篝火旁的营帐' },
  ]
  const segs = amb.planAmbienceSegments(shots, 12, { genre: 'history-theater' })
  check('segments: same bed across cuts merges, none is silence, a missing field is inferred from the picture', JSON.stringify(segs) === JSON.stringify([{ kind: 'wind', start: 0, end: 5 }, { kind: 'river', start: 5, end: 8 }, { kind: 'fire', start: 10, end: 12 }]), JSON.stringify(segs))
  check('segments: an explainer stays silent unless the director chose a bed', amb.planAmbienceSegments(shots.slice(4), 12, { genre: 'science-explainer' }).length === 0 && amb.planAmbienceSegments([{ ...shots[4], ambience: 'office' }], 12, { genre: 'science-explainer' }).length === 1)

  const levels = {}
  let worst = 0
  for (const k of amb.AMBIENCE_BED_KINDS) {
    const { L, R } = amb.renderAmbienceLayer(k, 4, 99)
    const lufs = amb.measureLoudnessLufs(L, R)
    levels[k] = Number(lufs.toFixed(1))
    let peak = 0
    for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
    worst = Math.max(worst, peak)
  }
  const inRange = Object.values(levels).every((v) => v <= amb.AMBIENCE_TARGET_LUFS + 0.5 && v >= amb.AMBIENCE_TARGET_LUFS - 6)
  check('every bed kind renders, loudness-matched to its level (−24 LUFS minus its offset)', inRange, JSON.stringify(levels))
  check('beds never clip (soft ceiling)', worst < 1, `peak ${worst.toFixed(3)}`)
  const a = amb.renderAmbienceLayer('crowd', 2, 7)
  const b = amb.renderAmbienceLayer('crowd', 2, 7)
  check('beds are deterministic (same seed → same samples)', a.L.length === b.L.length && a.L.every((v, i) => v === b.L[i]))

  const bed = amb.renderAmbienceBed({ durationSec: 12, segments: segs, seed: 1 })
  const SR = amb.AMBIENCE_SR
  const rmsDb = (t0, t1) => {
    let s = 0
    const i0 = Math.floor(t0 * SR)
    const i1 = Math.floor(t1 * SR)
    for (let i = i0; i < i1; i++) s += bed.L[i] * bed.L[i] + bed.R[i] * bed.R[i]
    return 10 * Math.log10(Math.max(1e-12, s / Math.max(1, (i1 - i0) * 2)))
  }
  const around = [4.7, 4.8, 4.9, 5.0, 5.1, 5.2].map((t) => rmsDb(t - 0.05, t + 0.05))
  const ref = Math.min(rmsDb(3.5, 4.5), rmsDb(5.6, 6.6))
  check('crossfade at a change of bed: no dip (equal-power)', around.every((v) => v > ref - 6), `${around.map((v) => v.toFixed(1)).join(' ')} vs ${ref.toFixed(1)}`)
  check('a none shot is silent, the bed covers the planned seconds', rmsDb(8.8, 9.6) < -90 && bed.coverageSec === 10, `${rmsDb(8.8, 9.6).toFixed(1)} dB, ${bed.coverageSec}s`)

  // the mixer: bed under the music, opt-out, never a bed alone
  const { mixVideoAudio } = await imp('packages/dsh-tool-media/audio-synth.js')
  const proj = join(dirs.ws, 'amb-mix')
  mkdirSync(proj, { recursive: true })
  const sc = { title: 'amb mix', fps: 30, totalDurationSec: 8, genre: 'history-theater', narrationMode: 'subtitle-mv', bgm: { enabled: true }, scenes: [
    { id: 'a', startSec: 0, durationSec: 4, ambience: 'wind' },
    { id: 'b', startSec: 4, durationSec: 4, ambience: 'crowd' },
  ] }
  const withBed = await mixVideoAudio({ projectDir: proj, script: sc })
  check('mixer: the bed joins the music bus and is reported', withBed.ok && withBed.ambience?.kinds?.join() === 'wind,crowd' && existsSync(join(proj, 'audio', 'ambience-bed.wav')), JSON.stringify(withBed.ambience))
  const off = await mixVideoAudio({ projectDir: proj, script: { ...sc, ambienceBed: false } })
  check('mixer: script.ambienceBed=false turns it off', off.ok && off.ambience === null)
  const alone = await mixVideoAudio({ projectDir: proj, script: { ...sc, bgm: { enabled: false } } })
  check('mixer: no bed in a film with neither voice nor music (the normaliser would blow it up)', alone.ok && alone.ambience === null)
})

/* ------------------------------------------------------------------------------------------- exposure guard */
await section('exposure guard', async () => {
  const { resolveBinaries } = await imp('packages/shared/index.js')
  const { ffmpeg, ffprobe } = resolveBinaries()
  const eg = await imp('packages/dsh-tool-video-suite/exposure-guard.js')
  const { buildExposureCheck } = await imp('packages/dsh-tool-video-suite/qa-checker.js')
  const dir = join(SCR, 'exposure')
  mkdirSync(dir, { recursive: true })
  // three 1-second shots, full-range yuvj420p like a Remotion render: A dark (with a black bar), B mid grey,
  // C dark but lit by design (a large white area)
  const src = join(dir, 'src.mp4')
  const gen = spawnSync(ffmpeg, [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x1E1E1E:s=320x180:r=30:d=1,drawbox=x=0:y=150:w=320:h=30:color=black:t=fill',
    '-f', 'lavfi', '-i', 'color=c=0x808080:s=320x180:r=30:d=1',
    '-f', 'lavfi', '-i', 'color=c=0x1E1E1E:s=320x180:r=30:d=1,drawbox=x=0:y=0:w=320:h=100:color=white:t=fill',
    '-f', 'lavfi', '-i', 'sine=f=440:d=3:sample_rate=48000',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuvj420p[v]',
    '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-c:a', 'aac', '-b:a', '128k', src,
  ], { encoding: 'utf8' })
  check('test clip encoded', gen.status === 0 && existsSync(src), gen.stderr?.slice(0, 200))
  const script = { fps: 30, genre: 'history-theater', scenes: ['a', 'b', 'c'].map((id, i) => ({ id, startFrame: i * 30, durationInFrames: 30, durationSec: 1 })) }
  const film = join(dir, 'film.mp4')
  writeFileSync(film, readFileSync(src))
  const res = await eg.enforceExposure({ mp4Path: film, script, ffmpeg })
  check('only the unreadably dark shot is lifted', res.applied && res.lifted.map((l) => l.id).join() === 'a', JSON.stringify({ reason: res.reason, lifted: res.lifted, error: res.error }))
  const probe = spawnSync(ffprobe, ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,pix_fmt,color_range,nb_read_packets', '-of', 'json', film], { encoding: 'utf8' })
  const streams = JSON.parse(probe.stdout || '{}').streams || []
  const v = streams.find((s) => s.codec_type === 'video') || {}
  check('frames, audio and the full range are kept', Number(v.nb_read_packets) === 90 && v.pix_fmt === 'yuvj420p' && streams.some((s) => s.codec_type === 'audio'), JSON.stringify(v))
  const statsAfter = await eg.measureShotLuma({ mp4Path: film, shots: eg.shotsFromScript(script, 30), ffmpeg, durationSec: 3 })
  const statsBefore = await eg.measureShotLuma({ mp4Path: src, shots: eg.shotsFromScript(script, 30), ffmpeg, durationSec: 3 })
  const by = (arr, id) => arr.find((s) => s.id === id)
  check('the dark shot opens up, the others are unchanged', by(statsAfter, 'a').meanY > by(statsBefore, 'a').meanY + 4 && Math.abs(by(statsAfter, 'b').meanY - by(statsBefore, 'b').meanY) < 1.5 && Math.abs(by(statsAfter, 'c').meanY - by(statsBefore, 'c').meanY) < 1.5, statsAfter.map((s) => `${s.id}:${by(statsBefore, s.id).meanY}→${s.meanY}`).join(' '))
  const ymin = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-ss', '0.5', '-i', film, '-vf', 'signalstats,metadata=print:file=-', '-frames:v', '1', '-f', 'null', '-'], { encoding: 'utf8' })
  check('black stays black in the lifted shot', Number((ymin.stdout.match(/YMIN=([\d.]+)/) || [])[1]) <= 2, (ymin.stdout.match(/YMIN=([\d.]+)/) || [])[0])
  check('the QA entry reports the lift', /1 个过暗镜头已提亮/.test(buildExposureCheck(res)?.value || ''), buildExposureCheck(res)?.value)

  const ui = join(dir, 'ui.mp4')
  writeFileSync(ui, readFileSync(src))
  const uiRes = await eg.enforceExposure({ mp4Path: ui, script: { ...script, genre: 'ui-tutorial' }, ffmpeg })
  check('a dark UI theme (explainer genres) is left alone', !uiRes.applied && uiRes.reason === 'within-range', uiRes.reason)
  const offFile = join(dir, 'off.mp4')
  writeFileSync(offFile, readFileSync(src))
  const before = statSync(offFile).size
  const offRes = await eg.enforceExposure({ mp4Path: offFile, script: { ...script, exposureGuard: false }, ffmpeg })
  check('script.exposureGuard=false leaves the film untouched', offRes.reason === 'disabled' && statSync(offFile).size === before)
  const idx = readFileSync(join(ROOT, 'packages', 'dsh-tool-video-suite', 'index.js'), 'utf8')
  check('executeVideoRender runs the exposure guard before the true-peak guard and hands it to the QA', idx.indexOf('enforceExposure({') > 0 && idx.indexOf('enforceExposure({') < idx.indexOf('enforceAudioTruePeak({') && idx.includes('exposure: exposureGuard'))
})

/* ------------------------------------------------------------------------------------------- picture activity */
await section('picture activity', async () => {
  const qd = await imp('packages/dsh-tool-video-suite/qa-detectors.js')
  const fps = 30
  // 4 s: second 0 moves, seconds 1–2 frozen except a hard cut at 1.5 s (frame 45), second 3 moves again
  const ydif = new Float64Array(120).map((_, i) => (i < 30 || i >= 90 ? 1.2 : 0.08))
  ydif[45] = 40
  const timeline = [{ id: 'a', startFrame: 0, startSec: 0, endSec: 1.5 }, { id: 'b', startFrame: 45, startSec: 1.5, endSec: 4 }]
  const m = qd.analyzeMotionActivity({ ydif, fps, timeline })
  check('frozen seconds are counted, the cut frame does not hide them', m.nearStillSec === 2 && m.totalSec === 4 && m.ranges.length === 1 && m.ranges[0].startSec === 1 && m.ranges[0].endSec === 3 && m.ranges[0].sceneIds.join() === 'a,b', JSON.stringify({ n: m.nearStillSec, ranges: m.ranges, perSec: m.perSec }))
  const checks = qd.buildTemporalQaChecks({ motion: m })
  check('the QA entry is a hint (never a failure) and becomes a warning above 20 % frozen time', checks.length === 1 && checks[0].passed === true && checks[0].severity === 'warning' && checks[0].value.includes('几乎不动 2/4 秒'), checks[0]?.value)
  const moving = qd.analyzeMotionActivity({ ydif: new Float64Array(120).fill(0.9), fps, timeline })
  check('a moving film has no frozen seconds and a passing entry', moving.nearStillSec === 0 && qd.buildTemporalQaChecks({ motion: moving })[0].severity === 'pass')
  const coder = readFileSync(join(ROOT, 'packages', 'dsh-tool-media', 'shotcraft-lib.js'), 'utf8')
  check('the scene coder is told to keep every shot moving after its entrance (any genre)', coder.includes('整镜持续运动（任何题材）') && coder.includes('interpolate(frame, [0, durationInFrames], …)'))
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log(`FAILED: ${failed.map((f) => f.name).join(' | ')}`)
  process.exit(1)
}
