#!/usr/bin/env node
/**
 * Project-safety REST routes test (lib/routes-project.js) — runs fully offline in a scratch workspace.
 *
 *   node scripts/tests/project-safety.test.mjs
 *
 * Covers: version history (snapshot / dedupe / list / diff / restore / prune), scene locks + user overrides,
 * character bank (project + isolated global library), stock search "not configured" path, cloud-jobs ledger,
 * targeted refine dry-run (no LLM call), validation errors, method guard, and path-traversal / unknown-dir refusal;
 * client-input errors raised inside the modules (unknown version / scene / character …) map to 400 / 404 (review F8).
 * Never touches the user's real projects: DSH_VIDEO_WORKSPACE / DSH_VIDEO_HOME point into the scratch folder,
 * and stock API keys are blanked for the process.
 *
 * Afterwards runs the core logic suite (scripts/tests/project-safety.core.mjs: paid-job ledger resume / dedupe,
 * billing classification + run stop, history snapshot / diff / restore / GC, scene locks across re-plan / re-code /
 * refine / audio, overrides + three-way merge, character reference injection, mocked Pexels / Pixabay, time / region
 * mapping) and prints one combined PASS / FAIL summary; exit code is non-zero on any failure.
 *   DSH_VIDEO_ENV_PATH=/path/to/.env node scripts/tests/project-safety.test.mjs
 * Network: globalThis.fetch is blocked (every test mocks its own requests). Scratch lives under
 * <main checkout>/.tmp/openfilm-project/ and is removed without following links / junctions.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const MAIN_CHECKOUT = /[\\/]\.claude[\\/]worktrees[\\/]/.test(REPO) ? resolve(REPO, '..', '..', '..') : REPO
if (!process.env.DSH_VIDEO_ENV_PATH) {
  const envCandidate = [join(REPO, '.env'), join(MAIN_CHECKOUT, '.env')].find((p) => existsSync(p))
  if (envCandidate) process.env.DSH_VIDEO_ENV_PATH = envCandidate
}
const SCRATCH = resolve(process.env.DSH_PROJECT_SAFETY_TEST_DIR || join(MAIN_CHECKOUT, '.tmp', 'openfilm-project', `routes-${process.pid}`))
const WS = join(SCRATCH, 'workspace')
const HOME = join(SCRATCH, 'dsh-home')
mkdirSync(WS, { recursive: true })
mkdirSync(HOME, { recursive: true })
process.env.DSH_VIDEO_WORKSPACE = WS
process.env.DSH_VIDEO_HOME = HOME
// Studio-saved stock keys live in the cloud-media config: point it at a scratch file (never the dev machine's)
process.env.DSH_VIDEO_CLOUD_MEDIA_CONFIG = join(SCRATCH, 'cloud-media.json')
// Keep the stock search offline: no keys → deterministic "not configured" result
for (const k of ['PEXELS_API_KEY', 'PIXABAY_API_KEY', 'DSH_STOCK_PEXELS_API_KEY', 'DSH_STOCK_PIXABAY_API_KEY']) process.env[k] = ''
// Network guard: no route test may reach a real provider / LLM (the core suite installs its own per-test mocks)
globalThis.fetch = async (input) => {
  throw new Error(`[project-safety] un-mocked network request blocked: ${typeof input === 'string' ? input : input?.url || input}`)
}

/** Delete a scratch tree without following symlinks / Windows junctions (node_modules links are unlinked only). */
function removeTreeNoFollow(target) {
  let st
  try {
    st = lstatSync(target)
  } catch {
    return
  }
  if (st.isSymbolicLink() || !st.isDirectory()) {
    try {
      unlinkSync(target)
    } catch {
      try {
        rmdirSync(target)
      } catch {}
    }
    return
  }
  for (const name of readdirSync(target)) removeTreeNoFollow(join(target, name))
  try {
    rmdirSync(target)
  } catch {}
}

