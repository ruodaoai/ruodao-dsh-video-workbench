/* ================= 5 · FILM / ART (viewfinder content: scene thumbs → poster → abstract Swiss-poster animatic) ================= */
const KAI = '"STKaiti","KaiTi","SimSun",serif', SANS = '"Segoe UI","Microsoft YaHei UI",system-ui,sans-serif', MONO = '"LabMono","Cascadia Mono",Consolas,monospace';
const GRAIN = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 96; const c = cv.getContext('2d'), im = c.createImageData(96, 96), R = rng(3);
  for (let i = 0; i < im.data.length; i += 4) { const v = R() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } c.putImageData(im, 0, 0); return cv; })();
function ridge(c, x0, w, h, y0, amp, seed, col, sharp = .5) {
  const R = rng(seed), p1 = R() * 6, p2 = R() * 6, p3 = R() * 6, f1 = 1 + R() * 1.6, f2 = 2.6 + R() * 2.4, f3 = 7 + R() * 6, st = Math.max(3, w / 160);
  c.beginPath(); c.moveTo(x0, h);
  for (let x = 0; x <= w + st; x += st) { const u = x / w;
    const n = .55 * Math.sin(u * f1 * Math.PI + p1) + .3 * (1 - Math.abs(Math.sin(u * f2 * Math.PI + p2))) * (1 + sharp) + .15 * Math.sin(u * f3 * Math.PI + p3);
    c.lineTo(x0 + x, y0 - amp * n); }
  c.lineTo(x0 + w, h); c.closePath(); c.fillStyle = col; c.fill(); }
function vgrad(c, y0, y1, stops) { const g = c.createLinearGradient(0, y0, 0, y1); stops.forEach(s => g.addColorStop(s[0], s[1])); return g; }
function sun(c, x, y, r, col, halo = .18) { r = R0(r); if (!r) return; const g = c.createRadialGradient(x, y, r * .6, x, y, r * 2.6); g.addColorStop(0, rgba(col, halo)); g.addColorStop(1, rgba(col, 0));
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 2.6, 0, 7); c.fill(); c.fillStyle = rgba(col, 1); c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); }
function grainOver(c, x, y, w, h, a, seed) { if (w * h > 900000 || S.eco || S.lowSpec) return; c.save(); c.globalAlpha = a * .55; const ox = (seed * 37) % 96, oy = (seed * 61) % 96;
  for (let yy = y - oy; yy < y + h; yy += 96) for (let xx = x - ox; xx < x + w; xx += 96) c.drawImage(GRAIN, xx, yy); c.restore(); }
