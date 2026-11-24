#!/usr/bin/env node
/**
 * DSH Video Workbench — Universal Multi-Agent MCP Server (Model Context Protocol over stdio)
 * Works natively with Claude Code, OpenAI Codex CLI, WorkBuddy, Cursor, Windsurf, Cline,
 * OpenCode, Antigravity, Gemini CLI, and DeepSeek Harness (DSH).
 *
 * Copyright (c) 2026 Merziller
 * Author: Merziller | QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com
 * Official Repo: https://github.com/Merziller/dsh-video-workbench (MIT License)
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PACKAGE_ROOT, REPO_ROOT, loadEnv } from '../packages/shared/index.js'
import PresetVideoPlugin, { VIDEO_MAKER_SYSTEM_PROMPT } from '../packages/dsh-preset-video/index.js'
import WebVideoWorkbenchPlugin from '../packages/dsh-web-video-workbench/lib/index.js'
import { getTtsInstallerCatalog, installTtsEngine } from '../packages/dsh-tool-local-tts/index.js'

const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))

// Redirect stray console.log to stderr so stdio JSON-RPC framing stays 100% pure
const origConsoleLog = console.log
console.log = (...args) => {
  process.stderr.write(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n')
}

export function createUniversalToolRegistry() {
  loadEnv()
  const toolsMap = new Map()
  const shimCtx = {
    // not the real DSH host: lets the plugin tell DSH apart from MCP / standalone use
    __dshVideoShim: true,
    tools: {
      register(def) {
        if (!def?.name || typeof def.execute !== 'function') return
        toolsMap.set(def.name, {
          name: def.name,
          description: String(def.description || def.name),
          inputSchema: def.parameters && typeof def.parameters === 'object'
            ? def.parameters
            : { type: 'object', properties: {}, additionalProperties: true },
          execute: def.execute,
        })
      },
    },
    agentPresets: { register() {} },
    connection: { fetch: { register() {} } },
    webui: { addStaticModule() {} },
    plugin(plg) {
      if (typeof plg === 'function') plg(shimCtx)
      else if (plg && typeof plg.apply === 'function') plg.apply(shimCtx)
    },
    inject(_deps, fn) {
      try { fn(shimCtx) } catch {}
    },
  }

  PresetVideoPlugin.apply(shimCtx)
  WebVideoWorkbenchPlugin.apply(shimCtx)

  // Bonus MCP-native helper tools for non-DSH agents (Claude Code / Codex / WorkBuddy / Cursor)
  toolsMap.set('open_video_studio', {
    name: 'open_video_studio',
    description:
      'Start (or check) the standalone DSH Video Workbench local Web Studio UI (default http://127.0.0.1:4399) so users on Claude Code, Codex, WorkBuddy, or Cursor can visually edit storyboards, upload reference videos/BGM, and preview MP4s in any browser without needing DSH.',
    inputSchema: {
      type: 'object',
      properties: {
        port: { type: 'number', description: 'Preferred local HTTP port (default 4399).' },
        openBrowser: { type: 'boolean', description: 'Open the Studio URL in the default browser.' },
      },
      additionalProperties: false,
    },
    async execute(args = {}) {
      const port = Number(args.port) || Number(process.env.DSH_VIDEO_PORT) || 4399
      const url = `http://127.0.0.1:${port}`
      try {
        const probe = await fetch(`${url}/api/video-workbench/runner-info`, { signal: AbortSignal.timeout(1200) })
        if (probe.ok) {
          const info = await probe.json()
          return { ok: true, alreadyRunning: true, url: info.url || url, port: info.port || port, author: 'Merziller (QQ: 1411574209)' }
        }
      } catch {}
      const runnerPath = join(PACKAGE_ROOT, 'scripts', 'dsh-runner.mjs')
      const spawnArgs = [runnerPath, 'video', '--keep-alive']
      if (args.openBrowser) spawnArgs.push('--open')
      const child = spawn(process.execPath, spawnArgs, {
        cwd: REPO_ROOT,
        env: { ...process.env, DSH_VIDEO_PORT: String(port) },
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()
      return {
        ok: true,
        started: true,
        pid: child.pid,
        url,
        message: `Standalone Video Studio launched at ${url} (Works with Claude Code, Codex, WorkBuddy, Cursor & any browser).`,
        author: 'Merziller (QQ: 1411574209 | WeChat: Merziller | k26789228@gmail.com)',
      }
    },
  })

  toolsMap.set('install_tts_engine', {
    name: 'install_tts_engine',
    description:
      'Optional one-click installer for local TTS engines (edge-tts, indextts25, indextts2, gptvoice). Automatically creates voices/ + seeds default speaker WAV and wires tts-config.json & .env. Pass action="list" to inspect options without installing.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'install'], description: 'Use "list" to view optional packages or "install" to install one.' },
        engineId: { type: 'string', enum: ['edge-tts', 'indextts25', 'indextts2', 'gptvoice'], description: 'Optional TTS engine to install.' },
        installDir: { type: 'string', description: 'Optional target install directory.' },
        mirror: { type: 'string', enum: ['cn', 'global'], description: 'Mirror source (cn = HF-Mirror + Tsinghua PyPI).' },
      },
      additionalProperties: false,
    },
    async execute(args = {}) {
      if (args.action === 'list' || !args.engineId) {
        return { ok: true, catalog: getTtsInstallerCatalog() }
      }
      return await installTtsEngine({
        engineId: args.engineId,
        installDir: args.installDir || '',
        mirror: args.mirror || 'cn',
        autoActivate: true,
      })
    },
  })

  return toolsMap
}

function writeMessage(msg, useContentLength = false) {
  const payload = JSON.stringify(msg)
  if (useContentLength) {
    const byteLen = Buffer.byteLength(payload, 'utf8')
    process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${payload}`)
  } else {
    process.stdout.write(`${payload}\n`)
  }
}

export function startMcpStdioServer() {
  const toolsMap = createUniversalToolRegistry()
  let detectedContentLength = false
  let rawBuf = Buffer.alloc(0)

  const handleRequest = async (req) => {
    if (!req || typeof req !== 'object') return
    const id = req.id
    const method = String(req.method || '')
    const params = req.params || {}

    // Notifications (no id) require no response
    if (id === undefined || id === null) {
      return
    }

    const reply = (result) => writeMessage({ jsonrpc: '2.0', id, result }, detectedContentLength)
    const replyErr = (code, message) => writeMessage({ jsonrpc: '2.0', id, error: { code, message } }, detectedContentLength)

    try {
      if (method === 'initialize') {
        // Remember which agent hosts this server (Claude Code, Codex, opencode, OpenClaw, …): the plugin's default
        // LLM mode 「跟随当前智能体」 and the web studio started from here use it. A value the user set wins.
        const ci = params.clientInfo && typeof params.clientInfo === 'object' ? params.clientInfo : {}
        const clientName = String(ci.name || ci.title || '').trim()
        if (clientName && !String(process.env.DSH_VIDEO_HOST_AGENT || '').trim()) {
          process.env.DSH_VIDEO_HOST_AGENT = clientName.slice(0, 80)
          if (ci.version) process.env.DSH_VIDEO_HOST_AGENT_VERSION = String(ci.version).slice(0, 40)
        }
        const clientVer = String(params.protocolVersion || '2024-11-05')
        return reply({
          protocolVersion: clientVer,
          capabilities: {
            tools: { listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: {
            name: 'dsh-video-workbench',
            version: pkg.version,
            title: 'DSH Video Workbench Universal MCP Server (by Merziller)',
          },
          instructions:
            'Universal Dual-Engine AI Video Studio (Remotion 4.x + Three.js 3D & HyperFrames HTML5) by Merziller (QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com | https://github.com/Merziller/dsh-video-workbench). Call open_video_studio for the visual Web UI, analyze_reference_video to reverse-engineer and remake any reference video, or run_agent_pipeline / ai_create_video for end-to-end MP4 production.',
        })
      }

      if (method === 'ping') {
        return reply({})
      }

      if (method === 'tools/list') {
        const tools = Array.from(toolsMap.values()).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }))
        return reply({ tools })
      }

      if (method === 'tools/call') {
        const toolName = String(params.name || '')
        const toolArgs = params.arguments && typeof params.arguments === 'object' ? params.arguments : {}
        const tool = toolsMap.get(toolName)
        if (!tool) {
          return replyErr(-32601, `Unknown tool: ${toolName}`)
        }
        try {
          const out = await tool.execute(toolArgs)
          const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2)
          return reply({
            content: [{ type: 'text', text }],
            isError: false,
          })
        } catch (execErr) {
          return reply({
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: execErr?.message || String(execErr) }, null, 2) }],
            isError: true,
          })
        }
      }

      if (method === 'prompts/list') {
        return reply({
          prompts: [
            {
              name: 'video-maker',
              description: 'DSH Video Workbench 首席动态视觉导演与全链路出片系统提示词 (by Merziller)',
              arguments: [],
            },
          ],
        })
      }

      if (method === 'prompts/get') {
        if (params.name === 'video-maker') {
          return reply({
            description: 'DSH Video Workbench Video Director Prompt (by Merziller)',
            messages: [
              {
                role: 'user',
                content: { type: 'text', text: VIDEO_MAKER_SYSTEM_PROMPT },
              },
            ],
          })
        }
        return replyErr(-32602, `Unknown prompt: ${params.name}`)
      }

      return replyErr(-32601, `Method not found: ${method}`)
    } catch (err) {
      return replyErr(-32603, err?.message || String(err))
    }
  }

  const processBuffer = () => {
    while (rawBuf.length > 0) {
      const strHead = rawBuf.subarray(0, Math.min(rawBuf.length, 64)).toString('utf8')
      if (/^Content-Length:\s*\d+/i.test(strHead)) {
        detectedContentLength = true
        const sepIdx = rawBuf.indexOf('\r\n\r\n')
        if (sepIdx < 0) return
        const headerStr = rawBuf.subarray(0, sepIdx).toString('utf8')
        const m = /Content-Length:\s*(\d+)/i.exec(headerStr)
        if (!m) {
          rawBuf = rawBuf.subarray(sepIdx + 4)
          continue
        }
        const bodyLen = parseInt(m[1], 10)
        const totalNeeded = sepIdx + 4 + bodyLen
        if (rawBuf.length < totalNeeded) return
        const bodyStr = rawBuf.subarray(sepIdx + 4, totalNeeded).toString('utf8')
        rawBuf = rawBuf.subarray(totalNeeded)
        try {
          handleRequest(JSON.parse(bodyStr))
        } catch {}
      } else {
        const nlIdx = rawBuf.indexOf(0x0a)
        if (nlIdx < 0) return
        const line = rawBuf.subarray(0, nlIdx).toString('utf8').trim()
        rawBuf = rawBuf.subarray(nlIdx + 1)
        if (!line) continue
        try {
          handleRequest(JSON.parse(line))
        } catch {}
      }
    }
  }

  process.stdin.on('data', (chunk) => {
    rawBuf = Buffer.concat([rawBuf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
    processBuffer()
  })
  process.stdin.resume()
}

const isEntry = process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()
if (isEntry) {
  startMcpStdioServer()
}
