/* ================= 6 · STAGE RENDERER (optical bench) ================= */
const PR = 44; // element radius (world units)
const RING = ['director', 'reference', 'cloud', 'avatar', 'qa', 'motion', 'audio', 'editor'];
const EDGES = RING.map((id, i) => ({a:id, b:RING[(i + 1) % 8]})).concat([{a:'src', b:'director'}, {a:'src', b:'editor'}, {a:'director', b:'vf'}, {a:'editor', b:'vf'}, {a:'qa', b:'vf'}, {a:'avatar', b:'vf'}]);
const edgeAct = {}; EDGES.forEach(e => edgeAct[e.a + '>' + e.b] = 0);
const ekey = (a, b) => edgeAct[a + '>' + b] != null ? a + '>' + b : b + '>' + a;
function nodePos(id) { if (id === 'src') return [SOURCE.x + 26, SOURCE.y]; if (id === 'vf') return [WORLD.cx, WORLD.cy]; const a = AG[id]; return [a.x, a.y]; }
function vfEdgePoint(x, y) { const r = vfRect(), cx = WORLD.cx, cy = WORLD.cy, dx = x - cx, dy = y - cy, sx = (r.w / 2) / Math.abs(dx || 1e-6), sy = (r.h / 2) / Math.abs(dy || 1e-6), s = Math.min(sx, sy); return [cx + dx * s, cy + dy * s]; }
function segEnds(a, b) { let [x1, y1] = nodePos(a), [x2, y2] = nodePos(b); const L = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / L, uy = (y2 - y1) / L;
  if (a !== 'src' && a !== 'vf') { x1 += ux * PR * 1.15; y1 += uy * PR * 1.15; } if (b === 'vf') [x2, y2] = vfEdgePoint(x1, y1); else if (b !== 'src') { x2 -= ux * PR * 1.15; y2 -= uy * PR * 1.15; }
  if (a === 'vf') [x1, y1] = vfEdgePoint(x2, y2); return [x1, y1, x2, y2]; }
function emitPulse(a, b, col, dur = .85, o = {}) { if (S.pulses.length > 48) S.pulses.shift(); S.pulses.push({a, b, col:col || '#111111', t:0, dur, w:o.w || 1, white:!!o.white}); const k = ekey(a, b); if (edgeAct[k] != null) edgeAct[k] = 1; }
function worldTf(c) { const z = S.cam.z, d = SC.d, sh = S.cam.shake > 0 ? (Math.sin(S.t * 90) * S.cam.shake * 5) : 0;
  c.setTransform(d * z, 0, 0, d * z, d * (stageW / 2 - S.cam.x * z + sh), d * (stageH / 2 - S.cam.y * z)); }
const screenTf = c => c.setTransform(SC.d, 0, 0, SC.d, 0, 0);
const ink = a => S.dark ? `rgba(237,236,230,${a})` : `rgba(17,17,17,${a})`;
const wfs = base => Math.max(base, 12 / S.cam.z); // world-space font size that never drops below 12 screen px
function beamLine(c, x1, y1, x2, y2, col, w, a, halo = 1) { const z = S.cam.z;
  c.globalCompositeOperation = S.dark ? 'lighter' : 'source-over';
  if (halo && !S.lowSpec) { c.strokeStyle = rgba(col, .11 * a * halo); c.lineWidth = (w * 7) / z; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
  c.strokeStyle = rgba(col, a); c.lineWidth = w / z; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); c.globalCompositeOperation = 'source-over'; }
function shapePath(c, kind, R) { c.beginPath();
  const poly = pts => { pts.forEach((p, i) => i ? c.lineTo(p[0] * R, p[1] * R) : c.moveTo(p[0] * R, p[1] * R)); c.closePath(); };
  if (kind === 'tri') poly([[0, -1.08], [.94, .58], [-.94, .58]]);
  else if (kind === 'pb') poly([[-.86, -.5], [.74, -.82], [.98, .46], [-.52, .84]]);
  else if (kind === 'grating') poly([[-.78, -.62], [.78, -.62], [.78, .62], [-.78, .62]]);
  else if (kind === 'dove') poly([[-1.02, .44], [1.02, .44], [.56, -.46], [-.56, -.46]]);
  else if (kind === 'lens') { c.moveTo(0, -R * 1.02); c.quadraticCurveTo(R * .78, 0, 0, R * 1.02); c.quadraticCurveTo(-R * .78, 0, 0, -R * 1.02); c.closePath(); }
  else if (kind === 'ball') c.arc(0, 0, R * .8, 0, 7);
  else if (kind === 'penta') { const p = []; for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; p.push([Math.cos(a) * .96, Math.sin(a) * .96]); } poly(p); }
  else if (kind === 'cube') poly([[-.72, -.72], [.72, -.72], [.72, .72], [-.72, .72]]); }
