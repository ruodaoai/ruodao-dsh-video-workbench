/* ================= 8 · FX LAYER (screen space: light-beam flights, focus ring, finale) ================= */
const FT = {scan:.5, beam:.62, refract:.34, drop:.78, land:.42, fade:.5};
const FT_ORDER = ['scan', 'beam', 'refract', 'drop', 'land', 'fade'];
const cardSel = id => '.card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : String(id).replace(/["\\]/g, '\\$&')) + '"]';
// tgt: {track:'shot'|'vo'|'bgm', t0, t1, sc:[scene indices], label}
function launchFlight(asset, via, tgt) {
  if (!AG[via]) via = 'editor';
  const card = document.querySelector(cardSel(asset.id));
  if (card) scrollRackTo(card);
  const f = {asset, card, via, tgt, t:0, phase:'scan', pt:0, focusW:[AG[via].x, AG[via].y], col:tgt ? timeHue((tgt.t0 + Math.min(tgt.t1, tgt.t0 + 8)) / 2) : h2r(AG[via].c)};
  S.flights.push(f); if (card) card.classList.add('scan');
  if (tgt && S.cam.mode !== 'overview' && !S.tl.manual) { const span = Math.min(46, PROJ.dur || 46); tlSetWindow(tgt.t0 - span * .3, tgt.t0 + span * .7, false); }
  if (tgt) S.tl.target = {track:tgt.track, t0:tgt.t0, t1:Math.max(tgt.t1, tgt.t0 + .05)};
  return f;
}
function scrollRackTo(card) { const L = D.rackList; if (!L || !card.offsetParent) return; const top = card.offsetTop - L.offsetTop, bot = top + card.offsetHeight; let to = L.scrollTop;
  if (top < L.scrollTop + 4) to = top - 6; else if (bot > L.scrollTop + L.clientHeight - 4) to = bot - L.clientHeight + 6; to = clamp(to, 0, Math.max(0, L.scrollHeight - L.clientHeight));
  if (Math.abs(to - L.scrollTop) < 1) return; if (S.reduce || S.lowSpec) { L.scrollTop = to; S.rackScroll = null; return; } S.rackScroll = {from:L.scrollTop, to, t:0}; }
function stepRackScroll(dt) { const R = S.rackScroll; if (!R) return; R.t = Math.min(1, R.t + dt / .45); D.rackList.scrollTop = lerp(R.from, R.to, E.io(R.t)); if (R.t >= 1) S.rackScroll = null; }
function flightGeom(f) {
  if (!f.card || !f.card.isConnected) f.card = document.querySelector(cardSel(f.asset.id));
  const cr = f.card && f.card.offsetParent ? f.card.getBoundingClientRect() : null, rk = $('#rack').getBoundingClientRect();
  const lr = D.rackList.getBoundingClientRect(), cy0 = cr ? cr.top + cr.height / 2 : 0, P0 = cr ? [Math.min(cr.right - 4, rk.right - 4), clamp(cy0, lr.top + 10, lr.bottom - 10)] : [rk.right - 10, rk.top + rk.height * .4];
  f.off = cr ? (cy0 > lr.bottom - 10 ? 1 : cy0 < lr.top + 10 ? -1 : 0) : 0;
  const a = AG[f.via], pc = w2v(a.x, a.y), z = S.cam.z, dx = pc[0] - P0[0], dy = pc[1] - P0[1], L = Math.hypot(dx, dy) || 1;
  const Pin = [pc[0] - dx / L * PR * z * .7, pc[1] - dy / L * PR * z * .7];
  if (!f.tgt || !TK[f.tgt.track]) return {P0, Pin, pc};
  const T = tlPoint(f.tgt.track, f.tgt.t0); T[0] = clamp(T[0], tlRect.left + 3, tlRect.right - 3);
  const Mr = [T[0], tlRulerY() - 1], ex = Mr[0] - pc[0], ey = Mr[1] - pc[1], EL = Math.hypot(ex, ey) || 1, Pex = [pc[0] + ex / EL * PR * z * .75, pc[1] + ey / EL * PR * z * .75];
  return {P0, Pin, pc, Pex, M:Mr, T};
}
function polyAt(pts, u) { let tot = 0; const seg = []; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); tot += l; }
  let d = u * tot; const out = [pts[0]]; for (let i = 1; i < pts.length; i++) { if (d >= seg[i - 1]) { out.push(pts[i]); d -= seg[i - 1]; } else { const k = d / (seg[i - 1] || 1); out.push([lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)]); break; } } return out; }
