import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {AppWindow, FONT_SANS, FONT_MONO} from '../lib/shotcraft';

const C = {bg: '#050608', surface: '#10141E', white: '#F1F5F9', muted: '#94A3B8', blue: '#2F7BFF', ice: '#7DB2FF', gold: '#F5B92E'};
const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const smooth = (n: number): number => {const t = clamp(n); return t * t * (3 - 2 * t);};
const enter = (f: number, start: number, length: number): number => smooth((f - start) / length);

interface Motion {f: number; fps: number; p: number; beat: number; half: number; hit: number; halfHit: number;}

function useMotion(scene: any, beats: any[]): Motion {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const duration = Math.max(2, Number(scene.durationInFrames) || 107);
  const beatFrames = fps * 60 / 118;
  const startFrame = (Number(scene.startSec) || 0) * fps;
  const globalFrame = f + startFrame;
  const beat = globalFrame / beatFrames;
  const half = beat * 2;
  let hit = Math.exp(-(beat - Math.floor(beat)) * 6);
  let halfHit = Math.exp(-(half - Math.floor(half)) * 5);
  beats.forEach((entry: any): void => {
    let seconds: number | undefined;
    if (typeof entry === 'number') seconds = entry;
    else if (entry && typeof entry === 'object') {
      const candidate: unknown = entry.timeSec ?? entry.time ?? entry.t ?? entry.sec;
      if (typeof candidate === 'number') seconds = candidate;
    }
    if (seconds === undefined || !Number.isFinite(seconds)) return;
    const delta = globalFrame - seconds * fps;
    if (delta >= 0 && delta < 12) {
      const supplied = Math.exp(-delta / 3);
      hit = Math.max(hit, supplied);
      halfHit = Math.max(halfHit, supplied);
    }
  });
  return {f, fps, p: clamp(f / (duration - 1)), beat, half, hit, halfHit};
}

const root: React.CSSProperties = {backgroundColor: C.bg, color: C.white, fontFamily: FONT_SANS, overflow: 'hidden'};
const fullSvg: React.CSSProperties = {position: 'absolute', inset: 0, width: '100%', height: '100%'};
const fixedCams = [{t: 0, fx: 0.5, fy: 0.5, z: 1}, {t: 1, fx: 0.5, fy: 0.5, z: 1}];

function assetSource(scene: any): string | undefined {
  const files: unknown = scene.publicAssetFiles;
  if (!Array.isArray(files)) return undefined;
  const first: unknown = files[0];
  return typeof first === 'string' && first.length > 0 ? staticFile(first) : undefined;
}

interface ScreenProps {scene: any; x: number; y: number; width: number; height: number; lift: number;}
function RealScreen({scene, x, y, width, height, lift}: ScreenProps): React.ReactElement | null {
  const src = assetSource(scene);
  if (!src) return null;
  return (
    <div style={{position: 'absolute', left: x, top: y, width, height, transform: `translateY(${lift}px)`}}>
      <AppWindow title={String(scene.title || 'DSH Video Workbench')} kicker="DSH WORKBENCH" style={{width: '100%', height, boxSizing: 'border-box'}}>
        <div style={{position: 'relative', width: '100%', height: height - 96, overflow: 'hidden', backgroundColor: '#080B11'}}>
          <Img src={src} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center'}} />
        </div>
      </AppWindow>
    </div>
  );
}

