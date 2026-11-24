/**
 * Precision Beat-Tracking Core (pure Node.js, zero native deps).
 *
 * Pipeline (fully deterministic):
 *   1. 22.05 kHz mono PCM -> Hann STFT (N=1024, hop=128 ≈ 5.8 ms)
 *   2. Log-compressed spectral-flux onset envelopes (full band + low "kick" band)
 *   3. Tempo: comb autocorrelation (1x/2x/3x/4x lags) weighted by a log-normal perceptual prior
 *   4. Ellis dynamic-programming beat tracker on the onset envelope
 *   5. Global constant-tempo grid fit (period ±1.2 % + phase) maximising onset energy on the grid
 *   6. Per-beat micro snapping to the true transient peak (±28 ms) with parabolic sub-frame refinement
 *
 * Why: the previous RMS-difference detector (20 ms hop) reported beats 20–40 ms late and could lock
 * a whole section onto the off-beat. Spectral flux peaks at the attack itself, so cuts / SFX now land
 * ON the drum hit instead of after it.
 */

export const BT_SR = 22050
const FFT_N = 1024
const HOP = 128
const HOP_SEC = HOP / BT_SR
// Time of the acoustic attack relative to flux frame f. Theory says (f*HOP + N/4..N/2)/SR; calibrated on
// synthetic drum loops with known hit times (the log-flux peak lands ~15 ms after the window centre crosses
// the attack, so the attack itself is centre + 15 ms).
const FRAME_CENTER_OFFSET_SEC = FFT_N / 2 / BT_SR + 0.0152

function makeHann(n) {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
  return w
}

function makeFft(n) {
  const levels = Math.round(Math.log2(n))
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b)
    rev[i] = r
  }
  const cosT = new Float64Array(n / 2)
  const sinT = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cosT[i] = Math.cos((2 * Math.PI * i) / n)
    sinT[i] = -Math.sin((2 * Math.PI * i) / n)
  }
  return (re, im) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (i < j) {
        const tr = re[i]
        re[i] = re[j]
        re[j] = tr
        const ti = im[i]
        im[i] = im[j]
        im[j] = ti
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = cosT[k * step]
          const wi = sinT[k * step]
          const a = start + k
          const b = a + half
          const xr = re[b] * wr - im[b] * wi
          const xi = re[b] * wi + im[b] * wr
          re[b] = re[a] - xr
          im[b] = im[a] - xi
          re[a] += xr
          im[a] += xi
        }
      }
    }
  }
}

function movingAverage(arr, radius) {
  const n = arr.length
  const out = new Float32Array(n)
  const pref = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) pref[i + 1] = pref[i] + arr[i]
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - radius)
    const b = Math.min(n, i + radius + 1)
    out[i] = (pref[b] - pref[a]) / Math.max(1, b - a)
  }
  return out
}

function normalizeEnvelope(raw, detrendRadius) {
  const n = raw.length
  const smooth = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? raw[i - 1] : raw[i]
    const c = i < n - 1 ? raw[i + 1] : raw[i]
    smooth[i] = 0.25 * a + 0.5 * raw[i] + 0.25 * c
  }
  const trend = movingAverage(smooth, detrendRadius)
  const out = new Float32Array(n)
  let ss = 0
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, smooth[i] - trend[i])
    out[i] = v
    ss += v * v
  }
  const sd = Math.sqrt(ss / Math.max(1, n)) || 1
  for (let i = 0; i < n; i++) out[i] /= sd
  return out
}

/**
 * Spectral-flux onset envelopes.
 * @param {Float32Array} samples mono PCM at BT_SR
 */
