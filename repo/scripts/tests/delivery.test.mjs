#!/usr/bin/env node
/**
 * Standalone tests: delivery exports (SRT/VTT/stems/FCPXML/xmeml), temporal QA detectors
 * (photosensitive flashes / frozen frames / jump cuts), determinism check, colour LUTs & scopes (incl. the
 * color-lut / apply_color_lut output containment + no-overwrite rule, review F10), resumable chunked Remotion
 * rendering and the motion-blur generator.
 *
 *   node scripts/tests/delivery.test.mjs
 *
 * Env: DSH_VIDEO_ENV_PATH (defaults to the main checkout's .env when run inside a git worktree),
 *      DSH_DELIVERY_TEST_DIR (scratch root), DSH_DELIVERY_TEST_SKIP_RENDER=1 (skip Remotion/browser cases),
 *      DSH_DELIVERY_TEST_FILTER=<regex> (run only matching test names).
 * Scratch output is removed at the end (node_modules junctions are unlinked, never followed).
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const MAIN_CHECKOUT = /[\\/]\.claude[\\/]worktrees[\\/]/.test(REPO) ? resolve(REPO, '..', '..', '..') : REPO
if (!process.env.DSH_VIDEO_ENV_PATH) {
  const envCandidate = [join(REPO, '.env'), join(MAIN_CHECKOUT, '.env')].find((p) => existsSync(p))
  if (envCandidate) process.env.DSH_VIDEO_ENV_PATH = envCandidate
}
const SCRATCH = resolve(process.env.DSH_DELIVERY_TEST_DIR || join(MAIN_CHECKOUT, '.tmp', 'openfilm-delivery', `run-${process.pid}`))
const SKIP_RENDER = process.env.DSH_DELIVERY_TEST_SKIP_RENDER === '1'

const imp = (rel) => import(pathToFileURL(join(REPO, rel)).href)
const shared = await imp('packages/shared/index.js')
const det = await imp('packages/dsh-tool-video-suite/qa-detectors.js')
const qa = await imp('packages/dsh-tool-video-suite/qa-checker.js')
const detCheck = await imp('packages/dsh-tool-video-suite/determinism-check.js')
const fr = await imp('packages/dsh-tool-video-suite/frame-renderer.js')
const dx = await imp('packages/dsh-tool-video-suite/delivery-export.js')
const ct = await imp('packages/dsh-tool-video-suite/color-tools.js')
const audio = await imp('packages/dsh-tool-media/audio-synth.js')
const { resolveBinaries, runCommandRedirected } = shared
const { ffmpeg, ffprobe } = resolveBinaries()

// ------------------------------------------------------------------------------------------
// Harness
// ------------------------------------------------------------------------------------------
const results = []
const FILTER = process.env.DSH_DELIVERY_TEST_FILTER ? new RegExp(process.env.DSH_DELIVERY_TEST_FILTER, 'i') : null
async function test(name, fn, { skip = false } = {}) {
  // Fixture builders always run so filtered subsets still have their inputs
  if (FILTER && !FILTER.test(name) && !/fixture/i.test(name)) return
  if (skip) {
    results.push({ name, status: 'skip' })
    console.log(`- SKIP ${name}`)
    return
  }
  const t0 = Date.now()
  try {
    await fn()
    results.push({ name, status: 'pass', ms: Date.now() - t0 })
    console.log(`✔ ${name} (${Date.now() - t0} ms)`)
  } catch (err) {
    results.push({ name, status: 'fail', ms: Date.now() - t0, err })
    console.log(`✘ ${name} (${Date.now() - t0} ms)\n    ${String(err?.stack || err).split('\n').slice(0, 6).join('\n    ')}`)
  }
}

function safeRemove(target) {
  const abs = resolve(target)
  if (!abs.startsWith(resolve(SCRATCH)) && abs !== resolve(SCRATCH)) throw new Error(`refusing to delete outside scratch: ${abs}`)
  const walk = (p) => {
    let st
    try {
      st = lstatSync(p)
    } catch {
      return
    }
    if (st.isSymbolicLink() || !st.isDirectory()) {
      // Junctions / symlinks (e.g. project node_modules → shared deps) are unlinked, never descended
      try {
        unlinkSync(p)
      } catch {
        try { rmdirSync(p) } catch {}
      }
      return
    }
    for (const name of readdirSync(p)) walk(join(p, name))
    try { rmdirSync(p) } catch {}
  }
  walk(abs)
}

async function ff(args, timeoutMs = 120_000) {
  const res = await runCommandRedirected(ffmpeg, ['-y', '-hide_banner', '-v', 'error', ...args], { timeoutMs })
  assert.equal(res.code, 0, `ffmpeg failed: ${args.join(' ')}\n${res.stderr}`)
  return res
}
async function probe(file) {
  const res = await runCommandRedirected(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { timeoutMs: 60_000 })
  return JSON.parse(res.stdout || '{}')
}
async function decodedAudioMd5(file) {
  const res = await runCommandRedirected(ffmpeg, ['-hide_banner', '-v', 'error', '-i', file, '-map', '0:a', '-f', 'md5', '-'], { timeoutMs: 60_000 })
  return String(res.stdout || '').trim()
}
async function averageRgb(file, t = 0.5) {
  const raw = join(SCRATCH, `avg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.rgb`)
  await ff(['-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=1:1:flags=area,format=rgb24', '-f', 'rawvideo', raw])
  const b = readFileSync(raw)
  unlinkSync(raw)
  return [b[0], b[1], b[2]]
}
async function measureLufs(files) {
  const args = ['-hide_banner', '-nostats']
  for (const f of files) args.push('-i', f)
  const ins = files.map((_, i) => `[${i}:a]`).join('')
  args.push('-filter_complex', `${ins}amix=inputs=${files.length}:normalize=0:duration=longest,ebur128=framelog=quiet`, '-f', 'null', '-')
  const res = await runCommandRedirected(ffmpeg, args, { timeoutMs: 60_000 })
  const m = [...String(res.stderr).matchAll(/^\s*I:\s*([-\d.]+)\s*LUFS/gm)]
  return m.length ? Number(m[m.length - 1][1]) : NaN
}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** Minimal XML 1.0 well-formedness checker (tags, nesting, attributes, entities, single root). */
function assertWellFormedXml(xml, label) {
  const tok = /<\?xml[^?]*\?>|<!DOCTYPE[^>[]*>|<!--[\s\S]*?-->|<\/([A-Za-z_][\w.:-]*)\s*>|<([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|([^<]+)/y
  const entityOk = (s) => !/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(s)
  const stack = []
  let roots = 0
  let pos = 0
  while (pos < xml.length) {
    tok.lastIndex = pos
    const m = tok.exec(xml)
    if (!m) throw new Error(`${label}: malformed XML near offset ${pos}: ${JSON.stringify(xml.slice(pos, pos + 60))}`)
    pos = tok.lastIndex
    if (m[1]) {
      const open = stack.pop()
      if (open !== m[1]) throw new Error(`${label}: </${m[1]}> closes <${open}>`)
    } else if (m[2]) {
      const attrs = [...m[3].matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)]
      const names = attrs.map((a) => a[1])
      if (new Set(names).size !== names.length) throw new Error(`${label}: duplicate attribute in <${m[2]}>`)
      for (const a of attrs) if (!entityOk(a[3] ?? a[4] ?? '')) throw new Error(`${label}: bad entity in ${m[2]}@${a[1]}`)
      if (stack.length === 0) roots++
      if (!m[4]) stack.push(m[2])
    } else if (m[5] !== undefined) {
      if (stack.length === 0 && m[5].trim()) throw new Error(`${label}: text outside root`)
      if (!entityOk(m[5])) throw new Error(`${label}: unescaped & in text`)
    }
  }
  if (stack.length) throw new Error(`${label}: unclosed <${stack.join('> <')}>`)
  if (roots !== 1) throw new Error(`${label}: expected exactly one root element, found ${roots}`)
  // Second opinion from a real parser when available (Windows: .NET XmlDocument)
  if (process.platform === 'win32') {
    const f = join(SCRATCH, `xmlcheck-${Date.now()}.xml`)
    writeFileSync(f, xml, 'utf8')
    const ps = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `$d = New-Object System.Xml.XmlDocument; $d.XmlResolver = $null; $d.Load('${f.replace(/'/g, "''")}'); 'XMLOK:' + $d.DocumentElement.Name`], { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
    try { unlinkSync(f) } catch {}
    if (ps.status === 0) assert.match(ps.stdout, /XMLOK:/, `${label}: .NET XmlDocument rejected the file: ${ps.stderr}`)
  }
}

// ------------------------------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------------------------------
if (existsSync(SCRATCH)) safeRemove(SCRATCH)
mkdirSync(SCRATCH, { recursive: true })
const tmpBundlesBefore = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('remotion-webpack-bundle-')))

