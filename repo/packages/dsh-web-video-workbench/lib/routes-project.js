/**
 * Project safety REST routes for the Web Studio (UI wiring comes later). Every route takes `projectDir`
 * (POST body or GET query) and answers `{ ok: true, ... }` or `{ ok: false, error }` (Chinese messages).
 *
 * Version history
 *   GET  /api/video-workbench/project/history            ?projectDir&limit
 *   POST /api/video-workbench/project/history/diff       { projectDir, fromVersionId, toVersionId? = 'current' }
 *   POST /api/video-workbench/project/history/restore    { projectDir, versionId }
 *   POST /api/video-workbench/project/history/snapshot   { projectDir, label?, note? }
 *   POST /api/video-workbench/project/history/prune      { projectDir, max? }
 * Human edit protection
 *   GET  /api/video-workbench/project/scene-edits        ?projectDir  (locks, overrides, last merge report)
 *   POST /api/video-workbench/project/scene-lock         { projectDir, sceneId? | sceneIds?, locked = true, reason? }
 *   POST /api/video-workbench/project/scene-overrides    { projectDir, sceneId, overrides?, clearFields?, clearAll? }
 *   POST /api/video-workbench/project/scene-overrides/batch { projectDir, edits: { sceneId: { field: value } } } | { projectDir, clear: true, sceneIds? }
 * Character bank
 *   GET  /api/video-workbench/project/characters         ?projectDir&scope=all|project|global
 *   POST /api/video-workbench/project/characters/save    { projectDir?, scope?, character }
 *   POST /api/video-workbench/project/characters/delete  { projectDir?, scope?, characterId? | name? }
 *   POST /api/video-workbench/project/characters/attach  { projectDir, characterId? | name?, referenceType?, paths?, sceneIds? }
 * Free stock media (official Pexels / Pixabay APIs)
 *   POST /api/video-workbench/project/stock/search       { query, mediaType?, provider?, orientation?, minWidth?, ... }
 *   POST /api/video-workbench/project/stock/import       { projectDir, item? | provider + mediaType + id, sceneId?, query? }
 * Paid cloud jobs
 *   GET  /api/video-workbench/project/cloud-jobs         ?projectDir&status&limit  (&plan=1 adds the B-roll sourcing plan)
 * 指哪改哪 targeted refine
 *   POST /api/video-workbench/project/refine             { projectDir, instruction, sceneId?, sceneIds?, timeRange?, region?,
 *                                                          dryRun?, render?, async? }  (dryRun → mapping preview, no LLM call)
 */
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { readScriptJson } from '../../shared/index.js'
import { refineAiScene, restoreAiProjectVersion } from '../../dsh-tool-media/ai-coder.js'
import { listCloudJobs, resolveMediaSourcingPlan } from '../../dsh-tool-media/cloud-media.js'
import { attachCharacter, deleteCharacter, listCharacters, saveCharacter } from '../../dsh-tool-media/character-bank.js'
import {
  createProjectSnapshot,
  diffProjectVersions,
  listProjectVersions,
  pruneProjectHistory,
} from '../../dsh-tool-media/project-history.js'
import { clearSceneOverrides, listSceneEdits, recordSceneOverrides, setSceneLock, setSceneOverrides } from '../../dsh-tool-media/scene-locks.js'
import { importStockMedia, searchStockMedia } from '../../dsh-tool-media/stock-media.js'

const P = '/api/video-workbench/project'

export const PROJECT_ROUTES = Object.freeze([
  { path: `${P}/history`, methods: ['GET'] },
  { path: `${P}/history/diff`, methods: ['POST'] },
  { path: `${P}/history/restore`, methods: ['POST'] },
  { path: `${P}/history/snapshot`, methods: ['POST'] },
  { path: `${P}/history/prune`, methods: ['POST'] },
  { path: `${P}/scene-edits`, methods: ['GET'] },
  { path: `${P}/scene-lock`, methods: ['POST'] },
  { path: `${P}/scene-overrides`, methods: ['POST'] },
  { path: `${P}/characters`, methods: ['GET'] },
  { path: `${P}/characters/save`, methods: ['POST'] },
  { path: `${P}/characters/delete`, methods: ['POST'] },
  { path: `${P}/characters/attach`, methods: ['POST'] },
  { path: `${P}/stock/search`, methods: ['POST'] },
  { path: `${P}/stock/import`, methods: ['POST'] },
  { path: `${P}/cloud-jobs`, methods: ['GET'] },
  { path: `${P}/refine`, methods: ['POST'] },
  { path: `${P}/scene-overrides/batch`, methods: ['POST'] },
])

