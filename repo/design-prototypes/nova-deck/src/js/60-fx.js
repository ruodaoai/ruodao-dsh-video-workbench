/* =====================================================================
   FLIGHT SHOWS — screen-space choreography started by status transitions.
   Every show runs on its own clock (showT − t0); nothing here advances
   business progress, it only visualises what the host reports.
   ===================================================================== */
const SORTIE_D=3,SORTIE_T0=1;
const sstep=u=>u*u*(3-2*u);
const showU=sh=>Math.max(0,S.showT-sh.t0);
/* screen-space anchors */
function capScreen(id){const el=capEls[id];if(el&&el.offsetParent!==null&&!el.classList.contains('hide')){const r=el.getBoundingClientRect();const box=$('#caps').getBoundingClientRect();if(r.bottom>box.top+4&&r.top<box.bottom-4)return{x:r.left,y:r.top,w:r.width,h:r.height}}const b=$('#caps').getBoundingClientRect();return{x:b.left+12,y:b.top+6,w:Math.max(60,b.width-24),h:36}}
function tlRowScreen(k){const r=TL.rows[k];return r?{y:G.tl.y+r.y,h:r.h}:{y:G.tl.y,h:10}}
function tlXScreen(t){return G.tl.x+tX(t)}
function slotScreen(so){
 const tot=M.tl.totalSec||1;
 if(so.track==='shot'){const sc=M.tl.scenes[so.sc];const row=tlRowScreen('shot');if(!sc)return{x:G.tl.x+20,y:row.y,w:30,h:row.h};const x0=tlXScreen(sc.startSec),x1=tlXScreen(sc.endSec);return{x:x0,y:row.y,w:Math.max(10,x1-x0),h:row.h}}
 const row=tlRowScreen(so.track==='bgm'?'bgm':'vo');
 const t0=so.track==='vo'&&M.tl.scenes[so.sc]?M.tl.scenes[so.sc].startSec:0,t1=Math.min(tot,t0+Math.max(4,tot*.08));
 const x0=tlXScreen(t0),x1=tlXScreen(t1);return{x:x0,y:row.y,w:Math.max(14,x1-x0),h:row.h};
}
const hoverOver=(r,dy=0)=>({x:r.x+r.w/2,y:r.y-34+dy});
function monScreen(){return wr2s(G.mon)}
function monEdgeS(p){const m=monScreen();return{x:clamp(p.x,m.x+8,m.x+m.w-8),y:clamp(p.y,m.y+8,m.y+m.h-8)}}
function stgScreen(){const sg=$('#staging');if(!sg||sg.classList.contains('none'))return null;const h=$('#stg-h').getBoundingClientRect();return{x:h.left+h.width*.3,y:h.top+h.height/2}}
/* per-agent flight plans (screen space); return null when docked */
const FLY={
 director(sh,u){
  const F0=0,S0=1.1,S1=4.3,F1=5.5;if(u>F1)return null;
  const D=dockScreen('director',9),row=tlRowScreen('ruler'),y=row.y+row.h*.5,A={x:tlXScreen(0)+4,y},B={x:tlXScreen(M.tl.totalSec||1)-4,y};
  if(u<S0){const e=E.io3(inv(F0,S0,u));return bez(D,{x:D.x-150,y:D.y-50},{x:A.x+60,y:A.y-260},A,e)}
  if(u<S1)return{x:lerp(A.x,B.x,sstep(inv(S0,S1,u))),y:y+Math.sin(u*9)*1.5};
  const e=E.io3(inv(S1,F1,u));return bez(B,{x:B.x-30,y:B.y-300},{x:D.x+200,y:D.y-90},D,e);
 },
 editor(sh,u){
  const so=sh.sorties||[],N=so.length;
  if(!N){const F0=0,S0=1,S1=6.5,F1=7.6;if(u>F1)return null;const D=dockScreen('editor',9),row=tlRowScreen('shot'),y=row.y-8,A={x:tlXScreen(0)+4,y},B={x:tlXScreen(M.tl.totalSec||1)-4,y};
   if(u<S0){const e=E.io3(inv(F0,S0,u));return bez(D,{x:D.x-90,y:D.y+30},{x:A.x+40,y:A.y-170},A,e)}
   if(u<S1)return{x:lerp(A.x,B.x,sstep(inv(S0,S1,u))),y};
   const e=E.io3(inv(S1,F1,u));return bez(B,{x:B.x-60,y:B.y-300},{x:D.x-260,y:D.y+60},D,e)}
  const RET0=SORTIE_T0+N*SORTIE_D,RET1=RET0+1.2;
  if(u>RET1)return null;
  if(u<SORTIE_T0){const D=dockScreen('editor'),D2=dockScreen('editor',14);return{x:lerp(D.x,D2.x,E.io2(u)),y:lerp(D.y,D2.y,E.io2(u))}}
  if(u>=RET0){const A=hoverOver(slotScreen(so[N-1]),-4),B=dockScreen('editor',9),e=E.io3(inv(RET0,RET1,u));return bez(A,{x:A.x+20,y:A.y-170},{x:B.x-40,y:B.y+110},B,e)}
  const k=Math.min(N-1,Math.floor((u-SORTIE_T0)/SORTIE_D)),s=so[k],v=u-SORTIE_T0-k*SORTIE_D;
  const D=k===0?dockScreen('editor',14):hoverOver(slotScreen(so[k-1]),-4);
  const cr=capScreen(s.asset),U={x:cr.x+Math.min(cr.w*.5,96),y:cr.y-22};
  const Tp=hoverOver(slotScreen(s));
  if(v<.95){const e=E.io3(v/.95),h=clamp(Math.hypot(U.x-D.x,U.y-D.y)*.3,50,190);return bez(D,{x:D.x+(U.x-D.x)*.12,y:Math.min(D.y,U.y)-h},{x:U.x+(D.x-U.x)*.14,y:U.y-h*.7},U,e)}
  if(v<1.35)return{x:U.x,y:U.y-Math.sin(inv(.95,1.35,v)*Math.PI)*5};
  if(v<2.55){const e=E.io4(inv(1.35,2.55,v));return bez(U,{x:U.x+150,y:U.y-60},{x:Tp.x,y:Tp.y-220},Tp,e)}
  if(v<2.85)return{x:Tp.x,y:Tp.y+E.io3(inv(2.55,2.85,v))*8};
  return{x:Tp.x,y:Tp.y+8-E.o3(inv(2.85,3,v))*12};
 },
 audio(sh,u){
  const F0=0,S0=1,S1=9,F1=10.1;if(u>F1)return null;
  const D=dockScreen('audio',9),row=tlRowScreen('vo'),y=row.y+row.h*.5,A={x:tlXScreen(0)+4,y},B={x:tlXScreen(M.tl.totalSec||1)-4,y};
  if(u<S0){const e=E.io3(inv(F0,S0,u));return bez(D,{x:D.x+30,y:D.y-120},{x:A.x+160,y:A.y-260},A,e)}
  if(u<S1)return{x:lerp(A.x,B.x,sstep(inv(S0,S1,u))),y:y+Math.sin(u*4)*2};
  const e=E.io3(inv(S1,F1,u));return bez(B,{x:B.x-40,y:B.y-260},{x:D.x+160,y:D.y+30},D,e);
 },
 qa(sh,u){
  if(sh.orbit0==null)return null;const v=S.showT-sh.orbit0;const O0=.5,O1=4.1,F1=4.6;if(v>F1||v<0)return null;
  const p=qaOrbitAt(v);return p;
 },
};
function qaOrbitAt(v){const a=AGM.qa.rad,D=dockScreen('qa',9),c=w2s(G.C.x,G.C.y),r=G.R*.9*CAM.s,Pp=ang=>({x:c.x+Math.cos(ang)*r,y:c.y+Math.sin(ang)*r});
 if(v<.5){const e=E.io3(inv(0,.5,v)),A=Pp(a);return{x:lerp(D.x,A.x,e),y:lerp(D.y,A.y,e)}}
 if(v<4.1)return Pp(a-E.io2(inv(.5,4.1,v))*TAU);
 const e=E.io3(inv(4.1,4.6,v)),A=Pp(a-TAU);return{x:lerp(A.x,D.x,e),y:lerp(A.y,D.y,e)}}
