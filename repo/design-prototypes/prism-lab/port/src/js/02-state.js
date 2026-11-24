/* ================= 2 · STATE (visual state only; business data lives in M = last normalized WarRoomState) ================= */
const WORLD = {w:1600, h:900, cx:800, cy:440, rx:600, ry:330};
AGENTS.forEach(a => { const r = a.ang * Math.PI / 180; a.x = WORLD.cx + Math.cos(r) * WORLD.rx; a.y = WORLD.cy + Math.sin(r) * WORLD.ry; });
const SOURCE = {x:62, y:440};
const VF_BOX = {w:680, h:383};
const S = {
  t:0, dark:false, reduce:false, lowSpec:false, eco:false, hidden:false,
  cam:{mode:'overview', manual:false, x:WORLD.cx, y:450, z:.7, fit:.7, tx:WORLD.cx, ty:450, tz:.7, focus:null, user:null, lock:0, dof:0, shake:0, backAt:0},
  // run = derived from M.run each state; el/elAt interpolate the elapsed clock between snapshots
  run:{on:false, live:false, done:false, status:'', id:'', active:null, p:0, pT:0, el:0, elAt:0, msg:'', err:''},
  ag:{}, film:{t:0, play:false, mode:'film', asset:null, assetP:0, renderP:0, boardN:0, scopeT:0, codeT:0, err:false},
  tl:{v0:0, v1:60, t0:0, t1:60, ph:0, pulse:0, drop:0, manual:false, target:null, drag:false},
  shots:[], rev:{bgm:1, vo:1, beats:1, sfx:1, grid:1, sub:1, ghost:1, full:1, lit:1}, sfxDrop:[],
  used:new Set(), finale:null, flights:[], sparks:[], pulses:[], queue:[], qT:0, pulseT:.5, snap:true
};
AGENTS.forEach(a => S.ag[a.id] = {st:'idle', task:'待命', p:0, glow:0, flash:0});
function syncShots() { // keep per-scene visual slots aligned with the current scene list
  while (S.shots.length < SCENES.length) S.shots.push({st:'full', lit:0, land:1, done:false});
  S.shots.length = SCENES.length;
  while (S.sfxDrop.length < SFX.length) S.sfxDrop.push(1);
  S.sfxDrop.length = SFX.length;
}
