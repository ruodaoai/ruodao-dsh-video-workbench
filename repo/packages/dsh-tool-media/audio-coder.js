import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import vm from 'node:vm'
import { createAbortError, resolveBinaries, resolveStyleKey, runCommandRedirected } from '../shared/index.js'
import { executeGenerateSpeech } from '../dsh-tool-local-tts/index.js'
import { DSP_SR, encodeStereoWav } from './audio-dsp.js'
import { callLlmChat, extractJsonFromLlmText, getSafeLlmConfigSummary } from './llm-client.js'
import { detectSuperCollider, renderSuperColliderNrt } from './supercollider-bridge.js'
import { isAudibleAudio, measureLoudnessStats } from './audio-synth.js'
import { isBillingError } from './cloud-ledger.js'

const FORBIDDEN_AUDIO_CODE_PATTERNS = [
  { rx: /\brequire\s*\(/, reason: '禁止使用 require()' },
  { rx: /\bimport\s+[\s\S]*?\bfrom\b|\bimport\s*\(/, reason: '禁止在音频合成脚本中使用 import 语句' },
  { rx: /\b(?:process|globalThis|global|Buffer)\b/, reason: '禁止访问 Node 全局对象或进程对象' },
  { rx: /\b(?:child_process|fs\/promises|node:fs|node:vm|worker_threads)\b/, reason: '禁止引用系统模块' },
  { rx: /\b(?:eval|Function)\s*\(/, reason: '禁止使用 eval() 或 new Function()' },
  { rx: /\b(?:fetch|XMLHttpRequest|WebSocket)\b/, reason: '禁止在音频合成代码中发起网络请求' },
  { rx: /while\s*\(\s*true\s*\)/, reason: '禁止死循环 while(true)' },
]

/**
 * Verify LLM-authored DSP synthesis code strictly uses pure math without filesystem,
 * network, process, or dynamic eval access.
 */
export function scanAiAudioCodeSandbox(code) {
  const src = String(code || '')
  const errors = []
  if (!src.trim()) {
    errors.push('AI 配乐合成代码为空')
    return { ok: false, errors }
  }
  for (const item of FORBIDDEN_AUDIO_CODE_PATTERNS) {
    if (item.rx.test(src)) {
      errors.push(item.reason)
    }
  }
  if (!/function\s+synthesizeBgm\b|const\s+synthesizeBgm\s*=|let\s+synthesizeBgm\s*=/.test(src)) {
    errors.push('脚本必须定义函数 synthesizeBgm(ctx)')
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Execute sandboxed JS audio synthesis code inside an isolated Node `vm` context
 * and encode normalized 48kHz stereo WAV output.
 */
export function executeAiAudioSynthScript({
  code,
  outWavPath,
  durationSec = 10,
  sampleRate = DSP_SR,
  bpm = 112,
  beats = [],
  mood = 'tech',
}) {
  const scan = scanAiAudioCodeSandbox(code)
  if (!scan.ok) {
    throw new Error(`AI 音频沙箱安检未通过: ${scan.errors.join('; ')}`)
  }

  const safeDur = Math.max(1, Math.min(180, Number(durationSec) || 10))
  const totalSamples = Math.max(sampleRate, Math.ceil(safeDur * sampleRate))

  // Strip optional `export ` modifiers so LLM ESM snippets execute inside isolated VM context
  const sanitizedBody = String(code)
    .replace(/\bexport\s+default\s+/g, '')
    .replace(/\bexport\s+(?=(?:function|const|let|var)\b)/g, '')

  const sandbox = {
    Math,
    Number,
    Array,
    Float32Array,
    Int16Array,
    String,
    Boolean,
    __dshInit: {
      sampleRate,
      durationSec: safeDur,
      totalSamples,
      bpm: Number(bpm) || 112,
      beats: Array.isArray(beats) ? beats : [],
      mood: String(mood || 'tech'),
    },
  }

  // Instantiate left/right buffers and DSP helpers INSIDE the VM realm to avoid V8 cross-context boundary overhead
  const wrappedScript = `
var __dshLeft = new Float32Array(__dshInit.totalSamples);
var __dshRight = new Float32Array(__dshInit.totalSamples);
var __dshCtx = {
  sampleRate: __dshInit.sampleRate,
  durationSec: __dshInit.durationSec,
  totalSamples: __dshInit.totalSamples,
  bpm: __dshInit.bpm,
  beats: __dshInit.beats,
  mood: __dshInit.mood,
  left: __dshLeft,
  right: __dshRight,
  midiToHz: function(midi) { return 440 * Math.pow(2, (Number(midi) - 69) / 12); },
  clamp: function(x, a, b) { if (a === void 0) a = -1; if (b === void 0) b = 1; return x < a ? a : (x > b ? b : x); },
  tanh: function(x) { return Math.tanh(x); },
};
${sanitizedBody}
;if (typeof synthesizeBgm !== 'function') { throw new Error('Missing synthesizeBgm(ctx)'); }
var __dshResult = synthesizeBgm(__dshCtx);
`
  const context = vm.createContext(sandbox)
  const vmTimeoutMs = Math.max(20000, Math.min(90000, Math.round(safeDur * 900)))
  vm.runInContext(wrappedScript, context, { timeout: vmTimeoutMs })

  const vmOutL = sandbox.__dshResult?.left?.length >= totalSamples ? sandbox.__dshResult.left : sandbox.__dshLeft
  const vmOutR = sandbox.__dshResult?.right?.length >= totalSamples ? sandbox.__dshResult.right : sandbox.__dshRight
  const outL = Float32Array.from(vmOutL)
  const outR = Float32Array.from(vmOutR)

  // Peak normalize + fade-in/out safety envelope
  let peak = 0
  let energy = 0
  for (let i = 0; i < totalSamples; i++) {
    const l = Number.isFinite(outL[i]) ? outL[i] : 0
    const r = Number.isFinite(outR[i]) ? outR[i] : 0
    outL[i] = l
    outR[i] = r
    const ap = Math.max(Math.abs(l), Math.abs(r))
    if (ap > peak) peak = ap
    energy += l * l + r * r
  }

  if (peak < 1e-4) {
    throw new Error('AI 配乐脚本生成的音频波形为静音，请检查振荡器与增益公式')
  }

  const normGain = peak > 0.9 ? 0.85 / peak : peak < 0.15 ? 0.65 / peak : 1.0
  const fadeSamples = Math.min(Math.floor(totalSamples * 0.12), Math.floor(sampleRate * 0.35))
  for (let i = 0; i < totalSamples; i++) {
    let env = 1
    if (i < Math.min(fadeSamples, Math.floor(sampleRate * 0.06))) {
      env = i / Math.max(1, Math.min(fadeSamples, Math.floor(sampleRate * 0.06)))
    } else if (i >= totalSamples - fadeSamples) {
      env = (totalSamples - 1 - i) / Math.max(1, fadeSamples)
    }
    outL[i] = Math.tanh(outL[i] * normGain * 0.9) * env
    outR[i] = Math.tanh(outR[i] * normGain * 0.9) * env
  }

  const wavBuf = encodeStereoWav(outL, outR, sampleRate)
  const absOut = resolve(outWavPath)
  mkdirSync(dirname(absOut), { recursive: true })
  writeFileSync(absOut, wavBuf)

  return {
    wavPath: absOut,
    sampleRate,
    durationSec: Number((totalSamples / sampleRate).toFixed(3)),
    rmsDb: Number((10 * Math.log10(Math.max(1e-12, energy / (totalSamples * 2)))).toFixed(2)),
    peakBeforeNorm: Number(peak.toFixed(4)),
  }
}

export function buildAudioCoderPromptPackage({
  topic = '',
  mood = 'tech',
  bpm = 112,
  durationSec = 10,
  beats = [],
  scenes = [],
}) {
  const system = `你是精通 Web Audio / PCM 数字信号合成 (DSP Synthesis) 的 AI 音乐作曲程序员。
你的任务是根据视频主题、情绪节奏与分镜结构，直接编写纯 JavaScript 时域 DSP 合成代码生成 48kHz 立体声背景音乐！

=== DSP 编程规范 (严格 JSON 输出) ===
1. 输出严格 JSON：{ "files": { "audio/ai_bgm_synth.js": "..." }, "summary": "简短说明乐器配器与律动", "bpm": 112 }
2. 代码中必须定义函数 \`function synthesizeBgm(ctx) { ... }\`。
3. \`ctx\` 提供：
   - \`sampleRate\`: 48000, \`durationSec\`: 总秒数, \`totalSamples\`: 总采样点数
   - \`bpm\`, \`beats\`, \`mood\`, \`left\` (Float32Array), \`right\` (Float32Array)
   - \`midiToHz(midi)\`, \`clamp(x, a, b)\`, \`tanh(x)\`
4. 沙箱禁止：严禁 require/import/fs/fetch/process/eval/Function/globalThis/while(true)。仅允许纯数学数组运算直接写入 \`ctx.left[i]\` 和 \`ctx.right[i]\`！
5. 音色与编曲质感：请结合柔和正弦/FM 合成垫音和弦 (Chords/Pad)、深沉次低音 (Sub Bassline)、卡点底鼓脉冲 (Kick envelope aligned to beatSec)、清脆闭镲或立体声琶音，做到宽声场（左右声道微相移/反相声像）且不刺耳、无破音。
6. 性能注意：请先在最外层预计算好各音符的 Hz / 相位增量与分段起止索引，保持内层逐采样循环轻量高效，避免百万级样本运算超时。`

  const user = JSON.stringify(
    {
      task: '编写 AI 定制配乐 JavaScript DSP 合成代码 (synthesizeBgm)',
      topic,
      mood,
      bpm,
      durationSec,
      beatsCount: Array.isArray(beats) ? beats.length : 0,
      scenes: (scenes || []).map((s, i) => ({
        index: i + 1,
        title: s.title,
        emotion: s.emotion,
        startSec: s.startSec,
        durationSec: s.durationSec,
      })),
    },
    null,
    2,
  )

  return { system, user }
}

/**
 * System prompt for the optional SuperCollider engine (Vibecoding tool #6). The model must answer with JSON
 * { "scd": "<SuperCollider code that assigns ~score>", "bpm": n, "summary": "..." } and use NRT-safe code only.
 */
export function buildSuperColliderBgmSystemPrompt({ bpm = 112, durationSec = 12, mood = 'cinematic' } = {}) {
  const beatSec = 60 / Math.max(40, Math.min(220, Number(bpm) || 112))
  return [
    '你是 SuperCollider 资深声音设计师兼作曲家。请为短视频编写一段可离线 NRT 渲染的完整配乐 Score。',
    '只返回 JSON：{"scd": "<SuperCollider 代码>", "bpm": 数字, "summary": "一句话中文说明"}。',
    '硬性规则：',
    "1. 代码必须把 ~score 赋值为 OSC 消息数组：先用 [0.0, ['/d_recv', SynthDef(\\name, {...}).asBytes]] 注册全部 SynthDef，再用 [时间秒, ['/s_new', \\name, 节点ID, 0, 0, \\参数, 值...]] 排布音符，必要时用 '/n_set' 和 '/n_free'。",
    '2. 禁止 s.boot、Server、File、SoundFile、Pipe、unixCmd、systemCmd、load、write、thisProcess、Platform、Routine/fork 等任何访问系统、文件或实时服务器的代码；只允许 UGen 合成与数组计算。',
    `3. 总时长 ${Number(durationSec).toFixed(2)} 秒，BPM ${Number(bpm) || 112}（每拍 ${beatSec.toFixed(4)} 秒），所有音符时间严格落在拍点或半拍/四分之一拍上；情绪 ${mood}。`,
    '4. 编配要有前奏、推进、高潮与收尾；鼓组（kick/snare/hat）与低音锁拍；所有 SynthDef 用 doneAction: 2 自动释放；输出到总线 0（立体声，Pan2），整体峰值不超过 0.8，避免削波。',
    '5. 代码结构保持简单：可以先用 var 或 ~环境变量 定义 SynthDef 与音符表，最后一行必须把完整数组赋给 ~score；整体响度目标约 -16 LUFS（不要把音量压得过低，系统会再做精确响度校准）。',
    '6. 不要输出 Markdown 代码块，不要解释，只输出 JSON。',
  ].join('\n')
}

/** Bring an AI-rendered music bed to a sane level (linear gain + gentle limiter); returns the measured LUFS. */
async function normalizeBgmLoudness(wavFile, targetLufs = -16) {
  try {
    const { ffmpeg } = resolveBinaries()
    const st = await measureLoudnessStats(ffmpeg, wavFile)
    if (!Number.isFinite(st.lufs)) return null
    const gainDb = Math.max(-20, Math.min(30, targetLufs - st.lufs))
    if (Math.abs(gainDb) < 0.5) return st.lufs
    const tmp = wavFile.replace(/\.wav$/i, '.norm.wav')
    const res = await runCommandRedirected(
      ffmpeg,
      ['-y', '-i', wavFile, '-af', `volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.89:level=disabled`, '-ar', '48000', '-c:a', 'pcm_s16le', tmp],
      { timeoutMs: 120_000 },
    )
    if (res.code === 0 && existsSync(tmp)) {
      try {
        unlinkSync(wavFile)
      } catch {}
      renameSync(tmp, wavFile)
      return Number((st.lufs + gainDb).toFixed(1))
    }
  } catch {}
  return null
}

/** The JS DSP composer gets one corrective retry (see generateAiCodedBgmTrack). */
export const AI_BGM_MAX_ATTEMPTS = 2

/**
 * False only when the WAV is missing or MEASURED silent (a broken score can render digital silence); an FFmpeg build
 * that cannot measure keeps the previous behaviour (the render is accepted).
 */
export async function isAudibleMusicBed(wavFile) {
  if (!wavFile || !existsSync(wavFile)) return false
  const { ffmpeg } = resolveBinaries()
  return (await isAudibleAudio(ffmpeg, wavFile)) !== false
}

function unlinkQuiet(file) {
  try {
    if (file && existsSync(file)) unlinkSync(file)
  } catch {}
}

/** Move a validated render into place (the final name only ever holds a finished, audible track). */
function replaceWithRender(tmpFile, finalFile) {
  unlinkQuiet(finalFile)
  renameSync(tmpFile, finalFile)
}

function parseJsonFromLlmText(rawText) {
  const cleaned = String(rawText || '').trim()
  try {
    return extractJsonFromLlmText(cleaned)
  } catch {
    // Recover raw JS block or lightly unquoted/trailing-comma JSON cleanly
    const jsBlock = cleaned.match(/```(?:javascript|js)?\s*\n([\s\S]*?function\s+synthesizeBgm[\s\S]*?)\n```/i)
    if (jsBlock?.[1]) {
      return { files: { 'audio/ai_bgm_synth.js': jsBlock[1].trim() }, summary: 'AI DSP 代码块提取渲染' }
    }
    const funcStart = cleaned.indexOf('function synthesizeBgm')
    if (funcStart >= 0) {
      const slice = cleaned.slice(funcStart).replace(/["}\s]+$/, '')
      if (slice.includes('ctx.left') && slice.includes('ctx.right')) {
        return { files: { 'audio/ai_bgm_synth.js': slice }, summary: 'AI DSP 内联代码提取渲染' }
      }
    }
    throw new Error('AI 配乐返回内容不是有效的 JSON')
  }
}

/**
 * Invoke LLM to author `audio/ai_bgm_synth.js`, sandbox-validate & synthesize `audio/bgm-llm.wav`.
 */
/** The base preset of a project whose style was decided by 「AI 自由匹配」 or a 「我的风格预设」 ('' for a plain preset / unknown). */
function projectDecidedStyle(absDir, parsed) {
  let sc = parsed
  if (!sc) {
    try {
      sc = JSON.parse(readFileSync(join(absDir, 'script.json'), 'utf8'))
    } catch {
      return ''
    }
  }
  if (!sc || typeof sc !== 'object' || !sc.style) return ''
  if (sc.styleMode === 'auto' && sc.styleAuto && sc.styleAuto.style === sc.style && sc.styleAuto.by !== 'pending') return resolveStyleKey(sc.style)
  if (sc.styleMode === 'user' && sc.styleProfile && sc.styleProfile.base === sc.style) return resolveStyleKey(sc.style)
  return ''
}

export async function generateAiCodedBgmTrack({
  projectDir,
  script,
  callLlmChatFn,
}) {
  if (typeof callLlmChatFn !== 'function') {
    throw new Error('需要注入 callLlmChatFn 才能执行 AI 编程配乐')
  }
  const absDir = resolve(projectDir)
  const durationSec = Math.max(3, Number(script?.totalDurationSec) || 12)
  const bpm = Number(script?.audioSpec?.bpm || script?.bgm?.bpm || 112)
  // an AI 自由匹配 / 我的风格预设 project: the style decided in the plan call (saved in script.json) wins over a style the
  // caller resolved before planning
  const decidedStyle = projectDecidedStyle(absDir)
  const mood = decidedStyle || script?.audioSpec?.mood || script?.style || 'tech'
  const beats = Array.isArray(script?.bgm?.beats) ? script.bgm.beats : []
  // a custom visual style (AI-designed / 我的风格预设) tells the composer its music mood; `mood` itself stays the key the
  // generated synth code receives at runtime
  const styleMoodWords = String(script?.styleProfile?.bgmMood || '').slice(0, 24)
  const topicForMusic = `${script?.title || script?.topic || ''}${styleMoodWords ? `（配乐气质：${styleMoodWords}）` : ''}`

  // Vibecoding tool #6 — SuperCollider: when the user's machine has `sclang` (and the engine is not forced to
  // 'js'), the LLM writes a SuperCollider NRT score that is rendered offline. Any failure falls back to the
  // deterministic JS DSP path below, so a video never depends on SuperCollider being installed.
  const engineWanted = String(process.env.DSH_AUDIO_ENGINE || script?.audioSpec?.engine || 'auto').toLowerCase()
  let scFallbackReason = ''
  if (engineWanted !== 'js' && detectSuperCollider().available) {
    // render beside the final name: only an audible, finished render ever becomes audio/bgm-llm.wav (a failed or
    // silent render left there was mixed as "the BGM" and the film had no music)
    const scTmp = join(absDir, 'audio', 'bgm-llm.sc-render.wav')
    try {
      const scRes = await callLlmChatFn({
        system: buildSuperColliderBgmSystemPrompt({ bpm, durationSec, mood }),
        messages: [
          {
            role: 'user',
            content: JSON.stringify({
              topic: topicForMusic,
              mood,
              bpm,
              durationSec: Number(durationSec.toFixed(2)),
              downbeatsSec: beats
                .map((b) => (typeof b === 'number' ? { time: b } : b))
                .filter((b) => b?.strong)
                .slice(0, 64)
                .map((b) => Number(Number(b.time).toFixed(3))),
            }),
          },
        ],
        temperature: 0.4,
        maxTokens: 3600,
        responseFormat: 'json',
      })
      const scParsed = parseJsonFromLlmText(scRes?.text || '')
      const body = String(scParsed?.scd || scParsed?.files?.['audio/ai_bgm.scd'] || '').trim()
      if (body) {
        const wavFile = join(absDir, 'audio', 'bgm-llm.wav')
        const scdFile = join(absDir, 'audio', 'ai_bgm.scd')
        mkdirSync(dirname(scdFile), { recursive: true })
        writeFileSync(scdFile, body, 'utf8')
        const rendered = await renderSuperColliderNrt({ body, outWav: scTmp, durationSec: durationSec + 0.5 })
        if (rendered.ok && !(await isAudibleMusicBed(scTmp))) {
          rendered.ok = false
          rendered.reason = 'silent'
        }
        if (!rendered.ok) {
          unlinkQuiet(scTmp)
          scFallbackReason =
            rendered.reason === 'silent'
              ? 'SuperCollider 渲染结果是静音，已改用内置 JS DSP 合成器'
              : `SuperCollider 渲染失败 (${rendered.reason || 'unknown'})，已改用内置 JS DSP 合成器`
        }
        if (rendered.ok) {
          replaceWithRender(scTmp, wavFile)
          const measured = await normalizeBgmLoudness(wavFile, -16)
          return {
            ok: true,
            bgmMode: 'llm-coded',
            engine: 'supercollider',
            scriptPath: scdFile,
            relScriptPath: 'audio/ai_bgm.scd',
            wavPath: wavFile,
            relWavPath: 'audio/bgm-llm.wav',
            summary: scParsed?.summary || 'AI 大模型编写的 SuperCollider 配乐已离线渲染 (NRT)',
            bpm: Number(scParsed?.bpm) || bpm,
            lufs: measured,
          }
        }
      } else {
        scFallbackReason = 'SuperCollider 乐谱为空，已改用内置 JS DSP 合成器'
      }
    } catch (err) {
      unlinkQuiet(scTmp)
      // a balance problem or a cancelled run stops here; anything else falls through to the JS DSP synthesizer
      if (isBillingError(err) || err?.name === 'AbortError') throw err
      scFallbackReason = `SuperCollider 配乐生成异常 (${String(err?.message || err).slice(0, 120)})，已改用内置 JS DSP 合成器`
    }
  }

  const { system, user } = buildAudioCoderPromptPackage({
    topic: topicForMusic,
    mood,
    bpm,
    durationSec,
    beats,
    scenes: script?.scenes || [],
  })

  const scriptFile = join(absDir, 'audio', 'ai_bgm_synth.js')
  const wavFile = join(absDir, 'audio', 'bgm-llm.wav')
  const jsTmp = join(absDir, 'audio', 'bgm-llm.js-render.wav')
  mkdirSync(dirname(scriptFile), { recursive: true })

  // One retry when the reply is unusable (not JSON / no code / a formula that renders silence or throws): the model is
  // told what was wrong. Transport, rate-limit and billing errors are not retried here (callLlmChat already retries).
  const messages = [{ role: 'user', content: user }]
  let lastErr = null
  for (let attempt = 1; attempt <= AI_BGM_MAX_ATTEMPTS; attempt++) {
    const res = await callLlmChatFn({
      system,
      messages,
      temperature: attempt === 1 ? 0.45 : 0.3,
      maxTokens: attempt === 1 ? 3600 : 4800,
      responseFormat: 'json',
    })
    const rawText = String(res?.text || '')
    try {
      const parsed = parseJsonFromLlmText(rawText)
      const code = parsed?.files?.['audio/ai_bgm_synth.js'] || parsed?.code || ''
      if (!code) throw new Error('LLM 未返回 audio/ai_bgm_synth.js 合成代码')
      writeFileSync(scriptFile, code, 'utf8')
      // throws on a silent waveform (peak < 1e-4) or a sandbox violation
      const execRes = executeAiAudioSynthScript({
        code,
        outWavPath: jsTmp,
        durationSec,
        bpm: Number(parsed?.bpm) || bpm,
        beats,
        mood,
      })
      replaceWithRender(jsTmp, wavFile)
      const notes = [scFallbackReason, attempt > 1 ? `首次结果不可用（${String(lastErr?.message || '').slice(0, 80)}），第 ${attempt} 次生成成功` : ''].filter(Boolean)
      return {
        ok: true,
        bgmMode: 'llm-coded',
        scriptPath: scriptFile,
        relScriptPath: 'audio/ai_bgm_synth.js',
        wavPath: wavFile,
        relWavPath: 'audio/bgm-llm.wav',
        summary: parsed?.summary || 'AI 大模型实时编写的纯数学 DSP 配乐已渲染',
        rmsDb: execRes.rmsDb,
        bpm: Number(parsed?.bpm) || bpm,
        code,
        engine: 'js-dsp',
        attempts: attempt,
        engineNote: notes.length ? notes.join('；') : undefined,
      }
    } catch (err) {
      unlinkQuiet(jsTmp)
      if (isBillingError(err) || err?.name === 'AbortError') throw err
      lastErr = err
      // keep the unusable reply for diagnosis (bounded)
      try {
        writeFileSync(join(absDir, 'audio', `ai_bgm_failed-${attempt}.txt`), `${String(err?.message || err)}\n\n${rawText.slice(0, 20_000)}`, 'utf8')
      } catch {}
      if (attempt < AI_BGM_MAX_ATTEMPTS) {
        messages.push({ role: 'assistant', content: rawText.slice(0, 1500) || '（空回复）' })
        messages.push({
          role: 'user',
          content: `上一次的结果不可用：${String(err?.message || err).slice(0, 200)}。请重新输出：只输出一个 JSON 对象（不要 Markdown 代码块、不要任何解释），字段 files["audio/ai_bgm_synth.js"] 为完整、可运行的 synthesizeBgm 函数代码（控制在 120 行以内），必须产生全程可听见的配乐（不能是静音）。`,
        })
      }
    }
  }
  throw lastErr || new Error('AI 配乐生成失败')
}

/**
 * Mode 3 (`tts-engine`): Use IndexTTS-2.5 to synthesize a vocal seed from user prompt / voice / clone
 * and sculpt it through FFmpeg reverb/chorus/pitch filters into ambient BGM pad or stinger SFX.
 */
export async function synthesizeTtsEngineAudioCue({
  projectDir,
  promptText = '啊——嗯——光影律动，未来已来。',
  voiceId = 'auto',
  mode = 'bgm-pad',
  durationSec = 10,
  emotion = '深沉空灵',
}) {
  const absDir = resolve(projectDir)
  const audioDir = join(absDir, 'audio')
  mkdirSync(audioDir, { recursive: true })

  const seedWav = join(audioDir, 'tts-bgm-seed.wav')
  const targetDur = Math.max(2, Math.min(180, Number(durationSec) || 10))

  const ttsRes = await executeGenerateSpeech({
    text: String(promptText || '嗯——科技律动，沉浸声场。').trim(),
    emotion,
    voiceId,
    outputPath: seedWav,
    fps: 30,
  })

  const { ffmpeg } = resolveBinaries()
  const outName = mode === 'sfx-stinger' ? 'sfx-tts-stinger.wav' : 'bgm-tts.wav'
  const outWav = join(audioDir, outName)

  const filterGraph =
    mode === 'sfx-stinger'
      ? [
          'aresample=48000',
          'asetrate=48000*0.84,atempo=1.08',
          'aecho=0.8:0.88:45|95|160:0.45|0.32|0.2',
          'lowpass=f=4200,highpass=f=60',
          'loudnorm=I=-16:TP=-2.0',
        ].join(',')
      : mode === 'vocal-hook'
        ? [
            'aresample=48000',
            'aecho=0.75:0.85:120|240:0.42|0.25',
            `aloop=loop=-1:size=480000`,
            `atrim=0:${targetDur.toFixed(3)}`,
            `afade=t=in:st=0:d=0.45,afade=t=out:st=${Math.max(0.2, targetDur - 0.8).toFixed(3)}:d=0.8`,
            'loudnorm=I=-20:TP=-2.5',
          ].join(',')
        : [
            // `bgm-pad`: atmospheric pitched-down warm ambient voice pad
            'aresample=48000',
            'asetrate=48000*0.76,atempo=1.05',
            'aecho=0.85:0.9:75|155|280|420:0.55|0.42|0.28|0.18',
            'lowpass=f=2200,highpass=f=85',
            'aloop=loop=-1:size=960000',
            `atrim=0:${targetDur.toFixed(3)}`,
            `afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0.2, targetDur - 1.1).toFixed(3)}:d=1.1`,
            'loudnorm=I=-22:TP=-3.0',
          ].join(',')

  const res = await runCommandRedirected(
    ffmpeg,
    ['-y', '-i', seedWav, '-af', filterGraph, '-ar', '48000', '-ac', '2', outWav],
    { timeoutMs: 45_000 },
  )

  if (res.code !== 0 || !existsSync(outWav)) {
    throw new Error(`配音引擎氛围音轨声学塑形失败: ${res.stderr}`)
  }

  return {
    ok: true,
    bgmMode: 'tts-engine',
    cueMode: mode,
    voiceId: ttsRes.voiceUsed?.id || voiceId,
    voiceName: ttsRes.voiceUsed?.name || voiceId,
    seedWavPath: seedWav,
    wavPath: outWav,
    relWavPath: `audio/${outName}`,
    durationSec: targetDur,
  }
}

/**
 * Use the active LLM to author custom WebAudio/DSP transition & impact SFX synthesis code,
 * validate in sandbox, and render 48kHz stereo `<cue>-ai.wav` cues into `audio/sfx/`.
 */
export async function generateAiCodedSfxCues({
  projectDir,
  cues = ['whoosh', 'hit', 'riser', 'chime'],
  style = '',
  llmOverride = {},
  fetchImpl,
  signal,
} = {}) {
  if (signal?.aborted) throw createAbortError()
  const absDir = resolve(projectDir)
  const sfxDir = join(absDir, 'audio', 'sfx')
  mkdirSync(sfxDir, { recursive: true })
  // 'auto' (AI 自由匹配) / 'user:<id>' → the project's base preset, plus the custom style's name for the sound designer
  let projectScript = null
  try {
    projectScript = JSON.parse(readFileSync(join(absDir, 'script.json'), 'utf8'))
  } catch {}
  const styleKey = projectDecidedStyle(absDir, projectScript) || resolveStyleKey(style, projectScript)
  const prof = projectScript?.styleProfile
  const styleForPrompt = prof?.name ? `${styleKey}（${String(prof.name).slice(0, 20)}${prof.bgmMood ? ` · ${String(prof.bgmMood).slice(0, 24)}` : ''}）` : styleKey

  const summary = getSafeLlmConfigSummary()
  if (!llmOverride?.baseUrl && !summary.configured) {
    return { ok: false, fallback: true, reason: 'LLM not configured, using procedural DSP SFX', files: [] }
  }

  const targetCues = (Array.isArray(cues) && cues.length > 0 ? cues : ['whoosh', 'hit', 'riser', 'chime']).slice(0, 6)
  const sys = `你是精通 DSP 物理声学建模与电影转场音效合成的程序员。
请用纯数学函数编写一条 JavaScript 函数 generateAudioSample(t, totalDurationSec, cueIndex, mood)：
- 输入参数: t (秒), totalDurationSec (总时长, 这里会以 0..0.85s 传入单条音效), cueIndex (0..N), mood (风格字符串)
- 必须返回一个双声道振幅数组 [left, right]，范围 [-0.95, 0.95]。
- 禁止使用 require/import/fs/fetch/process/eval，仅使用 Math.sin/cos/tanh/exp/abs/min/max/pow/PI。
输出严格 JSON：{ "summary": "音效设计说明", "code": "function generateAudioSample(t, totalDurationSec, cueIndex, mood) { ... }" }。`

  const user = JSON.stringify({
    task: '为转场与重击节点生成具有电影冲击力的代码合成音效',
    style: styleForPrompt,
    cues: targetCues,
  })

  try {
    const res = await callLlmChat({
      overrideConfig: llmOverride,
      fetchImpl,
      system: sys,
      messages: [{ role: 'user', content: user }],
      temperature: 0.35,
      maxTokens: 2048,
      timeoutMs: 60_000,
    })
    const parsed = extractJsonFromLlmText(res.text)
    let code = String(parsed?.code || '').trim()
    if (!code) throw new Error('Empty SFX synth code')
    const check = scanAiAudioCodeSandbox(code)
    if (!check.safe) throw new Error(`SFX sandbox violation: ${check.violations.join('; ')}`)

    const sanitized = code.replace(/^\s*export\s+(default\s+)?/gm, '')
    const renderedFiles = []
    for (let i = 0; i < targetCues.length; i++) {
      if (signal?.aborted) throw createAbortError()
      const cue = targetCues[i]
      const dur = cue === 'riser' ? 0.95 : cue === 'chime' ? 0.72 : 0.48
      const outPath = join(sfxDir, `${cue}-ai.wav`)
      const out = executeAiAudioSynthScript({
        code: `${sanitized}\n`,
        durationSec: dur,
        bpm: 120,
        mood: cue,
        outWavPath: outPath,
      })
      renderedFiles.push({ cue, relPath: `audio/sfx/${cue}-ai.wav`, rmsDb: out.rmsDb })
    }
    return { ok: true, mode: 'llm-coded', model: res.model, summary: parsed?.summary || '', files: renderedFiles }
  } catch (err) {
    return { ok: false, fallback: true, reason: err.message, files: [] }
  }
}
