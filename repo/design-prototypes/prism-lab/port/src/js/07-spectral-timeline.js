/* ================= 7 · SPECTRAL TIMELINE ================= */
const TRACKS = [{id:'shot', cd:'V1', cn:'镜头', w:1.35, c:'#2F37FF'}, {id:'sub', cd:'T1', cn:'字幕', w:.8, c:'var(--ink)'},
  {id:'vo', cd:'A1', cn:'配音', w:1.1, c:'#00B89C'}, {id:'sfx', cd:'A2', cn:'音效', w:.95, c:'#FF5A1F'}, {id:'bgm', cd:'A3', cn:'配乐', w:1.2, c:'#6B2BFF'}];
const TK = {}; TRACKS.forEach(t => TK[t.id] = t);
const trackEn = id => ({shot:'SHOT ' + SCENES.length, sub:'SUB', vo:narrMode() === 'subtitle-mv' ? 'MV' : 'TTS', sfx:'SFX ' + SFX.length, bgm:PROJ.bpm ? Math.round(PROJ.bpm) + ' BPM' : 'BGM'}[id]);
const narrMode = () => (M && M.project && M.project.narrationMode) || (M && M.director.narrationMode) || 'tts';
let RH = 24, tlLabelSig = '';
function layoutTrackLabels() {
  RH = clamp(Math.round(tlH * .15), 22, 28); const H = Math.max(10, tlH - RH), W = TRACKS.reduce((s, t) => s + t.w, 0); let y = RH;
  TRACKS.forEach(t => { t.y = y; t.h = H * t.w / W; y += t.h; });
  const sig = tlH + '|' + TRACKS.map(t => trackEn(t.id)).join('|'); if (sig === tlLabelSig) return; tlLabelSig = sig;
  $('#tlLabels').innerHTML = `<div class="tl-lab ruler" style="height:${RH}px"><span>TIME</span><span class="bt">BEAT</span></div>` +
    TRACKS.map(t => `<div class="tl-lab" style="height:${t.h}px"><span class="cd" style="color:${t.c}">${t.cd}</span><div class="tx"><div class="nm">${t.cn}</div>${t.h >= 40 ? `<div class="en">${esc(trackEn(t.id))}</div>` : ''}</div></div>`).join('');
}
const tX = t => (t - S.tl.v0) / ((S.tl.v1 - S.tl.v0) || 1) * tlW;
const xT = x => S.tl.v0 + x / tlW * (S.tl.v1 - S.tl.v0);
function tlPoint(track, t) { const tk = TK[track]; return [tlRect.left + tX(t), tlRect.top + tk.y + tk.h / 2]; }
function tlRulerY() { return tlRect.top + RH; }
function drawWave(c, wf, tk, rev, col, now, style, ranges) {
  const dur = PROJ.dur || 1, y0 = tk.y + tk.h / 2, amp = tk.h * .4, step = 2, ph = S.reduce || S.lowSpec ? 0 : now;
  const segs = ranges && ranges.length ? ranges : [[0, dur]];
  c.strokeStyle = ink(.16); c.lineWidth = 1; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(Math.max(0, tX(0)), y0); c.lineTo(Math.min(tlW, tX(dur)), y0); c.stroke(); c.setLineDash([]);
  if (rev <= 0) return; const xr = tX(rev * dur);
  segs.forEach(([s0, s1]) => { const x0 = Math.max(0, tX(s0)), xe = Math.min(tlW, xr, tX(s1)); if (xe <= x0) return;
    const top = [], bot = []; for (let x = x0; x <= xe; x += step) { const i = Math.floor(xT(x) / WF_DT); if (i < 0 || i >= WF_N) continue;
      let v = wf[i]; if (style === 'bgm') v = Math.max(v, wf[Math.min(WF_N - 1, i + 1)]); v *= 1 + .07 * Math.sin(ph * 7 + i * .9); const k = style === 'vo' && !VO_ON[i] ? .55 : 1;
      top.push([x, y0 - v * amp * k]); bot.push([x, y0 + v * amp * k * (style === 'vo' ? 1 : .82)]); }
    if (!top.length) return;
    c.beginPath(); top.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); for (let i = bot.length - 1; i >= 0; i--) c.lineTo(bot[i][0], bot[i][1]); c.closePath();
    c.fillStyle = rgba(col, S.dark ? .22 : .16); c.fill();
    c.strokeStyle = rgba(col, .95); c.lineWidth = 1; c.beginPath(); top.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
    c.strokeStyle = rgba(col, .55); c.beginPath(); bot.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
    c.strokeStyle = rgba(col, .9); c.beginPath(); c.moveTo(x0, y0); c.lineTo(xe, y0); c.lineWidth = .5; c.stroke(); });
  if (rev < 1 && xr > 0 && xr < tlW) { c.fillStyle = rgba(col, 1); c.fillRect(xr - 1, tk.y + 3, 2, Math.max(0, tk.h - 6)); const g = c.createLinearGradient(xr - 40, 0, xr, 0); g.addColorStop(0, rgba(col, 0)); g.addColorStop(1, rgba(col, .25)); c.fillStyle = g; c.fillRect(xr - 40, tk.y + 2, 40, Math.max(0, tk.h - 4)); }
}
function sfxGlyph(c, k, x, y, s) { c.beginPath();
  if (k === 'hi') { c.moveTo(x, y - s); c.lineTo(x + s * .8, y); c.lineTo(x, y + s); c.lineTo(x - s * .8, y); c.closePath(); c.fill(); }
  else if (k === 'wd') { c.arc(x, y, R0(s * .62), 0, 7); c.fill(); }
  else if (k === 'sw') { c.moveTo(x - s * .7, y + s * .8); c.lineTo(x + s * .7, y - s * .8); c.stroke(); }
  else if (k === 'bw') { c.moveTo(x - s * .5, y - s * .6); c.lineTo(x + s * .3, y); c.lineTo(x - s * .5, y + s * .6); c.stroke(); }
  else if (k === 'mc') { c.moveTo(x - s * .6, y - s * .6); c.lineTo(x + s * .6, y + s * .6); c.moveTo(x + s * .6, y - s * .6); c.lineTo(x - s * .6, y + s * .6); c.stroke(); }
  else { c.moveTo(x, y - s * .7); c.lineTo(x, y + s * .7); c.stroke(); } }
