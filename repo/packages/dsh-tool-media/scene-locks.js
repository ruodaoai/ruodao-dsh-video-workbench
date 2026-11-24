/**
 * @dsh-video/tool-media — Human Edit Protection: scene locks, user overrides & three-way merge
 *
 * - Lock: `scene.locked = true` → preserved by the director re-plan (content + timing), skipped by
 *   the batched TSX coder (existing TSX kept via `src/scenes/Locked_*.tsx` + registry override),
 *   refused/skipped by refine, and their `sfxCues` survive the audio stage (kept scene-relative).
 * - Overrides: UI edits live in `script.userOverrides[sceneId] = { field: value }` (dotted paths
 *   allowed, `__project__` for project-level fields) and are re-applied after every AI regeneration.
 * - Three-way merge: base = previous AI version (from project history), theirs = new AI output,
 *   ours = user overrides. User changes always win; conflicting fields are reported.
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  buildSentenceSubtitles,
  deriveVerbalSubtitleParts,
  readScriptJson,
  subChunksMatchNarration,
  subtitleLineWidthFor,
  timeSubtitleParts,
  writeScriptJson,
} from '../shared/index.js'
import { getLatestAiScript, safeProjectSnapshot, stableStringify } from './project-history.js'
import { readJsonSafe, writeJsonAtomic } from './safe-json-store.js'

export const OVERRIDE_PROJECT_KEY = '__project__'
const LOCKED_BLOCK_START = '// <dsh-locked-scenes>'
const LOCKED_BLOCK_END = '// </dsh-locked-scenes>'

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const deepEqual = (a, b) => stableStringify(a) === stableStringify(b)

/** A client-input error the REST layer may show as-is: HTTP `status` + stable `code` (`expose` marks it safe). */
function editInputError(message, status = 400, code = 'INVALID_INPUT') {
  const err = new Error(message)
  err.status = status
  err.code = code
  err.expose = true
  return err
}

export function isSceneLocked(scene) {
  return Boolean(scene && (scene.locked === true || scene.locked === 'true' || scene.locked === 1))
}

export function getLockedSceneIds(script) {
  return new Set((Array.isArray(script?.scenes) ? script.scenes : []).filter(isSceneLocked).map((s) => s.id).filter(Boolean))
}

// ---------------------------------------------------------------------------
// Dotted-path helpers
// ---------------------------------------------------------------------------

const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])
// Fields an override may never replace (identity / lock state / AI bookkeeping of the merge itself)
const PROTECTED_SCENE_FIELDS = new Set(['id', 'locked', 'lockedAt', 'lockReason'])
const PROTECTED_PROJECT_FIELDS = new Set(['scenes', 'userOverrides', 'lastEditMerge'])

/**
 * Validate a dotted override path. Throws a Chinese error for prototype-polluting or protected paths.
 */
export function assertSafeOverridePath(path, { projectLevel = false } = {}) {
  const raw = String(path ?? '').trim()
  const keys = raw.split('.')
  if (!raw || raw.length > 200 || keys.some((k) => !k || UNSAFE_PATH_SEGMENTS.has(k))) {
    throw editInputError(`不允许的修改字段: ${raw || '(空)'}`, 400, 'INVALID_OVERRIDE_FIELD')
  }
  const protectedSet = projectLevel ? PROTECTED_PROJECT_FIELDS : PROTECTED_SCENE_FIELDS
  if (protectedSet.has(keys[0])) throw editInputError(`字段「${keys[0]}」受保护，不能作为人工修改覆盖`, 400, 'PROTECTED_FIELD')
  return raw
}

function isSafePath(path) {
  return String(path || '')
    .split('.')
    .every((k) => k && !UNSAFE_PATH_SEGMENTS.has(k))
}

export function getByPath(obj, path) {
  if (!obj || !path || !isSafePath(path)) return undefined
  let cur = obj
  for (const k of String(path).split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[k]
  }
  return cur
}

