/* =====================================================================
   UI · panels — static builders, top bar, cargo bay, mission control, live log
   ===================================================================== */
const dlEls={},capEls={},stgEls={},roEls={};
let CAPS_KEY='',STG_KEY='';
function buildStatic(){
 $('#docklabels').innerHTML=AG.map(a=>`<div class="dl idle" data-agent="${a.id}" style="--c:${a.col};--c-rgb:${a.rgb}" role="button" tabindex="0" aria-label="聚焦 ${a.name}"><div class="l1"><span class="cd">${a.code}</span><span class="en">${a.en}</span><i class="dot"></i></div><div class="nm">${a.name}</div><div class="tk">${IDLE_TASK[a.id]}</div></div>`).join('');
 AG.forEach(a=>{dlEls[a.id]=$(`.dl[data-agent="${a.id}"]`)});
 $('#roster').innerHTML=AG.map(a=>`<div class="ro idle" data-agent="${a.id}" style="--c:${a.col};--c-rgb:${a.rgb}" role="button" tabindex="0" aria-label="聚焦 ${a.name}"><i class="bar"></i><span class="cd">${a.code}</span><span class="nm">${a.name}<em>${a.en.toUpperCase()}</em></span><span class="stc">待命</span><span class="tk">${IDLE_TASK[a.id]}</span><span class="pg"><i></i></span></div>`).join('');
 AG.forEach(a=>{roEls[a.id]=$(`.ro[data-agent="${a.id}"]`)});
 $('#rail').insertAdjacentHTML('beforeend',PHASES.map(p=>`<div class="rn" data-ph="${p.id}" title="${p.name}"><i>${+p.n}</i><span class="l4">${p.name}</span><span class="l2">${p.s2}</span></div>`).join(''));
 $('#segbar').innerHTML='<i></i>'.repeat(48);
 $('#tl-legend').innerHTML=TRACKS.map(t=>[t.n,t.c]).concat([['突降','#FF4FD8']]).map(([n,c])=>`<span><i style="background:${c}"></i>${n}</span>`).join('');
 $('#log').innerHTML='<div class="sp0"></div><div class="lines" id="log-lines"></div>';$('.sec-log').insertAdjacentHTML('beforeend','<button class="log-more" id="log-more" aria-label="跳到最新日志">↓ 有新日志 · 回到最新</button>');
}

