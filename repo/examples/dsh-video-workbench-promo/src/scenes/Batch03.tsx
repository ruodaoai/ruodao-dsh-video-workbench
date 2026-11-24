import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_SANS, FONT_MONO} from '../lib/shotcraft';

const C = {
  bg: '#050608',
  panel: '#10141E',
  white: '#F1F5F9',
  muted: '#94A3B8',
  blue: '#2F7BFF',
  ice: '#7DB2FF',
  gold: '#F5B92E',
};
const clamp = (v: number): number => Math.min(1, Math.max(0, v));
const ramp = (p: number, a: number, b: number): number => clamp((p - a) / (b - a));
const ease = (v: number): number => 1 - Math.pow(1 - clamp(v), 3);
const indices = (n: number): number[] => Array.from({length: n}, (_: unknown, i: number): number => i);

function useMotion(scene: any, beats: any[]): {f: number; p: number; pulse: number; fps: number} {
  const rawFrame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const duration = Math.max(2, Number(scene?.durationInFrames) || 107);
  const f = Math.max(0, Math.min(duration - 1, rawFrame));
  const p = f / (duration - 1);
  const beatFrames = fps * 60 / 118;
  let pulse = Math.exp(-((f % beatFrames) / 3.6));
  beats.forEach((beat: any): void => {
    const seconds: unknown = typeof beat === 'number' ? beat : beat?.timeSec ?? beat?.time;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return;
    const local = (seconds - (Number(scene?.startSec) || 0)) * fps;
    const age = f - local;
    if (age >= 0 && age < 14) pulse = Math.max(pulse, Math.exp(-age / 3.6));
  });
  return {f, p, pulse, fps};
}

const SpaceField: React.FC<{f: number; variant: number}> = ({f, variant}) => (
  <g pointerEvents="none">
    {indices(13).map((i: number) => (
      <path key={`grid-${i}`} d={`M ${70 + i * 78} 225 V 1460`} stroke={C.ice} strokeWidth="1" opacity={i % 3 === 0 ? 0.065 : 0.027}/>
    ))}
    {indices(17).map((i: number) => (
      <path key={`row-${i}`} d={`M 40 ${230 + i * 76} H 1040`} stroke={C.ice} strokeWidth="1" opacity="0.035"/>
    ))}
    {indices(34).map((i: number) => {
      const x = 60 + ((i * 137 + f * (0.55 + (i % 4) * 0.22) + variant * 31) % 950);
      const y = 250 + ((i * 191 + variant * 73 - f * (0.6 + (i % 3) * 0.3) + 4000) % 1170);
      return <circle key={`dust-${i}`} cx={x} cy={y} r={i % 7 === 0 ? 2.4 : 1.2} fill={i % 6 === 0 ? C.gold : C.ice} opacity={0.15 + 0.17 * Math.sin(i + f * 0.055) ** 2}/>;
    })}
  </g>
);

