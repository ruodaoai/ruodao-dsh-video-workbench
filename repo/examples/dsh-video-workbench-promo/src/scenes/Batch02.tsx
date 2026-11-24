import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {AppWindow, FocusShot, FONT_SANS, FONT_MONO} from '../lib/shotcraft';

const C: {bg: string; surface: string; white: string; muted: string; blue: string; ice: string; gold: string} = {
  bg: '#050608', surface: '#10141E', white: '#F1F5F9', muted: '#94A3B8', blue: '#2F7BFF', ice: '#7DB2FF', gold: '#F5B92E',
};

type Motion = {frame: number; fps: number; p: number; pulse: number; beat: number};
type Point = {x: number; y: number};
type Protocol = {name: string; api: string; x: number; y: number; color: string};

const clamp = (n: number, low = 0, high = 1): number => Math.min(high, Math.max(low, n));
const ease = (n: number): number => 1 - Math.pow(1 - clamp(n), 3);
const reveal = (frame: number, start: number, length = 10): number => ease((frame - start) / length);

function beatTime(entry: unknown): number | null {
  if (typeof entry === 'number' && Number.isFinite(entry)) return entry;
  if (typeof entry !== 'object' || entry === null) return null;
  const data = entry as Record<string, unknown>;
  for (const key of ['timeSec', 'time', 'sec', 't', 'startSec']) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function useMotion(scene: any, beats: any[], fallbackDuration: number): Motion {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const duration = typeof scene.durationInFrames === 'number' ? scene.durationInFrames : fallbackDuration;
  const p = clamp(frame / Math.max(1, duration - 1));
  const start = typeof scene.startSec === 'number' ? scene.startSec : 0;
  const seconds = start + frame / fps;
  const beat = fps * 60 / 118;
  const phase = ((seconds * 118 / 60) % 1 + 1) % 1;
  let pulse = Math.exp(-phase * 8);
  if (Array.isArray(beats)) {
    for (const entry of beats as unknown[]) {
      const at = beatTime(entry);
      if (at === null) continue;
      const age = seconds - at;
      if (age >= 0 && age < 0.4) pulse = Math.max(pulse, Math.exp(-age * 19));
    }
  }
  return {frame, fps, p, pulse, beat};
}

function sourceOf(scene: any): string | null {
  const files: unknown = scene.publicAssetFiles;
  if (!Array.isArray(files)) return null;
  const file: unknown = files[0];
  return typeof file === 'string' && file.length > 0 ? file : null;
}

const FullScreenshot: React.FC<{
  src: string | null; title: string; top: number; height: number; pulse: number;
}> = ({src, title, top, height, pulse}) => {
  if (!src) return null;
  return (
    <div style={{position: 'absolute', left: 64, top, width: 826, height, filter: `drop-shadow(0 16px ${28 + pulse * 12}px rgba(47,123,255,0.18))`}}>
      <AppWindow title={title} kicker='DSH WORKBENCH' style={{width: '100%', height: '100%'}}>
        <div style={{position: 'relative', width: '100%', height: height - 106, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg}}>
          <Img src={staticFile(src)} alt={title} style={{display: 'block', width: '100%', height: '100%', objectFit: 'contain'}} />
        </div>
      </AppWindow>
    </div>
  );
};

const DetailShot: React.FC<{
  src: string | null; left: number; top: number; width: number; height: number;
  title: string; fx: number; fy: number; zoom: number; active: number; frame: number;
}> = ({src, left, top, width, height, title, fx, fy, zoom, active, frame}) => {
  if (!src) return null;
  return (
    <div style={{position: 'absolute', left, top, width, height, overflow: 'hidden', borderRadius: 14, border: `1px solid rgba(125,178,255,${0.3 + 0.5 * active})`, background: C.surface, boxSizing: 'border-box', boxShadow: `0 0 ${10 + active * 18}px rgba(47,123,255,0.14)`}}>
      <div style={{height: 40, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 9, fontFamily: FONT_SANS, fontSize: 20, fontWeight: 700, color: C.white, background: '#131D2E'}}>
        <span style={{width: 6, height: 6, borderRadius: 9, background: C.ice, boxShadow: `0 0 ${6 + 6 * active}px ${C.blue}`}} />
        {title}
        <span style={{marginLeft: 'auto', color: C.ice, fontFamily: FONT_MONO, fontSize: 14}}>DETAIL</span>
      </div>
      <div style={{position: 'relative', width: '100%', height: height - 42, overflow: 'hidden'}}>
        <div style={{position: 'absolute', inset: 0, transform: `scale(${1 + 0.012 * Math.sin(frame * 0.035)})`}}>
          <FocusShot src={src} cams={[{t: 0, fx, fy, z: zoom}, {t: 1, fx, fy, z: zoom + 0.16}]} marks={[]} />
        </div>
        <div style={{position: 'absolute', left: 0, right: 0, top: ((frame * 1.6) % Math.max(1, height - 42)), height: 1, background: 'rgba(125,178,255,0.22)', pointerEvents: 'none'}} />
      </div>
    </div>
  );
};

const Scene_scene_04: React.FC<CustomSceneProps> = ({scene, idx, beats}: CustomSceneProps) => {
  const m = useMotion(scene, beats, 91);
  const src = sourceOf(scene);
  const sid = `protocol-${idx}`;
  const sync = reveal(m.frame, m.beat * 1.5, 18);
  const protocols: Protocol[] = [
    {name: 'OpenAI Chat', api: 'CHAT', x: 64, y: 390, color: C.ice},
    {name: 'OpenAI Responses', api: 'RESPONSES', x: 490, y: 390, color: C.blue},
    {name: 'Anthropic Messages', api: 'MESSAGES', x: 64, y: 454, color: C.gold},
    {name: 'Gemini Native', api: 'NATIVE', x: 490, y: 454, color: '#A6CAFF'},
  ];
  return (
    <AbsoluteFill style={{background: C.bg, color: C.white, fontFamily: FONT_SANS, overflow: 'hidden'}}>
      <svg viewBox='0 0 1080 1920' width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
        <defs>
          <radialGradient id={`${sid}-halo`} cx='44%' cy='43%' r='62%'>
            <stop offset='0%' stopColor={C.blue} stopOpacity={0.23 + m.pulse * 0.06} />
            <stop offset='100%' stopColor={C.bg} stopOpacity='0' />
          </radialGradient>
          <linearGradient id={`${sid}-beam`} x1='0' y1='0' x2='1' y2='0'>
            <stop offset='0%' stopColor={C.blue} stopOpacity='0' />
            <stop offset='55%' stopColor={C.ice} />
            <stop offset='100%' stopColor={C.blue} stopOpacity='0' />
          </linearGradient>
        </defs>
        <rect width='1080' height='1920' fill={`url(#${sid}-halo)`} />
        <g transform={`translate(${m.p * -14} ${m.p * 18})`} opacity='0.28'>
          {Array.from({length: 13}, (_v: unknown, i: number) => (
            <path key={i} d={`M ${-240 + i * 120} 180 L ${320 + i * 90} 1450`} fill='none' stroke='#17325B' strokeWidth='1' />
          ))}
          {Array.from({length: 10}, (_v: unknown, i: number) => (
            <path key={i} d={`M 0 ${310 + i * 126} L 1080 ${160 + i * 126}`} fill='none' stroke='#17325B' strokeWidth='1' />
          ))}
        </g>
        <g opacity={0.45 + m.pulse * 0.2}>
          <path d='M 52 524 L 42 524 L 42 1090 L 52 1090 M 902 524 L 908 524 L 908 1090 L 902 1090' stroke={C.ice} strokeWidth='2' fill='none' />
          <path d='M 116 1088 L 116 1108 L 300 1108 L 300 1125 M 826 1088 L 826 1108 L 730 1108 L 730 1130' stroke={C.blue} strokeWidth='2' fill='none' strokeDasharray='7 9' strokeDashoffset={-m.frame * 2} />
        </g>
        {protocols.map((item: Protocol, i: number) => {
          const on = reveal(m.frame, 3 + i * m.beat * 0.5, 7);
          const drift = (m.frame * 3 + i * 29) % 100;
          return (
            <g key={item.api} transform={`translate(${item.x} ${item.y + (1 - on) * 13})`} opacity={0.36 + on * 0.64}>
              <rect width='400' height='50' rx='12' fill='#0C1524' stroke={item.color} strokeOpacity={0.25 + on * 0.55} />
              <rect x='0' y='12' width='3' height='26' rx='1.5' fill={item.color} />
              <circle cx='23' cy='25' r={4 + m.pulse * on * 1.6} fill={item.color} />
              <text x='39' y='32' fill={C.white} fontFamily={FONT_MONO} fontSize='21' fontWeight='700'>{item.name}</text>
              <path d='M 348 25 L 380 25 M 373 19 L 380 25 L 373 31' fill='none' stroke={item.color} strokeWidth='2' />
              <circle cx={348 + drift * 0.3} cy='25' r='2' fill={C.white} opacity={on} />
              <rect x='12' y='47' width={on * 376} height='2' fill={item.color} opacity='0.7' />
            </g>
          );
        })}
        <path d={`M ${-350 + ((m.frame * 15) % 1650)} 521 h 350`} stroke={`url(#${sid}-beam)`} strokeWidth='3' />
        {Array.from({length: 24}, (_v: unknown, i: number) => {
          const x = 55 + ((i * 173 + m.frame * (0.7 + i % 3)) % 840);
          const y = 260 + ((i * 127 + m.frame * 1.7) % 1150);
          return <circle key={i} cx={x} cy={y} r={i % 4 === 0 ? 2 : 1} fill={C.ice} opacity={0.12 + 0.18 * Math.sin(i + m.frame * 0.04) ** 2} />;
        })}
        <text x='66' y='247' fill={C.ice} fontFamily={FONT_MONO} fontSize='22' letterSpacing='4'>MODEL ACCESS / 04</text>
        <g transform={`translate(0 ${(1 - reveal(m.frame, 0, 10)) * 15})`}>
          <text x='60' y='317' fill={C.white} fontFamily={FONT_SANS} fontSize='65' fontWeight='900'>四大协议，一次接入</text>
          <text x='66' y='358' fill={C.muted} fontFamily={FONT_SANS} fontSize='25'>模型接入中心 · 实机全览始终完整</text>
        </g>
      </svg>

      <FullScreenshot src={src} title='模型接入中心' top={526} height={560} pulse={m.pulse} />
      <DetailShot src={src} left={64} top={1130} width={482} height={256} title='客户端配置 · 局部放大' fx={0.5} fy={0.78} zoom={1.85} active={sync} frame={m.frame} />

      <div style={{position: 'absolute', left: 570, top: 1130, width: 320, height: 256, boxSizing: 'border-box', padding: '18px 20px', borderLeft: `2px solid ${C.blue}`, background: 'linear-gradient(110deg,rgba(47,123,255,0.13),rgba(47,123,255,0))'}}>
        <div style={{fontFamily: FONT_MONO, fontSize: 18, color: C.ice, letterSpacing: 2}}>DSH CLIENT</div>
        <svg viewBox='0 0 276 56' width={276} height={56} style={{display: 'block', marginTop: 7}}>
          <rect x='2' y='12' width='45' height='32' rx='5' stroke={C.ice} fill='none' strokeWidth='2' />
          <path d='M 14 48 H 36 M 25 44 V 48' stroke={C.ice} fill='none' strokeWidth='2' />
          <path d='M 65 22 H 205 M 196 16 L 205 22 L 196 28 M 205 38 H 65 M 74 32 L 65 38 L 74 44' fill='none' stroke={C.blue} strokeWidth='2' strokeDasharray='9 7' strokeDashoffset={-m.frame * 2.8} />
          <rect x='225' y='12' width='45' height='32' rx='5' stroke={C.ice} fill='none' strokeWidth='2' />
          <circle cx={65 + ((m.frame * 4) % 140)} cy='22' r='3' fill={C.gold} />
        </svg>
        <div style={{fontWeight: 900, fontSize: 42, lineHeight: 1.2, color: C.white, marginTop: 9, transform: `translateY(${(1 - sync) * 10}px)`}}>一键同步</div>
        <div style={{fontSize: 22, color: C.muted, marginTop: 11}}>沿用客户端配置</div>
        <div style={{height: 3, marginTop: 16, background: '#182943', overflow: 'hidden'}}>
          <div style={{height: '100%', width: `${32 + sync * 68}%`, background: C.ice, opacity: 0.7 + m.pulse * 0.3}} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Scene_scene_05: React.FC<CustomSceneProps> = ({scene, idx, beats}: CustomSceneProps) => {
  const m = useMotion(scene, beats, 107);
  const sid = `compile-${idx}`;
  const unfold = reveal(m.frame, 0, 22);
  const circuit = reveal(m.frame, 12, 34);
  const points: Point[] = [{x: 232, y: 790}, {x: 716, y: 790}, {x: 474, y: 1090}];
  const rounds = [0, 1, 2];
  const roundStarts: number[] = [m.beat * 1.25, m.beat * 3.25, m.beat * 5.25];
  const scanY = 650 + ((m.frame * 4.6) % 540);
  const nodes: {x: number; y: number; title: string; sub: string; color: string; at: number}[] = [
    {x: 232, y: 790, title: '编译', sub: 'TYPE CHECK', color: C.ice, at: 9},
    {x: 716, y: 790, title: '沙箱', sub: 'SANDBOX', color: C.blue, at: 18},
    {x: 474, y: 1090, title: '修复', sub: 'REPAIR LOOP', color: C.gold, at: 30},
  ];
  return (
    <AbsoluteFill style={{background: C.bg, fontFamily: FONT_SANS, overflow: 'hidden'}}>
      <svg viewBox='0 0 1080 1920' width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
        <defs>
          <radialGradient id={`${sid}-core`} cx='44%' cy='47%' r='53%'>
            <stop offset='0%' stopColor='#16469D' stopOpacity='0.32' />
            <stop offset='80%' stopColor={C.bg} stopOpacity='0' />
          </radialGradient>
          <linearGradient id={`${sid}-command`} x1='0' y1='0' x2='1' y2='1'>
            <stop offset='0%' stopColor='#1B3153' />
            <stop offset='100%' stopColor='#090F19' />
          </linearGradient>
          <linearGradient id={`${sid}-route`} x1='0' y1='0' x2='1' y2='1'>
            <stop offset='0%' stopColor={C.ice} />
            <stop offset='52%' stopColor={C.blue} />
            <stop offset='100%' stopColor={C.gold} />
          </linearGradient>
          <clipPath id={`${sid}-scope`}>
            <rect x='70' y='620' width='820' height='580' rx='28' />
          </clipPath>
        </defs>
        <rect width='1080' height='1920' fill={`url(#${sid}-core)`} />
        <g opacity='0.19' transform={`translate(0 ${m.p * 15})`}>
          {Array.from({length: 14}, (_v: unknown, i: number) => (
            <path key={i} d={`M ${30 + i * 76} 600 V 1430 M 34 ${600 + i * 62} H 950`} stroke='#26416A' strokeWidth='1' fill='none' />
          ))}
        </g>
        <text x='66' y='247' fill={C.ice} fontFamily={FONT_MONO} fontSize='22' letterSpacing='4'>STRICT COMPILE / 05</text>
        <text x='60' y='316' fill={C.white} fontFamily={FONT_SANS} fontSize='58' fontWeight='900'>生成之后，还要编译修错</text>
        <text x='66' y='361' fill={C.muted} fontFamily={FONT_SANS} fontSize='25'>编译与沙箱检查 → 诊断反馈 → 自动修复</text>

        <g transform={`translate(${474 - 474 * (1 + m.p * 0.012)} ${850 - 850 * (1 + m.p * 0.012)}) scale(${1 + m.p * 0.012})`}>
          <g transform={`translate(0 ${(1 - unfold) * 25})`}>
            <path d='M 84 416 H 858 L 884 442 V 560 L 858 586 H 84 L 64 566 V 436 Z' fill={`url(#${sid}-command)`} stroke='#365882' strokeWidth='1.5' />
            <path d={`M 64 451 V 436 L 84 416 H ${84 + unfold * 500}`} fill='none' stroke={C.ice} strokeWidth='3' />
            <text x='96' y='454' fill={C.ice} fontFamily={FONT_MONO} fontSize='18' letterSpacing='3'>TYPESCRIPT / NO OUTPUT</text>
            <text x='96' y='535' fill={C.gold} fontFamily={FONT_MONO} fontSize='56' fontWeight='700'>&gt;</text>
            <text x='153' y='535' fill={C.white} fontFamily={FONT_MONO} fontSize='65' fontWeight='700'>tsc --noEmit</text>
            <rect x='808' y='484' width='9' height='56' fill={C.ice} opacity={0.35 + 0.65 * Math.sin(m.frame * 0.18) ** 2} />
          </g>

          <g clipPath={`url(#${sid}-scope)`}>
            <rect x='70' y={scanY} width='820' height='45' fill={C.blue} opacity='0.035' />
            <path d={`M 70 ${scanY} H 890`} stroke={C.ice} strokeOpacity='0.22' strokeWidth='1' />
            <g transform={`translate(474 916) rotate(${m.frame * 0.22})`} opacity='0.16'>
              <circle r='226' fill='none' stroke={C.ice} strokeWidth='1' strokeDasharray='2 14' />
              <circle r={174 + m.pulse * 9} fill='none' stroke={C.blue} strokeWidth='1' />
              {Array.from({length: 12}, (_v: unknown, i: number) => (
                <path key={i} d='M 0 -217 V -230' transform={`rotate(${i * 30})`} stroke={C.ice} strokeWidth={i % 3 === 0 ? 3 : 1} />
              ))}
            </g>
            <path d='M 232 790 H 716 L 474 1090 Z' fill='#0D1C33' fillOpacity='0.46' stroke='#20395D' strokeWidth='12' strokeLinejoin='round' />
            <path d='M 232 790 H 716 L 474 1090 Z' fill='none' stroke={`url(#${sid}-route)`} strokeWidth='3' strokeLinejoin='round' pathLength={1} strokeDasharray='1' strokeDashoffset={1 - circuit} />
            <path d='M 232 790 H 716 L 474 1090 Z' fill='none' stroke={C.ice} strokeOpacity={0.3 + m.pulse * 0.4} strokeWidth='2' strokeDasharray='10 26' strokeDashoffset={-m.frame * 4} opacity={circuit} />
            {Array.from({length: 8}, (_v: unknown, i: number) => {
              const position = ((m.frame * 0.025 + i / 8) % 1) * 3;
              const edge = Math.floor(position);
              const t = position - edge;
              const a = points[edge] ?? points[0]!;
              const b = points[(edge + 1) % 3] ?? points[1]!;
              const x = a.x + (b.x - a.x) * t;
              const y = a.y + (b.y - a.y) * t;
              return (
                <g key={i} opacity={circuit}>
                  <circle cx={x} cy={y} r='10' fill={i % 3 === 0 ? C.gold : C.blue} opacity='0.14' />
                  <circle cx={x} cy={y} r='3.6' fill={i % 3 === 0 ? C.gold : C.ice} />
                </g>
              );
            })}
            <g opacity={0.45 + m.pulse * 0.2}>
              <text x='474' y='882' textAnchor='middle' fill={C.ice} fontFamily={FONT_MONO} fontSize='21' letterSpacing='3'>DIAGNOSTIC</text>
              <path d={`M 376 923 L 403 923 L 419 ${914 - m.pulse * 9} L 437 ${942 + m.pulse * 5} L 456 902 L 475 929 L 493 917 L 514 923 L 572 923`} fill='none' stroke={C.ice} strokeWidth='2' />
              <text x='474' y='969' textAnchor='middle' fill={C.muted} fontFamily={FONT_SANS} fontSize='21'>诊断反馈回路</text>
            </g>
          </g>

          {nodes.map((node: {x: number; y: number; title: string; sub: string; color: string; at: number}, i: number) => {
            const arrive = reveal(m.frame, node.at, 12);
            const hit = Math.exp(-Math.pow((((m.frame / m.beat) + 6 - i * 0.6) % 3) - 0.2, 2) * 7);
            const scale = 0.9 + arrive * 0.1 + hit * 0.015;
            return (
              <g key={node.sub} transform={`translate(${node.x} ${node.y}) scale(${scale})`} opacity={0.35 + arrive * 0.65}>
                <circle r={77 + ((m.frame * 1.3 + i * 29) % 45)} fill='none' stroke={node.color} strokeWidth='1' opacity={0.16 * (1 - ((m.frame * 1.3 + i * 29) % 45) / 45)} />
                <path d='M -104 -56 L 84 -56 L 104 -36 V 40 L 88 56 H -104 Z' fill='#101B2D' stroke={node.color} strokeWidth={1.5 + hit} />
                <path d='M -94 -45 H -66 M -94 -45 V -25 M 94 44 H 66' stroke={node.color} strokeWidth='2' fill='none' />
                <text x='0' y='3' textAnchor='middle' fill={C.white} fontFamily={FONT_SANS} fontSize='36' fontWeight='900'>{node.title}</text>
                <text x='0' y='34' textAnchor='middle' fill={node.color} fontFamily={FONT_MONO} fontSize='15' letterSpacing='1'>{node.sub}</text>
              </g>
            );
          })}

          <text x='66' y='665' fill={C.muted} fontFamily={FONT_SANS} fontSize='24'>不是生成即交付</text>
          <text x='878' y='667' textAnchor='end' fill={C.gold} fontFamily={FONT_MONO} fontSize='25'>MAX 03</text>
          <path d='M 68 1199 H 882' stroke='#294263' strokeWidth='1' />
          <text x='68' y='1245' fill={C.white} fontFamily={FONT_SANS} fontSize='31' fontWeight='800'>最多三轮自动修复</text>
          <text x='878' y='1243' textAnchor='end' fill={C.muted} fontFamily={FONT_MONO} fontSize='16'>BOUNDED RETRY</text>
          {rounds.map((round: number) => {
            const at = roundStarts[round] ?? 0;
            const lit = reveal(m.frame, at, 12);
            const active = clamp((m.frame - at) / (m.beat * 1.7));
            const x = 68 + round * 278;
            return (
              <g key={round} transform={`translate(${x} 1274)`}>
                <rect width='258' height='78' rx='12' fill={lit > 0 ? '#152139' : '#0C111B'} stroke={round === 2 ? C.gold : C.blue} strokeOpacity={0.2 + lit * 0.6} />
                <circle cx='25' cy='29' r='5' fill={round === 2 ? C.gold : C.ice} opacity={0.2 + lit * 0.8} />
                <text x='43' y='37' fill={C.white} fontFamily={FONT_SANS} fontSize='24' fontWeight='700'>第 {round + 1} 轮</text>
                <text x='230' y='37' textAnchor='end' fill={round === 2 ? C.gold : C.ice} fontFamily={FONT_MONO} fontSize='23'>0{round + 1}</text>
                <path d='M 20 59 H 238' stroke='#25354E' strokeWidth='3' />
                <path d={`M 20 59 H ${20 + active * 218}`} stroke={round === 2 ? C.gold : C.ice} strokeWidth='3' />
              </g>
            );
          })}
          <text x='68' y='1394' fill={C.muted} fontFamily={FONT_SANS} fontSize='21'>编译修复机制示意 · 非实际运行日志</text>
        </g>
        {Array.from({length: 25}, (_v: unknown, i: number) => {
          const x = 64 + ((i * 149 + m.frame * (i % 2 === 0 ? 1.1 : -0.55) + 1000) % 826);
          const y = 470 + ((i * 107 + m.frame * 2.4) % 900);
          return <path key={i} d={`M ${x} ${y} v ${3 + i % 5}`} stroke={i % 5 === 0 ? C.gold : C.ice} strokeWidth='1.5' opacity='0.3' />;
        })}
      </svg>
    </AbsoluteFill>
  );
};

const Scene_scene_06: React.FC<CustomSceneProps> = ({scene, idx, beats}: CustomSceneProps) => {
  const m = useMotion(scene, beats, 122);
  const src = sourceOf(scene);
  const sid = `studio-${idx}`;
  const steps: {x: number; title: string; tag: string}[] = [
    {x: 164, title: '本地目录扫描', tag: 'SCAN'},
    {x: 374, title: '百兆视频直传', tag: 'UPLOAD'},
    {x: 584, title: '提词自拍', tag: 'RECORD'},
    {x: 794, title: '隔离式 .motion 导入', tag: 'IMPORT'},
  ];
  const sweep = (m.frame * 6.4) % 826;
  const detailPhase = ((m.frame / m.beat) % 4 + 4) % 4;
  const leftActive = 0.3 + 0.7 * (0.5 + 0.5 * Math.cos(detailPhase * Math.PI / 2));
  const rightActive = 1.3 - leftActive;
  return (
    <AbsoluteFill style={{background: C.bg, fontFamily: FONT_SANS, overflow: 'hidden'}}>
      <svg viewBox='0 0 1080 1920' width={1080} height={1920} style={{position: 'absolute', inset: 0}}>
        <defs>
          <radialGradient id={`${sid}-glow`} cx='47%' cy='42%' r='58%'>
            <stop offset='0%' stopColor='#174991' stopOpacity='0.28' />
            <stop offset='100%' stopColor={C.bg} stopOpacity='0' />
          </radialGradient>
          <linearGradient id={`${sid}-rail`} x1='0' y1='0' x2='1' y2='0'>
            <stop offset='0%' stopColor={C.ice} />
            <stop offset='65%' stopColor={C.blue} />
            <stop offset='100%' stopColor={C.gold} />
          </linearGradient>
          <linearGradient id={`${sid}-wipe`} x1='0' y1='0' x2='1' y2='0'>
            <stop offset='0%' stopColor={C.ice} stopOpacity='0' />
            <stop offset='100%' stopColor={C.ice} stopOpacity='0.55' />
          </linearGradient>
        </defs>
        <rect width='1080' height='1920' fill={`url(#${sid}-glow)`} />
        <g transform={`translate(${m.p * 12} ${m.p * -14})`} opacity='0.23'>
          {Array.from({length: 9}, (_v: unknown, i: number) => (
            <path key={i} d={`M ${-120 + i * 168} 1360 L ${370 + i * 85} 680 L ${250 + i * 86} 230`} stroke='#234577' fill='none' strokeWidth='1' />
          ))}
          <path d='M 18 1130 L 940 1130 M 18 955 L 940 955 M 18 780 L 940 780' stroke='#234577' fill='none' strokeWidth='1' />
        </g>
        <text x='66' y='247' fill={C.ice} fontFamily={FONT_MONO} fontSize='22' letterSpacing='4'>ASSET STUDIO / 06</text>
        <text x='60' y='319' fill={C.white} fontFamily={FONT_SANS} fontSize='66' fontWeight='900'>素材、提词、自拍</text>
        <g transform={`translate(${(1 - reveal(m.frame, 2, 12)) * -18} 0)`}>
          <text x='60' y='397' fill={C.ice} fontFamily={FONT_SANS} fontSize='72' fontWeight='900'>一次就位</text>
          <path d={`M 390 378 H ${390 + reveal(m.frame, 7, 18) * 496}`} stroke={C.blue} strokeWidth='3' />
          <text x='887' y='359' textAnchor='end' fill={C.muted} fontFamily={FONT_MONO} fontSize='17' letterSpacing='2'>ONE WORKBENCH</text>
        </g>
        <path d='M 164 459 H 794' fill='none' stroke='#203352' strokeWidth='4' />
        <path d='M 164 459 H 794' fill='none' stroke={`url(#${sid}-rail)`} strokeWidth='4' pathLength={1} strokeDasharray='1' strokeDashoffset={1 - reveal(m.frame, 4, m.beat * 3)} />
        <path d='M 164 459 H 794' fill='none' stroke={C.ice} strokeWidth='2' strokeDasharray='6 22' strokeDashoffset={-m.frame * 3} opacity='0.5' />
        {steps.map((step: {x: number; title: string; tag: string}, i: number) => {
          const on = reveal(m.frame, 4 + i * m.beat, 10);
          const color = i === 3 ? C.gold : C.ice;
          return (
            <g key={step.tag} opacity={0.38 + on * 0.62}>
              <circle cx={step.x} cy='459' r={18 + on * 2 + m.pulse * on * 2} fill={C.bg} stroke={color} strokeWidth='2' />
              <text x={step.x} y='466' textAnchor='middle' fontFamily={FONT_MONO} fontSize='19' fill={color} fontWeight='700'>{i + 1}</text>
              <text x={step.x} y='504' textAnchor='middle' fontFamily={FONT_SANS} fontSize={i === 3 ? 19 : 22} fill={C.white} fontWeight='700'>{step.title}</text>
              <text x={step.x} y='529' textAnchor='middle' fontFamily={FONT_MONO} fontSize='12' fill={C.muted} letterSpacing='2'>{step.tag}</text>
            </g>
          );
        })}
        <path d='M 55 549 H 40 V 1085 H 55 M 898 549 H 906 V 1085 H 898' stroke={C.blue} strokeWidth='2' fill='none' opacity={0.5 + m.pulse * 0.25} />
        <path d={`M ${64 + Math.max(0, sweep - 160)} 543 H ${64 + sweep}`} stroke={`url(#${sid}-wipe)`} strokeWidth='3' />
        <g fill='none' strokeWidth='1.5'>
          <path d='M 220 1090 V 1110 H 263 V 1132' stroke={C.ice} strokeOpacity={leftActive * 0.8} strokeDasharray='5 6' strokeDashoffset={-m.frame * 2} />
          <path d='M 724 1090 V 1110 H 689 V 1132' stroke={C.gold} strokeOpacity={rightActive * 0.8} strokeDasharray='5 6' strokeDashoffset={-m.frame * 2} />
        </g>
        {Array.from({length: 20}, (_v: unknown, i: number) => {
          const x = 65 + ((i * 137 + m.frame * 1.2) % 824);
          const y = 270 + ((i * 109 + m.frame * 2) % 1130);
          return <rect key={i} x={x} y={y} width={i % 3 === 0 ? 4 : 2} height='2' fill={i % 4 === 0 ? C.gold : C.ice} opacity='0.3' />;
        })}
      </svg>

      <FullScreenshot src={src} title='素材库 · 提词录播工作台' top={550} height={535} pulse={m.pulse} />
      <DetailShot src={src} left={64} top={1134} width={398} height={208} title='素材区 · 局部放大' fx={0.35} fy={0.58} zoom={1.9} active={leftActive} frame={m.frame} />
      <DetailShot src={src} left={492} top={1134} width={398} height={208} title='录播区 · 局部放大' fx={0.77} fy={0.47} zoom={1.85} active={rightActive} frame={m.frame} />

      <div style={{position: 'absolute', left: 64, top: 1362, width: 398, display: 'flex', alignItems: 'center', gap: 10, color: C.muted, fontSize: 21}}>
        <span style={{width: 7, height: 7, borderRadius: 9, background: C.ice, opacity: 0.55 + m.pulse * 0.45}} />
        本地扫描 / 批量入库
      </div>
      <div style={{position: 'absolute', left: 492, top: 1358, width: 398, display: 'flex', gap: 12}}>
        {['可调速', '防镜像'].map((label: string, i: number) => (
          <div key={label} style={{height: 38, padding: '0 18px', display: 'flex', alignItems: 'center', boxSizing: 'border-box', borderRadius: 7, border: `1px solid ${i === 0 ? C.blue : '#6F5726'}`, color: i === 0 ? C.ice : C.gold, background: i === 0 ? '#101D32' : '#211B10', fontSize: 22, fontWeight: 700, transform: `translateY(${Math.sin(m.frame * 0.055 + i) * 1.2}px)`}}>{label}</div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export interface CustomSceneProps { scene: any; idx: number; total: number; beats: any[]; }
export const BATCH_02_SCENES: Record<string, React.FC<CustomSceneProps>> = {
  'scene-04': Scene_scene_04,
  'scene-05': Scene_scene_05,
  'scene-06': Scene_scene_06
};