export function computeOnsetEnvelopes(samples) {
  const frames = Math.max(0, Math.floor((samples.length - FFT_N) / HOP) + 1)
  const nb = FFT_N / 2
  const fft = makeFft(FFT_N)
  const win = makeHann(FFT_N)
  const re = new Float64Array(FFT_N)
  const im = new Float64Array(FFT_N)
  let prevMag = new Float32Array(nb)
  let curMag = new Float32Array(nb)
  const flux = new Float32Array(frames)
  const lowFlux = new Float32Array(frames)
  const rms = new Float32Array(frames)
  // 12-bin chroma per frame (for chord-change based downbeat detection)
  const chroma = new Float32Array(frames * 12)
  const chromaBinLo = Math.max(1, Math.round((65 * FFT_N) / BT_SR))
  const chromaBinHi = Math.min(nb - 1, Math.round((2100 * FFT_N) / BT_SR))
  const binPitchClass = new Int8Array(nb).fill(-1)
  for (let k = chromaBinLo; k <= chromaBinHi; k++) {
    const freq = (k * BT_SR) / FFT_N
    const midi = 69 + 12 * Math.log2(freq / 440)
    binPitchClass[k] = ((Math.round(midi) % 12) + 12) % 12
  }
  const lowBinMax = Math.max(2, Math.round((180 * FFT_N) / BT_SR))
  const hiBinMax = Math.min(nb - 1, Math.round((11000 * FFT_N) / BT_SR))
  for (let f = 0; f < frames; f++) {
    const off = f * HOP
    let e = 0
    for (let i = 0; i < FFT_N; i++) {
      const s = samples[off + i] || 0
      e += s * s
      re[i] = s * win[i]
      im[i] = 0
    }
    rms[f] = Math.sqrt(e / FFT_N)
    fft(re, im)
    let sum = 0
    let low = 0
    const cBase = f * 12
    for (let k = 1; k <= hiBinMax; k++) {
      const linMag = Math.sqrt(re[k] * re[k] + im[k] * im[k])
      const mag = Math.log1p(320 * linMag)
      curMag[k] = mag
      const pc = binPitchClass[k]
      if (pc >= 0) chroma[cBase + pc] += linMag
      const d = mag - prevMag[k]
      if (d > 0) {
        sum += d
        if (k <= lowBinMax) low += d
      }
    }
    flux[f] = sum
    lowFlux[f] = low
    const swap = prevMag
    prevMag = curMag
    curMag = swap
  }
  const detrendRadius = Math.round(0.32 / HOP_SEC)
  return {
    env: normalizeEnvelope(flux, detrendRadius),
    lowEnv: normalizeEnvelope(lowFlux, detrendRadius),
    rms,
    chroma,
    hopSec: HOP_SEC,
    frameOffsetSec: FRAME_CENTER_OFFSET_SEC,
    frames,
  }
}

/** Beat-synchronous chroma novelty: 1 - cos(chroma_i, chroma_{i-1}) (chord-change strength per beat). */
function beatChromaNovelty(chroma, frames, beatTimes) {
  const vecs = []
  for (let i = 0; i < beatTimes.length; i++) {
    const f0 = Math.max(0, Math.round(secToFrame(beatTimes[i])))
    const f1 = Math.min(frames, Math.round(secToFrame(i + 1 < beatTimes.length ? beatTimes[i + 1] : beatTimes[i] + 0.5)))
    const v = new Float64Array(12)
    for (let f = f0; f < Math.max(f0 + 1, f1); f++) {
      if (f >= frames) break
      for (let c = 0; c < 12; c++) v[c] += chroma[f * 12 + c]
    }
    let norm = 0
    for (let c = 0; c < 12; c++) norm += v[c] * v[c]
    norm = Math.sqrt(norm) || 1
    for (let c = 0; c < 12; c++) v[c] /= norm
    vecs.push(v)
  }
  return vecs.map((v, i) => {
    if (i === 0) return 0
    const p = vecs[i - 1]
    let dot = 0
    for (let c = 0; c < 12; c++) dot += v[c] * p[c]
    return Math.max(0, 1 - dot)
  })
}

export function frameToSec(frame) {
  return frame * HOP_SEC + FRAME_CENTER_OFFSET_SEC
}

export function secToFrame(sec) {
  return (sec - FRAME_CENTER_OFFSET_SEC) / HOP_SEC
}

function sampleEnv(env, pos) {
  if (pos < 0 || pos >= env.length - 1) return 0
  const i = Math.floor(pos)
  const fr = pos - i
  return env[i] * (1 - fr) + env[i + 1] * fr
}

