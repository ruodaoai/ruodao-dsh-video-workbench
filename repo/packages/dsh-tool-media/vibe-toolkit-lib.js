/**
 * Vibecoding toolkit for AI-coded Remotion scenes — the "8-tool" stack:
 *   Three.js (shotcraft) · Anime.js · Tween.js · Ammo.js (Bullet physics) · TSL Textures ·
 *   SuperCollider (Node-side audio, see supercollider-bridge.js) · Remotion · FFmpeg
 *
 * Every primitive here is frame-driven so that a given frame renders identical pixels in every Remotion
 * render worker (frames are rendered out of order, in parallel tabs):
 *   - Anime.js timelines are built paused and SEEKED to the current frame (no requestAnimationFrame clock)
 *   - Tween.js tweens are evaluated at an explicit time (tween.update(ms))
 *   - Ammo.js physics is pre-simulated once at a fixed 1/fps step and sampled per frame
 *   - TSL Textures render through three/webgpu (WebGL2 backend) inside delayRender/continueRender
 *
 * Each tool lives in its own lib file so a scene only bundles what it imports.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { REPO_ROOT, resolveBinaries } from '../shared/index.js'
import { detectSuperCollider } from './supercollider-bridge.js'

export const VIBE_TWEEN_TSX_SOURCE = `/**
 * @dsh-video/vibe-tween — Tween.js (official build bundled with three.js) for deterministic Remotion frames.
 */
import { useCurrentFrame, useVideoConfig } from 'remotion'
import { Easing as TweenEasing, Interpolation as TweenInterpolation, Tween } from 'three/examples/jsm/libs/tween.module.js'

export { TweenEasing, TweenInterpolation }

export interface TweenAtOptions {
  startFrame?: number
  durationFrames: number
  delayFrames?: number
  easing?: (k: number) => number
  repeat?: number
  yoyo?: boolean
  interpolation?: (v: number[], k: number) => number
}

/** Tween.js value(s) at a frame, evaluated deterministically at an explicit time. */
export function tweenAt<T extends Record<string, number>>(
  from: T,
  to: Partial<Record<keyof T, number | number[]>>,
  frame: number,
  fps: number,
  opts: TweenAtOptions,
): T {
  const obj = { ...from } as T
  const ms = (f: number): number => (f / Math.max(1, fps)) * 1000
  const tw = new Tween(obj as any).to(to as any, Math.max(1, ms(opts.durationFrames))).easing(opts.easing || TweenEasing.Quadratic.InOut)
  if (opts.delayFrames) tw.delay(ms(opts.delayFrames))
  if (opts.repeat) tw.repeat(opts.repeat)
  if (opts.yoyo) tw.yoyo(true)
  if (opts.interpolation) tw.interpolation(opts.interpolation)
  tw.start(ms(opts.startFrame || 0))
  tw.update(ms(frame))
  return obj
}

export interface TweenStep<T> {
  to: Partial<Record<keyof T, number>>
  durationFrames: number
  easing?: (k: number) => number
  holdFrames?: number
}

/** Chain of Tween.js segments (keyframe-style), each starting where the previous one ended. */
export function tweenSequence<T extends Record<string, number>>(initial: T, steps: Array<TweenStep<T>>, frame: number, fps: number, startFrame = 0): T {
  let state = { ...initial } as T
  let cursor = startFrame
  for (const step of steps) {
    const end = cursor + step.durationFrames
    if (frame >= end) {
      state = { ...state, ...(step.to as any) }
      cursor = end + (step.holdFrames || 0)
      continue
    }
    if (frame >= cursor) state = tweenAt(state, step.to as any, frame, fps, { startFrame: cursor, durationFrames: step.durationFrames, easing: step.easing })
    break
  }
  return state
}

/** Convenience hook: current frame + fps-bound tweenAt. */
export function useTween<T extends Record<string, number>>(from: T, to: Partial<Record<keyof T, number | number[]>>, opts: TweenAtOptions): T {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return tweenAt(from, to, frame, fps, opts)
}
`

export const VIBE_ANIME_TSX_SOURCE = `/**
 * @dsh-video/vibe-anime — Anime.js v4 timelines / staggers / easings for deterministic Remotion frames.
 */
import React, { useLayoutEffect, useRef } from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'
import { createTimeline, createSpring, cubicBezier, eases, linear as animeLinear, stagger, steps, utils } from 'animejs'

export { createSpring as animeSpring, eases as animeEases, stagger as animeStagger, utils as animeUtils }

export type AnimeTimeline = ReturnType<typeof createTimeline>

/**
 * Anime.js timeline stage. \`build(tl, root)\` runs once with a PAUSED timeline; target elements inside
 * \`root\` (e.g. root.querySelectorAll('.bar')). The timeline is then seeked to the current frame on every
 * render, so the result is identical in every render worker.
 */
