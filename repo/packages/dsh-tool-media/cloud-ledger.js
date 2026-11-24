/**
 * @dsh-video/tool-media — Cloud Cost Protection Core
 *
 * 1. Paid-job ledger `<project>/output/cloud-jobs.json`: every paid generation (image / video /
 *    music / cloud TTS) is persisted BEFORE submission with provider, category, a hash of the
 *    normalised request params, status, provider task id and result paths. Retries / restarts with
 *    the same params hash resume polling the recorded task id or reuse the completed result file —
 *    a restart never charges twice.
 * 2. Billing-error classification (HTTP 402, provider balance/quota codes, "insufficient balance",
 *    "余额不足", "quota", "欠费", "credit" ...) → `CloudBillingError` (never retried, stops pipelines).
 * 3. Per-run paid-job budget (`DSH_CLOUD_MAX_PAID_JOBS_PER_RUN`, default 0 = auto paid generation off).
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { loadEnv, REPO_ROOT } from '../shared/index.js'
import { readJsonSafe, toPosixRel, withFileLockSync, writeJsonAtomic } from './safe-json-store.js'

export const CLOUD_LEDGER_FILENAME = 'cloud-jobs.json'
const LEDGER_MAX_JOBS = 400
/** A submission interrupted before the provider returned a task id cannot be proven uncharged. */
export const DEFAULT_RESUBMIT_HOLD_MS = 30 * 60 * 1000

export const LEDGER_STATUS = Object.freeze({
  SUBMITTING: 'submitting',
  SUBMITTED: 'submitted',
  RESULT_READY: 'result_ready',
  COMPLETED: 'completed',
  FAILED: 'failed',
  BILLING_FAILED: 'billing_failed',
  INTERRUPTED: 'interrupted',
})

// ---------------------------------------------------------------------------
// Ledger persistence
// ---------------------------------------------------------------------------

export function resolveLedgerRoot(projectDir = '') {
  return projectDir ? resolve(projectDir) : join(REPO_ROOT, '.tmp', 'cloud-media-sandbox')
}

export function getCloudLedgerPath(projectDir = '') {
  return join(resolveLedgerRoot(projectDir), 'output', CLOUD_LEDGER_FILENAME)
}

function emptyLedger() {
  return { version: 1, updatedAt: '', jobs: [] }
}

export function readCloudLedger(projectDir = '') {
  const data = readJsonSafe(getCloudLedgerPath(projectDir), null)
  if (!data || typeof data !== 'object') return emptyLedger()
  return { ...emptyLedger(), ...data, jobs: Array.isArray(data.jobs) ? data.jobs : [] }
}

function mutateLedger(projectDir, mutator) {
  const p = getCloudLedgerPath(projectDir)
  return withFileLockSync(`${p}.lock`, () => {
    const ledger = readCloudLedger(projectDir)
    const out = mutator(ledger)
    if (ledger.jobs.length > LEDGER_MAX_JOBS) {
      // Never evict unfinished (resumable) jobs — only trim the oldest finished ones
      const finished = new Set([LEDGER_STATUS.COMPLETED, LEDGER_STATUS.FAILED, LEDGER_STATUS.BILLING_FAILED, LEDGER_STATUS.INTERRUPTED])
      let overflow = ledger.jobs.length - LEDGER_MAX_JOBS
      ledger.jobs = ledger.jobs.filter((j) => {
        if (overflow > 0 && finished.has(j.status)) {
          overflow--
          return false
        }
        return true
      })
    }
    ledger.updatedAt = new Date().toISOString()
    writeJsonAtomic(p, ledger)
    return out
  })
}

/** Newest job for a params hash (ties on createdAt resolve to the most recently appended entry). */
function latestJobFor(jobs, paramsHash) {
  let best = null
  for (const j of jobs) {
    if (j?.paramsHash !== paramsHash) continue
    if (!best || String(j.createdAt || '') >= String(best.createdAt || '')) best = j
  }
  return best
}

export function findLatestLedgerJob(projectDir, paramsHash) {
  if (!paramsHash) return null
  return latestJobFor(readCloudLedger(projectDir).jobs, paramsHash)
}

