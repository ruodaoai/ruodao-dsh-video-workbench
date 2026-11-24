/**
 * Pure Node.js 48kHz Stereo DSP Synthesizer & Shared Room Reverb Engine.
 * Produces rich, punchy drum/bass/FM-epiano/pad/pluck BGM tracks and 24+ studio-grade SFX
 * sample-accurately synced to beat grids and scene animation timestamps.
 */

export const DSP_SR = 48000

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12)
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x)

function createRng(seed = 11) {
  let s = seed >>> 0 || 1
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function encodeStereoWav(L, R, sampleRate = DSP_SR) {
  const n = Math.min(L.length, R.length)
  const dataBytes = n * 4
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0, 4, 'ascii')
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8, 4, 'ascii')
  buf.write('fmt ', 12, 4, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 4, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 4, 'ascii')
  buf.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < n; i++) {
    const l = Math.tanh(L[i] * 0.92)
    const r = Math.tanh(R[i] * 0.92)
    buf.writeInt16LE(Math.round(clamp(l, -1, 1) * 32767), 44 + i * 4)
    buf.writeInt16LE(Math.round(clamp(r, -1, 1) * 32767), 44 + i * 4 + 2)
  }
  return buf
}

function adsr(t, dur, a, d, s, r) {
  let e = s
  if (t < a) e = t / Math.max(a, 1e-4)
  else if (t < a + d) e = 1 - ((1 - s) * (t - a)) / Math.max(d, 1e-4)
  const rel = dur - t < r ? clamp((dur - t) / Math.max(r, 1e-4)) : 1
  return e * rel
}

function biquadFilter(input, type, fc, q = 0.707) {
  const n = input.length
  const out = new Float32Array(n)
  const fClamp = clamp(fc, 30, DSP_SR * 0.45)
  const w0 = (2 * Math.PI * fClamp) / DSP_SR
  const cosW = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * Math.max(0.2, q))
  let b0 = 0
  let b1 = 0
  let b2 = 0
  if (type === 'lp') {
    b0 = (1 - cosW) / 2
    b1 = 1 - cosW
    b2 = (1 - cosW) / 2
  } else if (type === 'hp') {
    b0 = (1 + cosW) / 2
    b1 = -(1 + cosW)
    b2 = (1 + cosW) / 2
  } else {
    // bp
    b0 = alpha
    b1 = 0
    b2 = -alpha
  }
  const a0 = 1 + alpha
  const a1 = -2 * cosW
  const a2 = 1 - alpha
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < n; i++) {
    const x0 = input[i]
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    out[i] = y0
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
  }
  return out
}

function addMonoPanned(bufL, bufR, mono, t0Sec, gain = 1.0, panPos = 0.0) {
  const startIdx = Math.round(t0Sec * DSP_SR)
  const p = clamp(panPos, -1, 1)
  const gL = gain * Math.sqrt((1 - p) * 0.5) * 1.414
  const gR = gain * Math.sqrt((1 + p) * 0.5) * 1.414
  const from = startIdx < 0 ? -startIdx : 0
  const maxLen = Math.min(mono.length, bufL.length - startIdx)
  for (let i = from; i < maxLen; i++) {
    const dst = startIdx + i
    if (dst < 0 || dst >= bufL.length) continue
    bufL[dst] += mono[i] * gL
    bufR[dst] += mono[i] * gR
  }
}

function addStereo(bufL, bufR, sL, sR, t0Sec, gain = 1.0) {
  const startIdx = Math.round(t0Sec * DSP_SR)
  const from = startIdx < 0 ? -startIdx : 0
  const maxLen = Math.min(sL.length, bufL.length - startIdx)
  for (let i = from; i < maxLen; i++) {
    const dst = startIdx + i
    if (dst < 0 || dst >= bufL.length) continue
    bufL[dst] += sL[i] * gain
    bufR[dst] += sR[i] * gain
  }
}

// Fast Schroeder Stereo Room Reverb (4 parallel feedback combs + 2 series allpass per channel)
export function applyStereoReverb(L, R, mix = 0.16, roomScale = 1.0) {
  const n = L.length
  const wetL = new Float32Array(n)
  const wetR = new Float32Array(n)
  const combDelaysL = [1557, 1617, 1491, 1422].map((d) => Math.max(100, Math.round(d * (DSP_SR / 44100) * roomScale)))
  const combDelaysR = combDelaysL.map((d) => d + 23)
  const combGains = [0.805, 0.827, 0.783, 0.764]

  const processChannel = (inp, wet, delays) => {
    for (let c = 0; c < delays.length; c++) {
      const D = delays[c]
      const g = combGains[c]
      const ring = new Float32Array(D)
      let pos = 0
      let lp = 0
      for (let i = 0; i < n; i++) {
        const delayed = ring[pos]
        lp = lp * 0.32 + delayed * 0.68
        ring[pos] = inp[i] + lp * g
        wet[i] += delayed * 0.28
        pos = (pos + 1) % D
      }
    }
    const apDelays = [241, 593]
    for (const D of apDelays) {
      const ring = new Float32Array(D)
      let pos = 0
      for (let i = 0; i < n; i++) {
        const bufOut = ring[pos]
        const x = wet[i]
        ring[pos] = x + bufOut * 0.5
        wet[i] = bufOut - x * 0.5
        pos = (pos + 1) % D
      }
    }
  }

  processChannel(L, wetL, combDelaysL)
  processChannel(R, wetR, combDelaysR)
  const dryG = 1 - mix * 0.45
  for (let i = 0; i < n; i++) {
    L[i] = L[i] * dryG + wetL[i] * mix
    R[i] = R[i] * dryG + wetR[i] * mix
  }
}

// =========================================================================
// Instruments & SFX Primitives
// =========================================================================

function synthKick(rand, tone = 46, gain = 1.0) {
  const n = Math.floor(0.45 * DSP_SR)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / DSP_SR
    const freq = tone + 128 * Math.exp(-t * 34)
    phase += (2 * Math.PI * freq) / DSP_SR
    const click = (rand() * 2 - 1) * Math.exp(-t * 210) * 0.24
    out[i] = (Math.sin(phase) * Math.exp(-t * 7.8) + click) * gain
  }
  return out
}

function synthClap(rand, gain = 0.55) {
  const n = Math.floor(0.32 * DSP_SR)
  const noise = new Float32Array(n)
  for (let i = 0; i < n; i++) noise[i] = rand() * 2 - 1
  const bp = biquadFilter(noise, 'bp', 2400, 0.8)
  for (let i = 0; i < n; i++) {
    const t = i / DSP_SR
    const e =
      (t >= 0 ? Math.exp(-t * 75) : 0) +
      (t >= 0.01 ? Math.exp(-(t - 0.01) * 75) : 0) +
      (t >= 0.021 ? Math.exp(-(t - 0.021) * 75) : 0) +
      0.55 * Math.exp(-t * 14)
    bp[i] *= e * 0.55 * gain
  }
  return bp
}

