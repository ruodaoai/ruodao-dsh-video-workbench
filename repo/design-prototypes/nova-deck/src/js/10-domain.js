/* ======================= domain constants ======================= */
const AG=[
 {id:'director',code:'01',name:'策划导演',en:'Director',col:'#E3ECFF',ang:247.5,role:'旗舰指挥艇 · 叙事 / 节拍 / 分镜'},
 {id:'editor',code:'02',name:'素材剪辑',en:'Editor',col:'#3BE7FF',ang:112.5,role:'牵引剪辑无人机 · 抓取 / 落位 / 调色'},
 {id:'audio',code:'03',name:'配音混音',en:'Audio',col:'#4DFFC3',ang:67.5,role:'声呐无人机 · 配音 / 音效 / 混音'},
 {id:'motion',code:'04',name:'动效编程',en:'Motion Coder',col:'#8C7CFF',ang:22.5,role:'编译穿梭机 · 逐镜动效编码'},
 {id:'qa',code:'05',name:'质检渲染',en:'QA · Render',col:'#FFB547',ang:337.5,role:'巡检无人机 · 渲染 / 响度 / 质检'},
 {id:'avatar',code:'06',name:'数字人',en:'Avatar',col:'#FF4FD8',ang:292.5,role:'全息投影艇 · 主播 / 克隆口型'},
 {id:'cloud',code:'07',name:'云端生成',en:'Cloud Gen',col:'#5AA9FF',ang:157.5,role:'云端补给艇 · 生图 / 生视频 / 配乐'},
 {id:'reference',code:'08',name:'参考复刻',en:'Reference',col:'#FF8A7A',ang:202.5,role:'侦察无人机 · 参考样片拆解'},
];
const AGM={};AG.forEach((a,i)=>{a.rgb=hexRgb(a.col);a.idx=i;a.rad=a.ang*Math.PI/180;AGM[a.id]=a});
/* agent status (BRIDGE) → visual class / chip */
const AST={
 idle:{t:'待命',cls:'idle',chip:''},queued:{t:'排队',cls:'wait',chip:''},running:{t:'运行',cls:'run',chip:'run'},
 paused:{t:'暂停',cls:'paused',chip:'paused'},done:{t:'完成',cls:'done',chip:'done'},failed:{t:'失败',cls:'err',chip:'err'},
 stopped:{t:'停止',cls:'stop',chip:'skip'},skipped:{t:'跳过',cls:'skip',chip:'skip'}};
const RUNST={
 queued:{t:'排队中',chip:'run'},running:{t:'运行中',chip:'run'},paused:{t:'已暂停',chip:'paused'},
 completed:{t:'成片就绪',chip:'done'},failed:{t:'执行失败',chip:'err'},stopped:{t:'已停止',chip:'skip'}};
