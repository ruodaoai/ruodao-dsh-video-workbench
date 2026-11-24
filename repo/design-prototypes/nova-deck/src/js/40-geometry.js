/* =====================================================================
   GEOMETRY — world = stage-local px. The camera transforms only #cam (and the
   world canvas); screen = stage origin + world*s + t.
   ===================================================================== */
const w2s=(x,y)=>({x:G.st.x+x*CAM.s+CAM.tx,y:G.st.y+y*CAM.s+CAM.ty});
const s2w=(x,y)=>({x:(x-G.st.x-CAM.tx)/CAM.s,y:(y-G.st.y-CAM.ty)/CAM.s});
const vcen=()=>({x:G.st.w/2,y:G.strip+(G.st.h-G.strip)/2});
function dockPos(id,push=0){const a=AGM[id],r=G.R+push;return{x:G.C.x+Math.cos(a.rad)*r,y:G.C.y+Math.sin(a.rad)*r}}
function dockScreen(id,push=0){const d=dockPos(id,push);return w2s(d.x,d.y)}
const droneScale=()=>clamp(G.R/300,.74,1.25)*1.18;
/* visible stage viewport (screen) below the strip */
const stageView=()=>({x:G.st.x,y:G.st.y+G.strip,w:G.st.w,h:Math.max(0,G.st.h-G.strip)});

function measure(){
 S.W=innerWidth;S.H=innerHeight;S.dpr=Math.min(2,devicePixelRatio||1);
 const st=$('#stage').getBoundingClientRect();G.st={x:st.left,y:st.top,w:Math.max(1,st.width),h:Math.max(1,st.height)};
 G.strip=$('#st-strip').offsetHeight||46;document.documentElement.style.setProperty('--strip-px',G.strip+'px');
 const hud=$('#hud');hud.style.left=G.st.x+'px';hud.style.top=G.st.y+'px';hud.style.width=G.st.w+'px';hud.style.height=G.st.h+'px';
 for(const id of ['cargo','mission','runway']){const r=$('#'+id).getBoundingClientRect();G.panels[id]={x:r.left,y:r.top,w:r.width,h:r.height}}
 layoutPanels();if(typeof logPin==='function')logPin();
 layoutStage();
 sizeCanvases();tlLayout();if(typeof fitSummary==='function')fitSummary.force=true;
 const v=vcen();if(CAM.mode==='overview'&&!CAM.focus){CAM.x=v.x;CAM.y=v.y;CAM.s=1;CAM.vx=CAM.vy=CAM.vs=0}
 PSPR=null;BGC.key='';STAR_TILES=null;CAM.ver++;MON.last=-1;
}

/* ======================= stage layout solver =======================
   Finds the largest porthole radius R such that the ring, the monitor, the
   8 dock labels and the two bottom corner blocks never overlap each other,
   the strip or the stage edges. Corner blocks degrade full → compact → off and
   labels full → compact → minimal → off, only when that buys > 10 % radius. */
