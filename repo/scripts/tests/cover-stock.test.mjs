#!/usr/bin/env node
/**
 * Publish-pack cover studio (默认 / 选用视频画面 / AI 重新生成) + free stock-library keys configured in the Studio.
 *
 *   node scripts/tests/cover-stock.test.mjs [--keep]
 *
 * Covers: the automatic cover avoids black / fading frames and is deterministic; a frame picked at a time is exactly that
 * frame; 「AI 写提示词」 (mocked LLM) and AI cover generation (mocked image provider) incl. aspect crop, reference frame
 * and paid-result reuse; the publish pack copies the chosen cover; title overlay upload; path safety; stock keys saved
 * masked / KEEP_EXISTING / clear / .env fallback / saved-over-.env, search works right after saving, 「测试连接」.
 *
 * Scratch data only (<repo>/.tmp/cover-test/<stamp>, isolated DSH_VIDEO_HOME / WORKSPACE / ENV / cloud-media config);
 * every network request is mocked (no real LLM, image or stock calls). Test films are made with the bundled ffmpeg.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const KEEP = process.argv.includes('--keep')
const SCR = join(ROOT, '.tmp', 'cover-test', new Date().toISOString().replace(/[:.]/g, '-'))
const dirs = { home: join(SCR, 'home'), ws: join(SCR, 'ws'), voices: join(SCR, 'voices'), dshClient: join(SCR, 'no-dsh-client') }
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true })
const envFile = join(SCR, 'test.env')
writeFileSync(envFile, '# scratch .env for the cover / stock tests\n')
const MODEL_VARS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'OPENAI_MODEL', 'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_BASE_URL', 'GEMINI_MODEL', 'OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL', 'OPENROUTER_MODEL',
  'LLM_MODE', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_PROVIDER', 'LLM_FORMAT', 'DSH_VIDEO_HOST_AGENT', 'DSH_VIDEO_HOST_AGENT_VERSION',
  'PEXELS_API_KEY', 'PIXABAY_API_KEY', 'DSH_CLOUD_MAX_PAID_JOBS_PER_RUN',
]
for (const v of MODEL_VARS) delete process.env[v]
Object.assign(process.env, {
  DSH_VIDEO_ENV_PATH: envFile,
  DSH_VIDEO_HOME: dirs.home,
  DSH_VIDEO_WORKSPACE: dirs.ws,
  VOICE_PACKS_DIR: dirs.voices,
  DSH_CLIENT_HOME: dirs.dshClient,
  DSH_HOME: dirs.dshClient,
  DSH_VIDEO_CLOUD_MEDIA_CONFIG: join(SCR, 'cloud-media.json'),
})

/* ------------------------------------------------------------------------------------------------ network mock */
const PEXELS_KEY = 'pexels-test-key-0123456789-abcdefghij-SAVED'
const PIXABAY_ENV_KEY = '11111111-envpixabaykey0123456789abcd'
const PIXABAY_SAVED_KEY = '22222222-savedpixabaykey987654321wxyz'
const LLM_PROMPT = '金色夕阳下的骑兵剪影冲上山岗，低角度仰拍，逆光丁达尔光束，暖橙与深蓝撞色，电影级质感，上方留出干净天空放标题，画面中没有任何文字'
const net = { llm: [], image: [], pexels: [], pixabay: [], other: [] }
let imagePng = null
const jsonResp = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || String(input)
  const u = new URL(url)
  if (u.origin === 'https://llm.mock.test') {
    net.llm.push({ url, body: JSON.parse(String(init.body || '{}')) })
    return jsonResp({ model: 'mock-model', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ prompt: LLM_PROMPT }) } }] })
  }
  if (u.origin === 'https://img.mock.test') {
    net.image.push({ url, body: JSON.parse(String(init.body || '{}')) })
    return new Response(imagePng, { status: 200, headers: { 'content-type': 'image/png' } })
  }
  if (u.origin === 'https://api.pexels.com') {
    const auth = init.headers?.Authorization || init.headers?.authorization || ''
    net.pexels.push({ path: u.pathname, auth })
    if (auth !== PEXELS_KEY) return jsonResp({ error: 'Unauthorized' }, 401)
    if (u.pathname === '/v1/curated') return jsonResp({ page: 1, per_page: 1, photos: [{ id: 1 }] })
    if (u.pathname === '/v1/search') {
      return jsonResp({ total_results: 1, photos: [{ id: 77, width: 1920, height: 1080, url: 'https://www.pexels.com/photo/77/', photographer: 'Eve', src: { large2x: 'https://images.pexels.com/p77.jpg', tiny: 'https://images.pexels.com/t77.jpg' } }] })
    }
  }
  if (u.origin === 'https://pixabay.com' && u.pathname.startsWith('/api/')) {
    const key = u.searchParams.get('key') || ''
    net.pixabay.push({ path: u.pathname, key })
    if (key !== PIXABAY_SAVED_KEY && key !== PIXABAY_ENV_KEY) return new Response('[ERROR 400] Invalid or missing API key', { status: 400, headers: { 'content-type': 'text/plain' } })
    return jsonResp({ totalHits: 1, hits: [{ id: 5, webformatURL: 'https://cdn.pixabay.com/x.jpg', imageWidth: 100, imageHeight: 100 }] })
  }
  net.other.push(url)
  throw new Error(`network blocked in tests: ${url}`)
}