const imp = (rel) => import(pathToFileURL(join(REPO, rel)).href)
const routes = await imp('packages/dsh-web-video-workbench/lib/routes-project.js')
const { handleProjectApiRequest, PROJECT_ROUTES, isProjectRoute } = routes

const results = []
async function test(name, fn) {
  const t0 = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - t0 })
    console.log(`✓ ${name}`)
  } catch (err) {
    results.push({ name, ok: false, error: err?.stack || String(err) })
    console.log(`✗ ${name}\n    ${String(err?.message || err)}`)
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

async function call(method, path, { query = {}, body } = {}) {
  const url = new URL(`http://127.0.0.1${path}`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))
  const req = new Request(url.href, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  })
  const res = await handleProjectApiRequest(req, url, {
    createBackgroundJob: (message, runner) => {
      const id = `job-${Date.now()}`
      runner(() => {}).catch(() => {})
      return { id, message }
    },
  })
  if (!res) return { status: 0, data: null }
  return { status: res.status, data: await res.json() }
}
const P = '/api/video-workbench/project'

// ---------------------------------------------------------------------------------------------
// Fixture project
// ---------------------------------------------------------------------------------------------
const projectDir = join(WS, 'safety-demo')
mkdirSync(join(projectDir, 'assets', 'images'), { recursive: true })
const baseScript = {
  title: '工程安全测试',
  engine: 'html',
  fps: 30,
  width: 1920,
  height: 1080,
  totalDurationSec: 6,
  totalDurationInFrames: 180,
  scenes: [
    { id: 'scene-01', index: 1, title: '第一幕：开场', narration: '这是第一幕旁白', durationSec: 3, durationInFrames: 90, startFrame: 0 },
    { id: 'scene-02', index: 2, title: '第二幕：展开', narration: '这是第二幕旁白', durationSec: 3, durationInFrames: 90, startFrame: 90 },
  ],
}
writeFileSync(join(projectDir, 'script.json'), JSON.stringify(baseScript, null, 2))
writeFileSync(join(projectDir, 'index.html'), '<!doctype html><title>demo</title>')
// a tiny PNG reference image for the character bank
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PzWvWQAAAABJRU5ErkJggg==', 'base64')
writeFileSync(join(projectDir, 'assets', 'images', 'hero-face.png'), PNG_1x1)
const readScript = () => JSON.parse(readFileSync(join(projectDir, 'script.json'), 'utf8'))

// ---------------------------------------------------------------------------------------------
await test('route catalog: 17 routes, all under /project, isProjectRoute matches exactly', async () => {
  assert(PROJECT_ROUTES.length === 17, `expected 17 routes, got ${PROJECT_ROUTES.length}`)
  assert(PROJECT_ROUTES.every((r) => r.path.startsWith(`${P}/`) && Array.isArray(r.methods) && r.methods.length === 1), 'malformed route entry')
  assert(isProjectRoute(`${P}/history`) && !isProjectRoute(`${P}/history/`) && !isProjectRoute(`${P}/historyx`), 'isProjectRoute is not exact')
  const r = await call('GET', '/api/video-workbench/state')
  assert(r.status === 0 && r.data === null, 'non-project route must return null')
})

await test('method guard → 405 with allowed methods', async () => {
  const r = await call('GET', `${P}/history/snapshot`)
  assert(r.status === 405 && r.data.ok === false && /POST/.test(r.data.error), JSON.stringify(r))
})

await test('projectDir validation: missing / relative / traversal / not-a-project', async () => {
  const miss = await call('GET', `${P}/history`)
  assert(miss.status === 400 && /projectDir/.test(miss.data.error), JSON.stringify(miss))
  const rel = await call('GET', `${P}/history`, { query: { projectDir: '../../etc' } })
  assert(rel.status === 400 && /绝对路径/.test(rel.data.error), JSON.stringify(rel))
  const nul = await call('POST', `${P}/scene-lock`, { body: { projectDir: `${projectDir}\0x`, sceneId: 'scene-01' } })
  assert(nul.status === 400, JSON.stringify(nul))
  const noScript = await call('GET', `${P}/scene-edits`, { query: { projectDir: WS } })
  assert(noScript.status === 404 && /script\.json/.test(noScript.data.error), JSON.stringify(noScript))
  const gone = await call('GET', `${P}/scene-edits`, { query: { projectDir: join(WS, 'does-not-exist') } })
  assert(gone.status === 404, JSON.stringify(gone))
})

