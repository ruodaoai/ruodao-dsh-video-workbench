/**
 * Dual-Engine HTML5 + Canvas2D Kinetic Motion Video Renderer
 * Self-contained single-file 1920x1080 broadcast motion-graphics generator.
 * Features:
 * - Strict `<template class="scene-template">` DOM isolation + unique IDs (`video_lint` compliant)
 * - Global #world camera rig: beat-locked zoomPulse, impact screen shake, perspective 3D tilts
 * - Layered Canvas2D VFX (#fxb backdrop grid/stars/halftone, #fxt sparks/shockRings/radialLines/scanSweep)
 * - Procedural Transitions Canvas (#trc iris-circle double ring, 48px block-wipe, light-wipe, RGB glitch-cut)
 * - 6 Distinct .motion Layouts: 3d-stage-opener, kinetic-impact, media-split-motion, mosaic-pulse-wall, compare-dual, radial-climax
 * - Deterministic `window.__seekToFrame(frame)` for full-FPS CDP capture + smooth live `requestAnimationFrame` preview
 */
import {
  buildBundledFontFaceCss,
  buildComplianceNoticeText,
  PRIMARY_MONO_STACK,
  PRIMARY_SANS_STACK,
  resolveSafeZoneSpec,
} from '../shared/index.js'
import { scheduleFlashBudget } from './flash-budget.js'

const PALETTES = {
  tech: {
    background: '#050608',
    surface: '#10141E',
    textPrimary: '#F1F5F9',
    textSecondary: '#94A3B8',
    accent: '#2F7BFF',
    accent2: '#7DB2FF',
    gold: '#F5B92E',
    rgbAccent: '125,178,255',
    rgbGold: '245,185,46',
    titleGrad: 'linear-gradient(180deg,#FFFFFF 0%,#E2E8F0 52%,#94A3B8 100%)',
    accentGrad: 'linear-gradient(180deg,#CFE1FF 0%,#4F95FF 55%,#1F5FE0 100%)',
  },
  cinematic: {
    background: '#07080B',
    surface: '#14161D',
    textPrimary: '#FAFAFA',
    textSecondary: '#D4D4D8',
    accent: '#F59E0B',
    accent2: '#FB7185',
    gold: '#FBBF24',
    rgbAccent: '245,158,11',
    rgbGold: '251,191,36',
    titleGrad: 'linear-gradient(180deg,#FFFFFF 0%,#F3F4F6 50%,#B8BEC9 100%)',
    accentGrad: 'linear-gradient(180deg,#FFE58A 0%,#F59E0B 55%,#B45309 100%)',
  },
  documentary: {
    background: '#090B0E',
    surface: '#161A22',
    textPrimary: '#F8FAFC',
    textSecondary: '#CBD5E1',
    accent: '#38BDF8',
    accent2: '#34D399',
    gold: '#FBBF24',
    rgbAccent: '56,189,248',
    rgbGold: '52,211,153',
    titleGrad: 'linear-gradient(180deg,#FFFFFF 0%,#E2E8F0 55%,#A3B3C6 100%)',
    accentGrad: 'linear-gradient(180deg,#BAE6FD 0%,#38BDF8 55%,#0284C7 100%)',
  },
  energetic: {
    background: '#070612',
    surface: '#141129',
    textPrimary: '#FFFFFF',
    textSecondary: '#E2E8F0',
    accent: '#00E5FF',
    accent2: '#FF3B7F',
    gold: '#FFD84D',
    rgbAccent: '0,229,255',
    rgbGold: '255,59,127',
    titleGrad: 'linear-gradient(180deg,#FFFFFF 0%,#E0F2FE 55%,#93C5FD 100%)',
    accentGrad: 'linear-gradient(180deg,#FFE875 0%,#FF3B7F 55%,#DB2777 100%)',
  },
  warm: {
    background: '#0D0908',
    surface: '#1C1412',
    textPrimary: '#FFF7ED',
    textSecondary: '#FED7AA',
    accent: '#FB923C',
    accent2: '#F472B6',
    gold: '#FBBF24',
    rgbAccent: '251,146,60',
    rgbGold: '251,191,36',
    titleGrad: 'linear-gradient(180deg,#FFFBF5 0%,#FFEDD5 55%,#FDBA74 100%)',
    accentGrad: 'linear-gradient(180deg,#FEF08A 0%,#FB923C 55%,#EA580C 100%)',
  },
  emerald: {
    background: '#081312',
    surface: '#0F1F1D',
    textPrimary: '#ECF7F4',
    textSecondary: '#9AC0B8',
    accent: '#45D1B2',
    accent2: '#7BE4CE',
    gold: '#F6BA6F',
    rgbAccent: '69,209,178',
    rgbGold: '246,186,111',
    titleGrad: 'linear-gradient(180deg,#F5FFFC 0%,#CCF7EE 55%,#7BE4CE 100%)',
    accentGrad: 'linear-gradient(180deg,#FFE2B8 0%,#F6BA6F 55%,#45D1B2 100%)',
  },
}