/**
 * Tempo estimation via comb autocorrelation + perceptual prior.
 */
export function estimateTempo(env, { minBpm = 60, maxBpm = 180, priorCenterBpm = 112, priorOctaveSigma = 0.9 } = {}) {
  const n = env.length
  const maxLag = Math.min(n - 2, Math.ceil((60 / minBpm / HOP_SEC) * 4) + 4)
  const ac = new Float64Array(maxLag + 2)
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0
    const lim = n - lag
    for (let i = 0; i < lim; i++) s += env[i] * env[i + lag]
    ac[lag] = s / Math.max(1, lim)
  }
  const acAt = (lag) => {
    if (lag < 1 || lag >= maxLag) return 0
    const i = Math.floor(lag)
    const fr = lag - i
    return ac[i] * (1 - fr) + ac[i + 1] * fr
  }
  const candidates = []
  let best = -Infinity
  let bestBpm = 100
  for (let bpm = minBpm; bpm <= maxBpm + 1e-9; bpm += 0.05) {
    const lag = 60 / bpm / HOP_SEC
    const raw = acAt(lag) + acAt(lag * 2) * 0.5 + acAt(lag * 4) * 0.25
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / priorCenterBpm) / priorOctaveSigma, 2))
    const score = raw * prior
    candidates.push({ bpm, raw, score })
    if (score > best) {
      best = score
      bestBpm = bpm
    }
  }
  return { bpm: bestBpm, score: best, candidates }
}

/**
 * Ellis (2007) dynamic-programming beat tracker.
 */
export function trackBeatsDp(env, periodFrames, tightness = 100) {
  const n = env.length
  const score = new Float64Array(n)
  const back = new Int32Array(n).fill(-1)
  for (let t = 0; t < n; t++) {
    const lo = Math.max(0, Math.round(t - 2 * periodFrames))
    const hi = Math.round(t - periodFrames / 2)
    let bestPrev = -Infinity
    let bp = -1
    for (let p = lo; p <= hi; p++) {
      const sc = score[p] - tightness * Math.pow(Math.log((t - p) / periodFrames), 2)
      if (sc > bestPrev) {
        bestPrev = sc
        bp = p
      }
    }
    score[t] = env[t] + (bp >= 0 ? Math.max(0, bestPrev) : 0)
    back[t] = bp >= 0 && bestPrev > 0 ? bp : -1
  }
  let end = n - 1
  let mx = -Infinity
  for (let t = Math.max(0, Math.round(n - periodFrames)); t < n; t++) {
    if (score[t] > mx) {
      mx = score[t]
      end = t
    }
  }
  const frames = []
  for (let t = end; t >= 0; t = back[t]) {
    frames.push(t)
    if (back[t] < 0) break
  }
  return frames.reverse()
}

/** Max-filter (dilation) so slightly jittered transients still count when sampling a rigid grid. */
export function dilate(env, radius) {
  const n = env.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let m = 0
    const a = Math.max(0, i - radius)
    const b = Math.min(n - 1, i + radius)
    for (let j = a; j <= b; j++) if (env[j] > m) m = env[j]
    out[i] = m
  }
  return out
}

/**
 * Global constant-tempo grid fit: maximise mean score(t0 + k·P) over period P (±spanPct) and phase t0.
 * `scoreEnv` should already be dilated (±15–20 ms) so human/DAW micro-jitter does not bias the phase.
 */
export function fitConstantGrid(scoreEnv, periodFrames, { spanPct = 0.012, pSteps = 48, phaseStep = 0.5 } = {}) {
  const n = scoreEnv.length
  let best = { score: -Infinity, period: periodFrames, phase: 0 }
  for (let pi = -pSteps; pi <= pSteps; pi++) {
    const P = periodFrames * (1 + (spanPct * pi) / pSteps)
    const count = Math.floor(n / P)
    if (count < 2) continue
    for (let ph = 0; ph < P; ph += phaseStep) {
      let s = 0
      let c = 0
      for (let k = 0; k < count; k++) {
        const pos = ph + k * P
        if (pos >= n - 1) break
        s += sampleEnv(scoreEnv, pos)
        c++
      }
      const norm = s / Math.max(1, c)
      if (norm > best.score) best = { score: norm, period: P, phase: ph }
    }
  }
  return best
}

