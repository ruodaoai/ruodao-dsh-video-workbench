import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {AppWindow, FocusShot, FONT_SANS, FONT_MONO} from '../lib/shotcraft';

const C = {
  bg: '#050608', surface: '#10141E', white: '#F1F5F9', muted: '#94A3B8',
  blue: '#2F7BFF', ice: '#7DB2FF', cyan: '#58E3E8', gold: '#F5B92E',
};
const clamp = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (v: number): number => { const x = clamp(v); return x * x * (3 - 2 * x); };
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeIn = (p: number, start: number, span = 0.14): number => smooth((p - start) / span);

function useMotion(scene: any, beats: any[]): {frame: number; seconds: number; p: number; pulse: number} {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const duration = Math.max(2, Number(scene.durationInFrames) || 107);
  const seconds = frame / fps;
  const p = clamp(frame / (duration - 1));
  const absoluteSeconds = (Number(scene.startSec) || 0) + seconds;
  const beatSeconds = 60 / 118;
  const phase = ((absoluteSeconds % beatSeconds) + beatSeconds) % beatSeconds;
  let pulse = Math.exp(-phase * 13);
  beats.forEach((beat: any): void => {
    const value: unknown = typeof beat === 'number' ? beat : beat?.timeSec ?? beat?.time ?? beat?.t ?? beat?.sec;
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    const distance = absoluteSeconds - value;
    if (distance >= 0 && distance < 0.3) pulse = Math.max(pulse, Math.exp(-distance * 15));
  });
  return {frame, seconds, p, pulse};
}

function getAsset(scene: any): string | undefined {
  const files: unknown = scene.publicAssetFiles;
  if (!Array.isArray(files)) return undefined;
  return files.find((file: unknown): file is string => typeof file === 'string' && file.length > 0);
}

const Kicker: React.FC<{text: string; color?: string}> = ({text, color = C.ice}) => (
  <div style={{fontFamily: FONT_MONO, fontSize: 20, letterSpacing: 3.2, color, lineHeight: 1.2}}>{text}</div>
);

const TrackTag: React.FC<{label: string; text: string; active: number; color: string}> = ({label, text, active, color}) => (
  <div style={{display: 'flex', alignItems: 'center', gap: 12, padding: '10px 17px', border: `1px solid ${color}`, borderRadius: 9, background: `rgba(16,20,30,${0.72 + active * 0.2})`, boxShadow: `0 0 ${active * 20}px ${color}33`}}>
    <span style={{fontFamily: FONT_MONO, color, fontWeight: 800, fontSize: 23}}>{label}</span>
    <span style={{fontSize: 23, color: C.white, fontWeight: 650}}>{text}</span>
  </div>
);

const FullScreenshot: React.FC<{scene: any; src: string; height: number}> = ({scene, src, height}) => (
  <AppWindow title={scene.title} kicker='DSH WORKBENCH' style={{width: '100%', height}}>
    <div style={{position: 'relative', width: '100%', height: height - 86, padding: 8, boxSizing: 'border-box', background: '#080B11'}}>
      <Img src={staticFile(src)} style={{position: 'absolute', inset: 8, width: 'calc(100% - 16px)', height: 'calc(100% - 16px)', objectFit: 'contain', objectPosition: 'center'}} />
    </div>
  </AppWindow>
);

const SourceDetail: React.FC<{src: string; label: string; focusY: number; p: number; color: string}> = ({src, label, focusY, p, color}) => (
  <div style={{width: '100%', height: '100%', border: `1px solid ${color}88`, borderRadius: 14, overflow: 'hidden', background: '#080B11', boxSizing: 'border-box'}}>
    <div style={{height: 36, display: 'flex', alignItems: 'center', gap: 9, padding: '0 13px', fontFamily: FONT_MONO, fontSize: 16, color, borderBottom: `1px solid ${color}44`}}>
      <span style={{display: 'inline-block', width: 6, height: 6, borderRadius: 6, background: color}} />
      {label}
    </div>
    <div style={{position: 'relative', height: 'calc(100% - 36px)', overflow: 'hidden'}}>
      <FocusShot src={src} cams={[
        {t: 0, fx: 0.5, fy: focusY, z: 1.7},
        {t: 1, fx: 0.5, fy: focusY, z: 1.7 + p * 0.16},
      ]} marks={[]} />
    </div>
  </div>
);

