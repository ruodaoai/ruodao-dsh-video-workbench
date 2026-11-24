/* =====================================================================
   BRIDGE (BRIDGE.md §2) — state in, actions out, results, one-shot events
   ===================================================================== */
const HOST=window.parent&&window.parent!==window?window.parent:null;
const PEND=new Map();let actSeq=0;
function post(msg,transfer){if(!HOST)return false;try{HOST.postMessage(Object.assign({v:1},msg),'*',transfer&&transfer.length?transfer:undefined);return true}catch(e){try{HOST.postMessage(Object.assign({v:1},msg),'*');return true}catch(e2){return false}}}
/* send one user intent; resolves with the host's dsh-vw/result. Errors are shown unless opt.silent. */
function act(action,payload,opt){
 opt=opt||{};payload=payload||{};
 if(!HOST){toast('未连接宿主 · 「'+actionName(action)+'」无法执行','err');return Promise.resolve({ok:false,error:'no host'})}
 const id='nd-'+Date.now().toString(36)+'-'+(++actSeq);
 const btn=opt.btn||null;if(btn)btn.classList.add('pending');
 const unpend=setTimeout(()=>{if(btn)btn.classList.remove('pending')},opt.pendMs||12000);
 return new Promise(res=>{
  PEND.set(id,{action,opt,res:r=>{clearTimeout(unpend);if(btn)btn.classList.remove('pending');res(r)}});
  if(!post({type:'dsh-vw/action',id,action,payload},opt.transfer)){PEND.delete(id);clearTimeout(unpend);if(btn)btn.classList.remove('pending');toast('无法发送到宿主：'+actionName(action),'err');res({ok:false,error:'post failed'})}
 });
}
const ACTION_CN={run:'一键出片',pause:'暂停',resume:'继续',stop:'停止',retry:'重试',setDirector:'更新出片参数',polishTopic:'AI 润色',importFiles:'导入素材',removeAsset:'移除素材',confirmStaging:'确认入库',discardStaging:'丢弃云端结果',selectProject:'切换工程',newProject:'新建工程',openPanel:'打开面板',openScene:'打开分镜',setSkin:'切换皮肤',setLowSpec:'低配保护',backToChat:'返回对话'};
const actionName=a=>ACTION_CN[a]||a;
function onResult(m){const p=PEND.get(m.id);if(!p)return;PEND.delete(m.id);const r={ok:!!m.ok,error:m.error?String(m.error):'',data:m.data,code:m.code?String(m.code):''};
 // need-llm: the panel kit shows its own fix-it toast and opens 设置 · 模型与密钥 (no second toast here)
 if(!r.ok&&!p.opt.silent&&!(r.code==='need-llm'&&pk()))toast(`${actionName(p.action)}失败：${r.error||'未知错误'}`,'err',4200);
 p.res(r)}

/* ======================= model ======================= */
const M={ready:false,raw:null,project:null,projects:[],assets:[],staging:[],run:null,agents:[],agm:{},logs:[],
 tl:{totalSec:0,fps:30,bpm:null,beats:[],drops:[],scenes:[],music:[],sfx:[]},preview:{mp4Url:'',posterUrl:'',hasMp4:false,durationSec:0},
 director:{topic:''},options:{},status:{},counts:{plazaTemplates:0,voices:0},host:'standalone',skin:SKIN_ID,lowSpec:false,busy:'',ts:0};