function qaOrbitWorld(sh){const p=FLY.qa(sh,0);return p?s2w(p.x,p.y):G.docks.qa}
/* show phase drives the follow camera */
function showPhase(id,sh){
 const u=showU(sh);
 if(id==='director')return u<=5.5?'away':'monitor';
 if(id==='editor'){const N=(sh.sorties||[]).length;return u<=(N?SORTIE_T0+N*SORTIE_D+1.2:7.6)&&u>=(N?SORTIE_T0*.6:0)?'away':'dock'}
 if(id==='audio')return u<=10.1?'away':'dock';
 if(id==='qa')return sh.orbit0!=null&&S.showT-sh.orbit0<=4.6?'orbit':'monitor';
 if(id==='motion'||id==='avatar')return 'monitor';
 return 'dock';
}
function audioSweep(){const sh=SHOW.audio;if(!sh)return null;const u=showU(sh);return u<1?0:u<9?sstep(inv(1,9,u)):1}
function directorScan(){const sh=SHOW.director;if(!sh)return null;const u=showU(sh);return u<1.1?0:u<4.3?sstep(inv(1.1,4.3,u)):1}
/* pose (screen space) */
let FRAME=0;const RC={};
function agentPose(id,force){
 const c=RC[id];if(!force&&c&&c.f===FRAME)return c.p;
 const a=AGM[id],ag=agentOf(id),st=ag.status,on=st==='running';
 const base=dockScreen(id,(on?9:0)+Math.sin(S.simT*1.7+a.idx*1.3)*1.4);
 const sh=SHOW[id];let p=null,fly=false,h=a.rad,thrust=on?.42:.16,free=false;
 if(sh&&FLY[id]){const u=showU(sh);p=FLY[id](sh,u);
  if(p){fly=true;free=true;let dx=0,dy=0;for(const w of [.05,.16,.42]){const p0=FLY[id](sh,Math.max(0,u-w))||base,p1=FLY[id](sh,u+w)||base;dx=p1.x-p0.x;dy=p1.y-p0.y;if(dx*dx+dy*dy>16)break}
   if(dx*dx+dy*dy>16)h=Math.atan2(dy,dx);
   const q0=FLY[id](sh,Math.max(0,u-.04))||p,q1=FLY[id](sh,u+.04)||p;thrust=clamp(.32+Math.hypot(q1.x-q0.x,q1.y-q0.y)/.08/650,.32,1)}}
 if(!p)p=base;
 const rc=RECALL[id];
 if(rc){const k=E.io3(inv(rc.t0,rc.t0+.95,S.realT));if(k<1){p={x:lerp(rc.x,p.x,k),y:lerp(rc.y,p.y,k)};h=rc.h+angDiff(rc.h,h)*k;fly=true;free=true;thrust=.7}else delete RECALL[id]}
 const out={x:p.x,y:p.y,h,thrust,fly,free,st};RC[id]={f:FRAME,p:out};return out;
}
/* show step: fires snap / orbit events on crossings */
function stepShows(){
 for(const a of AG){const sh=SHOW[a.id];if(!sh)continue;const u=showU(sh),pu=sh.pu==null?u:sh.pu;sh.pu=u;
  if(a.id==='editor'&&sh.sorties){sh.sorties.forEach((s,k)=>{const snap=SORTIE_T0+k*SORTIE_D+2.85,start=SORTIE_T0+k*SORTIE_D;if(pu<start&&u>=start)onSortieStart(s);if(pu<snap&&u>=snap)onSnap(s)})}
  if(a.id==='qa'&&sh.orbit0==null&&agentOf('qa').progress>=90&&agentOf('qa').status==='running')sh.orbit0=S.showT;
  if(a.id==='audio'&&pu<1&&u>=1)sweep('vo',0,2);
 }
}
function onSnap(s){const r=slotScreen(s),x=s.track==='bgm'?r.x+24:r.x+r.w/2,y=r.y+r.h/2;burst(x,y-4,AGM.editor.rgb,30,300);burst(x,y,PAL.ambRgb,12,200);shock(x,y,AGM.editor.rgb,62,.55);const sc=M.tl.scenes[s.sc];sweep(s.track,s.track==='shot'&&sc?sc.startSec+sc.durationSec/2:0,s.track==='bgm'?1.9:1.35);if(sc)S.snapped[s.asset]=1}
function onSortieStart(s){const el=capEls[s.asset];if(el&&el.offsetParent){const box=$('#caps');const top=el.offsetTop-box.offsetTop;if(top<box.scrollTop||top+el.offsetHeight>box.scrollTop+box.clientHeight)box.scrollTo({top:Math.max(0,top-box.clientHeight/2+20),behavior:S.lite?'auto':'smooth'})}const sc=M.tl.scenes[s.sc];if(sc)tlEnsure(sc.startSec)}
S.snapped={};

