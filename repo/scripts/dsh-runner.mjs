import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadEnv,
  REPO_ROOT,
  resolveEnvPath,
  runCommandRedirected,
} from '../packages/shared/index.js'
import { setupDshVideoProfile } from './install-profile.mjs'
import LocalTtsPlugin from '../packages/dsh-tool-local-tts/index.js'
import AvatarPlugin from '../packages/dsh-tool-avatar/index.js'
import VideoSuitePlugin from '../packages/dsh-tool-video-suite/index.js'
import PresetVideoPlugin from '../packages/dsh-preset-video/index.js'
import WebVideoWorkbenchPlugin, {
  handleWorkbenchApiRequest,
  listVideoProjects,
} from '../packages/dsh-web-video-workbench/lib/index.js'

/**
 * Verify Cordis plugin registration (`ctx.tools`, `ctx.agentPresets`, `ctx.connection`, `ctx.webui`)
 * in a mock/lightweight Cordis host context.
 */
export function verifyCordisPluginMounting() {
  const registeredTools = []
  const registeredPresets = []
  const registeredRoutes = []
  const registeredStaticModules = []

  const mockCtx = {
    // not the real DSH host: lets the plugin tell DSH apart from MCP / standalone use
    __dshVideoShim: true,
    tools: {
      register(def) {
        registeredTools.push({
          name: def.name,
          description: def.description,
          required: def.parameters?.required || [],
          execute: def.execute,
        })
      },
    },
    agentPresets: {
      register(def) {
        registeredPresets.push({
          id: def.id,
          name: def.name,
          pluginCount: Array.isArray(def.plugins) ? def.plugins.length : 0,
        })
      },
    },
    connection: {
      fetch: {
        register(def) {
          registeredRoutes.push({ path: def.path, methods: def.methods })
        },
      },
    },
    webui: {
      addStaticModule(def) {
        registeredStaticModules.push(def)
      },
    },
    plugin(plg) {
      if (typeof plg === 'function') plg(mockCtx)
      else if (plg && typeof plg.apply === 'function') plg.apply(mockCtx)
    },
    inject(_deps, fn) {
      fn(mockCtx)
    },
  }

  PresetVideoPlugin.apply(mockCtx)
  WebVideoWorkbenchPlugin.apply(mockCtx)

  return {
    tools: registeredTools.map((t) => t.name),
    toolDefinitions: registeredTools,
    presets: registeredPresets,
    routes: registeredRoutes,
    staticModules: registeredStaticModules,
  }
}

/** Standalone browser shell that boots React 18 + client.js (the war-room host) — shared with the UI e2e test. */
// ---------------------------------------------------------------------------------------------------------------
// Local-only API guard + safe forwarding (shared with scripts/tests/warroom-ui.e2e.mjs, so the acceptance test runs the
// exact code the studio runs). Any web page the user visits can send requests to 127.0.0.1: browsers attach `Origin`
// to every cross-origin POST (also `mode: 'no-cors'`) and `Sec-Fetch-Site` to every request, and DNS rebinding changes
// `Host`. Only the studio's own pages may call the API; local tools that send neither header (CLI, tests, MCP helpers)
// keep working.
export const API_FORBIDDEN_MESSAGE = '仅允许工作台自己的页面调用本地接口（已拒绝来自其他网站的请求）'
export const MAX_API_BODY_BYTES = 2 * 1024 * 1024 * 1024 // 2 GiB; larger files: import them by local path instead

/**
 * Ruodao desktop hosts this studio inside a `sandbox` iframe without `allow-same-origin`, so every request the
 * embedded page makes carries an opaque origin — `Origin: null` plus `Sec-Fetch-Site: cross-site`. Only a browser
 * can produce `null` here (a page opened from a real site always sends that site's origin), so an opaque-origin
 * request reaching this exact local host is our own embedded UI. `Host` is still checked first, which keeps DNS
 * rebinding out, and a foreign site still cannot read any response because we only echo
 * `Access-Control-Allow-Origin: null` for those opaque-origin requests.
 */
export function isOpaqueOriginRequest(req) {
  return String(req.headers.origin || '').trim().toLowerCase() === 'null'
}

/**
 * `Sec-Fetch-Dest` values produced by plain page sub-resource loads. These requests carry no `Origin` header,
 * so they are indistinguishable from a blind cross-site embed by origin alone; they are also unable to read the
 * response through JS, which is why they may be served to the host's sandboxed iframe.
 */
