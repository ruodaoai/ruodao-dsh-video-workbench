/**
 * Procedural environmental sound beds ("ambience"): wind, river, rain, fire, crowd, night, city, office, forest, sea,
 * space and battle. Pure Node.js, deterministic (seeded), 48 kHz stereo.
 *
 * Every shot names the bed it needs in `scene.ambience` (director choice, or inferred from the picture description by
 * `inferAmbience`). Consecutive shots with the same bed play one continuous take; a change of place crossfades over the
 * cut. The bed is mixed far below voice and music: it fills the silent stretches with the sound of the place on screen
 * instead of adding more hits. Shots marked `none` stay silent, so genres without a place (UI, data, product) are unchanged.
 */
import { inferAmbience } from './figure-kit.js'
import { applyStereoReverb, DSP_SR, encodeStereoWav } from './audio-dsp.js'

export const AMBIENCE_BED_KINDS = Object.freeze(['wind', 'river', 'rain', 'fire', 'crowd', 'night', 'city', 'office', 'forest', 'sea', 'space', 'battle'])
/** Names shown to the user (Task Center log). */
export const AMBIENCE_LABELS_ZH = Object.freeze({
  wind: '风声',
  river: '江河流水',
  rain: '雨声',
  fire: '篝火噼啪',
  crowd: '人声嘈杂',
  night: '夜晚虫鸣',
  city: '城市街道',
  office: '室内环境',
  forest: '林间鸟鸣',
  sea: '海浪',
  space: '太空低鸣',
  battle: '远处战场',
})

// Beds carry nothing above ~10 kHz, so they render at half the mix rate (half the memory and CPU of a long film);
// the mixer resamples the bed to 48 kHz with every other input.
export const AMBIENCE_SR = 24000
const SR = AMBIENCE_SR
const REVERB_SCALE = SR / DSP_SR // applyStereoReverb sizes its rooms for DSP_SR
const CTL = 32 // control-rate block in samples (filters and envelopes update once per block)
const TWO_PI = Math.PI * 2
// Bed loudness (K-weighted, BS.1770 without gating) before the mixer applies its context gain: −24 LUFS plus a
// per-kind offset, so a room tone or crickets sit lower than wind or surf.
export const AMBIENCE_TARGET_LUFS = -24
const KIND_LEVEL_DB = { wind: 0, river: -1, rain: -1.5, fire: -1.5, crowd: -2, night: -4.5, city: -1, office: -5, forest: -2.5, sea: 0, space: -1, battle: 0 }
const XFADE_SEC = 0.8 // crossfade between two different beds across a cut
const MIN_SEGMENT_SEC = 0.5
// A long stretch of one bed is rendered as overlapping takes (bounded memory on a 10-minute film), crossfaded so the
// joins are inaudible
const TAKE_SEC = 40
const TAKE_XFADE_SEC = 0.6

