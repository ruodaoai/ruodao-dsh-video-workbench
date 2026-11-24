/**
 * 影核广场 community REST routes (投稿 / 我的投稿 / 在线模板库同步):
 *   GET  /api/video-workbench/plaza/submissions          → local submission packages + online catalogue status
 *        ?id=<id>                                       → one package: files, shared texts, GitHub / e-mail links
 *        ?id=<id>&file=preview.mp4|cover.jpg            → the package's sample clip / cover (HTTP Range)
 *   POST /api/video-workbench/plaza/submit               { action, projectDir, title, category, description, tags,
 *                                                          author, contact, consent, allowNames, previewStartSec }
 *        action 'preview' (default 'build' when consent is given): what will be shared (texts, sizes, privacy cleanups)
 *        action 'build'  → background job (poll GET jobs?id=) → the package incl. channel links
 *        action 'mark'   { id, submitted, channel } → the manual 「已投稿」 mark
 *   POST /api/video-workbench/plaza/submissions/delete   { id }
 *   POST /api/video-workbench/plaza/remote-sync          → background job: refresh the online (maintainer-accepted) catalogue
 *   POST /api/video-workbench/plaza/reveal               { id } → show the package in Explorer / Finder (elsewhere: path only)
 * Nothing here uploads anything: the user sends the package himself through the links (opened by the panel).
 * The existing plaza routes (plaza/templates, plaza/template, plaza/apply, plaza/publish) stay in index.js.
 * Registered in index.js; the panel kit may call these paths (client.js KIT_API_GET / KIT_API_POST).
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import {
  buildPlazaSubmission,
  deletePlazaSubmission,
  getOnlinePlazaStatus,
  getPlazaSubmission,
  listPlazaSubmissions,
  markPlazaSubmission,
  previewPlazaSubmission,
  resolvePlazaSubmissionFile,
  revealPlazaSubmission,
  syncOnlinePlazaTemplates,
} from '../../dsh-tool-media/plaza-community.js'

export const PLAZA_COMMUNITY_ROUTES = Object.freeze([
  { path: '/api/video-workbench/plaza/submissions', methods: ['GET'] },
  { path: '/api/video-workbench/plaza/submit', methods: ['POST'] },
  { path: '/api/video-workbench/plaza/submissions/delete', methods: ['POST'] },
  { path: '/api/video-workbench/plaza/remote-sync', methods: ['POST'] },
  { path: '/api/video-workbench/plaza/reveal', methods: ['POST'] },
])

const PLAZA_PATHS = new Set(PLAZA_COMMUNITY_ROUTES.map((r) => r.path))

export function isPlazaCommunityRoute(pathname) {
  return PLAZA_PATHS.has(pathname)
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

async function readBody(req) {
  try {
    const b = await req.json()
    return b && typeof b === 'object' && !Array.isArray(b) ? b : {}
  } catch {
    return {}
  }
}

function errorResponse(err) {
  const status = Number(err?.status)
  const code = err?.code ? { code: err.code } : {}
  const findings = Array.isArray(err?.findings) ? { findings: err.findings.slice(0, 40) } : {}
  if (err?.expose === true && Number.isInteger(status) && status >= 400 && status < 600) {
    return json({ ok: false, error: err.message, ...code, ...findings }, status)
  }
  return json({ ok: false, error: err?.message || String(err), ...code, ...findings }, 500)
}

/** A file with HTTP Range support (the panel's sample player seeks). */
function serveFile(req, file, type) {
  const size = statSync(file).size
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }
  const range = String(req.headers.get('range') || '')
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    let end = m[1] && m[2] ? Number(m[2]) : size - 1
    if (!m[1]) end = size - 1
    end = Math.min(end, size - 1)
    if (!(start <= end) || start >= size) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
    }
    const stream = Readable.toWeb(createReadStream(file, { start, end }))
    return new Response(stream, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } })
  }
  return new Response(Readable.toWeb(createReadStream(file)), { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
}

const submitInput = (body) => ({
  projectDir: body.projectDir,
  title: body.title,
  category: body.category,
  description: body.description,
  tags: body.tags,
  author: body.author,
  contact: body.contact,
  consent: body.consent === true,
  allowNames: body.allowNames === true,
  previewStartSec: body.previewStartSec,
})

/** Returns a Response for the plaza community routes, or null when the path is not one of them. */
export async function handlePlazaCommunityApiRequest(req, url = new URL(req.url, 'http://localhost'), opts = {}) {
  const pathname = url.pathname
  if (!isPlazaCommunityRoute(pathname)) return null
  const createJob = typeof opts.createBackgroundJob === 'function' ? opts.createBackgroundJob : null
  try {
    if (pathname === '/api/video-workbench/plaza/submissions') {
      if (req.method !== 'GET') return json({ ok: false, error: '仅支持 GET' }, 405)
      const id = String(url.searchParams.get('id') || '').trim()
      const file = String(url.searchParams.get('file') || '').trim()
      if (id && file) {
        const hit = resolvePlazaSubmissionFile(id, file)
        if (!existsSync(hit.file)) return new Response('Not Found', { status: 404 })
        return serveFile(req, hit.file, hit.type)
      }
      if (id) return json(getPlazaSubmission(id))
      return json({ ...listPlazaSubmissions(), online: getOnlinePlazaStatus() })
    }

    if (req.method !== 'POST') return json({ ok: false, error: '仅支持 POST' }, 405)
    const body = await readBody(req)

    if (pathname === '/api/video-workbench/plaza/submit') {
      const action = String(body.action || 'preview')
      if (action === 'mark') return json(markPlazaSubmission(body.id, { submitted: body.submitted !== false, channel: body.channel }))
      if (action === 'preview') return json(await previewPlazaSubmission(submitInput(body)))
      if (action !== 'build') return json({ ok: false, error: `未知操作：${action.slice(0, 40)}` }, 400)
      const input = submitInput(body)
      if (createJob && body.async !== false) {
        // validate the cheap things right away, so a missing consent / film is an immediate, clear error
        if (!input.consent) return json({ ok: false, error: '请先勾选授权声明（授权作者展示、整理和分发；内容不侵犯他人版权与隐私）', code: 'need-consent' }, 400)
        const pre = await previewPlazaSubmission(input)
        const firstProblem = [...(pre.formErrors || []), ...(pre.blocking || [])][0]
        if (firstProblem) return json({ ok: false, error: firstProblem, code: 'not-ready' }, 400)
        if (pre.privacy && pre.privacy.needsNameConfirm) {
          return json({ ok: false, error: '内容里出现了你的电脑用户名 / 计算机名：确认可以公开请勾选「这些词可以公开」，否则请先在工程里改掉', code: 'need-name-confirm', names: pre.privacy.names }, 400)
        }
        const job = createJob('正在生成投稿包…', (onProgress) => buildPlazaSubmission(input, onProgress), { doneMessage: () => '投稿包已生成' })
        return json({ ok: true, async: true, jobId: job.id })
      }
      return json(await buildPlazaSubmission(input))
    }

    if (pathname === '/api/video-workbench/plaza/submissions/delete') {
      return json(deletePlazaSubmission(body.id))
    }

    if (pathname === '/api/video-workbench/plaza/remote-sync') {
      if (createJob && body.async !== false) {
        const job = createJob('正在刷新在线模板…', (onProgress) => syncOnlinePlazaTemplates({ onProgress }), { doneMessage: (r) => (r && r.message) || '在线模板已刷新' })
        return json({ ok: true, async: true, jobId: job.id })
      }
      return json(await syncOnlinePlazaTemplates())
    }

    if (pathname === '/api/video-workbench/plaza/reveal') {
      return json(revealPlazaSubmission(body.id))
    }
    return null
  } catch (err) {
    return errorResponse(err)
  }
}
