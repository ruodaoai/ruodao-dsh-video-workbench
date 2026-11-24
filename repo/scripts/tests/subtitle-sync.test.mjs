#!/usr/bin/env node
/**
 * Subtitle-sync regression tests — backend fixes requested by the 「分镜精修」 (studio scenes) panel: subtitle text
 * follows the narration, empty overrides never blank the subtitles, and the 720P quick-review render.
 *
 *   node scripts/tests/subtitle-sync.test.mjs
 *
 * Runs the REAL route handler (`handleWorkbenchApiRequest`) on scratch projects:
 *  1. a re-dub after a narration edit (POST action tts-scene, and the MCP path executeGenerateSpeech(scriptPath, sceneId))
 *     re-derives the subtitle chunks from the new narration — the old words never stay on screen;
 *  2. tts-scene, ai-master-voice and project/scene-overrides (+ /batch) keep the global `script.subtitles` track in step
 *     with the scenes (the Remotion composition and the delivery export prefer that track);
 *  3. an empty `subtitleText` override means "follow the narration": the override is dropped, the subtitles stay;
 *  4. 「720P 快速审片」 (action render + draft720p) renders a Remotion project at the draft scale (ffprobe), while a
 *     full-quality render keeps the composition size.
 * TTS: the built-in Windows SAPI engine (`windows-sapi`: no Python server, ~no RAM) stands in for IndexTTS — exactly two
 * short lines are synthesized. Voice mastering runs with useLlm=false. Network is blocked except loopback (Remotion).
 * Isolation: DSH_VIDEO_HOME / DSH_VIDEO_WORKSPACE / VOICE_PACKS_DIR / INDEXTTS_ROOT / GPTVOICE_ROOT / DEFAULT_REF_AUDIO /
 * EXTRA_VOICE_SCAN_DIRS point into the scratch folder <main checkout>/.tmp/openfilm-subtitle-sync/run-<pid>, which is
 * removed at the end without following links / junctions (SUBTITLE_SYNC_KEEP=1 keeps it).
 * Env: SUBTITLE_SYNC_TEST_FILTER=<regex> (run matching tests only), SUBTITLE_SYNC_SKIP_RENDER=1 (skip the Remotion render),
 *      DSH_VIDEO_ENV_PATH (defaults to the main checkout's .env: ffmpeg / Remotion / browser paths only).
 */
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const MAIN_CHECKOUT = /[\\/]\.claude[\\/]worktrees[\\/]/.test(REPO) ? resolve(REPO, '..', '..', '..') : REPO
if (!process.env.DSH_VIDEO_ENV_PATH) {
  const envCandidate = [join(REPO, '.env'), join(MAIN_CHECKOUT, '.env')].find((p) => existsSync(p))
  if (envCandidate) process.env.DSH_VIDEO_ENV_PATH = envCandidate
}
const SCRATCH_ROOT = resolve(join(MAIN_CHECKOUT, '.tmp', 'openfilm-subtitle-sync'))
const SCRATCH = join(SCRATCH_ROOT, `run-${process.pid}`)
const SKIP_RENDER = process.env.SUBTITLE_SYNC_SKIP_RENDER === '1'
const FILTER = process.env.SUBTITLE_SYNC_TEST_FILTER ? new RegExp(process.env.SUBTITLE_SYNC_TEST_FILTER, 'i') : null

// ------------------------------------------------------------------------------------------ isolation (before imports)
const dirs = {
  home: join(SCRATCH, 'dsh-home'),
  ws: join(SCRATCH, 'workspace'),
  voices: join(SCRATCH, 'voice-packs'),
  idx: join(SCRATCH, 'tts-roots', 'indextts'),
  gpt: join(SCRATCH, 'tts-roots', 'gptvoice'),
  extra: join(SCRATCH, 'tts-roots', 'extra'),
}
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true })
// `.env` never overrides a variable that is already set (non-empty), so these win over the user's real paths
process.env.DSH_VIDEO_HOME = dirs.home
process.env.DSH_VIDEO_WORKSPACE = dirs.ws
process.env.VOICE_PACKS_DIR = dirs.voices
process.env.INDEXTTS_ROOT = dirs.idx
process.env.GPTVOICE_ROOT = dirs.gpt
process.env.EXTRA_VOICE_SCAN_DIRS = dirs.extra
process.env.DEFAULT_REF_AUDIO = join(SCRATCH, 'no-default-ref.wav')
process.env.TTS_ALLOW_PLACEHOLDER = '0'
// Kill switch: the local IndexTTS / GPT-SoVITS servers (2–3 GB RAM) can never be started from this test —
// their python is a path that does not exist, so a wrong engine id fails at once instead of loading models
process.env.INDEXTTS_PYTHON = join(SCRATCH, 'python-disabled', 'python.exe')
process.env.GPTVOICE_PYTHON = join(SCRATCH, 'python-disabled', 'python.exe')
const SAPI = 'windows-sapi-cpu'
process.env.DEFAULT_TTS_ENGINE = SAPI
// Network guard: loopback only (Remotion talks to its own local server); the local TTS servers are never contacted
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url || String(input)
  if (/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?\//i.test(url) && !/:(?:9880|9881)\//.test(url)) return realFetch(input, init)
  throw new Error(`[subtitle-sync] network request blocked: ${url}`)
}

