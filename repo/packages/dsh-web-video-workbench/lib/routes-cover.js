/**
 * Publish-pack cover REST routes (发布包封面：默认 / 选用视频画面 / AI 重新生成):
 *   GET  /api/video-workbench/publish-pack/cover   ?projectDir=…&platform=…  → current cover, automatic candidates (computed
 *        in the background on first use: auto.status 'pending' → poll again), picked frames, AI covers, titled covers,
 *        which cover each platform's last pack used, scene thumbnails, image-provider / LLM readiness, running AI job.
 *        ?font=sans|serif → the bundled OFL font (woff2) for the Studio's title overlay canvas (same-origin FontFace).
 *   POST /api/video-workbench/publish-pack/cover   { projectDir, action, … }
 *        action 'auto'         默认：use the best automatic frame                          → state
 *        action 'refresh-auto' recompute the automatic candidates                           → state
 *        action 'frame'        { timeSec } 用当前画面做封面 (frame-accurate)                 → state + picked
 *        action 'select'       { file } make a candidate / picked frame / AI / titled cover the cover → state
 *        action 'delete'       { file } delete a picked frame / AI cover / titled cover     → state
 *        action 'ai-prompt'    { timeSec?, aspect?, platform?, draft? } AI 写提示词 (one LLM call) → { prompt, … }
 *        action 'ai-generate'  { prompt, aspect, useReference?, referenceFile?, forceNew? } → { jobId } background job
 *                              (GET jobs?id=), one at a time per project; result { item, reused }
 *        action 'title'        { dataUrl (PNG), baseFile?, text, position, style } save a titled cover + select it → state
 *        action 'stock-test'   { provider: 'pexels'|'pixabay', apiKey? } 免费素材库「测试连接」(one cheap request; the
 *                              typed key or the saved / .env key; never echoed)
 * Every file written stays inside <project>/output/covers/. Registered in index.js; allow-listed for the panel kit
 * (client.js KIT_API_GET / KIT_API_POST).
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COVER_ASPECTS,
  deleteCoverFile,
  describeImageProvider,
  ensureAutoCandidates,
  generateAiCover,
  getCoverState,
  saveTitledCover,
  selectCoverFile,
  useAutoCover,
  useFrameCover,
  writeAiCoverPrompt,
} from '../../dsh-tool-media/cover-studio.js'
import { testStockMediaKey } from '../../dsh-tool-media/stock-media.js'

export const COVER_ROUTES = Object.freeze([{ path: '/api/video-workbench/publish-pack/cover', methods: ['GET', 'POST'] }])

const COVER_PATHS = new Set(COVER_ROUTES.map((r) => r.path))

export function isCoverRoute(pathname) {
  return COVER_PATHS.has(pathname)
}

const FONT_FILES = Object.freeze({
  sans: fileURLToPath(new URL('../../shared/fonts/NotoSansSC-VF.woff2', import.meta.url)),
  serif: fileURLToPath(new URL('../../shared/fonts/SourceHanSerifSC-Heavy.woff2', import.meta.url)),
})

class CoverRouteError extends Error {
  constructor(message, status = 400, code = '') {
    super(message)
    this.status = status
    this.expose = true
    if (code) this.code = code
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
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

/** Same rules as routes-project.js: an absolute path to an existing project folder (with script.json). */
function resolveProjectDir(raw) {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) throw new CoverRouteError('缺少 projectDir（视频工程目录）')
  if (s.length > 1024 || s.includes('\0')) throw new CoverRouteError('projectDir 无效')
  if (!isAbsolute(s)) throw new CoverRouteError('projectDir 必须是绝对路径')
  const abs = resolve(s)
  let st = null
  try {
    st = statSync(abs)
  } catch {}
  if (!st?.isDirectory()) throw new CoverRouteError(`视频工程目录不存在: ${abs}`, 404)
  if (!existsSync(resolve(abs, 'script.json'))) throw new CoverRouteError(`该目录不是视频工程（缺少 script.json）: ${abs}`, 404)
  return abs
}

const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const PLATFORM_RE = /^[a-z0-9_-]{1,32}$/i
const platformOf = (v) => (typeof v === 'string' && PLATFORM_RE.test(v.trim()) ? v.trim() : '')

function errorStatus(err) {
  const status = Number(err?.status)
  return err?.expose === true && Number.isInteger(status) && status >= 400 && status < 500 ? status : 500
}

/* ------------------------------------------------------------------- one AI cover job per project (no double charge) */
const AI_JOBS = new Map() // project dir (lower-case) → { jobId, startedAt, aspect, promptPreview }
const jobKey = (dir) => dir.toLowerCase()

function aiJobFor(dir) {
  const j = AI_JOBS.get(jobKey(dir))
  return j ? { ...j } : null
}

async function stateFor(projectDir, platform, extra = {}) {
  const state = await getCoverState(projectDir, { platform })
  return { ...state, aiJob: aiJobFor(projectDir), ...extra }
}