const mixC = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const PAPER = [244, 241, 234], INKC = [22, 17, 14];
const MODE_EN = {c:'SCENE', d:'DROP', f:'IMPACT'};
// abstract per-scene poster (Bauhaus disc + tinted ridges); deterministic per scene id
function drawPoster(c, x, y, w, h, s, t, u) {
  const hue = timeHue(s.start + s.dur / 2), seed = (hashStr(s.id) % 9973) + 5, R = rng(seed);
  c.save(); c.translate(x, y); const zk = 1 + .05 * u; c.translate(w / 2, h / 2); c.scale(zk, zk); c.translate(-w / 2, -h / 2);
  if (s.mode === 'd') {
    c.fillStyle = '#F7F3EA'; c.fillRect(-2, -2, w + 4, h + 4);
    for (let r = 0; r < 5; r++) { const rr = ((u * 1.6 + r * .22) % 1) * w * .7; c.strokeStyle = rgba('#111111', .9 * (1 - rr / (w * .7))); c.lineWidth = Math.max(1, h * .012 * (1 - r * .15)); c.beginPath(); c.arc(w / 2, h * .48, R0(rr), 0, 7); c.stroke(); }
    c.fillStyle = rgba(hue, 1); c.beginPath(); c.arc(w / 2, h * .48, h * .09, 0, 7); c.fill();
  } else if (s.mode === 'f') {
    c.fillStyle = vgrad(c, 0, h, [[0, '#1C1411'], [1, rgba(mixC(hue, INKC, .72), 1)]]); c.fillRect(-2, -2, w + 4, h + 4);
    sun(c, w * (.66 - u * .04), h * .4, h * .26, mixC(hue, [194, 52, 31], .5), .22);
    ridge(c, -4, w + 8, h + 4, h * .8, h * .06, seed, '#0B0807', .2);
    let flash = 0; s.sfx.forEach(f => { const d = t - f.t; if (d >= 0 && d < .35) flash = Math.max(flash, 1 - d / .35); });
    for (let k = 0; k < 2; k++) { const a = (k ? -1 : 1) * (.62 + .1 * Math.sin(u * 7 + k)), cx = w * (.5 + (k ? .06 : -.06)), cy = h * .48, L = w * .55;
      c.save(); c.translate(cx, cy); c.rotate(a); c.fillStyle = rgba('#FFF4E8', .55 + .45 * flash); c.fillRect(-L / 2, -h * .008, L, h * .016);
      c.fillStyle = rgba('#FF5A1F', .7 * flash); c.fillRect(-L / 2, h * .008, L, h * .006); c.restore(); }
    if (flash > 0) { c.strokeStyle = rgba('#FFE0C2', flash * .8); c.lineWidth = Math.max(1, h * .004);
      for (let r = 0; r < 14; r++) { const an = r / 14 * 6.283 + seed, r0 = h * .05, r1 = h * (.12 + .2 * flash); c.beginPath(); c.moveTo(w * .5 + Math.cos(an) * r0, h * .48 + Math.sin(an) * r0); c.lineTo(w * .5 + Math.cos(an) * r1, h * .48 + Math.sin(an) * r1); c.stroke(); } }
  } else {
    const sky0 = mixC(hue, PAPER, .86), sky1 = mixC(hue, PAPER, .58), hz = h * (.64 + R() * .08);
    c.fillStyle = vgrad(c, 0, hz, [[0, rgba(sky0, 1)], [1, rgba(sky1, 1)]]); c.fillRect(-2, -2, w + 4, h + 4);
    sun(c, w * (.22 + .56 * R()) - w * .04 * u, hz - h * (.16 + .14 * R()), h * (.09 + .05 * R()), mixC(hue, [232, 70, 42], .45), .16);
    ridge(c, -4, w + 8, h + 4, hz - h * .1, h * .16, seed, rgba(mixC(hue, PAPER, .45), 1), .9);
    ridge(c, -4, w + 8, h + 4, hz + h * .02, h * .09, seed + 2, rgba(mixC(hue, INKC, .45), 1), .4);
    c.fillStyle = vgrad(c, hz - h * .05, hz + h * .06, [[0, rgba(sky1, 0)], [1, rgba(sky1, .45)]]); c.fillRect(0, hz - h * .05, w, h * .11);
    ridge(c, -4, w + 8, h + 4, hz + h * .13, h * .05, seed + 3, rgba(mixC(hue, INKC, .82), 1), .1);
    c.fillStyle = rgba(mixC(hue, INKC, .8), .85); c.fillRect(w * (.06 + .5 * R()), hz + h * .2, w * .18, Math.max(1, h * .012));
  }
  c.restore(); }
// px = size of one screen pixel in local units (so labels never render below 12 screen px; skipped when they cannot fit)
function filmText(c, x, y, w, h, s, px, dark, top, pip) {
  const fg = dark ? '#F4F1EA' : '#16110E', m = 12 * px, y0 = y + Math.max(h * .05, (top || 0) + 4 * px); if (h < m * 4.5 + (top || 0) || w < m * 8) return;
  c.fillStyle = fg; c.globalAlpha = .9; c.font = `600 ${Math.max(m, h * .034)}px ${MONO}`; c.textBaseline = 'top';
  c.fillText(fitText(c, 'S' + String(s.no).padStart(2, '0') + ' · ' + MODE_EN[s.mode] + (s.locked ? ' · LOCKED' : ''), w * .9), x + w * .035, y0);
  c.globalAlpha = 1; const tf = Math.max(m * 1.2, h * .085); c.font = `800 ${tf}px ${SANS}`; c.fillText(fitText(c, s.title, w * .9), x + w * .035, y0 + Math.max(m, h * .034) * 1.5);
  if (!s.sub) return; const fs = Math.max(m, h * .068); c.font = `${fs}px ${KAI}`; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const sub = fitText(c, s.sub, w * (pip ? .5 : .86)), ty = y + h * (pip ? .62 : .93), tw = c.measureText(sub).width; // keep clear of the avatar PiP
  c.fillStyle = dark ? 'rgba(0,0,0,.35)' : 'rgba(255,250,240,.6)'; c.fillRect(x + w / 2 - tw / 2 - fs * .5, ty - fs * 1.05, tw + fs, fs * 1.42);
  c.fillStyle = fg; c.fillText(sub, x + w / 2, ty); c.textAlign = 'left'; }
