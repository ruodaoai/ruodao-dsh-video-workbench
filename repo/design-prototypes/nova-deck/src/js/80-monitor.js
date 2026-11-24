/* =====================================================================
   PREVIEW MONITOR — real <video> (preview.mp4Url, letterboxed by object-fit)
   when a film exists and no run is live; otherwise a canvas HUD whose mode
   follows run.activeAgentId. Canvas text is laid out by stackText(): lines are
   stacked inside the free band between the top and bottom chrome and the
   lowest-priority lines are dropped when space runs out — never overlapping,
   never below 12 px.
   ===================================================================== */
const MON={last:-1,mode:'idle',scroll:0,scrollT:0};
const MONV={v:$('#mon-video'),ready:false,loadedUrl:'',err:false,
 dur(){const d=this.v.duration;return Number.isFinite(d)&&d>0?d:(M.preview.durationSec||M.tl.totalSec||0)}};
MONV.v.addEventListener('loadedmetadata',()=>{MONV.ready=true;MONV.err=false;DIRTY.ui=true;TL.dirty=true});
MONV.v.addEventListener('error',()=>{if(!MONV.loadedUrl)return;MONV.ready=false;MONV.err=true;DIRTY.ui=true});
for(const ev of ['play','pause','ended','seeked'])MONV.v.addEventListener(ev,()=>{DIRTY.ui=true;TL.dirty=true});
function syncVideoSrc(force){
 const v=MONV.v,url=M.project&&M.preview.hasMp4?M.preview.mp4Url:'';
 if(!url){if(MONV.loadedUrl){try{v.pause();v.removeAttribute('src');v.removeAttribute('poster');v.load()}catch(e){}}MONV.loadedUrl='';MONV.ready=false;MONV.err=false;DIRTY.ui=true;return}
 if(url!==MONV.loadedUrl||force){MONV.ready=false;MONV.err=false;MONV.loadedUrl=url;try{v.pause()}catch(e){}v.preload='metadata';if(M.preview.posterUrl)v.poster=M.preview.posterUrl;else v.removeAttribute('poster');v.src=url;DIRTY.ui=true}
}
const videoShown=()=>!!MONV.loadedUrl&&!isLive()&&!!M.project;
function monTogglePlay(){
 if(isLive()){toast('编队作业中 · 成片就绪后可播放预览','warn');return}
 if(!MONV.loadedUrl){toast(M.project?'尚未出片 · 点击「一键出片」生成成片':'请先新建或打开一个工程','warn');return}
 const v=MONV.v;
 if(v.paused){if(v.ended||v.currentTime>=MONV.dur()-.05)v.currentTime=0;const p=v.play();if(p&&p.catch)p.catch(()=>{v.muted=true;const p2=v.play();if(p2&&p2.catch)p2.catch(()=>toast('浏览器阻止了播放 · 请再点一次','warn'))})}
 else v.pause();
}
function monSeekT(t){if(!MONV.loadedUrl||isLive())return;try{MONV.v.currentTime=clamp(t,0,Math.max(0,MONV.dur()-.01))}catch(e){}TL.dirty=true}
let lastVT=-1;
function playbackStep(){const v=MONV.v;if(!MONV.ready||v.paused){lastVT=v.currentTime;return}const a=lastVT,b=v.currentTime;lastVT=b;if(b<a||b-a>1)return;
 for(const bt of M.tl.beats){if(bt.t>b)break;if(bt.t>a){TLS.beatFlash=bt.s?1:.4;if(bt.s)runwayPulse(M.tl.drops.some(d=>Math.abs(d-bt.t)<.06));metro()}}}
let rwT=0;function runwayPulse(drop){const r=$('#runway');r.classList.add('beat');r.classList.toggle('drop',drop);clearTimeout(rwT);rwT=setTimeout(()=>r.classList.remove('beat','drop'),170)}
let mtT=0;function metro(){const m=$('#met');m.classList.add('on');clearTimeout(mtT);mtT=setTimeout(()=>m.classList.remove('on'),90)}

