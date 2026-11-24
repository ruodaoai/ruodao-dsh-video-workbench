#!/usr/bin/env node
/**
 * The plugin's LLM follows the agent that hosts it (mode `auto`, the default):
 *   - inside DSH → the active DSH channel (covered by the self-test's DSH discovery checks);
 *   - inside another agent (Claude Code, Codex, opencode, OpenClaw, …) → the model API key in that agent's environment
 *     (ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY), preferring the
 *     provider that matches the agent; agent login tokens are never used;
 *   - otherwise the plugin's own custom fields; explicit `custom` / `follow-dsh` choices are kept.
 * Also checks that the MCP server records the host agent from the client's `initialize` info.
 *
 *   node scripts/tests/llm-host.test.mjs
 *
 * Scratch data only (<repo>/.tmp/llm-host/<stamp>); no network; the real `.env` and DSH client folder are never read.
 */
import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCR = join(ROOT, '.tmp', 'llm-host', new Date().toISOString().replace(/[:.]/g, '-'))
const dirs = { home: join(SCR, 'home'), ws: join(SCR, 'ws'), voices: join(SCR, 'voices'), dshClient: join(SCR, 'no-dsh-client') }
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true })
const emptyEnv = join(SCR, 'empty.env')
writeFileSync(emptyEnv, '# intentionally empty\n')
const MODEL_VARS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'OPENAI_MODEL',
  'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_BASE_URL', 'GEMINI_MODEL',
  'OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL', 'OPENROUTER_MODEL',
  'LLM_MODE', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY', 'LLM_PROVIDER', 'LLM_FORMAT',
  'DSH_VIDEO_HOST_AGENT', 'DSH_VIDEO_HOST_AGENT_VERSION',
]
const BASE_ENV = {
  DSH_VIDEO_ENV_PATH: emptyEnv,
  DSH_VIDEO_HOME: dirs.home,
  DSH_VIDEO_WORKSPACE: dirs.ws,
  VOICE_PACKS_DIR: dirs.voices,
  DSH_CLIENT_HOME: dirs.dshClient, // an empty folder: no DSH client on this "machine"
  DSH_HOME: dirs.dshClient,
}
for (const v of MODEL_VARS) delete process.env[v]
Object.assign(process.env, BASE_ENV)
globalThis.fetch = async (input) => {
  throw new Error(`network blocked in tests: ${typeof input === 'string' ? input : input?.url || input}`)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`)
}
const llm = await import(pathToFileURL(join(ROOT, 'packages', 'dsh-tool-media', 'llm-client.js')).href)
const cfgFile = () => llm.getLlmConfigPath()
const scenario = (env, fileCfg = null) => {
  for (const v of MODEL_VARS) delete process.env[v]
  Object.assign(process.env, env)
  if (existsSync(cfgFile())) unlinkSync(cfgFile())
  if (fileCfg) writeFileSync(cfgFile(), JSON.stringify(fileCfg, null, 2))
  return llm.resolveLlmConfig()
}

try {
  {
    const c = scenario({})
    check('nothing configured anywhere → auto, not configured, says so', c.mode === 'auto' && c.resolvedBy === 'none' && c.sourceLabel === '未配置大模型', `${c.resolvedBy} / ${c.sourceLabel}`)
  }
  {
    const c = scenario({ DSH_VIDEO_HOST_AGENT: 'claude-code', ANTHROPIC_API_KEY: 'fake-anthropic-key-for-tests', ANTHROPIC_MODEL: 'claude-sonnet-5-5', ANTHROPIC_BASE_URL: 'https://gateway.example.test/' })
    check(
      'inside Claude Code → follows its ANTHROPIC_* environment',
      c.mode === 'auto' && c.resolvedBy === 'host-env' && c.provider === 'anthropic' && c.model === 'claude-sonnet-5-5' && c.baseUrl === 'https://gateway.example.test' && c.format === 'anthropic-messages' && c.apiKey === 'fake-anthropic-key-for-tests' && c.sourceLabel === '跟随 Claude Code（ANTHROPIC_API_KEY）',
      `${c.provider} ${c.model} ${c.baseUrl} ${c.format} | ${c.sourceLabel}`,
    )
    const sum = llm.getSafeLlmConfigSummary()
    const leaked = JSON.stringify(sum).includes('fake-anthropic-key-for-tests')
    check('the summary shown in the UI never contains the key', !leaked && sum.host?.id === 'claude-code' && sum.hostEnv?.[0]?.keyVar === 'ANTHROPIC_API_KEY' && sum.configured === true, `host=${sum.host?.label} configured=${sum.configured} leaked=${leaked}`)
  }
  {
    const c = scenario({ DSH_VIDEO_HOST_AGENT: 'codex-mcp-client', ANTHROPIC_API_KEY: 'fake-anthropic-a', OPENAI_API_KEY: 'fake-openai-b', OPENAI_BASE_URL: 'https://relay.example.test/v1' })
    check('inside Codex → prefers OpenAI; a relay base URL uses chat completions', c.resolvedBy === 'host-env' && c.provider === 'openai' && c.format === 'openai-completions' && c.baseUrl === 'https://relay.example.test/v1' && c.sourceLabel.includes('OpenAI Codex'), `${c.provider} ${c.format} | ${c.sourceLabel}`)
  }
  {
    const c = scenario({ DSH_VIDEO_HOST_AGENT: 'opencode', DEEPSEEK_API_KEY: 'fake-deepseek-c' })
    check('any other agent → whatever model key its environment has (DeepSeek here)', c.resolvedBy === 'host-env' && c.provider === 'deepseek' && c.model === 'deepseek-chat' && c.sourceLabel === '跟随 opencode（DEEPSEEK_API_KEY）', `${c.provider} ${c.model} | ${c.sourceLabel}`)
  }
  {
    const c = scenario({ DSH_VIDEO_HOST_AGENT: 'claude-code', CLAUDE_CODE_OAUTH_TOKEN: 'oauth-subscription-token', ANTHROPIC_AUTH_TOKEN: 'gateway-token-ignored' })
    check('an agent login / subscription token is never used', c.resolvedBy === 'none' && !c.apiKey && c.sourceLabel === 'Claude Code 没有可共享的模型配置', `${c.resolvedBy} key=${Boolean(c.apiKey)} | ${c.sourceLabel}`)
  }
  {
    const c = scenario({ DSH_VIDEO_HOST_AGENT: 'hermes' }, { mode: 'auto', configVersion: 2, provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'fake-own-key' })
    check('auto without an environment key → the plugin\'s own custom fields', c.resolvedBy === 'custom' && c.model === 'deepseek-chat' && c.apiKey === 'fake-own-key', `${c.resolvedBy} | ${c.sourceLabel}`)
  }
  {
    const c = scenario({ DSH_VIDEO_HOST_AGENT: 'claude-code', ANTHROPIC_API_KEY: 'fake-anthropic-x' }, { mode: 'custom', configVersion: 2, provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'some/model', apiKey: 'fake-openrouter' })
    check('an explicit custom choice is kept even when the agent has a key', c.mode === 'custom' && c.provider === 'openrouter' && c.apiKey === 'fake-openrouter', `${c.mode} ${c.provider}`)
  }
  {
    const c = scenario({ DSH_VIDEO_HOST_AGENT: 'claude-code', ANTHROPIC_API_KEY: 'fake-anthropic-y' }, { mode: 'follow-dsh', dshProviderId: 'active' })
    check('a pre-v0.6 automatic "follow-dsh" now follows the host agent', c.mode === 'auto' && c.resolvedBy === 'host-env' && c.provider === 'anthropic', `${c.mode} ${c.resolvedBy}`)
    const saved = llm.saveLlmConfig({ mode: 'follow-dsh', dshProviderId: 'active' })
    const after = llm.resolveLlmConfig()
    check('choosing 「指定 DSH 通道」 explicitly is kept as follow-dsh', saved.storedMode === 'follow-dsh' && after.mode !== 'auto', `stored=${saved.storedMode} resolved=${after.mode}`)
  }
  {
    scenario({})
    const saved = llm.saveLlmConfig({ mode: 'auto' })
    check('saving auto stores no key / URL of the host', saved.storedMode === 'auto' && saved.mode === 'auto' && !saved.hasApiKey, `stored=${saved.storedMode}`)
  }

  // 「跟随 DSH」 uses DSH's own default-model setting (agent-default-model in cordis.patch.yml) before any session cache
  {
    const dshHome = join(SCR, 'dsh-client-default')
    mkdirSync(join(dshHome, 'profiles', 'desktop'), { recursive: true })
    mkdirSync(join(dshHome, 'storages', 'session_projcache', 'sessions'), { recursive: true })
    const patchYml = (withDefault) =>
      [
        '- id: llm-pi-ai',
        '  config:',
        '    providers:',
        '      chan_a:',
        '        displayName: ChannelA',
        '        api: openai-responses',
        '        baseURL: https://chan-a.invalid/v1',
        '        apiKeyEnv: CHAN_A_KEY',
        '        models:',
        '          - id: model-a1',
        '      chan_b:',
        '        displayName: ChannelB',
        '        api: anthropic-messages',
        '        baseURL: https://chan-b.invalid/v1',
        '        apiKeyEnv: CHAN_B_KEY',
        '        models:',
        '          - id: model-b1',
        '          - id: model-b2',
        ...(withDefault
          ? ['- id: agent-default-model', '  name: "@deepseek-ai/dsh-agent-default-model"', '  config:', '    provider: chan_b', '    model: model-b2', '    reasoningEffort: max']
          : []),
      ].join('\n')
    writeFileSync(join(dshHome, '.credentials.yaml'), 'refs:\n  CHAN_A_KEY: fake-chan-a\n  CHAN_B_KEY: fake-chan-b\n')
    writeFileSync(
      join(dshHome, 'storages', 'session_projcache', 'sessions', 's1.json'),
      JSON.stringify({ record: { rows: { modelSelection: { val: { lastUsed: { provider: 'chan_a', model: 'model-a1' } } } } } }),
    )
    const env = { DSH_CLIENT_HOME: dshHome, DSH_HOME: dshHome }
    const followDsh = { mode: 'follow-dsh', dshProviderId: 'active', configVersion: 2 }
    writeFileSync(join(dshHome, 'profiles', 'desktop', 'cordis.patch.yml'), patchYml(true))
    const c = scenario(env, followDsh)
    check(
      '「跟随 DSH」 uses DSH\'s own default-model setting (agent-default-model)',
      c.mode === 'follow-dsh' && c.provider === 'chan_b' && c.model === 'model-b2' && c.format === 'anthropic-messages' && c.apiKey === 'fake-chan-b',
      `${c.mode} ${c.provider} ${c.model} ${c.format}`,
    )
    writeFileSync(join(dshHome, 'profiles', 'desktop', 'cordis.patch.yml'), patchYml(false))
    const old = scenario(env, followDsh)
    check('… a DSH without that setting still falls back as before', old.mode === 'follow-dsh' && old.provider === 'chan_a' && old.model === 'model-a1', `${old.provider} ${old.model}`)
    Object.assign(process.env, BASE_ENV)
    if (existsSync(cfgFile())) unlinkSync(cfgFile()) // the MCP check below runs with the default (auto)
  }

  // the MCP server records the host agent from the client's initialize info
  {
    for (const v of MODEL_VARS) delete process.env[v]
    const proc = spawn(process.execPath, [join(ROOT, 'bin', 'dsh-video-mcp.mjs')], {
      cwd: ROOT,
      env: { ...process.env, ...BASE_ENV, OPENAI_API_KEY: 'fake-openai-mcp', DSH_VIDEO_SKIP_PROFILE_MOUNT: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.resume()
    const send = (msg) => proc.stdin.write(JSON.stringify(msg) + '\n')
    const waitFor = async (id, ms = 60_000) => {
      const t0 = Date.now()
      while (Date.now() - t0 < ms) {
        for (const line of out.split('\n')) {
          try {
            const m = JSON.parse(line)
            if (m && m.id === id) return m
          } catch {}
        }
        await new Promise((r) => setTimeout(r, 100))
      }
      return null
    }
    try {
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex-mcp-client', version: '9.9.9' } } })
      const init = await waitFor(1)
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_llm_config', arguments: {} } })
      const res = await waitFor(2)
      const text = res?.result?.content?.[0]?.text || ''
      let sum = null
      try {
        sum = JSON.parse(text)
      } catch {}
      check(
        'MCP: the client named in initialize becomes the host agent the LLM follows',
        Boolean(init?.result) && sum?.host?.id === 'codex' && sum?.resolvedBy === 'host-env' && sum?.provider === 'openai' && !text.includes('fake-openai-mcp'),
        `host=${sum?.host?.label} resolvedBy=${sum?.resolvedBy} provider=${sum?.provider}`,
      )
    } finally {
      proc.kill()
    }
  }
} catch (err) {
  check('llm-host suite', false, err?.stack || err)
} finally {
  const walk = (p) => {
    let st
    try {
      st = lstatSync(p)
    } catch {
      return
    }
    if (st.isSymbolicLink() || !st.isDirectory()) {
      try {
        unlinkSync(p)
      } catch {
        try {
          rmdirSync(p)
        } catch {}
      }
      return
    }
    for (const n of readdirSync(p)) walk(join(p, n))
    try {
      rmdirSync(p)
    } catch {}
  }
  if (existsSync(SCR)) walk(SCR)
}
const failed = results.filter((r) => !r.ok).length
console.log(`llm-host: ${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
