#!/usr/bin/env node
/**
 * Video style 「AI 自由匹配」 + 「我的风格预设」 + 3:4 / 4:3 canvases (backend):
 *   - aspect presets: 3:4 (小红书) / 4:3 dimensions, 小红书 platform & 3:4 photos → 3:4 on an auto canvas
 *   - deterministic auto style resolution (no LLM), plan-LLM decisions (preset pick / new design / failure)
 *   - style profile validation: lengths, colours, WCAG-AA contrast fix-up (never rejected for contrast)
 *   - 我的风格预设 store: save / rename / delete / max 60 / atomic file in DSH_VIDEO_HOME
 *   - web routes: new project (auto default), update-format (preset / user / auto), style-presets routes, /state
 *   - local planner (no LLM) and the schema director with a fixture plan LLM (no network)
 *   - MCP tool schemas accept 'auto' and list 3:4 + 4:3
 *
 *   node scripts/tests/style-presets.test.mjs
 *
 * Scratch data only (<repo>/.tmp/style-test/<stamp>); network is blocked; the real `.env` / DSH client are never read.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCR = join(ROOT, '.tmp', 'style-test', new Date().toISOString().replace(/[:.]/g, '-'))
// the bundled voice catalog is only read (new projects match a voice), like the war-room e2e test
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

const shared = await imp('packages/shared/index.js')
const SP = await imp('packages/dsh-tool-media/style-presets.js')
const { resolvePalette } = await imp('packages/dsh-tool-media/html-generator.js')
const { runSchemaDirectorWithDegradation } = await imp('packages/dsh-tool-media/plan-schema.js')
const { planVideoFromAssets } = await imp('packages/dsh-tool-media/ai-director.js')
const { handleWorkbenchApiRequest } = await imp('packages/dsh-web-video-workbench/lib/index.js')
const media = await imp('packages/dsh-tool-media/index.js')

const api = async (method, path, body, query = '') => {
  const url = `http://127.0.0.1/api/video-workbench/${path}${query}`
  const req = new Request(url, method === 'GET' ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
  const res = await handleWorkbenchApiRequest(req)
  return { status: res.status, body: await res.json() }
}
const readScript = (dir) => JSON.parse(readFileSync(join(dir, 'script.json'), 'utf8'))
const AI_PROFILE = {
  name: '水墨青绿',
  desc: '宣纸留白 · 青绿山水 · 墨色晕染',
  base: 'emerald',
  palette: { background: '#F2EEE3', surface: '#E6DECB', textPrimary: '#B8B2A6', textSecondary: '#CFC8BA', accent: '#E9F0EA', accent2: '#2E6B5A', gold: '#C8A45A' },
  typography: 'serif · 书法留白',
  motion: '水墨晕染转场、缓慢横移',
  bgmMood: '古琴空灵',
}

try {
  /* ---------------------------------------------------------------- B · 3:4 / 4:3 canvases */
  {
    const d34 = shared.resolveVideoDimensions({ aspectRatio: '3:4', quality: '1080p' })
    check('3:4 @1080p = 1080×1440', d34.width === 1080 && d34.height === 1440 && d34.aspectRatio === '3:4', `${d34.width}×${d34.height}`)
    const d43 = shared.resolveVideoDimensions({ aspectRatio: '4:3', quality: '1080p' })
    check('4:3 @1080p = 1440×1080 (no silent fallback to auto)', d43.width === 1440 && d43.height === 1080 && d43.aspectRatio === '4:3' && /用户指定/.test(d43.reason), `${d43.width}×${d43.height} ${d43.reason}`)
    const d43s = shared.resolveVideoDimensions({ aspectRatio: '4:3', quality: '720p' })
    const d34k = shared.resolveVideoDimensions({ aspectRatio: '3:4', quality: '4k' })
    check('4:3 @720p = 960×720 · 3:4 @4K = 2160×2880', d43s.width === 960 && d43s.height === 720 && d34k.width === 2160 && d34k.height === 2880, `${d43s.width}×${d43s.height} / ${d34k.width}×${d34k.height}`)
    const xhs = shared.resolveVideoDimensions({ aspectRatio: 'auto', topic: '秋季穿搭分享', targetPlatform: 'xiaohongshu' })
    check('auto canvas + 首发平台小红书 → 3:4', xhs.aspectRatio === '3:4' && xhs.width === 1080 && xhs.height === 1440, xhs.reason)
    const photos = Array.from({ length: 4 }, () => ({ width: 3024, height: 4032 }))
    const tall = shared.resolveVideoDimensions({ aspectRatio: 'auto', topic: '周末野餐', assets: photos })
    const tallDy = shared.resolveVideoDimensions({ aspectRatio: 'auto', topic: '周末野餐', assets: photos, targetPlatform: 'douyin' })
    const phone = shared.resolveVideoDimensions({ aspectRatio: 'auto', topic: '周末野餐', assets: [{ width: 1080, height: 2340 }, { width: 1080, height: 1920 }] })
    check('auto canvas: 3:4 photos → 3:4; on 抖音 → 9:16; 9:16 screenshots → 9:16', tall.aspectRatio === '3:4' && tallDy.aspectRatio === '9:16' && phone.aspectRatio === '9:16', `${tall.aspectRatio} / ${tallDy.aspectRatio} / ${phone.aspectRatio}`)
    check('ASPECT_RATIO_PRESETS has 16:9 9:16 3:4 1:1 4:3', ['16:9', '9:16', '3:4', '1:1', '4:3'].every((k) => shared.ASPECT_RATIO_PRESETS[k]))
    check('subtitle line width: 3:4 is portrait (11), 4:3 landscape (16)', shared.subtitleLineWidthFor({ width: 1080, height: 1440 }) === 11 && shared.subtitleLineWidthFor({ width: 1440, height: 1080 }) === 16)
    const zone = shared.resolveSafeZoneSpec(1080, 1440, 'xiaohongshu')
    check('safe zone for 3:4 (小红书) is the portrait spec with pixel insets', zone.orientation === 'portrait' && zone.safePaddingPx.bottom > 0 && zone.safePaddingPx.bottom < 1440 * 0.3, `${zone.orientation} bottom ${zone.safePaddingPx.bottom}px`)
  }

  /* ---------------------------------------------------------------- A · values + deterministic auto */
  {
    const p = SP.parseStyleValue
    check('style values: auto / preset / user:<id> / aliases / invalid', p('auto').kind === 'auto' && p('warm').id === 'warm' && p('user:sp1abc').kind === 'user' && p('cinema').id === 'cinematic' && p('luxury').id === 'emerald' && p('user:../x').kind === 'invalid' && p('nonsense').kind === 'invalid')
    const r = (t) => SP.resolveAutoStyle({ text: t })
    const picks = [r('制作一条温暖治愈的社区咖啡馆探店 vlog'), r('AI 大模型代码工具发布会'), r('楚汉争霸 项羽 垓下之战 史诗'), r('新中式茶饮品牌 东方雅致 匠心'), r('电竞战队 燃爆卡点混剪'), r('行业深度分析报告 解读财经数据'), r('')]
    check('auto style without LLM: keyword rules pick a preset', picks.join(',') === 'warm,tech,cinematic,emerald,energetic,documentary,tech', picks.join(','))
    check('auto style is deterministic', r('秋日咖啡馆新品宣传') === r('秋日咖啡馆新品宣传'))
  }

  /* ---------------------------------------------------------------- A · profile validation / contrast fix-up */
  {
    const prof = SP.sanitizeStyleProfile(AI_PROFILE, { fallbackBase: 'tech' })
    const pal = prof.palette
    const cr = SP.contrastRatio
    check('profile: low-contrast palette is fixed up (not rejected)', Boolean(prof) && prof.fixes && prof.fixes.length >= 3, (prof.fixes || []).map((f) => `${f.key} ${f.from}→${f.to}`).join(', '))
    check('profile: text ≥ 4.5:1 on background and cards, accents ≥ 3:1', cr(pal.textPrimary, pal.background) >= 4.5 && cr(pal.textPrimary, pal.surface) >= 4.5 && cr(pal.textSecondary, pal.background) >= 4.5 && ['accent', 'accent2', 'gold'].every((k) => cr(pal[k], pal.background) >= 3))
    check('profile: typography / motion / bgmMood normalised', prof.typography.family === 'serif' && prof.typography.mood === '书法留白' && prof.motion === '水墨晕染转场、缓慢横移' && prof.bgmMood === '古琴空灵' && prof.base === 'emerald')
    const long = SP.sanitizeStyleProfile({ ...AI_PROFILE, name: '「一个非常非常非常长的风格名称超过十二个字」', desc: '这是一段远远超过二十四个字的风格描述文字用来测试长度限制是否生效呢呢呢', base: 'unknown', palette: { background: '#123', accent: '#f80', textPrimary: '#fff' } }, { fallbackBase: 'warm' })
    check('profile: name ≤ 12, desc ≤ 24 chars, #RGB expanded, unknown base → fallback', Array.from(long.name).length <= 12 && Array.from(long.desc).length <= 24 && long.palette.background === '#112233' && long.palette.accent === '#FF8800' && long.base === 'warm', `${long.name} / ${long.desc} / ${long.base}`)
    check('profile: no name / too few colours → not a design (null)', SP.sanitizeStyleProfile({ palette: AI_PROFILE.palette }) === null && SP.sanitizeStyleProfile({ name: '只有名字', palette: { accent: '#ff0000' } }) === null)
    const theme = SP.buildThemeFromProfile(prof, { brandMark: 'assets/logo.png' })
    check('profile theme: palette + derived rgbAccent / gradients, keeps the brand mark', theme.accent === pal.accent && theme.rgbAccent.split(',').length === 3 && /linear-gradient/.test(theme.accentGrad) && theme.brandMark === 'assets/logo.png')
  }

  /* ---------------------------------------------------------------- A · plan-LLM decisions */
  {
    const auto = { style: 'tech', styleMode: 'auto' }
    const d1 = SP.decidePlanStyle({ script: auto, planStyle: 'warm', planProfile: null, by: 'llm' })
    const d2 = SP.decidePlanStyle({ script: auto, planStyle: 'emerald', planProfile: AI_PROFILE, by: 'llm' })
    const d3 = SP.decidePlanStyle({ script: auto, planStyle: 'not-a-style', planProfile: { name: '' }, text: '温情家庭故事', by: 'llm' })
    const d4 = SP.decidePlanStyle({ script: { style: 'cinematic', styleMode: 'preset' }, planStyle: 'warm', planProfile: AI_PROFILE, by: 'llm' })
    const d5 = SP.decidePlanStyle({ script: auto, planStyle: undefined, text: 'AI 编程教程', by: 'rules' })
    check('auto: the model picks a preset', d1.mode === 'auto' && d1.style === 'warm' && !d1.profile && d1.by === 'llm')
    check('auto: the model designs a new style (base kept as style)', d2.custom && d2.style === 'emerald' && d2.profile.name === '水墨青绿' && d2.profile.source === 'ai')
    check('auto: unusable answer → keyword rules (never an error)', d3.by === 'rules' && d3.style === 'warm' && !d3.profile)
    check('preset project: the model cannot change the user\'s style', d4.mode === 'preset' && d4.style === 'cinematic' && !d4.profile)
    check('LLM failure tier → auto resolved by rules', d5.by === 'rules' && d5.style === 'tech')
    const sc = SP.applyStyleDecision({ theme: { brandMark: 'b.png' } }, d2)
    check('applied decision: style = base, styleMode auto, profile, styleAuto record, profile theme', sc.style === 'emerald' && sc.styleMode === 'auto' && sc.styleProfile.name === '水墨青绿' && sc.styleAuto.by === 'llm' && sc.styleAuto.custom && sc.theme.accent === d2.profile.palette.accent && sc.theme.brandMark === 'b.png')
    check('resolvePalette() picks up the custom palette (both engines read it)', resolvePalette(sc).background === d2.profile.palette.background && resolvePalette(sc).accent === d2.profile.palette.accent)
    check('effective mode guard: an older writer changing style → treated as an explicit preset', SP.effectiveStyleMode({ ...sc, style: 'cinematic' }) === 'preset' && SP.effectiveStyleMode(sc) === 'auto' && SP.styleSelectionValue(sc) === 'auto')
    const dir1 = SP.buildStylePlanDirective(auto)
    const dir2 = SP.buildStylePlanDirective({ style: 'warm', styleMode: 'preset' })
    check('plan directive: auto lists the 6 presets + styleProfile schema; preset is fixed', SP.STYLE_PRESET_IDS.every((id) => dir1.includes(id)) && dir1.includes('styleProfile') && /固定填 "warm"/.test(dir2))
    const guide = SP.buildStyleProfileGuide(sc)
    const pkg = SP.withStyleGuide({ system: 'SYS', user: 'U' }, sc)
    check('coder guide: name / desc / palette / typography / motion, appended once', guide.includes('水墨青绿') && guide.includes(d2.profile.palette.accent) && guide.includes('书法留白') && guide.includes('水墨晕染') && SP.withStyleGuide(pkg, sc).system === pkg.system && SP.buildStyleProfileGuide({ style: 'tech' }) === '')
  }

  /* ---------------------------------------------------------------- A · 我的风格预设 store */
  {
    const saved = SP.saveStylePreset({ name: '我的水墨', profile: AI_PROFILE })
    const file = SP.getStylePresetsPath()
    check('preset store lives in DSH_VIDEO_HOME/style-presets.json', file === join(dirs.home, 'style-presets.json') && existsSync(file), file)
    check('save → listed with value user:<id>', saved.value === `user:${saved.id}` && SP.listStylePresets().some((p) => p.id === saved.id && p.name === '我的水墨'))
    let dupErr = ''
    try {
      SP.saveStylePreset({ name: '我的水墨', profile: AI_PROFILE })
    } catch (err) {
      dupErr = err.message
    }
    check('duplicate name is refused with a clear message', /已经有名为/.test(dupErr), dupErr)
    const ren = SP.renameStylePreset(saved.id, '  水墨 · 国风  ')
    check('rename (trimmed)', ren.name === '水墨 · 国风' && SP.getStylePreset(saved.id).profile.name === '水墨 · 国风')
    const stored = JSON.parse(readFileSync(file, 'utf8'))
    check('stored file: version 1, one preset, contrast-fixed palette, no temp files left', stored.version === 1 && stored.presets.length === 1 && SP.contrastRatio(stored.presets[0].palette.textPrimary, stored.presets[0].palette.background) >= 4.5 && !readdirSync(dirs.home).some((f) => /\.tmp|\.lock$/.test(f)), readdirSync(dirs.home).join(','))
    SP.deleteStylePreset(saved.id)
    check('delete', SP.listStylePresets().length === 0)
    for (let i = 0; i < SP.MAX_STYLE_PRESETS; i++) SP.saveStylePreset({ name: `预设${i + 1}`, profile: AI_PROFILE })
    let maxErr = ''
    try {
      SP.saveStylePreset({ name: '第61个', profile: AI_PROFILE })
    } catch (err) {
      maxErr = err.message
    }
    check(`at most ${SP.MAX_STYLE_PRESETS} presets`, SP.listStylePresets().length === SP.MAX_STYLE_PRESETS && /最多保存 60/.test(maxErr), maxErr)
    for (const p of SP.listStylePresets()) SP.deleteStylePreset(p.id)
  }

  /* ---------------------------------------------------------------- web routes */
  let projectDir = ''
  {
    const created = await api('POST', 'projects', { title: '秋日咖啡馆新品宣传', engine: 'html', aspectRatio: '3:4', quality: '1080p' })
    projectDir = created.body.projectDir
    if (!projectDir) throw new Error(`create project failed: ${created.status} ${JSON.stringify(created.body).slice(0, 400)}`)
    const sc = readScript(projectDir)
    check('new project defaults to AI 自由匹配 (styleMode auto, base preset by rules, decision still pending)', created.body.ok && sc.styleMode === 'auto' && SP.isPresetStyleId(sc.style) && sc.styleAuto && sc.styleAuto.by === 'pending' && sc.theme.background === resolvePalette({ style: sc.style }).background, `${sc.style}/${sc.styleMode}`)
    check('new project at 3:4 is 1080×1440', sc.width === 1080 && sc.height === 1440 && sc.aspectRatio === '3:4', `${sc.width}×${sc.height}`)
    const r1 = await api('POST', 'action', { projectDir, action: 'update-format', style: 'cinematic' })
    const s1 = readScript(projectDir)
    check('update-format preset → styleMode preset, preset palette', r1.body.ok && s1.style === 'cinematic' && s1.styleMode === 'preset' && !s1.styleProfile && s1.theme.accent === resolvePalette({ style: 'cinematic' }).accent)
    const preset = SP.saveStylePreset({ name: '雨夜霓虹', profile: { ...AI_PROFILE, name: '雨夜霓虹', base: 'energetic', palette: { background: '#0B0A1A', surface: '#17142E', textPrimary: '#F5F3FF', textSecondary: '#C4B5FD', accent: '#FF3D9A', accent2: '#22D3EE', gold: '#FACC15' } } })
    const r2 = await api('POST', 'action', { projectDir, action: 'update-format', style: preset.value })
    const s2 = readScript(projectDir)
    check('update-format user:<id> → style = base, styleMode user, profile copy, profile palette', r2.body.ok && s2.style === 'energetic' && s2.styleMode === 'user' && s2.styleProfile.presetId === preset.id && s2.theme.accent === '#FF3D9A' && SP.styleSelectionValue(s2) === preset.value)
    const r3 = await api('POST', 'action', { projectDir, action: 'update-format', style: 'user:spmissing0' })
    check('update-format with a missing preset → 400 with a message', r3.status === 400 && /不存在/.test(r3.body.error), r3.body.error)
    const r4 = await api('POST', 'action', { projectDir, action: 'update-format', style: 'auto' })
    const s4 = readScript(projectDir)
    check('update-format auto → styleMode auto, user profile dropped, decision pending until a run', r4.body.ok && s4.styleMode === 'auto' && !s4.styleProfile && s4.styleAuto && s4.styleAuto.by === 'pending' && SP.isPresetStyleId(s4.style))
    // an older writer (template apply / reference analysis) that only changes `style` turns it into an explicit preset
    const tplLike = { ...s4, style: s4.style === 'cinematic' ? 'warm' : 'cinematic' }
    check('a template / reference writer changing only `style` on a never-run auto project → explicit preset', SP.effectiveStyleMode(tplLike) === 'preset' && SP.styleSelectionValue(tplLike) === tplLike.style)
    const r5 = await api('POST', 'action', { projectDir, action: 'update-format', targetPlatform: 'xiaohongshu', aspectRatio: 'auto' })
    const s5 = readScript(projectDir)
    check('update-format: 小红书 on an auto canvas → 3:4', r5.body.ok && s5.aspectRatio === '3:4' && s5.height === 1440, `${s5.aspectRatio} ${s5.width}×${s5.height}`)
    const r6 = await api('POST', 'action', { projectDir, action: 'update-format', aspectRatio: '4:3' })
    const s6 = readScript(projectDir)
    check('update-format 4:3 → 1440×1080', r6.body.ok && s6.aspectRatio === '4:3' && s6.width === 1440 && s6.height === 1080, `${s6.width}×${s6.height}`)
    const noProfile = await api('POST', 'style-presets/save', { projectDir, name: 'x' })
    check('save-from-project without an AI-designed style → 400 explaining how', noProfile.status === 400 && /AI 自由匹配/.test(noProfile.body.error), noProfile.body.error)
    // the project gets an AI-designed style (as the plan LLM would write it), then 「保存为我的预设」
    const withAi = SP.applyStyleDecision(readScript(projectDir), SP.decidePlanStyle({ script: readScript(projectDir), planStyle: 'emerald', planProfile: AI_PROFILE, by: 'llm' }))
    shared.writeScriptJson(projectDir, withAi)
    const saveRes = await api('POST', 'style-presets/save', { projectDir, name: '咖啡馆水墨' })
    const list = await api('GET', 'style-presets')
    check('POST style-presets/save saves the project\'s AI style; GET lists it', saveRes.body.ok && saveRes.body.preset.name === '咖啡馆水墨' && list.body.presets.some((p) => p.name === '咖啡馆水墨') && list.body.max === 60)
    const dupe = await api('POST', 'style-presets/save', { projectDir, name: '咖啡馆水墨' })
    check('POST style-presets/save duplicate → 400', dupe.status === 400 && /已经有名为/.test(dupe.body.error))
    const ren = await api('POST', 'style-presets/rename', { id: saveRes.body.preset.id, name: '咖啡馆 · 水墨' })
    check('POST style-presets/rename', ren.body.ok && ren.body.presets.some((p) => p.name === '咖啡馆 · 水墨'))
    const del = await api('POST', 'style-presets/delete', { id: saveRes.body.preset.id })
    const delAgain = await api('POST', 'style-presets/delete', { id: saveRes.body.preset.id })
    check('POST style-presets/delete (again → 400)', del.body.ok && !del.body.presets.some((p) => p.id === saveRes.body.preset.id) && delAgain.status === 400)
    const st = await api('GET', 'state', null, `?projectDir=${encodeURIComponent(projectDir)}`)
    check('GET state carries stylePresets + the project style fields', Array.isArray(st.body.stylePresets) && st.body.stylePresets.some((p) => p.id === preset.id) && st.body.activeProject.script.styleProfile.name === '水墨青绿')
    // a run that is still 'auto' picks again (the AI may redesign); a deleted preset that a project uses is kept
    const prep = SP.prepareProjectStyleForRun({ projectDir, style: 'auto', text: '秋日咖啡馆新品宣传 温暖' })
    const sp = readScript(projectDir)
    check('run start with auto: picks again by rules (old AI design cleared until the plan call decides)', prep.style === sp.style && sp.styleMode === 'auto' && !sp.styleProfile && sp.styleAuto.by === 'rules', `${prep.style} ${sp.styleAuto && sp.styleAuto.by}`)
    await api('POST', 'action', { projectDir, action: 'update-format', style: preset.value })
    SP.deleteStylePreset(preset.id)
    const prep2 = SP.prepareProjectStyleForRun({ projectDir, style: preset.value })
    const sp2 = readScript(projectDir)
    check('a deleted 我的预设 the project uses: the project keeps its own copy (no error)', prep2.style === 'energetic' && sp2.styleMode === 'user' && sp2.styleProfile.name === '雨夜霓虹' && !prep2.warning, prep2.warning)
  }

  /* ---------------------------------------------------------------- local planner (no LLM) */
  {
    const dir = join(dirs.ws, 'local-auto')
    mkdirSync(dir, { recursive: true })
    const r = await planVideoFromAssets({ projectDir: dir, topic: '温暖治愈的家庭烘焙故事', style: 'auto', engine: 'html', aspectRatio: '3:4' })
    const sc = readScript(dir)
    check('local draft with auto: keyword rules decide (warm), recorded as rules, never an error', r.ok && sc.style === 'warm' && sc.styleMode === 'auto' && sc.styleAuto.by === 'rules' && sc.width === 1080 && sc.height === 1440, `${sc.style} ${sc.width}×${sc.height}`)
    const html = readFileSync(join(dir, 'index.html'), 'utf8')
    check('HTML engine renders the 3:4 canvas with the preset palette', html.includes('1080') && html.includes('1440') && html.includes(resolvePalette({ style: 'warm' }).accent))
    const preset = SP.saveStylePreset({ name: '雨夜霓虹2', profile: { ...AI_PROFILE, name: '雨夜霓虹2', base: 'energetic', palette: { background: '#0B0A1A', surface: '#17142E', textPrimary: '#F5F3FF', textSecondary: '#C4B5FD', accent: '#FF3D9A', accent2: '#22D3EE', gold: '#FACC15' } } })
    await planVideoFromAssets({ projectDir: dir, topic: '温暖治愈的家庭烘焙故事', style: preset.value, engine: 'remotion', aspectRatio: '4:3' })
    const s2 = readScript(dir)
    const vc = existsSync(join(dir, 'src', 'VideoComposition.tsx')) ? readFileSync(join(dir, 'src', 'VideoComposition.tsx'), 'utf8') : ''
    check('local draft with 我的预设: base + profile + palette in both engines (Remotion PALETTE)', s2.style === 'energetic' && s2.styleMode === 'user' && s2.theme.accent === '#FF3D9A' && s2.width === 1440 && s2.height === 1080 && vc.includes('#FF3D9A'), `${s2.style} ${s2.width}×${s2.height} tsx:${vc.length}`)
    await planVideoFromAssets({ projectDir: dir, topic: '温暖治愈的家庭烘焙故事', style: 'energetic', engine: 'remotion' })
    const s3 = readScript(dir)
    check('the pipeline passing the base preset keeps a user / auto project (keepModeIfBase)', s3.styleMode === 'user' && s3.styleProfile && s3.styleProfile.name === '雨夜霓虹2')
    await planVideoFromAssets({ projectDir: dir, topic: '温暖治愈的家庭烘焙故事', style: 'documentary', engine: 'remotion' })
    const s4 = readScript(dir)
    check('an explicit different preset switches to preset mode', s4.style === 'documentary' && s4.styleMode === 'preset' && !s4.styleProfile)
    SP.deleteStylePreset(preset.id)
  }

  /* ---------------------------------------------------------------- schema director with a fixture plan LLM */
  {
    const fixturePlan = (style, styleProfile) => ({
      version: 'promo-plan/1',
      title: '水墨里的咖啡香',
      style,
      styleProfile,
      bpm: 92,
      shots: Array.from({ length: 6 }, (_, i) => ({ id: `scene-0${i + 1}`, title: `镜头 ${i + 1}`, narration: `第 ${i + 1} 个镜头的旁白文案内容。`, recipe: i === 0 ? 'pull_out' : 'push_in', durationSec: 4.2, transition: i === 0 ? 'cut' : 'light-wipe', layout: 'freeform-stage' })),
    })
    const calls = []
    const mockLlm = (reply) => async (p) => {
      calls.push(p)
      return { text: JSON.stringify(reply), model: 'fixture' }
    }
    const autoScript = { title: '水墨里的咖啡香', style: 'tech', styleMode: 'auto', authoringMode: 'ai-coded', scenes: [] }
    const r1 = await runSchemaDirectorWithDegradation({ topic: '水墨国风咖啡馆宣传', style: 'tech', scriptData: autoScript, assetsManifest: { items: [] }, callLlmChatFn: mockLlm(fixturePlan('emerald', AI_PROFILE)) })
    check('plan LLM prompt (auto) asks to pick a preset or design a styleProfile', calls[0] && calls[0].system.includes('AI 自由匹配') && calls[0].system.includes('styleProfile'))
    check('plan LLM designs a style → plan + scriptData carry it (validated, contrast fixed)', r1.degradationTier === 1 && r1.plan.style === 'emerald' && r1.plan.styleProfile.name === '水墨青绿' && autoScript.styleMode === 'auto' && autoScript.styleProfile.name === '水墨青绿' && autoScript.styleAuto.by === 'llm' && SP.contrastRatio(autoScript.theme.textPrimary, autoScript.theme.background) >= 4.5)
    const presetScript = { title: 'x', style: 'cinematic', styleMode: 'preset', authoringMode: 'ai-coded', scenes: [] }
    calls.length = 0
    const r2 = await runSchemaDirectorWithDegradation({ topic: '咖啡馆宣传', style: 'cinematic', scriptData: presetScript, assetsManifest: { items: [] }, callLlmChatFn: mockLlm(fixturePlan('warm', AI_PROFILE)) })
    check('preset project: prompt says the style is fixed; the plan keeps the user\'s style', /固定填 "cinematic"/.test(calls[0].system) && r2.plan.style === 'cinematic' && !r2.plan.styleProfile && presetScript.styleMode === 'preset' && !presetScript.styleProfile)
    const failScript = { title: '家庭温情故事', style: 'tech', styleMode: 'auto', authoringMode: 'ai-coded', scenes: [] }
    const r3 = await runSchemaDirectorWithDegradation({ topic: '温情家庭故事 治愈', style: 'tech', scriptData: failScript, assetsManifest: { items: [] }, callLlmChatFn: async () => { throw new Error('provider down') } })
    check('plan LLM failure → rule tier, auto resolved deterministically', r3.degradationTier === 4 && failScript.styleAuto.by === 'rules' && failScript.style === 'warm' && r3.plan.style === 'warm', `${r3.degradationTier} ${failScript.style}`)
  }

  /* ---------------------------------------------------------------- plaza template after an AI-designed style */
  {
    const { applyPlazaTemplateToProject, listPlazaTemplates } = await imp('packages/dsh-tool-media/template-plaza.js')
    const tpl = (listPlazaTemplates().templates || []).find((t) => t && t.style === 'tech') || null
    const projectDir = join(dirs.ws, 'tpl-after-ai')
    mkdirSync(projectDir, { recursive: true })
    const aiProfile = SP.sanitizeStyleProfile({ name: '水墨青绿', desc: '宣纸墨色', base: 'emerald', palette: { background: '#101814', surface: '#1B2722', textPrimary: '#F4F1E8', textSecondary: '#C9C2B0', accent: '#3FA37F', accent2: '#8FC9A8', gold: '#D9B26F' } }, { source: 'ai' })
    const sc = SP.applyStyleDecision({ title: '模板测试', scenes: [] }, { mode: 'auto', style: aiProfile.base, profile: aiProfile, by: 'llm' })
    writeFileSync(join(projectDir, 'script.json'), JSON.stringify(sc, null, 2))
    if (tpl) {
      applyPlazaTemplateToProject({ projectDir, templateId: tpl.id })
      const after = JSON.parse(readFileSync(join(projectDir, 'script.json'), 'utf8'))
      const pal = resolvePalette(after)
      const techPal = resolvePalette({ style: 'tech' })
      check('applying a plaza template after an AI-designed style switches style AND palette to the template preset', after.style === 'tech' && SP.effectiveStyleMode(after) === 'preset' && !after.styleProfile && pal.accent === techPal.accent && pal.background === techPal.background, `${after.style} ${SP.effectiveStyleMode(after)} accent=${pal.accent}`)
    } else check('a built-in tech template exists for the template test', false)
  }

  /* ---------------------------------------------------------------- MCP schemas */
  {
    const tools = {}
    media.apply({ tools: { register: (t) => (tools[t.name] = t) } })
    const styleOk = (name) => {
      const p = tools[name] && tools[name].parameters.properties.style
      return Boolean(p && new RegExp(p.pattern).test('auto') && new RegExp(p.pattern).test('user:sp1x') && new RegExp(p.pattern).test('warm') && !new RegExp(p.pattern).test('nope') && /AI 自由匹配/.test(p.description))
    }
    check('MCP plan_video_from_assets / produce_video / ai_create_video / run_agent_pipeline accept style auto', ['plan_video_from_assets', 'produce_video', 'ai_create_video', 'run_agent_pipeline'].every(styleOk))
    const asp = (name) => tools[name].parameters.properties.aspectRatio
    check('MCP aspect enums list 3:4 and 4:3', ['plan_video_from_assets', 'produce_video', 'ai_create_video'].every((n) => asp(n).enum.includes('3:4') && asp(n).enum.includes('4:3')) && /4:3/.test(asp('run_agent_pipeline').description))
  }
} catch (err) {
  check('test run completed without exceptions', false, err?.stack || String(err))
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — FAILED: ${failed.map((f) => f.name).join(' | ')}` : ''}`)
console.log(`scratch: ${SCR}`)
process.exit(failed.length ? 1 : 0)