function synthHat(rand, open = false, gain = 0.22) {
  const dur = open ? 0.26 : 0.048
  const n = Math.floor(dur * DSP_SR)
  const noise = new Float32Array(n)
  for (let i = 0; i < n; i++) noise[i] = rand() * 2 - 1
  const hp = biquadFilter(noise, 'hp', 7200, 0.7)
  const decay = open ? 12 : 78
  for (let i = 0; i < n; i++) {
    hp[i] *= Math.exp(-(i / DSP_SR) * decay) * gain
  }
  return hp
}

function synthBass(midi, dur, gain = 0.5) {
  const n = Math.floor(dur * DSP_SR)
  const raw = new Float32Array(n)
  const f = hz(midi)
  for (let i = 0; i < n; i++) {
    const t = i / DSP_SR
    const saw = 2 * ((f * t) % 1) - 1
    raw[i] = 0.55 * saw + Math.sin(2 * Math.PI * f * t)
  }
  const lp = biquadFilter(raw, 'lp', 430, 0.75)
  for (let i = 0; i < n; i++) {
    lp[i] *= adsr(i / DSP_SR, dur, 0.006, 0.12, 0.72, 0.05) * gain
  }
  return lp
}

function synthPadStereo(midis, dur, cut = 1500, det = 0.1, gain = 0.25) {
  const n = Math.floor(dur * DSP_SR)
  const rawL = new Float32Array(n)
  const rawR = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / DSP_SR
    let sumL = 0
    let sumR = 0
    for (let k = 0; k < midis.length; k++) {
      const m = midis[k]
      const f1 = hz(m - det)
      const f2 = hz(m)
      const f3 = hz(m + det)
      sumL += (2 * ((f1 * t + 0.13 * k) % 1) - 1) * 0.65 + (2 * ((f2 * t + 0.37 * k) % 1) - 1)
      sumR += (2 * ((f3 * t + 0.29 * k) % 1) - 1) * 0.65 + (2 * ((f2 * t + 0.51 * k) % 1) - 1)
    }
    rawL[i] = sumL / (midis.length * 1.65)
    rawR[i] = sumR / (midis.length * 1.65)
  }
  const L = biquadFilter(rawL, 'lp', cut, 0.7)
  const R = biquadFilter(rawR, 'lp', cut, 0.7)
  for (let i = 0; i < n; i++) {
    const env = adsr(i / DSP_SR, dur, 0.32, 0.3, 0.85, 0.42) * gain
    L[i] *= env
    R[i] *= env
  }
  return { L, R }
}

function synthEpiano(midi, dur = 1.1, gain = 0.34) {
  const n = Math.floor(dur * DSP_SR)
  const out = new Float32Array(n)
  const f = hz(midi)
  for (let i = 0; i < n; i++) {
    const t = i / DSP_SR
    const mod = 1.25 * Math.exp(-t * 5.2) * Math.sin(2 * Math.PI * f * t)
    const x = Math.sin(2 * Math.PI * f * t + mod) + 0.25 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 4)
    out[i] = x * Math.exp(-t * 2.5) * adsr(t, dur, 0.004, 0.1, 1.0, 0.08) * gain
  }
  return out
}

function synthPluck(midi, dur = 0.32, bright = 2800, gain = 0.28) {
  const n = Math.floor(dur * DSP_SR)
  const raw = new Float32Array(n)
  const f = hz(midi)
  for (let i = 0; i < n; i++) {
    const t = i / DSP_SR
    const saw = 2 * ((f * t) % 1) - 1
    const sq = (2 * f * t) % 1 < 0.3 ? 1 : -1
    raw[i] = (saw + 0.45 * sq) * Math.exp(-t * 8.5)
  }
  const lp = biquadFilter(raw, 'lp', bright, 0.8)
  for (let i = 0; i < n; i++) lp[i] *= 0.55 * gain
  return lp
}

function synthGlock(midi, dur = 0.8, gain = 0.26) {
  const n = Math.floor(dur * DSP_SR)
  const out = new Float32Array(n)
  const f = hz(midi)
  for (let i = 0; i < n; i++) {
    const t = i / DSP_SR
    out[i] = (Math.sin(2 * Math.PI * f * t) + 0.28 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 9)) * Math.exp(-t * 4.8) * gain
  }
  return out
}

function synthSubDrop(dur = 1.15, gain = 0.72) {
  const n = Math.floor(dur * DSP_SR)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / DSP_SR
    const f = 112 * Math.exp(-t * 2.3) + 33
    phase += (2 * Math.PI * f) / DSP_SR
    out[i] = Math.sin(phase) * Math.exp(-t * 2.3) * gain
  }
  return out
}

function synthCrash(rand, gain = 0.24) {
  const n = Math.floor(2.0 * DSP_SR)
  const noise = new Float32Array(n)
  for (let i = 0; i < n; i++) noise[i] = rand() * 2 - 1
  const hp = biquadFilter(noise, 'hp', 4800, 0.7)
  for (let i = 0; i < n; i++) {
    const t = i / DSP_SR
    hp[i] *= Math.min(1, t / 0.015) * Math.exp(-t * 2.5) * gain
  }
  return hp
}

function synthSweptNoise(rand, dur = 0.42, bright = 3200, gain = 0.65) {
  const n = Math.floor(dur * DSP_SR)
  const white = new Float32Array(n)
  for (let i = 0; i < n; i++) white[i] = rand() * 2 - 1
  const lowBand = biquadFilter(white, 'bp', 950, 1.1)
  const highBand = biquadFilter(white, 'bp', Math.max(1500, bright), 0.9)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const u = i / n
    const arc = Math.sin(Math.PI * u)
    const env = Math.pow(arc, 1.55)
    out[i] = (lowBand[i] * (1 - arc * 0.5) + highBand[i] * (arc * 1.1)) * env * gain
  }
  return out
}

