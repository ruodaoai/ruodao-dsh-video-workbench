import * as React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {FocusShot, FONT_MONO, FONT_SANS} from '../lib/shotcraft';

const ASSETS = 'assets/edited/image-04a-ui-step1-assets-5e58-edited.png';
const PROMPTER = 'assets/edited/image-04b-ui-teleprompter-f4dd-edited.png';
const RECORDING = 'assets/edited/video-05-demo-step2-llm-tts-0ac5-edited.mp4';
const DIRECTOR = 'assets/edited/image-05a-ui-step2-director-77ba-edited.png';
const PROTOCOLS = 'assets/edited/image-05c-ui-llm-protocols-12f5-edited.png';
const ENGINES = 'assets/edited/image-05b-ui-tts-engines-98bc-edited.png';

const BLUE = '#245FD2';
const INK = '#17345E';
const stage: React.CSSProperties = {overflow: 'hidden', background: 'linear-gradient(140deg,#F8FAFC,#E2E8F0)', fontFamily: FONT_SANS};
const fullImage: React.CSSProperties = {width: '100%', height: '100%', objectFit: 'contain', display: 'block'};
const annotation: React.CSSProperties = {position: 'absolute', inset: 0, pointerEvents: 'none'};
const chapter: React.CSSProperties = {position: 'absolute', top: 73, left: 18, display: 'flex', alignItems: 'center', gap: 9, background: '#F8FAFCF2', borderLeft: `3px solid ${BLUE}`, borderRadius: '0 5px 5px 0', padding: '4px 11px 4px 9px', color: INK, fontSize: 17, fontWeight: 650, lineHeight: '24px', whiteSpace: 'nowrap', pointerEvents: 'none'};
const number: React.CSSProperties = {color: BLUE, fontFamily: FONT_MONO, fontSize: 15};

interface Anchor {fx: number; fy: number; fw: number; fh: number;}
interface Bounds {x: number; y: number; w: number; h: number;}

const NEXT: Anchor = {fx: 0.9108, fy: 0.1485, fw: 0.1141, fh: 0.0471};
const SCRIPT: Anchor = {fx: 0.7596, fy: 0.4599, fw: 0.2794, fh: 0.0471};
const UPLOAD: Anchor = {fx: 0.3267, fy: 0.6707, fw: 0.148, fh: 0.037};
const TEST: Anchor = {fx: 0.5955, fy: 0.8091, fw: 0.0972, fh: 0.0471};
const ENGINE_ANCHORS: readonly Anchor[] = [
  {fx: 0.6687, fy: 0.583, fw: 0.0786, fh: 0.0316},
  {fx: 0.8026, fy: 0.583, fw: 0.0599, fh: 0.0278},
  {fx: 0.8697, fy: 0.583, fw: 0.0664, fh: 0.0309},
];