const IDLE_TASK={director:'待命 · 等待出片指令',editor:'停靠 · 牵引光束就绪',audio:'停靠 · 声呐已校准',motion:'停靠 · 动效模板已加载',qa:'停靠 · 质检清单就绪',avatar:'待命 · 飞控面板可开启',cloud:'待命 · 云端补给就绪',reference:'待命 · 上传参考样片即可复刻'};
const PHASES=[
 {id:'director',n:'01',name:'策划导演',s2:'策划',en:'Directing'},
 {id:'editor',n:'02',name:'素材剪辑',s2:'剪辑',en:'Editing'},
 {id:'audio',n:'03',name:'配音混音',s2:'配音',en:'Audio Mix'},
 {id:'motion',n:'04',name:'动效编程',s2:'动效',en:'Motion Code'},
 {id:'qa',n:'05',name:'质检渲染',s2:'渲染',en:'QA · Render'},
];
const PHASE_OF={director:0,reference:0,editor:1,cloud:1,audio:2,avatar:3,motion:3,qa:4};
/* asset kinds (BRIDGE) → capsule look */
const TYPE={
 image:{n:'图片',en:'IMG',rgb:'90,169,255',ic:'image',f:'image'},
 video:{n:'视频',en:'VID',rgb:'255,138,122',ic:'video',f:'video'},
 host_video:{n:'真人视频',en:'CAM',rgb:'255,138,122',ic:'user',f:'video'},
 music:{n:'音乐',en:'BGM',rgb:'59,231,255',ic:'music',f:'audio'},
 sfx:{n:'音效',en:'SFX',rgb:'255,181,71',ic:'bolt',f:'audio'},
 voice:{n:'配音',en:'VOX',rgb:'77,255,195',ic:'voice',f:'audio'},
 note:{n:'笔记',en:'MD',rgb:'190,178,255',ic:'note',f:'other'},
 other:{n:'其他',en:'BIN',rgb:'166,181,218',ic:'box',f:'other'},
};
const typeOf=k=>TYPE[k]||TYPE.other;
const FILTERS=[['all','全部',null],['image','图片','image'],['video','视频','video'],['audio','音频','music'],['other','其他','note']];
const TRACKS=[{k:'shot',code:'V1',n:'镜头',en:'Shot',c:'#3BE7FF'},{k:'sub',code:'T1',n:'字幕',en:'Sub',c:'#E3ECFF'},{k:'vo',code:'A1',n:'配音',en:'Voice',c:'#4DFFC3'},{k:'sfx',code:'A2',n:'音效',en:'SFX',c:'#FFB547'},{k:'bgm',code:'A3',n:'配乐',en:'BGM',c:'#8FB4FF'}];
TRACKS.forEach(t=>t.rgb=hexRgb(t.c));
const TRK={};TRACKS.forEach(t=>TRK[t.k]=t);
const SCENE_COLS=['#3F6BFF','#3BE7FF','#9B7BFF','#5AA9FF','#4D8BFF'].map(hexRgb);
/* sfx type → lane (0 top … 1 bottom) + glyph */
function sfxLane(ty){ty=String(ty||'');if(/hit|impact|drop|crash|stamp|drum|counter/.test(ty))return .28;if(/whoosh|swoosh|slash|sweep|riser|suck/.test(ty))return .74;return .5}
function sfxGlyph(ty){ty=String(ty||'');if(/sub_drop|impact|crash|hit/.test(ty))return 'dia';if(/whoosh|swoosh|slash|sweep|suck/.test(ty))return 'line';if(/riser|swell|shimmer/.test(ty))return 'up';if(/pop|tick|counter|stamp|drum/.test(ty))return 'dot';return 'tri'}
const SFX_NAME={hit:'重击',shimmer_swell:'微光渐强',pop_soft:'轻弹',riser:'上升音',slash:'刀光',swoosh:'挥扫',whoosh:'呼啸',sub_drop:'低频坠落',crash_cym:'镲片',counter:'计数',tick:'滴答',stamp:'盖章',sparkle:'闪光',bell_warm:'暖铃',suck:'吸入',slash_sweep:'刀光横扫',heavy_impact:'重击',horse_gallop:'马蹄',war_drum:'战鼓',blade_whoosh:'刃风',metal_clash:'兵刃撞击',metal_clash_hi:'兵刃高频',metal_clash_heavy:'重兵撞击'};
const sfxName=t=>SFX_NAME[t]||String(t||'音效').replace(/_/g,' ');
/* style swatches for known style ids (labels come from options.styles) */
const STYLE_G={tech:'linear-gradient(135deg,#0a2a4a,#3BE7FF)',cinematic:'linear-gradient(135deg,#1a0c08,#c8452a 55%,#ffb047)',documentary:'linear-gradient(135deg,#1a1d24,#8a93a6)',energetic:'linear-gradient(135deg,#ff4fd8,#ffb547)',warm:'linear-gradient(135deg,#3a1d10,#f0a070)',emerald:'linear-gradient(135deg,#06201a,#2fbf8f 60%,#d9c27a)'};
STYLE_G.auto='linear-gradient(135deg,#3a1d8a,#5AA9FF 55%,#FFB547)';
const styleG=(id,i)=>STYLE_G[id]||['linear-gradient(135deg,#101a4a,#5AA9FF)','linear-gradient(135deg,#2a0f3a,#FF4FD8)','linear-gradient(135deg,#0a2a2a,#4DFFC3)','linear-gradient(135deg,#2a1a08,#FFB547)'][i%4];
const SKINS=[{id:'nova-deck',short:'A',name:'星舰剪辑甲板',en:'NOVA DECK',sw:'#3BE7FF'},{id:'ink-loom',short:'B',name:'墨韵织机',en:'INK LOOM',sw:'#D4A64A'},{id:'prism-lab',short:'C',name:'棱镜实验室',en:'PRISM LAB',sw:'#2F37FF'}];
/* status chips → native kit panels (KIT.md panel ids) */
const STATUS_DEF=[
 {k:'llm',n:'大模型',short:'LLM',panel:'keys',args:{tab:'llm'}},{k:'tts',n:'配音引擎',short:'TTS',panel:'keys',args:{tab:'tts'}},
 {k:'gpu',n:'算力',short:'GPU',panel:'hardware',args:{}},{k:'lipsync',n:'口型引擎',short:'口型',panel:'avatar',args:{}}];
/* 舰务工具 · settings popover (prototype SETTINGS list) → native kit panels */
const SETTINGS=[
 ['hardware','cpu','算力体检','体检 · 低配'],['voices','voice','配音中心','音色库'],['cloud','cloud','云端媒体中心','BYOK'],
 ['avatar','user','数字人克隆','口型'],['teleprompter','prompt','提词器真人录制',''],['reference','split','参考视频复刻对比','分屏'],['-'],
 ['brand','brand','品牌套件',''],['export','box','发布包导出',''],['history','history','版本历史 · 工程安全',''],['-'],
 ['keys','key','LLM / TTS / 云端密钥','']];
