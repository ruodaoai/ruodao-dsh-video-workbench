/* =====================================================================
   OVERLAYS — toasts, popover menus, confirm, modals, flight-control drawer
   Every tool (cloud media, voices, teleprompter, settings …) is a native kit
   panel (openPanel → PK.open); the skin's own modals (asset detail, scene
   sheet, enlarged preview) are framed by the kit too, so one look, one Esc.
   ===================================================================== */
function toast(msg,kind='info',ms=2800){
 if(!msg)return;
 // one toast style: the kit renders every toast (skin + panels), themed NOVA in css/97-kit-theme.css
 const p=pk();if(p&&p.toast){try{p.toast(String(msg),kind==='ok'?'success':kind==='err'?'error':kind==='warn'?'warn':'info',{timeout:kind==='err'?Math.max(ms,4200):Math.max(ms,2400)});return}catch(e){}}
 const box=$('#toasts');if(!box)return;const el=document.createElement('div');
 el.className='toast'+(kind==='warn'?' warn':kind==='ok'?' ok':kind==='err'?' err':'');el.setAttribute('role',kind==='err'?'alert':'status');
 el.innerHTML=`<i>${ico(kind==='warn'||kind==='err'?'warn':kind==='ok'?'check':'bolt',15)}</i><span title="${esc(msg)}">${esc(msg)}</span>`;
 box.appendChild(el);while(box.children.length>3)box.firstChild.remove();
 setTimeout(()=>{el.classList.add('out');setTimeout(()=>el.remove(),450)},kind==='err'?Math.max(ms,4200):ms);
}
/* ======================= popovers ======================= */
let POP=null;
function openPop(anchor,html,onPick,cls=''){
 if(POP&&POP.anchor===anchor){closePop();return null}
 closePop();const el=document.createElement('div');el.className='pop '+cls;el.setAttribute('role','menu');el.innerHTML=html;$('#pop-root').appendChild(el);hydrate(el);
 const r=anchor.getBoundingClientRect();el.style.minWidth=Math.min(innerWidth-16,Math.max(220,r.width))+'px';
 const place=()=>{const pw=el.offsetWidth,ph=el.offsetHeight;let x=r.left,y=r.bottom+6;if(x+pw>innerWidth-8)x=innerWidth-8-pw;if(x<8)x=8;if(y+ph>innerHeight-8)y=Math.max(8,r.top-ph-6);el.style.left=x+'px';el.style.top=y+'px'};
 place();requestAnimationFrame(()=>{place();el.classList.add('on')});
 el.addEventListener('click',e=>{const b=e.target.closest('.pi');if(!b||b.disabled||!onPick)return;closePop();onPick(b.dataset.v,b,e)});
 POP={el,anchor};setTimeout(()=>addEventListener('pointerdown',popOutside,true),0);
 return el;
}
function popOutside(e){if(POP&&!POP.el.contains(e.target)&&!POP.anchor.contains(e.target))closePop()}
function closePop(){if(!POP)return false;const el=POP.el;POP=null;removeEventListener('pointerdown',popOutside,true);el.classList.remove('on');el.style.pointerEvents='none';el.style.visibility='hidden';setTimeout(()=>el.remove(),180);return true}
function confirmPop(anchor,text,ok,onOk,danger){
 const el=openPop(anchor,`<div class="pc"><p>${esc(text)}</p><div class="pc-a"><button class="btn sm ghost" data-c="no">取消</button><button class="btn sm ${danger?'danger':'pri'}" data-c="ok">${esc(ok)}</button></div></div>`,null,'confirm-pop');
 if(!el)return;el.setAttribute('role','alertdialog');el.addEventListener('click',e=>{const b=e.target.closest('[data-c]');if(!b)return;closePop();if(b.dataset.c==='ok')onOk()});
 setTimeout(()=>{const b=el.querySelector('[data-c="ok"]');b&&b.focus()},40);
}
function openProjectMenu(anchor){
 const cur=M.project&&M.project.dir,ps=M.projects.slice().sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
 openPop(anchor,`<div class="pl">工程 · Projects</div><div class="list">${ps.length?ps.map(p=>`<button class="pi${p.dir===cur?' on':''}" data-v="${esc(p.dir)}" title="${esc(p.title)}" role="menuitem"><i>${ico(p.dir===cur?'check':'film',14)}</i><span class="pt">${esc(p.title)}</span><em>${esc([relTime(p.updatedAt),p.hasMp4?'已出片':''].filter(Boolean).join(' · '))}</em></button>`).join(''):'<div class="pe">暂无工程 · 点击下方新建</div>'}</div><div class="ps"></div><button class="pi" data-v="__new" role="menuitem"><i>${ico('plus',14)}</i><span>新建工程…</span></button><button class="pi" data-v="__all" role="menuitem"><i>${ico('folder',14)}</i><span>管理全部工程</span></button>`,
  v=>{if(v==='__new')openPanel('newProject');else if(v==='__all')openPanel('projects');else if(v!==cur)act('selectProject',{dir:v},{pendMs:30000})},'proj-pop');
}
/* skin switcher: A / B / C only (the classic UI no longer exists) */
function openSkinMenu(anchor){const cur=M.skin;
 openPop(anchor,`<div class="pl">作战大屏皮肤 · Skins</div>${SKINS.map(s=>`<button class="pi${s.id===cur?' on':''}" data-v="${s.id}" role="menuitemradio" aria-checked="${s.id===cur}"><b style="background:${s.sw}">${s.short}</b><span>${s.name}</span><em>${s.en}</em></button>`).join('')}`,
  v=>{if(v&&v!==cur&&SKINS.some(s=>s.id===v))act('setSkin',{skin:v})},'skin-pop');
}
function openStatusMenu(anchor){
 openPop(anchor,`<div class="pl">引擎状态 · Status</div>${STATUS_DEF.map(d=>{const si=statusInfo(d.k);return `<button class="pi" data-v="${d.k}" title="${esc(si.tip)}" role="menuitem"><i class="led ${si.led}"></i><span>${d.n}</span><em class="sv">${esc(si.v)}</em></button>`}).join('')}`,v=>{const d=STATUS_DEF.find(x=>x.k===v);if(d)openPanel(d.panel,d.args)},'status-pop');
}
/* 舰务工具 · Tools — the prototype's settings popover; every entry is a native kit panel.
   Panels registered by the kit but not listed here are appended, so nothing becomes unreachable. */