/**
 * Alternation ratio of a beat grid: mean strength of the weaker of {even, odd} beats over the stronger.
 * ~1 => every grid beat is a real beat (tempo is right); low => every other beat is only an off-beat
 * (the grid runs at double the musical tempo).
 */
export function alternationRatio(scoreEnv, periodFrames) {
  const g = fitConstantGrid(scoreEnv, periodFrames, { spanPct: 0.004, pSteps: 8, phaseStep: 0.5 })
  let even = 0
  let odd = 0
  let ne = 0
  let no = 0
  for (let k = 0; ; k++) {
    const pos = g.phase + k * g.period
    if (pos >= scoreEnv.length - 1) break
    const v = sampleEnv(scoreEnv, pos)
    if (k % 2 === 0) {
      even += v
      ne++
    } else {
      odd += v
      no++
    }
  }
  const a = even / Math.max(1, ne)
  const b = odd / Math.max(1, no)
  return Math.min(a, b) / Math.max(1e-9, Math.max(a, b))
}

/**
 * Octave-error correction between T/2, T and 2T using musical rules:
 * - never report a "beat" faster than 165 BPM or slower than 66 BPM when its octave fits the range
 * - double the tempo only when alternate beats are about as strong as the main beats
 * - halve it when every other detected beat is clearly just an off-beat (hi-hat / upbeat)
 */
function correctTempoOctave(scoreEnv, lowScoreEnv, fullScoreEnv, bpm) {
  const T = bpm
  const F = T * 2
  if (F <= 165 && (T < 66 || (alternationRatio(scoreEnv, 60 / F / HOP_SEC) >= 0.72 && alternationRatio(lowScoreEnv, 60 / F / HOP_SEC) >= 0.6))) return F
  const S = T / 2
  if (S >= 66 && T > 165) return S
  // Kick/bass only on every other grid beat while the full band also alternates => the grid is counting
  // off-beat hats as beats; the real pulse is the slower one (prevents cuts/downbeats landing on hats).
  if (S >= 60 && T > 110 && alternationRatio(lowScoreEnv, 60 / T / HOP_SEC) < 0.5 && alternationRatio(lowScoreEnv, 60 / S / HOP_SEC) > 0.75) return S
  return T
}

/**
 * Precise period & phase: robust straight-line fit (Theil–Sen slope, then trimmed least squares) through
 * the full-band transient peaks that sit near each grid beat. The dilated grid search pins the tempo only
 * to ~±0.05 %; over a 2–3 minute song that leaves 40–60 ms of drift at the ends, which is clearly audible
 * when a steel clash is layered on a drum hit. Anchoring to full-band peaks (not the kick band, whose flux
 * peaks later) also puts the grid on the attack the ear actually hears.
 */
function refineGridToOnsets(env, period, phase, frames) {
  const win = 0.06 / HOP_SEC
  const pts = []
  for (let k = 0; ; k++) {
    const pos = phase + k * period
    if (pos >= frames - 2) break
    const pk = localPeak(env, pos, win)
    if (pk && pk.value >= 1.2) pts.push({ k, pos: pk.pos })
  }
  if (pts.length < 12) return { period, phase, fitted: false, points: pts.length }
  const slopes = []
  const minGap = Math.max(8, Math.floor((pts[pts.length - 1].k - pts[0].k) / 6))
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dk = pts[j].k - pts[i].k
      if (dk >= minGap) slopes.push((pts[j].pos - pts[i].pos) / dk)
    }
  }
  if (slopes.length < 10) return { period, phase, fitted: false, points: pts.length }
  slopes.sort((a, b) => a - b)
  let P = slopes[Math.floor(slopes.length / 2)]
  if (!(Math.abs(P / period - 1) < 0.01)) return { period, phase, fitted: false, points: pts.length }
  const icpts = pts.map((p) => p.pos - P * p.k).sort((a, b) => a - b)
  let b0 = icpts[Math.floor(icpts.length / 2)]
  let inliers = pts.length
  for (const tolSec of [0.024, 0.015]) {
    const tol = tolSec / HOP_SEC
    const inl = pts.filter((p) => Math.abs(p.pos - (b0 + P * p.k)) <= tol)
    if (inl.length < 10) break
    let sk = 0
    let sp = 0
    let skk = 0
    let skp = 0
    for (const p of inl) {
      sk += p.k
      sp += p.pos
      skk += p.k * p.k
      skp += p.k * p.pos
    }
    const den = inl.length * skk - sk * sk
    if (Math.abs(den) < 1e-9) break
    const P2 = (inl.length * skp - sk * sp) / den
    if (!(Math.abs(P2 / period - 1) < 0.01)) break
    P = P2
    b0 = (sp - P * sk) / inl.length
    inliers = inl.length
  }
  const ph = ((b0 % P) + P) % P
  return { period: P, phase: ph, fitted: true, points: pts.length, inliers }
}