/* ======================= top bar ======================= */
function statusInfo(k){const s=M.status[k]||{ok:false,label:'—'};
 if(k==='llm')return{led:s.ok?'ok':'warn',v:s.ok?s.label:'未配置',tip:s.ok?`大模型 · ${s.label}（点击设置）`:'大模型未配置 · 点击设置'};
 if(k==='tts')return{led:s.ok?'ok':'warn',v:s.label||'—',tip:`配音引擎 · ${s.label}${s.ok?' · 就绪':' · 未就绪'}（点击设置）`};
 if(k==='gpu'){const safe=M.lowSpec;return{led:safe?'warn':s.ok&&s.label!=='CPU 模式'?'ok':'',v:safe?'低配保护':s.label,tip:`算力 · ${s.label}${safe?' · 低配保护已开启':''}（点击算力体检）`}}
 return{led:s.ok?'ok':'',v:s.label||'—',tip:`口型引擎 · ${s.label}${s.ok?' · 就绪':''}（点击数字人设置）`};
}
function renderTop(){
 const p=M.project,pb=$('#proj-btn');
 setCls(pb,'none',!p);setTxt($('#proj-name'),p?p.title:'未打开工程');setTitle(pb,p?`当前工程：${p.title}（点击切换）`:'新建或打开工程');setAttr(pb,'aria-label',p?`切换工程，当前：${p.title}`:'新建或打开工程');
 const back=$('#tb-back');if(back.hidden!==(M.host!=='dsh'))back.hidden=M.host!=='dsh';
 const bz=$('#tb-busy'),busy=M.busy;if(bz.hidden!==!busy)bz.hidden=!busy;setTxt($('#tb-busy-t'),busy);setTitle(bz,busy||null);
 const live=isLive(),aa=M.run&&M.run.activeAgentId;
 const busyLed={llm:live&&(aa==='director'||aa==='motion'),tts:live&&aa==='audio',gpu:live&&aa==='qa',lipsync:live&&aa==='avatar'};
 const leds=[];
 for(const d of STATUS_DEF){const si=statusInfo(d.k),el=$(`.sl[data-sl="${d.k}"]`),sk=d.k==='lipsync'?'lip':d.k;const led=busyLed[d.k]&&si.led==='ok'?'busy':si.led;
  const le=$('#led-'+sk);if(le._c!==led){le._c=led;le.className='led '+led}setTxt($('#sl-'+sk),si.v);setTitle(el,si.tip);setAttr(el,'aria-label',si.tip);setCls(el,'bad',si.led==='warn');leds.push(led)}
 ['a1','a2','a3','a4'].forEach((k,i)=>{const le=$('#led-'+k);if(le._c!==leds[i]){le._c=leds[i];le.className='led '+leds[i]}});
 const tip=STATUS_DEF.map(d=>`${d.n}：${statusInfo(d.k).v}`).join(' · ');const all=$('#sl-all');setTitle(all,tip+'（点击查看）');setAttr(all,'aria-label','引擎状态：'+tip);
 setTxt($('#plaza-n'),M.counts.plazaTemplates?String(M.counts.plazaTemplates):'');
 const sk=SKINS.find(s=>s.id===M.skin)||SKINS[0],sb=$('#skin-btn');setTxt($('b',sb),sk.short);setTxt($('.sn',sb),sk.name);setTitle(sb,`作战大屏皮肤：${sk.short} · ${sk.name}（点击切换）`);
}

/* ======================= cargo bay ======================= */
function visibleAssets(){return M.assets.filter(a=>S.filter==='all'||typeOf(a.kind).f===S.filter)}
function capMeta(a){if(a.durationSec>0)return fmtSec(a.durationSec);if(a.width&&a.height)return `${a.width}×${a.height}`;return typeOf(a.kind).n}
function renderFilter(){
 const box=$('#cg-filter'),cnt={all:M.assets.length,image:0,video:0,audio:0,other:0};M.assets.forEach(a=>{cnt[typeOf(a.kind).f]++});
 if(S.filter!=='all'&&!cnt[S.filter])S.filter='all';
 setHtml(box,FILTERS.filter(([k])=>k==='all'||cnt[k]||S.filter===k).map(([k,n,ic])=>`<button class="chip${S.filter===k?' on':''}" data-f="${k}" aria-pressed="${S.filter===k}" title="${n} · ${cnt[k]} 件" aria-label="${n} ${cnt[k]} 件">${k==='all'?n:ico(TYPE[ic].ic,12)}<em>${cnt[k]}</em></button>`).join(''));
}
function capHTML(a){const ty=typeOf(a.kind),thumb=a.thumbUrl||(a.kind==='image'?a.url:''),used=a.used.length;
 return `<div class="cap" role="button" tabindex="0" data-id="${esc(a.id)}" style="--t-rgb:${ty.rgb}" title="${esc(a.name)}" aria-label="${esc(ty.n+' · '+a.name)}"><div class="hatch">${ico(ty.ic,16)}${thumb?`<img alt="" loading="lazy" decoding="async" src="${esc(thumb)}">`:''}</div><div class="cb"><div class="cn">${esc(a.name)}</div><div class="cm"><span class="ty">${ty.en}</span><span>${esc(capMeta(a))}</span>${used?`<span class="us">→ ${used} 镜</span>`:''}</div></div><span class="bay">C-${pad2(a.i+1)}</span><span class="ld"></span><button class="rm" data-rm aria-label="移除素材 ${esc(a.name)}" title="移除素材">${ico('trash',13)}</button></div>`}
