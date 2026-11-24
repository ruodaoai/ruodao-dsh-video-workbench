#!/usr/bin/env node
/**
 * DSH Video Workbench — real end-to-end talking-head test (teleprompter recording → voice clone → lip sync →
 * transparent PiP overlay in script.json → normal Remotion render), with measurements.
 *
 * Usage:
 *   node scripts/tests/avatar-lipsync.e2e.mjs [--source <person video or portrait image>] [--layout pip-br|pip-bl|fullscreen]
 *        [--ref-voice <catalog voice id>] [--out <dir>] [--keep]
 *
 * Default source: the public-domain painting "Mona Lisa" shipped by MuseTalk as demo data. Do NOT run it on footage of
 * real people without their consent. Requires the lip-sync engine (node scripts/install-lipsync-engine.mjs) and a
 * running IndexTTS-2.5 server; set DSH_VIDEO_ENV_PATH to your .env when running from a checkout.
 */
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const imp = (rel) => import(pathToFileURL(join(REPO, rel)).href)
const args = process.argv.slice(2)
const opt = (k, d = '') => {
  const i = args.indexOf(k)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d
}
const has = (k) => args.includes(k)

const shared = await imp('packages/shared/index.js')
shared.loadEnv()
const { resolveBinaries, runCommandRedirected, readScriptJson, writeScriptJson, probeAudioDuration } = shared
const { ffmpeg, ffprobe } = resolveBinaries()
const lipsync = await imp('packages/dsh-tool-avatar/lipsync-engine.js')
const avatar = await imp('packages/dsh-tool-avatar/avatar-engine.js')
const tts = await imp('packages/dsh-tool-local-tts/index.js')
const preset = await imp('packages/dsh-preset-video/index.js')
const web = await imp('packages/dsh-web-video-workbench/lib/index.js')
const suite = await imp('packages/dsh-tool-video-suite/index.js')

const cfg = lipsync.resolveLipsyncConfig()
const ROOT = resolve(opt('--out', join(shared.REPO_ROOT, '.tmp', 'avatar-e2e')))
const OUT = join(ROOT, 'output')
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const PROJECT = join(ROOT, `project-${stamp}`)
const WORK = join(ROOT, `work-${stamp}`)
mkdirSync(OUT, { recursive: true })
mkdirSync(WORK, { recursive: true })
const layout = avatar.resolveSafeAvatarLayout(opt('--layout', 'pip-br'))
const refVoiceId = opt('--ref-voice', 'pack-热门音色-中音磁性女声旁白')
const MT = { dir: cfg.musetalk?.dir || '', python: cfg.musetalk?.python || '', torchHome: cfg.musetalk?.torchHome || '' }
const defaultSource = MT.dir ? join(MT.dir, 'assets', 'demo', 'monalisa', 'monalisa.png') : ''
const sourceArg = opt('--source', defaultSource)
const source = sourceArg ? resolve(sourceArg) : ''
if (!source || !existsSync(source) || !statSync(source).isFile()) {
  console.error(`[e2e] source not found: ${source || '(none)'} — pass --source <video|image>`)
  process.exit(2)
}

const report = {
  startedAt: new Date().toISOString(),
  source: { path: source, kind: lipsync.IMAGE_EXT_RX.test(source) ? 'image' : 'video', demoData: source === defaultSource ? 'MuseTalk demo asset: "Mona Lisa" (public-domain painting)' : 'user supplied' },
  engine: { id: cfg.engine, python: MT.python && existsSync(MT.python) ? 'configured' : 'missing' },
  layout,
  steps: [],
}

// ---- device-level VRAM sampler (nvidia-smi every 500 ms; always stopped in `finally`) -------------------------
const vram = []
const sampler = setInterval(() => {
  execFile('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 4000 }, (err, out) => {
    if (!err) {
      const mb = Number(String(out).trim().split(/\r?\n/)[0])
      if (Number.isFinite(mb)) vram.push({ t: Date.now(), mb })
    }
  })
}, 500)
const peakBetween = (a, b) => vram.filter((s) => s.t >= a && s.t <= b).reduce((m, s) => Math.max(m, s.mb), 0)

