/* =====================================================================
   NATIVE PANEL KIT GLUE — lib/warroom/kit (KIT.md · "Skin integration contract").
   Every panel / dialog / settings entry is a native kit panel (PK.open) themed in
   the NOVA DECK language by css/97-kit-theme.css. The skin keeps its own 飞控面板
   (drawer), deck popover menus and the bridge livery (舰桥涂装) switcher.
   ===================================================================== */
function pk(){const p=window.PK;return p&&p.__v&&typeof p.open==='function'?p:null}
function kitOpen(){const p=pk();return !!(p&&p.isOpenAny&&p.isOpenAny())}
function panelKnown(id){const p=pk();return !!(p&&p.panels&&p.panels.has&&p.panels.has(id))}
function openPanel(id,args){
 closePop();
 const p=pk();if(!p){toast('原生面板内核未加载 · 请刷新页面后重试','err');return null}
 try{return p.open(id,args||{})}catch(e){console.error('[NOVA DECK] open panel '+id,e);toast('面板打开失败：'+((e&&e.message)||e),'err');return null}
}
/* timeline / storyboard scene → 分步精修 opened at that scene */
function openScene(id){if(!id)return;return openPanel('studio',{step:'scenes',sceneId:String(id)})}
function closeAllPanels(){const p=pk();if(!p)return;try{if(p.closePop)p.closePop();if(p.closeAll)p.closeAll()}catch(e){console.error('[NOVA DECK] close panels',e)}}

/* the big 创意需求 editor (templates · AI 润色 · 保存并一键出片) for every brief / topic field of the skin */
async function openTopicEditor(){
 closePop();
 if(!M.project){toast('请先新建或打开一个视频工程，再写创意需求','warn');openPanel('projects');return null}
 const p=pk();if(!p||!p.editTopic){toast('原生面板内核未加载 · 请刷新页面后重试','err');return null}
 try{return await p.editTopic({value:topicNow(),onSaved:v=>applyLocalTopic(v)})}catch(e){console.error('[NOVA DECK] topic editor',e);return null}
}
/* optimistic echo of a saved topic (the stale-echo guard keeps it until the host state catches up) */
function applyLocalTopic(v){v=cleanTopic(v);if(v===topicNow())return;M.director.topic=v;DRAWER.pending.topic=performance.now();DRAWER.local.topic=v;syncBrief();if(S.drawer)syncDrawer();renderCorners()}

/* ---------- kit configuration ---------- */
const KIT_SHORTCUTS=[['R','一键出片 / 继续执行'],['空格','播放 / 暂停成片预览'],['1 / 2 / 3','镜头：全景 / 跟随 / 近景'],['P','打开 / 关闭飞控面板'],['F / V','全屏观看成片（未出片时放大预览监视器）'],['[ / ]','时间轴缩小 / 放大'],['0','时间轴适配全片'],['T','舰桥涂装（主题配色）'],['?','使用帮助 · 快捷键'],['Esc','关闭弹窗 · 取消聚焦 · 回到全景'],['Ctrl + Enter','在大号编辑器里保存']];
/* kit icon names → the deck's own line icons (same stroke language everywhere); others keep the kit set */
const KIT_ICONS={x:'x',check:'check',plus:'plus',minus:'minus',upload:'upload',play:'play',pause:'pause',stop:'stop',retry:'retry',trash:'trash',expand:'expand',search:'search',film:'film',image:'image',music:'music',cloud:'cloud',cpu:'cpu',key:'key',box:'box',user:'user',wand:'wand',lock:'lock',history:'history',layers:'layers',grid:'grid',list:'list',eye:'eye',folder:'folder',warn:'warn',help:'help',prompt:'prompt',bolt:'bolt',settings:'gear',mic:'voice',split:'split',brand:'brand',sparkle:'sparkle'};
const ICON_TPL=document.createElement('template');
function kitIcon(name,size){const k=KIT_ICONS[name];if(!k||!IC[k])return null;ICON_TPL.innerHTML=ico(k,size);const svg=ICON_TPL.content.firstElementChild;if(!svg)return null;svg.setAttribute('class','pk-ico pk-ico--'+name);return svg}

