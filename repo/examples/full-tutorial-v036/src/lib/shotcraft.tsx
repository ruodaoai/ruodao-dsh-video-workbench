/**
 * @dsh-video/shotcraft — Reusable Remotion + Three.js 3D Vibecoding Motion Primitives
 * Adapted from Apache-2.0 open-source video-shotcraft, @remotion/three & remotion-dev/skills patterns.
 * Strictly driven by useCurrentFrame() + spring() + interpolate() + THREE — zero CSS transition / keyframes.
 */
import React, { useEffect, useLayoutEffect, useRef } from 'react'
import {
  AbsoluteFill,
  Easing,
  Freeze,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import * as THREE from 'three'
import { ThreeCanvas } from '@remotion/three'

export { THREE, ThreeCanvas }

export const FONT_SANS = "'Noto Sans SC', 'Source Han Sans SC', 'PingFang SC', 'HarmonyOS Sans SC', sans-serif"
export const FONT_SERIF = "'Source Han Serif SC Heavy', 'Noto Serif SC', 'Noto Sans SC', serif"
export const FONT_MONO = "'JetBrains Mono', 'Cascadia Mono', 'Liberation Mono', ui-monospace, monospace"

/** Normalize asset paths before calling Remotion staticFile(), preventing accidental double staticFile() / leading public/ crashes. */
export function resolveStaticSrc(src: string): string {
  const raw = String(src || '').trim()
  if (!raw) return ''
  if (/^(?:https?:|data:|blob:)/i.test(raw)) return raw
  const clean = raw
    .replace(/^(?:\.?[\\/]+)+/, '')
    .replace(/\\/g, '/')
    .replace(/^public\//i, '')
  return staticFile(clean)
}

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
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | string
}

export const AIBadge: React.FC<AIBadgeProps> = ({
  visible = true,
  text = 'AI 辅助创作',
  accentColor = '#38BDF8',
  position = 'top-right',
}) => {
  const { width, height } = useVideoConfig()
  const isPortrait = width < height
  if (!visible) return null
  const topPx = isPortrait ? Math.round(height * 0.088) : 22
  const bottomPx = isPortrait ? Math.round(height * 0.20) : 28
  const sidePx = 26
  const posKey = String(position || 'top-right').toLowerCase()
  const posStyle: React.CSSProperties =
    posKey === 'top-left'
      ? { top: topPx, left: sidePx }
      : posKey === 'bottom-left'
        ? { bottom: bottomPx, left: sidePx }
        : posKey === 'bottom-right'
          ? { bottom: bottomPx, right: sidePx }
          : { top: topPx, right: sidePx }
  return (
    <div
      style={{
        position: 'absolute',
        ...posStyle,
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
            <Img src={resolveStaticSrc(cleanLogo)} style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'cover', marginLeft: 4 }} />
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
  zoomScale?: number
  accentColor?: string
  goldColor?: string
}> = ({ item, zoomScale = 1, accentColor = '#45D1B2', goldColor = '#F6BA6F' }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const startF = Math.max(0, Number(item.startFrame || 6))
  const sp = spring({ frame: Math.max(0, frame - startF), fps, config: { damping: 14, stiffness: 200 } })
  if (frame < startF) return null
  const col = item.tone === 'gold' ? goldColor : accentColor
  const pulse = 0.78 + 0.22 * Math.sin((frame - startF) * 0.22)
  const invZ = 1 / Math.max(1, Number(zoomScale) || 1)
  const wPct = Math.max(3, Number(item.fw ?? item.w ?? 0.14) * 100)
  const hPct = Math.max(3, Number(item.fh ?? item.h ?? 0.08) * 100)
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
        borderRadius: item.shape === 'ring' ? 999 : Math.max(6, Math.round(12 * invZ)),
        border: `${Math.max(1.5, 2.8 * invZ).toFixed(2)}px solid ${col}`,
        background: `${col}18`,
        boxShadow: `0 0 0 ${Math.max(2, 4 * invZ).toFixed(1)}px rgba(15,23,42,0.18), 0 0 20px ${col}66`,
        opacity: interpolate(sp, [0, 1], [0, pulse]),
        transform: `scale(${interpolate(sp, [0, 1], [1.12, 1])})`,
        pointerEvents: 'none',
        zIndex: 15,
      }}
    >
      {item.label ? (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            ...(placeBelow ? { top: 'calc(100% + 6px)' } : { bottom: 'calc(100% + 6px)' }),
            transform: `translateX(-50%) scale(${invZ.toFixed(3)})`,
            transformOrigin: placeBelow ? 'top center' : 'bottom center',
            whiteSpace: 'nowrap',
            padding: '5px 12px',
            borderRadius: 999,
            background: 'rgba(15, 23, 42, 0.92)',
            border: `1.5px solid ${col}`,
            color: '#F8FAFC',
            fontFamily: FONT_SANS,
            fontSize: 15,
            fontWeight: 800,
            boxShadow: '0 8px 20px rgba(15,23,42,0.35)',
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
  cursors?: Array<{ t?: number; fx?: number; fy?: number; x?: number; y?: number; click?: boolean; label?: string }>
  mediaWidth?: number
  mediaHeight?: number
  fitMode?: 'contain' | 'cover'
  playbackRate?: number
  startFrom?: number
  accentColor?: string
  goldColor?: string
}> = ({
  src,
  cams = [],
  marks = [],
  cursors = [],
  mediaWidth = 0,
  mediaHeight = 0,
  fitMode = 'contain',
  playbackRate = 1,
  startFrom = 0,
  accentColor = '#45D1B2',
  goldColor = '#F6BA6F',
}) => {
  const frame = useCurrentFrame()
  const { durationInFrames, fps } = useVideoConfig()
  const durSec = Math.max(1, durationInFrames / Math.max(1, fps || 30))
  const resolvedMediaUrl = resolveStaticSrc(src)
  const cleanLookupKey = String(src || '').replace(/^\.?[\\/]+/, '').replace(/\\/g, '/')
  const dimsRegistry: Record<string, { width?: number; height?: number; durationSec?: number }> = (globalThis as any).__DSH_MEDIA_DIMS || {}
  const regEntry = dimsRegistry[cleanLookupKey] || dimsRegistry[cleanLookupKey.replace(/^public\//, '')] || null
  const effW = Number(mediaWidth) > 0 ? Number(mediaWidth) : Number(regEntry?.width || 0)
  const effH = Number(mediaHeight) > 0 ? Number(mediaHeight) : Number(regEntry?.height || 0)
  const clipDurSec = Number(regEntry?.durationSec || 0)
  const safeVidEndFrame = clipDurSec > 0.2 ? Math.max(4, Math.floor(((clipDurSec - 0.14) * Math.max(1, fps || 30)) / Math.max(0.25, Number(playbackRate) || 1))) : 0

  const p = Math.min(1, frame / Math.max(1, durationInFrames - 1))
  const maxCamT = Array.isArray(cams)
    ? Math.max(0, ...cams.map((k: any) => Number(k?.t ?? k?.at ?? 0)).filter(Number.isFinite))
    : 0
  const camTimeDiv = maxCamT > 1.01 ? Math.max(durSec, maxCamT) : 1
  const normKey = (rawKey: any, idx: number, totalLen: number) => {
    const r = rawKey || {}
    const rawT = Number.isFinite(Number(r.t))
      ? Number(r.t)
      : Number.isFinite(Number(r.at))
        ? Number(r.at)
        : idx / Math.max(1, totalLen - 1)
    const tVal = camTimeDiv > 1 ? Math.max(0, Math.min(1, rawT / camTimeDiv)) : Math.max(0, Math.min(1, rawT))
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
    return { t: tVal, fx: fxVal, fy: fyVal, z: Math.max(1.0, zVal) }
  }
  const rawArr = Array.isArray(cams) ? cams.map((k, ki) => normKey(k, ki, cams.length)) : []
  const keys = rawArr.length >= 2
    ? [...rawArr].sort((a, b) => a.t - b.t)
    : rawArr.length === 1
      ? [rawArr[0], { ...rawArr[0], t: 1 }]
      : [{ t: 0, fx: 0.5, fy: 0.5, z: 1.0 }, { t: 1, fx: 0.5, fy: 0.5, z: 1.04 }]

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
  // Exact center-origin clamped pan math: focal point (fx, fy) in [0..1] media space maps cleanly to viewport center
  // with zero blank margins and 1:1 coordinate lock between <Img>/<OffthreadVideo>, <HotspotMark> and <InteractiveCursor>.
  const maxPan = Math.max(0, (z - 1) / 2)
  const dxPct = Math.max(-maxPan, Math.min(maxPan, (0.5 - fx) * z)) * 100
  const dyPct = Math.max(-maxPan, Math.min(maxPan, (0.5 - fy) * z)) * 100
  const isVid = /\.(mp4|mov|webm|mkv)$/i.test(String(src || ''))
  const hasAspect = effW > 0 && effH > 0
  const ratio = hasAspect ? effW / effH : 16 / 9
  const aspectBoxStyle: React.CSSProperties = hasAspect
    ? fitMode === 'cover'
      ? {
          position: 'relative',
          flexShrink: 0,
          width: `max(100cqw, calc(100cqh * ${ratio.toFixed(6)}))`,
          height: `max(100cqh, calc(100cqw / ${ratio.toFixed(6)}))`,
          transformOrigin: '50% 50%',
          transform: `translate(${dxPct.toFixed(3)}%, ${dyPct.toFixed(3)}%) scale(${z.toFixed(4)})`,
        }
      : {
          position: 'relative',
          flexShrink: 0,
          width: `min(100cqw, calc(100cqh * ${ratio.toFixed(6)}))`,
          height: `min(100cqh, calc(100cqw / ${ratio.toFixed(6)}))`,
          transformOrigin: '50% 50%',
          transform: `translate(${dxPct.toFixed(3)}%, ${dyPct.toFixed(3)}%) scale(${z.toFixed(4)})`,
        }
    : {
        position: 'relative',
        width: '100%',
        height: '100%',
        transformOrigin: '50% 50%',
        transform: `translate(${dxPct.toFixed(3)}%, ${dyPct.toFixed(3)}%) scale(${z.toFixed(4)})`,
      }
  const imgFit = hasAspect ? 'fill' : fitMode

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', containerType: 'size' as any }}>
      <div style={aspectBoxStyle}>
        {resolvedMediaUrl ? (
          isVid ? (
            safeVidEndFrame > 0 && frame >= safeVidEndFrame ? (
              <Freeze frame={Math.max(0, safeVidEndFrame - 1)}>
                <OffthreadVideo src={resolvedMediaUrl} playbackRate={playbackRate} startFrom={startFrom} style={{ width: '100%', height: '100%', objectFit: imgFit, display: 'block' }} muted />
              </Freeze>
            ) : (
              <OffthreadVideo src={resolvedMediaUrl} playbackRate={playbackRate} startFrom={startFrom} style={{ width: '100%', height: '100%', objectFit: imgFit, display: 'block' }} muted />
            )
          ) : (
            <Img src={resolvedMediaUrl} style={{ width: '100%', height: '100%', objectFit: imgFit, display: 'block' }} />
          )
        ) : null}
        {(marks || []).map((m, mi) => (
          <HotspotMark key={mi} item={m} zoomScale={z} accentColor={accentColor} goldColor={goldColor} />
        ))}
        {Array.isArray(cursors) && cursors.length > 0 ? (
          <InteractiveCursor cursors={cursors} zoomScale={z} accentColor={accentColor} goldColor={goldColor} />
        ) : null}
      </div>
    </div>
  )
}

export const InteractiveCursor: React.FC<{
  cursors?: Array<{ t?: number; fx?: number; fy?: number; x?: number; y?: number; click?: boolean; clickAt?: number; label?: string }>
  zoomScale?: number
  accentColor?: string
  goldColor?: string
}> = ({ cursors = [], zoomScale = 1, accentColor = '#0284C7', goldColor = '#D97706' }) => {
  const frame = useCurrentFrame()
  const { durationInFrames, fps } = useVideoConfig()
  const durSec = Math.max(1, durationInFrames / Math.max(1, fps || 30))
  const maxCurT = Array.isArray(cursors)
    ? Math.max(0, ...cursors.map((c: any) => Number(c?.t ?? c?.clickAt ?? 0)).filter(Number.isFinite))
    : 0
  const curTimeDiv = maxCurT > 1.01 ? Math.max(durSec, maxCurT) : 1
  const rawList = Array.isArray(cursors)
    ? cursors
        .map((c: any, ci: number) => {
          const rawT = Number.isFinite(Number(c?.t))
            ? Number(c.t)
            : Number.isFinite(Number(c?.clickAt))
              ? Number(c.clickAt)
              : (ci / Math.max(1, cursors.length - 1)) * curTimeDiv
          const tNorm = Math.max(0, Math.min(1, rawT / curTimeDiv))
          const clickFlag = Boolean(c?.click) || Number.isFinite(Number(c?.clickAt))
          return {
            t: tNorm,
            fx: Number.isFinite(Number(c?.fx)) ? Number(c.fx) : Number.isFinite(Number(c?.x)) ? Number(c.x) : 0.5,
            fy: Number.isFinite(Number(c?.fy)) ? Number(c.fy) : Number.isFinite(Number(c?.y)) ? Number(c.y) : 0.5,
            click: clickFlag,
            label: String(c?.label || '').trim(),
          }
        })
        .sort((a, b) => a.t - b.t)
    : []
  if (rawList.length === 0) return null
  const list =
    rawList.length === 1 && rawList[0].t > 0.14
      ? [{ t: 0.06, fx: 0.52, fy: 0.52, click: false, label: '' }, rawList[0]]
      : rawList
  const p = Math.min(1, frame / Math.max(1, durationInFrames - 1))
  let cx = list[0].fx
  let cy = list[0].fy
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i]
    const b = list[i + 1]
    if (p >= a.t && p <= b.t) {
      const local = (p - a.t) / Math.max(0.001, b.t - a.t)
      const ease = local < 0.5 ? 4 * local * local * local : 1 - Math.pow(-2 * local + 2, 3) / 2
      cx = a.fx + (b.fx - a.fx) * ease
      cy = a.fy + (b.fy - a.fy) * ease
      break
    }
    if (p > b.t) {
      cx = b.fx
      cy = b.fy
    }
  }
  const activeClick = list.find((c) => c.click && p >= c.t - 0.02 && p <= c.t + 0.14)
  const clickProgress = activeClick ? Math.max(0, Math.min(1, (p - activeClick.t + 0.02) / 0.16)) : 0
  const invZ = 1 / Math.max(1, Number(zoomScale) || 1)
  const squeeze = activeClick && clickProgress < 0.35 ? 0.84 : 1.0
  const nearestLabel = [...list].reverse().find((c) => c.label && p >= c.t - 0.03 && p <= c.t + 0.34)?.label || ''
  const flipLeft = cx > 0.7
  const flipUp = cy > 0.78

  return (
    <div
      style={{
        position: 'absolute',
        left: `${(cx * 100).toFixed(3)}%`,
        top: `${(cy * 100).toFixed(3)}%`,
        transform: `scale(${(invZ * squeeze).toFixed(3)})`,
        transformOrigin: '0 0',
        pointerEvents: 'none',
        zIndex: 35,
      }}
    >
      {activeClick ? (
        <>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 18 + clickProgress * 72,
              height: 18 + clickProgress * 72,
              borderRadius: 999,
              border: `3px solid ${goldColor}`,
              transform: 'translate(-50%, -50%)',
              opacity: Math.max(0, 1 - clickProgress),
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 10 + clickProgress * 44,
              height: 10 + clickProgress * 44,
              borderRadius: 999,
              background: `${accentColor}44`,
              border: `2px solid ${accentColor}`,
              transform: 'translate(-50%, -50%)',
              opacity: Math.max(0, 1 - clickProgress * 1.15),
            }}
          />
        </>
      ) : null}
      {/* Exact (0,0) tip-anchored cursor SVG so arrow point touches exact (fx * W, fy * H) */}
      <svg width={34} height={38} viewBox="0 0 28 32" style={{ display: 'block', overflow: 'visible', filter: 'drop-shadow(0 4px 10px rgba(15,23,42,0.45))' }}>
        <path d="M0 0 L8 25 L12.5 16.5 L23 15.5 Z" fill="#FFFFFF" stroke="#0F172A" strokeWidth={2.2} strokeLinejoin="round" />
      </svg>
      {nearestLabel ? (
        <div
          style={{
            position: 'absolute',
            ...(flipLeft ? { right: 16 } : { left: 24 }),
            ...(flipUp ? { bottom: 14 } : { top: 22 }),
            whiteSpace: 'nowrap',
            padding: '5px 12px',
            borderRadius: 999,
            background: '#0F172A',
            color: '#F8FAFC',
            border: `1.5px solid ${goldColor}`,
            fontFamily: FONT_SANS,
            fontSize: 15,
            fontWeight: 800,
            boxShadow: '0 10px 26px rgba(15,23,42,0.35)',
          }}
        >
          {nearestLabel}
        </div>
      ) : null}
    </div>
  )
}

