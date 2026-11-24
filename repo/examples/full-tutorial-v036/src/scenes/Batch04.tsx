import React from 'react';
import {AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame} from 'remotion';
import {FONT_MONO, FONT_SANS, FocusShot} from '../lib/shotcraft';

const W = 1920;
const H = 1080;
const RAIL = 42;
const SCALE = (H - RAIL) / H;
const INK = '#102442';
const QUIET = '#415773';
const BLUE = '#175DDA';
const TEAL = '#087C73';
const AMBER = '#9B4B08';
const VIDEO = 'assets/edited/video-06-demo-step3-monitor-refine-a842-edited.mp4';
const MONITOR = 'assets/edited/image-06a-ui-step3-monitor-cf2e-edited.png';
const QA = 'assets/edited/image-07a-ui-step4-qa-de19-edited.png';
const TASKS = 'assets/edited/image-07b-ui-task-center-610a-edited.png';
const LAST_SOURCE_FRAME = 147;

type Anchor = readonly [fx: number, fy: number, fw: number, fh: number];
const TIMELINE: Anchor = [0.3859, 0.1039, 0.0864, 0.035];
const QA_STEP: Anchor = [0.0701, 0.4207, 0.122, 0.0768];
const QUICK: Anchor = [0.2261, 0.6099, 0.1076, 0.0471];
const MASTER: Anchor = [0.3435, 0.6099, 0.1141, 0.0471];
const EXCEPTION: Anchor = [0.6986, 0.1426, 0.0317, 0.035];
const RETRY: Anchor = [0.9355, 0.4684, 0.0464, 0.0332];

const matte: React.CSSProperties = {background: 'linear-gradient(160deg,#F8FAFC,#E2E8F0)', overflow: 'hidden', fontFamily: FONT_SANS, color: INK};
const mediaPlane: React.CSSProperties = {position: 'absolute', width: W, height: H, left: (W - W * SCALE) / 2, top: RAIL, transform: `scale(${SCALE})`, transformOrigin: '0 0', overflow: 'hidden', background: '#F8FAFC'};
const media: React.CSSProperties = {display: 'block', width: '100%', height: '100%', objectFit: 'contain'};
const rail: React.CSSProperties = {position: 'absolute', top: 0, left: 0, width: '100%', height: RAIL, boxSizing: 'border-box', paddingLeft: 38, display: 'flex', gap: 24, alignItems: 'center', borderBottom: '1px solid #CED9E8', background: '#F8FAFC', whiteSpace: 'nowrap'};
const title: React.CSSProperties = {fontSize: 21, fontWeight: 780};
const note: React.CSSProperties = {fontSize: 18, fontWeight: 650, color: QUIET};
const mono: React.CSSProperties = {fontFamily: FONT_MONO, fontSize: 16, fontWeight: 750, letterSpacing: 1};
const svgLayer: React.CSSProperties = {position: 'absolute', inset: 0, pointerEvents: 'none'};

