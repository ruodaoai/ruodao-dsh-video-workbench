/* =====================================================================
   UI · stage — strip, corner blocks, monitor chrome & overlays, dock labels,
   agent focus card, onboarding
   ===================================================================== */
const NARR_SHORT={tts:'AI 配音','tts-beat-sync':'配音+踩拍','subtitle-mv':'卡点 MV'};
const PACE_SHORT={auto:'自动节奏',calm:'舒缓',balanced:'均衡',dynamic:'高燃'};
const CAM_NAME={overview:'全景',follow:'跟随',close:'近景'};
function optLabel(list,v){const o=(M.options[list]||[]).find(x=>x.value===String(v));return o?o.label:String(v||'')}
function qualityLabel(q){q=String(q||'');return /^\d+p$/i.test(q)?q.toLowerCase():q.toUpperCase()}
function summaryParts(){const d=M.director;return[[d.aspectRatio==='auto'?'AI 画幅':d.aspectRatio,1],[qualityLabel(d.quality),1],[d.fps+'fps',0],[d.engine==='html'?'HTML5':'Remotion',0],[NARR_SHORT[d.narrationMode]||optLabel('narrationModes',d.narrationMode),1],[PACE_SHORT[d.pacingMode]||optLabel('pacingModes',d.pacingMode),0],[d.style?optLabel('styles',d.style):'',0]].filter(x=>x[0])}
function renderStrip(){
 const p=M.project;setCls($('#stage'),'noproj',!p);
 setTxt($('#st-proj-t'),p?p.title:'未打开工程');setTitle($('#st-proj-t'),p?p.title:null);
 const tl=M.tl,meta=p?[tl.scenes.length?tl.scenes.length+' 镜':'',tl.bpm?tl.bpm+' BPM':'',tl.totalSec?fmtSec(tl.totalSec):'',p.engine==='html'?'HTML5':'Remotion'].filter(Boolean).join(' · '):'Bridge Viewport';
 setTxt($('#st-proj-m'),meta);
 const parts=summaryParts(),txt=parts.map(x=>x[0]).join(' · ');
 fitSummary(parts);
 const sm=$('#summary');setTitle(sm,'出片参数：'+txt+'（点击打开飞控面板 · P）');setAttr(sm,'aria-label','打开飞控面板，当前参数：'+txt);setTxt($('#dr-sum'),txt);
 const cam=$('#st-cam'),on=!!p&&CAM.zoomed;setCls(cam,'on',on);
 if(on){const T=CAM.tgt||{};setHtml(cam,`<i class="rec"></i><b>CAM</b><em>${esc((CAM.focus?'聚焦':CAM_NAME[CAM.mode])+(T.lbl?' · '+T.lbl:''))}</em><span class="z">×${CAM.s.toFixed(2)}</span>`);setTitle(cam,'镜头：'+(T.lbl||CAM_NAME[CAM.mode]))}
}
const SUMF={key:'',n:0,grow:0};
function fitSummary(parts){
 const el=$('#sum-text');if(!el)return;const key=parts.map(x=>x[0]).join('|');
 const html=k=>parts.slice(0,k).map(([v,kk])=>`<span class="sv${kk?' k':''}">${esc(v)}</span>`).join('<i class="sd"></i>');
 const set=k=>{SUMF.n=k;el.innerHTML=html(k);el._h=null};
 const over=()=>el.scrollWidth>el.clientWidth+1;
 if(SUMF.key!==key||fitSummary.force){SUMF.key=key;fitSummary.force=false;set(parts.length)}
 if(el.offsetParent===null)return;
 while(SUMF.n>0&&over())set(SUMF.n-1);
 if(SUMF.n<parts.length&&S.realT-SUMF.grow>.5){SUMF.grow=S.realT;const n=SUMF.n;set(n+1);if(over())set(n)}
 setCls(el,'none',SUMF.n===0);
}
function renderCorners(){
 const run=M.run,st=run?run.status:'',a=run&&run.activeAgentId,ph=$('#st-phase'),te=$('#st-tele');
 const ident=Math.abs(CAM.s-1)<.004&&Math.abs(CAM.tx)<3&&Math.abs(CAM.ty)<3;
 const show=!!M.project&&G.corner!=='off'&&ident&&!CAM.focus;
 setCls(ph,'off',!show);setCls(te,'off',!show);setAttr(ph,'aria-hidden',show?null:'true');setAttr(te,'aria-hidden',show?null:'true');
 let big='00',of='/ 05 · STANDBY',nm='舰桥待命',en='Awaiting Orders',task=M.director.topic?'8 架无人机已停靠 · 等待「一键出片」指令':'写下主题后点击「一键出片」',cls='';
 const pi=a?PHASE_OF[a]:-1,an=a?(agentOf(a).name||AGM[a].name):'';
 if(run)switch(st){
  case 'queued':of='/ 05 · QUEUED';nm='排队中';en='Queued';task=run.message||'等待调度';break;
  case 'running':if(a){big=PHASES[pi].n;of='/ 05 · PHASE';nm=an;en=PHASES[pi].en;task=agentTask(a)}else{nm='编队执行中';en='Running';task=run.message||'—'}break;
  case 'paused':big=a?PHASES[pi].n:'00';of='/ 05 · PAUSED';nm='已暂停'+(an?' · '+an:'');en='Paused';task=run.message||'点击「继续执行」恢复';cls='warn';break;
  case 'failed':big=a?PHASES[pi].n:'!';of='/ 05 · FAILED';nm='执行失败'+(an?' · '+an:'');en='Failed';task=cleanMsg(run.error||run.message,/^(执行)?失败[：:·\s]*/)||'请查看实时日志';cls='err';break;
  case 'stopped':of='/ 05 · STOPPED';nm='已停止';en='Stopped';task=run.message||'可重试或再次出片';break;
  case 'completed':big='✓';of='/ 05 · READY';nm='成片就绪';en='Ready for Launch';task=`${M.project?M.project.title:''} · ${fmtSec(M.preview.durationSec||M.tl.totalSec)}${M.project?' · '+qualityLabel(M.project.quality)+M.project.fps:''}`;cls='done';break;
 }
 setTxt($('#ph-big'),big);setTxt($('#ph-of'),of);setTxt($('#ph-name'),nm);setTxt($('#ph-en'),en);setTxt($('#ph-task'),task);setTitle($('#ph-task'),task);setTitle($('#ph-name'),nm);
 setCls(ph,'err',cls==='err');setCls(ph,'warn',cls==='warn');setCls(ph,'done',cls==='done');
 let nRun=0,nDone=0,nIdle=0;for(const g of AG){const s=agentOf(g.id).status;if(s==='running')nRun++;else if(s==='done')nDone++;else nIdle++}
 setHtml($('#tele-net'),`<span class="mu">Agent Net</span><span><i class="led ok"></i>${nRun} 运行</span><span><i class="led" style="background:var(--ok)"></i>${nDone} 完成</span><span><i class="led"></i>${nIdle} 待命</span>`);
 setTxt($('#tele-ho'),`${S.handoffs} 次交接`);
 setHtml($('#tele-cam'),`<span class="mu">Cam</span><b>${CAM_NAME[CAM.mode]}</b><span>×${CAM.s.toFixed(2)}</span><span>${S.fps} FPS</span><span>舰时 ${clock()}</span>`);
}
/* ---------- monitor chrome ---------- */
function renderMonitorChrome(){
 const mode=monMode();if(MON.mode!==mode){MON.mode=mode;MON.last=-1}
 const mon=$('#monitor'),vid=videoShown(),p=M.project;
 setCls(mon,'vid',vid);setCls(mon,'fail',mode==='fail');
 const lbl=MON_LBL[mode]||MON_LBL.idle;setTxt($('#mon-mode'),lbl[0]+' · '+lbl[1]);
 const tag=$('#mon-tag'),tg=vid?'PGM':(mode==='render'||mode==='qa')?'REC':mode==='fail'?'FAIL':'PVW';if(tag._t!==tg){tag._t=tg;tag.textContent=tg;tag.className='tag'+(tg==='REC'?' rec':tg==='FAIL'?' err':'')}
 setTxt($('#mon-res'),p?qualityLabel(p.quality)+(p.fps||30):'—');
 const dur=vid?MONV.dur():(M.tl.totalSec||0),t=vid?(MONV.v.currentTime||0):(playheadT()||0);
 setTxt($('#mon-tc'),fmtTC(t,p?p.fps:30));setTxt($('#mon-time'),`${fmtMS(t)} / ${fmtMS(dur)}`);
 const f=dur>0?clamp(t/dur,0,1):0;$('#mon-bar .fl').style.width=(f*100).toFixed(2)+'%';$('#mon-bar .kn').style.left=(f*100).toFixed(2)+'%';setAttr($('#mon-bar'),'aria-valuenow',Math.round(f*100));
 const pb=$('#mon-play'),pi=vid&&!MONV.v.paused?'pause':'play';if(pb._i!==pi){pb._i=pi;pb.innerHTML=ico(pi,14);setAttr(pb,'aria-label',pi==='pause'?'暂停预览':'播放预览')}
 setCls(pb,'dis',!vid);setCls($('#mon-grid'),'dis',!M.tl.scenes.length);
 renderMonState(mode);renderReady();
}
function renderMonState(mode){
 const el=$('#mon-state'),run=M.run,st=run?run.status:'';let k='',b='',s='',btn='',cls='';
 if(M.project){
  if(st==='failed'){k='f';b='执行失败';s=cleanMsg(run.error||run.message,/^(执行)?失败[：:·\s]*/)||'请查看实时日志';btn=['retry','重试出片'];cls='err'}
  else if(st==='stopped'&&!videoShown()){k='s';b='任务已停止';s=cleanMsg(run.message)||'可重试或再次出片';btn=['retry','重试']}
  else if(st==='paused'){k='p';b='已暂停';s=cleanMsg(run.message)||'编队已定格 · 随时继续';btn=['resume','继续执行'];cls='warn'}
  else if(st==='queued'&&!run.activeAgentId){k='q';b='排队中';s=run.message||'等待调度'}
  else if(MONV.err&&videoShown()){k='e';b='成片加载失败';s='文件可能仍在写入 · 稍后重试';btn=['reload','重新加载'];cls='err'}
 }
 const on=!!k;if(el.classList.contains('on')!==on){el.classList.toggle('on',on);MON.last=-1}
 setCls(el,'err',cls==='err');setCls(el,'warn',cls==='warn');
 if(on)setHtml(el,`<b>${esc(b)}</b><span title="${esc(s)}">${esc(s)}</span>${btn?`<button class="btn sm ${cls==='err'?'warn':'pri'}" data-ms="${btn[0]}">${esc(btn[1])}</button>`:''}`);
}
function renderReady(){
 const r=$('#ready'),v=MONV.v,on=isDone()&&videoShown()&&MONV.ready&&v.paused&&(v.currentTime<.05||v.ended)&&!$('#mon-state').classList.contains('on');
 setCls(r,'on',on);setAttr(r,'aria-hidden',on?null:'true');
 if(on){const p=M.project;setHtml(r,`<div class="rd-b"><div class="rd-t">成片就绪<span class="xl"> · READY</span></div><div class="rd-s" title="${esc(p.title)}">${esc(p.title)} · ${fmtSec(MONV.dur())} · ${qualityLabel(p.quality)}${p.fps}</div></div><button class="btn sm pri b1" data-rd="play">${ico('play',12)}<span>预览成片</span></button><button class="btn sm b2" data-rd="export">${ico('box',13)}<span>导出发布包</span></button><button class="btn sm b3" data-rd="again">${ico('retry',13)}<span>再次出片</span></button>`)}
}
/* ---------- dock labels ---------- */
function renderDockLabels(){
 for(const a of AG){const el=dlEls[a.id];if(!el)continue;const ag=agentOf(a.id),s=ag.status,tk=agentTask(a.id),foc=CAM.focus===a.id,nm=ag.name||a.name;
  const key=s+'|'+tk+'|'+foc+'|'+nm;if(el._k===key)continue;el._k=key;
  for(const c of ['idle','wait','run','paused','done','err','stop','skip','foc'])el.classList.remove(c);
  el.classList.add(AST[s].cls);if(foc)el.classList.add('foc');
  setTxt($('.nm',el),nm);setTxt($('.tk',el),tk);setTitle(el,`${a.code} ${nm} · ${AST[s].t} · ${tk}`);setAttr(el,'aria-label',`聚焦 ${nm}（${AST[s].t}）`)}
}
/* ---------- agent focus card ---------- */
function focusAgent(id){if(!AGM[id]||!M.project)return;if(CAM.focus===id){unfocus();return}CAM.focus=id;CAM.autoSwitched=false;renderAgentCard();DIRTY.ui=true}
function unfocus(toOverview=true){if(!CAM.focus&&!toOverview)return;CAM.focus=null;const c=$('#agentcard');c.classList.remove('on');$('#hud').classList.remove('card');if(toOverview)setCam('overview');DIRTY.ui=true}
function renderAgentCard(){
 const id=CAM.focus;if(!id)return;const a=AGM[id],el=$('#agentcard');el.style.setProperty('--c',a.col);el.style.setProperty('--c-rgb',a.rgb);
 el.innerHTML=`<div class="ac-h"><span class="ac-cd">${a.code}</span><div class="ac-hn"><div class="ac-nm" id="ac-nm"></div><div class="mu">${a.en}</div></div><span class="stc" id="ac-st">待命</span><button class="btn sm ico ac-x" data-ac="back" aria-label="关闭详情" title="返回全景（Esc）">${ico('x',12)}</button></div>
 <div class="ac-role">${a.role}</div><div class="ac-task"><span>当前子任务</span><b id="ac-tk"></b></div><div class="ac-bar"><i id="ac-bar"></i></div><div class="ac-log" id="ac-log"></div>
 <div class="ac-act"><button class="btn sm" data-ac="log">${ico('list',12)}日志</button><button class="btn sm" data-ac="tasks">${ico('layers',12)}任务中心</button><button class="btn sm warn" data-ac="retry" hidden>${ico('retry',12)}重试</button><button class="btn sm ghost" data-ac="back">${ico('overview',12)}全景</button></div>`;
 el.classList.add('on');$('#hud').classList.add('card');el._p=null;updateAgentCard();
}
function updateAgentCard(){
 const id=CAM.focus;if(!id)return;const el=$('#agentcard'),ag=agentOf(id),s=ag.status;
 const st=$('#ac-st');if(st._s!==s){st._s=s;st.className='stc '+AST[s].chip;st.textContent=AST[s].t}
 setTxt($('#ac-nm'),ag.name||AGM[id].name);const tk=agentTask(id);setTxt($('#ac-tk'),tk);setTitle($('#ac-tk'),tk);
 $('#ac-bar').style.width=ag.progress.toFixed(1)+'%';
 const logs=M.logs.filter(l=>l.agentId===id).slice(-3);setHtml($('#ac-log'),logs.length?logs.map(l=>`<div title="${esc(l.text)}">${hhmmss(l.ts)} ${esc(l.text)}</div>`).join(''):`<div>${esc(IDLE_TASK[id])}</div>`);
 const rb=$('[data-ac="retry"]',el),canRetry=s==='failed'||(M.run&&(M.run.status==='failed'||M.run.status==='stopped'));if(rb.hidden===canRetry)rb.hidden=!canRetry;
 // place beside the drone, inside the stage view, below the strip
 const p=agentPose(id),v=stageView(),cw=el.offsetWidth||268,ch=el.offsetHeight||220;
 let x=p.x>v.x+v.w/2?p.x-cw-46:p.x+46,y=p.y-ch/2;x=clamp(x,v.x+8,Math.max(v.x+8,v.x+v.w-cw-8));y=clamp(y,v.y+8,Math.max(v.y+8,v.y+v.h-ch-8));
 if(!el._p||Math.abs(el._p.x-x)>.5||Math.abs(el._p.y-y)>.5){el._p={x,y};el.style.left=x.toFixed(1)+'px';el.style.top=y.toFixed(1)+'px'}
}
/* ---------- onboarding (project === null) ---------- */
const ONB={noHost:false};
function renderOnboard(){
 const ob=$('#onboard'),on=(M.ready||ONB.noHost)&&!M.project;setCls(ob,'on',on);setCls($('#stage'),'noproj',!M.project);
 if(!on){ob._k='';return}
 const rec=M.projects.slice().sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,4);
 const key=rec.map(p=>p.dir+'|'+p.title+'|'+p.updatedAt+'|'+p.hasMp4).join(',')+'|'+ONB.noHost+'|'+G.st.h;if(ob._k===key)return;ob._k=key;
 ob.innerHTML=`<div class="mu">Welcome Aboard · 欢迎登舰</div><h3>新建或打开一个视频工程</h3><p class="ob-d">8 架 AI 无人机已停靠舷窗外环。创建工程后导入素材、写下主题，一键出片即可协同完成策划、剪辑、配音、动效与渲染。</p><div class="ob-act"><button class="btn pri" data-ob="new">${ico('plus',14)}新建工程</button><button class="btn" data-ob="open">${ico('folder',14)}打开工程</button></div>${rec.length?`<div class="ob-rl">最近工程</div><div class="ob-recent">${rec.map(p=>`<button class="ob-p" data-dir="${esc(p.dir)}" title="${esc(p.title)}" aria-label="打开工程 ${esc(p.title)}"><i class="led${p.hasMp4?' ok':''}"></i><b>${esc(p.title)}</b><em>${esc(relTime(p.updatedAt))}</em></button>`).join('')}</div>`:''}${ONB.noHost?'<p class="ob-nh">未检测到宿主连接 · 独立预览模式</p>':''}`;
 // never let the card scroll: drop recent rows, then the description, until it fits
 const fit=()=>ob.scrollHeight<=ob.clientHeight+1;
 let guard=0;while(!fit()&&guard++<8){const rows=$$('.ob-p',ob);if(rows.length>1){rows[rows.length-1].remove();continue}const d=$('.ob-d',ob);if(d){d.remove();continue}const rl=$('.ob-rl',ob),rc=$('.ob-recent',ob);if(rc){rc.remove();if(rl)rl.remove();continue}break}
}
function wireStage(){
 $('#summary').onclick=()=>openDrawer();
 $('#docklabels').onclick=e=>{const d=e.target.closest('.dl');if(d)focusAgent(d.dataset.agent)};
 $('#docklabels').onkeydown=e=>{if(e.key!=='Enter'&&e.key!==' ')return;const d=e.target.closest('.dl');if(d){e.preventDefault();focusAgent(d.dataset.agent)}};
 $('#stage').addEventListener('click',e=>{if(!M.project||e.target.closest('.dl,#monitor,.summary,.st-strip,.onboard'))return;let best=null,bd=34;for(const a of AG){const p=agentPose(a.id),d=Math.hypot(p.x-e.clientX,p.y-e.clientY);if(d<bd){bd=d;best=a.id}}if(best)focusAgent(best);else if(CAM.focus)unfocus()});
 $('#agentcard').onclick=e=>{const b=e.target.closest('[data-ac]');if(!b)return;const k=b.dataset.ac;if(k==='back'){unfocus();return}if(k==='log'){setMcTab('log');const lg=$('#log');LOG.stick=true;lg.scrollTop=lg.scrollHeight;return}if(k==='tasks'){openPanel('tasks');return}if(k==='retry')act('retry',{},{btn:b})};
 $('#mon-play').onclick=e=>{e.stopPropagation();monTogglePlay()};
 const bar=$('#mon-bar');
 bar.addEventListener('pointerdown',e=>{if(!videoShown()){monTogglePlay();return}const seek=ev=>{const r=bar.getBoundingClientRect();monSeekT((ev.clientX-r.left)/Math.max(1,r.width)*MONV.dur())};seek(e);bar.setPointerCapture(e.pointerId);bar.onpointermove=seek;bar.onpointerup=()=>{bar.onpointermove=null}});
 bar.addEventListener('keydown',e=>{if(!videoShown())return;const d=e.key==='ArrowRight'?5:e.key==='ArrowLeft'?-5:0;if(d){e.preventDefault();monSeekT((MONV.v.currentTime||0)+d)}});
 $('#mon-grid').onclick=()=>openSceneSheet();$('#mon-exp').onclick=()=>openPlayer();
 $('#mon-state').onclick=e=>{const b=e.target.closest('[data-ms]');if(!b)return;const k=b.dataset.ms;if(k==='reload')syncVideoSrc(true);else act(k,{},{btn:b})};
 $('#ready').onclick=e=>{const b=e.target.closest('[data-rd]');if(!b)return;const k=b.dataset.rd;if(k==='play'){if(CAM.mode!=='close'&&!CAM.focus){setCam('close',false);CAM.autoSwitched=true}monTogglePlay()}else if(k==='export')openPanel('export');else runAction()};
 $('#onboard').onclick=e=>{const b=e.target.closest('[data-ob],[data-dir]');if(!b)return;if(b.dataset.ob==='new')openPanel('newProject');else if(b.dataset.ob==='open')openPanel('projects');else if(b.dataset.dir)act('selectProject',{dir:b.dataset.dir},{btn:b,pendMs:30000})};
 $('#ch-mini').onclick=()=>{if(CAM.focus)unfocus(false);setCam('overview')};
 $('#ch-mini').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(CAM.focus)unfocus(false);setCam('overview')}};
 const tw=$('#tl-wrap');
 tw.addEventListener('pointermove',e=>tlPointer(e,false));tw.addEventListener('pointerleave',()=>{$('#tl-tip').classList.remove('on');if(TL.hover!==-1){TL.hover=-1;TL.dirty=true}});
 tw.addEventListener('click',e=>tlPointer(e,true));
 tw.addEventListener('wheel',e=>{if(!M.project)return;e.preventDefault();if(e.ctrlKey){tlZoomStep(e.deltaY<0?1:-1);return}if(TL.zoom>1){const vis=(TL.cssW-TL.padL-TL.padR)/TL.pps;TL.goal=clamp((TL.goal??TL.view0)+(e.deltaY+e.deltaX)/TL.pps*.6,0,Math.max(0,tlDur()-vis))}},{passive:false});
 $('#tz-in').onclick=()=>tlZoomStep(1);$('#tz-out').onclick=()=>tlZoomStep(-1);$('#tz-fit').onclick=()=>tlZoomSet(0);
}
