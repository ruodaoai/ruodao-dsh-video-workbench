/* ======================= runtime state ======================= */
const S={W:innerWidth,H:innerHeight,dpr:Math.min(2,devicePixelRatio||1),simT:0,showT:0,realT:0,fps:60,lite:false,
 handoffs:0,runId:'',lastActive:null,ceremony:{launch:'',finish:''},readyAt:-1,failAt:-1,
 filter:'all',drawer:false,newIds:{},sceneAppear:{},stgSeen:{},editT:{}};
const CAM={mode:'overview',focus:null,x:0,y:0,s:1,vx:0,vy:0,vs:0,tx:0,ty:0,auto:LS.get('autoFollow',true),autoSwitched:false,tgt:null,shake:0,ver:0};
/* geometry (stage-local "world" px; screen = stage origin + world*s + t) */
const G={st:{x:0,y:0,w:0,h:0},strip:46,C:{x:0,y:0},R:200,mon:{x:0,y:0,w:0,h:0},docks:{},lab:{},labRects:{},LW:180,LH:61,
 corner:'full',labMode:'full',phase:{x:0,y:0,w:0,h:0},tele:{x:0,y:0,w:0,h:0},marks:[],tl:{x:0,y:0,w:0,h:0},panels:{}};
let PAL={acc:'#3BE7FF',accRgb:'59,231,255',amb:'#FFB547',ambRgb:'255,181,71',mag:'#FF4FD8',magRgb:'255,79,216',red:'#FF5A6E',redRgb:'255,90,110'};
function readPal(){const cs=getComputedStyle(document.documentElement);const g=k=>cs.getPropertyValue(k).trim();PAL={acc:g('--acc')||PAL.acc,accRgb:g('--acc-rgb')||PAL.accRgb,amb:g('--amb')||PAL.amb,ambRgb:g('--amb-rgb')||PAL.ambRgb,mag:g('--mag')||PAL.mag,magRgb:g('--mag-rgb')||PAL.magRgb,red:g('--red')||PAL.red,redRgb:g('--red-rgb')||PAL.redRgb}}
const PERF={ema:16.7,mode:0,bad:0,tick:0,acc:0,t:0,gpu:''};