function strokePoly(c, pts) { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke(); }
function whiteBeam(c, a, b, alpha, w = 1.6) { const dk = S.dark; c.globalCompositeOperation = dk ? 'lighter' : 'source-over';
  if (!S.lowSpec) { c.strokeStyle = rgba(dk ? '#FFFFFF' : '#111111', .1 * alpha); c.lineWidth = w * 6; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  const nx = -(b[1] - a[1]), ny = b[0] - a[0], nl = Math.hypot(nx, ny) || 1, ox = nx / nl * 1.4, oy = ny / nl * 1.4;
  c.lineWidth = 1; c.strokeStyle = rgba('#2F37FF', .55 * alpha); c.beginPath(); c.moveTo(a[0] + ox, a[1] + oy); c.lineTo(b[0] + ox, b[1] + oy); c.stroke();
  c.strokeStyle = rgba('#F0284A', .55 * alpha); c.beginPath(); c.moveTo(a[0] - ox, a[1] - oy); c.lineTo(b[0] - ox, b[1] - oy); c.stroke();
  c.strokeStyle = rgba(dk ? '#FFFFFF' : '#111111', alpha); c.lineWidth = w; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); c.globalCompositeOperation = 'source-over'; }
// screen-space DOM rects that canvas labels must never cover (refreshed each FX frame that needs labels)
let OBST = [], obstT = -1;
function obstacles() { if (obstT === tick) return OBST; obstT = tick; OBST = [];
  const add = el => { if (!el || !el.offsetParent) return; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity < .05) return; const r = el.getBoundingClientRect(); if (r.width > 1 && r.height > 1) OBST.push([r.left - 4, r.top - 4, r.right + 4, r.bottom + 4]); };
  ['#hudCap', '#vfCtl', '#agentCard.open', '#readyBanner.on', '#pauseStamp.on', '#onboard.on', '.corner'].forEach(s => document.querySelectorAll(s).forEach(add));
  D.labels.querySelectorAll('.alabel:not(.gone),.src-label:not(.gone)').forEach(add);
  if (PROJ.has) { const v = vfRect(), a = w2v(v.x - 9, v.y - 9 - wfs(12) * 1.6), b = w2v(v.x + v.w + 9, v.y + v.h + 9); OBST.push([a[0] - 4, a[1] - 4, b[0] + 4, b[1] + 4]); }
  OBST.push([tlRect.left, tlRect.top, tlRect.right, tlRect.bottom]); return OBST; }
const hitsAny = (r, list) => list.some(o => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1]);
function placeLabel(c, x, y, rr, label, clip) { // try 4 diagonal spots around a ring; null when none is clear of DOM text
  c.font = `700 12px ${MONO}`; const tw = c.measureText(label).width + 12, th = 18, d = rr + 16, ob = obstacles();
  for (const [sx, sy] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) { const lx = sx > 0 ? x + d : x - d - tw, ly = sy < 0 ? y - d - th : y + d;
    const r = [lx, ly, lx + tw, ly + th]; if (clip && (r[0] < clip.left + 4 || r[2] > clip.right - 4 || r[1] < clip.top + 4 || r[3] > clip.bottom - 4)) continue; if (hitsAny(r, ob)) continue; return {lx, ly, tw, th, sx, sy}; }
  return null; }
