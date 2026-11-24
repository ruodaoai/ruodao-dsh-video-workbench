#!/usr/bin/env node
/**
 * 影核广场社区 tests (specs/19-plaza-community.md):
 *   · privacy gate — paths / user folders / keys / foreign e-mails cleaned, user names need confirmation, binary scan
 *   · submission package — dry run (what will be shared), build (zip + files + submission.json sha256), preview ≤ 15 s,
 *     metadata-free preview / cover, list / mark / delete, GitHub issue + mailto links match the issue form field ids
 *   · reveal path guard (traversal, unknown id, junction pointing outside)
 *   · maintainer CLI — review (incl. tampered / disallowed / too long / privacy / zip traversal / zip bomb / oversize),
 *     accept (into a scratch templates folder, no overwrite without --force), add, index
 *   · online catalogue — local HTTP server: added / unchanged / builtin skip / bad sha256 / oversized (content-length and
 *     chunked) / disallowed type / traversal id / not-an-mp4 / withdrawn / offline / mirror fallback; online templates
 *     listed with source 'online' and applicable like built-in ones
 *   · plaza routes through the real router (handleWorkbenchApiRequest) incl. async jobs and Range streaming
 *
 *   node scripts/tests/plaza-community.test.mjs [--keep]
 *
 * Scratch data only (<worktree>/.tmp/plaza-test/<stamp>, removed at the end without following links unless --keep);
 * isolated DSH_VIDEO_HOME / DSH_VIDEO_WORKSPACE / DSH_PLAZA_TEMPLATES_DIR (never the real templates/cinepulse-hub);
 * the real .env is never loaded; fetch only reaches the test's own 127.0.0.1 server; Explorer / Finder is never opened
 * (DSH_PLAZA_REVEAL=0). Test films are made with the bundled ffmpeg.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const KEEP = process.argv.includes('--keep')
const stampId = new Date().toISOString().replace(/[:.]/g, '-')
const SCR = join(ROOT, '.tmp', 'plaza-test', stampId)
const D = {
  home: join(SCR, 'home'),
  ws: join(SCR, 'ws'),
  tpl: join(SCR, 'templates'), // maintainer's scratch copy of templates/cinepulse-hub
  userTpl: join(SCR, 'user-builtin'), // what a user's installed plugin ships (for the sync tests)
  net: join(SCR, 'net'), // the "GitHub / jsDelivr" side
  work: join(SCR, 'work'),
  outside: join(SCR, 'outside'),
}
for (const d of Object.values(D)) mkdirSync(d, { recursive: true })
const emptyEnv = join(SCR, 'empty.env')
writeFileSync(emptyEnv, '# intentionally empty\n')
const TRAP_USER = 'plazatester'
// trap values are assembled at runtime so the committed source holds no literal user folder / key-like token
const WIN_HOME = ['C:', 'Users'].join('\\')
const TRAP_KEY = ['sk', 'test1234567890abcdefghijklmnop'].join('-')
const TRAP_LIVE_KEY = ['sk', 'live', 'should', 'be', 'dropped', '0123456789'].join('-')
const ENV = {
  DSH_VIDEO_ENV_PATH: emptyEnv,
  DSH_VIDEO_HOME: D.home,
  DSH_VIDEO_WORKSPACE: D.ws,
  DSH_PLAZA_TEMPLATES_DIR: D.tpl,
  DSH_PLAZA_REVEAL: '0',
  DSH_PLAZA_PRIVATE_WORDS: TRAP_USER,
  DSH_PLAZA_INDEX_URLS: '',
  DSH_VIDEO_SKIP_PROFILE_MOUNT: '1',
}
Object.assign(process.env, ENV)

// ---------------------------------------------------------------- network guard: only this test's loopback server
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const u = new URL(typeof input === 'string' ? input : input.url)
  if (u.hostname !== '127.0.0.1') throw new Error(`network blocked in tests: ${u.href}`)
  return realFetch(input, init)
}

// ---------------------------------------------------------------- harness
const results = []
async function test(name, fn) {
  const t0 = Date.now()
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`PASS ${name} (${Date.now() - t0} ms)`)
  } catch (err) {
    results.push({ name, ok: false })
    console.log(`FAIL ${name} (${Date.now() - t0} ms)\n     ${String(err?.stack || err).split('\n').slice(0, 5).join('\n     ')}`)
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`)
}
async function rejects(fn, re, msg) {
  try {
    await fn()
  } catch (err) {
    if (re && !re.test(String(err?.message || err) + ' ' + String(err?.code || ''))) throw new Error(`${msg}: wrong error: ${err?.message || err}`)
    return err
  }
  throw new Error(`${msg}: expected an error`)
}
const sha = (b) => createHash('sha256').update(b).digest('hex')
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href)

const shared = await imp('packages/shared/index.js')
const priv = await imp('packages/dsh-tool-media/plaza-privacy.js')
const pc = await imp('packages/dsh-tool-media/plaza-community.js')
const tp = await imp('packages/dsh-tool-media/template-plaza.js')
const store = await imp('packages/dsh-tool-media/safe-json-store.js')
const { handleWorkbenchApiRequest } = await imp('packages/dsh-web-video-workbench/lib/index.js')
const { ffmpeg, ffprobe } = shared.resolveBinaries()

function ff(args) {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`)
}
function probeDur(file) {
  const r = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8', windowsHide: true })
  return Number(String(r.stdout).trim())
}
function cli(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'dsh-video-cli.mjs'), 'plaza', ...args], {
    cwd: ROOT,
    env: { ...process.env, ...ENV, ...extraEnv },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 300_000,
  })
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') }
}
const call = async (method, path, { query = {}, body, headers = {} } = {}) => {
  const url = new URL(`http://127.0.0.1:4399/api/video-workbench/${path}`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))
  const init = { method, headers: { ...headers } }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers['Content-Type'] = 'application/json'
  }
  const res = await handleWorkbenchApiRequest(new Request(url.href, init))
  const ct = res.headers.get('content-type') || ''
  return { status: res.status, headers: res.headers, data: ct.includes('json') ? await res.json() : null, buf: ct.includes('json') ? null : Buffer.from(await res.arrayBuffer()) }
}
async function waitJob(jobId) {
  for (let i = 0; i < 600; i++) {
    const r = await call('GET', 'jobs', { query: { id: jobId } })
    const job = r.data && r.data.job
    if (job && job.status === 'done') return job.result
    if (job && job.status === 'error') throw new Error(`job failed: ${job.error}`)
    await new Promise((res) => setTimeout(res, 300))
  }
  throw new Error('job timeout')
}

// ---------------------------------------------------------------- fixtures
const PROJ = join(D.ws, 'plaza-proj')
mkdirSync(join(PROJ, 'output'), { recursive: true })
const trapScript = (proj) => ({
  title: '社区投稿测试片',
  displayTitle: '社区投稿测试片',
  genre: 'product-promo',
  genreLabel: '产品发布',
  engine: 'remotion',
  style: 'tech',
  fps: 30,
  aspectRatio: '16:9',
  width: 1920,
  height: 1080,
  narrationMode: 'tts',
  totalDurationSec: 20,
  directorNotes: `参考素材在 ${WIN_HOME}\\${TRAP_USER}\\Desktop\\my clips\\hero.png，有问题联系 leak.person@example.org。临时密钥 ${TRAP_KEY} 别外传。`,
  contentOutline: [`开场 /Users/${TRAP_USER}/Movies/intro.mov`, '结尾 file:///D:/Private/notes.txt'],
  apiKey: TRAP_LIVE_KEY,
  voiceMasteringReport: { results: [{ masteredAudioFile: 'D:\\render\\scene-01.wav' }] },
  hardwarePolicy: { profileMode: 'safe' },
  bgm: { enabled: true, bpm: 116, path: `${proj}\\assets\\music\\bgm.mp3` },
  referenceStyle: { sourceName: 'my-wedding-video.mp4', sourceRelPath: 'reference/ref.mp4', bpm: 116, visualStyle: '暖色调', colorPalette: { background: '#101010', primary: '#F59E0B' }, transitionSignature: ['flash-cut'] },
  scenes: [
    { id: 'scene-01', durationSec: 7, title: '开场', narration: '欢迎来到新品发布会。', transition: 'flash-cut', media: [{ path: `${proj}\\assets\\images\\a.png`, originalPath: 'E:\\Shoots\\Client X\\IMG_0042.JPG' }], audioFile: 'audio/scene-01.wav' },
    { id: 'scene-02', durationSec: 7, title: '亮点', narration: `由 ${TRAP_USER} 亲自讲解三大亮点。`, transition: 'zoom-punch', voiceId: 'clone-voice-x' },
    { id: 'scene-03', durationSec: 6, title: '结尾', narration: '感谢观看。', transition: 'cut' },
  ],
})
writeFileSync(join(PROJ, 'script.json'), JSON.stringify(trapScript(PROJ), null, 2))
// 20 s film whose container metadata carries a user path: the sample clip must not inherit it
ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=20', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-metadata', `comment=C:/Users/${TRAP_USER}/secret-project`, join(PROJ, 'output', 'final.mp4')])
const LONG_MP4 = join(D.work, 'long-18s.mp4')
ff(['-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=15:duration=18', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', LONG_MP4])
const NOFILM = join(D.ws, 'no-film')
mkdirSync(NOFILM, { recursive: true })
writeFileSync(join(NOFILM, 'script.json'), JSON.stringify({ title: 'no film', genre: 'data-story', scenes: [] }))
// a copy of one shipped template (the maintainer's templates folder and the user's installed plugin both have it)
const BUILTIN_ID = 'tech-launch-keynote'
cpSync(join(ROOT, 'templates', 'cinepulse-hub', BUILTIN_ID), join(D.tpl, BUILTIN_ID), { recursive: true })
cpSync(join(ROOT, 'templates', 'cinepulse-hub', BUILTIN_ID), join(D.userTpl, BUILTIN_ID), { recursive: true })

const FORM = { projectDir: PROJ, title: '社区投稿测试片', category: 'product-promo', description: '暖色调卡点，联系 leak.person@example.org', tags: '测试, 卡点', author: 'Tester', contact: 'tester.contact@example.com' }
const ISSUE_FORM = readFileSync(join(ROOT, '.github', 'ISSUE_TEMPLATE', 'plaza-submission.yml'), 'utf8')
const FORBIDDEN = [WIN_HOME.replace(/\\/g, '\\\\'), WIN_HOME, `/Users/${TRAP_USER}`, 'leak.person@example.org', TRAP_KEY.slice(0, 17), TRAP_LIVE_KEY.slice(0, 14), 'D:/Private', 'E:\\Shoots', 'E:\\\\Shoots', 'voiceMasteringReport', 'hardwarePolicy', 'masteredAudioFile', 'clone-voice-x', 'my-wedding-video', 'sourceRelPath', PROJ.replace(/\\/g, '/'), PROJ, PROJ.replace(/\\/g, '\\\\')]
// the reference video's file name is replaced by the package builder (not by the raw sanitizer)
const assertClean = (text, label, { raw = false } = {}) => {
  for (const f of FORBIDDEN) if (!(raw && f === 'my-wedding-video')) assert(!text.includes(f), `${label} must not contain ${f}`)
}

let SUB = null // the package built through the library

// ================================================================ privacy gate
await test('privacy: cleans paths, keys, foreign e-mails; reports user names; keeps project paths relative', async () => {
  const ctx = priv.createPrivacyContext({ projectDir: PROJ, contact: 'tester.contact@example.com', allowEmails: ['k26789228@gmail.com'], includeConfiguredSecrets: false, secrets: ['ConfiguredSecretValue123'] })
  assert(ctx.names.includes(TRAP_USER), 'DSH_PLAZA_PRIVATE_WORDS is a private word')
  const report = priv.createPrivacyReport()
  const out = priv.sanitizeValueForShare({ ...trapScript(PROJ), note: 'cfg ConfiguredSecretValue123 ok', mail: 'tester.contact@example.com / k26789228@gmail.com' }, ctx, report, 'script')
  const text = JSON.stringify(out)
  assertClean(text, 'sanitized script', { raw: true })
  assert(!text.includes('ConfiguredSecretValue123'), 'a configured secret value is removed')
  assert(text.includes('tester.contact@example.com') && text.includes('k26789228@gmail.com'), 'the typed contact and the author address stay')
  assert(out.bgm.path === 'assets/music/bgm.mp3', `project path made relative: ${out.bgm.path}`)
  assert(out.scenes[0].media[0].path === 'assets/images/a.png' && out.scenes[0].media[0].originalPath === 'IMG_0042.JPG', 'media paths')
  assert(out.directorNotes.includes('hero.png') && out.directorNotes.includes(priv.PRIVACY_PLACEHOLDER.secret) && out.directorNotes.includes(priv.PRIVACY_PLACEHOLDER.email), out.directorNotes)
  assert(!('apiKey' in out) && !('audioFile' in out.scenes[0]) && !('voiceId' in out.scenes[1]), 'secret / machine keys dropped')
  assert(report.counts.path >= 5 && report.counts.email >= 1 && report.counts.secret >= 2 && report.counts.dropped >= 3, JSON.stringify(report.counts))
  assert(report.names.length === 1 && report.names[0].where === 'script.scenes[1].narration' && !report.names[0].name.includes(TRAP_USER), JSON.stringify(report.names))
  // URLs are not paths
  const keep = priv.cleanTextForShare('详见 https://example.com/home/page?a=1 与 16:9 画幅', ctx, priv.createPrivacyReport(), 'x')
  assert(keep === '详见 https://example.com/home/page?a=1 与 16:9 画幅', keep)
  // scan finds everything a careless edit could leave behind
  const kinds = new Set(priv.scanForPrivacy({ a: 'D:\\work\\x.mp4', b: 'mail x@y.cn', c: 'token: abcdefghijklmnop', d: `${TRAP_USER} 出镜`, api_key: 'zzz' }, ctx, 't').map((f) => f.kind))
  assert(['path', 'email', 'secret', 'name'].every((k) => kinds.has(k)), [...kinds].join(','))
  const md = priv.scanForPrivacy('第一行\n素材 /home/someone/a.png\n', ctx, 'MOTION.md')
  assert(md.length === 1 && md[0].where === 'MOTION.md 第 2 行', JSON.stringify(md))
  // binaries: user folders in UTF-8 and UTF-16LE
  assert(priv.scanBinaryForPrivacy(Buffer.concat([Buffer.alloc(64, 7), Buffer.from(`${WIN_HOME}\\bob\\Videos\\x.mov`), Buffer.alloc(64, 1)]), null, 'b').length === 1, 'utf8 user folder')
  assert(priv.scanBinaryForPrivacy(Buffer.concat([Buffer.alloc(63, 7), Buffer.from('/home/alice/clip.mp4', 'utf16le'), Buffer.alloc(64, 1)]), null, 'b').length === 1, 'utf16 user folder (odd offset)')
  assert(priv.scanBinaryForPrivacy(Buffer.alloc(4096, 3), null, 'b').length === 0, 'clean binary')
})

// ================================================================ submission package
await test('submit · dry run shows exactly what will be shared (no files written)', async () => {
  const p = await pc.previewPlazaSubmission(FORM)
  assert(p.ok && p.dryRun, 'dry run')
  assert(p.files.map((f) => f.name).join(',') === 'template.json,MOTION.md,script.json,preview.mp4,cover.jpg,submission.json', p.files.map((f) => f.name).join(','))
  assert(p.notShared.length >= 4, 'lists what is not shared')
  assert(p.privacy.needsNameConfirm === true && p.canBuild === false, 'the private word needs confirmation')
  assert(p.privacy.counts.path > 0 && p.privacy.counts.email > 0 && p.privacy.counts.secret > 0, JSON.stringify(p.privacy.counts))
  for (const [k, v] of Object.entries(p.texts)) assertClean(v, `preview text ${k}`)
  assert(p.film && Math.abs(p.film.durationSec - 20) < 0.5 && p.previewPlan.durationSec === 15, JSON.stringify([p.film, p.previewPlan]))
  assert(/Shot List \(3 Scenes\)/.test(p.texts['MOTION.md']), 'MOTION.md has the shot list (scriptData fix)')
  const p2 = await pc.previewPlazaSubmission({ ...FORM, allowNames: true })
  assert(p2.canBuild === true && p2.blocking.length === 0 && p2.formErrors.length === 0, JSON.stringify([p2.blocking, p2.formErrors]))
  const p3 = await pc.previewPlazaSubmission({ projectDir: NOFILM, title: 'x', category: 'data-story', author: 'a' })
  assert(p3.canBuild === false && /还没有成片/.test(p3.blocking.join(' ')), 'no film blocks the package')
  assert(!existsSync(pc.getPlazaSubmissionsRoot()) || readdirSync(pc.getPlazaSubmissionsRoot()).length === 0, 'dry run writes nothing')
})

await test('submit · build refuses without consent, with unconfirmed names, without a film', async () => {
  await rejects(() => pc.buildPlazaSubmission({ ...FORM, consent: false }), /授权声明/, 'consent')
  const e = await rejects(() => pc.buildPlazaSubmission({ ...FORM, consent: true }), /privacy|用户名/, 'names')
  assert(Array.isArray(e.findings) && e.findings.every((f) => !String(f.sample).includes(TRAP_USER)), 'findings never echo the name')
  await rejects(() => pc.buildPlazaSubmission({ projectDir: NOFILM, title: 'x', category: 'data-story', author: 'a', consent: true }), /no-film|成片/, 'no film')
  await rejects(() => pc.buildPlazaSubmission({ ...FORM, title: '', consent: true, allowNames: true }), /标题/, 'title required')
  assert(!existsSync(pc.getPlazaSubmissionsRoot()) || readdirSync(pc.getPlazaSubmissionsRoot()).length === 0, 'failed builds leave nothing behind')
})

await test('submit · build writes the zip, the files and a correct submission.json', async () => {
  const steps = []
  const res = await pc.buildPlazaSubmission({ ...FORM, consent: true, allowNames: true }, (p) => steps.push(p.stage))
  assert(res.ok && res.submission && res.channels, 'result')
  SUB = res.submission
  assert(/^plaza-proj-\d{8}-\d{6}$/.test(SUB.id), `id ${SUB.id}`)
  assert(steps.includes('preview') && steps.includes('zip') && steps[steps.length - 1] === 'done', steps.join(','))
  const dir = join(pc.getPlazaSubmissionsRoot(), SUB.id)
  const names = readdirSync(join(dir, 'files')).sort()
  assert(names.join(',') === 'MOTION.md,cover.jpg,preview.mp4,script.json,submission.json,template.json', names.join(','))
  const meta = JSON.parse(readFileSync(join(dir, 'files', 'submission.json'), 'utf8'))
  assert(meta.schema === pc.PLAZA_SUBMISSION_SCHEMA && meta.consent.agreed === true && meta.contact === 'tester.contact@example.com' && meta.author === 'Tester', 'meta')
  assert(meta.files.length === 5, 'five hashed files')
  for (const f of meta.files) {
    const buf = readFileSync(join(dir, 'files', f.name))
    assert(buf.length === f.size && sha(buf) === f.sha256, `hash of ${f.name}`)
  }
  for (const n of ['template.json', 'script.json', 'MOTION.md']) assertClean(readFileSync(join(dir, 'files', n), 'utf8'), n)
  assert(!readFileSync(join(dir, 'files', 'submission.json'), 'utf8').includes('leak.person'), 'submission.json clean')
  const tpl = JSON.parse(readFileSync(join(dir, 'files', 'template.json'), 'utf8'))
  assert(tpl.id === 'plaza-proj' && tpl.author === 'Tester' && tpl.previewFile === 'preview.mp4' && tpl.coverFile === 'cover.jpg' && !('contact' in tpl), 'template.json')
  const dur = probeDur(join(dir, 'files', 'preview.mp4'))
  assert(dur > 14 && dur <= 15.35, `preview ≤ 15 s (${dur})`)
  const prev = readFileSync(join(dir, 'files', 'preview.mp4'))
  const cover = readFileSync(join(dir, 'files', 'cover.jpg'))
  assert(!prev.toString('latin1').includes(TRAP_USER) && !prev.toString('latin1').includes('secret-project'), 'preview has no source metadata')
  assert(cover[0] === 0xff && cover[1] === 0xd8 && !cover.toString('latin1').includes('Lavc'), 'cover is a metadata-free JPEG')
  // the zip: own reader + an independent reader when available
  const zipFile = join(dir, `${SUB.id}.zip`)
  const entries = pc.readZip(zipFile)
  assert(entries.length === 7 && entries[0].name === `${SUB.id}/` && entries.every((e) => e.name.startsWith(`${SUB.id}/`)), entries.map((e) => e.name).join(','))
  for (const e of entries.filter((x) => !x.dir)) assert(e.data.equals(readFileSync(join(dir, 'files', e.name.split('/')[1]))), `zip entry ${e.name} equals the shown file`)
  const py = spawnSync('python', ['-I', '-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(len(z.namelist()))', zipFile], { encoding: 'utf8', windowsHide: true })
  if (py.status === 0) assert(String(py.stdout).trim() === '7', `python zipfile sees 7 entries (${py.stdout})`)
  else console.log('     (python zipfile not available — independent zip check skipped)')
  assert(SUB.zipSha256 === sha(readFileSync(zipFile)) && SUB.zipBytes === statSync(zipFile).size, 'zip hash / size reported')
})

await test('submit · list, details, mark, channels match the GitHub issue form', async () => {
  const list = pc.listPlazaSubmissions()
  assert(list.submissions.length === 1 && list.submissions[0].id === SUB.id && list.submissions[0].fileCount === 5 && !list.submissions[0].submitted, 'list')
  const d = pc.getPlazaSubmission(SUB.id)
  assert(d.texts && d.texts['MOTION.md'].includes('MOTION.md') && d.submission.files.length === 6, 'details')
  const gh = new URL(d.channels.githubUrl)
  assert(gh.origin + gh.pathname === 'https://github.com/Merziller/dsh-video-workbench/issues/new' && gh.searchParams.get('template') === 'plaza-submission.yml', d.channels.githubUrl)
  assert(gh.searchParams.get('title') === '[影核广场投稿] 社区投稿测试片', gh.searchParams.get('title'))
  const formIds = new Set([...ISSUE_FORM.matchAll(/^\s+id:\s*([A-Za-z0-9_-]+)\s*$/gm)].map((m) => m[1]))
  for (const k of gh.searchParams.keys()) if (k !== 'template' && k !== 'title') assert(formIds.has(k), `query parameter ${k} is a field id of the issue form`)
  for (const k of ['tpl_title', 'category', 'author', 'package', 'sha256']) assert(gh.searchParams.get(k), `prefilled ${k}`)
  assert(gh.searchParams.get('package') === `${SUB.id}.zip` && gh.searchParams.get('sha256') === SUB.zipSha256, 'package name + hash')
  assert(d.channels.mailtoUrl.startsWith('mailto:k26789228@gmail.com?subject=') && decodeURIComponent(d.channels.mailtoUrl).includes(`${SUB.id}.zip`), 'mailto')
  assert(d.channels.githubUrl.length < 7000, 'issue URL stays short')
  const m = pc.markPlazaSubmission(SUB.id, { submitted: true, channel: 'github' })
  assert(m.submitted && m.channel === 'github' && m.submittedAt, 'mark')
  assert(pc.listPlazaSubmissions().submissions[0].submitted === true, 'mark persisted')
  pc.markPlazaSubmission(SUB.id, { submitted: false })
  assert(pc.listPlazaSubmissions().submissions[0].submitted === false, 'unmark')
})

await test('reveal · only packages inside plaza-submissions (traversal, unknown id, junction)', async () => {
  for (const bad of ['../../etc', '..', 'a/../../x', 'C:\\Windows', '', 'UPPER-case-id']) await rejects(() => pc.revealPlazaSubmission(bad, { launch: false }), /bad-id|无效/, `reveal ${bad}`)
  await rejects(() => pc.revealPlazaSubmission('no-such-package-1', { launch: false }), /not-found|找不到/, 'unknown id')
  const r = pc.revealPlazaSubmission(SUB.id, { launch: false })
  assert(r.ok && !r.opened && r.path.startsWith(pc.getPlazaSubmissionsRoot() + sep) && r.path.endsWith(`${SUB.id}.zip`), JSON.stringify(r))
  // a junction inside plaza-submissions that points outside is never followed
  const outsidePkg = join(D.outside, 'pkg')
  mkdirSync(join(outsidePkg, 'files'), { recursive: true })
  writeFileSync(join(outsidePkg, 'files', 'submission.json'), JSON.stringify({ schema: pc.PLAZA_SUBMISSION_SCHEMA, title: 'evil' }))
  let linked = false
  try {
    symlinkSync(outsidePkg, join(pc.getPlazaSubmissionsRoot(), 'evil-link-20260101'), 'junction')
    linked = true
  } catch {
    console.log('     (could not create a junction — that part is skipped)')
  }
  if (linked) {
    await rejects(() => pc.revealPlazaSubmission('evil-link-20260101', { launch: false }), /not-found|找不到/, 'junction refused')
    await rejects(async () => pc.deletePlazaSubmission('evil-link-20260101'), /not-found|找不到/, 'junction not deleted through the API')
    assert(!pc.listPlazaSubmissions().submissions.some((s) => s.id === 'evil-link-20260101'), 'junction not listed')
    assert(existsSync(join(outsidePkg, 'files', 'submission.json')), 'outside data untouched')
    store.removeTreeNoFollow(join(pc.getPlazaSubmissionsRoot(), 'evil-link-20260101'))
  }
})

// ================================================================ maintainer: review / accept / add / index
const refreshManifest = (dir) => {
  const meta = JSON.parse(readFileSync(join(dir, 'submission.json'), 'utf8'))
  meta.files = meta.files.map((f) => {
    const buf = readFileSync(join(dir, f.name))
    return { ...f, size: buf.length, sha256: sha(buf) }
  })
  writeFileSync(join(dir, 'submission.json'), JSON.stringify(meta, null, 2))
}
const copyPkg = (name) => {
  const dir = join(D.work, name)
  cpSync(join(pc.getPlazaSubmissionsRoot(), SUB.id, 'files'), dir, { recursive: true })
  return dir
}

await test('review · a good package passes (library + CLI)', async () => {
  const zip = join(pc.getPlazaSubmissionsRoot(), SUB.id, `${SUB.id}.zip`)
  const r = await pc.reviewPlazaPackage(zip)
  assert(r.ok, r.errors.join(' | '))
  assert(r.summary.title === '社区投稿测试片' && r.summary.category === 'product-promo' && r.summary.author === 'Tester' && r.summary.preview.durationSec <= 15.35 && r.summary.privacyClean, JSON.stringify(r.summary))
  const c = cli(['review', zip])
  assert(c.code === 0 && c.out.includes('可以采纳') && c.out.includes('社区投稿测试片'), `${c.code} ${c.out.slice(-400)} ${c.err.slice(-400)}`)
  const j = cli(['review', zip, '--json'])
  assert(j.code === 0 && JSON.parse(j.out).ok === true, j.out.slice(0, 300))
  const dirReview = await pc.reviewPlazaPackage(join(pc.getPlazaSubmissionsRoot(), SUB.id))
  assert(dirReview.ok, `the package folder itself can be reviewed: ${dirReview.errors.join(' | ')}`)
})

await test('review · rejects tampered, disallowed, too long, leaking, oversized packages', async () => {
  const t1 = copyPkg('tampered')
  writeFileSync(join(t1, 'script.json'), readFileSync(join(t1, 'script.json'), 'utf8') + ' ')
  const r1 = await pc.reviewPlazaPackage(t1)
  assert(!r1.ok && r1.errors.some((e) => /SHA-256|大小与清单不符/.test(e)), r1.errors.join(' | '))
  const c1 = cli(['review', t1])
  assert(c1.code === 1 && c1.out.includes('不能采纳'), `${c1.code} ${c1.out.slice(-300)}`)

  const t2 = copyPkg('disallowed')
  writeFileSync(join(t2, 'run.js'), 'console.log(1)')
  writeFileSync(join(t2, 'notes.md'), '# extra')
  const r2 = await pc.reviewPlazaPackage(t2)
  assert(!r2.ok && r2.errors.some((e) => e.includes('run.js')) && r2.warnings.some((w) => w.includes('notes.md')), JSON.stringify([r2.errors, r2.warnings]))

  const t3 = copyPkg('too-long')
  copyFileSync(LONG_MP4, join(t3, 'preview.mp4'))
  refreshManifest(t3)
  const r3 = await pc.reviewPlazaPackage(t3)
  assert(!r3.ok && r3.errors.some((e) => /超过 15 秒/.test(e)), r3.errors.join(' | '))

  const t4 = copyPkg('leaking')
  const s4 = JSON.parse(readFileSync(join(t4, 'script.json'), 'utf8'))
  s4.scenes[0].narration = `素材 ${WIN_HOME}\\bob\\Desktop\\a.png 和 bob@corp.example`
  writeFileSync(join(t4, 'script.json'), JSON.stringify(s4, null, 2))
  refreshManifest(t4)
  const r4 = await pc.reviewPlazaPackage(t4)
  assert(!r4.ok && r4.errors.filter((e) => e.startsWith('隐私检查')).length >= 2 && !r4.errors.join(' ').includes('bob@corp'), r4.errors.join(' | '))

  const t5 = copyPkg('oversize')
  writeFileSync(join(t5, 'MOTION.md'), '# big\n' + 'x'.repeat(600 * 1024))
  refreshManifest(t5)
  const r5 = await pc.reviewPlazaPackage(t5)
  assert(!r5.ok && r5.errors.some((e) => e.includes('MOTION.md') && e.includes('太大')), r5.errors.join(' | '))

  const t7 = copyPkg('big-preview') // over the npm bundle's 4 MB sample-clip limit
  writeFileSync(join(t7, 'preview.mp4'), Buffer.concat([readFileSync(join(t7, 'preview.mp4')), Buffer.alloc(4 * 1024 * 1024)]))
  refreshManifest(t7)
  const r7 = await pc.reviewPlazaPackage(t7)
  assert(!r7.ok && r7.errors.some((e) => e.startsWith('preview.mp4') && e.includes('太大')), r7.errors.join(' | '))

  const t6 = copyPkg('no-consent')
  const m6 = JSON.parse(readFileSync(join(t6, 'submission.json'), 'utf8'))
  m6.consent.agreed = false
  writeFileSync(join(t6, 'submission.json'), JSON.stringify(m6))
  const r6 = await pc.reviewPlazaPackage(t6)
  assert(!r6.ok && r6.errors.some((e) => e.includes('授权')), r6.errors.join(' | '))
})

await test('review · unsafe zips (path traversal, nested folders, zip bomb, not a zip)', async () => {
  const z1 = join(D.work, 'traversal.zip')
  pc.writeZip(z1, [{ name: '../evil.json', data: Buffer.from('{}') }, { name: 'template.json', data: Buffer.from('{}') }])
  await rejects(() => pc.reviewPlazaPackage(z1), /不安全/, 'traversal entry')
  const c1 = cli(['review', z1])
  assert(c1.code === 1 && c1.err.includes('不安全'), `${c1.code} ${c1.err}`)
  const z2 = join(D.work, 'nested.zip')
  pc.writeZip(z2, [{ name: 'a/b/template.json', data: Buffer.from('{}') }, { name: 'a/c.json', data: Buffer.from('{}') }])
  await rejects(() => pc.reviewPlazaPackage(z2), /子文件夹/, 'nested folders')
  const z3 = join(D.work, 'bomb.zip')
  pc.writeZip(z3, [{ name: 'MOTION.md', data: Buffer.alloc(200 * 1024, 0x41) }])
  const buf = readFileSync(z3)
  const cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  buf.writeUInt32LE(100, cd + 24) // central directory claims 100 bytes
  writeFileSync(z3, buf)
  await rejects(() => pc.reviewPlazaPackage(z3), /无法解压|大小不符/, 'zip bomb capped at the declared size')
  const z4 = join(D.work, 'fake.zip')
  writeFileSync(z4, 'not a zip at all')
  await rejects(() => pc.reviewPlazaPackage(z4), /zip/, 'not a zip')
})

let ACCEPTED_ID = ''
await test('accept · installs into the scratch templates folder; no overwrite without --force', async () => {
  const zip = join(pc.getPlazaSubmissionsRoot(), SUB.id, `${SUB.id}.zip`)
  const realBefore = readdirSync(join(ROOT, 'templates', 'cinepulse-hub')).sort().join(',')
  const res = await pc.acceptPlazaPackage(zip, { templatesDir: D.tpl })
  ACCEPTED_ID = res.id
  assert(res.ok && res.id === 'plaza-proj' && res.dest === join(D.tpl, 'plaza-proj'), JSON.stringify({ id: res.id, dest: res.dest }))
  const files = readdirSync(res.dest).sort().join(',')
  assert(files === 'MOTION.md,cover.jpg,preview.mp4,script.json,template.json', files)
  const meta = JSON.parse(readFileSync(join(res.dest, 'template.json'), 'utf8'))
  assert(meta.community && meta.community.submissionId === SUB.id && !('contact' in meta) && meta.author === 'Tester' && meta.category === 'product-promo', JSON.stringify(meta.community))
  await rejects(() => pc.acceptPlazaPackage(zip, { templatesDir: D.tpl }), /exists|已存在/, 'no overwrite')
  const forced = await pc.acceptPlazaPackage(zip, { templatesDir: D.tpl, force: true })
  assert(forced.ok, 'force overwrite')
  const c = cli(['accept', zip, '--id', 'cli-accepted', '--category', 'data-story', '--templates-dir', D.tpl])
  assert(c.code === 0 && c.out.includes('已收录') && c.out.includes('plaza index'), `${c.code} ${c.out} ${c.err}`)
  assert(JSON.parse(readFileSync(join(D.tpl, 'cli-accepted', 'template.json'), 'utf8')).category === 'data-story', 'category override')
  const bad = cli(['accept', join(D.work, 'tampered'), '--templates-dir', D.tpl])
  assert(bad.code === 1 && !existsSync(join(D.tpl, 'tampered')), `a failing package is not accepted (${bad.code})`)
  assert(readdirSync(join(ROOT, 'templates', 'cinepulse-hub')).sort().join(',') === realBefore, 'the real templates folder is untouched')
  assert(!readdirSync(D.tpl).some((n) => n.startsWith('.staging-') || n.startsWith('.old-')), 'no staging leftovers')
})

await test('add · the author publishes a project straight into the (scratch) built-in plaza', async () => {
  await rejects(() => pc.addProjectToBuiltinPlaza({ projectDir: PROJ, id: 'author-own', category: 'product-promo', templatesDir: D.tpl }), /用户名|allow-names/, 'names need --allow-names')
  const res = await pc.addProjectToBuiltinPlaza({ projectDir: PROJ, id: 'author-own', category: 'product-promo', templatesDir: D.tpl, allowNames: true, tags: '官方,示例' })
  assert(res.ok && existsSync(join(D.tpl, 'author-own', 'preview.mp4')) && existsSync(join(D.tpl, 'author-own', 'cover.jpg')), 'files')
  const meta = JSON.parse(readFileSync(join(D.tpl, 'author-own', 'template.json'), 'utf8'))
  assert(meta.author === 'Merziller' && meta.previewDurationSec <= 15.35 && meta.tags.join(',') === '官方,示例', JSON.stringify(meta).slice(0, 200))
  assertClean(readFileSync(join(D.tpl, 'author-own', 'script.json'), 'utf8'), 'added script.json')
  const c = cli(['add', '--project', PROJ, '--id', 'cli-add', '--category', 'ui-tutorial', '--title', 'CLI Added', '--allow-names', '--templates-dir', D.tpl])
  assert(c.code === 0 && existsSync(join(D.tpl, 'cli-add', 'template.json')), `${c.code} ${c.out} ${c.err}`)
  const again = cli(['add', '--project', PROJ, '--id', 'cli-add', '--category', 'ui-tutorial', '--allow-names', '--templates-dir', D.tpl])
  assert(again.code === 1 && again.err.includes('已存在'), 'add refuses to overwrite')
})

let INDEX = null
await test('index · writes index.json with sizes + sha256; invalid templates are reported and left out', async () => {
  // a template whose sample clip is too long must not reach users
  cpSync(join(D.tpl, 'author-own'), join(D.tpl, 'long-preview'), { recursive: true })
  copyFileSync(LONG_MP4, join(D.tpl, 'long-preview', 'preview.mp4'))
  const t = JSON.parse(readFileSync(join(D.tpl, 'long-preview', 'template.json'), 'utf8'))
  writeFileSync(join(D.tpl, 'long-preview', 'template.json'), JSON.stringify({ ...t, id: 'long-preview' }, null, 2))
  const res = await pc.writePlazaIndex({ templatesDir: D.tpl })
  assert(!res.ok && res.problems.some((p) => p.id === 'long-preview' && !p.included), JSON.stringify(res.problems))
  const ids = res.templates.map((x) => x.id).sort().join(',')
  assert(ids === ['author-own', 'cli-accepted', 'cli-add', 'plaza-proj', BUILTIN_ID].sort().join(','), ids)
  for (const tpl of res.templates) {
    for (const f of tpl.files) {
      const buf = readFileSync(join(D.tpl, tpl.id, f.name))
      assert(buf.length === f.size && sha(buf) === f.sha256, `${tpl.id}/${f.name}`)
    }
  }
  store.removeTreeNoFollow(join(D.tpl, 'long-preview'))
  const c = cli(['index', '--templates-dir', D.tpl])
  assert(c.code === 0 && c.out.includes('index.json') && c.out.includes('purge.jsdelivr.net'), `${c.code} ${c.out} ${c.err}`)
  const first = JSON.parse(readFileSync(join(D.tpl, 'index.json'), 'utf8'))
  const again = await pc.writePlazaIndex({ templatesDir: D.tpl, probe: false })
  assert(again.ok && again.changed === false && JSON.parse(readFileSync(join(D.tpl, 'index.json'), 'utf8')).generatedAt === first.generatedAt, 'unchanged content keeps generatedAt')
  INDEX = first
  assert(INDEX.schema === pc.PLAZA_INDEX_SCHEMA && INDEX.count === 5, `${INDEX.schema} ${INDEX.count}`)
})

// ================================================================ online catalogue
const NET_TPL = join(D.net, 'templates', 'cinepulse-hub')
cpSync(D.tpl, NET_TPL, { recursive: true })
const overrides = new Map() // url path → { body, chunked }
const served = []
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  served.push(p)
  const o = overrides.get(p)
  if (o) {
    if (o.chunked) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.write(o.body.subarray(0, 10))
      res.end(o.body.subarray(10))
    } else res.end(o.body)
    return
  }
  const file = resolve(D.net, '.' + p)
  if (!file.startsWith(D.net + sep) || !existsSync(file) || statSync(file).isDirectory()) {
    res.statusCode = 404
    res.end('nf')
    return
  }
  res.end(readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port
const INDEX_URL = `http://127.0.0.1:${PORT}/templates/cinepulse-hub/index.json`
const DEAD_URL = 'http://127.0.0.1:9/templates/cinepulse-hub/index.json'
const writeNetIndex = (mut) => {
  const idx = JSON.parse(JSON.stringify(INDEX))
  mut(idx)
  writeFileSync(join(NET_TPL, 'index.json'), JSON.stringify(idx, null, 2))
  return idx
}
const onlineDir = () => tp.getOnlinePlazaDir()
const sync = (urls = [INDEX_URL]) => pc.syncOnlinePlazaTemplates({ indexUrls: urls, timeoutMs: 8000 })
const statusOf = (r, id) => (r.results.find((x) => x.id === id) || {}).status

await test('sync · downloads new templates, skips the ones shipped with the plugin', async () => {
  process.env.DSH_PLAZA_TEMPLATES_DIR = D.userTpl // the user's installed plugin only ships the built-in one
  writeNetIndex(() => {})
  const r = await sync()
  assert(r.ok && r.source === `127.0.0.1:${PORT}`, JSON.stringify(r).slice(0, 300))
  assert(statusOf(r, BUILTIN_ID) === 'builtin', `builtin skipped: ${statusOf(r, BUILTIN_ID)}`)
  for (const id of ['author-own', 'cli-accepted', 'cli-add', 'plaza-proj']) assert(statusOf(r, id) === 'added', `${id}: ${statusOf(r, id)} ${JSON.stringify(r.results.find((x) => x.id === id))}`)
  assert(!existsSync(join(onlineDir(), BUILTIN_ID)), 'no duplicate of the shipped template')
  for (const id of ['author-own', 'plaza-proj']) {
    for (const f of INDEX.templates.find((t) => t.id === id).files) assert(sha(readFileSync(join(onlineDir(), id, f.name))) === f.sha256, `${id}/${f.name} verified`)
  }
  assert(!served.some((p) => p.startsWith(`/templates/cinepulse-hub/${BUILTIN_ID}/`)), 'built-in files were not downloaded')
  const list = tp.listPlazaTemplates()
  const online = list.templates.filter((t) => t.source === 'online').map((t) => t.id).sort().join(',')
  assert(online === 'author-own,cli-accepted,cli-add,plaza-proj' && list.onlineCount === 4, online)
  assert(list.templates.find((t) => t.id === BUILTIN_ID).source === 'builtin', 'the shipped copy stays built-in')
  assert(tp.listPlazaTemplates({ category: 'online' }).templates.length === 4, 'online filter')
  assert(!list.templates.some((t) => t.dirPath || t.previewAbsPath || t.coverAbsPath), 'no local paths leak')
  const detail = tp.getPlazaTemplate('plaza-proj')
  assert(detail.template.source === 'online' && detail.script && detail.motionMd, 'online template detail')
  const target = join(D.ws, 'apply-target')
  mkdirSync(target, { recursive: true })
  shared.writeScriptJson(target, { title: '套用测试', engine: 'remotion', scenes: [] })
  const ap = tp.applyPlazaTemplateToProject({ projectDir: target, templateId: 'author-own', newTopic: '新主题', copyScenes: true })
  assert(ap.ok && ap.templateId === 'author-own' && ap.script.scenes.length === 3 && existsSync(join(target, 'MOTION.md')), 'an online template applies like a built-in one')
  const cover = await call('GET', 'plaza/cover', { query: { id: 'plaza-proj' } })
  assert(cover.status === 200 && cover.buf[0] === 0xff, `online cover served (${cover.status})`)
  const st = pc.getOnlinePlazaStatus()
  assert(st.count === 4 && st.lastSyncAt && !st.lastError, JSON.stringify(st))
})

await test('sync · unchanged catalogue downloads nothing', async () => {
  served.length = 0
  const r = await sync()
  assert(r.ok && r.added === 0 && r.updated === 0 && r.unchanged === 4, JSON.stringify(r).slice(0, 300))
  assert(served.length === 1 && served[0].endsWith('/index.json'), served.join(','))
})

await test('sync · bad sha256 and oversized files fail, the last good copy is kept', async () => {
  const motionPath = join(onlineDir(), 'author-own', 'MOTION.md')
  const goodMotion = readFileSync(motionPath)
  const addMotionPath = join(onlineDir(), 'cli-add', 'MOTION.md')
  const goodAddMotion = readFileSync(addMotionPath)
  const tamperedMotion = Buffer.from('# tampered blueprint\n')
  const biggerMotion = Buffer.from('# updated blueprint\n' + 'y'.repeat(4000))
  overrides.set('/templates/cinepulse-hub/author-own/MOTION.md', { body: tamperedMotion })
  overrides.set('/templates/cinepulse-hub/cli-add/MOTION.md', { body: biggerMotion })
  overrides.set('/templates/cinepulse-hub/cli-accepted/MOTION.md', { body: biggerMotion, chunked: true })
  writeNetIndex((idx) => {
    const fix = (id, f) => {
      const e = idx.templates.find((t) => t.id === id).files.find((x) => x.name === 'MOTION.md')
      Object.assign(e, f)
    }
    fix('author-own', { size: tamperedMotion.length, sha256: sha(Buffer.from('# what the author really published\n')) }) // served bytes ≠ index hash
    fix('cli-add', { size: biggerMotion.length - 100, sha256: sha(biggerMotion.subarray(0, biggerMotion.length - 100)) }) // more bytes than declared (content-length)
    fix('cli-accepted', { size: biggerMotion.length - 100, sha256: sha(biggerMotion.subarray(0, biggerMotion.length - 100)) }) // more bytes than declared (chunked)
  })
  const r = await sync()
  assert(statusOf(r, 'author-own') === 'failed' && /SHA-256/.test(r.results.find((x) => x.id === 'author-own').reason), JSON.stringify(r.results.find((x) => x.id === 'author-own')))
  assert(statusOf(r, 'cli-add') === 'failed' && /大小/.test(r.results.find((x) => x.id === 'cli-add').reason), JSON.stringify(r.results.find((x) => x.id === 'cli-add')))
  assert(statusOf(r, 'cli-accepted') === 'failed', JSON.stringify(r.results.find((x) => x.id === 'cli-accepted')))
  assert(r.results.filter((x) => x.status === 'failed').every((x) => x.keptPrevious), 'previous copies kept')
  assert(readFileSync(motionPath).equals(goodMotion) && readFileSync(addMotionPath).equals(goodAddMotion), 'the last good files are untouched')
  assert(tp.listPlazaTemplates().onlineCount === 4, 'all four still listed')
  assert(!readdirSync(onlineDir()).some((n) => n.startsWith('.staging-')), 'no staging leftovers')
  assert(/下载失败/.test(r.message), r.message)
  overrides.clear()
})

await test('sync · rejects disallowed types, traversal IDs, over-limit sizes and fake media; withdrawn templates are removed', async () => {
  const fakeMp4 = Buffer.from('this is not a video but the hash matches')
  mkdirSync(join(NET_TPL, 'fake-video'), { recursive: true })
  const tplJson = Buffer.from(JSON.stringify({ id: 'fake-video', name: '假视频', category: 'data-story' }))
  writeFileSync(join(NET_TPL, 'fake-video', 'template.json'), tplJson)
  writeFileSync(join(NET_TPL, 'fake-video', 'preview.mp4'), fakeMp4)
  const tj = (id) => ({ name: 'template.json', size: 20, sha256: sha(Buffer.from(id)) })
  writeNetIndex((idx) => {
    idx.templates = idx.templates.filter((t) => t.id !== 'cli-accepted') // withdrawn by the maintainer
    idx.templates.push({ id: '../evil', title: 'evil', files: [tj('a')] })
    idx.templates.push({ id: 'bad-type', title: 'bad', files: [tj('b'), { name: 'run.js', size: 10, sha256: sha(Buffer.from('c')) }] })
    idx.templates.push({ id: 'too-big', title: 'big', files: [tj('d'), { name: 'preview.mp4', size: 13 * 1024 * 1024, sha256: sha(Buffer.from('e')) }] })
    idx.templates.push({ id: 'fake-video', title: '假视频', files: [{ name: 'template.json', size: tplJson.length, sha256: sha(tplJson) }, { name: 'preview.mp4', size: fakeMp4.length, sha256: sha(fakeMp4) }] })
  })
  const r = await sync()
  assert(r.ok, r.message)
  assert(statusOf(r, 'bad-type') === 'rejected' && statusOf(r, 'too-big') === 'rejected', JSON.stringify(r.results.slice(-5)))
  assert(r.results.some((x) => x.status === 'rejected' && /ID/.test(x.reason)), 'traversal id rejected')
  assert(statusOf(r, 'fake-video') === 'failed' && /MP4/.test(r.results.find((x) => x.id === 'fake-video').reason), JSON.stringify(r.results.find((x) => x.id === 'fake-video')))
  assert(statusOf(r, 'cli-accepted') === 'removed' && !existsSync(join(onlineDir(), 'cli-accepted')), 'withdrawn template removed')
  for (const n of ['evil', 'bad-type', 'too-big', 'fake-video']) assert(!existsSync(join(onlineDir(), n)) && !existsSync(join(D.home, n)), `${n} not created`)
  assert(readdirSync(onlineDir()).every((n) => ['catalog.json', 'author-own', 'cli-add', 'plaza-proj'].includes(n)), readdirSync(onlineDir()).join(','))
})

await test('sync · offline keeps everything and explains; a dead mirror falls back to the next', async () => {
  const before = tp.listPlazaTemplates().onlineCount
  const r = await sync([DEAD_URL])
  assert(r.ok === false && r.offline === true && /暂时连不上/.test(r.message) && r.kept === before, JSON.stringify(r).slice(0, 300))
  assert(tp.listPlazaTemplates().onlineCount === before, 'online templates kept while offline')
  assert(pc.getOnlinePlazaStatus().lastError.includes('暂时连不上'), 'the failure is remembered for the panel')
  writeNetIndex(() => {})
  const r2 = await sync([DEAD_URL, INDEX_URL])
  assert(r2.ok && r2.source === `127.0.0.1:${PORT}`, JSON.stringify(r2).slice(0, 300))
  assert(statusOf(r2, 'cli-accepted') === 'added', 'a template back in the catalogue is downloaded again')
  const blocked = await pc.syncOnlinePlazaTemplates({ indexUrls: ['http://example.com/index.json'] })
  assert(blocked.ok === false, 'plain http to the internet is never used')
  // the maintainer has not published index.json yet: every mirror answers 404 → explained as "not published", not "offline"
  const unpublished = await sync([`http://127.0.0.1:${PORT}/templates/not-published/index.json`])
  assert(unpublished.ok === false && unpublished.notPublished === true && unpublished.offline === false && /还没有发布在线目录/.test(unpublished.message), JSON.stringify(unpublished).slice(0, 300))
  assert(tp.listPlazaTemplates().onlineCount === 4, 'nothing removed when the catalogue is missing')
})

// ================================================================ routes through the real router
await test('routes · submissions list / details / file streaming / path guards', async () => {
  const list = await call('GET', 'plaza/submissions')
  assert(list.status === 200 && list.data.ok && list.data.submissions.length === 1 && list.data.online && list.data.online.count >= 1, JSON.stringify(list.data).slice(0, 300))
  const det = await call('GET', 'plaza/submissions', { query: { id: SUB.id } })
  assert(det.status === 200 && det.data.channels.githubUrl.includes('plaza-submission.yml'), 'details')
  const part = await call('GET', 'plaza/submissions', { query: { id: SUB.id, file: 'preview.mp4' }, headers: { Range: 'bytes=0-99' } })
  assert(part.status === 206 && part.buf.length === 100 && /^bytes 0-99\/\d+$/.test(part.headers.get('content-range') || ''), `range ${part.status}`)
  const coverRes = await call('GET', 'plaza/submissions', { query: { id: SUB.id, file: 'cover.jpg' } })
  assert(coverRes.status === 200 && coverRes.buf[0] === 0xff, 'cover')
  const evil = await call('GET', 'plaza/submissions', { query: { id: SUB.id, file: '../../script.json' } })
  assert(evil.status === 400, `file guard ${evil.status}`)
  const evil2 = await call('GET', 'plaza/submissions', { query: { id: '../..', file: 'cover.jpg' } })
  assert(evil2.status === 400, `id guard ${evil2.status}`)
  const rv = await call('POST', 'plaza/reveal', { body: { id: '../../x' } })
  assert(rv.status === 400 && rv.data.ok === false, `reveal guard ${rv.status}`)
  const rv2 = await call('POST', 'plaza/reveal', { body: { id: SUB.id } })
  assert(rv2.status === 200 && rv2.data.opened === false && rv2.data.path.endsWith('.zip'), JSON.stringify(rv2.data))
})

await test('routes · preview, build (async job), mark, delete, remote sync', async () => {
  const pv = await call('POST', 'plaza/submit', { body: { action: 'preview', ...FORM } })
  assert(pv.status === 200 && pv.data.dryRun && pv.data.privacy.needsNameConfirm, 'preview')
  const noConsent = await call('POST', 'plaza/submit', { body: { action: 'build', ...FORM } })
  assert(noConsent.status === 400 && noConsent.data.code === 'need-consent', JSON.stringify(noConsent.data))
  const names = await call('POST', 'plaza/submit', { body: { action: 'build', ...FORM, consent: true } })
  assert(names.status === 400 && names.data.code === 'need-name-confirm', JSON.stringify(names.data))
  const noFilm = await call('POST', 'plaza/submit', { body: { action: 'build', projectDir: NOFILM, title: 't', category: 'data-story', author: 'a', consent: true } })
  assert(noFilm.status === 400 && /成片/.test(noFilm.data.error), JSON.stringify(noFilm.data))
  const b = await call('POST', 'plaza/submit', { body: { action: 'build', ...FORM, title: 'Route Build', consent: true, allowNames: true } })
  assert(b.status === 200 && b.data.async && b.data.jobId, JSON.stringify(b.data))
  const res = await waitJob(b.data.jobId)
  assert(res.ok && /^route-build-/.test(res.submission.id) && res.channels.mailtoUrl, JSON.stringify(res).slice(0, 200))
  const mk = await call('POST', 'plaza/submit', { body: { action: 'mark', id: res.submission.id, submitted: true, channel: 'email' } })
  assert(mk.status === 200 && mk.data.submitted && mk.data.channel === 'email', 'mark')
  const del = await call('POST', 'plaza/submissions/delete', { body: { id: res.submission.id } })
  assert(del.status === 200 && !existsSync(join(pc.getPlazaSubmissionsRoot(), res.submission.id)), 'delete')
  const del2 = await call('POST', 'plaza/submissions/delete', { body: { id: res.submission.id } })
  assert(del2.status === 404, `second delete ${del2.status}`)
  process.env.DSH_PLAZA_INDEX_URLS = INDEX_URL
  const s = await call('POST', 'plaza/remote-sync', { body: {} })
  assert(s.status === 200 && s.data.jobId, JSON.stringify(s.data))
  const sr = await waitJob(s.data.jobId)
  assert(sr.ok && sr.unchanged >= 4, JSON.stringify(sr).slice(0, 300))
  process.env.DSH_PLAZA_INDEX_URLS = ''
  const wrong = await call('GET', 'plaza/submit')
  assert(wrong.status === 405, `method guard ${wrong.status}`)
})

// ---------------------------------------------------------------- done
server.close()
process.env.DSH_PLAZA_TEMPLATES_DIR = D.tpl
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — FAILED: ${failed.map((f) => f.name).join(' · ')}` : ''}`)
if (!KEEP) {
  try {
    store.removeTreeNoFollow(SCR)
  } catch (err) {
    console.log(`(scratch cleanup incomplete: ${err?.message || err})`)
  }
} else console.log(`scratch kept: ${SCR}`)
process.exit(failed.length ? 1 : 0)
