import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadEnv, REPO_ROOT, resolveEnvPath } from '../packages/shared/index.js'

export function ensureWorkspaceLinks() {
  // All inter-package imports use direct relative ESM paths; remove any stale `@dsh-video` junction folder if desired.
}

function linkSingleRootBundle(profileNmDir) {
  mkdirSync(profileNmDir, { recursive: true })
  const legacyScope = join(profileNmDir, '@dsh-video')
  if (existsSync(legacyScope)) {
    try {
      rmSync(legacyScope, { recursive: true, force: true })
    } catch {}
  }
  const bundleLink = join(profileNmDir, 'dsh-video-workbench')
  try {
    const st = lstatSync(bundleLink)
    if (st.isSymbolicLink()) return
    rmSync(bundleLink, { recursive: true, force: true })
  } catch {}
  try {
    symlinkSync(REPO_ROOT, bundleLink, 'junction')
  } catch {}
}

/**
 * Set up the `video` profile and mount the single self-contained `dsh-video-workbench` bundle
 * into the user's DeepSeek Harness `desktop` profile cleanly without duplicate rows or `workspace:*` links.
 */
export function setupDshVideoProfile() {
  ensureWorkspaceLinks()
  loadEnv()
  const dshHome = resolveEnvPath('DSH_VIDEO_HOME', './.dsh-home')
  const videoProfileDir = join(dshHome, 'profiles', 'video')
  // A second copy of the plugin (a git worktree, a test run, a preview for acceptance) must not re-point the user's DSH
  // `video` profile and desktop mount at itself: DSH_VIDEO_SKIP_PROFILE_MOUNT=1 leaves both untouched.
  if (process.env.DSH_VIDEO_SKIP_PROFILE_MOUNT === '1') {
    return {
      dshHome: resolve(dshHome),
      videoProfileDir,
      profilePatchPath: join(videoProfileDir, 'cordis.patch.yml'),
      desktopMounted: false,
      desktopPatchPath: '',
      desktopPkgPath: '',
      pluginPaths: [],
      skipped: true,
    }
  }
  mkdirSync(videoProfileDir, { recursive: true })

  // Keep standalone `video` runner explicit plugin paths
  const pluginPaths = [
    join(REPO_ROOT, 'packages', 'dsh-preset-video', 'index.js').replace(/\\/g, '/'),
    join(REPO_ROOT, 'packages', 'dsh-web-video-workbench', 'lib', 'index.js').replace(/\\/g, '/'),
  ]

  const patchYml = [
    'plugins:',
    "  - path: '@deepseek-ai/dsh-web-app'",
    ...pluginPaths.map((p) => `  - path: '${p}'`),
    '',
  ].join('\n')

  const profilePatchPath = join(videoProfileDir, 'cordis.patch.yml')
  writeFileSync(profilePatchPath, patchYml, 'utf8')

  const profilePkgPath = join(videoProfileDir, 'package.json')
  if (!existsSync(profilePkgPath)) {
    writeFileSync(
      profilePkgPath,
      JSON.stringify(
        {
          name: 'dsh-profile-video',
          private: true,
          type: 'module',
        },
        null,
        2,
      ) + '\n',
      'utf8',
    )
  }

  // Register root `dsh-video-workbench` as a single DSH 0.2.x client+bundle plugin in `desktop` profile
  let desktopMounted = false
  let desktopPatchPath = ''
  let desktopPkgPath = ''
  try {
    const userDesktopProfile = join(homedir(), '.dsh', 'profiles', 'desktop')
    desktopPatchPath = join(userDesktopProfile, 'cordis.patch.yml')
    desktopPkgPath = join(userDesktopProfile, 'package.json')

    if (existsSync(userDesktopProfile) && existsSync(desktopPkgPath)) {
      // 1. Link single root bundle directory `desktop/node_modules/dsh-video-workbench` -> REPO_ROOT
      linkSingleRootBundle(join(userDesktopProfile, 'node_modules'))

      // 2. Register `dsh-video-workbench` in `desktop/package.json` (`dsh.profile.bundles` + `dependencies`)
      const pkgRaw = readFileSync(desktopPkgPath, 'utf8')
      const pkg = JSON.parse(pkgRaw)
      pkg.dsh = pkg.dsh && typeof pkg.dsh === 'object' ? pkg.dsh : {}
      pkg.dsh.profile = pkg.dsh.profile && typeof pkg.dsh.profile === 'object' ? pkg.dsh.profile : {}
      const bundles = (Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []).filter(
        (b) => b !== '@dsh-video/web-video-workbench' && b !== '@dsh-video/preset-video',
      )
      if (!bundles.includes('dsh-video-workbench')) {
        bundles.push('dsh-video-workbench')
      }
      pkg.dsh.profile.bundles = bundles
      pkg.dependencies = pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {}
      delete pkg.dependencies['@dsh-video/web-video-workbench']
      delete pkg.dependencies['@dsh-video/preset-video']
      pkg.dependencies['dsh-video-workbench'] = `link:${REPO_ROOT.replace(/\\/g, '/')}`

      copyFileSync(desktopPkgPath, `${desktopPkgPath}.bak-video-workbench`)
      writeFileSync(desktopPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')

      // 3. Clean out any legacy raw `- path:` lines inside `cordis.patch.yml` so plugins aren't registered twice,
      //    while strictly preserving any unrelated user config entries.
      if (existsSync(desktopPatchPath)) {
        const lines = readFileSync(desktopPatchPath, 'utf8').split(/\r?\n/)
        const cleaned = []
        let skipEmptyInsert = false
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (/^#\s*(?:>>>|<<<)\s*dsh-video-workbench\b/.test(line.trim())) continue
          if (
            /^\s*-\s+path:/.test(line) &&
            /dsh-tool-local-tts|dsh-tool-avatar|dsh-tool-video-suite|dsh-tool-media|dsh-preset-video|dsh-web-video-workbench|dsh-video-workbench/.test(line)
          ) {
            continue
          }
          if (line.trim() === '- insert:') {
            const nextLine = lines[i + 1] || ''
            if (
              /^\s*-\s+path:/.test(nextLine) &&
              /dsh-tool-local-tts|dsh-tool-avatar|dsh-tool-video-suite|dsh-tool-media|dsh-preset-video|dsh-web-video-workbench|dsh-video-workbench/.test(nextLine)
            ) {
              skipEmptyInsert = true
              continue
            }
          }
          if (skipEmptyInsert && /^\s*-\s+path:/.test(line)) continue
          skipEmptyInsert = false
          cleaned.push(line)
        }
        const nextYml = cleaned.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n')
        copyFileSync(desktopPatchPath, `${desktopPatchPath}.bak-video-workbench`)
        writeFileSync(desktopPatchPath, nextYml, 'utf8')
      }
      desktopMounted = true
    }
  } catch {
    // Ignore if user desktop profile is absent/read-only
  }

  return {
    dshHome: resolve(dshHome),
    videoProfileDir,
    profilePatchPath,
    desktopMounted,
    desktopPatchPath,
    desktopPkgPath,
    pluginPaths,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(join(REPO_ROOT, 'scripts', 'install-profile.mjs'))) {
  const res = setupDshVideoProfile()
  console.log('[setup:profile] Configured DSH `video` profile:', JSON.stringify(res, null, 2))
}
