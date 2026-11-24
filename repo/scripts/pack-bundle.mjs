import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PACKAGE_ROOT } from '../packages/shared/index.js'

const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
if (pkg.private === true) {
  throw new Error('Root package.json must not set "private": true for DSH Market distribution')
}
const depStr = JSON.stringify(pkg.dependencies || {})
if (depStr.includes('workspace:')) {
  throw new Error('Root package.json must not contain workspace:* dependencies')
}

const outDir = resolve(PACKAGE_ROOT, '.tmp', 'release-pack')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const packedNameRaw = execFileSync(
  npmCmd,
  ['pack', '--pack-destination', outDir],
  { cwd: PACKAGE_ROOT, encoding: 'utf8', shell: process.platform === 'win32' },
).trim()
const packedName = packedNameRaw.split(/\r?\n/).filter(Boolean).pop()
const tgzPath = join(outDir, packedName)
if (!existsSync(tgzPath)) {
  throw new Error(`Expected tarball missing: ${tgzPath}`)
}

// list by relative name from the output folder: GNU tar (Git Bash) reads `D:\…` as a remote host and fails
const entries = execFileSync('tar', ['-tf', packedName], { cwd: outDir, encoding: 'utf8' })
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean)

const requiredEntries = [
  'package/index.js',
  'package/package.json',
  'package/cordis.patch.yml',
  'package/bin/dsh-video-mcp.mjs',
  'package/bin/dsh-video-cli.mjs',
  'package/SKILL.md',
  'package/AGENTS.md',
  'package/.mcp.json',
  'package/.claude-plugin/plugin.json',
  'package/docs/install.md',
  'package/packages/web-video-workbench/lib/client.js'.replace('web-video-workbench', 'dsh-web-video-workbench'),
  // war-room skins (棱镜实验室 default) + the shared native panel kit they all load
  'package/packages/dsh-web-video-workbench/lib/warroom/prism-lab.html',
  'package/packages/dsh-web-video-workbench/lib/warroom/nova-deck.html',
  'package/packages/dsh-web-video-workbench/lib/warroom/ink-loom.html',
  'package/packages/dsh-web-video-workbench/lib/warroom/kit.js',
  'package/packages/dsh-web-video-workbench/lib/warroom/kit.css',
  'package/packages/shared/fonts/NotoSansSC-VF.woff2',
  'package/scripts/tts-bridge.py',
  'package/scripts/tts-server.py',
  'package/scripts/install-tts-engine.mjs',
  'package/scripts/install-tts-engine.ps1',
  'package/start-workbench.vbs',
  'package/start-workbench.cmd',
  'package/stop-workbench.cmd',
  'package/packages/dsh-tool-media/cloud-media.js',
  'package/packages/dsh-tool-media/template-plaza.js',
  // v0.6.0 features: style presets, cover studio, plaza community (+ their web routes) and the user guide
  'package/packages/dsh-tool-media/style-presets.js',
  'package/packages/dsh-tool-media/cover-studio.js',
  'package/packages/dsh-tool-media/plaza-community.js',
  'package/packages/dsh-tool-media/plaza-privacy.js',
  'package/packages/dsh-web-video-workbench/lib/routes-cover.js',
  'package/packages/dsh-web-video-workbench/lib/routes-plaza.js',
  'package/docs/plaza-community.md',
  // figure kit (Node side + the TSX library copied into every Remotion project), cast ↔ character bank, visual
  // self-review (keyframes + review prompts), per-shot tool plan / audit, ambience beds and the delivery guards
  'package/packages/dsh-tool-media/figure-kit.js',
  'package/packages/dsh-tool-media/remotion-lib/figure-kit.tsx',
  'package/packages/dsh-tool-media/cast-bank-sync.js',
  'package/packages/dsh-tool-media/visual-review.js',
  'package/packages/dsh-tool-video-suite/scene-keyframes.js',
  'package/packages/dsh-tool-media/scene-tool-plan.js',
  'package/packages/dsh-tool-media/ambience-dsp.js',
  'package/packages/dsh-tool-video-suite/exposure-guard.js',
  'package/packages/dsh-tool-video-suite/true-peak-guard.js',
  'package/LICENSE',
  'package/NOTICE',
  'package/README.md',
]
for (const reqEntry of requiredEntries) {
  if (!entries.includes(reqEntry)) {
    throw new Error(`Missing required file in tarball: ${reqEntry}`)
  }
}

const forbiddenPatterns = [
  /^package\/\.env$/,
  /^package\/node_modules\//,
  /^package\/\.dsh-home\//,
  /^package\/\.tmp\//,
  /\.mp4$/i,
  /\.wav$/i,
]
// The only media allowed in the bundle: the short 影核广场 sample clips (built-in templates, metadata-stripped)
const allowedMediaPatterns = [/^package\/templates\/cinepulse-hub\/[a-z0-9][a-z0-9_-]*\/preview\.mp4$/]
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024
for (const entry of entries) {
  if (allowedMediaPatterns.some((rx) => rx.test(entry))) {
    const local = join(PACKAGE_ROOT, entry.replace(/^package\//, ''))
    if (existsSync(local) && statSync(local).size > MAX_PREVIEW_BYTES) {
      throw new Error(`Template preview clip too large for the bundle (> 4 MB): ${entry}`)
    }
    continue
  }
  for (const rx of forbiddenPatterns) {
    if (rx.test(entry)) {
      throw new Error(`Forbidden runtime/secret file included in tarball: ${entry}`)
    }
  }
}

const sizeMb = (statSync(tgzPath).size / 1024 / 1024).toFixed(2)
console.log(JSON.stringify({ ok: true, name: pkg.name, version: pkg.version, tgzPath, sizeMb: Number(sizeMb), fileCount: entries.length }, null, 2))