function createRng(seed) {
  let s = seed >>> 0 || 1
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** RBJ biquad (transposed direct form II) whose coefficients may be updated every control block. */
class Biquad {
  constructor(type, fc, q = 0.707, gainDb = 0) {
    this.z1 = 0
    this.z2 = 0
    this.set(type, fc, q, gainDb)
  }
  set(type, fc, q = 0.707, gainDb = 0) {
    const f = Math.max(20, Math.min(SR * 0.45, fc))
    const w0 = (TWO_PI * f) / SR
    const cs = Math.cos(w0)
    const alpha = Math.sin(w0) / (2 * Math.max(0.1, q))
    let b0
    let b1
    let b2
    let a0 = 1 + alpha
    let a1 = -2 * cs
    let a2 = 1 - alpha
    if (type === 'lp') {
      b0 = (1 - cs) / 2
      b1 = 1 - cs
      b2 = b0
    } else if (type === 'hp') {
      b0 = (1 + cs) / 2
      b1 = -(1 + cs)
      b2 = b0
    } else if (type === 'hs') {
      // high shelf (RBJ)
      const A = Math.pow(10, gainDb / 40)
      const k = 2 * Math.sqrt(A) * alpha
      b0 = A * (A + 1 + (A - 1) * cs + k)
      b1 = -2 * A * (A - 1 + (A + 1) * cs)
      b2 = A * (A + 1 + (A - 1) * cs - k)
      a0 = A + 1 - (A - 1) * cs + k
      a1 = 2 * (A - 1 - (A + 1) * cs)
      a2 = A + 1 - (A - 1) * cs - k
    } else {
      // band-pass, 0 dB peak
      b0 = alpha
      b1 = 0
      b2 = -alpha
    }
    this.b0 = b0 / a0
    this.b1 = b1 / a0
    this.b2 = b2 / a0
    this.a1 = a1 / a0
    this.a2 = a2 / a0
    return this
  }
  tick(x) {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }
}

// Pink (≈ −3 dB/oct, Paul Kellet's economy filter) and brown (≈ −6 dB/oct, leaky integrator) noise from white input
class Pink {
  constructor() {
    this.b0 = 0
    this.b1 = 0
    this.b2 = 0
  }
  tick(w) {
    this.b0 = 0.99765 * this.b0 + w * 0.099046
    this.b1 = 0.963 * this.b1 + w * 0.2965164
    this.b2 = 0.57 * this.b2 + w * 1.0526913
    return (this.b0 + this.b1 + this.b2 + w * 0.1848) * 0.25
  }
}
class Brown {
  constructor() {
    this.y = 0
  }
  tick(w) {
    this.y = (this.y + 0.02 * w) / 1.02
    return this.y * 3.5
  }
}

/** Smooth random control curve at control rate: values in [lo, hi], a new target about every `periodSec` (cosine glide). */
function curve(nCtl, rng, periodSec, lo = 0, hi = 1, shape = 1) {
  const out = new Float32Array(nCtl)
  const ctlRate = SR / CTL
  let a = lo + (hi - lo) * Math.pow(rng(), shape)
  let i = 0
  while (i < nCtl) {
    const len = Math.max(2, Math.round(periodSec * ctlRate * (0.5 + rng())))
    const b = lo + (hi - lo) * Math.pow(rng(), shape)
    for (let k = 0; k < len && i < nCtl; k++, i++) out[i] = a + (b - a) * (1 - Math.cos((Math.PI * k) / len)) * 0.5
    a = b
  }
  return out
}

const panGains = (p) => {
  const c = Math.max(-1, Math.min(1, p))
  return [Math.sqrt(0.5 * (1 - c)), Math.sqrt(0.5 * (1 + c))]
}

/** Poisson event times in [0, durSec) at `rate` events per second. */
function poissonTimes(rng, rate, durSec, startSec = 0) {
  const out = []
  if (!(rate > 0)) return out
  let t = startSec
  for (;;) {
    t += -Math.log(1 - rng() * 0.999999) / rate
    if (t >= durSec) break
    out.push(t)
  }
  return out
}

/** Add an enveloped sine (optional exponential pitch glide and vibrato) into a stereo buffer. */
function addTone(L, R, { at, dur, f0, f1 = f0, amp, pan = 0, attack = 0.004, release = null, vibHz = 0, vibDepth = 0, rng = null, noise = 0 }) {
  const n = L.length
  const start = Math.floor(at * SR)
  const len = Math.min(n - start, Math.ceil(dur * SR))
  if (len <= 0 || start < 0) return
  const [gL, gR] = panGains(pan)
  const att = Math.max(1, Math.floor(attack * SR))
  const rel = Math.max(1, Math.floor((release ?? dur * 0.45) * SR))
  let ph = rng ? rng() * TWO_PI : 0
  const ratio = f1 / f0
  for (let j = 0; j < len; j++) {
    const u = j / len
    const env = (j < att ? j / att : 1) * (j > len - rel ? (len - j) / rel : 1)
    const vib = vibHz ? 1 + vibDepth * Math.sin((TWO_PI * vibHz * j) / SR) : 1
    const f = f0 * Math.pow(ratio, u) * vib
    ph += (TWO_PI * f) / SR
    let s = Math.sin(ph)
    if (noise && rng) s = s * (1 - noise) + (rng() * 2 - 1) * noise
    s *= env * amp
    L[start + j] += s * gL
    R[start + j] += s * gR
  }
}

/** Add a short decaying noise click (crackle, raindrop, key) into a stereo buffer; `hp` differentiates for brightness. */
function addClick(L, R, rng, { at, tau, amp, pan = 0, hp = true, maxLen = 0.03 }) {
  const n = L.length
  const start = Math.floor(at * SR)
  const len = Math.min(n - start, Math.ceil(Math.min(maxLen, tau * 6) * SR))
  if (len <= 0 || start < 0) return
  const [gL, gR] = panGains(pan)
  const k = Math.exp(-1 / Math.max(1, tau * SR))
  let env = amp
  let prev = 0
  for (let j = 0; j < len; j++) {
    const w = rng() * 2 - 1
    const s = (hp ? w - prev : w) * env
    prev = w
    L[start + j] += s * gL
    R[start + j] += s * gR
    env *= k
  }
}

function addFiltered(L, R, srcL, srcR, gain = 1) {
  for (let i = 0; i < L.length; i++) {
    L[i] += srcL[i] * gain
    R[i] += srcR[i] * gain
  }
}

// ----------------------------------------------------------------------------------------------------------------
// Bed generators: (n samples, rng) → { L, R }. Absolute level does not matter (each segment is RMS-normalised);
// the balance between the layers inside one bed does.
// ----------------------------------------------------------------------------------------------------------------

function genWind(n, rng, { level = 1, bright = 0 } = {}) {
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const nCtl = Math.ceil(n / CTL) + 1
  const gust = curve(nCtl, rng, 2.6, 0, 1, 1.35)
  const slow = curve(nCtl, rng, 9, 0.2, 1)
  const drift = curve(nCtl, rng, 6, -0.35, 0.35)
  const pkL = new Pink()
  const pkR = new Pink()
  const brL = new Brown()
  const brR = new Brown()
  const bpL = new Biquad('bp', 400, 1)
  const bpR = new Biquad('bp', 400, 1)
  const whistle = new Biquad('bp', 900, 10)
  const lpL = new Biquad('lp', 360, 0.6)
  const lpR = new Biquad('lp', 360, 0.6)
  for (let c = 0, i = 0; i < n; c++) {
    const g = Math.min(1, 0.15 + 0.85 * (0.62 * gust[c] + 0.38 * slow[c]))
    const fc = 240 + 1100 * Math.pow(g, 1.4) + bright * 900
    const q = 0.65 + 0.7 * g
    bpL.set('bp', fc * 0.93, q)
    bpR.set('bp', fc * 1.07, q)
    whistle.set('bp', 650 + 1500 * g + bright * 600, 10)
    const amp = (0.22 + 0.78 * Math.pow(g, 1.7)) * level
    const whAmp = Math.max(0, g - 0.58) * 1.3 * level
    const [wL, wR] = panGains(drift[c])
    const end = Math.min(n, i + CTL)
    for (; i < end; i++) {
      const wc = rng() * 2 - 1
      const xl = 0.6 * wc + 0.4 * (rng() * 2 - 1)
      const xr = 0.6 * wc + 0.4 * (rng() * 2 - 1)
      const wh = whistle.tick(wc) * whAmp * 2.2
      L[i] = (bpL.tick(pkL.tick(xl)) * 2.4 + lpL.tick(brL.tick(xl)) * 0.55) * amp + wh * wL
      R[i] = (bpR.tick(pkR.tick(xr)) * 2.4 + lpR.tick(brR.tick(xr)) * 0.55) * amp + wh * wR
    }
  }
  return { L, R }
}

function genRain(n, rng) {
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const nCtl = Math.ceil(n / CTL) + 1
  const inten = curve(nCtl, rng, 7, 0.75, 1)
  const hpL = new Biquad('hp', 1100, 0.6)
  const hpR = new Biquad('hp', 1100, 0.6)
  const lpL = new Biquad('lp', 7200, 0.6)
  const lpR = new Biquad('lp', 7200, 0.6)
  const patL = new Biquad('lp', 520, 0.6)
  const patR = new Biquad('lp', 520, 0.6)
  const pkL = new Pink()
  const pkR = new Pink()
  for (let c = 0, i = 0; i < n; c++) {
    const a = inten[c]
    const end = Math.min(n, i + CTL)
    for (; i < end; i++) {
      const wl = rng() * 2 - 1
      const wr = rng() * 2 - 1
      L[i] = lpL.tick(hpL.tick(wl)) * 0.55 * a + patL.tick(pkL.tick(wl)) * 0.7 * a
      R[i] = lpR.tick(hpR.tick(wr)) * 0.55 * a + patR.tick(pkR.tick(wr)) * 0.7 * a
    }
  }
  // individual drops: mostly soft noise ticks, a few pitched plinks on puddles / roof tiles
  const dur = n / SR
  for (const t of poissonTimes(rng, 120, dur)) {
    const amp = 0.05 + 0.45 * Math.pow(rng(), 3)
    const pan = rng() * 1.7 - 0.85
    if (rng() < 0.18) addTone(L, R, { at: t, dur: 0.012 + 0.03 * rng(), f0: 1800 + 3800 * rng(), f1: 1300 + 2200 * rng(), amp: amp * 0.55, pan, attack: 0.001, release: 0.02, rng })
    else addClick(L, R, rng, { at: t, tau: 0.0012 + 0.003 * rng(), amp, pan })
  }
  return { L, R }
}

function genRiver(n, rng) {
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const nCtl = Math.ceil(n / CTL) + 1
  const fastL = curve(nCtl, rng, 0.09, 0.5, 1)
  const fastR = curve(nCtl, rng, 0.09, 0.5, 1)
  const slow = curve(nCtl, rng, 6, 0.75, 1)
  const b1L = new Biquad('bp', 650, 0.55)
  const b1R = new Biquad('bp', 720, 0.55)
  const b2L = new Biquad('bp', 1900, 0.8)
  const b2R = new Biquad('bp', 2100, 0.8)
  const lwL = new Biquad('lp', 230, 0.6)
  const lwR = new Biquad('lp', 230, 0.6)
  const pkL = new Pink()
  const pkR = new Pink()
  const brL = new Brown()
  const brR = new Brown()
  for (let c = 0, i = 0; i < n; c++) {
    const end = Math.min(n, i + CTL)
    const s = slow[c]
    for (; i < end; i++) {
      const wl = rng() * 2 - 1
      const wr = rng() * 2 - 1
      L[i] = (b1L.tick(pkL.tick(wl)) * 1.6 * fastL[c] + b2L.tick(wl) * 0.32 * fastR[c] + lwL.tick(brL.tick(wl)) * 0.8) * s
      R[i] = (b1R.tick(pkR.tick(wr)) * 1.6 * fastR[c] + b2R.tick(wr) * 0.32 * fastL[c] + lwR.tick(brR.tick(wr)) * 0.8) * s
    }
  }
  // bubbles and gurgles: short rising sine chirps
  const dur = n / SR
  for (const t of poissonTimes(rng, 26, dur)) {
    const f0 = 450 + 1800 * rng()
    const d = 0.012 + 0.04 * rng()
    addTone(L, R, { at: t, dur: d * 2.2, f0, f1: f0 * (1.25 + 0.7 * rng()), amp: 0.04 + 0.28 * Math.pow(rng(), 2), pan: rng() * 1.2 - 0.6, attack: 0.002, release: d * 1.4, rng })
  }
  return { L, R }
}

function genSea(n, rng) {
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const nCtl = Math.ceil(n / CTL) + 1
  const env = new Float32Array(nCtl)
  const foam = new Float32Array(nCtl)
  const wpan = new Float32Array(nCtl)
  const dur = n / SR
  let t = -rng() * 3
  while (t < dur) {
    const T = 5.5 + 4 * rng()
    const peak = 0.6 + 0.4 * rng()
    const p = rng() * 0.8 - 0.4
    const rise = T * (0.45 + 0.15 * rng())
    const c0 = Math.max(0, Math.floor((t * SR) / CTL))
    const c1 = Math.min(nCtl, Math.ceil(((t + T * 1.8) * SR) / CTL))
    for (let c = c0; c < c1; c++) {
      const u = (c * CTL) / SR - t
      const e = (u < rise ? Math.pow(Math.sin((Math.PI / 2) * (u / rise)), 2) : Math.exp(-(u - rise) / (T * 0.28))) * peak
      const f = u < rise ? 0 : Math.exp(-(u - rise) / (T * 0.45)) * (1 - Math.exp(-(u - rise) / 0.25)) * peak
      if (e > env[c]) {
        env[c] = e
        wpan[c] = p
      }
      if (f > foam[c]) foam[c] = f
    }
    t += T * (0.75 + 0.35 * rng())
  }
  const lpL = new Biquad('lp', 400, 0.6)
  const lpR = new Biquad('lp', 400, 0.6)
  const hpL = new Biquad('hp', 2400, 0.6)
  const hpR = new Biquad('hp', 2400, 0.6)
  const washL = new Biquad('lp', 600, 0.6)
  const washR = new Biquad('lp', 600, 0.6)
  const pkL = new Pink()
  const pkR = new Pink()
  const brL = new Brown()
  const brR = new Brown()
  for (let c = 0, i = 0; i < n; c++) {
    const e = env[c]
    lpL.set('lp', 220 + 1600 * e, 0.6)
    lpR.set('lp', 230 + 1650 * e, 0.6)
    const amp = 0.12 + 0.88 * e
    const fo = foam[c] * 0.5
    const [gL, gR] = panGains(wpan[c] * e)
    const end = Math.min(n, i + CTL)
    for (; i < end; i++) {
      const wl = rng() * 2 - 1
      const wr = rng() * 2 - 1
      const bodyL = lpL.tick(0.6 * brL.tick(wl) + 0.4 * pkL.tick(wl)) * amp * 1.4
      const bodyR = lpR.tick(0.6 * brR.tick(wr) + 0.4 * pkR.tick(wr)) * amp * 1.4
      L[i] = bodyL * gL * 1.41 + hpL.tick(wl) * fo + washL.tick(wl) * 0.12
      R[i] = bodyR * gR * 1.41 + hpR.tick(wr) * fo + washR.tick(wr) * 0.12
    }
  }
  return { L, R }
}

function genFire(n, rng) {
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const nCtl = Math.ceil(n / CTL) + 1
  const flick = curve(nCtl, rng, 0.35, 0.55, 1)
  const slow = curve(nCtl, rng, 5, 0.7, 1)
  const roarL = new Biquad('lp', 180, 0.7)
  const roarR = new Biquad('lp', 190, 0.7)
  const hissL = new Biquad('bp', 3200, 0.7)
  const hissR = new Biquad('bp', 3400, 0.7)
  const brL = new Brown()
  const brR = new Brown()
  for (let c = 0, i = 0; i < n; c++) {
    const a = flick[c] * slow[c]
    const end = Math.min(n, i + CTL)
    for (; i < end; i++) {
      const wl = rng() * 2 - 1
      const wr = rng() * 2 - 1
      L[i] = roarL.tick(brL.tick(wl)) * 1.3 * a + hissL.tick(wl) * 0.07 * flick[c]
      R[i] = roarR.tick(brR.tick(wr)) * 1.3 * a + hissR.tick(wr) * 0.07 * flick[c]
    }
  }
  const dur = n / SR
  // crackle clusters: 1–5 bright clicks within a few tens of milliseconds
  for (const t of poissonTimes(rng, 8, dur)) {
    const m = 1 + Math.floor(rng() * 5)
    const pan = rng() * 1.2 - 0.6
    let tt = t
    for (let k = 0; k < m; k++) {
      addClick(L, R, rng, { at: tt, tau: 0.0005 + 0.002 * rng(), amp: 0.25 + 0.9 * Math.pow(rng(), 2.2), pan: pan + (rng() - 0.5) * 0.2 })
      tt += 0.004 + 0.022 * rng()
    }
  }
  // occasional deeper pops (resin pockets)
  for (const t of poissonTimes(rng, 0.5, dur)) {
    const pan = rng() * 1.2 - 0.6
    addTone(L, R, { at: t, dur: 0.06, f0: 150 + 110 * rng(), f1: 90 + 40 * rng(), amp: 0.35, pan, attack: 0.001, release: 0.05, rng })
    addClick(L, R, rng, { at: t, tau: 0.0015, amp: 0.7, pan })
  }
  return { L, R }
}

// Vowel formants (F1, F2) for the murmur of many voices
const VOWELS = [
  [800, 1200],
  [500, 1900],
  [320, 2300],
  [500, 900],
  [340, 800],
  [650, 1600],
]

/**
 * Many voices: glottal-like pulse trains with intonation, filtered through changing vowel formants, phrases and
 * pauses per speaker, spread across the stereo field. `shout` gives the distant roar of an army instead of a murmur.
 */
function genVoices(n, rng, { voices = 11, shout = false, lp = 3200 } = {}) {
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const dur = n / SR
  const nCtl = Math.ceil(n / CTL) + 1
  for (let v = 0; v < voices; v++) {
    const vr = createRng(Math.floor(rng() * 4294967296))
    const pitch = shout ? 190 + 140 * vr() : 95 + 150 * vr()
    const [gL, gR] = panGains(vr() * 1.7 - 0.85)
    const level = 0.45 + 0.55 * vr()
    const gate = new Float32Array(nCtl)
    const f1c = new Float32Array(nCtl)
    const f2c = new Float32Array(nCtl)
    const into = new Float32Array(nCtl)
    // phrases of syllables, then a pause (most voices are already talking when the take starts)
    let t = vr() * 0.5
    while (t < dur) {
      const phrase = shout ? 0.8 + 2.4 * vr() : 1.2 + 2.8 * vr()
      const pEnd = Math.min(dur, t + phrase)
      while (t < pEnd) {
        const syl = shout ? 0.28 + 0.55 * vr() : 0.11 + 0.2 * vr()
        const vowel = VOWELS[Math.floor(vr() * VOWELS.length)]
        const amp = 0.55 + 0.45 * vr()
        const bend = (vr() - 0.5) * (shout ? 0.25 : 0.16)
        const c0 = Math.floor((t * SR) / CTL)
        const c1 = Math.min(nCtl, Math.ceil(((t + syl) * SR) / CTL))
        for (let c = c0; c < c1; c++) {
          const u = (c - c0) / Math.max(1, c1 - c0)
          gate[c] = Math.max(gate[c], Math.pow(Math.sin(Math.PI * u), shout ? 0.5 : 0.8) * amp)
          f1c[c] = vowel[0]
          f2c[c] = vowel[1]
          into[c] = 1 + bend * u
        }
        t += syl * (shout ? 0.9 : 1.05)
      }
      t += shout ? 0.2 + 1.2 * vr() : 0.35 + 1.5 * vr()
    }
    const bp1 = new Biquad('bp', 500, 5)
    const bp2 = new Biquad('bp', 1500, 7)
    let ph = vr()
    let f1Now = 500
    let f2Now = 1500
    for (let c = 0, i = 0; i < n; c++) {
      const g = gate[c] * level
      const end = Math.min(n, i + CTL)
      if (g < 0.002) {
        i = end
        continue
      }
      // glide formants instead of jumping (no zipper noise between syllables)
      if (f1c[c]) {
        f1Now += (f1c[c] - f1Now) * 0.25
        f2Now += (f2c[c] - f2Now) * 0.25
      }
      bp1.set('bp', f1Now, 5)
      bp2.set('bp', f2Now, 7)
      const f0 = pitch * (into[c] || 1)
      for (; i < end; i++) {
        ph += f0 / SR
        if (ph >= 1) ph -= 1
        const src = 2 * ph - 1 + (vr() * 2 - 1) * 0.3
        const s = (bp1.tick(src) * 1.0 + bp2.tick(src) * 0.6) * g
        L[i] += s * gL
        R[i] += s * gR
      }
    }
  }
  // distance: soften the top and add a room
  const lpL = new Biquad('lp', lp, 0.6)
  const lpR = new Biquad('lp', lp, 0.6)
  const hpL = new Biquad('hp', 140, 0.6)
  const hpR = new Biquad('hp', 140, 0.6)
  for (let i = 0; i < n; i++) {
    L[i] = hpL.tick(lpL.tick(L[i]))
    R[i] = hpR.tick(lpR.tick(R[i]))
  }
  applyStereoReverb(L, R, shout ? 0.32 : 0.22, (shout ? 1.3 : 0.9) * REVERB_SCALE)
  return { L, R }
}

function genCrowd(n, rng) {
  const out = genVoices(n, rng, { voices: 11 })
  // an under-layer of indistinct chatter keeps the room busy between phrases
  const nCtl = Math.ceil(n / CTL) + 1
  const busy = curve(nCtl, rng, 3, 0.6, 1)
  const bpL = new Biquad('bp', 700, 0.9)
  const bpR = new Biquad('bp', 760, 0.9)
  const pkL = new Pink()
  const pkR = new Pink()
  for (let c = 0, i = 0; i < n; c++) {
    const end = Math.min(n, i + CTL)
    for (; i < end; i++) {
      out.L[i] += bpL.tick(pkL.tick(rng() * 2 - 1)) * 0.22 * busy[c]
      out.R[i] += bpR.tick(pkR.tick(rng() * 2 - 1)) * 0.22 * busy[c]
    }
  }
  return out
}

function genNight(n, rng) {
  const { L, R } = genWind(n, rng, { level: 0.35 })
  for (let i = 0; i < n; i++) {
    L[i] *= 0.5
    R[i] *= 0.5
  }
  const dur = n / SR
  const crickets = 3
  for (let k = 0; k < crickets; k++) {
    const f = 3900 + 1300 * rng()
    const pulses = 3 + Math.floor(rng() * 2)
    const pulseLen = 0.012 + 0.006 * rng()
    const pulseGap = 0.028 + 0.01 * rng()
    const groupGap = 0.45 + 0.6 * rng()
    const amp = (0.35 + 0.65 * rng()) * 0.5
    const pan = rng() * 1.4 - 0.7
    let t = rng() * 1.5
    while (t < dur) {
      const sing = 4 + 8 * rng()
      const sEnd = Math.min(dur, t + sing)
      while (t < sEnd) {
        for (let p = 0; p < pulses; p++) {
          addTone(L, R, { at: t + p * (pulseLen + pulseGap), dur: pulseLen, f0: f, f1: f * 1.01, amp, pan, attack: pulseLen * 0.35, release: pulseLen * 0.45 })
        }
        t += groupGap * (0.85 + 0.3 * rng())
      }
      t += 1 + 3 * rng()
    }
  }
  return { L, R }
}

function genCity(n, rng) {
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const nCtl = Math.ceil(n / CTL) + 1
  const slow = curve(nCtl, rng, 8, 0.7, 1)
  const rmL = new Biquad('lp', 140, 0.7)
  const rmR = new Biquad('lp', 150, 0.7)
  const midL = new Biquad('lp', 900, 0.6)
  const midR = new Biquad('lp', 900, 0.6)
  const hpL = new Biquad('hp', 120, 0.6)
  const hpR = new Biquad('hp', 120, 0.6)
  const brL = new Brown()
  const brR = new Brown()
  const pkL = new Pink()
  const pkR = new Pink()
  for (let c = 0, i = 0; i < n; c++) {
    const a = slow[c]
    const end = Math.min(n, i + CTL)
    for (; i < end; i++) {
      const wl = rng() * 2 - 1
      const wr = rng() * 2 - 1
      L[i] = rmL.tick(brL.tick(wl)) * 1.1 * a + hpL.tick(midL.tick(pkL.tick(wl))) * 0.35
      R[i] = rmR.tick(brR.tick(wr)) * 1.1 * a + hpR.tick(midR.tick(pkR.tick(wr))) * 0.35
    }
  }
  // passing cars: a filtered swell travelling across the stereo field
  const dur = n / SR
  for (const t0 of poissonTimes(rng, 1 / 4.2, dur, -2)) {
    const D = 2.6 + 2.4 * rng()
    const dir = rng() < 0.5 ? -1 : 1
    const amp = 0.35 + 0.6 * rng()
    const bright = 0.6 + 0.8 * rng()
    const start = Math.max(0, Math.floor(t0 * SR))
    const stop = Math.min(n, Math.floor((t0 + D) * SR))
    const lp = new Biquad('lp', 400, 0.7)
    const hiss = new Biquad('hp', 1800, 0.6)
    const pk = new Pink()
    for (let i = start; i < stop; i += CTL) {
      const u = (i / SR - t0) / D
      const e = Math.pow(Math.sin(Math.PI * Math.max(0, Math.min(1, u))), 2)
      lp.set('lp', 300 + 2000 * e * bright, 0.7)
      const [gL, gR] = panGains(dir * (u * 2 - 1) * 0.8)
      const end = Math.min(stop, i + CTL)
      for (let j = i; j < end; j++) {
        const w = rng() * 2 - 1
        const s = (lp.tick(pk.tick(w)) * 1.4 + hiss.tick(w) * 0.12) * e * amp
        L[j] += s * gL
        R[j] += s * gR
      }
    }
  }
  return { L, R }
}

function genOffice(n, rng) {
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const rtL = new Biquad('lp', 650, 0.6)
  const rtR = new Biquad('lp', 650, 0.6)
  const hpL = new Biquad('hp', 90, 0.6)
  const hpR = new Biquad('hp', 90, 0.6)
  const airL = new Biquad('lp', 110, 0.7)
  const airR = new Biquad('lp', 110, 0.7)
  const pkL = new Pink()
  const pkR = new Pink()
  const brL = new Brown()
  const brR = new Brown()
  for (let i = 0; i < n; i++) {
    const wl = rng() * 2 - 1
    const wr = rng() * 2 - 1
    L[i] = hpL.tick(rtL.tick(pkL.tick(wl))) * 0.6 + airL.tick(brL.tick(wl)) * 0.4
    R[i] = hpR.tick(rtR.tick(pkR.tick(wr))) * 0.6 + airR.tick(brR.tick(wr)) * 0.4
  }
  // someone typing now and then: key clicks with a soft low "thock"
  const dur = n / SR
  let t = 1 + 4 * rng()
  while (t < dur) {
    const burst = 1 + 2.2 * rng()
    const pan = rng() * 1 - 0.5
    const amp = 0.25 + 0.35 * rng()
    const rate = 6 + 5 * rng()
    for (const k of poissonTimes(rng, rate, Math.min(dur, t + burst), t)) {
      const a = amp * (0.6 + 0.4 * rng())
      addClick(L, R, rng, { at: k, tau: 0.0007 + 0.0006 * rng(), amp: a * 1.6, pan, maxLen: 0.006 })
      addTone(L, R, { at: k, dur: 0.03, f0: 240 + 90 * rng(), f1: 200, amp: a * 0.45, pan, attack: 0.001, release: 0.025 })
    }
    t += burst + 3 + 6 * rng()
  }
  return { L, R }
}

function genForest(n, rng) {
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const nCtl = Math.ceil(n / CTL) + 1
  const gust = curve(nCtl, rng, 2.4, 0, 1)
  const slow = curve(nCtl, rng, 7, 0.5, 1)
  const hpL = new Biquad('hp', 1300, 0.6)
  const hpR = new Biquad('hp', 1300, 0.6)
  const lpL = new Biquad('lp', 6500, 0.6)
  const lpR = new Biquad('lp', 6500, 0.6)
  const bzL = new Biquad('lp', 280, 0.6)
  const bzR = new Biquad('lp', 280, 0.6)
  const brL = new Brown()
  const brR = new Brown()
  for (let c = 0, i = 0; i < n; c++) {
    const leaves = 0.1 + 0.55 * Math.pow(gust[c], 1.5)
    const end = Math.min(n, i + CTL)
    for (; i < end; i++) {
      const wl = rng() * 2 - 1
      const wr = rng() * 2 - 1
      L[i] = lpL.tick(hpL.tick(wl)) * leaves * 0.6 + bzL.tick(brL.tick(wl)) * 0.15 * slow[c]
      R[i] = lpR.tick(hpR.tick(wr)) * leaves * 0.6 + bzR.tick(brR.tick(wr)) * 0.15 * slow[c]
    }
  }
  // birds on their own bus with a little forest reverb
  const bL = new Float32Array(n)
  const bR = new Float32Array(n)
  const dur = n / SR
  for (const t of poissonTimes(rng, 0.5, dur)) {
    const pan = rng() * 1.6 - 0.8
    const amp = 0.25 + 0.35 * rng()
    const kind = rng()
    if (kind < 0.45) {
      // chirps: quick up (or down) sweeps
      const m = 2 + Math.floor(rng() * 4)
      const up = rng() < 0.75
      let tt = t
      for (let k = 0; k < m; k++) {
        const d = 0.05 + 0.04 * rng()
        const lo = 2600 + 800 * rng()
        const hi = 4200 + 1600 * rng()
        addTone(bL, bR, { at: tt, dur: d, f0: up ? lo : hi, f1: up ? hi : lo, amp, pan, attack: 0.006, release: d * 0.5 })
        tt += d + 0.06 + 0.06 * rng()
      }
    } else if (kind < 0.75) {
      // two-note whistle
      const f = 1700 + 400 * rng()
      const ratio = 1.2 + 0.15 * rng()
      const d1 = 0.16 + 0.1 * rng()
      addTone(bL, bR, { at: t, dur: d1, f0: f, f1: f * 1.03, amp, pan, attack: 0.02, vibHz: 6, vibDepth: 0.015 })
      addTone(bL, bR, { at: t + d1 + 0.04, dur: d1, f0: f * ratio, f1: f * ratio * 0.97, amp: amp * 0.9, pan, attack: 0.02, vibHz: 6, vibDepth: 0.015 })
    } else {
      // trill
      const f = 3000 + 1300 * rng()
      const d = 0.3 + 0.4 * rng()
      const am = 20 + 10 * rng()
      const start = Math.floor(t * SR)
      const len = Math.min(n - start, Math.floor(d * SR))
      const [gL, gR] = panGains(pan)
      for (let j = 0; j < len; j++) {
        const u = j / len
        const env = Math.sin(Math.PI * u) * (0.5 + 0.5 * Math.sin((TWO_PI * am * j) / SR))
        const s = Math.sin((TWO_PI * f * j) / SR) * env * amp * 0.8
        bL[start + j] += s * gL
        bR[start + j] += s * gR
      }
    }
  }
  applyStereoReverb(bL, bR, 0.25, 1.1 * REVERB_SCALE)
  addFiltered(L, R, bL, bR, 1)
  return { L, R }
}

function genSpace(n, rng) {
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const nCtl = Math.ceil(n / CTL) + 1
  const deepA = curve(nCtl, rng, 12, 0.6, 1)
  const sweepF = curve(nCtl, rng, 7, 0, 1)
  const sweepA = curve(nCtl, rng, 9, 0.5, 1)
  const shimF = curve(nCtl, rng, 5, 0, 1)
  const shimA = curve(nCtl, rng, 6, 0.2, 1)
  const dpL = new Biquad('lp', 85, 0.7)
  const dpR = new Biquad('lp', 90, 0.7)
  const swL = new Biquad('bp', 200, 6)
  const swR = new Biquad('bp', 220, 6)
  const shL = new Biquad('bp', 3000, 5)
  const shR = new Biquad('bp', 3200, 5)
  const brL = new Brown()
  const brR = new Brown()
  for (let c = 0, i = 0; i < n; c++) {
    swL.set('bp', 130 + 330 * sweepF[c], 6)
    swR.set('bp', 140 + 340 * sweepF[c], 6)
    shL.set('bp', 2800 + 2600 * shimF[c], 5)
    shR.set('bp', 2900 + 2500 * shimF[c], 5)
    const end = Math.min(n, i + CTL)
    for (; i < end; i++) {
      const wl = rng() * 2 - 1
      const wr = rng() * 2 - 1
      L[i] = dpL.tick(brL.tick(wl)) * 1.4 * deepA[c] + swL.tick(wl) * 0.9 * sweepA[c] + shL.tick(wr) * 0.12 * shimA[c]
      R[i] = dpR.tick(brR.tick(wr)) * 1.4 * deepA[c] + swR.tick(wr) * 0.9 * sweepA[c] + shR.tick(wl) * 0.12 * shimA[c]
    }
  }
  applyStereoReverb(L, R, 0.35, 1.4 * REVERB_SCALE)
  return { L, R }
}

function genBattle(n, rng) {
  const roar = genVoices(n, rng, { voices: 9, shout: true, lp: 1500 })
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const nCtl = Math.ceil(n / CTL) + 1
  const rum = curve(nCtl, rng, 3, 0.55, 1)
  const swell = curve(nCtl, rng, 5, 0.35, 1)
  const rmL = new Biquad('lp', 110, 0.7)
  const rmR = new Biquad('lp', 115, 0.7)
  const brL = new Brown()
  const brR = new Brown()
  for (let c = 0, i = 0; i < n; c++) {
    const end = Math.min(n, i + CTL)
    for (; i < end; i++) {
      L[i] = rmL.tick(brL.tick(rng() * 2 - 1)) * 1.2 * rum[c] + roar.L[i] * swell[c] * 1.6
      R[i] = rmR.tick(brR.tick(rng() * 2 - 1)) * 1.2 * rum[c] + roar.R[i] * swell[c] * 1.6
    }
  }
  // distant steel: inharmonic partials, dulled and pushed back by distance
  const cL = new Float32Array(n)
  const cR = new Float32Array(n)
  const dur = n / SR
  for (const t of poissonTimes(rng, 2.6, dur)) {
    const f0 = 1600 + 1100 * rng()
    const d = 0.06 + 0.1 * rng()
    const amp = 0.05 + 0.18 * Math.pow(rng(), 1.5)
    const pan = rng() * 1.7 - 0.85
    const partials = [1, 1.47, 2.31, 3.09]
    const amps = [1, 0.6, 0.4, 0.25]
    for (let k = 0; k < partials.length; k++) addTone(cL, cR, { at: t, dur: d * (1.4 - k * 0.2), f0: f0 * partials[k], amp: amp * amps[k], pan, attack: 0.0008, release: d })
  }
  const lpL = new Biquad('lp', 2800, 0.6)
  const lpR = new Biquad('lp', 2800, 0.6)
  for (let i = 0; i < n; i++) {
    cL[i] = lpL.tick(cL[i])
    cR[i] = lpR.tick(cR[i])
  }
  applyStereoReverb(cL, cR, 0.4, 1.3 * REVERB_SCALE)
  addFiltered(L, R, cL, cR, 1)
  return { L, R }
}

const GENERATORS = {
  wind: (n, rng) => genWind(n, rng),
  river: genRiver,
  rain: genRain,
  fire: genFire,
  crowd: genCrowd,
  night: genNight,
  city: genCity,
  office: genOffice,
  forest: genForest,
  sea: genSea,
  space: genSpace,
  battle: genBattle,
}

/** Ungated BS.1770 loudness (LUFS) of a stereo buffer at SR: K-weighting shelf + RLB high-pass, summed channel power. */
export function measureLoudnessLufs(L, R) {
  const n = Math.min(L.length, R.length)
  if (!n) return -Infinity
  const shL = new Biquad('hs', 1681.97, 0.7072, 4.0)
  const shR = new Biquad('hs', 1681.97, 0.7072, 4.0)
  const hpL = new Biquad('hp', 38.13, 0.5003)
  const hpR = new Biquad('hp', 38.13, 0.5003)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const l = hpL.tick(shL.tick(L[i]))
    const r = hpR.tick(shR.tick(R[i]))
    sum += l * l + r * r
  }
  const ms = sum / n
  return ms > 1e-20 ? -0.691 + 10 * Math.log10(ms) : -Infinity
}