function gridMeanScore(scoreEnv, period, phase) {
  let s = 0
  let c = 0
  for (let pos = ((phase % period) + period) % period; pos < scoreEnv.length - 1; pos += period) {
    s += sampleEnv(scoreEnv, pos)
    c++
  }
  return c ? s / c : 0
}

function localPeak(env, centerPos, radiusFrames) {
  const lo = Math.max(1, Math.floor(centerPos - radiusFrames))
  const hi = Math.min(env.length - 2, Math.ceil(centerPos + radiusFrames))
  let bestI = -1
  let bestV = -Infinity
  for (let i = lo; i <= hi; i++) {
    if (env[i] >= env[i - 1] && env[i] >= env[i + 1] && env[i] > bestV) {
      bestV = env[i]
      bestI = i
    }
  }
  if (bestI < 0) return null
  const a = env[bestI - 1]
  const b = env[bestI]
  const c = env[bestI + 1]
  const denom = a - 2 * b + c
  const delta = Math.abs(denom) > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0
  return { pos: bestI + delta, value: b }
}

/**
 * Strong musical onsets (accents): local maxima above an adaptive threshold, density-capped.
 */
export function pickOnsets(env, { minGapSec = 0.09, thresholdSigma = 1.1, maxPerSec = 7 } = {}) {
  const n = env.length
  const minGap = Math.max(2, Math.round(minGapSec / HOP_SEC))
  const localMean = movingAverage(env, Math.round(0.6 / HOP_SEC))
  const out = []
  let last = -Infinity
  for (let i = 2; i < n - 2; i++) {
    const v = env[i]
    if (v < thresholdSigma || v < localMean[i] * 1.6) continue
    if (!(v >= env[i - 1] && v >= env[i + 1] && v >= env[i - 2] && v >= env[i + 2])) continue
    if (i - last < minGap) {
      if (out.length && v > out[out.length - 1].v) {
        out[out.length - 1] = { i, v }
        last = i
      }
      continue
    }
    out.push({ i, v })
    last = i
  }
  const perSec = new Map()
  for (const o of out) {
    const sec = Math.floor(frameToSec(o.i))
    if (!perSec.has(sec)) perSec.set(sec, [])
    perSec.get(sec).push(o)
  }
  const kept = []
  for (const list of perSec.values()) {
    list.sort((a, b) => b.v - a.v)
    kept.push(...list.slice(0, maxPerSec))
  }
  kept.sort((a, b) => a.i - b.i)
  const maxV = kept.reduce((m, o) => Math.max(m, o.v), 1e-6)
  return kept.map((o) => ({
    time: Number(frameToSec(o.i).toFixed(4)),
    strength: Number(Math.min(1, o.v / maxV).toFixed(3)),
  }))
}

/**
 * Full precision analysis of mono PCM samples (@ BT_SR).
 * Returns null when the audio is too short to analyse.
 */