function drawElement(c, a, now) {
  const st = S.ag[a.id], z = S.cam.z, R = PR, g = st.glow, err = st.st === 'err', skip = st.st === 'skip', stop = st.st === 'stop', pause = st.st === 'pause', spin = pause || S.reduce ? 0 : now;
  c.save(); c.translate(a.x + (err && st.flash > 0 ? Math.sin(now * 60) * 1.8 * st.flash : 0), a.y); if (skip) c.globalAlpha = .42;
  // soft contact shadow
  const sg = c.createRadialGradient(6, R * .9, 2, 6, R * .9, R * 1.2); sg.addColorStop(0, ink(S.dark ? .5 : .16)); sg.addColorStop(1, ink(0));
  c.fillStyle = sg; c.beginPath(); c.ellipse(6, R * .92, R * 1.15, R * .32, 0, 0, 7); c.fill();
  // activity halo + goniometer ring
  if (g > .01) { const hg = c.createRadialGradient(0, 0, R * .4, 0, 0, R * 2.3); hg.addColorStop(0, rgba(err ? '#FF5A1F' : a.c, .26 * g)); hg.addColorStop(1, rgba(a.c, 0)); c.fillStyle = hg; c.beginPath(); c.arc(0, 0, R * 2.3, 0, 7); c.fill();
    c.save(); c.rotate(spin * .5); c.strokeStyle = rgba(err ? '#FF5A1F' : a.c, .65 * g); c.lineWidth = 1 / z; c.setLineDash([2 / z, 5 / z]); c.beginPath(); c.arc(0, 0, R * 1.55, 0, 7); c.stroke(); c.setLineDash([]);
    for (let i = 0; i < 24; i++) { const an = i / 24 * 6.283, l = i % 6 === 0 ? 9 : 4; c.beginPath(); c.moveTo(Math.cos(an) * R * 1.55, Math.sin(an) * R * 1.55); c.lineTo(Math.cos(an) * (R * 1.55 + l), Math.sin(an) * (R * 1.55 + l)); c.stroke(); }
    c.restore(); }
  if (st.st === 'queue') { c.strokeStyle = ink(.34); c.lineWidth = 1 / z; c.setLineDash([1.5 / z, 4 / z]); c.beginPath(); c.arc(0, 0, R * 1.42, 0, 7); c.stroke(); c.setLineDash([]); }
  const rot = {tri:0, pb:.18, grating:0, dove:0, lens:0, ball:0, penta:.16, cube:0}[a.shape];
  c.rotate(rot);
  // glass body
  shapePath(c, a.shape, R);
  const gb = c.createLinearGradient(-R, -R, R, R);
  if (S.dark) { gb.addColorStop(0, 'rgba(255,255,255,.16)'); gb.addColorStop(.55, rgba(a.c, .10 + .14 * g)); gb.addColorStop(1, 'rgba(255,255,255,.05)'); }
  else { gb.addColorStop(0, 'rgba(255,255,255,.95)'); gb.addColorStop(.5, rgba(a.c, .08 + .16 * g)); gb.addColorStop(1, 'rgba(236,238,244,.72)'); }
  c.fillStyle = gb; c.fill();
  if (a.shape === 'grating') { c.save(); c.clip(); c.strokeStyle = rgba(a.c, .35 + .4 * g); c.lineWidth = 1 / z; for (let x = -R; x < R; x += 4.5) { c.beginPath(); c.moveTo(x, -R); c.lineTo(x, R); c.stroke(); } c.restore(); shapePath(c, a.shape, R); }
  if (a.shape === 'cube') { c.strokeStyle = rgba(a.c, .7); c.lineWidth = 1.4 / z; c.beginPath(); c.moveTo(-R * .72, R * .72); c.lineTo(R * .72, -R * .72); c.stroke(); shapePath(c, a.shape, R); }
  // internal light path when active
  if (g > .05) { c.save(); shapePath(c, a.shape, R); c.clip(); c.globalCompositeOperation = S.dark ? 'lighter' : 'source-over';
    c.strokeStyle = ink(.55 * g); c.lineWidth = 1.3 / z; c.beginPath(); c.moveTo(-R * 1.2, R * .1); c.lineTo(-R * .1, 0); c.stroke();
    for (let k = 0; k < 6; k++) { const col = SPECTRUM[k + 1], an = -.32 + k * .13 + Math.sin(spin * 2 + k) * .02; c.strokeStyle = rgba(col, .8 * g); c.lineWidth = 1.2 / z; c.beginPath(); c.moveTo(-R * .1, 0); c.lineTo(R * 1.3 * Math.cos(an), R * 1.3 * Math.sin(an)); c.stroke(); }
    c.restore(); }
  // crisp edges
  shapePath(c, a.shape, R); if (skip || stop) c.setLineDash([4 / z, 3 / z]);
  c.strokeStyle = err ? rgba('#FF5A1F', .7 + .3 * Math.sin(now * 12)) : stop ? ink(.45) : ink(.88); c.lineWidth = (err ? 2 : 1.25) / z; c.stroke(); c.setLineDash([]);
  c.save(); shapePath(c, a.shape, R * .86); c.strokeStyle = S.dark ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.95)'; c.lineWidth = 1 / z; c.stroke(); c.restore();
  // spectral rim on exit face
  c.strokeStyle = rgba(a.c, skip || stop ? .35 : .55 + .45 * g); c.lineWidth = 2.2 / z; c.beginPath();
  if (a.shape === 'ball' || a.shape === 'lens') c.arc(0, 0, R * .8, -.5, .5); else { c.moveTo(R * .5, -R * .5); c.lineTo(R * .78, R * .3); } c.stroke();
  c.rotate(-rot);
  // index stamp (12 px on screen; skipped when the element itself is tiny)
  if (R * z >= 20) { c.fillStyle = ink(.55); c.font = `600 ${12 / z}px ${MONO}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(a.idx + 1).padStart(2, '0'), 0, (a.shape === 'tri' ? R * .24 : 0)); c.textAlign = 'left'; }
  // badges
  const b = 9 / Math.max(z, .6), bx = R * .95, by = -R * .85;
  if (st.st === 'done' && S.run.on) { c.fillStyle = '#C8F53B'; c.strokeStyle = '#111'; c.lineWidth = 1 / z; c.beginPath(); c.arc(bx, by, b, 0, 7); c.fill(); c.stroke();
    c.lineWidth = 1.6 / z; c.beginPath(); c.moveTo(bx - b * .45, by); c.lineTo(bx - b * .1, by + b * .35); c.lineTo(bx + b * .45, by - b * .35); c.stroke(); }
  if (err) { const e = b * 1.1; c.fillStyle = '#FF5A1F'; c.beginPath(); c.arc(bx, by, e, 0, 7); c.fill(); c.fillStyle = '#fff'; c.fillRect(bx - e * .12, by - e * .55, e * .24, e * .66); c.fillRect(bx - e * .12, by + e * .25, e * .24, e * .24); }
  if (pause) { c.fillStyle = ink(.9); c.beginPath(); c.arc(bx, by, b, 0, 7); c.fill(); c.fillStyle = S.dark ? '#111' : '#fff'; c.fillRect(bx - b * .42, by - b * .45, b * .28, b * .9); c.fillRect(bx + b * .14, by - b * .45, b * .28, b * .9); }
  if (stop) { c.fillStyle = ink(.55); c.beginPath(); c.arc(bx, by, b, 0, 7); c.fill(); c.fillStyle = S.dark ? '#111' : '#fff'; c.fillRect(bx - b * .38, by - b * .38, b * .76, b * .76); }
  if (S.cam.user === a.id || (S.cam.focus === a.id && S.cam.mode !== 'overview')) { const L = 12 / z, B = R * 1.85; c.strokeStyle = S.cam.lock > .8 ? '#FF5A1F' : ink(.9); c.lineWidth = 1.5 / z;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => { c.beginPath(); c.moveTo(sx * B, sy * B - sy * L); c.lineTo(sx * B, sy * B); c.lineTo(sx * B - sx * L, sy * B); c.stroke(); }); }
  c.restore(); }
function drawBench(c, now) {
  const z = S.cam.z, x0 = S.cam.x - stageW / 2 / z, y0 = S.cam.y - stageH / 2 / z, x1 = S.cam.x + stageW / 2 / z, y1 = S.cam.y + stageH / 2 / z;
  // breadboard holes (25 mm pitch) + major rules
  const pitch = 40, hs = 1.5 / Math.max(z, .6); c.fillStyle = ink(S.dark ? .16 : .13);
  if (!S.lowSpec || z > .5) for (let x = Math.ceil(x0 / pitch) * pitch; x <= x1; x += pitch) for (let y = Math.ceil(y0 / pitch) * pitch; y <= y1; y += pitch) c.fillRect(x - hs / 2, y - hs / 2, hs, hs);
  c.strokeStyle = ink(.06); c.lineWidth = 1 / z; c.beginPath();
  for (let x = Math.ceil(x0 / 200) * 200; x <= x1; x += 200) { c.moveTo(x, y0); c.lineTo(x, y1); } for (let y = Math.ceil(y0 / 200) * 200; y <= y1; y += 200) { c.moveTo(x0, y); c.lineTo(x1, y); } c.stroke();
  // ring cavity guide + goniometer ticks
  c.strokeStyle = ink(.16); c.lineWidth = 1 / z; c.setLineDash([3 / z, 6 / z]); c.beginPath(); c.ellipse(WORLD.cx, WORLD.cy, WORLD.rx, WORLD.ry, 0, 0, 7); c.stroke(); c.setLineDash([]);
  for (let i = 0; i < 96; i++) { const an = i / 96 * 6.2832, l = i % 12 === 0 ? 14 : i % 4 === 0 ? 8 : 4, cx = WORLD.cx + Math.cos(an) * (WORLD.rx + 26), cy = WORLD.cy + Math.sin(an) * (WORLD.ry + 26);
    c.strokeStyle = ink(i % 12 === 0 ? .4 : .18); c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(an) * l, cy + Math.sin(an) * l * .7); c.stroke(); }
  // source lamp (collimator) — lit while a run is live
  c.save(); c.translate(SOURCE.x, SOURCE.y); c.fillStyle = S.dark ? '#1D1E22' : '#FFFFFF'; c.strokeStyle = ink(.9); c.lineWidth = 1.2 / z;
  rrect(c, -40, -18, 62, 36, 3); c.fill(); c.stroke(); c.fillStyle = ink(.9); c.fillRect(-40, -18, 10, 36);
  c.beginPath(); c.ellipse(24, 0, 5, 16, 0, 0, 7); c.fillStyle = S.dark ? 'rgba(255,255,255,.2)' : 'rgba(225,232,255,.9)'; c.fill(); c.stroke();
  const on = S.run.live ? (S.run.status === 'paused' ? .6 : 1) : .35; c.fillStyle = rgba('#FF5A1F', on); c.beginPath(); c.arc(-24, 0, 4, 0, 7); c.fill(); c.restore();
  // network edges
  EDGES.forEach(e => { const k = e.a + '>' + e.b, act = edgeAct[k], [xa, ya, xb, yb] = segEnds(e.a, e.b);
    if (act > .02) { const col = e.a === 'src' || e.a === 'vf' ? '#111111' : AG[e.a].c; beamLine(c, xa, ya, xb, yb, col, 1.2, .25 + .6 * act, act); }
    c.strokeStyle = ink(.24); c.lineWidth = 1 / z; c.setLineDash(e.b === 'vf' ? [1.5 / z, 4 / z] : [5 / z, 4 / z]); c.beginPath(); c.moveTo(xa, ya); c.lineTo(xb, yb); c.stroke(); c.setLineDash([]);
    if (e.b !== 'vf') { const mx = (xa + xb) / 2, my = (ya + yb) / 2, an = Math.atan2(yb - ya, xb - xa) + Math.PI / 4; c.strokeStyle = ink(.5); c.beginPath(); c.moveTo(mx - Math.cos(an) * 5, my - Math.sin(an) * 5); c.lineTo(mx + Math.cos(an) * 5, my + Math.sin(an) * 5); c.stroke(); } });
  // pulses with dispersion
  S.pulses.forEach(p => { const [xa, ya, xb, yb] = segEnds(p.a, p.b), u = E.io(clamp(p.t / p.dur, 0, 1)), L = Math.hypot(xb - xa, yb - ya) || 1, ux = (xb - xa) / L, uy = (yb - ya) / L, nx = -uy, ny = ux;
    const hx = xa + (xb - xa) * u, hy = ya + (yb - ya) * u, tail = Math.min(110, L * u); if (tail < .5) return;
    [-1, 0, 1].forEach(k => { if (S.lowSpec && k) return; const col = p.white ? (k === 0 ? (S.dark ? '#FFFFFF' : '#111111') : k < 0 ? '#2F37FF' : '#F0284A') : (k === 0 ? p.col : specAt(clamp(AG[p.a] ? AG[p.a].idx / 7 + k * .12 : .5, 0, 1)));
      const off = k * 2.4, lag = Math.abs(k) * 8, gx = hx - ux * lag + nx * off, gy = hy - uy * lag + ny * off, gr = c.createLinearGradient(gx - ux * tail, gy - uy * tail, gx, gy);
      gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(1, rgba(col, 1));
      c.globalCompositeOperation = S.dark ? 'lighter' : 'source-over'; c.strokeStyle = gr; c.lineWidth = (k === 0 ? 2.2 : 1.2) * p.w / z; c.beginPath(); c.moveTo(gx - ux * tail, gy - uy * tail); c.lineTo(gx, gy); c.stroke(); });
    c.fillStyle = S.dark ? '#fff' : rgba(p.white ? '#111111' : p.col, 1); c.beginPath(); c.arc(hx, hy, 3.2 / Math.max(z, .7), 0, 7); c.fill(); c.globalCompositeOperation = 'source-over'; });
  drawVF(c, now);
  AGENTS.forEach(a => drawElement(c, a, now));
}
/* ---- viewfinder ---- */
const VF_EN = {film:'PLAYBACK', board:'STORYBOARD', asset:'CUT & GRADE', scope:'OSCILLOSCOPE', code:'COMPILER', render:'RENDER'};
const aspectLabel = () => { const p = M && M.project; if (!p) return '—'; if (p.width > 0 && p.height > 0) { const g = (a, b) => b ? g(b, a % b) : a, k = g(p.width, p.height) || 1, a = p.width / k, b = p.height / k; return a <= 64 && b <= 64 ? a + ':' + b : (p.width / p.height).toFixed(2) + ':1'; } return p.aspectRatio || '—'; };
function drawVF(c, now) {
  const r = vfRect(), z = S.cam.z, m = S.film.mode, q = 1 / z, live = S.run.live;
  const fs = wfs(10.5), pad = fs * 1.05, hudH = pad + fs * 1.4;
  const pip = M && M.director.avatarEnabled && m === 'film' && !pvReady();
  c.save(); c.fillStyle = S.dark ? 'rgba(0,0,0,.55)' : ink(.2); c.fillRect(r.x + 6, r.y + 8, r.w, r.h); // hard offset shadow (Bauhaus)
  c.fillStyle = '#0F0E0D'; c.fillRect(r.x, r.y, r.w, r.h);
  if (m === 'film' || m === 'render') { if (pvReady()) drawVideoFrame(c, r); else drawFilm(c, r.x, r.y, r.w, r.h, S.film.t, {px:q, top:hudH, pip}); }
  else if (m === 'asset' && S.film.asset) { const A = S.film.asset; drawAssetCached(c, r.x, r.y, r.w, r.h, A, now);
    const cp = clamp(S.film.assetP || 0, 0, 1), ins = (1 - E.o(cp)) * 0.08; c.strokeStyle = '#C8F53B'; c.lineWidth = 2 / z; c.strokeRect(r.x + r.w * ins, r.y + r.h * ins, r.w * (1 - ins * 2), r.h * (1 - ins * 2));
    const bf = wfs(12), bh = bf * 2.4; c.fillStyle = 'rgba(17,17,17,.72)'; c.fillRect(r.x, r.y + r.h - bh, r.w, bh); c.textBaseline = 'middle';
    c.font = `700 ${bf}px ${MONO}`; const rt = A.used && A.used.length ? 'CUT ' + sceneRange(A.used) : 'CUT & GRADE', rw = Math.min(c.measureText(rt).width, r.w * .4);
    c.fillStyle = '#C8F53B'; c.textAlign = 'right'; c.fillText(fitText(c, rt, r.w * .4), r.x + r.w - bf, r.y + r.h - bh / 2); c.textAlign = 'left';
    c.fillStyle = '#fff'; c.font = `600 ${bf}px ${SANS}`; c.fillText(fitText(c, '智能裁切 · 调色 → ' + A.name, r.w - rw - bf * 3), r.x + bf, r.y + r.h - bh / 2); }
  else if (m === 'board') drawBoard(c, r, now);
  else if (m === 'scope') drawScope(c, r, now);
  else if (m === 'code') drawCode(c, r, now);
  else drawFilm(c, r.x, r.y, r.w, r.h, S.film.t, {px:q, top:hudH});
  if (m === 'render') { const p = clamp(S.film.renderP || 0, 0, 1), yy = r.y + r.h * p; c.fillStyle = 'rgba(15,14,13,.9)'; c.fillRect(r.x, yy, r.w, r.h - (yy - r.y));
    c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 1 / z; for (let x = r.x; x < r.x + r.w; x += 24) { c.beginPath(); c.moveTo(x, yy); c.lineTo(x, r.y + r.h); c.stroke(); }
    c.fillStyle = '#C8F53B'; c.fillRect(r.x, yy - 1.5 / z, r.w, 3 / z); c.fillStyle = 'rgba(200,245,59,.18)'; c.fillRect(r.x, yy - 18, r.w, 18);
    const big = Math.max(r.h * .16, 24 * q), sm = wfs(11), fr = Math.round(PROJ.dur * PROJ.fps), pdir = M && M.project;
    c.fillStyle = '#fff'; c.font = `800 ${big}px ${SANS}`; c.textAlign = 'right'; c.textBaseline = 'alphabetic'; c.fillText(Math.round(p * 100) + '%', r.x + r.w - sm * 1.5, r.y + r.h - sm * 1.5);
    c.font = `600 ${sm}px ${MONO}`; c.fillText(fitText(c, 'RENDER · ' + ((pdir && pdir.quality) || '') + ' · ' + PROJ.fps + 'fps' + (fr > 0 ? ' · ' + fr + ' 帧' : ''), r.w * .8), r.x + r.w - sm * 1.5, r.y + r.h - big - sm * 2.2); c.textAlign = 'left'; }
  // finale exposure
  if (S.finale) { const f = S.finale; if (f.flash > 0) { c.fillStyle = `rgba(255,255,255,${f.flash})`; c.fillRect(r.x, r.y, r.w, r.h); } if (f.iris > 0) drawIris(c, r, f.iris); }
  // avatar PiP (animatic only — a rendered MP4 already contains the real avatar)
  if (pip) { const lay = M.director.avatarLayout, full = lay === 'fullscreen', pw = r.w * (full ? 1 : .2), ph = r.h * (full ? 1 : .3);
    const px = lay === 'pip-bl' ? r.x + 12 : full ? r.x : r.x + r.w - pw - 12, py = full ? r.y : r.y + r.h - ph - 12;
    if (!full) { c.fillStyle = 'rgba(17,17,17,.82)'; c.fillRect(px, py, pw, ph); c.strokeStyle = '#F2A900'; c.lineWidth = 1.2 / z; c.strokeRect(px, py, pw, ph);
      c.fillStyle = '#F2A900'; c.beginPath(); c.arc(px + pw / 2, py + ph * .42, ph * .17, 0, 7); c.fill(); c.beginPath(); c.ellipse(px + pw / 2, py + ph, pw * .3, ph * .36, 0, Math.PI, 0); c.fill();
      const lf = wfs(Math.max(7, ph * .1)); if (lf * 1.6 < ph * .4) { c.fillStyle = '#fff'; c.font = `600 ${lf}px ${MONO}`; c.textBaseline = 'top'; c.fillText(fitText(c, '数字人', pw - 8), px + 4, py + 4); } } }
  // optics overlays: thirds, crosshair, focus ring, brackets
  c.strokeStyle = 'rgba(255,255,255,.16)'; c.lineWidth = 1 / z; c.beginPath();
  for (let i = 1; i < 3; i++) { c.moveTo(r.x + r.w * i / 3, r.y); c.lineTo(r.x + r.w * i / 3, r.y + r.h); c.moveTo(r.x, r.y + r.h * i / 3); c.lineTo(r.x + r.w, r.y + r.h * i / 3); } c.stroke();
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, fr = Math.min(r.w, r.h) * .17;
  c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = 1 / z; c.beginPath(); c.moveTo(cx - 14, cy); c.lineTo(cx - 5, cy); c.moveTo(cx + 5, cy); c.lineTo(cx + 14, cy); c.moveTo(cx, cy - 14); c.lineTo(cx, cy - 5); c.moveTo(cx, cy + 5); c.lineTo(cx, cy + 14); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.arc(cx, cy, fr, 0, 7); c.stroke();
  for (let i = 0; i < 36; i++) { const an = i / 36 * 6.283 + (S.finale ? S.finale.t * 2 : 0); c.beginPath(); c.moveTo(cx + Math.cos(an) * fr, cy + Math.sin(an) * fr); c.lineTo(cx + Math.cos(an) * (fr + (i % 9 === 0 ? 8 : 3)), cy + Math.sin(an) * (fr + (i % 9 === 0 ? 8 : 3))); c.stroke(); }
  const L = 22, o = 9; c.strokeStyle = ink(.95); c.lineWidth = 2 / z;
  [[r.x - o, r.y - o, 1, 1], [r.x + r.w + o, r.y - o, -1, 1], [r.x + r.w + o, r.y + r.h + o, -1, -1], [r.x - o, r.y + r.h + o, 1, -1]].forEach(([x, y, sx, sy]) => { c.beginPath(); c.moveTo(x, y + sy * L); c.lineTo(x, y); c.lineTo(x + sx * L, y); c.stroke(); });
  // HUD row inside the frame (12 px min; the right time-code drops out when there is no room)
  if (r.h * z > 48) { const sg = c.createLinearGradient(0, r.y, 0, r.y + hudH * 1.5); sg.addColorStop(0, 'rgba(10,10,12,.58)'); sg.addColorStop(1, 'rgba(10,10,12,0)'); c.fillStyle = sg; c.fillRect(r.x, r.y, r.w, hudH * 1.5);
    c.font = `600 ${fs}px ${MONO}`; c.textBaseline = 'top'; const pdir = M && M.project, rec = live && S.run.status === 'running';
    c.fillStyle = rec ? (Math.sin(now * 6) > 0 ? '#FF5A1F' : 'rgba(255,90,31,.3)') : 'rgba(255,255,255,.5)'; c.beginPath(); c.arc(r.x + pad, r.y + pad + fs * .5, fs * .32, 0, 7); c.fill();
    const tag = (rec ? 'REC' : S.run.status === 'paused' ? 'PAUSED' : pvReady() ? 'MP4' : SCENES.length ? 'ANIMATIC' : 'NO SIGNAL') + (pdir ? ' · ' + aspectLabel() + ' · ' + (pdir.quality || '1080p') + ' · ' + pdir.fps + 'fps' : '');
    const tc = 'TC ' + tcode(S.film.t), tcw = c.measureText(tc).width, avail = r.w - pad * 2.9, showTc = c.measureText(tag).width + tcw + pad * 1.5 < avail;
    const tagTxt = fitText(c, tag, showTc ? avail - tcw - pad : avail); if (tagTxt.length >= 6) { c.fillStyle = 'rgba(255,255,255,.88)'; c.fillText(tagTxt, r.x + pad * 1.9, r.y + pad); }
    if (showTc) { c.textAlign = 'right'; c.fillText(tc, r.x + r.w - pad, r.y + pad); c.textAlign = 'left'; } }
  // caption above the frame
  const cf = wfs(12), mf = wfs(9), capY = r.y - o - cf * .45, full = r.w + o * 2; c.textBaseline = 'bottom';
  c.font = `800 ${cf}px ${SANS}`; const cn = '取景器', cnw = c.measureText(cn).width; c.fillStyle = ink(.9); c.fillText(cn, r.x - o, capY);
  c.font = `600 ${mf}px ${MONO}`; const en = 'VIEWFINDER · ' + (VF_EN[m] || 'PLAYBACK'), enw = c.measureText(en).width, sc = SCENES.length ? sceneAt(S.film.t) : null;
  const rt = sc ? sc.title + ' · S' + String(sc.no).padStart(2, '0') : '', rtw = rt ? c.measureText(rt).width : 0, gap = cf * .8;
  if (full * z < 150) { c.restore(); return; }
  const showEn = cnw + gap + enw <= full, room = full - (showEn ? cnw + gap + enw : cnw) - gap * 1.5;
  c.fillStyle = ink(.5); if (showEn) c.fillText(en, r.x - o + cnw + gap * .6, capY - (cf - mf) * .1);
  if (rt && room > mf * 4) { c.textAlign = 'right'; c.fillText(fitText(c, rt, room), r.x + r.w + o, capY - (cf - mf) * .1); c.textAlign = 'left'; }
  c.restore(); }
const artCache = new Map();
function drawAssetCached(c, x, y, w, h, A, now) { const im = A.thumb && img(A.thumb); if (im) { c.fillStyle = '#111'; c.fillRect(x, y, w, h); drawImg(c, im, x, y, w, h, false); return; }
  const key = artOf(A) + Math.round(w) + 'x' + Math.round(h); let cv = artCache.get(key);
  if (!cv) { if (artCache.size > 24) artCache.clear(); cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * 1.5)); cv.height = Math.max(1, Math.round(h * 1.5)); const cc = cv.getContext('2d'); cc.scale(1.5, 1.5); drawArt(cc, w, h, artOf(A), 0); artCache.set(key, cv); }
  c.drawImage(cv, x, y, w, h); }
function drawIris(c, r, k) { const cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = Math.hypot(r.w, r.h) / 2, ap = R0(R * (1 - k)); c.save(); c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip();
  for (let i = 0; i < 7; i++) { const a0 = i / 7 * 6.283 + k * 1.2; c.fillStyle = i % 2 ? '#141312' : '#1D1C1A'; c.beginPath(); c.moveTo(cx + Math.cos(a0) * ap, cy + Math.sin(a0) * ap); c.lineTo(cx + Math.cos(a0) * R * 1.4, cy + Math.sin(a0) * R * 1.4);
    c.lineTo(cx + Math.cos(a0 + 1.3) * R * 1.4, cy + Math.sin(a0 + 1.3) * R * 1.4); c.lineTo(cx + Math.cos(a0 + .9) * ap, cy + Math.sin(a0 + .9) * ap); c.closePath(); c.fill(); }
  c.restore(); }
// storyboard sheet: one cell per real scene, revealed with the director's progress
function drawBoard(c, r, now) { const N = SCENES.length, n = S.film.boardN || 0, z = S.cam.z, fs = wfs(11), head = fs * 2, foot = fs * 2.6, gh = r.h - head - foot;
  c.fillStyle = '#F3F1EA'; c.fillRect(r.x, r.y, r.w, r.h);
  c.fillStyle = '#111'; c.font = `700 ${fs}px ${MONO}`; c.textBaseline = 'top';
  const lt = N ? 'STORYBOARD ' + String(Math.min(N, Math.floor(n))).padStart(2, '0') + ' / ' + String(N).padStart(2, '0') : 'STORYBOARD · 拆解分镜中', rtx = PROJ.bpm ? 'BEAT GRID · ' + Math.round(PROJ.bpm) + ' BPM' : BEATS.length ? 'BEAT GRID · ' + BEATS.length + ' 拍' : '';
  const ltw = Math.min(c.measureText(lt).width, r.w * .6); c.fillText(fitText(c, lt, r.w * .6), r.x + fs * .7, r.y + fs * .5);
  if (rtx && r.w - ltw - fs * 3 > fs * 5) { c.textAlign = 'right'; c.fillText(fitText(c, rtx, r.w - ltw - fs * 3), r.x + r.w - fs * .7, r.y + fs * .5); c.textAlign = 'left'; }
  if (gh > 8) {
    const cnt = N || 40, cols = clamp(Math.ceil(Math.sqrt(cnt * r.w / gh)), 3, 16), rows = Math.ceil(cnt / cols), gx = r.w / cols, gy = gh / rows, pd = Math.min(3, gx * .06);
    for (let i = 0; i < cnt; i++) { const x = r.x + (i % cols) * gx, y = r.y + head + Math.floor(i / cols) * gy;
      c.strokeStyle = 'rgba(17,17,17,.14)'; c.lineWidth = 1 / z; c.strokeRect(x + pd, y + pd, gx - pd * 2, gy - pd * 2);
      if (!N || i >= n) continue; const s = SCENES[i], a = clamp(n - i, 0, 1), bh = (gy - pd * 2) * .58; c.globalAlpha = a;
      const th = s.thumb && img(s.thumb); if (th) drawImg(c, th, x + pd, y + pd, gx - pd * 2, bh, false); else { c.fillStyle = rgba(timeHue(s.start + s.dur / 2), .9); c.fillRect(x + pd, y + pd, gx - pd * 2, bh); }
      const tf = 12 / z; if (gx * z >= 26 && (gy - pd * 2 - bh) * z >= 14) { c.fillStyle = '#111'; c.font = `700 ${tf}px ${MONO}`; c.textBaseline = 'top'; const no = String(i + 1).padStart(2, '0'), nw = c.measureText(no).width;
        c.fillText(no, x + pd * 2, y + pd + bh + 1 / z); if ((gx - pd * 4 - nw) * z > 30) { c.font = `600 ${tf}px ${SANS}`; c.fillText(fitText(c, s.title, gx - pd * 4 - nw - 4 / z), x + pd * 2 + nw + 4 / z, y + pd + bh + 1 / z); } }
      c.globalAlpha = 1; } }
  const by = r.y + r.h - foot * .4, bp = S.rev.grid, dur = PROJ.dur || 1; c.strokeStyle = 'rgba(17,17,17,.2)'; c.lineWidth = 1 / z; c.beginPath(); c.moveTo(r.x + 8, by); c.lineTo(r.x + r.w - 8, by); c.stroke();
  const step = BEATS.length > 400 ? 2 : 1; BEATS.forEach((b, i) => { if (i % step && !b.s) return; const u = b.t / dur; if (u > bp) return; const x = r.x + 8 + u * (r.w - 16); c.strokeStyle = b.s ? '#111' : 'rgba(17,17,17,.35)'; c.lineWidth = (b.s ? 1.5 : 1) / z; c.beginPath(); c.moveTo(x, by - (b.s ? 10 : 5)); c.lineTo(x, by); c.stroke(); });
  PROJ.drops.forEach(d => { if (d / dur > bp) return; const x = r.x + 8 + d / dur * (r.w - 16); c.fillStyle = '#FF5A1F'; c.beginPath(); c.moveTo(x - 4, by - 18); c.lineTo(x + 4, by - 18); c.lineTo(x, by - 11); c.fill(); });
  c.fillStyle = '#2F37FF'; c.fillRect(r.x + 8 + bp * (r.w - 16) - 1, by - 22, 2, 24); }
function drawScope(c, r, now) { c.fillStyle = '#0D1214'; c.fillRect(r.x, r.y, r.w, r.h); const z = S.cam.z, fs = wfs(11);
  c.strokeStyle = 'rgba(0,148,255,.14)'; c.lineWidth = 1 / z; for (let i = 1; i < 10; i++) { c.beginPath(); c.moveTo(r.x + r.w * i / 10, r.y); c.lineTo(r.x + r.w * i / 10, r.y + r.h); c.stroke(); } for (let i = 1; i < 6; i++) { c.beginPath(); c.moveTo(r.x, r.y + r.h * i / 6); c.lineTo(r.x + r.w, r.y + r.h * i / 6); c.stroke(); }
  const mid = r.y + r.h * .42, span = 6, t0 = Math.max(0, S.film.scopeT - span), ph = S.reduce ? 0 : now;
  [['#0094FF', BGM_WF, .32, 0], ['#00B89C', VO_WF, .22, r.h * .2]].forEach(([col, wf, amp, off]) => { c.strokeStyle = col; c.lineWidth = 1.4 / z; c.beginPath();
    for (let i = 0; i <= 260; i++) { const tt = t0 + i / 260 * span, v = wf[clamp(Math.floor(tt / WF_DT), 0, WF_N - 1)] || 0, y = mid + off + Math.sin(i * .9 + ph * 30) * v * r.h * amp; i ? c.lineTo(r.x + i / 260 * r.w, y) : c.moveTo(r.x, y); } c.stroke(); });
  for (let i = 0; i < 32; i++) { const v = .2 + .8 * Math.abs(Math.sin(i * .7 + ph * 5 + Math.sin(ph * 3 + i))); c.fillStyle = rgba(specAt(i / 31), .85); c.fillRect(r.x + 14 + i * (r.w - 28) / 32, r.y + r.h - 14 - v * r.h * .18, (r.w - 28) / 32 - 2, v * r.h * .18); }
  const voiced = SCENES.filter(s => s.voice).length, big = Math.max(r.h * .1, 18 / z), pct = Math.round((S.ag.audio.p || 0) * 100) + '%';
  c.font = `800 ${big}px ${SANS}`; c.textBaseline = 'top'; const pw = c.measureText(pct).width; c.fillStyle = '#E8F4FF'; c.textAlign = 'right'; c.fillText(pct, r.x + r.w - fs, r.y + fs * .7); c.textAlign = 'left';
  c.font = `700 ${fs}px ${MONO}`; c.fillText(fitText(c, 'BGM ' + (PROJ.bpm ? Math.round(PROJ.bpm) + ' BPM' : '—') + ' · VO ' + voiced + '/' + SCENES.length + ' · SFX ' + Math.floor(S.film.sfxN || 0) + '/' + SFX.length, r.w - pw - fs * 3), r.x + fs, r.y + fs * .8); }
let CODE_CACHE = {sig:'', lines:[]};
function codeLines() { if (CODE_CACHE.sig === waveSig + PROJ.engine) return CODE_CACHE.lines; const html5 = PROJ.engine === 'html', L = [];
  L.push(html5 ? `// HyperFrames · HTML5 · ${SCENES.length} scenes · ${PROJ.fps}fps` : `// Remotion 4 · ${SCENES.length} scenes · ${PROJ.fps}fps`);
  SCENES.slice(0, 160).forEach(s => { const id = 'S' + String(s.no).padStart(2, '0');
    if (html5) { L.push(`<section id="${s.id}" data-start="${s.start.toFixed(2)}" data-dur="${s.dur.toFixed(2)}">`); L.push(`  <h1>${s.title}</h1>`); if (s.sub) L.push(`  <p class="sub">${s.sub}</p>`); L.push('</section>'); }
    else { L.push(`export const ${id} = () => (`); L.push(`  <Shot title="${s.title}" at={${s.start.toFixed(2)}} dur={${s.dur.toFixed(2)}}>`); if (s.sub) L.push(`    <Subtitle text="${s.sub}" />`); L.push('  </Shot>);'); } });
  if (L.length < 4) L.push('const frame = useCurrentFrame();', 'const {fps} = useVideoConfig();', 'return <AbsoluteFill />;');
  CODE_CACHE = {sig:waveSig + PROJ.engine, lines:L}; return L; }