function focusRing(c, x, y, r, lock, label, clip) { r = R0(r); const k = E.o(clamp(lock, 0, 1)), rr = R0(r * (1.6 - .6 * k)), cc = lock > .85 ? '#FF5A1F' : (S.dark ? '#EDECE6' : '#111111'), spin = S.reduce ? 0 : S.t * .2;
  c.strokeStyle = rgba(cc, .9); c.lineWidth = 1.2; c.beginPath(); c.arc(x, y, rr, 0, 7); c.stroke();
  c.strokeStyle = rgba(cc, .35); c.beginPath(); c.arc(x, y, rr + 7, 0, 7); c.stroke();
  for (let i = 0; i < 4; i++) { const an = i * Math.PI / 2 + (1 - k) * 1.2 + spin, a0 = Math.max(0, rr - 6), a1 = rr + 12; c.strokeStyle = rgba(cc, 1); c.lineWidth = 2; c.beginPath(); c.moveTo(x + Math.cos(an) * a0, y + Math.sin(an) * a0); c.lineTo(x + Math.cos(an) * a1, y + Math.sin(an) * a1); c.stroke(); }
  for (let i = 0; i < 48; i++) { const an = i / 48 * 6.283, l = i % 4 ? 3 : 6; c.strokeStyle = rgba(cc, .45); c.lineWidth = 1; c.beginPath(); c.moveTo(x + Math.cos(an) * (rr + 7), y + Math.sin(an) * (rr + 7)); c.lineTo(x + Math.cos(an) * (rr + 7 + l), y + Math.sin(an) * (rr + 7 + l)); c.stroke(); }
  if (!label) return; const P = placeLabel(c, x, y, rr, label, clip); if (!P) return;
  const bg = lock > .85 ? '#FF5A1F' : (S.dark ? '#EDECE6' : '#111111'); c.fillStyle = bg; c.fillRect(P.lx, P.ly, P.tw, P.th); c.fillStyle = lock > .85 ? '#fff' : (S.dark ? '#111' : '#fff');
  c.textBaseline = 'middle'; c.fillText(label, P.lx + 6, P.ly + P.th / 2 + .5);
  c.strokeStyle = bg; c.lineWidth = 1; c.beginPath(); c.moveTo(x + P.sx * rr * .72, y + P.sy * rr * .72); c.lineTo(P.sx > 0 ? P.lx : P.lx + P.tw, P.sy < 0 ? P.ly + P.th : P.ly); c.stroke(); }
function sparkBurst(x, y, col, n = 12) { if (S.reduce) return; if (S.lowSpec) n = Math.ceil(n / 3); for (let i = 0; i < n; i++) { const an = Math.random() * 6.283, sp = 40 + Math.random() * 140; S.sparks.push({x, y, vx:Math.cos(an) * sp, vy:Math.sin(an) * sp - 30, life:1, col:i % 3 ? col : SPECTRUM[(i * 3) % 8], s:2 + Math.random() * 2.5}); }
  if (S.sparks.length > 160) S.sparks.splice(0, S.sparks.length - 160); }