const BASIC = join(SCRATCH, 'basic-project')
const BEATS = [
  { time: 0.5, strong: true },
  { time: 1.0, strong: false },
  { time: 2.0, strong: true }, // coincides with the scene-02 cut → merged into that marker
  { time: 3.5, strong: true },
  { time: 7.0, strong: true }, // beyond the end → ignored
]
function basicScript(overrides = {}) {
  return {
    title: '交付测试 A&B <导出>',
    fps: 30,
    width: 320,
    height: 180,
    engine: 'html',
    bgm: { enabled: true, path: 'audio/bgm.wav', volume: 0.35, beats: BEATS, drops: [3.0] },
    scenes: [
      {
        id: 'scene-01',
        title: '开场',
        startFrame: 0,
        startSec: 0,
        durationSec: 2,
        durationInFrames: 60,
        kenBurns: 'zoom-in',
        audioFile: 'audio/scene-01.wav',
        voiceLeadSec: 0.2,
        sfxCues: [{ type: 'hit', offsetSec: 0.5, volume: 0.6 }],
        subtitles: [
          { index: 1, text: '第一句字幕', startSec: 0.2, endSec: 1.0, startFrame: 6, endFrame: 30 },
          { index: 2, text: '第二句 & <特殊>', startSec: 1.0, endSec: 1.9, startFrame: 30, endFrame: 57 },
        ],
      },
      {
        id: 'scene-02',
        title: '对决',
        startFrame: 60,
        startSec: 2,
        durationSec: 2,
        durationInFrames: 60,
        kenBurns: 'pan-right',
        audioFile: 'audio/scene-02.wav',
        voiceLeadSec: 0.2,
        subtitles: [{ index: 1, text: '第三句', startSec: 0.1, endSec: 1.5 }],
      },
      {
        id: 'scene-03',
        title: '定格',
        recipe: 'hold',
        startFrame: 120,
        startSec: 4,
        durationSec: 2,
        durationInFrames: 60,
        audioFile: 'audio/scene-03.wav',
        voiceLeadSec: 0.2,
        subtitles: [{ index: 1, text: '结尾', startFrame: 0, endFrame: 60 }],
      },
    ],
    totalDurationSec: 6,
    totalDurationInFrames: 180,
    ...overrides,
  }
}

async function makeBasicProject() {
  mkdirSync(join(BASIC, 'output'), { recursive: true })
  mkdirSync(join(BASIC, 'audio'), { recursive: true })
  await ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=6', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-shortest', join(BASIC, 'output', 'final.mp4')])
  for (let i = 1; i <= 3; i++) {
    await ff(['-f', 'lavfi', '-i', `sine=frequency=${300 + i * 110}:sample_rate=48000:duration=1.2`, '-af', 'volume=0.5', join(BASIC, 'audio', `scene-0${i}.wav`)])
  }
  await ff(['-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.25:sample_rate=48000:duration=7', '-ac', '2', join(BASIC, 'audio', 'bgm.wav')])
  writeFileSync(join(BASIC, 'script.json'), JSON.stringify(basicScript(), null, 2))
}

// ------------------------------------------------------------------------------------------
// 1. Pure detector unit tests (synthetic arrays)
// ------------------------------------------------------------------------------------------
function syntheticGrid(frames, cells, valueAt) {
  const grid = new Uint8Array(frames * cells)
  const yavg = new Float64Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let c = 0; c < cells; c++) {
      const v = Math.round(valueAt(f, c) * 255)
      grid[f * cells + c] = v
      sum += v
    }
    yavg[f] = sum / cells / 255
  }
  return { grid, yavg, frameCount: frames, gridCells: cells }
}
const strobe = (periodFrames, onFrames, cellsFrac = 1, lo = 0.15, hi = 0.95) => (f, c) => (c < 256 * cellsFrac && f % periodFrames < onFrames ? hi : lo)

await test('flash detector: 2 flashes/s full-frame → pass', () => {
  const r = det.detectPhotosensitiveFlashes({ ...syntheticGrid(120, 256, strobe(15, 2)), fps: 30 })
  assert.equal(r.severity, 'pass')
  assert.equal(r.maxFlashesPerSec, 2)
})
await test('flash detector: exactly 3 flashes/s → warning (at WCAG limit)', () => {
  const r = det.detectPhotosensitiveFlashes({ ...syntheticGrid(150, 256, strobe(10, 2)), fps: 30 })
  assert.equal(r.maxFlashesPerSec, 3)
  assert.equal(r.severity, 'warning')
  assert.ok(r.worstWindows.length >= 1 && r.worstWindows.every((w) => w.level === 'warning'))
})
await test('flash detector: 5 flashes/s → fail with window timestamps', () => {
  const r = det.detectPhotosensitiveFlashes({ ...syntheticGrid(120, 256, strobe(6, 2)), fps: 30, intentionalTimes: [0.4] })
  assert.equal(r.severity, 'fail')
  assert.equal(r.maxFlashesPerSec, 5)
  const w = r.worstWindows.find((x) => x.level === 'fail')
  assert.ok(w && w.startSec >= 0 && w.endSec <= 4.05 && w.endSec > w.startSec)
  assert.equal(r.worstWindows[0].intentional, true, 'window overlapping a declared clash must be marked intentional')
  assert.equal(w.maxAreaPct, 100)
})
await test('flash detector: 10% area strobe → pass, 40% area strobe → fail (≥25% area rule)', () => {
  const small = det.detectPhotosensitiveFlashes({ ...syntheticGrid(120, 256, strobe(6, 2, 0.1)), fps: 30 })
  assert.equal(small.severity, 'pass')
  const large = det.detectPhotosensitiveFlashes({ ...syntheticGrid(120, 256, strobe(6, 2, 0.4)), fps: 30 })
  assert.equal(large.severity, 'fail')
})
await test('flash detector: 12% luma flicker at 5 Hz → soft-tier warning only', () => {
  const r = det.detectPhotosensitiveFlashes({ ...syntheticGrid(120, 256, strobe(6, 2, 1, 0.4, 0.52)), fps: 30 })
  assert.equal(r.maxFlashesPerSec, 0)
  assert.ok(r.softMaxFlashesPerSec > 3)
  assert.equal(r.severity, 'warning')
})
await test('flash detector: slow fade dark→bright is not a flash', () => {
  const r = det.detectPhotosensitiveFlashes({ ...syntheticGrid(90, 256, (f) => 0.05 + (0.9 * f) / 89), fps: 30 })
  assert.equal(r.severity, 'pass')
  assert.equal(r.maxFlashesPerSec, 0)
})

const TL = det.buildSceneTimeline(basicScript(), 30)
await test('scene timeline + planned static holds', () => {
  assert.deepEqual(TL.map((r) => [r.startFrame, r.endFrame]), [[0, 60], [60, 120], [120, 180]])
  assert.equal(det.isPlannedStaticScene(TL[2].scene), true)
  assert.equal(det.isPlannedStaticScene(TL[0].scene), false)
  assert.equal(det.isPlannedStaticScene({ kenBurns: 'hold' }), true)
  assert.equal(det.isPlannedStaticScene({ qa: { allowFreeze: true } }), true)
})
await test('freeze analysis: freeze inside a hold scene is explained, elsewhere it is flagged', () => {
  const r = det.analyzeFrozenFrames({ freezes: [{ startSec: 4.1, endSec: 6, durationSec: 1.9 }, { startSec: 0.5, endSec: 3.6, durationSec: 3.1 }], timeline: TL, totalSec: 20, thresholdSec: 2.5 })
  assert.equal(r.severity, 'warning', 'unexplained freezes below 40% of the runtime are warnings')
  assert.equal(r.unexplained.length, 1)
  assert.deepEqual(r.unexplained[0].sceneIds, ['scene-01', 'scene-02'])
  const ok = det.analyzeFrozenFrames({ freezes: [{ startSec: 3.9, endSec: 6, durationSec: 2.1 }], timeline: TL, totalSec: 6, thresholdSec: 1 })
  assert.equal(ok.severity, 'pass', 'a freeze that is ≥ threshold-length only inside the hold scene is planned')
  const huge = det.analyzeFrozenFrames({ freezes: [{ startSec: 0, endSec: 3.9, durationSec: 3.9 }], timeline: TL, totalSec: 6, thresholdSec: 2.5 })
  assert.equal(huge.severity, 'fail', 'more than 40% of the runtime frozen is a broken render')
})
await test('jump-cut analysis: planned / impact / flash / unplanned / glitch classification', () => {
  const r = det.analyzeJumpCuts({
    cuts: [
      { timeSec: 2.0333, score: 30 }, // scene cut +1 frame → planned
      { timeSec: 3.0, score: 20 }, // declared impact
      { timeSec: 1.0, score: 15 }, // unplanned
      { timeSec: 5.0, score: 40 }, // glitch in…
      { timeSec: 5.0333, score: 38 }, // …and out
    ],
    timeline: TL,
    fps: 30,
    impactTimes: [3.0],
    flashFrames: [150],
  })
  assert.equal(r.plannedCount, 1)
  assert.equal(r.impactCount, 1)
  assert.equal(r.flashCount, 2)
  assert.equal(r.unplanned.length, 1)
  assert.equal(r.glitchCandidates.length, 1)
  assert.equal(r.glitchCandidates[0].frames, 1)
  assert.equal(r.severity, 'warning')
  const checks = det.buildTemporalQaChecks({ jumps: r })
  assert.ok(checks[0].passed && checks[0].severity === 'warning' && /疑似单帧坏帧/.test(checks[0].value))
})

