/* ======================= minimap & sparkline ======================= */
function drawMini(){const c=X.mini,W=400,H=226;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,W,H);c.fillStyle='rgba(4,7,20,.95)';c.fillRect(0,0,W,H);
 const sw=G.st.w,sh=G.st.h;if(sw<4||sh<4)return;const k=Math.min(W/sw,H/sh);c.save();c.translate((W-sw*k)/2,(H-sh*k)/2);c.scale(k,k);
 c.lineWidth=2/k;c.strokeStyle=`rgba(${PAL.accRgb},.35)`;c.beginPath();c.arc(G.C.x,G.C.y,Math.max(1,G.R),0,TAU);c.stroke();c.strokeRect(G.mon.x,G.mon.y,G.mon.w,G.mon.h);
 for(const a of AG){const d=G.docks[a.id];if(!d)continue;const s=agentOf(a.id).status;c.globalAlpha=s==='skipped'?.35:1;c.fillStyle=s==='failed'?PAL.red:a.col;c.beginPath();c.arc(d.x,d.y,s==='running'?12:8,0,TAU);c.fill()}c.globalAlpha=1;
 const v0=s2w(G.st.x,G.st.y+G.strip),v1=s2w(G.st.x+G.st.w,G.st.y+G.st.h);c.strokeStyle=PAL.acc;c.lineWidth=4/k;c.strokeRect(v0.x,v0.y,v1.x-v0.x,v1.y-v0.y);c.restore()}
function drawSpark(){const c=X.spark,W=240,H=40;c.clearRect(0,0,W,H);const N=30,b=new Array(N).fill(0);for(const p of PULSES){const age=S.simT-p.t0;if(age<0||age>=60)continue;b[N-1-Math.floor(age/2)]++}
 c.strokeStyle=`rgba(${PAL.accRgb},.9)`;c.lineWidth=2;c.beginPath();for(let i=0;i<N;i++){const x=i/(N-1)*W,y=H-4-Math.min(1,b[i]/2)*(H-10)-(isLive()||S.lite?0:Math.sin(S.simT*2+i)*1.5);i?c.lineTo(x,y):c.moveTo(x,y)}c.stroke();c.lineTo(W,H);c.lineTo(0,H);c.closePath();c.fillStyle=`rgba(${PAL.accRgb},.12)`;c.fill()}

/* ======================= per-tick DOM sync ======================= */
let UI_HP=null;
function updateUI(){
 const hp=!!M.project;if(hp!==UI_HP){UI_HP=hp;setCls($('#stage'),'noproj',!hp);measure()}
 renderTop();renderStrip();renderCorners();renderMonitorChrome();renderDockLabels();
 if(DIRTY.caps){DIRTY.caps=false;renderFilter();if(renderCaps())DIRTY.layout=true}
 syncCaps();
 if(DIRTY.stg){DIRTY.stg=false;if(renderStaging())DIRTY.layout=true}
 syncStaging();
 renderMission();renderRunwayHead();
 if(DIRTY.log){DIRTY.log=false;renderLog()}
 syncBrief();
 if(DIRTY.drawer){DIRTY.drawer=false;syncDrawer()}
 renderOnboard();
 if(DIRTY.layout){DIRTY.layout=false;layoutPanels();logPin()}
 cullCamLayer();cullLists();
 setCls($('#hud'),'nomini',G.st.w<620||G.st.h<400);
 if(CAM.focus&&!M.project)unfocus(false);
}

/* ======================= main loop (single rAF, delta time) ======================= */
let lastNow=0,lastFrame=0,rafId=0,fpsN=0,fpsAcc=0,accUi=1,accTl=1,accMon=1,accMini=1,accSpark=1;
function perfUpdate(ms,dt){PERF.t+=dt;if(PERF.t<3||document.hidden)return;PERF.ema+=(ms-PERF.ema)*.06;
 if(PERF.ema>(PERF.mode===0?27:44))PERF.bad+=dt;else PERF.bad=Math.max(0,PERF.bad-dt*.5);
 if(PERF.bad>.8&&PERF.mode<2){PERF.mode++;PERF.bad=0;PERF.ema=17;applyGlobalFlags();console.info('[NOVA DECK] 自适应降帧：'+(PERF.mode===1?'30':'20')+' fps')}}