const METHODS_BY_PATH = new Map(PROJECT_ROUTES.map((r) => [r.path, r.methods]))

export function isProjectRoute(pathname) {
  return METHODS_BY_PATH.has(pathname)
}

class ProjectRouteError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

/**
 * HTTP status for an error thrown by a route or a project module. Module errors that mark themselves as client-input
 * errors (`expose: true` + a 4xx `status`, e.g. unknown version / scene / character, protected override field, missing
 * reference file — see project-history.js, scene-locks.js, character-bank.js, region-refine.js) keep that status;
 * anything else is an unexpected server error (500).
 */
function errorStatus(err) {
  if (err instanceof ProjectRouteError) return err.status
  const status = Number(err?.status)
  return err?.expose === true && Number.isInteger(status) && status >= 400 && status < 500 ? status : 500
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

async function readBody(req) {
  let body
  try {
    body = await req.json()
  } catch {
    return {}
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {}
}

/**
 * Resolve a caller-supplied project directory: absolute path to an existing project folder (containing script.json).
 */
function resolveProjectDir(raw, { required = true } = {}) {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) {
    if (required) throw new ProjectRouteError('缺少 projectDir（视频工程目录）')
    return ''
  }
  if (s.length > 1024 || s.includes('\0')) throw new ProjectRouteError('projectDir 无效')
  if (!isAbsolute(s)) throw new ProjectRouteError('projectDir 必须是绝对路径')
  const abs = resolve(s)
  let st = null
  try {
    st = statSync(abs)
  } catch {}
  if (!st?.isDirectory()) throw new ProjectRouteError(`视频工程目录不存在: ${abs}`, 404)
  if (!existsSync(resolve(abs, 'script.json'))) throw new ProjectRouteError(`该目录不是视频工程（缺少 script.json）: ${abs}`, 404)
  return abs
}

const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function strList(v, max = 200) {
  const arr = Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : []
  return arr
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim().slice(0, 400))
    .slice(0, max)
}

function intOr(v, dflt, lo, hi) {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt
}

function numberOrUndef(v) {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function scopeOf(v, dflt) {
  const s = str(v)
  return ['project', 'global', 'all'].includes(s) ? s : dflt
}

function parseTimeRange(v) {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'object' || Array.isArray(v)) throw new ProjectRouteError('timeRange 需为 { startSec, endSec } 对象（单位：秒）')
  const startSec = Number(v.startSec)
  const endSec = Number(v.endSec)
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) throw new ProjectRouteError('timeRange.startSec / endSec 必须是数字（单位：秒）')
  return { startSec, endSec }
}

function parseRegion(v) {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'object' || Array.isArray(v)) throw new ProjectRouteError('region 需为 { x, y, w, h } 对象（归一化 0–1）')
  const out = {}
  for (const k of ['x', 'y', 'w', 'h']) {
    const n = Number(v[k])
    if (!Number.isFinite(n)) throw new ProjectRouteError(`region.${k} 必须是数字（归一化 0–1）`)
    out[k] = n
  }
  if (typeof v.unit === 'string' && v.unit.trim()) out.unit = v.unit.trim().slice(0, 16)
  return out
}

function requireMethod(req, pathname) {
  const allowed = METHODS_BY_PATH.get(pathname) || []
  if (!allowed.includes(req.method)) throw new ProjectRouteError(`仅支持 ${allowed.join(' / ')}`, 405)
}