let v1 = null
let v2 = null
await test('history: manual snapshot, dedupe, second version after an edit, list', async () => {
  const s1 = await call('POST', `${P}/history/snapshot`, { body: { projectDir, label: '基线', note: '测试基线' } })
  assert(s1.status === 200 && s1.data.ok && s1.data.version?.id, JSON.stringify(s1))
  v1 = s1.data.version.id
  const dup = await call('POST', `${P}/history/snapshot`, { body: { projectDir, label: '重复' } })
  assert(dup.data.ok && (dup.data.version?.deduped || /一致/.test(dup.data.message || '')), `expected dedupe: ${JSON.stringify(dup.data)}`)
  const edited = readScript()
  edited.scenes[1].title = '第二幕：改写后的标题'
  writeFileSync(join(projectDir, 'script.json'), JSON.stringify(edited, null, 2))
  const s2 = await call('POST', `${P}/history/snapshot`, { body: { projectDir, label: '改标题' } })
  assert(s2.data.ok && s2.data.version?.id && s2.data.version.id !== v1, JSON.stringify(s2.data))
  v2 = s2.data.version.id
  const list = await call('GET', `${P}/history`, { query: { projectDir, limit: 50 } })
  const ids = (list.data.versions || []).map((v) => v.id)
  assert(list.data.ok !== false && ids.includes(v1) && ids.includes(v2), `versions missing: ${JSON.stringify(ids)}`)
})

await test('history: diff v1 → current reports the changed scene title', async () => {
  const d = await call('POST', `${P}/history/diff`, { body: { projectDir, fromVersionId: v1 } })
  assert(d.status === 200 && d.data.ok !== false, JSON.stringify(d.data).slice(0, 400))
  const txt = JSON.stringify(d.data)
  assert(/scene-02/.test(txt) && /title/.test(txt), `diff does not mention scene-02 title: ${txt.slice(0, 600)}`)
  const bad = await call('POST', `${P}/history/diff`, { body: { projectDir } })
  assert(bad.status === 400 && /fromVersionId/.test(bad.data.error), JSON.stringify(bad))
})

await test('history: restore v1 brings the old title back and backs up the current state', async () => {
  const r = await call('POST', `${P}/history/restore`, { body: { projectDir, versionId: v1 } })
  assert(r.status === 200 && r.data.ok !== false, JSON.stringify(r.data).slice(0, 400))
  assert(readScript().scenes[1].title === '第二幕：展开', `title not restored: ${readScript().scenes[1].title}`)
  assert(r.data.sceneCount === 2 && /已恢复到版本/.test(r.data.message || ''), JSON.stringify(r.data).slice(0, 300))
  const missing = await call('POST', `${P}/history/restore`, { body: { projectDir } })
  assert(missing.status === 400, JSON.stringify(missing))
})

await test('history: prune keeps the history usable', async () => {
  const r = await call('POST', `${P}/history/prune`, { body: { projectDir, max: 5 } })
  assert(r.status === 200 && r.data.ok !== false, JSON.stringify(r.data).slice(0, 300))
  const list = await call('GET', `${P}/history`, { query: { projectDir } })
  assert((list.data.versions || []).length >= 1 && (list.data.versions || []).length <= 5, `unexpected version count ${(list.data.versions || []).length}`)
})

