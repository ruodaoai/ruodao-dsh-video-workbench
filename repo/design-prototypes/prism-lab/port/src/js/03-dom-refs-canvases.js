/* ================= 3 · DOM refs & canvases ================= */
const D = {stage:$('#stage'), sc:$('#stageCanvas'), labels:$('#labels'), vfCtl:$('#vfCtl'), tl:$('#timeline'), tlWrap:$('#tlWrap'), tlc:$('#tlCanvas'), fx:$('#fx'),
  rackList:$('#rackList'), log:$('#log'), video:$('#pvVideo')};
let SC = null, TL = null, FX = null, stageW = 1, stageH = 1, tlW = 1, tlH = 1, vw = 1, vh = 1, stageRect = {left:0, top:0, right:1, bottom:1, width:1, height:1}, tlRect = {left:0, top:0, right:1, bottom:1, width:1, height:1};
function layout() {
  const r = D.stage.getBoundingClientRect(), t = D.tlWrap.getBoundingClientRect();
  stageRect = r; stageW = Math.max(1, r.width); stageH = Math.max(1, r.height); SC = hiDPI(D.sc, stageW, stageH);
  tlRect = t; tlW = Math.max(1, t.width); tlH = Math.max(1, t.height); TL = hiDPI(D.tlc, tlW, tlH);
  vw = Math.max(1, window.innerWidth); vh = Math.max(1, window.innerHeight); FX = hiDPI(D.fx, vw, vh);
  S.cam.fit = Math.max(.05, Math.min(stageW / WORLD.w, (stageH - 40) / (WORLD.h - 40)) * .975);
  if (S.cam.mode === 'overview' && !S.cam.user) { S.cam.z = S.cam.tz = S.cam.fit; }
  layoutTrackLabels(); HB = null; for (const k in LBL) if (LBL[k] && LBL[k].el) LBL[k].dirty = true; stillDrawn = false;
}
const canDraw = () => SC && TL && stageW > 2 && stageH > 2;
