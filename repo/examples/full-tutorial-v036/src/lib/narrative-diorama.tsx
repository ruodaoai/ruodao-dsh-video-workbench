/**
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

const RAY_ANGLES = Array.from({ length: 18 }, (_, i) => -168 + i * 10.2)

const SkylineClouds: React.FC<{ progress: number; pal: DioramaMoodPalette }> = ({ progress, pal }) => (
  <g opacity={0.42}>
    {[
      { x: 180 + progress * 55, y: 165, w: 380, h: 42 },
      { x: 820 - progress * 48, y: 125, w: 520, h: 52 },
      { x: 1320 + progress * 36, y: 215, w: 340, h: 36 },
    ].map((c, ci) => (
      <g key={ci} transform={`translate(${c.x.toFixed(1)}, ${c.y})`}>
        <rect x={0} y={c.h * 0.4} width={c.w} height={c.h * 0.6} rx={c.h * 0.3} fill={pal.ridgeNear} opacity={0.55} />
        <ellipse cx={c.w * 0.3} cy={c.h * 0.4} rx={c.w * 0.24} ry={c.h * 0.38} fill={pal.skyBot} opacity={0.35} />
        <ellipse cx={c.w * 0.62} cy={c.h * 0.35} rx={c.w * 0.28} ry={c.h * 0.45} fill={pal.skyMid} opacity={0.45} />
        <line x1={12} y1={c.h * 0.96} x2={c.w - 12} y2={c.h * 0.96} stroke={pal.accent} strokeWidth={1} opacity={0.18} />
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
        <g key={ti} transform={`translate(${tx}, 185)`}>
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
            <g key={`${gi}-${side}`} transform={`translate(${gx.toFixed(1)}, ${y.toFixed(1)}) scale(${sc.toFixed(2)})`}>
              <line x1={side * 24} y1={-175} x2={side * 24} y2={0} stroke={pal.silhouette} strokeWidth={4} />
              <polygon points={`${side * 24},-194 ${side * 17},-166 ${side * 31},-166`} fill={pal.silhouette} />
              <polygon points={`${side * 24},-162 ${side * (side > 0 ? 4 : 44)},-142 ${side * 24},-132`} fill={pal.crimson} opacity={0.85} />
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
}> = ({ pal, frame, bannerChar = '楚', showBeacons = true, showArmy = true }) => (
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
        <g key={bi} transform={`translate(${bx}, 775)`}>
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
            d={`M-22,-32 Q-8,${(-92 * flicker).toFixed(1)} 0,${(-124 * flicker).toFixed(1)} Q12,${(-84 * flicker).toFixed(1)} 22,-32 Z`}
            fill={pal.crimson}
            opacity={0.9}
          />
          <path
            d={`M-12,-32 Q0,${(-95 * flicker).toFixed(1)} 12,-32 Z`}
            fill={pal.sunCore}
            opacity={0.92}
          />
        </g>
      )
    }) : null}

    {/* Horizon Soldier Phalanx & Banners */}
    {showArmy ? Array.from({ length: 24 }, (_, ai) => {
      const ax = 48 + ai * 80
      const hasFlag = ai % 4 === 1
      const sway = Math.sin(frame * 0.14 + ai) * 6
      return (
        <g key={ai} transform={`translate(${ax}, 855)`}>
          <line x1={14} y1={-110} x2={14} y2={0} stroke={pal.silhouette} strokeWidth={3} />
          <polygon points="14,-122 9,-104 19,-104" fill={pal.silhouette} />
          <circle cx={0} cy={-64} r={9} fill={pal.silhouette} />
          <path d="M-12,-54 L12,-54 L15,0 L-15,0 Z" fill={pal.silhouette} />
          {hasFlag ? (
            <g transform="translate(14, -108)">
              <path d={`M0,0 Q26,${sway.toFixed(1)} 52,4 L48,38 Q22,${(34 - sway * 0.5).toFixed(1)} 0,34 Z`} fill={pal.silhouette} stroke={pal.accent} strokeWidth={1.5} />
              <text x={24} y={25} textAnchor="middle" fill={pal.accent} fontFamily={FONT_SERIF} fontSize={20} fontWeight={900}>
                {bannerChar}
              </text>
            </g>
          ) : null}
        </g>
      )
    }) : null}
  </g>
)