export function synthSfxStereo(type = 'whoosh', opts = {}) {
  const kind = String(type || 'whoosh').toLowerCase()
  const seed = (Number(opts.seed) || 17) + kind.split('').reduce((a, c) => a + c.charCodeAt(0) * 19, 0)
  const rand = createRng(seed)

  // Parametric LLM-authored DSP synthesizer ('synth_sfx')
  if (kind === 'synth_sfx' || (Number(opts.freqStart) > 0 && Number(opts.freqEnd) > 0)) {
    const dur = clamp((Number(opts.durationMs) || 340) / 1000, 0.05, 3.0)
    const f0 = clamp(Number(opts.freqStart) || 880, 35, 12000)
    const f1 = clamp(Number(opts.freqEnd) || 160, 28, 12000)
    const q = clamp(Number(opts.q) || 1.2, 0.4, 8)
    const noiseMix = clamp(Number(opts.noiseMix) || 0.22, 0, 1)
    const wave = String(opts.wave || 'saw').toLowerCase()
    const decayRate = Number(opts.decay) > 0 ? Number(opts.decay) : 3.2 / dur
    const n = Math.floor(dur * DSP_SR)
    const mono = new Float32Array(n)
    const noiseBuf = new Float32Array(n)
    let phase = 0
    for (let i = 0; i < n; i++) {
      const u = i / n
      const t = i / DSP_SR
      const instF = f0 * Math.pow(f1 / Math.max(1, f0), u)
      phase += (2 * Math.PI * instF) / DSP_SR
      const cyc = (phase / (2 * Math.PI)) % 1
      let osc = Math.sin(phase)
      if (wave === 'saw') osc = 2 * cyc - 1
      else if (wave === 'square') osc = cyc < 0.5 ? 0.8 : -0.8
      else if (wave === 'triangle') osc = 1 - 4 * Math.abs(Math.round(cyc - 0.25) - (cyc - 0.25))
      const att = Math.min(1, t / 0.008)
      const env = att * Math.exp(-t * decayRate)
      mono[i] = osc * env * 0.58
      noiseBuf[i] = (rand() * 2 - 1) * env * 0.48
    }
    const filteredNoise = biquadFilter(noiseBuf, 'bp', (f0 + f1) * 0.5, q)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const s = mono[i] * (1 - noiseMix * 0.5) + filteredNoise[i] * noiseMix
      L[i] = s
      R[i] = s * 0.96
    }
    return { L, R }
  }

  if (kind === 'hit' || kind === 'impact') {
    const dur = 1.05
    const n = Math.floor(dur * DSP_SR)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    const kk = synthKick(rand, 42, 0.9)
    const sd = synthSubDrop(1.0, 0.45)
    const nAir = new Float32Array(n)
    for (let i = 0; i < n; i++) nAir[i] = (rand() * 2 - 1) * Math.exp(-(i / DSP_SR) * 7.5)
    const airLp = biquadFilter(nAir, 'lp', 4600, 0.7)
    for (let i = 0; i < n; i++) {
      const s = ((i < kk.length ? kk[i] : 0) + (i < sd.length ? sd[i] : 0) + airLp[i] * 0.36) * 0.76
      L[i] = s
      R[i] = s * 0.99
    }
    return { L, R }
  }

  if (kind === 'sub_drop') {
    const sd = synthSubDrop(opts.d || 1.2, 0.78)
    return { L: sd, R: new Float32Array(sd) }
  }

  if (kind === 'crash_cym') {
    const cr = synthCrash(rand, 0.42)
    return { L: cr, R: new Float32Array(cr) }
  }

  if (
    kind === 'metal_clash' ||
    kind === 'metal_clash_hi' ||
    kind === 'metal_clash_heavy' ||
    kind === 'sword_clash' ||
    kind === 'weapon_clash' ||
    kind === 'blade_clash'
  ) {
    // Cold-weapon collision modelled on real blade/spear hits: the energy is a BROADBAND transient that is
    // over within ~60-90 ms ("锵 / 铿"). The previous long-ringing sine partials (0.3-0.5 s) sounded like a
    // door-bell "叮". Partials now decay in 14-40 ms, the body is a filtered noise crack, and every call gets a
    // seeded random detune so rapid flurries never repeat the identical sample (no machine-gun effect).
    const isHi = kind === 'metal_clash_hi'
    const isHeavy = kind === 'metal_clash_heavy'
    const dur = isHeavy ? 0.46 : isHi ? 0.24 : 0.3
    const n = Math.floor(dur * DSP_SR)
    const detune = 0.93 + rand() * 0.14
    const f0 = (isHeavy ? 1650 : isHi ? 2650 : 2150) * detune
    const ratios = [1, 1.37, 1.94, 2.53, 3.21, 3.92, 4.71]
    const modes = ratios.map((r, k) => ({
      f: f0 * r * (0.985 + rand() * 0.03),
      a: (0.55 - k * 0.055) * (0.75 + rand() * 0.5),
      tau: (isHeavy ? 0.04 : isHi ? 0.022 : 0.03) * (1 - k * 0.07) * (0.8 + rand() * 0.4),
      pan: (rand() - 0.5) * 0.5,
      ph: rand() * Math.PI * 2,
    }))
    const noise = new Float32Array(n)
    for (let i = 0; i < n; i++) noise[i] = rand() * 2 - 1
    // The attack click is band-limited to ~12 kHz: the audible "锵" bite lives in 2-10 kHz, while full-band
    // white-noise clicks are what make AAC/MP3 encoders overshoot (+3 dB inter-sample peaks after encoding).
    const clickNoise = biquadFilter(biquadFilter(noise, 'lp', 12000, 0.7), 'lp', 12000, 0.7)
    const crackLo = biquadFilter(noise, 'bp', (isHeavy ? 2300 : 3100) * detune, 0.75)
    const crackHi = biquadFilter(noise, 'bp', (isHeavy ? 5200 : 6800) * detune, 0.9)
    const ringBand = biquadFilter(noise, 'bp', f0 * 1.94, 7.5)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    const crackTau = isHeavy ? 0.016 : isHi ? 0.009 : 0.012
    const bodyF = (isHeavy ? 190 : 260) * detune
    for (let i = 0; i < n; i++) {
      const t = i / DSP_SR
      const atk = Math.min(1, t / 0.0003)
      const click = t < 0.003 ? clickNoise[i] * Math.exp(-t / 0.0006) * 1.7 : 0
      const crack = (crackLo[i] * 1.15 + crackHi[i] * 0.95) * Math.exp(-t / crackTau) * atk
      const ring = ringBand[i] * Math.exp(-t / (isHeavy ? 0.075 : 0.05)) * 0.55
      const body = Math.sin(2 * Math.PI * bodyF * t) * Math.exp(-t / (isHeavy ? 0.03 : 0.018)) * (isHeavy ? 0.55 : 0.32)
      const sub = isHeavy ? Math.sin(2 * Math.PI * (48 + 40 * Math.exp(-t * 30)) * t) * Math.exp(-t / 0.07) * 0.6 : 0
      let mL = 0
      let mR = 0
      for (let k = 0; k < modes.length; k++) {
        const md = modes[k]
        const v = Math.sin(2 * Math.PI * md.f * t + md.ph) * md.a * Math.exp(-t / md.tau) * atk
        mL += v * (1 - md.pan)
        mR += v * (1 + md.pan)
      }
      const core = click + crack + ring + body + sub
      L[i] = Math.tanh((core + mL * 0.62) * 1.35)
      R[i] = Math.tanh((core * 0.97 + mR * 0.62) * 1.35)
    }
    // high-pass the rumble, and roll off the tanh saturation harmonics above ~16 kHz (codec-safe transient)
    const Lh = biquadFilter(biquadFilter(L, 'hp', isHeavy ? 45 : 140, 0.7), 'lp', 16000, 0.7)
    const Rh = biquadFilter(biquadFilter(R, 'hp', isHeavy ? 45 : 140, 0.7), 'lp', 16000, 0.7)
    let pk = 1e-4
    for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(Lh[i]), Math.abs(Rh[i]))
    const norm = 0.95 / pk
    const fadeN = Math.floor(0.012 * DSP_SR)
    for (let i = 0; i < n; i++) {
      const fo = i > n - fadeN ? (n - i) / fadeN : 1
      Lh[i] *= norm * fo
      Rh[i] *= norm * fo
    }
    return { L: Lh, R: Rh }
  }

  if (kind === 'blade_whoosh' || kind === 'sword_draw' || kind === 'slash') {
    // Short blade swish that rises, peaks ~30 ms before the end and is silent for the last ~16 ms. A cue placed
    // one whoosh-length before a strike makes the swing "arrive" on the contact frame while leaving a short
    // breath, so the steel transient that follows reads as a crisp 锵 instead of being smeared by air noise.
    const dur = kind === 'sword_draw' ? 0.32 : 0.16
    const n = Math.floor(dur * DSP_SR)
    const raw = new Float32Array(n)
    for (let i = 0; i < n; i++) raw[i] = rand() * 2 - 1
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    const lo = biquadFilter(raw, 'bp', 1800, 1.0)
    const hi = biquadFilter(raw, 'bp', 5200, 1.3)
    const PEAK_U = 0.78
    for (let i = 0; i < n; i++) {
      const u = i / n
      const rise = Math.pow(Math.min(1, u / PEAK_U), 1.8)
      const fall = u <= PEAK_U ? 1 : Math.max(0, 1 - (u - PEAK_U) / 0.12)
      const env = rise * fall * fall
      const s2 = Math.tanh((lo[i] * (1 - u) * 0.8 + hi[i] * (0.4 + 0.6 * Math.min(1, u / PEAK_U))) * env * 2.2) * 0.85
      L[i] = s2 * (1 - u * 0.5)
      R[i] = s2 * (0.5 + u * 0.5)
    }
    return { L, R }
  }

  if (kind === 'war_drum' || kind === 'taiko_hit') {
    const dur = 1.25
    const n = Math.floor(dur * DSP_SR)
    const raw = new Float32Array(n)
    for (let i = 0; i < n; i++) raw[i] = (rand() * 2 - 1) * Math.exp(-(i / DSP_SR) * 48)
    const skinBp = biquadFilter(raw, 'bp', 920, 1.1)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    let ph = 0
    let phO = 0
    for (let i = 0; i < n; i++) {
      const t = i / DSP_SR
      const f = 92 * Math.exp(-t * 14) + 41
      ph += (2 * Math.PI * f) / DSP_SR
      phO += (2 * Math.PI * f * 1.58) / DSP_SR
      const boom = (Math.sin(ph) * 0.85 + Math.sin(phO) * 0.24) * Math.exp(-t * 3.8)
      const slap = skinBp[i] * 0.72
      const s = Math.tanh((boom + slap) * 1.35) * 0.86
      L[i] = s
      R[i] = s * 0.985
    }
    return { L, R }
  }

  if (kind === 'heavy_impact' || kind === 'sub_boom') {
    // Punchy cinematic hit for drops / big reveals: sub thump + broadband crack (~0.55 s, no long boom mud).
    const dur = 0.55
    const n = Math.floor(dur * DSP_SR)
    const raw = new Float32Array(n)
    for (let i = 0; i < n; i++) raw[i] = rand() * 2 - 1
    const crack = biquadFilter(raw, 'bp', 1800, 0.6)
    const air = biquadFilter(raw, 'hp', 4200, 0.7)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    let ph = 0
    for (let i = 0; i < n; i++) {
      const t = i / DSP_SR
      const f = 46 + 92 * Math.exp(-t * 26)
      ph += (2 * Math.PI * f) / DSP_SR
      const sub = Math.sin(ph) * Math.exp(-t / 0.11)
      const c = crack[i] * Math.exp(-t / 0.022) * 1.3 + air[i] * Math.exp(-t / 0.035) * 0.45
      const s2 = Math.tanh((sub * 1.05 + c) * 1.5) * 0.92
      L[i] = s2
      R[i] = s2 * 0.98
    }
    return { L, R }
  }

  if (kind === 'horse_gallop' || kind === 'hoof_stomp') {
    // One hoof fall: low thump with pitch drop + gritty sand/earth crunch
    const hoofSample = (heavy = false) => {
      const len = Math.floor((heavy ? 0.26 : 0.14) * DSP_SR)
      const mono = new Float32Array(len)
      const grit = new Float32Array(len)
      for (let i = 0; i < len; i++) grit[i] = rand() * 2 - 1
      const gritBp = biquadFilter(grit, 'bp', heavy ? 1400 : 1900, 0.8)
      const f0 = (heavy ? 95 : 120) * (0.92 + rand() * 0.16)
      for (let i = 0; i < len; i++) {
        const t = i / DSP_SR
        const thump = Math.sin(2 * Math.PI * (f0 * Math.exp(-t * (heavy ? 22 : 32)) + (heavy ? 44 : 52)) * t) * Math.exp(-t * (heavy ? 15 : 26))
        const dirt = gritBp[i] * Math.exp(-t * (heavy ? 30 : 44)) * (heavy ? 0.85 : 0.6)
        mono[i] = Math.tanh((thump * (heavy ? 1.0 : 0.78) + dirt) * 1.35) * (heavy ? 0.9 : 0.72)
      }
      return mono
    }
    if (kind === 'hoof_stomp') {
      const n = Math.floor(0.3 * DSP_SR)
      const L = new Float32Array(n)
      const R = new Float32Array(n)
      addMonoPanned(L, R, hoofSample(true), 0, 1.0, 0)
      return { L, R }
    }
    const step = Number(opts.d)
    if (step > 0.2 && step < 1.6) {
      // Tempo-locked gallop: per beat "da-da-DUM" (two light falls on the 16ths before the beat, the accent
      // exactly ON the beat). The cue's leadSec = step/4, so stride accents land on the measured beats.
      const total = clamp(Number(opts.durationMs) > 0 ? Number(opts.durationMs) / 1000 : step * 4, step * 0.6, 16)
      const strides = Math.max(1, Math.round((total - 0.05) / step))
      const lead = step * 0.25
      const n = Math.floor((lead + strides * step + 0.3) * DSP_SR)
      const L = new Float32Array(n)
      const R = new Float32Array(n)
      for (let s = 0; s < strides; s++) {
        const beatT = lead + s * step
        const pan = s % 2 === 0 ? -0.22 : 0.22
        addMonoPanned(L, R, hoofSample(false), beatT - step * 0.25, 0.5 + rand() * 0.12, pan)
        addMonoPanned(L, R, hoofSample(false), beatT - step * 0.125, 0.62 + rand() * 0.12, -pan * 0.6)
        addMonoPanned(L, R, hoofSample(s % 4 === 0), beatT, 0.95 + rand() * 0.08, pan * 0.4)
      }
      return { L, R }
    }
    const dur = 0.88
    const n = Math.floor(dur * DSP_SR)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    const hoofTimes = [0.0, 0.14, 0.27, 0.48, 0.62, 0.74]
    hoofTimes.forEach((ht, hi) => {
      addMonoPanned(L, R, hoofSample(false), ht, hi % 3 === 0 ? 1.0 : 0.78, hi % 2 === 0 ? -0.24 : 0.24)
    })
    return { L, R }
  }

  if (kind === 'slash_sweep') {
    // Beat-locked transition sweep for slash-wipe cuts: filtered air rising for 0.2 s into a bright blade
    // "唰" crack exactly on the cut (cue.leadSec = 0.2), then a short airy tail panning left → right with
    // the on-screen sweep.
    const lead = 0.2
    const dur = 0.52
    const n = Math.floor(dur * DSP_SR)
    const raw = new Float32Array(n)
    for (let i = 0; i < n; i++) raw[i] = rand() * 2 - 1
    const lo = biquadFilter(raw, 'bp', 900, 0.9)
    const mid = biquadFilter(raw, 'bp', 2600, 1.1)
    const hi = biquadFilter(raw, 'bp', 6400, 1.3)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    const leadN = Math.floor(lead * DSP_SR)
    for (let i = 0; i < n; i++) {
      const t = i / DSP_SR
      let s
      if (i < leadN) {
        const u = i / leadN
        const env = Math.pow(u, 2.2)
        s = (lo[i] * (1 - u) * 0.5 + mid[i] * (0.4 + u * 0.6) + hi[i] * u * 0.7) * env * 1.6
      } else {
        const tt = t - lead
        const crack = (hi[i] * 1.4 + mid[i] * 0.8) * Math.exp(-tt / 0.018)
        const tail = (mid[i] * 0.55 + hi[i] * 0.35) * Math.exp(-tt / 0.11)
        s = crack + tail
      }
      const v = Math.tanh(s * 1.25) * 0.82
      const u = i / n
      L[i] = v * Math.cos(u * Math.PI * 0.5)
      R[i] = v * Math.sin(u * Math.PI * 0.5 + 0.12)
    }
    const fadeN = Math.floor(0.015 * DSP_SR)
    for (let i = n - fadeN; i < n; i++) {
      const g = (n - i) / fadeN
      L[i] *= g
      R[i] *= g
    }
    return { L, R }
  }

  if (kind === 'arrow_zip') {
    const dur = 0.28
    const n = Math.floor(dur * DSP_SR)
    const raw = new Float32Array(n)
    for (let i = 0; i < n; i++) raw[i] = rand() * 2 - 1
    const bp = biquadFilter(raw, 'bp', 3200, 2.4)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    let ph = 0
    for (let i = 0; i < n; i++) {
      const u = i / n
      const f = 2600 * Math.pow(0.28, u)
      ph += (2 * Math.PI * f) / DSP_SR
      const env = Math.sin(u * Math.PI)
      const s = (Math.sin(ph) * 0.34 + bp[i] * 0.68) * env * 0.84
      L[i] = s * (1 - u)
      R[i] = s * u
    }
    return { L, R }
  }

  if (kind === 'whoosh' || kind === 'swoosh' || kind === 'swipe' || kind === 'card') {
    const dur = kind === 'swipe' || kind === 'slash' ? 0.24 : kind === 'card' ? 0.3 : 0.44
    const bright = kind === 'slash' ? 6800 : kind === 'swoosh' || kind === 'swipe' ? 4600 : 2800
    const mono = synthSweptNoise(rand, dur, bright, kind === 'card' ? 0.55 : 0.8)
    const n = mono.length
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const u = i / n
      L[i] = mono[i] * Math.cos(u * Math.PI * 0.48)
      R[i] = mono[i] * Math.sin(u * Math.PI * 0.48 + 0.15)
    }
    return { L, R }
  }

  if (kind === 'riser' || kind === 'rise') {
    const dur = opts.d || 1.15
    const n = Math.floor(dur * DSP_SR)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    const noise = new Float32Array(n)
    for (let i = 0; i < n; i++) noise[i] = rand() * 2 - 1
    const bpLow = biquadFilter(noise, 'bp', 700, 1.2)
    const bpHi = biquadFilter(noise, 'bp', 4200, 1.2)
    let phase = 0
    for (let i = 0; i < n; i++) {
      const u = i / n
      const f = 220 * Math.pow(6.2, u)
      phase += (2 * Math.PI * f) / DSP_SR
      const swell = Math.pow(u, 2.0) * (u > 0.94 ? (1 - u) / 0.06 : 1)
      const nMix = bpLow[i] * (1 - u) + bpHi[i] * u
      const s = (nMix * 0.55 + Math.sin(phase) * 0.28) * swell * 0.65
      L[i] = s
      R[i] = s * 0.98
    }
    return { L, R }
  }

  if (kind === 'suck') {
    const dur = opts.d || 0.75
    const n = Math.floor(dur * DSP_SR)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    const noise = new Float32Array(n)
    for (let i = 0; i < n; i++) noise[i] = rand() * 2 - 1
    const lp = biquadFilter(noise, 'bp', 900, 0.9)
    let ph = 0
    for (let i = 0; i < n; i++) {
      const t = i / DSP_SR
      const u = i / n
      const f = 320 * Math.exp(-t * 1.4) + 45
      ph += (2 * Math.PI * f) / DSP_SR
      const env = Math.pow(u, 1.4) * Math.min(1, (dur - t) / 0.06)
      const s = (Math.sin(ph) * 0.35 + lp[i] * 0.5) * env * 0.55
      L[i] = s
      R[i] = s
    }
    return { L, R }
  }

  if (kind === 'glitch') {
    const dur = 0.38
    const n = Math.floor(dur * DSP_SR)
    const raw = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / DSP_SR
      const f = 110 + 780 * (Math.floor(t * 48) % 4)
      const sq = (f * t) % 1 < 0.5 ? 1 : -1
      raw[i] = sq * (rand() * 2 - 1) * 0.55 * Math.exp(-t * 3.2)
    }
    const lp = biquadFilter(raw, 'lp', 6500, 0.7)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) R[i] = lp[i] * (i % 19 < 9 ? 1 : -0.7)
    return { L: lp, R }
  }

  if (kind === 'thud' || kind === 'enter' || kind === 'stamp') {
    const dur = kind === 'stamp' ? 0.55 : 0.18
    const n = Math.floor(dur * DSP_SR)
    const noise = new Float32Array(n)
    for (let i = 0; i < n; i++) noise[i] = (rand() * 2 - 1) * Math.exp(-(i / DSP_SR) * 32)
    const lp = biquadFilter(noise, 'lp', kind === 'stamp' ? 1900 : 850, 0.8)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / DSP_SR
      const sub = Math.sin(2 * Math.PI * (kind === 'stamp' ? 68 : 96) * t) * Math.exp(-t * 24)
      const s = (lp[i] * 0.65 + sub * 0.7) * 0.68
      L[i] = s
      R[i] = s
    }
    return { L, R }
  }

  if (kind === 'flip' || kind === 'page_turn') {
    const dur = 0.24
    const n = Math.floor(dur * DSP_SR)
    const noise = new Float32Array(n)
    for (let i = 0; i < n; i++) noise[i] = rand() * 2 - 1
    const bp = biquadFilter(noise, 'bp', 2200, 1.35)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / DSP_SR
      const env = Math.sin(clamp(t / dur) * Math.PI) * Math.exp(-t * 5.2)
      const s = bp[i] * env * 0.42 + (i < 480 ? Math.sin(2 * Math.PI * 1450 * t) * Math.exp(-t * 95) * 0.16 : 0)
      L[i] = s * (1 - (i / n) * 0.18)
      R[i] = s * (0.82 + (i / n) * 0.18)
    }
    return { L, R }
  }

  if (kind === 'shimmer_swell') {
    const dur = Math.min(2.2, Math.max(0.7, Number(opts.d) || 1.25))
    const n = Math.floor(dur * DSP_SR)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    const notes = [72, 79, 84, 88, 91]
    notes.forEach((m, k) => {
      const g = synthGlock(m, 0.9, 0.16)
      addMonoPanned(L, R, g, k * 0.065, 0.9, ((k % 5) - 2) * 0.22)
    })
    return { L, R }
  }

  if (kind === 'sparkle' || kind === 'chime' || kind === 'shine' || kind === 'ding' || kind === 'achieve' || kind === 'notif') {
    const notes =
      kind === 'shine'
        ? [86, 90, 93, 98]
        : kind === 'sparkle'
          ? [96, 100, 103, 108, 112, 115, 120]
          : kind === 'notif'
            ? [88, 95]
            : [77, 81, 84, 89]
    const dur = kind === 'notif' ? 0.65 : 1.65
    const n = Math.floor(dur * DSP_SR)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    notes.forEach((m, k) => {
      const g = synthGlock(m, 0.85, kind === 'sparkle' ? 0.18 : 0.24)
      addMonoPanned(L, R, g, k * (kind === 'sparkle' ? 0.045 : 0.08), 1.0, ((k % 3) - 1) * 0.28)
    })
    return { L, R }
  }

  if (kind === 'tick' || kind === 'counter' || kind === 'tick_burst' || kind === 'typing' || kind === 'key_thock' || kind === 'click' || kind === 'lock' || kind === 'pop_soft') {
    const isBurst = kind === 'counter' || kind === 'typing' || kind === 'tick_burst'
    const dur = isBurst ? Math.min(2.8, Math.max(0.25, Number(opts.d) || 0.85)) : 0.11
    const n = Math.floor(dur * DSP_SR)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    if (isBurst) {
      const step = kind === 'tick_burst' ? 0.08 : kind === 'counter' ? 0.062 : 0.068
      let k = 0
      for (let tt = 0; tt < dur - 0.03; tt += step) {
        const micro = new Float32Array(Math.floor(0.032 * DSP_SR))
        for (let i = 0; i < micro.length; i++) {
          const t = i / DSP_SR
          const f = kind === 'typing' ? 260 + 90 * (k % 2) : 1480 + 260 * (k % 4)
          micro[i] = (Math.sin(2 * Math.PI * f * t) + (rand() * 2 - 1) * 0.24) * Math.exp(-t * 190) * 0.23
        }
        addMonoPanned(L, R, micro, tt, 1.0, ((k % 5) - 2) * 0.14)
        k++
      }
    } else if (kind === 'lock' || kind === 'pop_soft') {
      let ph = 0
      for (let i = 0; i < n; i++) {
        const t = i / DSP_SR
        const f = kind === 'lock' ? 920 * (1 + 0.65 * Math.exp(-t * 85)) : 520 * (1 + 1.1 * Math.exp(-t * 68))
        ph += (2 * Math.PI * f) / DSP_SR
        const s = (Math.sin(ph) * 0.72 + Math.sin(ph * 2) * 0.18) * Math.exp(-t * 42) * 0.44
        L[i] = s
        R[i] = s
      }
    } else {
      for (let i = 0; i < n; i++) {
        const t = i / DSP_SR
        const s = (Math.sin(2 * Math.PI * (kind === 'click' ? 2800 : 1900) * t) + (rand() * 2 - 1) * 0.45) * Math.exp(-t * 230) * 0.38
        L[i] = s
        R[i] = s
      }
    }
    return { L, R }
  }

  if (kind === 'boing' || kind === 'spring') {
    const dur = 0.36
    const n = Math.floor(dur * DSP_SR)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    let ph = 0
    for (let i = 0; i < n; i++) {
      const t = i / DSP_SR
      const f = 190 + 340 * (1 - Math.exp(-t * 14)) + 45 * Math.sin(2 * Math.PI * 16 * t) * Math.exp(-t * 6)
      ph += (2 * Math.PI * f) / DSP_SR
      const s = (Math.sin(ph) * 0.72 + Math.sin(ph * 2) * 0.24) * Math.exp(-t * 6.5) * 0.62
      L[i] = s
      R[i] = s
    }
    return { L, R }
  }

  if (kind === 'shutter' || kind === 'camera') {
    const dur = 0.16
    const n = Math.floor(dur * DSP_SR)
    const raw = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / DSP_SR
      const click1 = Math.exp(-t * 210)
      const click2 = t > 0.055 ? Math.exp(-(t - 0.055) * 185) * 0.85 : 0
      raw[i] = (rand() * 2 - 1) * (click1 + click2)
    }
    const bp = biquadFilter(raw, 'bp', 3400, 1.1)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const s = bp[i] * 0.78
      L[i] = s
      R[i] = s * 0.96
    }
    return { L, R }
  }

  if (kind === 'radar' || kind === 'sonar' || kind === 'ping') {
    const dur = 0.92
    const n = Math.floor(dur * DSP_SR)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / DSP_SR
      const env = Math.min(1, t / 0.008) * Math.exp(-t * 4.4)
      const s = (Math.sin(2 * Math.PI * 1320 * t) * 0.7 + Math.sin(2 * Math.PI * 2640 * t) * 0.22) * env * 0.45
      L[i] = s
      R[i] = s * (0.92 + 0.08 * Math.sin(2 * Math.PI * 4 * t))
    }
    return { L, R }
  }

  if (kind === 'bell_warm') {
    const dur = 1.4
    const n = Math.floor(dur * DSP_SR)
    const L = new Float32Array(n)
    const R = new Float32Array(n)
    ;[69, 76, 81].forEach((m, k) => {
      const g = synthGlock(m, 1.1, 0.22)
      addMonoPanned(L, R, g, k * 0.055, 0.9, (k - 1) * 0.2)
    })
    return { L, R }
  }

  // pop / bubble_pop / win_pop / dock
  const dur = 0.18
  const n = Math.floor(dur * DSP_SR)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const t = i / DSP_SR
    const f = 440 * (1 + 1.5 * Math.exp(-t * 58))
    ph += (2 * Math.PI * f) / DSP_SR
    const s = (Math.sin(ph) + 0.25 * Math.sin(2 * ph)) * Math.exp(-t * 30) * 0.58
    L[i] = s
    R[i] = s
  }
  return { L, R }
}

