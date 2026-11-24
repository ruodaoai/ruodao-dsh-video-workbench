/**
 * figure-kit — stylised people, horses and troops for AI-coded Remotion scenes (any genre).
 *
 * Profile (side-view) figures built from overlapping tapered shapes: joints never gap or dislocate, and there is no
 * drawn face that has to slide around when the head moves (heads are profile silhouettes; flat style adds one eye
 * dot). Six looks share one skeleton:
 *   silhouette 剪影（实色 + 轮廓光 + 披风/盔缨/旗帜点缀色）· papercut 剪纸（镂空纹样 + 纸片投影）·
 *   puppet 皮影（半透明彩色皮料 + 镂空 + 关节铆钉 + 操纵杆）· ink 水墨（毛边墨色）· flat 扁平插画 · stick 火柴人
 * Deterministic: everything is driven by the frame number (no Math.random, no CSS animation).
 * One option, not the look of every film: a film that wants another character style (Q版, 动漫, 绘本 …) draws its own
 * characters. Without a `style` prop a figure is drawn in the neutral colour style `flat`.
 */
import React from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'

// ================================================================================================ public types

export const FIGURE_STYLES = ['silhouette', 'papercut', 'puppet', 'ink', 'flat', 'stick'] as const
export type FigureStyle = (typeof FIGURE_STYLES)[number]

export const FIGURE_ACTIONS = [
  'idle', 'walk', 'run', 'march', 'talk', 'point', 'wave', 'raise', 'cheer', 'clap', 'salute', 'bow', 'kneel', 'kneel-sit',
  'sit', 'sit-ground', 'crouch', 'stand-guard', 'drink', 'write', 'read', 'think', 'type', 'present', 'carry', 'push',
  'swing', 'thrust', 'block', 'ready', 'draw-bow', 'throw', 'jump', 'dance', 'fall', 'collapse', 'look-back', 'ride',
] as const
export type FigureAction = (typeof FIGURE_ACTIONS)[number]

export const FIGURE_PROPS = [
  'none', 'sword', 'spear', 'halberd', 'staff', 'flag', 'bow', 'shield', 'torch', 'lantern', 'scroll', 'book', 'cup', 'brush',
  'fan', 'phone', 'mic', 'laptop', 'tablet', 'briefcase', 'umbrella', 'bag', 'box', 'coffee', 'pen', 'sign', 'wrench',
] as const
export type FigureProp = (typeof FIGURE_PROPS)[number]

export const FIGURE_OUTFITS = ['robe', 'hanfu', 'armor', 'tunic', 'suit', 'casual', 'hoodie', 'dress', 'coat', 'apron', 'lab-coat', 'uniform', 'sport'] as const
export type FigureOutfit = (typeof FIGURE_OUTFITS)[number]
export const FIGURE_HAIR = ['short', 'long', 'bun', 'topknot', 'ponytail', 'bob', 'curly', 'spiky', 'bald'] as const
export type FigureHair = (typeof FIGURE_HAIR)[number]
export const FIGURE_HEADWEAR = ['none', 'helmet', 'plume-helmet', 'crown', 'mian-crown', 'guan', 'hat', 'straw-hat', 'cap', 'beanie', 'hood', 'headband', 'chef-hat', 'hard-hat', 'veil', 'flower'] as const
export type FigureHeadwear = (typeof FIGURE_HEADWEAR)[number]
export const FIGURE_BUILDS = ['average', 'slim', 'heroic', 'stocky', 'child', 'elder'] as const
export type FigureBuild = (typeof FIGURE_BUILDS)[number]

export interface FigureColors {
  skin?: string
  hair?: string
  top?: string
  bottom?: string
  accent?: string
  shoes?: string
  cape?: string
  trim?: string
}

/** Appearance of one person — keep it identical across shots (read it with castLook(scene, id)). */
export interface FigureLook {
  id?: string
  name?: string
  gender?: 'male' | 'female' | 'neutral'
  build?: FigureBuild
  outfit?: FigureOutfit
  hair?: FigureHair
  headwear?: FigureHeadwear
  beard?: 'none' | 'short' | 'long'
  cape?: boolean | 'cape' | 'scarf' | 'none'
  props?: { right?: FigureProp; left?: FigureProp }
  colors?: FigureColors
  /** one character on the banner of a flag prop (e.g. 楚 / 汉) */
  emblem?: string
}

export interface StrikeInput {
  swing?: number
  recoil?: number
  impact?: number
  side?: number
  heavy?: boolean
}

/** One step of an in-shot action sequence: frames are relative to the shot (useCurrentFrame()). */
export interface FigureStep {
  action: FigureAction
  from: number
  dur: number
  /** horizontal travel in px during this step (walk / run / march: the stride follows it, feet never slide) */
  dx?: number
  upper?: FigureAction
}

export interface FigureProps {
  look?: FigureLook
  /** ground point under the feet (px) */
  x: number
  y: number
  /** standing height in px (close-ups: make it huge and let the feet go below the frame) */
  height: number
  facing?: 1 | -1
  action?: FigureAction
  /** upper-body action layered over the legs of `action` (walk + talk, ride + swing …) */
  upper?: FigureAction
  /** one-shot timing in frames (bow / swing / drink / collapse …); hold actions (kneel / sit …) are already in place without it */
  start?: number
  duration?: number
  /** px travelled during `duration` for walk / run / march (stride is matched, feet stay planted) */
  travel?: number
  script?: FigureStep[]
  /** default 'flat' (colour); silhouette / papercut / puppet / ink / stick on request */
  style?: FigureStyle
  /** main colour: silhouette / ink / stick ink, papercut paper colour */
  color?: string
  /** cape / plume / sash / banner colour; null = everything in the main colour */
  accent?: string | null
  /** rim-light colour on the light side (silhouette / ink / papercut) */
  rim?: string | null
  /** light direction in degrees: 0 = light from the right, -90 = from above, 180 = from the left */
  light?: number
  /** -1…1, positive blows from the front to the back of the figure (capes, hair, banners stream backwards) */
  wind?: number
  strike?: StrikeInput | null
  /** seat top height in px for sit / type / write (default: a chair) */
  seat?: number
  frame?: number
  speed?: number
  phase?: number
  opacity?: number
  detail?: 'auto' | 'high' | 'low'
}

// ================================================================================================ math helpers

const D2R = Math.PI / 180
const TAU = Math.PI * 2
type V = { x: number; y: number }
const vec = (x: number, y: number): V => ({ x, y })
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y })
const mul = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k })
const lerpV = (a: V, b: V, t: number): V => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const dist = (a: V, b: V): number => Math.hypot(a.x - b.x, a.y - b.y)
const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const smooth = (t: number): number => {
  const c = clamp(t)
  return c * c * (3 - 2 * c)
}
const easeOut = (t: number): number => 1 - Math.pow(1 - clamp(t), 3)
const easeIn = (t: number): number => Math.pow(clamp(t), 2.2)
const easeInOut = (t: number): number => {
  const c = clamp(t)
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2
}
/** limb direction: 0° = straight down, 90° = forward (+x), 180° = up, -90° = backward */
const dir = (deg: number): V => ({ x: Math.sin(deg * D2R), y: Math.cos(deg * D2R) })
const angOf = (v: V): number => Math.atan2(v.x, v.y) / D2R
/** point in a local frame: lx along the axis, ly to the axis' right-hand side (down for a forward axis) */
const local = (o: V, axisDeg: number, lx: number, ly: number): V => {
  const a = dir(axisDeg)
  const n = dir(axisDeg - 90)
  return { x: o.x + a.x * lx + n.x * ly, y: o.y + a.y * lx + n.y * ly }
}
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}
/** smooth 1-D value noise in [-1, 1] */
const noise = (t: number, seed = 0): number => {
  const i = Math.floor(t)
  const f = t - i
  const a = hash(i + seed * 57.3) * 2 - 1
  const b = hash(i + 1 + seed * 57.3) * 2 - 1
  return lerp(a, b, f * f * (3 - 2 * f))
}
const fmt = (n: number): string => String(Math.round(n * 100) / 100)
const pt = (p: V): string => `${fmt(p.x)} ${fmt(p.y)}`

function polyPath(points: V[], close = true): string {
  if (!points.length) return ''
  return `M${points.map(pt).join('L')}${close ? 'Z' : ''}`
}

