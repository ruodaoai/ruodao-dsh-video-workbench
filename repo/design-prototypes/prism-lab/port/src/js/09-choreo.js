/* ================= 9 · CHOREOGRAPHY (WarRoomState transitions → visuals · never fakes business progress) ================= */
let PREV = null, firstState = true;
const celebrated = new Set(), finishedEv = new Set();
const flown = new Set();
const agentOf = (W, id) => (W && W.agents.find(a => a.id === id)) || {id, status:'idle', progress:0, message:''};
// visual completeness of one pipeline stage: 1 = show what exists; while a run is live it follows the real agent progress
function stageP(W, id) { const r = W.run; if (!r || !LIVE(r.status)) return 1; const a = agentOf(W, id);
  if (a.status === 'done' || a.status === 'skipped') return 1; if (a.status === 'queued' || a.status === 'idle') return 0; return pct01(a.progress); }
function revTargets(W) { const d = stageP(W, 'director'), e = stageP(W, 'editor'), au = stageP(W, 'audio'), mo = stageP(W, 'motion');
  return {grid:d, ghost:d, sub:d, full:e, vo:au, bgm:au, beats:au, sfx:au, lit:mo}; }
const DEF_TASK = {idle:'待命', queued:'排队中 · 等待光路', running:'运行中…', paused:'已暂停', done:'已完成', failed:'执行失败', stopped:'已停止', skipped:'本次未参与'};
function snapVisuals() { // jump straight to the target picture (first state, project switch) — no fake build-up
  S.revT = revTargets(M); Object.assign(S.rev, S.revT); S.snap = true; S.flights = []; S.queue = []; S.sparks = []; S.pulses = []; S.tl.target = null;
  S.film.boardN = SCENES.length * S.rev.ghost; S.film.renderP = S.ag.qa.p; S.tl.ph = clamp(S.film.t, 0, PROJ.dur); }
function onModel(W, P, projChanged) {
  const r = W.run, pr = P && P.run, newRun = !!r && (!pr || pr.id !== r.id), R = S.run;
  R.on = !!r; R.live = !!r && LIVE(r.status); R.status = r ? r.status : ''; R.id = r ? r.id : ''; R.active = r ? r.activeAgentId : null;
  R.msg = r ? r.message : ''; R.err = r ? r.error : ''; R.showDone = !!r && (r.status === 'completed' || R.live);
  if (r) { if (newRun || R.elRaw !== r.elapsedSec) { R.el = r.elapsedSec; R.elRaw = r.elapsedSec; R.elAt = performance.now(); } R.pT = r.progress; } else { R.el = 0; R.elRaw = -1; R.pT = 0; }
  W.agents.forEach(a => { const st = S.ag[a.id]; st.st = ST_MAP[a.status] || 'idle'; st.task = a.message || DEF_TASK[a.status] || '待命'; st.p = a.status === 'done' ? 1 : pct01(a.progress); st.raw = a.status; });
  S.revT = revTargets(W);
  if (r && !LIVE(r.status) && (firstState || projChanged) && !(r.status === 'completed' && finishedEv.has(r.id))) celebrated.add(r.id);
  if (firstState || projChanged) { if (projChanged) { flown.clear(); S.finale = null; hideBanner(); S.used.clear(); S.film.t = 0; S.film.play = false; selScene = ''; tlSetWindow(0, PROJ.dur, false); S.tl.v0 = S.tl.t0; S.tl.v1 = S.tl.t1; }
    snapVisuals(); if (R.live && !S.cam.manual) setCam('follow', true); else if (!S.cam.manual) setCam('overview', true);
    if (r && r.status === 'completed' && !celebrated.has(r.id)) { celebrated.add(r.id); runCompleted(); } return; }
  const ps = pr ? pr.status : '', ns = r ? r.status : '';
  if (r && LIVE(ns) && (newRun || !LIVE(ps))) runLaunch(newRun);
  if (r && ns === 'completed' && !celebrated.has(r.id) && ((!newRun && LIVE(ps)) || (newRun && finishedEv.has(r.id)))) { celebrated.add(r.id); runCompleted(); }
  if (r && ns === 'failed' && (newRun || ps !== 'failed')) runFailed();
  if (r && ns === 'stopped' && (newRun || ps !== 'stopped')) runStopped();
  if (r && LIVE(ns) && pr && !newRun && pr.activeAgentId !== r.activeAgentId && r.activeAgentId) handoff(pr.activeAgentId, r.activeAgentId);
  W.agents.forEach(a => { const pa = P && P.agents.find(x => x.id === a.id); if (pa && pa.status !== a.status) agentTransition(a, pa); });
  if (P && W.staging.length && !P.staging.length) { emitPulse('cloud', 'editor', AG.cloud.c, 1); S.ag.cloud.glow = 1; const p = w2v(AG.cloud.x, AG.cloud.y); sparkBurst(p[0], p[1], h2r(AG.cloud.c), 10); }
  ensureFlights();
}
function runLaunch(newRun) {
  S.finale = null; hideBanner(); pausePreview(); S.film.asset = null; S.queue = []; S.film.codeT = 0;
  if (newRun) { S.used.clear(); $$('.card.used').forEach(c => c.classList.remove('used')); }
  emitPulse('src', 'director', '#111111', .9, {white:true}); S.ag.director.glow = Math.max(S.ag.director.glow, .5);
  S.cam.manual = false; S.cam.user = null; closeAgentCard(); setCam('follow', true); S.tl.manual = false; }