export const AnimeStage: React.FC<{
  build: (tl: AnimeTimeline, root: HTMLElement) => void
  children?: React.ReactNode
  style?: React.CSSProperties
  className?: string
}> = ({ build, children, style, className }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const tlRef = useRef<AnimeTimeline | null>(null)
  const frameRef = useRef(frame)
  frameRef.current = frame
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const tl = createTimeline({ autoplay: false })
    build(tl, root)
    tlRef.current = tl
    tl.seek((frameRef.current / Math.max(1, fps)) * 1000)
    return () => {
      try {
        tl.revert()
      } catch {
        // already reverted
      }
      tlRef.current = null
    }
    // build is intentionally captured once: the timeline is rebuilt only on remount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    if (tlRef.current) tlRef.current.seek((frame / Math.max(1, fps)) * 1000)
  }, [frame, fps])
  return (
    <div ref={rootRef} className={className} style={{ position: 'absolute', inset: 0, ...style }}>
      {children}
    </div>
  )
}

/** Anime.js easing as a pure t → t function: 'outElastic(1, .5)', 'inOutExpo', 'outBounce', 'cubicBezier(.2,.8,.2,1)', 'steps(6)'. */
export function animeEase(name: string = 'outQuad'): (t: number) => number {
  const m = String(name || '').trim().match(/^([a-zA-Z]+)\\s*(?:\\((.*)\\))?$/)
  const key = m ? m[1] : 'outQuad'
  const args = m && m[2] ? m[2].split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)) : []
  // parametric easing factories exported next to eases (irregular() is excluded: it uses Math.random)
  const factories: Record<string, any> = { cubicBezier, steps, linear: animeLinear }
  if (factories[key] && args.length) {
    const f = factories[key](...args)
    return typeof f === 'function' ? f : (t: number) => t
  }
  const e: any = (eases as any)[key]
  if (typeof e !== 'function') return (t: number) => t
  if (args.length) {
    const f = e(...args)
    return typeof f === 'function' ? f : (t: number) => t
  }
  let probe: any
  try {
    probe = e()
  } catch {
    probe = undefined
  }
  return typeof probe === 'function' ? probe : (t: number) => Number(e(t))
}

/** Anime.js stagger evaluated for item \`index\` of \`total\` (grid / from-center / eased staggers, pure function). */
export function animeStaggerAt(index: number, total: number, value: number | [number, number], params: Record<string, any> = {}): number {
  // anime.js v4 stagger functions are called as (target, index, targetsArray, ...); pass an explicit total too
  const n = Math.max(1, Math.round(Number(total) || 1))
  const fn: any = (stagger as any)(value, { ...params, total: n })
  const v = typeof fn === 'function' ? fn(null, index, Array.from({ length: n }), 0, null) : fn
  return Number.parseFloat(String(v)) || 0
}
`

export const VIBE_PHYSICS_TSX_SOURCE = `/**
 * @dsh-video/vibe-physics — Ammo.js (Bullet physics, WASM) for deterministic Remotion frames.
 * The whole shot is pre-simulated once at a fixed 1/fps step (+ substeps), then sampled per frame.
 */
import React, { useEffect, useState } from 'react'
import { continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'

export type Vec3 = [number, number, number]
export interface PhysicsBodySpec {
  id: string
  shape?: 'box' | 'sphere' | 'cylinder' | 'capsule'
  size?: Vec3 | number
  radius?: number
  height?: number
  mass?: number
  position: Vec3
  rotation?: Vec3
  velocity?: Vec3
  angularVelocity?: Vec3
  restitution?: number
  friction?: number
  spawnFrame?: number
}
export interface PhysicsWorldSpec {
  gravity?: Vec3
  ground?: false | { y?: number; restitution?: number; friction?: number }
  bodies: PhysicsBodySpec[]
  impulses?: Array<{ frame: number; id: string; impulse: Vec3 }>
  substeps?: number
}
export interface PhysicsPose {
  p: Vec3
  q: [number, number, number, number]
  active: boolean
}
export type PhysicsTrack = Array<Record<string, PhysicsPose>>

function loadScript(src: string): Promise<void> {
  return new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => res()
    s.onerror = () => rej(new Error('Ammo.js failed to load: ' + src))
    document.head.appendChild(s)
  })
}

let ammoPromise: Promise<any> | null = null
/** Loads public/ammo.wasm.js + ammo.wasm.wasm (copied by the plugin) once per render tab. */
export function loadAmmo(): Promise<any> {
  if (!ammoPromise) {
    ammoPromise = (async () => {
      const w = window as any
      if (typeof w.Ammo !== 'function') await loadScript(staticFile('ammo.wasm.js'))
      const factory = w.Ammo
      return await factory({ locateFile: (p: string) => staticFile(p.endsWith('.wasm') ? 'ammo.wasm.wasm' : p) })
    })()
  }
  return ammoPromise
}