function renderCaps(){
 const box=$('#caps'),list=visibleAssets();
 setTxt($('#cg-meta'),M.project?`${M.assets.length} 件在舱`:'—');
 const key=(M.project?M.project.dir:'-')+'|'+S.filter+'|'+list.map(a=>a.id+':'+a.name+':'+a.thumbUrl+':'+a.used.length+':'+a.durationSec+':'+a.width).join(',');
 if(key===CAPS_KEY)return false;CAPS_KEY=key;
 for(const k in capEls)delete capEls[k];
 if(!M.project)box.innerHTML=`<div class="caps-empty"><b>货运机库待命</b><span>新建或打开工程后，可在此导入图片、视频、音乐与配音素材</span></div>`;
 else if(!list.length)box.innerHTML=M.assets.length?`<div class="caps-empty"><b>该分类暂无素材</b><span>切换到「全部」查看其他素材</span></div>`:`<div class="caps-empty"><b>机库空空</b><span>拖拽文件到这里，或点击「导入素材」</span></div>`;
 else{box.innerHTML=list.map(capHTML).join('');[...box.children].forEach((el,i)=>{capEls[list[i].id]=el});box.querySelectorAll('img').forEach(img=>{img.onerror=()=>img.remove()})}
 return true;
}
function syncCaps(){
 const so=sortieNow(),ed=agentOf('editor').status,lifting=so&&so.v>=1.35&&so.v<2.85?so.s.asset:null,grab=so&&so.v>=.95&&so.v<1.35?so.s.asset:null,now=S.realT;
 for(const a of M.assets){const el=capEls[a.id];if(!el)continue;
  setCls(el,'lifting',lifting===a.id);setCls(el,'grab',grab===a.id);
  const ld=lifting!==a.id&&grab!==a.id&&(!!S.snapped[a.id]||(a.used.length>0&&(ed==='done'||isDone())));
  setCls(el,'loaded',ld);
  if(ld){const f=typeOf(a.kind).f;let t;if(f==='audio')t=a.kind==='voice'?'→ A1 配音':a.kind==='sfx'?'→ A2 音效':'→ A3 配乐';else{const sc=M.tl.scenes.find(s=>a.used.includes(s.id));t=sc?`→ V1 #${pad2(sc.n)}${a.used.length>1?' +'+(a.used.length-1):''}`:'已装载'}const ldEl=$('.ld',el);setTxt(ldEl,t);setTitle(ldEl,`已装载到 ${a.used.length} 个分镜`)}
  const nt=S.newIds[a.id],isNew=nt!=null&&now-nt<1.3;if(isNew&&!el._new){el._new=1;el.classList.remove('new');void el.offsetWidth;el.classList.add('new')}else if(!isNew&&el._new){el._new=0;el.classList.remove('new')}
 }
}
function stgHTML(x){const ty=x.kind==='audio'?TYPE.music:typeOf(x.kind),meta=[x.provider,x.prompt].filter(Boolean).join(' · ')||ty.n;
 return `<div class="stg" role="listitem" data-id="${esc(x.id)}" style="--t-rgb:${ty.rgb}"><div class="th" data-act="prev" role="button" tabindex="0" aria-label="${x.kind==='audio'?'试听':'预览'} ${esc(x.name)}" title="${x.kind==='audio'?'试听':'预览'}">${x.thumbUrl?`<img alt="" loading="lazy" decoding="async" src="${esc(x.thumbUrl)}">`:ico(ty.ic,20)}</div><div class="sb"><div class="sn" title="${esc(x.name)}">${esc(x.name)}</div><div class="sm" title="${esc(meta)}">${esc(meta)}</div><div class="sa"><button class="btn sm pri" data-act="ok" aria-label="确认入库 ${esc(x.name)}" title="确认入库">${ico('check',12)}<span class="bl">确认入库</span></button><button class="btn sm ico ghost" data-act="del" aria-label="丢弃 ${esc(x.name)}" title="丢弃">${ico('x',12)}</button></div></div></div>`}
