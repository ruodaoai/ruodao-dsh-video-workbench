import * as React from 'react';
import {AbsoluteFill, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_MONO, FONT_SANS} from '../lib/shotcraft';

// 顶部 42px 用于导航。源画面等比完整呈现，占 1920×1080 画布约 92.4%。
const WIDTH = 1920;
const HEIGHT = 1080;
const RAIL = 42;
const MEDIA_H = HEIGHT - RAIL;
const MEDIA_W = MEDIA_H * 16 / 9;
const MEDIA_X = (WIDTH - MEDIA_W) / 2;
const BLUE = '#195ED2';
const INK = '#172742';
const MUTED = '#475B76';
const BG = 'linear-gradient(180deg,#F8FAFC 0%,#E2E8F0 100%)';
const ROOT: React.CSSProperties = {background: BG, color: INK, fontFamily: FONT_SANS, overflow: 'hidden'};
const MEDIA: React.CSSProperties = {position: 'absolute', left: MEDIA_X, top: RAIL, width: MEDIA_W, height: MEDIA_H, display: 'block', objectFit: 'contain'};
const SEQUENCE_NUMBER: React.CSSProperties = {fontFamily: FONT_MONO, fontWeight: 700, fontSize: 14, letterSpacing: '0.08em', color: BLUE};
const CLAMP = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const PATHS = {
  overview: 'assets/edited/image-01a-ui-warroom-light-9353-edited.png',
  projectVideo: 'assets/edited/video-01-demo-drawer-new-project-473d-edited.mp4',
  drawer: 'assets/edited/image-01b-ui-drawer-open-8ece-edited.png',
  create: 'assets/edited/image-01c-ui-new-project-modal-57a0-edited.png',
  hardwareVideo: 'assets/edited/video-02-demo-hardware-lowspec-2caf-edited.mp4',
  hardware: 'assets/edited/image-02a-ui-hardware-modal-5c43-edited.png',
} as const;

type Anchor = Readonly<{fx: number; fy: number; fw: number; fh: number}>;
const PROJECT_ANCHORS = {
  drawer: {fx: 0.2591, fy: 0.0343, fw: 0.1563, fh: 0.0401},
  newProject: {fx: 0.1476, fy: 0.0394, fw: 0.0473, fh: 0.037},
} as const satisfies Record<string, Anchor>;
const HARDWARE_ANCHORS = {
  hardware: {fx: 0.6296, fy: 0.0343, fw: 0.0638, fh: 0.0401},
  lowSpec: {fx: 0.4641, fy: 0.4197, fw: 0.0664, fh: 0.0224},
} as const satisfies Record<string, Anchor>;

// 可选的核验数据以剪辑后素材的 30fps 帧号填写，而非合成帧号。
// scene.verifiedClickFrames: {drawer?, newProject?, hardware?, lowSpec?}
// scene.verifiedLowSpecHoldFrame: 强制低配保护已选中、尚未切回的一帧。
// 清单只提供空间锚点，未提供动作帧号；缺少核验数据时不补造点击或选中态。
function verifiedFrame(value: unknown, last: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= last ? value : undefined;
}

function asset(scene: CustomSceneProps['scene'], fallback: string, extension: string): string {
  const files: unknown = scene?.publicAssetFiles;
  const first: unknown = Array.isArray(files) ? files[0] : undefined;
  return typeof first === 'string' && first.startsWith('assets/') && first.endsWith(extension) ? first : fallback;
}

function lastSafeFrame(seconds: number, fps: number): number {
  return Math.max(1, Math.floor(seconds * fps) - 1);
}

function changeOfTime(frame: number, sourceFrame: number): number {
  // OffthreadVideo 按本地帧 × playbackRate 取样；定格期间将乘积锁在同一源帧。
  return frame > 0 ? sourceFrame / frame : 1;
}

const Locator: React.FC<{anchor: Anchor; sourceTime: number; at: number | undefined}> = ({anchor, sourceTime, at}) => {
  if (at === undefined) return null;
  const age = sourceTime - at / 30;
  if (age < 0 || age >= 0.45) return null;
  const p = age / 0.45;
  const spread = 3 + p * 11;
  const x = MEDIA_X + (anchor.fx - anchor.fw / 2) * MEDIA_W - spread;
  const y = RAIL + (anchor.fy - anchor.fh / 2) * MEDIA_H - spread;
  const w = anchor.fw * MEDIA_W + spread * 2;
  const h = anchor.fh * MEDIA_H + spread * 2;
  const opacity = (1 - p) ** 2;
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{position: 'absolute', inset: 0, width: WIDTH, height: HEIGHT, opacity, pointerEvents: 'none'}}>
      <rect x={x} y={y} width={w} height={h} rx={10} fill="none" stroke="#F8FAFC" strokeWidth={6} />
      <rect x={x} y={y} width={w} height={h} rx={10} fill="none" stroke="#2F7BFF" strokeWidth={3} />
    </svg>
  );
};