function serveFont(which) {
  const file = FONT_FILES[which]
  if (!file || !existsSync(file)) return json({ ok: false, error: '字体文件不存在' }, 404)
  return new Response(readFileSync(file), {
    status: 200,
    headers: { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=86400' },
  })
}

/**
 * Returns a Response for the cover routes, or null when the path is not one of them.
 * @param {{ createBackgroundJob?: (message: string, runner: (onProgress: Function) => Promise<any>, opts?: object) => { id: string } }} [opts]
 */
export async function handleCoverApiRequest(req, url = new URL(req.url, 'http://localhost'), opts = {}) {
  if (!isCoverRoute(url.pathname)) return null
  try {
    if (req.method === 'GET') {
      const font = url.searchParams.get('font')
      if (font) return serveFont(font)
      const projectDir = resolveProjectDir(url.searchParams.get('projectDir'))
      return json(await stateFor(projectDir, platformOf(url.searchParams.get('platform'))))
    }
    if (req.method !== 'POST') return json({ ok: false, error: `不支持的请求方法 ${req.method}` }, 405)
    const body = await readBody(req)
    const action = str(body.action, 32)

    // 免费素材库「测试连接」 — no project needed
    if (action === 'stock-test') {
      const provider = body.provider === 'pixabay' ? 'pixabay' : 'pexels'
      const res = await testStockMediaKey({ provider, apiKey: typeof body.apiKey === 'string' ? body.apiKey : '' })
      return json(res, 200)
    }

    const projectDir = resolveProjectDir(body.projectDir)
    const platform = platformOf(body.platform)
    switch (action) {
      case 'auto':
        useAutoCover(projectDir)
        return json(await stateFor(projectDir, platform, { message: '已恢复默认：发布包会自动挑选成片里最好的一帧做封面' }))
      case 'refresh-auto':
        await ensureAutoCandidates(projectDir, { force: true })
        return json(await stateFor(projectDir, platform, { message: '已重新挑选候选画面' }))
      case 'frame': {
        if (body.timeSec === undefined || body.timeSec === null || body.timeSec === '') throw new CoverRouteError('请指定要截取的时间点 timeSec（秒）')
        const { picked } = await useFrameCover(projectDir, { timeSec: Number(body.timeSec) })
        return json(await stateFor(projectDir, platform, { picked: { file: picked.file, timeSec: picked.timeSec, frame: picked.frame }, message: `已把第 ${picked.timeSec.toFixed(2)} 秒（第 ${picked.frame + 1} 帧）的画面设为封面` }))
      }
      case 'select': {
        const file = str(body.file, 300)
        if (!file) throw new CoverRouteError('请指定要设为封面的图片 file')
        await selectCoverFile(projectDir, { file })
        return json(await stateFor(projectDir, platform, { message: '已设为发布包封面' }))
      }
      case 'delete': {
        const file = str(body.file, 300)
        if (!file) throw new CoverRouteError('请指定要删除的图片 file')
        deleteCoverFile(projectDir, { file })
        return json(await stateFor(projectDir, platform, { message: '已删除' }))
      }
      case 'ai-prompt': {
        const res = await writeAiCoverPrompt(projectDir, {
          timeSec: body.timeSec,
          aspect: str(body.aspect, 8),
          platform,
          draft: str(body.draft, 2000),
        })
        return json(res)
      }
      case 'ai-generate': {
        const running = aiJobFor(projectDir)
        if (running) {
          return json({ ok: false, error: '这个工程已经有一张封面正在生成，请等它完成后再生成下一张（不会重复扣费）', code: 'cover-job-running', jobId: running.jobId }, 409)
        }
        const args = {
          prompt: str(body.prompt, 4000),
          aspect: str(body.aspect, 8),
          useReference: body.useReference === true,
          referenceFile: str(body.referenceFile, 300),
          forceNew: body.forceNew === true,
        }
        if (!args.prompt) throw new CoverRouteError('请先填写封面描述（提示词），或点「AI 写提示词」自动生成')
        if (!COVER_ASPECTS.includes(args.aspect)) throw new CoverRouteError(`封面比例只能是 ${COVER_ASPECTS.join(' / ')}`)
        if (!describeImageProvider().configured) {
          throw new CoverRouteError('还没有配置云端生图服务：请先在「设置 · 模型与密钥 → 云端生成 → 云端生图」选择服务商并填写 API Key', 400, 'no-image-provider')
        }
        if (typeof opts.createBackgroundJob !== 'function') {
          const res = await generateAiCover(projectDir, args)
          return json({ ...res, async: false })
        }
        const key = jobKey(projectDir)
        const entry = { jobId: '', startedAt: new Date().toISOString(), aspect: args.aspect, promptPreview: args.prompt.slice(0, 80) }
        AI_JOBS.set(key, entry)
        let job
        try {
          job = opts.createBackgroundJob(
            `🎨 正在生成 ${args.aspect || ''} AI 封面…`,
            async (onProgress) => {
              try {
                return await generateAiCover(projectDir, { ...args, onProgress })
              } finally {
                if (AI_JOBS.get(key) === entry) AI_JOBS.delete(key)
              }
            },
            { doneMessage: (res) => (res?.reused ? '参数和上次相同，已直接复用上次生成的封面（没有重复扣费）' : 'AI 封面已生成：在下方结果里点「设为封面」即可使用') },
          )
        } catch (err) {
          AI_JOBS.delete(key)
          throw err
        }
        entry.jobId = job.id
        return json({ ok: true, async: true, jobId: job.id, aiJob: { ...entry } })
      }
      case 'title': {
        saveTitledCover(projectDir, {
          dataUrl: typeof body.dataUrl === 'string' ? body.dataUrl : '',
          baseFile: str(body.baseFile, 300),
          text: str(body.text, 200),
          position: str(body.position, 12),
          style: str(body.style, 24),
        })
        return json(await stateFor(projectDir, platform, { message: '已生成带标题的封面，并设为发布包封面' }))
      }
      default:
        throw new CoverRouteError(`未知的封面操作 action：${action || '(空)'}`)
    }
  } catch (err) {
    return json({ ok: false, error: err?.message || String(err), ...(err?.code ? { code: err.code } : {}) }, errorStatus(err))
  }
}