export const UiDrawerSlide: React.FC<{
  beforeSrc: string
  afterSrc: string
  revealAt?: number
  direction?: 'left' | 'right' | 'modal'
  camsBefore?: CamKeyframe[]
  camsAfter?: CamKeyframe[]
  cursors?: any[]
  mediaWidth?: number
  mediaHeight?: number
  accentColor?: string
  goldColor?: string
}> = ({
  beforeSrc,
  afterSrc,
  revealAt = 0.36,
  direction = 'left',
  camsBefore = [],
  camsAfter = [],
  cursors = [],
  mediaWidth = 0,
  mediaHeight = 0,
  accentColor = '#0284C7',
  goldColor = '#D97706',
}) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const triggerFrame = Math.round(revealAt * Math.max(1, durationInFrames - 1))
  const revealSp = spring({ frame: Math.max(0, frame - triggerFrame), fps, config: { damping: 16, stiffness: 165 } })
  const wipePct = Math.max(0, Math.min(100, (1 - revealSp) * 100))
  const afterOverlayStyle: React.CSSProperties =
    direction === 'left'
      ? { position: 'absolute', inset: 0, clipPath: `inset(0 ${wipePct.toFixed(2)}% 0 0)` }
      : direction === 'right'
        ? { position: 'absolute', inset: 0, clipPath: `inset(0 0 0 ${wipePct.toFixed(2)}%)` }
        : {
            position: 'absolute',
            inset: 0,
            opacity: revealSp,
            transform: `scale(${(0.95 + 0.05 * revealSp).toFixed(4)})`,
          }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#F8FAFC' }}>
      <FocusShot src={beforeSrc} cams={camsBefore} cursors={frame < triggerFrame ? cursors : []} mediaWidth={mediaWidth} mediaHeight={mediaHeight} accentColor={accentColor} goldColor={goldColor} />
      {frame >= triggerFrame ? (
        <div style={afterOverlayStyle}>
          <FocusShot src={afterSrc} cams={camsAfter} cursors={cursors} mediaWidth={mediaWidth} mediaHeight={mediaHeight} accentColor={accentColor} goldColor={goldColor} />
        </div>
      ) : null}
    </div>
  )
}