export function analyzeBeatsFromSamples(samples, { minBpm = 60, maxBpm = 180, priorCenterBpm = 112 } = {}) {
  const durationSec = samples.length / BT_SR
  const { env, lowEnv, rms, chroma, frames } = computeOnsetEnvelopes(samples)
  if (frames < Math.round(2.5 / HOP_SEC)) return null

  const beatEnv = new Float32Array(env.length)
  for (let i = 0; i < env.length; i++) beatEnv[i] = env[i] + 1.25 * lowEnv[i]
  const tempo = estimateTempo(beatEnv, { minBpm, maxBpm, priorCenterBpm })
  // Dilate by ±18 ms so a rigid grid still "hits" slightly humanised / swung transients
  const dilR = Math.max(1, Math.round(0.018 / HOP_SEC))
  const dilEnv = dilate(env, dilR)
  const dilLow = dilate(lowEnv, dilR)
  const dilBeat = dilate(beatEnv, dilR)
  const correctedBpm = correctTempoOctave(dilBeat, dilLow, dilEnv, tempo.bpm)
  const period0 = 60 / correctedBpm / HOP_SEC
  const grid = fitConstantGrid(dilBeat, period0)
  // Half-period ambiguity (on-beat vs off-beat "and"): keep the phase whose transients are stronger
  // overall, with extra weight on the kick band so hi-hat off-beats never steal the grid.
  {
    const altPhase = (grid.phase + grid.period / 2) % grid.period
    const sCur = gridMeanScore(dilEnv, grid.period, grid.phase) + 1.6 * gridMeanScore(dilLow, grid.period, grid.phase)
    const sAlt = gridMeanScore(dilEnv, grid.period, altPhase) + 1.6 * gridMeanScore(dilLow, grid.period, altPhase)
    if (sAlt > sCur * 1.03) grid.phase = altPhase
  }
  const refined = refineGridToOnsets(env, grid.period, grid.phase, frames)
  if (refined.fitted) {
    grid.period = refined.period
    grid.phase = refined.phase
  }
  const dpFrames = trackBeatsDp(beatEnv, grid.period, 120)

  const snapRadius = 0.028 / HOP_SEC
  const gridCount = Math.floor((frames - grid.phase) / grid.period) + 1
  let supported = 0
  const offsets = []
  for (let k = 0; k < gridCount; k++) {
    const pos = grid.phase + k * grid.period
    if (pos >= frames - 1) break
    const pk = localPeak(env, pos, snapRadius)
    if (pk && pk.value >= 0.9) {
      supported++
      offsets.push(pk.pos - pos)
    }
  }
  const support = gridCount > 0 ? supported / gridCount : 0
  offsets.sort((a, b) => a - b)
  const medOffsetFrames = offsets.length ? offsets[Math.floor(offsets.length / 2)] : 0

  let dpAgree = 0
  for (const f of dpFrames) {
    const k = Math.round((f - grid.phase) / grid.period)
    const g = grid.phase + k * grid.period
    if (Math.abs(f - g) <= snapRadius * 1.4) dpAgree++
  }
  const dpAgreeRatio = dpFrames.length ? dpAgree / dpFrames.length : 0
  const tempoStable = support >= 0.32 || dpAgreeRatio >= 0.6

  let beatPositions = []
  if (tempoStable) {
    // Rigid grid + slowly varying drift correction: each beat measures its offset to a strong nearby
    // full-band transient (±28 ms); offsets are median-filtered over ±4 beats so a single hi-hat or fill can
    // never pull a cut off the groove, while genuine tempo drift in live recordings is still followed.
    // (The kick-weighted envelope is NOT used here: its flux peaks 20–40 ms after the audible attack.)
    const phase = refined.fitted ? grid.phase : grid.phase + Math.max(-snapRadius, Math.min(snapRadius, medOffsetFrames))
    const gridPos = []
    for (let k = 0; ; k++) {
      const pos = phase + k * grid.period
      if (pos > frames + grid.period * 0.25) break
      gridPos.push(pos)
    }
    const rawOff = gridPos.map((pos) => {
      const pk = localPeak(env, pos, snapRadius)
      return pk && pk.value >= 1.2 ? pk.pos - pos : NaN
    })
    for (let k = 0; k < gridPos.length; k++) {
      const win = []
      for (let j = Math.max(0, k - 4); j <= Math.min(gridPos.length - 1, k + 4); j++) {
        if (Number.isFinite(rawOff[j])) win.push(rawOff[j])
      }
      win.sort((a, b) => a - b)
      const drift = win.length >= 3 ? win[Math.floor(win.length / 2)] : 0
      beatPositions.push(gridPos[k] + drift)
    }
  } else {
    beatPositions = dpFrames.map((f) => {
      const pk = localPeak(env, f, snapRadius * 0.85)
      return pk && pk.value >= 1.2 ? pk.pos : f
    })
  }
  const periodSec = grid.period * HOP_SEC
  let beatTimes = beatPositions.map((p) => frameToSec(p)).filter((t) => t >= -0.02 && t <= durationSec + 0.05)
  while (beatTimes.length && beatTimes[0] - periodSec >= -0.02) {
    beatTimes.unshift(beatTimes[0] - periodSec)
  }
  beatTimes = beatTimes.map((t) => Math.max(0, t))

  const beatAccent = beatTimes.map((t) => {
    const pos = secToFrame(t)
    const r = Math.round(0.03 / HOP_SEC)
    let e = 0
    let low = 0
    for (let d = -r; d <= r; d++) {
      e = Math.max(e, sampleEnv(env, pos + d))
      low = Math.max(low, sampleEnv(lowEnv, pos + d))
    }
    return { e, low }
  })
  let rmsSum = 0
  for (let i = 0; i < rms.length; i++) rmsSum += rms[i]
  const rmsMean = rmsSum / Math.max(1, rms.length)
  const beatEnergy = beatTimes.map((t) => {
    const fi = Math.max(0, Math.min(rms.length - 1, Math.round(secToFrame(t))))
    const r = Math.round(0.08 / HOP_SEC)
    let s = 0
    let c = 0
    for (let d = 0; d <= r; d++) {
      if (fi + d < rms.length) {
        s += rms[fi + d]
        c++
      }
    }
    return c ? s / c / Math.max(1e-6, rmsMean) : 0
  })

  // Energy drops (sustained loudness jumps) evaluated on EVERY beat: a drop almost always lands on a
  // downbeat, so drops are both a cut/impact anchor and the strongest bar-phase cue.
  let rmsSumD = 0
  for (let i = 0; i < rms.length; i++) rmsSumD += rms[i]
  const rmsMeanD = rmsSumD / Math.max(1, rms.length)
  const meanRmsAtD = (fa, fb) => {
    let s2 = 0
    let c2 = 0
    for (let f = Math.max(0, fa); f < Math.min(rms.length, fb); f++) {
      s2 += rms[f]
      c2++
    }
    return c2 ? s2 / c2 : 0
  }
  const dropWin = Math.round(1.6 / HOP_SEC)
  const jumpAt = beatTimes.map((t) => {
    const f = Math.round(secToFrame(t))
    if (f < dropWin || f + dropWin >= rms.length) return 0
    const before = meanRmsAtD(f - dropWin, f)
    const after = meanRmsAtD(f, f + dropWin)
    return after >= rmsMeanD * 0.9 ? after / Math.max(1e-5, before) : 0
  })
  const dropCands = []
  for (let i = 0; i < beatTimes.length; i++) {
    const j = jumpAt[i]
    if (j < 1.28) continue
    // keep only the beat where the jump peaks (a drop spans several neighbouring beats)
    if ((jumpAt[i - 1] || 0) > j || (jumpAt[i + 1] || 0) > j) continue
    dropCands.push({ bi: i, jump: j })
  }
  dropCands.sort((a, b) => b.jump - a.jump)
  const dropIdx = []
  for (const c of dropCands) {
    if (dropIdx.every((d) => Math.abs(beatTimes[d] - beatTimes[c.bi]) >= 7.5)) dropIdx.push(c.bi)
    if (dropIdx.length >= 8) break
  }
  dropIdx.sort((a, b) => a - b)
  const dropSet = new Set(dropIdx)
  const modDrop = [0, 0, 0, 0]
  for (const bi of dropIdx) modDrop[bi % 4] += Math.log(Math.max(1.01, jumpAt[bi]))

  // Bar phase (which beat is "1"): drops > chord changes (beat-synchronous chroma novelty) > kick accents.
  const novelty = beatChromaNovelty(chroma, frames, beatTimes)
  const modNovelty = [0, 0, 0, 0]
  const modKick = [0, 0, 0, 0]
  const modCount = [0, 0, 0, 0]
  for (let i = 0; i < beatTimes.length; i++) {
    modNovelty[i % 4] += novelty[i]
    modKick[i % 4] += beatAccent[i].low * 0.7 + beatAccent[i].e * 0.3
    modCount[i % 4]++
  }
  const normMod = (arr) => {
    const avg = arr.map((v, m) => v / Math.max(1, modCount[m]))
    const mx = Math.max(...avg, 1e-9)
    return avg.map((v) => v / mx)
  }
  const nN = normMod(modNovelty)
  const nK = normMod(modKick)
  const contrast = (arr) => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length
    return Math.max(0, (Math.max(...arr) - mean) / Math.max(1e-9, Math.max(...arr)))
  }
  const cN = contrast(nN)
  const cK = contrast(nK)
  const wN = cN + cK > 1e-6 ? (cN * 1.4) / (cN * 1.4 + cK) : 0.5
  const dropTotal = modDrop.reduce((a, b) => a + b, 0)
  const nD = modDrop.map((v) => (dropTotal > 0 ? v / Math.max(...modDrop) : 0))
  const wD = dropIdx.length >= 2 ? 0.6 : dropIdx.length === 1 ? 0.3 : 0
  const modScores = nN.map((v, m) => (v * wN + nK[m] * (1 - wN)) * (1 - wD) + nD[m] * wD)
  let barOffset = 0
  for (let m = 1; m < 4; m++) if (modScores[m] > modScores[barOffset]) barOffset = m
  const sortedMod = modScores.slice().sort((a, b) => b - a)
  const barConfidence = Number(((sortedMod[0] - sortedMod[1]) / Math.max(1e-9, sortedMod[0])).toFixed(3))

  const energyCurve = []
  const binFrames = Math.round(2 / HOP_SEC)
  for (let f0 = 0; f0 + binFrames / 2 < rms.length; f0 += binFrames) {
    let s = 0
    let c = 0
    for (let f = f0; f < Math.min(rms.length, f0 + binFrames); f++) {
      s += rms[f]
      c++
    }
    energyCurve.push({ sec: Number((f0 * HOP_SEC).toFixed(2)), rms: Number((s / Math.max(1, c)).toFixed(4)) })
  }

  const beats = beatTimes.map((t, i) => {
    const beatInBar = (i - barOffset + 4000) % 4
    return {
      time: Number(t.toFixed(4)),
      strong: beatInBar === 0 || dropSet.has(i),
      isDrop: dropSet.has(i),
      index: i,
      barIndex: Math.max(0, Math.floor((i - barOffset + 4) / 4)),
      beatInBar,
      energy: Number(beatEnergy[i].toFixed(3)),
      accent: Number(Math.min(9.99, beatAccent[i].e).toFixed(3)),
    }
  })

  return {
    durationSec: Number(durationSec.toFixed(4)),
    bpm: Number((60 / periodSec).toFixed(2)),
    beatSec: Number(periodSec.toFixed(5)),
    phaseSec: beats.length ? beats[0].time : 0,
    barOffset,
    barConfidence,
    beats,
    downbeats: beats.filter((b) => b.strong).map((b) => b.time),
    drops: dropIdx.map((i) => Number(beatTimes[i].toFixed(4))),
    energyCurve,
    onsets: pickOnsets(env),
    tempoStable,
    gridSupport: Number(support.toFixed(3)),
    dpAgreement: Number(dpAgreeRatio.toFixed(3)),
    tempoCandidates: tempo.candidates
      .slice()
      .sort((a, b) => b.score - a.score)
      .filter((c, i, arr) => arr.findIndex((x) => Math.abs(x.bpm - c.bpm) < 2) === i)
      .slice(0, 4)
      .map((c) => Number(c.bpm.toFixed(2))),
  }
}