/* ======================= drawing (fx canvas, screen space) ======================= */
const DSPR={};
function droneSprite(a,dim){const k=a.id+(dim?'_d':'');if(DSPR[k])return DSPR[k];const Q=4,sz=36,cv=document.createElement('canvas');cv.width=cv.height=sz*Q;const c=cv.getContext('2d');c.setTransform(Q,0,0,Q,sz/2*Q,sz/2*Q);
 const al=dim?.42:.95;c.lineJoin='round';c.fillStyle='rgba(7,11,30,.95)';c.strokeStyle=`rgba(${a.rgb},${al})`;c.lineWidth=1.1;
 for(const s of [-1,1]){c.beginPath();c.moveTo(2,4.6*s);c.lineTo(-5.5,12.4*s);c.lineTo(-10.5,12.4*s);c.lineTo(-7.5,4.2*s);c.closePath();c.fill();c.stroke()}
 c.beginPath();c.moveTo(15,0);c.lineTo(5,-5.2);c.lineTo(-8,-4.4);c.lineTo(-11.5,-2);c.lineTo(-11.5,2);c.lineTo(-8,4.4);c.lineTo(5,5.2);c.closePath();c.fill();c.stroke();
 c.fillStyle=`rgba(${a.rgb},${al*.9})`;c.fillRect(-11,-13.8,6.5,2.6);c.fillRect(-11,11.2,6.5,2.6);
 c.beginPath();c.moveTo(9,0);c.lineTo(-9,0);c.strokeStyle=`rgba(${a.rgb},.45)`;c.lineWidth=.8;c.stroke();
 c.beginPath();c.ellipse(6.4,0,3.3,1.9,0,0,TAU);c.fillStyle=a.col;c.fill();
 return DSPR[k]={cv,sz}}