export const UiTypingOverlay: React.FC<{
  text: string
  startPct?: number
  endPct?: number
  label?: string
  accentColor?: string
}> = ({ text, startPct = 0.25, endPct = 0.78, label = '正在输入指令', accentColor = '#0284C7' }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const p = Math.min(1, frame / Math.max(1, durationInFrames - 1))
  const u = Math.max(0, Math.min(1, (p - startPct) / Math.max(0.05, endPct - startPct)))
  const count = Math.floor(u * String(text || '').length)
  const shown = String(text || '').slice(0, count)
  const caretOn = frame % 18 < 10
  return (
    <div
      style={{
        padding: '14px 18px',
        borderRadius: 14,
        background: 'rgba(255, 255, 255, 0.96)',
        border: `2px solid ${accentColor}`,
        boxShadow: '0 16px 40px rgba(15, 23, 42, 0.18)',
        fontFamily: FONT_SANS,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 800, color: accentColor, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: '#0F172A', lineHeight: 1.5, minHeight: 30 }}>
        {shown}
        <span style={{ opacity: caretOn ? 1 : 0, color: accentColor, fontWeight: 900 }}>|</span>
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
  const bUrl = resolveStaticSrc(beforeSrc)
  const aUrl = resolveStaticSrc(afterSrc)
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#07100F' }}>
      {bUrl ? <Img src={bUrl} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} /> : null}
      {aUrl ? (
        <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 0 0 ${(split * 100).toFixed(2)}%)` }}>
          <Img src={aUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
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
  const resolvedClipUrl = resolveStaticSrc(clipPath)

  if (layout === 'fullscreen') {
    return (
      <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 25, justifyContent: 'flex-end', alignItems: 'center' }}>
        <OffthreadVideo
          src={resolvedClipUrl}
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
        src={resolvedClipUrl}
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

export type ThreeStagePreset =
  | 'orbital-core'
  | 'cyber-terrain'
  | 'particle-vortex'
  | 'floating-monoliths'
  | 'chrono-helix'
  | 'matrix-cubes'
  | 'auto'

export const THREE_STAGE_PRESETS: ThreeStagePreset[] = [
  'orbital-core',
  'cyber-terrain',
  'particle-vortex',
  'floating-monoliths',
  'chrono-helix',
  'matrix-cubes',
]

export interface ThreeCyberStageProps {
  preset?: ThreeStagePreset | string
  primaryColor?: string
  secondaryColor?: string
  bgColor?: string
  beatPulse?: number
  cameraSpeed?: number
  opacity?: number
  seed?: number
  wireframe?: boolean
  lowSpecSafe?: boolean
  style?: React.CSSProperties
}

function detRand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123
  return x - Math.floor(x)
}

/**
 * Opus 5.5 Vibecoding 3D Spatial Engine powered by Three.js (`THREE.Scene`, `THREE.PerspectiveCamera`,
 * `THREE.IcosahedronGeometry`, `THREE.TorusGeometry`, `THREE.BoxGeometry`, `THREE.OctahedronGeometry`,
 * `THREE.Matrix4`, `THREE.Vector3`, `THREE.Color`).
 * Synchronously driven by `useCurrentFrame()` with zero delayRender deadlock and 100% deterministic frame capture.
 */
export const ThreeCyberStage: React.FC<ThreeCyberStageProps> = ({
  preset = 'auto',
  primaryColor = '#38BDF8',
  secondaryColor = '#F59E0B',
  bgColor = 'transparent',
  beatPulse = 0,
  cameraSpeed = 1,
  opacity = 0.88,
  seed = 1,
  wireframe = true,
  lowSpecSafe = false,
  style = {},
}) => {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const isLowSpec = Boolean(lowSpecSafe || (typeof globalThis !== 'undefined' && (globalThis as any).__DSH_LOW_SPEC_SAFE))

  const resolvedPreset: ThreeStagePreset =
    preset && preset !== 'auto' && THREE_STAGE_PRESETS.includes(preset as ThreeStagePreset)
      ? (preset as ThreeStagePreset)
      : THREE_STAGE_PRESETS[Math.abs(Math.round(seed)) % THREE_STAGE_PRESETS.length]

  const renderThreeFrame = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const scaleLow = isLowSpec ? 0.72 : 1
    const w = Math.max(320, Math.round((width || 1920) * scaleLow))
    const h = Math.max(320, Math.round((height || 1080) * scaleLow))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h

    ctx.clearRect(0, 0, w, h)
    if (bgColor && bgColor !== 'transparent') {
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, w, h)
    }

    const t = (frame / Math.max(1, fps || 30)) * cameraSpeed
    const bp = Math.max(0, Math.min(1.5, Number(beatPulse) || 0))
    const colA = new THREE.Color(primaryColor || '#38BDF8')
    const colB = new THREE.Color(secondaryColor || '#F59E0B')
    const rgbA = `${Math.round(colA.r * 255)}, ${Math.round(colA.g * 255)}, ${Math.round(colA.b * 255)}`
    const rgbB = `${Math.round(colB.r * 255)}, ${Math.round(colB.g * 255)}, ${Math.round(colB.b * 255)}`

    // 1. Setup Three.js PerspectiveCamera & Scene
    const fov = 52 - bp * 3.5
    const camera = new THREE.PerspectiveCamera(fov, w / h, 0.1, 160)
    const scene = new THREE.Scene()

    if (resolvedPreset === 'cyber-terrain') {
      camera.position.set(Math.sin(t * 0.45) * 1.4, 2.5 + Math.cos(t * 0.35) * 0.35, 9.2)
      camera.lookAt(0, 0.3, -12)
      camera.rotation.z = Math.sin(t * 0.3) * 0.04
    } else if (resolvedPreset === 'chrono-helix') {
      camera.position.set(Math.sin(t * 0.6) * 0.85, Math.cos(t * 0.5) * 0.65, 8.5)
      camera.lookAt(Math.sin(t * 0.3) * 0.3, 0, -18)
      camera.rotation.z = t * 0.18
    } else if (resolvedPreset === 'matrix-cubes') {
      camera.position.set(Math.sin(t * 0.38) * 6.8, 5.2 + Math.sin(t * 0.5) * 0.6, Math.cos(t * 0.38) * 7.8 + 2.5)
      camera.lookAt(0, -0.4, 0)
    } else {
      const orbitAngle = t * 0.32 + seed * 0.7
      const radius = 8.4 - bp * 0.45
      camera.position.set(
        Math.sin(orbitAngle) * radius * 0.55,
        Math.sin(t * 0.42 + seed) * 1.65 + 0.6,
        Math.cos(orbitAngle) * radius,
      )
      camera.lookAt(0, 0, 0)
      camera.rotation.z = Math.sin(t * 0.25) * 0.035
    }

    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()
    const viewProj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    const lightDir = new THREE.Vector3(0.55, 0.78, 0.65).normalize()

    const projectVec = (v: THREE.Vector3): { x: number; y: number; z: number; visible: boolean } => {
      const p = v.clone().applyMatrix4(viewProj)
      if (p.z < -1 || p.z > 1) {
        return { x: 0, y: 0, z: p.z, visible: false }
      }
      return {
        x: (p.x * 0.5 + 0.5) * w,
        y: (-p.y * 0.5 + 0.5) * h,
        z: p.z,
        visible: true,
      }
    }

    interface DrawFace {
      pts: Array<{ x: number; y: number }>
      depth: number
      fill: string
      stroke: string
      lineWidth: number
    }
    const drawQueue: DrawFace[] = []

    const pushGeometryToQueue = (
      geom: THREE.BufferGeometry,
      meshMatrix: THREE.Matrix4,
      useSecondary: boolean,
      faceAlphaScale = 0.22,
      strokeAlphaScale = 0.78,
      lineW = 1.4,
    ) => {
      const posAttr = geom.getAttribute('position')
      if (!posAttr) return
      const indexAttr = geom.getIndex()
      const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(posAttr.count / 3)
      const vA = new THREE.Vector3()
      const vB = new THREE.Vector3()
      const vC = new THREE.Vector3()
      const edge1 = new THREE.Vector3()
      const edge2 = new THREE.Vector3()
      const normal = new THREE.Vector3()
      const rgb = useSecondary ? rgbB : rgbA

      for (let i = 0; i < triCount; i++) {
        const i0 = indexAttr ? indexAttr.getX(i * 3) : i * 3
        const i1 = indexAttr ? indexAttr.getX(i * 3 + 1) : i * 3 + 1
        const i2 = indexAttr ? indexAttr.getX(i * 3 + 2) : i * 3 + 2
        vA.fromBufferAttribute(posAttr, i0).applyMatrix4(meshMatrix)
        vB.fromBufferAttribute(posAttr, i1).applyMatrix4(meshMatrix)
        vC.fromBufferAttribute(posAttr, i2).applyMatrix4(meshMatrix)

        const pA = projectVec(vA)
        const pB = projectVec(vB)
        const pC = projectVec(vC)
        if (!pA.visible || !pB.visible || !pC.visible) continue

        edge1.subVectors(vB, vA)
        edge2.subVectors(vC, vA)
        normal.crossVectors(edge1, edge2).normalize()
        const lit = Math.max(0.15, Math.abs(normal.dot(lightDir)))
        const depth = (pA.z + pB.z + pC.z) / 3
        const fAlpha = Math.min(0.65, faceAlphaScale * (0.45 + lit * 0.85) + bp * 0.08)
        const sAlpha = Math.min(0.96, strokeAlphaScale * (0.55 + lit * 0.5) + bp * 0.14)

        drawQueue.push({
          pts: [
            { x: pA.x, y: pA.y },
            { x: pB.x, y: pB.y },
            { x: pC.x, y: pC.y },
          ],
          depth,
          fill: `rgba(${rgb}, ${fAlpha.toFixed(3)})`,
          stroke: wireframe ? `rgba(${rgb}, ${sAlpha.toFixed(3)})` : 'transparent',
          lineWidth: lineW,
        })
      }
      geom.dispose()
    }

    // Ambient volumetric center glow
    const grad = ctx.createRadialGradient(w * 0.5, h * 0.48, 20, w * 0.5, h * 0.48, Math.max(w, h) * 0.52)
    grad.addColorStop(0, `rgba(${rgbA}, ${(0.16 + bp * 0.09).toFixed(3)})`)
    grad.addColorStop(0.45, `rgba(${rgbB}, ${(0.07 + bp * 0.04).toFixed(3)})`)
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)

    // 2. Build Preset-Specific 3D Meshes & Lines via Three.js
    if (resolvedPreset === 'orbital-core') {
      const coreScale = 1 + bp * 0.24 + Math.sin(t * 2.4) * 0.06
      const coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.85, 1))
      coreMesh.rotation.set(t * 0.55, t * 0.78, t * 0.32)
      coreMesh.scale.setScalar(coreScale)
      coreMesh.updateMatrixWorld(true)
      scene.add(coreMesh)
      pushGeometryToQueue(coreMesh.geometry, coreMesh.matrixWorld, false, 0.2, 0.86, 1.7)

      const innerMesh = new THREE.Mesh(new THREE.OctahedronGeometry(1.08, 0))
      innerMesh.rotation.set(-t * 0.9, t * 0.5, -t * 0.6)
      innerMesh.scale.setScalar(1 + bp * 0.32)
      innerMesh.updateMatrixWorld(true)
      pushGeometryToQueue(innerMesh.geometry, innerMesh.matrixWorld, true, 0.34, 0.92, 1.9)

      const ringRadii = [2.95, 3.85, 4.75]
      ringRadii.forEach((rad, ri) => {
        const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.035 + ri * 0.008, 6, 40))
        ringMesh.rotation.set(
          0.95 + ri * 0.52 + t * (ri % 2 === 0 ? 0.42 : -0.36),
          t * (0.3 + ri * 0.14),
          ri * 0.7,
        )
        ringMesh.scale.setScalar(1 + bp * 0.08)
        ringMesh.updateMatrixWorld(true)
        pushGeometryToQueue(ringMesh.geometry, ringMesh.matrixWorld, ri % 2 === 1, 0.14, 0.72, 1.2)
      })

      for (let si = 0; si < 10; si++) {
        const ang = (si / 10) * Math.PI * 2 + t * (0.65 + (si % 3) * 0.15)
        const r = 3.2 + (si % 3) * 0.95
        const sat = new THREE.Mesh(new THREE.OctahedronGeometry(0.18 + (si % 2) * 0.07, 0))
        sat.position.set(Math.cos(ang) * r, Math.sin(ang * 1.5 + si) * 1.25, Math.sin(ang) * r)
        sat.rotation.set(t * 1.5 + si, t * 1.2, 0)
        sat.updateMatrixWorld(true)
        pushGeometryToQueue(sat.geometry, sat.matrixWorld, si % 2 === 0, 0.38, 0.9, 1.3)
      }
    } else if (resolvedPreset === 'cyber-terrain') {
      // 3D Procedural Wireframe Canyon Grid + Horizon Sun Portal + Monoliths
      const cols = 22
      const rows = 16
      const spacingX = 0.95
      const spacingZ = 1.05
      const zScroll = (t * 2.8) % spacingZ
      ctx.lineWidth = 1.25
      for (let rz = 0; rz < rows - 1; rz++) {
        const z0 = 4.5 - rz * spacingZ + zScroll
        const z1 = 4.5 - (rz + 1) * spacingZ + zScroll
        const depthFade = Math.max(0.08, Math.min(0.85, 1 - rz / rows))
        for (let cx = 0; cx < cols - 1; cx++) {
          const x0 = (cx - (cols - 1) / 2) * spacingX
          const x1 = (cx + 1 - (cols - 1) / 2) * spacingX
          const canyon0 = Math.pow(Math.min(1, Math.abs(x0) / 3.2), 1.6) * 2.3
          const canyon1 = Math.pow(Math.min(1, Math.abs(x1) / 3.2), 1.6) * 2.3
          const wave00 = Math.sin(x0 * 0.65 + (rz - t * 2.8) * 0.45) * 0.42 + bp * 0.28 * Math.cos(x0)
          const wave10 = Math.sin(x1 * 0.65 + (rz - t * 2.8) * 0.45) * 0.42 + bp * 0.28 * Math.cos(x1)
          const wave01 = Math.sin(x0 * 0.65 + (rz + 1 - t * 2.8) * 0.45) * 0.42
          const y00 = -1.75 + canyon0 + wave00
          const y10 = -1.75 + canyon1 + wave10
          const y01 = -1.75 + canyon0 + wave01

          const p00 = projectVec(new THREE.Vector3(x0, y00, z0))
          const p10 = projectVec(new THREE.Vector3(x1, y10, z0))
          const p01 = projectVec(new THREE.Vector3(x0, y01, z1))
          if (p00.visible && p10.visible) {
            ctx.strokeStyle = Math.abs(x0) < 2.2 ? `rgba(${rgbB}, ${(depthFade * 0.62).toFixed(3)})` : `rgba(${rgbA}, ${(depthFade * 0.58).toFixed(3)})`
            ctx.beginPath()
            ctx.moveTo(p00.x, p00.y)
            ctx.lineTo(p10.x, p10.y)
            if (p01.visible) ctx.lineTo(p01.x, p01.y)
            ctx.stroke()
          }
        }
      }

      const sunCore = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3, 1))
      sunCore.position.set(0, 1.85, -10.5)
      sunCore.rotation.set(t * 0.25, t * 0.45, 0)
      sunCore.scale.setScalar(1 + bp * 0.2)
      sunCore.updateMatrixWorld(true)
      pushGeometryToQueue(sunCore.geometry, sunCore.matrixWorld, true, 0.25, 0.88, 1.6)

      const sunRing = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.05, 6, 36))
      sunRing.position.set(0, 1.85, -10.5)
      sunRing.rotation.set(0.35, t * 0.3, t * 0.5)
      sunRing.updateMatrixWorld(true)
      pushGeometryToQueue(sunRing.geometry, sunRing.matrixWorld, false, 0.18, 0.82, 1.4)
    } else if (resolvedPreset === 'floating-monoliths') {
      for (let mi = 0; mi < 9; mi++) {
        const spread = (mi - 4) * 1.55
        const zPos = -Math.abs(mi - 4) * 0.85 - 0.5 + Math.sin(t * 0.9 + mi) * 0.45
        const yPos = Math.sin(t * 1.15 + mi * 0.8) * 0.42
        const slab = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.55 + (mi % 3) * 0.45, 0.24))
        slab.position.set(spread, yPos, zPos)
        slab.rotation.set(Math.sin(t * 0.6 + mi) * 0.14, -spread * 0.12 + Math.cos(t * 0.5 + mi) * 0.22, 0)
        slab.scale.setScalar(1 + bp * 0.12)
        slab.updateMatrixWorld(true)
        pushGeometryToQueue(slab.geometry, slab.matrixWorld, mi % 2 === 1, 0.24, 0.85, 1.5)
      }
    } else if (resolvedPreset === 'chrono-helix') {
      const tunnelCount = 12
      const zSpan = 22
      for (let ti = 0; ti < tunnelCount; ti++) {
        const rawZ = ((ti * (zSpan / tunnelCount) + t * 3.8) % zSpan) - zSpan + 6.5
        const portal = new THREE.Mesh(new THREE.TorusGeometry(2.85 + (ti % 2) * 0.35, 0.045, 6, 8))
        portal.position.set(Math.sin(rawZ * 0.15 + t) * 0.3, Math.cos(rawZ * 0.15 + t) * 0.22, rawZ)
        portal.rotation.set(0, 0, ti * 0.35 + t * 0.45)
        portal.scale.setScalar(1 + bp * 0.15)
        portal.updateMatrixWorld(true)
        pushGeometryToQueue(portal.geometry, portal.matrixWorld, ti % 2 === 0, 0.16, 0.8, 1.5)
      }
      // Double Helix DNA / Timeline Strands
      const strandPtsA: Array<{ x: number; y: number; visible: boolean }> = []
      const strandPtsB: Array<{ x: number; y: number; visible: boolean }> = []
      for (let hi = 0; hi < 44; hi++) {
        const hz = 5.5 - hi * 0.48
        const hang = hi * 0.38 - t * 2.4
        const rad = 1.65 + bp * 0.22
        const p1 = projectVec(new THREE.Vector3(Math.cos(hang) * rad, Math.sin(hang) * rad, hz))
        const p2 = projectVec(new THREE.Vector3(Math.cos(hang + Math.PI) * rad, Math.sin(hang + Math.PI) * rad, hz))
        strandPtsA.push(p1)
        strandPtsB.push(p2)
        if (hi % 2 === 0 && p1.visible && p2.visible) {
          ctx.strokeStyle = `rgba(${rgbB}, 0.42)`
          ctx.lineWidth = 1.3
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.stroke()
        }
      }
      ;[strandPtsA, strandPtsB].forEach((pts, si) => {
        ctx.strokeStyle = si === 0 ? `rgba(${rgbA}, 0.85)` : `rgba(${rgbB}, 0.85)`
        ctx.lineWidth = 2.4
        ctx.beginPath()
        let started = false
        for (const pt of pts) {
          if (!pt.visible) continue
          if (!started) {
            ctx.moveTo(pt.x, pt.y)
            started = true
          } else {
            ctx.lineTo(pt.x, pt.y)
          }
        }
        ctx.stroke()
      })
    } else if (resolvedPreset === 'matrix-cubes') {
      const gxCount = 6
      const gzCount = 5
      for (let gx = 0; gx < gxCount; gx++) {
        for (let gz = 0; gz < gzCount; gz++) {
          const wx = (gx - (gxCount - 1) / 2) * 1.35
          const wz = (gz - (gzCount - 1) / 2) * 1.35
          const dist = Math.sqrt(wx * wx + wz * wz)
          const waveH = 0.75 + (Math.sin(dist * 0.95 - t * 3.1) * 0.5 + 0.5) * 1.65 + bp * 0.55
          const cube = new THREE.Mesh(new THREE.BoxGeometry(0.76, waveH, 0.76))
          cube.position.set(wx, waveH * 0.5 - 1.5, wz)
          cube.updateMatrixWorld(true)
          pushGeometryToQueue(cube.geometry, cube.matrixWorld, (gx + gz) % 2 === 1, 0.25, 0.84, 1.35)
        }
      }
    } else {
      // 'particle-vortex': Central Singularity + 3D Neural Constellation & Spiral Arms
      const sing = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 0))
      sing.rotation.set(t * 0.8, -t * 1.1, t * 0.4)
      sing.scale.setScalar(1 + bp * 0.3)
      sing.updateMatrixWorld(true)
      pushGeometryToQueue(sing.geometry, sing.matrixWorld, true, 0.28, 0.9, 1.8)

      const outerCage = new THREE.Mesh(new THREE.IcosahedronGeometry(2.85, 1))
      outerCage.rotation.set(-t * 0.32, t * 0.44, 0)
      outerCage.updateMatrixWorld(true)
      pushGeometryToQueue(outerCage.geometry, outerCage.matrixWorld, false, 0.08, 0.55, 1.15)
    }

    // 3. Depth-Sort & Paint All 3D Polygons (Painter's Algorithm back-to-front)
    drawQueue.sort((a, b) => b.depth - a.depth)
    for (const face of drawQueue) {
      ctx.beginPath()
      ctx.moveTo(face.pts[0].x, face.pts[0].y)
      ctx.lineTo(face.pts[1].x, face.pts[1].y)
      ctx.lineTo(face.pts[2].x, face.pts[2].y)
      ctx.closePath()
      ctx.fillStyle = face.fill
      ctx.fill()
      if (face.stroke !== 'transparent') {
        ctx.strokeStyle = face.stroke
        ctx.lineWidth = face.lineWidth
        ctx.stroke()
      }
    }

    // 4. 3D Starfield / Neural Vortex Particles & Synaptic Connections
    const rawPCount = resolvedPreset === 'particle-vortex' ? 110 : 56
    const pCount = isLowSpec ? Math.round(rawPCount * 0.55) : rawPCount
    const projNodes: Array<{ x: number; y: number; z: number; r: number; isGold: boolean }> = []
    for (let pi = 0; pi < pCount; pi++) {
      const r1 = detRand(pi * 3.1 + seed)
      const r2 = detRand(pi * 7.3 + seed)
      const r3 = detRand(pi * 13.7 + seed)
      const armAngle = r1 * Math.PI * 2 + t * (0.35 + r2 * 0.45) + (resolvedPreset === 'particle-vortex' ? r3 * 4.2 : 0)
      const radius = (resolvedPreset === 'particle-vortex' ? 1.4 : 2.2) + r3 * 6.2
      const vy = (r2 - 0.5) * 5.2 + Math.sin(t * 0.9 + pi) * 0.35
      const worldPt = new THREE.Vector3(Math.cos(armAngle) * radius, vy, Math.sin(armAngle) * radius)
      const pr = projectVec(worldPt)
      if (!pr.visible) continue
      const depthScale = Math.max(0.3, Math.min(2.2, (1 - pr.z) * 1.4))
      projNodes.push({
        x: pr.x,
        y: pr.y,
        z: pr.z,
        r: (1.5 + (pi % 3) * 1.1 + bp * 1.2) * depthScale,
        isGold: pi % 3 === 0,
      })
    }

    if (resolvedPreset === 'particle-vortex' || resolvedPreset === 'orbital-core') {
      const maxDistSq = Math.pow(w * 0.095, 2)
      ctx.lineWidth = 1.0
      for (let i = 0; i < projNodes.length; i++) {
        let links = 0
        for (let j = i + 1; j < projNodes.length && links < 3; j++) {
          const dx = projNodes[i].x - projNodes[j].x
          const dy = projNodes[i].y - projNodes[j].y
          const dSq = dx * dx + dy * dy
          if (dSq < maxDistSq) {
            const alpha = (1 - dSq / maxDistSq) * (0.28 + bp * 0.18)
            ctx.strokeStyle = projNodes[i].isGold ? `rgba(${rgbB}, ${alpha.toFixed(3)})` : `rgba(${rgbA}, ${alpha.toFixed(3)})`
            ctx.beginPath()
            ctx.moveTo(projNodes[i].x, projNodes[i].y)
            ctx.lineTo(projNodes[j].x, projNodes[j].y)
            ctx.stroke()
            links++
          }
        }
      }
    }

    for (const nd of projNodes) {
      const rgb = nd.isGold ? rgbB : rgbA
      ctx.fillStyle = `rgba(${rgb}, 0.85)`
      ctx.beginPath()
      ctx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  useLayoutEffect(() => {
    renderThreeFrame()
  }, [frame, fps, width, height, resolvedPreset, primaryColor, secondaryColor, bgColor, beatPulse, cameraSpeed, seed, wireframe])

  useEffect(() => {
    renderThreeFrame()
  }, [frame, resolvedPreset])

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity, ...style }}>
      <canvas
        ref={canvasRef}
        width={width || 1920}
        height={height || 1080}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </AbsoluteFill>
  )
}

/**
 * Freeform Programmable Three.js 3D Stage (<FreeformThreeStage buildScene={(api) => { ... }} />)
 * Allows the AI Coder to build ANY custom 3D geometry, 3D scene, 3D orbits, 3D bar/terrain charts,
 * 3D molecules, 3D globes, 3D exploded views, and 3D-anchored HUD labels per frame with zero preset limits!
 */
export interface FreeformThreeMeshOpts {
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
  isGold?: boolean
  fillAlpha?: number
  strokeAlpha?: number
  lineWidth?: number
  wireframeOnly?: boolean
}

export interface FreeformThreeLineOpts {
  isGold?: boolean
  alpha?: number
  lineWidth?: number
  closed?: boolean
  dashed?: boolean
}

export interface FreeformThreeParticleOpts {
  radius?: number
  isGold?: boolean
  alpha?: number
  glow?: boolean
}

export interface FreeformThreeLabelOpts {
  isGold?: boolean
  fontSize?: number
  subText?: string
}

export interface FreeformThreeApi {
  THREE: typeof THREE
  frame: number
  fps: number
  t: number
  progress: number
  beatPulse: number
  width: number
  height: number
  primaryColor: string
  secondaryColor: string
  setCamera: (position: [number, number, number], lookAt?: [number, number, number], fov?: number) => void
  addMesh: (geometry: THREE.BufferGeometry, opts?: FreeformThreeMeshOpts) => void
  addLine3D: (points: Array<[number, number, number]>, opts?: FreeformThreeLineOpts) => void
  addParticle3D: (position: [number, number, number], opts?: FreeformThreeParticleOpts) => void
  addLabel3D: (text: string, position: [number, number, number], opts?: FreeformThreeLabelOpts) => void
  orbitPoint: (radius: number, angleRad: number, y?: number, tiltXRad?: number) => [number, number, number]
  arc3D: (start: [number, number, number], end: [number, number, number], arcHeight?: number, segments?: number) => Array<[number, number, number]>
}

export interface FreeformThreeStageProps {
  buildScene?: (api: FreeformThreeApi) => void
  fallbackPreset?: ThreeStagePreset | string
  primaryColor?: string
  secondaryColor?: string
  bgColor?: string
  opacity?: number
  beatPulse?: number
  durationInFrames?: number
  seed?: number
  lowSpecSafe?: boolean
  style?: React.CSSProperties
}

export const FreeformThreeStage: React.FC<FreeformThreeStageProps> = ({
  buildScene,
  fallbackPreset = 'orbital-core',
  primaryColor = '#38BDF8',
  secondaryColor = '#F59E0B',
  bgColor = 'transparent',
  opacity = 0.88,
  beatPulse = 0,
  durationInFrames = 120,
  seed = 1,
  lowSpecSafe = false,
  style = {},
}) => {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const isLowSpec = Boolean(lowSpecSafe || (typeof globalThis !== 'undefined' && (globalThis as any).__DSH_LOW_SPEC_SAFE))

  if (typeof buildScene !== 'function') {
    return (
      <ThreeCyberStage
        preset={fallbackPreset}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
        bgColor={bgColor}
        opacity={opacity}
        beatPulse={beatPulse}
        seed={seed}
        lowSpecSafe={isLowSpec}
        style={style}
      />
    )
  }

  const renderFreeformFrame = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const scaleLow = isLowSpec ? 0.72 : 1
    const w = Math.max(320, Math.round((width || 1920) * scaleLow))
    const h = Math.max(320, Math.round((height || 1080) * scaleLow))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h

    const t = frame / Math.max(1, fps || 30)
    const progress = Math.max(0, Math.min(1, frame / Math.max(1, durationInFrames - 1)))
    const bp = Math.max(0, Math.min(1.5, Number(beatPulse) || 0))
    const colA = new THREE.Color(primaryColor || '#38BDF8')
    const colB = new THREE.Color(secondaryColor || '#F59E0B')
    const rgbA = `${Math.round(colA.r * 255)}, ${Math.round(colA.g * 255)}, ${Math.round(colA.b * 255)}`
    const rgbB = `${Math.round(colB.r * 255)}, ${Math.round(colB.g * 255)}, ${Math.round(colB.b * 255)}`

    ctx.clearRect(0, 0, w, h)
    if (bgColor && bgColor !== 'transparent') {
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, w, h)
    }
    const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.45, w * 0.04, w * 0.5, h * 0.5, w * 0.78)
    bgGrad.addColorStop(0, `rgba(${rgbA}, ${(0.15 + bp * 0.07).toFixed(3)})`)
    bgGrad.addColorStop(0.52, `rgba(${rgbB}, 0.06)`)
    bgGrad.addColorStop(1, 'rgba(4, 7, 15, 0.0)')
    ctx.fillStyle = bgGrad
    ctx.fillRect(0, 0, w, h)

    let camPos: [number, number, number] = [Math.sin(t * 0.35) * 1.4, 1.35 + Math.cos(t * 0.28) * 0.35, 8.2 - bp * 0.28]
    let camLook: [number, number, number] = [0, 0, 0]
    let camFov = 46

    const geometriesToDispose: THREE.BufferGeometry[] = []
    const meshEntries: Array<{ geo: THREE.BufferGeometry; matrix: THREE.Matrix4; opts: FreeformThreeMeshOpts }> = []
    const lineEntries: Array<{ pts: Array<[number, number, number]>; opts: FreeformThreeLineOpts }> = []
    const particleEntries: Array<{ pos: [number, number, number]; opts: FreeformThreeParticleOpts }> = []
    const labelEntries: Array<{ text: string; pos: [number, number, number]; opts: FreeformThreeLabelOpts }> = []

    const api: FreeformThreeApi = {
      THREE,
      frame,
      fps: fps || 30,
      t,
      progress,
      beatPulse: bp,
      width: w,
      height: h,
      primaryColor,
      secondaryColor,
      setCamera: (pos, lookAt = [0, 0, 0], fov = 46) => {
        if (Array.isArray(pos) && pos.length === 3) camPos = [Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 8]
        if (Array.isArray(lookAt) && lookAt.length === 3) camLook = [Number(lookAt[0]) || 0, Number(lookAt[1]) || 0, Number(lookAt[2]) || 0]
        if (Number.isFinite(Number(fov))) camFov = Math.max(20, Math.min(95, Number(fov)))
      },
      addMesh: (geometry, opts = {}) => {
        if (!geometry || typeof geometry.getAttribute !== 'function') return
        geometriesToDispose.push(geometry)
        const mesh = new THREE.Mesh(geometry)
        if (opts.position) mesh.position.set(Number(opts.position[0]) || 0, Number(opts.position[1]) || 0, Number(opts.position[2]) || 0)
        if (opts.rotation) mesh.rotation.set(Number(opts.rotation[0]) || 0, Number(opts.rotation[1]) || 0, Number(opts.rotation[2]) || 0)
        if (typeof opts.scale === 'number') {
          mesh.scale.setScalar(opts.scale)
        } else if (Array.isArray(opts.scale)) {
          mesh.scale.set(Number(opts.scale[0]) || 1, Number(opts.scale[1]) || 1, Number(opts.scale[2]) || 1)
        }
        mesh.updateMatrixWorld(true)
        meshEntries.push({ geo: geometry, matrix: mesh.matrixWorld.clone(), opts })
      },
      addLine3D: (points, opts = {}) => {
        if (Array.isArray(points) && points.length >= 2) lineEntries.push({ pts: points, opts })
      },
      addParticle3D: (position, opts = {}) => {
        if (Array.isArray(position) && position.length === 3) particleEntries.push({ pos: position, opts })
      },
      addLabel3D: (text, position, opts = {}) => {
        if (text && Array.isArray(position) && position.length === 3) labelEntries.push({ text: String(text), pos: position, opts })
      },
      orbitPoint: (radius, angleRad, y = 0, tiltXRad = 0) => {
        const x = Math.cos(angleRad) * radius
        const z0 = Math.sin(angleRad) * radius
        const y1 = y * Math.cos(tiltXRad) - z0 * Math.sin(tiltXRad)
        const z1 = y * Math.sin(tiltXRad) + z0 * Math.cos(tiltXRad)
        return [x, y1, z1]
      },
      arc3D: (start, end, arcHeight = 1.2, segments = 24) => {
        const pts: Array<[number, number, number]> = []
        const n = Math.max(4, Math.min(64, segments))
        for (let i = 0; i <= n; i++) {
          const u = i / n
          const x = start[0] + (end[0] - start[0]) * u
          const z = start[2] + (end[2] - start[2]) * u
          const y = start[1] + (end[1] - start[1]) * u + Math.sin(u * Math.PI) * arcHeight
          pts.push([x, y, z])
        }
        return pts
      },
    }

    try {
      buildScene(api)
    } catch {}

    const camera = new THREE.PerspectiveCamera(camFov, w / h, 0.1, 140)
    camera.position.set(camPos[0], camPos[1], camPos[2])
    camera.lookAt(camLook[0], camLook[1], camLook[2])
    camera.updateMatrixWorld(true)
    camera.updateProjectionMatrix()
    const viewProj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)

    const projectPt = (x: number, y: number, z: number) => {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(viewProj)
      return {
        x: (v.x * 0.5 + 0.5) * w,
        y: (-v.y * 0.5 + 0.5) * h,
        z: v.z,
        visible: v.z > -1.0 && v.z < 1.0,
      }
    }

    type FaceCmd = {
      depth: number
      pts: Array<{ x: number; y: number }>
      fill: string
      stroke: string
      lineWidth: number
    }
    const drawQueue: FaceCmd[] = []
    const lightDir = new THREE.Vector3(0.48, 0.78, 0.52).normalize()

    for (const item of meshEntries) {
      const { geo, matrix, opts } = item
      const posAttr = geo.getAttribute('position')
      if (!posAttr) continue
      const idxAttr = geo.getIndex()
      const va = new THREE.Vector3()
      const vb = new THREE.Vector3()
      const vc = new THREE.Vector3()
      const na = new THREE.Vector3()
      const nb = new THREE.Vector3()
      const rgb = opts.isGold ? rgbB : rgbA
      const fAlpha = opts.wireframeOnly ? 0 : (opts.fillAlpha ?? 0.22)
      const sAlpha = opts.strokeAlpha ?? 0.78
      const lw = opts.lineWidth ?? 1.35

      const pushTri = (ia: number, ib: number, ic: number) => {
        va.fromBufferAttribute(posAttr, ia).applyMatrix4(matrix)
        vb.fromBufferAttribute(posAttr, ib).applyMatrix4(matrix)
        vc.fromBufferAttribute(posAttr, ic).applyMatrix4(matrix)
        const pa = projectPt(va.x, va.y, va.z)
        const pb = projectPt(vb.x, vb.y, vb.z)
        const pc = projectPt(vc.x, vc.y, vc.z)
        if (!pa.visible || !pb.visible || !pc.visible) return
        na.subVectors(vb, va)
        nb.subVectors(vc, va)
        const norm = new THREE.Vector3().crossVectors(na, nb).normalize()
        const lambert = Math.max(0.18, Math.abs(norm.dot(lightDir)))
        const depth = (pa.z + pb.z + pc.z) / 3
        drawQueue.push({
          depth,
          pts: [{ x: pa.x, y: pa.y }, { x: pb.x, y: pb.y }, { x: pc.x, y: pc.y }],
          fill: fAlpha > 0.005 ? `rgba(${rgb}, ${(fAlpha * lambert).toFixed(3)})` : 'transparent',
          stroke: sAlpha > 0.005 ? `rgba(${rgb}, ${(sAlpha * (0.45 + 0.55 * lambert)).toFixed(3)})` : 'transparent',
          lineWidth: lw,
        })
      }

      if (idxAttr) {
        for (let i = 0; i < idxAttr.count; i += 3) {
          pushTri(idxAttr.getX(i), idxAttr.getX(i + 1), idxAttr.getX(i + 2))
        }
      } else {
        for (let i = 0; i < posAttr.count; i += 3) {
          pushTri(i, i + 1, i + 2)
        }
      }
    }

    drawQueue.sort((a, b) => b.depth - a.depth)
    for (const face of drawQueue) {
      ctx.beginPath()
      ctx.moveTo(face.pts[0].x, face.pts[0].y)
      ctx.lineTo(face.pts[1].x, face.pts[1].y)
      ctx.lineTo(face.pts[2].x, face.pts[2].y)
      ctx.closePath()
      if (face.fill !== 'transparent') {
        ctx.fillStyle = face.fill
        ctx.fill()
      }
      if (face.stroke !== 'transparent') {
        ctx.strokeStyle = face.stroke
        ctx.lineWidth = face.lineWidth
        ctx.stroke()
      }
    }

    // Render 3D Lines / Orbits / Arcs
    for (const ln of lineEntries) {
      const rgb = ln.opts.isGold ? rgbB : rgbA
      ctx.save()
      ctx.strokeStyle = `rgba(${rgb}, ${(ln.opts.alpha ?? 0.78).toFixed(3)})`
      ctx.lineWidth = ln.opts.lineWidth ?? 2.2
      if (ln.opts.dashed) ctx.setLineDash([6, 6])
      ctx.beginPath()
      let started = false
      for (let i = 0; i < ln.pts.length; i++) {
        const p = projectPt(ln.pts[i][0], ln.pts[i][1], ln.pts[i][2])
        if (!p.visible) continue
        if (!started) {
          ctx.moveTo(p.x, p.y)
          started = true
        } else {
          ctx.lineTo(p.x, p.y)
        }
      }
      if (started && ln.opts.closed) ctx.closePath()
      if (started) ctx.stroke()
      ctx.restore()
    }

    // Render 3D Particles
    for (const pt of particleEntries) {
      const p = projectPt(pt.pos[0], pt.pos[1], pt.pos[2])
      if (!p.visible) continue
      const rgb = pt.opts.isGold ? rgbB : rgbA
      const r = Math.max(1.2, (pt.opts.radius ?? 3.5) * Math.max(0.45, (1 - p.z) * 1.25))
      if (pt.opts.glow !== false) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2)
        g.addColorStop(0, `rgba(${rgb}, ${(pt.opts.alpha ?? 0.9).toFixed(3)})`)
        g.addColorStop(1, `rgba(${rgb}, 0)`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = `rgba(${rgb}, ${(pt.opts.alpha ?? 0.95).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fill()
    }

    // Render 3D-Anchored HUD Callout Labels
    for (const lbl of labelEntries) {
      const p = projectPt(lbl.pos[0], lbl.pos[1], lbl.pos[2])
      if (!p.visible || p.x < 40 || p.x > w - 40 || p.y < 40 || p.y > h - 80) continue
      const rgb = lbl.opts.isGold ? rgbB : rgbA
      const fs = lbl.opts.fontSize ?? 14
      ctx.save()
      ctx.font = `800 ${fs}px 'JetBrains Mono', 'Noto Sans SC', monospace`
      const tw = ctx.measureText(lbl.text).width
      const pw = tw + 22
      const ph = lbl.opts.subText ? fs + 26 : fs + 14
      const bx = p.x + 12
      const by = p.y - ph * 0.5
      ctx.fillStyle = `rgba(${rgb}, 0.95)`
      ctx.beginPath()
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = `rgba(${rgb}, 0.65)`
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(bx, p.y)
      ctx.stroke()
      ctx.fillStyle = 'rgba(7, 12, 24, 0.88)'
      ctx.strokeStyle = `rgba(${rgb}, 0.72)`
      ctx.lineWidth = 1.5
      const r = 7
      ctx.beginPath()
      ctx.moveTo(bx + r, by)
      ctx.lineTo(bx + pw - r, by)
      ctx.quadraticCurveTo(bx + pw, by, bx + pw, by + r)
      ctx.lineTo(bx + pw, by + ph - r)
      ctx.quadraticCurveTo(bx + pw, by + ph, bx + pw - r, by + ph)
      ctx.lineTo(bx + r, by + ph)
      ctx.quadraticCurveTo(bx, by + ph, bx, by + ph - r)
      ctx.lineTo(bx, by + r)
      ctx.quadraticCurveTo(bx, by, bx + r, by)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#F8FAFC'
      ctx.fillText(lbl.text, bx + 11, by + fs + 3)
      if (lbl.opts.subText) {
        ctx.font = `600 ${Math.max(10, fs - 3)}px 'JetBrains Mono', monospace`
        ctx.fillStyle = `rgba(${rgb}, 0.92)`
        ctx.fillText(lbl.opts.subText, bx + 11, by + fs + 18)
      }
      ctx.restore()
    }

    for (const g of geometriesToDispose) {
      try { g.dispose() } catch {}
    }
  }

  useLayoutEffect(() => {
    renderFreeformFrame()
  }, [frame, fps, width, height, primaryColor, secondaryColor, bgColor, beatPulse, durationInFrames, seed])

  useEffect(() => {
    renderFreeformFrame()
  }, [frame])

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity, ...style }}>
      <canvas
        ref={canvasRef}
        width={width || 1920}
        height={height || 1080}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </AbsoluteFill>
  )
}

