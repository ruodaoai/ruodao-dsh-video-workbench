import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import scriptData from '../script.json';
import { AIBadge, AppWindow, AvatarOverlay, BeforeAfterWipe, EndNotice, FocusShot, MetricPanel, SceneTransitionOverlay, WorkflowBar, FONT_SANS, FONT_MONO, FONT_SERIF } from './lib/shotcraft';
import { NarrativeDioramaStage } from './lib/narrative-diorama';
import { CUSTOM_SCENE_MAP } from './scenes';

const PALETTE: any = {"background":"#050608","surface":"#10141E","textPrimary":"#F1F5F9","textSecondary":"#94A3B8","accent":"#2F7BFF","accent2":"#7DB2FF","gold":"#F5B92E","rgbAccent":"125,178,255","rgbGold":"245,185,46","titleGrad":"linear-gradient(180deg,#FFFFFF 0%,#E2E8F0 52%,#94A3B8 100%)","accentGrad":"linear-gradient(180deg,#CFE1FF 0%,#4F95FF 55%,#1F5FE0 100%)"};
const SANS = FONT_SANS;
const MONO = FONT_MONO;
const DEFAULT_SUBTITLE_BOTTOM = 422;
const DEFAULT_BADGE_TEXT = "AI 辅助创作";
const DEFAULT_END_NOTICE = "本视频由 DeepSeek Harness 创作：AI 大模型编码驱动视觉合成 · AI 编程合成配乐 + IndexTTS-2.5 语音合成";
const easeOut = Easing.bezier(0.22, 1, 0.36, 1);

const PARTICLES = Array.from({ length: 34 }, (_, i) => {
  const seed = (i * 9301 + 49297) % 233280;
  return {
    x0: (seed % 1000) / 1000,
    y0: ((seed * 7) % 1000) / 1000,
    size: 2.5 + (i % 4) * 2.2,
    vx: (i % 2 === 0 ? 1 : -1) * (0.0004 + (i % 5) * 0.00018),
    vy: -(0.0005 + (i % 4) * 0.00022),
    alpha: 0.14 + (i % 5) * 0.06,
  };
});

const OPENER_SLOTS = [
  { x: -720, y: -340, z: -260, rx: 14, ry: 22, rz: -8, scale: 0.85 },
  { x: 690, y: -330, z: -240, rx: 14, ry: -20, rz: 7, scale: 0.85 },
  { x: -760, y: 240, z: -220, rx: -12, ry: 18, rz: 5, scale: 0.88 },
  { x: 740, y: 250, z: -210, rx: -12, ry: -18, rz: -6, scale: 0.88 },
  { x: -450, y: -360, z: -420, rx: 10, ry: 12, rz: -4, scale: 0.76 },
  { x: 460, y: -350, z: -410, rx: 10, ry: -12, rz: 4, scale: 0.76 },
  { x: -490, y: 310, z: -380, rx: -10, ry: 14, rz: 3, scale: 0.78 },
  { x: 480, y: 310, z: -370, rx: -10, ry: -14, rz: -3, scale: 0.78 },
  { x: -830, y: -30, z: -150, rx: 4, ry: 26, rz: -5, scale: 0.92 },
  { x: 830, y: -20, z: -150, rx: 4, ry: -26, rz: 5, scale: 0.92 },
  { x: -210, y: -380, z: -560, rx: 16, ry: 6, rz: -2, scale: 0.68 },
  { x: 220, y: -380, z: -560, rx: 16, ry: -6, rz: 2, scale: 0.68 },
];

const RADIAL_RAYS = Array.from({ length: 28 }, (_, i) => ({
  angle: (i / 28) * Math.PI * 2,
  len: 440 + (i % 3) * 190,
  width: i % 2 === 0 ? 3.5 : 1.8,
}));

function hashNum(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function formatBalancedTitle(rawTitle: string, maxChars = 11): string[] {
  const txt = String(rawTitle || '').trim();
  if (!txt) return [''];
  if (txt.includes('\n')) return txt.split('\n').map((s) => s.trim()).filter(Boolean);
  if (txt.length <= maxChars) return [txt];
  const colonIdx = txt.search(/[：:]/);
  if (colonIdx > 2 && colonIdx < txt.length - 3) {
    return [txt.slice(0, colonIdx + 1).trim(), txt.slice(colonIdx + 1).trim()];
  }
  const mid = Math.ceil(txt.length / 2);
  return [txt.slice(0, mid).trim(), txt.slice(mid).trim()];
}

function getBeatPulse(tSec: number, beats: any[]): number {
  if (!Array.isArray(beats) || beats.length === 0) return 0;
  let best = 0;
  for (let i = 0; i < beats.length; i++) {
    const raw = beats[i];
    const bt = typeof raw === 'number' ? raw : Number(raw?.time);
    if (!Number.isFinite(bt)) continue;
    const dt = tSec - bt;
    if (dt >= 0 && dt < 0.34) {
      const strongBoost = typeof raw === 'object' && raw?.strong ? 1 : 0.68;
      const p = Math.exp(-dt * 11) * strongBoost;
      if (p > best) best = p;
    }
  }
  return best;
}

function renderSubtitleSegments(rawText: string, accentWords: string[] = []): React.ReactNode {
  const clean = String(rawText || '').trim();
  if (!clean) return null;
  const parts: Array<{ text: string; accent: boolean }> = [];
  let cursor = 0;
  const bracketRe = /【([^】]+)】/g;
  let m: RegExpExecArray | null;
  while ((m = bracketRe.exec(clean)) !== null) {
    if (m.index > cursor) parts.push({ text: clean.slice(cursor, m.index), accent: false });
    parts.push({ text: m[1], accent: true });
    cursor = m.index + m[0].length;
  }
  if (cursor < clean.length) {
    parts.push({ text: clean.slice(cursor), accent: false });
  }
  const kwList = (Array.isArray(accentWords) ? accentWords : []).map((w) => String(w || '').trim()).filter(Boolean);
  if (kwList.length === 0) {
    return parts.map((p, pi) =>
      p.accent ? <span key={pi} style={{ color: '#F6C26B' }}>{p.text}</span> : <span key={pi}>{p.text}</span>
    );
  }
  const out: React.ReactNode[] = [];
  parts.forEach((part, pi) => {
    if (part.accent) {
      out.push(<span key={`p-${pi}`} style={{ color: '#F6C26B' }}>{part.text}</span>);
      return;
    }
    let rem = part.text;
    let subIdx = 0;
    while (rem.length > 0) {
      let bestPos = -1;
      let bestKw = '';
      for (const kw of kwList) {
        const pos = rem.indexOf(kw);
        if (pos >= 0 && (bestPos < 0 || pos < bestPos || (pos === bestPos && kw.length > bestKw.length))) {
          bestPos = pos;
          bestKw = kw;
        }
      }
      if (bestPos < 0) {
        out.push(<span key={`${pi}-${subIdx++}`}>{rem}</span>);
        break;
      }
      if (bestPos > 0) {
        out.push(<span key={`${pi}-${subIdx++}`}>{rem.slice(0, bestPos)}</span>);
      }
      out.push(<span key={`${pi}-${subIdx++}`} style={{ color: '#F6C26B' }}>{bestKw}</span>);
      rem = rem.slice(bestPos + bestKw.length);
    }
  });
  return out;
}

const MediaTile: React.FC<{
  media: any;
  progress: number;
  isBlur?: boolean;
  scaleBoost?: number;
  fitMode?: 'cover' | 'contain';
}> = ({ media, progress, isBlur, scaleBoost = 1, fitMode = 'cover' }) => {
  if (!media?.path) return null;
  const rel = String(media.path).replace(/^\/+/, '').replace(/\\/g, '/');
  const motion = media.motion || 'zoom-in';
  let transform = `scale(${scaleBoost})`;
  if (!isBlur && motion !== 'static') {
    if (motion === 'zoom-out') {
      transform = `scale(${interpolate(progress, [0, 1], [1.14, 1.0]) * scaleBoost})`;
    } else if (motion === 'pan-left') {
      transform = `scale(${1.1 * scaleBoost}) translateX(${interpolate(progress, [0, 1], [3.5, -3.5])}%)`;
    } else if (motion === 'pan-right') {
      transform = `scale(${1.1 * scaleBoost}) translateX(${interpolate(progress, [0, 1], [-3.5, 3.5])}%)`;
    } else {
      transform = `scale(${interpolate(progress, [0, 1], [1.0, 1.12]) * scaleBoost})`;
    }
  } else if (isBlur) {
    transform = 'scale(1.18)';
  }
  const isVid = media.type === 'video' || /\.(mp4|mov|webm|mkv)$/i.test(rel);
  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: fitMode === 'contain' ? 'contain' : 'cover',
    transform,
    filter: isBlur ? 'blur(26px) brightness(0.32) saturate(1.25)' : undefined,
  };
  if (isVid) {
    return <OffthreadVideo src={staticFile(rel)} style={style} muted />;
  }
  return <Img src={staticFile(rel)} style={style} />;
};

