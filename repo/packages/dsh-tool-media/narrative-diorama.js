/**
 * @dsh-video/narrative-diorama
 * Universal SVG + Remotion Kinetic Storytelling & Historical Diorama Engine.
 * Zero external assets or hardcoded references — every silhouette diorama, campaign map,
 * bamboo scroll, battle slash, and beat-locked flash cut is parameterized cleanly from
 * AI-generated `stageSpec` scene metadata and real measured BGM beat timestamps.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const NARRATIVE_DIORAMA_TSX_SOURCE = `/**
 * @dsh-video/narrative-diorama — Parameterized SVG Storytelling Primitives for Remotion
 * Strictly frame-driven via useCurrentFrame() + interpolate() + spring().
 * Pure deterministic rendering: frame-math only, bundled OFL typography, zero external URLs.
 */
import React from 'react'
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { FONT_MONO, FONT_SANS, FONT_SERIF } from './shotcraft'

const easeOutCubic = Easing.bezier(0.22, 1, 0.36, 1)

export interface DioramaMoodPalette {
  skyTop: string
  skyMid: string
  skyBot: string
  sunCore: string
  sunRim: string
  accent: string
  crimson: string
  ridgeFar: string
  ridgeNear: string
  ground: string
  silhouette: string
  starAlpha: number
}

export const MOOD_PRESETS: Record<string, DioramaMoodPalette> = {
  'dawn-amber': {
    skyTop: '#160B08',
    skyMid: '#7A351E',
    skyBot: '#C9783E',
    sunCore: '#FFF7DF',
    sunRim: '#F59E0B',
    accent: '#F6C26B',
    crimson: '#D9381E',
    ridgeFar: '#5A2C1B',
    ridgeNear: '#2D140D',
    ground: '#120806',
    silhouette: '#0B0605',
    starAlpha: 0.12,
  },
  'crimson-war': {
    skyTop: '#1A0404',
    skyMid: '#6E1410',
    skyBot: '#B8361B',
    sunCore: '#FFE8B8',
    sunRim: '#EF4444',
    accent: '#FBBF24',
    crimson: '#E11D48',
    ridgeFar: '#4E120D',
    ridgeNear: '#270907',
    ground: '#0E0404',
    silhouette: '#070202',
    starAlpha: 0.16,
  },
  'indigo-night': {
    skyTop: '#030614',
    skyMid: '#0F1A3A',
    skyBot: '#1E2F5C',
    sunCore: '#F8FAFC',
    sunRim: '#93C5FD',
    accent: '#F6BA6F',
    crimson: '#F43F5E',
    ridgeFar: '#16213E',
    ridgeNear: '#0B1120',
    ground: '#040710',
    silhouette: '#020409',
    starAlpha: 0.85,
  },
  'ash-twilight': {
    skyTop: '#0B0A0D',
    skyMid: '#30242A',
    skyBot: '#6C3F3A',
    sunCore: '#FCE7CA',
    sunRim: '#D97706',
    accent: '#F59E0B',
    crimson: '#DC2626',
    ridgeFar: '#2A1B20',
    ridgeNear: '#160E12',
    ground: '#090608',
    silhouette: '#050304',
    starAlpha: 0.45,
  },
  'bronze-hall': {
    skyTop: '#0C0906',
    skyMid: '#3C2918',
    skyBot: '#7B552F',
    sunCore: '#FFF8E1',
    sunRim: '#D99B26',
    accent: '#E8B85C',
    crimson: '#C82820',
    ridgeFar: '#332315',
    ridgeNear: '#1C130C',
    ground: '#0D0906',
    silhouette: '#060403',
    starAlpha: 0.1,
  },
  'jade-river': {
    skyTop: '#061516',
    skyMid: '#194A48',
    skyBot: '#4D8E7E',
    sunCore: '#F3FAF6',
    sunRim: '#6EE7B7',
    accent: '#F6C26B',
    crimson: '#E11D48',
    ridgeFar: '#1A403C',
    ridgeNear: '#0C2422',
    ground: '#061312',
    silhouette: '#040B0B',
    starAlpha: 0.25,
  },
  'void-gold': {
    skyTop: '#040406',
    skyMid: '#121015',
    skyBot: '#241B12',
    sunCore: '#FFFDF5',
    sunRim: '#F5B92E',
    accent: '#F5C451',
    crimson: '#DC2626',
    ridgeFar: '#1A1510',
    ridgeNear: '#0D0A07',
    ground: '#050403',
    silhouette: '#030202',
    starAlpha: 0.65,
  },
}

function hashDet(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123
  return s - Math.floor(s)
}

export function computeBeatSignal(tSec: number, beats: any[] = []): { pulse: number; strongPulse: number; isHitFrame: boolean } {
  if (!Array.isArray(beats) || beats.length === 0) return { pulse: 0, strongPulse: 0, isHitFrame: false }
  let pulse = 0
  let strongPulse = 0
  let isHitFrame = false
  for (let i = 0; i < beats.length; i++) {
    const raw = beats[i]
    const bt = typeof raw === 'number' ? raw : Number(raw?.time)
    if (!Number.isFinite(bt)) continue
    const dt = tSec - bt
    if (dt >= -0.017 && dt < 0.36) {
      const clampDt = Math.max(0, dt)
      const val = Math.exp(-clampDt * 10.5)
      if (val > pulse) pulse = val
      const strong = typeof raw === 'object' ? Boolean(raw?.strong) : i % 4 === 0
      if (strong && val > strongPulse) strongPulse = val
      if (clampDt < 0.075 && strong) isHitFrame = true
    }
  }
  return { pulse, strongPulse, isHitFrame }
}

const STARS = Array.from({ length: 48 }, (_, i) => ({
  x: Math.round(hashDet(i * 1.7 + 1) * 1920),
  y: Math.round(hashDet(i * 2.9 + 3) * 580),
  r: 1 + hashDet(i * 3.7 + 7) * 2.2,
  phase: hashDet(i * 5.1) * 6.28,
}))

const EMBERS = Array.from({ length: 34 }, (_, i) => ({
  x0: hashDet(i * 2.13 + 4) * 1920,
  y0: 520 + hashDet(i * 3.41 + 9) * 560,
  vx: (hashDet(i * 4.7) - 0.35) * 42,
  vy: -(24 + hashDet(i * 5.9) * 58),
  r: 1.5 + hashDet(i * 7.3) * 3.2,
  alpha: 0.3 + hashDet(i * 9.1) * 0.55,
}))

const RAY_ANGLES = Array.from({ length: 24 }, (_, i) => -172 + i * 7.8)