/** Catmull-Rom spline through the points as cubic Béziers; `corner[i]` keeps point i sharp. */
function smoothPath(points: V[], closed = true, tension = 1, corner?: boolean[]): string {
  const n = points.length
  if (n < 3) return polyPath(points, closed)
  const at = (i: number): V => (closed ? points[(i + n) % n] : points[Math.max(0, Math.min(n - 1, i))])
  let d = `M${pt(points[0])}`
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const k = tension / 6
    const c1 = corner && corner[i % n] ? p1 : vec(p1.x + (p2.x - p0.x) * k, p1.y + (p2.y - p0.y) * k)
    const c2 = corner && corner[(i + 1) % n] ? p2 : vec(p2.x - (p3.x - p1.x) * k, p2.y - (p3.y - p1.y) * k)
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`
  }
  return closed ? `${d}Z` : d
}

function circlePath(c: V, r: number): string {
  return `M${fmt(c.x - r)} ${fmt(c.y)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0Z`
}

function ellipsePath(c: V, rx: number, ry: number, rotDeg = 0): string {
  const pts: V[] = []
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU
    const x = Math.cos(a) * rx
    const y = Math.sin(a) * ry
    const r = rotDeg * D2R
    pts.push(vec(c.x + x * Math.cos(r) - y * Math.sin(r), c.y + x * Math.sin(r) + y * Math.cos(r)))
  }
  return smoothPath(pts, true)
}

/** Tapered capsule between two circles (exact outer tangents): the building block of every limb. */
function capsule(a: V, ra: number, b: V, rb: number): string {
  const d = dist(a, b)
  if (d < 1e-4 || d <= Math.abs(ra - rb) + 1e-4) return circlePath(ra >= rb ? a : b, Math.max(ra, rb))
  const th = Math.atan2(b.y - a.y, b.x - a.x)
  const phi = Math.acos(clamp((ra - rb) / d, -1, 1))
  const a1 = vec(a.x + ra * Math.cos(th + phi), a.y + ra * Math.sin(th + phi))
  const b1 = vec(b.x + rb * Math.cos(th + phi), b.y + rb * Math.sin(th + phi))
  const b2 = vec(b.x + rb * Math.cos(th - phi), b.y + rb * Math.sin(th - phi))
  const a2 = vec(a.x + ra * Math.cos(th - phi), a.y + ra * Math.sin(th - phi))
  const largeB = 2 * phi > Math.PI ? 1 : 0
  const largeA = TAU - 2 * phi > Math.PI ? 1 : 0
  return `M${pt(a1)}L${pt(b1)}A${fmt(rb)} ${fmt(rb)} 0 ${largeB} 0 ${pt(b2)}L${pt(a2)}A${fmt(ra)} ${fmt(ra)} 0 ${largeA} 0 ${pt(a1)}Z`
}

/** Points of a flowing chain (cloth, hair, plume, tail): starts at `base`, bends from `startDeg` to `endDeg`. */
function chain(base: V, startDeg: number, endDeg: number, length: number, segs: number, wave: number, phase: number): V[] {
  const out: V[] = [base]
  let p = base
  const seg = length / segs
  for (let i = 1; i <= segs; i++) {
    const t = i / segs
    const a = lerp(startDeg, endDeg, Math.pow(t, 0.8)) + Math.sin(phase - t * 3.1) * wave * t
    p = add(p, mul(dir(a), seg))
    out.push(p)
  }
  return out
}

/** Ribbon polygon around a chain with a width that tapers from w0 to w1. */
function ribbon(points: V[], w0: number, w1: number, flare = 0): string {
  return ribbonW(points, (t) => lerp(w0, w1, t) + flare * Math.pow(t, 3))
}

/** Ribbon polygon around a chain with a width profile w(t), t = 0 at the base … 1 at the tip. */
function ribbonW(points: V[], width: (t: number) => number): string {
  const left: V[] = []
  const right: V[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)]
    const b = points[Math.min(points.length - 1, i + 1)]
    const t = i / Math.max(1, points.length - 1)
    const w = width(t)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l = Math.hypot(dx, dy) || 1
    const nx = -dy / l
    const ny = dx / l
    left.push(vec(points[i].x + nx * w * 0.5, points[i].y + ny * w * 0.5))
    right.push(vec(points[i].x - nx * w * 0.5, points[i].y - ny * w * 0.5))
  }
  return smoothPath([...left, ...right.reverse()], true)
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!m) return [0, 0, 0]
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
/** Mix two colours (t = 0 → a, 1 → b). */
export function mixColor(a: string, b: string, t: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  const c = ca.map((v, i) => Math.round(lerp(v, cb[i], clamp(t))))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
const shade = (c: string, k: number): string => (k >= 0 ? mixColor(c, '#FFFFFF', k) : mixColor(c, '#000000', -k))

// ================================================================================================ body dimensions

const TORSO_U = [-0.1, 0, 0.15, 0.35, 0.55, 0.75, 0.9, 1]

interface Dims {
  head: number
  neck: number
  spine: number
  upperArm: number
  foreArm: number
  hand: number
  thigh: number
  shin: number
  ankleH: number
  foot: number
  rSh: number
  rEl: number
  rWr: number
  rHip: number
  rKnee: number
  rCalf: number
  rAnk: number
  rNeck: number
  fr: number[]
  bk: number[]
  stoop: number
  female: boolean
  child: boolean
}

function buildDims(look: FigureLook): Dims {
  const b: FigureBuild = look.build || 'average'
  const female = look.gender === 'female'
  const d: Dims = {
    head: 13.5, neck: 4.6, spine: 30, upperArm: 17, foreArm: 14.6, hand: 6.2, thigh: 24, shin: 23, ankleH: 3.4, foot: 12.6,
    rSh: 3.1, rEl: 2.3, rWr: 1.6, rHip: 4.8, rKnee: 3.0, rCalf: 3.35, rAnk: 1.85, rNeck: 2.85,
    fr: [4.6, 6.4, 6.2, 5.6, 6.6, 8.0, 5.7, 3.0],
    bk: [6.4, 7.6, 7.0, 5.0, 5.6, 7.0, 4.9, 3.0],
    stoop: 0, female, child: b === 'child',
  }
  if (female) {
    Object.assign(d, { head: 13.2, rSh: 2.7, rEl: 2.0, rWr: 1.4, rHip: 4.9, rKnee: 2.7, rCalf: 3.1, rAnk: 1.6, rNeck: 2.4 })
    d.fr = [4.4, 6.0, 5.8, 4.7, 5.4, 7.4, 5.0, 2.7]
    d.bk = [7.0, 8.6, 7.6, 4.4, 4.9, 6.0, 4.4, 2.6]
  }
  const radii = (k: number) => {
    for (const key of ['rSh', 'rEl', 'rWr', 'rHip', 'rKnee', 'rCalf', 'rAnk', 'rNeck'] as const) d[key] *= k
  }
  if (b === 'heroic') {
    d.head *= 0.94
    d.spine *= 1.03
    d.thigh *= 1.04
    d.shin *= 1.04
    radii(1.08)
    d.rSh += 0.35
    d.fr[5] += 1.4
    d.fr[6] += 0.5
    d.bk[5] += 0.9
  } else if (b === 'slim') {
    radii(0.86)
    d.fr = d.fr.map((v) => v * 0.88)
    d.bk = d.bk.map((v) => v * 0.9)
  } else if (b === 'stocky') {
    d.head *= 1.04
    d.thigh *= 0.93
    d.shin *= 0.92
    radii(1.18)
    d.fr = d.fr.map((v) => v * 1.14)
    d.fr[3] += 2.4
    d.fr[4] += 1.6
    d.bk = d.bk.map((v) => v * 1.1)
  } else if (b === 'child') {
    Object.assign(d, { head: 19, neck: 3, spine: 22, upperArm: 12, foreArm: 10.5, hand: 4.8, thigh: 15.5, shin: 14, ankleH: 2.6, foot: 9 })
    radii(0.84)
    d.fr = [4.4, 6.2, 6.6, 6.8, 6.4, 6.2, 4.8, 2.8]
    d.bk = [5.8, 6.6, 6.2, 5.4, 5.4, 5.6, 4.4, 2.8]
  } else if (b === 'elder') {
    d.stoop = 10
    d.spine *= 0.97
    radii(0.95)
  }
  const standing = d.ankleH + d.shin + d.thigh + d.spine + d.neck + d.head * 0.89
  const k = 100 / standing
  for (const key of ['head', 'neck', 'spine', 'upperArm', 'foreArm', 'hand', 'thigh', 'shin', 'ankleH', 'foot', 'rSh', 'rEl', 'rWr', 'rHip', 'rKnee', 'rCalf', 'rAnk', 'rNeck'] as const) d[key] *= k
  d.fr = d.fr.map((v) => v * k)
  d.bk = d.bk.map((v) => v * k)
  return d
}

const interpTorso = (arr: number[], u: number): number => {
  if (u <= TORSO_U[0]) return arr[0]
  for (let i = 1; i < TORSO_U.length; i++) {
    if (u <= TORSO_U[i]) {
      const t = (u - TORSO_U[i - 1]) / (TORSO_U[i] - TORSO_U[i - 1])
      return lerp(arr[i - 1], arr[i], smooth(t))
    }
  }
  return arr[arr.length - 1]
}

// ================================================================================================ poses

type Hand = 'relax' | 'fist' | 'open' | 'point'

interface Pose {
  lean: number
  bend: number
  neck: number
  sF: number
  eF: number
  wF: number
  sB: number
  eB: number
  wB: number
  hF: number
  kF: number
  aF: number
  hB: number
  kB: number
  aB: number
  lift: number
  seat: number
  handF: Hand
  handB: Hand
  /** blade / short prop angle relative to the hand axis */
  propF: number
  propB: number
  /** absolute angle of a long prop (spear, flag …) held in the hand; NaN = follow the hand */
  poleF: number
  poleB: number
  /** IK targets (torso frame: x forward, y down the spine) relative to the shoulder; NaN = use angles */
  ikFx: number
  ikFy: number
  ikBx: number
  ikBy: number
  /** far hand grips the near hand's long prop this many units further along it (NaN = no) */
  twoHand: number
  flip: number
  /** long prop of the near hand: 0 = in the near hand, 1 = moved to the far hand, 2 = set down (both hands busy) */
  longTo: number
  mouth: number
  /** cup / bow-string state etc. */
  tilt: number
  draw: number
}

const BASE: Pose = {
  lean: 2, bend: 0, neck: 0, sF: 6, eF: 14, wF: 0, sB: -4, eB: 12, wB: 0, hF: 3, kF: 3, aF: 0, hB: -3, kB: 2, aB: 0, lift: 0, seat: 0,
  handF: 'relax', handB: 'relax', propF: 0, propB: 0, poleF: NaN, poleB: NaN, ikFx: NaN, ikFy: NaN, ikBx: NaN, ikBy: NaN, twoHand: NaN,
  flip: 0, longTo: 0, mouth: 0, tilt: 0, draw: 0,
}

const NUM_KEYS = ['lean', 'bend', 'neck', 'sF', 'eF', 'wF', 'sB', 'eB', 'wB', 'hF', 'kF', 'aF', 'hB', 'kB', 'aB', 'lift', 'seat', 'propF', 'propB', 'flip', 'longTo', 'mouth', 'tilt', 'draw'] as const
const NAN_KEYS = ['poleF', 'poleB', 'ikFx', 'ikFy', 'ikBx', 'ikBy', 'twoHand'] as const

function blendPose(a: Pose, b: Pose, t: number): Pose {
  if (t <= 0) return a
  if (t >= 1) return b
  const out: Pose = { ...b }
  for (const k of NUM_KEYS) out[k] = lerp(a[k], b[k], t)
  for (const k of NAN_KEYS) {
    const av = a[k]
    const bv = b[k]
    out[k] = Number.isNaN(av) ? (t < 0.5 ? NaN : bv) : Number.isNaN(bv) ? (t < 0.5 ? av : NaN) : lerp(av, bv, t)
  }
  out.handF = t < 0.5 ? a.handF : b.handF
  out.handB = t < 0.5 ? a.handB : b.handB
  return out
}

/** periodic Catmull-Rom through [phase, v1, v2, v3] keys */
function cycleKeys(keys: number[][], p: number): number[] {
  const n = keys.length
  const ph = ((p % 1) + 1) % 1
  let i = n - 1
  for (let j = 0; j < n; j++) if (keys[j][0] <= ph) i = j
  const k1 = keys[i]
  const k2 = keys[(i + 1) % n]
  const k0 = keys[(i - 1 + n) % n]
  const k3 = keys[(i + 2) % n]
  const p1 = k1[0]
  let p2 = k2[0]
  if (p2 <= p1) p2 += 1
  let local = ph
  if (local < p1) local += 1
  const t = (local - p1) / Math.max(1e-6, p2 - p1)
  const out: number[] = []
  for (let c = 1; c < k1.length; c++) {
    const v0 = k0[c]
    const v1 = k1[c]
    const v2 = k2[c]
    const v3 = k3[c]
    const t2 = t * t
    const t3 = t2 * t
    out.push(0.5 * (2 * v1 + (-v0 + v2) * t + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 + (-v0 + 3 * v1 - 3 * v2 + v3) * t3))
  }
  return out
}

// [phase, hip, knee, ankle(+ = toes down)]
const WALK_LEG = [[0, 24, 4, -10], [0.12, 18, 15, -2], [0.3, 4, 6, 2], [0.5, -16, 8, 14], [0.62, -12, 40, 30], [0.75, 8, 60, 12], [0.88, 24, 26, -6]]
const MARCH_LEG = [[0, 22, 2, -8], [0.12, 16, 10, -2], [0.3, 3, 3, 2], [0.5, -15, 5, 12], [0.62, -10, 32, 26], [0.76, 14, 50, 8], [0.88, 26, 14, -6]]
const RUN_LEG = [[0, 30, 16, -6], [0.14, 12, 30, 8], [0.3, -20, 12, 28], [0.42, -30, 55, 40], [0.58, -6, 108, 30], [0.75, 40, 82, 4], [0.9, 42, 26, -8]]

/** seconds per cycle */
const CYCLE: Partial<Record<FigureAction, number>> = {
  idle: 3.6, walk: 1.05, march: 1.0, run: 0.66, talk: 2.4, wave: 0.7, cheer: 0.8, clap: 0.42, dance: 0.9, type: 0.36, write: 1.4, ride: 0.6, read: 4, 'stand-guard': 3.6,
}
/** default length of one-shot actions (frames at 30 fps) */
const ONE_SHOT: Partial<Record<FigureAction, number>> = {
  raise: 24, point: 18, salute: 40, bow: 48, drink: 60, swing: 26, thrust: 22, block: 16, ready: 14, 'draw-bow': 50, throw: 26, jump: 32, fall: 40, collapse: 54, 'look-back': 20, kneel: 22, 'kneel-sit': 26, sit: 24, 'sit-ground': 26, crouch: 16, present: 20, think: 20, carry: 16, push: 20,
}
/** actions already in their final pose at frame 0 unless `start` is given */
const HOLD_ACTIONS = new Set<FigureAction>(['kneel', 'kneel-sit', 'sit', 'sit-ground', 'crouch', 'think', 'present', 'carry', 'push', 'ready'])
const LOCOMOTION = new Set<FigureAction>(['walk', 'run', 'march'])
/** units travelled per cycle (matches the stance-foot sweep of the leg keys) */
const STRIDE: Partial<Record<FigureAction, number>> = { walk: 74, march: 70, run: 118 }

const LONG_PROPS = new Set<FigureProp>(['spear', 'halberd', 'staff', 'flag', 'torch', 'lantern', 'umbrella', 'sign'])
const WEAPON_ACTIONS = new Set<FigureAction>(['swing', 'thrust', 'block', 'ready', 'raise', 'throw', 'draw-bow'])

interface ActCtx {
  t: number
  p: number
  cyc: number
  propF: FigureProp
  propB: FigureProp
  strike: StrikeInput | null
}

function walkLike(keys: number[][], c: ActCtx, armAmp: number, lean: number): Pose {
  const [hF, kF, aF] = cycleKeys(keys, c.cyc)
  const [hB, kB, aB] = cycleKeys(keys, c.cyc + 0.5)
  const sw = Math.cos(TAU * c.cyc)
  return {
    ...BASE,
    lean: lean + 0.8 * Math.cos(2 * TAU * c.cyc),
    neck: -1,
    hF, kF, aF, hB, kB, aB,
    sF: 4 - armAmp * sw,
    eF: 12 + 14 * (1 - sw) * 0.5,
    sB: 4 + armAmp * sw,
    eB: 12 + 14 * (1 + sw) * 0.5,
  }
}

function idlePose(c: ActCtx): Pose {
  const br = Math.sin((c.t * TAU) / 3.6)
  const sway = noise(c.t * 0.35, 3)
  return { ...BASE, lean: 2 + br * 0.5, neck: sway * 2 - 0.5, sF: 6 + br * 1.2, sB: -4 + br, eF: 14 + sway * 2, hF: 3 + sway, hB: -3 + sway }
}

function poseFor(action: FigureAction, c: ActCtx): Pose {
  const p = c.p
  switch (action) {
    case 'idle':
      return idlePose(c)
    case 'walk':
      return walkLike(WALK_LEG, c, 17, 4)
    case 'march': {
      const ps = walkLike(MARCH_LEG, c, 24, 3)
      ps.eF = 8 + 8 * (1 - Math.cos(TAU * c.cyc)) * 0.5
      ps.eB = 8 + 8 * (1 + Math.cos(TAU * c.cyc)) * 0.5
      return ps
    }
    case 'run': {
      const [hF, kF, aF] = cycleKeys(RUN_LEG, c.cyc)
      const [hB, kB, aB] = cycleKeys(RUN_LEG, c.cyc + 0.5)
      const sw = Math.cos(TAU * c.cyc)
      return { ...BASE, lean: 13 + Math.cos(2 * TAU * c.cyc), neck: -6, hF, kF, aF, hB, kB, aB, sF: 10 - 40 * sw, eF: 86 + 10 * sw, sB: 10 + 40 * sw, eB: 86 - 10 * sw, handF: 'fist', handB: 'fist', lift: 1.6 * Math.max(0, Math.sin(2 * TAU * (c.cyc - 0.33))) }
    }
    case 'talk': {
      const ps = idlePose(c)
      ps.sF = 26 + 9 * Math.sin(c.t * 2.3)
      ps.eF = 72 + 16 * Math.sin(c.t * 3.1 + 1)
      ps.wF = -12 + 10 * Math.sin(c.t * 4.1)
      ps.handF = 'open'
      ps.neck = 3 * Math.sin(c.t * 2.7)
      ps.mouth = 0.5 + 0.5 * Math.sin(c.t * 17)
      return ps
    }
    case 'point': {
      const r = easeOut(p)
      return { ...idlePose(c), sF: lerp(6, 84, r), eF: lerp(14, 4, r), wF: 0, lean: lerp(2, 4, r), handF: r > 0.4 ? 'point' : 'relax' }
    }
    case 'wave': {
      const ps = idlePose(c)
      ps.sF = 150
      ps.eF = 26 + 24 * Math.sin(TAU * c.cyc)
      ps.wF = 8 * Math.sin(TAU * c.cyc + 0.6)
      ps.handF = 'open'
      return ps
    }
    case 'raise': {
      const r = easeOut(p)
      return { ...idlePose(c), sF: lerp(6, 168, r), eF: lerp(14, 6, r), lean: lerp(2, -3, r), neck: lerp(0, -7, r), handF: 'fist', propF: lerp(40, 0, r), poleF: lerp(176, 160, r) }
    }
    case 'cheer': {
      const s = Math.sin(TAU * c.cyc)
      return { ...BASE, lean: -3, neck: -7, sF: 150 + 14 * s, eF: 18 + 16 * Math.max(0, s), sB: 146 + 14 * Math.sin(TAU * c.cyc + 0.7), eB: 18 + 16 * Math.max(0, -s), handF: 'fist', handB: 'fist', kF: 6 + 9 * Math.abs(s), kB: 6 + 9 * Math.abs(s), hF: 4 + 5 * Math.abs(s), hB: 2 + 5 * Math.abs(s) }
    }
    case 'clap': {
      const q = (1 + Math.cos(TAU * c.cyc)) * 0.5
      return { ...idlePose(c), lean: 3, ikFx: 9 + q * 2.6, ikFy: 9 - q * 1.2, ikBx: 8.6 - q * 2.6, ikBy: 9.6, handF: 'open', handB: 'open' }
    }
    case 'salute': {
      const r = easeInOut(p / 0.4)
      const back = easeInOut((p - 0.75) / 0.25)
      return { ...idlePose(c), lean: lerp(2, 18, r) - back * 10, neck: lerp(0, 6, r), ikFx: lerp(5, 10.5, r), ikFy: lerp(26, 7.5, r), ikBx: lerp(4, 10, r), ikBy: lerp(26, 8.2, r), handF: 'fist', handB: 'fist' }
    }
    case 'bow': {
      const r = easeInOut(p / 0.35) - easeInOut((p - 0.72) / 0.28) * 0.85
      const lean = lerp(2, 50, r)
      return { ...BASE, lean, neck: lerp(0, 10, r), sF: -lean * 0.85 + 6, eF: 12, sB: -lean * 0.85 + 2, eB: 14, hF: lerp(3, -4, r), hB: lerp(-3, -6, r) }
    }
    case 'kneel': {
      const r = easeInOut(p)
      return { ...idlePose(c), lean: lerp(2, 6, r), neck: lerp(0, 9, r), hF: lerp(3, 80, r), kF: lerp(3, 84, r), aF: lerp(0, -2, r), hB: lerp(-3, 4, r), kB: lerp(2, 112, r), aB: lerp(0, 8, r), sF: lerp(6, 44, r), eF: lerp(14, 52, r), sB: lerp(-4, 2, r), eB: lerp(12, 22, r) }
    }
    case 'kneel-sit': {
      const r = easeInOut(p)
      return { ...idlePose(c), lean: lerp(2, 0, r), neck: lerp(0, 3, r), hF: lerp(3, 92, r), kF: lerp(3, 176, r), aF: lerp(0, 88, r), hB: lerp(-3, 88, r), kB: lerp(2, 176, r), aB: lerp(0, 88, r), ikFx: lerp(NaN, 11, r), ikFy: lerp(NaN, 19, r), ikBx: 10, ikBy: 20, handF: 'relax', handB: 'relax' }
    }
    case 'sit': {
      const r = easeInOut(p)
      return { ...idlePose(c), lean: lerp(2, -2, r), hF: lerp(3, 86, r), kF: lerp(3, 84, r), hB: lerp(-3, 84, r), kB: lerp(2, 80, r), seat: r > 0.02 ? 1 : 0, ikFx: r > 0.5 ? 11 : NaN, ikFy: 17, ikBx: r > 0.5 ? 10 : NaN, ikBy: 18 }
    }
    case 'sit-ground': {
      const r = easeInOut(p)
      return { ...idlePose(c), lean: lerp(2, -4, r), hF: lerp(3, 66, r), kF: lerp(3, 122, r), aF: lerp(0, -40, r), hB: lerp(-3, 60, r), kB: lerp(2, 116, r), aB: lerp(0, -38, r), sF: lerp(6, 48, r), eF: lerp(14, 26, r), sB: lerp(-4, -34, r), eB: lerp(12, 2, r), handB: 'open' }
    }
    case 'crouch': {
      const r = easeInOut(p)
      return { ...idlePose(c), lean: lerp(2, 30, r), neck: lerp(0, -12, r), hF: lerp(3, 96, r), kF: lerp(3, 122, r), aF: lerp(0, -24, r), hB: lerp(-3, 86, r), kB: lerp(2, 116, r), aB: lerp(0, -22, r), sF: lerp(6, 40, r), eF: lerp(14, 30, r), sB: lerp(-4, 30, r), eB: lerp(12, 34, r) }
    }
    case 'stand-guard': {
      const ps = idlePose(c)
      return { ...ps, lean: 0.5 + (ps.lean - 2) * 0.5, neck: -2, hF: 1, hB: -1, sF: 14, eF: 74, poleF: 178, handF: 'fist' }
    }
    case 'drink': {
      const up = easeInOut(p / 0.3) - easeInOut((p - 0.72) / 0.28)
      const sip = smooth((p - 0.3) / 0.12) - smooth((p - 0.62) / 0.1)
      return { ...idlePose(c), ikFx: lerp(9, 7.5, up), ikFy: lerp(18, -7.8, up), neck: lerp(0, -10, sip), lean: lerp(2, -1, sip), handF: 'fist', tilt: sip }
    }
    case 'write': {
      const ps = poseFor('sit', { ...c, p: 1 })
      const w = c.cyc * TAU
      return { ...ps, lean: 14, neck: 14, ikFx: 14 + Math.cos(w) * 1.2, ikFy: 20 + Math.sin(w * 2) * 0.8, ikBx: 12, ikBy: 22, handF: 'fist', handB: 'relax' }
    }
    case 'read': {
      const ps = idlePose(c)
      return { ...ps, neck: 14, lean: 4, ikFx: 11, ikFy: 10 + Math.sin(c.t * 0.8) * 0.4, ikBx: 10.5, ikBy: 11, handF: 'fist', handB: 'fist' }
    }
    case 'think': {
      const r = easeInOut(p)
      return { ...idlePose(c), lean: lerp(2, -1, r), neck: lerp(0, 7, r), ikFx: lerp(5, 7.2, r), ikFy: lerp(24, -6.6, r), ikBx: lerp(4, 7, r), ikBy: lerp(24, 17, r), handF: 'fist' }
    }
    case 'type': {
      const ps = poseFor('sit', { ...c, p: 1 })
      const tap = Math.sin(TAU * c.cyc)
      return { ...ps, lean: 6, neck: 10, ikFx: 15, ikFy: 13.5 + tap * 0.5, ikBx: 14.4, ikBy: 13.8 - tap * 0.5, handF: 'open', handB: 'open' }
    }
    case 'present': {
      const r = easeOut(p)
      return { ...idlePose(c), lean: lerp(2, -1, r), sF: lerp(6, 44, r) + Math.sin(c.t * 1.7) * 4, eF: lerp(14, 62, r), wF: lerp(0, -34, r), handF: 'open' }
    }
    case 'carry': {
      const r = easeOut(p)
      return { ...idlePose(c), lean: lerp(2, -4, r), ikFx: lerp(5, 11.5, r), ikFy: lerp(26, 17, r), ikBx: lerp(4, 11, r), ikBy: lerp(26, 17.5, r), handF: 'open', handB: 'open' }
    }
    case 'push': {
      const r = easeOut(p)
      return { ...idlePose(c), lean: lerp(2, 22, r), hF: lerp(3, 20, r), kF: lerp(3, 16, r), hB: lerp(-3, -28, r), kB: lerp(2, 6, r), aB: lerp(0, 16, r), ikFx: lerp(5, 17, r), ikFy: lerp(26, 7, r), ikBx: lerp(4, 16.4, r), ikBy: lerp(26, 7.6, r), handF: 'open', handB: 'open' }
    }
    case 'swing':
      return swingPose(c)
    case 'thrust':
      return thrustPose(c)
    case 'block': {
      const r = easeOut(p)
      return { ...idlePose(c), lean: lerp(2, -3, r), hF: lerp(3, 18, r), kF: lerp(3, 16, r), hB: lerp(-3, -16, r), kB: lerp(2, 6, r), ikFx: lerp(6, 4, r), ikFy: lerp(24, -16, r), poleF: 92, propF: 90, twoHand: -15, handF: 'fist', handB: 'fist' }
    }
    case 'ready': {
      const r = easeInOut(p)
      const br = Math.sin((c.t * TAU) / 3.2)
      const legs = { lean: lerp(2, 5, r) + br * 0.6, neck: lerp(0, -3, r), hF: lerp(3, 16, r), kF: lerp(3, 12, r), hB: lerp(-3, -14, r), kB: lerp(2, 6, r), aB: lerp(0, 6, r) }
      if (LONG_PROPS.has(c.propF)) {
        // long weapon held level in both hands: near hand forward, far hand on the shaft a little behind it
        return { ...idlePose(c), ...legs, ikFx: lerp(6, 14.5, r), ikFy: lerp(24, 12.5 + br * 0.4, r), poleF: lerp(176, 84, r), twoHand: -12, handF: 'fist', handB: 'fist' }
      }
      // sword / short weapon / empty hands: guard in front of the chest, the other hand ready
      return { ...idlePose(c), ...legs, ikFx: lerp(6, 11, r), ikFy: lerp(24, 15 + br * 0.4, r), propF: lerp(30, 52, r), ikBx: lerp(4, 9, r), ikBy: lerp(26, 17, r), handF: 'fist', handB: 'fist' }
    }
    case 'draw-bow': {
      const drawUp = easeInOut(p / 0.5)
      const released = p > 0.82
      const after = smooth((p - 0.82) / 0.1)
      return { ...idlePose(c), lean: -1, neck: -2, hF: 14, kF: 4, hB: -14, kB: 2, sB: lerp(-4, 88, easeOut(p / 0.25)), eB: lerp(12, 2, easeOut(p / 0.25)), ikFx: released ? lerp(9, 1, after) : lerp(16, 3, drawUp), ikFy: released ? lerp(-3, -4, after) : lerp(-1, -4, drawUp), handF: 'fist', handB: 'fist', draw: released ? 0 : drawUp }
    }
    case 'throw': {
      const wind = easeInOut(p / 0.4)
      const rel = easeOut((p - 0.4) / 0.18)
      const fol = smooth((p - 0.58) / 0.42)
      return { ...idlePose(c), lean: lerp(lerp(2, -8, wind), 14, rel) - fol * 6, sF: lerp(lerp(6, -60, wind), 150, rel) - fol * 70, eF: lerp(lerp(14, 50, wind), 10, rel) + fol * 10, hF: lerp(3, 22, wind), kF: 8, hB: lerp(-3, -18, wind), handF: 'fist' }
    }
    case 'jump': {
      const cr = easeInOut(p / 0.25)
      const ext = easeOut((p - 0.25) / 0.13)
      const air = clamp((p - 0.38) / 0.4)
      const land = easeOut((p - 0.78) / 0.12)
      const rec = easeInOut((p - 0.9) / 0.1)
      const crouchK = cr * (1 - ext) + land * (1 - rec) * 0.6
      return {
        ...BASE,
        lean: 2 + crouchK * 18 - ext * 4,
        hF: 3 + crouchK * 50 + (air > 0 && air < 1 ? 12 : 0),
        kF: 3 + crouchK * 95 + (air > 0 && air < 1 ? 28 : 0),
        aF: crouchK * 30 + ext * (1 - land) * 30,
        hB: -3 + crouchK * 46 + (air > 0 && air < 1 ? 6 : 0),
        kB: 2 + crouchK * 92 + (air > 0 && air < 1 ? 34 : 0),
        aB: crouchK * 28 + ext * (1 - land) * 30,
        sF: lerp(lerp(6, -36, cr), 150, ext) * (1 - land) + land * lerp(30, 6, rec),
        eF: 14,
        sB: lerp(lerp(-4, -40, cr), 140, ext) * (1 - land) + land * lerp(20, -4, rec),
        eB: 14,
        lift: air > 0 && air < 1 ? 26 * Math.sin(Math.PI * air) : 0,
        handF: 'open',
        handB: 'open',
      }
    }
    case 'dance': {
      const s = Math.sin(TAU * c.cyc)
      return { ...BASE, lean: 4 * s, neck: 4 * Math.sin(2 * TAU * c.cyc), sF: 100 + 55 * s, eF: 40 + 30 * Math.sin(TAU * c.cyc + 1), sB: 100 - 55 * s, eB: 40 + 30 * Math.sin(TAU * c.cyc + 2), hF: 12 * s, kF: 10 + 16 * Math.max(0, s), hB: -12 * s, kB: 10 + 16 * Math.max(0, -s), aF: 6, aB: 6, handF: 'open', handB: 'open' }
    }
    case 'fall': {
      const r = easeIn(p / 0.7)
      const fling = easeOut(p / 0.4)
      return { ...BASE, lean: lerp(2, -82, r), neck: lerp(0, -8, r), sF: lerp(6, 150, fling) - r * 40, eF: 30, sB: lerp(-4, 124, fling) - r * 34, eB: 40, hF: lerp(3, 78, r), kF: lerp(3, 14, r), aF: lerp(0, 8, r), hB: lerp(-3, 70, r), kB: lerp(2, 24, r), aB: lerp(0, 6, r), handF: 'open', handB: 'open' }
    }
    case 'collapse': {
      const kneel = easeInOut(p / 0.4)
      const down = easeIn((p - 0.4) / 0.45)
      return {
        ...BASE,
        lean: lerp(lerp(2, 24, kneel), 84, down),
        neck: lerp(lerp(0, 16, kneel), 4, down),
        hF: lerp(lerp(3, 58, kneel), 16, down),
        kF: lerp(lerp(3, 112, kneel), 26, down),
        aF: lerp(0, 40, down),
        hB: lerp(lerp(-3, 52, kneel), 10, down),
        kB: lerp(lerp(2, 116, kneel), 30, down),
        aB: lerp(0, 40, down),
        sF: lerp(lerp(6, 10, kneel), 70, down),
        eF: lerp(14, 20, down),
        sB: lerp(lerp(-4, 4, kneel), 60, down),
        eB: lerp(12, 30, down),
        handF: 'open',
        handB: 'open',
      }
    }
    case 'look-back': {
      const ps = idlePose(c)
      return { ...ps, flip: smooth((p - 0.15) / 0.35), lean: ps.lean - 1, sB: ps.sB - 6 }
    }
    case 'ride': {
      const b = Math.sin(TAU * c.cyc)
      return { ...BASE, lean: 7 + b * 1.6, neck: -3 - b * 1.5, hF: 64, kF: 96, aF: -6, hB: 60, kB: 92, aB: -4, ikFx: 12.5, ikFy: 15 + b * 0.8, ikBx: 12, ikBy: 15.6 + b * 0.8, handF: 'fist', handB: 'fist' }
    }
    default:
      return idlePose(c)
  }
}

function swingPose(c: ActCtx): Pose {
  const ready = { lean: -5, sF: 158, eF: 74, propF: 74, hF: 10, kF: 6, hB: -10, kB: 4 }
  const hit = { lean: 13, sF: 66, eF: 4, propF: 22, hF: 32, kF: 22, hB: -26, kB: 6 }
  const guard = { lean: 4, sF: 104, eF: 40, propF: 60, hF: 20, kF: 12, hB: -18, kB: 5 }
  let q = 0
  let rec = 0
  if (c.strike) {
    q = clamp(c.strike.swing ?? 0)
    rec = clamp(c.strike.recoil ?? 0)
  } else {
    const p = c.p
    q = p < 0.35 ? 0 : easeIn((p - 0.35) / 0.2)
    rec = p < 0.55 ? 0 : 1 - smooth((p - 0.55) / 0.45)
    if (p >= 0.55) q = 0
  }
  const wind = c.strike ? 1 : easeInOut(c.p / 0.35)
  const side = (c.strike?.side ?? 1) < 0 ? -1 : 1
  const mix = (k: 'lean' | 'sF' | 'eF' | 'propF' | 'hF' | 'kF' | 'hB' | 'kB'): number => {
    const r = side > 0 ? ready[k] : k === 'sF' ? 24 : k === 'eF' ? 30 : k === 'propF' ? 120 : ready[k]
    const h = side > 0 ? hit[k] : k === 'sF' ? 132 : k === 'eF' ? 8 : k === 'propF' ? 10 : hit[k]
    const g = guard[k]
    const base = (BASE as unknown as Record<string, number>)[k] ?? 0
    const pre = lerp(base, r, wind)
    if (q > 0) return lerp(pre, h, q)
    if (rec > 0) return lerp(g, h, rec)
    return c.strike ? g : pre
  }
  return {
    ...BASE,
    lean: mix('lean'),
    sF: mix('sF'),
    eF: mix('eF'),
    propF: mix('propF'),
    hF: mix('hF'),
    kF: mix('kF'),
    hB: mix('hB'),
    kB: mix('kB'),
    sB: 24,
    eB: 40,
    handF: 'fist',
    handB: 'fist',
    poleF: NaN,
  }
}

function thrustPose(c: ActCtx): Pose {
  let q = 0
  let rec = 0
  if (c.strike) {
    q = clamp(c.strike.swing ?? 0)
    rec = clamp(c.strike.recoil ?? 0)
  } else {
    q = c.p < 0.4 ? 0 : easeIn((c.p - 0.4) / 0.18)
    rec = c.p < 0.58 ? 0 : 1 - smooth((c.p - 0.58) / 0.42)
    if (c.p >= 0.58) q = 0
  }
  const wind = c.strike ? 1 : easeInOut(c.p / 0.4)
  const k = q > 0 ? q : rec
  return {
    ...BASE,
    lean: lerp(lerp(2, 0, wind), 17, k),
    hF: lerp(lerp(3, 14, wind), 36, k),
    kF: lerp(lerp(3, 10, wind), 26, k),
    hB: lerp(lerp(-3, -14, wind), -28, k),
    kB: lerp(2, 6, k),
    aB: lerp(0, 18, k),
    ikFx: lerp(lerp(6, -3, wind), 13, k),
    ikFy: lerp(lerp(22, 13, wind), 6, k),
    poleF: 91 - k * 2,
    propF: 90,
    twoHand: 16,
    handF: 'fist',
    handB: 'fist',
  }
}

// ================================================================================================ skeleton

interface Skel {
  P: V
  C: V
  N: V
  S: V
  SB: V
  E: V
  W: V
  EB: V
  WB: V
  handF: number
  handB: number
  HF: V
  KF: V
  AF: V
  footF: number
  HB: V
  KB: V
  AB: V
  footB: number
  headO: V
  headAxis: number
  lean: number
  spineAt: (u: number) => V
  normalAt: (u: number) => V
  tangentAt: (u: number) => V
}

function ik2(target: V, l1: number, l2: number): [number, number] {
  const d = clamp(Math.hypot(target.x, target.y), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01)
  const th = angOf(target)
  const alpha = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)) / D2R
  const upper = th - alpha
  const e1 = mul(dir(upper), l1)
  const fore = angOf(sub(target, e1))
  return [upper, fore]
}

function solveSkeleton(d: Dims, ps: Pose, seatUnits: number): Skel {
  const lean = ps.lean
  const bend = ps.bend + d.stoop
  const up = dir(180 - lean)
  const fwd = dir(90 - lean)
  let P = vec(0, 0)
  let N = add(add(P, mul(up, d.spine)), mul(fwd, bend * 0.05))
  let C = add(add(P, mul(up, d.spine * 0.5)), mul(fwd, -bend * 0.07))
  const spineAt = (u: number): V => {
    const m = 1 - u
    return vec(m * m * P.x + 2 * m * u * C.x + u * u * N.x, m * m * P.y + 2 * m * u * C.y + u * u * N.y)
  }
  const tangentAt = (u: number): V => {
    const t = vec(2 * (1 - u) * (C.x - P.x) + 2 * u * (N.x - C.x), 2 * (1 - u) * (C.y - P.y) + 2 * u * (N.y - C.y))
    const l = Math.hypot(t.x, t.y) || 1
    return vec(t.x / l, t.y / l)
  }
  const normalAt = (u: number): V => {
    const t = tangentAt(u)
    return vec(-t.y, t.x)
  }
  const S0 = add(spineAt(0.85), mul(normalAt(0.85), 0.5))
  const SB0 = add(S0, mul(normalAt(0.85), -1.1))
  const torsoFrame = (x: number, y: number): V => add(mul(normalAt(0.86), x), mul(tangentAt(0.86), -y))
  const arm = (Sh: V, s: number, e: number, w: number, ikx: number, iky: number): { E: V; W: V; hand: number } => {
    let upperAbs = lean + s
    let foreAbs = upperAbs + e
    if (!Number.isNaN(ikx) && !Number.isNaN(iky)) {
      const [u, f] = ik2(torsoFrame(ikx, iky), d.upperArm, d.foreArm)
      upperAbs = u
      foreAbs = f
    }
    const E = add(Sh, mul(dir(upperAbs), d.upperArm))
    const W = add(E, mul(dir(foreAbs), d.foreArm))
    return { E, W, hand: foreAbs + w }
  }
  const aF = arm(S0, ps.sF, ps.eF, ps.wF, ps.ikFx, ps.ikFy)
  let ikBx = ps.ikBx
  let ikBy = ps.ikBy
  if (!Number.isNaN(ps.twoHand) && !Number.isNaN(ps.poleF)) {
    // far hand on the same shaft, `twoHand` units along it from the near grip (world target → torso frame)
    const grip = local(aF.W, aF.hand, d.hand * 0.36, 0)
    const target = sub(add(grip, mul(dir(ps.poleF), ps.twoHand)), SB0)
    const nrm = normalAt(0.86)
    const tan = tangentAt(0.86)
    ikBx = target.x * nrm.x + target.y * nrm.y
    ikBy = -(target.x * tan.x + target.y * tan.y)
  }
  const aB = arm(SB0, ps.sB, ps.eB, ps.wB, ikBx, ikBy)
  const leg = (H: V, h: number, k: number, a: number): { K: V; A: V; foot: number } => {
    const K = add(H, mul(dir(h), d.thigh))
    const A = add(K, mul(dir(h - k), d.shin))
    return { K, A, foot: h - k + 90 - a }
  }
  const HF0 = add(P, vec(0.7, 0))
  const HB0 = add(P, vec(-0.7, 0))
  const lF = leg(HF0, ps.hF, ps.kF, ps.aF)
  const lB = leg(HB0, ps.hB, ps.kB, ps.aB)
  const neckDir = dir(180 - lean * 0.7 - ps.neck * 0.3 + bend * 0.2)
  const headO0 = add(N, mul(neckDir, d.neck))
  const headAxis = 90 - lean * 0.75 - ps.neck + bend * 0.3

  // ground: lowest contact point touches y = 0 (or the pelvis rests on the seat)
  const footPts = (A: V, foot: number): V[] => [local(A, foot, -0.26 * d.foot, d.ankleH * 0.95), local(A, foot, 0.74 * d.foot, d.ankleH * 0.7)]
  const contacts: V[] = [
    ...footPts(lF.A, lF.foot),
    ...footPts(lB.A, lB.foot),
    add(lF.K, vec(0, d.rKnee)),
    add(lB.K, vec(0, d.rKnee)),
    add(P, vec(0, d.rHip * 0.8)),
    add(spineAt(0.75), mul(normalAt(0.75), d.fr[5])),
    add(spineAt(0.75), mul(normalAt(0.75), -d.bk[5])),
    local(headO0, headAxis, 1, -d.head * 0.9),
    local(headO0, headAxis, 5, 0),
  ]
  let shiftY: number
  if (ps.seat > 0 && seatUnits > 0) shiftY = -seatUnits - (P.y + d.rHip * 0.75)
  else shiftY = -Math.max(...contacts.map((c) => c.y)) - ps.lift
  const sh = (v: V): V => vec(v.x, v.y + shiftY)
  P = sh(P)
  N = sh(N)
  C = sh(C)
  return {
    P, C, N,
    S: sh(S0), SB: sh(SB0), E: sh(aF.E), W: sh(aF.W), EB: sh(aB.E), WB: sh(aB.W), handF: aF.hand, handB: aB.hand,
    HF: sh(HF0), KF: sh(lF.K), AF: sh(lF.A), footF: lF.foot, HB: sh(HB0), KB: sh(lB.K), AB: sh(lB.A), footB: lB.foot,
    headO: sh(headO0), headAxis, lean, spineAt, normalAt, tangentAt,
  }
}

// ================================================================================================ primitives

type Role = 'skin' | 'hair' | 'top' | 'bottom' | 'shoe' | 'accent' | 'cape' | 'metal' | 'wood' | 'cloth' | 'flame' | 'paper' | 'dark' | 'light' | 'trim' | 'sash' | 'plume' | 'glow'

interface Prim {
  d: string
  role: Role
  far?: boolean
  holes?: string
  /** stroke-only primitive (width in units) */
  line?: number
  text?: { at: V; size: number; rot: number; ch: string }
  /** puppet-style joint rivet */
  rivet?: boolean
  /** drawn only at high detail */
  fine?: boolean
  /** garment part (cut-out ornaments in papercut / puppet styles) */
  tag?: 'torso' | 'skirt' | 'cape' | 'sleeve' | 'jacket' | 'leg'
  /** outline points of the part (before smoothing) */
  pts?: V[]
}

interface LookResolved {
  gender: 'male' | 'female' | 'neutral'
  build: FigureBuild
  outfit: FigureOutfit
  hair: FigureHair
  headwear: FigureHeadwear
  beard: 'none' | 'short' | 'long'
  cape: 'none' | 'cape' | 'scarf'
  propR: FigureProp
  propL: FigureProp
  colors: Required<FigureColors>
  emblem: string
}

const OUTFIT_COLORS: Record<FigureOutfit, { top: string; bottom: string; trim: string; shoes: string }> = {
  robe: { top: '#6E2B2B', bottom: '#6E2B2B', trim: '#C9A45C', shoes: '#2A1D18' },
  hanfu: { top: '#E7DCC7', bottom: '#E7DCC7', trim: '#9F1239', shoes: '#3A2A24' },
  armor: { top: '#3B3B42', bottom: '#2F2F35', trim: '#B08D57', shoes: '#241C18' },
  tunic: { top: '#8C7A5B', bottom: '#5E5341', trim: '#3E3428', shoes: '#2E241C' },
  suit: { top: '#2F3B52', bottom: '#262C38', trim: '#C9D1DD', shoes: '#1A1A1A' },
  casual: { top: '#4F7CAC', bottom: '#33415C', trim: '#F2F2F2', shoes: '#F5F5F5' },
  hoodie: { top: '#6B7280', bottom: '#334155', trim: '#E5E7EB', shoes: '#F3F4F6' },
  dress: { top: '#C2410C', bottom: '#C2410C', trim: '#FDE68A', shoes: '#3F2A20' },
  coat: { top: '#8B6B4A', bottom: '#2E3440', trim: '#D6C2A3', shoes: '#2A2018' },
  apron: { top: '#F1EDE4', bottom: '#3B3F46', trim: '#3F6E5A', shoes: '#2B2B2B' },
  'lab-coat': { top: '#F8FAFC', bottom: '#475569', trim: '#94A3B8', shoes: '#1F2937' },
  uniform: { top: '#334155', bottom: '#2B3445', trim: '#CBB26A', shoes: '#111827' },
  sport: { top: '#E11D48', bottom: '#1F2937', trim: '#FFFFFF', shoes: '#F8FAFC' },
}

function resolveLook(look: FigureLook = {}): LookResolved {
  const anyLook = look as FigureLook & Record<string, unknown>
  const outfit = (FIGURE_OUTFITS as readonly string[]).includes(String(look.outfit)) ? (look.outfit as FigureOutfit) : 'casual'
  const hairRaw = String(look.hair ?? anyLook.hairStyle ?? '')
  const female = look.gender === 'female'
  const hair = (FIGURE_HAIR as readonly string[]).includes(hairRaw) ? (hairRaw as FigureHair) : female ? 'bun' : outfit === 'robe' || outfit === 'hanfu' || outfit === 'armor' || outfit === 'tunic' ? 'topknot' : 'short'
  const hw = (FIGURE_HEADWEAR as readonly string[]).includes(String(look.headwear)) ? (look.headwear as FigureHeadwear) : 'none'
  const base = OUTFIT_COLORS[outfit]
  const legacy = anyLook as Record<string, string | undefined>
  const c = look.colors || {}
  const pick = (...vals: (string | undefined)[]): string | undefined => vals.find((v) => typeof v === 'string' && /^#?[0-9a-f]{3,6}$/i.test(v))
  const capeRaw = look.cape
  const cape: 'none' | 'cape' | 'scarf' = capeRaw === true || capeRaw === 'cape' ? 'cape' : capeRaw === 'scarf' ? 'scarf' : 'none'
  const props = look.props || {}
  const okProp = (v: unknown): FigureProp => ((FIGURE_PROPS as readonly string[]).includes(String(v)) ? (v as FigureProp) : 'none')
  return {
    gender: female ? 'female' : look.gender === 'neutral' ? 'neutral' : 'male',
    build: (FIGURE_BUILDS as readonly string[]).includes(String(look.build)) ? (look.build as FigureBuild) : 'average',
    outfit,
    hair,
    headwear: hw,
    beard: look.beard === 'short' || look.beard === 'long' ? look.beard : 'none',
    cape,
    propR: okProp(props.right),
    propL: okProp(props.left),
    colors: {
      skin: pick(c.skin, legacy.skin) || '#E8B992',
      hair: pick(c.hair, legacy.hairColor) || '#2B1D16',
      top: pick(c.top, legacy.top) || base.top,
      bottom: pick(c.bottom, legacy.bottom) || base.bottom,
      accent: pick(c.accent, legacy.accent) || '#9B1C1C',
      shoes: pick(c.shoes, legacy.shoes) || base.shoes,
      cape: pick(c.cape, legacy.capeColor, c.accent, legacy.accent) || '#8E1B1B',
      trim: pick(c.trim, legacy.trim) || base.trim,
    },
    emblem: String(look.emblem || '').slice(0, 2),
  }
}

// head profile (head height 13.5, origin at the top of the neck, +x = face)
const HEAD_MALE: [number, number, boolean?][] = [
  [-3.4, -0.4], [-5.2, -3.6], [-6.0, -6.9], [-5.0, -10.2], [-1.5, -12.0], [2.6, -11.4], [5.0, -9.6], [6.0, -7.0], [5.7, -6.3, true],
  [7.5, -3.7, true], [6.2, -2.9], [6.3, -2.1], [5.85, -1.55, true], [6.1, -0.95], [5.5, -0.35, true], [5.95, 0.55], [4.8, 1.6], [2.2, 1.3], [1.2, 0.5],
]
const HEAD_FEMALE: [number, number, boolean?][] = [
  [-3.1, -0.5], [-5.0, -3.6], [-5.8, -6.9], [-4.8, -10.1], [-1.4, -11.9], [2.5, -11.3], [4.8, -9.5], [5.6, -7.1], [5.35, -6.4, true],
  [6.8, -3.9, true], [5.75, -3.1], [6.1, -2.2], [5.6, -1.6, true], [6.0, -0.95], [5.3, -0.4, true], [5.55, 0.4], [4.4, 1.25], [2.0, 1.0], [1.1, 0.4],
]
const HEAD_CHILD: [number, number, boolean?][] = [
  [-3.2, -0.3], [-5.6, -3.4], [-6.6, -7.2], [-5.6, -11.2], [-1.6, -13.0], [2.8, -12.4], [5.4, -10.0], [6.0, -7.0], [5.8, -5.6, true],
  [6.7, -4.0], [5.9, -3.2], [6.0, -2.3], [5.6, -1.8, true], [5.8, -1.1], [5.3, -0.4], [5.2, 0.5], [3.8, 1.2], [1.8, 0.9], [1.0, 0.3],
]

interface BuildCtx {
  d: Dims
  sk: Skel
  ps: Pose
  look: LookResolved
  frame: number
  fps: number
  wind: number
  speed: number
  lod: 'high' | 'low'
  style: FigureStyle
  seed: number
}

/** head-local → figure coords (with the look-back flip as a horizontal squash) */
function headPt(c: BuildCtx, lx: number, ly: number): V {
  const k = c.d.head / 13.5
  const flipX = c.ps.flip >= 0.5 ? -1 : 1
  return local(c.sk.headO, c.sk.headAxis, lx * k * flipX, ly * k)
}
function headShape(c: BuildCtx, pts: [number, number, boolean?][], closed = true): string {
  return smoothPath(pts.map(([x, y]) => headPt(c, x, y)), closed, 1, pts.map((p) => Boolean(p[2])))
}

function windDrift(c: BuildCtx): number {
  return clamp(0.12 + c.speed / 160 + Math.max(0, c.wind) * 0.55, 0, 1)
}

function torsoOutline(c: BuildCtx, extraFront = 0, extraBack = 0, fromU = -0.1, toU = 1): V[] {
  const { sk, d } = c
  const us: number[] = []
  for (let u = fromU; u < toU - 1e-6; u += 0.09) us.push(u)
  us.push(toU)
  const front = us.map((u) => add(sk.spineAt(u), mul(sk.normalAt(u), interpTorso(d.fr, u) + extraFront)))
  const back = us.map((u) => add(sk.spineAt(u), mul(sk.normalAt(u), -(interpTorso(d.bk, u) + extraBack)))).reverse()
  return [...front, ...back]
}

function footPath(c: BuildCtx, A: V, ang: number, boot: boolean): string {
  const { d } = c
  const L = d.foot
  const h = d.ankleH
  const pts: V[] = [
    local(A, ang, -0.2 * L, -h * (boot ? 1.6 : 0.5)),
    local(A, ang, -0.3 * L, h * 0.35),
    local(A, ang, -0.26 * L, h * 1.0),
    local(A, ang, 0.45 * L, h * 1.0),
    local(A, ang, 0.74 * L, h * 0.92),
    local(A, ang, 0.8 * L, h * 0.45),
    local(A, ang, 0.62 * L, -h * 0.05),
    local(A, ang, 0.3 * L, -h * 0.32),
    local(A, ang, 0.1 * L, -h * (boot ? 1.7 : 0.6)),
  ]
  return smoothPath(pts, true, 0.85)
}

function handPath(c: BuildCtx, W: V, axis: number, shape: Hand, near: boolean): string {
  const { d } = c
  const L = d.hand
  const r = d.rWr * 1.05
  if (shape === 'fist') return circlePath(local(W, axis, L * 0.36, 0), r * 1.35)
  if (shape === 'point') {
    return `${circlePath(local(W, axis, L * 0.32, 0), r * 1.25)}${capsule(local(W, axis, L * 0.4, -r * 0.5), r * 0.5, local(W, axis, L * 1.05, -r * 0.55), r * 0.38)}`
  }
  const len = shape === 'open' ? 1.0 : 0.88
  const pts: V[] = [
    local(W, axis, -0.05 * L, -r * 0.95),
    local(W, axis, 0.45 * L, -r * 1.15),
    local(W, axis, len * L, -r * 0.45),
    local(W, axis, len * L * 1.02, r * 0.35),
    local(W, axis, 0.55 * L, r * 1.05),
    local(W, axis, 0.3 * L, r * (near ? 1.9 : 1.6)),
    local(W, axis, 0.12 * L, r * 1.1),
    local(W, axis, -0.05 * L, r * 0.95),
  ]
  return smoothPath(pts, true, 0.9)
}

// --------------------------------------------------------------------------------------------- head pieces

function hairPrims(c: BuildCtx, out: Prim[], behind: boolean): void {
  const h = c.look.hair
  const hw = c.look.headwear
  const hidesHair = hw === 'helmet' || hw === 'plume-helmet' || hw === 'hood' || hw === 'hard-hat' || hw === 'beanie' || hw === 'chef-hat'
  const t = c.frame / c.fps
  const drift = windDrift(c)
  const flipped = c.ps.flip > 0.5
  if (behind) {
    if ((h === 'long' || (c.look.gender === 'female' && h === 'bob')) && hw !== 'hood') {
      const base = headPt(c, -4.6, -6)
      const len = (h === 'long' ? 26 : 9) * (c.d.head / 13.5)
      const backDeg = flipped ? 30 : -30
      const pts = chain(base, flipped ? 8 : -8, flipped ? 20 + drift * 50 : -(20 + drift * 50), len, 6, 6 + drift * 10, t * (2 + drift * 6) + c.seed)
      void backDeg
      out.push({ d: ribbon(pts, 7.5 * (c.d.head / 13.5), 3.2 * (c.d.head / 13.5)), role: 'hair' })
    }
    if (h === 'ponytail' && !hidesHair) {
      const base = headPt(c, -5.4, -8.4)
      const pts = chain(base, flipped ? 40 : -40, flipped ? 10 + drift * 60 : -(10 + drift * 60), 13 * (c.d.head / 13.5), 5, 14, t * 5 + c.seed)
      out.push({ d: ribbon(pts, 3.4 * (c.d.head / 13.5), 1.4 * (c.d.head / 13.5)), role: 'hair' })
    }
    return
  }
  if (hidesHair && h !== 'long') return
  const cap: Record<string, [number, number, boolean?][]> = {
    short: [[4.9, -9.9], [3.0, -12.3], [-1.4, -12.9], [-5.3, -11.0], [-6.5, -7.6], [-6.2, -4.4], [-4.6, -3.0], [-3.6, -5.0], [-3.0, -8.4], [0.6, -10.6]],
    topknot: [[4.9, -9.9], [3.0, -12.3], [-1.4, -12.9], [-5.3, -11.0], [-6.4, -7.6], [-6.0, -4.6], [-4.4, -3.6], [-3.4, -5.6], [-2.6, -8.8], [0.8, -10.7]],
    bun: [[4.7, -9.8], [2.9, -12.3], [-1.4, -12.9], [-5.4, -11.0], [-6.6, -7.4], [-6.2, -4.0], [-4.4, -3.0], [-3.4, -5.6], [-2.8, -8.6], [0.8, -10.6]],
    long: [[4.8, -9.9], [3.0, -12.4], [-1.4, -13.0], [-5.5, -11.0], [-6.8, -7.4], [-6.6, -3.6], [-4.8, -2.0], [-3.6, -5.0], [-2.8, -8.6], [0.8, -10.7]],
    ponytail: [[4.8, -9.9], [3.0, -12.3], [-1.4, -12.9], [-5.3, -11.0], [-6.4, -7.6], [-6.0, -5.0], [-4.4, -4.0], [-3.4, -5.8], [-2.6, -8.8], [0.8, -10.7]],
    bob: [[5.2, -9.4], [3.2, -12.5], [-1.4, -13.2], [-5.8, -11.2], [-7.0, -7.2], [-6.8, -2.6], [-3.0, -1.8], [-3.0, -5.6], [-2.4, -8.8], [1.4, -10.4]],
    curly: [[5.1, -10.2], [4.0, -12.4], [1.6, -13.8], [-1.6, -14.0], [-4.6, -13.0], [-6.6, -10.8], [-7.4, -7.4], [-6.6, -4.0], [-4.4, -3.4], [-3.4, -6.0], [-2.6, -9.0], [1.0, -10.8]],
    spiky: [[5.0, -10.0], [4.6, -13.4, true], [2.4, -12.6, true], [1.0, -14.8, true], [-0.8, -13.0, true], [-2.8, -14.6, true], [-3.8, -12.4, true], [-6.0, -12.8, true], [-6.0, -10.4, true], [-6.8, -7.2], [-5.6, -4.2], [-3.6, -5.4], [-2.8, -8.6], [0.6, -10.6]],
  }
  if (h !== 'bald' && cap[h]) out.push({ d: headShape(c, cap[h]), role: 'hair' })
  if (h === 'topknot' && hw !== 'mian-crown') out.push({ d: smoothPath([headPt(c, -2.6, -12.0), headPt(c, -3.4, -14.6), headPt(c, -1.4, -16.0), headPt(c, 0.6, -14.6), headPt(c, 0.2, -12.2)], true), role: 'hair' })
  if (h === 'bun') out.push({ d: smoothPath([headPt(c, -4.4, -10.6), headPt(c, -7.6, -12.2), headPt(c, -8.6, -9.4), headPt(c, -7.6, -6.8), headPt(c, -5.0, -7.2)], true), role: 'hair' })
}

function headwearPrims(c: BuildCtx, out: Prim[]): void {
  const hw = c.look.headwear
  if (hw === 'none') return
  const t = c.frame / c.fps
  const drift = windDrift(c)
  const flipped = c.ps.flip > 0.5
  const k = c.d.head / 13.5
  switch (hw) {
    case 'helmet':
    case 'plume-helmet': {
      out.push({ d: headShape(c, [[5.6, -8.4], [5.4, -11.0], [2.4, -13.9], [-2.0, -14.3], [-5.6, -12.4], [-7.0, -9.0], [-7.2, -5.2], [-6.8, -1.8, true], [-4.8, -1.6, true], [-4.4, -4.8], [-2.6, -7.0], [1.0, -8.6], [3.6, -8.2], [4.4, -6.2], [5.4, -5.8, true]]), role: 'metal' })
      out.push({ d: headShape(c, [[-0.6, -14.0], [0.2, -17.6, true], [1.0, -14.0]]), role: 'metal' })
      if (hw === 'plume-helmet') {
        const base = headPt(c, 0.2, -17.4)
        const pts = chain(base, flipped ? 150 : -150, flipped ? 70 + drift * 30 : -(70 + drift * 30), 12 * k, 5, 10 + drift * 12, t * (3 + drift * 7) + c.seed)
        out.push({ d: ribbonW(pts, (u) => (0.7 + 3.4 * Math.sin(Math.PI * Math.pow(u, 0.75))) * k), role: 'plume' })
      }
      break
    }
    case 'crown':
      out.push({ d: headShape(c, [[4.6, -10.0], [4.8, -13.8, true], [3.0, -12.4, true], [1.6, -15.4, true], [-0.2, -12.9, true], [-2.0, -15.4, true], [-3.4, -12.6, true], [-5.0, -14.4, true], [-5.4, -10.2], [-1.6, -11.6]]), role: 'trim' })
      break
    case 'mian-crown': {
      out.push({ d: headShape(c, [[3.4, -11.0], [3.0, -14.2], [-3.4, -14.2], [-4.0, -11.0]]), role: 'dark' })
      out.push({ d: polyPath([headPt(c, -6.8, -14.0), headPt(c, 8.4, -15.2), headPt(c, 8.4, -16.2), headPt(c, -6.8, -15.0)]), role: 'dark' })
      if (c.lod === 'high') {
        for (const [bx, by] of [[8.0, -15.4], [6.6, -15.2], [-6.2, -14.4], [-4.8, -14.5]]) {
          const top = headPt(c, bx, by)
          const sway = Math.sin(t * 3 + bx) * 2 * drift
          const bot = add(top, mul(dir(sway), 6 * k))
          out.push({ d: polyPath([top, bot], false), role: 'dark', line: 0.4 * k, fine: true })
          out.push({ d: circlePath(bot, 0.6 * k), role: 'accent', fine: true })
        }
      }
      break
    }
    case 'guan':
      out.push({ d: headShape(c, [[-3.2, -12.0], [-3.8, -15.6], [-1.0, -17.0], [1.2, -15.6], [0.8, -12.2]]), role: 'trim' })
      out.push({ d: capsule(headPt(c, -6.0, -15.0), 0.45 * k, headPt(c, 3.8, -15.0), 0.45 * k), role: 'trim' })
      break
    case 'hat':
      out.push({ d: headShape(c, [[-9.8, -9.8], [9.6, -9.8], [9.2, -10.8], [4.0, -11.2], [3.4, -15.4], [-3.6, -15.6], [-4.2, -11.2], [-9.6, -10.8]]), role: 'dark' })
      break
    case 'straw-hat':
      out.push({ d: headShape(c, [[-12.4, -8.6, true], [0.0, -17.6, true], [12.4, -8.6, true], [9.0, -8.0], [0.0, -8.4], [-9.0, -8.0]]), role: 'wood' })
      break
    case 'cap':
      out.push({ d: headShape(c, [[10.2, -9.0, true], [5.0, -10.4], [4.0, -12.6], [-1.6, -13.6], [-5.8, -11.6], [-6.4, -8.8], [4.0, -9.0]]), role: 'accent' })
      break
    case 'beanie':
      out.push({ d: headShape(c, [[5.4, -9.2], [4.6, -12.4], [0.0, -14.6], [-4.6, -13.6], [-6.8, -10.4], [-6.8, -7.6], [5.2, -8.0]]), role: 'accent' })
      break
    case 'hood':
      out.push({ d: headShape(c, [[5.8, -6.0], [6.0, -10.6], [3.4, -13.8], [-1.6, -14.6], [-6.2, -12.6], [-8.0, -8.0], [-7.8, -2.0], [-5.4, 2.6], [-2.0, 1.2], [-3.4, -4.6], [-2.4, -8.6], [1.6, -10.2], [3.8, -7.6]]), role: 'top' })
      break
    case 'headband': {
      out.push({ d: headShape(c, [[5.4, -9.4], [5.2, -10.8], [-6.4, -9.4], [-6.4, -8.0]]), role: 'accent' })
      const base = headPt(c, -6.2, -8.8)
      const pts = chain(base, flipped ? 60 : -60, flipped ? 30 + drift * 60 : -(30 + drift * 60), 9 * k, 4, 18, t * 6 + c.seed)
      out.push({ d: ribbon(pts, 1.4 * k, 0.7 * k), role: 'accent' })
      break
    }
    case 'chef-hat':
      out.push({ d: headShape(c, [[4.6, -10.2], [4.4, -13.0], [6.0, -16.4], [3.4, -19.6], [-1.0, -20.2], [-5.4, -19.0], [-6.8, -15.6], [-5.4, -12.4], [-5.6, -10.0]]), role: 'light' })
      break
    case 'hard-hat':
      out.push({ d: headShape(c, [[8.4, -9.4, true], [5.2, -10.4], [4.0, -13.6], [-1.0, -14.8], [-5.8, -12.8], [-7.0, -9.8], [-8.8, -9.2, true], [-6.0, -8.8], [5.0, -8.8]]), role: 'accent' })
      break
    case 'veil': {
      const base = headPt(c, -2.0, -12.6)
      const pts = chain(base, flipped ? 40 : -40, flipped ? 8 + drift * 50 : -(8 + drift * 50), 30 * k, 6, 6 + drift * 8, t * 2 + c.seed)
      out.push({ d: ribbon(pts, 6 * k, 9 * k), role: 'cloth' })
      break
    }
    case 'flower':
      out.push({ d: circlePath(headPt(c, -5.0, -11.4), 1.7 * k), role: 'accent' })
      break
    default:
      break
  }
}

// --------------------------------------------------------------------------------------------- props

function propPrims(c: BuildCtx, kind: FigureProp, W: V, handAxis: number, rel: number, pole: number, out: Prim[], near: boolean, twoHand: { at: V } | null): void {
  if (kind === 'none') return
  const k = 1
  const grip = local(W, handAxis, c.d.hand * 0.36, 0)
  const t = c.frame / c.fps
  const drift = windDrift(c)
  const far = !near
  const axisLong = Number.isNaN(pole) ? handAxis + 90 + rel * 0 : pole
  const flipped = false
  void flipped
  void twoHand
  switch (kind) {
    case 'sword': {
      const ax = handAxis + 90 - rel
      const pommel = add(grip, mul(dir(ax), -3.6 * k))
      const guard = add(grip, mul(dir(ax), 2.6 * k))
      const tip = add(grip, mul(dir(ax), 32 * k))
      const n = dir(ax - 90)
      out.push({ d: capsule(pommel, 0.7, guard, 0.6), role: 'dark', far })
      out.push({ d: capsule(add(guard, mul(n, -2.6)), 0.55, add(guard, mul(n, 2.6)), 0.55), role: 'trim', far })
      out.push({ d: polyPath([add(guard, mul(n, 0.85)), add(lerpV(guard, tip, 0.9), mul(n, 0.7)), tip, add(lerpV(guard, tip, 0.9), mul(n, -0.7)), add(guard, mul(n, -0.85))]), role: 'metal', far })
      break
    }
    case 'spear':
    case 'halberd':
    case 'staff':
    case 'flag':
    case 'torch':
    case 'sign':
    case 'umbrella':
    case 'lantern': {
      const ax = Number.isNaN(pole) ? handAxis + 90 - rel : axisLong
      const L = kind === 'torch' ? 18 : kind === 'lantern' ? 14 : kind === 'sign' ? 46 : kind === 'umbrella' ? 34 : kind === 'staff' ? 66 : kind === 'flag' ? 82 : 86
      const below = kind === 'torch' ? 6 : kind === 'lantern' ? 2 : kind === 'umbrella' ? 6 : kind === 'sign' ? 18 : kind === 'flag' ? 26 : 30
      const butt = add(grip, mul(dir(ax), -below))
      const top = add(grip, mul(dir(ax), L - below))
      const n = dir(ax - 90)
      out.push({ d: capsule(butt, 0.75, top, 0.6), role: 'wood', far })
      if (kind === 'spear' || kind === 'halberd') {
        const headLen = 9
        const tip = add(top, mul(dir(ax), headLen))
        out.push({ d: smoothPath([add(top, mul(n, 0.7)), add(lerpV(top, tip, 0.35), mul(n, 1.7)), tip, add(lerpV(top, tip, 0.35), mul(n, -1.7)), add(top, mul(n, -0.7))], true, 0.7, [false, false, true, false, false]), role: 'metal', far })
        // red tassel below the head
        const tb = add(top, mul(dir(ax), -0.6))
        const pts = chain(tb, ax + 180 - 40 * drift, -70 - drift * 40, 6, 3, 10, t * 7 + c.seed)
        out.push({ d: ribbon(pts, 2.4, 1.2, 1.4), role: 'plume', far, fine: true })
        if (kind === 'halberd') {
          const at = add(top, mul(dir(ax), 1.2))
          out.push({ d: smoothPath([add(at, mul(n, 0.6)), add(at, mul(n, 4.4)), add(add(at, mul(n, 6.6)), mul(dir(ax), -3.2)), add(add(at, mul(n, 4.8)), mul(dir(ax), -1.8)), add(add(at, mul(n, 3.0)), mul(dir(ax), 1.6))], true, 0.8), role: 'metal', far })
        }
      } else if (kind === 'flag') {
        const w = 22
        const h = 16
        const flow = -90 - 10 + drift * 20
        const rows: V[] = []
        const rowsB: V[] = []
        for (let i = 0; i <= 6; i++) {
          const u = i / 6
          const wave = Math.sin(t * (4 + drift * 6) - u * 4.2 + c.seed) * 2.2 * u
          const along = mul(dir(flow), w * u)
          rows.push(add(add(top, along), mul(dir(flow - 90), wave)))
          rowsB.push(add(add(add(top, mul(dir(ax), -h)), along), mul(dir(flow - 90), wave + Math.sin(t * 5 - u * 3) * 0.8 * u)))
        }
        out.push({ d: smoothPath([...rows, ...rowsB.reverse()], true, 0.8), role: 'cloth', far })
        if (c.look.emblem && c.lod === 'high') {
          const mid = add(add(top, mul(dir(ax), -h * 0.52)), mul(dir(flow), w * 0.48))
          out.push({ d: '', role: 'dark', far, text: { at: mid, size: h * 0.62, rot: 0, ch: c.look.emblem.slice(0, 1) } })
        }
        out.push({ d: circlePath(add(top, mul(dir(ax), 1.2)), 1.1), role: 'trim', far })
      } else if (kind === 'torch') {
        const flame = add(top, mul(dir(ax), 1))
        const fl: V[] = []
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * TAU
          const r = (i % 2 ? 2.2 : 3.4) + noise(t * 9 + i, c.seed) * 0.9
          fl.push(add(flame, vec(Math.cos(a) * r * 0.75, Math.sin(a) * r - (Math.sin(a) < 0 ? 3.2 : 0))))
        }
        out.push({ d: smoothPath(fl, true), role: 'flame', far })
      } else if (kind === 'lantern') {
        const body = add(top, vec(0, 5))
        out.push({ d: polyPath([top, add(top, vec(0, 1.5))], false), role: 'dark', far, line: 0.4 })
        out.push({ d: ellipsePath(body, 3.4, 4.4), role: 'glow', far })
      } else if (kind === 'umbrella') {
        const cx = top
        out.push({ d: smoothPath([add(cx, vec(-16, 7)), add(cx, vec(-9, -1)), add(cx, vec(0, -3)), add(cx, vec(9, -1)), add(cx, vec(16, 7)), add(cx, vec(8, 5)), add(cx, vec(0, 6)), add(cx, vec(-8, 5))], true, 0.9), role: 'accent', far })
      } else if (kind === 'sign') {
        out.push({ d: polyPath([add(top, vec(-9, -1)), add(top, vec(9, -1)), add(top, vec(9, 11)), add(top, vec(-9, 11))]), role: 'light', far })
      }
      break
    }
    case 'bow': {
      const ax = 180
      const mid = grip
      const tipU = add(mid, mul(dir(ax), 20))
      const tipD = add(mid, mul(dir(ax), -20))
      const bulge = add(mid, vec(4.5, 0))
      out.push({ d: `M${pt(tipU)}Q${pt(add(bulge, vec(4, 0)))} ${pt(tipD)}`, role: 'wood', far, line: 1.3 })
      const pull = c.ps.draw
      const handNear = c.sk.W
      const stringMid = pull > 0.01 ? handNear : add(mid, vec(-1.2, 0))
      out.push({ d: `M${pt(tipU)}L${pt(stringMid)}L${pt(tipD)}`, role: 'dark', far, line: 0.3, fine: true })
      if (pull > 0.05) {
        const dx = sub(bulge, handNear)
        const l = Math.hypot(dx.x, dx.y) || 1
        const arrowTip = add(handNear, mul(dx, (l + 8) / l))
        out.push({ d: polyPath([handNear, arrowTip], false), role: 'wood', far, line: 0.5 })
      }
      break
    }
    case 'shield': {
      const cx = add(grip, vec(2, 0))
      out.push({ d: ellipsePath(cx, 7.5, 11, handAxis - 90), role: 'accent', far })
      break
    }
    case 'scroll': {
      const ax = handAxis + 25 - rel
      const a = add(grip, mul(dir(ax), -5))
      const b = add(grip, mul(dir(ax), 5))
      out.push({ d: capsule(a, 1.6, b, 1.6), role: 'paper', far })
      break
    }
    case 'book': {
      const cx = add(grip, vec(2.5, -1))
      out.push({ d: polyPath([add(cx, vec(-5, -3.5)), add(cx, vec(5, -4.5)), add(cx, vec(5, 3)), add(cx, vec(-5, 4))]), role: 'accent', far })
      break
    }
    case 'cup':
    case 'coffee': {
      const tilt = c.ps.tilt * -55
      const base = add(grip, vec(0.4, -1.2))
      const up = dir(180 + tilt)
      const n = dir(90 + tilt)
      const h = kind === 'coffee' ? 5.6 : 4.2
      const wTop = kind === 'coffee' ? 2.2 : 2.6
      const wBot = kind === 'coffee' ? 1.7 : 1.0
      out.push({ d: polyPath([add(base, mul(n, -wBot)), add(base, mul(n, wBot)), add(add(base, mul(up, h)), mul(n, wTop)), add(add(base, mul(up, h)), mul(n, -wTop))]), role: kind === 'coffee' ? 'light' : 'trim', far })
      break
    }
    case 'brush':
    case 'pen': {
      const ax = handAxis + 90 - 60
      const a = add(grip, mul(dir(ax), -3))
      const b = add(grip, mul(dir(ax), kind === 'brush' ? 8 : 6))
      out.push({ d: capsule(a, 0.45, b, kind === 'brush' ? 0.7 : 0.3), role: 'dark', far })
      break
    }
    case 'fan': {
      const cx = grip
      const ax = handAxis + 90 - 30
      const pts: V[] = [cx]
      for (let i = 0; i <= 8; i++) pts.push(add(cx, mul(dir(ax - 50 + i * 12.5), 9)))
      out.push({ d: polyPath(pts), role: 'paper', far })
      break
    }
    case 'phone':
    case 'tablet': {
      const ax = handAxis + 90 - 10
      const s = kind === 'tablet' ? 1.8 : 1
      const a = add(grip, mul(dir(ax), -1.6 * s))
      const b = add(grip, mul(dir(ax), 4.6 * s))
      out.push({ d: capsule(a, 1.6 * s, b, 1.6 * s), role: 'dark', far })
      break
    }
    case 'mic': {
      const ax = handAxis + 90 - 40
      const a = add(grip, mul(dir(ax), -3))
      const b = add(grip, mul(dir(ax), 4))
      out.push({ d: capsule(a, 0.6, b, 0.8), role: 'dark', far })
      out.push({ d: circlePath(add(b, mul(dir(ax), 1.4)), 1.5), role: 'metal', far })
      break
    }
    case 'laptop': {
      const base = add(grip, vec(1, 1))
      out.push({ d: polyPath([add(base, vec(-6, 0)), add(base, vec(6, 0)), add(base, vec(6, 0.9)), add(base, vec(-6, 0.9))]), role: 'metal', far })
      out.push({ d: polyPath([add(base, vec(5.4, 0)), add(base, vec(8.2, -9.4)), add(base, vec(7.4, -9.6)), add(base, vec(4.6, -0.2))]), role: 'dark', far })
      break
    }
    case 'briefcase':
    case 'bag': {
      const top = add(grip, vec(0, 1.2))
      const w = kind === 'briefcase' ? 7 : 5.5
      const h = kind === 'briefcase' ? 5.5 : 6.5
      out.push({ d: polyPath([add(top, vec(-w / 2, 0)), add(top, vec(w / 2, 0)), add(top, vec(w / 2 + 0.5, h)), add(top, vec(-w / 2 - 0.5, h))]), role: kind === 'bag' ? 'accent' : 'dark', far })
      break
    }
    case 'box': {
      const cx = add(grip, vec(-0.8, -3))
      out.push({ d: polyPath([add(cx, vec(-6, -5)), add(cx, vec(6, -5)), add(cx, vec(6, 5)), add(cx, vec(-6, 5))]), role: 'wood', far })
      break
    }
    case 'wrench': {
      const ax = handAxis + 90 - 20
      const a = add(grip, mul(dir(ax), -3))
      const b = add(grip, mul(dir(ax), 8))
      out.push({ d: capsule(a, 0.7, b, 0.8), role: 'metal', far })
      out.push({ d: circlePath(add(b, mul(dir(ax), 1.2)), 1.6), role: 'metal', far })
      break
    }
    default:
      break
  }
}

// --------------------------------------------------------------------------------------------- body

const LONG_ROBE = new Set<FigureOutfit>(['robe', 'hanfu'])
const WIDE_SLEEVE = new Set<FigureOutfit>(['robe', 'hanfu'])

function sleevePrims(c: BuildCtx, E: V, W: V, far: boolean, out: Prim[]): void {
  const fore = sub(W, E)
  const L = Math.hypot(fore.x, fore.y) || 1
  const f = mul(fore, 1 / L)
  const upness = clamp(-f.y)
  const level = 1 - Math.abs(f.y)
  const k = c.d.head / 13.5
  let n = vec(-f.y, f.x)
  if (n.y < 0) n = mul(n, -1)
  const cuff = lerpV(W, E, 0.08 + 0.4 * upness)
  const depth = (4.2 + 7.6 * level + (1 - upness) * 2.4) * k
  const t = c.frame / c.fps
  const sway = Math.sin(t * 2.2 + (far ? 1.4 : 0) + c.seed) * 0.9 * k
  const pts: V[] = [
    add(E, mul(n, -2.6 * k)),
    add(cuff, mul(n, -2.4 * k)),
    add(add(cuff, mul(f, 1.6 * k)), mul(n, 0.4 * k)),
    add(add(cuff, mul(n, depth * 0.75)), vec(sway, 0)),
    add(add(lerpV(cuff, E, 0.45), mul(n, depth)), vec(sway * 0.6, 0)),
    add(E, mul(n, 3.4 * k)),
  ]
  out.push({ d: smoothPath(pts, true, 0.95), role: 'top', far, tag: 'sleeve', pts })
}

function capePrims(c: BuildCtx, out: Prim[]): void {
  if (c.look.cape === 'none') return
  const { sk, d } = c
  const t = c.frame / c.fps
  const drift = windDrift(c)
  const isScarf = c.look.cape === 'scarf'
  const A = add(sk.spineAt(0.95), mul(sk.normalAt(0.95), -d.bk[6] * 0.6))
  const B = add(sk.spineAt(isScarf ? 0.9 : 0.55), mul(sk.normalAt(isScarf ? 0.9 : 0.55), -(interpTorso(d.bk, 0.55) + 0.6)))
  const len = isScarf ? 20 : 54
  const endDeg = -(10 + drift * 70)
  const freq = 2.2 + drift * 7
  const outer = chain(A, -18, endDeg, len, 7, 7 + drift * 10, t * freq + c.seed)
  const inner = chain(B, -6, endDeg + 8, len * (isScarf ? 0.6 : 0.62), 6, 5 + drift * 8, t * freq + c.seed - 0.9)
  const tail: V[] = []
  const o = outer[outer.length - 1]
  const i = inner[inner.length - 1]
  for (let s = 1; s < 4; s++) {
    const u = s / 4
    const p = lerpV(o, i, u)
    tail.push(add(p, vec(Math.sin(t * freq * 1.3 + u * 5) * 1.6, Math.cos(t * freq + u * 4) * 1.2)))
  }
  const pts = [...outer, ...tail, ...inner.reverse()]
  out.push({ d: smoothPath(pts, true, 0.9), role: 'cape', tag: 'cape', pts })
}

function robeSkirt(c: BuildCtx): V[] {
  const { sk, d } = c
  const t = c.frame / c.fps
  const k = d.head / 13.5
  const kneeF = sk.KF.x >= sk.KB.x ? sk.KF : sk.KB
  const kneeB = sk.KF.x >= sk.KB.x ? sk.KB : sk.KF
  const toeF = local(sk.AF, sk.footF, 0.7 * d.foot, 0)
  const toeB = local(sk.AB, sk.footB, 0.7 * d.foot, 0)
  const heelF = local(sk.AF, sk.footF, -0.25 * d.foot, 0)
  const heelB = local(sk.AB, sk.footB, -0.25 * d.foot, 0)
  const frontX = Math.max(sk.AF.x, sk.AB.x, toeF.x * 0.6 + sk.AF.x * 0.4, toeB.x * 0.6 + sk.AB.x * 0.4) + 1.2 * k
  const backX = Math.min(heelF.x, heelB.x, sk.AF.x, sk.AB.x) - 2.2 * k
  const lowY = Math.max(sk.AF.y, sk.AB.y)
  const hemY = Math.min(lowY + d.ankleH * 0.2, -0.6)
  const waistF = add(sk.spineAt(0.3), mul(sk.normalAt(0.3), interpTorso(d.fr, 0.3) + 0.4))
  const waistB = add(sk.spineAt(0.3), mul(sk.normalAt(0.3), -(interpTorso(d.bk, 0.3) + 0.4)))
  const butt = add(sk.spineAt(0.02), mul(sk.normalAt(0.02), -(d.bk[1] + 1.4 * k)))
  const sway = (u: number) => Math.sin(t * 2.4 + u * 5 + c.seed) * 0.7 * k
  const kneeFront = vec(kneeF.x + d.rKnee + 1.6 * k, kneeF.y)
  const kneeBack = vec(kneeB.x - d.rKnee - 2.4 * k, kneeB.y + 2 * k)
  const hemFront = vec(Math.max(frontX + 1.4 * k, kneeFront.x - 1), Math.min(hemY, kneeF.y + 18))
  const hemBack = vec(Math.min(backX - 1.6 * k, kneeBack.x), Math.min(hemY + 0.4, kneeB.y + 20))
  const midHem: V[] = []
  for (let i = 1; i < 4; i++) {
    const u = i / 4
    const p = lerpV(hemFront, hemBack, u)
    midHem.push(vec(p.x + sway(u), p.y + Math.sin(u * Math.PI) * 0.8 * k + sway(u + 1) * 0.4))
  }
  return [waistF, kneeFront, hemFront, ...midHem, hemBack, kneeBack, butt, waistB]
}

/** Skirt / coat tails from the waist to mid-thigh ('thigh') or just below the knee ('knee'), following the legs. */
function skirtPts(c: BuildCtx, level: 'thigh' | 'knee', flare = 1): V[] {
  const { sk, d } = c
  const k = d.head / 13.5
  const t = c.frame / c.fps
  const nearFront = sk.KF.x >= sk.KB.x
  const fH = nearFront ? sk.HF : sk.HB
  const fK = nearFront ? sk.KF : sk.KB
  const bH = nearFront ? sk.HB : sk.HF
  const bK = nearFront ? sk.KB : sk.KF
  const f = level === 'knee' ? 1 : 0.62
  const atF = lerpV(fH, fK, f)
  const atB = lerpV(bH, bK, f)
  const rAt = lerp(d.rHip, d.rKnee, f)
  const hemY = Math.max(atF.y, atB.y) + (level === 'knee' ? 3.4 : 1.4) * k
  const waistF = add(sk.spineAt(0.3), mul(sk.normalAt(0.3), interpTorso(d.fr, 0.3) + 0.4 * k))
  const waistB = add(sk.spineAt(0.3), mul(sk.normalAt(0.3), -(interpTorso(d.bk, 0.3) + 0.4 * k)))
  const butt = add(sk.spineAt(0.02), mul(sk.normalAt(0.02), -(d.bk[1] + 1.0 * k)))
  const midF = lerpV(fH, fK, f * 0.5)
  const midB = lerpV(bH, bK, f * 0.5)
  const rMid = lerp(d.rHip, rAt, 0.5)
  const hemFront = vec(Math.max(atF.x + rAt + 1.6 * k * flare, waistF.x), hemY)
  const hemBack = vec(Math.min(atB.x - rAt - 1.8 * k * flare, butt.x), hemY + 0.3 * k)
  const hem: V[] = []
  for (let i = 1; i < 4; i++) {
    const u = i / 4
    const p = lerpV(hemFront, hemBack, u)
    hem.push(vec(p.x + Math.sin(t * 2.4 + u * 5 + c.seed) * 0.5 * k, p.y + Math.sin(u * Math.PI) * 0.5 * k))
  }
  return [waistF, vec(Math.max(midF.x + rMid + 1.1 * k * flare, waistF.x - 0.5 * k), midF.y), hemFront, ...hem, hemBack, vec(Math.min(midB.x - rMid - 1.4 * k * flare, butt.x), midB.y), butt, waistB]
}

/** Jacket / tunic below the waist: follows the torso (not the legs) down to `bottomU` (negative = below the hips). */
function jacketPts(c: BuildCtx, bottomU: number, extra: number, flare = 0): V[] {
  const { sk, d } = c
  const us: number[] = []
  for (let u = 0.42; u > bottomU + 1e-6; u -= 0.1) us.push(u)
  us.push(bottomU)
  const grow = (u: number): number => flare * clamp(-u / Math.max(0.01, -bottomU))
  const fAt = (u: number): number => (u >= 0 ? interpTorso(d.fr, u) : d.fr[1] * (1 + u * 0.12)) + extra + grow(u)
  const bAt = (u: number): number => (u >= 0 ? interpTorso(d.bk, u) : d.bk[1] * (1 + u * 0.3)) + extra * 0.8 + grow(u)
  const front = us.map((u) => add(sk.spineAt(u), mul(sk.normalAt(u), fAt(u))))
  const back = us.map((u) => add(sk.spineAt(u), mul(sk.normalAt(u), -bAt(u)))).reverse()
  return [...front, ...back]
}

function apronPts(c: BuildCtx): V[] {
  const { sk, d } = c
  const k = d.head / 13.5
  const front = [0.74, 0.6, 0.45, 0.3, 0.15, 0].map((u) => add(sk.spineAt(u), mul(sk.normalAt(u), interpTorso(d.fr, u) + 0.55 * k)))
  const nearFront = sk.KF.x >= sk.KB.x
  const fK = nearFront ? sk.KF : sk.KB
  const fH = nearFront ? sk.HF : sk.HB
  const kneeTop = lerpV(fH, fK, 0.86)
  const bottomFront = vec(Math.max(kneeTop.x + d.rKnee + 1.1 * k, front[front.length - 1].x - 1 * k), kneeTop.y)
  const bottomBack = vec(lerp(sk.P.x, kneeTop.x, 0.3), kneeTop.y + 0.6 * k)
  const midBack = add(sk.spineAt(0.12), mul(sk.normalAt(0.12), 1.2 * k))
  const topBack = add(sk.spineAt(0.74), mul(sk.normalAt(0.74), interpTorso(d.fr, 0.74) - 3.2 * k))
  return [...front, bottomFront, bottomBack, midBack, topBack]
}

function tassets(c: BuildCtx): V[] {
  const { sk, d } = c
  const k = d.head / 13.5
  const waistF = add(sk.spineAt(0.28), mul(sk.normalAt(0.28), interpTorso(d.fr, 0.28) + 0.8 * k))
  const waistB = add(sk.spineAt(0.28), mul(sk.normalAt(0.28), -(interpTorso(d.bk, 0.28) + 0.8 * k)))
  const len = 17 * k
  const thighF = lerpV(sk.HF, sk.KF, clamp((len / d.thigh) * 0.62))
  const thighB = lerpV(sk.HB, sk.KB, clamp((len / d.thigh) * 0.62))
  const frontX = Math.max(thighF.x, thighB.x) + d.rHip * 1.05 + 1.2 * k
  const backX = Math.min(thighF.x, thighB.x) - d.rHip * 1.1 - 1.6 * k
  const y = Math.max(thighF.y, thighB.y) + 1.4 * k
  const pts: V[] = [waistF, vec(frontX, lerp(waistF.y, y, 0.55)), vec(frontX + 0.6 * k, y)]
  for (let i = 1; i < 4; i++) pts.push(vec(lerp(frontX, backX, i / 4), y + (i % 2 ? 1.0 : -0.2) * k))
  pts.push(vec(backX - 0.6 * k, y))
  pts.push(vec(backX, lerp(waistB.y, y, 0.5)))
  pts.push(waistB)
  return pts
}

function buildFigure(c: BuildCtx): Prim[] {
  const { sk, d, ps, look } = c
  const out: Prim[] = []
  const k = d.head / 13.5
  const outfit = look.outfit
  const robe = LONG_ROBE.has(outfit)
  const armor = outfit === 'armor'
  const wide = WIDE_SLEEVE.has(outfit)
  const boots = armor || outfit === 'tunic' || outfit === 'uniform'
  const legRole: Role = outfit === 'sport' ? 'skin' : 'bottom'
  const shortSleeve = outfit === 'sport' || outfit === 'casual'
  const armRole: Role = outfit === 'sport' ? 'skin' : 'top'
  // translucent puppet leather would show the legs through a long garment: only the feet show there
  const hideLegs = c.style === 'puppet' && (robe || outfit === 'dress' || outfit === 'coat' || outfit === 'lab-coat')

  // 1. cape and long hair behind everything
  capePrims(c, out)
  hairPrims(c, out, true)

  // 2. far arm
  const pauldron = (Sh: V, E: V, far: boolean, s = 1): Prim => {
    const ax = angOf(sub(E, Sh))
    return { d: smoothPath([local(Sh, ax, -2.4 * k * s, -4.6 * k * s), local(Sh, ax, 7.0 * k * s, -3.6 * k * s), local(Sh, ax, 8.5 * k * s, 0), local(Sh, ax, 7.0 * k * s, 3.8 * k * s), local(Sh, ax, -2.4 * k * s, 4.6 * k * s)], true), role: 'metal', far }
  }
  out.push({ d: capsule(sk.SB, d.rSh * (wide ? 1.25 : 1), sk.EB, d.rEl * (wide ? 1.3 : 1)), role: armRole, far: true })
  out.push({ d: capsule(sk.EB, d.rEl * (wide ? 1.2 : 1), sk.WB, d.rWr * (wide ? 1.1 : 1)), role: shortSleeve ? 'skin' : armRole, far: true })
  if (shortSleeve) out.push({ d: capsule(sk.SB, d.rSh * 1.12, lerpV(sk.SB, sk.EB, 0.55), d.rEl * 1.18), role: 'top', far: true })
  if (wide) sleevePrims(c, sk.EB, sk.WB, true, out)
  out.push({ d: handPath(c, sk.WB, sk.handB, ps.handB, false), role: 'skin', far: true })
  if (armor) out.push(pauldron(sk.SB, sk.EB, true, 0.94))
  if (look.propL !== 'none') propPrims(c, look.propL, sk.WB, sk.handB, ps.propB, ps.poleB, out, false, null)
  else if (look.propR !== 'none' && ps.longTo > 0.5 && ps.longTo < 1.5) propPrims(c, look.propR, sk.WB, sk.handB, 0, ps.poleB, out, false, null)

  // 3. legs (both under the torso: a shirt or jacket hangs over the hips)
  const legPrims = (H: V, K: V, A: V, foot: number, far: boolean): void => {
    if (!hideLegs) {
      const calf = lerpV(K, A, 0.32)
      const calfOff = add(calf, mul(dir(angOf(sub(A, K)) - 90), d.rCalf * 0.22))
      out.push({ d: capsule(H, d.rHip, K, d.rKnee), role: legRole, far, tag: 'leg' })
      out.push({ d: capsule(K, d.rKnee, calfOff, d.rCalf), role: boots ? 'shoe' : legRole, far })
      out.push({ d: capsule(calfOff, d.rCalf, A, d.rAnk), role: boots ? 'shoe' : legRole, far })
      if (outfit === 'sport') out.push({ d: capsule(H, d.rHip * 1.08, lerpV(H, K, 0.5), lerp(d.rHip, d.rKnee, 0.5) * 1.12), role: 'bottom', far })
    }
    out.push({ d: footPath(c, A, foot, boots), role: 'shoe', far })
  }
  legPrims(sk.HB, sk.KB, sk.AB, sk.footB, true)
  legPrims(sk.HF, sk.KF, sk.AF, sk.footF, false)

  // 4. torso
  const torsoExtraF = armor ? 0.9 * k : outfit === 'coat' || outfit === 'hoodie' ? 0.5 * k : 0
  const torsoExtraB = armor ? 0.6 * k : outfit === 'hoodie' ? 0.6 * k : 0
  const torsoPts = torsoOutline(c, torsoExtraF, torsoExtraB, hideLegs ? 0.24 : -0.1)
  out.push({ d: smoothPath(torsoPts, true), role: 'top', tag: 'torso', pts: torsoPts })
  if (outfit === 'hoodie') out.push({ d: ellipsePath(add(sk.N, mul(sk.normalAt(0.95), -3.6 * k)), 3.4 * k, 2.8 * k, -sk.lean), role: 'top' })
  if (armor && c.lod === 'high' && (c.style === 'flat' || c.style === 'puppet')) {
    for (let u = 0.38; u < 0.84; u += 0.08) {
      const f = add(sk.spineAt(u), mul(sk.normalAt(u), interpTorso(d.fr, u) + torsoExtraF - 0.8))
      const b = add(sk.spineAt(u), mul(sk.normalAt(u), -(interpTorso(d.bk, u) + torsoExtraB - 0.8)))
      out.push({ d: polyPath([f, b], false), role: 'trim', line: 0.35 * k, fine: true })
    }
  }

  // 5. garments over the legs
  if (robe) {
    const pts = robeSkirt(c)
    out.push({ d: smoothPath(pts, true, 0.9), role: 'bottom', tag: 'skirt', pts })
  } else if (outfit === 'dress') {
    const pts = skirtPts(c, 'knee', 1.6)
    out.push({ d: smoothPath(pts, true, 0.9), role: 'bottom', tag: 'skirt', pts })
  } else if (outfit === 'coat' || outfit === 'lab-coat') {
    const pts = skirtPts(c, 'knee', 0.6)
    out.push({ d: smoothPath(pts, true, 0.9), role: 'top', tag: 'jacket', pts })
    if (c.lod === 'high' && (c.style === 'flat' || c.style === 'puppet')) out.push({ d: polyPath([add(sk.spineAt(0.86), mul(sk.normalAt(0.86), interpTorso(d.fr, 0.86) - 0.6 * k)), add(sk.spineAt(0.3), mul(sk.normalAt(0.3), interpTorso(d.fr, 0.3) + 0.1)), pts[2]], false), role: 'trim', line: 0.4 * k, fine: true })
  } else if (outfit === 'tunic') {
    const pts = jacketPts(c, -0.62, 0.7 * k, 2.4 * k)
    out.push({ d: smoothPath(pts, true, 0.9), role: 'top', tag: 'jacket', pts })
  } else if (outfit === 'suit' || outfit === 'uniform') {
    const pts = jacketPts(c, -0.34, 0.6 * k, 0.4 * k)
    out.push({ d: smoothPath(pts, true, 0.9), role: 'top', tag: 'jacket', pts })
  } else if (armor) {
    const pts = tassets(c)
    out.push({ d: smoothPath(pts, true, 0.75), role: 'metal', tag: 'skirt', pts })
  } else if (outfit === 'apron') {
    const pts = apronPts(c)
    out.push({ d: smoothPath(pts, true, 0.7, pts.map((_, i) => i === 6 || i === 7)), role: 'trim', pts })
    out.push({ d: polyPath([pts[pts.length - 1], add(sk.N, mul(sk.normalAt(0.95), -1.8 * k))], false), role: 'trim', line: 0.55 * k, fine: true })
  }
  // collar & tie (colour styles only — silhouettes keep a clean outline)
  if ((outfit === 'suit' || outfit === 'uniform') && c.lod === 'high' && (c.style === 'flat' || c.style === 'puppet')) {
    const top = add(sk.spineAt(0.97), mul(sk.normalAt(0.97), interpTorso(d.fr, 0.97) - 0.2 * k))
    const bot = add(sk.spineAt(0.62), mul(sk.normalAt(0.62), interpTorso(d.fr, 0.62) - 0.3 * k))
    out.push({ d: polyPath([top, add(top, mul(sk.normalAt(0.9), -2.6 * k)), lerpV(top, bot, 0.3)]), role: 'light', fine: true })
    if (outfit === 'suit') out.push({ d: polyPath([lerpV(top, bot, 0.1), add(lerpV(top, bot, 0.85), mul(sk.normalAt(0.7), -0.9 * k)), bot, add(lerpV(top, bot, 0.15), mul(sk.normalAt(0.9), -0.9 * k))]), role: 'accent', fine: true })
  }
  // sash / belt
  if (robe || armor || outfit === 'tunic' || outfit === 'uniform') {
    const bf = add(sk.spineAt(0.33), mul(sk.normalAt(0.33), interpTorso(d.fr, 0.33) + (armor ? 1.2 : 0.6) * k))
    const bb = add(sk.spineAt(0.33), mul(sk.normalAt(0.33), -(interpTorso(d.bk, 0.33) + (armor ? 1.0 : 0.6) * k)))
    const up = mul(sk.tangentAt(0.33), 1.6 * k)
    out.push({ d: polyPath([sub(bf, up), add(bf, up), add(bb, up), sub(bb, up)]), role: 'sash' })
    if (robe && c.lod === 'high') {
      const tie = lerpV(bf, bb, 0.15)
      const pts = chain(tie, 4, -10 - windDrift(c) * 30, 11 * k, 4, 6, (c.frame / c.fps) * 3 + c.seed)
      out.push({ d: ribbon(pts, 1.6 * k, 1.0 * k), role: 'sash', fine: true })
    }
  }

  // 6. neck + head
  out.push({ d: capsule(sk.N, d.rNeck * 1.12, sk.headO, d.rNeck), role: 'skin' })
  const headPts = look.build === 'child' ? HEAD_CHILD : look.gender === 'female' ? HEAD_FEMALE : HEAD_MALE
  const headPrim: Prim = { d: headShape(c, headPts), role: 'skin' }
  if (c.style === 'puppet' && c.lod === 'high') {
    const eye = [headPt(c, 2.4, -7.1), headPt(c, 4.0, -7.9), headPt(c, 5.0, -7.25), headPt(c, 3.9, -6.75)]
    const brow = [headPt(c, 1.8, -8.7), headPt(c, 4.6, -9.4), headPt(c, 4.9, -9.0), headPt(c, 2.0, -8.3)]
    headPrim.holes = smoothPath(eye, true, 0.8) + smoothPath(brow, true, 0.6)
  }
  out.push(headPrim)
  if (look.beard !== 'none') {
    const pts: [number, number, boolean?][] = look.beard === 'long'
      ? [[1.0, -2.6], [4.6, -1.8], [6.0, -0.6], [5.2, 4.4], [3.6, 8.6, true], [1.6, 4.6], [-0.4, 0.4]]
      : [[0.6, -3.4], [4.8, -1.6], [6.1, -0.4], [5.6, 1.4], [4.0, 2.2], [1.6, 1.4], [-0.6, -1.0]]
    out.push({ d: headShape(c, pts), role: 'hair' })
  }
  hairPrims(c, out, false)
  headwearPrims(c, out)
  if (c.style === 'flat' && c.lod === 'high') {
    const eyeAt = headPt(c, 3.7, -7.0)
    const blinkT = ((c.frame / c.fps + c.seed * 0.37) % 3.9 + 3.9) % 3.9
    if (blinkT < 0.11) out.push({ d: polyPath([headPt(c, 3.05, -7.0), headPt(c, 4.35, -7.0)], false), role: 'dark', line: 0.42 * k, fine: true })
    else out.push({ d: circlePath(eyeAt, 0.62 * k), role: 'dark', fine: true })
    out.push({ d: polyPath([headPt(c, 2.9, -8.5), headPt(c, 4.7, -8.75)], false), role: 'hair', line: 0.45 * k, fine: true })
    if (ps.mouth > 0.2) out.push({ d: ellipsePath(headPt(c, 5.2, -1.7), 0.55 * k, 0.45 * k * ps.mouth + 0.15 * k, 0), role: 'dark', fine: true })
  }

  // 7. near arm
  out.push({ d: capsule(sk.S, d.rSh * (wide ? 1.25 : 1), sk.E, d.rEl * (wide ? 1.3 : 1)), role: armRole })
  out.push({ d: capsule(sk.E, d.rEl * (wide ? 1.2 : 1), sk.W, d.rWr * (wide ? 1.1 : 1)), role: shortSleeve ? 'skin' : armRole })
  if (shortSleeve) out.push({ d: capsule(sk.S, d.rSh * 1.12, lerpV(sk.S, sk.E, 0.55), d.rEl * 1.18), role: 'top' })
  out.push({ d: handPath(c, sk.W, sk.handF, ps.handF, true), role: 'skin' })
  if (wide) sleevePrims(c, sk.E, sk.W, false, out)
  if (armor) out.push(pauldron(sk.S, sk.E, false))
  if (look.propR !== 'none' && ps.longTo < 0.5) propPrims(c, look.propR, sk.W, sk.handF, ps.propF, ps.poleF, out, true, null)
  // puppet joints
  if (c.style === 'puppet' && c.lod === 'high') {
    for (const j of hideLegs ? [sk.S, sk.E] : [sk.S, sk.E, sk.HF, sk.KF]) out.push({ d: circlePath(j, 0.75 * k), role: 'dark', rivet: true })
  }
  return out
}

// ================================================================================================ timeline

interface Evaluated {
  pose: Pose
  dx: number
  speed: number
}

function actionCtx(action: FigureAction, localFrame: number, fps: number, duration: number, cycFromTravel: number | null, props: FigureProps, look: LookResolved, phaseOff: number): ActCtx {
  const t = Math.max(0, localFrame) / fps
  const sp = props.speed ?? 1
  const cyc = cycFromTravel !== null ? cycFromTravel : (t * sp) / (CYCLE[action] || 1) + phaseOff
  return { t, p: clamp(localFrame / Math.max(1, duration)), cyc, propF: look.propR, propB: look.propL, strike: props.strike ?? null }
}

/** Long props stay upright in the hand during non-weapon actions */
/** one-handed gestures of the near hand (a long prop moves to the far hand) and two-handed ones (it is set down) */
const NEAR_GESTURES = new Set<FigureAction>(['point', 'wave', 'drink', 'think', 'present', 'talk', 'read'])
const BOTH_HANDS = new Set<FigureAction>(['cheer', 'salute', 'clap', 'type', 'write', 'carry', 'push', 'dance'])

function applyHolds(pose: Pose, action: FigureAction, look: LookResolved): Pose {
  const ps = { ...pose }
  const longR = LONG_PROPS.has(look.propR)
  if (longR && NEAR_GESTURES.has(action) && look.propL === 'none') {
    // the near hand gestures: the far hand takes the long prop and holds it upright
    ps.longTo = 1
    ps.sB = 18
    ps.eB = 74
    ps.wB = 0
    ps.ikBx = NaN
    ps.ikBy = NaN
    ps.poleB = 176
    ps.handB = 'fist'
    return ps
  }
  if (longR && (BOTH_HANDS.has(action) || NEAR_GESTURES.has(action))) {
    ps.longTo = 2
    return ps
  }
  if (longR && !WEAPON_ACTIONS.has(action) && !['fall', 'collapse', 'jump'].includes(action)) {
    if (look.propR === 'umbrella') {
      ps.ikFx = 6
      ps.ikFy = -2
      ps.poleF = 176
    } else if (look.propR === 'torch' || look.propR === 'lantern') {
      ps.sF = 42
      ps.eF = 46
      ps.poleF = 176
    } else {
      ps.sF = action === 'run' ? 30 : 16
      ps.eF = action === 'run' ? 70 : 76
      ps.wF = 0
      ps.ikFx = NaN
      ps.ikFy = NaN
      ps.poleF = action === 'run' ? 120 : 176
    }
    ps.handF = 'fist'
  }
  if (longR && Number.isNaN(ps.poleF) && !['swing', 'throw', 'fall', 'collapse'].includes(action)) {
    ps.poleF = 176
    ps.handF = 'fist'
  }
  if (look.propR !== 'none' && !LONG_PROPS.has(look.propR)) ps.handF = ps.handF === 'open' ? 'open' : 'fist'
  if (look.propR === 'sword' && !WEAPON_ACTIONS.has(action)) ps.propF = 30
  if (look.propL === 'bow' && action !== 'draw-bow') {
    ps.sB = 8
    ps.eB = 10
  }
  if (look.propL === 'shield') {
    ps.sB = Math.max(ps.sB, 40)
    ps.eB = 70
  }
  return ps
}

function evaluate(props: FigureProps, frame: number, fps: number, look: LookResolved, unitsPerPx: number): Evaluated {
  const phaseOff = props.phase ?? 0
  if (props.script && props.script.length > 0) {
    const steps = [...props.script].sort((a, b) => a.from - b.from)
    let idx = 0
    for (let i = 0; i < steps.length; i++) if (steps[i].from <= frame) idx = i
    let dx = 0
    for (let i = 0; i < idx; i++) dx += steps[i].dx ?? 0
    const st = steps[idx]
    const lf = frame - st.from
    const dur = Math.max(1, st.dur)
    const pr = clamp(lf / dur)
    const loco = LOCOMOTION.has(st.action)
    const stepDx = (st.dx ?? 0) * (loco ? pr : easeInOut(pr))
    const unitsTravelled = Math.abs((st.dx ?? 0) * pr) * unitsPerPx
    const cyc = loco && st.dx ? unitsTravelled / (STRIDE[st.action] || 74) + phaseOff : null
    let pose = applyHolds(poseFor(st.action, actionCtx(st.action, lf, fps, dur, cyc, props, look, phaseOff)), st.action, look)
    if (st.upper) pose = overlayUpper(pose, applyHolds(poseFor(st.upper, actionCtx(st.upper, lf, fps, dur, null, props, look, phaseOff)), st.upper, look))
    if (idx > 0 && lf < 8) {
      const pv = steps[idx - 1]
      const pdur = Math.max(1, pv.dur)
      const ploco = LOCOMOTION.has(pv.action)
      const pcyc = ploco && pv.dx ? (Math.abs(pv.dx) * unitsPerPx) / (STRIDE[pv.action] || 74) + phaseOff : null
      let prev = applyHolds(poseFor(pv.action, actionCtx(pv.action, pdur, fps, pdur, pcyc, props, look, phaseOff)), pv.action, look)
      if (pv.upper) prev = overlayUpper(prev, applyHolds(poseFor(pv.upper, actionCtx(pv.upper, pdur, fps, pdur, null, props, look, phaseOff)), pv.upper, look))
      pose = blendPose(prev, pose, smooth(lf / 8))
    }
    const speed = loco && st.dx ? (Math.abs(st.dx) * unitsPerPx) / (dur / fps) : loco ? (STRIDE[st.action] || 74) / (CYCLE[st.action] || 1) : 0
    return { pose, dx: dx + stepDx, speed }
  }
  const action = props.action || 'idle'
  const hasStart = typeof props.start === 'number'
  const start = props.start ?? 0
  const loco = LOCOMOTION.has(action)
  const dur = Math.max(1, props.duration ?? (loco && props.travel ? 90 : Math.round(((ONE_SHOT[action] || 30) * fps) / 30)))
  let lf = frame - start
  if (!hasStart && HOLD_ACTIONS.has(action)) lf = dur
  const travel = props.travel ?? 0
  const pr = clamp(lf / dur)
  const cyc = loco && travel ? (Math.abs(travel * pr) * unitsPerPx) / (STRIDE[action] || 74) + phaseOff : null
  let pose = applyHolds(poseFor(action, actionCtx(action, lf, fps, dur, cyc, props, look, phaseOff)), action, look)
  if (props.upper) pose = overlayUpper(pose, applyHolds(poseFor(props.upper, actionCtx(props.upper, lf, fps, dur, null, props, look, phaseOff)), props.upper, look))
  const speed = loco && travel ? (Math.abs(travel) * unitsPerPx) / (dur / fps) : loco ? (STRIDE[action] || 74) / (CYCLE[action] || 1) : 0
  return { pose, dx: loco ? travel * pr : 0, speed }
}

function overlayUpper(lower: Pose, upper: Pose): Pose {
  return {
    ...lower,
    sF: upper.sF, eF: upper.eF, wF: upper.wF, sB: upper.sB, eB: upper.eB, wB: upper.wB,
    ikFx: upper.ikFx, ikFy: upper.ikFy, ikBx: upper.ikBx, ikBy: upper.ikBy,
    handF: upper.handF, handB: upper.handB, propF: upper.propF, propB: upper.propB, poleF: upper.poleF, poleB: upper.poleB,
    twoHand: upper.twoHand, neck: upper.neck, mouth: upper.mouth, tilt: upper.tilt, draw: upper.draw, flip: upper.flip,
    lean: lower.lean + (upper.lean - BASE.lean) * 0.6,
  }
}

// ================================================================================================ rendering

interface Palette {
  fill: (r: Role, far: boolean) => string
  opacity: (r: Role) => number
  stroke: string | null
  strokeW: number
}

function paletteFor(style: FigureStyle, look: LookResolved, color: string | undefined, accent: string | null | undefined): Palette {
  const c = look.colors
  if (style === 'silhouette' || style === 'ink' || style === 'stick') {
    const ink = color || (style === 'ink' ? '#1E1E1E' : '#17110D')
    const acc = accent === null ? ink : accent || c.cape
    return {
      fill: (r) => (r === 'cape' || r === 'plume' || r === 'cloth' || r === 'sash' ? (r === 'sash' && accent === undefined ? ink : acc) : r === 'flame' ? '#FFB347' : r === 'glow' ? '#FF9A3C' : r === 'light' ? ink : ink),
      opacity: () => 1,
      stroke: null,
      strokeW: 0,
    }
  }
  if (style === 'papercut') {
    const paper = color || '#B8302A'
    const acc = accent === null ? paper : accent || paper
    return {
      fill: (r) => (r === 'cape' || r === 'plume' || r === 'cloth' ? acc : r === 'flame' ? '#F6C453' : r === 'glow' ? '#F6C453' : paper),
      opacity: () => 1,
      stroke: null,
      strokeW: 0,
    }
  }
  if (style === 'puppet') {
    const tone = (hex: string, far: boolean) => mixColor(shade(hex, far ? -0.22 : 0.04), '#D9822B', 0.08)
    return {
      fill: (r, far) => {
        switch (r) {
          case 'skin': return tone('#E9C79A', far)
          case 'hair': return '#2A140C'
          case 'top': return tone(c.top, far)
          case 'bottom': return tone(c.bottom, far)
          case 'shoe': return '#3A1E12'
          case 'accent': case 'plume': case 'cloth': case 'sash': return tone(c.accent, far)
          case 'cape': return tone(c.cape, far)
          case 'metal': return tone('#7A6A4F', far)
          case 'trim': return tone(c.trim, far)
          case 'wood': return '#6B4226'
          case 'flame': return '#FFC145'
          case 'glow': return '#FF8C3A'
          case 'dark': return '#2A140C'
          case 'light': return tone('#F3E7CF', far)
          case 'paper': return tone('#F1DEB4', far)
          default: return tone(c.top, far)
        }
      },
      opacity: (r) => (r === 'dark' || r === 'hair' ? 0.95 : 0.86),
      stroke: '#2A140C',
      strokeW: 0.42,
    }
  }
  // flat
  return {
    fill: (r, far) => {
      const f = (hex: string) => (far ? shade(hex, -0.22) : hex)
      switch (r) {
        case 'skin': return f(c.skin)
        case 'hair': return f(c.hair)
        case 'top': return f(c.top)
        case 'bottom': return f(c.bottom)
        case 'shoe': return f(c.shoes)
        case 'accent': case 'plume': case 'sash': return f(c.accent)
        case 'cape': return f(c.cape)
        case 'cloth': return f(c.accent)
        case 'metal': return f('#8D939E')
        case 'trim': return f(c.trim)
        case 'wood': return f('#7A5232')
        case 'flame': return '#FFB020'
        case 'glow': return '#FF7A1A'
        case 'dark': return '#1F2328'
        case 'light': return f('#F6F4EF')
        case 'paper': return f('#F3E9D2')
        default: return f(c.top)
      }
    },
    opacity: () => 1,
    stroke: null,
    strokeW: 0,
  }
}

/** x-extent of a closed polygon at height y (null if the line misses it) */
function spanAt(pts: V[], y: number): [number, number] | null {
  const xs: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x))
  }
  if (xs.length < 2) return null
  return [Math.min(...xs), Math.max(...xs)]
}

const holeDrop = (c: V, s: number): string => smoothPath([vec(c.x, c.y - s * 1.3), vec(c.x + s * 0.62, c.y + s * 0.2), vec(c.x, c.y + s * 0.75), vec(c.x - s * 0.62, c.y + s * 0.2)], true, 0.9, [true, false, false, false])
const holeDiamond = (c: V, s: number): string => polyPath([vec(c.x, c.y - s), vec(c.x + s * 0.6, c.y), vec(c.x, c.y + s), vec(c.x - s * 0.6, c.y)])
const holeCrescent = (c: V, s: number): string => smoothPath([vec(c.x - s, c.y), vec(c.x, c.y - s * 0.9), vec(c.x + s, c.y), vec(c.x, c.y - s * 0.35)], true, 0.8, [true, false, true, false])

/** decorative cut-outs for papercut / puppet styles, punched into garments (always fully inside the part) */
function addOrnaments(c: BuildCtx, prims: Prim[]): void {
  if (c.lod !== 'high') return
  const k = c.d.head / 13.5
  const inset = 2.4 * k
  for (const p of prims) {
    if (!p.pts || p.line) continue
    let holes = ''
    const ys = p.pts.map((q) => q.y)
    const top = Math.min(...ys)
    const bot = Math.max(...ys)
    const h = bot - top
    if (p.tag === 'skirt' || p.tag === 'jacket') {
      const rows = h > 30 * k ? [0.42, 0.7, 0.88] : h > 14 * k ? [0.45, 0.78] : [0.6]
      rows.forEach((fy, r) => {
        const y = top + h * fy
        const span = spanAt(p.pts as V[], y)
        if (!span) return
        const x0 = span[0] + inset
        const x1 = span[1] - inset
        const s = (r === rows.length - 1 ? 1.0 : 1.3) * k
        const n = Math.floor((x1 - x0) / (s * 3.2))
        for (let i = 0; i < n; i++) {
          const cx = lerp(x0, x1, (i + 0.5) / n)
          const at = vec(cx, y)
          holes += r === rows.length - 1 ? holeDiamond(at, s) : r % 2 ? holeCrescent(at, s) : holeDrop(at, s)
        }
      })
    } else if (p.tag === 'torso') {
      // a short column along the back (the near arm covers the chest in profile)
      for (const u of [0.48, 0.6, 0.72]) {
        const at = add(c.sk.spineAt(u), mul(c.sk.normalAt(u), -interpTorso(c.d.bk, u) * 0.52))
        holes += holeDrop(at, 1.05 * k)
      }
    } else if (p.tag === 'cape') {
      const n = p.pts.length
      for (const f of [0.3, 0.52, 0.74]) {
        const a = p.pts[Math.floor(f * (n / 2))]
        const b = p.pts[n - 1 - Math.floor(f * (n / 2) * 0.62)]
        if (!a || !b || dist(a, b) < 7 * k) continue
        holes += holeCrescent(lerpV(a, b, 0.5), 1.4 * k)
      }
    } else if (p.tag === 'sleeve') {
      const cxy = p.pts.reduce((acc, q) => add(acc, mul(q, 1 / (p.pts as V[]).length)), vec(0, 0))
      holes += circlePath(cxy, 0.9 * k)
    }
    if (holes) p.holes = (p.holes || '') + holes
  }
}

interface RenderOpts {
  style: FigureStyle
  palette: Palette
  rim: string | null
  rimOffset: V
  uid: string
  scale: number
}

function renderPrims(prims: Prim[], o: RenderOpts, keyPrefix: string, forceFill?: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  prims.forEach((p, i) => {
    const key = `${keyPrefix}${i}`
    if (p.text) {
      if (forceFill) return
      nodes.push(
        <text key={key} x={p.text.at.x} y={p.text.at.y} fontSize={p.text.size} textAnchor="middle" dominantBaseline="central" fill={o.palette.fill('dark', false)} fontFamily="'Noto Serif SC','Source Han Serif SC',serif" fontWeight={700} transform={`rotate(${p.text.rot} ${p.text.at.x} ${p.text.at.y})`}>
          {p.text.ch}
        </text>,
      )
      return
    }
    if (!p.d) return
    const fill = forceFill ?? o.palette.fill(p.role, Boolean(p.far))
    if (p.line) {
      nodes.push(<path key={key} d={p.d} fill="none" stroke={fill} strokeWidth={p.line} strokeLinecap="round" strokeLinejoin="round" />)
      return
    }
    const d = p.holes && !forceFill ? `${p.d}${p.holes}` : p.d
    nodes.push(
      <path
        key={key}
        d={d}
        fill={fill}
        fillRule={p.holes && !forceFill ? 'evenodd' : undefined}
        fillOpacity={forceFill ? 1 : o.palette.opacity(p.role)}
        stroke={forceFill ? undefined : o.palette.stroke && !p.rivet ? o.palette.stroke : fill}
        strokeWidth={forceFill ? undefined : o.palette.stroke && !p.rivet ? o.palette.strokeW : 0.32}
        strokeLinejoin="round"
      />,
    )
  })
  return nodes
}

function papercutNodes(prims: Prim[], o: RenderOpts): React.ReactNode {
  const paper = o.palette.fill('top', false)
  const inSheet = prims.filter((p) => !p.text && o.palette.fill(p.role, false) === paper)
  const others = prims.filter((p) => !inSheet.includes(p))
  const holes = inSheet.map((p) => p.holes || '').join('')
  const box = { x: -150, y: -240, w: 300, h: 270 }
  return (
    <g>
      <defs>
        <mask id={`${o.uid}pm`} maskUnits="userSpaceOnUse" x={box.x} y={box.y} width={box.w} height={box.h}>
          {inSheet.map((p, i) => (p.line ? <path key={i} d={p.d} fill="none" stroke="#fff" strokeWidth={p.line} strokeLinecap="round" /> : <path key={i} d={p.d} fill="#fff" stroke="#fff" strokeWidth={0.32} />))}
          {holes ? <path d={holes} fill="#000" /> : null}
        </mask>
      </defs>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={paper} mask={`url(#${o.uid}pm)`} />
      {renderPrims(others, o, 'po')}
    </g>
  )
}

function stickPrims(c: BuildCtx, ink: string): React.ReactNode[] {
  const { sk, d } = c
  const w = 2.6
  const line = (pts: V[], key: string) => <path key={key} d={polyPath(pts, false)} fill="none" stroke={ink} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
  const headC = headPt(c, 0.6, -6.2)
  return [
    line([sk.HB, sk.KB, sk.AB, local(sk.AB, sk.footB, 0.6 * d.foot, 0)], 'lb'),
    line([sk.SB, sk.EB, sk.WB], 'ab'),
    line([sk.P, sk.spineAt(0.5), sk.N, sk.headO], 'sp'),
    line([sk.HF, sk.KF, sk.AF, local(sk.AF, sk.footF, 0.6 * d.foot, 0)], 'lf'),
    line([sk.S, sk.E, sk.W], 'af'),
    <circle key="hd" cx={headC.x} cy={headC.y} r={d.head * 0.47} fill={ink} />,
  ]
}

function figureNodes(c: BuildCtx, o: RenderOpts, color: string | undefined): React.ReactNode {
  if (c.style === 'stick') {
    const ink = color || '#1C1C1C'
    const extra: Prim[] = []
    if (c.look.propR !== 'none') propPrims(c, c.look.propR, c.sk.W, c.sk.handF, c.ps.propF, c.ps.poleF, extra, true, null)
    return (
      <g>
        {renderPrims(extra, o, 'sp')}
        {stickPrims(c, ink)}
      </g>
    )
  }
  const prims = buildFigure(c).filter((p) => c.lod === 'high' || !p.fine)
  if (c.style === 'papercut' || c.style === 'puppet') addOrnaments(c, prims)
  if (c.style === 'papercut') return papercutNodes(prims, o)
  if (c.style === 'puppet' && c.lod === 'high') {
    const rodEnd = (p: V): V => add(p, vec(6, 60))
    prims.push({ d: polyPath([c.sk.W, rodEnd(c.sk.W)], false), role: 'dark', line: 0.35 })
    prims.push({ d: polyPath([c.sk.N, add(c.sk.N, vec(-4, 80))], false), role: 'dark', line: 0.35 })
  }
  return <g>{renderPrims(prims, o, 'p')}</g>
}

// ================================================================================================ components

export const Figure: React.FC<FigureProps> = (props) => {
  const current = useCurrentFrame()
  const { fps } = useVideoConfig()
  const rawId = React.useId()
  const uid = `fk${rawId.replace(/[^a-zA-Z0-9]/g, '')}`
  const frame = props.frame ?? current
  const look = resolveLook(props.look)
  const style: FigureStyle = (FIGURE_STYLES as readonly string[]).includes(String(props.style)) ? (props.style as FigureStyle) : 'flat'
  const height = Math.max(4, props.height)
  const scale = height / 100
  const unitsPerPx = 1 / scale
  const d = buildDims({ build: look.build, gender: look.gender })
  const ev = evaluate(props, frame, fps, look, unitsPerPx)
  const seatUnits = (props.seat ?? height * 0.26) * unitsPerPx
  const sk = solveSkeleton(d, ev.pose, seatUnits)
  const lod: 'high' | 'low' = props.detail === 'high' ? 'high' : props.detail === 'low' ? 'low' : height < 90 ? 'low' : 'high'
  const seed = (hash(props.x * 0.013 + props.y * 0.007 + height * 0.11) * 100) % 37
  const ctx: BuildCtx = { d, sk, ps: ev.pose, look, frame, fps, wind: props.wind ?? 0, speed: ev.speed, lod, style, seed }
  const facing = props.facing === -1 ? -1 : 1
  const palette = paletteFor(style, look, props.color, props.accent)
  const lightDeg = props.light ?? -40
  const rimW = Math.max(1.2, height * 0.0065)
  const rimOffset = vec(Math.cos(lightDeg * D2R) * rimW, Math.sin(lightDeg * D2R) * rimW)
  const o: RenderOpts = { style, palette, rim: props.rim ?? null, rimOffset, uid, scale }
  const x = props.x + ev.dx
  const tf = `translate(${fmt(x)} ${fmt(props.y)}) scale(${fmt(scale * facing)} ${fmt(scale)})`
  const body = figureNodes(ctx, o, props.color)
  const rimFill = props.rim && (style === 'silhouette' || style === 'ink' || style === 'papercut') ? props.rim : null
  const rimNodes = rimFill && style !== 'stick' ? renderPrims(buildFigure(ctx).filter((p) => lod === 'high' || !p.fine), o, 'r', rimFill) : null
  return (
    <g opacity={(props.opacity ?? 1) * (style === 'ink' ? 0.93 : 1)}>
      {style === 'ink' ? (
        <defs>
          <filter id={`${uid}ink`} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency={0.24} numOctaves={2} seed={3} />
            <feDisplacementMap in="SourceGraphic" scale={0.9} />
            <feGaussianBlur stdDeviation={0.14} />
          </filter>
        </defs>
      ) : null}
      {style === 'papercut' ? (
        <defs>
          <filter id={`${uid}pc`} x="-10%" y="-10%" width="130%" height="130%">
            <feDropShadow dx={0.5} dy={0.75} stdDeviation={0.55} floodColor="#000000" floodOpacity={0.32} />
          </filter>
        </defs>
      ) : null}
      {rimNodes ? <g transform={`translate(${fmt(rimOffset.x)} ${fmt(rimOffset.y)})`}><g transform={tf}>{rimNodes}</g></g> : null}
      <g transform={tf} filter={style === 'ink' ? `url(#${uid}ink)` : style === 'papercut' ? `url(#${uid}pc)` : undefined}>
        {body}
      </g>
    </g>
  )
}

// ---------------------------------------------------------------------------------------------- horse

export type HorseGait = 'idle' | 'walk' | 'trot' | 'canter' | 'gallop' | 'rear'

export interface HorseProps {
  x: number
  y: number
  /** use the same number as the height of a standing Figure at this depth — the horse is drawn to scale */
  height: number
  facing?: 1 | -1
  gait?: HorseGait
  travel?: number
  duration?: number
  start?: number
  rider?: FigureLook | null
  /** rider's upper-body action: idle (reins) | raise | swing | thrust | point | wave | draw-bow | talk */
  riderAction?: FigureAction
  style?: FigureStyle
  color?: string
  accent?: string | null
  rim?: string | null
  light?: number
  wind?: number
  strike?: StrikeInput | null
  /** coat colour (flat / puppet) */
  coat?: string
  /** saddle cloth colour (default: ink in silhouette, the rider's cape colour in colour styles) */
  tack?: string
  frame?: number
  speed?: number
  phase?: number
  opacity?: number
  dust?: boolean
}

/** horse body scale against a 100-unit person (withers ≈ 82 units, a steppe war horse) */
const HS = 0.92
const GAIT_CYCLE: Record<HorseGait, number> = { idle: 3.2, walk: 1.15, trot: 0.72, canter: 0.62, gallop: 0.48, rear: 2.4 }
const GAIT_STRIDE: Record<HorseGait, number> = { idle: 0, walk: 64, trot: 100, canter: 156, gallop: 210, rear: 0 }
// leg phase offsets: near fore, far fore, near hind, far hind
const GAIT_PHASE: Record<HorseGait, [number, number, number, number]> = {
  idle: [0, 0, 0, 0],
  walk: [0.25, 0.75, 0, 0.5],
  trot: [0, 0.5, 0.5, 0],
  canter: [0.62, 0.32, 0.32, 0],
  gallop: [0.5, 0.4, 0.1, 0],
  rear: [0, 0, 0, 0],
}

interface LegAngles {
  upper: number
  /** front: knee fold (cannon folds back); hind: hock angle (+ = flexed) */
  joint: number
  /** pastern angle relative to the cannon (+ = toe forward) */
  pastern: number
}

function horseLeg(gait: HorseGait, p: number, front: boolean, t: number, legIdx: number): LegAngles {
  const ph = ((p % 1) + 1) % 1
  if (gait === 'idle') {
    const shift = noise(t * 0.4, legIdx) * 2.5
    return front ? { upper: 2 + shift, joint: 0, pastern: 40 } : { upper: -26 + shift, joint: 29, pastern: 40 }
  }
  if (gait === 'rear') return front ? { upper: 72, joint: 118, pastern: 6 } : { upper: -4, joint: 36, pastern: 44 }
  const cfg = {
    walk: { stance: 0.62, reach: front ? 16 : -6, push: front ? -18 : -42, fold: front ? 55 : 34 },
    trot: { stance: 0.46, reach: front ? 26 : -2, push: front ? -24 : -48, fold: front ? 95 : 58 },
    canter: { stance: 0.38, reach: front ? 34 : 4, push: front ? -30 : -54, fold: front ? 112 : 68 },
    gallop: { stance: 0.34, reach: front ? 40 : 8, push: front ? -34 : -58, fold: front ? 122 : 74 },
  }[gait]
  if (ph < cfg.stance) {
    const q = ph / cfg.stance
    const upper = lerp(cfg.reach, cfg.push, q)
    const sink = Math.sin(Math.PI * q)
    return front ? { upper, joint: 3 * sink, pastern: 40 + 16 * sink } : { upper, joint: lerp(30, 15, q), pastern: 40 + 14 * sink }
  }
  const q = (ph - cfg.stance) / (1 - cfg.stance)
  const upper = lerp(cfg.push, cfg.reach, easeInOut(q))
  const f = Math.pow(Math.sin(Math.PI * Math.min(1, q * 1.1)), 1.2)
  return front ? { upper, joint: f * cfg.fold, pastern: 40 - f * cfg.fold * 0.5 } : { upper, joint: lerp(15, 30, q) + f * cfg.fold, pastern: 40 - f * 32 }
}

/** rotate a vector by an angle in the limb convention (+ = towards forward / counter-clockwise on screen) */
const rotLimb = (v: V, a: number): V => {
  const r = a * D2R
  return vec(v.x * Math.cos(r) + v.y * Math.sin(r), -v.x * Math.sin(r) + v.y * Math.cos(r))
}

interface LegGeo {
  shapes: string[]
  hoofBottom: V
  front: boolean
}

function horseLegGeo(root: V, L: LegAngles, front: boolean, pitch: number): LegGeo {
  const upLen = (front ? 24.6 : 26.4) * HS
  const canLen = (front ? 17.8 : 21) * HS
  const pasLen = 6.2 * HS
  const upperAbs = L.upper + pitch * 0.5
  const J = add(root, mul(dir(upperAbs), upLen))
  const cannonAbs = front ? upperAbs - L.joint : upperAbs + L.joint
  const F = add(J, mul(dir(cannonAbs), canLen))
  const pasternAbs = cannonAbs + L.pastern
  const P2 = add(F, mul(dir(pasternAbs), pasLen))
  const r0 = (front ? 6.4 : 8.2) * HS
  const rMid = (front ? 4.8 : 5.8) * HS
  const rJ = (front ? 3.1 : 3.4) * HS
  const rC = (front ? 2.25 : 2.45) * HS
  const rF = 2.7 * HS
  const rP = 2.05 * HS
  const mid = lerpV(root, J, 0.42)
  const shapes = [capsule(root, r0, mid, rMid), capsule(mid, rMid, J, rJ), capsule(J, rJ, F, rC), circlePath(F, rF), capsule(F, rF * 0.9, P2, rP)]
  if (!front) {
    // point of the hock sticks out behind the joint
    const back = add(J, mul(dir(upperAbs - 90), 2.4 * HS))
    shapes.push(capsule(J, rJ, back, 1.6 * HS))
  }
  // hoof: drawn for a standing pastern (40° forward) and rotated with it
  const hoofLocal: V[] = [vec(1.6, -0.9), vec(4.9, 3.6), vec(4.6, 4.5), vec(-2.8, 4.5), vec(-2.9, 1.0), vec(-1.2, -1.6)]
  const rot = pasternAbs - 40
  const hoof = hoofLocal.map((v) => add(P2, rotLimb(mul(v, HS), rot)))
  shapes.push(smoothPath(hoof, true, 0.55, [false, true, true, true, false, false]))
  const bottom = hoof.reduce((a, b) => (b.y > a.y ? b : a), hoof[0])
  return { shapes, hoofBottom: bottom, front }
}

export const Horse: React.FC<HorseProps> = (props) => {
  const current = useCurrentFrame()
  const { fps } = useVideoConfig()
  const rawId = React.useId()
  const uid = `hk${rawId.replace(/[^a-zA-Z0-9]/g, '')}`
  const frame = props.frame ?? current
  const gait: HorseGait = props.gait || 'idle'
  const height = Math.max(4, props.height)
  const scale = height / 100
  const style: FigureStyle = (FIGURE_STYLES as readonly string[]).includes(String(props.style)) ? (props.style as FigureStyle) : 'flat'
  const start = props.start ?? 0
  const lf = Math.max(0, frame - start)
  const t = lf / fps
  const dur = Math.max(1, props.duration ?? 90)
  const travel = props.travel ?? 0
  const pr = clamp(lf / dur)
  const unitsTravelled = Math.abs(travel * pr) / scale
  const cyc = travel && GAIT_STRIDE[gait] > 0 ? unitsTravelled / GAIT_STRIDE[gait] + (props.phase ?? 0) : (t * (props.speed ?? 1)) / GAIT_CYCLE[gait] + (props.phase ?? 0)
  const speedUnits = travel ? Math.abs(travel) / scale / (dur / fps) : GAIT_STRIDE[gait] / GAIT_CYCLE[gait]
  const seed = (hash(props.x * 0.017 + props.y * 0.003) * 100) % 29
  const phases = GAIT_PHASE[gait]
  const legs = [0, 1, 2, 3].map((i) => horseLeg(gait, cyc + phases[i], i < 2, t, i))
  const gallopish = gait === 'gallop' || gait === 'canter'
  const pitch = gait === 'rear' ? -32 * smooth(Math.min(1, t / 0.6)) + Math.sin(t * 3) * 2 : gallopish ? 4 * Math.sin(TAU * cyc + 0.6) : gait === 'trot' ? 1 * Math.sin(2 * TAU * cyc) : 0.6 * Math.sin(TAU * cyc)
  const bounce = gallopish ? 3 * Math.max(0, Math.sin(TAU * cyc - 0.4)) : gait === 'trot' ? 1.8 * Math.abs(Math.sin(TAU * cyc)) : gait === 'walk' ? 0.7 * Math.sin(2 * TAU * cyc) : 0.35 * Math.sin(t * 1.4)
  const neckAng = (gait === 'rear' ? 70 : gallopish ? 40 : 50) + (gallopish ? 7 * Math.sin(TAU * cyc + 1.2) : gait === 'idle' ? 4 * noise(t * 0.5, seed) : 3 * Math.sin(2 * TAU * cyc))
  const headTilt = (gait === 'rear' ? 28 : gallopish ? 50 : 44) + (gait === 'idle' ? 6 * noise(t * 0.3, seed + 4) : 0)
  const drift = clamp(0.15 + speedUnits / 240 + Math.max(0, props.wind ?? 0) * 0.5)

  // body frame (scaled by HS), pitched around the girth and lifted by the bounce
  const pivot = vec(0, -64)
  const rot = (p0: V): V => {
    const p = mul(p0, HS)
    const a = pitch * D2R
    const dx = p.x - pivot.x
    const dy = p.y - pivot.y
    return vec(pivot.x + dx * Math.cos(a) - dy * Math.sin(a), pivot.y + dx * Math.sin(a) + dy * Math.cos(a) - bounce)
  }
  const bodyPts: V[] = [
    vec(31, -52.5), vec(38, -56), vec(45, -66), vec(42.5, -78), vec(20, -92), vec(4, -86.8), vec(-14, -87.4), vec(-30, -90.4), vec(-43, -87.6), vec(-49.6, -80),
    vec(-51.6, -70), vec(-49, -61), vec(-43.4, -55.6), vec(-25, -55.2), vec(-16, -52.6), vec(4, -48.6), vec(18, -49.4), vec(26, -49.6),
  ].map(rot)
  const neckBase = rot(vec(31, -80))
  const nd = dir(90 + neckAng - pitch)
  const nPerp = dir(90 + neckAng - pitch + 90)
  const neckLen = 33 * HS
  const neckTop = add(neckBase, mul(nd, neckLen))
  const crestAt = (u: number): V => add(add(lerpV(neckTop, neckBase, u), mul(nPerp, lerp(4.8, 10.5, u) * HS)), mul(nPerp, Math.sin(Math.PI * u) * 3.2 * HS))
  const neckPts: V[] = [crestAt(1), crestAt(0.66), crestAt(0.33), crestAt(0), add(neckTop, mul(nPerp, -3.8 * HS)), add(lerpV(neckBase, neckTop, 0.45), mul(nPerp, -6.6 * HS)), add(neckBase, mul(nPerp, -10.5 * HS))]
  const headAxis = 90 - headTilt + (90 + neckAng - pitch - 140) * 0.5
  const hk = HS * 1.06
  const hp = (lx: number, ly: number): V => local(neckTop, headAxis, lx * hk, ly * hk)
  const headPts: [number, number, boolean?][] = [[-1.4, -5.4], [7.6, -6.6], [17.4, -5.2], [24.6, -4.0], [28.8, -2.8], [31.0, -0.2], [30.4, 2.4], [27.8, 3.9, true], [24.2, 3.6], [18.6, 4.8], [12.6, 8.0], [7.4, 9.2], [2.4, 8.0], [-1.6, 4.6]]
  const headD = smoothPath(headPts.map(([x, y]) => hp(x, y)), true, 1, headPts.map((p) => Boolean(p[2])))
  const earD = smoothPath([hp(-1.0, -4.6), hp(-4.2, -11.6), hp(1.8, -5.6)], true, 0.6, [false, true, false])
  const ear2D = smoothPath([hp(1.0, -5.4), hp(-1.4, -12.0), hp(3.8, -5.8)], true, 0.6, [false, true, false])
  // mane: tufts along the crest that stream back with speed and wind
  const tufts: V[] = []
  for (let i = 0; i <= 10; i++) {
    const u = i / 10
    const base = crestAt(u)
    const len = (i % 2 ? 2.4 : 4.2) * HS * (0.8 + 0.4 * Math.sin(Math.PI * u))
    const flow = dir(lerp(-150, -95, drift) - (90 + neckAng - pitch - 140) * 0.3)
    const wave = Math.sin(t * (4 + drift * 8) - u * 6 + seed) * 1.2 * HS
    tufts.push(add(add(base, mul(flow, len)), mul(nPerp, wave)))
  }
  const forelock = add(hp(0.6, -5.8), mul(dir(lerp(150, 120, drift)), 3.6 * HS))
  const maneD = smoothPath([hp(1.6, -5.4), forelock, ...tufts, crestAt(1.02), crestAt(0.5)], true, 0.85)
  const tailBase = rot(vec(-43, -85.5))
  const tailPts = chain(tailBase, lerp(-52, -104, drift), lerp(-6, -80, drift), 42 * HS, 8, 6 + drift * 9, t * (3 + drift * 6) + seed)
  const tailD = ribbonW(tailPts, (u) => (4.6 + 6.2 * Math.sin(Math.PI * Math.min(1, u * 1.08)) * (u < 0.15 ? u / 0.15 : 1) + (u > 0.88 ? -3.6 * ((u - 0.88) / 0.12) : 0)) * HS)

  const legRoots = [rot(vec(28, -55)), rot(vec(24, -56)), rot(vec(-31, -60)), rot(vec(-35, -61))]
  const legGeo = legs.map((L, i) => horseLegGeo(legRoots[i], L, i < 2, pitch))
  const lowest = Math.max(...legGeo.map((g) => g.hoofBottom.y))
  const air = gallopish ? 2 * Math.max(0, Math.sin(TAU * cyc + 2.4)) : 0
  const groundShift = -lowest - air

  // rider
  const look = resolveLook(props.rider || {})
  const palette = paletteFor(style, look, props.color, props.accent)
  const seat = rot(vec(5, -91.5))
  let riderBack: Prim[] = []
  let riderFront: Prim[] = []
  let riderHand: V | null = null
  if (props.rider) {
    const d = buildDims({ build: look.build, gender: look.gender })
    const ctxBase: ActCtx = { t, p: 1, cyc, propF: look.propR, propB: look.propL, strike: props.strike ?? null }
    let pose = poseFor('ride', ctxBase)
    const ra = props.riderAction || 'idle'
    if (ra !== 'idle' && ra !== 'ride') {
      const upperCtx: ActCtx = { ...ctxBase, p: clamp(lf / Math.max(1, Math.round(((ONE_SHOT[ra] || 30) * fps) / 30))), cyc: t / (CYCLE[ra] || 1) }
      pose = overlayUpper(pose, applyHolds(poseFor(ra, upperCtx), ra, look))
    } else if (LONG_PROPS.has(look.propR)) {
      pose = { ...pose, ikFx: NaN, ikFy: NaN, sF: 18, eF: 70, poleF: 174 }
    }
    pose.lean += pitch * 0.4
    const sk0 = solveSkeleton(d, pose, 0)
    const lag = gallopish ? 1.5 * Math.sin(TAU * cyc - 0.6) : gait === 'trot' ? 1.2 * Math.abs(Math.sin(TAU * cyc - 0.5)) : 0
    const off = sub(add(seat, vec(0, -d.rHip * 0.55 - lag)), sk0.P)
    const m = (v: V): V => add(v, off)
    const sk: Skel = {
      ...sk0,
      P: m(sk0.P), C: m(sk0.C), N: m(sk0.N), S: m(sk0.S), SB: m(sk0.SB), E: m(sk0.E), W: m(sk0.W), EB: m(sk0.EB), WB: m(sk0.WB),
      HF: m(sk0.HF), KF: m(sk0.KF), AF: m(sk0.AF), HB: m(sk0.HB), KB: m(sk0.KB), AB: m(sk0.AB), headO: m(sk0.headO),
      spineAt: (u: number) => m(sk0.spineAt(u)),
    }
    if (ra === 'idle' || ra === 'ride') riderHand = LONG_PROPS.has(look.propR) ? sk.WB : sk.W
    const lod: 'high' | 'low' = height < 90 ? 'low' : 'high'
    const ctx: BuildCtx = { d, sk, ps: pose, look, frame, fps, wind: props.wind ?? 0, speed: speedUnits, lod, style, seed }
    const prims = buildFigure(ctx).filter((p) => lod === 'high' || !p.fine)
    if (style === 'papercut' || style === 'puppet') addOrnaments(ctx, prims)
    riderBack = prims.filter((p) => p.far)
    riderFront = prims.filter((p) => !p.far)
  }

  const coat = props.coat || '#5B3A29'
  const colourStyle = style === 'flat' || style === 'puppet'
  const fillHorse = (far: boolean): string => {
    if (style === 'flat') return far ? shade(coat, -0.25) : coat
    if (style === 'puppet') return mixColor(shade(coat, far ? -0.2 : 0.1), '#C8732E', 0.2)
    return palette.fill('top', far)
  }
  const maneFill = style === 'flat' ? shade(coat, -0.45) : style === 'puppet' ? '#2A140C' : palette.fill('hair', false)
  const tackFill = props.tack || (colourStyle ? look.colors.cape : palette.fill('top', false))
  const stroke = style === 'puppet' ? '#2A140C' : undefined
  const strokeW = style === 'puppet' ? 0.45 : undefined
  const op = style === 'puppet' ? 0.88 : 1
  const facing = props.facing === -1 ? -1 : 1
  const x = props.x + travel * pr
  const tf = `translate(${fmt(x)} ${fmt(props.y)}) scale(${fmt(scale * facing)} ${fmt(scale)}) translate(0 ${fmt(groundShift)})`
  const saddleD = smoothPath([rot(vec(16, -88.6)), rot(vec(12.4, -94)), rot(vec(4, -91)), rot(vec(-6, -93.6)), rot(vec(-10, -88.4)), rot(vec(-9, -75)), rot(vec(14, -75))], true, 0.8)
  const bitAt = hp(29, 1.4)
  const reinTo = props.rider ? riderHand || add(seat, vec(13 * HS, -8)) : null

  type Shape = { d: string; fill: string; line?: number }
  const farLegs = legGeo.filter((_, i) => i === 1 || i === 3)
  const nearLegs = legGeo.filter((_, i) => i === 0 || i === 2)
  const shapes: Shape[] = [
    { d: tailD, fill: maneFill },
    ...farLegs.flatMap((g) => g.shapes.map((d) => ({ d, fill: fillHorse(true) }))),
    { d: smoothPath(neckPts, true, 0.9), fill: fillHorse(false) },
    { d: smoothPath(bodyPts, true), fill: fillHorse(false) },
    { d: ear2D, fill: fillHorse(true) },
    { d: headD, fill: fillHorse(false) },
    { d: earD, fill: fillHorse(false) },
    { d: maneD, fill: maneFill },
  ]
  const frontShapes: Shape[] = [
    ...(props.rider ? [{ d: saddleD, fill: tackFill }] : []),
    ...nearLegs.flatMap((g) => g.shapes.map((d) => ({ d, fill: fillHorse(false) }))),
  ]
  const o: RenderOpts = { style, palette, rim: props.rim ?? null, rimOffset: vec(0, 0), uid, scale }
  const drawShapes = (list: Shape[], key: string, force?: string): React.ReactNode[] =>
    list.map((s, i) => <path key={`${key}${i}`} d={s.d} fill={force ?? s.fill} stroke={force ? undefined : stroke} strokeWidth={force ? undefined : strokeW} fillOpacity={force ? 1 : op} strokeLinejoin="round" />)
  const eye = colourStyle ? <circle cx={hp(11, -2.4).x} cy={hp(11, -2.4).y} r={1.05} fill={style === 'puppet' ? '#F3E3C0' : '#1F2328'} /> : null
  const reins = reinTo ? <path d={`M${pt(bitAt)}Q${pt(add(lerpV(bitAt, reinTo, 0.5), vec(0, 3)))} ${pt(reinTo)}`} fill="none" stroke={palette.fill('dark', false)} strokeWidth={0.45} /> : null
  const dustNodes = props.dust && gait !== 'idle'
    ? legGeo.map((g, i) => {
        const b = g.hoofBottom
        if (Math.abs(b.y - lowest) > 1.5) return null
        return <ellipse key={`du${i}`} cx={b.x - 3} cy={b.y - 1} rx={5 + (i % 2) * 2} ry={2.2} fill="#C9B28A" opacity={0.35} />
      })
    : null
  const lightDeg = props.light ?? -40
  const rimW = Math.max(1.2, height * 0.0065)
  const rimFill = props.rim && (style === 'silhouette' || style === 'ink' || style === 'papercut') ? props.rim : null
  return (
    <g opacity={props.opacity ?? 1}>
      {style === 'ink' ? (
        <defs>
          <filter id={`${uid}ink`} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency={0.24} numOctaves={2} seed={5} />
            <feDisplacementMap in="SourceGraphic" scale={0.9} />
          </filter>
        </defs>
      ) : null}
      {rimFill ? (
        <g transform={`translate(${fmt(Math.cos(lightDeg * D2R) * rimW)} ${fmt(Math.sin(lightDeg * D2R) * rimW)})`}>
          <g transform={tf}>
            {renderPrims(riderBack, o, 'rrb', rimFill)}
            {drawShapes(shapes, 'rs', rimFill)}
            {drawShapes(frontShapes, 'rf', rimFill)}
            {renderPrims(riderFront, o, 'rrf', rimFill)}
          </g>
        </g>
      ) : null}
      <g transform={tf} filter={style === 'ink' ? `url(#${uid}ink)` : undefined}>
        {dustNodes}
        {renderPrims(riderBack, o, 'rb')}
        {drawShapes(shapes, 's')}
        {eye}
        {drawShapes(frontShapes, 'f')}
        {reins}
        {renderPrims(riderFront, o, 'rf')}
      </g>
    </g>
  )
}

// ---------------------------------------------------------------------------------------------- troop

export interface TroopProps {
  x: number
  y: number
  width: number
  /** standing height (px) of the front row */
  height: number
  rows?: number
  perRow?: number
  kind?: 'infantry' | 'spear' | 'archer' | 'flag' | 'cavalry' | 'crowd' | 'audience'
  action?: FigureAction
  gait?: HorseGait
  look?: FigureLook
  looks?: FigureLook[]
  style?: FigureStyle
  color?: string
  accent?: string | null
  rim?: string | null
  light?: number
  /** colour the back rows fade into (aerial perspective) */
  haze?: string
  /** how much smaller the last row is (0…0.8) */
  depth?: number
  travel?: number
  duration?: number
  facing?: 1 | -1
  wind?: number
  seed?: number
  frame?: number
  emblem?: string
}

export const Troop: React.FC<TroopProps> = (props) => {
  const rows = Math.max(1, Math.min(8, Math.round(props.rows ?? 3)))
  const perRow = Math.max(1, Math.min(30, Math.round(props.perRow ?? 10)))
  const kind = props.kind || 'infantry'
  const depth = clamp(props.depth ?? 0.42, 0, 0.8)
  const seed = props.seed ?? 7
  const nodes: React.ReactNode[] = []
  const baseLook: FigureLook = props.look || (kind === 'crowd' || kind === 'audience' ? { outfit: 'casual' } : { outfit: 'armor', headwear: 'helmet', build: 'average' })
  const variants: FigureLook[] = props.looks && props.looks.length ? props.looks : (() => {
    if (kind === 'spear' || kind === 'infantry') return [{ ...baseLook, props: { right: 'spear' } }, { ...baseLook, props: { right: 'spear' } }, { ...baseLook, props: { right: 'halberd' } }, { ...baseLook, props: { right: 'sword', left: 'shield' } }]
    if (kind === 'archer') return [{ ...baseLook, props: { left: 'bow' } }]
    if (kind === 'flag') return [{ ...baseLook, props: { right: 'flag' }, emblem: props.emblem }, { ...baseLook, props: { right: 'spear' } }]
    if (kind === 'crowd' || kind === 'audience') return [
      { outfit: 'casual', colors: { top: '#4F7CAC' } }, { outfit: 'hoodie', colors: { top: '#9A6B4F' } }, { gender: 'female', outfit: 'dress', hair: 'long', colors: { top: '#B4535D', bottom: '#B4535D' } },
      { outfit: 'coat', colors: { top: '#6B705C' } }, { gender: 'female', outfit: 'casual', hair: 'ponytail', colors: { top: '#D9A441' } }, { outfit: 'suit' },
    ]
    return [baseLook]
  })()
  for (let r = rows - 1; r >= 0; r--) {
    const u = rows === 1 ? 0 : r / (rows - 1)
    const s = 1 - depth * u
    const h = props.height * s
    const rowY = props.y - u * props.height * 0.34
    const hazeT = props.haze ? u * 0.62 : 0
    for (let i = 0; i < perRow; i++) {
      const n = seed * 131 + r * 31 + i * 7
      const jitter = (hash(n) - 0.5) * 0.5
      const xi = props.x + ((i + 0.5 + (r % 2 ? 0.5 : 0) + jitter) / (perRow + 0.5)) * props.width
      const v = variants[Math.floor(hash(n + 3) * variants.length) % variants.length]
      const phase = hash(n + 5) * 0.35
      const color = props.color ? (props.haze ? mixColor(props.color, props.haze, hazeT) : props.color) : undefined
      const accent = props.accent === null ? null : props.accent ? (props.haze ? mixColor(props.accent, props.haze, hazeT) : props.accent) : undefined
      const yJ = (hash(n + 9) - 0.5) * props.height * 0.03
      if (kind === 'cavalry') {
        nodes.push(<Horse key={`h${r}-${i}`} x={xi} y={rowY + yJ} height={h} facing={props.facing} gait={props.gait || 'gallop'} rider={v} riderAction={props.action === 'raise' || props.action === 'swing' || props.action === 'thrust' ? props.action : 'idle'} style={props.style} color={color} accent={accent} rim={r === 0 ? props.rim : null} light={props.light} travel={props.travel} duration={props.duration} phase={phase} wind={props.wind} frame={props.frame} />)
      } else {
        nodes.push(<Figure key={`f${r}-${i}`} look={v} x={xi} y={rowY + yJ} height={h * (0.94 + hash(n + 11) * 0.1)} facing={props.facing} action={props.action || 'idle'} style={props.style} color={color} accent={accent} rim={r === 0 ? props.rim : null} light={props.light} travel={props.travel} duration={props.duration} phase={phase} wind={props.wind} frame={props.frame} detail={h < 90 ? 'low' : 'auto'} />)
      }
    }
  }
  return <g>{nodes}</g>
}

// ---------------------------------------------------------------------------------------------- helpers for scenes

/** Appearance of a cast member: castLook(scene, 'xiangyu') — by id, name or alias; same look in every shot. */
export function castLook(scene: unknown, idOrName: string, fallback: FigureLook = {}): FigureLook {
  const s = scene as { cast?: unknown[] } | null | undefined
  const list = Array.isArray(s?.cast) ? (s?.cast as Record<string, unknown>[]) : []
  const key = String(idOrName || '').trim().toLowerCase()
  const hit =
    list.find((c) => String(c?.id || '').toLowerCase() === key) ||
    list.find((c) => String(c?.name || '').toLowerCase() === key) ||
    list.find((c) => Array.isArray(c?.aliases) && (c.aliases as unknown[]).some((a) => String(a).toLowerCase() === key))
  if (!hit) return { ...fallback }
  const fig = (hit.figure && typeof hit.figure === 'object' ? hit.figure : hit.rig && typeof hit.rig === 'object' ? hit.rig : {}) as Record<string, unknown>
  const colors: FigureColors = { ...(fallback.colors || {}), ...((fig.colors as FigureColors) || {}) }
  for (const [from, to] of [['top', 'top'], ['bottom', 'bottom'], ['accent', 'accent'], ['skin', 'skin'], ['capeColor', 'cape'], ['trim', 'trim'], ['shoes', 'shoes']] as const) {
    if (typeof fig[from] === 'string' && !colors[to]) colors[to] = fig[from] as string
  }
  if (typeof fig.hair === 'string' && /^#/.test(fig.hair as string) && !colors.hair) colors.hair = fig.hair as string
  const hairStyle = (typeof fig.hair === 'string' && !/^#/.test(fig.hair as string) ? fig.hair : fig.hairStyle) as FigureHair | undefined
  return {
    ...fallback,
    ...(fig as FigureLook),
    hair: hairStyle || fallback.hair,
    colors,
    id: String(hit.id || ''),
    name: String(hit.name || ''),
    emblem: (fig.emblem as string) || fallback.emblem,
  }
}

/** px a figure of this height covers per walk / run / march cycle (sync a scrolling background to the feet). */
export function figureStride(action: FigureAction, heightPx: number): number {
  return ((STRIDE[action] || 0) * heightPx) / 100
}