function openToolsMenu(anchor){
 const p=pk(),known=id=>!p||!p.panels||!p.panels.has||p.panels.has(id);
 const listed=new Set(SETTINGS.map(s=>s[0]).concat(['help','livery','kitchen','studio','tasks','plaza','projects','newProject']));
 const extra=p&&p.catalog?p.catalog().filter(c=>!listed.has(c.id)):[];
 const row=(id,ic,n,hint)=>`<button class="pi${known(id)?'':' soon'}" data-v="${esc(id)}" role="menuitem"><i>${IC[ic]?ico(ic,15):ico('layers',15)}</i><span>${esc(n)}</span>${known(id)?(hint?`<em>${esc(hint)}</em>`:''):'<em>接入中</em>'}</button>`;
 openPop(anchor,`<div class="pl">舰务工具 · Tools</div>${SETTINGS.map(t=>t[0]==='-'?'<div class="ps"></div>':row(t[0],t[1],t[2],t[3])).join('')}${extra.length?'<div class="ps"></div>'+extra.map(c=>row(c.id,c.icon,c.title,'')).join(''):''}<div class="ps"></div><button class="pi" data-v="__theme" role="menuitem"><i>${ico('palette',15)}</i><span>舰桥涂装 · 主题</span><em>${esc((THEMES[THEME]||THEMES.ion).n)} · T</em></button><button class="pi" data-v="__low" role="menuitem"><i>${ico('shield',15)}</i><span>低配保护</span><em>${M.lowSpec?'已开启':'已关闭'}</em></button><button class="pi" data-v="__help" role="menuitem"><i>${ico('help',15)}</i><span>使用帮助 · 快捷键</span><em>?</em></button>`,
  v=>{if(v==='__low')act('setLowSpec',{on:!M.lowSpec});else if(v==='__help')openHelp();else if(v==='__theme')openLivery();else openPanel(v)},'tools-pop');
}
/* ======================= modals ======================= */
let MODAL=null,MTICK=null;
function stopMedia(root){$$('video,audio',root).forEach(v=>{try{v.pause()}catch(e){}})}
/* skin modals are framed by the kit (PK.frame) → identical chrome to every native panel, one focus trap / Esc stack */
function openModal({title,en,size='',body,foot='',mount,close,idx,icon}){
 closeModal(true);closePop();
 const p=pk();
 if(p&&p.frame){
  let f=null;
  f=p.frame({kind:'modal',size:size==='lg'?'lg':size==='sm'?'sm':'md',title:String(title||''),en:String(en||''),idx:idx||null,icon:icon||null,class:'nd-modal',
   onClose:()=>{if(MODAL&&MODAL.f===f){MODAL=null;MTICK=null}stopMedia(f.el);try{close&&close()}catch(e){}}});
  const wrap=document.createElement('div');wrap.className='nd-mb';wrap.innerHTML=body;hydrate(wrap);f.body.appendChild(wrap);
  if(foot){const ft=document.createElement('div');ft.className='nd-mf';ft.innerHTML=foot;hydrate(ft);f.setFoot([ft])}
  MODAL={el:f.el,f,close};if(mount)mount(f.el);return f.el;
 }
 const el=document.createElement('div');el.className='modal';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label',title);
 el.innerHTML=`<div class="mscrim"></div><div class="mwin ${size}"><div class="mh"><div><div class="mu">${esc(en)}</div><div class="mt" title="${esc(title)}">${esc(title)}</div></div><button class="btn ico" data-x aria-label="关闭" title="关闭（Esc）">${ico('x',14)}</button></div><div class="mb-body">${body}</div>${foot?`<div class="mf">${foot}</div>`:''}</div>`;
 $('#modal-root').appendChild(el);hydrate(el);el.querySelector('[data-x]').onclick=()=>closeModal();el.querySelector('.mscrim').onclick=()=>closeModal();
 MODAL={el,close};requestAnimationFrame(()=>el.classList.add('on'));if(mount)mount(el);setTimeout(()=>{const x=el.querySelector('[data-x]');x&&x.focus()},40);return el;
}
function closeModal(){if(!MODAL)return false;const m=MODAL;MODAL=null;MTICK=null;if(m.f){m.f.close('api');return true}m.el.classList.remove('on');m.el.style.pointerEvents='none';stopMedia(m.el);setTimeout(()=>m.el.remove(),280);try{m.close&&m.close()}catch(e){}return true}
function closeTop(){if(POP)return closePop();if(MODAL)return closeModal();if(S.drawer){closeDrawer();return true}return false}
const kv=(k,v)=>`<div class="kv"><span>${esc(k)}</span><b title="${esc(v)}">${esc(v)}</b></div>`;
/* confirm inside a kit frame → the kit's own dialog; on the deck → the small anchored confirm popover */
function confirmAsk(anchor,text,ok,onOk,danger){const p=pk();if(p&&p.confirm&&anchor&&anchor.closest&&anchor.closest('#pk-root')){p.confirm({title:'请确认',text,ok,danger:!!danger}).then(y=>{if(y)onOk()});return}confirmPop(anchor,text,ok,onOk,danger)}
/* 使用帮助 → the kit's help panel (shortcuts from PK.configure); legacy modal only without the kit */
function openHelp(){if(pk()&&panelKnown('help')){openPanel('help');return}
 openModal({title:'快捷键与操作',en:'Shortcuts',size:'sm',body:`<div class="keys">${KIT_SHORTCUTS.map(([k,d])=>`<div>${d}<span>${k.split(' / ').map(x=>`<kbd>${x}</kbd>`).join('<em>/</em>')}</span></div>`).join('')}</div><p class="mnote">点击舷窗外环的无人机、标签或编队列表可聚焦该 Agent；拖拽文件到窗口可装入货运机库；点击时间轴上的分镜会在分步精修中打开。</p>`})}