function setByPath(obj, path, value) {
  // Never walk into prototypes (overrides are user/REST supplied)
  if (!obj || typeof obj !== 'object' || !isSafePath(path)) return
  const keys = String(path).split('.')
  let cur = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (!cur[keys[i]] || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {}
    cur = cur[keys[i]]
  }
  if (value === undefined) delete cur[keys[keys.length - 1]]
  else cur[keys[keys.length - 1]] = clone(value)
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

/** A blank subtitle override (`''`, whitespace, null) is no override at all: it means "follow the narration". */
export function isBlankSubtitleOverride(value) {
  return value === null || value === undefined || String(value).trim() === ''
}

/**
 * "Follow the narration" for one scene (what an empty 屏幕字幕 override means): the scene shows the narration's own
 * lines again. Cues that already show the narration are kept as they are (voice-aligned timing survives); otherwise the
 * lines are re-derived from the narration and timed inside the measured voice window (dubbed scene) or across the scene
 * (not dubbed yet — the timing `writeScriptJson` gives a scene without cues). A scene with narration is never left
 * without subtitles. Mutates and returns the scene.
 */
export function followNarrationSubtitles(scene, script) {
  if (!scene || typeof scene !== 'object') return scene
  const fps = Number(script?.fps) > 0 ? Number(script.fps) : 30
  const narration = scene.narration ?? scene.text ?? ''
  const current = (Array.isArray(scene.subtitles) ? scene.subtitles : []).filter((s) => s && String(s.text || '').trim())
  if (current.length > 0 && subChunksMatchNarration(current.map((s) => s.text), narration)) {
    scene.subtitles = current.map(({ userEdited, ...cue }) => cue)
  } else {
    const parts = deriveVerbalSubtitleParts(narration, null, scene.caption || '', subtitleLineWidthFor(script))
    const voiceSec = Number(scene.voiceDurationSec)
    const leadSec = Number.isFinite(Number(scene.voiceLeadSec)) ? Number(scene.voiceLeadSec) : 0.35
    scene.subtitles =
      voiceSec > 0
        ? timeSubtitleParts(parts, { offsetSec: leadSec, spanSec: voiceSec, fps })
        : timeSubtitleParts(parts, { offsetSec: 0, spanSec: Number(scene.durationSec || 4), fps })
  }
  const lines = scene.subtitles.map((s) => s.text)
  scene.subChunks = lines.length > 0 ? lines : undefined
  scene.subtitleText = lines.join(' ')
  return scene
}

function applyFieldOverride(scene, field, value, script) {
  if (PROTECTED_SCENE_FIELDS.has(String(field).split('.')[0])) return
  const fps = Number(script?.fps) || 30
  if (field === 'durationSec') {
    const dur = Math.max(0.2, Number(value) || 0)
    scene.durationSec = Number(dur.toFixed(4))
    scene.durationInFrames = Math.max(1, Math.ceil(dur * fps))
    return
  }
  if (field === 'durationInFrames') {
    const frames = Math.max(1, Math.round(Number(value) || 1))
    scene.durationInFrames = frames
    scene.durationSec = Number((frames / fps).toFixed(4))
    return
  }
  if (field === 'subtitleText') {
    // an empty override means "follow the narration" — never "no subtitles"
    if (isBlankSubtitleOverride(value)) {
      followNarrationSubtitles(scene, script)
      return
    }
    const text = String(value ?? '')
    scene.subtitleText = text
    scene.subChunks = undefined
    const lead = Number.isFinite(Number(scene.voiceLeadSec)) ? Number(scene.voiceLeadSec) : 0.2
    const span = Math.max(0.6, (Number(scene.durationSec) || 3) - lead - 0.2)
    const maxW = Number(script?.width) < Number(script?.height) ? 11 : 16
    scene.subtitles = text.trim()
      ? buildSentenceSubtitles(text, span, fps, { maxLineWidth: maxW }).map((s) => ({
          ...s,
          startSec: Number((s.startSec + lead).toFixed(3)),
          endSec: Number((s.endSec + lead).toFixed(3)),
          startFrame: Math.floor((s.startSec + lead) * fps),
          endFrame: Math.ceil((s.endSec + lead) * fps),
          sceneId: scene.id,
          userEdited: true,
        }))
      : []
    return
  }
  setByPath(scene, field, value)
}

/**
 * Re-apply `script.userOverrides` onto the scenes (mutates and returns the script).
 */
export function applyUserOverrides(script) {
  const overrides = script?.userOverrides && typeof script.userOverrides === 'object' ? script.userOverrides : {}
  const applied = []
  const orphans = []
  const scenes = Array.isArray(script?.scenes) ? script.scenes : []
  for (const [sceneId, fields] of Object.entries(overrides)) {
    if (!fields || typeof fields !== 'object') continue
    if (sceneId === OVERRIDE_PROJECT_KEY) {
      for (const [f, v] of Object.entries(fields)) {
        if (!PROTECTED_PROJECT_FIELDS.has(String(f).split('.')[0])) setByPath(script, f, v)
      }
      applied.push({ sceneId, fields: Object.keys(fields) })
      continue
    }
    const sc = scenes.find((s) => s.id === sceneId)
    if (!sc) {
      orphans.push(sceneId)
      continue
    }
    const names = Object.keys(fields)
    for (const [f, v] of Object.entries(fields)) applyFieldOverride(sc, f, v, script)
    // a blank subtitle override (stored by older versions) only meant "follow the narration": drop it
    if (Object.prototype.hasOwnProperty.call(fields, 'subtitleText') && isBlankSubtitleOverride(fields.subtitleText)) {
      delete fields.subtitleText
      if (Object.keys(fields).length === 0) delete overrides[sceneId]
    }
    applied.push({ sceneId, fields: names })
  }
  return { script, applied, orphans }
}

/**
 * Three-way merge of one scene: base = previous AI output, theirs = new AI output, ours = user
 * override map. User values win; a field is a conflict when the AI changed it (vs base) to a value
 * different from the user's (or when no base is known and the AI value differs from the user's).
 */
export function threeWayMergeScene({ sceneId = '', base = null, theirs = {}, ours = {}, script = null }) {
  const merged = clone(theirs) || {}
  const conflicts = []
  const applied = []
  for (const [field, oursVal] of Object.entries(ours || {})) {
    if (!isSafePath(field) || PROTECTED_SCENE_FIELDS.has(String(field).split('.')[0])) continue
    const theirsVal = getByPath(theirs, field)
    const baseKnown = Boolean(base)
    const baseVal = baseKnown ? getByPath(base, field) : undefined
    if (!deepEqual(theirsVal, oursVal)) {
      const aiChanged = baseKnown ? !deepEqual(baseVal, theirsVal) : theirsVal !== undefined
      if (aiChanged) {
        conflicts.push({
          sceneId,
          field,
          base: baseVal === undefined ? null : clone(baseVal),
          theirs: theirsVal === undefined ? null : clone(theirsVal),
          ours: clone(oursVal),
          resolution: 'ours',
          baseKnown,
        })
      }
    }
    applyFieldOverride(merged, field, oursVal, script)
    applied.push(field)
  }
  return { scene: merged, conflicts, applied }
}

/**
 * Keep locked scenes from `prevScenes` (content + duration) inside a regenerated scene list:
 * same-id scenes are replaced in place; locked scenes missing from the new plan are re-inserted
 * at their original index.
 */
export function preserveLockedScenes(prevScenes = [], nextScenes = [], lockedIds = null) {
  const ids = lockedIds || new Set(prevScenes.filter(isSceneLocked).map((s) => s.id))
  if (!ids.size) return { scenes: nextScenes, preserved: [], reinserted: [] }
  const lockedById = new Map()
  prevScenes.forEach((s, index) => {
    if (s?.id && ids.has(s.id)) lockedById.set(s.id, { scene: s, index })
  })
  const preserved = []
  const out = []
  const seen = new Set()
  for (const s of nextScenes || []) {
    const hit = s?.id ? lockedById.get(s.id) : null
    if (hit) {
      if (seen.has(s.id)) continue
      out.push({ ...clone(hit.scene), locked: true })
      preserved.push(s.id)
      seen.add(s.id)
    } else if (isSceneLocked(s)) {
      // Regenerated scenes inherit fields positionally (`{ ...oldScenes[i], ...shot }`): a lock flag on a scene that
      // was not locked before is an artifact and must not lock new AI content
      const { locked: _l, lockedAt: _la, lockReason: _lr, ...rest } = s
      out.push(rest)
    } else {
      out.push(s)
    }
  }
  const reinserted = []
  for (const [id, { scene, index }] of [...lockedById.entries()].sort((a, b) => a[1].index - b[1].index)) {
    if (seen.has(id)) continue
    out.splice(Math.min(index, out.length), 0, { ...clone(scene), locked: true })
    reinserted.push(id)
    preserved.push(id)
  }
  return { scenes: out, preserved, reinserted }
}

/**
 * Reconcile an AI regeneration with human edits: (1) preserve locked scenes, (2) three-way merge
 * user overrides (user wins, conflicts reported), (3) carry `userOverrides` forward.
 * Returns `{ script, report }` (`report` is null when the project has no locks/overrides).
 */
export function reconcileUserEdits({ projectDir = '', prevScript = {}, nextScript = {}, stage = '', base } = {}) {
  const lockedIds = getLockedSceneIds(prevScript)
  const overrides =
    prevScript?.userOverrides && typeof prevScript.userOverrides === 'object' && Object.keys(prevScript.userOverrides).length > 0
      ? prevScript.userOverrides
      : nextScript?.userOverrides && typeof nextScript.userOverrides === 'object'
        ? nextScript.userOverrides
        : {}
  if (!lockedIds.size && Object.keys(overrides).length === 0) return { script: nextScript, report: null }

  let baseScript = base
  let baseVersion = null
  if (baseScript === undefined) {
    const hit = projectDir ? getLatestAiScript(projectDir) : null
    baseScript = hit?.script || null
    baseVersion = hit?.version?.id || null
  }
  const lockRes = preserveLockedScenes(prevScript?.scenes || [], nextScript?.scenes || [], lockedIds)
  const scenes = lockRes.scenes
  const baseScenes = new Map((Array.isArray(baseScript?.scenes) ? baseScript.scenes : []).map((s) => [s.id, s]))
  const conflicts = []
  const overridesApplied = []
  const orphanOverrides = []
  for (const [sceneId, fields] of Object.entries(overrides)) {
    if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) continue
    if (sceneId === OVERRIDE_PROJECT_KEY) continue
    const idx = scenes.findIndex((s) => s?.id === sceneId)
    if (idx < 0) {
      orphanOverrides.push(sceneId)
      continue
    }
    const res = threeWayMergeScene({
      sceneId,
      base: baseScenes.get(sceneId) || null,
      theirs: scenes[idx],
      ours: fields,
      script: nextScript,
    })
    scenes[idx] = res.scene
    conflicts.push(...res.conflicts)
    overridesApplied.push({ sceneId, fields: res.applied })
  }
  const next = { ...nextScript, scenes }
  const projectOverrides = overrides[OVERRIDE_PROJECT_KEY]
  if (projectOverrides && typeof projectOverrides === 'object') {
    for (const [field, oursVal] of Object.entries(projectOverrides)) {
      if (PROTECTED_PROJECT_FIELDS.has(String(field).split('.')[0])) continue
      const theirsVal = getByPath(nextScript, field)
      const baseVal = baseScript ? getByPath(baseScript, field) : undefined
      if (!deepEqual(theirsVal, oursVal) && (baseScript ? !deepEqual(baseVal, theirsVal) : theirsVal !== undefined)) {
        conflicts.push({ sceneId: OVERRIDE_PROJECT_KEY, field, base: baseVal ?? null, theirs: theirsVal ?? null, ours: clone(oursVal), resolution: 'ours', baseKnown: Boolean(baseScript) })
      }
      setByPath(next, field, oursVal)
    }
    overridesApplied.push({ sceneId: OVERRIDE_PROJECT_KEY, fields: Object.keys(projectOverrides) })
  }
  next.userOverrides = clone(overrides)
  const report = {
    at: new Date().toISOString(),
    stage,
    baseVersionId: baseVersion,
    lockedPreserved: lockRes.preserved,
    lockedReinserted: lockRes.reinserted,
    overridesApplied,
    conflicts,
    orphanOverrides,
  }
  next.lastEditMerge = report
  return { script: next, report }
}