function clamp(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function ease(frame: number, from: number, span: number): number {
  const x = clamp((frame - from) / span);
  return x * x * (3 - 2 * x);
}

function bounds([fx, fy, fw, fh]: Anchor, pad = 0): {x: number; y: number; w: number; h: number} {
  return {x: (fx - fw / 2) * W - pad, y: (fy - fh / 2) * H - pad, w: fw * W + pad * 2, h: fh * H + pad * 2};
}

function corners(a: Anchor, pad: number, length: number): string {
  const {x, y, w, h} = bounds(a, pad);
  const r = x + w;
  const b = y + h;
  return `M${x} ${y + length}V${y}H${x + length} M${r - length} ${y}H${r}V${y + length} M${r} ${b - length}V${b}H${r - length} M${x + length} ${b}H${x}V${b - length}`;
}

const ChapterWipe: React.FC<{frame: number}> = ({frame}) => {
  const p = ease(frame, 0, 13);
  if (p >= 1) return null;
  return <div aria-hidden style={{position: 'absolute', top: RAIL, bottom: 158, left: -300 + (W + 300) * p, width: 270, opacity: 0.26 * Math.sin(Math.PI * p), background: 'linear-gradient(90deg,transparent,#FFFFFF 72%,#D9EAFF 91%,transparent)', pointerEvents: 'none'}} />;
};

const Scene_scene_19: React.FC<CustomSceneProps> = () => {
  const f = useCurrentFrame();
  const hold = f >= LAST_SOURCE_FRAME;
  const played = clamp(f / LAST_SOURCE_FRAME);
  return <AbsoluteFill style={matte}>
    <div style={mediaPlane}>
      {hold ? (
        // Keep requesting the same real source frame; no replacement UI or parameter overlay.
        <OffthreadVideo src={staticFile(VIDEO)} playbackRate={LAST_SOURCE_FRAME / Math.max(1, f)} muted style={media} />
      ) : (
        <FocusShot src={VIDEO} mediaWidth={W} mediaHeight={H} cams={[{t: 0, fx: 0.5, fy: 0.5, z: 1}, {t: 1, fx: 0.5, fy: 0.5, z: 1}]} marks={[]} />
      )}
    </div>
    <div style={rail}>
      <span style={{...mono, color: BLUE, borderLeft: '4px solid #2F7BFF', paddingLeft: 10}}>03 / 04</span>
      <strong style={title}>监看台与改片</strong>
      <span style={{...note, minWidth: 240}}>{hold ? '确认当前选中的分镜' : '切换预览，找到要改的分镜'}</span>
      <svg width={144} height={12} viewBox='0 0 144 12' aria-hidden>
        <path d='M2 6H142' stroke='#CBD9EA' strokeWidth={3} strokeLinecap='round' />
        <path d={`M2 6H${2 + 140 * played}`} stroke={BLUE} strokeWidth={3} strokeLinecap='round' />
        {hold && <circle cx={142} cy={6} r={4} fill={BLUE} />}
      </svg>
    </div>
    <ChapterWipe frame={f} />
  </AbsoluteFill>;
};

const Scene_scene_20: React.FC<CustomSceneProps> = () => {
  const f = useCurrentFrame();
  const draw = ease(f, 12, 28);
  const emphasis = 0.58 + 0.42 * (1 - ease(f, 93, 39));
  const b = bounds(TIMELINE, 4);
  return <AbsoluteFill style={matte}>
    <div style={mediaPlane}>
      <Img src={staticFile(MONITOR)} style={media} />
      <svg width={W} height={H} style={svgLayer} aria-hidden>
        <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} fill='none' stroke={BLUE} strokeWidth={2.5} pathLength={1} strokeDasharray='1 1' strokeDashoffset={1 - draw} opacity={draw > 0 ? emphasis : 0} />
        <path d={`M${b.x + 14} ${b.y + b.h + 5}h${(b.w - 28) * draw}`} fill='none' stroke={BLUE} strokeWidth={2} opacity={draw * emphasis} />
      </svg>
    </div>
    <div style={rail}>
      <strong style={title}>回放检查画面与口播</strong>
      <span style={{...note, color: BLUE}}>成片原画时间轴</span>
      <span style={{...note, opacity: ease(f, 64, 20)}}>口播讲到关键点时，画面跟上了吗？</span>
    </div>
  </AbsoluteFill>;
};

const Scene_scene_21: React.FC<CustomSceneProps> = () => {
  const f = useCurrentFrame();
  const a = ease(f, 10, 14);
  const b = ease(f, 59, 16);
  const c = ease(f, 106, 16);
  const d = ease(f, 170, 18);
  return <AbsoluteFill style={matte}>
    <div style={mediaPlane}><Img src={staticFile(MONITOR)} style={media} /></div>
    <div style={{...rail, gap: 18}}>
      <strong style={title}>用自然语言做局部改片</strong>
      <span style={{...note, opacity: a, transform: `translateX(${6 * (1 - a)}px)`}}><b style={{...mono, color: BLUE}}>01</b> 改哪一幕</span>
      <span style={{...note, opacity: b, transform: `translateX(${6 * (1 - b)}px)`}}><b style={{...mono, color: BLUE}}>02</b> 改什么</span>
      <span style={{...note, opacity: c, transform: `translateX(${6 * (1 - c)}px)`}}><b style={{...mono, color: BLUE}}>03</b> 哪些内容保持不变</span>
      <span style={{...note, opacity: d, color: TEAL}}>→ 回看对应分镜</span>
    </div>
  </AbsoluteFill>;
};