/* ------------------------------------------------------------------------------------------------ harness */
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`)
}
const shared = await import(pathToFileURL(join(ROOT, 'packages', 'shared', 'index.js')).href)
const llm = await import(pathToFileURL(join(ROOT, 'packages', 'dsh-tool-media', 'llm-client.js')).href)
const cloud = await import(pathToFileURL(join(ROOT, 'packages', 'dsh-tool-media', 'cloud-media.js')).href)
const stock = await import(pathToFileURL(join(ROOT, 'packages', 'dsh-tool-media', 'stock-media.js')).href)
const cover = await import(pathToFileURL(join(ROOT, 'packages', 'dsh-tool-media', 'cover-studio.js')).href)
const { handleWorkbenchApiRequest } = await import(pathToFileURL(join(ROOT, 'packages', 'dsh-web-video-workbench', 'lib', 'index.js')).href)
const { ffmpeg } = shared.resolveBinaries()

const api = async (method, path, body, query) => {
  const u = new URL(`http://127.0.0.1/api/video-workbench/${path}`)
  for (const [k, v] of Object.entries(query || {})) u.searchParams.set(k, String(v))
  const r = await handleWorkbenchApiRequest(new Request(u.href, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }))
  const text = await r.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: r.status, json: json || {}, text }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitJob = async (id) => {
  for (let i = 0; i < 400; i++) {
    const { json } = await api('GET', 'jobs', null, { id })
    if (json.job && ['done', 'error'].includes(json.job.status)) return json.job
    await sleep(100)
  }
  return { status: 'timeout' }
}
const ff = async (args) => {
  const r = await shared.runCommandRedirected(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeoutMs: 120_000 })
  if (r.code !== 0) throw new Error(`ffmpeg failed: ${r.stderr.slice(0, 300)}`)
}
/** decode any image / video frame to a small grayscale buffer (for pixel comparisons) */
const gray = async (file, w = 160, h = 90, extra = []) => {
  const out = join(SCR, `gray-${Math.random().toString(36).slice(2)}.raw`)
  await ff(['-i', file, ...extra, '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', out])
  const b = readFileSync(out)
  rmSync(out, { force: true })
  return b
}
const mad = (a, b) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
  return s / a.length
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const pngSize = (file) => {
  const b = readFileSync(file)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

// a 10 s film: black · testsrc2 · fade-out · black · colour bars · blurred testsrc2 (each segment = one scene)
const SEGMENTS = [
  ['scene-01', 1.5, 'color=c=black:s=640x360:r=30:d=1.5', '黑场开场', '黑屏'],
  ['scene-02', 2.5, 'testsrc2=s=640x360:r=30:d=2.5', '霍去病率军出征', '少年将军率八百骑兵出征'],
  ['scene-03', 1.2, 'testsrc2=s=640x360:r=30:d=1.2,fade=t=out:st=0:d=1.2', '夜色降临', '画面渐暗'],
  ['scene-04', 0.8, 'color=c=black:s=640x360:r=30:d=0.8', '黑场', '黑屏过渡'],
  ['scene-05', 2.5, 'smptehdbars=s=640x360:r=30:d=2.5', '封狼居胥', '在狼居胥山祭天，大军凯旋'],
  ['scene-06', 1.5, 'testsrc2=s=640x360:r=30:d=1.5,gblur=sigma=14', '尾声', '模糊的余韵'],
]
const makeFilm = async (projDir, { bars = 'smptehdbars' } = {}) => {
  const segs = SEGMENTS.map((s) => (s[0] === 'scene-05' ? s[2].replace('smptehdbars', bars) : s[2]))
  const labels = segs.map((_, i) => `[s${i}]`)
  const fc = `${segs.map((s, i) => `${s}${labels[i]}`).join(';')};${labels.join('')}concat=n=${segs.length}:v=1:a=0,format=yuv420p[v]`
  mkdirSync(join(projDir, 'output'), { recursive: true })
  await ff(['-filter_complex', fc, '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(projDir, 'output', 'final.mp4')])
}
const makeProject = async (name) => {
  const projDir = join(dirs.ws, name)
  mkdirSync(projDir, { recursive: true })
  const scenes = SEGMENTS.map(([id, d, , title, narration]) => ({ id, title, narration, durationSec: d, visualBlueprint: `${title}：${narration}` }))
  writeFileSync(
    join(projDir, 'script.json'),
    JSON.stringify({ title: '冠军侯霍去病', displayTitle: '冠军侯霍去病', topic: '讲述霍去病封狼居胥的传奇', contentOutline: ['少年出征', '大破匈奴', '封狼居胥'], fps: 30, width: 640, height: 360, aspectRatio: '16:9', targetPlatform: 'douyin', totalDurationSec: 10, scenes }, null, 2),
  )
  await makeFilm(projDir)
  return projDir
}
const inSeg = (t, id) => {
  let start = 0
  for (const [sid, d] of SEGMENTS) {
    if (sid === id) return t >= start && t < start + d
    start += d
  }
  return false
}

let exitCode = 1
try {
  // mock image provider result: a real 1536×1024 PNG (landscape, so a 3:4 cover must be cropped)
  const imgFile = join(SCR, 'mock-provider.png')
  await ff(['-f', 'lavfi', '-i', 'testsrc2=s=1536x1024:r=1', '-frames:v', '1', imgFile])
  imagePng = readFileSync(imgFile)
  const proj = await makeProject('cover-proj')

  /* ======================================================================================= A. automatic cover */
  {
    let st = await api('GET', 'publish-pack/cover', null, { projectDir: proj, platform: 'douyin' })
    check('GET publish-pack/cover answers 200 with the film and a pending / ready auto pick', st.status === 200 && st.json.ok && st.json.hasMp4 && ['pending', 'ready'].includes(st.json.auto?.status), `${st.status} ${st.json.auto?.status} ${st.json.error || ''}`)
    const t0 = Date.now()
    for (let i = 0; i < 100 && st.json.auto?.status !== 'ready'; i++) {
      await sleep(150)
      st = await api('GET', 'publish-pack/cover', null, { projectDir: proj, platform: 'douyin' })
    }
    const auto = st.json.auto || {}
    const best = auto.candidates?.[auto.bestIndex]
    check('automatic candidates are computed in the background within a few seconds', auto.status === 'ready' && auto.candidates.length >= 8 && auto.candidates.length <= 12 && Date.now() - t0 < 15000, `n=${auto.candidates?.length} ${Date.now() - t0} ms (compute ${auto.elapsedMs} ms)`)
    const bad = (c) => inSeg(c.timeSec, 'scene-01') || inSeg(c.timeSec, 'scene-03') || inSeg(c.timeSec, 'scene-04')
    check('the auto pick is not a black / fading frame (it is sharp testsrc or colour bars)', best && !bad(best) && (inSeg(best.timeSec, 'scene-02') || inSeg(best.timeSec, 'scene-05')) && best.metrics.meanY > 60, best ? `best ${best.timeSec}s score ${best.score} meanY ${best.metrics.meanY}` : 'no best')
    const blacks = auto.candidates.filter((c) => inSeg(c.timeSec, 'scene-01') || inSeg(c.timeSec, 'scene-04'))
    check('candidates in black segments are rejected as 黑屏', blacks.length > 0 && blacks.every((c) => c.rejected === 'black' && c.labels.includes('黑屏')), blacks.map((c) => `${c.timeSec}:${c.rejected}`).join(' '))
    const fades = auto.candidates.filter((c) => inSeg(c.timeSec, 'scene-03'))
    check('candidates inside the fade-out score far below the best and are labelled', fades.length > 0 && fades.every((c) => c.score < best.score - 25 && (c.rejected || c.notes.some((n) => ['fade', 'motion', 'dim'].includes(n)))), fades.map((c) => `${c.timeSec}:${c.score}:${c.rejected || c.notes.join('+')}`).join(' '))
    check('state: default AI aspect follows the platform (抖音 → 9:16), effective cover = auto best', st.json.defaultAspect === '9:16' && st.json.cover.mode === 'auto' && st.json.cover.effective.file === best.file, `${st.json.defaultAspect} ${JSON.stringify(st.json.cover.effective)}`)
    const before = auto.candidates.map((c) => `${c.timeSec}:${c.score}`).join(',')
    const again = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'refresh-auto' })
    const after = (again.json.auto?.candidates || []).map((c) => `${c.timeSec}:${c.score}`).join(',')
    check('the automatic pick is deterministic (recomputed → same times, scores and best)', again.status === 200 && before === after && again.json.auto.bestIndex === auto.bestIndex, `${before === after}`)

    // the publish pack uses the auto pick
    const pack = await api('POST', 'publish-pack', { projectDir: proj, platform: 'douyin' })
    const packCover = join(proj, 'publish', 'douyin-pack', 'cover.png')
    check('publish pack (auto) → cover.png is the best automatic frame, reported as mode auto', pack.status === 200 && pack.json.ok && pack.json.cover?.mode === 'auto' && existsSync(packCover), `${pack.status} ${JSON.stringify(pack.json.cover)} ${pack.json.error || ''}`)
    const gPack = await gray(packCover)
    const gBest = await gray(join(proj, best.file))
    const lossless = pack.json.cover?.source || ''
    check('pack cover = a lossless PNG of the auto pick (not black, same picture as the candidate preview)', /^output\/covers\/auto\/best-\d+\.png$/.test(lossless) && sha(packCover) === sha(join(proj, lossless)) && mad(gPack, gBest) < 6 && mean(gPack) > 60, `${lossless} mad=${mad(gPack, gBest).toFixed(2)} mean=${mean(gPack).toFixed(1)}`)
    check('meta.md names the cover source', /cover\.png` \(自动挑选的最佳画面/.test(readFileSync(join(proj, 'publish', 'douyin-pack', 'meta.md'), 'utf8')))
    const st2 = await api('GET', 'publish-pack/cover', null, { projectDir: proj })
    check('the cover section shows which cover the last 抖音 pack used', st2.json.packs?.douyin?.mode === 'auto' && st2.json.packs.douyin.packFile === 'publish/douyin-pack/cover.png' && st2.json.packs.douyin.candidate === best.file && st2.json.packs.douyin.timeSec === best.timeSec, JSON.stringify(st2.json.packs?.douyin))
  }

  /* ========================================================================================= B. frame pick */
  let framePick = null
  {
    const r = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'frame', timeSec: 2.05 })
    framePick = r.json.picked
    check('POST frame {timeSec: 2.05} → the frame shown at 2.05 s (frame 61) becomes the cover', r.status === 200 && framePick?.frame === 61 && framePick.file === 'output/covers/frame-000061.png' && r.json.cover.mode === 'frame', `${r.status} ${JSON.stringify(framePick)} ${r.json.error || ''}`)
    const gt = async (n) => {
      const out = join(SCR, `gt-${n}.png`)
      await ff(['-i', join(proj, 'output', 'final.mp4'), '-vf', `select='eq(n,${n})'`, '-vsync', '0', '-frames:v', '1', out])
      return gray(out)
    }
    const pick = await gray(join(proj, framePick.file))
    const [g60, g61, g62] = [await gt(60), await gt(61), await gt(62)]
    check('frame-accurate: identical to frame 61 decoded from the start, different from 60 / 62', mad(pick, g61) < 0.5 && mad(pick, g60) > 1 && mad(pick, g62) > 1, `mad61=${mad(pick, g61).toFixed(2)} mad60=${mad(pick, g60).toFixed(2)} mad62=${mad(pick, g62).toFixed(2)}`)
    const cj = JSON.parse(readFileSync(join(proj, 'output', 'covers', 'cover.json'), 'utf8'))
    check('cover.json stores { mode, file, timeSec, … } and never script.json', cj.mode === 'frame' && cj.file === framePick.file && Math.abs(cj.timeSec - 61 / 30) < 1e-3 && !('cover' in JSON.parse(readFileSync(join(proj, 'script.json'), 'utf8'))), JSON.stringify({ mode: cj.mode, file: cj.file, t: cj.timeSec }))
    const pack = await api('POST', 'publish-pack', { projectDir: proj, platform: 'bilibili' })
    check('publish pack copies the picked frame as cover.png', pack.json.cover?.mode === 'frame' && sha(join(proj, 'publish', 'bilibili-pack', 'cover.png')) === sha(join(proj, framePick.file)), JSON.stringify(pack.json.cover))
    // the film is re-rendered: the same moment is re-extracted from the new film
    await makeFilm(proj, { bars: 'smptebars' })
    const mp4 = join(proj, 'output', 'final.mp4')
    const tNew = new Date(Date.now() + 5000)
    utimesSync(mp4, tNew, tNew)
    const pack2 = await api('POST', 'publish-pack', { projectDir: proj, platform: 'bilibili' })
    check('after a re-render the pack re-extracts the picked moment from the new film', pack2.json.cover?.mode === 'frame' && pack2.json.cover.refreshed === true && Math.abs(pack2.json.cover.timeSec - 61 / 30) < 1e-3, JSON.stringify(pack2.json.cover))
    const st = await api('GET', 'publish-pack/cover', null, { projectDir: proj })
    for (let i = 0; i < 100 && st.json.auto?.status !== 'ready'; i++) {
      await sleep(150)
      Object.assign(st, await api('GET', 'publish-pack/cover', null, { projectDir: proj }))
    }
    check('auto candidates were recomputed for the new film', st.json.auto?.status === 'ready' && st.json.mp4Sig && st.json.auto.candidates.length >= 8)
  }

  /* ======================================================================================== C. AI cover */
  {
    // 「AI 写提示词」 needs an LLM
    const noLlm = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'ai-prompt', aspect: '3:4' })
    check('AI 写提示词 without an LLM → 400 code need-llm (no network)', noLlm.status === 400 && noLlm.json.code === 'need-llm' && net.llm.length === 0, `${noLlm.status} ${noLlm.json.code}`)
    llm.saveLlmConfig({ mode: 'custom', provider: 'custom', baseUrl: 'https://llm.mock.test/v1', model: 'mock-model', apiKey: 'sk-mock-llm', format: 'openai-completions' })
    const p = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'ai-prompt', aspect: '3:4', platform: 'xiaohongshu', timeSec: 7.0, draft: '骑兵冲锋' })
    const sent = net.llm[0]?.body || {}
    const userMsg = JSON.parse((sent.messages || []).find((m) => m.role === 'user')?.content || '{}')
    check('AI 写提示词 → one LLM call, returns the prompt', p.status === 200 && p.json.prompt === LLM_PROMPT && net.llm.length === 1, `${p.status} ${String(p.json.prompt || p.json.error).slice(0, 40)}`)
    check('the LLM gets title, topic, outline, scenes, the chosen frame (封狼居胥 at 7 s), aspect and the draft', userMsg.title === '冠军侯霍去病' && /封狼居胥/.test(userMsg.topic) && userMsg.outline?.length === 3 && userMsg.scenes?.length === 6 && userMsg.chosenFrame?.sceneTitle === '封狼居胥' && /3:4/.test(userMsg.coverAspect) && userMsg.userDraft === '骑兵冲锋' && /不要出现任何文字/.test(sent.messages.find((m) => m.role === 'system')?.content || ''), JSON.stringify({ t: userMsg.title, f: userMsg.chosenFrame?.sceneTitle, a: userMsg.coverAspect }))

    // no image provider yet
    const noProv = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'ai-generate', prompt: LLM_PROMPT, aspect: '3:4' })
    check('生成封面 without a BYOK image provider → 400 code no-image-provider', noProv.status === 400 && noProv.json.code === 'no-image-provider' && net.image.length === 0, `${noProv.status} ${noProv.json.code}`)
    const st0 = await api('GET', 'publish-pack/cover', null, { projectDir: proj })
    check('state says the image provider is not configured', st0.json.imageProvider?.configured === false)

    // configure a custom image provider (mock) that accepts a reference image
    cloud.saveCloudMediaConfig({
      image: {
        providerId: 'custom-image',
        protocol: 'custom',
        model: 'mock-image-1',
        custom: { submitUrl: 'https://img.mock.test/generate', method: 'POST', mode: 'sync', headersJson: '{"Content-Type":"application/json"}', bodyTemplateJson: '{"prompt":"{{prompt}}","aspect":"{{aspectRatio}}","ref":"{{referenceImage}}"}', resultUrlPath: 'data.0.url', resultFormat: 'url' },
      },
    })
    const st1 = await api('GET', 'publish-pack/cover', null, { projectDir: proj })
    check('state: image provider configured and supports a reference image', st1.json.imageProvider?.configured === true && st1.json.imageProvider.supportsReference === true, JSON.stringify(st1.json.imageProvider))
    const gen = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'ai-generate', prompt: LLM_PROMPT, aspect: '3:4', useReference: true })
    check('生成封面 → background job id', gen.status === 200 && gen.json.async && gen.json.jobId, `${gen.status} ${gen.json.error || ''}`)
    const busy = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'ai-generate', prompt: LLM_PROMPT, aspect: '3:4', useReference: true })
    const job = await waitJob(gen.json.jobId)
    check('a second 生成封面 while one runs is refused (409, no double charge)', busy.status === 409 && busy.json.code === 'cover-job-running', `${busy.status}`)
    const item = job.result?.item || {}
    check('job done → AI cover saved in output/covers/', job.status === 'done' && /^output\/covers\/ai-[\w-]+\.png$/.test(item.file || '') && existsSync(join(proj, item.file || 'x')), `${job.status} ${job.error || ''} ${item.file}`)
    const dims = item.file ? pngSize(join(proj, item.file)) : {}
    check('AI cover is cropped to exactly 3:4 (1536×1024 result → 768×1024)', dims.w === 768 && dims.h === 1024 && item.aspect === '3:4', `${dims.w}x${dims.h}`)
    const sentImg = net.image[0]?.body || {}
    check('the provider got the prompt, aspect 3:4 and the reference frame (image-to-image)', net.image.length === 1 && sentImg.prompt === LLM_PROMPT && sentImg.aspect === '3:4' && /^data:image\/(png|jpeg);base64,/.test(sentImg.ref || '') && item.referenceUsed === true, `hits=${net.image.length} aspect=${sentImg.aspect} ref=${String(sentImg.ref || '').slice(0, 22)}`)
    const ledger = JSON.parse(readFileSync(join(proj, 'output', 'cloud-jobs.json'), 'utf8'))
    check('the paid call is recorded in the cloud ledger; the cover is not added to assets.json / staging', ledger.jobs?.length === 1 && !existsSync(join(proj, '.staging', 'staging.json')) && !(existsSync(join(proj, 'assets.json')) && /ai-raw/.test(readFileSync(join(proj, 'assets.json'), 'utf8'))), `jobs=${ledger.jobs?.length}`)
    const gen2 = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'ai-generate', prompt: LLM_PROMPT, aspect: '3:4', useReference: true })
    const job2 = await waitJob(gen2.json.jobId)
    check('same prompt + aspect + reference again → previous result reused, provider not called again', job2.status === 'done' && job2.result?.reused === true && job2.result.item.file === item.file && net.image.length === 1 && /复用/.test(job2.message), `${job2.status} reused=${job2.result?.reused} hits=${net.image.length}`)
    const gen3 = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'ai-generate', prompt: LLM_PROMPT, aspect: '9:16', useReference: false })
    const job3 = await waitJob(gen3.json.jobId)
    const d3 = job3.result?.item?.file ? pngSize(join(proj, job3.result.item.file)) : {}
    check('9:16 without reference → new paid call, cropped to 9:16, no reference sent', job3.status === 'done' && net.image.length === 2 && net.image[1].body.aspect === '9:16' && !net.image[1].body.ref && Math.abs(d3.w / d3.h - 9 / 16) < 0.01, `${job3.status} ${d3.w}x${d3.h} ${job3.error || ''}`)
    const st2 = await api('GET', 'publish-pack/cover', null, { projectDir: proj })
    check('AI results are listed (newest first), not auto-selected', st2.json.ai?.length === 2 && st2.json.ai[0].aspect === '9:16' && st2.json.cover.mode === 'frame', `${st2.json.ai?.length} ${st2.json.cover.mode}`)

    // select the 3:4 AI cover → the pack uses it
    const sel = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'select', file: item.file })
    check('设为封面 (AI) → cover.json mode ai with prompt / aspect / provider', sel.status === 200 && sel.json.cover.mode === 'ai' && sel.json.cover.prompt === LLM_PROMPT && sel.json.cover.aspect === '3:4' && /mock-image-1/.test(sel.json.cover.provider), JSON.stringify({ m: sel.json.cover.mode, a: sel.json.cover.aspect, p: sel.json.cover.provider }))
    const pack = await api('POST', 'publish-pack', { projectDir: proj, platform: 'xiaohongshu' })
    check('publish pack uses the chosen AI cover', pack.json.cover?.mode === 'ai' && sha(join(proj, 'publish', 'xiaohongshu-pack', 'cover.png')) === sha(join(proj, item.file)), JSON.stringify(pack.json.cover))
    const st3 = await api('GET', 'publish-pack/cover', null, { projectDir: proj })
    check('last-pack info per platform (小红书 = ai, 抖音 = auto)', st3.json.packs?.xiaohongshu?.mode === 'ai' && st3.json.packs?.douyin?.mode === 'auto', JSON.stringify(Object.fromEntries(Object.entries(st3.json.packs || {}).map(([k, v]) => [k, v.mode]))))

    // path safety + delete rules
    const evil = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'select', file: '../script.json' })
    const evil2 = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'select', file: 'C:/Windows/win.ini' })
    const evil3 = await api('POST', 'publish-pack/cover', { projectDir: 'relative/dir', action: 'auto' })
    check('files outside output/covers/ and relative project dirs are refused (400)', evil.status === 400 && evil2.status === 400 && evil3.status === 400, `${evil.status} ${evil2.status} ${evil3.status}`)
    const delCur = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'delete', file: item.file })
    check('the current cover cannot be deleted (409)', delCur.status === 409)
    const delOld = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'delete', file: framePick.file })
    check('a picked frame that is not the cover can be deleted', delOld.status === 200 && !existsSync(join(proj, framePick.file)) && !delOld.json.frames.some((f) => f.file === framePick.file))
  }

  /* ===================================================================================== D. title overlay */
  {
    const tiny = join(SCR, 'titled.png')
    await ff(['-f', 'lavfi', '-i', 'color=c=red:s=300x400', '-frames:v', '1', tiny])
    const dataUrl = `data:image/png;base64,${readFileSync(tiny).toString('base64')}`
    const st = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'title', dataUrl, baseFile: 'output/covers/' + JSON.parse(readFileSync(join(proj, 'output', 'covers', 'cover.json'), 'utf8')).file.split('/').pop(), text: '冠军侯霍去病', position: 'bottom', style: 'shadow' })
    check('title overlay PNG saved and selected (mode title, baseFile kept)', st.status === 200 && st.json.cover.mode === 'title' && st.json.titled?.length === 1 && st.json.cover.titleOverlay?.text === '冠军侯霍去病' && /ai-/.test(st.json.cover.titleOverlay.baseFile) && existsSync(join(proj, st.json.cover.file)), `${st.status} ${st.json.error || ''}`)
    const bad = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'title', dataUrl: 'data:image/png;base64,AAAA', text: 'x' })
    check('a broken PNG upload is refused (400)', bad.status === 400)
    const autoBack = await api('POST', 'publish-pack/cover', { projectDir: proj, action: 'auto' })
    check('恢复默认 → mode auto again', autoBack.status === 200 && autoBack.json.cover.mode === 'auto' && autoBack.json.cover.effective.mode === 'auto')
    const font = await handleWorkbenchApiRequest(new Request('http://127.0.0.1/api/video-workbench/publish-pack/cover?font=sans'))
    check('GET ?font=sans serves the bundled Noto Sans SC woff2 for the title canvas', font.status === 200 && /woff2/.test(font.headers.get('content-type') || '') && Number((await font.arrayBuffer()).byteLength) > 100000)
  }

  /* ===================================================================================== E. stock API keys */
  {
    const cm0 = await api('GET', 'cloud-media')
    check('no stock key anywhere → both 未配置', cm0.json.config?.stock?.pexels?.configured === false && cm0.json.config.stock.pixabay.configured === false && cm0.json.config.stock.pexels.sourceLabel === '未配置')
    const s0 = await api('POST', 'project/stock/search', { query: '骑兵' })
    check('search without keys → 未配置 with UI instructions (no network)', s0.json.configured === false && /免费素材/.test(s0.json.message) && net.pexels.length === 0 && net.pixabay.length === 0, String(s0.json.message).slice(0, 60))

    const saved = await api('POST', 'cloud-media', { stock: { pexelsApiKey: PEXELS_KEY } })
    const px = saved.json.config?.stock?.pexels || {}
    check('save the Pexels key from the Studio → masked summary, source saved', saved.status === 200 && px.configured && px.source === 'saved' && px.savedKeyMasked === `${PEXELS_KEY.slice(0, 4)}***${PEXELS_KEY.slice(-4)}`, JSON.stringify(px))
    const stateResp = await api('GET', 'state', null, { projectDir: proj })
    const leaked = [saved.text, (await api('GET', 'cloud-media')).text, stateResp.text].some((t) => t.includes(PEXELS_KEY))
    check('the key never appears in cloud-media / state responses', !leaked && stateResp.status === 200)
    const fileCfg = JSON.parse(readFileSync(process.env.DSH_VIDEO_CLOUD_MEDIA_CONFIG, 'utf8'))
    check('the key is stored in the (scratch) cloud-media config, stock section', fileCfg.stock?.pexelsApiKey === PEXELS_KEY)

    for (const v of ['KEEP_EXISTING', '', '   ', px.savedKeyMasked]) await api('POST', 'cloud-media', { stock: { pexelsApiKey: v } })
    await api('POST', 'cloud-media', { image: { providerId: 'custom-image', protocol: 'custom' }, autoUseCloudBroll: false })
    check('KEEP_EXISTING / empty / masked values and saving other cloud settings keep the stored key', JSON.parse(readFileSync(process.env.DSH_VIDEO_CLOUD_MEDIA_CONFIG, 'utf8')).stock?.pexelsApiKey === PEXELS_KEY)
    const badKey = await api('POST', 'cloud-media', { stock: { pixabayApiKey: 'has a space' } })
    check('a key with spaces is refused with a readable message', badKey.status >= 400 && /不能包含空格/.test(badKey.json.error || ''), `${badKey.status} ${badKey.json.error}`)

    // search works immediately after saving (no restart) with the saved key
    const s1 = await api('POST', 'project/stock/search', { query: '骑兵', provider: 'pexels' })
    check('search works right after saving (Authorization = the saved key)', s1.status === 200 && s1.json.ok && s1.json.results?.length === 1 && net.pexels.at(-1)?.auth === PEXELS_KEY, `${s1.status} ${s1.json.message}`)

    // 「测试连接」
    const tOk = await api('POST', 'publish-pack/cover', { action: 'stock-test', provider: 'pexels' })
    check('测试连接 (saved Pexels key) → ok, one /v1/curated request, key not echoed', tOk.json.ok === true && tOk.json.source === 'saved' && net.pexels.at(-1)?.path === '/v1/curated' && !tOk.text.includes(PEXELS_KEY), `${tOk.json.message}`)
    const tBad = await api('POST', 'publish-pack/cover', { action: 'stock-test', provider: 'pexels', apiKey: ['typed', 'wrong', 'key', '0'.repeat(13)].join('-') })
    check('测试连接 with a typed wrong key → invalidKey, readable message, key not echoed', tBad.json.ok === false && tBad.json.invalidKey === true && tBad.json.source === 'typed' && /无效/.test(tBad.json.message) && !tBad.text.includes('typed-wrong-key'), tBad.json.message)
    const tNone = await api('POST', 'publish-pack/cover', { action: 'stock-test', provider: 'pixabay' })
    check('测试连接 without any Pixabay key → says to paste one first (no request)', tNone.json.ok === false && tNone.json.configured === false && net.pixabay.length === 0)

    // .env fallback, shown as 来自 .env; a saved key wins over .env; clearing falls back to .env again
    writeFileSync(envFile, `PIXABAY_API_KEY=${PIXABAY_ENV_KEY}\n`)
    delete process.env.PIXABAY_API_KEY
    shared.loadEnv(true)
    const cm1 = (await api('GET', 'cloud-media')).json.config.stock.pixabay
    check('.env key still works and is shown as 来自 .env', cm1.configured && cm1.source === 'env' && cm1.sourceLabel === '来自 .env' && cm1.hasEnvKey && !JSON.stringify(cm1).includes(PIXABAY_ENV_KEY), JSON.stringify(cm1))
    const tEnv = await api('POST', 'publish-pack/cover', { action: 'stock-test', provider: 'pixabay' })
    check('测试连接 uses the .env key when nothing is saved', tEnv.json.ok === true && tEnv.json.source === 'env' && net.pixabay.at(-1)?.key === PIXABAY_ENV_KEY, tEnv.json.message)
    await api('POST', 'cloud-media', { stock: { pixabayApiKey: PIXABAY_SAVED_KEY } })
    const cm2 = (await api('GET', 'cloud-media')).json.config.stock.pixabay
    const s2 = await api('POST', 'project/stock/search', { query: '城市', provider: 'pixabay', mediaType: 'image' })
    check('a saved key takes precedence over .env (已保存（优先于 .env）)', cm2.source === 'saved' && /优先于 \.env/.test(cm2.sourceLabel) && s2.json.ok && net.pixabay.at(-1)?.key === PIXABAY_SAVED_KEY, `${cm2.sourceLabel} ${s2.json.message}`)
    await api('POST', 'cloud-media', { stock: { clearPixabay: true } })
    const cm3 = (await api('GET', 'cloud-media')).json.config.stock.pixabay
    check('clearing the saved key falls back to the .env key', cm3.source === 'env' && !cm3.hasSavedKey && cm3.configured)
    const cleared = await api('POST', 'cloud-media', { stock: { clearPexels: true } })
    check('clearing the Pexels key → 未配置', cleared.json.config.stock.pexels.configured === false && !JSON.parse(readFileSync(process.env.DSH_VIDEO_CLOUD_MEDIA_CONFIG, 'utf8')).stock.pexelsApiKey)
  }

  check('no request ever left the mocks', net.other.length === 0, net.other.join(', '))
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — FAILED: ${failed.map((f) => f.name).join(' | ')}` : ''}`)
  exitCode = failed.length ? 1 : 0
} catch (err) {
  console.error('TEST CRASHED:', err?.stack || err)
  exitCode = 1
} finally {
  if (!KEEP) {
    try {
      rmSync(SCR, { recursive: true, force: true })
    } catch {}
  } else console.log(`scratch kept: ${SCR}`)
}
process.exit(exitCode)