function runCompleted() { S.finale = {t:0, flash:0, iris:0, started:false}; AGENTS.forEach(a => { if (S.ag[a.id].st !== 'skip') S.ag[a.id].glow = 1; }); S.queue = []; }
function runFailed() { S.cam.shake = 1; const id = S.run.active; if (id && S.ag[id]) { S.ag[id].flash = 1; S.ag[id].glow = 1; } S.queue = []; }
function runStopped() { S.queue = []; S.flights.forEach(f => f.card && f.card.classList.remove('scan')); S.flights = []; S.tl.target = null; if (!S.cam.manual) setCam('overview', true); }
function handoff(a, b) { if (AG[a] && AG[b]) emitPulse(a, b, AG[a].c, 1, {w:1.6}); if (S.ag[b]) S.ag[b].glow = Math.max(S.ag[b].glow, .6); flashLabel(b); S.film.asset = null; }
function agentTransition(a, pa) { const st = S.ag[a.id], el = AG[a.id];
  if (a.status === 'done') { const p = w2v(el.x, el.y); sparkBurst(p[0], p[1], h2r(el.c), 8); edgeFlash(a.id);
    const ni = CORE.indexOf(a.id); if (ni >= 0 && ni < CORE.length - 1) emitPulse(a.id, CORE[ni + 1], el.c, .9); }
  if (a.status === 'failed') { st.flash = 1; S.cam.shake = Math.max(S.cam.shake, .8); }
  if (a.status === 'running' && (a.id === 'director' || a.id === 'editor')) emitPulse('src', a.id, '#111111', .8, {white:true}); }
// light-beam flights: editor → each asset that scenes reference flies to its first scene on V1; audio → music/voice tracks
function shotTarget(A) { const sc = A.used.filter(i => SCENES[i]); if (!sc.length) return null; const first = SCENES[sc[0]];
  return {track:'shot', t0:first.start, t1:first.end, sc:sc.slice(0, 12), label:'V1 ' + sceneRange(sc)}; }
function audioTarget(A) { if (A.kind === 'music') { const m = MUSIC[0]; return {track:'bgm', t0:m ? m.s0 : 0, t1:m ? m.s1 : PROJ.dur, sc:[], label:'A3 配乐'}; }
  if (A.kind === 'voice') return {track:'vo', t0:0, t1:PROJ.dur, sc:[], label:'A1 配音'}; return null; }
