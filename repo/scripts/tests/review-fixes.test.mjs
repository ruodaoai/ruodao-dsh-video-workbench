#!/usr/bin/env node
/**
 * Regression tests for the v0.6.0 pre-release review fixes in the studio server and the script pipeline:
 *   F1  the local studio API refuses requests from other websites (Origin / Sec-Fetch-Site / DNS-rebinding Host)
 *   F6  an upload cut off mid-way no longer takes the whole studio process down
 *   F4  `$1` / `$'` / `</script>` typed in narration no longer corrupt the script data embedded in index.html
 *   F5  narration the user writes (even when it quotes their own brief) is saved as written; AI echoes are still scrubbed
 *   F7  an async 指哪改哪 refine no longer reverts edits the user saved while it was running
 *   F14 a brief-only `update-format` (the war room's debounced brief save) keeps the project canvas
 *   F15 a stalled FFmpeg (progress report stuck) is stopped by the watchdog; the master mix has no lavfi input
 *
 *   node scripts/tests/review-fixes.test.mjs
 *
 * Scratch data only (<repo>/.tmp/review-fixes/<stamp>, removed at the end without following links); the real `.env` is
 * never loaded; network is blocked (the refine test uses an in-process mock of an OpenAI-compatible endpoint).
 */
import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { connect, createServer as createNetServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const SCR = join(ROOT, '.tmp', 'review-fixes', stamp)
const dirs = { ws: join(SCR, 'ws'), home: join(SCR, 'home'), voices: join(SCR, 'voices'), client: join(SCR, 'client'), outside: join(SCR, 'outside') }
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true })
const emptyEnv = join(SCR, 'empty.env')
writeFileSync(emptyEnv, '# intentionally empty\n')
const SCRATCH_ENV = {
  DSH_VIDEO_ENV_PATH: emptyEnv,
  DSH_VIDEO_WORKSPACE: dirs.ws,
  DSH_VIDEO_HOME: dirs.home,
  VOICE_PACKS_DIR: dirs.voices,
  DSH_CLIENT_HOME: dirs.client,
  DSH_HOME: dirs.client,
  PEXELS_API_KEY: '',
  PIXABAY_API_KEY: '',
}
Object.assign(process.env, SCRATCH_ENV)
const realFetch = globalThis.fetch
const blockNetwork = () => {
  globalThis.fetch = async (input) => {
    throw new Error(`network blocked in tests: ${typeof input === 'string' ? input : input?.url || input}`)
  }
}
blockNetwork()

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href)

