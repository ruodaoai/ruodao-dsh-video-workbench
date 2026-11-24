/* =====================================================================
   NOVA DECK · production skin — driven by the host bridge (lib/warroom/BRIDGE.md).
   The skin is a pure view: it renders WarRoomState and sends user intents as actions.
   ===================================================================== */
const SKIN_ID='nova-deck';
/* ======================= tiny utils ======================= */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const clamp=(v,a,b)=>v<a?a:v>b?b:v, lerp=(a,b,t)=>a+(b-a)*t, inv=(a,b,v)=>b===a?(v>=b?1:0):clamp((v-a)/(b-a),0,1);
const TAU=Math.PI*2;
const E={io2:t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2,io3:t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2,io4:t=>t<.5?8*t*t*t*t:1-Math.pow(-2*t+2,4)/2,
 o2:t=>1-(1-t)*(1-t),o3:t=>1-Math.pow(1-t,3),o5:t=>1-Math.pow(1-t,5),i2:t=>t*t,i3:t=>t*t*t,
 oBack:t=>{const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2)}};
const bez=(a,b,c,d,t)=>{const u=1-t;return{x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y}};
function hash(n){n|=0;n=Math.imul(n^(n>>>16),0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);n^=n>>>16;return (n>>>0)/4294967296}
function strHash(s){let h=2166136261;s=String(s||'');for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}}
function noise1(x,seed){const i=Math.floor(x),f=x-i,u=f*f*(3-2*f);const a=hash(i*374761393+seed*668265263),b=hash((i+1)*374761393+seed*668265263);return a+(b-a)*u}
function fbm(x,seed){return noise1(x,seed)*.58+noise1(x*2.13,seed+11)*.28+noise1(x*4.37,seed+23)*.14}
function hexRgb(h){const n=parseInt(String(h).slice(1),16)||0;return `${n>>16&255},${n>>8&255},${n&255}`}
const num=(v,d=0)=>{const n=Number(v);return Number.isFinite(n)?n:d};
const pad2=n=>String(Math.max(0,Math.floor(n))).padStart(2,'0');
const fmtMS=s=>{s=Math.max(0,num(s));if(s>=3600)return Math.floor(s/3600)+':'+pad2(Math.floor(s%3600/60))+':'+pad2(Math.floor(s%60));return pad2(Math.floor(s/60))+':'+pad2(Math.floor(s%60))};
const fmtMSc=s=>{s=Math.max(0,num(s));return pad2(Math.floor(s/60))+':'+pad2(Math.floor(s%60))+'.'+pad2(Math.floor((s%1)*100))};
const fmtTC=(s,fps=30)=>{s=Math.max(0,num(s));return pad2(Math.floor(s/3600))+':'+pad2(Math.floor(s%3600/60))+':'+pad2(Math.floor(s%60))+':'+pad2(Math.floor((s%1)*fps))};
const fmtSec=s=>{s=num(s);if(s<=0)return '—';if(s<60)return (s<10?s.toFixed(1):Math.round(s))+' s';return fmtMS(s)};
const angDiff=(a,b)=>{let d=(b-a)%TAU;if(d>Math.PI)d-=TAU;if(d<-Math.PI)d+=TAU;return d};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setTxt(el,v){v=String(v==null?'':v);if(el&&el._t!==v){el._t=v;el.textContent=v}}
function setHtml(el,v){if(el&&el._h!==v){el._h=v;el.innerHTML=v}}
function setCls(el,c,on){if(el&&el.classList.contains(c)!==!!on)el.classList.toggle(c,!!on)}
function setAttr(el,k,v){if(!el)return;v=v==null?null:String(v);if(el.getAttribute(k)!==v){if(v==null)el.removeAttribute(k);else el.setAttribute(k,v)}}
function setTitle(el,v){setAttr(el,'title',v||null)}
function cleanMsg(s,drop){s=String(s||'').replace(/^[\s\u2190-\u2BFF\uD83C-\uDBFF\uDC00-\uDFFF\uFE0F\u200D✓✔✕✖❌⛔⚠⏸▶⚡]+/,'').trim();if(drop)s=s.replace(drop,'').trim();return s}
const clock=()=>{const d=new Date();return pad2(d.getHours())+':'+pad2(d.getMinutes())+':'+pad2(d.getSeconds())};
function hhmmss(iso){if(!iso)return '';const d=new Date(iso);if(isNaN(d))return '';return pad2(d.getHours())+':'+pad2(d.getMinutes())+':'+pad2(d.getSeconds())}
function relTime(iso){if(!iso)return '';const d=new Date(iso);if(isNaN(d))return '';const s=(Date.now()-d.getTime())/1000;if(s<60)return '刚刚';if(s<3600)return Math.floor(s/60)+' 分钟前';if(s<86400)return Math.floor(s/3600)+' 小时前';if(s<86400*30)return Math.floor(s/86400)+' 天前';return (d.getMonth()+1)+'月'+d.getDate()+'日'}
/* localStorage — only keys prefixed dshvw.nova-deck. (BRIDGE rule 8) */
const LS={get(k,d){try{const v=localStorage.getItem('dshvw.'+SKIN_ID+'.'+k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem('dshvw.'+SKIN_ID+'.'+k,JSON.stringify(v))}catch(e){}}};
const rectHit=(a,b,m=0)=>a.x<b.x+b.w+m&&a.x+a.w+m>b.x&&a.y<b.y+b.h+m&&a.y+a.h+m>b.y;
const inflate=(r,m)=>({x:r.x-m,y:r.y-m,w:r.w+m*2,h:r.h+m*2});
function circleRectHit(cx,cy,r,R){const nx=clamp(cx,R.x,R.x+R.w),ny=clamp(cy,R.y,R.y+R.h);return (cx-nx)*(cx-nx)+(cy-ny)*(cy-ny)<r*r}

/* ======================= icons (inline SVG, stroke) ======================= */
const IC={
 upload:'<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
 cloud:'<path d="M7 18.5h10.2a4.2 4.2 0 0 0 .6-8.36A6 6 0 0 0 6.3 11.2 3.7 3.7 0 0 0 7 18.5z"/>',
 drop:'<rect x="3" y="3" width="18" height="18" rx="4" stroke-dasharray="3 3"/><path d="M12 7.5v8.5M8.5 12.5L12 16l3.5-3.5"/>',
 image:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 2.5-2.5L21 19"/><circle cx="16" cy="9" r="1.6"/>',
 video:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z" fill="currentColor"/>',
 music:'<path d="M9 18V6.5l11-2.5v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
 voice:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
 note:'<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h5"/>',
 play:'<path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor" stroke="none"/>',
 pause:'<path d="M8.5 5v14M15.5 5v14" stroke-width="3.2"/>',
 stop:'<rect x="6" y="6" width="12" height="12" rx="1.6" fill="currentColor" stroke="none"/>',
 retry:'<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 3.8V9h5.2"/>',
 rocket:'<path d="M5.5 14.5C4 16 3.5 20.5 3.5 20.5S8 20 9.5 18.5"/><path d="M9 15l-2.5-2.5C8 8 12 3.5 20.5 3.5 20.5 12 16 16 11.5 17.5z"/><circle cx="15" cy="9" r="1.7"/>',
 expand:'<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
 grid:'<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16"/>',
 gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8M12 17.2v.1"/>',
 x:'<path d="M6 6l12 12M18 6L6 18"/>',check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',back:'<path d="M14.5 6l-6 6 6 6"/>',
 overview:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9.5V8h2M17 14.5V16h-2"/>',
 follow:'<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
 close:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5M10.5 8v5"/>',
 sliders:'<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
 minus:'<path d="M6 12h12"/>',plus:'<path d="M12 6v12M6 12h12"/>',
 eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
 headphone:'<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
 cpu:'<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3"/>',
 user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
 key:'<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
 box:'<path d="M3 7.5l9-4.5 9 4.5-9 4.5z"/><path d="M3 7.5v9l9 4.5 9-4.5v-9M12 12v9"/>',
 prompt:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
 film:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4"/>',
 bolt:'<path d="M13 2.5L4.5 14H11l-1 7.5L19.5 10H13z"/>',
 steps:'<path d="M4 18h5v-5h5V8h6"/><circle cx="4" cy="18" r="1.2" fill="currentColor"/>',
 template:'<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
 list:'<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/>',
 warn:'<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.2v.1"/>',
 rec:'<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
 wand:'<path d="M4 20L15 9M14 4v3M19 9h-3M17.5 5.5l-2 2M18 14l-1-1"/>',
 trash:'<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
 lock:'<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
 search:'<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
 folder:'<path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
 layers:'<path d="M12 3.5l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
 history:'<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 3.8V9h5.2M12 8v4.5l3 2"/>',
 chat:'<path d="M5 18.5l-1.5 3 4-1.5h9a3.5 3.5 0 0 0 3.5-3.5v-8A3.5 3.5 0 0 0 16.5 5h-9A3.5 3.5 0 0 0 4 8.5v8a3.5 3.5 0 0 0 1 2z"/>',
 palette:'<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.9 1.2-1.8-.5-1-.1-2.2 1.1-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7.2" r="1.2" fill="currentColor"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor"/>',
 shield:'<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z"/><path d="M8.8 12l2.2 2.2 4.2-4.4"/>',
 split:'<path d="M12 3v18"/><rect x="3.5" y="6" width="6" height="12" rx="1.2"/><rect x="14.5" y="6" width="6" height="12" rx="1.2"/>',
 brand:'<path d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 6L12 16.7 6.7 19.6l1.1-6L3.4 9.5l6-.8z"/>',
 sparkle:'<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/>',
};
function ico(n,s=16){return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]||''}</svg>`}
function hydrate(root=document){$$('i[data-ico]',root).forEach(el=>{if(el._done)return;el.innerHTML=ico(el.dataset.ico,+el.dataset.s||16);el._done=1})}
const FONT_HUD='Bahnschrift,"Segoe UI","Microsoft YaHei UI",sans-serif',FONT_UI='"Microsoft YaHei UI","PingFang SC","Segoe UI",sans-serif',FONT_MONO='"Cascadia Mono",Consolas,monospace',FONT_KAI='STKaiti,KaiTi,SimSun,serif';
