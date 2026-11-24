/**
 * Remotion 4.x TSX Kinetic Motion Video Generator
 * Strictly frame-driven (`useCurrentFrame`, `interpolate`, `spring`) with ZERO CSS transitions or `@keyframes`.
 * Parity with the HTML5+Canvas2D .motion engine:
 * - Global camera rig: beat-locked zoomPulse + cut impact camera shake + depth perspective
 * - All 6 layouts: 3d-stage-opener, kinetic-impact, media-split-motion, mosaic-pulse-wall, compare-dual, radial-climax
 * - SVG shockwave rings, radial speedlines, specular light sweep, procedural iris/block/glitch transitions
 * - Chromatic RGB character slam reveals, animated counter ticker, stamp seal, clean single-line subtitles
 */
import { copyFileSync, existsSync, linkSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import {
  buildComplianceNoticeText,
  resolveSafeZoneSpec,
  syncProjectFonts,
} from '../shared/index.js'
import { resolvePalette } from './html-generator.js'
import { readAssets } from './asset-manager.js'
import { writeFigureKitRemotionLib } from './figure-kit.js'
import { isEpicCombatContext } from './genre-router.js'
import { writeNarrativeDioramaRemotionLib } from './narrative-diorama.js'
import { writeShotcraftRemotionLib } from './shotcraft-lib.js'
import { buildMediaDimsMap } from './vision-grounding.js'

function syncFileToPublic(absSrc, absDest) {
  if (!existsSync(absSrc)) return
  mkdirSync(dirname(absDest), { recursive: true })
  try {
    if (existsSync(absDest)) return
    linkSync(absSrc, absDest)
  } catch {
    copyFileSync(absSrc, absDest)
  }
}

export function syncRemotionPublicAssets(projectDir, script) {
  const absDir = resolve(projectDir)
  const pubDir = join(absDir, 'public')
  mkdirSync(pubDir, { recursive: true })

  for (const scene of script?.scenes || []) {
    const mediaList = Array.isArray(scene.media)
      ? scene.media
      : scene.mediaPath
        ? [{ path: scene.mediaPath }]
        : []
    const poolList = Array.isArray(scene.poolMedia) ? scene.poolMedia : []
    for (const m of [...mediaList, ...poolList]) {
      if (!m?.path) continue
      const src = isAbsolute(m.path) ? m.path : resolve(absDir, m.path)
      const rel = m.path.replace(/^\/+/, '').replace(/\\/g, '/')
      syncFileToPublic(src, join(pubDir, rel))
    }
    const extraRelPaths = [
      scene.brandMark,
      scene.avatarClip?.path,
      ...(Array.isArray(scene.cards) ? scene.cards.map((c) => c?.image || c?.path) : []),
      ...(Array.isArray(scene.steps) ? scene.steps.map((st) => st?.image || st?.path) : []),
      ...(Array.isArray(scene.windows) ? scene.windows.map((w) => w?.image || w?.path) : []),
    ]
    for (const extra of extraRelPaths) {
      if (!extra || typeof extra !== 'string') continue
      const srcEx = isAbsolute(extra) ? extra : resolve(absDir, extra)
      const relEx = extra.replace(/^\/+/, '').replace(/\\/g, '/')
      syncFileToPublic(srcEx, join(pubDir, relEx))
    }
  }
  for (const globalAsset of [script?.avatarClip?.path, script?.brandMark]) {
    if (!globalAsset || typeof globalAsset !== 'string') continue
    const srcGl = isAbsolute(globalAsset) ? globalAsset : resolve(absDir, globalAsset)
    const relGl = globalAsset.replace(/^\/+/, '').replace(/\\/g, '/')
    syncFileToPublic(srcGl, join(pubDir, relGl))
  }
  const masterWav = join(absDir, 'output', 'master-audio.wav')
  if (existsSync(masterWav)) {
    const dest = join(pubDir, 'master-audio.wav')
    try {
      copyFileSync(masterWav, dest)
    } catch {}
  }
  syncProjectFonts(absDir)
  return pubDir
}

export function writeRemotionProjectFiles(projectDir, script, { rebuildTemplate = true, useCustomSceneRegistry } = {}) {
  const absDir = resolve(projectDir)
  const srcDir = join(absDir, 'src')
  mkdirSync(srcDir, { recursive: true })
  syncRemotionPublicAssets(absDir, script)
  writeShotcraftRemotionLib(absDir)
  writeNarrativeDioramaRemotionLib(absDir)
  writeFigureKitRemotionLib(absDir)
  // battle-epic treatment (slash wipes only, diorama fallback) for history films and history-themed MVs only
  const epicContext = isEpicCombatContext({
    genre: script?.genre || '',
    text: `${script?.genreLabel || ''} ${script?.displayTitle || ''} ${script?.title || ''} ${script?.topic || ''}`,
  })

  const hasCustomRegistry = useCustomSceneRegistry !== undefined
    ? Boolean(useCustomSceneRegistry)
    : (script?.authoringMode === 'ai-coded' && existsSync(join(srcDir, 'scenes', 'index.ts')))

  const theme = resolvePalette(script)
  const safeZone = resolveSafeZoneSpec(script?.width || 1920, script?.height || 1080, script?.targetPlatform || 'universal')
  const complianceNotice = buildComplianceNoticeText(script)
  const hasMasterAudio =
    existsSync(join(absDir, 'public', 'master-audio.wav')) ||
    existsSync(join(absDir, 'output', 'master-audio.wav'))
  const computedMediaDims = buildMediaDimsMap(readAssets(absDir), script)

  writeFileSync(
    join(srcDir, 'index.ts'),
    `import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);
`,
    'utf8',
  )

  writeFileSync(
    join(srcDir, 'Root.tsx'),
    `import React from 'react';
import { Composition, staticFile } from 'remotion';
import scriptData from '../script.json';
import { VideoComposition } from './VideoComposition';

const BUNDLED_FONT_CSS = \`
@font-face {
  font-family: 'Noto Sans SC';
  src: url('\${staticFile('fonts/NotoSansSC-VF.woff2')}') format('woff2');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Source Han Serif SC Heavy';
  src: url('\${staticFile('fonts/SourceHanSerifSC-Heavy.woff2')}') format('woff2');
  font-weight: 900;
  font-style: normal;
  font-display: swap;
}
\`;

export const RemotionRoot: React.FC = () => {
  const sData: any = scriptData;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: BUNDLED_FONT_CSS }} />
      <Composition
        id="MainVideo"
        component={VideoComposition}
        durationInFrames={Math.max(30, Number(sData.totalDurationInFrames) || 300)}
        fps={Number(sData.fps) || 30}
        width={Number(sData.width) || 1920}
        height={Number(sData.height) || 1080}
      />
    </>
  );
};
`,
    'utf8',
  )

  // When an AI LLM has authored custom scene code, preserve VideoComposition.tsx unless explicitly rebuilding draft
  if (script?.authoringMode === 'ai-coded' && rebuildTemplate === false && existsSync(join(srcDir, 'VideoComposition.tsx'))) {
    return
  }

  writeFileSync(
    join(srcDir, 'VideoComposition.tsx'),
    `import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Freeze,
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
import { AIBadge, AppWindow, AvatarOverlay, BeatSpringPhysicsRig, BeforeAfterWipe, buildSmoothSvgPath, computeBeatSpring, describeSvgArc, EndNotice, FocusShot, FreeformThreeStage, HudDataDashboard, HudTelemetryOverlay, MetricPanel, SceneTransitionOverlay, SvgArchitectureDiagram, ThreeCyberStage, THREE_STAGE_PRESETS, WorkflowBar, FONT_SANS, FONT_MONO, FONT_SERIF } from './lib/shotcraft';
import { NarrativeDioramaStage } from './lib/narrative-diorama';
import { scheduleFlashBudget } from './lib/flash-budget';
import { CameraMotionBlur } from '@remotion/motion-blur';
${hasCustomRegistry ? "import { CUSTOM_SCENE_MAP } from './scenes';" : 'const CUSTOM_SCENE_MAP: Record<string, React.ComponentType<any>> = {};'}

const PALETTE: any = ${JSON.stringify(theme)};
const EPIC_CONTEXT: boolean = ${epicContext ? 'true' : 'false'};
const SANS = FONT_SANS;
const MONO = FONT_MONO;
const DEFAULT_SUBTITLE_BOTTOM = ${safeZone.subtitleBottomPx};
const DEFAULT_BADGE_TEXT = ${JSON.stringify(complianceNotice.badgeText)};
const DEFAULT_END_NOTICE = ${JSON.stringify(complianceNotice.endNoticeBody)};
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

// Atmosphere layer (any genre): particles chosen by what the shot shows (scene.atmosphere: dust / embers / snow / rain /
// petals / leaves / bokeh / motes / fireflies / mist / none — planned by the director or inferred from the storyboard).
// Every position, sway and twinkle is a pure function of the absolute frame; no flashes, no full-frame brightness change.
const ATMO_SEEDS = Array.from({ length: 72 }, (_, i) => {
  const s = (i * 7919 + 104729) % 100003;
  return { x0: (s % 997) / 997, y0: ((s * 13) % 991) / 991, r: ((s * 31) % 97) / 97, ph: (i * 0.73) % 6.283, i };
});

const AmbientAtmosphere: React.FC<{ kind: string; absFrame: number; width: number; height: number; bp: number; accent: string; accent2: string }> = ({ kind, absFrame, width, height, bp, accent, accent2 }) => {
  if (!kind || kind === 'none') return null;
  const t = absFrame;
  const u = width / 1920;
  const wrap = (v: number): number => ((v % 1) + 1) % 1;
  const els: React.ReactNode[] = [];
  const count = kind === 'rain' ? 70 : kind === 'snow' ? 56 : kind === 'mist' ? 5 : kind === 'bokeh' ? 20 : kind === 'motes' ? 44 : kind === 'fireflies' ? 26 : kind === 'petals' || kind === 'leaves' ? 26 : 40;
  for (let n = 0; n < count; n++) {
    const p = ATMO_SEEDS[n % ATMO_SEEDS.length];
    const key = 'atmo-' + n;
    if (kind === 'rain') {
      const x = wrap(p.x0 + t * 0.0016) * (width + 200) - 100;
      const y = wrap(p.y0 + t * (0.035 + p.r * 0.02)) * (height + 120) - 60;
      const len = (26 + p.r * 22) * u;
      els.push(<line key={key} x1={x} y1={y} x2={x - len * 0.22} y2={y + len} stroke="#D6E4F0" strokeWidth={Math.max(1, 1.6 * u)} opacity={0.22 + p.r * 0.2} strokeLinecap="round" />);
    } else if (kind === 'snow') {
      const x = wrap(p.x0 + t * 0.0004 + Math.sin(t * 0.03 + p.ph) * 0.006) * width;
      const y = wrap(p.y0 + t * (0.0018 + p.r * 0.0016)) * height;
      els.push(<circle key={key} cx={x} cy={y} r={(2.6 + p.r * 5.5) * u} fill="url(#atmo-soft-white)" opacity={0.55 + p.r * 0.35} />);
    } else if (kind === 'petals' || kind === 'leaves') {
      const x = wrap(p.x0 + t * (0.0011 + p.r * 0.0008) + Math.sin(t * 0.025 + p.ph) * 0.01) * width;
      const y = wrap(p.y0 + t * (0.0016 + p.r * 0.0012)) * height;
      const rot = (t * (1.6 + p.r * 2.4) + p.ph * 57) % 360;
      const c = kind === 'petals' ? (n % 3 === 0 ? '#FBCFE8' : '#F9A8D4') : n % 3 === 0 ? '#B45309' : n % 3 === 1 ? '#D97706' : '#92400E';
      const s2 = (kind === 'petals' ? 5 : 8) * (0.7 + p.r * 0.7) * u;
      els.push(<ellipse key={key} cx={x} cy={y} rx={s2} ry={s2 * 0.48} fill={c} opacity={0.62 + p.r * 0.25} transform={'rotate(' + rot.toFixed(1) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1) + ')'} />);
    } else if (kind === 'bokeh') {
      const x = wrap(p.x0 + t * 0.0003 * (p.r - 0.5)) * width;
      const y = wrap(p.y0 + Math.sin(t * 0.008 + p.ph) * 0.02) * height;
      const r = (26 + p.r * 70) * u;
      els.push(<circle key={key} cx={x} cy={y} r={r} fill={n % 2 ? 'url(#atmo-soft-accent)' : 'url(#atmo-soft-accent2)'} opacity={0.14 + p.r * 0.14 + bp * 0.04} />);
    } else if (kind === 'mist') {
      const y = (0.35 + p.y0 * 0.55) * height;
      const x = wrap(p.x0 + t * (0.0004 + p.r * 0.0004)) * (width * 1.6) - width * 0.3;
      els.push(<ellipse key={key} cx={x} cy={y} rx={width * (0.35 + p.r * 0.25)} ry={height * (0.06 + p.r * 0.05)} fill="url(#atmo-soft-white)" opacity={0.1 + p.r * 0.08} />);
    } else if (kind === 'fireflies') {
      const x = (p.x0 + Math.sin(t * 0.017 + p.ph) * 0.04) * width;
      const y = (0.35 + p.y0 * 0.6 + Math.cos(t * 0.021 + p.ph * 2) * 0.03) * height;
      const blink = 0.35 + 0.65 * Math.max(0, Math.sin(t * 0.09 + p.ph * 3));
      els.push(<circle key={key} cx={x} cy={y} r={(5 + p.r * 5) * u} fill="url(#atmo-soft-lime)" opacity={0.25 + blink * 0.55} />);
    } else if (kind === 'motes') {
      const x = wrap(p.x0 + Math.sin(t * 0.012 + p.ph) * 0.01) * width;
      const y = wrap(p.y0 - t * (0.0007 + p.r * 0.0006)) * height;
      const tw = 0.55 + 0.45 * Math.sin(t * 0.08 + p.ph * 2);
      els.push(<circle key={key} cx={x} cy={y} r={(1.6 + p.r * 2.4) * u} fill={n % 3 ? accent : accent2} opacity={(0.3 + p.r * 0.3) * tw} />);
    } else {
      // dust (warm specks) / embers (glowing rising sparks)
      const ember = kind === 'embers';
      const x = wrap(p.x0 + t * (ember ? 0.0003 : 0.00055) * (n % 2 ? 1 : -0.6)) * width + Math.sin(t * 0.05 + p.ph) * (8 + p.r * 10) * u;
      const y = wrap(p.y0 - t * (ember ? 0.0016 + p.r * 0.0014 : 0.0005 + p.r * 0.0005)) * height;
      const tw = 0.7 + 0.3 * Math.sin(t * (ember ? 0.21 : 0.11) + p.ph * 2);
      const r = (ember ? 2.4 + p.r * 3.6 : 1.8 + p.r * 3.2) * u;
      els.push(<circle key={key} cx={x} cy={y} r={r * 2.6} fill={ember ? 'url(#atmo-soft-ember)' : 'url(#atmo-soft-dust)'} opacity={Math.min(0.95, (ember ? 0.55 : 0.42) * tw + bp * 0.08)} />);
    }
  }
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 18 }}>
      <svg viewBox={'0 0 ' + width + ' ' + height} width="100%" height="100%">
        <defs>
          <radialGradient id="atmo-soft-white"><stop offset="0" stopColor="#FFFFFF" stopOpacity="1" /><stop offset="1" stopColor="#FFFFFF" stopOpacity="0" /></radialGradient>
          <radialGradient id="atmo-soft-dust"><stop offset="0" stopColor="#FFE7B8" stopOpacity="1" /><stop offset="0.35" stopColor="#F2C27B" stopOpacity="0.75" /><stop offset="1" stopColor="#F2C27B" stopOpacity="0" /></radialGradient>
          <radialGradient id="atmo-soft-ember"><stop offset="0" stopColor="#FFF4D6" stopOpacity="1" /><stop offset="0.3" stopColor="#FFB547" stopOpacity="0.9" /><stop offset="1" stopColor="#FF6A1A" stopOpacity="0" /></radialGradient>
          <radialGradient id="atmo-soft-lime"><stop offset="0" stopColor="#F7FFD6" stopOpacity="1" /><stop offset="0.35" stopColor="#D9F99D" stopOpacity="0.8" /><stop offset="1" stopColor="#A3E635" stopOpacity="0" /></radialGradient>
          <radialGradient id="atmo-soft-accent"><stop offset="0" stopColor={accent} stopOpacity="0.9" /><stop offset="1" stopColor={accent} stopOpacity="0" /></radialGradient>
          <radialGradient id="atmo-soft-accent2"><stop offset="0" stopColor={accent2} stopOpacity="0.9" /><stop offset="1" stopColor={accent2} stopOpacity="0" /></radialGradient>
        </defs>
        {els}
      </svg>
    </AbsoluteFill>
  );
};

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

// Title units: whole Latin words / numbers / URLs stay together; every CJK char or punctuation is its own unit.
function tokenizeTitleUnits(txt: string): string[] {
  return String(txt || '').match(/[A-Za-z0-9][\\w.+%#&'’\\/-]*|\\s+|./gsu) || [];
}

// Approximate rendered width in CJK-character units (full-width = 1, Latin/digits ≈ 0.56, space ≈ 0.3).
function titleUnitWidth(unit: string): number {
  let w = 0;
  for (const ch of unit) w += /[\\u2E80-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF\\u3000-\\u303F]/u.test(ch) ? 1 : /\\s/.test(ch) ? 0.3 : 0.56;
  return w;
}

// Word boundaries (UTF-16 offsets) from Intl.Segmenter, or null when unavailable.
function titleWordBoundaries(txt: string): Set<number> | null {
  try {
    const Seg: any = (Intl as any).Segmenter;
    if (typeof Seg !== 'function') return null;
    const set = new Set<number>();
    for (const seg of new Seg('zh', { granularity: 'word' }).segment(txt) as any) set.add(seg.index + seg.segment.length);
    return set;
  } catch {
    return null;
  }
}

// Balanced two-line split at a unit boundary: prefer a colon, then spaces / commas near the visual middle,
// never split inside a Latin word or number and never start a line with closing punctuation.
function formatBalancedTitle(rawTitle: string, maxChars = 11): string[] {
  const txt = String(rawTitle || '').trim();
  if (!txt) return [''];
  if (txt.includes('\\n')) return txt.split('\\n').map((s) => s.trim()).filter(Boolean);
  const units = tokenizeTitleUnits(txt);
  const total = units.reduce((a, u) => a + titleUnitWidth(u), 0);
  if (total <= maxChars) return [txt];
  const colonIdx = txt.search(/[：:]/);
  if (colonIdx > 2 && colonIdx < txt.length - 3) {
    return [txt.slice(0, colonIdx + 1).trim(), txt.slice(colonIdx + 1).trim()];
  }
  const wordBounds = titleWordBoundaries(txt);
  let best = -1;
  let bestScore = Infinity;
  let acc = 0;
  let charPos = 0;
  for (let i = 0; i < units.length - 1; i++) {
    acc += titleUnitWidth(units[i]);
    charPos += units[i].length;
    const cur = units[i];
    const next = units[i + 1];
    if (/^[，。、！？；：,.!?;:）)》」』】%]/u.test(next)) continue;
    if (/[（(《「『【“‘]$/u.test(cur)) continue;
    let score = Math.abs(acc - total / 2);
    const overflow = Math.max(acc, total - acc) - maxChars;
    if (overflow > 0) score += overflow * 1.5;
    if (/[，、,；;·—]$/u.test(cur)) score -= Math.max(0.9, total * 0.18);
    else if (/^\\s+$/.test(cur) || /^\\s+$/.test(next)) score -= Math.max(0.6, total * 0.08);
    else if (wordBounds && !wordBounds.has(charPos)) score += 1.2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return [txt];
  return [units.slice(0, best + 1).join('').trim(), units.slice(best + 1).join('').trim()].filter(Boolean);
}

// Landscape corner PiP: scale the whole scene into the lane beside the avatar so titles/media never hide under it.
const PipSafeStage: React.FC<{ reserveX: number; onLeft: boolean; children: React.ReactNode }> = ({ reserveX, onLeft, children }) => {
  const { width } = useVideoConfig();
  if (!reserveX || reserveX <= 0) return <>{children}</>;
  const k = Math.max(0.7, Math.min(1, (width - reserveX) / width));
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: \`scale(\${k})\`, transformOrigin: onLeft ? 'right center' : 'left center' }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

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

const SUB_CRIMSON_RE = /(私生子|匈奴|单于|楼兰|斩首|斩杀|斩|杀过去|杀|破阵|血战|血|死|战神|战|陨落|突袭|绝杀|锋芒|交锋|伏击|重围|决战|狂奔|冲锋|最前面|王庭|灭|敌|痛|失我|悲歌|孤军|激战|铁骑)/;
const SUB_GOLD_RE = /(霍去病|冠军侯|大将军|皇后|汉武帝|卫青|大汉|封狼居胥|饮马瀚海|禅于姑衍|河西走廊|河西|祁连山|焉支山|丝绸之路|茂陵|长安|汉军|漠北|漠南|秦始皇|项羽|霸王|中国|天下|公元前?\\d+年?|前\\d+年|\\d+[万千百十亿]+[余多]?[人骑里年岁战级]?|\\d+岁|\\d+年|\\d+里|\\d+人|\\d+级|\\d+日)/;

function pickSubtitleAccentColor(word: string, idx = 0): { color: string; glow: string } {
  const w = String(word || '');
  if (SUB_CRIMSON_RE.test(w)) {
    return { color: '#FF3B30', glow: '0 0 18px rgba(255,59,48,0.65), 0 3px 10px rgba(0,0,0,0.98)' };
  }
  if (SUB_GOLD_RE.test(w)) {
    return { color: '#FFD84D', glow: '0 0 18px rgba(255,216,77,0.58), 0 3px 10px rgba(0,0,0,0.98)' };
  }
  return idx % 2 === 0
    ? { color: '#FFD84D', glow: '0 0 16px rgba(255,216,77,0.52), 0 3px 10px rgba(0,0,0,0.98)' }
    : { color: '#FF453A', glow: '0 0 16px rgba(255,69,58,0.56), 0 3px 10px rgba(0,0,0,0.98)' };
}

function autoExtractSubHighlights(text: string): string[] {
  const hits: string[] = [];
  const rx = new RegExp(\`\${SUB_CRIMSON_RE.source}|\${SUB_GOLD_RE.source}\`, 'g');
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    if (m[0] && !hits.includes(m[0])) hits.push(m[0]);
  }
  return hits.slice(0, 6);
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
  const explicitKws = (Array.isArray(accentWords) ? accentWords : []).map((w) => String(w || '').trim()).filter(Boolean);
  const autoKws = autoExtractSubHighlights(clean);
  const kwList = Array.from(new Set([...explicitKws, ...autoKws])).sort((a, b) => b.length - a.length);
  if (kwList.length === 0) {
    return parts.map((p, pi) => {
      if (!p.accent) return <span key={pi}>{p.text}</span>;
      const sty = pickSubtitleAccentColor(p.text, pi);
      return <span key={pi} style={{ color: sty.color, textShadow: sty.glow }}>{p.text}</span>;
    });
  }
  const out: React.ReactNode[] = [];
  let accentCounter = 0;
  parts.forEach((part, pi) => {
    if (part.accent) {
      const sty = pickSubtitleAccentColor(part.text, accentCounter++);
      out.push(<span key={\`p-\${pi}\`} style={{ color: sty.color, textShadow: sty.glow }}>{part.text}</span>);
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
        out.push(<span key={\`\${pi}-\${subIdx++}\`}>{rem}</span>);
        break;
      }
      if (bestPos > 0) {
        out.push(<span key={\`\${pi}-\${subIdx++}\`}>{rem.slice(0, bestPos)}</span>);
      }
      const sty = pickSubtitleAccentColor(bestKw, accentCounter++);
      out.push(<span key={\`\${pi}-\${subIdx++}\`} style={{ color: sty.color, textShadow: sty.glow }}>{bestKw}</span>);
      rem = rem.slice(bestPos + bestKw.length);
    }
  });
  return out;
}

/**
 * Photosensitivity guard (WCAG 2.x / Harding: at most 3 flashes in any 1-second window; the render QA fails above
 * that). Every full-screen flash this composition can draw is scheduled once from script.json, so frames stay
 * deterministic in any render order: the shared flash budget keeps them by priority (heavy clash > flash-cut > clash
 * > light wipes, the diorama beat flash and keyframed camera flashes > the accent wash at a shot's end), at least
 * 0.5 s apart. A dropped flash is drawn without it: flash-cut / light wipes become zoom-punch, a clash keeps its
 * sparks, blade arc, sound and shake but loses the white frame.
 */
const FLASH_WIPE_KINDS = ['flash-cut', 'slash-wipe', 'light-wipe', 'block-wipe'];
type SceneFlashGate = { inFlash: boolean; exitFlash: boolean; clash: Record<number, boolean>; kfs: any[] | null };
const NO_FLASH_GATE: SceneFlashGate = { inFlash: true, exitFlash: true, clash: {}, kfs: null };

/** The transition a scene actually plays: beat-energy cut rhythm, no glitch / iris cuts in historical epics. */
function resolveSceneTxKind(scene: any, idx: number): string {
  const sData: any = scriptData;
  const txKind = scene?.transition || 'iris-circle';
  const genreName = String(sData?.genre || '').toLowerCase();
  const narrationModeStr = String(sData?.narrationMode || 'tts').toLowerCase();
  const isBeatEnergyVideo =
    narrationModeStr === 'subtitle-mv' ||
    narrationModeStr === 'tts-beat-sync' ||
    genreName === 'history-theater' ||
    genreName === 'mv-lyric';
  void genreName;
  const isHistoricalEpic = EPIC_CONTEXT;
  const rawEffectiveTx =
    idx > 0 && (!txKind || txKind === 'cut') && isBeatEnergyVideo
      ? ['cut', 'flash-cut', 'slash-wipe', 'zoom-punch'][idx % 4]
      : txKind;
  // BAN cyberpunk glitch-cut & cartoon iris-circle in historical/epic videos!
  return isHistoricalEpic && (rawEffectiveTx === 'glitch-cut' || rawEffectiveTx === 'iris-circle')
    ? (scene?.actionMode === 'clash-flurry' ? 'slash-wipe' : scene?.actionMode === 'cavalry' ? 'zoom-punch' : 'cut')
    : rawEffectiveTx;
}

const FLASH_GATE: SceneFlashGate[] = (() => {
  const sData: any = scriptData;
  const fps = Math.max(1, Number(sData?.fps) || 30);
  const scenes: any[] = Array.isArray(sData?.scenes) ? sData.scenes : [];
  const candidates: any[] = [];
  const cutFrames: number[] = [];
  const sortedKfs: any[][] = [];
  scenes.forEach((scene: any, idx: number) => {
    const start = Number(scene?.startFrame) || 0;
    const dur = Math.max(8, Number(scene?.durationInFrames) || 90);
    if (idx > 0) cutFrames.push(start);
    const effTx = resolveSceneTxKind(scene, idx);
    const rawTx = String(scene?.transition || 'iris-circle');
    const isFlashCut = effTx === 'flash-cut' || rawTx === 'flash-cut';
    const isWipe = FLASH_WIPE_KINDS.includes(effTx) || FLASH_WIPE_KINDS.includes(rawTx);
    // the history diorama's own beat flash (strong on flash-cut / slash / cavalry shots)
    const dioramaFlash = scene?.transitionKind === 'flash-cut' || /slash|cavalry/i.test(String(scene?.stageSpec?.archetype || 'hero-stand'));
    if (isWipe || dioramaFlash) {
      const inEnd = Math.min(16, Math.max(6, Math.round(dur * 0.45)));
      candidates.push({ key: 'tx:' + idx, frame: start, len: isFlashCut ? 9 : isWipe ? inEnd : 5, prio: isFlashCut ? 4 : 2, coversCut: idx > 0 ? start : null });
    }
    // SceneTransitionOverlay washes the accent colour over the last 5 frames of every non-cut shot
    if (effTx !== 'cut' || rawTx !== 'cut') {
      candidates.push({ key: 'exit:' + idx, frame: start + dur - 1, lead: 4, len: 1, prio: 1, coversCut: idx < scenes.length - 1 ? start + dur : null });
    }
    const evs: any[] = Array.isArray(scene?.actionEvents) ? scene.actionEvents : [];
    evs.forEach((ev: any, ei: number) => {
      const k = String(ev?.kind || '');
      const f = Number(ev?.frame);
      if (!(k.startsWith('metal_clash') || k === 'heavy_impact') || !Number.isFinite(f)) return;
      candidates.push({ key: 'clash:' + idx + ':' + ei, frame: start + Math.round(f), len: 3, prio: k === 'metal_clash_heavy' || k === 'heavy_impact' ? 5 : 3 });
    });
    const kfs: any[] = Array.isArray(scene?.cameraKeyframes)
      ? [...scene.cameraKeyframes].sort((a: any, b: any) => Number(a?.t || 0) - Number(b?.t || 0))
      : [];
    sortedKfs.push(kfs);
    kfs.forEach((kf: any, ki: number) => {
      if (!(Number(kf?.flash) > 0.1)) return;
      const clampT = (v: any, d: number) => Math.max(0, Math.min(1, Number.isFinite(Number(v)) ? Number(v) : d));
      const peak = start + Math.round(clampT(kf?.t, 0) * (dur - 1));
      // before the first / after the last keyframe the rig holds that keyframe's value to the shot's edge
      const f0 = start + Math.floor((ki > 0 ? clampT(kfs[ki - 1]?.t, 0) : 0) * (dur - 1));
      const f1 = start + Math.ceil((ki < kfs.length - 1 ? clampT(kfs[ki + 1]?.t, 1) : 1) * (dur - 1));
      candidates.push({ key: 'kf:' + idx + ':' + ki, frame: peak, lead: Math.max(0, peak - f0), len: Math.max(1, f1 - peak + 1), prio: 2 });
    });
  });
  const plan: any = scheduleFlashBudget({ fps, candidates, cutFrames });
  const dropped: Record<string, boolean> = (plan && plan.dropped) || {};
  return scenes.map((scene: any, idx: number) => {
    const clash: Record<number, boolean> = {};
    const evs: any[] = Array.isArray(scene?.actionEvents) ? scene.actionEvents : [];
    evs.forEach((_ev: any, ei: number) => {
      if (dropped['clash:' + idx + ':' + ei]) clash[ei] = false;
    });
    const kfs: any[] = sortedKfs[idx] || [];
    const anyKfDropped = kfs.some((_kf: any, ki: number) => Boolean(dropped['kf:' + idx + ':' + ki]));
    return {
      inFlash: !dropped['tx:' + idx],
      exitFlash: !dropped['exit:' + idx],
      clash,
      kfs: anyKfDropped ? kfs.map((kf: any, ki: number) => (dropped['kf:' + idx + ':' + ki] ? { ...kf, flash: 0 } : kf)) : null,
    };
  });
})();

function guardFlashTx(kind: string, gate: SceneFlashGate): string {
  return !gate.inFlash && FLASH_WIPE_KINDS.includes(kind) ? 'zoom-punch' : kind;
}
/**
 * True Timeline Keyframe Camera Rig (Pan X/Y + Punch-In/Zoom-Out + Full-Screen Combat Shake + Strobe Flash).
 * Flashes follow the scene's photosensitivity gate (FLASH_GATE).
 */
function evaluateSceneCameraRig(
  scene: any,
  localFrame: number,
  dur: number,
  fps: number,
  bp: number,
  idx: number,
  intensity: number,
  txKind: string,
  gate: SceneFlashGate = NO_FLASH_GATE,
) {
  const p = Math.max(0, Math.min(1, localFrame / Math.max(1, dur - 1)));
  const actionMode = String(scene?.actionMode || '').toLowerCase();
  const actionEvents: any[] = Array.isArray(scene?.actionEvents) ? scene.actionEvents : [];
  const isClashScene = actionMode === 'clash-flurry' || actionMode === 'single-clash';
  const isCavalryScene = actionMode === 'cavalry';
  const isDropScene = actionMode === 'drop-impact';
  const isCleanScene = actionMode === 'clean';
  const isCombat = isClashScene || isCavalryScene || isDropScene;

  // 1. Optional explicit timeline cameraKeyframes [{ t, x, y, scale, rotate, shake, flash }]
  let kfX = 0;
  let kfY = 0;
  let kfScale = 1;
  let kfRot = 0;
  let kfShake = 0;
  let kfFlash = 0;
  // keyframes whose flash the photosensitivity budget dropped come with flash 0 (gate.kfs)
  const kfs = Array.isArray(gate?.kfs) ? gate.kfs : Array.isArray(scene?.cameraKeyframes) ? scene.cameraKeyframes : [];
  if (kfs.length >= 2) {
    const sorted = [...kfs].sort((a, b) => Number(a.t || 0) - Number(b.t || 0));
    let a = sorted[0];
    let b = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (p >= Number(sorted[i].t || 0) && p <= Number(sorted[i + 1].t || 1)) {
        a = sorted[i];
        b = sorted[i + 1];
        break;
      }
    }
    const span = Math.max(0.001, Number(b.t || 1) - Number(a.t || 0));
    const u = Math.max(0, Math.min(1, (p - Number(a.t || 0)) / span));
    const eu = u * u * (3 - 2 * u);
    kfX = Number(a.x || 0) + (Number(b.x || 0) - Number(a.x || 0)) * eu;
    kfY = Number(a.y || 0) + (Number(b.y || 0) - Number(a.y || 0)) * eu;
    kfScale = Number(a.scale ?? 1) + (Number(b.scale ?? 1) - Number(a.scale ?? 1)) * eu;
    kfRot = Number(a.rotate || 0) + (Number(b.rotate || 0) - Number(a.rotate || 0)) * eu;
    kfShake = Number(a.shake || 0) + (Number(b.shake || 0) - Number(a.shake || 0)) * eu;
    kfFlash = Number(a.flash || 0) + (Number(b.flash || 0) - Number(a.flash || 0)) * eu;
  } else if (intensity > 0.05) {
    // Smooth alternating directional camera travel (pan X/Y + slow cinematic push/pull)
    const pattern = idx % 5;
    // calm shots keep a living camera (≈ 4.5 % push, ±12 px pan at intensity 1) — no shake, no flash
    const travel = intensity * (isClashScene ? 0.95 : isCavalryScene ? 0.85 : 0.72);
    if (pattern === 0) {
      kfScale = interpolate(p, [0, 1], [1.0, 1.0 + 0.065 * travel]);
      kfX = interpolate(p, [0, 1], [-16 * travel, 16 * travel]);
    } else if (pattern === 1) {
      kfScale = interpolate(p, [0, 1], [1.0 + 0.07 * travel, 1.0]);
      kfX = interpolate(p, [0, 1], [18 * travel, -18 * travel]);
    } else if (pattern === 2) {
      kfScale = interpolate(p, [0, 0.5, 1], [1.01, 1.0 + 0.06 * travel, 1.02]);
      kfY = interpolate(p, [0, 1], [10 * travel, -10 * travel]);
    } else if (pattern === 3) {
      kfScale = interpolate(p, [0, 1], [1.0, 1.0 + 0.055 * travel]);
      kfY = interpolate(p, [0, 1], [-10 * travel, 10 * travel]);
    } else {
      kfScale = interpolate(p, [0, 0.35, 1], [1.0 + 0.075 * travel, 1.01, 1.0 + 0.04 * travel]);
      kfX = interpolate(p, [0, 1], [-12 * travel, 12 * travel]);
    }
  }

  // 2. EVENT-DRIVEN 0ms-LOCKED IMPACT IMPULSE (fires ONLY on real actionEvents clash/drop frames!)
  let clashShock = 0;
  let clashFlash = 0;
  let clashDir = 1;
  for (let ei = 0; ei < actionEvents.length; ei++) {
    const ev = actionEvents[ei];
    const k = String(ev?.kind || '');
    const isHitEv =
      k === 'metal_clash' ||
      k === 'metal_clash_hi' ||
      k === 'metal_clash_heavy' ||
      k === 'heavy_impact' ||
      k === 'war_drum' ||
      k === 'hoof_stomp';
    if (!isHitEv) continue;
    const age = localFrame - Number(ev?.frame ?? -99);
    if (age >= 0 && age < 10) {
      const w = Number(ev?.intensity || 0.9) * (k === 'metal_clash_heavy' || k === 'heavy_impact' ? 1.25 : k === 'hoof_stomp' ? 0.55 : 1.0);
      const dec = Math.exp(-age * 0.42) * w;
      if (dec > clashShock) {
        clashShock = dec;
        clashDir = ei % 2 === 0 ? 1 : -1;
      }
      if (age < 3 && (k.startsWith('metal_clash') || k === 'heavy_impact') && gate?.clash?.[ei] !== false) {
        const fl = (age === 0 ? 0.44 : age === 1 ? 0.22 : 0.08) * w;
        if (fl > clashFlash) clashFlash = fl;
      }
    }
  }

  // Clean narrative/portrait/map scenes: ZERO jarring shake & ZERO blinding flash!
  const cutRecoil =
    !isCleanScene && idx > 0 && (txKind === 'zoom-punch' || txKind === 'flash-cut' || txKind === 'slash-wipe') && localFrame < 8
      ? Math.exp(-localFrame * 0.42) * 0.72
      : 0;
  const gallopBounce = isCavalryScene ? Math.max(0, bp - 0.5) * 0.55 : 0;
  const shakePower = isCleanScene
    ? kfShake * intensity
    : (clashShock * 1.35 + cutRecoil * 0.65 + gallopBounce + kfShake) * Math.max(0.5, intensity);

  const shakeX = shakePower * Math.sin(localFrame * 6.9 + idx * 1.7) * 14.0 * clashDir;
  const shakeY = shakePower * Math.cos(localFrame * 7.5 + idx * 2.3) * 10.0;
  const shakeRot = shakePower * Math.sin(localFrame * 5.8 + idx) * 1.15;

  const punchZoom =
    clashShock * 0.085 +
    (cutRecoil > 0 ? cutRecoil * 0.065 : 0) +
    (isCleanScene ? Math.max(0, bp - 0.65) * 0.03 : Math.max(0, bp - 0.55) * 0.025);
  const totalScale = Math.max(1.0, kfScale + punchZoom);

  const cutStrobe =
    !isCleanScene && idx > 0 && txKind === 'flash-cut' && localFrame < 4
      ? (localFrame === 0 ? 0.38 : localFrame === 1 ? 0.18 : 0.06)
      : 0;
  const flashAlpha = Math.min(0.56, Math.max(kfFlash, clashFlash, cutStrobe));
  const flashColor = clashFlash > 0.05 ? '#FFE6B8' : '#FFFFFF';

  return {
    tx: kfX + shakeX,
    ty: kfY + shakeY,
    scale: totalScale,
    rotate: kfRot + shakeRot,
    flashAlpha,
    flashColor,
    isCombat,
  };
}

/**
 * Frame-Exact Visual Combat Clash Overlay (0ms triple-locked with scene.actionEvents audio clashes!).
 * Renders golden-white crescent blade slash arcs + blinding steel spark stars + directional sparks
 * + synchronized crimson 斩 N kill-streak counter ONLY at exact metal_clash* frames.
 */
const ActionBeatClashOverlay: React.FC<{
  scene: any;
  localFrame: number;
  width: number;
  height: number;
}> = ({ scene, localFrame, width, height }) => {
  const actionEvents: any[] = Array.isArray(scene?.actionEvents) ? scene.actionEvents : [];
  const clashEvents = actionEvents.filter((ev) => {
    const k = String(ev?.kind || '');
    return k === 'metal_clash' || k === 'metal_clash_hi' || k === 'metal_clash_heavy';
  });
  if (clashEvents.length === 0) return null;

  // Kill counter: a flurry shot, or any clash shot continuing a melee run (killStep is cumulative across cuts)
  const isFlurry =
    (String(scene?.actionMode || '') === 'clash-flurry' && clashEvents.length >= 2) ||
    clashEvents.some((ev) => Number(ev?.killStep || 0) >= 2);
  let currentKillStep = 0;
  let lastKillAge = 999;
  for (let i = 0; i < clashEvents.length; i++) {
    const ev = clashEvents[i];
    const age = localFrame - Number(ev?.frame ?? 999);
    if (age >= 0) {
      currentKillStep = Number(ev?.killStep || i + 1);
      lastKillAge = age;
    }
  }

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 22 }}>
      <svg viewBox="0 0 1920 1080" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
        {clashEvents.map((ev, ci) => {
          const age = localFrame - Number(ev?.frame ?? -99);
          if (age < 0 || age > 9) return null;
          const isHeavy = ev?.kind === 'metal_clash_heavy';
          const isHi = ev?.kind === 'metal_clash_hi';
          const t = age / 9;
          const alpha = Math.pow(1 - t, 1.35);
          const scale = (isHeavy ? 1.18 : 0.92) * (0.72 + Math.min(1, age / 2.2) * 0.42);
          // Alternate impact centers slightly around the combat zone for dynamic fencing rhythm
          const cx = 960 + (ci % 3 === 0 ? -70 : ci % 3 === 1 ? 95 : 15);
          const cy = 515 + (ci % 2 === 0 ? -38 : 34);
          const angle = isHeavy ? -18 : isHi ? 34 : -32 + (ci % 3) * 24;
          return (
            <g key={ci} transform={\`translate(\${cx} \${cy}) rotate(\${angle}) scale(\${scale.toFixed(3)})\`} opacity={alpha.toFixed(3)}>
              {/* Razor Golden-White Crescent Blade Slash Arc */}
              <path
                d="M -360 110 Q -40 -145 370 -40 Q 20 -58 -360 110 Z"
                fill={isHeavy ? '#FFF8E0' : '#FFE8A3'}
                opacity={Math.max(0, 1 - t * 1.15)}
              />
              <path
                d="M -375 126 Q -40 -168 395 -46"
                fill="none"
                stroke="#FF3B30"
                strokeWidth={isHeavy ? 13 : 8}
                strokeLinecap="round"
                opacity={Math.max(0, 0.92 - t)}
              />
              {isHeavy ? (
                <path
                  d="M -290 -130 Q 10 25 320 120 Q 15 65 -290 -130 Z"
                  fill="#FFF2C6"
                  opacity={Math.max(0, 0.95 - t * 1.1)}
                />
              ) : null}
              {/* Blinding 8-Point Forged-Steel Collision Star */}
              <path
                d="M 0 -135 L 14 -24 L 96 -78 L 26 -10 L 148 0 L 26 12 L 92 80 L 14 24 L 0 135 L -14 24 L -94 78 L -26 12 L -148 0 L -26 -10 L -96 -78 L -14 -24 Z"
                fill="#FFFFFF"
                opacity={age < 4 ? 0.98 : Math.max(0, 0.7 - t)}
              />
              <circle cx="0" cy="0" r={36 + age * 14} fill="none" stroke="#FFD84D" strokeWidth={Math.max(1.5, 7 - age * 0.7)} opacity={Math.max(0, 0.85 - t)} />
              {/* 14 Directional Flying Steel Sparks & Crimson Splash Embers */}
              {Array.from({ length: 14 }, (_, si) => {
                const a = (si / 14) * Math.PI * 2 + ci * 0.7;
                const dist = (28 + (si % 4) * 18) + age * (24 + (si % 3) * 14);
                const x1 = Math.cos(a) * dist;
                const y1 = Math.sin(a) * dist;
                const len = 18 + (si % 3) * 14;
                const x2 = x1 - Math.cos(a) * len;
                const y2 = y1 - Math.sin(a) * len;
                return (
                  <line
                    key={si}
                    x1={x1.toFixed(1)}
                    y1={y1.toFixed(1)}
                    x2={x2.toFixed(1)}
                    y2={y2.toFixed(1)}
                    stroke={si % 3 === 0 ? '#FF3B30' : si % 2 === 0 ? '#FFFFFF' : '#FFD84D'}
                    strokeWidth={si % 3 === 0 ? 5.5 : 3.2}
                    strokeLinecap="round"
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      {/* Synchronized Kinetic Crimson Kill-Streak Counter (斩 1 -> 斩 2 -> 斩 3 ...) */}
      {isFlurry && currentKillStep > 0 ? (
        <div
          style={{
            position: 'absolute',
            top: Math.round(height * 0.088),
            right: Math.round(width * 0.045),
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: 10,
            transform: \`scale(\${(1 + Math.exp(-lastKillAge * 0.45) * 0.34).toFixed(3)})\`,
            transformOrigin: 'right center',
          }}
        >
          <span
            style={{
              fontFamily: FONT_SERIF,
              fontSize: Math.round(height * 0.044),
              fontWeight: 900,
              color: '#FFE6C4',
              textShadow: '0 3px 14px rgba(0,0,0,0.95)',
            }}
          >
            斩
          </span>
          <span
            style={{
              fontFamily: FONT_SERIF,
              fontSize: Math.round(height * 0.072),
              fontWeight: 900,
              color: '#FF3B30',
              textShadow: '0 0 22px rgba(255,59,48,0.82), 0 4px 14px rgba(0,0,0,0.98)',
              lineHeight: 1,
            }}
          >
            {currentKillStep}
          </span>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const MediaTile: React.FC<{
  media: any;
  progress: number;
  isBlur?: boolean;
  scaleBoost?: number;
  fitMode?: 'cover' | 'contain';
}> = ({ media, progress, isBlur, scaleBoost = 1, fitMode = 'cover' }) => {
  const localF = useCurrentFrame();
  const { fps: tileFps } = useVideoConfig();
  if (!media?.path) return null;
  const rel = String(media.path).replace(/^\\/+/, '').replace(/\\\\/g, '/');
  const motion = media.motion || 'zoom-in';
  let transform = \`scale(\${scaleBoost})\`;
  if (!isBlur && motion !== 'static') {
    if (motion === 'zoom-out') {
      transform = \`scale(\${interpolate(progress, [0, 1], [1.14, 1.0]) * scaleBoost})\`;
    } else if (motion === 'pan-left') {
      transform = \`scale(\${1.1 * scaleBoost}) translateX(\${interpolate(progress, [0, 1], [3.5, -3.5])}%)\`;
    } else if (motion === 'pan-right') {
      transform = \`scale(\${1.1 * scaleBoost}) translateX(\${interpolate(progress, [0, 1], [-3.5, 3.5])}%)\`;
    } else {
      transform = \`scale(\${interpolate(progress, [0, 1], [1.0, 1.12]) * scaleBoost})\`;
    }
  } else if (isBlur) {
    transform = 'scale(1.18)';
  }
  const isVid = media.type === 'video' || /\\.(mp4|mov|webm|mkv)$/i.test(rel);
  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: fitMode === 'contain' ? 'contain' : 'cover',
    transform,
    filter: isBlur ? 'blur(26px) brightness(0.32) saturate(1.25)' : undefined,
  };
  if (isVid) {
    const regMap: Record<string, any> = (globalThis as any).__DSH_MEDIA_DIMS || {};
    const clipSec = Number(media.durationSec || regMap[rel]?.durationSec || 0);
    const safeEndF = clipSec > 0.2 ? Math.max(4, Math.floor((clipSec - 0.14) * Math.max(1, tileFps || 30))) : 0;
    if (safeEndF > 0 && localF >= safeEndF) {
      return (
        <Freeze frame={Math.max(0, safeEndF - 1)}>
          <OffthreadVideo src={staticFile(rel)} style={style} muted />
        </Freeze>
      );
    }
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
                  ? \`\${rgbSplit}px 0 rgba(255,40,90,0.68), -\${rgbSplit}px 0 rgba(0,225,255,0.68), 0 12px 34px rgba(0,0,0,0.72)\`
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
                    transform: \`translateY(\${y}px) scale(\${sc})\`,
                    textShadow: shadowSplit,
                    letterSpacing: -0.5,
                  }}
                >
                  {ch === ' ' ? '\\u00A0' : ch}
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
              border: \`1.5px solid \${PALETTE.accent}99\`,
              boxShadow: \`0 8px 26px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.16)\`,
              color: '#F8FAFC',
              fontFamily: SANS,
              fontSize: 20,
              fontWeight: 700,
              opacity: interpolate(sp, [0, 1], [0, 1]),
              transform: \`translateY(\${interpolate(sp, [0, 1], [18, 0])}px) scale(\${interpolate(sp, [0, 1], [0.9, 1])})\`,
            }}
          >
            ◆ {kw}
          </div>
        );
      })}
    </div>
  );
};

function hydratedThemeIsLight(scene: any, genreName: string): boolean {
  return scene?.windowTheme === 'light' || genreName === 'ui-tutorial';
}

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

  const flashGate: SceneFlashGate = FLASH_GATE[idx] || NO_FLASH_GATE;
  const txKind = guardFlashTx(scene.transition || 'iris-circle', flashGate);
  const layout = scene.layout || (idx === 0 ? '3d-stage-opener' : idx === total - 1 ? 'radial-climax' : 'media-split-motion');

  const CustomSceneComp = CUSTOM_SCENE_MAP && scene?.id && !scene?.useBuiltinLayout ? CUSTOM_SCENE_MAP[scene.id] : undefined;
  const visual3dMode = String((scriptData as any)?.visual3dMode || 'auto').toLowerCase();
  const enable3dStage = visual3dMode !== 'off';
  const sceneThreePreset =
    scene.threePreset ||
    scene?.stageSpec?.threePreset ||
    THREE_STAGE_PRESETS[idx % THREE_STAGE_PRESETS.length];

  const genreName = String((scriptData as any)?.genre || '').toLowerCase();
  const narrationModeStr = String((scriptData as any)?.narrationMode || 'tts').toLowerCase();
  const isBeatEnergyVideo =
    narrationModeStr === 'subtitle-mv' ||
    narrationModeStr === 'tts-beat-sync' ||
    genreName === 'history-theater' ||
    genreName === 'mv-lyric';
  // beat-energy cut rhythm + historical bans, then the photosensitivity budget
  const effectiveTxKind = guardFlashTx(resolveSceneTxKind(scene, idx), flashGate);

  const hasSceneVisualMedia =
    (Array.isArray(scene.media) && scene.media.length > 0) ||
    (Array.isArray(scene.poolMedia) && scene.poolMedia.length > 0) ||
    Boolean(scene.mediaPath);

  if (CustomSceneComp) {
    const publicAssetFiles =
      Array.isArray(scene.publicAssetFiles) && scene.publicAssetFiles.length > 0
        ? scene.publicAssetFiles
        : Array.isArray(scene.media) && scene.media.length > 0
          ? scene.media.map((m: any) => String(m?.path || '').replace(/^[/\\\\]+/, '').replace(/\\\\/g, '/')).filter(Boolean)
          : Array.isArray(scene.assetPaths) && scene.assetPaths.length > 0
            ? scene.assetPaths.map((p: any) => String(p || '').replace(/^[/\\\\]+/, '').replace(/\\\\/g, '/')).filter(Boolean)
            : scene.mediaPath
              ? [String(scene.mediaPath).replace(/^[/\\\\]+/, '').replace(/\\\\/g, '/')]
              : [];
    const isLightCustom = hydratedThemeIsLight(scene, genreName);
    const allowTechHudOverlay =
      visual3dMode === 'on' &&
      (!genreName || genreName === 'code-animation' || genreName === 'product-promo' || genreName === 'data-story');
    const hydratedScene = {
      ...scene,
      genre: (scriptData as any)?.genre || '',
      narrationMode: narrationModeStr,
      publicAssetFiles,
      threePreset: sceneThreePreset,
      // false when the photosensitivity budget dropped this shot's entry flash (diorama beat flash off)
      flashAllowed: flashGate.inFlash,
      // the film's cast (演员表): castLook(scene, 'id') in the figure kit reads it, so a person looks the same in every shot
      cast: Array.isArray((scriptData as any)?.cast) ? (scriptData as any).cast : [],
    };
    const audioCamIntensity = Number((scriptData as any)?.audioProfile?.cameraBeatIntensity);
    const resolvedCamIntensity = Number.isFinite(audioCamIntensity)
      ? Math.max(0, Math.min(1.2, audioCamIntensity))
      : isLightCustom
        ? 0
        : isBeatEnergyVideo
          ? 1.05
          : beats.length > 0
            ? 0.36
            : 0;
    const applyBeatCamera = !isLightCustom && resolvedCamIntensity > 0.02 && (isBeatEnergyVideo || beats.length > 0 || Array.isArray(scene.cameraKeyframes));
    const camRig = applyBeatCamera
      ? evaluateSceneCameraRig(scene, localFrame, dur, fps, bp, idx, resolvedCamIntensity, effectiveTxKind, flashGate)
      : { tx: 0, ty: 0, scale: 1, rotate: 0, flashAlpha: 0, flashColor: '#FFFFFF', isCombat: false };
    return (
      <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: isLightCustom ? '#F4F7FB' : PALETTE.background }}>
        <AbsoluteFill
          style={
            applyBeatCamera
              ? {
                  transform: \`translate3d(\${camRig.tx.toFixed(1)}px, \${camRig.ty.toFixed(1)}px, 0) rotate(\${camRig.rotate.toFixed(2)}deg) scale(\${camRig.scale.toFixed(4)})\`,
                  transformOrigin: 'center center',
                }
              : undefined
          }
        >
          <CustomSceneComp scene={hydratedScene} idx={idx} total={total} beats={beats} />
          <ActionBeatClashOverlay scene={hydratedScene} localFrame={localFrame} width={width} height={height} />
        </AbsoluteFill>
        {!isLightCustom && String(scene.atmosphere || 'none') !== 'none' ? (
          <AmbientAtmosphere kind={String(scene.atmosphere)} absFrame={absFrame} width={width} height={height} bp={bp} accent={PALETTE.accent} accent2={PALETTE.gold || PALETTE.accent2 || PALETTE.accent} />
        ) : null}
        {camRig.flashAlpha > 0.01 ? (
          <AbsoluteFill style={{ backgroundColor: camRig.flashColor, opacity: camRig.flashAlpha, pointerEvents: 'none', zIndex: 25, mixBlendMode: 'screen' }} />
        ) : null}
        {allowTechHudOverlay ? (
          <HudTelemetryOverlay
            accentColor={PALETTE.accent}
            goldColor={PALETTE.gold || PALETTE.accent2}
            beatPulse={bp}
            sceneIndex={idx}
            totalScenes={total}
            opacity={0.46}
          />
        ) : null}
        <SceneTransitionOverlay
          txKind={effectiveTxKind}
          localFrame={localFrame}
          dur={dur}
          accentColor={PALETTE.accent}
          goldColor={PALETTE.gold || PALETTE.accent2}
          bgColor={PALETTE.background}
          exitFlash={flashGate.exitFlash}
        />
      </AbsoluteFill>
    );
  }

  const useNarrativeDioramaFallback =
    layout === 'narrative-diorama' ||
    Boolean(scene.stageSpec) ||
    (EPIC_CONTEXT && !hasSceneVisualMedia);

  if (useNarrativeDioramaFallback) {
    const dioramaRig = evaluateSceneCameraRig(scene, localFrame, dur, fps, bp, idx, isBeatEnergyVideo ? 1.05 : 0.65, effectiveTxKind, flashGate);
    return (
      <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: PALETTE.background }}>
        <AbsoluteFill
          style={{
            transform: \`translate3d(\${dioramaRig.tx.toFixed(1)}px, \${dioramaRig.ty.toFixed(1)}px, 0) rotate(\${dioramaRig.rotate.toFixed(2)}deg) scale(\${dioramaRig.scale.toFixed(4)})\`,
            transformOrigin: 'center center',
          }}
        >
          <NarrativeDioramaStage scene={flashGate.inFlash ? scene : { ...scene, flashAllowed: false }} idx={idx} total={total} beats={beats} />
          <ActionBeatClashOverlay scene={scene} localFrame={localFrame} width={width} height={height} />
        </AbsoluteFill>
        {dioramaRig.flashAlpha > 0.01 ? (
          <AbsoluteFill style={{ backgroundColor: dioramaRig.flashColor, opacity: dioramaRig.flashAlpha, pointerEvents: 'none', zIndex: 25, mixBlendMode: 'screen' }} />
        ) : null}
        <SceneTransitionOverlay
          txKind={effectiveTxKind}
          localFrame={localFrame}
          dur={dur}
          accentColor={PALETTE.accent}
          goldColor={PALETTE.gold || PALETTE.accent2}
          bgColor={PALETTE.background}
          exitFlash={flashGate.exitFlash}
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

  const titleLines = formatBalancedTitle(scene.title || \`第 \${idx + 1} 幕\`, layout === 'media-split-motion' ? 9 : 11);
  const highlights: string[] = Array.isArray(scene.highlights) ? scene.highlights.filter(Boolean).slice(0, 3) : [];
  const sceneTag = String(scene.tag || \`0\${idx + 1}\`);

  // Impact shake, punch camera & Beat-Synced Spring Physics (spring + interpolate + harmonic recoil)
  const isHeavyImpact = ['kinetic-impact', 'radial-climax', '3d-stage-opener', 'mosaic-pulse-wall', 'vibecoding-spring-stage', 'svg-architecture-flow', 'hud-telemetry-dashboard'].includes(layout);
  const springPhys = computeBeatSpring(localFrame, fps, beats, { delayFrames: 0, beatBoost: isHeavyImpact ? 1.15 : 0.75 });
  const impactDecay = isHeavyImpact && localFrame < 12 ? Math.exp(-localFrame * 0.3) : 0;
  const shakeX = (hashNum(absFrame * 1.3 + 7) - 0.5) * 12 * impactDecay;
  const shakeY = (hashNum(absFrame * 2.1 + 19) - 0.5) * 9 * impactDecay + springPhys.translateY * 0.24;
  const punchZoom = isHeavyImpact && txKind === 'zoom-punch' && localFrame < 12 ? interpolate(localFrame, [0, 12], [1.1, 1], { easing: easeOut }) : 1;
  const beatZoom = (0.96 + springPhys.enterSpring * 0.04) + bp * (isHeavyImpact ? 0.014 : 0.005) + springPhys.beatKick * 0.022;
  const rgbSplit = (txKind === 'glitch-cut' && localFrame < 14 ? 7 * (1 - localFrame / 14) : 0) + impactDecay * 3.5 + springPhys.rgbSplitPx * 0.35;

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
          transform: \`translate(\${shakeX.toFixed(2)}px, \${shakeY.toFixed(2)}px) scale(\${(punchZoom * beatZoom).toFixed(4)})\`,
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
            background: \`radial-gradient(circle at 50% 42%, rgba(\${PALETTE.rgbAccent || '60,140,255'}, \${0.16 + bp * 0.08}), transparent 58%), radial-gradient(circle at 15% 82%, rgba(\${PALETTE.rgbGold || '245,185,46'}, 0.1), transparent 46%)\`,
          }}
        />

        {/* Three.js 3D Vibecoding Spatial Stage */}
        {enable3dStage ? (
          <ThreeCyberStage
            preset={sceneThreePreset}
            primaryColor={PALETTE.accent}
            secondaryColor={PALETTE.gold || PALETTE.accent2}
            beatPulse={bp}
            opacity={primary ? 0.58 : 0.86}
            seed={idx + 1}
          />
        ) : null}

        {/* Ambient Floating Particles & Dot Grid */}
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          <svg width={width} height={height} style={{ position: 'absolute', inset: 0, opacity: 0.22 }}>
            <defs>
              <pattern id={\`grid-\${idx}\`} width="64" height="64" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1.4" fill={PALETTE.accent2 || PALETTE.accent} />
              </pattern>
            </defs>
            <rect width={width} height={height} fill={\`url(#grid-\${idx})\`} />
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
                    border: \`1.5px solid rgba(\${PALETTE.rgbAccent || '125,178,255'}, 0.42)\`,
                    boxShadow: '0 22px 48px rgba(0,0,0,0.6)',
                    opacity: interpolate(cardSp, [0, 1], [0, 0.78]),
                    transform: \`translateZ(\${slot.z + bp * 40}px) rotateX(\${slot.rx}deg) rotateY(\${slot.ry}deg) rotateZ(\${slot.rz}deg) scale(\${slot.scale * interpolate(cardSp, [0, 1], [0.65, 1])})\`,
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
                  background: \`rgba(\${PALETTE.rgbAccent || '60,140,255'}, 0.16)\`,
                  border: \`1px solid \${PALETTE.accent}\`,
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
                  background: \`linear-gradient(90deg, \${PALETTE.accent}, \${PALETTE.gold || PALETTE.accent2})\`,
                  boxShadow: \`0 0 24px \${PALETTE.accent}\`,
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
                  background: \`rgba(\${PALETTE.rgbAccent || '60,140,255'}, 0.16)\`,
                  border: \`1px solid \${PALETTE.accent}\`,
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
                  background: \`linear-gradient(90deg, \${PALETTE.accent}, \${PALETTE.gold || PALETTE.accent2})\`,
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
                  border: \`2px solid rgba(\${PALETTE.rgbAccent || '125,178,255'}, 0.45)\`,
                  boxShadow: \`0 36px 90px rgba(0,0,0,0.72), 0 0 42px rgba(\${PALETTE.rgbAccent || '60,140,255'}, 0.18)\`,
                  transform: \`rotateY(\${interpolate(progress, [0, 1], [-8, -2])}deg) rotateX(\${interpolate(progress, [0, 1], [3, -1])}deg) scale(\${1 + bp * 0.012})\`,
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
                    border: \`2px solid \${PALETTE.gold || PALETTE.accent}\`,
                    boxShadow: '0 20px 44px rgba(0,0,0,0.75)',
                    transform: \`translateY(\${interpolate(localFrame, [0, 18], [40, 0], { extrapolateRight: 'clamp', easing: easeOut })}px)\`,
                  }}
                >
                  <MediaTile media={secondary} progress={progress} />
                </div>
              ) : null}
            </div>
          </AbsoluteFill>
        ) : null}

        {/* LAYOUT 3: kinetic-impact (also safe fallback for freeform-stage / custom layouts when no CustomSceneComp override is present) */}
        {layout === 'kinetic-impact' || !['3d-stage-opener', 'media-split-motion', 'mosaic-pulse-wall', 'compare-dual', 'radial-climax', 'card-fan-opener', 'app-focus-shot', 'workflow-steps', 'split-wipe-compare', 'metric-dashboard', 'svg-architecture-flow', 'hud-telemetry-dashboard', 'vibecoding-spring-stage', 'multi-window-trio', 'narrative-diorama'].includes(layout) ? (
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '0 130px 60px' }}>
            {/* Framing Light Rails */}
            <div
              style={{
                position: 'absolute',
                top: 90,
                left: 110,
                right: 110,
                height: 2,
                background: \`linear-gradient(90deg, transparent, \${PALETTE.accent}, transparent)\`,
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
                background: \`linear-gradient(90deg, transparent, \${PALETTE.accent2 || PALETTE.accent}, transparent)\`,
                opacity: 0.45,
              }}
            />
            <div
              style={{
                padding: '7px 20px',
                borderRadius: 999,
                background: \`rgba(\${PALETTE.rgbGold || '245,185,46'}, 0.16)\`,
                border: \`1px solid \${PALETTE.gold || PALETTE.accent2}\`,
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
                  border: \`1.5px solid \${PALETTE.gold || PALETTE.accent}\`,
                  boxShadow: \`0 16px 40px rgba(0,0,0,0.5)\`,
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
                      border: \`1.5px solid rgba(\${PALETTE.rgbAccent || '125,178,255'}, \${0.35 + bp * 0.3})\`,
                      boxShadow: '0 20px 44px rgba(0,0,0,0.58)',
                      opacity: interpolate(tileSp, [0, 1], [0, 1]),
                      transform: \`scale(\${interpolate(tileSp, [0, 1], [0.82, 1]) + activeBeatScale}) translateY(\${interpolate(tileSp, [0, 1], [28, 0])}px)\`,
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
                      border: \`2px solid \${pi === 1 ? PALETTE.accent : 'rgba(255,255,255,0.2)'}\`,
                      boxShadow: '0 28px 64px rgba(0,0,0,0.65)',
                      opacity: interpolate(sp, [0, 1], [0, 1]),
                      transform: \`translateX(\${interpolate(sp, [0, 1], [panel.side * 90, 0])}px)\`,
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
                  transform: \`translate(-50%, -50%) scale(\${1 + bp * 0.08})\`,
                  width: 78,
                  height: 78,
                  borderRadius: 999,
                  background: \`linear-gradient(135deg, \${PALETTE.accent}, \${PALETTE.gold || PALETTE.accent2})\`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: MONO,
                  fontSize: 24,
                  fontWeight: 900,
                  color: '#060A14',
                  boxShadow: \`0 0 34px \${PALETTE.accent}\`,
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
                transform: \`rotate(\${absFrame * 0.28}deg)\`,
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
                background: \`linear-gradient(90deg, \${PALETTE.accent}, \${PALETTE.gold || PALETTE.accent2})\`,
                color: '#050814',
                fontFamily: MONO,
                fontSize: 18,
                fontWeight: 900,
                letterSpacing: 3,
                marginBottom: 24,
                transform: \`scale(\${interpolate(spring({ frame: Math.max(0, localFrame - 2), fps, config: { damping: 11, stiffness: 220 } }), [0, 1], [1.7, 1])})\`,
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
                background: \`linear-gradient(90deg, \${PALETTE.accent}, \${PALETTE.gold || PALETTE.accent2}, \${PALETTE.accent})\`,
                boxShadow: \`0 0 30px \${PALETTE.accent}\`,
              }}
            />

            <HighlightsRow highlights={highlights} localFrame={localFrame} fps={fps} align="center" />
          </AbsoluteFill>
        ) : null}

        {/* LAYOUT 7: card-fan-opener */}
        {layout === 'card-fan-opener' ? (() => {
          const fanList = (Array.isArray(scene.fanMedia) && scene.fanMedia.length > 0 ? scene.fanMedia : poolList).slice(0, 7);
          const brandLogo = scene.brandMark || (scriptData as any)?.brandMark || '';
          const cleanLogo = brandLogo ? String(brandLogo).replace(/^\\.?[\\\\/]+/, '').replace(/\\\\/g, '/') : '';
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
                  const cleanRel = String(pathStr).replace(/^\\.?[\\\\/]+/, '').replace(/\\\\/g, '/');
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
                        border: \`2px solid \${Math.abs(rel) < 0.6 ? (PALETTE.gold || PALETTE.accent2) : PALETTE.accent}88\`,
                        boxShadow: \`0 24px 54px rgba(0,0,0,0.72)\`,
                        zIndex: 20 - Math.round(Math.abs(rel) * 3),
                        opacity: interpolate(fanSp, [0, 1], [0, 1]),
                        transform: \`translate(\${(tx * fanSp).toFixed(1)}px, \${(ty + (1 - fanSp) * 60).toFixed(1)}px) rotate(\${(angle * fanSp).toFixed(2)}deg) scale(\${(1 - Math.abs(rel) * 0.05) * interpolate(fanSp, [0, 1], [0.85, 1])})\`,
                      }}
                    >
                      {cleanRel ? <Img src={staticFile(cleanRel)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, padding: '8px 20px', borderRadius: 999, background: 'rgba(6, 14, 14, 0.86)', border: \`1px solid \${PALETTE.accent}66\` }}>
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
          const isLightUi = scene.windowTheme === 'light' || String((scriptData as any)?.genre || '') === 'ui-tutorial';
          return (
            <AbsoluteFill style={{ padding: isPortrait ? '100px 36px 250px' : isLightUi ? '34px 44px 136px' : '74px 68px 158px', background: isLightUi ? 'linear-gradient(155deg, #F8FAFC 0%, #EEF4FF 100%)' : undefined, display: 'flex', flexDirection: splitMode ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: splitMode ? 42 : 12 }}>
              {splitMode ? (
                <div style={{ flex: '0 0 34%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <div style={{ padding: '6px 14px', borderRadius: 999, background: isLightUi ? 'rgba(37, 99, 235, 0.1)' : \`rgba(\${PALETTE.rgbAccent || '69,209,178'}, 0.16)\`, border: \`1px solid \${isLightUi ? '#2563EB' : PALETTE.accent}\`, color: isLightUi ? '#1D4ED8' : PALETTE.accent, fontFamily: MONO, fontSize: 15, fontWeight: 700, marginBottom: 14 }}>
                    {scene.kicker || sceneTag}
                  </div>
                  <KineticHeadline lines={titleLines} localFrame={localFrame} fps={fps} fontSize={48} align="left" rgbSplit={rgbSplit} />
                  <HighlightsRow highlights={highlights} localFrame={localFrame} fps={fps} align="left" />
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: isPortrait ? '100%' : isLightUi ? '95%' : '86%', maxWidth: isLightUi ? 1680 : 1420 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span style={{ padding: '5px 14px', borderRadius: 999, background: isLightUi ? 'rgba(37, 99, 235, 0.1)' : \`rgba(\${PALETTE.rgbAccent || '69,209,178'}, 0.16)\`, border: \`1px solid \${isLightUi ? '#3B82F688' : PALETTE.accent + '88'}\`, color: isLightUi ? '#1D4ED8' : PALETTE.accent, fontFamily: MONO, fontSize: 15, fontWeight: 800 }}>
                      {scene.kicker || sceneTag}
                    </span>
                    <span style={{ fontFamily: SANS, fontSize: isPortrait ? 26 : 32, fontWeight: 900, color: isLightUi ? '#0F172A' : PALETTE.textPrimary }}>
                      {scene.title}
                    </span>
                  </div>
                  {highlights.length ? (
                    <span style={{ fontFamily: SANS, fontSize: 18, fontWeight: 700, color: isLightUi ? '#0284C7' : PALETTE.gold || PALETTE.accent2 }}>
                      {highlights.join(' · ')}
                    </span>
                  ) : null}
                </div>
              )}

              <div style={{ flex: 1, width: isPortrait ? '100%' : splitMode ? '64%' : isLightUi ? '95%' : '86%', maxWidth: splitMode ? 1140 : isLightUi ? 1680 : 1420, height: isPortrait ? 640 : isLightUi ? 820 : 730, position: 'relative' }}>
                <AppWindow
                  title={scene.windowTitle || scene.title}
                  kicker={scene.windowBadge || scene.kicker || sceneTag}
                  brandMark={brandLogo}
                  accentColor={PALETTE.accent}
                  goldColor={PALETTE.gold || PALETTE.accent2}
                  theme={isLightUi ? 'light' : 'dark'}
                  style={{ width: '100%', height: '100%' }}
                >
                  {primary ? (
                    <FocusShot
                      src={primary.path}
                      cams={scene.cams}
                      marks={scene.marks}
                      cursors={scene.cursors}
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
                      border: \`3.5px solid \${PALETTE.gold || PALETTE.accent}\`,
                      boxShadow: \`0 20px 50px rgba(0,0,0,0.75), 0 0 28px \${PALETTE.accent}66\`,
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
                      <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', padding: '3px 10px', borderRadius: 999, background: 'rgba(6,14,14,0.9)', border: \`1px solid \${PALETTE.gold || PALETTE.accent}\`, color: '#FFF', fontFamily: SANS, fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>
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
                num: \`0\${si + 1}\`,
                title: t,
                desc: \`Step \${si + 1}\`,
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
                  const cleanImg = st.img ? String(st.img).replace(/^\\.?[\\\\/]+/, '').replace(/\\\\/g, '/') : '';
                  return (
                    <div
                      key={si}
                      style={{
                        flex: 1,
                        borderRadius: 20,
                        overflow: 'hidden',
                        background: isAct ? 'rgba(13, 30, 28, 0.96)' : 'rgba(9, 19, 18, 0.86)',
                        border: \`2px solid \${isAct ? (PALETTE.gold || PALETTE.accent2) : 'rgba(255,255,255,0.12)'}\`,
                        boxShadow: isAct ? \`0 20px 54px rgba(0,0,0,0.65), 0 0 28px \${PALETTE.accent}33\` : '0 14px 36px rgba(0,0,0,0.45)',
                        display: 'flex',
                        flexDirection: 'column',
                        opacity: interpolate(sp, [0, 1], [0, 1]),
                        transform: \`translateY(\${interpolate(sp, [0, 1], [36, 0])}px) scale(\${isAct ? 1.03 : 1})\`,
                      }}
                    >
                      <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: MONO, fontSize: 18, fontWeight: 900, color: isAct ? (PALETTE.gold || PALETTE.accent2) : PALETTE.accent }}>
                          {st.num || \`0\${si + 1}\`}
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
                  <span style={{ padding: '5px 14px', borderRadius: 999, background: \`rgba(\${PALETTE.rgbGold || '246,186,111'}, 0.16)\`, border: \`1px solid \${PALETTE.gold || PALETTE.accent2}\`, color: PALETTE.gold || PALETTE.accent2, fontFamily: MONO, fontSize: 15, fontWeight: 800 }}>
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
                {primary ? (
                  <AppWindow title={scene.windowTitle || scene.title} kicker={scene.windowBadge || 'ENGINE'} brandMark={brandLogo} accentColor={PALETTE.accent} goldColor={PALETTE.gold || PALETTE.accent2} theme={scene.windowTheme === 'light' || String((scriptData as any)?.genre || '') === 'ui-tutorial' ? 'light' : 'dark'} style={{ width: '100%', height: '100%' }}>
                    <FocusShot src={primary.path} cams={scene.cams} marks={scene.marks} cursors={scene.cursors} mediaWidth={Number(primary.width || 0)} mediaHeight={Number(primary.height || 0)} accentColor={PALETTE.accent} goldColor={PALETTE.gold || PALETTE.accent2} />
                  </AppWindow>
                ) : (
                  <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                    <SvgArchitectureDiagram
                      title={scene.windowTitle || '系统核心拓扑'}
                      kicker={scene.windowBadge || 'SVG TOPOLOGY // SPRING'}
                      nodes={highlights.length >= 2 ? highlights : scene.subChunks || [scene.title]}
                      topology="neural-pipeline"
                      accentColor={PALETTE.accent}
                      goldColor={PALETTE.gold || PALETTE.accent2}
                      beatPulse={bp}
                      seed={idx + 1}
                    />
                  </div>
                )}
              </div>
            </AbsoluteFill>
          );
        })() : null}

        {/* LAYOUT 13: svg-architecture-flow (Opus 5.5 Dynamic SVG Architecture Topology + Spring Physics) */}
        {layout === 'svg-architecture-flow' ? (() => {
          const archNodes =
            Array.isArray(scene.steps) && scene.steps.length >= 3
              ? scene.steps.map((s: any) => s?.title || s?.label || String(s))
              : highlights.length >= 3
                ? [scene.title, ...highlights]
                : Array.isArray(scene.subChunks) && scene.subChunks.length >= 2
                  ? [scene.title, ...scene.subChunks, ...highlights]
                  : [scene.title, ...highlights, 'Three.js 3D 空间', 'SVG 动态拓扑', 'Spring 弹簧同步'];
          return (
            <BeatSpringPhysicsRig beats={beats} beatBoost={1.1}>
              <SvgArchitectureDiagram
                title={scene.headline || scene.title}
                kicker={scene.kicker || \`ARCH_TOPOLOGY // SCENE 0\${idx + 1}\`}
                nodes={archNodes}
                topology={scene.archTopology || 'auto'}
                accentColor={PALETTE.accent}
                goldColor={PALETTE.gold || PALETTE.accent2}
                beatPulse={bp}
                seed={idx + 1}
              />
            </BeatSpringPhysicsRig>
          );
        })() : null}

        {/* LAYOUT 14: hud-telemetry-dashboard (Opus 5.5 HUD Data Panels + Live Code Stream + SVG Ring/Spline Charts) */}
        {layout === 'hud-telemetry-dashboard' ? (
          <BeatSpringPhysicsRig beats={beats} beatBoost={1.0}>
            <HudDataDashboard
              title={scene.headline || scene.title}
              kicker={scene.kicker || \`HUD_TELEMETRY // SCENE 0\${idx + 1}\`}
              highlights={highlights}
              metrics={scene.metrics}
              codeLines={scene.codeLines}
              accentColor={PALETTE.accent}
              goldColor={PALETTE.gold || PALETTE.accent2}
              beatPulse={bp}
              seed={idx + 1}
            />
          </BeatSpringPhysicsRig>
        ) : null}

        {/* LAYOUT 15: vibecoding-spring-stage (Opus 5.5 Radial Hub SVG + Spring Physics + HUD Telemetry) */}
        {layout === 'vibecoding-spring-stage' ? (
          <BeatSpringPhysicsRig beats={beats} beatBoost={1.3}>
            <SvgArchitectureDiagram
              title={scene.headline || scene.title}
              kicker={scene.kicker || \`VIBECODING_SPRING // SCENE 0\${idx + 1}\`}
              nodes={[scene.title, ...highlights, ...(Array.isArray(scene.subChunks) ? scene.subChunks : [])]}
              topology="radial-hub"
              accentColor={PALETTE.accent}
              goldColor={PALETTE.gold || PALETTE.accent2}
              beatPulse={bp}
              seed={idx + 3}
            />
          </BeatSpringPhysicsRig>
        ) : null}

        {/* Vibecoding Broadcast HUD Telemetry Frame Overlay */}
        {enable3dStage ? (
          <HudTelemetryOverlay
            accentColor={PALETTE.accent}
            goldColor={PALETTE.gold || PALETTE.accent2}
            beatPulse={bp}
            sceneIndex={idx}
            totalScenes={total}
            opacity={0.72}
          />
        ) : null}

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
                  const cleanRel = String(m?.path || '').replace(/^\\.?[\\\\/]+/, '').replace(/\\\\/g, '/');
                  return (
                    <div
                      key={wi}
                      style={{
                        flex: 1,
                        width: isPortrait ? '100%' : 'auto',
                        height: isPortrait ? 200 : isAct ? 640 : 580,
                        transform: \`scale(\${isAct ? 1.03 : 0.96})\`,
                        opacity: isAct ? 1 : 0.84,
                      }}
                    >
                      <AppWindow
                        title={labels[wi] || \`VIEW 0\${wi + 1}\`}
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
          <div style={{ position: 'absolute', top: 34, left: 40, width: 22, height: 22, borderTop: \`2px solid \${PALETTE.accent2 || PALETTE.accent}\`, borderLeft: \`2px solid \${PALETTE.accent2 || PALETTE.accent}\` }} />
          <div style={{ position: 'absolute', top: 34, right: 40, width: 22, height: 22, borderTop: \`2px solid \${PALETTE.accent2 || PALETTE.accent}\`, borderRight: \`2px solid \${PALETTE.accent2 || PALETTE.accent}\` }} />
          <div style={{ position: 'absolute', bottom: 34, left: 40, width: 22, height: 22, borderBottom: \`2px solid \${PALETTE.accent2 || PALETTE.accent}\`, borderLeft: \`2px solid \${PALETTE.accent2 || PALETTE.accent}\` }} />
          <div style={{ position: 'absolute', bottom: 34, right: 40, width: 22, height: 22, borderBottom: \`2px solid \${PALETTE.accent2 || PALETTE.accent}\`, borderRight: \`2px solid \${PALETTE.accent2 || PALETTE.accent}\` }} />
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
        exitFlash={flashGate.exitFlash}
      />
    </AbsoluteFill>
  );
};

// Opt-in camera motion blur (@remotion/motion-blur). Default OFF: every sample re-renders the whole scene,
// so render cost grows ~linearly with samples. Enable globally via script.motionBlur = { enabled: true, shutterAngle, samples }
// or per scene via scene.motionBlur (true/false or an object; a scene object enables blur unless enabled === false,
// and scene values override the global ones).
type MotionBlurSpec = { shutterAngle: number; samples: number };
function normalizeMotionBlurValue(v: any): any {
  if (v === true) return { enabled: true };
  if (v === false) return { enabled: false };
  return v && typeof v === 'object' ? v : null;
}
function resolveSceneMotionBlur(scene: any): MotionBlurSpec | null {
  const sData: any = scriptData;
  const globalCfg = normalizeMotionBlurValue(sData?.motionBlur);
  const sceneCfg = normalizeMotionBlurValue(scene?.motionBlur);
  const merged: any = { ...(globalCfg || {}), ...(sceneCfg || {}) };
  if (sceneCfg && sceneCfg.enabled === undefined) merged.enabled = true;
  if (merged.enabled !== true) return null;
  const angleRaw = Number(merged.shutterAngle);
  const samplesRaw = Math.round(Number(merged.samples));
  const shutterAngle = Number.isFinite(angleRaw) ? Math.min(360, Math.max(0, angleRaw)) : 180;
  const maxSamples = sData?.lowSpecSafe ? 6 : 16;
  const samples = Number.isFinite(samplesRaw) ? Math.min(maxSamples, Math.max(2, samplesRaw)) : Math.min(maxSamples, 8);
  if (shutterAngle <= 0) return null;
  return { shutterAngle, samples };
}
const SceneMotionBlur: React.FC<{ scene: any; children: React.ReactNode }> = ({ scene, children }) => {
  const spec = resolveSceneMotionBlur(scene);
  if (!spec) return <>{children}</>;
  return (
    <CameraMotionBlur shutterAngle={spec.shutterAngle} samples={spec.samples}>
      {children}
    </CameraMotionBlur>
  );
};

export const VideoComposition: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const isPortrait = width < height;
  const sData: any = scriptData;
  (globalThis as any).__DSH_LOW_SPEC_SAFE = Boolean(sData?.lowSpecSafe);
  (globalThis as any).__DSH_MEDIA_DIMS = { ...${JSON.stringify(computedMediaDims)}, ...(sData?.mediaDims || {}) };
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
  const activeGenreLower = String((sData as any)?.genre || '').toLowerCase();
  const isLightFrame = activeScene?.windowTheme === 'light' || activeGenreLower === 'ui-tutorial';
  const isCinematicSub =
    !isLightFrame &&
    (sData.subtitleStyle === 'cinematic' ||
      sData.narrationMode === 'subtitle-mv' ||
      activeScene?.layout === 'narrative-diorama' ||
      activeGenreLower === 'history-theater' ||
      activeGenreLower === 'mv-lyric');
  const accentWords: string[] = Array.isArray(activeScene?.accentWords) ? activeScene.accentWords : [];
  const activeAvatar = activeScene?.avatarClip?.path ? activeScene.avatarClip : (sData?.avatarClip?.path ? sData.avatarClip : null);
  const avatarLayout = activeScene?.avatarLayout || activeAvatar?.layout || sData?.avatarLayout || 'pip-br';
  // Corner PiP reservation (mirrors AvatarOverlay geometry) so subtitles and the stage never run underneath it.
  const pipOn = Boolean(activeAvatar?.path) && (avatarLayout === 'pip-br' || avatarLayout === 'pip-bl');
  const pipBoxW = isPortrait ? Math.round(width * 0.34) : Math.round(width * 0.22);
  const pipBoxH = Math.round(pipBoxW * 1.125);
  const pipSide = isPortrait ? 28 : 42;
  const pipBottom = isPortrait ? Math.round(height * 0.25) : 96;
  const pipReserveX = pipOn ? pipBoxW + pipSide + (isPortrait ? 18 : 28) : 0;
  const pipOnLeft = avatarLayout === 'pip-bl';
  const subBottomBase = Number(sData.subtitleBottomPx) || DEFAULT_SUBTITLE_BOTTOM || (isPortrait ? 240 : 110);
  // Portrait: the PiP floats above the subtitle band (bottom 25 %), so only landscape needs a horizontal lane.
  const subLaneOverlapsPip = pipOn && !isPortrait && subBottomBase < pipBottom + pipBoxH;
  const subPadLeft = subLaneOverlapsPip && pipOnLeft ? pipReserveX : 0;
  const subPadRight = subLaneOverlapsPip && !pipOnLeft ? pipReserveX : 0;
  const subMaxW = Math.max(Math.round(width * 0.42), Math.round(width * 0.90) - (subPadLeft + subPadRight));

  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.background }}>
      {scenes.map((scene, idx) => (
        <Sequence
          key={scene.id || idx}
          from={Number(scene.startFrame) || 0}
          durationInFrames={Math.max(8, Number(scene.durationInFrames) || 90)}
        >
          <SceneMotionBlur scene={scene}>
            <PipSafeStage reserveX={pipOn && !isPortrait && scene?.pipAvoid !== false ? pipReserveX : 0} onLeft={pipOnLeft}>
              <SceneStage scene={scene} idx={idx} total={scenes.length} beats={beats} />
            </PipSafeStage>
          </SceneMotionBlur>
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
        visible={sData.aiBadgeEnabled !== undefined ? Boolean(sData.aiBadgeEnabled) : sData.aiBadge !== false}
        position={sData.aiBadgePosition || 'top-right'}
        text={
          typeof sData.aiBadgeText === 'string' && sData.aiBadgeText.trim()
            ? sData.aiBadgeText
            : typeof sData.aiBadge === 'string' && sData.aiBadge.trim()
              ? sData.aiBadge
              : DEFAULT_BADGE_TEXT
        }
        accentColor={PALETTE.accent}
      />

      {Array.isArray(sData.workflowSteps) && sData.workflowSteps.length > 0 ? (
        <WorkflowBar
          steps={sData.workflowSteps}
          activeStep={Number(activeScene?.hudStep ?? -1)}
          sectionLabel={activeScene ? \`\${String(scenes.indexOf(activeScene) + 1).padStart(2, '0')} / \${String(scenes.length).padStart(2, '0')}\` : ''}
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
            paddingBottom: subBottomBase,
            paddingLeft: subPadLeft,
            paddingRight: subPadRight,
            pointerEvents: 'none',
            zIndex: 40,
          }}
        >
          <div
            style={
              isCinematicSub
                ? {
                    padding: '8px 32px',
                    fontFamily: FONT_SERIF,
                    fontSize: isPortrait ? 50 : 54,
                    fontWeight: 900,
                    letterSpacing: '0.045em',
                    lineHeight: 1.24,
                    color: '#FFFDF7',
                    maxWidth: subLaneOverlapsPip ? subMaxW : Math.round(width * 0.92),
                    whiteSpace: isPortrait || subLaneOverlapsPip ? 'normal' : 'nowrap',
                    textWrap: 'balance' as any,
                    textAlign: 'center',
                    WebkitTextStroke: '1.6px rgba(0, 0, 0, 0.88)',
                    paintOrder: 'stroke fill',
                    textShadow: '0 4px 12px rgba(0,0,0,0.99), 0 0 8px rgba(0,0,0,0.98), 0 8px 28px rgba(0,0,0,0.92)',
                  }
                : {
                    padding: isPortrait ? '12px 26px' : '12px 34px',
                    borderRadius: 14,
                    background: 'rgba(5, 8, 18, 0.86)',
                    border: \`1.5px solid rgba(\${PALETTE.rgbAccent || '125,178,255'}, 0.42)\`,
                    borderLeft: \`5px solid \${PALETTE.accent}\`,
                    fontFamily: SANS,
                    fontSize: isPortrait ? 38 : 42,
                    fontWeight: 800,
                    color: '#FFFFFF',
                    maxWidth: subLaneOverlapsPip ? subMaxW : Math.round(width * 0.90),
                    whiteSpace: isPortrait || subLaneOverlapsPip ? 'normal' : 'nowrap',
                    textWrap: 'balance' as any,
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textShadow: '0 3px 12px rgba(0,0,0,0.95)',
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
            width: \`\${pct}%\`,
            height: '100%',
            background: \`linear-gradient(90deg, \${PALETTE.accent}, \${PALETTE.gold || PALETTE.accent2})\`,
          }}
        />
      </div>

      <EndNotice
        text={DEFAULT_END_NOTICE}
        accentColor={PALETTE.accent}
      />

      ${hasMasterAudio ? `<Audio src={staticFile('master-audio.wav')} />` : ''}
    </AbsoluteFill>
  );
};
`,
    'utf8',
  )
}