/* ======================= choreography bookkeeping ======================= */
const SHOW={};      // agentId → {t0 (showT), kind, ...} while that agent's status is running
const RECALL={};    // agentId → {x,y,h,t0 (realT)} drone flying back to its dock (screen space)
let PULSES=[];      // ring hand-off pulses {from,to,t0 (simT),dur}
const PARTS=[],RINGS=[];
const TLS={sweeps:[],beatFlash:0};
function agentOf(id){return M.agm[id]||{id,status:'idle',progress:0,message:''}}
function agentTask(id){const a=agentOf(id);if(a.message)return cleanMsg(a.message)||a.message;if(a.status==='skipped')return '本次未参与';if(a.status==='queued')return '等待调度';if(a.status==='done')return '已完成 ✓';return IDLE_TASK[id]||'待命'}
function resetForProject(){
 for(const k in SHOW)delete SHOW[k];for(const k in RECALL)delete RECALL[k];
 PULSES=[];PARTS.length=0;RINGS.length=0;TLS.sweeps.length=0;
 S.handoffs=0;S.runId=M.run?M.run.id:'';S.lastActive=M.run?M.run.activeAgentId:null;S.readyAt=-1;S.failAt=-1;S.newIds={};S.sceneAppear={};
 S.ceremony={launch:M.run&&runLive(M.run)?M.run.id:'',finish:M.run&&!runLive(M.run)?M.run.id+'|'+M.run.status:''};
 S.stgSeen={};M.staging.forEach(x=>S.stgSeen[x.id]=1);
 // a live run we join mid-way: start the shows of running agents (no ceremony)
 if(isLive())M.agents.forEach(a=>{if(a.status==='running')startShow(a.id,true)});
 if(CAM.focus&&!AGM[CAM.focus])CAM.focus=null;
 MONV.loadedUrl='';syncVideoSrc();
 LOG.keys=new Set();LOG.reset=true;
 TL.view0=0;TL.zoom=1;TL.goal=null;
}
function diffState(P,N){
 const pr=P.run,nr=N.run;
 // run lifecycle
 if(nr&&(!pr||pr.id!==nr.id)){if(runLive(nr))launchCeremony(nr.id);else if(nr.status!=='queued')finishCeremony(nr.id,nr.status)}
 else if(nr&&pr&&pr.status!==nr.status){
  if(runLive(nr)&&!runLive(pr))launchCeremony(nr.id,true);
  if(!runLive(nr))finishCeremony(nr.id,nr.status);
  if(nr.status==='paused')for(const a of AG)if(SHOW[a.id])SHOW[a.id].paused=true;
 }
 if(!nr&&pr){for(const a of AG)stopShow(a.id);}
 // active agent hand-off
 const pa=pr&&pr.activeAgentId,na=nr&&nr.activeAgentId;
 if(nr&&na&&pa!==na&&(!pr||pr.id===nr.id)){if(pa&&AGM[pa])handoff(pa,na);S.handoffs++;S.lastActive=na;CAM.ver++}
 // per-agent transitions
 for(const a of N.agents){const b=P.agm[a.id];const ps=b?b.status:'idle',ns=a.status;
  if(ps===ns)continue;
  if(ns==='running'&&ps!=='paused')startShow(a.id);
  if(ns==='running'&&ps==='paused'&&SHOW[a.id])SHOW[a.id].paused=false;
  if(ps==='running'&&ns!=='paused'&&ns!=='running')stopShow(a.id,ns);
  if(ns==='done')dockBurst(a.id,AGM[a.id].rgb,22);
  if(ns==='failed'){dockBurst(a.id,PAL.redRgb,34);CAM.shake=Math.max(CAM.shake,4);S.failAt=S.simT}
 }
 // assets / staging / scenes
 const pIds=new Set(P.assets.map(a=>a.id)),added=N.assets.filter(a=>!pIds.has(a.id)).map(a=>a.id);
 if(added.length)markNewAssets(added,false);
 N.staging.forEach(x=>{if(!S.stgSeen[x.id]){S.stgSeen[x.id]=1;stgArrive(x.id)}});
 if(N.tl.scenes.length>P.tl.scenes.length){const base=S.simT;N.tl.scenes.forEach((sc,i)=>{if(!P.tl.scenes.some(o=>o.id===sc.id))S.sceneAppear[sc.id]=base+Math.min(1.6,i*.03)})}
 if(N.preview.mp4Url!==P.preview.mp4Url)syncVideoSrc();
}
function launchCeremony(runId,resumed){
 if(S.ceremony.launch===runId&&!resumed)return;S.ceremony.launch=runId;S.ceremony.finish='';
 if(!resumed){S.handoffs=0;S.runId=runId;S.readyAt=-1;S.failAt=-1;PULSES=[];TLS.sweeps.length=0;
  for(const a of AG)if(SHOW[a.id]&&agentOf(a.id).status!=='running')delete SHOW[a.id];
  const c=w2s(G.C.x,G.C.y);shock(c.x,c.y,PAL.accRgb,G.R*CAM.s*.9,.9);
  for(const a of AG){const d=dockScreen(a.id);RINGS.push({x:d.x,y:d.y,rgb:a.rgb,r1:24,dur:.6,t:-a.idx*.06})}
  sweepAll();
 }
 if(CAM.auto&&CAM.mode==='overview'&&!CAM.focus){setCam('follow',false);CAM.autoSwitched=true}
 if(MONV.v&&!MONV.v.paused)MONV.v.pause();
}
function finishCeremony(runId,status){
 const key=runId+'|'+status;if(S.ceremony.finish===key)return;S.ceremony.finish=key;S.ceremony.launch='';
 for(const a of AG)stopShow(a.id);
 if(status==='completed'){S.readyAt=S.simT;const f=$('#flash'),p=w2s(G.C.x,G.C.y);if(f&&!S.lite){f.style.setProperty('--fx',p.x+'px');f.style.setProperty('--fy',p.y+'px');f.animate([{opacity:.85},{opacity:0}],{duration:900,easing:'cubic-bezier(.2,.8,.2,1)'})}CAM.shake=Math.max(CAM.shake,4);
  for(const a of AG)if(agentOf(a.id).status==='done')RINGS.push({x:dockScreen(a.id).x,y:dockScreen(a.id).y,rgb:a.rgb,r1:30,dur:.7,t:-.3-a.idx*.05});
  sweepAll();syncVideoSrc();
 }
 else if(status==='failed'){S.failAt=S.simT;CAM.shake=Math.max(CAM.shake,5)}
 if(CAM.autoSwitched&&CAM.mode==='follow'&&!CAM.focus){setCam(status==='completed'?'close':'overview',false);CAM.autoSwitched=status==='completed';if(status==='completed')setTimeout(()=>{if(CAM.autoSwitched&&CAM.mode==='close'&&!isLive()){setCam('overview',false);CAM.autoSwitched=false}},6500)}
}
function handoff(from,to){if(!AGM[from]||!AGM[to]||from===to)return;PULSES.push({from,to,t0:S.simT,dur:1.15});if(PULSES.length>12)PULSES.shift()}
function cueAgent(id){const d=dockScreen(id);RINGS.push({x:d.x,y:d.y,rgb:AGM[id].rgb,r1:34,dur:.6,t:0});CAM.ver++}
function dockBurst(id,rgb,r1){const d=dockScreen(id);RINGS.push({x:d.x,y:d.y,rgb,r1,dur:.55,t:0});if(!S.lite)burst(d.x,d.y,rgb,10,140)}
function markNewAssets(ids,fromEvent){const now=S.realT;ids.forEach(id=>{if(!S.newIds[id]||now-S.newIds[id]>3)S.newIds[id]=now});DIRTY.caps=true}
function stgArrive(id){DIRTY.stg=true;S.stgNew=S.stgNew||{};S.stgNew[id]=S.realT;if(STG_USER===false&&!S.stgAutoOpened){S.stgAutoOpened=true}}
function sweepAll(){for(const t of TRACKS)TLS.sweeps.push({row:t.k,t:M.tl.totalSec||0,s:S.simT,dur:1.4})}
function sweep(row,t,dur=1.3){TLS.sweeps.push({row,t,s:S.simT,dur})}
/* shows */
function startShow(id,joined){
 const sh={t0:S.showT-(joined?8:0),paused:false,joined:!!joined};
 if(id==='editor')sh.sorties=planSorties();
 SHOW[id]=sh;delete RECALL[id];
}
function stopShow(id,ns){const sh=SHOW[id];if(!sh)return;const p=agentPose(id,true);if(p&&p.fly)RECALL[id]={x:p.x,y:p.y,h:p.h,t0:S.realT};delete SHOW[id]}
function planSorties(){
 const scenes=M.tl.scenes,out=[];
 const vis=M.assets.filter(a=>a.used.length&&(a.kind==='image'||a.kind==='video'||a.kind==='host_video'));
 const aud=M.assets.filter(a=>a.used.length&&(a.kind==='music'||a.kind==='voice'));
 for(const a of vis.concat(aud)){if(out.length>=7)break;
  const sc=scenes.find(s=>a.used.includes(s.id));
  if(a.kind==='music')out.push({asset:a.id,track:'bgm',sc:null});
  else if(a.kind==='voice')out.push({asset:a.id,track:'vo',sc:sc?sc.i:0});
  else if(sc)out.push({asset:a.id,track:'shot',sc:sc.i});
 }
 return out;
}