/* 作战大屏 / 分步精修 / 任务中心 / 影核广场 — the tab of the top-most open "mode" panel is lit */
const MODE_PANELS={studio:1,tasks:1,plaza:1};
function syncModes(){const p=pk();const st=(p&&p.frames&&p.frames.stack)||[];let cur='deck';for(let i=st.length-1;i>=0;i--){if(MODE_PANELS[st[i].id]){cur=st[i].id;break}}
 $$('#modes button').forEach(b=>{const on=b.dataset.mode===cur;setCls(b,'on',on);setAttr(b,'aria-current',on?'page':null)})}

/* frame header EN line: "LATIN OVERLINE · 中文说明" → HUD overline + readable 12 px sub (never tiny CJK);
   CJK text in other EN slots (section / field / menu captions) gets the readable variant too */
const CJK_RE=/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/;
function splitFrameEn(el){
 if(el.querySelector('.nd-en-a,.nd-en-b'))return;
 const raw=(el.textContent||'').trim();if(!raw)return;
 const seg=raw.split(/\s*[·•]\s*/);let a='',b=raw;
 if(seg.length&&/^[\x20-\x7e]+$/.test(seg[0])){a=seg[0];b=seg.slice(1).join(' · ')}
 el.textContent='';
 if(a){const s=document.createElement('span');s.className='nd-en-a';s.textContent=a;el.appendChild(s)}
 if(b){const s=document.createElement('span');s.className='nd-en-b';s.textContent=b;el.appendChild(s)}
 el.title=raw;
}
function kitDecorate(root){
 root.querySelectorAll('.pk-frame-en').forEach(splitFrameEn);
 root.querySelectorAll('.pk-en,.pk-menu-g,.pk-step-b small,.pk-sec-n').forEach(el=>{const on=CJK_RE.test(el.textContent||'');if(el.classList.contains('is-cjk')!==on)el.classList.toggle('is-cjk',on)});
}
let KIT_DECO_RAF=0;
function kitDecorateSoon(root){if(KIT_DECO_RAF)return;KIT_DECO_RAF=requestAnimationFrame(()=>{KIT_DECO_RAF=0;try{kitDecorate(root)}catch(e){}})}

function kitConfigure(){
 const p=pk();if(!p){console.warn('[NOVA DECK] panel kit (kit.js) not loaded — native panels unavailable');return}
 p.configure({skin:SKIN_ID,
  // frame kinds per panel, after the prototype: tools (incl. 任务中心 · TASK CENTER) are centred .mwin modals,
  // 工程 is a side drawer like the 飞控面板, 分步精修 is the full bridge workspace under the live top bar
  frames:{studio:'workspace',projects:'drawer',tasks:'modal'},
  sizes:{help:'md',tasks:'lg'},
  icon:kitIcon,shortcuts:KIT_SHORTCUTS});
 p.on('panel-open',()=>syncModes());p.on('panel-close',()=>syncModes());
 const root=p.root&&p.root();
 if(root&&window.MutationObserver){new MutationObserver(()=>kitDecorateSoon(root)).observe(root,{childList:true,subtree:true,characterData:true})}
 registerLivery();
}