// =========================================================================
// Beat-Locked Soundtrack Synthesizer & SFX Master Stem Builder
// =========================================================================

export function buildBeatGrid(durationSec, bpm = 118) {
  const stepSec = 60 / bpm
  const beats = []
  let idx = 0
  for (let t = 0; t < durationSec + 0.2; t += stepSec) {
    beats.push({
      time: Number(t.toFixed(4)),
      strong: idx % 4 === 0,
      index: idx,
    })
    idx++
  }
  return { bpm, beats }
}

const PROGRESSIONS = {
  // D minor -> Bb major -> F major -> C major (kinetic modern tech anthem!)
  tech: [
    [38, [62, 65, 69, 72]],
    [34, [62, 65, 70, 74]],
    [41, [65, 69, 72, 76]],
    [36, [64, 67, 72, 76]],
  ],
  energetic: [
    [45, [64, 69, 72, 76]],
    [41, [65, 69, 72, 76]],
    [36, [64, 67, 72, 79]],
    [43, [62, 67, 71, 74]],
  ],
  cinematic: [
    [38, [62, 65, 69, 72]],
    [34, [58, 65, 69, 74]],
    [41, [60, 65, 69, 76]],
    [33, [61, 64, 69, 73]],
  ],
  warm: [
    [41, [65, 69, 72, 76]],
    [43, [62, 67, 71, 74]],
    [40, [64, 67, 71, 74]],
    [45, [64, 69, 72, 76]],
  ],
  emerald: [
    // Dm9 -> G13 -> Cmaj9 -> A7sus4 (modern sleek creative studio groove)
    [38, [62, 65, 69, 72]],
    [43, [62, 65, 71, 74]],
    [36, [64, 67, 71, 74]],
    [45, [64, 69, 72, 76]],
  ],
}