function renderStaging(){
 const list=M.staging,box=$('#stg-list');
 setTxt($('#stg-n'),`${list.length} 件`);setTitle($('#stg-h'),`云端生成 · 待确认入库 ${list.length} 件（点击折叠 / 展开）`);
 const key=list.map(x=>x.id+':'+x.name+':'+x.thumbUrl+':'+x.provider).join(',');
 if(key===STG_KEY)return false;STG_KEY=key;for(const k in stgEls)delete stgEls[k];
 box.innerHTML=list.map(stgHTML).join('');[...box.children].forEach((el,i)=>{stgEls[list[i].id]=el});
 box.querySelectorAll('img').forEach(img=>{img.onerror=()=>img.remove()});
 return true;
}
function syncStaging(){const now=S.realT;for(const x of M.staging){const el=stgEls[x.id];if(!el)continue;const t=S.stgNew&&S.stgNew[x.id];setCls(el,'wait',t!=null&&now-t<2.4)}}

/* ======================= mission control ======================= */
function phaseLine(){
 const p=M.project,run=M.run;if(!p)return '未打开工程 · 新建或打开后即可出片';if(!run)return '待命 · 等待出片指令';
 const a=run.activeAgentId,an=a?(agentOf(a).name||AGM[a].name):'';
 switch(run.status){
  case 'queued':return '排队中 · '+(run.message||'等待调度');
  case 'running':return a?`${PHASES[PHASE_OF[a]].n} / 05 · ${an} · ${agentTask(a)}`:(run.message||'编队执行中');
  case 'paused':return '已暂停'+(an?' · '+an:'');
  case 'failed':return '执行失败 · '+(cleanMsg(run.error||run.message,/^(执行)?失败[：:·\s]*/)||'请查看日志');
  case 'stopped':return '已停止 · '+(cleanMsg(run.message,/^(用户)?已?(立即)?停止[^，,·]*[，,·]?\s*/)||'可重试或再次出片');
  case 'completed':return `成片就绪 · ${fmtSec(M.preview.durationSec||M.tl.totalSec)}`;
 }return run.message||'—';
}
function etaText(){const r=M.run;if(!r)return '--:--';if(r.status==='completed')return '完成';if(!runLive(r)||r.progress<3||r.elapsedSec<5)return '--:--';return fmtMS(r.elapsedSec*(100-r.progress)/r.progress)}
function runMode(){const p=M.project,r=M.run;if(!p)return 'new';if(!r)return 'run';if(r.status==='paused')return 'resume';if(r.status==='failed')return 'retry';if(runLive(r))return 'busy';return r.status==='completed'?'again':'run'}
const RUN_LBL={new:'新建工程',run:'一键出片',again:'再次出片',resume:'继续执行',retry:'重试出片'};
function renderMission(){
 const run=M.run,mi=$('#mission'),live=isLive(),st=run?run.status:'';
 setCls(mi,'st-err',st==='failed');setCls(mi,'st-warn',st==='paused');setCls(mi,'st-done',st==='completed');
 const chip=$('#run-chip'),cs=!M.project?['','未开工程']:!run?['','待命']:[RUNST[st].chip,RUNST[st].t];if(chip._s!==cs.join('|')){chip._s=cs.join('|');chip.className='stc '+cs[0];chip.textContent=cs[1]}
 const pct=run?Math.round(st==='completed'?100:run.progress):0;setTxt($('#pct'),String(pct));
 const pl=phaseLine();setTxt($('#mc-phase'),pl);setTitle($('#mc-phase'),pl);
 setTxt($('#t-el'),run?fmtMS(run.elapsedSec):'00:00');setTxt($('#t-eta'),etaText());
 setTxt($('#mc-stats'),`镜头 ${M.tl.scenes.length} · 节拍 ${M.tl.beats.length} · 音效 ${M.tl.sfx.length} · 素材 ${M.assets.length}`);
 const cells=$('#segbar').children,lit=Math.floor(pct/100*cells.length);if(mi._lit!==lit+'|'+live){mi._lit=lit+'|'+live;for(let i=0;i<cells.length;i++)cells[i].className=i<lit?'on':(i===lit&&live&&st!=='paused'?'hd':'')}
 // run controls
 const rm=runMode(),rb=$('#btn-run');
 if(rb._m!==rm||rm==='busy'){rb._m=rm;setCls(rb,'busy',rm==='busy');setCls(rb,'retry',rm==='retry');setCls(rb,'idle',rm!=='busy'&&rm!=='retry');const lbl=rm==='busy'?($('#mission').classList.contains('narrow')?`执行中 ${pct}%`:`编队执行中 ${pct}%`):RUN_LBL[rm];setTxt($('#run-txt'),lbl);setAttr(rb,'aria-label',lbl);setTitle(rb,rm==='busy'?'编队执行中 · 可暂停或停止':rm==='new'?'新建视频工程':lbl+'（R）')}
 const bp=$('#btn-pause'),pm=st==='paused'?'resume':(st==='running'||st==='queued')?'pause':'';
 bp.disabled=!pm;if(bp._m!==pm){bp._m=pm;bp.innerHTML=ico(pm==='resume'?'play':'pause',15);setAttr(bp,'aria-label',pm==='resume'?'继续':'暂停');setTitle(bp,pm==='resume'?'继续执行':'暂停')}
 $('#btn-stop').disabled=!live;$('#btn-retry').disabled=!(st==='failed'||st==='stopped');
 $('#btn-polish').disabled=!M.project;
 const tg=$('#tog-follow');setCls(tg,'on',CAM.auto);setAttr(tg,'aria-checked',String(CAM.auto));
 // phase rail
 let far=-1,frac=0;
 $$('.rn').forEach((n,i)=>{const s=agentOf(PHASES[i].id).status;const cls=s==='done'?'done':(s==='running'||s==='paused')?'on':s==='failed'?'err':s==='skipped'?'skip':'';
  if(n._c!==cls){n._c=cls;n.className='rn'+(cls?' '+cls:'')}if(s==='done'){far=Math.max(far,i);if(far===i)frac=0}if(s==='running'||s==='paused'||s==='failed'){if(i>=far){far=i;frac=agentOf(PHASES[i].id).progress/100}}});
 const f=st==='completed'?1:far<0?0:clamp((far+frac)/4,0,1);$('#rail-f').style.width=`calc((100% - 56px) * ${f.toFixed(4)})`;
 // roster
 let nRun=0,nDone=0;
 for(const a of AG){const ag=agentOf(a.id),s=ag.status,tk=agentTask(a.id),foc=CAM.focus===a.id,ro=roEls[a.id];if(s==='running')nRun++;else if(s==='done')nDone++;
  const key=s+'|'+tk+'|'+foc+'|'+ag.name;if(ro._k!==key){ro._k=key;ro.className='ro '+AST[s].cls+(foc?' foc':'');const sc=$('.stc',ro);sc.className='stc '+AST[s].chip;sc.textContent=AST[s].t;$('.tk',ro).textContent=tk;setTitle(ro,`${ag.name||a.name} · ${AST[s].t} · ${tk}`)}
  $('.pg i',ro).style.width=ag.progress.toFixed(1)+'%'}
 setTxt($('#ro-n'),live||run?`${nRun} 运行 · ${nDone} 完成`:'8 架停靠');setTxt($('#ro-n2'),run?`${nRun}/${nDone}`:'8');setTxt($('#log-n2'),String(M.logs.length));
}