function updateFlights(dt) {
  S.flights.forEach(f => { if (f.phase === 'done') return; f.t += dt; let acc = 0;
    for (const ph of FT_ORDER) { acc += FT[ph]; if (f.t < acc || ph === 'fade') { let ci = FT_ORDER.indexOf(f.phase); const ti = FT_ORDER.indexOf(ph); while (ci < ti) { ci++; enterPhase(f, FT_ORDER[ci]); } f.pt = clamp((f.t - (acc - FT[ph])) / FT[ph], 0, 1); break; } }
    if (f.t > 3.2) { f.phase = 'done'; if (f.card) { f.card.classList.remove('scan'); f.card.style.removeProperty('--scan'); } }
    if (f.card && f.phase === 'scan') f.card.style.setProperty('--scan', E.io(f.pt).toFixed(3));
    const a = AG[f.via]; f.focusW = (f.phase === 'drop' || f.phase === 'land') && f.tgt ? [a.x + 40, a.y + 70] : [a.x, a.y];
    if (f.phase === 'land' && f.tgt && f.tgt.track === 'shot') f.tgt.sc.forEach((i, n) => { const sh = S.shots[i]; if (!sh) return; const k = clamp(f.pt * 1.6 - n * .18, 0, 1); if (sh.st !== 'full' || sh.land < 1) { sh.st = 'land'; sh.land = Math.max(sh.land, k); } }); });
  S.flights = S.flights.filter(f => f.phase !== 'done' || f.t < 3.3);
  S.sparks.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 220 * dt; p.life -= dt * 1.6; }); S.sparks = S.sparks.filter(p => p.life > 0);
}
function enterPhase(f, ph) { f.phase = ph; const a = AG[f.via], st = S.ag[f.via];
  if (ph === 'beam' && f.card) { f.card.classList.remove('scan'); f.card.style.removeProperty('--scan'); }
  if (ph === 'refract') { st.glow = 1; edgeFlash(f.via); if (f.via === 'editor' || f.via === 'audio') { S.film.asset = f.asset; S.film.assetP = 0; S.film.assetT = S.t; } }
  if (ph === 'land') { const g = flightGeom(f); if (g.T) sparkBurst(g.T[0], g.T[1], f.col, 14); else sparkBurst(g.pc[0], g.pc[1], h2r(a.c), 10);
    S.used.add(f.asset.id); const cd = document.querySelector(cardSel(f.asset.id)); if (cd) cd.classList.add('used'); }
  if (ph === 'fade') { S.tl.target = null; if (f.tgt && f.tgt.track === 'shot') f.tgt.sc.forEach(i => { const sh = S.shots[i]; if (sh && sh.st === 'land') { sh.st = 'full'; sh.land = 1; } }); } }