const LOCKED_VOICE_FIELDS = ['voiceId', 'voiceMatchReason', 'voiceLocked', 'emotion', 'voiceEmotion', 'speechRate', 'role']

/**
 * After automatic voice casting / matching (which rewrites every scene), put locked scenes' voice
 * fields back from `sourceScript`. Returns the ids that were re-asserted.
 */
export function reassertLockedScenes(projectDir, sourceScript, { fields = LOCKED_VOICE_FIELDS } = {}) {
  const src = new Map((Array.isArray(sourceScript?.scenes) ? sourceScript.scenes : []).filter(isSceneLocked).map((s) => [s.id, s]))
  if (src.size === 0) return []
  const { data } = readScriptJson(projectDir)
  const touched = []
  for (const sc of data.scenes || []) {
    const keep = src.get(sc.id)
    if (!keep) continue
    let changed = false
    for (const f of fields) {
      if (!deepEqual(sc[f], keep[f])) {
        if (keep[f] === undefined) delete sc[f]
        else sc[f] = clone(keep[f])
        changed = true
      }
    }
    if (changed) touched.push(sc.id)
  }
  if (touched.length > 0) writeScriptJson(projectDir, data)
  return touched
}

export function summarizeEditMerge(report) {
  if (!report) return ''
  const parts = []
  if (report.lockedPreserved?.length) parts.push(`保留锁定场景 ${report.lockedPreserved.join(', ')}`)
  if (report.overridesApplied?.length) parts.push(`重新套用人工修改 ${report.overridesApplied.length} 处`)
  if (report.conflicts?.length) parts.push(`冲突 ${report.conflicts.length} 项（已以人工修改为准: ${report.conflicts.slice(0, 4).map((c) => `${c.sceneId}.${c.field}`).join('、')}）`)
  if (report.orphanOverrides?.length) parts.push(`有 ${report.orphanOverrides.length} 个场景的人工修改暂无对应场景（已保留待用）`)
  return parts.join('；')
}