const EMBEDDABLE_FETCH_DEST = new Set(['iframe', 'frame', 'image', 'media', 'audio', 'video', 'font', 'style', 'script', 'track', 'object', 'embed', 'empty'])

/** '' when the request may use the local API, else the reason ('host' | 'origin' | 'site'). */
export function apiRequestRejection(req, port) {
  const host = String(req.headers.host || '').trim().toLowerCase()
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return 'host'
  const origin = String(req.headers.origin ?? '')
  const opaque = isOpaqueOriginRequest(req)
  if (origin !== '' && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}` && !opaque) {
    return 'origin'
  }
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase()
  if (site === 'cross-site' || site === 'same-site') {
    if (opaque) return ''
    // Navigation and media sub-resource loads never carry `Origin`; only scripted calls do. Inside the host's
    // sandboxed iframe that means the war-room skin page (<iframe>), project assets (<img>/<audio>/<video>) and
    // the kit bundle (<script>/<link>) arrive as plain cross-site requests and were rejected here, which is what
    // made the dashboard fail to boot. They cannot read a response body from JS, so serving them leaks nothing;
    // a foreign page's fetch/XHR still sends its own Origin and is rejected by the checks above.
    const dest = String(req.headers['sec-fetch-dest'] || '').toLowerCase()
    if (origin === '' && EMBEDDABLE_FETCH_DEST.has(dest)) return ''
    return 'site'
  }
  return ''
}

/**
 * Echo CORS for the opaque-origin (sandboxed iframe) case only. Without this the browser blocks reading the
 * response and the UI shows "Failed to fetch" even though the server answered 200. Same-origin requests need no
 * headers, and a foreign site (real origin) never matches `null`, so nothing becomes readable cross-site.
 */
export function applyEmbeddedCorsHeaders(req, res) {
  if (!isOpaqueOriginRequest(req)) return
  res.setHeader('Access-Control-Allow-Origin', 'null')
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', String(req.headers['access-control-request-headers'] || '*'))
  res.setHeader('Access-Control-Max-Age', '600')
}

export function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

/**
 * Forward one `/api/video-workbench/*` request to the plugin router. Never rejects: an upload cut off by the user
 * (closed tab, cancelled recording, network drop) used to reject the async listener and end the whole studio process
 * together with every running render / TTS job.
 */
export async function forwardApiRequest(req, res, url, handler) {
  try {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_API_BODY_BYTES) {
        sendJson(res, 413, { ok: false, error: '上传内容超过 2 GB，请改用「从本地路径导入」' })
        req.destroy()
        return
      }
      chunks.push(chunk)
    }
    const webReq = new Request(url.href, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : Buffer.concat(chunks),
    })
    const webRes = await handler(webReq)
    res.statusCode = webRes.status
    webRes.headers.forEach((v, k) => res.setHeader(k, v))
    res.end(Buffer.from(await webRes.arrayBuffer()))
  } catch (err) {
    const aborted = req.aborted || err?.code === 'ECONNRESET' || /aborted/i.test(String(err?.message || ''))
    if (!aborted) console.error('[runner] API request failed:', url.pathname, err?.stack || err)
    if (!res.headersSent && !res.destroyed) {
      try {
        sendJson(res, aborted ? 400 : 500, { ok: false, error: aborted ? '请求在传输中被中断' : String(err?.message || err) })
      } catch {}
    } else {
      try {
        res.destroy()
      } catch {}
    }
  }
}

export function standaloneShellHtml(profileName = 'video') {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DeepSeek Harness — 双引擎视频工作台 (Profile: ${profileName})</title>
  <style>
    html, body, #root { margin: 0; padding: 0; width: 100vw; height: 100vh; overflow: hidden; background: #090d18; color: #f8fafc; font-family: 'Noto Sans SC', 'Microsoft YaHei', Consolas, sans-serif; }
    .dsh-boot-fallback { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 28px; text-align: center; box-sizing: border-box; }
    .dsh-boot-card { max-width: 560px; padding: 24px 28px; border-radius: 16px; background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(148, 163, 184, 0.25); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55); }
  </style>