await test('frame-difference outliers: 1- and 2-frame foreign bursts found; cuts and decaying flashes ignored', () => {
  const pattern = (f, c) => 0.3 + 0.4 * (((c * 37) % 16) / 16) + 0.002 * f // textured frame with slow exposure drift
  const foreign = (f, c) => (f === 50 ? 1 - pattern(f, c) : f === 90 || f === 91 ? 0.05 : pattern(f, c))
  const bursts = det.detectOutlierFrameBursts(syntheticGrid(120, 256, foreign))
  assert.deepEqual(bursts.map((b) => [b.frame, b.frames]), [[50, 1], [90, 2]])
  const cut = det.detectOutlierFrameBursts(syntheticGrid(120, 256, (f, c) => (f < 60 ? pattern(f, c) : 1 - pattern(f, c))))
  assert.deepEqual(cut, [], 'a hard cut that stays on the new shot is not a glitch')
  const decay = [0.2, 0.2, 0.9, 0.6, 0.4, 0.25, 0.2]
  const flash = det.detectOutlierFrameBursts(syntheticGrid(60, 256, (f) => (f >= 20 && f < 27 ? decay[f - 20] : 0.2)))
  assert.deepEqual(flash, [], 'a white flash that decays over several frames is not a glitch')
  const jumps = det.analyzeJumpCuts({ cuts: [{ timeSec: 50 / 30, score: 40 }], timeline: TL, fps: 30, outlierBursts: bursts, impactTimes: [3.0] })
  assert.equal(jumps.glitchCandidates.length, 1, 'burst at frame 90 is a declared impact (3.0 s) and is ignored')
  assert.equal(jumps.glitchCandidates[0].startFrame, 50)
})

// ------------------------------------------------------------------------------------------
// 2. Subtitles / timeline builders (unit)
// ------------------------------------------------------------------------------------------
await test('subtitle cues: scene-local frames, seconds-only and frame-only subtitles get global timing', () => {
  const cues = dx.collectGlobalSubtitleCues(basicScript(), { fps: 30, totalFrames: 180 })
  assert.deepEqual(
    cues.map((c) => [c.text, c.startFrame, c.endFrame]),
    [
      ['第一句字幕', 6, 30],
      ['第二句 & <特殊>', 30, 57],
      ['第三句', 63, 105],
      ['结尾', 120, 180],
    ],
  )
  assert.deepEqual(cues.map((c) => c.startSec), [0.2, 1, 2.1, 4])
})
await test('subtitle cues: global script.subtitles (globalStartFrame) win, overlaps are clipped', () => {
  const script = {
    fps: 30,
    totalDurationInFrames: 100,
    scenes: [{ id: 's1', startFrame: 0, durationInFrames: 100, subtitles: [{ text: 'ignored', startFrame: 0, endFrame: 10 }] }],
    subtitles: [
      { text: 'A', globalStartFrame: 0, globalEndFrame: 40, startSec: 9, endSec: 9.5 },
      { text: 'B', globalStartSec: 1.0, globalEndSec: 2.0 },
      { text: 'C', startFrame: 90, endFrame: 130 },
    ],
  }
  const cues = dx.collectGlobalSubtitleCues(script, { fps: 30 })
  assert.deepEqual(cues.map((c) => [c.text, c.startFrame, c.endFrame]), [['A', 0, 30], ['B', 30, 60], ['C', 90, 100]])
})
await test('SRT / WebVTT formatting', () => {
  const cues = [{ index: 1, text: '你好 & <世界>', startSec: 0.2, endSec: 1.0 }, { index: 2, text: '第二行\n换行', startSec: 3661.5, endSec: 3662.25 }]
  const srt = dx.buildSrt(cues)
  assert.match(srt, /^1\r\n00:00:00,200 --> 00:00:01,000\r\n你好 & <世界>\r\n\r\n2\r\n01:01:01,500 --> 01:01:02,250\r\n第二行\r\n换行\r\n/)
  const vtt = dx.buildVtt(cues, { title: 'T' })
  assert.ok(vtt.startsWith('WEBVTT - T\n\n1\n00:00:00.200 --> 00:00:01.000\n你好 &amp; &lt;世界&gt;\n'))
})
await test('rational time helpers & path URLs', () => {
  const r30 = dx.toRationalFps(30)
  assert.equal(dx.fcpTime(0, r30), '0s')
  assert.equal(dx.fcpTime(60, r30), '2s')
  assert.equal(dx.fcpTime(58, r30), '29/15s')
  const ntsc = dx.toRationalFps(29.97)
  assert.deepEqual([ntsc.num, ntsc.den, ntsc.timebase, ntsc.ntsc], [30000, 1001, 30, true])
  assert.equal(dx.fcpTime(1, ntsc), '1001/30000s')
  assert.equal(dx.framesToTimecode(3725, r30), '00:02:04:05')
  if (process.platform === 'win32') {
    assert.equal(dx.toXmemlPathUrl('D:\\视频 项目\\a#b.mp4'), 'file://localhost/D%3a/%E8%A7%86%E9%A2%91%20%E9%A1%B9%E7%9B%AE/a%23b.mp4')
    assert.equal(dx.toFileUrl('D:\\视频 项目\\a.mp4'), 'file:///D:/%E8%A7%86%E9%A2%91%20%E9%A1%B9%E7%9B%AE/a.mp4')
  }
  assert.equal(dx.xmlEscape(`a&b<"c'>\u0001`), 'a&amp;b&lt;&quot;c&apos;&gt;')
})
const syntheticTimeline = {
  title: '测试 A&B <x>',
  rate: dx.toRationalFps(30),
  fps: 30,
  totalFrames: 180,
  width: 320,
  height: 180,
  video: { path: 'D:\\x\\final.mp4', name: 'final.mp4', frames: 180, hasAudio: true, audioChannels: 2, sampleRate: 48000 },
  clips: [
    { index: 1, sceneId: 'scene-01', name: '01 · 开场', startFrame: 0, endFrame: 58, frames: 58 },
    { index: 2, sceneId: 'scene-02', name: '02 · "对决" & 收尾', startFrame: 58, endFrame: 180, frames: 122 },
  ],
  markers: [
    { frame: 0, kind: 'scene', name: '▶ 01 · 开场', note: 'scene-01' },
    { frame: 15, kind: 'downbeat', name: '♪ 强拍 1', note: 'downbeat' },
    { frame: 58, kind: 'scene', name: '▶ 02', note: 'scene-02' },
  ],
  stems: [{ role: 'voice', label: '人声 Voice', fcpRole: 'dialogue', path: 'D:\\x\\stems\\voice.wav', frames: 180, channels: 2, sampleRate: 48000 }],
}
await test('FCPXML builder: well-formed, contiguous spine, connected stems, markers', () => {
  const xml = dx.buildFcpxml(syntheticTimeline)
  assertWellFormedXml(xml, 'fcpxml')
  assert.match(xml, /<fcpxml version="1\.10">/)
  assert.match(xml, /<format id="r1" frameDuration="1\/30s" width="320" height="180"/)
  assert.match(xml, /<asset-clip ref="r2" offset="0s" name="01 · 开场" start="0s" duration="29\/15s"/)
  assert.match(xml, /<asset-clip ref="r2" offset="29\/15s" name="02 · &quot;对决&quot; &amp; 收尾" start="29\/15s" duration="61\/15s"/)
  assert.match(xml, /<asset-clip ref="r3" lane="-1" offset="0s" name="人声 Voice" start="0s" duration="6s" audioRole="dialogue" enabled="0"\/>/)
  assert.equal((xml.match(/<marker /g) || []).length, 3)
  assert.match(xml, /<marker start="1\/2s" duration="1\/30s" value="♪ 强拍 1"/)
  const on = dx.buildFcpxml(syntheticTimeline, { stemsEnabled: true })
  assert.match(on, /<adjust-volume amount="-96dB"\/>/)
  assert.doesNotMatch(on, /enabled="0"/)
})
await test('xmeml (FCP7 XML) builder: well-formed, linked A/V, stereo stem pairs, sequence markers', () => {
  const xml = dx.buildXmeml(syntheticTimeline)
  assertWellFormedXml(xml, 'xmeml')
  assert.match(xml, /<xmeml version="5">/)
  assert.equal((xml.match(/<file id="file-1">/g) || []).length, 1, 'file-1 must be fully defined exactly once')
  assert.equal((xml.match(/<track>/g) || []).length, 1 + 2 + 2)
  assert.match(xml, /<clipitem id="clipitem-v2">[\s\S]*?<start>58<\/start>\s*<end>180<\/end>\s*<in>58<\/in>\s*<out>180<\/out>/)
  assert.match(xml, /<pathurl>file:\/\/localhost\/D%3a\/x\/final\.mp4<\/pathurl>/)
  assert.equal((xml.match(/<marker>/g) || []).length, 3)
  assert.match(xml, /<linkclipref>clipitem-a2-1<\/linkclipref>/)
  assert.match(xml, /<clipitem id="clipitem-voice-2">[\s\S]*?<enabled>FALSE<\/enabled>/)
  assert.match(xml, /<outputchannelindex>2<\/outputchannelindex>/)
})