/** One bed of `kind`, `durSec` long, loudness-matched to the kind's level with a soft ceiling on rare peaks. */
export function renderAmbienceLayer(kind, durSec, seed = 1) {
  const gen = GENERATORS[kind]
  const n = Math.max(1, Math.floor(Math.max(0, Number(durSec) || 0) * SR))
  if (!gen) return { L: new Float32Array(n), R: new Float32Array(n) }
  const rng = createRng(seed)
  const { L, R } = gen(n, rng)
  const lufs = measureLoudnessLufs(L, R)
  const gain = Number.isFinite(lufs) ? Math.pow(10, (AMBIENCE_TARGET_LUFS + (KIND_LEVEL_DB[kind] || 0) - lufs) / 20) : 0
  const ceil = 0.5
  for (let i = 0; i < n; i++) {
    let l = L[i] * gain
    let r = R[i] * gain
    if (l > ceil || l < -ceil) l = Math.sign(l) * (ceil + (1 - ceil) * Math.tanh((Math.abs(l) - ceil) / (1 - ceil)))
    if (r > ceil || r < -ceil) r = Math.sign(r) * (ceil + (1 - ceil) * Math.tanh((Math.abs(r) - ceil) / (1 - ceil)))
    L[i] = l
    R[i] = r
  }
  return { L, R }
}