function simulate(Ammo: any, spec: PhysicsWorldSpec, totalFrames: number, fps: number): PhysicsTrack {
  const v3 = (v: Vec3 | undefined, d: Vec3 = [0, 0, 0]) => {
    const a = v || d
    return new Ammo.btVector3(Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0)
  }
  const cfg = new Ammo.btDefaultCollisionConfiguration()
  const dispatcher = new Ammo.btCollisionDispatcher(cfg)
  const broadphase = new Ammo.btDbvtBroadphase()
  const solver = new Ammo.btSequentialImpulseConstraintSolver()
  const world = new Ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, cfg)
  world.setGravity(v3(spec.gravity, [0, -9.81, 0]))
  if (spec.ground !== false) {
    const g = spec.ground || {}
    const shape = new Ammo.btBoxShape(new Ammo.btVector3(200, 0.5, 200))
    const t = new Ammo.btTransform()
    t.setIdentity()
    t.setOrigin(new Ammo.btVector3(0, (g.y ?? 0) - 0.5, 0))
    const body = new Ammo.btRigidBody(new Ammo.btRigidBodyConstructionInfo(0, new Ammo.btDefaultMotionState(t), shape, new Ammo.btVector3(0, 0, 0)))
    body.setRestitution(g.restitution ?? 0.35)
    body.setFriction(g.friction ?? 0.8)
    world.addRigidBody(body)
  }
  const bodies = new Map<string, any>()
  const makeShape = (b: PhysicsBodySpec) => {
    const kind = b.shape || 'box'
    const r = b.radius ?? (typeof b.size === 'number' ? b.size / 2 : 0.5)
    if (kind === 'sphere') return new Ammo.btSphereShape(r)
    if (kind === 'cylinder') return new Ammo.btCylinderShape(new Ammo.btVector3(r, (b.height ?? 1) / 2, r))
    if (kind === 'capsule') return new Ammo.btCapsuleShape(r, b.height ?? 1)
    const s: Vec3 = Array.isArray(b.size) ? b.size : [Number(b.size) || 1, Number(b.size) || 1, Number(b.size) || 1]
    return new Ammo.btBoxShape(new Ammo.btVector3(s[0] / 2, s[1] / 2, s[2] / 2))
  }
  const spawn = (b: PhysicsBodySpec) => {
    const shape = makeShape(b)
    const mass = b.mass ?? 1
    const t = new Ammo.btTransform()
    t.setIdentity()
    t.setOrigin(v3(b.position))
    if (b.rotation) {
      const q = new Ammo.btQuaternion(0, 0, 0, 1)
      q.setEulerZYX(b.rotation[2], b.rotation[1], b.rotation[0])
      t.setRotation(q)
    }
    const inertia = new Ammo.btVector3(0, 0, 0)
    if (mass > 0) shape.calculateLocalInertia(mass, inertia)
    const body = new Ammo.btRigidBody(new Ammo.btRigidBodyConstructionInfo(mass, new Ammo.btDefaultMotionState(t), shape, inertia))
    body.setRestitution(b.restitution ?? 0.3)
    body.setFriction(b.friction ?? 0.6)
    if (b.velocity) body.setLinearVelocity(v3(b.velocity))
    if (b.angularVelocity) body.setAngularVelocity(v3(b.angularVelocity))
    body.setActivationState(4)
    world.addRigidBody(body)
    bodies.set(b.id, body)
  }
  const substeps = Math.max(1, Math.min(16, Math.round(spec.substeps ?? 4)))
  const dt = 1 / Math.max(1, fps)
  const tmp = new Ammo.btTransform()
  const track: PhysicsTrack = []
  for (let f = 0; f < totalFrames; f++) {
    for (const b of spec.bodies) if ((b.spawnFrame ?? 0) <= f && !bodies.has(b.id)) spawn(b)
    for (const imp of spec.impulses || []) {
      if (imp.frame !== f) continue
      const body = bodies.get(imp.id)
      if (body) {
        body.activate()
        body.applyCentralImpulse(v3(imp.impulse))
      }
    }
    const snap: Record<string, PhysicsPose> = {}
    bodies.forEach((body, id) => {
      body.getMotionState().getWorldTransform(tmp)
      const o = tmp.getOrigin()
      const r = tmp.getRotation()
      snap[id] = { p: [o.x(), o.y(), o.z()], q: [r.x(), r.y(), r.z(), r.w()], active: Boolean(body.isActive()) }
    })
    track.push(snap)
    world.stepSimulation(dt, substeps, dt / substeps)
  }
  return track
}

const trackCache = new Map<string, PhysicsTrack>()
const pending = new Map<string, Promise<PhysicsTrack>>()