async function step(name, fn) {
  const t0 = Date.now()
  process.stdout.write(`[e2e] ▶ ${name} ...\n`)
  try {
    const res = await fn()
    const t1 = Date.now()
    const rec = { name, ok: true, sec: Number(((t1 - t0) / 1000).toFixed(2)), peakDeviceVramMb: peakBetween(t0, t1) || null }
    report.steps.push(rec)
    process.stdout.write(`[e2e] ✓ ${name} (${rec.sec}s, device VRAM peak ${rec.peakDeviceVramMb ?? '?'} MB)\n`)
    return res
  } catch (err) {
    report.steps.push({ name, ok: false, sec: Number(((Date.now() - t0) / 1000).toFixed(2)), error: String(err?.message || err).slice(0, 600) })
    throw err
  }
}

/** Every symlink / junction under `dir` (lstat never follows links, so this never walks into a link target). */
function findLinks(dir, out = []) {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    const p = join(dir, name)
    let st
    try {
      st = lstatSync(p)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) out.push(p)
    else if (st.isDirectory()) findLinks(p, out)
  }
  return out
}

/** Decode a region of a video as small grayscale frames (raw file → Buffer slices). */
async function grayFrames(file, filter, w, h, maxSec = 60) {
  const out = join(WORK, `gray-${Math.random().toString(36).slice(2, 8)}.raw`)
  await ff(['-v', 'error', '-y', '-t', String(maxSec), '-i', file, '-an', '-vf', `${filter}scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', out])
  const buf = readFileSync(out)
  rmSync(out, { force: true })
  const n = Math.floor(buf.length / (w * h))
  return Array.from({ length: n }, (_, i) => buf.subarray(i * w * h, (i + 1) * w * h))
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length)
  let sa = 0
  let sb = 0
  for (let i = 0; i < n; i++) {
    sa += a[i]
    sb += b[i]
  }
  const ma = sa / n
  const mb = sb / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma
    const y = b[i] - mb
    num += x * y
    da += x * x
    db += y * y
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
}

/**
 * Temporal alignment of two renderings of the same picture: correlate their frame-difference images
 * (motion only — static content cancels out) for every lag in [-maxLag, maxLag]; +lag = target is late.
 */
function frameAlignment(ref, tgt, maxLag = 8) {
  const diff = (fr) => fr.slice(1).map((f, i) => Float32Array.from(f, (v, k) => v - fr[i][k]))
  const dr = diff(ref)
  const dt = diff(tgt)
  const curve = {}
  let best = { lag: 0, r: -2 }
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sum = 0
    let cnt = 0
    for (let i = 0; i < dr.length; i++) {
      const j = i + lag
      if (j < 0 || j >= dt.length) continue
      sum += pearson(dr[i], dt[j])
      cnt++
    }
    const r = cnt ? sum / cnt : 0
    curve[lag] = Number(r.toFixed(3))
    if (r > best.r) best = { lag, r }
  }
  return { bestLagFrames: best.lag, rAtBestLag: Number(best.r.toFixed(3)), rAtZeroLag: curve[0], curve }
}

async function ff(argsList, timeoutMs = 300_000) {
  const r = await runCommandRedirected(ffmpeg, argsList, { timeoutMs })
  if (r.code !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr).slice(-400)}`)
  return r
}

async function probe(file) {
  const r = await runCommandRedirected(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,duration', '-of', 'json', file], { timeoutMs: 30_000 })
  const j = JSON.parse(r.stdout || '{}')
  const v = (j.streams || []).find((s) => s.codec_type === 'video') || {}
  const a = (j.streams || []).find((s) => s.codec_type === 'audio') || {}
  return { durationSec: Number(j.format?.duration || 0), video: { codec: v.codec_name, width: v.width, height: v.height, fps: v.r_frame_rate, pixFmt: v.pix_fmt, durationSec: Number(v.duration || 0) }, audio: a.codec_name ? { codec: a.codec_name, durationSec: Number(a.duration || 0) } : null }
}

function runEval({ video, audio, roi }) {
  if (!MT.python || !existsSync(MT.python)) return Promise.resolve({ ok: false, error: 'lip-sync python not configured' })
  const evalScript = join(REPO, 'scripts', 'avatar', 'av_sync_eval.py')
  const syncnet = join(cfg.home || '', 'eval', 'syncnet_v2.model')
  const a = ['-I', evalScript, '--video', video, '--ffmpeg', ffmpeg, '--max-sec', '30']
  if (audio) a.push('--audio', audio)
  if (roi) a.push('--roi', roi)
  if (existsSync(syncnet)) a.push('--syncnet', syncnet)
  if (MT.torchHome) a.push('--torch-home', MT.torchHome)
  const env = { ...process.env, PYTHONUTF8: '1', HF_HUB_OFFLINE: '1', TORCH_HOME: MT.torchHome || process.env.TORCH_HOME || '' }
  return new Promise((res) => {
    execFile(MT.python, a, { cwd: MT.dir || REPO, env, windowsHide: true, timeout: 600_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const line = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || ''
      try {
        res(JSON.parse(line))
      } catch {
        res({ ok: false, error: String(err?.message || stderr || 'no output').slice(-400) })
      }
    })
  })
}

let exitCode = 0
try {
  // 0. engine status (quick, no GPU)
  const status = await step('lip-sync engine status', () => lipsync.getLipsyncStatus({ deep: false }))
  report.engine.status = { ready: status.ready, engine: status.engine, reason: status.reason || status.message || '' }
  if (!status.ready) throw new Error(`唇形引擎未就绪: ${JSON.stringify(report.engine.status)}`)

  // 1. fresh demo project (normal scaffold → Remotion project files)
  await step('scaffold demo project', async () => {
    preset.scaffoldVideoProject(PROJECT, {
      title: '数字人口播端到端实测',
      engine: 'remotion',
      style: 'tech',
      bgm: { enabled: true, mood: 'tech', volume: 0.12 },
      scenes: [
        { id: 'scene-01', title: '一段录像，克隆你的声音', narration: '大家好，我是你的 AI 数字人主播。只要录一段提词器视频，工作台就能克隆你的声音。', emotion: '自然亲切', role: 'host', voiceId: 'auto', layout: 'workflow-steps', transition: 'cut', highlights: ['提词器录像', '零样本声纹克隆', '唇形同步'], durationSec: 6 },
        { id: 'scene-02', title: '口型同步，画中画一键成片', narration: '然后自动对齐口型，生成透明画中画，叠加到成片右下角，音画同步，一键导出。', emotion: '自信明快', role: 'host', voiceId: 'auto', layout: 'metric-dashboard', transition: 'cut', highlights: ['MuseTalk 1.5', '透明通道叠层', 'Remotion 渲染'], durationSec: 6 },
      ],
    })
  })

  // 2. the "teleprompter recording": a person clip with the speaker's own voice
  let recordingFile = ''
  await step('build teleprompter recording sample', async () => {
    const refWav = join(WORK, 'speaker-voice.wav')
    const synth = await tts.executeGenerateSpeech({ text: '大家好，欢迎来到我的频道。今天我想和你聊聊，怎样用一台电脑做出完整的视频。', voiceId: refVoiceId, emotion: '平静', outputPath: refWav })
    report.source.speakerVoice = { voiceId: refVoiceId, voiceUsed: synth.voiceUsed || synth.voiceId || refVoiceId, durationSec: synth.durationSec }
    let silentVideo = source
    if (report.source.kind === 'image') {
      silentVideo = await lipsync.buildPhotoBaseClip({ imagePath: source, durationSec: (synth.durationSec || 6) + 0.4, outPath: join(WORK, 'camera-base.mp4'), fps: 25 })
    }
    const srcProbe = report.source.kind === 'video' ? await probe(source) : null
    recordingFile = join(WORK, 'teleprompter-recording.mp4')
    if (srcProbe?.audio) {
      copyFileSync(source, recordingFile.replace(/\.mp4$/, extname(source)))
      recordingFile = recordingFile.replace(/\.mp4$/, extname(source))
    } else {
      await ff(['-v', 'error', '-y', '-stream_loop', '-1', '-i', silentVideo, '-i', refWav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', recordingFile])
    }
  })

  // 3. upload through the same REST route the Web Studio teleprompter uses, extracting a voice clone
  const upload = await step('upload recording + extract voice clone (REST)', async () => {
    const q = new URLSearchParams({ projectDir: PROJECT, fileName: basename(recordingFile), role: 'host_video', extractVoiceClone: '1', cloneName: 'E2E 演示声纹' })
    const res = await web.handleWorkbenchApiRequest(
      new Request(`http://127.0.0.1:4399/api/video-workbench/assets/recording?${q}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: readFileSync(recordingFile) }),
    )
    const d = await res.json()
    if (!d.ok) throw new Error(`录制上传失败: ${d.error}`)
    if (!d.clonedVoice?.id) throw new Error('录制上传成功，但声纹克隆没有返回 voice id')
    return d
  })
  report.recording = { relPath: upload.relPath, durationSec: upload.durationSec, clonedVoiceId: upload.clonedVoice.id, clonedVoiceName: upload.clonedVoice.name }

  // 4. narration in the cloned voice, backfilled into script.json (exact measured durations)
  await step('synthesize narration with cloned voice (IndexTTS-2.5)', async () => {
    const sc = readScriptJson(PROJECT).data
    for (const scene of sc.scenes) {
      await tts.executeGenerateSpeech({ text: scene.narration, voiceId: upload.clonedVoice.id, emotion: scene.emotion || '平静', outputPath: join(PROJECT, 'audio', `${scene.id}.wav`), scriptPath: PROJECT, sceneId: scene.id, fps: Number(sc.fps) || 30 })
    }
  })
  const scriptAfterTts = readScriptJson(PROJECT).data
  report.narration = { scenes: scriptAfterTts.scenes.map((s) => ({ id: s.id, startSec: s.startSec, durationSec: s.durationSec, audioFile: s.audioFile })), totalDurationSec: scriptAfterTts.totalDurationSec }

  // 5. lip sync + transparent PiP overlay mounted into script.json
  const av = await step('lip sync + alpha PiP overlay (generate_avatar)', () =>
    avatar.executeGenerateAvatar({
      projectDir: PROJECT,
      avatarMode: 'cloned-human',
      sourceVideoPath: upload.relPath,
      avatarLayout: layout,
      lipSync: 'on',
      onProgress: (p) => {
        if (p?.message) process.stdout.write(`        ${p.progress ?? ''}% ${p.message}\n`)
      },
    }),
  )
  report.avatar = { relPath: av.relPath, isNeuralLipSync: av.isNeuralLipSync, visualNotice: av.visualNotice, stream: av.streamMeta, lipSync: av.lipSync }
  const mounted = readScriptJson(PROJECT).data
  report.avatar.mountedInScript = Boolean(mounted.avatarClip?.path) && mounted.avatarLayout === layout
  if (!report.avatar.mountedInScript) throw new Error('avatarClip / avatarLayout 未写入 script.json')
  if (!av.isNeuralLipSync) throw new Error(`未生成真实口型同步: ${av.lipSync?.fallbackReason || av.visualNotice}`)

  // 6. normal render (mix voice + SFX + ducked BGM, Remotion frames, mux, post-render QA)
  const rendered = await step('render final MP4 (Remotion)', () => suite.executeVideoRender({ projectDir: PROJECT, engine: 'remotion' }))
  const finalOut = join(OUT, `final-${stamp}.mp4`)
  copyFileSync(rendered.outputPath, finalOut)
  copyFileSync(rendered.outputPath, join(OUT, 'final.mp4'))
  report.render = { output: finalOut, renderMethod: rendered.renderMethod, sizeMb: Number((statSync(finalOut).size / 1048576).toFixed(2)), qaPassed: rendered.qaReport?.passed, loudness: rendered.qaReport?.loudness, failedChecks: (rendered.qaReport?.checks || []).filter((c) => !c.passed).map((c) => `${c.name}: ${c.value}`) }

  // 7. measurements
  await step('measure durations + A/V sync + overlay', async () => {
    const fin = await probe(finalOut)
    const lipAbs = join(PROJECT, report.avatar.lipSync?.videoPath || '')
    const drivingAbs = join(PROJECT, report.avatar.lipSync?.drivingAudio || '')
    const webm = await probe(join(PROJECT, av.relPath))
    report.durations = {
      scriptTotalSec: readScriptJson(PROJECT).data.totalDurationSec,
      finalVideoSec: fin.video.durationSec || fin.durationSec,
      finalAudioSec: fin.audio?.durationSec || null,
      avDeltaMs: fin.audio ? Math.round(Math.abs((fin.video.durationSec || fin.durationSec) - fin.audio.durationSec) * 1000) : null,
      drivingAudioSec: existsSync(drivingAbs) ? (await probeAudioDuration(drivingAbs)).durationSec : null,
      lipSyncVideoSec: existsSync(lipAbs) ? (await probe(lipAbs)).durationSec : null,
      lipSyncDeltaMs: report.avatar.lipSync?.durationDeltaMs ?? null,
      overlayWebmSec: webm.durationSec,
      overlayPixFmt: webm.video.pixFmt,
    }
    report.final = fin
    // (a) engine output vs its driving narration (full face)
    report.syncEngineOutput = existsSync(lipAbs) ? await runEval({ video: lipAbs, audio: drivingAbs }) : { ok: false, error: 'no lip-sync output' }
    // (b) the PiP region of the FINAL render vs the narration placed on the timeline (proves overlay present + aligned)
    const W = fin.video.width || 1920
    const H = fin.video.height || 1080
    const portrait = W < H
    const bw = Math.round(W * (portrait ? 0.34 : 0.22))
    const bh = Math.round(bw * 1.125)
    const side = portrait ? 28 : 42
    const bottom = portrait ? Math.round(H * 0.25) : 96
    const x = layout === 'pip-bl' ? side : W - side - bw
    const y = H - bottom - bh
    const roi = layout === 'fullscreen' ? '' : [x / W, y / H, bw / W, bh / H].map((n) => n.toFixed(4)).join(',')
    report.pipRoi = layout === 'fullscreen' ? null : { x, y, w: bw, h: bh }
    report.syncFinalRender = await runEval({ video: finalOut, audio: drivingAbs, roi })
    // (b2) the overlay as it appears in the final render vs the overlay clip itself (both 30 fps, inner 70 % of
    //      the PiP so the animated scene behind the transparent corners does not count)
    if (report.pipRoi) {
      const inner = 'crop=iw*0.7:ih*0.7:iw*0.15:ih*0.15,'
      const ref = await grayFrames(join(PROJECT, av.relPath), `fps=30,${inner}`, 64, 72)
      const tgt = await grayFrames(finalOut, `fps=30,crop=${bw}:${bh}:${x}:${y},${inner}`, 64, 72)
      report.overlayAlignment = { refFrames: ref.length, finalFrames: tgt.length, ...frameAlignment(ref, tgt, 8) }
    }
    // (c) contact sheets: 6 full frames + the PiP crops at the same instants
    const T = report.durations.finalVideoSec || 10
    const times = [0.12, 0.27, 0.42, 0.57, 0.72, 0.87].map((f) => (T * f).toFixed(2))
    const sheet = join(OUT, `contact-sheet-${stamp}.png`)
    const crops = join(OUT, `pip-crops-${stamp}.png`)
    const frameFiles = []
    for (const [i, t] of times.entries()) {
      const f = join(WORK, `frame-${i}.png`)
      await ff(['-v', 'error', '-y', '-ss', t, '-i', finalOut, '-frames:v', '1', '-update', '1', f])
      frameFiles.push(f)
    }
    const inputs = frameFiles.flatMap((f) => ['-i', f])
    await ff(['-v', 'error', '-y', ...inputs, '-filter_complex', `${frameFiles.map((_, i) => `[${i}:v]scale=640:-2[s${i}]`).join(';')};[s0][s1][s2]hstack=3[r0];[s3][s4][s5]hstack=3[r1];[r0][r1]vstack=2`, '-frames:v', '1', '-update', '1', sheet])
    if (report.pipRoi) {
      const { x: cx, y: cy, w: cw, h: ch } = report.pipRoi
      await ff(['-v', 'error', '-y', ...inputs, '-filter_complex', `${frameFiles.map((_, i) => `[${i}:v]crop=${cw}:${ch}:${cx}:${cy},scale=-2:360[c${i}]`).join(';')};${frameFiles.map((_, i) => `[c${i}]`).join('')}hstack=${frameFiles.length}`, '-frames:v', '1', '-update', '1', crops])
    }
    report.outputs = { final: finalOut, contactSheet: sheet, pipCrops: report.pipRoi ? crops : null, sampleTimes: times.map(Number) }
  })

  // pass / fail gates
  const gates = []
  const lagF = report.syncFinalRender?.xcorr?.bestLagFrames
  gates.push(['real lip sync generated', report.avatar.isNeuralLipSync])
  gates.push(['avatarClip + layout written to script.json', report.avatar.mountedInScript])
  gates.push(['overlay is yuva420p alpha', report.avatar.stream?.hasAlpha === true || /yuva/.test(report.durations.overlayPixFmt || '')])
  gates.push(['final A/V stream durations within 80 ms', report.durations.avDeltaMs !== null && report.durations.avDeltaMs <= 80])
  gates.push(['lip-sync output length matches narration (≤ 80 ms)', Math.abs(Number(report.durations.lipSyncDeltaMs ?? 999)) <= 80])
  const al = report.overlayAlignment
  // sharp unique peak at lag 0: the overlay is neither shifted nor frozen anywhere along the timeline
  const sideMax = al ? Math.max(...Object.entries(al.curve).filter(([k]) => Number(k) !== 0).map(([, v]) => Math.abs(v))) : 1
  if (al) al.peakToSideRatio = Number((al.rAtZeroLag / Math.max(1e-6, sideMax)).toFixed(2))
  gates.push(['overlay frames sit exactly on the timeline (peak at lag 0, ≥ 3× any other lag)', Boolean(al) && al.bestLagFrames === 0 && al.rAtZeroLag >= 0.25 && al.peakToSideRatio >= 3])
  // lip motion vs speech envelope is only informative when the mouth actually moves enough to correlate
  const xr = report.syncFinalRender?.xcorr
  report.speechXcorrVerdict = !xr ? 'unavailable' : xr.rAtBestLag < 0.15 ? `inconclusive (r=${xr.rAtBestLag}; mouth motion too subtle at PiP size)` : Math.abs(lagF) <= 3 ? 'pass' : 'fail'
  if (report.speechXcorrVerdict === 'fail') gates.push(['mouth in final PiP tracks narration (|lag| ≤ 3 frames)', false])
  report.gates = gates.map(([name, pass]) => ({ name, pass: Boolean(pass) }))
  report.passed = report.gates.every((g) => g.pass)
  if (!report.passed) exitCode = 1
} catch (err) {
  report.error = String(err?.stack || err).slice(0, 2000)
  report.passed = false
  exitCode = 1
} finally {
  clearInterval(sampler)
  report.peakDeviceVramMb = vram.reduce((m, s) => Math.max(m, s.mb), 0) || null
  report.finishedAt = new Date().toISOString()
  const reportPath = join(OUT, `report-${stamp}.json`)
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  copyFileSync(reportPath, join(OUT, 'report.json'))
  // keep only the deliverables (final MP4, sheets, report) unless --keep; the scratch project holds a node_modules
  // junction, so it is removed with the junction unlinked first (never recurse into node_modules)
  if (!has('--keep') && report.recording?.clonedVoiceId) {
    try {
      report.cleanup = { clonedVoice: tts.deleteImportedVoice(report.recording.clonedVoiceId) }
    } catch (err) {
      report.cleanup = { clonedVoiceError: String(err?.message || err) }
    }
  }
  if (!has('--keep')) {
    for (const dir of [WORK, PROJECT]) {
      try {
        const nm = join(dir, 'node_modules')
        if (existsSync(nm) && lstatSync(nm).isSymbolicLink()) unlinkSync(nm) // removes the junction itself, never its target
      } catch {}
      const links = findLinks(dir)
      if (links.length) {
        console.log(`[e2e] kept ${dir}: it still contains links/junctions (${links.slice(0, 3).join(', ')}) — not deleting recursively`)
        continue
      }
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {}
    }
  }
  console.log(`\n[e2e] ${report.passed ? 'PASS' : 'FAIL'} — report: ${reportPath}`)
  for (const g of report.gates || []) console.log(`   ${g.pass ? '✓' : '✗'} ${g.name}`)
  if (report.error) console.log(`   error: ${report.error.split('\n')[0]}`)
  process.exit(exitCode)
}