/**
 * Freeform SVG Path & Arc Math Helpers (for custom AI-coded charts, waves, radars, trajectories, and vector illustrations)
 */
export function buildSmoothSvgPath(points: Array<{ x: number; y: number }>, closed = false): string {
  if (!Array.isArray(points) || points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]
    const p1 = points[i + 1]
    const mx = ((p0.x + p1.x) * 0.5).toFixed(1)
    d += ` C ${mx} ${p0.y.toFixed(1)}, ${mx} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`
  }
  if (closed) d += ' Z'
  return d
}

export function describeSvgArc(cx: number, cy: number, r: number, startAngleDeg: number, endAngleDeg: number): string {
  const sweep = endAngleDeg - startAngleDeg
  if (Math.abs(sweep) < 0.1) return ''
  const clampedEnd = sweep >= 359.9 ? startAngleDeg + 359.9 : sweep <= -359.9 ? startAngleDeg - 359.9 : endAngleDeg
  const a0 = Math.min(startAngleDeg, clampedEnd)
  const a1 = Math.max(startAngleDeg, clampedEnd)
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180.0
  const start = { x: cx + r * Math.cos(rad(a1)), y: cy + r * Math.sin(rad(a1)) }
  const end = { x: cx + r * Math.cos(rad(a0)), y: cy + r * Math.sin(rad(a0)) }
  const largeArcFlag = a1 - a0 <= 180 ? '0' : '1'
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${largeArcFlag} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
}