</head>
<body>
  <div id="root">
    <div class="dsh-boot-fallback" id="boot-splash">
      <div class="dsh-boot-card">
        <div style="font-size: 20px; font-weight: 800; margin-bottom: 8px;">🎬 正在加载 AI 视频工坊...</div>
        <div style="font-size: 13px; color: #94a3b8;" id="boot-status">正在初始化 React 运行时与工作台模块</div>
      </div>
    </div>
  </div>
  <script type="module">
    const showBootError = (title, detail) => {
      const rootEl = document.getElementById('root');
      if (!rootEl) return;
      rootEl.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'dsh-boot-fallback';
      const card = document.createElement('div');
      card.className = 'dsh-boot-card';
      card.innerHTML = '<div style="font-size:18px;font-weight:800;color:#fb7185;margin-bottom:8px;"></div><pre style="text-align:left;white-space:pre-wrap;font-size:12px;color:#cbd5e1;background:#020617;padding:12px;border-radius:10px;max-height:220px;overflow:auto;"></pre><div style="margin-top:12px;display:flex;gap:10px;justify-content:center;"><button onclick="location.reload()" style="padding:8px 16px;border-radius:8px;border:none;background:#22d3ee;color:#06121e;font-weight:700;cursor:pointer;">重新加载</button></div>';
      card.querySelector('div').textContent = title;
      card.querySelector('pre').textContent = String(detail || '');
      wrap.appendChild(card);
      rootEl.appendChild(wrap);
    };

    window.addEventListener('error', (ev) => {
      if (document.getElementById('boot-splash')) showBootError('工作台页面脚本异常', ev.error?.stack || ev.message);
    });
    window.addEventListener('unhandledrejection', (ev) => {
      if (document.getElementById('boot-splash')) showBootError('工作台模块加载失败', ev.reason?.stack || ev.reason);
    });

    async function loadReactPair() {
      const cdns = [
        ['https://esm.sh/react@18.3.1', 'https://esm.sh/react-dom@18.3.1', 'https://esm.sh/react-dom@18.3.1/client'],
        ['https://cdn.jsdelivr.net/npm/react@18.3.1/+esm', 'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/+esm', 'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/client/+esm'],
      ];
      let lastErr = null;
      for (const [rUrl, rdUrl, rdcUrl] of cdns) {
        try {
          const [rMod, rdMod, rdcMod] = await Promise.all([import(rUrl), import(rdUrl), import(rdcUrl)]);
          return {
            React: rMod.default || rMod,
            ReactDOM: rdMod.default || rdMod,
            createRoot: rdcMod.createRoot || rdcMod.default?.createRoot || (rdMod.default || rdMod).createRoot,
          };
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr || new Error('无法加载 React 18 运行时（请检查本机网络或关闭异常代理）');
    }

    try {
      const { React, ReactDOM, createRoot } = await loadReactPair();
      window.__DSH_STANDALONE__ = true;
      const slots = new Map();
      window.__ModuleLoader__ = {
        load: ({ factory }) => {
          try {
            const plugin = factory((mod) => {
              if (mod === 'react') return React;
              if (mod === 'react-dom') return ReactDOM;
              return null;
            });
            const ctx = {
              connection: { fetch: window.fetch.bind(window) },
              slots: {
                inject(_slotName, fn) {
                  return typeof fn === 'function' ? fn() : undefined;
                },
                register(arg1, arg2) {
                  if (typeof arg1 === 'string') {
                    slots.set(arg1, arg2);
                  } else if (arg1 && typeof arg1 === 'object' && typeof arg2 === 'function') {
                    slots.set(arg1.name, { ...arg1, render: () => React.createElement(arg2) });
                  }
                }
              }
            };
            plugin.apply(ctx);
            const mainSlot = slots.get('main');
            const overlaySlot = slots.get('shell.overlay');
            const targetSlot = mainSlot || overlaySlot;
            const root = createRoot(document.getElementById('root'));
            root.render(targetSlot ? targetSlot.render() : null);
          } catch (err) {
            showBootError('工作台渲染初始化失败', err?.stack || err);
          }
        }
      };

      const s = document.createElement('script');
      s.src = '/client.js?ts=' + Date.now();
      s.onerror = () => showBootError('加载 /client.js 失败', '无法从独立预览服务读取前端脚本');
      document.body.appendChild(s);
    } catch (err) {
      showBootError('独立浏览器预览运行时加载失败', (err?.stack || err) + '\\n\\n提示：你也可以直接在 DeepSeek Harness 客户端内点击「AI 视频工坊」使用，无需外网 CDN。');
    }
  </script>
</body>
</html>`
}

async function main() {
  loadEnv()
  const rawArgs = process.argv.slice(2)
  // Handle `pnpm.cmd dsh video ...` or `node dsh-runner.mjs video ...`
  const args = rawArgs[0] === 'dsh' ? rawArgs.slice(1) : rawArgs
  const profileName = args[0] && !args[0].startsWith('-') ? args[0] : 'video'
  const flags = new Set(args.filter((a) => a.startsWith('-')))

  const profileSetup = setupDshVideoProfile()
  const projectsInfo = listVideoProjects()
  const cordisMount = verifyCordisPluginMounting()

  console.log('======================================================================')
  console.log(`🎬 DeepSeek Harness Video Workbench — Profile: [${profileName}]`)
  console.log('======================================================================')
  console.log(`• Profile Config : ${profileSetup.profilePatchPath}`)
  console.log(`• Desktop Mount  : ${profileSetup.skipped ? 'Unchanged (DSH_VIDEO_SKIP_PROFILE_MOUNT=1)' : profileSetup.desktopMounted ? `Mounted (${profileSetup.desktopPatchPath})` : 'Isolated (.dsh-home)'}`)
  console.log(`• Registered Preset : ${cordisMount.presets.map((p) => `${p.name} (${p.id})`).join(', ')}`)
  console.log(`• Registered Tools  : ${cordisMount.tools.join(', ')}`)
  console.log(`• Registered Routes : ${cordisMount.routes.map((r) => r.path).join(', ')}`)
  console.log(`• Active Projects   : ${projectsInfo.projects.map((p) => `${p.name} [${p.engine}]`).join(', ')}`)

  if (flags.has('--dump-config')) {
    const patchContent = readFileSync(profileSetup.profilePatchPath, 'utf8')
    console.log('\n--- [cordis.patch.yml (profile: video)] ---')
    console.log(patchContent.trim())
    console.log('-------------------------------------------')
    return
  }

  // Try probing DSH CLI if available and requested
  const dshAppRoot = resolveEnvPath('DSH_APP_ROOT', '')
  const dshCliCmd = dshAppRoot ? join(dshAppRoot, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd') : ''

  if (flags.has('--dsh-native') && dshCliCmd && existsSync(dshCliCmd)) {
    console.log(`\n🚀 Launching native DSH CLI with profile '${profileName}'...`)
    const res = await runCommandRedirected(
      'cmd.exe',
      ['/d', '/s', '/c', `"${dshCliCmd}" --profile ${profileName} --version`],
      {
        env: { ...process.env, DSH_HOME: profileSetup.dshHome },
        timeoutMs: 30_000,
      },
    )
    console.log('DSH CLI Output:', (res.stdout || res.stderr).trim())
  }

  // Start HTTP Verification / Standalone Preview Server for `dsh-web-video-workbench`
  const RUNNER_VERSION = 'v9'
  const basePort = Number(process.env.DSH_VIDEO_PORT || 4399)
  const daemonInfoPath = join(REPO_ROOT, '.tmp', 'workbench-daemon.json')
  // DSH_VIDEO_RUNNER_ISOLATED=1 (tests, a second preview of the same checkout): never reuse the studio that is already
  // running and never write / delete the shared daemon-info file, so the user's running studio is left alone
  const isolatedRun = process.env.DSH_VIDEO_RUNNER_ISOLATED === '1'
  const daemonLogPath = join(REPO_ROOT, '.tmp', 'workbench-daemon.log')
  const shouldStop = flags.has('--stop')
  const shouldStatus = flags.has('--status')
  const isDaemonLauncher = (flags.has('--daemon') || flags.has('--bg')) && !flags.has('--daemon-child')
  const isDaemonChild = flags.has('--daemon-child')
  const smokeMode = !isDaemonLauncher && !isDaemonChild && !shouldStop && !shouldStatus && (flags.has('--smoke') || flags.has('--verify') || !flags.has('--keep-alive'))
  const shouldOpenBrowser = flags.has('--open')

  const openBrowserSilently = (targetUrl) => {
    try {
      if (process.platform === 'win32') {
        spawn('cmd.exe', ['/c', 'start', '', targetUrl], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
      } else if (process.platform === 'darwin') {
        spawn('open', [targetUrl], { detached: true, stdio: 'ignore' }).unref()
      } else {
        spawn('xdg-open', [targetUrl], { detached: true, stdio: 'ignore' }).unref()
      }
    } catch {}
  }

  const probeExisting = async () => {
    const ports = []
    if (existsSync(daemonInfoPath)) {
      try {
        const saved = JSON.parse(readFileSync(daemonInfoPath, 'utf8'))
        if (saved?.port) ports.push(Number(saved.port))
      } catch {}
    }
    if (!ports.includes(basePort)) ports.push(basePort)
    for (const p of ports) {
      try {
        const probeRes = await fetch(`http://127.0.0.1:${p}/api/video-workbench/runner-info`, {
          signal: AbortSignal.timeout(1200),
        })
        if (probeRes.ok) {
          const info = await probeRes.json()
          if (info?.ok) return { port: p, info }
        }
      } catch {}
    }
    return null
  }

  if (shouldStatus) {
    const existing = await probeExisting()
    if (existing) {
      console.log(`✅ 后台静默服务运行中: ${existing.info.url} (PID ${existing.info.pid} · ${existing.info.version})`)
      console.log(`   日志文件: ${daemonLogPath}`)
    } else {
      console.log('⚪ 当前未检测到运行中的 DSH Video Workbench 后台服务。')
    }
    return
  }

  if (shouldStop) {
    let stopped = false
    const existing = await probeExisting()
    if (existing) {
      try {
        const stopResp = await fetch(`http://127.0.0.1:${existing.port}/api/video-workbench/runner-stop`, {
          method: 'POST',
          signal: AbortSignal.timeout(2500),
        })
        if (stopResp.ok) stopped = true
      } catch {}
      if (!stopped && existing.info?.pid) {
        try {
          process.kill(Number(existing.info.pid))
          stopped = true
        } catch {}
      }
    }
    if (existsSync(daemonInfoPath)) {
      try {
        const saved = JSON.parse(readFileSync(daemonInfoPath, 'utf8'))
        if (!stopped && saved?.pid) {
          try {
            process.kill(Number(saved.pid))
            stopped = true
          } catch {}
        }
        unlinkSync(daemonInfoPath)
      } catch {}
    }
    console.log(stopped ? '🛑 已安全停止 DSH Video Workbench 后台静默服务。' : '⚪ 未发现需要停止的后台服务。')
    return
  }

  // Check if an existing runner is already active
  if (!smokeMode && !isDaemonChild && !isolatedRun) {
    const existing = await probeExisting()
    if (existing && existing.info?.version === RUNNER_VERSION && existing.info?.repoRoot === REPO_ROOT) {
      console.log(`\n✅ Active DSH Video Workbench (${RUNNER_VERSION}) already listening at: ${existing.info.url}`)
      if (shouldOpenBrowser) openBrowserSilently(existing.info.url)
      return
    }
  }

  // Silent Windowless Daemon Launcher (hides Windows CMD window completely!)
  if (isDaemonLauncher) {
    mkdirSync(join(REPO_ROOT, '.tmp'), { recursive: true })
    const logFd = openSync(daemonLogPath, 'a')
    const selfPath = fileURLToPath(import.meta.url)
    const childArgs = [selfPath, profileName, '--keep-alive', '--daemon-child']
    const child = spawn(process.execPath, childArgs, {
      cwd: REPO_ROOT,
      env: { ...process.env, DSH_VIDEO_PORT: String(basePort) },
      detached: true,
      windowsHide: true,
      stdio: ['ignore', logFd, logFd],
    })
    child.unref()
    try { closeSync(logFd) } catch {}

    // Poll until background HTTP server is ready (up to 15s)
    let readyInfo = null
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise((r) => setTimeout(r, 300))
      const probed = await probeExisting()
      if (probed?.info?.ok) {
        readyInfo = probed.info
        break
      }
    }
    const finalUrl = readyInfo?.url || `http://127.0.0.1:${basePort}`
    console.log(`✅ DSH Video Workbench 已转入后台静默运行（无黑窗）: ${finalUrl} (PID ${readyInfo?.pid || child.pid})`)
    console.log(`   日志路径: ${daemonLogPath}`)
    console.log('   停止服务: 运行 stop-workbench.cmd 或 `node ./bin/dsh-video-cli.mjs studio --stop`')
    if (shouldOpenBrowser) openBrowserSilently(finalUrl)
    return
  }

  // Last-resort safety net for the long-running studio: log a stray rejection instead of exiting mid-render
  // (smoke / verify runs keep Node's default so a failure still fails the run).
  if (!smokeMode) process.on('unhandledRejection', (reason) => console.error('[runner] unhandled rejection:', reason?.stack || reason))
  let actualPort = basePort
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${actualPort}`)
    if (url.pathname.startsWith('/api/')) {
      // Sandboxed host iframes (Ruodao desktop) get CORS echoed so the browser lets the page read the response.
      applyEmbeddedCorsHeaders(req, res)
      const why = apiRequestRejection(req, actualPort)
      // Preflight carries no side effect; only a foreign Host may still be rejected here.
      if (req.method === 'OPTIONS' && why !== 'host') {
        res.statusCode = 204
        res.end()
        return
      }
      if (why) {
        sendJson(res, 403, { ok: false, error: API_FORBIDDEN_MESSAGE, reason: why })
        return
      }
    }
    if (url.pathname === '/api/video-workbench/runner-info') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(
        JSON.stringify({
          ok: true,
          version: RUNNER_VERSION,
          pid: process.pid,
          port: actualPort,
          url: `http://127.0.0.1:${actualPort}`,
          repoRoot: REPO_ROOT,
          daemonMode: isDaemonChild,
          logPath: daemonLogPath,
        }),
      )
      return
    }
    if (url.pathname === '/api/video-workbench/runner-stop' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ ok: true, stopping: true, pid: process.pid }))
      setTimeout(() => {
        try { if (!isolatedRun && existsSync(daemonInfoPath)) unlinkSync(daemonInfoPath) } catch {}
        try { server.close() } catch {}
        process.exit(0)
      }, 120)
      return
    }
    if (url.pathname.startsWith('/api/video-workbench/')) {
      await forwardApiRequest(req, res, url, handleWorkbenchApiRequest)
      return
    }

    if (url.pathname === '/client.js') {
      const clientJsPath = join(REPO_ROOT, 'packages', 'dsh-web-video-workbench', 'lib', 'client.js')
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(readFileSync(clientJsPath, 'utf8'))
      return
    }

    // Serve standalone interactive preview shell hosting `dsh-web-video-workbench` (`client.js`)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(standaloneShellHtml(profileName))
  })
  server.requestTimeout = 660_000
  server.headersTimeout = 660_000

  for (let offset = 0; offset <= 15; offset++) {
    const candidatePort = basePort + offset
    try {
      await new Promise((resolveListen, rejectListen) => {
        const onErr = (err) => {
          server.off('listening', onOk)
          rejectListen(err)
        }
        const onOk = () => {
          server.off('error', onErr)
          resolveListen()
        }
        server.once('error', onErr)
        server.once('listening', onOk)
        server.listen(candidatePort, '127.0.0.1')
      })
      actualPort = candidatePort
      break
    } catch (err) {
      if (err?.code !== 'EADDRINUSE' || offset === 15) throw err
    }
  }
  if (actualPort !== basePort) {
    console.log(`⚠️  Port ${basePort} was busy (e.g. legacy process); auto-bound to free port http://127.0.0.1:${actualPort}`)
  }
  console.log(`\n✅ DSH Video Workbench Service listening at: http://127.0.0.1:${actualPort}`)

  // Perform quick live HTTP self-check against `/api/video-workbench/state`
  const stateResp = await fetch(`http://127.0.0.1:${actualPort}/api/video-workbench/state`)
  const stateJson = await stateResp.json()
  console.log(
    `✅ Live API Health Check (/api/video-workbench/state): HTTP ${stateResp.status} · Voices Loaded: ${stateJson.voiceCatalog?.length || 0} · Active TTS: ${stateJson.ttsConfig?.activeEngineId || 'indextts25'} · Active Preset: ${stateJson.presetName}`,
  )

  if (smokeMode) {
    server.close()
    console.log('✅ `pnpm dsh video` startup & live verification completed with 0 errors.')
  } else {
    try {
      if (isolatedRun) throw new Error('isolated run: no daemon-info file')
      mkdirSync(join(REPO_ROOT, '.tmp'), { recursive: true })
      writeFileSync(
        daemonInfoPath,
        JSON.stringify({
          pid: process.pid,
          port: actualPort,
          url: `http://127.0.0.1:${actualPort}`,
          version: RUNNER_VERSION,
          daemonMode: isDaemonChild,
          startedAt: new Date().toISOString(),
        }, null, 2) + '\n',
        'utf8',
      )
    } catch {}
    const cleanupPid = () => {
      try { if (!isolatedRun && existsSync(daemonInfoPath)) unlinkSync(daemonInfoPath) } catch {}
      process.exit(0)
    }
    process.once('SIGINT', cleanupPid)
    process.once('SIGTERM', cleanupPid)
    if (shouldOpenBrowser) {
      openBrowserSilently(`http://127.0.0.1:${actualPort}`)
    }
    console.log(isDaemonChild ? '💡 Running silently in background daemon mode.' : '💡 Press Ctrl+C to stop the server.')
  }
}

const isDirectEntry =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isDirectEntry) {
  main().catch((err) => {
    console.error('❌ [dsh-runner] Error:', err)
    process.exit(1)
  })
}
