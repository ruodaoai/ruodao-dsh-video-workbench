/**
 * @dsh-video/tool-media — Character Consistency Bank (角色库)
 *
 * Per-project `<project>/characters.json` plus an optional global library
 * (`$DSH_VIDEO_HOME/characters/library.json`, default `./.dsh-home/...`).
 * Each character: name, aliases, description and reference images (face / fullBody /
 * expressions / turnaround) stored as asset paths.
 *
 * When a cloud image/video prompt mentions `@角色名` or `@别名`, `buildCharacterPromptContext`
 * returns the reference images to attach (for providers that accept reference images) and a
 * textual character description to inject otherwise.
 *
 * `figure` (optional) is the same person's look for the coded figure library (outfit, hair, headwear, colours …):
 * the director's cast is synced with it (cast-bank-sync.js), so animated shots and generated images match.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { readScriptJson, resolveEnvPath, writeScriptJson } from '../shared/index.js'
import { importAssets } from './asset-manager.js'
import { readJsonSafe, toPosixRel, withFileLockSync, writeJsonAtomic } from './safe-json-store.js'
import { describeFigureZh, normalizeFigureLook } from './figure-kit.js'

export const CHARACTER_REFERENCE_TYPES = ['face', 'fullBody', 'expressions', 'turnaround']
const REF_PRIORITY = ['face', 'fullBody', 'turnaround', 'expressions']
const REF_TYPE_ALIASES = {
  face: 'face',
  faces: 'face',
  portrait: 'face',
  head: 'face',
  脸: 'face',
  面部: 'face',
  正脸: 'face',
  fullbody: 'fullBody',
  full_body: 'fullBody',
  'full-body': 'fullBody',
  body: 'fullBody',
  全身: 'fullBody',
  expression: 'expressions',
  expressions: 'expressions',
  表情: 'expressions',
  turnaround: 'turnaround',
  'turn-around': 'turnaround',
  三视图: 'turnaround',
  转面: 'turnaround',
}
const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

/** A client-input error the REST layer may show as-is: HTTP `status` + stable `code` (`expose` marks it safe). */
function inputError(message, status = 400, code = 'INVALID_INPUT') {
  const err = new Error(message)
  err.status = status
  err.code = code
  err.expose = true
  return err
}

export function normalizeReferenceType(t = 'face') {
  const key = String(t || 'face').trim()
  return REF_TYPE_ALIASES[key] || REF_TYPE_ALIASES[key.toLowerCase()] || (CHARACTER_REFERENCE_TYPES.includes(key) ? key : 'face')
}

export function getProjectCharacterBankPath(projectDir) {
  return join(resolve(projectDir), 'characters.json')
}

export function getGlobalCharacterLibraryPath(override = '') {
  if (override) return resolve(override)
  return join(resolveEnvPath('DSH_VIDEO_HOME', './.dsh-home'), 'characters', 'library.json')
}

function uniq(list = []) {
  return [...new Set(list.filter(Boolean))]
}

function readBank(filePath) {
  const data = readJsonSafe(filePath, null)
  return {
    version: 1,
    updatedAt: data?.updatedAt || '',
    characters: Array.isArray(data?.characters) ? data.characters : [],
  }
}

function mutateBank(filePath, mutator) {
  return withFileLockSync(`${filePath}.lock`, () => {
    const bank = readBank(filePath)
    const out = mutator(bank)
    bank.updatedAt = new Date().toISOString()
    writeJsonAtomic(filePath, bank)
    return out
  })
}

function characterIdFor(name) {
  return `char-${createHash('sha1').update(String(name || '').trim().toLowerCase()).digest('hex').slice(0, 10)}`
}

/** Name comparison key: trimmed, leading `@` removed, case-insensitive (the same normalisation as the id). */
function nameKey(name) {
  return String(name || '').trim().replace(/^@+/, '').toLowerCase()
}