const Scene_scene_01: React.FC<CustomSceneProps> = ({scene}) => {
  const f = useCurrentFrame();
  const reveal = interpolate(f, [0, 14], [0, 1], CLAMP);
  const leave = interpolate(f, [62, 85], [0, 1], CLAMP);
  return (
    <AbsoluteFill style={ROOT}>
      <Img src={staticFile(asset(scene, PATHS.overview, '.png'))} style={MEDIA} />
      <div style={{position: 'absolute', left: 38, top: 0, height: RAIL, display: 'flex', alignItems: 'center', gap: 15}}>
        <span style={{...SEQUENCE_NUMBER, borderBottom: '2px solid #2F7BFF', paddingBottom: 2}}>01 · 工程管理</span>
        <strong style={{fontSize: 22, opacity: reveal * (1 - leave), transform: `translateX(${(1 - reveal) * -12 + leave * 8}px)`}}>从新建工程开始</strong>
      </div>
    </AbsoluteFill>
  );
};

const Scene_scene_02: React.FC<CustomSceneProps> = ({scene}) => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const last = lastSafeFrame(5.875, fps);
  const source = Math.min(f, last);
  const sourceTime = source / fps;
  const sourceLimit = Math.floor(last / fps * 30);
  const open = verifiedFrame(scene?.verifiedClickFrames?.drawer, sourceLimit);
  const create = verifiedFrame(scene?.verifiedClickFrames?.newProject, sourceLimit);
  const stopped = f >= last;
  const progress = source / last;
  return (
    <AbsoluteFill style={ROOT}>
      <OffthreadVideo src={staticFile(asset(scene, PATHS.projectVideo, '.mp4'))} style={MEDIA} playbackRate={changeOfTime(f, source)} muted />
      {!stopped && <Locator anchor={PROJECT_ANCHORS.drawer} sourceTime={sourceTime} at={open} />}
      {!stopped && <Locator anchor={PROJECT_ANCHORS.newProject} sourceTime={sourceTime} at={create} />}
      <div style={{position: 'absolute', left: 38, top: 0, height: RAIL, display: 'flex', alignItems: 'center', gap: 13, fontSize: 18, fontWeight: 650}}>
        <span style={SEQUENCE_NUMBER}>02</span>
        <span>工程管理</span><span aria-hidden="true" style={{color: BLUE}}>›</span>
        <span>新建视频工程</span><span aria-hidden="true" style={{color: BLUE}}>›</span>
        <span style={{color: stopped ? BLUE : INK}}>输入项目名称</span>
      </div>
      <div style={{position: 'absolute', top: 39, left: 38, width: 398, height: 2, background: '#D6E3F5'}}>
        <div style={{width: `${progress * 100}%`, height: '100%', background: '#2F7BFF'}} />
      </div>
    </AbsoluteFill>
  );
};

const Scene_scene_03: React.FC<CustomSceneProps> = ({scene}) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [10, 40], [0, 1], CLAMP);
  return (
    <AbsoluteFill style={ROOT}>
      <Img src={staticFile(asset(scene, PATHS.drawer, '.png'))} style={MEDIA} />
      <div style={{position: 'absolute', top: 0, left: 38, height: RAIL, display: 'flex', alignItems: 'center', gap: 13}}>
        <strong style={{fontSize: 20}}>从列表切换已有工程</strong>
        <svg aria-hidden="true" viewBox="0 0 48 22" width={48} height={22}>
          <path d="M2 11 H19 Q25 11 25 6 H42 M19 11 Q25 11 25 17 H42" fill="none" stroke="#CCD7E6" strokeWidth={2} />
          <path d="M2 11 H19 Q25 11 25 17 H42" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} strokeLinecap="round" fill="none" stroke="#2F7BFF" strokeWidth={2} />
        </svg>
        <span style={{fontSize: 16, color: MUTED, opacity: p}}>历史工程 → 对应工作区</span>
      </div>
    </AbsoluteFill>
  );
};

