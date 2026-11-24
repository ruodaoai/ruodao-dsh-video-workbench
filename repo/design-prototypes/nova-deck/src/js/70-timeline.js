/* =====================================================================
   RUNWAY · multi-track timeline (real timeline data)
   V1 scenes (thumbs when rendered) · T1 subtitles · A1 voice · A2 sfx · A3 music
   ===================================================================== */
const TL={cssW:0,cssH:0,q:2,padL:6,padR:10,rows:{},view0:0,zoom:1,pps:10,fitPps:10,goal:null,hover:-1,dirty:true};
const THUMBS=new Map(); // url → {img, ok}
function thumbImg(url){if(!url)return null;let t=THUMBS.get(url);if(!t){const img=new Image();t={img,ok:false,err:false};img.decoding='async';img.onload=()=>{t.ok=true;TL.dirty=true;MON.last=-1;DIRTY.caps=true};img.onerror=()=>{t.err=true};img.src=url;THUMBS.set(url,t);if(THUMBS.size>400){const k=THUMBS.keys().next().value;THUMBS.delete(k)}}return t.ok?t.img:null}
function tlDur(){return Math.max(1,M.tl.totalSec||0)}
function tlLayout(){
 const wrap=$('#tl-wrap');TL.cssW=Math.max(100,wrap.clientWidth);TL.cssH=Math.max(60,wrap.clientHeight);
 const q=Math.min(2*S.dpr,4096/TL.cssW);TL.q=q;fitCanvas(CV.tl,TL.cssW*q,TL.cssH*q);
 const rh=TL.cssH<140?19:22,g=3,avail=TL.cssH-rh-5-g*4,fr={shot:.29,sub:.15,vo:.2,sfx:.16,bgm:.2};
 TL.rows.ruler={y:0,h:rh};let y=rh+3;for(const t of TRACKS){const h=Math.max(9,Math.round(avail*fr[t.k]));TL.rows[t.k]={y,h};y+=h+g}
 TL.fitPps=(TL.cssW-TL.padL-TL.padR)/tlDur();tlApplyZoom();
 const hd=$('#tl-heads');if(!hd._b){hd.innerHTML=`<div class="tl-h ru" data-r="ruler"><span class="rt">时间 · 拍点</span></div>`+TRACKS.map(t=>`<div class="tl-h" data-r="${t.k}" style="--c:${t.c}"><b>${t.code}</b><span>${t.n}</span><em>${t.en.toUpperCase()}</em><i class="rl"></i></div>`).join('');hd._b=1}
 $$('.tl-h',hd).forEach(el=>{const r=TL.rows[el.dataset.r];el.style.top=r.y+'px';el.style.height=r.h+'px';setCls(el,'tiny',r.h<14)});
 const r=wrap.getBoundingClientRect();G.tl={x:r.left,y:r.top,w:r.width,h:r.height};
 TL.dirty=true;
}
function tlApplyZoom(){TL.pps=TL.fitPps*TL.zoom;const vis=(TL.cssW-TL.padL-TL.padR)/TL.pps;TL.view0=clamp(TL.view0,0,Math.max(0,tlDur()-vis))}
const tX=t=>TL.padL+(t-TL.view0)*TL.pps,xT=x=>TL.view0+(x-TL.padL)/TL.pps;
function tlEnsure(t){if(TL.zoom<=1.01)return;const vis=(TL.cssW-TL.padL-TL.padR)/TL.pps;if(t<TL.view0+vis*.1||t>TL.view0+vis*.85){TL.goal=clamp(t-vis*.4,0,tlDur()-vis)}}
const ZLV=[1,2,4,8];
function tlZoomSet(i){i=clamp(i,0,3);const anchor=playheadT()||0;TL.zoom=ZLV[i];TL.pps=TL.fitPps*TL.zoom;const vis=(TL.cssW-TL.padL-TL.padR)/TL.pps;TL.view0=clamp(anchor-vis*.4,0,Math.max(0,tlDur()-vis));TL.goal=null;tlApplyZoom();const tz=$('#tz');if(tz._set&&tz._i!==i)tz._set(i,false);TL.dirty=true}
const tlZoomStep=d=>tlZoomSet(ZLV.indexOf(TL.zoom)+d);
let HATCH=null;
function hatch(c){if(HATCH)return HATCH;const h=document.createElement('canvas');h.width=h.height=6;const x=h.getContext('2d');x.strokeStyle='rgba(255,255,255,.16)';x.lineWidth=1;x.beginPath();x.moveTo(-1,7);x.lineTo(7,-1);x.stroke();HATCH=c.createPattern(h,'repeat');return HATCH}
/* the playhead: preview time when the video is loaded, else the active work position */
function workT(){const run=M.run,tot=M.tl.totalSec;if(!run||!tot)return null;
 if(run.status==='completed')return null;
 const a=run.activeAgentId,ag=a?agentOf(a):null;
 if(a==='director'){const d=directorScan();return d==null?null:tot*d}
 if(a==='audio'){const s=audioSweep();return s==null?null:tot*s}
 if(a==='editor'){const so=sortieNow();if(so){const sc=M.tl.scenes[so.s.sc];return sc?sc.startSec:0}return ag?tot*clamp(ag.progress/100,0,1):null}
 if(a==='motion'||a==='qa'||a==='avatar')return ag?tot*clamp(ag.progress/100,0,1):null;
 return null}