const CityWallSetting: React.FC<{ pal: DioramaMoodPalette; frame: number; bannerChar?: string }> = ({ pal, frame, bannerChar = '楚' }) => (
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
        <g key={fi} transform={`translate(${fx}, 655)`}>
          <line x1={0} y1={-120} x2={0} y2={0} stroke={pal.silhouette} strokeWidth={4} />
          <path d={`M0,-118 Q44,${(-124 + wave).toFixed(1)} 88,-112 L80,-62 Q38,${(-68 - wave).toFixed(1)} 0,-68 Z`} fill={fi === 1 ? pal.crimson : pal.accent} opacity={0.9} />
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
    <g transform={`translate(${(1260 + Math.sin(progress * Math.PI) * 35).toFixed(1)}, 788)`}>
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
  const slashP = interpolate(progress, [0.12, 0.42], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutCubic })
  const burstFade = interpolate(progress, [0.18, 0.34, 0.85], [0, 1, 0.15], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <g>
      {/* Sweeping Crescent Blade Slash */}
      <path
        d={`M${cx - 320},${cy + 140} Q${cx + 40},${cy - 260} ${cx + 380},${cy + 90}`}
        fill="none"
        stroke={pal.sunCore}
        strokeWidth={18 * (1 - slashP * 0.45)}
        strokeLinecap="round"
        strokeDasharray={920}
        strokeDashoffset={920 * (1 - slashP)}
        opacity={0.92}
      />
      <path
        d={`M${cx - 300},${cy + 146} Q${cx + 40},${cy - 235} ${cx + 365},${cy + 94}`}
        fill="none"
        stroke={pal.crimson}
        strokeWidth={9}
        strokeLinecap="round"
        strokeDasharray={920}
        strokeDashoffset={920 * (1 - slashP)}
        opacity={0.85}
      />
      {/* Impact Burst Polygon */}
      {burstFade > 0.02 ? (
        <g transform={`translate(${cx}, ${cy - 30}) scale(${(0.65 + burstFade * 0.55).toFixed(2)})`} opacity={burstFade}>
          <polygon
            points={Array.from({ length: 16 }, (_, pi) => {
              const ang = (pi / 16) * Math.PI * 2 + seed * 0.3
              const rad = pi % 2 === 0 ? 155 : 52
              return `${(Math.cos(ang) * rad).toFixed(1)},${(Math.sin(ang) * rad).toFixed(1)}`
            }).join(' ')}
            fill={pal.crimson}
            opacity={0.85}
          />
          <circle cx={0} cy={0} r={42} fill={pal.sunCore} opacity={0.92} />
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
  headwear?: 'plume' | 'helmet' | 'crown'
  weapon?: 'halberd' | 'sword' | 'raised-arm'
  flip?: boolean
}> = ({ x, y, scale = 1, frame, progress = 0.5, beatPulse, pal, headwear = 'plume', weapon = 'halberd', flip = false }) => {
  const cloakWave = Math.sin(frame * 0.22) * 26 + beatPulse * 22
  const breathY = Math.sin(frame * 0.14) * 5 - beatPulse * 10
  const strideLean = Math.sin(progress * Math.PI) * 7 + beatPulse * 4
  const raiseY = weapon === 'raised-arm' ? -18 - Math.sin(Math.min(1, progress * 1.4) * Math.PI * 0.5) * 44 : Math.sin(frame * 0.12) * 8
  const swingAngle = weapon === 'sword'
    ? -42 + Math.sin(progress * Math.PI * 1.15) * 78 + beatPulse * 14
    : weapon === 'halberd'
      ? 14 - Math.sin(progress * Math.PI) * 26 - beatPulse * 8
      : -12
  return (
    <g transform={`translate(${x}, ${(y + breathY).toFixed(1)}) scale(${(flip ? -scale : scale).toFixed(2)}, ${scale.toFixed(2)}) rotate(${strideLean.toFixed(2)})`}>
      {/* Kinetic Ground Shadow & Speed Aura */}
      <ellipse cx={-4} cy={30} rx={68 + beatPulse * 16} ry={12} fill={pal.silhouette} opacity={0.55} />
      {/* Dynamic Billowing War Cloak */}
      <path
        d={`M-18,-230 C-82,-175 ${(-148 - cloakWave).toFixed(1)},-72 ${(-182 - cloakWave * 1.35).toFixed(1)},28 L52,26 C34,-65 26,-165 18,-230 Z`}
        fill={pal.silhouette}
        stroke={pal.accent}
        strokeWidth={2}
        strokeOpacity={0.42 + beatPulse * 0.35}
      />
      {/* Articulated Stride Legs */}
      <path d={`M-26,-10 L${(-48 - strideLean * 1.6).toFixed(1)},30 L-22,32 L-4,-8 Z`} fill={pal.silhouette} />
      <path d={`M16,-10 L${(44 + strideLean * 1.8).toFixed(1)},30 L64,28 L34,-10 Z`} fill={pal.silhouette} />
      {/* Plumed Helmet / Crown */}
      {headwear === 'plume' ? (
        <g transform="translate(0, -280)">
          <ellipse cx={0} cy={0} rx={22} ry={25} fill={pal.silhouette} />
          <path d="M-24,-14 C-12,-34 12,-34 24,-14 Z" fill={pal.silhouette} />
          {/* Twin Hero Pheasant Plumes sweeping dynamically */}
          <path d={`M-6,-28 Q-58,${(-92 - cloakWave * 0.45).toFixed(1)} ${(-104 - cloakWave * 0.3).toFixed(1)},${(-68 - cloakWave * 0.5).toFixed(1)}`} fill="none" stroke={pal.silhouette} strokeWidth={7} strokeLinecap="round" />
          <path d={`M4,-28 Q42,${(-96 - cloakWave * 0.35).toFixed(1)} ${(84 + cloakWave * 0.25).toFixed(1)},${(-72 - cloakWave * 0.4).toFixed(1)}`} fill="none" stroke={pal.silhouette} strokeWidth={7} strokeLinecap="round" />
        </g>
      ) : headwear === 'crown' ? (
        <g transform="translate(0, -282)">
          <ellipse cx={0} cy={0} rx={21} ry={24} fill={pal.silhouette} />
          <rect x={-38} y={-32} width={76} height={8} fill={pal.silhouette} />
          {[-30, -15, 0, 15, 30].map((lx, li) => (
            <line key={li} x1={lx} y1={-24} x2={lx} y2={-4} stroke={pal.silhouette} strokeWidth={2.5} />
          ))}
        </g>
      ) : (
        <g transform="translate(0, -280)">
          <ellipse cx={0} cy={0} rx={22} ry={25} fill={pal.silhouette} />
          <polygon points="-24,-10 0,-40 24,-10" fill={pal.silhouette} />
        </g>
      )}
      {/* Sculpted Torso Armor + Rim Highlight */}
      <path d="M-56,-242 L56,-242 L44,-130 L52,0 L-52,0 L-44,-130 Z" fill={pal.silhouette} stroke={pal.accent} strokeWidth={1.2} strokeOpacity={0.28 + beatPulse * 0.35} />
      {/* Leading Forearm + Articulated Weapon Swing */}
      {weapon === 'halberd' ? (
        <g transform={`translate(62, -165) rotate(${swingAngle.toFixed(1)})`}>
          <path d="M-16,12 L10,-4 L14,12 L-8,28 Z" fill={pal.silhouette} />
          <line x1={0} y1={-240} x2={0} y2={195} stroke={pal.silhouette} strokeWidth={8} />
          <polygon points="0,-288 -12,-232 12,-232" fill={pal.silhouette} stroke={pal.accent} strokeWidth={1.5} />
          <path d="M4,-232 C56,-220 66,-168 18,-154 C38,-178 32,-206 4,-214 Z" fill={pal.silhouette} />
        </g>
      ) : weapon === 'sword' ? (
        <g transform={`translate(52, ${(-195 + raiseY).toFixed(1)}) rotate(${swingAngle.toFixed(1)})`}>
          <line x1={0} y1={-225} x2={0} y2={35} stroke={pal.sunCore} strokeWidth={7} strokeLinecap="round" />
          <rect x={-20} y={10} width={40} height={8} fill={pal.accent} />
        </g>
      ) : (
        <g transform={`translate(48, ${(-210 + raiseY).toFixed(1)}) rotate(${(-18 + beatPulse * 14).toFixed(1)})`}>
          <path d="M0,0 L46,-96 L62,-86 L14,14 Z" fill={pal.silhouette} />
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
}> = ({ stageSpec, progress, beatPulse, pal }) => {
  const zones = Array.isArray(stageSpec?.zones) && stageSpec.zones.length > 0
    ? stageSpec.zones
    : [
        { name: '楚', x: 1060, y: 560, color: '#991B1B', r: 195 },
        { name: '秦', x: 540, y: 460, color: '#1F2937', r: 165 },
        { name: '汉', x: 640, y: 690, color: '#1E3A8A', r: 145 },
      ]
  const routes = Array.isArray(stageSpec?.routes) ? stageSpec.routes : []
  const stamps = Array.isArray(stageSpec?.stamps) ? stageSpec.stamps : []

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
              d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`}
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
                  <g transform={`translate(${mx.toFixed(1)}, ${(my - 14).toFixed(1)})`}>
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
          <g key={si} transform={`translate(${sx + 68}, ${sy - 44}) rotate(${si % 2 === 0 ? -6 : 5}) scale(${sc.toFixed(2)})`}>
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
              transform: `translateY(${interpolate(sp, [0, 1], [-24, 0]).toFixed(1)}px)`,
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

  const uid = `nd-${idx}`
  const sunX = Number(spec.sunX) || 960
  const sunY = Number(spec.sunY) || (archetype === 'hero-numeral' ? 565 : 530)
  const sunR = Number(spec.sunRadius) || (archetype === 'hero-numeral' ? 118 : 116)

  // Beat camera kick & cut shockwave shake
  const cutShakeX = localFrame < 8 ? Math.sin(localFrame * 3.7) * (8 - localFrame) * 1.4 : 0
  const cutShakeY = localFrame < 8 ? Math.cos(localFrame * 4.3) * (8 - localFrame) * 1.1 : 0
  const actionShake = (/slash|oath|cavalry/i.test(archetype) && isHitFrame) ? 9 : 0
  const camPanX = Math.sin(idx * 1.7 + progress * Math.PI) * 28
  const camPanY = Math.cos(idx * 2.1 + progress * Math.PI) * 10
  const camZoom = 1.02 + progress * 0.065 + pulse * 0.028 + strongPulse * 0.016

  const flashAlpha = scene?.transitionKind === 'flash-cut' || scene?.transition === 'flash-cut' || /slash/i.test(archetype)
    ? interpolate(localFrame, [0, 4], [0.46, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : interpolate(localFrame, [0, 3], [0.16, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  const heroItems = Array.isArray(spec.plaques) && spec.plaques.length > 0
    ? spec.plaques
    : Array.isArray(spec.slips) && spec.slips.length > 0
      ? spec.slips
      : archetype === 'plaque-summary'
        ? (Array.isArray(scene?.highlights) && scene.highlights.length > 0 ? scene.highlights : ['破釜沉舟', '巨鹿大捷', '西楚霸王', '鸿门风云', '垓下悲歌', '乌江绝唱'])
        : []

  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        background: pal.skyTop,
        transform: `translate(${(cutShakeX + actionShake + camPanX).toFixed(1)}px, ${(cutShakeY + camPanY).toFixed(1)}px) scale(${camZoom.toFixed(4)})`,
        transformOrigin: 'center center',
      }}
    >
      {archetype === 'strategic-map' ? (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" style={{ width: '100%', height: '100%', display: 'block' }}>
          <StrategicMapStage stageSpec={spec} progress={progress} beatPulse={pulse} pal={pal} />
        </svg>
      ) : (
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" style={{ width: '100%', height: '100%', display: 'block' }}>
          <defs>
            <linearGradient id={`sky-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={pal.skyTop} />
              <stop offset="52%" stopColor={pal.skyMid} />
              <stop offset="100%" stopColor={pal.skyBot} />
            </linearGradient>
            <radialGradient id={`sunGlow-${uid}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={pal.sunCore} stopOpacity={0.95} />
              <stop offset="45%" stopColor={pal.sunRim} stopOpacity={0.55} />
              <stop offset="100%" stopColor={pal.sunRim} stopOpacity={0} />
            </radialGradient>
          </defs>

          {/* 1. Atmosphere Sky Backdrop */}
          <rect x={0} y={0} width={1920} height={1080} fill={`url(#sky-${uid})`} />

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
              <g transform={`translate(${sunX}, ${sunY}) rotate(${(localFrame * 0.08).toFixed(2)})`} opacity={0.14 + pulse * 0.16}>
                {RAY_ANGLES.map((ang, ri) => (
                  <polygon
                    key={ri}
                    points="0,0 -34,-1280 34,-1280"
                    transform={`rotate(${ang})`}
                    fill={pal.sunCore}
                  />
                ))}
              </g>
              <circle cx={sunX} cy={sunY} r={sunR * (2.6 + pulse * 0.45)} fill={`url(#sunGlow-${uid})`} />
              <circle cx={sunX} cy={sunY} r={sunR * (1 + strongPulse * 0.06)} fill={pal.sunCore} opacity={0.96} />
            </g>
          ) : null}

          {/* Rolling Clouds */}
          <SkylineClouds progress={progress} pal={pal} />

          {/* 3. Hero Number Layer Behind Horizon Silhouette (hero-numeral archetype) */}
          {archetype === 'hero-numeral' && spec.heroNum ? (
            <g transform={`translate(960, ${interpolate(Math.min(1, localFrame / 18), [0, 1], [305, 320]).toFixed(1)}) scale(${(1 + strongPulse * 0.05).toFixed(3)})`}>
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
            <CityWallSetting pal={pal} frame={localFrame} bannerChar={spec.bannerChar || '楚'} />
          ) : setting === 'river-gorge' ? (
            <RiverGorgeSetting pal={pal} frame={localFrame} progress={progress} />
          ) : (
            <MountainCampSetting
              pal={pal}
              frame={localFrame}
              bannerChar={spec.bannerChar || '楚'}
              showBeacons={setting !== 'vast-plain'}
              showArmy={archetype !== 'channel-end' && archetype !== 'scroll-calligraphy'}
            />
          )}

          {/* 5. Archetype Action & Foreground Hero Silhouettes */}
          {archetype === 'hero-numeral' ? (
            <HeroWarriorFigure x={960} y={830} scale={0.9} frame={localFrame} progress={progress} beatPulse={pulse} pal={pal} headwear="plume" weapon="halberd" />
          ) : null}

          {archetype === 'hero-stand' ? (
            <HeroWarriorFigure
              x={Number(spec.heroX) || 540}
              y={860}
              scale={1.24}
              frame={localFrame}
              progress={progress}
              beatPulse={pulse}
              pal={pal}
              headwear={spec.headwear || 'plume'}
              weapon={spec.weapon || 'halberd'}
            />
          ) : null}

          {archetype === 'oath-break' ? (
            <g>
              {/* Burning Sunk Warships in River Horizon */}
              {[1360, 1620].map((bx, bi) => {
                const tilt = 14 + Math.sin(localFrame * 0.14 + bi) * 6
                return (
                  <g key={bi} transform={`translate(${bx}, 725) rotate(${tilt.toFixed(1)})`}>
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
              <HeroWarriorFigure x={620} y={845} scale={1.1} frame={localFrame} progress={progress} beatPulse={pulse} pal={pal} headwear="plume" weapon="raised-arm" />
              <SlashBurstOverlay progress={progress} pal={pal} cx={880} cy={635} seed={3} />
            </g>
          ) : null}

          {archetype === 'cavalry-rush' ? (
            <g>
              {[0, 1, 2, 3, 4].map((hi) => {
                const dir = hi % 2 === 0 ? 1 : -1
                const xPos = dir > 0 ? 180 + progress * 540 + hi * 290 : 1720 - progress * 520 - hi * 230
                const bob = Math.sin(localFrame * 0.48 + hi * 1.3) * 14
                return (
                  <g key={hi} transform={`translate(${xPos.toFixed(1)}, ${(785 + bob + hi * 10).toFixed(1)}) scale(${dir}, 1)`}>
                    <path d="M-85,-32 Q-25,-66 48,-46 L86,-88 L112,-76 L92,-48 L64,12 L88,42 L68,46 L38,8 L-48,10 L-88,42 L-104,34 L-70,0 Z" fill={pal.silhouette} />
                    <circle cx={-12} cy={-96} r={14} fill={pal.silhouette} />
                    <path d="M-28,-82 L8,-82 L12,-34 L-32,-34 Z" fill={pal.silhouette} />
                    <line x1={-25} y1={-62} x2={165} y2={-118} stroke={pal.silhouette} strokeWidth={5} />
                    <polygon points="165,-118 142,-124 146,-106" fill={pal.crimson} />
                  </g>
                )
              })}
              <SlashBurstOverlay progress={progress} pal={pal} cx={1040} cy={600} seed={idx + 2} />
            </g>
          ) : null}

          {archetype === 'slash-climax' ? (
            <g>
              <HeroWarriorFigure x={610} y={855} scale={1.18} frame={localFrame} progress={progress} beatPulse={pulse} pal={pal} headwear="plume" weapon="sword" />
              {[0, 1, 2].map((ei) => {
                const flyX = 1140 + ei * 180 + progress * (115 + ei * 45)
                const flyY = 670 - Math.sin(progress * Math.PI) * 110 + ei * 32
                const rot = progress * 52 + ei * 24
                return (
                  <g key={ei} transform={`translate(${flyX.toFixed(1)}, ${flyY.toFixed(1)}) rotate(${rot.toFixed(1)})`}>
                    <circle cx={0} cy={-55} r={13} fill={pal.silhouette} />
                    <path d="M-16,-40 L16,-40 L22,25 L-22,25 Z" fill={pal.silhouette} />
                  </g>
                )
              })}
              <SlashBurstOverlay progress={progress} pal={pal} cx={1020} cy={565} seed={idx + 7} />
            </g>
          ) : null}

          {archetype === 'duel-confront' ? (
            <g>
              <HeroWarriorFigure x={Math.round(480 + progress * 110)} y={855} scale={1.14} frame={localFrame} progress={progress} beatPulse={pulse} pal={pal} headwear="plume" weapon="sword" />
              <HeroWarriorFigure x={Math.round(1440 - progress * 110)} y={855} scale={1.14} frame={localFrame} progress={progress} beatPulse={pulse} pal={pal} headwear="helmet" weapon="halberd" flip={true} />
              <SlashBurstOverlay progress={progress} pal={pal} cx={960} cy={580} seed={9} />
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
              <HeroWarriorFigure x={720} y={855} scale={1.12} frame={localFrame} progress={progress} beatPulse={pulse} pal={pal} headwear="plume" weapon="halberd" />
              <g transform={`translate(1150, 850) rotate(${(Math.sin(localFrame * 0.08) * 6).toFixed(1)})`}>
                <ellipse cx={0} cy={-235} rx={15} ry={18} fill={pal.silhouette} />
                <path d="M-24,-214 L24,-214 L48,10 L-42,10 Z" fill={pal.silhouette} />
                <path d="M-26,-190 Q-85,-140 -105,-90" fill="none" stroke={pal.silhouette} strokeWidth={12} strokeLinecap="round" />
                <line x1={32} y1={-190} x2={125} y2={-265} stroke={pal.sunCore} strokeWidth={4.5} />
              </g>
            </g>
          ) : null}

          {archetype === 'scroll-calligraphy' ? (
            <HeroWarriorFigure x={420} y={855} scale={1.15} frame={localFrame} progress={progress} beatPulse={pulse} pal={pal} headwear="plume" weapon="halberd" />
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
                r={em.r * (1 + pulse * 0.35)}
                fill={ei % 3 === 0 ? pal.crimson : pal.sunCore}
                opacity={em.alpha}
              />
            )
          })}
        </svg>
      )}

      {/* 7. Bamboo Slips / Commemorative Plaques Array Overlay */}
      {(archetype === 'scroll-calligraphy' || archetype === 'plaque-summary') ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 28,
            paddingBottom: 90,
            zIndex: 16,
            pointerEvents: 'none',
          }}
        >
          {heroItems.slice(0, 7).map((label: string, pi: number) => {
            const sp = spring({ frame: Math.max(0, localFrame - pi * 4), fps, config: { damping: 14, stiffness: 155 } })
            const isActive = Math.floor(progress * Math.min(7, heroItems.length)) === pi
            return (
              <div
                key={pi}
                style={{
                  width: 112,
                  height: isActive ? 540 : 495,
                  borderRadius: 12,
                  background: isActive
                    ? `linear-gradient(180deg, #E8C77B 0%, #B88B3A 100%)`
                    : `linear-gradient(180deg, #272017 0%, #120E0A 100%)`,
                  border: `2px solid ${isActive ? '#FFF7DC' : pal.accent + '66'}`,
                  boxShadow: isActive ? `0 24px 64px rgba(0,0,0,0.85), 0 0 36px ${pal.accent}55` : '0 18px 42px rgba(0,0,0,0.72)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: interpolate(sp, [0, 1], [0, 1]),
                  transform: `translateY(${interpolate(sp, [0, 1], [60, 0]).toFixed(1)}px) scale(${isActive ? 1.04 : 1})`,
                }}
              >
                <span
                  style={{
                    writingMode: 'vertical-rl',
                    fontFamily: FONT_SERIF,
                    fontSize: 42,
                    fontWeight: 900,
                    letterSpacing: 8,
                    color: isActive ? '#3D0F0B' : '#F3DFAC',
                  }}
                >
                  {String(label).slice(0, 6)}
                </span>
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