function sceneTiming(sc, fps) {
  const start = Number(sc?.startSec)
  const durRaw = Number(sc?.durationSec)
  const dur = Number.isFinite(durRaw) && durRaw > 0 ? durRaw : (Number(sc?.durationInFrames) || 0) / fps
  return { start: Number.isFinite(start) ? start : NaN, dur }
}

/**
 * Shots → continuous bed segments [{ kind, start, end }]. A shot without an `ambience` field is inferred from its
 * picture description (explainer/data/product genres stay silent unless the director chose a bed); `none` is silence.
 */
export function planAmbienceSegments(scenes = [], totalSec = 0, { genre = '', fps = 30 } = {}) {
  const list = Array.isArray(scenes) ? scenes : []
  const total = Math.max(0, Number(totalSec) || 0)
  const out = []
  let cursor = 0
  for (const sc of list) {
    if (!sc || typeof sc !== 'object') continue
    const { start: rawStart, dur } = sceneTiming(sc, Math.max(1, Number(fps) || 30))
    const start = Number.isFinite(rawStart) ? rawStart : cursor
    cursor = start + Math.max(0, dur)
    const raw = sc.ambience === undefined || sc.ambience === null || sc.ambience === '' ? inferAmbience(sc, genre) : String(sc.ambience).trim().toLowerCase()
    const kind = AMBIENCE_BED_KINDS.includes(raw) ? raw : ''
    if (!kind || !(dur > 0)) continue
    const s = Math.max(0, start)
    const e = total > 0 ? Math.min(total, start + dur) : start + dur
    if (e - s <= 0.02) continue
    const last = out[out.length - 1]
    if (last && last.kind === kind && s - last.end < 0.12) last.end = Math.max(last.end, e)
    else out.push({ kind, start: s, end: e })
  }
  return out.filter((seg) => seg.end - seg.start >= MIN_SEGMENT_SEC).map((seg) => ({ kind: seg.kind, start: round3(seg.start), end: round3(seg.end) }))
}

