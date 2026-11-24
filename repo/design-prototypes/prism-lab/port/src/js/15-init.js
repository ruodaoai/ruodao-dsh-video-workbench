/* ================= 15 · INIT ================= */
function init() {
  initKit(); S.dark = LS.get('dark', '0') === '1'; applyTheme();
  buildLabels(); buildTaskUI(); bindRack(); bindVf(); bindTimeline(); bindTask(); bindChrome(); bindUI();
  rebuildModel(normState({})); syncShots(); layout(); renderRack(true); renderOnboard(); renderCapsule(); syncRunUI(); renderTlStats();
  S.cam.x = S.cam.tx = WORLD.cx; S.cam.y = S.cam.ty = 450; S.cam.z = S.cam.tz = S.cam.fit;
  tlSetWindow(0, PROJ.dur, false); S.tl.v0 = S.tl.t0; S.tl.v1 = S.tl.t1; syncZoomTick();
  if (listRO) [D.rackList, $('#stList'), D.log, $('#task'), $('#rack')].forEach(el => listRO.observe(el));
  kick();
  if (BRIDGE.parent) post({type:'dsh-vw/ready', skin:SKIN_ID});
}
// automation hooks (screenshots / checks)
window.__prism = {state:S, model:() => M, freeze:on => { S.freeze = on !== false; return S.freeze; }, snap:snapView, cam:m => { S.cam.manual = true; setCam(m); }, focus:id => focusAgent(id),
  quality:q => { S.quality = q; S.eco = false; return q; }, frame:ms => frame(ms || performance.now()), errors:() => frameErr};
init();