// ---------------------------------------------------------------------------
// Project-level edit operations (tools / REST)
// ---------------------------------------------------------------------------

export function setSceneLock({ projectDir, sceneId = '', sceneIds = [], locked = true, reason = '' } = {}) {
  if (!projectDir) throw editInputError('projectDir is required', 400, 'BAD_REQUEST')
  const ids = [...new Set([...(Array.isArray(sceneIds) ? sceneIds : [sceneIds]), sceneId].map(String).filter(Boolean))]
  if (ids.length === 0) throw editInputError('请指定要锁定/解锁的 sceneId', 400, 'BAD_REQUEST')
  const { data } = readScriptJson(projectDir)
  const changed = []
  const missing = []
  for (const id of ids) {
    const sc = (data.scenes || []).find((s) => s.id === id)
    if (!sc) {
      missing.push(id)
      continue
    }
    if (locked) {
      sc.locked = true
      sc.lockedAt = new Date().toISOString()
      if (reason) sc.lockReason = String(reason)
    } else {
      delete sc.locked
      delete sc.lockedAt
      delete sc.lockReason
    }
    changed.push(id)
  }
  if (changed.length > 0) {
    writeScriptJson(projectDir, data)
    // HTML engine: capture the locked scenes' <template> blocks NOW (before any later regeneration of index.html);
    // unlocking drops them from the store
    if (data.engine !== 'remotion') {
      try {
        syncLockedHtmlStore(projectDir, data)
      } catch {}
    }
    safeProjectSnapshot(projectDir, { label: `${locked ? 'lock' : 'unlock'}:${changed.join(',')}`, stage: 'user-edit', author: 'user', kind: 'user-edit' })
  }
  return {
    ok: changed.length > 0,
    locked: Boolean(locked),
    changed,
    missing,
    lockedSceneIds: [...getLockedSceneIds(data)],
    message: changed.length ? `已${locked ? '锁定' : '解锁'}场景 ${changed.join(', ')}` : '未找到指定场景',
  }
}

/**
 * Store user overrides for a scene (or `__project__`), apply them immediately and snapshot.
 */
