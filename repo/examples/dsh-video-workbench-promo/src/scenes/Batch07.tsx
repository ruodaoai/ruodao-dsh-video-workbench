import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_SANS, FONT_MONO, FONT_SERIF} from '../lib/shotcraft';

const C = {bg: '#050608', surface: '#10141E', white: '#F1F5F9', muted: '#94A3B8', blue: '#2F7BFF', ice: '#7DB2FF', gold: '#F5B92E'};
const clamp = (v: number): number => Math.max(0, Math.min(1, v));
const ease = (v: number): number => {const t = clamp(v); return 1 - Math.pow(1 - t, 3);};
const enter = (p: number, start: number, span = 0.16): number => ease((p - start) / span);
const mix = (a: number, b: number, t: number): number => a + (b - a) * clamp(t);
const smooth = (v: number): number => {const t = clamp(v); return t * t * (3 - 2 * t);};
const TAU = Math.PI * 2;

interface Motion {f: number; p: number; pulse: number; time: number;}
function useMotion(scene: any): Motion {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const frames = typeof scene?.durationInFrames === 'number' ? scene.durationInFrames : 107;
  const time = f / fps;
  const globalTime = time + (typeof scene?.startSec === 'number' ? scene.startSec : 0);
  const phase = ((globalTime * 118 / 60) % 1 + 1) % 1;
  const distance = Math.min(phase, 1 - phase);
  return {f, time, p: clamp(f / Math.max(1, frames - 1)), pulse: Math.exp(-distance * distance * 150)};
}

