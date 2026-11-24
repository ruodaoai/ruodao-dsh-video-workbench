/**
 * Optional SuperCollider bridge (Vibecoding tool #6): renders SuperCollider code OFFLINE (NRT, faster than
 * real time, no audio device needed) into a WAV via the user's local `sclang`.
 *
 * SuperCollider is a separate desktop program (GPL) and is NOT bundled. When it is not installed, callers fall
 * back to the built-in deterministic JS DSP synthesizer (audio-dsp.js), so videos always render.
 *
 * Detection order: SCLANG_PATH env → `sclang` on PATH → common install folders (Windows/macOS/Linux).
 */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { REPO_ROOT, resolveEnvPath, runCommandRedirected } from '../shared/index.js'

function findOnPath(names) {
  const sep = process.platform === 'win32' ? ';' : ':'
  for (const dir of String(process.env.PATH || '').split(sep)) {
    if (!dir) continue
    for (const n of names) {
      const p = join(dir, n)
      if (existsSync(p)) return p
    }
  }
  return ''
}

function findInstallDirs() {
  const out = []
  if (process.platform === 'win32') {
    // Installer builds (Program Files), per-user installs and portable zip extractions on any drive
    // (e.g. <drive>:/video_tools/SuperCollider-3.14.1/sclang.exe or .../SuperCollider/sclang.exe).
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')]
    for (const letter of 'CDEFGHIJ') {
      const drive = `${letter}:/`
      if (!existsSync(drive)) continue
      roots.push(drive, join(drive, 'Program Files'), join(drive, 'video_tools'), join(drive, 'tools'), join(drive, 'Apps'), join(drive, 'dsh-ai'))
    }
    for (const root of roots) {
      if (!root || !existsSync(root)) continue
      try {
        for (const d of readdirSync(root)) {
          if (!/^supercollider/i.test(d)) continue
          out.push(join(root, d, 'sclang.exe'), join(root, d, 'SuperCollider', 'sclang.exe'))
        }
      } catch {}
    }
  } else if (process.platform === 'darwin') {
    out.push('/Applications/SuperCollider.app/Contents/MacOS/sclang', '/Applications/SuperCollider/SuperCollider.app/Contents/MacOS/sclang')
  } else {
    out.push('/usr/bin/sclang', '/usr/local/bin/sclang')
  }
  return out
}

let cached = null
/** { available, sclangPath, source, version } — cheap, cached; never launches sclang. */
export function detectSuperCollider({ refresh = false } = {}) {
  if (cached && !refresh) return cached
  let envPath = String(process.env.SCLANG_PATH || '').trim()
  if (!envPath) {
    try {
      envPath = String(resolveEnvPath('SCLANG_PATH', '') || '').trim()
    } catch {}
  }
  let sclangPath = ''
  let source = ''
  if (envPath && existsSync(envPath)) {
    sclangPath = envPath
    source = 'SCLANG_PATH'
  } else {
    const onPath = findOnPath(process.platform === 'win32' ? ['sclang.exe'] : ['sclang'])
    if (onPath) {
      sclangPath = onPath
      source = 'PATH'
    } else {
      const hit = findInstallDirs().find((p) => existsSync(p))
      if (hit) {
        sclangPath = hit
        source = 'install-dir'
      }
    }
  }
  const versionMatch = sclangPath.match(/SuperCollider[-\s]?([\d.]+)/i)
  cached = { available: Boolean(sclangPath), sclangPath, source, version: versionMatch ? versionMatch[1] : '' }
  return cached
}

const scString = (s) => `"${String(s).replace(/\\/g, '/').replace(/"/g, '\\"')}"`

/**
 * Build the NRT driver script. The score body (SuperCollider code that assigns `~score`, an Array of timed OSC
 * messages) lives in its own file and is executed as an independent top-level chunk, so a body written as
 * `( var a, b; ... ~score = ...; )` works too. Errors in the body are caught and a watchdog guarantees that
 * sclang always exits (an interactive sclang left open would only end at the caller timeout).
 *   ~score = [ [0.0, ['/d_recv', SynthDef(\\clang, {...}).asBytes]], [0.5, ['/s_new', \\clang, 1000, 0, 0]] ];
 */
export function buildNrtScript({ bodyPath, outWav, durationSec, sampleRate = 48000, channels = 2 }) {
  const dur = Math.max(0.1, Number(durationSec) || 1)
  const watchdog = Math.round(30 + dur * 4)
  return `~dshOut = ${scString(outWav)};
~dshDur = ${dur.toFixed(3)};
~score = nil;
SystemClock.sched(${watchdog}, { "DSH-SC-ERROR: watchdog timeout".postln; 1.exit; nil });
{ thisProcess.interpreter.executeFile(${scString(bodyPath)}) }.try({ |err| err.reportError; "DSH-SC-ERROR: score body failed".postln; 1.exit });
if(~score.isNil or: { ~score.isKindOf(SequenceableCollection).not }) { "DSH-SC-ERROR: ~score was not defined".postln; 1.exit };
{
  Score(~score.asArray ++ [[~dshDur, [\\c_set, 0, 0]]]).recordNRT(
    outputFilePath: ~dshOut,
    headerFormat: "WAV",
    sampleFormat: "int16",
    options: ServerOptions.new.numOutputBusChannels_(${Math.max(1, channels | 0)}).sampleRate_(${Math.round(sampleRate)}),
    duration: ~dshDur,
    action: { "DSH-SC-DONE".postln; 0.exit }
  );
}.try({ |err| err.reportError; "DSH-SC-ERROR: recordNRT failed".postln; 1.exit });
`
}

