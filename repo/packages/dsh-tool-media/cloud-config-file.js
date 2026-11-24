/**
 * @dsh-video/tool-media — where the BYOK cloud-media config lives (`.dsh-video-cloud-media.json`: the cloud image /
 * video / audio providers and the free stock-library keys for Pexels / Pixabay).
 *
 * Shared by cloud-media.js (owner of the config: load / save / masked summary) and stock-media.js (reads the saved stock
 * keys), so neither module has to import the other. `DSH_VIDEO_CLOUD_MEDIA_CONFIG` (absolute path, or relative to the
 * writable workspace root) points tests at a scratch file; the default location is unchanged.
 */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { loadEnv, REPO_ROOT } from '../shared/index.js'

export const CLOUD_MEDIA_CONFIG_FILENAME = '.dsh-video-cloud-media.json'

export function getCloudMediaConfigPath() {
  loadEnv()
  const override = String(process.env.DSH_VIDEO_CLOUD_MEDIA_CONFIG || '').trim()
  if (override) return isAbsolute(override) ? override : resolve(REPO_ROOT, override)
  return join(REPO_ROOT, CLOUD_MEDIA_CONFIG_FILENAME)
}

/** The parsed config file, or null when it is missing / unreadable. */
export function readCloudMediaConfigFile() {
  const p = getCloudMediaConfigPath()
  if (!existsSync(p)) return null
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}