const KineticHeadline: React.FC<{
  lines: string[];
  localFrame: number;
  fps: number;
  fontSize: number;
  align?: 'center' | 'left';
  rgbSplit?: number;
}> = ({ lines, localFrame, fps, fontSize, align = 'center', rgbSplit = 0 }) => {
  let charGlobalIdx = 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'left' ? 'flex-start' : 'center', gap: 6 }}>
      {lines.map((line, li) => {
        const chars = [...line];
        return (
          <div
            key={li}
            style={{
              display: 'flex',
              flexWrap: 'nowrap',
              justifyContent: align === 'left' ? 'flex-start' : 'center',
              position: 'relative',
            }}
          >
            {chars.map((ch, ci) => {
              const idx = charGlobalIdx++;
              const sp = spring({
                frame: Math.max(0, localFrame - 2 - idx * 1.1),
                fps,
                config: { damping: 14, stiffness: 210, mass: 0.72 },
              });
              const y = interpolate(sp, [0, 1], [42, 0]);
              const sc = interpolate(sp, [0, 1], [1.22, 1]);
              const op = interpolate(sp, [0, 0.35, 1], [0, 1, 1], { extrapolateRight: 'clamp' });
              const shadowSplit =
                rgbSplit > 0.2
                  ? `${rgbSplit}px 0 rgba(255,40,90,0.68), -${rgbSplit}px 0 rgba(0,225,255,0.68), 0 12px 34px rgba(0,0,0,0.72)`
                  : '0 12px 34px rgba(0,0,0,0.68)';
              return (
                <span
                  key={ci}
                  style={{
                    display: 'inline-block',
                    fontFamily: SANS,
                    fontSize,
                    fontWeight: 900,
                    lineHeight: 1.16,
                    color: PALETTE.textPrimary,
                    opacity: op,
                    transform: `translateY(${y}px) scale(${sc})`,
                    textShadow: shadowSplit,
                    letterSpacing: -0.5,
                  }}
                >
                  {ch === ' ' ? '\u00A0' : ch}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

const HighlightsRow: React.FC<{
  highlights: string[];
  localFrame: number;
  fps: number;
  align?: 'center' | 'left';
}> = ({ highlights, localFrame, fps, align = 'center' }) => {
  if (!highlights.length) return null;
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: align === 'left' ? 'flex-start' : 'center',
        gap: 12,
        marginTop: 22,
      }}
    >
      {highlights.map((kw, ki) => {
        const sp = spring({
          frame: Math.max(0, localFrame - 12 - ki * 3.5),
          fps,
          config: { damping: 15, stiffness: 185 },
        });
        return (
          <div
            key={ki}
            style={{
              padding: '9px 20px',
              borderRadius: 999,
              background: 'rgba(15, 23, 42, 0.84)',
              border: `1.5px solid ${PALETTE.accent}99`,
              boxShadow: `0 8px 26px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.16)`,
              color: '#F8FAFC',
              fontFamily: SANS,
              fontSize: 20,
              fontWeight: 700,
              opacity: interpolate(sp, [0, 1], [0, 1]),
              transform: `translateY(${interpolate(sp, [0, 1], [18, 0])}px) scale(${interpolate(sp, [0, 1], [0.9, 1])})`,
            }}
          >
            ◆ {kw}
          </div>
        );
      })}
    </div>
  );
};

const SceneStage: React.FC<{
  scene: any;
  idx: number;
  total: number;
  beats: number[];
}> = ({ scene, idx, total, beats }) => {
  const localFrame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const isPortrait = width < height;
  const cx = width / 2;
  const cy = height / 2;
  const rxScale = width / 1920;
  const ryScale = height / 1080;
  const dur = Math.max(8, Number(scene.durationInFrames) || 90);
  const progress = Math.min(1, localFrame / Math.max(1, dur - 1));
  const absFrame = (Number(scene.startFrame) || 0) + localFrame;
  const absTimeSec = absFrame / Math.max(1, fps);
  const bp = getBeatPulse(absTimeSec, beats);

  const txKind = scene.transition || 'iris-circle';
  const layout = scene.layout || (idx === 0 ? '3d-stage-opener' : idx === total - 1 ? 'radial-climax' : 'media-split-motion');

  const CustomSceneComp = CUSTOM_SCENE_MAP && scene?.id ? CUSTOM_SCENE_MAP[scene.id] : undefined;
  if (CustomSceneComp) {
    const publicAssetFiles =
      Array.isArray(scene.publicAssetFiles) && scene.publicAssetFiles.length > 0
        ? scene.publicAssetFiles
        : Array.isArray(scene.media) && scene.media.length > 0
          ? scene.media.map((m: any) => String(m?.path || '').replace(/^[/\\]+/, '').replace(/\\/g, '/')).filter(Boolean)
          : Array.isArray(scene.assetPaths) && scene.assetPaths.length > 0
            ? scene.assetPaths.map((p: any) => String(p || '').replace(/^[/\\]+/, '').replace(/\\/g, '/')).filter(Boolean)
            : scene.mediaPath
              ? [String(scene.mediaPath).replace(/^[/\\]+/, '').replace(/\\/g, '/')]
              : [];
    const hydratedScene = { ...scene, publicAssetFiles };
    return (
      <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: PALETTE.background }}>
        <CustomSceneComp scene={hydratedScene} idx={idx} total={total} beats={beats} />
        <SceneTransitionOverlay
          txKind={txKind}
          localFrame={localFrame}
          dur={dur}
          accentColor={PALETTE.accent}
          goldColor={PALETTE.gold || PALETTE.accent2}
          bgColor={PALETTE.background}
        />
      </AbsoluteFill>
    );
  }

  if (layout === 'narrative-diorama') {
    return (
      <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: PALETTE.background }}>
        <NarrativeDioramaStage scene={scene} idx={idx} total={total} beats={beats} />
        <SceneTransitionOverlay
          txKind={txKind}
          localFrame={localFrame}
          dur={dur}
          accentColor={PALETTE.accent}
          goldColor={PALETTE.gold || PALETTE.accent2}
          bgColor={PALETTE.background}
        />
      </AbsoluteFill>
    );
  }

  const mediaList: any[] = Array.isArray(scene.media)
    ? scene.media
    : scene.mediaPath
      ? [{ path: scene.mediaPath, type: scene.mediaType || 'image', motion: scene.kenBurns || 'zoom-in' }]
      : [];
  const poolList: any[] = Array.isArray(scene.poolMedia) && scene.poolMedia.length > 0 ? scene.poolMedia : mediaList;
  const primary = mediaList[0] || poolList[0] || null;
  const secondary = mediaList[1] || poolList[1] || null;

  const titleLines = formatBalancedTitle(scene.title || `第 ${idx + 1} 幕`, layout === 'media-split-motion' ? 9 : 11);
  const highlights: string[] = Array.isArray(scene.highlights) ? scene.highlights.filter(Boolean).slice(0, 3) : [];
  const sceneTag = String(scene.tag || `0${idx + 1}`);

  // Impact shake & punch camera (restrained on clean UI showcase layouts)
  const isHeavyImpact = ['kinetic-impact', 'radial-climax', '3d-stage-opener', 'mosaic-pulse-wall'].includes(layout);
  const impactDecay = isHeavyImpact && localFrame < 12 ? Math.exp(-localFrame * 0.3) : 0;
  const shakeX = (hashNum(absFrame * 1.3 + 7) - 0.5) * 12 * impactDecay;
  const shakeY = (hashNum(absFrame * 2.1 + 19) - 0.5) * 9 * impactDecay;
  const punchZoom = isHeavyImpact && txKind === 'zoom-punch' && localFrame < 12 ? interpolate(localFrame, [0, 12], [1.1, 1], { easing: easeOut }) : 1;
  const beatZoom = 1 + bp * (isHeavyImpact ? 0.012 : 0.004);
  const rgbSplit = (txKind === 'glitch-cut' && localFrame < 14 ? 7 * (1 - localFrame / 14) : 0) + impactDecay * 3.5;

  const enterFade = interpolate(localFrame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  const exitFade = interpolate(localFrame, [Math.max(0, dur - 8), dur], [1, 0], { extrapolateLeft: 'clamp' });
  const isHardCut = txKind === 'cut' || txKind === 'flash-cut';
  const masterOpacity = isHardCut ? 1 : Math.min(enterFade, exitFade);

  // Specular sweep position across stage
  const sweepX = interpolate(localFrame % Math.max(60, Math.floor(dur * 0.65)), [0, 55], [-400, 2200], {
    extrapolateRight: 'clamp',
  });

  // Counter ticker value for mosaic-pulse-wall
  const targetNum = Math.max(10, Number(scene.counterTarget) || 100);
  const counterProgress = interpolate(localFrame, [10, Math.min(dur - 12, 65)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeOut,
  });
  const counterDisplay = Math.round(targetNum * counterProgress);

  return (
    <AbsoluteFill style={{ opacity: masterOpacity, overflow: 'hidden', backgroundColor: PALETTE.background }}>
      {/* World Camera Container */}
      <AbsoluteFill
        style={{
          transform: `translate(${shakeX.toFixed(2)}px, ${shakeY.toFixed(2)}px) scale(${(punchZoom * beatZoom).toFixed(4)})`,
        }}
      >
        {/* Atmospheric Backdrop Media (Subtle only, never dark-veiling AppWindow foregrounds) */}
        {primary && !['app-focus-shot', 'split-wipe-compare', 'multi-window-trio', 'card-fan-opener', 'workflow-steps', 'metric-dashboard'].includes(layout) ? (
          <AbsoluteFill style={{ opacity: layout === '3d-stage-opener' || layout === 'mosaic-pulse-wall' ? 0.24 : 0.36 }}>
            <MediaTile media={primary} progress={progress} isBlur={layout !== 'kinetic-impact'} />
          </AbsoluteFill>
        ) : null}

        {/* Radial Color Wash */}
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at 50% 42%, rgba(${PALETTE.rgbAccent || '60,140,255'}, ${0.16 + bp * 0.08}), transparent 58%), radial-gradient(circle at 15% 82%, rgba(${PALETTE.rgbGold || '245,185,46'}, 0.1), transparent 46%)`,
          }}
        />

        {/* Ambient Floating Particles & Dot Grid */}
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          <svg width={width} height={height} style={{ position: 'absolute', inset: 0, opacity: 0.22 }}>
            <defs>
              <pattern id={`grid-${idx}`} width="64" height="64" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1.4" fill={PALETTE.accent2 || PALETTE.accent} />
              </pattern>
            </defs>
            <rect width={width} height={height} fill={`url(#grid-${idx})`} />
          </svg>
          {PARTICLES.map((p, pi) => {
            const px = ((((p.x0 + absFrame * p.vx) % 1) + 1) % 1) * width;
            const py = ((((p.y0 + absFrame * p.vy) % 1) + 1) % 1) * height;
            return (
              <div
                key={pi}
                style={{
                  position: 'absolute',
                  left: px,
                  top: py,
                  width: p.size,
                  height: p.size,
                  borderRadius: p.size,
                  background: pi % 4 === 0 ? PALETTE.gold || PALETTE.accent2 : PALETTE.accent,
                  opacity: p.alpha + bp * 0.12,
                }}
              />
            );
          })}
        </AbsoluteFill>

        {/* Entrance Shockwave Ring */}
        {localFrame < 26 ? (
          <svg width={width} height={height} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <circle
              cx={cx}
              cy={cy}
              r={interpolate(localFrame, [0, 26], [30, Math.min(width, height) * 0.76], { easing: easeOut })}
              fill="none"
              stroke={PALETTE.accent}
              strokeWidth={interpolate(localFrame, [0, 26], [10, 1])}
              opacity={interpolate(localFrame, [0, 26], [0.75, 0])}
            />
          </svg>
        ) : null}

        {/* LAYOUT 1: 3d-stage-opener */}
        {layout === '3d-stage-opener' ? (
          <AbsoluteFill style={{ perspective: 1300 }}>
            {OPENER_SLOTS.map((slot, si) => {
              const cardSp = spring({
                frame: Math.max(0, localFrame - (si % 6) * 1.8),
                fps,
                config: { damping: 16, stiffness: 120 },
              });
              const m = poolList.length > 0 ? poolList[si % poolList.length] : null;
              const driftX = Math.sin(absFrame * 0.025 + si) * 18;
              const driftY = Math.cos(absFrame * 0.02 + si * 1.7) * 14;
              const pullT = interpolate(localFrame, [0, 22], [1.45, 1.0], { extrapolateRight: 'clamp', easing: easeOut });
              const x = cx + slot.x * rxScale * pullT + driftX - 135;
              const y = cy + slot.y * ryScale * pullT + driftY - 85;
              return (
                <div
                  key={si}
                  style={{
                    position: 'absolute',
                    left: x,
                    top: y,
                    width: 270,
                    height: 170,
                    borderRadius: 14,
                    overflow: 'hidden',
                    background: 'rgba(15, 22, 38, 0.88)',
                    border: `1.5px solid rgba(${PALETTE.rgbAccent || '125,178,255'}, 0.42)`,
                    boxShadow: '0 22px 48px rgba(0,0,0,0.6)',
                    opacity: interpolate(cardSp, [0, 1], [0, 0.78]),
                    transform: `translateZ(${slot.z + bp * 40}px) rotateX(${slot.rx}deg) rotateY(${slot.ry}deg) rotateZ(${slot.rz}deg) scale(${slot.scale * interpolate(cardSp, [0, 1], [0.65, 1])})`,
                  }}
                >
                  {m ? (
                    <MediaTile media={m} progress={progress} />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: SANS,
                        fontSize: 22,
                        fontWeight: 800,
                        color: PALETTE.accent2 || PALETTE.accent,
                      }}
                    >
                      {highlights[si % Math.max(1, highlights.length)] || sceneTag}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Opener Center Hero Title */}
            <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '0 140px 56px' }}>
              <div
                style={{
                  padding: '8px 22px',
                  borderRadius: 999,
                  background: `rgba(${PALETTE.rgbAccent || '60,140,255'}, 0.16)`,
                  border: `1px solid ${PALETTE.accent}`,
                  color: PALETTE.accent2 || PALETTE.accent,
                  fontFamily: SANS,
                  fontSize: 20,
                  fontWeight: 800,
                  letterSpacing: 3,
                  marginBottom: 20,
                }}
              >
                {sceneTag} · {String(idx + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
              </div>
              <KineticHeadline lines={titleLines} localFrame={localFrame} fps={fps} fontSize={84} align="center" rgbSplit={rgbSplit} />
              <div
                style={{
                  width: interpolate(localFrame, [6, 22], [0, 460], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOut }),
                  height: 5,
                  borderRadius: 99,
                  marginTop: 22,
                  background: `linear-gradient(90deg, ${PALETTE.accent}, ${PALETTE.gold || PALETTE.accent2})`,
                  boxShadow: `0 0 24px ${PALETTE.accent}`,
                }}
              />
              <HighlightsRow highlights={highlights} localFrame={localFrame} fps={fps} align="center" />
            </AbsoluteFill>
          </AbsoluteFill>
        ) : null}

        {/* LAYOUT 2: media-split-motion */}
        {layout === 'media-split-motion' ? (
          <AbsoluteFill
            style={{
              display: 'flex',
              flexDirection: isPortrait ? 'column' : 'row',
              alignItems: 'center',
              justifyContent: 'center',
              padding: isPortrait ? '84px 52px 170px' : '70px 104px 120px',
              gap: isPortrait ? 32 : 64,
            }}
          >
            <div style={{ flex: isPortrait ? '0 0 auto' : '1 1 46%', width: isPortrait ? '100%' : 'auto', display: 'flex', flexDirection: 'column', alignItems: isPortrait ? 'center' : 'flex-start' }}>
              <div
                style={{
                  padding: '7px 18px',
                  borderRadius: 999,
                  background: `rgba(${PALETTE.rgbAccent || '60,140,255'}, 0.16)`,
                  border: `1px solid ${PALETTE.accent}`,
                  color: PALETTE.accent2 || PALETTE.accent,
                  fontFamily: MONO,
                  fontSize: 17,
                  fontWeight: 700,
                  marginBottom: 20,
                }}
              >
                {String(idx + 1).padStart(2, '0')} / {String(total).padStart(2, '0')} · {sceneTag}
              </div>
              <KineticHeadline lines={titleLines} localFrame={localFrame} fps={fps} fontSize={isPortrait ? 52 : 66} align={isPortrait ? 'center' : 'left'} rgbSplit={rgbSplit} />
              <div
                style={{
                  width: interpolate(localFrame, [6, 22], [0, isPortrait ? 200 : 260], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOut }),
                  height: 5,
                  borderRadius: 99,
                  marginTop: 18,
                  background: `linear-gradient(90deg, ${PALETTE.accent}, ${PALETTE.gold || PALETTE.accent2})`,
                }}
              />
              <HighlightsRow highlights={highlights} localFrame={localFrame} fps={fps} align={isPortrait ? 'center' : 'left'} />
            </div>

            <div style={{ flex: isPortrait ? '1 1 auto' : '1 1 54%', width: isPortrait ? '100%' : 'auto', height: isPortrait ? 560 : 690, position: 'relative', perspective: 1200 }}>
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  borderRadius: 24,
                  overflow: 'hidden',
                  border: `2px solid rgba(${PALETTE.rgbAccent || '125,178,255'}, 0.45)`,
                  boxShadow: `0 36px 90px rgba(0,0,0,0.72), 0 0 42px rgba(${PALETTE.rgbAccent || '60,140,255'}, 0.18)`,
                  transform: `rotateY(${interpolate(progress, [0, 1], [-8, -2])}deg) rotateX(${interpolate(progress, [0, 1], [3, -1])}deg) scale(${1 + bp * 0.012})`,
                  position: 'relative',
                  background: PALETTE.surface,
                }}
              >
                {primary ? (
                  <MediaTile media={primary} progress={progress} fitMode="contain" />
                ) : (
                  <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', fontFamily: SANS, fontSize: 40, fontWeight: 800, color: PALETTE.accent2 }}>
                    {sceneTag}
                  </AbsoluteFill>
                )}
                {/* Specular Sweep Light */}
                <div
                  style={{
                    position: 'absolute',
                    top: -60,
                    bottom: -60,
                    width: 220,
                    left: sweepX,
                    transform: 'skewX(-22deg)',
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.16), transparent)',
                    pointerEvents: 'none',
                  }}
                />
              </div>

              {secondary ? (
                <div
                  style={{
                    position: 'absolute',
                    right: -28,
                    bottom: -24,
                    width: 290,
                    height: 175,
                    borderRadius: 16,
                    overflow: 'hidden',
                    border: `2px solid ${PALETTE.gold || PALETTE.accent}`,
                    boxShadow: '0 20px 44px rgba(0,0,0,0.75)',
                    transform: `translateY(${interpolate(localFrame, [0, 18], [40, 0], { extrapolateRight: 'clamp', easing: easeOut })}px)`,
                  }}
                >
                  <MediaTile media={secondary} progress={progress} />
                </div>
              ) : null}
            </div>
          </AbsoluteFill>
        ) : null}

        {/* LAYOUT 3: kinetic-impact */}
        {layout === 'kinetic-impact' ? (
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '0 130px 60px' }}>
            {/* Framing Light Rails */}
            <div
              style={{
                position: 'absolute',
                top: 90,
                left: 110,
                right: 110,
                height: 2,
                background: `linear-gradient(90deg, transparent, ${PALETTE.accent}, transparent)`,
                opacity: 0.55,
              }}
            />
            <div
              style={{
                position: 'absolute',
                bottom: 155,
                left: 110,
                right: 110,
                height: 2,
                background: `linear-gradient(90deg, transparent, ${PALETTE.accent2 || PALETTE.accent}, transparent)`,
                opacity: 0.45,
              }}
            />
            <div
              style={{
                padding: '7px 20px',
                borderRadius: 999,
                background: `rgba(${PALETTE.rgbGold || '245,185,46'}, 0.16)`,
                border: `1px solid ${PALETTE.gold || PALETTE.accent2}`,
                color: PALETTE.gold || PALETTE.accent2,
                fontFamily: MONO,
                fontSize: 18,
                fontWeight: 700,
                marginBottom: 24,
              }}
            >
              CHAPTER {String(idx + 1).padStart(2, '0')} · {sceneTag}
            </div>
            <KineticHeadline lines={titleLines} localFrame={localFrame} fps={fps} fontSize={88} align="center" rgbSplit={rgbSplit} />
            <HighlightsRow highlights={highlights} localFrame={localFrame} fps={fps} align="center" />
          </AbsoluteFill>
        ) : null}

        {/* LAYOUT 4: mosaic-pulse-wall */}
        {layout === 'mosaic-pulse-wall' ? (
          <AbsoluteFill style={{ padding: '74px 96px 124px', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 36 }}>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    color: PALETTE.accent2 || PALETTE.accent,
                    fontFamily: MONO,
                    fontSize: 18,
                    fontWeight: 700,
                    marginBottom: 10,
                  }}
                >
                  {String(idx + 1).padStart(2, '0')} / {String(total).padStart(2, '0')} · {sceneTag}
                </div>
                <KineticHeadline lines={titleLines} localFrame={localFrame} fps={fps} fontSize={58} align="left" rgbSplit={rgbSplit} />
              </div>
              <div
                style={{
                  padding: '14px 28px',
                  borderRadius: 18,
                  background: 'rgba(15, 23, 42, 0.85)',
                  border: `1.5px solid ${PALETTE.gold || PALETTE.accent}`,
                  boxShadow: `0 16px 40px rgba(0,0,0,0.5)`,
                  textAlign: 'right',
                }}
              >
                <div style={{ fontFamily: SANS, fontSize: 16, color: PALETTE.textSecondary, fontWeight: 700 }}>
                  {highlights[0] || sceneTag}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 54, fontWeight: 900, color: PALETTE.gold || PALETTE.accent, lineHeight: 1.1 }}>
                  {counterDisplay}%
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gridTemplateRows: 'repeat(2, 1fr)',
                gap: 20,
                height: 550,
                perspective: 1100,
              }}
            >
              {Array.from({ length: 6 }, (_, mi) => {
                const tileSp = spring({
                  frame: Math.max(0, localFrame - 3 - mi * 3),
                  fps,
                  config: { damping: 15, stiffness: 170 },
                });
                const m = poolList.length > 0 ? poolList[mi % poolList.length] : null;
                const activeBeatScale = mi % 2 === Math.floor(absTimeSec * 2) % 2 ? bp * 0.03 : 0;
                return (
                  <div
                    key={mi}
                    style={{
                      borderRadius: 18,
                      overflow: 'hidden',
                      position: 'relative',
                      background: PALETTE.surface,
                      border: `1.5px solid rgba(${PALETTE.rgbAccent || '125,178,255'}, ${0.35 + bp * 0.3})`,
                      boxShadow: '0 20px 44px rgba(0,0,0,0.58)',
                      opacity: interpolate(tileSp, [0, 1], [0, 1]),
                      transform: `scale(${interpolate(tileSp, [0, 1], [0.82, 1]) + activeBeatScale}) translateY(${interpolate(tileSp, [0, 1], [28, 0])}px)`,
                    }}
                  >
                    {m ? (
                      <MediaTile media={m} progress={progress} />
                    ) : (
                      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', fontFamily: SANS, fontSize: 28, fontWeight: 800, color: PALETTE.textPrimary }}>
                        {highlights[mi % Math.max(1, highlights.length)] || sceneTag}
                      </AbsoluteFill>
                    )}
                    <div
                      style={{
                        position: 'absolute',
                        left: 14,
                        bottom: 12,
                        padding: '4px 12px',
                        borderRadius: 999,
                        background: 'rgba(6,10,20,0.78)',
                        color: '#F8FAFC',
                        fontFamily: MONO,
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      0{mi + 1} · {highlights[mi % Math.max(1, highlights.length)] || sceneTag}
                    </div>
                  </div>
                );
              })}
            </div>
          </AbsoluteFill>
        ) : null}

        {/* LAYOUT 5: compare-dual */}
        {layout === 'compare-dual' ? (
          <AbsoluteFill style={{ padding: '86px 104px 132px', justifyContent: 'space-between' }}>
            <div style={{ textAlign: 'center' }}>
              <KineticHeadline lines={titleLines} localFrame={localFrame} fps={fps} fontSize={58} align="center" rgbSplit={rgbSplit} />
            </div>

            <div style={{ display: 'flex', alignItems: 'stretch', gap: 40, height: 530, position: 'relative' }}>
              {[
                { data: scene.compareLeft, fallbackLabel: highlights[0] || '智能策划', media: primary, side: -1 },
                { data: scene.compareRight, fallbackLabel: highlights[1] || '成片输出', media: secondary || primary, side: 1 },
              ].map((panel, pi) => {
                const sp = spring({
                  frame: Math.max(0, localFrame - 4 - pi * 4),
                  fps,
                  config: { damping: 16, stiffness: 155 },
                });
                const label = panel.data?.label || panel.fallbackLabel;
                const value = panel.data?.value || highlights[pi] || sceneTag;
                return (
                  <div
                    key={pi}
                    style={{
                      flex: 1,
                      borderRadius: 24,
                      overflow: 'hidden',
                      position: 'relative',
                      background: PALETTE.surface,
                      border: `2px solid ${pi === 1 ? PALETTE.accent : 'rgba(255,255,255,0.2)'}`,
                      boxShadow: '0 28px 64px rgba(0,0,0,0.65)',
                      opacity: interpolate(sp, [0, 1], [0, 1]),
                      transform: `translateX(${interpolate(sp, [0, 1], [panel.side * 90, 0])}px)`,
                    }}
                  >
                    {panel.media ? (
                      <AbsoluteFill style={{ opacity: 0.45 }}>
                        <MediaTile media={panel.media} progress={progress} />
                      </AbsoluteFill>
                    ) : null}
                    <AbsoluteFill
                      style={{
                        background: 'linear-gradient(180deg, rgba(8,12,24,0.35), rgba(8,12,24,0.9))',
                        padding: 42,
                        justifyContent: 'flex-end',
                      }}
                    >
                      <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, color: pi === 1 ? PALETTE.gold || PALETTE.accent2 : PALETTE.accent, marginBottom: 10 }}>
                        {pi === 0 ? 'TRACK A' : 'TRACK B'} · {label}
                      </div>
                      <div style={{ fontFamily: SANS, fontSize: 40, fontWeight: 900, color: '#FFFFFF', lineHeight: 1.25 }}>
                        {value}
                      </div>
                    </AbsoluteFill>
                  </div>
                );
              })}

              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: `translate(-50%, -50%) scale(${1 + bp * 0.08})`,
                  width: 78,
                  height: 78,
                  borderRadius: 999,
                  background: `linear-gradient(135deg, ${PALETTE.accent}, ${PALETTE.gold || PALETTE.accent2})`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: MONO,
                  fontSize: 24,
                  fontWeight: 900,
                  color: '#060A14',
                  boxShadow: `0 0 34px ${PALETTE.accent}`,
                }}
              >
                VS
              </div>
            </div>
          </AbsoluteFill>
        ) : null}

        {/* LAYOUT 6: radial-climax */}
        {layout === 'radial-climax' ? (
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '0 130px 64px' }}>
            <svg
              width="1920"
              height="1080"
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                opacity: 0.42 + bp * 0.25,
                transform: `rotate(${absFrame * 0.28}deg)`,
              }}
            >
              {RADIAL_RAYS.map((ray, ri) => {
                const rInner = 180 + bp * 30;
                const rOuter = rInner + ray.len;
                const x1 = 960 + Math.cos(ray.angle) * rInner;
                const y1 = 520 + Math.sin(ray.angle) * rInner;
                const x2 = 960 + Math.cos(ray.angle) * rOuter;
                const y2 = 520 + Math.sin(ray.angle) * rOuter;
                return (
                  <line
                    key={ri}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={ri % 3 === 0 ? PALETTE.gold || PALETTE.accent2 : PALETTE.accent}
                    strokeWidth={ray.width}
                    strokeLinecap="round"
                  />
                );
              })}
            </svg>

            <div
              style={{
                padding: '9px 24px',
                borderRadius: 999,
                background: `linear-gradient(90deg, ${PALETTE.accent}, ${PALETTE.gold || PALETTE.accent2})`,
                color: '#050814',
                fontFamily: MONO,
                fontSize: 18,
                fontWeight: 900,
                letterSpacing: 3,
                marginBottom: 24,
                transform: `scale(${interpolate(spring({ frame: Math.max(0, localFrame - 2), fps, config: { damping: 11, stiffness: 220 } }), [0, 1], [1.7, 1])})`,
              }}
            >
              FINALE · {sceneTag}
            </div>

            <KineticHeadline lines={titleLines} localFrame={localFrame} fps={fps} fontSize={86} align="center" rgbSplit={rgbSplit} />

            <div
              style={{
                width: interpolate(localFrame, [8, 26], [0, 560], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOut }),
                height: 6,
                borderRadius: 99,
                marginTop: 26,
                background: `linear-gradient(90deg, ${PALETTE.accent}, ${PALETTE.gold || PALETTE.accent2}, ${PALETTE.accent})`,
                boxShadow: `0 0 30px ${PALETTE.accent}`,
              }}
            />

            <HighlightsRow highlights={highlights} localFrame={localFrame} fps={fps} align="center" />
          </AbsoluteFill>
        ) : null}

        {/* LAYOUT 7: card-fan-opener */}
        {layout === 'card-fan-opener' ? (() => {
          const fanList = (Array.isArray(scene.fanMedia) && scene.fanMedia.length > 0 ? scene.fanMedia : poolList).slice(0, 7);
          const brandLogo = scene.brandMark || (scriptData as any)?.brandMark || '';
          const cleanLogo = brandLogo ? String(brandLogo).replace(/^\.?[\\/]+/, '').replace(/\\/g, '/') : '';
          return (
            <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: isPortrait ? '90px 48px 250px' : '74px 96px 154px' }}>
              <div style={{ position: 'relative', width: '100%', height: isPortrait ? 430 : 450, display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: 24 }}>
                {fanList.map((fm: any, fi: number) => {
                  const mid = (fanList.length - 1) / 2;
                  const rel = fi - mid;
                  const fanSp = spring({ frame: Math.max(0, localFrame - fi * 2.5), fps, config: { damping: 14, stiffness: 135 } });
                  const angle = rel * (isPortrait ? 7.5 : 9.2);
                  const tx = rel * (isPortrait ? 74 : 138);
                  const ty = Math.abs(rel) * (isPortrait ? 14 : 20);
                  const pathStr = typeof fm === 'string' ? fm : fm?.path || '';
                  const cleanRel = String(pathStr).replace(/^\.?[\\/]+/, '').replace(/\\/g, '/');
                  return (
                    <div
                      key={fi}
                      style={{
                        position: 'absolute',
                        width: isPortrait ? 190 : 238,
                        height: isPortrait ? 275 : 340,
                        borderRadius: 18,
                        overflow: 'hidden',
                        background: '#0A1615',
                        border: `2px solid ${Math.abs(rel) < 0.6 ? (PALETTE.gold || PALETTE.accent2) : PALETTE.accent}88`,
                        boxShadow: `0 24px 54px rgba(0,0,0,0.72)`,
                        zIndex: 20 - Math.round(Math.abs(rel) * 3),
                        opacity: interpolate(fanSp, [0, 1], [0, 1]),
                        transform: `translate(${(tx * fanSp).toFixed(1)}px, ${(ty + (1 - fanSp) * 60).toFixed(1)}px) rotate(${(angle * fanSp).toFixed(2)}deg) scale(${(1 - Math.abs(rel) * 0.05) * interpolate(fanSp, [0, 1], [0.85, 1])})`,
                      }}
                    >
                      {cleanRel ? <Img src={staticFile(cleanRel)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, padding: '8px 20px', borderRadius: 999, background: 'rgba(6, 14, 14, 0.86)', border: `1px solid ${PALETTE.accent}66` }}>
                {cleanLogo ? <Img src={staticFile(cleanLogo)} style={{ width: 26, height: 26, borderRadius: 6, objectFit: 'cover' }} /> : null}
                <span style={{ fontFamily: MONO, fontSize: 17, fontWeight: 800, color: PALETTE.accent, letterSpacing: 2 }}>
                  {scene.kicker || sceneTag}
                </span>
              </div>
              <KineticHeadline lines={titleLines} localFrame={localFrame} fps={fps} fontSize={isPortrait ? 52 : 70} align="center" rgbSplit={rgbSplit} />
              <HighlightsRow highlights={highlights} localFrame={localFrame} fps={fps} align="center" />
            </AbsoluteFill>
          );
        })() : null}

        {/* LAYOUT 8: app-focus-shot */}
        {layout === 'app-focus-shot' ? (() => {
          const splitMode = scene.windowLayout === 'split' && !isPortrait;
          const brandLogo = scene.brandMark || (scriptData as any)?.brandMark || '';
          const loupe = scene.loupe || null;
          return (
            <AbsoluteFill style={{ padding: isPortrait ? '100px 36px 250px' : '74px 68px 158px', display: 'flex', flexDirection: splitMode ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: splitMode ? 42 : 16 }}>
              {splitMode ? (
                <div style={{ flex: '0 0 34%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <div style={{ padding: '6px 14px', borderRadius: 999, background: `rgba(${PALETTE.rgbAccent || '69,209,178'}, 0.16)`, border: `1px solid ${PALETTE.accent}`, color: PALETTE.accent, fontFamily: MONO, fontSize: 15, fontWeight: 700, marginBottom: 14 }}>
                    {scene.kicker || sceneTag}
                  </div>
                  <KineticHeadline lines={titleLines} localFrame={localFrame} fps={fps} fontSize={48} align="left" rgbSplit={rgbSplit} />
                  <HighlightsRow highlights={highlights} localFrame={localFrame} fps={fps} align="left" />
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: isPortrait ? '100%' : '86%', maxWidth: 1420 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span style={{ padding: '5px 14px', borderRadius: 999, background: `rgba(${PALETTE.rgbAccent || '69,209,178'}, 0.16)`, border: `1px solid ${PALETTE.accent}88`, color: PALETTE.accent, fontFamily: MONO, fontSize: 15, fontWeight: 800 }}>
                      {scene.kicker || sceneTag}
                    </span>
                    <span style={{ fontFamily: SANS, fontSize: isPortrait ? 26 : 32, fontWeight: 900, color: PALETTE.textPrimary }}>
                      {scene.title}
                    </span>
                  </div>
                  {highlights.length ? (
                    <span style={{ fontFamily: SANS, fontSize: 18, fontWeight: 700, color: PALETTE.gold || PALETTE.accent2 }}>
                      {highlights.join(' · ')}
                    </span>
                  ) : null}
                </div>
              )}

              <div style={{ flex: 1, width: isPortrait ? '100%' : splitMode ? '64%' : '86%', maxWidth: splitMode ? 1140 : 1420, height: isPortrait ? 640 : 730, position: 'relative' }}>
                <AppWindow
                  title={scene.windowTitle || scene.title}
                  kicker={scene.windowBadge || scene.kicker || sceneTag}
                  brandMark={brandLogo}
                  accentColor={PALETTE.accent}
                  goldColor={PALETTE.gold || PALETTE.accent2}
                  theme={scene.windowTheme === 'light' ? 'light' : 'dark'}
                  style={{ width: '100%', height: '100%' }}
                >
                  {primary ? (
                    <FocusShot
                      src={primary.path}
                      cams={scene.cams}
                      marks={scene.marks}
                      mediaWidth={Number(primary.width || 0)}
                      mediaHeight={Number(primary.height || 0)}
                      accentColor={PALETTE.accent}
                      goldColor={PALETTE.gold || PALETTE.accent2}
                    />
                  ) : null}
                </AppWindow>

                {loupe && primary ? (
                  <div
                    style={{
                      position: 'absolute',
                      right: loupe.side === 'left' ? 'auto' : 22,
                      left: loupe.side === 'left' ? 22 : 'auto',
                      bottom: 22,
                      width: isPortrait ? 180 : 230,
                      height: isPortrait ? 180 : 230,
                      borderRadius: 999,
                      overflow: 'hidden',
                      border: `3.5px solid ${PALETTE.gold || PALETTE.accent}`,
                      boxShadow: `0 20px 50px rgba(0,0,0,0.75), 0 0 28px ${PALETTE.accent}66`,
                      background: '#071110',
                      zIndex: 25,
                    }}
                  >
                    <FocusShot
                      src={primary.path}
                      cams={[{ t: 0, fx: Number(loupe.fx ?? 0.5), fy: Number(loupe.fy ?? 0.5), z: Number(loupe.z ?? 2.6) }, { t: 1, fx: Number(loupe.fx ?? 0.5), fy: Number(loupe.fy ?? 0.5), z: Number(loupe.z ?? 2.8) }]}
                      marks={[]}
                      accentColor={PALETTE.accent}
                      goldColor={PALETTE.gold || PALETTE.accent2}
                    />
                    {loupe.label ? (
                      <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', padding: '3px 10px', borderRadius: 999, background: 'rgba(6,14,14,0.9)', border: `1px solid ${PALETTE.gold || PALETTE.accent}`, color: '#FFF', fontFamily: SANS, fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>
                        {loupe.label}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </AbsoluteFill>
          );
        })() : null}

        {/* LAYOUT 9: workflow-steps */}
        {layout === 'workflow-steps' ? (() => {
          const steps = Array.isArray(scene.steps) && scene.steps.length > 0
            ? scene.steps
            : (highlights.length ? highlights : ['导入素材', 'AI 编排', '渲染出片']).map((t: string, si: number) => ({
                num: `0${si + 1}`,
                title: t,
                desc: `Step ${si + 1}`,
                img: poolList[si % Math.max(1, poolList.length)]?.path || '',
              }));
          const sweepStep = Math.min(steps.length - 1, Math.floor(progress * steps.length));
          return (
            <AbsoluteFill style={{ padding: isPortrait ? '100px 44px 250px' : '82px 76px 160px', justifyContent: 'space-between' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700, color: PALETTE.accent, marginBottom: 8 }}>
                  {scene.kicker || sceneTag}
                </div>
                <KineticHeadline lines={titleLines} localFrame={localFrame} fps={fps} fontSize={isPortrait ? 46 : 56} align="center" rgbSplit={rgbSplit} />
              </div>

              <div style={{ display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: 20, flex: 1, marginTop: 26, alignItems: 'stretch' }}>
                {steps.slice(0, 5).map((st: any, si: number) => {
                  const sp = spring({ frame: Math.max(0, localFrame - si * 4), fps, config: { damping: 14, stiffness: 160 } });
                  const isAct = si === sweepStep;
                  const cleanImg = st.img ? String(st.img).replace(/^\.?[\\/]+/, '').replace(/\\/g, '/') : '';
                  return (
                    <div
                      key={si}
                      style={{
                        flex: 1,
                        borderRadius: 20,
                        overflow: 'hidden',
                        background: isAct ? 'rgba(13, 30, 28, 0.96)' : 'rgba(9, 19, 18, 0.86)',
                        border: `2px solid ${isAct ? (PALETTE.gold || PALETTE.accent2) : 'rgba(255,255,255,0.12)'}`,
                        boxShadow: isAct ? `0 20px 54px rgba(0,0,0,0.65), 0 0 28px ${PALETTE.accent}33` : '0 14px 36px rgba(0,0,0,0.45)',
                        display: 'flex',
                        flexDirection: 'column',
                        opacity: interpolate(sp, [0, 1], [0, 1]),
                        transform: `translateY(${interpolate(sp, [0, 1], [36, 0])}px) scale(${isAct ? 1.03 : 1})`,
                      }}
                    >
                      <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: MONO, fontSize: 18, fontWeight: 900, color: isAct ? (PALETTE.gold || PALETTE.accent2) : PALETTE.accent }}>
                          {st.num || `0${si + 1}`}
                        </span>
                        <span style={{ width: 10, height: 10, borderRadius: 99, background: isAct ? PALETTE.accent : 'rgba(255,255,255,0.18)' }} />
                      </div>
                      <div style={{ flex: 1, position: 'relative', background: '#071110', minHeight: 160 }}>
                        {cleanImg ? <Img src={staticFile(cleanImg)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : null}
                      </div>
                      <div style={{ padding: '14px 18px' }}>
                        <div style={{ fontFamily: SANS, fontSize: 22, fontWeight: 800, color: '#F8FAFC', marginBottom: 4 }}>{st.title}</div>
                        {st.desc ? <div style={{ fontFamily: SANS, fontSize: 15, color: PALETTE.textSecondary }}>{st.desc}</div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </AbsoluteFill>
          );
        })() : null}

        {/* LAYOUT 10: split-wipe-compare */}
        {layout === 'split-wipe-compare' ? (() => {
          const brandLogo = scene.brandMark || (scriptData as any)?.brandMark || '';
          return (
            <AbsoluteFill style={{ padding: isPortrait ? '100px 36px 250px' : '74px 68px 158px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: isPortrait ? '100%' : '86%', maxWidth: 1420 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ padding: '5px 14px', borderRadius: 999, background: `rgba(${PALETTE.rgbGold || '246,186,111'}, 0.16)`, border: `1px solid ${PALETTE.gold || PALETTE.accent2}`, color: PALETTE.gold || PALETTE.accent2, fontFamily: MONO, fontSize: 15, fontWeight: 800 }}>
                    {scene.kicker || 'A / B COMPARE'}
                  </span>
                  <span style={{ fontFamily: SANS, fontSize: isPortrait ? 26 : 32, fontWeight: 900, color: PALETTE.textPrimary }}>{scene.title}</span>
                </div>
                {highlights.length ? <span style={{ fontFamily: SANS, fontSize: 18, fontWeight: 700, color: PALETTE.accent }}>{highlights.join(' · ')}</span> : null}
              </div>

              <div style={{ flex: 1, width: isPortrait ? '100%' : '86%', maxWidth: 1420, height: isPortrait ? 640 : 730 }}>
                <AppWindow title={scene.windowTitle || scene.title} kicker={scene.kicker || 'WIPE'} brandMark={brandLogo} accentColor={PALETTE.accent} goldColor={PALETTE.gold || PALETTE.accent2} style={{ width: '100%', height: '100%' }}>
                  <BeforeAfterWipe
                    beforeSrc={primary?.path || ''}
                    afterSrc={secondary?.path || primary?.path || ''}
                    beforeLabel={scene.compareLeft?.label || highlights[0] || 'STYLE A'}
                    afterLabel={scene.compareRight?.label || highlights[1] || 'STYLE B'}
                    accentColor={PALETTE.accent}
                    goldColor={PALETTE.gold || PALETTE.accent2}
                  />
                </AppWindow>
              </div>
            </AbsoluteFill>
          );
        })() : null}

        {/* LAYOUT 11: metric-dashboard */}
        {layout === 'metric-dashboard' ? (() => {
          const brandLogo = scene.brandMark || (scriptData as any)?.brandMark || '';
          const m = Array.isArray(scene.metrics) && scene.metrics[0] ? scene.metrics[0] : { label: highlights[0] || '并发效率', value: Number(scene.counterTarget) || 100, suffix: '%' };
          return (
            <AbsoluteFill style={{ padding: isPortrait ? '100px 44px 250px' : '82px 76px 160px', display: 'flex', flexDirection: isPortrait ? 'column' : 'row', alignItems: 'center', gap: 34 }}>
              <div style={{ flex: isPortrait ? '0 0 auto' : '0 0 39%', width: isPortrait ? '100%' : 'auto', display: 'flex', flexDirection: 'column', gap: 22 }}>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 800, color: PALETTE.accent, marginBottom: 8 }}>{scene.kicker || sceneTag}</div>
                  <KineticHeadline lines={titleLines} localFrame={localFrame} fps={fps} fontSize={isPortrait ? 42 : 52} align="left" rgbSplit={rgbSplit} />
                </div>
                <MetricPanel
                  label={m.label || scene.title}
                  value={Number(m.value) || Number(scene.counterTarget) || 100}
                  suffix={m.suffix || '+'}
                  subLabel={highlights[1] || 'REALTIME'}
                  gridCount={20}
                  accentColor={PALETTE.accent}
                  goldColor={PALETTE.gold || PALETTE.accent2}
                />
              </div>

              <div style={{ flex: 1, width: isPortrait ? '100%' : 'auto', height: isPortrait ? 450 : 690 }}>
                <AppWindow title={scene.windowTitle || scene.title} kicker={scene.windowBadge || 'ENGINE'} brandMark={brandLogo} accentColor={PALETTE.accent} goldColor={PALETTE.gold || PALETTE.accent2} style={{ width: '100%', height: '100%' }}>
                  {primary ? <FocusShot src={primary.path} cams={scene.cams} marks={scene.marks} mediaWidth={Number(primary.width || 0)} mediaHeight={Number(primary.height || 0)} accentColor={PALETTE.accent} goldColor={PALETTE.gold || PALETTE.accent2} /> : null}
                </AppWindow>
              </div>
            </AbsoluteFill>
          );
        })() : null}

        {/* LAYOUT 12: multi-window-trio */}
        {layout === 'multi-window-trio' ? (() => {
          const cards = poolList.slice(0, 3);
          const labels = Array.isArray(scene.trioLabels) && scene.trioLabels.length ? scene.trioLabels : highlights;
          const activeWin = Math.min(Math.max(0, cards.length - 1), Math.floor(progress * Math.max(1, cards.length)));
          return (
            <AbsoluteFill style={{ padding: isPortrait ? '100px 36px 250px' : '78px 64px 160px', justifyContent: 'space-between' }}>
              <div style={{ textAlign: 'center' }}>
                <KineticHeadline lines={titleLines} localFrame={localFrame} fps={fps} fontSize={isPortrait ? 46 : 56} align="center" rgbSplit={rgbSplit} />
              </div>
              <div style={{ display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: 22, flex: 1, marginTop: 24, alignItems: 'center' }}>
                {cards.map((m: any, wi: number) => {
                  const isAct = wi === activeWin;
                  const cleanRel = String(m?.path || '').replace(/^\.?[\\/]+/, '').replace(/\\/g, '/');
                  return (
                    <div
                      key={wi}
                      style={{
                        flex: 1,
                        width: isPortrait ? '100%' : 'auto',
                        height: isPortrait ? 200 : isAct ? 640 : 580,
                        transform: `scale(${isAct ? 1.03 : 0.96})`,
                        opacity: isAct ? 1 : 0.84,
                      }}
                    >
                      <AppWindow
                        title={labels[wi] || `VIEW 0${wi + 1}`}
                        kicker={isAct ? 'ACTIVE' : ''}
                        accentColor={isAct ? (PALETTE.gold || PALETTE.accent) : PALETTE.accent}
                        goldColor={PALETTE.gold || PALETTE.accent2}
                        theme={String(labels[wi] || '').includes('明') || String(labels[wi] || '').toLowerCase().includes('light') ? 'light' : 'dark'}
                        style={{ width: '100%', height: '100%' }}
                      >
                        {cleanRel ? <Img src={staticFile(cleanRel)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : null}
                      </AppWindow>
                    </div>
                  );
                })}
              </div>
            </AbsoluteFill>
          );
        })() : null}

        {/* Minimal Broadcast Corner L-Brackets */}
        <AbsoluteFill style={{ pointerEvents: 'none', opacity: 0.42 }}>
          <div style={{ position: 'absolute', top: 34, left: 40, width: 22, height: 22, borderTop: `2px solid ${PALETTE.accent2 || PALETTE.accent}`, borderLeft: `2px solid ${PALETTE.accent2 || PALETTE.accent}` }} />
          <div style={{ position: 'absolute', top: 34, right: 40, width: 22, height: 22, borderTop: `2px solid ${PALETTE.accent2 || PALETTE.accent}`, borderRight: `2px solid ${PALETTE.accent2 || PALETTE.accent}` }} />
          <div style={{ position: 'absolute', bottom: 34, left: 40, width: 22, height: 22, borderBottom: `2px solid ${PALETTE.accent2 || PALETTE.accent}`, borderLeft: `2px solid ${PALETTE.accent2 || PALETTE.accent}` }} />
          <div style={{ position: 'absolute', bottom: 34, right: 40, width: 22, height: 22, borderBottom: `2px solid ${PALETTE.accent2 || PALETTE.accent}`, borderRight: `2px solid ${PALETTE.accent2 || PALETTE.accent}` }} />
        </AbsoluteFill>
      </AbsoluteFill>

      {/* Scene Cut Transition Layer */}
      <SceneTransitionOverlay
        txKind={txKind}
        localFrame={localFrame}
        dur={dur}
        accentColor={PALETTE.accent}
        goldColor={PALETTE.gold || PALETTE.accent2}
        bgColor={PALETTE.background}
      />
    </AbsoluteFill>
  );
};

export const VideoComposition: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const isPortrait = width < height;
  const sData: any = scriptData;
  const scenes: any[] = Array.isArray(sData.scenes) ? sData.scenes : [];
  const subtitles: any[] = Array.isArray(sData.subtitles) ? sData.subtitles : [];
  const beats: number[] = Array.isArray(sData.bgm?.beats) ? sData.bgm.beats : [];
  const pct = (frame / Math.max(1, durationInFrames - 1)) * 100;

  const activeScene = scenes.find((sc) => {
    const sf = Number(sc.startFrame || 0);
    const ef = sf + Math.max(8, Number(sc.durationInFrames) || 90);
    return frame >= sf && frame < ef;
  });

  const activeSub =
    subtitles.find((sub) => {
      const sf = Number(sub.globalStartFrame ?? sub.startFrame ?? Math.round((sub.globalStartSec ?? sub.startSec ?? 0) * fps));
      const ef = Number(sub.globalEndFrame ?? sub.endFrame ?? Math.round((sub.globalEndSec ?? sub.endSec ?? 0) * fps));
      return frame >= sf && frame <= ef;
    }) ||
    (Array.isArray(activeScene?.subtitles)
      ? activeScene.subtitles.find((sub: any) => {
          const base = Number(activeScene.startFrame || 0);
          const sf = base + Number(sub.startFrame ?? Math.round((sub.startSec || 0) * fps));
          const ef = base + Number(sub.endFrame ?? Math.round((sub.endSec || 0) * fps));
          return frame >= sf && frame <= ef;
        })
      : undefined);

  const subText = activeSub?.text || (Array.isArray(activeScene?.subtitles) && activeScene.subtitles[0]?.text) || activeScene?.subtitleLine || '';
  const isCinematicSub = sData.subtitleStyle === 'cinematic' || activeScene?.layout === 'narrative-diorama';
  const accentWords: string[] = Array.isArray(activeScene?.accentWords) ? activeScene.accentWords : [];
  const activeAvatar = activeScene?.avatarClip?.path ? activeScene.avatarClip : (sData?.avatarClip?.path ? sData.avatarClip : null);
  const avatarLayout = activeScene?.avatarLayout || activeAvatar?.layout || sData?.avatarLayout || 'pip-br';

  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.background }}>
      {scenes.map((scene, idx) => (
        <Sequence
          key={scene.id || idx}
          from={Number(scene.startFrame) || 0}
          durationInFrames={Math.max(8, Number(scene.durationInFrames) || 90)}
        >
          <SceneStage scene={scene} idx={idx} total={scenes.length} beats={beats} />
        </Sequence>
      ))}

      {activeAvatar?.path && avatarLayout !== 'off' ? (
        <AvatarOverlay
          clipPath={activeAvatar.path}
          layout={avatarLayout}
          accentColor={PALETTE.accent}
          muted={true}
        />
      ) : null}

      <AIBadge
        visible={true}
        text={typeof sData.aiBadge === 'string' && sData.aiBadge.trim() ? sData.aiBadge : DEFAULT_BADGE_TEXT}
        accentColor={PALETTE.accent}
      />

      {Array.isArray(sData.workflowSteps) && sData.workflowSteps.length > 0 ? (
        <WorkflowBar
          steps={sData.workflowSteps}
          activeStep={Number(activeScene?.hudStep ?? -1)}
          sectionLabel={activeScene ? `${String(scenes.indexOf(activeScene) + 1).padStart(2, '0')} / ${String(scenes.length).padStart(2, '0')}` : ''}
          accentColor={PALETTE.accent}
          goldColor={PALETTE.gold || PALETTE.accent2}
        />
      ) : null}

      {/* Clean Single-Line Broadcast Subtitles (Platform Safe-Zone Aligned) */}
      {subText ? (
        <AbsoluteFill
          style={{
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingBottom: Number(sData.subtitleBottomPx) || DEFAULT_SUBTITLE_BOTTOM || (isPortrait ? 240 : 110),
            pointerEvents: 'none',
            zIndex: 40,
          }}
        >
          <div
            style={
              isCinematicSub
                ? {
                    padding: '6px 26px',
                    fontFamily: FONT_SERIF,
                    fontSize: isPortrait ? 34 : 38,
                    fontWeight: 900,
                    letterSpacing: '0.03em',
                    color: '#FDF6E7',
                    maxWidth: Math.round(width * 0.88),
                    whiteSpace: isPortrait ? 'normal' : 'nowrap',
                    textAlign: 'center',
                    textShadow: '0 3px 10px rgba(0,0,0,0.98), 0 0 6px rgba(0,0,0,0.98), 0 6px 22px rgba(0,0,0,0.9)',
                  }
                : {
                    padding: isPortrait ? '10px 22px' : '10px 30px',
                    borderRadius: 12,
                    background: 'rgba(5, 8, 18, 0.84)',
                    border: `1px solid rgba(${PALETTE.rgbAccent || '125,178,255'}, 0.36)`,
                    borderLeft: `4px solid ${PALETTE.accent}`,
                    fontFamily: SANS,
                    fontSize: isPortrait ? 28 : 32,
                    fontWeight: 700,
                    color: '#FFFFFF',
                    maxWidth: Math.round(width * 0.88),
                    whiteSpace: isPortrait ? 'normal' : 'nowrap',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textShadow: '0 2px 10px rgba(0,0,0,0.9)',
                  }
            }
          >
            {renderSubtitleSegments(subText, accentWords)}
          </div>
        </AbsoluteFill>
      ) : null}

      {/* Minimal Bottom Hairline Progress */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 4,
          background: 'rgba(255,255,255,0.06)',
          pointerEvents: 'none',
          zIndex: 50,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${PALETTE.accent}, ${PALETTE.gold || PALETTE.accent2})`,
          }}
        />
      </div>

      <EndNotice
        text={DEFAULT_END_NOTICE}
        accentColor={PALETTE.accent}
      />

      <Audio src={staticFile('master-audio.wav')} />
    </AbsoluteFill>
  );
};
