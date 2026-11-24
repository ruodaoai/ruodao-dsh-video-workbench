import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_SANS, FONT_MONO} from '../lib/shotcraft';

const REPOSITORY_URL = 'https://github.com/Merziller/dsh-video-workbench';
const CLONE_COMMAND = 'git clone https://github.com/Merziller/dsh-video-workbench.git';
const TAU = Math.PI * 2;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smooth = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const starPath = (outer: number, inner: number): string => {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const radius = i % 2 === 0 ? outer : inner;
    points.push(`${i === 0 ? 'M' : 'L'}${Math.cos(angle) * radius},${Math.sin(angle) * radius}`);
  }
  return `${points.join(' ')} Z`;
};

type Particle = {angle: number; phase: number; speed: number; radius: number; size: number};
const PARTICLES: Particle[] = Array.from({length: 44}, (_unused: unknown, i: number): Particle => ({
  angle: i * 2.3999632297,
  phase: ((i * 37) % 101) / 101,
  speed: 0.1 + (i % 5) * 0.017,
  radius: 290 + (i % 7) * 11,
  size: i % 6 === 0 ? 3 : 1.4,
}));
const GRID_LINES: number[] = Array.from({length: 13}, (_unused: unknown, i: number): number => i);
const ORBIT_TICKS: number[] = Array.from({length: 40}, (_unused: unknown, i: number): number => i);
const CIRCUITS: string[] = [
  'M106 474 H186 L238 526 V624 L312 698 H405',
  'M894 474 H814 L762 526 V624 L688 698 H595',
  'M104 1212 H194 L234 1172 V1156',
  'M892 1212 H802 L762 1172 V1156',
];