export function getLedgerJob(projectDir, jobId) {
  return readCloudLedger(projectDir).jobs.find((j) => j.id === jobId) || null
}

/**
 * Persist a new paid job (status `submitting`) BEFORE the provider is called.
 * With `expectLatestId` the create is a compare-and-swap inside the ledger lock: when another
 * process/request recorded a newer job for the same params hash after the caller made its
 * decision, nothing is written and `null` is returned — the caller must NOT submit (no double charge).
 * `supersedeId` marks an abandoned `submitting` entry as `interrupted` in the same atomic step.
 */
export function createLedgerJob(projectDir, fields = {}, { expectLatestId, supersedeId = '' } = {}) {
  const nowIso = new Date().toISOString()
  const job = {
    id: `cj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    status: LEDGER_STATUS.SUBMITTING,
    attempts: 1,
    delivered: false,
    resultPaths: [],
    createdAt: nowIso,
    updatedAt: nowIso,
    pid: process.pid,
    ...fields,
  }
  return mutateLedger(projectDir, (ledger) => {
    if (expectLatestId !== undefined && job.paramsHash) {
      const latest = latestJobFor(ledger.jobs, job.paramsHash)
      if ((latest?.id || '') !== String(expectLatestId || '')) return null
    }
    if (supersedeId) {
      const old = ledger.jobs.find((j) => j.id === supersedeId)
      if (old && old.status === LEDGER_STATUS.SUBMITTING) {
        Object.assign(old, { status: LEDGER_STATUS.INTERRUPTED, supersededAt: nowIso, updatedAt: nowIso })
      }
    }
    ledger.jobs.push(job)
    return job
  })
}

/** Best-effort liveness probe for the process that recorded a ledger entry. */
export function isProcessAlive(pid) {
  const n = Number(pid)
  if (!Number.isInteger(n) || n <= 0) return false
  if (n === process.pid) return true
  try {
    process.kill(n, 0)
    return true
  } catch (err) {
    return err?.code === 'EPERM'
  }
}

export function updateLedgerJob(projectDir, jobId, patch = {}) {
  return mutateLedger(projectDir, (ledger) => {
    const job = ledger.jobs.find((j) => j.id === jobId)
    if (!job) return null
    Object.assign(job, patch, { updatedAt: new Date().toISOString() })
    return { ...job }
  })
}

export function listCloudJobs(projectDir = '', { status = '', limit = 100 } = {}) {
  const ledger = readCloudLedger(projectDir)
  const jobs = ledger.jobs
    .filter((j) => !status || j.status === status)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  const counts = {}
  for (const j of ledger.jobs) counts[j.status] = (counts[j.status] || 0) + 1
  return {
    ok: true,
    ledgerPath: getCloudLedgerPath(projectDir),
    total: ledger.jobs.length,
    counts,
    resumable: ledger.jobs.filter((j) => j.status === LEDGER_STATUS.SUBMITTED || j.status === LEDGER_STATUS.RESULT_READY).length,
    jobs: jobs.slice(0, Math.max(1, Number(limit) || 100)),
  }
}

// ---------------------------------------------------------------------------
// Request params hashing (provider + normalised request; never includes the API key)
// ---------------------------------------------------------------------------

function normText(v) {
  return String(v ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t　]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normUrl(v) {
  return String(v || '').trim().replace(/\/+$/, '').toLowerCase()
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value)
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

export function hashText(text = '', len = 64) {
  return createHash('sha256').update(String(text)).digest('hex').slice(0, len)
}

// Request fields that change what a provider generates (and charges for), per category. Fields a category's
// adapters never send (e.g. an image's durationSec) are left out so they cannot defeat reuse / resume.
// Custom HTTP templates may reference any variable, so the custom protocol always hashes every field.
const PAID_FIELDS_BY_CATEGORY = {
  image: new Set(['aspectRatio']),
  video: new Set(['aspectRatio', 'durationSec', 'imageUrl']),
  audio: new Set(['lyrics', 'tags', 'title', 'instrumental', 'durationSec']),
}

/**
 * Build the normalised request descriptor + its sha256 hash. Output-location options
 * (stageOnly, sceneId, autoBind) are deliberately excluded: they do not change what is paid for.
 */
export function computeCloudParamsHash(params = {}) {
  const custom = params.custom && typeof params.custom === 'object' ? params.custom : null
  const category = String(params.category || '')
  const protocol = String(params.protocol || '')
  const fields = PAID_FIELDS_BY_CATEGORY[category]
  const uses = (field) => protocol === 'custom' || !fields || fields.has(field)
  const descriptor = {
    v: 2,
    provider: String(params.providerId || ''),
    protocol,
    category,
    model: normText(params.model),
    endpoint: `${normUrl(params.baseUrl)}|${normUrl(params.endpoint)}`,
    prompt: normText(params.prompt),
    lyrics: uses('lyrics') ? normText(params.lyrics) : '',
    tags: uses('tags') ? normText(params.tags) : '',
    title: uses('title') ? normText(params.title) : '',
    durationSec: uses('durationSec') ? Math.round((Number(params.durationSec) || 0) * 10) / 10 : 0,
    aspectRatio: uses('aspectRatio') ? String(params.aspectRatio || '') : '',
    imageUrl: uses('imageUrl') ? String(params.imageUrl || '').trim() : '',
    instrumental: uses('instrumental') ? Boolean(params.instrumental) : false,
    references: Array.isArray(params.referenceSignatures) ? [...params.referenceSignatures].sort() : [],
    custom: custom
      ? hashText(`${normUrl(custom.submitUrl)}|${String(custom.bodyTemplateJson || '')}|${custom.mode || ''}|${normUrl(custom.pollUrlTemplate)}`, 24)
      : '',
    extra: params.extraParams && typeof params.extraParams === 'object' ? params.extraParams : {},
  }
  return { paramsHash: hashText(stableStringify(descriptor), 40), descriptor }
}

// ---------------------------------------------------------------------------
// Ledger decision (reuse / resume / new / blocked)
// ---------------------------------------------------------------------------

/**
 * Decide what to do for a request whose params hash already has a ledger entry.
 * @returns {{ action: 'new'|'reuse'|'resume'|'blocked', job?: object, reason: string }}
 */
export function decideLedgerAction(job, {
  stageOnly = false,
  forceNew = false,
  resultExists = false,
  nowMs = Date.now(),
  resubmitHoldMs = DEFAULT_RESUBMIT_HOLD_MS,
  ownerAlive = false,
} = {}) {
  if (!job) return { action: 'new', reason: 'no-ledger-entry' }
  if (forceNew) return { action: 'new', job, reason: 'force-new' }
  const st = job.status
  if (st === LEDGER_STATUS.COMPLETED) {
    if (!resultExists) return { action: 'new', job, reason: 'completed-result-missing' }
    // Manual staging preview: a result the user has already been shown means "regenerate" → new job
    if (stageOnly && job.delivered) return { action: 'new', job, reason: 'staging-regenerate' }
    return { action: 'reuse', job, reason: job.delivered ? 'completed-reuse' : 'completed-orphan-recovery' }
  }
  if (st === LEDGER_STATUS.SUBMITTED || st === LEDGER_STATUS.RESULT_READY) {
    if (job.taskId || job.resultUrl) return { action: 'resume', job, reason: 'resume-existing-task' }
    return { action: 'new', job, reason: 'submitted-without-task-id' }
  }
  if (st === LEDGER_STATUS.SUBMITTING || st === LEDGER_STATUS.INTERRUPTED) {
    const ageMs = Math.max(0, nowMs - Date.parse(job.updatedAt || job.createdAt || 0))
    if (ageMs < resubmitHoldMs) {
      return {
        action: 'blocked',
        job,
        // A `submitting` entry whose owner process is still alive is a live submission (another request /
        // process), otherwise the submission was interrupted and may already have been charged.
        reason: st === LEDGER_STATUS.SUBMITTING && ownerAlive ? 'submission-in-flight' : 'interrupted-submit-hold',
        holdRemainingMs: resubmitHoldMs - ageMs,
      }
    }
    return { action: 'new', job, reason: 'interrupted-hold-expired' }
  }
  return { action: 'new', job, reason: `previous-${st || 'unknown'}` }
}

/** A completed job is reusable while at least one copy of its (already paid) result file survives. */
export function ledgerResultExists(rootDir, job) {
  const paths = Array.isArray(job?.resultPaths) ? job.resultPaths : []
  return paths.some((rel) => rel && existsSync(join(rootDir, rel)))
}

export function relToLedgerRoot(rootDir, absPath) {
  const a = resolve(absPath)
  const rel = relative(resolve(rootDir), a)
  return toPosixRel(rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : a)
}

// ---------------------------------------------------------------------------
// Billing-error classification
// ---------------------------------------------------------------------------

const DEFINITE_BILLING_CODES = new Set([
  'insufficient_quota',
  'insufficient_balance',
  'insufficient_credits',
  'billing_hard_limit_reached',
  'billing_not_active',
  'accountoverdueerror',
  'account_overdue',
  'arrearage',
  'payment_required',
  'quota_exhausted',
  'exceeded_current_quota_error',
])
// Provider numeric codes that unambiguously mean "no balance": MiniMax 1008, Kling 1101/1102
const DEFINITE_BILLING_NUMERIC = new Set(['1008', '1101', '1102'])

const DEFINITE_BILLING_RE =
  /insufficient[\s_-]*(?:account[\s_-]*)?(?:balance|quota|credits?|funds)|balance[\s_-]*(?:is[\s_-]*)?(?:insufficient|not[\s_-]*enough|too[\s_-]*low|exhausted)|exhausted[\s_-]*(?:account[\s_-]*)?(?:balance|credits?)|(?:balance|credits?)[\s_-]*(?:has[\s_-]*been[\s_-]*|have[\s_-]*been[\s_-]*|is[\s_-]*|are[\s_-]*)?(?:depleted|used[\s_-]*up)|not[\s_-]*enough[\s_-]*(?:balance|credits?|quota)|out[\s_-]*of[\s_-]*(?:credits?|quota)|credit[\s_-]*balance|no[\s_-]*(?:remaining[\s_-]*)?credits?\b|exceeded[\s_-]*(?:your|the)?[\s_-]*current[\s_-]*quota|quota[\s_-]*(?:has[\s_-]*been[\s_-]*|is[\s_-]*)?(?:exhausted|used[\s_-]*up|depleted)|payment[\s_-]*required|overdue|arrear|account[\s_-]*(?:has[\s_-]*been[\s_-]*|is[\s_-]*)?suspended|余额不足|余额已用|余额为\s*0(?![.\d])|欠费|已停机|额度不足|额度已用|额度用尽|额度耗尽|配额不足|配额已用|配额用尽|(?:超出|超过)(?:免费|账户|账号)?(?:额度|配额)|点数不足|积分不足|资源包(?:已)?(?:用完|耗尽|不足|到期)|套餐(?:余量)?不足|请(?:先)?充值|需要充值/i
// Weak signals ("quota" / "credit" / "billing") count as billing only when no rate-limit wording is present
// and the provider did not answer HTTP 429 (429 "quota" replies such as Gemini RESOURCE_EXHAUSTED are rate
// limits; real balance failures behind a 429 carry a definite phrase/code like OpenAI `insufficient_quota`).
// Chinese hints such as "请检查...额度限制" are intentionally NOT weak signals (they are generic advice text).
const WEAK_BILLING_RE = /quota|credit|billing/i
const RATE_LIMIT_RE =
  /rate[\s_-]*limit|ratelimit|too[\s_-]*many[\s_-]*requests|per[\s_-]*(?:minute|second|min\b|sec\b)|\brpm\b|\btpm\b|\bqps\b|try[\s_-]*again[\s_-]*in|retry[\s_-]*(?:after|in)|please[\s_-]*retry|请求过于频繁|请求频率|频率超限|限流|并发(?:数|上限|超限)/i
const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524])
const NETWORK_RE = /fetch failed|network|econnreset|econnrefused|etimedout|socket|other side closed|terminated|超时|timed?\s*out|und_err/i

function extractStatusFromMessage(msg = '') {
  const m = String(msg).match(/(?:HTTP\s*|\(|（)\s*([1-5]\d\d)\b/)
  return m ? Number(m[1]) : 0
}

/**
 * Classify any cloud / LLM / TTS provider error.
 * @returns {{ kind: 'billing'|'transient'|'fatal'|'abort'|'unknown', status: number, providerCode: string, reason: string }}
 */
export function classifyCloudError(err) {
  if (!err) return { kind: 'unknown', status: 0, providerCode: '', reason: 'empty' }
  if (err.name === 'AbortError') return { kind: 'abort', status: 0, providerCode: '', reason: 'aborted' }
  if (err.errorKind === 'billing' || err.billing === true || err.code === 'CLOUD_BILLING') {
    return { kind: 'billing', status: Number(err.status) || 0, providerCode: String(err.providerCode || ''), reason: 'tagged-billing' }
  }
  const message = String(err.message || err || '')
  const status = Number(err.status || err.httpStatus || err.cause?.status || 0) || extractStatusFromMessage(message)
  const providerCode = String(err.providerCode ?? err.cause?.providerCode ?? '').trim()
  const text = `${message} ${providerCode} ${String(err.body || err.responseText || '').slice(0, 600)}`
  if (status === 402) return { kind: 'billing', status, providerCode, reason: 'http-402' }
  const lowerCode = providerCode.toLowerCase()
  if (DEFINITE_BILLING_CODES.has(lowerCode) || DEFINITE_BILLING_NUMERIC.has(providerCode)) {
    return { kind: 'billing', status, providerCode, reason: `provider-code-${providerCode}` }
  }
  if (DEFINITE_BILLING_RE.test(text)) return { kind: 'billing', status, providerCode, reason: 'billing-message' }
  const rateLimited = RATE_LIMIT_RE.test(text)
  if (WEAK_BILLING_RE.test(text) && !rateLimited && status !== 429) return { kind: 'billing', status, providerCode, reason: 'quota-or-credit-message' }
  if (TRANSIENT_STATUS.has(status) || rateLimited || NETWORK_RE.test(text) || /ECONN|ETIMEDOUT|UND_ERR/i.test(String(err.code || err.cause?.code || ''))) {
    return { kind: 'transient', status, providerCode, reason: rateLimited ? 'rate-limit' : 'transient-network-or-5xx' }
  }
  return { kind: 'fatal', status, providerCode, reason: 'non-retryable' }
}

export function isBillingError(err) {
  return classifyCloudError(err).kind === 'billing'
}

export class CloudBillingError extends Error {
  constructor(message, info = {}) {
    super(message)
    this.name = 'CloudBillingError'
    this.code = 'CLOUD_BILLING'
    this.errorKind = 'billing'
    this.billing = true
    this.noRetry = true
    this.scope = info.scope || 'cloud'
    this.provider = info.provider || ''
    this.category = info.category || ''
    this.status = Number(info.status) || 0
    this.providerCode = String(info.providerCode || '')
    this.detail = String(info.detail || '')
    this.ledgerJobId = info.ledgerJobId || ''
  }
}

const SCOPE_LABEL = { cloud: '云端付费生成服务', llm: '大模型服务', tts: '云端配音服务', stock: '免费素材服务' }

/**
 * Wrap any billing-classified error into a `CloudBillingError` carrying a clear Chinese stop message.
 */
export function toBillingError(err, { provider = '', category = '', scope = 'cloud', ledgerJobId = '' } = {}) {
  if (err instanceof CloudBillingError) return err
  const cls = classifyCloudError(err)
  const detail = String(err?.message || err || '').replace(/\s+/g, ' ').slice(0, 240)
  const label = SCOPE_LABEL[scope] || SCOPE_LABEL.cloud
  const statusTxt = cls.status ? `（HTTP ${cls.status}${cls.providerCode ? ` · ${cls.providerCode}` : ''}）` : cls.providerCode ? `（${cls.providerCode}）` : ''
  const message = `【计费异常·已立即停止】${label}${provider ? `「${provider}」` : ''}返回余额/额度不足${statusTxt}：${detail}。为避免重复扣费，本次运行已终止且不会自动重试；请充值或更换 API Key 后再手动重试。`
  return new CloudBillingError(message, { scope, provider, category, status: cls.status, providerCode: cls.providerCode, detail, ledgerJobId })
}

/**
 * Helpers with graceful fallbacks sometimes keep only the error text (e.g. `{ fallback: true, reason }`); recover a
 * billing stop from it so a pipeline halts instead of calling a provider that has no balance again.
 * @returns {CloudBillingError|null}
 */
export function billingErrorFromText(text, info = {}) {
  const t = String(text || '').trim()
  if (!t) return null
  const probe = new Error(t)
  return isBillingError(probe) ? toBillingError(probe, info) : null
}

/**
 * Billing tripwire for injected LLM / provider call functions whose callers degrade gracefully on
 * errors (e.g. tiered director fallbacks). The first billing-classified failure trips the sentinel;
 * every later call through `wrap()` fails immediately WITHOUT touching the network (never retried),
 * and `throwIfTripped()` lets the orchestrator stop the run at the next checkpoint.
 */
export function createBillingSentinel({ scope = 'llm', provider = '' } = {}) {
  let tripped = null
  return {
    get tripped() {
      return tripped
    },
    wrap(fn) {
      return async (...args) => {
        if (tripped) throw tripped
        try {
          return await fn(...args)
        } catch (err) {
          if (!tripped && err?.name !== 'AbortError' && isBillingError(err)) {
            tripped = toBillingError(err, { scope: err?.scope || scope, provider: err?.provider || provider })
          }
          throw tripped || err
        }
      }
    },
    throwIfTripped() {
      if (tripped) throw tripped
    },
  }
}

// ---------------------------------------------------------------------------
// Per-run paid-job budget
// ---------------------------------------------------------------------------

export function resolveMaxPaidJobsPerRun(override) {
  if (override !== undefined && override !== null && override !== '' && Number.isFinite(Number(override))) {
    return Math.max(0, Math.floor(Number(override)))
  }
  loadEnv()
  const raw = String(process.env.DSH_CLOUD_MAX_PAID_JOBS_PER_RUN ?? '').trim()
  const n = Number(raw)
  return raw && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
}

export class CloudBudgetExceededError extends Error {
  constructor(message, info = {}) {
    super(message)
    this.name = 'CloudBudgetExceededError'
    this.code = 'CLOUD_BUDGET_EXCEEDED'
    this.max = info.max || 0
    this.used = info.used || 0
  }
}

/**
 * Create an in-memory paid-job budget for one pipeline run. Only NEW paid submissions consume
 * budget; ledger reuse / resume never does (no new charge).
 */
export function createPaidJobBudget({ runId = '', max } = {}) {
  const limit = resolveMaxPaidJobsPerRun(max)
  const consumed = []
  return {
    runId,
    max: limit,
    get used() {
      return consumed.length
    },
    remaining() {
      return Math.max(0, limit - consumed.length)
    },
    canSpend() {
      return consumed.length < limit
    },
    consume(ref = {}) {
      if (consumed.length >= limit) {
        throw new CloudBudgetExceededError(
          limit <= 0
            ? '自动付费生成未开启（DSH_CLOUD_MAX_PAID_JOBS_PER_RUN=0）：已跳过云端付费素材生成，不会产生费用。'
            : `本次运行的云端付费任务已达上限 ${limit} 个（DSH_CLOUD_MAX_PAID_JOBS_PER_RUN），已停止继续提交付费任务。`,
          { max: limit, used: consumed.length },
        )
      }
      consumed.push({ ...ref, at: new Date().toISOString() })
      return consumed.length
    },
    /** Give back a slot consumed for a submission that was never sent (e.g. a concurrent duplicate). */
    release(ref = {}) {
      for (let i = consumed.length - 1; i >= 0; i--) {
        if (!ref.paramsHash || consumed[i].paramsHash === ref.paramsHash) {
          consumed.splice(i, 1)
          return true
        }
      }
      return false
    },
    summary() {
      return { runId, max: limit, used: consumed.length, remaining: Math.max(0, limit - consumed.length), jobs: consumed.slice() }
    },
  }
}
