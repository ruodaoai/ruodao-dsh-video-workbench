import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {AppWindow, FocusShot, FONT_SANS, FONT_MONO} from '../lib/shotcraft';

const C = {bg: '#050608', panel: '#10141E', white: '#F1F5F9', muted: '#94A3B8', blue: '#2F7BFF', ice: '#7DB2FF', gold: '#F5B92E'};
const clamp = (v: number): number => Math.max(0, Math.min(1, v));
const ease = (v: number): number => {const t = clamp(v); return 1 - Math.pow(1 - t, 3);};
const phase = (p: number, a: number, b: number): number => ease((p - a) / (b - a));

function useMotion(scene: any): {frame: number; fps: number; p: number; pulse: number} {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const duration = Math.max(2, Number(scene.durationInFrames) || 107);
  const p = clamp(frame / (duration - 1));
  const beatPosition = ((frame / fps + Number(scene.startSec || 0)) * 118 / 60) % 1;
  return {frame, fps, p, pulse: Math.exp(-beatPosition * 11)};
}

const fixedCams: Array<{t: number; fx: number; fy: number; z: number}> = [
  {t: 0, fx: 0.5, fy: 0.5, z: 1},
  {t: 1, fx: 0.5, fy: 0.5, z: 1},
];

function WorkbenchShot({scene, top, height, p, pulse}: {scene: any; top: number; height: number; p: number; pulse: number}): React.ReactElement | null {
  const src: string | undefined = scene.publicAssetFiles?.[0] || scene.assetPaths?.[0] || scene.media?.[0]?.path;
  if (typeof src !== 'string' || src.trim().length === 0) return null;
  return <div style={{position: 'absolute', left: 56, top: top - 5 * ease(p), width: 840, height, transform: `scale(${0.996 + 0.004 * ease(p)})`, transformOrigin: '50% 50%', boxShadow: `0 18px 75px rgba(47,123,255,${0.13 + pulse * 0.08})`}}>
    <AppWindow title={scene.title} kicker="DSH WORKBENCH" style={{width: '100%', height}}>
      <FocusShot src={src} cams={fixedCams} marks={scene.marks} />
    </AppWindow>
  </div>;
}

