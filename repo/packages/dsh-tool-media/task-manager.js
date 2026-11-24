import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createAbortError, killProcessTree } from '../shared/index.js'

const AGENT_DEFS = [
  { id: 'director', name: '策划导演 Agent', subtitle: '口播文案 · 分镜规划 · 视觉方案' },
  { id: 'editor', name: '素材剪辑 Agent', subtitle: '构图裁切 · 调色增强 · 抠图精修' },
  { id: 'audio', name: '配音混音 Agent', subtitle: 'TTS 克隆 · 修音变速 · 闪避混音' },
  { id: 'motion_qa', name: '动效质检 Agent', subtitle: 'Remotion/HTML 编码 · 自检 · MP4 渲染' },
]

function makeInitialAgents() {
  return AGENT_DEFS.map((a) => ({
    ...a,
    status: 'idle', // idle | running | paused | completed | stopped | failed
    progress: 0,
    message: '待命中',
    updatedAt: null,
  }))
}

class CommandDeckTaskManager {
  constructor() {
    this.runs = new Map()
    this.controllers = new Map() // runId -> { controller: AbortController, activeChildren: Set<ChildProcess>, pauseGate: { paused, resolvers } }
    this.runners = new Map() // runId -> async (run, helpers) => {}
    this.loadedDirs = new Set()
    this.dshJobsBridge = null
    this.defaultRunnerFactory = null
  }

  setDefaultRunnerFactory(factory) {
    if (typeof factory === 'function') this.defaultRunnerFactory = factory
  }

  attachDshJobs(jobsSvc) {
    if (jobsSvc && typeof jobsSvc === 'object') {
      this.dshJobsBridge = jobsSvc
    }
  }