export function setSceneOverrides({ projectDir, sceneId, overrides = {}, clearFields = [], clearAll = false } = {}) {
  if (!projectDir) throw editInputError('projectDir is required', 400, 'BAD_REQUEST')
  if (!sceneId) throw editInputError('sceneId is required（项目级字段请使用 "__project__"）', 400, 'BAD_REQUEST')
  const { data } = readScriptJson(projectDir)
  if (sceneId !== OVERRIDE_PROJECT_KEY && !(data.scenes || []).some((s) => s.id === sceneId)) {
    throw editInputError(`未找到场景 ${sceneId}`, 404, 'SCENE_NOT_FOUND')
  }
  const all = data.userOverrides && typeof data.userOverrides === 'object' ? data.userOverrides : {}
  const cur = { ...(all[sceneId] || {}) }
  if (clearAll) for (const k of Object.keys(cur)) delete cur[k]
  for (const f of Array.isArray(clearFields) ? clearFields : [clearFields]) if (f) delete cur[f]
  if (overrides && (typeof overrides !== 'object' || Array.isArray(overrides))) throw editInputError('overrides 需为 { 字段: 值 } 对象')
  let followNarration = false
  for (const [f, v] of Object.entries(overrides || {})) {
    const field = assertSafeOverridePath(f, { projectLevel: sceneId === OVERRIDE_PROJECT_KEY })
    if (v === undefined) continue
    if (field === 'subtitleText' && sceneId !== OVERRIDE_PROJECT_KEY && isBlankSubtitleOverride(v)) {
      // an empty 屏幕字幕 = follow the narration again: drop the override instead of storing ''
      delete cur.subtitleText
      followNarration = true
      continue
    }
    cur[field] = clone(v)
  }
  if (Object.keys(cur).length > 0) all[sceneId] = cur
  else delete all[sceneId]
  data.userOverrides = all
  const res = applyUserOverrides(data)
  if (followNarration) followNarrationSubtitles((data.scenes || []).find((s) => s.id === sceneId), data)
  writeScriptJson(projectDir, res.script)
  const snap = safeProjectSnapshot(projectDir, { label: `user-edit:${sceneId}`, stage: 'user-edit', author: 'user', kind: 'user-edit' })
  return {
    ok: true,
    sceneId,
    overrides: all[sceneId] || {},
    allOverrides: all,
    applied: res.applied,
    ...(followNarration ? { followNarration: [sceneId] } : {}),
    versionId: snap?.id || '',
  }
}

/**
 * Record several scenes' UI edits as user overrides with ONE script write and ONE history snapshot
 * (the Web Studio calls this when the user saves inspector edits). `edits` = { [sceneId]: { field: value } };
 * unknown scene ids are reported in `missing`, never created.
 */
export function recordSceneOverrides({ projectDir, edits = {} } = {}) {
  if (!projectDir) throw editInputError('projectDir is required', 400, 'BAD_REQUEST')
  if (!edits || typeof edits !== 'object' || Array.isArray(edits)) throw editInputError('edits 需为 { sceneId: { 字段: 值 } } 对象')
  const { data } = readScriptJson(projectDir)
  const all = data.userOverrides && typeof data.userOverrides === 'object' ? data.userOverrides : {}
  const known = new Set((data.scenes || []).map((s) => s?.id).filter(Boolean))
  const recorded = []
  const missing = []
  const followNarration = []
  for (const [sceneId, fields] of Object.entries(edits)) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue
    if (sceneId === OVERRIDE_PROJECT_KEY || !known.has(sceneId)) {
      missing.push(sceneId)
      continue
    }
    const cur = { ...(all[sceneId] || {}) }
    const names = []
    let follow = false
    for (const [f, v] of Object.entries(fields)) {
      const field = assertSafeOverridePath(f)
      if (v === undefined) continue
      if (field === 'subtitleText' && isBlankSubtitleOverride(v)) {
        // an empty 屏幕字幕 = follow the narration again: drop the override, it is not a protected edit
        delete cur.subtitleText
        follow = true
        continue
      }
      cur[field] = clone(v)
      names.push(field)
    }
    if (names.length > 0 || follow) {
      if (Object.keys(cur).length > 0) all[sceneId] = cur
      else delete all[sceneId]
    }
    if (names.length > 0) recorded.push({ sceneId, fields: names })
    if (follow) followNarration.push(sceneId)
  }
  if (recorded.length === 0 && followNarration.length === 0) return { ok: true, recorded, missing, versionId: '', userOverrides: all }
  data.userOverrides = all
  const res = applyUserOverrides(data)
  for (const id of followNarration) followNarrationSubtitles((data.scenes || []).find((s) => s.id === id), data)
  writeScriptJson(projectDir, res.script)
  const label = `user-edit:${[...new Set([...recorded.map((r) => r.sceneId), ...followNarration])].join(',')}`.slice(0, 120)
  const snap = safeProjectSnapshot(projectDir, { label, stage: 'user-edit', author: 'user', kind: 'user-edit' })
  return { ok: true, recorded, missing, ...(followNarration.length ? { followNarration } : {}), versionId: snap?.id || '', userOverrides: all }
}

/**
 * Drop recorded scene overrides (all scenes, or only `sceneIds`) with one write + one snapshot, e.g. when the
 * user starts a brand-new brief and does not want old hand edits re-applied. Project-level overrides are kept.
 */