const Scene_scene_13: React.FC<CustomSceneProps> = ({scene, idx}: CustomSceneProps) => {
  const {frame, p, pulse} = useMotion(scene);
  const key = `voice13-${idx}`;
  const steps: Array<{x: number; title: string; sub: string; start: number}> = [
    {x: 78, title: '录制或上传', sub: 'YOUR VOICE', start: 0.04},
    {x: 360, title: '声音克隆', sub: 'VOICE CLONE', start: 0.29},
    {x: 642, title: '试听确认', sub: 'LISTEN & CHECK', start: 0.58},
  ];
  return <AbsoluteFill style={{backgroundColor: C.bg, fontFamily: FONT_SANS, overflow: 'hidden'}}>
    <svg width="1080" height="1920" viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
      <defs>
        <radialGradient id={`${key}-halo`}><stop stopColor={C.blue} stopOpacity="0.3"/><stop offset="1" stopColor={C.bg} stopOpacity="0"/></radialGradient>
        <linearGradient id={`${key}-rail`} x1="0" x2="1"><stop stopColor={C.blue}/><stop offset="1" stopColor={C.ice}/></linearGradient>
      </defs>
      <ellipse cx={470 + 35 * p} cy={690 - 40 * p} rx={650 + pulse * 15} ry="760" fill={`url(#${key}-halo)`}/>
      {Array.from({length: 13}, (_: unknown, i: number) => <path key={i} d={`M ${-250 + i * 150 + (frame * 0.65) % 150} 190 L ${-850 + i * 150 + (frame * 0.65) % 150} 1620`} stroke={C.ice} strokeOpacity="0.055" strokeWidth="1"/>)}
      {Array.from({length: 22}, (_: unknown, i: number) => {
        const x = 60 + ((i * 137 + frame * (0.4 + i % 3 * 0.15)) % 820);
        const y = 300 + ((i * 173 + frame * 1.5) % 1110);
        return <circle key={i} cx={x} cy={y} r={i % 4 === 0 ? 2.6 : 1.3} fill={C.ice} opacity={0.15 + 0.22 * Math.sin(i + frame / 17) ** 2}/>;
      })}
      <g transform={`translate(0 ${12 * (1 - ease(p / 0.18))})`}>
        <text x="64" y="246" fill={C.ice} fontSize="20" fontFamily={FONT_MONO} letterSpacing="4">VOICE LAB / 03 STEPS</text>
        <text x="60" y="317" fill={C.white} fontSize="57" fontWeight="800">个人声音，三步进入制作</text>
        <text x="64" y="367" fill={C.muted} fontSize="25">从声音样本，到你的个人声音分身</text>
        <g transform="translate(770 345)">
          {Array.from({length: 17}, (_: unknown, i: number) => <rect key={i} x={i * 7} y={-8 - Math.abs(Math.sin(frame * 0.15 + i * 0.7)) * 15} width="3" height={8 + Math.abs(Math.sin(frame * 0.15 + i * 0.7)) * 27} rx="1.5" fill={C.ice}/>)}
        </g>
      </g>
      <path d="M 77 1168 H 875" fill="none" stroke="#223047" strokeWidth="2"/>
      <path d="M 77 1168 H 875" fill="none" stroke={`url(#${key}-rail)`} strokeWidth={2 + pulse} pathLength="1" strokeDasharray="1" strokeDashoffset={1 - phase(p, 0.03, 0.8)}/>
      {steps.map((s: {x: number; title: string; sub: string; start: number}, i: number) => {
        const on = phase(p, s.start, s.start + 0.18);
        return <g key={s.title} transform={`translate(${s.x} ${1194 + (1 - on) * 12})`}>
          <rect width="242" height="122" rx="17" fill={C.panel} stroke={on > 0.5 ? C.ice : '#293348'} strokeOpacity={0.4 + on * 0.6}/>
          <rect width={4 + on * 42} height="4" x="18" y="0" rx="2" fill={C.ice} opacity={0.35 + on * 0.65}/>
          <text x="20" y="33" fill={C.ice} fontFamily={FONT_MONO} fontSize="18">0{i + 1}</text>
          <text x="20" y="70" fill={C.white} fontSize="29" fontWeight="700">{s.title}</text>
          <text x="20" y="99" fill={C.muted} fontFamily={FONT_MONO} fontSize="13" letterSpacing="1">{s.sub}</text>
          <circle cx="214" cy="29" r={7 + on * 2 + pulse * on} fill={on > 0.7 ? C.ice : '#344155'}/>
          {i < 2 && <path d="M 253 61 H 273 M 266 55 L 273 61 L 266 67" fill="none" stroke={C.ice} strokeWidth="2" opacity={0.2 + on * 0.8}/>}
        </g>;
      })}
      <g opacity={0.35 + phase(p, 0.21, 0.48) * 0.65}>
        <circle cx="478" cy="1155" r="17" fill={C.bg} stroke={C.ice} strokeWidth="2"/>
        <circle cx="475" cy="1152" r="6" fill="none" stroke={C.ice} strokeWidth="2"/>
        <path d="M 480 1157 L 487 1164 M 478 1173 V 1185" stroke={C.ice} strokeWidth="2"/>
      </g>
      <g transform="translate(78 1355)">
        <path d="M 0 0 L 12 -5 L 24 0 V 14 Q 12 27 0 14 Z" fill="none" stroke={C.gold} strokeWidth="2"/>
        <path d="M 6 9 L 11 14 L 19 5" fill="none" stroke={C.gold} strokeWidth="2"/>
        <text x="39" y="7" fill={C.gold} fontSize="22" fontWeight="700">仅使用本人或已获授权声音</text>
        <text x="39" y="37" fill={C.muted} fontSize="20">禁止伪造身份 · 克隆后请先试听确认</text>
      </g>
    </svg>
    <WorkbenchShot scene={scene} top={412} height={720} p={p} pulse={pulse}/>
  </AbsoluteFill>;
};