/** `base`, or `base-2`, `base-3` … — the first id no character in `list` uses yet. */
function uniqueCharacterId(list, base) {
  const used = new Set(list.map((c) => c.id))
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

function splitAliases(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') return raw.split(/[,，、;；\n]+/)
  return []
}

export function normalizeCharacter(raw = {}, existing = null) {
  const name = String(raw.name ?? existing?.name ?? '').trim().replace(/^@+/, '')
  if (!name) throw inputError('角色名称 name 不能为空')
  const aliases = uniq(
    splitAliases(raw.aliases !== undefined ? raw.aliases : existing?.aliases || [])
      .map((a) => String(a || '').trim().replace(/^@+/, ''))
      .filter((a) => a && a !== name),
  )
  const references = {}
  for (const t of CHARACTER_REFERENCE_TYPES) {
    const incoming = raw.references && Array.isArray(raw.references[t]) ? raw.references[t] : null
    const prev = existing?.references && Array.isArray(existing.references[t]) ? existing.references[t] : []
    references[t] = uniq((incoming || prev).map((p) => String(p || '').trim()).filter(Boolean))
  }
  const nowIso = new Date().toISOString()
  return {
    id: String(raw.id || existing?.id || characterIdFor(name)),
    name,
    aliases,
    description: String(raw.description ?? existing?.description ?? '').trim(),
    references,
    ...(raw.voiceId || existing?.voiceId ? { voiceId: String(raw.voiceId || existing.voiceId) } : {}),
    ...(raw.figure && typeof raw.figure === 'object' ? { figure: normalizeFigureLook(raw.figure) } : existing?.figure ? { figure: existing.figure } : {}),
    tags: uniq(splitAliases(raw.tags !== undefined ? raw.tags : existing?.tags || []).map((s) => String(s).trim())),
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  }
}

/** Lookup by id, then exact name, then alias (delete / attach / mentions: what the user refers to). */
function matchCharacter(list, { characterId = '', name = '' } = {}) {
  const id = String(characterId || '').trim()
  const nm = nameKey(name)
  return (
    list.find((c) => id && c.id === id) ||
    list.find((c) => nm && String(c.name || '').toLowerCase() === nm) ||
    list.find((c) => nm && (c.aliases || []).some((a) => String(a).toLowerCase() === nm)) ||
    null
  )
}

/**
 * Lookup for SAVING: exact id, then exact name only — never an alias. A new character whose name happens to be
 * another character's alias is a different person and must never overwrite that character.
 */
function matchCharacterForSave(list, { characterId = '', name = '' } = {}) {
  const id = String(characterId || '').trim()
  const nm = nameKey(name)
  return list.find((c) => id && c.id === id) || list.find((c) => nm && nameKey(c.name) === nm) || null
}

/**
 * Turn user-supplied reference paths into project asset paths (imports out-of-project files
 * through the regular asset import path so they are probed, thumbnailed and hard-linked).
 */
async function normalizeProjectReferencePaths(projectDir, paths = []) {
  const absProject = resolve(projectDir)
  const out = []
  for (const raw of paths) {
    const p = String(raw || '').trim()
    if (!p) continue
    const abs = isAbsolute(p) ? resolve(p) : resolve(absProject, p)
    if (!existsSync(abs)) throw inputError(`角色参考图不存在: ${p}`, 404, 'REFERENCE_NOT_FOUND')
    const rel = relative(absProject, abs)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      out.push(toPosixRel(rel))
      continue
    }
    if (!IMAGE_MIME[extname(abs).toLowerCase()]) throw inputError(`角色参考图需为图片文件（png/jpg/webp 等）: ${p}`)
    // One import per file so same-named references from different folders never get mixed up
    const res = await importAssets({ projectDir: absProject, sources: [abs] })
    const hit = res.added?.[0] || res.existing?.[0] || null
    if (!hit?.path) throw new Error(`角色参考图导入项目素材库失败: ${p}`)
    out.push(toPosixRel(hit.path))
  }
  return uniq(out)
}