const Scene_scene_19: React.FC<CustomSceneProps> = ({scene, idx}) => {
  const {f, p, pulse, time} = useMotion(scene);
  const prefix = `qa19-${idx}`;
  const a = enter(p, 0.01);
  const b = enter(p, 0.15);
  const c = enter(p, 0.30);
  const platformPosition = clamp((p - 0.39) / 0.48) * 2;
  const platformIndex = Math.min(2, Math.floor(platformPosition));
  const platformBlend = smooth(platformPosition - platformIndex);
  const insets: number[][] = [[20, 45, 58, 77], [21, 36, 35, 65], [17, 29, 28, 52]];
  const current: number[] = insets[platformIndex] ?? insets[0]!;
  const next: number[] = insets[Math.min(2, platformIndex + 1)] ?? current;
  const left = mix(current[0]!, next[0]!, platformBlend);
  const top = mix(current[1]!, next[1]!, platformBlend);
  const right = mix(current[2]!, next[2]!, platformBlend);
  const bottom = mix(current[3]!, next[3]!, platformBlend);
  const waveform = Array.from({length: 83}, (_: unknown, i: number): string => {
    const x = 370 + i * 5.3;
    const amplitude = 10 + 12 * Math.sin(i * 0.19 + time * 2.1);
    const y = 579 + Math.sin(i * 0.65 - time * 9) * amplitude * Math.sin(i / 82 * Math.PI);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  const camera = 1 + p * 0.012 + pulse * 0.003;
  return <AbsoluteFill style={{backgroundColor: C.bg, fontFamily: FONT_SANS}}>
    <svg width="100%" height="100%" viewBox="0 0 1080 1920" role="img" aria-label="响度、黑屏与平台安全区预检概念演示，不代表本片检测报告">
      <defs>
        <radialGradient id={`${prefix}-halo`} cx="28%" cy="34%" r="68%"><stop stopColor="#163D79" stopOpacity="0.65"/><stop offset="1" stopColor={C.bg} stopOpacity="0"/></radialGradient>
        <linearGradient id={`${prefix}-scan`} x1="0" y1="0" x2="0" y2="1"><stop stopColor={C.ice} stopOpacity="0"/><stop offset="1" stopColor={C.ice} stopOpacity="0.75"/></linearGradient>
        <linearGradient id={`${prefix}-card`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#15243C"/><stop offset="1" stopColor="#0B111C"/></linearGradient>
        <clipPath id={`${prefix}-phone-clip`}><rect x="630" y="1051" width="196" height="292" rx="20"/></clipPath>
      </defs>
      <rect width="1080" height="1920" fill={`url(#${prefix}-halo)`}/>
      <g opacity="0.13" stroke={C.ice} strokeWidth="1">
        {Array.from({length: 15}, (_: unknown, i: number) => <path key={`grid-${i}`} d={`M${i * 86 - 40 + (time * 12 % 86)} 205V1450`}/>)}
        {Array.from({length: 18}, (_: unknown, i: number) => <path key={`row-${i}`} d={`M30 ${230 + i * 72}H950`}/>)}
      </g>
      <g transform={`translate(465 820) scale(${camera}) translate(-465 -820)`}>
        <g opacity={enter(p, 0, 0.12)} transform={`translate(0 ${24 * (1 - enter(p, 0, 0.12))})`}>
          <path d="M82 239H126" stroke={C.ice} strokeWidth="5"/>
          <text x="142" y="248" fill={C.ice} fontSize="23" letterSpacing="4" fontFamily={FONT_MONO}>PREFLIGHT / 03 CHECKS</text>
          <text x="80" y="327" fill={C.white} fontWeight="800" fontSize="62">响度、黑屏、遮挡</text>
          <text x="80" y="407" fill={C.ice} fontWeight="800" fontSize="68">发布之前，提前查</text>
          <text x="83" y="454" fill={C.muted} fontSize="24">检测能力可视化 · 非实时检测界面</text>
        </g>
        <g opacity={a} transform={`translate(${(1 - a) * -60} 0)`}>
          <rect x="80" y="492" width="794" height="143" rx="20" fill={`url(#${prefix}-card)`} stroke={C.blue} strokeOpacity={0.5 + pulse * 0.35}/>
          <rect x="80" y="519" width="5" height="88" rx="2" fill={C.ice}/>
          <text x="107" y="531" fill={C.ice} fontSize="18" fontFamily={FONT_MONO}>01 / LOUDNESS</text>
          <text x="106" y="578" fill={C.white} fontSize="35" fontWeight="750">EBU R128</text>
          <text x="108" y="610" fill={C.muted} fontSize="21">广播响度预检</text>
          <path d="M366 554H825 M366 579H825 M366 604H825" stroke={C.ice} strokeOpacity="0.14"/>
          <path d={waveform} fill="none" stroke={C.ice} strokeWidth="3.5" strokeLinecap="round"/>
          <line x1={373 + ((f * 5) % 450)} x2={373 + ((f * 5) % 450)} y1="545" y2="614" stroke={C.gold} strokeWidth="2" opacity="0.85"/>
        </g>
        <g opacity={b} transform={`translate(${(1 - b) * 65} 0)`}>
          <rect x="80" y="654" width="794" height="143" rx="20" fill={`url(#${prefix}-card)`} stroke={C.ice} strokeOpacity="0.32"/>
          <text x="107" y="694" fill={C.ice} fontSize="18" fontFamily={FONT_MONO}>02 / FRAME CHECK</text>
          <text x="107" y="742" fill={C.white} fontSize="34" fontWeight="750">零黑屏检测</text>
          <text x="109" y="774" fill={C.muted} fontSize="21">逐帧定位异常区间</text>
          {Array.from({length: 11}, (_: unknown, i: number) => {
            const active = ((f / 3.6) % 11);
            const strength = Math.exp(-Math.pow(i - active, 2) / 2.3);
            return <g key={`frame-${i}`}><rect x={374 + i * 40} y="699" width="31" height="57" rx="4" fill={i === 6 ? '#080C13' : '#172F51'} stroke={i === 6 ? C.gold : C.ice} strokeOpacity={0.25 + strength * 0.75}/><path d={`M${380 + i * 40} ${740 - (i % 4) * 5}l6 -10 7 5 6 -12`} fill="none" stroke={i === 6 ? C.gold : C.ice} strokeWidth="2" opacity={0.35 + strength * 0.65}/></g>;
          })}
          <path d={`M${374 + ((f / 3.6) % 11) * 40} 687v80`} stroke={C.gold} strokeWidth="2"/>
        </g>
        <g opacity={c} transform={`translate(0 ${(1 - c) * 45})`}>
          <rect x="80" y="816" width="794" height="143" rx="20" fill={`url(#${prefix}-card)`} stroke={C.ice} strokeOpacity="0.32"/>
          <text x="107" y="857" fill={C.ice} fontSize="18" fontFamily={FONT_MONO}>03 / SAFE ZONE</text>
          <text x="106" y="905" fill={C.white} fontSize="34" fontWeight="750">平台防遮挡安全区</text>
          <text x="109" y="938" fill={C.muted} fontSize="21">标题 / 主体 / 字幕边界</text>
          <g transform="translate(688 837)">
            <rect x="0" y="0" width="96" height="99" rx="12" fill="none" stroke={C.ice} strokeWidth="2"/>
            <rect x="12" y="13" width="58" height="65" rx="5" fill={C.blue} fillOpacity="0.18" stroke={C.gold} strokeDasharray="5 4" strokeDashoffset={-f * 0.6}/>
            <path d="M81 39v39M18 88h59" stroke={C.muted} strokeWidth="5" strokeLinecap="round"/>
          </g>
        </g>
        <g opacity={enter(p, 0.43, 0.17)}>
          <text x="87" y="1025" fill={C.white} fontFamily={FONT_MONO} fontWeight="700" fontSize="43">QA <tspan fill={C.gold}>7/7</tspan></text>
          <text x="88" y="1063" fill={C.muted} fontSize="22">产品质检项目标识</text>
          {(['抖音', '小红书', 'B站'] as string[]).map((label: string, i: number) => {
            const weight = Math.max(0, 1 - Math.abs(platformPosition - i));
            return <g key={label} transform={`translate(88 ${1090 + i * 72})`}>
              <rect width="328" height="55" rx="10" fill={C.blue} fillOpacity={0.04 + weight * 0.23} stroke={C.ice} strokeOpacity={0.15 + weight * 0.7}/>
              <circle cx="23" cy="27" r={4 + weight * 2} fill={weight > 0.4 ? C.gold : C.muted}/>
              <text x="45" y="36" fill={C.white} fontSize="24">{label}</text>
              <text x="201" y="34" fill={C.ice} fontSize="17" fontFamily={FONT_MONO}>SAFE AREA</text>
            </g>;
          })}
          <rect x="618" y="1039" width="220" height="316" rx="31" fill="#0B111C" stroke={C.ice} strokeWidth="2"/>
          <g clipPath={`url(#${prefix}-phone-clip)`}>
            <rect x="630" y="1051" width="196" height="292" fill="#11233A"/>
            {Array.from({length: 7}, (_: unknown, i: number) => <path key={`phone-grid-${i}`} d={`M630 ${1060 + i * 48}H826`} stroke={C.ice} strokeOpacity="0.13"/>)}
            <path d={`M630 ${1051 + ((f * 3) % 290)}H826`} stroke={C.ice} strokeWidth="40" opacity="0.08"/>
            <rect x={630 + left} y={1051 + top} width={196 - left - right} height={292 - top - bottom} rx="6" fill={C.blue} fillOpacity={0.17 + pulse * 0.08} stroke={C.gold} strokeWidth="2" strokeDasharray="7 5" strokeDashoffset={-f * 0.7}/>
            <rect x="797" y="1154" width="16" height="110" rx="8" fill={C.muted} fillOpacity="0.28"/>
            <rect x="643" y="1309" width="133" height="19" rx="5" fill={C.muted} fillOpacity="0.28"/>
          </g>
          <path d="M443 1162h93l55 -34" fill="none" stroke={C.ice} strokeOpacity="0.55" strokeDasharray="5 6" strokeDashoffset={-f}/>
          <circle cx={443 + ((f * 2) % 92)} cy="1162" r="4" fill={C.gold}/>
          <text x="88" y="1366" fill={C.gold} fontSize="24" fontWeight="650">示意展示 · 并非本片已运行通过的报告</text>
        </g>
      </g>
      {Array.from({length: 16}, (_: unknown, i: number) => <circle key={`dust-${i}`} cx={70 + ((i * 127 + time * (12 + i % 4)) % 820)} cy={240 + ((i * 79 - time * 38 + 2400) % 1140)} r={i % 3 === 0 ? 2 : 1} fill={i % 4 === 0 ? C.gold : C.ice} opacity={0.15 + pulse * 0.2}/>)}
    </svg>
  </AbsoluteFill>;
};

const Scene_scene_20: React.FC<CustomSceneProps> = ({scene, idx}) => {
  const {f, p, pulse, time} = useMotion(scene);
  const prefix = `license20-${idx}`;
  const plate = enter(p, 0.01, 0.20);
  const fonts = enter(p, 0.22, 0.18);
  const config = enter(p, 0.46, 0.19);
  const orbit = time * 0.48;
  const fontNames: {name: string; sample: string; family: string; size: number}[] = [
    {name: 'Noto Sans SC', sample: '开源创造', family: FONT_SANS, size: 34},
    {name: '思源宋体', sample: '自由表达', family: FONT_SERIF, size: 34},
    {name: 'JetBrains Mono', sample: 'Aa 0123', family: FONT_MONO, size: 32}
  ];
  return <AbsoluteFill style={{backgroundColor: C.bg, fontFamily: FONT_SANS}}>
    <svg width="100%" height="100%" viewBox="0 0 1080 1920" role="img" aria-label="MIT代码许可、SIL OFL字体及本地配置规范概念演示">
      <defs>
        <radialGradient id={`${prefix}-aura`} cx="45%" cy="39%" r="57%"><stop stopColor="#234779" stopOpacity="0.7"/><stop offset="0.7" stopColor="#101A2D" stopOpacity="0.3"/><stop offset="1" stopColor={C.bg} stopOpacity="0"/></radialGradient>
        <linearGradient id={`${prefix}-metal`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#314969"/><stop offset="0.37" stopColor="#101C2F"/><stop offset="0.72" stopColor="#192C45"/><stop offset="1" stopColor="#0B111C"/></linearGradient>
        <linearGradient id={`${prefix}-light`} x1="0" y1="0" x2="1" y2="0"><stop stopColor={C.ice} stopOpacity="0"/><stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.45"/><stop offset="1" stopColor={C.ice} stopOpacity="0"/></linearGradient>
        <clipPath id={`${prefix}-plate-clip`}><path d="M147 486H797L851 540V711L797 765H147L105 723V528Z"/></clipPath>
      </defs>
      <rect width="1080" height="1920" fill={`url(#${prefix}-aura)`}/>
      <g transform={`translate(480 640) rotate(${time * 4})`} fill="none">
        <ellipse rx={390 + pulse * 8} ry="300" stroke={C.ice} strokeOpacity="0.12" strokeDasharray="9 18"/>
        <ellipse rx="454" ry="355" stroke={C.gold} strokeOpacity="0.09"/>
        {[0, 1, 2, 3, 4, 5].map((i: number) => {
          const angle = orbit + i * TAU / 6;
          return <circle key={`orb-${i}`} cx={Math.cos(angle) * 454} cy={Math.sin(angle) * 355} r={i % 2 ? 3 : 5} fill={i % 2 ? C.ice : C.gold} opacity="0.55"/>;
        })}
      </g>
      <g transform={`translate(470 810) scale(${1.014 - p * 0.012 + pulse * 0.003}) translate(-470 -810)`}>
        <g opacity={enter(p, 0, 0.13)}>
          <text x="85" y="251" fill={C.gold} fontFamily={FONT_MONO} fontSize="23" letterSpacing="4">OPEN CODE / LOCAL CONFIG</text>
          <text x="80" y="331" fill={C.white} fontSize="66" fontWeight="800">代码免费商用</text>
          <text x="80" y="410" fill={C.ice} fontSize="64" fontWeight="800">配置，本地隔离</text>
        </g>
        <g opacity={plate} transform={`translate(478 625) scale(${0.83 + plate * 0.17}) translate(-478 -625)`}>
          <path d="M147 486H797L851 540V711L797 765H147L105 723V528Z" fill={`url(#${prefix}-metal)`} stroke={C.ice} strokeWidth="2"/>
          <path d="M147 500H791L836 545 M120 704l34 46h626" fill="none" stroke={C.gold} strokeWidth="3" opacity={0.4 + pulse * 0.45}/>
          <g clipPath={`url(#${prefix}-plate-clip)`}>
            <path d={`M${-350 + p * 1600} 460l180 0 -160 340h-180Z`} fill={`url(#${prefix}-light)`}/>
          </g>
          <text x="477" y="536" textAnchor="middle" fill={C.ice} fontFamily={FONT_MONO} fontSize="20" letterSpacing="5">SOURCE CODE LICENSE</text>
          <text x="477" y="650" textAnchor="middle" fill={C.white} fontFamily={FONT_MONO} fontWeight="800" fontSize="113" letterSpacing="9">MIT</text>
          <path d="M201 674H753" stroke={C.ice} strokeOpacity="0.3"/>
          <text x="320" y="720" textAnchor="middle" fill={C.gold} fontSize="30" fontWeight="750">个人免费</text>
          <text x="636" y="720" textAnchor="middle" fill={C.gold} fontSize="30" fontWeight="750">商业可用</text>
          <path d="M477 694v31" stroke={C.ice} strokeOpacity="0.4"/>
        </g>
        <text x="88" y="810" fill={C.muted} fontSize="21" opacity={fonts}>字体独立授权 / SIL OPEN FONT LICENSE</text>
        {fontNames.map((font: {name: string; sample: string; family: string; size: number}, i: number) => {
          const reveal = enter(p, 0.22 + i * 0.055, 0.18);
          const drift = Math.sin(time * 2.2 + i * 1.3) * 3;
          const x = 87 + i * 265;
          return <g key={font.name} opacity={reveal} transform={`translate(${x} ${836 + (1 - reveal) * 70 + drift}) rotate(${(i - 1) * (1 - reveal) * 11} 120 80)`}>
            <rect width="245" height="165" rx="15" fill="#111C2D" stroke={C.ice} strokeOpacity="0.4"/>
            <path d="M18 17h31" stroke={C.gold} strokeWidth="3"/>
            <text x="20" y="42" fill={C.gold} fontFamily={FONT_MONO} fontSize="18">SIL OFL</text>
            <text x="20" y="99" fill={C.white} fontFamily={font.family} fontSize={font.size} fontWeight="650">{font.sample}</text>
            <text x="20" y="139" fill={C.muted} fontSize={i === 2 ? 19 : 21}>{font.name}</text>
          </g>;
        })}
        <g opacity={config} transform={`translate(0 ${(1 - config) * 45})`}>
          <path d="M211 1023v20h531v-20 M477 1043v20" fill="none" stroke={C.ice} strokeOpacity="0.45" strokeDasharray="5 6" strokeDashoffset={-f * 0.7}/>
          <rect x="87" y="1067" width="775" height="201" rx="18" fill="#0D1623" stroke={C.ice} strokeOpacity="0.4"/>
          <path d="M310 1094v147" stroke={C.ice} strokeOpacity="0.25"/>
          <g transform={`translate(128 ${1107 + Math.sin(time * 2.8) * 3})`}>
            <path d="M0 16h112l28 28v94H0Z" fill="#172E4A" stroke={C.ice} strokeWidth="2"/>
            <path d="M112 16v28h28" fill="none" stroke={C.ice} strokeWidth="2"/>
            <text x="16" y="95" fill={C.gold} fontFamily={FONT_MONO} fontSize="37" fontWeight="750">.env</text>
          </g>
          <text x="339" y="1101" fill={C.ice} fontFamily={FONT_MONO} fontSize="18" letterSpacing="2">LOCAL CONFIG POLICY</text>
          {['零硬编码路径', '零私有密钥写入代码', '.env 隔离本地路径'].map((label: string, i: number) => {
            const reveal = enter(p, 0.49 + i * 0.065, 0.14);
            return <g key={label} opacity={reveal} transform={`translate(${(1 - reveal) * 30} 0)`}>
              <path d={`M341 ${1136 + i * 46}l6 -6 6 6 -6 6Z`} fill={C.gold}/>
              <text x="370" y={1145 + i * 46} fill={C.white} fontSize="27">{label}</text>
            </g>;
          })}
        </g>
        <g opacity={enter(p, 0.57, 0.16)}>
          <path d="M88 1310h775" stroke={C.ice} strokeOpacity="0.25"/>
          <text x="88" y="1348" fill={C.gold} fontSize="23" fontWeight="650">MIT 适用于代码；字体遵守各自字体许可。</text>
          <text x="88" y="1383" fill={C.muted} fontSize="23">素材、声音及外部服务另须遵守各自授权。</text>
        </g>
      </g>
      {Array.from({length: 15}, (_: unknown, i: number) => {
        const x = 85 + ((i * 163 + time * 15) % 810);
        const y = 450 + ((i * 87 - time * 31 + 1600) % 830);
        return <path key={`spark-${i}`} d={`M${x} ${y}l0 ${5 + i % 5}`} stroke={i % 3 === 0 ? C.gold : C.ice} strokeWidth="1.5" opacity="0.25"/>;
      })}
    </svg>
  </AbsoluteFill>;
};

const Scene_scene_21: React.FC<CustomSceneProps> = ({scene, idx}) => {
  const {f, p, pulse, time} = useMotion(scene);
  const prefix = `pack21-${idx}`;
  const hub = enter(p, 0.10, 0.20);
  const turn = smooth((p - 0.64) / 0.21);
  const frontScale = Math.max(0.025, Math.cos(Math.min(1, turn * 2) * Math.PI / 2));
  const backScale = Math.max(0.025, Math.sin(clamp((turn - 0.5) * 2) * Math.PI / 2));
  const nodes: {x: number; label: string; code: string}[] = [
    {x: 173, label: '编排', code: 'AGENTS'},
    {x: 468, label: '渲染', code: 'RENDER'},
    {x: 763, label: '质检', code: 'PREFLIGHT'}
  ];
  const files: {x: number; y: number; angle: number; title: string; type: string; color: string}[] = [
    {x: 133, y: 1003, angle: -7, title: '成片', type: 'VIDEO', color: C.ice},
    {x: 365, y: 958, angle: 0, title: '封面', type: 'COVER', color: C.gold},
    {x: 596, y: 1003, angle: 7, title: '发布清单', type: 'CHECKLIST', color: C.ice}
  ];
  return <AbsoluteFill style={{backgroundColor: C.bg, fontFamily: FONT_SANS}}>
    <svg width="100%" height="100%" viewBox="0 0 1080 1920" role="img" aria-label="Publish Pack概念交付流程：成片、封面、发布清单及完整开源仓库地址">
      <defs>
        <radialGradient id={`${prefix}-energy`} cx="44%" cy="45%" r="59%"><stop stopColor="#174278" stopOpacity="0.72"/><stop offset="0.65" stopColor="#0A1729" stopOpacity="0.3"/><stop offset="1" stopColor={C.bg} stopOpacity="0"/></radialGradient>
        <linearGradient id={`${prefix}-hub`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#284C79"/><stop offset="0.6" stopColor="#14263F"/><stop offset="1" stopColor="#0C1523"/></linearGradient>
        <linearGradient id={`${prefix}-repo`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#203F65"/><stop offset="1" stopColor="#0D192B"/></linearGradient>
        <linearGradient id={`${prefix}-beam`} x1="0" y1="0" x2="0" y2="1"><stop stopColor={C.ice} stopOpacity="0"/><stop offset="0.5" stopColor={C.ice} stopOpacity="0.55"/><stop offset="1" stopColor={C.ice} stopOpacity="0"/></linearGradient>
      </defs>
      <rect width="1080" height="1920" fill={`url(#${prefix}-energy)`}/>
      <g fill="none" stroke={C.ice}>
        {Array.from({length: 10}, (_: unknown, i: number) => <path key={`perspective-${i}`} d={`M468 760L${-500 + i * 215} 1450`} strokeOpacity="0.10"/>)}
        {Array.from({length: 8}, (_: unknown, i: number) => {
          const y = 780 + Math.pow(((i + time * 0.55) % 8) / 8, 1.7) * 670;
          return <path key={`floor-${i}`} d={`M40 ${y}H900`} strokeOpacity="0.10"/>;
        })}
      </g>
      <g transform={`translate(468 785) scale(${1 + p * 0.009 + pulse * 0.003}) translate(-468 -785)`}>
        <g opacity={enter(p, 0, 0.12)}>
          <text x="82" y="249" fill={C.ice} fontFamily={FONT_MONO} fontSize="23" letterSpacing="4">ONE CLICK / PUBLISH PACK</text>
          <text x="80" y="328" fill={C.white} fontSize="65" fontWeight="800">最后一步</text>
          <text x="80" y="407" fill={C.ice} fontSize="65" fontWeight="800">把发布资料带走</text>
        </g>
        {nodes.map((node: {x: number; label: string; code: string}, i: number) => {
          const reveal = enter(p, i * 0.04, 0.18);
          const endY = 672;
          const travel = (time * 0.83 + i * 0.32) % 1;
          const px = mix(node.x, 468, travel);
          const py = mix(579, endY, travel);
          return <g key={node.code} opacity={reveal}>
            <path d={`M${node.x} 576L468 ${endY}`} stroke={C.ice} strokeWidth="2" strokeOpacity="0.4" strokeDasharray="5 7" strokeDashoffset={-f * 1.4}/>
            <circle cx={px} cy={py} r={4 + pulse * 2} fill={C.gold}/>
            <g transform={`translate(${node.x - 98} ${482 + (1 - reveal) * 35})`}>
              <path d="M16 0h164l16 16v67l-16 16H16L0 83V16Z" fill="#101F33" stroke={C.ice} strokeOpacity="0.65"/>
              <text x="98" y="42" textAnchor="middle" fill={C.white} fontSize="30" fontWeight="700">{node.label}</text>
              <text x="98" y="73" textAnchor="middle" fill={C.ice} fontFamily={FONT_MONO} fontSize="17" letterSpacing="1">{node.code}</text>
            </g>
          </g>;
        })}
        <g opacity={hub} transform={`translate(468 787) scale(${0.82 + hub * 0.18 + pulse * 0.008}) translate(-468 -787)`}>
          <ellipse cx="468" cy="786" rx={326 + Math.sin(time * 2) * 7} ry="147" fill="none" stroke={C.blue} strokeOpacity="0.2" strokeWidth="2" strokeDasharray="3 14" strokeDashoffset={f * 1.2}/>
          <path d="M195 700l273 -49 273 49v160l-273 53 -273 -53Z" fill={`url(#${prefix}-hub)`} stroke={C.ice} strokeWidth="2"/>
          <path d="M195 700l273 54 273 -54 M468 754v159" fill="none" stroke={C.ice} strokeOpacity="0.4" strokeWidth="2"/>
          <rect x="273" y="732" width="390" height="98" rx="13" fill="#0B1525" stroke={C.ice} strokeOpacity="0.45"/>
          <text x="468" y="777" textAnchor="middle" fill={C.white} fontFamily={FONT_MONO} fontSize="38" fontWeight="800">Publish Pack</text>
          <text x="468" y="810" textAnchor="middle" fill={C.gold} fontSize="23" fontWeight="650">一键导出 · 交付成套</text>
          <path d="M458 681v35m-12 -12 12 12 12 -12" fill="none" stroke={C.gold} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        </g>
        <g opacity={turn < 0.51 ? 1 : 0} transform={`translate(468 1120) scale(${frontScale} 1) translate(-468 -1120)`}>
          {files.map((file: {x: number; y: number; angle: number; title: string; type: string; color: string}, i: number) => {
            const reveal = enter(p, 0.22 + i * 0.085, 0.19);
            const x = mix(363, file.x, reveal);
            const y = mix(843, file.y, reveal) + Math.sin(time * 2.4 + i) * 3;
            return <g key={file.type} opacity={reveal} transform={`translate(${x} ${y}) rotate(${file.angle * reveal} 105 120)`}>
              <path d="M0 0h165l45 45v198H0Z" fill="#13253C" stroke={file.color} strokeWidth="2"/>
              <path d="M165 0v45h45" fill="#213D60" stroke={file.color} strokeWidth="2"/>
              <text x="23" y="74" fill={file.color} fontFamily={FONT_MONO} fontSize="17">{file.type}</text>
              {i === 0 ? <g><rect x="24" y="96" width="160" height="72" rx="7" fill="#0C1625" stroke={C.ice} strokeOpacity="0.4"/><path d="M92 112l30 20 -30 20Z" fill={C.ice}/><path d="M30 179h143" stroke={C.ice} strokeOpacity="0.4"/></g> : i === 1 ? <g><rect x="24" y="96" width="160" height="80" rx="7" fill="#0C1625" stroke={C.gold} strokeOpacity="0.4"/><circle cx="144" cy="117" r="10" fill={C.gold}/><path d="M31 165l41 -43 31 27 22 -20 49 36" fill="none" stroke={C.gold} strokeWidth="3"/></g> : <g>{[0, 1, 2].map((line: number) => <g key={`checkline-${line}`}><rect x="26" y={104 + line * 25} width="10" height="10" rx="2" fill={C.ice} fillOpacity="0.65"/><path d={`M48 ${109 + line * 25}h124`} stroke={C.ice} strokeWidth="2" strokeOpacity="0.5"/></g>)}</g>}
              <text x="23" y="218" fill={C.white} fontSize={i === 2 ? 28 : 33} fontWeight="750">{file.title}</text>
            </g>;
          })}
          <text x="468" y="1339" textAnchor="middle" fill={C.muted} fontSize="23" opacity={enter(p, 0.44, 0.12)}>交付结构示意 · 非导出实机界面</text>
        </g>
        <g opacity={turn >= 0.5 ? 1 : 0} transform={`translate(476 1139) scale(${backScale} 1) translate(-476 -1139)`}>
          <rect x="79" y="947" width="797" height="371" rx="25" fill={`url(#${prefix}-repo)`} stroke={C.ice} strokeWidth="2.5"/>
          <path d="M103 982h52 M852 1283h-52" stroke={C.gold} strokeWidth="4"/>
          <text x="115" y="1004" fill={C.ice} fontFamily={FONT_MONO} fontSize="21" letterSpacing="3">NEXT / OPEN SOURCE</text>
          <text x="115" y="1071" fill={C.white} fontSize="44" fontWeight="800">完整工作台，开源交付</text>
          <rect x="100" y="1108" width="754" height="91" rx="11" fill="#07101E" stroke={C.gold} strokeOpacity="0.75"/>
          <text x="115" y="1162" fill="#FFFFFF" fontFamily={FONT_MONO} fontSize="23" textLength="723" lengthAdjust="spacingAndGlyphs">https://github.com/Merziller/dsh-video-workbench</text>
          <text x="115" y="1248" fill={C.gold} fontSize="27" fontWeight="700">MIT 代码许可 · 免费可商用</text>
          <text x="115" y="1288" fill={C.muted} fontSize="21">DSH VIDEO WORKBENCH / GITHUB</text>
          <g transform={`translate(797 1018) rotate(${Math.sin(time * 2) * 7}) scale(${1 + pulse * 0.07})`}>
            <path d="M0 -23L7 -8 24 -6 12 6 15 23 0 15 -15 23 -12 6 -24 -6 -7 -8Z" fill={C.gold} fillOpacity="0.15" stroke={C.gold} strokeWidth="2"/>
          </g>
        </g>
        <g opacity={smooth((turn - 0.6) / 0.4)}>
          <text x="477" y="1375" textAnchor="middle" fill={C.ice} fontSize="26" fontWeight="650">成片 · 封面 · 发布清单，一起带走</text>
        </g>
      </g>
      {Array.from({length: 19}, (_: unknown, i: number) => {
        const angle = i * TAU / 19 + time * 0.09;
        const radius = 180 + ((i * 29 + time * 85) % 360);
        const x = 468 + Math.cos(angle) * radius * 0.75;
        const y = 800 + Math.sin(angle) * radius;
        return <circle key={`packet-${i}`} cx={x} cy={y} r={i % 4 === 0 ? 3 : 1.5} fill={i % 3 === 0 ? C.gold : C.ice} opacity={0.16 + pulse * 0.18}/>;
      })}
    </svg>
  </AbsoluteFill>;
};

export interface CustomSceneProps { scene: any; idx: number; total: number; beats: any[]; }
export const BATCH_07_SCENES: Record<string, React.FC<CustomSceneProps>> = {
  'scene-19': Scene_scene_19,
  'scene-20': Scene_scene_20,
  'scene-21': Scene_scene_21
};