function voiceAt(t: number): number {
  const burstA = smooth((t - 0.25) / 0.12) * (1 - smooth((t - 1.22) / 0.17));
  const burstB = smooth((t - 1.69) / 0.12) * (1 - smooth((t - 2.65) / 0.19));
  return clamp(burstA + burstB);
}

function gainAt(t: number): number {
  const a = smooth((t - 0.25) / 0.08) * (1 - smooth((t - 1.27) / 0.47));
  const b = smooth((t - 1.69) / 0.08) * (1 - smooth((t - 2.70) / 0.48));
  return 1 - 0.72 * clamp(a + b);
}

function makeWave(kind: 'voice' | 'bgm' | 'sfx', seconds: number, center: number): string {
  const points: string[] = [];
  for (let i = 0; i <= 360; i++) {
    const x = 84 + (i / 360) * 780;
    const t = seconds + (i / 360 - 0.72) * 2.4;
    let value = 0;
    if (kind === 'voice') {
      value = voiceAt(t) * (Math.sin(t * 111) * 0.58 + Math.sin(t * 187) * 0.27 + Math.sin(t * 273) * 0.15) * 65;
    } else if (kind === 'bgm') {
      value = gainAt(t) * (Math.sin(t * 97) * 0.65 + Math.sin(t * 173) * 0.23 + Math.sin(t * 251) * 0.12) * 76;
    } else {
      const stab = Math.exp(-Math.pow((t - 0.62) / 0.055, 2)) + Math.exp(-Math.pow((t - 2.15) / 0.065, 2));
      value = Math.min(1.2, stab) * Math.sin(t * 263) * 69;
    }
    points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${(center - value).toFixed(2)}`);
  }
  return points.join(' ');
}

const Scene_scene_16: React.FC<CustomSceneProps> = ({scene, idx, beats}) => {
  const {frame, seconds, p, pulse} = useMotion(scene, beats);
  const gain = gainAt(seconds);
  const voice = voiceAt(seconds);
  const draw = easeIn(p, 0, 0.16);
  const signal = easeIn(p, 0.08, 0.18);
  const cameraScale = 1 + 0.012 * p + pulse * 0.003;
  const envUpper: string[] = [];
  const envLower: string[] = [];
  for (let i = 0; i <= 100; i++) {
    const x = 84 + i * 7.8;
    const t = seconds + (i / 100 - 0.72) * 2.4;
    const amplitude = gainAt(t) * 80;
    envUpper.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${(901 - amplitude).toFixed(2)}`);
    envLower.unshift(`L${x.toFixed(2)},${(901 + amplitude).toFixed(2)}`);
  }
  const envelope = `${envUpper.join(' ')} ${envLower.join(' ')} Z`;
  const particles = Array.from({length: 22}, (_: unknown, i: number): number => i);
  const sfxHit = Math.max(Math.exp(-Math.pow((seconds - 0.62) / 0.11, 2)), Math.exp(-Math.pow((seconds - 2.15) / 0.11, 2)));
  return (
    <AbsoluteFill style={{background: C.bg, fontFamily: FONT_SANS, overflow: 'hidden'}}>
      <svg width={1080} height={1920} viewBox='0 0 1080 1920' style={{position: 'absolute', inset: 0}}>
        <defs>
          <radialGradient id={`mix-bg-${idx}`} cx='42%' cy='40%' r='68%'>
            <stop offset='0%' stopColor='#102642' />
            <stop offset='62%' stopColor='#080F1B' />
            <stop offset='100%' stopColor={C.bg} />
          </radialGradient>
          <linearGradient id={`mix-env-${idx}`} x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={C.blue} stopOpacity={0.35} />
            <stop offset='50%' stopColor={C.blue} stopOpacity={0.05} />
            <stop offset='100%' stopColor={C.blue} stopOpacity={0.25} />
          </linearGradient>
          <filter id={`mix-glow-${idx}`} x='-50%' y='-100%' width='200%' height='300%'>
            <feGaussianBlur stdDeviation={5} />
          </filter>
          <clipPath id={`mix-reveal-${idx}`}><rect x={68} y={460} width={820 * draw} height={830} rx={16} /></clipPath>
        </defs>
        <rect width={1080} height={1920} fill={`url(#mix-bg-${idx})`} />
        {Array.from({length: 14}, (_: unknown, i: number): React.ReactNode => (
          <path key={`grid-${i}`} d={`M42 ${440 + i * 64} H904`} stroke='#24415F' strokeWidth={1} opacity={0.11 + 0.025 * Math.sin(seconds + i)} />
        ))}
        {particles.map((i: number): React.ReactNode => {
          const x = 45 + ((i * 137 + seconds * (14 + i % 4 * 5)) % 845);
          const y = 450 + ((i * 173 - seconds * 21 + 1500) % 900);
          return <circle key={`dust-${i}`} cx={x} cy={y} r={i % 3 === 0 ? 2 : 1} fill={C.ice} opacity={0.13 + 0.15 * (0.5 + 0.5 * Math.sin(seconds * 2 + i))} />;
        })}
        <g transform={`translate(470 890) scale(${cameraScale}) translate(-470 -890)`}>
          <g clipPath={`url(#mix-reveal-${idx})`}>
            <rect x={65} y={497} width={819} height={226} rx={18} fill='#0A1720' stroke='#1C4851' />
            <rect x={65} y={786} width={819} height={227} rx={18} fill='#0A1324' stroke='#234376' />
            <rect x={65} y={1080} width={819} height={213} rx={18} fill='#1B1710' stroke='#5B4924' />
            <path d='M84 612 H864 M84 901 H864 M84 1191 H864' stroke='#577087' strokeOpacity={0.23} />
            <path d={envelope} fill={`url(#mix-env-${idx})`} stroke={C.ice} strokeWidth={1.5} strokeOpacity={0.65} />
            <path d={makeWave('voice', seconds, 612)} fill='none' stroke={C.cyan} strokeWidth={6} opacity={0.26} filter={`url(#mix-glow-${idx})`} />
            <path d={makeWave('voice', seconds, 612)} fill='none' stroke={C.cyan} strokeWidth={2.6} />
            <path d={makeWave('bgm', seconds, 901)} fill='none' stroke={C.ice} strokeWidth={2.5} />
            <path d={makeWave('sfx', seconds, 1191)} fill='none' stroke={C.gold} strokeWidth={3} />
            <path d='M646 554 V1251' stroke='#F1F5F9' strokeWidth={1.3} strokeDasharray='5 7' opacity={0.45} />
            <circle cx={646} cy={612} r={5 + voice * 4} fill={C.cyan} />
            <circle cx={646} cy={901} r={5} fill={C.ice} />
          </g>
          <g opacity={signal}>
            <path d='M234 723 V752 H658 V786' fill='none' stroke={C.cyan} strokeOpacity={0.3} strokeWidth={2} />
            <path d='M234 723 V752 H658 V786' fill='none' stroke={C.cyan} strokeWidth={3} strokeDasharray='16 92' strokeDashoffset={-frame * 7} />
            <path d='M649 776 L658 786 L667 776' fill='none' stroke={C.cyan} strokeWidth={2.5} />
            <rect x={297} y={732} width={298} height={40} rx={7} fill='#0B2027' stroke='#28616B' />
            <text x={446} y={759} textAnchor='middle' fill={C.cyan} fontFamily={FONT_MONO} fontSize={21}>sidechaincompress</text>
          </g>
          <text x={86} y={537} fill={C.cyan} fontFamily={FONT_MONO} fontSize={23} fontWeight={700}>VOICE / 侧链检测</text>
          <text x={86} y={827} fill={C.ice} fontFamily={FONT_MONO} fontSize={23} fontWeight={700}>BGM / 自动闪避包络</text>
          <text x={86} y={1120} fill={C.gold} fontFamily={FONT_MONO} fontSize={23} fontWeight={700}>SFX / 独立音效轨</text>
          <text x={857} y={537} textAnchor='end' fill={C.cyan} fontFamily={FONT_SANS} fontSize={21}>{voice > 0.3 ? '人声进入' : '人声停顿'}</text>
          <text x={857} y={827} textAnchor='end' fill={C.ice} fontFamily={FONT_MONO} fontSize={23}>{Math.round(gain * 100)}% 示意增益</text>
          <text x={857} y={1120} textAnchor='end' fill={C.gold} fontFamily={FONT_SANS} fontSize={21}>不随 BGM 下压</text>
          <g transform={`translate(740 1184) scale(${1 + sfxHit * 0.16})`} opacity={0.3 + sfxHit * 0.7}>
            <path d='M-26 35 L18 -35 L2 -5 L35 -20 L-12 40 L1 10 Z' fill={C.gold} />
          </g>
          <text x={86} y={1266} fill='#B4A17D' fontFamily={FONT_SANS} fontSize={21}>刀光瞬态</text>
          <text x={748} y={1266} fill='#B4A17D' fontFamily={FONT_SANS} fontSize={21}>重击保留</text>
        </g>
        <path d={`M66 1354 H${66 + 818 * p}`} stroke={C.cyan} strokeWidth={2} opacity={0.4} />
        <circle cx={66 + 818 * p} cy={1354} r={4 + pulse * 2} fill={C.cyan} />
        <text x={66} y={1394} fill={C.muted} fontFamily={FONT_SANS} fontSize={21}>混音原理示意 · 波形与增益非实测数据</text>
      </svg>
      <div style={{position: 'absolute', left: 58, top: 236, width: 842, transform: `translateY(${(1 - draw) * 20}px)`, opacity: draw}}>
        <Kicker text='FFMPEG / AUDIO SIDECHAIN' color={C.cyan} />
        <div style={{marginTop: 24, color: C.white, fontSize: 63, fontWeight: 850, letterSpacing: -2, lineHeight: 1.18}}>人声出现，音乐自动让位</div>
        <div style={{display: 'flex', alignItems: 'center', gap: 14, marginTop: 22, color: C.muted, fontSize: 27}}>
          <span style={{color: C.cyan}}>人声触发</span><span>↓</span><span style={{color: C.ice}}>BGM 下压</span><span>·</span><span style={{color: C.gold}}>重击照样有力</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Scene_scene_17: React.FC<CustomSceneProps> = ({scene, idx, beats}) => {
  const {frame, seconds, p, pulse} = useMotion(scene, beats);
  const src = getAsset(scene);
  const entry = easeIn(p, 0, 0.14);
  const stages: string[] = ['单幕选择', '对 AI 说', '单幕重修'];
  const stage = Math.min(2, Math.floor(p * 3));
  const detailReveal = easeIn(p, 0.15, 0.18);
  const screenshotScale = 0.994 + 0.006 * p;
  return (
    <AbsoluteFill style={{background: C.bg, fontFamily: FONT_SANS, overflow: 'hidden'}}>
      <svg width={1080} height={1920} viewBox='0 0 1080 1920' style={{position: 'absolute', inset: 0}}>
        <defs>
          <linearGradient id={`refine-bg-${idx}`} x1='0' y1='0' x2='1' y2='1'>
            <stop offset='0%' stopColor='#10203B' />
            <stop offset='58%' stopColor='#070B13' />
            <stop offset='100%' stopColor='#050608' />
          </linearGradient>
          <linearGradient id={`refine-rail-${idx}`} x1='0' y1='0' x2='1' y2='0'>
            <stop offset='0%' stopColor={C.blue} stopOpacity={0} />
            <stop offset='50%' stopColor={C.ice} />
            <stop offset='100%' stopColor={C.blue} stopOpacity={0} />
          </linearGradient>
        </defs>
        <rect width={1080} height={1920} fill={`url(#refine-bg-${idx})`} />
        <g transform={`translate(${Math.sin(seconds * 0.5) * 5} ${-p * 14})`}>
          {Array.from({length: 9}, (_: unknown, i: number): React.ReactNode => (
            <path key={`rail-${i}`} d={`M${52 + i * 104} 450 V1400`} fill='none' stroke={C.blue} strokeWidth={1} opacity={0.05 + (i % 3) * 0.025} />
          ))}
          <path d='M35 492 V1072 H895' fill='none' stroke={C.blue} strokeOpacity={0.35} strokeWidth={2} />
          <path d='M35 492 V1072 H895' fill='none' stroke={C.ice} strokeWidth={3} strokeDasharray='46 210' strokeDashoffset={-frame * 5} />
        </g>
        {Array.from({length: 13}, (_: unknown, i: number): React.ReactNode => (
          <rect key={`fragment-${i}`} x={50 + (i * 179 + seconds * 22) % 840} y={450 + (i * 73) % 900} width={4 + i % 4 * 3} height={2} fill={C.ice} opacity={0.1 + 0.13 * Math.sin(seconds * 2 + i) ** 2} />
        ))}
        <path d='M70 1083 H855' stroke={`url(#refine-rail-${idx})`} strokeWidth={2} opacity={0.4 + pulse * 0.25} />
      </svg>
      <div style={{position: 'absolute', left: 52, top: 236, width: 850, opacity: entry, transform: `translateX(${(1 - entry) * -28}px)`}}>
        <Kicker text='TIMELINE / SCENE-LEVEL REFINE' />
        <div style={{fontSize: 61, color: C.white, fontWeight: 850, letterSpacing: -2, marginTop: 23, lineHeight: 1.18}}>不满意哪一幕，就改哪一幕</div>
        <div style={{fontSize: 27, color: C.muted, marginTop: 20}}>只改选中分镜，不必全片重来</div>
      </div>
      <div style={{position: 'absolute', left: 49, top: 411, width: 854, display: 'flex', justifyContent: 'space-between', gap: 20, opacity: entry}}>
        <TrackTag label='V1' text='分镜轨' active={0.5 + pulse * 0.5} color={C.ice} />
        <div style={{display: 'flex', alignItems: 'center', color: C.muted, fontFamily: FONT_MONO, fontSize: 16}}>真实界面 · 完整展示</div>
        <TrackTag label='A1' text='混音轨' active={0.45 + pulse * 0.45} color={C.cyan} />
      </div>
      {src ? (
        <div style={{position: 'absolute', left: 44, top: 482, width: 862, height: 578, transform: `translateY(${(1 - entry) * 20}px) scale(${screenshotScale})`, transformOrigin: 'center center', opacity: entry}}>
          <FullScreenshot scene={scene} src={src} height={578} />
        </div>
      ) : (
        <div style={{position: 'absolute', left: 55, top: 650, width: 810, color: C.muted, fontSize: 30}}>未提供时间线截图，未生成替代界面。</div>
      )}
      <div style={{position: 'absolute', left: 54, top: 1082, width: 838, display: 'flex', alignItems: 'center', gap: 12}}>
        {stages.map((label: string, i: number): React.ReactNode => {
          const active = stage === i;
          const completed = stage > i;
          return (
            <React.Fragment key={label}>
              <div style={{flex: 1, minWidth: 0, padding: '12px 5px', textAlign: 'center', borderBottom: `3px solid ${active ? C.ice : completed ? '#395F92' : '#243044'}`, color: active ? C.white : C.muted, fontSize: 24, fontWeight: active ? 800 : 500, background: active ? '#142742' : 'transparent', transform: `translateY(${active ? -pulse * 2 : 0}px)`}}>
                <span style={{fontFamily: FONT_MONO, fontSize: 18, color: active ? C.ice : '#637184', marginRight: 8}}>0{i + 1}</span>{label}
              </div>
              {i < stages.length - 1 ? <span style={{color: '#42699D', fontSize: 24}}>→</span> : null}
            </React.Fragment>
          );
        })}
      </div>
      <div style={{position: 'absolute', left: 52, top: 1170, width: 352, height: 207, opacity: detailReveal, transform: `translateY(${(1 - detailReveal) * 16}px)`}}>
        {src ? <SourceDetail src={src} label='时间线 / 原图局部放大' focusY={0.72} p={p} color={C.ice} /> : null}
      </div>
      <div style={{position: 'absolute', left: 432, top: 1172, width: 464, opacity: detailReveal}}>
        <div style={{fontFamily: FONT_MONO, fontSize: 27, color: C.ice, letterSpacing: -0.5}}>ai_refine_scene</div>
        <div style={{marginTop: 15, color: C.white, fontSize: 35, fontWeight: 800}}>对 AI 说，单幕重修</div>
        <div style={{marginTop: 15, display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 22}}>
          <span style={{padding: '7px 12px', color: C.cyan, border: '1px solid #24525A', borderRadius: 6}}>单幕重配</span>
          <span style={{padding: '7px 12px', color: C.ice, border: '1px solid #294A78', borderRadius: 6}}>AI 声学修音</span>
        </div>
        <div style={{marginTop: 12, color: C.muted, fontSize: 17}}>功能入口说明 · 未模拟重修结果</div>
      </div>
    </AbsoluteFill>
  );
};

const Scene_scene_18: React.FC<CustomSceneProps> = ({scene, idx, beats}) => {
  const {frame, seconds, p, pulse} = useMotion(scene, beats);
  const src = getAsset(scene);
  const entry = easeIn(p, 0, 0.12);
  const controls: {label: string; sub: string; color: string; icon: 'pause' | 'play' | 'stop' | 'retry'}[] = [
    {label: '暂停', sub: 'PAUSE', color: C.ice, icon: 'pause'},
    {label: '恢复', sub: 'RESUME', color: C.cyan, icon: 'play'},
    {label: '强停子进程', sub: 'STOP PROCESS', color: C.gold, icon: 'stop'},
    {label: '断点单步重试', sub: 'STEP RETRY', color: C.ice, icon: 'retry'},
  ];
  const activeControl = Math.min(3, Math.floor(p * 4));
  const detailIn = easeIn(p, 0.08, 0.2);
  return (
    <AbsoluteFill style={{background: C.bg, fontFamily: FONT_SANS, overflow: 'hidden'}}>
      <svg width={1080} height={1920} viewBox='0 0 1080 1920' style={{position: 'absolute', inset: 0}}>
        <defs>
          <radialGradient id={`monitor-bg-${idx}`} cx='44%' cy='42%' r='70%'>
            <stop offset='0%' stopColor='#13232F' />
            <stop offset='62%' stopColor='#09111D' />
            <stop offset='100%' stopColor={C.bg} />
          </radialGradient>
          <linearGradient id={`monitor-flow-${idx}`} x1='0' y1='0' x2='1' y2='0'>
            <stop offset='0%' stopColor={C.cyan} stopOpacity={0} />
            <stop offset='50%' stopColor={C.cyan} stopOpacity={0.7} />
            <stop offset='100%' stopColor={C.blue} stopOpacity={0} />
          </linearGradient>
        </defs>
        <rect width={1080} height={1920} fill={`url(#monitor-bg-${idx})`} />
        <g transform={`translate(473 729) rotate(${-2 + p * 4})`}>
          <ellipse rx={445} ry={343} fill='none' stroke='#3C7595' strokeOpacity={0.12} strokeWidth={1} />
          <ellipse rx={458} ry={356} fill='none' stroke='#3C7595' strokeOpacity={0.12} strokeWidth={1} strokeDasharray='5 18' strokeDashoffset={-frame * 1.1} />
        </g>
        <path d='M30 481 V995 H897' fill='none' stroke='#2C566C' strokeOpacity={0.42} strokeWidth={2} />
        <path d='M30 481 V995 H897' fill='none' stroke={C.cyan} strokeWidth={3} strokeDasharray='19 173' strokeDashoffset={-frame * 6} />
        {Array.from({length: 18}, (_: unknown, i: number): React.ReactNode => {
          const x = 49 + (i * 127 + seconds * (8 + i % 4 * 3)) % 844;
          const y = 460 + (i * 97 + seconds * 13) % 910;
          return <circle key={`monitor-dot-${i}`} cx={x} cy={y} r={i % 4 === 0 ? 2.3 : 1.2} fill={i % 3 === 0 ? C.cyan : C.ice} opacity={0.1 + 0.13 * Math.sin(i + seconds) ** 2} />;
        })}
        <path d='M60 1152 H895' stroke={`url(#monitor-flow-${idx})`} strokeWidth={2} />
      </svg>
      <div style={{position: 'absolute', top: 236, left: 52, width: 850, opacity: entry, transform: `translateY(${(1 - entry) * 20}px)`}}>
        <Kicker text='TASK CONTROL / OBSERVABILITY' color={C.cyan} />
        <div style={{fontSize: 62, fontWeight: 850, color: C.white, letterSpacing: -2, lineHeight: 1.18, marginTop: 23}}>任务可控，出错有路可退</div>
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 23, color: C.muted, fontSize: 26}}>
          <span>暂停 · 恢复 · 强停 · 重试</span>
          <span style={{fontFamily: FONT_MONO, fontSize: 18, color: C.cyan}}>子进程调度</span>
        </div>
      </div>
      {src ? (
        <div style={{position: 'absolute', left: 44, top: 441, width: 862, height: 552, opacity: entry, transform: `translateY(${(1 - entry) * 24}px) scale(${lerp(0.995, 1, p)})`, transformOrigin: 'center'}}>
          <FullScreenshot scene={scene} src={src} height={552} />
        </div>
      ) : (
        <div style={{position: 'absolute', left: 55, top: 650, width: 810, color: C.muted, fontSize: 30}}>未提供任务监控截图，未生成替代界面。</div>
      )}
      <div style={{position: 'absolute', left: 52, top: 1014, width: 842, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px'}}>
        {controls.map((control: {label: string; sub: string; color: string; icon: 'pause' | 'play' | 'stop' | 'retry'}, i: number): React.ReactNode => {
          const active = activeControl === i;
          const appeared = easeIn(p, i * 0.065, 0.12);
          return (
            <div key={control.label} style={{height: 56, display: 'flex', alignItems: 'center', gap: 13, padding: '0 14px', boxSizing: 'border-box', borderRadius: 8, background: active ? '#142330' : '#0B111B', border: `1px solid ${active ? control.color : '#263344'}`, opacity: 0.48 + appeared * 0.52, boxShadow: active ? `0 0 ${9 + pulse * 12}px ${control.color}22` : 'none', transform: `translateX(${active ? Math.sin(frame * 0.3) * pulse * 0.6 : 0}px)`}}>
              <svg width={25} height={25} viewBox='0 0 25 25' style={{flexShrink: 0}}>
                {control.icon === 'pause' ? <g fill={control.color}><rect x={5} y={5} width={5} height={15} rx={1} /><rect x={15} y={5} width={5} height={15} rx={1} /></g> : null}
                {control.icon === 'play' ? <path d='M7 4 L22 12.5 L7 21 Z' fill={control.color} /> : null}
                {control.icon === 'stop' ? <rect x={5} y={5} width={15} height={15} rx={2} fill={control.color} /> : null}
                {control.icon === 'retry' ? <g fill='none' stroke={control.color} strokeWidth={2.1} strokeLinecap='round' strokeLinejoin='round'><path d='M19 9 A8 8 0 1 0 20 16' /><path d='M19 3 V10 H12' /></g> : null}
              </svg>
              <span style={{fontSize: 25, fontWeight: active ? 800 : 600, color: active ? C.white : '#B5C2D0', whiteSpace: 'nowrap'}}>{control.label}</span>
              <span style={{marginLeft: 'auto', fontFamily: FONT_MONO, fontSize: 11, letterSpacing: 0.5, color: active ? control.color : '#62758A'}}>{control.sub}</span>
            </div>
          );
        })}
      </div>
      <div style={{position: 'absolute', left: 52, top: 1180, width: 354, height: 202, opacity: detailIn, transform: `translateY(${(1 - detailIn) * 15}px)`}}>
        {src ? <SourceDetail src={src} label='日志观察 / 原图局部' focusY={0.81} p={p} color={C.cyan} /> : null}
      </div>
      <div style={{position: 'absolute', left: 436, top: 1185, width: 455, opacity: detailIn}}>
        <div style={{fontFamily: FONT_MONO, color: C.cyan, fontSize: 21, letterSpacing: 2}}>REAL-TIME LOGS</div>
        <div style={{marginTop: 14, fontSize: 43, fontWeight: 850, color: C.white, lineHeight: 1.18}}>每一步，都可追</div>
        <div style={{marginTop: 18, color: C.ice, fontSize: 25}}>断点单步重试 · 实时日志</div>
        <div style={{marginTop: 14, color: C.muted, fontSize: 18, lineHeight: 1.4}}>控制能力说明，非实际执行记录</div>
      </div>
    </AbsoluteFill>
  );
};

export interface CustomSceneProps { scene: any; idx: number; total: number; beats: any[]; }
export const BATCH_06_SCENES: Record<string, React.FC<CustomSceneProps>> = {
  'scene-16': Scene_scene_16,
  'scene-17': Scene_scene_17,
  'scene-18': Scene_scene_18
};