// LLM-authored SuperCollider runs inside sclang, which can reach the OS. Only pure synthesis/score code is allowed.
const FORBIDDEN_SC_PATTERNS = [
  /\b(?:unixCmd|systemCmd|unixCmdGetStdOut|unixCmdGetStdOutLines|runInTerminal|openOS|openDocument|openTextFile)\b/,
  /\b(?:Server|File|SoundFile|Pipe|PathName|Platform|Document|NetAddr|OSCFunc|OSCdef|HTTP|Archive|ZArchive|ScIDE|Quarks|Git|LanguageConfig)\b/,
  // anything that writes (openWrite, writeTextArchive, b_write, ...) or shells out
  /[Ww]rite|[Uu]nix|[Ss]hell|[Ss]ystem/,
  /\b(?:thisProcess|thisThread|thisFunction|interpret|interpretPrint|compile|compileFile|executeFile|loadPaths|loadRelative|readArchive|writeArchive|perform(?:List|Msg)?|performWithEnvir|respondsTo)\b/,
  /\.(?:load|loadDocument|write|writeDefFile|store|send)\b/,
  // NRT OSC commands that touch the filesystem or the server process
  /\b(?:b_write|b_close|d_load|d_loadDir|cmd|quit|dumpOSC)\b/,
  /\b(?:Server|s)\s*\.\s*(?:boot|quit|reboot|sendMsg|sendBundle|options)\b/,
  /\b(?:exit|die|halt)\b/,
]

/** Returns null when the body only builds SynthDefs + an `~score` array, otherwise a short reason. */
export function validateSuperColliderBody(body) {
  const src = String(body || '')
  if (!src.trim()) return 'empty score body'
  if (src.length > 60_000) return 'score body too large'
  if (!/~score\s*=/.test(src)) return '~score is never assigned'
  // ignore comments and string literals when scanning for forbidden calls
  const scan = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
  for (const rx of FORBIDDEN_SC_PATTERNS) {
    const m = scan.match(rx)
    if (m) return `forbidden SuperCollider call: ${m[0].trim()}`
  }
  return null
}

/**
 * Render SuperCollider NRT code to a WAV. Resolves { ok, outWav, stdout } or { ok: false, reason }.
 * Never throws for "not installed" — callers use the JS DSP fallback.
 */
export async function renderSuperColliderNrt({ body, outWav, durationSec, sampleRate = 48000, channels = 2, timeoutMs = 120_000, signal } = {}) {
  const sc = detectSuperCollider()
  if (!sc.available) return { ok: false, reason: 'not-installed' }
  const unsafe = validateSuperColliderBody(body)
  if (unsafe) return { ok: false, reason: 'unsafe-score', error: unsafe }
  const absOut = resolve(outWav)
  mkdirSync(dirname(absOut), { recursive: true })
  const workDir = existsSync(join(REPO_ROOT, '.tmp')) ? join(REPO_ROOT, '.tmp') : tmpdir()
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const scd = join(workDir, `sc-nrt-${stamp}.scd`)
  const bodyPath = join(workDir, `sc-nrt-${stamp}.body.scd`)
  writeFileSync(bodyPath, String(body || ''), 'utf8')
  writeFileSync(scd, buildNrtScript({ bodyPath, outWav: absOut, durationSec, sampleRate, channels }), 'utf8')
  try {
    if (existsSync(absOut)) unlinkSync(absOut)
  } catch {}
  try {
    const res = await runCommandRedirected(sc.sclangPath, [scd], { timeoutMs, signal, cwd: dirname(sc.sclangPath) })
    const log = `${res.stdout || ''}\n${res.stderr || ''}`
    const ok = existsSync(absOut) && statSync(absOut).size > 44 && /DSH-SC-DONE/.test(log)
    return ok ? { ok: true, outWav: absOut, stdout: log.slice(-2000) } : { ok: false, reason: /score body failed|syntax error|Parse error/i.test(log) ? 'score-error' : /DSH-SC-ERROR/.test(log) ? 'score-missing' : 'render-failed', stdout: log.slice(-2000) }
  } catch (err) {
    return { ok: false, reason: 'render-failed', error: err?.message || String(err) }
  } finally {
    for (const f of [scd, bodyPath]) {
      try {
        unlinkSync(f)
      } catch {}
    }
  }
}

/** A tiny NRT example (one metallic strike) used by the doctor / self-test when SuperCollider is present. */
export const SC_SAMPLE_CLASH_BODY = `
~score = [
  [0.0, ['/d_recv', SynthDef(\\dshClang, { |out = 0, amp = 0.5, freq = 2100|
    var env = EnvGen.ar(Env.perc(0.0005, 0.25), doneAction: 2);
    var partials = Mix.fill(6, { |i| SinOsc.ar(freq * [1, 1.37, 1.94, 2.53, 3.21, 3.92][i], 0, 0.18 / (i + 1)) * EnvGen.ar(Env.perc(0.0003, 0.03 + (0.01 * i))) });
    var crack = BPF.ar(WhiteNoise.ar, 3100, 0.8) * EnvGen.ar(Env.perc(0.0002, 0.012));
    Out.ar(out, Pan2.ar((partials + crack) * env * amp, 0));
  }).asBytes]],
  [0.05, ['/s_new', \\dshClang, 1000, 0, 0, \\amp, 0.6]]
];
`