function ensureFlights() { const R = S.run; if (!R.live || R.status !== 'running' || !R.id) return;
  const ed = agentOf(M, 'editor'), au = agentOf(M, 'audio');
  if (ed.status === 'running' && !flown.has(R.id + ':editor')) { flown.add(R.id + ':editor');
    ASSETS.filter(A => A.used.length).sort((a, b) => a.used[0] - b.used[0]).slice(0, 10).forEach(A => { const t = shotTarget(A); if (t) S.queue.push({asset:A, via:'editor', tgt:t}); }); }
  if (au.status === 'running' && !flown.has(R.id + ':audio')) { flown.add(R.id + ':audio');
    ['music', 'voice'].forEach(k => { const A = ASSETS.find(x => x.kind === k); if (A) S.queue.push({asset:A, via:'audio', tgt:audioTarget(A)}); }); } }
function stepQueue(dt) { if (!S.queue.length) return; S.queue = S.queue.filter(q => agentOf(M, q.via).status === 'running'); if (!S.queue.length) return; if (!S.run.live || S.run.status !== 'running') return; S.qT -= dt; if (S.qT > 0) return;
  if (S.flights.filter(f => f.phase !== 'done').length >= 2) return; const q = S.queue.shift(); S.qT = S.lowSpec ? 1.4 : .9;
  const A = ASSETS.find(x => x.id === q.asset.id); if (A) launchFlight(A, q.via, q.tgt); }
function stepReveal(dt) { const T = S.revT; if (!T) return;
  for (const k in T) { const cur = S.rev[k] == null ? 1 : S.rev[k], tg = T[k]; if (S.snap) { S.rev[k] = tg; continue; } const rate = tg < cur ? 1.6 : .9;
    S.rev[k] = Math.abs(tg - cur) < 1e-3 ? tg : cur + clamp(tg - cur, -rate * dt, rate * dt); } }
function stepShots(dt) { const N = SCENES.length, live = S.run.live;
  for (let i = 0; i < N; i++) { const sh = S.shots[i], u = (i + .5) / N;
    const landing = sh.st === 'land' && S.flights.some(f => f.phase === 'land' && f.tgt && f.tgt.track === 'shot' && f.tgt.sc.includes(i));
    if (u <= S.rev.full + 1e-6) { if (sh.st === 'none' || sh.st === 'ghost') { sh.st = S.snap ? 'full' : 'land'; sh.land = S.snap ? 1 : 0; } }
    else if (u <= S.rev.ghost + 1e-6) { if (sh.st !== 'ghost' && !landing) { sh.st = 'ghost'; sh.land = 0; sh.lit = 0; sh.done = false; } }
    else if (sh.st !== 'none' && !landing) { sh.st = 'none'; sh.land = 0; sh.lit = 0; sh.done = false; }
    if (sh.st === 'land' && !landing) { sh.land = Math.min(1, sh.land + dt * 3.2); if (sh.land >= 1) sh.st = 'full'; }
    if (sh.st === 'full' || sh.st === 'land') { if (u <= S.rev.lit + 1e-6) { if (!sh.done) { if (S.snap || !live) { sh.done = true; sh.lit = 0; } else { sh.lit = Math.min(1, sh.lit + dt * 2.2); if (sh.lit >= 1) { sh.done = true; sh.lit = 0; } } } }
      else if (sh.done || sh.lit) { sh.done = false; sh.lit = 0; } } } }
function stepSfx(dt) { const lim = S.rev.sfx * (PROJ.dur || 1); let n = 0;
  for (let i = 0; i < SFX.length; i++) { let v = S.sfxDrop[i] == null ? 1 : S.sfxDrop[i];
    if (SFX[i].t <= lim + 1e-6) { v = S.snap ? 1 : Math.min(1, v + dt / .45); n++; } else v = S.snap ? 0 : Math.max(0, v - dt * 3); S.sfxDrop[i] = v; } S.film.sfxN = n; }
function vfModeFor() { const R = S.run;
  if (S.finale && !S.finale.started) return S.film.mode === 'render' ? 'render' : 'film';
  if (R.live) { const a = R.active; if (R.status === 'queued' && !a) return 'board';
    if (a === 'director') return 'board'; if (a === 'editor') return S.film.asset && S.t - (S.film.assetT || 0) < 6 ? 'asset' : 'film';
    if (a === 'audio') return 'scope'; if (a === 'motion') return 'code'; if (a === 'qa') return 'render'; return 'film'; }
  if (R.status === 'failed' && R.active === 'motion') return 'code';
  return 'film'; }
