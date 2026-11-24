/**
 * @dsh-video/shotcraft — Reusable Remotion Motion Primitives
 * Adapted from Apache-2.0 open-source video-shotcraft & remotion-dev/skills patterns.
 * Strictly driven by useCurrentFrame() + spring() + interpolate() — zero CSS transition / keyframes.
 */
import React from 'react'
import {
  AbsoluteFill,
  Easing,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'

export const FONT_SANS = "'Noto Sans SC', 'Source Han Sans SC', 'PingFang SC', 'HarmonyOS Sans SC', sans-serif"
export const FONT_SERIF = "'Source Han Serif SC Heavy', 'Noto Serif SC', 'Noto Sans SC', serif"
export const FONT_MONO = "'JetBrains Mono', 'Cascadia Mono', 'Liberation Mono', ui-monospace, monospace"

export interface PageCamProps {
  children: React.ReactNode
  startFrame?: number
  durationFrames?: number
  fromScale?: number
  toScale?: number
  fromX?: number
  toX?: number
  fromY?: number
  toY?: number
  tiltDeg?: number
}

export const PageCam: React.FC<PageCamProps> = ({
  children,
  startFrame = 0,
  durationFrames = 90,
  fromScale = 1.06,
  toScale = 1.0,
  fromX = 0,
  toX = 0,
  fromY = 18,
  toY = 0,
  tiltDeg = 0,
}) => {
  const frame = useCurrentFrame()
  const progress = interpolate(
    frame,
    [startFrame, startFrame + Math.max(1, durationFrames)],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  const eased = 1 - Math.pow(1 - progress, 3)
  const scale = fromScale + (toScale - fromScale) * eased
  const x = fromX + (toX - fromX) * eased
  const y = fromY + (toY - fromY) * eased
  const tilt = tiltDeg * (1 - eased)

  return (
    <AbsoluteFill
      style={{
        transform: `perspective(1400px) translate3d(${x}px, ${y}px, 0) scale(${scale}) rotateX(${tilt}deg)`,
        transformOrigin: 'center center',
      }}
    >
      {children}
    </AbsoluteFill>
  )
}

export interface ClipCardProps {
  children: React.ReactNode
  delay?: number
  fromY?: number
  tiltDeg?: number
  accentColor?: string
  bg?: string
  borderColor?: string
  padding?: number | string
  borderRadius?: number
  style?: React.CSSProperties
}

export const ClipCard: React.FC<ClipCardProps> = ({
  children,
  delay = 0,
  fromY = 36,
  tiltDeg = -2,
  accentColor = '#38BDF8',
  bg = 'rgba(15, 23, 42, 0.78)',
  borderColor = 'rgba(255, 255, 255, 0.14)',
  padding = 28,
  borderRadius = 20,
  style = {},
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const spr = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: { damping: 14, stiffness: 150, mass: 0.9 },
  })
  const y = interpolate(spr, [0, 1], [fromY, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const opacity = interpolate(spr, [0, 0.35], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const rot = interpolate(spr, [0, 1], [tiltDeg, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const scale = interpolate(spr, [0, 1], [0.94, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius,
        padding,
        boxShadow: `0 24px 64px rgba(0, 0, 0, 0.45), 0 0 0 1px ${accentColor}22 inset`,
        opacity,
        transform: `translate3d(0, ${y}px, 0) scale(${scale}) rotate(${rot}deg)`,
        fontFamily: FONT_SANS,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export interface DigitRollProps {
  from?: number
  to: number
  startFrame?: number
  durationFrames?: number
  prefix?: string
  suffix?: string
  decimals?: number
  color?: string
  fontSize?: number
  style?: React.CSSProperties
}

export const DigitRoll: React.FC<DigitRollProps> = ({
  from = 0,
  to,
  startFrame = 4,
  durationFrames = 36,
  prefix = '',
  suffix = '',
  decimals = 0,
  color = '#F8FAFC',
  fontSize = 68,
  style = {},
}) => {
  const frame = useCurrentFrame()
  const progress = interpolate(
    frame,
    [startFrame, startFrame + Math.max(1, durationFrames)],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  const eased = 1 - Math.pow(1 - progress, 4)
  const val = from + (to - from) * eased
  const formatted = decimals > 0 ? val.toFixed(decimals) : Math.round(val).toLocaleString('en-US')

  return (
    <span
      style={{
        fontFamily: FONT_MONO,
        fontWeight: 800,
        fontSize,
        color,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '-0.02em',
        ...style,
      }}
    >
      {prefix}
      {formatted}
      {suffix}
    </span>
  )
}

export interface FlashCutProps {
  atFrame?: number
  durationFrames?: number
  color?: string
  mode?: 'flash' | 'wipe' | 'iris'
}

export const FlashCut: React.FC<FlashCutProps> = ({
  atFrame = 0,
  durationFrames = 10,
  color = '#FFFFFF',
  mode = 'flash',
}) => {
  const frame = useCurrentFrame()
  const local = frame - atFrame
  if (local < 0 || local > durationFrames) return null

  const t = local / Math.max(1, durationFrames)
  if (mode === 'wipe') {
    const x = interpolate(t, [0, 0.5, 1], [-100, 0, 100], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
    return (
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background: `linear-gradient(90deg, transparent, ${color}CC, transparent)`,
          transform: `translateX(${x}%)`,
          zIndex: 80,
        }}
      />
    )
  }

  const opacity = t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75
  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        backgroundColor: color,
        opacity: Math.max(0, Math.min(0.65, opacity * 0.65)),
        zIndex: 80,
      }}
    />
  )
}

export interface SubtitleCue {
  index?: number
  text: string
  startFrame: number
  endFrame: number
}

export interface ShotCaptionProps {
  subtitles?: SubtitleCue[]
  frameOffset?: number
  accentColor?: string
  isPortrait?: boolean
  bottomPx?: number
}

export const ShotCaption: React.FC<ShotCaptionProps> = ({
  subtitles = [],
  frameOffset = 0,
  accentColor = '#38BDF8',
  isPortrait = false,
  bottomPx,
}) => {
  const frame = useCurrentFrame()
  const { height } = useVideoConfig()
  const globalFrame = frame + frameOffset
  const active = subtitles.find((s) => globalFrame >= s.startFrame && globalFrame <= s.endFrame)
  if (!active || !active.text) return null

  const enter = interpolate(globalFrame, [active.startFrame, active.startFrame + 4], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const resolvedBottom =
    typeof bottomPx === 'number' && bottomPx > 0
      ? bottomPx
      : isPortrait
        ? Math.round(height * 0.22)
        : Math.round(height * 0.13)

  return (
    <div
      style={{
        position: 'absolute',
        left: '6%',
        right: '6%',
        bottom: resolvedBottom,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 60,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 8}px)`,
      }}
    >
      <div
        style={{
          maxWidth: isPortrait ? '92%' : '76%',
          padding: isPortrait ? '12px 22px' : '11px 28px',
          borderRadius: 14,
          background: 'rgba(8, 12, 20, 0.84)',
          border: `1px solid ${accentColor}55`,
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
          color: '#F8FAFC',
          fontFamily: FONT_SANS,
          fontSize: isPortrait ? 34 : 30,
          fontWeight: 700,
          lineHeight: 1.35,
          textAlign: 'center',
          letterSpacing: '0.02em',
        }}
      >
        {active.text}
      </div>
    </div>
  )
}

export interface AIBadgeProps {
  visible?: boolean
  text?: string
  accentColor?: string
}

export const AIBadge: React.FC<AIBadgeProps> = ({
  visible = true,
  text = 'AI 辅助创作',
  accentColor = '#38BDF8',
}) => {
  const { width, height } = useVideoConfig()
  const isPortrait = width < height
  if (!visible) return null
  return (
    <div
      style={{
        position: 'absolute',
        top: isPortrait ? Math.round(height * 0.088) : 22,
        left: 26,
        zIndex: 70,
        padding: isPortrait ? '4px 11px' : '5px 13px',
        borderRadius: 999,
        background: 'rgba(10, 14, 24, 0.72)',
        border: `1px solid ${accentColor}55`,
        color: '#E2E8F0',
        fontFamily: FONT_SANS,
        fontSize: isPortrait ? 13 : 15,
        fontWeight: 600,
        letterSpacing: '0.03em',
        backdropFilter: 'blur(6px)',
      }}
    >
      {text}
    </div>
  )
}

export interface HotspotMarkItem {
  fx?: number
  fy?: number
  fw?: number
  fh?: number
  x?: number
  y?: number
  w?: number
  h?: number
  style?: string
  label?: string
  tone?: 'accent' | 'gold'
  shape?: 'box' | 'ring'
  startFrame?: number
}

export interface CamKeyframe {
  t: number
  fx: number
  fy: number
  z: number
}

export const AppWindow: React.FC<{
  title?: string
  kicker?: string
  brandMark?: string
  accentColor?: string
  goldColor?: string
  theme?: 'dark' | 'light'
  style?: React.CSSProperties
  children?: React.ReactNode
}> = ({
  title = '',
  kicker = '',
  brandMark = '',
  accentColor = '#45D1B2',
  goldColor = '#F6BA6F',
  theme = 'dark',
  style = {},
  children,
}) => {
  const isLight = theme === 'light'
  const cleanLogo = brandMark ? brandMark.replace(/^\.?[\\/]+/, '').replace(/\\/g, '/') : ''
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 18,
        overflow: 'hidden',
        background: isLight ? '#F8FAFC' : '#0B1514',
        border: `1.5px solid ${accentColor}55`,
        boxShadow: `0 32px 84px rgba(0,0,0,0.62), 0 0 0 1px rgba(255,255,255,0.08) inset`,
        ...style,
      }}
    >
      <div
        style={{
          height: 40,
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: isLight ? 'rgba(226,232,240,0.92)' : 'rgba(13,26,25,0.95)',
          borderBottom: isLight ? '1px solid rgba(15,23,42,0.1)' : `1px solid ${accentColor}26`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 7 }}>
            <span style={{ width: 11, height: 11, borderRadius: 99, background: '#FF5F56' }} />
            <span style={{ width: 11, height: 11, borderRadius: 99, background: '#FFBD2E' }} />
            <span style={{ width: 11, height: 11, borderRadius: 99, background: '#27C93F' }} />
          </div>
          {cleanLogo ? (
            <Img src={staticFile(cleanLogo)} style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'cover', marginLeft: 4 }} />
          ) : null}
          {title ? (
            <span
              style={{
                fontFamily: FONT_SANS,
                fontSize: 14,
                fontWeight: 700,
                color: isLight ? '#0F172A' : '#E2E8F0',
                letterSpacing: '0.02em',
              }}
            >
              {title}
            </span>
          ) : null}
        </div>
        {kicker ? (
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 12,
              fontWeight: 700,
              color: goldColor,
              padding: '3px 10px',
              borderRadius: 999,
              background: isLight ? 'rgba(15,23,42,0.07)' : `rgba(255,255,255,0.06)`,
            }}
          >
            {kicker}
          </span>
        ) : null}
      </div>
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden', background: isLight ? '#FFFFFF' : '#081110' }}>
        {children}
      </div>
    </div>
  )
}

export const HotspotMark: React.FC<{
  item: HotspotMarkItem
  accentColor?: string
  goldColor?: string
}> = ({ item, accentColor = '#45D1B2', goldColor = '#F6BA6F' }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const startF = Math.max(0, Number(item.startFrame || 6))
  const sp = spring({ frame: Math.max(0, frame - startF), fps, config: { damping: 14, stiffness: 200 } })
  if (frame < startF) return null
  const col = item.tone === 'gold' ? goldColor : accentColor
  const pulse = 0.72 + 0.28 * Math.sin((frame - startF) * 0.22)
  const wPct = Math.max(3, Number(item.fw ?? item.w ?? 0.18) * 100)
  const hPct = Math.max(3, Number(item.fh ?? item.h ?? 0.12) * 100)
  const rawL = item.fx == null && item.x != null ? Number(item.x) * 100 : Number(item.fx ?? 0.5) * 100 - wPct / 2
  const rawT = item.fy == null && item.y != null ? Number(item.y) * 100 : Number(item.fy ?? 0.5) * 100 - hPct / 2
  const lPct = Math.max(0, Math.min(100 - wPct, rawL))
  const tPct = Math.max(0, Math.min(100 - hPct, rawT))
  const placeBelow = tPct < 14
  return (
    <div
      style={{
        position: 'absolute',
        left: `${lPct.toFixed(2)}%`,
        top: `${tPct.toFixed(2)}%`,
        width: `${wPct.toFixed(2)}%`,
        height: `${hPct.toFixed(2)}%`,
        borderRadius: item.shape === 'ring' ? 999 : 12,
        border: `2.5px solid ${col}`,
        boxShadow: `0 0 0 4px rgba(0,0,0,0.35), 0 0 24px ${col}88`,
        opacity: interpolate(sp, [0, 1], [0, pulse]),
        transform: `scale(${interpolate(sp, [0, 1], [1.18, 1])})`,
        pointerEvents: 'none',
        zIndex: 15,
      }}
    >
      {item.label ? (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            ...(placeBelow ? { top: 'calc(100% + 8px)' } : { bottom: 'calc(100% + 8px)' }),
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            padding: '5px 12px',
            borderRadius: 999,
            background: 'rgba(6, 14, 14, 0.92)',
            border: `1.5px solid ${col}`,
            color: '#F8FAFC',
            fontFamily: FONT_SANS,
            fontSize: 16,
            fontWeight: 800,
            boxShadow: '0 8px 20px rgba(0,0,0,0.55)',
          }}
        >
          {item.label}
        </div>
      ) : null}
    </div>
  )
}

export const FocusShot: React.FC<{
  src: string
  cams?: CamKeyframe[]
  marks?: HotspotMarkItem[]
  mediaWidth?: number
  mediaHeight?: number
  fitMode?: 'contain' | 'cover'
  accentColor?: string
  goldColor?: string
}> = ({
  src,
  cams = [],
  marks = [],
  mediaWidth = 0,
  mediaHeight = 0,
  fitMode = 'contain',
  accentColor = '#45D1B2',
  goldColor = '#F6BA6F',
}) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const cleanRel = String(src || '').replace(/^\.?[\\/]+/, '').replace(/\\/g, '/')
  const p = Math.min(1, frame / Math.max(1, durationInFrames - 1))
  const normKey = (rawKey: any, idx: number, totalLen: number) => {
    const r = rawKey || {}
    const tVal = Number.isFinite(Number(r.t))
      ? Number(r.t)
      : Number.isFinite(Number(r.at))
        ? Number(r.at)
        : idx / Math.max(1, totalLen - 1)
    const fxVal = Number.isFinite(Number(r.fx))
      ? Number(r.fx)
      : Number.isFinite(Number(r.x))
        ? Number(r.x)
        : 0.5
    const fyVal = Number.isFinite(Number(r.fy))
      ? Number(r.fy)
      : Number.isFinite(Number(r.y))
        ? Number(r.y)
        : 0.5
    const zVal = Number.isFinite(Number(r.z))
      ? Number(r.z)
      : Number.isFinite(Number(r.s))
        ? Number(r.s)
        : 1.0
    return { t: tVal, fx: fxVal, fy: fyVal, z: Math.max(0.5, zVal) }
  }
  const rawArr = Array.isArray(cams) ? cams.map((k, ki) => normKey(k, ki, cams.length)) : []
  const keys = rawArr.length >= 2
    ? [...rawArr].sort((a, b) => a.t - b.t)
    : rawArr.length === 1
      ? [rawArr[0], { ...rawArr[0], t: 1 }]
      : [{ t: 0, fx: 0.5, fy: 0.5, z: 1.0 }, { t: 1, fx: 0.5, fy: 0.5, z: 1.06 }]

  let fx = keys[0].fx
  let fy = keys[0].fy
  let z = keys[0].z
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (p >= a.t && p <= b.t) {
      const local = (p - a.t) / Math.max(0.001, b.t - a.t)
      const ease = local * local * (3 - 2 * local)
      fx = a.fx + (b.fx - a.fx) * ease
      fy = a.fy + (b.fy - a.fy) * ease
      z = a.z + (b.z - a.z) * ease
      break
    }
    if (p > b.t) {
      fx = b.fx; fy = b.fy; z = b.z
    }
  }
  const tx = Math.max(1 - z, Math.min(0, 0.5 - fx * z)) * 100
  const ty = Math.max(1 - z, Math.min(0, 0.5 - fy * z)) * 100
  const isVid = /\.(mp4|mov|webm|mkv)$/i.test(cleanRel)
  const hasAspect = Number(mediaWidth) > 0 && Number(mediaHeight) > 0
  const stageStyle: React.CSSProperties = hasAspect
    ? {
        position: 'relative',
        aspectRatio: `${Number(mediaWidth)} / ${Number(mediaHeight)}`,
        maxWidth: '100%',
        maxHeight: '100%',
        height: '100%',
        width: 'auto',
        margin: 'auto',
        transformOrigin: '0 0',
        transform: `translate(${tx.toFixed(3)}%, ${ty.toFixed(3)}%) scale(${z.toFixed(4)})`,
      }
    : {
        position: 'relative',
        width: '100%',
        height: '100%',
        transformOrigin: '0 0',
        transform: `translate(${tx.toFixed(3)}%, ${ty.toFixed(3)}%) scale(${z.toFixed(4)})`,
      }
  const imgFit = hasAspect ? 'fill' : fitMode

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <div style={stageStyle}>
        {cleanRel ? (
          isVid ? (
            <OffthreadVideo src={staticFile(cleanRel)} style={{ width: '100%', height: '100%', objectFit: imgFit }} muted />
          ) : (
            <Img src={staticFile(cleanRel)} style={{ width: '100%', height: '100%', objectFit: imgFit }} />
          )
        ) : null}
        {(marks || []).map((m, mi) => (
          <HotspotMark key={mi} item={m} accentColor={accentColor} goldColor={goldColor} />
        ))}
      </div>
    </div>
  )
}

export const WorkflowBar: React.FC<{
  steps?: string[]
  activeStep?: number
  sectionLabel?: string
  accentColor?: string
  goldColor?: string
}> = ({ steps = [], activeStep = 0, sectionLabel = '', accentColor = '#45D1B2', goldColor = '#F6BA6F' }) => {
  const { width, height } = useVideoConfig()
  const isPortrait = width < height
  if (!steps.length && !sectionLabel) return null
  return (
    <div
      style={{
        position: 'absolute',
        top: isPortrait ? Math.round(height * 0.042) : 22,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: isPortrait ? 6 : 10,
        padding: isPortrait ? '6px 14px' : '7px 18px',
        borderRadius: 999,
        background: 'rgba(8, 16, 15, 0.82)',
        border: `1px solid ${accentColor}44`,
        boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
        zIndex: 68,
        pointerEvents: 'none',
      }}
    >
      {steps.map((st, si) => {
        const isActive = si === activeStep
        const isDone = si < activeStep
        return (
          <div key={si} style={{ display: 'flex', alignItems: 'center', gap: isPortrait ? 6 : 8 }}>
            <span
              style={{
                padding: '3px 10px',
                borderRadius: 999,
                background: isActive ? `linear-gradient(90deg, ${accentColor}, ${goldColor})` : isDone ? `${accentColor}24` : 'transparent',
                color: isActive ? '#061211' : isDone ? accentColor : '#94A3B8',
                fontFamily: FONT_SANS,
                fontSize: isPortrait ? 14 : 15,
                fontWeight: isActive ? 900 : 700,
              }}
            >
              {st}
            </span>
            {si < steps.length - 1 ? <span style={{ color: 'rgba(255,255,255,0.22)', fontSize: 13 }}>›</span> : null}
          </div>
        )
      })}
      {sectionLabel ? (
        <span style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 700, color: goldColor, marginLeft: steps.length ? 8 : 0 }}>
          {sectionLabel}
        </span>
      ) : null}
    </div>
  )
}

export const BeforeAfterWipe: React.FC<{
  beforeSrc: string
  afterSrc: string
  beforeLabel?: string
  afterLabel?: string
  accentColor?: string
  goldColor?: string
}> = ({ beforeSrc, afterSrc, beforeLabel = 'MODE A', afterLabel = 'MODE B', accentColor = '#45D1B2', goldColor = '#F6BA6F' }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const p = Math.min(1, frame / Math.max(1, durationInFrames - 1))
  const split = 0.5 + 0.34 * Math.sin(p * Math.PI * 2 - Math.PI / 2)
  const bRel = String(beforeSrc || '').replace(/^\.?[\\/]+/, '').replace(/\\/g, '/')
  const aRel = String(afterSrc || '').replace(/^\.?[\\/]+/, '').replace(/\\/g, '/')
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#07100F' }}>
      {bRel ? <Img src={staticFile(bRel)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} /> : null}
      {aRel ? (
        <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 0 0 ${(split * 100).toFixed(2)}%)` }}>
          <Img src={staticFile(aRel)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
      ) : null}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${(split * 100).toFixed(2)}%`,
          width: 3,
          background: `linear-gradient(180deg, ${accentColor}, ${goldColor})`,
          boxShadow: `0 0 18px ${accentColor}`,
          transform: 'translateX(-1.5px)',
          zIndex: 10,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 36,
            height: 36,
            borderRadius: 999,
            background: '#081312',
            border: `2px solid ${goldColor}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#F8FAFC',
            fontFamily: FONT_MONO,
            fontSize: 13,
            fontWeight: 900,
          }}
        >
          ⇆
        </div>
      </div>
      <div style={{ position: 'absolute', top: 18, left: 18, padding: '6px 14px', borderRadius: 999, background: 'rgba(6,14,14,0.88)', border: `1px solid ${accentColor}88`, color: accentColor, fontFamily: FONT_SANS, fontSize: 16, fontWeight: 800, zIndex: 12 }}>
        {beforeLabel}
      </div>
      <div style={{ position: 'absolute', top: 18, right: 18, padding: '6px 14px', borderRadius: 999, background: 'rgba(6,14,14,0.88)', border: `1px solid ${goldColor}88`, color: goldColor, fontFamily: FONT_SANS, fontSize: 16, fontWeight: 800, zIndex: 12 }}>
        {afterLabel}
      </div>
    </div>
  )
}

export const MetricPanel: React.FC<{
  label: string
  value: number
  suffix?: string
  subLabel?: string
  gridCount?: number
  accentColor?: string
  goldColor?: string
}> = ({ label, value, suffix = '', subLabel = '', gridCount = 20, accentColor = '#45D1B2', goldColor = '#F6BA6F' }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const p = interpolate(frame, [6, Math.min(durationInFrames - 8, 52)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const eased = 1 - Math.pow(1 - p, 3)
  const lit = Math.round(eased * gridCount)
  return (
    <div style={{ background: 'rgba(10, 22, 21, 0.88)', border: `1.5px solid ${accentColor}44`, borderRadius: 20, padding: 26, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: FONT_SANS, fontSize: 20, fontWeight: 800, color: '#E2E8F0' }}>{label}</span>
        {subLabel ? <span style={{ fontFamily: FONT_MONO, fontSize: 14, color: goldColor, fontWeight: 700 }}>{subLabel}</span> : null}
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 56, fontWeight: 900, color: accentColor, lineHeight: 1.05 }}>
        <DigitRoll from={0} to={value} suffix={suffix} startFrame={6} durationFrames={46} color={accentColor} fontSize={56} />
      </div>
      <div style={{ height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${(eased * 100).toFixed(1)}%`, background: `linear-gradient(90deg, ${accentColor}, ${goldColor})` }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 6 }}>
        {Array.from({ length: gridCount }, (_, gi) => (
          <div
            key={gi}
            style={{
              height: 14,
              borderRadius: 4,
              background: gi < lit ? (gi % 4 === 0 ? goldColor : accentColor) : 'rgba(255,255,255,0.08)',
              opacity: gi < lit ? 0.92 : 0.45,
            }}
          />
        ))}
      </div>
    </div>
  )
}

export interface EndNoticeProps {
  text?: string
  accentColor?: string
  tailSeconds?: number
}

export const EndNotice: React.FC<EndNoticeProps> = ({
  text = '本片画面与配乐由 DeepSeek Harness AI 编程辅助生成 · 语音由 IndexTTS-2.5 合成',
  accentColor = '#38BDF8',
  tailSeconds = 2.2,
}) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width, height } = useVideoConfig()
  const tailFrames = Math.max(12, Math.round(fps * tailSeconds))
  const startF = Math.max(0, durationInFrames - tailFrames)
  if (frame < startF) return null

  const alpha = interpolate(frame, [startF, startF + 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const isPortrait = width < height

  return (
    <div
      style={{
        position: 'absolute',
        left: '6%',
        right: '6%',
        bottom: isPortrait ? Math.round(height * 0.20) : Math.round(height * 0.036),
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        opacity: alpha,
        zIndex: 75,
      }}
    >
      <div
        style={{
          padding: isPortrait ? '4px 14px' : '5px 16px',
          borderRadius: 999,
          background: 'rgba(6, 10, 18, 0.84)',
          border: `1px solid ${accentColor}44`,
          color: '#CBD5E1',
          fontFamily: FONT_SANS,
          fontSize: isPortrait ? 13 : 14,
          fontWeight: 600,
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
          maxWidth: '92%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textAlign: 'center',
        }}
      >
        {text}
      </div>
    </div>
  )
}

export interface AvatarOverlayProps {
  clipPath?: string
  layout?: 'fullscreen' | 'pip-bl' | 'pip-br' | 'off' | string
  accentColor?: string
  muted?: boolean
}

export const AvatarOverlay: React.FC<AvatarOverlayProps> = ({
  clipPath,
  layout = 'pip-br',
  accentColor = '#22D3EE',
  muted = true,
}) => {
  const { width, height } = useVideoConfig()
  if (!clipPath || layout === 'off') return null
  const isPortrait = width < height
  const cleanRel = String(clipPath).replace(/^\.?[\\/]+/, '').replace(/\\/g, '/')

  if (layout === 'fullscreen') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 25, justifyContent: 'flex-end', alignItems: 'center' }}>
        <OffthreadVideo
          src={staticFile(cleanRel)}
          transparent
          muted={muted}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </AbsoluteFill>
    )
  }

  const boxWidth = isPortrait ? Math.round(width * 0.34) : Math.round(width * 0.22)
  const boxHeight = Math.round(boxWidth * 1.125)
  const sidePx = isPortrait ? 28 : 42
  const bottomPx = isPortrait ? Math.round(height * 0.25) : 96

  return (
    <div
      style={{
        position: 'absolute',
        bottom: bottomPx,
        left: layout === 'pip-bl' ? sidePx : undefined,
        right: layout === 'pip-bl' ? undefined : sidePx,
        width: boxWidth,
        height: boxHeight,
        borderRadius: 20,
        overflow: 'hidden',
        border: `1.5px solid ${accentColor}55`,
        background: 'rgba(6, 10, 18, 0.28)',
        boxShadow: `0 18px 46px rgba(0,0,0,0.55), 0 0 24px ${accentColor}22`,
        pointerEvents: 'none',
        zIndex: 35,
      }}
    >
      <OffthreadVideo
        src={staticFile(cleanRel)}
        transparent
        muted={muted}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </div>
  )
}

// =========================================================================
// Universal Beat-Sync, Camera, Vector-Path & Transition Primitives
// Usable across ANY genre: product UI, science/math, brand ads, story MV.
// =========================================================================

const easeOutFast = Easing.bezier(0.22, 1, 0.36, 1)

export function computeBeatPulse(absTimeSec: number, beats: any[] = []): { pulse: number; strongPulse: number; isHitFrame: boolean } {
  if (!Array.isArray(beats) || beats.length === 0) return { pulse: 0, strongPulse: 0, isHitFrame: false }
  let pulse = 0
  let strongPulse = 0
  let isHitFrame = false
  for (let i = 0; i < beats.length; i++) {
    const raw = beats[i]
    const bt = typeof raw === 'number' ? raw : Number(raw?.time)
    if (!Number.isFinite(bt)) continue
    const dt = absTimeSec - bt
    if (dt >= -0.017 && dt < 0.35) {
      const c = Math.max(0, dt)
      const val = Math.exp(-c * 10.5)
      if (val > pulse) pulse = val
      const strong = typeof raw === 'object' ? Boolean(raw?.strong) : i % 4 === 0
      if (strong && val > strongPulse) strongPulse = val
      if (c < 0.065) isHitFrame = true
    }
  }
  return { pulse, strongPulse, isHitFrame }
}

const TX_BLOCK_CELLS = Array.from({ length: 24 }, (_, idx) => ({
  col: idx % 6,
  row: Math.floor(idx / 6),
  delay: (idx * 3) % 6,
}))

export interface SceneTransitionOverlayProps {
  txKind?: string
  localFrame: number
  dur: number
  accentColor?: string
  goldColor?: string
  bgColor?: string
}

export const SceneTransitionOverlay: React.FC<SceneTransitionOverlayProps> = ({
  txKind = 'cut',
  localFrame,
  dur,
  accentColor = '#38BDF8',
  goldColor = '#F59E0B',
  bgColor = '#070B16',
}) => {
  const { width, height } = useVideoConfig()
  const safeDur = Math.max(8, dur)
  if (!txKind || txKind === 'cut') return null
  const inEnd = Math.min(16, Math.max(6, Math.round(safeDur * 0.45)))
  const outStart = Math.max(inEnd, safeDur - 5)
  if (localFrame > inEnd && localFrame < outStart) return null

  const enterT = interpolate(localFrame, [0, inEnd], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOutFast })
  const exitFlash = localFrame >= outStart ? interpolate(localFrame, [outStart, safeDur], [0, 0.36], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0
  const maxDim = Math.max(width, height)

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 28 }}>
      {txKind === 'flash-cut' && localFrame < Math.min(9, inEnd) ? (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at center, #FFFFFF 0%, ${goldColor}88 45%, transparent 80%)`,
            opacity: interpolate(localFrame, [0, Math.min(9, inEnd)], [0.88, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          }}
        />
      ) : null}

      {txKind === 'slash-wipe' && localFrame < inEnd ? (
        <AbsoluteFill style={{ overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              top: -height * 0.3,
              bottom: -height * 0.3,
              width: Math.round(width * 0.32),
              left: interpolate(enterT, [0, 1], [-width * 0.45, width * 1.28]),
              transform: 'skewX(-24deg)',
              background: `linear-gradient(90deg, transparent 0%, ${accentColor}AA 42%, #FFFBEB 50%, ${goldColor}AA 58%, transparent 100%)`,
              opacity: interpolate(enterT, [0, 0.25, 1], [0.95, 0.85, 0]),
            }}
          />
        </AbsoluteFill>
      ) : null}

      {txKind === 'zoom-punch' && localFrame < inEnd ? (
        <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
          <circle
            cx={width / 2}
            cy={height / 2}
            r={interpolate(enterT, [0, 1], [maxDim * 0.08, maxDim * 0.78])}
            fill="none"
            stroke="#FFFFFF"
            strokeWidth={interpolate(enterT, [0, 1], [34, 2])}
            opacity={interpolate(enterT, [0, 0.7, 1], [0.9, 0.5, 0])}
          />
          <circle
            cx={width / 2}
            cy={height / 2}
            r={interpolate(enterT, [0, 1], [maxDim * 0.02, maxDim * 0.62])}
            fill="none"
            stroke={goldColor}
            strokeWidth={interpolate(enterT, [0, 1], [18, 1])}
            opacity={interpolate(enterT, [0, 0.75, 1], [0.85, 0.4, 0])}
          />
        </svg>
      ) : null}

      {txKind === 'iris-circle' && localFrame < inEnd ? (
        <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
          <circle
            cx={width / 2}
            cy={height / 2}
            r={interpolate(enterT, [0, 1], [50, maxDim * 0.72])}
            fill="none"
            stroke={accentColor}
            strokeWidth={interpolate(enterT, [0, 1], [26, 2])}
            opacity={interpolate(enterT, [0, 0.7, 1], [0.92, 0.6, 0])}
          />
          <circle
            cx={width / 2}
            cy={height / 2}
            r={interpolate(enterT, [0, 1], [10, maxDim * 0.62])}
            fill="none"
            stroke={goldColor}
            strokeWidth={interpolate(enterT, [0, 1], [14, 1])}
            opacity={interpolate(enterT, [0, 0.65, 1], [0.85, 0.45, 0])}
          />
        </svg>
      ) : null}

      {txKind === 'block-wipe' && localFrame < Math.min(14, inEnd) ? (
        <AbsoluteFill>
          {TX_BLOCK_CELLS.map((cell, bi) => {
            const p = interpolate(localFrame - cell.delay, [0, 8], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
            if (p <= 0.01) return null
            const cw = width / 6
            const ch = height / 4
            return (
              <div
                key={bi}
                style={{
                  position: 'absolute',
                  left: cell.col * cw,
                  top: cell.row * ch,
                  width: cw + 2,
                  height: ch + 2,
                  background: bi % 3 === 0 ? accentColor : bgColor,
                  opacity: p * 0.85,
                  transform: `scale(${p})`,
                }}
              />
            )
          })}
        </AbsoluteFill>
      ) : null}

      {txKind === 'glitch-cut' && localFrame < Math.min(10, inEnd) ? (
        <AbsoluteFill style={{ opacity: interpolate(localFrame, [0, Math.min(10, inEnd)], [0.88, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
          <div style={{ position: 'absolute', top: '24%', left: 0, right: 0, height: 42, background: 'linear-gradient(90deg, rgba(255,40,90,0.55), transparent, rgba(0,235,255,0.55))' }} />
          <div style={{ position: 'absolute', top: '52%', left: 0, right: 0, height: 18, background: `${goldColor}88` }} />
          <div style={{ position: 'absolute', top: '71%', left: 0, right: 0, height: 28, background: `${accentColor}77` }} />
        </AbsoluteFill>
      ) : null}

      {txKind === 'light-wipe' && localFrame < inEnd ? (
        <div
          style={{
            position: 'absolute',
            top: -120,
            bottom: -120,
            width: Math.round(width * 0.2),
            left: interpolate(enterT, [0, 1], [-width * 0.28, width * 1.15]),
            transform: 'skewX(-18deg)',
            background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.34), ${accentColor}66, transparent)`,
          }}
        />
      ) : null}

      {exitFlash > 0 ? <AbsoluteFill style={{ backgroundColor: accentColor, opacity: exitFlash }} /> : null}
    </AbsoluteFill>
  )
}

export const CameraRig: React.FC<{
  children: React.ReactNode
  zoomFrom?: number
  zoomTo?: number
  panXFrom?: number
  panXTo?: number
  panYFrom?: number
  panYTo?: number
  beatPulse?: number
  cutKickPx?: number
}> = ({ children, zoomFrom = 1.0, zoomTo = 1.06, panXFrom = 0, panXTo = 0, panYFrom = 0, panYTo = 0, beatPulse = 0, cutKickPx = 0 }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const p = Math.min(1, frame / Math.max(1, durationInFrames - 1))
  const eased = easeOutFast(p)
  const sc = zoomFrom + (zoomTo - zoomFrom) * eased + beatPulse * 0.022
  const dx = panXFrom + (panXTo - panXFrom) * eased + (frame < 7 ? Math.sin(frame * 3.8) * (7 - frame) * (cutKickPx || 0) : 0)
  const dy = panYFrom + (panYTo - panYFrom) * eased + (frame < 7 ? Math.cos(frame * 4.4) * (7 - frame) * (cutKickPx || 0) * 0.8 : 0)
  return (
    <AbsoluteFill style={{ transform: `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scale(${sc.toFixed(4)})`, transformOrigin: 'center center' }}>
      {children}
    </AbsoluteFill>
  )
}

export const AnimatedRoutePath: React.FC<{
  d: string
  progress: number
  lengthApprox?: number
  strokeColor?: string
  glowColor?: string
  strokeWidth?: number
}> = ({ d, progress, lengthApprox = 900, strokeColor = '#F59E0B', glowColor = '#FEF3C7', strokeWidth = 6 }) => {
  const p = Math.max(0, Math.min(1, progress))
  return (
    <g>
      <path d={d} fill="none" stroke={strokeColor} strokeWidth={strokeWidth * 2.4} strokeLinecap="round" strokeDasharray={lengthApprox} strokeDashoffset={lengthApprox * (1 - p)} opacity={0.22} />
      <path d={d} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeDasharray={lengthApprox} strokeDashoffset={lengthApprox * (1 - p)} opacity={0.96} />
      <path d={d} fill="none" stroke={glowColor} strokeWidth={Math.max(2, strokeWidth * 0.38)} strokeLinecap="round" strokeDasharray={lengthApprox} strokeDashoffset={lengthApprox * (1 - p)} opacity={0.9} />
    </g>
  )
}

export const ParallaxHorizon: React.FC<{
  bgTop?: string
  bgBot?: string
  gridColor?: string
  accentColor?: string
  starCount?: number
  driftSpeed?: number
}> = ({ bgTop = '#070A12', bgBot = '#171C2E', gridColor = '#F59E0B', accentColor = '#38BDF8', starCount = 26, driftSpeed = 1 }) => {
  const frame = useCurrentFrame()
  const driftX = (frame * 1.4 * driftSpeed) % 120
  return (
    <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <linearGradient id="ph-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={bgTop} />
          <stop offset="100%" stopColor={bgBot} />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={1920} height={1080} fill="url(#ph-sky)" />
      {Array.from({ length: 18 }, (_, i) => (
        <line key={`v-${i}`} x1={i * 120 - driftX} y1={0} x2={i * 120 - driftX} y2={1080} stroke={gridColor} strokeWidth={1} opacity={0.07} />
      ))}
      {Array.from({ length: 10 }, (_, j) => (
        <line key={`h-${j}`} x1={0} y1={j * 110 + ((frame * 0.6 * driftSpeed) % 110)} x2={1920} y2={j * 110 + ((frame * 0.6 * driftSpeed) % 110)} stroke={accentColor} strokeWidth={1} opacity={0.06} />
      ))}
      {Array.from({ length: starCount }, (_, si) => {
        const x = ((si * 317 + frame * (0.4 + (si % 3) * 0.35) * driftSpeed) % 1920)
        const y = ((si * 173 + frame * 0.15) % 980)
        const r = 1.4 + (si % 4) * 0.8
        const op = 0.25 + 0.35 * Math.abs(Math.sin(frame * 0.08 + si))
        return <circle key={`st-${si}`} cx={x} cy={y} r={r} fill={si % 3 === 0 ? accentColor : gridColor} opacity={op} />
      })}
    </svg>
  )
}