export function renderBgmWavBuffer({ durationSec = 20, mood = 'tech', bpm, audioSpec = null }) {
  const dur = Math.max(2, Number(durationSec) || 20)
  const specMood = String(audioSpec?.mood || mood || 'tech').toLowerCase()
  const resolvedBpm =
    Number(audioSpec?.bpm || bpm) ||
    (specMood === 'energetic' ? 124 : specMood === 'tech' ? 118 : specMood === 'emerald' ? 100 : specMood === 'cinematic' ? 104 : 96)
  const B = 60 / resolvedBpm
  const n = Math.floor(dur * DSP_SR)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const rand = createRng(991 + resolvedBpm)

  const validSpecChords =
    Array.isArray(audioSpec?.chords) &&
    audioSpec.chords.length >= 2 &&
    audioSpec.chords.every(
      (bar) => Array.isArray(bar) && Number.isFinite(Number(bar[0])) && Array.isArray(bar[1]) && bar[1].length >= 2,
    )
  const prog = validSpecChords
    ? audioSpec.chords.map((b) => [Number(b[0]), b[1].map((m) => Number(m) || 60)])
    : PROGRESSIONS[specMood] || PROGRESSIONS.tech

  const drumDensity = Number.isFinite(Number(audioSpec?.drumDensity))
    ? clamp(Number(audioSpec.drumDensity), 0, 1)
    : specMood === 'tech' || specMood === 'energetic'
      ? 0.85
      : specMood === 'emerald'
        ? 0.68
        : 0.48
  const leadStyle = String(
    audioSpec?.leadStyle || (specMood === 'tech' || specMood === 'energetic' ? 'pluck' : 'epiano'),
  ).toLowerCase()
  const baseCutoff = clamp(Number(audioSpec?.padCutoff) || 950, 500, 4200)

  const barDur = 4 * B
  const totalBars = Math.ceil(dur / barDur)

  for (let bar = 0; bar < totalBars; bar++) {
    const tb = bar * barDur
    const [root, ch] = prog[bar % prog.length]
    const phaseRatio = bar / Math.max(1, totalBars)
    // 4-stage song narrative arc: atmospheric intro -> groove -> climax -> soft wind-down outro
    const stage =
      totalBars <= 2
        ? 'groove'
        : phaseRatio < 0.14
          ? 'intro'
          : phaseRatio < 0.55
            ? 'groove'
            : phaseRatio < 0.86
              ? 'climax'
              : 'outro'
    const lvl = stage === 'intro' ? 0.52 : stage === 'groove' ? 0.78 : stage === 'climax' ? 0.96 : 0.56
    const isEnergetic = drumDensity >= 0.6 && stage !== 'intro' && stage !== 'outro'

    // Stereo detuned pad
    const p = synthPadStereo(ch.map((m) => m - 12), barDur + 0.35, baseCutoff + 1150 * lvl, 0.08, 0.22)
    addStereo(L, R, p.L, p.R, tb, 1.0)

    // Crash cymbal at section transitions
    if ((bar === 0 ? false : bar % 4 === 0 || (stage === 'climax' && (bar - 1) / Math.max(1, totalBars) < 0.55)) && drumDensity > 0.25) {
      addMonoPanned(L, R, synthCrash(rand, stage === 'climax' ? 0.19 : 0.14), tb, 1.0, 0)
    }

    // 16th-note groove inside bar
    for (let s = 0; s < 16; s++) {
      const tt = tb + (s * B) / 4
      if (tt >= dur) break

      // Bass on 8th notes (soft in intro/outro)
      if (s % 2 === 0 && drumDensity > 0.1 && stage !== 'intro') {
        const oct = s % 8 === 6 ? 12 : 0
        const bGain = stage === 'outro' ? 0.22 : s % 4 === 0 ? 0.40 : 0.30
        addMonoPanned(L, R, synthBass(root + oct, (B / 2) * 0.82, bGain), tt, 1.0, 0)
      }

      // Kick drum (hold back in intro and outro wind-down)
      if (s % 4 === 0 && drumDensity > 0.2 && stage !== 'intro' && stage !== 'outro') {
        addMonoPanned(L, R, synthKick(rand, 46, (isEnergetic ? 0.76 : 0.56) * Math.min(1, drumDensity + 0.18)), tt, 1.0, 0)
      }

      // Clap / snare on backbeats 2 and 4
      if ((s === 4 || s === 12) && drumDensity > 0.35 && stage !== 'intro' && stage !== 'outro') {
        addMonoPanned(L, R, synthClap(rand, (stage === 'climax' ? 0.38 : 0.26) * lvl), tt, 1.0, 0)
      }

      // Off-beat hi-hats
      if (s % 2 === 1 && drumDensity > 0.5 && stage !== 'intro' && stage !== 'outro') {
        addMonoPanned(L, R, synthHat(rand, false, (stage === 'climax' ? 0.17 : 0.12) * lvl * drumDensity), tt, 1.0, 0.28)
      }
      if (s % 4 === 2 && stage === 'climax' && drumDensity > 0.65) {
        addMonoPanned(L, R, synthHat(rand, true, 0.10 * lvl), tt, 1.0, -0.28)
      }

      // Lead synth voice from audioSpec.leadStyle
      if (leadStyle === 'pluck' && s % 2 === 0 && (stage !== 'outro' || s % 4 === 0)) {
        const note = ch[[0, 2, 1, 3, 2, 1, 3, 2][(s >> 1) % 8] % ch.length] + 12
        const pan = (s >> 1) % 2 === 0 ? -0.35 : 0.35
        addMonoPanned(L, R, synthPluck(note, 0.28, 1700 + 2200 * lvl, 0.23 * lvl), tt, 1.0, pan)
      } else if (leadStyle === 'glock' && s % 4 === 0) {
        const note = ch[(s >> 2) % ch.length] + 24
        addMonoPanned(L, R, synthGlock(note, 0.72, 0.22 * lvl), tt, 1.0, ((s >> 2) % 2 === 0 ? -0.28 : 0.28))
      } else if (leadStyle === 'epiano' && s % 4 === 0) {
        const note = ch[(s >> 2) % ch.length] + 12
        addMonoPanned(L, R, synthEpiano(note, 1.4, stage === 'climax' ? 0.28 : 0.23), tt, 1.0, ((s >> 2) - 1.5) * 0.22)
      }
      // Subtle climax high sparkle glock ornament
      if (stage === 'climax' && s === 14) {
        addMonoPanned(L, R, synthGlock(ch[3 % ch.length] + 24, 0.65, 0.15), tt, 1.0, 0.32)
      }
    }
  }

  // Cohesive room reverb + smooth fade in/out
  applyStereoReverb(L, R, 0.14, 0.9)
  const fadeInSamples = Math.floor(0.35 * DSP_SR)
  const fadeOutSamples = Math.floor(1.4 * DSP_SR)
  for (let i = 0; i < n; i++) {
    const fi = i < fadeInSamples ? i / Math.max(1, fadeInSamples) : 1
    const fo = i > n - fadeOutSamples ? clamp((n - i) / Math.max(1, fadeOutSamples)) : 1
    L[i] *= fi * fo * 0.78
    R[i] *= fi * fo * 0.78
  }

  return encodeStereoWav(L, R, DSP_SR)
}

