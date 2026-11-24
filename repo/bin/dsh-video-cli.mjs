#!/usr/bin/env node
/**
 * DSH Video Workbench — Universal Multi-Agent CLI & Standalone Studio Launcher
 * Works with DeepSeek Harness (DSH), Claude Code, OpenAI Codex CLI, WorkBuddy,
 * Cursor, Windsurf, Cline, OpenCode, Antigravity, or Standalone Browser.
 *
 * Copyright (c) 2026 Merziller
 * Author: Merziller | QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com
 * Official Repo: https://github.com/Merziller/dsh-video-workbench (MIT License)
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PACKAGE_ROOT, REPO_ROOT, probeHardwareProfile, resolveBinaries } from '../packages/shared/index.js'
import { createUniversalToolRegistry, startMcpStdioServer } from './dsh-video-mcp.mjs'

const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
const args = process.argv.slice(2)
const cmd = (args[0] || 'studio').toLowerCase()

function printBanner() {
  console.log('======================================================================')
  console.log(`🎬 DSH Video Workbench v${pkg.version} — Universal Multi-Agent AI Video Studio`)
  console.log('   Supports: DSH · Claude Code · Codex CLI · WorkBuddy · Cursor · Browser')
  console.log('   Original Author: Merziller | License: MIT (Must retain attribution)')
  console.log('   QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com')
  console.log('   GitHub: https://github.com/Merziller/dsh-video-workbench')
  console.log('======================================================================')
}

if (cmd === 'mcp') {
  startMcpStdioServer()
} else if (cmd === 'studio' || cmd === 'start') {
  const subArgs = args.slice(1)
  const wantForeground = subArgs.includes('--foreground') || subArgs.includes('--fg')
  const wantStop = subArgs.includes('--stop')
  const wantStatus = subArgs.includes('--status')
  if (!wantStop && !wantStatus) printBanner()
  const runnerPath = join(PACKAGE_ROOT, 'scripts', 'dsh-runner.mjs')
  const passArgs = [runnerPath, 'video', '--keep-alive', ...subArgs]
  if (!wantForeground && !wantStop && !wantStatus && !subArgs.includes('--daemon') && !subArgs.includes('--bg')) {
    // Default to silent windowless background daemon so no black CMD stays open!
    passArgs.push('--daemon')
  }
  const child = spawn(process.execPath, passArgs, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    windowsHide: true,
  })
  child.on('exit', (code) => process.exit(code ?? 0))
} else if (cmd === 'stop') {
  const runnerPath = join(PACKAGE_ROOT, 'scripts', 'dsh-runner.mjs')
  const child = spawn(process.execPath, [runnerPath, 'video', '--stop'], { cwd: REPO_ROOT, stdio: 'inherit', windowsHide: true })
  child.on('exit', (code) => process.exit(code ?? 0))
} else if (cmd === 'status') {
  const runnerPath = join(PACKAGE_ROOT, 'scripts', 'dsh-runner.mjs')
  const child = spawn(process.execPath, [runnerPath, 'video', '--status'], { cwd: REPO_ROOT, stdio: 'inherit', windowsHide: true })
  child.on('exit', (code) => process.exit(code ?? 0))
} else if (cmd === 'install-tts') {
  const installerPath = join(PACKAGE_ROOT, 'scripts', 'install-tts-engine.mjs')
  const child = spawn(process.execPath, [installerPath, ...args.slice(1)], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
  child.on('exit', (code) => process.exit(code ?? 0))
} else if (cmd === 'doctor') {
  printBanner()
  const hw = probeHardwareProfile({ targetDir: REPO_ROOT })
  const bins = resolveBinaries()
  const tools = createUniversalToolRegistry()
  console.log(`• Package Root  : ${PACKAGE_ROOT}`)
  console.log(`• Workspace Root: ${REPO_ROOT}`)
  console.log(`• Node.js       : ${process.version}`)
  console.log(`• FFmpeg        : ${bins.ffmpeg}`)
  console.log(`• FFprobe       : ${bins.ffprobe}`)
  console.log(`• Hardware      : ${hw.cpu.threads} threads · ${hw.memory.freeGB}/${hw.memory.totalGB} GB RAM · ${hw.gpu.primaryName}`)
  console.log(`• Verdict       : ${hw.verdictTitle}`)
  console.log(`• MCP Tools     : ${tools.size} tools ready (${Array.from(tools.keys()).slice(0, 8).join(', ')}, ...)`)
  try {
    const { getVibeToolkitStatus } = await import('../packages/dsh-tool-media/vibe-toolkit-lib.js')
    const vibe = getVibeToolkitStatus()
    console.log(`• Vibecoding    : ${vibe.filter((t) => t.available).length}/${vibe.length} tools ready`)
    for (const t of vibe) {
      const state = t.available ? `✓ ${t.version || 'ready'}` : t.optional ? '– optional, not installed (built-in JS DSP fallback)' : '✗ missing (run pnpm install)'
      console.log(`    ${t.name.padEnd(14)} ${state}`)
    }
  } catch (err) {
    console.log(`• Vibecoding    : status unavailable (${err?.message || err})`)
  }
} else if (cmd === 'plaza') {
  // 影核广场维护（作者用）：review / accept / add / index —— see packages/dsh-tool-media/plaza-cli.js and docs/plaza-community.md
  const { runPlazaCli } = await import('../packages/dsh-tool-media/plaza-cli.js')
  process.exitCode = await runPlazaCli(args.slice(1))
} else if (cmd === 'print-config') {
  const mcpAbs = join(PACKAGE_ROOT, 'bin', 'dsh-video-mcp.mjs').replace(/\\/g, '/')
  const target = (args[1] || 'all').toLowerCase()
  printBanner()
  if (target === 'all' || target === 'claude') {
    console.log('\n[1] Claude Code (one-line MCP add):')
    console.log(`  claude mcp add dsh-video-workbench -- node "${mcpAbs}"`)
  }
  if (target === 'all' || target === 'codex') {
    console.log('\n[2] OpenAI Codex CLI (~/.codex/config.toml):')
    console.log(`  [mcp_servers.dsh_video_workbench]\n  command = "node"\n  args = ["${mcpAbs}"]`)
  }
  if (target === 'all' || target === 'workbuddy' || target === 'cursor') {
    console.log('\n[3] WorkBuddy / Cursor / Windsurf / Cline (.mcp.json):')
    console.log(JSON.stringify({ mcpServers: { 'dsh-video-workbench': { command: 'node', args: [mcpAbs] } } }, null, 2))
  }
  if (target === 'all' || target === 'dsh') {
    console.log('\n[4] DeepSeek Harness (DSH):')
    console.log('  dsh plugin --profile desktop add github:Merziller/dsh-video-workbench')
  }
} else {
  printBanner()
  console.log(`
Commands:
  studio [--open]                  Launch standalone local Web Studio (http://127.0.0.1:4399)
  mcp                              Start Universal MCP stdio server (29 tools for Claude/Codex/WorkBuddy/Cursor)
  doctor                           Check hardware, FFmpeg, Remotion, TTS & registered tools
  install-tts --engine <id>        Install optional local TTS model (edge-tts / indextts25 / gptvoice / indextts2)
  print-config [claude|codex|workbuddy|cursor|dsh]  Print copy-paste MCP/plugin config for your agent
  plaza review|accept|add|index    影核广场维护：审核 / 收录投稿包、发布自己的工程、生成在线模板目录（plaza help）
`)
}