const Scene_scene_22: React.FC<CustomSceneProps> = () => {
  const f = useCurrentFrame();
  const stepAlpha = ease(f, 10, 14) * (1 - ease(f, 50, 18));
  const active = f < 73 ? 0 : f < 124 ? 1 : f < 178 ? 2 : 3;
  return <AbsoluteFill style={matte}>
    <div style={mediaPlane}>
      <Img src={staticFile(QA)} style={media} />
      <svg width={W} height={H} style={svgLayer} aria-hidden>
        <path d={corners(QA_STEP, 5, 20)} stroke={BLUE} strokeWidth={3} strokeLinecap='round' fill='none' opacity={stepAlpha} />
      </svg>
    </div>
    <div style={{...rail, gap: 22}}>
      <span style={{...mono, color: BLUE}}>04 / 04</span>
      <strong style={title}>质检导出发布</strong>
      <span style={{...note, color: active === 0 ? BLUE : QUIET, borderBottom: `2px solid ${active === 0 ? BLUE : 'transparent'}`}}>01 九宫格抽帧</span>
      <span style={{...note, color: active === 1 ? BLUE : QUIET, borderBottom: `2px solid ${active === 1 ? BLUE : 'transparent'}`}}>02 黑屏检查</span>
      <span style={{...note, color: active === 2 ? BLUE : QUIET, borderBottom: `2px solid ${active === 2 ? BLUE : 'transparent'}`}}>03 响度检查</span>
      <span style={{...note, color: AMBER, opacity: ease(f, 175, 18)}}>有异常先回去修</span>
    </div>
    <ChapterWipe frame={f} />
  </AbsoluteFill>;
};

const Scene_scene_23: React.FC<CustomSceneProps> = () => {
  const f = useCurrentFrame();
  const a = ease(f, 12, 20);
  const b = ease(f, 99, 21);
  const check = ease(f, 190, 16);
  const qa = bounds(QUICK, 4);
  const hd = bounds(MASTER, 4);
  return <AbsoluteFill style={matte}>
    <div style={mediaPlane}>
      <Img src={staticFile(QA)} style={media} />
      <svg width={W} height={H} style={svgLayer} aria-hidden>
        <rect x={qa.x} y={qa.y} width={qa.w} height={qa.h} rx={9} fill='none' stroke={BLUE} strokeWidth={3} strokeDasharray='8 5' opacity={a * (1 - 0.35 * b - 0.20 * check)} />
        <rect x={hd.x} y={hd.y} width={hd.w} height={hd.h} rx={9} fill='none' stroke={TEAL} strokeWidth={3.5} pathLength={1} strokeDasharray='1 1' strokeDashoffset={1 - b} opacity={b * (1 - 0.3 * check)} />
      </svg>
    </div>
    <div style={rail}>
      <strong style={title}>分清审片导出与高清成品</strong>
      <span style={{...note, color: BLUE, opacity: a, borderLeft: `3px dashed ${BLUE}`, paddingLeft: 8}}>720P · 快速审片</span>
      <span style={{...note, color: TEAL, opacity: b, borderLeft: `3px solid ${TEAL}`, paddingLeft: 8}}>高清 MP4 · 质检通过后导出</span>
      <span style={{...note, opacity: check}}>交付前打开导出文件检查</span>
    </div>
  </AbsoluteFill>;
};

const Scene_scene_24: React.FC<CustomSceneProps> = () => {
  const f = useCurrentFrame();
  const filter = ease(f, 65, 18);
  const retry = ease(f, 136, 24);
  const b = bounds(EXCEPTION, 5);
  return <AbsoluteFill style={matte}>
    <div style={mediaPlane}>
      <Img src={staticFile(TASKS)} style={media} />
      <svg width={W} height={H} style={svgLayer} aria-hidden>
        <path d={`M${b.x} ${b.y + b.h}h${b.w * filter}`} stroke={AMBER} strokeWidth={3} strokeLinecap='round' fill='none' opacity={filter * (1 - 0.35 * retry)} />
        <path d={corners(RETRY, 5 + 12 * (1 - retry), 13)} stroke={BLUE} strokeWidth={3} strokeLinecap='round' fill='none' opacity={retry} />
      </svg>
    </div>
    <div style={rail}>
      <strong style={title}>任务监控：定位异常</strong>
      <span style={{...mono, color: QUIET}}>4-AGENT</span>
      <span style={{...note, color: filter > 0.5 ? AMBER : QUIET}}>{filter > 0.5 ? '先查失败节点' : '策划 / 剪辑 / 配音 / 渲染'}</span>
      <span style={{...note, color: BLUE, opacity: retry}}>再确认该任务能否重试</span>
    </div>
  </AbsoluteFill>;
};

export interface CustomSceneProps { scene: any; idx: number; total: number; beats: any[]; }
export const BATCH_04_SCENES: Record<string, React.FC<CustomSceneProps>> = {
  'scene-19': Scene_scene_19,
  'scene-20': Scene_scene_20,
  'scene-21': Scene_scene_21,
  'scene-22': Scene_scene_22,
  'scene-23': Scene_scene_23,
  'scene-24': Scene_scene_24
};