const Scene_scene_04: React.FC<CustomSceneProps> = ({scene}) => {
  const f = useCurrentFrame();
  const choices = interpolate(f, [62, 84], [0, 1], CLAMP);
  return (
    <AbsoluteFill style={ROOT}>
      <Img src={staticFile(asset(scene, PATHS.create, '.png'))} style={MEDIA} />
      <div style={{position: 'absolute', top: 0, left: 38, height: RAIL, display: 'flex', alignItems: 'center', gap: 15}}>
        <div style={{width: 3, height: 20, borderRadius: 2, background: '#2F7BFF'}} />
        <strong style={{fontSize: 20}}>提交前核对工程名</strong>
        <div style={{display: 'flex', gap: 11, alignItems: 'center', borderLeft: '1px solid #CBDAEC', paddingLeft: 15, fontSize: 16, opacity: choices, transform: `translateY(${(1 - choices) * 4}px)`}}>
          <span style={{fontWeight: 650, color: BLUE}}>确认创建</span>
          <span style={{color: MUTED}}>或</span>
          <span style={{color: MUTED}}>取消返回</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Scene_scene_05: React.FC<CustomSceneProps> = ({scene}) => {
  const f = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const last = lastSafeFrame(6.417, fps);
  const sourceLimit = Math.floor(last / fps * 30);
  const hold = verifiedFrame(scene?.verifiedLowSpecHoldFrame, sourceLimit);
  const canHold = hold !== undefined && hold > 0;
  // 未核验选中帧时匀速播放完整录屏，不把实录末尾的切回标成开启。
  const nominalRate = canHold ? 1 : Math.min(1, last / Math.max(1, Math.min(durationInFrames, 248) - 1));
  const holdAt = canHold ? hold * fps / 30 : last;
  const source = Math.min(f * nominalRate, holdAt);
  const sourceTime = source / fps;
  const holding = canHold && source >= holdAt;
  const wipe = interpolate(f, [0, 16], [0, 1], CLAMP);
  const wipeAlpha = interpolate(f, [0, 3, 16], [0, 0.85, 0], CLAMP);
  const open = verifiedFrame(scene?.verifiedClickFrames?.hardware, sourceLimit);
  const protect = verifiedFrame(scene?.verifiedClickFrames?.lowSpec, sourceLimit);
  return (
    <AbsoluteFill style={ROOT}>
      <OffthreadVideo src={staticFile(asset(scene, PATHS.hardwareVideo, '.mp4'))} style={MEDIA} playbackRate={f === 0 ? nominalRate : changeOfTime(f, source)} muted />
      {!holding && <Locator anchor={HARDWARE_ANCHORS.hardware} sourceTime={sourceTime} at={open} />}
      {!holding && <Locator anchor={HARDWARE_ANCHORS.lowSpec} sourceTime={sourceTime} at={protect} />}
      <div style={{position: 'absolute', left: 38, top: 0, height: RAIL, display: 'flex', alignItems: 'center', gap: 14}}>
        <svg aria-hidden="true" viewBox="0 0 32 24" width={32} height={24}>
          <path d="M1 13 H8 L12 6 L17 19 L22 10 H31" fill="none" stroke="#2F7BFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <strong style={{fontSize: 20}}>打开算力体检</strong>
        <span style={{fontSize: 16, color: holding ? BLUE : MUTED}}>{holding ? '强制低配保护' : '本机实测 · CPU / 内存 / 显卡'}</span>
      </div>
      <div aria-hidden="true" style={{position: 'absolute', top: 39, left: -250 + wipe * 1270, width: 250, height: 3, opacity: wipeAlpha, background: 'linear-gradient(90deg,transparent,#7DB2FF,#FFFFFF,transparent)', pointerEvents: 'none'}} />
    </AbsoluteFill>
  );
};

const Scene_scene_06: React.FC<CustomSceneProps> = ({scene}) => {
  const f = useCurrentFrame();
  const reference = interpolate(f, [34, 51], [0, 1], CLAMP);
  const caveat = interpolate(f, [123, 142], [0, 1], CLAMP);
  return (
    <AbsoluteFill style={ROOT}>
      <Img src={staticFile(asset(scene, PATHS.hardware, '.png'))} style={MEDIA} />
      <div style={{position: 'absolute', left: 38, top: 0, height: RAIL, display: 'flex', alignItems: 'center', gap: 14, whiteSpace: 'nowrap'}}>
        <strong style={{fontSize: 20}}>先对照最低配置</strong>
        <div style={{display: 'flex', alignItems: 'center', gap: 12, opacity: reference, borderLeft: '1px solid #CBDAEC', paddingLeft: 14}}>
          <span style={{fontSize: 17, fontWeight: 650}}><b style={SEQUENCE_NUMBER}>4</b> 核 CPU</span>
          <span style={{fontSize: 17, fontWeight: 650}}><b style={SEQUENCE_NUMBER}>8 GB</b> 内存</span>
        </div>
        <span style={{fontSize: 15, color: MUTED, opacity: caveat}}>低配保护运行参考，不代表能流畅渲染 4K</span>
      </div>
    </AbsoluteFill>
  );
};

export interface CustomSceneProps { scene: any; idx: number; total: number; beats: any[]; }
export const BATCH_01_SCENES: Record<string, React.FC<CustomSceneProps>> = {
  'scene-01': Scene_scene_01,
  'scene-02': Scene_scene_02,
  'scene-03': Scene_scene_03,
  'scene-04': Scene_scene_04,
  'scene-05': Scene_scene_05,
  'scene-06': Scene_scene_06
};
