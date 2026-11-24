import * as React from 'react';
import {AbsoluteFill, Easing, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {FocusShot, FONT_MONO, FONT_SANS} from '../lib/shotcraft';

const W = 1920;
const H = 1080;
const HARDWARE = 'assets/edited/image-02a-ui-hardware-modal-5c43-edited.png';
const WARROOM = 'assets/edited/image-01a-ui-warroom-light-9353-edited.png';
const POLISH = 'assets/edited/video-03-demo-warroom-cards-polish-1bae-edited.mp4';
const ASSETS = 'assets/edited/video-04-demo-step1-assets-teleprompter-e5e2-edited.mp4';

const stage: React.CSSProperties = {background: 'linear-gradient(155deg,#F8FAFC,#E2E8F0)', overflow: 'hidden', fontFamily: FONT_SANS, color: '#0F2543'};
const media: React.CSSProperties = {position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain'};
const chrome: React.CSSProperties = {position: 'absolute', left: 208, top: 14, height: 39, display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'none', whiteSpace: 'nowrap', fontSize: 15, fontWeight: 650};
const number: React.CSSProperties = {fontFamily: FONT_MONO, fontWeight: 750, color: '#1556B5', fontVariantNumeric: 'tabular-nums'};
const clamped = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ramp = (f: number, a: number, b: number): number => interpolate(f, [a, b], [0, 1], {...clamped, easing: Easing.inOut(Easing.cubic)});
const source = (scene: CustomSceneProps['scene'], fallback: string): string => {
  const path: unknown = scene?.publicAssetFiles?.[0];
  return typeof path === 'string' && path === fallback ? path : fallback;
};

type Anchor = {fx: number; fy: number; fw: number; fh: number};
type Bounds = {x: number; y: number; w: number; h: number};
const pixels = (a: Anchor): Bounds => ({x: W * (a.fx - a.fw / 2), y: H * (a.fy - a.fh / 2), w: W * a.fw, h: H * a.fh});
const protection = pixels({fx: 0.5, fy: 0.4454, fw: 0.1547, fh: 0.1007});
const remotion = pixels({fx: 0.7814, fy: 0.618, fw: 0.1354, fh: 0.035});
const html = pixels({fx: 0.9108, fy: 0.618, fw: 0.1168, fh: 0.035});
const corners = ({x, y, w, h}: Bounds, arm: number): string =>
  `M${x} ${y + arm} V${y} h${arm} M${x + w - arm} ${y} h${arm} v${arm} M${x + w} ${y + h - arm} v${arm} h${-arm} M${x + arm} ${y + h} h${-arm} v${-arm}`;

// 07：保留整张配置表。不为缺少坐标的规格行补画框。
const Scene_scene_07: React.FC<CustomSceneProps> = ({scene}) => {
  const f = useCurrentFrame();
  const recommend = 1 - ramp(f, 73, 91);
  const fourK = ramp(f, 73, 91) * (1 - ramp(f, 181, 199));
  const vram = ramp(f, 181, 199);
  return <AbsoluteFill style={stage}>
    <Img src={staticFile(source(scene, HARDWARE))} style={media} />
    <div style={{...chrome, gap: 12}}>
      <span style={number}>07</span>
      <div style={{display: 'grid', gridTemplateColumns: '144px 176px 72px', gap: 6}}>
        <span style={{padding: '4px 6px', borderBottom: `2px solid rgba(47,123,255,${recommend})`}}>推荐档 · 8 核 / 16 GB</span>
        <span style={{padding: '4px 6px', borderBottom: `2px solid rgba(47,123,255,${fourK})`}}>4K 档 · 12 核+ / 32 GB+</span>
        <span style={{padding: '4px 6px', borderBottom: `2px solid rgba(47,123,255,${vram})`}}>核对显存</span>
      </div>
    </div>
  </AbsoluteFill>;
};

// 08：仅定位低配保护，不模拟点击，不改变卡片填色或选中态。
const Scene_scene_08: React.FC<CustomSceneProps> = ({scene}) => {
  const f = useCurrentFrame();
  const alpha = 0.86 * ramp(f, 70, 86) * (1 - ramp(f, 171, 195));
  return <AbsoluteFill style={stage}>
    <Img src={staticFile(source(scene, HARDWARE))} style={media} />
    <div style={chrome}>
      <span style={{...number, border: '1px solid #B7CFEF', borderRadius: 12, padding: '2px 8px'}}>08</span>
      <span>按任务选择算力模式</span>
    </div>
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{position: 'absolute', inset: 0, pointerEvents: 'none'}} aria-hidden="true">
      <rect x={protection.x - 3} y={protection.y - 3} width={protection.w + 6} height={protection.h + 6} rx={13} fill="none" stroke="#2F7BFF" strokeWidth={2.5} opacity={alpha} />
    </svg>
  </AbsoluteFill>;
};

// 09：擦光与三段阅读进度只画在导航层，界面三卡不动。
const Scene_scene_09: React.FC<CustomSceneProps> = ({scene, idx}) => {
  const f = useCurrentFrame();
  const labels: readonly string[] = ['备料', '需求', '发车参数'];
  const starts: readonly number[] = [17, 76, 146, 241];
  const shineId = `batch02-warroom-sweep-${idx}`;
  const x = -115 + 540 * ramp(f, 0, 20);
  return <AbsoluteFill style={stage}>
    <Img src={staticFile(source(scene, WARROOM))} style={media} />
    <div style={{...chrome, width: 405, gap: 14, overflow: 'hidden'}}>
      <span style={number}>09</span>
      <div style={{display: 'grid', flex: 1, gridTemplateColumns: 'repeat(3, 1fr)', gap: 9}}>
        {labels.map((label: string, i: number): React.ReactElement => {
          const progress = ramp(f, starts[i], starts[i + 1]);
          return <div key={label} style={{padding: '0 4px 6px', position: 'relative'}}>
            <span style={{...number, marginRight: 7}}>{i + 1}</span>{label}
            <div style={{position: 'absolute', bottom: 1, left: 4, right: 4, height: 2, background: '#DCE7F4'}}>
              <div style={{width: `${100 * progress}%`, height: 2, background: '#2F7BFF'}} />
            </div>
          </div>;
        })}
      </div>
      <svg width={405} height={39} viewBox="0 0 405 39" style={{position: 'absolute', inset: 0, pointerEvents: 'none'}} aria-hidden="true">
        <defs><linearGradient id={shineId}><stop stopColor="#FFFFFF" stopOpacity={0} /><stop offset="0.52" stopColor="#BFDBFE" stopOpacity={0.68} /><stop offset="1" stopColor="#FFFFFF" stopOpacity={0} /></linearGradient></defs>
        <rect x={x} width={112} height={39} fill={`url(#${shineId})`} />
      </svg>
    </div>
  </AbsoluteFill>;
};

// 10：260 帧只容纳源片前 8.667 秒；保留 1×，不压速、不假停在未经核验的润色帧。
const Scene_scene_10: React.FC<CustomSceneProps> = ({scene}) => {
  const f = useCurrentFrame();
  const elapsed = String(Math.floor(f / 30)).padStart(2, '0');
  const subframe = String(f % 30).padStart(2, '0');
  return <AbsoluteFill style={stage}>
    <FocusShot src={source(scene, POLISH)} mediaWidth={W} mediaHeight={H} cams={[]} marks={[]} />
    <div style={{...chrome, gap: 0}}>
      <span style={{...number, paddingRight: 11}}>10</span>
      <span style={{padding: '0 11px', borderLeft: '1px solid #B9CFEA'}}>需求与提示词润色</span>
      <span style={{...number, fontSize: 12, padding: '3px 7px', background: '#EAF2FD', borderRadius: 4}}>{`00:${elapsed}:${subframe}`}</span>
    </div>
  </AbsoluteFill>;
};

// 11：在控件外缘画对照端点，不覆盖按钮、不暗示切换，也不标视口外入口。
const Scene_scene_11: React.FC<CustomSceneProps> = ({scene}) => {
  const f = useCurrentFrame();
  const a = ramp(f, 21, 35);
  const b = ramp(f, 67, 81);
  return <AbsoluteFill style={stage}>
    <Img src={staticFile(source(scene, WARROOM))} style={media} />
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{position: 'absolute', inset: 0, pointerEvents: 'none'}} aria-hidden="true">
      <path d={corners({...remotion, y: remotion.y - 4, h: remotion.h + 8}, 10)} fill="none" stroke="#1766DB" strokeWidth={2.8} strokeLinecap="round" opacity={0.92 * a} />
      <path d={corners({...html, y: html.y - 4, h: html.h + 8}, 10)} fill="none" stroke="#1766DB" strokeWidth={2.8} strokeLinecap="round" opacity={0.92 * b} />
    </svg>
    <div style={{...chrome, gap: 8}}>
      <span style={{...number, marginRight: 4}}>11</span>
      <span>编码引擎</span>
      <span style={{padding: '2px 7px', color: '#1556B5', background: `rgba(125,178,255,${0.18 * a})`, borderRadius: 4}}>Remotion</span>
      <span style={{color: '#64748B'}}>／</span>
      <span style={{padding: '2px 7px', color: '#1556B5', background: `rgba(125,178,255,${0.18 * b})`, borderRadius: 4}}>HTML5</span>
    </div>
  </AbsoluteFill>;
};