/* ======================= mode ======================= */
const MON_LBL={none:['—','未打开工程'],idle:['STANDBY','待命'],queued:['QUEUE','排队中'],beat:['BEAT','节拍检测'],board:['BOARD','分镜生成'],edit:['EDIT','裁切调色'],cloud:['CLOUD','云端生成'],mix:['MIX','配音混音'],code:['CODE','动效编译'],render:['RENDER','渲染出片'],qa:['QA','质检清单'],avatar:['AVATAR','数字人合成'],ref:['REF','参考拆解'],play:['PGM','成片预览'],fail:['FAIL','执行失败'],stop:['STOP','已停止'],done:['READY','成片就绪']};
function monMode(){
 if(!M.project)return 'none';
 const run=M.run;
 if(run&&runLive(run)){
  if(run.status==='queued'&&!run.activeAgentId)return 'queued';
  const a=run.activeAgentId;
  if(a==='director')return SHOW.director&&showU(SHOW.director)<=5.5?'beat':(M.tl.scenes.length?'board':'beat');
  if(a==='qa')return agentOf('qa').progress>=90?'qa':'render';
  return ({editor:'edit',cloud:'cloud',audio:'mix',motion:'code',avatar:'avatar',reference:'ref'})[a]||'queued';
 }
 if(videoShown())return 'play';
 if(run&&run.status==='failed')return 'fail';
 if(run&&run.status==='stopped')return 'stop';
 return run&&run.status==='completed'?'done':'idle';
}
/* ======================= drawing helpers ======================= */
const KW='rgba(255,138,210,.95)',STC='rgba(255,196,110,.95)',CP='rgba(120,230,255,.95)',PL='rgba(232,241,255,.85)',CM='rgba(107,120,163,.85)',NM='rgba(159,233,200,.95)';
function projAR(){const p=M.project;const ar=p&&p.width>0&&p.height>0?p.width/p.height:16/9;return clamp(ar,.3,3.5)}
function frameRect(w,h,ar){ar=ar||projAR();let fw=w,fh=w/ar;if(fh>h){fh=h;fw=h*ar}return{x:(w-fw)/2,y:(h-fh)/2,w:fw,h:fh}}
function drawImgFit(c,img,r,cover){const iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;if(!iw||!ih||r.w<=0||r.h<=0)return;const k=cover?Math.max(r.w/iw,r.h/ih):Math.min(r.w/iw,r.h/ih),dw=iw*k,dh=ih*k;c.save();c.beginPath();c.rect(r.x,r.y,r.w,r.h);c.clip();c.drawImage(img,r.x+(r.w-dw)/2,r.y+(r.h-dh)/2,dw,dh);c.restore()}
function fRidge(c,w,h,base,amp,freq,seed,col,off){c.beginPath();c.moveTo(-w*.15,h*1.2);for(let i=0;i<=56;i++){const x=-w*.15+i*(w*1.3/56),y=base-fbm((x+off)/w*freq,seed)*amp;c.lineTo(x,y)}c.lineTo(w*1.15,h*1.2);c.closePath();c.fillStyle=col;c.fill()}
function monBg(c,w,h){const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#060a1c');g.addColorStop(1,'#020308');c.fillStyle=g;c.fillRect(0,0,w,h);c.strokeStyle='rgba(59,231,255,.05)';c.lineWidth=1;c.beginPath();const st=Math.max(12,w/24);for(let x=0;x<w;x+=st){c.moveTo(x,0);c.lineTo(x,h)}for(let y=0;y<h;y+=st){c.moveTo(0,y);c.lineTo(w,y)}c.stroke()}
const BAND_T=30,BAND_B=36; // mon-top / mon-bot chrome heights
/* lines: [{t,s,f,wt,c,p}] — p = priority (higher number dropped first) */
function stackText(c,lines,w,top,bottom,align,x0,bg){
 align=align||'center';let L=lines.filter(l=>l&&l.t);
 const lh=l=>Math.round(l.s*1.34);const tot=()=>L.reduce((a,l)=>a+lh(l),0);
 while(L.length&&tot()>bottom-top){let wi=0;L.forEach((l,i)=>{if((l.p||0)>=(L[wi].p||0))wi=i});L.splice(wi,1)}
 if(!L.length)return;
 let y=top+((bottom-top)-tot())/2;c.textBaseline='middle';c.textAlign=align;
 const xx=align==='center'?(x0==null?w/2:x0):align==='left'?(x0==null?12:x0):(x0==null?w-12:x0);
 for(const l of L){c.font=`${l.wt||600} ${Math.max(12,l.s)}px ${l.f||FONT_UI}`;const mw=l.mw||(align==='center'?w-24:Math.max(10,(align==='left'?w-xx:xx)-10));const s=fitText(c,l.t,mw);
  if(s){if(bg){const tw=c.measureText(s).width,bx=align==='center'?xx-tw/2:align==='left'?xx:xx-tw;c.fillStyle='rgba(2,4,12,.62)';c.fillRect(bx-4,y+1,tw+8,lh(l)-2)}c.fillStyle=l.c||'rgba(232,241,255,.92)';c.fillText(s,xx,y+lh(l)/2)}
  y+=lh(l)}
 c.textAlign='left';
}
const fsOf=h=>clamp(h/270,1,1.6);
function anyThumb(){const s=M.tl.scenes.find(x=>x.thumbUrl);return thumbImg(M.preview.posterUrl)||(s?thumbImg(s.thumbUrl):null)||(()=>{const a=M.assets.find(x=>x.kind==='image'&&(x.thumbUrl||x.url));return a?thumbImg(a.thumbUrl||a.url):null})()}
function voiceAmpAt(t){const sc=M.tl.scenes;if(!sc.length)return .3+.2*Math.sin(t*9);let f=null;for(const s of sc){if(s.startSec<=t&&t<=s.endSec){f=s;break}}if(!f)return 0;const lt=t-f.startSec,spk=Math.min(f.durationSec*.9,(f.subtitle.length||8)*.2+.25);if(lt<.06||lt>spk)return 0;return clamp(.35+.65*Math.abs(Math.sin((lt/.2)*Math.PI)),0,1)}
/* ======================= modes ======================= */
function monIdle(c,w,h,txt){
 c.fillStyle='#03040a';c.fillRect(0,0,w,h);const fr=frameRect(w,h),img=anyThumb();
 if(img){c.globalAlpha=.5;drawImgFit(c,img,fr,false);c.globalAlpha=1}
 else{const off=S.simT*12;for(let k=0;k<3;k++)fRidge(c,w,h,h*(.62+k*.09),h*(.18-k*.04),2+k,90+k,['#141a36','#0c1026','#060814'][k],off*(.4+k*.5));c.globalCompositeOperation='lighter';glow(c,w*.7,h*.42,h*.5,'59,90,200',.35);glow(c,w/2,h*.42,h*.36,'255,150,70',.16);c.globalCompositeOperation='source-over'}
 if(fr.w<w-2||fr.h<h-2){c.strokeStyle='rgba(255,255,255,.2)';c.setLineDash([4,4]);c.strokeRect(fr.x+.5,fr.y+.5,fr.w-1,fr.h-1);c.setLineDash([])}
 if(!txt||!M.project)return;
 const p=M.project,tl=M.tl,fs=fsOf(h),done=M.run&&M.run.status==='completed';
 const meta=[tl.scenes.length?tl.scenes.length+' 镜':'',tl.bpm?tl.bpm+' BPM':'',tl.totalSec?fmtSec(tl.totalSec):'',p.aspectRatio&&p.aspectRatio!=='auto'?p.aspectRatio:''].filter(Boolean).join(' · ');
 stackText(c,[{t:p.title,s:Math.round(clamp(22*fs,14,30)),f:FONT_KAI,wt:900,c:'rgba(255,236,200,.96)',p:0},
  {t:(done?'成片已完成':'STANDBY · 待出片')+(meta?' · '+meta:''),s:12,wt:600,c:`rgba(${PAL.accRgb},.92)`,p:1},
  {t:done?'成片文件暂不可用 · 可在任务中心查看':M.director.topic?'按 R 或点击「一键出片」启动 8 架无人机':'先在右侧写下视频主题，再点击「一键出片」',s:12,c:'rgba(166,181,218,.82)',p:2}],w,BAND_T,h-BAND_B,'center',null,!!img);
}
function monQueued(c,w,h){monBg(c,w,h);const T=S.simT,r=Math.min(w,h)*.12;c.strokeStyle=`rgba(${PAL.accRgb},.6)`;c.lineWidth=2;c.beginPath();c.arc(w/2,h/2,Math.max(4,r),T%TAU,T%TAU+4.4);c.stroke();c.globalCompositeOperation='lighter';glow(c,w/2,h/2,r*2.4,PAL.accRgb,.2);c.globalCompositeOperation='source-over'}
function monBeat(c,w,h,txt){
 monBg(c,w,h);const tl=M.tl,tot=tl.totalSec||1,u=directorScan(),st=u==null?1:u;
 const bandY=Math.max(BAND_T+22,h*.36),bandB=Math.min(h-BAND_B-4,h*.9),bh=Math.max(10,bandB-bandY),mid=bandY+bh/2,pad=14,ww=Math.max(10,w-pad*2),amp=bh*.42;
 c.fillStyle='rgba(143,180,255,.5)';for(let x=0;x<ww;x+=2){const t=x/ww*tot;if(t>st*tot)break;const a=bgmEnv(t)*amp;c.fillRect(pad+x,mid-a,1.4,a*2)}
 for(const b of tl.beats){if(b.t>st*tot)break;const x=pad+b.t/tot*ww;c.fillStyle=b.s?`rgba(${PAL.ambRgb},.9)`:`rgba(${PAL.accRgb},.35)`;c.fillRect(x-(b.s?.8:.4),mid-amp*1.05,b.s?1.6:.8,amp*2.1)}
 for(const d of tl.drops){if(d>st*tot)continue;const x=pad+d/tot*ww;c.fillStyle=PAL.mag;c.fillRect(x-1,mid-amp*1.2,2,amp*2.4)}
 const sx=pad+st*ww;c.fillStyle='#fff';c.fillRect(sx-1,mid-amp*1.25,2,amp*2.5);c.globalCompositeOperation='lighter';glow(c,sx,mid,28,AGM.director.rgb,.8);c.globalCompositeOperation='source-over';
 if(!txt)return;
 const nb=tl.beats.filter(b=>b.t<=st*tot).length,nd=tl.drops.filter(d=>d<=st*tot).length;
 stackText(c,[{t:tl.bpm?`${tl.bpm} BPM${st>=1?' ✓ 节拍已锁定':' · 节拍扫描'}`:'节拍扫描中',s:Math.round(clamp(17*fsOf(h),14,24)),f:FONT_HUD,wt:700,c:'#fff',p:0},
  {t:tl.beats.length?`拍点 ${nb}/${tl.beats.length} · 突降 ${nd}/${tl.drops.length}`:'未检测到配乐节拍 · 按叙事节奏切镜',s:12,c:'rgba(166,181,218,.92)',p:1}],w,BAND_T,bandY-2,'left',pad);
}
function gridFit(n,W,H,ar,gap){let best={cols:1,cw:0,ch:0};for(let cols=1;cols<=Math.max(1,n);cols++){const rows=Math.ceil(n/cols);const cw=Math.min((W-gap*(cols-1))/cols,((H-gap*(rows-1))/rows)*ar);if(cw>best.cw)best={cols,cw,ch:cw/ar}}return best}
function monBoard(c,w,h,txt){
 monBg(c,w,h);const sc=M.tl.scenes,n=sc.length,ag=agentOf('director'),lit=ag.status==='done'?n:Math.round(clamp(ag.progress/100,0,1)*n);
 const side=w>=300,gx=side?w*.62:w-12,top=BAND_T,bot=h-BAND_B,pad=10;
 const g=gridFit(n,gx-pad*2,bot-top-4,16/9,3);let last=null;
 for(const s of sc){const k=s.i,cx=pad+(k%g.cols)*(g.cw+3),cy=top+2+Math.floor(k/g.cols)*(g.ch+3);c.strokeStyle='rgba(59,231,255,.14)';c.lineWidth=1;c.strokeRect(cx+.5,cy+.5,Math.max(0,g.cw-1),Math.max(0,g.ch-1));
  if(k>=lit)continue;last=s;const img=s.thumbUrl?thumbImg(s.thumbUrl):null;if(img)drawImgFit(c,img,{x:cx+1,y:cy+1,w:g.cw-2,h:g.ch-2},true);else{c.fillStyle=`rgba(${s.col},.55)`;c.fillRect(cx+1,cy+1,Math.max(0,g.cw-2),Math.max(0,g.ch-2))}}
 if(!side||!txt||!last)return;
 const px=gx+6,pw=w-px-pad,img=last.thumbUrl?thumbImg(last.thumbUrl):null,ph=Math.min(pw*9/16,(bot-top)*.5),py=top+4;
 if(img)drawImgFit(c,img,{x:px,y:py,w:pw,h:ph},true);else{c.fillStyle=`rgba(${last.col},.4)`;c.fillRect(px,py,pw,ph)}c.strokeStyle=`rgba(${PAL.accRgb},.8)`;c.lineWidth=1.5;c.strokeRect(px,py,pw,ph);
 stackText(c,[{t:`#${pad2(last.n)} ${last.title}`,s:13,wt:800,c:'#fff',p:0},{t:last.subtitle?'“'+last.subtitle+'”':'',s:12,c:'rgba(166,181,218,.95)',p:2},{t:`分镜 ${lit}/${n} 幕`,s:12,c:`rgba(${PAL.accRgb},.92)`,p:1}],w,py+ph+2,bot,'left',px);
}
function monEdit(c,w,h,txt){
 const so=sortieNow(),as=so?M.assets.find(a=>a.id===so.s.asset):null,fr=frameRect(w,h);
 const vis=as&&typeOf(as.kind).f==='video'||as&&as.kind==='image';
 if(as&&vis){c.fillStyle='#020308';c.fillRect(0,0,w,h);const img=thumbImg(as.thumbUrl||(as.kind==='image'?as.url:''));if(img)drawImgFit(c,img,fr,true);else monBg(c,w,h);
  const v=so.v,cr=E.io3(inv(1.4,2.5,v)),iw=fr.w*lerp(1,.82,1-cr),ih=fr.h*lerp(1,.82,1-cr),x0=fr.x+(fr.w-iw)/2,y0=fr.y+(fr.h-ih)/2;
  c.strokeStyle='rgba(255,255,255,.9)';c.lineWidth=1.5;c.strokeRect(x0,y0,iw,ih);c.strokeStyle='rgba(255,255,255,.25)';c.lineWidth=1;c.beginPath();for(let i=1;i<3;i++){c.moveTo(x0+iw*i/3,y0);c.lineTo(x0+iw*i/3,y0+ih);c.moveTo(x0,y0+ih*i/3);c.lineTo(x0+iw,y0+ih*i/3)}c.stroke();
  const wx=fr.x+fr.w*(.15+.7*((S.simT*.25)%1));c.save();c.beginPath();c.rect(fr.x,fr.y,Math.max(0,wx-fr.x),fr.h);c.clip();c.fillStyle='rgba(30,40,80,.35)';c.globalCompositeOperation='saturation';c.fillRect(fr.x,fr.y,fr.w,fr.h);c.restore();c.fillStyle='rgba(255,255,255,.85)';c.fillRect(wx-1,fr.y,2,fr.h)}
 else if(as){monBg(c,w,h);const mid=h*.58,col=as.kind==='voice'?TRK.vo.rgb:TRK.bgm.rgb;c.fillStyle=`rgba(${col},.85)`;for(let x=10;x<w-10;x+=2){const t=(x/w)*30,a=(.25+.75*Math.abs(Math.sin(x*.09+S.simT*2)*Math.sin(x*.023+1)))*h*.16;c.fillRect(x,mid-a,1.3,a*2)}}
 else{monBg(c,w,h);const imgs=M.assets.filter(a=>a.kind==='image'||a.kind==='video').slice(0,12),g=gridFit(Math.max(1,imgs.length),w-24,h-BAND_T-BAND_B-8,16/9,4);imgs.forEach((a,i)=>{const x=12+(i%g.cols)*(g.cw+4),y=BAND_T+4+Math.floor(i/g.cols)*(g.ch+4),img=thumbImg(a.thumbUrl||(a.kind==='image'?a.url:''));if(img)drawImgFit(c,img,{x,y,w:g.cw,h:g.ch},true);else{c.fillStyle='rgba(90,169,255,.25)';c.fillRect(x,y,g.cw,g.ch)}});
  const sw=(S.simT*.3)%1;c.fillStyle='rgba(255,255,255,.7)';c.fillRect(12+(w-24)*sw,BAND_T,1.5,h-BAND_T-BAND_B)}
 if(!txt)return;
 const N=so?so.sh.sorties.length:0,sc=so&&M.tl.scenes[so.s.sc];
 stackText(c,[{t:as?`装载 ${so.k+1}/${N} · ${as.name}`:`素材剪辑 · ${agentTask('editor')}`,s:13,wt:700,c:'#fff',p:0},{t:sc?`→ V1 #${pad2(sc.n)} ${sc.title}`:as&&so.s.track==='bgm'?'→ A3 配乐轨':as?'→ A1 配音轨':'',s:12,c:`rgba(${PAL.accRgb},.95)`,p:1}],w,BAND_T,Math.min(h-BAND_B,BAND_T+44),'left',12,true);
}
function monCloud(c,w,h,txt){
 monBg(c,w,h);const st=M.staging.slice(0,6),T=S.simT;
 if(st.length){const g=gridFit(st.length,w-24,h-BAND_T-BAND_B-26,16/9,6);st.forEach((x,i)=>{const cx=12+(i%g.cols)*(g.cw+6),cy=BAND_T+22+Math.floor(i/g.cols)*(g.ch+6),img=x.thumbUrl?thumbImg(x.thumbUrl):null;if(img)drawImgFit(c,img,{x:cx,y:cy,w:g.cw,h:g.ch},true);else{c.fillStyle='rgba(90,169,255,.18)';c.fillRect(cx,cy,g.cw,g.ch);glyph(c,x.kind==='audio'?'music':x.kind,cx+g.cw/2,cy+g.ch/2,Math.min(g.cw,g.ch)*.18,'rgba(140,200,255,.9)')}c.strokeStyle=`rgba(${PAL.ambRgb},.7)`;c.strokeRect(cx+.5,cy+.5,g.cw-1,g.ch-1)})}
 else{const r=Math.min(w,h)*.16;c.globalCompositeOperation='lighter';glow(c,w/2,h/2,r*2.2,AGM.cloud.rgb,.35+.15*Math.sin(T*3));c.globalCompositeOperation='source-over';glyph(c,'image',w/2,h/2,Math.max(6,r*.45),'rgba(140,200,255,.9)')}
 if(!txt)return;
 stackText(c,[{t:st.length?`云端生成 · ${M.staging.length} 件待确认入库`:'云端生成中 · 结果将进入待确认',s:13,wt:700,c:'#fff',p:0}],w,BAND_T,BAND_T+20,'left',12,true);
}
function monMix(c,w,h,txt){
 monBg(c,w,h);const tot=M.tl.totalSec||1,u=audioSweep(),st=(u==null?1:u)*tot,pure=M.project&&M.project.narrationMode==='subtitle-mv',T=S.simT;
 const top=BAND_T+(txt?20:4),bot=h-BAND_B,showLbl=bot-top>64;
 const chs=[['VO',TRK.vo.rgb,pure?0:voiceAmpAt(st)],['SFX',PAL.ambRgb,M.tl.sfx.some(x=>Math.abs(x.t-st)<.12)?.95:.14],['BGM',TRK.bgm.rgb,bgmEnv(st)*(pure?1:.62)],['MST',PAL.accRgb,.74+.12*Math.sin(T*7)]];
 c.font=`600 12px ${FONT_HUD}`;const lw=Math.max(...chs.map(x=>c.measureText(x[0]).width))+8,sp=Math.max(lw,clamp(w*.075,24,54)),mw=clamp(sp*.42,8,18),mh=Math.max(8,bot-top-(showLbl?18:4));
 chs.forEach(([n,col,lv],i)=>{const x=14+i*sp+(sp-mw)/2,y0=top+2;c.fillStyle='rgba(255,255,255,.05)';c.fillRect(x,y0,mw,mh);const l=clamp(lv*(.9+.1*Math.sin(T*30+i)),0,1);const gg=c.createLinearGradient(0,y0+mh,0,y0);gg.addColorStop(0,`rgba(${col},.6)`);gg.addColorStop(.8,`rgba(${col},1)`);gg.addColorStop(1,'rgba(255,90,90,1)');c.fillStyle=gg;c.fillRect(x,y0+mh*(1-l),mw,mh*l);for(let k=1;k<12;k++){c.fillStyle='rgba(2,4,12,.9)';c.fillRect(x,y0+k*mh/12,mw,1)}
  if(showLbl){c.fillStyle='rgba(232,241,255,.85)';c.textAlign='center';c.textBaseline='middle';c.fillText(n,14+i*sp+sp/2,bot-8);c.textAlign='left'}});
 const sx=14+4*sp+12,sw=w-sx-14,mid=top+(bot-top)/2;
 if(sw>40){c.fillStyle=`rgba(${TRK.bgm.rgb},.45)`;for(let x=0;x<sw;x+=2){const t=st-3+x/sw*6;if(t<0||t>tot)continue;const a=bgmEnv(t)*(bot-top)*.3;c.fillRect(sx+x,mid-a,1.3,a*2)}
  if(!pure){c.fillStyle=`rgba(${TRK.vo.rgb},.9)`;for(let x=0;x<sw;x+=2){const t=st-3+x/sw*6;if(t<0||t>tot)continue;const a=voiceAmpAt(t)*(bot-top)*.24;c.fillRect(sx+x,mid-a,1.3,a*2)}}
  c.fillStyle='#fff';c.fillRect(sx+sw/2-1,mid-(bot-top)*.4,2,(bot-top)*.8)}
 if(!txt)return;
 stackText(c,[{t:`${pure?'卡点编排':'配音混音'} · ${fmtMSc(st)} / ${fmtMSc(tot)}`,s:13,wt:700,c:'#fff',p:0}],w,BAND_T,BAND_T+20,'left',14);
}
function codeLines(sc){const html=M.director.engine==='html'||(M.project&&M.project.engine==='html');const t=sc?sc.title:'Scene',sub=sc?sc.subtitle:'',n=sc?pad2(sc.n):'01',d=sc?sc.durationSec.toFixed(2):'3.00';
 if(html)return[[['<!-- 镜头 '+n+' · '+t+' · '+d+'s -->',CM]],[['<section',KW],[' class=',PL],['"scene"',STC],[' data-dur=',PL],['"'+d+'"',NM],['>',PL]],[['  <h1',KW],[' class=',PL],['"title"',STC],['>'+t+'</h1>',PL]],[['  <p',KW],[' class=',PL],['"sub"',STC],['>'+sub+'</p>',PL]],[['</section>',KW]],[['gsap',CP],['.timeline()',PL]],[['  .from',CP],["('.title', {y: ",PL],['40',NM],[', opacity: ',PL],['0',NM],['})',PL]],[['  .from',CP],["('.sub', {opacity: ",PL],['0',NM],['}, ',PL],["'<0.2'",STC],[')',PL]]];
 return[[['// 镜头 '+n+' · '+t+' · '+d+'s',CM]],[['import',KW],[' {AbsoluteFill, spring, useCurrentFrame} ',PL],['from',KW],[" 'remotion'",STC]],[['export const',KW],[' Shot'+n,CP],[' = () => {',PL]],[['  const',KW],[' f = ',PL],['useCurrentFrame',CP],['();',PL]],[['  const',KW],[' s = ',PL],['spring',CP],['({frame: f, fps: ',PL],[String(M.tl.fps||30),NM],['});',PL]],[['  return',KW],[' <',PL],['AbsoluteFill',CP],['>',PL]],[['    <',PL],['Title',CP],[' text=',PL],['"'+t+'"',STC],[' />',PL]],[['    <',PL],['Subtitle',CP],[' text=',PL],['"'+sub+'"',STC],[' />',PL]],[['  </',PL],['AbsoluteFill',CP],['>;',PL]],[['};',PL]]]}
function monCode(c,w,h,txt){
 monBg(c,w,h);const ag=agentOf('motion'),n=M.tl.scenes.length,k=n?Math.min(n-1,Math.floor(clamp(ag.progress/100,0,1)*n)):0,sc=M.tl.scenes[k]||null;
 const side=w>=300,cw=side?w*.56:w;c.fillStyle='rgba(2,3,10,.85)';c.fillRect(0,0,cw,h);
 const lines=codeLines(sc),lh=16,top=BAND_T+2,bot=h-BAND_B-2,rows=Math.max(0,Math.floor((bot-top)/lh));
 if(S.simT-MON.scrollT>.35){MON.scrollT=S.simT;MON.scroll=(MON.scroll+1)%lines.length}
 c.font=`400 12px ${FONT_MONO}`;c.textBaseline='middle';
 for(let i=0;i<rows;i++){const li=(MON.scroll+i)%lines.length,y=top+i*lh+lh/2;let x=10,room=cw-16;for(const [t,col] of lines[li]){if(room<=8)break;const s=fitText(c,t,room);if(!s)break;c.fillStyle=col;c.fillText(s,x,y);const tw=c.measureText(s).width;x+=tw;room-=tw;if(s!==t)break}}
 if(!side)return;
 const px=cw+8,pw=w-px-8,ph=Math.min(pw*9/16,(bot-top)*.55),py=top;const img=sc&&sc.thumbUrl?thumbImg(sc.thumbUrl):null;
 if(img)drawImgFit(c,img,{x:px,y:py,w:pw,h:ph},true);else{c.fillStyle=sc?`rgba(${sc.col},.35)`:'rgba(140,124,255,.25)';c.fillRect(px,py,pw,ph)}
 const cu=(S.simT*.8)%1;c.fillStyle='rgba(2,4,12,.6)';c.fillRect(px,py+ph*cu,pw,ph*(1-cu));c.fillStyle='rgba(140,124,255,.95)';c.fillRect(px,py+ph*cu-1,pw,2);c.strokeStyle='rgba(140,124,255,.8)';c.strokeRect(px,py,pw,ph);
 const cells=Math.min(16,Math.max(1,n)),cy=py+ph+6;for(let i=0;i<cells;i++){const x=px+i*(pw/cells),dn=ag.progress/100*cells>i+1;c.fillStyle=dn?'rgba(140,124,255,.9)':(ag.progress/100*cells>i?`rgba(140,124,255,${.5+.5*Math.sin(S.simT*10)})`:'rgba(255,255,255,.08)');c.fillRect(x+1,cy,Math.max(1,pw/cells-2),6)}
 if(txt)stackText(c,[{t:n?`编译 ${Math.min(n,Math.round(ag.progress/100*n))}/${n} 镜`:'动效编码中',s:12,wt:700,c:'#fff',p:0},{t:sc?sc.title:'',s:12,c:'rgba(232,241,255,.8)',p:1}],w,cy+10,bot,'left',px);
}
function monRender(c,w,h,txt){
 const qa=agentOf('qa'),p=clamp(qa.progress/90,0,1),fr=frameRect(w,h),img=anyThumb();
 c.fillStyle='#020308';c.fillRect(0,0,w,h);if(img)drawImgFit(c,img,fr,true);else monIdle(c,w,h,false);
 const cols=8,rows=4,tw=fr.w/cols,th=fr.h/rows,nt=Math.floor(p*cols*rows);
 for(let i=0;i<cols*rows;i++){if(i<nt)continue;c.fillStyle='rgba(2,4,12,.62)';c.fillRect(fr.x+(i%cols)*tw,fr.y+Math.floor(i/cols)*th,tw,th)}
 if(nt<cols*rows){c.strokeStyle=`rgba(${PAL.ambRgb},.9)`;c.lineWidth=1.5;c.strokeRect(fr.x+(nt%cols)*tw+1,fr.y+Math.floor(nt/cols)*th+1,tw-2,th-2)}
 const by=h-BAND_B-8;c.fillStyle='rgba(255,255,255,.12)';c.fillRect(12,by,w-24,4);c.fillStyle=PAL.amb;c.fillRect(12,by,(w-24)*p,4);
 if(txt){const pj=M.project;stackText(c,[{t:`渲染 ${Math.round(qa.progress)}% · ${pj?String(pj.quality).toUpperCase().replace('P','p')+(pj.fps||30):''} · H.264`,s:13,wt:700,f:FONT_UI,c:'#fff',p:0}],w,by-24,by-2,'left',12,true)}
}
const QA_ITEMS=['时长对齐','黑帧检测','响度标准','音画同步','编码封装'];
function monQA(c,w,h,txt){
 monRender(c,w,h,false);const qa=agentOf('qa'),k=qa.status==='done'?QA_ITEMS.length:Math.floor(clamp((qa.progress-90)/10,0,1)*QA_ITEMS.length);
 if(!txt)return;const top=BAND_T+4,bot=h-BAND_B-4,lh=18,n=Math.min(QA_ITEMS.length,Math.floor((bot-top-22)/lh));if(n<1){stackText(c,[{t:`质检 ${k}/${QA_ITEMS.length}`,s:13,wt:700,c:'#fff'}],w,top,bot,'center',null,true);return}
 const pw=Math.min(220,w*.46),px=w-pw-10,ph=22+n*lh;c.fillStyle='rgba(3,5,14,.86)';rrect(c,px,top,pw,ph,8);c.fill();c.strokeStyle=`rgba(${PAL.ambRgb},.7)`;c.lineWidth=1;c.stroke();
 c.textBaseline='middle';c.font=`700 12px ${FONT_UI}`;c.fillStyle=`rgba(${PAL.ambRgb},.95)`;c.fillText(fitText(c,`质检清单 ${k}/${QA_ITEMS.length}`,pw-20),px+10,top+12);
 for(let i=0;i<n;i++){const ok=i<k,y=top+22+i*lh+lh/2;c.fillStyle=ok?'#9fe9c8':'rgba(107,120,163,.7)';c.font=`700 12px ${FONT_UI}`;c.fillText(ok?'✓':'○',px+10,y);c.fillStyle=ok?'#fff':'rgba(166,181,218,.65)';c.font=`600 12px ${FONT_UI}`;c.fillText(fitText(c,QA_ITEMS[i],pw-40),px+28,y)}
}
function monAvatar(c,w,h,txt){
 monBg(c,w,h);const T=S.simT,fr=frameRect(w,h),cx=w/2,base=h-BAND_B,ph=Math.max(20,(base-BAND_T)*.92),pw=ph*.6;
 c.globalCompositeOperation='lighter';glow(c,cx,base-ph*.45,ph*.7,AGM.avatar.rgb,.28);c.globalCompositeOperation='source-over';
 c.fillStyle='rgba(230,236,255,.85)';c.beginPath();c.arc(cx,base-ph*.66,pw*.2,0,TAU);c.fill();c.beginPath();c.ellipse(cx,base,pw*.42,ph*.34,0,Math.PI,0);c.fill();
 c.fillStyle=AGM.avatar.col;const lip=Math.abs(Math.sin(T*14))*3;c.fillRect(cx-pw*.06,base-ph*.6+lip*.3,pw*.12,2+lip);
 c.strokeStyle='rgba(255,79,216,.35)';c.lineWidth=1;for(let y=BAND_T;y<base;y+=4){c.beginPath();c.moveTo(fr.x,y+((T*20)%4));c.lineTo(fr.x+fr.w,y+((T*20)%4));c.stroke()}
 if(txt)stackText(c,[{t:'数字人 · 口型驱动 · '+(({'pip-br':'右下画中画','pip-bl':'左下画中画',fullscreen:'全屏口播'})[M.director.avatarLayout]||'画中画'),s:13,wt:700,c:'#fff',p:0}],w,BAND_T,BAND_T+20,'left',12,true);
}
function monRef(c,w,h,txt){
 monBg(c,w,h);const T=S.simT,n=8,fw=(w-24)/n,fh=Math.min(fw*9/16,(h-BAND_T-BAND_B)*.5),y=(h-fh)/2+6;
 for(let i=0;i<n;i++){const x=12+i*fw;c.fillStyle=`rgba(255,138,122,${.12+.1*hash(i*7)})`;c.fillRect(x+2,y,fw-4,fh);c.strokeStyle='rgba(255,138,122,.5)';c.strokeRect(x+2.5,y+.5,fw-5,fh-1)}
 const sx=12+((T*.25)%1)*(w-24);c.fillStyle='#fff';c.fillRect(sx-1,y-8,2,fh+16);c.globalCompositeOperation='lighter';glow(c,sx,y+fh/2,30,AGM.reference.rgb,.7);c.globalCompositeOperation='source-over';
 if(txt)stackText(c,[{t:'参考样片拆解 · 切点 / 节奏 / 调色',s:13,wt:700,c:'#fff',p:0}],w,BAND_T,BAND_T+20,'left',12);
}
function monHalt(c,w,h,rgb){const img=anyThumb(),fr=frameRect(w,h);c.fillStyle='#020308';c.fillRect(0,0,w,h);if(img){c.globalAlpha=.35;drawImgFit(c,img,fr,true);c.globalAlpha=1}else monBg(c,w,h);c.fillStyle=`rgba(${rgb},.12)`;c.fillRect(0,0,w,h);c.strokeStyle=`rgba(${rgb},.18)`;c.lineWidth=1;c.beginPath();for(let y=0;y<h;y+=3){c.moveTo(0,y+.5);c.lineTo(w,y+.5)}c.stroke()}
function drawMonitorAt(c,w,h,mode){
 if(w<4||h<4)return;
 c.save();c.textBaseline='alphabetic';c.textAlign='left';
 const txt=!$('#mon-state').classList.contains('on');
 switch(mode){
  case 'beat':monBeat(c,w,h,txt);break;case 'board':monBoard(c,w,h,txt);break;case 'edit':monEdit(c,w,h,txt);break;case 'cloud':monCloud(c,w,h,txt);break;
  case 'mix':monMix(c,w,h,txt);break;case 'code':monCode(c,w,h,txt);break;case 'render':monRender(c,w,h,txt);break;case 'qa':monQA(c,w,h,txt);break;
  case 'avatar':monAvatar(c,w,h,txt);break;case 'ref':monRef(c,w,h,txt);break;case 'queued':monQueued(c,w,h);break;
  case 'fail':monHalt(c,w,h,PAL.redRgb);break;case 'stop':monHalt(c,w,h,'166,181,218');break;
  case 'none':c.fillStyle='#03040a';c.fillRect(0,0,w,h);break;
  default:monIdle(c,w,h,txt);
 }
 if(M.run&&M.run.status==='paused'){c.fillStyle='rgba(2,4,12,.35)';c.fillRect(0,0,w,h)}
 c.restore();
}
function drawMonitor(){const md=monMode();if(md!==MON.mode)MON.mode=md;if(videoShown())return;if(CV.mon.width<4)return;X.mon.setTransform(MONQ,0,0,MONQ,0,0);drawMonitorAt(X.mon,G.mon.w,G.mon.h,MON.mode)}