const Scene_scene_22: React.FC<CustomSceneProps> = ({scene, idx}) => {
  const frame = Math.max(0, useCurrentFrame());
  const {fps} = useVideoConfig();
  const rawDuration = Number(scene?.durationInFrames);
  const duration = Number.isFinite(rawDuration) && rawDuration > 1 ? rawDuration : 157;
  const progress = clamp01(frame / (duration - 1));
  const seconds = frame / fps;
  const beatFrames = (fps * 60) / 118;
  const beatPosition = frame / beatFrames;
  const beatFraction = beatPosition - Math.floor(beatPosition);
  const pulse = Math.exp(-beatFraction * 7.5);
  const ignite = smooth((frame - beatFrames * 0.65) / (beatFrames * 0.75));
  const charge = interpolate(progress, [0, 0.18, 0.72, 1], [0.15, 0.52, 0.9, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const cameraScale = 1 + progress * 0.006 + pulse * 0.002;
  const cameraX = Math.sin(seconds * 0.7) * 1.4;
  const cameraY = -progress * 3 + Math.sin(seconds * 0.9) * 1.2;
  const starScale = 1 + ignite * 0.055 + pulse * 0.032;
  const ringCircumference = TAU * 121;
  const id = `scene22-${idx}`;
  const star = starPath(73, 33);
  const starFill = ignite > 0.02 ? `url(#${id}-gold)` : '#80692D';
  const cameraTransform = `translate(${cameraX} ${cameraY}) translate(500 800) scale(${cameraScale}) translate(-500 -800)`;

  return (
    <AbsoluteFill style={{backgroundColor: '#050608', overflow: 'hidden', fontFamily: FONT_SANS}}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="100%" height="100%" role="img" aria-label="DSH Video Workbench MIT 开源仓库。https://github.com/Merziller/dsh-video-workbench。点亮 Star，立即免费上手。">
        <defs>
          <radialGradient id={`${id}-atmosphere`} cx="46%" cy="41%" r="63%">
            <stop offset="0%" stopColor="#173663" stopOpacity="0.78" />
            <stop offset="49%" stopColor="#0B162B" stopOpacity="0.61" />
            <stop offset="100%" stopColor="#050608" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-halo`}>
            <stop offset="0%" stopColor="#F5B92E" stopOpacity="0.3" />
            <stop offset="45%" stopColor="#F5B92E" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#F5B92E" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0.7" y2="1">
            <stop offset="0%" stopColor="#FFF4C7" />
            <stop offset="48%" stopColor="#FFD365" />
            <stop offset="100%" stopColor="#EAA21A" />
          </linearGradient>
          <linearGradient id={`${id}-plate`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#172D50" />
            <stop offset="52%" stopColor="#101D32" />
            <stop offset="100%" stopColor="#0C1422" />
          </linearGradient>
          <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#2F7BFF" />
            <stop offset="49%" stopColor="#D7E8FF" />
            <stop offset="100%" stopColor="#2F7BFF" />
          </linearGradient>
          <linearGradient id={`${id}-sweep`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#7DB2FF" stopOpacity="0" />
            <stop offset="50%" stopColor="#BBD7FF" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#7DB2FF" stopOpacity="0" />
          </linearGradient>
          <filter id={`${id}-glow`} x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <clipPath id={`${id}-plate-clip`}>
            <rect x="88" y="729" width="802" height="238" rx="24" />
          </clipPath>
        </defs>

        <rect width="1080" height="1920" fill="#050608" />
        <rect width="1080" height="1680" fill={`url(#${id}-atmosphere)`} />
        <g opacity="0.13" stroke="#4776B3" strokeWidth="1">
          {GRID_LINES.map((line: number): React.ReactNode => (
            <React.Fragment key={`grid-${line}`}>
              <path d={`M${70 + line * 80} 223 L${70 + line * 80 + Math.sin(seconds * 0.2) * 9} 1440`} />
              <path d={`M40 ${236 + line * 96 + ((seconds * 10) % 96)} H1010`} />
            </React.Fragment>
          ))}
        </g>
        <path d="M50 1438 H1010" stroke="#2F7BFF" strokeOpacity="0.17" />

        <g transform={cameraTransform}>
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            {CIRCUITS.map((path: string, i: number): React.ReactNode => (
              <React.Fragment key={`circuit-${i}`}>
                <path d={path} stroke="#253B5B" strokeWidth="2" />
                <path d={path} stroke={i < 2 ? '#7DB2FF' : '#F5B92E'} strokeWidth="3" strokeDasharray="28 410" strokeDashoffset={-frame * 4 - i * 80} opacity="0.62" />
              </React.Fragment>
            ))}
          </g>

          <g aria-hidden="true">
            {PARTICLES.map((particle: Particle, i: number): React.ReactNode => {
              const cycle = (particle.phase + seconds * particle.speed) % 1;
              const remain = 1 - cycle;
              const angle = particle.angle + seconds * 0.05;
              const x = 500 + Math.cos(angle) * particle.radius * remain;
              const y = 841 + Math.sin(angle) * 550 * remain;
              const tailX = 500 + Math.cos(angle) * particle.radius * Math.min(1, remain + 0.055);
              const tailY = 841 + Math.sin(angle) * 550 * Math.min(1, remain + 0.055);
              const opacity = Math.sin(cycle * Math.PI) * 0.64;
              const color = i % 5 === 0 ? '#FFD365' : '#7DB2FF';
              return (
                <g key={`particle-${i}`} opacity={opacity}>
                  <path d={`M${tailX} ${tailY} L${x} ${y}`} stroke={color} strokeWidth="1.25" />
                  <circle cx={x} cy={y} r={particle.size} fill={color} />
                </g>
              );
            })}
          </g>

          <g fontFamily={FONT_SANS} textAnchor="middle">
            <g transform="translate(500 247)">
              <path d="M-168 0 H-114 M114 0 H168" stroke="#7DB2FF" strokeOpacity="0.6" />
              <text y="7" fill="#A8C9FF" fontSize="20" fontFamily={FONT_MONO} letterSpacing="4">OPEN SOURCE</text>
            </g>
            <text x="500" y="325" fill="#F1F5F9" fontSize="72" fontWeight="850" letterSpacing="9">DSH</text>
            <text x="500" y="387" fill="#F1F5F9" fontSize="54" fontWeight="800" textLength="753" lengthAdjust="spacingAndGlyphs">VIDEO WORKBENCH</text>
            <rect x="295" y="412" width="410" height="47" rx="23.5" fill="#182018" stroke="#F5B92E" strokeOpacity="0.62" />
            <circle cx="325" cy="435.5" r="5" fill="#F5B92E" />
            <text x="512" y="444" fill="#F8D883" fontSize="22" fontWeight="650">MIT License · 免费可商用</text>
          </g>

          <g transform="translate(500 586)">
            <circle r={178 + pulse * 9} fill={`url(#${id}-halo)`} opacity={0.5 + ignite * 0.5} />
            <circle r="121" fill="none" stroke="#294061" strokeWidth="1.5" />
            <circle r="121" fill="none" stroke="#7DB2FF" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${ringCircumference * charge} ${ringCircumference}`} transform="rotate(-90)" opacity="0.85" />
            <g transform={`rotate(${seconds * 9})`}>
              {ORBIT_TICKS.map((tick: number): React.ReactNode => {
                const angle = (tick / 40) * TAU;
                const innerRadius = tick % 5 === 0 ? 131 : 136;
                return <path key={`tick-${tick}`} d={`M${Math.cos(angle) * innerRadius} ${Math.sin(angle) * innerRadius} L${Math.cos(angle) * 142} ${Math.sin(angle) * 142}`} stroke={tick % 5 === 0 ? '#F5B92E' : '#7DB2FF'} strokeWidth={tick % 5 === 0 ? 2.5 : 1} opacity={tick % 5 === 0 ? 0.9 : 0.4} />;
              })}
            </g>
            {[0, 1, 2].map((ring: number): React.ReactNode => {
              const cycle = (beatPosition * 0.5 + ring / 3) % 1;
              return <circle key={`wave-${ring}`} r={77 + cycle * 96} fill="none" stroke="#F5B92E" strokeWidth="1.8" opacity={(1 - cycle) * 0.28 * (0.3 + ignite * 0.7)} />;
            })}
            <g transform={`rotate(${Math.sin(seconds * 1.3) * 3}) scale(${starScale})`}>
              <path d={star} fill={starFill} stroke="#FFE7A0" strokeWidth="2.4" filter={`url(#${id}-glow)`} />
              <path d="M0 -48 L13 -10 L-20 10 Z" fill="#FFFFFF" opacity={0.2 + pulse * 0.24} />
            </g>
            <circle cx="0" cy="0" r={90 + pulse * 7} fill="none" stroke="#F5B92E" strokeWidth="1" opacity={0.12 + pulse * 0.2} />
          </g>

          <g>
            <rect x="88" y="729" width="802" height="238" rx="24" fill={`url(#${id}-plate)`} stroke={`url(#${id}-edge)`} strokeWidth="2" />
            <g clipPath={`url(#${id}-plate-clip)`}>
              <path d="M88 730 H890" stroke="#D1E4FF" strokeWidth="4" opacity={0.65 + pulse * 0.3} />
              <rect x={-300 + ((frame * 8) % 1450)} y="729" width="180" height="238" fill={`url(#${id}-sweep)`} transform="skewX(-18)" />
            </g>
            <g fontFamily={FONT_SANS}>
              <g transform="translate(120 760)" fill="none" stroke="#8EBBFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M0 14 V-3 Q0 -7 4 -7 H18 V16 H4 Q0 16 0 20 Q0 24 4 24 H19" />
                <path d="M4 17 H18 V24 M5 -1 H12" />
              </g>
              <text x="157" y="772" fill="#A9CFFF" fontSize="22" fontWeight="700">GitHub 开源仓库</text>
              <circle cx="850" cy="764" r={4 + pulse * 1.5} fill="#F5B92E" />
              <rect x="106" y="791" width="766" height="59" rx="9" fill="#07101B" stroke="#88B8FF" strokeOpacity="0.63" />
              <text x="489" y="829" textAnchor="middle" fill="#FFFFFF" fontFamily={FONT_MONO} fontSize="27" fontWeight="750" textLength="744" lengthAdjust="spacingAndGlyphs">{REPOSITORY_URL}</text>
              <text x="489" y="903" textAnchor="middle" fill="#D8E8FF" fontFamily={FONT_MONO} fontSize="40" fontWeight="700" textLength="715" lengthAdjust="spacingAndGlyphs">dsh-video-workbench</text>
              <text x="489" y="942" textAnchor="middle" fill="#91AFD5" fontFamily={FONT_MONO} fontSize="23" letterSpacing="2">Merziller / OPEN SOURCE</text>
            </g>
          </g>

          <g fontFamily={FONT_MONO}>
            <rect x="88" y="1001" width="802" height="137" rx="17" fill="#0B121E" stroke="#365272" strokeWidth="1.4" />
            <path d="M111 1026 L119 1033 L111 1040 M127 1041 H138" fill="none" stroke="#7DB2FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <text x="151" y="1040" fill="#98B6D9" fontSize="19" letterSpacing="1.3">CLONE &amp; BUILD</text>
            <path d="M106 1055 H872" stroke="#273A52" />
            <text x="489" y="1098" textAnchor="middle" fill="#E0EDFF" fontSize="21" textLength="750" lengthAdjust="spacingAndGlyphs">{CLONE_COMMAND}</text>
            <rect x="850" y="1117" width="15" height="3" fill="#F5B92E" opacity={0.5 + 0.5 * Math.sin(seconds * 5) ** 2} />
          </g>

          <g textAnchor="middle" fontFamily={FONT_SANS}>
            <g transform={`translate(500 1236) scale(${1 + pulse * 0.008})`}>
              <path d="M-350 -40 H-322 M-350 -40 V-12 M350 -40 H322 M350 -40 V-12 M-350 42 H-322 M-350 42 V14 M350 42 H322 M350 42 V14" fill="none" stroke="#F5B92E" strokeWidth="3" opacity={0.65 + pulse * 0.3} />
              <text x="0" y="17" fontSize="55" fontWeight="850" fill="#F1F5F9"><tspan>点亮 </tspan><tspan fill="#FFD365">Star</tspan><tspan> · 立即上手</tspan></text>
            </g>
            <text x="500" y="1332" fontSize="31" fill="#BFD7FA" fontWeight="600" letterSpacing="4">开源 · 免费 · 可商用</text>
            <g transform="translate(500 1378)">
              <path d="M-165 0 H-26 M26 0 H165" stroke="#41618B" />
              <path d={starPath(9, 4)} fill="#F5B92E" transform={`rotate(${seconds * 12})`} />
            </g>
          </g>
        </g>
      </svg>
    </AbsoluteFill>
  );
};

export interface CustomSceneProps { scene: any; idx: number; total: number; beats: any[]; }
export const BATCH_08_SCENES: Record<string, React.FC<CustomSceneProps>> = {
  'scene-22': Scene_scene_22
};