/* ======================= 舰桥涂装 · bridge livery (prototype: 主题切换, key T) ======================= */
const THEMES={ion:{n:'离子青',en:'ION CYAN',acc:'#3BE7FF',amb:'#FFB547',mag:'#FF4FD8'},beacon:{n:'琥珀信标',en:'AMBER BEACON',acc:'#FFB547',amb:'#3BE7FF',mag:'#FF4FD8'},pulsar:{n:'品红脉冲',en:'MAGENTA PULSAR',acc:'#FF4FD8',amb:'#FFB547',mag:'#3BE7FF'}};
let THEME='ion';
function applyTheme(id,persist){
 if(!THEMES[id])id='ion';const t=THEMES[id],r=document.documentElement.style;
 r.setProperty('--acc',t.acc);r.setProperty('--acc-rgb',hexRgb(t.acc));r.setProperty('--amb',t.amb);r.setProperty('--amb-rgb',hexRgb(t.amb));r.setProperty('--mag',t.mag);r.setProperty('--mag-rgb',hexRgb(t.mag));
 THEME=id;document.documentElement.setAttribute('data-livery',id);if(persist)LS.set('theme',id);
 // canvases cache the palette: re-read it and drop the tinted sprites / backgrounds
 readPal();PSPR=null;BGC.key='';MON.last=-1;TL.dirty=true;DIRTY.ui=true;
}
function drawLivery(cv,t){
 const c=cv.getContext('2d');if(!c)return;const w=cv.width,h=cv.height,rgb=hexRgb(t.acc),cx=w/2,cy=h*.47,R=h*.32;
 c.fillStyle='#05070F';c.fillRect(0,0,w,h);
 const g=c.createRadialGradient(cx,cy,0,cx,cy,R*1.7);g.addColorStop(0,`rgba(${rgb},.22)`);g.addColorStop(1,`rgba(${rgb},0)`);c.fillStyle=g;c.fillRect(0,0,w,h);
 [[1,1.2,.85],[.93,4,.5],[.86,1,.6]].forEach(([k,lw,a])=>{c.strokeStyle=`rgba(${rgb},${a})`;c.lineWidth=lw;c.beginPath();c.arc(cx,cy,R*k,0,TAU);c.stroke()});
 c.setLineDash([2,6]);c.strokeStyle=`rgba(${rgb},.35)`;c.lineWidth=1;c.beginPath();c.arc(cx,cy,R*1.12,0,TAU);c.stroke();c.setLineDash([]);
 const mw=R*1.25,mh=mw*9/16;c.fillStyle='#010208';c.fillRect(cx-mw/2,cy-mh/2,mw,mh);c.strokeStyle=`rgba(${rgb},.85)`;c.lineWidth=1.2;c.strokeRect(cx-mw/2,cy-mh/2,mw,mh);
 for(let k=0;k<8;k++){const a=k*TAU/8+TAU/16;const x=cx+Math.cos(a)*R,y=cy+Math.sin(a)*R;c.fillStyle=k===1?t.amb:t.acc;c.beginPath();c.arc(x,y,3.4,0,TAU);c.fill();glow(c,x,y,10,k===1?hexRgb(t.amb):rgb,.5)}
}
function registerLivery(){
 const p=pk();if(!p||!p.panel||panelKnown('livery'))return;const h=p.h,ui=p.ui;
 p.panel('livery',{title:'舰桥涂装 · 主题切换',en:'BRIDGE LIVERY · 只改变大屏与面板配色，不影响成片',idx:'TH',icon:'brush',kind:'modal',size:'lg',group:'hidden',
  render(ctx){
   ctx.foot([ui.hint('快捷键 T · 选择会保存在本机'),ui.spacer(),ui.btn('完成',()=>ctx.close(),{kind:'primary',icon:'check'})]);
   return [ui.grid(Object.entries(THEMES).map(([id,t])=>{
    const cv=h('canvas.nd-th-cv',{width:560,height:350,'aria-hidden':'true'});drawLivery(cv,t);
    const el=ui.card({key:'th-'+id,class:'nd-th',media:cv,aspect:'16/10',title:t.n,sub:t.en,active:THEME===id,onClick:()=>{if(THEME===id)return;applyTheme(id,true);ctx.render();toast(`舰桥涂装已切换为「${t.n}」`,'ok')}});
    el.style.setProperty('--th',t.acc);el.style.setProperty('--th-rgb',hexRgb(t.acc));el.setAttribute('aria-pressed',String(THEME===id));
    return el}),{min:300})];
  }});
}
function openLivery(){if(pk()&&panelKnown('livery')){openPanel('livery');return}const ids=Object.keys(THEMES),nx=ids[(ids.indexOf(THEME)+1)%ids.length];applyTheme(nx,true);toast(`舰桥涂装：${THEMES[nx].n}`,'ok')}

kitConfigure();