export function clearSceneOverrides({ projectDir, sceneIds = null } = {}) {
  if (!projectDir) throw editInputError('projectDir is required', 400, 'BAD_REQUEST')
  const { data } = readScriptJson(projectDir)
  const all = data.userOverrides && typeof data.userOverrides === 'object' ? { ...data.userOverrides } : {}
  const only = Array.isArray(sceneIds) && sceneIds.length > 0 ? new Set(sceneIds.map(String)) : null
  const cleared = []
  for (const id of Object.keys(all)) {
    if (id === OVERRIDE_PROJECT_KEY) continue
    if (only && !only.has(id)) continue
    delete all[id]
    cleared.push(id)
  }
  if (cleared.length === 0) return { ok: true, cleared, versionId: '', userOverrides: all }
  data.userOverrides = all
  writeScriptJson(projectDir, data)
  const snap = safeProjectSnapshot(projectDir, { label: 'user-edit:clear-overrides', stage: 'user-edit', author: 'user', kind: 'user-edit' })
  return { ok: true, cleared, versionId: snap?.id || '', userOverrides: all }
}

export function listSceneEdits(projectDir) {
  const { data } = readScriptJson(projectDir)
  return {
    ok: true,
    lockedSceneIds: [...getLockedSceneIds(data)],
    userOverrides: data.userOverrides || {},
    lastEditMerge: data.lastEditMerge || null,
  }
}

// ---------------------------------------------------------------------------
// Audio-stage protection: locked scenes keep their sfxCues (scene-relative)
// ---------------------------------------------------------------------------

export function bgmGridSignature(bgm = {}) {
  const beats = Array.isArray(bgm?.beats) ? bgm.beats.slice(0, 24).map((b) => Number(typeof b === 'object' ? b?.time : b) || 0) : []
  return `${Math.round(Number(bgm?.bpm) || 0)}|${(Number(bgm?.phaseSec) || 0).toFixed(2)}|${beats.map((t) => t.toFixed(2)).join(',')}`
}

export function snapshotLockedSceneAudio(script) {
  const bySceneId = {}
  for (const sc of Array.isArray(script?.scenes) ? script.scenes : []) {
    if (!isSceneLocked(sc)) continue
    bySceneId[sc.id] = { sfxCues: clone(Array.isArray(sc.sfxCues) ? sc.sfxCues : []), durationSec: Number(sc.durationSec) || 0 }
  }
  return { lockedIds: Object.keys(bySceneId), bySceneId, gridSignature: bgmGridSignature(script?.bgm) }
}

/**
 * Restore locked scenes' sfxCues after beat quantization / SFX choreography. Offsets are already
 * scene-relative; when the music grid (or the scene duration) changed they are clamped inside the scene.
 */
export function restoreLockedSceneSfx(script, snap) {
  const out = { restored: [], gridChanged: false, clampedCues: 0 }
  if (!snap || !snap.lockedIds?.length) return out
  out.gridChanged = bgmGridSignature(script?.bgm) !== snap.gridSignature
  for (const sc of Array.isArray(script?.scenes) ? script.scenes : []) {
    const saved = snap.bySceneId[sc.id]
    if (!saved) continue
    const dur = Math.max(0.1, Number(sc.durationSec) || saved.durationSec || 1)
    const needClamp = out.gridChanged || Math.abs(dur - saved.durationSec) > 0.01
    sc.sfxCues = clone(saved.sfxCues).map((cue) => {
      if (!needClamp) return cue
      const off = Number(cue?.offsetSec) || 0
      const maxOff = Math.max(0, dur - 0.05)
      if (off > maxOff) {
        out.clampedCues++
        return { ...cue, offsetSec: Number(maxOff.toFixed(3)), clampedByLock: true }
      }
      return cue
    })
    out.restored.push(sc.id)
  }
  return out
}

// ---------------------------------------------------------------------------
// TSX protection for locked scenes (src/scenes/Locked_*.tsx + registry override block)
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function codeDefinesScene(code, sceneId) {
  if (!code || !sceneId) return false
  return new RegExp(`(['"\`])${escapeRegExp(sceneId)}\\1\\s*:`).test(code)
}

function pickExportForScenes(code, ids) {
  const re = /export\s+const\s+([A-Za-z_$][\w$]*)/g
  const marks = []
  let m
  while ((m = re.exec(code))) marks.push({ name: m[1], index: m.index })
  for (let i = 0; i < marks.length; i++) {
    const seg = code.slice(marks[i].index, i + 1 < marks.length ? marks[i + 1].index : code.length)
    if (ids.some((id) => codeDefinesScene(seg, id))) return marks[i].name
  }
  return marks.find((x) => /SCENES/.test(x.name))?.name || marks[0]?.name || ''
}

function listSceneModuleFiles(absDir) {
  const dir = join(resolve(absDir), 'src', 'scenes')
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).filter((f) => /\.(tsx|ts|jsx|js)$/.test(f) && f !== 'index.ts' && f !== 'index.tsx')
  } catch {
    return []
  }
}

/**
 * Map scene ids → module files under `src/scenes/` that define them (registry keys).
 */
export function indexSceneModules(absDir, sceneIds = []) {
  const dir = join(resolve(absDir), 'src', 'scenes')
  const bySceneId = {}
  const modules = []
  for (const f of listSceneModuleFiles(absDir)) {
    let code = ''
    try {
      code = readFileSync(join(dir, f), 'utf8')
    } catch {
      continue
    }
    const ids = sceneIds.filter((id) => codeDefinesScene(code, id))
    modules.push({ file: `src/scenes/${f}`, locked: f.startsWith('Locked_'), sceneIds: ids })
    for (const id of ids) (bySceneId[id] ||= []).push(`src/scenes/${f}`)
  }
  return { modules, bySceneId }
}