/**
 * Returns a Response for the project routes, or null when the path is not one of them.
 * @param {Request} req
 * @param {URL} [url]
 * @param {{ createBackgroundJob?: (message: string, runner: (onProgress: Function) => Promise<any>) => { id: string } }} [opts]
 */
export async function handleProjectApiRequest(req, url = new URL(req.url, 'http://localhost'), opts = {}) {
  const pathname = url.pathname
  if (!isProjectRoute(pathname)) return null
  const q = url.searchParams
  try {
    requireMethod(req, pathname)

    // ------------------------------------------------------------------ version history
    if (pathname === `${P}/history`) {
      const projectDir = resolveProjectDir(q.get('projectDir'))
      return json(listProjectVersions(projectDir, { limit: intOr(q.get('limit'), 100, 1, 500) }))
    }
    if (pathname === `${P}/history/diff`) {
      const body = await readBody(req)
      const projectDir = resolveProjectDir(body.projectDir)
      const fromVersionId = str(body.fromVersionId || body.versionId, 120)
      if (!fromVersionId) throw new ProjectRouteError('缺少 fromVersionId（要对比的历史版本）')
      return json(diffProjectVersions(projectDir, fromVersionId, str(body.toVersionId, 120) || 'current'))
    }
    if (pathname === `${P}/history/restore`) {
      const body = await readBody(req)
      const projectDir = resolveProjectDir(body.projectDir)
      const versionId = str(body.versionId, 120)
      if (!versionId) throw new ProjectRouteError('缺少 versionId（要恢复的历史版本）')
      const { script, ...res } = restoreAiProjectVersion(projectDir, versionId)
      return json({
        ...res,
        sceneCount: Array.isArray(script?.scenes) ? script.scenes.length : 0,
        message: `已恢复到版本 ${versionId}（恢复前的状态已自动备份为 ${res.beforeRestoreVersion?.id || '最新版本'}）`,
      })
    }
    if (pathname === `${P}/history/snapshot`) {
      const body = await readBody(req)
      const projectDir = resolveProjectDir(body.projectDir)
      const version = createProjectSnapshot(projectDir, {
        label: str(body.label, 80) || 'manual',
        stage: 'manual',
        author: 'user',
        kind: 'manual',
        note: str(body.note, 300),
      })
      if (!version) throw new ProjectRouteError('工程中没有可快照的文件')
      return json({ ok: true, version, message: version.deduped ? '当前状态与最新版本一致，未重复保存' : `已保存版本 ${version.id}` })
    }
    if (pathname === `${P}/history/prune`) {
      const body = await readBody(req)
      const projectDir = resolveProjectDir(body.projectDir)
      const max = body.max === undefined || body.max === null || body.max === '' ? undefined : intOr(body.max, undefined, 2, 1000)
      return json(pruneProjectHistory(projectDir, { max }))
    }

    // ------------------------------------------------------------------ human edit protection
    if (pathname === `${P}/scene-edits`) {
      const projectDir = resolveProjectDir(q.get('projectDir'))
      return json(listSceneEdits(projectDir))
    }
    if (pathname === `${P}/scene-lock`) {
      const body = await readBody(req)
      const projectDir = resolveProjectDir(body.projectDir)
      const sceneIds = [...new Set([str(body.sceneId, 120), ...strList(body.sceneIds)].filter(Boolean))]
      if (sceneIds.length === 0) throw new ProjectRouteError('请指定要锁定/解锁的 sceneId 或 sceneIds')
      const res = setSceneLock({ projectDir, sceneIds, locked: body.locked !== false, reason: str(body.reason, 200) })
      return json(res.ok ? res : { ...res, error: res.message }, res.ok ? 200 : 404)
    }
    if (pathname === `${P}/scene-overrides/batch`) {
      const body = await readBody(req)
      const projectDir = resolveProjectDir(body.projectDir)
      if (body.clear === true) {
        return json(clearSceneOverrides({ projectDir, sceneIds: strList(body.sceneIds) }))
      }
      if (!body.edits || typeof body.edits !== 'object' || Array.isArray(body.edits)) {
        throw new ProjectRouteError('edits 需为 { sceneId: { 字段: 值 } } 对象（或传 clear: true 清除人工改动保护）')
      }
      const sceneCount = Object.keys(body.edits).length
      if (sceneCount > 400) throw new ProjectRouteError('一次最多提交 400 个场景的人工修改')
      return json(recordSceneOverrides({ projectDir, edits: body.edits }))
    }
    if (pathname === `${P}/scene-overrides`) {
      const body = await readBody(req)
      const projectDir = resolveProjectDir(body.projectDir)
      const sceneId = str(body.sceneId, 120)
      if (!sceneId) throw new ProjectRouteError('缺少 sceneId（项目级字段请使用 "__project__"）')
      if (body.overrides !== undefined && (typeof body.overrides !== 'object' || body.overrides === null || Array.isArray(body.overrides))) {
        throw new ProjectRouteError('overrides 需为 { 字段: 值 } 对象')
      }
      const clearFields = strList(body.clearFields || body.fields)
      const clearAll = body.clearAll === true
      if (!body.overrides && clearFields.length === 0 && !clearAll) {
        throw new ProjectRouteError('请提供 overrides（要设置的字段）或 clearFields / clearAll（要清除的字段）')
      }
      return json(setSceneOverrides({ projectDir, sceneId, overrides: body.overrides || {}, clearFields, clearAll }))
    }

    // ------------------------------------------------------------------ character bank
    if (pathname === `${P}/characters`) {
      const scope = scopeOf(q.get('scope'), 'all')
      const projectDir = resolveProjectDir(q.get('projectDir'), { required: scope === 'project' })
      return json(listCharacters({ projectDir, scope }))
    }
    if (pathname === `${P}/characters/save`) {
      const body = await readBody(req)
      const scope = scopeOf(body.scope, 'project') === 'global' ? 'global' : 'project'
      const projectDir = resolveProjectDir(body.projectDir, { required: scope === 'project' })
      if (!body.character || typeof body.character !== 'object' || Array.isArray(body.character)) {
        throw new ProjectRouteError('缺少 character（角色信息对象：name / aliases / description / references）')
      }
      if (!str(body.character.name, 80)) throw new ProjectRouteError('角色名称 character.name 不能为空')
      return json(await saveCharacter({ projectDir, scope, character: body.character }))
    }
    if (pathname === `${P}/characters/delete`) {
      const body = await readBody(req)
      const scope = scopeOf(body.scope, 'project') === 'global' ? 'global' : 'project'
      const projectDir = resolveProjectDir(body.projectDir, { required: scope === 'project' })
      const characterId = str(body.characterId, 120)
      const name = str(body.name, 80)
      if (!characterId && !name) throw new ProjectRouteError('请指定要删除的 characterId 或 name')
      const res = deleteCharacter({ projectDir, scope, characterId, name })
      return json(res.ok ? res : { ...res, error: res.message }, res.ok ? 200 : 404)
    }
    if (pathname === `${P}/characters/attach`) {
      const body = await readBody(req)
      const projectDir = resolveProjectDir(body.projectDir)
      const characterId = str(body.characterId, 120)
      const name = str(body.name, 80)
      if (!characterId && !name) throw new ProjectRouteError('请指定角色 characterId 或 name')
      const paths = strList(body.paths, 20)
      const sceneIds = strList(body.sceneIds)
      if (paths.length === 0 && sceneIds.length === 0) throw new ProjectRouteError('请提供参考图 paths 或要绑定的 sceneIds')
      return json(
        await attachCharacter({ projectDir, characterId, name, referenceType: str(body.referenceType, 32) || 'face', paths, sceneIds }),
      )
    }

    // ------------------------------------------------------------------ free stock media
    if (pathname === `${P}/stock/search`) {
      const body = await readBody(req)
      const query = str(body.query, 200)
      if (!query) throw new ProjectRouteError('请填写素材检索关键词 query')
      const res = await searchStockMedia({
        query,
        mediaType: body.mediaType === 'video' ? 'video' : 'image',
        provider: ['auto', 'pexels', 'pixabay', 'all'].includes(body.provider) ? body.provider : 'auto',
        orientation: str(body.orientation, 16),
        minWidth: numberOrUndef(body.minWidth) || 0,
        minHeight: numberOrUndef(body.minHeight) || 0,
        minDurationSec: numberOrUndef(body.minDurationSec) || 0,
        maxDurationSec: numberOrUndef(body.maxDurationSec) || 0,
        page: intOr(body.page, 1, 1, 100),
        perPage: intOr(body.perPage, 15, 1, 80),
        locale: str(body.locale, 16) || 'zh-CN',
      })
      // "未配置" is a normal state for the UI (shows the key hint), not a server error
      return json(res.ok || res.configured === false ? res : { ...res, error: res.message })
    }
    if (pathname === `${P}/stock/import`) {
      const body = await readBody(req)
      const projectDir = resolveProjectDir(body.projectDir)
      const item = body.item && typeof body.item === 'object' && !Array.isArray(body.item) ? body.item : null
      const provider = str(item?.provider || body.provider, 16).toLowerCase()
      if (!['pexels', 'pixabay'].includes(provider)) throw new ProjectRouteError('请指定素材来源 provider（pexels 或 pixabay）')
      if (!item && !str(body.id, 64)) throw new ProjectRouteError('请提供检索结果 item，或 provider + mediaType + id')
      const res = await importStockMedia({
        projectDir,
        item,
        provider,
        mediaType: (item?.mediaType || body.mediaType) === 'video' ? 'video' : 'image',
        id: str(body.id, 64),
        sceneId: str(body.sceneId, 120),
        query: str(body.query, 200),
      })
      return json(res.ok ? res : { ...res, error: res.message })
    }

    // ------------------------------------------------------------------ paid cloud jobs
    if (pathname === `${P}/cloud-jobs`) {
      const projectDir = resolveProjectDir(q.get('projectDir'))
      const res = listCloudJobs(projectDir, { status: str(q.get('status'), 32), limit: intOr(q.get('limit'), 100, 1, 400) })
      if (['1', 'true', 'yes'].includes(String(q.get('plan') || '').toLowerCase())) {
        res.sourcingPlan = resolveMediaSourcingPlan({
          projectDir,
          autoUseCloudBroll: true,
          mediaType: q.get('mediaType') === 'video' ? 'video' : 'image',
        })
      }
      return json(res)
    }

    // ------------------------------------------------------------------ 指哪改哪 targeted refine
    if (pathname === `${P}/refine`) {
      const body = await readBody(req)
      const projectDir = resolveProjectDir(body.projectDir)
      const timeRange = parseTimeRange(body.timeRange)
      const region = parseRegion(body.region)
      const dryRun = body.dryRun === true
      const instruction = str(body.instruction, 4000)
      if (!dryRun && !instruction) throw new ProjectRouteError('请填写对 AI 的修改意见 instruction')
      const sceneId = str(body.sceneId, 120)
      if (sceneId && sceneId !== 'ALL' && !(readScriptJson(projectDir).data.scenes || []).some((s) => s.id === sceneId)) {
        throw new ProjectRouteError(`未找到场景 ${sceneId}`, 404)
      }
      const args = {
        projectDir,
        instruction,
        sceneId,
        sceneIds: strList(body.sceneIds),
        timeRange,
        region,
        dryRun,
        render: body.render !== false,
      }
      if (!dryRun && body.async === true && typeof opts.createBackgroundJob === 'function') {
        const job = opts.createBackgroundJob('正在按「指哪改哪」范围让大模型定向精修...', (onProgress) => refineAiScene({ ...args, onProgress }))
        return json({ ok: true, async: true, jobId: job.id })
      }
      const res = await refineAiScene(args)
      return json(res.ok ? res : { ...res, error: res.message || '精修未执行' }, res.refused ? 409 : 200)
    }

    return null
  } catch (err) {
    return json({ ok: false, error: err?.message || String(err), ...(err?.code ? { code: err.code } : {}) }, errorStatus(err))
  }
}