const arr=v=>Array.isArray(v)?v:[];
const str=(v,d='')=>v==null?d:String(v);
/* topic text: never the literal "undefined" / "null" (older states / corrupted drafts) */
function cleanTopic(v){const s=v==null?'':String(v);return /^\s*(undefined|null)\s*$/i.test(s)?'':s}
const topicNow=()=>cleanTopic(M.director&&M.director.topic);
const optList=v=>arr(v).filter(o=>o&&o.value!=null).map(o=>({value:String(o.value),label:str(o.label,String(o.value))}));
/* style options keep their look: AI 自由匹配 (the AI's pick / design) and 我的风格预设 bring their own palette */
const HEX6=/^#[0-9a-f]{6}$/i;
const styleList=v=>arr(v).filter(o=>o&&o.value!=null).map(o=>{const c=arr(o.colors).map(String).filter(x=>HEX6.test(x)).slice(0,3);return{value:String(o.value),label:str(o.label,String(o.value)),hint:str(o.hint),kind:str(o.kind),preset:str(o.preset),g:c.length>=3?`linear-gradient(135deg,${c[0]},${c[1]} 58%,${c[2]})`:''}});
function normState(s){
 s=s&&typeof s==='object'?s:{};
 const P=s.project&&typeof s.project==='object'?s.project:null;
 const project=P?{dir:str(P.dir),title:str(P.title,'未命名工程')||'未命名工程',engine:str(P.engine,'remotion'),aspectRatio:str(P.aspectRatio,'16:9'),width:num(P.width,1920)||1920,height:num(P.height,1080)||1080,fps:num(P.fps,30)||30,quality:str(P.quality,'1080p'),genreLabel:str(P.genreLabel),style:str(P.style),narrationMode:str(P.narrationMode,'tts'),durationSec:Math.max(0,num(P.durationSec))}:null;
 const assets=arr(s.assets).filter(a=>a&&a.id!=null).map((a,i)=>({id:String(a.id),kind:TYPE[a.kind]?String(a.kind):'other',name:str(a.name,String(a.id))||String(a.id),url:str(a.url),thumbUrl:str(a.thumbUrl),durationSec:a.durationSec==null?null:num(a.durationSec,null),width:a.width==null?null:num(a.width,null),height:a.height==null?null:num(a.height,null),used:arr(a.usedBySceneIds).map(String),i}));
 const staging=arr(s.staging).filter(x=>x&&x.id!=null).map(x=>({id:String(x.id),kind:['image','video','audio'].includes(x.kind)?x.kind:'image',name:str(x.name,String(x.id))||String(x.id),url:str(x.url),thumbUrl:str(x.thumbUrl),provider:str(x.provider),prompt:str(x.prompt)}));
 const R=s.run&&typeof s.run==='object'?s.run:null;
 const run=R?{id:str(R.id),status:RUNST[R.status]?R.status:'queued',progress:clamp(num(R.progress),0,100),activeAgentId:AGM[R.activeAgentId]?R.activeAgentId:null,elapsedSec:Math.max(0,num(R.elapsedSec)),error:str(R.error),message:str(R.message)}:null;
 const byId={};arr(s.agents).forEach(a=>{if(a&&AGM[a.id])byId[a.id]=a});
 const agents=AG.map(d=>{const a=byId[d.id]||{};return{id:d.id,name:str(a.name,d.name)||d.name,en:str(a.en,d.en.toUpperCase()),status:AST[a.status]?a.status:'idle',progress:clamp(num(a.progress),0,100),message:str(a.message)}});
 const agm={};agents.forEach(a=>agm[a.id]=a);
 const logs=arr(s.logs).slice(-60).filter(l=>l).map(l=>({ts:str(l.ts),agentId:AGM[l.agentId]?l.agentId:'system',level:l.level==='error'?'error':l.level==='warn'?'warn':'info',text:str(l.text)}));
 const T=s.timeline&&typeof s.timeline==='object'?s.timeline:{};
 const scenes=arr(T.scenes).filter(x=>x).map((x,i)=>({id:str(x.id,'scene-'+(i+1)),index:num(x.index,i),title:str(x.title,'第 '+(i+1)+' 幕')||('第 '+(i+1)+' 幕'),startSec:Math.max(0,num(x.startSec)),durationSec:Math.max(.05,num(x.durationSec,3)),subtitle:str(x.subtitle),thumbUrl:str(x.thumbUrl),hasVoice:!!x.hasVoice,sfx:arr(x.sfx).filter(f=>f&&Number.isFinite(Number(f.t))).map(f=>({type:str(f.type,'sfx'),t:Math.max(0,num(f.t))})),locked:!!x.locked})).sort((a,b)=>a.startSec-b.startSec);
 scenes.forEach((x,i)=>{x.i=i;x.n=i+1;x.endSec=x.startSec+x.durationSec;x.col=SCENE_COLS[i%SCENE_COLS.length]});
 let total=Math.max(0,num(T.totalSec));const scEnd=scenes.reduce((m,x)=>Math.max(m,x.endSec),0);if(total<scEnd)total=scEnd;
 const music=arr(T.music).filter(x=>x).map(x=>({name:str(x.name,'配乐'),startSec:Math.max(0,num(x.startSec)),endSec:Math.max(0,num(x.endSec))})).filter(x=>x.endSec>x.startSec);
 music.forEach(x=>{if(x.endSec>total)total=x.endSec});
 const beats=arr(T.beats).slice(0,600).filter(b=>b&&Number.isFinite(Number(b.t))).map(b=>({t:num(b.t),s:!!b.strong})).filter(b=>b.t>=0).sort((a,b)=>a.t-b.t);
 const drops=arr(T.drops).map(d=>num(d,-1)).filter(d=>d>=0).sort((a,b)=>a-b);
 if(!total&&beats.length)total=beats[beats.length-1].t+1;
 const sfx=[];scenes.forEach(x=>x.sfx.forEach(f=>sfx.push({type:f.type,t:f.t,sc:x.i})));sfx.sort((a,b)=>a.t-b.t);sfx.forEach((f,k)=>{f.k=k});
 const PV=s.preview&&typeof s.preview==='object'?s.preview:{};
 const preview={mp4Url:str(PV.mp4Url),posterUrl:str(PV.posterUrl),hasMp4:!!PV.hasMp4&&!!str(PV.mp4Url),durationSec:Math.max(0,num(PV.durationSec))};
 const D=s.director&&typeof s.director==='object'?s.director:{};
 const director={topic:cleanTopic(D.topic),engine:str(D.engine,'remotion'),creationMode:str(D.creationMode,'ai-coded'),aspectRatio:str(D.aspectRatio,'auto'),quality:str(D.quality,'1080p'),fps:num(D.fps,30)||30,durationMode:D.durationMode==='custom'?'custom':'auto',targetDurationSec:num(D.targetDurationSec,120)||120,narrationMode:str(D.narrationMode,'tts'),bgmMode:str(D.bgmMode),pacingMode:str(D.pacingMode,'auto'),style:str(D.style),voiceId:str(D.voiceId,'auto')||'auto',avatarEnabled:!!D.avatarEnabled,avatarLayout:str(D.avatarLayout,'pip-br')};
 const O=s.options&&typeof s.options==='object'?s.options:{};
 const options={};for(const k of ['engines','creationModes','aspectRatios','qualities','narrationModes','bgmModes','pacingModes','styles','voices','avatarLayouts'])options[k]=k==='styles'?styleList(O[k]):optList(O[k]);
 const S0=s.status&&typeof s.status==='object'?s.status:{};const g=(k)=>S0[k]&&typeof S0[k]==='object'?S0[k]:{};
 const status={llm:{ok:!!g('llm').configured,label:str(g('llm').label,'未配置')},tts:{ok:!!g('tts').ready,label:str(g('tts').label,'—')},gpu:{ok:!!str(g('gpu').label),label:str(g('gpu').label,'—'),mode:str(g('gpu').lowSpecMode,'auto')},lipsync:{ok:!!g('lipsync').ready,label:str(g('lipsync').label,'—')}};
 const C=s.counts&&typeof s.counts==='object'?s.counts:{};
 const projects=arr(s.projects).filter(p=>p&&p.dir).map(p=>({dir:String(p.dir),title:str(p.title,'未命名工程')||'未命名工程',engine:str(p.engine),updatedAt:str(p.updatedAt),hasMp4:!!p.hasMp4}));
 return{ready:true,raw:s,project,projects,assets,staging,run,agents,agm,logs,tl:{totalSec:total,fps:num(T.fps,30)||30,bpm:T.bpm==null?null:(num(T.bpm,0)||null),beats,drops,scenes,music,sfx},preview,director,options,status,counts:{plazaTemplates:Math.max(0,num(C.plazaTemplates)),voices:Math.max(0,num(C.voices))},host:s.host==='dsh'?'dsh':'standalone',skin:str(s.skin,SKIN_ID),lowSpec:!!s.lowSpec,busy:str(s.busy).trim(),ts:num(s.ts,Date.now())};
}
const runLive=r=>!!r&&(r.status==='running'||r.status==='queued'||r.status==='paused');
const isLive=()=>runLive(M.run);
const logKey=l=>l.ts+'|'+l.agentId+'|'+l.text;
const DIRTY={ui:true,tl:true,caps:true,stg:true,roster:true,log:true,drawer:true,layout:true,top:true,mon:true};
const dirtyAll=()=>{for(const k in DIRTY)DIRTY[k]=true};
let FIRST_STATE=true;
function onState(raw){
 let N;try{N=normState(raw)}catch(e){console.error('[NOVA DECK] bad state',e);return}
 try{applyPending(N)}catch(e){}
 const P=M.ready?Object.assign({},M):null;
 const projChanged=!P||(P.project&&P.project.dir)!==(N.project&&N.project.dir);
 Object.assign(M,N);
 try{if(P&&!projChanged&&!FIRST_STATE)diffState(P,N);else resetForProject()}catch(e){console.error('[NOVA DECK] transition',e)}
 FIRST_STATE=false;
 dirtyAll();
 applyGlobalFlags();
}
function applyGlobalFlags(){
 const lite=M.lowSpec||PERF.mode>0;S.lite=lite;document.body.classList.toggle('lite',lite);
}
/* ======================= one-shot events ======================= */
function onEvent(ev,data){data=data||{};
 if(ev==='toast'){const lv=data.level==='success'?'ok':data.level==='error'?'err':'info';if(data.text)toast(String(data.text),lv);return}
 if(ev==='focus-agent'){if(AGM[data.agentId])cueAgent(data.agentId);return}
 if(ev==='asset-added'){const ids=arr(data.assetIds).map(String);if(ids.length)markNewAssets(ids,true);return}
 if(ev==='run-started'){if(data.runId)launchCeremony(String(data.runId));return}
 if(ev==='run-finished'){if(data.runId)finishCeremony(String(data.runId),String(data.status||''));return}
}
addEventListener('message',ev=>{
 if(!HOST||ev.source!==HOST)return;
 const m=ev.data;if(!m||typeof m!=='object'||typeof m.type!=='string'||m.type.indexOf('dsh-vw/')!==0)return;
 try{
  if(m.type==='dsh-vw/state')onState(m.state);
  else if(m.type==='dsh-vw/result')onResult(m);
  else if(m.type==='dsh-vw/event')onEvent(String(m.event||''),m.data);
 }catch(e){console.error('[NOVA DECK] message',e)}
});
