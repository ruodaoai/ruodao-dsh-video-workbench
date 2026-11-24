/* ================= 13 · CAMERA MODES · SHORTCUTS · RENDER LOOP ================= */
function setCam(mode, auto) { if (!['overview', 'follow', 'close'].includes(mode)) mode = 'overview'; S.cam.mode = mode; if (!auto) { S.cam.user = null; closeAgentCard(); }
  $$('#camSeg button').forEach(b => { const on = b.dataset.cam === mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  if (mode === 'overview' && !S.tl.manual) tlSetWindow(0, PROJ.dur, false); redrawSoon(); }
function toggleTheme() { S.dark = !S.dark; LS.set('dark', S.dark ? '1' : '0'); applyTheme(); toast(S.dark ? '熄灯 · 暗场模式（光束改为加色发光）' : '开灯 · 实验室明场模式', 'info'); }
function applyTheme() { document.body.classList.toggle('dark', S.dark); qs($('#themeBtn'), 'use').setAttribute('href', S.dark ? '#i-bulb' : '#i-moon'); $('#themeBtn').classList.toggle('on', S.dark); $('#themeBtn').setAttribute('aria-pressed', S.dark); redrawSoon(); layoutTrackLabels(); }
const zooms = () => { const d = PROJ.dur || 60; return [d, d / 2, d / 4, d / 8, d / 16].map(z => Math.max(minSpan(), z)); };
function nearestZoom() { const span = S.tl.t1 - S.tl.t0, Z = zooms(); let best = 0; Z.forEach((z, i) => { if (Math.abs(Math.log(z / span)) < Math.abs(Math.log(Z[best] / span))) best = i; }); return best; }
function syncZoomTick() { const el = $('#tlZoom'); if (el._set) el._set(nearestZoom(), false); }
function zoomTo(i) { const Z = zooms(), span = Z[clamp(i, 0, Z.length - 1)], c = S.tl.ph; tlSetWindow(c - span * .35, c - span * .35 + span, i > 0); syncZoomTick(); }
const typing = e => { const t = e.target; return !!(t && t.closest && t.closest('input,textarea,select,[contenteditable="true"]')); };
function bindUI() {
  $('#tlFit').onclick = () => { tlSetWindow(0, PROJ.dur, false); syncZoomTick(); };
  makeTick($('#tlZoom'), ['', '', '', '', ''], 0, i => zoomTo(i), true);
  // stage: click a prism = focus it; click the finder = play / pause preview; click empty bench = back to overview
  const hitAgent = (mx, my) => AGENTS.find(a => { const p = w2s(a.x, a.y); return Math.hypot(p[0] - mx, p[1] - my) < PR * S.cam.z * 1.2 + 6; });
  D.stage.addEventListener('click', e => { if (e.target !== D.sc) return; const r = D.sc.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, hit = hitAgent(mx, my);
    if (hit) { focusAgent(hit.id); return; } const v = vfRect(), p0 = w2s(v.x, v.y), p1 = w2s(v.x + v.w, v.y + v.h);
    if (mx > p0[0] && mx < p1[0] && my > p0[1] && my < p1[1]) { if (!S.run.live && PROJ.has) togglePreview(); } else if (S.cam.user) focusAgent(S.cam.user); });
  // double-click the finder = watch the finished film full-window
  D.stage.addEventListener('dblclick', e => { if (e.target !== D.sc || !pvUrl) return; const r = D.sc.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, v = vfRect(), p0 = w2s(v.x, v.y), p1 = w2s(v.x + v.w, v.y + v.h);
    if (mx > p0[0] && mx < p1[0] && my > p0[1] && my < p1[1]) openCinema(); });
  D.stage.addEventListener('mousemove', e => { if (e.target !== D.sc) return; const r = D.sc.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; const v = vfRect(), p0 = w2s(v.x, v.y), p1 = w2s(v.x + v.w, v.y + v.h);
    D.sc.style.cursor = hitAgent(mx, my) || (!S.run.live && PROJ.has && mx > p0[0] && mx < p1[0] && my > p0[1] && my < p1[1]) ? 'pointer' : 'default'; });
  document.addEventListener('click', e => { if (!e.target.closest('#menu') && !e.target.closest('#toolsBtn,#projBtn,#skinBtn,#fSel')) closeMenu(); });
  $('#scrim').onclick = () => closeAll();
  window.addEventListener('keydown', e => { const k = e.key;
    if (kitOpen()) return; // a native kit panel / popover is open: it owns the keyboard (Esc closes it there)
    if (k === 'Escape') { if (anyOpen()) { closeAll(); return; } if (typing(e)) { e.target.blur(); return; }
      if (S.cam.user) { S.cam.user = null; closeAgentCard(); } else { S.cam.manual = true; setCam('overview'); } return; }
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === ' ' || k === 'Spacebar') { if (e.target.closest && e.target.closest('button,[role="button"],[role="slider"]')) return; e.preventDefault(); togglePreview(); }
    else if (k === 'r' || k === 'R') runOrResume();
    else if (k === '1' || k === '2' || k === '3') { S.cam.manual = true; setCam(['overview', 'follow', 'close'][+k - 1]); }
    else if (k === 'p' || k === 'P') { sheetOpen() ? closeAll() : openSheet(); }
    else if (k === 'n' || k === 'N') toggleTheme(); else if (k === 'g' || k === 'G') openContactSheet(); else if (k === 'v' || k === 'V') openCinema(); else if (k === 't' || k === 'T') openTools();
    else if (k === '[') zoomTo(nearestZoom() - 1); else if (k === ']') zoomTo(nearestZoom() + 1); else if (k === 'f' || k === 'F') { tlSetWindow(0, PROJ.dur, false); syncZoomTick(); }
    else if (k === '?') openKeys(); });
  let rz = 0; window.addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { layout(); fitTopbar(); fitCapsule(); renderRack(); $('#agentCard')._sig = ''; if (sheetOpen()) openSheet(); if ($('#menu').classList.contains('open')) closeMenu(); placeBanner(); renderTopics(); [D.rackList, $('#stList'), D.log].forEach(clipLater); }); });
  window.addEventListener('pagehide', () => { try { flushDir(); } catch (e) {} }); // never lose a pending edit when the host swaps the iframe
  document.addEventListener('visibilitychange', () => { S.hidden = document.hidden; if (S.hidden) { if (rafId) cancelAnimationFrame(rafId); rafId = 0; } else { last = performance.now(); kick(); } });
}
let uiN = 0, lastBeatClock = 0, uiT = 0, slowT = 0, last = performance.now(), lastDraw = 0, fpsE = 60, avgInt = 1 / 60, tick = 0, stillDrawn = false, frameErr = 0;
function beatCross(a, b) { if (b < a || !BEATS.length) return; for (const bt of BEATS) { if (bt.t > a && bt.t <= b) { if (bt.s) S.tl.pulse = 1; if (PROJ.drops.some(d => Math.abs(d - bt.t) < .05)) { S.tl.pulse = 1.6; S.tl.drop = 1; } } if (bt.t > b) break; } }
function simStep(dt) {
  const frozen = S.run.status === 'paused'; S.t += frozen ? 0 : dt;
  stepChoreo(dt); if (!frozen) updateFlights(dt);
  if (!frozen) { S.pulses.forEach(p => p.t += dt); S.pulses = S.pulses.filter(p => p.t < p.dur); for (const k in edgeAct) edgeAct[k] = Math.max(0, edgeAct[k] - dt * .9); }
  AGENTS.forEach(a => { const st = S.ag[a.id], want = st.st === 'run' || st.st === 'err' ? 1 : st.st === 'pause' ? .45 : (S.finale && S.finale.t < 2.6 && st.st !== 'skip') ? 1 : 0;
    st.glow += (want - st.glow) * (1 - Math.exp(-dt * 4)); if (st.flash > 0) st.flash = Math.max(0, st.flash - dt * .8); });
  stepFilm(dt);
  if (S.run.live && !frozen && !S.film.play) { const bc = Math.floor(S.t * (PROJ.bpm || 90) / 60 / 4); if (bc !== lastBeatClock) { lastBeatClock = bc; S.tl.pulse = Math.max(S.tl.pulse, .6); } }
  S.tl.pulse = Math.max(0, S.tl.pulse - dt * 2.6); S.tl.drop = Math.max(0, S.tl.drop - dt * 2);
}
function timelineFollow() { // the follow camera also steers the spectral timeline window
  if (S.tl.manual || S.tl.drag) return; const dur = PROJ.dur || 1, fl = S.flights.find(f => f.phase !== 'done' && f.tgt), follow = S.cam.mode !== 'overview';
  if (fl && follow) return;
  const a = S.run.active;
  if (follow && S.run.live && !fl && (a === 'audio' || a === 'motion' || a === 'qa' || a === 'director') && dur > 70) { const span = Math.min(60, dur), c = S.tl.ph;
    if (S.tl.t1 - S.tl.t0 > span + 1 || c < S.tl.t0 + span * .15 || c > S.tl.t0 + span * .85) tlSetWindow(c - span * .4, c + span * .6, false); }
  else if (!fl && (Math.abs(S.tl.t0) > 1e-3 || Math.abs(S.tl.t1 - dur) > 1e-3)) tlSetWindow(0, dur, false); }
