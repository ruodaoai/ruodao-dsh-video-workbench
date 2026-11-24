import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { resolveBinaries, runCommandRedirected } from '../shared/index.js'
import { importAssets, updateAsset } from './asset-manager.js'

function collectFilesRecursive(dir, base = '') {
  const out = []
  if (!existsSync(dir)) return out
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${ent.name}` : ent.name
    const full = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...collectFilesRecursive(full, rel))
    else out.push({ rel, full })
  }
  return out
}

function sanitizeSlug(raw) {
  return String(raw || 'motion-clip')
    .toLowerCase()
    .replace(/[^a-z0-9@._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'motion-clip'
}

/**
 * Copy an external `.motion` / HTML animation template bundle into `<projectDir>/vendor/<name>@<version>/`
 * with SHA-256 integrity manifest and strict isolation from main project source code.
 */
export function registerVendorClip({
  projectDir,
  sourceDir,
  entryHtml = 'index.html',
  name = '',
  version = '1.0.0',
}) {
  const absProj = resolve(projectDir)
  const absSrc = resolve(sourceDir)
  if (!existsSync(absSrc) || !statSync(absSrc).isDirectory()) {
    throw new Error(`第三方动画目录不存在: ${absSrc}`)
  }

  const resolvedEntry = existsSync(join(absSrc, entryHtml))
    ? entryHtml
    : readdirSync(absSrc).find((f) => /\.html?$/i.test(f)) || ''
  if (!resolvedEntry) {
    throw new Error(`目录 ${absSrc} 中未找到 .html 入口文件，无法作为隔离 .motion 模板导入`)
  }

  const slug = sanitizeSlug(name || basename(absSrc))
  const folderName = slug.includes('@') ? slug : `${slug}@${sanitizeSlug(version)}`
  const vendorDest = join(absProj, 'vendor', folderName)
  mkdirSync(vendorDest, { recursive: true })
  cpSync(absSrc, vendorDest, { recursive: true, force: true })

  // If entry wasn't index.html, mirror as index.html cleanly for isolated static server
  if (resolvedEntry.toLowerCase() !== 'index.html' && !existsSync(join(vendorDest, 'index.html'))) {
    cpSync(join(vendorDest, resolvedEntry), join(vendorDest, 'index.html'))
  }

  const files = collectFilesRecursive(vendorDest)
  const h = createHash('sha256')
  for (const f of files.sort((a, b) => a.rel.localeCompare(b.rel))) {
    h.update(f.rel)
    h.update(readFileSync(f.full))
  }
  const bundleSha256 = h.digest('hex').slice(0, 24)

  const manifest = {
    name: slug,
    version,
    folderName,
    entryHtml: resolvedEntry,
    fileCount: files.length,
    bundleSha256,
    importedAt: new Date().toISOString(),
  }
  writeFileSync(join(vendorDest, 'vendor.manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return { ...manifest, vendorDir: vendorDest }
}

/**
 * Render an isolated `vendor/<folder>/` template via headless Chromium,
 * strip all audio (`-an`), normalize H.264 BT.709 specs, and import as a project `video` asset.
 */
export async function renderVendorClipIsolated({
  projectDir,
  sourceDir,
  name = '',
  version = '1.0.0',
  width = 1920,
  height = 1080,
  fps = 30,
  durationSec = 4.0,
}) {
  const absProj = resolve(projectDir)
  const reg = registerVendorClip({ projectDir: absProj, sourceDir, name, version })
  const outAssetsDir = join(absProj, 'assets')
  mkdirSync(outAssetsDir, { recursive: true })

  const safeDur = Math.max(1.0, Math.min(30, Number(durationSec) || 4.0))
  const totalFrames = Math.max(15, Math.round(safeDur * fps))
  const tmpRawMp4 = join(reg.vendorDir, '.raw-render.mp4')
  const cleanClipAbs = join(reg.vendorDir, `vendor-${sanitizeSlug(reg.name)}-${reg.bundleSha256.slice(0, 8)}.mp4`)

  const { resolveBrowserExecutable } = await import('../dsh-tool-video-suite/index.js')
  const { renderHtmlVideoToMp4 } = await import('../dsh-tool-video-suite/frame-renderer.js')
  const browserBin = resolveBrowserExecutable()
  if (!browserBin) {
    throw new Error('未找到 Chromium / Edge 无头浏览器，无法渲染隔离 .motion 动画片段')
  }

  await renderHtmlVideoToMp4({
    projectDir: reg.vendorDir,
    browserBin,
    totalFrames,
    fps,
    width: Number(width) || 1920,
    height: Number(height) || 1080,
    audioPath: '',
    outMp4Path: tmpRawMp4,
    useSegmentCache: false,
  })

  // Force audio stripping (-an) and strict H.264 yuv420p normalization
  const { ffmpeg } = resolveBinaries()
  const stripRes = await runCommandRedirected(
    ffmpeg,
    [
      '-y', '-i', tmpRawMp4,
      '-an',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-r', String(fps),
      '-bf', '0', '-g', String(Math.max(15, fps)), '-video_track_timescale', '90000',
      '-movflags', '+faststart',
      cleanClipAbs,
    ],
    { timeoutMs: 60_000 },
  )
  if (stripRes.code !== 0 || !existsSync(cleanClipAbs)) {
    throw new Error(`隔离动画音轨剥离与标准化失败: ${stripRes.stderr}`)
  }

  const imported = await importAssets({
    projectDir: absProj,
    sources: [cleanClipAbs],
  })
  const addedItem = imported?.added?.[0]
  if (addedItem?.id) {
    updateAsset(absProj, addedItem.id, {
      name: `motion:${reg.folderName}`,
      description: `隔离 .motion 外部动画 (${reg.folderName}, sha256=${reg.bundleSha256.slice(0, 8)})`,
    })
  }

  return {
    ok: true,
    vendorDir: reg.vendorDir,
    bundleSha256: reg.bundleSha256,
    assetPath: addedItem?.path || '',
    absClipPath: addedItem?.path ? join(absProj, addedItem.path) : cleanClipAbs,
    width: Number(width) || 1920,
    height: Number(height) || 1080,
    fps,
    durationSec: safeDur,
    audioStripped: true,
    manifest: reg,
  }
}