export function resolvePalette(script) {
  const style = String(script?.style || 'tech').toLowerCase()
  const base = PALETTES[style] || PALETTES.tech
  return {
    ...base,
    ...(script?.theme || {}),
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Balance long titles into evenly-proportioned lines so we NEVER wrap 1-char orphans!
 */
/** Unbreakable title units: Latin words / numbers stay whole (e.g. "AI", "2026", "340%"); CJK chars are single units. */
export function tokenizeTitleUnits(txt) {
  return String(txt || '').match(/[A-Za-z0-9][\w.+%#&'’\/-]*|\s+|./gsu) || []
}

/** Approximate rendered width in CJK-character units (full-width = 1, Latin/digits ≈ 0.56, space ≈ 0.3). */
function titleUnitWidth(unit) {
  let w = 0
  for (const ch of unit) w += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/u.test(ch) ? 1 : /\s/.test(ch) ? 0.3 : 0.56
  return w
}

/** Word boundaries (UTF-16 offsets) from Intl.Segmenter, or null when unavailable. */
function titleWordBoundaries(txt) {
  try {
    if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null
    const set = new Set()
    for (const seg of new Intl.Segmenter('zh', { granularity: 'word' }).segment(txt)) set.add(seg.index + seg.segment.length)
    return set
  } catch {
    return null
  }
}

export function formatBalancedTitle(rawTitle, maxLineChars = 11) {
  const txt = String(rawTitle || '').trim()
  if (!txt) return ['']
  if (txt.includes('\n')) return txt.split('\n').map((s) => s.trim()).filter(Boolean)
  const units = tokenizeTitleUnits(txt)
  const total = units.reduce((a, u) => a + titleUnitWidth(u), 0)
  if (total <= maxLineChars) return [txt]
  const colonIdx = txt.search(/[：:]/)
  if (colonIdx > 2 && colonIdx < txt.length - 3) {
    return [txt.slice(0, colonIdx + 1).trim(), txt.slice(colonIdx + 1).trim()]
  }
  // Balanced split at a unit boundary (never inside a Latin word / number). Comma / space breaks beat an exact-middle
  // cut, cutting inside a dictionary word is penalised, line 1 never ends with an opening bracket and line 2 never
  // starts with closing punctuation.
  const wordBounds = titleWordBoundaries(txt)
  let best = -1
  let bestScore = Infinity
  let acc = 0
  let charPos = 0
  for (let i = 0; i < units.length - 1; i++) {
    acc += titleUnitWidth(units[i])
    charPos += units[i].length
    const cur = units[i]
    const next = units[i + 1]
    if (/^[，。、！？；：,.!?;:）)》」』】%]/u.test(next)) continue
    if (/[（(《「『【“‘]$/u.test(cur)) continue
    let score = Math.abs(acc - total / 2)
    const overflow = Math.max(acc, total - acc) - maxLineChars
    if (overflow > 0) score += overflow * 1.5
    if (/[，、,；;·—]$/u.test(cur)) score -= Math.max(0.9, total * 0.18)
    else if (/^\s+$/.test(cur) || /^\s+$/.test(next)) score -= Math.max(0.6, total * 0.08)
    else if (wordBounds && !wordBounds.has(charPos)) score += 1.2
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  }
  if (best < 0) return [txt]
  return [units.slice(0, best + 1).join('').trim(), units.slice(best + 1).join('').trim()].filter(Boolean)
}

function buildCharSpansHtml(lines, cls = 'k-ch') {
  const charSpan = (ch) => `<span class="${cls}">${ch === ' ' ? '&nbsp;' : escapeHtml(ch)}</span>`
  return lines
    .map(
      (line) =>
        `<div class="k-line-row">${tokenizeTitleUnits(line)
          .map((u) => ([...u].length > 1 && /^[A-Za-z0-9]/.test(u) ? `<span class="k-word">${[...u].map(charSpan).join('')}</span>` : [...u].map(charSpan).join('')))
          .join('')}</div>`,
    )
    .join('')
}

function resolveMediaList(scene) {
  if (Array.isArray(scene.media) && scene.media.length > 0) return scene.media
  if (scene.mediaPath) {
    return [{ path: scene.mediaPath, type: scene.mediaType || 'image', motion: scene.kenBurns || 'zoom-in' }]
  }
  return []
}

function buildMediaTag(m, idx, isPrimary = true) {
  if (!m?.path) return ''
  const rawPath = String(m.path).replace(/\\/g, '/')
  const src = rawPath.startsWith('http') || rawPath.startsWith('/') ? rawPath : rawPath
  const isVid = m.type === 'video' || /\.(mp4|mov|webm|mkv)$/i.test(rawPath)
  const cls = isPrimary ? 'k-media-el k-primary-media' : `k-media-el k-extra-media k-extra-${idx}`
  if (isVid) {
    return `<video class="${cls}" src="${escapeHtml(src)}" muted playsinline preload="auto" data-motion="${escapeHtml(m.motion || 'zoom-in')}"></video>`
  }
  return `<img class="${cls}" src="${escapeHtml(src)}" alt="" data-motion="${escapeHtml(m.motion || 'zoom-in')}">`
}

function renderSceneTemplateHtml(scene, idx, total, theme) {
  const layout = scene.layout || (resolveMediaList(scene).length > 0 ? 'media-split-motion' : 'kinetic-impact')
  const mediaList = resolveMediaList(scene)
  const poolList = Array.isArray(scene.poolMedia) && scene.poolMedia.length > 0 ? scene.poolMedia : mediaList
  const primary = mediaList[0] || null
  const secondary = mediaList[1] || null
  const safeTitleLines = formatBalancedTitle(scene.title || `第 ${idx + 1} 幕`, layout === 'media-split-motion' ? 9 : 11)
  const highlights = Array.isArray(scene.highlights) ? scene.highlights.filter(Boolean).slice(0, 3) : []
  const tagText = escapeHtml(scene.tag || `0${idx + 1}`)
  const stepCode = `${String(idx + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`
  const subTitleTxt = scene.subtitleLine ? escapeHtml(scene.subtitleLine) : ''

  // Dynamic SVG Architecture Diagram Widget (Opus 5.5 Vibecoding Pillar #2)
  const buildSvgArchitectureWidgetHtml = (topoOverride = '') => {
    const topo = topoOverride || scene.topology || ['neural-pipeline', 'microservice-mesh', 'layered-stack', 'radial-hub', 'ast-tree'][idx % 5]
    const rawNodes = Array.isArray(scene.archNodes) && scene.archNodes.length >= 3
      ? scene.archNodes
      : Array.isArray(scene.steps) && scene.steps.length >= 3
        ? scene.steps
        : [
            { id: '01', title: highlights[0] || '意图解析与分镜', sub: 'AST // SCHEMA DIRECTOR' },
            { id: '02', title: highlights[1] || 'Three.js 3D 视窗', sub: 'WEBGL // PERSPECTIVE' },
            { id: '03', title: highlights[2] || '动态 SVG 拓扑总线', sub: 'BEZIER // PHOTON BUS' },
            { id: '04', title: scene.title || '节拍弹簧物理引擎', sub: 'SPRING // INTERPOLATE' },
            { id: '05', title: '48kHz 混音与成片', sub: 'REMOTION // MP4 OUT' },
          ]
    const nodes = rawNodes.slice(0, 5)
    const coords = topo === 'microservice-mesh'
      ? [{ x: 180, y: 125 }, { x: 560, y: 95 }, { x: 930, y: 125 }, { x: 350, y: 315 }, { x: 760, y: 315 }]
      : topo === 'radial-hub'
        ? [{ x: 200, y: 110 }, { x: 920, y: 110 }, { x: 560, y: 220 }, { x: 200, y: 330 }, { x: 920, y: 330 }]
        : [{ x: 135, y: 220 }, { x: 348, y: 125 }, { x: 560, y: 220 }, { x: 772, y: 125 }, { x: 985, y: 220 }]
    const edges = topo === 'radial-hub'
      ? [[0, 2], [1, 2], [2, 3], [2, 4], [0, 3], [1, 4]]
      : [[0, 1], [1, 2], [2, 3], [3, 4], [0, 2], [2, 4]]
    const edgesSvg = edges.map(([ai, bi], ei) => {
      const a = coords[ai] || coords[0]
      const b = coords[bi] || coords[coords.length - 1]
      const mx = ((a.x + b.x) / 2).toFixed(1)
      const d = `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`
      return `
        <path class="k-arch-edge-bg" d="${d}" fill="none" stroke="rgba(148,163,184,0.22)" stroke-width="2" stroke-dasharray="6 6" />
        <path class="k-arch-edge" d="${d}" fill="none" stroke="${ei % 2 === 0 ? 'var(--accent)' : 'var(--gold)'}" stroke-width="3" stroke-linecap="round" />
        <circle class="k-arch-photon" data-ax="${a.x}" data-ay="${a.y}" data-bx="${b.x}" data-by="${b.y}" data-ei="${ei}" cx="${a.x}" cy="${a.y}" r="5.5" fill="${ei % 2 === 0 ? 'var(--gold)' : 'var(--accent)'}" />`
    }).join('')
    const nodesSvg = nodes.map((nd, ni) => {
      const pt = coords[ni] || { x: 160 + ni * 200, y: 220 }
      const nw = 188, nh = 92
      const rx = pt.x - nw / 2, ry = pt.y - nh / 2
      const col = ni % 2 === 0 ? 'var(--accent)' : 'var(--gold)'
      const titleStr = String(nd.title || nd.label || nd || `Node 0${ni + 1}`).slice(0, 11)
      const subStr = String(nd.sub || nd.desc || `NODE 0${ni + 1} // ACTIVE`).slice(0, 20)
      return `
        <g class="k-arch-node" data-nidx="${ni}" style="transform-origin:${pt.x}px ${pt.y}px">
          <rect x="${rx}" y="${ry}" width="${nw}" height="${nh}" rx="14" fill="rgba(8,14,24,0.92)" stroke="${col}" stroke-width="2" />
          <rect x="${rx + 14}" y="${ry}" width="${nw - 28}" height="3" rx="1.5" fill="${col}" />
          <text x="${rx + 16}" y="${ry + 26}" fill="${col}" font-family="var(--font-mono)" font-size="12" font-weight="800">0${ni + 1} // ${escapeHtml(subStr.split('//')[0].trim())}</text>
          <circle cx="${rx + nw - 18}" cy="${ry + 22}" r="4.5" fill="${col}" />
          <text x="${rx + 16}" y="${ry + 56}" fill="#F8FAFC" font-family="var(--font-sans)" font-size="18" font-weight="900">${escapeHtml(titleStr)}</text>
          <text x="${rx + 16}" y="${ry + 76}" fill="rgba(148,163,184,0.88)" font-family="var(--font-mono)" font-size="11" font-weight="600">LATENCY ${(0.4 + ni * 0.3).toFixed(1)}ms · SYNC</text>
        </g>`
    }).join('')
    return `
      <div class="k-arch-panel">
        <div class="k-app-bar">
          <div class="k-app-dots"><i></i><i></i><i></i></div>
          <span class="k-app-title">${escapeHtml(scene.windowTitle || scene.title || 'DYNAMIC SVG ARCHITECTURE TOPOLOGY')}</span>
          <span class="k-app-kicker">SVG TOPOLOGY // ${escapeHtml(String(topo).toUpperCase())}</span>
        </div>
        <div class="k-arch-body">
          <svg class="k-arch-svg" viewBox="0 0 1120 440" preserveAspectRatio="xMidYMid meet">
            <defs>
              <pattern id="archGrid-${idx}" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(148,163,184,0.08)" stroke-width="1" />
              </pattern>
            </defs>
            <rect width="1120" height="440" fill="url(#archGrid-${idx})" />
            ${edgesSvg}
            ${nodesSvg}
          </svg>
        </div>
      </div>`
  }

  // Vibecoding HUD Data & Live Code Stream Widget (Opus 5.5 Vibecoding Pillar #3)
  const buildHudDashboardWidgetHtml = () => {
    const codeLines = Array.isArray(scene.codeLines) && scene.codeLines.length > 0
      ? scene.codeLines.slice(0, 6)
      : [
          `const stage = useThreeCyberStage({ preset: '${scene.threePreset || 'orbital-core'}', fov: 45 });`,
          `const rig = computeBeatSpring(frame, fps, bgm.beats, { stiffness: 175 });`,
          `// ${highlights[0] || scene.title || '帧级确定性物理弹簧与三维透视矩阵'}`,
          `<ThreeCanvas width={1920} height={1080} camera={{ position: [0, 0, 8.2] }}>`,
          `  <SvgArchitectureDiagram topology="neural-pipeline" nodes={5} />`,
          `</ThreeCanvas> // ✓ 60FPS Lock · Audio LUFS -14.0dB`,
        ]
    const rawMetrics = Array.isArray(scene.metrics) && scene.metrics.length >= 2
      ? scene.metrics.slice(0, 3)
      : [
          { label: highlights[0] || '渲染帧率锁定', value: Number(scene.counterTarget) || 60, suffix: 'FPS', pct: 96 },
          { label: highlights[1] || '物理弹簧精度', value: 99, suffix: '.4%', pct: 94 },
          { label: highlights[2] || '多轨混音动态', value: 48, suffix: 'kHz', pct: 90 },
        ]
    const ringsHtml = rawMetrics.map((m, mi) => {
      const pct = Math.max(25, Math.min(99, Number(m.pct) || 92 - mi * 4))
      const col = mi === 1 ? 'var(--gold)' : 'var(--accent)'
      return `
        <div class="k-hud-ring-card">
          <svg class="k-hud-ring-svg" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="46" fill="none" stroke="rgba(148,163,184,0.16)" stroke-width="8" />
            <circle class="k-hud-ring-arc" data-pct="${pct}" cx="60" cy="60" r="46" fill="none" stroke="${col}" stroke-width="8" stroke-linecap="round" stroke-dasharray="289" stroke-dashoffset="289" transform="rotate(-90 60 60)" />
          </svg>
          <div class="k-hud-ring-info">
            <div class="k-hud-ring-val" data-target="${Number(m.value) || 96}" data-suffix="${escapeHtml(m.suffix || '%')}">0${escapeHtml(m.suffix || '%')}</div>
            <div class="k-hud-ring-lbl">${escapeHtml(m.label || `METRIC 0${mi + 1}`)}</div>
          </div>
        </div>`
    }).join('')
    return `
      <div class="k-hud-dashboard">
        <div class="k-hud-code-card">
          <div class="k-app-bar">
            <div class="k-app-dots"><i></i><i></i><i></i></div>
            <span class="k-app-title">VIBECODING // REMOTION + THREE.JS TSX STREAM</span>
            <span class="k-app-kicker">SPRING RIG</span>
          </div>
          <div class="k-hud-code-body">
            ${codeLines.map((ln, li) => `<div class="k-hud-code-line" data-lidx="${li}"><span class="k-ln-num">0${li + 1}</span><code>${escapeHtml(ln)}</code></div>`).join('')}
          </div>
          <div class="k-hud-code-foot">
            <span>⚡ BEAT-SYNCED SPRING (damping:13.5, stiffness:175)</span>
            <span>STATUS: LOCKED</span>
          </div>
        </div>
        <div class="k-hud-telemetry-col">
          <div class="k-hud-rings-row">${ringsHtml}</div>
          <div class="k-hud-wave-card">
            <div class="k-hud-wave-head">
              <span>REALTIME TELEMETRY WAVE // DETERMINISTIC FRAME INTERPOLATION</span>
              <em>LIVE 60Hz</em>
            </div>
            <svg class="k-hud-wave-svg" viewBox="0 0 560 135" preserveAspectRatio="none">
              <defs>
                <linearGradient id="hudWaveGrad-${idx}" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.42" />
                  <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.0" />
                </linearGradient>
              </defs>
              <path d="M0,105 C70,35 130,95 200,48 C270,12 330,82 400,32 C470,5 515,60 560,22 L560,135 L0,135 Z" fill="url(#hudWaveGrad-${idx})" />
              <path class="k-hud-wave-line" d="M0,105 C70,35 130,95 200,48 C270,12 330,82 400,32 C470,5 515,60 560,22" fill="none" stroke="var(--accent)" stroke-width="3.5" stroke-linecap="round" />
              <circle class="k-hud-wave-dot" cx="400" cy="32" r="6.5" fill="var(--gold)" />
            </svg>
          </div>
        </div>
      </div>`
  }

  // Build Floating 3D Perspective Wall Cards for `3d-stage-opener`
  let depthStageHtml = ''
  if (layout === '3d-stage-opener') {
    const cardItems = []
    const count = 16
    for (let k = 0; k < count; k++) {
      const m = poolList.length > 0 ? poolList[k % poolList.length] : null
      const kw = highlights[k % Math.max(1, highlights.length)] || tagText
      if (m) {
        const src = String(m.path).replace(/\\/g, '/')
        const isVid = m.type === 'video' || /\.(mp4|mov|webm)$/i.test(src)
        cardItems.push(
          `<div class="k-3d-card" data-cidx="${k}">${
            isVid
              ? `<video class="k-3d-media" src="${escapeHtml(src)}" muted playsinline preload="auto"></video>`
              : `<img class="k-3d-media" src="${escapeHtml(src)}" alt="">`
          }<div class="k-3d-chrome"><i></i><i></i><i></i></div></div>`,
        )
      } else {
        cardItems.push(
          `<div class="k-3d-card k-3d-badge" data-cidx="${k}"><span class="k-3d-dot"></span><span>${escapeHtml(kw)}</span></div>`,
        )
      }
    }
    depthStageHtml = `<div class="k-3d-space"><div class="k-3d-world">${cardItems.join('')}</div></div>`
  }

  // Build Mosaic Grid for `mosaic-pulse-wall`
  let mosaicHtml = ''
  if (layout === 'mosaic-pulse-wall') {
    const cells = []
    const cellCount = 6
    for (let k = 0; k < cellCount; k++) {
      const m = poolList.length > 0 ? poolList[k % poolList.length] : null
      const kw = highlights[k % Math.max(1, highlights.length)] || `${stepCode}`
      cells.push(
        `<div class="k-mosaic-cell" data-midx="${k}">${
          m ? buildMediaTag(m, k, false) : `<div class="k-mosaic-typo">${escapeHtml(kw)}</div>`
        }<div class="k-mosaic-badge">${String(k + 1).padStart(2, '0')}</div></div>`,
      )
    }
    mosaicHtml = `<div class="k-mosaic-wrap"><div class="k-mosaic-grid">${cells.join('')}</div></div>`
  }

  // Primary Media Backdrop (for hero/climax/impact) or 3D Card Showcase (for split/opener)
  const backdropMediaHtml = primary
    ? `<div class="k-bg-media">${buildMediaTag(primary, 0, true)}<div class="k-bg-grade"></div></div>`
    : `<div class="k-bg-procedural"></div>`

  const showcaseCardHtml = primary
    ? `<div class="k-card-stage">
        <div class="k-mac-frame">
          <div class="k-mac-bar"><i></i><i></i><i></i><span>${tagText}</span></div>
          <div class="k-mac-viewport">${buildMediaTag(primary, 0, true)}</div>
          <div class="k-spec-glint"></div>
        </div>
        ${
          secondary
            ? `<div class="k-pip-frame">${buildMediaTag(secondary, 1, false)}</div>`
            : ''
        }
      </div>`
    : `<div class="k-card-stage">
        <div class="k-terminal-card">
          <div class="k-mac-bar"><i></i><i></i><i></i><span>${tagText}</span></div>
          <div class="k-term-body">
            ${highlights.map((h, hi) => `<div class="k-term-row"><span>0${hi + 1}</span><b>${escapeHtml(h)}</b></div>`).join('')}
          </div>
        </div>
      </div>`

  // Main layout inner composition
  let contentHtml = ''
  if (layout === '3d-stage-opener') {
    contentHtml = `
      ${backdropMediaHtml}
      ${depthStageHtml}
      <div class="k-hero-scrim"></div>
      <div class="k-split-grid">
        <div class="k-left-col">
          <div class="k-eyebrow"><span class="k-dot"></span><span>${stepCode} · ${tagText}</span></div>
          <div class="k-headline k-glitch-target">${buildCharSpansHtml(safeTitleLines)}</div>
          ${subTitleTxt ? `<div class="k-subline">${subTitleTxt}</div>` : ''}
          <div class="k-pills-row">${highlights.map((h) => `<div class="k-pill"><span>▸</span>${escapeHtml(h)}</div>`).join('')}</div>
        </div>
        ${primary ? `<div class="k-right-col">${showcaseCardHtml}</div>` : ''}
      </div>`
  } else if (layout === 'media-split-motion') {
    const flip = idx % 2 === 1
    contentHtml = `
      ${backdropMediaHtml}
      <div class="k-dark-veil"></div>
      <div class="k-split-grid ${flip ? 'k-reverse' : ''}">
        <div class="k-left-col">
          <div class="k-eyebrow"><span class="k-dot"></span><span>${stepCode} · ${tagText}</span></div>
          <div class="k-headline">${buildCharSpansHtml(safeTitleLines)}</div>
          <div class="k-accent-rule"></div>
          <div class="k-callouts">${highlights
            .map(
              (h, hi) =>
                `<div class="k-callout" style="--accent-bar:${hi % 2 ? theme.gold : theme.accent2}"><span class="k-cnum">${String(hi + 1).padStart(2, '0')}</span><span class="k-ctxt">${escapeHtml(h)}</span></div>`,
            )
            .join('')}</div>
        </div>
        <div class="k-right-col">${showcaseCardHtml}</div>
      </div>`
  } else if (layout === 'mosaic-pulse-wall') {
    contentHtml = `
      <div class="k-bg-procedural"></div>
      ${mosaicHtml}
      <div class="k-bottom-fade"></div>
      <div class="k-mosaic-overlay">
        <div class="k-counter-badge"><span class="k-cnt-num" data-target="${Number(scene.counterTarget) || 96}">00</span><span class="k-cnt-unit">${tagText}</span></div>
        <div class="k-headline k-headline-sm">${buildCharSpansHtml(safeTitleLines)}</div>
      </div>`
  } else if (layout === 'compare-dual') {
    const left = scene.compareLeft || { label: '传统呈现', text: highlights[0] || '静态平铺画面' }
    const right = scene.compareRight || { label: '动态重构', text: highlights[1] || '空间节拍联动' }
    contentHtml = `
      ${backdropMediaHtml}
      <div class="k-dark-veil"></div>
      <div class="k-center-stage">
        <div class="k-eyebrow"><span class="k-dot"></span><span>${stepCode} · ${tagText}</span></div>
        <div class="k-headline k-headline-md">${buildCharSpansHtml(safeTitleLines)}</div>
        <div class="k-compare-row">
          <div class="k-cmp-card k-cmp-a">
            <div class="k-cmp-tag">A · ${escapeHtml(left.label)}</div>
            <div class="k-cmp-val">${escapeHtml(left.text)}</div>
          </div>
          <div class="k-cmp-bridge"><i></i></div>
          <div class="k-cmp-card k-cmp-b">
            <div class="k-cmp-tag k-cmp-gold">B · ${escapeHtml(right.label)}</div>
            <div class="k-cmp-val">${escapeHtml(right.text)}</div>
          </div>
        </div>
      </div>`
  } else if (layout === 'radial-climax') {
    contentHtml = `
      ${backdropMediaHtml}
      <div class="k-dark-veil-soft"></div>
      <div class="k-center-stage k-climax-stage">
        <div class="k-eyebrow"><span class="k-dot"></span><span>${tagText}</span></div>
        <div class="k-headline k-headline-lg">${buildCharSpansHtml(safeTitleLines)}</div>
        <div class="k-glow-bar"></div>
        <div class="k-stamp-seal">${escapeHtml(highlights[0] || theme.label || 'PRESENTED')}</div>
      </div>`
  } else if (layout === 'card-fan-opener') {
    const fanList = (Array.isArray(scene.fanMedia) && scene.fanMedia.length > 0 ? scene.fanMedia : poolList).slice(0, 7)
    const brandLogo = scene.brandMark || theme?.brandMark || ''
    const fanCardsHtml = fanList
      .map((fm, fi) => {
        const pathStr = typeof fm === 'string' ? fm : fm?.path || ''
        const mObj = { path: pathStr, type: 'image' }
        return `<div class="k-fan-card" data-fi="${fi}" data-total="${fanList.length}">${buildMediaTag(mObj, fi, false)}</div>`
      })
      .join('')
    contentHtml = `
      <div class="k-app-stage k-fan-stage">
        <div class="k-fan-arc">${fanCardsHtml}</div>
        <div class="k-fan-badge">
          ${brandLogo ? `<img class="k-brand-mini" src="${escapeHtml(brandLogo.replace(/^\.?[\\/]+/, './').replace(/\\/g, '/'))}" alt="" />` : '<span class="k-dot"></span>'}
          <span>${escapeHtml(scene.kicker || tagText)}</span>
        </div>
        <div class="k-headline k-headline-lg">${buildCharSpansHtml(safeTitleLines)}</div>
        <div class="k-pills-row">${highlights.map((h) => `<div class="k-pill"><span>◆</span>${escapeHtml(h)}</div>`).join('')}</div>
      </div>`
  } else if (layout === 'app-focus-shot') {
    const splitMode = scene.windowLayout === 'split'
    const brandLogo = scene.brandMark || theme?.brandMark || ''
    const marksHtml = (Array.isArray(scene.marks) ? scene.marks : [])
      .map((mk, mi) => {
        const wPct = Math.max(3, Number(mk.fw ?? mk.w ?? 0.18) * 100)
        const hPct = Math.max(3, Number(mk.fh ?? mk.h ?? 0.12) * 100)
        const rawL = mk.fx == null && mk.x != null ? Number(mk.x) * 100 : Number(mk.fx ?? 0.5) * 100 - wPct / 2
        const rawT = mk.fy == null && mk.y != null ? Number(mk.y) * 100 : Number(mk.fy ?? 0.5) * 100 - hPct / 2
        const lPct = Math.max(0, Math.min(100 - wPct, rawL))
        const tPct = Math.max(0, Math.min(100 - hPct, rawT))
        const below = tPct < 14 ? 'k-mark-below' : ''
        const cls = `${mk.shape === 'ring' ? 'k-mark-ring' : ''} ${mk.tone === 'gold' ? 'k-mark-gold' : ''}`
        return `<div class="k-mark-box ${cls}" data-start="${Number(mk.startFrame || 6)}" style="left:${lPct.toFixed(2)}%;top:${tPct.toFixed(2)}%;width:${wPct.toFixed(2)}%;height:${hPct.toFixed(2)}%">${
          mk.label ? `<div class="k-mark-chip ${below}">${escapeHtml(mk.label)}</div>` : ''
        }</div>`
      })
      .join('')
    const loupe = scene.loupe || null
    const loupeHtml = loupe && primary
      ? `<div class="k-loupe-ring ${loupe.side === 'left' ? 'k-loupe-left' : ''}"><div class="k-loupe-cam">${buildMediaTag(primary, 99, false)}</div>${
          loupe.label ? `<div class="k-loupe-tag">${escapeHtml(loupe.label)}</div>` : ''
        }</div>`
      : ''
    const winBody = `
      <div class="k-app-win ${scene.windowTheme === 'light' ? 'k-win-light' : ''}">
        <div class="k-app-bar">
          <div class="k-app-dots"><i></i><i></i><i></i></div>
          ${brandLogo ? `<img class="k-brand-mini" src="${escapeHtml(brandLogo.replace(/^\.?[\\/]+/, './').replace(/\\/g, '/'))}" alt="" />` : ''}
          <span class="k-app-title">${escapeHtml(scene.windowTitle || scene.title || '')}</span>
          <span class="k-app-kicker">${escapeHtml(scene.windowBadge || scene.kicker || tagText)}</span>
        </div>
        <div class="k-app-view">
          <div class="k-cam-stage" data-nw="${Number(primary?.width || 0)}" data-nh="${Number(primary?.height || 0)}">${primary ? buildMediaTag(primary, 0, true) : ''}${marksHtml}</div>
        </div>
      </div>
      ${loupeHtml}`
    if (splitMode) {
      contentHtml = `
        <div class="k-app-stage k-app-split">
          <div class="k-split-copy">
            <div class="k-eyebrow"><span class="k-dot"></span><span>${escapeHtml(scene.kicker || tagText)}</span></div>
            <div class="k-headline k-headline-sm k-headline-left">${buildCharSpansHtml(safeTitleLines)}</div>
            <div class="k-accent-rule"></div>
            <div class="k-pills-row k-pills-left">${highlights.map((h) => `<div class="k-pill"><span>◆</span>${escapeHtml(h)}</div>`).join('')}</div>
          </div>
          <div class="k-app-win-wrap">${winBody}</div>
        </div>`
    } else {
      contentHtml = `
        <div class="k-app-stage k-app-wide">
          <div class="k-app-head">
            <div class="k-app-head-l">
              <span class="k-tag-chip">${escapeHtml(scene.kicker || tagText)}</span>
              <span class="k-app-head-title">${escapeHtml(scene.title || '')}</span>
            </div>
            ${highlights.length ? `<span class="k-app-head-sub">${escapeHtml(highlights.join(' · '))}</span>` : ''}
          </div>
          <div class="k-app-win-wrap">${winBody}</div>
        </div>`
    }
  } else if (layout === 'workflow-steps') {
    const steps = Array.isArray(scene.steps) && scene.steps.length > 0
      ? scene.steps
      : (highlights.length ? highlights : ['导入素材', 'AI 编排', '渲染出片']).map((t, si) => ({
          num: `0${si + 1}`,
          title: t,
          desc: `Step ${si + 1}`,
          img: poolList[si % Math.max(1, poolList.length)]?.path || '',
        }))
    const cardsHtml = steps.slice(0, 5).map((st, si) => `
      <div class="k-wf-card" data-wi="${si}">
        <div class="k-wf-top"><span>${escapeHtml(st.num || `0${si + 1}`)}</span><i class="k-wf-dot"></i></div>
        <div class="k-wf-media">${st.img ? buildMediaTag({ path: st.img, type: 'image' }, si, false) : ''}</div>
        <div class="k-wf-info">
          <div class="k-wf-title">${escapeHtml(st.title || '')}</div>
          ${st.desc ? `<div class="k-wf-desc">${escapeHtml(st.desc)}</div>` : ''}
        </div>
      </div>`).join('')
    contentHtml = `
      <div class="k-app-stage k-wf-stage">
        <div class="k-wf-head">
          <div class="k-eyebrow"><span class="k-dot"></span><span>${escapeHtml(scene.kicker || tagText)}</span></div>
          <div class="k-headline k-headline-sm">${buildCharSpansHtml(safeTitleLines)}</div>
        </div>
        <div class="k-wf-row">${cardsHtml}</div>
      </div>`
  } else if (layout === 'split-wipe-compare') {
    const brandLogo = scene.brandMark || theme?.brandMark || ''
    const labelA = scene.compareLeft?.label || highlights[0] || 'MODE A'
    const labelB = scene.compareRight?.label || highlights[1] || 'MODE B'
    contentHtml = `
      <div class="k-app-stage k-app-wide">
        <div class="k-app-head">
          <div class="k-app-head-l">
            <span class="k-tag-chip k-tag-gold">${escapeHtml(scene.kicker || 'A / B COMPARE')}</span>
            <span class="k-app-head-title">${escapeHtml(scene.title || '')}</span>
          </div>
          ${highlights.length ? `<span class="k-app-head-sub">${escapeHtml(highlights.join(' · '))}</span>` : ''}
        </div>
        <div class="k-app-win-wrap">
          <div class="k-app-win">
            <div class="k-app-bar">
              <div class="k-app-dots"><i></i><i></i><i></i></div>
              ${brandLogo ? `<img class="k-brand-mini" src="${escapeHtml(brandLogo.replace(/^\.?[\\/]+/, './').replace(/\\/g, '/'))}" alt="" />` : ''}
              <span class="k-app-title">${escapeHtml(scene.windowTitle || scene.title || '')}</span>
              <span class="k-app-kicker">${escapeHtml(scene.kicker || 'WIPE')}</span>
            </div>
            <div class="k-app-view k-wipe-wrap">
              <div class="k-wipe-a">${primary ? buildMediaTag(primary, 0, true) : ''}</div>
              <div class="k-wipe-b">${secondary ? buildMediaTag(secondary, 1, false) : primary ? buildMediaTag(primary, 1, false) : ''}</div>
              <div class="k-wipe-line"><div class="k-wipe-knob">⇆</div></div>
              <div class="k-wipe-tag k-wipe-tag-l">${escapeHtml(labelA)}</div>
              <div class="k-wipe-tag k-wipe-tag-r">${escapeHtml(labelB)}</div>
            </div>
          </div>
        </div>
      </div>`
  } else if (layout === 'metric-dashboard') {
    const brandLogo = scene.brandMark || theme?.brandMark || ''
    const metric = Array.isArray(scene.metrics) && scene.metrics[0]
      ? scene.metrics[0]
      : { label: highlights[0] || '并发效率', value: Number(scene.counterTarget) || 100, suffix: '+' }
    const mVal = Number(metric.value) || Number(scene.counterTarget) || 100
    const mSfx = metric.suffix || '+'
    const cellsHtml = Array.from({ length: 20 }, (_, ci) => `<span class="k-dash-cell" data-ci="${ci}"></span>`).join('')
    const rightBodyHtml = primary
      ? `<div class="k-app-win">
            <div class="k-app-bar">
              <div class="k-app-dots"><i></i><i></i><i></i></div>
              ${brandLogo ? `<img class="k-brand-mini" src="${escapeHtml(brandLogo.replace(/^\.?[\\/]+/, './').replace(/\\/g, '/'))}" alt="" />` : ''}
              <span class="k-app-title">${escapeHtml(scene.windowTitle || scene.title || '')}</span>
              <span class="k-app-kicker">${escapeHtml(scene.windowBadge || 'ENGINE')}</span>
            </div>
            <div class="k-app-view">
              <div class="k-cam-stage" data-nw="${Number(primary?.width || 0)}" data-nh="${Number(primary?.height || 0)}">${buildMediaTag(primary, 0, true)}</div>
            </div>
          </div>`
      : buildSvgArchitectureWidgetHtml()
    contentHtml = `
      <div class="k-app-stage k-dash-grid">
        <div class="k-dash-left">
          <div class="k-eyebrow"><span class="k-dot"></span><span>${escapeHtml(scene.kicker || tagText)}</span></div>
          <div class="k-headline k-headline-sm k-headline-left">${buildCharSpansHtml(safeTitleLines)}</div>
          <div class="k-dash-panel">
            <div class="k-dash-panel-top">
              <span>${escapeHtml(metric.label || scene.title || '')}</span>
              <em>${escapeHtml(highlights[1] || 'REALTIME')}</em>
            </div>
            <div class="k-dash-num" data-target="${mVal}" data-suffix="${escapeHtml(mSfx)}">0${escapeHtml(mSfx)}</div>
            <div class="k-dash-bar"><div class="k-dash-bar-fill"></div></div>
            <div class="k-dash-cells">${cellsHtml}</div>
          </div>
        </div>
        <div class="k-app-win-wrap k-dash-right">
          ${rightBodyHtml}
        </div>
      </div>`
  } else if (layout === 'svg-architecture-flow') {
    contentHtml = `
      <div class="k-app-stage k-app-wide">
        <div class="k-app-head">
          <div class="k-app-head-l">
            <span class="k-tag-chip">${escapeHtml(scene.kicker || `${stepCode} · SVG ARCHITECTURE`)}</span>
            <span class="k-app-head-title">${escapeHtml(scene.title || '')}</span>
          </div>
          ${highlights.length ? `<span class="k-app-head-sub">${escapeHtml(highlights.join(' · '))}</span>` : ''}
        </div>
        <div class="k-app-win-wrap">
          ${buildSvgArchitectureWidgetHtml()}
        </div>
      </div>`
  } else if (layout === 'hud-telemetry-dashboard') {
    contentHtml = `
      <div class="k-app-stage k-app-wide">
        <div class="k-app-head">
          <div class="k-app-head-l">
            <span class="k-tag-chip k-tag-gold">${escapeHtml(scene.kicker || `${stepCode} · HUD TELEMETRY`)}</span>
            <span class="k-app-head-title">${escapeHtml(scene.title || '')}</span>
          </div>
          ${highlights.length ? `<span class="k-app-head-sub">${escapeHtml(highlights.join(' · '))}</span>` : ''}
        </div>
        <div class="k-app-win-wrap">
          ${buildHudDashboardWidgetHtml()}
        </div>
      </div>`
  } else if (layout === 'vibecoding-spring-stage') {
    const flip = idx % 2 === 1
    contentHtml = `
      <div class="k-split-grid ${flip ? 'k-reverse' : ''}">
        <div class="k-left-col">
          <div class="k-eyebrow"><span class="k-dot"></span><span>${stepCode} · ${escapeHtml(scene.kicker || 'VIBECODING SPRING RIG')}</span></div>
          <div class="k-headline k-headline-sm k-glitch-target">${buildCharSpansHtml(safeTitleLines)}</div>
          ${subTitleTxt ? `<div class="k-subline">${subTitleTxt}</div>` : ''}
          <div class="k-accent-rule"></div>
          <div class="k-pills-row">${highlights.map((h) => `<div class="k-pill"><span>⚡</span>${escapeHtml(h)}</div>`).join('')}</div>
        </div>
        <div class="k-right-col" style="flex:1.25;width:100%;">
          ${idx % 2 === 0 ? buildSvgArchitectureWidgetHtml('microservice-mesh') : buildHudDashboardWidgetHtml()}
        </div>
      </div>`
  } else if (layout === 'multi-window-trio') {
    const cards = poolList.slice(0, 3)
    const labels = Array.isArray(scene.trioLabels) && scene.trioLabels.length ? scene.trioLabels : highlights
    const winsHtml = cards
      .map((m, wi) => {
        const lbl = labels[wi] || `VIEW 0${wi + 1}`
        const isLight = /明|白|light/i.test(String(lbl))
        return `
          <div class="k-trio-win ${isLight ? 'k-win-light' : ''}" data-ti="${wi}">
            <div class="k-app-bar">
              <div class="k-app-dots"><i></i><i></i><i></i></div>
              <span class="k-app-title">${escapeHtml(lbl)}</span>
              <span class="k-app-kicker k-trio-badge">VIEW</span>
            </div>
            <div class="k-app-view">${m ? buildMediaTag(m, wi, false) : ''}</div>
          </div>`
      })
      .join('')
    contentHtml = `
      <div class="k-app-stage k-trio-stage">
        <div class="k-wf-head">
          <div class="k-headline k-headline-sm">${buildCharSpansHtml(safeTitleLines)}</div>
        </div>
        <div class="k-trio-row">${winsHtml}</div>
      </div>`
  } else if (layout === 'narrative-diorama') {
    const spec = scene.stageSpec || {}
    const heroNum = spec.heroNum ? `<div style="position:absolute;top:16%;left:50%;transform:translateX(-50%);font:900 220px/1 ${escapeHtml(spec.heroFont || "'Source Han Serif SC Heavy', serif")};color:rgba(253,243,220,0.9);letter-spacing:-8px;pointer-events:none;">${escapeHtml(spec.heroNum)}${spec.heroUnit ? `<span style="font-size:60px">${escapeHtml(spec.heroUnit)}</span>` : ''}</div>` : ''
    const calCols = Array.isArray(spec.calligraphy) && spec.calligraphy.length > 0
      ? `<div style="position:absolute;top:84px;right:96px;display:flex;flex-direction:row-reverse;gap:20px;">${spec.calligraphy.slice(0, 3).map((c) => `<div style="writing-mode:vertical-rl;font:900 42px/1.2 'Source Han Serif SC Heavy', serif;letter-spacing:6px;color:#F8E7B9;">${escapeHtml(c)}</div>`).join('')}</div>`
      : ''
    contentHtml = `
      <div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 48%, rgba(245,158,11,0.32), rgba(110,20,16,0.45) 45%, rgba(7,4,6,0.68) 92%);"></div>
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style="position:absolute;inset:0;width:100%;height:100%;opacity:0.84;">
        <circle cx="960" cy="520" r="128" fill="#FFF7DF" opacity="0.92" />
        <path d="M-20,780 L280,620 L620,695 L980,580 L1340,680 L1690,610 L1940,740 L1940,1080 L-20,1080 Z" fill="#180B08" />
      </svg>
      ${heroNum}
      ${calCols}
      <div class="k-center-stage">
        <div class="k-eyebrow"><span class="k-dot"></span><span>${stepCode} · ${escapeHtml(scene.title || tagText)}</span></div>
        <div class="k-headline k-headline-lg">${buildCharSpansHtml(safeTitleLines)}</div>
        <div class="k-pills-row">${highlights.map((h) => `<div class="k-pill"><span>◆</span>${escapeHtml(h)}</div>`).join('')}</div>
      </div>`
  } else {
    // kinetic-impact
    contentHtml = `
      ${backdropMediaHtml}
      <div class="k-dark-veil-soft"></div>
      <div class="k-center-stage">
        <div class="k-eyebrow"><span class="k-dot"></span><span>${stepCode} · ${tagText}</span></div>
        <div class="k-headline k-headline-lg k-glitch-target">${buildCharSpansHtml(safeTitleLines)}</div>
        <div class="k-pills-row">${highlights.map((h) => `<div class="k-pill"><span>◆</span>${escapeHtml(h)}</div>`).join('')}</div>
      </div>`
  }

  return `<template class="scene-template" data-scene-id="${escapeHtml(scene.id)}" data-layout="${escapeHtml(layout)}"><div class="k-scene" data-scene-idx="${idx}">${contentHtml}</div></template>`
}

const HTML_HEAVY_IMPACT_LAYOUTS = ['kinetic-impact', 'radial-climax', '3d-stage-opener', 'mosaic-pulse-wall', 'narrative-diorama']
const HTML_COMBAT_TEXT_RE = /斩|杀|破|战|冲|马|骑|箭|刀|剑|枪|锋|交锋|突袭|决战|单于|匈奴/

/**
 * Flash candidates of the HTML runtime (mirrors renderTransitions / the #fx-strobe block of the runtime below):
 *   tx:i       the white flash at the cut into shot i (every kind but iris-circle / block-wipe) + the cut strobe
 *   clash:i:e  the white frame of a weapon clash / heavy impact
 *   beat:k     the strobe on strong beat k inside a combat-titled shot without an action plan
 */
export function planHtmlFlashBudget({ timeline = [], beats = [], fps = 30, script = null } = {}) {
  const candidates = []
  const cutFrames = []
  const camIntFixed = Number(script?.audioProfile?.cameraBeatIntensity)
  const sec = (s) => Math.max(1, Math.round(s * fps))
  timeline.forEach((tl, i) => {
    const camInt = Number.isFinite(camIntFixed)
      ? camIntFixed
      : HTML_HEAVY_IMPACT_LAYOUTS.includes(tl.layout) || script?.narrationMode === 'subtitle-mv'
        ? 0.95
        : 0.25
    const hasActionMeta = Boolean(tl.actionMode)
    if (i > 0) {
      cutFrames.push(tl.startFrame)
      const kind = tl.transition || 'iris-circle'
      let lead = 0
      let len = 0
      if (kind === 'light-wipe') {
        lead = sec(0.18)
        len = sec(0.18) + 1
      } else if (kind === 'glitch-cut') {
        lead = 2
        len = 3
      } else if (kind !== 'iris-circle' && kind !== 'block-wipe') {
        lead = 1
        len = sec(0.22) + 1
      }
      const cutStrobe = tl.actionMode !== 'clean' && camInt >= 0.65 && !hasActionMeta
      if (cutStrobe) len = Math.max(len, sec(0.24) + 1)
      if (len > 0) {
        candidates.push({ key: 'tx:' + i, frame: tl.startFrame, lead, len, prio: kind === 'flash-cut' ? 4 : 2, coversCut: tl.startFrame })
      }
    }
    ;(tl.actionEvents || []).forEach((ev, e) => {
      const k = String(ev.kind || '')
      if (!(k.startsWith('metal_clash') || k === 'heavy_impact')) return
      candidates.push({ key: 'clash:' + i + ':' + e, frame: tl.startFrame + Math.round(Number(ev.frame) || 0), len: 3, prio: k === 'metal_clash_heavy' || k === 'heavy_impact' ? 5 : 3 })
    })
    if (!hasActionMeta && camInt >= 0.7 && HTML_COMBAT_TEXT_RE.test(String(tl.title || '') + ' ' + String(tl.narration || ''))) {
      beats.forEach((b, k) => {
        const bf = Math.ceil((Number(b?.time) || 0) * fps)
        if (b?.strong && bf >= tl.startFrame && bf < tl.endFrame) candidates.push({ key: 'beat:' + k, frame: bf, len: 2, prio: 1 })
      })
    }
  })
  return scheduleFlashBudget({ fps, candidates, cutFrames })
}

export function buildRichHtmlVideo(script) {
  const theme = { ...resolvePalette(script), brandMark: script?.brandMark || '' }
  const scenes = Array.isArray(script?.scenes) ? script.scenes : []
  const fps = Number(script?.fps) || 30
  const width = Number(script?.width) || 1920
  const height = Number(script?.height) || 1080
  const beats = Array.isArray(script?.bgm?.beats) ? script.bgm.beats : []
  const safeZone = resolveSafeZoneSpec(width, height, script?.targetPlatform || 'universal')
  const complianceNotice = buildComplianceNoticeText(script)
  const bundledFontFaceCss = buildBundledFontFaceCss('fonts')
  const landScale = width > height ? Math.max(0.42, Math.min(2.2, width / 1920)) : 1
  const lp = (n) => Math.max(1, Math.round(n * landScale))
  // Room the bottom subtitle pill needs (bottom offset + one line + padding + margin): content must stay above it
  const subFontPx = width < height ? 44 : Math.max(36, lp(script?.subtitleStyle === 'cinematic' || script?.narrationMode === 'subtitle-mv' ? 50 : 40))
  const subBottomPx = Number(script?.subtitleBottomPx) || safeZone.subtitleBottomPx
  const subReservePx = subBottomPx + Math.round(subFontPx * 1.28) + lp(20) + lp(22)

  const THREE_PRESET_CYCLE = [
    'orbital-core',
    'cyber-terrain',
    'particle-vortex',
    'floating-monoliths',
    'chrono-helix',
    'matrix-cubes',
  ]
  let cursorFrame = 0
  const timeline = scenes.map((s, idx) => {
    const durFrames = Math.max(12, Number(s.durationInFrames) || Math.ceil(Number(s.durationSec || 4.5) * fps))
    const startFrame = Number.isFinite(Number(s.startFrame)) ? Number(s.startFrame) : cursorFrame
    const endFrame = startFrame + durFrames
    cursorFrame = endFrame
    return {
      id: s.id || `scene-${String(idx + 1).padStart(2, '0')}`,
      idx,
      layout: s.layout || 'kinetic-impact',
      threePreset: s.threePreset || s?.stageSpec?.threePreset || THREE_PRESET_CYCLE[idx % THREE_PRESET_CYCLE.length],
      transition: s.transition || 'iris-circle',
      kenBurns: s.kenBurns || 'zoom-in',
      vfx: s.vfx || 'sparks+shockwave',
      startFrame,
      endFrame,
      startSec: startFrame / fps,
      endSec: endFrame / fps,
      durFrames,
      durSec: durFrames / fps,
      narration: s.narration || '',
      title: s.title || '',
      accentWords: Array.isArray(s.accentWords) ? s.accentWords : [],
      cameraKeyframes: Array.isArray(s.cameraKeyframes) ? s.cameraKeyframes : [],
      actionMode: String(s.actionMode || ''),
      actionEvents: Array.isArray(s.actionEvents) ? s.actionEvents.map((e) => ({ frame: Number(e.frame) || 0, kind: String(e.kind || ''), intensity: Number(e.intensity) || 0.9 })) : [],
      subtitles: Array.isArray(s.subtitles) ? s.subtitles : [],
      counterTarget: Number(s.counterTarget) || 96,
      workflowSteps: Array.isArray(s.workflowSteps) ? s.workflowSteps : Array.isArray(script?.workflowSteps) ? script.workflowSteps : [],
      hudStep: Number.isFinite(Number(s.hudStep)) ? Number(s.hudStep) : -1,
      cams: Array.isArray(s.cams) ? s.cams : [],
      loupe: s.loupe || null,
      avatarClip: s.avatarClip || null,
      avatarLayout: s.avatarLayout || '',
    }
  })

  const totalFrames = Math.max(30, Number(script?.totalDurationInFrames) || cursorFrame || 300)

  // Photosensitivity guard: every full-screen flash the runtime can draw is scheduled here (shared flash budget:
  // ≥ 0.5 s apart, ≤ 7 luminance steps per second, heavy clashes first); dropped ones are marked for the runtime.
  const flashPlan = planHtmlFlashBudget({ timeline, beats, fps, script })
  const payloadBeats = beats.map((b, k) => (flashPlan.dropped['beat:' + k] ? { ...b, noFlash: true } : b))
  timeline.forEach((tl, i) => {
    if (flashPlan.dropped['tx:' + i]) tl.noFlashIn = true
    tl.actionEvents.forEach((ev, e) => {
      if (flashPlan.dropped['clash:' + i + ':' + e]) ev.noFlash = true
    })
  })
  const templatesHtml = scenes.map((s, idx) => renderSceneTemplateHtml(s, idx, scenes.length, theme)).join('\n  ')

  const payloadJson = JSON.stringify({
    fps,
    width,
    height,
    totalFrames,
    totalSec: totalFrames / fps,
    rgbAccent: theme.rgbAccent || '125,178,255',
    rgbGold: theme.rgbGold || '245,185,46',
    accent: theme.accent,
    accent2: theme.accent2,
    gold: theme.gold,
    beats: payloadBeats,
    narrationMode: script?.narrationMode || 'tts',
    audioProfile: script?.audioProfile || null,
    visual3dMode: script?.visual3dMode || 'auto',
    avatarClip: script?.avatarClip || null,
    avatarLayout: script?.avatarLayout || 'pip-br',
    timeline,
    // inlined into a <script>: `<` escaped so subtitle / narration text such as `</script>` cannot end the element
  }).replace(/</g, '\\u003c')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${width}, initial-scale=1.0" />
  <title>${escapeHtml(script?.title || 'DSH Motion Video')}</title>
  <style>
    ${bundledFontFaceCss}

    :root {
      --bg: ${theme.background};
      --surface: ${theme.surface};
      --text: ${theme.textPrimary};
      --sub: ${theme.textSecondary};
      --accent: ${theme.accent};
      --accent2: ${theme.accent2};
      --gold: ${theme.gold};
      --font-sans: ${PRIMARY_SANS_STACK};
      --font-mono: ${PRIMARY_MONO_STACK};
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%; height: 100%; overflow: hidden;
      background: #030406;
      display: flex; align-items: center; justify-content: center;
      font-family: var(--font-sans); color: var(--text);
      -webkit-font-smoothing: antialiased;
    }
    #stage {
      position: relative; width: ${width}px; height: ${height}px;
      flex: 0 0 auto; min-width: ${width}px; min-height: ${height}px;
      overflow: hidden; background: var(--bg);
      transform-origin: center center;
    }
    #world {
      position: absolute; inset: 0;
      transform-origin: 50% 50%;
    }
    .layer { position: absolute; inset: 0; pointer-events: none; }
    canvas.layer { width: 100%; height: 100%; }

    #scene-slots { position: absolute; inset: 0; overflow: hidden; transform-origin: left center; }
    .k-scene { position: absolute; inset: 0; overflow: hidden; display: none; }
    .k-scene.active { display: block; }

    /* Media & Procedural Backgrounds */
    .k-bg-procedural {
      position: absolute; inset: 0;
      background:
        radial-gradient(ellipse 75% 65% at 28% 35%, color-mix(in srgb, var(--accent) 26%, transparent), transparent 64%),
        radial-gradient(ellipse 65% 65% at 78% 70%, color-mix(in srgb, var(--accent2) 22%, transparent), transparent 62%),
        linear-gradient(160deg, var(--bg) 0%, var(--surface) 100%);
    }
    .k-bg-media { position: absolute; inset: 0; overflow: hidden; }
    .k-bg-media .k-media-el {
      width: 100%; height: 100%; object-fit: cover; display: block;
      transform-origin: 50% 50%;
    }
    .k-bg-grade {
      position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(5,6,8,0.22) 0%, rgba(5,6,8,0.1) 35%, rgba(5,6,8,0.68) 100%);
    }
    .k-hero-scrim {
      position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(90deg, rgba(5,6,8,0.88) 0%, rgba(5,6,8,0.62) 48%, rgba(5,6,8,0.25) 100%);
    }
    .k-dark-veil {
      position: absolute; inset: 0; pointer-events: none;
      background: rgba(5,6,8,0.72);
    }
    .k-dark-veil-soft {
      position: absolute; inset: 0; pointer-events: none;
      background: radial-gradient(ellipse 72% 64% at 50% 48%, rgba(5,6,8,0.36) 0%, rgba(5,6,8,0.68) 100%);
    }

    /* 3D Perspective Card Swarm */
    .k-3d-space {
      position: absolute; inset: 0; perspective: 1150px; perspective-origin: 50% 48%; pointer-events: none;
    }
    .k-3d-world {
      position: absolute; left: 50%; top: 50%; transform-style: preserve-3d;
    }
    .k-3d-card {
      position: absolute; left: 0; top: 0; width: ${lp(320)}px; border-radius: ${lp(10)}px; overflow: hidden;
      background: rgba(14,18,28,0.92); border: 1px solid rgba(255,255,255,0.2);
      box-shadow: 0 22px 60px rgba(0,0,0,0.65); transform-style: preserve-3d;
    }
    .k-3d-media { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; }
    .k-3d-chrome {
      position: absolute; top: ${lp(8)}px; left: ${lp(10)}px; display: flex; gap: ${lp(5)}px;
    }
    .k-3d-chrome i { width: ${lp(7)}px; height: ${lp(7)}px; border-radius: 50%; background: rgba(255,255,255,0.65); }
    .k-3d-badge {
      width: auto; min-width: ${lp(190)}px; padding: ${lp(12)}px ${lp(22)}px;
      display: inline-flex; align-items: center; gap: ${lp(10)}px;
      font: 700 ${lp(22)}px var(--font-mono); color: #E2E8F0; white-space: nowrap;
      border-color: color-mix(in srgb, var(--accent2) 55%, transparent);
    }
    .k-3d-dot { width: ${lp(10)}px; height: ${lp(10)}px; border-radius: 3px; background: var(--gold); }

    /* Split Stage & Showcase Frames */
    .k-split-grid {
      position: relative; z-index: 4; width: 100%; height: 100%;
      padding: ${lp(82)}px ${lp(105)}px ${Math.max(lp(164), subReservePx)}px; display: flex; align-items: center; justify-content: space-between; gap: ${lp(52)}px;
    }
    .k-split-grid.k-reverse { flex-direction: row-reverse; }
    .k-left-col {
      flex: 1.05; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: ${lp(22)}px;
    }
    .k-right-col {
      flex: 1; display: flex; align-items: center; justify-content: center; perspective: ${lp(1200)}px;
    }

    .k-center-stage {
      position: relative; z-index: 4; width: 100%; height: 100%;
      padding: ${lp(84)}px ${lp(115)}px ${Math.max(lp(168), subReservePx)}px; display: flex; flex-direction: column; align-items: center; justify-content: center;
      text-align: center; gap: ${lp(24)}px;
    }

    /* Typography */
    .k-eyebrow {
      display: inline-flex; align-items: center; gap: ${lp(10)}px;
      font: 700 ${lp(18)}px var(--font-mono); letter-spacing: ${lp(3)}px; color: var(--accent2);
      text-transform: uppercase;
    }
    .k-dot { width: ${lp(8)}px; height: ${lp(8)}px; border-radius: 50%; background: var(--gold); box-shadow: 0 0 12px var(--gold); }
    .k-headline {
      font-family: var(--font-sans); font-size: ${lp(92)}px; font-weight: 900; line-height: 1.14;
      letter-spacing: -1px; max-width: 100%;
    }
    .k-headline-lg { font-size: ${lp(108)}px; }
    .k-headline-md { font-size: ${lp(76)}px; }
    .k-headline-sm { font-size: ${lp(62)}px; }
    .k-line-row { display: block; }
    .k-word { display: inline-block; white-space: nowrap; }
    .k-ch {
      display: inline-block;
      background: ${theme.titleGrad}; -webkit-background-clip: text; background-clip: text;
      -webkit-text-fill-color: transparent;
      filter: drop-shadow(0 6px 0 rgba(0,0,0,0.48)) drop-shadow(0 16px 26px rgba(0,0,0,0.55));
    }
    .k-subline {
      font-size: ${lp(28)}px; line-height: 1.48; font-weight: 600; color: var(--sub); max-width: ${lp(780)}px;
      text-shadow: 0 2px 12px rgba(0,0,0,0.7);
    }

    /* Pills & Callouts */
    .k-pills-row { display: flex; flex-wrap: wrap; gap: ${lp(14)}px; }
    .k-pill {
      display: inline-flex; align-items: center; gap: ${lp(8)}px;
      padding: ${lp(10)}px ${lp(22)}px; border-radius: 40px;
      background: rgba(15,23,42,0.72); border: 1.5px solid color-mix(in srgb, var(--accent2) 55%, transparent);
      font: 700 ${lp(22)}px var(--font-sans); color: #F8FAFC;
      box-shadow: 0 10px 28px rgba(0,0,0,0.35);
    }
    .k-pill span { color: var(--gold); }

    .k-accent-rule {
      width: ${lp(240)}px; height: ${lp(4)}px; border-radius: 2px;
      background: linear-gradient(90deg, var(--gold), var(--accent2));
      transform-origin: left center;
    }
    .k-callouts { display: flex; flex-direction: column; gap: ${lp(14)}px; width: 100%; max-width: ${lp(760)}px; }
    .k-callout {
      display: flex; align-items: center; gap: ${lp(18)}px; padding: ${lp(15)}px ${lp(22)}px; border-radius: ${lp(12)}px;
      background: linear-gradient(180deg, rgba(24,28,36,0.92), rgba(12,14,19,0.94));
      border: 1px solid rgba(255,255,255,0.12);
      border-left: 4px solid var(--accent-bar, var(--accent2));
      box-shadow: 0 18px 42px rgba(0,0,0,0.45);
    }
    .k-cnum { font: 800 ${lp(24)}px var(--font-mono); color: var(--accent-bar, var(--gold)); }
    .k-ctxt { font: 700 ${lp(27)}px var(--font-sans); color: #F8FAFC; }

    /* Showcase Media Window + PiP */
    .k-card-stage { position: relative; width: 100%; max-width: ${lp(820)}px; transform-style: preserve-3d; }
    .k-mac-frame {
      position: relative; width: 100%; border-radius: ${lp(16)}px; overflow: hidden;
      background: #0E1118; border: 1.5px solid rgba(255,255,255,0.22);
      box-shadow: 0 36px 90px rgba(0,0,0,0.72), 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent);
    }
    .k-mac-bar {
      height: ${lp(36)}px; display: flex; align-items: center; gap: ${lp(8)}px; padding: 0 ${lp(16)}px;
      background: rgba(20,24,34,0.95); border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .k-mac-bar i { width: ${lp(10)}px; height: ${lp(10)}px; border-radius: 50%; }
    .k-mac-bar i:nth-child(1) { background: #FF5F57; }
    .k-mac-bar i:nth-child(2) { background: #FEBC2E; }
    .k-mac-bar i:nth-child(3) { background: #28C840; }
    .k-mac-bar span { margin-left: ${lp(10)}px; font: 600 ${Math.max(11, lp(13))}px var(--font-mono); color: var(--sub); letter-spacing: 1.5px; }
    .k-mac-viewport { position: relative; width: 100%; aspect-ratio: 16/10; overflow: hidden; background: #07100F; }
    .k-mac-viewport .k-media-el { width: 100%; height: 100%; object-fit: contain; display: block; }
    .k-spec-glint {
      position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.16) 49%, transparent 62%);
    }
    .k-pip-frame {
      position: absolute; right: ${-lp(28)}px; bottom: ${-lp(28)}px; width: 42%; aspect-ratio: 16/10;
      border-radius: ${lp(14)}px; overflow: hidden; border: 2px solid var(--gold);
      box-shadow: 0 22px 55px rgba(0,0,0,0.78); background: #0B0D12;
    }
    .k-pip-frame .k-media-el { width: 100%; height: 100%; object-fit: cover; display: block; }

    .k-terminal-card {
      width: 100%; border-radius: ${lp(16)}px; overflow: hidden;
      background: linear-gradient(180deg, rgba(20,24,32,0.94), rgba(10,12,17,0.96));
      border: 1px solid rgba(255,255,255,0.14); box-shadow: 0 30px 80px rgba(0,0,0,0.65);
    }
    .k-term-body { padding: ${lp(34)}px; display: flex; flex-direction: column; gap: ${lp(22)}px; }
    .k-term-row { display: flex; align-items: center; gap: ${lp(18)}px; font-size: ${lp(28)}px; }
    .k-term-row span { font: 700 ${lp(20)}px var(--font-mono); color: var(--gold); padding: ${lp(4)}px ${lp(12)}px; border-radius: 6px; background: rgba(245,185,46,0.14); }
    .k-term-row b { color: #F8FAFC; font-weight: 700; }

    /* Mosaic Pulse Wall */
    .k-mosaic-wrap {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      perspective: ${lp(1400)}px;
    }
    .k-mosaic-grid {
      width: ${Math.round(width * 0.885)}px; height: ${Math.round(height * 0.78)}px; display: grid;
      grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(2, 1fr);
      gap: ${lp(20)}px; transform-style: preserve-3d;
    }
    .k-mosaic-cell {
      position: relative; border-radius: ${lp(14)}px; overflow: hidden;
      background: #10141D; border: 1.5px solid rgba(255,255,255,0.16);
      box-shadow: 0 24px 60px rgba(0,0,0,0.6); transform-style: preserve-3d;
    }
    .k-mosaic-cell .k-media-el { width: 100%; height: 100%; object-fit: cover; display: block; }
    .k-mosaic-typo {
      width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
      font: 900 ${lp(42)}px var(--font-sans); color: var(--text);
      background: radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--accent) 28%, transparent), #0B0D14);
    }
    .k-mosaic-badge {
      position: absolute; left: ${lp(12)}px; top: ${lp(12)}px; padding: 4px ${lp(10)}px; border-radius: 6px;
      background: rgba(5,6,8,0.78); font: 700 ${Math.max(11, lp(14))}px var(--font-mono); color: var(--accent2);
    }
    .k-bottom-fade {
      position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(180deg, rgba(5,6,8,0.08) 0%, rgba(5,6,8,0.22) 48%, rgba(5,6,8,0.92) 100%);
    }
    .k-mosaic-overlay {
      position: absolute; left: ${lp(96)}px; right: auto; max-width: calc(100% - ${lp(192)}px); bottom: ${Math.max(lp(192), subReservePx + lp(8))}px; z-index: 6;
      display: flex; align-items: flex-end; gap: ${lp(34)}px;
      padding: ${lp(18)}px ${lp(32)}px ${lp(20)}px ${lp(20)}px; border-radius: ${lp(20)}px;
      background: linear-gradient(100deg, rgba(5,7,11,0.92) 0%, rgba(5,7,11,0.78) 100%);
      border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 20px 60px rgba(0,0,0,0.6);
      backdrop-filter: blur(${lp(12)}px); -webkit-backdrop-filter: blur(${lp(12)}px);
    }
    .k-counter-badge {
      display: flex; flex-direction: column; padding: ${lp(14)}px ${lp(24)}px; border-radius: ${lp(12)}px;
      background: rgba(8,10,16,0.88); border-left: 5px solid var(--gold);
    }
    .k-cnt-num {
      font: 900 ${lp(72)}px/1 var(--font-mono);
      background: ${theme.accentGrad}; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
    }
    .k-cnt-unit { font: 700 ${lp(16)}px var(--font-mono); color: var(--sub); letter-spacing: ${lp(3)}px; margin-top: 4px; }

    /* Compare Dual */
    .k-compare-row {
      display: flex; align-items: center; justify-content: center; gap: ${lp(36)}px; width: 100%; max-width: ${lp(1440)}px; margin-top: ${lp(10)}px;
    }
    .k-cmp-card {
      flex: 1; max-width: ${lp(580)}px; padding: ${lp(40)}px ${lp(34)}px; border-radius: ${lp(20)}px; text-align: left;
      background: linear-gradient(180deg, rgba(24,28,36,0.94), rgba(11,13,18,0.94));
      border: 1px solid rgba(255,255,255,0.14); border-top: 4px solid var(--accent2);
      box-shadow: 0 30px 75px rgba(0,0,0,0.62);
    }
    .k-cmp-card.k-cmp-b { border-top-color: var(--gold); }
    .k-cmp-tag { font: 700 ${lp(18)}px var(--font-mono); color: var(--accent2); letter-spacing: 2px; }
    .k-cmp-gold { color: var(--gold); }
    .k-cmp-val { font: 900 ${lp(46)}px/1.22 var(--font-sans); color: #FFFFFF; margin-top: ${lp(18)}px; }
    .k-cmp-bridge { width: ${lp(96)}px; height: 3px; position: relative; overflow: hidden; }
    .k-cmp-bridge i { display: block; width: 100%; height: 100%; border-top: 3px dashed rgba(255,255,255,0.45); }

    /* Climax Glow Bar & Seal */
    .k-glow-bar {
      width: ${lp(680)}px; height: 4px; border-radius: 2px;
      background: linear-gradient(90deg, var(--gold), var(--accent), var(--accent2));
      box-shadow: 0 0 24px color-mix(in srgb, var(--accent) 65%, transparent);
    }
    .k-stamp-seal {
      padding: ${lp(12)}px ${lp(32)}px; border: ${Math.max(3, lp(4))}px solid var(--gold); border-radius: 8px;
      font: 900 ${lp(32)}px var(--font-mono); letter-spacing: ${lp(5)}px; color: var(--gold);
      box-shadow: 0 0 36px rgba(245,185,46,0.22);
    }

    /* Post Filters, Vignette, Grain, Flash, Chrome, Subtitles */
    #vig {
      background: radial-gradient(ellipse 78% 72% at 50% 48%, transparent 56%, rgba(0,0,0,0.58) 100%);
    }
    #grain-layer { opacity: 0.055; mix-blend-mode: screen; }
    #glc {
      opacity: 0;
      background: repeating-linear-gradient(0deg, rgba(255,255,255,0.08) 0 2px, transparent 2px 7px);
      mix-blend-mode: screen;
    }
    #flash { background: #FFFFFF; opacity: 0; }
    #chrome-hud .k-corner {
      position: absolute; width: ${lp(22)}px; height: ${lp(22)}px; opacity: 0.48;
      border-color: rgba(255,255,255,0.65); border-style: solid; border-width: 0;
    }
    #c-tl { left: ${lp(32)}px; top: ${lp(32)}px; border-left-width: 2px; border-top-width: 2px; }
    #c-tr { right: ${lp(32)}px; top: ${lp(32)}px; border-right-width: 2px; border-top-width: 2px; }
    #c-bl { left: ${lp(32)}px; bottom: ${lp(32)}px; border-left-width: 2px; border-bottom-width: 2px; }
    #c-br { right: ${lp(32)}px; bottom: ${lp(32)}px; border-right-width: 2px; border-bottom-width: 2px; }

    #sub-wrap {
      position: absolute; left: ${safeZone.safePaddingPx.left}px; right: ${safeZone.safePaddingPx.right}px; bottom: ${Number(script?.subtitleBottomPx) || safeZone.subtitleBottomPx}px;
      display: flex; justify-content: center; pointer-events: none; z-index: 25;
    }
    #sub-pill {
      padding: ${lp(10)}px ${lp(30)}px; border-radius: ${lp(12)}px;
      background: ${script?.subtitleStyle === 'cinematic' || script?.narrationMode === 'subtitle-mv' ? 'transparent' : 'rgba(5,7,11,0.82)'};
      border: ${script?.subtitleStyle === 'cinematic' || script?.narrationMode === 'subtitle-mv' ? 'none' : '1.5px solid rgba(255,255,255,0.18)'};
      font-family: ${script?.subtitleStyle === 'cinematic' || script?.narrationMode === 'subtitle-mv' ? 'var(--font-serif, var(--font-sans))' : 'var(--font-sans)'};
      font-size: ${width < height ? 44 : Math.max(36, lp(script?.subtitleStyle === 'cinematic' || script?.narrationMode === 'subtitle-mv' ? 50 : 40))}px;
      font-weight: 900; line-height: 1.28; letter-spacing: 0.04em;
      color: #FFFDF7; max-width: ${Math.round(width * 0.90)}px; text-align: center; white-space: ${width < height ? 'normal' : 'nowrap'};
      -webkit-text-stroke: 1.4px rgba(0,0,0,0.86); paint-order: stroke fill;
      text-shadow: 0 4px 12px rgba(0,0,0,0.98), 0 0 8px rgba(0,0,0,0.95);
    }
    #fx-strobe {
      position: absolute; inset: 0; pointer-events: none; z-index: 22; opacity: 0; mix-blend-mode: screen;
    }
    #progress-line {
      position: absolute; left: 0; right: 0; bottom: 0; height: 3px;
      background: rgba(255,255,255,0.08); z-index: 30;
    }
    #progress-fill {
      width: 0%; height: 100%;
      background: linear-gradient(90deg, var(--accent), var(--gold));
    }
    #ai-badge {
      ${(() => {
        const badgeOn = script?.aiBadgeEnabled !== undefined ? Boolean(script.aiBadgeEnabled) : script?.aiBadge !== false
        if (!badgeOn) return 'display: none;'
        const topVal = `${Math.max(24, safeZone.safePaddingPx.top)}px`
        const bottomVal = `${Math.max(28, width < height ? Math.round(height * 0.20) : 28)}px`
        const sideVal = `${Math.max(28, safeZone.safePaddingPx.left)}px`
        const pos = String(script?.aiBadgePosition || 'top-right').toLowerCase()
        if (pos === 'top-left') return `position: absolute; top: ${topVal}; left: ${sideVal};`
        if (pos === 'bottom-left') return `position: absolute; bottom: ${bottomVal}; left: ${sideVal};`
        if (pos === 'bottom-right') return `position: absolute; bottom: ${bottomVal}; right: ${sideVal};`
        return `position: absolute; top: ${topVal}; right: ${sideVal};`
      })()} z-index: 28;
      padding: ${Math.max(4, lp(6))}px ${Math.max(10, lp(14))}px; border-radius: 999px;
      background: rgba(8,12,20,0.76); border: 1px solid rgba(255,255,255,0.18);
      font: 600 ${Math.max(12, lp(15))}px var(--font-sans); color: #E2E8F0; letter-spacing: 0.03em;
    }
    #avatar-overlay-wrap {
      position: absolute; pointer-events: none; z-index: 27; display: none; overflow: hidden;
      border-radius: 20px; border: 1.5px solid color-mix(in srgb, var(--accent) 55%, transparent);
      background: rgba(6,10,18,0.28);
      box-shadow: 0 18px 46px rgba(0,0,0,0.55);
    }
    #avatar-overlay-wrap.is-fullscreen {
      inset: 0; border-radius: 0; border: none; background: transparent; box-shadow: none; z-index: 24;
    }
    #avatar-overlay-video {
      width: 100%; height: 100%; object-fit: cover; display: block;
    }
    #avatar-overlay-wrap.is-fullscreen #avatar-overlay-video {
      object-fit: contain;
    }
    #end-notice-wrap {
      position: absolute; left: ${safeZone.safePaddingPx.left}px; right: ${safeZone.safePaddingPx.right}px; bottom: ${Math.round((Number(script?.subtitleBottomPx) || safeZone.subtitleBottomPx) + (width < height ? 88 : 72))}px;
      display: flex; justify-content: center; pointer-events: none; z-index: 29; opacity: 0;
    }
    #end-notice {
      padding: 7px 18px; border-radius: 999px;
      background: rgba(6,10,18,0.86); border: 1px solid color-mix(in srgb, var(--accent2) 38%, transparent);
      font: 600 15px var(--font-sans); color: #CBD5E1; letter-spacing: 0.02em; text-align: center;
    }
    ${width < height ? `
    /* Portrait Responsive Adaptation (${width}x${height}) */
    .k-split-grid, .k-split-grid.k-reverse {
      flex-direction: column; justify-content: center; gap: 28px;
      padding: ${Math.max(84, safeZone.safePaddingPx.top)}px ${Math.max(44, safeZone.safePaddingPx.right)}px ${Math.max(190, subReservePx)}px ${Math.max(44, safeZone.safePaddingPx.left)}px;
    }
    .k-left-col { width: 100%; align-items: center; text-align: center; }
    .k-right-col { width: 100%; }
    .k-center-stage { padding: ${Math.max(84, safeZone.safePaddingPx.top)}px ${Math.max(44, safeZone.safePaddingPx.right)}px ${Math.max(190, subReservePx)}px ${Math.max(44, safeZone.safePaddingPx.left)}px; gap: 22px; }
    .k-headline { font-size: 58px; }
    .k-headline-lg { font-size: 66px; }
    .k-headline-md { font-size: 50px; }
    .k-headline-sm { font-size: 42px; }
    .k-subline { font-size: 24px; max-width: 100%; }
    .k-card-stage { max-width: 100%; }
    .k-pip-frame { right: 8px; bottom: -18px; width: 38%; }
    .k-mosaic-grid {
      width: ${Math.round(width * 0.88)}px; height: ${Math.round(height * 0.52)}px;
      grid-template-columns: repeat(2, 1fr); grid-template-rows: repeat(3, 1fr); gap: 14px;
    }
    .k-mosaic-overlay { left: 40px; right: 40px; max-width: none; bottom: ${Math.max(180, subReservePx + 8)}px; flex-direction: column; align-items: flex-start; gap: 14px; }
    .k-cnt-num { font-size: 52px; }
    .k-compare-row { flex-direction: column; gap: 20px; }
    .k-cmp-card { max-width: 100%; width: 100%; padding: 28px 24px; }
    .k-cmp-val { font-size: 36px; }
    .k-cmp-bridge { width: 3px; height: 34px; }
    .k-cmp-bridge i { border-top: none; border-left: 3px dashed rgba(255,255,255,0.45); }
    .k-glow-bar { width: ${Math.round(width * 0.65)}px; }
    #sub-wrap { bottom: ${Number(script?.subtitleBottomPx) || safeZone.subtitleBottomPx}px; }
    #sub-pill { max-width: ${Math.round(width * 0.84)}px; font-size: 28px; white-space: normal; }
    ` : width === height ? `
    /* Square 1:1 Adaptation */
    .k-split-grid, .k-split-grid.k-reverse {
      flex-direction: column; justify-content: center; gap: 26px;
      padding: 68px 56px 135px;
    }
    .k-center-stage { padding: 68px 64px 135px; }
    .k-headline { font-size: 62px; }
    .k-headline-lg { font-size: 72px; }
    .k-mosaic-grid { width: ${Math.round(width * 0.88)}px; height: ${Math.round(height * 0.62)}px; }
    #sub-pill { max-width: ${Math.round(width * 0.9)}px; font-size: 27px; }
    ` : ''}

    /* Product Showcase Windows, Focus Camera, Fan Opener, Workflow, A/B Wipe, Dashboard & Trio */
    .k-app-stage {
      position: absolute; inset: 0; z-index: 4;
      padding: ${lp(86)}px ${lp(68)}px ${Math.max(lp(158), subReservePx)}px;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${lp(16)}px;
    }
    .k-fan-stage { gap: ${lp(18)}px; }
    .k-fan-arc { position: relative; width: 100%; height: ${lp(430)}px; display: flex; justify-content: center; align-items: center; }
    .k-fan-card {
      position: absolute; width: ${lp(236)}px; height: ${lp(336)}px; border-radius: ${lp(16)}px; overflow: hidden;
      background: #0A1615; border: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
      box-shadow: 0 ${lp(24)}px ${lp(52)}px rgba(0,0,0,0.72);
    }
    .k-fan-card .k-media-el { width: 100%; height: 100%; object-fit: cover; display: block; }
    .k-fan-badge {
      display: inline-flex; align-items: center; gap: ${lp(12)}px; padding: ${lp(8)}px ${lp(20)}px; border-radius: 999px;
      background: rgba(6,14,14,0.88); border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
      font: 800 ${Math.max(12, lp(16))}px var(--font-mono); color: var(--accent); letter-spacing: 2px;
    }
    .k-brand-mini { width: ${lp(22)}px; height: ${lp(22)}px; border-radius: ${lp(5)}px; object-fit: cover; display: block; }
    .k-app-wide { align-items: center; }
    .k-app-split { flex-direction: row; gap: ${lp(42)}px; align-items: center; }
    .k-app-split .k-split-copy { flex: 0 0 34%; max-width: none; }
    .k-app-head { width: ${width < height ? '100%' : '88%'}; max-width: ${lp(1420)}px; display: flex; align-items: center; justify-content: space-between; gap: ${lp(16)}px; }
    .k-app-head-l { display: flex; align-items: center; gap: ${lp(14)}px; }
    .k-tag-chip {
      padding: ${lp(5)}px ${lp(14)}px; border-radius: 999px;
      background: rgba(var(--rgbAccent), 0.16); border: 1px solid var(--accent);
      font: 800 ${Math.max(11, lp(15))}px var(--font-mono); color: var(--accent);
    }
    .k-tag-gold { background: rgba(var(--rgbGold), 0.16); border-color: var(--gold); color: var(--gold); }
    .k-app-head-title { font: 900 ${Math.max(18, lp(30))}px var(--font-sans); color: var(--text); }
    .k-app-head-sub { font: 700 ${Math.max(13, lp(18))}px var(--font-sans); color: var(--gold); }
    .k-app-win-wrap {
      position: relative; flex: 1; width: ${width < height ? '100%' : '88%'}; max-width: ${lp(1420)}px;
      min-height: 0; height: 100%; display: flex; align-items: center; justify-content: center;
    }
    .k-app-split .k-app-win-wrap { width: auto; }
    .k-app-win {
      width: 100%; height: 100%; max-width: 100%; max-height: 100%; display: flex; flex-direction: column;
      border-radius: ${lp(18)}px; overflow: hidden; background: #0B1514;
      border: 1.5px solid color-mix(in srgb, var(--accent) 42%, transparent);
      box-shadow: 0 ${lp(30)}px ${lp(78)}px rgba(0,0,0,0.68);
    }
    .k-app-win.k-win-light, .k-trio-win.k-win-light { background: #F8FAFC; }
    .k-app-win.k-win-light .k-app-bar, .k-trio-win.k-win-light .k-app-bar { background: rgba(226,232,240,0.95); border-bottom-color: rgba(15,23,42,0.12); }
    .k-app-win.k-win-light .k-app-title, .k-trio-win.k-win-light .k-app-title { color: #0F172A; }
    .k-app-win.k-win-light .k-app-view, .k-trio-win.k-win-light .k-app-view { background: #FFFFFF; }
    .k-app-bar {
      height: ${lp(38)}px; padding: 0 ${lp(16)}px; display: flex; align-items: center; gap: ${lp(10)}px; flex-shrink: 0;
      background: rgba(13,26,25,0.96); border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .k-app-dots { display: flex; gap: ${lp(6)}px; }
    .k-app-dots i { width: ${lp(10)}px; height: ${lp(10)}px; border-radius: 50%; display: block; }
    .k-app-dots i:nth-child(1) { background: #FF5F56; }
    .k-app-dots i:nth-child(2) { background: #FFBD2E; }
    .k-app-dots i:nth-child(3) { background: #27C93F; }
    .k-app-title { font: 700 ${Math.max(11, lp(14))}px var(--font-sans); color: #E2E8F0; }
    .k-app-kicker {
      margin-left: auto; padding: ${lp(3)}px ${lp(10)}px; border-radius: 999px;
      background: rgba(255,255,255,0.06); font: 700 ${Math.max(10, lp(12))}px var(--font-mono); color: var(--gold);
    }
    .k-app-view { position: relative; flex: 1; overflow: hidden; background: #07100F; min-height: 0; display: flex; align-items: center; justify-content: center; }
    .k-cam-stage { position: relative; width: 100%; height: 100%; transform-origin: 0 0; }
    .k-cam-stage .k-media-el, .k-app-view > .k-media-el, .k-wipe-a .k-media-el, .k-wipe-b .k-media-el { width: 100%; height: 100%; object-fit: contain; display: block; }
    .k-cam-stage.is-aspect-fitted .k-media-el { object-fit: fill; }
    .k-mark-box {
      position: absolute; border-radius: ${lp(12)}px; border: 2.5px solid var(--accent);
      box-shadow: 0 0 0 4px rgba(0,0,0,0.38), 0 0 ${lp(24)}px var(--accent);
      pointer-events: none; z-index: 10; opacity: 0;
    }
    .k-mark-box.k-mark-ring { border-radius: 999px; }
    .k-mark-box.k-mark-gold { border-color: var(--gold); box-shadow: 0 0 0 4px rgba(0,0,0,0.38), 0 0 ${lp(24)}px var(--gold); }
    .k-mark-chip {
      position: absolute; left: 50%; bottom: calc(100% + ${lp(8)}px); transform: translateX(-50%);
      padding: ${lp(4)}px ${lp(12)}px; border-radius: 999px; white-space: nowrap;
      background: rgba(6,14,14,0.94); border: 1.5px solid var(--accent);
      font: 800 ${Math.max(12, lp(16))}px var(--font-sans); color: #F8FAFC;
      box-shadow: 0 8px 20px rgba(0,0,0,0.6);
    }
    .k-mark-box.k-mark-gold .k-mark-chip { border-color: var(--gold); }
    .k-mark-chip.k-mark-below { bottom: auto; top: calc(100% + ${lp(8)}px); }
    .k-loupe-ring {
      position: absolute; right: ${lp(22)}px; bottom: ${lp(22)}px; width: ${lp(220)}px; height: ${lp(220)}px;
      border-radius: 50%; overflow: hidden; border: 3.5px solid var(--gold);
      box-shadow: 0 ${lp(20)}px ${lp(48)}px rgba(0,0,0,0.8); background: #07100F; z-index: 18;
    }
    .k-loupe-ring.k-loupe-left { right: auto; left: ${lp(22)}px; }
    .k-loupe-cam { position: absolute; left: 0; top: 0; width: 100%; height: 100%; transform-origin: 0 0; }
    .k-loupe-cam .k-media-el { width: 100%; height: 100%; object-fit: contain; display: block; }
    .k-loupe-cam.is-aspect-fitted .k-media-el { object-fit: fill; }
    .k-loupe-tag {
      position: absolute; bottom: ${lp(16)}px; left: 50%; transform: translateX(-50%); max-width: 84%;
      padding: ${lp(3)}px ${lp(10)}px; border-radius: 999px; background: rgba(6,14,14,0.94);
      border: 1px solid var(--gold); color: #FFF; font: 800 ${Math.max(11, lp(12))}px var(--font-sans);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .k-wf-stage { justify-content: space-between; }
    .k-wf-head { text-align: center; display: flex; flex-direction: column; align-items: center; gap: ${lp(8)}px; }
    .k-wf-row { display: flex; gap: ${lp(18)}px; width: 100%; flex: 1; min-height: 0; align-items: stretch; }
    .k-wf-card {
      flex: 1; border-radius: ${lp(18)}px; overflow: hidden; background: rgba(9,19,18,0.88);
      border: 2px solid rgba(255,255,255,0.14); display: flex; flex-direction: column;
      box-shadow: 0 ${lp(14)}px ${lp(36)}px rgba(0,0,0,0.48);
    }
    .k-wf-top { padding: ${lp(12)}px ${lp(16)}px; border-bottom: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center; font: 900 ${Math.max(13, lp(17))}px var(--font-mono); color: var(--accent); }
    .k-wf-dot { width: ${lp(9)}px; height: ${lp(9)}px; border-radius: 50%; background: rgba(255,255,255,0.2); display: block; }
    .k-wf-media { flex: 1; position: relative; background: #07100F; min-height: 0; }
    .k-wf-media .k-media-el { width: 100%; height: 100%; object-fit: contain; display: block; }
    .k-wf-info { padding: ${lp(14)}px ${lp(16)}px; }
    .k-wf-title { font: 800 ${Math.max(15, lp(21))}px var(--font-sans); color: #F8FAFC; }
    .k-wf-desc { font: 500 ${Math.max(12, lp(14))}px var(--font-sans); color: var(--sub); margin-top: ${lp(4)}px; }
    .k-wipe-a, .k-wipe-b { position: absolute; inset: 0; }
    .k-wipe-line { position: absolute; top: 0; bottom: 0; left: 50%; width: 3px; background: linear-gradient(180deg, var(--accent), var(--gold)); box-shadow: 0 0 18px var(--accent); transform: translateX(-1.5px); z-index: 8; }
    .k-wipe-knob {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); width: ${lp(36)}px; height: ${lp(36)}px;
      border-radius: 50%; background: #081312; border: 2px solid var(--gold); color: #FFF;
      display: flex; align-items: center; justify-content: center; font: 900 ${Math.max(11, lp(13))}px var(--font-mono);
    }
    .k-wipe-tag { position: absolute; top: ${lp(16)}px; padding: ${lp(5)}px ${lp(14)}px; border-radius: 999px; background: rgba(6,14,14,0.9); font: 800 ${Math.max(12, lp(15))}px var(--font-sans); z-index: 10; }
    .k-wipe-tag-l { left: ${lp(16)}px; border: 1px solid var(--accent); color: var(--accent); }
    .k-wipe-tag-r { right: ${lp(16)}px; border: 1px solid var(--gold); color: var(--gold); }
    .k-dash-grid { flex-direction: row; gap: ${lp(32)}px; align-items: center; }
    .k-dash-left { flex: 0 0 39%; display: flex; flex-direction: column; gap: ${lp(18)}px; }
    .k-dash-right { flex: 1; width: auto; height: 100%; }
    .k-dash-panel { padding: ${lp(24)}px; border-radius: ${lp(18)}px; background: rgba(10,22,21,0.9); border: 1.5px solid color-mix(in srgb, var(--accent) 32%, transparent); display: flex; flex-direction: column; gap: ${lp(14)}px; }
    .k-dash-panel-top { display: flex; justify-content: space-between; align-items: center; }
    .k-dash-panel-top span { font: 800 ${Math.max(14, lp(19))}px var(--font-sans); color: #E2E8F0; }
    .k-dash-panel-top em { font-style: normal; font: 700 ${Math.max(11, lp(13))}px var(--font-mono); color: var(--gold); }
    .k-dash-num { font: 900 ${Math.max(36, lp(54))}px var(--font-mono); color: var(--accent); line-height: 1.05; }
    .k-dash-bar { height: ${lp(8)}px; border-radius: 99px; background: rgba(255,255,255,0.08); overflow: hidden; }
    .k-dash-bar-fill { height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent), var(--gold)); }
    .k-dash-cells { display: grid; grid-template-columns: repeat(10, 1fr); gap: ${lp(6)}px; }
    .k-dash-cell { height: ${lp(13)}px; border-radius: ${lp(4)}px; background: rgba(255,255,255,0.08); display: block; }
    .k-trio-stage { justify-content: center; gap: ${lp(24)}px; }
    .k-trio-row { display: flex; gap: ${lp(22)}px; width: 100%; ${width < height ? 'flex: 1;' : ''} min-height: 0; align-items: center; justify-content: center; }
    .k-trio-win {
      flex: 1; ${width < height ? 'height: 88%;' : 'aspect-ratio: 16 / 10.6; max-height: 86%;'} display: flex; flex-direction: column; border-radius: ${lp(16)}px; overflow: hidden;
      background: #0B1514; border: 1.5px solid rgba(255,255,255,0.16); box-shadow: 0 ${lp(22)}px ${lp(52)}px rgba(0,0,0,0.62);
    }
    /* Dynamic SVG Architecture & HUD Telemetry Dashboard (Opus 5.5 Vibecoding) */
    .k-arch-panel {
      width: 100%; height: 100%; max-height: ${lp(560)}px; display: flex; flex-direction: column;
      border-radius: ${lp(18)}px; overflow: hidden; background: rgba(7,12,22,0.92);
      border: 1.5px solid color-mix(in srgb, var(--accent) 48%, transparent);
      box-shadow: 0 ${lp(28)}px ${lp(72)}px rgba(0,0,0,0.72);
    }
    .k-arch-body { flex: 1; position: relative; min-height: 0; display: flex; align-items: center; justify-content: center; padding: ${lp(16)}px; }
    .k-arch-svg { width: 100%; height: 100%; display: block; overflow: visible; }
    .k-hud-dashboard {
      width: 100%; height: 100%; max-height: ${lp(560)}px; display: flex; gap: ${lp(24)}px; align-items: stretch;
    }
    .k-hud-code-card {
      flex: 1.08; display: flex; flex-direction: column; border-radius: ${lp(18)}px; overflow: hidden;
      background: rgba(6,10,19,0.94); border: 1.5px solid color-mix(in srgb, var(--accent) 44%, transparent);
      box-shadow: 0 ${lp(26)}px ${lp(68)}px rgba(0,0,0,0.72);
    }
    .k-hud-code-body {
      flex: 1; padding: ${lp(22)}px ${lp(24)}px; display: flex; flex-direction: column; justify-content: center; gap: ${lp(12)}px;
      font: 700 ${Math.max(12, lp(15))}px/1.45 var(--font-mono); color: #E2E8F0;
    }
    .k-hud-code-line {
      display: flex; align-items: center; gap: ${lp(14)}px; padding: ${lp(8)}px ${lp(12)}px; border-radius: ${lp(8)}px;
      background: rgba(15,23,42,0.65); border-left: 3px solid var(--accent);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .k-hud-code-line:nth-child(even) { border-left-color: var(--gold); }
    .k-ln-num { color: var(--gold); font-weight: 800; opacity: 0.85; }
    .k-hud-code-foot {
      padding: ${lp(10)}px ${lp(20)}px; background: rgba(12,20,34,0.95); border-top: 1px solid rgba(255,255,255,0.08);
      display: flex; justify-content: space-between; font: 800 ${Math.max(10, lp(12))}px var(--font-mono); color: var(--accent);
    }
    .k-hud-telemetry-col {
      flex: 1; display: flex; flex-direction: column; gap: ${lp(20)}px; min-width: 0;
    }
    .k-hud-rings-row {
      display: flex; gap: ${lp(16)}px; flex: 1; min-height: 0;
    }
    .k-hud-ring-card {
      flex: 1; border-radius: ${lp(16)}px; padding: ${lp(14)}px; background: rgba(8,14,26,0.92);
      border: 1.5px solid rgba(255,255,255,0.14); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${lp(8)}px;
      box-shadow: 0 ${lp(18)}px ${lp(44)}px rgba(0,0,0,0.55);
    }
    .k-hud-ring-svg { width: ${lp(88)}px; height: ${lp(88)}px; }
    .k-hud-ring-info { text-align: center; }
    .k-hud-ring-val { font: 900 ${Math.max(18, lp(26))}px/1.1 var(--font-mono); color: #F8FAFC; }
    .k-hud-ring-lbl { font: 700 ${Math.max(11, lp(13))}px var(--font-sans); color: var(--sub); margin-top: 2px; }
    .k-hud-wave-card {
      flex: 1.05; border-radius: ${lp(16)}px; padding: ${lp(16)}px ${lp(20)}px; background: rgba(8,14,26,0.92);
      border: 1.5px solid color-mix(in srgb, var(--gold) 38%, transparent); display: flex; flex-direction: column; justify-content: space-between;
      box-shadow: 0 ${lp(18)}px ${lp(44)}px rgba(0,0,0,0.55);
    }
    .k-hud-wave-head { display: flex; justify-content: space-between; align-items: center; font: 800 ${Math.max(10, lp(12))}px var(--font-mono); color: var(--sub); }
    .k-hud-wave-head em { font-style: normal; color: var(--gold); }
    .k-hud-wave-svg { width: 100%; height: ${lp(105)}px; display: block; overflow: visible; }
    #workflow-hud {
      position: absolute; ${width < height ? `top: ${Math.round(height * 0.04)}px;` : `top: ${lp(20)}px;`} left: 50%; transform: translateX(-50%);
      display: none; align-items: center; gap: ${lp(8)}px; padding: ${lp(6)}px ${lp(16)}px; border-radius: 999px;
      background: rgba(8,16,15,0.84); border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
      box-shadow: 0 10px 26px rgba(0,0,0,0.45); z-index: 29; pointer-events: none;
    }
    .k-hud-step { padding: ${lp(3)}px ${lp(10)}px; border-radius: 999px; font: 700 ${Math.max(12, lp(14))}px var(--font-sans); color: #94A3B8; white-space: nowrap; }
    .k-hud-step.is-done { background: rgba(var(--rgbAccent), 0.16); color: var(--accent); }
    .k-hud-step.is-active { background: linear-gradient(90deg, var(--accent), var(--gold)); color: #061211; font-weight: 900; }
    .k-hud-sep { color: rgba(255,255,255,0.22); font-size: ${lp(13)}px; }
    .k-hud-sec { font: 800 ${Math.max(11, lp(13))}px var(--font-mono); color: var(--gold); margin-left: ${lp(6)}px; }
    ${width < height ? `
    .k-app-stage { padding: 100px 36px ${Math.max(220, (Number(script?.subtitleBottomPx) || safeZone.subtitleBottomPx) + 84)}px; }
    .k-app-split, .k-dash-grid, .k-wf-row, .k-trio-row { flex-direction: column; }
    .k-fan-card { width: 170px; height: 245px; }
    ` : ''}
  </style>
</head>
<body>
  <div id="stage">
    <div id="world">
      <canvas id="fxb" class="layer" width="${width}" height="${height}"></canvas>
      <div id="scene-slots"></div>
      <canvas id="fxt" class="layer" width="${width}" height="${height}"></canvas>
    </div>
    <div id="vig" class="layer"></div>
    <canvas id="grain-layer" class="layer" width="${width}" height="${height}"></canvas>
    <div id="glc" class="layer"></div>
    <canvas id="trc" class="layer" width="${width}" height="${height}"></canvas>
    <div id="flash" class="layer"></div>
    <div id="fx-strobe" class="layer"></div>
    <div id="chrome-hud" class="layer">
      <div id="c-tl" class="k-corner"></div>
      <div id="c-tr" class="k-corner"></div>
      <div id="c-bl" class="k-corner"></div>
      <div id="c-br" class="k-corner"></div>
    </div>
    <div id="ai-badge">${escapeHtml(typeof script?.aiBadgeText === 'string' && script.aiBadgeText.trim() ? script.aiBadgeText : typeof script?.aiBadge === 'string' && script.aiBadge.trim() ? script.aiBadge : complianceNotice.badgeText)}</div>
    <div id="workflow-hud"></div>
    <div id="avatar-overlay-wrap"><video id="avatar-overlay-video" muted playsinline preload="auto"></video></div>
    <div id="end-notice-wrap"><div id="end-notice">${escapeHtml(complianceNotice.endNoticeBody)}</div></div>
    <div id="sub-wrap"><div id="sub-pill"></div></div>
    <div id="progress-line"><div id="progress-fill"></div></div>
  </div>

  ${templatesHtml}

  <script>
  (() => {
    const CFG = ${payloadJson};
    const stageEl = document.getElementById('stage');
    const worldEl = document.getElementById('world');
    const slotsEl = document.getElementById('scene-slots');
    const fxb = document.getElementById('fxb').getContext('2d');
    const fxt = document.getElementById('fxt').getContext('2d');
    const trc = document.getElementById('trc').getContext('2d');
    const grainCanvas = document.getElementById('grain-layer');
    const grainCtx = grainCanvas.getContext('2d');
    const glcEl = document.getElementById('glc');
    const flashEl = document.getElementById('flash');
    const subPill = document.getElementById('sub-pill');
    const subWrap = document.getElementById('sub-wrap');
    let subFitBase = null;
    let subFitFonts = '';
    function fitSubtitlePill() {
      if (!subPill || !subWrap) return;
      if (!subFitBase) {
        const cs0 = getComputedStyle(subPill);
        const fs0 = parseFloat(cs0.fontSize) || 40;
        subFitBase = {
          font: fs0,
          white: cs0.whiteSpace,
          lineH: (parseFloat(cs0.lineHeight) || fs0 * 1.28) / fs0,
          padV: (parseFloat(cs0.paddingTop) || 0) + (parseFloat(cs0.paddingBottom) || 0),
          bottom: parseFloat(getComputedStyle(subWrap).bottom) || 0,
        };
      }
      const b = subFitBase;
      const laneW = subWrap.clientWidth - (parseFloat(getComputedStyle(subWrap).paddingLeft) || 0) - (parseFloat(getComputedStyle(subWrap).paddingRight) || 0);
      subPill.style.maxWidth = laneW > 0 ? Math.min(Math.round(CFG.width * 0.9), Math.floor(laneW)) + 'px' : '';
      subPill.style.fontSize = b.font + 'px';
      subPill.style.whiteSpace = b.white;
      subPill.style.removeProperty('text-wrap');
      subWrap.style.bottom = b.bottom + 'px';
      const overflowX = () => subPill.scrollWidth > subPill.clientWidth + 1;
      let font = b.font;
      if (b.white === 'nowrap') {
        if (!overflowX()) return;
        const ratio = subPill.clientWidth / Math.max(1, subPill.scrollWidth);
        if (ratio >= 0.8) {
          font = Math.floor(b.font * ratio * 0.985);
          subPill.style.fontSize = font + 'px';
          if (!overflowX()) return;
        }
        font = Math.round(b.font * 0.86);
        subPill.style.whiteSpace = 'normal';
        subPill.style.setProperty('text-wrap', 'balance');
        subPill.style.fontSize = font + 'px';
      }
      // at most two lines: keep shrinking (down to 62 %) until it fits
      for (let g = 0; g < 10 && subPill.clientHeight - b.padV > font * b.lineH * 2.25 && font > b.font * 0.62; g++) {
        font = Math.round(font * 0.94);
        subPill.style.fontSize = font + 'px';
      }
      const extra = subPill.offsetHeight - (b.font * b.lineH + b.padV);
      if (extra > 1) subWrap.style.bottom = Math.max(Math.round(CFG.height * 0.035), Math.round(b.bottom - extra)) + 'px';
    }
    const progFill = document.getElementById('progress-fill');
    const endNoticeWrap = document.getElementById('end-notice-wrap');

    function fitStage() {
      const s = Math.min(window.innerWidth / CFG.width, window.innerHeight / CFG.height) || 1;
      stageEl.style.transform = 'scale(' + s + ')';
    }
    window.addEventListener('resize', fitStage);
    fitStage();

    // Deterministic Math & Easing Library
    const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
    const lerp = (a, b, x) => a + (b - a) * x;
    const pr = (t, a, b) => clamp((t - a) / Math.max(1e-5, b - a));
    const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
    const noise = (t) => { const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; };
    const EZ = {
      out: (x) => 1 - Math.pow(1 - x, 3),
      out5: (x) => 1 - Math.pow(1 - x, 5),
      expo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
      inout: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
      in: (x) => x * x * x,
      spring: (x) => (x >= 1 ? 1 : 1 - Math.exp(-7 * x) * Math.cos(8.5 * x) * (1 - x * 0.2)),
    };

    function beatPulse(t, onlyStrong = false) {
      let v = 0;
      const beats = CFG.beats || [];
      for (let i = beats.length - 1; i >= 0; i--) {
        const b = beats[i];
        if (b.time > t) continue;
        const dt = t - b.time;
        if (dt > 0.5) break;
        if (onlyStrong && !b.strong) continue;
        v = Math.max(v, Math.exp(-dt * 11) * (b.strong ? 1 : 0.45));
      }
      return v;
    }

    // strong-beat pulse for the beat strobe: beats the photosensitivity budget dropped (noFlash) do not strobe
    function strobeBeatPulse(t) {
      let v = 0;
      const beats = CFG.beats || [];
      for (let i = beats.length - 1; i >= 0; i--) {
        const b = beats[i];
        if (b.time > t) continue;
        const dt = t - b.time;
        if (dt > 0.5) break;
        if (!b.strong || b.noFlash) continue;
        v = Math.max(v, Math.exp(-dt * 11));
      }
      return v;
    }

    function shakeAt(t, t0, dur = 0.35, amp = 14) {
      const x = pr(t, t0, t0 + dur);
      if (x <= 0 || x >= 1) return [0, 0];
      const k = (1 - x) * amp;
      return [k * noise(t * 48), k * noise(t * 48 + 11)];
    }

    // Offscreen 256x256 procedural noise pattern for subtle cinema grain
    const gTile = document.createElement('canvas');
    gTile.width = 256; gTile.height = 256;
    {
      const gx = gTile.getContext('2d');
      const id = gx.createImageData(256, 256);
      for (let i = 0; i < id.data.length; i += 4) {
        const v = Math.floor(hash(i * 0.25) * 255);
        id.data[i] = v; id.data[i + 1] = v; id.data[i + 2] = v; id.data[i + 3] = 28;
      }
      gx.putImageData(id, 0, 0);
    }
    const gPat = grainCtx.createPattern(gTile, 'repeat');

    // Canvas2D & Three.js-Grade 3D Perspective Stage Primitives
    function drawStars(ctx, t, n, alpha, col) {
      for (let i = 0; i < n; i++) {
        const x = ((hash(i * 1.31 + 3) + t * (0.008 + hash(i * 2.1) * 0.015)) % 1) * CFG.width;
        const y = hash(i * 2.77 + 5) * CFG.height;
        const tw = 0.4 + 0.6 * Math.sin(t * (1.8 + hash(i) * 3) + i);
        const r = 1.2 + hash(i * 5.3) * 2.4;
        ctx.fillStyle = 'rgba(' + col + ',' + (alpha * tw).toFixed(3) + ')';
        ctx.fillRect(x, y, r, r);
      }
    }

    function drawThreeCyberStage(ctx, t, sceneIdx, meta, bp) {
      if (String(CFG.visual3dMode || 'auto').toLowerCase() === 'off') return;
      const w = CFG.width;
      const h = CFG.height;
      const cx = w * 0.5;
      const cy = h * 0.48;
      const fovScale = Math.min(w, h) * (0.62 + bp * 0.04);
      const preset = (meta && meta.threePreset) || ['orbital-core', 'cyber-terrain', 'particle-vortex', 'floating-monoliths', 'chrono-helix', 'matrix-cubes'][sceneIdx % 6];
      const rgbA = CFG.rgbAccent || '56, 189, 248';
      const rgbB = CFG.rgbGold || '245, 185, 46';

      const rot3D = (x, y, z, rx, ry, rz) => {
        let y1 = y * Math.cos(rx) - z * Math.sin(rx);
        let z1 = y * Math.sin(rx) + z * Math.cos(rx);
        let x2 = x * Math.cos(ry) + z1 * Math.sin(ry);
        let z2 = -x * Math.sin(ry) + z1 * Math.cos(ry);
        let x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz);
        let y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz);
        return [x3, y3, z2];
      };

      const proj3D = (x, y, z, camZ = 8.2) => {
        const dz = camZ - z;
        if (dz <= 0.25) return null;
        const sc = fovScale / dz;
        return { x: cx + x * sc, y: cy - y * sc, z: dz, sc };
      };

      ctx.save();
      if (preset === 'cyber-terrain') {
        const cols = 20, rows = 14, sx = 0.95, sz = 1.05;
        const zScroll = (t * 2.6) % sz;
        ctx.lineWidth = 1.25;
        for (let rz = 0; rz < rows - 1; rz++) {
          const z0 = 4.2 - rz * sz + zScroll;
          const z1 = 4.2 - (rz + 1) * sz + zScroll;
          const fade = Math.max(0.08, Math.min(0.75, 1 - rz / rows));
          for (let c = 0; c < cols - 1; c++) {
            const x0 = (c - (cols - 1) / 2) * sx;
            const x1 = (c + 1 - (cols - 1) / 2) * sx;
            const cy0 = -1.7 + Math.pow(Math.min(1, Math.abs(x0) / 3.2), 1.6) * 2.1 + Math.sin(x0 * 0.65 + (rz - t * 2.6) * 0.45) * 0.38 + bp * 0.22;
            const cy1 = -1.7 + Math.pow(Math.min(1, Math.abs(x1) / 3.2), 1.6) * 2.1 + Math.sin(x1 * 0.65 + (rz - t * 2.6) * 0.45) * 0.38 + bp * 0.22;
            const cy2 = -1.7 + Math.pow(Math.min(1, Math.abs(x0) / 3.2), 1.6) * 2.1 + Math.sin(x0 * 0.65 + (rz + 1 - t * 2.6) * 0.45) * 0.38;
            const p0 = proj3D(x0, cy0, z0, 8.8);
            const p1 = proj3D(x1, cy1, z0, 8.8);
            const p2 = proj3D(x0, cy2, z1, 8.8);
            if (p0 && p1) {
              ctx.strokeStyle = 'rgba(' + (Math.abs(x0) < 2.1 ? rgbB : rgbA) + ',' + (fade * 0.56).toFixed(3) + ')';
              ctx.beginPath();
              ctx.moveTo(p0.x, p0.y);
              ctx.lineTo(p1.x, p1.y);
              if (p2) ctx.lineTo(p2.x, p2.y);
              ctx.stroke();
            }
          }
        }
      } else if (preset === 'chrono-helix') {
        for (let ti = 0; ti < 10; ti++) {
          const z = ((ti * 2.1 + t * 3.6) % 21) - 14.5;
          const rad = 2.75 + (ti % 2) * 0.3 + bp * 0.22;
          const sides = 8;
          ctx.strokeStyle = 'rgba(' + (ti % 2 === 0 ? rgbA : rgbB) + ',' + clamp((16 - Math.abs(z)) / 18 * 0.68, 0.08, 0.72).toFixed(3) + ')';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          for (let s = 0; s <= sides; s++) {
            const a = (s / sides) * Math.PI * 2 + t * 0.42 + ti * 0.25;
            const pt = proj3D(Math.cos(a) * rad, Math.sin(a) * rad, z, 8.4);
            if (!pt) continue;
            if (s === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          }
          ctx.stroke();
        }
      } else {
        // 3D Polyhedral Wireframe Core + Gyroscope Rings ('orbital-core' / 'particle-vortex' / 'floating-monoliths' / 'matrix-cubes')
        const verts = [
          [0, 1.85, 0], [0, -1.85, 0],
          [1.65, 0, 0], [-1.65, 0, 0],
          [0, 0, 1.65], [0, 0, -1.65],
          [1.1, 1.1, 1.1], [-1.1, 1.1, 1.1], [1.1, -1.1, 1.1], [-1.1, -1.1, 1.1],
          [1.1, 1.1, -1.1], [-1.1, 1.1, -1.1], [1.1, -1.1, -1.1], [-1.1, -1.1, -1.1]
        ];
        const scale = 1 + bp * 0.24 + Math.sin(t * 2.2) * 0.06;
        const pVerts = verts.map(([vx, vy, vz]) => {
          const [rx, ry, rz] = rot3D(vx * scale, vy * scale, vz * scale, t * 0.55, t * 0.78, t * 0.32);
          return proj3D(rx, ry, rz, 8.2);
        });
        ctx.strokeStyle = 'rgba(' + rgbA + ',' + (0.48 + bp * 0.22).toFixed(3) + ')';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < pVerts.length; i++) {
          for (let j = i + 1; j < pVerts.length; j++) {
            if (!pVerts[i] || !pVerts[j]) continue;
            const d0 = Math.hypot(verts[i][0] - verts[j][0], verts[i][1] - verts[j][1], verts[i][2] - verts[j][2]);
            if (d0 < 2.35) {
              ctx.beginPath();
              ctx.moveTo(pVerts[i].x, pVerts[i].y);
              ctx.lineTo(pVerts[j].x, pVerts[j].y);
              ctx.stroke();
            }
          }
        }
        [2.9, 3.85, 4.75].forEach((rad, ri) => {
          ctx.strokeStyle = 'rgba(' + (ri % 2 === 1 ? rgbB : rgbA) + ',0.44)';
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          const segs = 40;
          for (let s = 0; s <= segs; s++) {
            const a = (s / segs) * Math.PI * 2;
            const [rx, ry, rz] = rot3D(
              Math.cos(a) * rad,
              Math.sin(a) * rad,
              0,
              0.92 + ri * 0.5 + t * (ri % 2 === 0 ? 0.4 : -0.35),
              t * (0.28 + ri * 0.14),
              ri * 0.65
            );
            const pt = proj3D(rx, ry, rz, 8.2);
            if (!pt) continue;
            if (s === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          }
          ctx.stroke();
        });
      }
      ctx.restore();
    }

    function drawGlow(ctx, x, y, r, col, a) {
      if (a <= 0.01) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,' + (a * 0.7).toFixed(3) + ')');
      g.addColorStop(0.25, 'rgba(' + col + ',' + (a * 0.6).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      ctx.restore();
    }

    function drawSparks(ctx, t, t0, x, y, col, count = 48, seed = 7) {
      const life = 0.85;
      for (let i = 0; i < count; i++) {
        const age = t - t0 - hash(i * 7.1 + seed) * 0.08;
        const L = life * (0.5 + hash(i * 3.3 + seed) * 0.65);
        if (age <= 0 || age > L) continue;
        const ang = (hash(i * 1.7 + seed) - 0.5) * 6.28;
        const sp = 360 + hash(i * 9.1 + seed) * 880;
        const g = 520;
        const px = x + Math.cos(ang) * sp * age;
        const py = y + Math.sin(ang) * sp * age + 0.5 * g * age * age;
        const vx = Math.cos(ang) * sp;
        const vy = Math.sin(ang) * sp + g * age;
        const tail = Math.hypot(vx, vy) * 0.018;
        const k = 1 - age / L;
        ctx.strokeStyle = 'rgba(' + col + ',' + (k * 0.92).toFixed(3) + ')';
        ctx.lineWidth = 1.4 + k * 1.8;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - (vx / Math.hypot(vx, vy)) * tail, py - (vy / Math.hypot(vx, vy)) * tail);
        ctx.stroke();
      }
    }

    function drawShockRing(ctx, t, t0, cx, cy, maxR, dur, col) {
      const p = pr(t, t0, t0 + dur);
      if (p <= 0 || p >= 1) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(' + col + ',' + (1 - p).toFixed(3) + ')';
      ctx.lineWidth = 3 * (1 + (1 - p) * 2.5);
      ctx.beginPath(); ctx.arc(cx, cy, EZ.out(p) * maxR, 0, 6.2832); ctx.stroke();
      ctx.restore();
    }

    function drawScanSweep(ctx, t, t0, dur, col) {
      const p = pr(t, t0, t0 + dur);
      if (p <= 0 || p >= 1) return;
      const x = lerp(-120, CFG.width + 120, EZ.inout(p));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(x - 240, 0, x, 0);
      g.addColorStop(0, 'rgba(' + col + ',0)');
      g.addColorStop(1, 'rgba(' + col + ',0.38)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 240, 0, 240, CFG.height);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(x, 0, 2, CFG.height);
      ctx.restore();
    }

    function drawRadialLines(ctx, t, cx, cy, intensity, col) {
      if (intensity <= 0.01) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 110; i++) {
        const a = hash(i * 1.3 + 5) * 6.2832;
        const sp = 0.6 + hash(i * 2.9 + 5) * 1.4;
        const ph = (t * sp * 1.5 + hash(i * 7.7)) % 1;
        const r0 = lerp(120, 1280, ph);
        const L = 45 + hash(i * 5.1) * 180;
        ctx.strokeStyle = 'rgba(' + col + ',' + (intensity * (0.16 + 0.45 * hash(i * 3.3)) * Math.sin(Math.PI * ph)).toFixed(3) + ')';
        ctx.lineWidth = 1.2 + hash(i) * 1.6;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * Math.max(0, r0 - L), cy + Math.sin(a) * Math.max(0, r0 - L));
        ctx.stroke();
      }
      ctx.restore();
    }

    // Clone template.scene-template scenes into stage ONCE
    const sceneEls = [];
    document.querySelectorAll('template.scene-template').forEach((tpl, idx) => {
      const frag = tpl.content.cloneNode(true);
      const scEl = frag.querySelector('.k-scene');
      slotsEl.appendChild(frag);
      const meta = CFG.timeline[idx] || {};
      const chEls = [...scEl.querySelectorAll('.k-ch')];
      const bgMedia = scEl.querySelector('.k-bg-media .k-media-el');
      const cardStage = scEl.querySelector('.k-card-stage');
      const macGlint = scEl.querySelector('.k-spec-glint');
      const eyebrow = scEl.querySelector('.k-eyebrow');
      const subline = scEl.querySelector('.k-subline');
      const ruleEl = scEl.querySelector('.k-accent-rule');
      const glowBar = scEl.querySelector('.k-glow-bar');
      const sealEl = scEl.querySelector('.k-stamp-seal');
      const pills = [...scEl.querySelectorAll('.k-pill')];
      const callouts = [...scEl.querySelectorAll('.k-callout')];
      const cards3d = [...scEl.querySelectorAll('.k-3d-card')].map((el, ci) => {
        const ang = hash(ci * 1.37 + 9) * 6.2832;
        const rad = 420 + hash(ci * 5.9 + 9) * 680;
        return {
          el,
          x: Math.cos(ang) * rad * 1.15,
          y: Math.sin(ang) * rad * 0.56,
          z: -1800 + (ci / 16) * 2000,
          rx: (hash(ci * 3.1) - 0.5) * 32,
          ry: (hash(ci * 6.2) - 0.5) * 44,
          rz: (hash(ci * 9.4) - 0.5) * 18,
          sp: 0.7 + hash(ci * 2.9) * 0.55,
        };
      });
      const mosaicCells = [...scEl.querySelectorAll('.k-mosaic-cell')];
      const cntNum = scEl.querySelector('.k-cnt-num');
      const cmpA = scEl.querySelector('.k-cmp-a');
      const cmpB = scEl.querySelector('.k-cmp-b');
      const cmpBridge = scEl.querySelector('.k-cmp-bridge');
      const appWinWrap = scEl.querySelector('.k-app-win-wrap');
      const appWin = scEl.querySelector('.k-app-win');
      const appBar = scEl.querySelector('.k-app-bar');
      const appView = scEl.querySelector('.k-app-view');
      const camStage = scEl.querySelector('.k-cam-stage');
      const markBoxes = [...scEl.querySelectorAll('.k-mark-box')];
      const loupeRing = scEl.querySelector('.k-loupe-ring');
      const loupeCam = scEl.querySelector('.k-loupe-cam');
      const fanCards = [...scEl.querySelectorAll('.k-fan-card')];
      const wfCards = [...scEl.querySelectorAll('.k-wf-card')];
      const wipeB = scEl.querySelector('.k-wipe-b');
      const wipeLine = scEl.querySelector('.k-wipe-line');
      const dashNum = scEl.querySelector('.k-dash-num');
      const dashBarFill = scEl.querySelector('.k-dash-bar-fill');
      const dashCells = [...scEl.querySelectorAll('.k-dash-cell')];
      const trioWins = [...scEl.querySelectorAll('.k-trio-win')];
      const archNodes = [...scEl.querySelectorAll('.k-arch-node')];
      const archPhotons = [...scEl.querySelectorAll('.k-arch-photon')];
      const hudCodeLines = [...scEl.querySelectorAll('.k-hud-code-line')];
      const hudRingArcs = [...scEl.querySelectorAll('.k-hud-ring-arc')];
      const hudRingVals = [...scEl.querySelectorAll('.k-hud-ring-val')];
      const hudWaveDot = scEl.querySelector('.k-hud-wave-dot');
      const videos = [...scEl.querySelectorAll('video')];

      sceneEls.push({
        scEl, meta, chEls, bgMedia, cardStage, macGlint, eyebrow, subline, ruleEl, glowBar, sealEl,
        pills, callouts, cards3d, mosaicCells, cntNum, cmpA, cmpB, cmpBridge,
        appWinWrap, appWin, appBar, appView, camStage, markBoxes, loupeRing, loupeCam, fanCards, wfCards, wipeB, wipeLine, dashNum, dashBarFill, dashCells, trioWins,
        archNodes, archPhotons, hudCodeLines, hudRingArcs, hudRingVals, hudWaveDot,
        videos,
      });
    });

    function drawHudTelemetryOverlay(ctx, f, t, activeIdx, totalScenes, bp) {
      if (String(CFG.visual3dMode || 'auto').toLowerCase() === 'off') return;
      ctx.save();
      const w = CFG.width, h = CFG.height;
      const isPort = w < h;
      const padX = isPort ? 34 : 46;
      const padY = isPort ? 44 : 40;
      const mm = String(Math.floor(t / 60)).padStart(2, '0');
      const ss = String(Math.floor(t % 60)).padStart(2, '0');
      const ff = String(f % Math.max(1, CFG.fps)).padStart(2, '0');
      const tc = 'TC ' + mm + ':' + ss + ':' + ff;
      const scCode = 'SCENE ' + String(activeIdx + 1).padStart(2, '0') + '/' + String(totalScenes).padStart(2, '0');

      // Top-left broadcast telemetry badge
      ctx.font = '700 ' + (isPort ? 12 : 13) + 'px monospace';
      ctx.fillStyle = 'rgba(' + CFG.rgbAccent + ',0.78)';
      ctx.fillText('REMOTION 4.x // THREE.JS 3D // SPRING · ' + tc + ' · ' + scCode, padX + 12, padY + 14);

      // Right-side rotating gyroscope reticle
      if (!isPort) {
        const rx = w - 82, ry = h * 0.5;
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(t * 0.48);
        ctx.strokeStyle = 'rgba(' + CFG.rgbAccent + ',0.32)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 8]);
        ctx.beginPath(); ctx.arc(0, 0, 34 + bp * 6, 0, 6.2832); ctx.stroke();
        ctx.rotate(-t * 0.96);
        ctx.strokeStyle = 'rgba(' + CFG.rgbGold + ',0.38)';
        ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.arc(0, 0, 22, 0, 6.2832); ctx.stroke();
        ctx.restore();
      }

      // Bottom-left 18-bar beat-reactive spectrum equalizer
      const eqX = padX + 10, eqY = h - (isPort ? 52 : 42);
      const bars = 18;
      for (let bi = 0; bi < bars; bi++) {
        const wave = 0.28 + 0.72 * Math.abs(Math.sin(t * 5.8 + bi * 0.55));
        const bh = Math.round((4 + wave * 16) * (1 + bp * 0.55));
        ctx.fillStyle = bi % 3 === 0 ? 'rgba(' + CFG.rgbGold + ',0.68)' : 'rgba(' + CFG.rgbAccent + ',0.62)';
        ctx.fillRect(eqX + bi * 6, eqY - bh, 3.5, bh);
      }
      ctx.restore();
    }

    function animateHeadline(chEls, localT, outT) {
      chEls.forEach((ch, i) => {
        const t0 = 0.08 + i * 0.032;
        const x = pr(localT, t0, t0 + 0.24);
        const exitX = outT != null ? pr(localT, outT + i * 0.01, outT + i * 0.01 + 0.2) : 0;
        const op = clamp(x * 4) * (1 - exitX);
        const s = 1 + (1 - EZ.out5(x)) * 1.35;
        const dy = -EZ.in(exitX) * 40;
        ch.style.opacity = op.toFixed(3);
        ch.style.transform = 'translateY(' + dy.toFixed(1) + 'px) scale(' + s.toFixed(3) + ')';
      });
    }

    function applyKenBurns(el, motion, p) {
      if (!el) return;
      if (motion === 'zoom-out') el.style.transform = 'scale(' + lerp(1.14, 1.0, p).toFixed(4) + ')';
      else if (motion === 'pan-left') el.style.transform = 'scale(1.1) translateX(' + lerp(3.2, -3.2, p).toFixed(2) + '%)';
      else if (motion === 'pan-right') el.style.transform = 'scale(1.1) translateX(' + lerp(-3.2, 3.2, p).toFixed(2) + '%)';
      else el.style.transform = 'scale(' + lerp(1.0, 1.12, p).toFixed(4) + ')';
    }

    function renderTransitions(t) {
      trc.clearRect(0, 0, CFG.width, CFG.height);
      let flashVal = 0;
      let glitchVal = 0;

      for (let i = 1; i < CFG.timeline.length; i++) {
        const sc = CFG.timeline[i];
        const cut = sc.startSec;
        const kind = sc.transition || 'iris-circle';

        if (kind === 'iris-circle') {
          const pre = 0.26, post = 0.36;
          if (t >= cut - pre && t <= cut + post) {
            const R1 = t < cut ? EZ.in(pr(t, cut - pre, cut)) * 1260 : 1320;
            const R2 = t < cut ? 0 : EZ.out(pr(t, cut, cut + post)) * 1340;
            trc.beginPath();
            trc.arc(CFG.width / 2, CFG.height / 2, R1, 0, 6.2832);
            if (R2 > 0) trc.arc(CFG.width / 2, CFG.height / 2, R2, 0, 6.2832, true);
            trc.fillStyle = CFG.accent;
            trc.fill('evenodd');
            if (R1 > 4) {
              trc.lineWidth = 22; trc.strokeStyle = CFG.accent2;
              trc.beginPath(); trc.arc(CFG.width / 2, CFG.height / 2, Math.max(0, R1 - 11), 0, 6.2832); trc.stroke();
            }
          }
        } else if (kind === 'block-wipe') {
          const d = 0.44;
          const x = (t - (cut - d / 2)) / d;
          if (x > 0 && x < 1) {
            const G = 64;
            for (let gy = 0; gy < CFG.height / G + 1; gy++) {
              for (let gx = 0; gx < CFG.width / G + 1; gx++) {
                const cx = gx * G + G / 2, cy = gy * G + G / 2;
                const h = hash(gx * 31 + gy * 17);
                const ramp = (cx / CFG.width) * 0.7 + h * 0.3;
                const s = x < 0.5 ? clamp((x / 0.5) * 1.75 - ramp * 0.75) : 1 - clamp(((x - 0.5) / 0.5) * 1.75 - (1 - ramp) * 0.75);
                if (s < 0.03) continue;
                const q = G * s;
                const colPick = hash(gx * 73 + gy * 41);
                trc.fillStyle = colPick < 0.07 ? CFG.gold : colPick < 0.28 ? CFG.accent : '#080C18';
                trc.fillRect(cx - q / 2, cy - q / 2, q, q);
              }
            }
          }
        } else if (kind === 'light-wipe') {
          const d = 0.36;
          const p = pr(t, cut - d / 2, cut + d / 2);
          if (p > 0 && p < 1) {
            drawScanSweep(trc, t, cut - d / 2, d, CFG.rgbGold);
            if (!sc.noFlashIn) flashVal = Math.max(flashVal, Math.sin(p * Math.PI) * 0.45);
          }
        } else if (kind === 'glitch-cut') {
          const d = 0.28;
          const x = pr(t, cut - d / 2, cut + d / 2);
          if (x > 0 && x < 1) {
            glitchVal = Math.max(glitchVal, Math.sin(x * Math.PI));
            if (!sc.noFlashIn) flashVal = Math.max(flashVal, Math.exp(-Math.abs(t - cut) * 18) * 0.45);
          }
        } else {
          // zoom-punch flash (skipped when the photosensitivity budget dropped it: sc.noFlashIn)
          const dt = t - cut;
          if (!sc.noFlashIn && dt >= -0.02 && dt <= 0.22) {
            flashVal = Math.max(flashVal, Math.exp(-Math.max(0, dt) * 16) * 0.55);
          }
        }
      }

      flashEl.style.opacity = flashVal.toFixed(3);
      if (glitchVal > 0.03) {
        const j = Math.floor(t * 48);
        const dx = glitchVal * 12 * (hash(j) - 0.5);
        worldEl.style.filter = 'drop-shadow(' + dx.toFixed(1) + 'px 0 0 rgba(255,40,70,0.7)) drop-shadow(' + (-dx).toFixed(1) + 'px 0 0 rgba(40,220,255,0.7))';
        glcEl.style.opacity = (glitchVal * 0.85).toFixed(2);
      } else {
        if (worldEl.style.filter) worldEl.style.filter = '';
        glcEl.style.opacity = '0';
      }
    }

    function renderFrameSync(frameNum) {
      const f = Math.max(0, Math.min(CFG.totalFrames - 1, Math.round(frameNum)));
      const t = f / CFG.fps;
      const pct = (f / Math.max(1, CFG.totalFrames - 1)) * 100;
      progFill.style.width = pct.toFixed(2) + '%';

      let activeIdx = 0;
      for (let i = 0; i < CFG.timeline.length; i++) {
        if (f >= CFG.timeline[i].startFrame) activeIdx = i;
      }
      const cur = sceneEls[activeIdx];
      const meta = cur ? cur.meta : CFG.timeline[0];
      const localT = t - meta.startSec;
      const durT = Math.max(1, meta.durSec);
      const p = clamp(localT / durT);

      // Update active DOM classes
      sceneEls.forEach((s, idx) => {
        const isActive = idx === activeIdx;
        if (s.scEl.classList.contains('active') !== isActive) {
          s.scEl.classList.toggle('active', isActive);
        }
      });

      // Global #world keyframe camera rig: directional pan/zoom + beat-locked combat shake + high-frequency strobe flash
      const isHeavyImpact = ['kinetic-impact', 'radial-climax', '3d-stage-opener', 'mosaic-pulse-wall', 'narrative-diorama'].includes(meta.layout) || CFG.narrationMode === 'subtitle-mv';
      const camInt = Number.isFinite(Number(CFG.audioProfile?.cameraBeatIntensity)) ? Number(CFG.audioProfile.cameraBeatIntensity) : (isHeavyImpact ? 0.95 : 0.25);
      const isCombatMeta = /斩|杀|破|战|冲|马|骑|箭|刀|剑|枪|锋|交锋|突袭|决战|单于|匈奴/.test(String(meta.title || '') + ' ' + String(meta.narration || ''));
      const hasActionMeta = Boolean(meta.actionMode);
      const isCleanMeta = meta.actionMode === 'clean';
      const localFrameN = f - (meta.startFrame || 0);
      let clashShock = 0, clashFlashV = 0;
      if (Array.isArray(meta.actionEvents)) {
        for (const ev of meta.actionEvents) {
          const hit = ev.kind === 'metal_clash' || ev.kind === 'metal_clash_hi' || ev.kind === 'metal_clash_heavy' || ev.kind === 'heavy_impact' || ev.kind === 'war_drum';
          if (!hit) continue;
          const age = localFrameN - ev.frame;
          if (age >= 0 && age < 10) {
            const w = ev.intensity * (ev.kind === 'metal_clash_heavy' || ev.kind === 'heavy_impact' ? 1.25 : 1);
            clashShock = Math.max(clashShock, Math.exp(-age * 0.42) * w);
            if (age < 3 && ev.kind !== 'war_drum' && !ev.noFlash) clashFlashV = Math.max(clashFlashV, (age === 0 ? 0.44 : age === 1 ? 0.22 : 0.08) * w);
          }
        }
      }
      const bpStrong = beatPulse(t, true);
      const [shX, shY] = camInt > 0.05 && !isCleanMeta && !hasActionMeta ? shakeAt(t, meta.startSec, isCombatMeta ? 0.42 : 0.28, (isCombatMeta ? 18 : 10) * camInt) : [0, 0];
      const evShakeX = clashShock * Math.sin(localFrameN * 6.9 + activeIdx * 1.7) * 14 * camInt;
      const evShakeY = clashShock * Math.cos(localFrameN * 7.5 + activeIdx * 2.3) * 10 * camInt;
      const beatShakeX = !hasActionMeta && camInt > 0.4 && bpStrong > 0.45 ? Math.sin(t * 78 + activeIdx) * (bpStrong - 0.45) * (isCombatMeta ? 24 : 11) * camInt : evShakeX;
      const beatShakeY = !hasActionMeta && camInt > 0.4 && bpStrong > 0.45 ? Math.cos(t * 86 + activeIdx) * (bpStrong - 0.45) * (isCombatMeta ? 16 : 8) * camInt : evShakeY;
      let kfX = 0, kfY = 0, kfScale = 1, kfRot = 0;
      if (Array.isArray(meta.cameraKeyframes) && meta.cameraKeyframes.length >= 2) {
        const sortedKf = [...meta.cameraKeyframes].sort((a, b) => Number(a.t || 0) - Number(b.t || 0));
        let ka = sortedKf[0], kb = sortedKf[sortedKf.length - 1];
        for (let ki = 0; ki < sortedKf.length - 1; ki++) {
          if (p >= Number(sortedKf[ki].t || 0) && p <= Number(sortedKf[ki + 1].t || 1)) { ka = sortedKf[ki]; kb = sortedKf[ki + 1]; break; }
        }
        const ku = clamp((p - Number(ka.t || 0)) / Math.max(0.001, Number(kb.t || 1) - Number(ka.t || 0)));
        const ke = ku * ku * (3 - 2 * ku);
        kfX = lerp(Number(ka.x || 0), Number(kb.x || 0), ke);
        kfY = lerp(Number(ka.y || 0), Number(kb.y || 0), ke);
        kfScale = lerp(Number(ka.scale ?? 1), Number(kb.scale ?? 1), ke);
        kfRot = lerp(Number(ka.rotate || 0), Number(kb.rotate || 0), ke);
      } else if (camInt > 0.2) {
        const dir = activeIdx % 4;
        kfScale = dir % 2 === 0 ? lerp(1.0, 1.0 + 0.07 * camInt, p) : lerp(1.0 + 0.08 * camInt, 1.0, p);
        kfX = dir === 0 ? lerp(-16 * camInt, 16 * camInt, p) : dir === 1 ? lerp(18 * camInt, -18 * camInt, p) : 0;
        kfY = dir === 2 ? lerp(12 * camInt, -12 * camInt, p) : dir === 3 ? lerp(-12 * camInt, 12 * camInt, p) : 0;
      }
      const punch = camInt > 0.2 && pr(localT, 0, 0.34) < 1 ? (1 - EZ.out(pr(localT, 0, 0.34))) * (isCombatMeta ? 0.12 : 0.06) * camInt : 0;
      const camZoom = Math.max(1, kfScale + bpStrong * (isCombatMeta ? 0.048 : 0.018) * camInt + punch);
      const camRot = kfRot + (isCombatMeta && bpStrong > 0.5 ? Math.sin(t * 64) * 1.1 * camInt : 0);
      worldEl.style.transform = 'translate(' + (kfX + shX + beatShakeX).toFixed(1) + 'px,' + (kfY + shY + beatShakeY).toFixed(1) + 'px) rotate(' + camRot.toFixed(2) + 'deg) scale(' + camZoom.toFixed(4) + ')';
      const strobeEl = document.getElementById('fx-strobe');
      if (strobeEl) {
        // one decaying pulse per cut (a double pulse is two flashes), only when the cut's flash was kept
        const cutStrobe = !isCleanMeta && activeIdx > 0 && camInt >= 0.65 && localT < 0.24 && !hasActionMeta && !meta.noFlashIn ? (localT < 0.07 ? 0.52 : localT < 0.13 ? 0.2 : localT < 0.19 ? 0.08 : 0.03) * camInt : 0;
        const bpStrobe = strobeBeatPulse(t);
        const beatStrobe = !hasActionMeta && isCombatMeta && camInt >= 0.7 && bpStrobe > 0.72 ? (bpStrobe - 0.72) * 1.15 * camInt : 0;
        const stAlpha = Math.min(0.56, Math.max(cutStrobe, beatStrobe, clashFlashV));
        strobeEl.style.background = isCombatMeta ? '#FFE8C2' : '#FFFFFF';
        strobeEl.style.opacity = stAlpha.toFixed(3);
      }

      // Render Background Canvas (#fxb)
      fxb.clearRect(0, 0, CFG.width, CFG.height);
      drawStars(fxb, t, 85, 0.42, CFG.rgbAccent);
      drawThreeCyberStage(fxb, t, activeIdx, meta, beatPulse(t, true));

      // Render Scene Animations
      if (cur) {
        applyKenBurns(cur.bgMedia, meta.kenBurns, p);
        const outT = activeIdx < sceneEls.length - 1 ? durT - 0.35 : null;
        animateHeadline(cur.chEls, localT, outT);

        if (cur.eyebrow) {
          const eIn = EZ.expo(pr(localT, 0.02, 0.32));
          cur.eyebrow.style.opacity = eIn.toFixed(3);
          cur.eyebrow.style.transform = 'translateY(' + ((1 - eIn) * 20).toFixed(1) + 'px)';
        }
        if (cur.subline) {
          const sIn = EZ.expo(pr(localT, 0.35, 0.72));
          cur.subline.style.opacity = sIn.toFixed(3);
          cur.subline.style.transform = 'translateY(' + ((1 - sIn) * 22).toFixed(1) + 'px)';
        }
        if (cur.ruleEl) {
          const rIn = EZ.expo(pr(localT, 0.32, 0.75));
          cur.ruleEl.style.transform = 'scaleX(' + rIn.toFixed(3) + ')';
        }
        if (cur.glowBar) {
          const gIn = EZ.expo(pr(localT, 0.35, 0.85));
          cur.glowBar.style.transform = 'scaleX(' + gIn.toFixed(3) + ')';
        }
        if (cur.sealEl) {
          const sl = pr(localT, 0.65, 0.88);
          cur.sealEl.style.opacity = clamp(sl * 4).toFixed(3);
          cur.sealEl.style.transform = 'scale(' + (1 + (1 - EZ.out5(sl)) * 1.4).toFixed(3) + ') rotate(-5deg)';
        }
        cur.pills.forEach((pill, pi) => {
          const t0 = 0.45 + pi * 0.14;
          const x = pr(localT, t0, t0 + 0.38);
          pill.style.opacity = clamp(x * 4).toFixed(3);
          pill.style.transform = 'scale(' + (0.65 + 0.35 * EZ.spring(x)).toFixed(3) + ')';
        });
        cur.callouts.forEach((c, ci) => {
          const t0 = 0.42 + ci * 0.16;
          const x = EZ.expo(pr(localT, t0, t0 + 0.45));
          c.style.opacity = x.toFixed(3);
          c.style.transform = 'translateX(' + ((1 - x) * 90).toFixed(1) + 'px)';
        });
        if (cur.cardStage) {
          const x = EZ.expo(pr(localT, 0.12, 0.62));
          const rotY = (activeIdx % 2 ? 7 : -7) + Math.sin(localT * 1.1) * 1.8;
          const rotX = 2 + Math.cos(localT * 0.9) * 1.2;
          cur.cardStage.style.opacity = x.toFixed(3);
          cur.cardStage.style.transform =
            'translateY(' + ((1 - x) * 44).toFixed(1) + 'px) rotateY(' + rotY.toFixed(2) + 'deg) rotateX(' + rotX.toFixed(2) + 'deg) scale(' + (0.92 + 0.08 * x).toFixed(4) + ')';
        }
        if (cur.macGlint) {
          const gx = lerp(-120, 120, pr(localT, 0.55, 1.35));
          cur.macGlint.style.transform = 'translateX(' + gx.toFixed(1) + '%)';
          cur.macGlint.style.opacity = pr(localT, 0.55, 0.7) * (1 - pr(localT, 1.2, 1.35));
        }

        // 3D Stage Opener Card Swarm
        cur.cards3d.forEach((c) => {
          let zz = c.z + localT * 520 * c.sp;
          zz = ((zz % 2400) + 2400) % 2400 - 1900;
          const fadeIn = pr(localT, 0, 0.45);
          const near = zz > 260 ? clamp((zz - 260) / 300) : 0;
          const op = clamp((zz + 1900) / 500) * (1 - near) * fadeIn * 0.78;
          c.el.style.opacity = op.toFixed(3);
          c.el.style.transform =
            'translate3d(' + c.x.toFixed(1) + 'px,' + (c.y + Math.sin(localT + c.sp) * 14).toFixed(1) + 'px,' + zz.toFixed(1) + 'px) rotateX(' + c.rx + 'deg) rotateY(' + c.ry + 'deg) translate(-50%,-50%)';
        });

        // Mosaic Pulse Wall
        if (cur.mosaicCells.length > 0) {
          const pulse = beatPulse(t, false);
          const activeBeatGroup = Math.floor(localT * 2.2) % cur.mosaicCells.length;
          cur.mosaicCells.forEach((cell, mi) => {
            const cIn = EZ.spring(pr(localT, 0.06 + mi * 0.07, 0.46 + mi * 0.07));
            const isBeatPop = mi === activeBeatGroup || (mi + 3) % cur.mosaicCells.length === activeBeatGroup;
            const popZ = isBeatPop ? 48 * pulse : 0;
            cell.style.opacity = clamp(cIn * 1.4).toFixed(3);
            cell.style.borderColor = isBeatPop && pulse > 0.2 ? CFG.gold : 'rgba(255,255,255,0.16)';
            cell.style.transform = 'translateZ(' + popZ.toFixed(1) + 'px) scale(' + (0.85 + 0.15 * cIn + (isBeatPop ? pulse * 0.04 : 0)).toFixed(4) + ')';
          });
          if (cur.cntNum) {
            const nVal = Math.round(EZ.out(pr(localT, 0.25, 1.45)) * meta.counterTarget);
            cur.cntNum.textContent = String(nVal).padStart(2, '0') + '+';
          }
        }

        // Compare Dual
        if (cur.cmpA && cur.cmpB) {
          const ax = EZ.expo(pr(localT, 0.22, 0.65));
          const bx = EZ.expo(pr(localT, 0.34, 0.77));
          cur.cmpA.style.opacity = ax.toFixed(3);
          cur.cmpA.style.transform = 'translateX(' + ((1 - ax) * -140).toFixed(1) + 'px)';
          cur.cmpB.style.opacity = bx.toFixed(3);
          cur.cmpB.style.transform = 'translateX(' + ((1 - bx) * 140).toFixed(1) + 'px)';
          if (cur.cmpBridge) cur.cmpBridge.style.transform = 'scaleX(' + EZ.expo(pr(localT, 0.55, 0.9)).toFixed(3) + ')';
        }

        // Card Fan Opener
        if (cur.fanCards && cur.fanCards.length > 0) {
          const isPort = CFG.width < CFG.height;
          const totalC = cur.fanCards.length;
          const mid = (totalC - 1) / 2;
          cur.fanCards.forEach((card, fi) => {
            const rel = fi - mid;
            const sp = EZ.spring(pr(localT, fi * 0.06, fi * 0.06 + 0.45));
            const angle = rel * (isPort ? 7.5 : 9.2) * sp;
            const tx = rel * (isPort ? 74 : 136) * (CFG.width > CFG.height ? Math.min(1.5, CFG.width / 1920) : 1) * sp;
            const ty = Math.abs(rel) * (isPort ? 14 : 20) + (1 - sp) * 60;
            const sc = (1 - Math.abs(rel) * 0.05) * (0.85 + 0.15 * sp);
            card.style.zIndex = String(20 - Math.round(Math.abs(rel) * 3));
            card.style.opacity = clamp(sp * 1.4).toFixed(3);
            card.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) rotate(' + angle.toFixed(2) + 'deg) scale(' + sc.toFixed(4) + ')';
          });
        }

        // FocusShot Normalized Zoom & Pan + Pixel-Locked Hotspots + Aspect-Fitted Window + Magnifier Loupe
        let fittedRatio = 0;
        if (cur.camStage) {
          const stageMedia = cur.camStage.querySelector('.k-media-el');
          const nw = (stageMedia && (stageMedia.naturalWidth || stageMedia.videoWidth)) || Number(cur.camStage.dataset.nw || 0);
          const nh = (stageMedia && (stageMedia.naturalHeight || stageMedia.videoHeight)) || Number(cur.camStage.dataset.nh || 0);
          if (nw > 0 && nh > 0) {
            fittedRatio = nw / nh;
            if (cur.appWinWrap && cur.appWin && cur.appView) {
              const wrapW = cur.appWinWrap.clientWidth || 0;
              const wrapH = cur.appWinWrap.clientHeight || 0;
              const barH = cur.appBar ? cur.appBar.offsetHeight : 38;
              const fitKey = nw + 'x' + nh + ':' + wrapW + 'x' + wrapH;
              if (wrapW > 40 && wrapH > barH + 40 && cur._lastWinFitKey !== fitKey) {
                cur._lastWinFitKey = fitKey;
                const availW = wrapW;
                const availH = Math.max(80, wrapH - barH);
                let imgW = availW;
                let imgH = Math.round(imgW / fittedRatio);
                if (imgH > availH) {
                  imgH = availH;
                  imgW = Math.round(imgH * fittedRatio);
                }
                cur.appWin.style.width = imgW + 'px';
                cur.appWin.style.height = (imgH + barH) + 'px';
                cur.appWin.style.flex = '0 0 auto';
                cur.camStage.style.width = '100%';
                cur.camStage.style.height = '100%';
                cur.camStage.classList.add('is-aspect-fitted');
              }
            } else if (cur.appView) {
              const vw = cur.appView.clientWidth || 0;
              const vh = cur.appView.clientHeight || 0;
              if (vw > 40 && vh > 40) {
                const targetW = (vw / vh > fittedRatio) ? vh * fittedRatio : vw;
                const targetH = (vw / vh > fittedRatio) ? vh : vw / fittedRatio;
                cur.camStage.style.width = Math.round(targetW) + 'px';
                cur.camStage.style.height = Math.round(targetH) + 'px';
                cur.camStage.classList.add('is-aspect-fitted');
              }
            }
          }
          const normCam = (rawKey, idx, totalLen) => {
            const r = rawKey || {};
            const tVal = Number.isFinite(Number(r.t)) ? Number(r.t) : Number.isFinite(Number(r.at)) ? Number(r.at) : idx / Math.max(1, totalLen - 1);
            const fxVal = Number.isFinite(Number(r.fx)) ? Number(r.fx) : Number.isFinite(Number(r.x)) ? Number(r.x) : 0.5;
            const fyVal = Number.isFinite(Number(r.fy)) ? Number(r.fy) : Number.isFinite(Number(r.y)) ? Number(r.y) : 0.5;
            const zVal = Number.isFinite(Number(r.z)) ? Number(r.z) : Number.isFinite(Number(r.s)) ? Number(r.s) : 1.0;
            return { t: tVal, fx: fxVal, fy: fyVal, z: Math.max(0.5, zVal) };
          };
          const rawCams = Array.isArray(meta.cams) && meta.cams.length
            ? meta.cams.map((k, ki) => normCam(k, ki, meta.cams.length))
            : [{ t: 0, fx: 0.5, fy: 0.5, z: 1.0 }, { t: 1, fx: 0.5, fy: 0.5, z: 1.06 }];
          const keys = rawCams.length === 1 ? [rawCams[0], { ...rawCams[0], t: 1 }] : [...rawCams].sort((a, b) => a.t - b.t);
          let fx = keys[0].fx, fy = keys[0].fy, z = keys[0].z;
          for (let ki = 0; ki < keys.length - 1; ki++) {
            const a = keys[ki], b = keys[ki + 1];
            if (p >= a.t && p <= b.t) {
              const u = clamp((p - a.t) / Math.max(0.001, b.t - a.t));
              const e = u * u * (3 - 2 * u);
              fx = lerp(a.fx, b.fx, e); fy = lerp(a.fy, b.fy, e); z = lerp(a.z, b.z, e);
              break;
            }
            if (p > b.t) { fx = b.fx; fy = b.fy; z = b.z; }
          }
          const tx = Math.max(1 - z, Math.min(0, 0.5 - fx * z)) * 100;
          const ty = Math.max(1 - z, Math.min(0, 0.5 - fy * z)) * 100;
          cur.camStage.style.transform = 'translate(' + tx.toFixed(3) + '%,' + ty.toFixed(3) + '%) scale(' + z.toFixed(4) + ')';
        }
        if (cur.markBoxes && cur.markBoxes.length > 0) {
          cur.markBoxes.forEach((mb) => {
            const sf = Number(mb.dataset.start || 6);
            const st = sf / Math.max(1, CFG.fps);
            const mIn = EZ.spring(pr(localT, st, st + 0.35));
            const pulse = 0.72 + 0.28 * Math.sin(Math.max(0, localT - st) * 6.5);
            mb.style.opacity = localT >= st ? (mIn * pulse).toFixed(3) : '0';
            mb.style.transform = 'scale(' + (1.16 - 0.16 * mIn).toFixed(4) + ')';
          });
        }
        if (cur.loupeCam && meta.loupe) {
          const lx = Number(meta.loupe.fx ?? 0.5), ly = Number(meta.loupe.fy ?? 0.5);
          const lz = Number(meta.loupe.z ?? 2.6) + p * 0.2;
          const L = cur.loupeRing ? (cur.loupeRing.clientWidth || 220) : 220;
          if (fittedRatio > 0) {
            const lw = fittedRatio >= 1 ? Math.round(L * fittedRatio) : L;
            const lh = fittedRatio >= 1 ? L : Math.round(L / fittedRatio);
            cur.loupeCam.style.width = lw + 'px';
            cur.loupeCam.style.height = lh + 'px';
            cur.loupeCam.classList.add('is-aspect-fitted');
            const txPx = Math.max(L - lw * lz, Math.min(0, L / 2 - lx * lw * lz));
            const tyPx = Math.max(L - lh * lz, Math.min(0, L / 2 - ly * lh * lz));
            cur.loupeCam.style.transform = 'translate(' + txPx.toFixed(1) + 'px,' + tyPx.toFixed(1) + 'px) scale(' + lz.toFixed(4) + ')';
          } else {
            const ltx = Math.max(1 - lz, Math.min(0, 0.5 - lx * lz)) * 100;
            const lty = Math.max(1 - lz, Math.min(0, 0.5 - ly * lz)) * 100;
            cur.loupeCam.style.transform = 'translate(' + ltx.toFixed(3) + '%,' + lty.toFixed(3) + '%) scale(' + lz.toFixed(4) + ')';
          }
        }

        // Workflow Steps
        if (cur.wfCards && cur.wfCards.length > 0) {
          const activeStep = Math.min(cur.wfCards.length - 1, Math.floor(p * cur.wfCards.length));
          cur.wfCards.forEach((wc, wi) => {
            const sp = EZ.spring(pr(localT, wi * 0.09, wi * 0.09 + 0.4));
            const isAct = wi === activeStep;
            wc.style.opacity = clamp(sp * 1.4).toFixed(3);
            wc.style.transform = 'translateY(' + ((1 - sp) * 32).toFixed(1) + 'px) scale(' + (isAct ? '1.03' : '1.0') + ')';
            wc.style.borderColor = isAct ? CFG.gold : 'rgba(255,255,255,0.14)';
            const dot = wc.querySelector('.k-wf-dot');
            if (dot) dot.style.background = isAct ? CFG.accent : 'rgba(255,255,255,0.2)';
          });
        }

        // Split Wipe Compare
        if (cur.wipeB && cur.wipeLine) {
          const split = 0.5 + 0.34 * Math.sin(p * Math.PI * 2 - Math.PI / 2);
          const pctStr = (split * 100).toFixed(2) + '%';
          cur.wipeB.style.clipPath = 'inset(0 0 0 ' + pctStr + ')';
          cur.wipeLine.style.left = pctStr;
        }

        // Metric Dashboard
        if (cur.dashNum) {
          const targetVal = Number(cur.dashNum.dataset.target || 100);
          const suffixStr = cur.dashNum.dataset.suffix || '';
          const eP = EZ.out(pr(localT, 0.16, Math.min(durT - 0.25, 1.8)));
          const disp = Math.round(targetVal * eP);
          cur.dashNum.textContent = disp.toLocaleString('en-US') + suffixStr;
          if (cur.dashBarFill) cur.dashBarFill.style.width = (eP * 100).toFixed(1) + '%';
          if (cur.dashCells && cur.dashCells.length > 0) {
            const lit = Math.round(eP * cur.dashCells.length);
            cur.dashCells.forEach((cell, ci) => {
              const on = ci < lit;
              cell.style.background = on ? (ci % 4 === 0 ? CFG.gold : CFG.accent) : 'rgba(255,255,255,0.08)';
              cell.style.opacity = on ? '0.94' : '0.45';
            });
          }
        }

        // Multi-Window Trio
        if (cur.trioWins && cur.trioWins.length > 0) {
          const actWin = Math.min(cur.trioWins.length - 1, Math.floor(p * cur.trioWins.length));
          cur.trioWins.forEach((tw, wi) => {
            const isAct = wi === actWin;
            const sp = EZ.spring(pr(localT, wi * 0.08, wi * 0.08 + 0.42));
            tw.style.opacity = (clamp(sp * 1.4) * (isAct ? 1 : 0.84)).toFixed(3);
            tw.style.transform = 'scale(' + ((isAct ? 1.03 : 0.96) * (0.9 + 0.1 * sp)).toFixed(4) + ')';
            tw.style.borderColor = isAct ? CFG.gold : 'rgba(255,255,255,0.16)';
            const b = tw.querySelector('.k-trio-badge');
            if (b) b.textContent = isAct ? 'ACTIVE' : 'VIEW';
          });
        }

        // Dynamic SVG Architecture Topology Nodes & Data Packet Photons
        if (cur.archNodes && cur.archNodes.length > 0) {
          const bp = beatPulse(t, false);
          cur.archNodes.forEach((nd, ni) => {
            const sp = EZ.spring(pr(localT, 0.08 + ni * 0.08, 0.48 + ni * 0.08));
            const pulseSc = 1 + (ni === Math.floor(localT * 2.5) % cur.archNodes.length ? bp * 0.045 : 0);
            nd.style.opacity = clamp(sp * 1.4).toFixed(3);
            nd.style.transform = 'scale(' + ((0.75 + 0.25 * sp) * pulseSc).toFixed(4) + ')';
          });
        }
        if (cur.archPhotons && cur.archPhotons.length > 0) {
          cur.archPhotons.forEach((ph, ei) => {
            const ax = Number(ph.dataset.ax || 150), ay = Number(ph.dataset.ay || 220);
            const bx = Number(ph.dataset.bx || 950), by = Number(ph.dataset.by || 220);
            const u = (localT * 0.85 + ei * 0.21) % 1;
            const mx = (ax + bx) * 0.5;
            const omt = 1 - u;
            const cx = omt * omt * omt * ax + 3 * omt * omt * u * mx + 3 * omt * u * u * mx + u * u * u * bx;
            const cy = omt * omt * omt * ay + 3 * omt * omt * u * ay + 3 * omt * u * u * by + u * u * u * by;
            ph.setAttribute('cx', cx.toFixed(1));
            ph.setAttribute('cy', cy.toFixed(1));
          });
        }

        // Vibecoding HUD Dashboard Code Stream, Ring Gauges & Wave Dot
        if (cur.hudCodeLines && cur.hudCodeLines.length > 0) {
          const actLn = Math.min(cur.hudCodeLines.length - 1, Math.floor(p * cur.hudCodeLines.length));
          cur.hudCodeLines.forEach((ln, li) => {
            const sp = EZ.spring(pr(localT, 0.06 + li * 0.08, 0.42 + li * 0.08));
            const isAct = li === actLn;
            ln.style.opacity = clamp(sp * 1.4).toFixed(3);
            ln.style.transform = 'translateX(' + ((1 - sp) * 36).toFixed(1) + 'px) scale(' + (isAct ? '1.015' : '1.0') + ')';
            ln.style.background = isAct ? 'rgba(56,189,248,0.18)' : 'rgba(15,23,42,0.65)';
          });
        }
        if (cur.hudRingArcs && cur.hudRingArcs.length > 0) {
          const rProg = EZ.out(pr(localT, 0.12, Math.min(durT - 0.2, 1.5)));
          cur.hudRingArcs.forEach((arc) => {
            const pct = Number(arc.dataset.pct || 92);
            const offset = 289 * (1 - (pct / 100) * rProg);
            arc.setAttribute('stroke-dashoffset', offset.toFixed(1));
          });
        }
        if (cur.hudRingVals && cur.hudRingVals.length > 0) {
          const rProg = EZ.out(pr(localT, 0.12, Math.min(durT - 0.2, 1.5)));
          cur.hudRingVals.forEach((el) => {
            const target = Number(el.dataset.target || 96);
            const sfx = el.dataset.suffix || '%';
            el.textContent = Math.round(target * rProg) + sfx;
          });
        }
        if (cur.hudWaveDot) {
          const wx = lerp(40, 540, (localT * 0.45) % 1);
          const wy = 56 + Math.sin(localT * 4.2) * 28;
          cur.hudWaveDot.setAttribute('cx', wx.toFixed(1));
          cur.hudWaveDot.setAttribute('cy', wy.toFixed(1));
        }
      }

      // Update Top Workflow HUD
      const wfHudEl = document.getElementById('workflow-hud');
      if (wfHudEl) {
        const wfSteps = Array.isArray(meta.workflowSteps) ? meta.workflowSteps : [];
        const actStep = Number(meta.hudStep ?? -1);
        if (wfSteps.length > 0 && actStep >= 0) {
          wfHudEl.style.display = 'flex';
          const secCode = String(activeIdx + 1).padStart(2, '0') + ' / ' + String(CFG.timeline.length).padStart(2, '0');
          const key = secCode + ':' + actStep + ':' + wfSteps.join('|');
          if (wfHudEl.dataset.key !== key) {
            wfHudEl.dataset.key = key;
            wfHudEl.innerHTML = wfSteps.map((st, si) => {
              const cls = si === actStep ? 'is-active' : si < actStep ? 'is-done' : '';
              return '<span class="k-hud-step ' + cls + '">' + st + '</span>' + (si < wfSteps.length - 1 ? '<span class="k-hud-sep">›</span>' : '');
            }).join('') + '<span class="k-hud-sec">' + secCode + '</span>';
          }
        } else {
          wfHudEl.style.display = 'none';
        }
      }

      // Render Foreground VFX Canvas (#fxt)
      fxt.clearRect(0, 0, CFG.width, CFG.height);
      drawHudTelemetryOverlay(fxt, f, t, activeIdx, CFG.timeline.length, beatPulse(t, false));
      if (meta.layout === 'radial-climax') {
        drawRadialLines(fxt, t, CFG.width / 2, CFG.height / 2, 0.65, CFG.rgbAccent);
        drawGlow(fxt, CFG.width / 2, CFG.height / 2, 420, CFG.rgbGold, 0.16 + beatPulse(t, true) * 0.1);
      }
      if (localT < 1.0 && ['kinetic-impact', 'radial-climax', '3d-stage-opener', 'mosaic-pulse-wall', 'svg-architecture-flow', 'hud-telemetry-dashboard', 'vibecoding-spring-stage'].includes(meta.layout)) {
        drawShockRing(fxt, localT, 0.04, CFG.width * 0.5, CFG.height * 0.45, Math.min(CFG.width, CFG.height) * 0.78, 0.65, CFG.rgbAccent);
        drawSparks(fxt, localT, 0.1, CFG.width * 0.5, CFG.height * 0.45, CFG.rgbGold, 36, activeIdx + 5);
        drawScanSweep(fxt, localT, 0.35, 0.55, CFG.rgbAccent);
      }

      // Transitions + 24fps Shifted Grain
      renderTransitions(t);
      grainCtx.clearRect(0, 0, CFG.width, CFG.height);
      grainCtx.save();
      const ox = Math.floor(hash(Math.floor(t * 24)) * 256);
      const oy = Math.floor(hash(Math.floor(t * 24) + 7) * 256);
      grainCtx.translate(-ox, -oy);
      grainCtx.fillStyle = gPat;
      grainCtx.fillRect(ox, oy, CFG.width, CFG.height);
      grainCtx.restore();

      // Synchronized Bottom Single-Line Subtitle
      const subs = meta.subtitles || [];
      let activeSub = null;
      for (const sb of subs) {
        if (localT >= Number(sb.startSec || 0) && localT <= Number(sb.endSec || 999)) {
          activeSub = sb;
          break;
        }
      }
      if (!activeSub && subs.length > 0 && localT >= Number(subs[subs.length - 1].startSec || 0)) {
        activeSub = subs[subs.length - 1];
      }
      let txt = '';
      if (activeSub) {
        txt = activeSub.text;
      } else if (subs.length > 0) {
        txt = localT < Number(subs[0].startSec || 0) ? subs[0].text : subs[subs.length - 1].text;
      } else {
        txt = String(meta.narration || '').slice(0, 22);
      }
      if (txt) {
        subPill.style.display = 'block';
        if (subPill.dataset.raw !== txt) {
          subPill.dataset.raw = txt;
          const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const crimsonRx = /(私生子|匈奴|单于|楼兰|斩首|斩杀|斩|杀过去|杀|破阵|血战|血|死|战神|战|陨落|突袭|绝杀|锋芒|交锋|伏击|重围|决战|狂奔|冲锋|最前面|王庭|铁骑)/g;
          const goldRx = /(霍去病|冠军侯|大将军|皇后|汉武帝|卫青|大汉|封狼居胥|饮马瀚海|河西走廊|河西|祁连山|焉支山|丝绸之路|茂陵|长安|汉军|漠北|漠南|秦始皇|项羽|霸王|公元前?\d+年?|前\d+年|\d+[万千百十亿]+[余多]?[人骑里年岁战]?|\d+岁|\d+年|\d+里)/g;
          let htmlTxt = esc(txt)
            .replace(crimsonRx, '<span style="color:#FF3B30;text-shadow:0 0 18px rgba(255,59,48,0.65),0 3px 10px #000">$1</span>')
            .replace(goldRx, '<span style="color:#FFD84D;text-shadow:0 0 18px rgba(255,216,77,0.58),0 3px 10px #000">$1</span>');
          const accents = Array.isArray(meta.accentWords) ? meta.accentWords : [];
          accents.forEach((kw, ki) => {
            const cleanKw = esc(String(kw || '').trim());
            if (cleanKw && !htmlTxt.includes('>' + cleanKw + '<')) {
              const col = ki % 2 === 0 ? '#FFD84D' : '#FF3B30';
              htmlTxt = htmlTxt.split(cleanKw).join('<span style="color:' + col + ';text-shadow:0 0 16px ' + col + '99,0 3px 10px #000">' + cleanKw + '</span>');
            }
          });
          subPill.innerHTML = htmlTxt;
          subFitFonts = '';
        }
        const fontsState = (document.fonts && document.fonts.status) || 'loaded';
        if (subFitFonts !== fontsState) {
          subFitFonts = fontsState;
          fitSubtitlePill();
        }
      } else {
        subPill.style.display = 'none';
      }
      if (endNoticeWrap) {
        const noticeStartSec = Math.max(0, CFG.totalSec - Math.min(2.2, Math.max(1.0, CFG.totalSec * 0.2)));
        const nAlpha = t >= noticeStartSec ? clamp((t - noticeStartSec) / 0.35) : 0;
        endNoticeWrap.style.opacity = nAlpha.toFixed(3);
      }
    }

    const avatarWrap = document.getElementById('avatar-overlay-wrap');
    const avatarVideo = document.getElementById('avatar-overlay-video');
    let loadedAvatarSrc = '';

    // Landscape corner PiP: shift the subtitle lane beside the avatar and scale the scene slots into the free lane.
    let pipLaneKey = '';
    function applyPipLane(layout, isPortrait) {
      const corner = layout === 'pip-br' || layout === 'pip-bl';
      const key = corner && !isPortrait ? layout : 'none';
      if (key === pipLaneKey) return;
      pipLaneKey = key;
      if (key === 'none') {
        if (subWrap) { subWrap.style.paddingLeft = ''; subWrap.style.paddingRight = ''; }
        if (slotsEl) slotsEl.style.transform = '';
        subFitBase = null;
        fitSubtitlePill();
        return;
      }
      const boxW = Math.round(CFG.width * 0.22);
      const reserve = boxW + 42 + 28;
      const onLeft = layout === 'pip-bl';
      if (subWrap) {
        subWrap.style.paddingLeft = onLeft ? reserve + 'px' : '';
        subWrap.style.paddingRight = onLeft ? '' : reserve + 'px';
      }
      if (slotsEl) {
        const k = Math.max(0.7, Math.min(1, (CFG.width - reserve) / CFG.width));
        slotsEl.style.transformOrigin = onLeft ? 'right center' : 'left center';
        slotsEl.style.transform = 'scale(' + k.toFixed(4) + ')';
      }
      subFitBase = null;
      fitSubtitlePill();
    }

    async function syncAvatarOverlay(frameNum) {
      if (!avatarWrap || !avatarVideo) return;
      const item = (CFG.timeline || []).find((s) => frameNum >= s.startFrame && frameNum < s.endFrame) || (CFG.timeline || [])[0];
      const clip = item?.avatarClip?.path ? item.avatarClip : (CFG.avatarClip?.path ? CFG.avatarClip : null);
      const layout = item?.avatarLayout || clip?.layout || CFG.avatarLayout || 'pip-br';
      if (!clip?.path || layout === 'off') {
        avatarWrap.style.display = 'none';
        applyPipLane('off', CFG.width < CFG.height);
        return;
      }
      const cleanRel = String(clip.path).replace(/^\\.?[\\\\/]+/, '').replace(/\\\\/g, '/');
      if (loadedAvatarSrc !== cleanRel) {
        loadedAvatarSrc = cleanRel;
        avatarVideo.src = cleanRel;
        if (avatarVideo.readyState < 1) {
          await new Promise((res) => {
            avatarVideo.onloadedmetadata = res;
            avatarVideo.onerror = res;
            setTimeout(res, 1500);
          });
        }
      }
      const isPortrait = CFG.width < CFG.height;
      avatarWrap.style.display = 'block';
      if (layout === 'fullscreen') {
        avatarWrap.className = 'is-fullscreen';
        avatarWrap.style.left = '0px';
        avatarWrap.style.right = '0px';
        avatarWrap.style.top = '0px';
        avatarWrap.style.bottom = '0px';
        avatarWrap.style.width = '100%';
        avatarWrap.style.height = '100%';
      } else {
        avatarWrap.className = '';
        const boxW = isPortrait ? Math.round(CFG.width * 0.34) : Math.round(CFG.width * 0.22);
        const boxH = Math.round(boxW * 1.125);
        const sidePx = isPortrait ? 28 : 42;
        const bottomPx = isPortrait ? Math.round(CFG.height * 0.25) : 96;
        avatarWrap.style.top = 'auto';
        avatarWrap.style.bottom = bottomPx + 'px';
        avatarWrap.style.width = boxW + 'px';
        avatarWrap.style.height = boxH + 'px';
        avatarWrap.style.left = layout === 'pip-bl' ? sidePx + 'px' : 'auto';
        avatarWrap.style.right = layout === 'pip-bl' ? 'auto' : sidePx + 'px';
      }
      applyPipLane(layout, isPortrait);
      if (avatarVideo.readyState >= 1) {
        const dur = Number.isFinite(avatarVideo.duration) && avatarVideo.duration > 0.2 ? avatarVideo.duration : 10;
        const targetSec = (frameNum / Math.max(1, CFG.fps)) % dur;
        if (Math.abs((avatarVideo.currentTime || 0) - targetSec) > 0.015) {
          await new Promise((resolveSeek) => {
            const done = () => {
              avatarVideo.removeEventListener('seeked', done);
              resolveSeek();
            };
            avatarVideo.addEventListener('seeked', done, { once: true });
            try { avatarVideo.currentTime = Math.max(0, Math.min(dur - 0.04, targetSec)); } catch { done(); }
            setTimeout(done, 120);
          });
        }
      }
    }

    async function seekVideosForActiveScene(frameNum) {
      const f = Math.max(0, Math.min(CFG.totalFrames - 1, Math.round(frameNum)));
      const t = f / CFG.fps;
      let activeIdx = 0;
      for (let i = 0; i < CFG.timeline.length; i++) {
        if (f >= CFG.timeline[i].startFrame) activeIdx = i;
      }
      const cur = sceneEls[activeIdx];
      if (!cur || !cur.videos.length) return;
      const localT = Math.max(0, t - cur.meta.startSec);
      const tasks = cur.videos.map((v) => {
        if (!v || v.readyState < 1) return Promise.resolve();
        const vidDur = Number.isFinite(v.duration) && v.duration > 0.1 ? v.duration : 10;
        const target = localT % vidDur;
        if (Math.abs(v.currentTime - target) < 0.022) return Promise.resolve();
        return new Promise((res) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            v.removeEventListener('seeked', finish);
            res();
          };
          v.addEventListener('seeked', finish);
          try { v.currentTime = target; } catch { finish(); }
          setTimeout(finish, 70);
        });
      });
      await Promise.all(tasks);
    }

    window.__seekToFrame = async (frame) => {
      await seekVideosForActiveScene(frame);
      await syncAvatarOverlay(frame);
      renderFrameSync(frame);
      return frame;
    };

    function fitStageToViewport() {
      const vw = window.innerWidth || CFG.width;
      const vh = window.innerHeight || CFG.height;
      const scale = Math.min(vw / CFG.width, vh / CFG.height);
      stageEl.style.transform = Math.abs(scale - 1) < 0.002 ? '' : 'scale(' + scale.toFixed(4) + ')';
    }
    window.addEventListener('resize', fitStageToViewport);
    fitStageToViewport();

    // Smooth Live Preview Mode (runs when not ?render=1)
    const isRenderMode = new URLSearchParams(location.search).get('render') === '1';
    if (!isRenderMode) {
      let playing = false;
      let curFrame = 0;
      let lastTs = 0;
      const tick = (ts) => {
        if (playing) {
          if (!lastTs) lastTs = ts;
          const dt = (ts - lastTs) / 1000;
          lastTs = ts;
          curFrame += dt * CFG.fps;
          if (curFrame >= CFG.totalFrames) curFrame = 0;
          renderFrameSync(curFrame);
          try { window.parent.postMessage({ type: 'dsh-video-frame', frame: Math.floor(curFrame) }, '*'); } catch {}
        }
        requestAnimationFrame(tick);
      };
      window.addEventListener('message', async (ev) => {
        const d = ev?.data;
        if (!d || typeof d !== 'object') return;
        if (d.type === 'dsh-play') { playing = true; lastTs = 0; }
        else if (d.type === 'dsh-pause') { playing = false; }
        else if (d.type === 'dsh-seek') {
          playing = false;
          curFrame = Number(d.frame) || 0;
          await window.__seekToFrame(curFrame);
        }
      });
      renderFrameSync(0);
      requestAnimationFrame(tick);
    } else {
      renderFrameSync(0);
    }
  })();
  </script>
</body>
</html>`
}
