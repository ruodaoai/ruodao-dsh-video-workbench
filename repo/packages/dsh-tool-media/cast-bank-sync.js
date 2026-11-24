/**
 * 演员表 ↔ 角色库 — one appearance per person for the animated figures *and* the cloud image / video prompts.
 *
 * After the director writes the film's cast:
 *   - a cast member that already exists in the character bank (project first, then the global library; matched by
 *     name or alias) keeps the bank's figure look (the bank wins field by field) and its description;
 *   - a global-library character is copied into the project bank (description, aliases, figure look);
 *   - a new, named cast member is saved to the project bank (description + figure look), so `@名字` in a cloud
 *     prompt and `castLook(scene, id)` in a coded scene describe the same person;
 *   - every shot that shows a cast member is bound to the bank character (`scene.characterIds`).
 * Generic placeholders (cast1, 主角, 士兵, 人群 …) and pronouns are never saved or matched.
 */
import { listCharacters, saveCharacter } from './character-bank.js'
import { describeFigureZh, mergeFigureLooks, normalizeFigureLook } from './figure-kit.js'

const GENERIC_NAME_RX = /^(cast\d+|hero|heroine|主角|配角|群像|路人|士兵|兵卒|众人|人群|观众|旁白|讲解员|narrator|host|you)$/i
const PRONOUNS = new Set(['你', '我', '他', '她', '您', '你们', '我们', '他们'])

const keyOf = (s) => String(s || '').trim().replace(/^@+/, '').toLowerCase()

function namesOf(entry) {
  return [entry?.name, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])].map(keyOf).filter((k) => k && !PRONOUNS.has(k))
}

function findCharacter(list, castMember) {
  const want = new Set(namesOf(castMember))
  if (!want.size) return null
  const byName = list.find((c) => want.has(keyOf(c.name)))
  if (byName) return byName
  return list.find((c) => namesOf(c).some((k) => want.has(k))) || null
}

/**
 * Link the script's cast with the character bank (mutates `script.cast` and `script.scenes[].characterIds`).
 * Returns { linked, created, updated } character names.
 */
export async function syncCastWithCharacterBank({ projectDir, script, globalLibraryPath = '' } = {}) {
  const out = { linked: [], created: [], updated: [] }
  const cast = Array.isArray(script?.cast) ? script.cast : []
  if (!projectDir || cast.length === 0) return out
  const bank = listCharacters({ projectDir, scope: 'all', globalLibraryPath })
  const project = Array.isArray(bank.project) ? bank.project : []
  const global = Array.isArray(bank.global) ? bank.global : []
  for (const c of cast) {
    if (!c || typeof c !== 'object') continue
    const projectHit = findCharacter(project, c)
    const globalHit = projectHit ? null : findCharacter(global, c)
    const hit = projectHit || globalHit
    if (hit) {
      const bankFigure = hit.figure && typeof hit.figure === 'object' ? normalizeFigureLook(hit.figure) : {}
      c.figure = mergeFigureLooks(bankFigure, c.figure || {})
      if (!c.look && hit.description) c.look = String(hit.description).slice(0, 120)
      if (projectHit) {
        c.bankId = projectHit.id
        if (!projectHit.figure || Object.keys(projectHit.figure).length === 0) {
          // the bank entry had no figure look yet: keep the one this film settled on
          await saveCharacter({ projectDir, scope: 'project', character: { ...projectHit, figure: c.figure } })
          out.updated.push(projectHit.name)
        }
      } else {
        const saved = await saveCharacter({
          projectDir,
          scope: 'project',
          character: { name: globalHit.name, aliases: globalHit.aliases || [], description: globalHit.description || c.look || describeFigureZh(c.figure), figure: c.figure, tags: [...new Set([...(globalHit.tags || []), '演员表'])] },
        })
        c.bankId = saved.character.id
        project.push(saved.character)
      }
      out.linked.push(hit.name)
      continue
    }
    const name = String(c.name || '').trim()
    if (!name || GENERIC_NAME_RX.test(name) || PRONOUNS.has(name)) continue
    const saved = await saveCharacter({
      projectDir,
      scope: 'project',
      character: {
        name,
        aliases: (Array.isArray(c.aliases) ? c.aliases : []).filter((a) => a && !PRONOUNS.has(String(a).trim())),
        description: c.look || describeFigureZh(c.figure) || c.role || '',
        figure: c.figure || {},
        tags: ['演员表'],
      },
    })
    c.bankId = saved.character.id
    project.push(saved.character)
    out.created.push(name)
  }
  // bind shots to the bank characters they show (cloud generation for a shot then attaches their reference images)
  for (const sc of Array.isArray(script.scenes) ? script.scenes : []) {
    if (!sc || !Array.isArray(sc.castIds) || sc.castIds.length === 0) continue
    const ids = sc.castIds.map((cid) => cast.find((m) => m.id === cid)?.bankId).filter(Boolean)
    if (ids.length) sc.characterIds = [...new Set([...(Array.isArray(sc.characterIds) ? sc.characterIds : []), ...ids])]
  }
  return out
}