/* ======================= live log ======================= */
const LOG={keys:new Set(),sig:'',reset:true,stick:true,prog:0};
function renderLog(){
 const L=M.logs,keys=L.map(logKey),sig=keys.join('\n');
 if(sig===LOG.sig&&!LOG.reset)return;LOG.sig=sig;
 const prev=LOG.reset?new Set(keys):LOG.keys;LOG.reset=false;LOG.keys=new Set(keys);
 const box=$('#log'),lines=$('#log-lines');let fresh=0;
 lines.innerHTML=L.map((l,i)=>{const a=AGM[l.agentId],nw=!prev.has(keys[i]);if(nw)fresh++;const name=a?(agentOf(a.id).name||a.name):'';const full=(name?name+' › ':'')+l.text;
  return `<div class="ln ${l.level}${a?'':' sys'}${nw?' nw':''}"${a?` style="--c:${a.col}"`:''} title="${esc(full)}"><span class="ts">${hhmmss(l.ts)||'--:--:--'} </span>${a?`<span class="ag">${esc(name)}</span> › `:''}${esc(l.text)}</div>`}).join('');
 if(LOG.stick)logPin();else if(fresh)$('#log-more').classList.add('on');
}
function logScrolled(){const b=$('#log');if(performance.now()-LOG.prog<160)return;LOG.stick=b.scrollTop+b.clientHeight>=b.scrollHeight-6;if(LOG.stick)$('#log-more').classList.remove('on')}
function logPin(){const b=$('#log');if(!LOG.stick)return;LOG.prog=performance.now();b.scrollTop=b.scrollHeight}