/**
 * Before (re)generating / refining scene TSX: copy the module defining each locked scene to
 * `src/scenes/Locked_<name>.tsx` (existing locked copies win). Scenes that were unlocked but whose
 * only implementation still lives in a Locked_ copy are kept as *fallback-only* picks (they never
 * override newly generated code). Locked_ copies no longer needed are deleted.
 * @param {string[]} [opts.sceneIds] all current scene ids (enables fallback picks for unlocked scenes)
 * @returns {{ modules: { file: string, exportName: string, sceneIds: string[], fallbackSceneIds: string[] }[], missing: string[] }}
 */
export function preserveLockedSceneModules(absDir, lockedIds, { sceneIds = [] } = {}) {
  const ids = lockedIds instanceof Set ? lockedIds : new Set(lockedIds || [])
  const dir = join(resolve(absDir), 'src', 'scenes')
  const files = listSceneModuleFiles(absDir)
  const codeCache = new Map()
  const readCode = (f) => {
    if (!codeCache.has(f)) {
      try {
        codeCache.set(f, readFileSync(join(dir, f), 'utf8'))
      } catch {
        codeCache.set(f, '')
      }
    }
    return codeCache.get(f)
  }
  const lockedFiles = files.filter((x) => x.startsWith('Locked_'))
  const regularFiles = files.filter((x) => !x.startsWith('Locked_'))
  const byFile = new Map() // file -> { override: Set, fallback: Set }
  const use = (f, id, kind) => {
    if (!byFile.has(f)) byFile.set(f, { override: new Set(), fallback: new Set() })
    byFile.get(f)[kind].add(id)
  }
  const remaining = new Set(ids)
  for (const f of lockedFiles) {
    for (const id of [...remaining]) {
      if (codeDefinesScene(readCode(f), id)) {
        use(f, id, 'override')
        remaining.delete(id)
      }
    }
  }
  for (const f of regularFiles) {
    if (remaining.size === 0) break
    const hit = [...remaining].filter((id) => codeDefinesScene(readCode(f), id))
    if (hit.length === 0) continue
    let target = `Locked_${f}`
    if (byFile.has(target)) target = `Locked_${f.replace(/\.(tsx|ts|jsx|js)$/, '')}_${Date.now().toString(36)}.${f.split('.').pop()}`
    copyFileSync(join(dir, f), join(dir, target))
    codeCache.set(target, readCode(f))
    hit.forEach((id) => {
      use(target, id, 'override')
      remaining.delete(id)
    })
  }
  // Unlocked scenes whose only implementation is a Locked_ copy → fallback-only picks
  for (const id of sceneIds || []) {
    if (!id || ids.has(id)) continue
    if (regularFiles.some((f) => codeDefinesScene(readCode(f), id))) continue
    const f = lockedFiles.find((x) => codeDefinesScene(readCode(x), id))
    if (f) use(f, id, 'fallback')
  }
  for (const f of lockedFiles) {
    if (byFile.has(f)) continue
    try {
      unlinkSync(join(dir, f))
    } catch {}
  }
  const modules = [...byFile.entries()].map(([file, sets]) => {
    const all = [...sets.override, ...sets.fallback]
    return { file, exportName: pickExportForScenes(readCode(file), all), sceneIds: [...sets.override], fallbackSceneIds: [...sets.fallback] }
  })
  return { modules: modules.filter((m) => m.exportName), missing: [...remaining] }
}

export function buildLockedRegistryBlock(modules = []) {
  if (!modules.length) return ''
  const imports = modules
    .map((m, i) => `import { ${m.exportName} as __DSH_LOCKED_${i} } from './${m.file.replace(/\.(tsx|ts|jsx|js)$/, '')}';`)
    .join('\n')
  const assigns = modules
    .flatMap((m, i) => [
      ...(m.sceneIds?.length ? [`Object.assign(CUSTOM_SCENE_MAP, __dshLockedPick(__DSH_LOCKED_${i}, ${JSON.stringify(m.sceneIds)}));`] : []),
      ...(m.fallbackSceneIds?.length ? [`__dshFillGaps(__dshLockedPick(__DSH_LOCKED_${i}, ${JSON.stringify(m.fallbackSceneIds)}));`] : []),
    ])
    .join('\n')
  return `${LOCKED_BLOCK_START} 人工锁定场景：始终使用锁定时的 TSX 实现，AI 重新生成或精修不会覆盖（自动生成，请勿手改）
${imports}
const __dshLockedPick = (src: Record<string, any>, ids: string[]): Record<string, any> => {
  const out: Record<string, any> = {};
  ids.forEach((id) => {
    if (src && src[id]) out[id] = src[id];
  });
  return out;
};
const __dshFillGaps = (picked: Record<string, any>): void => {
  Object.keys(picked).forEach((id) => {
    if (!CUSTOM_SCENE_MAP[id]) CUSTOM_SCENE_MAP[id] = picked[id];
  });
};
${assigns}
${LOCKED_BLOCK_END}
`
}