export function listCharacters({ projectDir = '', scope = 'all', globalLibraryPath = '' } = {}) {
  const wantProject = scope === 'all' || scope === 'project'
  const wantGlobal = scope === 'all' || scope === 'global'
  const project = wantProject && projectDir ? readBank(getProjectCharacterBankPath(projectDir)).characters : []
  const global = wantGlobal ? readBank(getGlobalCharacterLibraryPath(globalLibraryPath)).characters : []
  return {
    ok: true,
    scope,
    projectBankPath: projectDir ? getProjectCharacterBankPath(projectDir) : '',
    globalLibraryPath: getGlobalCharacterLibraryPath(globalLibraryPath),
    project,
    global,
    characters: [...project.map((c) => ({ ...c, scope: 'project' })), ...global.map((c) => ({ ...c, scope: 'global' }))],
  }
}

/**
 * Create or update a character. With an `id` the character with that id is updated; without one, only a character
 * with exactly the same name is updated — a name that is merely another character's alias creates a NEW character
 * (with its own unique id; `aliasConflicts` lists the characters that use the name as an alias). `created` tells which.
 */
export async function saveCharacter({ projectDir = '', scope = 'project', character = {}, globalLibraryPath = '' } = {}) {
  if (scope === 'project' && !projectDir) throw inputError('保存项目角色需要 projectDir')
  const bankPath = scope === 'global' ? getGlobalCharacterLibraryPath(globalLibraryPath) : getProjectCharacterBankPath(projectDir)
  const incoming = { ...(character || {}) }
  if (scope === 'project' && incoming.references && typeof incoming.references === 'object') {
    const fixed = {}
    for (const [t, arr] of Object.entries(incoming.references)) {
      const key = normalizeReferenceType(t)
      fixed[key] = uniq([...(fixed[key] || []), ...(await normalizeProjectReferencePaths(projectDir, Array.isArray(arr) ? arr : [arr]))])
    }
    incoming.references = fixed
  } else if (scope === 'global' && incoming.references && typeof incoming.references === 'object') {
    const fixed = {}
    for (const [t, arr] of Object.entries(incoming.references)) {
      fixed[normalizeReferenceType(t)] = (Array.isArray(arr) ? arr : [arr]).map((p) => resolve(String(p))).filter((p) => existsSync(p))
    }
    incoming.references = fixed
  }
  const { next: saved, created, aliasConflicts } = mutateBank(bankPath, (bank) => {
    const prev = matchCharacterForSave(bank.characters, { characterId: incoming.id, name: incoming.name })
    // A new character gets an id no other character uses (a renamed character may still own the name-derived id)
    const draft = prev ? incoming : { ...incoming, id: uniqueCharacterId(bank.characters, String(incoming.id || '').trim() || characterIdFor(nameKey(incoming.name))) }
    const next = normalizeCharacter(draft, prev)
    bank.characters = prev ? bank.characters.map((c) => (c === prev ? next : c)) : [...bank.characters, next]
    const nk = nameKey(next.name)
    const conflicts = bank.characters.filter((c) => c !== next && (c.aliases || []).some((a) => nameKey(a) === nk)).map((c) => ({ id: c.id, name: c.name }))
    return { next, created: !prev, aliasConflicts: conflicts }
  })
  return { ok: true, scope, character: saved, created, ...(aliasConflicts.length ? { aliasConflicts } : {}), bankPath }
}

export function deleteCharacter({ projectDir = '', scope = 'project', characterId = '', name = '', globalLibraryPath = '' } = {}) {
  if (scope === 'project' && !projectDir) throw inputError('删除项目角色需要 projectDir')
  const bankPath = scope === 'global' ? getGlobalCharacterLibraryPath(globalLibraryPath) : getProjectCharacterBankPath(projectDir)
  if (!existsSync(bankPath)) return { ok: false, deleted: null, message: '角色库为空' }
  const deleted = mutateBank(bankPath, (bank) => {
    const hit = matchCharacter(bank.characters, { characterId, name })
    if (hit) bank.characters = bank.characters.filter((c) => c !== hit)
    return hit
  })
  if (deleted && scope === 'project') {
    try {
      const { data } = readScriptJson(projectDir)
      let touched = false
      for (const sc of data.scenes || []) {
        if (Array.isArray(sc.characterIds) && sc.characterIds.includes(deleted.id)) {
          sc.characterIds = sc.characterIds.filter((id) => id !== deleted.id)
          touched = true
        }
      }
      if (touched) writeScriptJson(projectDir, data)
    } catch {}
  }
  return { ok: Boolean(deleted), deleted, message: deleted ? `已删除角色「${deleted.name}」` : '未找到该角色' }
}