function drawFilm(c, x, y, w, h, t, o = {}) {
  if (!(w > 2 && h > 2)) return NOSCENE;
  const s = sceneAt(clamp(t, 0, Math.max(0, PROJ.dur - .01))), px = o.px || 1;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  if (!SCENES.length) { drawTestCard(c, x, y, w, h, t, px); c.restore(); return s; }
  const u = clamp((t - s.start) / (s.dur || 1), 0, 1), th = s.thumb && img(s.thumb), top = o.top || 0;
  if (th) { c.fillStyle = '#0F0E0D'; c.fillRect(x, y, w, h); c.save(); const k = 1 + .04 * u; c.translate(x + w / 2, y + h / 2); c.scale(k, k); c.translate(-(x + w / 2), -(y + h / 2)); drawImg(c, th, x, y, w, h, false); c.restore();
    if (h > 60 * px + top && !o.noText) { c.font = `600 ${12 * px}px ${MONO}`; c.textBaseline = 'top'; const lb = 'S' + String(s.no).padStart(2, '0'), lw = c.measureText(lb).width, ly = y + top + 6 * px;
      c.fillStyle = 'rgba(17,17,17,.62)'; c.fillRect(x + 6 * px, ly, lw + 8 * px, 16 * px); c.fillStyle = '#fff'; c.fillText(lb, x + 10 * px, ly + 2 * px); } }
  else { drawPoster(c, x, y, w, h, s, t, u); if (!o.noText) filmText(c, x, y, w, h, s, px, s.mode === 'f', top, o.pip); }
  if (!th && o.grain !== false) grainOver(c, x, y, w, h, s.mode === 'f' ? .09 : .06, Math.floor(t * 24));
  const d = PROJ.drops.find(dd => t >= dd && t - dd < .18); if (d != null && !o.noFlash) { c.fillStyle = rgba('#FFFFFF', .85 * (1 - (t - d) / .18)); c.fillRect(x, y, w, h); }
  c.restore(); return s; }
// no scenes yet: a prism-lab test card (spectral bars + caption)
function drawTestCard(c, x, y, w, h, t, px) {
  c.fillStyle = '#F3F1EA'; c.fillRect(x, y, w, h); const n = 8, bw = w / n;
  for (let i = 0; i < n; i++) { c.fillStyle = rgba(SPECTRUM[i], .9); c.fillRect(x + i * bw, y, bw + 1, h * .62); }
  for (let i = 0; i < 16; i++) { c.fillStyle = i % 2 ? '#111111' : '#F3F1EA'; c.fillRect(x + i * w / 16, y + h * .62, w / 16 + 1, h * .06); }
  c.fillStyle = '#111111'; c.fillRect(x, y + h * .68, w, h * .32);
  const sw = (Math.sin(t * 1.4) * .5 + .5) * w; c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(x + sw - w * .04, y, w * .08, h * .62);
  const m = 12 * px; if (h < m * 5) return;
  c.fillStyle = '#F2F1EC'; c.textBaseline = 'middle'; c.textAlign = 'center';
  c.font = `800 ${Math.max(m * 1.3, h * .075)}px ${SANS}`; c.fillText(fitText(c, PROJ.has ? '等待分镜 · AWAITING STORYBOARD' : '无信号 · NO PROJECT', w * .9), x + w / 2, y + h * .8);
  c.font = `600 ${Math.max(m, h * .036)}px ${MONO}`; c.fillStyle = '#C8F53B'; c.fillText(fitText(c, PROJ.has ? '一键出片后，策划导演会在这里生成分镜' : '新建或打开一个工程', w * .9), x + w / 2, y + h * .91); c.textAlign = 'left'; }