await test('scene lock / unlock + validation', async () => {
  const lock = await call('POST', `${P}/scene-lock`, { body: { projectDir, sceneId: 'scene-01', reason: '人工精修完成' } })
  assert(lock.status === 200 && lock.data.ok, JSON.stringify(lock.data))
  assert(readScript().scenes[0].locked === true, 'scene-01 not locked in script.json')
  const edits = await call('GET', `${P}/scene-edits`, { query: { projectDir } })
  assert(JSON.stringify(edits.data).includes('scene-01'), `scene-edits missing lock: ${JSON.stringify(edits.data).slice(0, 300)}`)
  const unlock = await call('POST', `${P}/scene-lock`, { body: { projectDir, sceneIds: ['scene-01'], locked: false } })
  assert(unlock.data.ok && !readScript().scenes[0].locked, 'scene-01 still locked')
  const none = await call('POST', `${P}/scene-lock`, { body: { projectDir } })
  assert(none.status === 400, JSON.stringify(none))
  const ghost = await call('POST', `${P}/scene-lock`, { body: { projectDir, sceneId: 'scene-99' } })
  assert(ghost.status === 404 && ghost.data.ok === false, JSON.stringify(ghost))
})

await test('scene overrides: set, list, clear field, reject bad payloads', async () => {
  const set = await call('POST', `${P}/scene-overrides`, { body: { projectDir, sceneId: 'scene-02', overrides: { title: '用户锁定的标题', narration: '用户改写的旁白' } } })
  assert(set.status === 200 && set.data.ok !== false, JSON.stringify(set.data))
  const sc = readScript()
  assert(sc.userOverrides?.['scene-02']?.title === '用户锁定的标题', `override not persisted: ${JSON.stringify(sc.userOverrides)}`)
  const clear = await call('POST', `${P}/scene-overrides`, { body: { projectDir, sceneId: 'scene-02', clearFields: ['narration'] } })
  assert(clear.data.ok !== false && readScript().userOverrides?.['scene-02']?.narration === undefined, 'narration override not cleared')
  const arr = await call('POST', `${P}/scene-overrides`, { body: { projectDir, sceneId: 'scene-02', overrides: ['x'] } })
  assert(arr.status === 400, JSON.stringify(arr))
  const empty = await call('POST', `${P}/scene-overrides`, { body: { projectDir, sceneId: 'scene-02' } })
  assert(empty.status === 400, JSON.stringify(empty))
  const noId = await call('POST', `${P}/scene-overrides`, { body: { projectDir, overrides: { title: 'x' } } })
  assert(noId.status === 400 && /sceneId/.test(noId.data.error), JSON.stringify(noId))
})

await test('scene overrides batch: record several scenes in one write, ignore unknown ids, reject unsafe paths, clear', async () => {
  const before = readScript().userOverrides || {}
  const rec = await call('POST', `${P}/scene-overrides/batch`, {
    body: { projectDir, edits: { 'scene-01': { transition: 'iris-circle' }, 'scene-02': { voiceId: 'v-test', voiceLocked: true, voiceCastBy: 'manual' }, 'scene-404': { title: 'ghost' } } },
  })
  assert(rec.status === 200 && rec.data.ok === true, JSON.stringify(rec.data))
  assert(rec.data.recorded.length === 2 && rec.data.missing.includes('scene-404'), JSON.stringify(rec.data))
  const sc = readScript()
  assert(sc.userOverrides?.['scene-01']?.transition === 'iris-circle' && sc.userOverrides?.['scene-02']?.voiceCastBy === 'manual', JSON.stringify(sc.userOverrides))
  assert(sc.scenes.find((x) => x.id === 'scene-01')?.transition === 'iris-circle', 'override not applied to the scene')
  assert(!sc.userOverrides?.['scene-404'], 'unknown scene must not get overrides')
  const proto = await call('POST', `${P}/scene-overrides/batch`, { body: { projectDir, edits: { 'scene-01': { '__proto__.x': 1 } } } })
  assert(proto.status >= 400 && proto.data.ok === false, JSON.stringify(proto))
  assert(({}).x === undefined, 'prototype polluted')
  const locked = await call('POST', `${P}/scene-overrides/batch`, { body: { projectDir, edits: { 'scene-01': { locked: false } } } })
  assert(locked.status >= 400 && locked.data.ok === false, JSON.stringify(locked))
  const noEdits = await call('POST', `${P}/scene-overrides/batch`, { body: { projectDir, edits: ['x'] } })
  assert(noEdits.status === 400, JSON.stringify(noEdits))
  const clr = await call('POST', `${P}/scene-overrides/batch`, { body: { projectDir, clear: true, sceneIds: ['scene-01'] } })
  assert(clr.data.ok === true && clr.data.cleared.join() === 'scene-01', JSON.stringify(clr.data))
  const after = readScript().userOverrides || {}
  assert(!after['scene-01'] && after['scene-02']?.voiceId === 'v-test', JSON.stringify(after))
  const all = await call('POST', `${P}/scene-overrides/batch`, { body: { projectDir, clear: true } })
  assert(all.data.ok === true && Object.keys(readScript().userOverrides || {}).filter((k) => k !== '__project__').length === 0, JSON.stringify(all.data))
  // restore whatever the earlier override test left behind
  for (const [sceneId, fields] of Object.entries(before)) {
    if (sceneId === '__project__') continue
    await call('POST', `${P}/scene-overrides`, { body: { projectDir, sceneId, overrides: fields } })
  }
})