/**
 * Attach reference images and/or scenes to a character. A character that only exists in the
 * global library is first copied into the project bank (its reference images are imported).
 */
export async function attachCharacter({
  projectDir,
  characterId = '',
  name = '',
  referenceType = 'face',
  paths = [],
  sceneIds = [],
  globalLibraryPath = '',
} = {}) {
  if (!projectDir) throw inputError('attach 需要 projectDir')
  const projectBank = readBank(getProjectCharacterBankPath(projectDir)).characters
  let target = matchCharacter(projectBank, { characterId, name })
  let copiedFromGlobal = false
  if (!target) {
    const globalHit = matchCharacter(readBank(getGlobalCharacterLibraryPath(globalLibraryPath)).characters, { characterId, name })
    if (!globalHit) throw inputError(`角色库中未找到角色: ${characterId || name}`, 404, 'CHARACTER_NOT_FOUND')
    const refs = {}
    for (const t of CHARACTER_REFERENCE_TYPES) {
      const absList = (globalHit.references?.[t] || []).filter((p) => existsSync(p))
      refs[t] = absList.length > 0 ? await normalizeProjectReferencePaths(projectDir, absList) : []
    }
    const saved = await saveCharacter({ projectDir, scope: 'project', character: { ...globalHit, references: refs } })
    target = saved.character
    copiedFromGlobal = true
  }
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean)
  if (list.length > 0) {
    const key = normalizeReferenceType(referenceType)
    const added = await normalizeProjectReferencePaths(projectDir, list)
    const res = await saveCharacter({
      projectDir,
      scope: 'project',
      character: { ...target, references: { ...target.references, [key]: uniq([...(target.references?.[key] || []), ...added]) } },
    })
    target = res.character
  }
  const boundScenes = []
  const wantScenes = (Array.isArray(sceneIds) ? sceneIds : [sceneIds]).map(String).filter(Boolean)
  if (wantScenes.length > 0) {
    const { data } = readScriptJson(projectDir)
    for (const sc of data.scenes || []) {
      if (!wantScenes.includes(sc.id)) continue
      sc.characterIds = uniq([...(Array.isArray(sc.characterIds) ? sc.characterIds : []), target.id])
      boundScenes.push(sc.id)
    }
    if (boundScenes.length > 0) writeScriptJson(projectDir, data)
  }
  return { ok: true, character: target, copiedFromGlobal, boundScenes }
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Find `@名字` / `@别名` mentions (longest token first, non-overlapping, works without spaces in CJK text).
 */
export function resolveCharacterMentions(text = '', characters = []) {
  const src = String(text || '')
  if (!src.includes('@') && !src.includes('＠')) return []
  const tokens = []
  for (const c of characters || []) {
    const ownName = String(c.name || '').trim()
    for (const tok of uniq([c.name, ...(c.aliases || [])].map((t) => String(t || '').trim()).filter(Boolean))) {
      tokens.push({ token: tok, character: c, isName: tok === ownName })
    }
  }
  // Longest token first; on a tie a character's own name wins over another character's alias (`@小张` → 小张, not 张三)
  tokens.sort((a, b) => b.token.length - a.token.length || Number(b.isName) - Number(a.isName))
  const taken = []
  const hits = []
  for (const { token, character } of tokens) {
    const re = new RegExp(`[@＠]${escapeRegExp(token)}`, 'g')
    let m
    while ((m = re.exec(src))) {
      const start = m.index
      const end = start + m[0].length
      if (taken.some(([s, e]) => start < e && end > s)) continue
      taken.push([start, end])
      hits.push({ characterId: character.id, name: character.name, token, index: start, character })
    }
  }
  return hits.sort((a, b) => a.index - b.index)
}