function openSceneSheet(){const sc=M.tl.scenes;if(!sc.length){toast('暂无分镜 · 出片后由策划导演生成','warn');return}
 openModal({title:`分镜速览 · ${sc.length} 镜`,en:'Storyboard · 点击进入分步精修',size:'lg',idx:'SB',
  body:`<div class="sheet">${sc.map(s=>`<button data-sc="${esc(s.id)}" title="${esc(s.title+(s.subtitle?' — '+s.subtitle:''))}" aria-label="打开分镜 ${s.n} ${esc(s.title)}">${s.thumbUrl?`<img alt="" loading="lazy" decoding="async" src="${esc(s.thumbUrl)}"><span class="sh-n">${pad2(s.n)}</span>`:`<span class="sh-x">${pad2(s.n)}</span>`}<span class="sh-l">${esc(s.title)}</span></button>`).join('')}</div>`,
  mount:el=>{el.querySelector('.sheet').onclick=e=>{const b=e.target.closest('[data-sc]');if(b){closeModal();openScene(b.dataset.sc)}};el.querySelectorAll('img').forEach(i=>{i.onerror=()=>i.remove()})}})}
function openPlayer(){
 if(!M.project){toast('请先新建或打开一个工程','warn');return}
 const url=videoShown()?M.preview.mp4Url:'';
 // a finished film plays in the shared full-window viewer (kit cinema): nothing of the deck covers it, F = real fullscreen
 const kp=pk();if(url&&kp&&typeof kp.cinema==='function'){const v=MONV.v,t=v.currentTime||0;try{v.pause()}catch(e){}
  kp.cinema({src:url,poster:M.preview.posterUrl||'',title:M.project.title||'成片',sub:`成片 · ${fmtSec(M.preview.durationSec||MONV.dur())}`,startAt:t,onClose:({time})=>monSeekT(time)});return}
 openModal({title:url&&M.project?`成片预览 · ${M.project.title}`:`预览监视器 · ${(MON_LBL[MON.mode]||MON_LBL.idle)[1]}`,en:'Program Monitor · 预览监视器',size:'lg',idx:'PGM',
  body:`<div class="player">${url?`<video controls playsinline src="${esc(url)}"${M.preview.posterUrl?` poster="${esc(M.preview.posterUrl)}"`:''}></video>`:'<canvas></canvas>'}</div>`,
  mount:el=>{if(url){const v=el.querySelector('video'),t=MONV.v.currentTime||0;try{MONV.v.pause()}catch(e){}v.addEventListener('loadedmetadata',()=>{try{v.currentTime=t}catch(e){}const p=v.play();if(p&&p.catch)p.catch(()=>{})},{once:true});return}
   const cv=el.querySelector('canvas'),r=cv.getBoundingClientRect(),q=Math.min(2,devicePixelRatio||1);cv.width=Math.max(2,Math.round(r.width*q));cv.height=Math.max(2,Math.round(r.height*q));const c=cv.getContext('2d');
   MTICK=()=>{c.setTransform(q,0,0,q,0,0);drawMonitorAt(c,r.width,r.height,MON.mode)}}})}