const bounds = (a: Anchor): Bounds => ({x: (a.fx - a.fw / 2) * 1920, y: (a.fy - a.fh / 2) * 1080, w: a.fw * 1920, h: a.fh * 1080});
const ramp = (f: number, a: number, b: number): number => interpolate(f, [a, b], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
const smooth = (p: number): number => p * p * (3 - 2 * p);

const Scene_scene_13: React.FC<CustomSceneProps> = () => {
  const f = useCurrentFrame();
  const b = bounds(NEXT);
  const p = smooth(ramp(f, 174, 193));
  const alpha = p * (1 - ramp(f, 236, 249));
  const gap = 11 - 7 * p;
  const x = b.x - gap;
  const y = b.y - gap;
  const r = b.x + b.w + gap;
  const d = b.y + b.h + gap;
  const arm = 9 + 8 * p;
  return (
    <AbsoluteFill style={stage}>
      <Img src={staticFile(ASSETS)} style={fullImage} />
      <div style={chapter}><span style={number}>01</span>检查素材是否齐备</div>
      <svg width='1920' height='1080' viewBox='0 0 1920 1080' style={annotation} aria-hidden='true'>
        <path d={`M${x} ${y + arm}V${y}h${arm} M${r - arm} ${y}H${r}v${arm} M${x} ${d - arm}V${d}h${arm} M${r - arm} ${d}H${r}v-${arm}`} fill='none' stroke={BLUE} strokeWidth={2.5} strokeLinecap='round' strokeLinejoin='round' opacity={alpha} />
      </svg>
    </AbsoluteFill>
  );
};

const Scene_scene_14: React.FC<CustomSceneProps> = () => {
  const f = useCurrentFrame();
  const script = bounds(SCRIPT);
  const upload = bounds(UPLOAD);
  const draw = smooth(ramp(f, 79, 100));
  const handoff = smooth(ramp(f, 204, 226));
  const y = script.y + script.h + 5;
  const uy = upload.y + upload.h + 5;
  return (
    <AbsoluteFill style={stage}>
      <Img src={staticFile(PROMPTER)} style={fullImage} />
      <div style={chapter}><span style={number}>01</span>提词器拍摄棚</div>
      <svg width='1920' height='1080' viewBox='0 0 1920 1080' style={annotation} aria-hidden='true'>
        <path d={`M${script.x + 5} ${y - 7}v7H${script.x + script.w - 5}v-7`} pathLength={100} strokeDasharray='100 100' strokeDashoffset={100 * (1 - draw)} fill='none' stroke={BLUE} strokeWidth={2.5} strokeLinecap='round' strokeLinejoin='round' opacity={0.9 * draw * (1 - ramp(f, 163, 187))} />
        <line x1={upload.x + upload.w / 2 - 56 * handoff} x2={upload.x + upload.w / 2 + 56 * handoff} y1={uy} y2={uy} stroke={BLUE} strokeWidth={2.5} strokeLinecap='round' opacity={0.85 * handoff * (1 - ramp(f, 251, 263))} />
      </svg>
    </AbsoluteFill>
  );
};

const Scene_scene_15: React.FC<CustomSceneProps> = () => {
  const f = useCurrentFrame();
  const sweep = smooth(ramp(f, 0, 16));
  const cams: Array<{t: number; fx: number; fy: number; z: number}> = [
    {t: 0, fx: 0.5, fy: 0.5, z: 1},
    {t: 1, fx: 0.5, fy: 0.5, z: 1},
  ];
  return (
    <AbsoluteFill style={stage}>
      <FocusShot src={RECORDING} mediaWidth={1920} mediaHeight={1080} cams={cams} marks={[]} />
      <div style={{...chapter, opacity: smooth(ramp(f, 8, 20))}}><span style={number}>02</span>模型与配音入口</div>
      {f < 16 && <div style={{...annotation, right: 'auto', width: 310, transform: `translateX(${sweep * 2230 - 310}px)`, opacity: 0.6 * (1 - sweep), background: 'linear-gradient(90deg,transparent,rgba(224,239,255,0.95) 62%,transparent)'}} />}
    </AbsoluteFill>
  );
};

const Scene_scene_16: React.FC<CustomSceneProps> = () => {
  const f = useCurrentFrame();
  const p = smooth(ramp(f, 0, 12));
  return (
    <AbsoluteFill style={stage}>
      <Img src={staticFile(DIRECTOR)} style={fullImage} />
      <div style={{...chapter, opacity: p}}>
        <span style={number}>02</span>
        <svg width='22' height='17' viewBox='0 0 22 17' aria-hidden='true'>
          <path d='M1 8.5h3l2-4 3 9 3-12 3 14 3-7h3' fill='none' stroke={BLUE} strokeWidth={1.5} strokeLinecap='round' strokeLinejoin='round' />
        </svg>
        设定风格与配音节奏
      </div>
    </AbsoluteFill>
  );
};

const Scene_scene_17: React.FC<CustomSceneProps> = () => {
  const f = useCurrentFrame();
  const b = bounds(TEST);
  const trace = smooth(ramp(f, 177, 201));
  const alpha = ramp(f, 177, 187) * (1 - ramp(f, 244, 257));
  return (
    <AbsoluteFill style={stage}>
      <Img src={staticFile(PROTOCOLS)} style={fullImage} />
      <div style={chapter}><span style={number}>02</span>选择模型协议并测试</div>
      <svg width='1920' height='1080' viewBox='0 0 1920 1080' style={annotation} aria-hidden='true'>
        <rect x={b.x - 4} y={b.y - 4} width={b.w + 8} height={b.h + 8} rx={10} fill='none' pathLength={100} strokeDasharray='100 100' strokeDashoffset={100 * (1 - trace)} stroke='#7DB2FF' strokeWidth={3} opacity={alpha} />
      </svg>
    </AbsoluteFill>
  );
};

const Scene_scene_18: React.FC<CustomSceneProps> = () => {
  const f = useCurrentFrame();
  const timings: ReadonlyArray<readonly [number, number]> = [[38, 85], [85, 133], [163, 260]];
  return (
    <AbsoluteFill style={stage}>
      <Img src={staticFile(ENGINES)} style={fullImage} />
      <div style={chapter}><span style={number}>02</span>按机器条件选配音引擎</div>
      <svg width='1920' height='1080' viewBox='0 0 1920 1080' style={annotation} aria-hidden='true'>
        {ENGINE_ANCHORS.map((anchor: Anchor, n: number): React.ReactElement => {
          const b = bounds(anchor);
          const [start, end] = timings[n] ?? [0, 1];
          const p = smooth(ramp(f, start, start + 13));
          const alpha = p * (1 - ramp(f, end - 11, end));
          const cx = b.x + b.w / 2;
          const y = b.y + b.h + 6;
          return <path key={anchor.fx} d={`M${cx - b.w * 0.44 * p} ${y - 4}v4H${cx + b.w * 0.44 * p}v-4`} fill='none' stroke={n === 2 ? '#7DB2FF' : '#629DFF'} strokeWidth={n === 2 ? 3 : 2} strokeLinecap='round' strokeLinejoin='round' opacity={alpha} />;
        })}
      </svg>
    </AbsoluteFill>
  );
};

export interface CustomSceneProps { scene: any; idx: number; total: number; beats: any[]; }
export const BATCH_03_SCENES: Record<string, React.FC<CustomSceneProps>> = {
  'scene-13': Scene_scene_13,
  'scene-14': Scene_scene_14,
  'scene-15': Scene_scene_15,
  'scene-16': Scene_scene_16,
  'scene-17': Scene_scene_17,
  'scene-18': Scene_scene_18
};