const LABEL_ORDER=['editor','audio','director','avatar','cloud','motion','reference','qa'];
const LABEL_W={full:[150,188],cmp:[128,156],min:[100,108]};
let CORNER_SIZE=null,LABEL_H=null;
function measureCorners(){
 const ph=$('#st-phase'),te=$('#st-tele'),dl=$('#docklabels'),stg=$('#stage'),np=stg.classList.contains('noproj');if(np)stg.classList.remove('noproj');
 const save=[ph.className,te.className,dl.className];
 const out={};
 for(const m of ['full','cmp']){
  ph.className='st-corner st-phase'+(m==='cmp'?' cmp':'');te.className='st-corner st-tele'+(m==='cmp'?' cmp':'');
  out[m]={ph:{w:Math.ceil(ph.offsetWidth),h:Math.ceil(ph.offsetHeight)},te:{w:Math.ceil(te.offsetWidth),h:Math.ceil(te.offsetHeight)}};
 }
 ph.className=save[0];te.className=save[1];
 CORNER_SIZE=out;if(np)stg.classList.add('noproj');
 // label heights per mode (fixed CSS → measure one label)
 const el=$('.dl',dl);LABEL_H={};if(np)stg.classList.remove('noproj');const sd=el?el.style.display:'';if(el)el.style.display='';
 for(const m of ['full','cmp','min']){dl.className=m==='full'?'':m;LABEL_H[m]=el?Math.ceil(el.offsetHeight)||40:40}
 dl.className=save[2];if(el)el.style.display=sd;if(np)stg.classList.add('noproj');
}
function labelWidth(mode,W){const r=LABEL_W[mode];if(!r)return 0;return Math.round(clamp(W*.15,r[0],r[1]))}
function cornerRects(cm,W,H){
 if(cm==='off'||!CORNER_SIZE)return[];
 const z=CORNER_SIZE[cm]||CORNER_SIZE.full;
 return[{x:6,y:H-8-z.ph.h,w:z.ph.w,h:z.ph.h,k:'ph'},{x:W-6-z.te.w,y:H-8-z.te.h,w:z.te.w,h:z.te.h,k:'te'}];
}
function geomCap(W,H,top){return Math.max(40,Math.min((H-top-10)/2/1.12,(W-8)/2/1.12))}
function monRect(C,R){const mw=Math.round(R*1.5),mh=Math.round(mw*9/16);return{x:Math.round(C.x-mw/2),y:Math.round(C.y-mh/2),w:mw,h:mh}}
function placeAll(R,cm,lm){
 const W=G.st.w,H=G.st.h,top=G.strip;
 const C={x:W/2,y:top+(H-top)/2};
 const ringR=R*1.12;
 if(C.y-ringR<top+2||C.y+ringR>H-2||C.x-ringR<2||C.x+ringR>W-2)return null;
 const corners=cornerRects(cm,W,H),obs=[];
 for(const r of corners){if(circleRectHit(C.x,C.y,R*1.1,inflate(r,4)))return null;obs.push(inflate(r,6))}
 const mon=monRect(C,R);
 const out={C,R,mon,labels:{},corners,cm,lm};
 if(lm==='off')return out;
 const LW=labelWidth(lm,W),LH=(LABEL_H&&LABEL_H[lm])||40,GAP=Math.max(20,Math.round(18*droneScale()+6));
 const dr=16*droneScale()+3;
 const docks={};AG.forEach(a=>{docks[a.id]={x:C.x+Math.cos(a.rad)*R,y:C.y+Math.sin(a.rad)*R}});
 const monO=inflate(mon,8),inner=R*.94;
 const placed=[];
 for(const id of LABEL_ORDER){
  const a=AGM[id],d=docks[id],left=Math.cos(a.rad)<0,sn=Math.sin(a.rad);
  const cands=[];
  for(let k=0;k<=12;k++){for(const sg of k?[-1,1]:[1]){const dy=sg*k*8;cands.push({x:left?d.x-GAP-LW:d.x+GAP,y:d.y-LH/2+dy,side:left?'L':'R'})}}
  if(Math.abs(sn)>.8){const up=sn<0;for(let k=0;k<=6;k++){for(const sg of k?[-1,1]:[1]){const dx=sg*k*12;cands.push({x:d.x-LW/2+dx,y:up?d.y-GAP-LH:d.y+GAP,side:up?'T':'B'})}}}
  let ok=null;
  for(const c of cands){
   const r={x:Math.round(c.x),y:Math.round(c.y),w:LW,h:LH};
   if(r.x<4||r.y<top+4||r.x+r.w>W-4||r.y+r.h>H-4)continue;
   if(rectHit(r,monO))continue;
   if(obs.some(o=>rectHit(r,o)))continue;
   if(circleRectHit(C.x,C.y,inner,r))continue;
   let bad=false;for(const k in docks){const q=docks[k];if(circleRectHit(q.x,q.y,dr,r)){bad=true;break}}if(bad)continue;
   if(placed.some(p=>rectHit(r,p,4)))continue;
   ok={r,side:c.side};break;
  }
  if(!ok)return null;
  placed.push(ok.r);
  const r=ok.r;out.labels[id]={r,side:ok.side,ax:ok.side==='L'?r.x+r.w:ok.side==='R'?r.x:r.x+r.w/2,ay:ok.side==='T'?r.y+r.h:ok.side==='B'?r.y:r.y+r.h/2};
 }
 out.LW=LW;out.LH=LH;
 return out;
}
function maxRadius(cm,lm){
 const W=G.st.w,H=G.st.h,top=G.strip,cap=geomCap(W,H,top),RMIN=Math.min(70,cap);
 if(!placeAll(RMIN,cm,lm))return null;
 let best=placeAll(cap,cm,lm);if(best)return best;
 let lo=RMIN,hi=cap;best=placeAll(lo,cm,lm);
 for(let i=0;i<13;i++){const m=(lo+hi)/2,p=placeAll(m,cm,lm);if(p){lo=m;best=p}else hi=m}
 return best;
}
const LAYOUT_MODES=[['full','full'],['cmp','full'],['full','cmp'],['cmp','cmp'],['off','full'],['off','cmp'],['cmp','min'],['off','min'],['off','off']];
function layoutStage(){
 const W=G.st.w,H=G.st.h,top=G.strip;
 measureCorners();
 const noProj=!M.project;
 let pick=null;
 if(noProj){const cap=geomCap(W,H,top);pick=placeAll(cap,'off','off')||{C:{x:W/2,y:top+(H-top)/2},R:cap,mon:monRect({x:W/2,y:top+(H-top)/2},cap),labels:{},corners:[],cm:'off',lm:'off'}}
 else{
  const res=LAYOUT_MODES.map(([cm,lm])=>maxRadius(cm,lm)).filter(Boolean);
  const bestR=res.reduce((m,p)=>Math.max(m,p.R),0);
  pick=res.find(p=>p.R>=bestR*.9-1)||res[0]||null;
  if(!pick){const cap=geomCap(W,H,top);pick={C:{x:W/2,y:top+(H-top)/2},R:cap,mon:monRect({x:W/2,y:top+(H-top)/2},cap),labels:{},corners:[],cm:'off',lm:'off'}}
 }
 G.R=pick.R;G.C=pick.C;G.mon=pick.mon;G.corner=pick.cm;G.labMode=pick.lm;G.lab=pick.labels||{};G.LW=pick.LW||0;
 G.cornerRects=pick.corners||[];
 AG.forEach(a=>{G.docks[a.id]=dockPos(a.id)});
 // apply: monitor
 const mon=$('#monitor');mon.style.left=G.mon.x+'px';mon.style.top=G.mon.y+'px';mon.style.width=G.mon.w+'px';mon.style.height=G.mon.h+'px';
 setCls(mon,'w-m',G.mon.w<380);setCls(mon,'w-s',G.mon.w<290);setCls(mon,'w-xs',G.mon.w<210);setCls(mon,'h-s',G.mon.h<150);
 // corners
 const ph=$('#st-phase'),te=$('#st-tele');
 for(const el of [ph,te]){setCls(el,'cmp',G.corner==='cmp');el.dataset.mode=G.corner}
 // labels
 const dl=$('#docklabels');dl.className=G.labMode==='full'?'':G.labMode;dl.style.setProperty('--dlw',G.LW+'px');
 for(const a of AG){const el=dlEls[a.id];if(!el)continue;const L=G.lab[a.id];
  if(!L){el.style.display='none';continue}el.style.display='';
  el.style.transform=`translate(${L.r.x}px,${L.r.y}px)`;setCls(el,'L',L.side==='L');setCls(el,'T',L.side==='T');setCls(el,'B',L.side==='B')}
 sizeMonCanvas();
 PSPR=null;
}
/* ======================= panel vertical budgets =======================
   cargo: capsules keep ≥ 3 visible rows; staging list is capped / tightened /
   collapsed to its one-line header. mission: roster + log split → tabs → short. */