function tlEmpty(c, text) { c.font = `600 12px ${SANS}`; c.textBaseline = 'middle'; c.textAlign = 'center'; const st = TK.shot, tw = Math.min(tlW - 24, c.measureText(text).width + 24);
  c.fillStyle = S.dark ? 'rgba(20,21,24,.9)' : 'rgba(250,250,247,.92)'; c.fillRect(tlW / 2 - tw / 2, st.y + st.h / 2 - 11, tw, 22); c.fillStyle = ink(.6); c.fillText(fitText(c, text, tlW - 36), tlW / 2, st.y + st.h / 2); c.textAlign = 'left'; }
function drawTimeline(now) {
  const c = TL.c; c.setTransform(TL.d, 0, 0, TL.d, 0, 0); c.clearRect(0, 0, tlW, tlH);
  const span = (S.tl.v1 - S.tl.v0) || 1, pxs = tlW / span, dur = PROJ.dur || 1;
  // track backgrounds
  TRACKS.forEach((t, i) => { c.fillStyle = i % 2 ? ink(.018) : 'rgba(255,255,255,0)'; c.fillRect(0, t.y, tlW, t.h); c.fillStyle = ink(.09); c.fillRect(0, t.y + t.h - 1, tlW, 1); });
  c.fillStyle = S.dark ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.55)'; c.fillRect(0, 0, tlW, RH); c.fillStyle = ink(.85); c.fillRect(0, RH - 1, tlW, 1);
  // ruler flags first (playhead time, beam target / snap) so second & drop labels never sit underneath them
  const flags = rulerFlags(c), boxes = flags.map(f => [f.x - 3, f.x + f.w + 3]);
  // seconds grid (labels 12 px; spacing guarantees no label collisions)
  c.font = `500 12px ${MONO}`; c.textBaseline = 'top'; const lblW = c.measureText('00:00').width + 10;
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]; let major = steps.find(s => s * pxs >= lblW) || 600;
  for (let s = Math.ceil(S.tl.v0 / major) * major; s <= S.tl.v1; s += major) { const x = Math.round(tX(s)) + .5; c.fillStyle = ink(.05); c.fillRect(x, RH, 1, tlH - RH);
    const lb = mmss(s).replace(/^0(?=\d:)/, ''), lw = c.measureText(lb).width; c.fillStyle = ink(.6); c.fillRect(x, 0, 1, 7);
    if (flags.some(f => x + 2 < f.x + f.w + 3 && x + 6 + lw > f.x - 3)) continue; c.fillStyle = ink(.55); c.fillText(lb, x + 3, 2); boxes.push([x + 2, x + 6 + lw]); }
  // beat grid = diffraction scale
  const gridRev = S.rev.grid * dur, litRev = S.rev.beats * dur;
  BEATS.forEach(b => { if (b.t > gridRev || b.t < S.tl.v0 - 1 || b.t > S.tl.v1 + 1) return; if (!b.s && pxs < 2) return; const x = Math.round(tX(b.t)) + .5, lit = b.t <= litRev, hl = b.s ? 7 : 4;
    c.fillStyle = lit ? rgba(timeHue(b.t), b.s ? 1 : .7) : ink(b.s ? .8 : .32); c.fillRect(x - (b.s ? .5 : 0), RH - 1 - hl, b.s ? 2 : 1, hl);
    if (b.s && lit && pxs > 3) { c.fillStyle = rgba(timeHue(b.t), .06 + .1 * S.tl.pulse); c.fillRect(x, RH, 1, TK.vo.y - RH + TK.vo.h); } });
  // drops (label only where it cannot collide with a time label or a previous drop label)
  c.font = `700 12px ${MONO}`;
  PROJ.drops.forEach((d, i) => { if (d > gridRev) return; const x = tX(d); if (x < -30 || x > tlW + 30) return;
    c.strokeStyle = rgba('#FF5A1F', .55); c.lineWidth = 1; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x + .5, RH); c.lineTo(x + .5, tlH); c.stroke(); c.setLineDash([]);
    c.fillStyle = '#FF5A1F'; c.beginPath(); c.moveTo(x - 5, 0); c.lineTo(x + 5, 0); c.lineTo(x, 8); c.closePath(); c.fill();
    const lb = 'DROP ' + (i + 1), lw = c.measureText(lb).width, lx = x + 7; if (lx + lw > tlW - 2 || boxes.some(b => lx < b[1] && lx + lw > b[0])) return; boxes.push([lx - 2, lx + lw + 4]); c.fillText(lb, lx, 2); });
  // shots = light bands
  const st = TK.shot, by = st.y + 3, bh = Math.max(2, st.h - 7);
  if (!SCENES.length) tlEmpty(c, PROJ.has ? (S.run.live ? '策划导演正在拆解分镜…' : '暂无分镜 · 一键出片后，策划导演会在这里铺出光谱镜头带') : '未打开工程 · 请新建或打开一个视频工程');
  SCENES.forEach((s, i) => { const x0 = tX(s.start), x1 = tX(s.end); if (x1 < 0 || x0 > tlW) return; const sh = S.shots[i] || {st:'full', land:1, lit:0}, w = Math.max(1, x1 - x0 - 1.5);
    if (sh.st === 'none') return;
    if (sh.st === 'ghost') { c.strokeStyle = ink(.22); c.lineWidth = 1; c.setLineDash([2, 2]); c.strokeRect(x0 + .5, by + .5, w, bh); c.setLineDash([]);
      if (w > 24 && bh >= 16) { c.fillStyle = ink(.4); c.font = `500 12px ${MONO}`; c.textBaseline = 'top'; c.fillText(String(i + 1).padStart(2, '0'), x0 + 3, by + 2); } return; }
    const k = sh.st === 'land' ? E.oq(clamp(sh.land, 0, 1)) : 1, col = timeHue(s.start + s.dur / 2), cx = (x0 + x1) / 2, ww = w * k;
    const g = c.createLinearGradient(0, by, 0, by + bh); g.addColorStop(0, rgba(col.map(v => v + (255 - v) * .28), 1)); g.addColorStop(1, rgba(col, 1));
    c.fillStyle = g; c.fillRect(cx - ww / 2, by, ww, bh);
    if (s.mode === 'f') { c.fillStyle = 'rgba(17,17,17,.22)'; c.fillRect(cx - ww / 2, by + bh - 3, ww, 3); }
    if (s.mode === 'd') { c.fillStyle = '#111'; c.fillRect(cx - ww / 2, by, ww, 3); }
    if (sh.lit > 0) { const p = sh.lit, sx = x0 + w * clamp(p * 1.3, 0, 1); c.fillStyle = `rgba(255,255,255,${.75 * (1 - p)})`; c.fillRect(x0, by, sx - x0, bh); c.fillStyle = '#fff'; c.fillRect(sx - 1, by, 2, bh); }
    if (sh.st === 'land' && sh.land < 1) { c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.strokeRect(cx - ww / 2, by, ww, bh); }
    if (s.locked && w > 14) { c.fillStyle = 'rgba(17,17,17,.55)'; c.fillRect(x0 + 3, by + bh - 9, 6, 6); }
    if (w > 40 && k > .9 && bh >= 18) { c.fillStyle = 'rgba(255,255,255,.96)'; c.font = `700 12px ${SANS}`; c.textBaseline = 'middle';
      c.save(); c.beginPath(); c.rect(x0 + 1, by, w - 2, bh); c.clip(); const two = bh >= 34;
      c.fillText(fitText(c, s.title, w - 10), x0 + 4, by + (two ? bh * .34 : bh / 2)); if (two) { c.font = `500 12px ${MONO}`; c.globalAlpha = .78; c.fillText('S' + String(i + 1).padStart(2, '0'), x0 + 4, by + bh * .74); } c.restore(); c.textBaseline = 'top'; }
    if (sh.done && S.run.showDone && pxs > 4 && w > 14) { c.fillStyle = '#C8F53B'; c.fillRect(x1 - 9, by + 2, 7, 7); }
    if (selScene === s.id) { c.strokeStyle = S.dark ? '#EDECE6' : '#111'; c.lineWidth = 2; c.strokeRect(x0 + 1, by + 1, w - 1, bh - 1); } });
  // subtitles
  const su = TK.sub; c.textBaseline = 'middle';
  SCENES.forEach(s => { if (!s.sub || s.start > S.rev.sub * dur) return; const x0 = tX(s.start + Math.min(.08, s.dur * .1)), x1 = tX(s.end - Math.min(.08, s.dur * .1)); if (x1 < 0 || x0 > tlW || x1 - x0 < 2) return;
    c.fillStyle = ink(S.dark ? .1 : .075); c.fillRect(x0, su.y + 4, x1 - x0, Math.max(2, su.h - 8)); c.fillStyle = ink(.45); c.fillRect(x0, su.y + 4, 1, Math.max(2, su.h - 8));
    if (x1 - x0 > 40 && su.h >= 18) { c.save(); c.beginPath(); c.rect(x0, su.y, x1 - x0 - 2, su.h); c.clip(); c.fillStyle = ink(.85); c.font = `12px ${KAI}`; c.fillText(fitText(c, s.sub, x1 - x0 - 10), x0 + 5, su.y + su.h / 2 + 1); c.restore(); } });
  // voice + bgm oscilloscopes
  if (!PROJ.has) { /* nothing to show */ }
  else if (narrMode() === 'subtitle-mv') { c.fillStyle = ink(.5); c.font = `600 12px ${MONO}`; c.fillText(fitText(c, '纯音乐字幕 MV · 无 TTS 旁白', tlW - 20), 10, TK.vo.y + TK.vo.h / 2); }
  else if (SCENES.some(s => s.sub)) drawWave(c, VO_WF, TK.vo, S.rev.vo, '#00B89C', now, 'vo');
  else if (PROJ.has) { c.fillStyle = ink(.4); c.font = `600 12px ${MONO}`; c.fillText(fitText(c, '暂无旁白', tlW - 20), 10, TK.vo.y + TK.vo.h / 2); }
  if (MUSIC.length) { drawWave(c, BGM_WF, TK.bgm, S.rev.bgm, '#6B2BFF', now, 'bgm', MUSIC.map(m => [m.s0, m.s1]));
    if (TK.bgm.h >= 18) MUSIC.forEach(m => { const x = Math.max(4, tX(m.s0) + 4), xe = Math.min(tlW - 4, tX(m.s1)); if (xe - x < 60) return; c.font = `600 12px ${SANS}`; const lb = fitText(c, '♪ ' + m.name, Math.min(260, xe - x - 8)); if (!lb) return;
      const lw = c.measureText(lb).width + 10; c.fillStyle = S.dark ? 'rgba(20,21,24,.82)' : 'rgba(250,250,247,.86)'; c.fillRect(x, TK.bgm.y + 3, lw, 17); c.fillStyle = '#6B2BFF'; c.textBaseline = 'middle'; c.fillText(lb, x + 5, TK.bgm.y + 11.5); }); }
  else if (PROJ.has) { c.fillStyle = ink(.4); c.font = `600 12px ${MONO}`; c.textBaseline = 'middle'; c.fillText(fitText(c, '未设置配乐 · BGM', tlW - 20), 10, TK.bgm.y + TK.bgm.h / 2); }
  // sfx markers falling onto beats
  const sf = TK.sfx, sy = sf.y + sf.h / 2, gs = clamp(sf.h * .2, 4, 6.5); c.lineWidth = 1.4;
  SFX.forEach((f, i) => { const p = S.sfxDrop[i] == null ? 1 : S.sfxDrop[i]; if (p <= 0) return; const x = tX(f.t); if (x < -10 || x > tlW + 10) return; const yy = sy - (1 - E.back(p)) * sf.h * 1.1;
    const heavy = f.g === 'hi'; c.globalAlpha = clamp(p * 2, 0, 1); c.fillStyle = c.strokeStyle = heavy ? '#FF5A1F' : ink(.82); sfxGlyph(c, f.g, x, yy, heavy ? gs * 1.15 : gs); c.globalAlpha = 1;
    if (p < 1 && p > .7) { c.strokeStyle = rgba('#FF5A1F', (1 - p) * 3); c.beginPath(); c.arc(x, sy, R0((p - .7) * 40), 0, 7); c.stroke(); } });
  // landing target highlight
  if (S.tl.target) { const T = S.tl.target, tk = TK[T.track], x0 = tX(T.t0), x1 = tX(T.t1); c.strokeStyle = '#2F37FF'; c.lineWidth = 1.5; c.setLineDash([4, 3]); c.strokeRect(x0, tk.y + 1.5, x1 - x0, tk.h - 3); c.setLineDash([]);
    c.fillStyle = 'rgba(47,55,255,.08)'; c.fillRect(x0, tk.y + 1.5, x1 - x0, tk.h - 3); }
  // QA scanning sweep across the timeline
  if (S.film.mode === 'render' && S.run.live) { const p = clamp(S.film.renderP || 0, 0, 1), x = tX(p * dur); c.fillStyle = 'rgba(200,245,59,.10)'; c.fillRect(Math.max(0, tX(0)), RH, Math.max(0, x - Math.max(0, tX(0))), tlH - RH);
    c.fillStyle = '#9BC21B'; c.fillRect(x - 1, RH, 2, tlH - RH); }
  // beat pulse wash
  if (S.tl.pulse > .01 && !S.lowSpec) { const g = c.createLinearGradient(0, 0, tlW, 0); g.addColorStop(0, rgba(SPECTRUM[0], .05 * S.tl.pulse)); g.addColorStop(.5, rgba(SPECTRUM[3], .05 * S.tl.pulse)); g.addColorStop(1, rgba(SPECTRUM[7], .05 * S.tl.pulse)); c.fillStyle = g; c.fillRect(0, RH, tlW, tlH - RH); }
  // playhead
  const px = tX(S.tl.ph); if (px >= -2 && px <= tlW + 2) { c.fillStyle = '#FF5A1F'; c.fillRect(Math.round(px) - .75, 0, 1.5, tlH); c.beginPath(); c.moveTo(px - 6, 0); c.lineTo(px + 6, 0); c.lineTo(px, 8); c.closePath(); c.fill();
  }
  c.font = `700 12px ${MONO}`; c.textBaseline = 'middle'; flags.forEach(f => { const lh = 16; c.fillStyle = f.bg; c.fillRect(f.x, RH - lh - 1, f.w, lh); c.fillStyle = '#fff'; c.fillText(f.text, f.x + 4, RH - lh / 2 - 1); });
  // hover readout
  if (tlHover != null && !S.tl.drag) { const t = xT(tlHover), onShot = tlHoverY != null && tlHoverY >= TK.shot.y && tlHoverY < TK.shot.y + TK.shot.h; c.fillStyle = ink(.5); c.fillRect(Math.round(tlHover), RH, 1, tlH - RH);
    const sc = SCENES.length ? sceneAt(t) : null, inSc = sc && t >= sc.start && t < sc.end; c.font = `600 12px ${MONO}`; c.textBaseline = 'middle';
    const tx = (inSc ? 'S' + String(sc.no).padStart(2, '0') + ' ' + sc.title + ' · ' : '') + secs(t) + (inSc && onShot ? ' · 点击 → 分步精修' : ''), tw = Math.min(tlW - 8, c.measureText(tx).width + 10), hx = tlHover + tw + 6 > tlW ? Math.max(2, tlHover - tw - 4) : tlHover + 4;
    c.fillStyle = S.dark ? '#EDECE6' : '#111'; c.fillRect(hx, tlH - 19, tw, 17); c.fillStyle = S.dark ? '#111' : '#fff'; c.fillText(fitText(c, tx, tw - 10), hx + 5, tlH - 10.5); }
}
let tlHover = null, tlHoverY = null, selScene = '';
function rulerFlags(c) { const out = []; c.font = `700 12px ${MONO}`;
  const px = tX(S.tl.ph); if (px >= -2 && px <= tlW + 2) { const lbl = secs(S.tl.ph), lw = c.measureText(lbl).width + 8; out.push({x:px + lw + 8 > tlW ? px - lw - 6 : px + 6, w:lw, text:lbl, bg:'#FF5A1F'}); }
  S.flights.forEach(f => { if (!f.tgt || !TK[f.tgt.track]) return; const u = f.pt || 0, snap = f.phase === 'land' || (f.phase === 'fade' && u < .6);
    if (!(snap || (f.phase === 'drop' && E.io(u) > .55))) return;
    const text = snap ? 'SNAP · ' + f.tgt.label : 'T ' + secs(f.tgt.t0) + ' · ' + TK[f.tgt.track].cd, w = c.measureText(text).width + 8, hit = x => out.some(g => x < g.x + g.w + 4 && x + w > g.x - 4);
    let x = clamp(tX(f.tgt.t0) + 8, 2, tlW - w - 2);
    if (hit(x)) { const cands = out.flatMap(g => [g.x + g.w + 6, g.x - w - 6]).filter(v => v >= 2 && v <= tlW - w - 2 && !hit(v)).sort((a, b) => Math.abs(a - x) - Math.abs(b - x)); if (!cands.length) return; x = cands[0]; }
    out.push({x, w, text, bg:'#2F37FF'}); });
  return out; }