let charId = ''
await test('character bank: save (project) → list → attach reference + scenes → delete', async () => {
  const save = await call('POST', `${P}/characters/save`, {
    body: { projectDir, scope: 'project', character: { name: '霍去病', aliases: ['冠军侯'], description: '少年将军，银甲红缨' } },
  })
  assert(save.status === 200 && save.data.ok !== false, JSON.stringify(save.data).slice(0, 300))
  charId = save.data.character?.id || save.data.id || ''
  assert(charId, `no character id: ${JSON.stringify(save.data).slice(0, 300)}`)
  const list = await call('GET', `${P}/characters`, { query: { projectDir, scope: 'project' } })
  assert(JSON.stringify(list.data).includes('霍去病'), 'saved character not listed')
  const attach = await call('POST', `${P}/characters/attach`, {
    body: { projectDir, characterId: charId, referenceType: 'face', paths: ['assets/images/hero-face.png'], sceneIds: ['scene-01'] },
  })
  assert(attach.status === 200 && attach.data.ok !== false, JSON.stringify(attach.data).slice(0, 400))
  const noRefs = await call('POST', `${P}/characters/attach`, { body: { projectDir, characterId: charId } })
  assert(noRefs.status === 400, JSON.stringify(noRefs))
  const del = await call('POST', `${P}/characters/delete`, { body: { projectDir, scope: 'project', characterId: charId } })
  assert(del.status === 200 && del.data.ok, JSON.stringify(del.data))
  const del2 = await call('POST', `${P}/characters/delete`, { body: { projectDir, scope: 'project', characterId: charId } })
  assert(del2.status === 404 && del2.data.ok === false, JSON.stringify(del2))
})

await test('character bank: global scope goes to the isolated DSH_VIDEO_HOME library', async () => {
  const save = await call('POST', `${P}/characters/save`, { body: { scope: 'global', character: { name: '全局测试角色' } } })
  assert(save.data.ok !== false, JSON.stringify(save.data).slice(0, 300))
  assert(existsSync(join(HOME, 'characters', 'library.json')), 'global library not written into the scratch DSH_VIDEO_HOME')
  const noName = await call('POST', `${P}/characters/save`, { body: { projectDir, character: { name: '  ' } } })
  assert(noName.status === 400 && /name/.test(noName.data.error), JSON.stringify(noName))
  const gid = save.data.character?.id || save.data.id
  const del = await call('POST', `${P}/characters/delete`, { body: { scope: 'global', characterId: gid } })
  assert(del.data.ok, JSON.stringify(del.data))
})