function mediaHTML(kind,url,thumb,name){const f=typeOf(kind).f,ty=typeOf(kind);
 if(f==='video'&&url)return `<video controls playsinline preload="metadata" src="${esc(url)}"${thumb?` poster="${esc(thumb)}"`:''}></video>`;
 if(kind==='image'&&(url||thumb))return `<img alt="${esc(name)}" src="${esc(url||thumb)}">`;
 if(f==='audio'&&url)return `<div class="pa">${ico(ty.ic,40)}</div><audio controls preload="metadata" src="${esc(url)}"></audio>`;
 return `<div class="pa">${ico(ty.ic,40)}</div>`}
function openAssetModal(a){const ty=typeOf(a.kind),scenes=M.tl.scenes.filter(s=>a.used.includes(s.id));
 openModal({title:a.name,en:`Cargo · ${ty.en} · ${ty.n}`,size:'sm',idx:'C-'+pad2(a.i+1),
  body:`<div class="player" style="margin-bottom:12px">${mediaHTML(a.kind,a.url,a.thumbUrl,a.name)}</div>${kv('类型',ty.n)}${a.width&&a.height?kv('分辨率',`${a.width}×${a.height}`):''}${a.durationSec?kv('时长',fmtSec(a.durationSec)):''}${kv('使用情况',scenes.length?`已用于 ${scenes.length} 个分镜`:'尚未使用')}${scenes.length?`<div class="chips">${scenes.slice(0,12).map(s=>`<button class="chip" data-sc="${esc(s.id)}" title="${esc(s.title)}">#${pad2(s.n)} ${esc(s.title)}</button>`).join('')}</div>`:''}`,
  foot:`<button class="btn danger" data-rm>${ico('trash',13)}移除素材</button><span class="sp"></span><button class="btn" data-studio>${ico('steps',13)}分步精修</button>`,
  mount:el=>{el.querySelector('[data-rm]').onclick=e=>confirmAsk(e.currentTarget,`移除素材「${a.name}」？将从工程素材库中删除。`,'移除',()=>{closeModal();act('removeAsset',{assetId:a.id})},true);
   el.querySelector('[data-studio]').onclick=()=>{closeModal();openPanel('studio',{step:'assets'})};
   const ch=el.querySelector('.chips');if(ch)ch.onclick=e=>{const b=e.target.closest('[data-sc]');if(b){closeModal();openScene(b.dataset.sc)}}}})}