export function stripLockedRegistryBlock(code = '') {
  const start = code.indexOf(LOCKED_BLOCK_START)
  if (start < 0) return code
  const end = code.indexOf(LOCKED_BLOCK_END, start)
  if (end < 0) return code.slice(0, start).trimEnd() + '\n'
  return (code.slice(0, start) + code.slice(end + LOCKED_BLOCK_END.length)).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

export function applyLockedRegistryBlock(indexCode = '', modules = []) {
  const base = stripLockedRegistryBlock(String(indexCode || ''))
  if (!modules.length || !/CUSTOM_SCENE_MAP/.test(base)) return base
  return `${base.trimEnd()}\n\n${buildLockedRegistryBlock(modules)}`
}

export function writeLockedRegistryBlock(absDir, modules = []) {
  const p = join(resolve(absDir), 'src', 'scenes', 'index.ts')
  if (!existsSync(p)) return false
  const cur = readFileSync(p, 'utf8')
  const next = applyLockedRegistryBlock(cur, modules)
  if (next !== cur) writeFileSync(p, next, 'utf8')
  return true
}

// ---------------------------------------------------------------------------
// HyperFrames HTML protection for locked scenes (<template data-scene-id> blocks)
// ---------------------------------------------------------------------------

/** HTML engine locked-scene store (tracked by project history so restores stay consistent). */
export const LOCKED_HTML_STORE_REL = 'output/locked-html-scenes.json'

function htmlSceneBlockRe(sceneId) {
  return new RegExp(`<template\\b[^>]*\\bdata-scene-id=(["'])${escapeRegExp(sceneId)}\\1[^>]*>[\\s\\S]*?<\\/template>`, 'i')
}

/**
 * HyperFrames HTML engine: keep locked scenes' `<template data-scene-id="…">` blocks exactly as they were before an
 * AI rewrite of `index.html` (the whole page is regenerated as one file, so file-level protection is not enough).
 * @returns {{ html: string, restored: string[], missing: string[] }} `missing` = locked blocks the new page dropped
 */
export function restoreLockedHtmlScenes(prevHtml = '', nextHtml = '', lockedIds = []) {
  let html = String(nextHtml || '')
  const restored = []
  const missing = []
  for (const id of lockedIds || []) {
    if (!id) continue
    const re = htmlSceneBlockRe(id)
    const oldBlock = String(prevHtml || '').match(re)?.[0]
    if (!oldBlock) continue
    const cur = html.match(re)
    if (!cur) {
      missing.push(id)
      continue
    }
    if (cur[0] !== oldBlock) {
      html = html.replace(re, () => oldBlock)
      restored.push(id)
    }
  }
  return { html, restored, missing }
}

export function extractHtmlSceneBlock(html = '', sceneId = '') {
  if (!sceneId) return ''
  return String(html || '').match(htmlSceneBlockRe(sceneId))?.[0] || ''
}

/**
 * Persist the HTML blocks of locked scenes. The FIRST capture after a lock wins (later AI rewrites never replace it);
 * blocks of scenes that are no longer locked are dropped. Call before any regeneration of `index.html`.
 * @returns {Record<string, string>} sceneId → locked `<template>` block
 */
export function syncLockedHtmlStore(absDir, script = {}, currentHtml = null) {
  const root = resolve(absDir)
  const storePath = join(root, LOCKED_HTML_STORE_REL)
  const lockedIds = (Array.isArray(script?.scenes) ? script.scenes : []).filter(isSceneLocked).map((s) => s.id).filter(Boolean)
  const prev = readJsonSafe(storePath, null)
  const blocks = prev && typeof prev.blocks === 'object' && prev.blocks ? prev.blocks : {}
  let html = currentHtml
  const next = {}
  for (const id of lockedIds) {
    if (typeof blocks[id] === 'string' && blocks[id]) {
      next[id] = blocks[id]
      continue
    }
    if (html === null) {
      try {
        html = readFileSync(join(root, 'index.html'), 'utf8')
      } catch {
        html = ''
      }
    }
    const block = extractHtmlSceneBlock(html, id)
    if (block) next[id] = block
  }
  const changed = JSON.stringify(Object.keys(next).sort()) !== JSON.stringify(Object.keys(blocks).sort())
  if (Object.keys(next).length === 0) {
    if (existsSync(storePath)) {
      try {
        unlinkSync(storePath)
      } catch {}
    }
  } else if (changed || Object.keys(next).some((k) => next[k] !== blocks[k])) {
    writeJsonAtomic(storePath, { version: 1, updatedAt: new Date().toISOString(), blocks: next })
  }
  return next
}

/**
 * Put stored locked-scene blocks back into an HTML page (`<template data-scene-id="…">` replaced verbatim).
 */
export function applyLockedHtmlStore(html = '', blocks = {}) {
  let out = String(html || '')
  const restored = []
  const missing = []
  for (const [id, block] of Object.entries(blocks || {})) {
    if (!id || !block) continue
    const re = htmlSceneBlockRe(id)
    const cur = out.match(re)
    if (!cur) {
      missing.push(id)
      continue
    }
    if (cur[0] !== block) {
      out = out.replace(re, () => block)
      restored.push(id)
    }
  }
  return { html: out, restored, missing }
}