await test('stock search without API keys → configured:false (not a server error); import validation', async () => {
  const r = await call('POST', `${P}/stock/search`, { body: { query: '沙漠骑兵', mediaType: 'image' } })
  assert(r.status === 200 && r.data.configured === false, `expected configured:false, got ${JSON.stringify(r.data).slice(0, 300)}`)
  const noQ = await call('POST', `${P}/stock/search`, { body: {} })
  assert(noQ.status === 400, JSON.stringify(noQ))
  const badProv = await call('POST', `${P}/stock/import`, { body: { projectDir, provider: 'evil', id: '1' } })
  assert(badProv.status === 400 && /provider/.test(badProv.data.error), JSON.stringify(badProv))
})

await test('cloud-jobs ledger lists (empty) and adds a sourcing plan on request', async () => {
  const r = await call('GET', `${P}/cloud-jobs`, { query: { projectDir, plan: 1 } })
  assert(r.status === 200 && r.data.ok !== false, JSON.stringify(r.data).slice(0, 300))
  assert(Array.isArray(r.data.jobs) || Array.isArray(r.data.items), `no jobs array: ${JSON.stringify(r.data).slice(0, 300)}`)
  assert(r.data.sourcingPlan && typeof r.data.sourcingPlan === 'object', 'sourcingPlan missing')
})

await test('refine: dry-run maps a time range without calling the LLM; validation', async () => {
  const before = readFileSync(join(projectDir, 'script.json'), 'utf8')
  const r = await call('POST', `${P}/refine`, { body: { projectDir, dryRun: true, timeRange: { startSec: 3.2, endSec: 4.0 }, region: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 } } })
  assert(r.status === 200, JSON.stringify(r.data).slice(0, 400))
  assert(JSON.stringify(r.data).includes('scene-02'), `dry-run did not map 3.2–4.0 s to scene-02: ${JSON.stringify(r.data).slice(0, 500)}`)
  assert(readFileSync(join(projectDir, 'script.json'), 'utf8') === before, 'dry-run modified script.json')
  const noInstr = await call('POST', `${P}/refine`, { body: { projectDir } })
  assert(noInstr.status === 400 && /instruction/.test(noInstr.data.error), JSON.stringify(noInstr))
  const badRange = await call('POST', `${P}/refine`, { body: { projectDir, dryRun: true, timeRange: { startSec: 'a' } } })
  assert(badRange.status === 400, JSON.stringify(badRange))
  const ghost = await call('POST', `${P}/refine`, { body: { projectDir, instruction: '改一下', sceneId: 'scene-99' } })
  assert(ghost.status === 404, JSON.stringify(ghost))
  const badJson = await call('POST', `${P}/refine`, { body: '{not json' })
  assert(badJson.status === 400 && /projectDir/.test(badJson.data.error), JSON.stringify(badJson))
})