function playheadT(){if(MONV.ready&&(MONV.v.currentTime>0||!MONV.v.paused))return MONV.v.currentTime;return workT()}
function sceneVis(sc){const t=S.sceneAppear[sc.id];return t==null?1:clamp((S.simT-t)/.35,0,1)}
function motionLit(sc){const ag=agentOf('motion');if(ag.status==='done')return 1;if(ag.status!=='running')return 0;const n=M.tl.scenes.length||1;const k=ag.progress/100*n;return clamp(k-sc.i,0,1)}
function sfxShown(f){const s=audioSweep(),ag=agentOf('audio');if(ag.status==='done'||isDone())return 1;if(s==null)return M.run?0:1;return M.tl.totalSec?clamp((s*M.tl.totalSec-f.t)*2+.5,0,1):1}
function drawTimeline(){
 const c=X.tl,q=TL.q,W=TL.cssW,H=TL.cssH,T=S.simT,A=PAL.accRgb,R=TL.rows,rr=R.ruler,tot=M.tl.totalSec,live=isLive();
 if(CV.tl.width<2)return;
 c.setTransform(q,0,0,q,0,0);c.clearRect(0,0,W,H);c.textBaseline='middle';c.textAlign='left';
 c.fillStyle='rgba(255,255,255,.022)';for(const t of TRACKS){const r=R[t.k];c.fillRect(0,r.y,W,r.h)}
 c.fillStyle='rgba(255,255,255,.045)';for(const t of TRACKS){const r=R[t.k];c.fillRect(0,r.y+r.h,W,1)}
 c.fillStyle='rgba(2,4,12,.55)';c.fillRect(0,0,W,rr.h);
 if(!M.project||!tot){emptyRunway(c,W,H);return}
 // ruler ticks + time labels (≥ 12 px, never overlapping: step chosen from label width)
 const TZ=14; // ruler: labels live in y<14, ticks / beats / drops below
 c.font=`500 12px ${FONT_HUD}`;const lblW=c.measureText('00:00').width+14;
 const steps=[1,2,5,10,15,30,60,120,300,600];let step=steps.find(s=>s*TL.pps>=lblW)||600;
 const minor=step<=2?step/2:step<=10?1:step<=60?5:30;
 const pm=new Path2D(),pM=new Path2D();
 for(let t=0;t<=tot+.01;t+=minor){const x=Math.round(tX(t));if(x<-30||x>W+30)continue;const maj=Math.abs(t/step-Math.round(t/step))<1e-6;if(maj)pM.rect(x,TZ,1,rr.h-TZ);else pm.rect(x,rr.h-3,1,3)}
 c.fillStyle='rgba(166,181,218,.25)';c.fill(pm);c.fillStyle='rgba(166,181,218,.7)';c.fill(pM);
 c.textBaseline='alphabetic';c.fillStyle='rgba(166,181,218,.85)';for(let t=0;t<=tot+.01;t+=step){const x=tX(t);if(x<-30||x>W-lblW+12)continue;c.fillText(fmtMS(t),x+3,TZ-2)}c.textBaseline='middle';
 // beats (strong taller) + beat grid + drops
 const dscan=directorScan(),beatsVisible=t=>dscan==null?true:t<=dscan*tot;
 if(M.tl.beats.length){const ws=new Path2D(),ss=new Path2D(),wg=new Path2D(),sg=new Path2D();
  for(const b of M.tl.beats){if(!beatsVisible(b.t))continue;const x=tX(b.t);if(x<-2||x>W+2)continue;(b.s?ss:ws).rect(x-(b.s?1:.5),b.s?TZ:rr.h-3,b.s?2:1,b.s?rr.h-TZ:3);(b.s?sg:wg).rect(x-.5,R.shot.y,1,H-R.shot.y)}
  c.fillStyle=`rgba(${A},.45)`;c.fill(ws);c.fillStyle=`rgba(${PAL.ambRgb},.9)`;c.fill(ss);c.fillStyle=`rgba(${A},.025)`;c.fill(wg);c.fillStyle=`rgba(${A},.07)`;c.fill(sg)}
 if(dscan!=null&&dscan<1){const x=tX(tot*dscan);c.fillStyle=`rgba(${AGM.director.rgb},.12)`;c.fillRect(0,TZ,Math.max(0,x),rr.h-TZ)}
 for(const d of M.tl.drops){if(!beatsVisible(d))continue;const x=tX(d);if(x<-10||x>W+10)continue;
  c.strokeStyle=`rgba(${PAL.magRgb},.55)`;c.setLineDash([3,3]);c.lineWidth=1;c.beginPath();c.moveTo(x,rr.h);c.lineTo(x,H);c.stroke();c.setLineDash([]);
  const dm=(TZ+rr.h)/2,dh=Math.max(2,(rr.h-TZ)/2);c.fillStyle=PAL.mag;c.beginPath();c.moveTo(x,dm-dh);c.lineTo(x+dh,dm);c.lineTo(x,dm+dh);c.lineTo(x-dh,dm);c.closePath();c.fill()}
 // V1 scenes
 const sr=R.shot,scenes=M.tl.scenes;
 if(scenes.length){
  const txt=[],flash=[],shim=[];const ph=new Path2D();
  for(const sc of scenes){const vis=sceneVis(sc);const xa=tX(sc.startSec)+.5,xb=tX(sc.endSec)-.5,w=xb-xa;if(xb<0||xa>W||w<=0)continue;
   if(vis<=0)continue;
   const lit=motionLit(sc),img=sc.thumbUrl?thumbImg(sc.thumbUrl):null;
   c.globalAlpha=vis;
   if(img&&w>6){c.save();c.beginPath();c.rect(xa,sr.y+2,w,sr.h-4);c.clip();const ih=sr.h-4,iw=ih*16/9;for(let x=xa;x<xb;x+=iw)c.drawImage(img,x,sr.y+2,iw,ih);c.restore();c.fillStyle='rgba(2,4,14,.35)';c.fillRect(xa,sr.y+2,w,sr.h-4)}
   else{c.fillStyle=`rgba(${sc.col},${.26+.36*lit})`;c.fillRect(xa,sr.y+2,w,sr.h-4)}
   c.fillStyle=`rgba(${sc.col},.95)`;c.fillRect(xa,sr.y+2,w,1.6);
   if(sc.locked){c.fillStyle='rgba(255,181,71,.9)';c.fillRect(xa,sr.y+sr.h-4,w,2)}
   if(TL.hover===sc.i){c.strokeStyle='rgba(255,255,255,.9)';c.lineWidth=1.2;c.strokeRect(xa+.5,sr.y+2.5,w-1,sr.h-5)}
   c.globalAlpha=1;
   if(vis<1)flash.push([xa,w,1-vis]);
   if(lit>0&&lit<1)shim.push([xa,w,lit]);
   if(w>34&&sr.h>=14)txt.push([sc.title,xa+4,w-8,lit>0||!!img]);
  }
  for(const [x,w,f] of flash){c.fillStyle=`rgba(255,255,255,${f*.6})`;c.fillRect(x,sr.y+2,w,sr.h-4)}
  for(const [x,w,u] of shim){c.fillStyle=`rgba(255,255,255,${.85*(1-u)})`;c.fillRect(x+u*w-1.5,sr.y+2,3,sr.h-4)}
  c.font=`700 12px ${FONT_UI}`;
  for(const [t,x,w,b] of txt){const s=fitText(c,t,w);if(!s)continue;c.fillStyle='rgba(2,4,14,.55)';const tw=c.measureText(s).width;c.fillRect(x-2,sr.y+sr.h/2-8,tw+4,16);c.fillStyle=b?'#fff':'rgba(232,241,255,.86)';c.fillText(s,x,sr.y+sr.h/2+.5)}
 }else{c.textAlign='center';c.font=`600 12px ${FONT_UI}`;c.fillStyle='rgba(166,181,218,.55)';c.fillText('暂无分镜 · 出片后由策划导演生成',W/2,sr.y+sr.h/2);c.textAlign='left'}
 // T1 subtitles
 const ur=R.sub;
 if(scenes.length&&ur.h>=9){const gs=new Path2D(),st=[];
  for(const sc of scenes){if(!sc.subtitle||sceneVis(sc)<=0)continue;const xa=tX(sc.startSec)+1,xb=tX(sc.startSec+sc.durationSec*.94)-1,w=xb-xa;if(xb<0||xa>W||w<2)continue;gs.rect(xa,ur.y+2,w,ur.h-4);if(w>40&&ur.h>=14)st.push([sc.subtitle,xa+3,w-6])}
  c.lineWidth=1;c.fillStyle='rgba(232,241,255,.11)';c.fill(gs);c.strokeStyle='rgba(232,241,255,.26)';c.stroke(gs);
  c.font=`500 12px ${FONT_UI}`;c.fillStyle='rgba(232,241,255,.85)';for(const [t,x,w] of st){const s=fitText(c,t,w);if(s)c.fillText(s,x,ur.y+ur.h/2+.5)}}
 // A1 voice — waveform where scenes have voice; audio sweep reveals left→right while the audio agent runs
 const vr=R.vo,vmid=vr.y+vr.h/2,asw=audioSweep(),revealT=asw==null?Infinity:asw*tot;
 const pure=M.project&&M.project.narrationMode==='subtitle-mv';
 if(scenes.some(s=>s.hasVoice)||asw!=null){const wp=new Path2D();
  for(const sc of scenes){if(!(sc.hasVoice||asw!=null))continue;if(sc.startSec>revealT)continue;const xa=Math.max(0,tX(sc.startSec)),xb=Math.min(W,tX(Math.min(sc.endSec,revealT)));if(xb<=xa)continue;
   const spk=Math.min(sc.durationSec*.9,(sc.subtitle.length||8)*.2+.25);
   for(let x=xa;x<xb;x+=2){const t=xT(x),lt=t-sc.startSec;if(lt<.06||lt>spk)continue;const syl=Math.abs(Math.sin((lt/.2)*Math.PI));const a=clamp((.35+.65*Math.pow(syl,.7))*(.6+.4*hash(Math.floor(t*40)+sc.i)),0,1)*(vr.h*.4)*(sc.hasVoice?1:.55);if(a>.4)wp.rect(x,vmid-a,1.2,a*2)}}
  c.fillStyle=`rgba(${TRK.vo.rgb},.85)`;c.fill(wp)}
 else if(pure&&vr.h>=14){c.font=`600 12px ${FONT_UI}`;c.fillStyle='rgba(166,181,218,.55)';c.fillText('纯音乐卡点 MV · 无旁白',Math.max(8,tX(0)+8),vmid)}
 if(asw!=null&&asw<1){const x=tX(revealT);c.fillStyle='rgba(77,255,195,.9)';c.fillRect(x-1,vr.y,2,R.bgm.y+R.bgm.h-vr.y)}
 // A2 sfx markers (drop in as the audio drone sweeps)
 const fx=R.sfx;
 if(M.tl.sfx.length){const pa=new Path2D(),pi=new Path2D(),pl=new Path2D(),pu=new Path2D(),r=Math.max(2,fx.h*.16);
  for(const f of M.tl.sfx){const k=sfxShown(f);if(k<=0)continue;const x=tX(f.t);if(x<-6||x>W+6)continue;
   const yT=fx.y+fx.h*sfxLane(f.type),y=lerp(vr.y-6,yT,E.oBack(Math.min(1,k))),gl=sfxGlyph(f.type);
   if(gl==='dia'){pi.moveTo(x,y-r*1.4);pi.lineTo(x+r*1.2,y);pi.lineTo(x,y+r*1.4);pi.lineTo(x-r*1.2,y);pi.closePath()}
   else if(gl==='dot'){pa.moveTo(x+r,y);pa.arc(x,y,r,0,TAU)}
   else if(gl==='line'){pl.moveTo(x-r*1.6,y+r);pl.lineTo(x+r*1.1,y-r)}
   else if(gl==='up'){pu.moveTo(x-r*1.4,y+r);pu.lineTo(x+r*1.4,y+r);pu.lineTo(x+r*1.4,y-r*1.2);pu.closePath()}
   else{pa.moveTo(x,y-r*1.1);pa.lineTo(x+r*.8,y+r*.8);pa.lineTo(x-r*.8,y+r*.8);pa.closePath()}}
  c.fillStyle=PAL.amb;c.fill(pa);c.fillStyle=`rgba(${PAL.ambRgb},.7)`;c.fill(pu);c.strokeStyle=PAL.amb;c.lineWidth=1.3;c.stroke(pl);c.fillStyle=PAL.mag;c.fill(pi)}
 // A3 music lanes
 const br=R.bgm,bmid=br.y+br.h/2;
 for(const mu of M.tl.music){const xa=tX(mu.startSec),xb=tX(mu.endSec);if(xb<0||xa>W)continue;
  c.fillStyle=`rgba(${TRK.bgm.rgb},.1)`;c.fillRect(xa,br.y+2,xb-xa,br.h-4);c.strokeStyle=`rgba(${TRK.bgm.rgb},.55)`;c.lineWidth=1;c.strokeRect(xa+.5,br.y+2.5,Math.max(0,xb-xa-1),br.h-5);
  const pd=new Path2D(),pu2=new Path2D(),rev=asw==null?Infinity:asw*tot;
  for(let x=Math.max(xa+2,0);x<Math.min(xb-2,W);x+=2){const t=xT(x);const e=bgmEnv(t);if(t<=rev){const a=e*(br.h*.42)*(1+.05*Math.sin(T*6+x*.2));pd.rect(x,bmid-a,1.2,a*2)}else{const a=br.h*.08*(.6+.4*hash(x|0));pu2.rect(x,bmid-a,1.2,a*2)}}
  c.fillStyle=`rgba(${TRK.bgm.rgb},.85)`;c.fill(pd);c.fillStyle=`rgba(${TRK.bgm.rgb},.3)`;c.fill(pu2);
  if(xb-xa>140&&br.h>=16){c.font=`700 12px ${FONT_UI}`;const s=fitText(c,mu.name,Math.min(xb,W)-Math.max(xa,0)-16);if(s){const tx=Math.max(xa,0)+6,tw=c.measureText(s).width;c.fillStyle='rgba(2,4,14,.6)';c.fillRect(tx-3,bmid-8,tw+6,16);c.fillStyle='rgba(232,241,255,.92)';c.fillText(s,tx,bmid)}}}
 // runway lights + sweeps
 const bf=TLS.beatFlash;
 for(const t of TRACKS){
  const r=R[t.k],y=r.y+r.h-2,base=new Path2D(),hot=[];
  for(let x=4;x<W;x+=14){let b=0;
   for(const sw of TLS.sweeps){if(sw.row!==t.k)continue;const age=S.simT-sw.s;if(age<0||age>sw.dur)continue;const d=Math.abs(x-tX(sw.t))-age*1500;b+=Math.exp(-Math.abs(d)/16)*(1-age/sw.dur)*1.6}
   if(!live&&!S.lite)b+=.12*Math.pow(Math.max(0,Math.sin(S.simT*2.2-x*.012)),8);
   if(b>.04)hot.push([x,b]);else base.rect(x,y,2.2,1.6)}
  c.fillStyle=`rgba(${t.rgb},${.1+bf*.45})`;c.fill(base);
  for(const [x,b] of hot){c.fillStyle=`rgba(${t.rgb},${clamp(.1+bf*.45+b,0,1)})`;c.fillRect(x,y,2.2,1.6)}}
 for(let i=TLS.sweeps.length-1;i>=0;i--)if(S.simT-TLS.sweeps[i].s>TLS.sweeps[i].dur)TLS.sweeps.splice(i,1);
 // render progress (qa running)
 const qa=agentOf('qa');if(qa.status==='running'||qa.status==='paused'){const rt=tot*clamp(qa.progress/100,0,1);c.fillStyle=`rgba(${A},.9)`;c.fillRect(tX(0),rr.h-2,Math.max(0,tX(rt)-tX(0)),2);c.fillStyle=`rgba(${A},.05)`;c.fillRect(tX(0),R.shot.y,Math.max(0,tX(rt)-tX(0)),H-R.shot.y);c.fillStyle='rgba(255,255,255,.85)';c.fillRect(tX(rt)-1,R.shot.y,2,H-R.shot.y)}
 // failed agent marker across the runway
 if(M.run&&M.run.status==='failed'){c.fillStyle=`rgba(${PAL.redRgb},.06)`;c.fillRect(0,R.shot.y,W,H-R.shot.y)}
 // playhead
 const phT=playheadT();
 if(phT!=null){const x=tX(phT);if(x>=0&&x<=W){c.fillStyle='rgba(255,255,255,.92)';c.fillRect(x-.75,rr.h,1.5,H-rr.h);c.beginPath();c.moveTo(x-5,TZ-1);c.lineTo(x+5,TZ-1);c.lineTo(x+5,rr.h-4);c.lineTo(x,rr.h);c.lineTo(x-5,rr.h-4);c.closePath();c.fillStyle='#fff';c.fill();c.globalCompositeOperation='lighter';glow(c,x,rr.h,14,A,.6);c.globalCompositeOperation='source-over'}}
}
function emptyRunway(c,W,H){const R=TL.rows;c.textAlign='center';c.font=`700 13px ${FONT_UI}`;c.fillStyle='rgba(166,181,218,.6)';const yy=(R.sub.y+R.vo.y+R.vo.h)/2;
 c.fillText(M.project?'跑道待命 · 等待无人机降落素材':'尚未打开工程',W/2,yy-9);c.font=`500 12px ${FONT_UI}`;c.fillStyle='rgba(107,120,163,.85)';c.fillText(M.project?'写下主题后点击「一键出片」或按 R 启动编队':'新建或打开一个工程后，这里会显示分镜 / 字幕 / 配音 / 音效 / 配乐五条轨道',W/2,yy+11);c.textAlign='left'}