const shared = await imp('packages/shared/index.js')
const { handleWorkbenchApiRequest: handler } = await imp('packages/dsh-web-video-workbench/lib/index.js')
const call = async (method, path, { query = {}, body } = {}) => {
  const url = new URL(`http://127.0.0.1:4399${path}`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))
  const init = { method, headers: {} }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers['Content-Type'] = 'application/json'
  }
  const res = await handler(new Request(url.href, init))
  const ct = res.headers.get('content-type') || ''
  return { status: res.status, data: ct.includes('json') ? await res.json() : null }
}
const readScript = (dir) => JSON.parse(readFileSync(join(dir, 'script.json'), 'utf8'))
const makeProject = (dir, script = {}) => {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'script.json'),
    JSON.stringify(
      {
        title: 'review fixes',
        engine: 'html',
        fps: 30,
        width: 1920,
        height: 1080,
        scenes: [
          { id: 'scene-01', title: '清晨老街', narration: 'first scene narration', durationSec: 3, durationInFrames: 90 },
          { id: 'scene-02', title: 'two', narration: 'second scene narration', durationSec: 3, durationInFrames: 90 },
        ],
        ...script,
      },
      null,
      2,
    ),
  )
}
const { ffmpeg } = shared.resolveBinaries()
const tinyWav = async (path) => {
  mkdirSync(dirname(path), { recursive: true })
  await shared.runCommandRedirected(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=24000:duration=1', path], { timeoutMs: 60_000 })
}

try {
  // ------------------------------------------------------------------------------------------------------------- F4
  {
    const proj = join(dirs.ws, 'dollar')
    makeProject(proj, {
      scenes: [
        { id: 'scene-01', title: 'Plans', narration: 'Start for $1 today, upgrade for $2 a month.', durationSec: 3, durationInFrames: 90 },
        { id: 'scene-02', title: 'Deal', narration: "Save 20% - that's $'s worth </script><!-- of value.", durationSec: 3, durationInFrames: 90 },
      ],
    })
    writeFileSync(join(proj, 'index.html'), '<!doctype html><html><head><script id="dsh-script-data" type="application/json">{}</script></head><body><main id="stage"></main></body></html>')
    const r = await call('POST', '/api/video-workbench/project/scene-lock', { body: { projectDir: proj, sceneId: 'scene-01' } })
    const html = readFileSync(join(proj, 'index.html'), 'utf8')
    const m = html.match(/<script\s+id=["']dsh-script-data["']\s+type=["']application\/json["']>([\s\S]*?)<\/script>/i)
    let parsed = null
    try {
      parsed = JSON.parse(m?.[1] || '')
    } catch {}
    check(
      "F4 `$1` / `$'` / `</script>` in narration keep the embedded script data intact",
      r.status === 200 &&
        parsed?.scenes?.[0]?.narration === 'Start for $1 today, upgrade for $2 a month.' &&
        String(parsed?.scenes?.[1]?.narration || '').includes("$'s worth </script><!--") &&
        (html.match(/<main/g) || []).length === 1,
      `HTTP ${r.status}; parsed=${Boolean(parsed)}; <main ×${(html.match(/<main/g) || []).length}`,
    )
  }

  // ------------------------------------------------------------------------------------------------------------- F5
  {
    const proj = join(dirs.ws, 'brief-quote')
    const quoted = '清晨的薄雾笼罩着青石板路，老街的豆浆铺升起第一缕炊烟。'
    makeProject(proj, { goal: `做一条老街早晨的短片。旁白我已经写好了：${quoted}画面要温暖。` })
    // the editors' save: fresh script → POST script → record the override from the reply
    const s = readScript(proj)
    s.scenes[0].narration = quoted
    const saved = await call('POST', '/api/video-workbench/script', { body: { projectDir: proj, script: s, regenerateCode: false } })
    const replyNarr = saved.data?.script?.scenes?.[0]?.narration
    const rec = await call('POST', '/api/video-workbench/project/scene-overrides/batch', { body: { projectDir: proj, edits: { 'scene-01': { narration: replyNarr } } } })
    const after = readScript(proj)
    check(
      'F5 a narration the user writes is saved as written even when it quotes their brief',
      saved.status === 200 && replyNarr === quoted && rec.status === 200 && after.scenes[0].narration === quoted,
      `reply="${replyNarr}" disk="${after.scenes[0].narration}"`,
    )
    // a later unrelated write keeps it (the recorded override protects it from then on)
    await call('POST', '/api/video-workbench/project/scene-lock', { body: { projectDir: proj, sceneId: 'scene-02' } })
    check('F5 … and later writes keep it', readScript(proj).scenes[0].narration === quoted, readScript(proj).scenes[0].narration)
    // the gate still protects AI output: a pipeline write that echoes the director notes is scrubbed
    const ai = join(dirs.ws, 'ai-echo')
    const notes = '导演备注：整体节奏舒缓，镜头多用推拉，色调偏暖，结尾留三秒空镜给品牌标志，不要出现价格信息。'
    makeProject(ai, { directorNotes: notes })
    const sc = readScript(ai)
    sc.scenes[1].narration = notes
    shared.writeScriptJson(ai, sc)
    check('F5 the brief-leak gate still scrubs AI narration that echoes the director notes', readScript(ai).scenes[1].narration !== notes, `narration="${readScript(ai).scenes[1].narration}"`)
  }

  // ------------------------------------------------------------------------------------------------------------ F14
  {
    await tinyWav(join(dirs.voices, 'builtin', 'female-narrator.wav'))
    const c = await call('POST', '/api/video-workbench/projects', { body: { title: '城市夜景延时摄影', aspectRatio: 'auto' } })
    const proj = c.data?.projectDir
    const src = join(dirs.outside, 'phone')
    mkdirSync(src, { recursive: true })
    for (const n of ['IMG_0001.png', 'IMG_0002.png']) {
      await shared.runCommandRedirected(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:size=1080x1920', '-frames:v', '1', join(src, n)], { timeoutMs: 60_000 })
    }
    await call('POST', '/api/video-workbench/assets/import', { body: { projectDir: proj, sources: [src] } })
    const s1 = readScript(proj)
    const u = await call('POST', '/api/video-workbench/action', { body: { projectDir: proj, action: 'update-format', goal: '城市夜景延时摄影，霓虹与车流，节奏舒缓。', displayTitle: '城市夜景' } })
    const s2 = readScript(proj)
    check(
      'F14 a brief-only update-format keeps the canvas',
      u.status === 200 && s2.width === s1.width && s2.height === s1.height && String(s2.goal || '').startsWith('城市夜景'),
      `${s1.width}x${s1.height} -> ${s2.width}x${s2.height}`,
    )
    const v = await call('POST', '/api/video-workbench/action', { body: { projectDir: proj, action: 'update-format', aspectRatio: '9:16' } })
    const s3 = readScript(proj)
    check('F14 an explicit aspect-ratio change still resizes the canvas', v.status === 200 && s3.width < s3.height, `${s3.width}x${s3.height}`)
  }

  // ------------------------------------------------------------------------------------------------------------- F7
  {
    Object.assign(process.env, {
      LLM_MODE: 'custom',
      LLM_BASE_URL: 'http://127.0.0.1:59999/v1', // never contacted: fetch is mocked below
      LLM_MODEL: 'mock-model',
      LLM_FORMAT: 'openai-completions',
      LLM_API_KEY: 'mock',
      LLM_MAX_REPAIR_ROUNDS: '1',
    })
    const created = await call('POST', '/api/video-workbench/projects', { body: { title: 'refine race demo', engine: 'html' } })
    const proj = created.data?.projectDir
    const page = readFileSync(join(proj, 'index.html'), 'utf8').replace(
      /<\/head>/i,
      '<script id="dsh-script-data" type="application/json">{}</script><script>window.__totalFrames = 180; window.__seekToFrame = function (f) { return f };</script></head>',
    )
    const before = readScript(proj)
    const firstId = before.scenes[0].id
    const secondId = before.scenes[1]?.id || firstId
    let llmCalls = 0
    let release
    const gate = new Promise((r) => (release = r))
    globalThis.fetch = async (input) => {
      const url = String(typeof input === 'string' ? input : input?.url)
      if (!url.startsWith('http://127.0.0.1:59999')) throw new Error(`network blocked in tests: ${url}`)
      llmCalls++
      await gate
      const content = JSON.stringify({ files: { 'index.html': page }, summary: 'mock refine' })
      return new Response(JSON.stringify({ id: 'mock', choices: [{ index: 0, message: { role: 'assistant', content } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const job = await call('POST', '/api/video-workbench/project/refine', { body: { projectDir: proj, instruction: '把这一幕的标题改成红色', sceneId: firstId, async: true, render: false } })
    for (let i = 0; i < 400 && llmCalls === 0; i++) await sleep(25)
    const fresh = readScript(proj)
    const mine = '这是用户在精修进行中手动改写的第二幕旁白'
    fresh.scenes.find((s) => s.id === secondId).narration = mine
    await call('POST', '/api/video-workbench/script', { body: { projectDir: proj, script: fresh, regenerateCode: false } })
    await call('POST', '/api/video-workbench/project/scene-overrides/batch', { body: { projectDir: proj, edits: { [secondId]: { narration: mine } } } })
    release()
    let st = null
    for (let i = 0; i < 900; i++) {
      st = (await call('GET', '/api/video-workbench/jobs', { query: { id: job.data?.jobId } })).data?.job
      if (st && st.status !== 'running') break
      await sleep(100)
    }
    const after = readScript(proj)
    check(
      'F7 an async refine keeps the edits saved while it was running',
      llmCalls > 0 &&
        st?.status === 'done' &&
        after.scenes.find((s) => s.id === secondId).narration === mine &&
        after.userOverrides?.[secondId]?.narration === mine &&
        Boolean(after.aiMeta?.lastRefineInstruction),
      `job=${st?.status}; narration="${after.scenes.find((s) => s.id === secondId).narration}"`,
    )
    blockNetwork()
  }

  // ------------------------------------------------------------------------------------------------------- F1 + F6
  {
    const port = await new Promise((r) => {
      const s = createNetServer()
      s.listen(0, '127.0.0.1', () => {
        const p = s.address().port
        s.close(() => r(p))
      })
    })
    const proc = spawn(process.execPath, [join(ROOT, 'scripts', 'dsh-runner.mjs'), 'video', '--keep-alive'], {
      cwd: ROOT,
      // DSH_VIDEO_SKIP_PROFILE_MOUNT: a test run must never re-point the user's DSH profiles at this checkout
      // isolated: never reuse / disturb a studio of this checkout the user may be running
      env: { ...process.env, ...SCRATCH_ENV, DSH_VIDEO_PORT: String(port), DSH_VIDEO_SKIP_PROFILE_MOUNT: '1', DSH_VIDEO_RUNNER_ISOLATED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let exited = null
    proc.on('exit', (code) => (exited = code))
    proc.stdout.resume()
    proc.stderr.resume()
    const hit = (path, { method = 'GET', headers = {}, body = null } = {}) =>
      new Promise((done) => {
        const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
          res.resume()
          res.on('end', () => done(res.statusCode))
        })
        req.on('error', () => done(0))
        if (body) req.write(body)
        req.end()
      })
    try {
      let up = 0
      for (let i = 0; i < 80 && up !== 200; i++) {
        up = await hit('/api/video-workbench/runner-info')
        if (up !== 200) await sleep(500)
      }
      const own = await hit('/api/video-workbench/state', { headers: { Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' } })
      const tool = await hit('/api/video-workbench/state')
      const evil = await hit('/api/video-workbench/projects', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'text/plain' }, body: '{"title":"csrf"}' })
      const nul = await hit('/api/video-workbench/projects', { method: 'POST', headers: { Origin: 'null' }, body: '{}' })
      const img = await hit('/api/video-workbench/state', { headers: { 'Sec-Fetch-Site': 'cross-site' } })
      const rebind = await hit('/api/video-workbench/state', { headers: { Host: `attacker.example:${port}` } })
      check('F1 the studio page and local tools can use the API', up === 200 && own === 200 && tool === 200, `runner=${up} page=${own} tool=${tool}`)
      check(
        'F1 requests from other websites are refused (Origin, null Origin, Sec-Fetch-Site, DNS rebinding)',
        evil === 403 && nul === 403 && img === 403 && rebind === 403,
        `evil=${evil} null=${nul} cross-site=${img} rebind=${rebind}`,
      )
      await new Promise((done) => {
        const sock = connect(port, '127.0.0.1', () => {
          sock.write(`POST /api/video-workbench/assets/upload?projectDir=x&fileName=a.mp4 HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/octet-stream\r\nContent-Length: 52428800\r\n\r\n`)
          sock.write(Buffer.alloc(1024 * 1024, 7))
          setTimeout(() => {
            sock.destroy()
            done()
          }, 300)
        })
        sock.on('error', done)
      })
      await sleep(1500)
      const after = await hit('/api/video-workbench/runner-info')
      check('F6 the studio survives an upload cut off mid-way', exited === null && after === 200, `exited=${exited} status=${after}`)
    } finally {
      await hit('/api/video-workbench/runner-stop', { method: 'POST' })
      await sleep(600)
      if (exited === null) proc.kill()
    }
  }

  // ------------------------------------------------------------------------------------------------------------- F15
  {
    // stand-ins for FFmpeg: print progress reports to stderr like FFmpeg does (same `time=` forever / advancing / none)
    const fake = (body) => ["-e", `const w = (t) => process.stderr.write('size=       1KiB time=' + t + ' bitrate=   1.0kbits/s speed=1.0x    \\r'); ${body}`]
    const run = async (args, opts) => {
      const t0 = Date.now()
      try {
        const r = await shared.runCommandRedirected(process.execPath, args, { timeoutMs: 20_000, ...opts })
        return { code: r.code, ms: Date.now() - t0 }
      } catch (e) {
        return { err: e?.code || e?.message, msg: String(e?.message || ''), ms: Date.now() - t0 }
      }
    }
    const stuck = await run(fake("w('00:00:02.90'); setInterval(() => w('00:00:02.90'), 200)"), { stallTimeoutMs: 1200 })
    check('F15 a command whose FFmpeg progress stops advancing is stopped as stalled', stuck.err === 'ESTALLED' && stuck.ms < 8000 && /time=00:00:02\.90/.test(stuck.msg), `${stuck.err} after ${stuck.ms} ms`)
    const moving = await run(fake("let s = 0; const t = setInterval(() => { s += 1; w('00:00:' + String(s).padStart(2, '0') + '.00'); if (s >= 9) { clearInterval(t); process.exit(0) } }, 250)"), { stallTimeoutMs: 1200 })
    check('F15 a command that keeps making progress is never cut short by the watchdog', moving.code === 0 && !moving.err, JSON.stringify(moving))
    const silent = await run(fake('setInterval(() => {}, 1000)'), { stallTimeoutMs: 600, stallStartupMs: 1500 })
    check('F15 a command that never reports progress is stopped after the start-up allowance', silent.err === 'ESTALLED' && silent.ms >= 1400 && silent.ms < 8000, `${silent.err} after ${silent.ms} ms`)
    const plain = await run(fake("w('00:00:01.00'); setTimeout(() => process.exit(0), 1800)"), {})
    check('F15 without stallTimeoutMs nothing changes', plain.code === 0 && !plain.err, JSON.stringify(plain))
    // the master mix generates its silent base inside the filter graph (a `-f lavfi` input there deadlocked FFmpeg 7.x)
    const synth = readFileSync(join(ROOT, 'packages', 'dsh-tool-media', 'audio-synth.js'), 'utf8')
    const mixSrc = synth.slice(synth.indexOf('export async function mixVideoAudio'))
    check('F15 the master mix has no lavfi input and retries a stalled run', !/'-f',\s*'lavfi'/.test(mixSrc) && /\[base\]/.test(mixSrc) && /stallTimeoutMs/.test(mixSrc) && /ESTALLED/.test(mixSrc))
  }
} catch (err) {
  check('review-fixes suite', false, err?.stack || err)
} finally {
  globalThis.fetch = realFetch
  // remove the scratch tree without following links / junctions
  const walk = (p) => {
    let st
    try {
      st = lstatSync(p)
    } catch {
      return
    }
    if (st.isSymbolicLink() || !st.isDirectory()) {
      try {
        unlinkSync(p)
      } catch {
        try {
          rmdirSync(p)
        } catch {}
      }
      return
    }
    for (const n of readdirSync(p)) walk(join(p, n))
    try {
      rmdirSync(p)
    } catch {}
  }
  if (existsSync(SCR)) walk(SCR)
}
const failed = results.filter((r) => !r.ok).length
console.log(`review-fixes: ${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