// ------------------------------------------------------------------------------------------
// 3. Chunk planning / bundle hash / audio plan (unit, no rendering)
// ------------------------------------------------------------------------------------------
await test('chunk planning: frame-exact contiguous ranges, tiny tail merged', () => {
  assert.deepEqual(fr.planRenderChunks(64, 21).map((c) => [c.start, c.end]), [[0, 20], [21, 41], [42, 63]])
  const big = fr.planRenderChunks(4278, 300)
  assert.equal(big.length, 15, '78-frame tail ≥ 25% of a chunk stays a chunk of its own')
  assert.equal(big.reduce((a, c) => a + c.frames, 0), 4278)
  assert.ok(big.every((c, i) => i === 0 || c.start === big[i - 1].end + 1))
  const merged = fr.planRenderChunks(4270, 300)
  assert.equal(merged.length, 14, '70-frame tail < 25% of a chunk is merged into the previous one')
  assert.deepEqual([merged[13].start, merged[13].end, merged[13].frames], [3900, 4269, 370])
  assert.equal(fr.resolveRenderChunkSec(0), 0)
  assert.equal(fr.resolveRenderChunkSec('2.5'), 2.5)
})
await test('bundle hash: ignores updatedAt and the muted master audio; tracks src/script/public changes', () => {
  const p = join(SCRATCH, 'hash-project')
  mkdirSync(join(p, 'src'), { recursive: true })
  mkdirSync(join(p, 'public', 'img'), { recursive: true })
  writeFileSync(join(p, 'script.json'), JSON.stringify({ fps: 30, b: 1, a: 2, updatedAt: '1' }))
  writeFileSync(join(p, 'src', 'Root.tsx'), 'export const x = 1\n')
  writeFileSync(join(p, 'public', 'img', 'a.png'), 'png-bytes')
  writeFileSync(join(p, 'public', 'master-audio.wav'), 'audio-1')
  const h0 = fr.computeRemotionBundleHash(p).hash
  writeFileSync(join(p, 'script.json'), JSON.stringify({ a: 2, fps: 30, b: 1, updatedAt: '2' }))
  writeFileSync(join(p, 'public', 'master-audio.wav'), 'audio-2')
  assert.equal(fr.computeRemotionBundleHash(p).hash, h0, 'key order, updatedAt and master audio must not invalidate chunks')
  writeFileSync(join(p, 'public', 'img', 'a.png'), 'png-bytes-2')
  const h1 = fr.computeRemotionBundleHash(p).hash
  assert.notEqual(h1, h0)
  writeFileSync(join(p, 'src', 'Root.tsx'), 'export const x = 2\n')
  const h2 = fr.computeRemotionBundleHash(p).hash
  assert.notEqual(h2, h1)
  writeFileSync(join(p, 'src', 'Viz.tsx'), "import { useAudioData } from '@remotion/media-utils'\n")
  const h3 = fr.computeRemotionBundleHash(p).hash
  writeFileSync(join(p, 'public', 'master-audio.wav'), 'audio-3')
  assert.notEqual(fr.computeRemotionBundleHash(p).hash, h3, 'audio-reactive compositions must hash the master audio')
})
await test('composition audio plan: master / composition / silent detection', () => {
  const p = join(SCRATCH, 'audio-plan')
  mkdirSync(join(p, 'src'), { recursive: true })
  mkdirSync(join(p, 'public'), { recursive: true })
  writeFileSync(join(p, 'public', 'master-audio.wav'), 'x')
  const setSrc = (code) => writeFileSync(join(p, 'src', 'Comp.tsx'), code)
  setSrc("// <OffthreadVideo src='x'> in a comment\n<OffthreadVideo src={a} style={{ x: a > b ? 1 : 2 }} muted />\n<Audio src={staticFile('master-audio.wav')} />\n")
  assert.equal(fr.resolveCompositionAudioPlan(p).mode, 'master')
  setSrc("<Audio src={staticFile('master-audio.wav')} volume={0.8} />\n")
  assert.equal(fr.resolveCompositionAudioPlan(p).mode, 'composition')
  setSrc("<Audio src={staticFile('master-audio.wav')} />\n<OffthreadVideo src={v} muted={false} />\n")
  assert.equal(fr.resolveCompositionAudioPlan(p).mode, 'composition')
  setSrc('<AbsoluteFill />\n')
  assert.equal(fr.resolveCompositionAudioPlan(p).mode, 'silent')
})
await test('removeRemotionBundleDir refuses anything that is not a remotion-webpack-bundle-* folder', () => {
  const victim = join(SCRATCH, 'not-a-bundle')
  mkdirSync(victim, { recursive: true })
  assert.equal(fr.removeRemotionBundleDir(victim), false)
  assert.ok(existsSync(victim))
  const bundle = join(SCRATCH, 'remotion-webpack-bundle-test')
  mkdirSync(join(bundle, 'public'), { recursive: true })
  writeFileSync(join(bundle, 'public', 'a.txt'), 'x')
  assert.equal(fr.removeRemotionBundleDir(bundle), true)
  assert.ok(!existsSync(bundle))
})

// ------------------------------------------------------------------------------------------
// 4. LUTs (unit + FFmpeg)
// ------------------------------------------------------------------------------------------
await test('built-in LUTs: five 17³ .cube files with valid headers', () => {
  const { luts } = ct.ensureBuiltinLuts()
  assert.deepEqual(luts.map((l) => l.id), ['teal-orange', 'warm-film', 'bleach-bypass', 'mono-contrast', 'night-cool'])
  for (const l of luts) {
    assert.ok(existsSync(l.path), l.path)
    const text = readFileSync(l.path, 'utf8')
    assert.equal(ct.readCubeHeader(l.path).size, 17)
    const rows = text.split('\n').filter((line) => /^[\d.]+ [\d.]+ [\d.]+$/.test(line))
    assert.equal(rows.length, 17 ** 3)
    assert.ok(rows.every((r) => r.split(' ').every((v) => Number(v) >= 0 && Number(v) <= 1)))
  }
  assert.equal(ct.buildCubeLut('teal-orange'), readFileSync(luts[0].path, 'utf8'), 'committed LUT must match the generator')
})

await test('basic fixture project (synthetic 6 s video + voices + bgm)', makeBasicProject)

await test('LUT grading: teal-orange shadows→teal, highlights→orange; intensity mix; user .cube; mono', async () => {
  const dark = join(SCRATCH, 'gray-dark.mp4')
  const light = join(SCRATCH, 'gray-light.mp4')
  await ff(['-f', 'lavfi', '-i', 'color=c=0x404040:s=64x64:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', dark])
  await ff(['-f', 'lavfi', '-i', 'color=c=0xC0C0C0:s=64x64:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', light])
  const src0 = await averageRgb(dark)
  const gDark = await ct.applyColorLut({ mp4Path: dark, lut: 'teal-orange', outputPath: join(SCRATCH, 'dark-to.mp4') })
  const gLight = await ct.applyColorLut({ mp4Path: light, lut: 'teal-orange', outputPath: join(SCRATCH, 'light-to.mp4') })
  const half = await ct.applyColorLut({ mp4Path: dark, lut: 'teal-orange', intensity: 0.5, outputPath: join(SCRATCH, 'dark-half.mp4') })
  const [dr, , db] = await averageRgb(gDark.outputPath)
  const [lr, , lb] = await averageRgb(gLight.outputPath)
  const [hr, , hb] = await averageRgb(half.outputPath)
  assert.ok(db > dr + 6, `shadows should go teal: ${[dr, db]}`)
  assert.ok(lr > lb + 6, `highlights should go orange: ${[lr, lb]}`)
  const fullShift = db - dr
  const halfShift = hb - hr
  assert.ok(halfShift > fullShift * 0.25 && halfShift < fullShift * 0.75, `intensity 0.5 should land between: full=${fullShift} half=${halfShift} src=${src0}`)
  const colored = join(SCRATCH, 'colored.mp4')
  await ff(['-f', 'lavfi', '-i', 'color=c=0x30A0E0:s=64x64:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', colored])
  const mono = await ct.applyColorLut({ mp4Path: colored, lut: join(ct.BUILTIN_LUT_DIR, 'mono-contrast.cube'), outputPath: join(SCRATCH, 'mono.mp4') })
  assert.equal(mono.builtin, false)
  const [mr, mg, mb] = await averageRgb(mono.outputPath)
  assert.ok(Math.max(mr, mg, mb) - Math.min(mr, mg, mb) <= 6, `mono LUT must be neutral: ${[mr, mg, mb]}`)
  await assert.rejects(() => ct.applyColorLut({ mp4Path: dark, lut: 'no-such-lut' }), /LUT 文件不存在/)
  const graded = await ct.applyColorLut({ projectDir: BASIC, lut: 'night-cool', intensity: 0.7 })
  assert.ok(graded.outputPath.endsWith('final.graded-night-cool.mp4'))
  const info = await probe(graded.outputPath)
  const v = info.streams.find((s) => s.codec_type === 'video')
  assert.equal(v.color_space, 'bt709')
  assert.ok(info.streams.some((s) => s.codec_type === 'audio'), 'audio must be stream-copied')
  unlinkSync(graded.outputPath)
})