// per-frame update of everything that is derived from the real state
function stepChoreo(dt) {
  const R = S.run, running = R.live && R.status === 'running', dur = PROJ.dur || 1;
  stepReveal(dt); stepShots(dt); stepSfx(dt); stepQueue(dt);
  const pT = isFinite(R.pT) ? R.pT : 0; R.p = !isFinite(R.p) ? pT : R.p + (pT - R.p) * (1 - Math.exp(-dt * 4));
  const mode = vfModeFor(); if (mode !== S.film.mode) { S.film.mode = mode; if (mode === 'asset') S.film.assetP = 0; }
  S.film.err = R.status === 'failed' && R.active === 'motion';
  S.film.boardN += (SCENES.length * S.rev.ghost - S.film.boardN) * (1 - Math.exp(-dt * 6));
  const qa = S.ag.qa, rT = qa.raw === 'done' ? 1 : qa.raw === 'running' || qa.raw === 'paused' || qa.raw === 'failed' || qa.raw === 'stopped' ? qa.p : (R.live ? 0 : 1);
  S.film.renderP += (rT - S.film.renderP) * (1 - Math.exp(-dt * 5));
  S.film.scopeT = S.rev.vo * dur; if (S.film.mode === 'asset') S.film.assetP = Math.min(1, (S.film.assetP || 0) + dt * 1.2);
  if (running && R.active === 'motion') S.film.codeT += dt;
  // work cursor: the playhead tracks what the active agent is producing (real progress); otherwise it is the preview position
  if (R.live) { const a = R.active, tgt = a === 'director' ? S.rev.ghost * dur : a === 'editor' ? (S.tl.target && S.tl.target.track === 'shot' ? S.tl.target.t0 : S.rev.full * dur)
      : a === 'audio' ? S.rev.vo * dur : a === 'motion' ? S.rev.lit * dur : a === 'qa' ? S.film.renderP * dur : a === 'avatar' ? S.ag.avatar.p * dur : null;
    if (tgt != null) { S.tl.ph += (clamp(tgt, 0, dur) - S.tl.ph) * (1 - Math.exp(-dt * 6)); if (S.film.mode !== 'film' || !S.film.play) S.film.t = S.tl.ph; } }
  // ambient collaboration pulses around the active element (only while really running)
  S.pulseT -= dt; if (S.pulseT <= 0) { S.pulseT = (S.lowSpec ? 1.8 : .9) + Math.random() * .5;
    if (running && R.active && AG[R.active] && !S.reduce) { const id = R.active, nb = EDGES.filter(e => (e.a === id || e.b === id) && e.a !== 'src'), e = nb[Math.floor(Math.random() * nb.length)];
      if (e) emitPulse(id, e.a === id ? e.b : e.a, AG[id].c, .9); if ((id === 'director' || id === 'editor') && Math.random() < .55) emitPulse('src', id, '#111111', .8, {white:true}); }
    if (running && agentOf(M, 'cloud').status === 'running') emitPulse('cloud', 'editor', AG.cloud.c, .9); }
  // finale: white-light convergence → exposure → iris opens on the real MP4
  if (S.finale) { const f = S.finale; f.t += dt; f.flash = f.t < 1.7 ? 0 : f.t < 2.2 ? E.o((f.t - 1.7) / .5) : f.t < 3.4 ? 1 - (f.t - 2.2) / 1.2 : 0;
    f.iris = f.t < 2.1 ? 0 : f.t < 2.35 ? E.i((f.t - 2.1) / .25) : f.t < 2.75 ? 1 - E.o((f.t - 2.35) / .4) : 0;
    if (f.t >= 2.35 && !f.started) { f.started = true; S.film.mode = 'film'; S.film.t = 0; S.tl.ph = 0; showBanner(); playPreview(true); }
    if (f.t > 6.5) { S.finale = null; if (!S.cam.manual) setCam('overview', true); } }
  S.snap = false;
}