function frame(now){
 rafId=0;if(document.hidden)return;
 rafId=requestAnimationFrame(frame);
 const minMs=PERF.mode>=2?50:(S.lite||PERF.mode===1)?33:0;
 if(minMs&&now-lastFrame<minMs-2)return;
 const raw=Math.max(0,(now-lastNow)/1000);lastNow=now;lastFrame=now;
 const dtr=Math.min(.25,raw);perfUpdate(Math.min(250,raw*1000),dtr);
 S.realT+=dtr;FRAME++;
 fpsN++;fpsAcc+=dtr;if(fpsAcc>=.5){S.fps=Math.round(fpsN/fpsAcc);window.__fps=S.fps;fpsN=0;fpsAcc=0}
 const paused=!!M.run&&M.run.status==='paused';
 S.simT+=dtr;if(!paused)S.showT+=dtr;
 try{
  stepShows();playbackStep();stepParts(dtr);
  TLS.beatFlash=Math.max(0,TLS.beatFlash-dtr*3.2);
  if(TL.goal!=null){TL.view0+=(TL.goal-TL.view0)*Math.min(1,dtr*8);if(Math.abs(TL.goal-TL.view0)<.01){TL.view0=TL.goal;TL.goal=null}TL.dirty=true}
  CAM.shake=Math.max(0,CAM.shake-dtr*7);
  camUpdate(dtr);
  drawBackground();drawWorld();drawFx();
  accTl+=dtr;if(accTl>=(S.lite?1/12:1/30)||TL.dirty){accTl=0;TL.dirty=false;drawTimeline()}
  accMon+=dtr;const calm=MON.mode==='idle'||MON.mode==='none'||MON.mode==='fail'||MON.mode==='stop'||MON.mode==='done';
  if(accMon>=1/(calm?8:S.lite?12:24)||MON.last<0){accMon=0;MON.last=1;drawMonitor()}
  accUi+=dtr;if(accUi>=(S.lite?1/8:1/20)){accUi=0;updateUI()}
  if(CAM.focus)updateAgentCard();
  accMini+=dtr;if(accMini>=1/12){accMini=0;if($('#hud').classList.contains('on'))drawMini()}
  accSpark+=dtr;if(accSpark>=.25){accSpark=0;drawSpark()}
  if(MTICK)MTICK(S.realT);
 }catch(err){if(!frame._err){frame._err=1;console.error('[NOVA DECK] frame error (logged once)',err)}}
}
function startLoop(){if(rafId||document.hidden)return;lastNow=lastFrame=performance.now();rafId=requestAnimationFrame(frame)}
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(rafId){cancelAnimationFrame(rafId);rafId=0}}else startLoop()});

/* ======================= keyboard (only while the iframe has focus) ======================= */
// a skin popover opened above a kit panel (e.g. the project menu over the 分步精修 workspace) closes first on Esc
addEventListener('keydown',e=>{if(e.key==='Escape'&&POP){closePop();e.preventDefault();e.stopPropagation()}},true);
addEventListener('keydown',e=>{
 // while a native kit panel / dialog / picker is open it owns the keyboard (KIT.md skin contract)
 if(kitOpen())return;
 const t=e.target,inField=!!(t&&t.closest&&t.closest('input,textarea,select,[contenteditable="true"]'));
 if(e.key==='Escape'){if(closeTop()){e.preventDefault();return}if(inField){t.blur();return}if(CAM.focus){unfocus();return}if(CAM.mode!=='overview'){setCam('overview');CAM.autoSwitched=false}return}
 if(inField||e.ctrlKey||e.metaKey||e.altKey)return;
 if(MODAL&&e.key!=='?')return;
 const k=e.key;
 if(k===' '){if(t&&t.closest&&t.closest('button,[role="button"],[role="slider"],[role="switch"]'))return;e.preventDefault();monTogglePlay();return}
 switch(k){case '1':setCam('overview');break;case '2':setCam('follow');break;case '3':setCam('close');break;
  case 'r':case 'R':e.preventDefault();runAction();break;case 'p':case 'P':toggleDrawer();break;case 'f':case 'F':case 'v':case 'V':openPlayer();break;
  case 't':case 'T':openLivery();break;
  case '?':openHelp();break;case '[':tlZoomStep(-1);break;case ']':tlZoomStep(1);break;case '0':tlZoomSet(0);break}
});