/* ======================= import ======================= */
function pickFiles(){if(!M.project){toast('请先新建或打开一个工程，再导入素材','warn');return}$('#file-in').click()}
async function importFiles(list){
 const files=[...(list||[])].filter(f=>f&&typeof f.arrayBuffer==='function');if(!files.length)return;
 if(!M.project){toast('请先新建或打开一个工程，再导入素材','warn');return}
 const total=files.reduce((s,f)=>s+(f.size||0),0);
 if(total>1.5e9){toast('一次导入的文件过大（超过 1.5 GB），请分批导入','warn');return}
 const btn=$('#btn-import');btn.classList.add('pending');
 try{const out=[],tr=[];for(const f of files){const data=await f.arrayBuffer();out.push({name:f.name,type:f.type||'',data});tr.push(data)}
  await act('importFiles',{files:out},{transfer:tr,pendMs:180000});
 }catch(e){toast('读取文件失败：'+((e&&e.message)||e),'err')}
 finally{btn.classList.remove('pending')}
}

/* ======================= wiring (panels) ======================= */
function wirePanels(){
 $('#proj-btn').onclick=e=>openProjectMenu(e.currentTarget);
 $('#tb-back').onclick=e=>act('backToChat',{},{btn:e.currentTarget});
 // 作战大屏 closes every native panel; 分步精修 / 任务中心 / 影核广场 open their kit panels (syncModes lights the tab)
 $('#modes').onclick=e=>{const b=e.target.closest('[data-mode]');if(!b)return;if(b.dataset.mode==='deck'){closeAllPanels();while(closeTop());syncModes();return}openPanel(b.dataset.mode)};
 $('#sls').onclick=e=>{const b=e.target.closest('[data-sl]');if(!b)return;const d=STATUS_DEF.find(x=>x.k===b.dataset.sl);if(d)openPanel(d.panel,d.args)};
 $('#sl-all').onclick=e=>openStatusMenu(e.currentTarget);
 $('#skin-btn').onclick=e=>openSkinMenu(e.currentTarget);
 $('#btn-tools').onclick=e=>openToolsMenu(e.currentTarget);
 $('#btn-theme').onclick=()=>openLivery();
 $('#btn-help').onclick=()=>openHelp();
 $('#cam-seg').onclick=e=>{const b=e.target.closest('[data-cam]');if(b)setCam(b.dataset.cam)};
 // cargo
 $('#btn-import').onclick=()=>pickFiles();
 const dz=$('#dropzone');dz.onclick=()=>pickFiles();dz.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pickFiles()}};
 $('#file-in').onchange=e=>{const fs=[...e.target.files];e.target.value='';importFiles(fs)};
 $('#btn-cloudgen').onclick=()=>openPanel('cloud');
 $('#cg-filter').onclick=e=>{const b=e.target.closest('[data-f]');if(!b)return;S.filter=b.dataset.f;renderFilter();renderCaps();layoutCargo()};
 const caps=$('#caps');
 caps.onclick=e=>{const c=e.target.closest('.cap');if(!c)return;const a=M.assets.find(x=>x.id===c.dataset.id);if(!a)return;const rm=e.target.closest('[data-rm]');if(rm){e.stopPropagation();confirmPop(rm,`移除素材「${a.name}」？将从工程素材库中删除。`,'移除',()=>act('removeAsset',{assetId:a.id}),true);return}openAssetModal(a)};
 caps.onkeydown=e=>{if(e.key!=='Enter'&&e.key!==' ')return;const c=e.target.closest('.cap');if(!c||e.target!==c)return;e.preventDefault();const a=M.assets.find(x=>x.id===c.dataset.id);if(a)openAssetModal(a)};
 $('#stg-h').onclick=()=>{STG_USER=$('#staging').classList.contains('col');LS.set('stgOpen',STG_USER);layoutCargo();CAM.ver++};
 $('#stg-list').onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.th[data-act]')){e.preventDefault();e.target.click()}};
 $('#stg-list').onclick=e=>{const b=e.target.closest('[data-act]');if(!b)return;const el=b.closest('.stg'),x=M.staging.find(s=>s.id===el.dataset.id);if(!x)return;
  if(b.dataset.act==='ok'){el.classList.add('busy');act('confirmStaging',{stagingId:x.id},{btn:b}).then(r=>{if(!r.ok)el.classList.remove('busy')})}
  else if(b.dataset.act==='del')confirmPop(b,`丢弃云端结果「${x.name}」？`,'丢弃',()=>{el.classList.add('busy');act('discardStaging',{stagingId:x.id}).then(r=>{if(!r.ok)el.classList.remove('busy')})},true);
  else openStagingModal(x)};
 // mission · brief: a readable multi-line preview; clicking it (or 展开编辑) opens the big 主题需求 editor (PK.editTopic)
 $('#brief').onclick=()=>openTopicEditor();
 $('#brief-x').onclick=()=>openTopicEditor();
 $('#btn-polish').onclick=e=>{if(!M.project){toast('请先新建或打开一个工程','warn');return}if(!topicNow().trim()){toast('先写一句你的想法，再让 AI 润色扩写','warn');openTopicEditor();return}act('polishTopic',{topic:topicNow()},{btn:e.currentTarget,pendMs:60000})};
 $('#btn-run').onclick=()=>runAction();
 $('#btn-pause').onclick=e=>{const st=M.run&&M.run.status;if(st==='paused')act('resume',{},{btn:e.currentTarget});else if(st==='running'||st==='queued')act('pause',{},{btn:e.currentTarget})};
 $('#btn-stop').onclick=e=>confirmPop(e.currentTarget,'停止当前出片任务？已完成的阶段会保留。','停止',()=>act('stop',{}),true);
 $('#btn-retry').onclick=e=>act('retry',{},{btn:e.currentTarget});
 $('#tog-follow').onclick=()=>{CAM.auto=!CAM.auto;LS.set('autoFollow',CAM.auto);if(CAM.auto&&isLive()&&CAM.mode==='overview'&&!CAM.focus){setCam('follow',false);CAM.autoSwitched=true}if(!CAM.auto&&CAM.autoSwitched){setCam('overview',false);CAM.autoSwitched=false}DIRTY.ui=true;toast(CAM.auto?'镜头自动跟随：开 · 出片时自动追踪当前 Agent':'镜头自动跟随：关','info')};
 $('#mc-tabs').onclick=e=>{const b=e.target.closest('[data-tab]');if(b)setMcTab(b.dataset.tab)};
 $('#roster').onclick=e=>{const r=e.target.closest('.ro');if(r)focusAgent(r.dataset.agent)};
 $('#roster').onkeydown=e=>{if(e.key!=='Enter'&&e.key!==' ')return;const r=e.target.closest('.ro');if(r){e.preventDefault();focusAgent(r.dataset.agent)}};
 $('#log').addEventListener('scroll',()=>{logScrolled();cullSoon()},{passive:true});
 for(const s of ['#caps','#stg-list','#roster','#cg-filter'])$(s).addEventListener('scroll',cullSoon,{passive:true});
 $('#log-more').onclick=()=>{LOG.stick=true;logPin();$('#log-more').classList.remove('on')};
}
/* brief preview (the text itself is edited in the kit's big editor, so nothing here can overwrite typing) */
const BRIEF={k:'',h:-1,lines:3};
const charCount=s=>Array.from(String(s||'')).length;
function syncBrief(){
 const box=$('#mc-brief'),bi=$('#brief'),tx=$('#brief-txt');if(!box||!bi||!tx)return;
 const t=topicNow(),has=!!M.project,n=charCount(t);
 setCls(bi,'empty',!t);setCls(box,'noproj',!has);
 setTxt(tx,t||(has?'写下视频主题 / 导演指令…点这里放大编辑，写得越具体成片越贴心':'请先新建或打开一个工程，再写下创意需求'));
 setTxt($('#brief-n'),t?n+' 字':'');
 setAttr(bi,'aria-label',t?`创意需求（${n} 字）：${t.slice(0,80)}${n>80?'…':''}。点击放大编辑`:'创意需求为空，点击放大编辑');
 setTitle(bi,t?(n>600?t.slice(0,600)+'…':t)+'\n\n— 点击放大编辑完整内容':(has?'点击写下创意需求':'请先新建或打开一个工程'));
 const btn=$('#btn-polish');btn.disabled=!has;
 // measure only when the text / width / clamp changed: clamped → 「展开编辑」 is emphasised; a new height re-runs the mission budget
 const k=t+'|'+box.clientWidth+'|'+BRIEF.lines;
 if(k!==BRIEF.k){BRIEF.k=k;setCls(box,'clamped',tx.scrollHeight>tx.clientHeight+2);const hh=box.offsetHeight;if(hh!==BRIEF.h){BRIEF.h=hh;DIRTY.layout=true}}
}
function runAction(){
 const m=runMode(),btn=$('#btn-run');
 if(m==='new'){openPanel('newProject');return}
 if(m==='busy'){toast('编队执行中 · 可暂停或停止当前任务','info');return}
 if(m==='resume'){act('resume',{},{btn});return}
 if(m==='retry'){act('retry',{},{btn});return}
 const topic=topicNow().trim();
 if(!topic){toast('请先写下视频主题 / 导演指令','warn');openTopicEditor();return}
 act('run',{topic},{btn,pendMs:20000});
}

/* ======================= scroll-list culling =======================
   Rows scrolled (even partly) out of a list viewport are visibility:hidden, so
   no clipped text ever sits behind a neighbouring panel. */
function cullList(box,sel){if(!box)return;const vis=box.offsetParent!==null;const r=vis?box.getBoundingClientRect():null;const items=sel?box.querySelectorAll(sel):box.children;
 for(const el of items){let out=false;if(r){const q=el.getBoundingClientRect();out=q.height>0&&(q.top<r.top-1||q.bottom>r.bottom+1||q.left<r.left-1||q.right>r.right+1)}const v=out?'hidden':'';if(el.style.visibility!==v)el.style.visibility=v}}
function cullLists(){cullList($('#caps'),'.cap');cullList($('#stg-list'),'.stg');cullList($('#roster'),'.ro');cullList($('#log'),'.ln');cullList($('#cg-filter'),'.chip')}
let CULL_RAF=0;function cullSoon(){if(CULL_RAF)return;CULL_RAF=requestAnimationFrame(()=>{CULL_RAF=0;cullLists()})}