let rafId = 0; function loop(nowMs) { rafId = 0; if (S.halt || S.hidden) return; frame(nowMs); rafId = requestAnimationFrame(loop); }
function kick() { if (rafId) cancelAnimationFrame(rafId); rafId = requestAnimationFrame(loop); }
function frame(nowMs) {
  try {
    const real = Math.max(0, (nowMs - last) / 1000);
    if (S.lowSpec && nowMs - lastDraw < 32) return; // ≤ 30 fps under low-spec protection
    lastDraw = nowMs; last = nowMs; const raw = Math.min(.05, real); fpsE = fpsE * .93 + (1 / Math.max(real, .001)) * .07; window.__fps = Math.round(clamp(fpsE, 0, 240));
    const dt = S.freeze ? 0 : Math.min(real, .5); let rem = dt; while (rem > 1e-6) { const h = Math.min(rem, 1 / 30); simStep(h); rem -= h; }
    updateCamera(raw); timelineFollow(); stepRackScroll(raw);
    const k = 1 - Math.exp(-raw * 5); if (!S.tl.drag) { S.tl.v0 += (S.tl.t0 - S.tl.v0) * k; S.tl.v1 += (S.tl.t1 - S.tl.v1) * k; }
    avgInt = avgInt * .95 + Math.min(real, .25) * .05; if (S.quality === 'high' || S.lowSpec) S.eco = false; else if (!S.eco && avgInt > .045) S.eco = true; else if (S.eco && avgInt < .024) S.eco = false; tick++;
    if (!canDraw()) return;
    const cm = S.cam, now = S.t, settled = Math.abs(cm.tx - cm.x) * cm.z < .05 && Math.abs(cm.ty - cm.y) * cm.z < .05 && Math.abs(Math.log(cm.tz / cm.z)) < .0005 && Math.abs(S.tl.t0 - S.tl.v0) < .01 && Math.abs(S.tl.t1 - S.tl.v1) < .01;
    const glowing = AGENTS.some(a => S.ag[a.id].glow > .01 || S.ag[a.id].flash > 0), revving = S.revT && Object.keys(S.revT).some(q => Math.abs(S.revT[q] - S.rev[q]) > 1e-3) || S.shots.some(s => s.st === 'land' || s.lit > 0);
    const busy = S.run.live || S.film.play || S.flights.length || S.pulses.length || S.sparks.length || S.finale || glowing || revving || S.tl.pulse > .01 || S.cam.shake > 0 || cm.lock < 1 && cm.mode !== 'overview';
    const still = !busy && settled && !S.rackScroll && !redrawFlag && !S.modalTick;
    if (still && stillDrawn) { if (++slowT % 15 === 0) { updateVfCtl(); updateLabels(); } } else {
      stillDrawn = still; redrawFlag = false;
      const fp = focusPoint(), dofK = (!S.reduce && !S.eco && !S.lowSpec && fp) ? clamp(cm.dof / 6, 0, 1) : 0, c = SC.c;
      screenTf(c); c.clearRect(0, 0, stageW, stageH);
      if (dofK > .03) { const o = dofBuf(); screenTf(o.c); o.c.clearRect(0, 0, stageW, stageH); worldTf(o.c); drawBench(o.c, now); screenTf(o.c); composeDof(c, o, fp, dofK); }
      else { worldTf(c); drawBench(c, now); screenTf(c); }
      if (S.tl.drop > 0) { c.fillStyle = `rgba(255,90,31,${S.tl.drop * .06})`; c.fillRect(0, 0, stageW, stageH); }
      drawTimeline(now); drawFX(now); updateVfCtl(); updateLabels(); }
    D.tl.style.boxShadow = S.tl.pulse > .02 && !S.lowSpec ? `var(--shadow),0 0 0 ${(S.tl.pulse * 2).toFixed(2)}px rgba(47,55,255,${(S.tl.pulse * .22).toFixed(3)})` : '';
    if (S.modalTick) S.modalTick(now, dt);
    uiT -= raw; if (uiT <= 0) { uiT = .1; syncRunUI(); updateCorners(); renderAgentCard(); setTx('tcNow', tcode(S.tl.ph)); if (++uiN % 3 === 0) { placeBanner(); layoutCorners(); LISTS().forEach(clipLater); } }
  } catch (err) { if (!frameErr++) console.warn('[prism-lab] frame error (continuing):', err); }
}
/* canvas depth-of-field: downsample blur + complementary radial masks (no CSS backdrop/mask) */
let DB = null;
function dofBuf() { const W = D.sc.width, H = D.sc.height, d = SC.d; if (!DB || DB.W !== W || DB.H !== H) { const mk = (w, h) => { const cv = document.createElement('canvas'); cv.width = Math.max(1, w); cv.height = Math.max(1, h); return {cv, c:cv.getContext('2d')}; };
    DB = {W, H, d, off:mk(W, H), s1:mk(Math.ceil(W / 4), Math.ceil(H / 4)), s2:mk(Math.ceil(W / 10), Math.ceil(H / 10))}; }
  DB.off.c.setTransform(d, 0, 0, d, 0, 0); DB.c = DB.off.c; return DB; }