function openStagingModal(x){const kind=x.kind==='audio'?'music':x.kind;
 openModal({title:x.name,en:'Cloud Staging · 云端生成 · 待确认',size:'sm',idx:'CS',
  body:`<div class="player" style="margin-bottom:12px">${mediaHTML(kind,x.url,x.thumbUrl,x.name)}</div>${kv('供应商',x.provider||'—')}${x.prompt?`<p class="mnote" title="${esc(x.prompt)}">提示词：${esc(x.prompt)}</p>`:''}`,
  foot:`<button class="btn danger" data-del>${ico('x',13)}丢弃</button><span class="sp"></span><button class="btn pri" data-ok>${ico('check',13)}确认入库</button>`,
  mount:el=>{el.querySelector('[data-ok]').onclick=e=>{act('confirmStaging',{stagingId:x.id},{btn:e.currentTarget}).then(r=>{if(r.ok)closeModal()})};
   el.querySelector('[data-del]').onclick=e=>confirmAsk(e.currentTarget,`丢弃云端结果「${x.name}」？`,'丢弃',()=>{closeModal();act('discardStaging',{stagingId:x.id})},true)}})}
/* ======================= tick slider (timeline zoom) ======================= */
function makeTick(el,n,idx,onChange){
 el.innerHTML=`<div class="tt"></div><div class="tf"></div>${Array.from({length:n},(_,i)=>`<i class="tk" style="left:${i/(n-1)*100}%"></i>`).join('')}<div class="kn"></div>`;
 const set=(i,fire)=>{i=clamp(Math.round(i),0,n-1);el._i=i;const p=i/(n-1)*100;el.querySelector('.tf').style.width=p+'%';el.querySelector('.kn').style.left=p+'%';el.querySelectorAll('.tk').forEach((t,k)=>t.classList.toggle('on',k<=i));setAttr(el,'aria-valuenow',i);if(fire)onChange(i)};
 const at=e=>{const r=el.getBoundingClientRect();return (e.clientX-r.left)/Math.max(1,r.width)*(n-1)};
 el.setAttribute('tabindex','0');el.setAttribute('aria-valuemin','0');el.setAttribute('aria-valuemax',String(n-1));
 el.addEventListener('pointerdown',e=>{el.setPointerCapture(e.pointerId);set(at(e),true);const mv=ev=>{const i=Math.round(clamp(at(ev),0,n-1));if(i!==el._i)set(i,true)};const up=()=>{el.removeEventListener('pointermove',mv);el.removeEventListener('pointerup',up)};el.addEventListener('pointermove',mv);el.addEventListener('pointerup',up)});
 el.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowUp'){e.preventDefault();set(el._i+1,true)}else if(e.key==='ArrowLeft'||e.key==='ArrowDown'){e.preventDefault();set(el._i-1,true)}});
 el._set=set;set(idx,false);return el;
}
/* ======================= flight-control drawer (director → setDirector) ======================= */
const FPS_OPTS=[24,25,30,50,60].map(v=>({value:String(v),label:v+' fps'}));
const PSCHEMA=[
 {g:'主题',en:'Brief',items:[{k:'topic',l:'视频主题',t:'text'}]},
 {g:'引擎',en:'Engine',items:[{k:'engine',l:'渲染引擎',t:'seg',o:'engines'},{k:'creationMode',l:'创作模式',t:'seg',o:'creationModes'}]},
 {g:'画面',en:'Frame',items:[{k:'aspectRatio',l:'画幅',t:'seg',o:'aspectRatios',asp:1},{k:'quality',l:'画质',t:'seg',o:'qualities'},{k:'fps',l:'帧率',t:'seg',o:FPS_OPTS}]},
 {g:'节奏',en:'Tempo',items:[{k:'durationMode',l:'时长',t:'dur'},{k:'pacingMode',l:'节奏',t:'seg',o:'pacingModes'}]},
 {g:'声音',en:'Audio',items:[{k:'narrationMode',l:'旁白模式',t:'seg',o:'narrationModes'},{k:'bgmMode',l:'配乐',t:'seg',o:'bgmModes'},{k:'voiceId',l:'主讲音色',t:'voice'}]},
 {g:'数字人',en:'Avatar',items:[{k:'avatarEnabled',l:'数字人',t:'tog',x:'启用数字人主播'},{k:'avatarLayout',l:'画中位置',t:'seg',o:'avatarLayouts',dis:d=>!d.avatarEnabled}]},
 {g:'风格',en:'Style',items:[{k:'style',l:'视觉风格',t:'style'}]},
 {g:'性能',en:'Performance',items:[{k:'lowSpec',l:'低配保护',t:'lowspec',x:'限制 30 fps · 精简特效'}]},
];
const DRAWER={key:'',pending:{},local:{}};
const DR_TOPIC_PH='写下视频主题 / 导演指令…点这里放大编辑';
function optsOf(it){let o=typeof it.o==='string'?M.options[it.o]:it.o;o=Array.isArray(o)?o:[];const v=String(M.director[it.k]);if(!o.length||(!o.some(x=>x.value===v)&&v&&it.k!=='fps'))o=o.concat(v?[{value:v,label:v}]:[]);return o}
const aspIcon=v=>{const m=/^(\d+):(\d+)$/.exec(v);if(!m)return '';const a=+m[1],b=+m[2],s=12/Math.max(a,b);return `<i class="asp" style="width:${Math.max(4,Math.round(a*s))}px;height:${Math.max(4,Math.round(b*s))}px"></i>`};
function voiceLabel(){const v=M.director.voiceId,o=M.options.voices.find(x=>x.value===v);return o?o.label:(v==='auto'?'AI 自动匹配':v)}
function rowHTML(it){const d=M.director,v=d[it.k],dis=it.dis&&it.dis(d);let ctl='';
 if(it.t==='seg')ctl=`<div class="seg" data-k="${it.k}" role="radiogroup" aria-label="${it.l}">${optsOf(it).map(o=>{const on=String(v)===o.value;return `<button data-v="${esc(o.value)}" role="radio" aria-checked="${on}" class="${on?'on':''}" title="${esc(o.label)}">${it.asp?aspIcon(o.value):''}${esc(o.label)}</button>`}).join('')}</div>`;
 else if(it.t==='text'){const t=topicNow();ctl=`<button class="brief-prev dr-brief${t?'':' empty'}" id="dr-topic" data-topic aria-label="视频主题 / 导演指令（点击放大编辑）" title="${esc(t||'点击写下视频主题 / 导演指令')}"><span class="bf-txt" id="dr-topic-txt">${esc(t||DR_TOPIC_PH)}</span></button><div class="dr-bf-f"><span class="bf-n" id="dr-topic-n">${t?charCount(t)+' 字':''}</span><span class="sp"></span><button class="btn sm" data-topic aria-label="展开编辑视频主题">${ico('expand',12)}展开编辑</button></div>`}
 else if(it.t==='dur')ctl=`<div class="seg" data-k="durationMode" role="radiogroup" aria-label="时长模式">${[['auto','AI 智能'],['custom','自定义']].map(([val,lab])=>`<button data-v="${val}" role="radio" aria-checked="${d.durationMode===val}" class="${d.durationMode===val?'on':''}">${lab}</button>`).join('')}</div><input type="number" class="inp numin" id="dr-dur" min="15" max="600" step="5" value="${Math.round(d.targetDurationSec)}"${d.durationMode==='custom'?'':' disabled'} aria-label="目标时长（秒）"><span class="unit">秒</span>`;
 else if(it.t==='voice')ctl=`<button class="sel" data-k="voiceId" aria-haspopup="listbox" aria-label="主讲音色：${esc(voiceLabel())}" title="${esc(voiceLabel())}"><span class="sv" id="dr-voice">${esc(voiceLabel())}</span><span class="sx">${M.counts.voices||M.options.voices.length} 个</span></button><button class="btn sm" data-panel="voices">${ico('voice',12)}配音中心</button>`;
 else if(it.t==='tog')ctl=`<button class="tog${v?' on':''}" data-k="${it.k}" role="switch" aria-checked="${!!v}" aria-label="${it.l}"><i></i></button><span class="dr-hint">${it.x||''}</span><button class="btn sm ghost" data-panel="avatar">${ico('user',12)}数字人设置</button>`;
 else if(it.t==='lowspec')ctl=`<button class="tog${M.lowSpec?' on':''}" data-k="lowSpec" role="switch" aria-checked="${M.lowSpec}" aria-label="${it.l}"><i></i></button><span class="dr-hint">${it.x||''}</span>`;
 else if(it.t==='style'){/* AI 自由匹配 first, the 6 presets, then 我的风格预设 under a heading; long names end with … (tooltip: name + hint) */
  const all=optsOf({k:'style',o:'styles'}),mine=all.filter(o=>o.kind==='user'||String(o.value).startsWith('user:')),bas=all.filter(o=>!mine.includes(o));
  const card=(o,i)=>{const on=String(v)===o.value,tip=o.hint?`${o.label} · ${o.hint}`:o.label;return `<button class="stc-card${on?' on':''}${o.value==='auto'?' ai':''}" data-k="style" data-v="${esc(o.value)}" style="--g:${o.g||styleG(o.preset||o.value,i)}" aria-pressed="${on}" title="${esc(tip)}"><span>${esc(o.label)}</span></button>`};
  ctl=`<div class="stylegrid" role="group" aria-label="视觉风格">${bas.map(card).join('')}${mine.length?`<div class="stc-h">我的风格预设 · ${mine.length}</div>${mine.map((o,i)=>card(o,i+bas.length)).join('')}`:''}</div>`}
 return `<div class="prow${dis?' dis':''}${it.t==='text'?' wide':''}" data-row="${it.k}"><label>${it.l}</label><div class="ctl">${ctl}</div></div>`}