const SFX_REVERB_SEND = {
  metal_clash: 0.05,
  metal_clash_hi: 0.05,
  metal_clash_heavy: 0.07,
  blade_clash: 0.05,
  sword_clash: 0.05,
  weapon_clash: 0.05,
  blade_whoosh: 0.06,
  slash: 0.06,
  heavy_impact: 0.1,
  war_drum: 0.16,
  horse_gallop: 0.08,
  hoof_stomp: 0.06,
  slash_sweep: 0.14,
  arrow_zip: 0.06,
  chime: 0.3,
  sparkle: 0.3,
  shine: 0.3,
  bell_warm: 0.3,
  shimmer_swell: 0.32,
}

export function renderSfxMasterBuffer({ durationSec, cues = [] }) {
  const dur = Math.max(1, Number(durationSec) || 10)
  const n = Math.floor(dur * DSP_SR)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const sendL = new Float32Array(n)
  const sendR = new Float32Array(n)

  for (let idx = 0; idx < cues.length; idx++) {
    const cue = cues[idx]
    const at = Number(cue.atSec ?? 0)
    // at < 0 is allowed: a pre-roll (whoosh / hooves / sweep) may start before 0 s and is trimmed
    if (!Number.isFinite(at) || at >= dur || at < -2) continue
    const vol = Number.isFinite(Number(cue.volume)) ? Number(cue.volume) : 0.55
    const pan = Number.isFinite(Number(cue.pan)) ? Number(cue.pan) : 0
    const type = String(cue.type || 'whoosh').toLowerCase()
    const sample = synthSfxStereo(type, {
      d: cue.d,
      freqStart: cue.freqStart,
      freqEnd: cue.freqEnd,
      durationMs: cue.durationMs,
      q: cue.q,
      wave: cue.wave,
      noiseMix: cue.noiseMix,
      decay: cue.decay,
      seed: (Number(cue.seed) || 0) + idx * 7 + 31,
    })
    // Sample-accurate placement: the SFX onset lands on the exact audio sample of its locked video frame
    const startIdx = Math.round(at * DSP_SR)
    const p = clamp(pan, -1, 1)
    const gL = vol * Math.sqrt((1 - p) * 0.5) * 1.414
    const gR = vol * Math.sqrt((1 + p) * 0.5) * 1.414
    const send = SFX_REVERB_SEND[type] ?? 0.12
    const limit = Math.min(sample.L.length, n - startIdx)
    for (let i = startIdx < 0 ? -startIdx : 0; i < limit; i++) {
      const dst = startIdx + i
      const l = sample.L[i] * gL
      const r = sample.R[i] * gR
      L[dst] += l
      R[dst] += r
      sendL[dst] += l * send
      sendR[dst] += r * send
    }
  }

  // Short room on the send bus only (wet), so combat transients stay dry, crisp and in front of the BGM
  const wetL = new Float32Array(sendL)
  const wetR = new Float32Array(sendR)
  applyStereoReverb(wetL, wetR, 1.0, 0.62)
  for (let i = 0; i < n; i++) {
    // applyStereoReverb(mix=1) returns dry*0.55 + wet; remove the dry part to keep a pure wet return
    L[i] += wetL[i] - sendL[i] * 0.55
    R[i] += wetR[i] - sendR[i] * 0.55
  }
  return encodeStereoWav(L, R, DSP_SR)
}