await test('client-input errors raised inside the project modules → 400 / 404 with the Chinese message, never 500 (review F8)', async () => {
  const before = readFileSync(join(projectDir, 'script.json'), 'utf8')
  const cases = [
    ['history/restore unknown versionId', `${P}/history/restore`, { projectDir, versionId: 'ver-does-not-exist' }, 404, /未找到历史版本/],
    ['history/diff unknown fromVersionId', `${P}/history/diff`, { projectDir, fromVersionId: 'ver-nope' }, 404, /未找到历史版本/],
    ['scene-overrides unknown sceneId', `${P}/scene-overrides`, { projectDir, sceneId: 'scene-99', overrides: { title: 'x' } }, 404, /未找到场景 scene-99/],
    ['scene-overrides protected field', `${P}/scene-overrides`, { projectDir, sceneId: 'scene-01', overrides: { id: 'x' } }, 400, /受保护/],
    ['scene-overrides/batch protected field', `${P}/scene-overrides/batch`, { projectDir, edits: { 'scene-01': { locked: false } } }, 400, /受保护/],
    ['characters/attach unknown character', `${P}/characters/attach`, { projectDir, name: 'nobody', sceneIds: ['scene-01'] }, 404, /未找到角色/],
    ['characters/save missing reference file', `${P}/characters/save`, { projectDir, character: { name: '无图角色', references: { face: ['assets/none.png'] } } }, 404, /角色参考图不存在/],
    ['refine dry-run unknown sceneIds', `${P}/refine`, { projectDir, dryRun: true, sceneIds: ['scene-77'] }, 404, /未找到场景 scene-77/],
    ['refine dry-run reversed time range', `${P}/refine`, { projectDir, dryRun: true, timeRange: { startSec: 4, endSec: 2 } }, 400, /时间范围无效/],
    ['refine dry-run region outside the frame', `${P}/refine`, { projectDir, dryRun: true, region: { x: 1.2, y: 0.1, w: 0.2, h: 0.2, unit: 'norm' } }, 400, /区域 region/],
    ['refine dry-run scene outside the time range', `${P}/refine`, { projectDir, dryRun: true, sceneId: 'scene-01', timeRange: { startSec: 3.5, endSec: 4.5 } }, 400, /不在所选时间范围/],
  ]
  for (const [label, path, body, status, message] of cases) {
    const r = await call('POST', path, { body })
    assert(
      r.status === status && r.data.ok === false && message.test(r.data.error || '') && typeof r.data.code === 'string' && r.data.code.length > 0,
      `${label}: expected HTTP ${status} + message + code, got ${r.status} ${JSON.stringify(r.data).slice(0, 240)}`,
    )
  }
  assert(readFileSync(join(projectDir, 'script.json'), 'utf8') === before, 'a rejected request changed script.json')
  const listed = await call('GET', `${P}/characters`, { query: { projectDir, scope: 'project' } })
  assert(!JSON.stringify(listed.data).includes('无图角色'), 'a character with a missing reference image was saved anyway')
})