const imp = (rel) => import(pathToFileURL(join(REPO, rel)).href)
const shared = await imp('packages/shared/index.js')
const tts = await imp('packages/dsh-tool-local-tts/index.js')
const locks = await imp('packages/dsh-tool-media/scene-locks.js')
const { handleWorkbenchApiRequest } = await imp('packages/dsh-web-video-workbench/lib/index.js')
const { readScriptJson, writeScriptJson, resolveBinaries, runCommandRedirected } = shared
const { ffmpeg, ffprobe } = resolveBinaries()

// ------------------------------------------------------------------------------------------ harness
const results = []
async function test(name, fn, { skip = false } = {}) {
  if (FILTER && !FILTER.test(name)) return
  if (skip) {
    results.push({ name, status: 'skip' })
    console.log(`SKIP ${name}`)
    return
  }
  const t0 = Date.now()
  try {
    await fn()
    results.push({ name, status: 'pass', ms: Date.now() - t0 })
    console.log(`PASS ${name} (${Date.now() - t0} ms)`)
  } catch (err) {
    results.push({ name, status: 'fail', ms: Date.now() - t0, err })
    console.log(`FAIL ${name} (${Date.now() - t0} ms)\n    ${String(err?.stack || err).split('\n').slice(0, 8).join('\n    ')}`)
  }
}

function safeRemove(target) {
  const abs = resolve(target)
  if (!abs.startsWith(SCRATCH_ROOT)) throw new Error(`refusing to delete outside scratch: ${abs}`)
  const walk = (p) => {
    let st
    try {
      st = lstatSync(p)
    } catch {
      return
    }
    if (st.isSymbolicLink() || !st.isDirectory()) {
      // Junctions / symlinks (e.g. a project's node_modules → shared deps) are unlinked, never descended
      try {
        unlinkSync(p)
      } catch {
        try {
          rmdirSync(p)
        } catch {}
      }
      return
    }
    for (const name of readdirSync(p)) walk(join(p, name))
    try {
      rmdirSync(p)
    } catch {}
  }
  walk(abs)
}

async function ff(args) {
  const res = await runCommandRedirected(ffmpeg, ['-y', '-hide_banner', '-v', 'error', ...args], { timeoutMs: 60_000 })
  assert.equal(res.code, 0, `ffmpeg failed: ${args.join(' ')}\n${res.stderr}`)
}
async function videoSize(file) {
  const res = await runCommandRedirected(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file], { timeoutMs: 30_000 })
  const s = (JSON.parse(res.stdout || '{}').streams || [])[0] || {}
  return { width: Number(s.width), height: Number(s.height) }
}