function resolveReferenceFile(projectDir, p) {
  if (!p) return ''
  if (isAbsolute(p)) return existsSync(p) ? p : ''
  if (!projectDir) return ''
  const abs = resolve(projectDir, p)
  return existsSync(abs) ? abs : ''
}

/**
 * Resolve the character context for a generation prompt.
 * @returns {{ mentioned: object[], prompt: string, descriptionBlock: string, references: object[], referenceSignatures: string[] }}
 */
export function buildCharacterPromptContext({
  projectDir = '',
  prompt = '',
  characterIds = [],
  globalLibraryPath = '',
  maxImagesPerCharacter = 2,
  maxImages = 4,
} = {}) {
  const all = listCharacters({ projectDir, scope: 'all', globalLibraryPath }).characters
  const byId = new Map()
  for (const c of all) if (!byId.has(c.id)) byId.set(c.id, c)
  const hits = resolveCharacterMentions(prompt, [...byId.values()])
  const chosen = []
  for (const h of hits) if (!chosen.some((c) => c.id === h.characterId)) chosen.push(byId.get(h.characterId))
  for (const id of characterIds || []) {
    const c = byId.get(id) || all.find((x) => x.name === id)
    if (c && !chosen.some((x) => x.id === c.id)) chosen.push(c)
  }
  if (chosen.length === 0) {
    return { mentioned: [], prompt: String(prompt || ''), descriptionBlock: '', references: [], referenceSignatures: [] }
  }
  // Replace "@token" with the canonical character name so providers see natural language
  let cleanPrompt = String(prompt || '')
  for (const h of [...hits].sort((a, b) => b.index - a.index)) {
    cleanPrompt = `${cleanPrompt.slice(0, h.index)}${h.name}${cleanPrompt.slice(h.index + 1 + h.token.length)}`
  }
  const references = []
  for (const c of chosen) {
    let perChar = 0
    for (const t of REF_PRIORITY) {
      for (const p of c.references?.[t] || []) {
        if (perChar >= maxImagesPerCharacter || references.length >= maxImages) break
        const abs = resolveReferenceFile(c.scope === 'global' ? '' : projectDir, p)
        if (!abs) continue
        let sig = ''
        try {
          const st = statSync(abs)
          sig = `${c.id}|${t}|${toPosixRel(p)}|${st.size}|${Math.round(st.mtimeMs)}`
        } catch {
          continue
        }
        references.push({ characterId: c.id, name: c.name, type: t, path: abs, relPath: toPosixRel(p), signature: sig })
        perChar++
      }
    }
  }
  const descriptionBlock = chosen
    .map((c) => `${c.name}${c.aliases?.length ? `（又名 ${c.aliases.join('、')}）` : ''}：${c.description || describeFigureZh(c.figure) || '保持与参考形象一致的外貌、发型、服装与气质'}`)
    .join('；')
  return {
    mentioned: chosen.map((c) => ({ id: c.id, name: c.name, scope: c.scope || 'project' })),
    prompt: cleanPrompt,
    descriptionBlock: `【角色设定·保持形象一致】${descriptionBlock}`,
    references,
    referenceSignatures: references.map((r) => r.signature),
  }
}

/**
 * Read reference images as base64 payloads for provider APIs (bounded by size and count).
 */
export function loadReferenceImagePayloads(references = [], { maxBytesPerImage = 6 * 1024 * 1024, maxImages = 4 } = {}) {
  const out = []
  for (const ref of references) {
    if (out.length >= maxImages) break
    const ext = extname(ref.path || '').toLowerCase()
    const mime = IMAGE_MIME[ext]
    if (!mime) continue
    try {
      const st = statSync(ref.path)
      if (!st.isFile() || st.size <= 0 || st.size > maxBytesPerImage) continue
      const b64 = readFileSync(ref.path).toString('base64')
      out.push({ ...ref, mime, base64: b64, dataUri: `data:${mime};base64,${b64}` })
    } catch {}
  }
  return out
}