await test('stock import via REST: mocked Pexels search + official CDN download keeps attribution', async () => {
  const prevFetch = globalThis.fetch
  const seen = []
  process.env.PEXELS_API_KEY = 'pexels-test-key'
  globalThis.fetch = async (input, init = {}) => {
    const u = typeof input === 'string' ? input : input.url
    seen.push(u)
    if (u.startsWith('https://api.pexels.com/v1/search')) {
      assert(init.headers?.Authorization === 'pexels-test-key', 'Pexels Authorization header missing')
      return new Response(JSON.stringify({ total_results: 1, photos: [{ id: 77, width: 1920, height: 1080, url: 'https://www.pexels.com/photo/77/', photographer: 'Eve', src: { large2x: 'https://images.pexels.com/p77.jpg' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (u === 'https://images.pexels.com/p77.jpg') return new Response(PNG_1x1, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(PNG_1x1.length) } })
    throw new Error(`unexpected request ${u}`)
  }
  try {
    const s = await call('POST', `${P}/stock/search`, { body: { query: '骑兵', provider: 'pexels' } })
    assert(s.status === 200 && s.data.ok && s.data.results.length === 1, JSON.stringify(s.data).slice(0, 300))
    const item = s.data.results[0]
    const imp1 = await call('POST', `${P}/stock/import`, { body: { projectDir, item, sceneId: 'scene-02', query: '骑兵' } })
    assert(imp1.status === 200 && imp1.data.ok, JSON.stringify(imp1.data).slice(0, 300))
    const manifest = JSON.parse(readFileSync(join(projectDir, 'assets.json'), 'utf8'))
    const asset = manifest.items.find((it) => it.id === imp1.data.asset.id)
    assert(asset?.stock?.author === 'Eve' && asset.attribution === 'Photo by Eve on Pexels', `attribution missing: ${JSON.stringify(asset)}`)
    assert(readScript().scenes[1].media?.[0]?.assetId === asset.id, 'scene-02 not bound to the imported asset')
    assert(seen.every((u) => /^https:\/\/(api|images)\.pexels\.com\//.test(u)), `non-official host contacted: ${seen.join(', ')}`)
  } finally {
    globalThis.fetch = prevFetch
    process.env.PEXELS_API_KEY = ''
  }
})

await test('refine via REST (async job, mocked LLM): runs in the background job and changes index.html', async () => {
  const prevFetch = globalThis.fetch
  const html = `<!doctype html><html><head><script id="dsh-script-data" type="application/json">{}</script><script>window.__totalFrames = 180; window.__seekToFrame = async () => {}</script></head><body><template data-scene-id="scene-01"><div>ONE</div></template><template data-scene-id="scene-02"><div>TWO</div></template><div id="ai-badge"></div></body></html>`
  writeFileSync(join(projectDir, 'index.html'), html)
  process.env.LLM_MODE = 'custom'
  process.env.LLM_BASE_URL = 'https://llm.mock.test/v1'
  process.env.LLM_MODEL = 'mock-model'
  process.env.LLM_API_KEY = 'sk-test'
  process.env.LLM_FORMAT = 'openai-completions'
  let llmCalls = 0
  globalThis.fetch = async (input) => {
    const u = typeof input === 'string' ? input : input.url
    if (!u.startsWith('https://llm.mock.test/')) throw new Error(`unexpected request ${u}`)
    llmCalls++
    const files = { 'index.html': html.replace('<div>TWO</div>', '<div>TWO-REFINED</div>') }
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ files }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  let jobPromise = null
  try {
    const url = new URL(`http://127.0.0.1${P}/refine`)
    const req = new Request(url.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir, instruction: '第二幕文字改成金色', timeRange: { startSec: 3.5, endSec: 5 }, render: false, async: true }),
    })
    const res = await handleProjectApiRequest(req, url, {
      createBackgroundJob: (message, runner) => {
        jobPromise = runner(() => {})
        return { id: 'job-refine-test', message }
      },
    })
    const data = await res.json()
    assert(res.status === 200 && data.async === true && data.jobId === 'job-refine-test', JSON.stringify(data))
    const out = await jobPromise
    assert(out.ok === true && llmCalls === 1, `refine job failed: ${JSON.stringify(out).slice(0, 300)}`)
    assert(JSON.stringify(out.targeted.affectedSceneIds) === '["scene-02"]', JSON.stringify(out.targeted))
    assert(readFileSync(join(projectDir, 'index.html'), 'utf8').includes('TWO-REFINED'), 'index.html not updated by the refine job')
    assert(out.beforeVersionId && out.afterVersionId && out.diff, 'refine did not snapshot before/after with a diff')
  } finally {
    globalThis.fetch = prevFetch
    for (const k of ['LLM_MODE', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_FORMAT']) delete process.env[k]
  }
})

// ---------------------------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok)
console.log(`\nproject-safety routes: ${results.length - failed.length}/${results.length} passed\n`)
if (failed.length === 0 && !process.env.DSH_PROJECT_SAFETY_KEEP) {
  removeTreeNoFollow(SCRATCH)
} else if (failed.length) {
  console.log(`scratch kept for inspection: ${SCRATCH}`)
}

// Core logic suite (ledger / billing / history / locks / characters / stock / refine mapping)
const { runCoreTests } = await imp('scripts/tests/project-safety.core.mjs')
const core = await runCoreTests()
const allFailed = [...failed, ...core.results.filter((r) => !r.ok)]
const total = results.length + core.results.length
console.log(`\n================ project-safety SUMMARY ================`)
console.log(`routes: ${results.length - failed.length}/${results.length} PASS · core: ${core.passed}/${core.results.length} PASS`)
console.log(`TOTAL: ${total - allFailed.length} PASS · ${allFailed.length} FAIL`)
for (const f of allFailed) console.log(`  FAIL ${f.name}`)
process.exit(allFailed.length ? 1 : 0)