// asset art when there is no thumbnail (kinds: image / video / music / music2 / voice / sfx / note)
function drawArt(c, w, h, art, t = 0) {
  c.save(); c.clearRect(0, 0, w, h);
  if (art === 'image') { const hue = [47, 55, 255]; c.fillStyle = vgrad(c, 0, h, [[0, '#EEF0F6'], [1, '#CDD3E6']]); c.fillRect(0, 0, w, h); sun(c, w * .7, h * .38, h * .12, mixC(hue, [255, 90, 31], .7), .2);
    ridge(c, 0, w, h, h * .66, h * .2, 11, '#9AA3C8', 1); ridge(c, 0, w, h, h * .8, h * .12, 12, '#4C5590', .6); ridge(c, 0, w, h, h * .94, h * .06, 14, '#1E2244', .2); }
  else if (art === 'video') { c.fillStyle = '#141210'; c.fillRect(0, 0, w, h); const fw = w * .3;
    for (let i = 0; i < 3; i++) { const col = SPECTRUM[(i * 3 + 1) % 8]; c.fillStyle = vgrad(c, h * .2, h * .8, [[0, rgba(mixC(col, PAPER, .55), 1)], [1, rgba(col, 1)]]); c.fillRect(w * .04 + i * (fw + w * .02), h * .2, fw, h * .6); }
    c.fillStyle = '#F2F1EC'; for (let i = 0; i < 9; i++) { c.fillRect(w * (.04 + i * .108), h * .06, w * .05, h * .07); c.fillRect(w * (.04 + i * .108), h * .87, w * .05, h * .07); }
    c.fillStyle = 'rgba(255,90,31,.95)'; c.beginPath(); c.moveTo(w * .45, h * .36); c.lineTo(w * .45, h * .64); c.lineTo(w * .58, h * .5); c.fill(); }
  else if (art === 'music' || art === 'music2' || art === 'voice' || art === 'sfx') { const col = {music:'#6B2BFF', music2:'#FF7A1A', voice:'#00B89C', sfx:'#F0284A'}[art], R = rng(art.length * 9);
    c.fillStyle = '#F6F5F0'; c.fillRect(0, 0, w, h); c.strokeStyle = 'rgba(17,17,17,.08)'; c.lineWidth = 1; for (let x = 0; x < w; x += 6) { c.beginPath(); c.moveTo(x + .5, 0); c.lineTo(x + .5, h); c.stroke(); }
    c.fillStyle = col; const n = Math.floor(w / 3);
    for (let i = 0; i < n; i++) { const v = art === 'voice' ? Math.abs(Math.sin(i * .35 + t * 4)) * (.3 + .7 * R()) * Math.pow(Math.sin(i / n * 3.14), .5) : art === 'sfx' ? (i % 9 === 0 ? .95 : .12 + .2 * R()) : (.25 + .75 * R()) * (i % 8 === 0 ? 1 : .7) * (.6 + .4 * Math.sin(i * .2 + t * 3)); const bh = v * h * .7; c.fillRect(i * 3, h / 2 - bh / 2, 2, bh); }
    c.fillStyle = '#111'; c.font = `700 ${Math.max(12, h * .22)}px ${MONO}`; c.textBaseline = 'top'; c.fillText({voice:'VO', music2:'AI', sfx:'FX'}[art] || '♪', w * .05, h * .05); }
  else { c.fillStyle = '#FBFAF6'; c.fillRect(0, 0, w, h); c.fillStyle = '#111'; c.fillRect(w * .08, h * .14, w * .4, h * .1);
    c.fillStyle = 'rgba(17,17,17,.28)'; for (let i = 0; i < 5; i++) c.fillRect(w * .08, h * (.34 + i * .12), w * (.5 + ((i * 37) % 30) / 100), h * .05);
    c.fillStyle = '#FF5A1F'; c.fillRect(w * .86, h * .14, w * .06, h * .1); }
  c.restore(); }
const artOf = A => A.kind === 'image' ? 'image' : A.kind === 'video' || A.kind === 'host_video' ? 'video' : A.kind === 'music' ? 'music' : A.kind === 'voice' ? 'voice' : A.kind === 'sfx' ? 'sfx' :
  A.kind === 'audio' ? 'music2' : 'note';
// asset picture: real thumbnail if it decoded, else kind art
function drawAsset(c, x, y, w, h, A, t) { const im = A.thumb && img(A.thumb); if (im) { c.fillStyle = '#111'; c.fillRect(x, y, w, h); drawImg(c, im, x, y, w, h, false); return; }
  c.save(); c.translate(x, y); drawArt(c, w, h, artOf(A), t); c.restore(); }