function drawerKey(){const O=M.options;return ['engines','creationModes','aspectRatios','qualities','narrationModes','bgmModes','pacingModes','styles','avatarLayouts'].map(k=>(O[k]||[]).map(o=>o.value+o.label).join(',')).join('|')+'|'+M.options.voices.length}
function renderDrawer(){const b=$('#dr-b'),st=b.scrollTop;DRAWER.key=drawerKey();
 b.innerHTML=PSCHEMA.map((g,gi)=>`<div class="grp"><div class="grp-h"><b>${pad2(gi+1)}</b><span>${g.g}</span><em>${g.en.toUpperCase()}</em></div>${g.items.map(rowHTML).join('')}</div>`).join('');hydrate(b);b.scrollTop=st;
 const du=$('#dr-dur');const sendDur=()=>{const n=Math.round(Number(du.value));if(!(n>=15&&n<=600)){toast('目标时长需在 15–600 秒之间','warn');du.value=Math.round(M.director.targetDurationSec);return}if(n!==Math.round(M.director.targetDurationSec))setParam('targetDurationSec',n)};
 du.addEventListener('change',sendDur);du.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();du.blur()}});
}
function syncDrawer(){
 if(!S.drawer)return;if(drawerKey()!==DRAWER.key){renderDrawer();return}
 const d=M.director,b=$('#dr-b');
 $$('.seg[data-k]',b).forEach(sg=>{const v=String(d[sg.dataset.k]);$$('button',sg).forEach(x=>{const on=x.dataset.v===v;if(x.classList.contains('on')!==on){x.classList.toggle('on',on);x.setAttribute('aria-checked',String(on))}})});
 $$('.tog[data-k]',b).forEach(t=>{const on=t.dataset.k==='lowSpec'?M.lowSpec:!!d[t.dataset.k];if(t.classList.contains('on')!==on){t.classList.toggle('on',on);t.setAttribute('aria-checked',String(on))}});
 $$('.stc-card',b).forEach(c=>{const on=c.dataset.v===String(d.style);if(c.classList.contains('on')!==on){c.classList.toggle('on',on);c.setAttribute('aria-pressed',String(on))}});
 $$('.prow[data-row]',b).forEach(r=>{const it=PSCHEMA.flatMap(g=>g.items).find(x=>x.k===r.dataset.row);if(it&&it.dis)setCls(r,'dis',it.dis(d))});
 setTxt($('#dr-voice'),voiceLabel());
 const tp=$('#dr-topic');if(tp){const t=topicNow();setCls(tp,'empty',!t);setTxt($('#dr-topic-txt'),t||DR_TOPIC_PH);setTxt($('#dr-topic-n'),t?charCount(t)+' 字':'');setTitle(tp,t||'点击写下视频主题 / 导演指令')}
 const du=$('#dr-dur');if(du){du.disabled=d.durationMode!=='custom';if(document.activeElement!==du&&String(Math.round(d.targetDurationSec))!==du.value)du.value=Math.round(d.targetDurationSec)}
}
function setParam(k,v){const d=M.director;let val=v;if(k==='fps'||k==='targetDurationSec')val=Number(v);if(k==='avatarEnabled')val=!!v;if(String(d[k])===String(val))return;const prev=d[k];d[k]=val;DRAWER.pending[k]=performance.now();DRAWER.local[k]=val;
 const patch={[k]:val};if(k==='targetDurationSec'){patch.durationMode='custom';d.durationMode='custom';DRAWER.pending.durationMode=performance.now();DRAWER.local.durationMode='custom'}
 syncDrawer();renderStrip();
 act('setDirector',{patch}).then(r=>{if(!r.ok){d[k]=prev;delete DRAWER.pending[k];syncDrawer();renderStrip()}});
}
/* stale-echo protection: a throttled state may predate the user's change */
function applyPending(N){const now=performance.now();for(const k in DRAWER.pending){if(now-DRAWER.pending[k]>(k==='topic'?2500:1600)||String(N.director[k])===String(DRAWER.local[k])){delete DRAWER.pending[k];delete DRAWER.local[k];continue}N.director[k]=DRAWER.local[k]}}
function openDrawer(){if(S.drawer)return;closePop();S.drawer=true;renderDrawer();const d=$('#drawer');d.classList.add('on');$('#scrim').classList.add('on');d.setAttribute('aria-hidden','false');setTimeout(()=>{const c=$('#dr-close');c&&c.focus()},60)}
function closeDrawer(){if(!S.drawer)return;S.drawer=false;$('#drawer').classList.remove('on');$('#scrim').classList.remove('on');$('#drawer').setAttribute('aria-hidden','true')}
const toggleDrawer=()=>S.drawer?closeDrawer():openDrawer();
function openVoicePicker(anchor){const list=M.options.voices.length?M.options.voices:[{value:'auto',label:'AI 自动匹配'}];
 const el=openPop(anchor,`<div class="vp-search"><i>${ico('search',13)}</i><input type="text" placeholder="搜索 ${list.length} 个音色…" aria-label="搜索音色"></div><div class="vp-list" role="listbox" aria-label="音色列表"></div><div class="vp-foot"><span>共 ${list.length} 个音色</span><button class="btn sm" data-vc>${ico('voice',12)}配音中心</button></div>`,null,'vp-pop');if(!el)return;
 const box=el.querySelector('.vp-list'),inp=el.querySelector('input');
 const draw=()=>{const q=inp.value.trim().toLowerCase(),f=q?list.filter(o=>o.label.toLowerCase().includes(q)||o.value.toLowerCase().includes(q)):list,cur=M.director.voiceId;
  box.innerHTML=f.slice(0,300).map(o=>`<button class="pi${o.value===cur?' on':''}" data-v="${esc(o.value)}" role="option" aria-selected="${o.value===cur}" title="${esc(o.label)}"><i>${ico(o.value===cur?'check':'voice',13)}</i><span>${esc(o.label)}</span></button>`).join('')+(f.length>300?`<div class="pe">还有 ${f.length-300} 个结果 · 请输入更精确的关键词</div>`:'')+(f.length?'':'<div class="pe">没有匹配的音色</div>')};
 draw();inp.addEventListener('input',draw);
 box.addEventListener('click',e=>{const b=e.target.closest('.pi');if(!b)return;closePop();setParam('voiceId',b.dataset.v)});
 el.querySelector('[data-vc]').onclick=()=>{closePop();openPanel('voices')};
 setTimeout(()=>inp.focus(),30);
}
function wireOverlays(){
 $('#dr-b').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-topic')){openTopicEditor();return}
  const seg=b.closest('.seg');if(seg&&seg.dataset.k&&b.dataset.v!=null){setParam(seg.dataset.k,b.dataset.v);return}
  if(b.classList.contains('tog')){if(b.dataset.k==='lowSpec'){act('setLowSpec',{on:!M.lowSpec});return}setParam(b.dataset.k,!M.director[b.dataset.k]);return}
  if(b.classList.contains('stc-card')){setParam('style',b.dataset.v);return}
  if(b.dataset.k==='voiceId'){openVoicePicker(b);return}
  if(b.dataset.panel)openPanel(b.dataset.panel)});
 $('#dr-close').onclick=closeDrawer;$('#scrim').onclick=closeDrawer;$('#dr-apply').onclick=closeDrawer;
 $('#dr-studio').onclick=()=>{closeDrawer();openPanel('studio',{step:'director'})};
}