function drawDrone(c,p,a){
 const T=S.simT,sc=droneScale()*(p.free?Math.max(1,CAM.s*.8):CAM.s),st=p.st,on=st==='running'||p.fly,err=st==='failed',col=err?PAL.redRgb:st==='paused'?PAL.ambRgb:a.rgb;
 c.save();c.translate(p.x,p.y);
 c.globalCompositeOperation='lighter';
 if(on)glow(c,0,0,30*sc,col,.3+.12*Math.sin(T*5+a.idx));else if(st==='done')glow(c,0,0,20*sc,a.rgb,.14);
 if(err)glow(c,0,0,46*sc,PAL.redRgb,.35*(.5+.5*Math.sin(T*18)));
 c.rotate(p.h);c.scale(sc,sc);
 const th=p.thrust||.16;glow(c,-13-th*9,0,6+th*17,a.rgb,.5+th*.5);glow(c,-12,0,4,'255,255,255',.35+th*.55);
 c.globalCompositeOperation='source-over';
 const sp=droneSprite(a,st==='skipped'||st==='stopped');c.drawImage(sp.cv,-sp.sz/2,-sp.sz/2,sp.sz,sp.sz);
 if(((T*1.1+a.idx*.37)%1)<.12){c.fillStyle='#fff';c.fillRect(-9.2,-14.2,1.8,1.8);c.fillRect(-9.2,12.4,1.8,1.8)}
 c.restore();
}
function drawTrail(c,a,p){
 const sh=SHOW[a.id];if(!p.fly||!sh||!FLY[a.id]||S.lite)return;const u=showU(sh);let prev=p;c.globalCompositeOperation='lighter';c.lineCap='round';
 for(let k=1;k<=16;k++){const q=FLY[a.id](sh,u-k*.032);if(!q||u-k*.032<0)break;const f=1-k/16;c.lineWidth=f*5+.5;c.strokeStyle=`rgba(${a.rgb},${f*.55})`;c.beginPath();c.moveTo(prev.x,prev.y);c.lineTo(q.x,q.y);c.stroke();prev=q}
 c.globalCompositeOperation='source-over';
}
function linkTarget(id,p){
 if(id==='cloud')return stgScreen()||(()=>{const r=$('#btn-cloudgen').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})();
 if(id==='reference'){const v=M.assets.find(a=>a.kind==='video'||a.kind==='host_video');if(v){const r=capScreen(v.id);return{x:r.x+r.w*.15,y:r.y+r.h/2}}}
 return monEdgeS(p);
}
function drawLinks(c){
 const T=S.simT;
 for(const a of AG){const sh=SHOW[a.id];if(!sh||sh.paused)continue;const ph=showPhase(a.id,sh);if(ph==='away'||ph==='orbit')continue;
  const st=agentOf(a.id).status;if(st!=='running')continue;
  const p=agentPose(a.id),q=linkTarget(a.id,p);if(!q)continue;const u=showU(sh),f=Math.min(1,inv(0,.4,u-(a.id==='director'?5.5:0)));if(f<=0)continue;
  const free=a.id==='cloud'||a.id==='reference';if(!free){c.save();clipStage(c)}
  c.globalCompositeOperation='lighter';c.lineWidth=6;c.strokeStyle=`rgba(${a.rgb},${.07*f})`;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(q.x,q.y);c.stroke();
  c.lineWidth=1.3;c.setLineDash([7,9]);c.lineDashOffset=-T*80;c.strokeStyle=`rgba(${a.rgb},${.75*f})`;c.stroke();c.setLineDash([]);
  if(!S.lite)for(let k=0;k<3;k++){const v=(T*.85+k/3)%1;glow(c,lerp(p.x,q.x,v),lerp(p.y,q.y,v),7,a.rgb,f)}
  glow(c,q.x,q.y,18+5*Math.sin(T*8),a.rgb,.75*f);c.globalCompositeOperation='source-over';
  if(!free)c.restore()}
}
function drawScans(c){
 const bot=G.tl.y+G.tl.h-3;
 const scan=(id,y1,on)=>{if(on<=0)return;const p=agentPose(id),a=AGM[id],y0=p.y+7;if(y1<=y0)return;c.globalCompositeOperation='lighter';
  const g=c.createLinearGradient(0,y0,0,y1);g.addColorStop(0,`rgba(${a.rgb},${.42*on})`);g.addColorStop(1,`rgba(${a.rgb},${.04*on})`);c.fillStyle=g;c.beginPath();c.moveTo(p.x-3,y0);c.lineTo(p.x+3,y0);c.lineTo(p.x+16,y1);c.lineTo(p.x-16,y1);c.closePath();c.fill();
  c.fillStyle=`rgba(${a.rgb},${.85*on})`;c.fillRect(p.x-.7,y0,1.4,y1-y0);glow(c,p.x,y1,20,a.rgb,.55*on);c.globalCompositeOperation='source-over'};
 const win=(u,a,b)=>Math.min(inv(a-.12,a+.12,u),1-inv(b-.12,b+.12,u));
 const d=SHOW.director;if(d){const u=showU(d);if(u>.98&&u<4.42)scan('director',bot,win(u,1.1,4.3))}
 const au=SHOW.audio;if(au){const u=showU(au);if(u>.88&&u<9.12)scan('audio',bot,win(u,1,9))}
 const ed=SHOW.editor;if(ed&&!(ed.sorties||[]).length){const u=showU(ed);const row=tlRowScreen('shot');if(u>.88&&u<6.62)scan('editor',row.y+row.h,win(u,1,6.5))}
}
function sortieNow(){const sh=SHOW.editor;if(!sh||!sh.sorties||!sh.sorties.length)return null;const u=showU(sh),N=sh.sorties.length;if(u<SORTIE_T0||u>=SORTIE_T0+N*SORTIE_D)return null;const k=Math.min(N-1,Math.floor((u-SORTIE_T0)/SORTIE_D));return{k,s:sh.sorties[k],v:u-SORTIE_T0-k*SORTIE_D,sh}}
function flightRect(p,so){const u=showU(so.sh),hh=.06,a=FLY.editor(so.sh,u-hh),b=FLY.editor(so.sh,u+hh);let ax=0;if(a&&b)ax=(a.x-2*p.x+b.x)/(hh*hh);const phi=clamp(-ax/2400,-.55,.55),L=30;return{cx:p.x+Math.sin(phi)*L,cy:p.y+Math.cos(phi)*L,w:122,h:26,rot:phi*.7,m:0}}
function lerpR(a,b,e,m){return{cx:lerp(a.cx,b.cx,e),cy:lerp(a.cy,b.cy,e),w:lerp(a.w,b.w,e),h:lerp(a.h,b.h,e),rot:lerp(a.rot||0,b.rot||0,e),m}}
function cargoRect(so,p){
 const {s,v}=so;if(v<1||v>=2.85)return null;const fl=flightRect(p,so);
 if(v<1.35){const cr=capScreen(s.asset),e=E.o3(inv(1,1.35,v));return lerpR({cx:cr.x+cr.w/2,cy:cr.y+cr.h/2,w:cr.w,h:cr.h,rot:0},fl,e,0)}
 if(v<2.6)return fl;
 const sr=slotScreen(s),e=E.io3(inv(2.6,2.85,v));return lerpR(fl,{cx:sr.x+sr.w/2,cy:sr.y+sr.h/2,w:sr.w,h:sr.h,rot:0},e,e);
}
function glyph(c,type,x,y,s,col){c.save();c.translate(x,y);c.strokeStyle=col;c.fillStyle=col;c.lineWidth=Math.max(1,s*.16);c.lineJoin='round';c.lineCap='round';
 const f=typeOf(type).f;
 if(type==='image'){c.strokeRect(-s,-s*.75,s*2,s*1.5);c.beginPath();c.moveTo(-s,s*.5);c.lineTo(-s*.2,-s*.2);c.lineTo(s*.3,s*.25);c.lineTo(s*.6,0);c.lineTo(s,s*.4);c.stroke()}
 else if(f==='video'){c.strokeRect(-s,-s*.75,s*2,s*1.5);c.beginPath();c.moveTo(-s*.3,-s*.4);c.lineTo(s*.45,0);c.lineTo(-s*.3,s*.4);c.closePath();c.fill()}
 else if(type==='voice'){rrect(c,-s*.35,-s,s*.7,s*1.25,s*.35);c.stroke();c.beginPath();c.arc(0,-s*.1,s*.7,0,Math.PI);c.moveTo(0,s*.6);c.lineTo(0,s);c.stroke()}
 else if(f==='audio'){c.beginPath();c.moveTo(-s*.3,s*.6);c.lineTo(-s*.3,-s*.8);c.lineTo(s*.7,-s);c.lineTo(s*.7,s*.4);c.stroke();c.beginPath();c.arc(-s*.55,s*.62,s*.3,0,TAU);c.arc(s*.45,s*.42,s*.3,0,TAU);c.fill()}
 else{c.strokeRect(-s*.7,-s,s*1.4,s*2);c.beginPath();c.moveTo(-s*.35,-s*.3);c.lineTo(s*.35,-s*.3);c.moveTo(-s*.35,s*.2);c.lineTo(s*.35,s*.2);c.stroke()}
 c.restore()}