function drawCode(c, r, now) { c.fillStyle = '#101113'; c.fillRect(r.x, r.y, r.w, r.h); const z = S.cam.z, fs = wfs(11), CODE = codeLines(), p = clamp(S.ag.motion.p || 0, 0, 1);
  const font = Math.max(r.h / 15 * .58, 12 / z), lh = font * 1.72, top = fs * 2.3, bot = fs * 2.2, vis = Math.max(1, Math.floor((r.h - top - bot) / lh)), scroll = (S.film.codeT || 0) * 2.2;
  c.save(); c.beginPath(); c.rect(r.x, r.y + top, r.w, r.h - top - bot); c.clip(); c.font = `${font}px ${MONO}`; c.textBaseline = 'middle';
  for (let i = -1; i < vis + 1; i++) { const li = Math.floor(scroll) + i, y = r.y + top + (i - (scroll % 1)) * lh + lh / 2, line = CODE[((li % CODE.length) + CODE.length) % CODE.length];
    c.fillStyle = 'rgba(255,255,255,.25)'; c.fillText(String(li + 1).padStart(3, ' '), r.x + 10, y);
    const errLine = S.film.err && i === Math.floor(vis / 2); if (errLine) { c.fillStyle = 'rgba(255,90,31,.18)'; c.fillRect(r.x, y - lh / 2, r.w, lh); }
    let x = r.x + 10 + font * 2.6; const maxX = r.x + r.w - 8;
    for (const tok of line.split(/(\s+|[(){}<>=;,.:"/])/)) { if (!tok) continue; const tw = c.measureText(tok).width; if (x + tw > maxX) break;
      c.fillStyle = /^(export|const|return|new|section|h1|p)$/.test(tok) ? '#7C83FF' : /^[A-Z]/.test(tok) ? '#5BC8FF' : /^\d/.test(tok) ? '#FF8A5B' : /[一-鿿]/.test(tok) ? '#C8F53B' : 'rgba(255,255,255,.82)'; c.fillText(tok, x, y); x += tw; }
    if (errLine) { c.strokeStyle = '#FF5A1F'; c.lineWidth = 1.5 / z; c.beginPath(); for (let k = 0; k < 40; k++) c.lineTo(r.x + font * 2.6 + k * 7, y + lh * .32 + (k % 2) * 3); c.stroke(); } }
  c.restore(); c.font = `700 ${fs}px ${MONO}`; c.textBaseline = 'top';
  const rs = S.film.err ? '构建失败 · FAILED' : p >= 1 ? 'BUILD OK' : '编译中 · ' + Math.round(p * 100) + '%', rsw = c.measureText(rs).width;
  c.fillStyle = S.film.err ? '#FF5A1F' : '#C8F53B'; c.textAlign = 'right'; c.fillText(rs, r.x + r.w - fs, r.y + fs * .7); c.textAlign = 'left';
  c.fillStyle = '#fff'; c.fillText(fitText(c, (PROJ.engine === 'html' ? 'HTML5 · HyperFrames' : 'TSX · Remotion 4') + ' · ' + SCENES.length + ' 镜 · tsc --noEmit', r.w - rsw - fs * 3), r.x + fs, r.y + fs * .7);
  const bn = p * 16; for (let i = 0; i < 16; i++) { c.fillStyle = i < bn ? rgba(specAt(i / 15), 1) : 'rgba(255,255,255,.12)'; c.fillRect(r.x + 12 + i * (r.w - 24) / 16, r.y + r.h - bot * .6, (r.w - 24) / 16 - 3, Math.max(4, fs * .45)); } }