function edgeFlash(id) { EDGES.forEach(e => { if (e.a === id || e.b === id) edgeAct[e.a + '>' + e.b] = Math.max(edgeAct[e.a + '>' + e.b], .6); }); }
function drawFX(now) {
  const cm = S.cam, need = S.flights.length || S.sparks.length || S.finale || ((cm.mode !== 'overview' || cm.user) && cm.focus);
  if (!need && !S.fxWas) return; S.fxWas = !!need;
  const c = FX.c; c.setTransform(FX.d, 0, 0, FX.d, 0, 0); c.clearRect(0, 0, vw, vh); if (!need) return; c.lineCap = 'round'; c.lineJoin = 'round';
  if (S.finale) drawFinale(c, now); // behind flights
  S.flights.forEach(f => { if (f.phase === 'done' || f.phase === 'scan') return; const g = flightGeom(f), ph = f.phase, u = f.pt || 0, fade = ph === 'fade' ? 1 - u : 1;
    // incoming white beam (card → element)
    const hb = ph === 'beam' ? E.io(u) : 1, head = [lerp(g.P0[0], g.Pin[0], hb), lerp(g.P0[1], g.Pin[1], hb)];
    whiteBeam(c, g.P0, head, .9 * fade, 1.6);
    if (f.off) { const s = 6, y = g.P0[1]; c.fillStyle = '#2F37FF'; c.beginPath(); c.moveTo(g.P0[0] - s, y - f.off * s * .3); c.lineTo(g.P0[0] + s, y - f.off * s * .3); c.lineTo(g.P0[0], y + f.off * s); c.closePath(); c.fill(); }
    if (ph === 'beam') { c.fillStyle = S.dark ? '#fff' : '#111'; c.fillRect(head[0] - 7, head[1] - 4.5, 14, 9); c.strokeStyle = rgba(f.col, 1); c.lineWidth = 1.5; c.strokeRect(head[0] - 9, head[1] - 6.5, 18, 13);
      if (!S.lowSpec) { const gl = c.createRadialGradient(head[0], head[1], 0, head[0], head[1], 26); gl.addColorStop(0, rgba(S.dark ? '#ffffff' : '#2F37FF', .35)); gl.addColorStop(1, 'rgba(47,55,255,0)'); c.fillStyle = gl; c.beginPath(); c.arc(head[0], head[1], 26, 0, 7); c.fill(); } }
    if (ph === 'refract' || (ph === 'drop' && u < .3)) { const k = ph === 'refract' ? u : 1 + u; const rr = 10 + k * 26 * S.cam.z; c.strokeStyle = rgba(AG[f.via].c, clamp(1.4 - k, 0, 1)); c.lineWidth = 2; c.beginPath(); c.arc(g.pc[0], g.pc[1], R0(rr), 0, 7); c.stroke(); }
    if (!g.T) { if (ph === 'land' || ph === 'fade') { const rr = 8 + u * 30; c.strokeStyle = rgba(AG[f.via].c, (1 - u) * fade); c.lineWidth = 1.5; c.beginPath(); c.arc(g.pc[0], g.pc[1], rr, 0, 7); c.stroke(); } return; }
    if (ph === 'beam' || ph === 'refract') return;
    // dispersed fan: exit → mirror rail → precise drop on the track
    const du = ph === 'drop' ? E.io(u) : 1, n = S.lowSpec ? 4 : 7, ux = g.M[0] - g.Pex[0], uy = g.M[1] - g.Pex[1], ul = Math.hypot(ux, uy) || 1, nx = -uy / ul, ny = ux / ul;
    c.globalCompositeOperation = S.dark ? 'lighter' : 'source-over';
    for (let k = 0; k < n; k++) { const o = (k - (n - 1) / 2), col = specAt(k / (n - 1)), sp = o * 2.2, sm = o * 5.2;
      const pts = [[g.Pex[0] + nx * sp * .3, g.Pex[1] + ny * sp * .3], [g.M[0] + sm, g.M[1]], [g.T[0], g.T[1]]], vis = polyAt(pts, du);
      if (!S.lowSpec) { c.strokeStyle = rgba(col, .09 * fade); c.lineWidth = 4; strokePoly(c, vis); } c.strokeStyle = rgba(col, .95 * fade); c.lineWidth = 1.1; strokePoly(c, vis); }
    c.globalCompositeOperation = 'source-over';
    const hp = polyAt([g.Pex, g.M, g.T], du), hd = hp[hp.length - 1];
    // mirror rail glint + landing time readout (sits on the ruler band, above the track labels)
    if (du > .55) { c.strokeStyle = S.dark ? '#EDECE6' : '#111'; c.lineWidth = 2; c.beginPath(); c.moveTo(g.M[0] - 7, g.M[1] + 7); c.lineTo(g.M[0] + 7, g.M[1] - 7); c.stroke();
    }
    if (ph === 'drop') { if (!S.lowSpec) { const gl = c.createRadialGradient(hd[0], hd[1], 0, hd[0], hd[1], 22); gl.addColorStop(0, rgba(f.col, .7)); gl.addColorStop(1, rgba(f.col, 0)); c.fillStyle = gl; c.beginPath(); c.arc(hd[0], hd[1], 22, 0, 7); c.fill(); }
      c.fillStyle = S.dark ? '#fff' : '#111'; c.beginPath(); c.arc(hd[0], hd[1], 2.6, 0, 7); c.fill(); }
    if (ph === 'land' || ph === 'fade') { const k = ph === 'land' ? u : 1; focusRing(c, g.T[0], g.T[1], 26 * (1 - E.o(k)) + 7, k, null, tlRect);
      if (ph === 'land') { c.fillStyle = `rgba(255,255,255,${(1 - u) * .9})`; c.beginPath(); c.arc(g.T[0], g.T[1], 10 + u * 20, 0, 7); c.fill(); } } });
  // camera focus ring (follow / macro / user focus)
  if ((cm.mode !== 'overview' || cm.user) && cm.focus && !S.flights.some(f => f.phase === 'land')) { const p = focusPoint(); if (p) { const pv = [p[0] + stageRect.left, p[1] + stageRect.top];
    if (pv[0] > stageRect.left && pv[0] < stageRect.right && pv[1] > stageRect.top && pv[1] < stageRect.bottom) { c.save(); c.beginPath(); c.rect(stageRect.left, stageRect.top, stageRect.width, stageRect.height); c.clip();
      const rr = cm.focus === 'vf' ? 60 : PR * cm.z * 1.25 + 8; focusRing(c, pv[0], pv[1], rr, cm.lock, (cm.lock > .85 ? 'AF LOCK · ' : 'AF · ') + (cm.z / cm.fit).toFixed(1) + '× · ' + (cm.focus === 'vf' ? '取景器' : AG[cm.focus] ? AG[cm.focus].name : ''), stageRect); c.restore(); } } }
  S.sparks.forEach(p => { c.fillStyle = rgba(p.col, clamp(p.life, 0, 1)); c.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); });
}
function focusPoint() { const f = S.cam.focus; if (!f) return null; if (f === 'vf') return w2s(WORLD.cx, WORLD.cy); if (AG[f]) return w2s(AG[f].x, AG[f].y); return null; }
// completion: all 8 coloured beams converge into white light, the viewfinder is exposed, the iris opens on the real MP4
function drawFinale(c, now) { const f = S.finale, t = f.t, vfc = w2v(WORLD.cx, WORLD.cy), z = S.cam.z;
  c.save(); c.beginPath(); c.rect(stageRect.left, stageRect.top, stageRect.width, stageRect.height); c.clip();
  const dim = t < 2.6 ? E.o(clamp(t / .8, 0, 1)) : 1 - clamp((t - 2.6) / 1.4, 0, 1);
  if (dim > 0) { c.fillStyle = `rgba(14,14,16,${.42 * dim})`; c.fillRect(stageRect.left, stageRect.top, stageRect.width, stageRect.height); }
  if (t < 2.4) { const u = E.io(clamp(t / 1.5, 0, 1)), a = t < 2 ? 1 : 1 - (t - 2) / .4;
    c.globalCompositeOperation = 'lighter';
    AGENTS.forEach(ag => { if (S.ag[ag.id].st === 'skip') return; const p = w2v(ag.x, ag.y), hx = lerp(p[0], vfc[0], u), hy = lerp(p[1], vfc[1], u);
      if (!S.lowSpec) { c.strokeStyle = rgba(ag.c, .2 * a); c.lineWidth = 10; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(hx, hy); c.stroke(); }
      c.strokeStyle = rgba(ag.c, .95 * a); c.lineWidth = 2; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(hx, hy); c.stroke();
      c.fillStyle = rgba('#ffffff', a); c.beginPath(); c.arc(hx, hy, 3, 0, 7); c.fill(); });
    c.globalCompositeOperation = 'source-over'; }
  if (t > 1.2 && t < 3.4) { const k = t < 2 ? E.o((t - 1.2) / .8) : 1 - clamp((t - 2.2) / 1.2, 0, 1), R = R0(30 + 170 * k * z);
    if (R > 1) { const g = c.createRadialGradient(vfc[0], vfc[1], 0, vfc[0], vfc[1], R); g.addColorStop(0, `rgba(255,255,255,${k})`); g.addColorStop(.55, `rgba(255,255,255,${.75 * k})`);
      SPECTRUM.forEach((col, i) => g.addColorStop(.62 + i * .045, rgba(col, .45 * k))); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.beginPath(); c.arc(vfc[0], vfc[1], R, 0, 7); c.fill(); } }
  if (t > 2.6 && t < 4.2) { const u = (t - 2.6) / 1.6; for (let i = 0; i < 16; i++) { const an = i / 16 * 6.283, r0 = 80 * z + u * 260 * z, r1 = r0 + 40 * z; c.strokeStyle = rgba(SPECTRUM[i % 8], (1 - u) * .8); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(vfc[0] + Math.cos(an) * r0, vfc[1] + Math.sin(an) * r0 * .6); c.lineTo(vfc[0] + Math.cos(an) * r1, vfc[1] + Math.sin(an) * r1 * .6); c.stroke(); } }
  c.restore(); }