let STG_USER=LS.get('stgOpen',null); // null = auto, true/false = user choice
function layoutPanels(){layoutCargo();layoutMission()}
function layoutCargo(){
 const cg=$('#cargo');if(!cg)return;
 const H=cg.clientHeight;
 setCls(cg,'nodz',H<560||!M.project);
 const fb=$('#cg-filter');if(fb){fb.classList.remove('cmp');if(fb.scrollWidth>fb.clientWidth+1)fb.classList.add('cmp')}
 const kids=['.ph','.cg-actions','.dropzone','.cg-filter'].map(s=>$(s,cg)).filter(el=>el&&el.offsetParent!==null);
 let fixed=0;for(const el of kids){const cs=getComputedStyle(el);fixed+=el.offsetHeight+parseFloat(cs.marginTop)+parseFloat(cs.marginBottom)}
 const n=M.staging.length,stg=$('#staging');
 const small=innerWidth<=1340||innerHeight<=780,rowH=small?36:42,capsPad=18;
 const nv=visibleAssets().length,nCaps=Math.max(1,Math.min(3,nv));
 let capsMin=nv?nCaps*rowH+(nCaps-1)*6+capsPad:118;
 if(!n){setCls(stg,'none',true);setCls(cg,'tight',false);cg.style.setProperty('--caps-min',Math.max(40,Math.min(capsMin,H-fixed-2))+'px');return}
 setCls(stg,'none',false);
 const hdr=32,room=H-fixed-hdr-2,cardN=66,cardT=50;
 let tight=false,col=false,max=0;
 if(room-capsMin>=Math.min(n,2)*cardN+10)max=Math.min(room-capsMin,n*cardN+10);
 else if(room-capsMin>=cardT+10){tight=true;max=Math.min(room-capsMin,n*cardT+10)}
 else col=true;
 if(STG_USER===false)col=true;
 if(STG_USER===true&&col){col=false;tight=true;const floor=nv?Math.min(capsMin,rowH*2+6+capsPad):Math.min(capsMin,84);max=Math.max(cardT+10,Math.min(n*cardT+10,room-floor));capsMin=Math.min(capsMin,room-max)}
 setCls(cg,'tight',tight);setCls(stg,'col',col);
 stg.style.setProperty('--stg-max',Math.max(0,Math.floor(max))+'px');
 cg.style.setProperty('--caps-min',Math.max(40,Math.floor(Math.min(capsMin,room-(col?0:max))))+'px');
 $('#stg-h').setAttribute('aria-expanded',String(!col));
}
let MC_TAB=LS.get('mcTab','roster');
function layoutMission(){
 const mi=$('#mission');if(!mi)return;
 // the brief preview shows as many lines as the panel affords (4 on tall panels); it gives lines back
 // before the roster / live log would have to fold into the cramped "short" mode
 const H=mi.clientHeight,maxL=H>=740?4:H>=470?3:2;
 for(let L=maxL;L>=1;L--){
  BRIEF.lines=L;mi.style.setProperty('--bf-lines',String(L));
  const mode=layoutMissionPass(mi);
  if(mode!=='short'||L===1)break;
 }
}
function layoutMissionPass(mi){
 mi.classList.remove('tabbed','short','rcmp','tab-roster','tab-log');
 const H=mi.clientHeight,roster=$('#roster');setCls(mi,'narrow',mi.clientWidth<316);
 const top=()=>{let t=0;for(const el of mi.children){if(el.classList.contains('mc-split')||el.classList.contains('mc-tabs')||el.offsetParent===null)continue;const cs=getComputedStyle(el);t+=el.offsetHeight+parseFloat(cs.marginTop)+parseFloat(cs.marginBottom)}return t};
 const t0=top(),rFull=roster.scrollHeight;mi.classList.add('rcmp');const rCmp=roster.scrollHeight;mi.classList.remove('rcmp');
 const logNeed=31+61+10;
 if(H-t0>=31+rFull+logNeed)return 'full';
 if(H-t0>=31+rCmp+logNeed){mi.classList.add('rcmp');return 'rcmp'}
 mi.classList.add('tabbed','tab-'+MC_TAB);
 let t1=top(),mode='tabbed';if(H-t1-34<150){mi.classList.add('short');t1=top();mode='short'}
 if(rFull>H-t1-34-6)mi.classList.add('rcmp');
 return mode;
}
function setMcTab(t){MC_TAB=t;LS.set('mcTab',t);const mi=$('#mission');mi.classList.toggle('tab-roster',t==='roster');mi.classList.toggle('tab-log',t==='log');$$('#mc-tabs button').forEach(b=>{const on=b.dataset.tab===t;b.classList.toggle('on',on);b.setAttribute('aria-selected',String(on))});if(t==='log'){LOG.stick=true;requestAnimationFrame(()=>logPin())}}