function drawCargo(c,r,s){
 const as=M.assets.find(a=>a.id===s.asset);if(!as)return;const ty=typeOf(as.kind),m=r.m||0;
 c.save();c.translate(r.cx,r.cy);c.rotate(r.rot||0);const w=Math.max(4,r.w),h=Math.max(4,r.h);
 c.globalCompositeOperation='lighter';glow(c,0,0,Math.max(w,h)*.75,ty.rgb,.32+.3*m);c.globalCompositeOperation='source-over';
 rrect(c,-w/2,-h/2,w,h,lerp(h/2,3,m));c.fillStyle=`rgba(8,14,38,.94)`;c.fill();c.lineWidth=1.3;c.strokeStyle=`rgba(${ty.rgb},.95)`;c.stroke();
 if(m<.6&&w>56){c.globalAlpha=1-m/.6;const hr=Math.max(1,h/2-3);c.beginPath();c.arc(-w/2+h/2,0,hr,0,TAU);c.fillStyle=`rgba(${ty.rgb},.22)`;c.fill();c.strokeStyle=`rgba(${ty.rgb},.9)`;c.lineWidth=1;c.stroke();
  glyph(c,as.kind,-w/2+h/2,0,h*.27,`rgb(${ty.rgb})`);c.fillStyle='#E8F1FF';c.font=`700 ${Math.max(12,Math.round(h*.46))}px ${FONT_UI}`;c.textBaseline='middle';c.textAlign='left';c.fillText(fitText(c,as.name,w-h-12),-w/2+h+3,1);c.globalAlpha=1}
 if(m>0){rrect(c,-w/2,-h/2,w,h,3);c.fillStyle=`rgba(${ty.rgb},${.4*m})`;c.fill()}
 c.restore();
}
function drawSortie(c){
 const so=sortieNow();if(!so)return;const {s,v}=so;if(v<.95||v>2.97)return;
 const p=agentPose('editor'),T=S.simT,A=AGM.editor.rgb;
 const beam=v<1.1?inv(.95,1.1,v):v<2.85?1:1-inv(2.85,2.97,v);const cg=cargoRect(so,p);
 if(beam>0){const bx=p.x,by=p.y+6,cx2=cg?cg.cx:bx,ty=cg?cg.cy-cg.h/2:by+40,hw=cg?Math.min(cg.w*.5,70):24;
  c.globalCompositeOperation='lighter';const g=c.createLinearGradient(0,by,0,ty);g.addColorStop(0,`rgba(${A},${.6*beam})`);g.addColorStop(1,`rgba(${A},${.14*beam})`);
  c.fillStyle=g;c.beginPath();c.moveTo(bx-4,by);c.lineTo(bx+4,by);c.lineTo(cx2+hw,ty);c.lineTo(cx2-hw,ty);c.closePath();c.fill();
  for(let k=0;k<4;k++){const f=(T*1.7+k/4)%1,yy=lerp(ty,by,f),xx=lerp(cx2,bx,f),ww=lerp(hw,4,f);c.strokeStyle=`rgba(${A},${.7*beam*(1-f)})`;c.lineWidth=1;c.beginPath();c.moveTo(xx-ww,yy);c.lineTo(xx+ww,yy);c.stroke()}
  if(!S.lite)for(let k=0;k<6;k++){const f=((T*.9+k/6)%1),xx=lerp(cx2+(hash(k*31)-.5)*hw*1.6,bx,f),yy=lerp(ty,by,f);glow(c,xx,yy,3.5,A,(1-f)*beam)}
  c.globalCompositeOperation='source-over'}
 if(cg)drawCargo(c,cg,s);
 if(v>2.0&&v<2.86){const sr=slotScreen(s),y=sr.y+sr.h+2,x0=sr.x+sr.w/2,ph=(T*3)%1;c.globalCompositeOperation='lighter';
  for(let k=1;k<=7;k++){const d=k*16,fl=((ph+k/7)%1);for(const sg of [-1,1]){glow(c,x0+sg*(d+(1-fl)*16),y,4,PAL.ambRgb,.9*(1-k/8))}}
  c.globalCompositeOperation='source-over'}
}
function burst(x,y,rgb,n=26,spd=260){if(S.lite)n=Math.ceil(n/3);for(let i=0;i<n;i++){const a=-Math.PI/2+(Math.random()-.5)*Math.PI*1.35,v=spd*(.35+Math.random()*.85),l=.45+Math.random()*.55;PARTS.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:l,max:l,rgb,w:1+Math.random()*1.6})}if(PARTS.length>600)PARTS.splice(0,PARTS.length-600)}
function shock(x,y,rgb,r1=70,dur=.6){RINGS.push({x,y,rgb,r1:Math.max(4,r1),dur,t:0})}
function stepParts(dt){for(let i=PARTS.length-1;i>=0;i--){const p=PARTS[i];p.life-=dt;if(p.life<=0){PARTS.splice(i,1);continue}p.vy+=560*dt;p.vx*=.985;p.x+=p.vx*dt;p.y+=p.vy*dt}for(let i=RINGS.length-1;i>=0;i--){RINGS[i].t+=dt;if(RINGS[i].t>=RINGS[i].dur)RINGS.splice(i,1)}}
function drawParts(c){c.globalCompositeOperation='lighter';c.lineCap='round';
 for(const p of PARTS){const a=p.life/p.max;c.strokeStyle=`rgba(${p.rgb},${a})`;c.lineWidth=p.w;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(p.x-p.vx*.035,p.y-p.vy*.035);c.stroke()}
 for(const r of RINGS){if(r.t<0)continue;const u=r.t/r.dur,e=E.o3(u);c.strokeStyle=`rgba(${r.rgb},${(1-u)*.9})`;c.lineWidth=2.6*(1-u)+.5;c.beginPath();c.arc(r.x,r.y,Math.max(0,4+e*r.r1),0,TAU);c.stroke();glow(c,r.x,r.y,34*(1-u)+10,r.rgb,(1-u)*.85)}
 c.globalCompositeOperation='source-over'}