const Scene_scene_14: React.FC<CustomSceneProps> = ({scene, idx}: CustomSceneProps) => {
  const {frame, p, pulse} = useMotion(scene);
  const key = `alpha14-${idx}`;
  const reveal = phase(p, 0.18, 0.74);
  const split = 102 + reveal * 698;
  return <AbsoluteFill style={{backgroundColor: C.bg, fontFamily: FONT_SANS, overflow: 'hidden'}}>
    <svg width="1080" height="1920" viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
      <defs>
        <linearGradient id={`${key}-light`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={C.blue} stopOpacity="0"/><stop offset="0.5" stopColor={C.blue} stopOpacity="0.22"/><stop offset="1" stopColor={C.ice} stopOpacity="0"/></linearGradient>
        <linearGradient id={`${key}-person`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#D9EAFF"/><stop offset="0.45" stopColor={C.ice}/><stop offset="1" stopColor={C.blue}/></linearGradient>
        <pattern id={`${key}-checker`} width="28" height="28" patternUnits="userSpaceOnUse"><rect width="28" height="28" fill="#101724"/><path d="M 0 0 H 14 V 14 H 0 Z M 14 14 H 28 V 28 H 14 Z" fill="#263246"/></pattern>
        <clipPath id={`${key}-demo`}><rect x="77" y="1180" width="796" height="166" rx="13"/></clipPath>
        <clipPath id={`${key}-wipe`}><rect x="77" y="1180" width={Math.max(0, split - 77)} height="166"/></clipPath>
      </defs>
      <path d={`M ${650 + p * 100} 0 L 1080 0 L 1080 1700 L ${140 + p * 100} 1700 Z`} fill={`url(#${key}-light)`}/>
      {Array.from({length: 9}, (_: unknown, i: number) => <path key={i} d={`M ${50 + i * 150 - frame * 0.7} 210 L ${-250 + i * 150 - frame * 0.7} 1440`} fill="none" stroke={C.ice} strokeOpacity="0.075"/>)}
      {Array.from({length: 16}, (_: unknown, i: number) => <rect key={i} x={70 + (i * 197) % 815} y={240 + ((i * 113 + frame * 1.4) % 1160)} width={i % 3 === 0 ? 15 : 3} height="3" fill={C.ice} opacity={0.12 + 0.2 * Math.sin(frame * 0.04 + i) ** 2}/>)}
      <text x="64" y="246" fill={C.ice} fontSize="20" fontFamily={FONT_MONO} letterSpacing="4">ALPHA / LAYER COMPOSITING</text>
      <text x="60" y="316" fill={C.white} fontSize="57" fontWeight="800">透明数字人，进入你的画面</text>
      <text x="64" y="366" fill={C.muted} fontSize="25">透明 WebM · 保留人物，透出背景</text>
      <path d="M 78 1130 H 205 M 78 1123 V 1137" fill="none" stroke={C.ice} strokeWidth="2"/>
      <circle cx="222" cy="1130" r="12" fill="none" stroke={C.ice} strokeWidth="2"/>
      <path d="M 230 1138 L 239 1147" stroke={C.ice} strokeWidth="2"/>
      <text x="254" y="1138" fill={C.ice} fontSize="22" fontWeight="700">透明 WebM 数字人设置</text>
      <text x="78" y="1170" fill={C.muted} fontSize="18">透明合成原理示意 · 抽象轮廓，非实拍素材</text>
      <g clipPath={`url(#${key}-demo)`}>
        <rect x="77" y="1180" width="796" height="166" fill={`url(#${key}-checker)`}/>
        <g clipPath={`url(#${key}-wipe)`}>
          <rect x="77" y="1180" width="796" height="166" fill="#102541"/>
          {Array.from({length: 12}, (_: unknown, i: number) => <path key={i} d={`M ${-100 + i * 100 + frame * 1.4 % 100} 1180 L ${-200 + i * 100 + frame * 1.4 % 100} 1346`} stroke={C.blue} strokeWidth="2" opacity="0.38"/>)}
          <circle cx={675 + 30 * Math.sin(frame / 25)} cy="1260" r={50 + pulse * 7} fill="none" stroke={C.ice} strokeOpacity="0.3"/>
        </g>
        <g transform={`translate(${466 + Math.sin(frame / 23) * 3} ${1214 - Math.sin(frame / 19) * 2})`}>
          <ellipse cx="0" cy="123" rx="87" ry="8" fill={C.blue} opacity="0.23"/>
          <circle cx="0" cy="7" r="24" fill={`url(#${key}-person)`}/>
          <path d="M -20 38 Q -59 42 -70 83 L -79 120 H 79 L 70 83 Q 59 42 20 38 L 17 29 H -17 Z" fill={`url(#${key}-person)`}/>
          <path d="M -40 61 Q 0 87 40 61 M 0 52 V 118" fill="none" stroke="#E7F2FF" strokeOpacity="0.45" strokeWidth="2"/>
          <circle cx="0" cy="7" r={30 + pulse * 3} fill="none" stroke={C.ice} strokeOpacity="0.3"/>
        </g>
        <line x1={split} y1="1180" x2={split} y2="1346" stroke={C.ice} strokeWidth="3"/>
        <circle cx={split} cy="1193" r="5" fill={C.white}/>
        <text x="96" y="1210" fill={C.white} fontFamily={FONT_MONO} fontSize="17">BACKGROUND</text>
        <text x="690" y="1327" fill={C.white} fontFamily={FONT_MONO} fontSize="17">α = 0 → 1</text>
      </g>
      <rect x="77" y="1180" width="796" height="166" rx="13" fill="none" stroke="#344B6A"/>
      <text x="78" y="1393" fill={C.ice} fontSize="23" fontFamily={FONT_MONO}>C = α · 人物 + (1 − α) · 背景</text>
    </svg>
    <WorkbenchShot scene={scene} top={398} height={704} p={p} pulse={pulse}/>
  </AbsoluteFill>;
};

const Scene_scene_15: React.FC<CustomSceneProps> = ({scene, idx}: CustomSceneProps) => {
  const {frame, p, pulse} = useMotion(scene);
  const key = `timing15-${idx}`;
  const generate = phase(p, 0.01, 0.26);
  const probe = phase(p, 0.2, 0.53);
  const refill = phase(p, 0.48, 0.84);
  const lock = phase(p, 0.74, 0.96);
  const displayedTime = (2.08 * probe).toFixed(2);
  const displayedFrames = Math.round(63 * refill);
  const samples: Array<{label: string; duration: string; frames: number; x: number; width: number}> = [
    {label: '01', duration: '1.24', frames: 38, x: 108, width: 179},
    {label: '02', duration: '2.08', frames: 63, x: 299, width: 297},
    {label: '03', duration: '1.67', frames: 51, x: 608, width: 240},
  ];
  return <AbsoluteFill style={{backgroundColor: C.bg, fontFamily: FONT_SANS, overflow: 'hidden'}}>
    <svg width="1080" height="1920" viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}}>
      <defs>
        <radialGradient id={`${key}-energy`}><stop stopColor={C.blue} stopOpacity="0.3"/><stop offset="1" stopColor={C.bg} stopOpacity="0"/></radialGradient>
        <linearGradient id={`${key}-flow`} x1="0" y1="0" x2="0" y2="1"><stop stopColor={C.ice}/><stop offset="1" stopColor={C.blue}/></linearGradient>
        <clipPath id={`${key}-wave`}><rect x="112" y="510" width={690 * generate} height="112"/></clipPath>
        <clipPath id={`${key}-measure`}><rect x="108" y="731" width="740" height="235" rx="21"/></clipPath>
      </defs>
      <ellipse cx={485 + p * 32} cy="835" rx={590 + pulse * 18} ry="750" fill={`url(#${key}-energy)`}/>
      {Array.from({length: 18}, (_: unknown, i: number) => <path key={i} d={`M 48 ${240 + i * 70 + frame * 0.35 % 70} H 899`} stroke={C.ice} strokeOpacity={i % 3 === 0 ? 0.075 : 0.035}/>)}
      {Array.from({length: 12}, (_: unknown, i: number) => <path key={i} d={`M ${50 + i * 78} 225 V 1440`} stroke={C.ice} strokeOpacity="0.035"/>)}
      {Array.from({length: 25}, (_: unknown, i: number) => <circle key={i} cx={70 + ((i * 193 + frame * 0.6) % 810)} cy={380 + ((i * 89 - frame * 2 + 1080) % 1030)} r={i % 5 === 0 ? 2.7 : 1.3} fill={i % 5 === 0 ? C.gold : C.ice} opacity={0.12 + pulse * 0.22}/>)}
      <text x="64" y="246" fill={C.ice} fontSize="20" fontFamily={FONT_MONO} letterSpacing="4">AUDIO FIRST / FRAME ACCURATE</text>
      <text x="60" y="316" fill={C.white} fontSize="57" fontWeight="800">先测声音，再填画面帧数</text>
      <text x="64" y="368" fill={C.muted} fontSize="25">逐句生成 → 实测时长 → 回填镜头</text>
      <g transform={`translate(${480 * (1 - (1 + 0.008 * p))} ${-4 * p}) scale(${1 + 0.008 * p})`}>
        <text x="108" y="456" fill={C.white} fontSize="29" fontWeight="700">IndexTTS-2.5</text>
        <text x="625" y="456" fill={C.muted} fontFamily={FONT_MONO} fontSize="18">SENTENCE AUDIO</text>
        <path d="M 108 485 H 848" stroke="#2A3C57" strokeWidth="1"/>
        <g clipPath={`url(#${key}-wave)`}>
          {Array.from({length: 86}, (_: unknown, i: number) => {
            const amplitude = 8 + 39 * Math.abs(Math.sin(i * 0.67)) * (0.42 + 0.58 * Math.sin(i * 0.19 + frame * 0.045) ** 2);
            return <rect key={i} x={114 + i * 8} y={565 - amplitude} width="4" height={amplitude * 2} rx="2" fill={i < 33 ? C.ice : i < 64 ? C.blue : C.ice}/>;
          })}
        </g>
        <text x="110" y="643" fill={C.muted} fontSize="18" fontFamily={FONT_MONO}>WAV 01</text>
        <text x="365" y="643" fill={C.muted} fontSize="18" fontFamily={FONT_MONO}>WAV 02</text>
        <text x="646" y="643" fill={C.muted} fontSize="18" fontFamily={FONT_MONO}>WAV 03</text>
        <path d="M 478 661 V 711 M 465 698 L 478 711 L 491 698" fill="none" stroke="#2C415D" strokeWidth="3"/>
        <path d="M 478 661 V 711 M 465 698 L 478 711 L 491 698" fill="none" stroke={C.ice} strokeWidth="3" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - probe}/>
        <rect x="108" y="731" width="740" height="235" rx="21" fill="#0B1220" stroke={C.ice} strokeOpacity={0.3 + probe * 0.5}/>
        <g clipPath={`url(#${key}-measure)`}>
          <rect x={80 + probe * 730 + Math.sin(frame * 0.08) * 12} y="731" width="45" height="235" fill={C.ice} opacity="0.06"/>
          <text x="137" y="776" fill={C.ice} fontFamily={FONT_MONO} fontSize="23">ffprobe</text>
          <text x="137" y="808" fill={C.muted} fontSize="18">读取音频实际时长</text>
          <text x="134" y="911" fill={C.white} fontSize="91" fontWeight="800" fontFamily={FONT_MONO}>{displayedTime}<tspan fontSize="31" fill={C.ice}> s</tspan></text>
          <path d="M 473 790 V 924" stroke="#2B3A51"/>
          <text x="505" y="781" fill={C.muted} fontSize="17" fontFamily={FONT_MONO}>EXAMPLE / 30 FPS</text>
          <text x="505" y="828" fill={C.ice} fontSize="23" fontFamily={FONT_MONO}>ceil(2.08 × 30)</text>
          <text x="505" y="912" fill={C.white} fontSize="73" fontWeight="800" fontFamily={FONT_MONO}>{displayedFrames}<tspan fill={C.ice} fontSize="23"> 帧</tspan></text>
          <path d="M 108 964 H 848" stroke={C.blue} strokeWidth={4 + pulse * 2}/>
        </g>
        <path d="M 478 981 V 1017 M 466 1005 L 478 1017 L 490 1005" stroke={C.ice} strokeWidth="3" fill="none" opacity={0.2 + refill * 0.8}/>
        <text x="108" y="1059" fill={C.white} fontSize="26" fontWeight="700">回填镜头</text>
        <text x="267" y="1059" fill={C.ice} fontSize="21" fontFamily={FONT_MONO}>durationInFrames</text>
        <text x="108" y="1093" fill={C.muted} fontSize="17">示例数据 · 每句独立测时，不依赖估算语速</text>
        {samples.map((s: {label: string; duration: string; frames: number; x: number; width: number}, i: number) => {
          const on = phase(p, 0.47 + i * 0.065, 0.71 + i * 0.065);
          const bars = Math.max(1, Math.floor(s.width / 15));
          return <g key={s.label} opacity={0.22 + on * 0.78}>
            <rect x={s.x} y="1120" width={s.width} height="69" rx="7" fill="#142B4C" stroke={C.ice} strokeOpacity="0.7"/>
            {Array.from({length: bars}, (_: unknown, j: number) => <path key={j} d={`M ${s.x + 10 + j * 15} 1131 V 1176`} stroke={C.ice} strokeOpacity={j / bars < on ? 0.28 : 0.05}/>)}
            <text x={s.x + 13} y="1164" fill={C.white} fontFamily={FONT_MONO} fontSize="23" fontWeight="700">{s.frames} f</text>
            <rect x={s.x} y="1202" width={s.width - 5} height="48" rx="6" fill="#182436"/>
            {Array.from({length: bars}, (_: unknown, j: number) => {
              const h = 5 + Math.abs(Math.sin(j * 1.2 + i * 3)) * 22;
              return <rect key={j} x={s.x + 8 + j * 15} y={1226 - h / 2} width="3" height={h} rx="1" fill={C.ice}/>;
            })}
            <rect x={s.x + s.width - 5} y="1202" width="5" height="48" fill={C.gold} opacity={lock}/>
            <text x={s.x + 10} y="1281" fill={C.muted} fontFamily={FONT_MONO} fontSize="18">{s.duration} s</text>
            <line x1={s.x + s.width} y1="1108" x2={s.x + s.width} y2="1260" stroke={C.gold} strokeWidth="2" strokeDasharray="5 5" opacity={lock}/>
          </g>;
        })}
        <g opacity={0.3 + lock * 0.7}>
          <path d="M 825 1292 V 1301 Q 825 1313 812 1313 H 578" fill="none" stroke={C.gold} strokeWidth="2"/>
          <text x="110" y="1330" fill={C.ice} fontFamily={FONT_MONO} fontSize="26">N = ceil(t × fps)</text>
          <text x="505" y="1344" fill={C.gold} fontSize="21" fontWeight="700">向上取整 · 末帧补齐</text>
        </g>
        <text x="110" y="1393" fill={C.muted} fontSize="19">取整差小于 1 帧；示意对齐机制，并非零误差实测报告</text>
      </g>
      <circle cx={108 + 740 * ((frame * 0.013) % 1)} cy="1424" r={3 + pulse * 2} fill={C.ice}/>
      <path d="M 108 1424 H 848" stroke={C.blue} strokeOpacity="0.3"/>
    </svg>
  </AbsoluteFill>;
};

export interface CustomSceneProps { scene: any; idx: number; total: number; beats: any[]; }
export const BATCH_05_SCENES: Record<string, React.FC<CustomSceneProps>> = {
  'scene-13': Scene_scene_13,
  'scene-14': Scene_scene_14,
  'scene-15': Scene_scene_15
};