  _persistRun(run) {
    if (!run?.projectDir) return
    try {
      const storePath = join(resolve(run.projectDir), 'output', 'task-center.json')
      mkdirSync(dirname(storePath), { recursive: true })
      const projectRuns = Array.from(this.runs.values())
        .filter((r) => resolve(r.projectDir || '') === resolve(run.projectDir))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 30)
        .map((r) => this._serializeRun(r))
      writeFileSync(storePath, JSON.stringify({ updatedAt: new Date().toISOString(), runs: projectRuns }, null, 2) + '\n', 'utf8')
    } catch {}
  }

  _serializeRun(run) {
    const now = Date.now()
    const baseElapsed = Number(run.accumulatedMs) || 0
    const liveDelta = run.status === 'running' && run.lastResumedAtMs ? Math.max(0, now - run.lastResumedAtMs) : 0
    return {
      ...run,
      elapsedMs: run.status === 'completed' || run.status === 'failed' || run.status === 'stopped'
        ? Number(run.elapsedMs || baseElapsed)
        : baseElapsed + liveDelta,
    }
  }

  loadProjectHistory(projectDir) {
    if (!projectDir) return
    const absDir = resolve(projectDir)
    if (this.loadedDirs.has(absDir)) return
    this.loadedDirs.add(absDir)
    const storePath = join(absDir, 'output', 'task-center.json')
    if (!existsSync(storePath)) return
    try {
      const parsed = JSON.parse(readFileSync(storePath, 'utf8'))
      for (const r of parsed?.runs || []) {
        if (!r?.id || this.runs.has(r.id)) continue
        // Normalize stale running/paused states loaded from previous process sessions
        const normalized = { ...r }
        if (normalized.status === 'running' || normalized.status === 'paused') {
          normalized.status = 'stopped'
          normalized.error = normalized.error || '服务已重启，历史未完成任务已转为已停止（可点击重试继续）'
          for (const t of normalized.tasks || []) {
            if (t.status === 'running' || t.status === 'paused') t.status = 'stopped'
          }
          for (const ag of normalized.agents || []) {
            if (ag.status === 'running' || ag.status === 'paused') ag.status = 'stopped'
          }
        }
        this.runs.set(normalized.id, normalized)
      }
    } catch {}
  }

  createRun({
    projectDir,
    title = 'AI Agent 一键出片流水线',
    topic = '',
    mode = 'ai-coded',
    spec = {},
    subtasks = [],
  }) {
    this.loadProjectHistory(projectDir)
    const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const nowIso = new Date().toISOString()

    const defaultTasks =
      subtasks.length > 0
        ? subtasks
        : [
            { id: 't-director', stage: 'director', name: '口播文案与分镜导演', kind: 'script_plan' },
            { id: 't-editor', stage: 'editor', name: '视觉素材裁切调色精修', kind: 'media_edit' },
            { id: 't-audio', stage: 'audio', name: 'IndexTTS-2.5 配音修音与混音', kind: 'audio_mix' },
            ...(spec.avatarEnabled ? [{ id: 't-avatar', stage: 'audio', name: '透明通道数字人生成', kind: 'avatar_gen' }] : []),
            { id: 't-motion', stage: 'motion_qa', name: '动效合成与快照质检', kind: 'motion_qa' },
            { id: 't-render', stage: 'motion_qa', name: '高清成片 MP4 编码导出', kind: 'mp4_render' },
          ]

    const run = {
      id: runId,
      projectDir: resolve(projectDir),
      title,
      topic,
      mode,
      spec,
      status: 'queued', // queued | running | paused | completed | stopped | failed
      progress: 0,
      activeStage: defaultTasks[0]?.stage || 'director',
      createdAt: nowIso,
      startedAt: null,
      endedAt: null,
      lastResumedAtMs: 0,
      accumulatedMs: 0,
      elapsedMs: 0,
      error: '',
      resultSummary: null,
      agents: makeInitialAgents(),
      tasks: defaultTasks.map((t) => ({
        id: t.id,
        stage: t.stage,
        name: t.name,
        kind: t.kind,
        status: 'queued',
        progress: 0,
        startedAt: null,
        endedAt: null,
        elapsedMs: 0,
        message: '等待调度',
        error: '',
      })),
      logs: [{ ts: nowIso, stage: 'director', level: 'info', message: `任务流水线已创建 (${title})` }],
    }

    this.runs.set(runId, run)
    this._syncDshJob(run)
    this._persistRun(run)
    return this._serializeRun(run)
  }

  _syncDshJob(run) {
    if (!this.dshJobsBridge) return
    try {
      if (typeof this.dshJobsBridge.upsert === 'function') {
        this.dshJobsBridge.upsert(this._serializeRun(run))
      } else if (typeof this.dshJobsBridge.update === 'function') {
        this.dshJobsBridge.update(run.id, { status: run.status, progress: run.progress, message: run.activeStage })
      }
    } catch {}
  }

  _ensureControl(runId) {
    let ctrl = this.controllers.get(runId)
    if (!ctrl || ctrl.controller.signal.aborted) {
      ctrl = {
        controller: new AbortController(),
        activeChildren: new Set(),
        paused: false,
        resumeResolvers: [],
      }
      this.controllers.set(runId, ctrl)
    }
    return ctrl
  }

  registerChild(runId, child) {
    const ctrl = this.controllers.get(runId)
    if (!ctrl || !child) return
    ctrl.activeChildren.add(child)
    child.once('exit', () => {
      ctrl.activeChildren.delete(child)
    })
  }

  appendLog(runId, stage, message, level = 'info') {
    const run = this.runs.get(runId)
    if (!run || !message) return
    run.logs.push({ ts: new Date().toISOString(), stage: stage || run.activeStage, level, message: String(message) })
    if (run.logs.length > 220) run.logs.splice(0, run.logs.length - 220)
    this._persistRun(run)
  }

  updateTask(runId, taskId, patch = {}) {
    const run = this.runs.get(runId)
    if (!run) return
    const task = run.tasks.find((t) => t.id === taskId)
    if (!task) return
    const nowIso = new Date().toISOString()
    if (patch.status === 'running' && !task.startedAt) task.startedAt = nowIso
    if (['completed', 'failed', 'stopped'].includes(patch.status)) {
      task.endedAt = nowIso
      if (task.startedAt) {
        task.elapsedMs = Math.max(0, Date.now() - Date.parse(task.startedAt))
      }
    }
    Object.assign(task, patch)

    // Roll up progress across subtasks + update matching HUD agent
    const doneWeight = run.tasks.reduce((acc, t) => {
      if (t.status === 'completed') return acc + 100
      if (t.status === 'running' || t.status === 'paused') return acc + (Number(t.progress) || 0)
      return acc
    }, 0)
    run.progress = Math.min(99, Math.round(doneWeight / Math.max(1, run.tasks.length)))
    if (patch.status === 'running') run.activeStage = task.stage

    const agent = run.agents.find((a) => a.id === task.stage)
    if (agent) {
      const stageTasks = run.tasks.filter((t) => t.stage === agent.id)
      const allDone = stageTasks.length > 0 && stageTasks.every((t) => t.status === 'completed')
      const anyFailed = stageTasks.some((t) => t.status === 'failed')
      const anyStopped = stageTasks.some((t) => t.status === 'stopped')
      const anyRunning = stageTasks.some((t) => t.status === 'running')
      const anyPaused = stageTasks.some((t) => t.status === 'paused')
      agent.status = allDone
        ? 'completed'
        : anyFailed
          ? 'failed'
          : anyStopped
            ? 'stopped'
            : anyPaused
              ? 'paused'
              : anyRunning
                ? 'running'
                : 'idle'
      agent.progress = Math.round(
        stageTasks.reduce((s, t) => s + (t.status === 'completed' ? 100 : Number(t.progress) || 0), 0) /
          Math.max(1, stageTasks.length),
      )
      if (patch.message) agent.message = patch.message
      agent.updatedAt = nowIso
    }

    if (patch.message && patch.log !== false) {
      this.appendLog(runId, task.stage, patch.message, patch.status === 'failed' ? 'error' : 'info')
    }
    this._syncDshJob(run)
    this._persistRun(run)
  }

  async waitIfPaused(runId, taskId = '') {
    const run = this.runs.get(runId)
    const ctrl = this.controllers.get(runId)
    if (!run || !ctrl) return
    if (ctrl.controller.signal.aborted || run.status === 'stopped') {
      throw createAbortError()
    }
    if (run.status === 'paused' || ctrl.paused) {
      if (taskId) this.updateTask(runId, taskId, { status: 'paused', message: '已暂停，等待用户恢复执行...' })
      await new Promise((resolveWait, rejectWait) => {
        const onAbort = () => rejectWait(createAbortError())
        ctrl.controller.signal.addEventListener('abort', onAbort, { once: true })
        ctrl.resumeResolvers.push(() => {
          ctrl.controller.signal.removeEventListener('abort', onAbort)
          if (ctrl.controller.signal.aborted) rejectWait(createAbortError())
          else resolveWait()
        })
      })
      if (taskId) this.updateTask(runId, taskId, { status: 'running', message: '已恢复继续执行...' })
    }
    if (ctrl.controller.signal.aborted) throw createAbortError()
  }

  async startRun(runId, runnerFn, { fromTaskId = '' } = {}) {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    if (runnerFn) this.runners.set(runId, runnerFn)
    const activeRunner = runnerFn || this.runners.get(runId)
    if (!activeRunner) throw new Error(`No runner bound for run ${runId}`)

    const ctrl = {
      controller: new AbortController(),
      activeChildren: new Set(),
      paused: false,
      resumeResolvers: [],
    }
    this.controllers.set(runId, ctrl)

    run.status = 'running'
    run.error = ''
    run.endedAt = null
    if (!run.startedAt) run.startedAt = new Date().toISOString()
    run.lastResumedAtMs = Date.now()
    this._persistRun(run)

    const helpers = {
      signal: ctrl.controller.signal,
      onChild: (child) => this.registerChild(runId, child),
      waitIfPaused: (taskId) => this.waitIfPaused(runId, taskId),
      updateTask: (taskId, patch) => this.updateTask(runId, taskId, patch),
      appendLog: (stage, msg, level) => this.appendLog(runId, stage, msg, level),
      fromTaskId,
    }

    const execPromise = (async () => {
      try {
        const summary = await activeRunner(run, helpers)
        if (ctrl.controller.signal.aborted || run.status === 'stopped') return run
        run.status = 'completed'
        run.progress = 100
        run.endedAt = new Date().toISOString()
        run.accumulatedMs += Math.max(0, Date.now() - (run.lastResumedAtMs || Date.now()))
        run.lastResumedAtMs = 0
        run.elapsedMs = run.accumulatedMs
        run.resultSummary = summary || null
        for (const ag of run.agents) {
          if (ag.status === 'running' || ag.status === 'idle') {
            ag.status = 'completed'
            ag.progress = 100
            ag.message = '已完成'
          }
        }
        const warnCount = Array.isArray(summary?.warnings) ? summary.warnings.length : 0
        this.appendLog(
          runId,
          'motion_qa',
          warnCount ? `✅ 出片完成，但有 ${warnCount} 项需要注意（见上方黄色提示）` : '✅ 协同作战流水线已全部完成！',
          warnCount ? 'warn' : 'info',
        )
        this._syncDshJob(run)
        this._persistRun(run)
        return this._serializeRun(run)
      } catch (err) {
        if (err?.name === 'AbortError' || ctrl.controller.signal.aborted || run.status === 'stopped') {
          run.status = 'stopped'
          run.endedAt = new Date().toISOString()
          if (run.lastResumedAtMs) {
            run.accumulatedMs += Math.max(0, Date.now() - run.lastResumedAtMs)
            run.lastResumedAtMs = 0
          }
          run.elapsedMs = run.accumulatedMs
          for (const t of run.tasks) {
            if (t.status === 'running' || t.status === 'paused') t.status = 'stopped'
          }
          for (const ag of run.agents) {
            if (ag.status === 'running' || ag.status === 'paused') {
              ag.status = 'stopped'
              ag.message = '已停止'
            }
          }
          this._syncDshJob(run)
          this._persistRun(run)
          return this._serializeRun(run)
        }
        run.status = 'failed'
        run.error = err?.message || String(err)
        run.endedAt = new Date().toISOString()
        if (run.lastResumedAtMs) {
          run.accumulatedMs += Math.max(0, Date.now() - run.lastResumedAtMs)
          run.lastResumedAtMs = 0
        }
        run.elapsedMs = run.accumulatedMs
        for (const t of run.tasks) {
          if (t.status === 'running' || t.status === 'paused') {
            t.status = 'failed'
            t.error = run.error
          }
        }
        for (const ag of run.agents) {
          if (ag.status === 'running' || ag.status === 'paused') {
            ag.status = 'failed'
            ag.message = run.error
          }
        }
        this.appendLog(runId, run.activeStage, `❌ 执行失败: ${run.error}`, 'error')
        this._syncDshJob(run)
        this._persistRun(run)
        throw err
      }
    })()

    return { run: this._serializeRun(run), promise: execPromise }
  }

  pauseRun(runId) {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    if (run.status !== 'running') return this._serializeRun(run)
    const ctrl = this._ensureControl(runId)
    ctrl.paused = true
    run.status = 'paused'
    if (run.lastResumedAtMs) {
      run.accumulatedMs += Math.max(0, Date.now() - run.lastResumedAtMs)
      run.lastResumedAtMs = 0
    }
    for (const t of run.tasks) {
      if (t.status === 'running') t.status = 'paused'
    }
    for (const ag of run.agents) {
      if (ag.status === 'running') {
        ag.status = 'paused'
        ag.message = '已暂停'
      }
    }
    this.appendLog(runId, run.activeStage, '⏸️ 用户已暂停当前协同流水线', 'warn')
    this._syncDshJob(run)
    this._persistRun(run)
    return this._serializeRun(run)
  }

  resumeRun(runId) {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    const ctrl = this.controllers.get(runId)
    if (run.status === 'paused' && ctrl) {
      ctrl.paused = false
      run.status = 'running'
      run.lastResumedAtMs = Date.now()
      for (const t of run.tasks) {
        if (t.status === 'paused') t.status = 'running'
      }
      for (const ag of run.agents) {
        if (ag.status === 'paused') {
          ag.status = 'running'
          ag.message = '恢复运行中'
        }
      }
      const resolvers = ctrl.resumeResolvers.splice(0, ctrl.resumeResolvers.length)
      for (const r of resolvers) {
        try { r() } catch {}
      }
      this.appendLog(runId, run.activeStage, '▶️ 用户已恢复运行协同流水线', 'info')
      this._syncDshJob(run)
      this._persistRun(run)
      return this._serializeRun(run)
    }
    if ((run.status === 'stopped' || run.status === 'queued') && this.runners.has(runId)) {
      return this.retryRun(runId)
    }
    return this._serializeRun(run)
  }

  stopRun(runId) {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    const ctrl = this.controllers.get(runId)
    run.status = 'stopped'
    run.endedAt = new Date().toISOString()
    if (run.lastResumedAtMs) {
      run.accumulatedMs += Math.max(0, Date.now() - run.lastResumedAtMs)
      run.lastResumedAtMs = 0
    }
    run.elapsedMs = run.accumulatedMs

    if (ctrl) {
      ctrl.paused = false
      try { ctrl.controller.abort(createAbortError('User stopped task')) } catch {}
      for (const child of Array.from(ctrl.activeChildren)) {
        killProcessTree(child)
      }
      ctrl.activeChildren.clear()
      const resolvers = ctrl.resumeResolvers.splice(0, ctrl.resumeResolvers.length)
      for (const r of resolvers) {
        try { r() } catch {}
      }
    }

    for (const t of run.tasks) {
      if (t.status === 'running' || t.status === 'paused' || t.status === 'queued') {
        t.status = 'stopped'
        if (!t.endedAt) t.endedAt = run.endedAt
      }
    }
    for (const ag of run.agents) {
      if (ag.status === 'running' || ag.status === 'paused') {
        ag.status = 'stopped'
        ag.message = '已强制停止'
      }
    }
    this.appendLog(runId, run.activeStage, '⛔ 用户已立即停止任务并中止关联子进程', 'warn')
    this._syncDshJob(run)
    this._persistRun(run)
    return this._serializeRun(run)
  }

  stopAll(projectDir = '') {
    const targetDir = projectDir ? resolve(projectDir) : ''
    const affected = []
    for (const run of this.runs.values()) {
      if (targetDir && resolve(run.projectDir || '') !== targetDir) continue
      if (run.status === 'running' || run.status === 'paused' || run.status === 'queued') {
        affected.push(this.stopRun(run.id))
      }
    }
    return affected
  }

  pauseAll(projectDir = '') {
    const targetDir = projectDir ? resolve(projectDir) : ''
    const affected = []
    for (const run of this.runs.values()) {
      if (targetDir && resolve(run.projectDir || '') !== targetDir) continue
      if (run.status === 'running') {
        affected.push(this.pauseRun(run.id))
      }
    }
    return affected
  }

  async retryRun(runId, { taskId = '' } = {}) {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    const activeRunner = this.runners.get(runId) || (this.defaultRunnerFactory ? this.defaultRunnerFactory(run) : null)
    if (!activeRunner) {
      throw new Error('该历史任务缺少可执行调度器，请在面板点击「⚡ 一键开始出片」发起新执行。')
    }
    let resetFollowing = !taskId
    for (const t of run.tasks) {
      if (taskId && t.id === taskId) resetFollowing = true
      if (resetFollowing || t.status === 'failed' || t.status === 'stopped') {
        t.status = 'queued'
        t.progress = 0
        t.error = ''
        t.endedAt = null
        t.message = '准备重试...'
      }
    }
    this.appendLog(runId, 'director', taskId ? `🔄 正在从子任务 ${taskId} 重试执行...` : '🔄 正在从失败/停止节点重试协同流水线...', 'info')
    const started = await this.startRun(runId, activeRunner, { fromTaskId: taskId })
    started.promise.catch(() => {})
    return started.run
  }

  getRun(runId) {
    const run = this.runs.get(runId)
    return run ? this._serializeRun(run) : null
  }

  listRuns(projectDir = '') {
    if (projectDir) this.loadProjectHistory(projectDir)
    const targetDir = projectDir ? resolve(projectDir) : ''
    return Array.from(this.runs.values())
      .filter((r) => !targetDir || resolve(r.projectDir || '') === targetDir)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map((r) => this._serializeRun(r))
  }
}

export const taskManager = new CommandDeckTaskManager()