/* ======================= drag & drop import ======================= */
let dragN=0;
const hasFiles=e=>!!(e.dataTransfer&&[...(e.dataTransfer.types||[])].includes('Files'));
function dragOn(v){const dc=$('#dragcover');dc.classList.toggle('on',v);$('#dropzone').classList.toggle('hot',v&&!!M.project);setTxt($('div',dc),M.project?'释放以装入货运机库':'请先新建或打开一个工程')}
// while a kit panel is open, files go to its own drop zones only (never silently into the asset library)
addEventListener('dragenter',e=>{if(!hasFiles(e))return;e.preventDefault();if(kitOpen())return;dragN++;dragOn(true)});
addEventListener('dragleave',()=>{if(!dragN)return;dragN=Math.max(0,dragN-1);if(!dragN)dragOn(false)});
addEventListener('dragover',e=>{if(!hasFiles(e))return;e.preventDefault();e.dataTransfer.dropEffect=M.project&&!kitOpen()?'copy':'none'});
addEventListener('drop',e=>{if(!hasFiles(e))return;e.preventDefault();dragN=0;dragOn(false);if(kitOpen())return;const fs=[...(e.dataTransfer.files||[])];if(fs.length)importFiles(fs)});

/* ======================= init ======================= */
let rzT=0;
function scheduleMeasure(){clearTimeout(rzT);rzT=setTimeout(()=>{try{buildBg();measure();DIRTY.layout=true;TL.dirty=true}catch(e){console.error('[NOVA DECK] resize',e)}},80)}
function init(){
 applyTheme(LS.get('theme','ion'),false);buildStatic();hydrate();
 makeTick($('#tz'),4,0,i=>tlZoomSet(i));
 wirePanels();wireStage();wireOverlays();
 buildBg();measure();
 const v=vcen();CAM.x=v.x;CAM.y=v.y;CAM.s=1;setCam('overview',false);setMcTab(MC_TAB);
 dirtyAll();updateUI();
 addEventListener('resize',scheduleMeasure);
 if(window.ResizeObserver){const ro=new ResizeObserver(()=>scheduleMeasure());['#stage','#cargo','#mission','#tl-wrap'].forEach(s=>ro.observe($(s)))}
 startLoop();
 if(HOST)post({type:'dsh-vw/ready',skin:SKIN_ID});else ONB.noHost=true;
 setTimeout(()=>{if(!M.ready){ONB.noHost=true;DIRTY.ui=true}},4000);
}
try{init()}catch(e){console.error('[NOVA DECK] init failed',e);if(HOST)post({type:'dsh-vw/ready',skin:SKIN_ID})}
/* automation hooks for headless checks (read-only helpers + camera/focus) */
window.__nd={
 state:()=>({ready:M.ready,project:M.project&&M.project.title,run:M.run&&M.run.status,active:M.run&&M.run.activeAgentId,cam:CAM.mode,s:+CAM.s.toFixed(3),zoomed:!!CAM.zoomed,fps:S.fps,perf:PERF.mode,lite:S.lite,mon:MON.mode,video:videoShown()}),
 layout:()=>({R:Math.round(G.R),corner:G.corner,labels:G.labMode,lw:G.LW,mon:G.mon,stage:G.st,strip:G.strip,cargo:{tight:$('#cargo').classList.contains('tight'),col:$('#staging').classList.contains('col'),none:$('#staging').classList.contains('none')},mission:$('#mission').className}),
 cam:m=>setCam(m),focus:id=>focusAgent(id),unfocus:()=>unfocus(),drawer:v=>v===false?closeDrawer():openDrawer(),help:()=>openHelp(),close:()=>{while(closeTop());}
};