/* ======================= camera (spring-follow, crisp-text aware) ======================= */
function springStep(x,v,xt,w,dt){const y=x-xt,e=Math.exp(-w*dt),j=(v+w*y)*dt;return[xt+(y+j)*e,(v-w*j)*e]}
function fitMon(k){const vh=G.st.h-G.strip;return Math.min(G.st.w*k/Math.max(1,G.mon.w),vh*k/Math.max(1,G.mon.h),3)}
function monCenter(){return{x:G.mon.x+G.mon.w/2,y:G.mon.y+G.mon.h/2}}
function agentLbl(id){const a=AGM[id];return `${a.code} ${a.en.toUpperCase()} · ${agentOf(id).name||a.name}`}
function followTarget(){
 const v=vcen(),run=M.run;
 if(!M.project||!run)return{x:G.C.x,y:G.C.y,s:1.08,lbl:'舰桥待命'};
 if(run.status==='completed')return{...monCenter(),s:fitMon(.9),lbl:'PGM · 成片预览'};
 const id=run.activeAgentId;
 if(!id)return{x:G.C.x,y:G.C.y,s:1.1,lbl:run.status==='queued'?'排队 · 等待调度':'编队调度'};
 const sh=SHOW[id],ph=sh?showPhase(id,sh):'';
 if(ph==='away')return{...v,s:1,lbl:agentLbl(id)+' · 出舱作业',who:id};
 if(ph==='orbit'){const p=qaOrbitWorld(sh);return{x:p.x,y:p.y,s:1.45,lbl:agentLbl(id)+' · 巡检环航',who:id,trk:true}}
 if(ph==='monitor'||id==='motion'||(id==='qa'&&ph!=='orbit'))return{...monCenter(),s:fitMon(.86),lbl:'MONITOR · '+(agentOf(id).name||AGM[id].name),who:id};
 const a=AGM[id],d=G.docks[id];const s=run.status==='failed'?1.4:1.62;
 return{x:d.x+Math.cos(a.rad)*G.R*.12,y:d.y+Math.sin(a.rad)*G.R*.08,s,lbl:agentLbl(id),who:id,trk:true};
}
function camTarget(){
 if(CAM.focus){const a=AGM[CAM.focus],d=G.docks[a.id];const s=clamp(Math.min(G.st.w,G.st.h-G.strip)/(G.R*1.25),1.4,2.1);return{x:d.x+Math.cos(a.rad)*G.R*.2,y:d.y+Math.sin(a.rad)*G.R*.14,s,who:a.id,trk:true,lbl:agentLbl(a.id)}}
 if(CAM.mode==='overview')return{...vcen(),s:1,lbl:''};
 if(CAM.mode==='close')return{...monCenter(),s:fitMon(.9),lbl:'预览监视器'};
 return followTarget();
}
function camUpdate(dt){
 const T=camTarget();CAM.tgt=T;
 const W=G.st.w,vh=G.st.h-G.strip,v=vcen();
 const s=clamp(T.s,1,3.4),hw=W/2/s,hh=vh/2/s;
 const tx=s<=1.001?v.x:clamp(T.x,hw,W-hw),ty=s<=1.001?v.y:clamp(T.y,G.strip+hh,G.st.h-hh);
 const w=CAM.focus?4.2:(CAM.mode==='follow'?3.1:3.6);
 [CAM.x,CAM.vx]=springStep(CAM.x,CAM.vx,tx,w,dt);[CAM.y,CAM.vy]=springStep(CAM.y,CAM.vy,ty,w,dt);
 let ls=Math.log(CAM.s);[ls,CAM.vs]=springStep(ls,CAM.vs,Math.log(s),w*.9,dt);CAM.s=Math.exp(ls);
 if(Math.abs(CAM.s-1)<.0005&&s===1)CAM.s=1;
 let sx=0,sy=0;if(CAM.shake>0&&!S.lite){sx=(Math.sin(S.realT*71)+Math.sin(S.realT*43))*CAM.shake;sy=(Math.cos(S.realT*67)+Math.sin(S.realT*31))*CAM.shake}
 CAM.tx=v.x-CAM.x*CAM.s+sx;CAM.ty=v.y-CAM.y*CAM.s+sy;
 const ident=Math.abs(CAM.s-1)<.0005&&Math.abs(CAM.tx)<.05&&Math.abs(CAM.ty)<.05;
 const cam=$('#cam');
 if(ident){CAM.tx=0;CAM.ty=0;CAM.s=1;if(CAM.layer!=='none'){cam.style.willChange='auto';CAM.layer='none'}cam.style.transform='none'}
 else{
  cam.style.transform=`translate(${CAM.tx.toFixed(2)}px,${CAM.ty.toFixed(2)}px) scale(${CAM.s.toFixed(4)})`;
  const zoomMoving=Math.abs(CAM.vs)>.003||Math.abs(Math.log(CAM.s/s))>.004;
  if(zoomMoving)CAM.stable=0;else CAM.stable=(CAM.stable||0)+dt;
  if(CAM.layer==='none'||!CAM.layer){cam.style.willChange='transform';CAM.layer='comp';CAM.rasterS=CAM.s}
  else if(CAM.layer==='comp'){if(CAM.stable>.14&&Math.abs(CAM.rasterS-CAM.s)/CAM.s>.015){cam.style.willChange='auto';CAM.layer='re'}}
  else if(CAM.layer==='re'){cam.style.willChange='transform';CAM.layer='comp';CAM.rasterS=CAM.s}
 }
 // zoomed state with hysteresis → HUD / corners / depth of field
 const z=CAM.zoomed?(CAM.s>1.02||!!CAM.focus):(CAM.s>1.05||!!CAM.focus);
 if(z!==CAM.zoomed){CAM.zoomed=z;DIRTY.ui=true}
 setCls($('#dof'),'on',z&&!S.lite);setCls($('#vign'),'on',z);setCls($('#hud'),'on',z);
}
function setCam(mode,user=true){
 if(user){CAM.autoSwitched=false}
 if(CAM.focus)unfocus(false);
 CAM.mode=mode;$$('#cam-seg button').forEach(b=>{const on=b.dataset.cam===mode;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on))});DIRTY.ui=true;
}
/* screen rect of a world rect */
function wr2s(r){const p=w2s(r.x,r.y);return{x:p.x,y:p.y,w:r.w*CAM.s,h:r.h*CAM.s}}
const inside=(r,b,m=0)=>r.x>=b.x+m&&r.y>=b.y+m&&r.x+r.w<=b.x+b.w-m&&r.y+r.h<=b.y+b.h-m;
/* hide transformed DOM text that is clipped by the stage viewport or covered by HUD cards */
function cullCamLayer(){
 const view=stageView(),blockers=[],hud=$('#hud');
 const mr=wr2s(G.mon);
 // the minimap yields to the monitor (it would cover the preview / its chrome)
 const mini=$('#ch-mini');let miniOn=false;
 if(CAM.zoomed&&!hud.classList.contains('nomini')&&!hud.classList.contains('card')){const r=rectOf(mini);miniOn=!rectHit(r,mr,4);if(miniOn)blockers.push(r)}
 setCls(hud,'mini-off',!miniOn);
 const card=$('#agentcard');if(card.classList.contains('on'))blockers.push(rectOf(card));
 const ob=$('#onboard');if(ob.classList.contains('on'))blockers.push(rectOf(ob));
 for(const a of AG){const el=dlEls[a.id],L=G.lab[a.id];if(!el||!L)continue;
  const r=wr2s(L.r);const hid=!M.project||!inside(r,view,2)||blockers.some(b=>rectHit(r,b,2));setCls(el,'hid',hid);setAttr(el,'aria-hidden',hid?'true':null);setAttr(el,'tabindex',hid?'-1':'0')}
 // monitor chrome: each block is checked on its own transformed rect
 for(const id of ['mon-top','mon-bot','ready','mon-state']){const el=$('#'+id);if(!el)continue;const r=rectOf(el);const out=r.w>0&&(!inside(r,view,-1)||blockers.some(b=>rectHit(r,b,0)));const v=out?'hidden':'';if(el.style.visibility!==v)el.style.visibility=v}
}
function rectOf(el){const r=el.getBoundingClientRect();return{x:r.left,y:r.top,w:r.width,h:r.height}}
