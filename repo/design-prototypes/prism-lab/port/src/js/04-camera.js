/* ================= 4 · CAMERA ================= */
const w2s = (x, y) => [(x - S.cam.x) * S.cam.z + stageW / 2, (y - S.cam.y) * S.cam.z + stageH / 2];
const w2v = (x, y) => { const p = w2s(x, y); return [p[0] + stageRect.left, p[1] + stageRect.top]; };
const vfRect = () => { const a = aspectWH(); return {x:WORLD.cx - a[0] / 2, y:WORLD.cy - a[1] / 2, w:a[0], h:a[1]}; };
function projAspect() { // real project aspect (width/height) → viewfinder shape; 9:16 projects get a portrait finder (letterbox)
  const p = M && M.project; let r = 16 / 9;
  if (p && p.width > 0 && p.height > 0) r = p.width / p.height;
  else { const s = (p && p.aspectRatio) || (M && M.director && M.director.aspectRatio) || '16:9', m = /^(\d+(?:\.\d+)?)\s*[:x]\s*(\d+(?:\.\d+)?)$/.exec(s); if (m && +m[2] > 0) r = +m[1] / +m[2]; }
  return clamp(r, .4, 2.6); }
function aspectWH() { const r = projAspect(); let w = VF_BOX.w, h = w / r; if (h > VF_BOX.h) { h = VF_BOX.h; w = h * r; } return [w, h]; }
function camTarget() {
  const c = S.cam; let x = WORLD.cx, y = 450, z = c.fit, f = null;
  const act = activeFocus();
  if (c.user && AG[c.user]) { const a = AG[c.user]; x = a.x; y = a.y + 20; z = c.fit * 2.35; f = c.user; }
  else if (c.mode === 'follow' && act) { x = act.x; y = act.y; z = c.fit * (act.z || 1.75); f = act.id; }
  else if (c.mode === 'close') { const a = act || {x:WORLD.cx, y:WORLD.cy, id:'vf'}; x = a.x; y = a.y; z = c.fit * 2.9; f = a.id; }
  // keep the frame inside the world a little
  const hw = stageW / 2 / z, hh = stageH / 2 / z;
  if (z > c.fit * 1.05) { x = clamp(x, hw - 140, WORLD.w - hw + 140); y = clamp(y, hh - 120, WORLD.h - hh + 120); }
  c.tx = x; c.ty = y; c.tz = z; c.focus = f;
}
function activeFocus() { // what is being worked on right now (real activeAgentId, or the light beam in flight)
  const fl = S.flights.find(f => f.phase !== 'done' && (!S.run.active || f.via === S.run.active));
  if (fl) { const p = fl.focusW; if (p) return {x:p[0], y:p[1], id:fl.via || 'editor', z:1.9}; }
  if (S.finale && S.finale.t < 4.5) return {x:WORLD.cx, y:WORLD.cy, id:'vf', z:1.45};
  if (S.run.live && S.run.active && AG[S.run.active]) { const a = AG[S.run.active]; return {x:a.x, y:a.y + 10, id:a.id, z:1.85}; }
  if (S.run.status === 'failed' && S.run.active && AG[S.run.active]) { const a = AG[S.run.active]; return {x:a.x, y:a.y + 10, id:a.id, z:1.7}; }
  return null;
}
function updateCamera(dt) {
  camTarget(); const c = S.cam, k = 1 - Math.exp(-dt * (S.reduce ? 6 : 3.4));
  c.x += (c.tx - c.x) * k; c.y += (c.ty - c.y) * k; c.z = Math.exp(Math.log(c.z) + (Math.log(c.tz) - Math.log(c.z)) * k);
  const settle = Math.hypot(c.tx - c.x, c.ty - c.y) * c.z + Math.abs(Math.log(c.tz / c.z)) * 400;
  c.lock = clamp(c.lock + (settle < 6 ? dt * 2.6 : -dt * 5), 0, 1);
  const want = (c.mode !== 'overview' || c.user) ? (c.mode === 'close' || c.user ? 7 : 4.5) : 0;
  c.dof += (want - c.dof) * k;
  if (c.shake > 0) c.shake = Math.max(0, c.shake - dt * 2.5);
}