const round3 = (v) => Math.round(v * 1000) / 1000

function mixTake(L, R, layer, startSec, fadeInSec, fadeOutSec) {
  const i0 = Math.floor(startSec * SR)
  const m = Math.min(layer.L.length, L.length - i0)
  const fi = Math.max(1, Math.floor(fadeInSec * SR))
  const fo = Math.max(1, Math.floor(fadeOutSec * SR))
  for (let j = 0; j < m; j++) {
    let g = 1
    // equal-power curves: two overlapping fades of the same length keep a constant level
    if (j < fi) g *= Math.sin((Math.PI / 2) * (j / fi))
    if (j > m - fo) g *= Math.sin((Math.PI / 2) * Math.max(0, (m - j) / fo))
    L[i0 + j] += layer.L[j] * g
    R[i0 + j] += layer.R[j] * g
  }
}

/**
 * Render the whole bed track (AMBIENCE_SR stereo Float32 arrays): each segment plays as continuous takes, faded in/out
 * with equal-power curves and overlapped by XFADE_SEC where two different beds meet at a cut.
 */
export function renderAmbienceBed({ durationSec, segments = [], seed = 0 }) {
  const total = Math.max(0.1, Number(durationSec) || 0)
  const n = Math.floor(total * SR)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const segs = Array.isArray(segments) ? segments : []
  let covered = 0
  for (let k = 0; k < segs.length; k++) {
    const seg = segs[k]
    if (!GENERATORS[seg.kind]) continue
    const prevTouch = k > 0 && Math.abs(segs[k - 1].end - seg.start) < 0.12
    const nextTouch = k < segs.length - 1 && Math.abs(segs[k + 1].start - seg.end) < 0.12
    const s0 = Math.max(0, seg.start - (prevTouch ? XFADE_SEC / 2 : 0))
    const s1 = Math.min(total, seg.end + (nextTouch ? XFADE_SEC / 2 : 0))
    const len = s1 - s0
    if (len <= 0.05) continue
    covered += Math.min(seg.end, total) - seg.start
    const fadeIn = prevTouch ? Math.min(XFADE_SEC, len / 2) : Math.min(seg.start <= 0.05 ? 1.0 : 1.2, len * 0.3)
    const fadeOut = nextTouch ? Math.min(XFADE_SEC, len / 2) : Math.min(seg.end >= total - 0.05 ? 1.5 : 1.2, len * 0.3)
    const baseSeed = (hashSeed(`${seg.kind}:${k}`) + (Number(seed) >>> 0)) >>> 0
    for (let t = s0, take = 0; t < s1 - 0.01; take++) {
      const tEnd = Math.min(s1, t + TAKE_SEC)
      const first = take === 0
      const last = tEnd >= s1 - 0.01
      const tLen = tEnd - t
      const layer = renderAmbienceLayer(seg.kind, tLen, (baseSeed + take * 7919) >>> 0)
      mixTake(L, R, layer, t, first ? fadeIn : Math.min(TAKE_XFADE_SEC, tLen / 2), last ? fadeOut : Math.min(TAKE_XFADE_SEC, tLen / 2))
      if (last) break
      t = tEnd - TAKE_XFADE_SEC
    }
  }
  return { L, R, coverageSec: round3(covered) }
}

/** The bed track as a WAV buffer (16-bit stereo at AMBIENCE_SR; the mixer resamples it) plus the seconds it covers. */
export function renderAmbienceBedWav(opts) {
  const { L, R, coverageSec } = renderAmbienceBed(opts)
  return { wav: encodeStereoWav(L, R, SR), coverageSec }
}