/**
 * Pillar 4: Beat-Synced Spring Physics Calculator (spring + interpolate + harmonic beat recoil)
 */
export function computeBeatSpring(
  frame: number,
  fps: number,
  beats: any[] = [],
  options: { delayFrames?: number; damping?: number; stiffness?: number; mass?: number; beatBoost?: number } = {},
) {
  const { delayFrames = 0, damping = 12, stiffness = 175, mass = 0.82, beatBoost = 1 } = options
  const enterSpring = spring({
    frame: Math.max(0, frame - delayFrames),
    fps: Math.max(1, fps || 30),
    config: { damping, stiffness, mass },
  })
  const tSec = frame / Math.max(1, fps || 30)
  let latestBeatAge = 999
  let isStrongBeat = false
  if (Array.isArray(beats)) {
    for (let i = 0; i < beats.length; i++) {
      const raw = beats[i]
      const bt = typeof raw === 'number' ? raw : Number(raw?.time)
      if (!Number.isFinite(bt)) continue
      const dt = tSec - bt
      if (dt >= 0 && dt < latestBeatAge) {
        latestBeatAge = dt
        isStrongBeat = typeof raw === 'object' ? Boolean(raw?.strong) : i % 4 === 0
      }
    }
  }
  const beatFramesAgo = latestBeatAge < 0.45 ? Math.round(latestBeatAge * (fps || 30)) : 999
  const beatSpringRaw =
    beatFramesAgo < 16
      ? spring({
          frame: beatFramesAgo,
          fps: Math.max(1, fps || 30),
          config: { damping: 8, stiffness: 250, mass: 0.55 },
        })
      : 0
  const beatEnvelope = latestBeatAge < 0.42 ? Math.exp(-latestBeatAge * 9.5) * (isStrongBeat ? 1 : 0.65) : 0
  const beatKick = beatSpringRaw * beatEnvelope * beatBoost

  const scale = interpolate(enterSpring, [0, 1], [0.86, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) + beatKick * 0.048
  const translateY = interpolate(enterSpring, [0, 1], [48, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) - beatKick * 9
  const rotateX = interpolate(enterSpring, [0, 1], [14, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) + Math.sin(tSec * 2.1) * 1.4 + beatKick * 2.8
  const rotateY = Math.cos(tSec * 1.6) * 1.8
  const rotateZ = Math.sin(tSec * 1.2) * 0.45
  const opacity = interpolate(enterSpring, [0, 0.4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const rgbSplitPx = (1 - enterSpring) * 5.5 + beatKick * 4.2

  return {
    enterSpring,
    beatKick,
    scale,
    translateY,
    rotateX,
    rotateY,
    rotateZ,
    opacity,
    rgbSplitPx,
  }
}

export interface BeatSpringPhysicsRigProps {
  children: React.ReactNode
  beats?: any[]
  delayFrames?: number
  beatBoost?: number
  style?: React.CSSProperties
}

export const BeatSpringPhysicsRig: React.FC<BeatSpringPhysicsRigProps> = ({
  children,
  beats = [],
  delayFrames = 0,
  beatBoost = 1,
  style = {},
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const phys = computeBeatSpring(frame, fps, beats, { delayFrames, beatBoost })

  return (
    <AbsoluteFill
      style={{
        opacity: phys.opacity,
        transform: `perspective(1450px) translate3d(0, ${phys.translateY.toFixed(2)}px, 0) scale(${phys.scale.toFixed(4)}) rotateX(${phys.rotateX.toFixed(2)}deg) rotateY(${phys.rotateY.toFixed(2)}deg) rotateZ(${phys.rotateZ.toFixed(2)}deg)`,
        transformOrigin: 'center center',
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  )
}

/**
 * Pillar 3A: Vibecoding Full-Frame HUD Telemetry Overlay (Frame Counter, Beat Spectrum, Reticles, Timecode)
 */
export interface HudTelemetryOverlayProps {
  accentColor?: string
  goldColor?: string
  beatPulse?: number
  sceneIndex?: number
  totalScenes?: number
  engineLabel?: string
  opacity?: number
}

export const HudTelemetryOverlay: React.FC<HudTelemetryOverlayProps> = ({
  accentColor = '#38BDF8',
  goldColor = '#F59E0B',
  beatPulse = 0,
  sceneIndex = 0,
  totalScenes = 6,
  engineLabel = 'REMOTION 4.x // THREE.JS 3D // SPRING',
  opacity = 0.78,
}) => {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const isPortrait = width < height
  const bp = Math.max(0, Math.min(1.4, Number(beatPulse) || 0))
  const totalSec = frame / Math.max(1, fps || 30)
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const ss = String(Math.floor(totalSec % 60)).padStart(2, '0')
  const ff = String(frame % Math.max(1, fps || 30)).padStart(2, '0')
  const timecode = `${mm}:${ss}:${ff}`

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity, zIndex: 18 }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0 }}
      >
        {/* Top-Left Telemetry Status Strip */}
        <g transform={`translate(${isPortrait ? 36 : 48}, ${isPortrait ? 56 : 38})`}>
          <rect x={0} y={0} width={isPortrait ? 390 : 450} height={32} rx={6} fill="rgba(5, 10, 22, 0.72)" stroke={accentColor} strokeWidth={1} strokeOpacity={0.42} />
          <circle cx={16} cy={16} r={4.5 + bp * 2} fill={bp > 0.25 ? goldColor : accentColor} />
          <text x={30} y={21} fill="#E2E8F0" fontFamily={FONT_MONO} fontSize={12.5} fontWeight={700} letterSpacing={1.2}>
            {`${engineLabel} · TC ${timecode}`}
          </text>
        </g>

        {/* Right-Side Rotating Gyroscope Reticle */}
        {!isPortrait ? (
          <g transform={`translate(${width - 78}, ${Math.round(height * 0.5)})`}>
            <g transform={`rotate(${(frame * 1.4) % 360})`}>
              <circle cx={0} cy={0} r={28 + bp * 5} fill="none" stroke={accentColor} strokeWidth={1.3} strokeDasharray="10 6" opacity={0.55} />
            </g>
            <g transform={`rotate(${(-frame * 2.1) % 360})`}>
              <circle cx={0} cy={0} r={18} fill="none" stroke={goldColor} strokeWidth={1.2} strokeDasharray="5 5" opacity={0.65} />
            </g>
            <circle cx={0} cy={0} r={3.5} fill={accentColor} opacity={0.85} />
          </g>
        ) : null}

        {/* Bottom-Left Live 16-Bar Beat Spectrum Equalizer */}
        <g transform={`translate(${isPortrait ? 36 : 48}, ${height - (isPortrait ? 205 : 86)})`}>
          <text x={0} y={-8} fill={accentColor} fontFamily={FONT_MONO} fontSize={11} fontWeight={700} letterSpacing={1.5} opacity={0.82}>
            {`SCENE 0${sceneIndex + 1}/0${Math.max(1, totalScenes)} · SPRING_VEL ${(1 + bp * 0.85).toFixed(2)}G · F${String(frame).padStart(4, '0')}`}
          </text>
          {Array.from({ length: 18 }, (_, bi) => {
            const wave = Math.abs(Math.sin(frame * 0.22 + bi * 0.55)) * 0.65 + Math.abs(Math.cos(frame * 0.13 - bi * 0.4)) * 0.35
            const barH = Math.max(4, Math.min(34, (6 + wave * 18 + bp * 16) * (1 - Math.abs(bi - 8) * 0.04)))
            return (
              <rect
                key={bi}
                x={bi * 9}
                y={34 - barH}
                width={5.5}
                height={barH}
                rx={2}
                fill={bi % 4 === 0 ? goldColor : accentColor}
                opacity={0.78}
              />
            )
          })}
        </g>
      </svg>
    </AbsoluteFill>
  )
}

/**
 * Pillar 2: Dynamic SVG Architecture & Topology Diagram (<SvgArchitectureDiagram />)
 * Driven strictly by useCurrentFrame() + spring() + interpolate()
 */
export type SvgArchTopology = 'neural-pipeline' | 'microservice-mesh' | 'layered-stack' | 'radial-hub' | 'ast-tree' | 'auto'

export interface SvgArchitectureDiagramProps {
  title?: string
  kicker?: string
  nodes?: Array<string | { label: string; sub?: string; metric?: string }>
  topology?: SvgArchTopology | string
  accentColor?: string
  goldColor?: string
  beatPulse?: number
  seed?: number
}

export const SvgArchitectureDiagram: React.FC<SvgArchitectureDiagramProps> = ({
  title = 'AI 多智能体协同架构拓扑',
  kicker = 'DYNAMIC SVG ARCHITECTURE // SPRING PHYSICS',
  nodes = [],
  topology = 'auto',
  accentColor = '#38BDF8',
  goldColor = '#F59E0B',
  beatPulse = 0,
  seed = 1,
}) => {
  const frame = useCurrentFrame()
  const { fps, width, height, durationInFrames } = useVideoConfig()
  const isPortrait = width < height
  const bp = Math.max(0, Math.min(1.4, Number(beatPulse) || 0))
  const progress = interpolate(frame, [0, Math.max(20, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const TOPOLOGIES: SvgArchTopology[] = ['neural-pipeline', 'microservice-mesh', 'layered-stack', 'radial-hub', 'ast-tree']
  const resolvedTopo: SvgArchTopology =
    topology && topology !== 'auto' && TOPOLOGIES.includes(topology as SvgArchTopology)
      ? (topology as SvgArchTopology)
      : TOPOLOGIES[Math.abs(Math.round(seed)) % TOPOLOGIES.length]

  const defaultLabels = ['01 输入解析层', '02 导演规划引擎', '03 Three.js 3D 舞台', '04 动态 SVG 拓扑', '05 弹簧物理合成', '06 高清渲染交付']
  const rawList = Array.isArray(nodes) && nodes.length > 0 ? nodes : defaultLabels
  const normNodes = Array.from({ length: Math.max(4, Math.min(6, rawList.length || 5)) }, (_, i) => {
    const item = rawList[i % rawList.length]
    if (typeof item === 'object' && item !== null) {
      return {
        label: String(item.label || defaultLabels[i % defaultLabels.length]).slice(0, 16),
        sub: String(item.sub || `NODE_0${i + 1} · ACTIVE`),
        metric: String(item.metric || `${96 + (i % 4)}.${(i * 3) % 9}%`),
      }
    }
    return {
      label: String(item || defaultLabels[i % defaultLabels.length]).slice(0, 16),
      sub: `STAGE_0${i + 1} // SYNC`,
      metric: `${(1.2 + i * 0.4).toFixed(1)}ms`,
    }
  })

  const vbW = isPortrait ? 1080 : 1920
  const vbH = isPortrait ? 1920 : 1080
  const cx = vbW * 0.5
  const cy = isPortrait ? vbH * 0.47 : vbH * 0.52

  // Compute node coordinates based on selected topology
  const coords = normNodes.map((_, i) => {
    const n = normNodes.length
    if (resolvedTopo === 'radial-hub') {
      if (i === 0) return { x: cx, y: cy, isCore: true }
      const ang = ((i - 1) / Math.max(1, n - 1)) * Math.PI * 2 - Math.PI * 0.5 + frame * 0.004
      const rx = isPortrait ? 310 : 490
      const ry = isPortrait ? 340 : 255
      return { x: cx + Math.cos(ang) * rx, y: cy + Math.sin(ang) * ry, isCore: false }
    }
    if (resolvedTopo === 'layered-stack') {
      const spanY = isPortrait ? 760 : 460
      const startY = cy - spanY * 0.5
      const stepY = spanY / Math.max(1, n - 1)
      const waveX = Math.sin(frame * 0.05 + i * 0.9) * 18
      return { x: cx + waveX, y: startY + i * stepY, isCore: i === 0 || i === n - 1 }
    }
    if (resolvedTopo === 'ast-tree') {
      if (i === 0) return { x: cx, y: cy - (isPortrait ? 320 : 210), isCore: true }
      if (i <= 2) {
        const side = i === 1 ? -1 : 1
        return { x: cx + side * (isPortrait ? 240 : 390), y: cy - (isPortrait ? 40 : 10), isCore: false }
      }
      const leafIdx = i - 3
      const leafCount = Math.max(1, n - 3)
      const spread = isPortrait ? 680 : 1060
      const lx = cx - spread * 0.5 + (leafCount === 1 ? spread * 0.5 : (leafIdx / (leafCount - 1)) * spread)
      return { x: lx, y: cy + (isPortrait ? 260 : 210), isCore: false }
    }
    // 'neural-pipeline' or 'microservice-mesh'
    if (isPortrait) {
      const col = i % 2 === 0 ? -1 : 1
      const row = Math.floor(i / 2)
      return {
        x: cx + (i === 0 || i === n - 1 ? 0 : col * 235),
        y: cy - 340 + row * 240 + (i % 2) * 60,
        isCore: i === 0 || i === n - 1,
      }
    }
    const cols = n <= 4 ? n : 3
    const row = Math.floor(i / cols)
    const col = i % cols
    const totalInRow = row === 0 ? Math.min(cols, n) : n - cols
    const spanX = totalInRow <= 1 ? 0 : 1080
    const x = cx - spanX * 0.5 + (totalInRow <= 1 ? 0 : (col / (totalInRow - 1)) * spanX)
    const y = n <= 4 ? cy + (i % 2 === 0 ? -95 : 95) : cy + (row === 0 ? -135 : 145)
    return { x, y, isCore: i === 0 || i === n - 1 }
  })

  // Build edges between nodes
  const edges: Array<{ from: number; to: number }> = []
  for (let i = 0; i < coords.length; i++) {
    if (resolvedTopo === 'radial-hub') {
      if (i > 0) edges.push({ from: 0, to: i })
      if (i > 1) edges.push({ from: i - 1, to: i })
    } else if (resolvedTopo === 'ast-tree') {
      if (i === 1 || i === 2) edges.push({ from: 0, to: i })
      else if (i >= 3) edges.push({ from: (i % 2) + 1, to: i })
    } else {
      if (i < coords.length - 1) edges.push({ from: i, to: i + 1 })
      if (i + 2 < coords.length && resolvedTopo === 'microservice-mesh') edges.push({ from: i, to: i + 2 })
    }
  }

  const headSpring = spring({ frame, fps, config: { damping: 13, stiffness: 160 } })
  const activeNodeIdx = Math.floor(progress * coords.length) % Math.max(1, coords.length)

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg viewBox={`0 0 ${vbW} ${vbH}`} width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id={`arch-grad-${seed}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={accentColor} />
            <stop offset="100%" stopColor={goldColor} />
          </linearGradient>
          <filter id={`arch-glow-${seed}`} x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Top Header Banner with Spring Physics */}
        <g
          transform={`translate(${cx}, ${isPortrait ? 240 : 122}) scale(${interpolate(headSpring, [0, 1], [0.88, 1])})`}
          opacity={interpolate(headSpring, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' })}
        >
          <rect x={-230} y={-52} width={460} height={28} rx={14} fill="rgba(15, 23, 42, 0.82)" stroke={accentColor} strokeWidth={1.2} />
          <text x={0} y={-33} textAnchor="middle" fill={accentColor} fontFamily={FONT_MONO} fontSize={13} fontWeight={800} letterSpacing={2.2}>
            {kicker}
          </text>
          <text x={0} y={18} textAnchor="middle" fill="#F8FAFC" fontFamily={FONT_SANS} fontSize={isPortrait ? 44 : 48} fontWeight={900}>
            {title}
          </text>
        </g>

        {/* Animated SVG Circuit Bus Edges + Traveling Data Photons */}
        {edges.map((ed, ei) => {
          const p1 = coords[ed.from]
          const p2 = coords[ed.to]
          if (!p1 || !p2) return null
          const edgeSpring = spring({
            frame: Math.max(0, frame - (ed.from * 4 + 3)),
            fps,
            config: { damping: 14, stiffness: 130 },
          })
          const mx = (p1.x + p2.x) * 0.5
          const my = (p1.y + p2.y) * 0.5 - (resolvedTopo === 'layered-stack' ? 0 : 36)
          const dPath = `M ${p1.x} ${p1.y} Q ${mx} ${my} ${p2.x} ${p2.y}`
          const packetT = ((frame * 0.028 + ei * 0.23) % 1)
          const invT = 1 - packetT
          const px = invT * invT * p1.x + 2 * invT * packetT * mx + packetT * packetT * p2.x
          const py = invT * invT * p1.y + 2 * invT * packetT * my + packetT * packetT * p2.y

          return (
            <g key={`edge-${ei}`} opacity={edgeSpring}>
              <path
                d={dPath}
                fill="none"
                stroke={`url(#arch-grad-${seed})`}
                strokeWidth={3.2 + bp * 1.5}
                strokeDasharray="900"
                strokeDashoffset={interpolate(edgeSpring, [0, 1], [900, 0])}
                opacity={0.78}
              />
              <path
                d={dPath}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={1.4}
                strokeDasharray="10 18"
                strokeDashoffset={-frame * 3.5}
                opacity={0.55}
              />
              {/* Traveling Data Photon */}
              <circle cx={px} cy={py} r={6 + bp * 3} fill={ei % 2 === 0 ? goldColor : accentColor} filter={`url(#arch-glow-${seed})`} />
              <circle cx={px} cy={py} r={3} fill="#FFFFFF" />
            </g>
          )
        })}

        {/* Spring-Animated Architecture Nodes */}
        {coords.map((pt, ni) => {
          const nodeData = normNodes[ni]
          const isAct = ni === activeNodeIdx
          const nSpring = spring({
            frame: Math.max(0, frame - ni * 5),
            fps,
            config: { damping: 11, stiffness: 170, mass: 0.8 },
          })
          const cardScale = interpolate(nSpring, [0, 1], [0.5, 1]) + (isAct ? bp * 0.08 : 0)
          const cardY = interpolate(nSpring, [0, 1], [42, 0])
          const cardW = resolvedTopo === 'layered-stack' ? (isPortrait ? 760 : 920) : isPortrait ? 390 : 340
          const cardH = resolvedTopo === 'layered-stack' ? 76 : 112
          const strokeCol = isAct || pt.isCore ? goldColor : accentColor

          return (
            <g
              key={`node-${ni}`}
              transform={`translate(${pt.x}, ${pt.y + cardY}) scale(${cardScale})`}
              opacity={interpolate(nSpring, [0, 0.35], [0, 1], { extrapolateRight: 'clamp' })}
            >
              {isAct ? (
                <rect
                  x={-cardW * 0.5 - 8}
                  y={-cardH * 0.5 - 8}
                  width={cardW + 16}
                  height={cardH + 16}
                  rx={20}
                  fill="none"
                  stroke={goldColor}
                  strokeWidth={2}
                  opacity={0.45 + bp * 0.35}
                />
              ) : null}
              <rect
                x={-cardW * 0.5}
                y={-cardH * 0.5}
                width={cardW}
                height={cardH}
                rx={16}
                fill="rgba(8, 14, 28, 0.9)"
                stroke={strokeCol}
                strokeWidth={isAct || pt.isCore ? 2.4 : 1.5}
              />
              {/* Left Accent Bar */}
              <rect x={-cardW * 0.5 + 10} y={-cardH * 0.5 + 14} width={5} height={cardH - 28} rx={2.5} fill={strokeCol} />
              {/* Node Index Badge */}
              <rect x={-cardW * 0.5 + 26} y={-cardH * 0.5 + 14} width={44} height={22} rx={6} fill={`${strokeCol}26`} />
              <text x={-cardW * 0.5 + 48} y={-cardH * 0.5 + 29} textAnchor="middle" fill={strokeCol} fontFamily={FONT_MONO} fontSize={12.5} fontWeight={800}>
                {`0${ni + 1}`}
              </text>
              {/* Metric Pill */}
              <text x={cardW * 0.5 - 18} y={-cardH * 0.5 + 29} textAnchor="end" fill={goldColor} fontFamily={FONT_MONO} fontSize={13} fontWeight={800}>
                {nodeData.metric}
              </text>
              {/* Main Node Title */}
              <text
                x={resolvedTopo === 'layered-stack' ? -cardW * 0.5 + 88 : -cardW * 0.5 + 26}
                y={resolvedTopo === 'layered-stack' ? 6 : 12}
                fill="#FFFFFF"
                fontFamily={FONT_SANS}
                fontSize={resolvedTopo === 'layered-stack' ? 25 : 23}
                fontWeight={900}
              >
                {nodeData.label}
              </text>
              {/* Subtitle / Telemetry */}
              {resolvedTopo !== 'layered-stack' ? (
                <text x={-cardW * 0.5 + 26} y={36} fill="#94A3B8" fontFamily={FONT_MONO} fontSize={12} fontWeight={600}>
                  {nodeData.sub}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </AbsoluteFill>
  )
}

/**
 * Pillar 3B: Vibecoding HUD Data & Live Code Dashboard (<HudDataDashboard />)
 * Combines Live Code/AST Stream + Animated SVG Ring Gauges + Real-Time Spline Area Chart + Spring Physics
 */
export interface HudDataDashboardProps {
  title?: string
  kicker?: string
  highlights?: string[]
  metrics?: Array<{ label: string; value: number; suffix?: string }>
  codeLines?: string[]
  accentColor?: string
  goldColor?: string
  beatPulse?: number
  seed?: number
}

export const HudDataDashboard: React.FC<HudDataDashboardProps> = ({
  title = '全息 HUD 实时遥测与代码引擎',
  kicker = 'VIBECODING TELEMETRY // REALTIME HUD',
  highlights = [],
  metrics = [],
  codeLines = [],
  accentColor = '#38BDF8',
  goldColor = '#F59E0B',
  beatPulse = 0,
  seed = 1,
}) => {
  const frame = useCurrentFrame()
  const { fps, width, height, durationInFrames } = useVideoConfig()
  const isPortrait = width < height
  const bp = Math.max(0, Math.min(1.4, Number(beatPulse) || 0))
  const progress = interpolate(frame, [0, Math.max(20, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const defaultMetrics = [
    { label: highlights[0] || '帧级确定性同步', value: 99.9, suffix: '%' },
    { label: highlights[1] || 'Three.js 渲染帧率', value: 60, suffix: 'FPS' },
    { label: highlights[2] || '多智能体并发吞吐', value: 400, suffix: '%' },
  ]
  const activeMetrics = (Array.isArray(metrics) && metrics.length >= 2 ? metrics : defaultMetrics).slice(0, 3)

  const defaultCode = [
    `import { useCurrentFrame, spring, interpolate } from 'remotion';`,
    `import { ThreeCyberStage, SvgArchitectureDiagram } from './lib/shotcraft';`,
    `const frame = useCurrentFrame();`,
    `const camSpring = spring({ frame, fps: 60, config: { damping: 12, stiffness: 180 } });`,
    `// Target: ${title.slice(0, 22)}`,
    `<ThreeCyberStage preset="orbital-core" beatPulse={bp} />`,
    `<SvgArchitectureDiagram topology="neural-pipeline" />`,
    `export const STATUS = "VIBECODING_RENDER_LOCKED_100%";`,
  ]
  const lines = Array.isArray(codeLines) && codeLines.length >= 4 ? codeLines : defaultCode
  const visibleLineCount = Math.max(2, Math.min(lines.length, Math.floor(interpolate(frame, [0, Math.min(55, durationInFrames * 0.7)], [2, lines.length], { extrapolateRight: 'clamp' }))))

  const leftSpring = spring({ frame: Math.max(0, frame - 2), fps, config: { damping: 13, stiffness: 160 } })
  const rightSpring = spring({ frame: Math.max(0, frame - 7), fps, config: { damping: 13, stiffness: 160 } })

  // Build SVG Spline Chart points
  const chartW = 680
  const chartH = 185
  const chartPts = Array.from({ length: 14 }, (_, i) => {
    const x = (i / 13) * chartW
    const ratio = i / 13
    const wave = Math.sin(i * 0.85 + seed) * 0.18 + Math.cos(i * 0.45) * 0.1
    const yNorm = Math.max(0.12, Math.min(0.92, 0.25 + ratio * 0.58 + wave + (i === 13 ? bp * 0.08 : 0)))
    const y = chartH - yNorm * (chartH - 28) - 10
    return { x, y }
  })
  const linePath = chartPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L ${chartW} ${chartH} L 0 ${chartH} Z`
  const clipW = chartW * interpolate(frame, [4, Math.min(60, Math.max(24, durationInFrames - 8))], [0.15, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const tipIdx = Math.min(chartPts.length - 1, Math.max(0, Math.floor((clipW / chartW) * (chartPts.length - 1))))
  const tipPt = chartPts[tipIdx] || chartPts[0]

  return (
    <AbsoluteFill
      style={{
        padding: isPortrait ? '170px 44px 290px' : '92px 76px 168px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 24,
        fontFamily: FONT_SANS,
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          transform: `translateY(${interpolate(leftSpring, [0, 1], [28, 0])}px)`,
          opacity: leftSpring,
        }}
      >
        <div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 800, color: accentColor, letterSpacing: 2.2, marginBottom: 6 }}>
            {kicker}
          </div>
          <div style={{ fontSize: isPortrait ? 42 : 48, fontWeight: 900, color: '#FFFFFF', letterSpacing: '-0.02em' }}>
            {title}
          </div>
        </div>
        <div
          style={{
            padding: '6px 16px',
            borderRadius: 999,
            background: 'rgba(15, 23, 42, 0.85)',
            border: `1.5px solid ${goldColor}`,
            fontFamily: FONT_MONO,
            fontSize: 13,
            fontWeight: 800,
            color: goldColor,
          }}
        >
          {`SPRING_SYNC // ${(98.4 + bp * 1.5).toFixed(1)}%`}
        </div>
      </div>

      {/* Main 2-Column Body: Live Code/Terminal Panel + SVG Gauges & Spline Telemetry */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: isPortrait ? 'column' : 'row',
          gap: 26,
          minHeight: 0,
        }}
      >
        {/* Left: Vibecoding Live Code & AST Execution Stream */}
        <div
          style={{
            flex: isPortrait ? '1 1 48%' : '0 0 47%',
            background: 'rgba(7, 12, 24, 0.88)',
            border: `1.5px solid ${accentColor}66`,
            borderRadius: 18,
            padding: '18px 22px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.55)',
            transform: `translateX(${interpolate(leftSpring, [0, 1], [-48, 0])}px) scale(${0.95 + leftSpring * 0.05 + bp * 0.015})`,
            opacity: leftSpring,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, marginBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ display: 'flex', gap: 7 }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#FB7185' }} />
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#FBBF24' }} />
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#34D399' }} />
              </div>
              <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>
                src/scenes/VibecodingStage.tsx
              </span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: '#34D399', fontWeight: 800 }}>
                ● tsc --noEmit 0 ERR
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontFamily: FONT_MONO, fontSize: isPortrait ? 13.5 : 14.5 }}>
              {lines.slice(0, visibleLineCount).map((ln, li) => {
                const isLatest = li === visibleLineCount - 1
                const lnSpring = spring({ frame: Math.max(0, frame - li * 4), fps, config: { damping: 14, stiffness: 180 } })
                return (
                  <div
                    key={li}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '5px 10px',
                      borderRadius: 8,
                      background: isLatest ? `${accentColor}22` : 'transparent',
                      borderLeft: isLatest ? `3px solid ${goldColor}` : '3px solid transparent',
                      transform: `translateX(${interpolate(lnSpring, [0, 1], [18, 0])}px)`,
                      opacity: lnSpring,
                    }}
                  >
                    <span style={{ color: '#64748B', fontSize: 12, width: 22, flexShrink: 0 }}>
                      {String(li + 1).padStart(2, '0')}
                    </span>
                    <span style={{ color: ln.startsWith('//') ? goldColor : isLatest ? '#FFFFFF' : '#CBD5E1', fontWeight: isLatest ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ln}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Bottom Status Pills inside Code Window */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            {(highlights.length > 0 ? highlights : ['Three.js 3D WebGL', 'SVG 拓扑架构', 'Spring 弹簧物理']).slice(0, 3).map((tag, ti) => (
              <span
                key={ti}
                style={{
                  padding: '5px 12px',
                  borderRadius: 8,
                  background: ti === 0 ? `${accentColor}24` : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${ti === 0 ? accentColor : 'rgba(255,255,255,0.14)'}`,
                  color: ti === 0 ? accentColor : '#E2E8F0',
                  fontFamily: FONT_MONO,
                  fontSize: 12.5,
                  fontWeight: 700,
                }}
              >
                {`◆ ${tag}`}
              </span>
            ))}
          </div>
        </div>

        {/* Right: SVG Circular Ring Gauges + Real-Time Spline Area Chart */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            transform: `translateX(${interpolate(rightSpring, [0, 1], [48, 0])}px)`,
            opacity: rightSpring,
          }}
        >
          {/* Top Row: 3 SVG Ring Gauge Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {activeMetrics.map((m, mi) => {
              const gSpring = spring({
                frame: Math.max(0, frame - (8 + mi * 5)),
                fps,
                config: { damping: 12, stiffness: 150 },
              })
              const radius = 32
              const circum = 2 * Math.PI * radius
              const targetRatio = Math.min(0.96, 0.72 + mi * 0.1)
              const dashOffset = circum * (1 - gSpring * targetRatio)
              const ringCol = mi % 2 === 1 ? goldColor : accentColor

              return (
                <div
                  key={mi}
                  style={{
                    background: 'rgba(8, 14, 28, 0.88)',
                    border: `1px solid ${ringCol}55`,
                    borderRadius: 16,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    transform: `scale(${0.92 + gSpring * 0.08 + bp * 0.02})`,
                  }}
                >
                  <svg width={76} height={76} viewBox="0 0 80 80" style={{ flexShrink: 0 }}>
                    <circle cx={40} cy={40} r={radius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={6} />
                    <circle
                      cx={40}
                      cy={40}
                      r={radius}
                      fill="none"
                      stroke={ringCol}
                      strokeWidth={6}
                      strokeLinecap="round"
                      strokeDasharray={circum}
                      strokeDashoffset={dashOffset}
                      transform="rotate(-90 40 40)"
                    />
                    <text x={40} y={45} textAnchor="middle" fill="#FFFFFF" fontFamily={FONT_MONO} fontSize={14} fontWeight={800}>
                      {`${Math.round(gSpring * targetRatio * 100)}%`}
                    </text>
                  </svg>
                  <div style={{ minWidth: 0 }}>
                    <DigitRoll
                      from={0}
                      to={Number(m.value) || 100}
                      startFrame={6 + mi * 4}
                      durationFrames={34}
                      suffix={m.suffix || '%'}
                      decimals={Number(m.value) % 1 !== 0 ? 1 : 0}
                      color={ringCol}
                      fontSize={30}
                    />
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#94A3B8', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.label}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Bottom Card: Animated SVG Spline Area Telemetry Chart */}
          <div
            style={{
              flex: 1,
              background: 'rgba(8, 14, 28, 0.88)',
              border: `1px solid ${accentColor}44`,
              borderRadius: 18,
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 12.5, fontWeight: 800, color: accentColor }}>
                REALTIME TELEMETRY // SPRING & BEAT RESPONSE CURVE
              </span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: goldColor, fontWeight: 700 }}>
                {`PEAK +${(124 + bp * 18).toFixed(1)}%`}
              </span>
            </div>
            <svg viewBox={`0 0 ${chartW} ${chartH}`} width="100%" height="100%" style={{ overflow: 'visible', maxHeight: 190 }}>
              <defs>
                <linearGradient id={`hud-area-${seed}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accentColor} stopOpacity="0.45" />
                  <stop offset="100%" stopColor={accentColor} stopOpacity="0.0" />
                </linearGradient>
                <clipPath id={`hud-clip-${seed}`}>
                  <rect x={0} y={0} width={clipW} height={chartH} />
                </clipPath>
              </defs>
              {/* Grid lines */}
              {[0.25, 0.5, 0.75].map((gy, gi) => (
                <line
                  key={gi}
                  x1={0}
                  y1={chartH * gy}
                  x2={chartW}
                  y2={chartH * gy}
                  stroke="rgba(255,255,255,0.08)"
                  strokeDasharray="6 6"
                  strokeWidth={1}
                />
              ))}
              <g clipPath={`url(#hud-clip-${seed})`}>
                <path d={areaPath} fill={`url(#hud-area-${seed})`} />
                <path d={linePath} fill="none" stroke={accentColor} strokeWidth={3.5} strokeLinecap="round" />
              </g>
              <circle cx={tipPt.x} cy={tipPt.y} r={6 + bp * 3} fill={goldColor} />
              <circle cx={tipPt.x} cy={tipPt.y} r={12 + bp * 5} fill="none" stroke={goldColor} strokeWidth={1.5} opacity={0.65} />
            </svg>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