async function api(path, body, method = 'POST') {
  const req = new Request(`http://127.0.0.1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  })
  const res = await handleWorkbenchApiRequest(req)
  assert.ok(res, `no response for ${path}`)
  const data = await res.json()
  return { status: res.status, data }
}
async function apiOk(path, body) {
  const { status, data } = await api(path, body)
  assert.ok(data && data.ok === true, `${path} failed (${status}): ${data?.error || JSON.stringify(data).slice(0, 300)}`)
  return data
}

const plain = (t) => String(t || '').replace(/[\s\p{P}\p{S}]/gu, '')
const subTexts = (sc) => (sc?.subtitles || []).map((s) => s.text)
const sceneOf = (script, id) => (script.scenes || []).find((s) => s.id === id)
const load = (dir) => readScriptJson(dir).data

/**
 * Independent oracle for the global track: every non-empty scene-local cue placed at its scene's position (cumulative
 * scene frames), clamped to the scene. The test builds the initial track the same way the pipeline does.
 */
function expectedGlobal(script) {
  const out = []
  let f0 = 0
  for (const sc of script.scenes || []) {
    const dur = Number(sc.durationInFrames)
    for (const sub of sc.subtitles || []) {
      if (!String(sub?.text || '').trim()) continue
      const sf = Math.max(0, Math.min(dur, Number(sub.startFrame)))
      const ef = Math.max(0, Math.min(dur, Number(sub.endFrame)))
      if (!(ef > sf)) continue
      out.push({ sceneId: sc.id, text: sub.text, sf: f0 + sf, ef: f0 + ef })
    }
    f0 += dur
  }
  return out
}
function assertGlobalInSync(script, label) {
  assert.ok(Array.isArray(script.subtitles) && script.subtitles.length > 0, `${label}: global subtitle track missing`)
  const got = script.subtitles.map((s) => ({
    sceneId: s.sceneId,
    text: s.text,
    sf: Number(s.globalStartFrame ?? s.startFrame),
    ef: Number(s.globalEndFrame ?? s.endFrame),
  }))
  assert.deepEqual(got, expectedGlobal(script), `${label}: global script.subtitles out of step with the scenes`)
}
function seedGlobalTrack(dir) {
  const { data } = readScriptJson(dir)
  const fps = Number(data.fps) || 30
  data.subtitles = expectedGlobal(data).map((e) => ({
    text: e.text,
    sceneId: e.sceneId,
    startFrame: e.sf,
    endFrame: e.ef,
    startSec: Number((e.sf / fps).toFixed(3)),
    endSec: Number((e.ef / fps).toFixed(3)),
    globalStartFrame: e.sf,
    globalEndFrame: e.ef,
    globalStartSec: Number((e.sf / fps).toFixed(3)),
    globalEndSec: Number((e.ef / fps).toFixed(3)),
  }))
  writeScriptJson(dir, data)
}

// ------------------------------------------------------------------------------------------ fixtures
const VOICE_ID = 'subsync-test-voice'
const N1 = '欢迎来到咖啡小课堂。'
const OLD2 = '今天我们一起学习如何在家里做一杯香浓的拿铁咖啡，只需要三分钟。'
const NEW2 = '今天我们一起学习如何在家里做一杯香浓的摩卡咖啡，只需要五分钟。'
const N3 = '下次再见，记得点赞关注。'
const N3B = '下次再见，记得点赞收藏。'
const PROJ = join(dirs.ws, 'coffee-class')
const cues = (sc) => (sc?.subtitles || []).map((x) => [x.text, x.startFrame, x.endFrame])
let fixtureScene01Cues = null

await test('fixture: scratch voice catalog + project with a global subtitle track (stale-able chunks)', async () => {
  // never fall back to the IndexTTS default (an unknown engine id resolves to indextts25)
  assert.equal(tts.resolveTtsEngineSpec(SAPI).kind, 'windows-sapi', 'the light Windows SAPI engine is available')
  assert.equal(tts.getActiveTtsEngineId(), SAPI)
  const ref = join(dirs.voices, 'builtin', `${VOICE_ID}.wav`)
  mkdirSync(dirname(ref), { recursive: true })
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=24000:duration=1.5', '-ac', '1', ref])
  writeFileSync(
    join(dirs.voices, 'catalog.json'),
    JSON.stringify({ voices: [{ id: VOICE_ID, name: '字幕同步测试音色', category: '测试', gender: 'female', refPath: ref, tags: ['测试'], emotions: ['平静'], roles: ['narrator'], promptText: '测试' }] }, null, 2),
  )
  mkdirSync(join(PROJ, 'audio'), { recursive: true })
  mkdirSync(join(PROJ, 'output'), { recursive: true })
  // scene-02 / scene-03 carry the chunks of an earlier dub (cut from OLD2 / N3) — exactly what a re-dub sees
  writeScriptJson(PROJ, {
    title: '咖啡小课堂',
    engine: 'html',
    fps: 30,
    width: 1280,
    height: 720,
    voiceMode: 'manual',
    defaultVoiceId: VOICE_ID,
    bgm: { enabled: false },
    scenes: [
      { id: 'scene-01', title: '开场', narration: N1, emotion: '平静', voiceId: VOICE_ID, durationSec: 3 },
      { id: 'scene-02', title: '冲泡', narration: OLD2, subChunks: shared.segmentSubtitleLines(OLD2, 16), emotion: '平静', voiceId: VOICE_ID, durationSec: 5 },
      { id: 'scene-03', title: '结尾', narration: N3, subChunks: shared.segmentSubtitleLines(N3, 16), emotion: '平静', voiceId: VOICE_ID, durationSec: 3 },
    ],
  })
  seedGlobalTrack(PROJ)
  const s = load(PROJ)
  assert.ok(subTexts(sceneOf(s, 'scene-02')).join('').includes('拿铁'))
  fixtureScene01Cues = cues(sceneOf(s, 'scene-01'))
  assertGlobalInSync(s, 'fixture')
})

// ------------------------------------------------------------------------------------------ 0. staleness rule (unit)
await test('chunk staleness rule: punctuation / quotes / spacing / display numerals do not count, edited words do', () => {
  assert.equal(typeof shared.subChunksMatchNarration, 'function', 'shared.subChunksMatchNarration is exported')
  const m = shared.subChunksMatchNarration
  assert.equal(m(['今天我们一起学习', '如何做一杯拿铁'], '今天，我们一起学习“如何做一杯拿铁”！'), true)
  assert.equal(m(['公元前119年', '决战漠北'], '公元前一一九年，决战漠北。'), true)
  assert.equal(m(shared.segmentSubtitleLines(OLD2, 16), NEW2), false)
  assert.equal(m(shared.segmentSubtitleLines(N3, 16), N3B), false)
  assert.equal(m([], N1), false)
  assert.equal(m(null, N1), false)
})

// ------------------------------------------------------------------------------------------ 1 + 2. re-dub
await test('tts-scene after a narration edit: subtitles follow the NEW narration, global track in step', async () => {
  // the 分镜精修 save path: POST script with the edited narration (chunks untouched)
  const before = load(PROJ)
  sceneOf(before, 'scene-02').narration = NEW2
  await apiOk('/api/video-workbench/script', { projectDir: PROJ, script: before, regenerateCode: false })
  const d = await apiOk('/api/video-workbench/action', {
    projectDir: PROJ,
    action: 'tts-scene',
    sceneId: 'scene-02',
    text: NEW2,
    emotion: '平静',
    speechRate: 1,
    voiceId: VOICE_ID,
    ttsEngine: SAPI,
  })
  assert.equal(d.result.provider, 'windows-sapi-cpu')
  const s = load(PROJ)
  const sc = sceneOf(s, 'scene-02')
  assert.equal(sc.audioFile, 'audio/scene-02.wav')
  assert.ok(subTexts(sc).length > 0, 'scene-02 has subtitles')
  assert.equal(plain(subTexts(sc).join('')), plain(NEW2), `subtitles follow the new narration: ${JSON.stringify(subTexts(sc))}`)
  assert.ok(!subTexts(sc).join('').includes('拿铁'), 'old words gone from the scene subtitles')
  assert.equal(plain((sc.subChunks || []).join('')), plain(NEW2), 'chunks re-derived from the new narration')
  assertGlobalInSync(s, 'after tts-scene')
  assert.ok(!s.subtitles.some((x) => x.text.includes('拿铁')), 'old words gone from the global track')
  assert.ok(s.subtitles.some((x) => x.sceneId === 'scene-02' && x.text.includes('摩卡')), 'new words in the global track')
  assertGlobalInSync(d.script, 'tts-scene response script')
})

await test('MCP generate_speech (scriptPath + sceneId) re-derives stale chunks too, global track in step', async () => {
  // an MCP client edits script.json, then re-dubs the scene through generate_speech
  const before = load(PROJ)
  sceneOf(before, 'scene-03').narration = N3B
  writeScriptJson(PROJ, before)
  const r = await tts.executeGenerateSpeech({
    text: N3B,
    emotion: '平静',
    voiceId: VOICE_ID,
    engine: SAPI,
    fps: 30,
    outputPath: join(PROJ, 'audio', 'scene-03.wav'),
    scriptPath: PROJ,
    sceneId: 'scene-03',
  })
  assert.equal(r.scriptUpdated, true)
  const s = load(PROJ)
  const sc = sceneOf(s, 'scene-03')
  assert.equal(plain(subTexts(sc).join('')), plain(N3B), `subtitles follow the new narration: ${JSON.stringify(subTexts(sc))}`)
  assert.ok(!subTexts(sc).join('').includes('关注'))
  assertGlobalInSync(s, 'after generate_speech')
  assert.ok(!s.subtitles.some((x) => x.text.includes('关注')))
})

await test('ai-master-voice re-times the mastered scene and keeps the global track in step', async () => {
  const before = load(PROJ)
  const d = await apiOk('/api/video-workbench/action', { projectDir: PROJ, action: 'ai-master-voice', sceneIds: ['scene-02'], useLlm: false })
  assert.equal(d.report.scenesCount, 1)
  const s = load(PROJ)
  assert.equal(sceneOf(s, 'scene-02').masteredAudioFile, 'audio/mastered/scene-02.wav')
  assert.equal(plain(subTexts(sceneOf(s, 'scene-02')).join('')), plain(NEW2))
  assertGlobalInSync(s, 'after ai-master-voice')
  // mastering re-measured the voice: the scene length moved and the later scene's cues moved with it
  const shift = sceneOf(s, 'scene-03').startFrame - sceneOf(before, 'scene-03').startFrame
  const g3 = s.subtitles.filter((x) => x.sceneId === 'scene-03')
  assert.ok(g3.length > 0 && g3[0].globalStartFrame === sceneOf(s, 'scene-03').startFrame + sceneOf(s, 'scene-03').subtitles[0].startFrame, `scene-03 cues follow the scene (shift ${shift})`)
})

await test('client-side re-sync stays harmless: a stale / double-shifted global track posted back is re-derived', async () => {
  // 61-studio-scenes re-syncs the track itself after a server change: it shifts the cues of moved scenes again and
  // POSTs the script — the server must re-derive the track from the scenes whatever the client sends
  const s0 = load(PROJ)
  const posted = structuredClone(s0)
  posted.subtitles = s0.subtitles.map((x) => ({ ...x, startFrame: x.startFrame + 45, endFrame: x.endFrame + 45, globalStartFrame: x.globalStartFrame + 45, globalEndFrame: x.globalEndFrame + 45 }))
  posted.subtitles.push({ text: '只需要三分钟的拿铁', sceneId: 'scene-02', startFrame: 5, endFrame: 20, globalStartFrame: 5, globalEndFrame: 20 })
  const d = await apiOk('/api/video-workbench/script', { projectDir: PROJ, script: posted, regenerateCode: false })
  assertGlobalInSync(d.script, 'POST script response')
  const s = load(PROJ)
  assertGlobalInSync(s, 'after POST script')
  assert.deepEqual(s.subtitles, s0.subtitles, 'identical to the server-derived track')
})

// ------------------------------------------------------------------------------------------ 2 + 3. subtitle overrides
await test('scene-overrides subtitleText (single + batch) rebuilds the scene and the global track', async () => {
  const one = await apiOk('/api/video-workbench/project/scene-overrides', { projectDir: PROJ, sceneId: 'scene-01', overrides: { subtitleText: '咖啡小课堂开课啦' } })
  assert.equal(one.overrides.subtitleText, '咖啡小课堂开课啦')
  let s = load(PROJ)
  assert.equal(plain(subTexts(sceneOf(s, 'scene-01')).join('')), plain('咖啡小课堂开课啦'))
  assertGlobalInSync(s, 'after scene-overrides')
  assert.ok(s.subtitles.some((x) => x.sceneId === 'scene-01' && x.text.includes('开课啦')))
  const batch = await apiOk('/api/video-workbench/project/scene-overrides/batch', { projectDir: PROJ, edits: { 'scene-03': { subtitleText: '点赞收藏不迷路' } } })
  assert.deepEqual(batch.recorded, [{ sceneId: 'scene-03', fields: ['subtitleText'] }])
  s = load(PROJ)
  assert.equal(plain(subTexts(sceneOf(s, 'scene-03')).join('')), plain('点赞收藏不迷路'))
  assertGlobalInSync(s, 'after scene-overrides/batch')
})

await test('empty subtitleText override = follow the narration: override dropped, subtitles kept (single + batch)', async () => {
  // scene-01 (not dubbed): back to exactly the narration cues it had before the custom subtitle
  const one = await apiOk('/api/video-workbench/project/scene-overrides', { projectDir: PROJ, sceneId: 'scene-01', overrides: { subtitleText: '' } })
  assert.equal(one.overrides.subtitleText, undefined, 'the empty override is not stored')
  let s = load(PROJ)
  let sc = sceneOf(s, 'scene-01')
  assert.ok(subTexts(sc).length > 0, 'scene-01 still has subtitles')
  assert.equal(plain(subTexts(sc).join('')), plain(N1), `scene-01 follows the narration: ${JSON.stringify(subTexts(sc))}`)
  assert.deepEqual(cues(sc), fixtureScene01Cues, 'same cues as before the custom subtitle')
  assert.equal(s.userOverrides?.['scene-01']?.subtitleText, undefined)
  assertGlobalInSync(s, 'after empty override')

  // scene-03 (dubbed): the narration cues are timed inside the measured voice window
  const batch = await apiOk('/api/video-workbench/project/scene-overrides/batch', { projectDir: PROJ, edits: { 'scene-03': { subtitleText: '   ' } } })
  assert.deepEqual(batch.recorded, [], 'a blank subtitleText is not recorded as a protected edit')
  s = load(PROJ)
  sc = sceneOf(s, 'scene-03')
  assert.ok(subTexts(sc).length > 0, 'scene-03 still has subtitles')
  assert.equal(plain(subTexts(sc).join('')), plain(N3B), `scene-03 follows the narration: ${JSON.stringify(subTexts(sc))}`)
  assert.equal(s.userOverrides?.['scene-03']?.subtitleText, undefined)
  const fps = Number(s.fps) || 30
  assert.equal(sc.subtitles[0].startFrame, Math.floor(Number(sc.voiceLeadSec) * fps), 'first cue starts at the voice lead-in')
  assert.ok(sc.subtitles[sc.subtitles.length - 1].endFrame <= Math.ceil((Number(sc.voiceLeadSec) + Number(sc.voiceDurationSec)) * fps), 'last cue ends with the voice')
  assertGlobalInSync(s, 'after empty batch override')
})

await test('empty subtitleText override on a scene that already follows its narration keeps the voice-aligned cues', async () => {
  const before = sceneOf(load(PROJ), 'scene-02').subtitles.map((x) => [x.text, x.startFrame, x.endFrame])
  await apiOk('/api/video-workbench/project/scene-overrides', { projectDir: PROJ, sceneId: 'scene-02', overrides: { subtitleText: '' } })
  const s = load(PROJ)
  assert.deepEqual(sceneOf(s, 'scene-02').subtitles.map((x) => [x.text, x.startFrame, x.endFrame]), before)
  assertGlobalInSync(s, 'after no-op empty override')
})

await test('a stored legacy empty override is pruned and re-applied as "follow the narration"', async () => {
  const data = load(PROJ)
  data.userOverrides = { ...(data.userOverrides || {}), 'scene-01': { subtitleText: '' } }
  writeScriptJson(PROJ, data)
  // any override save re-applies every stored override
  await apiOk('/api/video-workbench/project/scene-overrides', { projectDir: PROJ, sceneId: 'scene-02', overrides: { title: '冲泡步骤' } })
  const s = load(PROJ)
  assert.equal(s.userOverrides?.['scene-01'], undefined, 'empty legacy override pruned')
  assert.equal(plain(subTexts(sceneOf(s, 'scene-01')).join('')), plain(N1))
  assertGlobalInSync(s, 'after legacy re-apply')
})

await test('in-memory re-apply (AI re-run merge paths): an empty subtitleText override never empties the subtitles', () => {
  const script = {
    fps: 30,
    width: 1280,
    height: 720,
    scenes: [{ id: 'scene-01', narration: N1, durationSec: 3, durationInFrames: 90, voiceLeadSec: 0.35, voiceDurationSec: 2, subtitles: [{ index: 1, text: '旧的自定义字幕', startFrame: 10, endFrame: 80, userEdited: true }] }],
    userOverrides: { 'scene-01': { subtitleText: '' } },
  }
  locks.applyUserOverrides(script)
  assert.equal(plain(subTexts(script.scenes[0]).join('')), plain(N1))
  assert.equal(script.userOverrides['scene-01'], undefined)
  const merged = locks.threeWayMergeScene({ sceneId: 'scene-01', base: null, theirs: { id: 'scene-01', narration: N1, durationSec: 3, subtitles: [] }, ours: { subtitleText: '  ' }, script }).scene
  assert.equal(plain(subTexts(merged).join('')), plain(N1))
})

// ------------------------------------------------------------------------------------------ 4. Remotion draft scale
const REM = join(dirs.ws, 'remotion-draft')
const remRoot = `import React from 'react';
import { Composition, AbsoluteFill, useCurrentFrame } from 'remotion';
const Comp: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(135deg, #0b1d3a, #2563eb)', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ color: '#fff', fontSize: 120, fontFamily: 'sans-serif' }}>{'DRAFT ' + f}</div>
    </AbsoluteFill>
  );
};
export const RemotionRoot: React.FC = () => (
  <Composition id="MainVideo" component={Comp} durationInFrames={20} fps={10} width={1920} height={1080} />
);
`
await test('「720P 快速审片」 renders a Remotion project at the draft scale; a full render keeps 1920×1080', async () => {
  mkdirSync(join(REM, 'src'), { recursive: true })
  mkdirSync(join(REM, 'public'), { recursive: true })
  mkdirSync(join(REM, 'output'), { recursive: true })
  writeScriptJson(REM, {
    title: '草稿缩放',
    engine: 'remotion',
    fps: 10,
    width: 1920,
    height: 1080,
    bgm: { enabled: false },
    scenes: [{ id: 'scene-01', title: '草稿', narration: '', voiceMode: 'silent', durationSec: 2, durationInFrames: 20 }],
  })
  writeFileSync(join(REM, 'src', 'index.ts'), "import { registerRoot } from 'remotion';\nimport { RemotionRoot } from './Root';\nregisterRoot(RemotionRoot);\n")
  writeFileSync(join(REM, 'src', 'Root.tsx'), remRoot)

  const draft = await apiOk('/api/video-workbench/action', { projectDir: REM, action: 'render', engine: 'remotion', draft720p: true })
  assert.match(draft.result.renderMethod, /^remotion-renderer/)
  assert.deepEqual(await videoSize(draft.result.outputPath), { width: 1280, height: 720 }, 'draft rendered at 720p')
  const draftRes = draft.result.qaReport?.checks?.find((c) => /分辨率/.test(c.name))
  assert.ok(draftRes?.passed && /完全匹配/.test(draftRes.value), `QA expects the draft size: ${draftRes?.value}`)

  const full = await apiOk('/api/video-workbench/action', { projectDir: REM, action: 'render', engine: 'remotion' })
  assert.deepEqual(await videoSize(full.result.outputPath), { width: 1920, height: 1080 }, 'full render unchanged')
  const fullRes = full.result.qaReport?.checks?.find((c) => /分辨率/.test(c.name))
  assert.ok(fullRes?.passed && /完全匹配/.test(fullRes.value), `QA: ${fullRes?.value}`)
  // the draft keeps its own chunk cache: a draft never evicts the full-quality chunks (and vice versa)
  assert.ok(existsSync(join(REM, 'output', '.chunks', 'manifest.json')) && existsSync(join(REM, 'output', '.chunks-draft', 'manifest.json')))

  // the legacy single-pass Remotion path (DSH_RENDER_CHUNK_SEC=0) honours the draft scale too
  const prevChunk = process.env.DSH_RENDER_CHUNK_SEC
  process.env.DSH_RENDER_CHUNK_SEC = '0'
  try {
    const single = await apiOk('/api/video-workbench/action', { projectDir: REM, action: 'render', engine: 'remotion', draft720p: true })
    assert.equal(single.result.renderMethod, 'remotion-renderer')
    assert.deepEqual(await videoSize(single.result.outputPath), { width: 1280, height: 720 }, 'single-pass draft rendered at 720p')
  } finally {
    if (prevChunk === undefined) delete process.env.DSH_RENDER_CHUNK_SEC
    else process.env.DSH_RENDER_CHUNK_SEC = prevChunk
  }
}, { skip: SKIP_RENDER })

// ------------------------------------------------------------------------------------------ summary
const failed = results.filter((r) => r.status === 'fail')
const passed = results.filter((r) => r.status === 'pass')
const skipped = results.filter((r) => r.status === 'skip')
console.log(`\nsubtitle-sync: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`)
for (const r of failed) console.log(`  FAIL ${r.name}`)
if (process.env.SUBTITLE_SYNC_KEEP === '1') console.log(`scratch kept: ${SCRATCH}`)
else safeRemove(SCRATCH)
process.exit(failed.length ? 1 : 0)
