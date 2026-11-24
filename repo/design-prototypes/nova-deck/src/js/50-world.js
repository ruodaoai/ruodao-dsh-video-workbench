/* ======================= canvases & sprites ======================= */
const CV={bg:$('#cv-bg'),world:$('#cv-world'),fx:$('#cv-fx'),tl:$('#cv-tl'),mon:$('#cv-mon'),mini:$('#cv-mini'),spark:$('#cv-spark')};
const X={};for(const k in CV)X[k]=CV[k].getContext('2d');
let MONQ=2;
function fitCanvas(cv,w,h){w=Math.max(2,Math.round(w));h=Math.max(2,Math.round(h));if(cv.width!==w)cv.width=w;if(cv.height!==h)cv.height=h}
function sizeCanvases(){
 fitCanvas(CV.bg,S.W*S.dpr,S.H*S.dpr);fitCanvas(CV.fx,S.W*S.dpr,S.H*S.dpr);
 fitCanvas(CV.world,G.st.w*S.dpr,G.st.h*S.dpr);
 sizeMonCanvas();
}
function sizeMonCanvas(){MONQ=Math.min(S.dpr*2,2400/Math.max(1,G.mon.w));fitCanvas(CV.mon,G.mon.w*MONQ,G.mon.h*MONQ);MON.last=-1}
const SPR={};
function glowSpr(rgb){if(SPR[rgb])return SPR[rgb];const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');const g=x.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,`rgba(${rgb},1)`);g.addColorStop(.22,`rgba(${rgb},.5)`);g.addColorStop(.55,`rgba(${rgb},.12)`);g.addColorStop(1,`rgba(${rgb},0)`);x.fillStyle=g;x.fillRect(0,0,64,64);return SPR[rgb]=c}
function glow(c,x,y,r,rgb,a){if(!(a>.003)||!(r>0)||!Number.isFinite(x)||!Number.isFinite(y))return;c.globalAlpha=Math.min(1,a);c.drawImage(glowSpr(rgb),x-r,y-r,r*2,r*2);c.globalAlpha=1}
function rrect(c,x,y,w,h,r){w=Math.max(0,w);h=Math.max(0,h);r=Math.max(0,Math.min(r,w/2,h/2));c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath()}
const TXTC=new Map();
function fitText(c,s,maxW){s=String(s||'');if(maxW<=4)return '';const k=c.font+'|'+s+'|'+(maxW|0);if(TXTC.has(k))return TXTC.get(k);let r=s;if(c.measureText(s).width>maxW){let lo=0,hi=s.length;while(lo<hi){const m=(lo+hi+1)>>1;if(c.measureText(s.slice(0,m)+'…').width<=maxW)lo=m;else hi=m-1}r=lo>0?s.slice(0,lo)+'…':''}if(TXTC.size>4000)TXTC.clear();TXTC.set(k,r);return r}

/* ======================= deep space: nebula + parallax stars (full window) ======================= */
let BG=null;
function buildBg(){
 const w=Math.max(320,Math.round(S.W*.5)),h=Math.max(200,Math.round(S.H*.5));
 const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');
 const g=x.createLinearGradient(0,0,0,h);g.addColorStop(0,'#070a1c');g.addColorStop(.5,'#05070F');g.addColorStop(1,'#04050c');x.fillStyle=g;x.fillRect(0,0,w,h);
 const blob=(cx,cy,r,col,a)=>{const rg=x.createRadialGradient(cx*w,cy*h,0,cx*w,cy*h,r*w);rg.addColorStop(0,`rgba(${col},${a})`);rg.addColorStop(1,`rgba(${col},0)`);x.fillStyle=rg;x.fillRect(0,0,w,h)};
 x.globalCompositeOperation='lighter';
 blob(.5,.42,.5,'22,32,104',.62);blob(.18,.7,.36,'56,26,116',.34);blob(.86,.2,.3,'12,80,118',.26);blob(.92,.86,.24,'255,79,216',.06);blob(.34,.12,.24,'59,231,255',.05);blob(.56,.46,.16,'59,231,255',.07);
 const r=rng(42);for(let i=0;i<80;i++){const cx=r(),cy=.18+r()*.7;blob(cx,cy,.025+r()*.08,r()<.7?'58,68,168':'112,58,170',.03+r()*.035)}
 x.globalCompositeOperation='source-over';
 const pcx=w*.66,pcy=h*2.5,pr=h*1.84;x.save();x.beginPath();x.arc(pcx,pcy,pr,0,TAU);x.fillStyle='#03040b';x.fill();
 const pg=x.createRadialGradient(pcx,pcy-pr*.25,pr*.78,pcx,pcy,pr);pg.addColorStop(0,'rgba(8,12,40,0)');pg.addColorStop(1,'rgba(34,66,150,.32)');x.fillStyle=pg;x.fill();
 x.globalCompositeOperation='lighter';x.lineWidth=h*.03;x.strokeStyle='rgba(59,231,255,.045)';x.stroke();x.lineWidth=h*.008;x.strokeStyle='rgba(120,220,255,.14)';x.stroke();x.lineWidth=1;x.strokeStyle='rgba(190,242,255,.42)';x.stroke();x.restore();
 for(let i=0;i<1000;i++){x.fillStyle=`rgba(200,215,255,${.02+r()*.06})`;x.fillRect(r()*w,r()*h,1,1)}
 BG=c;STAR_TILES=null;BGC.key='';
}
const STARS=(()=>{const r=rng(7),L=[];for(const [n,f,s0,s1,a0,a1] of [[330,.05,.6,1.1,.16,.55],[120,.13,.9,1.6,.3,.8],[30,.3,1.4,2.3,.55,1]]){const arr=[];for(let i=0;i<n;i++)arr.push({x:r(),y:r(),s:lerp(s0,s1,r()),a:lerp(a0,a1,r()),tw:.6+r()*2.6,ph:r()*TAU,c:r()<.14?'170,225,255':(r()<.1?'255,214,170':'225,233,255')});L.push({f,arr})}return L})();
let STAR_TILES=null;
function buildStarTiles(){const tw=Math.ceil(S.W*1.3),th=Math.ceil(S.H*1.3);STAR_TILES=STARS.map((L,li)=>{const cv=document.createElement('canvas');cv.width=tw;cv.height=th;const x=cv.getContext('2d');
 for(const st of L.arr){if(li>0&&st.tw>2.3)continue;const sx=st.x*tw,sy=st.y*th;x.fillStyle=`rgba(${st.c},${st.a*.86})`;x.fillRect(sx-st.s/2,sy-st.s/2,st.s,st.s);if(li===2&&st.a>.78){x.fillStyle=`rgba(${st.c},${st.a*.3})`;x.fillRect(sx-st.s*2.4,sy-.4,st.s*4.8,.8);x.fillRect(sx-.4,sy-st.s*2.4,.8,st.s*4.8)}}
 return cv})}
/* parallax offset follows the stage camera (in screen px) */
const camPar=()=>{const v=vcen();return{ox:(CAM.x-v.x)*CAM.s,oy:(CAM.y-v.y)*CAM.s,z:CAM.s}};
function drawStars(c,warp){
 if(!STAR_TILES)buildStarTiles();const tw=S.W*1.3,th=S.H*1.3,cp=camPar(),cs=w2s(G.C.x,G.C.y),vc={x:S.W/2,y:S.H/2};
 for(let li=0;li<STARS.length;li++){const L=STARS[li],f=L.f,zf=1+(cp.z-1)*f*1.8,ox=cp.ox*f*1.6,oy=cp.oy*f*1.6;
  if(warp>.02&&li>0){c.beginPath();for(const st of L.arr){let px=(st.x*tw-ox)%tw;if(px<0)px+=tw;let py=(st.y*th-oy)%th;if(py<0)py+=th;px-=(tw-S.W)/2;py-=(th-S.H)/2;const sx=vc.x+(px-vc.x)*zf,sy=vc.y+(py-vc.y)*zf,dx=sx-cs.x,dy=sy-cs.y,k=warp*(.1+f*.95);c.moveTo(sx,sy);c.lineTo(sx+dx*k,sy+dy*k)}c.strokeStyle=`rgba(225,240,255,${.35+warp*.55})`;c.lineWidth=li===2?1.8:1.1;c.stroke();continue}
  const bx=-(((ox%tw)+tw)%tw)-(tw-S.W)/2,by=-(((oy%th)+th)%th)-(th-S.H)/2;
  const X0=vc.x+(bx-vc.x)*zf,Y0=vc.y+(by-vc.y)*zf,TW=tw*zf,TH=th*zf;
  for(let i=0;i<3;i++)for(let j=0;j<3;j++){const x=X0+i*TW,y=Y0+j*TH;if(x>S.W||y>S.H||x+TW<0||y+TH<0)continue;c.drawImage(STAR_TILES[li],x,y,TW,TH)}
 }
}
function drawTwinkle(c){if(S.lite)return;const T=S.simT,tw=S.W*1.3,th=S.H*1.3,cp=camPar(),vc={x:S.W/2,y:S.H/2};if(warpAmt()>.02)return;
 for(let li=1;li<STARS.length;li++){const L=STARS[li],f=L.f,zf=1+(cp.z-1)*f*1.8,ox=cp.ox*f*1.6,oy=cp.oy*f*1.6;
  for(const st of L.arr){if(st.tw<=2.3)continue;let px=(st.x*tw-ox)%tw;if(px<0)px+=tw;let py=(st.y*th-oy)%th;if(py<0)py+=th;px-=(tw-S.W)/2;py-=(th-S.H)/2;const sx=vc.x+(px-vc.x)*zf,sy=vc.y+(py-vc.y)*zf;if(sx<-10||sy<-10||sx>S.W+10||sy>S.H+10)continue;c.fillStyle=`rgba(${st.c},${st.a*(.45+.55*Math.abs(Math.sin(T*st.tw*.6+st.ph)))})`;c.fillRect(sx-st.s/2,sy-st.s/2,st.s,st.s)}}
}
function drawBgLayer(c,w,h,warp){const cp=camPar(),k=1+(cp.z-1)*.08,ox=cp.ox*.06,oy=cp.oy*.06,bw=w*1.12*k,bh=h*1.12*k;if(BG)c.drawImage(BG,(w-bw)/2-ox,(h-bh)/2-oy,bw,bh);else{c.fillStyle='#05070F';c.fillRect(0,0,w,h)}drawStars(c,warp)}
const BGC={cv:document.createElement('canvas'),key:''};
function drawBackground(){
 const c=X.bg,d=S.dpr,wa=warpAmt();if(CV.bg.width<2)return;c.setTransform(d,0,0,d,0,0);
 const key=[S.W,S.H,d,CAM.x.toFixed(1),CAM.y.toFixed(1),CAM.s.toFixed(4)].join('|');
 if(wa>.02||BGC.key!==key){const b=BGC.cv;if(b.width!==CV.bg.width||b.height!==CV.bg.height){b.width=CV.bg.width;b.height=CV.bg.height}const x=b.getContext('2d');x.setTransform(d,0,0,d,0,0);drawBgLayer(x,S.W,S.H,wa);BGC.key=wa>.02?'':key}
 c.drawImage(BGC.cv,0,0,S.W,S.H);drawTwinkle(c);
}

/* ======================= porthole HUD rings (stage world canvas, clipped below the strip) ======================= */
function arcP(c,r,a0,a1){c.beginPath();c.arc(G.C.x,G.C.y,Math.max(0,r),a0,a1)}
let PSPR=null;
function buildPortholeSprites(){
 const R=Math.max(10,G.R),q=Math.min(3,S.dpr*2.2),ext=R*1.27,sz=Math.min(4096,Math.ceil(ext*2*q)),A=PAL.accRgb;
 const mk=()=>{const cv=document.createElement('canvas');cv.width=cv.height=sz;const c=cv.getContext('2d');const qq=sz/(ext*2);c.setTransform(qq,0,0,qq,ext*qq,ext*qq);return[cv,c]};
 const [sa,c]=mk();const ring=(r,w,a,dash)=>{c.beginPath();c.arc(0,0,r,0,TAU);c.lineWidth=w;c.strokeStyle=`rgba(${A},${a})`;if(dash)c.setLineDash(dash);c.stroke();if(dash)c.setLineDash([])};
 c.strokeStyle=`rgba(${A},.22)`;c.lineWidth=1;c.setLineDash([3,5]);c.beginPath();for(let k=0;k<4;k++){const a=k*Math.PI/2+Math.PI/4;c.moveTo(Math.cos(a)*R*1.1,Math.sin(a)*R*1.1);c.lineTo(Math.cos(a)*R*1.22,Math.sin(a)*R*1.22)}c.stroke();c.setLineDash([]);
 const r6=R*1.075;ring(r6,1,.26,[2,7]);
 c.fillStyle=`rgba(${A},.6)`;for(let k=0;k<4;k++){const a=k*Math.PI/2;c.save();c.translate(Math.cos(a)*(r6+7),Math.sin(a)*(r6+7));c.rotate(a);c.beginPath();c.moveTo(-3,-4);c.lineTo(3,0);c.lineTo(-3,4);c.closePath();c.fill();c.restore()}
 ring(R,1.2,.38);
 ring(R*.955,1,.17);ring(R*.83,1.4,.5);
 c.beginPath();for(let i=0;i<360;i+=2){const a=i*Math.PI/180;c.moveTo(Math.cos(a)*R*1.03,Math.sin(a)*R*1.03);c.lineTo(Math.cos(a)*R*(i%10?1.036:1.045),Math.sin(a)*R*(i%10?1.036:1.045))}c.strokeStyle=`rgba(${A},.18)`;c.lineWidth=1;c.stroke();
 const [sb,cb]=mk();const r2=R*.87;cb.beginPath();for(let i=0;i<180;i++){const a=i*TAU/180,l=i%5===0?R*.032:R*.014;cb.moveTo(Math.cos(a)*r2,Math.sin(a)*r2);cb.lineTo(Math.cos(a)*(r2-l),Math.sin(a)*(r2-l))}cb.strokeStyle=`rgba(${A},.42)`;cb.lineWidth=1;cb.stroke();
 PSPR={sa,sb,ext};
}
const runProg=()=>M.run?clamp(M.run.progress/100,0,1):0;
const isDone=()=>!!M.run&&M.run.status==='completed';
function warpAmt(){if(S.readyAt<0||S.lite)return 0;const t=S.simT-S.readyAt;return Math.max(0,Math.min(inv(0,.7,t),1-inv(.85,2.2,t)))}
function drawPorthole(c){
 if(!M.project)return;
 if(!PSPR)buildPortholeSprites();
 const cx=G.C.x,cy=G.C.y,R=G.R,T=S.simT,A=PAL.accRgb,ext=PSPR.ext,run=M.run,live=isLive(),done=isDone(),failed=run&&run.status==='failed';
 const prog=runProg(),gb=done&&S.readyAt>=0?.45+.55*Math.exp(-Math.max(0,S.simT-S.readyAt)*.8):done?.45:0;
 c.save();c.lineCap='butt';
 c.globalCompositeOperation='lighter';glow(c,cx,cy,R*1.25,failed?PAL.redRgb:A,.12+.3*gb);c.globalCompositeOperation='source-over';
 if(c.createConicGradient&&!S.lite){const cg=c.createConicGradient(-T*.32,cx,cy);cg.addColorStop(0,`rgba(${A},.13)`);cg.addColorStop(.09,`rgba(${A},0)`);cg.addColorStop(1,`rgba(${A},0)`);c.fillStyle=cg;c.beginPath();c.arc(cx,cy,R*.985,0,TAU);c.arc(cx,cy,R*.84,0,TAU,true);c.fill()}
 c.drawImage(PSPR.sa,cx-ext,cy-ext,ext*2,ext*2);
 c.save();c.translate(cx,cy);c.rotate(-T*.012);c.drawImage(PSPR.sb,-ext,-ext,ext*2,ext*2);c.restore();
 const r6=R*1.075;c.lineWidth=2;c.strokeStyle=`rgba(${A},.6)`;c.beginPath();for(let k=0;k<3;k++){const a0=T*.11+k*TAU/3;c.moveTo(cx+Math.cos(a0)*r6,cy+Math.sin(a0)*r6);c.arc(cx,cy,r6,a0,a0+.36)}c.stroke();
 const r1=R*.83;c.lineWidth=3;c.strokeStyle=`rgba(${A},.85)`;c.beginPath();for(let k=0;k<4;k++){const a=k*Math.PI/2+T*.04;c.moveTo(cx+Math.cos(a-.09)*r1,cy+Math.sin(a-.09)*r1);c.arc(cx,cy,r1,a-.09,a+.09)}c.stroke();
 // per-agent ring segments + leader lines to the labels
 for(const ag of AG){const st=agentOf(ag.id).status,on=st==='running',col=st==='failed'?PAL.redRgb:st==='paused'?PAL.ambRgb:ag.rgb,al=st==='skipped'?.16:on||st==='failed'?.95:st==='done'?.62:.36;
  c.strokeStyle=`rgba(${col},${al})`;c.lineWidth=3.4;arcP(c,R,ag.rad-.075,ag.rad+.075);c.stroke();
  const L=G.lab&&G.lab[ag.id];c.lineWidth=1.2;c.strokeStyle=`rgba(${col},${Math.min(.75,al)})`;c.beginPath();for(const s of [-1,1]){const a=ag.rad+s*.09;c.moveTo(cx+Math.cos(a)*(R-6),cy+Math.sin(a)*(R-6));c.lineTo(cx+Math.cos(a)*(R+6),cy+Math.sin(a)*(R+6))}
  if(L){const s0=droneScale()*17+4;const d=G.docks[ag.id];const dx=L.ax-d.x,dy=L.ay-d.y,dl=Math.hypot(dx,dy);if(dl>s0+4){c.moveTo(d.x+dx/dl*s0,d.y+dy/dl*s0);c.lineTo(L.ax,L.ay)}}c.stroke()}
 const r4=R*.955;c.globalCompositeOperation='lighter';
 if(!S.lite)for(let b=0;b<7;b++){const a=b*TAU/7+T*(b%2?.09:-.06);glow(c,cx+Math.cos(a)*r4,cy+Math.sin(a)*r4,5,A,.55)}
 drawPulses(c,r4);c.globalCompositeOperation='source-over';
 // progress ring (run.progress)
 const r3=R*.915,bw=clamp(R*.03,5,11),N=72,lit=Math.floor(prog*N+1e-6),cell=TAU/N,pc=failed?PAL.redRgb:run&&run.status==='paused'?PAL.ambRgb:A;
 c.lineWidth=bw;c.beginPath();for(let i=lit;i<N;i++){const a0=-Math.PI/2+i*cell+.012;c.moveTo(cx+Math.cos(a0)*r3,cy+Math.sin(a0)*r3);c.arc(cx,cy,r3,a0,a0+cell*.7)}c.strokeStyle=`rgba(${A},.08)`;c.stroke();
 if(lit>0){c.beginPath();for(let i=0;i<lit;i++){const a0=-Math.PI/2+i*cell+.012;c.moveTo(cx+Math.cos(a0)*r3,cy+Math.sin(a0)*r3);c.arc(cx,cy,r3,a0,a0+cell*.7)}c.strokeStyle=done?'rgba(226,250,255,.92)':`rgba(${pc},.8)`;c.stroke()}
 c.globalCompositeOperation='lighter';
 if(live&&run.status!=='paused'&&lit<N){const a0=-Math.PI/2+lit*cell+.012;c.strokeStyle=`rgba(255,255,255,${.35+.6*Math.abs(Math.sin(T*9))})`;arcP(c,r3,a0,a0+cell*.7);c.stroke();glow(c,cx+Math.cos(a0)*r3,cy+Math.sin(a0)*r3,18,A,.7)}
 if(done){c.strokeStyle='rgba(255,255,255,.55)';c.beginPath();for(let k=0;k<3;k++){const a0=-Math.PI/2+((T*.55+k/3)%1)*TAU;c.moveTo(cx+Math.cos(a0)*r3,cy+Math.sin(a0)*r3);c.arc(cx,cy,r3,a0,a0+cell*2.2)}c.stroke()}
 c.globalCompositeOperation='source-over';
 // ignition rings right after completion
 if(done&&S.readyAt>=0){const t=S.simT-S.readyAt;if(t<8)[r1,R*.87,r3,r4,R,r6].forEach((r,k)=>{const g=inv(k*.24,k*.24+.42,t);if(g<=0)return;const a0=-Math.PI/2,a1=a0+TAU*E.o3(g),fade=1-clamp((t-(k*.24+.42))*.55,0,.82);
   c.globalCompositeOperation='lighter';c.lineWidth=k===2?bw+2:3.2;c.strokeStyle=`rgba(226,250,255,${.95*fade})`;arcP(c,r,a0,a1);c.stroke();
   if(g<1)glow(c,cx+Math.cos(a1)*r,cy+Math.sin(a1)*r,26,'230,250,255',1);c.globalCompositeOperation='source-over'})}
 c.restore();
}
function drawPulses(c,r){
 for(const p of PULSES){const t=S.simT-p.t0;if(t<0||t>p.dur+.3)continue;const u=inv(0,p.dur,t),e=E.io2(u),a0=AGM[p.from].rad,a1=a0+angDiff(a0,AGM[p.to].rad),head=lerp(a0,a1,e),dir=Math.sign(a1-a0)||1,col=AGM[p.from].rgb;
  if(u<1){for(let k=0;k<16;k++){const a=head-dir*k*.021;glow(c,G.C.x+Math.cos(a)*r,G.C.y+Math.sin(a)*r,8-k*.35,col,(1-k/16)*.95)}glow(c,G.C.x+Math.cos(head)*r,G.C.y+Math.sin(head)*r,14,'255,255,255',.85)}
  else{const fa=inv(p.dur,p.dur+.3,t),d=G.docks[p.to];if(d)glow(c,d.x,d.y,(34+30*fa)*(G.R/320),AGM[p.to].rgb,1-fa)}}
}
function drawWorld(){
 const c=X.world,d=S.dpr;if(CV.world.width<2||CV.world.height<2)return;
 c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,G.st.w,G.st.h);
 c.save();c.beginPath();c.rect(0,G.strip,G.st.w,G.st.h-G.strip);c.clip();
 c.setTransform(d*CAM.s,0,0,d*CAM.s,d*CAM.tx,d*CAM.ty);drawPorthole(c);
 c.restore();
}