/** Deterministic Bullet simulation of the shot; null until ready (the render is delayed meanwhile). */
export function usePhysicsTrack(spec: PhysicsWorldSpec, totalFrames: number): PhysicsTrack | null {
  const { fps } = useVideoConfig()
  const key = JSON.stringify([spec, totalFrames, fps])
  const [track, setTrack] = useState<PhysicsTrack | null>(() => trackCache.get(key) || null)
  const [handle] = useState<number | null>(() => (trackCache.has(key) ? null : delayRender('Ammo.js physics pre-simulation')))
  useEffect(() => {
    if (track || handle === null) return undefined
    let alive = true
    let p = pending.get(key)
    if (!p) {
      p = loadAmmo().then((Ammo) => simulate(Ammo, spec, totalFrames, fps))
      pending.set(key, p)
    }
    p.then((res) => {
      trackCache.set(key, res)
      if (alive) setTrack(res)
      continueRender(handle)
    }).catch((err) => {
      console.error('[vibe-physics]', err)
      continueRender(handle)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return track
}

export function physicsPoseAt(track: PhysicsTrack | null, frame: number, id: string): PhysicsPose | null {
  if (!track || !track.length) return null
  const f = Math.max(0, Math.min(track.length - 1, Math.round(frame)))
  return track[f][id] || null
}

/** Quaternion → Euler angles in degrees (x, y, z), for SVG/CSS rotation. */
export function quatToEulerDeg(q: [number, number, number, number]): Vec3 {
  const [x, y, z, w] = q
  const sinr = 2 * (w * x + y * z)
  const cosr = 1 - 2 * (x * x + y * y)
  const rx = Math.atan2(sinr, cosr)
  const sinp = 2 * (w * y - z * x)
  const ry = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp)
  const siny = 2 * (w * z + x * y)
  const cosy = 1 - 2 * (y * y + z * z)
  const rz = Math.atan2(siny, cosy)
  const k = 180 / Math.PI
  return [rx * k, ry * k, rz * k]
}

/**
 * Side-view (orthographic x/y) SVG renderer for a physics shot. \`renderBody\` draws one body at its screen
 * position (px) and z-rotation (deg); \`unitPx\` = pixels per physics metre, \`originPx\` = screen point of (0, 0).
 */
export const PhysicsSvgStage: React.FC<{
  spec: PhysicsWorldSpec
  totalFrames: number
  unitPx?: number
  originPx?: [number, number]
  renderBody: (id: string, screen: { x: number; y: number; rotDeg: number; pose: PhysicsPose; spec: PhysicsBodySpec }) => React.ReactNode
  children?: React.ReactNode
}> = ({ spec, totalFrames, unitPx = 120, originPx, renderBody, children }) => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const track = usePhysicsTrack(spec, totalFrames)
  const o = originPx || [width / 2, height * 0.82]
  return (
    <svg viewBox={\`0 0 \${width} \${height}\`} width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
      {children}
      {spec.bodies.map((b) => {
        const pose = physicsPoseAt(track, frame, b.id)
        if (!pose) return null
        const rot = quatToEulerDeg(pose.q)[2]
        return <g key={b.id}>{renderBody(b.id, { x: o[0] + pose.p[0] * unitPx, y: o[1] - pose.p[1] * unitPx, rotDeg: -rot, pose, spec: b })}</g>
      })}
    </svg>
  )
}
`

export const VIBE_TSL_TSX_SOURCE = `/**
 * @dsh-video/vibe-tsl — TSL Textures (procedural Three.js Shading Language materials) rendered through
 * three/webgpu (WebGL2 backend) inside delayRender/continueRender, one deterministic frame at a time.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion'
import { Color as ThreeColor } from 'three'
import * as THREEG from 'three/webgpu'
import * as TSLTextures from 'tsl-textures'

/** Names of the procedural textures shipped by tsl-textures (marble, wood, camouflage, planet, clouds, caustics, ...). */
export const TSL_TEXTURE_NAMES: string[] = Object.keys(TSLTextures).filter((k) => {
  const f = (TSLTextures as any)[k]
  return typeof f === 'function' && f.defaults && typeof f.defaults === 'object'
})

export interface TslTextureStageProps {
  texture: string
  params?: Record<string, any>
  shape?: 'sphere' | 'box' | 'torusKnot' | 'plane' | 'icosahedron'
  spin?: number
  tilt?: number
  zoom?: number
  metalness?: number
  roughness?: number
  emissive?: boolean
  width?: number
  height?: number
  style?: React.CSSProperties
}

// tsl-textures converts params with \`instanceof Color\` from the main 'three' build, so colours must come from there
function normalizeParams(params: Record<string, any> = {}): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(params)) {
    out[k] = typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? new ThreeColor(v) : v
  }
  return out
}

function makeGeometry(shape: string): any {
  if (shape === 'box') return new THREEG.BoxGeometry(1.6, 1.6, 1.6, 64, 64, 64)
  if (shape === 'torusKnot') return new THREEG.TorusKnotGeometry(0.75, 0.26, 256, 48)
  if (shape === 'plane') return new THREEG.PlaneGeometry(3.6, 2.1, 128, 128)
  if (shape === 'icosahedron') return new THREEG.IcosahedronGeometry(1.15, 24)
  return new THREEG.SphereGeometry(1.15, 192, 96)
}

/** A lit 3D object wearing a TSL procedural texture; rotation is driven by the frame number. */
export const TslTextureStage: React.FC<TslTextureStageProps> = (props) => {
  const frame = useCurrentFrame()
  const { fps, width: vw, height: vh } = useVideoConfig()
  const W = Math.round(props.width || vw)
  const H = Math.round(props.height || vh)
  const outRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<{ renderer: any; scene: any; camera: any; mesh: any; glCanvas: HTMLCanvasElement } | null>(null)
  const frameRef = useRef(frame)
  frameRef.current = frame
  const [initHandle] = useState(() => delayRender('TSL texture stage init'))

  const drawFrame = async (f: number): Promise<void> => {
    const c = ctxRef.current
    if (!c) return
    const t = f / Math.max(1, fps)
    c.mesh.rotation.y = t * Math.PI * 2 * (props.spin ?? 0.06)
    c.mesh.rotation.x = (props.tilt ?? 0.22) + Math.sin(t * 0.6) * 0.08
    await c.renderer.renderAsync(c.scene, c.camera)
    const out = outRef.current
    const ctx = out ? out.getContext('2d') : null
    if (out && ctx) {
      ctx.clearRect(0, 0, out.width, out.height)
      ctx.drawImage(c.glCanvas, 0, 0, out.width, out.height)
    }
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const glCanvas = document.createElement('canvas')
        glCanvas.width = W
        glCanvas.height = H
        const renderer: any = new THREEG.WebGPURenderer({ canvas: glCanvas, antialias: true, alpha: true, forceWebGL: true } as any)
        renderer.setPixelRatio(1)
        renderer.setSize(W, H, false)
        await renderer.init()
        const scene = new THREEG.Scene()
        const camera = new THREEG.PerspectiveCamera(32, W / H, 0.1, 100)
        camera.position.set(0, 0, 5.2 / Math.max(0.2, props.zoom ?? 1))
        scene.add(new THREEG.AmbientLight(0xffffff, 0.6))
        const key = new THREEG.DirectionalLight(0xffffff, 2.4)
        key.position.set(3, 4, 5)
        scene.add(key)
        const rim = new THREEG.DirectionalLight(0xffd7a0, 1.3)
        rim.position.set(-4, 1.5, -3)
        scene.add(rim)
        const mat: any = new THREEG.MeshStandardNodeMaterial({ metalness: props.metalness ?? 0.1, roughness: props.roughness ?? 0.55 })
        const fn: any = (TSLTextures as any)[props.texture] || (TSLTextures as any).marble
        const node = fn({ ...(fn.defaults || {}), ...normalizeParams(props.params) })
        mat.colorNode = node
        if (props.emissive) mat.emissiveNode = node
        const mesh = new THREEG.Mesh(makeGeometry(props.shape || 'sphere'), mat)
        scene.add(mesh)
        if (!alive) return
        ctxRef.current = { renderer, scene, camera, mesh, glCanvas }
        await drawFrame(frameRef.current)
      } catch (err) {
        console.error('[TslTextureStage]', err)
      } finally {
        continueRender(initHandle)
      }
    })()
    return () => {
      alive = false
      const c = ctxRef.current
      ctxRef.current = null
      try {
        c?.renderer.dispose()
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    if (!ctxRef.current) return
    const h = delayRender('TSL texture frame ' + frame)
    drawFrame(frame)
      .catch((err) => console.error('[TslTextureStage]', err))
      .finally(() => continueRender(h))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame])

  return <canvas ref={outRef} width={W} height={H} style={{ width: '100%', height: '100%', display: 'block', ...props.style }} />
}
`

export const VIBE_MODULES_DTS_SOURCE = `// Ambient declarations for Vibecoding libraries that ship without TypeScript types.
declare module 'tsl-textures' {
  const textures: Record<string, any>
  export = textures
}
`

function resolveThreeLibFile(file) {
  const candidates = []
  try {
    const req = createRequire(join(REPO_ROOT, 'package.json'))
    candidates.push(join(dirname(req.resolve('three/package.json')), 'examples', 'jsm', 'libs', file))
  } catch {}
  candidates.push(join(REPO_ROOT, 'node_modules', 'three', 'examples', 'jsm', 'libs', file))
  return candidates.find((p) => existsSync(p)) || ''
}

/**
 * Write the three Vibecoding libs (+ type shims) into a Remotion project and copy the Ammo.js WASM runtime
 * into its public/ folder. Returns the written paths and whether the Ammo runtime is available.
 */
export function writeVibeToolkitRemotionLib(projectDir) {
  const absDir = resolve(projectDir)
  const libDir = join(absDir, 'src', 'lib')
  mkdirSync(libDir, { recursive: true })
  const avail = Object.fromEntries(getVibeToolkitStatus().map((t) => [t.id, t.available]))
  const files = { dts: join(libDir, 'vibe-modules.d.ts') }
  writeFileSync(files.dts, VIBE_MODULES_DTS_SOURCE, 'utf8')
  const emit = (key, file, src, ok) => {
    const out = join(libDir, file)
    if (ok) {
      writeFileSync(out, src, 'utf8')
      files[key] = out
    } else if (existsSync(out)) {
      try {
        rmSync(out)
      } catch {}
    }
  }
  emit('tween', 'vibe-tween.tsx', VIBE_TWEEN_TSX_SOURCE, avail.tweenjs)
  emit('anime', 'vibe-anime.tsx', VIBE_ANIME_TSX_SOURCE, avail.animejs)
  emit('physics', 'vibe-physics.tsx', VIBE_PHYSICS_TSX_SOURCE, avail.ammojs)
  emit('tsl', 'vibe-tsl.tsx', VIBE_TSL_TSX_SOURCE, avail['tsl-textures'])
  let ammoReady = false
  const ammoJs = resolveThreeLibFile('ammo.wasm.js')
  const ammoWasm = resolveThreeLibFile('ammo.wasm.wasm')
  if (files.physics && ammoJs && ammoWasm) {
    const publicDir = join(absDir, 'public')
    mkdirSync(publicDir, { recursive: true })
    try {
      copyFileSync(ammoJs, join(publicDir, 'ammo.wasm.js'))
      copyFileSync(ammoWasm, join(publicDir, 'ammo.wasm.wasm'))
      ammoReady = true
    } catch {}
  }
  return { ...files, ammoReady }
}

// Keyword rules for AI tool matching (director hints in scene.vibeTools always win).
const VIBE_TOOL_RULES = [
  { id: 'threejs', label: 'Three.js', reason: '三维空间 / 粒子 / 立体镜头', rx: /3D|三维|立体|星球|行星|宇宙|太空|星空|星系|粒子|全息|赛博|地球|分子|DNA|晶体|机器人|芯片|数据中心|穿梭|飞越|俯冲|环绕|透视/i },
  { id: 'animejs', label: 'Anime.js', reason: '交错入场 / 文字与图表编排', rx: /标题|大字|文字动画|字幕特效|列表|清单|卡片|步骤|流程|数据|图表|柱状|折线|排行|榜单|对比|时间线|里程碑|信息图|界面|UI|教程|按钮|菜单|交错|依次|弹出|计数/i },
  { id: 'tweenjs', label: 'Tween.js', reason: '弹性缓动 / 卡点运动曲线', rx: /弹性|回弹|缓动|弹跳|抛物线|摆动|呼吸|漂浮|推拉|滑入|飞入|缩放|卡点|重拍/i },
  { id: 'ammojs', label: 'Ammo.js', reason: '真实刚体物理（坠落 / 碰撞 / 散落）', rx: /掉落|坠落|落下|碰撞|弹开|散落|崩塌|倒塌|坍塌|碎裂|破碎|堆叠|投掷|抛出|翻滚|物理|多米诺|雪崩|落石|硬币|骰子|箭雨/i },
  { id: 'tsl-textures', label: 'TSL Textures', reason: '程序化材质特写（星球 / 玉石 / 青铜…）', rx: /星球|行星|月球|玉石|玉器|青铜|大理石|木纹|云海|水波|水纹|熔岩|岩浆|岩石|金属质感|材质|纹理|宝石|地貌|迷彩|斑纹|丝绸|瓷器/i },
]

/**
 * AI tool matching: pick the Vibecoding tools that fit THIS video and each of its scenes, instead of forcing all
 * of them. Director hints (scene.vibeTools) win; otherwise keywords in title / blueprint / narration decide.
 * Returns { selected: [ids by relevance], perScene: { sceneId: [ids] }, reasons: { id: text } }.
 */
export function selectVibeTools({ topic = '', genre = '', style = '', scenes = [], status = getVibeToolkitStatus(), lowSpec = false } = {}) {
  const avail = new Set(status.filter((t) => t.available).map((t) => t.id))
  const known = new Set(VIBE_TOOL_RULES.map((r) => r.id))
  const allowed = (id) => known.has(id) && avail.has(id) && !(lowSpec && id === 'tsl-textures')
  const perScene = {}
  const counts = {}
  for (const sc of scenes || []) {
    const text = [sc?.title, sc?.headline, sc?.visualBlueprint, sc?.motionNotes, sc?.narration, ...(Array.isArray(sc?.highlights) ? sc.highlights : [])].filter(Boolean).join(' ')
    const hinted = Array.isArray(sc?.vibeTools) ? sc.vibeTools.map((t) => String(t).trim().toLowerCase()) : null
    const ids = [...new Set(hinted || VIBE_TOOL_RULES.filter((r) => r.rx.test(text)).map((r) => r.id))].filter(allowed).slice(0, 3)
    if (ids.length && sc?.id) perScene[sc.id] = ids
    for (const id of ids) counts[id] = (counts[id] || 0) + 1
  }
  const globalText = `${topic} ${genre} ${style}`
  const reasons = {}
  for (const r of VIBE_TOOL_RULES) {
    if (allowed(r.id) && r.rx.test(globalText)) counts[r.id] = (counts[r.id] || 0) + 0.5
    if (counts[r.id]) reasons[r.id] = r.reason
  }
  const selected = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
  return { selected, perScene, reasons }
}

/**
 * Coder-prompt section for the installed Vibecoding libs. With a selection from selectVibeTools(), the matched
 * tools are documented first and the rest are only listed; nothing is mandatory and custom code is allowed.
 */
export function buildVibeToolkitCoderGuide(status = getVibeToolkitStatus(), selection = null) {
  const ok = Object.fromEntries(status.map((t) => [t.id, t.available]))
  const q = '`'
  const docs = {
    tweenjs: {
      label: 'Tween.js',
      full: `     - ${q}from '../lib/vibe-tween'${q}: ${q}tweenAt, tweenSequence, useTween, TweenEasing, TweenInterpolation${q}（Tween.js 补间曲线：${q}tweenAt({ x: 0, s: 1 }, { x: 320, s: 1.4 }, frame, fps, { startFrame: 10, durationFrames: 18, easing: TweenEasing.Elastic.Out })${q}；多段关键帧用 ${q}tweenSequence${q}）`,
      short: `${q}../lib/vibe-tween${q}（Tween.js 弹性 / 缓动补间：tweenAt、tweenSequence）`,
    },
    animejs: {
      label: 'Anime.js',
      full: `     - ${q}from '../lib/vibe-anime'${q}: ${q}AnimeStage, animeEase, animeStaggerAt, animeStagger, animeEases, animeSpring${q}（Anime.js v4 时间轴：${q}<AnimeStage build={(tl, root) => { tl.add(root.querySelectorAll('.bar'), { scaleY: [0, 1], delay: animeStagger(40, { from: 'center' }), duration: 600, ease: 'outElastic(1, .6)' }) }}>…</AnimeStage>${q}，时间轴会被逐帧 seek；也可用纯函数 ${q}animeEase('outBounce')(t)${q}、${q}animeStaggerAt(i, n, 80, { from: 'center' })${q} 做交错入场；禁止 ${q}utils.random${q}、${q}from: 'random'${q}、${q}irregular${q} 等随机 API（各渲染进程随机数不同会闪烁），需要随机请用 remotion 的 ${q}random(seed)${q}）`,
      short: `${q}../lib/vibe-anime${q}（Anime.js 时间轴 / 交错入场：AnimeStage、animeStaggerAt、animeEase）`,
    },
    ammojs: {
      label: 'Ammo.js',
      full: `     - ${q}from '../lib/vibe-physics'${q}: ${q}PhysicsSvgStage, usePhysicsTrack, physicsPoseAt, quatToEulerDeg${q}（Ammo.js / Bullet 真实刚体物理：碎石崩落、盾牌与箭矢坠地、竹简散落、金币弹跳；整镜一次性预计算再按帧取样，例如 ${q}<PhysicsSvgStage spec={{ bodies: [{ id: 'rock1', shape: 'box', size: [0.4, 0.3, 0.4], mass: 2, position: [0, 3, 0], angularVelocity: [0, 0, 4] }] }} totalFrames={durationInFrames} renderBody={(id, s) => <rect x={s.x - 24} y={s.y - 18} width={48} height={36} transform={...} />} />${q}）`,
      short: `${q}../lib/vibe-physics${q}（Ammo.js 刚体物理：PhysicsSvgStage、usePhysicsTrack）`,
    },
    'tsl-textures': {
      label: 'TSL Textures',
      full: `     - ${q}from '../lib/vibe-tsl'${q}: ${q}TslTextureStage, TSL_TEXTURE_NAMES${q}（TSL Textures 程序化着色器材质：${q}<TslTextureStage texture="marble" params={{ color: '#7A1F1F', background: '#F2D7A6' }} shape="sphere" spin={0.05} />${q}，适合星球、玉石、青铜、云海、水纹、木纹等材质特写；每个镜头最多 1 个，不要铺满全片以免拖慢渲染）`,
      short: `${q}../lib/vibe-tsl${q}（TSL Textures 程序化材质：TslTextureStage）`,
    },
  }
  const installed = Object.keys(docs).filter((id) => ok[id])
  const picked = Array.isArray(selection?.selected) ? selection.selected.filter((id) => installed.includes(id)) : null
  const lines = [
    '   - Vibecoding 扩展工具库 —— **按镜头规划调用**：每镜 JSON 的 toolPlan.must 是该镜必须调用的工具（交付前系统逐镜核对代码），toolPlan.suggest 按画面需要选用，没列出的工具在合适的镜头里也可以用；Three.js 3D 舞台见上文 FreeformThreeStage。工具实现不了的效果，可以直接用 Canvas2D / SVG / CSS transform / 原生 WebGL / 数学函数自由编写，只要保证逐帧确定性（一切由 useCurrentFrame() 驱动，禁止 setInterval / requestAnimationFrame / Date.now / Math.random，不得引入未安装的 npm 包、网络资源或外部字体）：',
  ]
  if (picked) {
    if (picked.length) {
      lines.push(`     - 本批次计划用到的工具（逐镜要求见每镜 toolPlan）：${picked.map((id) => docs[id].label).join('、')}`)
      for (const id of picked) lines.push(docs[id].full)
    } else {
      lines.push('     - 本批次画面没有特别匹配的扩展工具，优先用 Remotion 原生 interpolate / spring、SVG 与 Three.js 舞台完成；确有需要时也可使用下列工具：')
    }
    const rest = installed.filter((id) => !picked.includes(id))
    if (rest.length) lines.push(`     - 其他已安装工具（确有需要时可用）：${rest.map((id) => docs[id].short).join('；')}`)
  } else {
    for (const id of installed) lines.push(docs[id].full)
  }
  lines.push('     - 声音（SuperCollider / 内置 DSP / FFmpeg 混音）在音频阶段自动处理，场景代码里严禁写任何 Audio')
  return lines.join('\n')
}

/**
 * The user's overall visual preference (导演参数 → 视效偏好, script.visual3dMode) as a SOFT hint for the coder prompts.
 * It never limits the AI to a tool list: tools stay optional and free code is always allowed.
 */
export function buildVisualFxPreferenceGuide(mode = 'auto') {
  const m = String(mode || 'auto').toLowerCase()
  if (m === 'off') {
    return '- **【视效偏好：纯 2D 平面动效（用户在导演参数里选的，优先于上文题材指导里的 3D 建议）】**：本片不要用 Three.js 3D 舞台（FreeformThreeStage / ThreeCyberStage / ThreeCanvas）、TSL 3D 材质和全屏 HUD 叠层；SVG、Canvas2D、文字与图表动效、缓动、物理等照常按需使用，也可以自由编写代码。'
  }
  if (m === 'on') {
    return '- **【视效偏好：偏好 3D 与全息 HUD 科技感（用户在导演参数里选的）】**：画面合适的镜头多用 Three.js 3D 空间与 HUD 遥测元素，但仍以每一镜的画面需要为准，其他工具与自由编码照常可用。'
  }
  return '- **【视效偏好：AI 按需自由创作】**：每一镜自己判断用不用 3D、SVG、HUD、物理、材质等工具；现成组件和 Vibecoding 工具都只是可选项，满足不了的效果直接写代码实现。'
}

/** Status of the 8 Vibecoding tools on this machine (for doctor / UI / self-test). */
export function getVibeToolkitStatus() {
  const req = (() => {
    try {
      return createRequire(join(REPO_ROOT, 'package.json'))
    } catch {
      return null
    }
  })()
  const has = (spec) => {
    if (!req) return false
    try {
      req.resolve(spec)
      return true
    } catch {
      return false
    }
  }
  // Read <pkg>/package.json directly: packages with an "exports" map (three) refuse 'pkg/package.json'
  const pkgVersion = (name) => {
    const p = join(REPO_ROOT, 'node_modules', name, 'package.json')
    try {
      return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).version || '' : ''
    } catch {
      return ''
    }
  }
  return [
    { id: 'threejs', name: 'Three.js', role: '3D 场景 / 程序化几何', available: has('three'), version: pkgVersion('three') },
    { id: 'animejs', name: 'Anime.js', role: '时间轴 / 交错 / 弹性缓动', available: has('animejs'), version: pkgVersion('animejs') },
    { id: 'tweenjs', name: 'Tween.js', role: '补间 / 缓动曲线', available: Boolean(resolveThreeLibFile('tween.module.js')), version: 'three-bundled' },
    { id: 'ammojs', name: 'Ammo.js', role: 'Bullet 刚体物理', available: Boolean(resolveThreeLibFile('ammo.wasm.js') && resolveThreeLibFile('ammo.wasm.wasm')), version: 'three-bundled' },
    { id: 'tsl-textures', name: 'TSL Textures', role: '程序化着色器材质', available: has('tsl-textures'), version: pkgVersion('tsl-textures') },
    (() => {
      const sc = detectSuperCollider()
      return { id: 'supercollider', name: 'SuperCollider', role: '声音合成 (可选, 本机 sclang；未安装时自动回退内置 JS DSP 合成器)', available: sc.available, version: sc.version || '', optional: true, path: sc.sclangPath || '' }
    })(),
    { id: 'remotion', name: 'Remotion', role: '帧精确视频渲染', available: has('remotion'), version: pkgVersion('remotion') },
    (() => {
      let ff = ''
      try {
        ff = resolveBinaries().ffmpeg || ''
      } catch {}
      return { id: 'ffmpeg', name: 'FFmpeg', role: '编码 / 混音 / 质检', available: Boolean(ff), version: '', path: ff }
    })(),
  ]
}