function composeDof(c, o, fp, k) { // blurred plate (1/10 res, bilinear) + sharp layer revealed through feathered focus ellipses
  const W = o.W, H = o.H, d = o.d, cm = S.cam, r = vfRect(), vf = cm.focus === 'vf';
  const rx = R0((vf ? r.w * cm.z * .62 : PR * cm.z * 2.4) * d), ry = R0((vf ? r.h * cm.z * .7 : PR * cm.z * 2.1) * d), cx = fp[0] * d, cy = fp[1] * d;
  o.s1.c.setTransform(1, 0, 0, 1, 0, 0); o.s1.c.clearRect(0, 0, o.s1.cv.width, o.s1.cv.height); o.s1.c.drawImage(o.off.cv, 0, 0, o.s1.cv.width, o.s1.cv.height);
  o.s2.c.setTransform(1, 0, 0, 1, 0, 0); o.s2.c.clearRect(0, 0, o.s2.cv.width, o.s2.cv.height); o.s2.c.drawImage(o.s1.cv, 0, 0, o.s2.cv.width, o.s2.cv.height);
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'low';
  if (k < .999) { c.globalAlpha = 1 - k; c.drawImage(o.off.cv, 0, 0); }
  c.globalAlpha = k; c.drawImage(o.s2.cv, 0, 0, W, H); c.globalAlpha = 1;
  const ring = (s, a) => { if (rx * s < 1 || ry * s < 1) return; c.save(); c.beginPath(); c.ellipse(cx, cy, rx * s, ry * s, 0, 0, 7); c.clip(); if (a >= 1) c.clearRect(0, 0, W, H); c.globalAlpha = a; c.drawImage(o.off.cv, 0, 0); c.restore(); };
  ring(1.45, .35 * k); ring(1.18, .55); ring(.92, 1);
  c.restore(); }
function snapView() { updateCamera(10); timelineFollow(); S.tl.v0 = S.tl.t0; S.tl.v1 = S.tl.t1; stillDrawn = false; redrawSoon(); }