function Scene_scene_10({scene, idx, beats}: CustomSceneProps): React.ReactElement {
  const m = useMotion(scene, beats);
  const option = Math.floor(m.f / (m.fps * 60 / 118)) % 3;
  const modes: string[] = ['标准配音', '配音踩拍', '纯音乐卡点 MV'];
  const descriptions: string[] = ['AI 代码 · 48kHz 作曲', '上传音乐 · 真实节拍解析', 'TTS · 氛围音景'];
  const colors: string[] = ['#2F7BFF', '#67E8F9', '#F5B92E', '#FB7185', '#A78BFA', '#34D399'];
  const selectedColor = Math.floor(m.f / 12) % 6;
  const titleIn = enter(m.f, 0, 9);
  return (
    <AbsoluteFill style={root}>
      <svg viewBox="0 0 1080 1920" style={fullSvg} aria-hidden="true">
        <defs>
          <radialGradient id={`settings-halo-${idx}`} cx="35%" cy="38%" r="65%">
            <stop offset="0" stopColor={colors[selectedColor]} stopOpacity="0.2" />
            <stop offset="0.58" stopColor={C.blue} stopOpacity="0.055" />
            <stop offset="1" stopColor={C.bg} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`settings-rail-${idx}`} x1="0" x2="1">
            <stop offset="0" stopColor={C.blue} stopOpacity="0" />
            <stop offset="0.5" stopColor={C.ice} />
            <stop offset="1" stopColor={C.blue} stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="1080" height="1920" fill={C.bg} />
        <rect width="1080" height="1920" fill={`url(#settings-halo-${idx})`} />
        <g transform={`translate(${12 * m.p} ${-18 * m.p})`}>
          {Array.from({length: 14}, (_v: unknown, i: number): React.ReactElement => (
            <path key={i} d={`M ${-180 + i * 105} 220 L ${100 + i * 105} 1460`} stroke={C.ice} strokeWidth="1" opacity="0.045" />
          ))}
          {Array.from({length: 26}, (_v: unknown, i: number): React.ReactElement => {
            const x = 60 + ((i * 137 + m.f * (0.45 + i % 4 * 0.12)) % 820);
            const y = 235 + ((i * 89 + m.f * 0.7) % 1190);
            return <circle key={i} cx={x} cy={y} r={i % 4 === 0 ? 2.5 : 1.2} fill={C.ice} opacity={0.12 + (i % 5) * 0.05} />;
          })}
        </g>
        <g opacity={titleIn} transform={`translate(0 ${(1 - titleIn) * 24})`}>
          <text x="68" y="260" fill={C.ice} fontFamily={FONT_MONO} fontSize="20" letterSpacing="4">MUSIC / COLOR / MODE</text>
          <text x="64" y="340" fill={C.white} fontFamily={FONT_SANS} fontWeight="800" fontSize="62">配乐与风格</text>
          <text x="65" y="410" fill={C.white} fontFamily={FONT_SANS} fontWeight="800" fontSize="58">不止一个选项</text>
          <g transform={`translate(${m.hit * 3} 0)`}>
            <text x="605" y="354" fill={C.ice} fontFamily={FONT_MONO} fontWeight="800" fontSize="91">3</text>
            <text x="675" y="349" fill={C.muted} fontFamily={FONT_SANS} fontSize="24">种配乐</text>
            <text x="605" y="435" fill={C.gold} fontFamily={FONT_MONO} fontWeight="800" fontSize="73">6</text>
            <text x="675" y="426" fill={C.muted} fontFamily={FONT_SANS} fontSize="24">套配色</text>
          </g>
        </g>
        <path d="M 68 478 H 892" stroke={`url(#settings-rail-${idx})`} strokeWidth={1.5 + m.hit * 2} />
        <g transform={`translate(0 ${Math.sin(m.f * 0.075) * 2})`}>
          <rect x="62" y="508" width="836" height="580" rx="18" fill="none" stroke={C.ice} strokeOpacity={0.15 + 0.18 * m.hit} />
          <path d={`M 66 ${525 + (m.f * 3.4) % 540} h 8 M 886 ${525 + (m.f * 3.4) % 540} h 8`} stroke={C.ice} strokeWidth="3" />
        </g>
        <g>
          <text x="68" y="1145" fill={C.muted} fontFamily={FONT_MONO} fontSize="18" letterSpacing="2">MUSIC SOURCE</text>
          {descriptions.map((label: string, i: number): React.ReactElement => (
            <g key={label} opacity={option === i ? 1 : 0} transform={`translate(0 ${option === i ? -m.hit * 2 : 0})`}>
              <rect x="68" y="1164" width="6" height="38" rx="3" fill={i === 2 ? C.gold : C.ice} />
              <text x="92" y="1197" fill={C.white} fontFamily={FONT_SANS} fontWeight="700" fontSize="35">{label}</text>
              <text x="820" y="1194" fill={C.ice} fontFamily={FONT_MONO} fontSize="22">0{i + 1}</text>
            </g>
          ))}
        </g>
        {modes.map((label: string, i: number): React.ReactElement => {
          const active = i === option;
          const x = 68 + i * 277;
          return (
            <g key={label}>
              <rect x={x} y="1240" width="260" height="65" rx="15" fill={active ? '#142D55' : C.surface} stroke={active ? C.ice : '#273143'} strokeWidth={active ? 2 : 1} />
              <circle cx={x + 22} cy="1272" r={active ? 5 + m.hit * 2 : 4} fill={active ? C.ice : '#4C586F'} />
              <text x={x + 40} y="1281" fill={active ? C.white : C.muted} fontFamily={FONT_SANS} fontSize="23" fontWeight={active ? '700' : '500'}>{label}</text>
            </g>
          );
        })}
        <text x="68" y="1370" fill={C.muted} fontFamily={FONT_SANS} fontSize="23">电影配色</text>
        {colors.map((color: string, i: number): React.ReactElement => {
          const x = 222 + i * 111;
          const active = i === selectedColor;
          return (
            <g key={color} transform={`translate(0 ${active ? -3 * m.hit : 0})`}>
              <rect x={x - 5} y="1337" width="87" height="47" rx="11" fill="none" stroke={active ? C.white : 'transparent'} strokeWidth="2" />
              <rect x={x} y="1342" width="77" height="37" rx="7" fill={color} opacity={active ? 1 : 0.6} />
              {active ? <path d={`M ${x + 28} 1360 l 7 7 l 14 -15`} fill="none" stroke={C.bg} strokeWidth="3" strokeLinecap="round" /> : null}
            </g>
          );
        })}
      </svg>
      <RealScreen scene={scene} x={68} y={514} width={824} height={570} lift={Math.sin(m.f * 0.075) * 2} />
    </AbsoluteFill>
  );
}

