#!/usr/bin/env node
/**
 * DSH Video Workbench — Optional Local TTS Engine One-Click Installer CLI
 * Copyright (c) 2026 Merziller (QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com)
 *
 * Usage:
 *   node scripts/install-tts-engine.mjs --list
 *   node scripts/install-tts-engine.mjs --engine indextts25 --dir D:/AI-TTS/index-tts --mirror cn
 *   node scripts/install-tts-engine.mjs --engine gptvoice --dir D:/AI-TTS/GPT-SoVITS --mirror cn
 *   node scripts/install-tts-engine.mjs --engine edge-tts
 */
import { getTtsInstallerCatalog, installTtsEngine } from '../packages/dsh-tool-local-tts/tts-installer.js'

const argv = process.argv.slice(2)
const getFlag = (name, def = '') => {
  const idx = argv.indexOf(`--${name}`)
  if (idx >= 0 && idx + 1 < argv.length && !argv[idx + 1].startsWith('--')) return argv[idx + 1]
  return def
}
const hasFlag = (name) => argv.includes(`--${name}`)

if (hasFlag('help') || hasFlag('h')) {
  console.log(`
🎬 DSH Video Workbench — 可选本地配音引擎一键安装器 (by Merziller)
   QQ: 1411574209 | 微信: Merziller | Email: k26789228@gmail.com

用法:
  node scripts/install-tts-engine.mjs --list
  node scripts/install-tts-engine.mjs --engine <edge-tts|indextts25|indextts2|gptvoice> [--dir <安装目录>] [--mirror cn|global]

说明:
  • 所有配音模型包均完全可选，不装也可直接使用 Windows 系统原生语音 (0GB 显存) 或纯音乐卡点 (免 TTS)
  • 安装后将自动创建 voices/ 目录、生成默认参考音色 WAV，并自动写入插件 tts-config.json 与 .env
`)
  process.exit(0)
}

if (hasFlag('list') || argv.length === 0) {
  const cat = getTtsInstallerCatalog()
  console.log(JSON.stringify(cat, null, 2))
  process.exit(0)
}

const engineId = getFlag('engine', 'indextts25')
const installDir = getFlag('dir', '')
const mirror = getFlag('mirror', 'cn')
const skipModelDownload = hasFlag('skip-model-download')

try {
  const res = await installTtsEngine({
    engineId,
    installDir,
    mirror,
    skipModelDownload,
    autoActivate: !hasFlag('no-activate'),
    onProgress: ({ progress, message }) => {
      console.log(`[${String(progress).padStart(3, ' ')}%] ${message}`)
    },
  })
  console.log('\n安装结果:', JSON.stringify({ ok: res.ok, engineId: res.engineId, installedDir: res.installedDir, pythonBin: res.pythonBin, voicesDir: res.voicesDir, seededRefAudio: res.seededRefAudio }, null, 2))
} catch (err) {
  console.error('\n❌ 安装失败:', err?.message || err)
  process.exit(1)
}
