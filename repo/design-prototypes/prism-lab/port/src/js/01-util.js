/* ================= 1 · UTIL ================= */
const CTX = {alpha:true}; // GPU-friendly 2D canvases (the real MP4 is drawn into the finder every frame)
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t, inv = (a, b, v) => clamp((v - a) / ((b - a) || 1e-9), 0, 1);
const R0 = v => (v > 0 && isFinite(v) ? v : 0); // never hand a negative/NaN radius to arc()/ellipse()
const E = {io: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, o: t => 1 - Math.pow(1 - t, 3), oq: t => 1 - Math.pow(1 - t, 4), i: t => t * t,
  back: t => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }};
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const hashStr = s => { let h = 2166136261; s = String(s || ''); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const h2r = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const rgba = (c, a = 1) => { const v = typeof c === 'string' ? h2r(c) : c; return `rgba(${v[0] | 0},${v[1] | 0},${v[2] | 0},${a})`; };
const SPECTRUM = ['#6B2BFF', '#2F37FF', '#0094FF', '#00B89C', '#4CBB17', '#F2A900', '#FF7A1A', '#F0284A'].map(h2r);
function specAt(u) { u = clamp(u, 0, 1) * (SPECTRUM.length - 1); const i = Math.min(SPECTRUM.length - 2, Math.floor(u)), f = u - i, a = SPECTRUM[i], b = SPECTRUM[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
const timeHue = t => specAt(t / (PROJ.dur || 1));
const p2 = n => String(Math.floor(Math.max(0, n))).padStart(2, '0');
const mmss = s => (s < 0 || !isFinite(s)) ? '--:--' : (s >= 3600 ? Math.floor(s / 3600) + ':' : '') + p2((s % 3600) / 60) + ':' + p2(s % 60);
const tcode = s => { s = Math.max(0, s || 0); const fps = PROJ.fps || 30, f = Math.floor((s % 1) * fps); return p2(s / 3600) + ':' + p2((s % 3600) / 60) + ':' + p2(s % 60) + ':' + p2(f); };
const secs = s => { s = Math.max(0, s || 0); return p2(s / 60) + ':' + (s % 60).toFixed(2).padStart(5, '0'); };
const sceneAt = t => { for (let i = SCENES.length - 1; i >= 0; i--) if (t >= SCENES[i].start) return SCENES[i]; return SCENES[0] || NOSCENE; };
function hiDPI(cv, w, h) { const d = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.max(1, Math.round(Math.max(1, w) * d)); cv.height = Math.max(1, Math.round(Math.max(1, h) * d));
  const c = cv.getContext('2d', CTX); c.setTransform(d, 0, 0, d, 0, 0); return {c, d}; }
function rrect(c, x, y, w, h, r) { r = Math.min(R0(r), Math.abs(w) / 2, Math.abs(h) / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
const qs = (el, s) => el.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[ch]));
const html = (tag, cls, inner) => { const e = document.createElement(tag); if (cls) e.className = cls; if (inner != null) e.innerHTML = inner; return e; };
const icon = id => `<svg class="i" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const fmtClock = ts => { if (!ts) return '--:--:--'; const d = new Date(ts); if (!isNaN(d)) return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  const m = /(\d{1,2}:\d{2}(?::\d{2})?)/.exec(String(ts)); return m ? m[1] : String(ts).slice(0, 8); };
function fitText(c, s, maxW) { s = String(s || ''); if (maxW <= 4) return ''; if (c.measureText(s).width <= maxW) return s; let lo = 0, hi = s.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (c.measureText(s.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1; } return lo ? s.slice(0, lo) + '…' : ''; }
const LS = {get(k, d) { try { const v = localStorage.getItem('dshvw.' + SKIN_ID + '.' + k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('dshvw.' + SKIN_ID + '.' + k, String(v)); } catch (e) {} }};

/* ---- media cache for canvas drawing (same-origin URLs from the host state) ---- */
const IMGS = new Map();
function img(url) { if (!url) return null; let e = IMGS.get(url);
  if (!e) { if (IMGS.size > 360) IMGS.delete(IMGS.keys().next().value); const im = new Image(); im.decoding = 'async'; e = {im, ok:false, bad:false};
    im.onload = () => { e.ok = im.naturalWidth > 0; redrawSoon(); }; im.onerror = () => { e.bad = true; }; im.src = url; IMGS.set(url, e); }
  return e.ok ? e.im : null; }
function drawImg(c, im, x, y, w, h, contain) { const iw = im.naturalWidth || im.videoWidth || 1, ih = im.naturalHeight || im.videoHeight || 1, s = contain ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
  const dw = iw * s, dh = ih * s; c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); c.restore(); }
let redrawFlag = false; const redrawSoon = () => { redrawFlag = true; };

/* ---- waveforms: derived envelopes from the real beat grid / drops / subtitles (visual only) ---- */
let WF_N = 600, WF_DT = 0.1, BGM_WF = new Float32Array(WF_N), VO_WF = new Float32Array(WF_N), VO_ON = new Uint8Array(WF_N);
function rebuildWaves() {
  const dur = PROJ.dur || 60; WF_N = clamp(Math.round(dur * 10), 200, 7200); WF_DT = dur / WF_N;
  BGM_WF = new Float32Array(WF_N); VO_WF = new Float32Array(WF_N); VO_ON = new Uint8Array(WF_N);
  const R = rng(hashStr(PROJ.title) + Math.round(dur * 100)), drops = PROJ.drops, d0 = drops.length ? drops[0] : dur * .12;
  const energy = t => { let e = t < d0 ? .3 + .25 * inv(0, d0, t) : .62 + .12 * Math.sin(t * .21);
    for (const d of drops) { if (t >= d && t < d + 6) e = Math.max(e, .95 - (t - d) * .03); } if (t > dur - 4) e *= .35 + .65 * inv(dur, dur - 4, t); return e; };
  let bi = 0; const hasBeats = BEATS.length > 1;
  for (let i = 0; i < WF_N; i++) { const t = i * WF_DT; let kick = .35 + .3 * Math.sin(t * 7.3) * Math.sin(t * 2.1);
    if (hasBeats) { while (bi < BEATS.length - 1 && BEATS[bi + 1].t <= t) bi++; const db = t - BEATS[bi].t; kick = db >= 0 ? Math.exp(-db * 9) * (BEATS[bi].s ? 1 : .65) : 0; }
    BGM_WF[i] = clamp(energy(t) * (.42 + .38 * kick + .2 * R()) + (drops.some(d => Math.abs(t - d) < .12) ? .3 : 0), .03, 1); }
  const R2 = rng(7);
  SCENES.forEach(s => { if (s.dur < .4 || !s.sub) return; const a = s.start + Math.min(.12, s.dur * .1), b = s.end - Math.min(.35, s.dur * .18), syl = Math.max(2, [...s.sub].length);
    for (let i = Math.max(0, Math.floor(a / WF_DT)); i < Math.min(WF_N, b / WF_DT); i++) { const u = (i * WF_DT - a) / ((b - a) || 1), ph = u * syl * Math.PI;
      VO_WF[i] = clamp((.25 + .55 * Math.abs(Math.sin(ph)) * (.7 + .3 * R2())) * Math.pow(Math.sin(Math.PI * clamp(u, 0, 1)), .35), 0, 1); VO_ON[i] = s.voice ? 1 : 0; } });
}