function Scene_scene_11({scene, idx, beats}: CustomSceneProps): React.ReactElement {
  const m = useMotion(scene, beats);
  const sweep = (m.f * 5.3) % 784;
  const current = Math.floor(m.half) % 7;
  const reveal = enter(m.f, 0, 10);
  const waveform = (phase: number): string => Array.from({length: 157}, (_v: unknown, i: number): string => {
    const x = 80 + i * 5;
    const envelope = 16 + 67 * Math.pow(Math.max(0, Math.sin(i * 0.059 + phase * 0.013)), 4);
    const y = 700 + Math.sin(i * 0.77 - phase * 0.17) * envelope + Math.sin(i * 1.9 + phase * 0.08) * 9;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
  const icons: string[] = [
    'M-20-18 L2-18 L-8 1 L20 1 L-10 25 L-3 7 L-23 7 Z',
    'M-25-15 H25 M-17 0 H33 M-25 15 H25',
    'M-25-20 H-5 V0 H15 V20 H35 M-25 0 H-5 V20 H15',
    'M0-24 A24 24 0 1 1-0.01-24 M0-12 A12 12 0 1 0 0.01-12',
    'M-26 22 L13-22 M-9 22 L30-22 M-26-13 L-18-22',
    'M-28 0 H27 M9-18 L28 0 L9 18',
    'M-26-19 H12 V11 H-26 Z M-11-7 H27 V23 H-11 Z'
  ];
  const titles: string[] = ['闪光', '切片', '块擦', '圆扩', '斜扫', '推移', '叠层'];
  return (
    <AbsoluteFill style={root}>
      <svg viewBox="0 0 1080 1920" style={fullSvg} aria-hidden="true">
        <defs>
          <radialGradient id={`rhythm-core-${idx}`}>
            <stop offset="0" stopColor={C.blue} stopOpacity="0.24" />
            <stop offset="1" stopColor={C.bg} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`rhythm-line-${idx}`} x1="0" x2="1">
            <stop offset="0" stopColor={C.blue} />
            <stop offset="0.6" stopColor={C.ice} />
            <stop offset="1" stopColor={C.gold} />
          </linearGradient>
          <clipPath id={`rhythm-wave-clip-${idx}`}><rect x="68" y="585" width="824" height="235" rx="18" /></clipPath>
        </defs>
        <rect width="1080" height="1920" fill={C.bg} />
        <ellipse cx={470 + 22 * m.p} cy="790" rx={570 + m.halfHit * 30} ry="790" fill={`url(#rhythm-core-${idx})`} />
        <g transform={`translate(0 ${-(m.f * 1.15) % 90})`}>
          {Array.from({length: 17}, (_v: unknown, i: number): React.ReactElement => <path key={i} d={`M 45 ${230 + i * 90} H 920`} stroke={C.ice} strokeOpacity="0.045" />)}
        </g>
        <g opacity={reveal} transform={`translate(0 ${(1 - reveal) * 25})`}>
          <text x="68" y="260" fill={C.ice} fontFamily={FONT_MONO} fontSize="20" letterSpacing="4">RHYTHM DRIVES THE CUT</text>
          <text x="64" y="341" fill={C.white} fontFamily={FONT_SANS} fontWeight="800" fontSize="61">半拍闪切</text>
          <text x="67" y="401" fill={C.muted} fontFamily={FONT_SANS} fontSize="35">鼓点，就是剪辑线</text>
        </g>
        <g transform={`translate(68 535) scale(${1 + 0.016 * m.halfHit})`}>
          <text fill={C.white} fontFamily={FONT_MONO} fontWeight="800" fontSize="144">0.5</text>
          <text x="282" y="-5" fill={C.ice} fontFamily={FONT_SANS} fontWeight="700" fontSize="46">拍</text>
        </g>
        <text x="542" y="475" fill={C.gold} fontFamily={FONT_MONO} fontWeight="700" fontSize="43">90—140</text>
        <text x="545" y="516" fill={C.muted} fontFamily={FONT_MONO} fontSize="25">BPM 鼓点分析</text>
        <rect x="68" y="585" width="824" height="235" rx="18" fill="#0B1220" stroke="#243249" />
        <g clipPath={`url(#rhythm-wave-clip-${idx})`}>
          {Array.from({length: 18}, (_v: unknown, i: number): React.ReactElement => {
            const x = 80 + ((i * 48 - m.f * 1.8) % 864 + 864) % 864;
            return <path key={i} d={`M ${x} 587 V 820`} stroke={C.ice} strokeOpacity={i % 4 === 0 ? 0.18 : 0.055} />;
          })}
          <path d="M 68 700 H 892" stroke={C.ice} strokeOpacity="0.16" />
          <path d={waveform(m.f - 5)} fill="none" stroke={C.blue} strokeWidth="8" opacity="0.14" />
          <path d={waveform(m.f)} fill="none" stroke={`url(#rhythm-line-${idx})`} strokeWidth={2.5 + m.halfHit} strokeLinejoin="round" />
          <rect x={80 + sweep - 35} y="586" width="70" height="234" fill={C.ice} opacity="0.055" />
          <path d={`M ${80 + sweep} 585 V 820`} stroke={C.white} strokeWidth="2" opacity="0.8" />
          {[226, 513, 753].map((x: number, i: number): React.ReactElement => (
            <g key={x} opacity={0.52 + 0.35 * Math.sin(m.f * 0.08 + i) ** 2}>
              <path d={`M ${x} 619 V 785`} stroke={C.gold} strokeDasharray="4 7" strokeOpacity="0.4" />
              <path d={`M ${x - 6} 610 l 6 8 l 6 -8 Z`} fill={C.gold} />
            </g>
          ))}
        </g>
        <text x="88" y="617" fill={C.muted} fontFamily={FONT_MONO} fontSize="16">FFmpeg / WAVEFORM</text>
        <text x="88" y="800" fill={C.gold} fontFamily={FONT_SANS} fontSize="18">高潮定位 · 分析示意</text>
        <text x="68" y="870" fill={C.muted} fontFamily={FONT_MONO} fontSize="20">118 BPM · 本片音乐网格</text>
        <text x="68" y="908" fill={C.muted} fontFamily={FONT_SANS} fontSize="21">装饰随半拍重击，镜头时长保持完整</text>
        <path d="M 82 983 H 875" stroke="#2B3C58" strokeWidth="2" />
        {Array.from({length: 17}, (_v: unknown, i: number): React.ReactElement => {
          const x = 82 + i * 49;
          const phase = ((m.half - i) % 4 + 4) % 4;
          const energy = Math.exp(-phase * 2.6);
          return <g key={i}><path d={`M ${x} ${i % 2 === 0 ? 959 : 970} V ${i % 2 === 0 ? 1007 : 996}`} stroke={i % 2 === 0 ? C.ice : C.muted} strokeWidth="2" /><circle cx={x} cy="983" r={3 + energy * 6} fill={energy > 0.5 ? C.gold : C.ice} opacity={0.4 + energy * 0.6} /></g>;
        })}
        <g transform={`translate(${82 + (m.half % 16) * 49} 983)`}>
          <circle r={12 + 20 * (1 - m.halfHit)} fill="none" stroke={C.gold} strokeWidth="2" opacity={m.halfHit} />
          <circle r="6" fill={C.white} />
        </g>
        <text x="68" y="1077" fill={C.white} fontFamily={FONT_SANS} fontWeight="700" fontSize="32">7 种矢量转场叠层</text>
        {icons.map((path: string, i: number): React.ReactElement => {
          const row = i < 4 ? 0 : 1;
          const column = i < 4 ? i : i - 4;
          const x = 68 + column * 210 + (row === 1 ? 50 : 0);
          const y = 1110 + row * 132;
          const opening = enter(m.f, 4 + i * 2, 16);
          const active = current === i;
          return (
            <g key={i} opacity={opening} transform={`translate(${x} ${y + (1 - opening) * 28 - (active ? m.halfHit * 5 : 0)})`}>
              <rect width="193" height="111" rx="14" fill={active ? '#172A47' : '#0E1520'} stroke={active ? C.ice : '#28354A'} strokeWidth={active ? 2 : 1} />
              <text x="13" y="24" fill={C.muted} fontFamily={FONT_MONO} fontSize="14">0{i + 1}</text>
              <g transform={`translate(${96 + (active ? Math.sin(m.f * 0.8) * m.halfHit * 5 : 0)} 46)`}>
                <path d={path} fill={i === 0 ? C.gold : 'none'} stroke={active ? C.white : C.ice} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </g>
              <text x="96" y="96" textAnchor="middle" fill={active ? C.white : C.muted} fontFamily={FONT_SANS} fontSize="20">{titles[i]}</text>
            </g>
          );
        })}
        {Array.from({length: 24}, (_v: unknown, i: number): React.ReactElement => {
          const age = ((m.half + i / 24) % 1);
          const angle = i * 2.39996;
          const radius = 35 + age * 185;
          return <circle key={i} cx={480 + Math.cos(angle) * radius} cy={980 + Math.sin(angle) * radius * 0.42} r={1 + (1 - age) * 2} fill={i % 3 === 0 ? C.gold : C.ice} opacity={(1 - age) * 0.65} />;
        })}
        {[0, 1, 2].map((n: number): React.ReactElement => (
          <path key={n} d={`M ${72 + n * 245 + m.halfHit * 14} ${555 + n * 2} h ${75 + m.halfHit * 75}`} stroke={C.ice} strokeWidth={2 + m.halfHit * 2} opacity={m.halfHit * 0.35} />
        ))}
      </svg>
    </AbsoluteFill>
  );
}

function Scene_scene_12({scene, idx, beats}: CustomSceneProps): React.ReactElement {
  const m = useMotion(scene, beats);
  const src = assetSource(scene);
  const opening = enter(m.f, 0, 12);
  const numberIn = enter(m.f, 3, 15);
  const magnifyIn = enter(m.f, 12, 16);
  const magnifyY = 1104 + Math.sin(m.f * 0.065) * 3;
  return (
    <AbsoluteFill style={root}>
      <svg viewBox="0 0 1080 1920" style={fullSvg} aria-hidden="true">
        <defs>
          <radialGradient id={`voice-radial-${idx}`} cx="45%" cy="40%" r="65%">
            <stop offset="0" stopColor={C.blue} stopOpacity="0.23" />
            <stop offset="1" stopColor={C.bg} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`voice-type-${idx}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="1" stopColor={C.ice} />
          </linearGradient>
          <clipPath id={`voice-orbit-clip-${idx}`}><rect x="46" y="225" width="856" height="1180" /></clipPath>
        </defs>
        <rect width="1080" height="1920" fill={C.bg} />
        <rect width="1080" height="1920" fill={`url(#voice-radial-${idx})`} />
        <g clipPath={`url(#voice-orbit-clip-${idx})`} transform={`translate(${m.p * 8} ${-m.p * 10})`}>
          {[0, 1, 2, 3].map((n: number): React.ReactElement => {
            const r = 242 + ((m.f * 1.65 + n * 88) % 352);
            return <ellipse key={n} cx="490" cy="760" rx={r} ry={r * 0.72} fill="none" stroke={C.ice} strokeWidth="1" opacity={0.12 * (1 - (r - 242) / 352)} />;
          })}
          {Array.from({length: 28}, (_v: unknown, i: number): React.ReactElement => {
            const angle = i * 2.39996 + m.f * 0.003;
            const radius = 260 + (i % 6) * 36;
            return <circle key={i} cx={480 + Math.cos(angle) * radius} cy={770 + Math.sin(angle) * radius * 1.1} r={1 + i % 3} fill={i % 5 === 0 ? C.gold : C.ice} opacity="0.3" />;
          })}
        </g>
        <g opacity={opening} transform={`translate(0 ${(1 - opening) * 20})`}>
          <text x="68" y="260" fill={C.ice} fontFamily={FONT_MONO} fontSize="20" letterSpacing="4">LOCAL VOICE / READY TO SPEAK</text>
          <text x="64" y="339" fill={C.white} fontFamily={FONT_SANS} fontWeight="800" fontSize="61">本地音色，直接开选</text>
        </g>
        <g opacity={numberIn} transform={`translate(68 493) scale(${0.9 + 0.1 * numberIn + m.hit * 0.012})`}>
          <text fill={`url(#voice-type-${idx})`} fontFamily={FONT_MONO} fontSize="142" fontWeight="800">204<tspan fill={C.gold} fontSize="96">+</tspan></text>
        </g>
        <text x="526" y="418" fill={C.ice} fontFamily={FONT_MONO} fontSize="31" fontWeight="700">IndexTTS-2.5</text>
        <text x="530" y="466" fill={C.muted} fontFamily={FONT_SANS} fontSize="27">本地音色库</text>
        <g transform={`translate(0 ${Math.sin(m.f * 0.055) * 2})`}>
          <rect x="62" y="532" width="836" height="546" rx="18" fill="none" stroke={C.ice} strokeOpacity={0.18 + m.hit * 0.16} />
          <path d="M 62 560 v -28 h 35 M 863 1078 h 35 v -28" fill="none" stroke={C.ice} strokeWidth="2" />
        </g>
        <path d={`M 173 1068 V ${1090 + Math.sin(m.f * 0.065) * 3} H 230 V ${magnifyY}`} fill="none" stroke={C.ice} strokeWidth="1.5" strokeDasharray="5 6" strokeDashoffset={-m.f * 0.65} opacity={magnifyIn * 0.65} />
        <g opacity={magnifyIn}>
          <rect x="64" y={magnifyY - 4} width="344" height="247" rx="16" fill={C.surface} stroke={C.ice} strokeOpacity="0.6" />
          <text x="82" y={magnifyY + 25} fill={C.ice} fontFamily={FONT_MONO} fontSize="16" letterSpacing="1">CATALOG / DETAIL</text>
        </g>
        <g transform={`translate(452 ${1148 - m.hit * 2})`}>
          <circle cx="8" cy="-10" r={5 + m.hit * 2} fill={C.ice} />
          <text x="27" y="0" fill={C.white} fontFamily={FONT_SANS} fontSize="34" fontWeight="700">常驻显存</text>
          <text x="27" y="44" fill={C.muted} fontFamily={FONT_SANS} fontSize="25">本地生成配音</text>
          {Array.from({length: 22}, (_v: unknown, i: number): React.ReactElement => {
            const amplitude = 5 + 26 * (0.5 + 0.5 * Math.sin(i * 0.79 + m.f * 0.22)) * (0.6 + m.hit * 0.4);
            return <rect key={i} x={28 + i * 15} y={91 - amplitude / 2} width="6" height={amplitude} rx="3" fill={i % 6 === 0 ? C.gold : C.ice} opacity="0.85" />;
          })}
          <text x="27" y="151" fill={C.muted} fontFamily={FONT_SANS} fontSize="24">支持 GPT-SoVITS 切换</text>
        </g>
        <path d="M 68 1381 H 890" stroke="#27374C" />
        <path d={`M 68 1381 H ${68 + 822 * m.p}`} stroke={C.ice} strokeWidth="2" strokeOpacity="0.55" />
      </svg>
      <RealScreen scene={scene} x={68} y={538} width={824} height={536} lift={Math.sin(m.f * 0.055) * 2} />
      {src ? (
        <div style={{position: 'absolute', left: 72, top: magnifyY + 40, width: 328, height: 195, borderRadius: 10, overflow: 'hidden', opacity: magnifyIn, backgroundColor: '#080B11', transform: `translateY(${(1 - magnifyIn) * 18}px)`}}>
          <Img src={src} style={{position: 'absolute', left: 0, top: '50%', width: 960, height: 'auto', maxWidth: 'none', transformOrigin: 'left center', transform: `translateY(-50%) scale(${1.01 + 0.035 * m.p})`}} />
          <div style={{position: 'absolute', inset: 0, border: '1px solid rgba(125,178,255,0.28)', borderRadius: 10, boxSizing: 'border-box', pointerEvents: 'none'}} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
}

export interface CustomSceneProps { scene: any; idx: number; total: number; beats: any[]; }
export const BATCH_04_SCENES: Record<string, React.FC<CustomSceneProps>> = {
  'scene-10': Scene_scene_10,
  'scene-11': Scene_scene_11,
  'scene-12': Scene_scene_12
};