await test('color-lut / apply_color_lut: graded copy only inside <project>/output/, never overwrites without overwrite:true (review F10)', async () => {
  const { handleDeliveryApiRequest } = await imp('packages/dsh-web-video-workbench/lib/routes-delivery.js')
  const post = async (body) => {
    const res = await handleDeliveryApiRequest(
      new Request('http://127.0.0.1:4399/api/video-workbench/color-lut', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    )
    return { status: res.status, data: await res.json() }
  }
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
  // Another project whose finished render must never be reachable from BASIC's color-lut request
  const OTHER = join(SCRATCH, 'other-project')
  mkdirSync(join(OTHER, 'output'), { recursive: true })
  writeFileSync(join(OTHER, 'script.json'), JSON.stringify({ title: 'other', scenes: [] }))
  const victim = join(OTHER, 'output', 'final.mp4')
  writeFileSync(victim, 'PROJECT-B FINAL RENDER (hours of work)')
  const victimSha = sha(victim)
  const outDir = join(BASIC, 'output')
  const source = join(outDir, 'final.mp4')
  const sourceSha = sha(source)
  const created = []
  const link = join(outDir, 'linked')
  try {
    // 1. Anything that would leave <project>/output/ is refused before FFmpeg runs
    const escapes = [
      '../other-project/output/final.mp4',
      join(OTHER, 'output', 'final.mp4'),
      'output/../../other-project/output/final.mp4',
      '\\\\127.0.0.1\\share\\graded.mp4',
      '//127.0.0.1/share/graded.mp4',
      'C:graded.mp4',
      'final.mp4:stream',
      'nul.mp4',
      'graded.txt',
    ]
    for (const outputPath of escapes) {
      const r = await post({ projectDir: BASIC, lut: 'teal-orange', outputPath })
      assert.equal(r.status, 400, `${outputPath} → ${JSON.stringify(r.data)}`)
      assert.equal(r.data.code, 'INVALID_OUTPUT_PATH')
      assert.match(r.data.error, /outputPath 无效/)
    }
    assert.equal(sha(victim), victimSha, "another project's render must never be touched")
    const notProject = join(SCRATCH, 'not-a-project')
    mkdirSync(notProject, { recursive: true })
    const np = await post({ projectDir: notProject, lut: 'teal-orange', mp4Path: source })
    assert.equal(np.status, 404, JSON.stringify(np.data))
    assert.ok(!existsSync(join(notProject, 'output')), 'nothing may be written into a folder that is not a project')

    // 2. A path relative to output/ works (a leading "output/" is accepted); no temporary file is left behind
    const ok = await post({ projectDir: BASIC, lut: 'teal-orange', intensity: 0.8, outputPath: 'output/graded/teal.mp4' })
    assert.equal(ok.status, 200, JSON.stringify(ok.data))
    const target = join(outDir, 'graded', 'teal.mp4')
    created.push(target)
    assert.equal(resolve(ok.data.outputPath), resolve(target))
    assert.equal(ok.data.outputRelPath, 'output/graded/teal.mp4')
    assert.match(ok.data.url, /\/api\/video-workbench\/asset\?/)
    assert.ok(!readdirSync(join(outDir, 'graded')).some((n) => n.includes('.partial-')), 'temporary FFmpeg output left behind')
    const firstSha = sha(target)

    // 3. An existing file is never replaced unless overwrite: true is passed explicitly
    const again = await post({ projectDir: BASIC, lut: 'warm-film', outputPath: 'graded/teal.mp4' })
    assert.equal(again.status, 409, JSON.stringify(again.data))
    assert.equal(again.data.code, 'OUTPUT_EXISTS')
    assert.equal(sha(target), firstSha, 'a refused request must leave the existing file untouched')
    const replaced = await post({ projectDir: BASIC, lut: 'warm-film', outputPath: 'graded/teal.mp4', overwrite: true })
    assert.equal(replaced.status, 200, JSON.stringify(replaced.data))
    assert.equal(replaced.data.replacedExisting, true)
    assert.notEqual(sha(target), firstSha)

    // 4. The source is never a valid target, not even with overwrite: true
    const self = await post({ projectDir: BASIC, lut: 'teal-orange', outputPath: 'final.mp4', overwrite: true })
    assert.equal(self.status, 400, JSON.stringify(self.data))
    assert.match(self.data.error, /不能覆盖源视频/)
    assert.equal(sha(source), sourceSha)

    // 5. Default name (what the Studio's 生成调色版 button posts: { lut, intensity }): a second grade never replaces the first
    const d1 = await post({ projectDir: BASIC, lut: 'teal-orange' })
    assert.equal(d1.status, 200, JSON.stringify(d1.data))
    created.push(d1.data.outputPath)
    assert.equal(d1.data.outputRelPath, 'output/final.graded-teal-orange.mp4')
    const d1Sha = sha(d1.data.outputPath)
    const d2 = await post({ projectDir: BASIC, lut: 'teal-orange', intensity: 0.5 })
    assert.equal(d2.status, 200, JSON.stringify(d2.data))
    created.push(d2.data.outputPath)
    assert.equal(d2.data.outputRelPath, 'output/final.graded-teal-orange-2.mp4')
    assert.equal(sha(d1.data.outputPath), d1Sha, 'the earlier grade must survive a second click')
    const d3 = await post({ projectDir: BASIC, lut: 'teal-orange', overwrite: true })
    assert.equal(d3.data.outputRelPath, 'output/final.graded-teal-orange.mp4')
    assert.equal(d3.data.replacedExisting, true)

    // 6. A junction inside output/ is never written through
    symlinkSync(join(OTHER, 'output'), link, 'junction')
    const viaLink = await post({ projectDir: BASIC, lut: 'teal-orange', outputPath: 'linked/new.mp4' })
    assert.equal(viaLink.status, 409, JSON.stringify(viaLink.data))
    assert.equal(viaLink.data.code, 'OUTPUT_PATH_LINK')
    assert.ok(!existsSync(join(OTHER, 'output', 'new.mp4')))

    // 7. The MCP tool goes through the same checks and documents them
    const suite = await imp('packages/dsh-tool-video-suite/index.js')
    const tools = new Map()
    suite.apply({ tools: { register: (def) => tools.set(def.name, def) } })
    const tool = tools.get('apply_color_lut')
    assert.equal(tool.parameters.properties.overwrite?.type, 'boolean')
    assert.match(tool.description, /ONLY inside the project's output\/ folder/)
    assert.match(tool.description, /never overwrites an existing file unless overwrite=true/)
    await assert.rejects(() => tool.execute({ projectDir: BASIC, lut: 'teal-orange', outputPath: '../other-project/output/final.mp4' }), (e) => e.status === 400 && e.code === 'INVALID_OUTPUT_PATH')
    await assert.rejects(() => tool.execute({ projectDir: BASIC, lut: 'teal-orange', outputPath: 'graded/teal.mp4' }), (e) => e.status === 409 && e.code === 'OUTPUT_EXISTS')
    assert.equal(sha(victim), victimSha)
  } finally {
    try {
      unlinkSync(link) // the junction itself, never its target
    } catch {}
    for (const p of created) {
      try {
        unlinkSync(p)
      } catch {}
    }
    try {
      rmdirSync(join(outDir, 'graded'))
    } catch {}
  }
})

await test('scopes: waveform / vectorscope / histogram PNGs (+ REST route)', async () => {
  const r = await ct.renderVideoScopes({ projectDir: BASIC, timeSec: 1.25 })
  for (const k of ['frame', 'waveform', 'vectorscope', 'histogram']) {
    assert.ok(existsSync(r.files[k]) && statSync(r.files[k]).size > 500, k)
    assert.ok(r.files[k].includes(`${sep}output${sep}scopes${sep}`))
  }
  const info = await probe(r.files.vectorscope)
  assert.equal(info.streams[0].width, 256)
  const { handleWorkbenchApiRequest } = await imp('packages/dsh-web-video-workbench/lib/index.js')
  const res = await handleWorkbenchApiRequest(new Request('http://127.0.0.1:4399/api/video-workbench/scopes', { method: 'POST', body: JSON.stringify({ projectDir: BASIC, timeSec: 2, kinds: ['waveform'] }) }))
  const j = await res.json()
  assert.equal(res.status, 200)
  assert.ok(j.ok && j.files.waveform && /\/api\/video-workbench\/asset\?/.test(j.urls.waveform))
  await assert.rejects(() => ct.renderVideoScopes({ projectDir: BASIC, kinds: ['parade'] }), /不支持的示波器类型/)
})

// ------------------------------------------------------------------------------------------
// 5. Stems (mixVideoAudio writeStems)
// ------------------------------------------------------------------------------------------
await test('stems: master is bit-identical with/without writeStems; stems aligned, same length, level-matched', async () => {
  const script = basicScript()
  const plain = await audio.mixVideoAudio({ projectDir: BASIC, script, assetsManifest: { items: [] }, outputPath: join(SCRATCH, 'mix-plain.wav') })
  assert.equal(plain.stems, undefined)
  const withStems = await audio.mixVideoAudio({ projectDir: BASIC, script, assetsManifest: { items: [] }, outputPath: join(SCRATCH, 'mix-stems.wav'), writeStems: true, stemsDir: join(SCRATCH, 'stems-a') })
  assert.equal(await decodedAudioMd5(plain.outputPath), await decodedAudioMd5(withStems.outputPath), 'default master output must not change')
  const st = withStems.stems
  assert.deepEqual(st.roles, { voice: 'present', sfx: 'present', bgm: 'present' })
  const masterInfo = (await probe(withStems.outputPath)).streams[0]
  for (const role of ['voice', 'sfx', 'bgm']) {
    const s = (await probe(st[role])).streams[0]
    assert.equal(s.codec_name, 'pcm_f32le')
    assert.equal(Number(s.sample_rate), 48000)
    assert.equal(Number(s.channels), 2)
    assert.equal(Number(s.duration_ts), Number(masterInfo.duration_ts), `${role} stem must have exactly as many samples as the master`)
  }
  const sum = await measureLufs([st.voice, st.sfx, st.bgm])
  const master = await measureLufs([withStems.outputPath])
  assert.ok(Math.abs(sum - master) <= 1.0, `stems sum ${sum} LUFS vs master ${master} LUFS`)
  // Pure music (subtitle-mv) path: linear master gain + trim; missing voice bus → silent voice stem
  const mv = await audio.mixVideoAudio({ projectDir: BASIC, script: { ...script, narrationMode: 'subtitle-mv' }, assetsManifest: { items: [] }, outputPath: join(SCRATCH, 'mix-mv.wav'), writeStems: true, stemsDir: join(SCRATCH, 'stems-mv') })
  assert.equal(mv.stems.roles.voice, 'present')
  const noVoice = basicScript({ scenes: basicScript().scenes.map((s) => ({ ...s, audioFile: '' })) })
  const nv = await audio.mixVideoAudio({ projectDir: BASIC, script: noVoice, assetsManifest: { items: [] }, outputPath: join(SCRATCH, 'mix-nv.wav'), writeStems: true, stemsDir: join(SCRATCH, 'stems-nv') })
  assert.equal(nv.stems.roles.voice, 'silent')
  const silent = (await probe(nv.stems.voice)).streams[0]
  assert.equal(Number(silent.duration_ts), Number((await probe(nv.outputPath)).streams[0].duration_ts))
})

// ------------------------------------------------------------------------------------------
// 6. Full delivery export (files + timelines + REST)
// ------------------------------------------------------------------------------------------
await test('export_project_package: srt + vtt + stems + fcpxml + xmeml into output/export/', async () => {
  const res = await dx.exportProjectPackage({ projectDir: BASIC, formats: ['all'] })
  const exp = join(BASIC, 'output', 'export')
  assert.equal(res.exportDir, exp)
  assert.equal(res.subtitleCues, 4)
  const srt = readFileSync(res.files.srt, 'utf8')
  assert.ok(srt.startsWith('\uFEFF1\r\n00:00:00,200 --> 00:00:01,000\r\n第一句字幕'))
  assert.match(srt, /4\r\n00:00:04,000 --> 00:00:06,000\r\n结尾/)
  assert.match(readFileSync(res.files.vtt, 'utf8'), /^WEBVTT - 交付测试 A&B <导出>\n\n1\n00:00:00\.200 --> 00:00:01\.000\n第一句字幕\n\n2\n00:00:01\.000 --> 00:00:01\.900\n第二句 &amp; &lt;特殊&gt;/)
  for (const role of ['voice', 'sfx', 'bgm']) assert.ok(existsSync(res.files.stems[role]) && res.files.stems[role].startsWith(join(exp, 'stems')))
  assert.ok(!existsSync(join(exp, 'stems', '.stems-reference-master.wav')), 'temporary reference master must be removed')
  const fcp = readFileSync(res.files.fcpxml, 'utf8')
  assertWellFormedXml(fcp, 'export.fcpxml')
  assert.equal((fcp.match(/<asset-clip ref="r2" /g) || []).length, 3)
  assert.match(fcp, /offset="0s"[^>]*start="0s" duration="2s"/)
  assert.match(fcp, /offset="2s"[^>]*start="2s" duration="2s"/)
  assert.match(fcp, /offset="4s"[^>]*start="4s" duration="2s"/)
  assert.match(fcp, /<sequence format="r1" duration="6s"/)
  assert.equal((fcp.match(/<marker /g) || []).length, 3 + 2 + 1, '3 scene cuts + 2 downbeats + 1 drop')
  assert.match(fcp, /value="▶ 02 · 对决 ♪"/)
  assert.match(fcp, /<marker start="1\/2s" duration="1\/30s" value="♪ 强拍 1"/)
  assert.match(fcp, /<marker start="3s" duration="1\/30s" value="⚡ 高潮 Drop"/)
  for (const role of ['voice', 'sfx', 'bgm']) assert.ok(fcp.includes(`${role}.wav`), `fcpxml must reference ${role} stem`)
  assert.ok(fcp.includes(pathToFileURL(join(BASIC, 'output', 'final.mp4')).href))
  const x7 = readFileSync(res.files.xmeml, 'utf8')
  assertWellFormedXml(x7, 'export.fcp7.xml')
  assert.equal((x7.match(/<clipitem id="clipitem-v\d+">/g) || []).length, 3)
  assert.equal((x7.match(/<marker>/g) || []).length, 6)
  assert.equal((x7.match(/<track>/g) || []).length, 1 + 2 + 6)
  assert.equal(res.timeline.totalFrames, 180)
  assert.deepEqual(res.timeline.stems, ['voice', 'sfx', 'bgm'])
  assert.ok(existsSync(res.files.manifest))
})
await test('export: timeline-only request reuses stems; LUT-graded copy is referenced; REST /export', async () => {
  const before = statSync(join(BASIC, 'output', 'export', 'stems', 'voice.wav')).mtimeMs
  const res = await dx.exportProjectPackage({ projectDir: BASIC, formats: ['fcpxml'], lut: 'warm-film', lutIntensity: 0.5 })
  assert.equal(res.stems.reused, true)
  assert.equal(statSync(join(BASIC, 'output', 'export', 'stems', 'voice.wav')).mtimeMs, before)
  assert.ok(existsSync(res.files.gradedVideo))
  assert.ok(readFileSync(res.files.fcpxml, 'utf8').includes('final.graded.mp4'))
  unlinkSync(res.files.gradedVideo)
  const { handleWorkbenchApiRequest } = await imp('packages/dsh-web-video-workbench/lib/index.js')
  const http = await handleWorkbenchApiRequest(new Request('http://127.0.0.1:4399/api/video-workbench/export', { method: 'POST', body: JSON.stringify({ projectDir: BASIC, formats: ['srt', 'vtt'] }) }))
  const j = await http.json()
  assert.equal(http.status, 200)
  assert.ok(j.ok && /rel=output%2Fexport%2Fsubtitles\.srt/.test(j.urls.srt))
  await assert.rejects(() => dx.exportProjectPackage({ projectDir: BASIC, formats: ['capcut'] }), /不支持的导出格式/)
})

// ------------------------------------------------------------------------------------------
// 7. Temporal QA on real encoded clips (FFmpeg signalstats / freezedetect / scdet)
// ------------------------------------------------------------------------------------------
async function temporalFor(file, script) {
  return qa.runTemporalQaAnalysis({ mp4Path: file, script, fps: 30, durationSec: Number((await probe(file)).format.duration) })
}
const tinyScript = (scenes) => ({ fps: 30, scenes })

await test('QA clips: 5 Hz full-frame strobe → fail, 3 Hz → warning, small-area strobe → pass', async () => {
  const mk = async (name, expr) => {
    const f = join(SCRATCH, `${name}.mp4`)
    await ff(['-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=30:d=4', '-vf', `geq=lum='${expr}':cb=128:cr=128,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', f])
    return f
  }
  const scenes = [{ id: 'scene-01', startFrame: 0, durationInFrames: 120 }]
  const s5 = await temporalFor(await mk('strobe5', 'if(lt(mod(N,6),2),235,40)'), tinyScript(scenes))
  assert.equal(s5.flash.severity, 'fail')
  assert.equal(s5.flash.maxFlashesPerSec, 5)
  assert.equal(s5.checks[0].passed, false)
  assert.match(s5.checks[0].value, /超标/)
  const s3 = await temporalFor(await mk('strobe3', 'if(lt(mod(N,10),2),235,40)'), tinyScript(scenes))
  assert.equal(s3.flash.severity, 'warning')
  assert.equal(s3.flash.maxFlashesPerSec, 3)
  assert.ok(s3.checks[0].passed)
  const small = await temporalFor(await mk('strobe-small', 'if(lt(X,40)*lt(Y,22)*lt(mod(N,6),2),235,90)'), tinyScript(scenes))
  assert.equal(small.flash.severity, 'pass')
})
await test('QA clips: frozen frames vs planned hold, jump cut at a planned boundary, single foreign glitch frame', async () => {
  const freezeClip = join(SCRATCH, 'freeze.mp4')
  // 3 s moving → 3 s frozen (last frame cloned) → hard cut to 3 s of a different moving pattern
  await ff([
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=3',
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=3',
    '-filter_complex', '[0:v]tpad=stop_mode=clone:stop_duration=3[a];[a][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]',
    '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', freezeClip,
  ])
  const animated = tinyScript([
    { id: 'scene-01', startFrame: 0, durationInFrames: 90, kenBurns: 'zoom-in' },
    { id: 'scene-02', startFrame: 90, durationInFrames: 90, kenBurns: 'pan-right' },
    { id: 'scene-03', startFrame: 180, durationInFrames: 90 },
  ])
  const a = await temporalFor(freezeClip, animated)
  assert.equal(a.freeze.severity, 'warning', JSON.stringify(a.freeze))
  assert.equal(a.freeze.unexplained.length, 1)
  assert.ok(Math.abs(a.freeze.unexplained[0].startSec - 3) < 0.1 && a.freeze.unexplained[0].durationSec > 2.5)
  assert.deepEqual(a.freeze.unexplained[0].sceneIds, ['scene-02'])
  assert.ok(a.jumps.plannedCount >= 1 && a.jumps.unplanned.length === 0, JSON.stringify(a.jumps))
  const held = await temporalFor(freezeClip, tinyScript([
    { id: 'scene-01', startFrame: 0, durationInFrames: 90 },
    { id: 'scene-02', startFrame: 90, durationInFrames: 90, recipe: 'hold' },
    { id: 'scene-03', startFrame: 180, durationInFrames: 90 },
  ]))
  assert.equal(held.freeze.severity, 'pass')
  assert.equal(held.checks.find((c) => /冻结帧/.test(c.name)).severity, 'pass')

  const glitchClip = join(SCRATCH, 'glitch.mp4')
  await ff([
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4',
    '-f', 'lavfi', '-i', 'smptebars=size=320x180:rate=30:duration=1',
    '-f', 'lavfi', '-i', 'rgbtestsrc=size=320x180:rate=30:duration=2',
    '-filter_complex', '[0:v]split=2[t1][t2];[t1]trim=end_frame=45,setpts=PTS-STARTPTS[a];[1:v]trim=start_frame=10:end_frame=11,setpts=PTS-STARTPTS[g];[t2]trim=start_frame=46:end_frame=90,setpts=PTS-STARTPTS[b];[2:v]setpts=PTS-STARTPTS[c];[a][g][b][c]concat=n=4:v=1:a=0,format=yuv420p[v]',
    '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', glitchClip,
  ])
  const g = await temporalFor(glitchClip, tinyScript([
    { id: 'scene-01', startFrame: 0, durationInFrames: 90 },
    { id: 'scene-02', startFrame: 90, durationInFrames: 60 },
  ]))
  assert.equal(g.jumps.glitchCandidates.length, 1, JSON.stringify(g.jumps))
  assert.ok(Math.abs(g.jumps.glitchCandidates[0].startSec - 1.5) < 0.05)
  assert.ok(g.jumps.plannedCount >= 1, 'the cut at the scene-02 boundary is planned')
  assert.equal(g.jumps.severity, 'warning')
  const jc = g.checks.find((c) => /跳帧/.test(c.name))
  assert.ok(jc.passed && /疑似单帧坏帧/.test(jc.value))
})
await test('runPostRenderQa: existing checks unchanged + new checks appended + report persisted', async () => {
  const script = basicScript()
  const report = await qa.runPostRenderQa({ projectDir: BASIC, script, expectedWidth: 320, expectedHeight: 180 })
  const names = report.checks.map((c) => c.name)
  assert.deepEqual(names.slice(0, 5), ['分辨率与像素格式 (H.264 yuv420p)', 'AAC 立体声音频轨 (48kHz)', '成片与配音时长同步 (偏差 ≤ 0.45s)', '异常黑屏检测 (blackdetect)', '响度与峰值标准 (EBU R128)'])
  assert.ok(names.some((n) => /^商用字体与平台安全区/.test(n)))
  assert.ok(names.includes('成片抽帧 3×3 视觉质检墙'))
  assert.ok(names.includes('光敏癫痫闪烁风险 (WCAG/Harding ≤3次/秒)'))
  assert.ok(names.some((n) => /冻结帧检测/.test(n)) && names.some((n) => /跳帧\/渲染故障检测/.test(n)))
  assert.equal(report.photosensitivity.severity, 'pass')
  assert.equal(report.frozenFrames.severity, 'pass')
  assert.equal(report.jumpCuts.unplanned.length, 0)
  const saved = JSON.parse(readFileSync(join(BASIC, 'output', 'qa_report.json'), 'utf8'))
  assert.equal(saved.checks.length, report.checks.length)
  // Deep mode degrades gracefully when nothing can be re-rendered (no index.html / Remotion src)
  const deep = await qa.runPostRenderQa({ projectDir: BASIC, script, deep: true, temporal: false })
  const dc = deep.checks.find((c) => /确定性/.test(c.name))
  assert.ok(dc && dc.passed && dc.severity === 'skipped')
  assert.ok(!deep.checks.some((c) => /光敏/.test(c.name)), 'temporal:false must skip the temporal pass')
})

// ------------------------------------------------------------------------------------------
// 8. Browser / Remotion cases
// ------------------------------------------------------------------------------------------
const HTML_PROJ = join(SCRATCH, 'html-determinism')
const htmlPage = (random) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#000">
<canvas id="c" width="320" height="180"></canvas>
<script>
window.__totalFrames = 60;
window.__seekToFrame = function (f) {
  var ctx = document.getElementById('c').getContext('2d');
  ctx.fillStyle = 'rgb(' + ((f * 4) % 256) + ',' + ((f * 7) % 256) + ',' + ((f * 13) % 256) + ')';
  ctx.fillRect(0, 0, 320, 180);
  ctx.fillStyle = '#fff';
  ctx.fillRect((f * 5) % 300, 80, 20, 20);
  ${random ? 'ctx.fillRect(Math.random() * 280, 10, 40, 40);' : ''}
};
</script></body></html>`
await test('determinism (HTML engine): stable page passes, Math.random page fails', async () => {
  mkdirSync(HTML_PROJ, { recursive: true })
  const script = { engine: 'html', fps: 30, width: 320, height: 180, totalDurationInFrames: 60, scenes: [] }
  writeFileSync(join(HTML_PROJ, 'index.html'), htmlPage(false))
  const ok = await detCheck.runDeterminismCheck({ projectDir: HTML_PROJ, script, engine: 'html', frames: [5, 30, 55] })
  assert.equal(ok.deterministic, true, JSON.stringify(ok.frames))
  assert.equal(ok.severity, 'pass')
  writeFileSync(join(HTML_PROJ, 'index.html'), htmlPage(true))
  const bad = await detCheck.runDeterminismCheck({ projectDir: HTML_PROJ, script, engine: 'html', frames: [5, 30] })
  assert.equal(bad.deterministic, false)
  assert.equal(bad.severity, 'fail')
  assert.match(detCheck.buildDeterminismCheck(bad).value, /不确定渲染/)
}, { skip: SKIP_RENDER || !shared.resolveBrowserExecutable() })

const REM = join(SCRATCH, 'remotion-chunks')
const remRoot = (extra = '') => `import React from 'react';
import { Composition, AbsoluteFill, Audio, staticFile, useCurrentFrame } from 'remotion';
${extra}
const Comp: React.FC = () => {
  const f = useCurrentFrame();
  const g = Math.min(252, f * 4);
  return (
    <AbsoluteFill style={{ backgroundColor: 'rgb(' + g + ',' + g + ',' + g + ')' }}>
      <Audio src={staticFile('master-audio.wav')} />
    </AbsoluteFill>
  );
};
export const RemotionRoot: React.FC = () => (
  <Composition id="MainVideo" component={Comp} durationInFrames={64} fps={30} width={160} height={90} />
);
`
async function frameIndices(mp4) {
  const raw = join(SCRATCH, 'frames.gray')
  await ff(['-i', mp4, '-vf', 'scale=1:1:flags=area,format=gray', '-f', 'rawvideo', raw])
  const idx = [...readFileSync(raw)].map((v) => Math.round(v / 4))
  unlinkSync(raw)
  return idx
}
const exactFrames = (idx) => idx.length === 64 && idx.every((v, i) => v === Math.min(63, i))
const leakedBundles = () => readdirSync(tmpdir()).filter((n) => n.startsWith('remotion-webpack-bundle-') && !tmpBundlesBefore.has(n))

await test('chunked Remotion render: frame-exact concat, A/V drift ≤ 1 frame, manifest, no leaked bundle', async () => {
  mkdirSync(join(REM, 'src'), { recursive: true })
  mkdirSync(join(REM, 'public'), { recursive: true })
  mkdirSync(join(REM, 'output'), { recursive: true })
  writeFileSync(join(REM, 'script.json'), JSON.stringify({ title: 'chunks', engine: 'remotion', fps: 30, width: 160, height: 90, totalDurationInFrames: 64, scenes: [] }))
  writeFileSync(join(REM, 'src', 'index.ts'), "import { registerRoot } from 'remotion';\nimport { RemotionRoot } from './Root';\nregisterRoot(RemotionRoot);\n")
  writeFileSync(join(REM, 'src', 'Root.tsx'), remRoot())
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2.3', '-ac', '2', join(REM, 'public', 'master-audio.wav')])
  const out = join(REM, 'output', 'final.mp4')
  const r = await fr.renderRemotionProject({ projectDir: REM, outMp4Path: out, chunkSec: 0.7, snapshotFrames: [0, 63], snapshotDir: join(REM, 'output', 'snaps') })
  assert.equal(r.chunked.enabled, true)
  assert.equal(r.chunked.totalChunks, 3)
  assert.equal(r.chunked.renderedChunks, 3)
  assert.equal(r.chunked.audioMode, 'master')
  assert.ok(r.chunked.verify.driftSec <= 1 / 30)
  assert.ok(exactFrames(await frameIndices(out)), 'no duplicated / dropped frame at chunk boundaries')
  const info = await probe(out)
  assert.ok(info.streams.some((s) => s.codec_type === 'audio' && s.codec_name === 'aac'))
  const manifest = JSON.parse(readFileSync(join(REM, 'output', '.chunks', 'manifest.json'), 'utf8'))
  assert.equal(manifest.chunks.filter((c) => c.done).length, 3)
  assert.ok(existsSync(join(REM, 'output', 'snaps', 'shot_01.png')))
  assert.deepEqual(leakedBundles(), [], 'bundle created by the render must be deleted')
}, { skip: SKIP_RENDER })

await test('chunked render: unchanged inputs reuse every chunk and skip bundling', async () => {
  const out = join(REM, 'output', 'final.mp4')
  writeFileSync(join(REM, 'script.json'), JSON.stringify({ title: 'chunks', engine: 'remotion', fps: 30, width: 160, height: 90, totalDurationInFrames: 64, scenes: [], updatedAt: new Date().toISOString() }))
  const r = await fr.renderRemotionProject({ projectDir: REM, outMp4Path: out, chunkSec: 0.7 })
  assert.equal(r.chunked.bundleSkipped, true)
  assert.equal(r.chunked.reusedChunks, 3)
  assert.equal(r.chunked.renderedChunks, 0)
  assert.ok(exactFrames(await frameIndices(out)))
}, { skip: SKIP_RENDER })

await test('chunked render: abort mid-render keeps finished chunks; resume renders only the rest', async () => {
  const out = join(REM, 'output', 'final.mp4')
  writeFileSync(join(REM, 'src', 'Root.tsx'), remRoot('// revision 2'))
  const controller = new AbortController()
  let aborted = false
  await assert.rejects(
    () =>
      fr.renderRemotionProject({
        projectDir: REM,
        outMp4Path: out,
        chunkSec: 0.7,
        signal: controller.signal,
        onProgress: (p) => {
          if (!aborted && /分段 2\/3 渲染中/.test(p.message || '')) {
            aborted = true
            controller.abort()
          }
        },
      }),
    (err) => err?.name === 'AbortError',
  )
  const manifest = JSON.parse(readFileSync(join(REM, 'output', '.chunks', 'manifest.json'), 'utf8'))
  const done = manifest.chunks.filter((c) => c.done)
  assert.equal(done.length, 1, JSON.stringify(manifest.chunks))
  assert.ok(existsSync(join(REM, 'output', '.chunks', done[0].file)))
  assert.ok(!readdirSync(join(REM, 'output', '.chunks')).some((n) => n.endsWith('.partial.mp4')), 'partial chunk must be removed')
  assert.deepEqual(leakedBundles(), [])
  const r = await fr.renderRemotionProject({ projectDir: REM, outMp4Path: out, chunkSec: 0.7 })
  assert.equal(r.chunked.reusedChunks, 1)
  assert.equal(r.chunked.renderedChunks, 2)
  assert.ok(exactFrames(await frameIndices(out)))
}, { skip: SKIP_RENDER })

await test('chunked render: non-trivial composition audio (volume prop) is rendered by Remotion, not raw-muxed', async () => {
  const proj = join(SCRATCH, 'remotion-comp-audio')
  mkdirSync(join(proj, 'src'), { recursive: true })
  mkdirSync(join(proj, 'public'), { recursive: true })
  mkdirSync(join(proj, 'output'), { recursive: true })
  writeFileSync(join(proj, 'script.json'), JSON.stringify({ title: 'comp-audio', engine: 'remotion', fps: 30, width: 160, height: 90, totalDurationInFrames: 64, scenes: [] }))
  writeFileSync(join(proj, 'src', 'index.ts'), "import { registerRoot } from 'remotion';\nimport { RemotionRoot } from './Root';\nregisterRoot(RemotionRoot);\n")
  writeFileSync(join(proj, 'src', 'Root.tsx'), remRoot().replace("<Audio src={staticFile('master-audio.wav')} />", "<Audio src={staticFile('master-audio.wav')} volume={0.5} />"))
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2.3', '-ac', '2', join(proj, 'public', 'master-audio.wav')])
  const out = join(proj, 'output', 'final.mp4')
  const r = await fr.renderRemotionProject({ projectDir: proj, outMp4Path: out, chunkSec: 1 })
  assert.equal(r.chunked.audioMode, 'composition')
  assert.ok(r.chunked.verify.driftSec <= 1 / 30)
  assert.ok(exactFrames(await frameIndices(out)))
  const rendered = await measureLufs([out])
  const raw = await measureLufs([join(proj, 'public', 'master-audio.wav')])
  assert.ok(raw - rendered > 4.5 && raw - rendered < 7.5, `volume={0.5} should be ≈ -6 dB: raw ${raw} vs rendered ${rendered}`)
  assert.deepEqual(leakedBundles(), [])
}, { skip: SKIP_RENDER })

await test('legacy single pass (chunkSec 0) still works and deletes its bundle', async () => {
  const out = join(REM, 'output', 'legacy.mp4')
  const r = await fr.renderRemotionProject({ projectDir: REM, outMp4Path: out, chunkSec: 0 })
  assert.equal(r.chunked.enabled, false)
  assert.ok(exactFrames(await frameIndices(out)))
  assert.deepEqual(leakedBundles(), [])
}, { skip: SKIP_RENDER })

await test('determinism (Remotion engine): renderStill twice → identical pixels', async () => {
  const res = await detCheck.runDeterminismCheck({ projectDir: REM, script: { engine: 'remotion', fps: 30, totalDurationInFrames: 64, scenes: [] }, engine: 'remotion', frames: [5, 40] })
  assert.equal(res.engine, 'remotion')
  assert.equal(res.deterministic, true, JSON.stringify(res.frames))
  assert.deepEqual(leakedBundles(), [])
}, { skip: SKIP_RENDER || !existsSync(join(REM, 'src', 'Root.tsx')) })

await test('motion blur: generated VideoComposition type-checks and renders a blurred still', async () => {
  const { scaffoldVideoProject } = await imp('packages/dsh-preset-video/index.js')
  const { writeRemotionProjectFiles } = await imp('packages/dsh-tool-media/remotion-generator.js')
  const proj = join(SCRATCH, 'motion-blur')
  const { script } = scaffoldVideoProject(proj, { title: '动态模糊测试', engine: 'remotion' })
  const vcDefault = readFileSync(join(proj, 'src', 'VideoComposition.tsx'), 'utf8')
  assert.match(vcDefault, /import \{ CameraMotionBlur \} from '@remotion\/motion-blur'/)
  assert.match(vcDefault, /<SceneMotionBlur scene=\{scene\}>/)
  const next = {
    ...script,
    width: 480,
    height: 270,
    motionBlur: { enabled: true, shutterAngle: 180, samples: 3 },
    scenes: script.scenes.map((s, i) => (i === 1 ? { ...s, motionBlur: { enabled: false } } : s)),
  }
  const saved = shared.writeScriptJson(proj, next)
  writeRemotionProjectFiles(proj, saved.data)
  const tsc = await qa.runTypecheckOnProject(proj)
  assert.ok(tsc.ok, `tsc --noEmit failed: ${(tsc.errors || []).join(' | ')}`)
  if (!SKIP_RENDER) {
    const snapDir = join(proj, 'output', 'mb-snaps')
    const r = await fr.renderRemotionProject({ projectDir: proj, onlySnapshots: true, snapshotFrames: [40], snapshotDir: snapDir })
    assert.ok(r.ok, r.reason)
    assert.ok(existsSync(join(snapDir, 'shot_00.png')) && statSync(join(snapDir, 'shot_00.png')).size > 1000)
    assert.deepEqual(leakedBundles(), [])
  }
})

await test('executeVideoRender (Remotion): chunked render + stems + temporal QA end to end', async () => {
  const { scaffoldVideoProject } = await imp('packages/dsh-preset-video/index.js')
  const { writeRemotionProjectFiles } = await imp('packages/dsh-tool-media/remotion-generator.js')
  const suite = await imp('packages/dsh-tool-video-suite/index.js')
  const proj = join(SCRATCH, 'e2e-render')
  const { script } = scaffoldVideoProject(proj, { title: '端到端分段渲染', engine: 'remotion' })
  const saved = shared.writeScriptJson(proj, {
    ...script,
    width: 320,
    height: 180,
    scenes: script.scenes.map((s) => ({ ...s, durationSec: 1, durationInFrames: 30 })),
  })
  writeRemotionProjectFiles(proj, saved.data)
  const res = await suite.executeVideoRender({ projectDir: proj, chunkSec: 1, writeStems: true })
  assert.equal(res.renderMethod, 'remotion-renderer-chunked')
  assert.equal(res.chunkedRender.totalChunks, 3)
  assert.equal(res.chunkedRender.audioMode, 'master')
  assert.ok(res.chunkedRender.verify.driftSec <= 1 / 30)
  const v = (await probe(res.outputPath)).streams.find((s) => s.codec_type === 'video')
  assert.equal(Number(v.nb_frames), 90)
  assert.ok(res.stems && existsSync(res.stems.bgm) && res.stems.bgm.includes(`${sep}output${sep}stems${sep}`))
  assert.equal(res.stems.roles.voice, 'silent')
  assert.ok(res.qaReport.checks.some((c) => /光敏/.test(c.name)) && res.qaReport.photosensitivity)
  assert.ok(existsSync(res.snapshotPath))
  assert.deepEqual(leakedBundles(), [])
}, { skip: SKIP_RENDER })

// ------------------------------------------------------------------------------------------
// Summary + cleanup
// ------------------------------------------------------------------------------------------
const failed = results.filter((r) => r.status === 'fail')
const passed = results.filter((r) => r.status === 'pass')
const skipped = results.filter((r) => r.status === 'skip')
try {
  safeRemove(SCRATCH)
} catch (err) {
  console.log(`cleanup warning: ${err.message}`)
}
const parent = dirname(SCRATCH)
try {
  if (existsSync(parent) && readdirSync(parent).length === 0) rmdirSync(parent)
} catch {}
console.log(`\n${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped · scratch ${existsSync(SCRATCH) ? 'NOT removed' : 'removed'}`)
process.exitCode = failed.length ? 1 : 0