/* deterministic BGM envelope from beats/drops (no audio decoding) */
function bgmEnv(t){const tot=M.tl.totalSec||1;let e=.42+.18*Math.sin(t*.21)+.1*fbm(t*.35,3);
 for(const d of M.tl.drops){const dt=t-d;if(dt>=0&&dt<6)e=Math.max(e,.95-dt*.05)}
 const bs=M.tl.beats;if(bs.length){let lo=0,hi=bs.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(bs[m].t<=t)lo=m;else hi=m-1}const b=bs[lo];if(b){const dt=t-b.t;if(dt>=0&&dt<.25)e+=(b.s?.32:.16)*(1-dt/.25)}}
 if(t<2)e*=t/2;if(t>tot-2)e*=Math.max(0,(tot-t)/2);return clamp(e*(.8+.2*hash(Math.floor(t*10))),0,1)}
/* interaction: hover tooltip, click → 分步精修 at that scene (or seek when a preview is playing) */
function sceneAtX(x){const t=xT(x),sc=M.tl.scenes;let lo=0,hi=sc.length-1,f=-1;while(lo<=hi){const m=(lo+hi)>>1;if(sc[m].startSec<=t){f=m;lo=m+1}else hi=m-1}return f>=0&&t<=sc[f].endSec?sc[f]:null}
function tlPointer(e,click){
 const wrap=$('#tl-wrap'),r=wrap.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
 const tip=$('#tl-tip');
 if(!M.project||!M.tl.totalSec){tip.classList.remove('on');return}
 const rowOf=k=>TL.rows[k]&&y>=TL.rows[k].y&&y<=TL.rows[k].y+TL.rows[k].h;
 const sc=(rowOf('shot')||rowOf('sub'))?sceneAtX(x):null;
 if(click){
  if(sc){openScene(sc.id);return}
  if(MONV.ready&&rowOf('ruler')){monSeekT(clamp(xT(x),0,MONV.dur()));return}
  if(MONV.ready){monSeekT(clamp(xT(x),0,MONV.dur()))}
  return}
 const hv=sc?sc.i:-1;if(TL.hover!==hv){TL.hover=hv;TL.dirty=true}
 if(sc){setHtml(tip,`<b>#${pad2(sc.n)} ${esc(sc.title)}</b>${sc.subtitle?`<span>${esc(sc.subtitle)}</span>`:''}<em>${fmtMSc(sc.startSec)} · ${sc.durationSec.toFixed(2)} s${sc.sfx.length?` · ${sc.sfx.length} 音效`:''}${sc.locked?' · 已锁定':''} · 点击进入分步精修</em>`);
  const tw=tip.offsetWidth||240,th=tip.offsetHeight||60;let tx=e.clientX+14,ty=e.clientY-th-12;if(tx+tw>innerWidth-8)tx=e.clientX-tw-14;if(ty<8)ty=e.clientY+18;tip.style.left=tx+'px';tip.style.top=ty+'px';tip.classList.add('on');wrap.style.cursor='pointer'}
 else{tip.classList.remove('on');wrap.style.cursor=MONV.ready?'crosshair':'default'}
}

function renderRunwayHead(){
 const tot=M.tl.totalSec||0,t=playheadT();setHtml($('#tl-tc'),`${fmtMSc(t||0)} <span>/ ${fmtMSc(tot)}</span>`);
 setTxt($('#tl-bpm-t'),M.tl.bpm?M.tl.bpm+' BPM':'— BPM');
 const x=[M.tl.beats.length?M.tl.beats.length+' 拍':'',M.tl.drops.length?M.tl.drops.length+' 突降':'',M.tl.scenes.length?M.tl.scenes.length+' 镜':''].filter(Boolean).join(' · ');setTxt($('#tl-bpm-x'),x?' · '+x:'');setTitle($('#tl-bpm'),(M.tl.bpm?M.tl.bpm+' BPM':'未检测到节拍')+(x?' · '+x:''));
 $$('.tl-h .rl').forEach(el=>{const k=el.parentNode.dataset.r;setCls(el,'on',TLS.sweeps.some(s=>s.row===k))});
}