const Scene_scene_07: React.FC<CustomSceneProps> = ({scene, idx, beats}) => {
  const {f, p, pulse} = useMotion(scene, beats);
  const reveal = ease(ramp(p, 0, 0.18));
  const sync = ease(ramp(p, 0.25, 0.65));
  const out = ease(ramp(p, 0.58, 0.9));
  const theta = f * 0.057;
  const frameLabel = String(Math.floor(f)).padStart(3, '0');
  const zoom = 1 + p * 0.022 + pulse * 0.004;
  const engines: {x: number; title: string; sub: string; color: string; tag: string}[] = [
    {x: 90, title: 'Remotion 4.x', sub: 'React TSX', color: C.ice, tag: 'ENGINE A'},
    {x: 510, title: 'HTML5', sub: 'GSAP / Canvas', color: C.gold, tag: 'ENGINE B'},
  ];
  return (
    <AbsoluteFill style={{backgroundColor: C.bg, fontFamily: FONT_SANS}}>
      <svg width="1080" height="1920" viewBox="0 0 1080 1920" role="img" aria-label="双引擎同步逐帧渲染架构示意">
        <defs>
          <radialGradient id={`s07-bg-${idx}`} cx="48%" cy="39%" r="65%"><stop offset="0" stopColor="#102C55"/><stop offset="0.62" stopColor="#080F1C"/><stop offset="1" stopColor={C.bg}/></radialGradient>
          <linearGradient id={`s07-flow-${idx}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={C.ice}/><stop offset="0.52" stopColor={C.blue}/><stop offset="1" stopColor={C.gold}/></linearGradient>
          <filter id={`s07-glow-${idx}`} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7"/></filter>
          <clipPath id={`s07-reveal-${idx}`}><rect x="75" y="490" width={810 * reveal} height="900"/></clipPath>
        </defs>
        <rect width="1080" height="1920" fill={`url(#s07-bg-${idx})`}/>
        <SpaceField f={f} variant={7}/>
        <g fontFamily={FONT_SANS}>
          <text x="90" y="258" fill={C.ice} fontFamily={FONT_MONO} fontSize="22" letterSpacing="4">DSH / DUAL RENDER ENGINES</text>
          <text x="85" y="345" fill={C.white} fontSize="70" fontWeight="900">双引擎，</text>
          <text x="85" y="429" fill={C.white} fontSize="70" fontWeight="900">不是<tspan fill={C.ice}>双份录像</tspan></text>
          <path d={`M 90 460 H ${90 + 780 * reveal}`} stroke={C.ice} strokeWidth="3"/>
        </g>
        <g transform={`translate(480 920) scale(${zoom}) translate(-480 -920)`} clipPath={`url(#s07-reveal-${idx})`}>
          {engines.map((engine: {x: number; title: string; sub: string; color: string; tag: string}, i: number) => (
            <g key={engine.tag} transform={`translate(${engine.x} ${520 + (1 - reveal) * (i === 0 ? 32 : 58)})`}>
              <rect width="360" height="548" rx="22" fill={C.panel} stroke={engine.color} strokeOpacity={0.4 + pulse * 0.3} strokeWidth="2"/>
              <path d="M 22 0 H 108 M 0 22 V 105 M 252 548 H 338 M 360 443 V 526" fill="none" stroke={engine.color} strokeWidth="4"/>
              <text x="26" y="41" fill={engine.color} fontFamily={FONT_MONO} fontSize="19" letterSpacing="2">{engine.tag}</text>
              <circle cx="324" cy="34" r={4 + pulse * 2} fill={engine.color}/>
              <text x="26" y="92" fill={C.white} fontSize="34" fontWeight="800">{engine.title}</text>
              <text x="26" y="130" fill={C.muted} fontFamily={FONT_MONO} fontSize="24">{engine.sub}</text>
              <path d="M 24 155 H 336" stroke={engine.color} strokeOpacity="0.23"/>
              <g transform="translate(180 310)">
                <circle r="116" fill="#070C15" stroke={engine.color} strokeOpacity="0.18"/>
                <ellipse rx="125" ry="43" fill="none" stroke={engine.color} strokeOpacity="0.3" transform={`rotate(${theta * 17})`}/>
                <ellipse rx="125" ry="43" fill="none" stroke={engine.color} strokeOpacity="0.18" transform={`rotate(${60 + theta * 17})`}/>
                <circle r={87 + pulse * 6} fill="none" stroke={engine.color} opacity="0.12" strokeWidth="10"/>
                <g transform={`rotate(${theta * 45}) scale(${0.91 + 0.09 * Math.sin(theta * 2)})`}>
                  <path d="M 0 -78 L 68 -39 L 68 39 L 0 78 L -68 39 L -68 -39 Z" fill={engine.color} fillOpacity="0.1" stroke={engine.color} strokeWidth="3"/>
                  <path d="M 0 -78 V 0 M 68 39 L 0 0 L -68 39 M 0 0 L 68 -39 M 0 0 L -68 -39 M 0 0 V 78" fill="none" stroke={engine.color} strokeOpacity="0.5" strokeWidth="2"/>
                  <circle r={15 + 4 * pulse} fill={engine.color}/>
                </g>
                {indices(3).map((j: number) => {
                  const a = theta + j * Math.PI * 2 / 3;
                  return <circle key={j} cx={Math.cos(a) * 116} cy={Math.sin(a) * 116} r="5" fill={engine.color}/>;
                })}
              </g>
              <path d="M 26 459 H 334" stroke={engine.color} strokeOpacity="0.22"/>
              <text x="26" y="498" fill={C.muted} fontFamily={FONT_MONO} fontSize="20">FRAME</text>
              <text x="333" y="502" textAnchor="end" fill={engine.color} fontFamily={FONT_MONO} fontSize="37" fontWeight="800">{frameLabel}</text>
              <rect x="26" y="522" width={308 * p} height="4" rx="2" fill={engine.color}/>
            </g>
          ))}
          <path d="M 450 794 H 510" stroke={C.ice} strokeWidth="2" strokeDasharray="4 5" strokeDashoffset={-f * 2}/>
          <circle cx="480" cy="794" r={8 + pulse * 3} fill={C.white}/>
          <path d="M 270 1070 V 1110 H 690 V 1070" fill="none" stroke={`url(#s07-flow-${idx})`} strokeWidth="3" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - sync}/>
          <text x="480" y="1157" textAnchor="middle" fill={C.ice} fontFamily={FONT_MONO} fontSize="21" letterSpacing="2">SAME FRAME / SAME GEOMETRY</text>
          <g transform="translate(108 1180)">
            {indices(12).map((i: number) => {
              const active = Math.floor(f / 3) % 12 === i;
              return <g key={i} transform={`translate(${i * 63} 0)`}><rect width="53" height="54" rx="5" fill={active ? C.ice : '#111F32'} stroke={C.ice} strokeOpacity={active ? 1 : 0.25}/><text x="26.5" y="34" fill={active ? C.bg : C.muted} fontFamily={FONT_MONO} fontSize="18" textAnchor="middle">{String(Math.max(0, Math.floor(f) - 5 + i)).padStart(3, '0')}</text></g>;
            })}
          </g>
          <path d="M 480 1248 V 1287" stroke={C.ice} strokeWidth="3" strokeDasharray="5 7" strokeDashoffset={-f * 2}/>
          <g opacity={out} transform={`translate(0 ${(1 - out) * 22})`}>
            <rect x="180" y="1290" width="600" height="88" rx="15" fill="#112542" stroke={C.ice} strokeOpacity="0.6"/>
            <path d="M 211 1317 L 211 1351 L 239 1334 Z" fill={C.ice}/>
            <text x="273" y="1347" fill={C.white} fontSize="35" fontWeight="800">统一视频输出</text>
            <text x="744" y="1343" textAnchor="end" fill={C.gold} fontSize="25" fontWeight="700">非录屏</text>
          </g>
        </g>
        <path d={`M ${-400 + p * 1800} 490 l 190 -50`} stroke={C.ice} strokeWidth="2" opacity={0.1 + pulse * 0.12}/>
        <text x="90" y="1432" fill={C.muted} fontFamily={FONT_MONO} fontSize="19">渲染机制示意 · 不涉及性能对比</text>
      </svg>
    </AbsoluteFill>
  );
};

const Scene_scene_08: React.FC<CustomSceneProps> = ({scene, idx, beats}) => {
  const {f, p, pulse} = useMotion(scene, beats);
  const codeReveal = ease(ramp(p, 0.08, 0.54));
  const dispatch = ramp(p, 0, 0.45);
  const codeLines: {text: string; color: string}[] = [
    {text: 'const frame = useCurrentFrame();', color: C.ice},
    {text: 'const t = frame / duration;', color: C.muted},
    {text: 'return <svg viewBox="0 0 1080 1920">', color: C.gold},
    {text: '  <path d={curve(t)} />', color: C.ice},
    {text: '  <g transform={pose(t)} />', color: C.ice},
    {text: '</svg>;', color: C.gold},
  ];
  const previews: {x: number; label: string; sub: string; start: number; color: string}[] = [
    {x: 90, label: 'SVG 曲线', sub: 'PATH / DRAW', start: 0.23, color: C.ice},
    {x: 360, label: 'UI 动画', sub: 'STATE / FLOW', start: 0.4, color: C.gold},
    {x: 630, label: '粒子动效', sub: 'FIELD / MOVE', start: 0.57, color: '#A9C8FF'},
  ];
  return (
    <AbsoluteFill style={{backgroundColor: C.bg, fontFamily: FONT_SANS}}>
      <svg width="1080" height="1920" viewBox="0 0 1080 1920" role="img" aria-label="按批次调用模型逐镜手写动画代码机制示意">
        <defs>
          <radialGradient id={`s08-bg-${idx}`} cx="36%" cy="46%" r="69%"><stop offset="0" stopColor="#15213E"/><stop offset="0.6" stopColor="#080D18"/><stop offset="1" stopColor={C.bg}/></radialGradient>
          <linearGradient id={`s08-code-${idx}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#182D4B"/><stop offset="1" stopColor="#0B101B"/></linearGradient>
          <linearGradient id={`s08-beam-${idx}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.ice} stopOpacity="0.05"/><stop offset="0.5" stopColor={C.ice} stopOpacity="0.55"/><stop offset="1" stopColor={C.gold} stopOpacity="0.05"/></linearGradient>
          <clipPath id={`s08-codeclip-${idx}`}><rect x="119" y="627" width={722 * codeReveal} height="208"/></clipPath>
          <filter id={`s08-glow-${idx}`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="5"/></filter>
        </defs>
        <rect width="1080" height="1920" fill={`url(#s08-bg-${idx})`}/>
        <SpaceField f={f} variant={8}/>
        <g>
          <text x="90" y="258" fill={C.gold} fontFamily={FONT_MONO} fontSize="22" letterSpacing="3">BATCH PROMPTS → SCENE CODE</text>
          <text x="85" y="345" fill={C.white} fontSize="67" fontWeight="900">逐镜手写，</text>
          <text x="85" y="426" fill={C.white} fontSize="67" fontWeight="900">不是<tspan fill={C.gold}>套壳模板</tspan></text>
        </g>
        <g transform={`translate(${8 * Math.sin(p * 1.4)} ${-p * 8})`}>
          <g transform="translate(90 478)">
            <text x="0" y="0" fill={C.muted} fontSize="23">按批次调用大模型</text>
            {indices(3).map((i: number) => {
              const u = ease(ramp(dispatch, i * 0.15, 0.5 + i * 0.15));
              const x = 290 + i * 145;
              return <g key={i} transform={`translate(${x} ${-26 + Math.sin(f * 0.065 + i) * 3 - (1 - u) * 24})`} opacity={0.4 + u * 0.6}>
                <path d="M 0 0 H 105 L 125 20 V 57 H 0 Z" fill="#10223C" stroke={i === 1 ? C.gold : C.ice} strokeOpacity="0.7"/>
                <path d="M 105 0 V 20 H 125" fill="none" stroke={C.muted}/>
                <text x="13" y="37" fill={i === 1 ? C.gold : C.ice} fontFamily={FONT_MONO} fontSize="17">{`0${7 + i}.tsx`}</text>
              </g>;
            })}
            <path d="M 322 42 V 73 M 467 42 V 73 M 612 42 V 73" stroke={C.ice} strokeWidth="2" strokeDasharray="4 5" strokeDashoffset={-f * 2} opacity="0.55"/>
          </g>
          <g transform={`translate(90 ${578 + (1 - codeReveal) * 10})`}>
            <rect width="780" height="283" rx="17" fill={`url(#s08-code-${idx})`} stroke={C.ice} strokeOpacity="0.5"/>
            <path d="M 0 47 H 780" stroke={C.ice} strokeOpacity="0.18"/>
            <circle cx="25" cy="24" r="4" fill={C.ice}/><circle cx="42" cy="24" r="4" fill={C.gold}/><circle cx="59" cy="24" r="4" fill={C.muted}/>
            <text x="90" y="31" fill={C.white} fontFamily={FONT_MONO} fontSize="20">SCENE AUTHORING</text>
            <text x="755" y="31" textAnchor="end" fill={C.muted} fontSize="19">代码仅为机制示意</text>
          </g>
          <g clipPath={`url(#s08-codeclip-${idx})`}>
            {codeLines.map((line: {text: string; color: string}, i: number) => (
              <g key={i}>
                <text x="119" y={659 + i * 32} fill="#526580" fontFamily={FONT_MONO} fontSize="18">{String(i + 1).padStart(2, '0')}</text>
                <text x="162" y={659 + i * 32} fill={line.color} fontFamily={FONT_MONO} fontSize="21" xmlSpace="preserve">{line.text}</text>
              </g>
            ))}
          </g>
          <rect x={128 + codeReveal * 704} y={632 + Math.floor((f / 9) % 6) * 32} width="5" height="25" fill={C.gold} opacity={0.55 + 0.45 * Math.sin(f * 0.3) ** 2}/>
          <path d="M 480 865 V 930 M 210 1003 V 930 H 750 V 1003 M 480 930 V 1003" fill="none" stroke={C.ice} strokeWidth="2" strokeOpacity="0.35"/>
          <path d="M 480 865 V 930 M 210 1003 V 930 H 750 V 1003 M 480 930 V 1003" fill="none" stroke={C.gold} strokeWidth="3" pathLength="1" strokeDasharray="0.09 0.91" strokeDashoffset={-f / 42}/>
          <circle cx="480" cy="930" r={9 + pulse * 3} fill={C.gold}/>
          {indices(21).map((i: number) => {
            const u = ((f * 0.013 + i / 21) % 1);
            const branch = i % 3;
            const targetX = 210 + branch * 270;
            const x = 480 + (targetX - 480) * ease(u);
            const y = 860 + 143 * u;
            return <rect key={i} x={x} y={y} width={i % 4 === 0 ? 10 : 4} height="3" rx="1" fill={branch === 1 ? C.gold : C.ice} opacity={Math.sin(u * Math.PI) * ramp(p, 0.12, 0.3) * 0.8}/>;
          })}
          {previews.map((preview: {x: number; label: string; sub: string; start: number; color: string}, i: number) => {
            const a = ease(ramp(p, preview.start, preview.start + 0.2));
            return <g key={preview.label} transform={`translate(${preview.x} ${1015 + (1 - a) * 24})`} opacity={0.22 + a * 0.78}>
              <path d="M 0 18 L 18 0 H 240 V 235 H 0 Z" fill="#0D1828" stroke={preview.color} strokeOpacity={0.25 + a * 0.65} strokeWidth="2"/>
              <text x="18" y="34" fill={preview.color} fontFamily={FONT_MONO} fontSize="16">{preview.sub}</text>
              {i === 0 && <g>
                <path d="M 21 151 C 58 32 106 204 145 98 S 198 71 220 106" fill="none" stroke={C.ice} strokeWidth="4" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - a}/>
                <path d="M 21 151 L 76 73 L 145 98 L 199 66 L 220 106" fill="none" stroke={C.ice} strokeOpacity="0.25" strokeDasharray="3 5"/>
                <circle cx={21 + ((f * 1.7) % 198)} cy={120 + Math.sin(f * 0.09) * 22} r="6" fill={C.gold}/>
                <circle cx="76" cy="73" r="4" fill={C.ice}/><circle cx="145" cy="98" r="4" fill={C.ice}/>
              </g>}
              {i === 1 && <g transform={`translate(28 ${63 + Math.sin(f * 0.08) * 4})`}>
                <rect width="184" height="105" rx="10" fill="#182D42" stroke={C.gold} strokeOpacity="0.65"/>
                <rect x="14" y="15" width="28" height="28" rx="6" fill={C.gold}/>
                <path d="M 55 24 H 165 M 55 37 H 130" stroke={C.white} strokeOpacity="0.7" strokeWidth="4"/>
                <rect x="14" y="63" width="156" height="12" rx="6" fill="#28384B"/>
                <rect x="14" y="63" width={30 + ((f * 1.6) % 126)} height="12" rx="6" fill={C.gold}/>
                <circle cx="162" cy="92" r={3 + pulse * 2} fill={C.gold}/>
              </g>}
              {i === 2 && <g>
                {indices(22).map((j: number) => {
                  const angle = j * 2.39996 + f * 0.021;
                  const radius = 14 + ((j * 17 + f * 0.55) % 70);
                  return <circle key={j} cx={120 + Math.cos(angle) * radius} cy={117 + Math.sin(angle) * radius * 0.72} r={j % 4 === 0 ? 4 : 2} fill={j % 5 === 0 ? C.gold : C.ice} opacity={0.45 + 0.5 * Math.sin(j + f * 0.04) ** 2}/>;
                })}
                <circle cx="120" cy="117" r={18 + pulse * 8} fill="none" stroke={C.ice} opacity="0.6"/>
              </g>}
              <path d="M 16 187 H 224" stroke={preview.color} strokeOpacity="0.23"/>
              <text x="120" y="220" textAnchor="middle" fill={C.white} fontSize="25" fontWeight="700">{preview.label}</text>
              <path d={`M 0 235 H ${240 * a}`} stroke={preview.color} strokeWidth="4"/>
            </g>;
          })}
          <g opacity={ease(ramp(p, 0.56, 0.88))}>
            <text x="90" y="1330" fill={C.white} fontSize="42" fontWeight="900">内容决定动效</text>
            <text x="90" y="1380" fill={C.gold} fontSize="29" fontWeight="700">大模型按批次 · 逐镜手写 Remotion TSX</text>
          </g>
        </g>
        <text x="90" y="1432" fill={C.muted} fontFamily={FONT_MONO} fontSize="19">机制示意 · 三类动画独立演绎</text>
      </svg>
    </AbsoluteFill>
  );
};

const Scene_scene_09: React.FC<CustomSceneProps> = ({scene, idx, beats}) => {
  const {f, p, pulse} = useMotion(scene, beats);
  const enter = ease(ramp(p, 0, 0.18));
  const stream = ease(ramp(p, 0.16, 0.4));
  const cache = ease(ramp(p, 0.37, 0.77));
  const output = ease(ramp(p, 0.67, 0.94));
  const frameLabel = String(Math.floor(f)).padStart(3, '0');
  const pan = -10 + p * 18;
  const layers: {name: string; y: number; color: string}[] = [
    {name: 'HTML5', y: 635, color: C.ice},
    {name: 'GSAP', y: 695, color: C.gold},
    {name: 'Canvas', y: 755, color: '#A9C8FF'},
  ];
  return (
    <AbsoluteFill style={{backgroundColor: C.bg, fontFamily: FONT_SANS}}>
      <svg width="1080" height="1920" viewBox="0 0 1080 1920" role="img" aria-label="Chromium CDP逐帧抓取并进入分段缓存的架构示意">
        <defs>
          <radialGradient id={`s09-bg-${idx}`} cx="58%" cy="39%" r="70%"><stop offset="0" stopColor="#102A40"/><stop offset="0.63" stopColor="#080F1B"/><stop offset="1" stopColor={C.bg}/></radialGradient>
          <linearGradient id={`s09-layer-${idx}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#173B5C"/><stop offset="1" stopColor="#0C1728"/></linearGradient>
          <linearGradient id={`s09-pipe-${idx}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor={C.ice}/><stop offset="0.65" stopColor={C.blue}/><stop offset="1" stopColor={C.gold}/></linearGradient>
          <filter id={`s09-glow-${idx}`} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6"/></filter>
          <clipPath id={`s09-browser-${idx}`}><rect x="110" y="563" width="740" height="291" rx="12"/></clipPath>
        </defs>
        <rect width="1080" height="1920" fill={`url(#s09-bg-${idx})`}/>
        <SpaceField f={f} variant={9}/>
        <text x="90" y="258" fill={C.ice} fontFamily={FONT_MONO} fontSize="22" letterSpacing="3">BROWSER / FRAME PIPELINE</text>
        <text x="85" y="345" fill={C.white} fontSize="65" fontWeight="900">浏览器引擎，</text>
        <text x="85" y="427" fill={C.white} fontSize="65" fontWeight="900">同样<tspan fill={C.ice}>逐帧可控</tspan></text>
        <g transform={`translate(${pan} ${-(p * 9)})`}>
          <g opacity={enter} transform={`translate(0 ${(1 - enter) * 25})`}>
            <rect x="100" y="490" width="760" height="375" rx="20" fill="#0A1423" stroke={C.ice} strokeOpacity="0.58" strokeWidth="2"/>
            <path d="M 100 548 H 860" stroke={C.ice} strokeOpacity="0.25"/>
            <circle cx="129" cy="519" r="5" fill={C.ice}/><circle cx="147" cy="519" r="5" fill={C.gold}/><circle cx="165" cy="519" r="5" fill={C.muted}/>
            <text x="193" y="527" fill={C.white} fontFamily={FONT_MONO} fontSize="24" fontWeight="700">Chromium</text>
            <text x="834" y="525" textAnchor="end" fill={C.ice} fontFamily={FONT_MONO} fontSize="20">FRAME {frameLabel}</text>
            <g clipPath={`url(#s09-browser-${idx})`}>
              <ellipse cx="476" cy="812" rx="270" ry="28" fill={C.blue} opacity="0.1"/>
              {layers.map((layer: {name: string; y: number; color: string}, i: number) => {
                const shift = Math.sin(f * 0.052 + i * 0.7) * 6;
                return <g key={layer.name} transform={`translate(${shift} ${Math.sin(f * 0.045 + i) * 3})`}>
                  <path d={`M 183 ${layer.y} L 600 ${layer.y - 63} L 767 ${layer.y - 8} L 349 ${layer.y + 56} Z`} fill={`url(#s09-layer-${idx})`} stroke={layer.color} strokeOpacity="0.7" strokeWidth="2"/>
                  <path d={`M 183 ${layer.y} V ${layer.y + 10} L 349 ${layer.y + 66} L 767 ${layer.y + 2} V ${layer.y - 8}`} fill="#0C1A2B" stroke={layer.color} strokeOpacity="0.25"/>
                  <text x="252" y={layer.y + 9} fill={layer.color} fontFamily={FONT_MONO} fontSize="24" fontWeight="700" transform={`rotate(18 252 ${layer.y + 9})`}>{layer.name}</text>
                  {indices(5).map((j: number) => {
                    const t = ((f * 0.012 + j * 0.2) % 1);
                    const x = 395 + t * 258;
                    const y = layer.y + 6 - t * 39;
                    return <path key={j} d={`M ${x} ${y} l 25 -4 l 16 6 l -25 4 Z`} fill={layer.color} opacity={0.18 + Math.sin(t * Math.PI) * 0.7}/>;
                  })}
                </g>;
              })}
              <path d={`M 130 ${570 + (f * 2.5) % 265} H 830`} stroke={C.ice} strokeWidth="2" opacity="0.22"/>
            </g>
          </g>
          <g opacity={stream}>
            <path d="M 480 866 V 914 H 808 V 1061 H 187 V 1116" fill="none" stroke={C.ice} strokeOpacity="0.09" strokeWidth="26"/>
            <path d="M 480 866 V 914 H 808 V 1061 H 187 V 1116" fill="none" stroke={`url(#s09-pipe-${idx})`} strokeWidth="3" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - stream}/>
            <path d="M 480 866 V 914 H 808 V 1061 H 187 V 1116" fill="none" stroke={C.ice} strokeWidth="6" pathLength="1" strokeDasharray="0.035 0.965" strokeDashoffset={-f / 65} opacity="0.65" filter={`url(#s09-glow-${idx})`}/>
            <text x="110" y="964" fill={C.ice} fontFamily={FONT_MONO} fontSize="31" fontWeight="800">CDP WebSocket</text>
            <text x="110" y="1006" fill={C.white} fontSize="28" fontWeight="700">逐帧抓取</text>
            <path d="M 110 1021 H 273" stroke={C.gold} strokeWidth="3"/>
            {indices(5).map((i: number) => {
              const u = ((f * 0.012 + i * 0.2) % 1);
              let x: number;
              let y: number;
              if (u < 0.38) {
                x = 480 + u / 0.38 * 328;
                y = 914;
              } else if (u < 0.55) {
                x = 808;
                y = 914 + (u - 0.38) / 0.17 * 147;
              } else {
                x = 808 - (u - 0.55) / 0.45 * 621;
                y = 1061;
              }
              return <g key={i} transform={`translate(${x} ${y})`}>
                <rect x="-25" y="-18" width="50" height="36" rx="5" fill="#112C4C" stroke={i % 2 === 0 ? C.ice : C.gold} strokeWidth="2"/>
                <path d="M -16 -8 H 16 M -16 0 H 5 M -16 8 H 12" stroke={C.ice} strokeOpacity="0.7" strokeWidth="2"/>
              </g>;
            })}
          </g>
          <g>
            <text x="110" y="1123" fill={C.white} fontSize="31" fontWeight="800">分段缓存</text>
            <text x="848" y="1121" textAnchor="end" fill={C.muted} fontFamily={FONT_MONO} fontSize="19">SEGMENT QUEUE</text>
            {indices(3).map((i: number) => {
              const x = 110 + i * 255;
              const active = ease(ramp(cache, i * 0.19, 0.52 + i * 0.2));
              return <g key={i} transform={`translate(${x} 1152)`}>
                <rect width="228" height="119" rx="11" fill="#101E31" stroke={i === 2 ? C.gold : C.ice} strokeOpacity={0.2 + active * 0.5} strokeWidth="2"/>
                <text x="15" y="29" fill={C.muted} fontFamily={FONT_MONO} fontSize="18">SEG / 0{i + 1}</text>
                {indices(6).map((j: number) => {
                  const fill = clamp(active * 7 - j);
                  return <g key={j}>
                    <rect x={15 + j * 33} y="47" width="26" height="44" rx="3" fill="#162B45" stroke={C.ice} strokeOpacity="0.15"/>
                    <rect x={15 + j * 33} y={91 - 44 * fill} width="26" height={44 * fill} rx="3" fill={i === 2 ? C.gold : C.ice} opacity={0.58 + pulse * 0.2}/>
                  </g>;
                })}
                <path d={`M 15 106 H ${15 + active * 198}`} stroke={i === 2 ? C.gold : C.ice} strokeWidth="3"/>
              </g>;
            })}
            <path d="M 224 1273 V 1293 H 734 V 1273 M 480 1293 V 1310" fill="none" stroke={C.ice} strokeOpacity={0.2 + cache * 0.6} strokeWidth="2"/>
          </g>
          <g opacity={output} transform={`translate(0 ${(1 - output) * 15})`}>
            <path d="M 238 1314 H 722 L 744 1336 V 1390 H 216 V 1336 Z" fill="#132C46" stroke={C.ice} strokeWidth="2"/>
            <rect x="239" y="1333" width="38" height="38" rx="6" fill={C.ice} fillOpacity="0.13"/>
            <path d="M 253 1343 L 253 1362 L 268 1352 Z" fill={C.ice}/>
            <text x="308" y="1363" fill={C.white} fontSize="34" fontWeight="800">合成视频输出</text>
            <circle cx="706" cy="1352" r={5 + pulse * 2} fill={C.gold}/>
          </g>
        </g>
        <text x="90" y="1432" fill={C.muted} fontFamily={FONT_MONO} fontSize="19">架构示意 · 非实测监控 · 不代表并发与缓存规模</text>
      </svg>
    </AbsoluteFill>
  );
};

export interface CustomSceneProps { scene: any; idx: number; total: number; beats: any[]; }
export const BATCH_03_SCENES: Record<string, React.FC<CustomSceneProps>> = {
  'scene-07': Scene_scene_07,
  'scene-08': Scene_scene_08,
  'scene-09': Scene_scene_09
};