const minSpan = () => Math.min(6, PROJ.dur || 6);
function tlSetWindow(a, b, manual) { const dur = PROJ.dur || 1, span = clamp(b - a, minSpan(), dur); a = clamp(a, 0, Math.max(0, dur - span)); S.tl.t0 = a; S.tl.t1 = a + span; if (manual != null) S.tl.manual = manual; }
function sceneHit(x, y) { if (y < TK.shot.y || y >= TK.shot.y + TK.shot.h) return null; const t = xT(x); return SCENES.find(s => t >= s.start && t < s.end && (S.shots[s.i] || {}).st !== 'none') || null; }
function bindTimeline() {
  const w = D.tlWrap; let down = null;
  w.addEventListener('pointerdown', e => { const r = w.getBoundingClientRect(); down = {x:e.clientX, v0:S.tl.t0, v1:S.tl.t1, moved:false, ox:e.clientX - r.left, oy:e.clientY - r.top}; try { w.setPointerCapture(e.pointerId); } catch (er) {} });
  w.addEventListener('pointermove', e => { const r = w.getBoundingClientRect(); tlHover = e.clientX - r.left; tlHoverY = e.clientY - r.top; redrawSoon();
    w.style.cursor = sceneHit(tlHover, tlHoverY) ? 'pointer' : 'crosshair';
    if (down) { const dx = e.clientX - down.x; if (Math.abs(dx) > 4) { down.moved = true; S.tl.drag = true; const dt = -dx / tlW * (down.v1 - down.v0); tlSetWindow(down.v0 + dt, down.v1 + dt, true); S.tl.v0 = S.tl.t0; S.tl.v1 = S.tl.t1; } } });
  w.addEventListener('pointerleave', () => { tlHover = null; tlHoverY = null; redrawSoon(); });
  w.addEventListener('pointerup', () => { if (down && !down.moved) { const hit = sceneHit(down.ox, down.oy);
      if (hit) { selScene = hit.id; seekFilm(hit.start); openPanel('studio', {step:'scenes', sceneId:hit.id}); }
      else seekFilm(clamp(xT(down.ox), 0, PROJ.dur)); } down = null; S.tl.drag = false; });
  w.addEventListener('wheel', e => { e.preventDefault(); const r = w.getBoundingClientRect(), mx = e.clientX - r.left, t = xT(mx), span = S.tl.t1 - S.tl.t0;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { const d = (e.deltaX || e.deltaY) / tlW * span; tlSetWindow(S.tl.t0 + d, S.tl.t1 + d, true); }
    else { const ns = clamp(span * Math.exp(e.deltaY * .0015), minSpan(), PROJ.dur || 1), u = mx / tlW; tlSetWindow(t - ns * u, t - ns * u + ns, true); } syncZoomTick(); }, {passive:false});
}