export function resolveBannerChar(scene: any = {}, spec: any = {}): string {
  const explicit = String(spec?.bannerChar || '').trim()
  if (explicit) return explicit.slice(0, 2)
  const hay = \`\${scene?.title || ''} \${scene?.narration || ''} \${scene?.headline || ''} \${spec?.headline || ''} \${(scene?.highlights || []).join(' ')}\`
  if (/霍去病|卫青|汉武|大汉|冠军侯|骠骑|河西|祁连|漠北|封狼居胥|长安|匈奴/.test(hay)) return '汉'
  if (/秦始皇|嬴政|大秦|咸阳|函谷|六国|长城|兵马俑|郡县|阿房/.test(hay)) return '秦'
  if (/项羽|霸王|江东|乌江|垓下|巨鹿|鸿门|楚军|西楚/.test(hay)) return '楚'
  if (/蜀汉|诸葛|刘备|关羽|张飞|赵云/.test(hay)) return '蜀'
  if (/曹操|曹魏|官渡|许昌/.test(hay)) return '魏'
  if (/孙权|东吴|赤壁/.test(hay)) return '吴'
  if (/李世民|大唐|盛唐|玄奘|安史/.test(hay)) return '唐'
  if (/岳飞|大宋|汴京|临安/.test(hay)) return '宋'
  if (/朱元璋|大明|锦衣卫|郑和/.test(hay)) return '明'
  return '军'
}

const SkylineClouds: React.FC<{ progress: number; pal: DioramaMoodPalette }> = ({ progress, pal }) => (
  <g opacity={0.56}>
    {[
      { x: 95 + progress * 62, y: 145, w: 460, h: 48 },
      { x: 760 - progress * 52, y: 108, w: 580, h: 58 },
      { x: 1290 + progress * 44, y: 195, w: 420, h: 42 },
      { x: 340 - progress * 34, y: 275, w: 360, h: 34 },
      { x: 1180 - progress * 40, y: 285, w: 390, h: 36 },
    ].map((c, ci) => (
      <g key={ci} transform={\`translate(\${c.x.toFixed(1)}, \${c.y})\`}>
        <rect x={0} y={c.h * 0.42} width={c.w} height={c.h * 0.58} rx={c.h * 0.29} fill={pal.ridgeNear} opacity={0.58} />
        <ellipse cx={c.w * 0.28} cy={c.h * 0.42} rx={c.w * 0.25} ry={c.h * 0.4} fill={pal.skyBot} opacity={0.42} />
        <ellipse cx={c.w * 0.62} cy={c.h * 0.34} rx={c.w * 0.3} ry={c.h * 0.48} fill={pal.skyMid} opacity={0.52} />
        <line x1={16} y1={c.h * 0.96} x2={c.w - 16} y2={c.h * 0.96} stroke={pal.sunCore} strokeWidth={1.6} opacity={0.3} />
      </g>
    ))}
  </g>
)

const PalaceStairsSetting: React.FC<{ pal: DioramaMoodPalette; progress: number; showGuards?: boolean }> = ({ pal, progress, showGuards = true }) => {
  const stepLines = Array.from({ length: 14 }, (_, i) => {
    const t = i / 13
    const y = 550 + t * 530
    const inset = (1 - t) * 420
    return { y, x1: inset, x2: 1920 - inset }
  })
  return (
    <g>
      <rect x={0} y={550} width={1920} height={530} fill={pal.ground} />
      {/* Flanking Watchtowers (Què) */}
      {[360, 1560].map((tx, ti) => (
        <g key={ti} transform={\`translate(\${tx}, 185)\`}>
          <rect x={-44} y={62} width={88} height={310} fill={pal.ridgeNear} />
          <path d="M-70,62 L70,62 L52,32 L-52,32 Z" fill={pal.silhouette} />
          <path d="M-56,30 L56,30 L34,6 L-34,6 Z" fill={pal.silhouette} />
          <rect x={-26} y={78} width={52} height={24} fill={pal.crimson} opacity={0.85} />
        </g>
      ))}
      {/* Main Palace Hall */}
      <g transform="translate(960, 295)">
        <rect x={-320} y={100} width={640} height={155} fill={pal.ridgeNear} />
        {Array.from({ length: 11 }, (_, ci) => (
          <rect key={ci} x={-285 + ci * 54} y={108} width={16} height={138} fill={pal.crimson} opacity={0.72} />
        ))}
        <path d="M-390,104 L390,104 L260,30 L-260,30 Z" fill={pal.silhouette} />
        <path d="M-290,34 L290,34 L180,-12 L-180,-12 Z" fill={pal.silhouette} />
      </g>
      {/* Perspective Stairs */}
      {stepLines.map((st, si) => (
        <line key={si} x1={0} y1={st.y} x2={1920} y2={st.y} stroke={pal.accent} strokeWidth={1.6} opacity={0.22 + (si / 14) * 0.25} />
      ))}
      {/* Flanking Spear Guards */}
      {showGuards ? Array.from({ length: 8 }, (_, gi) => {
        const t = gi / 7
        const y = 575 + t * 445
        const sc = 0.52 + t * 0.72
        const xOff = 365 + t * 490
        return [-1, 1].map((side) => {
          const gx = 960 + side * xOff
          return (
            <g key={\`\${gi}-\${side}\`} transform={\`translate(\${gx.toFixed(1)}, \${y.toFixed(1)}) scale(\${sc.toFixed(2)})\`}>
              <line x1={side * 24} y1={-175} x2={side * 24} y2={0} stroke={pal.silhouette} strokeWidth={4} />
              <polygon points={\`\${side * 24},-194 \${side * 17},-166 \${side * 31},-166\`} fill={pal.silhouette} />
              <polygon points={\`\${side * 24},-162 \${side * (side > 0 ? 4 : 44)},-142 \${side * 24},-132\`} fill={pal.crimson} opacity={0.85} />
              <ellipse cx={0} cy={-95} rx={17} ry={19} fill={pal.silhouette} />
              <rect x={-9} y={-122} width={18} height={12} rx={3} fill={pal.silhouette} />
              <path d="M-24,-74 L24,-74 L30,0 L-30,0 Z" fill={pal.silhouette} />
            </g>
          )
        })
      }) : null}
    </g>
  )
}

const MountainCampSetting: React.FC<{
  pal: DioramaMoodPalette
  frame: number
  bannerChar?: string
  showBeacons?: boolean
  showArmy?: boolean
}> = ({ pal, frame, bannerChar = '汉', showBeacons = true, showArmy = true }) => (
  <g>
    {/* Distant Misty Mountains */}
    <path
      d="M-20,760 L190,585 L390,655 L640,545 L910,635 L1180,530 L1470,625 L1730,540 L1940,630 L1940,1080 L-20,1080 Z"
      fill={pal.ridgeFar}
      opacity={0.78}
    />
    <path
      d="M-20,795 L250,695 L530,745 L820,685 L1080,750 L1380,690 L1690,745 L1940,700 L1940,1080 L-20,1080 Z"
      fill={pal.ridgeNear}
    />
    <rect x={0} y={845} width={1920} height={240} fill={pal.ground} />

    {/* Signal Beacons (烽火台) */}
    {showBeacons ? [760, 1140, 1460, 1740].map((bx, bi) => {
      const flicker = 1 + Math.sin(frame * 0.42 + bi * 1.9) * 0.18
      return (
        <g key={bi} transform={\`translate(\${bx}, 775)\`}>
          <polygon points="-42,75 42,75 30,-25 -30,-25" fill={pal.silhouette} />
          <rect x={-36} y={-32} width={72} height={10} fill={pal.ridgeNear} />
          {/* Smoke Plume */}
          {[0, 1, 2].map((si) => {
            const rise = ((frame * 1.8 + si * 36 + bi * 18) % 110)
            return (
              <circle
                key={si}
                cx={Math.sin((frame + si * 20) * 0.06) * 14}
                cy={-80 - rise}
                r={18 + si * 8}
                fill={pal.silhouette}
                opacity={Math.max(0, 0.34 - rise / 340)}
              />
            )
          })}
          {/* Fire Cone */}
          <path
            d={\`M-22,-32 Q-8,\${(-92 * flicker).toFixed(1)} 0,\${(-124 * flicker).toFixed(1)} Q12,\${(-84 * flicker).toFixed(1)} 22,-32 Z\`}
            fill={pal.crimson}
            opacity={0.9}
          />
          <path
            d={\`M-12,-32 Q0,\${(-95 * flicker).toFixed(1)} 12,-32 Z\`}
            fill={pal.sunCore}
            opacity={0.92}
          />
        </g>
      )
    }) : null}

    {/* Midground War Chariots & Cavalry Silhouettes */}
    {showArmy ? [280, 1520].map((cxPos, ci) => {
      const chShift = Math.sin(frame * 0.12 + ci * 2.1) * 14
      const dir = ci === 0 ? 1 : -1
      return (
        <g key={\`ch-\${ci}\`} transform={\`translate(\${(cxPos + chShift).toFixed(1)}, 825) scale(\${dir * 0.88}, 0.88)\`} opacity={0.92}>
          {/* Chariot Box & Spoked Wheel */}
          <rect x={-90} y={-58} width={84} height={46} rx={4} fill={pal.silhouette} stroke={pal.accent} strokeWidth={1.4} strokeOpacity={0.35} />
          <circle cx={-48} cy={-4} r={30} fill="none" stroke={pal.silhouette} strokeWidth={7} />
          <circle cx={-48} cy={-4} r={7} fill={pal.accent} opacity={0.6} />
          <line x1={-48} y1={-34} x2={-48} y2={26} stroke={pal.silhouette} strokeWidth={3} />
          <line x1={-78} y1={-4} x2={-18} y2={-4} stroke={pal.silhouette} strokeWidth={3} />
          {/* Charioteer */}
          <circle cx={-56} cy={-80} r={12} fill={pal.silhouette} />
          <path d="M-72,-68 L-38,-68 L-34,-26 L-76,-26 Z" fill={pal.silhouette} />
          {/* Pulling Warhorse */}
          <line x1={-6} y1={-32} x2={68} y2={-38} stroke={pal.silhouette} strokeWidth={5} />
          <path d="M46,-46 Q92,-68 134,-48 L158,-80 L176,-72 L156,-42 L138,16 L154,32 L138,34 L120,4 L70,6 L46,32 L34,26 L56,-2 Z" fill={pal.silhouette} />
        </g>
      )
    }) : null}

    {/* Horizon Dense Soldier Phalanx & Waving Faction Banners */}
    {showArmy ? Array.from({ length: 32 }, (_, ai) => {
      const ax = 28 + ai * 60
      const hasFlag = ai % 5 === 2
      const sway = Math.sin(frame * 0.18 + ai * 0.9) * 8
      const marchY = Math.abs(Math.sin(frame * 0.22 + ai * 0.7)) * 4
      return (
        <g key={ai} transform={\`translate(\${ax}, \${(860 - marchY).toFixed(1)})\`}>
          <line x1={14} y1={-124} x2={14} y2={0} stroke={pal.silhouette} strokeWidth={3.2} />
          <polygon points="14,-138 8,-118 20,-118" fill={pal.silhouette} />
          <circle cx={0} cy={-66} r={9.5} fill={pal.silhouette} />
          <path d="M-13,-56 L13,-56 L16,0 L-16,0 Z" fill={pal.silhouette} />
          {hasFlag ? (
            <g transform="translate(14, -124)">
              <path
                d={\`M0,0 Q30,\${sway.toFixed(1)} 62,5 L56,46 Q26,\${(42 - sway * 0.6).toFixed(1)} 0,40 Z\`}
                fill={ai % 10 === 2 ? pal.crimson : pal.silhouette}
                stroke={pal.accent}
                strokeWidth={1.8}
              />
              <text x={29} y={30} textAnchor="middle" fill="#FFFDF5" fontFamily={FONT_SERIF} fontSize={23} fontWeight={900}>
                {bannerChar}
              </text>
            </g>
          ) : null}
        </g>
      )
    }) : null}
  </g>
)

const CityWallSetting: React.FC<{ pal: DioramaMoodPalette; frame: number; bannerChar?: string }> = ({ pal, frame, bannerChar = '汉' }) => (
  <g>
    <path d="M-20,690 L380,610 L840,670 L1320,595 L1940,665 L1940,1080 L-20,1080 Z" fill={pal.ridgeFar} opacity={0.65} />
    <rect x={0} y={710} width={1920} height={370} fill={pal.ground} />
    {/* Crenellated Rampart */}
    <rect x={0} y={675} width={1920} height={155} fill={pal.ridgeNear} />
    {Array.from({ length: 32 }, (_, bi) => (
      <rect key={bi} x={bi * 62 + 8} y={655} width={36} height={22} fill={pal.ridgeNear} />
    ))}
    {/* Battlement Gatehouse */}
    <g transform="translate(1540, 560)">
      <rect x={-120} y={30} width={240} height={100} fill={pal.silhouette} />
      <path d="M-160,35 L160,35 L110,-15 L-110,-15 Z" fill={pal.silhouette} />
    </g>
    {/* Flags on Rampart */}
    {[260, 680, 1180].map((fx, fi) => {
      const wave = Math.sin(frame * 0.16 + fi * 1.4) * 7
      return (
        <g key={fi} transform={\`translate(\${fx}, 655)\`}>
          <line x1={0} y1={-120} x2={0} y2={0} stroke={pal.silhouette} strokeWidth={4} />
          <path d={\`M0,-118 Q44,\${(-124 + wave).toFixed(1)} 88,-112 L80,-62 Q38,\${(-68 - wave).toFixed(1)} 0,-68 Z\`} fill={fi === 1 ? pal.crimson : pal.accent} opacity={0.9} />
          <text x={42} y={-82} textAnchor="middle" fill="#FFFDF5" fontFamily={FONT_SERIF} fontSize={28} fontWeight={900}>
            {bannerChar}
          </text>
        </g>
      )
    })}
  </g>
)

const RiverGorgeSetting: React.FC<{ pal: DioramaMoodPalette; frame: number; progress: number }> = ({ pal, frame, progress }) => (
  <g>
    {/* Left & Right Cliffs */}
    <path d="M-20,420 L260,460 L540,565 L780,695 L0,760 Z" fill={pal.ridgeFar} opacity={0.85} />
    <path d="M1940,390 L1580,450 L1240,575 L980,715 L1940,760 Z" fill={pal.ridgeFar} opacity={0.85} />
    <path d="M-20,660 L380,685 L720,765 L0,810 Z" fill={pal.ridgeNear} />
    {/* Dark Water Plane */}
    <rect x={0} y={760} width={1920} height={320} fill={pal.ground} />
    {/* Shimmering Water Ripples */}
    {Array.from({ length: 16 }, (_, ri) => {
      const ry = 785 + ri * 17
      const rw = 120 + hashDet(ri * 3.1) * 360
      const rx = 620 + Math.sin(frame * 0.04 + ri) * 180
      return (
        <rect
          key={ri}
          x={rx}
          y={ry}
          width={rw}
          height={2.5}
          rx={2}
          fill={pal.sunRim}
          opacity={0.14 + 0.16 * Math.sin(frame * 0.09 + ri)}
        />
      )
    })}
    {/* Lone Ferry Boat on Opposite Mist */}
    <g transform={\`translate(\${(1260 + Math.sin(progress * Math.PI) * 35).toFixed(1)}, 788)\`}>
      <path d="M-65,0 L65,0 L48,18 L-48,18 Z" fill={pal.silhouette} stroke={pal.accent} strokeWidth={1.2} />
      <rect x={-22} y={-22} width={34} height={22} rx={4} fill={pal.ridgeNear} />
      <ellipse cx={26} cy={-18} rx={7} ry={8} fill={pal.silhouette} />
      <line x1={28} y1={-12} x2={52} y2={24} stroke={pal.silhouette} strokeWidth={3} />
    </g>
  </g>
)

export const SlashBurstOverlay: React.FC<{ progress: number; pal: DioramaMoodPalette; seed?: number; cx?: number; cy?: number }> = ({
  progress,
  pal,
  seed = 1,
  cx = 1020,
  cy = 580,
}) => {
  const slashP = interpolate(progress, [0.06, 0.36], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic })
  const burstFade = interpolate(progress, [0.12, 0.28, 0.88], [0, 1, 0.14], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const ringExpand = interpolate(progress, [0.12, 0.72], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic })
  const beamFade = interpolate(progress, [0.08, 0.18, 0.55], [0, 0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <g>
      {/* Vertical Celestial Impact Beam Pillar */}
      {beamFade > 0.02 ? (
        <g opacity={beamFade}>
          <rect x={cx - 46} y={0} width={92} height={1080} fill={pal.crimson} opacity={0.34} />
          <rect x={cx - 16} y={0} width={32} height={1080} fill={pal.sunCore} opacity={0.82} />
        </g>
      ) : null}

      {/* Expanding Concentric Shockwave Rings */}
      {ringExpand > 0.01 && ringExpand < 0.99 ? (
        <g opacity={Math.max(0, 1 - ringExpand)}>
          <circle cx={cx} cy={cy - 20} r={48 + ringExpand * 460} fill="none" stroke={pal.sunCore} strokeWidth={12 * (1 - ringExpand * 0.7)} />
          <circle cx={cx} cy={cy - 20} r={24 + ringExpand * 340} fill="none" stroke={pal.crimson} strokeWidth={8 * (1 - ringExpand * 0.6)} strokeDasharray="24 14" />
        </g>
      ) : null}

      {/* Triple-Layered Sweeping Crescent Blade Slash */}
      <path
        d={\`M\${cx - 420},\${cy + 160} Q\${cx + 35},\${cy - 310} \${cx + 460},\${cy + 110}\`}
        fill="none"
        stroke={pal.crimson}
        strokeWidth={34 * (1 - slashP * 0.35)}
        strokeLinecap="round"
        strokeDasharray={1180}
        strokeDashoffset={1180 * (1 - slashP)}
        opacity={0.76}
      />
      <path
        d={\`M\${cx - 390},\${cy + 150} Q\${cx + 40},\${cy - 285} \${cx + 430},\${cy + 100}\`}
        fill="none"
        stroke={pal.accent}
        strokeWidth={20 * (1 - slashP * 0.42)}
        strokeLinecap="round"
        strokeDasharray={1100}
        strokeDashoffset={1100 * (1 - slashP)}
        opacity={0.94}
      />
      <path
        d={\`M\${cx - 365},\${cy + 144} Q\${cx + 42},\${cy - 270} \${cx + 405},\${cy + 94}\`}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={9 * (1 - slashP * 0.4)}
        strokeLinecap="round"
        strokeDasharray={1060}
        strokeDashoffset={1060 * (1 - slashP)}
        opacity={0.98}
      />

      {/* Crimson Splash Petals & Impact Star Burst */}
      {burstFade > 0.02 ? (
        <g transform={\`translate(\${cx}, \${cy - 25}) scale(\${(0.7 + burstFade * 0.62).toFixed(2)})\`} opacity={burstFade}>
          <polygon
            points={Array.from({ length: 18 }, (_, pi) => {
              const ang = (pi / 18) * Math.PI * 2 + seed * 0.35
              const rad = pi % 2 === 0 ? 185 : 58
              return \`\${(Math.cos(ang) * rad).toFixed(1)},\${(Math.sin(ang) * rad).toFixed(1)}\`
            }).join(' ')}
            fill={pal.crimson}
            opacity={0.86}
          />
          {Array.from({ length: 12 }, (_, si) => {
            const ang = (si / 12) * Math.PI * 2 + seed * 0.7
            const dist = 110 + ringExpand * (140 + (si % 3) * 75)
            const px = Math.cos(ang) * dist
            const py = Math.sin(ang) * dist
            return (
              <ellipse
                key={si}
                cx={px.toFixed(1)}
                cy={py.toFixed(1)}
                rx={16 - (si % 3) * 3}
                ry={5}
                transform={\`rotate(\${((ang * 180) / Math.PI).toFixed(1)}, \${px.toFixed(1)}, \${py.toFixed(1)})\`}
                fill={si % 3 === 0 ? '#FFFFFF' : si % 2 === 0 ? pal.accent : pal.crimson}
                opacity={0.9}
              />
            )
          })}
          <circle cx={0} cy={0} r={54} fill="#FFFFFF" opacity={0.95} />
        </g>
      ) : null}
    </g>
  )
}

export const HeroWarriorFigure: React.FC<{
  x: number
  y: number
  scale?: number
  frame: number
  progress?: number
  beatPulse: number
  pal: DioramaMoodPalette
  headwear?: 'plume' | 'helmet' | 'crown' | 'emperor'
  weapon?: 'halberd' | 'sword' | 'spear' | 'raised-arm'
  flip?: boolean
}> = ({ x, y, scale = 1, frame, progress = 0.5, beatPulse, pal, headwear = 'plume', weapon = 'halberd', flip = false }) => {
  const cloakWave = Math.sin(frame * 0.24) * 28 + beatPulse * 26
  const breathY = Math.sin(frame * 0.14) * 5 - beatPulse * 12
  const strideLean = Math.sin(progress * Math.PI) * 7 + beatPulse * 4.5
  const raiseY = weapon === 'raised-arm' ? -18 - Math.sin(Math.min(1, progress * 1.4) * Math.PI * 0.5) * 44 : Math.sin(frame * 0.12) * 8
  const swingAngle = weapon === 'sword'
    ? -46 + Math.sin(progress * Math.PI * 1.15) * 84 + beatPulse * 16
    : weapon === 'spear'
      ? 24 - Math.sin(progress * Math.PI * 1.1) * 38 - beatPulse * 12
      : weapon === 'halberd'
        ? 14 - Math.sin(progress * Math.PI) * 26 - beatPulse * 8
        : -12
  const rimStroke = pal.sunRim || pal.accent
  return (
    <g transform={\`translate(\${x}, \${(y + breathY).toFixed(1)}) scale(\${(flip ? -scale : scale).toFixed(2)}, \${scale.toFixed(2)}) rotate(\${strideLean.toFixed(2)})\`}>
      {/* Kinetic Ground Shadow & Backlit Aura */}
      <ellipse cx={-4} cy={30} rx={76 + beatPulse * 20} ry={13} fill={pal.silhouette} opacity={0.62} />
      {/* Dynamic Billowing War Cloak with Glowing Rim */}
      <path
        d={\`M-22,-234 C-92,-176 \${(-162 - cloakWave).toFixed(1)},-70 \${(-198 - cloakWave * 1.38).toFixed(1)},30 L64,28 C44,-66 32,-168 22,-234 Z\`}
        fill={pal.silhouette}
        stroke={rimStroke}
        strokeWidth={2.6}
        strokeOpacity={0.52 + beatPulse * 0.4}
      />
      {/* Articulated Stride Legs */}
      <path d={\`M-28,-10 L\${(-50 - strideLean * 1.6).toFixed(1)},30 L-22,32 L-4,-8 Z\`} fill={pal.silhouette} />
      <path d={\`M18,-10 L\${(46 + strideLean * 1.8).toFixed(1)},30 L66,28 L36,-10 Z\`} fill={pal.silhouette} />
      {/* Plumed Helmet / Imperial Mian Crown / General Helmet */}
      {headwear === 'plume' ? (
        <g transform="translate(0, -280)">
          <ellipse cx={0} cy={0} rx={22} ry={25} fill={pal.silhouette} stroke={rimStroke} strokeWidth={1.6} strokeOpacity={0.5} />
          <path d="M-24,-14 C-12,-36 12,-36 24,-14 Z" fill={pal.silhouette} />
          <path d={\`M-6,-28 Q-62,\${(-98 - cloakWave * 0.48).toFixed(1)} \${(-112 - cloakWave * 0.34).toFixed(1)},\${(-70 - cloakWave * 0.5).toFixed(1)}\`} fill="none" stroke={pal.silhouette} strokeWidth={7.5} strokeLinecap="round" />
          <path d={\`M4,-28 Q46,\${(-102 - cloakWave * 0.38).toFixed(1)} \${(92 + cloakWave * 0.28).toFixed(1)},\${(-74 - cloakWave * 0.42).toFixed(1)}\`} fill="none" stroke={pal.silhouette} strokeWidth={7.5} strokeLinecap="round" />
        </g>
      ) : headwear === 'emperor' || headwear === 'crown' ? (
        <g transform="translate(0, -282)">
          <ellipse cx={0} cy={0} rx={22} ry={25} fill={pal.silhouette} stroke={rimStroke} strokeWidth={1.8} strokeOpacity={0.55} />
          <path d="M-22,-18 L22,-18 L18,-32 L-18,-32 Z" fill={pal.silhouette} />
          <rect x={-48} y={-36} width={96} height={9} rx={2} fill={pal.silhouette} stroke={pal.accent} strokeWidth={1.6} />
          {[-38, -24, -10, 4, 18, 32].map((lx, li) => (
            <g key={li}>
              <line x1={lx} y1={-27} x2={lx + Math.sin(frame * 0.16 + li) * 2} y2={-4} stroke={pal.accent} strokeWidth={2.2} opacity={0.85} />
              <circle cx={lx + Math.sin(frame * 0.16 + li) * 2} cy={-3} r={2.4} fill={pal.sunCore} />
            </g>
          ))}
        </g>
      ) : (
        <g transform="translate(0, -280)">
          <ellipse cx={0} cy={0} rx={22} ry={25} fill={pal.silhouette} stroke={rimStroke} strokeWidth={1.6} strokeOpacity={0.5} />
          <polygon points="-26,-10 0,-44 26,-10" fill={pal.silhouette} />
          <path d={\`M0,-44 Q-26,\${(-72 - cloakWave * 0.35).toFixed(1)} -56,\${(-48 - cloakWave * 0.25).toFixed(1)}\`} fill="none" stroke={pal.crimson} strokeWidth={6} strokeLinecap="round" />
        </g>
      )}
      {/* Sculpted Broad Shoulder & Torso Armor + Glowing Rim Highlight */}
      <path
        d="M-66,-244 L66,-244 L54,-198 L46,-126 L56,4 L-56,4 L-46,-126 L-54,-198 Z"
        fill={pal.silhouette}
        stroke={rimStroke}
        strokeWidth={2}
        strokeOpacity={0.42 + beatPulse * 0.38}
      />
      {/* Leading Forearm + Articulated Weapon Swing */}
      {weapon === 'halberd' ? (
        <g transform={\`translate(64, -165) rotate(\${swingAngle.toFixed(1)})\`}>
          <path d="M-16,12 L10,-4 L14,12 L-8,28 Z" fill={pal.silhouette} />
          <line x1={0} y1={-250} x2={0} y2={198} stroke={pal.silhouette} strokeWidth={8.5} />
          <polygon points="0,-298 -13,-240 13,-240" fill={pal.silhouette} stroke={pal.accent} strokeWidth={1.8} />
          <path d="M4,-240 C60,-226 70,-172 18,-158 C40,-182 34,-210 4,-220 Z" fill={pal.silhouette} />
        </g>
      ) : weapon === 'spear' ? (
        <g transform={\`translate(66, -172) rotate(\${swingAngle.toFixed(1)})\`}>
          <line x1={0} y1={-275} x2={0} y2={205} stroke={pal.silhouette} strokeWidth={7.5} />
          <polygon points="0,-328 -14,-266 14,-266" fill={pal.sunCore} stroke={pal.accent} strokeWidth={1.8} />
          {/* Flowing Crimson Spear Tassel */}
          <path d={\`M0,-266 Q-26,\${(-240 + cloakWave * 0.35).toFixed(1)} -46,\${(-216 + cloakWave * 0.25).toFixed(1)}\`} fill="none" stroke={pal.crimson} strokeWidth={9} strokeLinecap="round" />
        </g>
      ) : weapon === 'sword' ? (
        <g transform={\`translate(56, \${(-195 + raiseY).toFixed(1)}) rotate(\${swingAngle.toFixed(1)})\`}>
          <line x1={0} y1={-245} x2={0} y2={36} stroke={pal.sunCore} strokeWidth={8} strokeLinecap="round" />
          <line x1={0} y1={-242} x2={0} y2={28} stroke="#FFFFFF" strokeWidth={3.5} strokeLinecap="round" />
          <rect x={-22} y={10} width={44} height={9} rx={2} fill={pal.accent} />
        </g>
      ) : (
        <g transform={\`translate(50, \${(-210 + raiseY).toFixed(1)}) rotate(\${(-18 + beatPulse * 14).toFixed(1)})\`}>
          <path d="M0,0 L48,-102 L66,-90 L16,16 Z" fill={pal.silhouette} stroke={rimStroke} strokeWidth={1.4} strokeOpacity={0.45} />
        </g>
      )}
    </g>
  )
}

export const StrategicMapStage: React.FC<{
  stageSpec: any
  progress: number
  beatPulse: number
  pal: DioramaMoodPalette
  bannerChar?: string
}> = ({ stageSpec, progress, beatPulse, pal, bannerChar = '汉' }) => {
  const defaultZones = bannerChar === '汉'
    ? [
        { name: '长安·大汉', x: 1120, y: 690, color: '#B91C1C', r: 175 },
        { name: '河西走廊', x: 760, y: 540, color: '#DC2626', r: 155 },
        { name: '祁连山', x: 640, y: 410, color: '#991B1B', r: 135 },
        { name: '漠北·狼居胥', x: 1020, y: 270, color: '#1F2937', r: 165 },
      ]
    : bannerChar === '秦'
      ? [
          { name: '秦', x: 560, y: 540, color: '#991B1B', r: 195 },
          { name: '韩', x: 860, y: 540, color: '#1F2937', r: 115 },
          { name: '赵', x: 960, y: 340, color: '#1E3A8A', r: 140 },
          { name: '魏', x: 1050, y: 500, color: '#065F46', r: 120 },
          { name: '楚', x: 1080, y: 740, color: '#7C2D12', r: 170 },
          { name: '齐', x: 1320, y: 450, color: '#374151', r: 135 },
        ]
      : [
          { name: '楚', x: 1060, y: 560, color: '#991B1B', r: 195 },
          { name: '秦', x: 540, y: 460, color: '#1F2937', r: 165 },
          { name: '汉', x: 640, y: 690, color: '#1E3A8A', r: 145 },
        ]
  const zones = Array.isArray(stageSpec?.zones) && stageSpec.zones.length > 0 ? stageSpec.zones : defaultZones
  const defaultRoutes = bannerChar === '汉'
    ? [
        { from: [1120, 690], to: [760, 540], label: '奔袭河西', color: '#F59E0B', triggerPct: 0.08 },
        { from: [760, 540], to: [640, 410], label: '饮马祁连', color: '#EF4444', triggerPct: 0.34 },
        { from: [760, 540], to: [1020, 270], label: '封狼居胥', color: '#FDE047', triggerPct: 0.58 },
      ]
    : [
        { from: [560, 540], to: [960, 340], label: '铁骑长驱', color: '#EF4444', triggerPct: 0.1 },
        { from: [560, 540], to: [1080, 740], label: '横扫天下', color: '#F59E0B', triggerPct: 0.42 },
      ]
  const routes = Array.isArray(stageSpec?.routes) && stageSpec.routes.length > 0 ? stageSpec.routes : defaultRoutes
  const defaultStamps = bannerChar === '汉'
    ? [
        { x: 760, y: 540, label: '克', triggerPct: 0.28 },
        { x: 1020, y: 270, label: '封', triggerPct: 0.66 },
      ]
    : [
        { x: 960, y: 340, label: '破', triggerPct: 0.32 },
        { x: 1080, y: 740, label: '定', triggerPct: 0.62 },
      ]
  const stamps = Array.isArray(stageSpec?.stamps) && stageSpec.stamps.length > 0 ? stageSpec.stamps : defaultStamps

  return (
    <g>
      {/* Textured Dark Ocean & Parchment Landmass Contour */}
      <rect x={0} y={0} width={1920} height={1080} fill="#07080C" />
      <path
        d="M210,160 Q480,115 790,175 Q1160,130 1440,210 Q1580,360 1510,550 Q1430,775 1190,895 Q850,940 530,850 Q260,720 190,480 Z"
        fill="#1E1712"
        stroke={pal.accent}
        strokeWidth={2.5}
        strokeOpacity={0.5}
      />
      {/* Stylized Terrain Contour Grid Lines */}
      {Array.from({ length: 8 }, (_, gi) => (
        <line key={gi} x1={220} y1={210 + gi * 92} x2={1480} y2={210 + gi * 92} stroke={pal.accent} strokeWidth={1} opacity={0.07} />
      ))}
      {/* Territory Zones */}
      {zones.map((z: any, zi: number) => {
        const zx = Number(z.x) || 960
        const zy = Number(z.y) || 540
        const zr = (Number(z.r) || 150) * (1 + beatPulse * 0.025)
        return (
          <g key={zi}>
            <circle cx={zx} cy={zy} r={zr * 1.18} fill={z.color || pal.crimson} opacity={0.34} />
            <circle cx={zx} cy={zy} r={zr * 0.85} fill="none" stroke={z.borderColor || pal.accent} strokeWidth={2.2} strokeDasharray="8 6" opacity={0.62} />
            <text
              x={zx}
              y={zy + 18}
              textAnchor="middle"
              fill="#FBE7B2"
              fontFamily={FONT_SERIF}
              fontSize={Math.round(Math.max(44, zr * 0.42))}
              fontWeight={900}
              opacity={0.92}
            >
              {z.name}
            </text>
          </g>
        )
      })}
      {/* Animated March / Campaign Routes */}
      {routes.map((rt: any, ri: number) => {
        const [x1, y1] = Array.isArray(rt.from) ? rt.from : [560, 520]
        const [x2, y2] = Array.isArray(rt.to) ? rt.to : [1080, 480]
        const t0 = Number(rt.triggerPct ?? ri * 0.22)
        const rp = interpolate(progress, [t0, Math.min(1, t0 + 0.35)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic })
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2 - 48
        const len = Math.hypot(x2 - x1, y2 - y1) * 1.25
        return (
          <g key={ri}>
            <path
              d={\`M\${x1},\${y1} Q\${mx},\${my} \${x2},\${y2}\`}
              fill="none"
              stroke={rt.color || pal.sunRim}
              strokeWidth={5.5}
              strokeLinecap="round"
              strokeDasharray={len}
              strokeDashoffset={len * (1 - rp)}
            />
            {rp > 0.15 ? (
              <circle cx={x1} cy={y1} r={9} fill={pal.sunCore} />
            ) : null}
            {rp > 0.82 ? (
              <g>
                <circle cx={x2} cy={y2} r={10 + beatPulse * 5} fill={rt.color || pal.crimson} />
                {rt.label ? (
                  <g transform={\`translate(\${mx.toFixed(1)}, \${(my - 14).toFixed(1)})\`}>
                    <rect x={-58} y={-22} width={116} height={30} rx={6} fill="rgba(7,8,12,0.86)" stroke={rt.color || pal.accent} strokeWidth={1.2} />
                    <text x={0} y={0} textAnchor="middle" fill="#F8FAFC" fontFamily={FONT_SANS} fontSize={18} fontWeight={800}>
                      {rt.label}
                    </text>
                  </g>
                ) : null}
              </g>
            ) : null}
          </g>
        )
      })}
      {/* Beat-Synced Stamp Drops ("破", "克", "胜", "围", "霸") */}
      {stamps.map((st: any, si: number) => {
        const trigger = Number(st.triggerPct ?? 0.18 + si * 0.18)
        if (progress < trigger) return null
        const dropAge = (progress - trigger) / Math.max(0.05, 0.22)
        const sc = interpolate(Math.min(1, dropAge), [0, 0.55, 1], [1.95, 0.94, 1.0])
        const sx = Number(st.x) || 960
        const sy = Number(st.y) || 520
        return (
          <g key={si} transform={\`translate(\${sx + 68}, \${sy - 44}) rotate(\${si % 2 === 0 ? -6 : 5}) scale(\${sc.toFixed(2)})\`}>
            <rect x={-30} y={-30} width={60} height={60} rx={8} fill="#F4D484" stroke="#991B1B" strokeWidth={5} />
            <text x={0} y={13} textAnchor="middle" fill="#8A1111" fontFamily={FONT_SERIF} fontSize={38} fontWeight={900}>
              {st.label || '破'}
            </text>
          </g>
        )
      })}
      <text x={1860} y={48} textAnchor="end" fill="#94A3B8" fontFamily={FONT_SANS} fontSize={18} opacity={0.5}>
        {stageSpec?.disclaimer || '路线及态势仅作示意'}
      </text>
    </g>
  )
}

export const CalligraphyColumnPanel: React.FC<{
  lines: string[]
  sealText?: string
  frame: number
  fps: number
  pal: DioramaMoodPalette
}> = ({ lines, sealText, frame, fps, pal }) => {
  if (!Array.isArray(lines) || lines.length === 0) return null
  return (
    <div
      style={{
        position: 'absolute',
        top: 96,
        right: 118,
        display: 'flex',
        flexDirection: 'row-reverse',
        gap: 28,
        alignItems: 'flex-start',
        zIndex: 18,
        pointerEvents: 'none',
      }}
    >
      {lines.slice(0, 4).map((col, ci) => {
        const sp = spring({ frame: Math.max(0, frame - ci * 8), fps, config: { damping: 16, stiffness: 150 } })
        return (
          <div
            key={ci}
            style={{
              writingMode: 'vertical-rl',
              fontFamily: FONT_SERIF,
              fontSize: 48,
              fontWeight: 900,
              letterSpacing: 8,
              color: ci === 0 ? pal.accent : '#F8E7B9',
              textShadow: '0 6px 22px rgba(0,0,0,0.92)',
              opacity: interpolate(sp, [0, 1], [0, 1]),
              transform: \`translateY(\${interpolate(sp, [0, 1], [-24, 0]).toFixed(1)}px)\`,
            }}
          >
            {col}
          </div>
        )
      })}
      {sealText ? (
        <div
          style={{
            marginTop: 14,
            padding: '10px 8px',
            borderRadius: 6,
            background: '#991B1B',
            border: '2px solid #FDE68A',
            color: '#FFFBEB',
            fontFamily: FONT_SERIF,
            fontSize: 22,
            fontWeight: 900,
            writingMode: 'vertical-rl',
            letterSpacing: 3,
            boxShadow: '0 8px 24px rgba(0,0,0,0.65)',
          }}
        >
          {sealText}
        </div>
      ) : null}
    </div>
  )
}

export interface NarrativeDioramaStageProps {
  scene: any
  idx: number
  total: number
  beats?: any[]
}

export const NarrativeDioramaStage: React.FC<NarrativeDioramaStageProps> = ({ scene, idx, total, beats = [] }) => {
  const localFrame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const spec = scene?.stageSpec || {}
  const moodKey = String(spec.mood || 'dawn-amber')
  const pal = MOOD_PRESETS[moodKey] || MOOD_PRESETS['dawn-amber']
  const setting = String(spec.setting || 'mountain-camp')
  const archetype = String(spec.archetype || 'hero-stand')
  const progress = Math.min(1, localFrame / Math.max(1, durationInFrames - 1))

  const absStartSec = Number(scene?.startSec || 0)
  const absTimeSec = absStartSec + localFrame / Math.max(1, fps)
  const { pulse, strongPulse, isHitFrame } = computeBeatSignal(absTimeSec, beats)

  const uid = \`nd-\${idx}\`
  const resolvedBannerChar = resolveBannerChar(scene, spec)
  const sunX = Number(spec.sunX) || 960
  const sunY = Number(spec.sunY) || (archetype === 'hero-numeral' ? 565 : 530)
  const sunR = Number(spec.sunRadius) || (archetype === 'hero-numeral' ? 124 : 122)

  // Beat camera kick & cut shockwave shake
  const cutShakeX = localFrame < 8 ? Math.sin(localFrame * 3.7) * (8 - localFrame) * 1.6 : 0
  const cutShakeY = localFrame < 8 ? Math.cos(localFrame * 4.3) * (8 - localFrame) * 1.2 : 0
  // Event-driven combat VFX: when the choreographer has planned this shot (scene.actionMode), slash bursts fire
  // ONLY on real contact frames (scene.actionEvents) and the camera shake comes from the outer event rig;
  // clean / cavalry shots get no slash burst at all. Legacy scenes without action metadata keep the old timing.
  const actionModeStr = String(scene?.actionMode || '')
  const hasActionPlan = actionModeStr.length > 0
  const contactFrames: number[] = (Array.isArray(scene?.actionEvents) ? scene.actionEvents : [])
    .filter((ev: any) => /^(metal_clash|metal_clash_hi|metal_clash_heavy|heavy_impact)$/.test(String(ev?.kind || '')))
    .map((ev: any) => Number(ev?.frame))
    .filter((f: number) => Number.isFinite(f))
  let burstProgress = progress
  if (hasActionPlan) {
    let lastF = -1
    for (const f of contactFrames) if (f <= localFrame + 7 && f > lastF) lastF = f
    // SlashBurstOverlay draws its arc over progress 0.06→0.36 and peaks the burst at 0.28: peak on the contact frame
    burstProgress = lastF >= 0 ? 0.28 + (localFrame - lastF) / 32 : 0
  }
  const showBurst = !hasActionPlan || burstProgress > 0.01
  const actionShake = !hasActionPlan && /slash|oath|cavalry|duel/i.test(archetype) && isHitFrame ? 11 : 0
  const camPanX = Math.sin(idx * 1.7 + progress * Math.PI) * 30
  const camPanY = Math.cos(idx * 2.1 + progress * Math.PI) * 10
  const camZoom = 1.02 + progress * 0.068 + pulse * 0.032 + strongPulse * 0.02

  // scene.flashAllowed === false: the composition's photosensitivity budget dropped this shot's entry flash
  const flashAlpha = scene?.flashAllowed === false
    ? 0
    : scene?.transitionKind === 'flash-cut' || scene?.transition === 'flash-cut' || /slash|cavalry/i.test(archetype)
      ? interpolate(localFrame, [0, 5], [0.52, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
      : interpolate(localFrame, [0, 3], [0.2, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  const heroItems = Array.isArray(spec.plaques) && spec.plaques.length > 0
    ? spec.plaques
    : Array.isArray(spec.slips) && spec.slips.length > 0
      ? spec.slips
      : (archetype === 'plaque-summary' || archetype === 'bamboo-slips' || archetype === 'scroll-calligraphy')
        ? (Array.isArray(scene?.highlights) && scene.highlights.length > 0
            ? scene.highlights
            : resolvedBannerChar === '汉'
              ? ['八百轻骑', '冠军封侯', '河西大捷', '饮马祁连', '封狼居胥', '匈奴未灭']
              : resolvedBannerChar === '秦'
                ? ['扫平六合', '书同文字', '车同轨道', '废分封制', '北筑长城', '千古一帝']
                : ['破釜沉舟', '巨鹿大捷', '铁骑长驱', '逐鹿中原', '风云再起', '千古绝唱'])
        : []

  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        background: pal.skyTop,
        transform: \`translate(\${(cutShakeX + actionShake + camPanX).toFixed(1)}px, \${(cutShakeY + camPanY).toFixed(1)}px) scale(\${camZoom.toFixed(4)})\`,
        transformOrigin: 'center center',
      }}
    >
      {archetype === 'strategic-map' ? (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" style={{ width: '100%', height: '100%', display: 'block' }}>
          <StrategicMapStage stageSpec={spec} progress={progress} beatPulse={pulse} pal={pal} bannerChar={resolvedBannerChar} />
        </svg>
      ) : (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" style={{ width: '100%', height: '100%', display: 'block' }}>
          <defs>
            <linearGradient id={\`sky-\${uid}\`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={pal.skyTop} />
              <stop offset="52%" stopColor={pal.skyMid} />
              <stop offset="100%" stopColor={pal.skyBot} />
            </linearGradient>
            <radialGradient id={\`sunGlow-\${uid}\`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={pal.sunCore} stopOpacity={0.96} />
              <stop offset="45%" stopColor={pal.sunRim} stopOpacity={0.62} />
              <stop offset="100%" stopColor={pal.sunRim} stopOpacity={0} />
            </radialGradient>
          </defs>

          {/* 1. Atmosphere Sky Backdrop */}
          <rect x={0} y={0} width={1920} height={1080} fill={\`url(#sky-\${uid})\`} />

          {/* Twinkling Starfield */}
          {pal.starAlpha > 0.05 ? STARS.map((st, si) => (
            <circle
              key={si}
              cx={st.x}
              cy={st.y}
              r={st.r}
              fill={pal.sunCore}
              opacity={pal.starAlpha * (0.45 + 0.55 * Math.sin(localFrame * 0.1 + st.phase))}
            />
          )) : null}

          {/* 2. Horizon Celestial Orb & Beat-Pulsing Radial God Rays */}
          {spec.celestial !== 'none' && archetype !== 'channel-end' ? (
            <g>
              <g transform={\`translate(\${sunX}, \${sunY}) rotate(\${(localFrame * 0.1).toFixed(2)})\`} opacity={0.22 + pulse * 0.2}>
                {RAY_ANGLES.map((ang, ri) => (
                  <polygon
                    key={ri}
                    points="0,0 -36,-1320 36,-1320"
                    transform={\`rotate(\${ang})\`}
                    fill={pal.sunCore}
                  />
                ))}
              </g>
              <circle cx={sunX} cy={sunY} r={sunR * (2.75 + pulse * 0.52)} fill={\`url(#sunGlow-\${uid})\`} />
              <circle cx={sunX} cy={sunY} r={sunR * (1 + strongPulse * 0.07)} fill={pal.sunCore} opacity={0.97} />
            </g>
          ) : null}

          {/* Rolling Clouds */}
          <SkylineClouds progress={progress} pal={pal} />

          {/* 3. Hero Number Layer Behind Horizon Silhouette (hero-numeral archetype) */}
          {archetype === 'hero-numeral' && spec.heroNum ? (
            <g transform={\`translate(960, \${interpolate(Math.min(1, localFrame / 18), [0, 1], [305, 320]).toFixed(1)}) scale(\${(1 + strongPulse * 0.05).toFixed(3)})\`}>
              <text
                x={0}
                y={0}
                textAnchor="middle"
                fill="#FDF3DC"
                stroke="#180A06"
                strokeWidth={8}
                paintOrder="stroke"
                fontFamily={FONT_SERIF}
                fontSize={310}
                fontWeight={900}
                letterSpacing={-12}
                opacity={0.98}
              >
                {spec.heroNum}
              </text>
              {spec.heroUnit ? (
                <text
                  x={228}
                  y={-6}
                  fill="#FDF3DC"
                  stroke="#180A06"
                  strokeWidth={5}
                  paintOrder="stroke"
                  fontFamily={FONT_SERIF}
                  fontSize={70}
                  fontWeight={900}
                  opacity={0.95}
                >
                  {spec.heroUnit}
                </text>
              ) : null}
            </g>
          ) : null}

          {/* 4. Terrain & Architectural Backdrop */}
          {setting === 'palace-stairs' ? (
            <PalaceStairsSetting pal={pal} progress={progress} showGuards={spec.showGuards !== false} />
          ) : setting === 'city-siege' ? (
            <CityWallSetting pal={pal} frame={localFrame} bannerChar={resolvedBannerChar} />
          ) : setting === 'river-gorge' ? (
            <RiverGorgeSetting pal={pal} frame={localFrame} progress={progress} />
          ) : (
            <MountainCampSetting
              pal={pal}
              frame={localFrame}
              bannerChar={resolvedBannerChar}
              showBeacons={setting !== 'vast-plain'}
              showArmy={archetype !== 'channel-end' && archetype !== 'scroll-calligraphy' && archetype !== 'bamboo-slips'}
            />
          )}

          {/* 5. Archetype Action & Foreground Hero Silhouettes */}
          {archetype === 'hero-numeral' ? (
            <HeroWarriorFigure
              x={960}
              y={845}
              scale={1.06}
              frame={localFrame}
              progress={progress}
              beatPulse={pulse}
              pal={pal}
              headwear={spec.headwear || (resolvedBannerChar === '秦' ? 'emperor' : 'plume')}
              weapon={spec.weapon || (resolvedBannerChar === '汉' ? 'spear' : 'halberd')}
            />
          ) : null}

          {archetype === 'hero-stand' ? (
            <HeroWarriorFigure
              x={Number(spec.heroX) || (idx % 2 === 0 ? 560 : 960)}
              y={865}
              scale={1.28}
              frame={localFrame}
              progress={progress}
              beatPulse={pulse}
              pal={pal}
              headwear={spec.headwear || (resolvedBannerChar === '秦' ? 'emperor' : 'plume')}
              weapon={spec.weapon || (resolvedBannerChar === '汉' ? 'spear' : 'halberd')}
            />
          ) : null}

          {archetype === 'oath-break' ? (
            <g>
              {/* Burning Sunk Warships in River Horizon */}
              {[1360, 1620].map((bx, bi) => {
                const tilt = 14 + Math.sin(localFrame * 0.14 + bi) * 6
                return (
                  <g key={bi} transform={\`translate(\${bx}, 725) rotate(\${tilt.toFixed(1)})\`}>
                    <path d="M-95,0 L95,0 L65,36 L-75,36 Z" fill={pal.silhouette} />
                    <path d="M-20,-42 Q0,-128 24,-42 Z" fill={pal.crimson} opacity={0.92} />
                    <path d="M18,-36 Q38,-102 58,-36 Z" fill={pal.sunRim} opacity={0.86} />
                  </g>
                )
              })}
              {/* Broken Bronze Cauldron (破釜) + Warrior Hoisting Hammer cleanly above subtitle zone */}
              <g transform="translate(880, 765)">
                <path d="M-74,-52 L74,-52 L56,12 L-56,12 Z" fill={pal.silhouette} stroke={pal.crimson} strokeWidth={3} />
                <line x1={-40} y1={12} x2={-52} y2={44} stroke={pal.silhouette} strokeWidth={12} />
                <line x1={40} y1={12} x2={52} y2={44} stroke={pal.silhouette} strokeWidth={12} />
                <polyline points="-10,-52 8,-18 -6,6" fill="none" stroke={pal.sunCore} strokeWidth={4} />
              </g>
              <HeroWarriorFigure x={620} y={845} scale={1.14} frame={localFrame} progress={progress} beatPulse={pulse} pal={pal} headwear="plume" weapon="raised-arm" />
              {showBurst ? <SlashBurstOverlay progress={burstProgress} pal={pal} cx={880} cy={635} seed={3} /> : null}
            </g>
          ) : null}

          {archetype === 'cavalry-rush' ? (
            <g>
              {/* Kinetic Motion Speedlines */}
              {Array.from({ length: 14 }, (_, li) => {
                const ly = 320 + li * 42
                const lx = ((localFrame * 54 + li * 190) % 2100) - 240
                return <line key={\`sl-\${li}\`} x1={lx} y1={ly} x2={lx + 240} y2={ly - 14} stroke={pal.sunCore} strokeWidth={2.5} opacity={0.28 + pulse * 0.25} />
              })}
              {/* Midground Charging Cavalry Squadron */}
              {[0, 1, 2, 3, 4].map((hi) => {
                const dir = hi % 2 === 0 ? 1 : -1
                const xPos = dir > 0 ? 160 + progress * 560 + hi * 290 : 1740 - progress * 540 - hi * 230
                const bob = Math.sin(localFrame * 0.52 + hi * 1.3) * 16
                return (
                  <g key={hi} transform={\`translate(\${xPos.toFixed(1)}, \${(785 + bob + hi * 10).toFixed(1)}) scale(\${dir}, 1)\`}>
                    <path d="M-85,-32 Q-25,-66 48,-46 L86,-88 L112,-76 L92,-48 L64,12 L88,42 L68,46 L38,8 L-48,10 L-88,42 L-104,34 L-70,0 Z" fill={pal.silhouette} stroke={pal.sunRim} strokeWidth={1.5} strokeOpacity={0.35} />
                    <circle cx={-12} cy={-96} r={14} fill={pal.silhouette} />
                    <path d="M-28,-82 L8,-82 L12,-34 L-32,-34 Z" fill={pal.silhouette} />
                    <path d="M-24,-78 Q-86,-96 -136,-54" fill="none" stroke={pal.crimson} strokeWidth={12} strokeLinecap="round" opacity={0.85} />
                    <line x1={-25} y1={-62} x2={178} y2={-124} stroke={pal.silhouette} strokeWidth={5.5} />
                    <polygon points="178,-124 152,-130 156,-110" fill={pal.sunCore} />
                  </g>
                )
              })}
              {/* Foreground Towering Mounted Hero General */}
              <g transform={\`translate(\${(520 + progress * 240).toFixed(1)}, \${(840 + Math.sin(localFrame * 0.45) * 14).toFixed(1)}) scale(1.42)\`}>
                <path d="M-110,-36 Q-32,-82 62,-54 L112,-112 L144,-96 L116,-56 L80,16 L114,56 L86,62 L48,12 L-62,14 L-112,56 L-134,44 L-90,0 Z" fill={pal.silhouette} stroke={pal.sunRim} strokeWidth={2.2} strokeOpacity={0.55 + pulse * 0.35} />
                <path d={\`M-26,-92 Q-118,\${(-120 + Math.sin(localFrame * 0.3) * 26).toFixed(1)} -194,-42 L-146,-18 Q-84,-64 -16,-54 Z\`} fill={pal.crimson} opacity={0.88} />
                <circle cx={-14} cy={-122} r={18} fill={pal.silhouette} />
                <path d="M-18,-138 Q-68,-178 -106,-152" fill="none" stroke={pal.silhouette} strokeWidth={6} strokeLinecap="round" />
                <path d="M-36,-102 L14,-102 L18,-40 L-40,-40 Z" fill={pal.silhouette} stroke={pal.accent} strokeWidth={1.4} strokeOpacity={0.45} />
                <line x1={-40} y1={-76} x2={235} y2={-168} stroke={pal.silhouette} strokeWidth={7} />
                <polygon points="248,-172 214,-178 222,-154" fill="#FFFFFF" />
                <path d="M214,-162 Q194,-138 176,-126" fill="none" stroke={pal.crimson} strokeWidth={8} strokeLinecap="round" />
              </g>
              {showBurst ? <SlashBurstOverlay progress={burstProgress} pal={pal} cx={1120} cy={560} seed={idx + 2} /> : null}
            </g>
          ) : null}

          {archetype === 'slash-climax' ? (
            <g>
              <HeroWarriorFigure x={590} y={855} scale={1.24} frame={localFrame} progress={progress} beatPulse={pulse} pal={pal} headwear={spec.headwear || 'plume'} weapon="sword" />
              {[0, 1, 2, 3].map((ei) => {
                const flyX = 1120 + ei * 165 + progress * (135 + ei * 52)
                const flyY = 665 - Math.sin(progress * Math.PI) * 145 + ei * 28
                const rot = progress * 68 + ei * 28
                return (
                  <g key={ei} transform={\`translate(\${flyX.toFixed(1)}, \${flyY.toFixed(1)}) rotate(\${rot.toFixed(1)})\`}>
                    <circle cx={0} cy={-55} r={14} fill={pal.silhouette} />
                    <path d="M-18,-40 L18,-40 L24,28 L-24,28 Z" fill={pal.silhouette} />
                  </g>
                )
              })}
              {showBurst ? <SlashBurstOverlay progress={burstProgress} pal={pal} cx={1020} cy={555} seed={idx + 7} /> : null}
            </g>
          ) : null}

          {archetype === 'duel-confront' ? (
            <g>
              <HeroWarriorFigure x={Math.round(470 + progress * 125)} y={855} scale={1.18} frame={localFrame} progress={progress} beatPulse={pulse} pal={pal} headwear="plume" weapon={resolvedBannerChar === '汉' ? 'spear' : 'sword'} />
              <HeroWarriorFigure x={Math.round(1450 - progress * 125)} y={855} scale={1.18} frame={localFrame} progress={progress} beatPulse={pulse} pal={pal} headwear="helmet" weapon="halberd" flip={true} />
              {showBurst ? <SlashBurstOverlay progress={burstProgress} pal={pal} cx={960} cy={575} seed={9} /> : null}
            </g>
          ) : null}

          {archetype === 'farewell-tent' ? (
            <g>
              <path d="M0,0 L1920,0 L1920,380 Q1440,210 960,150 Q480,210 0,380 Z" fill={pal.silhouette} opacity={0.88} />
              {Array.from({ length: 18 }, (_, li) => (
                <circle
                  key={li}
                  cx={80 + li * 104}
                  cy={650 + (li % 3) * 18}
                  r={4.5 + pulse * 3}
                  fill={pal.crimson}
                  opacity={0.75 + 0.2 * Math.sin(localFrame * 0.2 + li)}
                />
              ))}
              <HeroWarriorFigure x={720} y={855} scale={1.14} frame={localFrame} progress={progress} beatPulse={pulse} pal={pal} headwear="plume" weapon={resolvedBannerChar === '汉' ? 'spear' : 'halberd'} />
              <g transform={\`translate(1150, 850) rotate(\${(Math.sin(localFrame * 0.08) * 6).toFixed(1)})\`}>
                <ellipse cx={0} cy={-235} rx={15} ry={18} fill={pal.silhouette} />
                <path d="M-24,-214 L24,-214 L48,10 L-42,10 Z" fill={pal.silhouette} />
                <path d="M-26,-190 Q-85,-140 -105,-90" fill="none" stroke={pal.silhouette} strokeWidth={12} strokeLinecap="round" />
                <line x1={32} y1={-190} x2={125} y2={-265} stroke={pal.sunCore} strokeWidth={4.5} />
              </g>
            </g>
          ) : null}

          {(archetype === 'scroll-calligraphy' || archetype === 'bamboo-slips') ? (
            <HeroWarriorFigure x={360} y={860} scale={1.16} frame={localFrame} progress={progress} beatPulse={pulse} pal={pal} headwear={spec.headwear || 'plume'} weapon={spec.weapon || (resolvedBannerChar === '汉' ? 'spear' : 'halberd')} />
          ) : null}

          {/* 6. Floating Embers Foreground */}
          {EMBERS.map((em, ei) => {
            const ex = ((em.x0 + progress * em.vx * 3.5 + 1920) % 1920)
            const ey = ((em.y0 + progress * em.vy * 4.5 + 1080) % 1080)
            return (
              <circle
                key={ei}
                cx={ex}
                cy={ey}
                r={em.r * (1 + pulse * 0.42)}
                fill={ei % 3 === 0 ? pal.crimson : pal.sunCore}
                opacity={em.alpha}
              />
            )
          })}
        </svg>
      )}

      {/* 7. Tactile 3D-Shaded Bamboo Slips / Commemorative Plaques Array Overlay */}
      {(archetype === 'scroll-calligraphy' || archetype === 'plaque-summary' || archetype === 'bamboo-slips') ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 24,
            paddingBottom: 95,
            zIndex: 16,
            pointerEvents: 'none',
          }}
        >
          {heroItems.slice(0, 7).map((label: string, pi: number) => {
            const sp = spring({ frame: Math.max(0, localFrame - pi * 3), fps, config: { damping: 13, stiffness: 165 } })
            const isActive = Math.floor(progress * Math.min(7, heroItems.length)) === pi
            const tiltDeg = (pi - Math.floor(Math.min(7, heroItems.length) / 2)) * 1.4
            return (
              <div
                key={pi}
                style={{
                  position: 'relative',
                  width: 116,
                  height: isActive ? 548 : 504,
                  borderRadius: 10,
                  background: isActive
                    ? \`linear-gradient(90deg, #C79B46 0%, #F4DA92 48%, #B28231 100%)\`
                    : \`linear-gradient(90deg, #2D2216 0%, #443322 50%, #1C140C 100%)\`,
                  border: \`2px solid \${isActive ? '#FFF9E6' : pal.accent + '77'}\`,
                  boxShadow: isActive ? \`0 28px 68px rgba(0,0,0,0.88), 0 0 42px \${pal.accent}66\` : '0 18px 42px rgba(0,0,0,0.75)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: interpolate(sp, [0, 1], [0, 1]),
                  transform: \`translateY(\${interpolate(sp, [0, 1], [-80, 0]).toFixed(1)}px) rotate(\${tiltDeg.toFixed(1)}deg) scale(\${isActive ? 1.05 : 1})\`,
                }}
              >
                {/* Dual Horizontal Hemp Bamboo Binding Cords */}
                <div style={{ position: 'absolute', top: 56, left: -14, right: -14, height: 6, background: 'rgba(138, 72, 28, 0.85)', boxShadow: '0 2px 4px rgba(0,0,0,0.6)' }} />
                <div style={{ position: 'absolute', bottom: 56, left: -14, right: -14, height: 6, background: 'rgba(138, 72, 28, 0.85)', boxShadow: '0 2px 4px rgba(0,0,0,0.6)' }} />
                <span
                  style={{
                    writingMode: 'vertical-rl',
                    fontFamily: FONT_SERIF,
                    fontSize: 42,
                    fontWeight: 900,
                    letterSpacing: 8,
                    color: isActive ? '#3D0F0B' : '#F6E2B0',
                    textShadow: isActive ? '0 1px 0 rgba(255,255,255,0.45)' : '0 3px 10px rgba(0,0,0,0.85)',
                  }}
                >
                  {String(label).slice(0, 6)}
                </span>
                {isActive ? (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 14,
                      width: 26,
                      height: 26,
                      borderRadius: 4,
                      background: '#B91C1C',
                      border: '1.5px solid #FDE68A',
                      color: '#FFFBEB',
                      fontFamily: FONT_SERIF,
                      fontSize: 15,
                      fontWeight: 900,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {resolvedBannerChar}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {/* 8. Classical Vertical Calligraphy & Red Chop Seal */}
      {Array.isArray(spec.calligraphy) && spec.calligraphy.length > 0 ? (
        <CalligraphyColumnPanel
          lines={spec.calligraphy}
          sealText={spec.sealText}
          frame={localFrame}
          fps={fps}
          pal={pal}
        />
      ) : null}

      {/* 9. Epic Banner Stamp for Channel Finale */}
      {archetype === 'channel-end' ? (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', paddingBottom: 150, pointerEvents: 'none' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: FONT_SERIF, fontSize: 108, fontWeight: 900, color: pal.accent, letterSpacing: 10, textShadow: '0 8px 32px rgba(0,0,0,0.96)' }}>
              {spec.headline || scene?.headline || scene?.title}
            </div>
            {spec.subheadline ? (
              <div style={{ fontFamily: FONT_SANS, fontSize: 28, fontWeight: 600, color: '#E2E8F0', marginTop: 18, letterSpacing: 4, textShadow: '0 4px 16px rgba(0,0,0,0.9)' }}>
                {spec.subheadline}
              </div>
            ) : null}
          </div>
        </AbsoluteFill>
      ) : null}

      {/* Subtle Bottom Film Shadow Gradient for Crisp Subtitle Legibility */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 220,
          background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.68) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Beat Cut Micro-Flash */}
      {flashAlpha > 0.01 ? (
        <AbsoluteFill style={{ backgroundColor: '#FFF6E8', opacity: flashAlpha, pointerEvents: 'none' }} />
      ) : null}
    </AbsoluteFill>
  )
}
`

export function writeNarrativeDioramaRemotionLib(projectDir) {
  const absDir = resolve(projectDir)
  const libDir = join(absDir, 'src', 'lib')
  mkdirSync(libDir, { recursive: true })
  const outPath = join(libDir, 'narrative-diorama.tsx')
  writeFileSync(outPath, NARRATIVE_DIORAMA_TSX_SOURCE, 'utf8')
  return outPath
}