const BOKEH=(()=>{const r=rng(99),a=[];for(let i=0;i<14;i++)a.push({x:r(),y:r(),r:26+r()*70,a:.035+r()*.05,c:r()<.6?'59,231,255':(r()<.5?'120,110,255':'255,79,216'),sp:.2+r()*.5});return a})();
function clipStage(c){const v=stageView();c.beginPath();c.rect(v.x,v.y,v.w,v.h);c.clip()}
function drawBokeh(c){const z=CAM.s-1;if(z<.03||S.lite)return;const v=stageView();c.save();clipStage(c);c.globalCompositeOperation='lighter';const cp=camPar();
 for(const b of BOKEH){const W=v.w*1.4,H=v.h*1.4;let x=(b.x*W-cp.ox*.9+S.simT*b.sp*14)%W;if(x<0)x+=W;x+=v.x-v.w*.2;let y=(b.y*H-cp.oy*.9)%H;if(y<0)y+=H;y+=v.y-v.h*.2;glow(c,x,y,b.r*(1+z*.6),b.c,b.a*Math.min(1,z*1.5))}
 c.restore()}
function drawReticle(c){
 const T=CAM.tgt;if(!T||!T.trk||!T.who||CAM.s<1.08)return;const p=agentPose(T.who),r=24*clamp(CAM.s/1.3,1,1.7),t=S.realT,A=PAL.accRgb;
 c.save();clipStage(c);c.translate(p.x,p.y);c.rotate(t*.5);c.strokeStyle=`rgba(${A},.9)`;c.lineWidth=1.6;for(let k=0;k<4;k++){c.rotate(Math.PI/2);c.beginPath();c.moveTo(r,-r*.42);c.lineTo(r,-r);c.lineTo(r*.42,-r);c.stroke()}c.restore();
}
function drawBloom(c){const w=warpAmt();if(w<=0)return;const p=w2s(G.C.x,G.C.y),R=G.R*CAM.s;c.save();clipStage(c);c.globalCompositeOperation='lighter';glow(c,p.x,p.y,R*(1.3+w*1.8),PAL.accRgb,w*.85);glow(c,p.x,p.y,R*(.6+w),'255,255,255',w*.75);c.restore()}
function drawFx(){
 const c=X.fx,d=S.dpr;if(CV.fx.width<2||CV.fx.height<2)return;c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,S.W,S.H);
 if(!M.project){drawParts(c);return}
 drawLinks(c);drawScans(c);
 const poses=AG.map(a=>[a,agentPose(a.id)]);
 for(const [a,p] of poses)drawTrail(c,a,p);
 drawSortie(c);
 for(const [a,p] of poses){if(p.free)drawDrone(c,p,a);else{c.save();clipStage(c);drawDrone(c,p,a);c.restore()}}
 drawParts(c);drawBokeh(c);drawReticle(c);drawBloom(c);
}
