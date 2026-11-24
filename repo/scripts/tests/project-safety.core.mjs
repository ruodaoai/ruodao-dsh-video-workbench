#!/usr/bin/env node
/**
 * Project-safety CORE tests (imported by scripts/tests/project-safety.test.mjs, also runnable alone):
 * paid cloud-job ledger (resume / reuse / dedupe / CAS / budget), billing errors (classification, never retried,
 * run stop + Task Center marking), content-addressed history (snapshot / diff / restore / GC), human edit
 * protection (locks across re-plan + batched re-code + refine + audio stage, overrides + three-way merge),
 * character reference injection into provider requests, free stock media (official Pexels / Pixabay endpoints,
 * "未配置"), and 指哪改哪 time / region mapping incl. a mocked end-to-end refine run.
 * Review regressions (v0.6.0): F2 deleting one voice of an imported pack, F3 restore vs files too large for the safety
 * snapshot, F11 crafted history store (restore containment, junctions under history/), F13 name = another alias.
 *
 *   DSH_VIDEO_ENV_PATH=/path/to/.env node scripts/tests/project-safety.core.mjs
 *
 * ALL network is mocked: globalThis.fetch is replaced and any request a test did not mock fails that test.
 * No real provider / LLM is called. Scratch projects: <main checkout>/.tmp/openfilm-project/core-*, removed at the
 * end (links / junctions unlinked, never followed). PROJECT_SAFETY_TEST_FILTER=<regex> runs a subset;
 * PROJECT_SAFETY_KEEP=1 keeps the scratch dir.
 * Exports `runCoreTests()` → { passed, failed, results } (does not exit the process).
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const MAIN_CHECKOUT = /[\\/]\.claude[\\/]worktrees[\\/]/.test(REPO) ? resolve(REPO, '..', '..', '..') : REPO
const SCRATCH_ROOT = resolve(join(MAIN_CHECKOUT, '.tmp', 'openfilm-project'))

export async function runCoreTests() {
  if (!process.env.DSH_VIDEO_ENV_PATH) {
    const envCandidate = [join(REPO, '.env'), join(MAIN_CHECKOUT, '.env')].find((p) => existsSync(p))
    if (envCandidate) process.env.DSH_VIDEO_ENV_PATH = envCandidate
  }
  const SCRATCH = join(SCRATCH_ROOT, `core-${process.pid}-${Date.now().toString(36)}`)
  mkdirSync(SCRATCH, { recursive: true })
  const saved = {}
  const ENV_KEYS = ['DSH_VIDEO_HOME', 'DSH_VIDEO_CLOUD_MEDIA_CONFIG', 'PEXELS_API_KEY', 'PIXABAY_API_KEY', 'DSH_CLOUD_MAX_PAID_JOBS_PER_RUN', 'DSH_HISTORY_MAX', 'LLM_MODE', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_FORMAT']
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  // Isolate user-level stores (llm-config, character library, stock cache) and blank every real key
  process.env.DSH_VIDEO_HOME = join(SCRATCH, 'dsh-home')
  // Studio-saved stock keys live in the cloud-media config: point it at a scratch file (never the dev machine's)
  process.env.DSH_VIDEO_CLOUD_MEDIA_CONFIG = join(SCRATCH, 'cloud-media.json')
  process.env.PEXELS_API_KEY = ''
  process.env.PIXABAY_API_KEY = ''
  delete process.env.DSH_CLOUD_MAX_PAID_JOBS_PER_RUN
  delete process.env.DSH_HISTORY_MAX
  // A mock LLM endpoint for code paths that resolve the LLM config themselves (all requests are intercepted)
  process.env.LLM_MODE = 'custom'
  process.env.LLM_BASE_URL = 'https://llm.mock.test/v1'
  process.env.LLM_MODEL = 'mock-model'
  process.env.LLM_API_KEY = 'sk-test'
  process.env.LLM_FORMAT = 'openai-completions'

  // ---------------------------------------------------------------------------------------- network guard
  const realFetch = globalThis.fetch
  let fetchHandler = null
  const fetchLog = []
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || String(input)
    fetchLog.push({ url, method: init?.method || 'GET', headers: init?.headers || {}, body: init?.body })
    if (!fetchHandler) throw new Error(`[project-safety] un-mocked network request blocked: ${url}`)
    return fetchHandler(url, init)
  }
  const mockFetch = (handler) => {
    fetchHandler = handler
    fetchLog.length = 0
  }
  const jsonResp = (data, status = 200, headers = {}) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } })
  const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const binResp = (buf, contentType = 'image/png') =>
    new Response(buf, { status: 200, headers: { 'content-type': contentType, 'content-length': String(buf.length) } })

  const imp = (rel) => import(pathToFileURL(join(REPO, rel)).href)
  const shared = await imp('packages/shared/index.js')
  const ledger = await imp('packages/dsh-tool-media/cloud-ledger.js')
  const cloud = await imp('packages/dsh-tool-media/cloud-media.js')
  const history = await imp('packages/dsh-tool-media/project-history.js')
  const locks = await imp('packages/dsh-tool-media/scene-locks.js')
  const refine = await imp('packages/dsh-tool-media/region-refine.js')
  const chars = await imp('packages/dsh-tool-media/character-bank.js')
  const stock = await imp('packages/dsh-tool-media/stock-media.js')
  const coder = await imp('packages/dsh-tool-media/ai-coder.js')
  const director = await imp('packages/dsh-tool-media/ai-director.js')
  const orchestrator = await imp('packages/dsh-tool-media/pipeline-orchestrator.js')
  const htmlGen = await imp('packages/dsh-tool-media/html-generator.js')
  const { readScriptJson, writeScriptJson } = shared

  // ---------------------------------------------------------------------------------------- harness
  const results = []
  const FILTER = process.env.PROJECT_SAFETY_TEST_FILTER ? new RegExp(process.env.PROJECT_SAFETY_TEST_FILTER, 'i') : null
  async function test(name, fn) {
    if (FILTER && !FILTER.test(name)) return
    const t0 = Date.now()
    fetchHandler = null
    try {
      await fn()
      results.push({ name, ok: true, ms: Date.now() - t0 })
      console.log(`PASS ${name} (${Date.now() - t0} ms)`)
    } catch (err) {
      results.push({ name, ok: false, ms: Date.now() - t0, error: err?.stack || String(err) })
      console.log(`FAIL ${name} (${Date.now() - t0} ms)\n    ${String(err?.stack || err).split('\n').slice(0, 8).join('\n    ')}`)
    } finally {
      fetchHandler = null
    }
  }
  function safeRemove(target) {
    const abs = resolve(target)
    if (!abs.startsWith(SCRATCH_ROOT)) throw new Error(`refusing to delete outside scratch: ${abs}`)
    const walk = (p) => {
      let st
      try {
        st = lstatSync(p)
      } catch {
        return
      }
      if (st.isSymbolicLink() || !st.isDirectory()) {
        // Junctions / symlinks (e.g. node_modules → shared deps) are unlinked, never descended
        try {
          unlinkSync(p)
        } catch {
          try {
            rmdirSync(p)
          } catch {}
        }
        return
      }
      for (const name of readdirSync(p)) walk(join(p, name))
      try {
        rmdirSync(p)
      } catch {}
    }
    walk(abs)
  }
  let projCounter = 0
  function makeProject(name, { durations = [3, 3.3, 4], engine = 'html', extra = {}, sceneExtra = () => ({}) } = {}) {
    const dir = join(SCRATCH, `${String(++projCounter).padStart(2, '0')}-${name}`)
    mkdirSync(dir, { recursive: true })
    const scenes = durations.map((d, i) => ({
      id: `scene-${String(i + 1).padStart(2, '0')}`,
      title: `镜头 ${i + 1}`,
      narration: `这是第 ${i + 1} 幕的旁白`,
      durationSec: d,
      durationInFrames: Math.round(d * 30),
      layout: 'kinetic-impact',
      sfxCues: [],
      ...sceneExtra(i),
    }))
    writeScriptJson(dir, { title: `测试工程 ${name}`, engine, fps: 30, width: 1920, height: 1080, scenes, ...extra })
    return dir
  }
  const readScript = (dir) => readScriptJson(dir).data
  const sceneOf = (dir, id) => readScript(dir).scenes.find((s) => s.id === id)
  const llmReply = (text) =>
    jsonResp({ id: 'cmpl-test', model: 'mock-model', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] })
  const MOCK_LLM = { mode: 'custom', baseUrl: 'https://llm.mock.test/v1', apiKey: 'sk-test', model: 'mock-model', format: 'openai-completions', maxRepairRounds: 1 }

  try {

    // =====================================================================================
    // 1. Paid cloud-job ledger: resume / reuse / dedupe / CAS / budget
    // =====================================================================================
    const FLUX = { providerId: 'bfl-flux', protocol: 'bfl-flux', baseUrl: 'https://api.bfl.ai', endpoint: '/v1/flux-pro-1.1', model: 'flux-pro-1.1', apiKey: 'bfl-test-key', extraParams: {} }
    const fluxMock = ({ readyAfterPolls = 1, counters = { submit: 0, poll: 0, download: 0 }, submitStatus = 200, submitBody = null } = {}) => ({
      counters,
      handler: async (url) => {
        if (url.startsWith('https://api.bfl.ai/v1/flux-pro-1.1')) {
          counters.submit++
          if (submitStatus !== 200) return jsonResp(submitBody || { error: { message: 'boom' } }, submitStatus)
          return jsonResp({ id: `task-${counters.submit}` })
        }
        if (url.startsWith('https://api.bfl.ai/v1/get_result')) {
          counters.poll++
          return counters.poll >= readyAfterPolls ? jsonResp({ status: 'Ready', result: { sample: 'https://delivery.bfl.ai/result.png' } }) : jsonResp({ status: 'Pending' })
        }
        if (url === 'https://delivery.bfl.ai/result.png') {
          counters.download++
          return binResp(PNG_1PX)
        }
        throw new Error(`unexpected url ${url}`)
      },
    })
    const gen = (dir, extra = {}) => cloud.generateCloudMediaAsset({ projectDir: dir, category: 'image', providerOverride: FLUX, pollIntervalMs: 1, maxPolls: 3, ...extra })

    await test('ledger: completed job is reused after a restart (no second submission)', async () => {
      const dir = makeProject('ledger-reuse')
      const m = fluxMock()
      mockFetch(m.handler)
      const first = await gen(dir, { prompt: '城市夜景 航拍', sceneId: 'scene-01' })
      assert.equal(first.ledger.paidSubmission, true)
      assert.equal(m.counters.submit, 1)
      const jobs = ledger.readCloudLedger(dir).jobs
      assert.equal(jobs.length, 1)
      assert.equal(jobs[0].status, 'completed')
      assert.equal(jobs[0].taskId, 'task-1')
      assert.equal(jobs[0].provider, 'bfl-flux')
      assert.equal(jobs[0].category, 'image')
      assert.match(jobs[0].paramsHash, /^[a-f0-9]{40}$/)
      assert.ok(existsSync(join(dir, jobs[0].resultPaths[0])))
      assert.equal(sceneOf(dir, 'scene-01').media[0].path, jobs[0].resultPaths[0])
      // "Restart" (new call, same normalised params) → reuse the already-paid file
      const second = await gen(dir, { prompt: '城市夜景  航拍 ', sceneId: 'scene-01' })
      assert.equal(second.reused, true)
      assert.equal(second.ledger.action, 'reuse')
      assert.equal(second.ledger.paidSubmission, false)
      assert.equal(m.counters.submit, 1, 'provider must not be charged twice')
      // Image hashes ignore fields image adapters never send (durationSec)
      const third = await gen(dir, { prompt: '城市夜景 航拍', durationSec: 9 })
      assert.equal(third.reused, true)
      assert.equal(m.counters.submit, 1)
      // A different prompt is a different (new) paid job
      await gen(dir, { prompt: '完全不同的画面' })
      assert.equal(m.counters.submit, 2)
    })

    await test('ledger: interrupted polling resumes the recorded task id instead of re-submitting', async () => {
      const dir = makeProject('ledger-resume')
      const counters = { submit: 0, poll: 0, download: 0 }
      mockFetch(fluxMock({ readyAfterPolls: 99, counters }).handler)
      await assert.rejects(gen(dir, { prompt: '雪山日出', maxPolls: 2 }), (err) => err.code === 'CLOUD_JOB_PENDING' && err.taskId === 'task-1')
      const job = ledger.readCloudLedger(dir).jobs[0]
      assert.equal(job.status, 'submitted')
      assert.equal(job.taskId, 'task-1')
      counters.poll = 0
      mockFetch(fluxMock({ readyAfterPolls: 1, counters }).handler)
      const res = await gen(dir, { prompt: '雪山日出', maxPolls: 2 })
      assert.equal(res.ledger.action, 'resume')
      assert.equal(res.ledger.paidSubmission, false)
      assert.equal(counters.submit, 1, 'resume must not re-submit')
      assert.ok(fetchLog.every((r) => !r.url.includes('/v1/flux-pro-1.1')))
      assert.equal(ledger.readCloudLedger(dir).jobs[0].status, 'completed')
    })

    await test('ledger: unknown-outcome submission (gateway 504) is held, forceNew pays again explicitly', async () => {
      const dir = makeProject('ledger-hold')
      const counters = { submit: 0, poll: 0, download: 0 }
      mockFetch(fluxMock({ counters, submitStatus: 504, submitBody: { error: { message: 'gateway timeout' } } }).handler)
      await assert.rejects(gen(dir, { prompt: '海边灯塔' }))
      assert.equal(ledger.readCloudLedger(dir).jobs[0].status, 'interrupted')
      mockFetch(fluxMock({ counters }).handler)
      await assert.rejects(gen(dir, { prompt: '海边灯塔' }), (err) => err.code === 'CLOUD_JOB_BLOCKED' && /中断/.test(err.message))
      assert.equal(counters.submit, 1)
      const forced = await gen(dir, { prompt: '海边灯塔', forceNew: true })
      assert.equal(forced.ledger.paidSubmission, true)
      assert.equal(counters.submit, 2)
      // A plain 400 rejection is a definite failure (no charge) → no hold
      const dir2 = makeProject('ledger-400')
      const c2 = { submit: 0, poll: 0, download: 0 }
      mockFetch(fluxMock({ counters: c2, submitStatus: 400, submitBody: { error: { message: 'invalid prompt' } } }).handler)
      await assert.rejects(gen(dir2, { prompt: '违规内容' }))
      assert.equal(ledger.readCloudLedger(dir2).jobs[0].status, 'failed')
    })

    await test('ledger: concurrent identical requests share one paid submission', async () => {
      const dir = makeProject('ledger-dedupe')
      const m = fluxMock()
      mockFetch(m.handler)
      const [a, b] = await Promise.all([gen(dir, { prompt: '赛博朋克街道' }), gen(dir, { prompt: '赛博朋克街道' })])
      assert.equal(m.counters.submit, 1)
      assert.equal([a, b].filter((r) => r.ledger.paidSubmission).length, 1, 'only one caller may be counted as paying')
      assert.ok([a, b].some((r) => r.joinedInFlight))
    })

    await test('ledger: compare-and-swap refuses a create when another process recorded a newer job', async () => {
      const dir = makeProject('ledger-cas')
      const { paramsHash } = ledger.computeCloudParamsHash({ providerId: 'x', protocol: 'bfl-flux', category: 'image', prompt: 'p' })
      const first = ledger.createLedgerJob(dir, { paramsHash }, { expectLatestId: '' })
      assert.ok(first)
      assert.equal(ledger.createLedgerJob(dir, { paramsHash }, { expectLatestId: '' }), null, 'stale writer must lose')
      assert.equal(ledger.readCloudLedger(dir).jobs.length, 1)
      const live = ledger.decideLedgerAction(first, { ownerAlive: true })
      assert.equal(live.action, 'blocked')
      assert.equal(live.reason, 'submission-in-flight')
      const dead = ledger.decideLedgerAction(first, { ownerAlive: false })
      assert.equal(dead.reason, 'interrupted-submit-hold')
      assert.equal(ledger.decideLedgerAction(first, { nowMs: Date.now() + 31 * 60 * 1000 }).action, 'new', 'hold expires after 30 min')
    })

    await test('ledger: per-run budget gates new paid jobs; reuse never consumes budget; default cap 0', async () => {
      const dir = makeProject('ledger-budget')
      const m = fluxMock()
      mockFetch(m.handler)
      const budget = ledger.createPaidJobBudget({ runId: 'run-x', max: 1 })
      await gen(dir, { prompt: 'A', budget })
      assert.equal(budget.used, 1)
      await assert.rejects(gen(dir, { prompt: 'B', budget }), (err) => err.code === 'CLOUD_BUDGET_EXCEEDED')
      assert.equal(m.counters.submit, 1)
      const reused = await gen(dir, { prompt: 'A', budget })
      assert.equal(reused.reused, true)
      assert.equal(budget.used, 1)
      assert.equal(ledger.createPaidJobBudget({}).max, 0, 'DSH_CLOUD_MAX_PAID_JOBS_PER_RUN defaults to 0')
      assert.throws(() => ledger.createPaidJobBudget({}).consume({}), /未开启/)
    })

    await test('ledger: generated asset is registered but never bound into a locked scene', async () => {
      const dir = makeProject('ledger-locked-bind', { sceneExtra: (i) => (i === 0 ? { locked: true, media: [] } : {}) })
      mockFetch(fluxMock().handler)
      const res = await gen(dir, { prompt: '锁定场景素材', sceneId: 'scene-01' })
      assert.equal(res.bindSkipped, 'scene-locked')
      assert.deepEqual(sceneOf(dir, 'scene-01').media, [])
      assert.ok(JSON.parse(readFileSync(join(dir, 'assets.json'), 'utf8')).items.some((it) => it.path === res.path))
    })

    await test('sourcing plan: user assets → free stock → paid (only when enabled), locked scenes skipped', async () => {
      const dir = makeProject('sourcing-plan', { durations: [3, 3, 3, 3], sceneExtra: (i) => ({ media: [], ...(i === 3 ? { locked: true } : {}) }) })
      writeFileSync(join(dir, 'assets.json'), JSON.stringify({ version: 1, items: [{ id: 'img-1', type: 'image', role: 'image', path: 'assets/images/a.png' }], notes: [] }))
      const cloudConfig = { image: { providerId: 'bfl-flux', protocol: 'bfl-flux', apiKey: 'k' }, video: {}, autoUseCloudBroll: true }
      const none = cloud.resolveMediaSourcingPlan({ projectDir: dir, cloudConfig, stockConfig: { anyConfigured: false, configured: {} }, autoUseCloudBroll: true })
      assert.deepEqual(none.scenes.map((s) => s.source), ['user-assets', 'none', 'none', 'skip'])
      assert.match(none.scenes[1].reason, /不会产生任何费用/)
      const withStock = cloud.resolveMediaSourcingPlan({ projectDir: dir, cloudConfig, stockConfig: { anyConfigured: true, configured: { pexels: true } }, autoUseCloudBroll: true })
      assert.deepEqual(withStock.scenes.map((s) => s.source), ['user-assets', 'free-stock', 'free-stock', 'skip'])
      const paid = cloud.resolveMediaSourcingPlan({ projectDir: dir, cloudConfig, stockConfig: { anyConfigured: false, configured: {} }, autoUseCloudBroll: true, maxPaidJobsPerRun: 1 })
      assert.deepEqual(paid.scenes.map((s) => s.source), ['user-assets', 'paid-generation', 'none', 'skip'])
      assert.equal(paid.policy.paidEnabled, true)
    })

    // =====================================================================================
    // 2. Billing errors: classification, never retried, stop the run, mark the Task Center run
    // =====================================================================================
    await test('billing: classification of provider / LLM errors', async () => {
      const cls = (e) => ledger.classifyCloudError(e).kind
      const httpErr = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra })
      assert.equal(cls(httpErr(402, 'Payment Required')), 'billing')
      assert.equal(cls(httpErr(429, 'You exceeded your current quota', { providerCode: 'insufficient_quota' })), 'billing')
      assert.equal(cls(httpErr(400, '账户余额不足，请充值后重试')), 'billing')
      assert.equal(cls(new Error('Kling Image 提交失败: 账户已欠费')), 'billing')
      assert.equal(cls(httpErr(403, 'Insufficient balance in your account')), 'billing')
      assert.equal(cls(httpErr(400, 'not enough credits for this request')), 'billing')
      assert.equal(cls(httpErr(200, 'MiniMax 海螺提交失败', { providerCode: '1008' })), 'billing')
      assert.equal(cls(httpErr(400, 'monthly quota exhausted')), 'billing')
      assert.equal(cls(httpErr(429, 'Quota exceeded for requests per minute, please retry after 20s')), 'transient', '429 rate limits are not billing')
      assert.equal(cls(httpErr(503, 'upstream overloaded')), 'transient')
      assert.equal(cls(httpErr(400, 'invalid prompt')), 'fatal')
      assert.equal(cls(new Error('大模型接口 (openai-completions) 返回错误 (402): insufficient funds')), 'billing')
      assert.ok(ledger.billingErrorFromText('大模型修音方案生成回退至自适应母带 (返回错误 (402): Insufficient Balance)'))
      assert.equal(ledger.billingErrorFromText('大模型修音方案生成回退 (timeout)'), null)
    })

    await test('billing: provider billing error is recorded and never retried', async () => {
      const dir = makeProject('billing-cloud')
      const counters = { submit: 0, poll: 0, download: 0 }
      mockFetch(fluxMock({ counters, submitStatus: 402, submitBody: { error: { message: 'Insufficient credits', code: 'insufficient_credits' } } }).handler)
      const err = await gen(dir, { prompt: '余额测试' }).then(() => null, (e) => e)
      assert.ok(err, 'must throw')
      assert.equal(err.name, 'CloudBillingError')
      assert.equal(err.noRetry, true)
      assert.match(err.message, /计费异常·已立即停止/)
      assert.equal(counters.submit, 1, 'billing error must not be retried')
      const job = ledger.readCloudLedger(dir).jobs[0]
      assert.equal(job.status, 'billing_failed')
      assert.equal(job.errorKind, 'billing')
      // A later retry with the same params is a NEW decision (previous attempt was not charged) — but only if the user retries
      assert.equal(ledger.decideLedgerAction(job).action, 'new')
    })

    await test('billing: LLM client never retries a 402 / insufficient_quota reply', async () => {
      const llm = await imp('packages/dsh-tool-media/llm-client.js')
      let calls = 0
      const quota = async () => {
        calls++
        return jsonResp({ error: { message: 'You exceeded your current quota', code: 'insufficient_quota', type: 'insufficient_quota' } }, 429)
      }
      await assert.rejects(llm.callLlmChat({ overrideConfig: MOCK_LLM, fetchImpl: quota, messages: [{ role: 'user', content: 'hi' }] }), /429/)
      assert.equal(calls, 1, 'insufficient_quota (HTTP 429) must not be retried')
      calls = 0
      const pay = async () => {
        calls++
        return jsonResp({ error: { message: '账户余额不足' } }, 402)
      }
      await assert.rejects(llm.callLlmChat({ overrideConfig: MOCK_LLM, fetchImpl: pay, messages: [{ role: 'user', content: 'hi' }] }), /402/)
      assert.equal(calls, 1)
      calls = 0
      const rate = async () => {
        calls++
        return jsonResp({ error: { message: 'Rate limit reached for requests per minute' } }, 429)
      }
      await assert.rejects(llm.callLlmChat({ overrideConfig: MOCK_LLM, fetchImpl: rate, messages: [{ role: 'user', content: 'hi' }] }))
      assert.equal(calls, 2, 'a genuine rate limit is still retried')
    })

    await test('billing: sentinel trips once, later wrapped calls never touch the network', async () => {
      const sentinel = ledger.createBillingSentinel({ scope: 'llm', provider: 'mock-model' })
      let calls = 0
      const wrapped = sentinel.wrap(async () => {
        calls++
        throw Object.assign(new Error('返回错误 (402): 余额不足'), { status: 402 })
      })
      await assert.rejects(wrapped(), (e) => e.name === 'CloudBillingError')
      await assert.rejects(wrapped(), (e) => e.name === 'CloudBillingError')
      assert.equal(calls, 1)
      assert.throws(() => sentinel.throwIfTripped(), (e) => e.billing === true)
      // Non-billing errors pass through and do not trip
      const s2 = ledger.createBillingSentinel()
      await assert.rejects(s2.wrap(async () => { throw new Error('bad json') })(), /bad json/)
      s2.throwIfTripped()
    })

    await test('billing: a billing error stops the run and marks the Task Center run', async () => {
      const run = {
        id: 'run-billing',
        activeStage: 'audio',
        tasks: [
          { id: 't-director', stage: 'director', status: 'completed' },
          { id: 't-audio', stage: 'audio', status: 'running' },
          { id: 't-motion', stage: 'motion_qa', status: 'queued' },
        ],
      }
      const updates = []
      const logs = []
      const helpers = {
        signal: new AbortController().signal,
        updateTask: (id, patch) => updates.push({ id, ...patch }),
        appendLog: (stage, msg, level) => logs.push({ stage, msg, level }),
      }
      let motionRan = false
      const runner = async () => {
        const e = new Error('云端配音 HTTP 402: insufficient balance')
        e.status = 402
        throw e
        // eslint-disable-next-line no-unreachable
        motionRan = true
      }
      const err = await orchestrator.runWithBillingGuard(runner, run, helpers).then(() => null, (e) => e)
      assert.ok(err)
      assert.equal(err.name, 'CloudBillingError')
      assert.equal(motionRan, false)
      assert.equal(run.errorKind, 'billing')
      assert.equal(run.billingStop.retryable, false)
      assert.match(run.billingStop.message, /余额\/额度不足/)
      assert.deepEqual(updates.map((u) => [u.id, u.status]), [['t-audio', 'failed']])
      assert.ok(logs.some((l) => l.level === 'error' && /计费异常/.test(l.msg)))
      // The real Task Center then records the failure (status failed + error text)
      const { taskManager } = await imp('packages/dsh-tool-media/task-manager.js')
      const tmDir = makeProject('billing-taskcenter')
      const created = taskManager.createRun({ projectDir: tmDir, title: 'billing stop test' })
      const started = await taskManager.startRun(created.id, (r, h) => orchestrator.runWithBillingGuard(runner, r, h))
      await started.promise.catch(() => {})
      const final = taskManager.getRun(created.id)
      assert.equal(final.status, 'failed')
      assert.equal(final.errorKind, 'billing')
      assert.match(final.error, /计费异常·已立即停止/)
      // Non-billing errors pass through untouched (normal failure handling)
      const run2 = { id: 'run-2', tasks: [] }
      await assert.rejects(orchestrator.runWithBillingGuard(async () => { throw new Error('ffmpeg crashed') }, run2, helpers), /ffmpeg crashed/)
      assert.equal(run2.errorKind, undefined)
    })

    await test('billing: B-roll sourcing stops at the first paid-generation billing error', async () => {
      const dir = makeProject('billing-sourcing', { sceneExtra: () => ({ media: [] }) })
      const plan = {
        policy: { paidEnabled: true, paidCategory: 'image', paidProviderId: 'bfl-flux' },
        scenes: [
          { sceneId: 'scene-01', needsMedia: true, source: 'paid-generation', category: 'image', prompt: 'a' },
          { sceneId: 'scene-02', needsMedia: true, source: 'paid-generation', category: 'image', prompt: 'b' },
        ],
      }
      let calls = 0
      const generateFn = async () => {
        calls++
        throw Object.assign(new Error('HTTP 402 Payment Required'), { status: 402 })
      }
      await assert.rejects(cloud.executeMediaSourcingPlan({ projectDir: dir, plan, generateFn }), (e) => e.name === 'CloudBillingError')
      assert.equal(calls, 1, 'the second scene must not be attempted after a billing stop')
    })

    // =====================================================================================
    // 3. Character bank → reference images in the provider request / description fallback
    // =====================================================================================
    await test('characters: @mention attaches reference images (Flux) or injects the description (Fal)', async () => {
      const dir = makeProject('characters')
      const outside = join(SCRATCH, 'ref-src')
      mkdirSync(join(outside, 'a'), { recursive: true })
      mkdirSync(join(outside, 'b'), { recursive: true })
      writeFileSync(join(outside, 'a', 'face.png'), PNG_1PX)
      writeFileSync(join(outside, 'b', 'face.png'), Buffer.concat([PNG_1PX, Buffer.from([0])]))
      const saved = await chars.saveCharacter({
        projectDir: dir,
        character: { name: '霍去病', aliases: ['冠军侯'], description: '少年将军，银甲红缨', references: { face: [join(outside, 'a', 'face.png')] } },
      })
      const rel = saved.character.references.face[0]
      assert.ok(rel.startsWith('assets/'), 'out-of-project references are imported as project assets')
      // Same file name from another folder must not be confused with the first one
      const second = await chars.saveCharacter({ projectDir: dir, character: { name: '卫青', references: { face: [join(outside, 'b', 'face.png')] } } })
      assert.notEqual(second.character.references.face[0], rel)
      const ctx = chars.buildCharacterPromptContext({ projectDir: dir, prompt: '@冠军侯 骑马冲锋' })
      assert.equal(ctx.mentioned[0].name, '霍去病')
      assert.equal(ctx.prompt, '霍去病 骑马冲锋')
      assert.equal(ctx.references.length, 1)
      // Provider that supports references: BFL Flux → image_prompt carries the base64 image
      const m = fluxMock()
      mockFetch(m.handler)
      const res = await gen(dir, { prompt: '@冠军侯 骑马冲锋' })
      assert.equal(res.character.injection, 'reference-images')
      const submit = fetchLog.find((r) => r.url.startsWith('https://api.bfl.ai/v1/flux-pro-1.1'))
      const body = JSON.parse(submit.body)
      assert.equal(body.image_prompt, PNG_1PX.toString('base64'))
      assert.equal(body.prompt, '霍去病 骑马冲锋')
      // Provider without reference support (Fal) → textual description injected into the prompt
      const FAL = { providerId: 'fal-flux', protocol: 'fal-image', baseUrl: 'https://fal.run', endpoint: '/fal-ai/flux/schnell', model: 'fal-ai/flux/schnell', apiKey: 'fal-key' }
      mockFetch(async (url) => {
        if (url === 'https://fal.run/fal-ai/flux/schnell') return jsonResp({ images: [{ url: 'https://v3.fal.media/files/x.png' }] })
        if (url === 'https://v3.fal.media/files/x.png') return binResp(PNG_1PX)
        throw new Error(`unexpected ${url}`)
      })
      const res2 = await cloud.generateCloudMediaAsset({ projectDir: dir, category: 'image', prompt: '@霍去病 立于城头', providerOverride: FAL })
      assert.equal(res2.character.injection, 'text-description')
      const falBody = JSON.parse(fetchLog.find((r) => r.url === 'https://fal.run/fal-ai/flux/schnell').body)
      assert.match(falBody.prompt, /霍去病 立于城头/)
      assert.match(falBody.prompt, /少年将军，银甲红缨/)
      // attach: bind to scenes; delete removes the binding
      const att = await chars.attachCharacter({ projectDir: dir, name: '霍去病', sceneIds: ['scene-02'] })
      assert.deepEqual(att.boundScenes, ['scene-02'])
      assert.ok(sceneOf(dir, 'scene-02').characterIds.includes(saved.character.id))
      chars.deleteCharacter({ projectDir: dir, name: '霍去病' })
      assert.ok(!(sceneOf(dir, 'scene-02').characterIds || []).includes(saved.character.id))
    })

    await test('characters: saving a name that is another character\'s alias creates a new character, never overwrites it (review F13)', async () => {
      const dir = makeProject('characters-alias')
      const list = () => chars.listCharacters({ projectDir: dir, scope: 'project' }).project
      const zhang = await chars.saveCharacter({ projectDir: dir, character: { name: '张三', aliases: ['小张'], description: '30岁，黑框眼镜，灰色西装，项目经理' } })
      await chars.attachCharacter({ projectDir: dir, characterId: zhang.character.id, sceneIds: ['scene-01'] })
      // A new character whose name is 张三's alias: a different person (the Studio's save form sends no id)
      const intern = await chars.saveCharacter({ projectDir: dir, character: { name: '小张', description: '22岁实习生，扎马尾，白色卫衣' } })
      assert.equal(intern.created, true, 'an alias hit must create a new character')
      assert.notEqual(intern.character.id, zhang.character.id)
      assert.deepEqual(intern.aliasConflicts, [{ id: zhang.character.id, name: '张三' }])
      assert.deepEqual(list().map((c) => c.name), ['张三', '小张'])
      const zs = list().find((c) => c.id === zhang.character.id)
      assert.equal(zs.name, '张三')
      assert.match(zs.description, /^30岁/, '张三 must keep his description')
      assert.deepEqual(sceneOf(dir, 'scene-01').characterIds, [zhang.character.id], 'scene bindings keep pointing at 张三')
      // @mentions: a character's own name beats another character's alias
      const hits = chars.resolveCharacterMentions('@小张 和 @张三 吵架', list())
      assert.deepEqual(hits.map((h) => h.characterId), [intern.character.id, zhang.character.id])
      // Without an id only the exact name (case-insensitive, like the id) updates a character
      const again = await chars.saveCharacter({ projectDir: dir, character: { name: '小张', description: '实习生（改）' } })
      assert.equal(again.created, false)
      assert.equal(again.character.id, intern.character.id)
      assert.match(list().find((c) => c.id === zhang.character.id).description, /^30岁/)
      const a1 = await chars.saveCharacter({ projectDir: dir, character: { name: 'Alice' } })
      const a2 = await chars.saveCharacter({ projectDir: dir, character: { name: 'alice', description: 'case' } })
      assert.equal(a2.created, false)
      assert.equal(a2.character.id, a1.character.id)
      // A renamed character keeps its (name-derived) id; a new character with the old name gets a different one
      const l1 = await chars.saveCharacter({ projectDir: dir, character: { name: '小李' } })
      await chars.saveCharacter({ projectDir: dir, character: { id: l1.character.id, name: '李四' } })
      const l2 = await chars.saveCharacter({ projectDir: dir, character: { name: '小李' } })
      assert.equal(l2.created, true)
      assert.notEqual(l2.character.id, l1.character.id)
      const ids = list().map((c) => c.id)
      assert.equal(new Set(ids).size, ids.length, 'character ids must stay unique')
      assert.ok(list().some((c) => c.id === l1.character.id && c.name === '李四'))
      // Delete by name: the exact name wins over another character's alias
      const del = chars.deleteCharacter({ projectDir: dir, name: '小张' })
      assert.equal(del.deleted?.id, intern.character.id)
      assert.ok(list().some((c) => c.id === zhang.character.id))
    })

    // =====================================================================================
    // 4. Free stock media: official endpoints only, normalisation, "未配置", attribution
    // =====================================================================================
    await test('stock: "未配置" without keys, no network touched', async () => {
      mockFetch(async (url) => {
        throw new Error(`no request expected: ${url}`)
      })
      const res = await stock.searchStockMedia({ query: '城市', apiKeys: { pexelsApiKey: '', pixabayApiKey: '' } })
      assert.equal(res.ok, false)
      assert.equal(res.configured, false)
      assert.equal(res.status, '未配置')
      assert.equal(fetchLog.length, 0)
    })

    await test('stock: Pexels + Pixabay normalisation via official endpoints, 24h cache, filters', async () => {
      stock.resetStockRateLimitState()
      const cacheDir = join(SCRATCH, 'stock-cache')
      mockFetch(async (url, init) => {
        const u = new URL(url)
        if (u.origin === 'https://api.pexels.com' && u.pathname === '/v1/search') {
          assert.equal(init.headers.Authorization, 'pexels-key')
          return jsonResp({
            total_results: 2,
            photos: [
              { id: 11, width: 4000, height: 2250, url: 'https://www.pexels.com/photo/11/', photographer: 'Ann', photographer_url: 'https://www.pexels.com/@ann', alt: 'city', src: { tiny: 'https://images.pexels.com/t11.jpg', medium: 'https://images.pexels.com/m11.jpg', large2x: 'https://images.pexels.com/l11.jpg', original: 'https://images.pexels.com/o11.jpg' } },
              { id: 12, width: 1000, height: 1500, url: 'https://www.pexels.com/photo/12/', photographer: 'Bob', src: { large2x: 'https://images.pexels.com/l12.jpg' } },
            ],
          })
        }
        if (u.origin === 'https://pixabay.com' && u.pathname === '/api/videos/') {
          assert.equal(u.searchParams.get('key'), 'pixabay-key')
          return jsonResp({
            totalHits: 2,
            hits: [
              { id: 21, duration: 12, pageURL: 'https://pixabay.com/videos/id-21/', user: 'Cat', user_id: 7, tags: 'city, night', videos: { tiny: { url: 'https://cdn.pixabay.com/v/21-tiny.mp4', width: 640, height: 360, thumbnail: 'https://cdn.pixabay.com/v/21.jpg' }, large: { url: 'https://cdn.pixabay.com/v/21-large.mp4', width: 1920, height: 1080, size: 1234 } } },
              { id: 22, duration: 90, pageURL: 'https://pixabay.com/videos/id-22/', user: 'Dan', user_id: 8, videos: { large: { url: 'https://cdn.pixabay.com/v/22-large.mp4', width: 1920, height: 1080 } } },
            ],
          })
        }
        throw new Error(`non-official endpoint requested: ${url}`)
      })
      const img = await stock.searchStockMedia({ query: '城市', provider: 'pexels', orientation: 'landscape', apiKeys: { pexelsApiKey: 'pexels-key' }, cacheDir })
      assert.equal(img.ok, true)
      assert.equal(img.results.length, 1, 'portrait result filtered out by orientation')
      const r = img.results[0]
      assert.equal(r.provider, 'pexels')
      assert.equal(r.downloadUrl, 'https://images.pexels.com/l11.jpg')
      assert.equal(r.author.name, 'Ann')
      assert.equal(r.sourcePage, 'https://www.pexels.com/photo/11/')
      assert.equal(r.license.name, 'Pexels License')
      assert.equal(r.attribution, 'Photo by Ann on Pexels')
      const vid = await stock.searchStockMedia({ query: '城市', mediaType: 'video', provider: 'pixabay', maxDurationSec: 30, apiKeys: { pixabayApiKey: 'pixabay-key' }, cacheDir })
      assert.equal(vid.results.length, 1, 'duration filter drops the 90 s clip')
      assert.equal(vid.results[0].durationSec, 12)
      assert.equal(vid.results[0].downloadUrl, 'https://cdn.pixabay.com/v/21-large.mp4')
      assert.equal(vid.results[0].author.url, 'https://pixabay.com/users/Cat-7/')
      assert.ok(fetchLog.every((x) => /^https:\/\/(api\.pexels\.com|pixabay\.com)\//.test(x.url)), 'only official API hosts are contacted')
      // Second identical search is served from the 24h cache (no network)
      const before = fetchLog.length
      const cached = await stock.searchStockMedia({ query: '城市', provider: 'pexels', orientation: 'landscape', apiKeys: { pexelsApiKey: 'pexels-key' }, cacheDir })
      assert.equal(fetchLog.length, before)
      assert.equal(cached.providers[0].cached, true)
    })

    await test('stock: import keeps attribution, refuses non-CDN hosts, sanitises ids, skips locked scenes', async () => {
      const dir = makeProject('stock-import', { sceneExtra: (i) => (i === 1 ? { locked: true, media: [] } : {}) })
      mockFetch(async (url) => {
        if (url === 'https://images.pexels.com/l11.jpg') return binResp(PNG_1PX, 'image/jpeg')
        throw new Error(`unexpected ${url}`)
      })
      const item = { provider: 'pexels', providerItemId: '../../evil', mediaType: 'image', downloadUrl: 'https://images.pexels.com/l11.jpg', author: { name: 'Ann', url: 'https://www.pexels.com/@ann' }, sourcePage: 'https://www.pexels.com/photo/11/', license: { name: 'Pexels License', url: 'https://www.pexels.com/license/' }, attribution: 'Photo by Ann on Pexels', width: 4000, height: 2250 }
      const res = await stock.importStockMedia({ projectDir: dir, item, sceneId: 'scene-01', query: '城市' })
      assert.equal(res.ok, true)
      assert.ok(existsSync(join(dir, 'uploads', 'stock', 'pexels-image-evil.jpg')), 'item id sanitised in the file name')
      const asset = JSON.parse(readFileSync(join(dir, 'assets.json'), 'utf8')).items.find((it) => it.id === res.asset.id)
      assert.equal(asset.source, 'stock:pexels')
      assert.equal(asset.stock.author, 'Ann')
      assert.equal(asset.stock.license, 'Pexels License')
      assert.equal(asset.attribution, 'Photo by Ann on Pexels')
      assert.equal(sceneOf(dir, 'scene-01').media[0].assetId, res.asset.id)
      const locked = await stock.importStockMedia({ projectDir: dir, item: { ...item, providerItemId: '12' }, sceneId: 'scene-02' })
      assert.equal(locked.bindSkipped, 'scene-locked')
      assert.deepEqual(sceneOf(dir, 'scene-02').media, [])
      await assert.rejects(stock.importStockMedia({ projectDir: dir, item: { ...item, downloadUrl: 'https://evil.example.com/x.jpg' } }), /不是 Pexels 官方素材 CDN/)
    })

    // =========================================================================================
    // 5. Version history: snapshot / diff / restore / GC
    // =========================================================================================
    function ageAllObjects(dir, ms = 10 * 60 * 1000) {
      const objRoot = join(dir, 'history', 'objects')
      const past = new Date(Date.now() - ms)
      for (const shard of existsSync(objRoot) ? readdirSync(objRoot) : []) {
        for (const f of readdirSync(join(objRoot, shard))) utimesSync(join(objRoot, shard, f), past, past)
      }
    }
    function allObjectHashes(dir) {
      const objRoot = join(dir, 'history', 'objects')
      const out = new Set()
      for (const shard of existsSync(objRoot) ? readdirSync(objRoot) : []) {
        for (const f of readdirSync(join(objRoot, shard))) out.add(f.replace(/\.gz$/, ''))
      }
      return out
    }
    function referencedHashes(dir) {
      const doc = JSON.parse(readFileSync(join(dir, 'history', 'versions.json'), 'utf8'))
      const out = new Set()
      for (const v of doc.versions) for (const f of Object.values(v.files || {})) out.add(f.hash)
      return { doc, refs: out }
    }

    await test('history: snapshot dedupes identical states, diff reports scenes / fields / files, restore backs up first', async () => {
      const dir = makeProject('history-basic', { engine: 'remotion' })
      mkdirSync(join(dir, 'src', 'scenes'), { recursive: true })
      writeFileSync(join(dir, 'src', 'scenes', 'Batch01.tsx'), 'export const A = 1\n')
      mkdirSync(join(dir, 'assets', 'images'), { recursive: true })
      writeFileSync(join(dir, 'assets', 'images', 'big.png'), PNG_1PX)
      const v1 = history.createProjectSnapshot(dir, { label: 'v1', author: 'ai' })
      assert.equal(v1.deduped, false)
      const again = history.createProjectSnapshot(dir, { label: 'v1-again' })
      assert.equal(again.deduped, true, 'identical state must not create a new version')
      // Large media is referenced by path + size + mtime, never stored as an object
      const ver = history.getProjectVersion(dir, v1.id)
      assert.ok(ver.media['assets/images/big.png'])
      assert.ok(!ver.files['assets/images/big.png'])
      // Edit: change one scene field + add a file
      const s = readScript(dir)
      s.scenes[1].title = '改过的标题'
      writeScriptJson(dir, s)
      writeFileSync(join(dir, 'src', 'scenes', 'Batch02.tsx'), 'export const B = 2\n')
      const v2 = history.createProjectSnapshot(dir, { label: 'v2', author: 'user' })
      const diff = history.diffProjectVersions(dir, v1.id, v2.id)
      assert.deepEqual(diff.scenes.changed.map((c) => [c.sceneId, c.fields]), [['scene-02', ['title']]])
      assert.ok(diff.changedFiles.some((f) => f.path === 'src/scenes/Batch02.tsx' && f.change === 'added'))
      assert.ok(diff.changedFiles.some((f) => f.path === 'script.json' && f.change === 'modified'))
      assert.match(diff.summaryText, /场景修改 1 个/)
      // Unsaved edit after v2, then restore v1: the pre-restore backup captures the unsaved state
      const s3 = readScript(dir)
      s3.scenes[2].title = '未保存的修改'
      writeScriptJson(dir, s3)
      const res = history.restoreProjectVersion(dir, v1.id)
      assert.equal(res.ok, true)
      assert.equal(res.beforeRestoreVersion.kind, 'before-restore')
      assert.ok(res.removedFiles.includes('src/scenes/Batch02.tsx'))
      assert.equal(sceneOf(dir, 'scene-02').title, '镜头 2')
      // The pre-restore state is itself restorable (undo of the undo)
      history.restoreProjectVersion(dir, res.beforeRestoreVersion.id)
      assert.equal(sceneOf(dir, 'scene-02').title, '改过的标题')
      assert.equal(sceneOf(dir, 'scene-03').title, '未保存的修改')
      assert.ok(existsSync(join(dir, 'src', 'scenes', 'Batch02.tsx')))
      // Working tree already saved as the latest version → the restore backup dedupes onto it (not stored twice)
      const manual = history.createProjectSnapshot(dir, { label: 'manual-before-restore', author: 'user' })
      const dedupedBackup = history.restoreProjectVersion(dir, v1.id).beforeRestoreVersion
      assert.equal(dedupedBackup.deduped, true, 'an unchanged working tree is not stored twice')
      assert.equal(dedupedBackup.id, manual.id)
    })

    await test('history: retention cap + GC never deletes objects referenced by kept versions', async () => {
      const dir = makeProject('history-gc', { engine: 'remotion' })
      mkdirSync(join(dir, 'src'), { recursive: true })
      for (let i = 0; i < 7; i++) {
        writeFileSync(join(dir, 'src', 'Comp.tsx'), `export const N = ${i}\n`)
        if (i % 2 === 0) writeFileSync(join(dir, 'src', 'Shared.tsx'), 'export const SHARED = true\n')
        history.createProjectSnapshot(dir, { label: `v${i}`, max: 100 })
      }
      ageAllObjects(dir)
      const pr = history.pruneProjectHistory(dir, { max: 3 })
      assert.equal(pr.prunedVersions, 4)
      assert.equal(pr.remaining, 3)
      const { refs } = referencedHashes(dir)
      const present = allObjectHashes(dir)
      for (const h of refs) assert.ok(present.has(h), `referenced object ${h.slice(0, 10)} was deleted`)
      assert.ok(pr.removedObjects > 0, 'unreferenced objects should have been collected')
      for (const h of present) assert.ok(refs.has(h), `unreferenced object ${h.slice(0, 10)} survived GC`)
      // Every kept version is still fully restorable
      for (const v of history.listProjectVersions(dir).versions) {
        for (const rel of Object.keys(history.getProjectVersion(dir, v.id).files)) assert.ok(history.readVersionFile(dir, v.id, rel))
      }
    })

    await test('history: GC grace keeps fresh unrecorded objects; the restore target survives pruning', async () => {
      const dir = makeProject('history-grace')
      const v1 = history.createProjectSnapshot(dir, { label: 'v1' })
      // A fresh orphan object (another writer that has not recorded its version yet)
      const orphanDir = join(dir, 'history', 'objects', 'ff')
      mkdirSync(orphanDir, { recursive: true })
      writeFileSync(join(orphanDir, `${'f'.repeat(64)}.gz`), 'x')
      history.pruneProjectHistory(dir, { max: 50 })
      assert.ok(existsSync(join(orphanDir, `${'f'.repeat(64)}.gz`)), 'fresh unreferenced objects are kept during the grace window')
      // Restore the OLDEST version while at the retention cap: it must not be pruned by the before-restore snapshot
      for (let i = 0; i < 2; i++) {
        const s = readScript(dir)
        s.title = `第 ${i} 次修改`
        writeScriptJson(dir, s)
        history.createProjectSnapshot(dir, { label: `edit-${i}`, max: 3 })
      }
      const s = readScript(dir)
      s.title = '未保存的修改'
      writeScriptJson(dir, s)
      process.env.DSH_HISTORY_MAX = '3'
      try {
        const res = history.restoreProjectVersion(dir, v1.id)
        assert.equal(res.ok, true)
        assert.ok(history.getProjectVersion(dir, v1.id), 'restore target must survive the pre-restore prune')
        assert.equal(readScript(dir).title, '测试工程 history-grace')
      } finally {
        delete process.env.DSH_HISTORY_MAX
      }
    })

    await test('history: AI-coding undo uses the unified store (rollback walks back, legacy dirs migrate)', async () => {
      const dir = makeProject('history-undo')
      // Legacy v-* snapshot directory from the previous implementation
      const legacy = join(dir, 'history', `v-${Date.now() - 60_000}-pre-refine`)
      mkdirSync(legacy, { recursive: true })
      writeFileSync(join(legacy, 'script.json'), JSON.stringify({ ...readScript(dir), title: '旧版快照标题' }, null, 2))
      assert.ok(coder.getAiCodingHistory(dir).length >= 1)
      assert.ok(!existsSync(legacy), 'legacy directory must be migrated into the content-addressed store')
      const s = readScript(dir)
      s.title = 'AI 改过'
      writeScriptJson(dir, s)
      coder.snapshotProjectVersion(dir, 'post-ai')
      const rb = coder.rollbackAiVersion(dir)
      assert.equal(rb.ok, true)
      assert.equal(readScript(dir).title, '旧版快照标题')
    })

    const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
    const NINE_MB = 9 * 1024 * 1024 // above MAX_TRACKED_FILE_BYTES (8 MB): never stored as a history object

    await test('history: restore never destroys a file the safety snapshot could not store (> 8 MB) — it goes to history/trash (review F3)', async () => {
      // (a) a 9 MB data file + a hand-written scene added after v1, then "restore v1"
      const dir = makeProject('history-restore-big', { engine: 'remotion' })
      mkdirSync(join(dir, 'src', 'scenes'), { recursive: true })
      writeFileSync(join(dir, 'src', 'scenes', 'Scene01.tsx'), 'export const Scene01 = () => null\n')
      const v1 = history.createProjectSnapshot(dir, { label: 'v1' })
      const big = join(dir, 'src', 'assets-data.json')
      const bigBuf = Buffer.from(JSON.stringify({ blob: 'x'.repeat(NINE_MB) }))
      writeFileSync(big, bigBuf)
      writeFileSync(join(dir, 'src', 'scenes', 'Scene02.tsx'), 'export const Scene02 = () => "hand written"\n')
      const r = history.restoreProjectVersion(dir, v1.id)
      assert.ok(r.removedFiles.includes('src/assets-data.json') && r.removedFiles.includes('src/scenes/Scene02.tsx'), JSON.stringify(r.removedFiles))
      assert.ok(!existsSync(big), 'the restore itself still applies')
      const t = (r.trashedFiles || []).find((f) => f.path === 'src/assets-data.json')
      assert.ok(t && /^history\/trash\//.test(r.trashDir || ''), `big file not moved to history/trash: ${JSON.stringify({ trashDir: r.trashDir, trashed: r.trashedFiles })}`)
      assert.equal(sha256(readFileSync(join(dir, ...t.trashPath.split('/')))), sha256(bigBuf), 'the trashed copy must be byte-identical')
      assert.ok(history.getProjectVersion(dir, r.beforeRestoreVersion.id).files['src/scenes/Scene02.tsx'], 'small files stay recoverable from the before-restore version')
      assert.ok(!Object.keys(history.computeCurrentProjectState(dir).files).some((k) => k.startsWith('history')), 'history/trash is never tracked')
      // (b) a big file the TARGET version itself recorded as too large is kept — neither deleted nor trashed
      const dirB = makeProject('history-restore-big-kept', { engine: 'remotion' })
      mkdirSync(join(dirB, 'src', 'scenes'), { recursive: true })
      writeFileSync(join(dirB, 'src', 'scenes', 'Scene01.tsx'), 'export const Scene01 = () => null\n')
      const bigB = join(dirB, 'src', 'big-module.json')
      writeFileSync(bigB, Buffer.alloc(NINE_MB, 65))
      const vB = history.createProjectSnapshot(dirB, { label: 'v1' })
      assert.ok((history.getProjectVersion(dirB, vB.id).skipped || []).some((s) => s.rel === 'src/big-module.json' && s.reason === 'too-large'))
      writeFileSync(join(dirB, 'src', 'scenes', 'Scene01.tsx'), 'export const Scene01 = () => "edited"\n')
      const rB = history.restoreProjectVersion(dirB, vB.id)
      assert.ok(existsSync(bigB), 'a file the target could not store must be kept')
      assert.ok(rB.keptFiles.some((k) => k.path === 'src/big-module.json') && rB.trashedFiles.length === 0, JSON.stringify({ kept: rB.keptFiles, trashed: rB.trashedFiles }))
      assert.equal(readFileSync(join(dirB, 'src', 'scenes', 'Scene01.tsx'), 'utf8'), 'export const Scene01 = () => null\n')
      // (c) an oversized index.html that the restore overwrites is trashed first
      const dirC = makeProject('history-restore-big-html')
      writeFileSync(join(dirC, 'index.html'), '<!doctype html><title>v1</title>')
      const vC = history.createProjectSnapshot(dirC, { label: 'v1' })
      const bigHtml = Buffer.alloc(NINE_MB, 66)
      writeFileSync(join(dirC, 'index.html'), bigHtml)
      const rC = history.restoreProjectVersion(dirC, vC.id)
      const tC = (rC.trashedFiles || []).find((f) => f.path === 'index.html')
      assert.ok(tC, `oversized index.html not trashed: ${JSON.stringify(rC.trashedFiles)}`)
      assert.equal(sha256(readFileSync(join(dirC, ...tC.trashPath.split('/')))), sha256(bigHtml))
      assert.match(readFileSync(join(dirC, 'index.html'), 'utf8'), /<title>v1<\/title>/)
    })

    await test('history: a crafted versions.json never makes restore write outside the project; links under history/ or src/ are never followed (review F11)', async () => {
      const outside = join(SCRATCH, 'f11-outside')
      mkdirSync(outside, { recursive: true })
      // A project "from elsewhere" whose history/versions.json was hand-crafted (objects are valid gzip blobs)
      const craftedProject = (name, files) => {
        const dir = makeProject(name, { engine: 'remotion' })
        const objects = join(dir, 'history', 'objects')
        const put = (buf) => {
          const hash = sha256(buf)
          mkdirSync(join(objects, hash.slice(0, 2)), { recursive: true })
          writeFileSync(join(objects, hash.slice(0, 2), `${hash}.gz`), gzipSync(buf))
          return hash
        }
        const scriptBuf = readFileSync(join(dir, 'script.json'))
        const map = { 'script.json': { hash: put(scriptBuf), size: scriptBuf.length } }
        for (const [rel, spec] of Object.entries(files)) map[rel] = spec.hash ? spec : { hash: put(Buffer.from(spec.content)), size: spec.content.length }
        const version = { id: 'ver-shared-1', seq: 1, time: new Date().toISOString(), label: 'shared', author: 'user', kind: 'manual', stateHash: 'x', files: map, media: {} }
        writeFileSync(join(dir, 'history', 'versions.json'), JSON.stringify({ version: 1, seq: 1, versions: [version] }))
        return dir
      }
      const cases = [
        ['../ traversal', { '../f11-outside/pwned1.txt': { content: 'pwned' } }, join(outside, 'pwned1.txt')],
        ['src/../ traversal', { 'src/../../f11-outside/pwned2.txt': { content: 'pwned' } }, join(outside, 'pwned2.txt')],
        ['absolute path', { [join(outside, 'pwned3.txt').replace(/\\/g, '/')]: { content: 'pwned' } }, join(outside, 'pwned3.txt')],
        ['backslash traversal', { 'src\\..\\..\\f11-outside\\pwned4.txt': { content: 'pwned' } }, join(outside, 'pwned4.txt')],
        ['untracked root file', { 'package.json': { content: '{"scripts":{"postinstall":"evil"}}' } }, null],
        ['malformed object hash', { 'src/x.tsx': { hash: '../../../../../f11-outside/x', size: 1 } }, null],
      ]
      for (const [label, files, victim] of cases) {
        const dir = craftedProject(`f11-${label.replace(/\W+/g, '-')}`, files)
        const before = readFileSync(join(dir, 'script.json'), 'utf8')
        assert.throws(
          () => history.restoreProjectVersion(dir, 'ver-shared-1'),
          (e) => e.status === 409 && e.code === 'HISTORY_UNSAFE_VERSION' && /已拒绝恢复/.test(e.message),
          `${label}: crafted version must be refused`,
        )
        if (victim) assert.ok(!existsSync(victim), `${label}: wrote outside the project`)
        assert.ok(!existsSync(join(dir, 'package.json')), `${label}: wrote an untracked file`)
        assert.equal(readFileSync(join(dir, 'script.json'), 'utf8'), before, `${label}: the project changed although the restore was refused`)
      }
      const plain = makeProject('f11-unknown-version')
      assert.throws(() => history.restoreProjectVersion(plain, 'ver-nope'), (e) => e.status === 404 && e.code === 'VERSION_NOT_FOUND')
      assert.throws(() => history.diffProjectVersions(plain, 'ver-nope'), (e) => e.status === 404)

      // src/ replaced by a junction to an outside folder: snapshot does not read through it, restore never writes through it
      const dirJ = makeProject('f11-src-junction', { engine: 'remotion' })
      mkdirSync(join(dirJ, 'src', 'scenes'), { recursive: true })
      writeFileSync(join(dirJ, 'src', 'scenes', 'Scene01.tsx'), 'export const Scene01 = () => null\n')
      const vJ = history.createProjectSnapshot(dirJ, { label: 'v1' })
      const outsideSrc = join(outside, 'other-src')
      mkdirSync(join(outsideSrc, 'scenes'), { recursive: true })
      writeFileSync(join(outsideSrc, 'scenes', 'Scene01.tsx'), 'OUTSIDE FILE\n')
      writeFileSync(join(outsideSrc, 'keep-me.txt'), 'outside data\n')
      unlinkSync(join(dirJ, 'src', 'scenes', 'Scene01.tsx'))
      rmdirSync(join(dirJ, 'src', 'scenes'))
      rmdirSync(join(dirJ, 'src'))
      symlinkSync(outsideSrc, join(dirJ, 'src'), 'junction')
      try {
        assert.ok(!Object.keys(history.computeCurrentProjectState(dirJ).files).some((k) => k.startsWith('src/')), 'snapshot read through the src junction')
        const rJ = history.restoreProjectVersion(dirJ, vJ.id)
        assert.equal(readFileSync(join(outsideSrc, 'scenes', 'Scene01.tsx'), 'utf8'), 'OUTSIDE FILE\n', 'restore wrote through the junction')
        assert.ok(existsSync(join(outsideSrc, 'keep-me.txt')), 'restore deleted a file behind the junction')
        assert.ok(rJ.skippedFiles.some((s) => s.path === 'src/scenes/Scene01.tsx' && s.reason === 'link'), JSON.stringify(rJ.skippedFiles))
      } finally {
        unlinkSync(join(dirJ, 'src')) // the junction itself, never its target
      }

      // Junction shards under history/objects (one with a valid shard name): prune / GC never follows them
      const dirG = makeProject('f11-prune-junction')
      history.createProjectSnapshot(dirG, { label: 'v1' })
      const objRoot = join(dirG, 'history', 'objects')
      const freeShards = [...Array(256).keys()].map((n) => n.toString(16).padStart(2, '0')).filter((s) => !existsSync(join(objRoot, s)))
      const [linkShard, foreignShard] = freeShards // valid two-hex shard names no real object uses
      const victimDir = join(outside, 'Documents')
      mkdirSync(victimDir, { recursive: true })
      const victimFile = join(victimDir, 'thesis-final.docx')
      const objectLookalike = join(victimDir, `${linkShard}${'a'.repeat(62)}.gz`) // a valid, unreferenced object name for that shard
      writeFileSync(victimFile, 'important user file')
      writeFileSync(objectLookalike, 'looks like an object')
      const old = new Date(Date.now() - 3600_000)
      utimesSync(victimFile, old, old)
      utimesSync(objectLookalike, old, old)
      const links = [join(objRoot, 'zz'), join(objRoot, linkShard)]
      for (const l of links) symlinkSync(victimDir, l, 'junction')
      const foreign = join(objRoot, foreignShard)
      mkdirSync(foreign, { recursive: true })
      writeFileSync(join(foreign, 'notes.txt'), 'not an object')
      utimesSync(join(foreign, 'notes.txt'), old, old)
      const orphan = join(foreign, `${foreignShard}${'c'.repeat(62)}.gz`)
      writeFileSync(orphan, 'orphan object')
      utimesSync(orphan, old, old)
      try {
        const pr = history.pruneProjectHistory(dirG)
        assert.ok(existsSync(victimFile) && existsSync(objectLookalike), `prune / GC followed a junction: ${JSON.stringify(pr)}`)
        assert.ok(existsSync(join(foreign, 'notes.txt')), 'a non-object file in a real shard must be kept')
        assert.ok(!existsSync(orphan) && pr.removedObjects === 1, `the real orphan object should still be collected: ${JSON.stringify(pr)}`)
      } finally {
        for (const l of links) unlinkSync(l) // the junctions themselves, never their target
      }
    })

    // =========================================================================================
    // 6. Human edit protection: locks + overrides + three-way merge
    // =========================================================================================
    await test('locks: locked scene survives a mocked LLM director re-plan (content + timing), overrides re-applied', async () => {
      const dir = makeProject('locks-replan')
      locks.setSceneLock({ projectDir: dir, sceneId: 'scene-02', reason: '客户已确认' })
      locks.setSceneOverrides({ projectDir: dir, sceneId: 'scene-03', overrides: { title: '用户标题', durationSec: 5 } })
      const prev = readScript(dir)
      // Mocked director output: rewrites every scene, drops scene-02, renames scene-03's title
      const next = {
        ...prev,
        scenes: [
          { ...prev.scenes[0], title: 'AI 新标题 1', narration: 'AI 新旁白 1', durationSec: 2 },
          { ...prev.scenes[2], title: 'AI 新标题 3', narration: 'AI 新旁白 3', durationSec: 2.5 },
          { id: 'scene-04', title: 'AI 新增', narration: 'AI 新增旁白', durationSec: 3, locked: true },
        ],
      }
      const { script, report } = locks.reconcileUserEdits({ projectDir: dir, prevScript: prev, nextScript: next, stage: 'test-director' })
      const ids = script.scenes.map((s) => s.id)
      assert.deepEqual(ids, ['scene-01', 'scene-02', 'scene-03', 'scene-04'], 'locked scene re-inserted at its original index')
      const s2 = script.scenes.find((s) => s.id === 'scene-02')
      assert.equal(s2.narration, prev.scenes[1].narration)
      assert.equal(s2.durationSec, prev.scenes[1].durationSec)
      assert.equal(s2.locked, true)
      const s3 = script.scenes.find((s) => s.id === 'scene-03')
      assert.equal(s3.title, '用户标题', 'user override wins over the AI rewrite')
      assert.equal(s3.durationSec, 5)
      assert.equal(script.scenes.find((s) => s.id === 'scene-04').locked, undefined, 'a positional lock artifact never locks new AI content')
      assert.deepEqual(report.lockedReinserted, ['scene-02'])
      assert.ok(report.conflicts.some((c) => c.sceneId === 'scene-03' && c.field === 'title' && c.resolution === 'ours'))
      assert.deepEqual(script.userOverrides, { 'scene-03': { title: '用户标题', durationSec: 5 } })
    })

    await test('locks: three-way merge distinguishes AI-unchanged fields from conflicts', async () => {
      const base = { id: 's', title: 'A', transition: 'cut', narration: 'n' }
      // AI kept the title (= base) but changed the transition → only the transition override is a conflict
      const theirs = { id: 's', title: 'A', transition: 'light-wipe', narration: 'n2' }
      const ours = { title: '用户', transition: 'zoom-punch' }
      const res = locks.threeWayMergeScene({ sceneId: 's', base, theirs, ours })
      assert.equal(res.scene.title, '用户')
      assert.equal(res.scene.transition, 'zoom-punch')
      assert.equal(res.scene.narration, 'n2', 'non-overridden AI changes are kept')
      assert.deepEqual(res.conflicts.map((c) => c.field), ['transition'])
    })

    await test('locks: overrides reject prototype pollution and protected fields', async () => {
      const dir = makeProject('locks-pollution')
      assert.throws(() => locks.setSceneOverrides({ projectDir: dir, sceneId: 'scene-01', overrides: JSON.parse('{"__proto__.polluted":1}') }), /不允许/)
      assert.throws(() => locks.setSceneOverrides({ projectDir: dir, sceneId: 'scene-01', overrides: { 'constructor.prototype.x': 1 } }), /不允许/)
      assert.throws(() => locks.setSceneOverrides({ projectDir: dir, sceneId: 'scene-01', overrides: { locked: false } }), /受保护/)
      assert.throws(() => locks.setSceneOverrides({ projectDir: dir, sceneId: '__project__', overrides: { scenes: [] } }), /受保护/)
      // A hand-edited script.json with a malicious override is ignored on apply
      const s = readScript(dir)
      s.userOverrides = { 'scene-01': JSON.parse('{"__proto__":{"polluted":true},"title":"ok"}') }
      locks.applyUserOverrides(s)
      assert.equal({}.polluted, undefined)
      assert.equal(s.scenes[0].title, 'ok')
    })

    await test('locks: batched TSX re-code keeps the locked scene implementation (mocked LLM)', async () => {
      const dir = makeProject('locks-recode', { engine: 'remotion', durations: [3, 3, 3] })
      const scenesDir = join(dir, 'src', 'scenes')
      mkdirSync(scenesDir, { recursive: true })
      const lockedImpl = "import React from 'react';\nimport { useCurrentFrame } from 'remotion';\nexport const BATCH_01_SCENES: Record<string, React.FC<any>> = {\n  'scene-01': () => { useCurrentFrame(); return <div>ONE-ORIGINAL</div> },\n  'scene-02': () => { useCurrentFrame(); return <div>TWO-LOCKED-ORIGINAL</div> },\n};\n"
      writeFileSync(join(scenesDir, 'Batch01.tsx'), lockedImpl)
      writeFileSync(join(scenesDir, 'index.ts'), "import { BATCH_01_SCENES } from './Batch01';\nexport const CUSTOM_SCENE_MAP: Record<string, any> = { ...BATCH_01_SCENES };\n")
      locks.setSceneLock({ projectDir: dir, sceneId: 'scene-02' })
      const lockedScript = readScript(dir)
      const prompts = []
      const callLlmChatFn = async ({ messages }) => {
        prompts.push(String(messages?.[0]?.content || ''))
        const file = /src\/scenes\/Batch\d+\.tsx/.exec(prompts[prompts.length - 1])?.[0] || 'src/scenes/Batch01.tsx'
        const exportName = `BATCH_${/Batch(\d+)/.exec(file)[1]}_SCENES`
        const code = `import React from 'react';\nimport { useCurrentFrame } from 'remotion';\nexport const ${exportName}: Record<string, React.FC<any>> = {\n  'scene-01': () => { useCurrentFrame(); return <div>ONE-NEW</div> },\n  'scene-03': () => { useCurrentFrame(); return <div>THREE-NEW</div> },\n};\n`
        return { text: JSON.stringify({ files: { [file]: code } }) }
      }
      const res = await coder.authorBatchedRemotionScenes({ absDir: dir, lockedScript, callLlmChatFn, batchSize: 3, concurrency: 1, maxRepairRounds: 0 })
      assert.ok(prompts.length >= 1)
      assert.ok(prompts.every((p) => !p.includes('"scene-02"') && !p.includes("'scene-02'")), 'the locked scene is never sent to the LLM')
      assert.deepEqual(res.lockedSceneIds, ['scene-02'])
      const lockedCopy = readdirSync(scenesDir).find((f) => f.startsWith('Locked_'))
      assert.ok(lockedCopy, 'the pre-lock implementation is preserved as a Locked_ module')
      assert.match(readFileSync(join(scenesDir, lockedCopy), 'utf8'), /TWO-LOCKED-ORIGINAL/)
      const indexTs = readFileSync(join(scenesDir, 'index.ts'), 'utf8')
      assert.match(indexTs, /dsh-locked-scenes/)
      assert.match(indexTs, /__dshLockedPick\(__DSH_LOCKED_0, \["scene-02"\]\)/, 'registry routes scene-02 to the locked copy')
    })

    await test('locks: audio stage keeps locked sfxCues (scene-relative) and re-applies overrides', async () => {
      const script = {
        fps: 30,
        bgm: { bpm: 120, beats: [0, 0.5, 1, 1.5] },
        scenes: [
          { id: 'scene-01', durationSec: 3, sfxCues: [{ kind: 'hit', offsetSec: 0.2 }] },
          { id: 'scene-02', durationSec: 3, locked: true, sfxCues: [{ kind: 'whoosh', offsetSec: 0.4 }, { kind: 'riser', offsetSec: 2.8 }] },
        ],
        userOverrides: { 'scene-01': { title: '人工标题' } },
      }
      const snap = locks.snapshotLockedSceneAudio(script)
      // Beat re-quantization rewrites cues, moves the grid and shortens the locked scene
      script.bgm = { bpm: 96, beats: [0, 0.625, 1.25] }
      script.scenes[1].durationSec = 2
      script.scenes[1].sfxCues = [{ kind: 'pop', offsetSec: 1.1 }]
      script.scenes[0].sfxCues = [{ kind: 'pop', offsetSec: 0.1 }]
      const out = locks.restoreLockedSceneSfx(script, snap)
      locks.applyUserOverrides(script)
      assert.deepEqual(out.restored, ['scene-02'])
      assert.equal(out.gridChanged, true)
      assert.deepEqual(script.scenes[1].sfxCues.map((c) => c.kind), ['whoosh', 'riser'])
      assert.equal(script.scenes[1].sfxCues[1].offsetSec, 1.95, 'cue beyond the new scene end is clamped inside the scene')
      assert.equal(script.scenes[1].sfxCues[1].clampedByLock, true)
      assert.equal(script.scenes[0].sfxCues[0].kind, 'pop', 'unlocked scenes take the new choreography')
      assert.equal(script.scenes[0].title, '人工标题')
    })

    await test('locks: local re-plan keeps the locked scene and its HTML block; voice fields re-asserted', async () => {
      const dir = makeProject('locks-local-plan', { durations: [3, 3, 3] })
      writeFileSync(join(dir, 'index.html'), htmlGen.buildRichHtmlVideo(readScript(dir)))
      const s = readScript(dir)
      s.scenes[1].voiceId = 'my-custom-voice'
      s.scenes[1].narration = '客户确认过的旁白，不可改动'
      writeScriptJson(dir, s)
      writeFileSync(join(dir, 'index.html'), htmlGen.buildRichHtmlVideo(readScript(dir)))
      locks.setSceneLock({ projectDir: dir, sceneId: 'scene-02' })
      const lockedBlock = refine.extractHtmlSceneBlock(readFileSync(join(dir, 'index.html'), 'utf8'), 'scene-02')
      assert.ok(lockedBlock, 'lock captures the HTML block')
      assert.ok(existsSync(join(dir, 'output', 'locked-html-scenes.json')))
      const res = await director.planVideoFromAssets({ projectDir: dir, topic: '全新主题：深海探索', engine: 'html', style: 'tech' })
      const s2 = res.script.scenes.find((x) => x.id === 'scene-02')
      assert.ok(s2, 'locked scene survives the local re-plan')
      assert.equal(s2.narration, '客户确认过的旁白，不可改动')
      assert.equal(s2.voiceId, 'my-custom-voice', 'voice casting does not overwrite the locked voice')
      assert.equal(refine.extractHtmlSceneBlock(readFileSync(join(dir, 'index.html'), 'utf8'), 'scene-02'), lockedBlock, 'regenerated index.html keeps the locked block verbatim')
      // Unlock drops the store
      locks.setSceneLock({ projectDir: dir, sceneId: 'scene-02', locked: false })
      assert.ok(!existsSync(join(dir, 'output', 'locked-html-scenes.json')))
    })

    // =====================================================================================
    // 7. 指哪改哪: time-range / region mapping (scene boundaries) + mocked end-to-end refine
    // =====================================================================================
    await test('refine mapping: time ranges at exact scene boundaries never leak into neighbours', async () => {
      // 3 s | 3.3 s | 4 s @30fps → frames [0,90) [90,189) [189,309)
      const script = { fps: 30, scenes: [{ id: 'a', durationSec: 3 }, { id: 'b', durationSec: 3.3 }, { id: 'c', durationSec: 4 }] }
      const tl = refine.computeSceneTimeline(script)
      assert.deepEqual(tl.rows.map((r) => [r.startFrame, r.endFrame]), [[0, 90], [90, 189], [189, 309]])
      const inner = refine.mapTimeRangeToScenes(script, { startSec: 3, endSec: 6.3 })
      assert.deepEqual(inner.scenes.map((s) => s.sceneId), ['b'], 'a range exactly matching scene b touches only b')
      assert.equal(inner.scenes[0].localStartFrame, 0)
      assert.equal(inner.scenes[0].localEndFrame, 99)
      const cross = refine.mapTimeRangeToScenes(script, { startSec: 2.5, endSec: 3.5 })
      assert.deepEqual(cross.scenes.map((s) => [s.sceneId, s.localStartFrame, s.localEndFrame]), [['a', 75, 90], ['b', 0, 15]])
      const tail = refine.mapTimeRangeToScenes(script, { startSec: 9, endSec: 99 })
      assert.deepEqual(tail.scenes.map((s) => [s.sceneId, s.localStartFrame, s.localEndFrame]), [['c', 81, 120]])
      assert.equal(tail.clamped.endSec, 10.3)
      const tiny = refine.mapTimeRangeToScenes(script, { startSec: 6.3, endSec: 6.31 })
      assert.deepEqual(tiny.scenes.map((s) => s.sceneId), ['c'], 'a range starting on a boundary belongs to the next scene')
      assert.throws(() => refine.mapTimeRangeToScenes(script, { startSec: 4, endSec: 4 }), /endSec/)
      assert.throws(() => refine.mapTimeRangeToScenes(script, { startSec: 20, endSec: 30 }), /超出成片总时长/)
      assert.throws(() => refine.mapTimeRangeToScenes(script, { startSec: 'x', endSec: 1 }), /数值/)
    })

    await test('refine mapping: region normalisation (norm / percent / px / slight overflow) and pixel projection', async () => {
      const n = refine.normalizeRefineRegion({ x: 0.5, y: 0.25, w: 0.25, h: 0.5 }, { width: 1920, height: 1080 })
      assert.deepEqual(n.px, { left: 960, top: 270, width: 480, height: 540 })
      assert.equal(n.inputUnit, 'norm')
      const over = refine.normalizeRefineRegion({ x: 0.8, y: 0.8, w: 0.3, h: 0.3 })
      assert.equal(over.w, 0.2, 'slight drag overflow is clamped to the frame (not misread as percent)')
      assert.equal(over.inputUnit, 'norm')
      const pct = refine.normalizeRefineRegion({ x: 10, y: 20, w: 30, h: 40 })
      assert.deepEqual([pct.x, pct.y, pct.w, pct.h], [0.1, 0.2, 0.3, 0.4])
      const px = refine.normalizeRefineRegion({ x: 960, y: 540, w: 480, h: 270, unit: 'px' }, { width: 1920, height: 1080 })
      assert.deepEqual([px.x, px.y, px.w, px.h], [0.5, 0.5, 0.25, 0.25])
      assert.match(n.anchorHint, /画面/)
      assert.throws(() => refine.normalizeRefineRegion({ x: 0, y: 0, w: 0, h: 0.5 }), /过小/)
      assert.throws(() => refine.normalizeRefineRegion({ x: -1, y: 0, w: 1, h: 1 }), /非负/)
      assert.throws(() => refine.normalizeRefineRegion({ x: 1, y: 0.2, w: 0.1, h: 0.1 }), /超出画面/)
    })

    await test('refine prepare: affected scenes, locked skipped, only affected files editable', async () => {
      const dir = makeProject('refine-prepare', { engine: 'remotion', durations: [3, 3, 3] })
      mkdirSync(join(dir, 'src', 'scenes'), { recursive: true })
      writeFileSync(join(dir, 'src', 'scenes', 'Batch01.tsx'), "export const BATCH_01_SCENES = { 'scene-01': X, 'scene-02': Y }\n")
      writeFileSync(join(dir, 'src', 'scenes', 'Batch02.tsx'), "export const BATCH_02_SCENES = { 'scene-03': Z }\n")
      const s = readScript(dir)
      s.scenes[1].locked = true
      writeScriptJson(dir, s)
      const prep = refine.prepareTargetedRefine({ absDir: dir, script: readScript(dir), timeRange: { startSec: 2, endSec: 7 }, region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } })
      assert.equal(prep.mode, 'targeted')
      assert.deepEqual(prep.requestedSceneIds, ['scene-01', 'scene-02', 'scene-03'])
      assert.deepEqual(prep.affectedSceneIds, ['scene-01', 'scene-03'])
      assert.deepEqual(prep.skippedLockedScenes, ['scene-02'])
      assert.deepEqual([...prep.allowedFiles].sort(), ['src/scenes/Batch01.tsx', 'src/scenes/Batch02.tsx'])
      assert.match(prep.promptBlock, /本地帧 \[60, 90\)/)
      assert.match(prep.promptBlock, /严禁修改：scene-02/)
      const filtered = refine.filterRefinePatch(
        { 'src/scenes/Batch01.tsx': 'a', 'src/VideoComposition.tsx': 'b', 'src/scenes/Locked_Batch01.tsx': 'c' },
        prep,
        { 'src/scenes/Batch01.tsx': '', 'src/VideoComposition.tsx': '', 'src/scenes/Locked_Batch01.tsx': '' },
      )
      assert.deepEqual(Object.keys(filtered.accepted), ['src/scenes/Batch01.tsx'])
      assert.equal(filtered.rejected.length, 2)
      // Only-locked selection is refused without any LLM call
      mockFetch(async (url) => {
        throw new Error(`no LLM call expected: ${url}`)
      })
      const refused = await coder.refineAiScene({ projectDir: dir, sceneId: 'scene-02', instruction: '改颜色', render: false })
      assert.equal(refused.refused, true)
      assert.equal(fetchLog.length, 0)
      const dry = await coder.refineAiScene({ projectDir: dir, timeRange: { startSec: 2, endSec: 7 }, dryRun: true })
      assert.equal(dry.dryRun, true)
      assert.deepEqual(dry.affectedSceneIds, ['scene-01', 'scene-03'])
      assert.equal(fetchLog.length, 0)
    })

    await test('refine run (HTML, mocked LLM): snapshot before, locked block kept, diff returned', async () => {
      const dir = makeProject('refine-html', { durations: [3, 3, 3] })
      // AI-coded HyperFrames page: built-in template + the frame-seek contract the coder must keep
      writeFileSync(
        join(dir, 'index.html'),
        htmlGen
          .buildRichHtmlVideo(readScript(dir))
          .replace(/<\/head>/i, `<script id="dsh-script-data" type="application/json">{}</script>\n<script>window.__totalFrames = ${readScript(dir).totalDurationInFrames};</script>\n</head>`),
      )
      locks.setSceneLock({ projectDir: dir, sceneId: 'scene-01' })
      const original = readFileSync(join(dir, 'index.html'), 'utf8')
      const lockedBlock = refine.extractHtmlSceneBlock(original, 'scene-01')
      assert.ok(lockedBlock)
      const vBefore = history.listProjectVersions(dir).total
      let llmCalls = 0
      mockFetch(async (url, init) => {
        if (!url.startsWith('https://llm.mock.test/')) throw new Error(`unexpected ${url}`)
        llmCalls++
        const req = JSON.parse(init.body)
        const userMsg = req.messages.find((m) => m.role === 'user')?.content || ''
        assert.match(String(userMsg), /scene-02/)
        // The "AI" rewrites the page: it vandalises the locked scene AND edits scene-02
        const html = original
          .replace(lockedBlock, lockedBlock.replace(/<div class="k-scene"/, '<div data-vandal="1" class="k-scene"'))
          .replace(/(data-scene-id="scene-02"[^>]*>)/, '$1<!-- refined-by-ai -->')
        return llmReply(JSON.stringify({ files: { 'index.html': html } }))
      })
      const res = await coder.refineAiScene({
        projectDir: dir,
        instruction: '把第二幕标题改成金色',
        timeRange: { startSec: 3.2, endSec: 5 },
        region: { x: 0.1, y: 0.1, w: 0.4, h: 0.3 },
        llmOverride: MOCK_LLM,
        render: false,
      })
      assert.equal(res.ok, true)
      assert.equal(llmCalls, 1)
      assert.deepEqual(res.targeted.affectedSceneIds, ['scene-02'])
      assert.deepEqual(res.targeted.timeMap.scenes.map((s) => [s.sceneId, s.localStartFrame, s.localEndFrame]), [['scene-02', 6, 60]])
      assert.ok(res.beforeVersionId && res.afterVersionId && res.beforeVersionId !== res.afterVersionId)
      assert.ok(res.diff.changedFiles.some((f) => f.path === 'index.html'))
      const after = readFileSync(join(dir, 'index.html'), 'utf8')
      assert.equal(refine.extractHtmlSceneBlock(after, 'scene-01'), lockedBlock, 'locked HTML block restored verbatim')
      assert.match(refine.extractHtmlSceneBlock(after, 'scene-02'), /refined-by-ai/)
      // pre-refine dedupes onto the lock snapshot (identical state); post-refine is a new version
      const versionIds = history.listProjectVersions(dir).versions.map((v) => v.id)
      assert.equal(history.listProjectVersions(dir).total, vBefore + 1)
      assert.ok(versionIds.includes(res.beforeVersionId) && versionIds.includes(res.afterVersionId))
      // The edit is undoable through the unified history
      const rb = coder.rollbackAiVersion(dir)
      assert.equal(rb.ok, true)
      assert.doesNotMatch(readFileSync(join(dir, 'index.html'), 'utf8'), /refined-by-ai/)
    })

    await test('refine run (Remotion, mocked LLM): only the affected batch file changes, out-of-scope edits dropped', async () => {
      const dir = makeProject('refine-remotion', { engine: 'remotion', durations: [3, 3, 3] })
      const scenesDir = join(dir, 'src', 'scenes')
      mkdirSync(scenesDir, { recursive: true })
      const batch1 = "import React from 'react';\nimport { useCurrentFrame } from 'remotion';\nexport const BATCH_01_SCENES: Record<string, React.FC<any>> = {\n  'scene-01': () => { useCurrentFrame(); return <div>ONE</div> },\n};\n"
      const batch2 = "import React from 'react';\nimport { useCurrentFrame } from 'remotion';\nexport const BATCH_02_SCENES: Record<string, React.FC<any>> = {\n  'scene-02': () => { useCurrentFrame(); return <div>TWO</div> },\n  'scene-03': () => { useCurrentFrame(); return <div>THREE</div> },\n};\n"
      writeFileSync(join(scenesDir, 'Batch01.tsx'), batch1)
      writeFileSync(join(scenesDir, 'Batch02.tsx'), batch2)
      writeFileSync(join(scenesDir, 'index.ts'), "import { BATCH_01_SCENES } from './Batch01';\nimport { BATCH_02_SCENES } from './Batch02';\nexport const CUSTOM_SCENE_MAP: Record<string, any> = { ...BATCH_01_SCENES, ...BATCH_02_SCENES };\n")
      // Composition entry + Root/index exactly as the generator writes them for an AI-coded project
      const remotionGen = await imp('packages/dsh-tool-media/remotion-generator.js')
      const rs = readScript(dir)
      rs.authoringMode = 'ai-coded'
      writeScriptJson(dir, rs)
      remotionGen.writeRemotionProjectFiles(dir, readScript(dir), { rebuildTemplate: true, useCustomSceneRegistry: true })
      const dry = await coder.refineAiScene({ projectDir: dir, timeRange: { startSec: 3.5, endSec: 5.5 }, dryRun: true })
      assert.deepEqual(dry.allowedFiles, ['src/scenes/Batch02.tsx'])
      mockFetch(async (url) => {
        if (!url.startsWith('https://llm.mock.test/')) throw new Error(`unexpected ${url}`)
        return llmReply(
          JSON.stringify({
            files: {
              'src/scenes/Batch02.tsx': batch2.replace('<div>TWO</div>', '<div>TWO-REFINED</div>'),
              'src/scenes/Batch01.tsx': batch1.replace('ONE', 'ONE-HIJACKED'),
            },
          }),
        )
      })
      const res = await coder.refineAiScene({ projectDir: dir, instruction: '第二幕加金色描边', timeRange: { startSec: 3.5, endSec: 5.5 }, llmOverride: MOCK_LLM, render: false })
      assert.equal(res.ok, true, JSON.stringify(res).slice(0, 400))
      assert.deepEqual(res.updatedFiles, ['src/scenes/Batch02.tsx'])
      assert.deepEqual(res.rejectedFiles.map((r) => r.path), ['src/scenes/Batch01.tsx'])
      assert.match(readFileSync(join(scenesDir, 'Batch02.tsx'), 'utf8'), /TWO-REFINED/)
      assert.doesNotMatch(readFileSync(join(scenesDir, 'Batch01.tsx'), 'utf8'), /HIJACKED/)
    })

    // =========================================================================================
    // 8. Voice library: deleting an imported voice never takes other voices with it
    // =========================================================================================
    await test('voices: deleting one voice of an imported pack removes exactly that voice, on the first click (review F2)', async () => {
      const root = join(SCRATCH, 'voice-library')
      const voicesDir = join(root, 'voice-packs')
      const outside = join(root, 'outside')
      mkdirSync(voicesDir, { recursive: true })
      mkdirSync(outside, { recursive: true })
      // Every voice location points into scratch (non-empty values, so loadEnv never fills them from the real .env)
      const VOICE_ENV = {
        VOICE_PACKS_DIR: voicesDir,
        INDEXTTS_ROOT: join(root, 'no-indextts'),
        GPTVOICE_ROOT: join(root, 'no-gptvoice'),
        EXTRA_VOICE_SCAN_DIRS: join(root, 'no-extra-scan-dir'),
        DEFAULT_REF_AUDIO: join(root, 'no-default.wav'),
      }
      const prevEnv = {}
      for (const [k, v] of Object.entries(VOICE_ENV)) {
        prevEnv[k] = process.env[k]
        process.env[k] = v
      }
      try {
        const vm = await imp('packages/dsh-tool-local-tts/voice-manager.js')
        const wav = (seconds = 1, rate = 16000) => {
          const data = Buffer.alloc(seconds * rate * 2)
          for (let i = 0; i < data.length / 2; i++) data.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), i * 2)
          const h = Buffer.alloc(44)
          h.write('RIFF', 0)
          h.writeUInt32LE(36 + data.length, 4)
          h.write('WAVE', 8)
          h.write('fmt ', 12)
          h.writeUInt32LE(16, 16)
          h.writeUInt16LE(1, 20)
          h.writeUInt16LE(1, 22)
          h.writeUInt32LE(rate, 24)
          h.writeUInt32LE(rate * 2, 28)
          h.writeUInt16LE(2, 32)
          h.writeUInt16LE(16, 34)
          h.write('data', 36)
          h.writeUInt32LE(data.length, 40)
          return Buffer.concat([h, data])
        }
        const ids = () => vm.getVoiceCatalog().voices.map((v) => v.id)
        const byId = (id) => vm.getVoiceCatalog().voices.find((v) => v.id === id)
        assert.equal(resolve(vm.getVoicePacksDir()), resolve(voicesDir), 'the voice library must be the scratch folder')

        // (a) zip-style pack: imported/studio-pack/ holds alice (+ .pt / .txt siblings) and bob
        const pack = join(voicesDir, 'imported', 'studio-pack')
        mkdirSync(pack, { recursive: true })
        writeFileSync(join(pack, 'alice.wav'), wav())
        writeFileSync(join(pack, 'alice.pt'), 'tensor')
        writeFileSync(join(pack, 'alice.txt'), 'transcript')
        writeFileSync(join(pack, 'bob.wav'), wav())
        await vm.importVoicePack({ sourcePath: pack })
        assert.ok(ids().includes('pack-studio-pack-alice') && ids().includes('pack-studio-pack-bob'), JSON.stringify(ids()))
        const d1 = vm.deleteImportedVoice('pack-studio-pack-alice')
        assert.equal(d1.ok, true, JSON.stringify(d1))
        for (const f of ['alice.wav', 'alice.pt', 'alice.txt']) assert.ok(!existsSync(join(pack, f)), `${f} must be gone after the FIRST delete`)
        assert.ok(existsSync(join(pack, 'bob.wav')), 'bob.wav (another voice of the pack) was deleted')
        assert.equal(d1.folderRemoved, false)
        assert.ok(!ids().some((id) => /alice/.test(id)), `alice is still listed: ${JSON.stringify(ids())}`)
        assert.equal(byId('pack-studio-pack-bob')?.available, true, 'bob must stay listed and usable')
        const d2 = vm.deleteImportedVoice('pack-studio-pack-alice')
        assert.equal(d2.ok, false, 'a repeated delete finds nothing')
        assert.ok(existsSync(join(pack, 'bob.wav')) && existsSync(pack), 'a repeated delete must never remove the pack')

        // (b) single-file import copied into its own imported/<id>/ folder: the folder goes only when nothing else is left
        const src = join(outside, 'narrator.wav')
        writeFileSync(src, wav())
        await vm.importVoicePack({ sourcePath: src, id: 'my-narrator', copyToVoicePacks: true })
        const own = join(voicesDir, 'imported', 'my-narrator')
        assert.ok(existsSync(join(own, 'narrator.wav')))
        const d3 = vm.deleteImportedVoice('my-narrator')
        assert.ok(d3.ok && d3.folderRemoved === true && !existsSync(own), JSON.stringify(d3))
        assert.ok(existsSync(src), 'the original outside the library must be untouched')
        await vm.importVoicePack({ sourcePath: src, id: 'my-narrator2', copyToVoicePacks: true })
        const own2 = join(voicesDir, 'imported', 'my-narrator2')
        writeFileSync(join(own2, 'README.md'), 'user notes')
        const d4 = vm.deleteImportedVoice('my-narrator2')
        assert.ok(d4.ok && d4.folderRemoved === false, JSON.stringify(d4))
        assert.ok(existsSync(join(own2, 'README.md')) && !existsSync(join(own2, 'narrator.wav')), 'other files in the folder must be kept')

        // (c) manifest pack: deleting one voice drops its file + manifest entry, the other voice stays usable
        const mf = join(voicesDir, 'imported', 'mf-pack')
        mkdirSync(join(mf, 'clips'), { recursive: true })
        writeFileSync(join(mf, 'clips', 'a.wav'), wav())
        writeFileSync(join(mf, 'clips', 'b.wav'), wav())
        writeFileSync(join(mf, 'manifest.json'), JSON.stringify({ packName: 'MF', voices: [{ id: 'mf-a', name: 'A', refAudio: 'clips/a.wav' }, { id: 'mf-b', name: 'B', refAudio: 'clips/b.wav' }] }))
        await vm.importVoicePack({ sourcePath: mf })
        assert.ok(ids().includes('mf-a') && ids().includes('mf-b'), JSON.stringify(ids()))
        const d5 = vm.deleteImportedVoice('mf-a')
        assert.ok(d5.ok && !existsSync(join(mf, 'clips', 'a.wav')) && !ids().includes('mf-a'), JSON.stringify(d5))
        const manifest = JSON.parse(readFileSync(join(mf, 'manifest.json'), 'utf8'))
        assert.deepEqual(manifest.voices.map((v) => v.id), ['mf-b'])
        assert.ok(existsSync(join(mf, 'clips', 'b.wav')) && byId('mf-b')?.available === true)

        // (d) a junction under imported/: the file behind it is never deleted
        const victimDir = join(outside, 'Music')
        mkdirSync(victimDir, { recursive: true })
        writeFileSync(join(victimDir, 'carol.wav'), wav())
        const link = join(voicesDir, 'imported', 'linked')
        symlinkSync(victimDir, link, 'junction')
        try {
          const carol = ids().find((id) => /carol/.test(id))
          if (carol) {
            const d6 = vm.deleteImportedVoice(carol)
            assert.ok(d6.ok === false && d6.refused === true, JSON.stringify(d6))
          }
          assert.ok(existsSync(join(victimDir, 'carol.wav')), 'a file behind a junction was deleted')
        } finally {
          unlinkSync(link) // the junction itself, never its target
        }

        // (e) a voice outside imported/ (built-in / scanned) is refused
        const cat = JSON.parse(readFileSync(join(voicesDir, 'catalog.json'), 'utf8'))
        cat.voices.push({ id: 'builtin-x', name: 'X', refPath: src })
        writeFileSync(join(voicesDir, 'catalog.json'), JSON.stringify(cat))
        assert.throws(() => vm.deleteImportedVoice('builtin-x'), /内置音色不可删除/)
        assert.ok(existsSync(src))
      } finally {
        for (const [k, v] of Object.entries(prevEnv)) {
          if (v === undefined) delete process.env[k]
          else process.env[k] = v
        }
      }
    })
  } finally {
    globalThis.fetch = realFetch
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\nproject-safety core: ${results.length - failed.length}/${results.length} passed`)
  if (failed.length === 0 && !process.env.PROJECT_SAFETY_KEEP) safeRemove(SCRATCH)
  else console.log(`scratch kept for inspection: ${SCRATCH}`)
  return { passed: results.length - failed.length, failed: failed.length, results }
}

// Standalone run: node scripts/tests/project-safety.core.mjs
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = await runCoreTests()
  process.exit(res.failed ? 1 : 0)
}