// 12：完整保留拍摄棚操作。素材结束后以最后一张真实画面承接余量，
// 不把片尾标成筛选结果；筛选结果停帧须在核验源时间码后再设置。
const Scene_scene_12: React.FC<CustomSceneProps> = ({scene}) => {
  const f = useCurrentFrame();
  const path = source(scene, ASSETS);
  const lastFullFrame = 215;
  const live = f <= lastFullFrame;
  const wipe = ramp(f, 0, 16);
  return <AbsoluteFill style={stage}>
    {live
      ? <FocusShot src={path} mediaWidth={W} mediaHeight={H} cams={[]} marks={[]} />
      : <OffthreadVideo src={staticFile(path)} muted playbackRate={lastFullFrame / f} style={media} />}
    <div style={{...chrome, width: 386, overflow: 'hidden'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 11, clipPath: `inset(0 ${100 * (1 - wipe)}% 0 0)`}}>
        <span style={{...number, color: '#FFFFFF', background: '#1766DB', borderRadius: 5, padding: '3px 8px'}}>12</span>
        <span>分步精修</span>
        <span aria-hidden="true" style={{color: '#6486B2'}}>›</span>
        <span>第 1 步 · 筛选素材</span>
      </div>
      <div aria-hidden="true" style={{position: 'absolute', left: 286 * wipe, width: 2, top: 6, bottom: 6, background: '#7DB2FF', boxShadow: '0 0 9px #7DB2FF', opacity: 1 - ramp(f, 12, 20)}} />
    </div>
  </AbsoluteFill>;
};

export interface CustomSceneProps { scene: any; idx: number; total: number; beats: any[]; }
export const BATCH_02_SCENES: Record<string, React.FC<CustomSceneProps>> = {
  'scene-07': Scene_scene_07,
  'scene-08': Scene_scene_08,
  'scene-09': Scene_scene_09,
  'scene-10': Scene_scene_10,
  'scene-11': Scene_scene_11,
  'scene-12': Scene_scene_12
};